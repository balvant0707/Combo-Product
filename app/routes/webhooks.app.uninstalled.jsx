import { authenticate } from "../shopify.server";
import { randomUUID } from "node:crypto";
import db from "../db.server";
import { markShopUninstalled } from "../models/shop.server";
import { sendMail } from "../utils/mailer.server";
import { uninstalledEmailHtml } from "../emails/app-uninstalled";
import { ownerUninstallNotifyHtml } from "../emails/owner-notify";

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);
  const appBaseUrl = String(process.env.SHOPIFY_APP_URL || new URL(request.url).origin || "")
    .trim()
    .replace(/\/+$/, "");

  console.log(`Received ${topic} webhook for ${shop}`);

  // Fetch shop details before marking as uninstalled so we have the email
  const shopRecord = await db.shop.findUnique({
    where: { shop },
    select: { email: true, contactEmail: true, ownerName: true, name: true, plan: true, country: true },
  });

  console.log(`[uninstall] shopRecord:`, {
    found:        !!shopRecord,
    email:        shopRecord?.email,
    contactEmail: shopRecord?.contactEmail,
    ownerEmail:   process.env.APP_OWNER_EMAIL,
  });

  // Keep a feedback row for each uninstall event so merchant response can be captured later.
  let feedbackToken = null;
  try {
    const uninstallFeedback = await db.uninstallfeedback.create({
      data: {
        shop,
        ownerName: shopRecord?.ownerName || null,
        email: shopRecord?.email || null,
        contactEmail: shopRecord?.contactEmail || null,
        feedbackToken: randomUUID().replace(/-/g, ""),
      },
    });
    feedbackToken = uninstallFeedback.feedbackToken || null;
  } catch (error) {
    console.error("[uninstall webhook] failed to create uninstallfeedback row", error);
  }

  await markShopUninstalled(shop);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // Deleting by shop keeps this idempotent even when webhook retries happen.
  await db.session.deleteMany({ where: { shop } });

  const emailData = {
    ownerName:  shopRecord?.ownerName,
    shopName:   shopRecord?.name,
    shopDomain: shop,
    email:      shopRecord?.contactEmail || shopRecord?.email,
    plan:       shopRecord?.plan,
    country:    shopRecord?.country,
    feedbackUrl: feedbackToken
      ? `${appBaseUrl}/feedback/uninstall?token=${encodeURIComponent(feedbackToken)}`
      : null,
  };

  // Send both emails and await them — fire-and-forget gets killed by Vercel before sending
  const mailJobs = [];

  if (emailData.email) {
    mailJobs.push(
      sendMail(
        emailData.email,
        "We're sad to see you go 😢 — MixBox – Box & Bundle Builder",
        uninstalledEmailHtml(emailData),
      ).catch((err) => console.error("[uninstall webhook] merchant email failed", err)),
    );
  }

  if (process.env.APP_OWNER_EMAIL) {
    mailJobs.push(
      sendMail(
        process.env.APP_OWNER_EMAIL,
        `⚠️ App Uninstalled: ${shopRecord?.name || shop}`,
        ownerUninstallNotifyHtml(emailData),
      ).catch((err) => console.error("[uninstall webhook] owner notification failed", err)),
    );
  }

  await Promise.all(mailJobs);

  return new Response();
};
