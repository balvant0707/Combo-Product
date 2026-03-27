/**
 * app.pricing.jsx
 * Shopify Billing — 4-tier pricing page (Free / Starter / Growth / Pro)
 * Handles: subscribe, upgrade, downgrade, cancel
 */

import { redirect as rrRedirect, useActionData, useLoaderData, useNavigation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

/* ─── Loader ─────────────────────────────────────────────────────── */

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const { getCurrentPlan, getBoxCount, PLANS, PLAN_HIERARCHY } =
    await import("../models/billing-plans.server.js");

  const [currentPlanInfo, boxCount] = await Promise.all([
    getCurrentPlan(admin),       // handles SKIP_BILLING internally
    getBoxCount(session.shop).catch(() => 0),
  ]);

  const url    = new URL(request.url);
  const status = url.searchParams.get("status"); // "subscribed" | "cancelled"

  return {
    ...currentPlanInfo,
    boxCount,
    plans:         Object.values(PLANS),
    planHierarchy: PLAN_HIERARCHY,
    status,
    shop:          session.shop,
  };
};

/* ─── Action ─────────────────────────────────────────────────────── */

export const action = async ({ request }) => {
  const { admin, session, redirect: shopifyRedirect } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent   = formData.get("intent");

  const {
    createSubscription,
    cancelSubscription,
    switchPlan,
    getCurrentPlan,
    PLANS,
  } = await import("../models/billing-plans.server.js");

  const isSkipBilling = process.env.SKIP_BILLING === "true";

  // returnUrl is only used for real Shopify billing (skip-billing mode ignores it)
  const appUrl    = process.env.SHOPIFY_APP_URL?.replace(/\/$/, "");
  const returnUrl = `${appUrl}/app/pricing?status=subscribed`;

  /* ── subscribe: free → paid ─────────────────────────────── */
  if (intent === "subscribe") {
    // Skip-billing: no Shopify billing page — navigate internally via React Router
    if (isSkipBilling) {
      return rrRedirect("/app/pricing?status=subscribed");
    }
    const targetKey = formData.get("planKey");
    try {
      const confirmationUrl = await createSubscription(admin, targetKey, returnUrl);
      // shopifyRedirect uses App Bridge to load the external Shopify billing page in top frame
      return shopifyRedirect(confirmationUrl);
    } catch (e) {
      return {
        error:                e.message,
        isBillingUnavailable: !!e.isBillingUnavailable,
        intent,
      };
    }
  }

  /* ── switch: paid → different paid ─────────────────────── */
  if (intent === "switch") {
    if (isSkipBilling) {
      return rrRedirect("/app/pricing?status=subscribed");
    }
    const targetKey             = formData.get("planKey");
    const currentSubscriptionId = formData.get("subscriptionId");
    const currentPlanKey        = formData.get("currentPlanKey");
    try {
      const confirmationUrl = await switchPlan(
        admin,
        targetKey,
        returnUrl,
        currentSubscriptionId,
        currentPlanKey,
      );
      if (!confirmationUrl) {
        // switched to free (cancel only) — internal redirect
        return rrRedirect("/app/pricing?status=cancelled");
      }
      return shopifyRedirect(confirmationUrl);
    } catch (e) {
      return {
        error:                e.message,
        isBillingUnavailable: !!e.isBillingUnavailable,
        intent,
      };
    }
  }

  /* ── cancel: downgrade to free ──────────────────────────── */
  if (intent === "cancel") {
    const subscriptionId = formData.get("subscriptionId");
    try {
      await cancelSubscription(admin, subscriptionId);
      return rrRedirect("/app/pricing?status=cancelled");
    } catch (e) {
      return { error: e.message, intent };
    }
  }

  return { error: "Unknown intent" };
};

/* ─── Design tokens ──────────────────────────────────────────────── */

