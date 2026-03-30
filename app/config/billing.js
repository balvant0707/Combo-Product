import {
  BillingInterval,
  BillingReplacementBehavior,
} from "@shopify/shopify-app-react-router/server";

export const MONTHLY_PLAN = "Pro Monthly";
export const YEARLY_PLAN = "Pro Yearly";

export const MONTHLY_PRICE = 5;
export const YEARLY_PRICE = 49;
export const TRIAL_DAYS = 7;
export const BILLING_CURRENCY_CODE = "USD";
export const BILLING_IS_TEST = process.env.BILLING_TEST !== "false";

export const BILLING_PLANS = {
  [MONTHLY_PLAN]: {
    trialDays: TRIAL_DAYS,
    replacementBehavior: BillingReplacementBehavior.Standard,
    lineItems: [
      {
        amount: MONTHLY_PRICE,
        currencyCode: BILLING_CURRENCY_CODE,
        interval: BillingInterval.Every30Days,
      },
    ],
  },
  [YEARLY_PLAN]: {
    trialDays: TRIAL_DAYS,
    replacementBehavior: BillingReplacementBehavior.Standard,
    lineItems: [
      {
        amount: YEARLY_PRICE,
        currencyCode: BILLING_CURRENCY_CODE,
        interval: BillingInterval.Annual,
      },
    ],
  },
};

export const BILLING_PLAN_KEYS = [MONTHLY_PLAN, YEARLY_PLAN];

export function getPlanNameForBillingCycle(billingCycle = "monthly") {
  return billingCycle === "yearly" ? YEARLY_PLAN : MONTHLY_PLAN;
}

export function getBillingCycleForPlanName(planName) {
  if (planName === YEARLY_PLAN) return "yearly";
  if (planName === MONTHLY_PLAN) return "monthly";
  return null;
}

export function getPlanPrice(planName) {
  if (planName === YEARLY_PLAN) return YEARLY_PRICE;
  return MONTHLY_PRICE;
}

export function getBillingReplacementBehavior(currentPlanName, targetPlanName) {
  if (!currentPlanName || currentPlanName === targetPlanName) {
    return BillingReplacementBehavior.Standard;
  }

  return getPlanPrice(targetPlanName) > getPlanPrice(currentPlanName)
    ? BillingReplacementBehavior.ApplyImmediately
    : BillingReplacementBehavior.ApplyOnNextBillingCycle;
}
