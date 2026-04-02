ALTER TABLE `combo_box_config`
  ADD COLUMN `isGiftBox` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `allowDuplicates` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `giftMessageEnabled` BOOLEAN NOT NULL DEFAULT false;
