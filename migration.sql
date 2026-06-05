-- ============================================
-- LaundryKu Database Migration
-- Untuk database existing yang sudah punya data
-- 
-- CATATAN: Jika ini database baru atau tidak ada data penting,
-- lebih mudah re-import init.sql langsung:
--   mysql -u root laundryku_db < init.sql
--
-- Migration ini hanya untuk yang sudah punya data dan 
-- tidak ingin kehilangan data existing.
-- ============================================

-- ============================================
-- Step 1: Tambah kolom owner_id ke services (nullable dulu)
-- ============================================
ALTER TABLE services ADD COLUMN owner_id INT NULL AFTER service_id;

-- ============================================
-- Step 2: Backfill owner_id di services
-- Jika ada owner yang sudah ada, set owner_id ke owner pertama
-- Sesuaikan query ini dengan data Anda
-- ============================================
-- UPDATE services SET owner_id = (SELECT user_id FROM users WHERE role = 'owner' LIMIT 1) WHERE owner_id IS NULL;

-- ============================================
-- Step 3: Setelah backfill selesai, ubah ke NOT NULL + FK
-- Jalankan setelah Step 2 berhasil
-- ============================================
-- ALTER TABLE services MODIFY COLUMN owner_id INT NOT NULL;
-- ALTER TABLE services ADD CONSTRAINT fk_services_owner FOREIGN KEY (owner_id) REFERENCES users(user_id) ON DELETE CASCADE;

-- ============================================
-- Step 4: Tambah kolom owner_id ke orders (nullable dulu)
-- ============================================
ALTER TABLE orders ADD COLUMN owner_id INT NULL AFTER customer_id;

-- ============================================
-- Step 5: Backfill owner_id di orders dari service
-- ============================================
-- UPDATE orders o JOIN services s ON o.service_id = s.service_id SET o.owner_id = s.owner_id WHERE o.owner_id IS NULL;

-- ============================================
-- Step 6: Setelah backfill selesai, ubah ke NOT NULL + FK
-- ============================================
-- ALTER TABLE orders MODIFY COLUMN owner_id INT NOT NULL;
-- ALTER TABLE orders ADD CONSTRAINT fk_orders_owner FOREIGN KEY (owner_id) REFERENCES users(user_id) ON DELETE CASCADE;

-- ============================================
-- Step 7: Seed admin user (jika belum ada)
-- Password: admin123
-- ============================================
INSERT IGNORE INTO users (full_name, email, password, role, is_verified) VALUES
('Admin LaundryKu', 'admin@laundryku.com', '$2a$10$xQa1NZiHMiXGjCQh1bB8OOgPbFz8FZnX4kYeKzA6RvNqLGCNx5Wy', 'admin', 1);

-- ============================================
-- Step 8: Buat wallet admin (jika belum ada)
-- ============================================
INSERT INTO wallets (user_id, role) 
SELECT user_id, 'admin' FROM users 
WHERE email = 'admin@laundryku.com' 
AND user_id NOT IN (SELECT user_id FROM wallets WHERE role = 'admin');
