const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const {
  CircuitBreaker,
  CircuitBreakerOpenError,
  executeWithRetry,
  IdempotencyStore
} = require('./resilience');

const {
  sanitizeString,
  hasPrototypePollution
} = require('./security');

const { app } = require('./server');

let testServer = null;
let BASE_URL = process.env.TEST_URL || null;

before(async () => {
  if (!BASE_URL) {
    await new Promise((resolve) => {
      testServer = app.listen(0, () => {
        const port = testServer.address().port;
        BASE_URL = `http://localhost:${port}`;
        resolve();
      });
    });
  }
});

after(async () => {
  if (testServer) {
    await new Promise((resolve) => testServer.close(resolve));
  }
});

function makeRequest(path, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const headers = options.headers || {};
    const reqOptions = {
      method: options.method || 'GET',
      headers
    };

    const req = http.request(url, reqOptions, (res) => {
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(rawData);
        } catch (e) {
          json = rawData;
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: json
        });
      });
    });

    req.on('error', reject);

    if (body) {
      if (typeof body === 'object') {
        req.setHeader('Content-Type', 'application/json');
        req.write(JSON.stringify(body));
      } else {
        req.write(body);
      }
    }

    req.end();
  });
}

// ==========================================
// 1. UNIT TESTS: RESILIENCE & RETRY ENGINE
// ==========================================

test('Resilience Unit: executeWithRetry succeeds after transient failures', async () => {
  let callCount = 0;
  const flakyOp = async (attempt) => {
    callCount++;
    if (callCount < 3) {
      const err = new Error('Transient 503 Gateway Timeout');
      err.isTransient = true;
      throw err;
    }
    return 'OperationSuccess';
  };

  const { result, attempts, executionLog } = await executeWithRetry(flakyOp, {
    maxRetries: 3,
    baseDelayMs: 10,
    maxDelayMs: 50,
    isRetryable: (err) => err.isTransient
  });

  assert.strictEqual(result, 'OperationSuccess');
  assert.strictEqual(attempts, 3);
  assert.strictEqual(executionLog.length, 3);
  assert.strictEqual(executionLog[0].success, false);
  assert.strictEqual(executionLog[1].success, false);
  assert.strictEqual(executionLog[2].success, true);
});

test('Resilience Unit: executeWithRetry halts immediately on non-retryable error', async () => {
  let callCount = 0;
  const fatalOp = async () => {
    callCount++;
    const err = new Error('400 Bad Request');
    err.isNonRetryable = true;
    throw err;
  };

  await assert.rejects(
    async () => {
      await executeWithRetry(fatalOp, { maxRetries: 3, baseDelayMs: 10 });
    },
    (err) => {
      assert.strictEqual(callCount, 1);
      assert.strictEqual(err.message, '400 Bad Request');
      return true;
    }
  );
});

test('Resilience Unit: CircuitBreaker transitions CLOSED -> OPEN -> HALF_OPEN -> CLOSED', async () => {
  const breaker = new CircuitBreaker({
    name: 'UnitTestBreaker',
    failureThreshold: 2,
    cooldownPeriodMs: 50,
    successThreshold: 2
  });

  assert.strictEqual(breaker.state, 'CLOSED');

  // Trigger 2 failures to trip the breaker
  const failingOp = async () => { throw new Error('Downstream Error'); };
  await assert.rejects(() => breaker.execute(failingOp));
  await assert.rejects(() => breaker.execute(failingOp));

  // Breaker should now be OPEN
  assert.strictEqual(breaker.state, 'OPEN');

  // Should fast-fail without calling downstream
  let downstreamCalled = false;
  await assert.rejects(
    () => breaker.execute(async () => { downstreamCalled = true; }),
    (err) => {
      assert.strictEqual(err.name, 'CircuitBreakerOpenError');
      assert.strictEqual(downstreamCalled, false);
      return true;
    }
  );

  // Wait for cooldown period to elapse
  await new Promise((r) => setTimeout(r, 60));

  // Next call should transition state to HALF_OPEN
  const successOp = async () => 'Recovered';
  const res1 = await breaker.execute(successOp);
  assert.strictEqual(res1, 'Recovered');
  assert.strictEqual(breaker.state, 'HALF_OPEN');

  // Second consecutive success should close the breaker
  const res2 = await breaker.execute(successOp);
  assert.strictEqual(res2, 'Recovered');
  assert.strictEqual(breaker.state, 'CLOSED');
});

// ==========================================
// 2. UNIT TESTS: ENTERPRISE SECURITY
// ==========================================

test('Security Unit: sanitizeString neutralizes XSS scripts and escapes HTML entities', () => {
  const malicious = '<script>alert("xss")</script><b>Hello & Welcome</b>';
  const clean = sanitizeString(malicious);
  assert.strictEqual(clean.includes('<script>'), false);
  assert.strictEqual(clean.includes('&lt;b&gt;Hello &amp; Welcome&lt;/b&gt;'), true);
});

