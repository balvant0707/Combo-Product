import { Form, useActionData, useLoaderData } from "react-router";
import db from "../db.server";

function normalizeFeedbackText(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.slice(0, 2000);
}

export const loader = async ({ request }) => {
  const token = new URL(request.url).searchParams.get("token") || "";
  const normalizedToken = token.trim();

  if (!normalizedToken) {
    return { ok: false, error: "Invalid feedback link.", token: "" };
  }

  const row = await db.uninstallfeedback.findUnique({
    where: { feedbackToken: normalizedToken },
    select: {
      id: true,
      shop: true,
      feedbackText: true,
      feedbackSubmittedAt: true,
    },
  });

  if (!row) {
    return { ok: false, error: "This feedback link is invalid or expired.", token: normalizedToken };
  }

  return {
    ok: true,
    rowId: row.id,
    token: normalizedToken,
    shop: row.shop,
    submitted: Boolean(row.feedbackSubmittedAt),
    feedbackText: row.feedbackText || "",
  };
};

export const action = async ({ request }) => {
  const formData = await request.formData();
  const token = String(formData.get("token") || "").trim();
  const feedbackText = normalizeFeedbackText(formData.get("feedbackText"));

  if (!token) {
    return { ok: false, submitted: false, error: "Invalid feedback token." };
  }

  if (!feedbackText) {
    return { ok: false, submitted: false, error: "Please enter your feedback before submitting." };
  }

  try {
    const existing = await db.uninstallfeedback.findUnique({
      where: { feedbackToken: token },
      select: { id: true },
    });
    if (!existing?.id) {
      return { ok: false, submitted: false, error: "This feedback link is invalid or expired." };
    }

    await db.uninstallfeedback.update({
      where: { id: existing.id },
      data: {
        feedbackText,
        feedbackSubmittedAt: new Date(),
      },
    });
  } catch (error) {
    console.error("[feedback.uninstall] failed to save feedback", error);
    return { ok: false, submitted: false, error: "Unable to save feedback. Please try again." };
  }

  return { ok: true, submitted: true };
};

export default function UninstallFeedbackPage() {
  const loaderData = useLoaderData();
  const actionData = useActionData();

  const submitted = Boolean(actionData?.submitted || (loaderData?.submitted && !actionData));
  const error = actionData?.error || loaderData?.error || null;
  const token = loaderData?.token || "";

  return (
    <main
      style={{
        minHeight: "100vh",
        margin: 0,
        background: "#f3f4f6",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        fontFamily: "Segoe UI, Arial, sans-serif",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: "640px",
          background: "#ffffff",
          border: "1px solid #e5e7eb",
          borderRadius: "10px",
          padding: "28px",
        }}
      >
        <h1 style={{ margin: "0 0 8px", fontSize: "24px", color: "#111827" }}>Share Your Feedback</h1>
        <p style={{ margin: "0 0 20px", color: "#4b5563", lineHeight: 1.5 }}>
          Your feedback helps us improve MixBox - Box & Bundle Builder.
        </p>

        {error && (
          <div
            style={{
              marginBottom: "16px",
              padding: "10px 12px",
              border: "1px solid #fecaca",
              background: "#fef2f2",
              color: "#991b1b",
              borderRadius: "6px",
              fontSize: "14px",
            }}
          >
            {error}
          </div>
        )}

        {submitted ? (
          <div
            style={{
              padding: "12px 14px",
              border: "1px solid #bbf7d0",
              background: "#f0fdf4",
              color: "#166534",
              borderRadius: "6px",
              fontSize: "14px",
            }}
          >
            Thank you. Your feedback was submitted successfully.
          </div>
        ) : loaderData?.ok ? (
          <Form method="post">
            <input type="hidden" name="token" value={token} />
            <label htmlFor="feedbackText" style={{ display: "block", marginBottom: "8px", fontWeight: 600, color: "#111827" }}>
              What made you uninstall the app?
            </label>
            <textarea
              id="feedbackText"
              name="feedbackText"
              rows={6}
              defaultValue={loaderData?.feedbackText || ""}
              maxLength={2000}
              placeholder="Please share your reason..."
              style={{
                width: "100%",
                resize: "vertical",
                border: "1px solid #d1d5db",
                borderRadius: "6px",
                padding: "10px 12px",
                fontSize: "14px",
                boxSizing: "border-box",
              }}
            />
            <button
              type="submit"
              style={{
                marginTop: "14px",
                border: "1px solid #111827",
                background: "#111827",
                color: "#ffffff",
                borderRadius: "6px",
                padding: "10px 16px",
                fontSize: "14px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Submit Feedback
            </button>
          </Form>
        ) : null}
      </section>
    </main>
  );
}
