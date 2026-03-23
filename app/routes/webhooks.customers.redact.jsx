import db from "../db.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { payload, topic, shop } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const customerId = payload?.customer?.id
    ? String(payload.customer.id)
    : null;

  const orderIdsToRedact = Array.isArray(payload?.orders_to_redact)
    ? payload.orders_to_redact.map((o) => String(o.id))
    : [];

  if (!customerId && orderIdsToRedact.length === 0) {
    return new Response();
  }

  const orClauses = [];
  if (customerId) orClauses.push({ shop, customerId });
  if (orderIdsToRedact.length > 0) orClauses.push({ shop, orderId: { in: orderIdsToRedact } });

  const result = await db.bundleOrder.deleteMany({
    where: { OR: orClauses },
  });

  console.info("[privacy.customers_redact] deleted records", {
    shop,
    customerId,
    orderIdsRequested: orderIdsToRedact,
    deletedCount: result.count,
  });

  return new Response();
};
