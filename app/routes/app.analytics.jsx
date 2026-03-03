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

// ─── Chart: Daily Revenue Trend (SVG Bar Chart) ────────────────────────────
function RevenueBarChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <div style={{ padding: "48px 24px", textAlign: "center", color: "#7a7670", fontSize: "13px" }}>
        No revenue data yet — charts will populate after your first bundle sale.
      </div>
    );
  }

  const H = 180;
  const MARGIN_LEFT = 52;
  const MARGIN_BOTTOM = 40;
  const BAR_GAP = 3;
  const maxRevenue = Math.max(...data.map((d) => d.revenue), 1);
  const barWidth = Math.max(6, Math.min(44, Math.floor(560 / data.length) - BAR_GAP));
  const svgW = MARGIN_LEFT + data.length * (barWidth + BAR_GAP) + 20;
  const yTicks = [0, 0.25, 0.5, 0.75, 1];

  function fmtY(val) {
    if (val >= 100000) return `₹${(val / 100000).toFixed(1)}L`;
    if (val >= 1000) return `₹${(val / 1000).toFixed(1)}k`;
    return `₹${Math.round(val)}`;
  }

  return (
    <div style={{ overflowX: "auto", paddingBottom: "4px" }}>
      <svg
        width={Math.max(600, svgW)}
        height={H + MARGIN_BOTTOM}
        style={{ display: "block", minWidth: "400px" }}
      >
        {/* Grid lines + Y labels */}
        {yTicks.map((pct, i) => {
          const y = H - pct * H;
          return (
            <g key={i}>
              <line
                x1={MARGIN_LEFT - 4} y1={y}
                x2={Math.max(600, svgW) - 10} y2={y}
                stroke={pct === 0 ? "#c9c6be" : "#f0ede4"} strokeWidth="1"
              />
              <text
                x={MARGIN_LEFT - 8} y={y + 4}
                textAnchor="end" fontSize="9" fill="#7a7670" fontFamily="monospace"
              >
                {fmtY(maxRevenue * pct)}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {data.map((d, i) => {
          const barH = Math.max(2, (d.revenue / maxRevenue) * H);
          const x = MARGIN_LEFT + i * (barWidth + BAR_GAP);
          const y = H - barH;
          const cx = x + barWidth / 2;
          return (
            <g key={d.date}>
              <rect x={x} y={y} width={barWidth} height={barH} fill="#2A7A4F" rx="2" opacity="0.88">
                <title>
                  {d.date}: ₹{d.revenue.toLocaleString("en-IN")} · {d.orders} order{d.orders !== 1 ? "s" : ""}
                </title>
              </rect>
              {/* Show orders count on bar if tall enough */}
              {barH > 18 && (
                <text x={cx} y={y + 12} textAnchor="middle" fontSize="8" fill="#fff" fontFamily="monospace">
                  {d.orders}
                </text>
              )}
              {/* X-axis date label (rotated) */}
              <text
                x={cx} y={H + 14}
                textAnchor="end" fontSize="8" fill="#7a7670" fontFamily="monospace"
                transform={`rotate(-45, ${cx}, ${H + 14})`}
              >
                {d.date.slice(5)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div style={{ display: "flex", gap: "16px", marginTop: "8px", fontSize: "11px", color: "#7a7670" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span style={{ width: "12px", height: "12px", background: "#2A7A4F", borderRadius: "2px", display: "inline-block" }} />
          Daily Revenue (₹) · Numbers inside bars = order count
        </span>
      </div>
    </div>
  );
}

// ─── Chart: Top Products (CSS Horizontal Bars) ─────────────────────────────
function TopProductsChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <div style={{ padding: "48px 24px", textAlign: "center", color: "#7a7670", fontSize: "13px" }}>
        No product selection data yet.
      </div>
    );
  }

  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const barColors = [
    "#2A7A4F", "#3a8a5f", "#4a9a6f", "#1d6b43", "#5aaa7f",
    "#0d5b33", "#6aba8f", "#2d7a59", "#1a6a49", "#0a5a39",
  ];

  return (
    <div>
      {/* Column headers */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "10px", paddingBottom: "8px", borderBottom: "1px solid #f0ede4" }}>
        <div style={{ width: "28px", fontSize: "10px", color: "#7a7670", fontFamily: "monospace", textTransform: "uppercase" }}>#</div>
        <div style={{ width: "110px", fontSize: "10px", color: "#7a7670", fontFamily: "monospace", textTransform: "uppercase" }}>Product</div>
        <div style={{ flex: 1, fontSize: "10px", color: "#7a7670", fontFamily: "monospace", textTransform: "uppercase" }}>Times Picked</div>
        <div style={{ width: "44px", fontSize: "10px", color: "#7a7670", fontFamily: "monospace", textTransform: "uppercase", textAlign: "right" }}>Count</div>
      </div>

      {data.map((p, i) => {
        const pct = (p.count / maxCount) * 100;
        const shortId = p.productId.includes("/") ? p.productId.split("/").pop() : p.productId;
        const color = barColors[i % barColors.length];
        return (
          <div key={p.productId} style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
            <div style={{ width: "28px", textAlign: "right", fontSize: "11px", color: "#7a7670", fontWeight: "600", fontFamily: "monospace", flexShrink: 0 }}>
              {i + 1}
            </div>
            <div style={{ width: "110px", fontSize: "11px", color: "#374151", fontFamily: "monospace", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.productId}>
              #{shortId}
            </div>
            <div style={{ flex: 1, background: "#f0ede4", borderRadius: "4px", height: "22px", overflow: "hidden", position: "relative" }}>
              <div
                style={{ width: `${pct}%`, background: color, height: "100%", borderRadius: "4px", minWidth: "4px", display: "flex", alignItems: "center", paddingLeft: "6px", boxSizing: "border-box" }}
              >
                {pct > 18 && (
                  <span style={{ color: "#fff", fontSize: "9px", fontFamily: "monospace", fontWeight: "600" }}>
                    {p.count}×
                  </span>
                )}
              </div>
            </div>
            <div style={{ width: "44px", textAlign: "right", fontSize: "13px", fontWeight: "700", color: color, flexShrink: 0 }}>
              {p.count}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Chart: Box Performance (Grouped CSS Bars) ────────────────────────────
function BoxPerformanceChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <div style={{ padding: "48px 24px", textAlign: "center", color: "#7a7670", fontSize: "13px" }}>
        No box order data yet.
      </div>
    );
  }

  const maxRevenue = Math.max(...data.map((d) => d.revenue), 1);
  const maxOrders = Math.max(...data.map((d) => d.orders), 1);

  return (
    <div>
      {/* Revenue bars */}
      <div style={{ fontSize: "11px", color: "#7a7670", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "10px" }}>
        Revenue by Box Type
      </div>
      {data.map((b, i) => {
        const revPct = (b.revenue / maxRevenue) * 100;
        const ordPct = (b.orders / maxOrders) * 100;
        return (
          <div key={b.boxId} style={{ marginBottom: "14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
              <span style={{ fontSize: "12px", fontWeight: "600", color: "#1a1814" }}>{b.boxTitle}</span>
              <span style={{ fontSize: "11px", color: "#7a7670", fontFamily: "monospace" }}>
                {b.orders} order{b.orders !== 1 ? "s" : ""} · ₹{b.revenue.toLocaleString("en-IN")}
              </span>
            </div>
            {/* Revenue bar */}
            <div style={{ background: "#f0ede4", borderRadius: "4px", height: "14px", overflow: "hidden", marginBottom: "3px" }}>
              <div style={{ width: `${revPct}%`, background: "#2A7A4F", height: "100%", borderRadius: "4px", minWidth: "4px" }} />
            </div>
            {/* Orders bar */}
            <div style={{ background: "#f0ede4", borderRadius: "4px", height: "8px", overflow: "hidden" }}>
              <div style={{ width: `${ordPct}%`, background: "#86efac", height: "100%", borderRadius: "4px", minWidth: "4px" }} />
            </div>
          </div>
        );
      })}
      {/* Legend */}
      <div style={{ display: "flex", gap: "20px", marginTop: "12px", fontSize: "11px", color: "#7a7670" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          <span style={{ width: "12px", height: "7px", background: "#2A7A4F", borderRadius: "2px", display: "inline-block" }} />
          Revenue
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          <span style={{ width: "12px", height: "7px", background: "#86efac", borderRadius: "2px", display: "inline-block" }} />
          Orders
        </span>
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const { analytics } = useLoaderData();
  const { totalOrders, totalRevenue, avgBundleValue, activeBoxCount, topProducts, dailyTrend, boxPerformance } = analytics;

  const stats = [
    {
      label: "Total Bundle Revenue",
      value: `₹${totalRevenue.toLocaleString("en-IN")}`,
      icon: "💰",
      color: "#2A7A4F",
    },
    {
      label: "Bundles Sold",
      value: totalOrders,
      icon: "📦",
      color: "#1d4ed8",
    },
    {
      label: "Avg Bundle Value",
      value: `₹${avgBundleValue.toLocaleString("en-IN")}`,
      icon: "📊",
      color: "#7c3aed",
    },
    {
      label: "Box Types Active",
      value: activeBoxCount,
      icon: "🗂️",
      color: "#b45309",
    },
  ];

  return (
    <s-page heading="Analytics">
      {/* ── Stat Cards ── */}
      <s-section>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: "16px",
          }}
        >
          {stats.map((stat, i) => (
            <div
              key={i}
              style={{
                background: "#ffffff",
                border: "1px solid #e5e1d8",
                borderRadius: "10px",
                padding: "20px 18px",
                borderTop: `3px solid ${stat.color}`,
              }}
            >
              <div style={{ fontSize: "22px", marginBottom: "6px" }}>{stat.icon}</div>
              <div
                style={{
                  fontSize: "26px",
                  fontWeight: "700",
                  color: "#1a1814",
                  marginBottom: "4px",
                  lineHeight: 1,
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

      {/* ── Daily Revenue Chart ── */}
      <s-section heading="Daily Revenue Trend — Last 30 Days">
        <RevenueBarChart data={dailyTrend} />
      </s-section>

      {/* ── Two Column: Top Products + Box Performance ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        {/* Top Products */}
        <s-section heading="Top 10 Most Picked Products">
          <TopProductsChart data={topProducts} />
        </s-section>

        {/* Box Performance */}
        <s-section heading="Box Type Performance">
          <BoxPerformanceChart data={boxPerformance} />
        </s-section>
      </div>

      {/* ── Data Table: Daily Trend ── */}
      <s-section heading="Daily Breakdown">
        {dailyTrend.length === 0 ? (
          <s-paragraph>No data available yet.</s-paragraph>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr>
                {["Date", "Orders", "Revenue"].map((h) => (
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
                ))}
              </tr>
            </thead>
            <tbody>
              {[...dailyTrend].reverse().map((d) => (
                <tr key={d.date}>
                  <td style={{ padding: "9px 14px", borderBottom: "1px solid #f0ede4", color: "#374151", fontFamily: "monospace" }}>
                    {d.date}
                  </td>
                  <td style={{ padding: "9px 14px", borderBottom: "1px solid #f0ede4", color: "#374151" }}>
                    {d.orders}
                  </td>
                  <td style={{ padding: "9px 14px", borderBottom: "1px solid #f0ede4", color: "#2A7A4F", fontWeight: "600" }}>
                    ₹{d.revenue.toLocaleString("en-IN")}
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
