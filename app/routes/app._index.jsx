/* eslint-disable react/prop-types */
import { useState } from "react";
import { useLoaderData, useLocation, useNavigate, useNavigation } from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  InlineStack,
  Layout,
  Modal,
  Page,
  Spinner,
  Text,
} from "@shopify/polaris";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getActiveBoxCount } from "../models/boxes.server";
import {
  getBundlesSoldCount,
  getBundleRevenue,
  getRecentOrders,
} from "../models/orders.server";
import {
  buildThemeEditorUrl,
  buildEmbedBlockUrl,
  getEmbedBlockStatus,
} from "../utils/theme-editor.server";
import { withEmbeddedAppParams } from "../utils/embedded-app";

function parseOrderSelectedProducts(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => String(entry || "").trim()).filter(Boolean);
      }
    } catch {
      return [trimmed];
    }
    return [trimmed];
  }
  return [];
}

function isSpecificComboFromBox(box) {
  if (!box) return false;
  const cfgType = Number.parseInt(box?.config?.comboType, 10);
  if (Number.isFinite(cfgType) && cfgType > 0) return true;
  const raw = typeof box?.comboStepsConfig === "string" ? box.comboStepsConfig.trim() : "";
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    const parsedType = Number.parseInt(parsed?.comboType ?? parsed?.type, 10);
    if (Number.isFinite(parsedType) && parsedType > 0) return true;
    if (Array.isArray(parsed?.steps) && parsed.steps.length > 0) return true;
  } catch {
    return false;
  }
  return false;
}

export const loader = async ({ request }) => {
  const { session, admin, billing } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const rawWhatsappNumber =
    process.env.WHATSAPP_NUMBER ||
    process.env.WHATSAPP_PHONE ||
    process.env.WHATSAPP_CONTACT_NUMBER ||
    process.env.APP_WHATSAPP_NUMBER ||
    "";
  const whatsappDigits = String(rawWhatsappNumber).replace(/\D/g, "");
  const whatsappLink = whatsappDigits ? `https://wa.me/${whatsappDigits}` : "#";
  const supportTicketLink = process.env.SUPPORT_TICKET_URL || "#";
  const knowledgeBaseLink = process.env.KNOWLEDGE_BASE_URL || "#";
  const reviewLink = process.env.REVIEW_LINK || process.env.APP_REVIEW_URL || "#";
  const reportIssueLink = process.env.REPORT_ISSUE_URL || "#";

  if (url.searchParams.get("subscribed") === "1") {
    const { syncSubscription } = await import("../models/billing.server.js");
    const { setShopPlanStatus } = await import("../models/shop.server.js");
    const { subscription } = await syncSubscription(billing, shop);

    if (subscription?.subscriptionId || process.env.SKIP_BILLING === "true") {
      await setShopPlanStatus(shop, "active").catch(() => {});
    }
  }

  const [activeBoxCount, bundlesSold, bundleRevenue, recentOrders] =
    await Promise.all([
      getActiveBoxCount(shop),
      getBundlesSoldCount(shop),
      getBundleRevenue(shop),
      getRecentOrders(shop, 10),
    ]);

  const [themeEditorUrl, embedBlockUrl, embedBlockEnabled] = await Promise.all([
    buildThemeEditorUrl({ shop, admin }),
    buildEmbedBlockUrl({ shop, admin }),
    getEmbedBlockStatus({ shop, admin, session }),
  ]);

  return {
    activeBoxCount,
    bundlesSold,
    bundleRevenue,
    themeEditorUrl,
    embedBlockUrl,
    embedBlockEnabled,
    whatsappLink,
    supportTicketLink,
    knowledgeBaseLink,
    reviewLink,
    reportIssueLink,
    recentOrders: recentOrders.map((order) => ({
      id: order.id,
      orderId: order.orderId,
      boxTitle: order.box?.displayTitle || "Unknown Box",
      itemCount: order.box?.itemCount || 0,
      comboType: isSpecificComboFromBox(order.box) ? "specific" : "simple",
      comboTypeLabel: isSpecificComboFromBox(order.box)
        ? "Specific Combo Product"
        : "Simple Combo Product",
      selectedProducts: parseOrderSelectedProducts(order.selectedProducts),
      bundlePrice: parseFloat(order.bundlePrice),
      orderDate: order.orderDate.toISOString(),
    })),
  };
};

const createBoxActions = [
  {
    key: "create-box",
    label: "Create Combo Box",
    sub: "Quick setup for fixed bundles and a fast purchase flow.",
    href: "/app/boxes/new",
  },
  {
    key: "create-specific-combo",
    label: "Create Specific Combo Box",
    sub: "Guided step-by-step customization for personalized bundles.",
    href: "/app/boxes/specific-combo",
  },
];

const quickActions = [
  {
    key: "manage-boxes",
    label: "Manage Boxes",
    sub: "Edit existing combos",
    href: "/app/boxes",
  },
  {
    key: "analytics",
    label: "View Analytics",
    sub: "Sales and revenue",
    href: "/app/analytics",
  },
  {
    key: "settings",
    label: "Widget Settings",
    sub: "Theme and appearance",
    href: "/app/settings",
  },
];

const promotedApps = [
  {
    key: "cartlift",
    title: "CartLift: Cart Drawer and Upsell",
    tag: "Upsell",
    url: "https://apps.shopify.com/cartlift-cart-drawer-upsell",
    description:
      "Grow average order value with cart drawer upsells and smart cart offers.",
  },
  {
    key: "fomoify",
    title: "Fomoify Sales Popup and Proof",
    tag: "Social Proof",
    url: "https://apps.shopify.com/fomoify-sales-popup-proof",
    description:
      "Increase trust using real-time sales popups and conversion proof nudges.",
  },
];

