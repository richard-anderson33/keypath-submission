/**
 * Keypath Enterprise Security & Observability Middleware
 * Implements Defense-in-Depth, OWASP Top 10 mitigation, and Tracing:
 * 1. Comprehensive Input Sanitization & XSS Mitigation
 * 2. Prototype Pollution Defense
 * 3. Enterprise HTTP Security Headers (HSTS, CSP, Frameguard, Sniffing prevention)
 * 4. Sliding-Window In-Memory Rate Limiting
 * 5. Correlation ID Tracing (X-Request-ID)
 */

const crypto = require('crypto');

/**
 * Escapes HTML characters to prevent Stored & Reflected Cross-Site Scripting (XSS)
 */
function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/`/g, '&#x60;');
}

/**
 * Strips script tags, javascript: pseudo-protocols, and malicious control characters
 */
function sanitizeString(str, maxLength = 500) {
  if (typeof str !== 'string') return '';
  let sanitized = str.trim();
  // Strip control characters (except newline/tab)
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // Neutralize script tags and event handlers
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  sanitized = sanitized.replace(/javascript:/gi, '');
  sanitized = sanitized.replace(/onerror\s*=/gi, '');
  sanitized = sanitized.replace(/onload\s*=/gi, '');
  sanitized = escapeHtml(sanitized);
  return sanitized.slice(0, maxLength);
}

/**
 * Detects and blocks Prototype Pollution attempts in request bodies/queries
 */
function hasPrototypePollution(obj) {
  if (!obj || typeof obj !== 'object') return false;
  for (const key of Object.keys(obj)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return true;
    }
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      if (hasPrototypePollution(obj[key])) return true;
    }
  }
  return false;
}

/**
 * Security Headers Middleware (Zero-dependency Helmet equivalent)
 */
function securityHeadersMiddleware(req, res, next) {
  // Prevent MIME-sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Prevent Clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  // Strict Transport Security (HSTS)
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // Referrer Policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Permissions Policy
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  // Content Security Policy
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'"
  );
  // Remove Express identification
  res.removeHeader('X-Powered-By');
  next();
}

/**
 * Request Tracing / Correlation ID Middleware
 */
function correlationIdMiddleware(req, res, next) {
  const correlationId = req.headers['x-request-id'] || crypto.randomUUID();
  req.correlationId = correlationId;
  res.setHeader('X-Request-ID', correlationId);
  req.startTime = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - req.startTime;
    // Structured audit logging entry
    if (process.env.NODE_ENV !== 'test_silent') {
      const logEntry = {
        timestamp: new Date().toISOString(),
        correlationId,
        method: req.method,
        path: req.originalUrl || req.url,
        statusCode: res.statusCode,
        durationMs: duration,
        ip: req.ip || req.connection.remoteAddress
      };
      // Log errors or write debug info
      if (res.statusCode >= 400 && process.env.NODE_ENV !== 'test') {
        console.warn(`[AUDIT-WARN]`, JSON.stringify(logEntry));
      }
    }
  });

  next();
}

/**
 * Sliding Window In-Memory Rate Limiter
 */
class SlidingWindowRateLimiter {
  constructor(windowMs = 60000, maxRequests = 100) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.hits = new Map();
  }

  middleware() {
    return (req, res, next) => {
      const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
      const now = Date.now();

      let clientHits = this.hits.get(clientIp);
      if (!clientHits) {
        clientHits = [];
        this.hits.set(clientIp, clientHits);
      }

      // Filter timestamps outside current sliding window
      clientHits = clientHits.filter((time) => now - time < this.windowMs);
      this.hits.set(clientIp, clientHits);

      if (clientHits.length >= this.maxRequests) {
        res.setHeader('Retry-After', Math.ceil(this.windowMs / 1000));
        return res.status(429).json({
          error: 'Too Many Requests',
          message: `Rate limit exceeded (${this.maxRequests} requests per ${this.windowMs / 1000}s). Please retry later.`,
          correlationId: req.correlationId
        });
      }

      clientHits.push(now);
      res.setHeader('X-RateLimit-Limit', this.maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, this.maxRequests - clientHits.length));
      next();
    };
  }

  reset() {
    this.hits.clear();
  }
}

module.exports = {
  escapeHtml,
  sanitizeString,
  hasPrototypePollution,
  securityHeadersMiddleware,
  correlationIdMiddleware,
  SlidingWindowRateLimiter
};
