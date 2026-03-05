import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  listBoxes,
  deleteBox,
  toggleBoxStatus,
  reorderBoxes,
} from "../models/boxes.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const boxes = await listBoxes(session.shop);
  return {
    boxes: boxes.map((b) => ({
      id: b.id,
      boxName: b.boxName,
      displayTitle: b.displayTitle,
      itemCount: b.itemCount,
      bundlePrice: parseFloat(b.bundlePrice),
      isGiftBox: b.isGiftBox,
      isActive: b.isActive,
      sortOrder: b.sortOrder,
      orderCount: b._count?.orders ?? 0,
    })),
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
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
    await deleteBox(id, shop);
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
  const navigate = useNavigate();
  const fetcher = useFetcher();

  function handleToggleStatus(id, currentActive) {
    fetcher.submit(
      { _action: "toggle_status", id: String(id), isActive: String(!currentActive) },
      { method: "POST" },
    );
  }

  function handleDelete(id, name) {
    if (window.confirm(`Delete "${name}"? This cannot be undone.`)) {
      fetcher.submit({ _action: "delete", id: String(id) }, { method: "POST" });
    }
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
        onClick={() => navigate("/app/boxes/new")}
      >
        + Create New Box
      </s-button>

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
                borderRadius: "16px",
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
            <s-button onClick={() => navigate("/app/boxes/new")}>
              Create your first box
            </s-button>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}
            >
              <thead>
                <tr style={{ background: "#f9fafb" }}>
                  {["", "Box Name", "Items", "Price", "Gift", "Orders", "Status", "Actions"].map(
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
                          borderRadius: "6px",
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
                        &#8377;{Number(box.bundlePrice).toLocaleString("en-IN")}
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
                            borderRadius: "20px",
                          }}
                        >
                          Yes
                        </span>
                      ) : (
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
                          borderRadius: "20px",
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
                          onClick={() => navigate(`/app/boxes/${box.id}`)}
                          style={{
                            background: "#f9fafb",
                            border: "1px solid #e5e7eb",
                            borderRadius: "6px",
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
                            borderRadius: "6px",
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
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
