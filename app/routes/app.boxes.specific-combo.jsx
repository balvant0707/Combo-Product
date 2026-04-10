import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { Form, useActionData, useFetcher, useLoaderData, useLocation, useNavigation, useRouteError } from "react-router";
import {
  Badge, Banner, BlockStack, Box, Button, Card, Checkbox,
  Divider, DropZone, FormLayout, InlineGrid, InlineStack, Layout, Modal, Page,
  Select, SettingToggle, Spinner, Text, TextField, Tabs
} from "@shopify/polaris";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { createBox, getBox, upsertComboConfig, saveComboStepImages, syncSpecificComboProductMedia } from "../models/boxes.server";
import { getShopCurrencyCode } from "../models/shop.server";
import { withEmbeddedAppParams, withEmbeddedAppToastFromRequest } from "../utils/embedded-app";
import { validateComboConfig } from "../utils/combo-config";
import { formatCurrencyAmount, getCurrencySymbol } from "../utils/currency";

/* ─────────────────────────────── GraphQL ─────────────────────────────── */
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

/* ─────────────────────────────── Constants ─────────────────────────────── */
const MAX_BANNER_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_STEP_IMAGE_SIZE = 2 * 1024 * 1024;
const MIN_COMBO_STEPS = 2;
const MAX_COMBO_STEPS = 8;
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg", "image/jpg", "image/png",
  "image/webp", "image/gif", "image/avif",
]);

async function parseBannerImage(formData, errors) {
  const file = formData.get("bannerImage");
  if (!file || typeof file !== "object" || typeof file.arrayBuffer !== "function" || !file.size) return null;
  if (!ALLOWED_IMAGE_MIME_TYPES.has(file.type)) { errors.bannerImage = "Only JPG, PNG, WEBP, GIF, and AVIF files are allowed"; return null; }
  if (file.size > MAX_BANNER_IMAGE_SIZE) { errors.bannerImage = "Banner image must be 5MB or smaller"; return null; }
  return { bytes: new Uint8Array(await file.arrayBuffer()), mimeType: file.type, fileName: file.name || null };
}

async function parseComboImage(formData, errors) {
  const file = formData.get("comboImage");
  if (!file || typeof file !== "object" || typeof file.arrayBuffer !== "function" || !file.size) return null;
  if (!ALLOWED_IMAGE_MIME_TYPES.has(file.type)) {
    errors.comboImage = "Only JPG, PNG, WEBP, GIF, and AVIF files are allowed";
    return null;
  }
  if (file.size > MAX_STEP_IMAGE_SIZE) {
    errors.comboImage = "Combo image must be 2MB or smaller";
    return null;
  }
  return { stepIndex: 0, bytes: new Uint8Array(await file.arrayBuffer()), mimeType: file.type, fileName: file.name || null };
}

function buildDefaultStep(index) {
  return {
    label: "",
    optional: false,
    scope: "collection",
    collections: [],
    selectedProducts: [],
    popup: {
      title: "",
      desc: "",
      btn: "",
    },
  };
}

const DEFAULT_COMBO = {
  type: MIN_COMBO_STEPS,
  title: "",
  subtitle: "",
  ctaButtonLabel: "",
  addToCartLabel: "",
  highlightText: "",
  supportText: "",
  bundlePrice: 0,
  bundlePriceType: "dynamic",
  discountType: "none",
  discountValue: "0",
  buyQuantity: 1,
  getQuantity: 1,
  isActive: true,
  isGiftBox: false,
  allowDuplicates: false,
  giftMessageEnabled: false,
  steps: Array.from({ length: MIN_COMBO_STEPS }, (_, index) => buildDefaultStep(index)),
};

function normalizeSpecificDiscountType(discountType) {
  return discountType === "buy_x_get_y" ? "none" : (discountType || "none");
}

function sanitizeSpecificComboPricing(config) {
  const safeConfig = config && typeof config === "object" ? config : {};
  const bundlePriceType = safeConfig.bundlePriceType === "dynamic" ? "dynamic" : "manual";
  const discountType = bundlePriceType === "dynamic"
    ? normalizeSpecificDiscountType(safeConfig.discountType)
    : "none";
  const buyQuantity = bundlePriceType === "dynamic"
    ? Math.max(1, parseInt(String(safeConfig.buyQuantity ?? 1), 10) || 1)
    : 1;
  const getQuantity = bundlePriceType === "dynamic"
    ? Math.max(1, parseInt(String(safeConfig.getQuantity ?? 1), 10) || 1)
    : 1;
  const discountValue = bundlePriceType === "dynamic"
    ? (discountType === "buy_x_get_y" ? "100" : String(safeConfig.discountValue ?? "0"))
    : "0";
  return {
    ...safeConfig,
    bundlePriceType,
    discountType,
    discountValue,
    buyQuantity,
    getQuantity,
  };
}

function getBuyXGetYFreeUnits(totalQty, buyQty, getQty) {
  const safeQty = Math.max(0, parseInt(String(totalQty || 0), 10) || 0);
  const safeBuyQty = Math.max(1, parseInt(String(buyQty || 1), 10) || 1);
  const safeGetQty = Math.max(1, parseInt(String(getQty || 1), 10) || 1);
  const groupSize = safeBuyQty + safeGetQty;
  if (safeQty <= 0 || groupSize <= 0) return 0;
  const fullGroups = Math.floor(safeQty / groupSize);
  const remainder = safeQty % groupSize;
  const partialFree = Math.max(0, Math.min(safeGetQty, remainder - safeBuyQty));
  return fullGroups * safeGetQty + partialFree;
}

