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
import { withEmbeddedAppParams } from "../utils/embedded-app";

function getStoreAdminHandle(shopDomain = "") {
  return String(shopDomain || "").replace(/\.myshopify\.com$/i, "");
}

function buildThemeEditorUrl(shopDomain, apiKey) {
  const storeHandle = getStoreAdminHandle(shopDomain);
  if (!storeHandle) return "";

  const url = new URL(
    `https://admin.shopify.com/store/${storeHandle}/themes/current/editor`,
  );
  url.searchParams.set("template", "index");

  if (apiKey) {
    url.searchParams.set("addAppBlockId", `${apiKey}/combo-builder`);
    url.searchParams.set("target", "newAppsSection");
  }

  return url.toString();
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  // eslint-disable-next-line no-undef
  const apiKey = process.env.SHOPIFY_API_KEY || "";

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
    themeEditorUrl: buildThemeEditorUrl(shop, apiKey),
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

function ThemeCustomizationCard({
  onOpenThemeEditor,
  onOpenSettings,
  themeEditorDisabled,
}) {
  const steps = [
    "Open Shopify Theme Editor from this dashboard.",
    "On the Home page, use Add section > Apps and choose Combo Builder.",
    "Confirm the block appears in Apps, then click Save.",
  ];

  return (
    <s-section heading="Theme Customization">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.08fr) minmax(320px, 0.92fr)",
          gap: "20px",
          alignItems: "stretch",
        }}
      >
        <div
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: "14px",
            padding: "22px",
            boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "12px",
                fontWeight: "700",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "#0f766e",
                marginBottom: "8px",
              }}
            >
              Guided Setup
            </div>
            <h3
              style={{
                margin: "0 0 8px",
                fontSize: "24px",
                lineHeight: 1.15,
                color: "#111827",
              }}
            >
              Start theme customization from the dashboard
            </h3>
            <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.6, color: "#4b5563" }}>
              Theme setup is part of merchant onboarding. This action opens the
              Shopify editor directly so the merchant can place the Combo
              Builder block where customers will interact with it.
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {steps.map((step, index) => (
              <div
                key={step}
                style={{
                  display: "grid",
                  gridTemplateColumns: "28px minmax(0, 1fr)",
                  gap: "12px",
                  alignItems: "start",
                }}
              >
                <div
                  style={{
                    width: "28px",
                    height: "28px",
                    borderRadius: "999px",
                    background: "#0f766e",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "12px",
                    fontWeight: "700",
                  }}
                >
                  {index + 1}
                </div>
                <div style={{ fontSize: "14px", lineHeight: 1.55, color: "#374151" }}>
                  {step}
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              background: "#eff6ff",
              border: "1px solid #bfdbfe",
              borderRadius: "10px",
              padding: "12px 14px",
              color: "#1d4ed8",
              fontSize: "13px",
              lineHeight: 1.55,
            }}
          >
            If Shopify opens the editor without auto-placing the block, the
            merchant can still add it manually from the Apps list in the left
            sidebar.
          </div>

          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={onOpenThemeEditor}
              disabled={themeEditorDisabled}
              style={{
                border: "none",
                borderRadius: "10px",
                padding: "11px 16px",
                background: themeEditorDisabled ? "#9ca3af" : "#111827",
                color: "#fff",
                fontSize: "13px",
                fontWeight: "700",
                cursor: themeEditorDisabled ? "not-allowed" : "pointer",
              }}
            >
              Open Theme Editor
            </button>
            <button
              type="button"
              onClick={onOpenSettings}
              style={{
                border: "1px solid #d1d5db",
                borderRadius: "10px",
                padding: "11px 16px",
                background: "#fff",
                color: "#111827",
                fontSize: "13px",
                fontWeight: "600",
                cursor: "pointer",
              }}
            >
              Widget Settings
            </button>
          </div>
        </div>

        <div
          style={{
            background: "linear-gradient(180deg, #f8fbff 0%, #eef7f7 100%)",
            border: "1px solid #dbeafe",
            borderRadius: "14px",
            boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "40px",
              background: "#f3f4f6",
              borderBottom: "1px solid #e5e7eb",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 14px",
            }}
          >
            <div style={{ display: "flex", gap: "6px" }}>
              {["#f87171", "#fbbf24", "#34d399"].map((color) => (
                <span
                  key={color}
                  style={{
                    width: "10px",
                    height: "10px",
                    borderRadius: "999px",
                    background: color,
                    display: "inline-block",
                  }}
                />
              ))}
            </div>
            <div
              style={{
                fontSize: "12px",
                color: "#6b7280",
                fontWeight: "600",
              }}
            >
              Shopify Theme Editor
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "180px minmax(0, 1fr)",
              minHeight: "340px",
            }}
          >
            <div
              style={{
                background: "#ffffff",
                borderRight: "1px solid #e5e7eb",
                padding: "18px 14px",
              }}
            >
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: "700",
                  color: "#111827",
                  marginBottom: "16px",
                }}
              >
                Home page
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {[
                  { label: "Header", active: false },
                  { label: "Template", active: false },
                  { label: "Apps", active: true },
                  { label: "Combo Builder", active: true, nested: true },
                ].map((item) => (
                  <div
                    key={item.label}
                    style={{
                      padding: item.nested ? "10px 12px 10px 28px" : "10px 12px",
                      borderRadius: "10px",
                      background: item.active ? "#ecfeff" : "#f9fafb",
                      border: `1px solid ${item.active ? "#67e8f9" : "#e5e7eb"}`,
                      fontSize: "13px",
                      fontWeight: item.active ? "700" : "600",
                      color: item.active ? "#0f766e" : "#374151",
                    }}
                  >
                    {item.label}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ padding: "20px" }}>
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #dbeafe",
                  borderRadius: "14px",
                  padding: "18px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "12px",
                    marginBottom: "18px",
                  }}
                >
                  <div style={{ fontSize: "24px", fontWeight: "800", color: "#0f766e" }}>
                    Step 2: Select your products
                  </div>
                  <div
                    style={{
                      padding: "10px 16px",
                      borderRadius: "10px",
                      background: "#10b981",
                      color: "#fff",
                      fontSize: "13px",
                      fontWeight: "700",
                      whiteSpace: "nowrap",
                    }}
                  >
                    ADD TO CART
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                    gap: "14px",
                  }}
                >
                  {[1, 2, 3, 4].map((slot) => (
                    <div
                      key={slot}
                      style={{
                        minHeight: "124px",
                        borderRadius: "12px",
                        border: slot === 1 ? "2px solid #7dd3fc" : "2px dashed #d1d5db",
                        background: slot === 1 ? "#e0f2fe" : "#f8fafc",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "8px",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "36px",
                          fontWeight: "800",
                          color: slot === 1 ? "#0f766e" : "#9ca3af",
                        }}
                      >
                        {slot}
                      </div>
                      <div
                        style={{
                          fontSize: "13px",
                          fontWeight: "600",
                          color: "#6b7280",
                          textAlign: "center",
                        }}
                      >
                        Select your Item {slot}
                      </div>
                    </div>
                  ))}
                </div>

                <div
                  style={{
                    marginTop: "18px",
                    padding: "14px 16px",
                    borderRadius: "12px",
                    background: "#ecfeff",
                    border: "1px solid #a5f3fc",
                    fontSize: "13px",
                    color: "#155e75",
                    fontWeight: "600",
                  }}
                >
                  The merchant will see Combo Builder inside the Apps section in
                  the Theme Editor.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </s-section>
  );
}

