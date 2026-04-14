import { useState, useRef, useCallback } from "react";
import { Form, useActionData, useLoaderData, useLocation, useNavigate, useNavigation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getBox, updateBox, deleteBox, getBannerImageSrc } from "../models/boxes.server";
import { getShopCurrencyCode } from "../models/shop.server";
import { withEmbeddedAppParams, withEmbeddedAppToastFromRequest } from "../utils/embedded-app";
import { getCurrencySymbol } from "../utils/currency";
import { ToggleSwitch } from "../components/toggle-switch";
import {
  Badge, Banner, BlockStack, Box, Button, Card, Checkbox,
  DropZone, FormLayout, InlineGrid, InlineStack, Layout, Modal, Page,
  Select, Spinner, Text, TextField
} from "@shopify/polaris";

/* ─────────────────────────── GraphQL ─────────────────────────── */
const COLLECTIONS_QUERY = `#graphql
  query GetCollections($first: Int!) {
    collections(first: $first) {
      edges {
        node {
          id
          title
          image { url }
        }
      }
    }
  }
`;

const PRODUCTS_QUERY = `#graphql
  query GetProducts($first: Int!, $query: String) {
    products(first: $first, query: $query) {
      edges {
        node {
          id
          title
          handle
          featuredImage { url }
          variants(first: 100) {
            edges { node { id price } }
          }
        }
      }
    }
  }
`;

const COLLECTION_PRODUCTS_QUERY = `#graphql
  query CollectionProducts($id: ID!, $first: Int!) {
    collection(id: $id) {
      products(first: $first) {
        edges {
          node {
            id
            title
            handle
            featuredImage { url }
            variants(first: 100) {
              edges { node { id price } }
            }
          }
        }
      }
    }
  }
`;

/* ─────────────────────────── Constants ─────────────────────────── */
const MAX_BANNER_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_BANNER_MIME_TYPES = new Set([
  "image/jpeg", "image/jpg", "image/png",
  "image/webp", "image/gif", "image/avif",
]);

/* ─────────────────────────── Helpers ─────────────────────────── */
async function parseBannerImage(formData, errors) {
  const file = formData.get("bannerImage");
  if (!file || typeof file !== "object" || typeof file.arrayBuffer !== "function" || !file.size) return null;
  if (!ALLOWED_BANNER_MIME_TYPES.has(file.type)) { errors.bannerImage = "Only JPG, PNG, WEBP, GIF, and AVIF files are allowed"; return null; }
  if (file.size > MAX_BANNER_IMAGE_SIZE) { errors.bannerImage = "Banner image must be 5MB or smaller"; return null; }
  return { bytes: new Uint8Array(await file.arrayBuffer()), mimeType: file.type, fileName: file.name || null };
}

