import { useState, useMemo, useEffect } from "react";
import { Form, useActionData, useFetcher, useLoaderData, useLocation, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { createBox, upsertComboConfig } from "../models/boxes.server";
import { withEmbeddedAppParams } from "../utils/embedded-app";
import { validateComboConfig } from "../utils/combo-config";

/* ─────────────────────────── GraphQL ─────────────────────────── */
const COLLECTIONS_QUERY = `#graphql
  query GetCollections($first: Int!) {
    collections(first: $first) {
      edges { node { id title handle image { url } } }
    }
  }
`;
const COLLECTION_PRODUCTS_QUERY = `#graphql
  query GetCollectionProducts($id: ID!, $first: Int!) {
    collection(id: $id) {
      products(first: $first) {
        edges {
          node {
            id title handle
            featuredImage { url }
            variants(first: 1) { edges { node { id price } } }
          }
        }
      }
    }
  }
`;
const PRODUCTS_QUERY = `#graphql
  query GetProducts($first: Int!) {
    products(first: $first, query: "NOT vendor:ComboBuilder") {
      edges {
        node {
          id title handle
          featuredImage { url }
          variants(first: 1) { edges { node { id price } } }
        }
      }
    }
  }
`;

/* ─────────────────────────── Constants ─────────────────────────── */
const DEFAULT_COMBO = {
  type: 2,
  title: "Build Your Perfect Bundle",
  subtitle: "Choose a product for each step",
  bundlePrice: 0,
  bundlePriceType: "dynamic",
  isActive: true,
  showProductImages: true,
  showProgressBar: true,
  allowReselection: true,
  steps: [
    { label: "Main Product",     scope: "collection", collections: [], selectedProducts: [], popup: { title: "Choose your main product", desc: "Select the primary product.",   btn: "Confirm selection" } },
    { label: "Add-on Accessory", scope: "collection", collections: [], selectedProducts: [], popup: { title: "Choose an accessory",      desc: "Pick an add-on.",               btn: "Confirm selection" } },
    { label: "Extra Item",       scope: "collection", collections: [], selectedProducts: [], popup: { title: "Choose an extra item",     desc: "Complete your bundle.",         btn: "Complete bundle"   } },
  ],
};

/* ─────────────────────────── Loader ─────────────────────────── */
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);

  // Fast path: products for a specific collection (used by per-step pickers)
  const collectionId = url.searchParams.get("collectionId");
  if (collectionId) {
    const resp = await admin.graphql(COLLECTION_PRODUCTS_QUERY, { variables: { id: collectionId, first: 100 } });
    const json = await resp.json();
    return {
      collectionProducts: (json?.data?.collection?.products?.edges || []).map(({ node }) => ({
        id: node.id, title: node.title, handle: node.handle,
        imageUrl: node.featuredImage?.url || null,
        variantId: node.variants?.edges?.[0]?.node?.id || null,
        price: node.variants?.edges?.[0]?.node?.price || "0",
      })),
    };
  }

  const [prodResp, collResp] = await Promise.all([
    admin.graphql(PRODUCTS_QUERY, { variables: { first: 50 } }),
    admin.graphql(COLLECTIONS_QUERY, { variables: { first: 50 } }),
  ]);
  const [prodJson, collJson] = await Promise.all([prodResp.json(), collResp.json()]);

  return {
    products: (prodJson?.data?.products?.edges || []).map(({ node }) => ({
      id: node.id, title: node.title, handle: node.handle,
      imageUrl: node.featuredImage?.url || null,
      variantId: node.variants?.edges?.[0]?.node?.id || null,
      price: node.variants?.edges?.[0]?.node?.price || "0",
    })),
    collections: (collJson?.data?.collections?.edges || []).map(({ node }) => ({
      id: node.id, title: node.title, handle: node.handle, imageUrl: node.image?.url || null,
    })),
  };
};

