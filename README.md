# LaundryKu API

Smart Laundry Ecosystem API — Backend untuk aplikasi laundry online yang menghubungkan customer, owner laundry, kurir, dan admin sistem.

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MySQL / mysql2
- **Auth**: JWT (jsonwebtoken) + bcryptjs
- **Module**: CommonJS

## Setup

### 1. Database

Buat database MySQL:

```sql
CREATE DATABASE laundryku_db;
```

Import schema:

```bash
mysql -u root -p laundryku_db < init.sql
```

### 2. Environment

Copy `.env.example` ke `.env` dan sesuaikan:

```bash
cp .env.example .env
```

```env
PORT=3000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=laundryku_db
DB_PORT=3306
JWT_SECRET=change_this_secret
ALLOW_MANUAL_DISTANCE=true
MIDTRANS_SERVER_KEY=SB-Mid-server-xxxxxxxxxxxxxxxxxxxxxxxx
USE_DUMMY_PAYMENT=true
FRONTEND_URL=http://localhost:3000
```

> **Note**: Set `USE_DUMMY_PAYMENT=true` untuk development tanpa Midtrans key. Payment akan return dummy snap_token tanpa memanggil Midtrans API. Set ke `false` untuk menggunakan Midtrans Sandbox yang sesungguhnya.

> ⚠️ **WARNING — DUMMY PAYMENT HANYA UNTUK DEVELOPMENT/TESTING LOKAL**
>
> `USE_DUMMY_PAYMENT=true` **TIDAK AMAN** untuk production atau demo publik karena:
> - Melewati verifikasi payment gateway (Midtrans Snap API tidak dipanggil)
> - Callback menerima status pembayaran tanpa validasi signature dari Midtrans
> - Siapapun bisa mengirim callback palsu dan memicu distribusi wallet tanpa pembayaran nyata
>
> Untuk **production/demo publik**, wajib set:
> ```env
> USE_DUMMY_PAYMENT=false
> MIDTRANS_SERVER_KEY=<server_key_asli>
> MIDTRANS_CLIENT_KEY=<client_key_asli>
> ```
> dan pastikan signature Midtrans divalidasi pada setiap callback.

### 3. Install Dependencies

```bash
npm install
```

### 4. Seed Admin User

Admin tidak bisa didaftarkan via API public. Jalankan seed script:

```bash
node seed.js
```

Output:
```
Admin user created with ID: 1
Admin wallet created.

=== Admin Credentials ===
Email: admin@laundryku.com
Password: admin123
========================
```

### 5. Jalankan Server

```bash
npm start
```

atau:

```bash
node app.js
```

Server akan berjalan di `http://localhost:3000`.

---

## Roles & Register

| Role | Public Register | Verifikasi Admin | Wallet |
|------|----------------|------------------|--------|
| customer | ✅ Ya | Tidak perlu (langsung aktif) | Tidak ada |
| owner | ✅ Ya | ✅ Wajib sebelum aktif | Otomatis setelah verify |
| courier | ✅ Ya | ✅ Wajib sebelum aktif | Otomatis setelah verify |
| admin | ❌ Tidak | Tidak perlu | Otomatis via seed |

### Flow Verifikasi Owner/Courier

1. Owner/courier register → `is_verified = false`
2. Owner/courier **tidak bisa** menggunakan fitur utama sampai diverifikasi
3. Admin melakukan verifikasi via `PATCH /admin/users/:user_id/verify`
4. Sistem otomatis membuat wallet setelah verifikasi berhasil

---

## 9 Status Order

```
WAITING_OWNER_CONFIRMATION → CONFIRMED → PICKUP_ON_THE_WAY → LAUNDRY_PICKED →
PROCESSING → READY_FOR_DELIVERY → DELIVERY_ON_THE_WAY → DELIVERED → COMPLETED
```

### Flow Lengkap

