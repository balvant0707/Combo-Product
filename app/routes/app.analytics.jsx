import { useCallback, useEffect, useRef, useState } from "react";
import { useLoaderData, useLocation, useNavigate, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { AdminIcon } from "../components/admin-icons";
import { getAnalytics } from "../models/orders.server";
import { getShopCurrencyCode } from "../models/shop.server";
import { withEmbeddedAppParams } from "../utils/embedded-app";
import { formatCurrencyAmount } from "../utils/currency";
import {
  BlockStack,
  Button,
  Card,
  InlineGrid,
  InlineStack,
  Modal,
  Page,
  Text,
} from "@shopify/polaris";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const period = url.searchParams.get("period") || "30";
  const customFrom = url.searchParams.get("from") || null;
  const customTo = url.searchParams.get("to") || null;
  const comboTypeParam = String(url.searchParams.get("comboType") || "all").toLowerCase();
  const comboType = comboTypeParam === "simple" || comboTypeParam === "specific" ? comboTypeParam : "all";

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

  const [analytics, currencyCode] = await Promise.all([
    getAnalytics(session.shop, fromDate, toDate, { comboTypeFilter: comboType }),
    getShopCurrencyCode(session.shop),
  ]);
  return {
    analytics,
    currencyCode,
    shopDomain: session.shop,
    period: customFrom ? "custom" : period,
    fromDate,
    toDate,
    comboType,
  };
};

// ─── Helpers ────────────────────────────────────────────────────────────────
function fmtCurrency(val, currencyCode) {
  const numericValue = Number(val) || 0;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode || "USD",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(numericValue);
  } catch {
    return formatCurrencyAmount(numericValue, currencyCode || "USD", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }
}

