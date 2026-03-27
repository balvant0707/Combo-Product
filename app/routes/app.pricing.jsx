/* eslint-disable react/prop-types */
/**
 * app.pricing.jsx
 * Shopify Billing - Free & Pro plan selection.
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

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);

  const { syncSubscription, getBoxCount } = await import("../models/billing.server.js");
  const { activatePaidPlan, PLANS } = await import("../models/subscription.server.js");

  const { subscription, billingUnavailable } = await syncSubscription(admin, shop);

  if (url.searchParams.get("subscribed") === "1" && subscription?.subscriptionId) {
    await activatePaidPlan(shop, {
      plan: subscription.plan || "PRO",
      subscriptionId: subscription.subscriptionId,
      currentPeriodEnd: subscription.currentPeriodEnd,
    }).catch(() => {});

    return rrRedirect(withEmbeddedAppParamsFromRequest("/app?subscribed=1", request));
  }

  const boxCount = await getBoxCount(shop);
  const isDevMode = process.env.SKIP_BILLING === "true";

  return {
    subscription,
    billingUnavailable: !isDevMode && billingUnavailable,
    isDevMode,
    boxCount,
    plans: Object.values(PLANS),
    subscribed: url.searchParams.get("subscribed") === "1",
    cancelled: url.searchParams.get("cancelled") === "1",
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");
  const requestUrl = new URL(request.url);

  const { createSubscription, cancelSubscription } = await import("../models/billing.server.js");
  const { activateFreePlan, activatePaidPlan } = await import("../models/subscription.server.js");
  const { setShopPlanStatus } = await import("../models/shop.server.js");

  if (intent === "free") {
    await activateFreePlan(shop);
    await setShopPlanStatus(shop, "free");
    return rrRedirect(withEmbeddedAppParamsFromRequest("/app/boxes", request));
  }

  if (intent === "subscribe") {
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
      const returnPath = withEmbeddedAppParamsFromRequest("/app/billing-success?subscribed=1", request);
      const returnUrl = new URL(returnPath, requestUrl.origin).toString();
      const confirmationUrl = await createSubscription(admin, returnUrl);
      return { confirmationUrl };
    } catch (e) {
      return { error: e.message, billingUnavailable: !!e.isBillingUnavailable };
    }
  }

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

const PRICING_UI_CSS = `
  .pricing-shell {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .pricing-hero {
    background: linear-gradient(180deg, #ffffff 0%, #f6f6f7 100%);
    border: 1px solid #e3e3e3;
    border-radius: 12px;
    padding: 24px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  }

  .pricing-kicker {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 10px;
    padding: 4px 10px;
    border-radius: 999px;
    background: #f1f2f4;
    color: #303030;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .pricing-title {
    margin: 0;
    color: #202223;
    font-size: 28px;
    font-weight: 700;
    line-height: 1.15;
  }

  .pricing-subtitle {
    margin: 8px 0 0;
    color: #616161;
    font-size: 14px;
    line-height: 1.5;
  }

  .pricing-banner {
    border: 1px solid #e3e3e3;
    border-radius: 10px;
    padding: 14px 16px;
    font-size: 13px;
    line-height: 1.55;
  }

  .pricing-banner strong {
    display: block;
    margin-bottom: 4px;
  }

  .pricing-banner.info {
    background: #eff6ff;
    border-color: #bfdbfe;
    color: #1d4ed8;
  }

  .pricing-banner.warning {
    background: #fff8e7;
    border-color: #f4c97a;
    color: #8a4b08;
  }

  .pricing-banner.error {
    background: #fef1f1;
    border-color: #f1b4b4;
    color: #b42318;
  }

  .pricing-banner.success {
    background: #edfdf3;
    border-color: #8cd9a0;
    color: #146c2e;
  }

  .pricing-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    padding: 16px 18px;
    border: 1px solid #e3e3e3;
    border-radius: 10px;
    background: #ffffff;
  }

  .pricing-summary.is-pro {
    background: #111827;
    border-color: #111827;
  }

  .pricing-summary-copy {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .pricing-summary-label {
    color: #202223;
    font-size: 15px;
    font-weight: 700;
  }

  .pricing-summary.is-pro .pricing-summary-label {
    color: #ffffff;
  }

  .pricing-summary-meta {
    color: #616161;
    font-size: 13px;
  }

  .pricing-summary.is-pro .pricing-summary-meta {
    color: rgba(255, 255, 255, 0.72);
  }

  .pricing-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 28px;
    padding: 0 12px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    background: #f1f2f4;
    color: #303030;
  }

  .pricing-summary.is-pro .pricing-pill {
    background: rgba(255, 255, 255, 0.14);
    color: #ffffff;
  }

  .pricing-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }

  .pricing-card {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 24px;
    border: 1px solid #e3e3e3;
    border-radius: 12px;
    background: #ffffff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  }

  .pricing-card.is-current {
    border-color: #111827;
    box-shadow: 0 0 0 1px #111827 inset;
  }

  .pricing-card.is-highlighted {
    border-color: #2a7a4f;
    box-shadow: 0 0 0 1px #2a7a4f inset;
  }

  .pricing-card-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
  }

  .pricing-card-name {
    margin: 0 0 4px;
    color: #202223;
    font-size: 18px;
    font-weight: 700;
  }

  .pricing-card-price {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    margin: 0 0 6px;
  }

  .pricing-card-price strong {
    color: #202223;
    font-size: 34px;
    line-height: 1;
    font-weight: 700;
  }

  .pricing-card-price span {
    color: #616161;
    font-size: 13px;
    padding-bottom: 4px;
  }

  .pricing-card-copy {
    margin: 0;
    color: #616161;
    font-size: 13px;
    line-height: 1.5;
  }

  .pricing-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 24px;
    padding: 0 10px;
    border-radius: 999px;
    background: #f1f2f4;
    color: #303030;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .pricing-badge.success {
    background: #edfdf3;
    color: #146c2e;
  }

  .pricing-feature-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .pricing-feature {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    color: #303030;
    font-size: 13px;
    line-height: 1.5;
  }

  .pricing-feature.muted {
    color: #8a8a8a;
  }

  .pricing-feature-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 999px;
    flex-shrink: 0;
    margin-top: 1px;
    background: #111827;
    color: #ffffff;
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
  }

  .pricing-feature.muted .pricing-feature-icon {
    background: #f1f2f4;
    color: #8a8a8a;
  }

  .pricing-card-body {
    display: flex;
    flex-direction: column;
    gap: 18px;
    flex: 1;
  }

  .pricing-card-action {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .pricing-card-action s-button {
    width: 100%;
  }

  .pricing-static-note {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    padding: 0 14px;
    border-radius: 10px;
    background: #f6f6f7;
    border: 1px solid #e3e3e3;
    color: #616161;
    font-size: 13px;
    font-weight: 600;
    text-align: center;
  }

  .pricing-facts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .pricing-fact {
    padding: 14px 16px;
    border: 1px solid #e3e3e3;
    border-radius: 10px;
    background: #ffffff;
  }

  .pricing-fact-label {
    margin: 0 0 4px;
    color: #616161;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .pricing-fact-value {
    margin: 0;
    color: #202223;
    font-size: 13px;
    line-height: 1.5;
  }

  @media (max-width: 768px) {
    .pricing-grid,
    .pricing-facts {
      grid-template-columns: 1fr;
    }

    .pricing-card,
    .pricing-hero {
      padding: 20px;
    }
  }
`;

function StatusBanner({ tone, title, children }) {
  return (
    <div className={`pricing-banner ${tone}`}>
      <strong>{title}</strong>
      <div>{children}</div>
    </div>
  );
}

function PlanFeature({ text, muted = false }) {
  return (
    <li className={`pricing-feature${muted ? " muted" : ""}`}>
      <span className="pricing-feature-icon">{muted ? "-" : "✓"}</span>
      <span>{text}</span>
    </li>
  );
}

export default function PricingPage() {
  const { subscription, billingUnavailable, isDevMode, boxCount, plans, subscribed, cancelled } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const isPro = subscription?.plan === "PRO" && subscription?.status === "ACTIVE";
  const isFree = subscription?.plan === "FREE" && subscription?.status === "ACTIVE";
  const hasNoPlan = !subscription || subscription.status === "NONE" || subscription.status === "CANCELLED";
  const billingDown = billingUnavailable || actionData?.billingUnavailable;

  useEffect(() => {
    if (actionData?.confirmationUrl) {
      window.open(actionData.confirmationUrl, "_top");
    }
  }, [actionData?.confirmationUrl]);

  const proPlan = plans.find((p) => p.key === "PRO");
  const freePlan = plans.find((p) => p.key === "FREE");
  const currentPlanLabel = isPro ? "Pro plan active" : isFree ? "Free plan active" : "No plan selected";
  const currentPlanMeta = isPro
    ? `Renews ${subscription?.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "-"}`
    : `${boxCount} box${boxCount !== 1 ? "es" : ""} created · ${hasNoPlan ? "Select a plan below" : "1 box allowed on Free"}`;

  return (
    <s-page heading="Pricing plans">
      <style>{PRICING_UI_CSS}</style>

      <div className="pricing-shell">
        <div className="pricing-hero">
          <div className="pricing-kicker">MixBox billing</div>
          <h1 className="pricing-title">Choose a plan that fits your store</h1>
          <p className="pricing-subtitle">
            Start free for setup and testing. Upgrade to Pro when you need unlimited combo boxes and premium features.
          </p>
        </div>

        {isDevMode && (
          <StatusBanner tone="info" title="Billing bypass active">
            <code>SKIP_BILLING=true</code> is enabled, so Pro activates instantly without opening Shopify billing.
          </StatusBanner>
        )}

        {billingDown && (
          <StatusBanner tone="warning" title="Billing API unavailable">
            Set the app to <strong>Public Distribution</strong> in the Shopify Partner Dashboard to enable paid plans.
          </StatusBanner>
        )}

        {actionData?.error && !actionData?.billingUnavailable && (
          <StatusBanner tone="error" title="Billing request failed">
            {actionData.error}
          </StatusBanner>
        )}

        {subscribed && (
          <StatusBanner tone="success" title="Pro plan activated">
            All premium features are now unlocked for this store.
          </StatusBanner>
        )}

        {cancelled && (
          <StatusBanner tone="warning" title="Subscription cancelled">
            You&apos;ll keep Pro access until the end of the current billing period.
          </StatusBanner>
        )}

        <s-section heading="Current plan">
          <div className={`pricing-summary${isPro ? " is-pro" : ""}`}>
            <div className="pricing-summary-copy">
              <div className="pricing-summary-label">{currentPlanLabel}</div>
              <div className="pricing-summary-meta">{currentPlanMeta}</div>
            </div>
            <div className="pricing-pill">{isPro ? "Pro" : isFree ? "Free" : "No plan"}</div>
          </div>
        </s-section>

        <s-section heading="Plan options">
          <div className="pricing-grid">
            <div className={`pricing-card${isFree ? " is-current" : ""}`}>
              <div className="pricing-card-head">
                <div>
                  <h2 className="pricing-card-name">Free</h2>
                  <div className="pricing-card-price">
                    <strong>$0</strong>
                    <span>/month</span>
                  </div>
                  <p className="pricing-card-copy">Good for setup, testing, and a single live combo box.</p>
                </div>
                {isFree && <div className="pricing-badge">Current</div>}
              </div>

              <div className="pricing-card-body">
                <ul className="pricing-feature-list">
                  {freePlan?.features?.map((feature) => (
                    <PlanFeature key={feature} text={feature} />
                  ))}
                  <PlanFeature text="Unlimited combo boxes" muted />
                  <PlanFeature text="Priority support" muted />
                </ul>

                <div className="pricing-card-action">
                  {isFree ? (
                    <div className="pricing-static-note">Current plan</div>
                  ) : isPro ? (
                    <form method="post">
                      <input type="hidden" name="intent" value="cancel" />
                      <input type="hidden" name="subscriptionId" value={subscription?.subscriptionId || ""} />
                      <s-button type="submit" disabled={isSubmitting || undefined}>
                        {isSubmitting ? "Processing..." : "Downgrade to Free"}
                      </s-button>
                    </form>
                  ) : (
                    <form method="post">
                      <input type="hidden" name="intent" value="free" />
                      <s-button type="submit" disabled={isSubmitting || undefined}>
                        {isSubmitting ? "Starting..." : "Continue with Free"}
                      </s-button>
                    </form>
                  )}
                </div>
              </div>
            </div>

            <div className={`pricing-card${isPro ? " is-current" : " is-highlighted"}`}>
              <div className="pricing-card-head">
                <div>
                  <h2 className="pricing-card-name">Pro</h2>
                  <div className="pricing-card-price">
                    <strong>${proPlan?.price}</strong>
                    <span>/month</span>
                  </div>
                  <p className="pricing-card-copy">
                    {proPlan?.trialDays}-day free trial, then billed monthly through Shopify.
                  </p>
                </div>
                <div className={`pricing-badge${isPro ? "" : " success"}`}>{isPro ? "Current" : "Recommended"}</div>
              </div>

              <div className="pricing-card-body">
                <ul className="pricing-feature-list">
                  {proPlan?.features?.map((feature) => (
                    <PlanFeature key={feature} text={feature} />
                  ))}
                </ul>

                <div className="pricing-card-action">
                  {isPro ? (
                    <div className="pricing-static-note">Pro is active on this store</div>
                  ) : billingDown ? (
                    <div className="pricing-static-note">Billing unavailable right now</div>
                  ) : actionData?.confirmationUrl ? (
                    <div className="pricing-static-note">Opening Shopify billing...</div>
                  ) : (
                    <form method="post">
                      <input type="hidden" name="intent" value="subscribe" />
                      <s-button type="submit" disabled={isSubmitting || undefined}>
                        {isSubmitting ? "Preparing billing..." : `Start ${proPlan?.trialDays}-day free trial`}
                      </s-button>
                    </form>
                  )}
                </div>
              </div>
            </div>
          </div>
        </s-section>

        <s-section heading="Billing details">
          <div className="pricing-facts">
            <div className="pricing-fact">
              <div className="pricing-fact-label">Free trial</div>
              <p className="pricing-fact-value">{proPlan?.trialDays} days free on Pro before the first charge.</p>
            </div>
            <div className="pricing-fact">
              <div className="pricing-fact-label">Billing</div>
              <p className="pricing-fact-value">Monthly, charged to the merchant&apos;s Shopify invoice in USD.</p>
            </div>
            <div className="pricing-fact">
              <div className="pricing-fact-label">Upgrade</div>
              <p className="pricing-fact-value">Pro activates after billing approval and unlocks unlimited combo boxes.</p>
            </div>
            <div className="pricing-fact">
              <div className="pricing-fact-label">Cancellation</div>
              <p className="pricing-fact-value">Cancel anytime. Access continues until the end of the current billing period.</p>
            </div>
          </div>
        </s-section>
      </div>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (h) => boundary.headers(h);
