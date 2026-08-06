/**
 * Structured, PII-safe JSON logger for TrustLink Escrow serverless functions.
 * Provides request tracing, standardized log levels, and automatic data redaction.
 */

import { getClientIp } from './rate-limiter.js';

/**
 * Masks sensitive personal data (phone numbers, emails, tokens).
 * @param {any} data
 * @returns {any} Sanitized data copy
 */
export function maskSensitiveData(data) {
  if (!data || typeof data !== 'object') {
    if (typeof data === 'string') {
      // Mask phone numbers (10 digits)
      if (/^\d{10}$/.test(data)) {
        return data.slice(0, 3) + '****' + data.slice(7);
      }
      // Mask intl phone numbers (12 digits)
      if (/^233\d{9}$/.test(data)) {
        return data.slice(0, 5) + '****' + data.slice(9);
      }
    }
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(maskSensitiveData);
  }

  const redacted = {};
  for (const [key, value] of Object.entries(data)) {
    const lower = key.toLowerCase();
    if (['authorization', 'token', 'secret', 'apikey', 'password', 'pin', 'key', 'cvv'].some(s => lower.includes(s))) {
      redacted[key] = '***REDACTED***';
    } else if (['phone', 'recipient', 'to', 'payer', 'momonumber'].some(s => lower.includes(s))) {
      redacted[key] = typeof value === 'string' && value.length >= 7 
        ? value.slice(0, 3) + '****' + value.slice(-3)
        : '***REDACTED***';
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = maskSensitiveData(value);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

/**
 * Creates a scoped request logger for a serverless execution.
 * @param {import('http').IncomingMessage} req
 * @param {string} serviceName - e.g. 'sms-dispatch', 'whatsapp-webhook'
 */
export function createRequestLogger(req, serviceName = 'serverless-api') {
  const requestId = req.headers['x-request-id'] || `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const ip = getClientIp(req);
  const method = req.method;
  const url = req.url;

  const log = (level, event, message, metadata = {}) => {
    const entry = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      service: serviceName,
      requestId,
      clientIp: ip,
      httpMethod: method,
      endpoint: url,
      event,
      message,
      data: maskSensitiveData(metadata)
    };
    
    if (level === 'error') {
      console.error(JSON.stringify(entry));
    } else if (level === 'warn') {
      console.warn(JSON.stringify(entry));
    } else {
      console.log(JSON.stringify(entry));
    }
  };

  return {
    requestId,
    info: (event, message, data) => log('info', event, message, data),
    warn: (event, message, data) => log('warn', event, message, data),
    error: (event, message, data) => log('error', event, message, data),
    audit: (event, message, data) => log('audit', event, message, data)
  };
}
