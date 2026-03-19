-- CreateTable: combo_step_image — stores per-step uploaded images for specific combo boxes
CREATE TABLE IF NOT EXISTS `combo_step_image` (
  `id`        INT          NOT NULL AUTO_INCREMENT,
  `boxId`     INT          NOT NULL,
  `stepIndex` INT          NOT NULL,
  `imageData` MEDIUMBLOB   NULL,
  `mimeType`  VARCHAR(100) NULL,
  `fileName`  VARCHAR(255) NULL,
  `createdAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `combo_step_image_boxId_stepIndex_key` (`boxId`, `stepIndex`),
  CONSTRAINT `combo_step_image_boxId_fkey`
    FOREIGN KEY (`boxId`) REFERENCES `combo_box` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
