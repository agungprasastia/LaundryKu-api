# Panduan Testing API LaundryKu — Sesuai Spesifikasi PDF A-H

Berikut adalah **16 endpoint** API yang telah diimplementasikan sesuai spesifikasi PDF. 
Test secara **berurutan** dari atas ke bawah karena data saling bergantung.

> ⚠️ **Base URL:** `http://localhost:3000`
> 
> Setiap kali mendapat `access_token` atau `user_id`, **copy dan simpan** untuk dipakai di langkah berikutnya.

---

## 1. REGISTER & LOGIN (Endpoint A, B, P)

### 1A. Register Owner — `POST /auth/register`
- **Method:** `POST`
- **URL:** `http://localhost:3000/auth/register`
- **Body (JSON):**
```json
{
  "name": "Bapak Owner",
  "email": "owner@laundryku.id",
  "password": "rahasia123",
  "role": "owner"
}
```
> ✅ **Expected:** Status `201`
> ```json
> {
>   "message": "Register success",
>   "data": {
>     "user_id": "uuid-xxx",
>     "name": "Bapak Owner",
>     "role": "owner",
>     "access_token": "jwt-token-xxx"
>   }
> }
> ```
> 📌 **Simpan:** `user_id` sebagai **Owner ID** dan `access_token` sebagai **Token Owner**

---

### 1B. Register Customer — `POST /auth/register`
- **Method:** `POST`
- **URL:** `http://localhost:3000/auth/register`
- **Body (JSON):**
```json
{
  "name": "Budi Santoso",
  "email": "budi@laundryku.id",
  "password": "rahasia123",
  "role": "customer"
}
```
> 📌 **Simpan:** `user_id` sebagai **Customer ID** dan `access_token` sebagai **Token Customer**

---

### 1C. Register Courier — `POST /auth/register`
- **Method:** `POST`
- **URL:** `http://localhost:3000/auth/register`
- **Body (JSON):**
```json
{
  "name": "Andi Kurir",
  "email": "andi@laundryku.id",
  "password": "rahasia123",
  "role": "courier"
}
```
> 📌 **Simpan:** `user_id` sebagai **Courier ID** dan `access_token` sebagai **Token Courier**

---

### 1D. Register Admin — `POST /auth/register`
- **Method:** `POST`
- **URL:** `http://localhost:3000/auth/register`
- **Body (JSON):**
```json
{
  "name": "Admin Sistem",
  "email": "admin@laundryku.id",
  "password": "rahasia123",
  "role": "admin"
}
```
> 📌 **Simpan:** `access_token` sebagai **Token Admin**

---

### 1E. Login — `POST /auth/login`
- **Method:** `POST`
- **URL:** `http://localhost:3000/auth/login`
- **Body (JSON):**
```json
{
  "email": "owner@laundryku.id",
  "password": "rahasia123"
}
```
> ✅ **Expected:** Status `200`
> ```json
> {
>   "message": "Login success",
>   "data": {
>     "user_id": "uuid-xxx",
>     "name": "Bapak Owner",
>     "role": "owner",
>     "access_token": "jwt-token-xxx"
>   }
> }
> ```

**Test Error — Password Salah:**
```json
{
  "email": "owner@laundryku.id",
  "password": "salah123"
}
```
> ❌ **Expected:** Status `401` → `{ "message": "Invalid email or password" }`

---

### 1F. Logout — `POST /auth/logout`
- **Method:** `POST`
- **URL:** `http://localhost:3000/auth/logout`
- **Headers:** `Authorization: Bearer <Token Owner>`
> ✅ **Expected:** Status `200` → `{ "message": "Logout success" }`

---

## 2. SETUP OWNER PROFILE

Sebelum membuat layanan, owner perlu punya `shop_name` di `owner_profiles`. 
Update langsung via MySQL/phpMyAdmin:

```sql
UPDATE owner_profiles 
SET shop_name = 'Laundry Bersih Jaya', 
    shop_address = 'Jl. Kedungdoro No. 45, Surabaya', 
    city = 'Surabaya'
WHERE user_id = '<Owner ID>';
```
> Ganti `<Owner ID>` dengan UUID owner dari langkah 1A.

---

## 3. SERVICES — Layanan Laundry (Endpoint C, D)

### 3A. Buat Layanan — `POST /services` (Owner)
- **Method:** `POST`
- **URL:** `http://localhost:3000/services`
- **Headers:** `Authorization: Bearer <Token Owner>`
- **Body (JSON):**
```json
{
  "name": "Cuci Reguler",
  "description": "Layanan cuci dan lipat pakaian harian",
  "price_per_kg": 7000,
  "minimum_kg": 2,
  "estimated_days": 2
}
```
> ✅ **Expected:** Status `201`
> 📌 **Simpan:** `service_id` dari response

---

