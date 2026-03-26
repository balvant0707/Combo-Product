import { useState } from "react";
import { Form, useActionData, useLoaderData, useLocation, useNavigation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { AdminIcon } from "../components/admin-icons";
import { getBox, updateBox, deleteBox, getBannerImageSrc } from "../models/boxes.server";
import { withEmbeddedAppParams } from "../utils/embedded-app";

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
      showProductImages: cfg.showProductImages,
      showProgressBar:   cfg.showProgressBar,
      allowReselection:  cfg.allowReselection,
      steps,
    });
  } else if (box.comboStepsConfig) {
    comboStepsConfig = box.comboStepsConfig;
  }

  let effectiveBundlePrice = parseFloat(box.bundlePrice) || 0;
  let savedDiscountType = "percent";
  let savedDiscountValue = "10";
  if (comboStepsConfig) {
    try {
      const parsed = JSON.parse(comboStepsConfig);
      if (effectiveBundlePrice === 0) effectiveBundlePrice = parseFloat(parsed.bundlePrice) || 0;
      if (parsed.discountType) savedDiscountType = parsed.discountType;
      if (parsed.discountValue != null) savedDiscountValue = String(parsed.discountValue);
    } catch {}
  }

  return {
    box: { ...boxWithoutBinary, bundlePrice: effectiveBundlePrice, bannerImageSrc, discountType: savedDiscountType, discountValue: savedDiscountValue },
    products,
    collections,
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
  const errors = {};
  const bannerImage = await parseBannerImage(formData, errors);
  const removeBannerImage = formData.get("removeBannerImage") === "true" && !bannerImage;

  const data = {
    boxName: formData.get("boxName"),
    displayTitle: formData.get("displayTitle"),
    itemCount: formData.get("itemCount"),
    bundlePrice: formData.get("bundlePrice"),
    bundlePriceType: formData.get("bundlePriceType"),
    discountType: formData.get("discountType") || "none",
    discountValue: formData.get("discountValue") || "0",
    isGiftBox: formData.get("isGiftBox") === "true",
    allowDuplicates: formData.get("allowDuplicates") === "true",
    bannerImage,
    removeBannerImage,
    isActive: formData.get("isActive") === "true",
    giftMessageEnabled: formData.get("giftMessageEnabled") === "true",
    scopeType: formData.get("scope") || "specific_collections",
    scopeItems,
  };
  if (!data.boxName?.trim()) errors.boxName = "Box name is required";
  if (!data.displayTitle?.trim()) errors.displayTitle = "Display title is required";
  if (!data.itemCount || parseInt(data.itemCount) < 1) errors.itemCount = "Invalid item count";

  if (Object.keys(errors).length > 0) return { errors };

  try {
    await updateBox(params.id, shop, data, admin);
  } catch (e) {
    console.error("[app.boxes.$id._index] updateBox error:", e);
    return { errors: { _global: "Failed to save changes. Please try again." } };
  }

  throw redirect("/app/boxes");
};

/* ─────────────────────────── Styles ─────────────────────────── */
const fieldStyle = {
  width: "100%", padding: "9px 12px", border: "1.5px solid #e5e7eb",
  borderRadius: "5px", fontSize: "13px", color: "#111827", background: "#fff",
  boxSizing: "border-box", outline: "none", transition: "border-color 0.15s",
};
const labelStyle = {
  display: "block", fontSize: "11px", fontWeight: "700", color: "#4b5563",
  marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.6px",
};
const errorStyle = { color: "#dc2626", fontSize: "11px", marginTop: "5px", display: "flex", alignItems: "center", gap: "4px" };

const sectionHeadingStyle = {
  fontSize: "11px", fontWeight: "700", color: "#6b7280", textTransform: "uppercase",
  letterSpacing: "0.8px", marginBottom: "16px", paddingBottom: "10px",
  borderBottom: "1.5px solid #f3f4f6", display: "flex", alignItems: "center", gap: "8px",
};

