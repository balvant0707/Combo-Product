import { useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getActiveBoxCount, listBoxes } from "../models/boxes.server";
import { getAnalytics, getRecentOrders } from "../models/orders.server";
import { getSettings } from "../models/settings.server";

function formatCurrency(value) {
  return `INR ${Number(value || 0).toLocaleString("en-IN")}`;
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [activeBoxCount, boxes, analytics, recentOrders, settings] =
    await Promise.all([
      getActiveBoxCount(shop),
      listBoxes(shop),
      getAnalytics(shop, null, null),
      getRecentOrders(shop, 10),
      getSettings(shop),
    ]);

  const activeBoxes = boxes.filter((box) => box.isActive);
  const inactiveBoxCount = boxes.filter((box) => !box.isActive).length;
  const giftBoxCount = boxes.filter((box) => box.isGiftBox).length;
  const activeBoxesWithoutProducts = activeBoxes.filter(
    (box) => (box.products?.length || 0) === 0,
  ).length;
  const totalEligibleProducts = boxes.reduce(
    (sum, box) => sum + (box.products?.length || 0),
    0,
  );
  const revenueTrend = analytics.dailyTrend.slice(-7);

  return {
    shop,
    totalBoxCount: boxes.length,
    activeBoxCount,
    inactiveBoxCount,
    giftBoxCount,
    activeBoxesWithoutProducts,
    totalEligibleProducts,
    analytics: {
      totalOrders: analytics.totalOrders,
      totalRevenue: analytics.totalRevenue,
      avgBundleValue: analytics.avgBundleValue,
      repeatBuyers: analytics.repeatBuyers || 0,
      revenueTrend,
    },
    settings: {
      analyticsTracking: settings.analyticsTracking,
      emailNotifications: settings.emailNotifications,
      giftMessageField: settings.giftMessageField,
      showProductPrices: settings.showProductPrices,
      forceShowOos: settings.forceShowOos,
    },
    recentOrders: recentOrders.map((order) => ({
      id: order.id,
      orderId: order.orderId,
      boxTitle: order.box?.displayTitle || "Unknown Box",
      itemCount: order.box?.itemCount || 0,
      bundlePrice: parseFloat(order.bundlePrice),
      orderDate: order.orderDate.toISOString(),
    })),
  };
};

