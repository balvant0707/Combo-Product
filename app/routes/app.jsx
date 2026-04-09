import { useEffect, useState } from "react";
import { Outlet, useFetcher, useLoaderData, useLocation, useNavigate, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import "@shopify/polaris/build/esm/styles.css";
import { authenticate } from "../shopify.server";
import {
  dismissShopReviewPrompt,
  getShopReviewPromptState,
  submitShopReview,
  upsertSessionFromAuth,
  upsertShopFromAdmin,
} from "../models/shop.server";
import { withEmbeddedAppParams } from "../utils/embedded-app";
import { showPolarisToast } from "../utils/polaris-toast";
import { sendMail } from "../utils/mailer.server";
import { installedEmailHtml } from "../emails/app-installed";
import { ownerInstallNotifyHtml } from "../emails/owner-notify";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);

  await upsertSessionFromAuth(session);
  const installInfo = await upsertShopFromAdmin(session, admin);

  // Send install emails only on first install or reinstall
  if (installInfo?.isNewInstall) {
    const emailData = {
      ownerName:  installInfo.ownerName,
      shopName:   installInfo.shopName,
      shopDomain: installInfo.shopDomain,
      email:      installInfo.email,
      plan:       installInfo.plan,
      country:    installInfo.country,
    };

    const mailJobs = [];

    mailJobs.push(
      sendMail(
        installInfo.email,
        `Welcome to MixBox – Box & Bundle Builder! 🎉`,
        installedEmailHtml(emailData),
      ).catch((err) => console.error("[install] merchant welcome email failed", err)),
    );

    mailJobs.push(
      sendMail(
        process.env.APP_OWNER_EMAIL,
        `🎉 New App Install: ${installInfo.shopName || installInfo.shopDomain}`,
        ownerInstallNotifyHtml(emailData),
      ).catch((err) => console.error("[install] owner notification failed", err)),
    );

    // Must await — Vercel kills background promises before they complete (fire-and-forget doesn't work)
    await Promise.all(mailJobs);
  }

  const reviewPrompt = await getShopReviewPromptState(session.shop);

  // eslint-disable-next-line no-undef
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    reviewPrompt,
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("_action");

  if (intent === "dismiss_review_popup") {
    await dismissShopReviewPrompt(session.shop);
    return { ok: true, dismissed: true };
  }

  if (intent === "submit_review_popup") {
    await submitShopReview(session.shop, {
      rating: formData.get("rating"),
      feedback: formData.get("feedback"),
    });
    return { ok: true, submitted: true };
  }

  return { ok: false };
};

