-- Remove discountBadge column from combo_box_config
ALTER TABLE `combo_box_config` DROP COLUMN IF EXISTS `discountBadge`;

-- Add bundlePrice and bundlePriceType columns to combo_box_config
ALTER TABLE `combo_box_config`
  ADD COLUMN `bundlePrice` DECIMAL(10, 2) NULL,
  ADD COLUMN `bundlePriceType` VARCHAR(10) NULL DEFAULT 'manual';
