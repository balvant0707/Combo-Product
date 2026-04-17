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
  BASIC_YEARLY_PRICE,
  ADVANCE_YEARLY_PRICE,
  PLUS_YEARLY_PRICE,
  getOrderLimitForPlan,
  getBillingCycleForPlanName,
} from "../config/billing";

/* ── Loader ─────────────────────────────────────────────────────── */

export const loader = async ({ request }) => {
  const { billing, session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);

  const { syncSubscription, getActiveShopifySubscription } = await import("../models/billing.server.js");
  const { activatePaidPlan } = await import("../models/subscription.server.js");

  const { subscription, billingUnavailable } = await syncSubscription(billing, shop);
  const activeShopifySubscription = await getActiveShopifySubscription(billing).catch(() => null);
  const activeBillingCycle = activeShopifySubscription?.name
    ? getBillingCycleForPlanName(activeShopifySubscription.name)
    : "monthly";
  const isDevMode = process.env.SKIP_BILLING === "true";

  if (
    url.searchParams.get("subscribed") === "1" &&
    (
      (subscription?.plan && String(subscription.plan).toUpperCase() !== "FREE") ||
      subscription?.subscriptionId ||
      activeShopifySubscription?.id
    )
  ) {
    await activatePaidPlan(shop, {
      plan: (subscription?.plan && String(subscription.plan).toUpperCase() !== "FREE")
        ? subscription.plan
        : "PLUS",
      subscriptionId: subscription?.subscriptionId || activeShopifySubscription?.id || null,
      currentPeriodEnd: subscription?.currentPeriodEnd || activeShopifySubscription?.currentPeriodEnd || null,
    }).catch(() => {});
    return rrRedirect(withEmbeddedAppParamsFromRequest("/app?subscribed=1", request));
  }

  const { getAnalytics } = await import("../models/orders.server.js");
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthlyAnalytics = await getAnalytics(
    shop,
    monthStart.toISOString().slice(0, 10),
    now.toISOString().slice(0, 10),
  );
  const monthlyOrderCount = monthlyAnalytics.totalOrders || 0;
  const toClientLimit = (limitValue) => (Number.isFinite(limitValue) ? limitValue : null);
  const orderLimitsByCycle = {
    monthly: {
      FREE: toClientLimit(getOrderLimitForPlan("FREE", "monthly")),
      BASIC: toClientLimit(getOrderLimitForPlan("BASIC", "monthly")),
      ADVANCE: toClientLimit(getOrderLimitForPlan("ADVANCE", "monthly")),
      PLUS: toClientLimit(getOrderLimitForPlan("PLUS", "monthly")),
    },
    yearly: {
      FREE: toClientLimit(getOrderLimitForPlan("FREE", "yearly")),
      BASIC: toClientLimit(getOrderLimitForPlan("BASIC", "yearly")),
      ADVANCE: toClientLimit(getOrderLimitForPlan("ADVANCE", "yearly")),
      PLUS: toClientLimit(getOrderLimitForPlan("PLUS", "yearly")),
    },
  };
  const freeMonthlyLimit = orderLimitsByCycle.monthly.FREE;
  const freePlanLimitReached =
    Number.isFinite(freeMonthlyLimit) && monthlyOrderCount >= freeMonthlyLimit;

  return {
    subscription,
    billingUnavailable: !isDevMode && billingUnavailable,
    isDevMode,
    monthlyOrderCount,
    freePlanLimitReached,
    orderLimitsByCycle,
    activeBillingCycle,
    subscribed: url.searchParams.get("subscribed") === "1",
    cancelled: url.searchParams.get("cancelled") === "1",
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
    return rrRedirect(withEmbeddedAppParamsFromRequest("/app", request));
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
      const billingRequest = await createSubscription(billing, returnUrl, billingCycle, planKey);
      if (billingRequest instanceof Response) return billingRequest;
      if (typeof billingRequest === "string" && /^https?:\/\//i.test(billingRequest)) {
        return { confirmationUrl: billingRequest };
      }
      if (
        billingRequest &&
        typeof billingRequest === "object" &&
        typeof billingRequest.confirmationUrl === "string"
      ) {
        return { confirmationUrl: billingRequest.confirmationUrl };
      }
      return { error: "Unable to start Shopify billing. Please retry." };
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
    paymentMethod: "No payment required",
    highlight: false,
    features: [
      "Unlimited Simple Box",
      "Unlimited Specific Box",
      "Basic email support",
    ],
    cta: "Start free",
    badge: null,
  },
  {
    key:      "BASIC",
    name:     "Basic",
    price:    BASIC_PRICE,
    yearlyPrice: BASIC_YEARLY_PRICE,
    priceLabel: "/month",
    paymentMethod: "Shopify Billing (card on file)",
    highlight: false,
    features: [
      "Unlimited Simple Box",
      "Unlimited Specific Box",
      "Email & live support",
    ],
    cta: "Start Basic",
    badge: null,
  },
  {
    key:      "ADVANCE",
    name:     "Advance",
    price:    ADVANCE_PRICE,
    yearlyPrice: ADVANCE_YEARLY_PRICE,
    priceLabel: "/month",
    paymentMethod: "Shopify Billing (card on file)",
    highlight: true,
    features: [
      "Unlimited Simple Box",
      "Unlimited Specific Box",
      "Priority & developer support",
    ],
    cta: "Start Advance",
    badge: "Popular",
  },
  {
    key:      "PLUS",
    name:     "Plus",
    price:    PLUS_PRICE,
    yearlyPrice: PLUS_YEARLY_PRICE,
    priceLabel: "/month",
    paymentMethod: "Shopify Billing (card on file)",
    highlight: false,
    features: [
      "Unlimited Simple Box",
      "Unlimited Specific Box",
      "Setup support",
      "Highest priority support",
    ],
    cta: "Start Plus",
    badge: null,
  },
];

