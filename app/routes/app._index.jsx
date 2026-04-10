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
  DataTable,
  Divider,
  InlineGrid,
  InlineStack,
  Layout,
  Modal,
  Page,
  Spinner,
  Text,
} from "@shopify/polaris";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { AdminIcon } from "../components/admin-icons";
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
  const whatsappLink = whatsappDigits ? `https://wa.me/${whatsappDigits}` : null;
  const supportTicketLink = process.env.SUPPORT_TICKET_URL || null;
  const knowledgeBaseLink = process.env.KNOWLEDGE_BASE_URL || null;
  const reviewLink = process.env.REVIEW_LINK || process.env.APP_REVIEW_URL || null;
  const reportIssueLink = process.env.REPORT_ISSUE_URL || null;

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

  // Order limit tracking for upgrade prompt
  const { getSubscription } = await import("../models/subscription.server.js");
  const { PLANS } = await import("../models/subscription.server.js");
  const subscription = await getSubscription(shop);
  const currentPlan = PLANS[subscription?.plan] ?? PLANS.FREE;
  const orderLimit = currentPlan.orderLimit;

  // Count orders in the current calendar month
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const { getAnalytics } = await import("../models/orders.server.js");
  const monthlyAnalytics = await getAnalytics(
    shop,
    monthStart.toISOString().slice(0, 10),
    now.toISOString().slice(0, 10),
  );
  const monthlyOrderCount = monthlyAnalytics.totalOrders;
  const orderLimitReached = isFinite(orderLimit) && monthlyOrderCount >= orderLimit;
  const orderLimitWarning = isFinite(orderLimit) && !orderLimitReached && monthlyOrderCount >= orderLimit * 0.8;

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
    currentPlanName: currentPlan.name,
    orderLimit: isFinite(orderLimit) ? orderLimit : null,
    monthlyOrderCount,
    orderLimitReached,
    orderLimitWarning,
    recentOrders: recentOrders.map((order) => ({
      id: order.id,
      orderId: order.orderId,
      boxTitle: order.box?.displayTitle || "Unknown Box",
      itemCount: order.box?.itemCount || 0,
      comboType: isSpecificComboFromBox(order.box) ? "specific" : "simple",
      selectedProducts: parseOrderSelectedProducts(order.selectedProducts),
      bundlePrice: parseFloat(order.bundlePrice),
      orderDate: order.orderDate.toISOString(),
    })),
  };
};

const createBoxActions = [
  {
    key: "create-box",
    icon: "package",
    label: "Create Fixed Bundle Box",
    sub: "Launch a preconfigured bundle box to increase average order value fast.",
    href: "/app/boxes/new",
  },
  {
    key: "create-specific-combo",
    icon: "target",
    label: "Create Build-Your-Own Bundle Box",
    sub: "Set up step-based bundle customization so shoppers can build a personalized box.",
    href: "/app/boxes/specific-combo",
  },
];

const quickActions = [
  { key: "manage-boxes", label: "Manage Boxes", sub: "Edit existing combos", href: "/app/boxes" },
  { key: "analytics", label: "View Analytics", sub: "Sales and revenue", href: "/app/analytics" },
  { key: "settings", label: "Widget Settings", sub: "Theme and appearance", href: "/app/settings" },
];

const promotedApps = [
  {
    key: "cartlift",
    title: "CartLift: Cart Drawer and Upsell",
    tag: "Upsell",
    url: "https://apps.shopify.com/cartlift-cart-drawer-upsell",
    image: "/images/cartlift.png",
    description: "Grow average order value with cart drawer upsells and smart cart offers.",
  },
  {
    key: "fomoify",
    title: "Fomoify Sales Popup and Proof",
    tag: "Social Proof",
    url: "https://apps.shopify.com/fomoify-sales-popup-proof",
    image: "/images/fomoify.png",
    description: "Increase trust using real-time sales popups and conversion proof nudges.",
  },
];

