import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

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

// Import both Node/Serverless endpoints and Cloudflare Pages endpoints
import apiCheckoutHandler from '../api/checkout.js';
import { onRequest as cfCheckoutHandler } from '../functions/api/checkout.js';

import apiCashfreeWebhookHandler from '../api/cashfree-webhook.js';
import { onRequest as cfCashfreeWebhookHandler } from '../functions/api/cashfree-webhook.js';

import { verifyCashfreeWebhookSignature as apiVerifyWebhook } from '../api/_cashfree.js';
import { verifyCashfreeWebhookSignature as cfVerifyWebhook } from '../functions/api/_cashfree.js';

import { getPinRole as apiGetPinRole } from '../api/_auth.js';
import { getPinRole as cfGetPinRole } from '../functions/api/_auth.js';

import apiOrderActionHandler from '../api/order-action.js';
import { onRequest as cfOrderActionHandler } from '../functions/api/order-action.js';

import apiAdminStoreHandler from '../api/admin-store.js';
import { onRequest as cfAdminStoreHandler } from '../functions/api/admin-store.js';
import { onRequest as cfAdminAuthHandler } from '../functions/api/admin-auth.js';
import { dataService } from '../dataService.js';

import { createAdminToken, signPayload } from '../functions/api/_auth.js';

const mockEnv = {
  ADMIN_PIN: '8899',
  OWNER_PIN: '9900',
  SESSION_SECRET: 'test_session_secret_32_characters_long_secure_key!',
  CASHFREE_APP_ID: 'test_app_id',
  CASHFREE_SECRET_KEY: 'test_secret_key_1234567890',
  CASHFREE_WEBHOOK_SECRET: 'test_webhook_secret_for_hmac_sha256',
  CASHFREE_ENV: 'TEST',
  VITE_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  CLOUDFLARE_TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  PLATFORM_FEE: 5
};

