import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

if (typeof global.localStorage === 'undefined') {
  const store = new Map();
  global.localStorage = {
    getItem: (key) => store.get(String(key)) ?? null,
    setItem: (key, val) => store.set(String(key), String(val)),
    removeItem: (key) => store.delete(String(key)),
    clear: () => store.clear(),
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; }
  };
}
if (typeof global.sessionStorage === 'undefined') {
  const store = new Map();
  global.sessionStorage = {
    getItem: (key) => store.get(String(key)) ?? null,
    setItem: (key, val) => store.set(String(key), String(val)),
    removeItem: (key) => store.delete(String(key)),
    clear: () => store.clear()
  };
}

const { dataService } = await import('../dataService.js');
const { default: nodeCheckoutHandler } = await import('../api/checkout.js');
const { onRequest: cloudflareCheckoutHandler } = await import('../functions/api/checkout.js');
const { default: nodeCashfreeOrderHandler } = await import('../api/cashfree-create-order.js');

function createMockReqRes({ method = 'POST', headers = {}, body = {} } = {}) {
  let statusCode = 200;
  let responseData = null;
  const resHeaders = {};
  const req = {
    method,
    headers: { ...headers },
    body
  };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    setHeader(key, val) {
      resHeaders[key.toLowerCase()] = val;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    },
    end(data) {
      responseData = data;
      return this;
    },
    get statusCode() { return statusCode; },
    get bodyData() { return responseData; },
    get data() { return responseData; }
  };
  return { req, res };
}

