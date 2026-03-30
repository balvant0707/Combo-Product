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

function toDateOrNull(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

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

/** Delete the current subscription record for a shop */
export async function deleteSubscription(shop) {
  return db.subscription.deleteMany({ where: { shop } });
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

export function hasRemainingBillingPeriod(subscription, now = new Date()) {
  const currentPeriodEnd = toDateOrNull(subscription?.currentPeriodEnd);
  return !!currentPeriodEnd && currentPeriodEnd.getTime() > now.getTime();
}

export function isPaidPlanActive(subscription, now = new Date()) {
  if (!subscription || subscription.plan !== "PRO") return false;
  if (subscription.status === "ACTIVE") return true;
  return subscription.status === "CANCELLED" && hasRemainingBillingPeriod(subscription, now);
}

export function isFreePlanActive(subscription) {
  return !!subscription && subscription.plan === "FREE" && subscription.status === "ACTIVE";
}

export function hasPlanAccess(subscription, now = new Date()) {
  return isFreePlanActive(subscription) || isPaidPlanActive(subscription, now);
}

export function isCancellationScheduled(subscription, now = new Date()) {
  return !!subscription && subscription.plan === "PRO" && subscription.status === "CANCELLED" && hasRemainingBillingPeriod(subscription, now);
}

/** Mark subscription as CANCELLED, preserving paid access until currentPeriodEnd when available */
export async function cancelPlan(shop, { subscriptionId = null, currentPeriodEnd = null } = {}) {
  const endsAt = toDateOrNull(currentPeriodEnd);
  if (!endsAt || endsAt.getTime() <= Date.now()) {
    await deleteSubscription(shop);
    return null;
  }

  return saveSubscription(shop, {
    plan: "PRO",
    status: "CANCELLED",
    subscriptionId,
    trialEndsAt: null,
    currentPeriodEnd: endsAt,
  });
}

/** Check if the shop has an active plan (FREE or PRO) */
export async function hasActivePlan(shop) {
  const sub = await getSubscription(shop);
  return hasPlanAccess(sub);
}

/** Get the box limit for the shop's current plan */
export async function getBoxLimit(shop) {
  const sub = await getSubscription(shop);
  if (isPaidPlanActive(sub)) return PLANS.PRO.boxLimit;
  if (isFreePlanActive(sub)) return PLANS.FREE.boxLimit;
  return PLANS.FREE.boxLimit;
}
