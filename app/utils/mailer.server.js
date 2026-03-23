import nodemailer from "nodemailer";

let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  _transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
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

  const from = `"${process.env.MAIL_FROM_NAME || "Combo Product Builder"}" <${process.env.MAIL_FROM_ADDRESS || process.env.SMTP_USER}>`;

  try {
    const info = await getTransporter().sendMail({ from, to, subject, html });
    console.info("[mailer] sent", { to, subject, messageId: info.messageId });
  } catch (err) {
    console.error("[mailer] failed to send email", { to, subject, error: err.message });
  }
}
