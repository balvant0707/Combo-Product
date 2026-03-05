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

  const orders = await db.bundleOrder.findMany({
    where: { shop, customerId },
    select: {
      orderId: true,
      boxId: true,
      selectedProducts: true,
      bundlePrice: true,
      giftMessage: true,
      orderDate: true,
      createdAt: true,
    },
    orderBy: { orderDate: "desc" },
  });

  // Keep a structured audit trail in logs so support can fulfill requests quickly.
  console.info(
    "[privacy.customers_data_request] customer data snapshot",
    JSON.stringify({
      shop,
      customerId,
      recordsFound: orders.length,
      orders,
    }),
  );

  return new Response();
};
