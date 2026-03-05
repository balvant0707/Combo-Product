import db from "../db.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { payload, topic, shop } = await authenticate.webhook(request);

  const customerId = payload?.customer?.id
    ? String(payload.customer.id)
    : null;

  console.log(`Received ${topic} webhook for ${shop}`);

  if (!customerId) {
    return new Response();
  }

  const result = await db.bundleOrder.deleteMany({
    where: { shop, customerId },
  });

  console.info("[privacy.customers_redact] deleted records", {
    shop,
    customerId,
    deletedCount: result.count,
  });

  return new Response();
};
