// ============================================
// Validation Helpers
// Reusable input validators for all controllers
// ============================================

/**
 * Validate email format
 * @param {string} email
 * @returns {boolean}
 */
const isValidEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
};

/**
 * Validate password strength (min 6 chars)
 * @param {string} password
 * @returns {boolean}
 */
const isValidPassword = (password) => {
  if (!password || typeof password !== 'string') return false;
  return password.length >= 6;
};

/**
 * Validate latitude (-90 to 90)
 * @param {number} lat
 * @returns {boolean}
 */
const isValidLat = (lat) => {
  const num = parseFloat(lat);
  return !isNaN(num) && num >= -90 && num <= 90;
};

/**
 * Validate longitude (-180 to 180)
 * @param {number} lng
 * @returns {boolean}
 */
const isValidLng = (lng) => {
  const num = parseFloat(lng);
  return !isNaN(num) && num >= -180 && num <= 180;
};

/**
 * Validate lat/lng pair
 * @param {number} lat
 * @param {number} lng
 * @returns {boolean}
 */
const isValidLatLng = (lat, lng) => {
  return isValidLat(lat) && isValidLng(lng);
};

/**
 * Validate value is in enum list
 * @param {string} value
 * @param {string[]} validValues
 * @returns {boolean}
 */
const isValidEnum = (value, validValues) => {
  return validValues.includes(value);
};

/**
 * Validate positive number (> 0)
 * @param {number} value
 * @returns {boolean}
 */
const isPositiveNumber = (value) => {
  const num = parseFloat(value);
  return !isNaN(num) && num > 0;
};

/**
 * Validate non-negative number (>= 0)
 * @param {number} value
 * @returns {boolean}
 */
const isNonNegativeNumber = (value) => {
  const num = parseFloat(value);
  return !isNaN(num) && num >= 0;
};

/**
 * Validate datetime string
 * @param {string} value
 * @returns {boolean}
 */
const isValidDatetime = (value) => {
  if (!value || typeof value !== 'string') return false;
  const date = new Date(value);
  return !isNaN(date.getTime());
};

module.exports = {
  isValidEmail,
  isValidPassword,
  isValidLat,
  isValidLng,
  isValidLatLng,
  isValidEnum,
  isPositiveNumber,
  isNonNegativeNumber,
  isValidDatetime
};