| Step | Aktor | Endpoint | Status Baru |
|------|-------|----------|-------------|
| 1 | Customer | `POST /orders` | WAITING_OWNER_CONFIRMATION |
| 2 | Owner | `PATCH /orders/:id/status` | CONFIRMED |
| 3 | Owner | `POST /orders/:id/assign-courier` | (courier di-lock) |
| 4 | Courier | `PATCH /couriers/tasks/:id/status` | PICKUP_ON_THE_WAY |
| 5 | Courier | `PATCH /couriers/tasks/:id/status` | LAUNDRY_PICKED |
| 6 | Owner | `PATCH /orders/:id/weight` | (berat & biaya dihitung) |
| 7 | Customer | `POST /payments` → Gateway callback | PROCESSING |
| 8 | Owner | `PATCH /orders/:id/status` | READY_FOR_DELIVERY |
| 9 | Owner | `PATCH /orders/:id/activate-delivery` | (fase delivery) |
| 10 | Courier | `PATCH /couriers/tasks/:id/status` | DELIVERY_ON_THE_WAY |
| 11 | Courier | `PATCH /couriers/tasks/:id/status` (DELIVERED) | — |
| 12 | Courier | `PATCH /couriers/tasks/:id/status` (DONE) | DELIVERED |
| 13 | Customer | `PATCH /orders/:id/complete` | COMPLETED |

---

## Courier Locking

- Satu kurir ditugaskan untuk seluruh siklus order (pickup + delivery)
- Setelah di-assign, kurir **tidak bisa diganti**
- Kurir yang sama melakukan pickup dan delivery
- `DONE` adalah status internal `courier_assignments`, bukan status order

---

## Formula Biaya

```
service_fee       = weight_kg × price_per_kg_customer
delivery_fee      = distance_km × 2 × 1500
admin_commission  = weight_kg × (price_per_kg_customer − price_per_kg_owner)
owner_earning     = weight_kg × price_per_kg_owner
courier_earning   = distance_km × 2 × 1250
total_amount      = service_fee + delivery_fee
```

- `price_per_kg_customer` = `price_per_kg_owner × 1.15` (otomatis)
- Owner hanya menginput `price_per_kg_owner`

### Distance Calculation (Haversine)

Sistem **tidak menggunakan Google Maps API**. Jarak dihitung menggunakan **Haversine Formula** di backend berdasarkan koordinat GPS yang dikirim dari HP/frontend.

**Prioritas perhitungan distance_km:**
1. **Haversine otomatis** — dari koordinat pickup customer + koordinat owner laundry
2. **Manual fallback** — owner kirim `distance_km` di request body (jika `ALLOW_MANUAL_DISTANCE=true` di `.env`)
3. **Error** — jika keduanya tidak tersedia

**Tracking kurir**: Courier mengirim `lat`/`lng` dari GPS HP ke endpoint `PATCH /couriers/me/location`. Frontend membaca koordinat terakhir dari database untuk ditampilkan di map.

---

## Payment (Midtrans Sandbox)

Sistem menggunakan **Midtrans Snap** (Sandbox mode) untuk memproses pembayaran.

### Membuat Payment

```
POST /payments
{ "invoice_id": "INV..." }
```

Response:
```json
{
  "payment_id": "PAY...",
  "snap_token": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "redirect_url": "https://app.sandbox.midtrans.com/snap/v2/vtweb/...",
  "status": "pending"
}
```

Frontend/Flutter membuka `redirect_url` atau menggunakan `snap_token` dengan Midtrans Snap SDK.

Semua metode pembayaran yang tersedia di Midtrans Sandbox (VA, GoPay, QRIS, dll) otomatis tampil.

### Payment Notification Callback (Midtrans)

```
POST /payments/callback
```

Midtrans mengirim notification otomatis ke endpoint ini. URL callback diatur di:
**Midtrans Dashboard → Settings → Payment → Notification URL**

Set ke: `https://<your-domain>/payments/callback`

**Signature validation**: `SHA512(order_id + status_code + gross_amount + server_key)`

**Idempotent**: Notification yang sama jika diulang tidak akan membuat wallet transaction dobel.

---

## Wallet Flow

### Saat Payment Success

| Penerima | Jumlah | Status | Balance |
|----------|--------|--------|---------|
| Owner | owner_earning | pending | pending_balance ↑ |
| Courier | courier_earning | pending | pending_balance ↑ |
| Admin | admin_commission | available | available_balance ↑ |

