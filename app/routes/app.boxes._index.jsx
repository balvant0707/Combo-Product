import { useState, useMemo, useEffect } from "react";
import { useFetcher, useLoaderData, useLocation, useNavigate, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  listBoxes,
  deleteBox,
  toggleBoxStatus,
  reorderBoxes,
  activateAllBundleProducts,
  repairMissingShopifyProducts,
  repairMissingShopifyVariantIds,
  upsertComboConfig,
  getBoxListImageSrc,
} from "../models/boxes.server";
import { AdminIcon } from "../components/admin-icons";
import { withEmbeddedAppParams } from "../utils/embedded-app";

function getDiscountSummary(box) {
  // Always read from comboStepsConfig JSON — works for both regular and specific combo boxes
  const src = box.comboStepsConfig;
  if (!src) return null;
  try {
    const p = JSON.parse(src);
    const type = p?.discountType;
    const value = p?.discountValue;
    if (!type || type === "none") return null;
    if (type !== "buy_x_get_y" && value == null) return null;
    const buyQuantity = Math.max(1, parseInt(String(p?.buyQuantity ?? 1), 10) || 1);
    const getQuantity = Math.max(1, parseInt(String(p?.getQuantity ?? 1), 10) || 1);
    return { discountType: type, discountValue: value, buyQuantity, getQuantity };
  } catch { return null; }
}

function getComboConfigSummary(box) {
  if (box.config) {
    const comboType = box.config.comboType;
    if (!comboType || comboType < 2) return null;
    // Require at least one step to be saved — prevents misidentifying regular boxes
    let hasSteps = false;
    try { hasSteps = JSON.parse(box.config.stepsJson || "[]").length > 0; } catch {}
    if (!hasSteps) return null;
    return { comboType, title: box.config.title, isActive: box.config.isActive, stepsJson: box.config.stepsJson };
  }
  if (!box.comboStepsConfig) return null;
  try {
    const parsed = JSON.parse(box.comboStepsConfig);
    const comboType = parseInt(parsed?.type) || 0;
    if (comboType < 2) return null;
    const steps = Array.isArray(parsed?.steps) ? parsed.steps : [];
    if (steps.length === 0) return null;
    return { comboType, title: parsed?.title || null, isActive: parsed?.isActive !== false, stepsJson: JSON.stringify(steps) };
  } catch { return null; }
}

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  await repairMissingShopifyProducts(session.shop, admin);
  await repairMissingShopifyVariantIds(session.shop, admin);
  let boxes = await listBoxes(session.shop, false, true);
  const boxesMissingTypedComboConfig = boxes.filter((box) => {
    if (box.config || !box.comboStepsConfig) return false;
    try { const p = JSON.parse(box.comboStepsConfig); return parseInt(p?.type) >= 2; } catch { return false; }
  });
  if (boxesMissingTypedComboConfig.length > 0) {
    await Promise.all(
      boxesMissingTypedComboConfig.map((box) =>
        upsertComboConfig(box.id, box.comboStepsConfig).catch((error) => {
          console.error("[app.boxes._index] Failed to repair combo config for box", box.id, error);
        })
      )
    );
    boxes = await listBoxes(session.shop, false, true);
  }
  activateAllBundleProducts(session.shop, admin).catch(() => {});
  return {
    boxes: boxes.map((b) => ({
      id: b.id,
      boxCode: b.boxCode || null,
      boxName: b.boxName,
      displayTitle: b.displayTitle,
      itemCount: b.itemCount,
      bundlePrice: parseFloat(b.bundlePrice),
      bundlePriceType: b.bundlePriceType || "manual",
      isGiftBox: b.isGiftBox,
      isActive: b.isActive,
      sortOrder: b.sortOrder,
      orderCount: b._count?.orders ?? 0,
      comboConfig: getComboConfigSummary(b),
      discount: getDiscountSummary(b),
      listImageSrc: getBoxListImageSrc(b),
    })),
  };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("_action");
  if (intent === "delete") {
    const id = formData.get("id");
    await deleteBox(id, shop, admin);
    return { ok: true };
  }
  if (intent === "reorder") {
    const orderedIds = JSON.parse(formData.get("orderedIds") || "[]");
    await reorderBoxes(shop, orderedIds);
    return { ok: true };
  }
  if (intent === "toggle_status") {
    const id = formData.get("id");
    const isActive = formData.get("isActive") === "true";
    await toggleBoxStatus(id, shop, isActive);
    return { ok: true };
  }
  return { ok: false };
};

