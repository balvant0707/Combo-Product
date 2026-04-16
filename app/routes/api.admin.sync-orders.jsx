import { authenticate } from "../shopify.server";
import { trackBundleOrder } from "../models/orders.server";

const SYNC_ORDERS_QUERY = `#graphql
  query SyncComboOrders($cursor: String, $filter: String) {
    orders(first: 50, after: $cursor, query: $filter, sortKey: CREATED_AT, reverse: true) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        name
        createdAt
        lineItems(first: 50) {
          nodes {
            name
            quantity
            originalUnitPriceSet {
              shopMoney {
                amount
              }
            }
            discountedTotalSet {
              shopMoney {
                amount
              }
            }
            customAttributes {
              key
              value
            }
          }
        }
      }
    }
  }
`;

function extractIdFromGid(gid) {
  if (!gid) return null;
  const parts = String(gid).split("/");
  return parts[parts.length - 1] || null;
}

function getAttr(attrs, key) {
  const found = (attrs || []).find((a) => a.key === key);
  return found?.value ?? null;
}

function extractSelectedProducts(attrs) {
  return (attrs || [])
    .filter((a) => /^Item\s+\d+$/i.test(a.key) || /^_item_\d+$/i.test(a.key))
    .map((a) => {
      const match = a.key.match(/(\d+)$/);
      return { index: match ? parseInt(match[1], 10) : 0, value: a.value };
    })
    .filter((e) => e.value != null && String(e.value).trim() !== "")
    .sort((a, b) => a.index - b.index)
    .map((e) => String(e.value).trim());
}

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  let days = 90;
  try {
    const body = await request.json();
    if (body?.days && Number.isFinite(parseInt(body.days, 10))) {
      days = Math.min(365, Math.max(1, parseInt(body.days, 10)));
    }
  } catch {
    // no body or invalid JSON — use default
  }

  const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const fromStr = fromDate.toISOString().split("T")[0];
  const filter = `financial_status:paid created_at:>=${fromStr}`;

  let synced = 0;
  let skipped = 0;
  let cursor = null;
  let hasNextPage = true;
  let pages = 0;
  const MAX_PAGES = 20; // up to 1000 orders per sync

  while (hasNextPage && pages < MAX_PAGES) {
    pages++;

    const resp = await admin.graphql(SYNC_ORDERS_QUERY, {
      variables: { cursor, filter },
    });
    const json = await resp.json();
    const ordersData = json?.data?.orders;

    if (!ordersData) break;

    for (const order of ordersData.nodes || []) {
      const orderId = extractIdFromGid(order.id);
      const orderDate = new Date(order.createdAt);

      for (const item of order.lineItems?.nodes || []) {
        const attrs = item.customAttributes || [];

        // Only track line items that belong to a combo box
        const comboBoxId = getAttr(attrs, "_combo_box_id");
        if (!comboBoxId) {
          skipped++;
          continue;
        }

        // Prefer the stored bundle price property; fall back to Shopify's discounted total
        const bundlePriceProp = getAttr(attrs, "_combo_bundle_price");
        const bundlePrice =
          bundlePriceProp != null
            ? parseFloat(bundlePriceProp)
            : parseFloat(item.discountedTotalSet?.shopMoney?.amount ?? 0);

        const selectedProducts = extractSelectedProducts(attrs);
        const fallbackLineItemTitle = String(item?.name || "").trim();
        const safeSelectedProducts =
          selectedProducts.length > 0
            ? selectedProducts
            : (fallbackLineItemTitle ? [fallbackLineItemTitle] : []);
        const giftMessage = getAttr(attrs, "Gift Message");

        const result = await trackBundleOrder(shop, {
          orderId,
          orderName: typeof order.name === "string" ? order.name : null,
          orderNumber: Number.parseInt(String(order.name || "").replace(/\D/g, ""), 10) || null,
          boxId: comboBoxId,
          selectedProducts: safeSelectedProducts,
          bundlePrice: Number.isFinite(bundlePrice) ? bundlePrice : 0,
          giftMessage,
          orderDate,
          customerId: null,
        });

        // trackBundleOrder returns null for duplicates or invalid boxes
        if (result) synced++;
        else skipped++;
      }
    }

    hasNextPage = ordersData.pageInfo?.hasNextPage ?? false;
    cursor = ordersData.pageInfo?.endCursor ?? null;
  }

  return Response.json({ synced, skipped, pages, days });
};
