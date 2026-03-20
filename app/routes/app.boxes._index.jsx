import { useState, useMemo } from "react";
import { useFetcher, useLoaderData, useLocation, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  listBoxes,
  deleteBox,
  reorderBoxes,
  activateAllBundleProducts,
  repairMissingShopifyProducts,
  repairMissingShopifyVariantIds,
  upsertComboConfig,
} from "../models/boxes.server";
import { AdminIcon } from "../components/admin-icons";
import { withEmbeddedAppParams } from "../utils/embedded-app";

function getComboConfigSummary(box) {
  if (box.config) {
    const comboType = box.config.comboType;
    if (!comboType || comboType <= 0) return null;
    return {
      comboType,
      title: box.config.title,
      isActive: box.config.isActive,
      stepsJson: box.config.stepsJson,
    };
  }

  if (!box.comboStepsConfig) return null;

  try {
    const parsed = JSON.parse(box.comboStepsConfig);
    const comboType = parseInt(parsed?.type) || 0;
    if (comboType <= 0) return null;
    const steps = Array.isArray(parsed?.steps) ? parsed.steps : [];
    return {
      comboType,
      title: parsed?.title || null,
      isActive: parsed?.isActive !== false,
      stepsJson: JSON.stringify(steps),
    };
  } catch {
    return null;
  }
}

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  await repairMissingShopifyProducts(session.shop, admin);
  await repairMissingShopifyVariantIds(session.shop, admin);
  let boxes = await listBoxes(session.shop);
  const boxesMissingTypedComboConfig = boxes.filter((box) => !box.config && box.comboStepsConfig);

  if (boxesMissingTypedComboConfig.length > 0) {
    await Promise.all(
      boxesMissingTypedComboConfig.map((box) =>
        upsertComboConfig(box.id, box.comboStepsConfig).catch((error) => {
          console.error("[app.boxes._index] Failed to repair combo config for box", box.id, error);
        })
      )
    );
    boxes = await listBoxes(session.shop);
  }

  activateAllBundleProducts(session.shop, admin).catch(() => {});
  return {
    boxes: boxes.map((b) => ({
      id: b.id,
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

  return { ok: false };
};

export default function ManageBoxesPage() {
  const { boxes } = useLoaderData();
  const location = useLocation();
  const navigate = useNavigate();
  const fetcher = useFetcher();

  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // "all" | "active" | "inactive"

  function navigateTo(path) {
    navigate(withEmbeddedAppParams(path, location.search));
  }

  function handleDelete(id, name) {
    setDeleteConfirm({ id, name });
  }

  function confirmDelete() {
    if (deleteConfirm) {
      fetcher.submit({ _action: "delete", id: String(deleteConfirm.id) }, { method: "POST" });
    }
    setDeleteConfirm(null);
  }

  // Drag & drop
  let dragSrcId = null;

  function onDragStart(e, id) {
    dragSrcId = id;
    e.currentTarget.style.opacity = "0.45";
  }

  function onDragEnd(e) {
    e.currentTarget.style.opacity = "1";
  }

  function onDragOver(e) {
    e.preventDefault();
    e.currentTarget.style.background = "#f0fdf4";
  }

  function onDragLeave(e) {
    e.currentTarget.style.background = "";
  }

  function onDrop(e, targetId) {
    e.preventDefault();
    e.currentTarget.style.background = "";
    if (dragSrcId === targetId) return;

    const rows = Array.from(
      document.querySelectorAll("tr[data-box-id]"),
    ).map((r) => parseInt(r.getAttribute("data-box-id")));

    const srcIdx = rows.indexOf(dragSrcId);
    const tgtIdx = rows.indexOf(targetId);
    if (srcIdx === -1 || tgtIdx === -1) return;

    rows.splice(srcIdx, 1);
    rows.splice(tgtIdx, 0, dragSrcId);

    fetcher.submit(
      { _action: "reorder", orderedIds: JSON.stringify(rows) },
      { method: "POST" },
    );
  }

  const baseBoxes =
    fetcher.formData?.get("_action") === "delete"
      ? boxes.filter((b) => b.id !== parseInt(fetcher.formData.get("id")))
      : boxes;

  const displayBoxes = useMemo(() => {
    let result = baseBoxes;
    if (statusFilter === "active") result = result.filter((b) => b.isActive);
    if (statusFilter === "inactive") result = result.filter((b) => !b.isActive);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (b) =>
          b.boxName.toLowerCase().includes(q) ||
          (b.displayTitle && b.displayTitle.toLowerCase().includes(q))
      );
    }
    return result;
  }, [baseBoxes, statusFilter, search]);

  const COLUMNS = ["", "Box Name", "Items", "Price", "Type", "Orders", "Actions"];

  return (
    <s-page heading={`Combo Boxes (${baseBoxes.length})`}>
      <style>{`
        .cb-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .cb-table thead th {
          text-align: left;
          padding: 10px 16px;
          font-size: 11px;
          font-weight: 600;
          color: #6b7280;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          border-bottom: 1px solid #e5e7eb;
          background: #f9fafb;
          white-space: nowrap;
        }
        .cb-table thead th:last-child { text-align: center; }
        .cb-table tbody tr {
          border-bottom: 1px solid #f3f4f6;
          transition: background 0.12s;
        }
        .cb-table tbody tr:last-child { border-bottom: none; }
        .cb-table tbody tr:hover { background: #f9fafb; }
        .cb-table td { padding: 12px 16px; vertical-align: middle; }
        .cb-table td:last-child { text-align: center; }
        .cb-badge {
          display: inline-flex;
          align-items: center;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 600;
        }
        .cb-badge-live { color: #166534; background: #dcfce7; }
        .cb-badge-draft { color: #6b7280; background: #f3f4f6; }
        .cb-badge-combo { color: #1d4ed8; background: #dbeafe; }
        .cb-badge-single { color: #6b7280; background: #f3f4f6; }
        .cb-badge-gift { color: #7c3aed; background: #ede9fe; }
        .cb-action-btn {
          width: 32px; height: 32px;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          background: #fff;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #374151;
          transition: all 0.12s;
        }
        .cb-action-btn:hover { background: #f0fdf4; border-color: #2A7A4F; color: #2A7A4F; }
        .cb-action-btn.danger:hover { background: #fef2f2; border-color: #fca5a5; color: #dc2626; }
        .cb-drag-handle {
          color: #d1d5db;
          cursor: grab;
          font-size: 16px;
          line-height: 1;
          user-select: none;
          padding: 0 4px;
        }
        .cb-filter-bar {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 16px;
          border-bottom: 1px solid #e5e7eb;
          background: #fff;
          flex-wrap: wrap;
        }
        .cb-search {
          flex: 1;
          min-width: 180px;
          display: flex;
          align-items: center;
          gap: 8px;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          padding: 7px 12px;
          background: #f9fafb;
        }
        .cb-search input {
          border: none;
          outline: none;
          background: transparent;
          font-size: 13px;
          color: #111827;
          width: 100%;
        }
        .cb-search input::placeholder { color: #9ca3af; }
        .cb-filter-tabs {
          display: flex;
          gap: 4px;
        }
        .cb-filter-tab {
          padding: 6px 14px;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          background: #fff;
          font-size: 12px;
          font-weight: 500;
          color: #6b7280;
          cursor: pointer;
          transition: all 0.12s;
          white-space: nowrap;
        }
        .cb-filter-tab:hover { background: #f3f4f6; color: #111827; }
        .cb-filter-tab.active { background: #111827; color: #fff; border-color: #111827; font-weight: 600; }
        .cb-filter-tab.active-green { background: #dcfce7; color: #166534; border-color: #86efac; font-weight: 600; }
        .cb-filter-tab.active-gray { background: #f3f4f6; color: #374151; border-color: #d1d5db; font-weight: 600; }
        .cb-results-count { font-size: 12px; color: #9ca3af; white-space: nowrap; }
      `}</style>

      <ui-title-bar title={`Combo Boxes (${baseBoxes.length})`}>
        <button onClick={() => navigateTo("/app/storefront-visibility")}>
          Frontend Visibility
        </button>
        <button onClick={() => navigateTo("/app/boxes/specific-combo")}>
          Create Specific Combo
        </button>
        <button variant="primary" onClick={() => navigateTo("/app/boxes/new")}>
          + Create Box
        </button>
      </ui-title-bar>

      <s-section>
        {/* Filter bar */}
        <div className="cb-filter-bar">
          {/* Search */}
          <div className="cb-search">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0, color: "#9ca3af" }}>
              <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.8" />
              <path d="M14.5 14.5L18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              placeholder="Search boxes…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", padding: 0, lineHeight: 1, fontSize: "16px" }}
              >
                ×
              </button>
            )}
          </div>

          {/* Status filter tabs */}
          <div className="cb-filter-tabs">
            <button
              type="button"
              className={`cb-filter-tab ${statusFilter === "all" ? "active" : ""}`}
              onClick={() => setStatusFilter("all")}
            >
              All ({baseBoxes.length})
            </button>
            <button
              type="button"
              className={`cb-filter-tab ${statusFilter === "active" ? "active-green" : ""}`}
              onClick={() => setStatusFilter("active")}
            >
              Active ({baseBoxes.filter((b) => b.isActive).length})
            </button>
            <button
              type="button"
              className={`cb-filter-tab ${statusFilter === "inactive" ? "active-gray" : ""}`}
              onClick={() => setStatusFilter("inactive")}
            >
              Inactive ({baseBoxes.filter((b) => !b.isActive).length})
            </button>
          </div>

          {/* Result count when filtered */}
          {(search || statusFilter !== "all") && (
            <span className="cb-results-count">{displayBoxes.length} result{displayBoxes.length !== 1 ? "s" : ""}</span>
          )}
        </div>

        {displayBoxes.length === 0 ? (
          <div style={{ textAlign: "center", padding: "64px 0", color: "#9ca3af" }}>
            <div style={{ marginBottom: "16px", display: "flex", justifyContent: "center" }}>
              <AdminIcon type="package" size="large" tone="subdued" />
            </div>
            <p style={{ fontSize: "15px", fontWeight: "600", color: "#374151", margin: "0 0 6px" }}>
              No combo boxes yet
            </p>
            <p style={{ fontSize: "13px", margin: "0 0 20px", color: "#9ca3af" }}>
              Create your first box to let customers build custom combos.
            </p>
            <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
              <s-button onClick={() => navigateTo("/app/boxes/new")}>+ Create Box</s-button>
              <s-button onClick={() => navigateTo("/app/boxes/specific-combo")}>
                Specific Combo Box
              </s-button>
            </div>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cb-table">
              <thead>
                <tr>
                  {COLUMNS.map((col) => (
                    <th key={col}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayBoxes.map((box) => (
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
                    {/* Drag handle */}
                    <td style={{ width: "32px", padding: "12px 8px" }}>
                      <span className="cb-drag-handle" title="Drag to reorder">⠿</span>
                    </td>

                    {/* Box Name */}
                    <td style={{ minWidth: "200px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                        <span style={{ fontWeight: "600", color: "#111827" }}>{box.boxName}</span>
                        <span className={`cb-badge ${box.isActive ? "cb-badge-live" : "cb-badge-draft"}`}>
                          {box.isActive ? "Live" : "Draft"}
                        </span>
                        {box.isGiftBox && (
                          <span className="cb-badge cb-badge-gift">Gift</span>
                        )}
                      </div>
                      {box.displayTitle && box.displayTitle !== box.boxName && (
                        <div style={{ fontSize: "12px", color: "#9ca3af" }}>{box.displayTitle}</div>
                      )}
                    </td>

                    {/* Items */}
                    <td>
                      <span style={{ fontWeight: "600", color: "#374151" }}>{box.itemCount}</span>
                    </td>

                    {/* Price */}
                    <td>
                      {box.bundlePriceType === "dynamic" ? (
                        <span style={{ fontSize: "12px", color: "#6b7280" }}>Dynamic</span>
                      ) : (
                        <span style={{ fontWeight: "600", color: "#111827", fontFamily: "monospace" }}>
                          &#8377;{Number(box.bundlePrice).toLocaleString("en-IN")}
                        </span>
                      )}
                    </td>

                    {/* Type */}
                    <td>
                      {box.comboConfig && box.comboConfig.comboType > 0 ? (
                        <span className="cb-badge cb-badge-combo">
                          {box.comboConfig.comboType} Step
                        </span>
                      ) : (
                        <span className="cb-badge cb-badge-single">Single</span>
                      )}
                    </td>

                    {/* Orders */}
                    <td>
                      <span style={{ fontWeight: "600", color: box.orderCount > 0 ? "#111827" : "#d1d5db" }}>
                        {box.orderCount}
                      </span>
                    </td>

                    {/* Actions */}
                    <td>
                      <div style={{ display: "flex", gap: "6px", justifyContent: "center" }}>
                        <button
                          className="cb-action-btn"
                          title="Edit box"
                          onClick={() =>
                            navigateTo(
                              box.comboConfig
                                ? `/app/boxes/${box.id}/combo`
                                : `/app/boxes/${box.id}`
                            )
                          }
                        >
                          <AdminIcon type="edit" size="small" />
                        </button>
                        <button
                          className="cb-action-btn danger"
                          title="Delete box"
                          onClick={() => handleDelete(box.id, box.boxName)}
                        >
                          <AdminIcon type="delete" size="small" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </s-section>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(17,24,39,0.5)",
            backdropFilter: "blur(2px)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: "8px",
              width: "100%",
              maxWidth: "400px",
              boxShadow: "0 16px 48px rgba(0,0,0,0.18)",
            }}
          >
            <div style={{ padding: "20px 24px", borderBottom: "1px solid #f3f4f6" }}>
              <p style={{ fontSize: "15px", fontWeight: "700", color: "#111827", margin: 0 }}>
                Delete &ldquo;{deleteConfirm.name}&rdquo;?
              </p>
              <p style={{ fontSize: "13px", color: "#6b7280", margin: "4px 0 0" }}>
                This action cannot be undone. The associated Shopify product will also be removed.
              </p>
            </div>
            <div
              style={{
                padding: "16px 24px",
                display: "flex",
                gap: "8px",
                justifyContent: "flex-end",
              }}
            >
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                style={{
                  background: "#fff",
                  border: "1px solid #d1d5db",
                  borderRadius: "6px",
                  padding: "8px 16px",
                  fontSize: "13px",
                  fontWeight: "500",
                  cursor: "pointer",
                  color: "#374151",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                style={{
                  background: "#dc2626",
                  border: "none",
                  borderRadius: "6px",
                  padding: "8px 16px",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer",
                  color: "#fff",
                }}
              >
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
