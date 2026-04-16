CREATE TABLE IF NOT EXISTS `uninstallfeedback` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `shop` VARCHAR(255) NOT NULL,
  `ownerName` VARCHAR(255) NULL,
  `email` VARCHAR(320) NULL,
  `contactEmail` VARCHAR(320) NULL,
  `feedbackText` TEXT NULL,
  `feedbackToken` VARCHAR(128) NULL,
  `feedbackSubmittedAt` DATETIME(3) NULL,
  `uninstalledAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `uninstallfeedback_feedbackToken_key` (`feedbackToken`),
  INDEX `UninstallFeedback_shop_idx` (`shop`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
