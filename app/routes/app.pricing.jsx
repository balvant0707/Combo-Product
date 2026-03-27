/**
 * app.pricing.jsx
 * Shopify Billing — Free & Pro plan selection.
 * • Free plan  → save to DB, redirect to /app/boxes
 * • Pro plan   → Shopify appSubscriptionCreate → window.open(_top) → billing page
 * • After approval Shopify redirects back → sync DB → show success
 * • Cancel     → cancel Shopify subscription, revert to Free in DB
 */

import { useEffect } from "react";
import {
  redirect as rrRedirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { withEmbeddedAppParamsFromRequest } from "../utils/embedded-app";

/* ─── Loader ─────────────────────────────────────────────────────── */

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const { syncSubscription, getBoxCount } = await import("../models/billing.server.js");
  const { activatePaidPlan, PLANS }       = await import("../models/subscription.server.js");

  // Sync Shopify subscription state with local DB
  const { subscription, billingUnavailable } = await syncSubscription(admin, shop);

  // After Shopify billing approval, the return URL contains ?subscribed=1
  const url = new URL(request.url);
  if (url.searchParams.get("subscribed") === "1" && subscription?.subscriptionId) {
    // Ensure DB is up to date
    await activatePaidPlan(shop, {
      plan:            subscription.plan || "PRO",
      subscriptionId:  subscription.subscriptionId,
      currentPeriodEnd: subscription.currentPeriodEnd,
    }).catch(() => {});
  }

  const boxCount = await getBoxCount(shop);
  const isDevMode = process.env.SKIP_BILLING === "true";

  return {
    subscription,
    billingUnavailable: !isDevMode && billingUnavailable,
    isDevMode,
    boxCount,
    plans: Object.values(PLANS),
    status: url.searchParams.get("status"),   // "subscribed" | "cancelled"
    subscribed: url.searchParams.get("subscribed") === "1",
    cancelled:  url.searchParams.get("cancelled")  === "1",
  };
};

/* ─── Action ─────────────────────────────────────────────────────── */

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop     = session.shop;
  const formData = await request.formData();
  const intent   = formData.get("intent");
  const requestUrl = new URL(request.url);

  const { createSubscription, cancelSubscription } = await import("../models/billing.server.js");
  const { activateFreePlan, activatePaidPlan }      = await import("../models/subscription.server.js");
  const { setShopPlanStatus }                       = await import("../models/shop.server.js");

  /* ── Free plan — no Shopify billing needed ── */
  if (intent === "free") {
    await activateFreePlan(shop);
    await setShopPlanStatus(shop, "free");
    return rrRedirect(withEmbeddedAppParamsFromRequest("/app/boxes", request));
  }

  /* ── Pro plan — create Shopify subscription ── */
  if (intent === "subscribe") {
    const isSkipBilling = process.env.SKIP_BILLING === "true";

    if (isSkipBilling) {
      // Dev bypass: activate pro immediately, no Shopify billing page
      await activatePaidPlan(shop, {
        plan:           "PRO",
        subscriptionId: `gid://shopify/AppSubscription/dev-${Date.now()}`,
      });
      await setShopPlanStatus(shop, "active");
      return rrRedirect(withEmbeddedAppParamsFromRequest("/app/boxes", request));
    }

    try {
      const returnPath = withEmbeddedAppParamsFromRequest("/app/pricing?subscribed=1", request);
      const returnUrl = new URL(returnPath, requestUrl.origin).toString();
      const confirmationUrl = await createSubscription(admin, returnUrl);
      // Return URL to client — component uses window.open(_top) to navigate parent frame
      return { confirmationUrl };
    } catch (e) {
      return { error: e.message, billingUnavailable: !!e.isBillingUnavailable };
    }
  }

  /* ── Cancel subscription ── */
  if (intent === "cancel") {
    const subscriptionId = formData.get("subscriptionId");
    try {
      await cancelSubscription(admin, shop, subscriptionId);
      await setShopPlanStatus(shop, "free");
      return rrRedirect(withEmbeddedAppParamsFromRequest("/app/pricing?cancelled=1", request));
    } catch (e) {
      return { error: e.message };
    }
  }

  return { error: "Unknown intent" };
};

