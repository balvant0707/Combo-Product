ALTER TABLE `shop`
  ADD COLUMN `reviewPromptDelayDays` INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN `reviewPopupDismissedAt` DATETIME(3) NULL,
  ADD COLUMN `reviewSubmittedAt` DATETIME(3) NULL,
  ADD COLUMN `reviewRating` INTEGER NULL,
  ADD COLUMN `reviewComment` TEXT NULL;
