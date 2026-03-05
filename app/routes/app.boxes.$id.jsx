import { useState, useMemo } from "react";
import { useLoaderData, useNavigate, useFetcher, Form, useActionData, useNavigation } from "react-router";
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
          variants(first: 1) {
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
  const resp = await admin.graphql(PRODUCTS_QUERY, {
    variables: { first: 50, query: query || null },
  });
  const json = await resp.json();
  const products = (json?.data?.products?.edges || []).map(({ node }) => ({
    id: node.id,
    title: node.title,
    handle: node.handle,
    imageUrl: node.featuredImage?.url || null,
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
    await deleteBox(params.id, shop);
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
  borderRadius: "8px",
  fontSize: "13px",
  color: "#111827",
  background: "#fff",
  boxSizing: "border-box",
  outline: "none",
  transition: "border-color 0.15s",
};

const labelStyle = {
  display: "block",
  fontSize: "12px",
  fontWeight: "600",
  color: "#374151",
  marginBottom: "6px",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

const errorStyle = { color: "#dc2626", fontSize: "11px", marginTop: "5px", display: "flex", alignItems: "center", gap: "4px" };

// ─── Price Chart ─────────────────────────────────────────────────────────────

function PriceChart({ estimatedTotal, bundlePrice, numItemCount }) {
  if (estimatedTotal <= 0 || bundlePrice <= 0) return null;

  const pct = Math.min(100, (bundlePrice / estimatedTotal) * 100);
  const savings = estimatedTotal - bundlePrice;
  const savingsPct = (savings / estimatedTotal) * 100;
  const isOverpriced = bundlePrice > estimatedTotal;

  function fmt(v) {
    return "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  return (
    <div
      style={{
        gridColumn: "1 / -1",
        background: "#fafaf8",
        border: "1px solid #e5e1d8",
        borderRadius: "8px",
        padding: "16px",
        marginTop: "4px",
      }}
    >
      <div
        style={{
          fontSize: "11px",
          fontWeight: "600",
          color: "#7a7670",
          textTransform: "uppercase",
          letterSpacing: "0.8px",
          fontFamily: "monospace",
          marginBottom: "14px",
        }}
      >
        Price Preview — {numItemCount} item{numItemCount !== 1 ? "s" : ""}
      </div>

      <div style={{ marginBottom: "10px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
          <span style={{ fontSize: "11px", color: "#7a7670" }}>Avg Market Value</span>
          <span style={{ fontSize: "11px", fontWeight: "600", fontFamily: "monospace", color: "#374151" }}>
            {fmt(estimatedTotal)}
          </span>
        </div>
        <div style={{ background: "#e5e1d8", borderRadius: "4px", height: "10px" }}>
          <div style={{ width: "100%", background: "#d1d5db", height: "100%", borderRadius: "4px" }} />
        </div>
      </div>

      <div style={{ marginBottom: "12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
          <span style={{ fontSize: "11px", color: "#7a7670" }}>Bundle Price</span>
          <span style={{ fontSize: "11px", fontWeight: "700", fontFamily: "monospace", color: isOverpriced ? "#e11d48" : "#2A7A4F" }}>
            {fmt(bundlePrice)}
          </span>
        </div>
        <div style={{ background: "#e5e1d8", borderRadius: "4px", height: "10px" }}>
          <div
            style={{
              width: `${isOverpriced ? 100 : pct}%`,
              background: isOverpriced ? "#e11d48" : "#2A7A4F",
              height: "100%",
              borderRadius: "4px",
              minWidth: "6px",
              transition: "width 0.3s ease",
            }}
          />
        </div>
      </div>

      <div style={{ paddingTop: "10px", borderTop: "1px solid #e5e1d8", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        {isOverpriced ? (
          <span style={{ fontSize: "12px", color: "#e11d48", fontWeight: "500" }}>
            ⚠ Bundle price is higher than market value
          </span>
        ) : savings > 0 ? (
          <>
            <span style={{ fontSize: "12px", color: "#059669", fontWeight: "500" }}>Customer saves</span>
            <span style={{ fontSize: "13px", fontWeight: "700", color: "#059669", fontFamily: "monospace", background: "#d1fae5", padding: "2px 10px", borderRadius: "20px" }}>
              {fmt(savings)} ({savingsPct.toFixed(0)}% off)
            </span>
          </>
        ) : (
          <span style={{ fontSize: "12px", color: "#7a7670" }}>Bundle price equals market value — no discount</span>
        )}
      </div>
    </div>
  );
}

export default function EditBoxPage() {
  const { box, products } = useLoaderData();
  const actionData = useActionData();
  const navigate = useNavigate();
  const searchFetcher = useFetcher();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const errors = actionData?.errors || {};

  const initialSelected = (box.products || []).map((p) => ({
    id: p.productId,
    productId: p.productId,
    productTitle: p.productTitle,
    productImageUrl: p.productImageUrl,
    productHandle: p.productHandle,
    variantIds: p.variantIds || [],
    price: 0, // prices not stored in DB; will be enriched when user interacts
  }));

  const [selectedProducts, setSelectedProducts] = useState(initialSelected);
  const [productSearch, setProductSearch] = useState("");
  const [options, setOptions] = useState({
    isGiftBox: box.isGiftBox,
    allowDuplicates: box.allowDuplicates,
    giftMessageEnabled: box.giftMessageEnabled,
    isActive: box.isActive,
  });

  // Controlled itemCount for price calculations
  const [itemCount, setItemCount] = useState(String(box.itemCount));

  // Pricing mode — starts as manual with existing price pre-filled
  const [priceMode, setPriceMode] = useState("manual");
  const [manualPrice, setManualPrice] = useState(String(box.bundlePrice));
  const [discountType, setDiscountType] = useState("percent");
  const [discountValue, setDiscountValue] = useState("10");

  const displayProducts =
    searchFetcher.data?.products ||
    (productSearch
      ? products.filter((p) => p.title.toLowerCase().includes(productSearch.toLowerCase()))
      : products);

  // ── Price computations ──
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

  // ── Handlers ──
  function handleSearchChange(e) {
    const val = e.target.value;
    setProductSearch(val);
    if (val.length > 1) {
      searchFetcher.load(`/app/boxes/${box.id}?q=${encodeURIComponent(val)}`);
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
          variantIds: product.variantId ? [product.variantId] : [],
          price: parseFloat(product.price) || 0,
        },
      ];
    });
  }

  function toggleOption(name) {
    setOptions((prev) => ({ ...prev, [name]: !prev[name] }));
  }

  const isSelected = (id) => selectedProducts.some((p) => p.id === id);

  const sectionHeadingStyle = {
    fontSize: "12px",
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
    <s-page heading={`Edit: ${box.boxName}`}>
      <s-button slot="primary-action" variant="tertiary" onClick={() => navigate("/app/boxes")}>
        Cancel
      </s-button>

      {errors._global && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "10px", padding: "12px 16px", marginBottom: "16px", color: "#991b1b", fontSize: "13px", display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "16px" }}>⚠</span>
          {errors._global}
        </div>
      )}

      <s-section>
        <Form method="POST" encType="multipart/form-data">
          {/* Hidden inputs for computed / boolean values */}
          <input type="hidden" name="bundlePrice" value={bundlePrice > 0 ? bundlePrice.toFixed(2) : ""} />
          <input type="hidden" name="itemCount" value={itemCount} />
          <input type="hidden" name="eligibleProducts" value={JSON.stringify(selectedProducts)} />
          <input type="hidden" name="isGiftBox" value={String(options.isGiftBox)} />
          <input type="hidden" name="allowDuplicates" value={String(options.allowDuplicates)} />
          <input type="hidden" name="giftMessageEnabled" value={String(options.giftMessageEnabled)} />
          <input type="hidden" name="isActive" value={String(options.isActive)} />

          {/* ── Basic Information ── */}
          <div style={{ marginBottom: "32px" }}>
            <div style={sectionHeadingStyle}>
              <span style={{ fontSize: "16px" }}>📋</span> Basic Information
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>

              <div>
                <label style={labelStyle}>Box Internal Name *</label>
                <input
                  type="text"
                  name="boxName"
                  defaultValue={box.boxName}
                  style={{ ...fieldStyle, borderColor: errors.boxName ? "#dc2626" : "#e5e7eb" }}
                />
                {errors.boxName && <div style={errorStyle}>{errors.boxName}</div>}
              </div>

              <div>
                <label style={labelStyle}>Display Title (Storefront) *</label>
                <input
                  type="text"
                  name="displayTitle"
                  defaultValue={box.displayTitle}
                  style={{ ...fieldStyle, borderColor: errors.displayTitle ? "#dc2626" : "#e5e7eb" }}
                />
                {errors.displayTitle && <div style={errorStyle}>{errors.displayTitle}</div>}
              </div>

              {/* Controlled itemCount */}
              <div>
                <label style={labelStyle}>Number of Items *</label>
                <input
                  type="number"
                  placeholder="e.g. 4"
                  min="1"
                  max="20"
                  value={itemCount}
                  onChange={(e) => setItemCount(e.target.value)}
                  style={{ ...fieldStyle, borderColor: errors.itemCount ? "#e11d48" : "#c9c6be" }}
                />
                {errors.itemCount && <div style={errorStyle}>{errors.itemCount}</div>}
              </div>

              {/* ── Bundle Price with Manual / Dynamic toggle ── */}
              <div>
                <label style={labelStyle}>Bundle Price (₹) *</label>

                <div
                  style={{
                    display: "flex",
                    border: "1px solid #e5e1d8",
                    borderRadius: "6px",
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
                        background: priceMode === mode ? "#2A7A4F" : "#fff",
                        color: priceMode === mode ? "#fff" : "#374151",
                        transition: "background 0.15s",
                        textTransform: "capitalize",
                      }}
                    >
                      {mode === "manual" ? "Manual Price" : "Dynamic Price"}
                    </button>
                  ))}
                </div>

                {/* Manual input */}
                {priceMode === "manual" && (
                  <input
                    type="number"
                    placeholder="e.g. 1200"
                    min="0"
                    step="0.01"
                    value={manualPrice}
                    onChange={(e) => setManualPrice(e.target.value)}
                    style={{ ...fieldStyle, borderColor: errors.bundlePrice ? "#e11d48" : "#c9c6be" }}
                  />
                )}

                {/* Dynamic price calculator */}
                {priceMode === "dynamic" && (
                  <div
                    style={{
                      border: "1px solid #e5e1d8",
                      borderRadius: "6px",
                      padding: "12px",
                      background: "#fafaf8",
                    }}
                  >
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
                      <div>
                        <label style={{ ...labelStyle, fontSize: "11px" }}>Discount Type</label>
                        <select
                          value={discountType}
                          onChange={(e) => setDiscountType(e.target.value)}
                          style={{ ...fieldStyle, fontSize: "12px" }}
                        >
                          <option value="percent">% Off Total</option>
                          <option value="fixed">₹ Fixed Discount</option>
                          <option value="none">No Discount (Full Price)</option>
                        </select>
                      </div>
                      {discountType !== "none" && (
                        <div>
                          <label style={{ ...labelStyle, fontSize: "11px" }}>
                            {discountType === "percent" ? "Discount %" : "Discount Amount (₹)"}
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

                    <div
                      style={{
                        background: dynamicPrice > 0 ? "#f0fdf4" : "#f9fafb",
                        borderRadius: "6px",
                        padding: "10px 14px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        border: "1px solid " + (dynamicPrice > 0 ? "#bbf7d0" : "#e5e1d8"),
                      }}
                    >
                      <span style={{ fontSize: "12px", color: "#374151", fontWeight: "500" }}>
                        Calculated Price
                      </span>
                      <span
                        style={{
                          fontSize: "18px",
                          fontWeight: "700",
                          color: dynamicPrice > 0 ? "#15803d" : "#9ca3af",
                          fontFamily: "monospace",
                        }}
                      >
                        {dynamicPrice > 0
                          ? "₹" + dynamicPrice.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                          : "Select products first"}
                      </span>
                    </div>

                    {selectedProducts.filter((p) => p.price > 0).length === 0 && (
                      <div style={{ fontSize: "11px", color: "#7a7670", marginTop: "8px", textAlign: "center" }}>
                        Re-select products from the list below to load their prices
                      </div>
                    )}
                  </div>
                )}

                {errors.bundlePrice && <div style={errorStyle}>{errors.bundlePrice}</div>}
              </div>

              {/* Price chart */}
              <PriceChart
                estimatedTotal={estimatedTotal}
                bundlePrice={bundlePrice}
                numItemCount={numItemCount}
              />

              <div style={{ gridColumn: "1 / -1" }}>
                <label style={labelStyle}>Banner Image (optional)</label>
                <input
                  type="file"
                  name="bannerImage"
                  accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                  style={fieldStyle}
                />
                {box.bannerImageSrc && (
                  <div style={{ marginTop: "10px" }}>
                    <img
                      src={box.bannerImageSrc}
                      alt="Current banner"
                      style={{ width: "100%", maxWidth: "360px", borderRadius: "8px", border: "1px solid #e5e1d8" }}
                    />
                  </div>
                )}
                <label style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "#7a7670", marginTop: "8px" }}>
                  <input type="checkbox" name="removeBannerImage" value="true" />
                  Remove current image
                </label>
                <div style={{ fontSize: "11px", color: "#7a7670", marginTop: "6px" }}>
                  Upload JPG, PNG, WEBP, GIF, or AVIF (max 5MB)
                </div>
                {errors.bannerImage && <div style={errorStyle}>{errors.bannerImage}</div>}
              </div>
            </div>
          </div>

          {/* ── Options ── */}
          <div style={{ marginBottom: "32px" }}>
            <div style={sectionHeadingStyle}>
              <span style={{ fontSize: "16px" }}>⚙️</span> Options
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              {[
                { key: "isGiftBox", label: "Gift Box Mode", desc: "Enables gift packaging option", icon: "🎁" },
                { key: "allowDuplicates", label: "Allow Duplicate Products", desc: "Same product in multiple slots", icon: "🔁" },
                { key: "giftMessageEnabled", label: "Gift Message Field", desc: "Show text area for gift message", icon: "✉️" },
                { key: "isActive", label: "Active (visible on storefront)", desc: "Uncheck to hide from customers", icon: "✅" },
              ].map((opt) => (
                <label
                  key={opt.key}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "12px",
                    cursor: "pointer",
                    padding: "14px",
                    border: options[opt.key] ? "1.5px solid #86efac" : "1.5px solid #e5e7eb",
                    borderRadius: "10px",
                    background: options[opt.key] ? "#f0fdf4" : "#fff",
                    transition: "border-color 0.15s, background 0.15s",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={options[opt.key]}
                    onChange={() => toggleOption(opt.key)}
                    style={{ marginTop: "3px", width: "15px", height: "15px", accentColor: "#2A7A4F", flexShrink: 0 }}
                  />
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: "600", color: "#111827", display: "flex", alignItems: "center", gap: "6px" }}>
                      <span>{opt.icon}</span> {opt.label}
                    </div>
                    <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "3px" }}>{opt.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* ── Eligible Products ── */}
          <div style={{ marginBottom: "32px" }}>
            <div style={sectionHeadingStyle}>
              <span style={{ fontSize: "16px" }}>🛍️</span> Eligible Products
              {selectedProducts.length > 0 && (
                <span style={{ marginLeft: "4px", background: "#2A7A4F", color: "#fff", borderRadius: "20px", padding: "2px 8px", fontSize: "10px", fontWeight: "600" }}>
                  {selectedProducts.length} selected
                </span>
              )}
            </div>
            {errors.eligibleProducts && (
              <div style={{ color: "#e11d48", fontSize: "12px", marginBottom: "8px", padding: "8px 12px", background: "#fff5f5", borderRadius: "6px" }}>
                {errors.eligibleProducts}
              </div>
            )}
            <input
              type="text"
              placeholder="Search products..."
              value={productSearch}
              onChange={handleSearchChange}
              style={{ ...fieldStyle, marginBottom: "10px" }}
            />
            {selectedProducts.length > 0 && (
              <div style={{ marginBottom: "10px", padding: "10px 14px", background: "#f0fdf4", borderRadius: "6px", border: "1px solid #bbf7d0" }}>
                <div style={{ fontSize: "11px", fontWeight: "600", color: "#15803d", marginBottom: "6px", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Selected
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {selectedProducts.map((p) => (
                    <span
                      key={p.id}
                      onClick={() => toggleProduct(p)}
                      style={{ background: "#2A7A4F", color: "#fff", borderRadius: "20px", padding: "3px 10px", fontSize: "11px", cursor: "pointer" }}
                    >
                      {p.productTitle} ✕
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div style={{ maxHeight: "300px", overflowY: "auto", border: "1.5px solid #e5e7eb", borderRadius: "10px", overflow: "hidden" }}>
              {displayProducts.map((product) => (
                <label
                  key={product.id}
                  style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 14px", borderBottom: "1px solid #f3f4f6", cursor: "pointer", background: isSelected(product.id) ? "#f0fdf4" : "#fff", transition: "background 0.1s" }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected(product.id)}
                    onChange={() => toggleProduct(product)}
                    style={{ width: "14px", height: "14px", flexShrink: 0, accentColor: "#2A7A4F" }}
                  />
                  {product.imageUrl && (
                    <img
                      src={product.imageUrl}
                      alt={product.title}
                      style={{ width: "36px", height: "36px", objectFit: "cover", borderRadius: "4px", flexShrink: 0 }}
                    />
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "13px", fontWeight: "600", color: "#1a1814" }}>{product.title}</div>
                    <div style={{ fontSize: "11px", color: "#7a7670", fontFamily: "monospace" }}>{product.handle}</div>
                  </div>
                  {product.price && parseFloat(product.price) > 0 && (
                    <div style={{ fontSize: "12px", fontWeight: "600", color: "#374151", fontFamily: "monospace", flexShrink: 0 }}>
                      ₹{parseFloat(product.price).toLocaleString("en-IN")}
                    </div>
                  )}
                </label>
              ))}
              {displayProducts.length === 0 && (
                <div style={{ padding: "24px", textAlign: "center", color: "#7a7670", fontSize: "13px" }}>
                  No products found
                </div>
              )}
            </div>
          </div>

          {/* ── Actions ── */}
          <div
            style={{
              display: "flex",
              gap: "10px",
              justifyContent: "space-between",
              paddingTop: "20px",
              borderTop: "1.5px solid #f3f4f6",
            }}
          >
            <button
              type="submit"
              name="_action"
              value="delete"
              onClick={(e) => {
                if (!window.confirm(`Delete "${box.boxName}"? This cannot be undone.`)) e.preventDefault();
              }}
              style={{
                background: "#fff5f5",
                border: "1.5px solid #fecaca",
                borderRadius: "8px",
                padding: "10px 20px",
                fontSize: "13px",
                fontWeight: "500",
                cursor: "pointer",
                color: "#dc2626",
                transition: "background 0.12s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#fee2e2")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "#fff5f5")}
            >
              Delete Box
            </button>
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                type="button"
                onClick={() => navigate("/app/boxes")}
                style={{
                  background: "#fff",
                  border: "1.5px solid #e5e7eb",
                  borderRadius: "8px",
                  padding: "10px 22px",
                  fontSize: "13px",
                  fontWeight: "500",
                  cursor: "pointer",
                  color: "#374151",
                  transition: "background 0.12s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f9fafb")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
              >
                Cancel
              </button>
              <button
                type="submit"
                name="_action"
                value="save"
                disabled={isSaving}
                style={{
                  background: isSaving ? "#9ca3af" : "#2A7A4F",
                  border: "none",
                  borderRadius: "8px",
                  padding: "10px 28px",
                  fontSize: "13px",
                  fontWeight: "700",
                  cursor: isSaving ? "not-allowed" : "pointer",
                  color: "#fff",
                  letterSpacing: "0.3px",
                  boxShadow: isSaving ? "none" : "0 2px 8px rgba(42,122,79,0.3)",
                  transition: "background 0.15s, box-shadow 0.15s",
                }}
              >
                {isSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </Form>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
