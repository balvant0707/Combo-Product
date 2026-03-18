-- AlterTable: add scope fields to combo_box
ALTER TABLE `combo_box`
  ADD COLUMN `scopeType` VARCHAR(30) NOT NULL DEFAULT 'specific_collections',
  ADD COLUMN `scopeItemsJson` LONGTEXT NULL;