test('FEATURE #11: ORDER PLACEMENT, CLOUDFLARE TURNSTILE & CHECKOUT LIFECYCLE SUITE', async (t) => {
  const mainJs = fs.readFileSync('main.js', 'utf8');
  const apiCheckoutJs = fs.readFileSync('api/checkout.js', 'utf8');
  const functionsCheckoutJs = fs.readFileSync('functions/api/checkout.js', 'utf8');

  // =========================================================================
  // 1. Cloudflare Turnstile Bot Defense
  // =========================================================================
  await t.test('1. POST /api/checkout rejects bot requests with invalid/blocked Turnstile token with 403', async () => {
    const { req, res } = createMockReqRes({
      body: {
        items: [{ id: 'dish-1', name: 'Chicken Biryani', price: 150, quantity: 1 }],
        turnstileToken: 'BLOCK_TOKEN'
      }
    });

    await nodeCheckoutHandler(req, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.bodyData?.botBlocked, true);
  });

  await t.test('2. POST /api/checkout accepts valid Turnstile token and returns HMAC signature', async () => {
    const { req, res } = createMockReqRes({
      body: {
        items: [{ id: 'dish-1', name: 'Chicken Biryani', price: 150, quantity: 1 }],
        turnstileToken: 'valid-test-turnstile-token'
      }
    });

    await nodeCheckoutHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.ok(res.bodyData?.signature || res.bodyData?.checkoutToken);
  });

  await t.test('3. POST /api/cashfree-create-order checks Turnstile before checkoutToken', async () => {
    const { req, res } = createMockReqRes({
      body: {
        orderId: 'QB-TEST-BOT-1',
        amount: 200,
        turnstileToken: 'BLOCK_TOKEN'
      }
    });

    await nodeCashfreeOrderHandler(req, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.bodyData?.botBlocked, true);
  });

  // =========================================================================
  // 2. Anti-Tamper Pricing & Payload Verification
  // =========================================================================
  await t.test('4. POST /api/checkout validates 10-digit Indian phone number (/^[6-9]\\d{9}$/)', async () => {
    const { req: invalidReq, res: invalidRes } = createMockReqRes({
      body: {
        items: [{ id: 'dish-1', name: 'Chicken Biryani', price: 150, quantity: 1 }],
        turnstileToken: 'valid-test-turnstile-token',
        userPhone: '1234567890' // Starts with 1 (invalid)
      }
    });

    await nodeCheckoutHandler(invalidReq, invalidRes);
    assert.equal(invalidRes.statusCode, 400);
    assert.match(invalidRes.bodyData?.error, /10-digit Indian mobile number/i);

    const { req: validReq, res: validRes } = createMockReqRes({
      body: {
        items: [{ id: 'dish-1', name: 'Chicken Biryani', price: 150, quantity: 1 }],
        turnstileToken: 'valid-test-turnstile-token',
        userPhone: '9876543210' // Valid
      }
    });

    await nodeCheckoutHandler(validReq, validRes);
    assert.equal(validRes.statusCode, 200);
  });

  await t.test('5. POST /api/checkout rejects unpinned (0, 0) coordinates when provided for delivery', async () => {
    const { req, res } = createMockReqRes({
      body: {
        items: [{ id: 'dish-1', name: 'Chicken Biryani', price: 150, quantity: 1 }],
        turnstileToken: 'valid-test-turnstile-token',
        lat: 0,
        lng: 0
      }
    });

    await nodeCheckoutHandler(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.bodyData?.error, /Delivery pin coordinates are required/i);
  });

  await t.test('6. POST /api/checkout rejects out-of-zone delivery coordinates (> 7km)', async () => {
    const { req, res } = createMockReqRes({
      body: {
        items: [{ id: 'dish-1', name: 'Chicken Biryani', price: 150, quantity: 1 }],
        turnstileToken: 'valid-test-turnstile-token',
        lat: 12.9716, // Bangalore (> 40km away from Ramanagara)
        lng: 77.5946
      }
    });

    await nodeCheckoutHandler(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.bodyData?.error, /outside our delivery area/i);
  });

  await t.test('7. Cloudflare Pages Functions /api/checkout validates Turnstile, phone and geofence', async () => {
    // 7a. Bot rejection with 403
    const botReq = new Request('https://saveraparadise.com/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ id: 'dish-1', name: 'Chicken Biryani', price: 150, quantity: 1 }],
        turnstileToken: 'BLOCK_TOKEN'
      })
    });
    const botRes = await cloudflareCheckoutHandler({ request: botReq, env: {} });
    assert.equal(botRes.status, 403);

    // 7b. Invalid Indian phone number rejection with 400
    const phoneReq = new Request('https://saveraparadise.com/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ id: 'dish-1', name: 'Chicken Biryani', price: 150, quantity: 1 }],
        turnstileToken: 'valid-test-turnstile-token',
        userPhone: '3333333333'
      })
    });
    const phoneRes = await cloudflareCheckoutHandler({ request: phoneReq, env: {} });
    assert.equal(phoneRes.status, 400);

    // 7c. Unpinned (0, 0) coordinates rejection with 400
    const coordReq = new Request('https://saveraparadise.com/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ id: 'dish-1', name: 'Chicken Biryani', price: 150, quantity: 1 }],
        turnstileToken: 'valid-test-turnstile-token',
        lat: 0,
        lng: 0
      })
    });
    const coordRes = await cloudflareCheckoutHandler({ request: coordReq, env: {} });
    assert.equal(coordRes.status, 400);
  });

  // =========================================================================
  // 3. dataService.addOrder Integrity & Platform Fee Inclusion
  // =========================================================================
  await t.test('8. dataService.addOrder includes platformFee in total and stores platformFee property', async () => {
    dataService.saveDishes([{ id: 'dish-biryani', name: 'Mutton Biryani', price: 200, inStock: true }]);
    const testOrder = {
      id: 'QB-TEST-FEE-' + Date.now(),
      items: [{ id: 'dish-biryani', name: 'Mutton Biryani', price: 200, quantity: 1 }],
      customerPhone: '9876543210',
      lat: 12.721,
      lng: 77.287,
      platformFee: 5,
      deliveryFee: 40
    };

    const res = await dataService.addOrder(testOrder);
    assert.ok(res);
    assert.strictEqual(res.platformFee, 5);
    // Subtotal (200) + delivery (40) + platform (5) = 245
    assert.strictEqual(res.total, '₹245');
  });

  await t.test('9. dataService.addOrder fails closed when delivery coordinates are (0, 0) with reason unpinned', async () => {
    const unpinnedOrder = {
      id: 'QB-TEST-UNPINNED-' + Date.now(),
      items: [{ id: 'dish-biryani', name: 'Mutton Biryani', price: 200, quantity: 1 }],
      customerPhone: '9876543210',
      lat: 0,
      lng: 0
    };

    const res = await dataService.addOrder(unpinnedOrder);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.reason, 'unpinned');
  });

  // =========================================================================
  // 4. Checkout Modal Lifecycle & State Transitions
  // =========================================================================
  await t.test('10. resetSubmitState resets turnstileWidgetId and clears activeTurnstileToken', () => {
    assert.match(mainJs, /activeTurnstileToken\s*=\s*'';/, 'resetSubmitState must clear activeTurnstileToken');
    assert.match(mainJs, /window\.turnstile\.reset\(turnstileWidgetId\)/, 'resetSubmitState must reset turnstile widget');
  });

  await t.test('11. getTurnstileToken restricts synthetic dev tokens strictly to localhost', () => {
    assert.match(mainJs, /window\.location\.hostname\s*===\s*'localhost'/, 'getTurnstileToken must gate dev token on localhost');
    assert.match(mainJs, /if\s*\(!turnstileToken\)\s*\{[^}]*showToast\('🔒 Please complete the security/s, 'Submission must block if turnstileToken is empty in production');
  });

  await t.test('12. closeCheckoutModal is strictly guarded against closing while isSubmittingOrder is true', () => {
    assert.match(mainJs, /function closeCheckoutModal\(\)\s*\{[^}]*if\s*\(isSubmittingOrder\)\s*return;/s, 'closeCheckoutModal must check isSubmittingOrder');
  });

  await t.test('13. openOrderModal supports skipPushStep to avoid orphaned history states on replacement', () => {
    assert.match(mainJs, /function openOrderModal\([^)]*skipPushStep/, 'openOrderModal signature must accept skipPushStep');
    assert.match(mainJs, /if\s*\(!skipPushStep\)\s*\{[^}]*backNav\.pushStep\('order-modal'/s, 'openOrderModal must honor skipPushStep');
    assert.match(mainJs, /backNav\.replaceTopStep\('order-modal'/s, 'main.js must replaceTopStep from checkout to order-modal');
  });
});