/* ─────────────────────────── Loader ─────────────────────────── */
export const loader = async ({ request, params }) => {
  const { admin, session, redirect } = await authenticate.admin(request);
  const shop = session.shop;
  const currencyCode = await getShopCurrencyCode(shop);

  const box = await getBox(params.id, shop);
  if (!box) throw redirect("/app/boxes");
  const bannerImageSrc = getBannerImageSrc(box);
  const boxWithoutBinary = { ...box };
  delete boxWithoutBinary.bannerImageData;
  delete boxWithoutBinary.bannerImageMimeType;
  delete boxWithoutBinary.bannerImageFileName;

  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";
  const searchQuery = query ? `${query} NOT vendor:ComboBuilder` : "NOT vendor:ComboBuilder";

  const [prodResp, collResp] = await Promise.all([
    admin.graphql(PRODUCTS_QUERY, { variables: { first: 50, query: searchQuery } }),
    admin.graphql(COLLECTIONS_QUERY, { variables: { first: 50 } }),
  ]);
  const prodJson = await prodResp.json();
  const collJson = await collResp.json();

  const products = (prodJson?.data?.products?.edges || []).map(({ node }) => ({
    id: node.id,
    title: node.title,
    handle: node.handle,
    imageUrl: node.featuredImage?.url || null,
    variantIds: (node.variants?.edges || []).map(({ node: v }) => v.id),
    variantId: node.variants?.edges?.[0]?.node?.id || null,
    price: node.variants?.edges?.[0]?.node?.price || "0",
  }));

  const collections = (collJson?.data?.collections?.edges || []).map(({ node }) => ({
    id: node.id,
    title: node.title,
    imageUrl: node.image?.url || null,
  }));

  // Compute effectiveBundlePrice fallback
  let comboStepsConfig = null;
  if (box.config) {
    const cfg = box.config;
    let steps = [];
    try { steps = JSON.parse(cfg.stepsJson || "[]"); } catch {}
    comboStepsConfig = JSON.stringify({
      type:              cfg.comboType,
      title:             cfg.title             ?? undefined,
      subtitle:          cfg.subtitle          ?? undefined,
      bundlePrice:       cfg.bundlePrice != null ? parseFloat(cfg.bundlePrice) : undefined,
      bundlePriceType:   cfg.bundlePriceType   ?? undefined,
      isActive:          cfg.isActive,
      steps,
    });
  } else if (box.comboStepsConfig) {
    comboStepsConfig = box.comboStepsConfig;
  }

  let effectiveBundlePrice = parseFloat(box.bundlePrice) || 0;
  let savedDiscountType = "percent";
  let savedDiscountValue = "10";
  let savedBoxSubtitle = "";
  let savedBuyQuantity = "1";
  let savedGetQuantity = "1";
  let savedBundlePriceType = box.bundlePriceType || "manual";
  if (comboStepsConfig) {
    try {
      const parsed = JSON.parse(comboStepsConfig);
      if (effectiveBundlePrice === 0) effectiveBundlePrice = parseFloat(parsed.bundlePrice) || 0;
      if (parsed.bundlePriceType) savedBundlePriceType = parsed.bundlePriceType;
      if (parsed.discountType) savedDiscountType = parsed.discountType;
      if (parsed.discountValue != null) savedDiscountValue = String(parsed.discountValue);
      if (typeof parsed.boxSubtitle === "string") savedBoxSubtitle = parsed.boxSubtitle;
      if (parsed.buyQuantity != null) savedBuyQuantity = String(parsed.buyQuantity);
      if (parsed.getQuantity != null) savedGetQuantity = String(parsed.getQuantity);
    } catch {}
  }
  if (savedBundlePriceType !== "dynamic") {
    savedDiscountType = "none";
    savedDiscountValue = "0";
    savedBuyQuantity = "1";
    savedGetQuantity = "1";
  }

  return {
    box: { ...boxWithoutBinary, bundlePrice: effectiveBundlePrice, bannerImageSrc, discountType: savedDiscountType, discountValue: savedDiscountValue, boxSubtitle: savedBoxSubtitle, buyQuantity: savedBuyQuantity, getQuantity: savedGetQuantity },
    products,
    collections,
    currencyCode,
  };
};

