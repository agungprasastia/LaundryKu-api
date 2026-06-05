# LaundryKu API — Panduan Testing

## Setup

1. Buat database di MySQL:
   ```sql
   CREATE DATABASE laundryku_db;
   ```

2. Import schema:
   ```bash
   mysql -u root -p laundryku_db < init.sql
   ```

3. Copy `.env.example` ke `.env` dan sesuaikan:
   ```bash
   cp .env.example .env
   ```

4. Install dependencies:
   ```bash
   npm install
   ```

5. Seed admin user:
   ```bash
   node seed.js
   ```

6. Jalankan server:
   ```bash
   npm start
   ```

---

## ⚠️ Catatan Penting

- **Admin tidak bisa register dari API public**. Gunakan `node seed.js`.
- **Owner/courier harus diverifikasi admin** sebelum bisa menggunakan fitur utama.
- **Distance dihitung dengan Haversine Formula** dari koordinat GPS pickup customer ke koordinat owner. Tidak menggunakan Google Maps API.
- Jika koordinat tidak lengkap, owner bisa kirim `distance_km` manual di request body (jika `ALLOW_MANUAL_DISTANCE=true` di `.env`).
- **Payment signature** di development bisa diskip jika `PAYMENT_GATEWAY_SECRET=change_this_payment_secret`.

---

## Flow Testing Lengkap

### 1. AUTH — Register & Login

```
# 1.1 Register Admin (HARUS DITOLAK!)
POST /auth/register
{
  "full_name": "Hacker",
  "email": "hacker@test.com",
  "password": "hacker123",
  "role": "admin"
}
→ Expected: 403 "Role admin tidak boleh didaftarkan dari endpoint ini"

# 1.2 Register Owner
POST /auth/register
{
  "full_name": "Laundry Bahagia",
  "email": "owner@laundryku.com",
  "password": "owner123",
  "role": "owner",
  "address": "Jl. Mappaoddang No. 10, Makassar",
  "lat": -5.15,
  "lng": 119.43
}
→ is_verified: false
→ Simpan access_token sebagai owner_token

# 1.3 Register Customer
POST /auth/register
{
  "full_name": "Ahmad Customer",
  "email": "customer@laundryku.com",
  "password": "cust123",
  "role": "customer",
  "address": "Jl. Sultan Alauddin No. 5, Gowa",
  "lat": -5.2,
  "lng": 119.5
}
→ is_verified: true (customer langsung aktif)
→ Simpan access_token sebagai customer_token

# 1.4 Register Courier
POST /auth/register
{
  "full_name": "Agung Kurir",
  "email": "courier@laundryku.com",
  "password": "courier123",
  "role": "courier",
  "vehicle_name": "Honda Beat Hitam",
  "vehicle_plate_number": "DD 1234 AB"
}
→ is_verified: false
→ Simpan access_token sebagai courier_token

# 1.5 Login Admin
POST /auth/login
{ "email": "admin@laundryku.com", "password": "admin123" }
→ Simpan access_token sebagai admin_token

# 1.6 Get Profile
GET /auth/profile
Authorization: Bearer <any_token>

# 1.7 Edit Profile
PATCH /auth/profile
Authorization: Bearer <any_token>
{ "full_name": "Nama Baru" }

# 1.8 Logout
POST /auth/logout
Authorization: Bearer <token>
```

### 2. VERIFIKASI — Owner belum verified tidak bisa akses fitur

```
# 2.1 Owner coba create service SEBELUM verified (HARUS DITOLAK!)
POST /services
Authorization: Bearer <owner_token>
{
  "service_id": "SVC001",
  "name": "Cuci & Setrika",
  "price_per_kg_owner": 7000
}
→ Expected: 403 "Account not verified"

# 2.2 Admin verifikasi owner (otomatis buat wallet)
PATCH /admin/users/<owner_id>/verify
Authorization: Bearer <admin_token>
{ "is_verified": true }
→ wallet_created: true

# 2.3 Admin verifikasi courier (otomatis buat wallet)
PATCH /admin/users/<courier_id>/verify
Authorization: Bearer <admin_token>
{ "is_verified": true }
→ wallet_created: true

# 2.4 Lihat users pending (seharusnya kosong setelah verify semua)
GET /admin/users/pending
Authorization: Bearer <admin_token>
```