### 3B. Daftar Semua Layanan — `GET /services` (Public)
- **Method:** `GET`
- **URL:** `http://localhost:3000/services`

**Dengan filter/pagination:**
- `http://localhost:3000/services?page=1&limit=10`
- `http://localhost:3000/services?keyword=cuci`
- `http://localhost:3000/services?owner_id=<Owner ID>`

> ✅ **Expected:** Status `200`
> ```json
> {
>   "message": "Success",
>   "data": [
>     {
>       "service_id": "uuid-xxx",
>       "shop_name": "Laundry Bersih Jaya",
>       "service_name": "Cuci Reguler",
>       "price_per_kg": 7000,
>       "estimated_days": 2
>     }
>   ],
>   "pagination": { "page": 1, "limit": 10, "total": 1 }
> }
> ```

---

### 3C. Detail Layanan — `GET /services/:id` (Public)
- **Method:** `GET`
- **URL:** `http://localhost:3000/services/<service_id>`

> ✅ **Expected:** Status `200` — termasuk `shop_name`, `address`, `minimum_kg`, `description`

**Test Error — Service tidak ada:**
- **URL:** `http://localhost:3000/services/tidak-ada-id`
> ❌ **Expected:** Status `404` → `{ "message": "Service not found" }`

---

## 4. ORDERS — Pemesanan (Endpoint E, H, I)

### 4A. Buat Pesanan — `POST /orders` (Customer)
- **Method:** `POST`
- **URL:** `http://localhost:3000/orders`
- **Headers:** `Authorization: Bearer <Token Customer>`
- **Body (JSON):**
```json
{
  "service_id": "<service_id dari langkah 3A>",
  "pickup_address": "Jl. Raya Darmo No. 12, Surabaya",
  "pickup_lat": -7.2893,
  "pickup_lng": 112.7384,
  "pickup_scheduled_at": "2026-05-15T09:00:00Z"
}
```
> ✅ **Expected:** Status `201`
> ```json
> {
>   "message": "Order created",
>   "data": {
>     "order_id": "uuid-xxx",
>     "invoice_id": "uuid-xxx",
>     "invoice_number": "INV/2026/05/001",
>     "amount": 0,
>     "status": "pending_payment",
>     "pickup_scheduled_at": "2026-05-15T09:00:00Z"
>   }
> }
> ```
> 📌 **Simpan:** `order_id` dan `invoice_id`

**Test Error — Order duplikat:**
Kirim request yang sama lagi.
> ❌ **Expected:** Status `409` → `{ "message": "Customer already has an active order at this laundry" }`

---

### 4B. Pesanan Saya — `GET /orders/my-orders` (Customer)
- **Method:** `GET`
- **URL:** `http://localhost:3000/orders/my-orders`
- **Headers:** `Authorization: Bearer <Token Customer>`

**Dengan filter:**
- `http://localhost:3000/orders/my-orders?status=active&page=1&limit=10`

> ✅ **Expected:** Status `200` — daftar order dengan pagination, termasuk `shop_name` dan `service_name`

---

### 4C. Detail Order — `GET /orders/:id`
- **Method:** `GET`
- **URL:** `http://localhost:3000/orders/<order_id>`
- **Headers:** `Authorization: Bearer <Token Customer>`

---

## 5. PAYMENTS — Pembayaran (Endpoint F, G)

### 5A. Buat Pembayaran — `POST /payments` (Customer)
- **Method:** `POST`
- **URL:** `http://localhost:3000/payments`
- **Headers:** `Authorization: Bearer <Token Customer>`
- **Body (JSON):**
```json
{
  "invoice_id": "<invoice_id dari langkah 4A>",
  "payment_method": "virtual_account"
}
```
> ✅ **Expected:** Status `201`
> ```json
> {
>   "message": "Payment created",
>   "data": {
>     "payment_id": "uuid-xxx",
>     "invoice_id": "uuid-xxx",
>     "amount": 0,
>     "payment_method": "virtual_account",
>     "virtual_account_number": "880812345678",
>     "expired_at": "2026-05-11T...",
>     "status": "pending"
>   }
> }
> ```

**Test Error — Invoice sudah bayar (setelah callback):**
> ❌ **Expected:** Status `400` → `{ "message": "Invoice already paid" }`

---

### 5B. Simulasi Callback Payment — `POST /payments/callback`
- **Method:** `POST`
- **URL:** `http://localhost:3000/payments/callback`
- **Headers:** `X-Signature: test-signature-123`
- **Body (JSON):**
```json
{
  "invoice_id": "<invoice_id>",
  "status": "paid",
  "paid_at": "2026-05-10T10:15:00Z",
  "reference_no": "PG-88990011",
  "signature": "abc123signature"
}
```
> ✅ **Expected:** Status `200` → `{ "message": "Callback processed" }`
> 
> **Side effects (cek di database):**
> - `payments.status` → `paid`
> - `invoices.status` → `paid`
> - `orders.status` → `confirmed`
> - 2 notifikasi dibuat (customer + owner)

