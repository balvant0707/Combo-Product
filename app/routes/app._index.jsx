import { useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getActiveBoxCount } from "../models/boxes.server";
import {
  getBundlesSoldCount,
  getBundleRevenue,
  getRecentOrders,
} from "../models/orders.server";

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

export default function DashboardPage() {
  const { activeBoxCount, bundlesSold, bundleRevenue, recentOrders } =
    useLoaderData();
  const navigate = useNavigate();

  const stats = [
    { label: "Active Boxes", value: activeBoxCount },
    { label: "Bundles Sold (30d)", value: bundlesSold },
    {
      label: "Bundle Revenue (30d)",
      value: `\u20B9${Number(bundleRevenue).toLocaleString("en-IN")}`,
    },
    { label: "Conversion Rate", value: "\u2014" },
  ];

  return (
    <s-page heading="Dashboard">
      <s-button
        slot="primary-action"
        onClick={() => navigate("/app/boxes/new")}
      >
        + Create Box
      </s-button>

      <s-section>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: "16px",
            marginBottom: "8px",
          }}
        >
          {stats.map((stat, i) => (
            <div
              key={i}
              style={{
                background: "#ffffff",
                border: "1px solid #e5e1d8",
                borderRadius: "8px",
                padding: "20px",
              }}
            >
              <div
                style={{
                  fontSize: "28px",
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
                  letterSpacing: "1px",
                }}
              >
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </s-section>

      <s-section heading="Recent Bundle Orders">
        {recentOrders.length === 0 ? (
          <s-paragraph>
            No bundle orders yet. Create a box and add the Combo Builder block to your theme to start receiving orders.
          </s-paragraph>
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
                <tr style={{ background: "#f7f8fc" }}>
                  {["Order #", "Box Type", "Items", "Amount", "Date"].map(
                    (h) => (
                      <th
                        key={h}
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
                        {h}
                      </th>
                    ),
                  )}
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
                      \u20B9{Number(order.bundlePrice).toLocaleString("en-IN")}
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
            <s-link href="/app/analytics">View analytics</s-link>
          </s-list-item>
          <s-list-item>
            <s-link href="/app/settings">Configure widget settings</s-link>
          </s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section slot="aside" heading="Getting Started">
        <s-paragraph>
          <strong>1.</strong>{" "}
          <s-link href="/app/boxes/new">Create a combo box</s-link> and add eligible products.
        </s-paragraph>
        <s-paragraph>
          <strong>2.</strong> Add the <strong>Combo Builder</strong> block to your theme via the Theme Editor.
        </s-paragraph>
        <s-paragraph>
          <strong>3.</strong> Customers build their own box on the storefront and add it to cart at the bundle price.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
