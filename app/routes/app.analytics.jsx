import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getAnalytics } from "../models/orders.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const from = url.searchParams.get("from") || null;
  const to = url.searchParams.get("to") || null;

  const analytics = await getAnalytics(session.shop, from, to);
  return { analytics };
};

export default function AnalyticsPage() {
  const { analytics } = useLoaderData();
  const {
    totalOrders,
    totalRevenue,
    avgBundleValue,
    topProducts,
    dailyTrend,
    boxPerformance,
  } = analytics;

  const stats = [
    { label: "Total Bundle Revenue", value: `\u20B9${totalRevenue.toLocaleString("en-IN")}` },
    { label: "Bundles Sold", value: totalOrders },
    { label: "Avg Bundle Value", value: `\u20B9${avgBundleValue.toLocaleString("en-IN")}` },
    { label: "Conversion Rate", value: "\u2014" },
  ];

  return (
    <s-page heading="Analytics">
      <s-section>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "8px" }}>
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
              <div style={{ fontSize: "26px", fontWeight: "700", color: "#1a1814", marginBottom: "4px" }}>
                {stat.value}
              </div>
              <div style={{ fontSize: "11px", color: "#7a7670", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "1px" }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </s-section>

      <s-section heading="Top 10 Products">
        {topProducts.length === 0 ? (
          <s-paragraph>No product selection data yet.</s-paragraph>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr>
                {["#", "Product ID", "Times Picked"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #e5e1d8", color: "#7a7670", fontFamily: "monospace", fontSize: "11px", textTransform: "uppercase", letterSpacing: "1px", fontWeight: "400" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topProducts.map((p, i) => (
                <tr key={p.productId}>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #f0ede4", color: "#7a7670" }}>{i + 1}</td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #f0ede4", fontFamily: "monospace", fontSize: "12px", color: "#374151" }}>{p.productId}</td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #f0ede4", color: "#374151", fontWeight: "600" }}>{p.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </s-section>

      <s-section heading="Box Type Performance">
        {boxPerformance.length === 0 ? (
          <s-paragraph>No box order data yet.</s-paragraph>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr>
                {["Box", "Orders", "Revenue"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #e5e1d8", color: "#7a7670", fontFamily: "monospace", fontSize: "11px", textTransform: "uppercase", letterSpacing: "1px", fontWeight: "400" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {boxPerformance.map((b) => (
                <tr key={b.boxId}>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #f0ede4", fontWeight: "600", color: "#1a1814" }}>{b.boxTitle}</td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #f0ede4", color: "#374151" }}>{b.orders}</td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #f0ede4", color: "#374151" }}>
                    \u20B9{b.revenue.toLocaleString("en-IN")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </s-section>

      <s-section heading="Daily Revenue Trend (Last 30 days)">
        {dailyTrend.length === 0 ? (
          <s-paragraph>No revenue data yet.</s-paragraph>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr>
                {["Date", "Orders", "Revenue"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "10px 14px", borderBottom: "1px solid #e5e1d8", color: "#7a7670", fontFamily: "monospace", fontSize: "11px", textTransform: "uppercase", letterSpacing: "1px", fontWeight: "400" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dailyTrend.map((d) => (
                <tr key={d.date}>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #f0ede4", color: "#374151", fontFamily: "monospace" }}>{d.date}</td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #f0ede4", color: "#374151" }}>{d.orders}</td>
                  <td style={{ padding: "10px 14px", borderBottom: "1px solid #f0ede4", color: "#374151" }}>
                    \u20B9{d.revenue.toLocaleString("en-IN")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