export default function App() {
  const { apiKey, reviewPrompt } = useLoaderData();
  const location = useLocation();
  const navigate = useNavigate();
  const reviewFetcher = useFetcher();
  const reviewActionUrl = withEmbeddedAppParams("/app", location.search);

  const [showReviewPopup, setShowReviewPopup] = useState(() => Boolean(reviewPrompt?.shouldShow));
  const [rating, setRating] = useState(5);

  useEffect(() => {
    if (reviewFetcher.state !== "idle" || !reviewFetcher.data?.ok) return;
    if (reviewFetcher.data.dismissed || reviewFetcher.data.submitted) {
      setShowReviewPopup(false);
    }
  }, [reviewFetcher.state, reviewFetcher.data]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const message = params.get("toast");
    if (!message) return;

    const tone = params.get("toastTone");
    showPolarisToast(message, { isError: tone === "error" });

    params.delete("toast");
    params.delete("toastTone");
    const nextSearch = params.toString();
    navigate(
      { pathname: location.pathname, search: nextSearch ? `?${nextSearch}` : "" },
      { replace: true },
    );
  }, [location.pathname, location.search, navigate]);

  function dismissPopup() {
    if (reviewFetcher.state !== "idle") return;
    setShowReviewPopup(false);
    reviewFetcher.submit(
      { _action: "dismiss_review_popup" },
      { method: "post", action: reviewActionUrl },
    );
  }

  return (
    <AppProvider embedded apiKey={apiKey}>
      <style>{`
        :root {
          --cb-admin-radius: 4px;
          --p-border-radius-100: 4px;
          --p-border-radius-150: 4px;
          --p-border-radius-200: 4px;
          --p-border-radius-300: 4px;
          --p-border-radius-400: 4px;
          --p-border-radius-500: 4px;
        }

        s-card,
        s-box {
          border-radius: var(--cb-admin-radius) !important;
        }

        s-page :is(div, section, article)[style*="border-radius"]:not([style*="50%"]):not([style*="999px"]):not([style*="99px"]) {
          border-radius: var(--cb-admin-radius) !important;
        }

        s-page :is([class*="card"], [class*="box"]) {
          border-radius: var(--cb-admin-radius) !important;
        }

        ui-title-bar button {
          background: #000000;
          color: #ffffff;
          border: 1px solid #000000;
          border-radius: var(--cb-admin-radius);
          padding: 8px 16px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }

        ui-title-bar button:hover {
          background: #000000;
          color: #ffffff;
          border-color: #000000;
        }
      `}</style>
      <s-app-nav>
        {/* <s-link href="/app">Dashboard</s-link> */}
        <s-link href={withEmbeddedAppParams("/app/boxes", location.search)}>Manage Boxes</s-link>
        <s-link href={withEmbeddedAppParams("/app/analytics", location.search)}>Analytics</s-link>
        <s-link href={withEmbeddedAppParams("/app/customize", location.search)}>Customize</s-link>
        <s-link href={withEmbeddedAppParams("/app/pricing", location.search)}>Plan</s-link>
      </s-app-nav>
      <Outlet />

      {showReviewPopup && (
        <div
          role="presentation"
          onClick={dismissPopup}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(15, 23, 42, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="App review"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(520px, 100%)",
              background: "#ffffff",
              border: "1px solid #e5e7eb",
              borderRadius: "12px",
              boxShadow: "0 30px 70px rgba(15, 23, 42, 0.25)",
              padding: "20px",
              fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <div style={{ fontSize: "18px", fontWeight: "700", color: "#111827" }}>
                Enjoying MixBox - Box & Bundle Builder?
              </div>
              <button
                type="button"
                onClick={dismissPopup}
                disabled={reviewFetcher.state !== "idle"}
                style={{
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  color: "#111827",
                  fontSize: "20px",
                  lineHeight: 1,
                  padding: 0,
                }}
                aria-label="Close review popup"
              >
                x
              </button>
            </div>

            <p style={{ margin: "0 0 14px", color: "#111827", fontSize: "14px", lineHeight: 1.5 }}>
              It has been {reviewPrompt?.daysSinceInstall ?? 0} days since app install. Please share a quick review.
              Closing this popup snoozes it for {reviewPrompt?.snoozeDays ?? 1} day.
            </p>

            <reviewFetcher.Form method="post" action={reviewActionUrl}>
              <input type="hidden" name="_action" value="submit_review_popup" />
              <input type="hidden" name="rating" value={rating} />

              <div style={{ marginBottom: "12px" }}>
                <div style={{ fontSize: "12px", fontWeight: "600", color: "#111827", marginBottom: "8px" }}>Rating</div>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setRating(value)}
                      disabled={reviewFetcher.state !== "idle"}
                      aria-label={`Rate ${value} star${value > 1 ? "s" : ""}`}
                      style={{
                        width: "40px",
                        height: "36px",
                        borderRadius: "8px",
                        border: value <= rating ? "1px solid #f59e0b" : "1px solid #d1d5db",
                        background: value <= rating ? "#fffbeb" : "#ffffff",
                        color: value <= rating ? "#f59e0b" : "#9ca3af",
                        fontWeight: "700",
                        fontSize: "18px",
                        cursor: "pointer",
                      }}
                    >
                      ★
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: "14px" }}>
                <div style={{ fontSize: "12px", fontWeight: "600", color: "#111827", marginBottom: "8px" }}>Feedback (optional)</div>
                <textarea
                  name="feedback"
                  maxLength={2000}
                  placeholder="What can we improve?"
                  disabled={reviewFetcher.state !== "idle"}
                  style={{
                    width: "100%",
                    minHeight: "88px",
                    borderRadius: "8px",
                    border: "1px solid #d1d5db",
                    padding: "10px",
                    fontSize: "13px",
                    fontFamily: "inherit",
                    color: "#111827",
                    resize: "vertical",
                  }}
                />
              </div>

              <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={dismissPopup}
                  disabled={reviewFetcher.state !== "idle"}
                  style={{
                    border: "1px solid #d1d5db",
                    background: "#ffffff",
                    color: "#111827",
                    borderRadius: "8px",
                    padding: "8px 14px",
                    fontSize: "13px",
                    fontWeight: "600",
                    cursor: "pointer",
                  }}
                >
                  Remind me tomorrow
                </button>
                <button
                  type="submit"
                  disabled={reviewFetcher.state !== "idle"}
                  style={{
                    border: "1px solid #000000",
                    background: "#000000",
                    color: "#ffffff",
                    borderRadius: "8px",
                    padding: "8px 14px",
                    fontSize: "13px",
                    fontWeight: "600",
                    cursor: "pointer",
                  }}
                >
                  {reviewFetcher.state !== "idle" ? "Saving..." : "Submit review"}
                </button>
              </div>
            </reviewFetcher.Form>
          </div>
        </div>
      )}
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
