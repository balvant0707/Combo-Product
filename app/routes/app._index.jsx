/* eslint-disable react/prop-types */
import { useState } from "react";
import { useLoaderData, useLocation, useNavigate, useNavigation } from "react-router";
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
      comboTypeLabel: isSpecificComboFromBox(order.box) ? "Specific Combo Product" : "Simple Combo Product",
      selectedProducts: parseOrderSelectedProducts(order.selectedProducts),
      bundlePrice: parseFloat(order.bundlePrice),
      orderDate: order.orderDate.toISOString(),
    })),
  };
};

const STAT_CARDS = (activeBoxCount, bundlesSold, bundleRevenue) => [
  {
    label: "Active Boxes",
    value: activeBoxCount,
    icon: "package",
    accent: "#2A7A4F",
    bg: "rgba(42,122,79,0.07)",
    sub: "Live combo box types",
  },
  {
    label: "Bundles Sold",
    value: bundlesSold,
    icon: "orders",
    accent: "#3b82f6",
    bg: "rgba(59,130,246,0.07)",
    sub: "Last 30 days",
  },
  {
    label: "Bundle Revenue",
    value: `\u20B9${Number(bundleRevenue).toLocaleString("en-IN")}`,
    icon: "chart-line",
    accent: "#8b5cf6",
    bg: "rgba(139,92,246,0.07)",
    sub: "Last 30 days",
  },
  {
    label: "Conversion Rate",
    value: "-",
    icon: "target",
    accent: "#f59e0b",
    bg: "rgba(245,158,11,0.07)",
    sub: "Coming soon",
  },
];

