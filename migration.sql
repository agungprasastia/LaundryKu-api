-- ============================================
-- LaundryKu Database Migration
-- Untuk database existing yang sudah punya data
-- 
-- Jalankan: mysql -u root -p laundry_db < migration.sql
--
-- Script ini AMAN untuk dijalankan berulang kali.
-- Data existing TIDAK akan dihapus.
-- ============================================

-- ============================================
-- Step 1: Tambah kolom owner_id ke services (jika belum ada)
-- ============================================
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'services' AND COLUMN_NAME = 'owner_id');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE services ADD COLUMN owner_id INT NULL AFTER service_id', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================
-- Step 2: Backfill owner_id di services (uncomment dan sesuaikan jika perlu)
-- ============================================
-- UPDATE services SET owner_id = (SELECT user_id FROM users WHERE role = 'owner' LIMIT 1) WHERE owner_id IS NULL;

-- ============================================
-- Step 3: Setelah backfill selesai, ubah ke NOT NULL + FK (uncomment jika sudah backfill)
-- ============================================
-- ALTER TABLE services MODIFY COLUMN owner_id INT NOT NULL;
-- ALTER TABLE services ADD CONSTRAINT fk_services_owner FOREIGN KEY (owner_id) REFERENCES users(user_id) ON DELETE CASCADE;

-- ============================================
-- Step 4: Tambah kolom owner_id ke orders (jika belum ada)
-- ============================================
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'owner_id');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE orders ADD COLUMN owner_id INT NULL AFTER customer_id', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================
-- Step 5: Backfill owner_id di orders (uncomment dan sesuaikan jika perlu)
-- ============================================
-- UPDATE orders o JOIN services s ON o.service_id = s.service_id SET o.owner_id = s.owner_id WHERE o.owner_id IS NULL;

-- ============================================
-- Step 6: Setelah backfill selesai, ubah ke NOT NULL + FK (uncomment jika sudah backfill)
-- ============================================
-- ALTER TABLE orders MODIFY COLUMN owner_id INT NOT NULL;
-- ALTER TABLE orders ADD CONSTRAINT fk_orders_owner FOREIGN KEY (owner_id) REFERENCES users(user_id) ON DELETE CASCADE;

-- ============================================
-- Step 7: Seed admin user (skip jika sudah ada)
-- Password: admin123
-- ============================================
INSERT IGNORE INTO users (full_name, email, password, role, is_verified) VALUES
('Admin LaundryKu', 'admin@laundryku.com', '$2a$10$xQa1NZiHMiXGjCQh1bB8OOgPbFz8FZnX4kYeKzA6RvNqLGCNx5Wy', 'admin', 1);

-- ============================================
-- Step 8: Buat wallet admin (skip jika sudah ada)
-- ============================================
INSERT INTO wallets (user_id, role) 
SELECT user_id, 'admin' FROM users 
WHERE email = 'admin@laundryku.com' 
AND user_id NOT IN (SELECT user_id FROM wallets WHERE role = 'admin');

