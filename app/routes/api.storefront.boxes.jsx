import { Buffer } from "node:buffer";
import { listBoxes, getComboStepImages } from "../models/boxes.server";
import { getSettings } from "../models/settings.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return Response.json({ error: "shop parameter required" }, { status: 400, headers: CORS_HEADERS });
  }

  const [boxes, settings] = await Promise.all([
    listBoxes(shop, true, false),
    getSettings(shop),
  ]);

  // Fetch step images for all boxes that have a specific combo config
  const stepImagesByBox = {};
  await Promise.all(
    boxes
      .filter((b) => b.config)
      .map(async (b) => {
        const imgs = await getComboStepImages(b.id);
        if (imgs.length > 0) stepImagesByBox[b.id] = imgs;
      })
  );

  const publicBoxes = boxes.map((box) => {
    const bannerImageUrl = box.bannerImageUrl || null;
    // Flag so the widget can build the URL via the app proxy (avoids cross-origin issues)
    const hasUploadedBanner = !bannerImageUrl && !!box.bannerImageMimeType;
    let rawComboConfig = null;
    if (box.comboStepsConfig) {
      try { rawComboConfig = JSON.parse(box.comboStepsConfig); } catch {}
    }
    const ctaButtonLabelFromBox = typeof box.comboProductButtonTitle === "string" && box.comboProductButtonTitle.trim()
      ? box.comboProductButtonTitle.trim()
      : null;
    const addToCartLabelFromBox = typeof box.productButtonTitle === "string" && box.productButtonTitle.trim()
      ? box.productButtonTitle.trim()
      : null;
    const ctaButtonLabelFromConfig = typeof rawComboConfig?.ctaButtonLabel === "string" && rawComboConfig.ctaButtonLabel.trim()
      ? rawComboConfig.ctaButtonLabel.trim()
      : null;
    const addToCartLabelFromConfig = typeof rawComboConfig?.addToCartLabel === "string" && rawComboConfig.addToCartLabel.trim()
      ? rawComboConfig.addToCartLabel.trim()
      : null;
    const giftMessageEnabledFromConfig =
      rawComboConfig?.giftMessageEnabled !== undefined
        ? (rawComboConfig.giftMessageEnabled === true || String(rawComboConfig.giftMessageEnabled).toLowerCase() === "true")
        : null;
    const ctaButtonLabel = ctaButtonLabelFromBox || ctaButtonLabelFromConfig || null;
    const addToCartLabel = addToCartLabelFromBox || addToCartLabelFromConfig || null;
    return {
      id: box.id,
      boxCode: box.boxCode || null,
      boxName: box.boxName,
      displayTitle: box.displayTitle,
      boxSubtitle: typeof rawComboConfig?.boxSubtitle === "string" ? rawComboConfig.boxSubtitle : null,
      ctaButtonLabel,
      addToCartLabel,
      productButtonTitle: addToCartLabel,
      itemCount: box.itemCount,
      bundlePrice: parseFloat(box.bundlePrice),
      isGiftBox: box.isGiftBox,
      allowDuplicates: box.allowDuplicates,
      bannerImageUrl,
      hasUploadedBanner,
      giftMessageEnabled: giftMessageEnabledFromConfig !== null
        ? giftMessageEnabledFromConfig
        : box.giftMessageEnabled,
      shopifyProductId: box.shopifyProductId ? box.shopifyProductId.split('/').pop() : null,
      shopifyVariantId: box.shopifyVariantId ? box.shopifyVariantId.split('/').pop() : null,
      bundlePriceType: box.bundlePriceType || "manual",
      sortOrder: box.sortOrder,
      pageHandle: box.pageHandle || null,
      scopeType: box.scopeType || "specific_collections",
      comboConfig: (() => {
        const boxStepImgs = stepImagesByBox[box.id] || [];
        const primaryImageRecord = boxStepImgs.find((img) => img.imageData);
        const primaryStepImageUrl = primaryImageRecord
          ? `data:${primaryImageRecord.mimeType};base64,${Buffer.from(primaryImageRecord.imageData).toString("base64")}`
          : null;
        function attachStepImages(stepsArr) {
          return stepsArr.map((step) => {
            return {
              ...step,
              stepImageUrl: primaryStepImageUrl,
            };
          });
        }
        if (box.config) {
          let steps = [];
          try { steps = JSON.parse(box.config.stepsJson || '[]'); } catch {}
          steps = attachStepImages(steps);
          // discountType/discountValue live only in the raw JSON blob (ComboBoxConfig lacks these columns)
          let discountType = 'none', discountValue = '0', buyQuantity = 1, getQuantity = 1;
          if (rawComboConfig) {
            discountType = rawComboConfig.discountType || 'none';
            discountValue = String(rawComboConfig.discountValue || '0');
            buyQuantity = Math.max(1, parseInt(String(rawComboConfig.buyQuantity ?? 1), 10) || 1);
            getQuantity = Math.max(1, parseInt(String(rawComboConfig.getQuantity ?? 1), 10) || 1);
          }
          return {
            comboType: box.config.comboType || steps.length || 2,
            title: box.config.title || null,
            subtitle: box.config.subtitle || null,
            highlightText: typeof rawComboConfig?.highlightText === "string" ? rawComboConfig.highlightText : "",
            supportText: typeof rawComboConfig?.supportText === "string" ? rawComboConfig.supportText : "",
            bundlePriceType: box.config.bundlePriceType || 'manual',
            bundlePrice: box.config.bundlePrice != null ? parseFloat(box.config.bundlePrice) : 0,
            discountType,
            discountValue,
            buyQuantity,
            getQuantity,
            ctaButtonLabel,
            addToCartLabel,
            productButtonTitle: addToCartLabel,
            steps,
          };
        }
        // Fallback: parse raw comboStepsConfig JSON when ComboBoxConfig relation is missing
        if (box.comboStepsConfig) {
          try {
            const parsed = JSON.parse(box.comboStepsConfig);
            const steps = attachStepImages(Array.isArray(parsed.steps) ? parsed.steps : []);
            return {
              comboType: parseInt(parsed.type) || 0,
              title: parsed.title || null,
              subtitle: parsed.subtitle || null,
              highlightText: typeof parsed.highlightText === "string" ? parsed.highlightText : "",
              supportText: typeof parsed.supportText === "string" ? parsed.supportText : "",
              bundlePriceType: parsed.bundlePriceType || box.bundlePriceType || 'manual',
              bundlePrice: parsed.bundlePrice != null ? parseFloat(parsed.bundlePrice) : 0,
              discountType: parsed.discountType || 'none',
              discountValue: String(parsed.discountValue || '0'),
              buyQuantity: Math.max(1, parseInt(String(parsed.buyQuantity ?? 1), 10) || 1),
              getQuantity: Math.max(1, parseInt(String(parsed.getQuantity ?? 1), 10) || 1),
              ctaButtonLabel: typeof parsed.ctaButtonLabel === "string" && parsed.ctaButtonLabel.trim()
                ? parsed.ctaButtonLabel.trim()
                : ctaButtonLabel,
              addToCartLabel: typeof parsed.addToCartLabel === "string" && parsed.addToCartLabel.trim()
                ? parsed.addToCartLabel.trim()
                : addToCartLabel,
              productButtonTitle: typeof parsed.productButtonTitle === "string" && parsed.productButtonTitle.trim()
                ? parsed.productButtonTitle.trim()
                : (typeof parsed.addToCartLabel === "string" && parsed.addToCartLabel.trim()
                  ? parsed.addToCartLabel.trim()
                  : addToCartLabel),
              steps,
            };
          } catch { return null; }
        }
        return null;
      })(),
    };
  });

  const publicSettings = {
    widgetHeadingText: settings.widgetHeadingText || null,
    ctaButtonLabel: settings.ctaButtonLabel || null,
    addToCartLabel: settings.addToCartLabel || null,
    buttonColor: settings.buttonColor || "#2A7A4F",
    activeSlotColor: settings.activeSlotColor || "#2A7A4F",
    showSavingsBadge: settings.showSavingsBadge,
    showProductPrices: settings.showProductPrices,
    forceShowOos: settings.forceShowOos,
    presetTheme: settings.presetTheme || "custom",
    widgetMaxWidth: settings.widgetMaxWidth ?? 1140,
    productCardsPerRow: settings.productCardsPerRow ?? 4,
  };

  return Response.json({ boxes: publicBoxes, settings: publicSettings }, { headers: CORS_HEADERS });
};
