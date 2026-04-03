import { authenticate } from "../shopify.server";
import { trackBundleOrder } from "../models/orders.server";

function normalizeProperties(rawProperties) {
  if (Array.isArray(rawProperties)) {
    return rawProperties
      .map((entry) => ({
        name: typeof entry?.name === "string" ? entry.name : "",
        value: entry?.value,
      }))
      .filter((entry) => entry.name);
  }

  if (rawProperties && typeof rawProperties === "object") {
    return Object.entries(rawProperties).map(([name, value]) => ({ name, value }));
  }

  return [];
}

function getProperty(properties, key) {
  const found = properties.find((entry) => entry.name === key);
  return found?.value;
}

function extractSelectedProducts(properties) {
  const indexed = properties
    .filter((entry) => /^_item_\d+$/i.test(entry.name) || /^Item\s+\d+$/i.test(entry.name))
    .map((entry) => {
      const match = entry.name.match(/^_item_(\d+)$/i) || entry.name.match(/^Item\s+(\d+)$/i);
      return {
        index: Number.parseInt(match?.[1] ?? "0", 10) || 0,
        value: entry.value,
      };
    })
    .filter((entry) => entry.value != null && String(entry.value).trim() !== "")
    .sort((a, b) => a.index - b.index)
    .map((entry) => String(entry.value).trim());

  return indexed;
}

function toMoney(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function computeLineRevenue(item, properties) {
  const propertyBundlePrice = toMoney(getProperty(properties, "_combo_bundle_price"));
  if (propertyBundlePrice != null) {
    return Math.max(0, propertyBundlePrice);
  }

  const quantity = Math.max(1, Number.parseInt(String(item?.quantity ?? 1), 10) || 1);
  const unitPrice =
    toMoney(item?.price) ??
    toMoney(item?.price_set?.shop_money?.amount) ??
    toMoney(item?.price_set?.presentment_money?.amount) ??
    0;
  const totalDiscount = toMoney(item?.total_discount) ?? 0;

  return Math.max(0, unitPrice * quantity - totalDiscount);
}

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  if (topic !== "ORDERS_PAID") {
    return new Response("Unhandled topic", { status: 400 });
  }

  try {
    for (const item of payload.line_items || []) {
      const properties = normalizeProperties(item?.properties);

      const comboBoxId = properties.find((p) => p.name === "_combo_box_id")?.value;
      if (!comboBoxId) continue;

      const parsedBoxId = Number.parseInt(String(comboBoxId), 10);
      if (!Number.isFinite(parsedBoxId) || parsedBoxId <= 0) continue;

      const selectedProducts = extractSelectedProducts(properties);

      const giftMessage = getProperty(properties, "Gift Message") || null;
      const bundlePrice = computeLineRevenue(item, properties);

      await trackBundleOrder(shop, {
        orderId: String(payload.id),
        boxId: parsedBoxId,
        selectedProducts,
        bundlePrice,
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
