import db from "../db.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

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

  const publicProducts = products.map((p) => ({
    id: p.id,
    productId: p.productId,
    productTitle: p.productTitle,
    productImageUrl: p.productImageUrl,
    productHandle: p.productHandle,
    productPrice: p.productPrice != null ? parseFloat(p.productPrice) : null,
    isCollection: p.isCollection,
    variantIds: p.variantIds,
  }));

  return Response.json(publicProducts, { headers: CORS_HEADERS });
};