### 3. SERVICES — CRUD Layanan (setelah owner verified)

```
# Owner harus login ulang setelah verified (atau pakai token yang sama)

# 3.1 Create Service
POST /services
Authorization: Bearer <owner_token>
{
  "service_id": "SVC001",
  "name": "Cuci & Setrika",
  "description": "Cuci bersih dan setrika rapi",
  "price_per_kg_owner": 7000
}
→ price_per_kg_customer = 8050 (7000 × 1.15)
→ owner_id = <owner_id>

# 3.2 Create Service 2
POST /services
Authorization: Bearer <owner_token>
{
  "service_id": "SVC002",
  "name": "Dry Clean",
  "description": "Dry cleaning premium",
  "price_per_kg_owner": 15000
}

# 3.3 Get All Services (sebagai customer — hanya active)
GET /services
Authorization: Bearer <customer_token>

# 3.4 Get All Services (sebagai owner — semua miliknya)
GET /services
Authorization: Bearer <owner_token>

# 3.5 Update Service
PATCH /services/SVC001
Authorization: Bearer <owner_token>
{ "price_per_kg_owner": 8000 }
→ price_per_kg_customer otomatis terupdate

# 3.6 Delete Service
DELETE /services/SVC002
Authorization: Bearer <owner_token>
```

### 4. ORDERS — Buat Pesanan

```
# Login sebagai Customer

# 4.1 Create Order
POST /orders
Authorization: Bearer <customer_token>
{
  "service_id": "SVC001",
  "pickup_address": "Jl. Sultan Alauddin No. 5, Gowa",
  "pickup_lat": -5.2,
  "pickup_lng": 119.5,
  "pickup_scheduled_at": "2026-06-10T10:00:00"
}
→ status: WAITING_OWNER_CONFIRMATION
→ Simpan order_id dan invoice_id

# 4.2 Get My Orders
GET /orders/my-orders
Authorization: Bearer <customer_token>

# 4.3 Owner lihat orders miliknya
GET /owner/orders
Authorization: Bearer <owner_token>
```

### 5. OWNER — Konfirmasi & Assign

```
# Login sebagai Owner

# 5.1 Konfirmasi Order → CONFIRMED
PATCH /orders/<order_id>/status
Authorization: Bearer <owner_token>
{ "status": "CONFIRMED" }

# 5.2 Lihat courier tersedia
GET /couriers/available
Authorization: Bearer <owner_token>

# 5.3 Assign Courier (courier locking)
POST /orders/<order_id>/assign-courier
Authorization: Bearer <owner_token>
{ "courier_id": <courier_user_id> }
→ Simpan assignment_id
→ Coba assign ulang → Expected: 409 "Courier already locked"
```

### 6. COURIER — Pickup Phase

```
# Login sebagai Courier

# 6.1 Lihat Tugas Aktif (harus muncul meski delivery_status NULL!)
GET /couriers/me/tasks
Authorization: Bearer <courier_token>

# 6.2 Update Task Status → PICKUP_ON_THE_WAY
PATCH /couriers/tasks/<assignment_id>/status
Authorization: Bearer <courier_token>
{ "status": "PICKUP_ON_THE_WAY" }
→ Order status → PICKUP_ON_THE_WAY

# 6.3 Update Lokasi
PATCH /couriers/me/location
Authorization: Bearer <courier_token>
{ "lat": -5.185, "lng": 119.462, "assignment_id": "<assignment_id>" }

# 6.4 Update Task Status → LAUNDRY_PICKED
PATCH /couriers/tasks/<assignment_id>/status
Authorization: Bearer <courier_token>
{ "status": "LAUNDRY_PICKED" }
→ Order status → LAUNDRY_PICKED
```

### 7. OWNER — Input Berat & Kalkulasi