/* ─── Styles / tokens ────────────────────────────────────────────── */

const C = {
  black:  "#111827",
  white:  "#ffffff",
  green:  "#2A7A4F",
  muted:  "#6b7280",
  border: "#e5e7eb",
  surface:"#f9fafb",
  red:    "#ef4444",
  amber:  "#92400e",
  blue:   "#1d4ed8",
};

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

function FeatureRow({ text }) {
  return (
    <div style={{ display:"flex", alignItems:"flex-start", gap:"9px", marginBottom:"9px" }}>
      <span style={{ width:"17px", height:"17px", borderRadius:"50%", flexShrink:0, marginTop:"1px", background: C.black, display:"flex", alignItems:"center", justifyContent:"center" }}>
        <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
          <path d="M1 3.5l2 2L8 1" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </span>
      <span style={{ fontSize:"12.5px", color:"#374151", lineHeight:1.5 }}>{text}</span>
    </div>
  );
}

function CrossRow({ text }) {
  return (
    <div style={{ display:"flex", alignItems:"flex-start", gap:"9px", marginBottom:"9px" }}>
      <span style={{ width:"17px", height:"17px", borderRadius:"50%", flexShrink:0, marginTop:"1px", background:"#f3f4f6", display:"flex", alignItems:"center", justifyContent:"center" }}>
        <svg width="7" height="7" viewBox="0 0 7 7" fill="none">
          <path d="M1 1l5 5M6 1L1 6" stroke="#9ca3af" strokeWidth="1.7" strokeLinecap="round"/>
        </svg>
      </span>
      <span style={{ fontSize:"12.5px", color:"#9ca3af", lineHeight:1.5 }}>{text}</span>
    </div>
  );
}

/* ─── Component ──────────────────────────────────────────────────── */