/* ─────────────────────────── Action ─────────────────────────── */
export const action = async ({ request, params }) => {
  const { admin, session, redirect } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("_action");

  if (intent === "delete") {
    await deleteBox(params.id, shop, admin);
    throw redirect("/app/boxes");
  }

  // Default: save box settings only (ComboBox table)
  let scopeItems = [];
  try { scopeItems = JSON.parse(formData.get("scopeItems") || "[]"); } catch {}
  let eligibleProducts = [];
  try { eligibleProducts = JSON.parse(formData.get("eligibleProducts") || "[]"); } catch {}
  const errors = {};
  const bannerImage = await parseBannerImage(formData, errors);
  const removeBannerImage = formData.get("removeBannerImage") === "true" && !bannerImage;
  const scopeType = formData.get("scope") || "wholestore";
  const bundlePriceType = formData.get("bundlePriceType") === "dynamic" ? "dynamic" : "manual";
  const requestedDiscountType = bundlePriceType === "dynamic" ? (formData.get("discountType") || "none") : "none";
  const discountType = requestedDiscountType === "buy_x_get_y" ? "none" : requestedDiscountType;
  const discountValue = bundlePriceType === "dynamic"
    ? (discountType === "none" ? "0" : (formData.get("discountValue") || "0"))
    : "0";
  const buyQuantity = bundlePriceType === "dynamic" ? (formData.get("buyQuantity") || "1") : "1";
  const getQuantity = bundlePriceType === "dynamic" ? (formData.get("getQuantity") || "1") : "1";

  const displayTitle = String(formData.get("displayTitle") || "").trim();
  const boxName = String(formData.get("boxName") || displayTitle).trim();

  const data = {
    boxName,
    displayTitle,
    comboProductButtonTitle: formData.get("comboProductButtonTitle") || "",
    productButtonTitle: formData.get("productButtonTitle") || "",
    itemCount: formData.get("itemCount"),
    bundlePrice: formData.get("bundlePrice"),
    bundlePriceType,
    discountType,
    discountValue,
    buyQuantity,
    getQuantity,
    isGiftBox: formData.get("isGiftBox") === "true",
    allowDuplicates: formData.get("allowDuplicates") === "true",
    bannerImage,
    removeBannerImage,
    isActive: formData.get("isActive") === "true",
    giftMessageEnabled: formData.get("giftMessageEnabled") === "true",
    scopeType,
    scopeItems,
  };
  if (!data.displayTitle?.trim()) errors.displayTitle = "Display title is required";
  if (!data.itemCount || parseInt(data.itemCount, 10) < 1 || parseInt(data.itemCount, 10) > 8) {
    errors.itemCount = "Item count must be between 1 and 8";
  }
  if (data.giftMessageEnabled && !data.isGiftBox) errors.giftMessageEnabled = "Enable Gift Box Mode to use Gift Message Field.";

  if (Object.keys(errors).length > 0) return { errors };

  // Build eligible products list for ComboBoxProduct table
  if (scopeType === "specific_collections" && scopeItems.length > 0) {
    const allProds = [];
    for (const col of scopeItems) {
      try {
        const resp = await admin.graphql(COLLECTION_PRODUCTS_QUERY, { variables: { id: col.id, first: 100 } });
        const json = await resp.json();
        (json?.data?.collection?.products?.edges || []).forEach(({ node }) => {
          allProds.push({
            productId: node.id,
            productTitle: node.title,
            productHandle: node.handle || null,
            productImageUrl: node.featuredImage?.url || null,
            variantIds: (node.variants?.edges || []).map(({ node: v }) => v.id),
            price: node.variants?.edges?.[0]?.node?.price || "0",
          });
        });
      } catch (e) {
        console.error("[edit box] Failed to expand collection:", col.id, e);
      }
    }
    data.eligibleProducts = allProds;
  } else if (scopeType === "specific_products" && eligibleProducts.length > 0) {
    data.eligibleProducts = eligibleProducts;
  } else if (scopeType === "wholestore") {
    data.eligibleProducts = [];
    data.replaceEligibleProducts = true;
  }

  try {
    await updateBox(params.id, shop, data, admin);
  } catch (e) {
    console.error("[app.boxes.$id._index] updateBox error:", e);
    return { errors: { _global: "Failed to save changes. Please try again." } };
  }

  throw redirect(
    withEmbeddedAppToastFromRequest("/app/boxes", request, {
      message: "Configuration saved successfully.",
    }),
  );
};

/* ─────────────────────────── Styles ─────────────────────────── */
const inputStyle = {
  width: "100%", padding: "8px 12px", border: "1.5px solid #e5e7eb",
  borderRadius: "6px", fontFamily: "inherit", fontSize: "12px", boxSizing: "border-box",
};

