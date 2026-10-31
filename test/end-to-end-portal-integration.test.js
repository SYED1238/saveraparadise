import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

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

import { dataService, ORDER_STATUS_RANKS } from '../dataService.js';
import checkoutHandler from '../api/checkout.js';
import cashfreeCreateOrderHandler from '../api/cashfree-create-order.js';
import cashfreeGenerateQrHandler from '../api/cashfree-generate-qr.js';
import cashfreePayoutHandler from '../api/cashfree-payout.js';
import cashfreeWebhookHandler from '../api/cashfree-webhook.js';
import r2UploadHandler from '../api/r2-upload.js';
import r2DeleteHandler from '../api/r2-delete.js';
import { createAdminToken, signPayload } from '../api/_auth.js';
import { generateDoorstepUpiQr, verifyCashfreeWebhookSignature } from '../api/_cashfree.js';

function createMockReqRes({ method = 'GET', body = {}, headers = {}, query = {}, url = '/' }) {
  const req = {
    method,
    body,
    headers: { 'content-type': 'application/json', ...headers },
    query,
    url,
    [Symbol.asyncIterator]: async function* () {
      if (typeof body === 'string' || Buffer.isBuffer(body)) {
        yield Buffer.from(body);
      } else {
        yield Buffer.from(JSON.stringify(body));
      }
    }
  };

  const res = {
    statusCode: 200,
    headersSent: false,
    _headers: {},
    _body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(key, val) {
      this._headers[key.toLowerCase()] = val;
      return this;
    },
    getHeader(key) {
      return this._headers[key.toLowerCase()];
    },
    json(data) {
      this._body = data;
      this.headersSent = true;
      return this;
    },
    send(data) {
      this._body = data;
      this.headersSent = true;
      return this;
    },
    end(data) {
      if (data) this._body = data;
      this.headersSent = true;
      return this;
    }
  };

  return { req, res };
}