const COLOR = {
  black:      "#111827",
  white:      "#ffffff",
  green:      "#2A7A4F",
  greenLight: "#f0fdf4",
  greenBorder:"#bbf7d0",
  muted:      "#6b7280",
  border:     "#e5e7eb",
  surface:    "#f9fafb",
  red:        "#ef4444",
  redLight:   "#fef2f2",
  redBorder:  "#fecaca",
  amber:      "#92400e",
  amberLight: "#fffbeb",
  amberBorder:"#fcd34d",
  blue:       "#1d4ed8",
  blueLight:  "#eff6ff",
  blueBorder: "#bfdbfe",
};

/* ─── Small reusable pieces ──────────────────────────────────────── */

function FeatureRow({ text, included = true }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "9px", marginBottom: "9px" }}>
      <span style={{
        width: "17px", height: "17px", borderRadius: "50%", flexShrink: 0, marginTop: "1px",
        background: included ? COLOR.black : "#f3f4f6",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {included ? (
          <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
            <path d="M1 3.5l2 2L8 1" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg width="7" height="7" viewBox="0 0 7 7" fill="none">
            <path d="M1 1l5 5M6 1L1 6" stroke="#9ca3af" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        )}
      </span>
      <span style={{ fontSize: "12.5px", color: included ? "#374151" : "#9ca3af", lineHeight: 1.5 }}>{text}</span>
    </div>
  );
}

function Badge({ children, color = COLOR.black, bg = "transparent", border }) {
  return (
    <span style={{
      fontSize: "9.5px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.08em",
      color, background: bg, border: `1px solid ${border || color}`,
      borderRadius: "20px", padding: "2px 9px", lineHeight: 1.6,
    }}>
      {children}
    </span>
  );
}

function Spinner({ color = "#fff", size = 14 }) {
  return (
    <span style={{
      width: size, height: size,
      border: `2px solid ${color}33`,
      borderTopColor: color,
      borderRadius: "50%",
      display: "inline-block",
      animation: "pricing-spin 0.7s linear infinite",
    }} />
  );
}

/* ─── Plan card accent colours ───────────────────────────────────── */

const PLAN_ACCENT = {
  FREE:    { badge: "#6b7280",  badgeBg: "#f3f4f6",  border: COLOR.border },
  STARTER: { badge: COLOR.blue, badgeBg: COLOR.blueLight, border: "#93c5fd" },
  GROWTH:  { badge: COLOR.green,badgeBg: COLOR.greenLight, border: "#6ee7b7" },
  PRO:     { badge: "#7c3aed",  badgeBg: "#f5f3ff",  border: "#c4b5fd" },
};

/* ─── Individual plan card ───────────────────────────────────────── */