/* ─────────────────────────── Action ─────────────────────────── */
export const action = async ({ request }) => {
  const { session, admin, redirect } = await authenticate.admin(request);
  const formData = await request.formData();

  const comboStepsConfig = formData.get("comboStepsConfig");
  const errors = {};
  const comboValidation = validateComboConfig(comboStepsConfig);

  const comboName = formData.get("comboName")?.trim() || "";
  if (!comboName) errors.comboName = "Combo name is required";
  if (comboValidation) {
    errors.comboConfig = comboValidation.form;
    errors.comboStepSelections = comboValidation.stepSelections;
  }

  if (Object.keys(errors).length > 0) return { errors };

  // Derive box fields from combo config
  let parsedCombo = {};
  try { parsedCombo = JSON.parse(comboStepsConfig); } catch {}

  const bundlePriceType = parsedCombo.bundlePriceType || "dynamic";
  const bundlePrice = parsedCombo.bundlePrice > 0 ? String(parsedCombo.bundlePrice) : (bundlePriceType === "dynamic" ? "0.01" : "0");
  const itemCount = String(parsedCombo.type || 2);

  if (bundlePriceType === "manual" && (!bundlePrice || parseFloat(bundlePrice) <= 0)) {
    errors.bundlePrice = "Set a bundle price or switch to Dynamic mode";
    return { errors };
  }

  const data = {
    boxName:            comboName,
    displayTitle:       comboName,
    itemCount,
    bundlePrice,
    bundlePriceType,
    isGiftBox:          false,
    allowDuplicates:    false,
    giftMessageEnabled: false,
    isActive:           parsedCombo.isActive !== false,
    bannerImage:        null,
    eligibleProducts:   [],
  };

  try {
    const box = await createBox(session.shop, data, admin);
    if (comboStepsConfig) {
      try { await upsertComboConfig(box.id, comboStepsConfig); } catch (e) {
        console.error("[app.boxes.new-combo] upsertComboConfig error:", e);
      }
    }
  } catch (e) {
    if (e instanceof Response) throw e;
    const message = e instanceof Error && e.message ? e.message : "Failed to create combo box. Please try again.";
    return { errors: { _global: message } };
  }

  throw redirect("/app/boxes");
};

