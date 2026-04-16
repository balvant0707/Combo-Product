/* eslint-disable react/prop-types */
import { useRef, useState } from "react";
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
  Modal,
  Page,
  Spinner,
  Text,
} from "@shopify/polaris";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { AdminIcon } from "../components/admin-icons";
import { getActiveBoxCount } from "../models/boxes.server";
import { getShopCurrencyCode, getShopOwnerDisplayName } from "../models/shop.server";
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
import { formatCurrencyAmount } from "../utils/currency";

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

async function getShopifyOrdersCount(admin, fromIso, toIso) {
  const ORDERS_COUNT_QUERY = `#graphql
    query OrdersCount($query: String!) {
      ordersCount(query: $query)
    }
  `;

  const fromDate = new Date(fromIso).toISOString().slice(0, 10);
  const toDate = new Date(toIso).toISOString().slice(0, 10);
  const query = `status:any created_at:>=${fromDate} created_at:<=${toDate}`;

  try {
    const response = await admin.graphql(ORDERS_COUNT_QUERY, { variables: { query } });
    const json = await response.json();
    const raw = json?.data?.ordersCount;
    if (Array.isArray(json?.errors) && json.errors.length > 0) {
      return await getShopifyOrdersCountByPagination(admin, query);
    }

    if (typeof raw === "number") return raw;
    if (raw && typeof raw.count === "number") return raw.count;
    const fallback = await getShopifyOrdersCountByPagination(admin, query);
    return fallback == null ? 0 : fallback;
  } catch {
    return await getShopifyOrdersCountByPagination(admin, query);
  }
}

