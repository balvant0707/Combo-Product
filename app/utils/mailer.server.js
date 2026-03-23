import nodemailer from "nodemailer";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));

// Try multiple candidate paths so it works locally, on Vercel, and in any build output layout
const LOGO_CANDIDATES = [
  resolve(__dir, "../../public/images/Bluk Bundle products 1.jpg"), // local dev
  resolve(process.cwd(), "public/images/Bluk Bundle products 1.jpg"), // Vercel / build root
];
const LOGO_PATH = LOGO_CANDIDATES.find(existsSync) ?? LOGO_CANDIDATES[0];

let _logoBuffer = null;
function getLogoBuffer() {
  if (_logoBuffer) return _logoBuffer;
  try {
    _logoBuffer = readFileSync(LOGO_PATH);
  } catch {
    console.warn("[mailer] logo file not found at", LOGO_PATH);
    _logoBuffer = null;
  }
  return _logoBuffer;
}

// CID used in HTML as <img src="cid:mixbox-logo">
export const LOGO_CID = "mixbox-logo";

let _transporter = null;

function isSecure() {
  const val = (process.env.SMTP_SECURE || "").toLowerCase();
  const port = parseInt(process.env.SMTP_PORT || "587");
  return val === "true" || val === "ssl" || val === "yes" || val === "1" || port === 465;
}

function getTransporter() {
  if (_transporter) return _transporter;

  const secure = isSecure();
  const port = parseInt(process.env.SMTP_PORT || (secure ? "465" : "587"));

  _transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: { rejectUnauthorized: false },
  });

  return _transporter;
}

/**
 * Send an email with the MixBox logo embedded as an inline CID attachment.
 * @param {string} to
 * @param {string} subject
 * @param {string} html  - Use <img src="cid:mixbox-logo"> for the logo
 */
export async function sendMail(to, subject, html) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn("[mailer] SMTP not configured — skipping email to", to);
    return;
  }

  const fromAddress = process.env.SMTP_USER;
  const from = `"${process.env.MAIL_FROM_NAME || "MixBox – Box & Bundle Builder"}" <${fromAddress}>`;
  const replyTo =
    process.env.MAIL_FROM_ADDRESS && process.env.MAIL_FROM_ADDRESS !== fromAddress
      ? process.env.MAIL_FROM_ADDRESS
      : undefined;

  // Inline logo attachment — embedded so it shows regardless of email client image blocking
  const attachments = [];
  const logoBuffer = getLogoBuffer();
  if (logoBuffer) {
    attachments.push({
      filename: "logo.jpg",
      content: logoBuffer,
      cid: LOGO_CID,
      contentType: "image/jpeg",
      contentDisposition: "inline",
    });
  }

  try {
    const info = await getTransporter().sendMail({ from, to, subject, html, replyTo, attachments });
    console.info("[mailer] sent", { to, subject, messageId: info.messageId });
  } catch (err) {
    console.error("[mailer] failed", { to, subject, error: err.message, code: err.code });
    _transporter = null;
  }
}
