import { useState, useMemo, useEffect } from "react";
import { useFetcher, useLoaderData, useLocation, useNavigation, useRouteError } from "react-router";
import {
  Badge, Banner, BlockStack, Box, Button, Card, Checkbox,
  Divider, FormLayout, InlineGrid, InlineStack, Modal, Page,
  Spinner, Tabs, Text, TextField
} from "@shopify/polaris";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { Buffer } from "node:buffer";
import { getBox, upsertComboConfig, saveComboStepImages, getComboStepImages, syncShopifyBundleProduct, syncSpecificComboProductMedia } from "../models/boxes.server";
import { getShopCurrencyCode } from "../models/shop.server";
import { withEmbeddedAppParams, withEmbeddedAppToastFromRequest } from "../utils/embedded-app";
import { formatCurrencyAmount, getCurrencySymbol } from "../utils/currency";


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
const MIN_COMBO_STEPS = 2;
const MAX_COMBO_STEPS = 8;

function buildDefaultStep(index) {
  return {
    label: `Step ${index + 1}`,
    optional: false,
    scope: "collection",
    collections: [],
    selectedProducts: [],
    popup: {
      title: `Choose product for Step ${index + 1}`,
      desc: "Select a product for this step.",
      btn: "Confirm selection",
    },
  };
}

const DEFAULT_COMBO_CONFIG = {
  type: MIN_COMBO_STEPS,
  listingTitle: "",
  title: "Build Your Perfect Bundle",
  subtitle: "Choose a product for each step",
  highlightText: "",
  supportText: "",
  ctaButtonLabel: "BUILD YOUR OWN BOX",
  addToCartLabel: "Add To Cart",
  bundlePrice: 0,
  bundlePriceType: "manual",
  discountType: "none",
  discountValue: "0",
  buyQuantity: 1,
  getQuantity: 1,
  isActive: true,
  isGiftBox: false,
  allowDuplicates: false,
  giftMessageEnabled: false,
  showProductImages: true,
  showProgressBar: true,
  allowReselection: true,
  steps: Array.from({ length: MIN_COMBO_STEPS }, (_, index) => buildDefaultStep(index)),
};

function normalizeSpecificDiscountType(discountType) {
  return discountType === "buy_x_get_y" ? "none" : (discountType || "none");
}

function sanitizeSpecificComboPricing(config) {
  const safeConfig = config && typeof config === "object" ? config : {};
  const listingTitle = typeof safeConfig.listingTitle === "string" ? safeConfig.listingTitle.trim() : "";
  const ctaButtonLabel = typeof safeConfig.ctaButtonLabel === "string" && safeConfig.ctaButtonLabel.trim()
    ? safeConfig.ctaButtonLabel.trim()
    : (typeof safeConfig.comboButtonTitle === "string" ? safeConfig.comboButtonTitle.trim() : DEFAULT_COMBO_CONFIG.ctaButtonLabel);
  const addToCartLabel = typeof safeConfig.addToCartLabel === "string" && safeConfig.addToCartLabel.trim()
    ? safeConfig.addToCartLabel.trim()
    : (typeof safeConfig.productButtonTitle === "string" ? safeConfig.productButtonTitle.trim() : DEFAULT_COMBO_CONFIG.addToCartLabel);
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
    listingTitle,
    ctaButtonLabel,
    addToCartLabel,
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

/* ─────────────────────────── Loader ─────────────────────────── */
export const loader = async ({ request, params }) => {
  const { admin, session, redirect } = await authenticate.admin(request);
  const shop = session.shop;
  const currencyCode = await getShopCurrencyCode(shop);

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
    return { collectionProducts, currencyCode };
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
    let rawHighlightText = "";
    let rawSupportText = "";
    let rawDiscountType = DEFAULT_COMBO_CONFIG.discountType;
    let rawDiscountValue = DEFAULT_COMBO_CONFIG.discountValue;
    let rawBuyQuantity = DEFAULT_COMBO_CONFIG.buyQuantity;
    let rawGetQuantity = DEFAULT_COMBO_CONFIG.getQuantity;
    if (box.comboStepsConfig) {
      try {
        const raw = JSON.parse(box.comboStepsConfig);
        rawHighlightText = typeof raw?.highlightText === "string" ? raw.highlightText : "";
        rawSupportText = typeof raw?.supportText === "string" ? raw.supportText : "";
        rawDiscountType = normalizeSpecificDiscountType(raw?.discountType || rawDiscountType);
        rawDiscountValue = String(raw?.discountValue ?? rawDiscountValue);
        rawBuyQuantity = Math.max(1, parseInt(String(raw?.buyQuantity ?? rawBuyQuantity), 10) || rawBuyQuantity);
        rawGetQuantity = Math.max(1, parseInt(String(raw?.getQuantity ?? rawGetQuantity), 10) || rawGetQuantity);
      } catch {}
    }
    const isDynamicPricing = cfg.bundlePriceType === "dynamic";
    if (!isDynamicPricing) {
      rawDiscountType = "none";
      rawDiscountValue = "0";
      rawBuyQuantity = 1;
      rawGetQuantity = 1;
    }
    comboStepsConfig = JSON.stringify({
      type:              cfg.comboType,
      title:             cfg.title             ?? undefined,
      subtitle:          cfg.subtitle          ?? undefined,
      highlightText:     rawHighlightText,
      supportText:       rawSupportText,
      bundlePrice:       cfg.bundlePrice != null ? parseFloat(cfg.bundlePrice) : undefined,
      bundlePriceType:   cfg.bundlePriceType   ?? undefined,
      discountType:      rawDiscountType,
      discountValue:     rawDiscountValue,
      buyQuantity:       rawBuyQuantity,
      getQuantity:       rawGetQuantity,
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
    currencyCode,
  };
};

/* ─────────────────────────── Combo Image Helpers ─────────────────────────── */
const MAX_STEP_IMAGE_SIZE = 2 * 1024 * 1024;
const ALLOWED_STEP_IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "image/avif"]);

