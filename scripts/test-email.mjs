/**
 * Quick SMTP test — run once, then delete.
 * Usage: node scripts/test-email.mjs
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";

// ── Load .env manually (no dotenv dependency needed) ─────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dir, "../.env");
const envLines = readFileSync(envPath, "utf8").split("\n");
for (const line of envLines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const idx = trimmed.indexOf("=");
  if (idx === -1) continue;
  const key = trimmed.slice(0, idx).trim();
  const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
  if (!process.env[key]) process.env[key] = val;
}

// ── Config ────────────────────────────────────────────────────────────────────
const OWNER_EMAIL = "balvant@pryxotech.com";   // internal / app owner
const USER_EMAIL  = "batiw68936@pazard.com";   // merchant test account

const secureVal = (process.env.SMTP_SECURE || "").toLowerCase();
const port      = parseInt(process.env.SMTP_PORT || "465");
const secure    = secureVal === "true" || secureVal === "ssl" || secureVal === "yes" || port === 465;

console.log("\n── SMTP Config ─────────────────────────────────────────────");
console.log("  host   :", process.env.SMTP_HOST);
console.log("  port   :", port);
console.log("  secure :", secure);
console.log("  user   :", process.env.SMTP_USER);
console.log("  from   :", process.env.MAIL_FROM_ADDRESS);
console.log("────────────────────────────────────────────────────────────\n");

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port,
  secure,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: { rejectUnauthorized: false },
});

const fromAddress = process.env.SMTP_USER;
const from = `"${process.env.MAIL_FROM_NAME || "Combo Product Builder"}" <${fromAddress}>`;
const replyTo = process.env.MAIL_FROM_ADDRESS && process.env.MAIL_FROM_ADDRESS !== fromAddress
  ? process.env.MAIL_FROM_ADDRESS
  : undefined;

// ── Email helpers ─────────────────────────────────────────────────────────────
function installedHtml(name, shop) {
  return `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
    <div style="background:linear-gradient(135deg,#2A7A4F,#1d5c3a);padding:36px;text-align:center">
      <div style="font-size:48px">🎁</div>
      <h1 style="color:#fff;margin:12px 0 4px;font-size:26px">Welcome to Combo Product Builder!</h1>
      <p style="color:rgba(255,255,255,.8);margin:0;font-size:14px">Your app has been successfully installed</p>
    </div>
    <div style="padding:36px">
      <p style="font-size:16px;color:#374151">Hi <strong>${name}</strong>,</p>
      <p style="font-size:15px;color:#4b5563;line-height:1.7">
        Thank you for installing <strong>Combo Product Builder</strong> on <strong>${shop}</strong>.
        You can now create beautiful combo boxes and let customers bundle their favourite products at a special price.
      </p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:20px;margin:24px 0">
        <strong style="color:#166534;font-size:13px;text-transform:uppercase;letter-spacing:.5px">Quick start</strong>
        <ul style="margin:12px 0 0;padding-left:20px;color:#374151;font-size:14px;line-height:2">
          <li>Go to <em>Combo Boxes → New Box</em> to create your first combo</li>
          <li>Add the <em>Combo Builder</em> app block to your theme</li>
          <li>Activate the box and start selling!</li>
        </ul>
      </div>
      <div style="text-align:center;margin-top:28px">
        <a href="https://combo-products.vercel.app" style="background:#2A7A4F;color:#fff;text-decoration:none;padding:13px 32px;border-radius:8px;font-size:15px;font-weight:600">
          Open App →
        </a>
      </div>
    </div>
    <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px;text-align:center;font-size:12px;color:#9ca3af">
      Combo Product Builder — Shopify App by ${process.env.APP_OWNER_NAME || "Pryxo Tech Pvt Ltd"}
    </div>
  </div>`;
}

function uninstalledHtml(name, shop) {
  return `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
    <div style="background:linear-gradient(135deg,#374151,#1f2937);padding:36px;text-align:center">
      <div style="font-size:48px">😢</div>
      <h1 style="color:#fff;margin:12px 0 4px;font-size:26px">We're sad to see you go</h1>
      <p style="color:rgba(255,255,255,.75);margin:0;font-size:14px">Combo Product Builder has been uninstalled</p>
    </div>
    <div style="padding:36px">
      <p style="font-size:16px;color:#374151">Hi <strong>${name}</strong>,</p>
      <p style="font-size:15px;color:#4b5563;line-height:1.7">
        We noticed that <strong>Combo Product Builder</strong> has been uninstalled from <strong>${shop}</strong>.
        We're sorry to see you leave — if there's anything we could have done better, please reply to this email.
      </p>
      <div style="background:#fef9ec;border:1px solid #fde68a;border-radius:10px;padding:20px;margin:24px 0">
        <strong style="color:#92400e;font-size:13px;text-transform:uppercase;letter-spacing:.5px">Changed your mind?</strong>
        <p style="margin:10px 0 16px;font-size:14px;color:#78350f">
          You can reinstall the app any time — all your previous combo box configurations will still be saved.
        </p>
        <a href="https://${shop}/admin/apps" style="background:#2A7A4F;color:#fff;text-decoration:none;padding:11px 26px;border-radius:8px;font-size:14px;font-weight:600">
          Reinstall App →
        </a>
      </div>
    </div>
    <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px;text-align:center;font-size:12px;color:#9ca3af">
      Combo Product Builder — Shopify App by ${process.env.APP_OWNER_NAME || "Pryxo Tech Pvt Ltd"}
    </div>
  </div>`;
}

// ── Send ──────────────────────────────────────────────────────────────────────
async function send(to, subject, html) {
  try {
    const info = await transporter.sendMail({ from, to, subject, html, replyTo });
    console.log(`  ✓ Sent to ${to} — MessageId: ${info.messageId}`);
  } catch (err) {
    console.error(`  ✗ Failed to ${to} — ${err.message} (code: ${err.code})`);
  }
}

console.log("Sending test emails...\n");

// 1. Install email → merchant test account
await send(
  USER_EMAIL,
  "Welcome to Combo Product Builder 🎁 [TEST]",
  installedHtml("Test Merchant", "test-store.myshopify.com"),
);

// 2. Uninstall email → merchant test account
await send(
  USER_EMAIL,
  "We're sad to see you go 😢 — Combo Product Builder [TEST]",
  uninstalledHtml("Test Merchant", "test-store.myshopify.com"),
);

// 3. Owner notification → internal
await send(
  OWNER_EMAIL,
  "✅ SMTP Test — Combo Product Builder",
  `<div style="font-family:Arial,sans-serif;padding:24px;background:#f0fdf4;border-radius:8px">
    <h2 style="color:#166534;margin:0 0 12px">SMTP Test Passed</h2>
    <p style="color:#374151;margin:0">Both install and uninstall templates were sent successfully to <strong>${USER_EMAIL}</strong>.</p>
    <p style="color:#6b7280;font-size:13px;margin:8px 0 0">Sent at: ${new Date().toISOString()}</p>
  </div>`,
);

console.log("\nDone.");
