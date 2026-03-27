/**
 * subscription.server.js
 * All database operations for the Subscription table.
 */

import db from "../db.server";

/* ─── Constants ────────────────────────────────────────────────────── */

export const PLANS = {
  FREE: {
    key:      "FREE",
    name:     "Free",
    price:    0,
    interval: null,
    trialDays: 0,
    boxLimit: 1,
    features: [
      "1 combo box",
      "2-step & 3-step bundles",
      "Storefront widget",
      "Basic analytics",
    ],
  },
  PRO: {
    key:      "PRO",
    name:     "Pro",
    price:    10,
    currencyCode: "USD",
    interval: "EVERY_30_DAYS",
    trialDays: 7,
    boxLimit: Infinity,
    features: [
      "Unlimited combo boxes",
      "2-step & 3-step bundles",
      "Smart & manual collections",
      "Dynamic pricing & discounts",
      "Storefront widget",
      "Advanced analytics",
      "Priority support",
      "Early access to new features",
    ],
  },
};

export const PLAN_KEYS = ["FREE", "PRO"];

/* ─── Status values ─────────────────────────────────────────────────── */
// NONE    — not yet selected any plan (redirect to pricing)
// ACTIVE  — paid plan active (or free plan chosen)
// PENDING — Shopify charge not yet approved by merchant
// CANCELLED — subscription was cancelled
// EXPIRED   — subscription ended
// FROZEN    — shop frozen (past due)
// DECLINED  — merchant declined the charge

/* ─── DB helpers ────────────────────────────────────────────────────── */

/** Get the current subscription record for a shop, or null */
export async function getSubscription(shop) {
  return db.subscription.findUnique({ where: { shop } });
}

/** Upsert a subscription record */
export async function saveSubscription(shop, data) {
  return db.subscription.upsert({
    where:  { shop },
    create: { shop, ...data },
    update: data,
  });
}

/** Mark a shop as on the Free plan (ACTIVE, no Shopify subscription ID) */
export async function activateFreePlan(shop) {
  return saveSubscription(shop, {
    plan:           "FREE",
    status:         "ACTIVE",
    subscriptionId: null,
    trialEndsAt:    null,
    currentPeriodEnd: null,
  });
}

/** Save an ACTIVE paid subscription after Shopify billing is confirmed */
export async function activatePaidPlan(shop, { plan, subscriptionId, trialEndsAt, currentPeriodEnd }) {
  return saveSubscription(shop, {
    plan,
    status:          "ACTIVE",
    subscriptionId,
    trialEndsAt:     trialEndsAt     ? new Date(trialEndsAt)     : null,
    currentPeriodEnd: currentPeriodEnd ? new Date(currentPeriodEnd) : null,
  });
}

/** Mark subscription as CANCELLED */
export async function cancelPlan(shop) {
  return saveSubscription(shop, {
    plan:           "FREE",
    status:         "CANCELLED",
    subscriptionId: null,
    trialEndsAt:    null,
    currentPeriodEnd: null,
  });
}

/** Check if the shop has an active plan (FREE or PRO) */
export async function hasActivePlan(shop) {
  const sub = await getSubscription(shop);
  return !!sub && sub.status === "ACTIVE";
}

/** Get the box limit for the shop's current plan */
export async function getBoxLimit(shop) {
  const sub = await getSubscription(shop);
  if (!sub || sub.status !== "ACTIVE") return PLANS.FREE.boxLimit;
  return PLANS[sub.plan]?.boxLimit ?? PLANS.FREE.boxLimit;
}
