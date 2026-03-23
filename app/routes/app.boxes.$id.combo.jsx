import { useState, useMemo, useEffect } from "react";
import { useActionData, useFetcher, useLoaderData, useLocation, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { Buffer } from "node:buffer";
import { AdminIcon } from "../components/admin-icons";
import { getBox, upsertComboConfig, addComboStepImagesToProduct, saveComboStepImages, getComboStepImages, deleteComboStepImage } from "../models/boxes.server";
import { withEmbeddedAppParams } from "../utils/embedded-app";
import { validateComboConfig } from "../utils/combo-config";

/* ─────────────────────────── GraphQL ─────────────────────────── */
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

/* ─────────────────────────── Constants ─────────────────────────── */
const DEFAULT_COMBO_CONFIG = {
  type: 2,
  title: "Build Your Perfect Bundle",
  subtitle: "",
  bundlePrice: 0,
  bundlePriceType: "manual",
  discountType: "percent",
  discountValue: "10",
  isActive: true,
  showProductImages: true,
  showProgressBar: true,
  allowReselection: true,
  steps: [
    { label: "Main Product",      scope: "collection", collections: [], selectedProducts: [], popup: { title: "Choose your main product",  desc: "Select the primary product.",     btn: "Confirm selection" } },
    { label: "Add-on Accessory",  scope: "collection", collections: [], selectedProducts: [], popup: { title: "Choose an accessory",       desc: "Pick an add-on.",                 btn: "Confirm selection" } },
    { label: "Extra Item",        scope: "collection", collections: [], selectedProducts: [], popup: { title: "Choose an extra item",      desc: "Complete your bundle.",           btn: "Complete bundle"   } },
  ],
};

/* ─────────────────────────── Loader ─────────────────────────── */
export const loader = async ({ request, params }) => {
  const { admin, session, redirect } = await authenticate.admin(request);
  const shop = session.shop;

  /* ── Fast path: fetch products for a specific collection (used by per-step pickers) ── */
  const url = new URL(request.url);
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

  const box = await getBox(params.id, shop);
  if (!box) throw redirect("/app/boxes");
  const boxWithoutBinary = { ...box };
  delete boxWithoutBinary.bannerImageData;
  delete boxWithoutBinary.bannerImageMimeType;
  delete boxWithoutBinary.bannerImageFileName;

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
    variantIds: (node.variants?.edges || []).map(({ node: v }) => v.id),
    variantId: node.variants?.edges?.[0]?.node?.id || null,
    price: node.variants?.edges?.[0]?.node?.price || "0",
  }));

  const collections = (collJson?.data?.collections?.edges || []).map(({ node }) => ({
    id: node.id,
    title: node.title,
    handle: node.handle,
    imageUrl: node.image?.url || null,
  }));

  /* Build comboStepsConfig from the new ComboBoxConfig model (primary),
     falling back to the legacy JSON blob for boxes saved before migration. */
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

  const rawStepImages = await getComboStepImages(params.id);
  const stepImagesBase64 = rawStepImages.map((img) => ({
    stepIndex: img.stepIndex,
    mimeType: img.mimeType,
    src: img.imageData ? `data:${img.mimeType};base64,${Buffer.from(img.imageData).toString("base64")}` : null,
  }));

  return {
    box: { ...boxWithoutBinary, comboStepsConfig },
    products,
    collections,
    stepImagesBase64,
  };
};

/* ─────────────────────────── Step Image Helpers ─────────────────────────── */
const MAX_STEP_IMAGE_SIZE = 2 * 1024 * 1024;
const ALLOWED_STEP_IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "image/avif"]);

async function parseStepImages(formData) {
  const images = [];
  for (let i = 0; i < 3; i++) {
    const file = formData.get(`stepImage_${i}`);
    if (!file || typeof file !== "object" || typeof file.arrayBuffer !== "function" || !file.size) { images.push(null); continue; }
    if (!ALLOWED_STEP_IMAGE_TYPES.has(file.type)) { images.push({ stepIndex: i, error: "Only JPG, PNG, WEBP, GIF, or AVIF files are allowed" }); continue; }
    if (file.size > MAX_STEP_IMAGE_SIZE) { images.push({ stepIndex: i, error: "Step image must be 2MB or smaller" }); continue; }
    images.push({ stepIndex: i, bytes: new Uint8Array(await file.arrayBuffer()), mimeType: file.type, fileName: file.name || null });
  }
  return images;
}