async function getShopifyOrdersCountByPagination(admin, query) {
  const ORDERS_PAGE_QUERY = `#graphql
    query OrdersPage($query: String!, $after: String) {
      orders(first: 250, query: $query, after: $after, sortKey: CREATED_AT, reverse: true) {
        pageInfo { hasNextPage endCursor }
        nodes { id }
      }
    }
  `;

  try {
    let total = 0;
    let after = null;
    let safety = 0;

    do {
      const response = await admin.graphql(ORDERS_PAGE_QUERY, {
        variables: { query, after },
      });
      const json = await response.json();
      if (Array.isArray(json?.errors) && json.errors.length > 0) return null;
      const nodes = json?.data?.orders?.nodes || [];
      const pageInfo = json?.data?.orders?.pageInfo;

      total += nodes.length;
      after = pageInfo?.endCursor || null;
      safety += 1;

      if (!pageInfo?.hasNextPage) break;
      if (!after) break;
      if (safety > 40) break; // Hard cap: 10k orders for dashboard KPI.
    } while (true);

    return total;
  } catch {
    return null;
  }
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
    const { activatePaidPlan } = await import("../models/subscription.server.js");
    const { setShopPlanStatus } = await import("../models/shop.server.js");
    const { subscription } = await syncSubscription(billing, shop);

    if (subscription?.subscriptionId || process.env.SKIP_BILLING === "true") {
      // Explicitly mark the plan ACTIVE in DB so hasPlanAccess works for all
      // subsequent requests (without ?subscribed=1 in the URL).
      await activatePaidPlan(shop, {
        plan: subscription?.plan || "PLUS",
        subscriptionId: subscription?.subscriptionId || `gid://shopify/AppSubscription/dev-${Date.now()}`,
        currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
      }).catch(() => { });
      await setShopPlanStatus(shop, "active").catch(() => { });
    }
  }

  const now = new Date();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [activeBoxCount, bundlesSold, bundleRevenue, recentOrders, currencyCode, totalStoreOrdersLast30Days, storeOwnerName] =
    await Promise.all([
      getActiveBoxCount(shop),
      getBundlesSoldCount(shop),
      getBundleRevenue(shop),
      getRecentOrders(shop, 10),
      getShopCurrencyCode(shop),
      getShopifyOrdersCount(admin, thirtyDaysAgo.toISOString(), now.toISOString()),
      getShopOwnerDisplayName(shop),
    ]);

  const [themeEditorUrl, embedBlockUrl, embedBlockEnabled] = await Promise.all([
    buildThemeEditorUrl({ shop, admin }),
    buildEmbedBlockUrl({ shop, admin }),
    getEmbedBlockStatus({ shop, admin, session }),
  ]);

  // Order limit tracking for upgrade prompt
  const { getSubscription } = await import("../models/subscription.server.js");
  const { PLANS } = await import("../models/subscription.server.js");
  const { getActiveShopifySubscription } = await import("../models/billing.server.js");
  const { getBillingCycleForPlanName, getOrderLimitForPlan } = await import("../config/billing.js");
  const subscription = await getSubscription(shop);
  const currentPlan = PLANS[subscription?.plan] ?? PLANS.FREE;
  const activeShopifySubscription = await getActiveShopifySubscription(billing).catch(() => null);
  const currentPlanDisplayName = activeShopifySubscription?.name || currentPlan.name;
  const currentBillingCycle = activeShopifySubscription?.name
    ? getBillingCycleForPlanName(activeShopifySubscription.name)
    : "monthly";
  const orderLimit = getOrderLimitForPlan(subscription?.plan || "FREE", currentBillingCycle);

  // Count orders in the current calendar month
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
  const bundleConversionRate = totalStoreOrdersLast30Days == null
    ? null
    : totalStoreOrdersLast30Days > 0
      ? (bundlesSold / totalStoreOrdersLast30Days) * 100
      : 0;

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
    currentPlanName: currentPlanDisplayName,
    orderLimit: isFinite(orderLimit) ? orderLimit : null,
    monthlyOrderCount,
    orderLimitReached,
    orderLimitWarning,
    currencyCode,
    totalStoreOrdersLast30Days,
    bundleConversionRate,
    storeOwnerName,
    shopDomain: shop,
    recentOrders: recentOrders.map((order) => ({
      id: order.id,
      orderId: order.orderId,
      orderName: order.orderName || null,
      orderNumber: order.orderNumber ?? null,
      boxTitle: order.box?.displayTitle || "Unknown Box",
      itemCount: order.box?.itemCount || 0,
      comboType: isSpecificComboFromBox(order.box) ? "specific" : "simple",
      comboTypeLabel: isSpecificComboFromBox(order.box) ? "Specific" : "Simple",
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
    label: "Create Fixed Box",
    sub: "Preconfigured Shopify product bundle to increase average order value faster.",
    href: "/app/boxes/new",
  },
  {
    key: "create-specific-combo",
    icon: "target",
    label: "Create Build-Your-Own Box",
    sub: "Step-by-step bundle builder that lets shoppers create a personalized product box.",
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
    description: "Grow average order value with cart drawer Upsells,Shipping,Discounts and smart cart offers.",
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

function EyeIcon({ size = 16, color = "#000000", fill = "#ffffff" }) {
  return (
    <svg
      width={`${size}px`}
      height={`${size}px`}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M1.5 12s3.75-6.75 10.5-6.75S22.5 12 22.5 12s-3.75 6.75-10.5 6.75S1.5 12 1.5 12Z"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3.25" fill={fill} stroke={color} strokeWidth="2" />
    </svg>
  );
}

function formatRecentOrderItems(selectedProducts) {
  const items = Array.isArray(selectedProducts)
    ? selectedProducts.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  if (items.length === 0) return "—";
  return items[0];
}

function formatOrderPrefixLabel(orderName, orderNumber, orderId) {
  const name = String(orderName || "").trim();
  if (/^#\d+/.test(name)) return name;

  const parsedOrderNumber = Number.parseInt(String(orderNumber), 10);
  if (Number.isFinite(parsedOrderNumber) && parsedOrderNumber > 0) {
    return `#${parsedOrderNumber}`;
  }

  const raw = String(orderId || "").trim();
  if (!raw) return "-";
  const digits = raw.replace(/\D/g, "");
  const suffix = (digits || raw).slice(-6);
  return `#${suffix}`;
}

function buildAdminOrderLink(shopDomain, orderId) {
  const shop = String(shopDomain || "").trim();
  const rawOrderId = String(orderId || "").trim();
  if (!shop || !rawOrderId) return null;
  const storeHandle = shop.replace(/\.myshopify\.com$/i, "");
  if (!storeHandle) return null;
  return `https://admin.shopify.com/store/${storeHandle}/orders/${rawOrderId}`;
}

function buildAdminProductLink(shopDomain, itemLabel) {
  const shop = String(shopDomain || "").trim();
  const label = String(itemLabel || "").trim();
  if (!shop || !label) return null;

  const gidMatch = label.match(/gid:\/\/shopify\/Product\/(\d+)/i);
  if (gidMatch?.[1]) {
    return `https://${shop}/admin/products/${gidMatch[1]}`;
  }

  if (/^\d{8,}$/.test(label)) {
    return `https://${shop}/admin/products/${label}`;
  }

  const normalizedQuery = label
    .replace(/\s*\([^)]*\)\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return `https://${shop}/admin/products?query=${encodeURIComponent(normalizedQuery || label)}`;
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
    currencyCode,
    totalStoreOrdersLast30Days,
    bundleConversionRate,
    storeOwnerName,
    shopDomain,
  } = useLoaderData();

  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [showCreateBoxModal, setShowCreateBoxModal] = useState(false);
  const [pendingCreateAction, setPendingCreateAction] = useState(null);
  const [itemsPopup, setItemsPopup] = useState({
    open: false,
    boxTitle: "",
    items: [],
  });
  const navInFlightRef = useRef(false);

  const justSubscribed = new URLSearchParams(location.search).get("subscribed") === "1";
  const isPageLoading = navigation.state !== "idle";

  function navigateTo(path) {
    if (navInFlightRef.current || navigation.state !== "idle") return;
    const target = withEmbeddedAppParams(path, location.search);
    const current = `${location.pathname}${location.search}`;
    if (target === current) return;

    navInFlightRef.current = true;
    try {
      navigate(target);
    } finally {
      setTimeout(() => { navInFlightRef.current = false; }, 500);
    }
  }

  function closeCreateBoxModal() {
    setShowCreateBoxModal(false);
    setPendingCreateAction(null);
  }

  function handleCreateBoxAction(action) {
    setPendingCreateAction(action.key);
    navigateTo(action.href);
  }

  function openItemsPopup(order) {
    const items = Array.isArray(order?.selectedProducts)
      ? order.selectedProducts.map((entry) => String(entry || "").trim()).filter(Boolean)
      : [];
    setItemsPopup({
      open: true,
      boxTitle: order?.boxTitle || "Bundle",
      items,
    });
  }

  const stats = [
    { label: "Live", value: activeBoxCount, sub: "" },
    { label: "Orders", value: bundlesSold, sub: "Last 30 days" },
    {
      label: "Total Revenue",
      value: formatCurrencyAmount(Number(bundleRevenue || 0), currencyCode),
      sub: "Last 30 days",
    },
    {
      label: "Conversion Rate",
      value: bundleConversionRate == null ? "—" : `${Number(bundleConversionRate).toFixed(1)}%`,
      sub: totalStoreOrdersLast30Days == null
        ? "Unavailable (orders permission/query)"
        : "Last 30 days",
    },
  ];

  const orderTableRows = recentOrders.map((order) => [
    (() => {
      const orderUrl = buildAdminOrderLink(shopDomain, order.orderId);
      const label = formatOrderPrefixLabel(order.orderName, order.orderNumber, order.orderId);
      if (!orderUrl) return label;
      return (
        <a
          href={orderUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-block",
            minWidth: "72px",
            height: "26px",
            borderRadius: "8px",
            textAlign: "center",
            lineHeight: "26px",
            background: "#f3f4f6",
            color: "#111827",
            fontSize: "12px",
            fontWeight: 700,
            textDecoration: "none",
          }}
        >
          {label}
        </a>
      );
    })(),
    (() => {
      const orderUrl = buildAdminOrderLink(shopDomain, order.orderId);
      if (!orderUrl) return order.boxTitle;
      return (
        <a
          href={orderUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#111827", fontWeight: 600, textDecoration: "none" }}
        >
          {order.boxTitle}
        </a>
      );
    })(),
    (() => {
      const isSpecific = order.comboType === "specific";
      return (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "6px 12px",
            borderRadius: "8px",
            border: `1px solid ${isSpecific ? "#c7d2fe" : "#bbf7d0"}`,
            background: isSpecific ? "#eef2ff" : "#ecfdf3",
            color: isSpecific ? "#4f46e5" : "#166534",
            fontSize: "13px",
            fontWeight: 600,
            lineHeight: 1.1,
          }}
        >
          {isSpecific ? "Specific" : "Simple"}
        </span>
      );
    })(),
    (() => {
      const items = Array.isArray(order.selectedProducts)
        ? order.selectedProducts.map((entry) => String(entry || "").trim()).filter(Boolean)
        : [];
      const previewText = formatRecentOrderItems(items);
      const moreCount = Math.max(0, items.length - 1);

      return (
        <InlineStack gap="100" blockAlign="center">
          <span
            style={{
              display: "inline-block",
              maxWidth: "360px",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={items.join(", ")}
          >
            {previewText}
          </span>
          {moreCount > 0 && (
            <Button variant="plain" onClick={() => openItemsPopup(order)}>
              +{moreCount} more
            </Button>
          )}
        </InlineStack>
      );
    })(),
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "6px 12px",
        borderRadius: "8px",
        background: "#ecfdf3",
        color: "#15803d",
        fontWeight: 700,
      }}
    >
      {formatCurrencyAmount(Number(order.bundlePrice || 0), currencyCode)}
    </span>,
    new Date(order.orderDate).toLocaleDateString(undefined, {
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
      title={`Welcome To ${storeOwnerName}`}
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
          <Banner tone="success" title={`Plan activated: ${currentPlanName || "Plan"}`}>
            <InlineStack gap="200" blockAlign="center">
              <p>All features for your new plan are now unlocked.</p>
              <Badge tone="success">{currentPlanName || "Plan"}</Badge>
            </InlineStack>
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


        {/* ── Stats row ── */}
        <InlineGrid columns={{ xs: 2, md: 4 }} gap="400">
          {stats.map((stat) => (
            <StatCard key={stat.label} {...stat} />
          ))}
        </InlineGrid>

        {/* -- Theme App Embed + Theme Setup + Quick Actions -- */}
        <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Theme App Embed Status
                </Text>
                {embedBlockEnabled ? (
                  <Badge tone="success">On</Badge>
                ) : (
                  <Button url={embedBlockUrl} target="_blank" variant="primary">
                    Activate
                  </Button>
                )}
              </InlineStack>
              <Text as="p" tone="subdued" variant="bodySm">
                Enable the MixBox – Box & Bundle Builder app embed in Theme Customize.
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Theme Widget Setup
              </Text>

              <BlockStack gap="150">
                {[
                  "Opens Theme Customization on your live product template.",
                  "Combo Builder block is auto-added to the Apps section.",
                  "Drag the block to the right position.",
                  "Click Save and your storefront is live.",
                ].map((step, i) => (
                  <Text key={i} as="p" variant="bodySm">
                    {i + 1}. {step}
                  </Text>
                ))}
              </BlockStack>

              <Button url={themeEditorUrl} target="_blank" variant="primary" fullWidth>
                Open Shopify Theme Editor
              </Button>
            </BlockStack>
          </Card>

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
                  Create Bundle Box
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
        </InlineGrid>

        {/* -- Recent Orders -- */}
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
              <>
                <style>{`
                  .cb-recent-orders .Polaris-DataTable__Cell,
                  .cb-recent-orders .Polaris-DataTable__Heading {
                    font-size: 12px !important;
                  }
                `}</style>
                <div className="cb-recent-orders">
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text", "text", "text"]}
                    headings={["Order ID", "Name", "Type", "Products", "Revenue", "Date"]}
                    rows={orderTableRows}
                    hoverable
                  />
                </div>
              </>
            )}
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
        {/* ── Promoted Apps ── */}
        <Card>
          <BlockStack gap="400">
            <InlineStack gap="200" blockAlign="center">
              <AdminIcon type="collection-list" size="base" style={{ color: "#111827" }} />
              <Text as="h2" variant="headingMd">
                Recommended Our Growth Apps
              </Text>
            </InlineStack>
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
        open={itemsPopup.open}
        onClose={() => setItemsPopup({ open: false, boxTitle: "", items: [] })}
        title={`All Bundle Items — ${itemsPopup.boxTitle}`}
        primaryAction={{
          content: "Close",
          onAction: () => setItemsPopup({ open: false, boxTitle: "", items: [] }),
        }}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" tone="subdued">
              {itemsPopup.items.length} item{itemsPopup.items.length === 1 ? "" : "s"} in this order
            </Text>
            {itemsPopup.items.length === 0 ? (
              <Text as="p" variant="bodySm" tone="subdued">No items found for this order.</Text>
            ) : (
              <BlockStack gap="100">
                {itemsPopup.items.map((item, idx) => {
                  const productUrl = buildAdminProductLink(shopDomain, item);
                  return (
                    <InlineStack key={`${item}-${idx}`} align="space-between" blockAlign="center" wrap={false}>
                      <Text as="span" variant="bodySm">{item}</Text>
                      {productUrl ? (
                        <Button
                          size="slim"
                          url={productUrl}
                          target="_blank"
                          variant="plain"
                          icon={<EyeIcon size={16} color="#000000" fill="#ffffff" />}
                          accessibilityLabel={`Open ${item} product`}
                        />
                      ) : (
                        <Text as="span" variant="bodySm" tone="subdued">No link</Text>
                      )}
                    </InlineStack>
                  );
                })}
              </BlockStack>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>

      <Modal
        open={showCreateBoxModal}
        onClose={closeCreateBoxModal}
        title="Choose Bundle Type"
        size="medium"
        style={{ maxWidth: "30.75rem", borderRadius: "0px" }}
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
                      width: "200px",
                      maxWidth: "100%",
                      border: "1px solid #000000",
                      borderRadius: 0,
                      background: "#000000",
                      color: "#ffffff",
                      padding: "9px 12px",
                      fontSize: "15px",
                      cursor: pendingCreateAction !== null ? "not-allowed" : "pointer",
                      opacity: pendingCreateAction !== null && pendingCreateAction !== action.key ? 0.65 : 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px",
                      minHeight: "40px",
                    }}
                  >
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

