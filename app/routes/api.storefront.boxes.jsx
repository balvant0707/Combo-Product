import { listBoxes } from "../models/boxes.server";

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

  const boxes = await listBoxes(shop, true);

  const publicBoxes = boxes.map((box) => ({
    id: box.id,
    boxName: box.boxName,
    displayTitle: box.displayTitle,
    itemCount: box.itemCount,
    bundlePrice: parseFloat(box.bundlePrice),
    isGiftBox: box.isGiftBox,
    allowDuplicates: box.allowDuplicates,
    bannerImageUrl: box.bannerImageUrl,
    giftMessageEnabled: box.giftMessageEnabled,
    shopifyVariantId: box.shopifyVariantId,
    sortOrder: box.sortOrder,
  }));

  return Response.json(publicBoxes, { headers: CORS_HEADERS });
};
