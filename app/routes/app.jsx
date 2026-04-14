import { useEffect, useState } from "react";
import { Outlet, redirect, useFetcher, useLoaderData, useLocation, useNavigate, useRevalidator, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import { Banner, BlockStack, Box, Button, InlineStack, Modal, Page, Text, TextField } from "@shopify/polaris";
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
import { withEmbeddedAppParams, withEmbeddedAppParamsFromRequest } from "../utils/embedded-app";
import { showPolarisToast } from "../utils/polaris-toast";
import { sendMail } from "../utils/mailer.server";
import { installedEmailHtml } from "../emails/app-installed";
import { ownerInstallNotifyHtml } from "../emails/owner-notify";
import { buildEmbedBlockUrl, getEmbedBlockStatus } from "../utils/theme-editor.server";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const pathname = url.pathname;
  const subscribedCallback = url.searchParams.get("subscribed") === "1";
  // Routes that are always allowed regardless of subscription state
  const isPricingRoute = pathname === "/app/pricing" || pathname === "/app/plan";
  const isBillingCallback = pathname === "/app/billing-success" || subscribedCallback;

  const { getSubscription, hasPlanAccess } = await import("../models/subscription.server.js");
  const subscription = await getSubscription(session.shop);
  const hasAccess = hasPlanAccess(subscription);
  if (!hasAccess && !isPricingRoute && !isBillingCallback) {
    throw redirect(withEmbeddedAppParamsFromRequest("/app/pricing", request));
  }

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
  const [embedBlockUrl, embedBlockEnabled] = await Promise.all([
    buildEmbedBlockUrl({ shop: session.shop, admin }),
    getEmbedBlockStatus({ shop: session.shop, admin, session }),
  ]);

  // eslint-disable-next-line no-undef
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    reviewPrompt,
    supportContactEmail: process.env.APP_OWNER_EMAIL || process.env.SUPPORT_EMAIL || "support@example.com",
    appDisplayName: process.env.APP_NAME || "MixBox - Box & Bundle Builder",
    reviewLink: process.env.REVIEW_LINK || process.env.APP_REVIEW_URL || null,
    embedBlockUrl,
    embedBlockEnabled,
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

  if (intent === "submit_support_message") {
    const message = String(formData.get("message") || "").trim();
    if (message.length < 30) {
      return { ok: false, supportError: "Please enter at least 30 characters." };
    }

    const supportEmail = process.env.APP_OWNER_EMAIL || process.env.SUPPORT_EMAIL;
    if (!supportEmail) {
      return { ok: false, supportError: "Support email is not configured." };
    }

    await sendMail(
      supportEmail,
      `Support message from ${session.shop}`,
      `
        <h2>Support message</h2>
        <p><strong>Shop:</strong> ${session.shop}</p>
        <p><strong>Message:</strong></p>
        <pre style="white-space: pre-wrap; font-family: inherit;">${message}</pre>
      `,
    );

    return { ok: true, supportSubmitted: true };
  }

  return { ok: false };
};

