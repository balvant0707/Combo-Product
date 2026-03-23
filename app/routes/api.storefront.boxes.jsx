import { Buffer } from "node:buffer";
import { listBoxes, getComboStepImages } from "../models/boxes.server";
import { getSettings } from "../models/settings.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
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
    return {
      id: box.id,
      boxName: box.boxName,
      displayTitle: box.displayTitle,
      itemCount: box.itemCount,
      bundlePrice: parseFloat(box.bundlePrice),
      isGiftBox: box.isGiftBox,
      allowDuplicates: box.allowDuplicates,
      bannerImageUrl,
      hasUploadedBanner,
      giftMessageEnabled: box.giftMessageEnabled,
      shopifyProductId: box.shopifyProductId ? box.shopifyProductId.split('/').pop() : null,
      shopifyVariantId: box.shopifyVariantId ? box.shopifyVariantId.split('/').pop() : null,
      bundlePriceType: box.bundlePriceType || "manual",
      sortOrder: box.sortOrder,
      pageHandle: box.pageHandle || null,
      comboConfig: (() => {
        const boxStepImgs = stepImagesByBox[box.id] || [];
        function attachStepImages(stepsArr) {
          return stepsArr.map((step, idx) => {
            const imgRecord = boxStepImgs.find((img) => img.stepIndex === idx && img.imageData);
            return {
              ...step,
              stepImageUrl: imgRecord
                ? `data:${imgRecord.mimeType};base64,${Buffer.from(imgRecord.imageData).toString("base64")}`
                : null,
            };
          });
        }
        if (box.config) {
          let steps = [];
          try { steps = JSON.parse(box.config.stepsJson || '[]'); } catch {}
          steps = attachStepImages(steps);
          return {
            comboType: box.config.comboType || steps.length || 2,
            title: box.config.title || null,
            subtitle: box.config.subtitle || null,
            bundlePriceType: box.config.bundlePriceType || 'manual',
            bundlePrice: box.config.bundlePrice != null ? parseFloat(box.config.bundlePrice) : 0,
            showProgressBar: box.config.showProgressBar !== false,
            showProductImages: box.config.showProductImages !== false,
            allowReselection: box.config.allowReselection !== false,
            steps,
          };
        }
        // Fallback: parse raw comboStepsConfig JSON when ComboBoxConfig relation is missing
        if (box.comboStepsConfig) {
          try {
            const parsed = JSON.parse(box.comboStepsConfig);
            const steps = attachStepImages(Array.isArray(parsed.steps) ? parsed.steps : []);
            if (steps.length === 0) return null;
            return {
              comboType: parseInt(parsed.type) || steps.length,
              title: parsed.title || null,
              subtitle: parsed.subtitle || null,
              bundlePriceType: parsed.bundlePriceType || 'manual',
              bundlePrice: parsed.bundlePrice != null ? parseFloat(parsed.bundlePrice) : 0,
              showProgressBar: parsed.showProgressBar !== false,
              showProductImages: parsed.showProductImages !== false,
              allowReselection: parsed.allowReselection !== false,
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