function DashboardStat({ label, value, sub }) {
  return (
    <Card>
      <BlockStack gap="200">
        <Text as="h3" variant="headingSm">
          {label}
        </Text>
        <Text as="p" variant="heading2xl">
          {value}
        </Text>
        <Text as="p" tone="subdued" variant="bodySm">
          {sub}
        </Text>
      </BlockStack>
    </Card>
  );
}

export default function DashboardPage() {
  const {
    activeBoxCount,
    bundlesSold,
    bundleRevenue,
    themeEditorUrl,
    embedBlockUrl,
    embedBlockEnabled,
  } = useLoaderData();
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [showCreateBoxModal, setShowCreateBoxModal] = useState(false);
  const [showSetupDetails, setShowSetupDetails] = useState(false);

  const justSubscribed = new URLSearchParams(location.search).get("subscribed") === "1";
  const isPageLoading = navigation.state !== "idle";

  const stats = [
    {
      label: "Active Boxes",
      value: activeBoxCount,
      sub: "Live combo box types",
    },
    {
      label: "Bundles Sold",
      value: bundlesSold,
      sub: "Last 30 days",
    },
    {
      label: "Bundle Revenue",
      value: `\u20B9${Number(bundleRevenue).toLocaleString("en-IN")}`,
      sub: "Last 30 days",
    },
    {
      label: "Conversion Rate",
      value: "-",
      sub: "Coming soon",
    },
  ];

  function navigateTo(path) {
    navigate(withEmbeddedAppParams(path, location.search));
  }

  return (
    <Page
      title="MixBox - Box and Bundle Builder"
      primaryAction={{
        content: "Create Box",
        onAction: () => setShowCreateBoxModal(true),
      }}
    >
      <BlockStack gap="400">
        {justSubscribed && (
          <Banner tone="success" title="Pro plan activated">
            <p>All premium features are now unlocked.</p>
          </Banner>
        )}

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="h2" variant="headingMd">
                        Theme App Embed Block
                      </Text>
                      <Badge tone={embedBlockEnabled ? "success" : "attention"}>
                        {embedBlockEnabled ? "Enabled" : "Not enabled"}
                      </Badge>
                    </InlineStack>
                    <Text as="p" tone="subdued">
                      The embed block loads Combo Builder scripts globally on your storefront.
                    </Text>
                  </BlockStack>
                  {!embedBlockEnabled && (
                    <Button url={embedBlockUrl} target="_blank" variant="primary">
                      Activate
                    </Button>
                  )}
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Add Combo Builder to Your Theme
                  </Text>
                  <Button
                    variant="plain"
                    onClick={() => setShowSetupDetails((prev) => !prev)}
                  >
                    {showSetupDetails ? "Hide setup" : "Show setup"}
                  </Button>
                </InlineStack>
                <Text as="p" tone="subdued">
                  One click opens the theme editor with the block pre-loaded. Drag, drop, and save.
                </Text>

                {showSetupDetails && (
                  <BlockStack gap="200">
                    <Text as="p">1. Opens Theme Customization on your live product template.</Text>
                    <Text as="p">2. Combo Builder block is auto-added to the Apps section.</Text>
                    <Text as="p">3. Drag the block to the right position.</Text>
                    <Text as="p">4. Click Save and your storefront is live.</Text>
                  </BlockStack>
                )}

                <InlineStack>
                  <Button url={themeEditorUrl} target="_blank" variant="primary">
                    Open Theme Editor
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Quick Actions
                </Text>
                <InlineStack gap="200" wrap>
                  <Button onClick={() => setShowCreateBoxModal(true)} variant="primary">
                    Create Box
                  </Button>
                  {quickActions.map((action) => (
                    <Button key={action.key} onClick={() => navigateTo(action.href)}>
                      {action.label}
                    </Button>
                  ))}
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <BlockStack gap="300">
              {stats.map((stat) => (
                <DashboardStat
                  key={stat.label}
                  label={stat.label}
                  value={stat.value}
                  sub={stat.sub}
                />
              ))}
            </BlockStack>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Boost your store performance with our apps
                </Text>
                <BlockStack gap="300">
                  {promotedApps.map((appItem) => (
                    <Card key={appItem.key}>
                      <BlockStack gap="200">
                        <InlineStack align="space-between" blockAlign="start">
                          <Text as="h3" variant="headingSm">
                            {appItem.title}
                          </Text>
                          <Badge>{appItem.tag}</Badge>
                        </InlineStack>
                        <Text as="p" tone="subdued">
                          {appItem.description}
                        </Text>
                        <InlineStack>
                          <Button url={appItem.url} target="_blank" variant="primary">
                            Add app
                          </Button>
                        </InlineStack>
                      </BlockStack>
                    </Card>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>

      <Modal
        open={showCreateBoxModal}
        onClose={() => setShowCreateBoxModal(false)}
        title="Create Box"
      >
        <Modal.Section>
          <BlockStack gap="300">
            {createBoxActions.map((action) => (
              <Card key={action.key}>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">
                    {action.label}
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    {action.sub}
                  </Text>
                  <InlineStack>
                    <Button
                      variant="primary"
                      onClick={() => {
                        setShowCreateBoxModal(false);
                        navigateTo(action.href);
                      }}
                    >
                      Continue
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            ))}
          </BlockStack>
        </Modal.Section>
      </Modal>

      {isPageLoading && (
        <Box
          as="div"
          padding="400"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10001,
            background: "rgba(255,255,255,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Spinner accessibilityLabel="Loading page" size="large" />
        </Box>
      )}
    </Page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