/* ─────────────────────────── Component ─────────────────────────── */
export default function BoxSettingsPage() {
  const { box, products, collections } = useLoaderData();
  const actionData = useActionData();
  const location = useLocation();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const errors = actionData?.errors || {};

  const [options, setOptions] = useState({
    isGiftBox: box.isGiftBox, allowDuplicates: box.allowDuplicates,
    giftMessageEnabled: box.giftMessageEnabled, isActive: box.isActive,
  });
  const [itemCount, setItemCount] = useState(String(box.itemCount));
  const [priceMode, setPriceMode] = useState(box.bundlePriceType || "manual");
  const [manualPrice, setManualPrice] = useState(String(box.bundlePrice));
  const [discountType, setDiscountType] = useState(box.discountType || "percent");
  const [discountValue, setDiscountValue] = useState(box.discountValue || "10");
  const [scope, setScope] = useState(box.scopeType || "specific_collections");
  const [scopeItems, setScopeItems] = useState(() => {
    try { return JSON.parse(box.scopeItemsJson || "[]"); } catch { return []; }
  });
  const [showScopePicker, setShowScopePicker] = useState(false);
  const [scopeSearch, setScopeSearch] = useState("");

  const numItemCount = Math.max(1, parseInt(itemCount) || 1);
  const dynamicPrice = 0;
  const bundlePrice = priceMode === "manual" ? parseFloat(manualPrice) || 0 : dynamicPrice;

  /* ── Box Settings helpers ── */
  function toggleOption(name) { setOptions((prev) => ({ ...prev, [name]: !prev[name] })); }

  /* ── Shared modal styles ── */
  const modalOverlayStyle = { position: "fixed", inset: 0, background: "rgba(17,24,39,0.55)", backdropFilter: "blur(3px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" };
  const modalBoxStyle = { background: "#fff", borderRadius: "8px", width: "100%", maxWidth: "560px", maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.18)", overflow: "hidden" };
  const modalHeaderStyle = { padding: "16px 20px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#ffffff" };
  const modalBodyStyle = { flex: 1, overflowY: "auto" };
  const modalFooterStyle = { padding: "14px 16px", borderTop: "1px solid #f3f4f6", background: "#ffffff", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" };
  const modalCloseBtn = { background: "none", border: "none", cursor: "pointer", fontSize: "18px", color: "#9ca3af", padding: "4px 8px", borderRadius: "5px", lineHeight: 1 };
  const searchInputStyle = { ...fieldStyle, borderColor: "#d1d5db", paddingLeft: "14px", fontSize: "13px" };

  /* ─────────────── Render ─────────────── */
  return (
    <s-page
      heading={`Box Settings: ${box.boxName}`}
      back-url={withEmbeddedAppParams("/app/boxes", location.search)}
    >
      <ui-title-bar title={`Box Settings: ${box.boxName}`}>
        <button onClick={() => document.getElementById("delete-box-form")?.requestSubmit()}>
          Delete Box
        </button>
        <button variant="primary" onClick={() => document.getElementById("edit-box-form")?.requestSubmit()}>
          {isSaving ? "Saving..." : "Save Changes"}
        </button>
      </ui-title-bar>

      {/* Hero banner */}
      <div style={{ marginBottom: "20px", borderRadius: "5px", background: "#ffffff", border: "1px solid #e5e7eb", boxShadow: "0 8px 24px rgba(15,23,42,0.08)", overflow: "hidden", position: "relative", padding: "24px 32px" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "#f3f4f6", borderRadius: "999px", padding: "4px 14px", fontSize: "10px", fontWeight: "800", letterSpacing: "0.10em", textTransform: "uppercase", color: "#000000", marginBottom: "10px" }}><AdminIcon type="clipboard" size="small" /> Box Settings</div>
        <div style={{ fontSize: "18px", fontWeight: "800", color: "#000000", letterSpacing: "-0.5px" }}>{box.boxName}</div>
        <div style={{ fontSize: "13px", color: "#4b5563", marginTop: "4px" }}>Update settings, pricing, and eligible products for this bundle.</div>
      </div>



    <s-section>

      {errors._global && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "5px", padding: "12px 16px", marginBottom: "16px", color: "#991b1b", fontSize: "13px", display: "flex", alignItems: "center", gap: "8px" }}>
          <AdminIcon type="alert-triangle" size="small" />{errors._global}
        </div>
      )}

      <Form id="edit-box-form" method="POST" action={`/app/boxes/${box.id}${location.search ? location.search + '&index' : '?index'}`} encType="multipart/form-data">
        <input type="hidden" name="_action" value="save" />
        <input type="hidden" name="bundlePrice" value={bundlePrice > 0 ? bundlePrice.toFixed(2) : ""} />
        <input type="hidden" name="bundlePriceType" value={priceMode} />
        <input type="hidden" name="discountType" value={discountType} />
        <input type="hidden" name="discountValue" value={discountValue} />
        <input type="hidden" name="itemCount" value={itemCount} />
        <input type="hidden" name="isGiftBox" value={String(options.isGiftBox)} />
        <input type="hidden" name="allowDuplicates" value={String(options.allowDuplicates)} />
        <input type="hidden" name="giftMessageEnabled" value={String(options.giftMessageEnabled)} />
        <input type="hidden" name="isActive" value={String(options.isActive)} />
        <input type="hidden" name="scope" value={scope} />
        <input type="hidden" name="scopeItems" value={JSON.stringify(scopeItems)} />

        {/* Basic Information */}
        <div style={{ marginBottom: "28px" }}>
          <div style={sectionHeadingStyle}><AdminIcon type="clipboard" size="small" /> Basic Information</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
            <div>
              <label style={labelStyle}>Box Internal Name *</label>
              <input type="text" name="boxName" defaultValue={box.boxName} style={{ ...fieldStyle, borderColor: errors.boxName ? "#e11d48" : "#d1d5db" }} />
              {errors.boxName && <div style={errorStyle}>{errors.boxName}</div>}
            </div>
            <div>
              <label style={labelStyle}>Display Title (Storefront) *</label>
              <input type="text" name="displayTitle" defaultValue={box.displayTitle} style={{ ...fieldStyle, borderColor: errors.displayTitle ? "#e11d48" : "#d1d5db" }} />
              {errors.displayTitle && <div style={errorStyle}>{errors.displayTitle}</div>}
            </div>
            <div>
              <label style={labelStyle}>Number of Items *</label>
              <input type="number" placeholder="e.g. 4" min="1" max="20" value={itemCount} onChange={(e) => setItemCount(e.target.value)} style={{ ...fieldStyle, borderColor: errors.itemCount ? "#e11d48" : "#d1d5db" }} />
              {errors.itemCount && <div style={errorStyle}>{errors.itemCount}</div>}
            </div>
            <div>
              <label style={labelStyle}>Bundle Price (₹) *</label>
              <div style={{ display: "flex", border: "1px solid #d1d5db", borderRadius: "5px", overflow: "hidden", marginBottom: "10px" }}>
                {["manual", "dynamic"].map((mode) => (
                  <button key={mode} type="button" onClick={() => setPriceMode(mode)} style={{ flex: 1, padding: "7px 0", fontSize: "12px", fontWeight: "600", border: "none", cursor: "pointer", background: priceMode === mode ? "#2A7A4F" : "#f9fafb", color: priceMode === mode ? "#ffffff" : "#374151", transition: "background 0.15s" }}>
                    {mode === "manual" ? "Manual" : "Dynamic"}
                  </button>
                ))}
              </div>
              {priceMode === "manual" && (
                <input type="number" placeholder="e.g. 1200" min="0" step="0.01" value={manualPrice} onChange={(e) => setManualPrice(e.target.value)} style={{ ...fieldStyle, borderColor: errors.bundlePrice ? "#e11d48" : "#d1d5db" }} />
              )}
              {priceMode === "dynamic" && (
                <div style={{ border: "1px solid #d1d5db", borderRadius: "5px", padding: "12px", background: "#ffffff" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
                    <div>
                      <label style={{ ...labelStyle, fontSize: "10px" }}>Discount Type</label>
                      <select value={discountType} onChange={(e) => setDiscountType(e.target.value)} style={{ ...fieldStyle, fontSize: "12px" }}>
                        <option value="percent">% Off Total</option>
                        <option value="fixed">₹ Fixed Discount</option>
                        <option value="none">No Discount</option>
                      </select>
                    </div>
                    {discountType !== "none" && (
                      <div>
                        <label style={{ ...labelStyle, fontSize: "10px" }}>{discountType === "percent" ? "Discount %" : "Amount (₹)"}</label>
                        <input type="number" min="0" step={discountType === "percent" ? "1" : "0.01"} max={discountType === "percent" ? "99" : undefined} value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} style={{ ...fieldStyle, fontSize: "12px" }} />
                      </div>
                    )}
                  </div>
                </div>
              )}
              {errors.bundlePrice && <div style={errorStyle}>{errors.bundlePrice}</div>}
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelStyle}>Banner Image (optional)</label>
              <input type="file" name="bannerImage" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" style={{ ...fieldStyle, padding: "7px 12px" }} />
              {box.bannerImageSrc && (
                <div style={{ marginTop: "10px" }}>
                  <img src={box.bannerImageSrc} alt="Current banner" style={{ width: "100%", maxWidth: "360px", borderRadius: "5px", border: "1px solid #e5e7eb" }} />
                </div>
              )}
              <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#6b7280", marginTop: "8px" }}>
                <input type="checkbox" name="removeBannerImage" value="true" style={{ accentColor: "#dc2626" }} />
                Remove current image
              </label>
              <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "5px" }}>JPG, PNG, WEBP, GIF, or AVIF — max 5MB</div>
              {errors.bannerImage && <div style={errorStyle}>{errors.bannerImage}</div>}
            </div>
          </div>
        </div>

        {/* Options */}
        <div style={{ marginBottom: "28px" }}>
          <div style={sectionHeadingStyle}><AdminIcon type="settings" size="small" /> Options</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            {[
              { key: "isGiftBox", label: "Gift Box Mode", desc: "Enables gift packaging option", iconType: "gift-card" },
              { key: "allowDuplicates", label: "Allow Duplicates", desc: "Same product in multiple slots", iconType: "duplicate" },
              { key: "giftMessageEnabled", label: "Gift Message Field", desc: "Show text area for gift message", iconType: "email" },
              { key: "isActive", label: "Active on Storefront", desc: "Uncheck to hide from customers", iconType: "check-circle" },
            ].map((opt) => (
              <label key={opt.key} style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer", padding: "12px 14px", border: options[opt.key] ? "1.5px solid #86efac" : "1.5px solid #e5e7eb", borderRadius: "5px", background: options[opt.key] ? "#f0fdf4" : "#fafafa", transition: "border-color 0.15s, background 0.15s" }}>
                <input type="checkbox" checked={options[opt.key]} onChange={() => toggleOption(opt.key)} style={{ marginTop: "3px", width: "14px", height: "14px", accentColor: "#2A7A4F", flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: "13px", fontWeight: "600", color: "#000000", display: "flex", alignItems: "center", gap: "5px" }}><AdminIcon type={opt.iconType} size="small" />{opt.label}</div>
                  <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>{opt.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Scope */}
        <div style={{ marginBottom: "28px" }}>
          <div style={sectionHeadingStyle}><AdminIcon type="target" size="small" /> Scope</div>
          <div style={{ marginBottom: "12px" }}>
            <label style={labelStyle}>Select Scope</label>
            <select
              value={scope}
              onChange={(e) => { setScope(e.target.value); setScopeItems([]); }}
              style={{ width: "100%", padding: "9px 12px", border: "1.5px solid #d1d5db", borderRadius: "5px", fontSize: "13px", color: "#111827", background: "#fff", boxSizing: "border-box", outline: "none", cursor: "pointer", appearance: "none", backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%236b7280' d='M6 8L1 3h10z'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center", paddingRight: "32px" }}
            >
              <option value="specific_collections">Specific collections</option>
              <option value="specific_products">Specific products</option>
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              type="button"
              onClick={() => { setScopeSearch(""); setShowScopePicker(true); }}
              style={{ padding: "8px 16px", background: "#2A7A4F", border: "1.5px solid #2A7A4F", borderRadius: "5px", fontSize: "13px", fontWeight: "600", color: "#ffffff", cursor: "pointer", transition: "background 0.12s, border-color 0.12s" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#1e5e3c"; e.currentTarget.style.borderColor = "#1e5e3c"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#2A7A4F"; e.currentTarget.style.borderColor = "#2A7A4F"; }}
            >
              {scope === "specific_collections" ? "Select collections" : "Select products"}
            </button>
            <span style={{ fontSize: "12px", color: "#6b7280", fontWeight: "500" }}>{scopeItems.length} selected</span>
          </div>
          {scopeItems.length > 0 && (
            <div style={{ marginTop: "10px", padding: "10px 12px", background: "#f9fafb", borderRadius: "5px", border: "1px solid #e5e7eb" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {scopeItems.map((item) => (
                  <span key={item.id} onClick={() => setScopeItems((prev) => prev.filter((i) => i.id !== item.id))} style={{ background: "#f3f4f6", color: "#000000", border: "1px solid #d1d5db", borderRadius: "5px", padding: "3px 10px", fontSize: "12px", cursor: "pointer", display: "flex", alignItems: "center", gap: "5px", fontWeight: "500" }}>
                    {item.title}<AdminIcon type="x" size="small" style={{ opacity: 0.75, color: "#000000" }} />
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

      </Form>

      {/* Delete form */}
      <div style={{ paddingTop: "18px", borderTop: "1.5px solid #f3f4f6" }}>
        <Form method="POST" id="delete-box-form" action={`/app/boxes/${box.id}${location.search ? location.search + '&index' : '?index'}`}>
          <input type="hidden" name="_action" value="delete" />
          <button type="submit" onClick={(e) => { if (!window.confirm(`Delete "${box.boxName}"? This cannot be undone.`)) e.preventDefault(); }} style={{ background: "#dc2626", border: "1.5px solid #dc2626", borderRadius: "5px", padding: "9px 18px", fontSize: "13px", fontWeight: "500", cursor: "pointer", color: "#ffffff" }} onMouseEnter={(e) => (e.currentTarget.style.background = "#b91c1c")} onMouseLeave={(e) => (e.currentTarget.style.background = "#dc2626")}>
            Delete Box
          </button>
        </Form>
      </div>

      {/* Scope Picker Modal */}
      {showScopePicker && (() => {
        const isCollections = scope === "specific_collections";
        const allItems = isCollections ? collections : products;
        const filtered = scopeSearch.trim()
          ? allItems.filter((i) => i.title.toLowerCase().includes(scopeSearch.toLowerCase()))
          : allItems;
        const isScopeSelected = (id) => scopeItems.some((i) => i.id === id);
        function toggleScopeItem(item) {
          setScopeItems((prev) => prev.some((i) => i.id === item.id)
            ? prev.filter((i) => i.id !== item.id)
            : [...prev, { id: item.id, title: item.title }]
          );
        }
        return (
          <div style={modalOverlayStyle} onClick={(e) => { if (e.target === e.currentTarget) setShowScopePicker(false); }}>
            <div style={modalBoxStyle}>
              <div style={modalHeaderStyle}>
                <div>
                  <div style={{ fontSize: "15px", fontWeight: "700", color: "#111827" }}>
                    {isCollections ? "Select Collections" : "Select Products"}
                  </div>
                  <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "2px" }}>
                    {scopeItems.length} {isCollections ? "collection" : "product"}{scopeItems.length !== 1 ? "s" : ""} selected
                  </div>
                </div>
                <button type="button" aria-label="Close scope picker" onClick={() => setShowScopePicker(false)} style={{ ...modalCloseBtn, display: "inline-flex", alignItems: "center", justifyContent: "center" }}><AdminIcon type="x" size="small" style={{ color: "#9ca3af" }} /></button>
              </div>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6" }}>
                <input
                  type="text"
                  placeholder={`Search ${isCollections ? "collections" : "products"}...`}
                  value={scopeSearch}
                  onChange={(e) => setScopeSearch(e.target.value)}
                  autoFocus
                  style={searchInputStyle}
                />
              </div>
              <div style={modalBodyStyle}>
                {filtered.length === 0 ? (
                  <div style={{ padding: "40px 20px", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>No items found</div>
                ) : filtered.map((item, idx) => {
                  const selected = isScopeSelected(item.id);
                  return (
                    <label key={item.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 16px", borderBottom: idx < filtered.length - 1 ? "1px solid #f3f4f6" : "none", cursor: "pointer", background: selected ? "#f0fdf4" : "#fff", transition: "background 0.1s" }}>
                      <input type="checkbox" checked={selected} onChange={() => toggleScopeItem(item)} style={{ width: "15px", height: "15px", flexShrink: 0, accentColor: "#2A7A4F" }} />
                      {item.imageUrl
                        ? <img src={item.imageUrl} alt={item.title} style={{ width: "40px", height: "40px", objectFit: "cover", borderRadius: "5px", flexShrink: 0, border: "1px solid #e5e7eb" }} />
                        : <div style={{ width: "40px", height: "40px", borderRadius: "5px", background: "#f3f4f6", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #e5e7eb" }}><AdminIcon type={isCollections ? "folder" : "product"} size="small" /></div>
                      }
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "13px", fontWeight: "600", color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</div>
                      </div>
                      {selected && <span style={{ width: "18px", height: "18px", background: "#2A7A4F", border: "1px solid #2A7A4F", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><AdminIcon type="check" size="small" style={{ color: "#ffffff" }} /></span>}
                    </label>
                  );
                })}
              </div>
              <div style={modalFooterStyle}>
                <span style={{ fontSize: "12px", color: "#6b7280" }}>
                  {scopeItems.length > 0 ? `${scopeItems.length} selected` : "None selected"}
                </span>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button type="button" onClick={() => setShowScopePicker(false)} style={{ background: "#fff", border: "1.5px solid #d1d5db", borderRadius: "5px", padding: "8px 16px", fontSize: "13px", fontWeight: "500", cursor: "pointer", color: "#111827" }}>Cancel</button>
                  <button type="button" onClick={() => setShowScopePicker(false)} style={{ background: "#2A7A4F", border: "none", borderRadius: "5px", padding: "8px 20px", fontSize: "13px", fontWeight: "700", cursor: "pointer", color: "#ffffff", boxShadow: "0 1px 6px rgba(42,122,79,0.35)" }}>
                    Done{scopeItems.length > 0 ? ` (${scopeItems.length})` : ""}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
