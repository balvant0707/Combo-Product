import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma, { ensureAppTables } from "./db.server";
import { upsertSessionFromAuth, upsertShopFromAdmin } from "./models/shop.server";

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
  connectionRetries: 10,
  connectionRetryIntervalMs: 1000,
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
      await upsertShopFromAdmin(session, admin);
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
