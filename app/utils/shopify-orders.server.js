function normalizeNumericOrderId(orderId) {
  const raw = String(orderId || "").trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits || null;
}

function toOrderGid(orderId) {
  const numeric = normalizeNumericOrderId(orderId);
  return numeric ? `gid://shopify/Order/${numeric}` : null;
}

function extractNumericIdFromGid(gid) {
  const raw = String(gid || "").trim();
  const match = raw.match(/gid:\/\/shopify\/Order\/(\d+)/i);
  return match?.[1] || null;
}

const ORDER_LABELS_QUERY = `#graphql
  query OrderLabels($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Order {
        id
        name
      }
    }
  }
`;

export async function fetchOrderLabelsByOrderIds(admin, orderIds = []) {
  const uniqueNumericIds = [...new Set(
    (orderIds || [])
      .map((value) => normalizeNumericOrderId(value))
      .filter(Boolean),
  )];

  if (uniqueNumericIds.length === 0) return new Map();

  const result = new Map();
  const chunkSize = 50;

  for (let i = 0; i < uniqueNumericIds.length; i += chunkSize) {
    const chunk = uniqueNumericIds.slice(i, i + chunkSize);
    const ids = chunk
      .map((orderId) => toOrderGid(orderId))
      .filter(Boolean);
    if (ids.length === 0) continue;

    try {
      const response = await admin.graphql(ORDER_LABELS_QUERY, { variables: { ids } });
      const json = await response.json();
      const nodes = Array.isArray(json?.data?.nodes) ? json.data.nodes : [];

      for (const node of nodes) {
        const numericId = extractNumericIdFromGid(node?.id);
        if (!numericId) continue;

        const parsedOrderNumber = Number.parseInt(
          String(node?.name || "").replace(/\D/g, ""),
          10,
        );
        result.set(numericId, {
          orderName: typeof node?.name === "string" && node.name.trim() ? node.name.trim() : null,
          orderNumber: Number.isFinite(parsedOrderNumber) && parsedOrderNumber > 0 ? parsedOrderNumber : null,
        });
      }
    } catch (error) {
      console.error("[shopify-orders] Failed to fetch order labels from Admin API", error);
    }
  }

  return result;
}