function getAdminComboDiscountBreakdown(total, config, quantity = 0, unitPrices = []) {
  const safeTotal = parseFloat(total) || 0;
  if (safeTotal <= 0) return { discountedTotal: 0, discountAmount: 0, freeUnits: 0 };
  const discountType = config?.discountType || "none";
  const discountValue = parseFloat(config?.discountValue) || 0;

  if (discountType === "percent") {
    const discountAmount = Math.min(safeTotal, Math.max(0, safeTotal * (discountValue / 100)));
    return { discountedTotal: Math.max(0, safeTotal - discountAmount), discountAmount, freeUnits: 0 };
  }
  if (discountType === "fixed") {
    const discountAmount = Math.min(safeTotal, Math.max(0, discountValue));
    return { discountedTotal: Math.max(0, safeTotal - discountAmount), discountAmount, freeUnits: 0 };
  }
  if (discountType === "buy_x_get_y") {
    const parsedUnitPrices = Array.isArray(unitPrices)
      ? unitPrices
        .map((price) => parseFloat(price) || 0)
        .filter((price) => price > 0)
      : [];
    const safeQty = Math.max(
      0,
      parseInt(String(quantity || parsedUnitPrices.length || 0), 10) || parsedUnitPrices.length || 0,
    );
    if (safeQty <= 0) return { discountedTotal: safeTotal, discountAmount: 0, freeUnits: 0 };
    const freeUnits = getBuyXGetYFreeUnits(safeQty, config?.buyQuantity, config?.getQuantity);
    if (freeUnits <= 0) return { discountedTotal: safeTotal, discountAmount: 0, freeUnits: 0 };

    let freeAmount = 0;
    if (parsedUnitPrices.length >= freeUnits) {
      const sorted = [...parsedUnitPrices].sort((a, b) => a - b);
      freeAmount = sorted.slice(0, freeUnits).reduce((sum, price) => sum + price, 0);
    } else {
      freeAmount = (safeTotal / safeQty) * freeUnits;
    }
    const discountAmount = Math.min(safeTotal, freeAmount);
    return {
      discountedTotal: Math.max(0, safeTotal - discountAmount),
      discountAmount,
      freeUnits,
    };
  }

  return { discountedTotal: safeTotal, discountAmount: 0, freeUnits: 0 };
}

function applyAdminComboDiscount(total, config, quantity = 0, unitPrices = []) {
  return getAdminComboDiscountBreakdown(total, config, quantity, unitPrices).discountedTotal;
}

/* ─────────────────────────────── Loader ─────────────────────────────── */
export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const currencyCode = await getShopCurrencyCode(session.shop);
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
      currencyCode,
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
    currencyCode,
  };
};

/* ─────────────────────────────── Action ─────────────────────────────── */
export const action = async ({ request }) => {
  const { session, admin, redirect } = await authenticate.admin(request);
  const formData = await request.formData();

  const rawComboStepsConfig = formData.get("comboStepsConfig");
  let parsedCombo = {};
  try { parsedCombo = JSON.parse(rawComboStepsConfig || "{}"); } catch {}
  const normalizedCombo = sanitizeSpecificComboPricing(parsedCombo);
  const comboStepsConfig = JSON.stringify(normalizedCombo);
  const errors = {};
  const bannerImage = await parseBannerImage(formData, errors);
  const comboImage = await parseComboImage(formData, errors);
  const comboValidation = validateComboConfig(comboStepsConfig);

  const comboName = formData.get("comboName")?.trim() || "";
  if (!comboName) errors.comboName = "Combo name is required";
  if (comboValidation) {
    errors.comboConfig = comboValidation.form;
    errors.comboStepSelections = comboValidation.stepSelections;
  }

  if (Object.keys(errors).length > 0) return { errors };

  // Derive box fields from combo config
  const bundlePriceType = normalizedCombo.bundlePriceType || "dynamic";
  const bundlePrice = normalizedCombo.bundlePrice > 0 ? String(normalizedCombo.bundlePrice) : (bundlePriceType === "dynamic" ? "0.01" : "0");
  const itemCount = String(normalizedCombo.type || 2);

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
    isGiftBox:          normalizedCombo.isGiftBox === true || String(normalizedCombo.isGiftBox).toLowerCase() === "true",
    allowDuplicates:    normalizedCombo.allowDuplicates === true || String(normalizedCombo.allowDuplicates).toLowerCase() === "true",
    giftMessageEnabled: normalizedCombo.giftMessageEnabled === true || String(normalizedCombo.giftMessageEnabled).toLowerCase() === "true",
    isActive:           normalizedCombo.isActive !== false,
    bannerImage,
    eligibleProducts:   [],
  };

  try {
    const box = await createBox(session.shop, data, admin);
    if (comboStepsConfig) {
      let savedComboStepsConfig = comboStepsConfig;
      try { await upsertComboConfig(box.id, comboStepsConfig, admin); } catch (e) {
        console.error("[app.boxes.specific-combo] upsertComboConfig error:", e);
      }
      if (comboImage) {
        try { await saveComboStepImages(box.id, [comboImage]); } catch (e) {
          console.error("[app.boxes.specific-combo] saveComboStepImages error:", e);
        }
      }
      try {
        const savedBox = await getBox(box.id, session.shop);
        savedComboStepsConfig = savedBox?.comboStepsConfig || comboStepsConfig;
        if (savedBox?.shopifyProductId) {
          await syncSpecificComboProductMedia(
            admin,
            savedBox,
            savedComboStepsConfig,
          );
        }
      } catch (e) {
        console.error("[app.boxes.specific-combo] getBox after save error:", e);
      }
    }
  } catch (e) {
    if (e instanceof Response) throw e;
    const message = e instanceof Error && e.message ? e.message : "Failed to create combo box. Please try again.";
    return { errors: { _global: message } };
  }

  throw redirect(
    withEmbeddedAppToastFromRequest("/app/boxes", request, {
      message: "Configuration saved successfully.",
    }),
  );
};

/* ─────────────────────────────── inputStyle ─────────────────────────────── */
const inputStyle = {
  width: "100%", padding: "8px 12px", border: "1.5px solid #e5e7eb",
  borderRadius: "6px", fontSize: "14px", boxSizing: "border-box",
};

