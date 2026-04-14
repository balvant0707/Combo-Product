import { useState, useRef, useCallback, useEffect } from "react";
import { Form, useActionData, useLoaderData, useLocation, useNavigate, useNavigation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { createBox } from "../models/boxes.server";
import { getShopCurrencyCode } from "../models/shop.server";
import { withEmbeddedAppParams, withEmbeddedAppToastFromRequest } from "../utils/embedded-app";
import { getCurrencySymbol } from "../utils/currency";
import { ToggleSwitch } from "../components/toggle-switch";
import {
  Banner, BlockStack, Box, Button, Card, Checkbox,
  DropZone, FormLayout, InlineGrid, InlineStack, Layout, Modal, Page,
  Select, Spinner, Text, TextField
} from "@shopify/polaris";

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

const MAX_BANNER_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_BANNER_MIME_TYPES = new Set([
  "image/jpeg", "image/jpg", "image/png",
  "image/webp", "image/gif", "image/avif",
]);

async function parseBannerImage(formData, errors) {
  const file = formData.get("bannerImage");
  if (!file || typeof file !== "object" || typeof file.arrayBuffer !== "function" || !file.size) return null;
  if (!ALLOWED_BANNER_MIME_TYPES.has(file.type)) { errors.bannerImage = "Only JPG, PNG, WEBP, GIF, and AVIF files are allowed"; return null; }
  if (file.size > MAX_BANNER_IMAGE_SIZE) { errors.bannerImage = "Banner image must be 5MB or smaller"; return null; }
  return { bytes: new Uint8Array(await file.arrayBuffer()), mimeType: file.type, fileName: file.name || null };
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";
  const searchQuery = query ? `${query} NOT vendor:ComboBuilder` : "NOT vendor:ComboBuilder";
  const currencyCode = await getShopCurrencyCode(session.shop);

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

  return { products, collections, currencyCode };
};

export const action = async ({ request }) => {
  const { session, admin, redirect } = await authenticate.admin(request);
  const formData = await request.formData();

  let scopeItems = [];
  try { scopeItems = JSON.parse(formData.get("scopeItems") || "[]"); } catch {}
  let eligibleProducts = [];
  try { eligibleProducts = JSON.parse(formData.get("eligibleProducts") || "[]"); } catch {}

  const errors = {};
  const bannerImage = await parseBannerImage(formData, errors);
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
    isActive: formData.get("isActive") !== "false",
    giftMessageEnabled: formData.get("giftMessageEnabled") === "true",
    scopeType,
    scopeItems,
  };

  if (!data.displayTitle?.trim()) errors.displayTitle = "Display title is required";
  if (!data.itemCount || parseInt(data.itemCount, 10) < 1 || parseInt(data.itemCount, 10) > 8)
    errors.itemCount = "Item count must be between 1 and 8";
  if (data.giftMessageEnabled && !data.isGiftBox) {
    errors.giftMessageEnabled = "Enable Gift Box Mode to use Gift Message Field.";
  }

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
        console.error("[new box] Failed to expand collection:", col.id, e);
      }
    }
    data.eligibleProducts = allProds;
  } else if (scopeType === "specific_products" && eligibleProducts.length > 0) {
    data.eligibleProducts = eligibleProducts;
  } else if (scopeType === "wholestore") {
    data.eligibleProducts = [];
  }

  try {
    await createBox(session.shop, data, admin);
  } catch (e) {
    console.error("[app.boxes.new] createBox error:", e);
    const message = e instanceof Error && e.message ? e.message : "Failed to create box. Please try again.";
    return { errors: { _global: message } };
  }

  throw redirect(
    withEmbeddedAppToastFromRequest("/app/boxes", request, {
      message: "Configuration saved successfully.",
    }),
  );
};

const nativeInputStyle = {
  width: "100%",
  padding: "8px 12px",
  border: "1.5px solid #e5e7eb",
  borderRadius: "6px",
  fontFamily: "inherit",
  fontSize: "12px",
  boxSizing: "border-box",
  outline: "none",
  background: "#fff",
  color: "#111827",
};

