const APP_NAME = "MixBox – Box & Bundle Builder";
const APP_LOGO = "https://combo-products.vercel.app/images/Bluk%20Bundle%20products%201.jpg";

/**
 * Owner alert email — new app install.
 * @param {{ ownerName: string, shopName: string, shopDomain: string, email: string, plan: string, country: string }} data
 */
export function ownerInstallNotifyHtml({ ownerName, shopName, shopDomain, email, plan, country }) {
  const installedAt = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });

  const rows = [
    ["🏪", "Store",   shopName || shopDomain],
    ["🌐", "Domain",  shopDomain],
    ["👤", "Owner",   ownerName || "—"],
    ["📧", "Email",   email || "—"],
    ["💼", "Plan",    plan || "—"],
    ["🌍", "Country", country || "—"],
    ["🕐", "Time",    `${installedAt} IST`],
  ];

  return /* html */ `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:36px 16px;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0"
      style="max-width:560px;width:100%;background:#fff;border-radius:14px;overflow:hidden;
             box-shadow:0 6px 28px rgba(0,0,0,0.09);">

      <!-- Logo -->
      <tr>
        <td style="padding:22px 40px 0;text-align:center;background:#fff;">
          <img src="${APP_LOGO}" alt="${APP_NAME}" width="150"
            style="max-width:150px;height:auto;border-radius:8px;" />
        </td>
      </tr>

      <!-- Header -->
      <tr>
        <td style="background:linear-gradient(135deg,#2A7A4F,#1b5c38);padding:28px 40px;text-align:center;">
          <div style="font-size:40px;margin-bottom:10px;">🎉</div>
          <h1 style="margin:0 0 6px;color:#fff;font-size:22px;font-weight:700;">New App Install!</h1>
          <p style="margin:0;color:rgba(255,255,255,0.85);font-size:14px;">
            A new merchant just installed <strong>${APP_NAME}</strong>
          </p>
        </td>
      </tr>

      <!-- Details table -->
      <tr>
        <td style="padding:32px 40px;">
          <p style="margin:0 0 20px;font-size:14px;font-weight:600;color:#374151;
                     text-transform:uppercase;letter-spacing:0.8px;">
            Install Details
          </p>
          <table width="100%" cellpadding="0" cellspacing="0"
            style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
            ${rows.map(([icon, label, value], i) => `
            <tr style="background:${i % 2 === 0 ? "#f9fafb" : "#ffffff"};">
              <td style="padding:11px 16px;font-size:13px;color:#6b7280;width:120px;white-space:nowrap;">
                ${icon} <strong style="color:#374151;">${label}</strong>
              </td>
              <td style="padding:11px 16px;font-size:13px;color:#111827;border-left:1px solid #e5e7eb;">
                ${value}
              </td>
            </tr>`).join("")}
          </table>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:18px 40px;text-align:center;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">
            ${APP_NAME} &nbsp;·&nbsp; Internal notification for ${process.env.APP_OWNER_NAME || "Pryxo Tech Pvt Ltd"}
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

/**
 * Owner alert email — app uninstalled.
 */
export function ownerUninstallNotifyHtml({ ownerName, shopName, shopDomain, email, plan, country }) {
  const uninstalledAt = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });

  const rows = [
    ["🏪", "Store",   shopName || shopDomain],
    ["🌐", "Domain",  shopDomain],
    ["👤", "Owner",   ownerName || "—"],
    ["📧", "Email",   email || "—"],
    ["💼", "Plan",    plan || "—"],
    ["🌍", "Country", country || "—"],
    ["🕐", "Time",    `${uninstalledAt} IST`],
  ];

  return /* html */ `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:36px 16px;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0"
      style="max-width:560px;width:100%;background:#fff;border-radius:14px;overflow:hidden;
             box-shadow:0 6px 28px rgba(0,0,0,0.09);">

      <!-- Logo -->
      <tr>
        <td style="padding:22px 40px 0;text-align:center;background:#fff;">
          <img src="${APP_LOGO}" alt="${APP_NAME}" width="150"
            style="max-width:150px;height:auto;border-radius:8px;" />
        </td>
      </tr>

      <!-- Header -->
      <tr>
        <td style="background:linear-gradient(135deg,#dc2626,#991b1b);padding:28px 40px;text-align:center;">
          <div style="font-size:40px;margin-bottom:10px;">⚠️</div>
          <h1 style="margin:0 0 6px;color:#fff;font-size:22px;font-weight:700;">App Uninstalled</h1>
          <p style="margin:0;color:rgba(255,255,255,0.85);font-size:14px;">
            A merchant has uninstalled <strong>${APP_NAME}</strong>
          </p>
        </td>
      </tr>

      <!-- Details table -->
      <tr>
        <td style="padding:32px 40px;">
          <p style="margin:0 0 20px;font-size:14px;font-weight:600;color:#374151;
                     text-transform:uppercase;letter-spacing:0.8px;">
            Uninstall Details
          </p>
          <table width="100%" cellpadding="0" cellspacing="0"
            style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
            ${rows.map(([icon, label, value], i) => `
            <tr style="background:${i % 2 === 0 ? "#fef2f2" : "#ffffff"};">
              <td style="padding:11px 16px;font-size:13px;color:#6b7280;width:120px;white-space:nowrap;">
                ${icon} <strong style="color:#374151;">${label}</strong>
              </td>
              <td style="padding:11px 16px;font-size:13px;color:#111827;border-left:1px solid #e5e7eb;">
                ${value}
              </td>
            </tr>`).join("")}
          </table>

          <!-- Action hint -->
          <table width="100%" cellpadding="0" cellspacing="0"
            style="background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;margin-top:20px;">
            <tr>
              <td style="padding:14px 18px;font-size:13px;color:#92400e;line-height:1.6;">
                💡 <strong>Tip:</strong> Consider reaching out to <em>${ownerName || "this merchant"}</em>
                to understand why they uninstalled and whether there's anything we can do to win
                them back.
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:18px 40px;text-align:center;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">
            ${APP_NAME} &nbsp;·&nbsp; Internal notification for ${process.env.APP_OWNER_NAME || "Pryxo Tech Pvt Ltd"}
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}
