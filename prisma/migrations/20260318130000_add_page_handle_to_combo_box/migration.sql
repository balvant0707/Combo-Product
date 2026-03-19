-- AlterTable: add pageHandle to combo_box for per-page box visibility filtering
ALTER TABLE `combo_box`
  ADD COLUMN IF NOT EXISTS `pageHandle` VARCHAR(255) NULL;
