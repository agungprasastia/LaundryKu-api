-- ============================================
-- LaundryKu Database Schema
-- Sesuai spesifikasi dokumen A-H
-- 16 tabel utama dengan UUID primary keys
-- ============================================

-- Hapus tabel jika sudah ada (untuk reset, urutan penting karena foreign key)
DROP TABLE IF EXISTS analytics_events;
DROP TABLE IF EXISTS ratings;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS courier_locations;
DROP TABLE IF EXISTS courier_assignments;
DROP TABLE IF EXISTS order_status_logs;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS customer_subscriptions;
DROP TABLE IF EXISTS subscription_plans;
DROP TABLE IF EXISTS laundry_services;
DROP TABLE IF EXISTS courier_profiles;
DROP TABLE IF EXISTS customer_profiles;
DROP TABLE IF EXISTS owner_profiles;
DROP TABLE IF EXISTS users;

-- ============================================
-- 1. Tabel: users
-- Menyimpan data semua pengguna sistem
-- ============================================
CREATE TABLE users (
    id VARCHAR(36) PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    phone VARCHAR(20),
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('customer', 'owner', 'courier', 'admin') NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 2. Tabel: owner_profiles
-- Profil tambahan untuk role owner
-- ============================================
CREATE TABLE owner_profiles (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL UNIQUE,
    shop_name VARCHAR(150),
    shop_address TEXT,
    city VARCHAR(100),
    bio TEXT,
    is_verified BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================
-- 3. Tabel: customer_profiles
-- Profil tambahan untuk role customer
-- ============================================
CREATE TABLE customer_profiles (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL UNIQUE,
    default_address TEXT,
    city VARCHAR(100),
    latitude DECIMAL(10, 7),
    longitude DECIMAL(10, 7),
    notes TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================
-- 4. Tabel: courier_profiles
-- Profil tambahan untuk role courier
-- ============================================
CREATE TABLE courier_profiles (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL UNIQUE,
    vehicle_type VARCHAR(50),
    vehicle_plate VARCHAR(20),
    is_available BOOLEAN DEFAULT TRUE,
    is_verified BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================
-- 5. Tabel: laundry_services
-- Layanan laundry yang ditawarkan setiap owner
-- ============================================
CREATE TABLE laundry_services (
    id VARCHAR(36) PRIMARY KEY,
    owner_id VARCHAR(36) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price_per_kg DECIMAL(12, 2) NOT NULL,
    minimum_kg DECIMAL(6, 2) DEFAULT 1.00,
    estimated_days INT DEFAULT 1,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================
-- 6. Tabel: subscription_plans
-- Paket langganan yang ditawarkan oleh owner
-- ============================================
CREATE TABLE subscription_plans (
    id VARCHAR(36) PRIMARY KEY,
    owner_id VARCHAR(36) NOT NULL,
    name VARCHAR(100) NOT NULL,
    period_type ENUM('weekly', 'monthly') NOT NULL,
    price DECIMAL(12, 2) NOT NULL,
    max_kg DECIMAL(6, 2),
    is_active BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================
-- 7. Tabel: customer_subscriptions
-- Langganan aktif milik setiap pelanggan
-- ============================================
CREATE TABLE customer_subscriptions (
    id VARCHAR(36) PRIMARY KEY,
    customer_id VARCHAR(36) NOT NULL,
    plan_id VARCHAR(36) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status ENUM('active', 'expired', 'cancelled') NOT NULL DEFAULT 'active',
    auto_renew BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (plan_id) REFERENCES subscription_plans(id) ON DELETE CASCADE
);

-- ============================================
-- 8. Tabel: orders
-- Pesanan laundry yang dibuat pelanggan
-- ============================================
CREATE TABLE orders (
    id VARCHAR(36) PRIMARY KEY,
    customer_id VARCHAR(36) NOT NULL,
    owner_id VARCHAR(36) NOT NULL,
    service_id VARCHAR(36) NOT NULL,
    subscription_id VARCHAR(36),
    pickup_address TEXT,
    pickup_lat DECIMAL(10, 7),
    pickup_lng DECIMAL(10, 7),
    pickup_scheduled_at TIMESTAMP NULL,
    weight_kg DECIMAL(6, 2),
    total_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
    status ENUM(
        'pending_payment', 'confirmed', 'pickup_scheduled', 'picked_up',
        'washing', 'drying', 'finished',
        'delivering', 'delivered', 'completed', 'cancelled'
    ) NOT NULL DEFAULT 'pending_payment',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (service_id) REFERENCES laundry_services(id) ON DELETE CASCADE,
    FOREIGN KEY (subscription_id) REFERENCES customer_subscriptions(id) ON DELETE SET NULL
);

-- ============================================
-- 9. Tabel: order_status_logs
-- Riwayat perubahan status pesanan (immutable log)
-- ============================================
CREATE TABLE order_status_logs (
    id VARCHAR(36) PRIMARY KEY,
    order_id VARCHAR(36) NOT NULL,
    status VARCHAR(30) NOT NULL,
    notes TEXT,
    created_by VARCHAR(36),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- ============================================
-- 10. Tabel: invoices
-- Tagihan untuk setiap pesanan
-- ============================================
CREATE TABLE invoices (
    id VARCHAR(36) PRIMARY KEY,
    order_id VARCHAR(36) NOT NULL UNIQUE,
    invoice_number VARCHAR(50) NOT NULL UNIQUE,
    amount DECIMAL(12, 2) NOT NULL,
    issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    due_at TIMESTAMP NULL,
    status ENUM('unpaid', 'paid', 'expired', 'cancelled') NOT NULL DEFAULT 'unpaid',
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

-- ============================================
-- 11. Tabel: payments
-- Percobaan pembayaran terhadap satu invoice
-- ============================================
CREATE TABLE payments (
    id VARCHAR(36) PRIMARY KEY,
    invoice_id VARCHAR(36) NOT NULL,
    provider VARCHAR(50),
    payment_method VARCHAR(50),
    amount DECIMAL(12, 2) NOT NULL,
    external_reference VARCHAR(100),
    status ENUM('pending', 'paid', 'failed', 'expired') NOT NULL DEFAULT 'pending',
    paid_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

-- ============================================
-- 12. Tabel: courier_assignments
-- Penugasan kurir untuk pickup atau delivery
-- ============================================
CREATE TABLE courier_assignments (
    id VARCHAR(36) PRIMARY KEY,
    order_id VARCHAR(36) NOT NULL,
    courier_id VARCHAR(36) NOT NULL,
    task_type ENUM('pickup', 'delivery') NOT NULL,
    status ENUM('assigned', 'on_the_way', 'arrived', 'done', 'cancelled') NOT NULL DEFAULT 'assigned',
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    done_at TIMESTAMP NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (courier_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================
-- 13. Tabel: courier_locations
-- Riwayat posisi GPS kurir selama penugasan
-- ============================================
CREATE TABLE courier_locations (
    id VARCHAR(36) PRIMARY KEY,
    courier_id VARCHAR(36) NOT NULL,
    assignment_id VARCHAR(36),
    lat DECIMAL(10, 7) NOT NULL,
    lng DECIMAL(10, 7) NOT NULL,
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (courier_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (assignment_id) REFERENCES courier_assignments(id) ON DELETE SET NULL
);

-- ============================================
-- 14. Tabel: notifications
-- In-system notification untuk semua pengguna
-- ============================================
CREATE TABLE notifications (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    channel ENUM('in_app') NOT NULL DEFAULT 'in_app',
    subject VARCHAR(150),
    message TEXT NOT NULL,
    status ENUM('queued', 'sent', 'failed') NOT NULL DEFAULT 'queued',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sent_at TIMESTAMP NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================
-- 15. Tabel: ratings
-- Rating dan ulasan dari pelanggan
-- ============================================
CREATE TABLE ratings (
    id VARCHAR(36) PRIMARY KEY,
    order_id VARCHAR(36) NOT NULL UNIQUE,
    customer_id VARCHAR(36) NOT NULL,
    score INT NOT NULL CHECK (score >= 1 AND score <= 5),
    review TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================
-- 16. Tabel: analytics_events
-- Event bisnis untuk keperluan analitik
-- ============================================
CREATE TABLE analytics_events (
    id VARCHAR(36) PRIMARY KEY,
    event_name VARCHAR(100) NOT NULL,
    user_id VARCHAR(36),
    order_id VARCHAR(36),
    event_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    event_payload TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
);
