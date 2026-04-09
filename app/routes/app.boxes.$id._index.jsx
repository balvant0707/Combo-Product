import { useState } from "react";
import { Form, useActionData, useLoaderData, useLocation, useNavigation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { AdminIcon } from "../components/admin-icons";
import { ToggleSwitch } from "../components/toggle-switch";
import { getBox, updateBox, deleteBox, getBannerImageSrc } from "../models/boxes.server";
import { getShopCurrencyCode } from "../models/shop.server";
import { withEmbeddedAppParams, withEmbeddedAppToastFromRequest } from "../utils/embedded-app";
import { getCurrencySymbol } from "../utils/currency";

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
    removeBannerImage,
    isActive: formData.get("isActive") === "true",
    giftMessageEnabled: formData.get("giftMessageEnabled") === "true",
    scopeType,
    scopeItems,
  };
  if (!data.displayTitle?.trim()) errors.displayTitle = "Display title is required";
  if (!data.itemCount || parseInt(data.itemCount) < 1) errors.itemCount = "Invalid item count";

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
const fieldStyle = {
  width: "100%", padding: "9px 12px", border: "1.5px solid #e5e7eb",
  borderRadius: "5px", fontSize: "13px", color: "#111827", background: "#fff",
  boxSizing: "border-box", outline: "none", transition: "border-color 0.15s, box-shadow 0.15s",
};
const labelStyle = {
  display: "block", fontSize: "11px", fontWeight: "700", color: "#4b5563",
  marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.6px",
};
const errorStyle = { color: "#dc2626", fontSize: "11px", marginTop: "5px", display: "flex", alignItems: "center", gap: "4px" };

const sectionHeadingStyle = {
  fontSize: "11px", fontWeight: "700", color: "#000000", textTransform: "uppercase",
  letterSpacing: "0.8px", marginBottom: "16px", paddingBottom: "10px",
  borderBottom: "1.5px solid #f3f4f6", display: "flex", alignItems: "center", gap: "8px",
};

