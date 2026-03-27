/**
 * billing-plans.server.js
 * Full Shopify Billing implementation — 4-tier pricing (Free / Starter / Growth / Pro)
 * Supports: create, cancel, upgrade, downgrade, subscription check, route middleware
 */

import db from "../db.server";

/* ─── Dev / skip-billing mode ─────────────────────────────────────── */
//
// Set SKIP_BILLING=true in .env to bypass Shopify Billing API entirely.
// DEV_PLAN sets which plan all shops receive while skipping (default: "PRO").
//
const SKIP_BILLING = process.env.SKIP_BILLING === "true";
const DEV_PLAN_KEY = (process.env.DEV_PLAN || "PRO").toUpperCase();

/* ─── Plan Definitions ─────────────────────────────────────────────── */

export const PLANS = {
  FREE: {
    key:          "FREE",
    name:         "Free",
    handle:       "free",
    price:        0,
    currencyCode: "USD",
    interval:     "EVERY_30_DAYS",
    trialDays:    0,
    features: [
      "1 combo box",
      "2-step bundles",
      "Storefront widget",
      "Basic analytics",
    ],
    limits: {
      boxes: 1,
    },
  },

  STARTER: {
    key:          "STARTER",
    name:         "Starter",
    handle:       "starter",
    price:        9,
    currencyCode: "USD",
    interval:     "EVERY_30_DAYS",
    trialDays:    7,
    features: [
      "5 combo boxes",
      "2-step & 3-step bundles",
      "Smart & manual collections",
      "Dynamic pricing & discounts",
      "Storefront widget",
      "Email support",
    ],
    limits: {
      boxes: 5,
    },
  },

  GROWTH: {
    key:          "GROWTH",
    name:         "Growth",
    handle:       "growth",
    price:        19,
    currencyCode: "USD",
    interval:     "EVERY_30_DAYS",
    trialDays:    7,
    features: [
      "25 combo boxes",
      "2-step & 3-step bundles",
      "Smart & manual collections",
      "Dynamic pricing & discounts",
      "Storefront widget",
      "Advanced analytics",
      "Priority email support",
    ],
    limits: {
      boxes: 25,
    },
  },

  PRO: {
    key:          "PRO",
    name:         "Pro",
    handle:       "pro",
    price:        39,
    currencyCode: "USD",
    interval:     "EVERY_30_DAYS",
    trialDays:    7,
    features: [
      "Unlimited combo boxes",
      "2-step & 3-step bundles",
      "Smart & manual collections",
      "Dynamic pricing & discounts",
      "Storefront widget",
      "Advanced analytics",
      "Priority support (email + chat)",
      "Early access to new features",
    ],
    limits: {
      boxes: Infinity,
    },
  },
};

/** Ordered lowest → highest so index = tier level */
export const PLAN_HIERARCHY = ["FREE", "STARTER", "GROWTH", "PRO"];

/** Resolve a plan key from a Shopify subscription name (stored as plan.name) */
export function planKeyFromName(subscriptionName) {
  if (!subscriptionName) return "FREE";
  const upper = subscriptionName.toUpperCase();
  for (const key of PLAN_HIERARCHY) {
    if (upper.includes(key)) return key;
  }
  return "FREE";
}

/** Returns true if targetKey is a higher tier than currentKey */
export function isUpgrade(currentKey, targetKey) {
  return PLAN_HIERARCHY.indexOf(targetKey) > PLAN_HIERARCHY.indexOf(currentKey);
}

/* ─── GraphQL ──────────────────────────────────────────────────────── */

