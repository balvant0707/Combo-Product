-- CreateTable
CREATE TABLE `combo_box` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shop` VARCHAR(191) NOT NULL,
    `boxName` VARCHAR(255) NOT NULL,
    `displayTitle` VARCHAR(255) NOT NULL,
    `itemCount` INTEGER NOT NULL DEFAULT 1,
    `bundlePrice` DECIMAL(10, 2) NOT NULL,
    `isGiftBox` BOOLEAN NOT NULL DEFAULT false,
    `allowDuplicates` BOOLEAN NOT NULL DEFAULT false,
    `bannerImageUrl` VARCHAR(500) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `giftMessageEnabled` BOOLEAN NOT NULL DEFAULT false,
    `shopifyProductId` VARCHAR(255) NULL,
    `shopifyVariantId` VARCHAR(255) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `combo_box_shop_idx`(`shop`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `combo_box_product` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `boxId` INTEGER NOT NULL,
    `productId` VARCHAR(255) NOT NULL,
    `productTitle` VARCHAR(255) NULL,
    `productImageUrl` VARCHAR(500) NULL,
    `productHandle` VARCHAR(255) NULL,
    `isCollection` BOOLEAN NOT NULL DEFAULT false,
    `variantIds` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `combo_box_product_boxId_idx`(`boxId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bundle_order` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shop` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(255) NOT NULL,
    `boxId` INTEGER NOT NULL,
    `selectedProducts` JSON NOT NULL,
    `bundlePrice` DECIMAL(10, 2) NOT NULL,
    `giftMessage` TEXT NULL,
    `orderDate` DATETIME(3) NOT NULL,
    `customerId` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bundle_order_shop_idx`(`shop`),
    INDEX `bundle_order_boxId_idx`(`boxId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `app_settings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shop` VARCHAR(191) NOT NULL,
    `widgetHeadingText` VARCHAR(255) NULL,
    `ctaButtonLabel` VARCHAR(100) NULL,
    `addToCartLabel` VARCHAR(100) NULL,
    `buttonColor` VARCHAR(20) NULL DEFAULT '#2A7A4F',
    `activeSlotColor` VARCHAR(20) NULL DEFAULT '#2A7A4F',
    `showSavingsBadge` BOOLEAN NOT NULL DEFAULT false,
    `allowDuplicates` BOOLEAN NOT NULL DEFAULT false,
    `showProductPrices` BOOLEAN NOT NULL DEFAULT false,
    `forceShowOos` BOOLEAN NOT NULL DEFAULT false,
    `giftMessageField` BOOLEAN NOT NULL DEFAULT false,
    `analyticsTracking` BOOLEAN NOT NULL DEFAULT true,
    `emailNotifications` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `app_settings_shop_key`(`shop`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `combo_box_product` ADD CONSTRAINT `combo_box_product_boxId_fkey` FOREIGN KEY (`boxId`) REFERENCES `combo_box`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bundle_order` ADD CONSTRAINT `bundle_order_boxId_fkey` FOREIGN KEY (`boxId`) REFERENCES `combo_box`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
