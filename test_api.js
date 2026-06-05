// ============================================
// LaundryKu API — Full E2E Test Suite v2
// Jalankan: node test_api.js
// Pastikan server sudah running (npm start) di terminal lain
// ============================================
const http = require('http');

const BASE = 'http://localhost:3000';
const results = [];

function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;

    const r = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

function test(num, name, status, passed, detail) {
  const result = passed ? '✅ PASS' : '❌ FAIL';
  results.push({ num, name, status, result });
  console.log(`\nTEST ${num}: ${name}`);
  console.log(`  Status: ${status} | ${result}`);
  if (detail) console.log(`  Detail: ${JSON.stringify(detail, null, 2)}`);
}

(async () => {
  const ts = Date.now();
  console.log('='.repeat(60));
  console.log('LaundryKu API — Full E2E Test Suite v2');
  console.log('='.repeat(60));

  // --- TEST 1: Admin Login ---
  let adminToken = null;
  let r = await req('POST', '/auth/login', { email: 'admin@laundryku.com', password: 'admin123' });
  if (r.status === 200 && r.body.data?.access_token) {
    adminToken = r.body.data.access_token;
    test(1, 'Admin Login', r.status, true, { user_id: r.body.data.user_id });
  } else {
    test(1, 'Admin Login', r.status, false, r.body);
    console.log('\n❌ ADMIN LOGIN FAILED — Jalankan "node seed.js" dulu.\n');
    process.exit(1);
  }

  // --- TEST 2: Register Owner ---
  const ownEmail = `apiowner_${ts}@test.com`;
  r = await req('POST', '/auth/register', {
    full_name: 'API Test Owner', email: ownEmail, password: 'pass123',
    role: 'owner', address: 'Jl API Owner', lat: '-6.3', lng: '106.9'
  });
  const ownerId = r.body.data?.user_id;
  test(2, 'Register Owner', r.status, r.status === 201 && ownerId, { user_id: ownerId });

  // --- TEST 3: Register Courier ---
  const courEmail = `apicourier_${ts}@test.com`;
  r = await req('POST', '/auth/register', {
    full_name: 'API Test Courier', email: courEmail, password: 'pass123',
    role: 'courier', address: 'Jl Courier', vehicle_name: 'Honda Beat', vehicle_plate_number: 'B999XY'
  });
  const courierId = r.body.data?.user_id;
  test(3, 'Register Courier', r.status, r.status === 201 && courierId, { user_id: courierId });

  // --- TEST 4: Register Customer ---
  const custEmail = `apicust_${ts}@test.com`;
  r = await req('POST', '/auth/register', {
    full_name: 'API Test Customer', email: custEmail, password: 'pass123',
    role: 'customer', address: 'Jl Customer', lat: '-6.2', lng: '106.8'
  });
  let custToken = r.body.data?.access_token;
  test(4, 'Register Customer', r.status, r.status === 201 && custToken, { user_id: r.body.data?.user_id });

  // --- TEST 5: Admin Verify Owner ---
  r = await req('PATCH', `/admin/users/${ownerId}/verify`, { is_verified: true }, adminToken);
  test(5, 'Admin Verify Owner', r.status, r.status === 200 && r.body.data?.is_verified === true,
    { wallet_created: r.body.data?.wallet_created });

  // --- TEST 6: Admin Verify Courier ---
  r = await req('PATCH', `/admin/users/${courierId}/verify`, { is_verified: true }, adminToken);
  test(6, 'Admin Verify Courier', r.status, r.status === 200 && r.body.data?.is_verified === true,
    { wallet_created: r.body.data?.wallet_created });

  // --- TEST 7: Re-Login Owner (verified token) ---
  r = await req('POST', '/auth/login', { email: ownEmail, password: 'pass123' });
  let ownerToken = r.body.data?.access_token;
  test(7, 'Re-Login Owner', r.status, r.status === 200 && r.body.data?.is_verified === true);

  // --- TEST 8: Re-Login Courier ---
  r = await req('POST', '/auth/login', { email: courEmail, password: 'pass123' });
  let courierToken = r.body.data?.access_token;
  test(8, 'Re-Login Courier', r.status, r.status === 200 && r.body.data?.is_verified === true);

  // --- TEST 9: Create Service ---
  // NOTE: createService memerlukan service_id dari client
  // price_per_kg_customer dihitung otomatis (+15%)
  const serviceId = `SVC${ts}`;
  r = await req('POST', '/services', {
    service_id: serviceId,
    name: 'Cuci Setrika Premium',
    description: 'Full service',
    price_per_kg_owner: 5000
  }, ownerToken);
  test(9, 'Create Service', r.status, r.status === 201 && r.body.data?.service_id,
    { service_id: r.body.data?.service_id, price_customer: r.body.data?.price_per_kg_customer });

  // --- TEST 10: Create Order (Customer) ---
  r = await req('POST', '/orders', {
    service_id: serviceId, pickup_address: 'Jl Pickup 123',
    pickup_lat: '-6.2', pickup_lng: '106.8'
  }, custToken);
  const orderId = r.body.data?.order_id;
  const invoiceId = r.body.data?.invoice_id;
  test(10, 'Create Order', r.status, r.status === 201 && orderId && invoiceId,
    { order_id: orderId, invoice_id: invoiceId });

  // --- TEST 11: Owner Confirm Order ---
  r = await req('PATCH', `/orders/${orderId}/status`, { status: 'CONFIRMED' }, ownerToken);
  test(11, 'Owner Confirm Order', r.status, r.status === 200, { body: r.body });

  // --- TEST 12: Assign Courier ---
  r = await req('POST', `/orders/${orderId}/assign-courier`, { courier_id: courierId }, ownerToken);
  const assignmentId = r.body.data?.assignment_id;
  test(12, 'Assign Courier', r.status, r.status === 201, { assignment_id: assignmentId });

  // --- TEST 13: DUPLICATE Assign Courier (expect 409) ---
  r = await req('POST', `/orders/${orderId}/assign-courier`, { courier_id: courierId }, ownerToken);
  test(13, 'DUPLICATE Assign (409)', r.status, r.status === 409, { message: r.body.message });

  // --- TEST 14: Courier Pickup Phase ---
  // After CONFIRMED + courier assigned, courier starts pickup
  r = await req('PATCH', `/couriers/tasks/${assignmentId}/status`, { status: 'PICKUP_ON_THE_WAY' }, courierToken);
  test(14, 'Courier PICKUP_ON_THE_WAY', r.status, r.status === 200, { message: r.body.message });

  r = await req('PATCH', `/couriers/tasks/${assignmentId}/status`, { status: 'LAUNDRY_PICKED' }, courierToken);
  test(15, 'Courier LAUNDRY_PICKED', r.status, r.status === 200, { message: r.body.message });

  // --- TEST 16: Input Weight (only after LAUNDRY_PICKED) ---
  r = await req('PATCH', `/orders/${orderId}/weight`, { weight_kg: 3.5 }, ownerToken);
  test(16, 'Input Weight', r.status, r.status === 200,
    { total_amount: r.body.data?.total_amount, distance_km: r.body.data?.distance_km, distance_source: r.body.data?.distance_source });

  // --- TEST 17: Create Payment (Dummy) ---
  r = await req('POST', '/payments', { invoice_id: invoiceId }, custToken);
  const paymentId = r.body.data?.payment_id;
  test(17, 'Create Payment (Dummy)', r.status, (r.status === 200 || r.status === 201) && paymentId,
    { payment_id: paymentId, mode: r.body.data?.mode, snap_token: r.body.data?.snap_token?.substring(0, 30) });

  // --- TEST 18: DUPLICATE Payment (expect 409) ---
  r = await req('POST', '/payments', { invoice_id: invoiceId }, custToken);
  test(18, 'DUPLICATE Payment (409)', r.status, r.status === 409, { message: r.body.message });

  // --- TEST 19: Payment Callback (Dummy success) ---
  // This should set order to PROCESSING and distribute wallet
  r = await req('POST', '/payments/callback', { payment_id: paymentId, status: 'settlement' });
  test(19, 'Payment Callback', r.status, r.status === 200 && r.body.data?.status === 'success',
    { wallet_distributed: r.body.data?.wallet_distributed, order_id: r.body.data?.order_id });

  // --- TEST 20: DUPLICATE Payment Callback (idempotent) ---
  r = await req('POST', '/payments/callback', { payment_id: paymentId, status: 'settlement' });
  const msg20 = (r.body.message || '').toLowerCase();
  test(20, 'DUPLICATE Callback (idempotent)', r.status, msg20.includes('already'),
    { message: r.body.message });

  // --- TEST 21: Get Service as Customer (NO price_per_kg_owner) ---
  r = await req('GET', `/services/${serviceId}`, null, custToken);
  const hasPriceOwner = r.body.data?.hasOwnProperty('price_per_kg_owner');
  test(21, 'Service NO price_per_kg_owner', r.status, r.status === 200 && !hasPriceOwner,
    { has_price_per_kg_owner: hasPriceOwner, fields: Object.keys(r.body.data || {}) });

  // --- TEST 22: Courier Invoice Access (assigned courier should succeed) ---
  r = await req('GET', `/payments/invoice/${invoiceId}`, null, courierToken);
  test(22, 'Courier Invoice (assigned)', r.status, r.status === 200,
    { invoice_id: r.body.data?.invoice_id });

  // --- TEST 23: Owner READY_FOR_DELIVERY (after PROCESSING) ---
  r = await req('PATCH', `/orders/${orderId}/status`, { status: 'READY_FOR_DELIVERY' }, ownerToken);
  test(23, 'Owner READY_FOR_DELIVERY', r.status, r.status === 200, { message: r.body.message });

  // --- TEST 24: Activate Delivery ---
  r = await req('PATCH', `/orders/${orderId}/activate-delivery`, {}, ownerToken);
  test(24, 'Activate Delivery', r.status, r.status === 200, { message: r.body.message });

  // --- TEST 25: Courier Delivery Phase ---
  r = await req('PATCH', `/couriers/tasks/${assignmentId}/status`, { status: 'DELIVERY_ON_THE_WAY' }, courierToken);
  test(25, 'Courier DELIVERY_ON_THE_WAY', r.status, r.status === 200, { message: r.body.message });

  r = await req('PATCH', `/couriers/tasks/${assignmentId}/status`, { status: 'DELIVERED' }, courierToken);
  test(26, 'Courier DELIVERED', r.status, r.status === 200, { message: r.body.message });

  // Courier DONE → this sets order status to DELIVERED
  r = await req('PATCH', `/couriers/tasks/${assignmentId}/status`, { status: 'DONE' }, courierToken);
  test(27, 'Courier DONE → Order DELIVERED', r.status, r.status === 200,
    { message: r.body.message, order_status: r.body.data?.order_status_updated_to });

  // --- TEST 28: Complete Order ---
  r = await req('PATCH', `/orders/${orderId}/complete`, null, custToken);
  test(28, 'Complete Order', r.status, r.status === 200 && r.body.data?.status === 'COMPLETED',
    { released_to: r.body.data?.released_to });

  // --- TEST 29: DUPLICATE Complete (idempotent) ---
  r = await req('PATCH', `/orders/${orderId}/complete`, null, custToken);
  const msg29 = (r.body.message || '').toLowerCase();
  test(29, 'DUPLICATE Complete (idempotent)', r.status, msg29.includes('already'),
    { message: r.body.message });

  // --- TEST 30: Soft Delete Service ---
  r = await req('DELETE', `/services/${serviceId}`, null, ownerToken);
  const msg30 = (r.body.message || '').toLowerCase();
  test(30, 'Soft Delete Service', r.status, r.status === 200 && (msg30.includes('deactivated') || msg30.includes('soft')),
    { message: r.body.message });

  // --- TEST 31: Get Deleted Service as Customer (expect 404) ---
  r = await req('GET', `/services/${serviceId}`, null, custToken);
  test(31, 'Deleted Service = 404', r.status, r.status === 404, { message: r.body.message });

  // ============================================
  // SUMMARY
  // ============================================
  console.log('\n' + '='.repeat(60));
  console.log('TEST RESULTS SUMMARY');
  console.log('='.repeat(60));
  console.log(`${'#'.padEnd(5)} ${'Test Name'.padEnd(38)} ${'Status'.padEnd(8)} Result`);
  console.log('-'.repeat(60));
  let passed = 0, failed = 0;
  for (const s of results) {
    console.log(`${String(s.num).padEnd(5)} ${s.name.padEnd(38)} ${String(s.status).padEnd(8)} ${s.result}`);
    if (s.result.includes('PASS')) passed++; else failed++;
  }
  console.log('-'.repeat(60));
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log('='.repeat(60));

  process.exit(0);
})();
