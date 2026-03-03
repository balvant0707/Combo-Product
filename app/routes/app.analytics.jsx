import { useState, useRef, useCallback } from "react";
import { useLoaderData } from "react-router";
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
  if (!isoStr) return "";
  const d = new Date(isoStr + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function fmtDate(isoStr) {
  return new Date(isoStr).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

// ─── Period Selector ─────────────────────────────────────────────────────────
function PeriodSelector({ active }) {
  const periods = [
    { key: "7", label: "7 Days" },
    { key: "30", label: "30 Days" },
    { key: "90", label: "90 Days" },
  ];
  return (
    <div style={{ display: "flex", gap: "6px" }}>
      {periods.map((p) => (
        <a
          key={p.key}
          href={`?period=${p.key}`}
          style={{
            padding: "7px 16px",
            borderRadius: "8px",
            fontSize: "13px",
            fontWeight: "600",
            textDecoration: "none",
            color: active === p.key ? "#fff" : "#6b7280",
            background: active === p.key ? "#2A7A4F" : "#f3f4f6",
            border: `1.5px solid ${active === p.key ? "#2A7A4F" : "#e5e7eb"}`,
            transition: "all 0.15s ease",
            letterSpacing: "0.2px",
          }}
        >
          {p.label}
        </a>
      ))}
    </div>
  );
}

// ─── KPI Card ────────────────────────────────────────────────────────────────
function KpiCard({ label, value, subLabel, change, accentColor, icon, subtitle }) {
  const isUp = change === null ? null : change >= 0;
  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #e5e7eb",
        borderRadius: "14px",
        padding: "20px 22px 18px",
        position: "relative",
        overflow: "hidden",
        boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
        transition: "box-shadow 0.2s",
      }}
    >
      {/* Top accent line */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "3px", background: accentColor, borderRadius: "14px 14px 0 0" }} />

      {/* Icon bubble */}
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "36px",
          height: "36px",
          borderRadius: "10px",
          background: `${accentColor}15`,
          fontSize: "18px",
          marginBottom: "12px",
        }}
      >
        {icon}
      </div>

      <div style={{ fontSize: "11px", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.8px", fontWeight: "600", marginBottom: "6px" }}>
        {label}
      </div>
      <div style={{ fontSize: "28px", fontWeight: "800", color: "#111827", lineHeight: 1, letterSpacing: "-0.5px", marginBottom: "10px" }}>
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
              color: isUp ? "#059669" : "#dc2626",
              background: isUp ? "#d1fae5" : "#fee2e2",
              padding: "3px 8px",
              borderRadius: "20px",
            }}
          >
            {isUp ? "↑" : "↓"} {Math.abs(change).toFixed(1)}%
          </span>
        ) : null}
        {subLabel && (
          <span style={{ fontSize: "11px", color: "#9ca3af" }}>
            {subLabel}
          </span>
        )}
      </div>
      {subtitle && (
        <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "6px" }}>{subtitle}</div>
      )}
    </div>
  );
}

