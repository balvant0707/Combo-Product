import { authenticate } from "../shopify.server";
import { unauthenticated } from "../shopify.server";
import db from "../db.server";
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
  const quantity = Math.max(1, Number.parseInt(String(item?.quantity ?? 1), 10) || 1);
  const unitPrice =
    toMoney(item?.price) ??
    toMoney(item?.price_set?.shop_money?.amount) ??
    toMoney(item?.price_set?.presentment_money?.amount) ??
    0;
  const totalDiscount = toMoney(item?.total_discount) ?? 0;

  return Math.max(0, unitPrice * quantity - totalDiscount);
}

function toNumericId(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  const digits = raw.replace(/\D/g, "");
  return digits || null;
}

function toOrderGid(payload) {
  const gid = String(payload?.admin_graphql_api_id || "").trim();
  if (gid.startsWith("gid://shopify/Order/")) return gid;
  const numeric = toNumericId(payload?.id);
  return numeric ? `gid://shopify/Order/${numeric}` : null;
}

async function addMixBundleOrderTag(shop, payload) {
  const orderGid = toOrderGid(payload);
  if (!orderGid) return;

  try {
    const { admin } = await unauthenticated.admin(shop);
    const resp = await admin.graphql(
      `#graphql
        mutation AddOrderTag($id: ID!, $tags: [String!]!) {
          tagsAdd(id: $id, tags: $tags) {
            userErrors { message }
          }
        }
      `,
      {
        variables: { id: orderGid, tags: ["Mix Bundle"] },
      },
    );
    const json = await resp.json();
    const userErrors = json?.data?.tagsAdd?.userErrors || [];
    if (userErrors.length > 0) {
      console.warn("[webhooks.orders.paid] tagsAdd userErrors", userErrors);
    }
  } catch (error) {
    console.error("[webhooks.orders.paid] failed to add Mix Bundle tag", error);
  }
}

async function resolveComboBoxId(shop, item, properties) {
  const comboBoxId = properties.find((p) => p.name === "_combo_box_id")?.value;
  const parsedBoxId = Number.parseInt(String(comboBoxId), 10);
  if (Number.isFinite(parsedBoxId) && parsedBoxId > 0) {
    return parsedBoxId;
  }

  const variantNumeric = toNumericId(item?.variant_id ?? item?.variantId ?? item?.id);
  const productNumeric = toNumericId(item?.product_id ?? item?.productId);

  const variantCandidates = variantNumeric
    ? [
        variantNumeric,
        `gid://shopify/ProductVariant/${variantNumeric}`,
      ]
    : [];
  const productCandidates = productNumeric
    ? [
        productNumeric,
        `gid://shopify/Product/${productNumeric}`,
      ]
    : [];

  const orClauses = [];
  if (variantCandidates.length > 0) {
    orClauses.push({ shopifyVariantId: { in: variantCandidates } });
  }
  if (productCandidates.length > 0) {
    orClauses.push({ shopifyProductId: { in: productCandidates } });
  }
  if (orClauses.length === 0) return null;

  const box = await db.comboBox.findFirst({
    where: { shop, OR: orClauses },
    select: { id: true },
  });

  return box?.id || null;
}

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  if (topic !== "ORDERS_PAID") {
    return new Response("Unhandled topic", { status: 400 });
  }

  try {
    let hasBundleOrder = false;

    for (const item of payload.line_items || []) {
      const properties = normalizeProperties(item?.properties);

      const resolvedBoxId = await resolveComboBoxId(shop, item, properties);
      if (!resolvedBoxId) continue;
      hasBundleOrder = true;

      const selectedProducts = extractSelectedProducts(properties);

      const bundlePrice = computeLineRevenue(item, properties);

      await trackBundleOrder(shop, {
        orderId: String(payload.id),
        orderName: typeof payload.name === "string" ? payload.name : null,
        orderNumber: Number.parseInt(String(payload.order_number), 10) || null,
        boxId: resolvedBoxId,
        selectedProducts,
        bundlePrice,
        giftMessage: null,
        orderDate: new Date(payload.created_at),
        customerId: payload.customer?.id ? String(payload.customer.id) : null,
      });
    }

    if (hasBundleOrder) {
      await addMixBundleOrderTag(shop, payload);
    }
  } catch (err) {
    console.error("[webhooks.orders.paid] Error tracking bundle order:", err);
  }

  return new Response(null, { status: 200 });
};
