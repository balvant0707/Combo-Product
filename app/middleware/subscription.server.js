/**
 * subscription.server.js
 * Route-protection middleware for plan-gated features.
 *
 * Usage inside any loader:
 *
 *   import { requirePlan, requirePaidPlan } from "../middleware/subscription.server";
 *
 *   export const loader = async ({ request }) => {
 *     const { admin, session } = await authenticate.admin(request);
 *     await requirePlan(admin, session, "GROWTH");   // throws redirect if below GROWTH
 *     // ... rest of loader
 *   };
 */

import { redirect } from "react-router";
import { PLAN_HIERARCHY } from "../models/billing-plans.server.js";

/** Base path for the pricing/upgrade page — adjust if needed */
const PRICING_PATH = "/app/pricing";

/**
 * Resolves the current plan key for the authenticated admin.
 * Returns "FREE" on any billing error (graceful degradation).
 */
async function resolvePlanKey(admin) {
  try {
    const { getCurrentPlan } = await import("../models/billing-plans.server.js");
    const { planKey } = await getCurrentPlan(admin);
    return planKey;
  } catch {
    return "FREE";
  }
}

/**
 * Throws a redirect to the pricing page when the shop's plan is below `minPlanKey`.
 *
 * @param {object} admin           - Shopify admin API object from authenticate.admin()
 * @param {object} session         - Shopify session from authenticate.admin()
 * @param {string} minPlanKey      - Minimum required plan key ("STARTER" | "GROWTH" | "PRO")
 * @param {string} [pricingPath]   - Override pricing redirect path
 */
export async function requirePlan(admin, session, minPlanKey, pricingPath = PRICING_PATH) {
  const minIndex = PLAN_HIERARCHY.indexOf(minPlanKey);
  if (minIndex === -1) throw new Error(`Unknown plan key: ${minPlanKey}`);

  const currentKey   = await resolvePlanKey(admin);
  const currentIndex = PLAN_HIERARCHY.indexOf(currentKey);

  if (currentIndex < minIndex) {
    const url = `${pricingPath}?required=${minPlanKey}&shop=${session.shop}`;
    throw redirect(url);
  }

  return currentKey; // return resolved key so callers can use it
}

/**
 * Convenience: require any paid plan (STARTER or above).
 */
export async function requirePaidPlan(admin, session, pricingPath = PRICING_PATH) {
  return requirePlan(admin, session, "STARTER", pricingPath);
}

/**
 * Non-throwing version — returns { allowed, currentKey, requiredKey }.
 * Use this when you want to show a UI gate instead of redirecting.
 */
export async function checkPlan(admin, minPlanKey) {
  const minIndex   = PLAN_HIERARCHY.indexOf(minPlanKey);
  const currentKey = await resolvePlanKey(admin);
  const currentIndex = PLAN_HIERARCHY.indexOf(currentKey);
  return {
    allowed:     currentIndex >= minIndex,
    currentKey,
    requiredKey: minPlanKey,
  };
}