function PlanCard({
  plan,
  isCurrent,
  isHighlighted,
  subscription,
  currentPlanKey,
  planHierarchy,
  isSubmitting,
  isBillingUnavailable,
}) {
  const accent      = PLAN_ACCENT[plan.key] || PLAN_ACCENT.FREE;
  const currentIdx  = planHierarchy.indexOf(currentPlanKey);
  const targetIdx   = planHierarchy.indexOf(plan.key);
  const isUpgrade   = targetIdx > currentIdx;
  const isDowngrade = targetIdx < currentIdx;
  const isFree      = plan.price === 0;

  /* Which intent + label to use */
  let intent  = "subscribe";
  let btnLabel = isFree ? "Current plan" : `Start ${plan.trialDays}-Day Free Trial →`;

  if (isCurrent) {
    btnLabel = "Current plan";
    intent   = null;
  } else if (!isFree && currentPlanKey !== "FREE") {
    intent   = "switch";
    btnLabel = isUpgrade ? `Upgrade to ${plan.name} →` : `Downgrade to ${plan.name}`;
  } else if (isFree && !isCurrent) {
    intent   = "cancel";
    btnLabel = "Downgrade to Free";
  }

  const cardBg     = isCurrent && !isFree ? COLOR.black : COLOR.white;
  const textColor  = isCurrent && !isFree ? COLOR.white : COLOR.black;
  const mutedColor = isCurrent && !isFree ? "rgba(255,255,255,0.55)" : COLOR.muted;
  const divColor   = isCurrent && !isFree ? "rgba(255,255,255,0.12)" : COLOR.border;

  return (
    <div style={{
      background:   cardBg,
      border:       `2px solid ${isCurrent ? (isFree ? COLOR.black : COLOR.black) : (isHighlighted ? accent.border : COLOR.border)}`,
      borderRadius: "14px",
      overflow:     "hidden",
      position:     "relative",
      display:      "flex",
      flexDirection:"column",
      transition:   "box-shadow 0.15s",
    }}>
      {/* Top badge row */}
      <div style={{ position: "absolute", top: "12px", right: "12px", display: "flex", gap: "5px" }}>
        {isCurrent && (
          <Badge
            color={isFree ? COLOR.black : "#fff"}
            bg={isFree ? COLOR.white : "rgba(255,255,255,0.18)"}
            border={isFree ? COLOR.black : "rgba(255,255,255,0.3)"}
          >
            Current
          </Badge>
        )}
        {!isCurrent && isHighlighted && (
          <Badge color={accent.badge} bg={accent.badgeBg} border={accent.border}>
            Popular
          </Badge>
        )}
      </div>

      <div style={{ padding: "26px 22px", flex: 1, display: "flex", flexDirection: "column" }}>
        {/* Plan name */}
        <div style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.1em", color: mutedColor, marginBottom: "6px" }}>
          {plan.name}
        </div>

        {/* Price */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: "4px", marginBottom: "3px" }}>
          <span style={{ fontSize: "36px", fontWeight: "800", color: textColor, lineHeight: 1 }}>
            ${plan.price}
          </span>
          <span style={{ fontSize: "13px", color: mutedColor, marginBottom: "5px" }}>/month</span>
        </div>

        {/* Sub-heading */}
        <div style={{ fontSize: "12px", color: mutedColor, marginBottom: "22px", minHeight: "18px" }}>
          {isFree
            ? "Forever free · no credit card"
            : `${plan.trialDays}-day free trial · billed monthly`}
        </div>

        {/* Feature list */}
        <div style={{ borderTop: `1px solid ${divColor}`, paddingTop: "18px", flex: 1 }}>
          {plan.features.map((f) => (
            <FeatureRow key={f} text={f} included />
          ))}
        </div>

        {/* CTA */}
        <div style={{ marginTop: "22px" }}>
          {isBillingUnavailable && !isCurrent && !isFree ? (
            <div style={{ textAlign: "center", padding: "11px", borderRadius: "8px", background: "#f3f4f6", fontSize: "12px", color: "#9ca3af", border: "1.5px solid #e5e7eb" }}>
              Billing unavailable
            </div>
          ) : isCurrent ? (
            <div style={{
              textAlign: "center", padding: "11px", borderRadius: "8px",
              background: isFree ? "#f3f4f6" : "rgba(255,255,255,0.12)",
              fontSize: "13px", fontWeight: "600",
              color: isFree ? COLOR.muted : "#fff",
              border: `1.5px solid ${isFree ? COLOR.border : "rgba(255,255,255,0.2)"}`,
            }}>
              {isFree ? "Current plan" : "✦ Active — Thank you!"}
            </div>
          ) : (
            <form method="post">
              <input type="hidden" name="intent" value={intent} />
              <input type="hidden" name="planKey" value={plan.key} />
              {intent === "switch" && (
                <>
                  <input type="hidden" name="subscriptionId" value={subscription?.id || ""} />
                  <input type="hidden" name="currentPlanKey" value={currentPlanKey} />
                </>
              )}
              {intent === "cancel" && (
                <input type="hidden" name="subscriptionId" value={subscription?.id || ""} />
              )}
              <button
                type="submit"
                disabled={isSubmitting}
                style={{
                  width:          "100%",
                  padding:        "12px",
                  borderRadius:   "8px",
                  border:         isDowngrade ? `1.5px solid ${COLOR.redBorder}` : "none",
                  background:     isDowngrade ? COLOR.white : (isHighlighted ? COLOR.green : COLOR.black),
                  fontSize:       "13px",
                  fontWeight:     "700",
                  color:          isDowngrade ? COLOR.red : "#fff",
                  cursor:         isSubmitting ? "not-allowed" : "pointer",
                  opacity:        isSubmitting ? 0.75 : 1,
                  display:        "flex",
                  alignItems:     "center",
                  justifyContent: "center",
                  gap:            "8px",
                  transition:     "opacity 0.15s",
                }}
              >
                {isSubmitting ? (
                  <>
                    <Spinner color={isDowngrade ? COLOR.red : "#fff"} size={13} />
                    <span>{isUpgrade ? "Redirecting…" : "Processing…"}</span>
                  </>
                ) : btnLabel}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Comparison table (desktop only) ───────────────────────────── */

const COMPARISON_ROWS = [
  { label: "Combo boxes",           FREE: "1",       STARTER: "5",          GROWTH: "25",          PRO: "Unlimited" },
  { label: "2-step bundles",        FREE: true,      STARTER: true,         GROWTH: true,          PRO: true },
  { label: "3-step bundles",        FREE: false,     STARTER: true,         GROWTH: true,          PRO: true },
  { label: "Smart collections",     FREE: true,      STARTER: true,         GROWTH: true,          PRO: true },
  { label: "Dynamic pricing",       FREE: true,      STARTER: true,         GROWTH: true,          PRO: true },
  { label: "Analytics",             FREE: "Basic",   STARTER: "Standard",   GROWTH: "Advanced",    PRO: "Advanced" },
  { label: "Support",               FREE: "Docs",    STARTER: "Email",      GROWTH: "Priority",    PRO: "Priority + Chat" },
  { label: "Early feature access",  FREE: false,     STARTER: false,        GROWTH: false,         PRO: true },
];

function ComparisonCell({ value }) {
  if (value === true)  return <span style={{ color: COLOR.green, fontSize: "15px", fontWeight: "700" }}>✓</span>;
  if (value === false) return <span style={{ color: "#d1d5db", fontSize: "13px" }}>—</span>;
  return <span style={{ fontSize: "12.5px", color: "#374151", fontWeight: "500" }}>{value}</span>;
}

function ComparisonTable({ planHierarchy }) {
  const cols = planHierarchy; // ["FREE","STARTER","GROWTH","PRO"]
  return (
    <div style={{ overflowX: "auto", marginTop: "40px" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "10px 14px", color: COLOR.muted, fontWeight: "700", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.07em", borderBottom: `2px solid ${COLOR.border}` }}>
              Feature
            </th>
            {cols.map((key) => (
              <th key={key} style={{ textAlign: "center", padding: "10px 14px", color: COLOR.black, fontWeight: "800", fontSize: "13px", borderBottom: `2px solid ${COLOR.border}` }}>
                {key.charAt(0) + key.slice(1).toLowerCase()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COMPARISON_ROWS.map((row, i) => (
            <tr key={row.label} style={{ background: i % 2 === 0 ? "#fff" : "#f9fafb" }}>
              <td style={{ padding: "11px 14px", color: "#374151", fontWeight: "500", borderBottom: `1px solid ${COLOR.border}` }}>
                {row.label}
              </td>
              {cols.map((key) => (
                <td key={key} style={{ textAlign: "center", padding: "11px 14px", borderBottom: `1px solid ${COLOR.border}` }}>
                  <ComparisonCell value={row[key]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Main page component ────────────────────────────────────────── */

export default function PricingPage() {
  const {
    planKey,
    subscription,
    isBillingUnavailable,
    isDevMode,
    boxCount,
    plans,
    planHierarchy,
    status,
  } = useLoaderData();

  const actionData   = useActionData();
  const navigation   = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  // When SKIP_BILLING=true, isDevMode is true — suppress the error banner entirely
  const billingDown = !isDevMode && (isBillingUnavailable || actionData?.isBillingUnavailable);

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "32px 20px", fontFamily: "inherit" }}>

      {/* ── Keyframe animation ── */}
      <style>{`
        @keyframes pricing-spin { to { transform: rotate(360deg); } }
      `}</style>

      {/* ── Page header ── */}
      <div style={{ textAlign: "center", marginBottom: "36px" }}>
        <div style={{ fontSize: "26px", fontWeight: "800", color: COLOR.black, letterSpacing: "-0.5px", marginBottom: "8px" }}>
          Pricing Plans
        </div>
        <div style={{ fontSize: "14px", color: COLOR.muted }}>
          Start free. Upgrade as your store grows. Cancel anytime.
        </div>
      </div>

      {/* ── Dev mode notice ── */}
      {isDevMode && (
        <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "10px", padding: "12px 16px", marginBottom: "20px", display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "16px", flexShrink: 0 }}>🛠️</span>
          <div style={{ fontSize: "12px", color: "#1e40af", lineHeight: 1.6 }}>
            <strong>Billing bypass active</strong> — <code style={{ background: "#dbeafe", borderRadius: "3px", padding: "1px 5px", fontSize: "11px" }}>SKIP_BILLING=true</code> is set.
            All shops are granted the <strong>{plans.find(p => p.key === planKey)?.name || planKey} plan</strong> without charge.
            Remove it once your app has <strong>Public Distribution</strong> approved in the Partner Dashboard.
          </div>
        </div>
      )}

      {/* ── Billing unavailable banner ── */}
      {billingDown && (
        <div style={{ background: COLOR.amberLight, border: `1px solid ${COLOR.amberBorder}`, borderRadius: "10px", padding: "16px 18px", marginBottom: "24px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
            <span style={{ fontSize: "20px", flexShrink: 0 }}>⚠️</span>
            <div>
              <div style={{ fontSize: "13px", fontWeight: "700", color: COLOR.amber, marginBottom: "6px" }}>
                Billing API unavailable — Public Distribution required
              </div>
              <div style={{ fontSize: "12px", color: "#78350f", lineHeight: 1.7 }}>
                Shopify's Billing API is only available for <strong>publicly distributed</strong> apps.
                Your app appears to be a custom or development app. To enable billing:
              </div>
              <ol style={{ fontSize: "12px", color: "#78350f", margin: "10px 0 0 0", paddingLeft: "18px", lineHeight: 2.1 }}>
                <li>Open <strong>Shopify Partner Dashboard → Apps → your app</strong></li>
                <li>Go to <strong>Distribution</strong> and select <strong>Public</strong></li>
                <li>Save changes and redeploy</li>
              </ol>
              <div style={{ marginTop: "10px", fontSize: "11px", color: COLOR.amber, background: "#fef3c7", borderRadius: "5px", padding: "6px 10px", display: "inline-block" }}>
                All shops are treated as <strong>Free plan</strong> until billing is enabled.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Status banners ── */}
      {status === "subscribed" && (
        <div style={{ background: COLOR.greenLight, border: `1px solid ${COLOR.greenBorder}`, borderRadius: "10px", padding: "14px 18px", marginBottom: "20px", display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "18px" }}>🎉</span>
          <div style={{ fontSize: "13px", fontWeight: "600", color: "#15803d" }}>
            Subscription activated! All features for your plan are now unlocked.
          </div>
        </div>
      )}
      {status === "cancelled" && (
        <div style={{ background: "#fefce8", border: "1px solid #fde047", borderRadius: "10px", padding: "14px 18px", marginBottom: "20px", display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "18px" }}>ℹ️</span>
          <div style={{ fontSize: "13px", fontWeight: "600", color: "#854d0e" }}>
            Subscription cancelled. You'll keep your current plan access until the billing period ends.
          </div>
        </div>
      )}
      {actionData?.error && !actionData?.isBillingUnavailable && (
        <div style={{ background: COLOR.redLight, border: `1px solid ${COLOR.redBorder}`, borderRadius: "10px", padding: "14px 18px", marginBottom: "20px" }}>
          <span style={{ fontSize: "13px", color: "#b91c1c" }}>
            <strong>Error:</strong> {actionData.error}
          </span>
        </div>
      )}

      {/* ── Current plan status bar ── */}
      <div style={{
        background:    planKey === "FREE" ? COLOR.surface : COLOR.black,
        border:        `1px solid ${planKey === "FREE" ? COLOR.border : COLOR.black}`,
        borderRadius:  "10px",
        padding:       "14px 20px",
        marginBottom:  "28px",
        display:       "flex",
        alignItems:    "center",
        justifyContent:"space-between",
        flexWrap:      "wrap",
        gap:           "12px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: planKey === "FREE" ? COLOR.border : "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px" }}>
            {planKey === "FREE" ? "📦" : planKey === "STARTER" ? "🚀" : planKey === "GROWTH" ? "📈" : "⚡"}
          </div>
          <div>
            <div style={{ fontSize: "14px", fontWeight: "700", color: planKey === "FREE" ? COLOR.black : COLOR.white }}>
              {planKey === "FREE" ? "Free Plan" : `${plans.find(p => p.key === planKey)?.name} Plan — Active`}
            </div>
            <div style={{ fontSize: "12px", color: planKey === "FREE" ? COLOR.muted : "rgba(255,255,255,0.55)", marginTop: "2px" }}>
              {planKey === "FREE"
                ? `${boxCount} combo box used · ${plans.find(p => p.key === "FREE")?.limits.boxes} allowed on Free`
                : subscription?.currentPeriodEnd
                  ? `Renews ${new Date(subscription.currentPeriodEnd).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
                  : "Active subscription"}
            </div>
          </div>
        </div>
        <Badge
          color={planKey === "FREE" ? COLOR.muted : "#fff"}
          bg={planKey === "FREE" ? "#e5e7eb" : "rgba(255,255,255,0.15)"}
          border={planKey === "FREE" ? "#d1d5db" : "rgba(255,255,255,0.25)"}
        >
          {planKey}
        </Badge>
      </div>

      {/* ── Plan cards grid ── */}
      <div style={{
        display:             "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(195px, 1fr))",
        gap:                 "14px",
      }}>
        {plans.map((plan) => (
          <PlanCard
            key={plan.key}
            plan={plan}
            isCurrent={plan.key === planKey}
            isHighlighted={plan.key === "GROWTH"}
            subscription={subscription}
            currentPlanKey={planKey}
            planHierarchy={planHierarchy}
            isSubmitting={isSubmitting}
            isBillingUnavailable={billingDown}
          />
        ))}
      </div>

      {/* ── Feature comparison table ── */}
      <ComparisonTable planHierarchy={planHierarchy} />

      {/* ── FAQ / billing notes ── */}
      <div style={{ marginTop: "36px", padding: "20px 22px", background: COLOR.surface, border: `1px solid ${COLOR.border}`, borderRadius: "10px" }}>
        <div style={{ fontSize: "11px", fontWeight: "700", color: COLOR.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "14px" }}>
          Billing FAQ
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 28px" }}>
          {[
            ["Free trial",     "7 days free on all paid plans — no charge until trial ends"],
            ["Billing cycle",  "Charged monthly through your Shopify account"],
            ["Upgrade",        "Applies immediately and is prorated for the current period"],
            ["Downgrade",      "Takes effect at the start of the next billing cycle"],
            ["Cancel anytime", "Pro access continues until the end of the current period"],
            ["Currency",       "All prices in USD, charged via Shopify Billing"],
          ].map(([k, v]) => (
            <div key={k}>
              <div style={{ fontSize: "10px", fontWeight: "700", color: COLOR.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "3px" }}>{k}</div>
              <div style={{ fontSize: "12px", color: "#374151", lineHeight: 1.6 }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

/* ─── Error boundary ─────────────────────────────────────────────── */

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
