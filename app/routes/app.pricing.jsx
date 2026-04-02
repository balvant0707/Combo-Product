/* eslint-disable react/prop-types */
/**
 * app.pricing.jsx
 * Billing page — Free / Monthly / Yearly plan selection.
 * Design: green-header cards with Monthly|Yearly toggle.
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

/* ── Sub-components ─────────────────────────────────────────────── */

function Banner({ tone, children }) {
  const colors = {
    error:   { bg: "#fef2f2", border: "#fecaca", color: "#b91c1c" },
    warning: { bg: "#fffbeb", border: "#fcd34d", color: "#92400e" },
    success: { bg: "#f0fdf4", border: "#bbf7d0", color: "#15803d" },
    info:    { bg: "#eff6ff", border: "#bfdbfe", color: "#1e40af" },
  };
  const s = colors[tone] || colors.info;
  return (
    <div style={{
      background: s.bg,
      border: `1px solid ${s.border}`,
      borderRadius: "10px",
      padding: "12px 16px",
      marginBottom: "20px",
      fontSize: "13px",
      color: s.color,
    }}>
      {children}
    </div>
  );
}

function PlanCard({ title, subtitle, priceDisplay, priceLabel, features, savingPct, button }) {
  return (
    <div style={{
      background: "#fff",
      borderRadius: "18px",
      boxShadow: "0 6px 24px rgba(0,0,0,0.11)",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      position: "relative",
    }}>
      {savingPct && (
        <div style={{
          position: "absolute",
          top: "16px",
          right: "16px",
          background: "#fff",
          color: "#111827",
          borderRadius: "999px",
          padding: "5px 14px",
          fontSize: "11px",
          fontWeight: "700",
          zIndex: 2,
          boxShadow: "0 1px 6px rgba(0,0,0,0.18)",
          letterSpacing: "0.02em",
        }}>
          {savingPct}% Saving
        </div>
      )}

      {/* Green header */}
      <div style={{
        background: "linear-gradient(145deg, #2A7A4F 0%, #1c5c38 100%)",
        padding: "28px 28px 32px",
      }}>
        <div style={{ fontSize: "15px", fontWeight: "600", color: "rgba(255,255,255,0.88)", marginBottom: "3px" }}>
          {title}
        </div>
        <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.62)", marginBottom: "18px" }}>
          {subtitle}
        </div>
        <div style={{ fontSize: "56px", fontWeight: "800", color: "#fff", lineHeight: 1, letterSpacing: "-2px" }}>
          {priceDisplay}
          {priceLabel && (
            <span style={{ fontSize: "15px", fontWeight: "500", marginLeft: "4px", opacity: 0.72, letterSpacing: 0 }}>
              {priceLabel}
            </span>
          )}
        </div>
      </div>

      {/* Feature list */}
      <div style={{ padding: "24px 28px", flex: 1 }}>
        {features.map((f) => (
          <div key={f} style={{ display: "flex", alignItems: "flex-start", gap: "12px", marginBottom: "14px" }}>
            <span style={{
              width: "11px",
              height: "11px",
              borderRadius: "50%",
              background: "#2A7A4F",
              flexShrink: 0,
              marginTop: "4px",
            }} />
            <span style={{ fontSize: "14px", color: "#374151", lineHeight: 1.5 }}>{f}</span>
          </div>
        ))}
      </div>

      {/* CTA button */}
      <div style={{ padding: "0 28px 28px" }}>
        {button}
      </div>
    </div>
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
      <button disabled style={btnStyle({ variant: "muted" })}>Current plan</button>
    );
  } else if (isPro) {
    freeBtn = (
      <div style={{ fontSize: "13px", color: "#9ca3af", textAlign: "center", padding: "14px 0" }}>
        Cancel Pro to switch to Free
      </div>
    );
  } else {
    const busy = isSubmitting && submittingIntent === "free";
    freeBtn = (
      <form method="post">
        <input type="hidden" name="intent" value="free" />
        <button type="submit" disabled={busy} style={btnStyle({ busy })}>
          {busy ? "Starting…" : "Start now"}
        </button>
      </form>
    );
  }

  /* ── Button for Pro card ── */
  let proBtn;
  if (isPro) {
    proBtn = (
      <button disabled style={btnStyle({ variant: "muted" })}>Current plan</button>
    );
  } else if (actionData?.confirmationUrl) {
    proBtn = (
      <button disabled style={btnStyle({ busy: true })}>Opening Shopify billing…</button>
    );
  } else {
    const busy = isSubmitting && submittingIntent === "subscribe";
    proBtn = (
      <form method="post">
        <input type="hidden" name="intent" value="subscribe" />
        <input type="hidden" name="billingCycle" value={billingCycle} />
        <button type="submit" disabled={busy} style={btnStyle({ busy })}>
          {busy ? "Preparing billing…" : "Start now"}
        </button>
      </form>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f0f0f0", padding: "36px 24px 60px" }}>

      {/* ── Dev mode notice ── */}
      {isDevMode && (
        <Banner tone="info">
          <strong>Billing bypass active</strong> — <code>SKIP_BILLING=true</code> is set.
          Pro activates instantly without Shopify billing.
        </Banner>
      )}

      {/* ── Error / success banners ── */}
      {actionData?.error && (
        <Banner tone="error">Billing error: {actionData.error}</Banner>
      )}
      {subscribed && (
        <Banner tone="success">
          <strong>Pro plan activated!</strong> All premium features are now unlocked.
        </Banner>
      )}
      {cancelled && (
        <Banner tone="warning">
          Subscription cancelled. Any remaining Shopify billing period will still be honored automatically.
        </Banner>
      )}
      {billingUnavailable && (
        <Banner tone="warning">
          <strong>Billing API unavailable.</strong> Set the app to{" "}
          <strong>Public Distribution</strong> in the Shopify Partner Dashboard to enable paid plans.
          During development, add <code>SKIP_BILLING=true</code> to your <code>.env</code>.
        </Banner>
      )}

      {/* ── Toggle + Cancel button row ── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        marginBottom: "36px",
      }}>
        {/* Monthly / Yearly pill */}
        <div style={{
          display: "flex",
          background: "#e5e7eb",
          borderRadius: "999px",
          padding: "4px",
          gap: "2px",
        }}>
          {["Monthly", "Yearly"].map((label) => {
            const val = label.toLowerCase();
            const active = billingCycle === val;
            return (
              <button
                key={val}
                type="button"
                onClick={() => setBillingCycle(val)}
                style={{
                  padding: "9px 32px",
                  borderRadius: "999px",
                  border: "none",
                  background: active ? "#111827" : "transparent",
                  color: active ? "#fff" : "#374151",
                  fontWeight: "600",
                  fontSize: "14px",
                  cursor: "pointer",
                  transition: "background 0.18s, color 0.18s",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Cancel current plan */}
        <div style={{ position: "absolute", right: 0 }}>
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
            <button disabled style={{
              padding: "9px 18px",
              borderRadius: "8px",
              border: "1px solid #e5e7eb",
              background: "#f9fafb",
              color: "#9ca3af",
              fontSize: "13px",
              fontWeight: "500",
              cursor: "not-allowed",
            }}>
              Cancel current plan
            </button>
          )}
        </div>
      </div>

      {/* ── Plan cards ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "24px",
      }}>
        <PlanCard
          title="Free Plan"
          subtitle="Basic access to features"
          priceDisplay="Free"
          features={FREE_FEATURES}
          button={freeBtn}
        />
        <PlanCard
          title={planTitle}
          subtitle={`${trialDays} day free trial`}
          priceDisplay={`$${displayPrice}`}
          priceLabel={priceLabel}
          features={PRO_FEATURES}
          savingPct={isYearly ? YEARLY_SAVING_PCT : null}
          button={proBtn}
        />
      </div>

    </div>
  );
}

/* ── Button style helper ─────────────────────────────────────────── */
function btnStyle({ busy = false, variant = "primary" } = {}) {
  const base = {
    width: "100%",
    padding: "14px",
    borderRadius: "10px",
    border: "none",
    fontSize: "14px",
    fontWeight: "700",
    textAlign: "center",
    cursor: busy ? "wait" : "pointer",
    transition: "opacity 0.2s",
  };
  if (variant === "muted") {
    return { ...base, background: "#6b7280", color: "#fff", cursor: "default", opacity: 0.75 };
  }
  return { ...base, background: "#111827", color: "#fff", opacity: busy ? 0.8 : 1 };
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (h) => boundary.headers(h);
