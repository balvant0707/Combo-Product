import db from "../db.server";
import { getOrderLimitForPlan } from "../config/billing";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function toValidDate(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeBillingCycle(value) {
  return String(value || "monthly").trim().toLowerCase() === "yearly" ? "yearly" : "monthly";
}

function addYears(date, years) {
  const next = new Date(date);
  next.setFullYear(next.getFullYear() + years);
  return next;
}

function resolveCycleAnchor(subscription, now) {
  return (
    toValidDate(subscription?.planStartedAt) ||
    toValidDate(subscription?.freeActivatedAt) ||
    toValidDate(subscription?.updatedAt) ||
    toValidDate(subscription?.createdAt) ||
    now
  );
}

export function getOrderCreditWindow(subscription, billingCycle, now = new Date()) {
  const cycle = normalizeBillingCycle(billingCycle);
  const anchor = resolveCycleAnchor(subscription, now);

  if (cycle === "yearly") {
    let start = anchor;
    while (true) {
      const next = addYears(start, 1);
      if (next.getTime() > now.getTime()) break;
      start = next;
    }
    return { cycle, label: "billing cycle", start, anchor };
  }

  if (anchor.getTime() >= now.getTime()) {
    return { cycle, label: "billing cycle", start: anchor, anchor };
  }

  const elapsedMs = now.getTime() - anchor.getTime();
  const cycleCount = Math.floor(elapsedMs / THIRTY_DAYS_MS);
  const start = new Date(anchor.getTime() + cycleCount * THIRTY_DAYS_MS);
  return { cycle, label: "billing cycle", start, anchor };
}

export async function getOrderCreditStatus({
  shop,
  subscription,
  billingCycle,
  now = new Date(),
}) {
  const planKey = String(subscription?.plan || "FREE").trim().toUpperCase();
  const orderLimitRaw = getOrderLimitForPlan(planKey, billingCycle);
  const window = getOrderCreditWindow(subscription, billingCycle, now);

  const usedOrders = await db.bundleOrder.count({
    where: {
      shop,
      orderDate: { gte: window.start, lte: now },
    },
  });

  const hasFiniteLimit = Number.isFinite(orderLimitRaw);
  const orderLimit = hasFiniteLimit ? orderLimitRaw : null;
  const remainingOrderCredit = hasFiniteLimit ? Math.max(orderLimitRaw - usedOrders, 0) : null;
  const orderLimitReached = hasFiniteLimit ? usedOrders >= orderLimitRaw : false;
  const orderLimitWarning = hasFiniteLimit ? !orderLimitReached && usedOrders >= orderLimitRaw * 0.8 : false;

  return {
    billingCycle: window.cycle,
    periodLabel: window.label,
    periodStart: window.start,
    periodAnchor: window.anchor,
    usedOrders,
    orderLimit,
    remainingOrderCredit,
    orderLimitReached,
    orderLimitWarning,
  };
}
