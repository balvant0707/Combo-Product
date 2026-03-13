import { useLoaderData, useLocation, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getActiveBoxCount } from "../models/boxes.server";
import {
  getBundlesSoldCount,
  getBundleRevenue,
  getRecentOrders,
} from "../models/orders.server";
import { withEmbeddedAppParams } from "../utils/embedded-app";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [activeBoxCount, bundlesSold, bundleRevenue, recentOrders] =
    await Promise.all([
      getActiveBoxCount(shop),
      getBundlesSoldCount(shop),
      getBundleRevenue(shop),
      getRecentOrders(shop, 10),
    ]);

  return {
    activeBoxCount,
    bundlesSold,
    bundleRevenue,
    recentOrders: recentOrders.map((o) => ({
      id: o.id,
      orderId: o.orderId,
      boxTitle: o.box?.displayTitle || "Unknown Box",
      itemCount: o.box?.itemCount || 0,
      bundlePrice: parseFloat(o.bundlePrice),
      orderDate: o.orderDate.toISOString(),
    })),
  };
};

const STAT_CARDS = (activeBoxCount, bundlesSold, bundleRevenue) => [
  {
    label: "Active Boxes",
    value: activeBoxCount,
    icon: "📦",
    accent: "#2A7A4F",
    bg: "rgba(42,122,79,0.07)",
    sub: "Live combo box types",
  },
  {
    label: "Bundles Sold",
    value: bundlesSold,
    icon: "🛒",
    accent: "#3b82f6",
    bg: "rgba(59,130,246,0.07)",
    sub: "Last 30 days",
  },
  {
    label: "Bundle Revenue",
    value: `\u20B9${Number(bundleRevenue).toLocaleString("en-IN")}`,
    icon: "\u{1F4B0}",
    accent: "#8b5cf6",
    bg: "rgba(139,92,246,0.07)",
    sub: "Last 30 days",
  },
  {
    label: "Conversion Rate",
    value: "\u2014",
    icon: "\u{1F4C8}",
    accent: "#f59e0b",
    bg: "rgba(245,158,11,0.07)",
    sub: "Coming soon",
  },
];

function StatCard({ label, value, icon, accent, bg, sub }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: "12px",
        padding: "20px 22px 18px",
        position: "relative",
        overflow: "hidden",
        boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "3px",
          background: accent,
          borderRadius: "12px 12px 0 0",
        }}
      />
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "38px",
          height: "38px",
          borderRadius: "10px",
          background: bg,
          fontSize: "18px",
          marginBottom: "14px",
        }}
      >
        {icon}
      </div>
      <div
        style={{
          fontSize: "11px",
          color: "#6b7280",
          textTransform: "uppercase",
          letterSpacing: "0.8px",
          fontWeight: "600",
          marginBottom: "6px",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "30px",
          fontWeight: "800",
          color: "#111827",
          lineHeight: 1,
          letterSpacing: "-0.5px",
          marginBottom: "8px",
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: "11px", color: "#9ca3af" }}>{sub}</div>
    </div>
  );
}