/* ─────────────────────────── Action ─────────────────────────── */
export const action = async ({ request, params }) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("_action");

  if (intent === "save_combo") {
    const comboStepsConfig = formData.get("comboStepsConfig");
    const comboValidation = validateComboConfig(comboStepsConfig);

    // Parse step images
    const stepImages = await parseStepImages(formData);
    const stepImgErrors = {};
    for (const img of stepImages) {
      if (img?.error) stepImgErrors[`stepImage_${img.stepIndex}`] = img.error;
    }

    if (comboValidation || Object.keys(stepImgErrors).length > 0) {
      return {
        ok: false,
        errors: {
          ...(comboValidation ? { comboConfig: comboValidation.form, comboStepSelections: comboValidation.stepSelections } : {}),
          ...stepImgErrors,
        },
      };
    }
    await upsertComboConfig(params.id, comboStepsConfig);

    // Save uploaded step images
    const validStepImages = stepImages.filter((img) => img && !img.error);
    if (validStepImages.length > 0) {
      try { await saveComboStepImages(params.id, validStepImages); } catch (e) {
        console.error("[app.boxes.$id.combo] saveComboStepImages error:", e);
      }
    }

    // Sync step product/collection images to the Shopify bundle product
    const box = await getBox(params.id, session.shop);
    if (box?.shopifyProductId) {
      try {
        await addComboStepImagesToProduct(admin, box.shopifyProductId, comboStepsConfig);
      } catch (e) {
        console.error("[app.boxes.$id.combo] addComboStepImagesToProduct error:", e);
      }
    }

    return { ok: true, comboSaved: true };
  }

  if (intent === "remove_step_image") {
    const stepIndex = parseInt(formData.get("stepIndex"));
    if (!isNaN(stepIndex)) {
      await deleteComboStepImage(params.id, stepIndex);
    }
    return { ok: true, stepImageRemoved: stepIndex };
  }

  return { ok: false, errors: { _global: "Unknown action" } };
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

