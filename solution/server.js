const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Setup multer for multipart/form-data (in-memory file handling if any files attached)
const upload = multer();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

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
 * 1. Data Ingestion Endpoint (Supports multiple formats: JSON, Form-Data, Query String)
 * POST /api/records/ingest
 */
app.post('/api/records/ingest', upload.none(), (req, res) => {
  // Extract data from Body (JSON or Form-Data) or Query String
  const source = Object.keys(req.body).length > 0 ? req.body : req.query;

  const stringValue = source.stringValue || source.title || source.message || source.stringVal;
  const category = source.category || "General";
  const submittedBy = source.submittedBy || source.author || "Anonymous";

  if (!stringValue || typeof stringValue !== 'string' || stringValue.trim().length === 0) {
    return res.status(400).json({
      error: "Validation Error: At least one string field ('stringValue' or 'title') is required."
    });
  }

  const newRecord = {
    id: nextId++,
    stringValue: stringValue.trim(),
    category: category.trim(),
    submittedBy: submittedBy.trim(),
    submittedOn: new Date().toISOString(),
    modifiedOn: new Date().toISOString(),
    status: source.status || "Submitted"
  };

  recordsStore.unshift(newRecord);

  return res.status(201).json({
    message: "Record successfully ingested",
    ingestedFormat: req.headers['content-type'] || 'query-string',
    record: newRecord
  });
});

/**
 * GET /api/records/ingest (Support ingestion directly via GET Query String as well)
 */
app.get('/api/records/ingest', (req, res) => {
  const stringValue = req.query.stringValue || req.query.title || req.query.message || req.query.stringVal;
  const category = req.query.category || "General";
  const submittedBy = req.query.submittedBy || req.query.author || "Query String User";

  if (!stringValue || typeof stringValue !== 'string' || stringValue.trim().length === 0) {
    return res.status(400).json({
      error: "Validation Error: Query param 'stringValue' or 'title' must be provided."
    });
  }

  const newRecord = {
    id: nextId++,
    stringValue: stringValue.trim(),
    category: category.trim(),
    submittedBy: submittedBy.trim(),
    submittedOn: new Date().toISOString(),
    modifiedOn: new Date().toISOString(),
    status: req.query.status || "Submitted via Query String"
  };

  recordsStore.unshift(newRecord);

  return res.status(201).json({
    message: "Record successfully ingested via Query String",
    ingestedFormat: "Query String",
    record: newRecord
  });
});

/**
 * 2. Search & Paginated Fetch Endpoint
 * GET /api/records
 * Query params:
 * - search: string (min 3 chars required to filter)
 * - matchType: "contains" | "equals" (default: "contains")
 * - sortBy: "stringValue" | "submittedOn" | "modifiedOn" | "category" (default: "submittedOn")
 * - sortOrder: "asc" | "desc" (default: "desc")
 * - page: number (default: 1)
 * - pageSize: number (default: 5)
 */
app.get('/api/records', (req, res) => {
  const { search = '', matchType = 'contains', sortBy = 'submittedOn', sortOrder = 'desc' } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.max(1, Math.min(50, parseInt(req.query.pageSize, 10) || 5));

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

  // Sorting
  filtered.sort((a, b) => {
    let valA = a[sortBy] || '';
    let valB = b[sortBy] || '';

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
    matchType
  });
});

/**
 * Reset dataset endpoint
 * POST /api/records/reset
 */
app.post('/api/records/reset', (req, res) => {
  recordsStore = [...initialSeedRecords];
  nextId = recordsStore.length + 1;
  res.json({ message: "Dataset reset to seed records successfully.", count: recordsStore.length });
});

// Fallback to serving SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Keypath API & SPA solution server running on http://localhost:${PORT}`);
});