// ─── Dark Interactive Line Chart ──────────────────────────────────────────────
function LineChart({
  title,
  totalValue,
  change,
  data,
  prevData,
  periodLabel,
  prevPeriodLabel,
  formatY,
  color = "#60a5fa",
  color2 = "#818cf8",
}) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const svgRef = useRef(null);

  const W = 760, H = 200, ML = 52, MR = 20, MB = 36, MT = 18;
  const chartW = W - ML - MR;
  const chartH = H - MB - MT;
  const n = data.length;

  const allVals = [...data.map((d) => d.value), ...prevData.map((d) => d.value), 0];
  const rawMax = Math.max(...allVals);
  const yMax = rawMax > 0 ? rawMax * 1.1 : 10;

  function xPos(i, total) {
    return ML + (total > 1 ? (i / (total - 1)) * chartW : chartW / 2);
  }
  function yPos(val) {
    return MT + chartH - (yMax > 0 ? (val / yMax) * chartH : 0);
  }

  function buildPath(arr) {
    if (!arr || arr.length === 0) return "";
    let d = `M ${xPos(0, arr.length).toFixed(2)},${yPos(arr[0].value).toFixed(2)}`;
    for (let i = 1; i < arr.length; i++) {
      const x0 = xPos(i - 1, arr.length), y0 = yPos(arr[i - 1].value);
      const x1 = xPos(i, arr.length), y1 = yPos(arr[i].value);
      const cpx = (x0 + x1) / 2;
      d += ` C ${cpx.toFixed(2)},${y0.toFixed(2)} ${cpx.toFixed(2)},${y1.toFixed(2)} ${x1.toFixed(2)},${y1.toFixed(2)}`;
    }
    return d;
  }

  function buildArea(arr) {
    if (!arr || arr.length === 0) return "";
    const base = MT + chartH;
    const firstX = xPos(0, arr.length);
    const lastX = xPos(arr.length - 1, arr.length);
    return `${buildPath(arr)} L ${lastX.toFixed(2)},${base} L ${firstX.toFixed(2)},${base} Z`;
  }

  // Y-axis ticks: 0, 25%, 50%, 75%, 100% of yMax
  const yTicks = [0, yMax * 0.25, yMax * 0.5, yMax * 0.75, yMax].map(Math.round);

  // X-axis labels: at most 7 evenly spaced
  const xLabels = [];
  if (n > 0) {
    const step = Math.max(1, Math.floor(n / 6));
    for (let i = 0; i < n; i += step) xLabels.push(i);
    if (xLabels[xLabels.length - 1] !== n - 1) xLabels.push(n - 1);
  }

  const prevArr = prevData.length > 0 ? prevData : [];

  const gradId = `lineg-${title.replace(/\s+/g, "")}`;
  const areaGradId = `areag-${title.replace(/\s+/g, "")}`;

  const isUp = change === null ? null : change >= 0;

  // Hover tooltip position
  let tooltipX = 0, tooltipY = 0, tooltipLeft = true;
  if (hoverIdx !== null && data[hoverIdx]) {
    tooltipX = xPos(hoverIdx, n);
    tooltipY = yPos(data[hoverIdx].value);
    tooltipLeft = tooltipX > W * 0.6; // flip to left if near right edge
  }

  const handleMouseMove = useCallback(
    (e) => {
      const svg = svgRef.current;
      if (!svg || n === 0) return;
      const rect = svg.getBoundingClientRect();
      const scaleX = W / rect.width;
      const svgX = (e.clientX - rect.left) * scaleX;
      let closestIdx = 0;
      let minDist = Infinity;
      for (let i = 0; i < n; i++) {
        const dist = Math.abs(xPos(i, n) - svgX);
        if (dist < minDist) {
          minDist = dist;
          closestIdx = i;
        }
      }
      setHoverIdx(closestIdx);
    },
    [n]
  );

  const handleMouseLeave = useCallback(() => setHoverIdx(null), []);

  // Tooltip box size
  const TW = 148, TH = prevArr.length > 0 ? 76 : 54, TR = 7;

  return (
    <div>
      {/* Chart header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "18px" }}>
        <div>
          <div style={{ fontSize: "12px", color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.8px", fontWeight: "600", marginBottom: "4px" }}>
            {title}
          </div>
          <div style={{ fontSize: "30px", fontWeight: "800", color: "#111827", letterSpacing: "-1px", lineHeight: 1 }}>
            {totalValue}
          </div>
        </div>
        {change !== null && change !== undefined ? (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "12px",
              fontWeight: "700",
              color: isUp ? "#059669" : "#dc2626",
              background: isUp ? "#d1fae5" : "#fee2e2",
              padding: "5px 12px",
              borderRadius: "20px",
            }}
          >
            {isUp ? "↑" : "↓"} {Math.abs(change).toFixed(1)}% vs prev period
          </div>
        ) : null}
      </div>

      {/* Dark SVG Chart */}
      <div
        style={{
          background: "#0f1117",
          borderRadius: "12px",
          padding: "8px 4px 4px",
          overflow: "hidden",
          position: "relative",
          userSelect: "none",
        }}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          style={{ display: "block", cursor: "crosshair" }}
          preserveAspectRatio="xMidYMid meet"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <defs>
            {/* Stroke gradient: color → color2 */}
            <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={color} />
              <stop offset="100%" stopColor={color2} />
            </linearGradient>
            {/* Area fill gradient */}
            <linearGradient id={areaGradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.25" />
              <stop offset="100%" stopColor={color} stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {/* Background */}
          <rect x="0" y="0" width={W} height={H} fill="#0f1117" />

          {/* Y-axis grid lines */}
          {yTicks.map((tick, i) => {
            const y = yPos(tick);
            return (
              <g key={i}>
                <line
                  x1={ML} y1={y} x2={W - MR} y2={y}
                  stroke="#1f2937"
                  strokeWidth={i === 0 ? 1.5 : 1}
                  strokeDasharray={i === 0 ? "none" : "4,4"}
                />
                <text x={ML - 8} y={y + 4} textAnchor="end" fontSize="9.5" fill="#4b5563" fontFamily="monospace">
                  {formatY(tick)}
                </text>
              </g>
            );
          })}

          {/* Area fill (current period) */}
          <path d={buildArea(data)} fill={`url(#${areaGradId})`} />

          {/* Previous period line */}
          {prevArr.length > 0 && (
            <path
              d={buildPath(prevArr)}
              fill="none"
              stroke="#374151"
              strokeWidth="2"
              strokeDasharray="6,4"
              strokeLinecap="round"
              opacity="0.85"
            />
          )}

          {/* Current period line with gradient stroke */}
          <path
            d={buildPath(data)}
            fill="none"
            stroke={`url(#${gradId})`}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* X-axis labels */}
          {xLabels.map((idx) => {
            if (!data[idx]) return null;
            return (
              <text key={idx} x={xPos(idx, n)} y={H - 8} textAnchor="middle" fontSize="9.5" fill="#4b5563" fontFamily="monospace">
                {fmtShortDate(data[idx].date)}
              </text>
            );
          })}

          {/* ── Hover elements ── */}
          {hoverIdx !== null && data[hoverIdx] && (
            <g>
              {/* Vertical crosshair */}
              <line
                x1={tooltipX} y1={MT}
                x2={tooltipX} y2={MT + chartH}
                stroke="#ffffff"
                strokeWidth="1"
                strokeOpacity="0.18"
              />

              {/* Dot on current line */}
              <circle
                cx={tooltipX}
                cy={yPos(data[hoverIdx].value)}
                r="5"
                fill={color}
                stroke="#0f1117"
                strokeWidth="2.5"
              />

              {/* Dot on prev line */}
              {prevArr[hoverIdx] && (
                <circle
                  cx={xPos(hoverIdx, prevArr.length)}
                  cy={yPos(prevArr[hoverIdx].value)}
                  r="4"
                  fill="#6b7280"
                  stroke="#0f1117"
                  strokeWidth="2"
                />
              )}

              {/* Tooltip card */}
              {(() => {
                const tx = tooltipLeft ? tooltipX - TW - 12 : tooltipX + 12;
                const ty = Math.min(Math.max(tooltipY - TH / 2, MT), MT + chartH - TH);
                return (
                  <g>
                    <rect
                      x={tx} y={ty}
                      width={TW} height={TH}
                      rx={TR} ry={TR}
                      fill="#1f2937"
                      stroke="#374151"
                      strokeWidth="1"
                    />
                    {/* Date */}
                    <text x={tx + 10} y={ty + 18} fontSize="10" fill="#9ca3af" fontFamily="monospace" fontWeight="600">
                      {fmtShortDate(data[hoverIdx].date)}
                    </text>
                    {/* Current value */}
                    <circle cx={tx + 10} cy={ty + 32} r="3.5" fill={color} />
                    <text x={tx + 18} y={ty + 36} fontSize="11" fill="#f9fafb" fontFamily="monospace">
                      {formatY(data[hoverIdx].value)}
                    </text>
                    <text x={tx + TW - 10} y={ty + 36} textAnchor="end" fontSize="9" fill="#6b7280" fontFamily="monospace">
                      {periodLabel.slice(0, 16)}
                    </text>
                    {/* Previous value */}
                    {prevArr[hoverIdx] && (
                      <>
                        <line x1={tx + 8} y1={ty + 44} x2={tx + 18} y2={ty + 44} stroke="#6b7280" strokeWidth="1.5" strokeDasharray="3,2" />
                        <text x={tx + 22} y={ty + 49} fontSize="11" fill="#9ca3af" fontFamily="monospace">
                          {formatY(prevArr[hoverIdx].value)}
                        </text>
                        <text x={tx + TW - 10} y={ty + 49} textAnchor="end" fontSize="9" fill="#4b5563" fontFamily="monospace">
                          prev period
                        </text>
                      </>
                    )}
                  </g>
                );
              })()}
            </g>
          )}
        </svg>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: "20px", marginTop: "12px", fontSize: "12px", color: "#6b7280" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "7px" }}>
          <svg width="24" height="4" style={{ verticalAlign: "middle" }}>
            <defs>
              <linearGradient id={`leg-${gradId}`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={color} />
                <stop offset="100%" stopColor={color2} />
              </linearGradient>
            </defs>
            <line x1="0" y1="2" x2="24" y2="2" stroke={`url(#leg-${gradId})`} strokeWidth="2.5" />
          </svg>
          {periodLabel}
        </span>
        {prevArr.length > 0 && (
          <span style={{ display: "flex", alignItems: "center", gap: "7px" }}>
            <svg width="24" height="4" style={{ verticalAlign: "middle" }}>
              <line x1="0" y1="2" x2="24" y2="2" stroke="#6b7280" strokeWidth="2" strokeDasharray="5,3" />
            </svg>
            {prevPeriodLabel}
          </span>
        )}
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
  const palette = ["#3b82f6", "#2A7A4F", "#8b5cf6", "#f59e0b", "#ef4444", "#06b6d4", "#10b981", "#f97316", "#a855f7", "#e11d48"];

  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "28px 1fr 130px 48px",
          gap: "8px",
          paddingBottom: "10px",
          borderBottom: "1px solid #f3f4f6",
          marginBottom: "12px",
        }}
      >
        {["#", "Product", "Picked", "Share"].map((h) => (
          <div key={h} style={{ fontSize: "10px", color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.8px", fontWeight: "600" }}>{h}</div>
        ))}
      </div>
      {data.map((p, i) => {
        const pct = (p.count / maxCount) * 100;
        const sharePct = total > 0 ? ((p.count / total) * 100).toFixed(0) : 0;
        const shortId = p.productId.includes("/") ? p.productId.split("/").pop() : p.productId;
        const color = palette[i % palette.length];
        return (
          <div key={p.productId} style={{ display: "grid", gridTemplateColumns: "28px 1fr 130px 48px", gap: "8px", alignItems: "center", marginBottom: "10px" }}>
            <div style={{ fontSize: "11px", fontWeight: "700", color: "#d1d5db", textAlign: "right" }}>{i + 1}</div>
            <div
              style={{ fontSize: "11px", color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "monospace" }}
              title={p.productId}
            >
              #{shortId}
            </div>
            <div style={{ background: "#f3f4f6", borderRadius: "4px", height: "22px", overflow: "hidden", position: "relative" }}>
              <div
                style={{
                  width: `${pct}%`,
                  background: `linear-gradient(90deg, ${color}bb, ${color})`,
                  height: "100%",
                  borderRadius: "4px",
                  minWidth: "4px",
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: "7px",
                  boxSizing: "border-box",
                  transition: "width 0.5s ease",
                }}
              >
                {pct > 22 && (
                  <span style={{ color: "#fff", fontSize: "9px", fontWeight: "700" }}>{p.count}×</span>
                )}
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
  const hues = [142, 220, 262, 38, 0, 188, 160, 27];

  return (
    <div>
      {data.map((b, i) => {
        const revPct = (b.revenue / maxRev) * 100;
        const shareOrders = totalOrders > 0 ? ((b.orders / totalOrders) * 100).toFixed(0) : 0;
        const shareRev = totalRev > 0 ? ((b.revenue / totalRev) * 100).toFixed(0) : 0;
        const hue = hues[i % hues.length];
        return (
          <div key={b.boxId} style={{ marginBottom: "18px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "7px" }}>
              <div style={{ fontSize: "13px", fontWeight: "700", color: "#111827" }}>{b.boxTitle}</div>
              <div style={{ display: "flex", gap: "10px", fontSize: "11px", color: "#6b7280", fontFamily: "monospace" }}>
                <span style={{ color: "#2A7A4F", fontWeight: "700" }}>{shareRev}% rev</span>
                <span>{b.orders} orders</span>
              </div>
            </div>
            <div style={{ background: "#f3f4f6", borderRadius: "6px", height: "10px", overflow: "hidden", marginBottom: "5px" }}>
              <div
                style={{
                  width: `${revPct}%`,
                  background: `linear-gradient(90deg, hsl(${hue},55%,38%), hsl(${hue},50%,52%))`,
                  height: "100%",
                  borderRadius: "6px",
                  minWidth: "4px",
                  transition: "width 0.6s ease",
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

// ─── Daily Breakdown Table ────────────────────────────────────────────────────
function DailyTable({ data }) {
  const [hoverRow, setHoverRow] = useState(null);
  const reversed = [...(data || [])].reverse();
  const maxRev = Math.max(...(data || []).map((x) => x.revenue), 1);

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
        <thead>
          <tr style={{ background: "#f9fafb" }}>
            {["Date", "Orders", "Revenue", "Trend"].map((h) => (
              <th
                key={h}
                style={{
                  textAlign: "left",
                  padding: "10px 16px",
                  borderBottom: "1.5px solid #e5e7eb",
                  color: "#6b7280",
                  fontSize: "10px",
                  textTransform: "uppercase",
                  letterSpacing: "0.8px",
                  fontWeight: "600",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {reversed.map((d, rowIdx) => {
            const isEmpty = d.orders === 0 && d.revenue === 0;
            const barW = isEmpty ? 0 : Math.max(3, (d.revenue / maxRev) * 100);
            const isHovered = hoverRow === rowIdx;
            return (
              <tr
                key={d.date}
                onMouseEnter={() => setHoverRow(rowIdx)}
                onMouseLeave={() => setHoverRow(null)}
                style={{
                  opacity: isEmpty ? 0.45 : 1,
                  background: isHovered ? "#f0fdf4" : "transparent",
                  transition: "background 0.12s",
                }}
              >
                <td style={{ padding: "10px 16px", borderBottom: "1px solid #f3f4f6", fontFamily: "monospace", color: "#374151", fontWeight: "600" }}>
                  {fmtShortDate(d.date)}
                </td>
                <td style={{ padding: "10px 16px", borderBottom: "1px solid #f3f4f6", color: isEmpty ? "#d1d5db" : "#111827", fontFamily: "monospace", fontWeight: isEmpty ? "400" : "600" }}>
                  {d.orders === 0 ? "—" : d.orders}
                </td>
                <td style={{ padding: "10px 16px", borderBottom: "1px solid #f3f4f6", color: isEmpty ? "#d1d5db" : "#2A7A4F", fontWeight: isEmpty ? "400" : "700", fontFamily: "monospace" }}>
                  {isEmpty ? "—" : `₹${d.revenue.toLocaleString("en-IN")}`}
                </td>
                <td style={{ padding: "10px 16px", borderBottom: "1px solid #f3f4f6", minWidth: "120px" }}>
                  <div style={{ position: "relative", height: "8px", background: "#f3f4f6", borderRadius: "4px", overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${barW}%`,
                        height: "100%",
                        background: isEmpty ? "transparent" : "linear-gradient(90deg, #3b82f6, #2A7A4F)",
                        borderRadius: "4px",
                        transition: "width 0.3s ease",
                      }}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
        gap: "12px",
        padding: "12px 16px",
        background: "linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%)",
        border: "1px solid #dbeafe",
        borderRadius: "10px",
        marginBottom: "20px",
        fontSize: "12px",
        color: "#374151",
      }}
    >
      <span style={{ fontSize: "18px" }}>📅</span>
      <div style={{ lineHeight: 1.6 }}>
        <span style={{ fontWeight: "700", color: "#1d4ed8" }}>Current: </span>
        <span style={{ fontFamily: "monospace", color: "#374151" }}>{fmtDate(period.from)} → {fmtDate(period.to)}</span>
        <span style={{ margin: "0 14px", color: "#d1d5db" }}>vs</span>
        <span style={{ fontWeight: "700", color: "#6b7280" }}>Previous: </span>
        <span style={{ fontFamily: "monospace", color: "#6b7280" }}>{fmtDate(prevPeriod.from)} → {fmtDate(prevPeriod.to)}</span>
      </div>
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

  const avgChange =
    prevTotalOrders > 0 && prevTotalRevenue > 0
      ? ((avgBundleValue - prevTotalRevenue / prevTotalOrders) / (prevTotalRevenue / prevTotalOrders)) * 100
      : null;

  return (
    <s-page heading="Analytics">
      {/* ── Period Selector + Banner ── */}
      <s-section>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "12px",
            marginBottom: "20px",
          }}
        >
          <div>
            <div style={{ fontSize: "14px", color: "#111827", fontWeight: "700" }}>Performance Overview</div>
            <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "2px" }}>
              Bundle analytics · period-over-period comparison
            </div>
          </div>
          <PeriodSelector active={period} />
        </div>

        <ComparisonBanner period={periodRange} prevPeriod={prevPeriod} />

        {/* ── KPI Cards ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "14px" }}>
          <KpiCard
            label="Bundle Revenue"
            value={`₹${totalRevenue.toLocaleString("en-IN")}`}
            subLabel={prevTotalRevenue ? `prev ₹${(prevTotalRevenue || 0).toLocaleString("en-IN")}` : null}
            change={revenueChange}
            accentColor="#3b82f6"
            icon="💰"
          />
          <KpiCard
            label="Bundles Sold"
            value={totalOrders}
            subLabel={prevTotalOrders ? `prev ${prevTotalOrders}` : null}
            change={ordersChange}
            accentColor="#2A7A4F"
            icon="📦"
          />
          <KpiCard
            label="Avg Bundle Value"
            value={`₹${avgBundleValue.toLocaleString("en-IN")}`}
            subLabel={null}
            change={avgChange}
            accentColor="#8b5cf6"
            icon="📊"
          />
          <KpiCard
            label="Active Box Types"
            value={activeBoxCount}
            subLabel={null}
            change={null}
            accentColor="#f59e0b"
            icon="🗂️"
            subtitle="Total live combo boxes"
          />
        </div>
      </s-section>

      {/* ── Revenue Chart ── */}
      <s-section heading="Revenue Over Time">
        <LineChart
          title="Total Bundle Revenue"
          totalValue={`₹${totalRevenue.toLocaleString("en-IN")}`}
          change={revenueChange}
          data={revData}
          prevData={prevRevData}
          periodLabel={periodLabel}
          prevPeriodLabel={prevPeriodLabel}
          formatY={fmtCurrency}
          color="#60a5fa"
          color2="#818cf8"
        />
      </s-section>

      {/* ── Orders Chart ── */}
      <s-section heading="Bundles Sold">
        <LineChart
          title="Bundles Sold"
          totalValue={String(totalOrders)}
          change={ordersChange}
          data={ordData}
          prevData={prevOrdData}
          periodLabel={periodLabel}
          prevPeriodLabel={prevPeriodLabel}
          formatY={(v) => String(Math.round(v))}
          color="#34d399"
          color2="#059669"
        />
      </s-section>

      {/* ── Two Column: Products + Box Performance ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        <s-section heading="Top Products Picked">
          <TopProductsChart data={topProducts} />
        </s-section>
        <s-section heading="Box Type Performance">
          <BoxPerformanceChart data={boxPerformance} />
        </s-section>
      </div>

      {/* ── Daily Breakdown ── */}
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
