import { PrismaClient } from "@prisma/client";

const rawDatabaseUrl = process.env.DATABASE_URL?.trim();
const normalizedDatabaseUrl = rawDatabaseUrl?.replace(/^"(.*)"$/, "$1");

if (!normalizedDatabaseUrl) {
  throw new Error("[DB Init] DATABASE_URL is missing");
}

if (!/^mysqls?:\/\//i.test(normalizedDatabaseUrl)) {
  throw new Error(
    `[DB Init] DATABASE_URL must start with mysql:// or mysqls:// (received: ${normalizedDatabaseUrl.slice(0, 30)})`,
  );
}

// In serverless, apply sane Prisma pool defaults unless already set in DATABASE_URL:
// connection_limit=5 and pool_timeout=30 (seconds).
const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

function asPositiveInt(value) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function applyPrismaPoolParams(databaseUrl, serverless) {
  let parsedUrl;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    // Fallback to the original URL if parsing fails unexpectedly.
    return databaseUrl;
  }

  // Serverless: allow 3 connections per instance so Promise.all() loaders that
  // fire 2-3 concurrent queries don't time out waiting for a single slot.
  // pool_timeout raised to 20s to handle cold-start latency on shared hosting.
  const defaultConnectionLimit = serverless ? 3 : null;
  const defaultPoolTimeout = serverless ? 20 : null;

  const configuredConnectionLimit = asPositiveInt(process.env.PRISMA_CONNECTION_LIMIT);
  const configuredPoolTimeout     = asPositiveInt(process.env.PRISMA_POOL_TIMEOUT);

  if (!parsedUrl.searchParams.has("connection_limit")) {
    const connectionLimit = configuredConnectionLimit ?? defaultConnectionLimit;
    if (connectionLimit) parsedUrl.searchParams.set("connection_limit", String(connectionLimit));
  }

  if (!parsedUrl.searchParams.has("pool_timeout")) {
    const poolTimeout = configuredPoolTimeout ?? defaultPoolTimeout;
    if (poolTimeout) parsedUrl.searchParams.set("pool_timeout", String(poolTimeout));
  }

  // Always set a TCP connect timeout so Vercel functions fail fast instead of
  // hanging for 30 s when the DB host is unreachable.
  if (!parsedUrl.searchParams.has("connect_timeout")) {
    parsedUrl.searchParams.set("connect_timeout", "10");
  }

  return parsedUrl.toString();
}

const dbUrl = applyPrismaPoolParams(normalizedDatabaseUrl, isServerless);

process.env.DATABASE_URL = dbUrl;

// Use globalThis singleton in ALL environments to avoid multiple client instances
// within the same module cache (dev hot-reload or serverless warm containers).
if (!globalThis.__prismaClient) {
  globalThis.__prismaClient = new PrismaClient();
}

const prisma = globalThis.__prismaClient;
const prismaProvider = prisma?._engineConfig?.activeProvider;

if (prismaProvider && prismaProvider !== "mysql") {
  throw new Error(
    `[DB Init] Prisma client provider is '${prismaProvider}', expected 'mysql'. Run 'npx prisma generate' during deployment.`,
  );
}

const ENSURE_SESSION_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS \`session\` (
  \`id\` VARCHAR(191) NOT NULL,
  \`shop\` VARCHAR(191) NOT NULL,
  \`state\` VARCHAR(191) NOT NULL,
  \`isOnline\` BOOLEAN NOT NULL DEFAULT false,
  \`scope\` TEXT NULL,
  \`expires\` DATETIME(3) NULL,
  \`accessToken\` TEXT NOT NULL,
  \`userId\` BIGINT NULL,
  \`firstName\` TEXT NULL,
  \`lastName\` TEXT NULL,
  \`email\` TEXT NULL,
  \`accountOwner\` BOOLEAN NOT NULL DEFAULT false,
  \`locale\` TEXT NULL,
  \`collaborator\` BOOLEAN NULL DEFAULT false,
  \`emailVerified\` BOOLEAN NULL DEFAULT false,
  \`refreshToken\` TEXT NULL,
  \`refreshTokenExpires\` DATETIME(3) NULL,
  PRIMARY KEY (\`id\`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
`;

