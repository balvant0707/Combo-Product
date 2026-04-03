import db from "../db.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function normalizeShopifyProductId(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (raw.includes("/")) return raw.split("/").pop();
  return raw;
}

export const loader = async ({ request, params }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return Response.json({ error: "shop parameter required" }, { status: 400, headers: CORS_HEADERS });
  }

  const boxId = parseInt(params.boxId);
  if (isNaN(boxId)) {
    return Response.json({ error: "Invalid box ID" }, { status: 400, headers: CORS_HEADERS });
  }

  // Verify box belongs to shop and is active
  const box = await db.comboBox.findFirst({
    where: { id: boxId, shop, isActive: true, deletedAt: null },
  });

  if (!box) {
    return Response.json({ error: "Box not found" }, { status: 404, headers: CORS_HEADERS });
  }

  const products = await db.comboBoxProduct.findMany({
    where: { boxId },
    orderBy: { id: "asc" },
  });

  const internalBundleProductRows = await db.comboBox.findMany({
    where: {
      shop,
      deletedAt: null,
      shopifyProductId: { not: null },
    },
    select: { shopifyProductId: true },
  });

  const internalBundleProductIds = new Set(
    internalBundleProductRows
      .map((row) => normalizeShopifyProductId(row.shopifyProductId))
      .filter(Boolean)
  );

  const publicProducts = products
    .filter((p) => {
      const pid = normalizeShopifyProductId(p.productId);
      return !pid || !internalBundleProductIds.has(pid);
    })
    .map((p) => {
      let variantIds = [];
      if (p.variantIds) {
        try { variantIds = JSON.parse(p.variantIds); } catch {}
      }
      // Strip GID prefix so Shopify /cart/add.js gets numeric IDs
      variantIds = variantIds.map((id) => (typeof id === "string" && id.includes("/") ? id.split("/").pop() : String(id)));
      return {
        id: p.id,
        productId: p.productId,
        productTitle: p.productTitle,
        productImageUrl: p.productImageUrl,
        productHandle: p.productHandle,
        productPrice: p.productPrice != null ? parseFloat(p.productPrice) : null,
        isCollection: p.isCollection,
        variantIds,
      };
    });

  return Response.json(publicProducts, { headers: CORS_HEADERS });
};