test('Security Unit: hasPrototypePollution detects __proto__ and prototype injection', () => {
  const safeObj = { query: 'Azure', page: 1 };
  assert.strictEqual(hasPrototypePollution(safeObj), false);

  const maliciousObj = JSON.parse('{"__proto__": {"polluted": true}}');
  assert.strictEqual(hasPrototypePollution(maliciousObj), true);
});

// ==========================================
// 3. INTEGRATION TESTS: HTTP ENDPOINTS
// ==========================================

test('HTTP: Root SPA HTML serves 200 OK', async () => {
  const res = await makeRequest('/');
  assert.strictEqual(res.statusCode, 200);
  assert.match(res.body, /Keypath/);
});

test('HTTP: Security headers and X-Request-ID correlation headers are injected', async () => {
  const testRequestId = 'test-trace-id-12345';
  const res = await makeRequest('/healthz', {
    headers: { 'X-Request-ID': testRequestId }
  });

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
  assert.strictEqual(res.headers['x-frame-options'], 'DENY');
  assert.strictEqual(res.headers['strict-transport-security'], 'max-age=31536000; includeSubDomains');
  assert.strictEqual(res.headers['x-request-id'], testRequestId);
});

test('HTTP: GET /healthz and /readyz cloud probes respond successfully', async () => {
  const healthRes = await makeRequest('/healthz');
  assert.strictEqual(healthRes.statusCode, 200);
  assert.strictEqual(healthRes.body.status, 'healthy');

  const readyRes = await makeRequest('/readyz');
  assert.strictEqual(readyRes.statusCode, 200);
  assert.strictEqual(readyRes.body.status, 'ready');
});

test('HTTP: GET /api/records returns paginated records with totalCount', async () => {
  const res = await makeRequest('/api/records');
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(typeof res.body.totalCount, 'number');
  assert.strictEqual(res.body.page, 1);
  assert.ok(Array.isArray(res.body.data));
  assert.ok(res.body.data.length > 0);
});

test('HTTP: Search enforces 3-character threshold', async () => {
  const resShort = await makeRequest('/api/records?search=Az');
  assert.strictEqual(resShort.statusCode, 200);
  assert.strictEqual(resShort.body.searchApplied, false);

  const resLong = await makeRequest('/api/records?search=Azure&matchType=contains');
  assert.strictEqual(resLong.statusCode, 200);
  assert.strictEqual(resLong.body.searchApplied, true);
  assert.ok(resLong.body.data.length >= 3);
  resLong.body.data.forEach(item => {
    assert.match(item.stringValue.toLowerCase(), /azure/);
  });
});

test('HTTP: Multi-format ingestion validates required stringValue', async () => {
  const res = await makeRequest('/api/records/ingest', { method: 'POST' }, {});
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.error, /Validation Error/);
});

test('HTTP: POST /api/records/ingest sanitizes XSS inputs safely', async () => {
  const payload = {
    stringValue: '<script>alert("hacked")</script>Secure Record',
    category: 'Security Testing',
    submittedBy: 'QA Lead'
  };
  const res = await makeRequest('/api/records/ingest', { method: 'POST' }, payload);
  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.body.record.stringValue.includes('<script>'), false);
  assert.strictEqual(res.body.record.stringValue.includes('Secure Record'), true);
});

test('HTTP: POST /api/records/ingest enforces Idempotency-Key deduplication', async () => {
  const idempotencyKey = `idem-key-${Date.now()}`;
  const payload = {
    stringValue: 'Idempotency Guarantee Test',
    category: 'Reliability',
    submittedBy: 'Principal Engineer'
  };

  // First ingestion call
  const res1 = await makeRequest(
    '/api/records/ingest',
    { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey } },
    payload
  );
  assert.strictEqual(res1.statusCode, 201);
  const recordId1 = res1.body.record.id;

  // Second duplicate ingestion call with identical idempotency key
  const res2 = await makeRequest(
    '/api/records/ingest',
    { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey } },
    payload
  );
  assert.strictEqual(res2.statusCode, 201);
  assert.strictEqual(res2.headers['x-cache-lookup'], 'HIT');
  assert.strictEqual(res2.body.record.id, recordId1, 'Duplicate request should return original record ID without duplicate insertion');
});

test('HTTP: GET /api/records/ingest ingests via query string', async () => {
  const res = await makeRequest('/api/records/ingest?stringValue=SeniorQueryRecord&category=QueryTest&submittedBy=QueryUser');
  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.body.record.stringValue, 'SeniorQueryRecord');
});

test('HTTP: POST /api/records/reset restores seed records and clears caches', async () => {
  const res = await makeRequest('/api/records/reset', { method: 'POST' });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.count, 12);
});
