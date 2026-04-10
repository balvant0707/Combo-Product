/* eslint-disable react/prop-types */
/**
 * app.pricing.jsx
 * Billing page — Free / Basic / Advance / Plus plan selection.
 * Design: Polaris React components.
 */

import { useState, useEffect } from "react";
import {
  redirect as rrRedirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  buildShopifyAdminAppUrl,
  withEmbeddedAppParamsFromRequest,
} from "../utils/embedded-app";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  InlineGrid,
  InlineStack,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";
import {
  BASIC_PLAN,
  ADVANCE_PLAN,
  PLUS_PLAN,
  BASIC_PRICE,
  ADVANCE_PRICE,
  PLUS_PRICE,
  TRIAL_DAYS,
  ORDER_LIMITS,
} from "../config/billing";

/* ── Loader ─────────────────────────────────────────────────────── */

export const loader = async ({ request }) => {
  const { billing, session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);

  const { syncSubscription } = await import("../models/billing.server.js");
  const { activatePaidPlan } = await import("../models/subscription.server.js");

  const { subscription, billingUnavailable } = await syncSubscription(billing, shop);
  const isDevMode = process.env.SKIP_BILLING === "true";

  if (url.searchParams.get("subscribed") === "1" && subscription?.subscriptionId) {
    await activatePaidPlan(shop, {
      plan: subscription.plan || "PLUS",
      subscriptionId: subscription.subscriptionId,
      currentPeriodEnd: subscription.currentPeriodEnd,
    }).catch(() => {});
    return rrRedirect(withEmbeddedAppParamsFromRequest("/app?subscribed=1", request));
  }

  return {
    subscription,
    billingUnavailable: !isDevMode && billingUnavailable,
    isDevMode,
    subscribed: url.searchParams.get("subscribed") === "1",
    cancelled: url.searchParams.get("cancelled") === "1",
    trialDays: TRIAL_DAYS,
  };
};

/* ── Action ─────────────────────────────────────────────────────── */

