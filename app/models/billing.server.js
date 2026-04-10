/**
 * billing.server.js
 * Shopify Billing API helpers backed by the official billing utilities from
 * `authenticate.admin(request)`.
 */

import db from "../db.server";
import {
  BILLING_CURRENCY_CODE,
  BILLING_IS_TEST,
  BILLING_PLAN_KEYS,
  MONTHLY_PRICE,
  TRIAL_DAYS,
  YEARLY_PLAN,
  YEARLY_PRICE,
  getBillingReplacementBehavior,
  getPlanNameForBillingCycle,
  getPlanKeyFromName,
} from "../config/billing";

const SKIP_BILLING = process.env.SKIP_BILLING === "true";

function isDistributionError(message) {
  if (typeof message !== "string") return false;
  const lower = message.toLowerCase();
  return (
    lower.includes("public distribution") ||
    lower.includes("without a public distribution") ||
    lower.includes("billing api")
  );
}

function tagError(message) {
  const error = new Error(message);
  if (isDistributionError(message)) error.isBillingUnavailable = true;
  return error;
}

function getErrorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error ?? "Unknown billing error");
}

function getSubscriptionPrice(subscription) {
  const amount = subscription?.lineItems?.[0]?.plan?.pricingDetails?.price?.amount;
  return typeof amount === "number" ? amount : Number(amount || 0);
}

export const PRO_PLAN_NAME = "Pro";
export const FREE_BOX_LIMIT = 1;
export { BILLING_CURRENCY_CODE, MONTHLY_PRICE, TRIAL_DAYS, YEARLY_PRICE };

export const PLAN_CONFIG = {
  price: MONTHLY_PRICE,
  currencyCode: BILLING_CURRENCY_CODE,
  interval: "EVERY_30_DAYS",
  trialDays: TRIAL_DAYS,
};

/**
 * Fetches the active Shopify subscription for this installation using the
 * official billing helper. Returns the first active subscription, or null.
 */
export async function getActiveShopifySubscription(billing) {
  if (SKIP_BILLING) return null;

  try {
    const { appSubscriptions } = await billing.check({
      plans: BILLING_PLAN_KEYS,
    });

    return appSubscriptions.find((subscription) => subscription.status === "ACTIVE") || null;
  } catch (error) {
    const message = getErrorMessage(error);
    if (isDistributionError(message)) throw tagError(message);
    console.warn("[billing] getActiveShopifySubscription:", message);
    return null;
  }
}

/**
 * Syncs the active Shopify subscription to the local DB record.
 */
export async function syncSubscription(billing, shop) {
  const {
    deleteSubscription,
    getSubscription,
    hasRemainingBillingPeriod,
    saveSubscription,
  } = await import("./subscription.server.js");

  let shopifySub = null;
  let billingUnavailable = false;

  try {
    shopifySub = await getActiveShopifySubscription(billing);
  } catch (error) {
    if (error.isBillingUnavailable) billingUnavailable = true;
    else throw error;
  }

  const existingLocal = await getSubscription(shop);

  if (shopifySub) {
    const isPaidPlan = existingLocal?.plan && existingLocal.plan !== "FREE";
    const preserveScheduledCancellation =
      isPaidPlan &&
      existingLocal?.status === "CANCELLED" &&
      existingLocal?.subscriptionId === shopifySub.id &&
      hasRemainingBillingPeriod(existingLocal);

    if (preserveScheduledCancellation) {
      return { subscription: existingLocal, billingUnavailable };
    }

    const resolvedPlan = getPlanKeyFromName(shopifySub.name) || "PLUS";
    await saveSubscription(shop, {
      plan: resolvedPlan,
      status: shopifySub.status,
      subscriptionId: shopifySub.id,
      trialEndsAt: null,
      currentPeriodEnd: shopifySub.currentPeriodEnd
        ? new Date(shopifySub.currentPeriodEnd)
        : null,
    });
  }

  let local = await getSubscription(shop);
  const isPaidLocal = local?.plan && local.plan !== "FREE";
  if (!billingUnavailable && !shopifySub && isPaidLocal && !hasRemainingBillingPeriod(local)) {
    await deleteSubscription(shop);
    local = await getSubscription(shop);
  }

  return { subscription: local, billingUnavailable };
}

/**
 * Requests billing for the selected paid plan. Shopify handles the redirect.
 */
export async function createSubscription(billing, returnUrl, billingCycle = "monthly") {
  if (SKIP_BILLING) return null;

  if (typeof returnUrl !== "string" || !/^https?:\/\//i.test(returnUrl)) {
    throw new Error("Invalid billing return URL.");
  }

  const plan = getPlanNameForBillingCycle(billingCycle);
  const currentSubscription = await getActiveShopifySubscription(billing);

  try {
    await billing.request({
      plan,
      isTest: BILLING_IS_TEST,
      returnUrl,
      replacementBehavior: getBillingReplacementBehavior(currentSubscription?.name, plan),
    });
  } catch (error) {
    if (error instanceof Response) throw error;

    const message = getErrorMessage(error);
    if (isDistributionError(message)) throw tagError(message);
    throw error;
  }
}

/**
 * Cancels the active Shopify subscription and updates the local DB.
 */
export async function cancelSubscription(billing, shop, subscriptionId) {
  const { cancelPlan, getSubscription } = await import("./subscription.server.js");
  const existing = await getSubscription(shop);
  let currentPeriodEnd = existing?.currentPeriodEnd ?? null;
  let effectiveSubscriptionId = subscriptionId || existing?.subscriptionId || null;

  if (!SKIP_BILLING && subscriptionId && !subscriptionId.includes("/dev")) {
    try {
      const cancelledSubscription = await billing.cancel({
        subscriptionId,
        isTest: BILLING_IS_TEST,
        prorate: false,
      });

      currentPeriodEnd = cancelledSubscription?.currentPeriodEnd || currentPeriodEnd;
      effectiveSubscriptionId = cancelledSubscription?.id || effectiveSubscriptionId;
    } catch (error) {
      const message = getErrorMessage(error);
      if (isDistributionError(message)) throw tagError(message);
      throw error;
    }
  }

  return cancelPlan(shop, {
    subscriptionId: effectiveSubscriptionId,
    currentPeriodEnd,
  });
}

export async function getBoxCount(shop) {
  return db.comboBox.count({ where: { shop, deletedAt: null } });
}

/**
 * Returns { allowed, plan, currentCount, limit }
 */
export async function canCreateBox(_billing, shop) {
  const { getSubscription, PLANS: PM } = await import("./subscription.server.js");
  const subscription = await getSubscription(shop);
  const plan = PM[subscription?.plan] ?? PM.FREE;
  const limit = plan.boxLimit;
  const count = await getBoxCount(shop);

  return {
    allowed: count < limit,
    plan,
    currentCount: count,
    limit,
  };
}

export async function isProPlan(_billing, shop) {
  const { getSubscription, isPaidPlanActive } = await import("./subscription.server.js");
  const subscription = await getSubscription(shop);
  return isPaidPlanActive(subscription);
}

export function toPlanPageSubscription(subscription) {
  if (!subscription) return null;

  return {
    id: subscription.id,
    name: subscription.name,
    status: subscription.status,
    currentPeriodEnd: subscription.currentPeriodEnd,
    createdAt: subscription.createdAt,
    price: getSubscriptionPrice(subscription),
    currencyCode:
      subscription?.lineItems?.[0]?.plan?.pricingDetails?.price?.currencyCode ||
      BILLING_CURRENCY_CODE,
    billingCycle: subscription.name === YEARLY_PLAN ? "yearly" : "monthly",
  };
}
