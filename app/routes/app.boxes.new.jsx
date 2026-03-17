import { useState, useEffect } from "react";
import { Form, useActionData, useFetcher, useLoaderData, useLocation, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { createBox, upsertComboConfig } from "../models/boxes.server";
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

const COLLECTIONS_QUERY = `#graphql
  query GetCollections($first: Int!) {
    collections(first: $first) {
      edges {
        node {
          id
          title
          handle
          image { url }
        }
      }
    }
  }
`;

const COLLECTION_PRODUCTS_QUERY = `#graphql
  query GetCollectionProducts($id: ID!, $first: Int!) {
    collection(id: $id) {
      products(first: $first) {
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
  }
`;

const MAX_BANNER_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_BANNER_MIME_TYPES = new Set([
  "image/jpeg", "image/jpg", "image/png",
  "image/webp", "image/gif", "image/avif",
]);

const DEFAULT_COMBO_CONFIG = {
  type: 2,
  title: "Build Your Perfect Bundle",
  subtitle: "Choose a product for each step",
  discountBadge: "Bundle & Save 10%",
  isActive: true,
  showProductImages: true,
  showProgressBar: true,
  allowReselection: true,
  steps: [
    { label: "Main Product",     collections: [], selectedProduct: null, popup: { title: "Choose your main product",  desc: "Select the primary product.",   btn: "Confirm selection" } },
    { label: "Add-on Accessory", collections: [], selectedProduct: null, popup: { title: "Choose an accessory",       desc: "Pick an add-on.",               btn: "Confirm selection" } },
    { label: "Extra Item",       collections: [], selectedProduct: null, popup: { title: "Choose an extra item",      desc: "Complete your bundle.",         btn: "Complete bundle"   } },
  ],
};

async function parseBannerImage(formData, errors) {
  const file = formData.get("bannerImage");
  if (!file || typeof file !== "object" || typeof file.arrayBuffer !== "function" || !file.size) return null;
  if (!ALLOWED_BANNER_MIME_TYPES.has(file.type)) { errors.bannerImage = "Only JPG, PNG, WEBP, GIF, and AVIF files are allowed"; return null; }
  if (file.size > MAX_BANNER_IMAGE_SIZE) { errors.bannerImage = "Banner image must be 5MB or smaller"; return null; }
  return { bytes: new Uint8Array(await file.arrayBuffer()), mimeType: file.type, fileName: file.name || null };
}

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);

  /* Fast path: fetch products for a specific collection (used by per-step pickers) */
  const collectionId = url.searchParams.get("collectionId");
  if (collectionId) {
    const resp = await admin.graphql(COLLECTION_PRODUCTS_QUERY, {
      variables: { id: collectionId, first: 100 },
    });
    const json = await resp.json();
    const collectionProducts = (json?.data?.collection?.products?.edges || []).map(({ node }) => ({
      id: node.id,
      title: node.title,
      handle: node.handle,
      imageUrl: node.featuredImage?.url || null,
      variantIds: (node.variants?.edges || []).map(({ node: v }) => v.id),
      variantId: node.variants?.edges?.[0]?.node?.id || null,
      price: node.variants?.edges?.[0]?.node?.price || "0",
    }));
    return { collectionProducts };
  }

  const query = url.searchParams.get("q") || "";
  const searchQuery = query ? `${query} NOT vendor:ComboBuilder` : "NOT vendor:ComboBuilder";

  const [prodResp, collResp] = await Promise.all([
    admin.graphql(PRODUCTS_QUERY, { variables: { first: 50, query: searchQuery } }),
    admin.graphql(COLLECTIONS_QUERY, { variables: { first: 50 } }),
  ]);
  const [prodJson, collJson] = await Promise.all([prodResp.json(), collResp.json()]);

  const products = (prodJson?.data?.products?.edges || []).map(({ node }) => ({
    id: node.id,
    title: node.title,
    handle: node.handle,
    imageUrl: node.featuredImage?.url || null,
    variantIds: (node.variants?.edges || []).map(({ node: variantNode }) => variantNode.id),
    variantId: node.variants?.edges?.[0]?.node?.id || null,
    price: node.variants?.edges?.[0]?.node?.price || "0",
  }));

  const collections = (collJson?.data?.collections?.edges || []).map(({ node }) => ({
    id: node.id,
    title: node.title,
    handle: node.handle,
    imageUrl: node.image?.url || null,
  }));

  return { products, collections };
};

export const action = async ({ request }) => {
  const { session, admin, redirect } = await authenticate.admin(request);
  const formData = await request.formData();

  let eligibleProducts = [];
  try { eligibleProducts = JSON.parse(formData.get("eligibleProducts") || "[]"); } catch {}
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
    const box = await createBox(session.shop, data, admin);

    /* Save combo config if provided */
    const comboStepsConfig = formData.get("comboStepsConfig");
    if (comboStepsConfig) {
      try { await upsertComboConfig(box.id, comboStepsConfig); } catch (e) {
        console.error("[app.boxes.new] upsertComboConfig error:", e);
      }
    }
  } catch (e) {
    console.error("[app.boxes.new] createBox error:", e);
    const message = e instanceof Error && e.message ? e.message : "Failed to create box. Please try again.";
    return { errors: { _global: message } };
  }

  throw redirect("/app/boxes");
};

/* ── Styles ── */
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
  fontSize: "11px", fontWeight: "700", color: "#6b7280", textTransform: "uppercase",
  letterSpacing: "0.8px", marginBottom: "16px", paddingBottom: "10px",
  borderBottom: "1.5px solid #f3f4f6", display: "flex", alignItems: "center", gap: "8px",
};

