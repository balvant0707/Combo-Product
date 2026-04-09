/* eslint-disable react/prop-types */
/**
 * app.pricing.jsx
 * Billing page — Free / Monthly / Yearly plan selection.
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

/* ── Loader ─────────────────────────────────────────────────────── */

export const loader = async ({ request }) => {
  const { billing, session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);

  const { syncSubscription, getBoxCount, MONTHLY_PRICE, YEARLY_PRICE, TRIAL_DAYS } =
    await import("../models/billing.server.js");
  const { activatePaidPlan, PLANS } = await import("../models/subscription.server.js");

  const { subscription, billingUnavailable } = await syncSubscription(billing, shop);
  const isDevMode = process.env.SKIP_BILLING === "true";

  if (url.searchParams.get("subscribed") === "1" && subscription?.subscriptionId) {
    await activatePaidPlan(shop, {
      plan: subscription.plan || "PRO",
      subscriptionId: subscription.subscriptionId,
      currentPeriodEnd: subscription.currentPeriodEnd,
    }).catch(() => {});
    return rrRedirect(withEmbeddedAppParamsFromRequest("/app?subscribed=1", request));
  }

  const boxCount = await getBoxCount(shop);

  return {
    subscription,
    billingUnavailable: !isDevMode && billingUnavailable,
    isDevMode,
    boxCount,
    plans: Object.values(PLANS),
    subscribed: url.searchParams.get("subscribed") === "1",
    cancelled: url.searchParams.get("cancelled") === "1",
    monthlyPrice: MONTHLY_PRICE,
    yearlyPrice: YEARLY_PRICE,
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
    const billingCycle = formData.get("billingCycle") || "monthly";
    const isSkipBilling = process.env.SKIP_BILLING === "true";

    if (isSkipBilling) {
      await activatePaidPlan(shop, {
        plan: "PRO",
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
      await setShopPlanStatus(shop, nextSubscription?.plan === "PRO" ? "active" : "free");
      return rrRedirect(withEmbeddedAppParamsFromRequest("/app/pricing?cancelled=1", request));
    } catch (e) {
      return { error: e.message };
    }
  }

  return { error: "Unknown intent" };
};

/* ── Plan features ──────────────────────────────────────────────── */

const FREE_FEATURES = [
  "1 combo box",
  "2-step & 3-step bundles",
  "Storefront widget",
  "Basic analytics",
  "Community support",
];

const PRO_FEATURES = [
  "Unlimited combo boxes",
  "2-step & 3-step bundles",
  "Smart & manual collections",
  "Dynamic pricing & discounts",
  "Storefront widget",
  "Advanced analytics",
  "Priority support",
  "Early access to new features",
];

const YEARLY_SAVING_PCT = 18;

/* ── Helpers ─────────────────────────────────────────────────────── */

function isCurrentPaidPlan(sub) {
  return !!sub && sub.plan === "PRO" && sub.status === "ACTIVE";
}

/* ── Page ────────────────────────────────────────────────────────── */

export default function PricingPage() {
  const {
    subscription,
    billingUnavailable,
    isDevMode,
    subscribed,
    cancelled,
    monthlyPrice,
    yearlyPrice,
    trialDays,
  } = useLoaderData();

  const actionData = useActionData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const submittingIntent = navigation.formData?.get("intent");

  const [billingCycle, setBillingCycle] = useState("monthly");

  const isPro = isCurrentPaidPlan(subscription);
  const isFree = subscription?.plan === "FREE" && subscription?.status === "ACTIVE";
  const hasNoPlan = !isPro && !isFree;

  const isYearly = billingCycle === "yearly";
  const displayPrice = isYearly ? yearlyPrice : monthlyPrice;
  const priceLabel = isYearly ? "/year" : "/month";
  const planTitle = isYearly ? "Yearly Plan" : "Monthly Plan";

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
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, [subscribed, cancelled]);

  /* ── Button for Free card ── */
  let freeBtn;
  if (isFree) {
    freeBtn = (
      <button
        disabled
        style={{
          width: "100%",
          padding: "14px",
          borderRadius: "10px",
          border: "none",
          fontSize: "14px",
          fontWeight: "700",
          textAlign: "center",
          cursor: "default",
          background: "#6b7280",
          color: "#fff",
          opacity: 0.75,
        }}
      >
        Current plan
      </button>
    );
  } else if (isPro) {
    freeBtn = (
      <Text as="p" tone="subdued" alignment="center">
        Cancel Pro to switch to Free
      </Text>
    );
  } else {
    const busy = isSubmitting && submittingIntent === "free";
    freeBtn = (
      <form method="post">
        <input type="hidden" name="intent" value="free" />
        <button
          type="submit"
          disabled={busy}
          style={{
            width: "100%",
            padding: "14px",
            borderRadius: "10px",
            border: "none",
            fontSize: "14px",
            fontWeight: "700",
            textAlign: "center",
            cursor: busy ? "wait" : "pointer",
            background: "#111827",
            color: "#fff",
            opacity: busy ? 0.8 : 1,
            transition: "opacity 0.2s",
          }}
        >
          {busy ? "Starting…" : "Start now"}
        </button>
      </form>
    );
  }

  /* ── Button for Pro card ── */
  let proBtn;
  if (isPro) {
    proBtn = (
      <button
        disabled
        style={{
          width: "100%",
          padding: "14px",
          borderRadius: "10px",
          border: "none",
          fontSize: "14px",
          fontWeight: "700",
          textAlign: "center",
          cursor: "default",
          background: "#6b7280",
          color: "#fff",
          opacity: 0.75,
        }}
      >
        Current plan
      </button>
    );
  } else if (actionData?.confirmationUrl) {
    proBtn = (
      <button
        disabled
        style={{
          width: "100%",
          padding: "14px",
          borderRadius: "10px",
          border: "none",
          fontSize: "14px",
          fontWeight: "700",
          textAlign: "center",
          cursor: "wait",
          background: "#111827",
          color: "#fff",
          opacity: 0.8,
          transition: "opacity 0.2s",
        }}
      >
        Opening Shopify billing…
      </button>
    );
  } else {
    const busy = isSubmitting && submittingIntent === "subscribe";
    proBtn = (
      <form method="post">
        <input type="hidden" name="intent" value="subscribe" />
        <input type="hidden" name="billingCycle" value={billingCycle} />
        <button
          type="submit"
          disabled={busy}
          style={{
            width: "100%",
            padding: "14px",
            borderRadius: "10px",
            border: "none",
            fontSize: "14px",
            fontWeight: "700",
            textAlign: "center",
            cursor: busy ? "wait" : "pointer",
            background: "#111827",
            color: "#fff",
            opacity: busy ? 0.8 : 1,
            transition: "opacity 0.2s",
          }}
        >
          {busy ? "Preparing billing…" : "Start now"}
        </button>
      </form>
    );
  }

  return (
    <Page
      title="Plans & Pricing"
      subtitle="Choose the plan that's right for your store"
    >
      <BlockStack gap="500">

        {/* ── Banners ── */}
        {isDevMode && (
          <Banner tone="info" title="Billing bypass active">
            <p>
              <code>SKIP_BILLING=true</code> is set. Pro activates instantly without Shopify billing.
            </p>
          </Banner>
        )}
        {actionData?.error && (
          <Banner tone="critical" title="Billing error">
            <p>{actionData.error}</p>
          </Banner>
        )}
        {subscribed && (
          <Banner tone="success" title="Pro plan activated!">
            <p>All premium features are now unlocked.</p>
          </Banner>
        )}
        {cancelled && (
          <Banner tone="warning" title="Subscription cancelled">
            <p>Any remaining Shopify billing period will still be honored automatically.</p>
          </Banner>
        )}
        {billingUnavailable && (
          <Banner tone="warning" title="Billing API unavailable">
            <p>
              Set the app to <strong>Public Distribution</strong> in the Shopify Partner Dashboard
              to enable paid plans. During development, add{" "}
              <code>SKIP_BILLING=true</code> to your <code>.env</code>.
            </p>
          </Banner>
        )}
        {subscription && (
          <Banner
            tone={isPro ? "success" : "info"}
            title={isPro ? "Active: Pro Plan" : "Active: Free Plan"}
          >
            <p>
              {isPro
                ? `Renews ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}`
                : "Upgrade to Pro to unlock all features."}
            </p>
          </Banner>
        )}

        {/* ── Billing cycle toggle + cancel button ── */}
        <InlineStack align="center" blockAlign="center" gap="400">
          <InlineStack gap="0">
            {["monthly", "yearly"].map((val) => {
              const active = billingCycle === val;
              return (
                <button
                  key={val}
                  type="button"
                  onClick={() => setBillingCycle(val)}
                  style={{
                    padding: "9px 32px",
                    borderRadius: val === "monthly" ? "999px 0 0 999px" : "0 999px 999px 0",
                    border: "none",
                    background: active ? "#111827" : "#e5e7eb",
                    color: active ? "#fff" : "#374151",
                    fontWeight: "600",
                    fontSize: "14px",
                    cursor: "pointer",
                    transition: "background 0.18s, color 0.18s",
                  }}
                >
                  {val === "monthly" ? "Monthly" : `Yearly (save ${YEARLY_SAVING_PCT}%)`}
                </button>
              );
            })}
          </InlineStack>

          {isPro ? (
            <form method="post">
              <input type="hidden" name="intent" value="cancel" />
              <input type="hidden" name="subscriptionId" value={subscription?.subscriptionId || ""} />
              <button
                type="submit"
                disabled={isSubmitting && submittingIntent === "cancel"}
                style={{
                  padding: "9px 18px",
                  borderRadius: "8px",
                  border: "1px solid #d1d5db",
                  background: "#fff",
                  color: "#374151",
                  fontSize: "13px",
                  fontWeight: "500",
                  cursor: "pointer",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                }}
              >
                {isSubmitting && submittingIntent === "cancel" ? "Cancelling…" : "Cancel current plan"}
              </button>
            </form>
          ) : (
            <button
              disabled
              style={{
                padding: "9px 18px",
                borderRadius: "8px",
                border: "1px solid #e5e7eb",
                background: "#f9fafb",
                color: "#9ca3af",
                fontSize: "13px",
                fontWeight: "500",
                cursor: "not-allowed",
              }}
            >
              Cancel current plan
            </button>
          )}
        </InlineStack>

        {/* ── Plan cards ── */}
        <InlineGrid columns={{ xs: 1, md: 2 }} gap="600">

          {/* Free Plan Card */}
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="200">
                <Text as="h2" variant="headingLg">Free Plan</Text>
                <Text as="p" tone="subdued">Up to 1 combo box, no credit card needed</Text>
                <Text as="p" variant="heading2xl">₹0</Text>
                <Text as="p" tone="subdued">Forever free</Text>
              </BlockStack>
              <Divider />
              <BlockStack gap="200">
                {FREE_FEATURES.map((f) => (
                  <InlineStack key={f} gap="200" blockAlign="center">
                    <Text as="span" tone="success">✓</Text>
                    <Text as="p">{f}</Text>
                  </InlineStack>
                ))}
              </BlockStack>
              <Box paddingBlockStart="200">
                {freeBtn}
              </Box>
            </BlockStack>
          </Card>

          {/* Pro Plan Card */}
          <Card background="bg-surface-active">
            <BlockStack gap="400">
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingLg">Pro Plan</Text>
                  {isYearly && <Badge tone="success">Save {YEARLY_SAVING_PCT}%</Badge>}
                </InlineStack>
                <Text as="p" tone="subdued">{planTitle} — Unlimited everything</Text>
                <Text as="p" variant="heading2xl">₹{displayPrice}</Text>
                <Text as="p" tone="subdued">{priceLabel}</Text>
                {trialDays > 0 && !isPro && (
                  <Badge tone="info">{trialDays}-day free trial</Badge>
                )}
              </BlockStack>
              <Divider />
              <BlockStack gap="200">
                {PRO_FEATURES.map((f) => (
                  <InlineStack key={f} gap="200" blockAlign="center">
                    <Text as="span" tone="success">✓</Text>
                    <Text as="p">{f}</Text>
                  </InlineStack>
                ))}
              </BlockStack>
              <Box paddingBlockStart="200">
                {proBtn}
              </Box>
            </BlockStack>
          </Card>

        </InlineGrid>
      </BlockStack>
    </Page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (h) => boundary.headers(h);
