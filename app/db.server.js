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

let ensureTablesPromise;

export function ensureAppTables() {
  if (!ensureTablesPromise) {
    ensureTablesPromise = (async () => {
      await prisma.$executeRawUnsafe(ENSURE_SESSION_TABLE_SQL);
      await prisma.$executeRawUnsafe(ENSURE_SHOP_TABLE_SQL);
    })();
  }

  return ensureTablesPromise;
}

export default prisma;