**Test Error — Signature kosong (hapus header dan field signature):**
> ❌ **Expected:** Status `403` → `{ "message": "Invalid signature" }`

**Test Error — Status tidak valid:**
```json
{
  "invoice_id": "<invoice_id>",
  "status": "unknown_status",
  "signature": "abc123"
}
```
> ❌ **Expected:** Status `400` → `{ "message": "Invalid payment status" }`

---

## 6. ORDER STATUS — Update oleh Owner (Endpoint I)

### 6A. Update Status → washing — `PATCH /orders/:order_id/status`
- **Method:** `PATCH`
- **URL:** `http://localhost:3000/orders/<order_id>/status`
- **Headers:** `Authorization: Bearer <Token Owner>`
- **Body (JSON):**
```json
{
  "status": "washing",
  "notes": "Laundry sedang dicuci"
}
```
> ✅ **Expected:** Status `200`
> ```json
> {
>   "message": "Status updated",
>   "data": {
>     "order_id": "uuid-xxx",
>     "status": "washing",
>     "updated_at": "2026-05-10T..."
>   }
> }
> ```

### 6B. Update Status → drying
```json
{ "status": "drying", "notes": "Sedang dikeringkan" }
```

### 6C. Update Status → finished
```json
{ "status": "finished", "notes": "Laundry selesai" }
```

**Test Error — Bukan owner dari order:**
Gunakan token user lain.
> ❌ **Expected:** Status `403` → `{ "message": "Forbidden" }`

---

## 7. COURIER — Assign & Tugas (Endpoint K, J, M, L)

### 7A. Assign Kurir — `POST /orders/:order_id/assign-courier` (Owner)
- **Method:** `POST`
- **URL:** `http://localhost:3000/orders/<order_id>/assign-courier`
- **Headers:** `Authorization: Bearer <Token Owner>`
- **Body (JSON):**
```json
{
  "courier_id": "<Courier ID dari langkah 1C>",
  "task_type": "pickup"
}
```
> ✅ **Expected:** Status `201`
> ```json
> {
>   "message": "Courier assigned successfully",
>   "data": {
>     "assignment_id": "uuid-xxx",
>     "order_id": "uuid-xxx",
>     "courier_id": "uuid-xxx",
>     "task_type": "pickup",
>     "status": "assigned",
>     "assigned_at": "2026-05-10T..."
>   }
> }
> ```
> 📌 **Simpan:** `assignment_id`

**Test Error — Duplikat assignment:**
Kirim request yang sama lagi.
> ❌ **Expected:** Status `409` → `{ "message": "Courier already assigned for this task" }`

**Test Error — task_type tidak valid:**
```json
{ "courier_id": "<id>", "task_type": "invalid" }
```
> ❌ **Expected:** Status `422` → Validation error

---

### 7B. Update Lokasi Kurir — `PATCH /couriers/me/location` (Courier)
- **Method:** `PATCH`
- **URL:** `http://localhost:3000/couriers/me/location`
- **Headers:** `Authorization: Bearer <Token Courier>`
- **Body (JSON):**
```json
{
  "lat": -7.2804,
  "lng": 112.7457,
  "assignment_id": "<assignment_id dari 7A>"
}
```
> ✅ **Expected:** Status `200`
> ```json
> {
>   "message": "Location updated",
>   "data": {
>     "courier_id": "uuid-xxx",
>     "lat": -7.2804,
>     "lng": 112.7457,
>     "recorded_at": "2026-05-10T..."
>   }
> }
> ```

---

### 7C. Daftar Tugas Kurir — `GET /couriers/me/tasks` (Courier)
- **Method:** `GET`
- **URL:** `http://localhost:3000/couriers/me/tasks`
- **Headers:** `Authorization: Bearer <Token Courier>`

**Dengan filter:**
- `http://localhost:3000/couriers/me/tasks?status=active&page=1&limit=10`

> ✅ **Expected:** Status `200` — daftar tugas dengan `customer_name`, `customer_phone`, `pickup_address`

---

### 7D. History Tugas Kurir — `GET /couriers/me/tasks/history` (Courier)
- **Method:** `GET`
- **URL:** `http://localhost:3000/couriers/me/tasks/history`
- **Headers:** `Authorization: Bearer <Token Courier>`

**Dengan filter tanggal:**
- `http://localhost:3000/couriers/me/tasks/history?date_from=2026-05-01&date_to=2026-05-31&page=1&limit=10`

> ✅ **Expected:** Status `200` — daftar tugas selesai (status `done`) dengan `completed_at`
> ⚠️ **Catatan:** Hasilnya akan kosong sampai ada tugas yang statusnya `done`

