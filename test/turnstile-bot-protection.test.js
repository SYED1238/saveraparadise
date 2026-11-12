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

  await t.test('8. Cloudflare _headers Content-Security-Policy whitelists Cloudflare Turnstile', () => {
    const headersContent = fs.readFileSync(path.resolve('public/_headers'), 'utf8');

    assert.ok(headersContent.includes('script-src'), 'CSP defines script-src');
    assert.ok(headersContent.includes('https://challenges.cloudflare.com'), 'CSP whitelists https://challenges.cloudflare.com');
    assert.ok(headersContent.includes('frame-src'), 'CSP defines frame-src');
    assert.ok(headersContent.includes('connect-src'), 'CSP defines connect-src');
  });

  await t.test('9. index.html includes Cloudflare Turnstile script and widget container', () => {
    const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf8');
    assert.ok(indexHtml.includes('https://challenges.cloudflare.com/turnstile/v0/api.js'), 'Includes Cloudflare Turnstile script tag');
    assert.ok(indexHtml.includes('id="turnstile-checkout-widget"'), 'Includes turnstile widget container element');
  });

  await t.test('10. Velocity-Based Verification: Fast lane permits 1st order in <60s without token and hides widget by default', async () => {
    const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf8');
    const mainJs = fs.readFileSync(path.resolve('main.js'), 'utf8');
    assert.match(indexHtml, /id="turnstile-checkout-widget"[^>]*display:\s*none/, 'Turnstile widget container is hidden by default');
    assert.match(mainJs, /function isTurnstileChallengeRequired/, 'main.js gates Turnstile widget behind isTurnstileChallengeRequired');

    const testIp = '198.51.100.42';
    const testPhone = '9876543299';

    // Order 1 (Fast Lane - no Turnstile token required)
    const { req: req1, res: res1 } = createMockReqRes({
      headers: { 'x-forwarded-for': testIp },
      body: {
        items: [{ id: 'dish-chicken-biryani-half', name: 'Chicken Biryani (Half)', quantity: 1, price: 130 }],
        customerPhone: testPhone
      }
    });
    await checkoutHandler(req1, res1);
    assert.equal(res1.statusCode, 200, 'Order 1 passes fast lane with 200 OK without token');
  });

  await t.test('11. Velocity-Based Verification: 2nd or more orders in <60s triggers Turnstile challenge', async () => {
    const testIp = '198.51.100.42';
    const testPhone = '9876543299';

    // Order 2 without token -> Blocked by Velocity Engine (2+ orders in 1 min)
    const { req: req2, res: res2 } = createMockReqRes({
      headers: { 'x-forwarded-for': testIp },
      body: {
        items: [{ id: 'dish-chicken-biryani-half', name: 'Chicken Biryani (Half)', quantity: 1, price: 130 }],
        customerPhone: testPhone
      }
    });
    await checkoutHandler(req2, res2);
    assert.equal(res2.statusCode, 403, 'Order 2 in <60s without token is rejected with 403 Forbidden');
    assert.equal(res2.bodyData?.challengeRequired, true, 'Flags challengeRequired: true when 2+ orders placed in <60s');

    // Order 2 with valid token -> Human verified, passes successfully!
    const { req: req2Verified, res: res2Verified } = createMockReqRes({
      headers: { 'x-forwarded-for': testIp },
      body: {
        items: [{ id: 'dish-chicken-biryani-half', name: 'Chicken Biryani (Half)', quantity: 1, price: 130 }],
        customerPhone: testPhone,
        turnstileToken: 'valid-test-client-token'
      }
    });
    await checkoutHandler(req2Verified, res2Verified);
    assert.equal(res2Verified.statusCode, 200, 'Order 2 with valid Turnstile token passes with 200 OK');
  });

});
