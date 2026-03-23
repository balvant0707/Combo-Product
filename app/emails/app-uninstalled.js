/**
 * Generates the HTML for the app-uninstalled goodbye email.
 * @param {{ ownerName: string, shopName: string, shopDomain: string }} data
 */
export function uninstalledEmailHtml({ ownerName, shopName, shopDomain }) {
  const firstName = ownerName ? ownerName.split(" ")[0] : "there";
  const storeUrl = `https://${shopDomain}/admin/apps`;

  return /* html */ `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>We'll miss you — Combo Product Builder</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:'Segoe UI',Arial,sans-serif;">

  <!-- Wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0"
          style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#374151 0%,#1f2937 100%);padding:40px 48px;text-align:center;">
              <div style="display:inline-block;background:rgba(255,255,255,0.1);border-radius:50%;width:72px;height:72px;line-height:72px;font-size:36px;margin-bottom:16px;">
                😢
              </div>
              <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;letter-spacing:-0.5px;">
                We're sad to see you go
              </h1>
              <p style="margin:8px 0 0;color:rgba(255,255,255,0.75);font-size:15px;">
                Combo Product Builder has been uninstalled from your store
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 48px;">
              <p style="margin:0 0 20px;font-size:16px;color:#374151;line-height:1.6;">
                Hi <strong>${firstName}</strong>,
              </p>
              <p style="margin:0 0 20px;font-size:15px;color:#4b5563;line-height:1.7;">
                We noticed that <strong>Combo Product Builder</strong> has been uninstalled from
                <strong>${shopName || shopDomain}</strong>.
              </p>
              <p style="margin:0 0 28px;font-size:15px;color:#4b5563;line-height:1.7;">
                We're sorry to see you leave. If there was something we could have done better,
                we'd genuinely love to hear from you — your feedback helps us improve the app for
                everyone.
              </p>

              <!-- Feedback box -->
              <table width="100%" cellpadding="0" cellspacing="0"
                style="background:#fef9ec;border:1px solid #fde68a;border-radius:10px;margin-bottom:32px;">
                <tr>
                  <td style="padding:24px 28px;">
                    <p style="margin:0 0 10px;font-size:14px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:0.5px;">
                      💬 Why did you uninstall?
                    </p>
                    <p style="margin:0;font-size:14px;color:#78350f;line-height:1.6;">
                      Common reasons we hear — if any of these apply, let us know and we'll
                      try to help:
                    </p>
                    <ul style="margin:12px 0 0;padding-left:20px;font-size:14px;color:#78350f;line-height:1.9;">
                      <li>Had trouble setting up the app block</li>
                      <li>Didn't find the feature I needed</li>
                      <li>Performance or compatibility issue</li>
                      <li>Switched to a different solution</li>
                      <li>No longer need combo products</li>
                    </ul>
                  </td>
                </tr>
              </table>

              <!-- What you'll miss -->
              <p style="margin:0 0 16px;font-size:15px;font-weight:600;color:#111827;">
                What you had with Combo Product Builder:
              </p>
              ${[
                ["📦", "Custom combo boxes with flexible pricing"],
                ["🎨", "Brand-matched widget — colours, fonts, layout"],
                ["🎁", "Gift box mode with personalised messages"],
                ["📊", "Bundle order analytics and tracking"],
                ["⚙️", "Step-by-step product picker configuration"],
              ]
                .map(
                  ([icon, text]) => `
              <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:10px;">
                <tr>
                  <td style="width:28px;font-size:18px;vertical-align:middle;">${icon}</td>
                  <td style="font-size:14px;color:#4b5563;line-height:1.5;padding-left:8px;">${text}</td>
                </tr>
              </table>`
                )
                .join("")}

              <!-- Reinstall CTA -->
              <table width="100%" cellpadding="0" cellspacing="0"
                style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;margin:28px 0;text-align:center;">
                <tr>
                  <td style="padding:24px 28px;">
                    <p style="margin:0 0 6px;font-size:15px;font-weight:600;color:#166534;">
                      Changed your mind?
                    </p>
                    <p style="margin:0 0 18px;font-size:14px;color:#4b5563;">
                      You can reinstall the app any time — all your previous box configurations
                      will still be there waiting for you.
                    </p>
                    <a href="${storeUrl}"
                      style="display:inline-block;background:#2A7A4F;color:#ffffff;text-decoration:none;
                             padding:12px 30px;border-radius:8px;font-size:14px;font-weight:600;
                             box-shadow:0 4px 12px rgba(42,122,79,0.3);">
                      Reinstall App →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:14px;color:#9ca3af;line-height:1.6;text-align:center;">
                Have feedback? Just reply to this email — we read every message.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:24px 48px;text-align:center;">
              <p style="margin:0 0 6px;font-size:13px;color:#6b7280;">
                <strong style="color:#374151;">Combo Product Builder</strong> — Shopify App
              </p>
              <p style="margin:0;font-size:12px;color:#9ca3af;">
                You received this email because ${shopDomain} had the app installed.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
}
