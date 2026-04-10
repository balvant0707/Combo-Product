import { useState, useRef, useCallback } from "react";
import { Form, useActionData, useLoaderData, useLocation, useNavigation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { createBox } from "../models/boxes.server";
import { getShopCurrencyCode } from "../models/shop.server";
import { withEmbeddedAppParams, withEmbeddedAppToastFromRequest } from "../utils/embedded-app";
import { getCurrencySymbol } from "../utils/currency";
import { ToggleSwitch } from "../components/toggle-switch";
import {
  Badge, Banner, BlockStack, Box, Button, Card, Checkbox,
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
  const scopeType = formData.get("scope") || "specific_collections";
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
  if (!data.itemCount || parseInt(data.itemCount) < 1 || parseInt(data.itemCount) > 20)
    errors.itemCount = "Item count must be between 1 and 20";
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
  fontSize: "14px",
  boxSizing: "border-box",
  outline: "none",
  background: "#fff",
  color: "#111827",
};

const scopeOptions = [
  { value: "specific_collections", label: "Specific collections" },
  { value: "specific_products", label: "Specific products" },
  { value: "wholestore", label: "Whole store" },
];

export default function CreateBoxPage() {
  const { products, collections, currencyCode } = useLoaderData();
  const actionData = useActionData();
  const location = useLocation();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";
  const currencySymbol = getCurrencySymbol(currencyCode);

  const [scope, setScope] = useState("specific_collections");
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

  const numItemCount = Math.max(1, parseInt(itemCount) || 1);
  const estimatedTotal = 0;
  const dynamicPrice = (() => {
    if (estimatedTotal <= 0) return 0;
    const val = parseFloat(discountValue) || 0;
    if (discountType === "percent") return Math.max(0, estimatedTotal * (1 - val / 100));
    if (discountType === "fixed") return Math.max(0, estimatedTotal - val);
    return estimatedTotal;
  })();
  const bundlePrice = priceMode === "manual" ? parseFloat(manualPrice) || 0 : dynamicPrice;

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
      title="Create New Box"
      backAction={{ content: "Boxes", url: withEmbeddedAppParams("/app/boxes", location.search) }}
      primaryAction={{
        content: isSaving ? "Saving..." : "Save & Publish",
        loading: isSaving,
        onAction: () => document.getElementById("create-box-form")?.requestSubmit(),
      }}
    >
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
          <input type="hidden" name="giftMessageEnabled" value={String(options.giftMessageEnabled)} />
          <input type="hidden" name="isActive" value={String(options.isActive)} />

          <BlockStack gap="400">
            {/* Card 1 — Status */}
            <Card>
              <InlineStack align="space-between" blockAlign="start">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" fontWeight="semibold">Active on Storefront</Text>
                  <Text as="p" variant="bodySm" tone="subdued">Uncheck to hide this box from customers</Text>
                </BlockStack>
                <ToggleSwitch checked={options.isActive} onChange={() => toggleOption("isActive")} showStateText={false} />
              </InlineStack>
            </Card>

            {/* Card 2 — Basic Information */}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Basic Information</Text>
                <FormLayout>
                  <FormLayout.Group>
                    {/* Display Title */}
                    <BlockStack gap="100">
                      <label htmlFor="new-displayTitle" style={{ fontSize: "13px", fontWeight: "600", color: "#111827" }}>
                        Combo Box Heading <span aria-hidden="true">*</span>
                      </label>
                      <input
                        id="new-displayTitle"
                        type="text"
                        name="displayTitle"
                        placeholder="e.g. Build Your Perfect Snack Box"
                        aria-label="Combo box heading shown to customers on the storefront"
                        aria-required="true"
                        style={{
                          ...nativeInputStyle,
                          borderColor: errors.displayTitle ? "#e11d48" : "#e5e7eb",
                        }}
                      />
                      {errors.displayTitle && (
                        <Text tone="critical" variant="bodySm" role="alert">{errors.displayTitle}</Text>
                      )}
                    </BlockStack>

                    {/* Combo Product Button Title */}
                    <BlockStack gap="100">
                      <label htmlFor="new-comboBtn" style={{ fontSize: "13px", fontWeight: "600", color: "#111827" }}>
                        Combo Product Button Label
                      </label>
                      <input
                        id="new-comboBtn"
                        type="text"
                        name="comboProductButtonTitle"
                        placeholder="BUILD YOUR OWN BOX"
                        aria-label="Button label that opens the combo product builder"
                        style={nativeInputStyle}
                      />
                    </BlockStack>

                    {/* Product Button Title */}
                    <BlockStack gap="100">
                      <label htmlFor="new-productBtn" style={{ fontSize: "13px", fontWeight: "600", color: "#111827" }}>
                        Add to Cart Button Label
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
                  </FormLayout.Group>

                  <FormLayout.Group>
                    {/* Item Count */}
                    <BlockStack gap="100">
                      <label htmlFor="new-itemCount" style={{ fontSize: "13px", fontWeight: "600", color: "#111827" }}>
                        Number of Products <span aria-hidden="true">*</span>
                      </label>
                      <input
                        id="new-itemCount"
                        type="number"
                        placeholder="e.g. 4"
                        min="1"
                        max="20"
                        value={itemCount}
                        onChange={(e) => setItemCount(e.target.value)}
                        style={{
                          ...nativeInputStyle,
                          borderColor: errors.itemCount ? "#e11d48" : "#e5e7eb",
                        }}
                      />
                      {errors.itemCount && (
                        <Text tone="critical" variant="bodySm" role="alert">{errors.itemCount}</Text>
                      )}
                    </BlockStack>

                    {/* Bundle Price */}
                    <BlockStack gap="100">
                      <span style={{ fontSize: "13px", fontWeight: "600", color: "#111827" }}>
                        Bundle Price ({currencySymbol}) <span aria-hidden="true">*</span>
                      </span>
                      <InlineStack gap="0">
                        {["manual", "dynamic"].map((mode) => (
                          <Button
                            key={mode}
                            variant={priceMode === mode ? "primary" : "secondary"}
                            onClick={() => setPriceMode(mode)}
                            size="slim"
                          >
                            {mode === "manual" ? "Manual" : "Dynamic"}
                          </Button>
                        ))}
                      </InlineStack>
                      {priceMode === "manual" && (
                        <input
                          type="number"
                          placeholder="e.g. 1200"
                          min="0"
                          step="0.01"
                          value={manualPrice}
                          onChange={(e) => setManualPrice(e.target.value)}
                          style={nativeInputStyle}
                        />
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
                      <Text as="label" variant="bodySm" fontWeight="semibold">Banner Image (optional)</Text>
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
                  </FormLayout.Group>
                </FormLayout>
              </BlockStack>
            </Card>

            {/* Card 3 — Options */}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Options</Text>
                <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
                  <InlineStack align="space-between" blockAlign="start">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" fontWeight="semibold">Gift Box Mode</Text>
                      <Text as="p" variant="bodySm" tone="subdued">Shows gift wrapping option to customers</Text>
                    </BlockStack>
                    <ToggleSwitch checked={options.isGiftBox} onChange={() => toggleOption("isGiftBox")} showStateText={false} />
                  </InlineStack>
                  <InlineStack align="space-between" blockAlign="start">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" fontWeight="semibold">Gift Message Field</Text>
                      <Text as="p" variant="bodySm" tone="subdued">Show text area for gift message</Text>
                    </BlockStack>
                    <ToggleSwitch checked={options.giftMessageEnabled} onChange={() => toggleOption("giftMessageEnabled")} disabled={!options.isGiftBox} showStateText={false} />
                  </InlineStack>
                  <InlineStack align="space-between" blockAlign="start">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" fontWeight="semibold">Allow Duplicates</Text>
                      <Text as="p" variant="bodySm" tone="subdued">Same product can fill multiple slots</Text>
                    </BlockStack>
                    <ToggleSwitch checked={options.allowDuplicates} onChange={() => toggleOption("allowDuplicates")} showStateText={false} />
                  </InlineStack>
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
                <Text as="h2" variant="headingMd">Scope</Text>

                <BlockStack gap="200">
                  <Text as="label" variant="bodySm" fontWeight="semibold">Select Scope</Text>
                  <InlineStack gap="200">
                    {scopeOptions.map((opt) => (
                      <Button
                        key={opt.value}
                        variant={scope === opt.value ? "primary" : "secondary"}
                        onClick={() => selectScope(opt.value)}
                        size="slim"
                      >
                        {opt.label}
                      </Button>
                    ))}
                  </InlineStack>
                </BlockStack>

                <InlineStack gap="300" blockAlign="center">
                  {scope === "wholestore" ? (
                    <Text variant="bodySm">All store products will be available in this combo.</Text>
                  ) : (
                    <Button
                      onClick={() => { setScopeSearch(""); setShowScopePicker(true); }}
                    >
                      {scope === "specific_collections" ? "Select collections" : "Select products"}
                    </Button>
                  )}
                  {scope !== "wholestore" && (
                    <Text variant="bodySm" tone="subdued">{scopeItems.length} selected</Text>
                  )}
                </InlineStack>

                {scope !== "wholestore" && scopeItems.length > 0 && (
                  <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                    <InlineStack gap="200" wrap>
                      {scopeItems.map((item) => (
                        <Button
                          key={item.id}
                          size="slim"
                          variant="secondary"
                          onClick={() => setScopeItems((prev) => prev.filter((i) => i.id !== item.id))}
                        >
                          {item.title} ✕
                        </Button>
                      ))}
                    </InlineStack>
                  </Box>
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
            title={isCollections ? "Select Collections" : "Select Products"}
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
