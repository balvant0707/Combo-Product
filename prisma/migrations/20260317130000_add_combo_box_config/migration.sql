-- CreateTable: combo_box_config — stores typed Specific Combo Box settings per box
CREATE TABLE `combo_box_config` (
  `id`                INT           NOT NULL AUTO_INCREMENT,
  `boxId`             INT           NOT NULL,
  `comboType`         INT           NOT NULL DEFAULT 2,
  `title`             VARCHAR(255)  NULL,
  `subtitle`          VARCHAR(255)  NULL,
  `discountBadge`     VARCHAR(100)  NULL,
  `isActive`          TINYINT(1)    NOT NULL DEFAULT 1,
  `showProductImages` TINYINT(1)    NOT NULL DEFAULT 1,
  `showProgressBar`   TINYINT(1)    NOT NULL DEFAULT 1,
  `allowReselection`  TINYINT(1)    NOT NULL DEFAULT 1,
  `stepsJson`         LONGTEXT      NULL,
  `createdAt`         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `combo_box_config_boxId_key` (`boxId`),
  CONSTRAINT `combo_box_config_boxId_fkey`
    FOREIGN KEY (`boxId`) REFERENCES `combo_box` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