/* ── Helpers ─────────────────────────────────────────────────────── */

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

function getPlanLimit(orderLimitsByCycle, planKey, billingCycle) {
  return orderLimitsByCycle?.[billingCycle]?.[planKey] ?? null;
}

/* ── Plan Card ───────────────────────────────────────────────────── */

function PlanCard({
  plan,
  activePlanKey,
  activeBillingCycle,
  isSubmitting,
  submittingPlan,
  billingCycle,
  maxFeatureCount,
  orderLimitsByCycle,
}) {
  const displayOrderLimit = getPlanLimit(orderLimitsByCycle, plan.key, billingCycle);
  const isActive = plan.key === "FREE"
    ? activePlanKey === plan.key
    : activePlanKey === plan.key && activeBillingCycle === billingCycle;
  const isFree     = plan.key === "FREE";
  const isYearly = billingCycle === "yearly";
  const displayPrice = isYearly && !isFree ? plan.yearlyPrice : plan.price;
  const displayPriceLabel = isYearly && !isFree ? "/year (2 months free)" : plan.priceLabel;
  const displayFeatures = [
    displayOrderLimit == null
      ? "Unlimited orders"
      : `${displayOrderLimit} orders/${isYearly ? "year" : "month"}`,
    ...plan.features,
  ];

  const disabledBtnStyle = {
    width: "100%", padding: "14px", border: "none",
    fontSize: "14px", fontWeight: "700", textAlign: "center", cursor: "default",
    borderRadius: "0", background: "#e5e7eb", color: "#9ca3af", opacity: 0.85,
  };

  let btn;

  if (isActive) {
    btn = (
      <button disabled aria-label={`${plan.name} — current plan`} style={{ ...disabledBtnStyle, background: "#6b7280", color: "#fff" }}>
        Current plan
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
            width: "100%", padding: "14px", borderRadius: "0", border: "none",
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
        <input type="hidden" name="billingCycle" value={billingCycle} />
        <button
          type="submit"
          disabled={busy}
          aria-label={`Subscribe to ${plan.name} plan at $${displayPrice}/${isYearly ? "year" : "month"}`}
          style={{
            width: "100%", padding: "14px", borderRadius: "0", border: "none",
            fontSize: "14px", fontWeight: "700", textAlign: "center",
            cursor: busy ? "wait" : "pointer",
            background: plan.highlight ? "#2A7A4F" : "#111827",
            color: "#fff", opacity: busy ? 0.8 : 1, transition: "opacity 0.2s",
          }}
        >
          {busy ? "Preparing billing..." : `${plan.cta}${isYearly ? " (Yearly)" : ""}`}
        </button>
      </form>
    );
  }

  return (
    <div className="cb-plan-card">
      <Card background={plan.highlight ? "bg-surface-active" : undefined}>
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <div className="cb-plan-content" style={{ flex: 1 }}>
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
              <Text as="p" variant="heading2xl" aria-label={`$${displayPrice} per ${isYearly ? "year" : "month"}`}>
                ${displayPrice}
              </Text>
              <Text as="p" tone="subdued">{displayPriceLabel}</Text>
            </>
          )}

          <Text as="p" tone="subdued" fontWeight="semibold">
            {displayOrderLimit == null
              ? "Unlimited orders"
              : `Up to ${displayOrderLimit} orders/${isYearly ? "year" : "month"}`}
          </Text>
          <Text as="p" tone="subdued" variant="bodySm">
            {plan.paymentMethod}
          </Text>
        </BlockStack>

        <Divider />

        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <BlockStack gap="200">
                {displayFeatures.map((f) => (
                  <InlineStack key={f} gap="200" blockAlign="center">
                    <Text as="span" tone="success">✓</Text>
                    <Text as="p">{f}</Text>
                  </InlineStack>
                ))}
                {Array.from({ length: Math.max(0, maxFeatureCount - displayFeatures.length) }).map((_, idx) => (
                  <div key={`spacer-${plan.key}-${idx}`} style={{ visibility: "hidden" }} aria-hidden="true">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" tone="success">✓</Text>
                      <Text as="p">spacer</Text>
                    </InlineStack>
                  </div>
                ))}
              </BlockStack>
        </div>
            </BlockStack>
          </div>
          <div className="cb-plan-cta">{btn}</div>
        </div>
      </Card>
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────── */