// Avatar color palette for box initials
const AVATAR_COLORS = [
  { bg: "#dbeafe", color: "#1d4ed8" },
  { bg: "#dcfce7", color: "#15803d" },
  { bg: "#ede9fe", color: "#7c3aed" },
  { bg: "#fce7f3", color: "#be185d" },
  { bg: "#ffedd5", color: "#c2410c" },
  { bg: "#ecfeff", color: "#0e7490" },
  { bg: "#fef9c3", color: "#854d0e" },
  { bg: "#f0fdf4", color: "#166534" },
];

function getAvatarColor(id) {
  return AVATAR_COLORS[id % AVATAR_COLORS.length];
}

function CopyCodeIcon({ size = 16 }) {
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
        d="M7.5 3H14.6C16.8402 3 17.9603 3 18.816 3.43597C19.5686 3.81947 20.1805 4.43139 20.564 5.18404C21 6.03969 21 7.15979 21 9.4V16.5M6.2 21H14.3C15.4201 21 15.9802 21 16.408 20.782C16.7843 20.5903 17.0903 20.2843 17.282 19.908C17.5 19.4802 17.5 18.9201 17.5 17.8V9.7C17.5 8.57989 17.5 8.01984 17.282 7.59202C17.0903 7.21569 16.7843 6.90973 16.408 6.71799C15.9802 6.5 15.4201 6.5 14.3 6.5H6.2C5.0799 6.5 4.51984 6.5 4.09202 6.71799C3.71569 6.90973 3.40973 7.21569 3.21799 7.59202C3 8.01984 3 8.57989 3 9.7V17.8C3 18.9201 3 19.4802 3.21799 19.908C3.40973 20.2843 3.71569 20.5903 4.09202 20.782C4.51984 21 5.0799 21 6.2 21Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CopyCodeBtn({ code }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <div className="cb-code-cell">
      <span className="cb-code-chip">{code}</span>
      <button
        type="button"
        className={`cb-copy-btn${copied ? " copied" : ""}`}
        title={copied ? "Copied!" : "Copy code"}
        onClick={handleCopy}
      >
        <CopyCodeIcon size={16} />
      </button>
    </div>
  );
}

