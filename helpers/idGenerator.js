// ============================================
// ID Generator Helper
// Menggunakan crypto.randomBytes untuk menghindari collision
// Format: PREFIX + timestamp + 8 char hex random
// ============================================
const crypto = require('crypto');

/**
 * Generate unique ID dengan prefix
 * @param {string} prefix - Prefix ID (contoh: 'ORD', 'INV', 'PAY')
 * @returns {string} ID unik
 */
const generateId = (prefix) => {
  const timestamp = Date.now();
  const randomSuffix = crypto.randomBytes(4).toString('hex');
  return `${prefix}${timestamp}${randomSuffix}`;
};

module.exports = { generateId };