function StatCard({ label, value, sub }) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">
          {label}
        </Text>
        <Text as="p" variant="heading2xl">
          {value}
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
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
    whatsappLink,
    supportTicketLink,
    knowledgeBaseLink,
    reviewLink,
    recentOrders,
    currentPlanName,
    orderLimit,
    monthlyOrderCount,
    orderLimitReached,
    orderLimitWarning,
  } = useLoaderData();

  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [showCreateBoxModal, setShowCreateBoxModal] = useState(false);
  const [showSetupSteps, setShowSetupSteps] = useState(false);
  const [pendingCreateAction, setPendingCreateAction] = useState(null);

  const justSubscribed = new URLSearchParams(location.search).get("subscribed") === "1";
  const isPageLoading = navigation.state !== "idle";

  function navigateTo(path) {
    navigate(withEmbeddedAppParams(path, location.search));
  }

  function closeCreateBoxModal() {
    setShowCreateBoxModal(false);
    setPendingCreateAction(null);
  }

  function handleCreateBoxAction(action) {
    setPendingCreateAction(action.key);
    navigateTo(action.href);
  }

  const stats = [
    { label: "Active Boxes", value: activeBoxCount, sub: "Live combo box types" },
    { label: "Bundles Sold", value: bundlesSold, sub: "Last 30 days" },
    {
      label: "Bundle Revenue",
      value: `\u20B9${Number(bundleRevenue).toLocaleString("en-IN")}`,
      sub: "Last 30 days",
    },
    { label: "Conversion Rate", value: "—", sub: "Coming soon" },
  ];

  const orderTableRows = recentOrders.map((order) => [
    `#${order.orderId}`,
    order.boxTitle,
    <Badge
      tone={order.comboType === "specific" ? "info" : "success"}
    >
      {order.comboType === "specific" ? "Specific" : "Simple"}
    </Badge>,
    order.itemCount,
    `\u20B9${order.bundlePrice.toLocaleString("en-IN")}`,
    new Date(order.orderDate).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
  ]);

  const supportLinks = [
    whatsappLink && { label: "WhatsApp", url: whatsappLink },
    supportTicketLink && { label: "Support Ticket", url: supportTicketLink },
    knowledgeBaseLink && { label: "Knowledge Base", url: knowledgeBaseLink },
    reviewLink && { label: "Leave a Review", url: reviewLink },
  ].filter(Boolean);

  return (
    <Page
      title="Mix-Box Dashboard | Bundle Builder & AOV Growth"
      primaryAction={{
        content: "Create Box",
        onAction: () => setShowCreateBoxModal(true),
      }}
      secondaryActions={[
        {
          content: "View Analytics",
          onAction: () => navigateTo("/app/analytics"),
        },
      ]}
    >
      <BlockStack gap="500">
        {/* ── Banners ── */}
        {justSubscribed && (
          <Banner tone="success" title="Plan activated">
            <p>All features for your new plan are now unlocked.</p>
          </Banner>
        )}

        {/* ── Order limit upgrade prompt ── */}
        {orderLimitReached && (
          <Banner
            tone="critical"
            title={`${currentPlanName} plan order limit reached (${monthlyOrderCount}/${orderLimit} orders this month)`}
            action={{ content: "Upgrade plan", url: withEmbeddedAppParams("/app/pricing", location.search) }}
          >
            <p>
              Your store has reached the monthly order limit for the <strong>{currentPlanName}</strong> plan.
              New bundle orders may not be tracked until you upgrade.
            </p>
          </Banner>
        )}
        {orderLimitWarning && !orderLimitReached && (
          <Banner
            tone="warning"
            title={`Approaching ${currentPlanName} plan order limit (${monthlyOrderCount}/${orderLimit} orders this month)`}
            action={{ content: "View plans", url: withEmbeddedAppParams("/app/pricing", location.search) }}
          >
            <p>
              You have used <strong>{monthlyOrderCount}</strong> of your <strong>{orderLimit}</strong> monthly
              orders on the <strong>{currentPlanName}</strong> plan. Upgrade to avoid interruption.
            </p>
          </Banner>
        )}

        {!embedBlockEnabled && (
          <Banner
            tone="warning"
            title="Embed block not active"
            action={{ content: "Activate now", url: embedBlockUrl, target: "_blank" }}
          >
            <p>
              Enable the Combo Builder embed block so it can load scripts on your storefront.
            </p>
          </Banner>
        )}

        {/* ── Stats row ── */}
        <InlineGrid columns={{ xs: 2, md: 4 }} gap="400">
          {stats.map((stat) => (
            <StatCard key={stat.label} {...stat} />
          ))}
        </InlineGrid>

        {/* ── Main two-column layout ── */}
        <Layout>
          {/* Left — Recent Orders */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Recent Orders
                  </Text>
                  <Button variant="plain" onClick={() => navigateTo("/app/analytics")}>
                    View all
                  </Button>
                </InlineStack>

                {recentOrders.length === 0 ? (
                  <Box paddingBlock="800">
                    <BlockStack gap="200" align="center" inlineAlign="center">
                      <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                        No combo box orders yet.
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                        Once customers purchase a combo box, orders will appear here.
                      </Text>
                    </BlockStack>
                  </Box>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "numeric", "numeric", "text"]}
                    headings={["Order", "Box", "Type", "Items", "Revenue", "Date"]}
                    rows={orderTableRows}
                    hoverable
                  />
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Right — Setup + Quick Actions + Support */}
          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              {/* Theme Setup */}
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="h2" variant="headingMd">
                        Theme Setup
                      </Text>
                      <Badge tone={embedBlockEnabled ? "success" : "attention"}>
                        {embedBlockEnabled ? "Active" : "Pending"}
                      </Badge>
                    </InlineStack>
                    <Button
                      variant="plain"
                      onClick={() => setShowSetupSteps((v) => !v)}
                    >
                      {showSetupSteps ? "Hide guide" : "Show guide"}
                    </Button>
                  </InlineStack>

                  <Text as="p" tone="subdued" variant="bodySm">
                    One click opens the theme editor with the Combo Builder block pre-loaded.
                  </Text>

                  {showSetupSteps && (
                    <BlockStack gap="150">
                      {[
                        "Opens Theme Customization on your live product template.",
                        "Combo Builder block is auto-added to the Apps section.",
                        "Drag the block to the right position.",
                        "Click Save — your storefront is live.",
                      ].map((step, i) => (
                        <Text key={i} as="p" variant="bodySm">
                          {i + 1}. {step}
                        </Text>
                      ))}
                    </BlockStack>
                  )}

                  <Button url={themeEditorUrl} target="_blank" variant="primary">
                    Open Theme Editor
                  </Button>
                </BlockStack>
              </Card>

              {/* Quick Actions */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Quick Actions
                  </Text>
                  <BlockStack gap="200">
                    <Button
                      onClick={() => setShowCreateBoxModal(true)}
                      variant="primary"
                      fullWidth
                    >
                      Create Box
                    </Button>
                    {quickActions.map((action) => (
                      <Button
                        key={action.key}
                        onClick={() => navigateTo(action.href)}
                        fullWidth
                      >
                        {action.label}
                      </Button>
                    ))}
                  </BlockStack>
                </BlockStack>
              </Card>

              {/* Support */}
              {supportLinks.length > 0 && (
                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">
                      Support
                    </Text>
                    <InlineStack gap="200" wrap>
                      {supportLinks.map((link) => (
                        <Button key={link.label} url={link.url} target="_blank" variant="plain">
                          {link.label}
                        </Button>
                      ))}
                    </InlineStack>
                  </BlockStack>
                </Card>
              )}
            </BlockStack>
          </Layout.Section>
        </Layout>

        {/* ── Promoted Apps ── */}
        <Card>
          <BlockStack gap="400">
            <InlineStack gap="200" blockAlign="center">
              <AdminIcon type="collection-list" size="base" style={{ color: "#111827" }} />
              <Text as="h2" variant="headingMd">
                Discover Conversion-Boosting Shopify Apps
              </Text>
            </InlineStack>
            <Text as="p" tone="subdued" variant="bodySm">
              Recommended apps to grow revenue, improve trust, and increase store conversions.
            </Text>
            <Divider />
            <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
              {promotedApps.map((appItem) => (
                <Card key={appItem.key}>
                  <BlockStack gap="200">
                    <InlineStack align="space-between" blockAlign="center" wrap={false}>
                      <InlineStack gap="200" blockAlign="center" wrap={false}>
                        <img
                          src={appItem.image}
                          alt={appItem.title}
                          onError={(e) => { e.currentTarget.style.display = "none"; }}
                          style={{ width: "34px", height: "34px", objectFit: "contain", display: "block", flexShrink: 0 }}
                        />
                        <Text as="h3" variant="headingSm">
                          {appItem.title}
                        </Text>
                      </InlineStack>
                      <Badge>{appItem.tag}</Badge>
                    </InlineStack>
                    <Text as="p" tone="subdued" variant="bodySm">
                      {appItem.description}
                    </Text>
                    <Button url={appItem.url} target="_blank" variant="primary">
                      Add app
                    </Button>
                  </BlockStack>
                </Card>
              ))}
            </InlineGrid>
          </BlockStack>
        </Card>
      </BlockStack>

      {/* ── Create Box Modal ── */}
      <Modal
        open={showCreateBoxModal}
        onClose={closeCreateBoxModal}
        title="Choose Bundle Type"
        size="small"
      >
        <Modal.Section>
          <BlockStack gap="300">
            {createBoxActions.map((action) => (
              <div
                key={action.key}
                style={{ border: "1px solid #e5e7eb", borderRadius: 0, padding: "16px" }}
              >
                <BlockStack gap="200">
                  <InlineStack gap="200" blockAlign="center">
                    <AdminIcon type={action.icon} size="base" />
                    <Text as="h3" variant="headingSm">
                      {action.label}
                    </Text>
                  </InlineStack>
                  <Text as="p" tone="subdued" variant="bodySm">
                    {action.sub}
                  </Text>
                  <button
                    type="button"
                    disabled={pendingCreateAction !== null}
                    onClick={() => handleCreateBoxAction(action)}
                    style={{
                      width: "160px",
                      maxWidth: "100%",
                      border: "1px solid #111827",
                      borderRadius: 0,
                      background: "#111827",
                      color: "#ffffff",
                      padding: "9px 12px",
                      fontSize: "15px",
                      fontWeight: 700,
                      cursor: pendingCreateAction !== null ? "not-allowed" : "pointer",
                      opacity: pendingCreateAction !== null && pendingCreateAction !== action.key ? 0.65 : 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px",
                      minHeight: "40px",
                    }}
                  >
                    {pendingCreateAction === action.key && <Spinner accessibilityLabel="Loading" size="small" />}
                    Create Box
                  </button>
                </BlockStack>
              </div>
            ))}
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* ── Full-page loading overlay ── */}
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