function StatCard({ label, value, accent, bg, icon, sub }) {
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
        <div
          style={{
            fontSize: "11px",
            color: "#000000",
            textTransform: "uppercase",
            letterSpacing: "0.8px",
            fontWeight: "600",
          }}
        >
          {label}
        </div>
        <div style={{ width: "30px", height: "30px", borderRadius: "7px", background: bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <AdminIcon type={icon} size="small" />
        </div>
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

function EmbedBlockCard({ embedBlockUrl, enabled, onStartLoading }) {
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
        <div className="db-embed-hdr">
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
              <p style={{ margin: "2px 0 0", fontSize: "12px", color: "#000000" }}>
                The embed block loads Combo Builder scripts globally on your storefront.
              </p>
            </div>
          </div>

          {!enabled && (
            <a
              href={embedBlockUrl}
              target="_blank"
              rel="noreferrer"
              onClick={() => onStartLoading?.()}
              className="db-embed-hdr-btn"
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#000000";
                e.currentTarget.style.boxShadow = "0 4px 14px rgba(0,0,0,0.30)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#111827";
                e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.18)";
              }}
            >
              Active
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function ThemeCustomizationCard({ themeEditorUrl, onStartLoading }) {
  const [isExpanded, setIsExpanded] = useState(false);
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
                  gridTemplateColumns: "repeat(auto-fit, minmax(49%, 4fr))",
                  gap: "12px",
                  marginBottom: "10px",
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
                onClick={() => onStartLoading?.()}
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
            <AdminIcon type={isExpanded ? "minus" : "plus"} size="small" />
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
    whatsappLink,
    supportTicketLink,
    knowledgeBaseLink,
    reviewLink,
    reportIssueLink,
    recentOrders,
  } = useLoaderData();
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [showCreateBoxModal, setShowCreateBoxModal] = useState(false);
  const [manualPageLoading, setManualPageLoading] = useState(false);
  const [isRecentOrdersOpen, setIsRecentOrdersOpen] = useState(false);
  const justSubscribed = new URLSearchParams(location.search).get("subscribed") === "1";
  const isPageLoading = manualPageLoading || navigation.state !== "idle";

  const stats = STAT_CARDS(activeBoxCount, bundlesSold, bundleRevenue);
  function startPageLoading({ transient = false } = {}) {
    setManualPageLoading(true);
    if (transient) {
      window.setTimeout(() => setManualPageLoading(false), 900);
    }
  }

  function navigateTo(path) {
    startPageLoading();
    navigate(withEmbeddedAppParams(path, location.search));
  }

  const createBoxActions = [
    {
      key: "create-box",
      iconType: "package",
      label: "Create Combo Box",
      sub: "Quick setup for fixed bundles and a fast purchase flow.",
      accent: "#3b82f6",
      bg: "linear-gradient(135deg,#eff6ff,#dbeafe)",
      border: "#bfdbfe",
      href: "/app/boxes/new",
    },
    {
      key: "create-specific-combo",
      iconType: "target",
      label: "Create Specific Combo Box",
      sub: "Guided step-by-step customization for personalized bundles.",
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

  const appsList = [
    {
      key: "cartlift",
      logoSrc: "/app-icons/cartlift.png",
      logoAlt: "CartLift logo",
      title: "CartLift: Cart Drawer & Upsell",
      tag: "Upsell",
      url: "https://apps.shopify.com/cartlift-cart-drawer-upsell",
      description: "Grow average order value with cart drawer upsells and smart cart offers.",
      tagBg: "#dbeafe",
      tagColor: "#1e3a8a",
    },
    {
      key: "fomoify",
      logoSrc: "/app-icons/fomoify.png",
      logoAlt: "Fomoify logo",
      title: "Fomoify Sales Popup & Proof",
      tag: "Social Proof",
      url: "https://apps.shopify.com/fomoify-sales-popup-proof",
      description: "Increase trust using real-time sales popups and conversion proof nudges.",
      tagBg: "#ede9fe",
      tagColor: "#5b21b6",
    },
  ];

  return (
    <s-page heading="MixBox – Box & Bundle Builder" inlineSize="large">
      <style>{`
        /* ── Dashboard Responsive ── */
        .db-embed-hdr {
          padding: 18px 24px 16px;
          border-bottom: 1px solid #e5e7eb;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
        }
        .db-embed-hdr-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          text-decoration: none;
          border-radius: 5px;
          padding: 10px 20px;
          background: #111827;
          color: #ffffff;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          white-space: nowrap;
          flex-shrink: 0;
          box-shadow: 0 2px 8px rgba(0,0,0,0.18);
          transition: background 0.12s, box-shadow 0.12s;
        }
        .db-kpi-grid {
          padding: 16px 10px 16px;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 8px;
        }
        .db-quick-flex {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 8px;
          padding-bottom: 2px;
          align-items: stretch;
        }
        .db-quick-link {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 12px;
          background: #f9fafb;
          border: 1.5px solid #e5e7eb;
          border-radius: 8px;
          text-decoration: none;
          cursor: pointer;
          transition: transform 0.13s, background 0.13s, border-color 0.13s, box-shadow 0.13s;
          width: 100%;
          min-width: 0;
          min-height: 72px;
          box-sizing: border-box;
        }
        .db-quick-link:hover {
          transform: translateY(-1px);
          background: #ffffff;
          border-color: #d1d5db;
          box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
        }
        .db-quick-link-primary {
          background: linear-gradient(180deg, #1f2937 0%, #111827 100%);
          border-color: #111827;
          color: #ffffff;
        }
        .db-quick-link-primary:hover {
          background: linear-gradient(180deg, #111827 0%, #0b1220 100%);
          border-color: #0b1220;
          box-shadow: 0 6px 16px rgba(17, 24, 39, 0.28);
        }
        .db-quick-icon {
          width: 42px;
          height: 42px;
          border-radius: 8px;
          background: #f3f4f6;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          color: #374151;
        }
        .db-quick-link-primary .db-quick-icon {
          background: rgba(255, 255, 255, 0.14);
          color: #ffffff;
        }
        .db-quick-title {
          font-size: 14px;
          font-weight: 800;
          color: #111827;
          line-height: 1.25;
        }
        .db-quick-sub {
          font-size: 12px;
          color: #374151;
          font-weight: 600;
          margin-top: 3px;
          line-height: 1.25;
        }
        .db-quick-link-primary .db-quick-title,
        .db-quick-link-primary .db-quick-sub {
          color: #ffffff;
        }
        /* Tablet — 2-column KPIs */
        @media (max-width: 900px) {
          .db-kpi-grid {
            grid-template-columns: repeat(2, 1fr);
          }
          .db-quick-flex {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        /* Mobile */
        @media (max-width: 640px) {
          .db-embed-hdr {
            flex-direction: column;
            align-items: flex-start;
            padding: 14px 16px 12px;
          }
          .db-embed-hdr-btn {
            width: 100%;
            justify-content: center;
          }
          .db-kpi-grid {
            grid-template-columns: 1fr 1fr;
            padding: 12px 8px;
            gap: 8px;
          }
          .db-quick-flex {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 400px) {
          .db-kpi-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
      <s-button slot="primary-action" variant="primary" onClick={() => setShowCreateBoxModal(true)}>
        Create Box
      </s-button>

      {justSubscribed && (
        <div style={{ marginBottom: "20px", padding: "14px 16px", borderRadius: "5px", border: "1px solid #bbf7d0", background: "#f0fdf4", color: "#15803d", fontSize: "13px", fontWeight: "700" }}>
          Pro plan activated. All premium features are now unlocked.
        </div>
      )}

      <EmbedBlockCard embedBlockUrl={embedBlockUrl} enabled={embedBlockEnabled} onStartLoading={() => startPageLoading({ transient: true })} />
      <ThemeCustomizationCard themeEditorUrl={themeEditorUrl} onStartLoading={() => startPageLoading({ transient: true })} />

      {/* Quick Actions */}
      <div style={{ marginBottom: "20px", borderRadius: "5px", background: "#ffffff", border: "1px solid #e5e7eb", boxShadow: "0 8px 24px rgba(15,23,42,0.08)", overflow: "hidden", position: "relative" }}>
        <div style={{ padding: "20px 20px 14px", borderBottom: "1px solid #e5e7eb" }}>
          <div style={{ fontSize: "15px", fontWeight: "800", color: "#000000", letterSpacing: "-0.2px", display: "flex", alignItems: "center", gap: "8px" }}>
            <AdminIcon type="bolt" size="base" /> Quick Actions
          </div>
        </div>
        <div style={{ padding: "12px 12px 16px" }}>
          <div style={{ fontSize: "12px", color: "#000000", padding: "2px 4px 10px" }}>
            Click Create Box to choose combo type in popup.
          </div>
          <div className="db-quick-flex">
            <button
              type="button"
              onClick={() => setShowCreateBoxModal(true)}
              className="db-quick-link db-quick-link-primary"
            >
              <div className="db-quick-icon">
                <AdminIcon type="package" size="large" />
              </div>
              <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                <div className="db-quick-title">Create Box</div>
                <div className="db-quick-sub">Choose combo type</div>
              </div>
            </button>
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
                className="db-quick-link"
              >
                <div className="db-quick-icon">
                  <AdminIcon type={action.iconType} size="large" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="db-quick-title">{action.label}</div>
                  <div className="db-quick-sub">{action.sub}</div>
                </div>
              </a>
            ))}
          </div>
        </div>
      </div>
      {/* Stats */}

      <div style={{ marginBottom: "20px", borderRadius: "5px", background: "#ffffff", border: "1px solid #e5e7eb", boxShadow: "0 8px 24px rgba(15,23,42,0.08)", overflow: "hidden" }}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ width: "30px", height: "30px", borderRadius: "5px", background: "#f3f4f6", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            <AdminIcon type="apps" size="small" />
          </div>
          <span style={{ fontSize: "18px", fontWeight: "800", color: "#0f172a" }}>Boost your store performance with our apps</span>
        </div>
        <div style={{ padding: "16px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "14px" }}>
          {appsList.map((appItem) => (
            <div key={appItem.key} style={{ border: "1px solid #e5e7eb", borderRadius: "5px", background: "#ffffff", padding: "16px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", marginBottom: "10px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                  <img
                    src={appItem.logoSrc}
                    alt={appItem.logoAlt}
                    style={{
                      width: "44px",
                      height: "44px",
                      borderRadius: "12px",
                      objectFit: "cover",
                      display: "block",
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ fontSize: "17px", fontWeight: "800", color: "#0f172a", lineHeight: 1.2 }}>
                    {appItem.title}
                  </div>
                </div>
                <span style={{ background: appItem.tagBg, color: appItem.tagColor, borderRadius: "999px", padding: "6px 10px", fontSize: "12px", fontWeight: "700", whiteSpace: "nowrap" }}>
                  {appItem.tag}
                </span>
              </div>
              <div style={{ fontSize: "14px", color: "#475569", lineHeight: 1.4, marginBottom: "14px" }}>
                {appItem.description}
              </div>
              <a
                href={appItem.url}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textDecoration: "none",
                  background: "#111827",
                  color: "#ffffff",
                  border: "1px solid #111827",
                  borderRadius: "5px",
                  padding: "10px 16px",
                  fontSize: "13px",
                  fontWeight: "700",
                }}
              >
                + Add app
              </a>
            </div>
          ))}
        </div>
      </div>


      <div style={{ display: "none", marginBottom: "20px", borderRadius: "5px", background: "#ffffff", border: "1px solid #e5e7eb", boxShadow: "0 8px 24px rgba(15,23,42,0.08)", overflow: "hidden" }}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ width: "26px", height: "26px", borderRadius: "50%", background: "#eff6ff", color: "#0284c7", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: "700" }}>
            +
          </span>
          <span style={{ fontSize: "18px", fontWeight: "800", color: "#0f172a", lineHeight: 1.1 }}>We're Here to Help You Succeed</span>
        </div>

        <div style={{ padding: "20px 16px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "16px" }}>
          <div>
            <div style={{ fontSize: "16px", fontWeight: "800", color: "#0f172a", marginBottom: "10px", lineHeight: 1.25 }}>Book a Free 30-Minute Setup Call</div>
            <div style={{ fontSize: "13px", color: "#475569", marginBottom: "12px", lineHeight: 1.4 }}>
              Get personalized guidance to accelerate your growth.
            </div>
            <div style={{ display: "flex", gap: "14px", flexWrap: "wrap", color: "#0f172a", fontSize: "13px", fontWeight: "700", marginBottom: "16px" }}>
              <span>App configuration</span>
              <span>Best practices</span>
              <span>Growth strategy</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
              <a
                href="https://outlook.office.com/book/ShopifyGrowthConsultationCall@m2webdesigning.com/?ismsaljsauthenabled=true"
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textDecoration: "none",
                  background: "#111827",
                  color: "#ffffff",
                  border: "1px solid #111827",
                  borderRadius: "5px",
                  padding: "10px 20px",
                  fontSize: "13px",
                  fontWeight: "700",
                }}
              >
                Schedule Free Call
              </a>
              <span style={{ fontSize: "13px", color: "#334155", fontWeight: "700" }}>Free | 30 mins | No commitment</span>
            </div>
          </div>

          <div style={{ border: "1px solid #e5e7eb", borderRadius: "5px", background: "#f8fafc", padding: "16px" }}>
            <div style={{ fontSize: "16px", fontWeight: "800", color: "#0f172a", marginBottom: "8px", lineHeight: 1.25 }}>Need Quick Help?</div>
            <div style={{ fontSize: "13px", color: "#475569", marginBottom: "14px", lineHeight: 1.4 }}>
              Reach out anytime for support, feedback, or just to share your progress.
            </div>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <a
                href={whatsappLink}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textDecoration: "none",
                  background: "#ffffff",
                  color: "#000000",
                  border: "1px solid #cbd5e1",
                  borderRadius: "5px",
                  padding: "9px 18px",
                  fontSize: "13px",
                  fontWeight: "700",
                }}
              >
                WhatsApp
              </a>
              <a
                href="#"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textDecoration: "none",
                  background: "#ffffff",
                  color: "#000000",
                  border: "1px solid #cbd5e1",
                  borderRadius: "5px",
                  padding: "9px 18px",
                  fontSize: "13px",
                  fontWeight: "700",
                }}
              >
                Live Chat
              </a>
            </div>
          </div>
        </div>

        <div style={{ padding: "0 16px 20px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "16px" }}>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: "5px", background: "#ffffff", padding: "16px" }}>
            <div style={{ fontSize: "15px", fontWeight: "800", color: "#111827", marginBottom: "10px" }}>Support</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
              <a
                href={supportTicketLink}
                target="_blank"
                rel="noreferrer"
                style={{ border: "1px solid #e5e7eb", borderRadius: "5px", background: "#ffffff", padding: "14px", textAlign: "center", textDecoration: "none", display: "block" }}
              >
                <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "14px", fontWeight: "800", color: "#1d4ed8", marginBottom: "6px" }}>
                  <AdminIcon type="clipboard" size="small" style={{ color: "#1d4ed8" }} />
                  <span>Support Ticket</span>
                </div>
                <div style={{ fontSize: "13px", color: "#111827", lineHeight: 1.4 }}>
                  Support, reply, and assist instantly in office hours.
                </div>
              </a>
              <a
                href={knowledgeBaseLink}
                target="_blank"
                rel="noreferrer"
                style={{ border: "1px solid #e5e7eb", borderRadius: "5px", background: "#ffffff", padding: "14px", textAlign: "center", textDecoration: "none", display: "block" }}
              >
                <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "14px", fontWeight: "800", color: "#1d4ed8", marginBottom: "6px" }}>
                  <AdminIcon type="info" size="small" style={{ color: "#1d4ed8" }} />
                  <span>Knowledge base</span>
                </div>
                <div style={{ fontSize: "13px", color: "#111827", lineHeight: 1.4 }}>
                  Find a solution for your problem with our documents.
                </div>
              </a>
            </div>
          </div>

          <div style={{ border: "1px solid #e5e7eb", borderRadius: "5px", background: "#ffffff", padding: "16px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <span style={{ width: "56px", height: "56px", borderRadius: "18px", background: "linear-gradient(180deg, #fb7185 0%, #e11d48 100%)", color: "#ffffff", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: "12px" }}>
              <AdminIcon type="star" size="large" style={{ color: "#ffffff" }} />
            </span>
            <div style={{ fontSize: "14px", color: "#111827", textAlign: "center", fontWeight: "700", lineHeight: 1.35, marginBottom: "12px" }}>
              Motivate our team for future app development
            </div>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "center" }}>
              <a
                href={reviewLink}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textDecoration: "none",
                  background: "#111827",
                  color: "#ffffff",
                  border: "1px solid #111827",
                  borderRadius: "5px",
                  padding: "10px 16px",
                  fontSize: "13px",
                  fontWeight: "700",
                }}
              >
                Write a review
              </a>
              <a
                href={reportIssueLink}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textDecoration: "none",
                  background: "#ffffff",
                  color: "#000000",
                  border: "1px solid #e5e7eb",
                  borderRadius: "5px",
                  padding: "10px 16px",
                  fontSize: "13px",
                  fontWeight: "700",
                }}
              >
                Report an issue
              </a>
            </div>
          </div>
        </div>
      </div>
      {isPageLoading && (
        <div
          aria-live="polite"
          aria-busy="true"
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            <s-spinner accessibilityLabel="Loading page" size="large" />
          </div>
        </div>
      )}

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
              <s-button
                type="button"
                variant="tertiary"
                onClick={() => setShowCreateBoxModal(false)}
                aria-label="Close"
              >
                <AdminIcon type="x" size="base" />
              </s-button>
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
                      <div style={{ fontSize: "12px", color: "#4b5563", marginTop: "4px", lineHeight: 1.45 }}>
                        {action.sub}
                      </div>
                    </div>
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