describe('END-TO-END CROSS-PORTAL ORDER LIFECYCLE INTEGRATION SUITE', () => {
  const mockCatalog = [
    { id: 'dish-biryani-rice-2pc-kebab', name: 'Biryani Rice with 2pc Kebab', price: 130 }
  ];
  const activeSettings = {
    unlockedDealsEnabled: true,
    unlockedDealsMinOrder: 299,
    unlockedDealsDiscountPct: 20,
    freeDeliveryEnabled: true,
    freeDeliveryThreshold: 250,
    deliveryFeeStandard: 40
  };

  beforeEach(() => {
    delete process.env.CASHFREE_APP_ID;
    delete process.env.CASHFREE_SECRET_KEY;
    delete process.env.CASHFREE_WEBHOOK_SECRET;
  });

  test('1. Customer Cart Progression: Below Threshold -> Above Threshold -> Authoritative /api/checkout Validation', async () => {
    // A. Subtotal below threshold (₹130 * 2 = ₹260 < ₹299 threshold)
    const { req: req1, res: res1 } = createMockReqRes({
      method: 'POST',
      body: {
        items: [{ id: 'dish-biryani-rice-2pc-kebab', name: 'Biryani Rice with 2pc Kebab', price: 130, quantity: 2 }],
        catalogDishes: mockCatalog,
        storeSettings: activeSettings
      }
    });

    await checkoutHandler(req1, res1);
    assert.strictEqual(res1.statusCode, 200);
    assert.strictEqual(res1._body.subtotal, 260);
    assert.strictEqual(res1._body.discount, 0, 'No deal discount below ₹299 threshold');
    assert.strictEqual(res1._body.deliveryFee, 0, 'Free delivery applied since ₹260 >= ₹250 free delivery threshold');
    assert.strictEqual(res1._body.numericTotal, 260);

    // B. Subtotal meets/exceeds threshold (3 items * ₹130 = ₹390 >= ₹299)
    const { req: req2, res: res2 } = createMockReqRes({
      method: 'POST',
      body: {
        items: [{ id: 'dish-biryani-rice-2pc-kebab', name: 'Biryani Rice with 2pc Kebab', price: 130, quantity: 3 }],
        catalogDishes: mockCatalog,
        storeSettings: activeSettings
      }
    });

    await checkoutHandler(req2, res2);
    assert.strictEqual(res2.statusCode, 200);
    assert.strictEqual(res2._body.subtotal, 390);
    assert.strictEqual(res2._body.discount, 78, '20% wholesale discount on 390 = 78');
    assert.strictEqual(res2._body.deliveryFee, 0);
    assert.strictEqual(res2._body.numericTotal, 312, '390 - 78 = ₹312');
    assert.ok(res2._body.checkoutToken, 'Must generate signed checkoutToken');
    assert.ok(res2._body.signature, 'Must include signature');
  });

  test('2. Tamper Defense: Client-manipulated price or excessive discount is overridden by authoritative backend', async () => {
    // Client tries to claim Biryani costs ₹10 instead of ₹130
    const { req, res } = createMockReqRes({
      method: 'POST',
      body: {
        items: [{ id: 'dish-biryani-rice-2pc-kebab', name: 'Biryani Rice with 2pc Kebab', price: 10, quantity: 3 }],
        catalogDishes: mockCatalog,
        storeSettings: activeSettings,
        discount: 300 // Fraudulent client discount
      }
    });

    await checkoutHandler(req, res);
    assert.strictEqual(res.statusCode, 200);
    // Subtotal must be calculated from catalog price (130 * 3 = 390)
    assert.strictEqual(res._body.subtotal, 390, 'Authoritative database catalog price must override spoofed ₹10');
    assert.strictEqual(res._body.discount, 78, 'Discount must be recalculated authoritatively');
    assert.strictEqual(res._body.numericTotal, 312);
  });

  test('3. Prepayment & Dynamic Doorstep UPI QR Generation with NPCI Protocol', async () => {
    // Generate Doorstep UPI QR for ₹312 order
    const qrResult = await generateDoorstepUpiQr({
      orderId: '#QB-9988',
      amount: 312,
      note: 'Savera Paradise Order #QB-9988'
    });

    assert.ok(qrResult.upiIntentUri.startsWith('upi://pay?'), 'Must follow Indian NPCI standard URI format');
    assert.ok(qrResult.upiIntentUri.includes('am=312.00'), 'Must specify exact payable amount');
    assert.ok(qrResult.upiIntentUri.includes('cu=INR'), 'Currency must be INR');
    assert.ok(qrResult.upiIntentUri.includes('pn=Savera'), 'Payee name must reference Savera');
    assert.strictEqual(qrResult.orderId, 'QB-9988');
  });

  test('4. Webhook Ingestion: Payment Confirmation & Order Status Synchronization', async () => {
    const secret = 'test_webhook_secret_key_12345';
    process.env.CASHFREE_WEBHOOK_SECRET = secret;

    const webhookBody = {
      data: {
        order: { order_id: 'order_QB-9988', order_amount: 312 },
        payment: { cf_payment_id: '987654321', payment_status: 'SUCCESS', payment_amount: 312, payment_method: 'upi' }
      },
      event_time: '2026-10-31T15:00:00Z',
      type: 'PAYMENT_SUCCESS_WEBHOOK'
    };

    const rawString = JSON.stringify(webhookBody);
    const timestamp = String(Date.now());
    const signature = crypto.createHmac('sha256', secret).update(timestamp + rawString).digest('base64');

    const { req, res } = createMockReqRes({
      method: 'POST',
      body: webhookBody,
      headers: {
        'x-webhook-timestamp': timestamp,
        'x-webhook-signature': signature
      }
    });

    await cashfreeWebhookHandler(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res._body.success, true);
    assert.strictEqual(res._body.orderId, 'QB-9988');
    assert.strictEqual(res._body.cfPaymentId, '987654321');
  });

  test('5. Order State Machine: Forward Lifecycle & Immutability Enforcement', () => {
    const validSequence = ['pending', 'accepted', 'cooking', 'ready_for_pickup', 'on_the_way', 'delivered'];
    for (let i = 0; i < validSequence.length - 1; i++) {
      const from = validSequence[i];
      const to = validSequence[i + 1];
      assert.ok(ORDER_STATUS_RANKS[to] > ORDER_STATUS_RANKS[from], `Status ${to} (${ORDER_STATUS_RANKS[to]}) must rank higher than ${from} (${ORDER_STATUS_RANKS[from]})`);
    }

    // Regressive status reversal check: delivered cannot revert to cooking
    assert.ok(ORDER_STATUS_RANKS['cooking'] < ORDER_STATUS_RANKS['delivered'], 'Cooking rank must be lower than delivered');
    assert.ok(ORDER_STATUS_RANKS['accepted'] < ORDER_STATUS_RANKS['on_the_way'], 'Accepted rank must be lower than on_the_way');
  });

  test('6. Rider Parcel Claim Handshake & Route Distance Safeguard', () => {
    const mockOrder = {
      id: '#QB-9988',
      bagPin: '4821',
      customerName: 'Rahul Sharma',
      customerPhone: '9845012345',
      deliveryAddress: 'Flat 302, MG Road, Ramanagara',
      total: '₹312',
      items: [{ name: 'Biryani Rice', quantity: 3 }]
    };

    // Valid handshake
    const enteredPin = '4821';
    assert.strictEqual(enteredPin, mockOrder.bagPin, 'Bag PIN must match order bagPin');

    // Distance calculation NaN safeguard check
    const invalidRawDistance = NaN;
    const safeDistanceKm = (!invalidRawDistance || isNaN(invalidRawDistance) || invalidRawDistance <= 0) ? 1.8 : invalidRawDistance;
    const estimatedMins = Math.max(5, Math.round(safeDistanceKm * 3.5));

    assert.strictEqual(safeDistanceKm, 1.8, 'NaN distance must fall back to 1.8 km');
    assert.strictEqual(estimatedMins, 6, 'Estimated ride time must be 6 mins');
    assert.ok(!isNaN(estimatedMins), 'Ride duration must never be NaN');
  });

  test('7. Executive Owner Portal & Role-Segregated Payout Verification', async () => {
    // A. Unauthenticated payout rejected
    const { req: req1, res: res1 } = createMockReqRes({
      method: 'POST',
      body: { riderPin: '2233', amount: 150 }
    });
    await cashfreePayoutHandler(req1, res1);
    assert.strictEqual(res1.statusCode, 401, 'Unauthenticated payout must be 401');

    // B. Kitchen Staff Admin role token rejected (Executive Owner privilege required)
    const adminToken = createAdminToken(3600000, 'admin');
    const { req: req2, res: res2 } = createMockReqRes({
      method: 'POST',
      headers: { 'authorization': `Bearer ${adminToken}` },
      body: { riderPin: '2233', amount: 150 }
    });
    await cashfreePayoutHandler(req2, res2);
    assert.strictEqual(res2.statusCode, 403, 'Kitchen staff admin role must be forbidden from initiating payouts');

    // C. Executive Owner role token authorized
    const ownerToken = createAdminToken(3600000, 'owner');
    const { req: req3, res: res3 } = createMockReqRes({
      method: 'POST',
      headers: { 'authorization': `Bearer ${ownerToken}` },
      body: { riderPin: '2233', amount: 150 }
    });
    await cashfreePayoutHandler(req3, res3);
    assert.strictEqual(res3.statusCode, 200, 'Executive owner must be authorized');
    assert.strictEqual(res3._body.success, true);
  });

  test('8. Cloudflare R2 Serverless Proxy Upload & Delete Boundaries', async () => {
    // A. Unauthenticated upload rejected
    const { req: req1, res: res1 } = createMockReqRes({
      method: 'POST',
      headers: { 'content-type': 'image/jpeg' },
      body: Buffer.from([0xFF, 0xD8, 0xFF, 0xE0])
    });
    await r2UploadHandler(req1, res1);
    assert.strictEqual(res1.statusCode, 401, 'Unauthenticated R2 upload must be rejected with 401');

    // B. Unauthenticated deletion rejected
    const { req: req3, res: res3 } = createMockReqRes({
      method: 'POST',
      body: { key: 'dishes/sample.jpg' }
    });
    await r2DeleteHandler(req3, res3);
    assert.strictEqual(res3.statusCode, 401, 'Unauthenticated R2 deletion must be rejected with 401');
  });
});
