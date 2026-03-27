import { useActionData, useLoaderData, useNavigation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { AdminIcon } from "../components/admin-icons";

/* ─── Loader ─────────────────────────────────────────────────────── */

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const {
    getActiveSubscription,
    getBoxCount,
    FREE_BOX_LIMIT,
    PLAN_CONFIG,
  } = await import("../models/billing.server.js");

  const [subscription, boxCount] = await Promise.all([
    getActiveSubscription(admin),
    getBoxCount(shop),
  ]);

  const isPro = !!subscription && subscription.status === "ACTIVE";

  return {
    isPro,
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
  const { admin, redirect } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  const { createSubscription, cancelSubscription } =
    await import("../models/billing.server.js");

  if (intent === "subscribe") {
    try {
      const returnUrl = `${process.env.SHOPIFY_APP_URL}/app/plan?subscribed=1`;
      const confirmationUrl = await createSubscription(admin, returnUrl);
      return redirect(confirmationUrl);
    } catch (e) {
      return { error: e.message };
    }
  }

  if (intent === "cancel") {
    const subscriptionId = formData.get("subscriptionId");
    try {
      await cancelSubscription(admin, subscriptionId);
      return { cancelled: true };
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
  const { isPro, subscription, boxCount, freeLimit, planConfig } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const url = new URL(typeof window !== "undefined" ? window.location.href : "http://localhost");
  const justSubscribed = url.searchParams.get("subscribed") === "1";

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

      {/* ── Success banners ── */}
      {justSubscribed && (
        <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "8px", padding: "14px 16px", marginBottom: "20px", display: "flex", alignItems: "center", gap: "10px" }}>
          <AdminIcon type="check" size="small" style={{ color: "#16a34a" }} />
          <div style={{ fontSize: "13px", fontWeight: "600", color: "#15803d" }}>
            You're now on the Pro plan! All features are unlocked.
          </div>
        </div>
      )}
      {actionData?.cancelled && (
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
              <div style={{ textAlign: "center", padding: "10px", borderRadius: "8px", border: "1.5px solid #e5e7eb", fontSize: "13px", fontWeight: "600", color: "#9ca3af", cursor: "default" }}>
                {isPro ? "Downgrade" : "Current plan"}
              </div>
              {isPro && (
                <form method="post" style={{ marginTop: "8px" }}>
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
                        Redirecting to Shopify…
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
