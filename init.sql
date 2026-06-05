-- ============================================
-- LaundryKu Database Schema
-- Sesuai spesifikasi dokumen requirement
-- 13 tabel utama + seed data admin
-- ============================================

-- Hapus tabel jika sudah ada (urutan penting karena foreign key)
DROP TABLE IF EXISTS order_status_logs;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS courier_locations;
DROP TABLE IF EXISTS courier_assignments;
DROP TABLE IF EXISTS withdrawals;
DROP TABLE IF EXISTS wallet_transactions;
DROP TABLE IF EXISTS wallets;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS services;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;

-- ============================================
-- 1. Tabel: users
-- Menyimpan data semua pengguna sistem
-- (Customer, Owner, Kurir, Admin)
-- ============================================
CREATE TABLE users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role ENUM('customer', 'courier', 'owner', 'admin') NOT NULL,
    is_verified TINYINT(1) DEFAULT 0,
    address VARCHAR(255) NULL,
    lat DECIMAL(10,8) NULL,
    lng DECIMAL(11,8) NULL,
    vehicle_name VARCHAR(100) NULL,
    vehicle_plate_number VARCHAR(20) NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ============================================
-- 2. Tabel: sessions
-- Menyimpan token sesi aktif (untuk blacklist saat logout)
-- ============================================
CREATE TABLE sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    token TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- ============================================
-- 3. Tabel: services
-- Layanan laundry yang tersedia di platform
-- Harga customer dihitung otomatis +15% komisi admin
-- owner_id menunjukkan pemilik service
-- ============================================
CREATE TABLE services (
    service_id VARCHAR(20) PRIMARY KEY,
    owner_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT NULL,
    price_per_kg_owner DECIMAL(10,2) NOT NULL,
    price_per_kg_customer DECIMAL(10,2) NOT NULL,
    is_active TINYINT(1) DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- ============================================
-- 4. Tabel: orders
-- Mencatat setiap pesanan laundry beserta kalkulasi biaya lengkap
-- owner_id menunjukkan owner pemilik service/order
-- ============================================
CREATE TABLE orders (
    order_id VARCHAR(50) PRIMARY KEY,
    customer_id INT NOT NULL,
    owner_id INT NOT NULL,
    service_id VARCHAR(20) NOT NULL,
    pickup_address VARCHAR(255) NULL,
    pickup_lat DECIMAL(10,8) NULL,
    pickup_lng DECIMAL(11,8) NULL,
    pickup_scheduled_at DATETIME NULL,
    weight_kg DECIMAL(5,2) NULL,
    distance_km DECIMAL(8,2) NULL,
    price_per_kg_owner DECIMAL(10,2) NULL,
    price_per_kg_customer DECIMAL(10,2) NULL,
    service_fee DECIMAL(12,2) NULL,
    delivery_fee DECIMAL(12,2) NULL,
    admin_commission DECIMAL(12,2) NULL,
    owner_earning DECIMAL(12,2) NULL,
    courier_earning DECIMAL(12,2) NULL,
    total_amount DECIMAL(12,2) NULL,
    status ENUM(
        'WAITING_OWNER_CONFIRMATION',
        'CONFIRMED',
        'PICKUP_ON_THE_WAY',
        'LAUNDRY_PICKED',
        'PROCESSING',
        'READY_FOR_DELIVERY',
        'DELIVERY_ON_THE_WAY',
        'DELIVERED',
        'COMPLETED'
    ) NOT NULL DEFAULT 'WAITING_OWNER_CONFIRMATION',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (owner_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (service_id) REFERENCES services(service_id) ON DELETE CASCADE
);

-- ============================================
-- 5. Tabel: invoices
-- Tagihan yang dibuat otomatis untuk setiap pesanan
-- ============================================
CREATE TABLE invoices (
    invoice_id VARCHAR(50) PRIMARY KEY,
    order_id VARCHAR(50) NOT NULL,
    amount DECIMAL(12,2) NULL,
    service_fee DECIMAL(12,2) NULL,
    delivery_fee DECIMAL(12,2) NULL,
    status ENUM('unpaid', 'paid', 'cancelled') NOT NULL DEFAULT 'unpaid',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE
);

-- ============================================
-- 6. Tabel: payments
-- Mencatat setiap transaksi pembayaran atas suatu invoice
-- ============================================
CREATE TABLE payments (
    payment_id VARCHAR(50) PRIMARY KEY,
    invoice_id VARCHAR(50) NOT NULL,
    user_id INT NOT NULL,
    payment_method VARCHAR(50) NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    status ENUM('pending', 'success', 'failed') NOT NULL DEFAULT 'pending',
    va_number VARCHAR(50) NULL,
    paid_at DATETIME NULL,
    expired_at DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (invoice_id) REFERENCES invoices(invoice_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- ============================================
-- 7. Tabel: courier_assignments
-- Penugasan kurir per order (courier locking)
-- Satu kurir dikunci untuk seluruh siklus order (pickup + delivery)
-- ============================================
CREATE TABLE courier_assignments (
    assignment_id VARCHAR(50) PRIMARY KEY,
    order_id VARCHAR(50) NOT NULL,
    courier_id INT NOT NULL,
    current_phase ENUM('pickup', 'delivery') DEFAULT 'pickup',
    pickup_status ENUM('PICKUP_ON_THE_WAY', 'LAUNDRY_PICKED') NULL,
    delivery_status ENUM('DELIVERY_ON_THE_WAY', 'DELIVERED', 'DONE') NULL,
    locked TINYINT(1) DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_order_assignment (order_id),
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
    FOREIGN KEY (courier_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- ============================================
-- 8. Tabel: courier_locations
-- Posisi GPS kurir selama penugasan berlangsung
-- ============================================
CREATE TABLE courier_locations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    courier_id INT NOT NULL,
    assignment_id VARCHAR(50) NOT NULL,
    lat DECIMAL(10,8) NOT NULL,
    lng DECIMAL(11,8) NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (courier_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (assignment_id) REFERENCES courier_assignments(assignment_id) ON DELETE CASCADE
);

-- ============================================
-- 9. Tabel: wallets
-- Dompet digital milik owner, kurir, dan admin
-- Dibuat otomatis setelah admin verifikasi (is_verified = true)
-- ============================================
CREATE TABLE wallets (
    wallet_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    role ENUM('owner', 'courier', 'admin') NOT NULL,
    available_balance DECIMAL(12,2) DEFAULT 0.00,
    pending_balance DECIMAL(12,2) DEFAULT 0.00,
    total_earned DECIMAL(12,2) DEFAULT 0.00,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- ============================================
-- 10. Tabel: wallet_transactions
-- Setiap mutasi saldo wallet
-- ============================================
CREATE TABLE wallet_transactions (
    transaction_id VARCHAR(50) PRIMARY KEY,
    wallet_id INT NOT NULL,
    type ENUM('credit', 'debit') NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    status ENUM('pending', 'available') NOT NULL DEFAULT 'pending',
    description VARCHAR(255) NULL,
    order_id VARCHAR(50) NULL,
    source VARCHAR(100) NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (wallet_id) REFERENCES wallets(wallet_id) ON DELETE CASCADE
);

-- ============================================
-- 11. Tabel: withdrawals
-- Pengajuan penarikan saldo dari available_balance
-- ============================================
CREATE TABLE withdrawals (
    withdraw_id VARCHAR(50) PRIMARY KEY,
    wallet_id INT NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    bank_account_number VARCHAR(50) NULL,
    bank_name VARCHAR(100) NULL,
    e_wallet_number VARCHAR(50) NULL,
    e_wallet_provider VARCHAR(50) NULL,
    status ENUM('pending', 'success', 'failed') NOT NULL DEFAULT 'pending',
    note TEXT NULL,
    processed_at DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (wallet_id) REFERENCES wallets(wallet_id) ON DELETE CASCADE
);

-- ============================================
-- 12. Tabel: notifications
-- Notifikasi in-app untuk semua pengguna
-- ============================================
CREATE TABLE notifications (
    notification_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(100) NOT NULL,
    body TEXT NOT NULL,
    is_read TINYINT(1) DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- ============================================
-- 13. Tabel: order_status_logs
-- Riwayat perubahan status order
-- ============================================
CREATE TABLE order_status_logs (
    log_id INT AUTO_INCREMENT PRIMARY KEY,
    order_id VARCHAR(50) NOT NULL,
    status ENUM(
        'WAITING_OWNER_CONFIRMATION',
        'CONFIRMED',
        'PICKUP_ON_THE_WAY',
        'LAUNDRY_PICKED',
        'PROCESSING',
        'READY_FOR_DELIVERY',
        'DELIVERY_ON_THE_WAY',
        'DELIVERED',
        'COMPLETED'
    ) NOT NULL,
    changed_by INT NULL,
    changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
    FOREIGN KEY (changed_by) REFERENCES users(user_id) ON DELETE SET NULL
);

-- ============================================
-- SEED DATA: Admin User + Admin Wallet
--
-- OPSI 1: Jalankan seed.js (recommended)
--   node seed.js
--   Script akan generate hash bcrypt dan insert admin + wallet.
--
-- OPSI 2: Insert manual (ganti HASH_PASSWORD dengan hash bcrypt Anda)
--   INSERT INTO users (full_name, email, password, role, is_verified)
--   VALUES ('Admin LaundryKu', 'admin@laundryku.com', 'HASH_PASSWORD', 'admin', 1);
--   INSERT INTO wallets (user_id, role) VALUES (LAST_INSERT_ID(), 'admin');
--
-- OPSI 3: Uncomment baris di bawah (password: admin123)
--   Hash di bawah mungkin perlu digenerate ulang di environment Anda.
-- ============================================
-- INSERT INTO users (full_name, email, password, role, is_verified) VALUES
-- ('Admin LaundryKu', 'admin@laundryku.com', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin', 1);
-- INSERT INTO wallets (user_id, role) VALUES (LAST_INSERT_ID(), 'admin');
