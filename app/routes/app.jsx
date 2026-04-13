import { useEffect, useState } from "react";
import { Outlet, useFetcher, useLoaderData, useLocation, useNavigate, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import { Banner, BlockStack, Box, Button, InlineStack, Modal, Text, TextField } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
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
  const [feedback, setFeedback] = useState("");

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

  function submitReview() {
    if (reviewFetcher.state !== "idle") return;
    reviewFetcher.submit(
      {
        _action: "submit_review_popup",
        rating: String(rating),
        feedback,
      },
      { method: "post", action: reviewActionUrl },
    );
  }

  return (
    <ShopifyAppProvider embedded apiKey={apiKey}>
      <PolarisAppProvider i18n={enTranslations}>
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
        <s-link href={withEmbeddedAppParams("/app/boxes", location.search)}>Manage Bundle Boxes</s-link>
        <s-link href={withEmbeddedAppParams("/app/analytics", location.search)}>Analytics</s-link>
        <s-link href={withEmbeddedAppParams("/app/widget-settings", location.search)}>Widget Settings</s-link>
        <s-link href={withEmbeddedAppParams("/app/pricing", location.search)}>Price Plan</s-link>
      </s-app-nav>
      <Outlet />

      <Modal
        open={showReviewPopup}
        onClose={dismissPopup}
        title="Review this app"
        size="large"
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Banner tone="info">
              <p>Development stores aren't eligible to review apps. This is for testing purposes only.</p>
            </Banner>

            <BlockStack gap="200">
              <InlineStack gap="300" blockAlign="start">
                <Box
                  as="div"
                  style={{
                    width: "52px",
                    height: "52px",
                    borderRadius: "10px",
                    background: "linear-gradient(135deg, #f97316 0%, #fb7185 100%)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#ffffff",
                    fontSize: "26px",
                    flexShrink: 0,
                  }}
                >
                  ⬢
                </Box>
                <BlockStack gap="100">
                  <Text as="p" variant="headingMd" fontWeight="semibold">
                    How would you rate MixBox - Box & Bundle Builder?
                  </Text>
                  <InlineStack gap="100" wrap>
                    {[1, 2, 3, 4, 5].map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setRating(value)}
                        disabled={reviewFetcher.state !== "idle"}
                        aria-label={`Rate ${value} star${value > 1 ? "s" : ""}`}
                        style={{
                          width: "28px",
                          height: "28px",
                          border: "none",
                          background: "transparent",
                          color: value <= rating ? "#f59e0b" : "#9ca3af",
                          fontWeight: "700",
                          fontSize: "22px",
                          lineHeight: 1,
                          cursor: "pointer",
                          padding: 0,
                        }}
                      >
                        ★
                      </button>
                    ))}
                  </InlineStack>
                </BlockStack>
              </InlineStack>
            </BlockStack>

            <BlockStack gap="100">
              <Text as="p" variant="headingMd">
                Describe your experience (optional)
              </Text>
              <TextField
                label="Review details"
                labelHidden
                value={feedback}
                onChange={setFeedback}
                name="feedback"
                maxLength={2000}
                autoComplete="off"
                multiline={6}
                placeholder="What should other merchants know about this app?"
                disabled={reviewFetcher.state !== "idle"}
              />
            </BlockStack>

            <Text as="p" tone="subdued" variant="bodySm">
              If your review is published on the Shopify App Store, we'll include some details about your store.
            </Text>

            <Box borderBlockStartWidth="025" borderColor="border">
              <InlineStack align="end" gap="200">
                <Button onClick={dismissPopup} disabled={reviewFetcher.state !== "idle"}>
                  Get support
                </Button>
                <Button
                  variant="primary"
                  onClick={submitReview}
                  loading={reviewFetcher.state !== "idle"}
                  disabled={rating < 1}
                >
                  Submit
                </Button>
              </InlineStack>
            </Box>
          </BlockStack>
        </Modal.Section>
      </Modal>
      </PolarisAppProvider>
    </ShopifyAppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
