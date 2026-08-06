/**
 * Input validation, sanitization, and security utility for TrustLink Escrow.
 * Protects serverless functions and APIs against XSS, injection, invalid data types,
 * and malformed payloads.
 */

/**
 * Sanitizes input strings by stripping HTML tags, control characters, and truncating to maxLen.
 * @param {any} val - The input string to sanitize.
 * @param {number} maxLen - Maximum allowed length (default: 500).
 * @returns {string} Sanitized string.
 */
export function sanitizeString(val, maxLen = 500) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  // Strip HTML / script tags
  const clean = str
    .replace(/<[^>]*>?/gm, '')
    .replace(/[<>'"`;]/g, (char) => {
      const entities = { '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;', '`': '&#96;', ';': '&#59;' };
      return entities[char] || char;
    })
    .trim();
  return clean.slice(0, maxLen);
}

/**
 * Validates and normalizes Ghanaian phone numbers.
 * Valid network prefixes in Ghana:
 * - MTN: 024, 025, 053, 054, 055, 059
 * - Telecel (Vodafone): 020, 050
 * - AT (AirtelTigo): 026, 027, 056, 057
 * 
 * @param {string} phone - The input phone number.
 * @returns {{ isValid: boolean, valid: boolean, local: string, formattedLocal: string, intl: string, network: string, error?: string }}
 */
export function validateGhanaPhone(phone) {
  if (!phone || (typeof phone !== 'string' && typeof phone !== 'number')) {
    return { isValid: false, valid: false, local: '', formattedLocal: '', intl: '', network: 'Unknown', error: 'Phone number is required.' };
  }

  // Remove whitespace, dashes, parens, and "whatsapp:" prefixes
  let digits = String(phone).replace(/^whatsapp:/i, '').replace(/[^\d]/g, '');

  // Normalize to 10-digit local format starting with '0'
  if (digits.startsWith('233') && digits.length === 12) {
    digits = '0' + digits.slice(3);
  } else if (!digits.startsWith('0') && digits.length === 9) {
    digits = '0' + digits;
  }

  if (digits.length !== 10) {
    return { 
      isValid: false, 
      valid: false,
      local: '', 
      formattedLocal: '',
      intl: '', 
      network: 'Unknown',
      error: `Invalid phone length (${digits.length} digits). Standard Ghanaian numbers are 10 digits (e.g. 0551234567).` 
    };
  }

  const validPrefixes = {
    '024': 'MTN', '025': 'MTN', '053': 'MTN', '054': 'MTN', '055': 'MTN', '059': 'MTN',
    '020': 'Telecel', '050': 'Telecel',
    '026': 'AT', '027': 'AT', '056': 'AT', '057': 'AT', '028': 'AT'
  };
  const prefix = digits.slice(0, 3);
  const network = validPrefixes[prefix];
  
  if (!network) {
    return {
      isValid: false,
      valid: false,
      local: '',
      formattedLocal: '',
      intl: '',
      network: 'Unknown',
      error: `Unrecognized Ghanaian network prefix (${prefix}). Supported: MTN, Telecel, AT.`
    };
  }

  const local = digits;
  const intl = '233' + digits.slice(1);
  return { isValid: true, valid: true, local, formattedLocal: local, intl, network };
}

/**
 * Validates and cleans escrow transaction amounts.
 * Gracefully parses user inputs with currency tags (e.g. 450gh, 450ghc, GH₵ 450, 450 cedis, GHS 450).
 * 
 * @param {any} amount - Amount value or string input.
 * @param {number} min - Minimum allowed amount (default: GH₵ 1.00).
 * @param {number} max - Maximum allowed amount (default: GH₵ 50,000.00).
 * @returns {{ isValid: boolean, valid: boolean, amount: number, value: number, formatted: string, error?: string }}
 */
export function validateAmount(amount, min = 1.00, max = 50000.00) {
  if (amount === null || amount === undefined || (typeof amount === 'string' && !amount.trim())) {
    return { isValid: false, valid: false, amount: 0, value: 0, formatted: 'GH₵ 0.00', error: 'Amount is required.' };
  }

  // Clean currency tags, commas, spaces (e.g. "450gh", "GH₵450.50", "1,200 cedis", "450 GHS")
  let cleaned = String(amount)
    .replace(/[GH₵GHScedis,]/gi, '')
    .replace(/\s+/g, '')
    .trim();

  const num = parseFloat(cleaned);
  if (!Number.isFinite(num) || isNaN(num)) {
    return { isValid: false, valid: false, amount: 0, value: 0, formatted: 'GH₵ 0.00', error: 'Amount must be a valid numeric value (e.g. 450 or 1200.50).' };
  }
  if (num < min) {
    return { isValid: false, valid: false, amount: num, value: num, formatted: `GH₵ ${num.toFixed(2)}`, error: `Amount must be at least GH₵ ${min.toFixed(2)}.` };
  }
  if (num > max) {
    return { isValid: false, valid: false, amount: num, value: num, formatted: `GH₵ ${num.toFixed(2)}`, error: `Amount cannot exceed GH₵ ${max.toLocaleString('en-US')}.` };
  }
  // Check decimal places (max 2)
  const parts = num.toString().split('.');
  if (parts.length > 1 && parts[1].length > 2) {
    return { isValid: false, valid: false, amount: num, value: num, formatted: `GH₵ ${num.toFixed(2)}`, error: 'Amount cannot have more than 2 decimal places.' };
  }
  const finalVal = Math.round(num * 100) / 100;
  return { isValid: true, valid: true, amount: finalVal, value: finalVal, formatted: `GH₵ ${finalVal.toFixed(2)}` };
}

/**
 * Validates email format.
 * @param {string} email - Email address.
 * @returns {boolean}
 */
export function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email.trim()) && email.length <= 254;
}

/**
 * Validates alphanumeric identifiers (e.g. Escrow IDs, references).
 * @param {string} id - Identifier string.
 * @param {number} maxLen - Maximum length (default: 64).
 * @returns {boolean}
 */
export function isValidId(id, maxLen = 64) {
  if (!id || typeof id !== 'string') return false;
  const clean = id.trim();
  return clean.length >= 3 && clean.length <= maxLen && /^[a-zA-Z0-9_-]+$/.test(clean);
}