const ENSURE_SHOP_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS \`shop\` (
  \`id\` INTEGER NOT NULL AUTO_INCREMENT,
  \`shop\` VARCHAR(191) NOT NULL,
  \`accessToken\` VARCHAR(191) NULL,
  \`installed\` BOOLEAN NOT NULL DEFAULT false,
  \`status\` VARCHAR(32) NULL DEFAULT 'installed',
  \`ownerName\` VARCHAR(255) NULL,
  \`email\` VARCHAR(320) NULL,
  \`contactEmail\` VARCHAR(320) NULL,
  \`name\` VARCHAR(255) NULL,
  \`country\` VARCHAR(100) NULL,
  \`city\` VARCHAR(100) NULL,
  \`currency\` VARCHAR(10) NULL,
  \`phone\` VARCHAR(50) NULL,
  \`primaryDomain\` VARCHAR(255) NULL,
  \`plan\` VARCHAR(100) NULL,
  \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  \`updatedAt\` DATETIME(3) NOT NULL,
  \`onboardedAt\` DATETIME(3) NULL,
  \`uninstalledAt\` DATETIME(3) NULL,
  \`announcementEmailSentAt\` DATETIME(3) NULL,
  UNIQUE INDEX \`Shop_shop_key\`(\`shop\`),
  PRIMARY KEY (\`id\`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
`;

const ENSURE_COMBO_BOX_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS \`combo_box\` (
  \`id\` INTEGER NOT NULL AUTO_INCREMENT,
  \`shop\` VARCHAR(191) NOT NULL,
  \`boxName\` VARCHAR(255) NOT NULL,
  \`displayTitle\` VARCHAR(255) NOT NULL,
  \`itemCount\` INTEGER NOT NULL DEFAULT 1,
  \`bundlePrice\` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  \`isGiftBox\` BOOLEAN NOT NULL DEFAULT false,
  \`allowDuplicates\` BOOLEAN NOT NULL DEFAULT false,
  \`bannerImageUrl\` VARCHAR(500) NULL,
  \`sortOrder\` INTEGER NOT NULL DEFAULT 0,
  \`isActive\` BOOLEAN NOT NULL DEFAULT true,
  \`giftMessageEnabled\` BOOLEAN NOT NULL DEFAULT false,
  \`shopifyProductId\` VARCHAR(255) NULL,
  \`shopifyVariantId\` VARCHAR(255) NULL,
  \`deletedAt\` DATETIME(3) NULL,
  \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`),
  INDEX \`combo_box_shop_idx\` (\`shop\`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
`;

const ENSURE_COMBO_BOX_PRODUCT_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS \`combo_box_product\` (
  \`id\` INTEGER NOT NULL AUTO_INCREMENT,
  \`boxId\` INTEGER NOT NULL,
  \`productId\` VARCHAR(255) NOT NULL,
  \`productTitle\` VARCHAR(255) NULL,
  \`productImageUrl\` VARCHAR(500) NULL,
  \`productHandle\` VARCHAR(255) NULL,
  \`isCollection\` BOOLEAN NOT NULL DEFAULT false,
  \`variantIds\` JSON NULL,
  \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`),
  INDEX \`combo_box_product_boxId_idx\` (\`boxId\`),
  FOREIGN KEY (\`boxId\`) REFERENCES \`combo_box\`(\`id\`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
`;

const ENSURE_BUNDLE_ORDER_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS \`bundle_order\` (
  \`id\` INTEGER NOT NULL AUTO_INCREMENT,
  \`shop\` VARCHAR(191) NOT NULL,
  \`orderId\` VARCHAR(255) NOT NULL,
  \`boxId\` INTEGER NOT NULL,
  \`selectedProducts\` JSON NOT NULL,
  \`bundlePrice\` DECIMAL(10,2) NOT NULL,
  \`giftMessage\` TEXT NULL,
  \`orderDate\` DATETIME(3) NOT NULL,
  \`customerId\` VARCHAR(255) NULL,
  \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`),
  INDEX \`bundle_order_shop_idx\` (\`shop\`),
  INDEX \`bundle_order_boxId_idx\` (\`boxId\`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
`;