export default function CreateBoxPage() {
  const { products, collections } = useLoaderData();
  const actionData = useActionData();
  const searchFetcher = useFetcher();
  const collProdsFetcher0 = useFetcher();
  const collProdsFetcher1 = useFetcher();
  const collProdsFetcher2 = useFetcher();
  const collProdsFetchers = [collProdsFetcher0, collProdsFetcher1, collProdsFetcher2];
  const location = useLocation();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  /* ── Tab ── */
  const [activeTab, setActiveTab] = useState("settings");

  /* ── Box Settings state ── */
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [productSearch, setProductSearch] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [options, setOptions] = useState({
    isGiftBox: false, allowDuplicates: false, giftMessageEnabled: false, isActive: true,
  });
  const [itemCount, setItemCount] = useState("4");
  const [priceMode, setPriceMode] = useState("manual");
  const [manualPrice, setManualPrice] = useState("");

  const errors = actionData?.errors || {};
  const displayProducts = searchFetcher.data?.products || products;

  const numItemCount = Math.max(1, parseInt(itemCount) || 1);
  const avgProductPrice = selectedProducts.length > 0
    ? selectedProducts.reduce((s, p) => s + (parseFloat(p.price) || 0), 0) / selectedProducts.length
    : 0;
  const estimatedTotal = avgProductPrice * numItemCount;
  const bundlePrice = priceMode === "manual" ? parseFloat(manualPrice) || 0 : estimatedTotal;

  /* ── Combo Config state ── */
  const [comboConfig, setComboConfig] = useState(DEFAULT_COMBO_CONFIG);
  const [comboActiveStep, setComboActiveStep] = useState(0);

  /* Per-step scoped product lists: null = use all products */
  const [stepProducts, setStepProducts] = useState([null, null, null]);

  useEffect(() => {
    if (collProdsFetcher0.data?.collectionProducts)
      setStepProducts((p) => { const n = [...p]; n[0] = collProdsFetcher0.data.collectionProducts; return n; });
  }, [collProdsFetcher0.data]);
  useEffect(() => {
    if (collProdsFetcher1.data?.collectionProducts)
      setStepProducts((p) => { const n = [...p]; n[1] = collProdsFetcher1.data.collectionProducts; return n; });
  }, [collProdsFetcher1.data]);
  useEffect(() => {
    if (collProdsFetcher2.data?.collectionProducts)
      setStepProducts((p) => { const n = [...p]; n[2] = collProdsFetcher2.data.collectionProducts; return n; });
  }, [collProdsFetcher2.data]);

  /* collection modal */
  const [showCollModal, setShowCollModal] = useState(false);
  const [collModalStepIdx, setCollModalStepIdx] = useState(null);
  const [collSearch, setCollSearch] = useState("");
  const [tempColl, setTempColl] = useState(null);

  /* step product modal */
  const [showStepProdModal, setShowStepProdModal] = useState(false);
  const [stepProdModalIdx, setStepProdModalIdx] = useState(null);
  const [stepProdSearch, setStepProdSearch] = useState("");
  const [tempStepProd, setTempStepProd] = useState(null);

  /* ── Box Settings helpers ── */
  function handleSearchChange(e) {
    const val = e.target.value;
    setProductSearch(val);
    if (val.length > 1)
      searchFetcher.load(withEmbeddedAppParams(`/app/boxes/new?q=${encodeURIComponent(val)}`, location.search));
    else if (val.length === 0)
      searchFetcher.load(withEmbeddedAppParams("/app/boxes/new", location.search));
  }

  function toggleProduct(product) {
    setSelectedProducts((prev) => {
      const exists = prev.find((p) => p.id === product.id);
      if (exists) return prev.filter((p) => p.id !== product.id);
      return [...prev, {
        id: product.id, productId: product.id, productTitle: product.title,
        productImageUrl: product.imageUrl, productHandle: product.handle,
        variantIds: Array.isArray(product.variantIds) && product.variantIds.length > 0
          ? product.variantIds : (product.variantId ? [product.variantId] : []),
        price: parseFloat(product.price) || 0,
      }];
    });
  }

  const isSelected = (id) => selectedProducts.some((p) => p.id === id);
  function toggleOption(name) { setOptions((prev) => ({ ...prev, [name]: !prev[name] })); }

  function openPicker() {
    setProductSearch("");
    searchFetcher.load(withEmbeddedAppParams("/app/boxes/new", location.search));
    setShowPicker(true);
  }
  function closePicker() { setShowPicker(false); setProductSearch(""); }

  /* ── Combo Config helpers ── */
  function updateComboField(field, value) { setComboConfig((prev) => ({ ...prev, [field]: value })); }
  function updateComboStep(stepIdx, field, value) {
    setComboConfig((prev) => {
      const steps = prev.steps.map((s, i) => i === stepIdx ? { ...s, [field]: value } : s);
      return { ...prev, steps };
    });
  }
  function updateComboStepPopup(stepIdx, field, value) {
    setComboConfig((prev) => {
      const steps = prev.steps.map((s, i) => i === stepIdx ? { ...s, popup: { ...s.popup, [field]: value } } : s);
      return { ...prev, steps };
    });
  }

  function openCollModal(stepIdx) {
    setCollModalStepIdx(stepIdx);
    setTempColl(comboConfig.steps[stepIdx].collections[0] || null);
    setCollSearch("");
    setShowCollModal(true);
  }
  function confirmColl() {
    if (!tempColl) return;
    const stepIdx = collModalStepIdx;
    setComboConfig((prev) => {
      const steps = prev.steps.map((s, i) => {
        if (i !== stepIdx) return s;
        const already = s.collections.find((c) => c.id === tempColl.id);
        const newColls = already ? s.collections : [...s.collections, tempColl];
        return { ...s, collections: newColls, selectedProduct: null };
      });
      return { ...prev, steps };
    });
    setStepProducts((p) => { const n = [...p]; n[stepIdx] = null; return n; });
    collProdsFetchers[stepIdx].load(
      withEmbeddedAppParams(`/app/boxes/new?collectionId=${encodeURIComponent(tempColl.id)}`, location.search)
    );
    setShowCollModal(false);
  }
  function removeCollection(stepIdx, collId) {
    setComboConfig((prev) => {
      const steps = prev.steps.map((s, i) => {
        if (i !== stepIdx) return s;
        return { ...s, collections: s.collections.filter((c) => c.id !== collId), selectedProduct: null };
      });
      return { ...prev, steps };
    });
    setStepProducts((p) => { const n = [...p]; n[stepIdx] = null; return n; });
  }

  function openStepProdModal(stepIdx) {
    setStepProdModalIdx(stepIdx);
    setTempStepProd(comboConfig.steps[stepIdx].selectedProduct || null);
    setStepProdSearch("");
    const step = comboConfig.steps[stepIdx];
    if (step.collections.length > 0 && !stepProducts[stepIdx] && collProdsFetchers[stepIdx].state === "idle") {
      collProdsFetchers[stepIdx].load(
        withEmbeddedAppParams(`/app/boxes/new?collectionId=${encodeURIComponent(step.collections[0].id)}`, location.search)
      );
    }
    setShowStepProdModal(true);
  }
  function confirmStepProd() {
    updateComboStep(stepProdModalIdx, "selectedProduct", tempStepProd);
    setShowStepProdModal(false);
  }

  const filteredColls = collections.filter((c) => !collSearch || c.title.toLowerCase().includes(collSearch.toLowerCase()));
  const activeScopedProducts = stepProdModalIdx !== null ? (stepProducts[stepProdModalIdx] ?? products) : products;
  const isLoadingStepProds = stepProdModalIdx !== null && collProdsFetchers[stepProdModalIdx]?.state === "loading";
  const filteredStepProds = activeScopedProducts.filter((p) => !stepProdSearch || p.title.toLowerCase().includes(stepProdSearch.toLowerCase()));

  /* ── Shared modal styles ── */
  const modalOverlayStyle = { position: "fixed", inset: 0, background: "rgba(17,24,39,0.55)", backdropFilter: "blur(3px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" };
  const modalBoxStyle = { background: "#fff", borderRadius: "8px", width: "100%", maxWidth: "560px", maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.18)", overflow: "hidden" };
  const modalHeaderStyle = { padding: "16px 20px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#fafafa" };
  const modalBodyStyle = { flex: 1, overflowY: "auto" };
  const modalFooterStyle = { padding: "14px 16px", borderTop: "1px solid #f3f4f6", background: "#fafafa", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" };
  const modalCloseBtn = { background: "none", border: "none", cursor: "pointer", fontSize: "18px", color: "#9ca3af", padding: "4px 8px", borderRadius: "5px", lineHeight: 1 };
  const searchInputStyle = { ...fieldStyle, borderColor: "#d1d5db", paddingLeft: "14px", fontSize: "13px" };

  return (
    <s-page
      heading="Create New Box Type"
      back-url={withEmbeddedAppParams("/app/boxes", location.search)}
    >
      {/* Primary action changes per tab */}
      {activeTab === "settings" && (
        <s-button
          slot="primary-action"
          variant="primary"
          disabled={isSaving || undefined}
          onClick={() => { const form = document.getElementById("create-box-form"); if (form) form.requestSubmit(); }}
        >
          {isSaving ? "Saving..." : "Save & Publish"}
        </s-button>
      )}
      {activeTab === "combo" && (
        <s-button
          slot="primary-action"
          variant="primary"
          disabled={isSaving || undefined}
          onClick={() => { const form = document.getElementById("create-box-form"); if (form) form.requestSubmit(); }}
        >
          {isSaving ? "Saving..." : "Save & Publish"}
        </s-button>
      )}

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
        <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.65)", marginTop: "4px" }}>Set the price, item count, eligible products, and specific combo configuration.</div>
      </div>

      {/* ── Tab Nav ── */}
      <div style={{ display: "flex", borderBottom: "2px solid #e5e7eb", marginBottom: "20px", gap: "0" }}>
        {[
          { key: "settings", label: "📋 Box Settings" },
          { key: "combo",    label: "🎯 Specific Combo Box" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: "10px 20px", fontSize: "13px", fontWeight: "700", cursor: "pointer",
              border: "none", background: "none", borderBottom: activeTab === tab.key ? "2px solid #091fd6" : "2px solid transparent",
              marginBottom: "-2px", color: activeTab === tab.key ? "#091fd6" : "#6b7280",
              transition: "color 0.15s, border-color 0.15s", letterSpacing: "0.01em",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Single form wraps everything so all fields submit together */}
      <Form id="create-box-form" method="POST" encType="multipart/form-data">
        <input type="hidden" name="bundlePrice" value={bundlePrice > 0 ? bundlePrice.toFixed(2) : ""} />
        <input type="hidden" name="bundlePriceType" value={priceMode} />
        <input type="hidden" name="itemCount" value={itemCount} />
        <input type="hidden" name="eligibleProducts" value={JSON.stringify(selectedProducts)} />
        <input type="hidden" name="isGiftBox" value={String(options.isGiftBox)} />
        <input type="hidden" name="allowDuplicates" value={String(options.allowDuplicates)} />
        <input type="hidden" name="giftMessageEnabled" value={String(options.giftMessageEnabled)} />
        <input type="hidden" name="isActive" value={String(options.isActive)} />
        <input type="hidden" name="comboStepsConfig" value={JSON.stringify(comboConfig)} />

        {/* ════════════════════════════════════════
            TAB 1 — BOX SETTINGS
        ════════════════════════════════════════ */}
        {activeTab === "settings" && (
          <s-section>
            {/* Basic Information */}
            <div style={{ marginBottom: "28px" }}>
              <div style={sectionHeadingStyle}>
                <span style={{ fontSize: "15px" }}>📋</span> Basic Information
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                <div>
                  <label style={labelStyle}>Box Internal Name *</label>
                  <input type="text" name="boxName" placeholder="e.g. Box of 4 Bestsellers" style={{ ...fieldStyle, borderColor: errors.boxName ? "#e11d48" : "#d1d5db" }} />
                  {errors.boxName && <div style={errorStyle}>{errors.boxName}</div>}
                </div>
                <div>
                  <label style={labelStyle}>Display Title (Storefront) *</label>
                  <input type="text" name="displayTitle" placeholder="Shown to customers" style={{ ...fieldStyle, borderColor: errors.displayTitle ? "#e11d48" : "#d1d5db" }} />
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
                      <button key={mode} type="button" onClick={() => setPriceMode(mode)} style={{ flex: 1, padding: "7px 0", fontSize: "12px", fontWeight: "600", border: "none", cursor: "pointer", background: priceMode === mode ? "#2A7A4F" : "#f9fafb", color: priceMode === mode ? "#fff" : "#374151", transition: "background 0.15s" }}>
                        {mode === "manual" ? "Manual" : "Dynamic"}
                      </button>
                    ))}
                  </div>
                  {priceMode === "manual" && (
                    <input type="number" placeholder="e.g. 1200" min="0" step="0.01" value={manualPrice} onChange={(e) => setManualPrice(e.target.value)} style={{ ...fieldStyle, borderColor: errors.bundlePrice ? "#e11d48" : "#d1d5db" }} />
                  )}
                  {priceMode === "dynamic" && (
                    <div style={{ border: "1px solid #d1d5db", borderRadius: "5px", padding: "10px", background: "#f9fafb", fontSize: "12px", color: "#6b7280" }}>
                      Dynamic price: ₹{estimatedTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })} (avg × items)
                    </div>
                  )}
                  {errors.bundlePrice && <div style={errorStyle}>{errors.bundlePrice}</div>}
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={labelStyle}>Banner Image (optional)</label>
                  <input type="file" name="bannerImage" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" style={{ ...fieldStyle, padding: "7px 12px" }} />
                  <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "5px" }}>JPG, PNG, WEBP, GIF, or AVIF — max 5MB</div>
                  {errors.bannerImage && <div style={errorStyle}>{errors.bannerImage}</div>}
                </div>
              </div>
            </div>

            {/* Options */}
            <div style={{ marginBottom: "28px" }}>
              <div style={sectionHeadingStyle}><span style={{ fontSize: "15px" }}>⚙️</span> Options</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                {[
                  { key: "isGiftBox", label: "Gift Box Mode", desc: "Shows gift wrapping option to customers", icon: "🎁" },
                  { key: "allowDuplicates", label: "Allow Duplicates", desc: "Same product can fill multiple slots", icon: "🔁" },
                  { key: "giftMessageEnabled", label: "Gift Message Field", desc: "Show text area for gift message", icon: "✉️" },
                  { key: "isActive", label: "Active on Storefront", desc: "Uncheck to save as draft", icon: "✅" },
                ].map((opt) => (
                  <label key={opt.key} style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer", padding: "12px 14px", border: options[opt.key] ? "1.5px solid #091fd6" : "1.5px solid #e5e7eb", borderRadius: "5px", background: options[opt.key] ? "#eef1ff" : "#fafafa", transition: "border-color 0.15s, background 0.15s" }}>
                    <input type="checkbox" checked={options[opt.key]} onChange={() => toggleOption(opt.key)} style={{ marginTop: "3px", width: "14px", height: "14px", accentColor: "#091fd6", flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: "600", color: "#111827", display: "flex", alignItems: "center", gap: "5px" }}><span>{opt.icon}</span> {opt.label}</div>
                      <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "2px" }}>{opt.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Eligible Products */}
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
              {selectedProducts.length > 0 && (
                <div style={{ marginBottom: "12px", padding: "12px 14px", background: "#eef1ff", borderRadius: "5px", border: "1px solid #c7d2fe" }}>
                  <div style={{ fontSize: "10px", fontWeight: "700", color: "#091fd6", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.6px" }}>Selected Products</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {selectedProducts.map((p) => (
                      <span key={p.id} onClick={() => toggleProduct(p)} style={{ background: "linear-gradient(135deg, #091fd6 0%, #c11a10 55%, #706cd3 100%)", color: "#fff", borderRadius: "5px", padding: "4px 10px", fontSize: "12px", cursor: "pointer", display: "flex", alignItems: "center", gap: "5px", fontWeight: "500" }}>
                        {p.productTitle}<span style={{ opacity: 0.75, fontSize: "10px" }}>✕</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <button type="button" onClick={openPicker} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 18px", background: "#fff", border: "1.5px dashed #d1d5db", borderRadius: "5px", fontSize: "13px", fontWeight: "600", color: "#091fd6", cursor: "pointer", width: "100%", justifyContent: "center", transition: "border-color 0.15s, background 0.15s" }} onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#091fd6"; e.currentTarget.style.background = "#eef1ff"; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#d1d5db"; e.currentTarget.style.background = "#fff"; }}>
                <span style={{ fontSize: "16px" }}>+</span>
                {selectedProducts.length > 0 ? "Edit Product Selection" : "Select Eligible Products"}
              </button>
            </div>
          </s-section>
        )}

        {/* ════════════════════════════════════════
            TAB 2 — SPECIFIC COMBO BOX
        ════════════════════════════════════════ */}
        {activeTab === "combo" && (
          <s-section>
            {/* Info banner */}
            <div style={{ display: "flex", gap: "10px", padding: "12px 14px", borderLeft: "3px solid #458fff", background: "#f4f6f8", fontSize: "13px", marginBottom: "20px", borderRadius: "0 5px 5px 0", alignItems: "flex-start" }}>
              <span style={{ fontSize: "16px", flexShrink: 0, marginTop: "1px" }}>ℹ️</span>
              <span>Configure the step-by-step combo experience. Each step has its own <strong>collection</strong> and <strong>product</strong> picker. This will be saved together with the box settings.</span>
            </div>

            {/* 2-column layout */}
            <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: "20px", alignItems: "start" }}>

              {/* ── SIDEBAR ── */}
              <div>
                {/* Combo Configuration */}
                <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", marginBottom: "16px" }}>
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6", fontWeight: "700", fontSize: "13px", color: "#111827" }}>Combo configuration</div>
                  <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "14px" }}>
                    {/* Combo type */}
                    <div>
                      <label style={labelStyle}>Combo type</label>
                      <div style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
                        {[2, 3].map((n) => (
                          <button key={n} type="button" onClick={() => { updateComboField("type", n); if (comboActiveStep >= n) setComboActiveStep(0); }} style={{ flex: 1, padding: "7px 0", fontSize: "12px", fontWeight: "600", border: "none", borderRadius: "5px", cursor: "pointer", background: comboConfig.type === n ? "linear-gradient(135deg, #091fd6 0%, #c11a10 55%, #706cd3 100%)" : "#f3f4f6", color: comboConfig.type === n ? "#fff" : "#374151", transition: "background 0.15s" }}>
                            {n}-step
                          </button>
                        ))}
                      </div>
                      <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "5px" }}>{comboConfig.type} product selections required</div>
                    </div>
                    {/* Combo title */}
                    <div>
                      <label style={labelStyle}>Combo title</label>
                      <input value={comboConfig.title} onChange={(e) => updateComboField("title", e.target.value)} style={{ ...fieldStyle, borderColor: "#d1d5db" }} placeholder="Build Your Perfect Bundle" />
                    </div>
                    {/* Subtitle */}
                    <div>
                      <label style={labelStyle}>Subtitle</label>
                      <input value={comboConfig.subtitle} onChange={(e) => updateComboField("subtitle", e.target.value)} style={{ ...fieldStyle, borderColor: "#d1d5db" }} placeholder="Choose a product for each step" />
                    </div>
                    {/* Discount badge */}
                    <div>
                      <label style={labelStyle}>Discount badge</label>
                      <input value={comboConfig.discountBadge} onChange={(e) => updateComboField("discountBadge", e.target.value)} style={{ ...fieldStyle, borderColor: "#d1d5db" }} placeholder="e.g. Save 15%" />
                    </div>
                  </div>
                  {/* Combo active toggle */}
                  <div style={{ padding: "10px 16px", borderTop: "1px solid #f3f4f6" }}>
                    <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", padding: "8px 10px", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "5px" }}>
                      <div>
                        <div style={{ fontSize: "12px", fontWeight: "600", color: "#111827" }}>Combo active</div>
                        <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "1px" }}>Show on storefront</div>
                      </div>
                      <input type="checkbox" checked={comboConfig.isActive} onChange={(e) => updateComboField("isActive", e.target.checked)} style={{ width: "16px", height: "16px", accentColor: "#2A7A4F", cursor: "pointer" }} />
                    </label>
                  </div>
                </div>

                {/* Display Settings */}
                <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6", fontWeight: "700", fontSize: "13px", color: "#111827" }}>Display settings</div>
                  <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: "8px" }}>
                    {[
                      { key: "showProductImages", label: "Show product images" },
                      { key: "showProgressBar",   label: "Show progress bar" },
                      { key: "allowReselection",  label: "Allow re-selection", hint: "Customers can change selection" },
                    ].map((opt) => (
                      <label key={opt.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", padding: "8px 10px", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "5px" }}>
                        <div>
                          <div style={{ fontSize: "12px", fontWeight: "600", color: "#111827" }}>{opt.label}</div>
                          {opt.hint && <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "1px" }}>{opt.hint}</div>}
                        </div>
                        <input type="checkbox" checked={comboConfig[opt.key]} onChange={(e) => updateComboField(opt.key, e.target.checked)} style={{ width: "16px", height: "16px", accentColor: "#2A7A4F", cursor: "pointer" }} />
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── MAIN ── */}
              <div>
                {/* Step tabs */}
                <div style={{ display: "flex", borderBottom: "1px solid #e5e7eb", marginBottom: "16px" }}>
                  {Array.from({ length: comboConfig.type }, (_, i) => (
                    <button key={i} type="button" onClick={() => setComboActiveStep(i)} style={{ padding: "8px 16px", fontSize: "12px", fontWeight: "600", cursor: "pointer", border: "none", background: "none", borderBottom: comboActiveStep === i ? "2px solid #091fd6" : "2px solid transparent", marginBottom: "-1px", color: comboActiveStep === i ? "#091fd6" : "#6b7280", transition: "color 0.15s, border-color 0.15s" }}>
                      Step {i + 1} — {comboConfig.steps[i].label}
                    </button>
                  ))}
                </div>

                {/* Step content */}
                {(() => {
                  const ai = comboActiveStep;
                  const step = comboConfig.steps[ai];
                  return (
                    <div>
                      {/* Pickers card */}
                      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", marginBottom: "16px" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", background: "#f9fafb", borderBottom: "1px solid #f3f4f6", borderRadius: "8px 8px 0 0" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: "linear-gradient(135deg, #091fd6 0%, #c11a10 55%, #706cd3 100%)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: "700", flexShrink: 0 }}>{ai + 1}</div>
                            <div>
                              <div style={{ fontSize: "13px", fontWeight: "700", color: "#111827" }}>Step {ai + 1} — Pickers</div>
                              <div style={{ fontSize: "11px", color: "#6b7280" }}>Each step has its own independent collection and product selector</div>
                            </div>
                          </div>
                          <span style={{ fontSize: "11px", fontWeight: "600", background: "linear-gradient(135deg, #091fd6 0%, #c11a10 55%, #706cd3 100%)", color: "#fff", padding: "2px 10px", borderRadius: "10px" }}>Step {ai + 1} of {comboConfig.type}</span>
                        </div>
                        <div style={{ padding: "16px" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>

                            {/* Collection picker */}
                            <div>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                                <label style={labelStyle}>Select collection</label>
                                {step.collections.length > 0 && <span style={{ fontSize: "10px", fontWeight: "600", background: "#e0e7ff", color: "#3730a3", padding: "2px 8px", borderRadius: "10px" }}>{step.collections.length} selected</span>}
                              </div>
                              <button
                                type="button"
                                onClick={() => openCollModal(ai)}
                                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", width: "100%", padding: "9px 12px", border: step.collections.length > 0 ? "1.5px solid #091fd6" : "1.5px solid #d1d5db", borderRadius: "5px", background: step.collections.length > 0 ? "#eef1ff" : "#fff", cursor: "pointer", fontSize: "13px", textAlign: "left", color: step.collections.length > 0 ? "#091fd6" : "#6b7280", transition: "border-color 0.15s, background 0.15s" }}
                                onMouseEnter={(e) => { if (step.collections.length === 0) { e.currentTarget.style.borderColor = "#091fd6"; e.currentTarget.style.background = "#f0f4ff"; }}}
                                onMouseLeave={(e) => { if (step.collections.length === 0) { e.currentTarget.style.borderColor = "#d1d5db"; e.currentTarget.style.background = "#fff"; }}}
                              >
                                <span style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1, minWidth: 0 }}>
                                  {step.collections.length > 0 && step.collections[0].imageUrl
                                    ? <img src={step.collections[0].imageUrl} alt="" style={{ width: "20px", height: "20px", borderRadius: "3px", objectFit: "cover", flexShrink: 0, border: "1px solid #c7d2fe" }} />
                                    : <span style={{ fontSize: "15px", flexShrink: 0 }}>📁</span>}
                                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: step.collections.length > 0 ? "600" : "400" }}>
                                    {step.collections.length > 0 ? step.collections.map((c) => c.title).join(", ") : "Select collection"}
                                  </span>
                                </span>
                                <span style={{ fontSize: "11px", color: step.collections.length > 0 ? "#091fd6" : "#9ca3af", flexShrink: 0, marginLeft: "4px" }}>▾</span>
                              </button>
                              {step.collections.length > 0 && (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "6px" }}>
                                  {step.collections.map((coll) => (
                                    <span key={coll.id} style={{ display: "inline-flex", alignItems: "center", gap: "4px", background: "#eef1ff", border: "1px solid #c7d2fe", borderRadius: "4px", padding: "3px 8px", fontSize: "11px", color: "#091fd6", fontWeight: "500" }}>
                                      {coll.title}
                                      <button type="button" onClick={() => removeCollection(ai, coll.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "10px", color: "#6b7280", padding: "0 0 0 2px", lineHeight: 1 }}>✕</button>
                                    </span>
                                  ))}
                                  <button type="button" onClick={() => openCollModal(ai)} style={{ background: "none", border: "1px dashed #c7d2fe", borderRadius: "4px", padding: "3px 8px", fontSize: "11px", color: "#091fd6", cursor: "pointer" }}>+ Add</button>
                                </div>
                              )}
                              <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "4px" }}>Products from this collection appear in the Step {ai + 1} popup</div>
                            </div>

                            {/* Product picker */}
                            <div>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                                <label style={labelStyle}>Select product</label>
                                {step.selectedProduct && <span style={{ fontSize: "10px", fontWeight: "600", background: "#dcfce7", color: "#166534", padding: "2px 8px", borderRadius: "10px" }}>1 selected</span>}
                              </div>
                              <button
                                type="button"
                                onClick={() => openStepProdModal(ai)}
                                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", width: "100%", padding: "9px 12px", border: step.selectedProduct ? "1.5px solid #2A7A4F" : "1.5px solid #d1d5db", borderRadius: "5px", background: step.selectedProduct ? "#f0fdf4" : "#fff", cursor: "pointer", fontSize: "13px", textAlign: "left", color: step.selectedProduct ? "#166534" : "#6b7280", transition: "border-color 0.15s, background 0.15s" }}
                                onMouseEnter={(e) => { if (!step.selectedProduct) { e.currentTarget.style.borderColor = "#2A7A4F"; e.currentTarget.style.background = "#f0fdf4"; }}}
                                onMouseLeave={(e) => { if (!step.selectedProduct) { e.currentTarget.style.borderColor = "#d1d5db"; e.currentTarget.style.background = "#fff"; }}}
                              >
                                <span style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1, minWidth: 0 }}>
                                  {step.selectedProduct
                                    ? (step.selectedProduct.imageUrl ? <img src={step.selectedProduct.imageUrl} alt="" style={{ width: "20px", height: "20px", borderRadius: "3px", objectFit: "cover", flexShrink: 0, border: "1px solid #86efac" }} /> : <span style={{ fontSize: "15px", flexShrink: 0 }}>📦</span>)
                                    : <span style={{ fontSize: "15px", flexShrink: 0 }}>📦</span>}
                                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: step.selectedProduct ? "600" : "400" }}>
                                    {step.selectedProduct ? step.selectedProduct.title : collProdsFetchers[ai]?.state === "loading" ? "Loading…" : "Select product"}
                                  </span>
                                </span>
                                <span style={{ fontSize: "11px", color: step.selectedProduct ? "#2A7A4F" : "#9ca3af", flexShrink: 0, marginLeft: "4px" }}>▾</span>
                              </button>
                              {step.selectedProduct && (
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "6px", padding: "4px 10px", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "4px" }}>
                                  <span style={{ fontSize: "11px", color: "#166534", fontWeight: "600" }}>₹{parseFloat(step.selectedProduct.price || 0).toLocaleString("en-IN")}</span>
                                  <button type="button" onClick={() => updateComboStep(ai, "selectedProduct", null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "11px", color: "#dc2626" }}>Remove ✕</button>
                                </div>
                              )}
                              <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "4px" }}>Pre-selected product shown in this step (optional)</div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* General Settings card */}
                      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", marginBottom: "16px" }}>
                        <div style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6", fontWeight: "700", fontSize: "13px", color: "#111827" }}>Step {ai + 1} — General settings</div>
                        <div style={{ padding: "16px" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                            <div>
                              <label style={labelStyle}>Step label</label>
                              <input value={step.label} onChange={(e) => updateComboStep(ai, "label", e.target.value)} style={{ ...fieldStyle, borderColor: "#d1d5db" }} placeholder="e.g. Main Product" />
                              <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "4px" }}>Heading shown on the storefront step</div>
                            </div>
                            <div>
                              <label style={labelStyle}>Popup title</label>
                              <input value={step.popup.title} onChange={(e) => updateComboStepPopup(ai, "title", e.target.value)} style={{ ...fieldStyle, borderColor: "#d1d5db" }} placeholder="e.g. Choose your main product" />
                            </div>
                            <div>
                              <label style={labelStyle}>Popup description</label>
                              <textarea value={step.popup.desc} onChange={(e) => updateComboStepPopup(ai, "desc", e.target.value)} style={{ ...fieldStyle, borderColor: "#d1d5db", resize: "vertical", minHeight: "64px" }} placeholder="Select the primary product." />
                            </div>
                            <div>
                              <label style={labelStyle}>Confirm button text</label>
                              <input value={step.popup.btn} onChange={(e) => updateComboStepPopup(ai, "btn", e.target.value)} style={{ ...fieldStyle, borderColor: "#d1d5db" }} placeholder="e.g. Confirm selection" />
                              <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "4px" }}>CTA label inside the popup drawer</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </s-section>
        )}
      </Form>

      {/* ════════════════════════════════════════
          MODAL: Box Settings — Product Picker
      ════════════════════════════════════════ */}
      {showPicker && (
        <div style={modalOverlayStyle} onClick={(e) => { if (e.target === e.currentTarget) closePicker(); }}>
          <div style={modalBoxStyle}>
            <div style={modalHeaderStyle}>
              <div>
                <div style={{ fontSize: "15px", fontWeight: "700", color: "#111827" }}>Select Products</div>
                <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "2px" }}>{selectedProducts.length} product{selectedProducts.length !== 1 ? "s" : ""} selected</div>
              </div>
              <button type="button" onClick={closePicker} style={modalCloseBtn}>✕</button>
            </div>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6" }}>
              <input type="text" placeholder="Search products..." value={productSearch} onChange={handleSearchChange} autoFocus style={searchInputStyle} />
            </div>
            <div style={modalBodyStyle}>
              {displayProducts.length === 0 ? (
                <div style={{ padding: "40px 20px", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>No products found</div>
              ) : displayProducts.map((product, idx) => {
                const selected = isSelected(product.id);
                return (
                  <label key={product.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 16px", borderBottom: idx < displayProducts.length - 1 ? "1px solid #f3f4f6" : "none", cursor: "pointer", background: selected ? "#eef1ff" : "#fff", transition: "background 0.1s" }}>
                    <input type="checkbox" checked={selected} onChange={() => toggleProduct(product)} style={{ width: "15px", height: "15px", flexShrink: 0, accentColor: "#091fd6" }} />
                    {product.imageUrl ? <img src={product.imageUrl} alt={product.title} style={{ width: "40px", height: "40px", objectFit: "cover", borderRadius: "5px", flexShrink: 0, border: "1px solid #e5e7eb" }} /> : <div style={{ width: "40px", height: "40px", borderRadius: "5px", background: "#f3f4f6", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", border: "1px solid #e5e7eb" }}>📦</div>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "13px", fontWeight: "600", color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{product.title}</div>
                      <div style={{ fontSize: "11px", color: "#9ca3af", fontFamily: "monospace" }}>{product.handle}</div>
                    </div>
                    {product.price && parseFloat(product.price) > 0 && <div style={{ fontSize: "13px", fontWeight: "700", color: "#374151", fontFamily: "monospace", flexShrink: 0 }}>₹{parseFloat(product.price).toLocaleString("en-IN")}</div>}
                    {selected && <span style={{ width: "18px", height: "18px", background: "linear-gradient(135deg, #091fd6 0%, #c11a10 55%, #706cd3 100%)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><span style={{ color: "#fff", fontSize: "10px", fontWeight: "700" }}>✓</span></span>}
                  </label>
                );
              })}
            </div>
            <div style={modalFooterStyle}>
              <span style={{ fontSize: "12px", color: "#6b7280" }}>{selectedProducts.length > 0 ? `${selectedProducts.length} product${selectedProducts.length !== 1 ? "s" : ""} selected` : "No products selected"}</span>
              <div style={{ display: "flex", gap: "8px" }}>
                <button type="button" onClick={closePicker} style={{ background: "#fff", border: "1.5px solid #d1d5db", borderRadius: "5px", padding: "8px 16px", fontSize: "13px", fontWeight: "500", cursor: "pointer", color: "#374151" }}>Cancel</button>
                <button type="button" onClick={closePicker} style={{ background: "linear-gradient(135deg, #091fd6 0%, #c11a10 55%, #706cd3 100%)", border: "none", borderRadius: "5px", padding: "8px 20px", fontSize: "13px", fontWeight: "700", cursor: "pointer", color: "#fff", boxShadow: "0 1px 6px rgba(9,31,214,0.35)" }}>
                  Done{selectedProducts.length > 0 ? ` (${selectedProducts.length})` : ""}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════
          MODAL: Combo — Collection Picker
      ════════════════════════════════════════ */}
      {showCollModal && (
        <div style={modalOverlayStyle} onClick={(e) => { if (e.target === e.currentTarget) setShowCollModal(false); }}>
          <div style={{ ...modalBoxStyle, maxWidth: "520px" }}>
            <div style={modalHeaderStyle}>
              <div>
                <div style={{ fontSize: "15px", fontWeight: "700", color: "#111827" }}>Select collection — Step {collModalStepIdx + 1}</div>
                <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "2px" }}>{comboConfig.steps[collModalStepIdx]?.label}</div>
              </div>
              <button type="button" onClick={() => setShowCollModal(false)} style={modalCloseBtn}>✕</button>
            </div>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6" }}>
              <input type="text" placeholder="Search collections…" value={collSearch} onChange={(e) => setCollSearch(e.target.value)} autoFocus style={searchInputStyle} />
            </div>
            <div style={modalBodyStyle}>
              {filteredColls.length === 0 ? (
                <div style={{ padding: "40px 20px", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>No collections found{collSearch ? ` for "${collSearch}"` : ""}</div>
              ) : filteredColls.map((coll, idx) => {
                const isSel = tempColl?.id === coll.id;
                const alreadyAdded = collModalStepIdx !== null && comboConfig.steps[collModalStepIdx]?.collections.some((c) => c.id === coll.id) && !isSel;
                return (
                  <div key={coll.id} onClick={() => setTempColl(isSel ? null : coll)} onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background = "#eef1ff"; }} onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.background = "#fff"; }} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 16px", borderBottom: idx < filteredColls.length - 1 ? "1px solid #f3f4f6" : "none", borderLeft: isSel ? "3px solid #091fd6" : "3px solid transparent", cursor: "pointer", background: isSel ? "#eef1ff" : "#fff", transition: "background 0.1s, border-color 0.1s", userSelect: "none" }}>
                    {coll.imageUrl ? <img src={coll.imageUrl} alt={coll.title} style={{ width: "38px", height: "38px", objectFit: "cover", borderRadius: "5px", border: "1px solid #e5e7eb", flexShrink: 0 }} /> : <div style={{ width: "38px", height: "38px", borderRadius: "5px", background: "#f3f4f6", border: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", flexShrink: 0 }}>📁</div>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "13px", fontWeight: "600", color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{coll.title}</div>
                      <div style={{ fontSize: "11px", color: "#9ca3af" }}>{coll.handle}</div>
                    </div>
                    {alreadyAdded && <span style={{ fontSize: "10px", fontWeight: "600", background: "#d1fae5", color: "#065f46", padding: "2px 8px", borderRadius: "10px", flexShrink: 0 }}>Added</span>}
                    <div style={{ width: "18px", height: "18px", borderRadius: "50%", border: `2px solid ${isSel ? "#091fd6" : "#d1d5db"}`, background: isSel ? "linear-gradient(135deg, #091fd6 0%, #c11a10 55%, #706cd3 100%)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.1s" }}>
                      {isSel && <span style={{ color: "#fff", fontSize: "10px", fontWeight: "700" }}>✓</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={modalFooterStyle}>
              <span style={{ fontSize: "12px", color: "#6b7280" }}>{tempColl ? `Selected: ${tempColl.title}` : "No collection selected"}</span>
              <div style={{ display: "flex", gap: "8px" }}>
                <button type="button" onClick={() => setShowCollModal(false)} style={{ background: "#fff", border: "1.5px solid #d1d5db", borderRadius: "5px", padding: "8px 16px", fontSize: "13px", fontWeight: "500", cursor: "pointer", color: "#374151" }}>Cancel</button>
                <button type="button" disabled={!tempColl} onClick={confirmColl} style={{ background: tempColl ? "linear-gradient(135deg, #091fd6 0%, #c11a10 55%, #706cd3 100%)" : "#d1d5db", border: "none", borderRadius: "5px", padding: "8px 20px", fontSize: "13px", fontWeight: "700", cursor: tempColl ? "pointer" : "not-allowed", color: "#fff" }}>Confirm</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════
          MODAL: Combo — Step Product Picker
      ════════════════════════════════════════ */}
      {showStepProdModal && (
        <div style={modalOverlayStyle} onClick={(e) => { if (e.target === e.currentTarget) setShowStepProdModal(false); }}>
          <div style={modalBoxStyle}>
            <div style={modalHeaderStyle}>
              <div>
                <div style={{ fontSize: "15px", fontWeight: "700", color: "#111827" }}>Select product — Step {stepProdModalIdx + 1}</div>
                <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "2px" }}>
                  {stepProdModalIdx !== null && stepProducts[stepProdModalIdx]
                    ? `${stepProducts[stepProdModalIdx].length} products · scoped to collection`
                    : `All products · ${comboConfig.steps[stepProdModalIdx]?.label}`}
                </div>
              </div>
              <button type="button" onClick={() => setShowStepProdModal(false)} style={modalCloseBtn}>✕</button>
            </div>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6" }}>
              <input type="text" placeholder="Search products…" value={stepProdSearch} onChange={(e) => setStepProdSearch(e.target.value)} autoFocus style={searchInputStyle} />
            </div>
            <div style={modalBodyStyle}>
              {isLoadingStepProds ? (
                <div style={{ padding: "40px 20px", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>Loading products…</div>
              ) : filteredStepProds.length === 0 ? (
                <div style={{ padding: "40px 20px", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>No products found</div>
              ) : filteredStepProds.map((product, idx) => {
                const isSel = tempStepProd?.id === product.id;
                return (
                  <div key={product.id} onClick={() => setTempStepProd(isSel ? null : { id: product.id, title: product.title, handle: product.handle, imageUrl: product.imageUrl, price: product.price })} onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background = "#f0fdf4"; }} onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.background = "#fff"; }} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 16px", borderBottom: idx < filteredStepProds.length - 1 ? "1px solid #f3f4f6" : "none", borderLeft: isSel ? "3px solid #2A7A4F" : "3px solid transparent", cursor: "pointer", background: isSel ? "#f0fdf4" : "#fff", transition: "background 0.1s, border-color 0.1s", userSelect: "none" }}>
                    <div style={{ width: "18px", height: "18px", borderRadius: "4px", border: `2px solid ${isSel ? "#2A7A4F" : "#d1d5db"}`, background: isSel ? "#2A7A4F" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.1s" }}>
                      {isSel && <span style={{ color: "#fff", fontSize: "10px", fontWeight: "700" }}>✓</span>}
                    </div>
                    {product.imageUrl ? <img src={product.imageUrl} alt={product.title} style={{ width: "40px", height: "40px", objectFit: "cover", borderRadius: "5px", flexShrink: 0, border: "1px solid #e5e7eb" }} /> : <div style={{ width: "40px", height: "40px", borderRadius: "5px", background: "#f3f4f6", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", border: "1px solid #e5e7eb" }}>📦</div>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "13px", fontWeight: "600", color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{product.title}</div>
                      <div style={{ fontSize: "11px", color: "#9ca3af", fontFamily: "monospace" }}>{product.handle}</div>
                    </div>
                    {product.price && parseFloat(product.price) > 0 && <div style={{ fontSize: "13px", fontWeight: "700", color: "#374151", fontFamily: "monospace", flexShrink: 0 }}>₹{parseFloat(product.price).toLocaleString("en-IN")}</div>}
                  </div>
                );
              })}
            </div>
            <div style={modalFooterStyle}>
              <span style={{ fontSize: "12px", color: "#6b7280" }}>{tempStepProd ? `Selected: ${tempStepProd.title}` : "No product selected"}</span>
              <div style={{ display: "flex", gap: "8px" }}>
                <button type="button" onClick={() => setShowStepProdModal(false)} style={{ background: "#fff", border: "1.5px solid #d1d5db", borderRadius: "5px", padding: "8px 16px", fontSize: "13px", fontWeight: "500", cursor: "pointer", color: "#374151" }}>Cancel</button>
                <button type="button" disabled={!tempStepProd} onClick={confirmStepProd} style={{ background: tempStepProd ? "linear-gradient(135deg, #091fd6 0%, #c11a10 55%, #706cd3 100%)" : "#d1d5db", border: "none", borderRadius: "5px", padding: "8px 20px", fontSize: "13px", fontWeight: "700", cursor: tempStepProd ? "pointer" : "not-allowed", color: "#fff" }}>Confirm selection</button>
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
