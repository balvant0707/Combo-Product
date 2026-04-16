/**
 * subscription.server.js
 * All database operations for the Subscription table.
 */

import db from "../db.server";
import {
  BILLING_CURRENCY_CODE,
  MONTHLY_PRICE,
  TRIAL_DAYS,
} from "../config/billing";

/* ─── Constants ────────────────────────────────────────────────────── */

export const PLANS = {
  FREE: {
    key:      "FREE",
    name:     "Free",
    price:    0,
    interval: null,
    trialDays: 0,
    orderLimit: 10,
    boxLimit: Infinity,
    features: [
      "10 orders/month",
      "Unlimited Simple Box",
      "Unlimited Specific Box",
      "Basic email support",
    ],
  },
  BASIC: {
    key:      "BASIC",
    name:     "Basic",
    price:    7.9,
    currencyCode: BILLING_CURRENCY_CODE,
    interval: "EVERY_30_DAYS",
    trialDays: TRIAL_DAYS,
    orderLimit: 50,
    boxLimit: Infinity,
    features: [
      "50 orders/month",
      "Unlimited Simple Box",
      "Unlimited Specific Box",
      "Email & live support",
    ],
  },
  ADVANCE: {
    key:      "ADVANCE",
    name:     "Advance",
    price:    12.9,
    currencyCode: BILLING_CURRENCY_CODE,
    interval: "EVERY_30_DAYS",
    trialDays: TRIAL_DAYS,
    orderLimit: 100,
    boxLimit: Infinity,
    features: [
      "100 orders/month",
      "Unlimited Simple Box",
      "Unlimited Specific Box",
      "Priority & developer support",
    ],
  },
  PLUS: {
    key:      "PLUS",
    name:     "Plus",
    price:    24.9,
    currencyCode: BILLING_CURRENCY_CODE,
    interval: "EVERY_30_DAYS",
    trialDays: TRIAL_DAYS,
    orderLimit: Infinity,
    boxLimit: Infinity,
    features: [
      "Unlimited orders",
      "Unlimited Simple Box",
      "Unlimited Specific Box",
        "Setup Support",
      "Highest-priority support",
    ],
  },
  // Legacy alias — maps old PRO subs to PLUS
  PRO: {
    key:      "PLUS",
    name:     "Plus",
    price:    24.9,
    currencyCode: BILLING_CURRENCY_CODE,
    interval: "EVERY_30_DAYS",
    trialDays: TRIAL_DAYS,
    orderLimit: Infinity,
    boxLimit: Infinity,
    features: [
      "Unlimited orders",
      "Unlimited Simple Box",
      "Unlimited Specific Box",
      "Setup Support",
      "Highest Priority support",
    ],
  },
};

export const PLAN_KEYS = ["FREE", "BASIC", "ADVANCE", "PLUS"];

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

/** Mark a shop as on the Free plan (ACTIVE, no Shopify subscription ID).
 *  freeActivatedAt is set on the very first activation and never overwritten. */
export async function activateFreePlan(shop) {
  const existing = await db.subscription.findUnique({ where: { shop } });
  const freeActivatedAt = existing?.freeActivatedAt ?? new Date();
  return db.subscription.upsert({
    where:  { shop },
    create: { shop, plan: "FREE", status: "ACTIVE", subscriptionId: null, trialEndsAt: null, currentPeriodEnd: null, freeActivatedAt },
    update: {       plan: "FREE", status: "ACTIVE", subscriptionId: null, trialEndsAt: null, currentPeriodEnd: null, freeActivatedAt },
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

const PAID_PLAN_KEYS = new Set(["BASIC", "ADVANCE", "PLUS", "PRO"]);

export function isPaidPlanActive(subscription, now = new Date()) {
  if (!subscription || !PAID_PLAN_KEYS.has(subscription.plan)) return false;
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
  return (
    !!subscription &&
    PAID_PLAN_KEYS.has(subscription.plan) &&
    subscription.status === "CANCELLED" &&
    hasRemainingBillingPeriod(subscription, now)
  );
}

/** Mark subscription as CANCELLED, preserving paid access until currentPeriodEnd when available */
export async function cancelPlan(shop, { subscriptionId = null, currentPeriodEnd = null, plan = "PLUS" } = {}) {
  const endsAt = toDateOrNull(currentPeriodEnd);
  if (!endsAt || endsAt.getTime() <= Date.now()) {
    await deleteSubscription(shop);
    return null;
  }

  return saveSubscription(shop, {
    plan: PAID_PLAN_KEYS.has(plan) ? plan : "PLUS",
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
  const plan = PLANS[sub?.plan] ?? PLANS.FREE;
  return plan.boxLimit;
}

/** Get the order limit for the shop's current plan */
export async function getOrderLimit(shop) {
  const sub = await getSubscription(shop);
  const plan = PLANS[sub?.plan] ?? PLANS.FREE;
  return plan.orderLimit;
}
