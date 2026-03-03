import { authenticate } from "../shopify.server";
import { trackBundleOrder } from "../models/orders.server";

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  if (topic !== "ORDERS_PAID") {
    return new Response("Unhandled topic", { status: 400 });
  }

  try {
    for (const item of payload.line_items || []) {
      const properties = item.properties || [];

      const comboBoxId = properties.find((p) => p.name === "_combo_box_id")?.value;
      if (!comboBoxId) continue;

      // Skip the hidden bundle price line item
      const isBundlePriceItem = properties.find((p) => p.name === "_bundle_price_item");
      if (isBundlePriceItem) continue;

      const selectedProducts = properties
        .filter((p) => p.name.startsWith("_item_"))
        .sort((a, b) => {
          const numA = parseInt(a.name.replace("_item_", "")) || 0;
          const numB = parseInt(b.name.replace("_item_", "")) || 0;
          return numA - numB;
        })
        .map((p) => p.value);

      const giftMessage = properties.find((p) => p.name === "Gift Message")?.value || null;

      await trackBundleOrder(shop, {
        orderId: String(payload.id),
        boxId: parseInt(comboBoxId),
        selectedProducts,
        bundlePrice: parseFloat(item.price),
        giftMessage,
        orderDate: new Date(payload.created_at),
        customerId: payload.customer?.id ? String(payload.customer.id) : null,
      });
    }
  } catch (err) {
    console.error("[webhooks.orders.paid] Error tracking bundle order:", err);
  }

  return new Response(null, { status: 200 });
};
