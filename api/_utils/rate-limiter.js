/**
 * In-Memory Sliding-Window Rate Limiter for Vercel Serverless Functions.
 * Protects endpoints from abuse, credential stuffing, SMS toll fraud, and spam.
 */

// Global tracking store in serverless function container memory
const rateLimitStore = new Map();

// Periodic cleanup of expired records every 60 seconds
let lastCleanup = Date.now();
function cleanupExpired() {
  const now = Date.now();
  if (now - lastCleanup < 60000) return;
  lastCleanup = now;

  for (const [key, timestamps] of rateLimitStore.entries()) {
    const valid = timestamps.filter(ts => now - ts < 3600000); // 1 hour max
    if (valid.length === 0) {
      rateLimitStore.delete(key);
    } else {
      rateLimitStore.set(key, valid);
    }
  }
}

/**
 * Extracts client IP address reliably from Vercel / Cloudflare headers.
 * @param {import('http').IncomingMessage} req
 * @returns {string} Client IP address
 */
export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const list = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;
    return list.split(',')[0].trim();
  }
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || '127.0.0.1';
}

/**
 * Checks and records rate limit for a request.
 * @param {import('http').IncomingMessage} req
 * @param {Object} options
 * @param {number} options.maxRequests - Max allowed requests in window
 * @param {number} options.windowSeconds - Window duration in seconds
 * @param {string} [options.keyPrefix] - Optional prefix to segment limits by endpoint
 * @returns {{ allowed: boolean, remaining: number, resetSeconds: number, current: number, limit: number }}
 */
export function checkRateLimit(req, options = {}) {
  cleanupExpired();

  const maxRequests = options.maxRequests || 10;
  const windowSeconds = options.windowSeconds || 60;
  const keyPrefix = options.keyPrefix || 'global';
  const ip = getClientIp(req);
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const key = `${keyPrefix}:${ip}`;

  let timestamps = rateLimitStore.get(key) || [];
  // Filter out timestamps older than the sliding window
  timestamps = timestamps.filter(ts => now - ts < windowMs);

  if (timestamps.length >= maxRequests) {
    const oldestTimestamp = timestamps[0];
    const resetSeconds = Math.ceil((oldestTimestamp + windowMs - now) / 1000);
    return {
      allowed: false,
      remaining: 0,
      resetSeconds: Math.max(1, resetSeconds),
      current: timestamps.length,
      limit: maxRequests
    };
  }

  // Record this request
  timestamps.push(now);
  rateLimitStore.set(key, timestamps);

  return {
    allowed: true,
    remaining: maxRequests - timestamps.length,
    resetSeconds: windowSeconds,
    current: timestamps.length,
    limit: maxRequests
  };
}

/**
 * Middleware helper that applies rate limit headers and handles 429 response.
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {Object} options
 * @returns {boolean} True if allowed to proceed, false if rate limited and response was sent.
 */
export function enforceRateLimit(req, res, options = {}) {
  const result = checkRateLimit(req, options);

  res.setHeader('X-RateLimit-Limit', result.limit.toString());
  res.setHeader('X-RateLimit-Remaining', result.remaining.toString());

  if (!result.allowed) {
    res.setHeader('Retry-After', result.resetSeconds.toString());
    res.status(429).json({
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Please wait ${result.resetSeconds} seconds before retrying.`,
      retryAfterSeconds: result.resetSeconds
    });
    return false;
  }

  return true;
}