export default function PricingPage() {
  const {
    subscription,
    billingUnavailable,
    isDevMode,
    monthlyOrderCount,
    freePlanLimitReached,
    orderLimitsByCycle,
    activeBillingCycle,
    subscribed,
    cancelled,
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
  const [billingCycle, setBillingCycle] = useState(activeBillingCycle || "monthly");
  const visiblePlans = billingCycle === "yearly"
    ? PLAN_UI.filter((plan) => plan.key !== "FREE")
    : PLAN_UI;
  // +1 because each card prepends the order-limit line to displayFeatures.
  const maxFeatureCount = Math.max(...visiblePlans.map((plan) => plan.features.length + 1));
  const freeMonthlyLimit = getPlanLimit(orderLimitsByCycle, "FREE", "monthly");

  useEffect(() => {
    if (actionData?.confirmationUrl) {
      window.open(actionData.confirmationUrl, "_top");
    }
  }, [actionData?.confirmationUrl]);

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
      fullWidth
    >
      <style>{`
        .cb-plan-grid .Polaris-InlineGrid {
          align-items: stretch;
        }
        .cb-plan-grid .Polaris-InlineGrid > * {
          height: 100%;
        }
        .cb-plan-card {
          height: 100%;
        }
        .cb-plan-card .Polaris-ShadowBevel {
          height: 100%;
        }
        .cb-plan-cta {
          margin-top: auto;
          padding-top: 16px;
        }
        .cb-plan-cta form {
          width: 100%;
        }
        .cb-plan-cta button {
          min-height: 46px;
          border-radius: 0 !important;
        }
      `}</style>
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
        <Banner tone="info" title="How order limits work" style={{ display: "none" }}>
          <p>
            When your store reaches the monthly order limit for your plan, an upgrade prompt
            appears automatically. Upgrade anytime to increase your limit.
          </p>
        </Banner>
        {!isPaid && (
          <Banner tone={freePlanLimitReached ? "warning" : "info"} title="Free plan status">
            <p>
              {Number.isFinite(freeMonthlyLimit)
                ? (freePlanLimitReached
                  ? `Free plan limit reached (${monthlyOrderCount}/${freeMonthlyLimit} orders this month).`
                  : `Free plan selected (${monthlyOrderCount}/${freeMonthlyLimit} orders this month).`)
                : `Free plan selected (${monthlyOrderCount} orders this month).`}
            </p>
          </Banner>
        )}

        <Card>
          <InlineStack align="space-between" blockAlign="center" wrap>
            <Text as="h2" variant="headingMd">Billing cycle</Text>
            <InlineStack gap="200">
              <Button
                variant={billingCycle === "monthly" ? "primary" : "secondary"}
                onClick={() => setBillingCycle("monthly")}
              >
                Monthly
              </Button>
              <Button
                variant={billingCycle === "yearly" ? "primary" : "secondary"}
                onClick={() => setBillingCycle("yearly")}
              >
                Yearly (2 months free)
              </Button>
            </InlineStack>
          </InlineStack>
        </Card>
        {/* ── Plan cards ── */}
        <div className="cb-plan-grid">
        <InlineGrid columns={{ xs: 1, sm: 2, md: 4, lg: 4 }} gap="400">
          {visiblePlans.map((plan) => (
            <PlanCard
              key={plan.key}
              plan={plan}
              activePlanKey={activePlanKey}
              activeBillingCycle={activeBillingCycle}
              isSubmitting={isSubmitting}
              submittingPlan={submittingPlan}
              billingCycle={billingCycle}
              maxFeatureCount={maxFeatureCount}
              orderLimitsByCycle={orderLimitsByCycle}
            />
          ))}
        </InlineGrid>
        </div>

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
                      label: billingCycle === "yearly" ? "Yearly order limit" : "Monthly order limit",
                      values: [
                        getPlanLimit(orderLimitsByCycle, "FREE", billingCycle) == null
                          ? "Unlimited"
                          : `${getPlanLimit(orderLimitsByCycle, "FREE", billingCycle)}`,
                        getPlanLimit(orderLimitsByCycle, "BASIC", billingCycle) == null
                          ? "Unlimited"
                          : `${getPlanLimit(orderLimitsByCycle, "BASIC", billingCycle)}`,
                        getPlanLimit(orderLimitsByCycle, "ADVANCE", billingCycle) == null
                          ? "Unlimited"
                          : `${getPlanLimit(orderLimitsByCycle, "ADVANCE", billingCycle)}`,
                        getPlanLimit(orderLimitsByCycle, "PLUS", billingCycle) == null
                          ? "Unlimited"
                          : `${getPlanLimit(orderLimitsByCycle, "PLUS", billingCycle)}`,
                      ],
                    },
                    {
                      label: "Simple Box",
                      values: ["✓", "✓", "✓", "✓"],
                    },
                    {
                      label: "Specific Box",
                      values: ["✓", "✓", "✓", "✓"],
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
                      label: "Setup Support",
                      values: ["—", "—", "—", "—"],
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