const ENSURE_APP_SETTINGS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS \`app_settings\` (
  \`id\` INTEGER NOT NULL AUTO_INCREMENT,
  \`shop\` VARCHAR(191) NOT NULL,
  \`widgetHeadingText\` VARCHAR(255) NULL,
  \`ctaButtonLabel\` VARCHAR(100) NULL,
  \`addToCartLabel\` VARCHAR(100) NULL,
  \`buttonColor\` VARCHAR(20) NULL DEFAULT '#2A7A4F',
  \`activeSlotColor\` VARCHAR(20) NULL DEFAULT '#2A7A4F',
  \`showSavingsBadge\` BOOLEAN NOT NULL DEFAULT false,
  \`allowDuplicates\` BOOLEAN NOT NULL DEFAULT false,
  \`showProductPrices\` BOOLEAN NOT NULL DEFAULT false,
  \`forceShowOos\` BOOLEAN NOT NULL DEFAULT false,
  \`giftMessageField\` BOOLEAN NOT NULL DEFAULT false,
  \`analyticsTracking\` BOOLEAN NOT NULL DEFAULT true,
  \`emailNotifications\` BOOLEAN NOT NULL DEFAULT false,
  \`presetTheme\` VARCHAR(50) NULL DEFAULT 'custom',
  \`widgetMaxWidth\` INTEGER NULL DEFAULT 1140,
  \`productCardsPerRow\` INTEGER NULL DEFAULT 4,
  \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE INDEX \`app_settings_shop_key\` (\`shop\`),
  PRIMARY KEY (\`id\`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
`;

const ENSURE_APP_SETTINGS_COLUMNS_SQL = [
  "ALTER TABLE `app_settings` ADD COLUMN IF NOT EXISTS `presetTheme` VARCHAR(50) NULL DEFAULT 'custom';",
  "ALTER TABLE `app_settings` ADD COLUMN IF NOT EXISTS `widgetMaxWidth` INTEGER NULL DEFAULT 1140;",
  "ALTER TABLE `app_settings` ADD COLUMN IF NOT EXISTS `productCardsPerRow` INTEGER NULL DEFAULT 4;",
];

// Persist across hot-reloads AND across warm serverless invocations in the
// same container so the DDL only fires once per process lifetime.
// Retry a DB operation with exponential backoff for transient connection errors.
export async function withDbRetry(fn, { retries = 3, delayMs = 500 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isTransient =
        err?.message?.includes("Can't reach database") ||
        err?.message?.includes("Connection refused") ||
        err?.message?.includes("ECONNREFUSED") ||
        err?.message?.includes("ETIMEDOUT") ||
        err?.message?.includes("Timed out fetching a new connection") ||
        err?.errorCode === "P1001" ||   // Prisma: unreachable
        err?.errorCode === "P1002" ||   // Prisma: timed out
        err?.errorCode === "P2024";     // Prisma: connection pool timeout
      if (!isTransient || attempt === retries) break;
      const wait = delayMs * 2 ** attempt;
      console.warn(`[DB] transient error (attempt ${attempt + 1}/${retries + 1}), retrying in ${wait}ms…`, err?.message);
      await new Promise((r) => setTimeout(r, wait));
      // Reset the cached promise so ensureAppTables re-runs after reconnect
      globalThis.__ensureTablesPromise = null;
    }
  }
  throw lastErr;
}

export function ensureAppTables() {
  if (!globalThis.__ensureTablesPromise) {
    globalThis.__ensureTablesPromise = (async () => {
      await prisma.$executeRawUnsafe(ENSURE_SESSION_TABLE_SQL);
      await prisma.$executeRawUnsafe(ENSURE_SHOP_TABLE_SQL);
      await prisma.$executeRawUnsafe(ENSURE_COMBO_BOX_TABLE_SQL);
      await prisma.$executeRawUnsafe(ENSURE_COMBO_BOX_PRODUCT_TABLE_SQL);
      await prisma.$executeRawUnsafe(ENSURE_BUNDLE_ORDER_TABLE_SQL);
      await prisma.$executeRawUnsafe(ENSURE_APP_SETTINGS_TABLE_SQL);
      for (const sql of ENSURE_APP_SETTINGS_COLUMNS_SQL) {
        await prisma.$executeRawUnsafe(sql);
      }
    })().catch((err) => {
      // Allow retry on next request
      globalThis.__ensureTablesPromise = null;
      throw err;
    });
  }

  return globalThis.__ensureTablesPromise;
}

export default prisma;

