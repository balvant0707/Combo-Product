import { listBoxes, getBannerImageSrc } from "../models/boxes.server";
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
    listBoxes(shop, true, true),
    getSettings(shop),
  ]);

  const publicBoxes = boxes.map((box) => ({
    id: box.id,
    boxName: box.boxName,
    displayTitle: box.displayTitle,
    itemCount: box.itemCount,
    bundlePrice: parseFloat(box.bundlePrice),
    isGiftBox: box.isGiftBox,
    allowDuplicates: box.allowDuplicates,
    bannerImageUrl: getBannerImageSrc(box),
    giftMessageEnabled: box.giftMessageEnabled,
    shopifyVariantId: box.shopifyVariantId,
    sortOrder: box.sortOrder,
  }));

  const publicSettings = {
    widgetHeadingText: settings.widgetHeadingText || null,
    ctaButtonLabel: settings.ctaButtonLabel || null,
    addToCartLabel: settings.addToCartLabel || null,
    buttonColor: settings.buttonColor || "#2A7A4F",
    activeSlotColor: settings.activeSlotColor || "#2A7A4F",
    showSavingsBadge: settings.showSavingsBadge,
    showProductPrices: settings.showProductPrices,
    presetTheme: settings.presetTheme || "custom",
    widgetMaxWidth: settings.widgetMaxWidth ?? 1140,
  };

  return Response.json({ boxes: publicBoxes, settings: publicSettings }, { headers: CORS_HEADERS });
};