async function parseComboImage(formData, errors) {
  const file = formData.get("comboImage");
  if (!file || typeof file !== "object" || typeof file.arrayBuffer !== "function" || !file.size) return null;
  if (!ALLOWED_STEP_IMAGE_TYPES.has(file.type)) {
    errors.comboImage = "Only JPG, PNG, WEBP, GIF, or AVIF files are allowed";
    return null;
  }
  if (file.size > MAX_STEP_IMAGE_SIZE) {
    errors.comboImage = "Combo image must be 2MB or smaller";
    return null;
  }
  return { stepIndex: 0, bytes: new Uint8Array(await file.arrayBuffer()), mimeType: file.type, fileName: file.name || null };
}

/* ─────────────────────────── Action ─────────────────────────── */
export const action = async ({ request, params }) => {
  const { session, admin, redirect } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("_action");

  if (intent === "save_combo") {
    const rawComboStepsConfig = formData.get("comboStepsConfig");
    let parsedConfig = {};
    try { parsedConfig = JSON.parse(rawComboStepsConfig || "{}"); } catch {}
    const comboStepsConfig = JSON.stringify(sanitizeSpecificComboPricing(parsedConfig));
    const errors = {};
    const comboImage = await parseComboImage(formData, errors);
    if (Object.keys(errors).length > 0) {
      return { ok: false, errors };
    }

    try {
      await upsertComboConfig(params.id, comboStepsConfig, admin);
    } catch (e) {
      console.error("[app.boxes.$id.combo] upsertComboConfig error:", e);
      return { ok: false, errors: { _global: "Failed to save combo configuration. Please try again." } };
    }

    // Save uploaded combo image
    if (comboImage) {
      try { await saveComboStepImages(params.id, [comboImage]); } catch (e) {
        console.error("[app.boxes.$id.combo] saveComboStepImages error:", e);
      }
    }

    // Sync title, price and step images to the Shopify bundle product
    const box = await getBox(params.id, session.shop);
    if (box?.shopifyProductId) {
      try {
        const parsedForSync = typeof comboStepsConfig === "string" ? JSON.parse(comboStepsConfig) : comboStepsConfig;
        const bundleTitle = box.boxName || box.displayTitle || parsedForSync.title;
        const bundlePrice = parsedForSync.bundlePrice != null ? parseFloat(parsedForSync.bundlePrice) : null;
        await syncShopifyBundleProduct(admin, box.shopifyProductId, box.shopifyVariantId, { title: bundleTitle, bundlePrice });
      } catch (e) {
        console.error("[app.boxes.$id.combo] syncShopifyBundleProduct error:", e);
      }
      try {
        await syncSpecificComboProductMedia(
          admin,
          box,
          box.comboStepsConfig || comboStepsConfig,
        );
      } catch (e) {
        console.error("[app.boxes.$id.combo] syncSpecificComboProductMedia error:", e);
      }
    }

    throw redirect(
      withEmbeddedAppToastFromRequest("/app/boxes", request, {
        message: "Configuration saved successfully.",
      }),
    );
  }
  return { ok: false, errors: { _global: "Unknown action" } };
};

/* ─────────────────────────── Styles ─────────────────────────── */
const inputStyle = {
  width: "100%", padding: "8px 12px", border: "1.5px solid #e5e7eb",
  borderRadius: "6px", fontSize: "14px", boxSizing: "border-box",
};