const scopeOptions = [
  { value: "wholestore", label: "Whole Store" },
  { value: "specific_collections", label: "Select Collections" },
  { value: "specific_products", label: "Select Products" },
];

export default function CreateBoxPage() {
  const { products, collections, currencyCode } = useLoaderData();
  const actionData = useActionData();
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";
  const isPageLoading = navigation.state !== "idle";
  const currencySymbol = getCurrencySymbol(currencyCode);
  const [isBackNavigating, setIsBackNavigating] = useState(false);
  const [clientErrors, setClientErrors] = useState({});
  const [inlineToast, setInlineToast] = useState(null);

  const [scope, setScope] = useState("wholestore");
  const [scopeItems, setScopeItems] = useState([]);
  const [showScopePicker, setShowScopePicker] = useState(false);
  const [scopeSearch, setScopeSearch] = useState("");
  const [options, setOptions] = useState({
    isGiftBox: false, allowDuplicates: false, giftMessageEnabled: false, isActive: true,
  });
  const [optionValidationMessage, setOptionValidationMessage] = useState("");
  const [itemCount, setItemCount] = useState("4");
  const [priceMode, setPriceMode] = useState("manual");
  const [manualPrice, setManualPrice] = useState("");
  const [discountType, setDiscountType] = useState("percent");
  const [discountValue, setDiscountValue] = useState("10");
  const [buyQuantity, setBuyQuantity] = useState("1");
  const [getQuantity, setGetQuantity] = useState("1");
  const [bannerImagePreview, setBannerImagePreview] = useState(null);
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
  }, []);

  const errors = actionData?.errors || {};

  const numItemCount = Math.min(8, Math.max(1, parseInt(itemCount, 10) || 1));
  const estimatedTotal = 0;
  const dynamicPrice = (() => {
    if (estimatedTotal <= 0) return 0;
    const val = parseFloat(discountValue) || 0;
    if (discountType === "percent") return Math.max(0, estimatedTotal * (1 - val / 100));
    if (discountType === "fixed") return Math.max(0, estimatedTotal - val);
    return estimatedTotal;
  })();
  const bundlePrice = priceMode === "manual" ? parseFloat(manualPrice) || 0 : dynamicPrice;

  const [displayTitleValue, setDisplayTitleValue] = useState("");

  function showValidationToast(message) {
    if (!message) return;
    try {
      if (typeof window !== "undefined" && window.shopify?.toast?.show) {
        window.shopify.toast.show(message, { isError: true });
        return;
      }
    } catch {}
    setInlineToast({ message });
    setTimeout(() => setInlineToast(null), 3200);
  }

  useEffect(() => {
    const serverErrors = actionData?.errors || {};
    const firstServerMsg =
      serverErrors._global ||
      serverErrors.displayTitle ||
      serverErrors.itemCount ||
      serverErrors.bundlePrice ||
      serverErrors.scopeItems ||
      serverErrors.giftMessageEnabled ||
      serverErrors.bannerImage ||
      Object.values(serverErrors).find((v) => typeof v === "string");
    if (firstServerMsg) showValidationToast(firstServerMsg);
  }, [actionData]);

  function validateAndSubmit() {
    const errs = {};
    if (!displayTitleValue.trim()) errs.displayTitle = "Bundle title is required";
    const ic = parseInt(itemCount);
    if (!itemCount || isNaN(ic) || ic < 1 || ic > 8) errs.itemCount = "Item count must be between 1 and 8";
    if (priceMode === "manual" && (!manualPrice || parseFloat(manualPrice) <= 0)) errs.bundlePrice = "Bundle price is required";
    if ((scope === "specific_collections" || scope === "specific_products") && scopeItems.length === 0) errs.scopeItems = "Please select at least one " + (scope === "specific_collections" ? "collection" : "product");
    setClientErrors(errs);
    if (Object.keys(errs).length === 0) {
      document.getElementById("create-box-form")?.requestSubmit();
    } else {
      const firstErrKey = Object.keys(errs)[0];
      showValidationToast(errs[firstErrKey]);
      const fieldMap = { displayTitle: "new-displayTitle", itemCount: "new-itemCount" };
      if (fieldMap[firstErrKey]) document.getElementById(fieldMap[firstErrKey])?.focus();
    }
  }

  function handleBackAction() {
    setIsBackNavigating(true);
    navigate(withEmbeddedAppParams("/app/boxes", location.search));
  }

  function toggleOption(name) {
    setOptions((prev) => {
      if (name === "isGiftBox") {
        const nextIsGiftBox = !prev.isGiftBox;
        return { ...prev, isGiftBox: nextIsGiftBox, giftMessageEnabled: nextIsGiftBox };
      }
      if (name === "giftMessageEnabled") {
        return { ...prev, giftMessageEnabled: !!prev.isGiftBox };
      }
      return { ...prev, [name]: !prev[name] };
    });
    setOptionValidationMessage("");
  }

  function selectScope(nextScope) {
    if (!nextScope || nextScope === scope) return;
    setScope(nextScope);
    setScopeItems([]);
  }

  // Scope picker computed values (must be outside JSX conditional)
  const isCollections = scope === "specific_collections";
  const allScopeItems = isCollections ? collections : products;
  const filtered = scopeSearch.trim()
    ? allScopeItems.filter((i) => i.title.toLowerCase().includes(scopeSearch.toLowerCase()))
    : allScopeItems;
  const isScopeSelected = (id) => scopeItems.some((i) => i.id === id);
  function toggleScopeItem(item) {
    setScopeItems((prev) => prev.some((i) => i.id === item.id)
      ? prev.filter((i) => i.id !== item.id)
      : [...prev, item]
    );
  }

  return (
    <Page
      title="Create Simple Bundle Box"
      backAction={{ content: "Boxes", onAction: handleBackAction }}
      primaryAction={{
        content: isSaving ? "Saving..." : "Save & Publish",
        loading: isSaving,
        onAction: validateAndSubmit,
      }}
    >
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
      {inlineToast?.message && (
        <div
          role="alert"
          style={{
            position: "fixed",
            right: "18px",
            bottom: "18px",
            zIndex: 10020,
            background: "#111827",
            color: "#ffffff",
            padding: "10px 14px",
            borderRadius: "8px",
            fontSize: "13px",
            fontWeight: "600",
            boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
            maxWidth: "520px",
          }}
        >
          {inlineToast.message}
        </div>
      )}
      <BlockStack gap="500">
        {/* Error Banner */}
        {errors._global && (
          <Banner tone="critical" title="Error">
            <p>{errors._global}</p>
          </Banner>
        )}

        <Form id="create-box-form" method="POST" encType="multipart/form-data">
          {/* Hidden inputs for state-driven values */}
          <input type="hidden" name="bundlePrice" value={bundlePrice > 0 ? bundlePrice.toFixed(2) : ""} />
          <input type="hidden" name="bundlePriceType" value={priceMode} />
          <input type="hidden" name="discountType" value={priceMode === "dynamic" ? discountType : "none"} />
          <input type="hidden" name="discountValue" value={priceMode === "dynamic" ? (discountType === "none" ? "0" : discountValue) : "0"} />
          <input type="hidden" name="buyQuantity" value={priceMode === "dynamic" ? buyQuantity : "1"} />
          <input type="hidden" name="getQuantity" value={priceMode === "dynamic" ? getQuantity : "1"} />
          <input type="hidden" name="itemCount" value={itemCount} />
          <input type="hidden" name="scope" value={scope} />
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
          <input type="hidden" name="isGiftBox" value={String(options.isGiftBox)} />
          <input type="hidden" name="allowDuplicates" value={String(options.allowDuplicates)} />
          <input type="hidden" name="giftMessageEnabled" value={String(options.isGiftBox && options.giftMessageEnabled)} />
          <input type="hidden" name="isActive" value={String(options.isActive)} />

          <BlockStack gap="400">
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
                <BlockStack gap="300">
                  <InlineGrid columns={{ xs: 1, md: 3 }} gap="300">
                    {/* Display Title */}
                    <BlockStack gap="100">
                      <label htmlFor="new-displayTitle" style={{ fontSize: "13px", fontWeight: "600", color: "#111827" }}>
                        Bundle Title <span aria-hidden="true">*</span>
                      </label>
                      <input
                        id="new-displayTitle"
                        type="text"
                        name="displayTitle"
                        value={displayTitleValue}
                        onChange={(e) => {
                          setDisplayTitleValue(e.target.value);
                          if (clientErrors.displayTitle) setClientErrors((p) => ({ ...p, displayTitle: "" }));
                        }}
                        placeholder="e.g. Build Your Perfect Snack Box"
                        aria-label="Combo box heading shown to customers on the storefront"
                        aria-required="true"
                        style={{
                          ...nativeInputStyle,
                          borderColor: (clientErrors.displayTitle || errors.displayTitle) ? "#e11d48" : "#e5e7eb",
                        }}
                      />
                      {(clientErrors.displayTitle || errors.displayTitle) && (
                        <Text tone="critical" variant="bodySm" role="alert">{clientErrors.displayTitle || errors.displayTitle}</Text>
                      )}
                    </BlockStack>

                    {/* Bundle CTA Button Text */}
                    <BlockStack gap="100">
                      <label htmlFor="new-comboBtn" style={{ fontSize: "13px", fontWeight: "600", color: "#111827" }}>
                        Bundle CTA Button Text
                      </label>
                      <input
                        id="new-comboBtn"
                        type="text"
                        name="comboProductButtonTitle"
                        placeholder="Build your own box"
                        aria-label="Button label that opens the combo product builder"
                        style={nativeInputStyle}
                      />
                    </BlockStack>

                    {/* Add Bundle to Cart Button Text */}
                    <BlockStack gap="100">
                      <label htmlFor="new-productBtn" style={{ fontSize: "13px", fontWeight: "600", color: "#111827" }}>
                        Add Bundle Button Text
                      </label>
                      <input
                        id="new-productBtn"
                        type="text"
                        name="productButtonTitle"
                        placeholder="Add To Cart"
                        aria-label="Add to cart button label shown to customers"
                        style={nativeInputStyle}
                      />
                    </BlockStack>
                  </InlineGrid>

                  <InlineGrid columns={{ xs: 1, md: 3 }} gap="300">
                    {/* Item Count */}
                    <BlockStack gap="100">
                      <label htmlFor="new-itemCount" style={{ fontSize: "13px", fontWeight: "600", color: "#111827" }}>
                        Items Required in Bundle <span aria-hidden="true">*</span>
                      </label>
                      <input
                        id="new-itemCount"
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
                        style={{
                          ...nativeInputStyle,
                          borderColor: (clientErrors.itemCount || errors.itemCount) ? "#e11d48" : "#e5e7eb",
                        }}
                      />
                      {(clientErrors.itemCount || errors.itemCount) && (
                        <Text tone="critical" variant="bodySm" role="alert">{clientErrors.itemCount || errors.itemCount}</Text>
                      )}
                    </BlockStack>

                    {/* Bundle Price */}
                    <BlockStack gap="100">
                      <span style={{ fontSize: "13px", fontWeight: "600", color: "#111827" }}>
                        Bundle Pricing <span aria-hidden="true">*</span>
                      </span>
                      <InlineStack gap="0">
                        {["manual", "dynamic"].map((mode) => (
                          <Button
                            key={mode}
                            variant={priceMode === mode ? "primary" : "secondary"}
                            onClick={() => { setPriceMode(mode); if (clientErrors.bundlePrice) setClientErrors((p) => ({ ...p, bundlePrice: "" })); }}
                            size="slim"
                          >
                            {mode === "manual" ? "Fixed Price" : "Dynamic Price"}
                          </Button>
                        ))}
                      </InlineStack>
                      {priceMode === "manual" && (
                        <>
                        <input
                          type="number"
                          placeholder="e.g. 1200"
                          min="0"
                          step="0.01"
                          value={manualPrice}
                          onChange={(e) => { setManualPrice(e.target.value); if (clientErrors.bundlePrice) setClientErrors((p) => ({ ...p, bundlePrice: "" })); }}
                          style={{ ...nativeInputStyle, borderColor: clientErrors.bundlePrice ? "#e11d48" : "#e5e7eb" }}
                        />
                        {clientErrors.bundlePrice && <Text tone="critical" variant="bodySm" role="alert">{clientErrors.bundlePrice}</Text>}
                        </>
                      )}
                      {priceMode === "dynamic" && (
                        <BlockStack gap="200">
                          <InlineGrid columns={2} gap="200">
                            <BlockStack gap="100">
                              <Text as="label" variant="bodySm" fontWeight="semibold">Discount Type</Text>
                              <select
                                value={discountType}
                                onChange={(e) => setDiscountType(e.target.value)}
                                style={nativeInputStyle}
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
                                  style={nativeInputStyle}
                                />
                              </BlockStack>
                            )}
                          </InlineGrid>
                          <Text variant="bodySm" tone="subdued">
                            {discountType === "percent" || discountType === "fixed"
                              ? "Discount applied on total amount"
                              : "No discount applied"
                            }
                          </Text>
                        </BlockStack>
                      )}
                    </BlockStack>

                    {/* Banner Image */}
                    <BlockStack gap="100">
                      <Text as="label" variant="bodySm" fontWeight="semibold">Bundle Banner Image</Text>
                      <input type="file" ref={bannerImageRef} name="bannerImage" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" style={{ display: "none" }} />
                      {bannerImagePreview ? (
                        <div style={{ position: "relative", display: "inline-block", width: "120px" }}>
                          <img src={bannerImagePreview} alt="Banner preview" style={{ width: "120px", borderRadius: "6px", border: "1px solid #e5e7eb", display: "block" }} />
                          <button
                            type="button"
                            onClick={() => { setBannerImagePreview(null); if (bannerImageRef.current) bannerImageRef.current.value = ""; }}
                            style={{ position: "absolute", top: "4px", right: "4px", background: "rgba(0,0,0,0.65)", border: "none", borderRadius: "50%", width: "22px", height: "22px", cursor: "pointer", color: "#fff", fontSize: "14px", lineHeight: "22px", textAlign: "center", padding: 0 }}
                            aria-label="Remove image"
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

                  </InlineGrid>
                  <FormLayout.Group>
                     <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">Bundle Setup</Text>
                      <InlineGrid columns={scope === "wholestore" ? 1 : 2} gap="200">
                        <BlockStack gap="100">
                          <Text as="label" variant="bodySm" fontWeight="semibold">Choose Display Scope</Text>
                          <Select
                            label="Choose Display Scope"
                            labelHidden
                            options={scopeOptions}
                            value={scope}
                            onChange={selectScope}
                          />
                        </BlockStack>
                        {scope !== "wholestore" && (
                          <BlockStack gap="100">
                            <Text as="label" variant="bodySm" fontWeight="semibold">
                              {scope === "specific_collections" ? "Select Collections" : "Select Products"}
                            </Text>
                            <Button
                              variant="primary"
                              onClick={() => {
                                setScopeSearch("");
                                setShowScopePicker(true);
                                if (clientErrors.scopeItems) setClientErrors((p) => ({ ...p, scopeItems: "" }));
                              }}
                            >
                              {scope === "specific_collections" ? "Choose Collections" : "Select Products"}
                            </Button>
                          </BlockStack>
                        )}
                      </InlineGrid>

                      {scope === "wholestore" ? (
                        <Text variant="bodySm" tone="subdued">All store products will be available in this bundle.</Text>
                      ) : (
                        <Text variant="bodySm" tone="subdued">{scopeItems.length} selected</Text>
                      )}

                      {clientErrors.scopeItems && (
                        <Text tone="critical" variant="bodySm" role="alert">{clientErrors.scopeItems}</Text>
                      )}

                      {scope !== "wholestore" && scopeItems.length > 0 && (
                        <InlineStack gap="150" wrap>
                          {scopeItems.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => setScopeItems((prev) => prev.filter((i) => i.id !== item.id))}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "6px",
                                padding: "4px 10px",
                                background: "#e5e7eb",
                                border: "1px solid #d1d5db",
                                borderRadius: "5px",
                                color: "#374151",
                                cursor: "pointer",
                                fontSize: "12px",
                                fontWeight: 600,
                              }}
                            >
                              {item.title}
                              <span style={{ color: "#6b7280" }}>x</span>
                            </button>
                          ))}
                        </InlineStack>
                      )}
                    </BlockStack>
                  </FormLayout.Group>
                </BlockStack>
              </BlockStack>
            </Card>

            {/* Card 3 — Options */}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Bundle Options</Text>
                <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
                  <InlineStack gap="200" blockAlign="start">
                    <ToggleSwitch checked={options.isGiftBox} onChange={() => toggleOption("isGiftBox")} showStateText={false} />
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" fontWeight="semibold">Enable Gift Box Option</Text>
                      <Text as="p" variant="bodySm" tone="subdued">Shows gift wrapping option to customers</Text>
                    </BlockStack>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="start">
                    <ToggleSwitch checked={options.isGiftBox && options.giftMessageEnabled} onChange={() => toggleOption("giftMessageEnabled")} disabled={!options.isGiftBox} showStateText={false} />
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" fontWeight="semibold">Enable Gift Message Field</Text>
                      <Text as="p" variant="bodySm" tone="subdued">Show text area for gift message</Text>
                    </BlockStack>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="start">
                    <ToggleSwitch checked={options.allowDuplicates} onChange={() => toggleOption("allowDuplicates")} showStateText={false} />
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" fontWeight="semibold">Allow Duplicate Products</Text>
                      <Text as="p" variant="bodySm" tone="subdued">Same product can fill multiple slots</Text>
                    </BlockStack>
                  </InlineStack>
                </InlineGrid>
                {(optionValidationMessage || errors.giftMessageEnabled) && (
                  <Text tone="critical" variant="bodySm">
                    {errors.giftMessageEnabled || optionValidationMessage}
                  </Text>
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </Form>

        {/* Scope Picker Modal — product & collection picker */}
        {showScopePicker && scope !== "wholestore" && (
          <Modal
            open={showScopePicker}
            onClose={() => setShowScopePicker(false)}
            title={isCollections ? "Choose Collections" : "Choose Products"}
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
                            <img
                              src={item.imageUrl}
                              alt={item.title}
                              style={{ width: "40px", height: "40px", objectFit: "cover", borderRadius: "5px", flexShrink: 0, border: "1px solid #e5e7eb" }}
                            />
                          ) : (
                            <div style={{ width: "40px", height: "40px", borderRadius: "5px", background: "#f3f4f6", flexShrink: 0, border: "1px solid #e5e7eb" }} />
                          )}
                          <Text
                            variant="bodyMd"
                            fontWeight={selected ? "semibold" : "regular"}
                            as="span"
                          >
                            {item.title}
                          </Text>
                        </div>
                      );
                    })}
                  </BlockStack>
                )}
              </BlockStack>
            </Modal.Section>
          </Modal>
        )}
      </BlockStack>
    </Page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}


