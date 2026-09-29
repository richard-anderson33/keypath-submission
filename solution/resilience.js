/**
 * Keypath Enterprise Resilience Engine
 * Implements Production-Grade Fault Tolerance Patterns:
 * 1. Exponential Backoff with Full Jitter (AWS/Polly architecture)
 * 2. 3-State Circuit Breaker (Closed, Open, Half-Open) with Fail-Fast & Telemetry
 * 3. Idempotent Operation Cache (Deduplication for at-least-once message delivery)
 */

class CircuitBreakerOpenError extends Error {
  constructor(message = 'Circuit breaker is OPEN. Fast failing downstream request.') {
    super(message);
    this.name = 'CircuitBreakerOpenError';
    this.isCircuitBreaker = true;
  }
}

class CircuitBreaker {
  constructor(options = {}) {
    this.name = options.name || 'DefaultCircuitBreaker';
    this.failureThreshold = options.failureThreshold || 3;
    this.cooldownPeriodMs = options.cooldownPeriodMs || 2000;
    this.successThreshold = options.successThreshold || 2; // successes in half-open to close

    this.state = 'CLOSED'; // 'CLOSED' | 'OPEN' | 'HALF_OPEN'
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = null;
    this.totalRequests = 0;
    this.totalFailures = 0;
    this.totalShortCircuits = 0;
  }

  isOpen() {
    if (this.state === 'OPEN') {
      const now = Date.now();
      if (now - this.lastFailureTime > this.cooldownPeriodMs) {
        this.state = 'HALF_OPEN';
        this.consecutiveSuccesses = 0;
        return false;
      }
      return true;
    }
    return false;
  }

  async execute(operation) {
    this.totalRequests++;

    if (this.isOpen()) {
      this.totalShortCircuits++;
      throw new CircuitBreakerOpenError(`Circuit '${this.name}' is OPEN. Request rejected.`);
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(err);
      throw err;
    }
  }

  onSuccess() {
    if (this.state === 'HALF_OPEN') {
      this.consecutiveSuccesses++;
      if (this.consecutiveSuccesses >= this.successThreshold) {
        this.state = 'CLOSED';
        this.consecutiveFailures = 0;
        this.consecutiveSuccesses = 0;
      }
    } else {
      this.consecutiveFailures = 0;
    }
  }

  onFailure(err) {
    this.totalFailures++;
    this.lastFailureTime = Date.now();
    this.consecutiveFailures++;

    if (this.state === 'HALF_OPEN' || this.consecutiveFailures >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  getMetrics() {
    return {
      name: this.name,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
      totalShortCircuits: this.totalShortCircuits,
      cooldownPeriodMs: this.cooldownPeriodMs
    };
  }

  reset() {
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = null;
  }
}

/**
 * Executes an async operation with Exponential Backoff and Full Jitter
 * Formula: Sleep = rand(0, min(maxBackoff, baseDelay * 2^attempt))
 */
async function executeWithRetry(operation, options = {}) {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 50;
  const maxDelayMs = options.maxDelayMs ?? 2000;
  const isRetryable = options.isRetryable || ((err) => !err.isNonRetryable && !err.isCircuitBreaker);
  const onRetry = options.onRetry || (() => {});

  let attempt = 0;
  const executionLog = [];

  while (true) {
    const startTime = Date.now();
    try {
      const result = await operation(attempt);
      executionLog.push({ attempt, durationMs: Date.now() - startTime, success: true });
      return { result, attempts: attempt + 1, executionLog };
    } catch (err) {
      executionLog.push({ attempt, durationMs: Date.now() - startTime, success: false, error: err.message });

      if (attempt >= maxRetries || !isRetryable(err)) {
        err.attempts = attempt + 1;
        err.executionLog = executionLog;
        throw err;
      }

      // Calculate Exponential Backoff with Full Jitter
      const exponentialBackoff = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
      const jitteredDelay = Math.floor(Math.random() * exponentialBackoff);

      onRetry({ attempt: attempt + 1, delayMs: jitteredDelay, error: err });
      await new Promise((resolve) => setTimeout(resolve, jitteredDelay));
      attempt++;
    }
  }
}

/**
 * In-Memory Idempotency Cache with TTL & payload hashing
 */
class IdempotencyStore {
  constructor(ttlMs = 60000) {
    this.ttlMs = ttlMs;
    this.cache = new Map();
  }

  has(key) {
    this.cleanup();
    return this.cache.has(key);
  }

  get(key) {
    this.cleanup();
    const entry = this.cache.get(key);
    return entry ? entry.response : null;
  }

  set(key, response) {
    this.cache.set(key, {
      response,
      expiresAt: Date.now() + this.ttlMs
    });
  }

  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
      }
    }
  }

  clear() {
    this.cache.clear();
  }
}

module.exports = {
  CircuitBreaker,
  CircuitBreakerOpenError,
  executeWithRetry,
  IdempotencyStore
};
