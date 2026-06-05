// ============================================
// Distance Calculation Helper
// 
// Menggunakan Haversine Formula untuk menghitung
// jarak estimasi antara dua koordinat GPS.
//
// Tidak menggunakan Google Maps API.
// Koordinat dikirim dari GPS HP/frontend.
//
// Config env (optional):
//   ALLOW_MANUAL_DISTANCE=true  → izinkan owner kirim distance_km manual sebagai fallback
// ============================================

/**
 * Haversine Formula
 * Menghitung jarak antara dua titik koordinat di permukaan bumi (km)
 * 
 * @param {object} origin - { lat, lng }
 * @param {object} destination - { lat, lng }
 * @returns {number} distance in km (rounded to 2 decimal places)
 */
const calculateDistanceKm = (origin, destination) => {
  const toRad = (deg) => (deg * Math.PI) / 180;

  const R = 6371; // Radius bumi dalam km

  const lat1 = parseFloat(origin.lat);
  const lng1 = parseFloat(origin.lng);
  const lat2 = parseFloat(destination.lat);
  const lng2 = parseFloat(destination.lng);

  if (isNaN(lat1) || isNaN(lng1) || isNaN(lat2) || isNaN(lng2)) {
    return null; // Koordinat tidak valid
  }

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  return Math.round(distance * 100) / 100; // 2 decimal places
};

/**
 * Cek apakah manual distance diizinkan via env
 * @returns {boolean}
 */
const isManualDistanceAllowed = () => {
  return process.env.ALLOW_MANUAL_DISTANCE === 'true';
};

module.exports = { calculateDistanceKm, isManualDistanceAllowed };