-- ============================================
-- Step 9: Perbesar kolom ID dari VARCHAR(30) ke VARCHAR(50)
-- Diperlukan karena ID generator sekarang pakai crypto random suffix
-- AMAN: MODIFY hanya mengubah max length, data tetap utuh
--
-- MariaDB (XAMPP) tidak support FOREIGN_KEY_CHECKS untuk MODIFY,
-- jadi kita drop FK dulu, modify, lalu re-add FK.
-- ============================================
DELIMITER //
DROP PROCEDURE IF EXISTS resize_id_columns//
CREATE PROCEDURE resize_id_columns()
BEGIN
  -- Drop semua FK yang mereferensi kolom yang akan di-modify
  -- Child tables dulu (yang punya FK ke orders.order_id, invoices.invoice_id, dll)

  -- courier_assignments → orders
  SET @fk = (SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'courier_assignments'
    AND COLUMN_NAME = 'order_id' AND REFERENCED_TABLE_NAME = 'orders' LIMIT 1);
  IF @fk IS NOT NULL THEN
    SET @sql = CONCAT('ALTER TABLE courier_assignments DROP FOREIGN KEY ', @fk);
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;

  -- courier_locations → courier_assignments
  SET @fk = (SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'courier_locations'
    AND COLUMN_NAME = 'assignment_id' AND REFERENCED_TABLE_NAME = 'courier_assignments' LIMIT 1);
  IF @fk IS NOT NULL THEN
    SET @sql = CONCAT('ALTER TABLE courier_locations DROP FOREIGN KEY ', @fk);
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;

  -- invoices → orders
  SET @fk = (SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoices'
    AND COLUMN_NAME = 'order_id' AND REFERENCED_TABLE_NAME = 'orders' LIMIT 1);
  IF @fk IS NOT NULL THEN
    SET @sql = CONCAT('ALTER TABLE invoices DROP FOREIGN KEY ', @fk);
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;

  -- payments → invoices
  SET @fk = (SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments'
    AND COLUMN_NAME = 'invoice_id' AND REFERENCED_TABLE_NAME = 'invoices' LIMIT 1);
  IF @fk IS NOT NULL THEN
    SET @sql = CONCAT('ALTER TABLE payments DROP FOREIGN KEY ', @fk);
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;

  -- order_status_logs → orders
  SET @fk = (SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_status_logs'
    AND COLUMN_NAME = 'order_id' AND REFERENCED_TABLE_NAME = 'orders' LIMIT 1);
  IF @fk IS NOT NULL THEN
    SET @sql = CONCAT('ALTER TABLE order_status_logs DROP FOREIGN KEY ', @fk);
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;

  -- Modify semua kolom ID
  ALTER TABLE order_status_logs MODIFY COLUMN order_id VARCHAR(50);
  ALTER TABLE wallet_transactions MODIFY COLUMN transaction_id VARCHAR(50);
  ALTER TABLE wallet_transactions MODIFY COLUMN order_id VARCHAR(50);
  ALTER TABLE withdrawals MODIFY COLUMN withdraw_id VARCHAR(50);
  ALTER TABLE courier_locations MODIFY COLUMN assignment_id VARCHAR(50);
  ALTER TABLE payments MODIFY COLUMN payment_id VARCHAR(50);
  ALTER TABLE payments MODIFY COLUMN invoice_id VARCHAR(50);
  ALTER TABLE courier_assignments MODIFY COLUMN assignment_id VARCHAR(50);
  ALTER TABLE courier_assignments MODIFY COLUMN order_id VARCHAR(50);
  ALTER TABLE invoices MODIFY COLUMN invoice_id VARCHAR(50);
  ALTER TABLE invoices MODIFY COLUMN order_id VARCHAR(50);
  ALTER TABLE orders MODIFY COLUMN order_id VARCHAR(50);

  -- Re-add FK constraints
  ALTER TABLE courier_assignments ADD CONSTRAINT fk_ca_order
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE;
  ALTER TABLE courier_locations ADD CONSTRAINT fk_cl_assignment
    FOREIGN KEY (assignment_id) REFERENCES courier_assignments(assignment_id) ON DELETE CASCADE;
  ALTER TABLE invoices ADD CONSTRAINT fk_inv_order
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE;
  ALTER TABLE payments ADD CONSTRAINT fk_pay_invoice
    FOREIGN KEY (invoice_id) REFERENCES invoices(invoice_id) ON DELETE CASCADE;
  ALTER TABLE order_status_logs ADD CONSTRAINT fk_osl_order
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE;

  SELECT '✅ Step 9: Semua kolom ID berhasil di-resize ke VARCHAR(50)' AS result;
END//
DELIMITER ;

CALL resize_id_columns();
DROP PROCEDURE IF EXISTS resize_id_columns;

-- ============================================
-- Step 10: Tambah UNIQUE constraint pada courier_assignments.order_id
-- Mencegah double assignment pada satu order
-- Cek dulu apakah sudah ada sebelum tambahkan
-- ============================================
DELIMITER //
DROP PROCEDURE IF EXISTS add_unique_order_assignment//
CREATE PROCEDURE add_unique_order_assignment()
BEGIN
  DECLARE idx_exists INT DEFAULT 0;
  SELECT COUNT(*) INTO idx_exists 
  FROM information_schema.STATISTICS 
  WHERE TABLE_SCHEMA = DATABASE() 
    AND TABLE_NAME = 'courier_assignments' 
    AND INDEX_NAME = 'unique_order_assignment';
  
  IF idx_exists = 0 THEN
    ALTER TABLE courier_assignments ADD UNIQUE KEY unique_order_assignment (order_id);
    SELECT '✅ UNIQUE KEY added on courier_assignments.order_id' AS result;
  ELSE
    SELECT '✅ UNIQUE KEY already exists, skipped' AS result;
  END IF;
END//
DELIMITER ;

CALL add_unique_order_assignment();
DROP PROCEDURE IF EXISTS add_unique_order_assignment;

-- ============================================
-- SELESAI
-- ============================================
SELECT '✅ Migration selesai. Data existing AMAN.' AS status;
