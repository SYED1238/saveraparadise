import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminToken, verifyAdminToken, verifyAdminPin } from '../api/_auth.js';
import adminAuthHandler from '../api/admin-auth.js';
import r2UploadHandler from '../api/r2-upload.js';
import r2DeleteHandler from '../api/r2-delete.js';
import r2ListHandler from '../api/r2-list.js';
import r2ImageHandler from '../api/r2-image.js';

// Helper to mock minimal Serverless req / res
function createMockReqRes({ method = 'GET', url = '/', headers = {}, body = null, query = {} } = {}) {
  let statusCode = 200;
  let responseData = null;
  const responseHeaders = {};

  const req = {
    method,
    url,
    headers: { ...headers },
    body,
    query,
    [Symbol.asyncIterator]: async function* () {
      if (body) {
        yield Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
      }
    }
  };

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    setHeader(key, val) {
      responseHeaders[key] = val;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    },
    end(str) {
      if (str) {
        try {
          responseData = JSON.parse(str);
        } catch {
          responseData = str;
        }
      }
      return this;
    },
    pipe() {
      return this;
    },
    get statusCode() {
      return statusCode;
    },
    get data() {
      return responseData;
    },
    get headers() {
      return responseHeaders;
    }
  };

  return { req, res };
}

test('STAGE 1: Server Authentication Helper (_auth.js)', async (t) => {
  await t.test('verifyAdminPin validates correct and incorrect PINs', () => {
    assert.strictEqual(verifyAdminPin('8899'), true, 'Default admin PIN must succeed');
    assert.strictEqual(verifyAdminPin('0000'), false, 'Incorrect PIN must fail');
    assert.strictEqual(verifyAdminPin(''), false, 'Empty PIN must fail');
    assert.strictEqual(verifyAdminPin('88990'), false, '5-digit PIN must fail');
    assert.strictEqual(verifyAdminPin('abcd'), false, 'Alpha PIN must fail');
  });

  await t.test('createAdminToken generates cryptographically signed token', () => {
    const token = createAdminToken();
    assert.ok(token && typeof token === 'string', 'Token must be a string');
    const parts = token.split('.');
    assert.strictEqual(parts.length, 2, 'Token must have payload and signature parts');
  });

  await t.test('verifyAdminToken validates legitimate tokens', () => {
    const token = createAdminToken();
    const mockReq = { headers: { authorization: `Bearer ${token}` } };
    const result = verifyAdminToken(mockReq);
    assert.strictEqual(result.valid, true, 'Valid token must be accepted');
    assert.strictEqual(result.payload.role, 'admin');
  });

  await t.test('verifyAdminToken rejects missing or malformed tokens', () => {
    assert.strictEqual(verifyAdminToken({ headers: {} }).valid, false);
    assert.strictEqual(verifyAdminToken({ headers: { authorization: '' } }).valid, false);
    assert.strictEqual(verifyAdminToken({ headers: { authorization: 'Bearer malformed' } }).valid, false);
  });

  await t.test('verifyAdminToken detects tampered signatures', () => {
    const token = createAdminToken();
    const [payload, sig] = token.split('.');
    const tamperedToken = `${payload}.${sig.slice(0, -2)}ff`;
    const result = verifyAdminToken({ headers: { authorization: `Bearer ${tamperedToken}` } });
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error, 'Invalid token signature');
  });

  await t.test('verifyAdminToken rejects expired tokens', () => {
    // Generate token expired 10 seconds ago
    const expiredToken = createAdminToken(-10000);
    const result = verifyAdminToken({ headers: { authorization: `Bearer ${expiredToken}` } });
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error, 'Session token has expired');
  });
});

