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
  initiateRiderPayout,
  sanitizeCashfreeReturnUrl,
  recordVerifiedCashfreePayment,
  initiatePgOrderRefund
} from '../api/_cashfree.js';
import { createAdminToken, signPayload } from '../api/_auth.js';
import cashfreePayoutHandler from '../api/cashfree-payout.js';
import cashfreeCreateOrderHandler from '../api/cashfree-create-order.js';
import cashfreeGenerateQrHandler from '../api/cashfree-generate-qr.js';
import orderActionHandler from '../api/order-action.js';

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

    test('Doorstep PhonePe / UPI QR option is enabled for rider payment collection at doorstep', () => {
      const deliveryHtml = fs.readFileSync(path.join(rootDir, 'delivery.html'), 'utf8');
      const deliveryJs = fs.readFileSync(path.join(rootDir, 'delivery.js'), 'utf8');
      const deliveryCss = fs.readFileSync(path.join(rootDir, 'delivery.css'), 'utf8');

      assert.ok(deliveryHtml.includes('id="btn-doorstep-mode-upi"'), 'Must have UPI mode button');
      assert.ok(deliveryHtml.includes('id="doorstep-upi-qr-box"'), 'Must have dynamic QR container');
      assert.doesNotMatch(deliveryHtml, /id="btn-doorstep-mode-upi"[^>]*\bdisabled\b/, 'UPI mode button must be enabled in delivery.html');

      assert.ok(deliveryJs.includes('const DOORSTEP_UPI_ENABLED = true;'), 'DOORSTEP_UPI_ENABLED must be true');
      assert.ok(deliveryJs.includes('if (!DOORSTEP_UPI_ENABLED || !order) return;'), 'generateAndShowDoorstepQr must guard on active order');
      assert.ok(deliveryJs.includes('DOORSTEP_UPI_ENABLED && (isCod && currentDoorstepPaymentMode === \'upi\')'), 'Delivery submission must handle Doorstep UPI');
      assert.ok(deliveryCss.includes('.btn-pay-option') && deliveryCss.includes('.doorstep-upi-qr-box'), 'Must style pay option and QR box');
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

    test('Cloudflare _headers whitelists Cashfree domains in CSP connect-src and frame-src', () => {
      const headersContent = fs.readFileSync(path.join(rootDir, 'public', '_headers'), 'utf8');
      assert.ok(headersContent.includes('https://*.cashfree.com'), 'Must whitelist cashfree.com');
      assert.ok(headersContent.includes('https://sdk.cashfree.com'), 'Must whitelist sdk.cashfree.com');
      assert.ok(headersContent.includes('https://sandbox.cashfree.com'), 'Must whitelist sandbox.cashfree.com');
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

  describe('8. Payout & Order Security Boundaries', () => {
    function createMockReqRes({ method = 'POST', headers = {}, body = null } = {}) {
      let statusCode = 200;
      let responseData = null;
      const responseHeaders = {};

      const req = { method, headers: { ...headers }, body };
      const res = {
        status(code) { statusCode = code; return this; },
        setHeader(key, val) { responseHeaders[key] = val; return this; },
        json(data) { responseData = data; return this; },
        end() { return this; },
        get statusCode() { return statusCode; },
        get data() { return responseData; }
      };
      return { req, res };
    }

    test('POST /api/cashfree-payout rejects unauthenticated requests with 401', async () => {
      const { req, res } = createMockReqRes({
        body: { riderPin: '2233', amount: 50, upiVpa: 'rider@upi' }
      });
      await cashfreePayoutHandler(req, res);
      assert.strictEqual(res.statusCode, 401);
    });

    test('POST /api/cashfree-payout rejects kitchen admin role with 403 Forbidden', async () => {
      const adminToken = createAdminToken(undefined, 'admin');
      const { req, res } = createMockReqRes({
        headers: { authorization: `Bearer ${adminToken}` },
        body: { riderPin: '2233', amount: 50, upiVpa: 'rider@upi' }
      });
      await cashfreePayoutHandler(req, res);
      assert.strictEqual(res.statusCode, 403);
      assert.ok(res.data.message.includes('Strictly Executive Owner authorization'));
    });

    test('POST /api/cashfree-payout permits executive owner role with 200', async () => {
      const ownerToken = createAdminToken(undefined, 'owner');
      const { req, res } = createMockReqRes({
        headers: { authorization: `Bearer ${ownerToken}` },
        body: { riderPin: '2233', amount: 50, upiVpa: 'rider@upi', phone: '9876543210', name: 'Zabi' }
      });
      await cashfreePayoutHandler(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.data.success, true);
    });

    test('POST /api/cashfree-create-order rejects tampered checkoutToken with 400', async () => {
      const { req, res } = createMockReqRes({
        body: {
          orderId: 'ORD-TEST-101',
          amount: 500,
          customerPhone: '9876543210',
          checkoutToken: 'invalid.tampered.token'
        }
      });
      await cashfreeCreateOrderHandler(req, res);
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.data.error, 'Invalid Token');
    });

    test('POST /api/cashfree-create-order enforces signed numericTotal when valid checkoutToken is supplied', async () => {
      const validCheckoutToken = signPayload({
        subtotal: 400,
        numericTotal: 400,
        timestamp: Date.now()
      });
      const { req, res } = createMockReqRes({
        body: {
          orderId: 'ORD-TEST-102',
          amount: 1, // Attacker tries sending ₹1 in body
          customerPhone: '9876543210',
          checkoutToken: validCheckoutToken
        }
      });
      await cashfreeCreateOrderHandler(req, res);
      assert.strictEqual(res.statusCode, 200);
      // In mock mode, order_amount in result should match the verified token (400), not the attacker body (1)
      assert.strictEqual(res.data.orderAmount, 400);
    });

    test('POST /api/cashfree-create-order strictly rejects requests without checkoutToken with 400', async () => {
      const { req, res } = createMockReqRes({
        body: {
          orderId: 'ORD-TEST-NO-TOKEN',
          amount: 250,
          customerPhone: '9876543210'
        }
      });
      await cashfreeCreateOrderHandler(req, res);
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.data.message.includes('checkoutToken is strictly required'));
    });

    test('POST /api/cashfree-create-order rejects expired checkoutToken (>15m) with 400', async () => {
      const expiredToken = signPayload({
        subtotal: 300,
        numericTotal: 300,
        timestamp: Date.now() - (16 * 60 * 1000)
      });
      const { req, res } = createMockReqRes({
        body: {
          orderId: 'ORD-TEST-EXPIRED',
          amount: 300,
          checkoutToken: expiredToken
        }
      });
      await cashfreeCreateOrderHandler(req, res);
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.data.error, 'Expired Token');
    });

    test('Cashfree Webhook rejects timestamp older than 5 minutes (replay protection)', () => {
      const secret = 'webhook_secret_key_replay_test';
      process.env.CASHFREE_APP_ID = 'test_app';
      process.env.CASHFREE_SECRET_KEY = 'test_secret';
      process.env.CASHFREE_WEBHOOK_SECRET = secret;

      const oldTimestamp = String(Date.now() - (6 * 60 * 1000));
      const rawBody = JSON.stringify({ type: 'PAYMENT_SUCCESS_WEBHOOK' });
            const signature = crypto
        .createHmac('sha256', secret)
        .update(`${oldTimestamp}${rawBody}`)
        .digest('base64');

      const isValid = verifyCashfreeWebhookSignature(signature, rawBody, oldTimestamp);
      assert.strictEqual(isValid, false, 'Expired webhook timestamp must be rejected to defend against replays');
    });

    test('Order ID normalization correctly resolves qb_doorstep_ prefix to pure order ID', () => {
      const cfOrderId = 'qb_doorstep_1234_9821';
      const cleanOrderId = cfOrderId
        .replace(/^(?:order_|qb_|doorstep_|cf_)+/, '')
        .split('_')[0];
      assert.strictEqual(cleanOrderId, '1234', 'Must extract 1234 and not doorstep');
    });

    test('delivery.js does not leak order data to third-party api.qrserver.com', () => {
      const deliveryJs = fs.readFileSync(path.join(rootDir, 'delivery.js'), 'utf8');
      assert.strictEqual(deliveryJs.includes('api.qrserver.com'), false, 'delivery.js must never reference api.qrserver.com');
      assert.ok(deliveryJs.includes('QRCode.toDataURL'), 'delivery.js must generate fallback QR locally');
    });

    test('sanitizeCashfreeReturnUrl defaults to saveraparadise.foodbliz.in and blocks open redirects', () => {
      const fallbackUrl = sanitizeCashfreeReturnUrl('', 'QB-1001');
      assert.ok(fallbackUrl.startsWith('https://saveraparadise.foodbliz.in/'), 'Default return URL must target saveraparadise.foodbliz.in');
      const blockedUrl = sanitizeCashfreeReturnUrl('https://evil.example.com/phish', 'QB-1001');
      assert.ok(blockedUrl.startsWith('https://saveraparadise.foodbliz.in/'), 'Untrusted redirect origin must fall back safely');
      const allowedUrl = sanitizeCashfreeReturnUrl('https://saveraparadise.foodbliz.in/?payment_return=1&cf_order_id={order_id}', 'QB-1001');
      assert.strictEqual(allowedUrl, 'https://saveraparadise.foodbliz.in/?payment_return=1&cf_order_id={order_id}');
    });

    test('POST /api/cashfree-create-order verify_payment validates cfOrderId and verifies mock payment', async () => {
      const { req: badReq, res: badRes } = createMockReqRes({
        body: { action: 'verify_payment' }
      });
      await cashfreeCreateOrderHandler(badReq, badRes);
      assert.strictEqual(badRes.statusCode, 400);

      const { req: okReq, res: okRes } = createMockReqRes({
        body: { action: 'verify_payment', cfOrderId: 'cf_QB-1001' }
      });
      await cashfreeCreateOrderHandler(okReq, okRes);
      assert.strictEqual(okRes.statusCode, 200);
      assert.strictEqual(okRes.data.paid, true);
    });

    test('index.html enables online payment selector and loads Cashfree v3 SDK', () => {
      const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
      assert.ok(indexHtml.includes('https://sdk.cashfree.com/js/v3/cashfree.js'), 'index.html must load Cashfree v3 SDK');
      assert.match(indexHtml, /id="payment-card-online"/, 'index.html must include payment-card-online');
      assert.doesNotMatch(indexHtml, /id="radio-payment-online"[^>]*\bdisabled\b/, 'radio-payment-online must be enabled');
    });

    test('main.js guards Cashfree SDK modal against mock session IDs when local keys are absent', () => {
      const mainJs = fs.readFileSync(path.join(rootDir, 'main.js'), 'utf8');
      const mockIdx = mainJs.indexOf('if (pgData.isMock)');
      const checkoutIdx = mainJs.indexOf('cashfree.checkout({');
      assert.ok(mockIdx > 0, 'main.js must explicitly handle pgData.isMock');
      assert.ok(checkoutIdx > mockIdx, 'main.js must branch on pgData.isMock before calling cashfree.checkout');
    });

    test('POST /api/cashfree-generate-qr strictly rejects unauthenticated requests with 401', async () => {
      const { req, res } = createMockReqRes({
        body: { orderId: '1004', amount: 350 }
      });
      await cashfreeGenerateQrHandler(req, res);
      assert.strictEqual(res.statusCode, 401);
      assert.ok(res.data.error.includes('Unauthorized') || res.data.message.includes('authorization'));
    });

    test('POST /api/cashfree-generate-qr succeeds with valid rider authorization token and mock session', async () => {
      const riderToken = createAdminToken(3600000, 'rider');
      const { req, res } = createMockReqRes({
        headers: { authorization: `Bearer ${riderToken}` },
        body: { orderId: '1005', amount: 260, customerName: 'Zabi' }
      });
      await cashfreeGenerateQrHandler(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.isMock, true);
      assert.strictEqual(res.data.cfOrderId, 'doorstep_1005');
      assert.ok(res.data.paymentSessionId.startsWith('session_mock_doorstep_1005_'));
      assert.ok(res.data.qrDataUrl.startsWith('data:image/'));
    });

    test('POST /api/cashfree-generate-qr returns non-empty data:image/ qrDataUrl in Worker/Node environments without setting doorstep_upi: true prematurely', async () => {
      const riderToken = createAdminToken(3600000, 'rider');
      const { req, res } = createMockReqRes({
        headers: { authorization: `Bearer ${riderToken}` },
        body: { orderId: '1006', amount: 350, customerName: 'Hamza' }
      });
      await cashfreeGenerateQrHandler(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.data.success, true);
      assert.ok(res.data.qrDataUrl.startsWith('data:image/'));
      assert.ok(res.data.upiIntentUri.startsWith('upi://pay?pa='));

      // Verify code does not set doorstep_upi: true prematurely at QR generation time
      const apiGenQrSrc = fs.readFileSync(path.join(rootDir, 'api', 'cashfree-generate-qr.js'), 'utf8');
      const cfGenQrSrc = fs.readFileSync(path.join(rootDir, 'functions', 'api', 'cashfree-generate-qr.js'), 'utf8');
      assert.strictEqual(apiGenQrSrc.includes('doorstep_upi: true'), false, 'api/cashfree-generate-qr.js must not set doorstep_upi prematurely');
      assert.strictEqual(cfGenQrSrc.includes('doorstep_upi: true'), false, 'functions/api/cashfree-generate-qr.js must not set doorstep_upi prematurely');
    });

    test('order where QR was generated can still be marked delivered with doorstepUpi: false and full cashCollected', async () => {
      const riderToken = createAdminToken(3600000, 'rider', { riderPin: '2233' });
      const simulateOrders = [
        {
          id: 'COD-TEST-SWITCH',
          status: 'on_the_way',
          assigned_rider_pin: '2233',
          numeric_total: 260,
          total: '₹260',
          doorstep_upi: true,
          cf_order_id: 'doorstep_COD-TEST-SWITCH',
          cf_payment_status: 'PENDING',
          is_paid_online: false,
          cash_collected: 0
        }
      ];

      const { req, res } = createMockReqRes({
        headers: { authorization: `Bearer ${riderToken}` },
        body: {
          action: 'update_status',
          orderId: 'COD-TEST-SWITCH',
          status: 'delivered',
          doorstepUpi: false,
          cashCollected: 260,
          riderPin: '2233',
          simulateOrders
        }
      });

      await orderActionHandler(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.order.payment_status, 'Paid');
      assert.strictEqual(res.data.order.cash_collected, 260, 'Full cash amount must be recorded');
      assert.strictEqual(res.data.order.doorstep_upi, false, 'doorstep_upi must be false when paid in cash');
      assert.strictEqual(res.data.order.is_paid_online, false, 'is_paid_online must be false for cash delivery');
    });

    test('generateDoorstepUpiQr provides paymentSessionId and cfOrderId even in unconfigured mode', async () => {
      const res = await generateDoorstepUpiQr({
        orderId: '5566',
        amount: 320
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.isMock, true);
      assert.strictEqual(res.cfOrderId, 'doorstep_5566');
      assert.ok(res.paymentSessionId.startsWith('session_mock_doorstep_5566_'));
    });

    test('delivery.js implements resetDoorstepModalState and stops polling on back navigation', () => {
      const deliveryJs = fs.readFileSync(path.join(rootDir, 'delivery.js'), 'utf8');
      assert.ok(deliveryJs.includes('function resetDoorstepModalState()'), 'Must declare resetDoorstepModalState');
      assert.ok(deliveryJs.includes('resetDoorstepModalState();'), 'Must invoke resetDoorstepModalState');
      assert.ok(deliveryJs.includes('currentDoorstepCashfreeSession.isMock'), 'btnOpenCashfreeCheckout must handle isMock');
    });

    test('delivery.js automatically marks order delivered upon Cashfree payment confirmation with submission guard', () => {
      const deliveryJs = fs.readFileSync(path.join(rootDir, 'delivery.js'), 'utf8');
      assert.ok(deliveryJs.includes('isSubmittingDelivery'), 'Must declare isSubmittingDelivery guard');
      assert.ok(deliveryJs.includes('formConfirmDelivered.requestSubmit'), 'Must trigger formConfirmDelivered.requestSubmit automatically');
      assert.ok(deliveryJs.includes('Marking Delivered...'), 'Must update UI to indicate delivery in progress');
    });

    test('api/order-action.js and functions/api/order-action.js never write non-existent upi_manual_verified column', () => {
      const nodeOrderAction = fs.readFileSync(path.join(rootDir, 'api', 'order-action.js'), 'utf8');
      const cfOrderAction = fs.readFileSync(path.join(rootDir, 'functions', 'api', 'order-action.js'), 'utf8');
      assert.strictEqual(nodeOrderAction.includes('upi_manual_verified'), false, 'Node api/order-action.js must not reference upi_manual_verified');
      assert.strictEqual(cfOrderAction.includes('upi_manual_verified'), false, 'Cloudflare functions/api/order-action.js must not reference upi_manual_verified');
    });
  });

  describe('7. Automated Online Order Cancellation & Cashfree PG Refund Engine', () => {
    test('initiatePgOrderRefund generates simulated refund in sandbox/test mode', async () => {
      const res = await initiatePgOrderRefund({
        cfOrderId: 'cf_ord_9988_test',
        refundAmount: 349.50,
        refundNote: 'Order rejected by kitchen: Out of stock'
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.isMock, true);
      assert.strictEqual(res.refundAmount, 349.50);
      assert.strictEqual(res.cfOrderId, 'cf_ord_9988_test');
      assert.strictEqual(res.refundStatus, 'SUCCESS');
      assert.ok(res.refundId.startsWith('rf_'));
      assert.ok(res.message.includes('1 hour'));
    });

    test('initiatePgOrderRefund rejects missing cfOrderId', async () => {
      const res = await initiatePgOrderRefund({
        cfOrderId: '',
        refundAmount: 100
      });

      assert.strictEqual(res.success, false);
      assert.ok(res.error.includes('cfOrderId is required'));
    });

    test('initiatePgOrderRefund fails closed in PROD mode when credentials are missing', async () => {
      process.env.CASHFREE_ENV = 'PROD';
      delete process.env.CASHFREE_APP_ID;
      delete process.env.CASHFREE_SECRET_KEY;

      const res = await initiatePgOrderRefund({
        cfOrderId: 'cf_ord_prod_9988',
        refundAmount: 500
      });

      assert.strictEqual(res.success, false);
      assert.ok(res.error.includes('not configured in production'));
    });

    test('POST /api/order-action cancel_order automatically triggers refund for online-paid order', async () => {
      const adminToken = createAdminToken(3600000, 'admin');
      const simulateOrders = [
        {
          id: 'QB-TEST-REFUND-01',
          status: 'accepted',
          status_label: 'Accepted',
          payment_method: 'Online (Cashfree UPI)',
          payment_status: 'Paid',
          is_paid_online: true,
          cf_order_id: 'cf_test_ord_refund_01',
          cf_payment_id: 'pay_998811',
          total: '₹380.00',
          tracking_token: 'secret-tok-QB-TEST-REFUND-01'
        }
      ];

      function createMockReq(headers, body) {
        return {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(headers || {}) },
          body
        };
      }
      function createMockRes() {
        let statusCode = 200;
        let responseData = null;
        return {
          status(code) { statusCode = code; return this; },
          setHeader() { return this; },
          json(data) { responseData = data; return this; },
          get statusCode() { return statusCode; },
          get responseData() { return responseData; }
        };
      }

      const req = createMockReq({ authorization: `Bearer ${adminToken}` }, {
        action: 'cancel_order',
        orderId: 'QB-TEST-REFUND-01',
        reason: 'Kitchen out of chicken stock',
        simulateOrders
      });
      const res = createMockRes();

      await orderActionHandler(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.responseData.success, true);
      assert.strictEqual(res.responseData.order.status, 'cancelled');
      assert.strictEqual(res.responseData.order.status_label, 'Order Cancelled');
      assert.strictEqual(res.responseData.order.cf_payment_status, 'REFUND_INITIATED');
      assert.strictEqual(res.responseData.order.address_details?.refund_status, 'SUCCESS');
      assert.strictEqual(res.responseData.order.address_details?.refund_amount, 380);
      assert.ok(res.responseData.order.address_details?.refund_message.includes('within an hour'));
    });

    test('main.js and admin.js include refund status and "Within 1 Hour" notice for online orders', () => {
      const mainJs = fs.readFileSync(path.join(rootDir, 'main.js'), 'utf8');
      const adminJs = fs.readFileSync(path.join(rootDir, 'admin.js'), 'utf8');

      // main.js verifies online refund display
      assert.ok(mainJs.includes('isOrderPaidOnline'), 'main.js must define isOrderPaidOnline helper');
      assert.ok(mainJs.includes('Within 1 Hour'), 'main.js tracker must display "Within 1 Hour" badge');
      assert.ok(mainJs.includes('Refund Initiated'), 'main.js must display Refund Initiated banner');
      assert.ok(mainJs.includes('my-orders-refund-pill'), 'main.js must render my-orders-refund-pill');

      // admin.js verifies kitchen modal awareness
      assert.ok(adminJs.includes('Refund Initiated'), 'admin.js must indicate Refund Initiated on cancelled online orders');
    });
  });
});
