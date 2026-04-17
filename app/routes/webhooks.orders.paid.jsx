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

function normalizeOrderAttributes(rawAttributes) {
  if (Array.isArray(rawAttributes)) {
    return rawAttributes
      .map((entry) => ({
        name: typeof entry?.name === "string"
          ? entry.name
          : (typeof entry?.key === "string" ? entry.key : ""),
        value: entry?.value,
      }))
      .filter((entry) => entry.name);
  }

  if (rawAttributes && typeof rawAttributes === "object") {
    return Object.entries(rawAttributes).map(([name, value]) => ({ name, value }));
  }

  return [];
}

function getProperty(properties, key) {
  const found = properties.find((entry) => entry.name === key);
  return found?.value;
}

function getPropertyAny(properties, keys) {
  for (const key of keys || []) {
    const value = getProperty(properties, key);
    if (value != null && String(value).trim() !== "") {
      return value;
    }
  }
  return null;
}

function getOrderAttribute(orderAttributes, key) {
  const found = (orderAttributes || []).find((entry) => entry.name === key);
  return found?.value;
}

function getOrderAttributeAny(orderAttributes, keys) {
  for (const key of keys || []) {
    const value = getOrderAttribute(orderAttributes, key);
    if (value != null && String(value).trim() !== "") {
      return value;
    }
  }
  return null;
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
  const bundlePriceProp =
    toMoney(getProperty(properties, "_combo_bundle_price")) ??
    toMoney(getProperty(properties, "_combo_selected_total"));
  if (bundlePriceProp != null && bundlePriceProp > 0) {
    return bundlePriceProp;
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

function extractGiftDetailValue(rawValue, comboProductId) {
  const value = String(rawValue || "").trim();
  if (!value) return "";
  if (!comboProductId) return value;
  const suffix = `| Combo Product ID: ${comboProductId}`;
  if (value.endsWith(suffix)) {
    return value.slice(0, -suffix.length).trim();
  }
  return value;
}

function buildAdditionalSettingSection(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return "";
  const lines = ["Additional Setting:"];

  entries.forEach((entry, index) => {
    const prefix = entries.length > 1 ? `${index + 1}. ` : "";
    lines.push(`${prefix}Gift Repar (Combo Product ID: ${entry.comboProductId}): ${entry.giftReferrer || "N/A"}`);
    lines.push(`${prefix}Gift Message (Combo Product ID: ${entry.comboProductId}): ${entry.giftMessage || "N/A"}`);
  });

  lines.push("End Additional Setting");
  return lines.join("\n");
}

function mergeAdditionalSettingSection(existingNote, section) {
  const note = String(existingNote || "").trim();
  if (!section) return note;

  const blockRegex = /(?:^|\n)Additional Setting:\n[\s\S]*?\nEnd Additional Setting(?:\n|$)/g;
  const cleaned = note.replace(blockRegex, "\n").trim();

  return cleaned ? `${cleaned}\n\n${section}` : section;
}

async function updateOrderNoteWithAdditionalSetting(shop, payload, entries) {
  if (!Array.isArray(entries) || entries.length === 0) return;
  const orderGid = toOrderGid(payload);
  if (!orderGid) return;

  const section = buildAdditionalSettingSection(entries);
  const nextNote = mergeAdditionalSettingSection(payload?.note, section);
  if (!nextNote) return;

  try {
    const { admin } = await unauthenticated.admin(shop);
    const resp = await admin.graphql(
      `#graphql
        mutation UpdateOrderNote($input: OrderInput!) {
          orderUpdate(input: $input) {
            order { id note }
            userErrors { field message }
          }
        }
      `,
      {
        variables: {
          input: {
            id: orderGid,
            note: nextNote,
          },
        },
      },
    );
    const json = await resp.json();
    const userErrors = json?.data?.orderUpdate?.userErrors || [];
    if (userErrors.length > 0) {
      console.warn("[webhooks.orders.paid] orderUpdate note userErrors", userErrors);
    }
  } catch (error) {
    console.error("[webhooks.orders.paid] failed to update order note with Additional Setting", error);
  }
}

async function resolveComboBoxDetails(shop, item, properties) {
  const comboBoxId = properties.find((p) => p.name === "_combo_box_id")?.value;
  const parsedBoxId = Number.parseInt(String(comboBoxId), 10);
  if (Number.isFinite(parsedBoxId) && parsedBoxId > 0) {
    const comboBox = await db.comboBox.findFirst({
      where: { id: parsedBoxId, shop },
      select: { id: true, isGiftBox: true, giftMessageEnabled: true, shopifyProductId: true },
    });
    return comboBox || null;
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
    select: { id: true, isGiftBox: true, giftMessageEnabled: true, shopifyProductId: true },
  });

  return box || null;
}

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  if (topic !== "ORDERS_PAID") {
    return new Response("Unhandled topic", { status: 400 });
  }

  try {
    let hasBundleOrder = false;
    const additionalSettingEntries = [];
    const orderAttributes = normalizeOrderAttributes(payload?.note_attributes);
    const orderGiftRepar = getOrderAttributeAny(orderAttributes, ["Gift Repar", "Gift Referrer"]);
    const orderGiftMessage = getOrderAttributeAny(orderAttributes, ["Gift Message"]);
    const orderComboProductId = getOrderAttributeAny(orderAttributes, ["Combo Product ID"]);

    for (const item of payload.line_items || []) {
      const properties = normalizeProperties(item?.properties);

      const resolvedBox = await resolveComboBoxDetails(shop, item, properties);
      if (!resolvedBox?.id) continue;
      hasBundleOrder = true;

      const selectedProducts = extractSelectedProducts(properties);
      const fallbackLineItemTitle = String(item?.title || item?.name || "").trim();
      const safeSelectedProducts =
        selectedProducts.length > 0
          ? selectedProducts
          : (fallbackLineItemTitle ? [fallbackLineItemTitle] : []);

      const bundlePrice = computeLineRevenue(item, properties);
      const comboProductId =
        toNumericId(getPropertyAny(properties, ["_cb_combo_product_id"])) ||
        toNumericId(orderComboProductId) ||
        toNumericId(item?.product_id) ||
        toNumericId(resolvedBox.shopifyProductId) ||
        String(resolvedBox.id);
      const rawGiftReferrer = getPropertyAny(properties, ["_cb_gift_referrer", "Gift Referrer"]) || orderGiftRepar;
      const rawGiftMessage = getPropertyAny(properties, ["_cb_gift_message", "Gift Message"]) || orderGiftMessage;
      const giftReferrer = extractGiftDetailValue(rawGiftReferrer, comboProductId);
      const giftMessage = extractGiftDetailValue(rawGiftMessage, comboProductId);

      if (resolvedBox.isGiftBox === true && resolvedBox.giftMessageEnabled === true && (giftReferrer || giftMessage)) {
        const duplicate = additionalSettingEntries.some((entry) =>
          entry.comboProductId === comboProductId &&
          entry.giftReferrer === giftReferrer &&
          entry.giftMessage === giftMessage
        );
        if (!duplicate) {
          additionalSettingEntries.push({
            comboProductId,
            giftReferrer,
            giftMessage,
          });
        }
      }

      await trackBundleOrder(shop, {
        orderId: String(payload.id),
        orderName: typeof payload.name === "string" ? payload.name : null,
        orderNumber: Number.parseInt(String(payload.order_number), 10) || null,
        boxId: resolvedBox.id,
        selectedProducts: safeSelectedProducts,
        bundlePrice,
        giftMessage: giftMessage || null,
        orderDate: new Date(payload.created_at),
        customerId: payload.customer?.id ? String(payload.customer.id) : null,
      });
    }

    if (hasBundleOrder) {
      await addMixBundleOrderTag(shop, payload);
      await updateOrderNoteWithAdditionalSetting(shop, payload, additionalSettingEntries);
    }
  } catch (err) {
    console.error("[webhooks.orders.paid] Error tracking bundle order:", err);
  }

  return new Response(null, { status: 200 });
};
