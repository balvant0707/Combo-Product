SET @add_combo_product_button_title = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'combo_box'
        AND COLUMN_NAME = 'comboProductButtonTitle'
    ),
    'SELECT 1',
    'ALTER TABLE `combo_box` ADD COLUMN `comboProductButtonTitle` VARCHAR(100) NULL'
  )
);
PREPARE stmt_add_combo_product_button_title FROM @add_combo_product_button_title;
EXECUTE stmt_add_combo_product_button_title;
DEALLOCATE PREPARE stmt_add_combo_product_button_title;

SET @add_product_button_title = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'combo_box'
        AND COLUMN_NAME = 'productButtonTitle'
    ),
    'SELECT 1',
    'ALTER TABLE `combo_box` ADD COLUMN `productButtonTitle` VARCHAR(100) NULL'
  )
);
PREPARE stmt_add_product_button_title FROM @add_product_button_title;
EXECUTE stmt_add_product_button_title;
DEALLOCATE PREPARE stmt_add_product_button_title;
