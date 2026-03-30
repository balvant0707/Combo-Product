/**
 * billing.server.js
 * Shopify Billing API — GraphQL mutations + subscription lifecycle.
 * Plans: FREE ($0) and PRO ($10/month with 7-day trial).
 */

import db from "../db.server";

/* ─── GraphQL ──────────────────────────────────────────────────────── */

const ACTIVE_SUBSCRIPTIONS_QUERY = `#graphql
  query ActiveSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        currentPeriodEnd
        createdAt
        trialDays
        test
        lineItems {
          id
          plan {
            pricingDetails {
              ... on AppRecurringPricing {
                price { amount currencyCode }
                interval
              }
            }
          }
        }
      }
    }
  }
`;

export const MONTHLY_PRICE = 5;
export const YEARLY_PRICE  = 49;
export const TRIAL_DAYS    = 7;

const CREATE_SUBSCRIPTION_MUTATION = `#graphql
  mutation AppSubscriptionCreate($returnUrl: URL!) {
    appSubscriptionCreate(
      name: "Pro Plan"
      returnUrl: $returnUrl
      test: true
      trialDays: 7
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price: { amount: 5, currencyCode: USD }
              interval: EVERY_30_DAYS
            }
          }
        }
      ]
    ) {
      confirmationUrl
      appSubscription { id status }
      userErrors { field message }
    }
  }
`;

const CREATE_YEARLY_MUTATION = `#graphql
  mutation AppSubscriptionCreateYearly($returnUrl: URL!) {
    appSubscriptionCreate(
      name: "Pro Plan Yearly"
      returnUrl: $returnUrl
      test: true
      trialDays: 7
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price: { amount: 49, currencyCode: USD }
              interval: ANNUAL
            }
          }
        }
      ]
    ) {
      confirmationUrl
      appSubscription { id status }
      userErrors { field message }
    }
  }
`;

const CANCEL_SUBSCRIPTION_MUTATION = `#graphql
  mutation CancelSubscription($id: ID!) {
    appSubscriptionCancel(id: $id) {
      appSubscription { id status currentPeriodEnd }
      userErrors { field message }
    }
  }
`;

/* ─── Helpers ──────────────────────────────────────────────────────── */

function isDistributionError(msg) {
  if (typeof msg !== "string") return false;
  const m = msg.toLowerCase();
  return m.includes("public distribution") || m.includes("billing api") || m.includes("without a public distribution");
}

function tagError(msg) {
  const err = new Error(msg);
  if (isDistributionError(msg)) err.isBillingUnavailable = true;
  return err;
}

const SKIP_BILLING = process.env.SKIP_BILLING === "true";

/* ─── Read current Shopify subscription ────────────────────────────── */

/**
 * Fetches the active Shopify subscription for this installation.
 * Returns the first ACTIVE subscription, or null.
 * Throws with err.isBillingUnavailable = true when billing API is blocked.
 */
export async function getActiveShopifySubscription(admin) {
  if (SKIP_BILLING) return null; // dev mode — no real billing

  try {
    const resp = await admin.graphql(ACTIVE_SUBSCRIPTIONS_QUERY);
    const json = await resp.json();

    const gqlErrors = json?.errors || [];
    if (gqlErrors.length) throw tagError(gqlErrors[0]?.message || "GraphQL error");

    const subs = json?.data?.currentAppInstallation?.activeSubscriptions || [];
    return subs.find((s) => s.status === "ACTIVE") || null;
  } catch (e) {
    if (e.isBillingUnavailable) throw e;
    console.warn("[billing] getActiveShopifySubscription:", e.message);
    return null;
  }
}

/**
 * Syncs the Shopify subscription state with the local DB.
 * Call this on the plan page loader and after billing returns.
 * Returns the local DB subscription record.
 */
export async function syncSubscription(admin, shop) {
  const {
    activateFreePlan,
    getSubscription,
    hasRemainingBillingPeriod,
    saveSubscription,
  } = await import("./subscription.server.js");

  let shopifySub = null;
  let billingUnavailable = false;
  try {
    shopifySub = await getActiveShopifySubscription(admin);
  } catch (e) {
    if (e.isBillingUnavailable) billingUnavailable = true;
  }

  const existingLocal = await getSubscription(shop);

  if (shopifySub) {
    // Shopify reports an active subscription — save it
    const preserveScheduledCancellation =
      existingLocal?.plan === "PRO" &&
      existingLocal?.status === "CANCELLED" &&
      existingLocal?.subscriptionId === shopifySub.id &&
      hasRemainingBillingPeriod(existingLocal);

    if (preserveScheduledCancellation) {
      return { subscription: existingLocal, billingUnavailable };
    }

    const planName = shopifySub.name || "";
    const planKey  = planName.toUpperCase().includes("PRO") ? "PRO" : "FREE";
    await saveSubscription(shop, {
      plan:            planKey,
      status:          shopifySub.status,   // "ACTIVE"
      subscriptionId:  shopifySub.id,
      trialEndsAt:     null,
      currentPeriodEnd: shopifySub.currentPeriodEnd ? new Date(shopifySub.currentPeriodEnd) : null,
    });
  }

  let local = await getSubscription(shop);
  if (!billingUnavailable && !shopifySub && local?.plan === "PRO" && !hasRemainingBillingPeriod(local)) {
    local = await activateFreePlan(shop);
  }
  return { subscription: local, billingUnavailable };
}

