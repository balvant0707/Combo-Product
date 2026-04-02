/* eslint-disable react/prop-types */
import { useState } from "react";
import { useLoaderData, useLocation, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getActiveBoxCount } from "../models/boxes.server";
import {
  getBundlesSoldCount,
  getBundleRevenue,
  getRecentOrders,
} from "../models/orders.server";
import { AdminIcon } from "../components/admin-icons";
import { buildThemeEditorUrl, buildEmbedBlockUrl, getEmbedBlockStatus } from "../utils/theme-editor.server";
import { withEmbeddedAppParams } from "../utils/embedded-app";

export const loader = async ({ request }) => {
  const { session, admin, billing } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);

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

function StatCard({ label, value, accent, sub }) {
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

function EmbedBlockCard({ embedBlockUrl, enabled }) {
  return (
    <div style={{ marginBottom: "20px" }}>
      <div
        style={{
          borderRadius: "5px",
          overflow: "hidden",
          background: "#ffffff",
          border: "1px solid #e5e7eb",
          boxShadow: "0 8px 24px rgba(15,23,42,0.08)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "18px 24px 16px",
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "38px",
                height: "38px",
                borderRadius: "5px",
                background: "#ffffff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                color: "#ffffff",
                border: "2px solid #000000",
              }}
            >
              <AdminIcon type="apps" size="large" color="#ffffff !important" />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "15px", fontWeight: "800", color: "#111827" }}>
                  Theme App Embed Block
                </span>
                <span
                  style={{
                    background: enabled ? "#f0fdf4" : "#fef3c7",
                    border: `1px solid ${enabled ? "#86efac" : "#fde68a"}`,
                    color: enabled ? "#166534" : "#92400e",
                    fontSize: "10px",
                    fontWeight: "700",
                    padding: "2px 10px",
                    borderRadius: "999px",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                  }}
                >
                  <span style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    background: enabled ? "#22c55e" : "#f59e0b",
                    display: "inline-block",
                  }} />
                  {enabled ? "Enabled" : "Not Enabled"}
                </span>
              </div>
              <p style={{ margin: "2px 0 0", fontSize: "12px", color: "#6b7280" }}>
                The embed block loads Combo Builder scripts globally on your storefront.
              </p>
            </div>
          </div>

          <a
            href={embedBlockUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              textDecoration: "none",
              borderRadius: "5px",
              padding: "10px 20px",
              background: "#111827",
              color: "#ffffff",
              fontSize: "13px",
              fontWeight: "700",
              cursor: "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0,
              boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
              transition: "background 0.12s, box-shadow 0.12s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#000000";
              e.currentTarget.style.boxShadow = "0 4px 14px rgba(0,0,0,0.30)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "#111827";
              e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.18)";
            }}
          >
            {enabled ? "Active" : "Enable Embed Block"}
          </a>
        </div>
      </div>
    </div>
  );
}

