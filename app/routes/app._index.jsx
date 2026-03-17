/* eslint-disable react/prop-types */
import { useLoaderData, useLocation, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getActiveBoxCount } from "../models/boxes.server";
import {
  getBundlesSoldCount,
  getBundleRevenue,
  getRecentOrders,
} from "../models/orders.server";
import { buildThemeEditorUrl } from "../utils/theme-editor.server";
import { withEmbeddedAppParams } from "../utils/embedded-app";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
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
    themeEditorUrl: await buildThemeEditorUrl({ shop, admin }),
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

const STAT_CARDS = (activeBoxCount, bundlesSold, bundleRevenue) => [
  {
    label: "Active Boxes",
    value: activeBoxCount,
    icon: "BX",
    accent: "#2A7A4F",
    bg: "rgba(42,122,79,0.07)",
    sub: "Live combo box types",
  },
  {
    label: "Bundles Sold",
    value: bundlesSold,
    icon: "SO",
    accent: "#3b82f6",
    bg: "rgba(59,130,246,0.07)",
    sub: "Last 30 days",
  },
  {
    label: "Bundle Revenue",
    value: `\u20B9${Number(bundleRevenue).toLocaleString("en-IN")}`,
    icon: "RV",
    accent: "#8b5cf6",
    bg: "rgba(139,92,246,0.07)",
    sub: "Last 30 days",
  },
  {
    label: "Conversion Rate",
    value: "-",
    icon: "CV",
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
          fontSize: "12px",
          fontWeight: "800",
          color: accent,
          marginBottom: "14px",
          letterSpacing: "0.08em",
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

function ThemeCustomizationCard({ themeEditorUrl }) {
  const steps = [
    { icon: "🖥️", text: "Opens Theme Customization on your live product template." },
    { icon: "🧩", text: "Combo Builder block is auto-added to the Apps section." },
    { icon: "↕️", text: "Drag the block to the right position." },
    { icon: "💾", text: "Click Save — your storefront is live!" },
  ];
  return (
    <div style={{ marginBottom: "20px" }}>
       {/* Left: label + headline + steps + CTA */}
          <div>
            {/* Badge */}
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                background: "rgba(255,255,255,0.15)",
                borderRadius: "999px",
                padding: "5px 16px",
                fontSize: "11px",
                fontWeight: "700",
                letterSpacing: "0.10em",
                textTransform: "uppercase",
                color: "#d1fae5",
                marginBottom: "16px",
                backdropFilter: "blur(4px)",
              }}
            >
              <span style={{ fontSize: "13px" }}>⚡</span> Guided Setup
            </div>

            {/* Headline */}
            <h2
              style={{
                margin: "0 0 8px",
                fontSize: "28px",
                fontWeight: "800",
                color: "#ffffff",
                lineHeight: 1.15,
                letterSpacing: "-0.5px",
              }}
            >
              Add Combo Builder to Your Theme
            </h2>
            <p
              style={{
                margin: "0 0 28px",
                fontSize: "15px",
                color: "rgba(255,255,255,0.72)",
                lineHeight: 1.6,
                maxWidth: "520px",
              }}
            >
              One click opens the theme editor with the block pre-loaded — just drag, drop, and save.
            </p>

            {/* Steps — 4 equal columns */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: "12px",
                marginBottom: "32px",
              }}
            >
              {steps.map((step, i) => (
                <div
                  key={i}
                  style={{
                    background: "rgba(255,255,255,0.10)",
                    border: "1px solid rgba(255,255,255,0.18)",
                    borderRadius: "14px",
                    padding: "16px 14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div
                      style={{
                        width: "24px",
                        height: "24px",
                        borderRadius: "50%",
                        background: "rgba(255,255,255,0.22)",
                        color: "#fff",
                        fontSize: "11px",
                        fontWeight: "800",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      {i + 1}
                    </div>
                    <span style={{ fontSize: "20px", lineHeight: 1 }}>{step.icon}</span>
                  </div>
                  <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.85)", lineHeight: 1.55 }}>
                    {step.text}
                  </div>
                </div>
              ))}
            </div>

            {/* CTA */}
            <a
              href={themeEditorUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "10px",
                textDecoration: "none",
                borderRadius: "12px",
                padding: "14px 28px",
                background: "#ffffff",
                color: "#1a4f31",
                fontSize: "15px",
                fontWeight: "800",
                cursor: "pointer",
                boxShadow: "0 4px 20px rgba(0,0,0,0.18)",
                transition: "transform 0.12s, box-shadow 0.12s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow = "0 10px 28px rgba(0,0,0,0.24)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,0.18)";
              }}
            >
              <span style={{ fontSize: "18px" }}>🎨</span>
              Open Theme Editor
            </a>
          </div>
      <div
        style={{
          borderRadius: "20px",
          overflow: "hidden",
          background: "linear-gradient(135deg, #1a4f31 0%, #2A7A4F 55%, #3a9e68 100%)",
          boxShadow: "0 8px 32px rgba(42,122,79,0.28), 0 2px 8px rgba(0,0,0,0.10)",
          position: "relative",
        }}
      >
        {/* decorative circles */}
        <div style={{ position: "absolute", top: "-50px", right: "-50px", width: "220px", height: "220px", borderRadius: "50%", background: "rgba(255,255,255,0.06)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: "-60px", right: "80px", width: "180px", height: "180px", borderRadius: "50%", background: "rgba(255,255,255,0.04)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: "20px", right: "200px", width: "80px", height: "80px", borderRadius: "50%", background: "rgba(255,255,255,0.03)", pointerEvents: "none" }} />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: "40px",
            alignItems: "center",
            padding: "36px 44px",
          }}
        >

          {/* Right: decorative badge */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "12px",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                width: "110px",
                height: "110px",
                borderRadius: "28px",
                background: "rgba(255,255,255,0.12)",
                border: "2px solid rgba(255,255,255,0.22)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "52px",
                boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
              }}
            >
              🧩
            </div>
            <div
              style={{
                fontSize: "11px",
                fontWeight: "700",
                color: "rgba(255,255,255,0.60)",
                textAlign: "center",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                lineHeight: 1.4,
              }}
            >
              Theme<br />Extension
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const {
    activeBoxCount,
    bundlesSold,
    bundleRevenue,
    themeEditorUrl,
    recentOrders,
  } = useLoaderData();
  const location = useLocation();
  const navigate = useNavigate();

  const stats = STAT_CARDS(activeBoxCount, bundlesSold, bundleRevenue);
  function navigateTo(path) {
    navigate(withEmbeddedAppParams(path, location.search));
  }

  const quickActions = [
    {
      key: "theme-editor",
      emoji: "🎨",
      label: "Open Theme Editor",
      sub: "Customize your storefront",
      accent: "#2A7A4F",
      bg: "linear-gradient(135deg,#f0fdf4,#dcfce7)",
      border: "#bbf7d0",
      externalUrl: themeEditorUrl,
    },
    {
      key: "create-box",
      emoji: "📦",
      label: "Create Combo Box",
      sub: "Add a new bundle",
      accent: "#3b82f6",
      bg: "linear-gradient(135deg,#eff6ff,#dbeafe)",
      border: "#bfdbfe",
      href: "/app/boxes/new",
    },
    {
      key: "manage-boxes",
      emoji: "🗂️",
      label: "Manage Boxes",
      sub: "Edit existing combos",
      accent: "#8b5cf6",
      bg: "linear-gradient(135deg,#f5f3ff,#ede9fe)",
      border: "#ddd6fe",
      href: "/app/boxes",
    },
    {
      key: "analytics",
      emoji: "📊",
      label: "View Analytics",
      sub: "Sales & revenue",
      accent: "#f59e0b",
      bg: "linear-gradient(135deg,#fffbeb,#fef3c7)",
      border: "#fde68a",
      href: "/app/analytics",
    },
    {
      key: "settings",
      emoji: "⚙️",
      label: "Widget Settings",
      sub: "Theme & appearance",
      accent: "#6b7280",
      bg: "linear-gradient(135deg,#f9fafb,#f3f4f6)",
      border: "#e5e7eb",
      href: "/app/settings",
    },
  ];

  return (
    <s-page heading="Combo Product">
      <s-button
        slot="primary-action"
        onClick={() => navigateTo("/app/boxes/new")}
      >
        + Create Box
      </s-button>

      <ThemeCustomizationCard themeEditorUrl={themeEditorUrl} />

      <s-section>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: "16px",
          }}
        >
          {stats.map((stat) => (
            <StatCard key={stat.label} {...stat} />
          ))}
        </div>
      </s-section>

      <s-section heading="Recent Bundle Orders">
        {recentOrders.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "48px 0",
              color: "#9ca3af",
            }}
          >
            <div
              style={{
                width: "56px",
                height: "56px",
                borderRadius: "14px",
                margin: "0 auto 12px",
                background: "#f3f4f6",
                color: "#6b7280",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "14px",
                fontWeight: "800",
              }}
            >
              ORD
            </div>
            <p
              style={{
                fontSize: "14px",
                margin: "0 0 4px",
                color: "#6b7280",
                fontWeight: "600",
              }}
            >
              No bundle orders yet
            </p>
            <p style={{ fontSize: "13px", margin: 0, color: "#9ca3af" }}>
              Add the Combo Builder block to your theme to start receiving
              orders.
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
                    (heading) => (
                      <th
                        key={heading}
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
                        {heading}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((order, index) => (
                  <tr
                    key={order.id}
                    style={{
                      background: index % 2 === 0 ? "#fff" : "#fafafa",
                      transition: "background 0.12s",
                    }}
                    onMouseEnter={(event) => {
                      event.currentTarget.style.background = "#f0fdf4";
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.background =
                        index % 2 === 0 ? "#fff" : "#fafafa";
                    }}
                  >
                    <td
                      style={{
                        padding: "12px 16px",
                        borderBottom: "1px solid #f3f4f6",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "monospace",
                          fontWeight: "600",
                          color: "#111827",
                        }}
                      >
                        #{order.orderId}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: "12px 16px",
                        borderBottom: "1px solid #f3f4f6",
                        color: "#374151",
                        fontWeight: "500",
                      }}
                    >
                      {order.boxTitle}
                    </td>
                    <td
                      style={{
                        padding: "12px 16px",
                        borderBottom: "1px solid #f3f4f6",
                      }}
                    >
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
                    <td
                      style={{
                        padding: "12px 16px",
                        borderBottom: "1px solid #f3f4f6",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "monospace",
                          fontWeight: "700",
                          color: "#2A7A4F",
                        }}
                      >
                        {"\u20B9"}
                        {Number(order.bundlePrice).toLocaleString("en-IN")}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: "12px 16px",
                        borderBottom: "1px solid #f3f4f6",
                        color: "#9ca3af",
                        fontSize: "12px",
                        fontFamily: "monospace",
                      }}
                    >
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
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {quickActions.map((action) => (
            <a
              key={action.key}
              href={action.externalUrl || "#"}
              target={action.externalUrl ? "_blank" : undefined}
              rel={action.externalUrl ? "noreferrer" : undefined}
              onClick={(event) => {
                if (action.externalUrl) return;
                event.preventDefault();
                navigateTo(action.href);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "12px 14px",
                background: action.bg,
                border: `1.5px solid ${action.border}`,
                borderRadius: "12px",
                textDecoration: "none",
                cursor: "pointer",
                transition: "transform 0.12s, box-shadow 0.12s",
                boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow = `0 6px 16px ${action.accent}22`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)";
              }}
            >
              <div
                style={{
                  width: "38px",
                  height: "38px",
                  borderRadius: "10px",
                  background: "#fff",
                  boxShadow: `0 2px 8px ${action.accent}22`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "18px",
                  flexShrink: 0,
                }}
              >
                {action.emoji}
              </div>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: "13px",
                    fontWeight: "700",
                    color: "#111827",
                    lineHeight: 1.3,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {action.label}
                </div>
                <div
                  style={{
                    fontSize: "11px",
                    color: action.accent,
                    fontWeight: "500",
                    marginTop: "1px",
                  }}
                >
                  {action.sub}
                </div>
              </div>
              <div
                style={{
                  marginLeft: "auto",
                  color: action.accent,
                  fontSize: "16px",
                  opacity: 0.6,
                  flexShrink: 0,
                }}
              >
                →
              </div>
            </a>
          ))}
        </div>
      </s-section>

      <s-section slot="aside" heading="Getting Started">
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {[
            {
              step: "1",
              text: "Create a combo box and add eligible products.",
            },
            {
              step: "2",
              text: "Open Theme Editor to load Theme Customization with the Combo Builder block targeted to the product template.",
            },
            {
              step: "3",
              text: "Save the theme so customers can build their own box on the storefront.",
            },
          ].map((item) => (
            <div
              key={item.step}
              style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}
            >
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
              <p
                style={{
                  margin: 0,
                  fontSize: "13px",
                  color: "#374151",
                  lineHeight: 1.5,
                }}
              >
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