export default function DashboardPage() {
  const { activeBoxCount, bundlesSold, bundleRevenue, recentOrders } =
    useLoaderData();
  const location = useLocation();
  const navigate = useNavigate();

  const stats = STAT_CARDS(activeBoxCount, bundlesSold, bundleRevenue);

  function navigateTo(path) {
    navigate(withEmbeddedAppParams(path, location.search));
  }

  return (
    <s-page heading="Combo Product">
      <s-button
        slot="primary-action"
        onClick={() => navigateTo("/app/boxes/new")}
      >
        + Create Box
      </s-button>

      {/* Stat cards */}
      <s-section>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: "16px",
          }}
        >
          {stats.map((stat, i) => (
            <StatCard key={i} {...stat} />
          ))}
        </div>
      </s-section>

      {/* Recent orders */}
      <s-section heading="Recent Bundle Orders">
        {recentOrders.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "48px 0",
              color: "#9ca3af",
            }}
          >
            <div style={{ fontSize: "36px", marginBottom: "12px" }}>🛒</div>
            <p style={{ fontSize: "14px", margin: "0 0 4px", color: "#6b7280", fontWeight: "600" }}>
              No bundle orders yet
            </p>
            <p style={{ fontSize: "13px", margin: 0, color: "#9ca3af" }}>
              Add the Combo Builder block to your theme to start receiving orders.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "13px",
              }}
            >
              <thead>
                <tr style={{ background: "#f9fafb" }}>
                  {["Order #", "Box Type", "Items", "Amount", "Date"].map(
                    (h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: "left",
                          padding: "10px 16px",
                          borderBottom: "1.5px solid #e5e7eb",
                          color: "#6b7280",
                          fontSize: "10px",
                          textTransform: "uppercase",
                          letterSpacing: "0.8px",
                          fontWeight: "600",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((order, idx) => (
                  <tr
                    key={order.id}
                    style={{
                      background: idx % 2 === 0 ? "#fff" : "#fafafa",
                      transition: "background 0.12s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#f0fdf4")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = idx % 2 === 0 ? "#fff" : "#fafafa")}
                  >
                    <td style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6" }}>
                      <span style={{ fontFamily: "monospace", fontWeight: "600", color: "#111827" }}>
                        #{order.orderId}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6", color: "#374151", fontWeight: "500" }}>
                      {order.boxTitle}
                    </td>
                    <td style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6" }}>
                      <span
                        style={{
                          display: "inline-block",
                          background: "#f3f4f6",
                          borderRadius: "6px",
                          padding: "2px 8px",
                          fontSize: "12px",
                          fontWeight: "600",
                          color: "#374151",
                          fontFamily: "monospace",
                        }}
                      >
                        {order.itemCount}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6" }}>
                      <span style={{ fontFamily: "monospace", fontWeight: "700", color: "#2A7A4F" }}>
                        \u20B9{Number(order.bundlePrice).toLocaleString("en-IN")}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6", color: "#9ca3af", fontSize: "12px", fontFamily: "monospace" }}>
                      {new Date(order.orderDate).toLocaleDateString("en-IN")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </s-section>

      {/* Quick Actions */}
      <s-section slot="aside" heading="Quick Actions">
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {[
            { icon: "➕", label: "Create a new combo box", href: "/app/boxes/new" },
            { icon: "📋", label: "Manage existing boxes", href: "/app/boxes" },
            { icon: "📊", label: "View analytics", href: "/app/analytics" },
            { icon: "⚙️", label: "Widget settings", href: "/app/settings" },
          ].map((action) => (
            <button
              key={action.href}
              type="button"
              onClick={() => navigateTo(action.href)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "10px 12px",
                background: "#f9fafb",
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
                width: "100%",
                color: "#111827",
                fontSize: "13px",
                fontWeight: "500",
                cursor: "pointer",
                textAlign: "left",
                transition: "background 0.12s, border-color 0.12s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#f0fdf4";
                e.currentTarget.style.borderColor = "#86efac";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#f9fafb";
                e.currentTarget.style.borderColor = "#e5e7eb";
              }}
            >
              <span style={{ fontSize: "16px" }}>{action.icon}</span>
              {action.label}
            </button>
          ))}
        </div>
      </s-section>

      {/* Getting Started */}
      <s-section slot="aside" heading="Getting Started">
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {[
            { step: "1", text: "Create a combo box and add eligible products." },
            { step: "2", text: "Add the Combo Builder block to your theme via the Theme Editor." },
            { step: "3", text: "Customers build their own box and add it to cart at the bundle price." },
          ].map((item) => (
            <div key={item.step} style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
              <div
                style={{
                  flexShrink: 0,
                  width: "24px",
                  height: "24px",
                  borderRadius: "50%",
                  background: "#2A7A4F",
                  color: "#fff",
                  fontSize: "11px",
                  fontWeight: "700",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {item.step}
              </div>
              <p style={{ margin: 0, fontSize: "13px", color: "#374151", lineHeight: 1.5 }}>
                {item.text}
              </p>
            </div>
          ))}
        </div>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
