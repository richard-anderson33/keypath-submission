const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const {
  CircuitBreaker,
  CircuitBreakerOpenError,
  executeWithRetry,
  IdempotencyStore
} = require('./resilience');

const {
  sanitizeString,
  hasPrototypePollution,
  securityHeadersMiddleware,
  correlationIdMiddleware,
  SlidingWindowRateLimiter
} = require('./security');

const app = express();
const PORT = process.env.PORT || 3000;

// Setup multer for multipart/form-data (in-memory parsing with file size limits)
const upload = multer({
  limits: { fileSize: 1024 * 1024 } // 1MB limit for file payloads
});

// Setup resilience & security components
const idempotencyStore = new IdempotencyStore(60000); // 60s TTL
const globalRateLimiter = new SlidingWindowRateLimiter(60000, 300); // 300 reqs/min
const downstreamBreaker = new CircuitBreaker({
  name: 'DownstreamSMSGateway',
  failureThreshold: 3,
  cooldownPeriodMs: 1500,
  successThreshold: 2
});

// Mock simulation state for chaos testing / demonstration
const chaosConfig = {
  injectFailure: false,
  failureRate: 0, // 0.0 to 1.0
  simulatedLatencyMs: 10
};

// --- Middleware Pipeline ---
app.use(securityHeadersMiddleware);
app.use(correlationIdMiddleware);
app.use(globalRateLimiter.middleware());
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'Idempotency-Key', 'X-Idempotency-Key']
}));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Prototype Pollution Guard
app.use((req, res, next) => {
  if (hasPrototypePollution(req.body) || hasPrototypePollution(req.query)) {
    return res.status(400).json({
      error: 'Security Exception: Malformed request payload contains restricted prototype properties.',
      correlationId: req.correlationId
    });
  }
  next();
});

// Seed records dataset
const initialSeedRecords = [
  { id: 1, stringValue: "Azure Service Bus Integration", category: "Cloud Architecture", submittedBy: "Richard M.", submittedOn: "2026-09-20T10:15:00Z", modifiedOn: "2026-09-20T10:15:00Z", status: "Approved" },
  { id: 2, stringValue: "Polly Circuit Breaker Policy", category: "Resilience", submittedBy: "Erich B.", submittedOn: "2026-09-21T11:30:00Z", modifiedOn: "2026-09-22T08:45:00Z", status: "Active" },
  { id: 3, stringValue: "Azure SQL Outbox Trigger", category: "Database", submittedBy: "Alaina F.", submittedOn: "2026-09-22T14:20:00Z", modifiedOn: "2026-09-22T14:20:00Z", status: "Pending" },
  { id: 4, stringValue: "SMS Queue Consumer Scaler", category: "Compute", submittedBy: "Richard M.", submittedOn: "2026-09-23T09:00:00Z", modifiedOn: "2026-09-24T16:10:00Z", status: "Approved" },
  { id: 5, stringValue: "React Responsive Data Grid", category: "Frontend", submittedBy: "Sarah L.", submittedOn: "2026-09-24T13:45:00Z", modifiedOn: "2026-09-24T13:45:00Z", status: "Active" },
  { id: 6, stringValue: "Express Multi-Format API Ingestion", category: "Backend", submittedBy: "Richard M.", submittedOn: "2026-09-25T08:30:00Z", modifiedOn: "2026-09-25T10:00:00Z", status: "Approved" },
  { id: 7, stringValue: "Application Insights Telemetry", category: "Monitoring", submittedBy: "DevOps Team", submittedOn: "2026-09-25T15:10:00Z", modifiedOn: "2026-09-25T15:10:00Z", status: "Active" },
  { id: 8, stringValue: "Azure Functions Isolated Worker", category: "Compute", submittedBy: "Erich B.", submittedOn: "2026-09-26T12:00:00Z", modifiedOn: "2026-09-26T14:30:00Z", status: "Approved" },
  { id: 9, stringValue: "Dead Letter Queue Automated Replay", category: "Resilience", submittedBy: "Richard M.", submittedOn: "2026-09-26T16:45:00Z", modifiedOn: "2026-09-27T09:15:00Z", status: "Pending" },
  { id: 10, stringValue: "JWT Authentication & Role Claims", category: "Security", submittedBy: "Security Team", submittedOn: "2026-09-27T10:30:00Z", modifiedOn: "2026-09-27T10:30:00Z", status: "Active" },
  { id: 11, stringValue: "Bicep Infrastructure Templates", category: "DevOps", submittedBy: "Richard M.", submittedOn: "2026-09-27T14:00:00Z", modifiedOn: "2026-09-27T14:00:00Z", status: "Approved" },
  { id: 12, stringValue: "Third-Party API Mock Server", category: "Testing", submittedBy: "QA Lead", submittedOn: "2026-09-28T09:15:00Z", modifiedOn: "2026-09-28T09:15:00Z", status: "Active" }
];

