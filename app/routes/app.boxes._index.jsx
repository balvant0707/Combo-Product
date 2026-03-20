import { useState, useEffect, useRef } from "react";
import { useFetcher, useLoaderData, useLocation, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  listBoxes,
  deleteBox,
  assignBoxPage,
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

  return (
    <s-page heading={`All Box Types (${displayBoxes.length})`}>
      <style>{`
        @keyframes fadeIn { from { opacity:0; transform:scale(0.85); } to { opacity:1; transform:scale(1); } }
        @keyframes slideUp { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        .box-row { transition: box-shadow 0.15s, transform 0.15s; }
        .box-row:hover { box-shadow: 0 4px 16px rgba(42,122,79,0.10); transform: translateY(-1px); z-index: 1; position: relative; }
        .icon-btn { transition: background 0.13s, transform 0.1s, box-shadow 0.13s; }
        .icon-btn:active { transform: scale(0.92) !important; }
      `}</style>
      <ui-title-bar title={`All Box Types (${displayBoxes.length})`}>
        <button onClick={() => navigateTo("/app/storefront-visibility")}>
          <AdminIcon type="view" size="small" /> Frontend Visibility
        </button>
        <button onClick={() => navigateTo("/app/boxes/specific-combo")}>
          <AdminIcon type="target" size="small" /> Create Specific Combo Box
        </button>
        <button variant="primary" onClick={() => navigateTo("/app/boxes/new")}>
          + Create Combo Box
        </button>
      </ui-title-bar>

      {/* Hero banner */}
      <div style={{ marginBottom: "16px", borderRadius: "12px", background: "linear-gradient(135deg, #f0fdf4 0%, #ffffff 60%)", border: "1px solid #bbf7d0", boxShadow: "0 4px 20px rgba(42,122,79,0.08)", overflow: "hidden", position: "relative", padding: "24px 32px" }}>
        <div style={{ position: "absolute", top: "-50px", right: "-50px", width: "200px", height: "200px", borderRadius: "50%", background: "rgba(42,122,79,0.05)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: "-30px", right: "80px", width: "120px", height: "120px", borderRadius: "50%", background: "rgba(42,122,79,0.04)", pointerEvents: "none" }} />
        <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(42,122,79,0.10)", borderRadius: "999px", padding: "4px 14px", fontSize: "10px", fontWeight: "800", letterSpacing: "0.10em", textTransform: "uppercase", color: "#2A7A4F", marginBottom: "10px" }}>
          <AdminIcon type="package" size="small" /> Combo Boxes
        </div>
        <div style={{ fontSize: "20px", fontWeight: "800", color: "#111827", letterSpacing: "-0.5px" }}>Manage your combo box types</div>
        <div style={{ fontSize: "13px", color: "#4b5563", marginTop: "4px" }}>Create, activate, and reorder combo boxes shown on your storefront.</div>
        <div style={{ display: "flex", gap: "20px", marginTop: "14px" }}>
          {[
            { label: "Total Boxes", value: displayBoxes.length, icon: "package" },
            { label: "Total Orders", value: displayBoxes.reduce((s, b) => s + b.orderCount, 0), icon: "orders" },
            { label: "Gift Boxes", value: displayBoxes.filter((b) => b.isGiftBox).length, icon: "gift-card" },
          ].map((stat) => (
            <div key={stat.label} style={{ display: "flex", alignItems: "center", gap: "8px", background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "8px 14px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
              <AdminIcon type={stat.icon} size="base" tone="success" />
              <div>
                <div style={{ fontSize: "16px", fontWeight: "800", color: "#111827", lineHeight: 1 }}>{stat.value}</div>
                <div style={{ fontSize: "10px", color: "#6b7280", marginTop: "2px", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: "600" }}>{stat.label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <s-section>
        {displayBoxes.length === 0 ? (
          <div style={{ textAlign: "center", padding: "72px 0", color: "#9ca3af", animation: "slideUp 0.3s ease" }}>
            <div style={{ width: "72px", height: "72px", borderRadius: "16px", background: "linear-gradient(135deg, rgba(42,122,79,0.10), rgba(42,122,79,0.04))", border: "1px solid rgba(42,122,79,0.15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px", boxShadow: "0 4px 12px rgba(42,122,79,0.08)" }}>
              <AdminIcon type="package" size="large" tone="success" />
            </div>
            <p style={{ fontSize: "16px", fontWeight: "700", color: "#374151", margin: "0 0 6px" }}>No combo boxes yet</p>
            <p style={{ fontSize: "13px", margin: "0 0 24px", color: "#9ca3af" }}>Create your first box to let customers build custom combos.</p>
            <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}>
              <s-button onClick={() => navigateTo("/app/boxes/new")}>+ Create New Box</s-button>
              <s-button onClick={() => navigateTo("/app/boxes/specific-combo")}><AdminIcon type="target" size="small" /> Specific Combo Box</s-button>
            </div>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 4px", fontSize: "13px" }}>
              <thead>
                <tr>
                  {["", "Box Name", "Items", "Price", "Gift", "Combo", "Orders", "Actions"].map((h, i) => (
                    <th key={h} style={{ textAlign: i === 7 ? "center" : "left", padding: "8px 14px", color: "#6b7280", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.8px", fontWeight: "700", whiteSpace: "nowrap", borderBottom: "2px solid #e5e7eb", background: "transparent" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayBoxes.map((box, idx) => {
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
                    <tr
                      key={box.id}
                      className="box-row"
                      data-box-id={box.id}
                      draggable
                      onDragStart={(e) => onDragStart(e, box.id)}
                      onDragEnd={onDragEnd}
                      onDragOver={onDragOver}
                      onDragLeave={onDragLeave}
                      onDrop={(e) => onDrop(e, box.id)}
                      style={{ background: "#ffffff", cursor: "default" }}
                    >
                      {/* Drag handle */}
                      <td style={{ padding: "0 6px 0 14px", borderTop: "1px solid #f0f0f0", borderBottom: "1px solid #f0f0f0", borderLeft: "1px solid #f0f0f0", borderRadius: "8px 0 0 8px", color: "#c4c4c4", cursor: "grab", fontSize: "16px", lineHeight: 1, userSelect: "none", verticalAlign: "middle", width: "32px" }} title="Drag to reorder">
                        ⠿
                      </td>

                      {/* Status accent bar */}
                      <td style={{ padding: "14px 14px", borderTop: "1px solid #f0f0f0", borderBottom: "1px solid #f0f0f0", minWidth: "240px", verticalAlign: "middle" }}>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                          {/* Color accent */}
                          <div style={{ width: "3px", minHeight: "48px", borderRadius: "4px", background: box.isActive ? "#2A7A4F" : "#d1d5db", flexShrink: 0, marginTop: "2px" }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "3px" }}>
                              <span style={{ fontWeight: "700", color: "#111827", fontSize: "13px" }}>{box.boxName}</span>
                              {box.isActive ? (
                                <span style={{ fontSize: "9px", fontWeight: "700", color: "#2A7A4F", background: "rgba(42,122,79,0.10)", padding: "1px 7px", borderRadius: "999px", letterSpacing: "0.05em", textTransform: "uppercase" }}>Live</span>
                              ) : (
                                <span style={{ fontSize: "9px", fontWeight: "700", color: "#9ca3af", background: "#f3f4f6", padding: "1px 7px", borderRadius: "999px", letterSpacing: "0.05em", textTransform: "uppercase" }}>Draft</span>
                              )}
                            </div>
                            {box.displayTitle !== box.boxName && (
                              <div style={{ fontSize: "11px", color: "#9ca3af", marginBottom: "6px" }}>{box.displayTitle}</div>
                            )}
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <select
                                value={box.pageHandle || ""}
                                onChange={(e) => fetcher.submit(
                                  { _action: "assign_page", id: String(box.id), pageHandle: e.target.value },
                                  { method: "POST" }
                                )}
                                style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "6px", border: "1px solid #e5e7eb", background: "#f9fafb", color: "#374151", cursor: "pointer", outline: "none", maxWidth: "190px" }}
                              >
                                {PAGE_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value} disabled={opt.disabled}>{opt.label}</option>
                                ))}
                              </select>
                              {savedPageBoxId === box.id && (
                                <span style={{ fontSize: "10px", fontWeight: "700", color: "#fff", background: "#2A7A4F", padding: "1px 8px", borderRadius: "999px", animation: "fadeIn 0.2s ease" }}>
                                  Saved ✓
                                </span>
                              )}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "3px" }}>
                              <AdminIcon type={box.pageHandle ? "page" : "globe"} size="small" />
                              <span style={{ fontSize: "10px", color: box.pageHandle ? "#374151" : "#9ca3af", fontWeight: "500" }}>
                                {box.pageHandle ? getPageLabel(box.pageHandle, shopifyPages) : "All pages"}
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Items */}
                      <td style={{ padding: "14px 14px", borderTop: "1px solid #f0f0f0", borderBottom: "1px solid #f0f0f0", verticalAlign: "middle" }}>
                        <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "32px", height: "32px", borderRadius: "8px", background: "linear-gradient(135deg, #f0fdf4, #dcfce7)", border: "1px solid #bbf7d0", fontWeight: "800", fontSize: "13px", color: "#2A7A4F", fontFamily: "monospace" }}>
                          {box.itemCount}
                        </div>
                      </td>

                      {/* Price */}
                      <td style={{ padding: "14px 14px", borderTop: "1px solid #f0f0f0", borderBottom: "1px solid #f0f0f0", verticalAlign: "middle" }}>
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          <span style={{ fontFamily: "monospace", fontWeight: "800", color: "#111827", fontSize: "14px" }}>
                            {box.bundlePriceType === "dynamic" ? (
                              <span style={{ fontSize: "11px", fontWeight: "600", color: "#6b7280", fontFamily: "inherit" }}>Dynamic</span>
                            ) : (
                              <>&#8377;{Number(box.bundlePrice).toLocaleString("en-IN")}</>
                            )}
                          </span>
                        </div>
                      </td>

                      {/* Gift */}
                      <td style={{ padding: "14px 14px", borderTop: "1px solid #f0f0f0", borderBottom: "1px solid #f0f0f0", verticalAlign: "middle" }}>
                        {box.isGiftBox ? (
                          <div style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", fontWeight: "600", color: "#7c3aed", background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.15)", padding: "3px 10px", borderRadius: "999px" }}>
                            <AdminIcon type="gift-card" size="small" />
                            Gift
                          </div>
                        ) : (
                          <div style={{ width: "20px", height: "20px", borderRadius: "50%", background: "#f3f4f6", border: "1.5px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <span style={{ color: "#d1d5db", fontSize: "10px", fontWeight: "800" }}>—</span>
                          </div>
                        )}
                      </td>

                      {/* Combo config */}
                      <td style={{ padding: "14px 14px", borderTop: "1px solid #f0f0f0", borderBottom: "1px solid #f0f0f0", verticalAlign: "middle" }}>
                        {box.comboConfig && box.comboConfig.comboType > 0 ? (
                          <div style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", fontWeight: "700", background: "#eff6ff", color: "#2563eb", border: "1px solid #bfdbfe", padding: "3px 10px", borderRadius: "999px" }}>
                            <AdminIcon type="list-bulleted" size="small" />
                            {box.comboConfig.comboType} Step
                          </div>
                        ) : (
                          <div style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", fontWeight: "700", background: "#f9fafb", color: "#6b7280", border: "1px solid #e5e7eb", padding: "3px 10px", borderRadius: "999px" }}>
                            Single
                          </div>
                        )}
                      </td>

                      {/* Orders */}
                      <td style={{ padding: "14px 14px", borderTop: "1px solid #f0f0f0", borderBottom: "1px solid #f0f0f0", verticalAlign: "middle" }}>
                        {box.orderCount > 0 ? (
                          <div style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontFamily: "monospace", fontWeight: "800", color: "#111827", fontSize: "13px" }}>
                            <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#2A7A4F", display: "inline-block" }} />
                            {box.orderCount}
                          </div>
                        ) : (
                          <span style={{ color: "#d1d5db", fontSize: "12px", fontWeight: "500" }}>0</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td style={{ padding: "14px 14px", borderTop: "1px solid #f0f0f0", borderBottom: "1px solid #f0f0f0", borderRight: "1px solid #f0f0f0", borderRadius: "0 8px 8px 0", verticalAlign: "middle" }}>
                        <div style={{ display: "flex", gap: "6px", justifyContent: "center" }}>
                          {/* Edit icon button */}
                          <button
                            className="icon-btn"
                            title="Edit box"
                            onClick={() => navigateTo(box.comboConfig ? `/app/boxes/${box.id}/combo` : `/app/boxes/${box.id}`)}
                            style={{ width: "34px", height: "34px", border: "1.5px solid #e5e7eb", borderRadius: "8px", background: "#ffffff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#374151", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = "#f0fdf4"; e.currentTarget.style.borderColor = "#2A7A4F"; e.currentTarget.style.color = "#2A7A4F"; e.currentTarget.style.boxShadow = "0 3px 8px rgba(42,122,79,0.18)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "#ffffff"; e.currentTarget.style.borderColor = "#e5e7eb"; e.currentTarget.style.color = "#374151"; e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.06)"; }}
                          >
                            <AdminIcon type="edit" size="small" />
                          </button>
                          {/* Delete icon button */}
                          <button
                            className="icon-btn"
                            title="Delete box"
                            onClick={() => handleDelete(box.id, box.boxName)}
                            style={{ width: "34px", height: "34px", border: "1.5px solid #fecaca", borderRadius: "8px", background: "#fff5f5", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#dc2626", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = "#fee2e2"; e.currentTarget.style.borderColor = "#fca5a5"; e.currentTarget.style.boxShadow = "0 3px 8px rgba(220,38,38,0.18)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "#fff5f5"; e.currentTarget.style.borderColor = "#fecaca"; e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)"; }}
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

      {/* ── Delete Confirmation Modal ── */}
      {deleteConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.55)", backdropFilter: "blur(3px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
          <div style={{ background: "#fff", borderRadius: "10px", width: "100%", maxWidth: "420px", boxShadow: "0 20px 60px rgba(0,0,0,0.2)", overflow: "hidden" }}>
            {/* Header */}
            <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #f3f4f6" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{ width: "40px", height: "40px", borderRadius: "50%", background: "#fef2f2", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <AdminIcon type="delete" size="base" />
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
