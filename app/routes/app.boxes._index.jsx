import { useState } from "react";
import { useFetcher, useLoaderData, useLocation, useNavigate } from "react-router";
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
} from "../models/boxes.server";
import { withEmbeddedAppParams } from "../utils/embedded-app";

function getComboConfigSummary(box) {
  if (box.config) {
    return {
      comboType: box.config.comboType,
      title: box.config.title,
      isActive: box.config.isActive,
      stepsJson: box.config.stepsJson,
    };
  }

  if (!box.comboStepsConfig) return null;

  try {
    const parsed = JSON.parse(box.comboStepsConfig);
    const steps = Array.isArray(parsed?.steps) ? parsed.steps : [];
    return {
      comboType: parseInt(parsed?.type) || 0,
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

  // Fire-and-forget: activate any DRAFT bundle products left from before the fix
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

  if (intent === "toggle_status") {
    const id = formData.get("id");
    const isActive = formData.get("isActive") === "true";
    await toggleBoxStatus(id, shop, isActive);
    return { ok: true };
  }

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

  const [deleteConfirm, setDeleteConfirm] = useState(null); // { id, name }

  function navigateTo(path) {
    navigate(withEmbeddedAppParams(path, location.search));
  }

  function handleToggleStatus(id, currentActive) {
    fetcher.submit(
      { _action: "toggle_status", id: String(id), isActive: String(!currentActive) },
      { method: "POST" },
    );
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

  // Drag & drop state
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

  const displayBoxes =
    fetcher.formData?.get("_action") === "delete"
      ? boxes.filter((b) => b.id !== parseInt(fetcher.formData.get("id")))
      : boxes;

  return (
    <s-page heading={`All Box Types (${displayBoxes.length})`}>
      <s-button
        slot="primary-action"
        onClick={() => navigateTo("/app/boxes/new")}
      >
        Create Combo Box
      </s-button>

      <s-button
        onClick={() => navigateTo("/app/boxes/specific-combo")}
        style={{ marginLeft: "8px", background: "#303030 !important", color: "#fff", borderRadius: "5px", padding: "8px 16px", fontSize: "14px", fontWeight: "600", boxShadow: "0 2px 8px rgba(42,122,79,0.24)", transition: "transform 0.12s, box-shadow 0.12s" }}
      >
        🎯 Create Specific Combo Box
      </s-button>

      {/* Hero banner */}
      <div style={{ marginBottom: "10px", borderRadius: "5px", background: "linear-gradient(135deg, #091fd6 0%, #c11a10 55%, #706cd3 100%)", boxShadow: "0 8px 32px rgba(9,31,214,0.22)", overflow: "hidden", position: "relative", padding: "24px 32px" }}>
        <div style={{ position: "absolute", top: "-40px", right: "-40px", width: "180px", height: "180px", borderRadius: "50%", background: "rgba(255,255,255,0.05)", pointerEvents: "none" }} />
        <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(255,255,255,0.15)", backdropFilter: "blur(4px)", borderRadius: "999px", padding: "4px 14px", fontSize: "10px", fontWeight: "800", letterSpacing: "0.10em", textTransform: "uppercase", color: "#d1fae5", marginBottom: "10px" }}>
          📦 Combo Boxes
        </div>
        <div style={{ fontSize: "18px", fontWeight: "800", color: "#fff", letterSpacing: "-0.5px" }}>Manage your combo box types</div>
        <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.65)", marginTop: "4px" }}>Create, activate, and reorder combo boxes shown on your storefront.</div>
      </div>

      <s-section>
        {displayBoxes.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "64px 0",
              color: "#9ca3af",
            }}
          >
            <div
              style={{
                width: "64px",
                height: "64px",
                borderRadius: "5px",
                background: "rgba(42,122,79,0.08)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "30px",
                margin: "0 auto 16px",
              }}
            >
              📦
            </div>
            <p style={{ fontSize: "15px", fontWeight: "600", color: "#374151", margin: "0 0 6px" }}>
              No combo boxes yet
            </p>
            <p style={{ fontSize: "13px", margin: "0 0 20px", color: "#9ca3af" }}>
              Create your first box to let customers build custom combos.
            </p>
            <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}>
              <s-button onClick={() => navigateTo("/app/boxes/new")}>
                + Create New Box
              </s-button>
              <s-button onClick={() => navigateTo("/app/boxes/specific-combo")}>
                🎯 Specific Combo Box
              </s-button>
            </div>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}
            >
              <thead>
                <tr style={{ background: "#f9fafb" }}>
                  {["", "Box Name", "Items", "Price", "Gift", "Combo", "Orders", "Status", "Actions"].map(
                    (h) => (
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
                          whiteSpace: "nowrap",
                        }}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {displayBoxes.map((box, idx) => (
                  <tr
                    key={box.id}
                    data-box-id={box.id}
                    draggable
                    onDragStart={(e) => onDragStart(e, box.id)}
                    onDragEnd={onDragEnd}
                    onDragOver={onDragOver}
                    onDragLeave={onDragLeave}
                    onDrop={(e) => onDrop(e, box.id)}
                    style={{
                      background: idx % 2 === 0 ? "#fff" : "#fafafa",
                      transition: "background 0.12s",
                      cursor: "default",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#f8faff")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = idx % 2 === 0 ? "#fff" : "#fafafa")}
                  >
                    {/* Drag handle */}
                    <td
                      style={{
                        padding: "14px 8px 14px 16px",
                        borderBottom: "1px solid #f3f4f6",
                        color: "#d1d5db",
                        cursor: "grab",
                        fontSize: "18px",
                        lineHeight: 1,
                        userSelect: "none",
                      }}
                      title="Drag to reorder"
                    >
                      ⠿
                    </td>

                    {/* Box name + subtitle */}
                    <td style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6" }}>
                      <div style={{ fontWeight: "700", color: "#111827", marginBottom: "2px" }}>
                        {box.boxName}
                      </div>
                      {box.displayTitle !== box.boxName && (
                        <div style={{ fontSize: "11px", color: "#9ca3af" }}>
                          {box.displayTitle}
                        </div>
                      )}
                    </td>

                    {/* Items */}
                    <td style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6" }}>
                      <span
                        style={{
                          display: "inline-block",
                          background: "#f3f4f6",
                          borderRadius: "5px",
                          padding: "2px 8px",
                          fontSize: "12px",
                          fontWeight: "600",
                          color: "#374151",
                          fontFamily: "monospace",
                        }}
                      >
                        {box.itemCount}
                      </span>
                    </td>

                    {/* Price */}
                    <td style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6" }}>
                      <span style={{ fontFamily: "monospace", fontWeight: "700", color: "#2A7A4F" }}>
                        &#8377;{Number(box.bundlePriceType === "dynamic" ? 0 : box.bundlePrice).toLocaleString("en-IN")}
                      </span>
                    </td>

                    {/* Gift */}
                    <td style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6" }}>
                      {box.isGiftBox ? (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            fontSize: "11px",
                            fontWeight: "600",
                            color: "#7c3aed",
                            background: "rgba(124,58,237,0.08)",
                            padding: "2px 8px",
                            borderRadius: "5px",
                          }}
                        >
                          Yes
                        </span>
                      ) : (
                        <span style={{ color: "#d1d5db", fontSize: "12px" }}>—</span>
                      )}
                    </td>

                    {/* Combo config */}
                    <td style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6" }}>
                      {box.comboConfig ? (() => {
                        const cfg = box.comboConfig;
                        let stepsCount = 0;
                        stepsCount = cfg.comboType || 0;
                        return (
                          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", fontWeight: "700", background: "linear-gradient(135deg, #091fd6 0%, #c11a10 55%, #706cd3 100%)", color: "#fff", padding: "2px 8px", borderRadius: "5px", width: "fit-content" }}>
                              {stepsCount}-Step Combo
                            </span>
                            {cfg.title && (
                              <span style={{ fontSize: "11px", color: "#6b7280", maxWidth: "140px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cfg.title}</span>
                            )}
                            <span style={{ fontSize: "10px", fontWeight: "600", color: cfg.isActive ? "#059669" : "#9ca3af" }}>
                              {cfg.isActive ? "● Active" : "● Inactive"}
                            </span>
                          </div>
                        );
                      })() : (
                        <span style={{ color: "#d1d5db", fontSize: "12px" }}>—</span>
                      )}
                    </td>

                    {/* Orders */}
                    <td style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6" }}>
                      <span style={{ fontFamily: "monospace", fontWeight: "600", color: box.orderCount > 0 ? "#111827" : "#d1d5db" }}>
                        {box.orderCount > 0 ? box.orderCount : "—"}
                      </span>
                    </td>

                    {/* Status toggle */}
                    <td style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6" }}>
                      <button
                        onClick={() => handleToggleStatus(box.id, box.isActive)}
                        title={box.isActive ? "Click to deactivate" : "Click to activate"}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "5px",
                          padding: "4px 10px",
                          borderRadius: "5px",
                          fontSize: "11px",
                          fontWeight: "600",
                          cursor: "pointer",
                          border: "none",
                          background: box.isActive ? "rgba(5,150,105,0.1)" : "rgba(156,163,175,0.15)",
                          color: box.isActive ? "#059669" : "#6b7280",
                          transition: "opacity 0.12s",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.75")}
                        onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
                      >
                        <span
                          style={{
                            width: "6px",
                            height: "6px",
                            borderRadius: "50%",
                            background: box.isActive ? "#059669" : "#9ca3af",
                            display: "inline-block",
                            flexShrink: 0,
                          }}
                        />
                        {box.isActive ? "Active" : "Inactive"}
                      </button>
                    </td>

                    {/* Actions */}
                    <td style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6" }}>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button
                          onClick={() => navigateTo(box.comboConfig ? `/app/boxes/${box.id}/combo` : `/app/boxes/${box.id}`)}
                          style={{
                            background: "#f9fafb",
                            border: "1px solid #e5e7eb",
                            borderRadius: "5px",
                            padding: "5px 14px",
                            fontSize: "12px",
                            fontWeight: "500",
                            cursor: "pointer",
                            color: "#374151",
                            transition: "background 0.12s, border-color 0.12s",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = "#f3f4f6";
                            e.currentTarget.style.borderColor = "#d1d5db";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = "#f9fafb";
                            e.currentTarget.style.borderColor = "#e5e7eb";
                          }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(box.id, box.boxName)}
                          style={{
                            background: "#fff5f5",
                            border: "1px solid #fecaca",
                            borderRadius: "5px",
                            padding: "5px 14px",
                            fontSize: "12px",
                            fontWeight: "500",
                            cursor: "pointer",
                            color: "#dc2626",
                            transition: "background 0.12s",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "#fee2e2")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "#fff5f5")}
                        >
                          Delete
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

      {/* ── Delete Confirmation Modal ── */}
      {deleteConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.55)", backdropFilter: "blur(3px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
          <div style={{ background: "#fff", borderRadius: "10px", width: "100%", maxWidth: "420px", boxShadow: "0 20px 60px rgba(0,0,0,0.2)", overflow: "hidden" }}>
            {/* Header */}
            <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #f3f4f6" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{ width: "40px", height: "40px", borderRadius: "50%", background: "#fef2f2", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <span style={{ fontSize: "18px" }}>🗑️</span>
                </div>
                <div>
                  <div style={{ fontSize: "15px", fontWeight: "700", color: "#111827" }}>Delete Box</div>
                  <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "2px" }}>This action cannot be undone</div>
                </div>
              </div>
            </div>
            {/* Body */}
            <div style={{ padding: "20px 24px" }}>
              <p style={{ fontSize: "13px", color: "#374151", margin: 0, lineHeight: "1.6" }}>
                Are you sure you want to delete <strong style={{ color: "#111827" }}>&ldquo;{deleteConfirm.name}&rdquo;</strong>?
                <br />
                <span style={{ color: "#dc2626", fontSize: "12px" }}>The associated Shopify product will also be removed.</span>
              </p>
            </div>
            {/* Footer */}
            <div style={{ padding: "12px 24px 20px", display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                style={{ background: "#fff", border: "1.5px solid #d1d5db", borderRadius: "6px", padding: "8px 20px", fontSize: "13px", fontWeight: "600", cursor: "pointer", color: "#374151" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f9fafb")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                style={{ background: "#dc2626", border: "none", borderRadius: "6px", padding: "8px 20px", fontSize: "13px", fontWeight: "700", cursor: "pointer", color: "#fff" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#b91c1c")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#dc2626")}
              >
                Yes, Delete
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
