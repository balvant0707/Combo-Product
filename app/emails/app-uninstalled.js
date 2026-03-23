const APP_NAME = "MixBox – Box & Bundle Builder";
const APP_LOGO = "https://combo-products.vercel.app/images/Bluk%20Bundle%20products%201.jpg";

/**
 * Generates the HTML for the app-uninstalled goodbye email.
 * @param {{ ownerName: string, shopName: string, shopDomain: string }} data
 */
export function uninstalledEmailHtml({ ownerName, shopName, shopDomain }) {
  const firstName = ownerName ? ownerName.split(" ")[0] : "there";
  const storeUrl = `https://${shopDomain}/admin/apps`;
  const ownerCompany = process.env.APP_OWNER_NAME || "Pryxo Tech Private Limited";

  return /* html */ `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>We'll miss you — ${APP_NAME}</title>
</head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:'Segoe UI',Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0"
          style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;
                 box-shadow:0 8px 32px rgba(0,0,0,0.10);">

          <!-- Logo bar -->
          <tr>
            <td style="background:#ffffff;padding:24px 48px 0;text-align:center;">
              <img src="${APP_LOGO}"
                alt="${APP_NAME} logo"
                width="180"
                style="max-width:180px;height:auto;display:inline-block;border-radius:10px;" />
            </td>
          </tr>

          <!-- Hero header -->
          <tr>
            <td style="background:linear-gradient(135deg,#1f2937 0%,#374151 100%);
                       padding:36px 48px 32px;text-align:center;">
              <div style="font-size:44px;margin-bottom:12px;">😢</div>
              <h1 style="margin:0 0 8px;color:#ffffff;font-size:26px;font-weight:700;letter-spacing:-0.4px;">
                We're sad to see you go
              </h1>
              <p style="margin:0;color:rgba(255,255,255,0.78);font-size:15px;">
                ${APP_NAME} has been uninstalled from your store
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 48px;">

              <p style="margin:0 0 18px;font-size:16px;color:#1f2937;font-weight:500;">
                Hi <strong>${firstName}</strong>,
              </p>
              <p style="margin:0 0 16px;font-size:15px;color:#4b5563;line-height:1.75;">
                We noticed that <strong>${APP_NAME}</strong> has been uninstalled from
                <strong>${shopName || shopDomain}</strong>.
              </p>
              <p style="margin:0 0 32px;font-size:15px;color:#4b5563;line-height:1.75;">
                We're genuinely sorry to see you leave. If there's anything we could have done
                better, we'd love to hear from you — every piece of feedback helps us make the
                app better for everyone.
              </p>

              <!-- Feedback reasons -->
              <table width="100%" cellpadding="0" cellspacing="0"
                style="background:#fffbeb;border:1px solid #fcd34d;border-radius:12px;margin-bottom:32px;">
                <tr>
                  <td style="padding:24px 28px;">
                    <p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#92400e;
                               text-transform:uppercase;letter-spacing:1px;">
                      💬 Why did you uninstall?
                    </p>
                    <p style="margin:0 0 10px;font-size:14px;color:#78350f;line-height:1.6;">
                      If any of these apply, just reply and we'll try to help:
                    </p>
                    <ul style="margin:0;padding-left:20px;font-size:14px;color:#78350f;line-height:2;">
                      <li>Had trouble setting up the app block</li>
                      <li>Didn't find the feature I needed</li>
                      <li>Performance or theme compatibility issue</li>
                      <li>Switched to a different solution</li>
                      <li>No longer need mix &amp; bundle products</li>
                    </ul>
                  </td>
                </tr>
              </table>

              <!-- What you had -->
              <p style="margin:0 0 16px;font-size:15px;font-weight:600;color:#111827;">
                What you had with ${APP_NAME}:
              </p>
              ${[
                ["📦", "Custom mix &amp; bundle boxes with flexible pricing"],
                ["🎨", "Brand-matched widget — colours, fonts, layout"],
                ["🎁", "Gift box mode with personalised messages"],
                ["📊", "Bundle order analytics and sales tracking"],
                ["⚙️", "Step-by-step product picker configuration"],
              ].map(([icon, text]) => `
              <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:11px;">
                <tr>
                  <td style="width:30px;font-size:17px;vertical-align:middle;">${icon}</td>
                  <td style="font-size:14px;color:#4b5563;line-height:1.55;padding-left:10px;">${text}</td>
                </tr>
              </table>`).join("")}

              <!-- Reinstall CTA -->
              <table width="100%" cellpadding="0" cellspacing="0"
                style="background:#f0fdf4;border:1px solid #86efac;border-radius:12px;
                       margin:28px 0;text-align:center;">
                <tr>
                  <td style="padding:26px 28px;">
                    <p style="margin:0 0 6px;font-size:15px;font-weight:700;color:#166534;">
                      Changed your mind?
                    </p>
                    <p style="margin:0 0 20px;font-size:14px;color:#4b5563;line-height:1.6;">
                      You can reinstall the app at any time — all your previous mix box
                      configurations will still be saved and waiting for you.
                    </p>
                    <a href="${storeUrl}"
                      style="display:inline-block;background:#2A7A4F;color:#ffffff;
                             text-decoration:none;padding:13px 32px;border-radius:10px;
                             font-size:14px;font-weight:700;
                             box-shadow:0 4px 14px rgba(42,122,79,0.35);">
                      Reinstall ${APP_NAME} →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6;text-align:center;">
                Have feedback? Simply reply to this email — we read every message.
              </p>

            </td>
          </tr>

          <!-- Divider -->
          <tr><td style="height:1px;background:#e5e7eb;"></td></tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;padding:22px 48px;text-align:center;">
              <p style="margin:0 0 4px;font-size:13px;color:#374151;font-weight:600;">
                ${APP_NAME}
              </p>
              <p style="margin:0 0 4px;font-size:12px;color:#6b7280;">
                A Shopify App by <strong>${ownerCompany}</strong>
              </p>
              <p style="margin:0;font-size:11px;color:#9ca3af;">
                You received this email because <em>${shopDomain}</em> had the app installed.
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
