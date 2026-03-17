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
        borderRadius: "5px",
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
          borderRadius: "5px 5px 0 0",
        }}
      />
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "38px",
          height: "38px",
          borderRadius: "5px",
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
      <div
        style={{
          borderRadius: "5px",
          overflow: "hidden",
          background: "linear-gradient(135deg, #091fd6 0%, #c11a10 55%, #706cd3 100%)",
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
            alignItems: "center",
            padding: "15px 15px",
          }}
        >
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
                fontSize: "18px",
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
                margin: "0 0 8px",
                fontSize: "14px",
                color: "rgba(255,255,255,0.72)",
                lineHeight: "normal",
              }}
            >
              One click opens the theme editor with the block pre-loaded — just drag, drop, and save.
            </p>

            {/* Steps — 4 equal columns */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
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
                    borderRadius: "5px",
                    padding: "16px 14px",
                    display: "flex",
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
                borderRadius: "5px",
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

      {/* Row: Quick Actions (35%) + Stats (65%) */}
      <div style={{ display: "grid", gridTemplateColumns: "35fr 65fr", gap: "20px", marginBottom: "20px", alignItems: "start" }}>

      {/* Quick Actions */}
      <div style={{ borderRadius: "5px", background: "linear-gradient(135deg, #091fd6 0%, #c11a10 55%, #706cd3 100%)", boxShadow: "0 8px 32px rgba(9,31,214,0.22)", overflow: "hidden", position: "relative" }}>
        <div style={{ position: "absolute", top: "-30px", right: "-30px", width: "120px", height: "120px", borderRadius: "50%", background: "rgba(255,255,255,0.05)", pointerEvents: "none" }} />
        <div style={{ padding: "20px 20px 14px", borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
          <div style={{ fontSize: "15px", fontWeight: "800", color: "#fff", letterSpacing: "-0.2px" }}>Quick Actions</div>
        </div>
        <div style={{ padding: "12px 12px 16px", display: "flex", flexDirection: "column", gap: "8px" }}>
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
                gap: "14px",
                padding: "5px 10px",
                background: "rgba(255,255,255,0.12)",
                border: "1.5px solid rgba(255,255,255,0.20)",
                borderRadius: "5px",
                textDecoration: "none",
                cursor: "pointer",
                transition: "transform 0.13s, background 0.13s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateX(3px)";
                e.currentTarget.style.background = "rgba(255,255,255,0.20)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateX(0)";
                e.currentTarget.style.background = "rgba(255,255,255,0.12)";
              }}
            >
              <div style={{ width: "42px", height: "42px", borderRadius: "5px", background: "rgba(255,255,255,0.18)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px", flexShrink: 0 }}>
                {action.emoji}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "14px", fontWeight: "700", color: "#fff", lineHeight: 1.3 }}>{action.label}</div>
                <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.65)", fontWeight: "600", marginTop: "2px" }}>{action.sub}</div>
              </div>
              <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "16px", flexShrink: 0 }}>→</div>
            </a>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div style={{ borderRadius: "5px", background: "linear-gradient(135deg, #091fd6 0%, #c11a10 55%, #706cd3 100%)", boxShadow: "0 8px 32px rgba(9,31,214,0.22)", overflow: "hidden", position: "relative" }}>
        <div style={{ position: "absolute", top: "-40px", right: "-40px", width: "180px", height: "180px", borderRadius: "50%", background: "rgba(255,255,255,0.05)", pointerEvents: "none" }} />
        <div style={{ padding: "24px 32px 20px", borderBottom: "1px solid rgba(255,255,255,0.12)", display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(255,255,255,0.15)", backdropFilter: "blur(4px)", borderRadius: "999px", padding: "4px 14px", fontSize: "10px", fontWeight: "800", letterSpacing: "0.10em", textTransform: "uppercase", color: "#d1fae5" }}>
            📊 Performance
          </div>
          <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.55)" }}>Last 30 days overview</span>
        </div>
        <div style={{ padding: "20px 10px 20px;", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px" }}>
          {stats.map((stat) => (
            <StatCard key={stat.label} {...stat} />
          ))}
        </div>
      </div>

      </div>{/* end 35/65 row */}

      {/* Recent Bundle Orders */}
      <div style={{ marginBottom: "20px", borderRadius: "5px", background: "linear-gradient(135deg, #091fd6 0%, #c11a10 55%, #706cd3 100%)", boxShadow: "0 8px 32px rgba(9,31,214,0.22)", overflow: "hidden", position: "relative" }}>
        <div style={{ position: "absolute", top: "-30px", right: "-30px", width: "150px", height: "150px", borderRadius: "50%", background: "rgba(255,255,255,0.05)", pointerEvents: "none" }} />
        <div style={{ padding: "24px 32px 20px", borderBottom: "1px solid rgba(255,255,255,0.12)", display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(255,255,255,0.15)", backdropFilter: "blur(4px)", borderRadius: "999px", padding: "4px 14px", fontSize: "10px", fontWeight: "800", letterSpacing: "0.10em", textTransform: "uppercase", color: "#d1fae5" }}>
            🧾 Recent Orders
          </div>
          <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.55)" }}>Latest bundle purchases</span>
        </div>
        <div style={{ padding: "16px 16px 16px" }}>
        <div style={{ background: "rgba(255,255,255,0.97)", borderRadius: "5px", padding: "0 16px 8px", overflow: "hidden" }}>
          {recentOrders.length === 0 ? (
            <div style={{ textAlign: "center", padding: "56px 0" }}>
              <div style={{ fontSize: "48px", marginBottom: "14px" }}>📭</div>
              <p style={{ fontSize: "15px", margin: "0 0 6px", color: "#374151", fontWeight: "700" }}>No bundle orders yet</p>
              <p style={{ fontSize: "13px", margin: 0, color: "#9ca3af" }}>Add the Combo Builder block to your theme to start receiving orders.</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr>
                    {["Order #", "Box Type", "Items", "Amount", "Date"].map((h) => (
                      <th key={h} style={{ textAlign: "left", padding: "14px 16px", borderBottom: "2px solid #f3f4f6", color: "#6b7280", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.9px", fontWeight: "700", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map((order, index) => (
                    <tr
                      key={order.id}
                      style={{ background: index % 2 === 0 ? "#fff" : "#fafafa", transition: "background 0.12s" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "#f0fdf4"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = index % 2 === 0 ? "#fff" : "#fafafa"; }}
                    >
                      <td style={{ padding: "13px 16px", borderBottom: "1px solid #f3f4f6" }}>
                        <span style={{ fontFamily: "monospace", fontWeight: "700", color: "#111827", background: "#f3f4f6", padding: "3px 8px", borderRadius: "6px" }}>#{order.orderId}</span>
                      </td>
                      <td style={{ padding: "13px 16px", borderBottom: "1px solid #f3f4f6", color: "#374151", fontWeight: "600" }}>{order.boxTitle}</td>
                      <td style={{ padding: "13px 16px", borderBottom: "1px solid #f3f4f6" }}>
                        <span style={{ display: "inline-block", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "5px", padding: "2px 10px", fontSize: "12px", fontWeight: "700", color: "#2563eb", fontFamily: "monospace" }}>{order.itemCount}</span>
                      </td>
                      <td style={{ padding: "13px 16px", borderBottom: "1px solid #f3f4f6" }}>
                        <span style={{ fontFamily: "monospace", fontWeight: "800", color: "#2A7A4F", background: "#f0fdf4", padding: "3px 8px", borderRadius: "5px" }}>₹{Number(order.bundlePrice).toLocaleString("en-IN")}</span>
                      </td>
                      <td style={{ padding: "13px 16px", borderBottom: "1px solid #f3f4f6", color: "#9ca3af", fontSize: "12px", fontFamily: "monospace" }}>
                        {new Date(order.orderDate).toLocaleDateString("en-IN")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </div>
      </div>

      {/* Getting Started */}
      <div style={{ marginBottom: "20px", borderRadius: "5px", background: "linear-gradient(135deg, #091fd6 0%, #c11a10 55%, #706cd3 100%)", boxShadow: "0 8px 32px rgba(42,122,79,0.22)", overflow: "hidden", position: "relative" }}>
        <div style={{ position: "absolute", top: "-40px", right: "-40px", width: "180px", height: "180px", borderRadius: "50%", background: "rgba(255,255,255,0.05)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: "-30px", left: "60px", width: "120px", height: "120px", borderRadius: "50%", background: "rgba(255,255,255,0.04)", pointerEvents: "none" }} />
        <div style={{ padding: "28px 32px 20px", borderBottom: "1px solid rgba(255,255,255,0.12)", display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(255,255,255,0.15)", backdropFilter: "blur(4px)", borderRadius: "999px", padding: "4px 14px", fontSize: "10px", fontWeight: "800", letterSpacing: "0.10em", textTransform: "uppercase", color: "#d1fae5" }}>
            🚀 Getting Started
          </div>
          <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.55)" }}>Three steps to go live</span>
        </div>
        <div style={{ padding: "24px 32px 32px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
          {[
            { step: "1", emoji: "📦", title: "Create a Combo Box", text: "Create a combo box and add eligible products to offer as a bundle." },
            { step: "2", emoji: "🎨", title: "Open Theme Editor", text: "Add the Combo Builder block to your product template in one click." },
            { step: "3", emoji: "✅", title: "Go Live", text: "Save the theme so customers can build their own combo box on the storefront." },
          ].map((item) => (
            <div
              key={item.step}
              style={{ background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: "5px", padding: "22px 20px" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: "rgba(255,255,255,0.22)", color: "#fff", fontSize: "12px", fontWeight: "800", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{item.step}</div>
                <span style={{ fontSize: "22px" }}>{item.emoji}</span>
              </div>
              <div style={{ fontSize: "14px", fontWeight: "800", color: "#fff", marginBottom: "8px" }}>{item.title}</div>
              <p style={{ margin: 0, fontSize: "13px", color: "rgba(255,255,255,0.72)", lineHeight: 1.6 }}>{item.text}</p>
            </div>
          ))}
        </div>
      </div>

    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