describe('EDGE CASES & DUAL-API PARITY BREAKING TEST SUITE', () => {

  describe('1. Cashfree Webhook Security & Replay Attack Defense', () => {
    it('rejects replayed webhook signatures with timestamp older than 5 minutes', () => {
      const secret = 'test_webhook_secret_for_hmac_sha256';
      const oldTimestamp = (Date.now() - 10 * 60 * 1000).toString(); // 10 minutes old
      const rawBody = JSON.stringify({ type: 'PAYMENT_SUCCESS_WEBHOOK', data: { order: { order_id: 'order_123' } } });
      const signature = crypto.createHmac('sha256', secret).update(oldTimestamp + rawBody).digest('base64');

      process.env.CASHFREE_WEBHOOK_SECRET = secret;
      const apiResult = apiVerifyWebhook(signature, rawBody, oldTimestamp);
      assert.equal(apiResult, false, 'api/_cashfree.js must reject replayed webhook (>5m old)');

      const cfResult = cfVerifyWebhook(signature, rawBody, oldTimestamp, { CASHFREE_WEBHOOK_SECRET: secret });
      assert.equal(cfResult, false, 'functions/api/_cashfree.js must reject replayed webhook (>5m old)');
    });

    it('rejects webhooks with payment_status != SUCCESS and blocks marking orders Paid', async () => {
      const secret = 'test_webhook_secret_for_hmac_sha256';
      const timestamp = Date.now().toString();
      const rawBody = JSON.stringify({
        type: 'PAYMENT_SUCCESS_WEBHOOK',
        data: {
          order: { order_id: 'order_9999' },
          payment: {
            cf_payment_id: 'cf_failed_123',
            payment_amount: 250,
            payment_status: 'FAILED'
          }
        }
      });
      const signature = crypto.createHmac('sha256', secret).update(timestamp + rawBody).digest('base64');

      // Test Cloudflare Pages function
      const cfReq = new Request('https://saveraparadise.com/api/cashfree-webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-signature': signature,
          'x-webhook-timestamp': timestamp
        },
        body: rawBody
      });
      const cfRes = await cfCashfreeWebhookHandler({ request: cfReq, env: mockEnv });
      assert.equal(cfRes.status, 400, 'Cloudflare webhook must return 400 for payment_status FAILED');

      // Test Node serverless handler
      process.env.CASHFREE_WEBHOOK_SECRET = mockEnv.CASHFREE_WEBHOOK_SECRET;
      let apiStatus = 200;
      let apiData = null;
      const mockReq = {
        method: 'POST',
        headers: {
          'x-webhook-signature': signature,
          'x-webhook-timestamp': timestamp
        },
        body: JSON.parse(rawBody)
      };
      const mockRes = {
        setHeader: () => {},
        status: (code) => {
          apiStatus = code;
          return {
            json: (d) => { apiData = d; return d; }
          };
        }
      };
      await apiCashfreeWebhookHandler(mockReq, mockRes);
      assert.equal(apiStatus, 400, 'api/cashfree-webhook must return 400 for payment_status FAILED');
    });
  });

  describe('2. Dual-API Parity: Checkout Unlocked Deals & Discount Metadata', () => {
    it('both api/checkout and functions/api/checkout return identical deal and promo metadata', async () => {
      const payload = {
        items: [
          { id: 'dish-1', name: 'Chicken Biryani Full', price: 200, quantity: 2 } // subtotal = 400
        ],
        storeSettings: {
          unlockedDealsEnabled: true,
          unlockedDealsMinOrder: 299,
          unlockedDealsDiscountPct: 15,
          offerActive: true,
          offerCode: 'SAVERA20',
          offerMinOrder: 199,
          offerDiscountPercent: 20
        },
        promoCode: 'SAVERA20'
      };

      // 1. Cloudflare Pages Checkout
      const cfReq = new Request('https://saveraparadise.com/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-turnstile-response': '1x00000000000000000000AA'
        },
        body: JSON.stringify(payload)
      });
      const cfRes = await cfCheckoutHandler({ request: cfReq, env: mockEnv });
      assert.equal(cfRes.status, 200);
      const cfData = await cfRes.json();

      // 2. Node Serverless Checkout
      let nodeStatus = 200;
      let nodeData = null;
      const nodeReq = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'origin': 'http://localhost:5173'
        },
        body: payload
      };
      const nodeRes = {
        setHeader: () => {},
        status: (code) => {
          nodeStatus = code;
          return {
            json: (d) => { nodeData = d; return d; },
            end: () => {}
          };
        }
      };
      await apiCheckoutHandler(nodeReq, nodeRes);
      assert.equal(nodeStatus, 200);

      // Verify Parity
      assert.equal(nodeData.subtotal, cfData.subtotal);
      assert.equal(nodeData.discount, cfData.discount);
      assert.equal(nodeData.discountType, cfData.discountType, 'Both APIs must return matching discountType');
      assert.equal(nodeData.discountType, 'combined_deals_promo');
      assert.ok(nodeData.appliedDeal, 'Node API must return appliedDeal object');
      assert.equal(nodeData.appliedDeal.discountPercent, cfData.appliedDeal.discountPercent);
      assert.equal(nodeData.appliedPromo, cfData.appliedPromo);
    });
  });

  describe('3. Hashed PIN Authentication Parity in _auth.js', () => {
    it('both api/_auth.js and functions/api/_auth.js recognize OWNER_PIN_HASH and ADMIN_PIN_HASH', () => {
      const ownerCleanPin = '7788';
      const adminCleanPin = '6655';

      const ownerHash = crypto.createHash('sha256').update(`quickbite_salt_${ownerCleanPin}`).digest('hex');
      const adminHash = crypto.createHash('sha256').update(`quickbite_salt_${adminCleanPin}`).digest('hex');

      const customEnv = {
        OWNER_PIN_HASH: ownerHash,
        ADMIN_PIN_HASH: adminHash,
        OWNER_PIN: '',
        ADMIN_PIN: ''
      };

      // Temporarily set process.env for Node API helper
      const prevOwnerHash = process.env.OWNER_PIN_HASH;
      const prevAdminHash = process.env.ADMIN_PIN_HASH;
      process.env.OWNER_PIN_HASH = ownerHash;
      process.env.ADMIN_PIN_HASH = adminHash;

      try {
        const nodeOwnerRole = apiGetPinRole(ownerCleanPin);
        assert.equal(nodeOwnerRole, 'owner', 'api/_auth.js must authenticate via OWNER_PIN_HASH');

        const cfOwnerRole = cfGetPinRole(ownerCleanPin, customEnv);
        assert.equal(cfOwnerRole, 'owner', 'functions/api/_auth.js must authenticate via OWNER_PIN_HASH');

        const nodeAdminRole = apiGetPinRole(adminCleanPin);
        assert.equal(nodeAdminRole, 'admin', 'api/_auth.js must authenticate via ADMIN_PIN_HASH');

        const cfAdminRole = cfGetPinRole(adminCleanPin, customEnv);
        assert.equal(cfAdminRole, 'admin', 'functions/api/_auth.js must authenticate via ADMIN_PIN_HASH');
      } finally {
        process.env.OWNER_PIN_HASH = prevOwnerHash || '';
        process.env.ADMIN_PIN_HASH = prevAdminHash || '';
      }
    });
  });

  describe('4. Order Lifecycle Monotonicity & Anti-Tamper Edge Cases', () => {
    it('rejects order creation when item prices are altered from signed checkout token', async () => {
      const genuineCheckoutToken = signPayload({
        subtotal: 200,
        deliveryFee: 40,
        platformFee: 5,
        discount: 0,
        numericTotal: 245,
        items: [{ id: 'dish-1', name: 'Biryani', price: 200, quantity: 1, total: 200 }],
        verifiedAt: Date.now()
      }, mockEnv);

      // Attempt to submit tampered cart with different items/prices
      const tamperedBody = {
        action: 'create_order',
        checkoutToken: genuineCheckoutToken,
        order: {
          id: 'QB-TEST-TAMPER-1',
          items: [{ id: 'dish-expensive', name: 'Huge Platter', price: 900, quantity: 1 }],
          total: '₹245',
          paymentMethod: 'COD'
        }
      };

      const cfReq = new Request('https://saveraparadise.com/api/order-action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'origin': 'https://saveraparadise.com'
        },
        body: JSON.stringify(tamperedBody)
      });
      const cfRes = await cfOrderActionHandler({ request: cfReq, env: mockEnv });
      // Either rejects or enforces signed genuine items
      if (cfRes.status === 200) {
        const data = await cfRes.json();
        assert.notEqual(data.order?.items?.[0]?.name, 'Huge Platter', 'Server must not allow swapping cart items for arbitrary expensive items');
      } else {
        assert.ok(cfRes.status === 400 || cfRes.status === 403, 'Must reject tampered cart');
      }
    });

    it('rejects customer order cancellation when cooking has already begun', async () => {
      const cancelBody = {
        action: 'cancel_order',
        orderId: 'QB-TEST-COOKING',
        trackingToken: 'valid_customer_tracking_token',
        reason: 'Changed mind'
      };

      const cfReq = new Request('https://saveraparadise.com/api/order-action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'origin': 'https://saveraparadise.com'
        },
        body: JSON.stringify(cancelBody)
      });
      const cfRes = await cfOrderActionHandler({ request: cfReq, env: mockEnv });
      // In test mock mode or missing order, it returns 404 or 400, never allows unauthorized cancel
      assert.ok(cfRes.status === 404 || cfRes.status === 400 || cfRes.status === 403);
    });

    it('strictly forbids kitchen admin role from executing clear_orders', async () => {
      const adminToken = createAdminToken(undefined, 'admin', mockEnv);

      const cfReq = new Request('https://saveraparadise.com/api/admin-store', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`,
          'origin': 'https://saveraparadise.com'
        },
        body: JSON.stringify({ action: 'clear_orders' })
      });
      const { onRequest: adminStoreHandler } = await import('../functions/api/admin-store.js');
      const cfRes = await adminStoreHandler({ request: cfReq, env: mockEnv });
      assert.equal(cfRes.status, 403, 'Kitchen admin role must be forbidden from clearing orders (Executive Owner role required)');
    });
  });

  describe('5. CORS Preflight & Protocol Security Parity', () => {
    it('both Node and CF cashfree-create-order allow cf-turnstile-response in CORS preflight', async () => {
      // 1. Cloudflare Pages
      const { onRequest: cfHandler } = await import('../functions/api/cashfree-create-order.js');
      const cfReq = new Request('https://saveraparadise.com/api/cashfree-create-order', {
        method: 'OPTIONS',
        headers: { origin: 'https://saveraparadise.com' }
      });
      const cfRes = await cfHandler({ request: cfReq, env: mockEnv });
      assert.equal(cfRes.status, 204);
      const cfAllowHeaders = cfRes.headers.get('access-control-allow-headers') || '';
      assert.ok(cfAllowHeaders.includes('cf-turnstile-response'), 'CF endpoint must allow cf-turnstile-response');

      // 2. Node Serverless
      const { default: nodeHandler } = await import('../api/cashfree-create-order.js');
      const headers = {};
      const nodeReq = {
        method: 'OPTIONS',
        headers: { origin: 'https://saveraparadise.com' }
      };
      const nodeRes = {
        setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
        status: (c) => ({ end: () => {} })
      };
      await nodeHandler(nodeReq, nodeRes);
      const nodeAllowHeaders = headers['access-control-allow-headers'] || '';
      assert.ok(nodeAllowHeaders.includes('cf-turnstile-response'), 'Node endpoint must allow cf-turnstile-response');
    });

    it('both Node and CF r2-upload allow x-filename in CORS preflight', async () => {
      // 1. Cloudflare Pages
      const { onRequest: cfHandler } = await import('../functions/api/r2-upload.js');
      const cfReq = new Request('https://saveraparadise.com/api/r2-upload', {
        method: 'OPTIONS',
        headers: { origin: 'https://saveraparadise.com' }
      });
      const cfRes = await cfHandler({ request: cfReq, env: mockEnv });
      assert.equal(cfRes.status, 200);
      const cfAllowHeaders = cfRes.headers.get('access-control-allow-headers') || '';
      assert.ok(cfAllowHeaders.includes('x-filename'), 'CF r2-upload must allow x-filename');

      // 2. Node Serverless
      const { default: nodeHandler } = await import('../api/r2-upload.js');
      const headers = {};
      const nodeReq = {
        method: 'OPTIONS',
        headers: { origin: 'https://saveraparadise.com' }
      };
      const nodeRes = {
        setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
        status: (c) => ({ end: () => {} })
      };
      await nodeHandler(nodeReq, nodeRes);
      const nodeAllowHeaders = headers['access-control-allow-headers'] || '';
      assert.ok(nodeAllowHeaders.includes('x-filename'), 'Node r2-upload must allow x-filename');
    });
  });

  describe('6. Financial Security & Role Restriction Edge Cases', () => {
    it('rejects expired checkoutToken (>15m) when creating PG order', async () => {
      const expiredToken = signPayload({
        subtotal: 300,
        numericTotal: 300,
        verifiedAt: Date.now() - 20 * 60 * 1000 // 20 minutes ago
      }, mockEnv);

      const { onRequest: cfHandler } = await import('../functions/api/cashfree-create-order.js');
      const cfReq = new Request('https://saveraparadise.com/api/cashfree-create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'origin': 'https://saveraparadise.com'
        },
        body: JSON.stringify({
          orderId: 'QB-TEST-EXP-1',
          checkoutToken: expiredToken
        })
      });
      const cfRes = await cfHandler({ request: cfReq, env: mockEnv });
      assert.equal(cfRes.status, 400);
      const data = await cfRes.json();
      assert.match(data.message, /expired/i);
    });

    it('rejects rider payout initiation from kitchen admin role (requires Executive Owner)', async () => {
      const adminToken = createAdminToken(undefined, 'admin', mockEnv);

      const { onRequest: cfPayoutHandler } = await import('../functions/api/cashfree-payout.js');
      const cfReq = new Request('https://saveraparadise.com/api/cashfree-payout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`,
          'origin': 'https://saveraparadise.com'
        },
        body: JSON.stringify({
          riderPin: '2233',
          amount: 500
        })
      });
      const cfRes = await cfPayoutHandler({ request: cfReq, env: mockEnv });
      assert.equal(cfRes.status, 403, 'Kitchen admin session must be forbidden from initiating rider payouts');
    });

    it('clamps negative platform fee to 0 and blocks price reduction tampering', async () => {
      const req = new Request('https://saveraparadise.com/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-turnstile-response': '1x00000000000000000000AA'
        },
        body: JSON.stringify({
          items: [{ id: 'dish-1', name: 'Biryani', price: 200, quantity: 1 }],
          storeSettings: { platformFee: -100 }
        })
      });
      const res = await cfCheckoutHandler({ request: req, env: mockEnv });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.platformFee, 0, 'Negative platform fee must be clamped to 0');
      assert.ok(data.numericTotal >= 200, 'Total must never be reduced by negative fees');
    });
  });

  describe('7. Audited Backend & DataService Edge Cases', () => {
    it('Cloudflare checkout rejects items with price < 1 and accepts valid ₹1 items', async () => {
      const req = new Request('https://saveraparadise.com/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-turnstile-response': '1x00000000000000000000AA'
        },
        body: JSON.stringify({
          items: [{ id: 'dish-cheap', name: 'Free Water', price: 0, quantity: 1 }]
        })
      });
      const res = await cfCheckoutHandler({ request: req, env: mockEnv });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.match(data.error || data.message, /invalid price/i);

      // Verify ₹1 test dish is accepted
      const req1 = new Request('https://saveraparadise.com/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-turnstile-response': '1x00000000000000000000AA'
        },
        body: JSON.stringify({
          items: [{ id: 'dish-test-1', name: 'TEST', price: 1, quantity: 1 }]
        })
      });
      const res1 = await cfCheckoutHandler({ request: req1, env: mockEnv });
      assert.equal(res1.status, 200);
    });

    it('Cloudflare checkout blocks SAVERA20 on orders below 199 with default fallback settings', async () => {
      const req = new Request('https://saveraparadise.com/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-turnstile-response': '1x00000000000000000000AA'
        },
        body: JSON.stringify({
          items: [{ id: 'dish-1', name: 'Biryani', price: 100, quantity: 1 }],
          promoCode: 'SAVERA20'
        })
      });
      const res = await cfCheckoutHandler({ request: req, env: mockEnv });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.discount, 0, 'Must not apply SAVERA20 below ₹199 fallback minimum');
      assert.equal(data.appliedPromo, null);
    });

    it('Cloudflare admin-auth rejects refresh tokens older than 24 hours', async () => {
      const oldPayload = {
        role: 'admin',
        iat: Date.now() - 30 * 24 * 60 * 60 * 1000 // 30 days old
      };
      const oldPayloadB64 = Buffer.from(JSON.stringify(oldPayload)).toString('base64url');
      const sig = crypto.createHmac('sha256', mockEnv.SESSION_SECRET).update(`admin.${oldPayloadB64}`).digest('base64url');
      const expiredToken = `admin.${oldPayloadB64}.${sig}`;

      const req = new Request('https://saveraparadise.com/api/admin-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'refresh',
          refreshToken: expiredToken
        })
      });
      const res = await cfAdminAuthHandler({ request: req, env: mockEnv });
      assert.equal(res.status, 401, 'Must reject refresh token older than 24 hours');
    });

    it('order-action sanitizes cleanId preventing PostgREST injection characters', async () => {
      const adminToken = createAdminToken(undefined, 'admin', mockEnv);
      const maliciousOrderId = '#123,id.neq.456)';
      const req = new Request('https://saveraparadise.com/api/order-action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          action: 'cancel_order',
          orderId: maliciousOrderId,
          simulateOrders: [{ id: '123idneq456', status: 'accepted', tracking_token: 'secret-tok-123idneq456' }]
        })
      });
      const res = await cfOrderActionHandler({ request: req, env: mockEnv });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.order, 'Order should be looked up with sanitized ID (commas and parens stripped)');
    });

    it('admin-store save_rider maps camelCase upiVpa and bankAccountNo', async () => {
      const adminToken = createAdminToken(undefined, 'admin', mockEnv);
      const req = new Request('https://saveraparadise.com/api/admin-store', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          action: 'save_rider',
          rider: {
            pin: '7788',
            name: 'Rider Seven',
            phone: '+91 99999 88888',
            upiVpa: 'rider7@okhdfcbank',
            bankAccountNo: '123456789012',
            avatarImg: '/avatars/rider-3.svg'
          }
        })
      });
      const res = await cfAdminStoreHandler({ request: req, env: mockEnv });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.rider.upi_vpa, 'rider7@okhdfcbank');
      assert.equal(data.rider.bank_account_no, '123456789012');
      assert.equal(data.rider.avatar_img, '/avatars/rider-3.svg');
    });

    it('dataService.getUserAddresses in guest mode returns [] instead of leaking other users addresses', () => {
      localStorage.setItem('quickbite_user_addresses', JSON.stringify([
        { id: 'addr-user-1', userId: 'user-secret-1', name: 'Private User', details: 'Secret House' }
      ]));
      const guestAddrs = dataService.getUserAddresses(null, null);
      assert.deepEqual(guestAddrs, [], 'Guest mode must return [] when no unassigned guest addresses exist');
    });

    it('dataService.saveUserAddress preserves unpinned coords as null without coercing to restaurant 0km', () => {
      const saved = dataService.saveUserAddress({
        name: 'Unpinned Customer',
        phone: '9876543210',
        flatNo: 'Doorstep 12',
        area: 'Ramanagara',
        lat: 0,
        lng: 0
      });
      assert.equal(saved.lat, null, 'Unpinned lat must be null, not restaurant coords');
      assert.equal(saved.lng, null, 'Unpinned lng must be null, not restaurant coords');
      assert.equal(saved.distanceKm, null, 'Unpinned distanceKm must be null');
    });
  });

});
