const pool = require('../config/db');

// Inisiasi Pembayaran menggunakan Midtrans (QRIS / GoPay)
exports.createPayment = async (req, res) => {
  const { invoice_id } = req.body;

  try {
    // 1. Cek invoice
    const [invoices] = await pool.query('SELECT * FROM invoices WHERE id = ?', [invoice_id]);
    if (invoices.length === 0) {
      return res.status(404).json({ error: 'Invoice tidak ditemukan' });
    }

    const invoice = invoices[0];

    // Jika sudah lunas, tidak perlu bayar lagi
    if (invoice.status === 'paid') {
      return res.status(400).json({ error: 'Invoice ini sudah lunas' });
    }

    // 2. Buat data payment pending di database lokal kita
    const [paymentResult] = await pool.query(
      'INSERT INTO payments (invoice_id, provider, payment_method, amount) VALUES (?, ?, ?, ?)',
      [invoice_id, 'Midtrans', 'QRIS/GoPay', invoice.amount]
    );
    const paymentId = paymentResult.insertId;

    // 3. Request ke API Midtrans (Sandbox)
    // Membuat Order ID unik untuk Midtrans (gabungan ID kita dan timestamp)
    const midtransOrderId = `ORDER-${invoice_id}-${Date.now()}`;
    
    // Encode Server Key ke Base64 untuk autentikasi
    const serverKey = process.env.MIDTRANS_SERVER_KEY;
    const authString = Buffer.from(`${serverKey}:`).toString('base64');

    const midtransPayload = {
      payment_type: "gopay",
      transaction_details: {
        order_id: midtransOrderId,
        gross_amount: Math.round(invoice.amount) // Midtrans tidak terima desimal panjang
      }
    };

    const midtransResponse = await fetch('https://api.sandbox.midtrans.com/v2/charge', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Basic ${authString}`
      },
      body: JSON.stringify(midtransPayload)
    });

    const midtransData = await midtransResponse.json();

    // Jika Midtrans menolak (karena Server Key salah/belum diisi)
    if (midtransData.status_code !== '201') {
      // Rollback (Hapus) payment yang baru dibuat
      await pool.query('DELETE FROM payments WHERE id = ?', [paymentId]);
      return res.status(400).json({ 
        error: 'Gagal membuat QRIS di Midtrans', 
        detail: midtransData 
      });
    }

    // 4. Ambil URL gambar QR Code dari response Midtrans
    let qrCodeUrl = null;
    if (midtransData.actions) {
      const qrAction = midtransData.actions.find(action => action.name === 'generate-qr-code');
      if (qrAction) qrCodeUrl = qrAction.url;
    }

    // 5. Kembalikan URL QR Code ke pelanggan
    res.status(201).json({
      message: 'Payment QRIS berhasil diinisiasi, silakan scan QR Code',
      qr_code_url: qrCodeUrl,
      payment: {
        id: paymentId,
        invoice_id,
        amount: invoice.amount,
        status: 'pending',
        midtrans_order_id: midtransOrderId
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
};

// Webhook Callback dari Midtrans
exports.paymentCallback = async (req, res) => {
  const midtransNotification = req.body;

  // Midtrans mengirimkan banyak field, kita butuh order_id dan transaction_status
  const { order_id, transaction_status } = midtransNotification;

  // order_id kita memiliki format: ORDER-{invoice_id}-{timestamp}
  if (!order_id) return res.status(400).send('Invalid webhook');

  // Ambil invoice_id dari string order_id
  const orderIdParts = order_id.split('-');
  const invoice_id = orderIdParts[1];

  // Cek apakah status pembayaran sukses
  const isSuccess = transaction_status === 'capture' || transaction_status === 'settlement';

  if (!isSuccess) {
    // Jika cancel / expire, kita bisa abaikan atau update status menjadi failed
    return res.json({ message: `Status transaksi adalah ${transaction_status}, tidak ada update lunas.` });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. Update status payments -> paid
    await connection.query(
      'UPDATE payments SET status = ? WHERE invoice_id = ? AND status = ?',
      ['paid', invoice_id, 'pending']
    );

    // 2. Update status invoices -> paid
    await connection.query(
      'UPDATE invoices SET status = ? WHERE id = ?',
      ['paid', invoice_id]
    );

    // Ambil data invoice untuk mendapatkan id dari table orders yang sebenarnya
    const [invoices] = await connection.query('SELECT * FROM invoices WHERE id = ?', [invoice_id]);
    if (invoices.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ error: 'Invoice tidak ditemukan' });
    }
    const real_order_id = invoices[0].order_id;

    // 3. Update status orders -> confirmed
    await connection.query(
      'UPDATE orders SET status = ? WHERE id = ?',
      ['confirmed', real_order_id]
    );

    await connection.commit();
    connection.release();

    res.json({ message: 'Webhook Midtrans diterima. Pembayaran LUNAS. Order dikonfirmasi.' });
  } catch (err) {
    await connection.rollback();
    connection.release();
    console.error(err.message);
    res.status(500).send('Server Error');
  }
};
