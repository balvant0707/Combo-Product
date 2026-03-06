import { useState, useMemo } from "react";
import { useLoaderData, useFetcher, Form, useActionData, useNavigation } from "react-router";
import { redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getBox, updateBox, deleteBox, getBannerImageSrc } from "../models/boxes.server";

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

const MAX_BANNER_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_BANNER_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

async function parseBannerImage(formData, errors) {
  const file = formData.get("bannerImage");

  if (!file || typeof file !== "object" || typeof file.arrayBuffer !== "function" || !file.size) {
    return null;
  }

  if (!ALLOWED_BANNER_MIME_TYPES.has(file.type)) {
    errors.bannerImage = "Only JPG, PNG, WEBP, GIF, and AVIF files are allowed";
    return null;
  }

  if (file.size > MAX_BANNER_IMAGE_SIZE) {
    errors.bannerImage = "Banner image must be 5MB or smaller";
    return null;
  }

  return {
    bytes: new Uint8Array(await file.arrayBuffer()),
    mimeType: file.type,
    fileName: file.name || null,
  };
}

export const loader = async ({ request, params }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const box = await getBox(params.id, shop);
  if (!box) throw redirect("/app/boxes");
  const bannerImageSrc = getBannerImageSrc(box);
  const boxWithoutBinary = { ...box };
  delete boxWithoutBinary.bannerImageData;
  delete boxWithoutBinary.bannerImageMimeType;
  delete boxWithoutBinary.bannerImageFileName;

  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";
  const searchQuery = query ? `${query} NOT vendor:ComboBuilder` : 'NOT vendor:ComboBuilder';
  const resp = await admin.graphql(PRODUCTS_QUERY, {
    variables: { first: 50, query: searchQuery },
  });
  const json = await resp.json();
  const products = (json?.data?.products?.edges || []).map(({ node }) => ({
    id: node.id,
    title: node.title,
    handle: node.handle,
    imageUrl: node.featuredImage?.url || null,
    variantIds: (node.variants?.edges || []).map(({ node: variantNode }) => variantNode.id),
    variantId: node.variants?.edges?.[0]?.node?.id || null,
    price: node.variants?.edges?.[0]?.node?.price || "0",
  }));

  return {
    box: {
      ...boxWithoutBinary,
      bundlePrice: parseFloat(box.bundlePrice),
      bannerImageSrc,
    },
    products,
  };
};

export const action = async ({ request, params }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("_action");

  if (intent === "delete") {
    await deleteBox(params.id, shop, admin);
    throw redirect("/app/boxes");
  }

  let eligibleProducts = [];
  try {
    eligibleProducts = JSON.parse(formData.get("eligibleProducts") || "[]");
  } catch {}
  const errors = {};
  const bannerImage = await parseBannerImage(formData, errors);
  const removeBannerImage =
    formData.get("removeBannerImage") === "true" && !bannerImage;

  const data = {
    boxName: formData.get("boxName"),
    displayTitle: formData.get("displayTitle"),
    itemCount: formData.get("itemCount"),
    bundlePrice: formData.get("bundlePrice"),
    bundlePriceType: formData.get("bundlePriceType"),
    isGiftBox: formData.get("isGiftBox") === "true",
    allowDuplicates: formData.get("allowDuplicates") === "true",
    bannerImage,
    removeBannerImage,
    isActive: formData.get("isActive") === "true",
    giftMessageEnabled: formData.get("giftMessageEnabled") === "true",
    eligibleProducts,
  };
  if (!data.boxName?.trim()) errors.boxName = "Box name is required";
  if (!data.displayTitle?.trim()) errors.displayTitle = "Display title is required";
  if (!data.itemCount || parseInt(data.itemCount) < 1) errors.itemCount = "Invalid item count";
  if (!data.bundlePrice || parseFloat(data.bundlePrice) <= 0) errors.bundlePrice = "Invalid price";
  if (eligibleProducts.length === 0) errors.eligibleProducts = "Select at least one product";

  if (Object.keys(errors).length > 0) return { errors };

  try {
    await updateBox(params.id, shop, data, admin);
  } catch (e) {
    console.error("[app.boxes.$id] updateBox error:", e);
    return { errors: { _global: "Failed to save changes. Please try again." } };
  }

  throw redirect("/app/boxes");
};