export default function DashboardPage() {
  const {
    activeBoxCount,
    bundlesSold,
    bundleRevenue,
    recentOrders,
    themeEditorUrl,
  } = useLoaderData();
  const location = useLocation();
  const navigate = useNavigate();

  const stats = STAT_CARDS(activeBoxCount, bundlesSold, bundleRevenue);
  const quickActions = [
    {
      key: "theme-editor",
      icon: "TE",
      label: "Open theme editor",
      onClick: openThemeEditor,
      disabled: !themeEditorUrl,
    },
    {
      key: "create-box",
      icon: "+",
      label: "Create a new combo box",
      href: "/app/boxes/new",
    },
    {
      key: "manage-boxes",
      icon: "BX",
      label: "Manage existing boxes",
      href: "/app/boxes",
    },
    {
      key: "analytics",
      icon: "AN",
      label: "View analytics",
      href: "/app/analytics",
    },
    {
      key: "settings",
      icon: "ST",
      label: "Widget settings",
      href: "/app/settings",
    },
  ];

  function navigateTo(path) {
    navigate(withEmbeddedAppParams(path, location.search));
  }

  function openThemeEditor() {
    if (!themeEditorUrl || typeof window === "undefined") return;
    if (window.top) {
      window.top.location.href = themeEditorUrl;
      return;
    }
    window.location.href = themeEditorUrl;
  }

  return (
    <s-page heading="Combo Product">
      <s-button
        slot="primary-action"
        onClick={() => navigateTo("/app/boxes/new")}
      >
        + Create Box
      </s-button>

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

      <ThemeCustomizationCard
        onOpenThemeEditor={openThemeEditor}
        onOpenSettings={() => navigateTo("/app/settings")}
        themeEditorDisabled={!themeEditorUrl}
      />

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
            <button
              key={action.key}
              type="button"
              onClick={() => {
                if (action.disabled) return;
                if (typeof action.onClick === "function") {
                  action.onClick();
                  return;
                }
                navigateTo(action.href);
              }}
              disabled={action.disabled}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "10px 12px",
                background: action.disabled ? "#f3f4f6" : "#f9fafb",
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
                width: "100%",
                color: action.disabled ? "#9ca3af" : "#111827",
                fontSize: "13px",
                fontWeight: "500",
                cursor: action.disabled ? "not-allowed" : "pointer",
                textAlign: "left",
                transition: "background 0.12s, border-color 0.12s",
              }}
              onMouseEnter={(event) => {
                if (action.disabled) return;
                event.currentTarget.style.background = "#f0fdf4";
                event.currentTarget.style.borderColor = "#86efac";
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.background = action.disabled
                  ? "#f3f4f6"
                  : "#f9fafb";
                event.currentTarget.style.borderColor = "#e5e7eb";
              }}
            >
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: "800",
                  minWidth: "20px",
                  display: "inline-flex",
                  justifyContent: "center",
                }}
              >
                {action.icon}
              </span>
              {action.label}
            </button>
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
              text: "Open Theme Editor, then add the Combo Builder block from Apps.",
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
