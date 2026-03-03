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

process.env.DATABASE_URL = normalizedDatabaseUrl;

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient();
  }
}

const prisma = global.prismaGlobal ?? new PrismaClient();
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
  \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE INDEX \`app_settings_shop_key\` (\`shop\`),
  PRIMARY KEY (\`id\`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
`;

let ensureTablesPromise;

export function ensureAppTables() {
  if (!ensureTablesPromise) {
    ensureTablesPromise = (async () => {
      await prisma.$executeRawUnsafe(ENSURE_SESSION_TABLE_SQL);
      await prisma.$executeRawUnsafe(ENSURE_SHOP_TABLE_SQL);
      await prisma.$executeRawUnsafe(ENSURE_COMBO_BOX_TABLE_SQL);
      await prisma.$executeRawUnsafe(ENSURE_COMBO_BOX_PRODUCT_TABLE_SQL);
      await prisma.$executeRawUnsafe(ENSURE_BUNDLE_ORDER_TABLE_SQL);
      await prisma.$executeRawUnsafe(ENSURE_APP_SETTINGS_TABLE_SQL);
    })();
  }

  return ensureTablesPromise;
}

export default prisma;