const fieldStyle = {
  width: "100%",
  padding: "9px 12px",
  border: "1.5px solid #e5e7eb",
  borderRadius: "5px",
  fontSize: "13px",
  color: "#111827",
  background: "#fff",
  boxSizing: "border-box",
  outline: "none",
  transition: "border-color 0.15s",
};

const labelStyle = {
  display: "block",
  fontSize: "11px",
  fontWeight: "700",
  color: "#4b5563",
  marginBottom: "6px",
  textTransform: "uppercase",
  letterSpacing: "0.6px",
};

const errorStyle = { color: "#dc2626", fontSize: "11px", marginTop: "5px", display: "flex", alignItems: "center", gap: "4px" };

export default function EditBoxPage() {
  const { box, products } = useLoaderData();
  const actionData = useActionData();
  const searchFetcher = useFetcher();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const errors = actionData?.errors || {};

  const productLookup = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );

  const initialSelected = useMemo(
    () =>
      (box.products || []).map((p) => {
        const matched = productLookup.get(p.productId);
        let variantIds = [];
        if (Array.isArray(p.variantIds)) {
          variantIds = p.variantIds;
        } else if (typeof p.variantIds === "string" && p.variantIds.trim()) {
          try {
            const parsed = JSON.parse(p.variantIds);
            if (Array.isArray(parsed)) variantIds = parsed;
          } catch {
            variantIds = [];
          }
        }
        if (variantIds.length === 0) {
          variantIds =
            Array.isArray(matched?.variantIds) && matched.variantIds.length > 0
              ? matched.variantIds
              : (matched?.variantId ? [matched.variantId] : []);
        }

        return {
          id: p.productId,
          productId: p.productId,
          productTitle: p.productTitle || matched?.title || "",
          productImageUrl: p.productImageUrl || matched?.imageUrl || null,
          productHandle: p.productHandle || matched?.handle || null,
          variantIds,
          price: parseFloat(matched?.price) || parseFloat(p.productPrice) || 0,
        };
      }),
    [box.products, productLookup],
  );

  const [selectedProducts, setSelectedProducts] = useState(initialSelected);
  const [productSearch, setProductSearch] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [options, setOptions] = useState({
    isGiftBox: box.isGiftBox,
    allowDuplicates: box.allowDuplicates,
    giftMessageEnabled: box.giftMessageEnabled,
    isActive: box.isActive,
  });

  const [itemCount, setItemCount] = useState(String(box.itemCount));
  const [priceMode, setPriceMode] = useState(box.bundlePriceType || "manual");
  const [manualPrice, setManualPrice] = useState(String(box.bundlePrice));
  const [discountType, setDiscountType] = useState("percent");
  const [discountValue, setDiscountValue] = useState("10");

  const displayProducts =
    searchFetcher.data?.products ||
    (productSearch
      ? products.filter((p) => p.title.toLowerCase().includes(productSearch.toLowerCase()))
      : products);

  const numItemCount = Math.max(1, parseInt(itemCount) || 1);
  const avgProductPrice =
    selectedProducts.length > 0
      ? selectedProducts.reduce((s, p) => s + (parseFloat(p.price) || 0), 0) / selectedProducts.length
      : 0;
  const estimatedTotal = avgProductPrice * numItemCount;

  const dynamicPrice = useMemo(() => {
    if (estimatedTotal <= 0) return 0;
    const val = parseFloat(discountValue) || 0;
    if (discountType === "percent") return Math.max(0, estimatedTotal * (1 - val / 100));
    if (discountType === "fixed") return Math.max(0, estimatedTotal - val);
    return estimatedTotal;
  }, [estimatedTotal, discountType, discountValue]);

  const bundlePrice = priceMode === "manual" ? parseFloat(manualPrice) || 0 : dynamicPrice;

  function handleSearchChange(e) {
    const val = e.target.value;
    setProductSearch(val);
    if (val.length > 1) {
      searchFetcher.load(`/app/boxes/${box.id}?q=${encodeURIComponent(val)}`);
    } else if (val.length === 0) {
      searchFetcher.load(`/app/boxes/${box.id}`);
    }
  }

  function toggleProduct(product) {
    setSelectedProducts((prev) => {
      const exists = prev.find((p) => p.id === product.id);
      if (exists) return prev.filter((p) => p.id !== product.id);
      return [
        ...prev,
        {
          id: product.id,
          productId: product.id,
          productTitle: product.title,
          productImageUrl: product.imageUrl,
          productHandle: product.handle,
          variantIds:
            Array.isArray(product.variantIds) && product.variantIds.length > 0
              ? product.variantIds
              : (product.variantId ? [product.variantId] : []),
          price: parseFloat(product.price) || 0,
        },
      ];
    });
  }

  function toggleOption(name) {
    setOptions((prev) => ({ ...prev, [name]: !prev[name] }));
  }

  const isSelected = (id) => selectedProducts.some((p) => p.id === id);

  function openPicker() {
    setProductSearch("");
    searchFetcher.load(`/app/boxes/${box.id}`);
    setShowPicker(true);
  }

  function closePicker() {
    setShowPicker(false);
    setProductSearch("");
  }

  const sectionHeadingStyle = {
    fontSize: "11px",
    fontWeight: "700",
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: "0.8px",
    marginBottom: "16px",
    paddingBottom: "10px",
    borderBottom: "1.5px solid #f3f4f6",
    display: "flex",
    alignItems: "center",
    gap: "8px",
  };

  return (
    <s-page heading={`Edit: ${box.boxName}`} back-url="/app/boxes">
      {/* Header — Save Changes (primary) */}
      <s-button
        slot="primary-action"
        variant="primary"
        disabled={isSaving || undefined}
        onClick={() => {
          const form = document.getElementById("edit-box-form");
          if (form) form.requestSubmit();
        }}
      >
        {isSaving ? "Saving..." : "Save Changes"}
      </s-button>

      {errors._global && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "5px", padding: "12px 16px", marginBottom: "16px", color: "#991b1b", fontSize: "13px", display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "16px" }}>⚠</span>
          {errors._global}
        </div>
      )}

      <s-section>
        <Form id="edit-box-form" method="POST" encType="multipart/form-data">
          <input type="hidden" name="_action" value="save" />
          <input type="hidden" name="bundlePrice" value={bundlePrice > 0 ? bundlePrice.toFixed(2) : ""} />
          <input type="hidden" name="bundlePriceType" value={priceMode} />
          <input type="hidden" name="itemCount" value={itemCount} />
          <input type="hidden" name="eligibleProducts" value={JSON.stringify(selectedProducts)} />
          <input type="hidden" name="isGiftBox" value={String(options.isGiftBox)} />
          <input type="hidden" name="allowDuplicates" value={String(options.allowDuplicates)} />
          <input type="hidden" name="giftMessageEnabled" value={String(options.giftMessageEnabled)} />
          <input type="hidden" name="isActive" value={String(options.isActive)} />

          {/* ── Basic Information ── */}
          <div style={{ marginBottom: "28px" }}>
            <div style={sectionHeadingStyle}>
              <span style={{ fontSize: "15px" }}>📋</span> Basic Information
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>

              <div>
                <label style={labelStyle}>Box Internal Name *</label>
                <input
                  type="text"
                  name="boxName"
                  defaultValue={box.boxName}
                  style={{ ...fieldStyle, borderColor: errors.boxName ? "#e11d48" : "#d1d5db" }}
                />
                {errors.boxName && <div style={errorStyle}>{errors.boxName}</div>}
              </div>

              <div>
                <label style={labelStyle}>Display Title (Storefront) *</label>
                <input
                  type="text"
                  name="displayTitle"
                  defaultValue={box.displayTitle}
                  style={{ ...fieldStyle, borderColor: errors.displayTitle ? "#e11d48" : "#d1d5db" }}
                />
                {errors.displayTitle && <div style={errorStyle}>{errors.displayTitle}</div>}
              </div>

              <div>
                <label style={labelStyle}>Number of Items *</label>
                <input
                  type="number"
                  placeholder="e.g. 4"
                  min="1"
                  max="20"
                  value={itemCount}
                  onChange={(e) => setItemCount(e.target.value)}
                  style={{ ...fieldStyle, borderColor: errors.itemCount ? "#e11d48" : "#d1d5db" }}
                />
                {errors.itemCount && <div style={errorStyle}>{errors.itemCount}</div>}
              </div>

              {/* Bundle Price */}
              <div>
                <label style={labelStyle}>Bundle Price (₹) *</label>
                <div
                  style={{
                    display: "flex",
                    border: "1px solid #d1d5db",
                    borderRadius: "5px",
                    overflow: "hidden",
                    marginBottom: "10px",
                  }}
                >
                  {["manual", "dynamic"].map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setPriceMode(mode)}
                      style={{
                        flex: 1,
                        padding: "7px 0",
                        fontSize: "12px",
                        fontWeight: "600",
                        border: "none",
                        cursor: "pointer",
                        background: priceMode === mode ? "#2A7A4F" : "#f9fafb",
                        color: priceMode === mode ? "#fff" : "#374151",
                        transition: "background 0.15s",
                      }}
                    >
                      {mode === "manual" ? "Manual" : "Dynamic"}
                    </button>
                  ))}
                </div>

                {priceMode === "manual" && (
                  <input
                    type="number"
                    placeholder="e.g. 1200"
                    min="0"
                    step="0.01"
                    value={manualPrice}
                    onChange={(e) => setManualPrice(e.target.value)}
                    style={{ ...fieldStyle, borderColor: errors.bundlePrice ? "#e11d48" : "#d1d5db" }}
                  />
                )}

                {priceMode === "dynamic" && (
                  <div style={{ border: "1px solid #d1d5db", borderRadius: "5px", padding: "12px", background: "#f9fafb" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
                      <div>
                        <label style={{ ...labelStyle, fontSize: "10px" }}>Discount Type</label>
                        <select
                          value={discountType}
                          onChange={(e) => setDiscountType(e.target.value)}
                          style={{ ...fieldStyle, fontSize: "12px" }}
                        >
                          <option value="percent">% Off Total</option>
                          <option value="fixed">₹ Fixed Discount</option>
                          <option value="none">No Discount</option>
                        </select>
                      </div>
                      {discountType !== "none" && (
                        <div>
                          <label style={{ ...labelStyle, fontSize: "10px" }}>
                            {discountType === "percent" ? "Discount %" : "Amount (₹)"}
                          </label>
                          <input
                            type="number"
                            min="0"
                            step={discountType === "percent" ? "1" : "0.01"}
                            max={discountType === "percent" ? "99" : undefined}
                            value={discountValue}
                            onChange={(e) => setDiscountValue(e.target.value)}
                            style={{ ...fieldStyle, fontSize: "12px" }}
                          />
                        </div>
                      )}
                    </div>
                    {selectedProducts.filter((p) => p.price > 0).length === 0 && (
                      <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "8px", textAlign: "center" }}>
                        Re-select products from the picker to load their prices
                      </div>
                    )}
                  </div>
                )}

                {errors.bundlePrice && <div style={errorStyle}>{errors.bundlePrice}</div>}
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <label style={labelStyle}>Banner Image (optional)</label>
                <input
                  type="file"
                  name="bannerImage"
                  accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                  style={{ ...fieldStyle, padding: "7px 12px" }}
                />
                {box.bannerImageSrc && (
                  <div style={{ marginTop: "10px" }}>
                    <img
                      src={box.bannerImageSrc}
                      alt="Current banner"
                      style={{ width: "100%", maxWidth: "360px", borderRadius: "5px", border: "1px solid #e5e7eb" }}
                    />
                  </div>
                )}
                <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#6b7280", marginTop: "8px" }}>
                  <input type="checkbox" name="removeBannerImage" value="true" style={{ accentColor: "#dc2626" }} />
                  Remove current image
                </label>
                <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "5px" }}>
                  JPG, PNG, WEBP, GIF, or AVIF — max 5MB
                </div>
                {errors.bannerImage && <div style={errorStyle}>{errors.bannerImage}</div>}
              </div>
            </div>
          </div>

          {/* ── Options ── */}
          <div style={{ marginBottom: "28px" }}>
            <div style={sectionHeadingStyle}>
              <span style={{ fontSize: "15px" }}>⚙️</span> Options
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              {[
                { key: "isGiftBox", label: "Gift Box Mode", desc: "Enables gift packaging option", icon: "🎁" },
                { key: "allowDuplicates", label: "Allow Duplicates", desc: "Same product in multiple slots", icon: "🔁" },
                { key: "giftMessageEnabled", label: "Gift Message Field", desc: "Show text area for gift message", icon: "✉️" },
                { key: "isActive", label: "Active on Storefront", desc: "Uncheck to hide from customers", icon: "✅" },
              ].map((opt) => (
                <label
                  key={opt.key}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "10px",
                    cursor: "pointer",
                    padding: "12px 14px",
                    border: options[opt.key] ? "1.5px solid #86efac" : "1.5px solid #e5e7eb",
                    borderRadius: "6px",
                    background: options[opt.key] ? "#f0fdf4" : "#fafafa",
                    transition: "border-color 0.15s, background 0.15s",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={options[opt.key]}
                    onChange={() => toggleOption(opt.key)}
                    style={{ marginTop: "3px", width: "14px", height: "14px", accentColor: "#2A7A4F", flexShrink: 0 }}
                  />
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: "600", color: "#111827", display: "flex", alignItems: "center", gap: "5px" }}>
                      <span>{opt.icon}</span> {opt.label}
                    </div>
                    <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "2px" }}>{opt.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* ── Eligible Products ── */}
          <div style={{ marginBottom: "28px" }}>
            <div style={sectionHeadingStyle}>
              <span style={{ fontSize: "15px" }}>🛍️</span> Eligible Products
              {selectedProducts.length > 0 && (
                <span style={{ marginLeft: "6px", background: "#2A7A4F", color: "#fff", borderRadius: "4px", padding: "2px 8px", fontSize: "10px", fontWeight: "700", fontFamily: "monospace" }}>
                  {selectedProducts.length} selected
                </span>
              )}
            </div>

            {errors.eligibleProducts && (
              <div style={{ color: "#e11d48", fontSize: "12px", marginBottom: "10px", padding: "8px 12px", background: "#fff5f5", borderRadius: "4px", border: "1px solid #fecaca" }}>
                {errors.eligibleProducts}
              </div>
            )}

            {/* Selected product chips */}
            {selectedProducts.length > 0 && (
              <div style={{ marginBottom: "12px", padding: "12px 14px", background: "#f0fdf4", borderRadius: "5px", border: "1px solid #bbf7d0" }}>
                <div style={{ fontSize: "10px", fontWeight: "700", color: "#15803d", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.6px" }}>
                  Selected Products
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {selectedProducts.map((p) => (
                    <span
                      key={p.id}
                      onClick={() => toggleProduct(p)}
                      style={{
                        background: "#2A7A4F",
                        color: "#fff",
                        borderRadius: "4px",
                        padding: "4px 10px",
                        fontSize: "12px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "5px",
                        fontWeight: "500",
                      }}
                    >
                      {p.productTitle}
                      <span style={{ opacity: 0.75, fontSize: "10px" }}>✕</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Open picker button */}
            <button
              type="button"
              onClick={openPicker}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "10px 18px",
                background: "#fff",
                border: "1.5px dashed #d1d5db",
                borderRadius: "5px",
                fontSize: "13px",
                fontWeight: "600",
                color: "#2A7A4F",
                cursor: "pointer",
                width: "100%",
                justifyContent: "center",
                transition: "border-color 0.15s, background 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#2A7A4F"; e.currentTarget.style.background = "#f0fdf4"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#d1d5db"; e.currentTarget.style.background = "#fff"; }}
            >
              <span style={{ fontSize: "16px" }}>+</span>
              {selectedProducts.length > 0 ? "Edit Product Selection" : "Select Eligible Products"}
            </button>
          </div>

        </Form>

          {/* ── Delete Action ── */}
          <div style={{ paddingTop: "18px", borderTop: "1.5px solid #f3f4f6" }}>
            <Form method="POST" id="delete-box-form">
              <input type="hidden" name="_action" value="delete" />
              <button
                type="submit"
                onClick={(e) => {
                  if (!window.confirm(`Delete "${box.boxName}"? This cannot be undone.`)) e.preventDefault();
                }}
                style={{
                  background: "#fff5f5",
                  border: "1.5px solid #fecaca",
                  borderRadius: "5px",
                  padding: "9px 18px",
                  fontSize: "13px",
                  fontWeight: "500",
                  cursor: "pointer",
                  color: "#dc2626",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#fee2e2")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#fff5f5")}
              >
                Delete Box
              </button>
            </Form>
          </div>
      </s-section>

      {/* ── Product Picker Modal ── */}
      {showPicker && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(17,24,39,0.55)",
            backdropFilter: "blur(3px)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) closePicker(); }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: "8px",
              width: "100%",
              maxWidth: "560px",
              maxHeight: "85vh",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 20px 60px rgba(0,0,0,0.18), 0 4px 16px rgba(0,0,0,0.1)",
              overflow: "hidden",
            }}
          >
            {/* Modal header */}
            <div
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid #f3f4f6",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "#fafafa",
              }}
            >
              <div>
                <div style={{ fontSize: "15px", fontWeight: "700", color: "#111827" }}>Select Products</div>
                <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "2px" }}>
                  {selectedProducts.length} product{selectedProducts.length !== 1 ? "s" : ""} selected
                </div>
              </div>
              <button
                type="button"
                onClick={closePicker}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "18px",
                  color: "#9ca3af",
                  padding: "4px 8px",
                  borderRadius: "4px",
                  lineHeight: 1,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#f3f4f6"; e.currentTarget.style.color = "#374151"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "#9ca3af"; }}
              >
                ✕
              </button>
            </div>

            {/* Search */}
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6" }}>
              <input
                type="text"
                placeholder="Search products..."
                value={productSearch}
                onChange={handleSearchChange}
                autoFocus
                style={{ ...fieldStyle, borderColor: "#d1d5db", paddingLeft: "14px", fontSize: "13px" }}
              />
            </div>

            {/* Product list */}
            <div style={{ flex: 1, overflowY: "auto" }}>
              {displayProducts.length === 0 ? (
                <div style={{ padding: "40px 20px", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>
                  No products found
                </div>
              ) : (
                displayProducts.map((product, idx) => {
                  const selected = isSelected(product.id);
                  return (
                    <label
                      key={product.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        padding: "10px 16px",
                        borderBottom: idx < displayProducts.length - 1 ? "1px solid #f3f4f6" : "none",
                        cursor: "pointer",
                        background: selected ? "#f0fdf4" : "#fff",
                        transition: "background 0.1s",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleProduct(product)}
                        style={{ width: "15px", height: "15px", flexShrink: 0, accentColor: "#2A7A4F" }}
                      />
                      {product.imageUrl ? (
                        <img
                          src={product.imageUrl}
                          alt={product.title}
                          style={{ width: "40px", height: "40px", objectFit: "cover", borderRadius: "4px", flexShrink: 0, border: "1px solid #e5e7eb" }}
                        />
                      ) : (
                        <div style={{ width: "40px", height: "40px", borderRadius: "4px", background: "#f3f4f6", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", border: "1px solid #e5e7eb" }}>
                          📦
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "13px", fontWeight: "600", color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {product.title}
                        </div>
                        <div style={{ fontSize: "11px", color: "#9ca3af", fontFamily: "monospace" }}>{product.handle}</div>
                      </div>
                      {product.price && parseFloat(product.price) > 0 && (
                        <div style={{ fontSize: "13px", fontWeight: "700", color: "#374151", fontFamily: "monospace", flexShrink: 0 }}>
                          ₹{parseFloat(product.price).toLocaleString("en-IN")}
                        </div>
                      )}
                      {selected && (
                        <span style={{ width: "18px", height: "18px", background: "#2A7A4F", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <span style={{ color: "#fff", fontSize: "10px", fontWeight: "700" }}>✓</span>
                        </span>
                      )}
                    </label>
                  );
                })
              )}
            </div>

            {/* Modal footer */}
            <div
              style={{
                padding: "14px 16px",
                borderTop: "1px solid #f3f4f6",
                background: "#fafafa",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "10px",
              }}
            >
              <span style={{ fontSize: "12px", color: "#6b7280" }}>
                {selectedProducts.length > 0
                  ? `${selectedProducts.length} product${selectedProducts.length !== 1 ? "s" : ""} selected`
                  : "No products selected"}
              </span>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  onClick={closePicker}
                  style={{
                    background: "#fff",
                    border: "1.5px solid #d1d5db",
                    borderRadius: "5px",
                    padding: "8px 16px",
                    fontSize: "13px",
                    fontWeight: "500",
                    cursor: "pointer",
                    color: "#374151",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f9fafb")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={closePicker}
                  style={{
                    background: "#2A7A4F",
                    border: "none",
                    borderRadius: "5px",
                    padding: "8px 20px",
                    fontSize: "13px",
                    fontWeight: "700",
                    cursor: "pointer",
                    color: "#fff",
                    boxShadow: "0 1px 6px rgba(42,122,79,0.35)",
                  }}
                >
                  Done{selectedProducts.length > 0 ? ` (${selectedProducts.length})` : ""}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};

