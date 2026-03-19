import { useState, useEffect, useRef } from "react";
import { useFetcher, useLoaderData, useLocation, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  listBoxes,
  deleteBox,
  toggleBoxStatus,
  assignBoxPage,
  reorderBoxes,
  activateAllBundleProducts,
  repairMissingShopifyProducts,
  repairMissingShopifyVariantIds,
  upsertComboConfig,
} from "../models/boxes.server";
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

  // Fetch Shopify pages for the page-assignment dropdown
  let shopifyPages = [];
  try {
    const pagesRes = await admin.graphql(`
      query {
        pages(first: 100) {
          edges { node { id title handle } }
        }
      }
    `);
    const pagesData = await pagesRes.json();
    shopifyPages = (pagesData?.data?.pages?.edges || []).map((e) => ({
      title: e.node.title,
      handle: `page:${e.node.handle}`,
    }));
  } catch {}

  // Fire-and-forget: activate any DRAFT bundle products left from before the fix
  activateAllBundleProducts(session.shop, admin).catch(() => {});
  return {
    shopifyPages,
    boxes: boxes.map((b) => ({
      id: b.id,
      boxName: b.boxName,
      displayTitle: b.displayTitle,
      itemCount: b.itemCount,
      bundlePrice: parseFloat(b.bundlePrice),
      bundlePriceType: b.bundlePriceType || "manual",
      isGiftBox: b.isGiftBox,
      isActive: b.isActive,
      pageHandle: b.pageHandle || "",
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

  if (intent === "assign_page") {
    const id = formData.get("id");
    const pageHandle = formData.get("pageHandle") || null;
    await assignBoxPage(id, shop, pageHandle);
    return { ok: true };
  }

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
  const { boxes, shopifyPages } = useLoaderData();
  const location = useLocation();
  const navigate = useNavigate();
  const fetcher = useFetcher();

  const [deleteConfirm, setDeleteConfirm] = useState(null); // { id, name }
  const [savedPageBoxId, setSavedPageBoxId] = useState(null);
  const savedTimerRef = useRef(null);

  // Track when assign_page completes → show success badge
  const prevFetcherState = useRef(fetcher.state);
  useEffect(() => {
    if (
      prevFetcherState.current !== "idle" &&
      fetcher.state === "idle" &&
      fetcher.data?.ok &&
      fetcher.formData?.get("_action") === "assign_page"
    ) {
      const id = parseInt(fetcher.formData.get("id"));
      setSavedPageBoxId(id);
      clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSavedPageBoxId(null), 2500);
    }
    prevFetcherState.current = fetcher.state;
  }, [fetcher.state, fetcher.data]);

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

  function getPageLabel(handle, pages) {
    if (!handle) return "All pages";
    if (handle === "index") return "Home page";
    if (handle === "product") return "All product pages";
    if (handle === "collection") return "All collection pages";
    if (handle === "cart") return "Cart page";
    const found = pages.find((p) => p.handle === handle);
    if (found) return found.title;
    return handle;
  }

  const displayBoxes =
    fetcher.formData?.get("_action") === "delete"
      ? boxes.filter((b) => b.id !== parseInt(fetcher.formData.get("id")))
      : boxes;

  const toggleBoxId = fetcher.formData?.get("_action") === "toggle_status"
    ? parseInt(fetcher.formData.get("id")) : null;
  const toggleNewState = toggleBoxId !== null
    ? fetcher.formData.get("isActive") === "true" : null;

  return (
    <s-page heading={`All Box Types (${displayBoxes.length})`}>
      <style>{`@keyframes fadeIn { from { opacity:0; transform:scale(0.85); } to { opacity:1; transform:scale(1); } }`}</style>
      <ui-title-bar title={`All Box Types (${displayBoxes.length})`}>
        <button
          onClick={() => navigateTo("/app/storefront-visibility")}
        >
          👁 Frontend Visibility
        </button>
        <button
          onClick={() => navigateTo("/app/boxes/specific-combo")}
        >
          🎯 Create Specific Combo Box
        </button>
        <button
          variant="primary"
          onClick={() => navigateTo("/app/boxes/new")}
        >
          + Create Combo Box
        </button>
      </ui-title-bar>

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
                  {["", "Box Name", "Items", "Price", "Gift", "Combo", "Orders", "Actions"].map(
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

                    {/* Box name + page select + toggle */}
                    <td style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6", minWidth: "240px" }}>
                      {(() => {
                        const active = box.id === toggleBoxId ? toggleNewState : box.isActive;

                        const PAGE_OPTIONS = [
                          { label: "All pages", value: "" },
                          { label: "─────────────", value: "__sep1__", disabled: true },
                          { label: "Home page", value: "index" },
                          { label: "All product pages", value: "product" },
                          { label: "All collection pages", value: "collection" },
                          { label: "Cart page", value: "cart" },
                          ...(shopifyPages.length > 0 ? [{ label: "─────────────", value: "__sep2__", disabled: true }] : []),
                          ...shopifyPages.map((p) => ({ label: p.title, value: p.handle })),
                        ];

                        return (
                          <div>
                            {/* Row 1: name + toggle side by side */}
                            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
                              <div style={{ fontWeight: "700", color: active ? "#111827" : "#9ca3af", transition: "color 0.15s", minWidth: 0 }}>
                                {box.boxName}
                              </div>
                              {/* Toggle inline with name */}
                              <button
                                type="button"
                                onClick={() => fetcher.submit(
                                  { _action: "toggle_status", id: String(box.id), isActive: String(!active) },
                                  { method: "POST" }
                                )}
                                title={active ? "Click to disable" : "Click to enable"}
                                style={{
                                  position: "relative",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  width: "38px",
                                  height: "21px",
                                  borderRadius: "999px",
                                  background: active ? "#2A7A4F" : "#d1d5db",
                                  border: "none",
                                  cursor: "pointer",
                                  padding: 0,
                                  flexShrink: 0,
                                  transition: "background 0.2s",
                                  boxShadow: active ? "0 0 0 3px rgba(42,122,79,0.15)" : "none",
                                }}
                              >
                                <span style={{
                                  position: "absolute",
                                  width: "17px",
                                  height: "17px",
                                  borderRadius: "50%",
                                  background: "#fff",
                                  left: active ? "19px" : "2px",
                                  transition: "left 0.2s",
                                  boxShadow: "0 1px 4px rgba(0,0,0,0.22)",
                                }} />
                              </button>
                            </div>
                            {/* Row 2: subtitle */}
                            {box.displayTitle !== box.boxName && (
                              <div style={{ fontSize: "11px", color: "#9ca3af", marginBottom: "6px" }}>{box.displayTitle}</div>
                            )}
                            {/* Row 3: page select + current label + success msg */}
                            <select
                              value={box.pageHandle || ""}
                              onChange={(e) => fetcher.submit(
                                { _action: "assign_page", id: String(box.id), pageHandle: e.target.value },
                                { method: "POST" }
                              )}
                              style={{
                                fontSize: "11px",
                                padding: "4px 8px",
                                borderRadius: "6px",
                                border: "1px solid #e5e7eb",
                                background: "#f9fafb",
                                color: "#374151",
                                cursor: "pointer",
                                outline: "none",
                                maxWidth: "190px",
                                width: "100%",
                              }}
                            >
                              {PAGE_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>

                            {/* Current page label */}
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px" }}>
                              <span style={{
                                fontSize: "10px",
                                color: box.pageHandle ? "#2A7A4F" : "#9ca3af",
                                fontWeight: "600",
                              }}>
                                {box.pageHandle ? `📄 ${getPageLabel(box.pageHandle, shopifyPages)}` : "🌐 Showing on all pages"}
                              </span>
                              {/* Success badge */}
                              {savedPageBoxId === box.id && (
                                <span style={{
                                  fontSize: "10px",
                                  fontWeight: "700",
                                  color: "#fff",
                                  background: "#2A7A4F",
                                  padding: "1px 7px",
                                  borderRadius: "999px",
                                  animation: "fadeIn 0.2s ease",
                                }}>
                                  ✓ Saved successfully
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })()}
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
                        <span style={{ color: "#d1d5db", fontSize: "12px" }}>No</span>
                      )}
                    </td>

                    {/* Combo config */}
                    <td style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6" }}>
                      {box.comboConfig && box.comboConfig.comboType > 0 ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", fontWeight: "700", background: "linear-gradient(135deg, #091fd6 0%, #c11a10 55%, #706cd3 100%)", color: "#fff", padding: "2px 8px", borderRadius: "5px", width: "fit-content" }}>
                          {box.comboConfig.comboType} Step
                        </span>
                      ) : (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", fontWeight: "700", background: "linear-gradient(135deg, #091fd6 0%, #c11a10 55%, #706cd3 100%)", color: "#fff", padding: "2px 8px", borderRadius: "5px", width: "fit-content" }}>Single</span>
                      )}
                    </td>

                    {/* Orders */}
                    <td style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6" }}>
                      <span style={{ fontFamily: "monospace", fontWeight: "600", color: box.orderCount > 0 ? "#111827" : "#d1d5db" }}>
                        {box.orderCount > 0 ? box.orderCount : "No"}
                      </span>
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