---

## 8. TRACKING (Tambahan)

### 8A. Tracking Order — `GET /tracking/:order_id`
- **Method:** `GET`
- **URL:** `http://localhost:3000/tracking/<order_id>`
- **Headers:** `Authorization: Bearer <Token Customer>`

> ✅ **Expected:** Status `200` — posisi terakhir kurir (dari langkah 7B)

---

## 9. PROFILE (Endpoint O)

### 9A. Lihat Profil — `GET /profile`
- **Method:** `GET`
- **URL:** `http://localhost:3000/profile`
- **Headers:** `Authorization: Bearer <Token mana saja>`

> ✅ **Expected:** Status `200`
> ```json
> {
>   "message": "Profile retrieved successfully",
>   "data": {
>     "id": "uuid-xxx",
>     "name": "Bapak Owner",
>     "email": "owner@laundryku.id",
>     "role": "owner",
>     "phone": null,
>     "created_at": "2026-05-10T..."
>   }
> }
> ```

**Test Error — Tanpa token:**
Jangan kirim header Authorization.
> ❌ **Expected:** Status `401` → `{ "message": "Unauthorized" }`

---

## 10. ADMIN DASHBOARD (Endpoint N)

### 10A. Dashboard Metrics — `GET /admin/dashboard/metrics` (Admin Only)
- **Method:** `GET`
- **URL:** `http://localhost:3000/admin/dashboard/metrics?date_from=2026-05-01&date_to=2026-05-31`
- **Headers:** `Authorization: Bearer <Token Admin>`

> ✅ **Expected:** Status `200`
> ```json
> {
>   "message": "Success",
>   "data": {
>     "total_users": 4,
>     "new_users_this_period": 4,
>     "total_orders": 1,
>     "orders_this_period": 1,
>     "total_revenue": 0,
>     "revenue_this_period": 0,
>     "active_couriers": 1,
>     "active_owners": 1,
>     "order_status_summary": {
>       "pending_payment": 0,
>       "confirmed": 1,
>       "washing": 0,
>       "delivering": 0,
>       "completed": 0
>     }
>   }
> }
> ```

**Test Error — Bukan admin:**
Gunakan Token Customer/Owner.
> ❌ **Expected:** Status `403` → `{ "message": "Forbidden" }`

---

## 11. RATINGS (Tambahan)

### 11A. Update Status → completed dulu (Owner)
- **Method:** `PATCH`
- **URL:** `http://localhost:3000/orders/<order_id>/status`
- **Headers:** `Authorization: Bearer <Token Owner>`
- **Body:**
```json
{ "status": "completed", "notes": "Laundry selesai dan sudah diterima customer" }
```

### 11B. Berikan Rating — `POST /ratings` (Customer)
- **Method:** `POST`
- **URL:** `http://localhost:3000/ratings`
- **Headers:** `Authorization: Bearer <Token Customer>`
- **Body (JSON):**
```json
{
  "order_id": "<order_id>",
  "score": 5,
  "review": "Pelayanan sangat memuaskan, laundry bersih dan wangi!"
}
```
> ✅ **Expected:** Status `201`
> ```json
> {
>   "message": "Rating created",
>   "data": {
>     "rating_id": "uuid-xxx",
>     "order_id": "uuid-xxx",
>     "customer_id": "uuid-xxx",
>     "score": 5,
>     "review": "Pelayanan sangat memuaskan, laundry bersih dan wangi!"
>   }
> }
> ```

---

## Ringkasan 16 Endpoint

| # | Spec | Method | URL | Auth |
|---|------|--------|-----|------|
| 1 | A | `POST` | `/auth/register` | Public |
| 2 | B | `POST` | `/auth/login` | Public |
| 3 | P | `POST` | `/auth/logout` | Bearer |
| 4 | C | `GET` | `/services` | Public |
| 5 | D | `GET` | `/services/:id` | Public |
| 6 | E | `POST` | `/orders` | Customer |
| 7 | H | `GET` | `/orders/my-orders` | Bearer |
| 8 | — | `GET` | `/orders/:id` | Bearer |
| 9 | I | `PATCH` | `/orders/:order_id/status` | Owner |
| 10 | K | `POST` | `/orders/:order_id/assign-courier` | Owner |
| 11 | F | `POST` | `/payments` | Bearer |
| 12 | G | `POST` | `/payments/callback` | X-Signature |
| 13 | J | `PATCH` | `/couriers/me/location` | Courier |
| 14 | M | `GET` | `/couriers/me/tasks` | Courier |
| 15 | L | `GET` | `/couriers/me/tasks/history` | Courier |
| 16 | O | `GET` | `/profile` | Bearer |
| 17 | N | `GET` | `/admin/dashboard/metrics` | Admin |
