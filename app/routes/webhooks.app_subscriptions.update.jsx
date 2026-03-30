import { authenticate } from "../shopify.server";
import {
  cancelPlan,
  deleteSubscription,
  getSubscription,
  saveSubscription,
} from "../models/subscription.server";
import { setShopPlanStatus } from "../models/shop.server";

function toDateOrNull(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export const action = async ({ request }) => {
  const { payload, topic, shop } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const appSubscription = payload?.app_subscription || payload || {};
  const status = String(appSubscription.status || "").toUpperCase();
  const subscriptionId =
    appSubscription.admin_graphql_api_id ||
    appSubscription.id ||
    null;

  const existing = await getSubscription(shop);
  const currentPeriodEnd =
    toDateOrNull(appSubscription.current_period_end) ||
    toDateOrNull(appSubscription.currentPeriodEnd) ||
    existing?.currentPeriodEnd ||
    null;

  if (!status) {
    console.warn("[webhooks.app_subscriptions.update] Missing subscription status", { shop, payload });
    return new Response(null, { status: 200 });
  }

  switch (status) {
    case "ACTIVE":
      await saveSubscription(shop, {
        plan: "PRO",
        status: "ACTIVE",
        subscriptionId: subscriptionId || existing?.subscriptionId || null,
        trialEndsAt: existing?.trialEndsAt || null,
        currentPeriodEnd,
      });
      await setShopPlanStatus(shop, "active").catch(() => {});
      break;

    case "CANCELLED": {
      const nextSubscription = await cancelPlan(shop, {
        subscriptionId: subscriptionId || existing?.subscriptionId || null,
        currentPeriodEnd,
      });
      await setShopPlanStatus(shop, nextSubscription?.plan === "PRO" ? "active" : "free").catch(() => {});
      break;
    }

    case "EXPIRED":
    case "DECLINED":
    case "FROZEN":
      await deleteSubscription(shop);
      await setShopPlanStatus(shop, "free").catch(() => {});
      break;

    default:
      console.info("[webhooks.app_subscriptions.update] Ignoring unsupported status", { shop, status });
      break;
  }

  return new Response(null, { status: 200 });
};
