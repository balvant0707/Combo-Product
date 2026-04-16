import {
  BillingInterval,
  BillingReplacementBehavior,
} from "@shopify/shopify-app-react-router/server";

export const BASIC_PLAN  = "Basic";
export const ADVANCE_PLAN = "Advance";
export const PLUS_PLAN   = "Plus";
export const BASIC_YEARLY_PLAN = "Basic Yearly";
export const ADVANCE_YEARLY_PLAN = "Advance Yearly";
export const PLUS_YEARLY_PLAN = "Plus Yearly";

// Legacy aliases kept so existing billing.server.js code still compiles
export const MONTHLY_PLAN = PLUS_PLAN;
export const YEARLY_PLAN  = PLUS_YEARLY_PLAN;

export const BASIC_PRICE   = 7.99;
export const ADVANCE_PRICE = 12.99;
export const PLUS_PRICE    = 24.99;
export const BASIC_YEARLY_PRICE = Number((BASIC_PRICE * 10).toFixed(2));
export const ADVANCE_YEARLY_PRICE = Number((ADVANCE_PRICE * 10).toFixed(2));
export const PLUS_YEARLY_PRICE = Number((PLUS_PRICE * 10).toFixed(2));

// Legacy exports used by billing.server.js
export const MONTHLY_PRICE = PLUS_PRICE;
export const YEARLY_PRICE  = PLUS_YEARLY_PRICE;

export const TRIAL_DAYS = 0;
export const BILLING_CURRENCY_CODE = "USD";
export const BILLING_IS_TEST = process.env.BILLING_TEST !== "false";

export const ORDER_LIMITS = {
  FREE:    10,
  BASIC:   50,
  ADVANCE: 100,
  PLUS:    Infinity,
};

export const BILLING_PLANS = {
  [BASIC_PLAN]: {
    trialDays: TRIAL_DAYS,
    replacementBehavior: BillingReplacementBehavior.Standard,
    lineItems: [
      {
        amount: BASIC_PRICE,
        currencyCode: BILLING_CURRENCY_CODE,
        interval: BillingInterval.Every30Days,
      },
    ],
  },
  [ADVANCE_PLAN]: {
    trialDays: TRIAL_DAYS,
    replacementBehavior: BillingReplacementBehavior.Standard,
    lineItems: [
      {
        amount: ADVANCE_PRICE,
        currencyCode: BILLING_CURRENCY_CODE,
        interval: BillingInterval.Every30Days,
      },
    ],
  },
  [PLUS_PLAN]: {
    trialDays: TRIAL_DAYS,
    replacementBehavior: BillingReplacementBehavior.Standard,
    lineItems: [
      {
        amount: PLUS_PRICE,
        currencyCode: BILLING_CURRENCY_CODE,
        interval: BillingInterval.Every30Days,
      },
    ],
  },
  [BASIC_YEARLY_PLAN]: {
    trialDays: TRIAL_DAYS,
    replacementBehavior: BillingReplacementBehavior.Standard,
    lineItems: [
      {
        amount: BASIC_YEARLY_PRICE,
        currencyCode: BILLING_CURRENCY_CODE,
        interval: BillingInterval.Annual,
      },
    ],
  },
  [ADVANCE_YEARLY_PLAN]: {
    trialDays: TRIAL_DAYS,
    replacementBehavior: BillingReplacementBehavior.Standard,
    lineItems: [
      {
        amount: ADVANCE_YEARLY_PRICE,
        currencyCode: BILLING_CURRENCY_CODE,
        interval: BillingInterval.Annual,
      },
    ],
  },
  [YEARLY_PLAN]: {
    trialDays: TRIAL_DAYS,
    replacementBehavior: BillingReplacementBehavior.Standard,
    lineItems: [
      {
        amount: PLUS_YEARLY_PRICE,
        currencyCode: BILLING_CURRENCY_CODE,
        interval: BillingInterval.Annual,
      },
    ],
  },
};

export const BILLING_PLAN_KEYS = [
  BASIC_PLAN,
  ADVANCE_PLAN,
  PLUS_PLAN,
  BASIC_YEARLY_PLAN,
  ADVANCE_YEARLY_PLAN,
  YEARLY_PLAN,
];

export function getPlanNameForBillingCycle(billingCycle = "monthly", planKey = "PLUS") {
  const normalizedCycle = String(billingCycle || "monthly").trim().toLowerCase();
  const normalizedKey = String(planKey || "PLUS").trim().toUpperCase();
  if (normalizedCycle === "yearly") {
    if (normalizedKey === "BASIC") return BASIC_YEARLY_PLAN;
    if (normalizedKey === "ADVANCE") return ADVANCE_YEARLY_PLAN;
    return PLUS_YEARLY_PLAN;
  }
  if (normalizedKey === "BASIC") return BASIC_PLAN;
  if (normalizedKey === "ADVANCE") return ADVANCE_PLAN;
  return PLUS_PLAN;
}

export function getBillingCycleForPlanName(planName) {
  const normalized = String(planName || "").trim().toLowerCase();
  if (normalized.includes("yearly")) return "yearly";
  return "monthly";
}

export function getPlanKeyFromName(planName) {
  if (!planName) return "FREE";
  const normalized = String(planName).trim().toLowerCase();
  if (normalized.includes("basic")) return "BASIC";
  if (normalized.includes("advance")) return "ADVANCE";
  if (normalized.includes("plus")) return "PLUS";
  return "FREE";
}

export function getPlanPrice(planName) {
  if (planName === BASIC_YEARLY_PLAN) return BASIC_YEARLY_PRICE;
  if (planName === ADVANCE_YEARLY_PLAN) return ADVANCE_YEARLY_PRICE;
  if (planName === PLUS_YEARLY_PLAN)  return PLUS_YEARLY_PRICE;
  if (planName === ADVANCE_PLAN) return ADVANCE_PRICE;
  if (planName === BASIC_PLAN)   return BASIC_PRICE;
  return PLUS_PRICE;
}

export function getBillingReplacementBehavior(currentPlanName, targetPlanName) {
  if (!currentPlanName || currentPlanName === targetPlanName) {
    return BillingReplacementBehavior.Standard;
  }
  return getPlanPrice(targetPlanName) > getPlanPrice(currentPlanName)
    ? BillingReplacementBehavior.ApplyImmediately
    : BillingReplacementBehavior.ApplyOnNextBillingCycle;
}
