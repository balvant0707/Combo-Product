/**
 * Generates the HTML for the app-installed welcome email.
 * @param {{ ownerName: string, shopName: string, shopDomain: string }} data
 */
export function installedEmailHtml({ ownerName, shopName, shopDomain }) {
  const firstName = ownerName ? ownerName.split(" ")[0] : "there";
  const appUrl = process.env.SHOPIFY_APP_URL || "https://apps.shopify.com";

  return /* html */ `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to Combo Product Builder</title>
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
            <td style="background:linear-gradient(135deg,#2A7A4F 0%,#1d5c3a 100%);padding:40px 48px;text-align:center;">
              <div style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:50%;width:72px;height:72px;line-height:72px;font-size:36px;margin-bottom:16px;">
                🎁
              </div>
              <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;letter-spacing:-0.5px;">
                Welcome to Combo Product Builder!
              </h1>
              <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:15px;">
                Your app has been successfully installed
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
                Thank you for installing <strong>Combo Product Builder</strong> on
                <strong>${shopName || shopDomain}</strong>. We're thrilled to have you on board!
              </p>
              <p style="margin:0 0 28px;font-size:15px;color:#4b5563;line-height:1.7;">
                You can now create beautiful combo boxes that let your customers pick their favourite
                products and bundle them at a special price — all from a stunning, customisable widget
                right on your storefront.
              </p>

              <!-- What you can do -->
              <table width="100%" cellpadding="0" cellspacing="0"
                style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;margin-bottom:32px;">
                <tr>
                  <td style="padding:24px 28px;">
                    <p style="margin:0 0 16px;font-size:14px;font-weight:700;color:#166534;text-transform:uppercase;letter-spacing:0.5px;">
                      What you can do
                    </p>
                    <table cellpadding="0" cellspacing="0">
                      ${[
                        ["📦", "Create unlimited combo boxes with custom pricing"],
                        ["🖼️", "Add banner images and step-by-step product pickers"],
                        ["🎁", "Enable gift box mode with personalised gift messages"],
                        ["📊", "Track bundle orders with built-in analytics"],
                        ["🎨", "Customise widget colours to match your brand"],
                      ]
                        .map(
                          ([icon, text]) => `
                      <tr>
                        <td style="padding:5px 0;vertical-align:top;width:28px;font-size:18px;">${icon}</td>
                        <td style="padding:5px 0;font-size:14px;color:#374151;line-height:1.5;">${text}</td>
                      </tr>`
                        )
                        .join("")}
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Getting started steps -->
              <p style="margin:0 0 16px;font-size:15px;font-weight:600;color:#111827;">
                Get started in 3 steps:
              </p>
              ${[
                ["1", "#2A7A4F", "Create your first Combo Box", "Go to <em>Combo Boxes → New Box</em> and configure your products, pricing, and settings."],
                ["2", "#2A7A4F", "Add the App Block to your theme", "In Shopify Admin → Online Store → Themes, add the <em>Combo Builder</em> block to any page."],
                ["3", "#2A7A4F", "Go live!", "Activate your box and start selling — customers can pick products and add their bundle to cart instantly."],
              ]
                .map(
                  ([num, color, title, desc]) => `
              <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:14px;">
                <tr>
                  <td style="vertical-align:top;width:36px;">
                    <div style="background:${color};color:#fff;border-radius:50%;width:28px;height:28px;line-height:28px;text-align:center;font-size:13px;font-weight:700;">
                      ${num}
                    </div>
                  </td>
                  <td style="padding-left:12px;vertical-align:top;">
                    <p style="margin:2px 0 4px;font-size:14px;font-weight:600;color:#111827;">${title}</p>
                    <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;">${desc}</p>
                  </td>
                </tr>
              </table>`
                )
                .join("")}

              <!-- CTA Button -->
              <div style="text-align:center;margin:36px 0 28px;">
                <a href="${appUrl}"
                  style="display:inline-block;background:#2A7A4F;color:#ffffff;text-decoration:none;
                         padding:14px 36px;border-radius:8px;font-size:15px;font-weight:600;
                         letter-spacing:0.3px;box-shadow:0 4px 14px rgba(42,122,79,0.35);">
                  Open Combo Product Builder →
                </a>
              </div>

              <p style="margin:0;font-size:14px;color:#9ca3af;line-height:1.6;text-align:center;">
                Need help? Reply to this email or visit our support docs.
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
                You received this email because ${shopDomain} installed the app.
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
