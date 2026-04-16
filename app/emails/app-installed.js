const APP_NAME = "MixBox – Box & Bundle Builder";
const APP_LOGO = "cid:mixbox-logo";

/**
 * Generates the HTML for the app-installed welcome email.
 * @param {{ ownerName: string, shopName: string, shopDomain: string }} data
 */
export function installedEmailHtml({ ownerName, shopName, shopDomain }) {
  const firstName = ownerName ? ownerName.split(" ")[0] : "there";
  const appUrl = process.env.SHOPIFY_APP_URL || "https://apps.shopify.com";
  const ownerCompany = process.env.APP_OWNER_NAME || "Pryxo Tech Private Limited";

  return /* html */ `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to ${APP_NAME}</title>
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
            <td style="background:#ffffff;padding:24px 48px 0;text-align:center;border-bottom:0;">
              <img src="${APP_LOGO}"
                alt="${APP_NAME} logo"
                width="180"
                style="max-width:180px;height:auto;display:inline-block;border-radius:10px;" />
            </td>
          </tr>

          <!-- Hero header -->
          <tr>
            <td style="background:linear-gradient(135deg,#2A7A4F 0%,#1b5c38 100%);
                       padding:36px 48px 32px;text-align:center;">
              <h1 style="margin:0 0 8px;color:#ffffff;font-size:26px;font-weight:700;
                         text-shadow:0 1px 3px rgba(0,0,0,0.2);">
                Welcome to ${APP_NAME}!
              </h1>
              <p style="margin:0;font-size:15px;line-height:1.5;">
                Your app has been successfully installed 🎉
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
                Thank you for installing <strong>${APP_NAME}</strong> on
                <strong>${shopName || shopDomain}</strong>. We're thrilled to have you on board!
              </p>
              <p style="margin:0 0 32px;font-size:15px;color:#4b5563;line-height:1.75;">
                Create stunning mix &amp; bundle boxes that let your customers pick their favourite
                products and bundle them at a special price — all powered by a beautiful, fully
                customisable widget on your storefront.
              </p>

              <!-- Feature cards -->
              <table width="100%" cellpadding="0" cellspacing="0"
                style="background:#f0fdf4;border:1px solid #86efac;border-radius:12px;margin-bottom:32px;">
                <tr>
                  <td style="padding:24px 28px;">
                    <p style="margin:0 0 16px;font-size:12px;font-weight:700;color:#166534;
                               text-transform:uppercase;letter-spacing:1px;">
                      ✦ What you can do
                    </p>
                    <table cellpadding="0" cellspacing="0" width="100%">
                      ${[
                        ["📦", "Create unlimited mix &amp; bundle boxes with custom pricing"],
                        ["🖼️", "Add banner images and step-by-step product pickers"],
                        ["🎁", "Enable gift box mode with personalised gift messages"],
                        ["📊", "Track bundle orders with built-in analytics"],
                        ["🎨", "Customise widget colours to perfectly match your brand"],
                      ].map(([icon, text]) => `
                      <tr>
                        <td style="padding:6px 0;vertical-align:top;width:30px;font-size:17px;">${icon}</td>
                        <td style="padding:6px 0;font-size:14px;color:#374151;line-height:1.55;">${text}</td>
                      </tr>`).join("")}
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Steps -->
              <p style="margin:0 0 18px;font-size:15px;font-weight:600;color:#111827;">
                Get started in 3 easy steps:
              </p>

              ${[
                ["1", "Create your first Mix Box",
                  "Go to <em>Mix Boxes → New Box</em> and configure your products, pricing, and display settings."],
                ["2", "Add the App Block to your theme",
                  "In Shopify Admin → Online Store → Themes, add the <em>MixBox Builder</em> block to any product or collection page."],
                ["3", "Go live and start selling!",
                  "Activate your box — customers can instantly pick products and add the bundle to cart."],
              ].map(([num, title, desc]) => `
              <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:16px;">
                <tr>
                  <td style="vertical-align:top;width:38px;padding-top:1px;">
                    <div style="background:#2A7A4F;color:#fff;border-radius:50%;width:30px;height:30px;
                                line-height:30px;text-align:center;font-size:13px;font-weight:700;">
                      ${num}
                    </div>
                  </td>
                  <td style="padding-left:14px;vertical-align:top;">
                    <p style="margin:2px 0 5px;font-size:14px;font-weight:600;color:#111827;">${title}</p>
                    <p style="margin:0;font-size:13px;color: #000000;line-height:1.65;">${desc}</p>
                  </td>
                </tr>
              </table>`).join("")}

              <!-- CTA -->
              <div style="text-align:center;margin:36px 0 30px;">
                <a href="${appUrl}"
                  style="display:inline-block;background:#2A7A4F;color:#ffffff;text-decoration:none;
                         padding:15px 40px;border-radius:10px;font-size:15px;font-weight:700;
                         letter-spacing:0.2px;box-shadow:0 4px 16px rgba(42,122,79,0.4);">
                  Open ${APP_NAME} →
                </a>
              </div>

              <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6;text-align:center;">
                Need help? Reply to this email — we're happy to assist.
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
              <p style="margin:0 0 4px;font-size:12px;color: #000000;">
                A Shopify App by <strong>${ownerCompany}</strong>
              </p>
              <p style="margin:0;font-size:11px;color:#9ca3af;">
                You received this email because <em>${shopDomain}</em> installed the app.
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
