import { useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getAnalytics } from "../models/orders.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const period = url.searchParams.get("period") || "30";
  const customFrom = url.searchParams.get("from") || null;
  const customTo = url.searchParams.get("to") || null;

  let fromDate, toDate;
  if (customFrom && customTo) {
    fromDate = customFrom;
    toDate = customTo;
  } else {
    const days = parseInt(period) || 30;
    const toD = new Date();
    const fromD = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    fromDate = fromD.toISOString().slice(0, 10);
    toDate = toD.toISOString().slice(0, 10);
  }

  const analytics = await getAnalytics(session.shop, fromDate, toDate);
  return { analytics, period: customFrom ? "custom" : period };
};

// ─── Helpers ────────────────────────────────────────────────────────────────
function fmtCurrency(val) {
  if (val >= 100000) return `₹${(val / 100000).toFixed(1)}L`;
  if (val >= 1000) return `₹${(val / 1000).toFixed(1)}k`;
  return `₹${Math.round(val)}`;
}

function fmtShortDate(isoStr) {
  const p = isoStr.split("-");
  return `${parseInt(p[2])}/${parseInt(p[1])}`;
}

function fmtDate(isoStr) {
  return new Date(isoStr).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

// ─── Period Selector ─────────────────────────────────────────────────────────
function PeriodSelector({ active }) {
  const periods = [
    { key: "7", label: "7D" },
    { key: "30", label: "30D" },
    { key: "90", label: "90D" },
  ];
  return (
    <div style={{ display: "flex", gap: "4px", background: "#f0ede4", borderRadius: "8px", padding: "3px" }}>
      {periods.map((p) => (
        <a
          key={p.key}
          href={`?period=${p.key}`}
          style={{
            padding: "5px 14px",
            borderRadius: "6px",
            fontSize: "12px",
            fontFamily: "monospace",
            fontWeight: "600",
            textDecoration: "none",
            color: active === p.key ? "#fff" : "#7a7670",
            background: active === p.key ? "#1a1814" : "transparent",
            transition: "all 0.15s",
            letterSpacing: "0.5px",
          }}
        >
          {p.label}
        </a>
      ))}
    </div>
  );
}

// ─── KPI Card ────────────────────────────────────────────────────────────────
function KpiCard({ label, value, subValue, change, accentColor, icon }) {
  const isUp = change === null ? null : change >= 0;
  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #e5e1d8",
        borderRadius: "12px",
        padding: "20px 20px 18px",
        borderLeft: `4px solid ${accentColor}`,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Background watermark */}
      <div style={{ position: "absolute", right: "-6px", top: "-6px", fontSize: "52px", opacity: "0.06", userSelect: "none" }}>
        {icon}
      </div>
      <div style={{ fontSize: "10px", fontFamily: "monospace", color: "#7a7670", textTransform: "uppercase", letterSpacing: "1.2px", marginBottom: "8px" }}>
        {label}
      </div>
      <div style={{ fontSize: "30px", fontWeight: "800", color: "#1a1814", lineHeight: 1, letterSpacing: "-1px", marginBottom: "8px" }}>
        {value}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        {change !== null && change !== undefined ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "3px",
              fontSize: "11px",
              fontWeight: "700",
              fontFamily: "monospace",
              color: isUp ? "#2A7A4F" : "#dc2626",
              background: isUp ? "#e8f5ee" : "#fef2f2",
              padding: "2px 8px",
              borderRadius: "20px",
            }}
          >
            {isUp ? "↗" : "↙"} {Math.abs(change).toFixed(1)}%
          </span>
        ) : (
          <span style={{ fontSize: "11px", color: "#9ca3af", fontFamily: "monospace" }}>—</span>
        )}
        {subValue && (
          <span style={{ fontSize: "11px", color: "#9ca3af", fontFamily: "monospace" }}>
            prev {subValue}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Shopify-Style Line Chart ─────────────────────────────────────────────────
function LineChart({ title, totalValue, change, data, prevData, periodLabel, prevPeriodLabel, formatY, color = "#2563eb" }) {
  const W = 740, H = 170, ML = 52, MR = 12, MB = 28, MT = 14;
  const chartW = W - ML - MR;
  const chartH = H - MB - MT;
  const n = data.length;

  const maxVal = Math.max(...data.map((d) => d.value), ...prevData.map((d) => d.value), 0);
  const yMax = maxVal > 0 ? maxVal : 10;
  const yMid = yMax / 2;

  function xPos(i, total) {
    return ML + (total > 1 ? (i / (total - 1)) * chartW : chartW / 2);
  }
  function yPos(val) {
    return MT + chartH - (yMax > 0 ? (val / yMax) * chartH : 0);
  }

  function buildPath(arr) {
    if (arr.length === 0) return "";
    let d = `M ${xPos(0, arr.length)},${yPos(arr[0].value)}`;
    for (let i = 1; i < arr.length; i++) {
      const x0 = xPos(i - 1, arr.length), y0 = yPos(arr[i - 1].value);
      const x1 = xPos(i, arr.length), y1 = yPos(arr[i].value);
      const cpx = (x0 + x1) / 2;
      d += ` C ${cpx},${y0} ${cpx},${y1} ${x1},${y1}`;
    }
    return d;
  }

  function buildArea(arr) {
    if (arr.length === 0) return "";
    const base = MT + chartH;
    const firstX = xPos(0, arr.length);
    const lastX = xPos(arr.length - 1, arr.length);
    return `${buildPath(arr)} L ${lastX},${base} L ${firstX},${base} Z`;
  }

  const curPts = data.map((d, i) => ({ x: xPos(i, n), y: yPos(d.value) }));
  const prevArr = prevData.length === n ? prevData : data.map((d) => ({ ...d, value: 0 }));
  const gradId = `grad-${title.replace(/\s/g, "")}`;

  const isUp = change === null ? null : change >= 0;

  // X axis: show ~5 evenly spaced labels
  const xLabels = [];
  if (n > 0) {
    const step = Math.max(1, Math.floor(n / 5));
    for (let i = 0; i < n; i += step) xLabels.push(i);
    if (xLabels[xLabels.length - 1] !== n - 1) xLabels.push(n - 1);
  }

  return (
    <div>
      {/* Chart header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "16px" }}>
        <div>
          <div style={{ fontSize: "10px", fontFamily: "monospace", color: "#7a7670", textTransform: "uppercase", letterSpacing: "1.2px", marginBottom: "4px" }}>
            {title}
          </div>
          <div style={{ fontSize: "32px", fontWeight: "800", color: "#1a1814", letterSpacing: "-1.5px", lineHeight: 1 }}>
            {totalValue}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          {change !== null && change !== undefined ? (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                fontSize: "13px",
                fontWeight: "700",
                color: isUp ? "#2A7A4F" : "#dc2626",
                background: isUp ? "#e8f5ee" : "#fef2f2",
                padding: "4px 12px",
                borderRadius: "20px",
              }}
            >
              {isUp ? "↗" : "↙"} {Math.abs(change).toFixed(1)}% vs prev period
            </div>
          ) : (
            <div style={{ fontSize: "11px", color: "#9ca3af", fontFamily: "monospace" }}>No comparison data</div>
          )}
        </div>
      </div>

      {/* SVG Chart */}
      <div style={{ position: "relative", overflowX: "auto" }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          style={{ display: "block", minWidth: "300px" }}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.18" />
              <stop offset="100%" stopColor={color} stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {/* Y-axis grid: 0, mid, max */}
          {[0, yMid, yMax].map((tick, i) => {
            const y = yPos(tick);
            return (
              <g key={i}>
                <line x1={ML} y1={y} x2={W - MR} y2={y} stroke={i === 0 ? "#d1cec6" : "#ede9e0"} strokeWidth="1" />
                <text x={ML - 6} y={y + 4} textAnchor="end" fontSize="9.5" fill="#9ca3af" fontFamily="monospace">
                  {formatY(tick)}
                </text>
              </g>
            );
          })}

          {/* Area fill */}
          <path d={buildArea(data)} fill={`url(#${gradId})`} />

          {/* Previous period line */}
          {prevArr.length > 0 && (
            <path d={buildPath(prevArr)} fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeDasharray="5,4" strokeLinecap="round" opacity="0.7" />
          )}

          {/* Current period line */}
          <path d={buildPath(data)} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

          {/* Dots on current line */}
          {curPts.map((pt, i) => (
            <circle key={i} cx={pt.x} cy={pt.y} r="2.5" fill={color} opacity="0.8">
              <title>{data[i]?.date || ""}: {formatY(data[i]?.value || 0)}</title>
            </circle>
          ))}

          {/* X-axis labels */}
          {xLabels.map((idx) => {
            if (!data[idx]) return null;
            return (
              <text key={idx} x={xPos(idx, n)} y={H - 6} textAnchor="middle" fontSize="9" fill="#9ca3af" fontFamily="monospace">
                {fmtShortDate(data[idx].date)}
              </text>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: "20px", marginTop: "10px", fontSize: "11px", color: "#7a7670" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <svg width="20" height="3" style={{ verticalAlign: "middle" }}>
            <line x1="0" y1="1.5" x2="20" y2="1.5" stroke={color} strokeWidth="2.5" />
          </svg>
          {periodLabel}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <svg width="20" height="3" style={{ verticalAlign: "middle" }}>
            <line x1="0" y1="1.5" x2="20" y2="1.5" stroke="#cbd5e1" strokeWidth="2" strokeDasharray="5,3" />
          </svg>
          {prevPeriodLabel}
        </span>
      </div>
    </div>
  );
}

// ─── Top Products Horizontal Bar Chart ───────────────────────────────────────
function TopProductsChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <div style={{ padding: "40px 0", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>
        <div style={{ fontSize: "28px", marginBottom: "8px" }}>📊</div>
        No product selection data yet.
      </div>
    );
  }

  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const total = data.reduce((s, d) => s + d.count, 0);
  const palette = ["#2563eb", "#2A7A4F", "#7c3aed", "#b45309", "#dc2626", "#0891b2", "#059669", "#d97706", "#9333ea", "#be123c"];

  return (
    <div>
      {/* Header row */}
      <div style={{ display: "grid", gridTemplateColumns: "24px 1fr 120px 44px", gap: "8px", paddingBottom: "8px", borderBottom: "1px solid #e5e1d8", marginBottom: "10px" }}>
        {["#", "Product", "Times Picked", "%"].map((h) => (
          <div key={h} style={{ fontSize: "9px", fontFamily: "monospace", color: "#9ca3af", textTransform: "uppercase", letterSpacing: "1px" }}>{h}</div>
        ))}
      </div>
      {data.map((p, i) => {
        const pct = (p.count / maxCount) * 100;
        const sharePct = total > 0 ? ((p.count / total) * 100).toFixed(0) : 0;
        const shortId = p.productId.includes("/") ? p.productId.split("/").pop() : p.productId;
        const color = palette[i % palette.length];
        return (
          <div key={p.productId} style={{ display: "grid", gridTemplateColumns: "24px 1fr 120px 44px", gap: "8px", alignItems: "center", marginBottom: "9px" }}>
            <div style={{ fontSize: "11px", fontFamily: "monospace", fontWeight: "700", color: "#9ca3af", textAlign: "right" }}>{i + 1}</div>
            <div style={{ fontSize: "11px", fontFamily: "monospace", color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.productId}>
              #{shortId}
            </div>
            <div style={{ background: "#f0ede4", borderRadius: "4px", height: "20px", overflow: "hidden" }}>
              <div
                style={{
                  width: `${pct}%`,
                  background: `linear-gradient(90deg, ${color}cc, ${color})`,
                  height: "100%",
                  borderRadius: "4px",
                  minWidth: "4px",
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: "6px",
                  boxSizing: "border-box",
                  transition: "width 0.6s ease",
                }}
              >
                {pct > 20 && <span style={{ color: "#fff", fontSize: "9px", fontFamily: "monospace", fontWeight: "700" }}>{p.count}×</span>}
              </div>
            </div>
            <div style={{ fontSize: "11px", fontWeight: "700", color, textAlign: "right", fontFamily: "monospace" }}>{sharePct}%</div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Box Performance Chart ────────────────────────────────────────────────────
function BoxPerformanceChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <div style={{ padding: "40px 0", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>
        <div style={{ fontSize: "28px", marginBottom: "8px" }}>📦</div>
        No box order data yet.
      </div>
    );
  }

  const maxRev = Math.max(...data.map((d) => d.revenue), 1);
  const totalOrders = data.reduce((s, d) => s + d.orders, 0);
  const totalRev = data.reduce((s, d) => s + d.revenue, 0);

  return (
    <div>
      {data.map((b, i) => {
        const revPct = (b.revenue / maxRev) * 100;
        const shareOrders = totalOrders > 0 ? ((b.orders / totalOrders) * 100).toFixed(0) : 0;
        const shareRev = totalRev > 0 ? ((b.revenue / totalRev) * 100).toFixed(0) : 0;
        const hue = 142 + i * 18;
        return (
          <div key={b.boxId} style={{ marginBottom: "16px", paddingBottom: "16px", borderBottom: "1px solid #f0ede4" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "6px" }}>
              <div style={{ fontSize: "13px", fontWeight: "700", color: "#1a1814" }}>{b.boxTitle}</div>
              <div style={{ display: "flex", gap: "12px", fontSize: "11px", fontFamily: "monospace", color: "#7a7670" }}>
                <span style={{ color: "#2A7A4F", fontWeight: "700" }}>{shareRev}% rev</span>
                <span>{b.orders} orders</span>
              </div>
            </div>
            <div style={{ background: "#f0ede4", borderRadius: "6px", height: "10px", overflow: "hidden", marginBottom: "4px" }}>
              <div
                style={{
                  width: `${revPct}%`,
                  background: `linear-gradient(90deg, hsl(${hue},60%,40%), hsl(${hue},50%,55%))`,
                  height: "100%",
                  borderRadius: "6px",
                  minWidth: "4px",
                  transition: "width 0.7s ease",
                }}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "#9ca3af", fontFamily: "monospace" }}>
              <span>{fmtCurrency(b.revenue)}</span>
              <span>{shareOrders}% of orders</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Comparison Period Banner ─────────────────────────────────────────────────
function ComparisonBanner({ period, prevPeriod }) {
  if (!period || !prevPeriod) return null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "10px 16px",
        background: "linear-gradient(135deg, #eff6ff, #f0fdf4)",
        border: "1px solid #dbeafe",
        borderRadius: "8px",
        marginBottom: "20px",
        fontSize: "12px",
        color: "#374151",
      }}
    >
      <span style={{ fontSize: "16px" }}>📅</span>
      <div>
        <span style={{ fontWeight: "700", color: "#1d4ed8" }}>Current: </span>
        <span style={{ fontFamily: "monospace" }}>{fmtDate(period.from)} → {fmtDate(period.to)}</span>
        <span style={{ margin: "0 12px", color: "#d1d5db" }}>|</span>
        <span style={{ fontWeight: "700", color: "#6b7280" }}>Previous: </span>
        <span style={{ fontFamily: "monospace", color: "#6b7280" }}>{fmtDate(prevPeriod.from)} → {fmtDate(prevPeriod.to)}</span>
      </div>
    </div>
  );
}

// ─── Daily Breakdown Table ────────────────────────────────────────────────────
function DailyTable({ data }) {
  const reversed = [...(data || [])].reverse();
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
        <thead>
          <tr>
            {["Date", "Orders", "Revenue", "Trend"].map((h) => (
              <th
                key={h}
                style={{
                  textAlign: "left",
                  padding: "10px 14px",
                  borderBottom: "2px solid #e5e1d8",
                  color: "#7a7670",
                  fontFamily: "monospace",
                  fontSize: "10px",
                  textTransform: "uppercase",
                  letterSpacing: "1.2px",
                  fontWeight: "500",
                  background: "#faf9f7",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {reversed.map((d) => {
            const isEmpty = d.orders === 0 && d.revenue === 0;
            const maxRev = Math.max(...(data || []).map((x) => x.revenue), 1);
            const barW = isEmpty ? 0 : Math.max(2, (d.revenue / maxRev) * 80);
            return (
              <tr key={d.date} style={{ opacity: isEmpty ? 0.4 : 1 }}>
                <td style={{ padding: "9px 14px", borderBottom: "1px solid #f5f3ef", fontFamily: "monospace", color: "#374151", fontWeight: "600" }}>
                  {d.date}
                </td>
                <td style={{ padding: "9px 14px", borderBottom: "1px solid #f5f3ef", color: isEmpty ? "#9ca3af" : "#374151", fontFamily: "monospace" }}>
                  {d.orders}
                </td>
                <td style={{ padding: "9px 14px", borderBottom: "1px solid #f5f3ef", color: isEmpty ? "#9ca3af" : "#2A7A4F", fontWeight: isEmpty ? "400" : "700", fontFamily: "monospace" }}>
                  ₹{d.revenue.toLocaleString("en-IN")}
                </td>
                <td style={{ padding: "9px 14px", borderBottom: "1px solid #f5f3ef" }}>
                  <div style={{ width: `${barW}px`, height: "6px", background: isEmpty ? "#e5e1d8" : "linear-gradient(90deg, #2563eb, #2A7A4F)", borderRadius: "3px", minWidth: isEmpty ? "0" : "3px", transition: "width 0.3s" }} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Analytics Page ──────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const { analytics, period } = useLoaderData();
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
    period: periodRange,
    prevPeriod,
  } = analytics;

  const periodLabel = periodRange ? `${fmtDate(periodRange.from)} – ${fmtDate(periodRange.to)}` : "Current";
  const prevPeriodLabel = prevPeriod ? `${fmtDate(prevPeriod.from)} – ${fmtDate(prevPeriod.to)}` : "Previous";

  const revData = (dailyTrend || []).map((d) => ({ date: d.date, value: d.revenue }));
  const prevRevData = (prevDailyTrend || []).map((d) => ({ date: d.date, value: d.revenue }));
  const ordData = (dailyTrend || []).map((d) => ({ date: d.date, value: d.orders }));
  const prevOrdData = (prevDailyTrend || []).map((d) => ({ date: d.date, value: d.orders }));

  // Avg change: not directly computed but we show relative context
  const avgChange = (prevTotalOrders > 0 && prevTotalRevenue > 0)
    ? ((avgBundleValue - prevTotalRevenue / prevTotalOrders) / (prevTotalRevenue / prevTotalOrders)) * 100
    : null;

  return (
    <s-page heading="Analytics">
      {/* ── Top Bar: Period Selector ── */}
      <s-section>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <div style={{ fontSize: "13px", color: "#374151", fontWeight: "600" }}>
              Performance Overview
            </div>
            <div style={{ fontSize: "11px", color: "#9ca3af", fontFamily: "monospace", marginTop: "2px" }}>
              Showing bundle analytics · period-over-period comparison
            </div>
          </div>
          <PeriodSelector active={period} />
        </div>
      </s-section>

      {/* ── Comparison Period Banner ── */}
      <s-section>
        <ComparisonBanner period={periodRange} prevPeriod={prevPeriod} />

        {/* ── KPI Cards ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "14px" }}>
          <KpiCard
            label="Bundle Revenue"
            value={`₹${totalRevenue.toLocaleString("en-IN")}`}
            subValue={`₹${(prevTotalRevenue || 0).toLocaleString("en-IN")}`}
            change={revenueChange}
            accentColor="#2563eb"
            icon="💰"
          />
          <KpiCard
            label="Bundles Sold"
            value={totalOrders}
            subValue={prevTotalOrders || 0}
            change={ordersChange}
            accentColor="#2A7A4F"
            icon="📦"
          />
          <KpiCard
            label="Avg Bundle Value"
            value={`₹${avgBundleValue.toLocaleString("en-IN")}`}
            subValue={null}
            change={avgChange}
            accentColor="#7c3aed"
            icon="📊"
          />
          <KpiCard
            label="Active Box Types"
            value={activeBoxCount}
            subValue={null}
            change={null}
            accentColor="#b45309"
            icon="🗂️"
          />
        </div>
      </s-section>

      {/* ── Revenue Line Chart ── */}
      <s-section heading="Revenue Over Time">
        <div style={{ padding: "4px 0 16px" }}>
          <LineChart
            title="Total Bundle Revenue"
            totalValue={`₹${totalRevenue.toLocaleString("en-IN")}`}
            change={revenueChange}
            data={revData}
            prevData={prevRevData}
            periodLabel={periodLabel}
            prevPeriodLabel={prevPeriodLabel}
            formatY={fmtCurrency}
            color="#2563eb"
          />
        </div>
      </s-section>

      {/* ── Orders Line Chart ── */}
      <s-section heading="Orders Over Time">
        <div style={{ padding: "4px 0 16px" }}>
          <LineChart
            title="Bundles Sold"
            totalValue={String(totalOrders)}
            change={ordersChange}
            data={ordData}
            prevData={prevOrdData}
            periodLabel={periodLabel}
            prevPeriodLabel={prevPeriodLabel}
            formatY={(v) => String(Math.round(v))}
            color="#2A7A4F"
          />
        </div>
      </s-section>

      {/* ── Two Column: Products + Box Performance ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        <s-section heading="Top Products Picked">
          <div style={{ padding: "4px 0 8px" }}>
            <TopProductsChart data={topProducts} />
          </div>
        </s-section>

        <s-section heading="Box Type Performance">
          <div style={{ padding: "4px 0 8px" }}>
            <BoxPerformanceChart data={boxPerformance} />
          </div>
        </s-section>
      </div>

      {/* ── Daily Breakdown Table ── */}
      <s-section heading="Daily Breakdown">
        {!dailyTrend || dailyTrend.length === 0 ? (
          <s-paragraph>No data available yet for this period.</s-paragraph>
        ) : (
          <DailyTable data={dailyTrend} />
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