export default function DashboardPage() {
  const {
    shop,
    totalBoxCount,
    activeBoxCount,
    inactiveBoxCount,
    giftBoxCount,
    activeBoxesWithoutProducts,
    totalEligibleProducts,
    analytics,
    settings,
    recentOrders,
  } = useLoaderData();
  const navigate = useNavigate();

  const stats = [
    { label: "Total Boxes", value: totalBoxCount },
    { label: "Active Boxes", value: activeBoxCount },
    { label: "Bundles Sold (30d)", value: analytics.totalOrders },
    { label: "Bundle Revenue (30d)", value: formatCurrency(analytics.totalRevenue) },
    { label: "Avg Bundle Value", value: formatCurrency(analytics.avgBundleValue) },
    { label: "Repeat Buyers", value: analytics.repeatBuyers },
    { label: "Eligible Product Mappings", value: totalEligibleProducts },
  ];

  const checkpoints = [
    {
      title: "At least one active box",
      ok: activeBoxCount > 0,
      details:
        activeBoxCount > 0
          ? `${activeBoxCount} active boxes found.`
          : "No active boxes. Customers cannot build bundles yet.",
      actionHref: "/app/boxes",
      actionLabel: "Manage Boxes",
    },
    {
      title: "Eligible products configured",
      ok: activeBoxCount > 0 && activeBoxesWithoutProducts === 0,
      details:
        activeBoxesWithoutProducts === 0
          ? "All active boxes have eligible products."
          : `${activeBoxesWithoutProducts} active boxes missing eligible products.`,
      actionHref: "/app/boxes",
      actionLabel: "Fix Products",
    },
    {
      title: "Analytics tracking enabled",
      ok: settings.analyticsTracking,
      details: settings.analyticsTracking
        ? "Order tracking metrics are enabled."
        : "Analytics tracking is disabled in settings.",
      actionHref: "/app/settings",
      actionLabel: "Open Settings",
    },
    {
      title: "Theme integration configured",
      ok: false,
      details:
        "Manual verification required in Shopify Theme Editor (section 12 in docs).",
      actionHref: "/app/settings",
      actionLabel: "Review Theme Setup",
    },
  ];

  const modules = [
    { section: "01", title: "App Auth & Permissions", area: "Authentication", status: "available", route: null },
    { section: "02", title: "User Roles", area: "Authentication", status: "planned", route: null },
    { section: "03", title: "Create Box", area: "Box Management", status: "available", route: "/app/boxes/new" },
    { section: "04", title: "Edit / Delete Box", area: "Box Management", status: "available", route: "/app/boxes" },
    { section: "05", title: "Reorder Boxes", area: "Box Management", status: "available", route: "/app/boxes" },
    { section: "06", title: "Box Status Toggle", area: "Box Management", status: "available", route: "/app/boxes" },
    { section: "07", title: "Eligible Products", area: "Products", status: "available", route: "/app/boxes" },
    { section: "08", title: "Variant Config", area: "Products", status: "partial", route: "/app/boxes" },
    { section: "09", title: "Order Tracking", area: "Orders and Analytics", status: "available", route: "/app/analytics" },
    { section: "10", title: "Analytics", area: "Orders and Analytics", status: "available", route: "/app/analytics" },
    { section: "11", title: "Settings", area: "Configuration", status: "available", route: "/app/settings" },
    { section: "12", title: "Theme Integration", area: "Configuration", status: "partial", route: "/app/settings" },
    { section: "13", title: "Admin API", area: "Configuration", status: "available", route: "/app" },
  ];

  const statusMeta = {
    available: { label: "Available", fg: "#047857", bg: "#ecfdf5", border: "#a7f3d0" },
    partial: { label: "Partial", fg: "#92400e", bg: "#fffbeb", border: "#fde68a" },
    planned: { label: "Planned", fg: "#1f2937", bg: "#f3f4f6", border: "#d1d5db" },
  };

  const maxTrendRevenue = Math.max(
    ...analytics.revenueTrend.map((day) => day.revenue),
    0,
  );

  return (
    <s-page heading="Admin Dashboard">
      <s-button slot="primary-action" onClick={() => navigate("/app/boxes/new")}>
        Create Box
      </s-button>

      <s-section>
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e5e1d8",
            borderRadius: "10px",
            padding: "16px 18px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "16px",
            flexWrap: "wrap",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "11px",
                color: "#7a7670",
                fontFamily: "monospace",
                textTransform: "uppercase",
                letterSpacing: "1px",
              }}
            >
              Functional Spec Mapping
            </div>
            <div
              style={{
                fontSize: "18px",
                fontWeight: "700",
                color: "#1a1814",
              }}
            >
              Admin docs version 1.0 (March 2026)
            </div>
            <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "4px" }}>
              Shop: {shop}
            </div>
          </div>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <span
              style={{
                padding: "4px 10px",
                borderRadius: "999px",
                background: "#eef2ff",
                color: "#4338ca",
                fontSize: "11px",
                fontFamily: "monospace",
              }}
            >
              Inactive Boxes: {inactiveBoxCount}
            </span>
            <span
              style={{
                padding: "4px 10px",
                borderRadius: "999px",
                background: "#ecfdf5",
                color: "#047857",
                fontSize: "11px",
                fontFamily: "monospace",
              }}
            >
              Gift Boxes: {giftBoxCount}
            </span>
          </div>
        </div>
      </s-section>

      <s-section heading="KPI Overview">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "12px",
          }}
        >
          {stats.map((stat) => (
            <div
              key={stat.label}
              style={{
                background: "#ffffff",
                border: "1px solid #e5e1d8",
                borderRadius: "8px",
                padding: "14px",
              }}
            >
              <div
                style={{
                  fontSize: "24px",
                  fontWeight: "700",
                  color: "#1a1814",
                  marginBottom: "4px",
                }}
              >
                {stat.value}
              </div>
              <div
                style={{
                  fontSize: "11px",
                  color: "#7a7670",
                  fontFamily: "monospace",
                  textTransform: "uppercase",
                  letterSpacing: "0.8px",
                }}
              >
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </s-section>

      <s-section heading="Spec Checkpoints">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: "12px",
          }}
        >
          {checkpoints.map((item) => (
            <div
              key={item.title}
              style={{
                background: "#ffffff",
                border: `1px solid ${item.ok ? "#a7f3d0" : "#fde68a"}`,
                borderRadius: "8px",
                padding: "14px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                <div style={{ fontSize: "14px", fontWeight: "700", color: "#1a1814" }}>
                  {item.title}
                </div>
                <span
                  style={{
                    borderRadius: "999px",
                    padding: "2px 8px",
                    fontSize: "10px",
                    fontFamily: "monospace",
                    textTransform: "uppercase",
                    background: item.ok ? "#ecfdf5" : "#fffbeb",
                    color: item.ok ? "#047857" : "#92400e",
                    border: `1px solid ${item.ok ? "#a7f3d0" : "#fde68a"}`,
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.ok ? "OK" : "Action Needed"}
                </span>
              </div>
              <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "6px" }}>
                {item.details}
              </div>
              <button
                onClick={() => navigate(item.actionHref)}
                style={{
                  marginTop: "10px",
                  background: "#f8fafc",
                  border: "1px solid #dbe2ea",
                  borderRadius: "6px",
                  padding: "6px 10px",
                  fontSize: "12px",
                  color: "#1f2937",
                  cursor: "pointer",
                }}
              >
                {item.actionLabel}
              </button>
            </div>
          ))}
        </div>
      </s-section>

      <s-section heading="Document Coverage (Sections 01 to 13)">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: "12px",
          }}
        >
          {modules.map((module) => {
            const status = statusMeta[module.status];
            return (
              <div
                key={module.section}
                style={{
                  background: "#ffffff",
                  border: "1px solid #e5e1d8",
                  borderRadius: "8px",
                  padding: "14px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "11px",
                      color: "#7a7670",
                      fontFamily: "monospace",
                      letterSpacing: "0.8px",
                    }}
                  >
                    SECTION {module.section}
                  </div>
                  <span
                    style={{
                      borderRadius: "999px",
                      padding: "2px 8px",
                      fontSize: "10px",
                      fontFamily: "monospace",
                      textTransform: "uppercase",
                      background: status.bg,
                      color: status.fg,
                      border: `1px solid ${status.border}`,
                    }}
                  >
                    {status.label}
                  </span>
                </div>
                <div style={{ fontSize: "15px", fontWeight: "700", color: "#1a1814", marginTop: "6px" }}>
                  {module.title}
                </div>
                <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "4px" }}>
                  {module.area}
                </div>
                {module.route ? (
                  <button
                    onClick={() => navigate(module.route)}
                    style={{
                      marginTop: "10px",
                      background: "#f8fafc",
                      border: "1px solid #dbe2ea",
                      borderRadius: "6px",
                      padding: "6px 10px",
                      fontSize: "12px",
                      color: "#1f2937",
                      cursor: "pointer",
                    }}
                  >
                    Open
                  </button>
                ) : (
                  <div style={{ marginTop: "10px", fontSize: "11px", color: "#7a7670" }}>
                    No dedicated page in current app.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </s-section>

      <s-section heading="Revenue Trend (Last 7 Days)">
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e5e1d8",
            borderRadius: "8px",
            padding: "16px",
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "8px", alignItems: "end", height: "140px" }}>
            {analytics.revenueTrend.map((day) => {
              const barPct =
                maxTrendRevenue > 0
                  ? Math.round((day.revenue / maxTrendRevenue) * 100)
                  : 0;
              const barHeight = `${Math.max(0, barPct)}%`;
              return (
                <div key={day.date} style={{ display: "flex", flexDirection: "column", gap: "6px", alignItems: "center" }}>
                  <div style={{ fontSize: "10px", color: "#7a7670", fontFamily: "monospace" }}>
                    {Math.round(day.revenue)}
                  </div>
                  <div
                    style={{
                      width: "100%",
                      maxWidth: "36px",
                      height: barHeight,
                      minHeight: day.revenue > 0 ? "6px" : "0",
                      background: "#2A7A4F",
                      borderRadius: "4px 4px 0 0",
                    }}
                  />
                  <div style={{ fontSize: "10px", color: "#7a7670", fontFamily: "monospace" }}>
                    {day.date.slice(5)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </s-section>

      <s-section heading="Recent Bundle Orders">
        {recentOrders.length === 0 ? (
          <s-paragraph>
            No bundle orders yet. After first sale, order tracking and analytics will populate.
          </s-paragraph>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ background: "#f7f8fc" }}>
                  {["Order #", "Box Type", "Items", "Amount", "Date"].map((heading) => (
                    <th
                      key={heading}
                      style={{
                        textAlign: "left",
                        padding: "10px 14px",
                        borderBottom: "1px solid #e5e1d8",
                        color: "#7a7670",
                        fontFamily: "monospace",
                        fontSize: "11px",
                        textTransform: "uppercase",
                        letterSpacing: "1px",
                        fontWeight: "400",
                      }}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((order) => (
                  <tr key={order.id}>
                    <td style={{ padding: "12px 14px", borderBottom: "1px solid #f0ede4", color: "#374151" }}>
                      #{order.orderId}
                    </td>
                    <td style={{ padding: "12px 14px", borderBottom: "1px solid #f0ede4", color: "#374151" }}>
                      {order.boxTitle}
                    </td>
                    <td style={{ padding: "12px 14px", borderBottom: "1px solid #f0ede4", color: "#374151" }}>
                      {order.itemCount}
                    </td>
                    <td style={{ padding: "12px 14px", borderBottom: "1px solid #f0ede4", color: "#374151" }}>
                      {formatCurrency(order.bundlePrice)}
                    </td>
                    <td style={{ padding: "12px 14px", borderBottom: "1px solid #f0ede4", color: "#7a7670" }}>
                      {new Date(order.orderDate).toLocaleDateString("en-IN")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </s-section>

      <s-section slot="aside" heading="Quick Actions">
        <s-unordered-list>
          <s-list-item>
            <s-link href="/app/boxes/new">Create a new combo box</s-link>
          </s-list-item>
          <s-list-item>
            <s-link href="/app/boxes">Manage existing boxes</s-link>
          </s-list-item>
          <s-list-item>
            <s-link href="/app/analytics">Open analytics</s-link>
          </s-list-item>
          <s-list-item>
            <s-link href="/app/settings">Configure global settings</s-link>
          </s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section slot="aside" heading="Settings Snapshot">
        <s-paragraph>
          <strong>Analytics Tracking:</strong>{" "}
          {settings.analyticsTracking ? "Enabled" : "Disabled"}
        </s-paragraph>
        <s-paragraph>
          <strong>Email Notifications:</strong>{" "}
          {settings.emailNotifications ? "Enabled" : "Disabled"}
        </s-paragraph>
        <s-paragraph>
          <strong>Gift Message Field:</strong>{" "}
          {settings.giftMessageField ? "Enabled" : "Disabled"}
        </s-paragraph>
        <s-paragraph>
          <strong>Show Product Prices:</strong>{" "}
          {settings.showProductPrices ? "Enabled" : "Disabled"}
        </s-paragraph>
        <s-paragraph>
          <strong>Force Show OOS:</strong>{" "}
          {settings.forceShowOos ? "Enabled" : "Disabled"}
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