const ACTIVE_SUBSCRIPTIONS_QUERY = `#graphql
  query GetActiveSubscriptions {
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
    $name:                String!
    $lineItems:           [AppSubscriptionLineItemInput!]!
    $returnUrl:           URL!
    $trialDays:           Int
    $test:                Boolean
    $replacementBehavior: AppSubscriptionReplacementBehavior
  ) {
    appSubscriptionCreate(
      name:                $name
      lineItems:           $lineItems
      returnUrl:           $returnUrl
      trialDays:           $trialDays
      test:                $test
      replacementBehavior: $replacementBehavior
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

/* ─── Mock subscription (SKIP_BILLING mode) ───────────────────────── */

function mockSubscription(planKey) {
  const key  = SKIP_BILLING ? DEV_PLAN_KEY : (planKey || DEV_PLAN_KEY);
  const plan = PLANS[key] || PLANS.PRO;
  return {
    id:               `gid://shopify/AppSubscription/dev-${key.toLowerCase()}`,
    name:             plan.name,
    status:           "ACTIVE",
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt:        new Date().toISOString(),
    trialDays:        0,
    test:             true,
    lineItems: [
      {
        id: "gid://shopify/AppSubscriptionLineItem/dev",
        plan: {
          pricingDetails: {
            price:    { amount: String(plan.price), currencyCode: plan.currencyCode },
            interval: plan.interval,
          },
        },
      },
    ],
    _isMock: true,
  };
}

/* ─── Error helpers ────────────────────────────────────────────────── */

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
  const err = new Error(message);
  if (isDistributionError(message)) err.isBillingUnavailable = true;
  return err;
}

/* ─── Core API ─────────────────────────────────────────────────────── */

/**
 * Returns the first active Shopify subscription or null.
 * When SKIP_BILLING=true, returns a mock subscription without hitting Shopify.
 * Throws with err.isBillingUnavailable = true when billing is unavailable.
 */
export async function getActiveSubscription(admin) {
  if (SKIP_BILLING) return mockSubscription();

  try {
    const resp = await admin.graphql(ACTIVE_SUBSCRIPTIONS_QUERY);
    const json = await resp.json();

    const gqlErrors = json?.errors || [];
    if (gqlErrors.length) {
      const msg = gqlErrors[0]?.message || "GraphQL error";
      throw tagError(msg);
    }

    const subs = json?.data?.currentAppInstallation?.activeSubscriptions || [];
    return subs.find((s) => s.status === "ACTIVE") || subs[0] || null;
  } catch (e) {
    if (e.isBillingUnavailable) throw e;
    console.warn("[billing] getActiveSubscription failed:", e.message);
    return null;
  }
}

/**
 * Returns a normalised plan info object:
 * { planKey, plan, subscription, isFree, isBillingUnavailable, isDevMode }
 */
export async function getCurrentPlan(admin) {
  // Dev bypass — return mock plan without touching Shopify
  if (SKIP_BILLING) {
    const planKey = DEV_PLAN_KEY in PLANS ? DEV_PLAN_KEY : "PRO";
    const plan    = PLANS[planKey];
    const sub     = mockSubscription(planKey);
    return {
      planKey,
      plan,
      subscription: {
        id:               sub.id,
        name:             sub.name,
        status:           sub.status,
        currentPeriodEnd: sub.currentPeriodEnd,
        createdAt:        sub.createdAt,
        trialDays:        sub.trialDays,
        test:             sub.test,
        price:            String(plan.price),
        currencyCode:     plan.currencyCode,
      },
      isFree:              planKey === "FREE",
      isBillingUnavailable: false,
      isDevMode:           true,
    };
  }

  let subscription = null;
  let isBillingUnavailable = false;

  try {
    subscription = await getActiveSubscription(admin);
  } catch (e) {
    if (e.isBillingUnavailable) isBillingUnavailable = true;
  }

  const planKey = subscription ? planKeyFromName(subscription.name) : "FREE";
  const plan    = PLANS[planKey];

  return {
    planKey,
    plan,
    subscription: subscription
      ? {
          id:               subscription.id,
          name:             subscription.name,
          status:           subscription.status,
          currentPeriodEnd: subscription.currentPeriodEnd,
          createdAt:        subscription.createdAt,
          trialDays:        subscription.trialDays,
          test:             subscription.test,
          price:            subscription.lineItems?.[0]?.plan?.pricingDetails?.price?.amount,
          currencyCode:     subscription.lineItems?.[0]?.plan?.pricingDetails?.price?.currencyCode,
        }
      : null,
    isFree:              planKey === "FREE",
    isBillingUnavailable,
    isDevMode:           false,
  };
}