let recordsStore = [...initialSeedRecords];
let nextId = recordsStore.length + 1;

/**
 * Simulates calling downstream SMS dispatch service with 95% SLA and transient errors
 */
async function simulateDownstreamDispatch(record) {
  return downstreamBreaker.execute(async () => {
    return executeWithRetry(
      async (attempt) => {
        if (chaosConfig.simulatedLatencyMs > 0) {
          await new Promise((r) => setTimeout(r, chaosConfig.simulatedLatencyMs));
        }

        if (chaosConfig.injectFailure || (chaosConfig.failureRate > 0 && Math.random() < chaosConfig.failureRate)) {
          const err = new Error('503 Service Unavailable: Downstream SMS Gateway is degraded.');
          err.isTransient = true;
          throw err;
        }

        return {
          dispatchId: `disp-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          status: 'Delivered',
          timestamp: new Date().toISOString()
        };
      },
      {
        maxRetries: 2,
        baseDelayMs: 25,
        maxDelayMs: 200,
        isRetryable: (err) => err.isTransient
      }
    );
  });
}

/**
 * 1. Data Ingestion Endpoint (Supports JSON, Form-Data, Query String, Idempotency, and Sanitization)
 * POST /api/records/ingest
 */
app.post('/api/records/ingest', upload.none(), async (req, res) => {
  // Idempotency Check
  const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
  if (idempotencyKey && idempotencyStore.has(idempotencyKey)) {
    res.setHeader('X-Cache-Lookup', 'HIT');
    return res.status(201).json(idempotencyStore.get(idempotencyKey));
  }

  // Extract data from Body (JSON or Form-Data) or Query String
  const source = Object.keys(req.body).length > 0 ? req.body : req.query;

  const rawString = source.stringValue || source.title || source.message || source.stringVal;
  const rawCategory = source.category || "General";
  const rawSubmittedBy = source.submittedBy || source.author || "Anonymous";

  if (!rawString || typeof rawString !== 'string' || rawString.trim().length === 0) {
    return res.status(400).json({
      error: "Validation Error: At least one string field ('stringValue' or 'title') is required.",
      correlationId: req.correlationId
    });
  }

  // Senior-Level Defensive Sanitization
  const stringValue = sanitizeString(rawString, 300);
  const category = sanitizeString(rawCategory, 100);
  const submittedBy = sanitizeString(rawSubmittedBy, 100);

  const newRecord = {
    id: nextId++,
    stringValue,
    category,
    submittedBy,
    submittedOn: new Date().toISOString(),
    modifiedOn: new Date().toISOString(),
    status: sanitizeString(source.status || "Submitted", 50)
  };

  // Resilient downstream dispatch simulation
  let dispatchResult = null;
  try {
    const dispatchResponse = await simulateDownstreamDispatch(newRecord);
    dispatchResult = { status: 'Dispatched', attempts: dispatchResponse.attempts };
  } catch (err) {
    dispatchResult = {
      status: 'QueuedForRetry',
      warning: err.isCircuitBreaker ? 'Circuit Breaker Open - Fast-failed downstream' : 'Downstream Transient Error'
    };
  }

  recordsStore.unshift(newRecord);

  const responsePayload = {
    message: "Record successfully ingested",
    ingestedFormat: req.headers['content-type'] || 'query-string',
    record: newRecord,
    downstream: dispatchResult,
    correlationId: req.correlationId
  };

  if (idempotencyKey) {
    idempotencyStore.set(idempotencyKey, responsePayload);
  }

  return res.status(201).json(responsePayload);
});

/**
 * GET /api/records/ingest (Support ingestion directly via GET Query String with sanitization)
 */
app.get('/api/records/ingest', async (req, res) => {
  const rawString = req.query.stringValue || req.query.title || req.query.message || req.query.stringVal;
  const rawCategory = req.query.category || "General";
  const rawSubmittedBy = req.query.submittedBy || req.query.author || "Query String User";

  if (!rawString || typeof rawString !== 'string' || rawString.trim().length === 0) {
    return res.status(400).json({
      error: "Validation Error: Query param 'stringValue' or 'title' must be provided.",
      correlationId: req.correlationId
    });
  }

  const stringValue = sanitizeString(rawString, 300);
  const category = sanitizeString(rawCategory, 100);
  const submittedBy = sanitizeString(rawSubmittedBy, 100);

  const newRecord = {
    id: nextId++,
    stringValue,
    category,
    submittedBy,
    submittedOn: new Date().toISOString(),
    modifiedOn: new Date().toISOString(),
    status: sanitizeString(req.query.status || "Submitted via Query String", 50)
  };

  recordsStore.unshift(newRecord);

  return res.status(201).json({
    message: "Record successfully ingested via Query String",
    ingestedFormat: "Query String",
    record: newRecord,
    correlationId: req.correlationId
  });
});

/**
 * 2. Search & Paginated Fetch Endpoint
 * GET /api/records
 */
app.get('/api/records', (req, res) => {
  const { search = '', matchType = 'contains', sortBy = 'submittedOn', sortOrder = 'desc' } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.max(1, Math.min(100, parseInt(req.query.pageSize, 10) || 5));

  let filtered = [...recordsStore];
  const queryTerm = search.trim();

  // Enforce 3-character search constraint
  const isSearchActive = queryTerm.length >= 3;

  if (isSearchActive) {
    filtered = filtered.filter(item => {
      const target = item.stringValue.toLowerCase();
      const term = queryTerm.toLowerCase();
      return matchType === 'equals' ? target === term : target.includes(term);
    });
  }

  // Safe sorting keys whitelist to prevent property injection
  const allowedSortKeys = ['stringValue', 'submittedOn', 'modifiedOn', 'category', 'submittedBy', 'status', 'id'];
  const safeSortBy = allowedSortKeys.includes(sortBy) ? sortBy : 'submittedOn';

  filtered.sort((a, b) => {
    let valA = a[safeSortBy] ?? '';
    let valB = b[safeSortBy] ?? '';

    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();

    if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
    if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });

  // Pagination
  const totalCount = filtered.length;
  const totalPages = Math.ceil(totalCount / pageSize) || 1;
  const startIndex = (page - 1) * pageSize;
  const paginatedData = filtered.slice(startIndex, startIndex + pageSize);

  res.json({
    data: paginatedData,
    totalCount,
    page,
    pageSize,
    totalPages,
    searchApplied: isSearchActive,
    searchQuery: isSearchActive ? queryTerm : null,
    matchType,
    correlationId: req.correlationId
  });
});

/**
 * 3. Health & Readiness Probes (Cloud-Native Standard)
 */
app.get('/healthz', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    correlationId: req.correlationId
  });
});

app.get('/readyz', (req, res) => {
  const isReady = downstreamBreaker.state !== 'OPEN';
  res.status(isReady ? 200 : 503).json({
    status: isReady ? 'ready' : 'degraded',
    circuitBreaker: downstreamBreaker.getMetrics(),
    storeRecordCount: recordsStore.length,
    correlationId: req.correlationId
  });
});

/**
 * 4. Diagnostics & Resilience Metrics Endpoint
 */
app.get('/api/diagnostics', (req, res) => {
  res.json({
    circuitBreaker: downstreamBreaker.getMetrics(),
    chaosConfig,
    activeRecords: recordsStore.length,
    uptimeSeconds: Math.floor(process.uptime())
  });
});

/**
 * 5. Chaos / Failure Injection Endpoint (For testing & resilience demonstration)
 */
app.post('/api/resilience/simulate', (req, res) => {
  const { injectFailure, failureRate, resetBreaker } = req.body || {};
  if (typeof injectFailure === 'boolean') chaosConfig.injectFailure = injectFailure;
  if (typeof failureRate === 'number') chaosConfig.failureRate = Math.max(0, Math.min(1, failureRate));
  if (resetBreaker) downstreamBreaker.reset();

  res.json({
    message: 'Chaos configuration updated',
    chaosConfig,
    circuitBreaker: downstreamBreaker.getMetrics()
  });
});

/**
 * 6. Dataset Reset Endpoint
 */
app.post('/api/records/reset', (req, res) => {
  recordsStore = [...initialSeedRecords];
  nextId = recordsStore.length + 1;
  idempotencyStore.clear();
  downstreamBreaker.reset();
  res.json({
    message: "Dataset reset to seed records successfully.",
    count: recordsStore.length,
    correlationId: req.correlationId
  });
});

// Fallback to serving SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error(`[UNHANDLED-ERROR] correlationId=${req.correlationId}:`, err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: 'An unexpected error occurred. Tracing ID provided for diagnostics.',
    correlationId: req.correlationId
  });
});

let serverInstance = null;
if (require.main === module) {
  serverInstance = app.listen(PORT, () => {
    console.log(`Keypath API & SPA solution server running on http://localhost:${PORT}`);
  });

  // Graceful shutdown handling
  const shutdown = (signal) => {
    console.log(`[SHUTDOWN] Received ${signal}. Draining connections...`);
    if (serverInstance) {
      serverInstance.close(() => {
        console.log('[SHUTDOWN] HTTP server closed cleanly. Exiting.');
        process.exit(0);
      });
      // Force exit if drain takes longer than 5 seconds
      setTimeout(() => {
        console.error('[SHUTDOWN] Force exiting after timeout.');
        process.exit(1);
      }, 5000).unref();
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = {
  app,
  downstreamBreaker,
  idempotencyStore,
  globalRateLimiter,
  chaosConfig,
  initialSeedRecords
};