export default function ManageBoxesPage() {
  const { boxes } = useLoaderData();
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const fetcher = useFetcher();
  const toggleFetcher = useFetcher();

  const PAGE_SIZE = 10;
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [showCreateBoxModal, setShowCreateBoxModal] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [manualPageLoading, setManualPageLoading] = useState(false);
  const isDeleteSubmitting =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("_action") === "delete";
  const isReorderSubmitting =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("_action") === "reorder";
  const isToggleSubmitting =
    toggleFetcher.state !== "idle" &&
    toggleFetcher.formData?.get("_action") === "toggle_status";
  const pendingToggleId = isToggleSubmitting ? parseInt(toggleFetcher.formData?.get("id"), 10) : null;
  const pendingToggleState = isToggleSubmitting ? toggleFetcher.formData?.get("isActive") === "true" : null;
  const isPageLoading =
    manualPageLoading ||
    navigation.state !== "idle" ||
    isDeleteSubmitting ||
    isReorderSubmitting ||
    isToggleSubmitting;

  function startPageLoading() {
    setManualPageLoading(true);
  }

  useEffect(() => {
    if (
      manualPageLoading &&
      navigation.state === "idle" &&
      !isDeleteSubmitting &&
      !isReorderSubmitting &&
      !isToggleSubmitting
    ) {
      setManualPageLoading(false);
    }
  }, [manualPageLoading, navigation.state, isDeleteSubmitting, isReorderSubmitting, isToggleSubmitting]);

  function navigateTo(path) {
    startPageLoading();
    navigate(withEmbeddedAppParams(path, location.search));
  }
  function openCreateBoxModal() {
    setShowCreateBoxModal(true);
  }
  function closeCreateBoxModal() {
    setShowCreateBoxModal(false);
  }
  function goToCreateRoute(path) {
    closeCreateBoxModal();
    navigateTo(path);
  }

  function handleDelete(id, name) { setDeleteConfirm({ id, name }); }

  function confirmDelete() {
    if (deleteConfirm) {
      startPageLoading();
      fetcher.submit({ _action: "delete", id: String(deleteConfirm.id) }, { method: "POST" });
    }
    setDeleteConfirm(null);
  }

  function toggleStatus(id, nextState) {
    toggleFetcher.submit(
      { _action: "toggle_status", id: String(id), isActive: String(nextState) },
      { method: "POST" },
    );
  }

  const baseBoxes =
    fetcher.formData?.get("_action") === "delete"
      ? boxes.filter((b) => b.id !== parseInt(fetcher.formData.get("id")))
      : boxes;

  const boxesWithPendingToggle = useMemo(
    () => (
      pendingToggleId === null
        ? baseBoxes
        : baseBoxes.map((b) => (b.id === pendingToggleId ? { ...b, isActive: pendingToggleState } : b))
    ),
    [baseBoxes, pendingToggleId, pendingToggleState],
  );

  const filteredBoxes = useMemo(() => {
    let result = boxesWithPendingToggle;
    if (statusFilter === "active") result = result.filter((b) => b.isActive);
    if (statusFilter === "inactive") result = result.filter((b) => !b.isActive);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (b) => b.boxName.toLowerCase().includes(q) || (b.displayTitle && b.displayTitle.toLowerCase().includes(q))
      );
    }
    return result.sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  }, [boxesWithPendingToggle, statusFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filteredBoxes.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const displayBoxes = filteredBoxes.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Reset to page 1 when filter/search changes
  useEffect(() => { setCurrentPage(1); }, [statusFilter, search]);

  const totalOrders = baseBoxes.reduce((s, b) => s + b.orderCount, 0);
  const activeCount = boxesWithPendingToggle.filter((b) => b.isActive).length;
  const inactiveCount = boxesWithPendingToggle.length - activeCount;

  return (
    <s-page heading="Combo Boxes" inlineSize="medium">
      <style>{`
        /* ── Stats bar ── */
        .cb-stats {
          display: flex;
          gap: 12px;
          margin-bottom: 16px;
          flex-wrap: wrap;
        }
        .cb-stat-card {
          flex: 1;
          min-width: 120px;
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          padding: 14px 18px;
          display: flex;
          align-items: center;
          gap: 12px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.04);
        }
        .cb-stat-icon {
          width: 38px; height: 38px;
          border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .cb-stat-val { font-size: 20px; font-weight: 800; color: #111827; line-height: 1; }
        .cb-stat-lbl { font-size: 11px; color: #000000; margin-top: 2px; font-weight: 500; letter-spacing: 0.03em; }

        /* ── Toolbar ── */
        .cb-toolbar {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 16px;
          border-bottom: 1px solid #f0f0f0;
          flex-wrap: wrap;
        }
        .cb-search-wrap {
          flex: 1;
          min-width: 200px;
          display: flex;
          align-items: center;
          gap: 8px;
          background: #fff;
          border: 1.5px solid #e5e7eb;
          border-radius: 8px;
          padding: 8px 12px;
          transition: border-color 0.15s;
        }
        .cb-search-wrap:focus-within { border-color: #2A7A4F; box-shadow: 0 0 0 3px rgba(42,122,79,0.08); }
        .cb-search-wrap input {
          border: none; outline: none; background: transparent;
          font-size: 13px; color: #111827; width: 100%;
        }
        .cb-search-wrap input::placeholder { color: #b0b7c3; }
        .cb-clear-btn {
          background: none; border: none; cursor: pointer;
          color: #9ca3af; padding: 0; line-height: 1; font-size: 18px;
          display: flex; align-items: center;
        }
        .cb-filter-tabs { display: flex; gap: 4px; }
        .cb-ftab {
          padding: 7px 14px;
          border: 1.5px solid #e5e7eb;
          border-radius: 8px;
          background: #fff;
          font-size: 12px; font-weight: 500; color: #000000;
          cursor: pointer; transition: all 0.12s; white-space: nowrap;
        }
        .cb-ftab:hover { background: #f3f4f6; border-color: #d1d5db; color: #111827; }
        .cb-ftab.f-all  { background: #111827; color: #fff; border-color: #111827; font-weight: 600; }
        .cb-ftab.f-live { background: #dcfce7; color: #166534; border-color: #86efac; font-weight: 600; }
        .cb-ftab.f-draft{ background: #f3f4f6; color: #374151; border-color: #d1d5db; font-weight: 600; }
        .cb-count-pill {
          display: inline-flex; align-items: center; justify-content: center;
          background: rgba(255,255,255,0.25); border-radius: 99px;
          padding: 0 6px; font-size: 11px; margin-left: 4px; min-width: 18px; height: 16px;
        }
        .cb-ftab.f-all .cb-count-pill { background: rgba(255,255,255,0.2); }
        .cb-ftab.f-live .cb-count-pill { background: rgba(22,101,52,0.12); }
        .cb-ftab.f-draft .cb-count-pill { background: rgba(0,0,0,0.07); }

        /* ── Table ── */
        .cb-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .cb-table thead th {
          text-align: left; padding: 11px 16px;
          font-size: 12px; font-weight: 700; color: #000000;
          text-transform: uppercase; letter-spacing: 0.08em;
          border-bottom: 1px solid #e5e7eb; white-space: nowrap;
        }
        .cb-table thead th:last-child { text-align: right; padding-right: 20px; }
        .cb-table tbody tr {
          border-bottom: 1px solid #f3f4f6;
          transition: background 0.1s;
          cursor: default;
        }
        .cb-table tbody tr:last-child { border-bottom: none; }
        .cb-table tbody tr:hover { background: #f8fffe; }
        .cb-table td { padding: 13px 16px; vertical-align: middle; }
        .cb-table td:last-child { text-align: right; padding-right: 20px; }

        /* ── Box avatar ── */
        .cb-avatar {
          width: 36px; height: 36px; border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          font-weight: 800; font-size: 14px; flex-shrink: 0;
          letter-spacing: -0.5px;
          overflow: hidden;
          border: 1px solid rgba(0,0,0,0.04);
        }
        .cb-avatar-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        /* ── Badges ── */
        .cb-badge {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 2px 8px; border-radius: 4px;
          font-size: 10px; font-weight: 700; letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .b-live   { color: #000000; background: #dcfce7; }
        .b-draft  { color: #000000; background: #f3f4f6; }
        .b-combo  { color: #000000; background: #dbeafe; }
        .b-single { color: #000000; background: #f3f4f6; }
        .b-gift   { color: #000000; background: #ede9fe; }

        /* ── Status dot ── */
        .cb-dot {
          width: 7px; height: 7px; border-radius: 50%; display: inline-block; flex-shrink: 0;
        }
        .dot-live { background: #22c55e; box-shadow: 0 0 0 2px rgba(34,197,94,0.2); }
        .dot-draft { background: #d1d5db; }

        /* ── Action buttons ── */
        .cb-actions { display: flex; gap: 6px; justify-content: flex-end; }
        .cb-btn {
          width: 32px; height: 32px; border-radius: 7px;
          border: 1.5px solid #e5e7eb; background: #fff;
          cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
          color: #000000; transition: all 0.13s;
        }
        .cb-btn:hover { background: #f0fdf4; border-color: #2A7A4F; color: #2A7A4F; transform: scale(1.05); }
        .cb-btn.del:hover { background: #fef2f2; border-color: #fca5a5; color: #dc2626; }

        /* ── Toggle ── */
        .cb-toggle-wrap {
          align-items: center;
          justify-content: flex-end;
        }
        .cb-toggle-label {
          font-size: 11px;
          font-weight: 700;
          color: #000000;
          min-width: 42px;
          text-align: right;
        }
        .cb-toggle-btn {
          position: relative;
          width: 42px;
          height: 24px;
          border: none;
          border-radius: 999px;
          background: #d1d5db;
          padding: 0;
          cursor: pointer;
          transition: background 0.16s;
        }
        .cb-toggle-btn.is-on { background: #111827; }
        .cb-toggle-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }
        .cb-toggle-knob {
          position: absolute;
          top: 3px;
          left: 3px;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #ffffff;
          box-shadow: 0 1px 4px rgba(0,0,0,0.24);
          transition: left 0.16s;
        }
        .cb-toggle-btn.is-on .cb-toggle-knob { left: 21px; }

        /* ── Price ── */
        .cb-price { font-family: monospace; font-weight: 700; color: #111827; font-size: 13px; }
        .cb-price-dynamic { font-size: 11px; color: #9ca3af; font-style: italic; }

        /* ── Orders badge ── */
        .cb-orders-val {
          display: inline-flex; align-items: center; gap: 5px;
          font-weight: 700; color: #111827; font-size: 13px;
        }
        .cb-orders-zero { color: #d1d5db; font-size: 13px; font-weight: 500; }

        /* ── Empty state ── */
        .cb-empty {
          text-align: center; padding: 72px 24px;
        }
        .cb-empty-icon {
          width: 64px; height: 64px; border-radius: 16px;
          background: linear-gradient(135deg, #f0fdf4, #dcfce7);
          border: 1px solid #bbf7d0;
          display: flex; align-items: center; justify-content: center;
          margin: 0 auto 20px;
          box-shadow: 0 4px 12px rgba(42,122,79,0.12);
        }
        .cb-empty h3 { font-size: 16px; font-weight: 700; color: #111827; margin: 0 0 6px; }
        .cb-empty p { font-size: 13px; color: #9ca3af; margin: 0 0 24px; }
        .cb-empty-actions { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }

        /* ── No results ── */
        .cb-noresults {
          text-align: center; padding: 40px 24px; color: #9ca3af;
        }
        .cb-noresults p { margin: 8px 0 0; font-size: 13px; }

        /* ── Items chip ── */
        /* ── Box Code chip ── */
        .cb-code-cell { display: flex; align-items: center; gap: 6px; }
        .cb-code-chip {
          font-family: monospace; font-size: 12px; font-weight: 700;
          letter-spacing: 0.1em; color: #000000;
          background: #eff6ff; border: 1px solid #bfdbfe;
          border-radius: 5px; padding: 3px 8px;
          user-select: all;
        }
        .cb-copy-btn {
          width: 24px; height: 24px; border-radius: 5px;
          border: 1px solid #e5e7eb; background: #fff;
          cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
          color: #9ca3af; font-size: 12px; transition: all 0.13s; flex-shrink: 0;
        }
        .cb-copy-btn:hover { background: #f0fdf4; border-color: #2A7A4F; color: #2A7A4F; }
        .cb-copy-btn.copied { background: #dcfce7; border-color: #86efac; color: #16a34a; }

        /* ── Responsive ── */
        @media (max-width: 900px) {
          .cb-stats { gap: 8px; }
          .cb-stat-card { padding: 12px 14px; }
          .cb-stat-val { font-size: 18px; }
        }
        @media (max-width: 640px) {
          .cb-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
          .cb-toolbar { flex-direction: column; align-items: stretch; gap: 8px; }
          .cb-search-wrap { min-width: 0; }
          .cb-filter-tabs { flex-wrap: wrap; gap: 4px; }
          .cb-ftab { padding: 6px 10px; font-size: 11px; }
          /* Hide less-critical table columns on mobile */
          .cb-table thead th:nth-child(5),
          .cb-table tbody td:nth-child(5) { display: none; } /* orders */
          .cb-table td { padding: 10px 10px; }
          .cb-table thead th { padding: 10px 10px; }
          .cb-actions { gap: 4px; }
          .cb-btn { width: 28px; height: 28px; }
          .cb-empty { padding: 48px 16px; }
        }
        @media (max-width: 480px) {
          .cb-stats { grid-template-columns: 1fr 1fr; }
          /* Also hide Code column on very small screens */
          .cb-table thead th:nth-child(2),
          .cb-table tbody td:nth-child(2) { display: none; }
        }

        /* ── Pagination ── */
        .cb-pagination {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 16px;
          border-top: 1px solid #f3f4f6;
          gap: 10px;
          flex-wrap: wrap;
        }
        .cb-pagination-info {
          font-size: 12px;
          color: #6b7280;
          font-weight: 500;
        }
        .cb-pagination-controls {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .cb-page-btn {
          min-width: 32px;
          height: 32px;
          padding: 0 8px;
          border: 1.5px solid #e5e7eb;
          border-radius: 6px;
          background: #fff;
          font-size: 13px;
          font-weight: 600;
          color: #374151;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: all 0.12s;
          line-height: 1;
        }
        .cb-page-btn:hover:not(:disabled) { background: #f3f4f6; border-color: #d1d5db; }
        .cb-page-btn.active { background: #111827; color: #fff; border-color: #111827; }
        .cb-page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .cb-page-ellipsis { font-size: 13px; color: #9ca3af; padding: 0 4px; }
      `}</style>

      <ui-title-bar title="MixBox – Box & Bundle Builder">
        <button variant="primary" onClick={openCreateBoxModal}>
          + Create Box
        </button>
      </ui-title-bar>

      {/* Stats row */}
      <div className="cb-stats">
        {[
          { label: "Total Boxes",  value: baseBoxes.length,  icon: "package",    iconBg: "#eff6ff", iconColor: "#2563eb" },
          { label: "Active",       value: activeCount,        icon: "check",      iconBg: "#f0fdf4", iconColor: "#16a34a" },
          { label: "Inactive",     value: inactiveCount,      icon: "hide",       iconBg: "#fafafa", iconColor: "#9ca3af" },
          { label: "Total Orders", value: totalOrders,        icon: "order",      iconBg: "#fdf4ff", iconColor: "#9333ea" },
        ].map((s) => (
          <div key={s.label} className="cb-stat-card">
            <div className="cb-stat-icon" style={{ background: s.iconBg }}>
              <AdminIcon type={s.icon} size="base" style={{ color: s.iconColor }} />
            </div>
            <div>
              <div className="cb-stat-val">{s.value}</div>
              <div className="cb-stat-lbl">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      <s-section>
        {/* Toolbar */}
        <div className="cb-toolbar">
          <div className="cb-search-wrap">
            <AdminIcon type="search" size="small" style={{ flexShrink: 0, color: "#9ca3af" }} />
            <input
              type="text"
              placeholder="Search by box name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="cb-clear-btn" type="button" onClick={() => setSearch("")}>×</button>
            )}
          </div>

          <div className="cb-filter-tabs">
            <button type="button" className={`cb-ftab ${statusFilter === "all" ? "f-all" : ""}`} onClick={() => setStatusFilter("all")}>
              All <span className="cb-count-pill">{baseBoxes.length}</span>
            </button>
            <button type="button" className={`cb-ftab ${statusFilter === "active" ? "f-live" : ""}`} onClick={() => setStatusFilter("active")}>
              Active <span className="cb-count-pill">{activeCount}</span>
            </button>
            <button type="button" className={`cb-ftab ${statusFilter === "inactive" ? "f-draft" : ""}`} onClick={() => setStatusFilter("inactive")}>
              Inactive <span className="cb-count-pill">{inactiveCount}</span>
            </button>
          </div>

        </div>

        {baseBoxes.length === 0 ? (
          /* Empty state — no boxes at all */
          <div className="cb-empty">
            <div className="cb-empty-icon">
              <AdminIcon type="package" size="large" tone="success" />
            </div>
            <h3>No combo boxes yet</h3>
            <p>Create your first box to let customers build custom combos on your storefront.</p>
            <div className="cb-empty-actions">
              <s-button onClick={() => navigateTo("/app/boxes/new")}>+ Create Box</s-button>
              <s-button onClick={() => navigateTo("/app/boxes/specific-combo")}>Specific Combo Box</s-button>
            </div>
          </div>
        ) : filteredBoxes.length === 0 ? (
          /* No search/filter results */
          <div className="cb-noresults">
            <AdminIcon type="search" size="large" style={{ color: "#d1d5db" }} />
            <p>No boxes match <strong>&ldquo;{search}&rdquo;</strong></p>
          </div>
        ) : (
          <>
          <div style={{ overflowX: "auto" }}>
            <table className="cb-table">
              <thead>
                <tr>
                  <th>Box Name</th>
                  <th>Code</th>
                  <th>Price</th>
                  <th>Type</th>
                  <th>Orders</th>
                  <th>Enabled</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayBoxes.map((box) => {
                  const avatar = getAvatarColor(box.id);
                  const isRowTogglePending = isToggleSubmitting && pendingToggleId === box.id;
                  return (
                    <tr
                      key={box.id}
                      data-box-id={box.id}
                    >
                      {/* Box Name */}
                      <td style={{ minWidth: 220 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <div className="cb-avatar" style={{ background: avatar.bg, color: avatar.color }}>
                            {box.listImageSrc ? (
                              <img className="cb-avatar-img" src={box.listImageSrc} alt={`${box.boxName} image`} />
                            ) : (
                              box.boxName.charAt(0).toUpperCase()
                            )}
                          </div>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                              <span style={{ fontWeight: 700, color: "#111827", fontSize: 13 }}>{box.boxName}</span>
                              <span className={`cb-dot ${box.isActive ? "dot-live" : "dot-draft"}`} />
                              <span className={`cb-badge ${box.isActive ? "b-live" : "b-draft"}`}>
                                {box.isActive ? "Live" : "Draft"}
                              </span>
                              {box.isGiftBox && (
                                <span className="cb-badge b-gift" style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                                  <AdminIcon type="gift-card" size="small" /> Gift
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Code */}
                      <td>
                        {box.boxCode ? <CopyCodeBtn code={box.boxCode} /> : <span style={{ color: "#d1d5db", fontSize: 12 }}>—</span>}
                      </td>

                      {/* Price */}
                      <td>
                        {box.bundlePriceType === "dynamic" ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <span className="cb-price-dynamic">Dynamic</span>
                            {box.discount && (
                              <span style={{ fontSize: 11, color: "#2A7A4F", fontWeight: 600 }}>
                                {box.discount.discountType === "percent"
                                  ? `${box.discount.discountValue}% off`
                                  : box.discount.discountType === "fixed"
                                    ? `₹${box.discount.discountValue} off`
                                    : box.discount.discountType === "buy_x_get_y"
                                      ? `Buy ${box.discount.buyQuantity || 1} Get ${box.discount.getQuantity || 1} Free`
                                      : `${box.discount.discountValue} off`}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="cb-price">
                            &#8377;{Number(box.bundlePrice).toLocaleString("en-IN")}
                          </span>
                        )}
                      </td>

                      {/* Type */}
                      <td>
                        {box.comboConfig && box.comboConfig.comboType > 0 ? (
                          <span className="cb-badge b-combo">
                            {box.comboConfig.comboType}-Step
                          </span>
                        ) : (
                          <span className="cb-badge b-single">Single</span>
                        )}
                      </td>

                      {/* Orders */}
                      <td>
                        {box.orderCount > 0 ? (
                          <span className="cb-orders-val">
                            <AdminIcon type="orders" size="small" style={{ color: "#2A7A4F" }} />
                            {box.orderCount}
                          </span>
                        ) : (
                          <span className="cb-orders-zero">No</span>
                        )}
                      </td>

                      {/* Enabled */}
                      <td>
                        <div className="cb-toggle-wrap">
                          <button
                            type="button"
                            className={`cb-toggle-btn ${box.isActive ? "is-on" : ""}`}
                            disabled={isToggleSubmitting}
                            aria-label={box.isActive ? "Disable box" : "Enable box"}
                            title={box.isActive ? "Disable on storefront" : "Enable on storefront"}
                            onClick={() => toggleStatus(box.id, !box.isActive)}
                          >
                            <span className="cb-toggle-knob" />
                          </button>
                        </div>
                        {isRowTogglePending && (
                          <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 4, textAlign: "right" }}>
                            Updating...
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      <td>
                        <div className="cb-actions">
                          <button
                            className="cb-btn"
                            title="Edit"
                            onClick={() => navigateTo(box.comboConfig ? `/app/boxes/${box.id}/combo` : `/app/boxes/${box.id}`)}
                          >
                            <AdminIcon type="edit" size="small" />
                          </button>
                          {box.orderCount === 0 && (
                            <button
                              className="cb-btn del"
                              title="Delete"
                              onClick={() => handleDelete(box.id, box.boxName)}
                            >
                              <AdminIcon type="delete" size="small" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="cb-pagination">
              <span className="cb-pagination-info">
                Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filteredBoxes.length)} of {filteredBoxes.length} boxes
              </span>
              <div className="cb-pagination-controls">
                <button
                  className="cb-page-btn"
                  disabled={safePage === 1}
                  onClick={() => setCurrentPage(1)}
                  title="First page"
                >«</button>
                <button
                  className="cb-page-btn"
                  disabled={safePage === 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  title="Previous page"
                >‹</button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
                  .reduce((acc, p, idx, arr) => {
                    if (idx > 0 && p - arr[idx - 1] > 1) acc.push("…");
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((item, idx) =>
                    item === "…" ? (
                      <span key={`ellipsis-${idx}`} className="cb-page-ellipsis">…</span>
                    ) : (
                      <button
                        key={item}
                        className={`cb-page-btn${item === safePage ? " active" : ""}`}
                        onClick={() => setCurrentPage(item)}
                      >{item}</button>
                    )
                  )}
                <button
                  className="cb-page-btn"
                  disabled={safePage === totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  title="Next page"
                >›</button>
                <button
                  className="cb-page-btn"
                  disabled={safePage === totalPages}
                  onClick={() => setCurrentPage(totalPages)}
                  title="Last page"
                >»</button>
              </div>
            </div>
          )}
          </>
        )}
      </s-section>

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
          <s-spinner accessibilityLabel="Loading page" size="large" />
        </div>
      )}

      {/* Create Box modal */}
      {showCreateBoxModal && (
        <div
          onClick={closeCreateBoxModal}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.55)",
            backdropFilter: "blur(3px)",
            zIndex: 10000,
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
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: "680px",
              background: "#ffffff",
              borderRadius: "10px",
              border: "1px solid #e5e7eb",
              boxShadow: "0 24px 64px rgba(0,0,0,0.22)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid #e5e7eb",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div style={{ fontSize: "20px", fontWeight: 700, color: "#111827", lineHeight: 1.2 }}>
                Create Box
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={closeCreateBoxModal}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "#000000",
                  lineHeight: 1,
                  cursor: "pointer",
                  padding: "4px 8px",
                  display: "inline-flex",
                  alignItems: "center",
                }}
              >
                <AdminIcon type="x" size="base" />
              </button>
            </div>

            <div style={{ padding: "16px 18px" }}>
              <button
                type="button"
                onClick={() => goToCreateRoute("/app/boxes/new")}
                style={{
                  width: "100%",
                  border: "1px solid #e5e7eb",
                  borderRadius: "8px",
                  background: "#f9fafb",
                  padding: "16px 14px",
                  display: "flex",
                  alignItems: "center",
                  gap: "14px",
                  cursor: "pointer",
                  textAlign: "left",
                  marginBottom: "10px",
                }}
              >
                <div
                  style={{
                    width: "48px",
                    height: "48px",
                    borderRadius: "8px",
                    background: "#f3f4f6",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#000000",
                    flexShrink: 0,
                  }}
                >
                  <AdminIcon type="package" size="base" />
                </div>
                <div>
                  <div style={{ fontSize: "15px", fontWeight: 700, color: "#111827", lineHeight: 1.2 }}>Create Combo Box</div>
                  <div style={{ fontSize: "13px", color: "#6b7280", marginTop: "2px", lineHeight: 1.35 }}>
                    Quick setup for fixed bundles and a fast purchase flow.
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => goToCreateRoute("/app/boxes/specific-combo")}
                style={{
                  width: "100%",
                  border: "1px solid #e5e7eb",
                  borderRadius: "8px",
                  background: "#f9fafb",
                  padding: "16px 14px",
                  display: "flex",
                  alignItems: "center",
                  gap: "14px",
                  cursor: "pointer",
                  textAlign: "left",
                  marginBottom: "12px",
                }}
              >
                <div
                  style={{
                    width: "48px",
                    height: "48px",
                    borderRadius: "8px",
                    background: "#f3f4f6",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#000000",
                    flexShrink: 0,
                  }}
                >
                  <AdminIcon type="target" size="base" />
                </div>
                <div>
                  <div style={{ fontSize: "15px", fontWeight: 700, color: "#111827", lineHeight: 1.2 }}>Create Specific Combo Box</div>
                  <div style={{ fontSize: "13px", color: "#6b7280", marginTop: "2px", lineHeight: 1.35 }}>
                    Guided step-by-step customization for personalized bundles.
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete modal */}
      {deleteConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", backdropFilter: "blur(3px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 12, width: "100%", maxWidth: 400, boxShadow: "0 24px 64px rgba(0,0,0,0.22)", overflow: "hidden" }}>
            <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #f3f4f6", display: "flex", gap: 14, alignItems: "flex-start" }}>
              <div style={{ width: 42, height: 42, borderRadius: "50%", background: "#fef2f2", border: "1.5px solid #fecaca", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <AdminIcon type="delete" size="base" />
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>Delete box?</div>
                <div style={{ fontSize: 13, color: "#000000", marginTop: 3 }}>
                  <strong style={{ color: "#111827" }}>&ldquo;{deleteConfirm.name}&rdquo;</strong> and its Shopify product will be permanently removed.
                </div>
              </div>
            </div>
            <div style={{ padding: "16px 24px", display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setDeleteConfirm(null)} style={{ background: "#fff", border: "1.5px solid #e5e7eb", borderRadius: 7, padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", color: "#374151" }}>
                Cancel
              </button>
              <button type="button" onClick={confirmDelete} style={{ background: "#dc2626", border: "none", borderRadius: 7, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", color: "#fff" }}>
                Delete
              </button>
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