export default function PricingPage() {
  const { subscription, billingUnavailable, isDevMode, boxCount, plans, subscribed, cancelled } = useLoaderData();
  const actionData   = useActionData();
  const navigation   = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const isPro  = subscription?.plan === "PRO"  && subscription?.status === "ACTIVE";
  const isFree = subscription?.plan === "FREE" && subscription?.status === "ACTIVE";
  const hasNoPlan = !subscription || subscription.status === "NONE" || subscription.status === "CANCELLED";

  const billingDown = billingUnavailable || actionData?.billingUnavailable;

  // Navigate the parent Shopify admin frame to the billing confirmation page
  useEffect(() => {
    if (actionData?.confirmationUrl) {
      window.open(actionData.confirmationUrl, "_top");
    }
  }, [actionData?.confirmationUrl]);

  const proPlan  = plans.find((p) => p.key === "PRO");
  const freePlan = plans.find((p) => p.key === "FREE");

  return (
    <div style={{ maxWidth:"860px", margin:"0 auto", padding:"32px 20px", fontFamily:"inherit" }}>
      <style>{`@keyframes pricing-spin { to { transform:rotate(360deg); } }`}</style>

      {/* Header */}
      <div style={{ textAlign:"center", marginBottom:"36px" }}>
        <div style={{ fontSize:"26px", fontWeight:"800", color: C.black, letterSpacing:"-0.5px", marginBottom:"8px" }}>
          Choose Your Plan
        </div>
        <div style={{ fontSize:"14px", color: C.muted }}>
          Start free. Upgrade when your store needs more.
        </div>
      </div>

      {/* Dev mode notice */}
      {isDevMode && (
        <div style={{ background:"#eff6ff", border:"1px solid #bfdbfe", borderRadius:"10px", padding:"12px 16px", marginBottom:"20px", display:"flex", alignItems:"center", gap:"10px" }}>
          <span style={{ fontSize:"16px" }}>🛠️</span>
          <div style={{ fontSize:"12px", color: C.blue, lineHeight:1.6 }}>
            <strong>Billing bypass active</strong> — <code style={{ background:"#dbeafe", borderRadius:"3px", padding:"1px 5px", fontSize:"11px" }}>SKIP_BILLING=true</code>.
            Plans activate instantly without Shopify billing.
          </div>
        </div>
      )}

      {/* Billing unavailable */}
      {billingDown && (
        <div style={{ background:"#fffbeb", border:"1px solid #fcd34d", borderRadius:"10px", padding:"16px 18px", marginBottom:"20px" }}>
          <div style={{ display:"flex", alignItems:"flex-start", gap:"12px" }}>
            <span style={{ fontSize:"20px" }}>⚠️</span>
            <div>
              <div style={{ fontSize:"13px", fontWeight:"700", color: C.amber, marginBottom:"6px" }}>Billing API unavailable</div>
              <div style={{ fontSize:"12px", color:"#78350f", lineHeight:1.7 }}>
                Set your app to <strong>Public Distribution</strong> in the Shopify Partner Dashboard to enable paid plans.
                Until then, use <code>SKIP_BILLING=true</code> in <code>.env</code> for development.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {actionData?.error && !actionData?.billingUnavailable && (
        <div style={{ background:"#fef2f2", border:"1px solid #fecaca", borderRadius:"10px", padding:"14px 16px", marginBottom:"20px" }}>
          <strong style={{ fontSize:"13px", color:"#b91c1c" }}>Error: </strong>
          <span style={{ fontSize:"13px", color:"#b91c1c" }}>{actionData.error}</span>
        </div>
      )}

      {/* Success banners */}
      {subscribed && (
        <div style={{ background:"#f0fdf4", border:"1px solid #bbf7d0", borderRadius:"10px", padding:"14px 16px", marginBottom:"20px", display:"flex", alignItems:"center", gap:"10px" }}>
          <span style={{ fontSize:"18px" }}>🎉</span>
          <span style={{ fontSize:"13px", fontWeight:"600", color:"#15803d" }}>
            Pro plan activated! All features are now unlocked.
          </span>
        </div>
      )}
      {cancelled && (
        <div style={{ background:"#fefce8", border:"1px solid #fde047", borderRadius:"10px", padding:"14px 16px", marginBottom:"20px", display:"flex", alignItems:"center", gap:"10px" }}>
          <span style={{ fontSize:"18px" }}>ℹ️</span>
          <span style={{ fontSize:"13px", fontWeight:"600", color:"#854d0e" }}>
            Subscription cancelled. You&apos;ll keep Pro access until the billing period ends.
          </span>
        </div>
      )}

      {/* Current plan bar */}
      <div style={{
        background:    isPro ? C.black : C.surface,
        border:        `1px solid ${isPro ? C.black : C.border}`,
        borderRadius:  "10px", padding:"14px 20px", marginBottom:"28px",
        display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:"12px",
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:"12px" }}>
          <span style={{ fontSize:"22px" }}>{isPro ? "⚡" : "📦"}</span>
          <div>
            <div style={{ fontSize:"14px", fontWeight:"700", color: isPro ? C.white : C.black }}>
              {isPro ? "Pro Plan — Active" : hasNoPlan ? "No plan selected" : "Free Plan"}
            </div>
            <div style={{ fontSize:"12px", color: isPro ? "rgba(255,255,255,0.55)" : C.muted, marginTop:"2px" }}>
              {isPro
                ? `Renews ${subscription?.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString("en-IN", { day:"numeric", month:"short", year:"numeric" }) : "—"}`
                : `${boxCount} box${boxCount !== 1 ? "es" : ""} created · ${hasNoPlan ? "Select a plan below" : "1 box allowed on Free"}`}
            </div>
          </div>
        </div>
        <span style={{
          fontSize:"10px", fontWeight:"700", textTransform:"uppercase", letterSpacing:"0.08em",
          padding:"3px 12px", borderRadius:"20px",
          color:       isPro ? C.white : C.muted,
          background:  isPro ? "rgba(255,255,255,0.15)" : "#e5e7eb",
          border:      isPro ? "1px solid rgba(255,255,255,0.25)" : "1px solid #d1d5db",
        }}>
          {isPro ? "PRO" : isFree ? "FREE" : "NONE"}
        </span>
      </div>

      {/* Plan cards */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"16px" }}>

        {/* ── FREE CARD ── */}
        <div style={{
          background: C.white,
          border: `2px solid ${isFree || hasNoPlan ? C.black : C.border}`,
          borderRadius:"14px", overflow:"hidden", position:"relative", display:"flex", flexDirection:"column",
        }}>
          {isFree && (
            <div style={{ position:"absolute", top:"12px", right:"12px", fontSize:"10px", fontWeight:"700", background: C.black, color: C.white, borderRadius:"20px", padding:"3px 10px" }}>
              CURRENT
            </div>
          )}
          <div style={{ padding:"26px 22px", flex:1, display:"flex", flexDirection:"column" }}>
            <div style={{ fontSize:"11px", fontWeight:"700", textTransform:"uppercase", letterSpacing:"0.1em", color: C.muted, marginBottom:"6px" }}>Free</div>
            <div style={{ display:"flex", alignItems:"flex-end", gap:"4px", marginBottom:"3px" }}>
              <span style={{ fontSize:"36px", fontWeight:"800", color: C.black, lineHeight:1 }}>$0</span>
              <span style={{ fontSize:"13px", color: C.muted, marginBottom:"5px" }}>/month</span>
            </div>
            <div style={{ fontSize:"12px", color: C.muted, marginBottom:"22px" }}>Forever free · no credit card</div>

            <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:"18px", flex:1 }}>
              {freePlan?.features?.map((f) => <FeatureRow key={f} text={f} />)}
              <CrossRow text="Unlimited combo boxes" />
              <CrossRow text="Priority support" />
            </div>

            <div style={{ marginTop:"22px" }}>
              {isFree ? (
                <div style={{ textAlign:"center", padding:"11px", borderRadius:"8px", background: C.surface, fontSize:"13px", fontWeight:"600", color: C.muted, border:`1.5px solid ${C.border}` }}>
                  Current plan
                </div>
              ) : isPro ? (
                /* Downgrade: cancel subscription → free */
                <form method="post">
                  <input type="hidden" name="intent" value="cancel" />
                  <input type="hidden" name="subscriptionId" value={subscription?.subscriptionId || ""} />
                  <button type="submit" disabled={isSubmitting} style={{ width:"100%", padding:"11px", borderRadius:"8px", border:`1.5px solid #fecaca`, background: C.white, fontSize:"12px", fontWeight:"600", color: C.red, cursor:"pointer", opacity: isSubmitting ? 0.7 : 1 }}>
                    {isSubmitting ? "Processing…" : "Downgrade to Free"}
                  </button>
                </form>
              ) : (
                /* No plan → select free */
                <form method="post">
                  <input type="hidden" name="intent" value="free" />
                  <button type="submit" disabled={isSubmitting} style={{ width:"100%", padding:"11px", borderRadius:"8px", border:`1.5px solid ${C.black}`, background: C.white, fontSize:"13px", fontWeight:"700", color: C.black, cursor: isSubmitting ? "not-allowed" : "pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:"8px", opacity: isSubmitting ? 0.7 : 1 }}>
                    {isSubmitting ? <><Spinner color={C.black} size={13} />Starting…</> : "Continue with Free →"}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>

        {/* ── PRO CARD ── */}
        <div style={{
          background:   isPro ? C.black : C.white,
          border:       `2px solid ${isPro ? C.black : C.green}`,
          borderRadius: "14px", overflow:"hidden", position:"relative", display:"flex", flexDirection:"column",
        }}>
          <div style={{ position:"absolute", top:"12px", right:"12px", fontSize:"10px", fontWeight:"700", background: isPro ? "rgba(255,255,255,0.2)" : C.green, color: C.white, borderRadius:"20px", padding:"3px 10px" }}>
            {isPro ? "CURRENT" : "RECOMMENDED"}
          </div>
          <div style={{ padding:"26px 22px", flex:1, display:"flex", flexDirection:"column" }}>
            <div style={{ fontSize:"11px", fontWeight:"700", textTransform:"uppercase", letterSpacing:"0.1em", color: isPro ? "rgba(255,255,255,0.5)" : C.muted, marginBottom:"6px" }}>Pro</div>
            <div style={{ display:"flex", alignItems:"flex-end", gap:"4px", marginBottom:"3px" }}>
              <span style={{ fontSize:"36px", fontWeight:"800", color: isPro ? C.white : C.black, lineHeight:1 }}>${proPlan?.price}</span>
              <span style={{ fontSize:"13px", color: isPro ? "rgba(255,255,255,0.5)" : C.muted, marginBottom:"5px" }}>/month</span>
            </div>
            <div style={{ fontSize:"12px", color: isPro ? "rgba(255,255,255,0.5)" : C.muted, marginBottom:"22px" }}>
              {proPlan?.trialDays}-day free trial · billed monthly
            </div>

            <div style={{ borderTop:`1px solid ${isPro ? "rgba(255,255,255,0.12)" : C.border}`, paddingTop:"18px", flex:1 }}>
              {proPlan?.features?.map((f) => (
                <div key={f} style={{ display:"flex", alignItems:"flex-start", gap:"9px", marginBottom:"9px" }}>
                  <span style={{ width:"17px", height:"17px", borderRadius:"50%", flexShrink:0, marginTop:"1px", background: isPro ? "rgba(255,255,255,0.2)" : C.black, display:"flex", alignItems:"center", justifyContent:"center" }}>
                    <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                      <path d="M1 3.5l2 2L8 1" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </span>
                  <span style={{ fontSize:"12.5px", color: isPro ? "rgba(255,255,255,0.85)" : "#374151", lineHeight:1.5 }}>{f}</span>
                </div>
              ))}
            </div>

            <div style={{ marginTop:"22px" }}>
              {isPro ? (
                <div style={{ textAlign:"center", padding:"11px", borderRadius:"8px", background:"rgba(255,255,255,0.12)", fontSize:"13px", fontWeight:"600", color: C.white }}>
                  ✦ Active — Thank you!
                </div>
              ) : billingDown ? (
                <div style={{ textAlign:"center", padding:"11px", borderRadius:"8px", background: C.surface, fontSize:"12px", color: C.muted, border:`1.5px solid ${C.border}`, lineHeight:1.4 }}>
                  Billing unavailable
                </div>
              ) : actionData?.confirmationUrl ? (
                <div style={{ textAlign:"center", padding:"12px", borderRadius:"8px", background: C.black, fontSize:"13px", fontWeight:"600", color: C.white, display:"flex", alignItems:"center", justifyContent:"center", gap:"8px" }}>
                  <Spinner />Opening Shopify billing…
                </div>
              ) : (
                <form method="post">
                  <input type="hidden" name="intent" value="subscribe" />
                  <button type="submit" disabled={isSubmitting} style={{ width:"100%", padding:"12px", borderRadius:"8px", border:"none", background: C.green, fontSize:"14px", fontWeight:"700", color: C.white, cursor: isSubmitting ? "not-allowed" : "pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:"8px", opacity: isSubmitting ? 0.7 : 1 }}>
                    {isSubmitting ? <><Spinner />Preparing billing…</> : `Start ${proPlan?.trialDays}-Day Free Trial →`}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>

      </div>

      {/* Billing FAQ */}
      <div style={{ marginTop:"36px", padding:"20px 22px", background: C.surface, border:`1px solid ${C.border}`, borderRadius:"10px" }}>
        <div style={{ fontSize:"11px", fontWeight:"700", color: C.muted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:"14px" }}>Billing FAQ</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"12px 28px" }}>
          {[
            ["Free trial",    `${proPlan?.trialDays} days free on Pro — no charge until trial ends`],
            ["Billing",       "Monthly, charged through your Shopify account in USD"],
            ["Upgrade",       "Applies immediately, prorated for the current period"],
            ["Cancel",        "Access continues until the end of the billing period"],
          ].map(([k, v]) => (
            <div key={k}>
              <div style={{ fontSize:"10px", fontWeight:"700", color: C.muted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:"3px" }}>{k}</div>
              <div style={{ fontSize:"12px", color:"#374151", lineHeight:1.6 }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
export const headers = (h) => boundary.headers(h);
