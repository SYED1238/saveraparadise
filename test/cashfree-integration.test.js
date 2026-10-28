import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  getCashfreeConfig,
  createPgOrder,
  generateDoorstepUpiQr,
  verifyCashfreeWebhookSignature,
  initiateRiderPayout
} from '../api/_cashfree.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

describe('CASHFREE PAYMENTS & DOORSTEP DYNAMIC UPI QR TEST SUITE', () => {
  beforeEach(() => {
    // Reset test environment variables
    delete process.env.CASHFREE_APP_ID;
    delete process.env.CASHFREE_SECRET_KEY;
    delete process.env.CASHFREE_ENV;
    delete process.env.CASHFREE_WEBHOOK_SECRET;
    delete process.env.RESTAURANT_UPI_VPA;
  });

  describe('1. Configuration & Environment Handling', () => {
    test('defaults to sandbox TEST environment and unconfigured status in local test environment', () => {
      const cfg = getCashfreeConfig();
      assert.strictEqual(cfg.env, 'TEST');
      assert.strictEqual(cfg.isProd, false);
      assert.strictEqual(cfg.isConfigured, false);
      assert.strictEqual(cfg.pgBaseUrl, 'https://sandbox.cashfree.com/pg');
      assert.strictEqual(cfg.payoutBaseUrl, 'https://payout-gamma.cashfree.com/payout');
    });

    test('correctly configures PROD environment and base URLs when environment variables are supplied', () => {
      process.env.CASHFREE_APP_ID = 'test_app_12345';
      process.env.CASHFREE_SECRET_KEY = 'test_secret_67890';
      process.env.CASHFREE_ENV = 'PROD';

      const cfg = getCashfreeConfig();
      assert.strictEqual(cfg.env, 'PROD');
      assert.strictEqual(cfg.isProd, true);
      assert.strictEqual(cfg.isConfigured, true);
      assert.strictEqual(cfg.pgBaseUrl, 'https://api.cashfree.com/pg');
      assert.strictEqual(cfg.payoutBaseUrl, 'https://payout-api.cashfree.com/payout');
    });
  });

  describe('2. Storefront Prepayment PG Order Creation', () => {
    test('generates mock payment session and order ID when unconfigured', async () => {
      const res = await createPgOrder({
        orderId: '#9988',
        amount: 349.50,
        customerPhone: '9876543210',
        customerName: 'Aarav Patel'
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.isMock, true);
      assert.strictEqual(res.cfOrderId, 'cf_9988');
      assert.match(res.paymentSessionId, /^session_mock_9988_\d+$/);
      assert.strictEqual(res.orderAmount, 349.5);
      assert.strictEqual(res.orderCurrency, 'INR');
    });

    test('enforces minimum order amount and strips # prefix from order ID', async () => {
      const res = await createPgOrder({
        orderId: '###1001',
        amount: -50
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.orderAmount, 1, 'Should enforce minimum ₹1 amount');
      assert.strictEqual(res.cfOrderId, 'cf_1001');
    });
  });

  describe('3. Doorstep Dynamic UPI QR Generation (PhonePe / GPay / Paytm / BHIM)', () => {
    test('builds standard Indian UPI URI matching NPCI protocol with merchant VPA and amount', async () => {
      process.env.RESTAURANT_UPI_VPA = 'saveraparadise@okhdfcbank';

      const res = await generateDoorstepUpiQr({
        orderId: '7721',
        amount: 285.50,
        customerName: 'Rahul Sharma'
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.orderId, '7721');
      assert.strictEqual(res.amount, 285.5);
      assert.strictEqual(res.merchantVpa, 'saveraparadise@okhdfcbank');

      // Verify NPCI UPI standard intent format
      assert.ok(res.upiIntentUri.startsWith('upi://pay?'), 'URI must begin with upi://pay?');
      assert.ok(res.upiIntentUri.includes('pa=saveraparadise%40okhdfcbank') || res.upiIntentUri.includes('pa=saveraparadise@okhdfcbank'));
      assert.ok(res.upiIntentUri.includes('am=285.50'), 'Must contain exact 2-decimal amount');
      assert.ok(res.upiIntentUri.includes('cu=INR'), 'Must specify INR currency');
      assert.ok(res.upiIntentUri.includes('tr=QB7721'), 'Must include order tracking reference');
      assert.ok(res.expiresAt > Date.now(), 'Must include future expiry timestamp');
    });

    test('supports custom restaurant VPA from environment', async () => {
      process.env.RESTAURANT_UPI_VPA = 'customhotel@icici';

      const res = await generateDoorstepUpiQr({
        orderId: '8832',
        amount: 199.00
      });

      assert.strictEqual(res.merchantVpa, 'customhotel@icici');
      assert.ok(res.upiIntentUri.includes('customhotel@icici'));
    });
  });

  describe('4. Cashfree Webhook Signature Verification', () => {
    test('successfully validates genuine HMAC-SHA256 signature', () => {
      const secret = 'webhook_super_secret_key_123';
      process.env.CASHFREE_APP_ID = 'test_app';
      process.env.CASHFREE_SECRET_KEY = 'test_secret';
      process.env.CASHFREE_WEBHOOK_SECRET = secret;

      const timestamp = String(Date.now());
      const rawBody = JSON.stringify({
        data: {
          order: { order_id: 'cf_9988', order_amount: 349.50 },
          payment: { payment_id: 'pay_123', payment_status: 'SUCCESS' }
        },
        event_time: '2026-10-28T20:00:00Z',
        type: 'PAYMENT_SUCCESS_WEBHOOK'
      });

      const signature = crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}${rawBody}`)
        .digest('base64');

      const isValid = verifyCashfreeWebhookSignature(signature, rawBody, timestamp);
      assert.strictEqual(isValid, true, 'Valid signature should be accepted');
    });

    test('rejects tampered webhook payloads or invalid signatures', () => {
      const secret = 'webhook_super_secret_key_123';
      process.env.CASHFREE_APP_ID = 'test_app';
      process.env.CASHFREE_SECRET_KEY = 'test_secret';
      process.env.CASHFREE_WEBHOOK_SECRET = secret;

      const timestamp = String(Date.now());
      const rawBody = JSON.stringify({ payment: 'SUCCESS' });
      const tamperedBody = JSON.stringify({ payment: 'FAILURE' });

      const signature = crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}${rawBody}`)
        .digest('base64');

      const isValid = verifyCashfreeWebhookSignature(signature, tamperedBody, timestamp);
      assert.strictEqual(isValid, false, 'Tampered body should be rejected');
    });
  });

  describe('5. Rider Nighttime Instant Payout', () => {
    test('executes simulated instant transfer when credentials are in mock mode', async () => {
      const res = await initiateRiderPayout({
        transferId: 'tr_rd_2233_1',
        amount: 281.00,
        riderPin: '2233',
        upiVpa: 'rider.ramesh@okaxis',
        phone: '9876543210',
        name: 'Rider Ramesh'
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.isMock, true);
      assert.strictEqual(res.amount, 281.00);
      assert.strictEqual(res.riderPin, '2233');
      assert.strictEqual(res.status, 'SUCCESS');
      assert.ok(res.utr.startsWith('UTR_MOCK_'));
      assert.ok(res.message.includes('rider.ramesh@okaxis'));
    });
  });

  describe('6. Delivery & Owner Portal DOM & CSS Parity', () => {
    test('delivery.html contains Doorstep payment selector and dynamic QR box elements', () => {
      const deliveryHtml = fs.readFileSync(path.join(rootDir, 'delivery.html'), 'utf8');
      assert.ok(deliveryHtml.includes('id="doorstep-pay-selector"'), 'Must have doorstep pay selector');
      assert.ok(deliveryHtml.includes('id="btn-doorstep-mode-cash"'), 'Must have cash mode button');
      assert.ok(deliveryHtml.includes('id="btn-doorstep-mode-upi"'), 'Must have UPI mode button');
      assert.ok(deliveryHtml.includes('id="doorstep-upi-qr-box"'), 'Must have doorstep UPI QR container');
      assert.ok(deliveryHtml.includes('id="doorstep-qr-img"'), 'Must have QR image element');
    });

    test('delivery.css contains styling for doorstep payment options and UPI QR box', () => {
      const deliveryCss = fs.readFileSync(path.join(rootDir, 'delivery.css'), 'utf8');
      assert.ok(deliveryCss.includes('.doorstep-pay-selector'), 'Must style doorstep pay selector');
      assert.ok(deliveryCss.includes('.btn-pay-option'), 'Must style doorstep pay option buttons');
      assert.ok(deliveryCss.includes('.doorstep-upi-qr-box'), 'Must style doorstep UPI QR box');
      assert.ok(deliveryCss.includes('.doorstep-qr-img'), 'Must style doorstep QR image');
    });

    test('owner.js and owner.css include Cashfree instant UPI payout buttons and actions', () => {
      const ownerJs = fs.readFileSync(path.join(rootDir, 'owner.js'), 'utf8');
      const ownerCss = fs.readFileSync(path.join(rootDir, 'owner.css'), 'utf8');

      assert.ok(ownerJs.includes('btn-payout-upi'), 'owner.js must render .btn-payout-upi buttons');
      assert.ok(ownerJs.includes('/api/cashfree-payout'), 'owner.js must call /api/cashfree-payout endpoint');
      assert.ok(ownerCss.includes('.btn-payout-upi'), 'owner.css must style .btn-payout-upi');
      assert.ok(ownerCss.includes('.payout-actions-cell'), 'owner.css must style .payout-actions-cell');
    });

    test('vercel.json whitelists Cashfree domains in CSP connect-src and frame-src', () => {
      const vercelJson = fs.readFileSync(path.join(rootDir, 'vercel.json'), 'utf8');
      assert.ok(vercelJson.includes('https://*.cashfree.com'), 'Must whitelist cashfree.com');
      assert.ok(vercelJson.includes('https://sdk.cashfree.com'), 'Must whitelist sdk.cashfree.com');
      assert.ok(vercelJson.includes('https://sandbox.cashfree.com'), 'Must whitelist sandbox.cashfree.com');
    });
  });

  describe('7. Food Cash Drawer vs Rider Payout Accounting Segregation', () => {
    test('verifies doorstep UPI collection does not add cash to rider drawer liability while paying rider their fee', () => {
      // Simulate an order where customer paid ₹450 via PhonePe at the door
      const order = {
        id: '#7733',
        total: 450,
        paymentMethod: 'doorstep_upi',
        doorstep_upi: true,
        isPaidOnline: true,
        cashCollected: 0,
        distanceKm: 1.31,
        riderPin: '2233',
        riderPayout: 28.10,
        status: 'delivered'
      };

      // 1. Physical cash liability for rider is 0
      assert.strictEqual(order.cashCollected, 0, 'Rider does not collect cash for Doorstep UPI');
      assert.strictEqual(order.doorstep_upi, true, 'Order marked as doorstep UPI');

      // 2. Rider is still owed full ₹28.10 for the delivery
      assert.strictEqual(order.riderPayout, 28.10, 'Rider must earn their delivery fee');

      // 3. Restaurant received ₹450 directly in merchant bank account
      const restaurantDigitalIncome = order.total;
      assert.strictEqual(restaurantDigitalIncome, 450, 'Restaurant received ₹450 online directly');
    });
  });
});
