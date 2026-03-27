/**
 * billing.server.js
 * Shopify Billing API — GraphQL mutations + subscription lifecycle.
 * Plans: FREE ($0) and PRO ($10/month with 7-day trial).
 */

import { PLANS } from "./subscription.server.js";
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

const CREATE_SUBSCRIPTION_MUTATION = `#graphql
  mutation CreateSubscription(
    $name:        String!
    $lineItems:   [AppSubscriptionLineItemInput!]!
    $returnUrl:   URL!
    $trialDays:   Int
    $test:        Boolean
  ) {
    appSubscriptionCreate(
      name:      $name
      lineItems: $lineItems
      returnUrl: $returnUrl
      trialDays: $trialDays
      test:      $test
    ) {
      confirmationUrl
      appSubscription { id status name }
      userErrors { field message }
    }
  }
`;

const CANCEL_SUBSCRIPTION_MUTATION = `#graphql
  mutation CancelSubscription($id: ID!) {
    appSubscriptionCancel(id: $id) {
      appSubscription { id status }
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
const IS_TEST      = process.env.BILLING_TEST  !== "false";   // true by default

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
  const { saveSubscription, activateFreePlan, getSubscription, PLANS: PLAN_MAP } =
    await import("./subscription.server.js");

  let shopifySub = null;
  let billingUnavailable = false;
  try {
    shopifySub = await getActiveShopifySubscription(admin);
  } catch (e) {
    if (e.isBillingUnavailable) billingUnavailable = true;
  }

  if (shopifySub) {
    // Shopify reports an active subscription — save it
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

  const local = await getSubscription(shop);
  return { subscription: local, billingUnavailable };
}

/* ─── Create subscription ──────────────────────────────────────────── */

/**
 * Calls appSubscriptionCreate and returns the Shopify confirmation URL.
 * The merchant must visit this URL to approve the charge.
 * Returns null in SKIP_BILLING mode (dev bypass).
 */
export async function createSubscription(admin, planKey, returnUrl) {
  const plan = PLANS[planKey];
  if (!plan) throw new Error(`Unknown plan: ${planKey}`);
  if (plan.price === 0) throw new Error("Use activateFreePlan() for the Free plan — no Shopify billing needed.");

  if (SKIP_BILLING) return null; // dev mode — caller handles this

  const resp = await admin.graphql(CREATE_SUBSCRIPTION_MUTATION, {
    variables: {
      name:      plan.name,
      lineItems: [{
        plan: {
          appRecurringPricingDetails: {
            price:    { amount: String(plan.price), currencyCode: plan.currencyCode },
            interval: plan.interval,
          },
        },
      }],
      returnUrl,
      trialDays: plan.trialDays,
      test:      IS_TEST,
    },
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
  const { cancelPlan } = await import("./subscription.server.js");

  if (!SKIP_BILLING && subscriptionId && !subscriptionId.includes("/dev")) {
    const resp = await admin.graphql(CANCEL_SUBSCRIPTION_MUTATION, {
      variables: { id: subscriptionId },
    });
    const json   = await resp.json();
    const result = json?.data?.appSubscriptionCancel;
    if (result?.userErrors?.length) throw new Error(result.userErrors[0].message);
  }

  await cancelPlan(shop);
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
export const PLAN_CONFIG   = { price: 10, currencyCode: "USD", interval: "EVERY_30_DAYS", trialDays: 7 };
export const FREE_BOX_LIMIT = 1;

export async function isProPlan(admin, shop) {
  const { hasActivePlan, getSubscription } = await import("./subscription.server.js");
  const sub = await getSubscription(shop);
  return sub?.plan === "PRO" && sub?.status === "ACTIVE";
}
