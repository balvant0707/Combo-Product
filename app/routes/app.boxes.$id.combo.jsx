import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useFetcher, useLoaderData, useLocation, useNavigate, useNavigation, useRouteError } from "react-router";
import {
  Banner, BlockStack, Box, Button, Card, Checkbox,
  Divider, DropZone, FormLayout, InlineGrid, InlineStack, Modal, Page,
  Select, Spinner, Tabs, Text, TextField
} from "@shopify/polaris";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { Buffer } from "node:buffer";
import { getBox, upsertComboConfig, saveComboStepImages, getComboStepImages, deleteComboStepImage, syncShopifyBundleProduct, syncSpecificComboProductMedia } from "../models/boxes.server";
import { getShopCurrencyCode } from "../models/shop.server";
import { withEmbeddedAppParams, withEmbeddedAppToastFromRequest } from "../utils/embedded-app";
import { formatCurrencyAmount, getCurrencySymbol } from "../utils/currency";
import { ToggleSwitch } from "../components/toggle-switch";


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
  steps: Array.from({ length: MIN_COMBO_STEPS }, (_, index) => buildDefaultStep(index)),
};

function normalizeSpecificDiscountType(discountType) {
  return discountType === "buy_x_get_y" ? "none" : (discountType || "none");
}

function sanitizeSpecificComboPricing(config) {
  const safeConfig = config && typeof config === "object" ? config : {};
  const listingTitle = typeof safeConfig.listingTitle === "string" ? safeConfig.listingTitle.trim() : "";
  const title = typeof safeConfig.title === "string" && safeConfig.title.trim()
    ? safeConfig.title.trim()
    : listingTitle;
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
    title,
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
      isActive:          box.isActive !== false,
      isGiftBox:         box.isGiftBox === true,
      giftMessageEnabled: box.isGiftBox === true && box.giftMessageEnabled === true,
      allowDuplicates:   box.allowDuplicates === true,
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
    const removeComboImage = formData.get("removeComboImage") === "true" && !comboImage;
    if (Object.keys(errors).length > 0) {
      return { ok: false, errors };
    }

    try {
      await upsertComboConfig(params.id, comboStepsConfig, admin);
    } catch (e) {
      console.error("[app.boxes.$id.combo] upsertComboConfig error:", e);
      return { ok: false, errors: { _global: "Failed to save combo configuration. Please try again." } };
    }

    // Remove image if requested
    if (removeComboImage) {
      try { await deleteComboStepImage(params.id, 0); } catch (e) {
        console.error("[app.boxes.$id.combo] deleteComboStepImage error:", e);
      }
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
  borderRadius: "6px", fontSize: "12px", boxSizing: "border-box",
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
  const navigate = useNavigate();
  const currencySymbol = getCurrencySymbol(currencyCode);

  const comboErrors = comboFetcher.data?.errors || {};
  const comboStepImgErrors = {};
  const isPageLoading = comboFetcher.state !== "idle" || navigation.state !== "idle";
  const isSaving = comboFetcher.state === "submitting";
  const [isBackNavigating, setIsBackNavigating] = useState(false);

  // Toast state
  const [toast, setToast] = useState(null); // { type: "success"|"error", message: string }
  function showValidationToast(message, isError = true) {
    if (!message) return;
    try {
      if (typeof window !== "undefined" && window.shopify?.toast?.show) {
        window.shopify.toast.show(message, { isError });
        return;
      }
    } catch {}
    setToast({ type: isError ? "error" : "success", message });
    setTimeout(() => setToast(null), isError ? 4500 : 3500);
  }

  const firstFetcherErrorMessage = (errs) => {
    if (!errs || typeof errs !== "object") return "";
    if (typeof errs._global === "string") return errs._global;
    for (const value of Object.values(errs)) {
      if (typeof value === "string" && value.trim()) return value;
      if (value && typeof value === "object") {
        const nested = Object.values(value).find((v) => typeof v === "string" && v.trim());
        if (nested) return nested;
      }
    }
    return "";
  };

  useEffect(() => {
    if (comboFetcher.data?.comboSaved) {
      showValidationToast("Combo configuration saved successfully.", false);
      return;
    }
    if (comboFetcher.data?.errors) {
      const msg = firstFetcherErrorMessage(comboFetcher.data.errors);
      if (msg) showValidationToast(msg, true);
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
          // Always use ComboBox model fields as source of truth — JSON blob may be stale
          isActive:          box.isActive !== false,
          isGiftBox:         box.isGiftBox === true,
          giftMessageEnabled: box.isGiftBox === true && box.giftMessageEnabled === true,
          allowDuplicates:   box.allowDuplicates === true,
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
          // Always use ComboBox model fields as source of truth
          isActive:          box.isActive !== false,
          isGiftBox:         box.isGiftBox === true,
          giftMessageEnabled: box.isGiftBox === true && box.giftMessageEnabled === true,
          allowDuplicates:   box.allowDuplicates === true,
          steps: mergeSteps(rawSteps, type),
        };
      } catch {}
    }
    return { ...DEFAULT_COMBO_CONFIG, isActive: box.isActive !== false };
  });
  const [comboActiveStep, setComboActiveStep] = useState(0);

  const comboImageRef = useRef(null);
  const [comboImageHover, setComboImageHover] = useState(false);

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

  /* Single combo image preview (existing image or newly selected file) */
  const [removeComboImage, setRemoveComboImage] = useState(false);
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
  function updateComboField(field, value) {
    setComboConfig((prev) => {
      if (field === "isGiftBox") {
        const nextIsGiftBox = !!value;
        return { ...prev, isGiftBox: nextIsGiftBox, giftMessageEnabled: nextIsGiftBox };
      }
      if (field === "giftMessageEnabled") {
        return { ...prev, giftMessageEnabled: !!prev.isGiftBox };
      }
      return { ...prev, [field]: value };
    });
  }
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

  const [stepErrors, setStepErrors] = useState({});

  function validateStepBeforeSave(step, stepIndex) {
    if (!step) return `Step ${stepIndex + 1}: configuration is missing`;
    if (!String(step.label || "").trim()) return `Step ${stepIndex + 1}: Step Name is required`;
    const scope = step.scope === "product" ? "product" : "collection";
    if (scope === "collection" && (!Array.isArray(step.collections) || step.collections.length === 0)) {
      return `Step ${stepIndex + 1}: select at least one collection`;
    }
    if (scope === "product" && (!Array.isArray(step.selectedProducts) || step.selectedProducts.length === 0)) {
      return `Step ${stepIndex + 1}: select at least one product`;
    }
    if (!String(step.popup?.title || "").trim() || !String(step.popup?.desc || "").trim() || !String(step.popup?.btn || "").trim()) {
      return `Step ${stepIndex + 1}: fill Step Heading, Step Description and Step Selection Button Text`;
    }
    return "";
  }

  function validateAndSave() {
    const steps = comboConfig.steps || [];
    const allStepErrors = {};
    for (let i = 0; i < steps.length; i++) {
      const msg = validateStepBeforeSave(steps[i], i);
      if (msg) allStepErrors[i] = msg;
    }
    if (!String(comboConfig.listingTitle || "").trim()) allStepErrors._title = "Bundle title is required";

    if (Object.keys(allStepErrors).length > 0) {
      setStepErrors(allStepErrors);
      const firstNumericErr = Object.keys(allStepErrors).find((k) => !isNaN(Number(k)));
      if (firstNumericErr !== undefined) setComboActiveStep(Number(firstNumericErr));
      const firstMsg = allStepErrors._title || allStepErrors[firstNumericErr] || Object.values(allStepErrors)[0];
      showValidationToast(firstMsg, true);
    } else {
      setStepErrors({});
      document.getElementById("combo-config-form")?.requestSubmit();
    }
  }

  function handleBackAction() {
    setIsBackNavigating(true);
    navigate(withEmbeddedAppParams("/app/boxes", location.search));
  }

  /* ─────────────── Render ─────────────── */
  return (
    <Page
      title={`Edit: Specific Bundle Configuration`}
      backAction={{ content: "Boxes", onAction: handleBackAction }}
      primaryAction={{
        content: isSaving ? "Saving..." : "Save & Publish",
        loading: isSaving,
        onAction: validateAndSave,
      }}
    >
      {toast?.message && (
        <div
          role="alert"
          style={{
            position: "fixed",
            right: "18px",
            bottom: "18px",
            zIndex: 10020,
            background: toast.type === "error" ? "#111827" : "#065f46",
            color: "#ffffff",
            padding: "10px 14px",
            borderRadius: "8px",
            fontSize: "13px",
            fontWeight: "600",
            boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
            maxWidth: "520px",
          }}
        >
          {toast.message}
        </div>
      )}
      {/* Hidden form for saving (encType for file uploads) */}
      <comboFetcher.Form id="combo-config-form" method="POST" encType="multipart/form-data" action={`/app/boxes/${box.id}/combo${location.search}`}>
        <input type="hidden" name="_action" value="save_combo" />
        <input type="hidden" name="removeComboImage" value={String(removeComboImage)} />
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

        {/* ── Status ── */}
        <Card>
          <InlineGrid columns={{ xs: "1fr", sm: "1fr auto" }} gap="400">
            <BlockStack gap="050">
              <Text as="h2" variant="headingMd">{box.displayTitle || box.boxName || "Specific Combo"}</Text>
              <Text as="p" variant="bodySm" tone="subdued">Create and configure your Specific Bundle experience</Text>
            </BlockStack>
            <InlineStack gap="200" blockAlign="start">
              <ToggleSwitch checked={comboConfig.isActive !== false} onChange={() => updateComboField("isActive", !(comboConfig.isActive !== false))} showStateText={false} />
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" fontWeight="semibold">Publish on Storefront</Text>
                <Text as="p" variant="bodySm" tone="subdued">Uncheck to hide this box from customers</Text>
              </BlockStack>
            </InlineStack>
          </InlineGrid>
        </Card>

        {/* ── Combo Configuration ── */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">General Bundle Configuration</Text>
            <Divider />

            {/* Row 1: Title | Steps | Description | CTA Button */}
            <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
              <BlockStack gap="100">
                <Text as="label" variant="bodySm" fontWeight="semibold">Bundle Title *</Text>
                <input
                  value={comboConfig.listingTitle || ""}
                  onChange={(e) => { updateComboField("listingTitle", e.target.value); if (stepErrors._title) setStepErrors((p) => ({ ...p, _title: "" })); }}
                  placeholder="e.g. Premium Bundle"
                  style={{ ...inputStyle, borderColor: stepErrors._title ? "#e11d48" : "#e5e7eb" }}
                />
                {stepErrors._title && <Text as="p" variant="bodySm" tone="critical">{stepErrors._title}</Text>}
              </BlockStack>

              <BlockStack gap="100">
                <Text as="label" variant="bodySm" fontWeight="semibold">Bundle Description</Text>
                <input
                  value={comboConfig.subtitle}
                  onChange={(e) => updateComboField("subtitle", e.target.value)}
                  placeholder="Choose a product for each step"
                  style={inputStyle}
                />
              </BlockStack>

              <BlockStack gap="100">
                <Text as="label" variant="bodySm" fontWeight="semibold">Bundle Button Text</Text>
                <input
                  value={comboConfig.ctaButtonLabel ?? comboConfig.comboButtonTitle ?? ""}
                  onChange={(e) => updateComboField("ctaButtonLabel", e.target.value)}
                  placeholder="e.g. Build your own box"
                  style={inputStyle}
                />
              </BlockStack>
            </InlineGrid>

            {/* Row 2: Image | Bundle Price */}
            <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
              
              <BlockStack gap="100">
                <Text as="label" variant="bodySm" fontWeight="semibold">Bundle Steps</Text>
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

              {/* Image uploader */}
              <BlockStack gap="100">
                <Text as="label" variant="bodySm" fontWeight="semibold">Bundle Image</Text>
                <input type="file" ref={comboImageRef} name="comboImage" form="combo-config-form" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" style={{ display: "none" }} />
                {comboImagePreview ? (
                  <div
                    style={{ position: "relative", display: "inline-block", width: "120px" }}
                    onMouseEnter={() => setComboImageHover(true)}
                    onMouseLeave={() => setComboImageHover(false)}
                  >
                    <img src={comboImagePreview} alt="Combo preview" style={{ width: "120px", borderRadius: "6px", border: "1px solid #e5e7eb", display: "block" }} />
                    {comboImageHover && (
                      <button
                        type="button"
                        onClick={() => { setComboImagePreview(null); setRemoveComboImage(true); if (comboImageRef.current) comboImageRef.current.value = ""; }}
                        style={{ position: "absolute", top: "4px", right: "4px", background: "rgba(0,0,0,0.65)", border: "none", borderRadius: "50%", width: "22px", height: "22px", cursor: "pointer", color: "#fff", fontSize: "14px", lineHeight: "22px", textAlign: "center", padding: 0 }}
                        aria-label="Remove image"
                      >×</button>
                    )}
                  </div>
                ) : (
                  <DropZone accept="image/jpeg,image/png,image/webp,image/gif,image/avif" type="image" allowMultiple={false} onDrop={handleComboImageDrop}>
                    <DropZone.FileUpload />
                  </DropZone>
                )}
                <Text as="p" variant="bodySm" tone="subdued">JPG, PNG, WEBP, GIF, or AVIF - max 2MB</Text>
                {comboErrors.comboImage && (
                  <Text as="p" variant="bodySm" tone="critical">{comboErrors.comboImage}</Text>
                )}
              </BlockStack>

              {/* Bundle Price */}
              <BlockStack gap="200">
                <Text as="label" variant="bodySm" fontWeight="semibold">Bundle Price Type *</Text>
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
                      {mode === "manual" ? "Fixed Price" : "Dynamic Price"}
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
                        <Text as="label" variant="bodySm" fontWeight="semibold">Bundle Discount Type</Text>
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
            <Text as="h2" variant="headingMd">Additional Bundle Options</Text>
            <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
              <InlineStack gap="200" blockAlign="start">
                <ToggleSwitch checked={!!comboConfig.isGiftBox} onChange={() => updateComboField("isGiftBox", !comboConfig.isGiftBox)} showStateText={false} />
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" fontWeight="semibold">Enable Gift Packaging Option</Text>
                  <Text as="p" variant="bodySm" tone="subdued">Shows gift wrapping option to customers</Text>
                </BlockStack>
              </InlineStack>
              <InlineStack gap="200" blockAlign="start">
                <ToggleSwitch checked={!!comboConfig.isGiftBox && !!comboConfig.giftMessageEnabled} onChange={() => updateComboField("giftMessageEnabled", !comboConfig.giftMessageEnabled)} disabled={!comboConfig.isGiftBox} showStateText={false} />
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" fontWeight="semibold">Enable Gift Note Field</Text>
                  <Text as="p" variant="bodySm" tone="subdued">Show text area for gift message</Text>
                </BlockStack>
              </InlineStack>
              <InlineStack gap="200" blockAlign="start">
                <ToggleSwitch checked={!!comboConfig.allowDuplicates} onChange={() => updateComboField("allowDuplicates", !comboConfig.allowDuplicates)} showStateText={false} />
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" fontWeight="semibold">Allow Repeating Products</Text>
                  <Text as="p" variant="bodySm" tone="subdued">Same product can fill multiple slots</Text>
                </BlockStack>
              </InlineStack>
            </InlineGrid>
            {/* Hidden inputs for boolean values */}
            <input type="hidden" name="isGiftBox" value={String(!!comboConfig.isGiftBox)} />
            <input type="hidden" name="giftMessageEnabled" value={String(!!comboConfig.isGiftBox && !!comboConfig.giftMessageEnabled)} />
            <input type="hidden" name="allowDuplicates" value={String(!!comboConfig.allowDuplicates)} />
            <input type="hidden" name="isActive" value={String(comboConfig.isActive !== false)} />
          </BlockStack>
        </Card>

        {/* ── Steps ── */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">Bundle Steps Configuration ({comboConfig.type} total)</Text>
              <Button
                onClick={() => setStepCount(comboConfig.type + 1)}
                disabled={comboConfig.type >= MAX_COMBO_STEPS}
                size="slim"
                variant="primary"
              >
                Add New Step
              </Button>
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
                    {/* Step-level error */}
                    {stepErrors[ai] && (
                      <Banner tone="critical">
                        <p>{stepErrors[ai]}</p>
                      </Banner>
                    )}
                    {/* Picker setup */}
                    <BlockStack gap="300">
                      <Text as="h3" variant="headingSm">Step Product Picker Setup</Text>
                      <Text as="p" variant="bodySm" tone="subdued">Each step has its own independent collection and product selector</Text>

                      <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                        {/* Step Label */}
                        <BlockStack gap="100">
                          <Text as="label" variant="bodySm" fontWeight="semibold">Step Name</Text>
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
                          <Text as="label" variant="bodySm" fontWeight="semibold">Step Scope</Text>
                          <Select
                            label="Step Scope"
                            labelHidden
                            options={[
                              { value: "collection", label: "Select Collections" },
                              { value: "product", label: "Select Products" },
                            ]}
                            value={stepScope}
                            onChange={(value) => updateStepScope(ai, value)}
                          />

                          <InlineStack gap="300" blockAlign="center">
                            {stepScope === "collection" ? (
                              <Button
                                variant="primary"
                                onClick={() => {
                                  setCollModalStepIdx(ai);
                                  setTempColls([...step.collections]);
                                  setCollSearch("");
                                  setShowCollModal(true);
                                }}
                              >
                                Choose Step Collections
                              </Button>
                            ) : (
                              <Button
                                variant="primary"
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
                                <div
                                  key={c.id}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "6px",
                                    padding: "4px 10px",
                                    background: "#e5e7eb",
                                    border: "1px solid #d1d5db",
                                    borderRadius: "5px",
                                  }}
                                >
                                  <Text as="span" variant="bodySm" fontWeight="semibold" style={{ color: "#374151" }}>{c.title}</Text>
                                  <button
                                    type="button"
                                    onClick={() => updateComboStep(ai, "collections", step.collections.filter((x) => x.id !== c.id))}
                                    style={{ background: "none", border: "none", cursor: "pointer", color: "#6b7280", padding: "0 2px", lineHeight: 1, fontSize: "12px" }}
                                    aria-label={`Remove ${c.title}`}
                                  >
                                    �
                                  </button>
                                </div>
                              ))}
                            </InlineStack>
                          )}

                          {/* Selected products tags */}
                          {(step.selectedProducts || []).length > 0 && stepScope === "product" && (
                            <InlineStack gap="200" wrap>
                              {step.selectedProducts.map((p) => (
                                <div
                                  key={p.id}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "6px",
                                    padding: "4px 10px",
                                    background: "#e5e7eb",
                                    border: "1px solid #d1d5db",
                                    borderRadius: "5px",
                                  }}
                                >
                                  <Text as="span" variant="bodySm" fontWeight="semibold" style={{ color: "#374151" }}>{p.title}</Text>
                                  <button
                                    type="button"
                                    onClick={() => updateComboStep(ai, "selectedProducts", step.selectedProducts.filter((x) => x.id !== p.id))}
                                    style={{ background: "none", border: "none", cursor: "pointer", color: "#6b7280", padding: "0 2px", lineHeight: 1, fontSize: "12px" }}
                                    aria-label={`Remove ${p.title}`}
                                  >
                                    �
                                  </button>
                                </div>
                              ))}
                            </InlineStack>
                          )}                        </BlockStack>
                      </InlineGrid>
                    </BlockStack>

                    <Divider />

                    {/* General settings */}
                    <BlockStack gap="300">
                      <Text as="h3" variant="headingSm">Step Content Settings</Text>
                      <InlineGrid columns={{ xs: 1, md: 4 }} gap="400">
                        <BlockStack gap="100">
                          <Text as="label" variant="bodySm" fontWeight="semibold">Step Heading</Text>
                          <input
                            value={step.popup.title}
                            onChange={(e) => updateComboStepPopup(ai, "title", e.target.value)}
                            placeholder="e.g. Choose your product"
                            style={inputStyle}
                          />
                        </BlockStack>
                        <BlockStack gap="100">
                          <Text as="label" variant="bodySm" fontWeight="semibold">Step Description</Text>
                          <input
                            value={step.popup.desc}
                            onChange={(e) => updateComboStepPopup(ai, "desc", e.target.value)}
                            placeholder="Select a product for this step."
                            style={inputStyle}
                          />
                        </BlockStack>
                        <BlockStack gap="100">
                          <Text as="label" variant="bodySm" fontWeight="semibold">Step Selection Button Text</Text>
                          <input
                            value={step.popup.btn}
                            onChange={(e) => updateComboStepPopup(ai, "btn", e.target.value)}
                            placeholder="e.g. Confirm selection"
                            style={inputStyle}
                          />
                        </BlockStack>
                        <BlockStack gap="100">
                          <BlockStack gap="100">
                            <InlineStack gap="150" blockAlign="center">
                              <ToggleSwitch checked={step.optional === true} onChange={() => updateComboStep(ai, "optional", !(step.optional === true))} showStateText={false} />
                              <Text as="p" variant="bodySm" fontWeight="semibold">Make This Step Optional</Text>
                            </InlineStack>
                            <Text as="p" variant="bodySm" tone="subdued">If enabled, customers can skip this step.</Text>
                          </BlockStack>
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
      {(isPageLoading || isBackNavigating) && (
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
        title={`Choose Step Collections — ${comboConfig.steps[collModalStepIdx]?.label || ""}`}
        primaryAction={{
          content: `Done${tempColls.length > 0 ? ` (${tempColls.length} selected)` : ""}`,
          onAction: confirmColl,
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setShowCollModal(false) },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <TextField
              label="Search collections"
              labelHidden
              placeholder="Search collections..."
              value={collSearch}
              onChange={setCollSearch}
              autoFocus
              autoComplete="off"
              clearButton
              onClearButtonClick={() => setCollSearch("")}
            />
            {filteredColls.length === 0 ? (
              <Text tone="subdued" alignment="center" variant="bodySm">
                No collections found
              </Text>
            ) : (
              <BlockStack gap="0">
                {filteredColls.map((coll) => {
                  const isSelected = tempColls.some((c) => c.id === coll.id);
                  return (
                    <div
                      key={coll.id}
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => setTempColls(isSelected ? tempColls.filter((c) => c.id !== coll.id) : [...tempColls, coll])}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        padding: "10px 0",
                        borderBottom: "1px solid #f3f4f6",
                        background: isSelected ? "#f0fdf4" : "#fff",
                        cursor: "pointer",
                      }}
                    >
                      <div onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          label={coll.title}
                          labelHidden
                          checked={isSelected}
                          onChange={() => setTempColls(isSelected ? tempColls.filter((c) => c.id !== coll.id) : [...tempColls, coll])}
                        />
                      </div>
                      {coll.imageUrl ? (
                        <img src={coll.imageUrl} alt={coll.title} style={{ width: "40px", height: "40px", objectFit: "cover", borderRadius: "5px", border: "1px solid #e5e7eb", flexShrink: 0 }} />
                      ) : (
                        <div style={{ width: "40px", height: "40px", borderRadius: "5px", background: "#f3f4f6", border: "1px solid #e5e7eb", flexShrink: 0 }} />
                      )}
                      <Text variant="bodyMd" fontWeight={isSelected ? "semibold" : "regular"} as="span">
                        {coll.title}
                      </Text>
                    </div>
                  );
                })}
              </BlockStack>
            )}
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
            ? `Select Products — scoped to collection`
            : `Select Products — ${comboConfig.steps[stepProdModalIdx]?.label || ""}`
        }
        primaryAction={{
          content: `Done${tempStepProds.length > 0 ? ` (${tempStepProds.length} selected)` : ""}`,
          onAction: confirmStepProd,
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setShowStepProdModal(false) },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <TextField
              label="Search products"
              labelHidden
              placeholder="Search products..."
              value={stepProdSearch}
              onChange={setStepProdSearch}
              autoFocus
              autoComplete="off"
              clearButton
              onClearButtonClick={() => setStepProdSearch("")}
            />
            {isLoadingStepProds ? (
              <div style={{ padding: "24px 0", textAlign: "center" }}>
                <Spinner accessibilityLabel="Loading products" size="small" />
              </div>
            ) : filteredStepProds.length === 0 ? (
              <Text as="p" variant="bodySm" tone="subdued" alignment="center">No products found</Text>
            ) : (
              <BlockStack gap="0">
                {filteredStepProds.map((product) => {
                  const isSel = tempStepProds.some((p) => p.id === product.id);
                  return (
                    <div
                      key={product.id}
                      role="option"
                      aria-selected={isSel}
                      onClick={() => setTempStepProds(
                        isSel
                          ? tempStepProds.filter((p) => p.id !== product.id)
                          : [...tempStepProds, { id: product.id, title: product.title, handle: product.handle, imageUrl: product.imageUrl, price: product.price }]
                      )}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        padding: "10px 0",
                        borderBottom: "1px solid #f3f4f6",
                        background: isSel ? "#f0fdf4" : "#fff",
                        cursor: "pointer",
                      }}
                    >
                      <div onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          label={product.title}
                          labelHidden
                          checked={isSel}
                          onChange={() => setTempStepProds(
                            isSel
                              ? tempStepProds.filter((p) => p.id !== product.id)
                              : [...tempStepProds, { id: product.id, title: product.title, handle: product.handle, imageUrl: product.imageUrl, price: product.price }]
                          )}
                        />
                      </div>
                      {product.imageUrl
                        ? <img src={product.imageUrl} alt={product.title} style={{ width: "40px", height: "40px", objectFit: "cover", borderRadius: "5px", flexShrink: 0, border: "1px solid #e5e7eb" }} />
                        : <div style={{ width: "40px", height: "40px", borderRadius: "5px", background: "#f3f4f6", flexShrink: 0, border: "1px solid #e5e7eb" }} />
                      }
                      <Text variant="bodyMd" fontWeight={isSel ? "semibold" : "regular"} as="span">
                        {product.title}
                      </Text>
                    </div>
                  );
                })}
              </BlockStack>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
