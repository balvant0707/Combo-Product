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
    e.currentTarget.style.opacity = "0.5";
  }

  function onDragEnd(e) {
    e.currentTarget.style.opacity = "1";
  }

  function onDragOver(e) {
    e.preventDefault();
    e.currentTarget.style.background = "#f0ede4";
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
          <div style={{ textAlign: "center", padding: "48px 0", color: "#7a7670" }}>
            <div style={{ fontSize: "40px", marginBottom: "12px" }}>📦</div>
            <p style={{ marginBottom: "16px" }}>No combo boxes yet.</p>
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
                <tr style={{ background: "#f7f8fc" }}>
                  {["", "Box Name", "Items", "Price", "Gift Box", "Status", "Actions"].map(
                    (h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: "left",
                          padding: "10px 14px",
                          borderBottom: "1px solid #e5e1d8",
                          color: "#7a7670",
                          fontFamily: "monospace",
                          fontSize: "11px",
                          textTransform: "uppercase",
                          letterSpacing: "1px",
                          fontWeight: "400",
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
                    style={{ transition: "background 0.1s", cursor: "default" }}
                  >
                    <td
                      style={{
                        padding: "12px 14px",
                        borderBottom: "1px solid #f0ede4",
                        color: "#9ca3af",
                        cursor: "grab",
                        fontSize: "16px",
                      }}
                    >
                      ⠿
                    </td>
                    <td style={{ padding: "12px 14px", borderBottom: "1px solid #f0ede4", fontWeight: "600", color: "#1a1814" }}>
                      {box.boxName}
                    </td>
                    <td style={{ padding: "12px 14px", borderBottom: "1px solid #f0ede4", color: "#374151" }}>
                      {box.itemCount}
                    </td>
                    <td style={{ padding: "12px 14px", borderBottom: "1px solid #f0ede4", color: "#374151" }}>
                      ₹{Number(box.bundlePrice).toLocaleString("en-IN")}
                    </td>
                    <td style={{ padding: "12px 14px", borderBottom: "1px solid #f0ede4", color: box.isGiftBox ? "#059669" : "#9ca3af" }}>
                      {box.isGiftBox ? "Yes" : "No"}
                    </td>
                    <td style={{ padding: "12px 14px", borderBottom: "1px solid #f0ede4" }}>
                      <span
                        onClick={() => handleToggleStatus(box.id, box.isActive)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "5px",
                          padding: "3px 10px",
                          borderRadius: "20px",
                          fontSize: "11px",
                          fontFamily: "monospace",
                          cursor: "pointer",
                          background: box.isActive ? "rgba(5,150,105,.1)" : "rgba(120,120,140,.1)",
                          color: box.isActive ? "#059669" : "#6b7280",
                          border: box.isActive ? "1px solid rgba(5,150,105,.2)" : "1px solid #e5e1d8",
                        }}
                      >
                        {box.isActive ? "● Active" : "○ Inactive"}
                      </span>
                    </td>
                    <td style={{ padding: "12px 14px", borderBottom: "1px solid #f0ede4" }}>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button
                          onClick={() => navigate(`/app/boxes/${box.id}`)}
                          style={{
                            background: "transparent",
                            border: "1px solid #e5e1d8",
                            borderRadius: "5px",
                            padding: "4px 12px",
                            fontSize: "12px",
                            cursor: "pointer",
                            color: "#374151",
                          }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(box.id, box.boxName)}
                          style={{
                            background: "transparent",
                            border: "1px solid #fca5a5",
                            borderRadius: "5px",
                            padding: "4px 12px",
                            fontSize: "12px",
                            cursor: "pointer",
                            color: "#e11d48",
                          }}
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
