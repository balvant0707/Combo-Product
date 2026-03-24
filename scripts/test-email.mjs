/**
 * Quick SMTP test — run once, then delete.
 * Usage: node scripts/test-email.mjs
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";

const __dir = dirname(fileURLToPath(import.meta.url));

// ── Load .env ─────────────────────────────────────────────────────────────────
const envLines = readFileSync(resolve(__dir, "../.env"), "utf8").split("\n");
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
const OWNER_EMAIL = process.env.APP_OWNER_EMAIL;
const USER_EMAIL  = "xeriw73537@paylaar.com";

const transporter = nodemailer.createTransport({
  host:   "fomoapp.smartreminder.in",
  port:   465,
  secure: true,
  auth: {
    user: "noreply@fomoapp.smartreminder.in",
    pass: "y996@1oNp",
  },
  tls: { rejectUnauthorized: false },
});

const from    = `"MixBox – Box & Bundle Builder" <noreply@fomoapp.smartreminder.in>`;
const replyTo = "sales@pryxotech.com";

// Inline logo so email clients always show it regardless of image blocking
const logoBuffer = readFileSync(resolve(__dir, "../public/images/Bluk Bundle products 1.jpg"));
const attachments = [{
  filename: "logo.jpg",
  content: logoBuffer,
  cid: "mixbox-logo",
  contentType: "image/jpeg",
  contentDisposition: "inline",
}];

// ── Send ──────────────────────────────────────────────────────────────────────
async function send(to, subject, html) {
  try {
    const info = await transporter.sendMail({ from, to, subject, html, replyTo, attachments });
    console.log(`  ✓ Sent to ${to} — MessageId: ${info.messageId}`);
  } catch (err) {
    console.error(`  ✗ Failed to ${to} — ${err.message} (code: ${err.code})`);
  }
}

// Import proper templates
const { installedEmailHtml }        = await import("../app/emails/app-installed.js");
const { uninstalledEmailHtml }      = await import("../app/emails/app-uninstalled.js");
const { ownerInstallNotifyHtml, ownerUninstallNotifyHtml } = await import("../app/emails/owner-notify.js");

const testData = {
  ownerName:  "Test Merchant",
  shopName:   "Test Store",
  shopDomain: "test-store.myshopify.com",
  email:      USER_EMAIL,
  plan:       "Basic",
  country:    "India",
};

console.log("Sending test emails...\n");

// 1. Merchant — Install welcome
await send(USER_EMAIL,  "Welcome to MixBox – Box & Bundle Builder 🎁 [TEST]", installedEmailHtml(testData));

// 2. Owner — Install notification
await send(OWNER_EMAIL, "🎉 New Install: Test Store [TEST]",                  ownerInstallNotifyHtml(testData));

// 3. Merchant — Uninstall goodbye
await send(USER_EMAIL,  "We're sad to see you go 😢 — MixBox [TEST]",         uninstalledEmailHtml(testData));

// 4. Owner — Uninstall alert
await send(OWNER_EMAIL, "⚠️ App Uninstalled: Test Store [TEST]",              ownerUninstallNotifyHtml(testData));

console.log("\nDone.");