### Saat Customer Confirm COMPLETED

- Hanya pending balance **owner** dan **courier** yang dirilis
- Pending balance → available balance
- Admin commission **tidak diproses lagi** (sudah available sejak payment)
- **Idempotent**: COMPLETED kedua kali tidak menggandakan saldo

### Withdraw

- Owner/courier withdraw dari `available_balance` saja
- Saldo dikurangi saat request dibuat (deduct-on-request)
- Admin memproses withdrawal:
  - `success` → saldo tetap terpotong
  - `failed` → saldo dikembalikan ke available_balance

---

## Authorization

| Resource | Customer | Owner | Courier | Admin |
|----------|----------|-------|---------|-------|
| Order detail | Miliknya | Milik owner_id | Assigned | Semua |
| Invoice | Miliknya | Milik owner_id | ❌ | Semua |
| Tracking | Miliknya | Milik owner_id | Assigned | Semua |
| Services | Active only | Miliknya (all) | Active only | Semua |

---

## API Endpoints

### Auth
- `POST /auth/register` — Register (customer/owner/courier, bukan admin)
- `POST /auth/login` — Login
- `GET /auth/profile` — Lihat profil
- `PATCH /auth/profile` — Edit profil
- `POST /auth/logout` — Logout

### Services
- `GET /services` — List services
- `GET /services/:id` — Detail service
- `POST /services` — Create service (owner, verified)
- `PATCH /services/:id` — Update service (owner, verified)
- `DELETE /services/:id` — Delete service (owner, verified)

### Orders
- `POST /orders` — Create order (customer)
- `GET /orders/my-orders` — My orders (customer)
- `GET /orders/my-orders/history` — Order history (customer)
- `GET /orders/:id` — Detail (auth check)
- `GET /orders/:id/tracking` — Tracking (auth check)
- `PATCH /orders/:id/status` — Update status (owner, verified)
- `POST /orders/:id/assign-courier` — Assign courier (owner, verified)
- `PATCH /orders/:id/weight` — Input berat (owner, verified)
- `PATCH /orders/:id/activate-delivery` — Aktifkan delivery (owner, verified)
- `PATCH /orders/:id/complete` — Konfirmasi selesai (customer)

### Couriers
- `GET /couriers/available` — Courier tersedia (owner/admin)
- `PATCH /couriers/me/location` — Update lokasi (courier, verified)
- `GET /couriers/me/tasks` — Tugas aktif (courier, verified)
- `GET /couriers/me/tasks/history` — Riwayat tugas (courier, verified)
- `PATCH /couriers/tasks/:id/status` — Update task (courier, verified)
- `GET /couriers/me/earnings` — Laporan earning (courier, verified)

### Payments
- `GET /payments/invoice/:id` — Lihat invoice (auth check)
- `POST /payments` — Bayar invoice (customer)
- `POST /payments/callback` — Payment callback (signature)

### Wallets
- `GET /wallets/me` — Saldo (owner/courier, verified)
- `GET /wallets/me/transactions` — Riwayat (owner/courier, verified)
- `POST /wallets/me/withdraw` — Withdraw (owner/courier, verified)
- `GET /wallets/me/withdrawals` — Riwayat withdraw (owner/courier, verified)

### Admin
- `GET /admin/dashboard/metrics` — Dashboard
- `GET /admin/users/pending` — Users pending verification
- `PATCH /admin/users/:id/verify` — Verifikasi user
- `GET /admin/wallets/me` — Wallet admin
- `PATCH /admin/wallets/withdrawals/:id/process` — Proses withdraw
- `GET /admin/orders` — Semua orders
- `GET /admin/analytics` — Analytics

### Owner
- `GET /owner/orders` — Orders milik owner (verified)
- `GET /owner/reports/summary` — Laporan (verified)

### Notifications
- `GET /notifications` — List notifikasi
- `PATCH /notifications/:id/read` — Tandai dibaca

---

## Response Format

Semua response menggunakan format konsisten:

```json
// Success
{
  "success": true,
  "message": "...",
  "data": {}
}

// Error
{
  "success": false,
  "message": "..."
}
```
