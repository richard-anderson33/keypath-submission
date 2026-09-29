const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';

function makeRequest(path, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const reqOptions = {
      method: options.method || 'GET',
      headers: options.headers || {}
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

test('1. Root SPA HTML serves 200 OK', async () => {
  const res = await makeRequest('/');
  assert.strictEqual(res.statusCode, 200);
  assert.match(res.body, /Keypath/);
});

test('2. GET /api/records returns paginated records with totalCount', async () => {
  const res = await makeRequest('/api/records');
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(typeof res.body.totalCount, 'number');
  assert.strictEqual(res.body.page, 1);
  assert.ok(Array.isArray(res.body.data));
  assert.ok(res.body.data.length > 0);
});

test('3. Search enforces 3-character threshold', async () => {
  // < 3 chars should not filter
  const resShort = await makeRequest('/api/records?search=Az');
  assert.strictEqual(resShort.statusCode, 200);
  assert.strictEqual(resShort.body.searchApplied, false);

  // >= 3 chars filters results
  const resLong = await makeRequest('/api/records?search=Azure&matchType=contains');
  assert.strictEqual(resLong.statusCode, 200);
  assert.strictEqual(resLong.body.searchApplied, true);
  assert.strictEqual(resLong.body.data.length, 3);
  resLong.body.data.forEach(item => {
    assert.match(item.stringValue.toLowerCase(), /azure/);
  });
});

test('4. Column sorting works as expected', async () => {
  const resAsc = await makeRequest('/api/records?sortBy=stringValue&sortOrder=asc&pageSize=20');
  assert.strictEqual(resAsc.statusCode, 200);
  const namesAsc = resAsc.body.data.map(d => d.stringValue.toLowerCase());
  const sortedNames = [...namesAsc].sort();
  assert.deepStrictEqual(namesAsc, sortedNames);
});

test('5. Multi-format ingestion validates required stringValue', async () => {
  const res = await makeRequest('/api/records/ingest', { method: 'POST' }, {});
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.error, /Validation Error/);
});

test('6. POST /api/records/ingest ingests JSON record', async () => {
  const payload = {
    stringValue: 'Automated Test Suite Record',
    category: 'Unit Testing',
    submittedBy: 'Test Runner'
  };
  const res = await makeRequest('/api/records/ingest', { method: 'POST' }, payload);
  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.body.record.stringValue, 'Automated Test Suite Record');
  assert.strictEqual(res.body.record.category, 'Unit Testing');
});

test('7. GET /api/records/ingest ingests via query string', async () => {
  const res = await makeRequest('/api/records/ingest?stringValue=QueryStringRecord&category=QueryTest&submittedBy=QueryUser');
  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.body.record.stringValue, 'QueryStringRecord');
});

test('8. POST /api/records/reset restores initial seed records', async () => {
  const res = await makeRequest('/api/records/reset', { method: 'POST' });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.count, 12);
});
