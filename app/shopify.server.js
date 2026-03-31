import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma, { ensureAppTables, withDbRetry } from "./db.server";
import { upsertSessionFromAuth, upsertShopFromAdmin } from "./models/shop.server";
import { sendMail } from "./utils/mailer.server";
import { installedEmailHtml } from "./emails/app-installed";
import { ownerInstallNotifyHtml } from "./emails/owner-notify";
import { BILLING_PLANS } from "./config/billing";

const shouldEnsureAppTables =
  process.env.ENSURE_APP_TABLES === "true" ||
  (process.env.NODE_ENV !== "production" &&
    process.env.ENSURE_APP_TABLES !== "false");

if (shouldEnsureAppTables) {
  ensureAppTables().catch((error) => {
    console.error("[DB Init] Failed to ensure app tables", error);
  });
}

const sessionDbRetries = Number.parseInt(process.env.SESSION_DB_RETRIES || "2", 10) || 2;
const sessionDbRetryDelayMs = Number.parseInt(process.env.SESSION_DB_RETRY_DELAY_MS || "800", 10) || 800;

class RetryPrismaSessionStorage extends PrismaSessionStorage {
  async loadSession(id) {
    return withDbRetry(() => super.loadSession(id), { retries: sessionDbRetries, delayMs: sessionDbRetryDelayMs });
  }

  async storeSession(session) {
    return withDbRetry(() => super.storeSession(session), { retries: sessionDbRetries, delayMs: sessionDbRetryDelayMs });
  }

  async deleteSession(id) {
    return withDbRetry(() => super.deleteSession(id), { retries: sessionDbRetries, delayMs: sessionDbRetryDelayMs });
  }

  async deleteSessions(ids) {
    return withDbRetry(() => super.deleteSessions(ids), { retries: sessionDbRetries, delayMs: sessionDbRetryDelayMs });
  }

  async findSessionsByShop(shop) {
    return withDbRetry(() => super.findSessionsByShop(shop), { retries: sessionDbRetries, delayMs: sessionDbRetryDelayMs });
  }
}

const prismaSessionStorage = new RetryPrismaSessionStorage(prisma, {
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
  billing: BILLING_PLANS,
  future: {
    expiringOfflineAccessTokens: true,
  },
  hooks: {
    afterAuth: async ({ session, admin }) => {
      await upsertSessionFromAuth(session);
      const shopInfo = await upsertShopFromAdmin(session, admin);

      if (shopInfo.isNewInstall) {
        // isNewInstall is set atomically inside upsertShopFromAdmin:
        //   isFirstInstall → db.shop.create won the race
        //   isReinstall    → db.shop.updateMany WHERE uninstalledAt IS NOT NULL won the race
        // No further claim needed here — just send.
        {
          const emailData = {
            ownerName:  shopInfo.ownerName,
            shopName:   shopInfo.shopName,
            shopDomain: shopInfo.shopDomain,
            email:      shopInfo.email,
            plan:       shopInfo.plan,
            country:    shopInfo.country,
          };

          // Await both emails — fire-and-forget gets killed by Vercel before sending
          const mailJobs = [];

          if (shopInfo.email) {
            mailJobs.push(
              sendMail(
                shopInfo.email,
                "Welcome to MixBox – Box & Bundle Builder 🎁",
                installedEmailHtml(emailData),
              ).catch((err) => console.error("[afterAuth] merchant install email failed", err)),
            );
          }

          const ownerEmail = process.env.APP_OWNER_EMAIL;
          if (ownerEmail) {
            mailJobs.push(
              sendMail(
                ownerEmail,
                `🎉 New Install: ${shopInfo.shopName || shopInfo.shopDomain}`,
                ownerInstallNotifyHtml(emailData),
              ).catch((err) => console.error("[afterAuth] owner install notification failed", err)),
            );
          }

          await Promise.all(mailJobs);

          console.info("[afterAuth] install emails dispatched", {
            shop: session.shop,
            isFirstInstall: shopInfo.isFirstInstall,
            isReinstall: shopInfo.isReinstall,
            to: shopInfo.email,
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
export { BILLING_IS_TEST, MONTHLY_PLAN, YEARLY_PLAN } from "./config/billing";