/* ─────────────────────────── Component ─────────────────────────── */
export default function BoxSettingsPage() {
  const { box, products, collections, currencyCode } = useLoaderData();
  const actionData = useActionData();
  const location = useLocation();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";
  const isPageLoading = navigation.state !== "idle";
  const currencySymbol = getCurrencySymbol(currencyCode);

  const errors = actionData?.errors || {};

  const [options, setOptions] = useState({
    isGiftBox: box.isGiftBox, allowDuplicates: box.allowDuplicates,
    giftMessageEnabled: box.giftMessageEnabled, isActive: box.isActive,
  });
  const [itemCount, setItemCount] = useState(String(box.itemCount));
  const [priceMode, setPriceMode] = useState(box.bundlePriceType || "manual");
  const [manualPrice, setManualPrice] = useState(String(box.bundlePrice));
  const [discountType, setDiscountType] = useState(box.discountType === "buy_x_get_y" ? "none" : (box.discountType || "percent"));
  const [discountValue, setDiscountValue] = useState(box.discountValue || "10");
  const [buyQuantity, setBuyQuantity] = useState(box.buyQuantity || "1");
  const [getQuantity, setGetQuantity] = useState(box.getQuantity || "1");
  const [scope, setScope] = useState(box.scopeType || "specific_collections");
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

  const numItemCount = Math.max(1, parseInt(itemCount) || 1);
  const dynamicPrice = 0;
  const bundlePrice = priceMode === "manual" ? parseFloat(manualPrice) || 0 : dynamicPrice;

  /* ── Box Settings helpers ── */
  function toggleOption(name) { setOptions((prev) => ({ ...prev, [name]: !prev[name] })); }
  function selectScope(nextScope) {
    if (!nextScope || nextScope === scope) return;
    setScope(nextScope);
    setScopeItems([]);
  }

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
      inlineSize="medium"
      heading="MixBox – Box & Bundle Builder"
      back-url={withEmbeddedAppParams("/app/boxes", location.search)}
    >
      <style>{`
        /* ── Edit Box Responsive ── */
        .form-grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
        .form-grid-3-opts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
        .form-grid-3-scope { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
        .form-hero { padding: 24px 32px; }
        @media (max-width: 900px) {
          .form-grid-3 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .form-grid-3-opts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 640px) {
          .form-grid-3 { grid-template-columns: 1fr; }
          .form-grid-3-opts { grid-template-columns: 1fr; }
          .form-grid-3-scope { grid-template-columns: 1fr; }
          .form-hero { padding: 16px; }
        }
      `}</style>
      <s-button
        slot="primary-action"
        variant="primary"
        disabled={isSaving || undefined}
        onClick={() => { const form = document.getElementById("edit-box-form"); if (form) form.requestSubmit(); }}
      >
        {isSaving ? "Saving..." : "Save Changes"}
      </s-button>
      <s-button
        slot="secondary-action"
        onClick={() => { window.location.href = withEmbeddedAppParams("/app/boxes", location.search); }}
      >
        <AdminIcon type="arrow-left" size="small" /> Back
      </s-button>

      {/* Hero banner */}
      <div style={{ marginBottom: "20px", borderRadius: "5px", background: "#ffffff", border: "1px solid #e5e7eb", boxShadow: "0 8px 24px rgba(15,23,42,0.08)", overflow: "hidden", position: "relative" }} className="form-hero">
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: "16px" }}>
          <div style={{ flex: "1 1 420px", minWidth: "320px" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "#f3f4f6", borderRadius: "999px", padding: "4px 14px", fontSize: "10px", fontWeight: "800", letterSpacing: "0.10em", textTransform: "uppercase", color: "#000000", marginBottom: "10px" }}>
              <AdminIcon type="package" size="small" /> Edit Box
            </div>
            <div style={{ fontSize: "18px", fontWeight: "800", color: "#000000", letterSpacing: "-0.5px" }}>{box.boxName}</div>
            <div style={{ fontSize: "13px", color: "#4b5563", marginTop: "4px" }}>Update settings, pricing, and eligible products for this bundle.</div>
          </div>
          <div style={{ flex: "0 1 420px", minWidth: "320px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer", padding: "10px 12px", background: options.isActive ? "#f9fafb" : "#fff", border: `1.5px solid ${options.isActive ? "#000000" : "#e5e7eb"}`, borderRadius: "7px", transition: "border-color 0.15s, background 0.15s" }}>
              <ToggleSwitch checked={options.isActive} onChange={() => toggleOption("isActive")} showStateText={false} />
              <div>
                <div style={{ fontSize: "13px", fontWeight: "600", color: "#111827", lineHeight: 1.3, display: "flex", alignItems: "center", gap: "6px" }}>
                  <AdminIcon type="check-circle" size="small" /> Active on Storefront
                </div>
                <div style={{ fontSize: "12px", color: "#000000", marginTop: "3px" }}>Uncheck to hide from customers</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {errors._global && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "5px", padding: "12px 16px", marginBottom: "16px", color: "#991b1b", fontSize: "13px", display: "flex", alignItems: "center", gap: "8px" }}>
          <AdminIcon type="alert-triangle" size="small" />
          {errors._global}
        </div>
      )}

      <Form id="edit-box-form" method="POST" action={`/app/boxes/${box.id}${location.search ? location.search + '&index' : '?index'}`} encType="multipart/form-data">
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

        <s-section>
        {/* Basic Information */}
        <div style={{ marginBottom: "28px" }}>
          <div style={sectionHeadingStyle}><AdminIcon type="clipboard" size="small" /> Basic Information</div>
          <div className="form-grid-3">
            <div>
              <label style={labelStyle}>Heading *</label>
              <input type="text" name="displayTitle" defaultValue={box.displayTitle} style={{ ...fieldStyle, borderColor: errors.displayTitle ? "#e11d48" : "#d1d5db" }} />
              {errors.displayTitle && <div style={errorStyle}>{errors.displayTitle}</div>}
            </div>
            <div>
              <label style={labelStyle}>Combo Product Button Title</label>
              <input
                type="text"
                name="comboProductButtonTitle"
                defaultValue={box.comboProductButtonTitle || "BUILD YOUR OWN BOX"}
                placeholder="BUILD YOUR OWN BOX"
                style={{ ...fieldStyle, borderColor: "#d1d5db" }}
              />
            </div>
            <div>
              <label style={labelStyle}>Product Button Title</label>
              <input
                type="text"
                name="productButtonTitle"
                defaultValue={box.productButtonTitle || "Add To Cart"}
                placeholder="Add To Cart"
                style={{ ...fieldStyle, borderColor: "#d1d5db" }}
              />
            </div>
            <div>
              <label style={labelStyle}>Number Of Products *</label>
              <input type="number" placeholder="e.g. 4" min="1" max="20" value={itemCount} onChange={(e) => setItemCount(e.target.value)} style={{ ...fieldStyle, borderColor: errors.itemCount ? "#e11d48" : "#d1d5db" }} />
              {errors.itemCount && <div style={errorStyle}>{errors.itemCount}</div>}
            </div>
            <div>
              <label style={labelStyle}>Bundle Price ({currencySymbol}) *</label>
              <div style={{ display: "flex", border: "1px solid #d1d5db", borderRadius: "5px", overflow: "hidden", marginBottom: "10px" }}>
                {["manual", "dynamic"].map((mode) => (
                  <button key={mode} type="button" onClick={() => setPriceMode(mode)} style={{ flex: 1, padding: "7px 0", fontSize: "12px", fontWeight: "600", border: "none", cursor: "pointer", background: priceMode === mode ? "#000000" : "#f9fafb", color: priceMode === mode ? "#ffffff" : "#374151", transition: "background 0.15s" }}>
                    {mode === "manual" ? "Manual" : "Dynamic"}
                  </button>
                ))}
              </div>
              {priceMode === "manual" && (
                <input type="number" placeholder="e.g. 1200" min="0" step="0.01" value={manualPrice} onChange={(e) => setManualPrice(e.target.value)} style={{ ...fieldStyle }} />
              )}
              {priceMode === "dynamic" && (
                <div style={{ border: "1px solid #d1d5db", borderRadius: "5px", padding: "12px", background: "#ffffff" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
                    <div>
                      <label style={{ ...labelStyle, fontSize: "10px" }}>Discount Type</label>
                      <select value={discountType} onChange={(e) => setDiscountType(e.target.value)} style={{ ...fieldStyle, fontSize: "12px" }}>
                        <option value="percent">% Off Total</option>
                        <option value="fixed">{currencySymbol} Fixed Discount</option>`r`n                        <option value="none">No Discount</option>
                      </select>
                    </div>
                    {discountType !== "none" ? (
                      <div>
                        <label style={{ ...labelStyle, fontSize: "10px" }}>{discountType === "percent" ? "Discount %" : `Amount (${currencySymbol})`}</label>
                        <input type="number" min="0" step={discountType === "percent" ? "1" : "0.01"} max={discountType === "percent" ? "99" : undefined} value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} style={{ ...fieldStyle, fontSize: "12px" }} />
                      </div>
                    ) : null}
                  </div>
                  <div style={{ fontSize: "11px", color: "#000000", marginTop: "8px" }}>
                    {discountType !== "none"
                        ? <>Discount applied on total amount</>
                        : <>No discount applied</>
                    }
                  </div>
                </div>
              )}
            </div>
            <div>
              <label style={labelStyle}>Image</label>
              <input type="file" name="bannerImage" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" style={{ ...fieldStyle, padding: "7px 12px" }} />
              {box.bannerImageSrc && (
                <div style={{ marginTop: "10px" }}>
                  <img src={box.bannerImageSrc} alt="Current banner" style={{ width: "100%", maxWidth: "100px", borderRadius: "5px", border: "1px solid #e5e7eb" }} />
                </div>
              )}
              <div style={{ marginTop: "8px" }}>
                <ToggleSwitch name="removeBannerImage" value="true" label="Remove current image" showStateText={false} />
              </div>
              <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "5px" }}>JPG, PNG, WEBP, GIF, or AVIF — max 5MB</div>
              {errors.bannerImage && <div style={errorStyle}>{errors.bannerImage}</div>}
            </div>
          </div>
        </div>

        {/* Options */}
        <div style={{ marginBottom: "28px" }}>
          <div style={sectionHeadingStyle}><AdminIcon type="settings" size="small" /> Options</div>
          <div className="form-grid-3-opts">
            {[
              { key: "isGiftBox", label: "Gift Box Mode", desc: "Enables gift packaging option", iconType: "gift-card" },
              { key: "allowDuplicates", label: "Allow Duplicates", desc: "Same product in multiple slots", iconType: "duplicate" },
              { key: "giftMessageEnabled", label: "Gift Message Field", desc: "Show text area for gift message", iconType: "email" },
            ].map((opt) => (
              <div key={opt.key} style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer", padding: "12px 14px", border: options[opt.key] ? "1.5px solid #000000" : "1.5px solid #e5e7eb", borderRadius: "5px", background: options[opt.key] ? "#f9fafb" : "#fafafa", transition: "border-color 0.15s, background 0.15s" }}>
                <ToggleSwitch checked={options[opt.key]} onChange={() => toggleOption(opt.key)} showStateText={false} />
                <div>
                  <div style={{ fontSize: "13px", fontWeight: "600", color: "#000000", display: "flex", alignItems: "center", gap: "5px" }}><AdminIcon type={opt.iconType} size="small" />{opt.label}</div>
                  <div style={{ fontSize: "11px", color: "#000000", marginTop: "2px" }}>{opt.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Scope */}
        <div style={{ marginBottom: "28px" }}>
          <div style={sectionHeadingStyle}><AdminIcon type="target" size="small" /> Scope</div>
          <div style={{ marginBottom: "12px" }}>
            <label style={labelStyle}>Select Scope</label>
            <div className="form-grid-3-scope">
              {[
                { value: "specific_collections", label: "Specific collections" },
                { value: "specific_products", label: "Specific products" },
                { value: "wholestore", label: "Whole store" },
              ].map((opt) => (
                <label
                  key={opt.value}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "0 10px",
                    minHeight: "40px",
                    border: `1.5px solid ${scope === opt.value ? "#000000" : "#d1d5db"}`,
                    borderRadius: "6px",
                    background: scope === opt.value ? "#f9fafb" : "#fff",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="scope-radio"
                    value={opt.value}
                    checked={scope === opt.value}
                    onChange={() => selectScope(opt.value)}
                    style={{ width: "16px", height: "16px", accentColor: "#6b7280", cursor: "pointer", margin: 0, flexShrink: 0 }}
                  />
                  <span style={{ fontSize: "12px", color: "#4b5563", fontWeight: scope === opt.value ? "700" : "600" }}>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {scope === "wholestore" ? (
              <span style={{ fontSize: "12px", color: "#374151", fontWeight: "600" }}>All store products will be available in this combo.</span>
            ) : (
              <button
                type="button"
                onClick={() => { setScopeSearch(""); setShowScopePicker(true); }}
                style={{ padding: "8px 16px", background: "#000000", border: "1.5px solid #000000", borderRadius: "5px", fontSize: "13px", fontWeight: "600", color: "#ffffff", cursor: "pointer", transition: "background 0.12s, border-color 0.12s" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#374151"; e.currentTarget.style.borderColor = "#374151"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "#000000"; e.currentTarget.style.borderColor = "#000000"; }}
              >
                {scope === "specific_collections" ? "Select collections" : "Select products"}
              </button>
            )}
            {scope !== "wholestore" && (
              <span style={{ fontSize: "12px", color: "#000000", fontWeight: "500" }}>{`${scopeItems.length} selected`}</span>
            )}
          </div>
          {scope !== "wholestore" && scopeItems.length > 0 && (
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

        </s-section>
      </Form>

      {isPageLoading && (
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
          <s-spinner accessibilityLabel="Loading page" size="large" />
        </div>
      )}

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
                    <label key={item.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 16px", borderBottom: idx < filtered.length - 1 ? "1px solid #f3f4f6" : "none", cursor: "pointer", background: selected ? "#f9fafb" : "#fff", transition: "background 0.1s" }}>
                      <ToggleSwitch checked={selected} onChange={() => toggleScopeItem(item)} showStateText={false} />
                      {item.imageUrl
                        ? <img src={item.imageUrl} alt={item.title} style={{ width: "40px", height: "40px", objectFit: "cover", borderRadius: "5px", flexShrink: 0, border: "1px solid #e5e7eb" }} />
                        : <div style={{ width: "40px", height: "40px", borderRadius: "5px", background: "#f3f4f6", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #e5e7eb" }}><AdminIcon type={isCollections ? "folder" : "product"} size="small" /></div>
                      }
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "13px", fontWeight: "600", color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</div>
                      </div>
                      {selected && <span style={{ width: "18px", height: "18px", background: "#000000", border: "1px solid #000000", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><AdminIcon type="check" size="small" style={{ color: "#ffffff" }} /></span>}
                    </label>
                  );
                })}
              </div>
              <div style={modalFooterStyle}>
                <span style={{ fontSize: "12px", color: "#000000" }}>
                  {scopeItems.length > 0 ? `${scopeItems.length} selected` : "None selected"}
                </span>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button type="button" onClick={() => setShowScopePicker(false)} style={{ background: "#fff", border: "1.5px solid #d1d5db", borderRadius: "5px", padding: "8px 16px", fontSize: "13px", fontWeight: "500", cursor: "pointer", color: "#111827" }}>Cancel</button>
                  <button type="button" onClick={() => setShowScopePicker(false)} style={{ background: "#000000", border: "none", borderRadius: "5px", padding: "8px 20px", fontSize: "13px", fontWeight: "700", cursor: "pointer", color: "#ffffff", boxShadow: "0 1px 6px rgba(0,0,0,0.35)" }}>
                    Done{scopeItems.length > 0 ? ` (${scopeItems.length})` : ""}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}