/* ─────────────────────────── Styles ─────────────────────────── */
const fieldStyle = { width: "100%", padding: "9px 12px", border: "1.5px solid #e5e7eb", borderRadius: "5px", fontSize: "13px", color: "#111827", background: "#fff", boxSizing: "border-box", outline: "none", transition: "border-color 0.15s" };
const labelStyle = { display: "block", fontSize: "11px", fontWeight: "700", color: "#4b5563", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.6px" };
const errorStyle = { color: "#dc2626", fontSize: "11px", marginTop: "5px", display: "flex", alignItems: "center", gap: "4px" };
const sectionHeadingStyle = { fontSize: "11px", fontWeight: "700", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "16px", paddingBottom: "10px", borderBottom: "1.5px solid #f3f4f6", display: "flex", alignItems: "center", gap: "8px" };

/* ─────────────────────────── Component ─────────────────────────── */
export default function CreateSpecificComboBoxPage() {
  const { products, collections } = useLoaderData();
  const actionData = useActionData();
  const location = useLocation();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const collProdsFetcher0 = useFetcher();
  const collProdsFetcher1 = useFetcher();
  const collProdsFetcher2 = useFetcher();
  const collProdsFetchers = [collProdsFetcher0, collProdsFetcher1, collProdsFetcher2];

  const errors = actionData?.errors || {};
  const comboFormError = errors.comboConfig;
  const comboStepErrors = errors.comboStepSelections || {};

  /* ── Combo Config state ── */
  const [comboConfig, setComboConfig] = useState(DEFAULT_COMBO);
  const [comboActiveStep, setComboActiveStep] = useState(0);
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

  /* ── Collection modal ── */
  const [showCollModal, setShowCollModal] = useState(false);
  const [collModalStepIdx, setCollModalStepIdx] = useState(null);
  const [collSearch, setCollSearch] = useState("");
  const [tempColls, setTempColls] = useState([]);

  /* ── Step product modal ── */
  const [showStepProdModal, setShowStepProdModal] = useState(false);
  const [stepProdModalIdx, setStepProdModalIdx] = useState(null);
  const [stepProdSearch, setStepProdSearch] = useState("");
  const [tempStepProds, setTempStepProds] = useState([]);

  /* ── Combo helpers ── */
  function updateComboField(field, value) { setComboConfig((prev) => ({ ...prev, [field]: value })); }
  function updateComboStep(stepIdx, field, value) {
    setComboConfig((prev) => ({ ...prev, steps: prev.steps.map((s, i) => i === stepIdx ? { ...s, [field]: value } : s) }));
  }
  function updateComboStepPopup(stepIdx, field, value) {
    setComboConfig((prev) => ({ ...prev, steps: prev.steps.map((s, i) => i === stepIdx ? { ...s, popup: { ...s.popup, [field]: value } } : s) }));
  }

  function confirmColl() {
    if (tempColls.length === 0) return;
    const idx = collModalStepIdx;
    setComboConfig((prev) => ({ ...prev, steps: prev.steps.map((s, i) => i !== idx ? s : { ...s, collections: tempColls, selectedProducts: [] }) }));
    setStepProducts((p) => { const n = [...p]; n[idx] = null; return n; });
    collProdsFetchers[idx].load(withEmbeddedAppParams(`/app/boxes/new-combo?collectionId=${encodeURIComponent(tempColls[0].id)}`, location.search));
    setShowCollModal(false);
  }
  function confirmStepProd() {
    updateComboStep(stepProdModalIdx, "selectedProducts", tempStepProds);
    setShowStepProdModal(false);
  }

  const comboDynamicPrice = useMemo(() => {
    const cfg = comboConfig;
    return cfg.steps.slice(0, cfg.type)
      .flatMap((s) => (s.selectedProducts || []).map((p) => parseFloat(p.price) || 0))
      .reduce((a, b) => a + b, 0);
  }, [comboConfig]);

  const comboConfigJson = JSON.stringify({
    ...comboConfig,
    bundlePrice: comboConfig.bundlePriceType === "dynamic"
      ? comboDynamicPrice
      : parseFloat(comboConfig.bundlePrice) || 0,
  });

  const filteredColls = collections.filter((c) => !collSearch || c.title.toLowerCase().includes(collSearch.toLowerCase()));
  const activeScopedProducts = stepProdModalIdx !== null ? (stepProducts[stepProdModalIdx] ?? products) : products;
  const isLoadingStepProds = stepProdModalIdx !== null && collProdsFetchers[stepProdModalIdx]?.state === "loading";
  const filteredStepProds = activeScopedProducts.filter((p) => !stepProdSearch || p.title.toLowerCase().includes(stepProdSearch.toLowerCase()));

  const modalOverlayStyle = { position: "fixed", inset: 0, background: "rgba(17,24,39,0.55)", backdropFilter: "blur(3px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" };
  const modalBoxStyle = { background: "#fff", borderRadius: "8px", width: "100%", maxWidth: "560px", maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.18)", overflow: "hidden" };
  const modalHeaderStyle = { padding: "16px 20px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#fafafa" };
  const modalBodyStyle = { flex: 1, overflowY: "auto" };
  const modalFooterStyle = { padding: "14px 16px", borderTop: "1px solid #f3f4f6", background: "#fafafa", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" };
  const modalCloseBtn = { background: "none", border: "none", cursor: "pointer", fontSize: "18px", color: "#9ca3af", padding: "4px 8px", borderRadius: "5px", lineHeight: 1 };
  const searchInputStyle = { ...fieldStyle, borderColor: "#d1d5db", fontSize: "13px" };

  return (
    <s-page heading="Create Specific Combo Box" back-url={withEmbeddedAppParams("/app/boxes", location.search)}>

      <s-button
        slot="primary-action"
        variant="primary"
        disabled={isSaving || undefined}
        onClick={() => { const f = document.getElementById("new-combo-form"); if (f) f.requestSubmit(); }}
      >
        {isSaving ? "Saving..." : "Save & Publish"}
      </s-button>

      {/* Hero banner */}
      <div style={{ marginBottom: "20px", borderRadius: "5px", background: "linear-gradient(135deg, #091fd6 0%, #c11a10 55%, #706cd3 100%)", boxShadow: "0 8px 32px rgba(9,31,214,0.22)", overflow: "hidden", position: "relative", padding: "24px 32px" }}>
        <div style={{ position: "absolute", top: "-40px", right: "-40px", width: "180px", height: "180px", borderRadius: "50%", background: "rgba(255,255,255,0.05)", pointerEvents: "none" }} />
        <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(255,255,255,0.15)", backdropFilter: "blur(4px)", borderRadius: "999px", padding: "4px 14px", fontSize: "10px", fontWeight: "800", letterSpacing: "0.10em", textTransform: "uppercase", color: "#d1fae5", marginBottom: "10px" }}>🎯 Specific Combo Box</div>
        <div style={{ fontSize: "18px", fontWeight: "800", color: "#fff", letterSpacing: "-0.5px" }}>Create Specific Combo Box</div>
        <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.65)", marginTop: "4px" }}>Configure your combo experience — define steps, collections, and product pickers.</div>
      </div>

      {errors._global && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "5px", padding: "12px 16px", marginBottom: "16px", color: "#991b1b", fontSize: "13px", display: "flex", alignItems: "center", gap: "8px" }}>
          <span>⚠</span>{errors._global}
        </div>
      )}

      <Form id="new-combo-form" method="POST" action={`/app/boxes/new-combo${location.search}`}>
        <input type="hidden" name="comboStepsConfig" value={comboConfigJson} />

        <s-section>
          {/* Combo Name */}
          <div style={{ marginBottom: "20px" }}>
            <label style={labelStyle}>Combo Name *</label>
            <input type="text" name="comboName" placeholder="e.g. Premium Bundle" style={{ ...fieldStyle, borderColor: errors.comboName ? "#e11d48" : "#d1d5db" }} />
            {errors.comboName && <div style={errorStyle}>{errors.comboName}</div>}
          </div>

          {/* Combo Config Error */}
          {comboFormError && (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "5px", padding: "10px 16px", marginBottom: "16px", color: "#991b1b", fontSize: "13px", display: "flex", alignItems: "center", gap: "8px" }}>
              <span>!</span>{comboFormError}
            </div>
          )}
          {errors.bundlePrice && (
            <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: "5px", padding: "10px 16px", marginBottom: "16px", color: "#9a3412", fontSize: "13px" }}>
              ⚠ {errors.bundlePrice}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: "20px", alignItems: "start" }}>

            {/* ── SIDEBAR ── */}
            <div>
              <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", marginBottom: "16px" }}>
                <div style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6", fontWeight: "700", fontSize: "13px", color: "#111827" }}>Combo configuration</div>
                <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "14px" }}>
                  {/* Type */}
                  <div>
                    <label style={labelStyle}>Combo type</label>
                    <div style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
                      {[2, 3].map((n) => (
                        <button key={n} type="button" onClick={() => { updateComboField("type", n); if (comboActiveStep >= n) setComboActiveStep(0); }}
                          style={{ flex: 1, padding: "7px 0", fontSize: "12px", fontWeight: "600", border: "none", borderRadius: "5px", cursor: "pointer", background: comboConfig.type === n ? "linear-gradient(135deg, #091fd6 0%, #c11a10 55%, #706cd3 100%)" : "#f3f4f6", color: comboConfig.type === n ? "#fff" : "#374151", transition: "background 0.15s" }}>
                          {n}-step
                        </button>
                      ))}
                    </div>
                    <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "5px" }}>{comboConfig.type} product selections required</div>
                  </div>
                  {/* Title */}
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
                        <button key={mode} type="button" onClick={() => updateComboField("bundlePriceType", mode)} style={{ flex: 1, padding: "6px 0", fontSize: "12px", fontWeight: "600", border: "none", cursor: "pointer", background: comboConfig.bundlePriceType === mode ? "#2A7A4F" : "#f9fafb", color: comboConfig.bundlePriceType === mode ? "#fff" : "#374151", transition: "background 0.15s" }}>
                          {mode === "manual" ? "Manual" : "Dynamic"}
                        </button>
                      ))}
                    </div>
                    {comboConfig.bundlePriceType === "manual" && (
                      <input
                        type="number"
                        placeholder="e.g. 1200"
                        min="0"
                        step="0.01"
                        value={comboConfig.bundlePrice || ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (!val || parseFloat(val) === 0) {
                            updateComboField("bundlePriceType", "dynamic");
                          } else {
                            updateComboField("bundlePrice", val);
                          }
                        }}
                        style={{ ...fieldStyle, borderColor: "#d1d5db" }}
                      />
                    )}
                    {comboConfig.bundlePriceType === "dynamic" && (
                      <div style={{ border: "1px solid #d1d5db", borderRadius: "5px", padding: "10px 12px", background: "#f9fafb", fontSize: "12px", color: "#6b7280" }}>
                        {comboDynamicPrice > 0
                          ? <>₹{comboDynamicPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })} <span style={{ fontSize: "10px" }}>(sum of step products)</span></>
                          : <span style={{ color: "#9ca3af" }}>Price calculated from selected step products</span>
                        }
                      </div>
                    )}
                  </div>
                </div>
                {/* Combo active */}
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

            {/* ── MAIN: Step Editor ── */}
            <div>
              <div style={{ display: "flex", borderBottom: "1px solid #e5e7eb", marginBottom: "16px" }}>
                {Array.from({ length: comboConfig.type }, (_, i) => (
                  <button key={i} type="button" onClick={() => setComboActiveStep(i)}
                    style={{ padding: "8px 16px", fontSize: "12px", fontWeight: "600", cursor: "pointer", border: "none", background: "none", borderBottom: comboActiveStep === i ? "2px solid #091fd6" : comboStepErrors[i] ? "2px solid #dc2626" : "2px solid transparent", marginBottom: "-1px", color: comboStepErrors[i] ? "#dc2626" : comboActiveStep === i ? "#091fd6" : "#6b7280", transition: "color 0.15s, border-color 0.15s" }}>
                    Step {i + 1} — {comboConfig.steps[i].label}
                  </button>
                ))}
              </div>

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
                        <label style={labelStyle}>Scope</label>
                        <div style={{ position: "relative", marginBottom: "10px" }}>
                          <select value={step.scope || "collection"} onChange={(e) => { const s = e.target.value; setComboConfig((prev) => ({ ...prev, steps: prev.steps.map((st, i) => i !== ai ? st : { ...st, scope: s, collections: [], selectedProducts: [] }) })); }}
                            style={{ width: "100%", padding: "9px 32px 9px 12px", border: "1.5px solid #d1d5db", borderRadius: "6px", background: "#fff", fontSize: "13px", color: "#374151", cursor: "pointer", appearance: "none", WebkitAppearance: "none", outline: "none" }}>
                            <option value="collection">Specific collections</option>
                            <option value="product">Specific products</option>
                          </select>
                          <span style={{ position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)", fontSize: "13px", color: "#6b7280", pointerEvents: "none" }}>⌃⌄</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          {(step.scope || "collection") === "collection" ? (
                            <button type="button" onClick={() => { setCollModalStepIdx(ai); setTempColls([...step.collections]); setCollSearch(""); setShowCollModal(true); }} style={{ padding: "7px 16px", border: "1px solid #d1d5db", borderRadius: "5px", background: "#fff", fontSize: "13px", color: "#374151", cursor: "pointer", fontWeight: "500" }}>Select collections</button>
                          ) : (
                            <button type="button" onClick={() => { setStepProdModalIdx(ai); setTempStepProds([...(step.selectedProducts || [])]); setStepProdSearch(""); setShowStepProdModal(true); }} style={{ padding: "7px 16px", border: "1px solid #d1d5db", borderRadius: "5px", background: "#fff", fontSize: "13px", color: "#374151", cursor: "pointer", fontWeight: "500" }}>Select products</button>
                          )}
                          <span style={{ fontSize: "13px", color: "#6b7280" }}>
                            {(step.scope || "collection") === "collection" ? `${step.collections.length} selected` : `${(step.selectedProducts || []).length} selected`}
                          </span>
                        </div>
                        {comboStepErrors[ai] && <div style={{ color: "#e11d48", fontSize: "12px", marginTop: "10px", padding: "8px 12px", background: "#fff5f5", borderRadius: "5px", border: "1px solid #fecaca" }}>{comboStepErrors[ai]}</div>}
                        {step.collections.length > 0 && (step.scope || "collection") === "collection" && (
                          <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "8px" }}>
                            {step.collections.map((c) => (
                              <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", background: "#eef1ff", border: "1.5px solid #091fd6", borderRadius: "5px" }}>
                                <span style={{ fontSize: "12px", color: "#091fd6", fontWeight: "600" }}>📁 {c.title}</span>
                                <button type="button" onClick={() => updateComboStep(ai, "collections", step.collections.filter((x) => x.id !== c.id))} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "11px", color: "#dc2626" }}>✕</button>
                              </div>
                            ))}
                          </div>
                        )}
                        {(step.selectedProducts || []).length > 0 && (step.scope || "collection") === "product" && (
                          <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "6px" }}>
                            {step.selectedProducts.map((p) => (
                              <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", background: "#f0fdf4", border: "1.5px solid #2A7A4F", borderRadius: "5px" }}>
                                <span style={{ fontSize: "12px", color: "#166534", fontWeight: "600" }}>📦 {p.title} — ₹{parseFloat(p.price || 0).toLocaleString("en-IN")}</span>
                                <button type="button" onClick={() => updateComboStep(ai, "selectedProducts", step.selectedProducts.filter((x) => x.id !== p.id))} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "11px", color: "#dc2626" }}>✕</button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* General Settings card */}
                    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
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
      </Form>

      {/* ── MODAL: Collection Picker ── */}
      {showCollModal && (
        <div style={modalOverlayStyle} onClick={(e) => { if (e.target === e.currentTarget) setShowCollModal(false); }}>
          <div style={{ ...modalBoxStyle, maxWidth: "520px" }}>
            <div style={modalHeaderStyle}>
              <div><div style={{ fontSize: "15px", fontWeight: "700", color: "#111827" }}>Select collection — Step {collModalStepIdx + 1}</div><div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "2px" }}>{comboConfig.steps[collModalStepIdx]?.label}</div></div>
              <button type="button" onClick={() => setShowCollModal(false)} style={modalCloseBtn}>✕</button>
            </div>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6" }}>
              <input type="text" placeholder="Search collections…" value={collSearch} onChange={(e) => setCollSearch(e.target.value)} autoFocus style={searchInputStyle} />
            </div>
            <div style={modalBodyStyle}>
              {filteredColls.length === 0 ? <div style={{ padding: "40px 20px", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>No collections found</div>
                : filteredColls.map((coll, idx) => {
                  const isSel = tempColls.some((c) => c.id === coll.id);
                  return (
                    <div key={coll.id} onClick={() => setTempColls(isSel ? tempColls.filter((c) => c.id !== coll.id) : [...tempColls, coll])} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 16px", borderBottom: idx < filteredColls.length - 1 ? "1px solid #f3f4f6" : "none", borderLeft: isSel ? "3px solid #091fd6" : "3px solid transparent", cursor: "pointer", background: isSel ? "#eef1ff" : "#fff", userSelect: "none" }}>
                      {coll.imageUrl ? <img src={coll.imageUrl} alt={coll.title} style={{ width: "38px", height: "38px", objectFit: "cover", borderRadius: "5px", border: "1px solid #e5e7eb", flexShrink: 0 }} /> : <div style={{ width: "38px", height: "38px", borderRadius: "5px", background: "#f3f4f6", border: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", flexShrink: 0 }}>📁</div>}
                      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: "13px", fontWeight: "600", color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{coll.title}</div><div style={{ fontSize: "11px", color: "#9ca3af" }}>{coll.handle}</div></div>
                      <div style={{ width: "18px", height: "18px", borderRadius: "50%", border: `2px solid ${isSel ? "#091fd6" : "#d1d5db"}`, background: isSel ? "linear-gradient(135deg, #091fd6 0%, #c11a10 55%, #706cd3 100%)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {isSel && <span style={{ color: "#fff", fontSize: "10px", fontWeight: "700" }}>✓</span>}
                      </div>
                    </div>
                  );
                })}
            </div>
            <div style={modalFooterStyle}>
              <span style={{ fontSize: "12px", color: "#6b7280" }}>{tempColls.length > 0 ? `${tempColls.length} selected` : "No collection selected"}</span>
              <div style={{ display: "flex", gap: "8px" }}>
                <button type="button" onClick={() => setShowCollModal(false)} style={{ background: "#fff", border: "1.5px solid #d1d5db", borderRadius: "5px", padding: "8px 16px", fontSize: "13px", fontWeight: "500", cursor: "pointer", color: "#374151" }}>Cancel</button>
                <button type="button" disabled={tempColls.length === 0} onClick={confirmColl} style={{ background: tempColls.length > 0 ? "linear-gradient(135deg, #091fd6 0%, #c11a10 55%, #706cd3 100%)" : "#d1d5db", border: "none", borderRadius: "5px", padding: "8px 20px", fontSize: "13px", fontWeight: "700", cursor: tempColls.length > 0 ? "pointer" : "not-allowed", color: "#fff" }}>Confirm ({tempColls.length})</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: Step Product Picker ── */}
      {showStepProdModal && (
        <div style={modalOverlayStyle} onClick={(e) => { if (e.target === e.currentTarget) setShowStepProdModal(false); }}>
          <div style={modalBoxStyle}>
            <div style={modalHeaderStyle}>
              <div><div style={{ fontSize: "15px", fontWeight: "700", color: "#111827" }}>Select product — Step {stepProdModalIdx + 1}</div><div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "2px" }}>{stepProdModalIdx !== null && stepProducts[stepProdModalIdx] ? `${stepProducts[stepProdModalIdx].length} products · scoped to collection` : `All products · ${comboConfig.steps[stepProdModalIdx]?.label}`}</div></div>
              <button type="button" onClick={() => setShowStepProdModal(false)} style={modalCloseBtn}>✕</button>
            </div>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6" }}>
              <input type="text" placeholder="Search products…" value={stepProdSearch} onChange={(e) => setStepProdSearch(e.target.value)} autoFocus style={searchInputStyle} />
            </div>
            <div style={modalBodyStyle}>
              {isLoadingStepProds ? <div style={{ padding: "40px 20px", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>Loading products…</div>
                : filteredStepProds.length === 0 ? <div style={{ padding: "40px 20px", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>No products found</div>
                : filteredStepProds.map((product, idx) => {
                  const isSel = tempStepProds.some((p) => p.id === product.id);
                  return (
                    <div key={product.id} onClick={() => setTempStepProds(isSel ? tempStepProds.filter((p) => p.id !== product.id) : [...tempStepProds, { id: product.id, title: product.title, handle: product.handle, imageUrl: product.imageUrl, price: product.price }])} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 16px", borderBottom: idx < filteredStepProds.length - 1 ? "1px solid #f3f4f6" : "none", borderLeft: isSel ? "3px solid #2A7A4F" : "3px solid transparent", cursor: "pointer", background: isSel ? "#f0fdf4" : "#fff", userSelect: "none" }}>
                      <div style={{ width: "18px", height: "18px", borderRadius: "4px", border: `2px solid ${isSel ? "#2A7A4F" : "#d1d5db"}`, background: isSel ? "#2A7A4F" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {isSel && <span style={{ color: "#fff", fontSize: "10px", fontWeight: "700" }}>✓</span>}
                      </div>
                      {product.imageUrl ? <img src={product.imageUrl} alt={product.title} style={{ width: "40px", height: "40px", objectFit: "cover", borderRadius: "5px", flexShrink: 0, border: "1px solid #e5e7eb" }} /> : <div style={{ width: "40px", height: "40px", borderRadius: "5px", background: "#f3f4f6", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px" }}>📦</div>}
                      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: "13px", fontWeight: "600", color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{product.title}</div></div>
                      {product.price && parseFloat(product.price) > 0 && <div style={{ fontSize: "13px", fontWeight: "700", color: "#374151", fontFamily: "monospace", flexShrink: 0 }}>₹{parseFloat(product.price).toLocaleString("en-IN")}</div>}
                    </div>
                  );
                })}
            </div>
            <div style={modalFooterStyle}>
              <span style={{ fontSize: "12px", color: "#6b7280" }}>{tempStepProds.length > 0 ? `${tempStepProds.length} selected` : "No product selected"}</span>
              <div style={{ display: "flex", gap: "8px" }}>
                <button type="button" onClick={() => setShowStepProdModal(false)} style={{ background: "#fff", border: "1.5px solid #d1d5db", borderRadius: "5px", padding: "8px 16px", fontSize: "13px", fontWeight: "500", cursor: "pointer", color: "#374151" }}>Cancel</button>
                <button type="button" disabled={tempStepProds.length === 0} onClick={confirmStepProd} style={{ background: tempStepProds.length > 0 ? "linear-gradient(135deg, #091fd6 0%, #c11a10 55%, #706cd3 100%)" : "#d1d5db", border: "none", borderRadius: "5px", padding: "8px 20px", fontSize: "13px", fontWeight: "700", cursor: tempStepProds.length > 0 ? "pointer" : "not-allowed", color: "#fff" }}>Confirm ({tempStepProds.length})</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </s-page>
  );
}

export const ErrorBoundary = boundary.error;
export const headers = (headersArgs) => boundary.headers(headersArgs);
