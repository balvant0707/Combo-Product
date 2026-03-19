import { listBoxes } from "../models/boxes.server";
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
    listBoxes(shop, true, false),  // bannerImageMimeType still returned to detect uploads
    getSettings(shop),
  ]);

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
        if (!box.config) return null;
        let steps = [];
        try { steps = JSON.parse(box.config.stepsJson || '[]'); } catch {}
        return {
          comboType: box.config.comboType || 2,
          title: box.config.title || null,
          subtitle: box.config.subtitle || null,
          bundlePriceType: box.config.bundlePriceType || 'manual',
          bundlePrice: box.config.bundlePrice != null ? parseFloat(box.config.bundlePrice) : 0,
          showProgressBar: box.config.showProgressBar !== false,
          showProductImages: box.config.showProductImages !== false,
          allowReselection: box.config.allowReselection !== false,
          steps,
        };
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