test('STAGE 1: Serverless Admin Auth Endpoint (admin-auth.js)', async (t) => {
  await t.test('Rejects non-POST requests with 405 Method Not Allowed', async () => {
    const { req, res } = createMockReqRes({ method: 'GET' });
    await adminAuthHandler(req, res);
    assert.strictEqual(res.statusCode, 405);
  });

  await t.test('Rejects incorrect PIN with 401 Unauthorized', async () => {
    const { req, res } = createMockReqRes({ method: 'POST', body: { pin: '1234' } });
    await adminAuthHandler(req, res);
    assert.strictEqual(res.statusCode, 401);
    assert.ok(res.data.error.includes('Invalid manager passcode'));
  });

  await t.test('Issues signed bearer token on valid PIN with 200 OK', async () => {
    const { req, res } = createMockReqRes({ method: 'POST', body: { pin: '8899' } });
    await adminAuthHandler(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.data.success, true);
    assert.ok(res.data.token && typeof res.data.token === 'string');

    // Confirm issued token passes verifyAdminToken
    const verifyResult = verifyAdminToken({ headers: { authorization: `Bearer ${res.data.token}` } });
    assert.strictEqual(verifyResult.valid, true);
  });
});

test('STAGE 1: Storage Endpoint Authorization Guards', async (t) => {
  await t.test('POST /api/r2-upload rejects unauthenticated requests with 401', async () => {
    const { req, res } = createMockReqRes({ method: 'POST' });
    await r2UploadHandler(req, res);
    assert.strictEqual(res.statusCode, 401);
  });

  await t.test('POST /api/r2-upload rejects forged tokens with 401', async () => {
    const { req, res } = createMockReqRes({
      method: 'POST',
      headers: { authorization: 'Bearer fake.signature' }
    });
    await r2UploadHandler(req, res);
    assert.strictEqual(res.statusCode, 401);
  });

  await t.test('POST /api/r2-delete rejects unauthenticated requests with 401', async () => {
    const { req, res } = createMockReqRes({ method: 'POST', body: { key: 'dishes/sample.jpg' } });
    await r2DeleteHandler(req, res);
    assert.strictEqual(res.statusCode, 401);
  });

  await t.test('GET /api/r2-list rejects unauthenticated requests with 401', async () => {
    const { req, res } = createMockReqRes({ method: 'GET' });
    await r2ListHandler(req, res);
    assert.strictEqual(res.statusCode, 401);
    assert.ok(res.data.error.includes('authorization') || res.data.error.includes('Admin session required'));
  });

  await t.test('POST /api/r2-delete rejects invalid key paths (directory traversal)', async () => {
    const token = createAdminToken();
    const { req, res } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: { key: '../dishes/test.jpg' }
    });
    await r2DeleteHandler(req, res);
    assert.strictEqual(res.statusCode, 400);
  });
});

test('STAGE 1: Public Image Delivery & Path Traversal Guards (r2-image.js)', async (t) => {
  await t.test('GET /api/r2-image rejects missing key with 400', async () => {
    const { req, res } = createMockReqRes({ method: 'GET', query: {} });
    await r2ImageHandler(req, res);
    assert.strictEqual(res.statusCode, 400);
  });

  await t.test('GET /api/r2-image rejects directory traversal with 400', async () => {
    const { req, res } = createMockReqRes({ method: 'GET', query: { key: 'dishes/../../etc/passwd' } });
    await r2ImageHandler(req, res);
    assert.strictEqual(res.statusCode, 400);
  });

  await t.test('GET /api/r2-image rejects keys outside dishes/ and categories/ with 400', async () => {
    const { req, res } = createMockReqRes({ method: 'GET', query: { key: 'private_backups/dump.sql' } });
    await r2ImageHandler(req, res);
    assert.strictEqual(res.statusCode, 400);
    assert.ok(res.data.error.includes('Invalid image key'));
  });

  await t.test('GET /api/r2-image accepts valid dishes/ and categories/ key paths', async () => {
    // With missing credentials, valid keys pass path validation and reach 503 credentials check
    const { req: req1, res: res1 } = createMockReqRes({ method: 'GET', query: { key: 'dishes/sample.jpg' } });
    await r2ImageHandler(req1, res1);
    assert.notStrictEqual(res1.statusCode, 400);

    const { req: req2, res: res2 } = createMockReqRes({ method: 'GET', query: { key: 'categories/category_123.jpg' } });
    await r2ImageHandler(req2, res2);
    assert.notStrictEqual(res2.statusCode, 400);
  });
});