```
# Login sebagai Owner

# 7.1a Input Berat (Haversine auto — koordinat lengkap)
# Jarak dihitung otomatis dari koordinat pickup customer (-5.2, 119.5)
# ke koordinat owner (-5.15, 119.43)
# Haversine ≈ 9.36 km (tergantung koordinat yang didaftarkan)
PATCH /orders/<order_id>/weight
Authorization: Bearer <owner_token>
{ "weight_kg": 3.5 }
→ distance_source: "haversine"
→ distance_km: ~9.36 (estimasi berdasarkan koordinat contoh di atas)

# 7.1b Input Berat (Manual fallback — jika koordinat tidak lengkap)
# Set ALLOW_MANUAL_DISTANCE=true di .env
PATCH /orders/<order_id>/weight
Authorization: Bearer <owner_token>
{ "weight_kg": 3.5, "distance_km": 5 }
→ distance_source: "manual"
→ distance_km: 5

→ Verifikasi hasil kalkulasi (contoh dengan distance_km = 5):
  price_per_kg_owner: 8000
  price_per_kg_customer: 9200 (8000 × 1.15)
  service_fee: 32200 (3.5 × 9200)
  delivery_fee: 15000 (5 × 2 × 1500)
  admin_commission: 4200 (3.5 × (9200 - 8000))
  owner_earning: 28000 (3.5 × 8000)
  courier_earning: 12500 (5 × 2 × 1250)
  total_amount: 47200 (32200 + 15000)

# 7.2 Lihat Invoice
GET /payments/invoice/<invoice_id>
Authorization: Bearer <customer_token>
→ amount = 47200
```

### 8. PAYMENT — Bayar via Midtrans Sandbox

```
# Login sebagai Customer

# 8.1 Bayar Invoice (Midtrans Snap)
POST /payments
Authorization: Bearer <customer_token>
{
  "invoice_id": "<invoice_id>"
}
→ Simpan payment_id, snap_token, redirect_url
→ Buka redirect_url di browser untuk simulasi pembayaran Midtrans Sandbox
→ Atau gunakan snap_token di Flutter dengan Midtrans Snap SDK

# 8.2 Simulasi Callback Midtrans (Sandbox)
# Midtrans Sandbox akan mengirim notification otomatis ke /payments/callback
# setelah pembayaran di halaman Snap selesai.
#
# Untuk test manual, kirim format notification Midtrans:
POST /payments/callback
{
  "order_id": "<payment_id>",
  "status_code": "200",
  "gross_amount": "47200.00",
  "signature_key": "<sha512_signature>",
  "transaction_status": "settlement",
  "payment_type": "bank_transfer",
  "fraud_status": "accept"
}

# Cara generate signature_key:
# SHA512(<payment_id> + "200" + "47200.00" + <MIDTRANS_SERVER_KEY>)
→ Order status → PROCESSING
→ Wallet distributed: true

# 8.3 Callback Ulang (test idempotent)
POST /payments/callback
{ ...same body as above... }
→ "Payment already processed as success. No action taken."
→ Tidak ada wallet transaction baru
```

### 9. OWNER — Processing & Delivery

```
# Login sebagai Owner

# 9.1 Update Status → READY_FOR_DELIVERY
PATCH /orders/<order_id>/status
Authorization: Bearer <owner_token>
{ "status": "READY_FOR_DELIVERY" }

# 9.2 Aktifkan Fase Delivery
PATCH /orders/<order_id>/activate-delivery
Authorization: Bearer <owner_token>
```

### 10. COURIER — Delivery Phase

```
# Login sebagai Courier

# 10.1 Update Task → DELIVERY_ON_THE_WAY
PATCH /couriers/tasks/<assignment_id>/status
Authorization: Bearer <courier_token>
{ "status": "DELIVERY_ON_THE_WAY" }
→ Order status → DELIVERY_ON_THE_WAY

# 10.2 Track Order (sebagai Customer)
GET /orders/<order_id>/tracking
Authorization: Bearer <customer_token>

# 10.3 Update Task → DELIVERED
PATCH /couriers/tasks/<assignment_id>/status
Authorization: Bearer <courier_token>
{ "status": "DELIVERED" }

# 10.4 Update Task → DONE (→ Order = DELIVERED)
PATCH /couriers/tasks/<assignment_id>/status
Authorization: Bearer <courier_token>
{ "status": "DONE" }
→ Order status → DELIVERED
```

### 11. CUSTOMER — Konfirmasi Selesai

```
# 11.1 Complete Order (release pending → available balance)
PATCH /orders/<order_id>/complete
Authorization: Bearer <customer_token>
→ balance_released: true
→ released_to: { owner: {...}, courier: {...} }

# 11.2 Complete ulang (test idempotent)
PATCH /orders/<order_id>/complete
Authorization: Bearer <customer_token>
→ "Order already completed" (tidak dobel)
```

