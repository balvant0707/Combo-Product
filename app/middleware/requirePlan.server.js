/**
 * requirePlan.server.js
 * Middleware helpers to gate routes behind an active plan selection.
 *
 * Usage inside any loader:
 *
 *   import { requireActivePlan } from "../middleware/requirePlan.server";
 *
 *   export const loader = async ({ request }) => {
 *     const { admin, session } = await authenticate.admin(request);
 *     await requireActivePlan(session.shop, request);
 *     // ...rest of loader
 *   };
 */

import { redirect } from "react-router";

const PRICING_PATH = "/app/pricing";

/**
 * Throws a redirect to the pricing page if the shop has no active plan.
 * Safe to call from any route loader.
 */
export async function requireActivePlan(shop, request) {
  // Don't gate the pricing page itself — avoid infinite redirect loop
  const url = new URL(request.url);
  if (url.pathname.startsWith(PRICING_PATH) || url.pathname.startsWith("/app/plan")) return;

  const { hasActivePlan } = await import("../models/subscription.server.js");
  const active = await hasActivePlan(shop);
  if (!active) {
    throw redirect(`${PRICING_PATH}?required=1`);
  }
}

/**
 * Non-throwing version — returns { allowed }.
 * Use to show a UI gate instead of redirecting.
 */
export async function checkActivePlan(shop) {
  try {
    const { hasActivePlan } = await import("../models/subscription.server.js");
    return { allowed: await hasActivePlan(shop) };
  } catch {
    return { allowed: false };
  }
}