/* ─── Create subscription ──────────────────────────────────────────── */

/**
 * Calls appSubscriptionCreate and returns the Shopify confirmation URL.
 * Supports both createSubscription(admin, returnUrl) and the older
 * createSubscription(admin, "PRO", returnUrl) call shape.
 * The merchant must visit this URL to approve the charge.
 * Returns null in SKIP_BILLING mode (dev bypass).
 */
export async function createSubscription(admin, returnUrl, billingCycle = "monthly") {
  if (SKIP_BILLING) return null; // dev mode — caller handles this

  if (typeof returnUrl !== "string" || !/^https?:\/\//i.test(returnUrl)) {
    throw new Error("Invalid billing return URL.");
  }

  const mutation = billingCycle === "yearly" ? CREATE_YEARLY_MUTATION : CREATE_SUBSCRIPTION_MUTATION;
  const resp = await admin.graphql(mutation, {
    variables: { returnUrl },
  });

  const json = await resp.json();

  const gqlErrors = json?.errors || [];
  if (gqlErrors.length) throw tagError(gqlErrors[0]?.message || "Billing API error");

  const result = json?.data?.appSubscriptionCreate;
  if (result?.userErrors?.length) throw tagError(result.userErrors[0].message);

  const confirmationUrl = result?.confirmationUrl;
  if (!confirmationUrl) throw new Error("Shopify did not return a billing confirmation URL.");

  return confirmationUrl;
}

/* ─── Cancel subscription ──────────────────────────────────────────── */

/**
 * Cancels the active Shopify subscription.
 * Also updates the local DB record to CANCELLED.
 */
export async function cancelSubscription(admin, shop, subscriptionId) {
  const { cancelPlan, getSubscription } = await import("./subscription.server.js");
  const existing = await getSubscription(shop);
  let currentPeriodEnd = existing?.currentPeriodEnd ?? null;
  let effectiveSubscriptionId = subscriptionId || existing?.subscriptionId || null;

  if (!SKIP_BILLING && subscriptionId && !subscriptionId.includes("/dev")) {
    const resp = await admin.graphql(CANCEL_SUBSCRIPTION_MUTATION, {
      variables: { id: subscriptionId },
    });
    const json   = await resp.json();
    const result = json?.data?.appSubscriptionCancel;
    if (result?.userErrors?.length) throw new Error(result.userErrors[0].message);
    currentPeriodEnd = result?.appSubscription?.currentPeriodEnd || currentPeriodEnd;
    effectiveSubscriptionId = result?.appSubscription?.id || effectiveSubscriptionId;
  }

  return cancelPlan(shop, {
    subscriptionId: effectiveSubscriptionId,
    currentPeriodEnd,
  });
}

/* ─── Box count helpers ─────────────────────────────────────────────── */

export async function getBoxCount(shop) {
  return db.comboBox.count({ where: { shop, deletedAt: null } });
}

/**
 * Returns { allowed, plan, currentCount, limit }
 */
export async function canCreateBox(admin, shop) {
  const { getSubscription, PLANS: PM } = await import("./subscription.server.js");
  const sub   = await getSubscription(shop);
  const plan  = PM[sub?.plan] ?? PM.FREE;
  const limit = plan.boxLimit;
  const count = await getBoxCount(shop);
  return {
    allowed:      count < limit,
    plan,
    currentCount: count,
    limit,
  };
}

/* Legacy exports kept for backward compat with existing routes */
export const PRO_PLAN_NAME = "Pro";
export const PLAN_CONFIG   = { price: MONTHLY_PRICE, currencyCode: "USD", interval: "EVERY_30_DAYS", trialDays: TRIAL_DAYS };
export const FREE_BOX_LIMIT = 1;

export async function isProPlan(admin, shop) {
  const { getSubscription, isPaidPlanActive } = await import("./subscription.server.js");
  const sub = await getSubscription(shop);
  return isPaidPlanActive(sub);
}
