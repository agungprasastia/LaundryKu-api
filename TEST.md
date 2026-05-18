# LaundryKu API — Panduan Testing (PDF v2)

## Setup

1. Import `init.sql` ke MySQL (XAMPP):
   ```
   mysql -u root laundry_db < init.sql
   ```
2. Copy `.env.example` ke `.env` dan sesuaikan
3. Jalankan server: `node app.js`

---

## Flow Testing Lengkap (40 Endpoint)

### 1. AUTH — Register & Login

```
# 1.1 Register Admin
POST /auth/register
{ "full_name": "Admin LaundryKu", "email": "admin@laundryku.com", "password": "admin123", "role": "admin" }

# 1.2 Register Owner
POST /auth/register
{ "full_name": "Laundry Bahagia", "email": "owner@laundryku.com", "password": "owner123", "role": "owner", "address": "Jl. Mappaoddang No. 10, Makassar" }

# 1.3 Register Customer
POST /auth/register
{ "full_name": "Ahmad Customer", "email": "customer@laundryku.com", "password": "cust123", "role": "customer", "address": "Jl. Sultan Alauddin No. 5, Gowa", "lat": -5.2, "lng": 119.5 }

# 1.4 Register Courier
POST /auth/register
{ "full_name": "Agung Prasasti", "email": "courier@laundryku.com", "password": "courier123", "role": "courier", "vehicle_name": "Honda Beat Hitam", "vehicle_plate_number": "DD 1234 AB" }

# 1.5 Login
POST /auth/login
{ "email": "admin@laundryku.com", "password": "admin123" }
→ Simpan access_token untuk semua request berikutnya

# 1.6 Get Profile
GET /auth/profile
Authorization: Bearer <token>

# 1.7 Edit Profile
PATCH /auth/profile
Authorization: Bearer <token>
{ "full_name": "Admin LaundryKu Updated" }

# 1.8 Logout
POST /auth/logout
Authorization: Bearer <token>
```

### 2. ADMIN — Verifikasi & Wallet Setup

```
# Login sebagai Admin terlebih dahulu
# Buat wallet admin manual:
# INSERT INTO wallets (user_id, role) VALUES (<admin_id>, 'admin');

# 2.1 Verifikasi Owner (otomatis buat wallet)
PATCH /admin/users/<owner_id>/verify
Authorization: Bearer <admin_token>
{ "is_verified": true }

# 2.2 Verifikasi Courier (otomatis buat wallet)
PATCH /admin/users/<courier_id>/verify
Authorization: Bearer <admin_token>
{ "is_verified": true }
```

### 3. SERVICES — CRUD Layanan

```
# Login sebagai Owner

# 3.1 Create Service
POST /services
Authorization: Bearer <owner_token>
{ "service_id": "SVC001", "name": "Cuci & Setrika", "description": "Cuci bersih dan setrika rapi", "price_per_kg_owner": 7000 }
→ Cek price_per_kg_customer = 8050 (7000 × 1.15)

# 3.2 Create Service 2
POST /services
Authorization: Bearer <owner_token>
{ "service_id": "SVC002", "name": "Dry Clean", "description": "Dry cleaning premium", "price_per_kg_owner": 15000 }

# 3.3 Get All Services
GET /services
Authorization: Bearer <any_token>

# 3.4 Get Service Detail
GET /services/SVC001
Authorization: Bearer <any_token>

# 3.5 Update Service
PATCH /services/SVC001
Authorization: Bearer <owner_token>
{ "price_per_kg_owner": 8000 }

# 3.6 Delete Service
DELETE /services/SVC002
Authorization: Bearer <owner_token>
```

### 4. ORDERS — Alur Pesanan

```
# Login sebagai Customer

# 4.1 Create Order
POST /orders
Authorization: Bearer <customer_token>
{ "service_id": "SVC001", "pickup_address": "Jl. Sultan Alauddin No. 5, Gowa", "pickup_lat": -5.2, "pickup_lng": 119.5 }
→ Simpan order_id dan invoice_id

# 4.2 Get My Orders
GET /orders/my-orders
Authorization: Bearer <customer_token>

# Login sebagai Owner

# 4.3 Update Status → CONFIRMED
PATCH /orders/<order_id>/status
Authorization: Bearer <owner_token>
{ "status": "CONFIRMED" }

# 4.4 Assign Courier (courier locking)
POST /orders/<order_id>/assign-courier
Authorization: Bearer <owner_token>
{ "courier_id": <courier_user_id> }
→ Simpan assignment_id

# 4.5 Input Berat (auto kalkulasi biaya)
PATCH /orders/<order_id>/weight
Authorization: Bearer <owner_token>
{ "weight_kg": 3.5 }
→ Cek: service_fee, delivery_fee, admin_commission, owner_earning, courier_earning, total_amount

# 4.6 Get Order Detail
GET /orders/<order_id>
Authorization: Bearer <any_token>
```

### 5. COURIER — Pickup Phase