export default function App() {
  const {
    apiKey,
    reviewPrompt,
    supportContactEmail,
    appDisplayName,
    reviewLink,
    embedBlockUrl,
    embedBlockEnabled,
  } = useLoaderData();
  const location = useLocation();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const reviewFetcher = useFetcher();
  const supportFetcher = useFetcher();
  const reviewActionUrl = withEmbeddedAppParams("/app", location.search);

  const [showReviewPopup, setShowReviewPopup] = useState(() => Boolean(reviewPrompt?.shouldShow));
  const [showSupportPopup, setShowSupportPopup] = useState(false);
  const [rating, setRating] = useState(5);
  const [feedback, setFeedback] = useState("");
  const [supportMessage, setSupportMessage] = useState("");

  useEffect(() => {
    if (reviewFetcher.state !== "idle" || !reviewFetcher.data?.ok) return;
    if (reviewFetcher.data.dismissed || reviewFetcher.data.submitted) {
      setShowReviewPopup(false);
    }
  }, [reviewFetcher.state, reviewFetcher.data]);

  useEffect(() => {
    if (supportFetcher.state !== "idle") return;
    if (supportFetcher.data?.ok && supportFetcher.data?.supportSubmitted) {
      setShowSupportPopup(false);
      setSupportMessage("");
      showPolarisToast("Support message sent successfully.");
    } else if (supportFetcher.data?.supportError) {
      showPolarisToast(supportFetcher.data.supportError, { isError: true });
    }
  }, [supportFetcher.state, supportFetcher.data]);

  useEffect(() => {
    if (reviewPrompt?.shouldShow) {
      setShowReviewPopup(true);
    }
  }, [reviewPrompt?.shouldShow]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const message = params.get("toast");
    if (!message) return;

    const tone = params.get("toastTone");
    showPolarisToast(message, { isError: tone === "error" });
    // Ensure root loader gets fresh reviewPrompt immediately after actions with toast redirects.
    revalidator.revalidate();

    params.delete("toast");
    params.delete("toastTone");
    const nextSearch = params.toString();
    navigate(
      { pathname: location.pathname, search: nextSearch ? `?${nextSearch}` : "" },
      { replace: true },
    );
  }, [location.pathname, location.search, navigate, revalidator]);

  function dismissPopup() {
    if (reviewFetcher.state !== "idle") return;
    setShowReviewPopup(false);
    reviewFetcher.submit(
      { _action: "dismiss_review_popup" },
      { method: "post", action: reviewActionUrl },
    );
  }

  function openSupportPopup() {
    setShowReviewPopup(false);
    setShowSupportPopup(true);
  }

  function closeSupportPopup() {
    if (supportFetcher.state !== "idle") return;
    setShowSupportPopup(false);
  }

  function submitSupportMessage() {
    if (supportFetcher.state !== "idle") return;
    supportFetcher.submit(
      {
        _action: "submit_support_message",
        message: supportMessage,
      },
      { method: "post", action: reviewActionUrl },
    );
  }

  function submitReview() {
    if (reviewFetcher.state !== "idle") return;
    if (reviewLink) {
      try {
        window.open(reviewLink, "_blank", "noopener,noreferrer");
      } catch {}
    }
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
      {!embedBlockEnabled && (
        <Page>
          <Banner
            tone="warning"
            title="Theme App Embed not active"
            action={{ content: "Activate now", url: embedBlockUrl, target: "_blank" }}
          >
            <p>Enable the MixBox – Box & Bundle Builder app embed in Theme Customize.</p>
          </Banner>
        </Page>
      )}
      <Outlet />

      <Modal
        open={showReviewPopup}
        onClose={dismissPopup}
        title="Review this app"
        size="medium"
      >
        <Modal.Section>
          <BlockStack gap="400">
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
                  <image src="/images/Bluk Bundle products 1.jpg" alt="Star icon" width="24" height="24" />
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
            {reviewLink ? (
              <Text as="p" tone="subdued" variant="bodySm">
                Submitting opens the Shopify App Store review page directly.
              </Text>
            ) : null}

            <Box borderBlockStartWidth="025" borderColor="border">
              <InlineStack align="end" gap="200">
                <Button onClick={dismissPopup} disabled={reviewFetcher.state !== "idle"}>
                  Remind me tomorrow
                </Button>
                <Button onClick={openSupportPopup} disabled={reviewFetcher.state !== "idle"}>
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

      <Modal
        open={showSupportPopup}
        onClose={closeSupportPopup}
        title={appDisplayName}
        size="large"
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="h3" variant="headingMd">Send a message to the developer.</Text>

            <TextField
              label="Support message"
              labelHidden
              value={supportMessage}
              onChange={setSupportMessage}
              name="supportMessage"
              maxLength={2000}
              autoComplete="off"
              multiline={6}
              placeholder="Minimum 30 characters"
              disabled={supportFetcher.state !== "idle"}
            />
            <InlineStack align="space-between" blockAlign="center">
              <Text as="p" tone="subdued">
                Replies will be sent to {supportContactEmail}.
              </Text>
              <Text as="p" tone="subdued">
                {supportMessage.length}
              </Text>
            </InlineStack>

            <Box borderBlockStartWidth="025" borderColor="border">
              <InlineStack align="end" gap="200">
                <Button onClick={closeSupportPopup} disabled={supportFetcher.state !== "idle"}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={submitSupportMessage}
                  loading={supportFetcher.state !== "idle"}
                  disabled={supportMessage.trim().length < 30}
                >
                  Send
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
