import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma, { ensureAppTables } from "./db.server";
import { upsertSessionFromAuth, upsertShopFromAdmin } from "./models/shop.server";
import { sendMail } from "./utils/mailer.server";
import { installedEmailHtml } from "./emails/app-installed";
import { ownerInstallNotifyHtml } from "./emails/owner-notify";

const shouldEnsureAppTables =
  process.env.ENSURE_APP_TABLES === "true" ||
  (process.env.NODE_ENV !== "production" &&
    process.env.ENSURE_APP_TABLES !== "false");

if (shouldEnsureAppTables) {
  ensureAppTables().catch((error) => {
    console.error("[DB Init] Failed to ensure app tables", error);
  });
}

const prismaSessionStorage = new PrismaSessionStorage(prisma, {
  connectionRetries: 5,
  connectionRetryIntervalMs: 2000,
});

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: prismaSessionStorage,
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  hooks: {
    afterAuth: async ({ session, admin }) => {
      await upsertSessionFromAuth(session);
      const shopInfo = await upsertShopFromAdmin(session, admin);

      if (shopInfo.isNewInstall) {
        // Atomic claim: only the first concurrent afterAuth request wins.
        // We do a conditional update that only succeeds if uninstalledAt is still
        // non-null OR installed was just set. The winner (count=1) sends the email.
        const claimed = await prisma.shop.updateMany({
          where: {
            shop: session.shop,
            OR: [
              { uninstalledAt: { not: null } },
              { installed: false },
            ],
          },
          data: { uninstalledAt: null, installed: true },
        });

        // Only send emails if this request won the atomic claim
        const shouldSend = claimed.count > 0;

        if (shouldSend) {
          const emailData = {
            ownerName:  shopInfo.ownerName,
            shopName:   shopInfo.shopName,
            shopDomain: shopInfo.shopDomain,
            email:      shopInfo.email,
            plan:       shopInfo.plan,
            country:    shopInfo.country,
          };

          if (shopInfo.email) {
            sendMail(
              shopInfo.email,
              "Welcome to MixBox – Box & Bundle Builder 🎁",
              installedEmailHtml(emailData),
            ).catch((err) => console.error("[afterAuth] merchant install email failed", err));
          }

          const ownerEmail = process.env.APP_OWNER_EMAIL;
          if (ownerEmail) {
            sendMail(
              ownerEmail,
              `🎉 New Install: ${shopInfo.shopName || shopInfo.shopDomain}`,
              ownerInstallNotifyHtml(emailData),
            ).catch((err) => console.error("[afterAuth] owner install notification failed", err));
          }

          console.info("[afterAuth] install emails dispatched", {
            shop: session.shop,
            to: shopInfo.email,
          });
        } else {
          console.info("[afterAuth] install email skipped (already claimed by concurrent request)", {
            shop: session.shop,
          });
        }
      }
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
