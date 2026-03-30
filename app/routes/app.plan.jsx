import { redirect as rrRedirect, useActionData, useLoaderData, useNavigation, useRouteError } from "react-router";
import { useEffect } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { AdminIcon } from "../components/admin-icons";
import { withEmbeddedAppParamsFromRequest } from "../utils/embedded-app";

/* ─── Loader ─────────────────────────────────────────────────────── */

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);

  const {
    getActiveShopifySubscription,
    getBoxCount,
    FREE_BOX_LIMIT,
    PLAN_CONFIG,
  } = await import("../models/billing.server.js");
  const { setShopPlanStatus } = await import("../models/shop.server.js");

  let subscription = null;
  let billingUnavailable = false;
  const isDevMode = process.env.SKIP_BILLING === "true";

  if (!isDevMode) {
    try {
      subscription = await getActiveShopifySubscription(admin);
    } catch (e) {
      if (e.isBillingUnavailable) billingUnavailable = true;
    }
  } else {
    subscription = {
      id:               "gid://shopify/AppSubscription/dev",
      status:           "ACTIVE",
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt:        new Date().toISOString(),
      lineItems:        [{ plan: { pricingDetails: { price: { amount: String(PLAN_CONFIG.price), currencyCode: PLAN_CONFIG.currencyCode } } } }],
    };
  }

  const isPro = !!subscription && subscription.status === "ACTIVE";

  // When Shopify redirects back after billing approval, mark the shop as active
  if (url.searchParams.get("subscribed") === "1" && isPro) {
    await setShopPlanStatus(shop, "active").catch(() => {});
    return rrRedirect(withEmbeddedAppParamsFromRequest("/app?subscribed=1", request));
  }

  const boxCount = await getBoxCount(shop);

  return {
    isPro,
    isDevMode,
    billingUnavailable,
    subscription: subscription
      ? {
          id:               subscription.id,
          status:           subscription.status,
          currentPeriodEnd: subscription.currentPeriodEnd,
          createdAt:        subscription.createdAt,
          price:            subscription.lineItems?.[0]?.plan?.pricingDetails?.price?.amount,
          currencyCode:     subscription.lineItems?.[0]?.plan?.pricingDetails?.price?.currencyCode,
        }
      : null,
    boxCount,
    freeLimit:  FREE_BOX_LIMIT,
    planConfig: PLAN_CONFIG,
  };
};

/* ─── Action ─────────────────────────────────────────────────────── */

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop     = session.shop;
  const formData = await request.formData();
  const intent   = formData.get("intent");
  const requestUrl = new URL(request.url);

  const { createSubscription, cancelSubscription } =
    await import("../models/billing.server.js");
  const { setShopPlanStatus } = await import("../models/shop.server.js");

  /* ── Select Free plan ── */
  if (intent === "free") {
    await setShopPlanStatus(shop, "free").catch(() => {});
    return rrRedirect(withEmbeddedAppParamsFromRequest("/app/boxes", request));
  }

  /* ── Subscribe to Pro (monthly) ── */
  if (intent === "subscribe") {
    const isSkipBilling = process.env.SKIP_BILLING === "true";

    if (isSkipBilling) {
      // Dev mode: mark active and go straight to app
      await setShopPlanStatus(shop, "active").catch(() => {});
      return rrRedirect(withEmbeddedAppParamsFromRequest("/app?subscribed=1", request));
    }

    try {
      const returnPath = withEmbeddedAppParamsFromRequest("/app/billing-success?subscribed=1", request);
      const returnUrl = new URL(returnPath, requestUrl.origin).toString();

      const confirmationUrl = await createSubscription(admin, returnUrl);

      if (!confirmationUrl) {
        return { error: "Shopify did not return a confirmation URL. Please try again." };
      }

      return { confirmationUrl };
    } catch (e) {
      return { error: e.message, billingUnavailable: !!e.isBillingUnavailable };
    }
  }

  /* ── Cancel Pro → back to Free ── */
  if (intent === "cancel") {
    const subscriptionId = formData.get("subscriptionId");
    try {
      const nextSubscription = await cancelSubscription(admin, shop, subscriptionId);
      await setShopPlanStatus(shop, nextSubscription?.plan === "PRO" ? "active" : "free").catch(() => {});
      return rrRedirect(withEmbeddedAppParamsFromRequest("/app/plan?cancelled=1", request));
    } catch (e) {
      return { error: e.message };
    }
  }

  return { error: "Unknown intent" };
};

