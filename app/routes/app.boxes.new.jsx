import { useState } from "react";
import { Form, useActionData, useFetcher, useLoaderData, useLocation, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { createBox } from "../models/boxes.server";
import { withEmbeddedAppParams } from "../utils/embedded-app";

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

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
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
  return { products };
};

export const action = async ({ request }) => {
  const { session, admin, redirect } = await authenticate.admin(request);
  const formData = await request.formData();

  let eligibleProducts = [];
  try {
    eligibleProducts = JSON.parse(formData.get("eligibleProducts") || "[]");
  } catch {}
  const errors = {};
  const bannerImage = await parseBannerImage(formData, errors);

  const data = {
    boxName: formData.get("boxName"),
    displayTitle: formData.get("displayTitle"),
    itemCount: formData.get("itemCount"),
    bundlePrice: formData.get("bundlePrice"),
    bundlePriceType: formData.get("bundlePriceType"),
    isGiftBox: formData.get("isGiftBox") === "true",
    allowDuplicates: formData.get("allowDuplicates") === "true",
    bannerImage,
    isActive: formData.get("isActive") !== "false",
    giftMessageEnabled: formData.get("giftMessageEnabled") === "true",
    eligibleProducts,
  };
  if (!data.boxName?.trim()) errors.boxName = "Box name is required";
  if (!data.displayTitle?.trim()) errors.displayTitle = "Display title is required";
  if (!data.itemCount || parseInt(data.itemCount) < 1 || parseInt(data.itemCount) > 20)
    errors.itemCount = "Item count must be between 1 and 20";
  if (!data.bundlePrice || parseFloat(data.bundlePrice) <= 0) {
    errors.bundlePrice = data.bundlePriceType === "dynamic"
      ? "Select products above so the dynamic price can be calculated"
      : "Bundle price must be greater than 0";
  }
  if (eligibleProducts.length === 0)
    errors.eligibleProducts = "Select at least one eligible product";

  if (Object.keys(errors).length > 0) return { errors };

  try {
    await createBox(session.shop, data, admin);
  } catch (e) {
    console.error("[app.boxes.new] createBox error:", e);
    const message =
      e instanceof Error && e.message
        ? e.message
        : "Failed to create box. Please try again.";
    return { errors: { _global: message } };
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
  transition: "border-color 0.15s, box-shadow 0.15s",
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

const errorStyle = {
  color: "#dc2626",
  fontSize: "11px",
  marginTop: "5px",
  display: "flex",
  alignItems: "center",
  gap: "4px",
};

export default function CreateBoxPage() {
  const { products } = useLoaderData();
  const actionData = useActionData();
  const searchFetcher = useFetcher();
  const location = useLocation();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const [selectedProducts, setSelectedProducts] = useState([]);
  const [productSearch, setProductSearch] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [options, setOptions] = useState({
    isGiftBox: false,
    allowDuplicates: false,
    giftMessageEnabled: false,
    isActive: true,
  });

  const [itemCount, setItemCount] = useState("4");
  const [priceMode, setPriceMode] = useState("manual");
  const [manualPrice, setManualPrice] = useState("");

  const errors = actionData?.errors || {};
  const displayProducts = searchFetcher.data?.products || products;

  const numItemCount = Math.max(1, parseInt(itemCount) || 1);
  const avgProductPrice =
    selectedProducts.length > 0
      ? selectedProducts.reduce((s, p) => s + (parseFloat(p.price) || 0), 0) / selectedProducts.length
      : 0;
  const estimatedTotal = avgProductPrice * numItemCount;

  const bundlePrice = priceMode === "manual" ? parseFloat(manualPrice) || 0 : estimatedTotal;

  function handleSearchChange(e) {
    const val = e.target.value;
    setProductSearch(val);
    if (val.length > 1) {
      searchFetcher.load(
        withEmbeddedAppParams(
          `/app/boxes/new?q=${encodeURIComponent(val)}`,
          location.search,
        ),
      );
    } else if (val.length === 0) {
      searchFetcher.load(withEmbeddedAppParams("/app/boxes/new", location.search));
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

  const isSelected = (id) => selectedProducts.some((p) => p.id === id);

  function toggleOption(name) {
    setOptions((prev) => ({ ...prev, [name]: !prev[name] }));
  }

  function openPicker() {
    setProductSearch("");
    searchFetcher.load(withEmbeddedAppParams("/app/boxes/new", location.search));
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
    <s-page
      heading="Create New Box Type"
      back-url={withEmbeddedAppParams("/app/boxes", location.search)}
    >
      {/* Header — Save (primary) */}
      <s-button
        slot="primary-action"
        variant="primary"
        disabled={isSaving || undefined}
        onClick={() => {
          const form = document.getElementById("create-box-form");
          if (form) form.requestSubmit();
        }}
      >
        {isSaving ? "Saving..." : "Save & Publish"}
      </s-button>

      {errors._global && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "5px", padding: "12px 16px", marginBottom: "16px", color: "#991b1b", fontSize: "13px", display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "16px" }}>⚠</span>
          {errors._global}
        </div>
      )}

      {/* Hero banner */}
      <div style={{ marginBottom: "20px", borderRadius: "5px", background: "linear-gradient(135deg, #091fd6 0%, #c11a10 55%, #706cd3 100%)", boxShadow: "0 8px 32px rgba(9,31,214,0.22)", overflow: "hidden", position: "relative", padding: "24px 32px" }}>
        <div style={{ position: "absolute", top: "-40px", right: "-40px", width: "180px", height: "180px", borderRadius: "50%", background: "rgba(255,255,255,0.05)", pointerEvents: "none" }} />
        <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(255,255,255,0.15)", backdropFilter: "blur(4px)", borderRadius: "999px", padding: "4px 14px", fontSize: "10px", fontWeight: "800", letterSpacing: "0.10em", textTransform: "uppercase", color: "#d1fae5", marginBottom: "10px" }}>
          📦 New Box
        </div>
        <div style={{ fontSize: "18px", fontWeight: "800", color: "#fff", letterSpacing: "-0.5px" }}>Create a New Combo Box</div>
        <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.65)", marginTop: "4px" }}>Set the price, item count, and eligible products for your new bundle.</div>
      </div>

      <s-section>
        <Form id="create-box-form" method="POST" encType="multipart/form-data">
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
                  placeholder="e.g. Box of 4 Bestsellers"
                  style={{ ...fieldStyle, borderColor: errors.boxName ? "#e11d48" : "#d1d5db" }}
                />
                {errors.boxName && <div style={errorStyle}>{errors.boxName}</div>}
              </div>

              <div>
                <label style={labelStyle}>Display Title (Storefront) *</label>
                <input
                  type="text"
                  name="displayTitle"
                  placeholder="Shown to customers"
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
                <div style={{ display: "flex", border: "1px solid #d1d5db", borderRadius: "5px", overflow: "hidden", marginBottom: "10px" }}>
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
                { key: "isGiftBox", label: "Gift Box Mode", desc: "Shows gift wrapping option to customers", icon: "🎁" },
                { key: "allowDuplicates", label: "Allow Duplicates", desc: "Same product can fill multiple slots", icon: "🔁" },
                { key: "giftMessageEnabled", label: "Gift Message Field", desc: "Show text area for gift message", icon: "✉️" },
                { key: "isActive", label: "Active on Storefront", desc: "Uncheck to save as draft", icon: "✅" },
              ].map((opt) => (
                <label
                  key={opt.key}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "10px",
                    cursor: "pointer",
                    padding: "12px 14px",
                    border: options[opt.key] ? "1.5px solid #091fd6" : "1.5px solid #e5e7eb",
                    borderRadius: "5px",
                    background: options[opt.key] ? "#eef1ff" : "#fafafa",
                    transition: "border-color 0.15s, background 0.15s",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={options[opt.key]}
                    onChange={() => toggleOption(opt.key)}
                    style={{ marginTop: "3px", width: "14px", height: "14px", accentColor: "#091fd6", flexShrink: 0 }}
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
                <span style={{ marginLeft: "6px", background: "linear-gradient(135deg, #091fd6 0%, #c11a10 55%, #706cd3 100%)", color: "#fff", borderRadius: "5px", padding: "2px 8px", fontSize: "10px", fontWeight: "700", fontFamily: "monospace" }}>
                  {selectedProducts.length} selected
                </span>
              )}
            </div>

            {errors.eligibleProducts && (
              <div style={{ color: "#e11d48", fontSize: "12px", marginBottom: "10px", padding: "8px 12px", background: "#fff5f5", borderRadius: "5px", border: "1px solid #fecaca" }}>
                {errors.eligibleProducts}
              </div>
            )}

            {/* Selected products chips */}
            {selectedProducts.length > 0 && (
              <div style={{ marginBottom: "12px", padding: "12px 14px", background: "#eef1ff", borderRadius: "5px", border: "1px solid #c7d2fe" }}>
                <div style={{ fontSize: "10px", fontWeight: "700", color: "#091fd6", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.6px" }}>
                  Selected Products
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {selectedProducts.map((p) => (
                    <span
                      key={p.id}
                      onClick={() => toggleProduct(p)}
                      style={{
                        background: "linear-gradient(135deg, #091fd6 0%, #c11a10 55%, #706cd3 100%)",
                        color: "#fff",
                        borderRadius: "5px",
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
                color: "#091fd6",
                cursor: "pointer",
                width: "100%",
                justifyContent: "center",
                transition: "border-color 0.15s, background 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#091fd6"; e.currentTarget.style.background = "#eef1ff"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#d1d5db"; e.currentTarget.style.background = "#fff"; }}
            >
              <span style={{ fontSize: "16px" }}>+</span>
              {selectedProducts.length > 0 ? "Edit Product Selection" : "Select Eligible Products"}
            </button>
          </div>

        </Form>
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
              borderRadius: "5px",
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
                  borderRadius: "5px",
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
                style={{
                  ...fieldStyle,
                  borderColor: "#d1d5db",
                  paddingLeft: "14px",
                  fontSize: "13px",
                }}
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
                        background: selected ? "#eef1ff" : "#fff",
                        transition: "background 0.1s",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleProduct(product)}
                        style={{ width: "15px", height: "15px", flexShrink: 0, accentColor: "#091fd6" }}
                      />
                      {product.imageUrl ? (
                        <img
                          src={product.imageUrl}
                          alt={product.title}
                          style={{ width: "40px", height: "40px", objectFit: "cover", borderRadius: "5px", flexShrink: 0, border: "1px solid #e5e7eb" }}
                        />
                      ) : (
                        <div style={{ width: "40px", height: "40px", borderRadius: "5px", background: "#f3f4f6", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", border: "1px solid #e5e7eb" }}>
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
                        <span style={{ width: "18px", height: "18px", background: "linear-gradient(135deg, #091fd6 0%, #c11a10 55%, #706cd3 100%)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
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
                    background: "linear-gradient(135deg, #091fd6 0%, #c11a10 55%, #706cd3 100%)",
                    border: "none",
                    borderRadius: "5px",
                    padding: "8px 20px",
                    fontSize: "13px",
                    fontWeight: "700",
                    cursor: "pointer",
                    color: "#fff",
                    boxShadow: "0 1px 6px rgba(9,31,214,0.35)",
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

