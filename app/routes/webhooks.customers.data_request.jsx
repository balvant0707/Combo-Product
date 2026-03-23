import db from "../db.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { payload, topic, shop } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const customerId = payload?.customer?.id
    ? String(payload.customer.id)
    : null;

  // Shopify also sends specific order IDs that must be included in the report
  const orderIdsToRedact = Array.isArray(payload?.orders_to_redact)
    ? payload.orders_to_redact.map((o) => String(o.id))
    : [];

  if (!customerId && orderIdsToRedact.length === 0) {
    return new Response(null, { status: 200 });
  }

  // Build OR conditions: match by customerId OR by specific Shopify order IDs
  const orClauses = [];
  if (customerId) orClauses.push({ shop, customerId });
  if (orderIdsToRedact.length > 0) orClauses.push({ shop, orderId: { in: orderIdsToRedact } });

  const orders = await db.bundleOrder.findMany({
    where: { OR: orClauses },
    select: {
      orderId:          true,
      boxId:            true,
      selectedProducts: true,
      bundlePrice:      true,
      giftMessage:      true,
      orderDate:        true,
      createdAt:        true,
    },
    orderBy: { orderDate: "desc" },
  });

  // Structured audit log — support team uses this to fulfill data access requests
  console.info(
    "[gdpr.customers_data_request] customer data snapshot",
    JSON.stringify({ shop, customerId, orderIdsRequested: orderIdsToRedact, recordsFound: orders.length, orders }),
  );

  return new Response(null, { status: 200 });
};