### 12. WALLETS

```
# Login sebagai Owner

# 12.1 Lihat Saldo
GET /wallets/me
Authorization: Bearer <owner_token>
→ available_balance = 28000 (owner_earning)
→ pending_balance = 0

# 12.2 Riwayat Transaksi
GET /wallets/me/transactions?page=1&limit=10
Authorization: Bearer <owner_token>

# 12.3 Withdraw
POST /wallets/me/withdraw
Authorization: Bearer <owner_token>
{
  "amount": 20000,
  "bank_account_number": "1234567890",
  "bank_name": "BCA"
}

# 12.4 Riwayat Withdraw
GET /wallets/me/withdrawals
Authorization: Bearer <owner_token>
```

### 13. ADMIN — Proses Withdraw & Analytics

```
# Login sebagai Admin

# 13.1 Proses Withdraw
PATCH /admin/wallets/withdrawals/<withdraw_id>/process
Authorization: Bearer <admin_token>
{ "status": "success", "note": "Transfer berhasil via BCA" }

# 13.2 Lihat Wallet Admin
GET /admin/wallets/me
Authorization: Bearer <admin_token>
→ available_balance = 4200 (admin_commission)

# 13.3 Dashboard Metrics
GET /admin/dashboard/metrics?date_from=2026-01-01&date_to=2026-12-31
Authorization: Bearer <admin_token>

# 13.4 Lihat Semua Orders
GET /admin/orders
Authorization: Bearer <admin_token>

# 13.5 Admin Analytics
GET /admin/analytics?date_from=2026-01-01&date_to=2026-12-31
Authorization: Bearer <admin_token>
```

### 14. NOTIFICATIONS

```
# 14.1 Get Notifications
GET /notifications
Authorization: Bearer <any_token>

# 14.2 Mark as Read
PATCH /notifications/<notification_id>/read
Authorization: Bearer <any_token>
```

### 15. REPORTS

```
# 15.1 Owner Report Summary
GET /owner/reports/summary?date_from=2026-01-01&date_to=2026-12-31
Authorization: Bearer <owner_token>

# 15.2 Courier Earnings
GET /couriers/me/earnings?date_from=2026-01-01&date_to=2026-12-31
Authorization: Bearer <courier_token>

# 15.3 Customer Order History
GET /orders/my-orders/history?page=1&limit=20
Authorization: Bearer <customer_token>
```

---

## Test Authorization

```
# Customer tidak bisa lihat order customer lain
GET /orders/<order_milik_customer_lain>
Authorization: Bearer <customer_token>
→ 403 "Forbidden: not your order"

# Owner tidak bisa update order owner lain
PATCH /orders/<order_owner_lain>/status
Authorization: Bearer <owner_token>
{ "status": "CONFIRMED" }
→ 404 "Order not found or not owned by you"

# Courier tidak bisa lihat order yang bukan assignment-nya
GET /orders/<order_bukan_assignment>
Authorization: Bearer <courier_token>
→ 403 "Forbidden: not assigned to you"
```

---

## Test Midtrans Signature (Manual Callback)

Untuk test callback manual tanpa melalui halaman Snap:

```javascript
// Generate Midtrans signature_key
const crypto = require('crypto');
const orderId = 'PAY1234567890';        // payment_id dari createPayment
const statusCode = '200';                // 200 = success
const grossAmount = '47200.00';          // harus string dengan .00
const serverKey = 'SB-Mid-server-xxxxx'; // MIDTRANS_SERVER_KEY dari .env

const signatureKey = crypto
  .createHash('sha512')
  .update(orderId + statusCode + grossAmount + serverKey)
  .digest('hex');

console.log(signatureKey);
```

```
POST /payments/callback
{
  "order_id": "PAY1234567890",
  "status_code": "200",
  "gross_amount": "47200.00",
  "signature_key": "<generated_signature>",
  "transaction_status": "settlement",
  "payment_type": "bank_transfer",
  "fraud_status": "accept"
}
```

> **Tip**: Di Midtrans Sandbox, cara termudah adalah langsung bayar di halaman Snap.
> Midtrans akan otomatis mengirim notification ke endpoint callback Anda.
> Untuk development lokal, gunakan [ngrok](https://ngrok.com) untuk expose localhost.