/* ─────────────────────────── Component ─────────────────────────── */
export default function SpecificComboBoxPage() {
  const { box, products, collections, stepImagesBase64 } = useLoaderData();
  const actionData = useActionData();
  const comboFetcher = useFetcher();
  const removeImageFetcher = useFetcher();
  /* One fetcher per step for lazy-loading collection-scoped products */
  const collProdsFetcher0 = useFetcher();
  const collProdsFetcher1 = useFetcher();
  const collProdsFetcher2 = useFetcher();
  const collProdsFetchers = [collProdsFetcher0, collProdsFetcher1, collProdsFetcher2];
  const location = useLocation();

  const comboErrors = comboFetcher.data?.errors || {};
  const comboFormError = comboErrors.comboConfig;
  const comboStepErrors = comboErrors.comboStepSelections || {};
  const comboStepImgErrors = Object.fromEntries(Object.entries(comboErrors).filter(([k]) => k.startsWith("stepImage_")));
  const comboSaved = comboFetcher.data?.comboSaved && !comboFetcher.data?.errors;

  // Sync removed image back into preview state
  const removedStepIndex = removeImageFetcher.data?.stepImageRemoved;
  if (removedStepIndex !== undefined && stepImagePreviews[removedStepIndex] !== null) {
    setStepImagePreviews((p) => { const n = [...p]; n[removedStepIndex] = null; return n; });
  }

  /* ── Combo Config state ── */
  const [comboConfig, setComboConfig] = useState(() => {
    // Primary: raw JSON saved on ComboBox row
    if (box.comboStepsConfig) {
      try { return { ...DEFAULT_COMBO_CONFIG, ...JSON.parse(box.comboStepsConfig) }; } catch {}
    }
    // Fallback: ComboBoxConfig relation (for records saved before the comboStepsConfig sync was added)
    if (box.config) {
      try {
        return {
          ...DEFAULT_COMBO_CONFIG,
          type:             box.config.comboType          ?? DEFAULT_COMBO_CONFIG.type,
          title:            box.config.title              ?? DEFAULT_COMBO_CONFIG.title,
          subtitle:         box.config.subtitle           ?? DEFAULT_COMBO_CONFIG.subtitle,
          bundlePrice:      box.config.bundlePrice != null ? parseFloat(box.config.bundlePrice) : DEFAULT_COMBO_CONFIG.bundlePrice,
          bundlePriceType:  box.config.bundlePriceType    ?? DEFAULT_COMBO_CONFIG.bundlePriceType,
          isActive:         box.config.isActive,
          showProductImages:box.config.showProductImages,
          showProgressBar:  box.config.showProgressBar,
          allowReselection: box.config.allowReselection,
          steps: box.config.stepsJson
            ? JSON.parse(box.config.stepsJson)
            : DEFAULT_COMBO_CONFIG.steps,
        };
      } catch {}
    }
    return DEFAULT_COMBO_CONFIG;
  });
  const [comboActiveStep, setComboActiveStep] = useState(0);

  /* Per-step uploaded image previews (data URLs) */
  const [stepImagePreviews, setStepImagePreviews] = useState(() => {
    const arr = [null, null, null];
    for (const img of stepImagesBase64 || []) {
      if (img.stepIndex >= 0 && img.stepIndex < 3 && img.src) arr[img.stepIndex] = img.src;
    }
    return arr;
  });

  /* Per-step scoped product lists: null = use all products (no collection selected) */
  const [stepProducts, setStepProducts] = useState([null, null, null]);

  /* Sync each step fetcher result into stepProducts */
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
  const [tempColls, setTempColls] = useState([]);

  /* step product modal */
  const [showStepProdModal, setShowStepProdModal] = useState(false);
  const [stepProdModalIdx, setStepProdModalIdx] = useState(null);
  const [stepProdSearch, setStepProdSearch] = useState("");
  const [tempStepProds, setTempStepProds] = useState([]);

  /* ── Combo Config helpers ── */
  function updateComboField(field, value) { setComboConfig((prev) => ({ ...prev, [field]: value })); }

  // comboDynamicPrice — uses products from stepProducts or all products for pricing reference
  const comboDynamicPrice = useMemo(() => {
    // Use average of all available products as a rough estimate
    const allProds = products || [];
    const avgPrice = allProds.length > 0 ? allProds.reduce((s, p) => s + (parseFloat(p.price) || 0), 0) / allProds.length : 0;
    const estimatedTotal = avgPrice * (comboConfig.type || 2);
    if (estimatedTotal <= 0) return 0;
    const val = parseFloat(comboConfig.discountValue) || 0;
    if (comboConfig.discountType === "percent") return Math.max(0, estimatedTotal * (1 - val / 100));
    if (comboConfig.discountType === "fixed") return Math.max(0, estimatedTotal - val);
    return estimatedTotal;
  }, [products, comboConfig.type, comboConfig.discountType, comboConfig.discountValue]);

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

  /* collection modal helpers */
  function confirmColl() {
    if (tempColls.length === 0) return;
    const stepIdx = collModalStepIdx;
    setComboConfig((prev) => {
      const steps = prev.steps.map((s, i) => {
        if (i !== stepIdx) return s;
        return { ...s, collections: tempColls, selectedProducts: [] };
      });
      return { ...prev, steps };
    });
    setStepProducts((p) => { const n = [...p]; n[stepIdx] = null; return n; });
    collProdsFetchers[stepIdx].load(
      withEmbeddedAppParams(`/app/boxes/${box.id}/combo?collectionId=${encodeURIComponent(tempColls[0].id)}`, location.search)
    );
    setShowCollModal(false);
  }
  function confirmStepProd() {
    updateComboStep(stepProdModalIdx, "selectedProducts", tempStepProds);
    setShowStepProdModal(false);
  }

  const filteredColls = collections.filter((c) => !collSearch || c.title.toLowerCase().includes(collSearch.toLowerCase()));
  /* Use collection-scoped products when available, else fall back to all products */
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

  /* ─────────────── Render ─────────────── */
  return (
    <s-page
      heading={`Specific Combo Box: ${box.boxName}`}
      back-url={withEmbeddedAppParams(`/app/boxes/${box.id}`, location.search)}
    >
      {/* Hero banner */}
      <div style={{ marginBottom: "20px", borderRadius: "5px", background: "#ffffff", border: "1px solid #e5e7eb", boxShadow: "0 8px 24px rgba(15,23,42,0.06)", overflow: "hidden", position: "relative", padding: "24px 32px" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "#f3f4f6", backdropFilter: "blur(4px)", borderRadius: "999px", padding: "4px 14px", fontSize: "10px", fontWeight: "800", letterSpacing: "0.10em", textTransform: "uppercase", color: "#000000", marginBottom: "10px" }}><AdminIcon type="target" size="small" /> Specific Combo Box</div>
        <div style={{ fontSize: "18px", fontWeight: "800", color: "#000000", letterSpacing: "-0.5px" }}>{box.boxName}</div>
        <div style={{ fontSize: "13px", color: "#4b5563", marginTop: "4px" }}>Configure combo steps, collections, and product pickers for this box.</div>
      </div>

    <s-section>
      {comboFormError && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "5px", padding: "10px 16px", marginBottom: "16px", color: "#991b1b", fontSize: "13px", display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "15px" }}>!</span>
          {comboFormError}
        </div>
      )}
      {comboSaved && (
        <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "5px", padding: "10px 16px", marginBottom: "16px", color: "#166534", fontSize: "13px", display: "flex", alignItems: "center", gap: "8px" }}>
          <AdminIcon type="check-circle" size="small" /> Combo configuration saved successfully.
        </div>
      )}

      {/* Hidden form for saving (encType for file uploads) */}
      <comboFetcher.Form id="combo-config-form" method="POST" encType="multipart/form-data" action={`/app/boxes/${box.id}/combo${location.search}`}>
        <input type="hidden" name="_action" value="save_combo" />
        <input type="hidden" name="comboStepsConfig" value={JSON.stringify({ ...comboConfig, bundlePrice: comboConfig.bundlePriceType === "dynamic" ? comboDynamicPrice : parseFloat(comboConfig.bundlePrice) || 0 })} />
        {/* Step image file inputs — associated with this form but rendered near their UI via form= attribute */}
      </comboFetcher.Form>

      {/* Remove-image fetcher form (hidden) */}
      <removeImageFetcher.Form id="remove-step-image-form" method="POST" action={`/app/boxes/${box.id}/combo${location.search}`} style={{ display: "none" }}>
        <input type="hidden" name="_action" value="remove_step_image" />
        <input id="remove-step-image-index" type="hidden" name="stepIndex" value="" />
      </removeImageFetcher.Form>

      {/* Save button at top */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "20px" }}>
        <button type="button" onClick={() => { const f = document.getElementById("combo-config-form"); if (f) f.requestSubmit(); }} style={{ background: "#000000", color: "#ffffff", border: "none", borderRadius: "6px", padding: "10px 24px", fontSize: "14px", fontWeight: "700", cursor: "pointer" }}>
          {comboFetcher.state === "submitting" ? "Saving..." : "Save Combo Config"}
        </button>
      </div>

      {/* Info banner */}
      <div style={{ display: "flex", gap: "10px", padding: "12px 14px", borderLeft: "3px solid #458fff", background: "#f4f6f8", fontSize: "13px", marginBottom: "20px", borderRadius: "0 5px 5px 0", alignItems: "flex-start" }}>
        <AdminIcon type="info" size="small" style={{ marginTop: "1px" }} />
        <span>Each step has its own <strong>Select Collection</strong> and <strong>Select Product</strong> picker. Collections and products are independent per step.</span>
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
                    <button key={n} type="button" onClick={() => { updateComboField("type", n); if (comboActiveStep >= n) setComboActiveStep(0); }} style={{ flex: 1, padding: "7px 0", fontSize: "12px", fontWeight: "600", border: "none", borderRadius: "5px", cursor: "pointer", background: comboConfig.type === n ? "#000000" : "#f3f4f6", color: comboConfig.type === n ? "#ffffff" : "#374151", transition: "background 0.15s" }}>
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
              {/* Bundle Price */}
              <div>
                <label style={labelStyle}>Bundle Price (₹) *</label>
                <div style={{ display: "flex", border: "1px solid #d1d5db", borderRadius: "5px", overflow: "hidden", marginBottom: "8px" }}>
                  {["manual", "dynamic"].map((mode) => (
                    <button key={mode} type="button" onClick={() => updateComboField("bundlePriceType", mode)} style={{ flex: 1, padding: "6px 0", fontSize: "12px", fontWeight: "600", border: "none", cursor: "pointer", background: comboConfig.bundlePriceType === mode ? "#000000" : "#f9fafb", color: comboConfig.bundlePriceType === mode ? "#ffffff" : "#374151", transition: "background 0.15s" }}>
                      {mode === "manual" ? "Manual" : "Dynamic"}
                    </button>
                  ))}
                </div>
                {comboConfig.bundlePriceType === "manual" && (
                  <input type="number" placeholder="e.g. 1200" min="0" step="0.01" value={comboConfig.bundlePrice || ""} onChange={(e) => updateComboField("bundlePrice", e.target.value)} style={{ ...fieldStyle, borderColor: "#d1d5db" }} />
                )}
                {comboConfig.bundlePriceType === "dynamic" && (
                  <div style={{ border: "1px solid #d1d5db", borderRadius: "5px", padding: "10px", background: "#f9fafb" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
                      <div>
                        <label style={{ ...labelStyle, fontSize: "10px" }}>Discount Type</label>
                        <select value={comboConfig.discountType} onChange={(e) => updateComboField("discountType", e.target.value)} style={{ ...fieldStyle, fontSize: "12px" }}>
                          <option value="percent">% Off Total</option>
                          <option value="fixed">₹ Fixed Discount</option>
                          <option value="none">No Discount</option>
                        </select>
                      </div>
                      {comboConfig.discountType !== "none" && (
                        <div>
                          <label style={{ ...labelStyle, fontSize: "10px" }}>{comboConfig.discountType === "percent" ? "Discount %" : "Amount (₹)"}</label>
                          <input type="number" min="0" step={comboConfig.discountType === "percent" ? "1" : "0.01"} max={comboConfig.discountType === "percent" ? "99" : undefined} value={comboConfig.discountValue} onChange={(e) => updateComboField("discountValue", e.target.value)} style={{ ...fieldStyle, fontSize: "12px" }} />
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: "11px", color: "#6b7280" }}>Price: ₹{comboDynamicPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
                  </div>
                )}
              </div>
            </div>
            {/* Combo active toggle */}
            <div style={{ padding: "10px 16px", borderTop: "1px solid #f3f4f6" }}>
              <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", padding: "8px 10px", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "5px" }}>
                <div>
                  <div style={{ fontSize: "12px", fontWeight: "600", color: "#111827" }}>Combo active</div>
                  <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "1px" }}>Show on storefront</div>
                </div>
                <input type="checkbox" checked={comboConfig.isActive} onChange={(e) => updateComboField("isActive", e.target.checked)} style={{ width: "16px", height: "16px", accentColor: "#000000", cursor: "pointer" }} />
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
                  <input type="checkbox" checked={comboConfig[opt.key]} onChange={(e) => updateComboField(opt.key, e.target.checked)} style={{ width: "16px", height: "16px", accentColor: "#000000", cursor: "pointer" }} />
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
              <button key={i} type="button" onClick={() => setComboActiveStep(i)} style={{ padding: "8px 16px", fontSize: "12px", fontWeight: "600", cursor: "pointer", border: "none", borderRadius: "6px 6px 0 0", background: comboActiveStep === i ? "#000000" : comboStepErrors[i] ? "#fff5f5" : "#f9fafb", borderBottom: comboActiveStep === i ? "2px solid #000000" : comboStepErrors[i] ? "2px solid #dc2626" : "2px solid transparent", marginBottom: "-1px", color: comboStepErrors[i] ? "#dc2626" : comboActiveStep === i ? "#ffffff" : "#6b7280", transition: "color 0.15s, border-color 0.15s, background 0.15s" }}>
                {comboConfig.steps[i].label || "Untitled step"}
              </button>
            ))}
          </div>

          {/* Step content */}
          {(() => {
            const ai = comboActiveStep;
            const step = comboConfig.steps[ai];
            return (
              <div>
                {/* ── Pickers card ── */}
                <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", marginBottom: "16px" }}>
                  {/* Step header */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", background: "#f9fafb", borderBottom: "1px solid #f3f4f6", borderRadius: "8px 8px 0 0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <AdminIcon type="target" size="small" />
                      <div>
                        <div style={{ fontSize: "13px", fontWeight: "700", color: "#111827" }}>Picker setup</div>
                        <div style={{ fontSize: "11px", color: "#6b7280" }}>Each step has its own independent collection and product selector</div>
                      </div>
                    </div>
                  </div>
                  <div style={{ padding: "16px" }}>
                    <label style={labelStyle}>Scope</label>
                    <div style={{ position: "relative", marginBottom: "10px" }}>
                      <select
                        value={step.scope || "collection"}
                        onChange={(e) => {
                          const newScope = e.target.value;
                          setComboConfig((prev) => {
                            const steps = prev.steps.map((s, i) => i !== ai ? s : { ...s, scope: newScope, collections: [], selectedProducts: [] });
                            return { ...prev, steps };
                          });
                        }}
                        style={{ width: "100%", padding: "9px 32px 9px 12px", border: "1.5px solid #d1d5db", borderRadius: "6px", background: "#fff", fontSize: "13px", color: "#374151", cursor: "pointer", appearance: "none", WebkitAppearance: "none", outline: "none" }}
                      >
                        <option value="collection">Specific collections</option>
                        <option value="product">Specific products</option>
                      </select>
                      <span style={{ position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)", fontSize: "13px", color: "#6b7280", pointerEvents: "none" }}>⌃⌄</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      {(step.scope || "collection") === "collection" ? (
                        <button
                          type="button"
                          onClick={() => { setCollModalStepIdx(ai); setTempColls([...step.collections]); setCollSearch(""); setShowCollModal(true); }}
                          style={{ padding: "7px 16px", border: "1px solid #000000", borderRadius: "5px", background: "#000000", fontSize: "13px", color: "#ffffff", cursor: "pointer", fontWeight: "500" }}
                        >
                          Select collections
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => { setStepProdModalIdx(ai); setTempStepProds([...(step.selectedProducts || [])]); setStepProdSearch(""); setShowStepProdModal(true); }}
                          style={{ padding: "7px 16px", border: "1px solid #000000", borderRadius: "5px", background: "#000000", fontSize: "13px", color: "#ffffff", cursor: "pointer", fontWeight: "500" }}
                        >
                          Select products
                        </button>
                      )}
                      <span style={{ fontSize: "13px", color: "#6b7280" }}>
                        {(step.scope || "collection") === "collection"
                          ? `${step.collections.length} selected`
                          : `${(step.selectedProducts || []).length} selected`}
                      </span>
                    </div>
                    {comboStepErrors[ai] && (
                      <div style={{ color: "#e11d48", fontSize: "12px", marginTop: "10px", padding: "8px 12px", background: "#fff5f5", borderRadius: "5px", border: "1px solid #fecaca" }}>
                        {comboStepErrors[ai]}
                      </div>
                    )}
                    {step.collections.length > 0 && (step.scope || "collection") === "collection" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "8px" }}>
                        {step.collections.map((c) => (
                          <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", background: "#000000", border: "1.5px solid #000000", borderRadius: "5px" }}>
                            <span style={{ fontSize: "12px", color: "#ffffff", fontWeight: "600", display: "inline-flex", alignItems: "center", gap: "6px" }}><AdminIcon type="folder" size="small" style={{ color: "#ffffff" }} /> {c.title}</span>
                            <button type="button" aria-label={`Remove ${c.title}`} onClick={() => updateComboStep(ai, "collections", step.collections.filter((x) => x.id !== c.id))} style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><AdminIcon type="x" size="small" style={{ color: "#dc2626" }} /></button>
                          </div>
                        ))}
                      </div>
                    )}
                    {(step.selectedProducts || []).length > 0 && (step.scope || "collection") === "product" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "6px" }}>
                        {step.selectedProducts.map((p) => (
                          <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", background: "#000000", border: "1.5px solid #000000", borderRadius: "5px" }}>
                            <span style={{ fontSize: "12px", color: "#ffffff", fontWeight: "600", display: "inline-flex", alignItems: "center", gap: "6px" }}><AdminIcon type="product" size="small" style={{ color: "#ffffff" }} /> {p.title} — ₹{parseFloat(p.price || 0).toLocaleString("en-IN")}</span>
                            <button type="button" aria-label={`Remove ${p.title}`} onClick={() => updateComboStep(ai, "selectedProducts", step.selectedProducts.filter((x) => x.id !== p.id))} style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><AdminIcon type="x" size="small" style={{ color: "#dc2626" }} /></button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* ── General Settings card ── */}
                <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", marginBottom: "16px" }}>
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6", fontWeight: "700", fontSize: "13px", color: "#111827" }}>General settings</div>
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

                {/* ── Step Image Upload card ── */}
                <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", marginBottom: "16px" }}>
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6", fontWeight: "700", fontSize: "13px", color: "#111827", display: "flex", alignItems: "center", gap: "8px" }}>
                    <AdminIcon type="image" size="small" /> Step image
                  </div>
                  <div style={{ padding: "16px" }}>
                    {stepImagePreviews[ai] ? (
                      <div style={{ marginBottom: "14px" }}>
                        <div style={{ position: "relative", display: "inline-block" }}>
                          <img src={stepImagePreviews[ai]} alt="Preview" style={{ maxWidth: "100%", maxHeight: "180px", objectFit: "cover", borderRadius: "6px", border: "1.5px solid #e5e7eb", display: "block" }} />
                          <button
                            type="button"
                            aria-label="Remove step image"
                            onClick={() => {
                              // Remove from preview
                              setStepImagePreviews((p) => { const n = [...p]; n[ai] = null; return n; });
                              // Submit remove request
                              const idx = document.getElementById("remove-step-image-index");
                              if (idx) idx.value = String(ai);
                              const f = document.getElementById("remove-step-image-form");
                              if (f) f.requestSubmit();
                            }}
                            style={{ position: "absolute", top: "6px", right: "6px", background: "rgba(220,38,38,0.9)", border: "none", borderRadius: "50%", width: "22px", height: "22px", color: "#fff", fontSize: "12px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}
                          ><AdminIcon type="x" size="small" style={{ color: "#ffffff" }} /></button>
                        </div>
                        <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "6px" }}>Upload a new file below to replace this image.</div>
                      </div>
                    ) : (
                      <div style={{ marginBottom: "10px", padding: "20px", border: "2px dashed #e5e7eb", borderRadius: "6px", textAlign: "center", color: "#9ca3af", fontSize: "12px" }}>
                        No image uploaded yet
                      </div>
                    )}
                    <label style={labelStyle}>Upload step image (optional)</label>
                    {/* All 3 inputs — active step shown, others hidden but included via form= */}
                    {[0, 1, 2].map((si) => (
                      <input
                        key={si}
                        type="file"
                        name={`stepImage_${si}`}
                        form="combo-config-form"
                        accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                        style={{ display: si === ai ? "block" : "none", ...fieldStyle, padding: "7px 12px" }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = (ev) => setStepImagePreviews((p) => { const n = [...p]; n[si] = ev.target.result; return n; });
                          reader.readAsDataURL(file);
                        }}
                      />
                    ))}
                    <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "6px" }}>JPG, PNG, WEBP, GIF, or AVIF — max 2MB. Shown on storefront step card.</div>
                    {comboStepImgErrors[`stepImage_${ai}`] && (
                      <div style={{ ...errorStyle, marginTop: "6px" }}><AdminIcon type="alert-triangle" size="small" /> {comboStepImgErrors[`stepImage_${ai}`]}</div>
                    )}
                  </div>
                </div>

              </div>
            );
          })()}
        </div>
      </div>

      {/* ════════════════════════════════════════
          MODAL: Combo — Collection Picker
      ════════════════════════════════════════ */}
      {showCollModal && (
        <div style={modalOverlayStyle} onClick={(e) => { if (e.target === e.currentTarget) setShowCollModal(false); }}>
          <div style={{ ...modalBoxStyle, maxWidth: "520px" }}>
            <div style={modalHeaderStyle}>
              <div>
                <div style={{ fontSize: "15px", fontWeight: "700", color: "#111827" }}>Select collection</div>
                <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "2px" }}>
                  {comboConfig.steps[collModalStepIdx]?.label}
                </div>
              </div>
              <button type="button" aria-label="Close collection picker" onClick={() => setShowCollModal(false)} style={{ ...modalCloseBtn, display: "inline-flex", alignItems: "center", justifyContent: "center" }}><AdminIcon type="x" size="small" style={{ color: "#9ca3af" }} /></button>
            </div>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6" }}>
              <input type="text" placeholder="Search collections…" value={collSearch} onChange={(e) => setCollSearch(e.target.value)} autoFocus style={searchInputStyle} />
            </div>
            <div style={modalBodyStyle}>
              {filteredColls.length === 0 ? (
                <div style={{ padding: "40px 20px", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>No collections found{collSearch ? ` for "${collSearch}"` : ""}</div>
              ) : filteredColls.map((coll, idx) => {
                const isSelected = tempColls.some((c) => c.id === coll.id);
                const alreadyAdded = comboConfig.steps.some((step, stepIdx) =>
                  stepIdx !== collModalStepIdx &&
                  Array.isArray(step.collections) &&
                  step.collections.some((selectedColl) => selectedColl.id === coll.id)
                );
                return (
                  <div key={coll.id} onClick={() => setTempColls(isSelected ? tempColls.filter((c) => c.id !== coll.id) : [...tempColls, coll])} onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "#f3f4f6"; }} onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "#fff"; }} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 16px", borderBottom: idx < filteredColls.length - 1 ? "1px solid #f3f4f6" : "none", borderLeft: isSelected ? "3px solid #000000" : "3px solid transparent", cursor: "pointer", background: isSelected ? "#000000" : "#fff", transition: "background 0.1s, border-color 0.1s", userSelect: "none" }}>
                    {coll.imageUrl ? <img src={coll.imageUrl} alt={coll.title} style={{ width: "38px", height: "38px", objectFit: "cover", borderRadius: "5px", border: "1px solid #e5e7eb", flexShrink: 0 }} /> : <div style={{ width: "38px", height: "38px", borderRadius: "5px", background: "#f3f4f6", border: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><AdminIcon type="folder" size="small" /></div>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "13px", fontWeight: "600", color: isSelected ? "#ffffff" : "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{coll.title}</div>
                      <div style={{ fontSize: "11px", color: isSelected ? "rgba(255,255,255,0.7)" : "#9ca3af" }}>{coll.handle}</div>
                    </div>
                    {alreadyAdded && <span style={{ fontSize: "10px", fontWeight: "600", background: "#d1fae5", color: "#065f46", padding: "2px 8px", borderRadius: "10px", flexShrink: 0 }}>Added</span>}
                    <div style={{ width: "18px", height: "18px", borderRadius: "50%", border: `2px solid ${isSelected ? "#000000" : "#d1d5db"}`, background: isSelected ? "#ffffff" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.1s" }}>
                      {isSelected && <AdminIcon type="check" size="small" style={{ color: "#000000" }} />}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={modalFooterStyle}>
              <span style={{ fontSize: "12px", color: "#6b7280" }}>{tempColls.length > 0 ? `${tempColls.length} selected` : "No collection selected"}</span>
              <div style={{ display: "flex", gap: "8px" }}>
                <button type="button" onClick={() => setShowCollModal(false)} style={{ background: "#000000", border: "1.5px solid #000000", borderRadius: "5px", padding: "8px 16px", fontSize: "13px", fontWeight: "500", cursor: "pointer", color: "#ffffff" }}>Cancel</button>
                <button type="button" disabled={tempColls.length === 0} onClick={confirmColl} style={{ background: tempColls.length > 0 ? "#000000" : "#d1d5db", border: tempColls.length > 0 ? "1px solid #000000" : "1px solid #d1d5db", borderRadius: "5px", padding: "8px 20px", fontSize: "13px", fontWeight: "700", cursor: tempColls.length > 0 ? "pointer" : "not-allowed", color: tempColls.length > 0 ? "#ffffff" : "#6b7280" }}>Confirm ({tempColls.length})</button>
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
                <div style={{ fontSize: "15px", fontWeight: "700", color: "#111827" }}>Select product</div>
                <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "2px" }}>
                  {stepProdModalIdx !== null && stepProducts[stepProdModalIdx]
                    ? `${stepProducts[stepProdModalIdx].length} products · scoped to collection`
                    : `All products · ${comboConfig.steps[stepProdModalIdx]?.label}`}
                </div>
              </div>
              <button type="button" aria-label="Close product picker" onClick={() => setShowStepProdModal(false)} style={{ ...modalCloseBtn, display: "inline-flex", alignItems: "center", justifyContent: "center" }}><AdminIcon type="x" size="small" style={{ color: "#9ca3af" }} /></button>
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
                const isSel = tempStepProds.some((p) => p.id === product.id);
                return (
                  <div key={product.id} onClick={() => setTempStepProds(isSel ? tempStepProds.filter((p) => p.id !== product.id) : [...tempStepProds, { id: product.id, title: product.title, handle: product.handle, imageUrl: product.imageUrl, price: product.price }])} onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background = "#f3f4f6"; }} onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.background = "#fff"; }} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 16px", borderBottom: idx < filteredStepProds.length - 1 ? "1px solid #f3f4f6" : "none", borderLeft: isSel ? "3px solid #000000" : "3px solid transparent", cursor: "pointer", background: isSel ? "#000000" : "#fff", transition: "background 0.1s, border-color 0.1s", userSelect: "none" }}>
                    <div style={{ width: "18px", height: "18px", borderRadius: "4px", border: `2px solid ${isSel ? "#000000" : "#d1d5db"}`, background: isSel ? "#ffffff" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.1s" }}>
                      {isSel && <AdminIcon type="check" size="small" style={{ color: "#000000" }} />}
                    </div>
                    {product.imageUrl ? <img src={product.imageUrl} alt={product.title} style={{ width: "40px", height: "40px", objectFit: "cover", borderRadius: "5px", flexShrink: 0, border: "1px solid #e5e7eb" }} /> : <div style={{ width: "40px", height: "40px", borderRadius: "5px", background: "#f3f4f6", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #e5e7eb" }}><AdminIcon type="product" size="small" /></div>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "13px", fontWeight: "600", color: isSel ? "#ffffff" : "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{product.title}</div>
                      <div style={{ fontSize: "11px", color: isSel ? "rgba(255,255,255,0.7)" : "#9ca3af", fontFamily: "monospace" }}>{product.handle}</div>
                    </div>
                    {product.price && parseFloat(product.price) > 0 && <div style={{ fontSize: "13px", fontWeight: "700", color: isSel ? "#ffffff" : "#374151", fontFamily: "monospace", flexShrink: 0 }}>₹{parseFloat(product.price).toLocaleString("en-IN")}</div>}
                  </div>
                );
              })}
            </div>
            <div style={modalFooterStyle}>
              <span style={{ fontSize: "12px", color: "#6b7280" }}>{tempStepProds.length > 0 ? `${tempStepProds.length} product${tempStepProds.length !== 1 ? "s" : ""} selected` : "No product selected"}</span>
              <div style={{ display: "flex", gap: "8px" }}>
                <button type="button" onClick={() => setShowStepProdModal(false)} style={{ background: "#000000", border: "1.5px solid #000000", borderRadius: "5px", padding: "8px 16px", fontSize: "13px", fontWeight: "500", cursor: "pointer", color: "#ffffff" }}>Cancel</button>
                <button type="button" disabled={tempStepProds.length === 0} onClick={confirmStepProd} style={{ background: tempStepProds.length > 0 ? "#000000" : "#d1d5db", border: tempStepProds.length > 0 ? "1px solid #000000" : "1px solid #d1d5db", borderRadius: "5px", padding: "8px 20px", fontSize: "13px", fontWeight: "700", cursor: tempStepProds.length > 0 ? "pointer" : "not-allowed", color: tempStepProds.length > 0 ? "#ffffff" : "#6b7280" }}>Confirm ({tempStepProds.length})</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </s-section>
    </s-page>
  );
}

export const ErrorBoundary = boundary.error;