```
# Login sebagai Courier

# 5.1 Update Task Status → PICKUP_ON_THE_WAY
PATCH /couriers/tasks/<assignment_id>/status
Authorization: Bearer <courier_token>
{ "status": "PICKUP_ON_THE_WAY" }
→ Order status juga berubah ke PICKUP_ON_THE_WAY

# 5.2 Update Lokasi
PATCH /couriers/me/location
Authorization: Bearer <courier_token>
{ "lat": -5.185, "lng": 119.462, "assignment_id": "<assignment_id>" }

# 5.3 Update Task Status → LAUNDRY_PICKED
PATCH /couriers/tasks/<assignment_id>/status
Authorization: Bearer <courier_token>
{ "status": "LAUNDRY_PICKED" }
→ Order status → LAUNDRY_PICKED

# 5.4 Get Active Tasks
GET /couriers/me/tasks
Authorization: Bearer <courier_token>
```

### 6. OWNER — Processing & Delivery

```
# Login sebagai Owner

# 6.1 Update Status → PROCESSING
PATCH /orders/<order_id>/status
Authorization: Bearer <owner_token>
{ "status": "PROCESSING" }

# 6.2 Update Status → READY_FOR_DELIVERY
PATCH /orders/<order_id>/status
Authorization: Bearer <owner_token>
{ "status": "READY_FOR_DELIVERY" }

# 6.3 Aktifkan Fase Delivery (switch courier phase)
PATCH /orders/<order_id>/activate-delivery
Authorization: Bearer <owner_token>
```

### 7. PAYMENTS — Invoice & Pembayaran

```
# Login sebagai Customer

# 7.1 Lihat Invoice
GET /payments/invoice/<invoice_id>
Authorization: Bearer <customer_token>

# 7.2 Bayar Invoice
POST /payments
Authorization: Bearer <customer_token>
{ "invoice_id": "<invoice_id>", "payment_method": "virtual_account" }
→ Simpan payment_id

# 7.3 Simulasi Callback (tanpa auth)
POST /payments/callback
{ "payment_id": "<payment_id>", "status": "success" }
→ Saldo didistribusikan ke pending balance
```

### 8. COURIER — Delivery Phase

```
# Login sebagai Courier

# 8.1 Update Task Status → DELIVERY_ON_THE_WAY
PATCH /couriers/tasks/<assignment_id>/status
Authorization: Bearer <courier_token>
{ "status": "DELIVERY_ON_THE_WAY" }

# 8.2 Track Order (sebagai Customer)
GET /orders/<order_id>/tracking
Authorization: Bearer <customer_token>

# 8.3 Update Task Status → DELIVERED
PATCH /couriers/tasks/<assignment_id>/status
Authorization: Bearer <courier_token>
{ "status": "DELIVERED" }

# 8.4 Update Task Status → DONE (→ Order = DELIVERED)
PATCH /couriers/tasks/<assignment_id>/status
Authorization: Bearer <courier_token>
{ "status": "DONE" }
```

### 9. CUSTOMER — Konfirmasi Selesai

```
# 9.1 Complete Order (release pending → available balance)
PATCH /orders/<order_id>/complete
Authorization: Bearer <customer_token>
→ Saldo owner & kurir dirilis ke available_balance
```

### 10. WALLETS

```
# Login sebagai Owner/Courier

# 10.1 Lihat Saldo
GET /wallets/me
Authorization: Bearer <owner_token>

# 10.2 Riwayat Transaksi
GET /wallets/me/transactions?page=1&limit=10
Authorization: Bearer <owner_token>

# 10.3 Withdraw
POST /wallets/me/withdraw
Authorization: Bearer <owner_token>
{ "amount": 24500, "bank_account_number": "1234567890", "bank_name": "BCA" }

# 10.4 Riwayat Withdraw
GET /wallets/me/withdrawals
Authorization: Bearer <owner_token>
```

### 11. ADMIN — Proses Withdraw & Analytics

```
# Login sebagai Admin

# 11.1 Proses Withdraw
PATCH /admin/wallets/withdrawals/<withdraw_id>/process
Authorization: Bearer <admin_token>
{ "status": "success", "note": "Transfer berhasil via BCA" }

# 11.2 Lihat Wallet Admin
GET /admin/wallets/me
Authorization: Bearer <admin_token>

# 11.3 Dashboard Metrics
GET /admin/dashboard/metrics?date_from=2026-01-01&date_to=2026-12-31
Authorization: Bearer <admin_token>

# 11.4 Admin Analytics
GET /admin/analytics?date_from=2026-01-01&date_to=2026-12-31
Authorization: Bearer <admin_token>
```

### 12. NOTIFICATIONS

```
# 12.1 Get Notifications
GET /notifications
Authorization: Bearer <any_token>

# 12.2 Mark as Read
PATCH /notifications/<notification_id>/read
Authorization: Bearer <any_token>
```

### 13. REPORTS

```
# 13.1 Owner Report Summary
GET /owner/reports/summary?date_from=2026-01-01&date_to=2026-12-31
Authorization: Bearer <owner_token>

# 13.2 Courier Earnings
GET /couriers/me/earnings?date_from=2026-01-01&date_to=2026-12-31
Authorization: Bearer <courier_token>

# 13.3 Customer Order History
GET /orders/my-orders/history?page=1&limit=20
Authorization: Bearer <customer_token>
```
