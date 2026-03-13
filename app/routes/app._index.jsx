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

function ThemeCustomizationCard({
  themeEditorUrl,
}) {
  const steps = [
    "Open Shopify Theme Editor from this dashboard.",
    "A new tab opens Theme Customization on the live product template preview.",
    "Combo Builder opens in the product section or the Apps area for that theme.",
    "Drag the block to the right position and click Save.",
  ];
  const productInfoBlocks = [
    "Text",
    "Title",
    "Price",
    "Variant picker",
    "Buy buttons",
    "Combo Builder",
  ];
  return (
    <s-section>
      <div
        style={{
          background: "#f5f5f4",
          border: "1px solid #e7e5e4",
          borderRadius: "22px",
          padding: "20px",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.8)",
        }}
      >
        <div
          style={{
            fontSize: "32px",
            fontWeight: "700",
            color: "#3f3f46",
            marginBottom: "18px",
          }}
        >
          Theme Customization
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(280px, 0.86fr) minmax(0, 1.14fr)",
            gap: "24px",
            alignItems: "stretch",
          }}
        >
          <div
            style={{
              background: "#fff",
              border: "1px solid #d6d3d1",
              borderRadius: "20px",
              padding: "28px 24px",
              boxShadow: "0 10px 28px rgba(15,23,42,0.08)",
              display: "flex",
              flexDirection: "column",
              gap: "18px",
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
                Theme customization instructions
              </h3>
              <p
                style={{
                  margin: 0,
                  fontSize: "14px",
                  lineHeight: 1.6,
                  color: "#4b5563",
                }}
              >
                Follow the same add-block and drag-to-position flow shown in the
                theme editor.
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
                  <div
                    style={{
                      fontSize: "14px",
                      lineHeight: 1.55,
                      color: "#374151",
                    }}
                  >
                    {step}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <a
                href={themeEditorUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textDecoration: "none",
                  border: "1px solid transparent",
                  borderRadius: "14px",
                  padding: "14px 20px",
                  background: "#111827",
                  color: "#fff",
                  fontSize: "14px",
                  fontWeight: "800",
                  cursor: "pointer",
                  boxShadow: "0 10px 22px rgba(17,24,39,0.16)",
                }}
              >
                Open Theme Editor
              </a>
            </div>
          </div>

          <div
            style={{
              background: "#f8fafc",
              border: "1px solid #d5e3f3",
              borderRadius: "20px",
              boxShadow: "0 10px 28px rgba(59,130,246,0.08)",
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
                gridTemplateColumns: "220px minmax(0, 1fr)",
                minHeight: "430px",
              }}
            >
              <div
                style={{
                  background: "#fff",
                  borderRight: "1px solid #e5e7eb",
                  padding: "16px 14px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: "12px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: "700",
                      color: "#111827",
                    }}
                  >
                    Default product
                  </div>
                  <div
                    style={{
                      fontSize: "11px",
                      fontWeight: "700",
                      color: "#2563eb",
                    }}
                  >
                    Change
                  </div>
                </div>

                <div
                  style={{
                    background: "#f8fafc",
                    border: "1px solid #e5e7eb",
                    borderRadius: "10px",
                    padding: "10px 12px",
                    marginBottom: "14px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "10px",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: "#6b7280",
                      fontWeight: "700",
                      marginBottom: "6px",
                    }}
                  >
                    Preview
                  </div>
                  <div
                    style={{
                      fontSize: "13px",
                      color: "#374151",
                      fontWeight: "600",
                    }}
                  >
                    Small Convertible Flex Bag
                  </div>
                </div>

                <div
                  style={{
                    fontSize: "10px",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: "#6b7280",
                    fontWeight: "700",
                    marginBottom: "8px",
                  }}
                >
                  Template
                </div>
                <div
                  style={{
                    padding: "9px 10px",
                    borderRadius: "8px 8px 0 0",
                    background: "#f8fafc",
                    border: "1px solid #e5e7eb",
                    borderBottom: "none",
                    fontSize: "12px",
                    fontWeight: "700",
                    color: "#374151",
                  }}
                >
                  Product information
                </div>
                <div
                  style={{
                    border: "1px solid #e5e7eb",
                    borderTop: "none",
                    borderRadius: "0 0 8px 8px",
                    padding: "8px",
                    background: "#fff",
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                  }}
                >
                  {productInfoBlocks.map((item) => {
                    const isActive = item === "Combo Builder";
                    return (
                      <div
                        key={item}
                        style={{
                          padding: "8px 10px",
                          borderRadius: "7px",
                          background: isActive ? "#e0f2fe" : "#f9fafb",
                          border: `1px solid ${isActive ? "#7dd3fc" : "#e5e7eb"}`,
                          fontSize: "12px",
                          fontWeight: isActive ? "700" : "600",
                          color: isActive ? "#0f766e" : "#4b5563",
                        }}
                      >
                        {item}
                      </div>
                    );
                  })}
                  <div
                    style={{
                      padding: "8px 10px",
                      borderRadius: "7px",
                      background: "#eff6ff",
                      border: "1px solid #bfdbfe",
                      fontSize: "12px",
                      fontWeight: "700",
                      color: "#2563eb",
                    }}
                  >
                    Add block
                  </div>
                </div>
              </div>

              <div
                style={{
                  position: "relative",
                  padding: "20px",
                  background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
                }}
              >
                <div
                  style={{
                    background: "#fff",
                    border: "1px solid #e5e7eb",
                    borderRadius: "14px",
                    padding: "18px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: "18px",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "12px",
                        fontWeight: "700",
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        color: "#6b7280",
                      }}
                    >
                      Product page preview
                    </div>
                    <div
                      style={{
                        padding: "7px 10px",
                        borderRadius: "999px",
                        background: "#dbeafe",
                        color: "#1d4ed8",
                        fontSize: "11px",
                        fontWeight: "700",
                      }}
                    >
                      App block selected
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(180px, 0.85fr) minmax(0, 1.15fr)",
                      gap: "20px",
                      alignItems: "start",
                    }}
                  >
                    <div
                      style={{
                        height: "290px",
                        borderRadius: "12px",
                        background:
                          "linear-gradient(180deg, rgba(232,211,192,0.92) 0%, rgba(191,136,98,0.96) 100%)",
                        border: "1px solid #e5d4c6",
                      }}
                    />
                    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          alignSelf: "flex-start",
                          padding: "6px 10px",
                          borderRadius: "8px",
                          border: "2px solid #60a5fa",
                          background: "#eff6ff",
                          color: "#1d4ed8",
                          fontSize: "12px",
                          fontWeight: "700",
                        }}
                      >
                        Combo Builder
                      </div>
                      <div
                        style={{
                          fontSize: "30px",
                          fontWeight: "500",
                          lineHeight: 1.1,
                          color: "#111827",
                        }}
                      >
                        Small Convertible Flex Bag
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          fontSize: "15px",
                          fontWeight: "600",
                          color: "#6b7280",
                        }}
                      >
                        <span style={{ textDecoration: "line-through" }}>Rs. 395.00</span>
                        <span style={{ color: "#111827", textDecoration: "none" }}>
                          Rs. 320.00
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    position: "absolute",
                    left: "90px",
                    top: "108px",
                    width: "300px",
                    background: "#fff",
                    border: "1px solid #d1d5db",
                    borderRadius: "12px",
                    boxShadow: "0 18px 40px rgba(15,23,42,0.16)",
                    padding: "16px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: "12px",
                      gap: "12px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        fontSize: "14px",
                        fontWeight: "700",
                        color: "#374151",
                      }}
                    >
                      <span
                        style={{
                          width: "20px",
                          height: "20px",
                          borderRadius: "999px",
                          background: "#16a34a",
                          color: "#fff",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "12px",
                          fontWeight: "800",
                        }}
                      >
                        +
                      </span>
                      &quot;Combo Builder&quot; added
                    </div>
                    <span style={{ color: "#6b7280", fontSize: "18px", lineHeight: 1 }}>
                      x
                    </span>
                  </div>

                  <div
                    style={{
                      border: "1px solid #d1d5db",
                      borderRadius: "8px",
                      background: "#f8fafc",
                      padding: "14px",
                      marginBottom: "12px",
                    }}
                  >
                    <div
                      style={{
                        height: "72px",
                        borderRadius: "8px",
                        border: "2px dashed #93c5fd",
                        background: "#fff",
                        position: "relative",
                      }}
                    >
                      <span
                        style={{
                          position: "absolute",
                          left: "14px",
                          top: "22px",
                          width: "18px",
                          height: "18px",
                          borderRadius: "4px",
                          background: "#60a5fa",
                          display: "inline-block",
                        }}
                      />
                      <span
                        style={{
                          position: "absolute",
                          left: "42px",
                          top: "26px",
                          width: "92px",
                          height: "10px",
                          borderRadius: "999px",
                          background: "#9ca3af",
                          display: "inline-block",
                        }}
                      />
                      <span
                        style={{
                          position: "absolute",
                          right: "12px",
                          top: "19px",
                          width: "26px",
                          height: "26px",
                          borderRadius: "6px",
                          border: "2px solid #60a5fa",
                          color: "#2563eb",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "12px",
                          fontWeight: "700",
                        }}
                      >
                        ||
                      </span>
                    </div>
                  </div>

                  <div
                    style={{
                      fontSize: "13px",
                      color: "#374151",
                      lineHeight: 1.55,
                    }}
                  >
                    Drag the app block up or down to move it to the position you
                    want. When ready, save your changes.
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      marginTop: "14px",
                    }}
                  >
                    <button
                      type="button"
                      style={{
                        border: "none",
                        borderRadius: "8px",
                        background: "#16a34a",
                        color: "#fff",
                        fontSize: "13px",
                        fontWeight: "700",
                        padding: "9px 14px",
                        cursor: "default",
                      }}
                    >
                      Got it
                    </button>
                  </div>
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
      icon: "TE",
      label: "Open theme editor",
      externalUrl: themeEditorUrl,
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
        themeEditorUrl={themeEditorUrl}
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
            <a
              key={action.key}
              href={action.externalUrl || "#"}
              target={action.externalUrl ? "_blank" : undefined}
              rel={action.externalUrl ? "noreferrer" : undefined}
              onClick={(event) => {
                if (action.disabled) {
                  event.preventDefault();
                  return;
                }
                if (action.externalUrl) return;
                event.preventDefault();
                navigateTo(action.href);
              }}
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
                textDecoration: "none",
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