/* ─────────────────────────── Component ─────────────────────────── */
export default function SpecificComboBoxPage() {
  const { box, products, collections, stepImagesBase64, currencyCode } = useLoaderData();
  const comboFetcher = useFetcher();
  const navigation = useNavigation();
  /* One fetcher per step for lazy-loading collection-scoped products */
  const collProdsFetcher0 = useFetcher();
  const collProdsFetcher1 = useFetcher();
  const collProdsFetcher2 = useFetcher();
  const collProdsFetcher3 = useFetcher();
  const collProdsFetcher4 = useFetcher();
  const collProdsFetcher5 = useFetcher();
  const collProdsFetcher6 = useFetcher();
  const collProdsFetcher7 = useFetcher();
  const collProdsFetchers = [collProdsFetcher0, collProdsFetcher1, collProdsFetcher2, collProdsFetcher3, collProdsFetcher4, collProdsFetcher5, collProdsFetcher6, collProdsFetcher7];
  const location = useLocation();
  const currencySymbol = getCurrencySymbol(currencyCode);

  const comboErrors = comboFetcher.data?.errors || {};
  const comboStepImgErrors = {};
  const isPageLoading = comboFetcher.state !== "idle" || navigation.state !== "idle";
  const isSaving = comboFetcher.state === "submitting";

  // Toast state
  const [toast, setToast] = useState(null); // { type: "success"|"error", message: string }
  useEffect(() => {
    if (comboFetcher.data?.comboSaved) {
      setToast({ type: "success", message: "Combo configuration saved successfully." });
      const t = setTimeout(() => setToast(null), 3500);
      return () => clearTimeout(t);
    }
    if (comboFetcher.data?.errors?._global) {
      setToast({ type: "error", message: comboFetcher.data.errors._global });
      const t = setTimeout(() => setToast(null), 4500);
      return () => clearTimeout(t);
    }
  }, [comboFetcher.data]);


  /* ── Combo Config state ── */
  const [comboConfig, setComboConfig] = useState(() => {
    function normalizeStepCount(value) {
      return Math.max(MIN_COMBO_STEPS, Math.min(MAX_COMBO_STEPS, value));
    }

    function mergeSteps(parsedSteps, type) {
      const rawCount = parseInt(type, 10) || DEFAULT_COMBO_CONFIG.type;
      const count = normalizeStepCount(rawCount);
      return Array.from({ length: count }, (_, index) => {
        const base = buildDefaultStep(index);
        const parsed = Array.isArray(parsedSteps) ? parsedSteps[index] : null;
        if (!parsed) return base;
        return {
          ...base,
          ...parsed,
          optional: parsed?.optional === true || String(parsed?.optional).toLowerCase() === "true",
          popup: { ...base.popup, ...(parsed.popup || {}) },
        };
      });
    }
    // Primary: raw JSON saved on ComboBox row
    if (box.comboStepsConfig) {
      try {
        const parsed = JSON.parse(box.comboStepsConfig);
        const type = normalizeStepCount(parseInt(parsed.type, 10) || DEFAULT_COMBO_CONFIG.type);
        const normalizedPricing = sanitizeSpecificComboPricing(parsed);
        return {
          ...DEFAULT_COMBO_CONFIG,
          ...normalizedPricing,
          listingTitle: typeof parsed.listingTitle === "string" && parsed.listingTitle.trim()
            ? parsed.listingTitle.trim()
            : (box.boxName || box.displayTitle || ""),
          type,
          steps: mergeSteps(parsed.steps, type),
        };
      } catch {}
    }
    // Fallback: ComboBoxConfig relation (for records saved before the comboStepsConfig sync was added)
    if (box.config) {
      try {
        const type = normalizeStepCount(box.config.comboType ?? DEFAULT_COMBO_CONFIG.type);
        const rawSteps = box.config.stepsJson ? JSON.parse(box.config.stepsJson) : null;
        return {
          ...DEFAULT_COMBO_CONFIG,
          listingTitle: box.boxName || box.displayTitle || "",
          type,
          title:            box.config.title              ?? DEFAULT_COMBO_CONFIG.title,
          subtitle:         box.config.subtitle           ?? DEFAULT_COMBO_CONFIG.subtitle,
          bundlePrice:      box.config.bundlePrice != null ? parseFloat(box.config.bundlePrice) : DEFAULT_COMBO_CONFIG.bundlePrice,
          bundlePriceType:  box.config.bundlePriceType    ?? DEFAULT_COMBO_CONFIG.bundlePriceType,
          isActive:         box.config.isActive,
          showProductImages:box.config.showProductImages,
          showProgressBar:  box.config.showProgressBar,
          allowReselection: box.config.allowReselection,
          steps: mergeSteps(rawSteps, type),
        };
      } catch {}
    }
    return DEFAULT_COMBO_CONFIG;
  });
  const [comboActiveStep, setComboActiveStep] = useState(0);

  /* Single combo image preview (existing image or newly selected file) */
  const [comboImagePreview, setComboImagePreview] = useState(() => {
    const stepZeroImage = (stepImagesBase64 || []).find((img) => img.stepIndex === 0 && img.src);
    if (stepZeroImage?.src) return stepZeroImage.src;
    return (stepImagesBase64 || []).find((img) => img.src)?.src || null;
  });
  const [stepImagePreviews, setStepImagePreviews] = useState(() => {
    const arr = Array(MAX_COMBO_STEPS).fill(null);
    for (const img of stepImagesBase64 || []) {
      if (img.stepIndex >= 0 && img.stepIndex < MAX_COMBO_STEPS && img.src) arr[img.stepIndex] = img.src;
    }
    return arr;
  });

  /* Per-step scoped product lists: null = use all products (no collection selected) */
  const [stepProducts, setStepProducts] = useState(Array(MAX_COMBO_STEPS).fill(null));

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
  useEffect(() => {
    if (collProdsFetcher3.data?.collectionProducts)
      setStepProducts((p) => { const n = [...p]; n[3] = collProdsFetcher3.data.collectionProducts; return n; });
  }, [collProdsFetcher3.data]);
  useEffect(() => {
    if (collProdsFetcher4.data?.collectionProducts)
      setStepProducts((p) => { const n = [...p]; n[4] = collProdsFetcher4.data.collectionProducts; return n; });
  }, [collProdsFetcher4.data]);
  useEffect(() => {
    if (collProdsFetcher5.data?.collectionProducts)
      setStepProducts((p) => { const n = [...p]; n[5] = collProdsFetcher5.data.collectionProducts; return n; });
  }, [collProdsFetcher5.data]);
  useEffect(() => {
    if (collProdsFetcher6.data?.collectionProducts)
      setStepProducts((p) => { const n = [...p]; n[6] = collProdsFetcher6.data.collectionProducts; return n; });
  }, [collProdsFetcher6.data]);
  useEffect(() => {
    if (collProdsFetcher7.data?.collectionProducts)
      setStepProducts((p) => { const n = [...p]; n[7] = collProdsFetcher7.data.collectionProducts; return n; });
  }, [collProdsFetcher7.data]);

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
  function setStepCount(nextCount) {
    const clamped = Math.max(MIN_COMBO_STEPS, Math.min(MAX_COMBO_STEPS, nextCount));
    setComboConfig((prev) => {
      const steps = [...(Array.isArray(prev.steps) ? prev.steps : [])];
      while (steps.length < clamped) {
        steps.push(buildDefaultStep(steps.length));
      }
      return { ...prev, type: clamped, steps: steps.slice(0, clamped) };
    });
    setComboActiveStep((prev) => Math.min(prev, clamped - 1));
  }

  // comboDynamicPrice — estimated price for dynamic pricing mode (after discount)
  const comboDynamicDiscountBreakdown = useMemo(() => {
    const allProds = products || [];
    const avgPrice = allProds.length > 0 ? allProds.reduce((s, p) => s + (parseFloat(p.price) || 0), 0) / allProds.length : 0;
    const estimatedItemCount = Math.max(1, parseInt(String(comboConfig.type || 2), 10) || 2);
    const estimatedTotal = avgPrice * estimatedItemCount;
    if (estimatedTotal <= 0) return { discountedTotal: 0, discountAmount: 0, freeUnits: 0 };
    return getAdminComboDiscountBreakdown(estimatedTotal, comboConfig, estimatedItemCount);
  }, [
    products,
    comboConfig.type,
    comboConfig.discountType,
    comboConfig.discountValue,
    comboConfig.buyQuantity,
    comboConfig.getQuantity,
  ]);
  const comboDynamicPrice = comboDynamicDiscountBreakdown.discountedTotal;

  // comboManualDiscountedPrice — manual bundle price after discount
  const comboManualDiscountBreakdown = useMemo(() => {
    const price = parseFloat(comboConfig.bundlePrice) || 0;
    return getAdminComboDiscountBreakdown(price, comboConfig, comboConfig.type || 0);
  }, [
    comboConfig.bundlePrice,
    comboConfig.type,
    comboConfig.discountType,
    comboConfig.discountValue,
    comboConfig.buyQuantity,
    comboConfig.getQuantity,
  ]);
  const comboManualDiscountedPrice = comboManualDiscountBreakdown.discountedTotal;

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
  function updateStepScope(stepIdx, nextScope) {
    setComboConfig((prev) => ({
      ...prev,
      steps: prev.steps.map((st, i) => {
        if (i !== stepIdx || st.scope === nextScope) return st;
        return { ...st, scope: nextScope, collections: [], selectedProducts: [] };
      }),
    }));
  }

  /* ── Pending collection load — deferred so it runs after React finishes
        batching the state updates in confirmColl(), avoiding the
        "Transition was aborted because of invalid state" error.        ── */
  const [pendingCollLoad, setPendingCollLoad] = useState(null); // { stepIdx, collId }

  useEffect(() => {
    if (!pendingCollLoad) return;
    const { stepIdx, collId } = pendingCollLoad;
    setPendingCollLoad(null);
    // Plain path — fetcher.load() is not a page navigation so embedded
    // app params are not needed and can confuse Shopify App Bridge.
    collProdsFetchers[stepIdx].load(
      `/app/boxes/${box.id}/combo?collectionId=${encodeURIComponent(collId)}`
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCollLoad]);

  /* collection modal helpers */
  function confirmColl() {
    if (tempColls.length === 0) return;
    const stepIdx = collModalStepIdx;
    const firstCollId = tempColls[0].id;
    setComboConfig((prev) => {
      const steps = prev.steps.map((s, i) => {
        if (i !== stepIdx) return s;
        return { ...s, collections: tempColls, selectedProducts: [] };
      });
      return { ...prev, steps };
    });
    setStepProducts((p) => { const n = [...p]; n[stepIdx] = null; return n; });
    setShowCollModal(false);
    // Trigger the fetcher load AFTER state updates settle (via useEffect above)
    setPendingCollLoad({ stepIdx, collId: firstCollId });
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

  /* ─────────────── Render ─────────────── */
  return (
    <Page
      title="Edit Specific Combo Box"
      backAction={{ content: "Boxes", url: withEmbeddedAppParams("/app/boxes", location.search) }}
      primaryAction={{
        content: isSaving ? "Saving..." : "Save & Publish",
        loading: isSaving,
        onAction: () => document.getElementById("combo-config-form")?.requestSubmit(),
      }}
    >
      {/* Hidden form for saving (encType for file uploads) */}
      <comboFetcher.Form id="combo-config-form" method="POST" encType="multipart/form-data" action={`/app/boxes/${box.id}/combo${location.search}`}>
        <input type="hidden" name="_action" value="save_combo" />
        <input
          type="hidden"
          name="comboStepsConfig"
          value={JSON.stringify(sanitizeSpecificComboPricing({
            ...comboConfig,
            bundlePrice: comboConfig.bundlePriceType === "dynamic" ? comboDynamicPrice : parseFloat(comboConfig.bundlePrice) || 0,
          }))}
        />
        <input type="hidden" name="stepCount" value={comboConfig.type} />
      </comboFetcher.Form>

      <BlockStack gap="500">
        {/* Global error banner */}
        {comboErrors._global && (
          <Banner tone="critical" title="Error">
            <p>{comboErrors._global}</p>
          </Banner>
        )}

        {/* ── Box info + Active toggle ── */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">Specific Combo Box</Text>
                <Text as="p" variant="bodySm" tone="subdued">{box.boxName}</Text>
              </BlockStack>
              <Checkbox
                label="Active on Storefront"
                helpText="Uncheck to hide from customers"
                checked={comboConfig.isActive !== false}
                onChange={(v) => updateComboField("isActive", v)}
              />
            </InlineStack>
          </BlockStack>
        </Card>

        {/* ── Combo Configuration ── */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Combo Configuration</Text>
            <Divider />

            {/* Row 1: Title | Steps | Description | CTA Button */}
            <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
              <BlockStack gap="100">
                <Text as="label" variant="bodySm" fontWeight="semibold">Title *</Text>
                <input
                  value={comboConfig.listingTitle || ""}
                  onChange={(e) => updateComboField("listingTitle", e.target.value)}
                  placeholder="e.g. Premium Bundle"
                  style={inputStyle}
                />
              </BlockStack>

              <BlockStack gap="100">
                <Text as="label" variant="bodySm" fontWeight="semibold">Number of Steps</Text>
                <InlineStack gap="200" blockAlign="center">
                  <Button
                    onClick={() => setStepCount(comboConfig.type - 1)}
                    disabled={comboConfig.type <= MIN_COMBO_STEPS}
                    size="slim"
                  >
                    -
                  </Button>
                  <input
                    type="number"
                    min={MIN_COMBO_STEPS}
                    max={MAX_COMBO_STEPS}
                    value={comboConfig.type}
                    onChange={(e) => { const parsed = parseInt(e.target.value, 10); if (!Number.isNaN(parsed)) setStepCount(parsed); }}
                    style={{ width: "56px", textAlign: "center", fontSize: "16px", fontWeight: "700", border: "1.5px solid #d1d5db", borderRadius: "5px", height: "32px", padding: "0 6px", boxSizing: "border-box" }}
                  />
                  <Button
                    onClick={() => setStepCount(comboConfig.type + 1)}
                    disabled={comboConfig.type >= MAX_COMBO_STEPS}
                    size="slim"
                  >
                    +
                  </Button>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">{comboConfig.type} selections required (2–8)</Text>
              </BlockStack>

              <BlockStack gap="100">
                <Text as="label" variant="bodySm" fontWeight="semibold">Description</Text>
                <input
                  value={comboConfig.subtitle}
                  onChange={(e) => updateComboField("subtitle", e.target.value)}
                  placeholder="Choose a product for each step"
                  style={inputStyle}
                />
              </BlockStack>

              <BlockStack gap="100">
                <Text as="label" variant="bodySm" fontWeight="semibold">Combo Product Button Title</Text>
                <input
                  value={comboConfig.ctaButtonLabel ?? comboConfig.comboButtonTitle ?? ""}
                  onChange={(e) => updateComboField("ctaButtonLabel", e.target.value)}
                  placeholder="e.g. BUILD YOUR OWN BOX"
                  style={inputStyle}
                />
              </BlockStack>
            </InlineGrid>

            {/* Row 2: Image | Bundle Price */}
            <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
              {/* Image uploader */}
              <BlockStack gap="200">
                <Text as="label" variant="bodySm" fontWeight="semibold">Image</Text>
                <InlineStack gap="300" blockAlign="start">
                  <div style={{ width: "76px", height: "76px", border: "1.5px solid #e5e7eb", borderRadius: "6px", background: "#f3f4f6", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                    {comboImagePreview
                      ? <img src={comboImagePreview} alt="Combo preview" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                      : <Text as="p" variant="bodySm" tone="subdued">No image</Text>
                    }
                  </div>
                  <BlockStack gap="100">
                    <input
                      type="file"
                      name="comboImage"
                      form="combo-config-form"
                      accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                      style={{ fontSize: "13px" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (ev) => setComboImagePreview(ev.target.result);
                        reader.readAsDataURL(file);
                      }}
                    />
                    <Text as="p" variant="bodySm" tone="subdued">JPG, PNG, WEBP, GIF, or AVIF - max 2MB</Text>
                    {comboErrors.comboImage && (
                      <Text as="p" variant="bodySm" tone="critical">{comboErrors.comboImage}</Text>
                    )}
                  </BlockStack>
                </InlineStack>
              </BlockStack>

              {/* Bundle Price */}
              <BlockStack gap="200">
                <Text as="label" variant="bodySm" fontWeight="semibold">Bundle Price ({currencySymbol}) *</Text>
                <InlineStack gap="0">
                  {["manual", "dynamic"].map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => updateComboField("bundlePriceType", mode)}
                      style={{
                        flex: 1,
                        padding: "7px 0",
                        fontSize: "12px",
                        fontWeight: "600",
                        border: "1px solid #d1d5db",
                        cursor: "pointer",
                        background: comboConfig.bundlePriceType === mode ? "#000000" : "#f9fafb",
                        color: comboConfig.bundlePriceType === mode ? "#ffffff" : "#374151",
                        transition: "background 0.15s",
                        borderRadius: mode === "manual" ? "5px 0 0 5px" : "0 5px 5px 0",
                      }}
                    >
                      {mode === "manual" ? "Manual" : "Dynamic"}
                    </button>
                  ))}
                </InlineStack>
                {comboConfig.bundlePriceType === "manual" && (
                  <input
                    type="number"
                    placeholder="e.g. 1200"
                    min="0"
                    step="0.01"
                    value={comboConfig.bundlePrice || ""}
                    onChange={(e) => updateComboField("bundlePrice", e.target.value)}
                    style={inputStyle}
                  />
                )}
                {comboConfig.bundlePriceType === "dynamic" && (
                  <BlockStack gap="300">
                    <InlineGrid columns={2} gap="300">
                      <BlockStack gap="100">
                        <Text as="label" variant="bodySm" fontWeight="semibold">Discount Type</Text>
                        <select
                          value={normalizeSpecificDiscountType(comboConfig.discountType)}
                          onChange={(e) => updateComboField("discountType", normalizeSpecificDiscountType(e.target.value))}
                          style={inputStyle}
                        >
                          <option value="percent">% Off Total</option>
                          <option value="fixed">{currencySymbol} Fixed Discount</option>
                          <option value="none">None</option>
                        </select>
                      </BlockStack>
                      {comboConfig.discountType !== "none" && (
                        <BlockStack gap="100">
                          <Text as="label" variant="bodySm" fontWeight="semibold">
                            {comboConfig.discountType === "percent" ? "Discount %" : `Amount (${currencySymbol})`}
                          </Text>
                          <input
                            type="number"
                            min="0"
                            step={comboConfig.discountType === "fixed" ? "0.01" : "1"}
                            max={comboConfig.discountType === "percent" ? "100" : undefined}
                            value={comboConfig.discountValue}
                            onChange={(e) => updateComboField("discountValue", e.target.value)}
                            style={inputStyle}
                          />
                        </BlockStack>
                      )}
                    </InlineGrid>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {comboConfig.discountType === "percent" || comboConfig.discountType === "fixed"
                        ? "Discount applied on total amount"
                        : "Price calculated from selected step products"}
                    </Text>
                  </BlockStack>
                )}
              </BlockStack>
            </InlineGrid>
          </BlockStack>
        </Card>

        {/* ── Options ── */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Options</Text>
            <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
              <Checkbox
                label="Gift Box Mode"
                helpText="Shows gift wrapping option to customers"
                checked={!!comboConfig.isGiftBox}
                onChange={(v) => updateComboField("isGiftBox", v)}
              />
              <Checkbox
                label="Gift Message Field"
                helpText="Show text area for gift message"
                checked={!!comboConfig.giftMessageEnabled}
                onChange={(v) => updateComboField("giftMessageEnabled", v)}
                disabled={!comboConfig.isGiftBox}
              />
              <Checkbox
                label="Allow Duplicates"
                helpText="Same product can fill multiple slots"
                checked={!!comboConfig.allowDuplicates}
                onChange={(v) => updateComboField("allowDuplicates", v)}
              />
              <Checkbox
                label="Show Product Images"
                checked={!!comboConfig.showProductImages}
                onChange={(v) => updateComboField("showProductImages", v)}
              />
              <Checkbox
                label="Show Progress Bar"
                checked={!!comboConfig.showProgressBar}
                onChange={(v) => updateComboField("showProgressBar", v)}
              />
              <Checkbox
                label="Allow Reselection"
                checked={!!comboConfig.allowReselection}
                onChange={(v) => updateComboField("allowReselection", v)}
              />
            </InlineGrid>
            {/* Hidden inputs for boolean values */}
            <input type="hidden" name="isGiftBox" value={String(!!comboConfig.isGiftBox)} />
            <input type="hidden" name="giftMessageEnabled" value={String(!!comboConfig.giftMessageEnabled)} />
            <input type="hidden" name="allowDuplicates" value={String(!!comboConfig.allowDuplicates)} />
            <input type="hidden" name="showProductImages" value={String(!!comboConfig.showProductImages)} />
            <input type="hidden" name="showProgressBar" value={String(!!comboConfig.showProgressBar)} />
            <input type="hidden" name="allowReselection" value={String(!!comboConfig.allowReselection)} />
            <input type="hidden" name="isActive" value={String(comboConfig.isActive !== false)} />
          </BlockStack>
        </Card>

        {/* ── Steps ── */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">Steps ({comboConfig.type} total)</Text>
              <InlineStack gap="200">
                <Button
                  onClick={() => setStepCount(comboConfig.type - 1)}
                  disabled={comboConfig.type <= MIN_COMBO_STEPS}
                  size="slim"
                >
                  - Remove Step
                </Button>
                <Button
                  onClick={() => setStepCount(comboConfig.type + 1)}
                  disabled={comboConfig.type >= MAX_COMBO_STEPS}
                  size="slim"
                  variant="primary"
                >
                  + Add Step
                </Button>
              </InlineStack>
            </InlineStack>

            <Tabs
              tabs={Array.from({ length: comboConfig.type }, (_, i) => ({
                id: String(i),
                content: comboConfig.steps[i]?.label || `Step ${i + 1}`,
              }))}
              selected={comboActiveStep}
              onSelect={setComboActiveStep}
            >
              {(() => {
                const ai = comboActiveStep;
                const step = comboConfig.steps[ai] || buildDefaultStep(ai);
                const stepScope = step.scope === "product" || step.scope === "wholestore" ? "product" : "collection";
                return (
                  <BlockStack gap="400">
                    {/* Picker setup */}
                    <BlockStack gap="300">
                      <Text as="h3" variant="headingSm">Picker Setup</Text>
                      <Text as="p" variant="bodySm" tone="subdued">Each step has its own independent collection and product selector</Text>

                      <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                        {/* Step Label */}
                        <BlockStack gap="100">
                          <Text as="label" variant="bodySm" fontWeight="semibold">Step Label</Text>
                          <input
                            value={step.label}
                            onChange={(e) => updateComboStep(ai, "label", e.target.value)}
                            placeholder="e.g. Step 1"
                            style={inputStyle}
                          />
                          <Text as="p" variant="bodySm" tone="subdued">Heading shown on the storefront step</Text>
                        </BlockStack>

                        {/* Scope selector */}
                        <BlockStack gap="200">
                          <Text as="label" variant="bodySm" fontWeight="semibold">Scope</Text>
                          <InlineGrid columns={2} gap="200">
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
                                  padding: "0 10px",
                                  minHeight: "40px",
                                  border: `1.5px solid ${stepScope === opt.value ? "#000000" : "#d1d5db"}`,
                                  borderRadius: "6px",
                                  background: stepScope === opt.value ? "#f9fafb" : "#fff",
                                  cursor: "pointer",
                                }}
                              >
                                <input
                                  type="radio"
                                  name={`step-scope-${ai}`}
                                  value={opt.value}
                                  checked={stepScope === opt.value}
                                  onChange={() => updateStepScope(ai, opt.value)}
                                  style={{ width: "16px", height: "16px", cursor: "pointer", margin: 0, flexShrink: 0 }}
                                />
                                <span style={{ fontSize: "12px", color: "#4b5563", fontWeight: stepScope === opt.value ? "700" : "600" }}>
                                  {opt.label}
                                </span>
                              </label>
                            ))}
                          </InlineGrid>

                          <InlineStack gap="300" blockAlign="center">
                            {stepScope === "collection" ? (
                              <Button
                                onClick={() => {
                                  setCollModalStepIdx(ai);
                                  setTempColls([...step.collections]);
                                  setCollSearch("");
                                  setShowCollModal(true);
                                }}
                              >
                                Select collections
                              </Button>
                            ) : (
                              <Button
                                onClick={() => {
                                  setStepProdModalIdx(ai);
                                  setTempStepProds([...(step.selectedProducts || [])]);
                                  setStepProdSearch("");
                                  setShowStepProdModal(true);
                                }}
                              >
                                Select products
                              </Button>
                            )}
                            <Text as="p" variant="bodySm" tone="subdued">
                              {stepScope === "collection"
                                ? `${step.collections.length} selected`
                                : `${(step.selectedProducts || []).length} selected`}
                            </Text>
                          </InlineStack>

                          {/* Selected collections tags */}
                          {step.collections.length > 0 && stepScope === "collection" && (
                            <InlineStack gap="200" wrap>
                              {step.collections.map((c) => (
                                <Badge
                                  key={c.id}
                                  tone="info"
                                >
                                  <InlineStack gap="100" blockAlign="center">
                                    <span>{c.title}</span>
                                    <button
                                      type="button"
                                      onClick={() => updateComboStep(ai, "collections", step.collections.filter((x) => x.id !== c.id))}
                                      style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px", lineHeight: 1, fontSize: "12px" }}
                                      aria-label={`Remove ${c.title}`}
                                    >
                                      ×
                                    </button>
                                  </InlineStack>
                                </Badge>
                              ))}
                            </InlineStack>
                          )}

                          {/* Selected products tags */}
                          {(step.selectedProducts || []).length > 0 && stepScope === "product" && (
                            <InlineStack gap="200" wrap>
                              {step.selectedProducts.map((p) => (
                                <Badge key={p.id} tone="info">
                                  <InlineStack gap="100" blockAlign="center">
                                    <span>{p.title}</span>
                                    <button
                                      type="button"
                                      onClick={() => updateComboStep(ai, "selectedProducts", step.selectedProducts.filter((x) => x.id !== p.id))}
                                      style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px", lineHeight: 1, fontSize: "12px" }}
                                      aria-label={`Remove ${p.title}`}
                                    >
                                      ×
                                    </button>
                                  </InlineStack>
                                </Badge>
                              ))}
                            </InlineStack>
                          )}
                        </BlockStack>
                      </InlineGrid>
                    </BlockStack>

                    <Divider />

                    {/* General settings */}
                    <BlockStack gap="300">
                      <Text as="h3" variant="headingSm">Step Settings</Text>
                      <InlineGrid columns={{ xs: 1, md: 4 }} gap="400">
                        <BlockStack gap="100">
                          <Text as="label" variant="bodySm" fontWeight="semibold">Heading</Text>
                          <input
                            value={step.popup.title}
                            onChange={(e) => updateComboStepPopup(ai, "title", e.target.value)}
                            placeholder="e.g. Choose your product"
                            style={inputStyle}
                          />
                        </BlockStack>
                        <BlockStack gap="100">
                          <Text as="label" variant="bodySm" fontWeight="semibold">Description</Text>
                          <input
                            value={step.popup.desc}
                            onChange={(e) => updateComboStepPopup(ai, "desc", e.target.value)}
                            placeholder="Select a product for this step."
                            style={inputStyle}
                          />
                        </BlockStack>
                        <BlockStack gap="100">
                          <Text as="label" variant="bodySm" fontWeight="semibold">Product Button Title</Text>
                          <input
                            value={step.popup.btn}
                            onChange={(e) => updateComboStepPopup(ai, "btn", e.target.value)}
                            placeholder="e.g. Confirm selection"
                            style={inputStyle}
                          />
                        </BlockStack>
                        <BlockStack gap="100">
                          <Checkbox
                            label="Optional step"
                            helpText="If enabled, customers can skip this step."
                            checked={step.optional === true}
                            onChange={(v) => updateComboStep(ai, "optional", v)}
                          />
                        </BlockStack>
                      </InlineGrid>
                    </BlockStack>
                  </BlockStack>
                );
              })()}
            </Tabs>
          </BlockStack>
        </Card>
      </BlockStack>

      {/* Loading overlay */}
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

      {/* ════════════════════════════════════════
          MODAL: Combo — Collection Picker
      ════════════════════════════════════════ */}
      <Modal
        open={showCollModal}
        onClose={() => setShowCollModal(false)}
        title={`Select Collection — ${comboConfig.steps[collModalStepIdx]?.label || ""}`}
        primaryAction={{
          content: `Confirm (${tempColls.length})`,
          onAction: confirmColl,
          disabled: tempColls.length === 0,
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setShowCollModal(false) },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <TextField
              label=""
              placeholder="Search collections..."
              value={collSearch}
              onChange={setCollSearch}
              autoFocus
              autoComplete="off"
            />
            <BlockStack gap="0">
              {filteredColls.length === 0 ? (
                <Box padding="400">
                  <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                    No collections found{collSearch ? ` for "${collSearch}"` : ""}
                  </Text>
                </Box>
              ) : filteredColls.map((coll) => {
                const isSelected = tempColls.some((c) => c.id === coll.id);
                const alreadyAdded = comboConfig.steps.some((step, stepIdx) =>
                  stepIdx !== collModalStepIdx &&
                  Array.isArray(step.collections) &&
                  step.collections.some((selectedColl) => selectedColl.id === coll.id)
                );
                return (
                  <div
                    key={coll.id}
                    onClick={() => setTempColls(isSelected ? tempColls.filter((c) => c.id !== coll.id) : [...tempColls, coll])}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      padding: "10px 16px",
                      borderBottom: "1px solid #f3f4f6",
                      borderLeft: isSelected ? "3px solid #000000" : "3px solid transparent",
                      cursor: "pointer",
                      background: isSelected ? "#f9fafb" : "#fff",
                      userSelect: "none",
                    }}
                  >
                    {coll.imageUrl
                      ? <img src={coll.imageUrl} alt={coll.title} style={{ width: "38px", height: "38px", objectFit: "cover", borderRadius: "5px", border: "1px solid #e5e7eb", flexShrink: 0 }} />
                      : <div style={{ width: "38px", height: "38px", borderRadius: "5px", background: "#f3f4f6", border: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <Text as="span" variant="bodySm" tone="subdued">Img</Text>
                        </div>
                    }
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Text as="p" variant="bodySm" fontWeight="semibold">{coll.title}</Text>
                      <Text as="p" variant="bodySm" tone="subdued">{coll.handle}</Text>
                    </div>
                    {alreadyAdded && <Badge tone="success">Added</Badge>}
                    <div style={{
                      width: "18px", height: "18px", borderRadius: "50%",
                      border: `2px solid ${isSelected ? "#000000" : "#d1d5db"}`,
                      background: isSelected ? "#000000" : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0,
                    }}>
                      {isSelected && <span style={{ color: "#fff", fontSize: "10px", lineHeight: 1 }}>✓</span>}
                    </div>
                  </div>
                );
              })}
            </BlockStack>
            <Text as="p" variant="bodySm" tone="subdued">
              {tempColls.length > 0 ? `${tempColls.length} selected` : "No collection selected"}
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* ════════════════════════════════════════
          MODAL: Combo — Step Product Picker
      ════════════════════════════════════════ */}
      <Modal
        open={showStepProdModal}
        onClose={() => setShowStepProdModal(false)}
        title={
          stepProdModalIdx !== null && stepProducts[stepProdModalIdx]
            ? `Select Product — scoped to collection`
            : `Select Product — ${comboConfig.steps[stepProdModalIdx]?.label || ""}`
        }
        primaryAction={{
          content: `Confirm (${tempStepProds.length})`,
          onAction: confirmStepProd,
          disabled: tempStepProds.length === 0,
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setShowStepProdModal(false) },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <TextField
              label=""
              placeholder="Search products..."
              value={stepProdSearch}
              onChange={setStepProdSearch}
              autoFocus
              autoComplete="off"
            />
            <BlockStack gap="0">
              {isLoadingStepProds ? (
                <Box padding="400">
                  <Text as="p" variant="bodySm" tone="subdued" alignment="center">Loading products...</Text>
                </Box>
              ) : filteredStepProds.length === 0 ? (
                <Box padding="400">
                  <Text as="p" variant="bodySm" tone="subdued" alignment="center">No products found</Text>
                </Box>
              ) : filteredStepProds.map((product) => {
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
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      padding: "10px 16px",
                      borderBottom: "1px solid #f3f4f6",
                      borderLeft: isSel ? "3px solid #000000" : "3px solid transparent",
                      cursor: "pointer",
                      background: isSel ? "#f9fafb" : "#fff",
                      userSelect: "none",
                    }}
                  >
                    <div style={{
                      width: "18px", height: "18px", borderRadius: "4px",
                      border: `2px solid ${isSel ? "#000000" : "#d1d5db"}`,
                      background: isSel ? "#000000" : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0,
                    }}>
                      {isSel && <span style={{ color: "#fff", fontSize: "10px", lineHeight: 1 }}>✓</span>}
                    </div>
                    {product.imageUrl
                      ? <img src={product.imageUrl} alt={product.title} style={{ width: "40px", height: "40px", objectFit: "cover", borderRadius: "5px", flexShrink: 0, border: "1px solid #e5e7eb" }} />
                      : <div style={{ width: "40px", height: "40px", borderRadius: "5px", background: "#f3f4f6", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #e5e7eb" }}>
                          <Text as="span" variant="bodySm" tone="subdued">Img</Text>
                        </div>
                    }
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Text as="p" variant="bodySm" fontWeight="semibold">{product.title}</Text>
                      <Text as="p" variant="bodySm" tone="subdued">{product.handle}</Text>
                    </div>
                    {product.price && parseFloat(product.price) > 0 && (
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        {formatCurrencyAmount(parseFloat(product.price), currencyCode)}
                      </Text>
                    )}
                  </div>
                );
              })}
            </BlockStack>
            <Text as="p" variant="bodySm" tone="subdued">
              {tempStepProds.length > 0
                ? `${tempStepProds.length} product${tempStepProds.length !== 1 ? "s" : ""} selected`
                : "No product selected"}
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
