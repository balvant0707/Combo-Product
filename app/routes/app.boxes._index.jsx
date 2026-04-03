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
        {copied ? "✓" : "⎘"}
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

  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [showCreateBoxModal, setShowCreateBoxModal] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
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

  let dragSrcId = null;

  function onDragStart(e, id) { dragSrcId = id; e.currentTarget.style.opacity = "0.4"; }
  function onDragEnd(e) { e.currentTarget.style.opacity = "1"; }
  function onDragOver(e) { e.preventDefault(); e.currentTarget.style.background = "#f0fdf4"; }
  function onDragLeave(e) { e.currentTarget.style.background = ""; }

  function onDrop(e, targetId) {
    e.preventDefault();
    e.currentTarget.style.background = "";
    if (dragSrcId === targetId) return;
    const rows = Array.from(document.querySelectorAll("tr[data-box-id]")).map((r) => parseInt(r.getAttribute("data-box-id")));
    const srcIdx = rows.indexOf(dragSrcId);
    const tgtIdx = rows.indexOf(targetId);
    if (srcIdx === -1 || tgtIdx === -1) return;
    rows.splice(srcIdx, 1);
    rows.splice(tgtIdx, 0, dragSrcId);
    fetcher.submit({ _action: "reorder", orderedIds: JSON.stringify(rows) }, { method: "POST" });
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

  const displayBoxes = useMemo(() => {
    let result = boxesWithPendingToggle;
    if (statusFilter === "active") result = result.filter((b) => b.isActive);
    if (statusFilter === "inactive") result = result.filter((b) => !b.isActive);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (b) => b.boxName.toLowerCase().includes(q) || (b.displayTitle && b.displayTitle.toLowerCase().includes(q))
      );
    }
    return result;
  }, [boxesWithPendingToggle, statusFilter, search]);

  const totalOrders = baseBoxes.reduce((s, b) => s + b.orderCount, 0);
  const activeCount = boxesWithPendingToggle.filter((b) => b.isActive).length;
  const inactiveCount = boxesWithPendingToggle.length - activeCount;

  return (
    <s-page heading="Combo Boxes" inlineSize="large">
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
          background: #fafafa;
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
        .cb-table thead tr { background: #f9fafb; }
        .cb-table thead th {
          text-align: left; padding: 11px 16px;
          font-size: 10px; font-weight: 700; color: #9ca3af;
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
        .b-live   { color: #166534; background: #dcfce7; }
        .b-draft  { color: #000000; background: #f3f4f6; }
        .b-combo  { color: #1d4ed8; background: #dbeafe; }
        .b-single { color: #000000; background: #f3f4f6; }
        .b-gift   { color: #7c3aed; background: #ede9fe; }

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

        /* ── Drag handle ── */
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

        .cb-drag {
          color: #d1d5db; cursor: grab; font-size: 15px;
          line-height: 1; user-select: none; padding: 0 2px;
          transition: color 0.12s;
        }
        .cb-drag:hover { color: #9ca3af; }

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
        .cb-items-chip {
          display: inline-flex; align-items: center; justify-content: center;
          min-width: 28px; height: 24px; padding: 0 8px;
          background: #f3f4f6; border-radius: 6px;
          font-size: 12px; font-weight: 700; color: #374151;
        }

        /* ── Box Code chip ── */
        .cb-code-cell { display: flex; align-items: center; gap: 6px; }
        .cb-code-chip {
          font-family: monospace; font-size: 12px; font-weight: 700;
          letter-spacing: 0.1em; color: #1d4ed8;
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
      `}</style>

      <ui-title-bar title="Combo Boxes">
        <button variant="primary" onClick={openCreateBoxModal}>
          + Create Box
        </button>
      </ui-title-bar>

      {/* Stats row */}
      <div className="cb-stats">
        {[
          { label: "Total Boxes",  value: baseBoxes.length,  icon: "package",    iconBg: "#eff6ff", iconColor: "#2563eb" },
          { label: "Active",       value: activeCount,        icon: "checkmark",  iconBg: "#f0fdf4", iconColor: "#16a34a" },
          { label: "Inactive",     value: inactiveCount,      icon: "hide",       iconBg: "#fafafa", iconColor: "#9ca3af" },
          { label: "Total Orders", value: totalOrders,        icon: "orders",     iconBg: "#fdf4ff", iconColor: "#9333ea" },
        ].map((s) => (
          <div key={s.label} className="cb-stat-card">
            <div className="cb-stat-icon" style={{ background: s.iconBg }}>
              <AdminIcon type={s.icon} size="base" />
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
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0, color: "#9ca3af" }}>
              <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.8"/>
              <path d="M14.5 14.5L18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
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
        ) : displayBoxes.length === 0 ? (
          /* No search/filter results */
          <div className="cb-noresults">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" style={{ color: "#d1d5db" }}>
              <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M17 17L21 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M8 11h6M11 8v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <p>No boxes match <strong>&ldquo;{search}&rdquo;</strong></p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cb-table">
              <thead>
                <tr>
                  <th style={{ width: 32, padding: "11px 8px" }}></th>
                  <th>Box Name</th>
                  <th>Code</th>
                  <th>Items</th>
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
                      draggable
                      onDragStart={(e) => onDragStart(e, box.id)}
                      onDragEnd={onDragEnd}
                      onDragOver={onDragOver}
                      onDragLeave={onDragLeave}
                      onDrop={(e) => onDrop(e, box.id)}
                    >
                      {/* Drag */}
                      <td style={{ padding: "13px 8px", width: 32 }}>
                        <span className="cb-drag" title="Drag to reorder">⠿</span>
                      </td>

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
                                <span className="cb-badge b-gift">🎁 Gift</span>
                              )}
                            </div>
                            {box.displayTitle && box.displayTitle !== box.boxName && (
                              <div style={{ fontSize: 11, color: "#9ca3af" }}>{box.displayTitle}</div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Code */}
                      <td>
                        {box.boxCode ? <CopyCodeBtn code={box.boxCode} /> : <span style={{ color: "#d1d5db", fontSize: 12 }}>—</span>}
                      </td>

                      {/* Items */}
                      <td>
                        <span className="cb-items-chip">{box.itemCount}</span>
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
                            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#2A7A4F", display: "inline-block" }} />
                            {box.orderCount}
                          </span>
                        ) : (
                          <span className="cb-orders-zero">—</span>
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
                          <button
                            className="cb-btn del"
                            title="Delete"
                            onClick={() => handleDelete(box.id, box.boxName)}
                          >
                            <AdminIcon type="delete" size="small" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
                  fontSize: "26px",
                  fontWeight: 700,
                  lineHeight: 1,
                  cursor: "pointer",
                  padding: "4px 8px",
                }}
              >
                X
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
                  <div style={{ fontSize: "13px", color: "#000000", marginTop: "2px", lineHeight: 1.2 }}>Add a new bundle</div>
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
                  <div style={{ fontSize: "13px", color: "#000000", marginTop: "2px", lineHeight: 1.2 }}>Step-by-step combo experience</div>
                </div>
              </button>

              <div
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: "8px",
                  background: "#f9fafb",
                  padding: "14px 14px 12px",
                }}
              >
                <div style={{ fontSize: "15px", fontWeight: 700, color: "#1f2937", marginBottom: "12px" }}>
                  How each option works
                </div>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#1f2937", lineHeight: 1.35 }}>Create Combo Box</div>
                <div style={{ fontSize: "12px", color: "#4b5563", lineHeight: 1.5, marginTop: "6px" }}>
                  Best for quick bundle offers. You set up one complete box and customers can add it in a few clicks. Use this when you want a fast purchase flow, fixed combinations, and less decision-making for the customer.
                </div>
                <div style={{ borderTop: "1px dashed #d1d5db", margin: "12px 0" }} />
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#1f2937", lineHeight: 1.35 }}>Create Specific Combo Box</div>
                <div style={{ fontSize: "12px", color: "#4b5563", lineHeight: 1.5, marginTop: "6px" }}>
                  Best for guided customization. Customers choose items step by step, so they can build their own bundle with more control. Use this when product selection rules matter and you want a personalized shopping experience.
                </div>
              </div>
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