function fmtShortDate(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function fmtDate(isoStr) {
  return new Date(isoStr).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

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

function formatOrderPrefixLabel(orderName, orderNumber, orderId) {
  const name = String(orderName || "").trim();
  if (/^#\d+/.test(name)) return name;

  const parsedOrderNumber = Number.parseInt(String(orderNumber), 10);
  if (Number.isFinite(parsedOrderNumber) && parsedOrderNumber > 0) {
    return `#${parsedOrderNumber}`;
  }

  return "-";
}

function buildAdminOrderLink(shopDomain, orderId) {
  const shop = String(shopDomain || "").trim();
  const rawOrderId = String(orderId || "").trim();
  if (!shop || !rawOrderId) return null;
  const storeHandle = shop.replace(/\.myshopify\.com$/i, "");
  if (!storeHandle) return null;
  return `https://admin.shopify.com/store/${storeHandle}/orders/${rawOrderId}`;
}

function buildAdminProductLink(shopDomain, itemLabel) {
  const shop = String(shopDomain || "").trim();
  const label = String(itemLabel || "").trim();
  if (!shop || !label) return null;

  const gidMatch = label.match(/gid:\/\/shopify\/Product\/(\d+)/i);
  if (gidMatch?.[1]) {
    return `https://${shop}/admin/products/${gidMatch[1]}`;
  }

  if (/^\d{8,}$/.test(label)) {
    return `https://${shop}/admin/products/${label}`;
  }

  const normalizedQuery = label
    .replace(/\s*\([^)]*\)\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return `https://${shop}/admin/products?query=${encodeURIComponent(normalizedQuery || label)}`;
}

function EyeIcon({ size = 16, color = "#000000", fill = "#ffffff" }) {
  return (
    <svg
      width={`${size}px`}
      height={`${size}px`}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M1.5 12s3.75-6.75 10.5-6.75S22.5 12 22.5 12s-3.75 6.75-10.5 6.75S1.5 12 1.5 12Z"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3.25" fill={fill} stroke={color} strokeWidth="2" />
    </svg>
  );
}

// ─── Date Range Picker ────────────────────────────────────────────────────────
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function toISO(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function CalendarMonth({ year, month, fromDate, toDate, hoverDate, pickingEnd, onDayClick, onMouseEnter, onMouseLeave }) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const todayStr = new Date().toISOString().slice(0, 10);

  const cells = [];
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const effectiveTo = pickingEnd && hoverDate
    ? (hoverDate >= fromDate ? hoverDate : fromDate)
    : toDate;
  const effectiveFrom = pickingEnd && hoverDate
    ? (hoverDate < fromDate ? hoverDate : fromDate)
    : fromDate;

  return (
    <div style={{ minWidth: "220px" }}>
      <div style={{ textAlign: "center", fontWeight: "700", fontSize: "13px", marginBottom: "10px", color: "#111827" }}>
        {MONTH_NAMES[month]} {year}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "1px", marginBottom: "4px" }}>
        {DAY_LABELS.map((d) => (
          <div key={d} style={{ textAlign: "center", fontSize: "11px", color: "#000000", fontWeight: "600", padding: "3px 0" }}>
            {d}
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "1px" }}>
        {cells.map((day, idx) => {
          if (!day) return <div key={`e${idx}`} style={{ height: "34px" }} />;
          const ds = toISO(year, month, day);
          const isStart = ds === fromDate;
          const isEnd = ds === effectiveTo;
          const inRange = effectiveFrom && effectiveTo && ds > effectiveFrom && ds < effectiveTo;
          const isToday = ds === todayStr;

          let bg = "transparent";
          let color = "#374151";
          if (isStart || isEnd) { bg = "#111827"; color = "#ffffff"; }
          else if (inRange) { bg = "#f3f4f6"; color = "#374151"; }
          else if (ds === hoverDate && pickingEnd) { bg = "#e5e7eb"; }

          return (
            <div
              key={ds}
              onClick={() => onDayClick(ds)}
              onMouseEnter={() => onMouseEnter(ds)}
              onMouseLeave={onMouseLeave}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "34px",
                background: inRange ? "#f3f4f6" : "transparent",
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  width: "30px",
                  height: "30px",
                  borderRadius: "50%",
                  background: bg,
                  color,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "12px",
                  fontWeight: isStart || isEnd ? "700" : isToday ? "700" : "400",
                  outline: isToday && !isStart && !isEnd ? "1.5px solid #9ca3af" : "none",
                  outlineOffset: "1px",
                }}
              >
                {day}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DateRangePicker({ period, fromDate: initFrom, toDate: initTo }) {
  const location = useLocation();
  const navigate = useNavigate();
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState({ top: 0, left: 0, width: 580 });

  const todayStr = new Date().toISOString().slice(0, 10);

  const presets = [
    { key: "7", label: "Last 7 days" },
    { key: "30", label: "Last 30 Days" },
    { key: "90", label: "Last 90 days" },
    { key: "custom", label: "Custom range" },
  ];

  const [selectedPreset, setSelectedPreset] = useState(period === "custom" ? "custom" : (period || "30"));
  const [fromDate, setFromDate] = useState(initFrom || todayStr);
  const [toDate, setToDate] = useState(initTo || todayStr);
  const [pickingEnd, setPickingEnd] = useState(false);
  const [hoverDate, setHoverDate] = useState(null);

  const initDate = fromDate ? new Date(fromDate + "T00:00:00") : new Date();
  const [calYear, setCalYear] = useState(initDate.getFullYear());
  const [calMonth, setCalMonth] = useState(initDate.getMonth());

  const rightMonth = calMonth === 11 ? 0 : calMonth + 1;
  const rightYear = calMonth === 11 ? calYear + 1 : calYear;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e) {
      const inTrigger = triggerRef.current && triggerRef.current.contains(e.target);
      const inPopover = popoverRef.current && popoverRef.current.contains(e.target);
      if (!inTrigger && !inPopover) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function updatePopoverPosition() {
      const triggerEl = triggerRef.current;
      if (!triggerEl) return;
      const rect = triggerEl.getBoundingClientRect();
      const viewportPadding = 16;
      const idealWidth = 580;
      const maxWidth = Math.max(280, window.innerWidth - viewportPadding * 2);
      const width = Math.min(idealWidth, maxWidth);
      const left = Math.max(
        viewportPadding,
        Math.min(rect.right - width, window.innerWidth - viewportPadding - width),
      );
      setPopoverStyle({
        top: rect.bottom + 8,
        left,
        width,
      });
    }

    updatePopoverPosition();
    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);
    return () => {
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
    };
  }, [open]);

  const activeLabel = (() => {
    if (period === "custom") {
      if (initFrom && initTo) return `${fmtShortDate(initFrom)} - ${fmtShortDate(initTo)}`;
    }
    return presets.find((p) => p.key === period)?.label || "Last 30 Days";
  })();

  function handlePresetChange(key) {
    setSelectedPreset(key);
    setPickingEnd(false);
    if (key !== "custom") {
      const days = parseInt(key);
      const to = todayStr;
      const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      setFromDate(from);
      setToDate(to);
      const d = new Date(from + "T00:00:00");
      setCalYear(d.getFullYear());
      setCalMonth(d.getMonth());
    }
  }

  function handleDayClick(ds) {
    if (!pickingEnd) {
      setFromDate(ds);
      setToDate(ds);
      setPickingEnd(true);
      setSelectedPreset("custom");
    } else {
      if (ds < fromDate) {
        setToDate(fromDate);
        setFromDate(ds);
      } else {
        setToDate(ds);
      }
      setPickingEnd(false);
      setHoverDate(null);
    }
  }

  function handleApply() {
    setOpen(false);
    setPickingEnd(false);
    const currentParams = new URLSearchParams(location.search);
    const comboType = currentParams.get("comboType");
    const nextParams = new URLSearchParams();
    if (comboType && comboType !== "all") nextParams.set("comboType", comboType);
    if (selectedPreset !== "custom") {
      nextParams.set("period", selectedPreset);
      const nextQuery = nextParams.toString();
      navigate(withEmbeddedAppParams(`${location.pathname}${nextQuery ? `?${nextQuery}` : ""}`, location.search));
    } else if (fromDate && toDate) {
      nextParams.set("from", fromDate);
      nextParams.set("to", toDate);
      const nextQuery = nextParams.toString();
      navigate(withEmbeddedAppParams(`${location.pathname}${nextQuery ? `?${nextQuery}` : ""}`, location.search));
    }
  }

  function handleCancel() {
    setOpen(false);
    setPickingEnd(false);
    setHoverDate(null);
    // Reset to current loaded values
    setSelectedPreset(period === "custom" ? "custom" : (period || "30"));
    setFromDate(initFrom || todayStr);
    setToDate(initTo || todayStr);
  }

  function prevMonth() {
    if (calMonth === 0) { setCalMonth(11); setCalYear((y) => y - 1); }
    else setCalMonth((m) => m - 1);
  }
  function nextMonth() {
    if (calMonth === 11) { setCalMonth(0); setCalYear((y) => y + 1); }
    else setCalMonth((m) => m + 1);
  }

  const navBtnStyle = {
    background: "none",
    border: "1px solid #e5e7eb",
    borderRadius: "5px",
    cursor: "pointer",
    padding: "4px 8px",
    fontSize: "14px",
    color: "#374151",
    lineHeight: 1,
  };

  function handleToggle() {
    setOpen((o) => !o);
  }

  return (
    <div style={{ display: "inline-block", position: "relative" }}>
      <style>{`
        .an-date-popover {
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 5px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.13);
          z-index: 99999;
          padding: 16px;
        }
        .an-cal-pair {
          display: flex;
          align-items: flex-start;
          gap: 0;
        }
        @media (max-width: 640px) {
          .an-date-popover {
            min-width: 0 !important;
            max-width: none !important;
            width: auto !important;
          }
          .an-cal-pair {
            flex-direction: column;
            gap: 16px;
          }
        }
      `}</style>
      {/* Trigger */}
      <button
        ref={triggerRef}
        onClick={handleToggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "7px 14px",
          borderRadius: "5px",
          border: "1.5px solid #e5e7eb",
          background: "#ffffff",
          fontSize: "13px",
          fontWeight: "600",
          color: "#374151",
          cursor: "pointer",
          boxShadow: "0 1px 3px rgba(0,0,0,0.07)",
          whiteSpace: "nowrap",
        }}
      >
        {activeLabel}
        <AdminIcon type="chevron-down" size="small" style={{ color: "#6b7280" }} />
      </button>

      {/* Popover — fixed so it escapes any overflow:hidden parent */}
      {open && (
        <div
          ref={popoverRef}
          className="an-date-popover"
          style={{
            position: "fixed",
            top: `${popoverStyle.top}px`,
            left: `25%`,
            width: `${popoverStyle.width}px`,
            maxWidth: "calc(100vw - 32px)",
          }}
        >
          {/* Preset select */}
          <select
            value={selectedPreset}
            onChange={(e) => handlePresetChange(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: "8px",
              border: "1.5px solid #e5e7eb",
              fontSize: "13px",
              fontWeight: "600",
              color: "#374151",
              background: "#ffffff",
              marginBottom: "12px",
              cursor: "pointer",
            }}
          >
            {presets.map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </select>

          {/* Date inputs */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => { setFromDate(e.target.value); setSelectedPreset("custom"); }}
              style={{ flex: 1, padding: "8px 10px", borderRadius: "5px", border: "1.5px solid #e5e7eb", fontSize: "13px", color: "#374151" }}
            />
            <AdminIcon type="arrow-right" size="small" style={{ color: "#9ca3af", flexShrink: 0 }} />
            <input
              type="date"
              value={toDate}
              onChange={(e) => { setToDate(e.target.value); setSelectedPreset("custom"); }}
              style={{ flex: 1, padding: "8px 10px", borderRadius: "5px", border: "1.5px solid #e5e7eb", fontSize: "13px", color: "#374151" }}
            />
          </div>

          {/* Calendars */}
          <div className="an-cal-pair">
            {/* Left calendar with left nav arrow */}
            <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: "8px" }}>
                <button onClick={prevMonth} style={navBtnStyle}><AdminIcon type="chevron-left" size="small" /></button>
                <div style={{ flex: 1 }} />
              </div>
              <CalendarMonth
                year={calYear}
                month={calMonth}
                fromDate={fromDate}
                toDate={toDate}
                hoverDate={hoverDate}
                pickingEnd={pickingEnd}
                onDayClick={handleDayClick}
                onMouseEnter={(ds) => { if (pickingEnd) setHoverDate(ds); }}
                onMouseLeave={() => { if (pickingEnd) setHoverDate(null); }}
              />
            </div>

            <div style={{ width: "1px", background: "#f3f4f6", margin: "0 16px", alignSelf: "stretch" }} />

            {/* Right calendar with right nav arrow */}
            <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: "8px" }}>
                <div style={{ flex: 1 }} />
                <button onClick={nextMonth} style={navBtnStyle}><AdminIcon type="chevron-right" size="small" /></button>
              </div>
              <CalendarMonth
                year={rightYear}
                month={rightMonth}
                fromDate={fromDate}
                toDate={toDate}
                hoverDate={hoverDate}
                pickingEnd={pickingEnd}
                onDayClick={handleDayClick}
                onMouseEnter={(ds) => { if (pickingEnd) setHoverDate(ds); }}
                onMouseLeave={() => { if (pickingEnd) setHoverDate(null); }}
              />
            </div>
          </div>

          {/* Cancel / Apply */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px", borderTop: "1px solid #f3f4f6", paddingTop: "16px" }}>
            <button
              onClick={handleCancel}
              style={{ padding: "8px 20px", borderRadius: "5px", border: "1.5px solid #e5e7eb", background: "#ffffff", fontSize: "13px", fontWeight: "600", color: "#374151", cursor: "pointer" }}
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              style={{ padding: "8px 20px", borderRadius: "5px", border: "none", background: "#111827", fontSize: "13px", fontWeight: "600", color: "#ffffff", cursor: "pointer" }}
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ComboTypeFilter({ value = "all" }) {
  const location = useLocation();
  const navigate = useNavigate();

  function handleChange(nextValue) {
    const normalized = nextValue === "simple" || nextValue === "specific" ? nextValue : "all";
    // Build params from current search to preserve date / period params
    const params = new URLSearchParams(location.search);
    if (normalized === "all") params.delete("comboType");
    else params.set("comboType", normalized);
    // Remove embedded-only params — withEmbeddedAppParams will re-add them
    for (const key of ["embedded", "host", "shop", "locale"]) {
      if (params.has(key)) params.delete(key);
    }
    const nextQuery = params.toString();
    navigate(
      withEmbeddedAppParams(
        `${location.pathname}${nextQuery ? `?${nextQuery}` : ""}`,
        location.search,
      ),
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <label
        htmlFor="combo-type-filter"
        style={{ fontSize: "12px", color: "#4b5563", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.5px" }}
      >
        Type Filter
      </label>
      <select
        id="combo-type-filter"
        aria-label="Filter analytics by type"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        style={{
          minWidth: "190px",
          padding: "7px 12px",
          borderRadius: "5px",
          border: "1.5px solid #e5e7eb",
          fontSize: "13px",
          fontWeight: "600",
          color: "#374151",
          cursor: "pointer",
        }}
      >
        <option value="all">All Box</option>
        <option value="simple">Simple</option>
        <option value="specific">Specific</option>
      </select>
    </div>
  );
}

// ─── KPI Card ────────────────────────────────────────────────────────────────
function KpiCard({ label, value, subLabel, change, accentColor, iconType, subtitle }) {
  const isUp = change === null ? null : change >= 0;
  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #e5e7eb",
        borderRadius: "5px",
        padding: "20px 22px 18px",
        position: "relative",
        overflow: "hidden",
        boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
        transition: "box-shadow 0.2s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "36px",
            height: "36px",
            borderRadius: "5px",
            background: `${accentColor}15`,
            fontSize: "18px",
            flexShrink: 0,
          }}
        >
          <AdminIcon type={iconType} size="base" style={{ color: accentColor }} />
        </div>
        <div style={{ fontSize: "11px", color: "#000000", textTransform: "uppercase", letterSpacing: "0.8px", fontWeight: "600" }}>
          {label}
        </div>
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
              borderRadius: "5px",
            }}
          >
            <AdminIcon type={isUp ? "arrow-up" : "arrow-down"} size="small" /> {Math.abs(change).toFixed(1)}%
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

// ─── White Interactive Line Chart ─────────────────────────────────────────────
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

  const showYAxisLabels = false;
  const W = 760, H = 200, ML = showYAxisLabels ? 52 : 16, MR = 20, MB = 36, MT = 18;
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

  const yTicks = [0, yMax * 0.25, yMax * 0.5, yMax * 0.75, yMax].map(Math.round);

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

  let tooltipX = 0, tooltipY = 0, tooltipLeft = true;
  if (hoverIdx !== null && data[hoverIdx]) {
    tooltipX = xPos(hoverIdx, n);
    tooltipY = yPos(data[hoverIdx].value);
    tooltipLeft = tooltipX > W * 0.6;
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
        if (dist < minDist) { minDist = dist; closestIdx = i; }
      }
      setHoverIdx(closestIdx);
    },
    [n]
  );

  const handleMouseLeave = useCallback(() => setHoverIdx(null), []);

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
              borderRadius: "5px",
            }}
          >
            <AdminIcon type={isUp ? "arrow-up" : "arrow-down"} size="small" /> {Math.abs(change).toFixed(1)}% vs prev period
          </div>
        ) : null}
      </div>

      {/* White SVG Chart */}
      <div
        style={{
          background: "#ffffff",
          border: "1px solid #e5e7eb",
          borderRadius: "5px",
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
            <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={color} />
              <stop offset="100%" stopColor={color2} />
            </linearGradient>
            <linearGradient id={areaGradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.18" />
              <stop offset="100%" stopColor={color} stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Background */}
          <rect x="0" y="0" width={W} height={H} fill="#ffffff" />

          {/* Y-axis grid lines */}
          {yTicks.map((tick, i) => {
            const y = yPos(tick);
            return (
              <g key={i}>
                <line
                  x1={ML} y1={y} x2={W - MR} y2={y}
                  stroke="#e5e7eb"
                  strokeWidth={i === 0 ? 1.5 : 1}
                  strokeDasharray={i === 0 ? "none" : "4,4"}
                />
                {showYAxisLabels ? (
                  <text x={ML - 8} y={y + 4} textAnchor="end" fontSize="9.5" fill="#9ca3af">
                    {formatY(tick)}
                  </text>
                ) : null}
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
              stroke="#d1d5db"
              strokeWidth="2"
              strokeDasharray="6,4"
              strokeLinecap="round"
              opacity="0.9"
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
              <text key={idx} x={xPos(idx, n)} y={H - 8} textAnchor="middle" fontSize="9.5" fill="#9ca3af" >
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
                stroke="#374151"
                strokeWidth="1"
                strokeOpacity="0.2"
              />

              {/* Dot on current line */}
              <circle
                cx={tooltipX}
                cy={yPos(data[hoverIdx].value)}
                r="5"
                fill={color}
                stroke="#ffffff"
                strokeWidth="2.5"
              />

              {/* Dot on prev line */}
              {prevArr[hoverIdx] && (
                <circle
                  cx={xPos(hoverIdx, prevArr.length)}
                  cy={yPos(prevArr[hoverIdx].value)}
                  r="4"
                  fill="#9ca3af"
                  stroke="#ffffff"
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
                    <text x={tx + 10} y={ty + 18} fontSize="10" fill="#ffffff" fontWeight="600">
                      {fmtShortDate(data[hoverIdx].date)}
                    </text>
                    <circle cx={tx + 10} cy={ty + 32} r="3.5" fill={color} />
                    <text x={tx + 18} y={ty + 36} fontSize="11" fill="#f9fafb" >
                      {formatY(data[hoverIdx].value)}
                    </text>
                    <text x={tx + TW - 10} y={ty + 36} textAnchor="end" fontSize="9" fill="#ffffff" >
                      {periodLabel.slice(0, 16)}
                    </text>
                    {prevArr[hoverIdx] && (
                      <>
                        <line x1={tx + 8} y1={ty + 44} x2={tx + 18} y2={ty + 44} stroke="#6b7280" strokeWidth="1.5" strokeDasharray="3,2" />
                        <text x={tx + 22} y={ty + 49} fontSize="11" fill="#ffffff" >
                          {formatY(prevArr[hoverIdx].value)}
                        </text>
                        <text x={tx + TW - 10} y={ty + 49} textAnchor="end" fontSize="9" fill="#ffffff" >
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
      <div style={{ display: "flex", gap: "20px", marginTop: "12px", fontSize: "12px", color: "#000000" }}>
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
              <line x1="0" y1="2" x2="24" y2="2" stroke="#d1d5db" strokeWidth="2" strokeDasharray="5,3" />
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
        <AdminIcon type="chart-line" size="large-100" style={{ marginBottom: "8px", color: "#9ca3af" }} />
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
              style={{ fontSize: "11px", color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              title={p.productId}
            >
              #{shortId}
            </div>
            <div style={{ background: "#f3f4f6", borderRadius: "5px", height: "22px", overflow: "hidden", position: "relative" }}>
              <div
                style={{
                  width: `${pct}%`,
                  background: `linear-gradient(90deg, ${color}bb, ${color})`,
                  height: "100%",
                  borderRadius: "5px",
                  minWidth: "4px",
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: "7px",
                  boxSizing: "border-box",
                  transition: "width 0.5s ease",
                }}
              >
                {pct > 22 && (
                  <span style={{ color: "#fff", fontSize: "9px", fontWeight: "700" }}>{p.count}x</span>
                )}
              </div>
            </div>
            <div style={{ fontSize: "11px", fontWeight: "700", color, textAlign: "right" }}>{sharePct}%</div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Box Performance Chart ────────────────────────────────────────────────────
function BoxPerformanceChart({ data, currencyCode }) {
  if (!data || data.length === 0) {
    return (
      <div style={{ padding: "40px 0", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>
        <AdminIcon type="package" size="large-100" style={{ marginBottom: "8px", color: "#9ca3af" }} />
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
              <div style={{ display: "flex", gap: "10px", fontSize: "11px", color: "#000000" }}>
                <span style={{ color: "#2A7A4F", fontWeight: "700" }}>{shareRev}% rev</span>
                <span>{b.orders} orders</span>
              </div>
            </div>
            <div style={{ background: "#f3f4f6", borderRadius: "5px", height: "10px", overflow: "hidden", marginBottom: "5px" }}>
              <div
                style={{
                  width: `${revPct}%`,
                  background: `linear-gradient(90deg, hsl(${hue},55%,38%), hsl(${hue},50%,52%))`,
                  height: "100%",
                  borderRadius: "5px",
                  minWidth: "4px",
                  transition: "width 0.6s ease",
                }}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "#9ca3af" }}>
              <span>{fmtCurrency(b.revenue, currencyCode)}</span>
              <span>{shareOrders}% of orders</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RecentOrdersTable({ data, currencyCode, onOpenItemsPopup, shopDomain }) {
  if (!data || data.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px 0", color: "#9ca3af", fontSize: "13px" }}>
        <AdminIcon type="order" size="large" style={{ marginBottom: "8px", color: "#9ca3af" }} />
        No bundle orders in this period.
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
        <thead>
          <tr>
            {["Order ID", "Name", "Type", "Products", "Revenue", "Date"].map((h) => (
              <th
                key={h}
                style={{
                  textAlign: "left",
                  padding: "12px 14px",
                  borderBottom: "1px solid #e5e7eb",
                  color: "#6b7280",
                  fontSize: "10px",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  fontWeight: "700",
                  whiteSpace: "nowrap",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((order, index) => {
            const selected = parseOrderSelectedProducts(order.selectedProducts);
            const comboTypeText = String(order.comboTypeLabel || order.comboType || "")
              .replace(/\s*Bundle\b/gi, "")
              .trim() || "—";
            const detailsText = selected.length > 0
              ? selected[0]
              : `${order.itemCount || 0} step${Number(order.itemCount || 0) === 1 ? "" : "s"}`;
            const moreCount = Math.max(0, selected.length - 1);
            return (
              <tr
                key={order.id || `${order.orderId}-${index}`}
                style={{ background: index % 2 === 0 ? "#fff" : "#fafafa" }}
              >
                <td style={{ padding: "12px 14px", borderBottom: "1px solid #f3f4f6" }}>
                  {(() => {
                    const orderUrl = buildAdminOrderLink(shopDomain, order.orderId);
                    const label = formatOrderPrefixLabel(order.orderName, order.orderNumber, order.orderId);
                    if (!orderUrl) return label;
                    return (
                      <a
                        href={orderUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontWeight: "700",
                          color: "#111827",
                          background: "#f3f4f6",
                          padding: "2px 8px",
                          borderRadius: "5px",
                          textDecoration: "none",
                        }}
                      >
                        {label}
                      </a>
                    );
                  })()}
                </td>
                <td style={{ padding: "12px 14px", borderBottom: "1px solid #f3f4f6", color: "#374151", fontWeight: "600" }}>
                  {(() => {
                    const orderUrl = buildAdminOrderLink(shopDomain, order.orderId);
                    if (!orderUrl) return order.boxTitle;
                    return (
                      <a
                        href={orderUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "#111827", fontWeight: 600, textDecoration: "none" }}
                      >
                        {order.boxTitle}
                      </a>
                    );
                  })()}
                </td>
                <td style={{ padding: "12px 14px", borderBottom: "1px solid #f3f4f6" }}>
                  <span
                    style={{
                      display: "inline-block",
                      background: order.comboType === "specific" ? "#eef2ff" : "#ecfdf5",
                      border: `1px solid ${order.comboType === "specific" ? "#c7d2fe" : "#bbf7d0"}`,
                      borderRadius: "5px",
                      padding: "2px 8px",
                      fontSize: "11px",
                      fontWeight: "700",
                      color: order.comboType === "specific" ? "#4338ca" : "#166534",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {comboTypeText}
                  </span>
                </td>
                <td
                  style={{
                    padding: "12px 14px",
                    borderBottom: "1px solid #f3f4f6",
                    color: "#374151",
                    maxWidth: "320px",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={selected.join(", ")}
                >
                  <InlineStack gap="100" blockAlign="center">
                    <span>{detailsText}</span>
                    {moreCount > 0 && (
                      <Button variant="plain" onClick={() => onOpenItemsPopup?.(order)}>
                        +{moreCount} more
                      </Button>
                    )}
                  </InlineStack>
                </td>
                <td style={{ padding: "12px 14px", borderBottom: "1px solid #f3f4f6" }}>
                  <span style={{ fontWeight: "800", color: "#2A7A4F", background: "#f0fdf4", padding: "2px 8px", borderRadius: "5px" }}>
                    {formatCurrencyAmount(Number(order.bundlePrice || 0), currencyCode)}
                  </span>
                </td>
                <td style={{ padding: "12px 14px", borderBottom: "1px solid #f3f4f6", color: "#9ca3af", fontSize: "12px" }}>
                  {new Date(order.orderDate).toLocaleDateString(undefined)}
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
        alignItems: "flex-start",
        gap: "12px",
        padding: "12px 16px",
        background: "linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%)",
        border: "1px solid #dbeafe",
        borderRadius: "5px",
        marginBottom: "20px",
        fontSize: "12px",
        color: "#374151",
        flexWrap: "wrap",
      }}
    >
      <AdminIcon type="calendar" size="base" />
      <div style={{ lineHeight: 1.6 }}>
        <span style={{ fontWeight: "700", color: "#1d4ed8" }}>Current: </span>
        <span style={{ color: "#374151" }}>{fmtDate(period.from)} - {fmtDate(period.to)}</span>
        <span style={{ margin: "0 14px", color: "#d1d5db" }}>vs</span>
        <span style={{ fontWeight: "700", color: "#000000" }}>Previous: </span>
        <span style={{ color: "#000000" }}>{fmtDate(prevPeriod.from)} - {fmtDate(prevPeriod.to)}</span>
      </div>
    </div>
  );
}

// ─── Sync Orders Button ───────────────────────────────────────────────────────
function SyncOrdersButton() {
  const { revalidate } = useRevalidator();
  const [state, setState] = useState("idle"); // idle | loading | success | error
  const [result, setResult] = useState(null);

  async function handleSync() {
    setState("loading");
    setResult(null);
    try {
      const resp = await fetch("/api/admin/sync-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: 90 }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || "Sync failed");
      setResult(data);
      setState("success");
      revalidate();
    } catch (err) {
      setResult({ error: err.message });
      setState("error");
    }
  }

  const isLoading = state === "loading";
  const btnStyle = {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "7px 14px",
    borderRadius: "5px",
    border: "1.5px solid #e5e7eb",
    background: isLoading ? "#f3f4f6" : "#ffffff",
    fontSize: "13px",
    fontWeight: "600",
    color: isLoading ? "#9ca3af" : "#374151",
    cursor: isLoading ? "not-allowed" : "pointer",
    whiteSpace: "nowrap",
    transition: "background 0.15s",
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <button style={btnStyle} onClick={handleSync} disabled={isLoading}>
        {isLoading ? (
          <>
            <span style={{ width: "12px", height: "12px", border: "2px solid #d1d5db", borderTopColor: "#2A7A4F", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
            Syncing…
          </>
        ) : (
          <>
            <AdminIcon type="refresh" size="small" />
            Sync Orders
          </>
        )}
      </button>
      {state === "success" && result && (
        <span style={{ fontSize: "12px", color: "#059669", fontWeight: "600" }}>
          +{result.synced} new order{result.synced !== 1 ? "s" : ""} synced
        </span>
      )}
      {state === "error" && (
        <span style={{ fontSize: "12px", color: "#dc2626", fontWeight: "600" }}>
          {result?.error || "Sync failed"}
        </span>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── Main Analytics Page ──────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const {
    analytics,
    period,
    fromDate,
    toDate,
    comboType,
    currencyCode,
    shopDomain,
  } = useLoaderData();
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
    recentOrders,
    period: periodRange,
    prevPeriod,
  } = analytics;

  const periodLabel = periodRange ? `${fmtDate(periodRange.from)} - ${fmtDate(periodRange.to)}` : "Current";
  const prevPeriodLabel = prevPeriod ? `${fmtDate(prevPeriod.from)} - ${fmtDate(prevPeriod.to)}` : "Previous";

  const analyticsScopeLabel = comboType === "simple"
    ? "Simple"
    : comboType === "specific"
      ? "Specific"
      : "All";
  const analyticsScopePluralLabel = comboType === "simple"
    ? "Simple"
    : comboType === "specific"
      ? "Specific"
      : "All";

  const revData = (dailyTrend || []).map((d) => ({ date: d.date, value: d.revenue }));
  const prevRevData = (prevDailyTrend || []).map((d) => ({ date: d.date, value: d.revenue }));
  const ordData = (dailyTrend || []).map((d) => ({ date: d.date, value: d.orders }));
  const prevOrdData = (prevDailyTrend || []).map((d) => ({ date: d.date, value: d.orders }));

  const avgChange =
    prevTotalOrders > 0 && prevTotalRevenue > 0
      ? ((avgBundleValue - prevTotalRevenue / prevTotalOrders) / (prevTotalRevenue / prevTotalOrders)) * 100
      : null;
  const [itemsPopup, setItemsPopup] = useState({
    open: false,
    boxTitle: "",
    items: [],
  });

  function openItemsPopup(order) {
    const items = parseOrderSelectedProducts(order?.selectedProducts);
    setItemsPopup({
      open: true,
      boxTitle: order?.boxTitle || "Order",
      items,
    });
  }

  return (
    <Page
      title="Analytics"
    >
      <style>{`
        .Polaris-InlineGrid {
          z-index: 0;
        }
        .Polaris-ShadowBevel {
          z-index: 1;
        }
        .Polaris-BlockStack {
          z-index: 0;
        }
      `}</style>
      <BlockStack gap="500">
        {/* ── Period Selector + Comparison Banner ── */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center" wrap>
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">{analyticsScopeLabel} Performance Overview</Text>
                <Text as="p" tone="subdued" variant="bodySm"></Text>
              </BlockStack>
              <InlineStack gap="300" wrap>
                <ComboTypeFilter value={comboType} />
                <DateRangePicker period={period} fromDate={fromDate} toDate={toDate} />
                <SyncOrdersButton />
              </InlineStack>
            </InlineStack>
            <ComparisonBanner period={periodRange} prevPeriod={prevPeriod} />
          </BlockStack>
        </Card>

        {/* ── KPI Cards ── */}
        <InlineGrid columns={{ xs: 2, md: 4 }} gap="400">
          <KpiCard
            label={`Total ${analyticsScopeLabel} Revenue`}
            value={formatCurrencyAmount(totalRevenue, currencyCode)}
            subLabel={prevTotalRevenue ? `prev ${formatCurrencyAmount(prevTotalRevenue || 0, currencyCode)}` : null}
            change={revenueChange}
            accentColor="#3b82f6"
            iconType="money"
          />
          <KpiCard
            label={`Total ${analyticsScopePluralLabel} Sold`}
            value={totalOrders}
            subLabel={prevTotalOrders ? `prev ${prevTotalOrders}` : null}
            change={ordersChange}
            accentColor="#2A7A4F"
            iconType="package"
          />
          <KpiCard
            label={`Average ${analyticsScopeLabel} Order Value`}
            value={formatCurrencyAmount(avgBundleValue, currencyCode)}
            subLabel={null}
            change={avgChange}
            accentColor="#8b5cf6"
            iconType="chart-line"
          />
          <KpiCard
            label={`Active ${analyticsScopePluralLabel}`}
            value={activeBoxCount}
            subLabel={null}
            change={null}
            accentColor="#f59e0b"
            iconType="collection-list"
            subtitle={`Total live ${analyticsScopePluralLabel.toLowerCase()}`}
          />
        </InlineGrid>

        {/* ── Top Products + Box Performance ── */}
        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Most Picked {analyticsScopeLabel} Products</Text>
              <TopProductsChart data={topProducts} />
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">{analyticsScopeLabel} Box Performance</Text>
              <BoxPerformanceChart data={boxPerformance} currencyCode={currencyCode} />
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* ── Revenue & Orders Charts ── */}
        <BlockStack gap="400">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">{analyticsScopeLabel} Revenue Over Time</Text>
              <div style={{ height: "1px", background: "#e5e7eb", width: "100%" }} />
              <LineChart
                title={`Total Revenue from ${analyticsScopePluralLabel}`}
                totalValue={formatCurrencyAmount(totalRevenue, currencyCode)}
                change={revenueChange}
                data={revData}
                prevData={prevRevData}
                periodLabel={periodLabel}
                prevPeriodLabel={prevPeriodLabel}
                formatY={(value) => fmtCurrency(value, currencyCode)}
                color="#60a5fa"
                color2="#818cf8"
              />
              <div style={{ height: "1px", background: "#e5e7eb", width: "100%" }} />
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">{analyticsScopeLabel} Orders Over Time</Text>
              <div style={{ height: "1px", background: "#e5e7eb", width: "100%" }} />
              <LineChart
                title={`${analyticsScopeLabel} Orders Over Time`}
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
              <div style={{ height: "1px", background: "#e5e7eb", width: "100%" }} />
            </BlockStack>
          </Card>
        </BlockStack>

        {/* ── Recent Orders ── */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Recent {analyticsScopeLabel} Orders</Text>
            <RecentOrdersTable
              data={recentOrders}
              currencyCode={currencyCode}
              onOpenItemsPopup={openItemsPopup}
              shopDomain={shopDomain}
            />
          </BlockStack>
        </Card>
      </BlockStack>

      <Modal
        open={itemsPopup.open}
        onClose={() => setItemsPopup({ open: false, boxTitle: "", items: [] })}
        title={`All Items � ${itemsPopup.boxTitle}`}
        primaryAction={{
          content: "Close",
          onAction: () => setItemsPopup({ open: false, boxTitle: "", items: [] }),
        }}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" tone="subdued">
              {itemsPopup.items.length} item{itemsPopup.items.length === 1 ? "" : "s"} in this order
            </Text>
            {itemsPopup.items.length === 0 ? (
              <Text as="p" variant="bodySm" tone="subdued">No items found for this order.</Text>
            ) : (
              <BlockStack gap="100">
                {itemsPopup.items.map((item, idx) => {
                  const productUrl = buildAdminProductLink(shopDomain, item);
                  return (
                    <InlineStack key={`${item}-${idx}`} align="space-between" blockAlign="center" wrap={false}>
                      <Text as="span" variant="bodySm">{item}</Text>
                      {productUrl ? (
                        <Button
                          size="slim"
                          url={productUrl}
                          target="_blank"
                          variant="plain"
                          icon={<EyeIcon size={16} color="#000000" fill="#ffffff" />}
                          accessibilityLabel={`Open ${item} product`}
                        />
                      ) : (
                        <Text as="span" variant="bodySm" tone="subdued">No link</Text>
                      )}
                    </InlineStack>
                  );
                })}
              </BlockStack>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};


