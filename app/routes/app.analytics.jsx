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

// ─── Helpers ────────────────────────────────────────────────────────────────
function fmtDate(isoStr) {
  const d = new Date(isoStr);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function fmtShortDate(isoStr) {
  const parts = isoStr.split("-"); // "YYYY-MM-DD"
  return `${parts[2]}/${parts[1]}`;
}

function fmtCurrency(val) {
  if (val >= 100000) return `₹${(val / 100000).toFixed(1)}L`;
  if (val >= 1000) return `₹${(val / 1000).toFixed(1)}k`;
  return `₹${Math.round(val)}`;
}

// ─── Shopify-Style Line Chart ───────────────────────────────────────────────
function ShopifyLineChart({
  title,
  displayValue,
  changePercent,
  data,
  prevData,
  periodLabel,
  prevPeriodLabel,
  formatY,
}) {
  const W = 760, H = 160, ML = 56, MR = 12, MB = 30, MT = 12;
  const chartW = W - ML - MR;
  const chartH = H - MB - MT;

  // Always render — use 0 when no data (flat zero line)
  const allValues = [
    ...data.map((d) => d.value),
    ...prevData.map((d) => d.value),
  ];
  const maxVal = Math.max(...allValues, 0);
  const yMax = maxVal > 0 ? maxVal : 10;

  // Y-axis ticks: 0, 50%, 100%
  const yTicks = [0, yMax * 0.5, yMax];

  // Smooth cubic-bezier SVG path for a data array
  function buildPath(pts) {
    if (pts.length === 0) return "";
    const n = pts.length;
    let d = `M ${pts[0].x},${pts[0].y}`;
    for (let i = 1; i < n; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      const cpx = (prev.x + curr.x) / 2;
      d += ` C ${cpx},${prev.y} ${cpx},${curr.y} ${curr.x},${curr.y}`;
    }
    return d;
  }

  // Map data → SVG coords
  function toPoints(arr) {
    return arr.map((d, i) => ({
      x: ML + (n > 1 ? (i / (arr.length - 1)) * chartW : chartW / 2),
      y: MT + chartH - (yMax > 0 ? (d.value / yMax) * chartH : 0),
    }));
  }

  const n = data.length;
  const curPts = toPoints(data);
  const prevPts = toPoints(prevData.length === data.length ? prevData : data.map((d) => ({ ...d, value: 0 })));

  const curPath = buildPath(curPts);
  const prevPath = buildPath(prevPts);

  // Area fill path (close below the line)
  function buildAreaPath(pts) {
    if (pts.length === 0) return "";
    const baseline = MT + chartH;
    const first = pts[0];
    const last = pts[pts.length - 1];
    return `${buildPath(pts)} L ${last.x},${baseline} L ${first.x},${baseline} Z`;
  }

  // Change indicator
  const isUp = changePercent === null ? null : changePercent >= 0;
  const changeStr =
    changePercent === null
      ? "No prior data"
      : `${isUp ? "↗" : "↙"} ${Math.abs(changePercent).toFixed(1)}%`;
  const changeColor =
    changePercent === null ? "#7a7670" : isUp ? "#2A7A4F" : "#dc2626";

  // X-axis labels: show first, middle, last
  const xLabelIndices = n <= 1 ? [0] : [0, Math.floor(n / 2), n - 1];

  return (
    <div style={{ marginBottom: "4px" }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "12px" }}>
        <div>
          <div style={{ fontSize: "11px", color: "#7a7670", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "4px" }}>
            {title}
          </div>
          <div style={{ fontSize: "28px", fontWeight: "700", color: "#1a1814", lineHeight: 1 }}>
            {displayValue}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "13px", fontWeight: "600", color: changeColor }}>
            {changeStr}
          </div>
          <div style={{ fontSize: "11px", color: "#7a7670", marginTop: "2px" }}>vs prev period</div>
        </div>
      </div>

      {/* SVG Chart */}
      <div style={{ overflowX: "auto" }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          style={{ display: "block", minWidth: "320px", maxWidth: "100%" }}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <linearGradient id={`area-gradient-${title}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563eb" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Y-axis grid lines + labels */}
          {yTicks.map((tick, i) => {
            const y = MT + chartH - (yMax > 0 ? (tick / yMax) * chartH : 0);
            return (
              <g key={i}>
                <line
                  x1={ML} y1={y} x2={W - MR} y2={y}
                  stroke={i === 0 ? "#c9c6be" : "#e5e1d8"}
                  strokeWidth="1"
                />
                <text
                  x={ML - 6} y={y + 4}
                  textAnchor="end" fontSize="10" fill="#7a7670"
                  fontFamily="'SF Mono', 'Monaco', monospace"
                >
                  {formatY(tick)}
                </text>
              </g>
            );
          })}

          {/* Area fill (current period) */}
          <path d={buildAreaPath(curPts)} fill={`url(#area-gradient-${title})`} />

          {/* Previous period line (dashed, light blue) */}
          {prevPts.length > 0 && (
            <path
              d={prevPath}
              fill="none"
              stroke="#93c5fd"
              strokeWidth="2"
              strokeDasharray="5,4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Current period line (solid, dark blue) */}
          <path
            d={curPath}
            fill="none"
            stroke="#2563eb"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Data point dots (current) */}
          {curPts.map((pt, i) => (
            <circle key={i} cx={pt.x} cy={pt.y} r="3" fill="#2563eb">
              <title>{data[i]?.label || ""}: {formatY(data[i]?.value || 0)}</title>
            </circle>
          ))}

          {/* X-axis labels */}
          {xLabelIndices.map((idx) => {
            if (!data[idx]) return null;
            const x = ML + (n > 1 ? (idx / (n - 1)) * chartW : chartW / 2);
            return (
              <text
                key={idx}
                x={x} y={H - 6}
                textAnchor="middle" fontSize="9" fill="#7a7670"
                fontFamily="'SF Mono', 'Monaco', monospace"
              >
                {fmtShortDate(data[idx].date)}
              </text>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: "16px", marginTop: "8px", fontSize: "11px", color: "#7a7670" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          <svg width="18" height="2" style={{ verticalAlign: "middle" }}>
            <line x1="0" y1="1" x2="18" y2="1" stroke="#2563eb" strokeWidth="2.5" />
          </svg>
          {periodLabel || "Current period"}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          <svg width="18" height="2" style={{ verticalAlign: "middle" }}>
            <line x1="0" y1="1" x2="18" y2="1" stroke="#93c5fd" strokeWidth="2" strokeDasharray="4,3" />
          </svg>
          {prevPeriodLabel || "Previous period"}
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
            <div style={{ flex: 1, background: "#f0ede4", borderRadius: "4px", height: "22px", overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, background: color, height: "100%", borderRadius: "4px", minWidth: "4px", display: "flex", alignItems: "center", paddingLeft: "6px", boxSizing: "border-box" }}>
                {pct > 18 && (
                  <span style={{ color: "#fff", fontSize: "9px", fontFamily: "monospace", fontWeight: "600" }}>
                    {p.count}×
                  </span>
                )}
              </div>
            </div>
            <div style={{ width: "44px", textAlign: "right", fontSize: "13px", fontWeight: "700", color, flexShrink: 0 }}>
              {p.count}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Chart: Box Performance ─────────────────────────────────────────────────
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
      <div style={{ fontSize: "11px", color: "#7a7670", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "10px" }}>
        Revenue by Box Type
      </div>
      {data.map((b) => {
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
            <div style={{ background: "#f0ede4", borderRadius: "4px", height: "14px", overflow: "hidden", marginBottom: "3px" }}>
              <div style={{ width: `${revPct}%`, background: "#2A7A4F", height: "100%", borderRadius: "4px", minWidth: "4px" }} />
            </div>
            <div style={{ background: "#f0ede4", borderRadius: "4px", height: "8px", overflow: "hidden" }}>
              <div style={{ width: `${ordPct}%`, background: "#86efac", height: "100%", borderRadius: "4px", minWidth: "4px" }} />
            </div>
          </div>
        );
      })}
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
  const {
    totalOrders,
    totalRevenue,
    avgBundleValue,
    activeBoxCount,
    prevTotalOrders,
    prevTotalRevenue,
    revenueChange,
    ordersChange,
    topProducts,
    dailyTrend,
    prevDailyTrend,
    boxPerformance,
    period,
    prevPeriod,
  } = analytics;

  // Format period labels for chart legend
  const periodLabel = period
    ? `${fmtDate(period.from)} – ${fmtDate(period.to)}`
    : "Current period";
  const prevPeriodLabel = prevPeriod
    ? `${fmtDate(prevPeriod.from)} – ${fmtDate(prevPeriod.to)}`
    : "Previous period";

  // Map daily trend to chart-friendly format
  const revData = (dailyTrend || []).map((d) => ({ date: d.date, value: d.revenue, label: `₹${d.revenue}` }));
  const prevRevData = (prevDailyTrend || []).map((d) => ({ date: d.date, value: d.revenue }));
  const ordData = (dailyTrend || []).map((d) => ({ date: d.date, value: d.orders, label: `${d.orders} orders` }));
  const prevOrdData = (prevDailyTrend || []).map((d) => ({ date: d.date, value: d.orders }));

  // Change badge for stat cards
  function ChangeBadge({ pct }) {
    if (pct === null || pct === undefined) return <span style={{ fontSize: "11px", color: "#7a7670" }}>—</span>;
    const up = pct >= 0;
    return (
      <span style={{ fontSize: "11px", fontWeight: "600", color: up ? "#2A7A4F" : "#dc2626" }}>
        {up ? "↗" : "↙"} {Math.abs(pct).toFixed(1)}%
      </span>
    );
  }

  const stats = [
    {
      label: "Total Bundle Revenue",
      value: `₹${totalRevenue.toLocaleString("en-IN")}`,
      sub: `prev ₹${(prevTotalRevenue || 0).toLocaleString("en-IN")}`,
      change: revenueChange,
      color: "#2A7A4F",
    },
    {
      label: "Bundles Sold",
      value: totalOrders,
      sub: `prev ${prevTotalOrders || 0}`,
      change: ordersChange,
      color: "#1d4ed8",
    },
    {
      label: "Avg Bundle Value",
      value: `₹${avgBundleValue.toLocaleString("en-IN")}`,
      sub: null,
      change: null,
      color: "#7c3aed",
    },
    {
      label: "Box Types Active",
      value: activeBoxCount,
      sub: null,
      change: null,
      color: "#b45309",
    },
  ];

  return (
    <s-page heading="Analytics">
      {/* ── Stat Cards ── */}
      <s-section>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
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
              <div style={{ fontSize: "26px", fontWeight: "700", color: "#1a1814", marginBottom: "4px", lineHeight: 1 }}>
                {stat.value}
              </div>
              <div style={{ fontSize: "11px", color: "#7a7670", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "6px" }}>
                {stat.label}
              </div>
              {(stat.change !== null && stat.change !== undefined) || stat.sub ? (
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <ChangeBadge pct={stat.change} />
                  {stat.sub && (
                    <span style={{ fontSize: "10px", color: "#9ca3af" }}>{stat.sub}</span>
                  )}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </s-section>

      {/* ── Revenue Line Chart ── */}
      <s-section heading="Revenue Over Time">
        <ShopifyLineChart
          title="Bundle Revenue"
          displayValue={`₹${totalRevenue.toLocaleString("en-IN")}`}
          changePercent={revenueChange}
          data={revData}
          prevData={prevRevData}
          periodLabel={periodLabel}
          prevPeriodLabel={prevPeriodLabel}
          formatY={fmtCurrency}
        />
      </s-section>

      {/* ── Orders Line Chart ── */}
      <s-section heading="Orders Over Time">
        <ShopifyLineChart
          title="Bundles Sold"
          displayValue={String(totalOrders)}
          changePercent={ordersChange}
          data={ordData}
          prevData={prevOrdData}
          periodLabel={periodLabel}
          prevPeriodLabel={prevPeriodLabel}
          formatY={(v) => String(Math.round(v))}
        />
      </s-section>

      {/* ── Two Column: Top Products + Box Performance ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        <s-section heading="Top 10 Most Picked Products">
          <TopProductsChart data={topProducts} />
        </s-section>
        <s-section heading="Box Type Performance">
          <BoxPerformanceChart data={boxPerformance} />
        </s-section>
      </div>

      {/* ── Daily Breakdown Table ── */}
      <s-section heading="Daily Breakdown">
        {!dailyTrend || dailyTrend.length === 0 ? (
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
              {[...dailyTrend].reverse().map((d) => {
                const isEmpty = d.orders === 0 && d.revenue === 0;
                return (
                  <tr key={d.date} style={{ opacity: isEmpty ? 0.45 : 1 }}>
                    <td style={{ padding: "9px 14px", borderBottom: "1px solid #f0ede4", color: "#374151", fontFamily: "monospace" }}>
                      {d.date}
                    </td>
                    <td style={{ padding: "9px 14px", borderBottom: "1px solid #f0ede4", color: isEmpty ? "#9ca3af" : "#374151" }}>
                      {d.orders}
                    </td>
                    <td style={{ padding: "9px 14px", borderBottom: "1px solid #f0ede4", color: isEmpty ? "#9ca3af" : "#2A7A4F", fontWeight: isEmpty ? "400" : "600" }}>
                      ₹{d.revenue.toLocaleString("en-IN")}
                    </td>
                  </tr>
                );
              })}
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