/* ─────────────────────────────── Component ─────────────────────────────── */
export default function CreateSpecificComboBoxPage() {
  const { products, collections, currencyCode } = useLoaderData();
  const actionData = useActionData();
  const location = useLocation();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";
  const currencySymbol = getCurrencySymbol(currencyCode);
  const isPageLoading = navigation.state !== "idle";

  const collProdsFetcher0 = useFetcher();
  const collProdsFetcher1 = useFetcher();
  const collProdsFetcher2 = useFetcher();
  const collProdsFetcher3 = useFetcher();
  const collProdsFetcher4 = useFetcher();
  const collProdsFetcher5 = useFetcher();
  const collProdsFetcher6 = useFetcher();
  const collProdsFetcher7 = useFetcher();
  const collProdsFetchers = [collProdsFetcher0, collProdsFetcher1, collProdsFetcher2, collProdsFetcher3, collProdsFetcher4, collProdsFetcher5, collProdsFetcher6, collProdsFetcher7];

  const errors = actionData?.errors || {};
  const comboFormError = errors.comboConfig;
  const comboStepErrors = errors.comboStepSelections || {};

  /* -- Combo Config state -- */
  const [comboConfig, setComboConfig] = useState(DEFAULT_COMBO);
  const [comboActiveStep, setComboActiveStep] = useState(0);
  const [stepProducts, setStepProducts] = useState(Array(MAX_COMBO_STEPS).fill(null));

  useEffect(() => { if (collProdsFetcher0.data?.collectionProducts) setStepProducts((p) => { const n = [...p]; n[0] = collProdsFetcher0.data.collectionProducts; return n; }); }, [collProdsFetcher0.data]);
  useEffect(() => { if (collProdsFetcher1.data?.collectionProducts) setStepProducts((p) => { const n = [...p]; n[1] = collProdsFetcher1.data.collectionProducts; return n; }); }, [collProdsFetcher1.data]);
  useEffect(() => { if (collProdsFetcher2.data?.collectionProducts) setStepProducts((p) => { const n = [...p]; n[2] = collProdsFetcher2.data.collectionProducts; return n; }); }, [collProdsFetcher2.data]);
  useEffect(() => { if (collProdsFetcher3.data?.collectionProducts) setStepProducts((p) => { const n = [...p]; n[3] = collProdsFetcher3.data.collectionProducts; return n; }); }, [collProdsFetcher3.data]);
  useEffect(() => { if (collProdsFetcher4.data?.collectionProducts) setStepProducts((p) => { const n = [...p]; n[4] = collProdsFetcher4.data.collectionProducts; return n; }); }, [collProdsFetcher4.data]);
  useEffect(() => { if (collProdsFetcher5.data?.collectionProducts) setStepProducts((p) => { const n = [...p]; n[5] = collProdsFetcher5.data.collectionProducts; return n; }); }, [collProdsFetcher5.data]);
  useEffect(() => { if (collProdsFetcher6.data?.collectionProducts) setStepProducts((p) => { const n = [...p]; n[6] = collProdsFetcher6.data.collectionProducts; return n; }); }, [collProdsFetcher6.data]);
  useEffect(() => { if (collProdsFetcher7.data?.collectionProducts) setStepProducts((p) => { const n = [...p]; n[7] = collProdsFetcher7.data.collectionProducts; return n; }); }, [collProdsFetcher7.data]);

  /* Combo image preview (data URL set by FileReader) */
  const [comboImagePreview, setComboImagePreview] = useState(null);
  const [stepImagePreviews, setStepImagePreviews] = useState(Array(8).fill(null));
  const comboImageRef = useRef(null);

  const handleComboImageDrop = useCallback((_dropFiles, acceptedFiles) => {
    const file = acceptedFiles[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setComboImagePreview(ev.target?.result || null);
    reader.readAsDataURL(file);
    const dt = new DataTransfer();
    dt.items.add(file);
    if (comboImageRef.current) comboImageRef.current.files = dt.files;
  }, []);

  /* -- Collection modal -- */
  const [showCollModal, setShowCollModal] = useState(false);
  const [collModalStepIdx, setCollModalStepIdx] = useState(null);
  const [collSearch, setCollSearch] = useState("");
  const [collStatusFilter, setCollStatusFilter] = useState("all");
  const [tempColls, setTempColls] = useState([]);
  const [pendingCollLoad, setPendingCollLoad] = useState(null);

  useEffect(() => {
    if (!pendingCollLoad) return;
    const { stepIdx, collId } = pendingCollLoad;
    setPendingCollLoad(null);
    collProdsFetchers[stepIdx].load(`/app/boxes/specific-combo?collectionId=${encodeURIComponent(collId)}`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCollLoad]);

  /* -- Step product modal -- */
  const [showStepProdModal, setShowStepProdModal] = useState(false);
  const [stepProdModalIdx, setStepProdModalIdx] = useState(null);
  const [stepProdSearch, setStepProdSearch] = useState("");
  const [stepProdStatusFilter, setStepProdStatusFilter] = useState("all");
  const [tempStepProds, setTempStepProds] = useState([]);

  /* -- Step count stepper -- */
  function setStepCount(n) {
    const clampedN = Math.max(MIN_COMBO_STEPS, Math.min(MAX_COMBO_STEPS, n));
    setComboConfig((prev) => {
      const newSteps = [...prev.steps];
      while (newSteps.length < clampedN) {
        const idx = newSteps.length;
        newSteps.push(buildDefaultStep(idx));
      }
      return { ...prev, type: clampedN, steps: newSteps.slice(0, clampedN) };
    });
    setComboActiveStep((prev) => Math.min(prev, clampedN - 1));
  }

  /* -- Combo helpers -- */
  function updateComboField(field, value) { setComboConfig((prev) => ({ ...prev, [field]: value })); }
  function updateComboStep(stepIdx, field, value) {
    setComboConfig((prev) => ({ ...prev, steps: prev.steps.map((s, i) => i === stepIdx ? { ...s, [field]: value } : s) }));
  }
  function updateComboStepPopup(stepIdx, field, value) {
    setComboConfig((prev) => ({ ...prev, steps: prev.steps.map((s, i) => i === stepIdx ? { ...s, popup: { ...s.popup, [field]: value } } : s) }));
  }
  function updateStepScope(stepIdx, nextScope) {
    setComboConfig((prev) => ({
      ...prev,
      steps: prev.steps.map((st, i) => {
        if (i !== stepIdx || st.scope === nextScope) return st;
        return { ...st, scope: nextScope, collections: [], selectedProducts: [] };
      }),
    }));
  }

  function confirmColl() {
    if (tempColls.length === 0) return;
    const idx = collModalStepIdx;
    const firstCollId = tempColls[0].id;
    setComboConfig((prev) => ({ ...prev, steps: prev.steps.map((s, i) => i !== idx ? s : { ...s, collections: tempColls, selectedProducts: [] }) }));
    setStepProducts((p) => { const n = [...p]; n[idx] = null; return n; });
    setShowCollModal(false);
    setPendingCollLoad({ stepIdx: idx, collId: firstCollId });
  }
  function confirmStepProd() {
    updateComboStep(stepProdModalIdx, "selectedProducts", tempStepProds);
    setShowStepProdModal(false);
  }

  const comboDynamicSelectedPrices = useMemo(() => {
    return comboConfig.steps
      .slice(0, comboConfig.type)
      .flatMap((step) => (step.selectedProducts || []).map((product) => parseFloat(product.price) || 0))
      .filter((price) => price > 0);
  }, [comboConfig.steps, comboConfig.type]);

  const comboDynamicMrp = useMemo(() => {
    return comboDynamicSelectedPrices.reduce((sum, price) => sum + price, 0);
  }, [comboDynamicSelectedPrices]);

  const comboDynamicDiscountBreakdown = useMemo(() => {
    return getAdminComboDiscountBreakdown(
      comboDynamicMrp,
      comboConfig,
      comboDynamicSelectedPrices.length,
      comboDynamicSelectedPrices,
    );
  }, [
    comboDynamicMrp,
    comboConfig.discountType,
    comboConfig.discountValue,
    comboConfig.buyQuantity,
    comboConfig.getQuantity,
    comboDynamicSelectedPrices,
  ]);
  const comboDynamicPrice = comboDynamicDiscountBreakdown.discountedTotal;

  const comboConfigJson = JSON.stringify(sanitizeSpecificComboPricing({
    ...comboConfig,
    bundlePrice: comboConfig.bundlePriceType === "dynamic"
      ? comboDynamicPrice
      : parseFloat(comboConfig.bundlePrice) || 0,
  }));

  const filteredColls = collections.filter((c) => {
    const matchesSearch = !collSearch || c.title.toLowerCase().includes(collSearch.toLowerCase());
    const matchesStatus = collStatusFilter === "all" || collStatusFilter === "active";
    return matchesSearch && matchesStatus;
  });
  const activeScopedProducts = stepProdModalIdx !== null ? (stepProducts[stepProdModalIdx] ?? products) : products;
  const isLoadingStepProds = stepProdModalIdx !== null && collProdsFetchers[stepProdModalIdx]?.state === "loading";
  const filteredStepProds = activeScopedProducts.filter((p) => {
    const matchesSearch = !stepProdSearch || p.title.toLowerCase().includes(stepProdSearch.toLowerCase());
    const matchesStatus = stepProdStatusFilter === "all" || stepProdStatusFilter === "active";
    return matchesSearch && matchesStatus;
  });

  const stepTabs = Array.from({ length: comboConfig.type }, (_, i) => ({
    id: String(i),
    content: comboConfig.steps[i]?.label || `Step ${i + 1}`,
    panelID: `step-panel-${i}`,
  }));

  const activeStepData = comboConfig.steps[comboActiveStep];
  const stepScope =
    activeStepData?.scope === "product" || activeStepData?.scope === "wholestore"
      ? "product"
      : "collection";

  const discountTypeOptions = [
    { label: "% Off Total", value: "percent" },
    { label: `${currencySymbol} Fixed Discount`, value: "fixed" },
    { label: "None", value: "none" },
  ];

  return (
    <Page
      title="Create Specific Combo Box"
      backAction={{ content: "Boxes", url: withEmbeddedAppParams("/app/boxes", location.search) }}
      primaryAction={{
        content: isSaving ? "Saving..." : "Save & Publish",
        loading: isSaving,
        onAction: () => document.getElementById("specific-combo-form")?.requestSubmit(),
      }}
    >
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
          <Spinner accessibilityLabel="Loading page" size="large" />
        </div>
      )}

      <Form id="specific-combo-form" method="POST" encType="multipart/form-data" action={`/app/boxes/specific-combo${location.search}`}>
        <input type="hidden" name="comboStepsConfig" value={comboConfigJson} />
        <input type="hidden" name="stepCount" value={comboConfig.type} />

        <BlockStack gap="500">
          {/* Global error banner */}
          {errors._global && (
            <Banner tone="critical" title="Error">
              <p>{errors._global}</p>
            </Banner>
          )}

          {/* Combo config error */}
          {comboFormError && (
            <Banner tone="critical" title="Combo configuration error">
              <p>{comboFormError}</p>
            </Banner>
          )}

          {/* Bundle price error */}
          {errors.bundlePrice && (
            <Banner tone="warning" title="Bundle price required">
              <p>{errors.bundlePrice}</p>
            </Banner>
          )}

          {/* ── Bundle Settings Card ── */}
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">Bundle Settings</Text>
                <SettingToggle
                  enabled={comboConfig.isActive}
                  action={{
                    content: comboConfig.isActive ? "On" : "Off",
                    onAction: () => updateComboField("isActive", !comboConfig.isActive),
                  }}
                >
                  <Text as="p" variant="bodySm" fontWeight="semibold">Active on Storefront</Text>
                  <Text as="p" variant="bodySm" tone="subdued">Uncheck to hide from customers</Text>
                </SettingToggle>
              </InlineStack>

              <FormLayout>
                <FormLayout.Group>
                  <BlockStack gap="100">
                    <Text as="label" variant="bodySm" fontWeight="semibold">Bundle Title *</Text>
                    <input
                      type="text"
                      name="comboName"
                      placeholder="e.g. Premium Bundle"
                      style={{ ...inputStyle, borderColor: errors.comboName ? "#e11d48" : "#e5e7eb" }}
                    />
                    {errors.comboName && (
                      <Text as="p" variant="bodySm" tone="critical">{errors.comboName}</Text>
                    )}
                  </BlockStack>

                  <BlockStack gap="100">
                    <Text as="label" variant="bodySm" fontWeight="semibold">Description</Text>
                    <input
                      type="text"
                      style={inputStyle}
                      value={comboConfig.subtitle}
                      onChange={(e) => updateComboField("subtitle", e.target.value)}
                      placeholder="Choose a product for each step"
                    />
                  </BlockStack>

                  <BlockStack gap="100">
                    <Text as="label" variant="bodySm" fontWeight="semibold">Combo Product Button Title</Text>
                    <input
                      type="text"
                      style={inputStyle}
                      value={comboConfig.ctaButtonLabel || ""}
                      onChange={(e) => updateComboField("ctaButtonLabel", e.target.value)}
                      placeholder="BUILD YOUR OWN BOX"
                    />
                  </BlockStack>
                </FormLayout.Group>
              </FormLayout>

              {/* Number of steps */}
              <InlineStack gap="300" blockAlign="center">
                <Text as="p" variant="bodyMd">Number of steps:</Text>
                <Button
                  onClick={() => setStepCount(comboConfig.type - 1)}
                  disabled={comboConfig.type <= MIN_COMBO_STEPS}
                >
                  -
                </Button>
                <Text as="p" variant="bodyMd" fontWeight="bold">{comboConfig.type}</Text>
                <Button
                  onClick={() => setStepCount(comboConfig.type + 1)}
                  disabled={comboConfig.type >= MAX_COMBO_STEPS}
                >
                  +
                </Button>
                <Text as="p" variant="bodySm" tone="subdued">{comboConfig.type} product selections required (2–8)</Text>
              </InlineStack>

              {/* Combo image upload */}
              <BlockStack gap="100">
                <Text as="label" variant="bodySm" fontWeight="semibold">Combo Image (optional)</Text>
                <input type="file" ref={comboImageRef} name="comboImage" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" style={{ display: "none" }} />
                {comboImagePreview ? (
                  <div style={{ position: "relative", display: "inline-block", width: "120px" }}>
                    <img src={comboImagePreview} alt="Combo preview" style={{ width: "120px", borderRadius: "6px", border: "1px solid #e5e7eb", display: "block" }} />
                    <button
                      type="button"
                      onClick={() => { setComboImagePreview(null); if (comboImageRef.current) comboImageRef.current.value = ""; }}
                      style={{ position: "absolute", top: "4px", right: "4px", background: "rgba(0,0,0,0.65)", border: "none", borderRadius: "50%", width: "22px", height: "22px", cursor: "pointer", color: "#fff", fontSize: "14px", lineHeight: "22px", textAlign: "center", padding: 0 }}
                      aria-label="Remove image"
                    >×</button>
                  </div>
                ) : (
                  <DropZone accept="image/jpeg,image/png,image/webp,image/gif,image/avif" type="image" allowMultiple={false} onDrop={handleComboImageDrop}>
                    <DropZone.FileUpload />
                  </DropZone>
                )}
                <Text as="p" variant="bodySm" tone="subdued">JPG, PNG, WEBP, GIF, or AVIF – max 2MB</Text>
                {errors.comboImage && (
                  <Text as="p" variant="bodySm" tone="critical">{errors.comboImage}</Text>
                )}
              </BlockStack>
            </BlockStack>
          </Card>

          {/* ── Pricing Card ── */}
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Pricing ({currencySymbol})</Text>

              {/* Price mode toggle */}
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" fontWeight="semibold">Price Mode</Text>
                <InlineStack gap="200">
                  {["manual", "dynamic"].map((mode) => (
                    <Button
                      key={mode}
                      variant={comboConfig.bundlePriceType === mode ? "primary" : "secondary"}
                      onClick={() => updateComboField("bundlePriceType", mode)}
                    >
                      {mode === "manual" ? "Manual" : "Dynamic"}
                    </Button>
                  ))}
                </InlineStack>
              </BlockStack>

              {comboConfig.bundlePriceType === "manual" && (
                <BlockStack gap="100">
                  <Text as="label" variant="bodySm" fontWeight="semibold">Bundle Price ({currencySymbol}) *</Text>
                  <input
                    type="number"
                    placeholder="e.g. 1200"
                    min="0"
                    step="0.01"
                    style={inputStyle}
                    value={comboConfig.bundlePrice || ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (!val || parseFloat(val) === 0) {
                        updateComboField("bundlePriceType", "dynamic");
                      } else {
                        updateComboField("bundlePrice", val);
                      }
                    }}
                  />
                </BlockStack>
              )}

              {comboConfig.bundlePriceType === "dynamic" && (
                <Card background="bg-surface-secondary">
                  <BlockStack gap="300">
                    <InlineGrid columns={2} gap="300">
                      <BlockStack gap="100">
                        <Text as="label" variant="bodySm" fontWeight="semibold">Discount Type</Text>
                        <select
                          value={normalizeSpecificDiscountType(comboConfig.discountType)}
                          onChange={(e) => {
                            const nextType = normalizeSpecificDiscountType(e.target.value);
                            updateComboField("discountType", nextType);
                          }}
                          style={{ ...inputStyle, fontWeight: "600" }}
                        >
                          {discountTypeOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </BlockStack>

                      {comboConfig.discountType !== "none" && (
                        <BlockStack gap="100">
                          {comboConfig.discountType === "buy_x_get_y" ? (
                            <InlineGrid columns={2} gap="200">
                              <BlockStack gap="100">
                                <Text as="label" variant="bodySm" fontWeight="semibold">Buy X quantity</Text>
                                <input
                                  type="number"
                                  min="1"
                                  step="1"
                                  value={comboConfig.buyQuantity ?? 1}
                                  onChange={(e) => updateComboField("buyQuantity", Math.max(1, parseInt(e.target.value || "1", 10) || 1))}
                                  style={inputStyle}
                                />
                              </BlockStack>
                              <BlockStack gap="100">
                                <Text as="label" variant="bodySm" fontWeight="semibold">Get Y free quantity</Text>
                                <input
                                  type="number"
                                  min="1"
                                  step="1"
                                  value={comboConfig.getQuantity ?? 1}
                                  onChange={(e) => updateComboField("getQuantity", Math.max(1, parseInt(e.target.value || "1", 10) || 1))}
                                  style={inputStyle}
                                />
                              </BlockStack>
                            </InlineGrid>
                          ) : (
                            <BlockStack gap="100">
                              <Text as="label" variant="bodySm" fontWeight="semibold">
                                {comboConfig.discountType === "percent" ? "Discount %" : `Amount (${currencySymbol})`}
                              </Text>
                              <input
                                type="number"
                                min="0"
                                step={comboConfig.discountType === "fixed" ? "0.01" : "1"}
                                max={comboConfig.discountType === "fixed" ? undefined : "100"}
                                value={comboConfig.discountValue}
                                onChange={(e) => updateComboField("discountValue", e.target.value)}
                                style={inputStyle}
                              />
                            </BlockStack>
                          )}
                          {comboConfig.discountType === "buy_x_get_y" && comboDynamicDiscountBreakdown.discountAmount > 0 && (
                            <Text as="p" variant="bodySm" tone="success">
                              Product discount: {formatCurrencyAmount(comboDynamicDiscountBreakdown.discountAmount, currencyCode)}
                              {" "}({comboDynamicDiscountBreakdown.freeUnits} free)
                              {" "} | Order discount: {formatCurrencyAmount(comboDynamicDiscountBreakdown.discountAmount, currencyCode)}
                            </Text>
                          )}
                        </BlockStack>
                      )}
                    </InlineGrid>

                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="p" variant="bodySm" tone="subdued">
                        {comboConfig.discountType === "percent" || comboConfig.discountType === "fixed"
                          ? "Discount applied on total amount"
                          : comboDynamicMrp > 0
                            ? (comboConfig.discountType === "none" ? "Sum of step products:" : "After discount:")
                            : "Price calculated from selected step products"}
                      </Text>
                      {comboDynamicMrp > 0 && (
                        <Text as="p" variant="bodyMd" fontWeight="bold" tone="success">
                          {formatCurrencyAmount(comboDynamicPrice, currencyCode)}
                        </Text>
                      )}
                    </InlineStack>
                  </BlockStack>
                </Card>
              )}
            </BlockStack>
          </Card>

          {/* ── Steps Editor Card ── */}
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">Steps</Text>
                <Badge>{comboConfig.type} total</Badge>
              </InlineStack>

              <Tabs
                tabs={stepTabs}
                selected={comboActiveStep}
                onSelect={(idx) => setComboActiveStep(idx)}
              >
                {activeStepData && (
                  <Box paddingBlockStart="400">
                    <BlockStack gap="400">
                      {/* Picker setup */}
                      <BlockStack gap="300">
                          <Text as="h3" variant="headingSm">Picker Setup</Text>
                          <Text as="p" variant="bodySm" tone="subdued">Each step has its own independent collection and product selector</Text>

                          {comboStepErrors[comboActiveStep] && (
                            <Banner tone="critical">
                              <p>{comboStepErrors[comboActiveStep]}</p>
                            </Banner>
                          )}

                          <FormLayout>
                            <FormLayout.Group>
                              <BlockStack gap="100">
                                <Text as="label" variant="bodySm" fontWeight="semibold">Step Label</Text>
                                <input
                                  type="text"
                                  value={activeStepData.label}
                                  onChange={(e) => updateComboStep(comboActiveStep, "label", e.target.value)}
                                  style={inputStyle}
                                  placeholder="e.g. Main Product"
                                />
                                <Text as="p" variant="bodySm" tone="subdued">Heading shown on the storefront step</Text>
                              </BlockStack>

                              <BlockStack gap="200">
                                <Text as="label" variant="bodySm" fontWeight="semibold">Scope</Text>
                                <InlineStack gap="200">
                                  {[
                                    { value: "collection", label: "Specific collections" },
                                    { value: "product", label: "Specific products" },
                                  ].map((opt) => (
                                    <label
                                      key={opt.value}
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "8px",
                                        padding: "8px 12px",
                                        border: `1.5px solid ${stepScope === opt.value ? "#000000" : "#d1d5db"}`,
                                        borderRadius: "6px",
                                        background: stepScope === opt.value ? "#f9fafb" : "#fff",
                                        cursor: "pointer",
                                      }}
                                    >
                                      <input
                                        type="radio"
                                        name={`step-scope-${comboActiveStep}`}
                                        value={opt.value}
                                        checked={stepScope === opt.value}
                                        onChange={() => updateStepScope(comboActiveStep, opt.value)}
                                        style={{ width: "16px", height: "16px", cursor: "pointer", margin: 0, flexShrink: 0 }}
                                      />
                                      <Text as="span" variant="bodySm" fontWeight={stepScope === opt.value ? "semibold" : "regular"}>
                                        {opt.label}
                                      </Text>
                                    </label>
                                  ))}
                                </InlineStack>

                                <InlineStack gap="300" blockAlign="center">
                                  {stepScope === "collection" ? (
                                    <Button
                                      onClick={() => {
                                        setCollModalStepIdx(comboActiveStep);
                                        setTempColls([...activeStepData.collections]);
                                        setCollSearch("");
                                        setCollStatusFilter("all");
                                        setShowCollModal(true);
                                      }}
                                    >
                                      Select collections
                                    </Button>
                                  ) : (
                                    <Button
                                      onClick={() => {
                                        setStepProdModalIdx(comboActiveStep);
                                        setTempStepProds([...(activeStepData.selectedProducts || [])]);
                                        setStepProdSearch("");
                                        setStepProdStatusFilter("all");
                                        setShowStepProdModal(true);
                                      }}
                                    >
                                      Select products
                                    </Button>
                                  )}
                                  <Text as="p" variant="bodySm" tone="subdued">
                                    {stepScope === "collection"
                                      ? `${activeStepData.collections.length} selected`
                                      : `${(activeStepData.selectedProducts || []).length} selected`}
                                  </Text>
                                </InlineStack>
                              </BlockStack>
                            </FormLayout.Group>
                          </FormLayout>

                          {/* Selected collections tags */}
                          {activeStepData.collections.length > 0 && stepScope === "collection" && (
                            <InlineStack gap="200" wrap>
                              {activeStepData.collections.map((c) => (
                                <div
                                  key={c.id}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "6px",
                                    padding: "4px 10px",
                                    background: "#f9fafb",
                                    border: "1.5px solid #000",
                                    borderRadius: "5px",
                                  }}
                                >
                                  <Text as="span" variant="bodySm" fontWeight="semibold">{c.title}</Text>
                                  <button
                                    type="button"
                                    aria-label={`Remove ${c.title}`}
                                    onClick={() => updateComboStep(comboActiveStep, "collections", activeStepData.collections.filter((x) => x.id !== c.id))}
                                    style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", display: "inline-flex", alignItems: "center", padding: "0 2px" }}
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                            </InlineStack>
                          )}

                          {/* Selected products tags */}
                          {(activeStepData.selectedProducts || []).length > 0 && stepScope === "product" && (
                            <BlockStack gap="100">
                              {activeStepData.selectedProducts.map((p) => (
                                <div
                                  key={p.id}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    padding: "6px 10px",
                                    background: "#f9fafb",
                                    border: "1.5px solid #000",
                                    borderRadius: "5px",
                                  }}
                                >
                                  <Text as="span" variant="bodySm" fontWeight="semibold">
                                    {p.title} - {formatCurrencyAmount(parseFloat(p.price || 0), currencyCode)}
                                  </Text>
                                  <button
                                    type="button"
                                    aria-label={`Remove ${p.title}`}
                                    onClick={() => updateComboStep(comboActiveStep, "selectedProducts", activeStepData.selectedProducts.filter((x) => x.id !== p.id))}
                                    style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", display: "inline-flex", alignItems: "center", padding: "0 2px" }}
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                            </BlockStack>
                          )}
                        </BlockStack>

                      <Divider />

                      {/* Step general settings */}
                      <BlockStack gap="300">
                          <Text as="h3" variant="headingSm">Step Settings</Text>
                          <InlineGrid columns={{ xs: 1, md: 4 }} gap="400">
                            <BlockStack gap="100">
                              <Text as="label" variant="bodySm" fontWeight="semibold">Heading</Text>
                              <input
                                type="text"
                                value={activeStepData.popup.title}
                                onChange={(e) => updateComboStepPopup(comboActiveStep, "title", e.target.value)}
                                style={inputStyle}
                                placeholder="e.g. Choose your main product"
                              />
                            </BlockStack>
                            <BlockStack gap="100">
                              <Text as="label" variant="bodySm" fontWeight="semibold">Description</Text>
                              <input
                                type="text"
                                value={activeStepData.popup.desc}
                                onChange={(e) => updateComboStepPopup(comboActiveStep, "desc", e.target.value)}
                                style={inputStyle}
                                placeholder="Select the primary product."
                              />
                            </BlockStack>
                            <BlockStack gap="100">
                              <Text as="label" variant="bodySm" fontWeight="semibold">Product Button Title</Text>
                              <input
                                type="text"
                                value={activeStepData.popup.btn}
                                onChange={(e) => updateComboStepPopup(comboActiveStep, "btn", e.target.value)}
                                style={inputStyle}
                                placeholder="e.g. Confirm selection"
                              />
                            </BlockStack>
                            <BlockStack gap="100">
                              <SettingToggle
                                enabled={activeStepData.optional === true}
                                action={{
                                  content: activeStepData.optional === true ? "On" : "Off",
                                  onAction: () => updateComboStep(comboActiveStep, "optional", !(activeStepData.optional === true)),
                                }}
                              >
                                <Text as="p" variant="bodySm" fontWeight="semibold">Optional Step</Text>
                                <Text as="p" variant="bodySm" tone="subdued">If enabled, customers can skip this step.</Text>
                              </SettingToggle>
                            </BlockStack>
                          </InlineGrid>
                        </BlockStack>

                      {/* Hidden step image inputs (kept for form submission) */}
                      <div style={{ display: "none" }}>
                        {Array.from({ length: comboConfig.type }, (_, si) => (
                          <input
                            key={si}
                            type="file"
                            name={`stepImage_${si}`}
                            accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              const reader = new FileReader();
                              reader.onload = (ev) => setStepImagePreviews((p) => { const n = [...p]; n[si] = ev.target.result; return n; });
                              reader.readAsDataURL(file);
                            }}
                          />
                        ))}
                      </div>
                    </BlockStack>
                  </Box>
                )}
              </Tabs>
            </BlockStack>
          </Card>

          {/* ── Options Card ── */}
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Options</Text>
              <FormLayout>
                <FormLayout.Group>
                  <SettingToggle
                    enabled={comboConfig.isGiftBox}
                    action={{
                      content: comboConfig.isGiftBox ? "On" : "Off",
                      onAction: () => updateComboField("isGiftBox", !comboConfig.isGiftBox),
                    }}
                  >
                    <Text as="p" variant="bodySm" fontWeight="semibold">Gift Box Mode</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Shows gift wrapping option to customers</Text>
                  </SettingToggle>
                  <SettingToggle
                    enabled={comboConfig.giftMessageEnabled}
                    action={{
                      content: comboConfig.giftMessageEnabled ? "On" : "Off",
                      onAction: () => updateComboField("giftMessageEnabled", !comboConfig.giftMessageEnabled),
                      disabled: !comboConfig.isGiftBox,
                    }}
                  >
                    <Text as="p" variant="bodySm" fontWeight="semibold">Gift Message Field</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Show text area for gift message</Text>
                  </SettingToggle>
                  <SettingToggle
                    enabled={comboConfig.allowDuplicates}
                    action={{
                      content: comboConfig.allowDuplicates ? "On" : "Off",
                      onAction: () => updateComboField("allowDuplicates", !comboConfig.allowDuplicates),
                    }}
                  >
                    <Text as="p" variant="bodySm" fontWeight="semibold">Allow Duplicates</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Same product can fill multiple slots</Text>
                  </SettingToggle>
                </FormLayout.Group>
              </FormLayout>

              {/* Hidden inputs for boolean options */}
              <input type="hidden" name="isGiftBox" value={String(comboConfig.isGiftBox)} />
              <input type="hidden" name="giftMessageEnabled" value={String(comboConfig.giftMessageEnabled)} />
              <input type="hidden" name="allowDuplicates" value={String(comboConfig.allowDuplicates)} />
              <input type="hidden" name="isActive" value={String(comboConfig.isActive)} />
            </BlockStack>
          </Card>
        </BlockStack>
      </Form>

      {/* ── MODAL: Collection Picker ── */}
      <Modal
        open={showCollModal}
        onClose={() => setShowCollModal(false)}
        title="Select collections"
        primaryAction={{
          content: "Select",
          disabled: tempColls.length === 0,
          onAction: confirmColl,
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setShowCollModal(false) },
        ]}
        size="large"
      >
        <Modal.Section>
          <BlockStack gap="300">
            <InlineGrid columns={["1fr", "auto"]} gap="200">
              <input
                type="text"
                placeholder="Search collections"
                value={collSearch}
                onChange={(e) => setCollSearch(e.target.value)}
                autoFocus
                style={{ ...inputStyle, height: "40px" }}
              />
              <select
                value={collStatusFilter}
                onChange={(e) => setCollStatusFilter(e.target.value)}
                style={{ ...inputStyle, height: "40px", fontWeight: "600", width: "160px" }}
              >
                <option value="all">All</option>
                <option value="active">Active</option>
              </select>
            </InlineGrid>

            <div style={{ borderTop: "1px solid #e5e7eb" }}>
              {/* Header row */}
              <div style={{ display: "grid", gridTemplateColumns: "60px minmax(0,1fr) 110px", padding: "10px 12px", fontSize: "12px", color: "#6b7280", fontWeight: "700", borderBottom: "1px solid #e5e7eb" }}>
                <div>Select</div>
                <div>Collection</div>
                <div>Products</div>
              </div>

              <div style={{ maxHeight: "340px", overflowY: "auto" }}>
                {filteredColls.length === 0 ? (
                  <div style={{ padding: "32px 20px", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>No collections found</div>
                ) : filteredColls.map((coll, idx) => {
                  const isSel = tempColls.some((c) => c.id === coll.id);
                  const productCount = Number.isFinite(coll?.productsCount) ? coll.productsCount : (coll?.productCount ?? 1);
                  return (
                    <div
                      key={coll.id}
                      onClick={() => setTempColls(isSel ? tempColls.filter((c) => c.id !== coll.id) : [...tempColls, coll])}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "60px minmax(0,1fr) 110px",
                        alignItems: "center",
                        padding: "10px 12px",
                        borderBottom: idx < filteredColls.length - 1 ? "1px solid #f3f4f6" : "none",
                        cursor: "pointer",
                        background: isSel ? "#f8fafc" : "#fff",
                        userSelect: "none",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center" }}>
                        <input type="checkbox" checked={isSel} readOnly style={{ width: "20px", height: "20px", cursor: "pointer" }} />
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                        {coll.imageUrl ? (
                          <img src={coll.imageUrl} alt={coll.title} style={{ width: "44px", height: "44px", objectFit: "cover", borderRadius: "8px", border: "1px solid #e5e7eb", flexShrink: 0 }} />
                        ) : (
                          <div style={{ width: "44px", height: "44px", borderRadius: "8px", background: "#f3f4f6", border: "1px solid #e5e7eb", flexShrink: 0 }} />
                        )}
                        <Text as="span" variant="bodySm" fontWeight="semibold">{coll.title}</Text>
                      </div>
                      <div>
                        <Badge tone="info">{`${productCount} items`}</Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* ── MODAL: Step Product Picker ── */}
      <Modal
        open={showStepProdModal}
        onClose={() => setShowStepProdModal(false)}
        title="Select products"
        primaryAction={{
          content: "Select",
          disabled: tempStepProds.length === 0,
          onAction: confirmStepProd,
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setShowStepProdModal(false) },
        ]}
        size="large"
      >
        <Modal.Section>
          <BlockStack gap="300">
            <InlineGrid columns={["1fr", "auto"]} gap="200">
              <input
                type="text"
                placeholder="Search products"
                value={stepProdSearch}
                onChange={(e) => setStepProdSearch(e.target.value)}
                autoFocus
                style={{ ...inputStyle, height: "40px" }}
              />
              <select
                value={stepProdStatusFilter}
                onChange={(e) => setStepProdStatusFilter(e.target.value)}
                style={{ ...inputStyle, height: "40px", fontWeight: "600", width: "160px" }}
              >
                <option value="all">All</option>
                <option value="active">Active</option>
              </select>
            </InlineGrid>

            <div style={{ borderTop: "1px solid #e5e7eb" }}>
              {/* Header row */}
              <div style={{ display: "grid", gridTemplateColumns: "60px minmax(0,1fr) 110px", padding: "10px 12px", fontSize: "12px", color: "#6b7280", fontWeight: "700", borderBottom: "1px solid #e5e7eb" }}>
                <div>Select</div>
                <div>Product</div>
                <div>Status</div>
              </div>

              <div style={{ maxHeight: "340px", overflowY: "auto" }}>
                {isLoadingStepProds ? (
                  <div style={{ padding: "32px 20px", textAlign: "center" }}>
                    <Spinner accessibilityLabel="Loading products" size="small" />
                  </div>
                ) : filteredStepProds.length === 0 ? (
                  <div style={{ padding: "32px 20px", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>No products found</div>
                ) : filteredStepProds.map((product, idx) => {
                  const isSel = tempStepProds.some((p) => p.id === product.id);
                  return (
                    <div
                      key={product.id}
                      onClick={() => setTempStepProds(
                        isSel
                          ? tempStepProds.filter((p) => p.id !== product.id)
                          : [...tempStepProds, { id: product.id, title: product.title, handle: product.handle, imageUrl: product.imageUrl, price: product.price }]
                      )}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "60px minmax(0,1fr) 110px",
                        alignItems: "center",
                        padding: "10px 12px",
                        borderBottom: idx < filteredStepProds.length - 1 ? "1px solid #f3f4f6" : "none",
                        cursor: "pointer",
                        background: isSel ? "#f8fafc" : "#fff",
                        userSelect: "none",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center" }}>
                        <input type="checkbox" checked={isSel} readOnly style={{ width: "20px", height: "20px", cursor: "pointer" }} />
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                        {product.imageUrl ? (
                          <img src={product.imageUrl} alt={product.title} style={{ width: "44px", height: "44px", objectFit: "cover", borderRadius: "8px", flexShrink: 0, border: "1px solid #e5e7eb" }} />
                        ) : (
                          <div style={{ width: "44px", height: "44px", borderRadius: "8px", background: "#f3f4f6", flexShrink: 0 }} />
                        )}
                        <Text as="span" variant="bodySm" fontWeight="semibold" truncate>{product.title}</Text>
                      </div>
                      <div>
                        <Badge tone="success">active</Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
export const headers = (headersArgs) => boundary.headers(headersArgs);
