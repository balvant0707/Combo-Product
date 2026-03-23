import nodemailer from "nodemailer";

let _transporter = null;

function isSecure() {
  const val = (process.env.SMTP_SECURE || "").toLowerCase();
  const port = parseInt(process.env.SMTP_PORT || "587");
  // treat "true", "ssl", "yes", "1" as secure; port 465 is always SSL
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
    tls: {
      // Accept self-signed or mis-matched certs on private mail servers
      rejectUnauthorized: false,
    },
  });

  return _transporter;
}

/**
 * Send an email.
 * @param {string} to   - Recipient email address
 * @param {string} subject
 * @param {string} html - Full HTML body
 */
export async function sendMail(to, subject, html) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn("[mailer] SMTP not configured — skipping email to", to);
    return;
  }

  // SMTP server only permits sending from the authenticated login address.
  // If MAIL_FROM_ADDRESS differs, use it as Reply-To instead.
  const fromAddress = process.env.SMTP_USER;
  const from = `"${process.env.MAIL_FROM_NAME || "Combo Product Builder"}" <${fromAddress}>`;
  const replyTo = process.env.MAIL_FROM_ADDRESS && process.env.MAIL_FROM_ADDRESS !== fromAddress
    ? process.env.MAIL_FROM_ADDRESS
    : undefined;

  try {
    const transporter = getTransporter();
    const info = await transporter.sendMail({ from, to, subject, html, replyTo });
    console.info("[mailer] sent", {
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: isSecure(),
      from,
      to,
      subject,
      messageId: info.messageId,
    });
  } catch (err) {
    console.error("[mailer] failed to send email", {
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      to,
      subject,
      error: err.message,
      code: err.code,
    });
    // Reset transporter so next attempt re-creates it (handles transient connection drops)
    _transporter = null;
  }
}