function ThemeCustomizationCard({ themeEditorUrl }) {
  const [isExpanded, setIsExpanded] = useState(true);
  const accordionPanelId = "guided-setup-panel";
  const steps = [
    { iconType: "desktop", text: "Opens Theme Customization on your live product template." },
    { iconType: "apps", text: "Combo Builder block is auto-added to the Apps section." },
    { iconType: "drag-handle", text: "Drag the block to the right position." },
    { iconType: "save", text: "Click Save and your storefront is live." },
  ];

  return (
    <div style={{ marginBottom: "20px" }}>
      <div
        style={{
          borderRadius: "5px",
          overflow: "hidden",
          background: "#ffffff",
          border: "1px solid #e5e7eb",
          boxShadow: "0 8px 24px rgba(15,23,42,0.08)",
          position: "relative",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto",
            alignItems: "start",
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
                background: "#f3f4f6",
                borderRadius: "999px",
                padding: "5px 16px",
                fontSize: "11px",
                fontWeight: "700",
                letterSpacing: "0.10em",
                textTransform: "uppercase",
                color: "#000000",
                marginBottom: "16px",
                backdropFilter: "blur(4px)",
              }}
            >
              <AdminIcon type="bolt" size="small" /> Guided Setup
            </div>

            {/* Headline */}
            <h2
              style={{
                margin: "0 0 8px",
                fontSize: "18px",
                fontWeight: "800",
                color: "#000000",
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
                color: "#4b5563",
                lineHeight: "normal",
              }}
            >
              One click opens the theme editor with the block pre-loaded &mdash; just drag, drop, and save.
            </p>

            <div id={accordionPanelId} style={{ display: isExpanded ? "block" : "none" }}>
              {/* Steps - 2 columns */}
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
                      background: "#f9fafb",
                      border: "1px solid #e5e7eb",
                      borderRadius: "5px",
                      padding: "16px 14px",
                      display: "flex",
                      gap: "10px",
                    }}
                  >
                    <AdminIcon type={step.iconType} size="large" />
                    <div style={{ fontSize: "12px", color: "#374151", lineHeight: 1.55 }}>
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
                  padding: "14px 28px",
                  background: "#000000",
                  color: "#ffffff",
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
                Open Theme Editor
              </a>
            </div>
          </div>

          <button
            type="button"
            aria-expanded={isExpanded}
            aria-controls={accordionPanelId}
            onClick={() => setIsExpanded((prev) => !prev)}
            style={{
              marginTop: "2px",
              width: "28px",
              height: "28px",
              borderRadius: "999px",
              border: "1px solid #e5e7eb",
              background: "#f9fafb",
              color: "#111827",
              fontSize: "18px",
              fontWeight: "700",
              lineHeight: 1,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            aria-label={isExpanded ? "Collapse guided setup steps" : "Expand guided setup steps"}
          >
            {isExpanded ? "-" : "+"}
          </button>
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
    embedBlockUrl,
    embedBlockEnabled,
    recentOrders,
  } = useLoaderData();
  const location = useLocation();
  const navigate = useNavigate();
  const [showCreateBoxModal, setShowCreateBoxModal] = useState(false);
  const justSubscribed = new URLSearchParams(location.search).get("subscribed") === "1";

  const stats = STAT_CARDS(activeBoxCount, bundlesSold, bundleRevenue);
  function navigateTo(path) {
    navigate(withEmbeddedAppParams(path, location.search));
  }

  const createBoxActions = [
    {
      key: "create-box",
      iconType: "package",
      label: "Create Combo Box",
      sub: "Add a new bundle",
      accent: "#3b82f6",
      bg: "linear-gradient(135deg,#eff6ff,#dbeafe)",
      border: "#bfdbfe",
      href: "/app/boxes/new",
    },
    {
      key: "create-specific-combo",
      iconType: "target",
      label: "Create Specific Combo Box",
      sub: "Step-by-step combo experience",
      accent: "#2A7A4F",
      bg: "linear-gradient(135deg,#f0fdf4,#dcfce7)",
      border: "#86efac",
      href: "/app/boxes/specific-combo",
    },
  ];

  const quickActions = [
    {
      key: "manage-boxes",
      iconType: "collection-list",
      label: "Manage Boxes",
      sub: "Edit existing combos",
      accent: "#8b5cf6",
      bg: "linear-gradient(135deg,#f5f3ff,#ede9fe)",
      border: "#ddd6fe",
      href: "/app/boxes",
    },
    {
      key: "analytics",
      iconType: "chart-line",
      label: "View Analytics",
      sub: "Sales & revenue",
      accent: "#f59e0b",
      bg: "linear-gradient(135deg,#fffbeb,#fef3c7)",
      border: "#fde68a",
      href: "/app/analytics",
    },
    {
      key: "settings",
      iconType: "settings",
      label: "Widget Settings",
      sub: "Theme & appearance",
      accent: "#6b7280",
      bg: "linear-gradient(135deg,#f9fafb,#f3f4f6)",
      border: "#e5e7eb",
      href: "/app/settings",
    },
  ];

  return (
    <s-page heading="MixBox – Box & Bundle Builder">
      <ui-title-bar>
        <button variant="primary" onClick={() => setShowCreateBoxModal(true)}>
          Create Box
        </button>
      </ui-title-bar>

      {justSubscribed && (
        <div style={{ marginBottom: "20px", padding: "14px 16px", borderRadius: "5px", border: "1px solid #bbf7d0", background: "#f0fdf4", color: "#15803d", fontSize: "13px", fontWeight: "700" }}>
          Pro plan activated. All premium features are now unlocked.
        </div>
      )}

      <EmbedBlockCard embedBlockUrl={embedBlockUrl} enabled={embedBlockEnabled} />
      <ThemeCustomizationCard themeEditorUrl={themeEditorUrl} />

      {/* Row: Quick Actions (35%) + Stats (65%) */}
      <div style={{ display: "grid", gridTemplateColumns: "35fr 65fr", gap: "20px", marginBottom: "20px", alignItems: "start" }}>

      {/* Quick Actions */}
      <div style={{ borderRadius: "5px", background: "#ffffff", border: "1px solid #e5e7eb", boxShadow: "0 8px 24px rgba(15,23,42,0.08)", overflow: "hidden", position: "relative" }}>
        <div style={{ padding: "20px 20px 14px", borderBottom: "1px solid #e5e7eb" }}>
          <div style={{ fontSize: "15px", fontWeight: "800", color: "#000000", letterSpacing: "-0.2px" }}>Quick Actions</div>
        </div>
        <div style={{ padding: "12px 12px 16px", display: "flex", flexDirection: "column", gap: "8px" }}>
          <button
            type="button"
            onClick={() => setShowCreateBoxModal(true)}
            style={{
              width: "100%",
              border: "1px solid #111827",
              borderRadius: "5px",
              background: "#111827",
              color: "#ffffff",
              fontSize: "14px",
              fontWeight: "700",
              padding: "10px 12px",
              cursor: "pointer",
            }}
          >
            Create Box
          </button>
          <div style={{ fontSize: "12px", color: "#6b7280", padding: "2px 4px 8px" }}>
            Click Create Box to choose combo type in popup.
          </div>
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
                background: "#f9fafb",
                border: "1.5px solid #e5e7eb",
                borderRadius: "5px",
                textDecoration: "none",
                cursor: "pointer",
                transition: "transform 0.13s, background 0.13s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateX(3px)";
                e.currentTarget.style.background = "#f3f4f6";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateX(0)";
                e.currentTarget.style.background = "#f9fafb";
              }}
            >
              <div style={{ width: "42px", height: "42px", borderRadius: "5px", background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px", flexShrink: 0 }}>
                <AdminIcon type={action.iconType} size="large" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "14px", fontWeight: "700", color: "#000000", lineHeight: 1.3 }}>{action.label}</div>
                <div style={{ fontSize: "12px", color: "#6b7280", fontWeight: "600", marginTop: "2px" }}>{action.sub}</div>
              </div>
              <div style={{ color: "#6b7280", fontSize: "16px", flexShrink: 0 }}>→</div>
            </a>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div style={{ borderRadius: "5px", background: "#ffffff", border: "1px solid #e5e7eb", boxShadow: "0 8px 24px rgba(15,23,42,0.08)", overflow: "hidden", position: "relative" }}>
        <div style={{ padding: "24px 32px 20px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "#f3f4f6", backdropFilter: "blur(4px)", borderRadius: "999px", padding: "4px 14px", fontSize: "10px", fontWeight: "800", letterSpacing: "0.10em", textTransform: "uppercase", color: "#000000" }}>
            <AdminIcon type="chart-line" size="small" /> Performance
          </div>
          <span style={{ fontSize: "13px", color: "#6b7280" }}>Last 30 days overview</span>
        </div>
        <div style={{ padding: "20px 10px 20px;", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px" }}>
          {stats.map((stat) => (
            <StatCard key={stat.label} {...stat} />
          ))}
        </div>
      </div>

      </div>{/* end 35/65 row */}

      {/* Recent Bundle Orders */}
      <div style={{ marginBottom: "20px", borderRadius: "5px", background: "#ffffff", border: "1px solid #e5e7eb", boxShadow: "0 8px 24px rgba(15,23,42,0.08)", overflow: "hidden", position: "relative" }}>
        <div style={{ padding: "24px 32px 20px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "#f3f4f6", backdropFilter: "blur(4px)", borderRadius: "999px", padding: "4px 14px", fontSize: "10px", fontWeight: "800", letterSpacing: "0.10em", textTransform: "uppercase", color: "#000000" }}>
            <AdminIcon type="order" size="small" /> Recent Orders
          </div>
          <span style={{ fontSize: "13px", color: "#6b7280" }}>Latest bundle purchases</span>
        </div>
        <div style={{ padding: "16px 16px 16px" }}>
        <div style={{ background: "#ffffff", borderRadius: "5px", padding: "0 16px 8px", overflow: "hidden" }}>
          {recentOrders.length === 0 ? (
            <div style={{ textAlign: "center", padding: "56px 0" }}>
              <AdminIcon type="order" size="large" style={{ marginBottom: "14px", color: "#9ca3af" }} />
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

      {showCreateBoxModal && (
        <div
          role="presentation"
          onClick={() => setShowCreateBoxModal(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(17,24,39,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Create Box"
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: "520px",
              borderRadius: "6px",
              background: "#ffffff",
              border: "1px solid #e5e7eb",
              boxShadow: "0 20px 60px rgba(0,0,0,0.20)",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "16px 18px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: "16px", fontWeight: "800", color: "#111827" }}>Create Box</div>
              <button
                type="button"
                onClick={() => setShowCreateBoxModal(false)}
                style={{ border: "none", background: "transparent", color: "#6b7280", fontSize: "18px", cursor: "pointer", lineHeight: 1 }}
                aria-label="Close"
              >
                x
              </button>
            </div>
            <div style={{ padding: "14px", display: "flex", flexDirection: "column", gap: "10px" }}>
              {createBoxActions.map((action) => (
                <button
                  key={action.key}
                  type="button"
                  onClick={() => {
                    setShowCreateBoxModal(false);
                    navigateTo(action.href);
                  }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    border: "1px solid #e5e7eb",
                    borderRadius: "5px",
                    background: "#f9fafb",
                    padding: "12px",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{ width: "38px", height: "38px", borderRadius: "5px", background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <AdminIcon type={action.iconType} size="large" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "14px", fontWeight: "700", color: "#111827", lineHeight: 1.3 }}>
                        {action.label}
                      </div>
                      <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "2px" }}>
                        {action.sub}
                      </div>
                    </div>
                    <div style={{ color: "#6b7280", fontSize: "16px", flexShrink: 0 }}>{"->"}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};

