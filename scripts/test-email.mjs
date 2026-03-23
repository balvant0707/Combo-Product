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
const USER_EMAIL  = "xeriw73537@paylaar.com";   // merchant test account

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
const from = `"${process.env.MAIL_FROM_NAME || "MixBox – Box & Bundle Builder"}" <${fromAddress}>`;
const replyTo = process.env.MAIL_FROM_ADDRESS && process.env.MAIL_FROM_ADDRESS !== fromAddress
  ? process.env.MAIL_FROM_ADDRESS
  : undefined;

// Inline logo so email clients always show it regardless of image blocking
const logoPath = resolve(__dir, "../public/images/Bluk Bundle products 1.jpg");
const logoBuffer = readFileSync(logoPath);
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