/* ─── UI helpers ─────────────────────────────────────────────────── */

const labelStyle = {
  fontSize: "10px",
  fontWeight: "700",
  color: "#6b7280",
  textTransform: "uppercase",
  letterSpacing: "0.07em",
  display: "block",
  marginBottom: "4px",
};

function CheckRow({ children }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", marginBottom: "10px" }}>
      <span style={{
        width: "20px", height: "20px", borderRadius: "50%", flexShrink: 0, marginTop: "1px",
        background: "#111827", display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
          <path d="M1 4l2.5 2.5L9 1" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span style={{ fontSize: "13px", color: "#374151", lineHeight: 1.5 }}>{children}</span>
    </div>
  );
}

function MutedRow({ children }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", marginBottom: "10px" }}>
      <span style={{
        width: "20px", height: "20px", borderRadius: "50%", flexShrink: 0, marginTop: "1px",
        background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <svg width="8" height="2" viewBox="0 0 8 2" fill="none">
          <path d="M1 1h6" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
      <span style={{ fontSize: "13px", color: "#9ca3af", lineHeight: 1.5 }}>{children}</span>
    </div>
  );
}

/* ─── Component ──────────────────────────────────────────────────── */

export default function PlanPage() {
  const { isPro, isDevMode, billingUnavailable, subscription, boxCount, freeLimit, planConfig } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const isBillingUnavailable = !isDevMode && (billingUnavailable || actionData?.billingUnavailable);
  const url            = new URL(typeof window !== "undefined" ? window.location.href : "http://localhost");
  const justSubscribed = url.searchParams.get("subscribed") === "1";
  const justCancelled  = url.searchParams.get("cancelled")  === "1";

  // When the action returns a Shopify billing confirmation URL, navigate the
  // TOP frame to it. Using window.open(_top) is the only reliable way to
  // escape the embedded iframe and reach Shopify's billing page.
  useEffect(() => {
    if (actionData?.confirmationUrl) {
      window.open(actionData.confirmationUrl, "_top");
    }
  }, [actionData?.confirmationUrl]);

  return (
    <div style={{ maxWidth: "820px", margin: "0 auto", padding: "28px 20px" }}>

      {/* ── Title ── */}
      <div style={{ marginBottom: "24px" }}>
        <div style={{ fontSize: "22px", fontWeight: "800", color: "#111827", letterSpacing: "-0.5px" }}>
          Plan options
        </div>
      </div>

      {/* ── Dev mode notice (SKIP_BILLING=true) ── */}
      {isDevMode && (
        <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "8px", padding: "12px 16px", marginBottom: "20px", display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "16px", flexShrink: 0 }}>🛠️</span>
          <div style={{ fontSize: "12px", color: "#1e40af", lineHeight: 1.6 }}>
            <strong>Billing bypass active</strong> — <code style={{ background: "#dbeafe", borderRadius: "3px", padding: "1px 5px", fontSize: "11px" }}>SKIP_BILLING=true</code> is set in <code style={{ background: "#dbeafe", borderRadius: "3px", padding: "1px 5px", fontSize: "11px" }}>.env</code>.
            All shops are granted the <strong>{planConfig ? "Pro" : "configured"} plan</strong> without charge.
            Remove <code style={{ background: "#dbeafe", borderRadius: "3px", padding: "1px 5px", fontSize: "11px" }}>SKIP_BILLING</code> once your app has Public Distribution approved.
          </div>
        </div>
      )}

      {/* ── Billing unavailable banner (public distribution not yet approved) ── */}
      {isBillingUnavailable && (
        <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "8px", padding: "16px 18px", marginBottom: "20px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
            <span style={{ fontSize: "20px", flexShrink: 0 }}>⚠️</span>
            <div>
              <div style={{ fontSize: "13px", fontWeight: "700", color: "#92400e", marginBottom: "6px" }}>
                Billing API not available — Public Distribution required
              </div>
              <div style={{ fontSize: "12px", color: "#78350f", lineHeight: 1.7 }}>
                Shopify's Billing API only works for apps with <strong>Public</strong> distribution.
                Your app is currently set to <strong>Custom / Development</strong>. To fix this:
              </div>
              <ol style={{ fontSize: "12px", color: "#78350f", margin: "10px 0 0 0", paddingLeft: "18px", lineHeight: 2 }}>
                <li>Open your <strong>Shopify Partner Dashboard</strong></li>
                <li>Go to <strong>Apps → {`<your app>`} → Distribution</strong></li>
                <li>Change distribution to <strong>Public</strong></li>
                <li>Save and redeploy the app</li>
              </ol>
              <div style={{ marginTop: "10px", fontSize: "11px", color: "#92400e", background: "#fef3c7", borderRadius: "5px", padding: "6px 10px", display: "inline-block" }}>
                Quick fix: add <code style={{ background: "#fef3c7" }}>SKIP_BILLING=true</code> to your <code style={{ background: "#fef3c7" }}>.env</code> to bypass billing during development.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Success banners ── */}
      {justSubscribed && (
        <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "8px", padding: "14px 16px", marginBottom: "20px", display: "flex", alignItems: "center", gap: "10px" }}>
          <AdminIcon type="check" size="small" style={{ color: "#16a34a" }} />
          <div style={{ fontSize: "13px", fontWeight: "600", color: "#15803d" }}>
            You're now on the Pro plan! All features are unlocked.
          </div>
        </div>
      )}
      {justCancelled && (
        <div style={{ background: "#fefce8", border: "1px solid #fde047", borderRadius: "8px", padding: "14px 16px", marginBottom: "20px", display: "flex", alignItems: "center", gap: "10px" }}>
          <AdminIcon type="info" size="small" style={{ color: "#ca8a04" }} />
          <div style={{ fontSize: "13px", fontWeight: "600", color: "#854d0e" }}>
            Subscription cancelled. Your Pro access continues until the end of the billing period.
          </div>
        </div>
      )}
      {actionData?.error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", padding: "14px 16px", marginBottom: "20px" }}>
          <span style={{ fontSize: "13px", color: "#b91c1c" }}>Error: {actionData.error}</span>
        </div>
      )}

      {/* ── Plan cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>

        {/* Free card */}
        <div style={{ background: "#fff", border: `2px solid ${!isPro ? "#111827" : "#e5e7eb"}`, borderRadius: "12px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "24px", flex: 1, position: "relative" }}>
            {!isPro && (
              <div style={{ position: "absolute", top: "16px", right: "16px", fontSize: "10px", fontWeight: "700", background: "#f3f4f6", color: "#374151", borderRadius: "6px", padding: "3px 10px", letterSpacing: "0.05em", border: "1px solid #e5e7eb" }}>
                CURRENT
              </div>
            )}
            <div style={{ fontSize: "18px", fontWeight: "700", color: "#111827", marginBottom: "4px" }}>Free</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "4px", marginBottom: "4px" }}>
              <span style={{ fontSize: "36px", fontWeight: "800", color: "#111827", lineHeight: 1 }}>$0</span>
              <span style={{ fontSize: "13px", color: "#6b7280" }}>/month</span>
            </div>
            <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "20px" }}>Good for setup, testing, and a single live combo box.</div>

            <div>
              <CheckRow>1 combo box</CheckRow>
              <CheckRow>2-step &amp; 3-step bundles</CheckRow>
              <CheckRow>Storefront widget</CheckRow>
              <CheckRow>Basic analytics</CheckRow>
              <MutedRow>Unlimited combo boxes</MutedRow>
              <MutedRow>Priority support</MutedRow>
            </div>
          </div>

          {/* Card footer */}
          <div style={{ borderTop: "1px solid #f3f4f6", background: "#f9fafb", padding: "14px 24px" }}>
            {!isPro ? (
              <form method="post">
                <input type="hidden" name="intent" value="free" />
                <button
                  type="submit"
                  style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1.5px solid #d1d5db", background: "#f9fafb", fontSize: "13px", fontWeight: "600", color: "#374151", cursor: "pointer", textAlign: "center" }}
                >
                  {isSubmitting ? "Starting…" : "Continue with Free Plan"}
                </button>
              </form>
            ) : (
              <form method="post">
                <input type="hidden" name="intent" value="cancel" />
                <input type="hidden" name="subscriptionId" value={subscription?.id || ""} />
                <button
                  type="submit"
                  style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1.5px solid #fecaca", background: "#fff5f5", fontSize: "13px", fontWeight: "600", color: "#ef4444", cursor: "pointer", textAlign: "center" }}
                >
                  {isSubmitting ? "Cancelling…" : "Cancel subscription"}
                </button>
              </form>
            )}
          </div>
        </div>

        {/* Pro card */}
        <div style={{ background: "#fff", border: `2px solid ${isPro ? "#111827" : "#e5e7eb"}`, borderRadius: "12px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "24px", flex: 1, position: "relative" }}>
            {isPro && (
              <div style={{ position: "absolute", top: "16px", right: "16px", fontSize: "10px", fontWeight: "700", background: "#f3f4f6", color: "#374151", borderRadius: "6px", padding: "3px 10px", letterSpacing: "0.05em", border: "1px solid #e5e7eb" }}>
                CURRENT
              </div>
            )}
            <div style={{ fontSize: "18px", fontWeight: "700", color: "#111827", marginBottom: "4px" }}>Pro</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "4px", marginBottom: "4px" }}>
              <span style={{ fontSize: "36px", fontWeight: "800", color: "#111827", lineHeight: 1 }}>${planConfig.price}</span>
              <span style={{ fontSize: "13px", color: "#6b7280" }}>/month</span>
            </div>
            <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "20px" }}>
              {planConfig.trialDays}-day free trial, then billed monthly through Shopify.
            </div>

            <div>
              {[
                "Unlimited combo boxes",
                "2-step & 3-step bundles",
                "Smart & manual collections",
                "Dynamic pricing & discounts",
                "Storefront widget",
                "Advanced analytics",
                "Priority support",
                "Early access to new features",
              ].map((f) => (
                <CheckRow key={f}>{f}</CheckRow>
              ))}
            </div>
          </div>

          {/* Card footer */}
          <div style={{ borderTop: "1px solid #f3f4f6", background: "#f9fafb", padding: "14px 24px" }}>
            {isPro ? (
              <div style={{ fontSize: "13px", fontWeight: "600", color: "#374151", textAlign: "center", padding: "10px" }}>
                {subscription?.currentPeriodEnd
                  ? `Pro remains active until ${new Date(subscription.currentPeriodEnd).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
                  : "Pro plan active"}
              </div>
            ) : isBillingUnavailable ? (
              <div style={{ textAlign: "center", padding: "10px", fontSize: "13px", color: "#9ca3af" }}>
                Billing unavailable — see notice above
              </div>
            ) : actionData?.confirmationUrl ? (
              <div style={{ textAlign: "center", padding: "10px", fontSize: "13px", fontWeight: "600", color: "#374151", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                <span style={{ width: "14px", height: "14px", border: "2px solid #d1d5db", borderTopColor: "#374151", borderRadius: "50%", display: "inline-block", animation: "plan-spin 0.7s linear infinite" }} />
                Opening Shopify billing…
              </div>
            ) : (
              <form method="post">
                <input type="hidden" name="intent" value="subscribe" />
                <button
                  type="submit"
                  style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "none", background: "#111827", fontSize: "13px", fontWeight: "700", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}
                >
                  {isSubmitting ? (
                    <>
                      <span style={{ width: "14px", height: "14px", border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block", animation: "plan-spin 0.7s linear infinite" }} />
                      Preparing billing…
                    </>
                  ) : (
                    `Start ${planConfig.trialDays}-Day Free Trial →`
                  )}
                </button>
              </form>
            )}
          </div>
        </div>

      </div>

      {/* ── FAQ / note ── */}
      <div style={{ marginTop: "28px", padding: "16px 20px", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "8px" }}>
        <div style={{ fontSize: "11px", fontWeight: "700", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "10px" }}>Billing notes</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 24px" }}>
          {[
            ["Trial", `${planConfig.trialDays} days free, no charge until trial ends`],
            ["Billing cycle", "Monthly, charged to your Shopify account"],
            ["Cancel anytime", "Pro access continues until end of billing period"],
            ["Currency", `Charged in ${planConfig.currencyCode} through Shopify`],
          ].map(([k, v]) => (
            <div key={k}>
              <span style={labelStyle}>{k}</span>
              <span style={{ fontSize: "12px", color: "#374151" }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      <style>{`@keyframes plan-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