/**
 * Creates (or replaces) a subscription for the given plan key.
 * - Upgrade:   replacementBehavior = APPLY_IMMEDIATELY
 * - Downgrade: replacementBehavior = APPLY_ON_NEXT_BILLING_CYCLE
 * Returns the Shopify confirmation URL.
 */
export async function createSubscription(admin, planKey, returnUrl, currentPlanKey = "FREE") {
  const plan = PLANS[planKey];
  if (!plan) throw new Error(`Unknown plan key: ${planKey}`);
  if (plan.price === 0) throw new Error("Cannot create a Shopify subscription for the free plan");

  // In skip-billing mode, redirect directly to returnUrl — no Shopify billing page
  if (SKIP_BILLING) return returnUrl;

  // Use test:true until BILLING_LIVE=true is explicitly set (independent of NODE_ENV)
  const isTest    = process.env.BILLING_LIVE !== "true";
  const upgrading = isUpgrade(currentPlanKey, planKey);

  const resp = await admin.graphql(CREATE_SUBSCRIPTION_MUTATION, {
    variables: {
      name:      plan.name,
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price:    { amount: plan.price, currencyCode: plan.currencyCode },
              interval: plan.interval,
            },
          },
        },
      ],
      returnUrl,
      trialDays:           plan.trialDays,
      test:                isTest,
      replacementBehavior: upgrading ? "APPLY_IMMEDIATELY" : "APPLY_ON_NEXT_BILLING_CYCLE",
    },
  });

  const json = await resp.json();

  const gqlErrors = json?.errors || [];
  if (gqlErrors.length) {
    throw tagError(gqlErrors[0]?.message || "Billing API error");
  }

  const result = json?.data?.appSubscriptionCreate;
  if (result?.userErrors?.length) {
    throw tagError(result.userErrors[0].message);
  }

  return result?.confirmationUrl;
}

/**
 * Cancels an active subscription by GID.
 * No-op when SKIP_BILLING=true.
 * Returns the cancelled subscription object.
 */
export async function cancelSubscription(admin, subscriptionId) {
  if (SKIP_BILLING || subscriptionId?.includes("/dev")) return null;

  const resp = await admin.graphql(CANCEL_SUBSCRIPTION_MUTATION, {
    variables: { id: subscriptionId },
  });
  const json = await resp.json();
  const result = json?.data?.appSubscriptionCancel;
  if (result?.userErrors?.length) throw new Error(result.userErrors[0].message);
  return result?.appSubscription;
}

/**
 * Switches from one paid plan to another.
 * Uses replacementBehavior to handle upgrade vs downgrade atomically.
 * Returns the confirmation URL.
 */
export async function switchPlan(admin, targetPlanKey, returnUrl, currentSubscriptionId, currentPlanKey) {
  // For FREE → paid, just create normally
  // For paid → FREE, cancel the current subscription
  if (targetPlanKey === "FREE") {
    if (currentSubscriptionId) {
      await cancelSubscription(admin, currentSubscriptionId);
    }
    return null; // no redirect needed for free plan
  }

  // paid → paid: create with replacement (Shopify cancels old one automatically)
  return createSubscription(admin, targetPlanKey, returnUrl, currentPlanKey);
}

/* ─── Box count helpers ────────────────────────────────────────────── */

export async function getBoxCount(shop) {
  return db.comboBox.count({ where: { shop, deletedAt: null } });
}

/**
 * Returns { allowed, planKey, plan, currentCount, limit }
 */
export async function canCreateBox(admin, shop) {
  const { planKey, plan } = await getCurrentPlan(admin).catch(() => ({
    planKey: "FREE",
    plan: PLANS.FREE,
  }));
  const count = await getBoxCount(shop);
  const limit = plan.limits.boxes;
  return {
    allowed:      count < limit,
    planKey,
    plan,
    currentCount: count,
    limit,
  };
}
