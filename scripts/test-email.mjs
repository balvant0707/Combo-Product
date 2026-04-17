/**
 * Dynamic email test script — uses a real shop record from the database.
 * Usage: node scripts/test-email.mjs [shop-domain]
 *
 * If a shop domain is provided as an argument, that shop is used.
 * Otherwise the most recently updated installed shop is used.
 *
 * Required .env vars:
 *   DATABASE_URL     — MySQL connection string
 *   APP_OWNER_EMAIL  — owner/admin email
 *   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS
 *   MAIL_FROM_NAME / MAIL_FROM_ADDRESS
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";
import { PrismaClient } from "@prisma/client";

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

// ── Validate required env vars ────────────────────────────────────────────────
const REQUIRED = ["DATABASE_URL", "APP_OWNER_EMAIL", "SMTP_HOST", "SMTP_USER", "SMTP_PASS"];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error("Missing required env vars:", missing.join(", "));
  process.exit(1);
}

// ── Fetch real shop from DB ───────────────────────────────────────────────────
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

const shopArg = process.argv[2]; // optional: node test-email.mjs my-store.myshopify.com

const shopRecord = await prisma.shop.findFirst({
  where: shopArg
    ? { shop: shopArg }
    : { installed: true },
  orderBy: { updatedAt: "desc" },
  select: {
    shop: true,
    name: true,
    ownerName: true,
    email: true,
    contactEmail: true,
    plan: true,
    country: true,
  },
});

await prisma.$disconnect();

if (!shopRecord) {
  console.error(
    shopArg
      ? `No shop record found for: ${shopArg}`
      : "No installed shop found in the database. Install the app first.",
  );
  process.exit(1);
}

console.log("\nUsing shop record:");
console.log("  shop       :", shopRecord.shop);
console.log("  name       :", shopRecord.name);
console.log("  ownerName  :", shopRecord.ownerName);
console.log("  email      :", shopRecord.contactEmail || shopRecord.email);
console.log("  plan       :", shopRecord.plan);
console.log("  country    :", shopRecord.country);
console.log();

// ── SMTP transporter ──────────────────────────────────────────────────────────
const port = Number(process.env.SMTP_PORT) || 465;
const secureVal = (process.env.SMTP_SECURE || "").toLowerCase();
const secure = secureVal === "true" || secureVal === "ssl" || secureVal === "yes" || secureVal === "1" || port === 465;

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port,
  secure,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  tls: { rejectUnauthorized: false },
});

const from    = `"${process.env.MAIL_FROM_NAME || "MixBox – Box & Bundle Builder"}" <${process.env.SMTP_USER}>`;
const replyTo = process.env.MAIL_FROM_ADDRESS || undefined;

// Inline logo
const LOGO_PATH = resolve(__dir, "../public/images/mix-bundle.jpg");
let attachments = [];
try {
  const logoBuffer = readFileSync(LOGO_PATH);
  attachments = [{
    filename: "logo.jpg",
    content: logoBuffer,
    cid: "mixbox-logo",
    contentType: "image/jpeg",
    contentDisposition: "inline",
  }];
} catch {
  console.warn("[test] logo not found — sending without inline image");
}

// ── Send helper ───────────────────────────────────────────────────────────────
async function send(to, subject, html) {
  if (!to) { console.warn(`  ⚠ skipped (no address): ${subject}`); return; }
  try {
    const info = await transporter.sendMail({ from, to, subject, html, replyTo, attachments });
    console.log(`  ✓ sent to ${to} — ${info.messageId}`);
  } catch (err) {
    console.error(`  ✗ failed to ${to} — ${err.message} (${err.code})`);
  }
}

// ── Email templates ───────────────────────────────────────────────────────────
const { installedEmailHtml }   = await import("../app/emails/app-installed.js");
const { uninstalledEmailHtml } = await import("../app/emails/app-uninstalled.js");
const { ownerInstallNotifyHtml, ownerUninstallNotifyHtml } = await import("../app/emails/owner-notify.js");

const data = {
  ownerName:  shopRecord.ownerName,
  shopName:   shopRecord.name,
  shopDomain: shopRecord.shop,
  email:      shopRecord.contactEmail || shopRecord.email,
  plan:       shopRecord.plan,
  country:    shopRecord.country,
};

const OWNER_EMAIL = process.env.APP_OWNER_EMAIL;
const USER_EMAIL  = data.email;

// ── Send all 4 emails ─────────────────────────────────────────────────────────
console.log("Sending install emails...");
await send(USER_EMAIL,  "Welcome to MixBox – Box & Bundle Builder 🎁",       installedEmailHtml(data));
await send(OWNER_EMAIL, `🎉 New Install: ${data.shopName || data.shopDomain}`, ownerInstallNotifyHtml(data));

console.log("\nSending uninstall emails...");
await send(USER_EMAIL,  "We're sad to see you go 😢 — MixBox – Box & Bundle Builder", uninstalledEmailHtml(data));
await send(OWNER_EMAIL, `⚠️ App Uninstalled: ${data.shopName || data.shopDomain}`,    ownerUninstallNotifyHtml(data));

console.log("\nDone.");
