import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { 
  verifyTurnstileToken, 
  getTurnstileSecretKey, 
  getClientIp,
  CLOUDFLARE_TEST_SECRET_KEY_PASS, 
  CLOUDFLARE_TEST_SECRET_KEY_BLOCK 
} from '../api/_turnstile.js';
import checkoutHandler from '../api/checkout.js';
import cashfreeCreateOrderHandler from '../api/cashfree-create-order.js';

function createMockReqRes(options = {}) {
  const req = {
    method: options.method || 'POST',
    headers: options.headers || {},
    body: options.body || {},
    socket: { remoteAddress: '127.0.0.1' },
    ...options
  };

  const res = {
    statusCode: 200,
    headers: {},
    bodyData: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(key, val) {
      this.headers[key.toLowerCase()] = val;
      return this;
    },
    json(data) {
      this.bodyData = data;
      return this;
    },
    end(data) {
      this.bodyData = data;
      return this;
    }
  };

  return { req, res };
}

test('CLOUDFLARE TURNSTILE INVISIBLE BOT PROTECTION SUITE', async (t) => {

  await t.test('1. Module helper exports and client IP resolution', () => {
    const { req } = createMockReqRes({
      headers: { 'x-forwarded-for': '203.0.113.195, 70.41.3.18' }
    });
    assert.equal(getClientIp(req), '203.0.113.195', 'Accurately parses primary client IP from x-forwarded-for');

    const defaultSecret = getTurnstileSecretKey();
    assert.ok(typeof defaultSecret === 'string', 'Returns non-null secret string');
  });

  await t.test('2. verifyTurnstileToken passes valid test tokens in dev/sandbox mode', async () => {
    const result = await verifyTurnstileToken('valid-test-turnstile-token', '127.0.0.1');
    assert.equal(result.success, true, 'Test token successfully verified');
  });

  await t.test('3. verifyTurnstileToken rejects missing token when secret is active', async () => {
    const result = await verifyTurnstileToken('', '127.0.0.1', '0x4AAAAAA_configured_secret');
    assert.equal(result.success, false, 'Empty token rejected');
    assert.ok(result.errorCodes?.includes('missing-input-response'));
  });

  await t.test('4. verifyTurnstileToken rejects known blocked test tokens', async () => {
    const result = await verifyTurnstileToken('BLOCK_TOKEN', '127.0.0.1');
    assert.equal(result.success, false, 'BLOCK_TOKEN rejected');
    assert.ok(result.errorCodes?.includes('invalid-input-response'));
  });

  await t.test('5. POST /api/checkout accepts valid Turnstile token and returns 200 with signature', async () => {
    const { req, res } = createMockReqRes({
      method: 'POST',
      body: {
        items: [{ id: 'dish-chicken-biryani-half', name: 'Chicken Biryani (Half)', quantity: 1, price: 130 }],
        turnstileToken: 'valid-test-client-token'
      }
    });

    await checkoutHandler(req, res);
    assert.equal(res.statusCode, 200, 'Returns HTTP 200 OK');
    assert.ok(res.bodyData?.checkoutToken || res.bodyData?.signature, 'Returns signed checkout token');
  });

  await t.test('6. POST /api/checkout rejects bot requests with invalid/blocked Turnstile token with 403', async () => {
    const { req, res } = createMockReqRes({
      method: 'POST',
      body: {
        items: [{ id: 'dish-chicken-biryani-half', name: 'Chicken Biryani (Half)', quantity: 1, price: 130 }],
        turnstileToken: 'BLOCK_TOKEN'
      }
    });

    await checkoutHandler(req, res);
    assert.equal(res.statusCode, 403, 'Returns HTTP 403 Forbidden for bot requests');
    assert.equal(res.bodyData?.botBlocked, true, 'Explicitly flags botBlocked in response');
  });

  await t.test('7. POST /api/cashfree-create-order rejects bot requests lacking checkoutToken with 403', async () => {
    const { req, res } = createMockReqRes({
      method: 'POST',
      body: {
        orderId: 'QB-TEST-1234',
        amount: 150,
        customerPhone: '9876543210',
        turnstileToken: 'BLOCK_TOKEN'
      }
    });

    await cashfreeCreateOrderHandler(req, res);
    assert.equal(res.statusCode, 403, 'Rejects direct unverified order creation with 403 Forbidden');
  });

  await t.test('8. vercel.json Content-Security-Policy whitelists Cloudflare Turnstile', () => {
    const vercelConfig = JSON.parse(fs.readFileSync(path.resolve('vercel.json'), 'utf8'));
    const allHeaders = vercelConfig.headers.flatMap(h => h.headers || []);
    const csp = allHeaders.find(h => h.key === 'Content-Security-Policy')?.value || '';

    assert.ok(csp.includes('script-src'), 'CSP defines script-src');
    assert.ok(csp.includes('https://challenges.cloudflare.com'), 'CSP whitelists https://challenges.cloudflare.com');
    assert.ok(csp.includes('frame-src'), 'CSP defines frame-src');
    assert.ok(csp.includes('connect-src'), 'CSP defines connect-src');
  });

  await t.test('9. index.html includes Cloudflare Turnstile script and widget container', () => {
    const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf8');
    assert.ok(indexHtml.includes('https://challenges.cloudflare.com/turnstile/v0/api.js'), 'Includes Cloudflare Turnstile script tag');
    assert.ok(indexHtml.includes('id="turnstile-checkout-widget"'), 'Includes turnstile widget container element');
  });

});
