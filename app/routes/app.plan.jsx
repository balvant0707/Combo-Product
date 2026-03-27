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
      await cancelSubscription(admin, shop, subscriptionId);
      await setShopPlanStatus(shop, "free").catch(() => {});
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

function CheckRow({ children, muted = false }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", marginBottom: "10px" }}>
      <span style={{
        width: "18px", height: "18px", borderRadius: "50%", flexShrink: 0, marginTop: "1px",
        background: muted ? "#f3f4f6" : "#000", display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
          <path d="M1 4l2.5 2.5L9 1" stroke={muted ? "#9ca3af" : "#fff"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span style={{ fontSize: "13px", color: muted ? "#9ca3af" : "#374151", lineHeight: 1.5 }}>{children}</span>
    </div>
  );
}

function CrossRow({ children }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", marginBottom: "10px" }}>
      <span style={{
        width: "18px", height: "18px", borderRadius: "50%", flexShrink: 0, marginTop: "1px",
        background: "#fee2e2", display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
          <path d="M1 1l6 6M7 1L1 7" stroke="#ef4444" strokeWidth="1.8" strokeLinecap="round" />
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
          Pricing Plans
        </div>
        <div style={{ fontSize: "13px", color: "#6b7280", marginTop: "4px" }}>
          Choose the plan that fits your store
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

      {/* ── Current status bar ── */}
      <div style={{ background: isPro ? "#000" : "#f9fafb", border: `1px solid ${isPro ? "#000" : "#e5e7eb"}`, borderRadius: "10px", padding: "16px 20px", marginBottom: "28px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "38px", height: "38px", borderRadius: "50%", background: isPro ? "rgba(255,255,255,0.15)" : "#e5e7eb", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <AdminIcon type={isPro ? "star" : "box"} size="small" style={{ color: isPro ? "#fff" : "#6b7280" }} />
          </div>
          <div>
            <div style={{ fontSize: "14px", fontWeight: "700", color: isPro ? "#fff" : "#111827" }}>
              {isPro ? "Pro Plan — Active" : "Free Plan"}
            </div>
            <div style={{ fontSize: "12px", color: isPro ? "rgba(255,255,255,0.65)" : "#6b7280", marginTop: "2px" }}>
              {isPro
                ? `Renews on ${subscription?.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"}`
                : `${boxCount} / ${freeLimit} combo box used`}
            </div>
          </div>
        </div>
        {isPro && (
          <div style={{ fontSize: "12px", fontWeight: "700", color: "#fff", background: "rgba(255,255,255,0.15)", borderRadius: "20px", padding: "4px 14px", border: "1px solid rgba(255,255,255,0.25)" }}>
            ✦ PRO
          </div>
        )}
        {!isPro && (
          <div style={{ fontSize: "12px", color: "#6b7280", background: "#e5e7eb", borderRadius: "20px", padding: "4px 14px" }}>
            FREE
          </div>
        )}
      </div>

      {/* ── Plan cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>

        {/* Free card */}
        <div style={{ background: "#fff", border: `2px solid ${!isPro ? "#000" : "#e5e7eb"}`, borderRadius: "12px", overflow: "hidden", position: "relative" }}>
          {!isPro && (
            <div style={{ position: "absolute", top: "12px", right: "12px", fontSize: "10px", fontWeight: "700", background: "#000", color: "#fff", borderRadius: "20px", padding: "3px 10px", letterSpacing: "0.05em" }}>
              CURRENT
            </div>
          )}
          <div style={{ padding: "24px" }}>
            <div style={{ fontSize: "11px", fontWeight: "700", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "6px" }}>Free</div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: "4px", marginBottom: "4px" }}>
              <span style={{ fontSize: "32px", fontWeight: "800", color: "#111827", lineHeight: 1 }}>$0</span>
              <span style={{ fontSize: "13px", color: "#6b7280", marginBottom: "4px" }}>/month</span>
            </div>
            <div style={{ fontSize: "12px", color: "#9ca3af", marginBottom: "20px" }}>Forever free, no credit card needed</div>

            <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: "20px" }}>
              <CheckRow>1 combo box</CheckRow>
              <CheckRow>2-step &amp; 3-step bundles</CheckRow>
              <CheckRow>Smart &amp; manual collections</CheckRow>
              <CheckRow>Dynamic pricing &amp; discounts</CheckRow>
              <CheckRow>Storefront widget</CheckRow>
              <CrossRow>Unlimited combo boxes</CrossRow>
              <CrossRow>Priority support</CrossRow>
            </div>

            <div style={{ marginTop: "20px" }}>
              {!isPro ? (
                /* Free plan CTA — no Shopify billing, just mark status and go */
                <form method="post">
                  <input type="hidden" name="intent" value="free" />
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    style={{ width: "100%", padding: "11px", borderRadius: "8px", border: "1.5px solid #000", background: "#fff", fontSize: "13px", fontWeight: "700", color: "#000", cursor: isSubmitting ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", opacity: isSubmitting ? 0.7 : 1 }}
                  >
                    {isSubmitting ? "Starting…" : "Continue with Free Plan →"}
                  </button>
                </form>
              ) : (
                <>
                  <div style={{ textAlign: "center", padding: "10px", borderRadius: "8px", border: "1.5px solid #e5e7eb", fontSize: "13px", fontWeight: "600", color: "#9ca3af", cursor: "default", marginBottom: "8px" }}>
                    Current plan
                  </div>
                  <form method="post">
                    <input type="hidden" name="intent" value="cancel" />
                    <input type="hidden" name="subscriptionId" value={subscription?.id || ""} />
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1.5px solid #fecaca", background: "#fff", fontSize: "12px", fontWeight: "600", color: "#ef4444", cursor: "pointer" }}
                    >
                      {isSubmitting ? "Cancelling…" : "Cancel subscription"}
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Pro card */}
        <div style={{ background: isPro ? "#000" : "#fff", border: `2px solid ${isPro ? "#000" : "#e5e7eb"}`, borderRadius: "12px", overflow: "hidden", position: "relative" }}>
          {!isPro && (
            <div style={{ position: "absolute", top: "12px", right: "12px", fontSize: "10px", fontWeight: "700", background: "#2A7A4F", color: "#fff", borderRadius: "20px", padding: "3px 10px", letterSpacing: "0.05em" }}>
              RECOMMENDED
            </div>
          )}
          {isPro && (
            <div style={{ position: "absolute", top: "12px", right: "12px", fontSize: "10px", fontWeight: "700", background: "rgba(255,255,255,0.2)", color: "#fff", borderRadius: "20px", padding: "3px 10px", letterSpacing: "0.05em" }}>
              CURRENT
            </div>
          )}
          <div style={{ padding: "24px" }}>
            <div style={{ fontSize: "11px", fontWeight: "700", color: isPro ? "rgba(255,255,255,0.5)" : "#6b7280", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "6px" }}>Pro</div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: "4px", marginBottom: "4px" }}>
              <span style={{ fontSize: "32px", fontWeight: "800", color: isPro ? "#fff" : "#111827", lineHeight: 1 }}>${planConfig.price}</span>
              <span style={{ fontSize: "13px", color: isPro ? "rgba(255,255,255,0.5)" : "#6b7280", marginBottom: "4px" }}>/month</span>
            </div>
            <div style={{ fontSize: "12px", color: isPro ? "rgba(255,255,255,0.5)" : "#9ca3af", marginBottom: "20px" }}>
              {planConfig.trialDays}-day free trial · billed monthly
            </div>

            <div style={{ borderTop: `1px solid ${isPro ? "rgba(255,255,255,0.12)" : "#f3f4f6"}`, paddingTop: "20px" }}>
              {[
                "Unlimited combo boxes",
                "2-step & 3-step bundles",
                "Smart & manual collections",
                "Dynamic pricing & discounts",
                "Storefront widget",
                "Priority email support",
                "Early access to new features",
              ].map((f) => (
                <div key={f} style={{ display: "flex", alignItems: "flex-start", gap: "10px", marginBottom: "10px" }}>
                  <span style={{ width: "18px", height: "18px", borderRadius: "50%", flexShrink: 0, marginTop: "1px", background: isPro ? "rgba(255,255,255,0.2)" : "#000", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                      <path d="M1 4l2.5 2.5L9 1" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span style={{ fontSize: "13px", color: isPro ? "rgba(255,255,255,0.85)" : "#374151", lineHeight: 1.5 }}>{f}</span>
                </div>
              ))}
            </div>

            <div style={{ marginTop: "20px" }}>
              {isPro ? (
                <div style={{ textAlign: "center", padding: "10px", borderRadius: "8px", background: "rgba(255,255,255,0.12)", fontSize: "13px", fontWeight: "600", color: "#fff" }}>
                  ✦ Active — Thank you!
                </div>
              ) : isBillingUnavailable ? (
                <div style={{ textAlign: "center", padding: "11px", borderRadius: "8px", background: "#f3f4f6", fontSize: "13px", color: "#9ca3af", border: "1.5px solid #e5e7eb", lineHeight: 1.4 }}>
                  Billing unavailable
                  <div style={{ fontSize: "11px", marginTop: "3px", color: "#d1d5db" }}>See notice above to enable</div>
                </div>
              ) : actionData?.confirmationUrl ? (
                /* URL returned — useEffect is opening it; show holding state */
                <div style={{ textAlign: "center", padding: "12px", borderRadius: "8px", background: "#000", fontSize: "13px", fontWeight: "600", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                  <span style={{ width: "14px", height: "14px", border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block", animation: "plan-spin 0.7s linear infinite" }} />
                  Opening Shopify billing…
                </div>
              ) : (
                <form method="post">
                  <input type="hidden" name="intent" value="subscribe" />
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    style={{ width: "100%", padding: "12px", borderRadius: "8px", border: "none", background: "#000", fontSize: "14px", fontWeight: "700", color: "#fff", cursor: isSubmitting ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", opacity: isSubmitting ? 0.7 : 1 }}
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