/* ─────────────────────────── Component ─────────────────────────── */
export default function BoxSettingsPage() {
  const { box, products, collections, currencyCode } = useLoaderData();
  const actionData = useActionData();
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";
  const isPageLoading = navigation.state !== "idle";
  const currencySymbol = getCurrencySymbol(currencyCode);
  const [isBackNavigating, setIsBackNavigating] = useState(false);
  const [clientErrors, setClientErrors] = useState({});

  const errors = actionData?.errors || {};

  const [options, setOptions] = useState({
    isGiftBox: box.isGiftBox, allowDuplicates: box.allowDuplicates,
    giftMessageEnabled: box.isGiftBox ? box.giftMessageEnabled : false, isActive: box.isActive,
  });
  const [optionValidationMessage, setOptionValidationMessage] = useState("");
  const [itemCount, setItemCount] = useState(String(box.itemCount));
  const [priceMode, setPriceMode] = useState(box.bundlePriceType || "manual");
  const [manualPrice, setManualPrice] = useState(String(box.bundlePrice));
  const [discountType, setDiscountType] = useState(box.discountType === "buy_x_get_y" ? "none" : (box.discountType || "percent"));
  const [discountValue, setDiscountValue] = useState(box.discountValue || "10");
  const [buyQuantity, setBuyQuantity] = useState(box.buyQuantity || "1");
  const [getQuantity, setGetQuantity] = useState(box.getQuantity || "1");
  const [scope, setScope] = useState(box.scopeType || "wholestore");
  const [scopeItems, setScopeItems] = useState(() => {
    // For specific_products: initialize from ComboBoxProduct records (full data) if available
    if ((box.scopeType || "specific_collections") === "specific_products" && Array.isArray(box.products) && box.products.length > 0) {
      return box.products.map(p => ({
        id: p.productId,
        title: p.productTitle || p.productId,
        handle: p.productHandle || null,
        imageUrl: p.productImageUrl || null,
        variantIds: (() => { try { return JSON.parse(p.variantIds || "[]"); } catch { return []; } })(),
        price: p.productPrice != null ? String(p.productPrice) : "0",
      }));
    }
    // For collections (or fallback): use scopeItemsJson
    try { return JSON.parse(box.scopeItemsJson || "[]"); } catch { return []; }
  });
  const [showScopePicker, setShowScopePicker] = useState(false);
  const [scopeSearch, setScopeSearch] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [removeBannerImage, setRemoveBannerImage] = useState(false);
  const [bannerImagePreview, setBannerImagePreview] = useState(null);
  const [bannerImageHover, setBannerImageHover] = useState(false);
  const bannerImageRef = useRef(null);

  const handleBannerDrop = useCallback((_dropFiles, acceptedFiles) => {
    const file = acceptedFiles[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setBannerImagePreview(ev.target?.result || null);
    reader.readAsDataURL(file);
    const dt = new DataTransfer();
    dt.items.add(file);
    if (bannerImageRef.current) bannerImageRef.current.files = dt.files;
    setRemoveBannerImage(false);
  }, []);

  const numItemCount = Math.min(8, Math.max(1, parseInt(itemCount, 10) || 1));
  const dynamicPrice = 0;
  const bundlePrice = priceMode === "manual" ? parseFloat(manualPrice) || 0 : dynamicPrice;

  /* ── Box Settings helpers ── */
  function toggleOption(name) {
    let validationMessage = "";
    setOptions((prev) => {
      if (name === "giftMessageEnabled" && !prev.isGiftBox) {
        validationMessage = "Enable Gift Box Mode to use Gift Message Field.";
        return prev;
      }
      if (name === "isGiftBox" && prev.isGiftBox) {
        return { ...prev, isGiftBox: false, giftMessageEnabled: false };
      }
      return { ...prev, [name]: !prev[name] };
    });
    setOptionValidationMessage(validationMessage);
  }
  function selectScope(nextScope) {
    if (!nextScope || nextScope === scope) return;
    setScope(nextScope);
    setScopeItems([]);
  }
  function handleBackAction() {
    setIsBackNavigating(true);
    navigate(withEmbeddedAppParams("/app/boxes", location.search));
  }

  function validateAndSubmit() {
    const errs = {};
    const titleEl = document.querySelector("#edit-box-form input[name='displayTitle']");
    const titleVal = titleEl ? titleEl.value.trim() : (box.displayTitle || "").trim();
    if (!titleVal) errs.displayTitle = "Bundle title is required";
    const ic = parseInt(itemCount);
    if (!itemCount || isNaN(ic) || ic < 1 || ic > 8) errs.itemCount = "Item count must be between 1 and 8";
    if (priceMode === "manual" && (!manualPrice || parseFloat(manualPrice) <= 0)) errs.bundlePrice = "Bundle price is required";
    if ((scope === "specific_collections" || scope === "specific_products") && scopeItems.length === 0) {
      errs.scopeItems = "Please select at least one " + (scope === "specific_collections" ? "collection" : "product");
    }
    setClientErrors(errs);
    if (Object.keys(errs).length === 0) {
      document.getElementById("edit-box-form")?.requestSubmit();
    }
  }

  /* ─────────────── Render ─────────────── */
  return (
    <Page
      title={`Edit: ${box.displayTitle || box.boxName || "Box"}`}
      backAction={{ content: "Boxes", onAction: handleBackAction }}
      primaryAction={{
        content: isSaving ? "Saving..." : "Save Changes",
        loading: isSaving,
        onAction: validateAndSubmit,
      }}
      secondaryActions={[
        {
          content: "Delete Box",
          destructive: true,
          onAction: () => setShowDeleteConfirm(true),
        },
      ]}
    >
      {/* Loading overlay */}
      {(isPageLoading || isBackNavigating) && (
        <div
          aria-live="polite"
          aria-busy="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10001,
            background: "rgba(255,255,255,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Spinner accessibilityLabel="Loading page" size="large" />
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <Modal
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title="Delete this box?"
        primaryAction={{
          content: "Delete",
          destructive: true,
          onAction: () => {
            const form = document.createElement("form");
            form.method = "POST";
            const input = document.createElement("input");
            input.type = "hidden";
            input.name = "_action";
            input.value = "delete";
            form.appendChild(input);
            document.body.appendChild(form);
            form.submit();
          },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setShowDeleteConfirm(false) }]}
      >
        <Modal.Section>
          <Text>This will permanently delete "{box.boxName}" and all its settings.</Text>
        </Modal.Section>
      </Modal>

      {/* Scope Picker Modal */}
      {showScopePicker && scope !== "wholestore" && (() => {
        const isCollections = scope === "specific_collections";
        const allItems = isCollections ? collections : products;
        const filtered = scopeSearch.trim()
          ? allItems.filter((i) => i.title.toLowerCase().includes(scopeSearch.toLowerCase()))
          : allItems;
        const isScopeSelected = (id) => scopeItems.some((i) => i.id === id);
        function toggleScopeItem(item) {
          setScopeItems((prev) => prev.some((i) => i.id === item.id)
            ? prev.filter((i) => i.id !== item.id)
            : [...prev, item]
          );
        }
        return (
          <Modal
            open={showScopePicker}
            onClose={() => setShowScopePicker(false)}
            title={isCollections ? "Choose Collections" : "Show on Selected Products"}
            primaryAction={{
              content: `Done${scopeItems.length > 0 ? ` (${scopeItems.length} selected)` : ""}`,
              onAction: () => setShowScopePicker(false),
            }}
            secondaryActions={[{ content: "Cancel", onAction: () => setShowScopePicker(false) }]}
          >
            <Modal.Section>
              <BlockStack gap="300">
                <TextField
                  label={isCollections ? "Search collections" : "Search products"}
                  labelHidden
                  placeholder={`Search ${isCollections ? "collections" : "products"}…`}
                  value={scopeSearch}
                  onChange={(v) => setScopeSearch(v)}
                  autoComplete="off"
                  autoFocus
                  clearButton
                  onClearButtonClick={() => setScopeSearch("")}
                />
                {filtered.length === 0 ? (
                  <Text tone="subdued" alignment="center" variant="bodySm">
                    No {isCollections ? "collections" : "products"} found
                  </Text>
                ) : (
                  <BlockStack gap="0">
                    {filtered.map((item) => {
                      const selected = isScopeSelected(item.id);
                      return (
                        <div
                          key={item.id}
                          role="option"
                          aria-selected={selected}
                          onClick={() => toggleScopeItem(item)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                            padding: "10px 0",
                            borderBottom: "1px solid #f3f4f6",
                            background: selected ? "#f0fdf4" : "#fff",
                            cursor: "pointer",
                          }}
                        >
                          <div onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              label={item.title}
                              labelHidden
                              checked={selected}
                              onChange={() => toggleScopeItem(item)}
                            />
                          </div>
                          {item.imageUrl ? (
                            <img src={item.imageUrl} alt={item.title} style={{ width: "40px", height: "40px", objectFit: "cover", borderRadius: "5px", flexShrink: 0, border: "1px solid #e5e7eb" }} />
                          ) : (
                            <div style={{ width: "40px", height: "40px", borderRadius: "5px", background: "#f3f4f6", flexShrink: 0, border: "1px solid #e5e7eb" }} />
                          )}
                          <Text variant="bodyMd" fontWeight={selected ? "semibold" : "regular"} as="span">{item.title}</Text>
                        </div>
                      );
                    })}
                  </BlockStack>
                )}
              </BlockStack>
            </Modal.Section>
          </Modal>
        );
      })()}

      <Form
        id="edit-box-form"
        method="POST"
        action={`/app/boxes/${box.id}${location.search ? location.search + "&index" : "?index"}`}
        encType="multipart/form-data"
      >
        <input type="hidden" name="_action" value="save" />
        <input type="hidden" name="bundlePrice" value={bundlePrice > 0 ? bundlePrice.toFixed(2) : ""} />
        <input type="hidden" name="bundlePriceType" value={priceMode} />
        <input type="hidden" name="discountType" value={priceMode === "dynamic" ? discountType : "none"} />
        <input type="hidden" name="discountValue" value={priceMode === "dynamic" ? (discountType === "none" ? "0" : discountValue) : "0"} />
        <input type="hidden" name="buyQuantity" value={priceMode === "dynamic" ? buyQuantity : "1"} />
        <input type="hidden" name="getQuantity" value={priceMode === "dynamic" ? getQuantity : "1"} />
        <input type="hidden" name="itemCount" value={itemCount} />
        <input type="hidden" name="isGiftBox" value={String(options.isGiftBox)} />
        <input type="hidden" name="allowDuplicates" value={String(options.allowDuplicates)} />
        <input type="hidden" name="giftMessageEnabled" value={String(options.giftMessageEnabled)} />
        <input type="hidden" name="isActive" value={String(options.isActive)} />
        <input type="hidden" name="scope" value={scope} />
        <input type="hidden" name="removeBannerImage" value={String(removeBannerImage)} />
        <input type="hidden" name="scopeItems" value={JSON.stringify(scopeItems.map(i => ({ id: i.id, title: i.title })))} />
        {scope === "specific_products" && (
          <input type="hidden" name="eligibleProducts" value={JSON.stringify(
            scopeItems.map(item => ({
              productId: item.id,
              productTitle: item.title,
              productHandle: item.handle || null,
              productImageUrl: item.imageUrl || null,
              variantIds: item.variantIds || [],
              price: item.price || "0",
            }))
          )} />
        )}

        <BlockStack gap="400">
          {/* Global error banner */}
          {errors._global && (
            <Banner tone="critical">
              <Text>{errors._global}</Text>
            </Banner>
          )}

          {/* Card 1 — Status */}
          <Card>
            <InlineGrid columns={{ xs: "1fr", sm: "1fr auto" }} gap="400">
              <BlockStack gap="050">
                <Text as="h2" variant="headingMd">Simple Bundle</Text>
                <Text as="p" variant="bodySm" tone="subdued">Create and configure your Simple Bundle experience</Text>
              </BlockStack>
              <InlineStack gap="200" blockAlign="start">
                <ToggleSwitch checked={options.isActive} onChange={() => toggleOption("isActive")} showStateText={false} />
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" fontWeight="semibold">Publish on Storefront</Text>
                  <Text as="p" variant="bodySm" tone="subdued">Uncheck to hide this box from customers</Text>
                </BlockStack>
              </InlineStack>
            </InlineGrid>
          </Card>

          {/* Card 2 — Basic Information */}
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Bundle Setup</Text>
              <FormLayout>
                <FormLayout.Group>
                  <BlockStack gap="100">
                    <Text as="label" variant="bodySm" fontWeight="semibold">Bundle Title *</Text>
                    <input
                      type="text"
                      name="displayTitle"
                      defaultValue={box.displayTitle}
                      onChange={() => { if (clientErrors.displayTitle) setClientErrors((p) => ({ ...p, displayTitle: "" })); }}
                      placeholder="e.g. Build Your Perfect Snack Box"
                      style={{ ...inputStyle, borderColor: (clientErrors.displayTitle || errors.displayTitle) ? "#e11d48" : "#e5e7eb" }}
                    />
                    {(clientErrors.displayTitle || errors.displayTitle) && (
                      <Text tone="critical" variant="bodySm">{clientErrors.displayTitle || errors.displayTitle}</Text>
                    )}
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text as="label" variant="bodySm" fontWeight="semibold">Bundle CTA Button Text</Text>
                    <input
                      type="text"
                      name="comboProductButtonTitle"
                      defaultValue={box.comboProductButtonTitle || ""}
                      placeholder="Build your own box"
                      style={inputStyle}
                    />
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text as="label" variant="bodySm" fontWeight="semibold">Add Bundle Button Text</Text>
                    <input
                      type="text"
                      name="productButtonTitle"
                      defaultValue={box.productButtonTitle || ""}
                      placeholder="Add To Cart"
                      style={inputStyle}
                    />
                  </BlockStack>
                </FormLayout.Group>
                <FormLayout.Group>
                  <BlockStack gap="100">
                    <Text as="label" variant="bodySm" fontWeight="semibold">Items Required in Bundle *</Text>
                    <input
                      type="number"
                      placeholder="e.g. 4"
                      min="1"
                      max="8"
                      step="1"
                      value={itemCount}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === "") {
                          setItemCount("");
                        } else {
                          const parsed = parseInt(raw, 10);
                          if (Number.isNaN(parsed)) return;
                          setItemCount(String(Math.min(8, Math.max(1, parsed))));
                        }
                        if (clientErrors.itemCount) setClientErrors((p) => ({ ...p, itemCount: "" }));
                      }}
                      style={{ ...inputStyle, borderColor: (clientErrors.itemCount || errors.itemCount) ? "#e11d48" : "#e5e7eb" }}
                    />
                    {(clientErrors.itemCount || errors.itemCount) && (
                      <Text tone="critical" variant="bodySm">{clientErrors.itemCount || errors.itemCount}</Text>
                    )}
                  </BlockStack>

                  {/* Bundle Price */}
                  <BlockStack gap="200">
                    <Text as="label" variant="bodySm" fontWeight="semibold">
                      Bundle Pricing *
                    </Text>
                    {/* Price mode toggle tabs */}
                    <div style={{ display: "flex", border: "1px solid #d1d5db", borderRadius: "6px", overflow: "hidden" }}>
                      {["manual", "dynamic"].map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => { setPriceMode(mode); if (clientErrors.bundlePrice) setClientErrors((p) => ({ ...p, bundlePrice: "" })); }}
                          style={{
                            flex: 1,
                            padding: "7px 0",
                            fontSize: "12px",
                            fontWeight: "600",
                            border: "none",
                            cursor: "pointer",
                            background: priceMode === mode ? "#000000" : "#f9fafb",
                            color: priceMode === mode ? "#ffffff" : "#374151",
                            transition: "background 0.15s",
                          }}
                        >
                          {mode === "manual" ? "Fixed Price" : "Dynamic Price"}
                        </button>
                      ))}
                    </div>
                    {priceMode === "manual" && (
                      <>
                      <input
                        type="number"
                        placeholder="e.g. 1200"
                        min="0"
                        step="0.01"
                        value={manualPrice}
                        onChange={(e) => { setManualPrice(e.target.value); if (clientErrors.bundlePrice) setClientErrors((p) => ({ ...p, bundlePrice: "" })); }}
                        style={{ ...inputStyle, borderColor: clientErrors.bundlePrice ? "#e11d48" : "#e5e7eb" }}
                      />
                      {clientErrors.bundlePrice && <Text tone="critical" variant="bodySm">{clientErrors.bundlePrice}</Text>}
                      </>
                    )}
                    {priceMode === "dynamic" && (
                      <div style={{ border: "1px solid #d1d5db", borderRadius: "6px", padding: "12px", background: "#ffffff" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
                          <BlockStack gap="100">
                            <Text as="label" variant="bodySm" fontWeight="semibold">Discount Type</Text>
                            <select
                              value={discountType}
                              onChange={(e) => setDiscountType(e.target.value)}
                              style={{ ...inputStyle, fontSize: "12px" }}
                            >
                              <option value="percent">% Off Total</option>
                              <option value="fixed">{currencySymbol} Fixed Discount</option>
                              <option value="none">No Discount</option>
                            </select>
                          </BlockStack>
                          {discountType !== "none" && (
                            <BlockStack gap="100">
                              <Text as="label" variant="bodySm" fontWeight="semibold">
                                {discountType === "percent" ? "Discount %" : `Amount (${currencySymbol})`}
                              </Text>
                              <input
                                type="number"
                                min="0"
                                step={discountType === "percent" ? "1" : "0.01"}
                                max={discountType === "percent" ? "99" : undefined}
                                value={discountValue}
                                onChange={(e) => setDiscountValue(e.target.value)}
                                style={{ ...inputStyle, fontSize: "12px" }}
                              />
                            </BlockStack>
                          )}
                        </div>
                        <Text variant="bodySm" tone="subdued">
                          {discountType !== "none" ? "Discount applied on total amount" : "No discount applied"}
                        </Text>
                      </div>
                    )}
                  </BlockStack>

                  {/* Banner Image */}
                  <BlockStack gap="200">
                    <Text as="label" variant="bodySm" fontWeight="semibold">Bundle Banner Image</Text>
                    <input type="file" ref={bannerImageRef} name="bannerImage" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" style={{ display: "none" }} />
                    {(box.bannerImageSrc && !removeBannerImage && !bannerImagePreview) ? (
                      <div
                        style={{ position: "relative", display: "inline-block", width: "120px" }}
                        onMouseEnter={() => setBannerImageHover(true)}
                        onMouseLeave={() => setBannerImageHover(false)}
                      >
                        <img src={box.bannerImageSrc} alt="Current banner" style={{ width: "120px", borderRadius: "6px", border: "1px solid #e5e7eb", display: "block" }} />
                        {bannerImageHover && (
                          <button
                            type="button"
                            onClick={() => setRemoveBannerImage(true)}
                            style={{ position: "absolute", top: "4px", right: "4px", background: "rgba(0,0,0,0.65)", border: "none", borderRadius: "50%", width: "22px", height: "22px", cursor: "pointer", color: "#fff", fontSize: "14px", lineHeight: "22px", textAlign: "center", padding: 0 }}
                            aria-label="Remove banner image"
                          >×</button>
                        )}
                      </div>
                    ) : bannerImagePreview ? (
                      <div style={{ position: "relative", display: "inline-block", width: "120px" }}>
                        <img src={bannerImagePreview} alt="New banner" style={{ width: "120px", borderRadius: "6px", border: "1px solid #e5e7eb", display: "block" }} />
                        <button
                          type="button"
                          onClick={() => { setBannerImagePreview(null); if (bannerImageRef.current) bannerImageRef.current.value = ""; }}
                          style={{ position: "absolute", top: "4px", right: "4px", background: "rgba(0,0,0,0.65)", border: "none", borderRadius: "50%", width: "22px", height: "22px", cursor: "pointer", color: "#fff", fontSize: "14px", lineHeight: "22px", textAlign: "center", padding: 0 }}
                          aria-label="Remove new image"
                        >×</button>
                      </div>
                    ) : (
                      <DropZone accept="image/jpeg,image/png,image/webp,image/gif,image/avif" type="image" allowMultiple={false} onDrop={handleBannerDrop}>
                        <DropZone.FileUpload />
                      </DropZone>
                    )}
                    <Text variant="bodySm" tone="subdued">JPG, PNG, WEBP, GIF, or AVIF — max 5MB</Text>
                    {errors.bannerImage && (
                      <Text tone="critical" variant="bodySm">{errors.bannerImage}</Text>
                    )}
                  </BlockStack>
                </FormLayout.Group>
              </FormLayout>
            </BlockStack>
          </Card>

          {/* Card 3 — Options */}
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Bundle Options</Text>
              <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
                <Card>
                  <InlineStack gap="200" blockAlign="start">
                    <ToggleSwitch checked={options.isGiftBox} onChange={() => toggleOption("isGiftBox")} showStateText={false} />
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" fontWeight="semibold">Enable Gift Box Option</Text>
                      <Text as="p" variant="bodySm" tone="subdued">Enables gift packaging option</Text>
                    </BlockStack>
                  </InlineStack>
                </Card>
                <Card>
                  <InlineStack gap="200" blockAlign="start">
                    <ToggleSwitch checked={options.giftMessageEnabled} onChange={() => toggleOption("giftMessageEnabled")} disabled={!options.isGiftBox} showStateText={false} />
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" fontWeight="semibold">Enable Gift Message Field</Text>
                      <Text as="p" variant="bodySm" tone="subdued">Show text area for gift message</Text>
                    </BlockStack>
                  </InlineStack>
                </Card>
                <Card>
                  <InlineStack gap="200" blockAlign="start">
                    <ToggleSwitch checked={options.allowDuplicates} onChange={() => toggleOption("allowDuplicates")} showStateText={false} />
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" fontWeight="semibold">Allow Duplicate Products</Text>
                      <Text as="p" variant="bodySm" tone="subdued">Same product in multiple slots</Text>
                    </BlockStack>
                  </InlineStack>
                </Card>
              </InlineGrid>
              {(optionValidationMessage || errors.giftMessageEnabled) && (
                <Text tone="critical" variant="bodySm">
                  {errors.giftMessageEnabled || optionValidationMessage}
                </Text>
              )}
            </BlockStack>
          </Card>

          {/* Card 4 — Scope */}
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Display Scope</Text>
              <BlockStack gap="200">
                <Text as="label" variant="bodySm" fontWeight="semibold">Choose Display Scope</Text>
                <Select
                  label="Choose Display Scope"
                  labelHidden
                  options={[
                    { value: "wholestore", label: "HolaStore" },
                    { value: "specific_collections", label: "Select Collections" },
                    { value: "specific_products", label: "Select Products" },
                  ]}
                  value={scope}
                  onChange={selectScope}
                />
              </BlockStack>

              <InlineStack gap="300" blockAlign="center">
                {scope === "wholestore" ? (
                  <Text variant="bodySm">All store products will be available in this combo.</Text>
                ) : (
                  <>
                    <Button
                      onClick={() => { setScopeSearch(""); setShowScopePicker(true); if (clientErrors.scopeItems) setClientErrors((p) => ({ ...p, scopeItems: "" })); }}
                    >
                      {scope === "specific_collections" ? "Choose Collections" : "Select Products"}
                    </Button>
                    <Text variant="bodySm" tone="subdued">{scopeItems.length} selected</Text>
                  </>
                )}
              </InlineStack>

              {clientErrors.scopeItems && (
                <Text tone="critical" variant="bodySm" role="alert">{clientErrors.scopeItems}</Text>
              )}

              {scope !== "wholestore" && scopeItems.length > 0 && (
                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {scopeItems.map((item) => (
                      <div
                        key={item.id}
                        onClick={() => setScopeItems((prev) => prev.filter((i) => i.id !== item.id))}
                        style={{ cursor: "pointer" }}
                      >
                        <Badge>{item.title} ×</Badge>
                      </div>
                    ))}
                  </div>
                </Box>
              )}
            </BlockStack>
          </Card>
        </BlockStack>
      </Form>
    </Page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