export const action = async ({ request }) => {
  const { billing, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  const { createSubscription, cancelSubscription } = await import("../models/billing.server.js");
  const { activateFreePlan, activatePaidPlan } = await import("../models/subscription.server.js");
  const { setShopPlanStatus } = await import("../models/shop.server.js");

  if (intent === "free") {
    await activateFreePlan(shop);
    await setShopPlanStatus(shop, "free");
    return rrRedirect(withEmbeddedAppParamsFromRequest("/app/boxes", request));
  }

  if (intent === "subscribe") {
    const planKey = formData.get("planKey") || "PLUS";
    const billingCycle = formData.get("billingCycle") || "monthly";
    const isSkipBilling = process.env.SKIP_BILLING === "true";

    if (isSkipBilling) {
      await activatePaidPlan(shop, {
        plan: planKey,
        subscriptionId: `gid://shopify/AppSubscription/dev-${Date.now()}`,
      });
      await setShopPlanStatus(shop, "active");
      return rrRedirect(withEmbeddedAppParamsFromRequest("/app?subscribed=1", request));
    }

    try {
      const returnUrl = buildShopifyAdminAppUrl({
        shop,
        path: "/app?subscribed=1",
        request,
      });
      await createSubscription(billing, returnUrl, billingCycle);
      return null;
    } catch (e) {
      if (e instanceof Response) throw e;
      return { error: e.message, billingUnavailable: !!e.isBillingUnavailable };
    }
  }

  if (intent === "cancel") {
    const subscriptionId = formData.get("subscriptionId");
    try {
      const nextSubscription = await cancelSubscription(billing, shop, subscriptionId);
      await setShopPlanStatus(shop, nextSubscription?.plan ? "active" : "free");
      return rrRedirect(withEmbeddedAppParamsFromRequest("/app/pricing?cancelled=1", request));
    } catch (e) {
      return { error: e.message };
    }
  }

  return { error: "Unknown intent" };
};

/* ── Plan definitions (UI) ──────────────────────────────────────── */

const PLAN_UI = [
  {
    key:      "FREE",
    name:     "Free",
    price:    0,
    priceLabel: "Forever free",
    highlight: false,
    orderLimit: ORDER_LIMITS.FREE,
    features: [
      `${ORDER_LIMITS.FREE} orders/month`,
      "Basic email support",
      "Unlimited single combo product",
      "Unlimited specific combo product",
      "Multi-currency support for discounts",
    ],
    cta: "Start free",
    badge: null,
  },
  {
    key:      "BASIC",
    name:     "Basic",
    price:    BASIC_PRICE,
    priceLabel: "/month",
    highlight: false,
    orderLimit: ORDER_LIMITS.BASIC,
    features: [
      `${ORDER_LIMITS.BASIC} orders/month`,
      "Email & live support",
      "Onboarding chat support",
      "Unlimited single combo product",
      "Unlimited specific combo product",
    ],
    cta: "Start Basic",
    badge: null,
  },
  {
    key:      "ADVANCE",
    name:     "Advance",
    price:    ADVANCE_PRICE,
    priceLabel: "/month",
    highlight: true,
    orderLimit: ORDER_LIMITS.ADVANCE,
    features: [
      `${ORDER_LIMITS.ADVANCE} orders/month`,
      "Email support",
      "Priority & developer support",
      "Unlimited single combo product",
      "Unlimited specific combo product",
    ],
    cta: "Start Advance",
    badge: "Popular",
  },
  {
    key:      "PLUS",
    name:     "Plus",
    price:    PLUS_PRICE,
    priceLabel: "/month",
    highlight: false,
    orderLimit: ORDER_LIMITS.PLUS,
    features: [
      "Unlimited orders",
      "Highest-priority support",
      "Unlimited single combo product",
      "Unlimited specific combo product",
      "Guided bundles",
    ],
    cta: "Start Plus",
    badge: null,
  },
];

/* ── Helpers ─────────────────────────────────────────────────────── */

const PLAN_TIER = { FREE: 0, BASIC: 1, ADVANCE: 2, PLUS: 3, PRO: 3 };

function currentPlanKey(subscription) {
  if (!subscription) return null;
  const plan = String(subscription.plan || "").toUpperCase();
  const status = String(subscription.status || "").toUpperCase();
  const isActiveStatus = status === "ACTIVE";
  const isCancelledWithAccess =
    status === "CANCELLED" &&
    subscription.currentPeriodEnd &&
    new Date(subscription.currentPeriodEnd).getTime() > Date.now();

  if (!isActiveStatus && !isCancelledWithAccess) return null;
  if (plan === "FREE")    return "FREE";
  if (plan === "BASIC")   return "BASIC";
  if (plan === "ADVANCE") return "ADVANCE";
  if (plan === "PRO")     return "PLUS";
  if (plan === "PLUS")    return "PLUS";
  return null;
}

function isLowerTierThanActive(planKey, activePlanKey) {
  if (!activePlanKey) return false;
  return (PLAN_TIER[planKey] ?? 0) < (PLAN_TIER[activePlanKey] ?? 0);
}

/* ── Plan Card ───────────────────────────────────────────────────── */

function PlanCard({ plan, activePlanKey, subscription, isSubmitting, submittingPlan, trialDays }) {
  const isActive   = activePlanKey === plan.key;
  const isFree     = plan.key === "FREE";
  const isDisabled = isActive || isLowerTierThanActive(plan.key, activePlanKey);

  const disabledBtnStyle = {
    width: "100%", padding: "14px", borderRadius: "10px", border: "none",
    fontSize: "14px", fontWeight: "700", textAlign: "center", cursor: "default",
    background: "#e5e7eb", color: "#9ca3af", opacity: 0.85,
  };

  let btn;

  if (isActive) {
    btn = (
      <button disabled aria-label={`${plan.name} — current plan`} style={{ ...disabledBtnStyle, background: "#6b7280", color: "#fff" }}>
        Current plan
      </button>
    );
  } else if (isDisabled) {
    btn = (
      <button disabled aria-label={`${plan.name} — included in your current plan`} style={disabledBtnStyle}>
        Not available
      </button>
    );
  } else if (isFree) {
    const busy = isSubmitting && submittingPlan === "free";
    btn = (
      <form method="post" aria-label="Select Free plan">
        <input type="hidden" name="intent" value="free" />
        <button
          type="submit"
          disabled={busy}
          aria-label="Start free plan"
          style={{
            width: "100%", padding: "14px", borderRadius: "10px", border: "none",
            fontSize: "14px", fontWeight: "700", textAlign: "center",
            cursor: busy ? "wait" : "pointer", background: "#111827",
            color: "#fff", opacity: busy ? 0.8 : 1, transition: "opacity 0.2s",
          }}
        >
          {busy ? "Starting…" : plan.cta}
        </button>
      </form>
    );
  } else {
    const busy = isSubmitting && submittingPlan === plan.key;
    btn = (
      <form method="post" aria-label={`Select ${plan.name} plan`}>
        <input type="hidden" name="intent"    value="subscribe" />
        <input type="hidden" name="planKey"   value={plan.key} />
        <input type="hidden" name="billingCycle" value="monthly" />
        <button
          type="submit"
          disabled={busy}
          aria-label={`Subscribe to ${plan.name} plan at $${plan.price}/month`}
          style={{
            width: "100%", padding: "14px", borderRadius: "10px", border: "none",
            fontSize: "14px", fontWeight: "700", textAlign: "center",
            cursor: busy ? "wait" : "pointer",
            background: plan.highlight ? "#2A7A4F" : "#111827",
            color: "#fff", opacity: busy ? 0.8 : 1, transition: "opacity 0.2s",
          }}
        >
          {busy ? "Preparing billing…" : plan.cta}
        </button>
      </form>
    );
  }

  return (
    <Card background={plan.highlight ? "bg-surface-active" : undefined}>
      <BlockStack gap="400">
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingLg">{plan.name}</Text>
            {plan.badge && <Badge tone="success">{plan.badge}</Badge>}
            {isActive && <Badge tone="info">Active</Badge>}
          </InlineStack>

          {isFree ? (
            <>
              <Text as="p" variant="heading2xl" aria-label="Free plan — no cost">$0</Text>
              <Text as="p" tone="subdued">{plan.priceLabel}</Text>
            </>
          ) : (
            <>
              <Text as="p" variant="heading2xl" aria-label={`$${plan.price} per month`}>
                ${plan.price}
              </Text>
              <Text as="p" tone="subdued">{plan.priceLabel}</Text>
              {trialDays > 0 && !isActive && (
                <Badge tone="info">{trialDays}-day free trial</Badge>
              )}
            </>
          )}

          <Text as="p" tone="subdued" fontWeight="semibold">
            {plan.orderLimit === Infinity
              ? "Unlimited orders"
              : `Up to ${plan.orderLimit} orders/month`}
          </Text>
        </BlockStack>

        <Divider />

        <BlockStack gap="200">
          {plan.features.map((f) => (
            <InlineStack key={f} gap="200" blockAlign="center">
              <Text as="span" tone="success">✓</Text>
              <Text as="p">{f}</Text>
            </InlineStack>
          ))}
        </BlockStack>

        <Box paddingBlockStart="200">{btn}</Box>
      </BlockStack>
    </Card>
  );
}

/* ── Page ────────────────────────────────────────────────────────── */

export default function PricingPage() {
  const {
    subscription,
    billingUnavailable,
    isDevMode,
    subscribed,
    cancelled,
    trialDays,
  } = useLoaderData();

  const actionData  = useActionData();
  const navigation  = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const submittingIntent = navigation.formData?.get("intent");
  const submittingPlan   = submittingIntent === "subscribe"
    ? navigation.formData?.get("planKey")
    : submittingIntent === "free" ? "free" : null;

  const activePlanKey = currentPlanKey(subscription);
  const isPaid = activePlanKey && activePlanKey !== "FREE";

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    let changed = false;
    for (const key of ["subscribed", "cancelled"]) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    if (changed) {
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    }
  }, [subscribed, cancelled]);

  return (
    <Page
      title="Plans & Pricing"
      subtitle="Choose the plan that fits your store's growth"
    >
      <BlockStack gap="500">

        {/* ── Banners ── */}
        {isDevMode && (
          <Banner tone="info" title="Billing bypass active">
            <p><code>SKIP_BILLING=true</code> is set — subscriptions activate instantly.</p>
          </Banner>
        )}
        {actionData?.error && (
          <Banner tone="critical" title="Billing error">
            <p>{actionData.error}</p>
          </Banner>
        )}
        {subscribed && (
          <Banner tone="success" title="Plan activated!">
            <p>All features for your new plan are now unlocked.</p>
          </Banner>
        )}
        {cancelled && (
          <Banner tone="warning" title="Subscription cancelled">
            <p>Any remaining billing period will still be honoured automatically.</p>
          </Banner>
        )}
        {billingUnavailable && (
          <Banner tone="warning" title="Billing API unavailable">
            <p>
              Set the app to <strong>Public Distribution</strong> in the Shopify Partner Dashboard
              to enable paid plans. During development, add <code>SKIP_BILLING=true</code> to
              your <code>.env</code>.
            </p>
          </Banner>
        )}
        {subscription && activePlanKey && (
          <Banner
            tone={isPaid ? "success" : "info"}
            title={`Active: ${PLAN_UI.find((p) => p.key === activePlanKey)?.name || activePlanKey} Plan`}
          >
            <InlineStack gap="400" blockAlign="center">
              <Text as="p">
                {isPaid && subscription.currentPeriodEnd
                  ? `Renews ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}`
                  : "Upgrade anytime to unlock more features."}
              </Text>
              {isPaid && (
                <form method="post" style={{ display: "inline" }}>
                  <input type="hidden" name="intent" value="cancel" />
                  <input type="hidden" name="subscriptionId" value={subscription?.subscriptionId || ""} />
                  <button
                    type="submit"
                    disabled={isSubmitting && submittingIntent === "cancel"}
                    aria-label="Cancel current plan subscription"
                    style={{
                      padding: "6px 14px",
                      borderRadius: "6px",
                      border: "1px solid #d1d5db",
                      background: "#fff",
                      color: "#374151",
                      fontSize: "12px",
                      fontWeight: "500",
                      cursor: "pointer",
                    }}
                  >
                    {isSubmitting && submittingIntent === "cancel" ? "Cancelling…" : "Cancel plan"}
                  </button>
                </form>
              )}
            </InlineStack>
          </Banner>
        )}

        {/* ── Order limit info ── */}
        <Banner tone="info" title="How order limits work">
          <p>
            When your store reaches the monthly order limit for your plan, an upgrade prompt
            appears automatically. Upgrade anytime to increase your limit.
          </p>
        </Banner>

        {/* ── Plan cards ── */}
        <InlineGrid columns={{ xs: 1, sm: 2, md: 2, lg: 4 }} gap="400">
          {PLAN_UI.map((plan) => (
            <PlanCard
              key={plan.key}
              plan={plan}
              activePlanKey={activePlanKey}
              subscription={subscription}
              isSubmitting={isSubmitting}
              submittingPlan={submittingPlan}
              trialDays={trialDays}
            />
          ))}
        </InlineGrid>

        {/* ── Feature comparison table ── */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Plan comparison</Text>
            <Divider />
            <div
              role="table"
              aria-label="Plan feature comparison"
              style={{ overflowX: "auto" }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "10px 12px", borderBottom: "1px solid #e5e7eb", color: "#374151", fontWeight: "700" }}>
                      Feature
                    </th>
                    {PLAN_UI.map((p) => (
                      <th
                        key={p.key}
                        scope="col"
                        style={{
                          textAlign: "center",
                          padding: "10px 12px",
                          borderBottom: "1px solid #e5e7eb",
                          color: p.highlight ? "#2A7A4F" : "#374151",
                          fontWeight: "700",
                        }}
                      >
                        {p.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    {
                      label: "Monthly order limit",
                      values: [
                        `${ORDER_LIMITS.FREE}`,
                        `${ORDER_LIMITS.BASIC}`,
                        `${ORDER_LIMITS.ADVANCE}`,
                        "Unlimited",
                      ],
                    },
                    {
                      label: "Single combo product",
                      values: ["✓", "✓", "✓", "✓"],
                    },
                    {
                      label: "Specific combo product",
                      values: ["✓", "✓", "✓", "✓"],
                    },
                    {
                      label: "Multi-currency discounts",
                      values: ["✓", "—", "—", "—"],
                    },
                    {
                      label: "Support",
                      values: [
                        "Basic email",
                        "Email & live chat",
                        "Priority & developer",
                        "Highest-priority",
                      ],
                    },
                    {
                      label: "Onboarding chat",
                      values: ["—", "✓", "—", "—"],
                    },
                    {
                      label: "Guided bundles",
                      values: ["—", "—", "—", "✓"],
                    },
                  ].map((row) => (
                    <tr key={row.label} style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <td style={{ padding: "10px 12px", color: "#374151", fontWeight: "500" }}>{row.label}</td>
                      {row.values.map((v, i) => (
                        <td
                          key={i}
                          style={{
                            textAlign: "center",
                            padding: "10px 12px",
                            color: v === "✓" ? "#059669" : v === "—" ? "#9ca3af" : "#374151",
                            fontWeight: v === "✓" ? "700" : "400",
                          }}
                        >
                          {v}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </BlockStack>
        </Card>

      </BlockStack>
    </Page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (h) => boundary.headers(h);
