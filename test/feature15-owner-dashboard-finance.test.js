import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataService } from '../dataService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Polyfill minimal browser environment if running in node test runner
const storage = new Map();
const mockLocalStorage = {
  getItem: (k) => storage.get(k) || null,
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
  clear: () => storage.clear()
};
globalThis.localStorage = mockLocalStorage;

const sStorage = new Map();
const mockSessionStorage = {
  getItem: (k) => sStorage.get(k) || null,
  setItem: (k, v) => sStorage.set(k, String(v)),
  removeItem: (k) => sStorage.delete(k),
  clear: () => sStorage.clear()
};
globalThis.sessionStorage = mockSessionStorage;

describe('FEATURE #15: EXECUTIVE OWNER DASHBOARD, FINANCIAL ANALYTICS & INSTANT PAYOUTS', () => {

  beforeEach(() => {
    storage.clear();
    sStorage.clear();
  });

  test('1. isOnlineOrderPayment accurately classifies all payment variants', async () => {
    const { isOnlineOrderPayment } = await import('../owner.js');
    assert.strictEqual(typeof isOnlineOrderPayment, 'function', 'isOnlineOrderPayment should be exported from owner.js');

    // Doorstep UPI
    assert.strictEqual(isOnlineOrderPayment({ doorstepUpi: true, paymentMethod: 'COD' }), true);
    assert.strictEqual(isOnlineOrderPayment({ doorstep_upi: true, payment_method: 'COD' }), true);

    // Storefront Online Prepayments
    assert.strictEqual(isOnlineOrderPayment({ isPaidOnline: true, paymentMethod: 'Cashfree PG' }), true);
    assert.strictEqual(isOnlineOrderPayment({ is_paid_online: true }), true);
    assert.strictEqual(isOnlineOrderPayment({ paymentMethod: 'Online UPI' }), true);
    assert.strictEqual(isOnlineOrderPayment({ paymentMethod: 'Prepaid Card' }), true);

    // Cash on Delivery
    assert.strictEqual(isOnlineOrderPayment({ paymentMethod: 'COD', total: 350 }), false);
    assert.strictEqual(isOnlineOrderPayment({ paymentMethod: 'Cash', total: 500 }), false);
    assert.strictEqual(isOnlineOrderPayment(null), false);
  });

  test('2. sanitizeCsvCell neutralizes CSV Formula Injection (CWE-1236)', async () => {
    const { sanitizeCsvCell } = await import('../owner.js');
    assert.strictEqual(typeof sanitizeCsvCell, 'function', 'sanitizeCsvCell should be exported from owner.js');

    // Phone numbers starting with +91
    const safePhone = sanitizeCsvCell('+91 98450 12345');
    assert.strictEqual(safePhone, "\"'+" + "91 98450 12345\"");

    // Malicious formula execution payloads
    assert.strictEqual(sanitizeCsvCell("=cmd|' /C calc'!A0"), "\"'=cmd|' /C calc'!A0\"");
    assert.strictEqual(sanitizeCsvCell('-5+2'), "\"'-5+2\"");
    assert.strictEqual(sanitizeCsvCell('@SUM(1+1)'), "\"'@SUM(1+1)\"");
    assert.strictEqual(sanitizeCsvCell('\tcalc'), "\"'\tcalc\"");

    // Safe strings and quotes
    assert.strictEqual(sanitizeCsvCell('Chicken Biryani'), '"Chicken Biryani"');
    assert.strictEqual(sanitizeCsvCell('Customer "Bob"'), '"Customer ""Bob"""');
    assert.strictEqual(sanitizeCsvCell(450), '"450"');
    assert.strictEqual(sanitizeCsvCell(null), '""');
  });

  test('3. Dynamic cash settlement captures mid-handover deliveries and guards clock drift', async () => {
    const testPin = '7711';
    dataService.saveOrUpdateRider({
      pin: testPin,
      name: 'Test Settlement Rider',
      phone: '9845011111',
      vehicle: '🏍️ Bike',
      cashSettledAt: 0
    });

    // Add initial COD delivery of ₹400
    const now = Date.now();
    const order1 = {
      id: 'ord_settle_1',
      total: 400,
      paymentMethod: 'COD',
      status: 'delivered',
      assignedRiderPin: testPin,
      deliveredAt: now - 60000
    };

    const orders = dataService.getOrders();
    orders.push(order1);
    dataService.saveOrders(orders);

    // Rider requests handover with ₹400
    dataService.requestRiderCashHandover(testPin);
    const riderAfterRequest = dataService.getRiderByPin(testPin);
    assert.strictEqual(riderAfterRequest.cashHandoverAmount, 400);

    // Mid-handover: Rider completes ANOTHER COD delivery of ₹350
    // Phone clock is slightly ahead (+5000ms)
    const order2 = {
      id: 'ord_settle_2',
      total: 350,
      paymentMethod: 'COD',
      status: 'delivered',
      assignedRiderPin: testPin,
      deliveredAt: now + 5000
    };
    orders.push(order2);
    dataService.saveOrders(orders);

    // Cash in hand is now ₹750, even though handover request was ₹400
    const summaryBeforeConfirm = dataService.getRiderCashSummary(testPin);
    assert.strictEqual(summaryBeforeConfirm.cashInHand, 750);

    // Owner confirms cash taken
    const result = dataService.confirmRiderCashTaken(testPin);
    assert.strictEqual(result.success, true);
    // Dynamic reconciliation must capture Math.max(400, 750) = 750
    assert.strictEqual(result.amount, 750);

    // Clock drift guard: settledAt must be > order2.deliveredAt (now + 5000)
    assert.ok(result.settledAt > order2.deliveredAt, `settledAt (${result.settledAt}) must exceed deliveredAt (${order2.deliveredAt})`);

    // Cash in hand after settlement must be strictly 0
    const summaryAfter = dataService.getRiderCashSummary(testPin);
    assert.strictEqual(summaryAfter.cashInHand, 0);

    // settleRiderCash delegates to confirmRiderCashTaken
    const delegateRes = dataService.settleRiderCash(testPin);
    assert.strictEqual(delegateRes.success, true);
  });

  test('4. Rider PIN regeneration preserves rider profile and updates order references', async () => {
    const origPin = '5566';
    const newPin = '5577';

    dataService.saveOrUpdateRider({
      pin: origPin,
      name: 'Fahad Khan',
      phone: '9845099999',
      vehicle: '🛵 Scooter',
      cashSettledAt: 1234567890
    });

    const orders = dataService.getOrders();
    orders.push({
      id: 'ord_rider_reassign',
      total: 250,
      status: 'delivered',
      assignedRiderPin: origPin,
      assignedRiderName: 'Fahad Khan'
    });
    dataService.saveOrders(orders);

    // Reassignment logic: preserve existing properties and update order references
    const existing = dataService.getRiderByPin(origPin);
    const updated = {
      ...existing,
      pin: newPin,
      name: 'Fahad Khan',
      phone: '9845099999',
      vehicle: '🛵 Scooter'
    };

    const allOrders = dataService.getOrders();
    allOrders.forEach(o => {
      if (o && String(o.assignedRiderPin) === String(origPin)) {
        o.assignedRiderPin = newPin;
      }
    });
    dataService.saveOrders(allOrders);
    dataService.deleteRider(origPin);
    dataService.saveOrUpdateRider(updated);

    // Old PIN deleted
    assert.strictEqual(dataService.getRiderByPin(origPin), null);

    // New PIN created with preserved metadata
    const newRider = dataService.getRiderByPin(newPin);
    assert.ok(newRider);
    assert.strictEqual(newRider.pin, newPin);
    assert.strictEqual(newRider.cashSettledAt, 1234567890);

    // Order points to new PIN
    const updatedOrder = dataService.getOrders().find(o => o.id === 'ord_rider_reassign');
    assert.strictEqual(updatedOrder.assignedRiderPin, newPin);
  });

  test('5. Cashfree Payout idempotency and transferId validation', async () => {
    const { default: handler } = await import('../api/cashfree-payout.js');
    const { createAdminToken } = await import('../api/_auth.js');

    const ownerToken = createAdminToken(undefined, 'owner');

    const req = {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ownerToken}`
      },
      body: {
        riderPin: '1122',
        transferId: 'payout_1122_20261103_45000',
        amount: 450,
        phone: '9845012345',
        name: 'Salman Khan'
      }
    };

    let statusCode = 0;
    let jsonResult = null;
    const res = {
      setHeader: () => {},
      status: (code) => {
        statusCode = code;
        return {
          json: (data) => {
            jsonResult = data;
            return data;
          }
        };
      }
    };

    await handler(req, res);
    assert.strictEqual(statusCode, 200);
    assert.strictEqual(jsonResult.success, true);
    assert.strictEqual(jsonResult.transferId, 'payout_1122_20261103_45000');
  });

  test('6. Cashfree webhook handles TRANSFER_* payout events', async () => {
    const { default: webhookHandler } = await import('../api/cashfree-webhook.js');

    const req = {
      method: 'POST',
      headers: {
        'x-webhook-signature': 'mock-sig'
      },
      body: {
        type: 'TRANSFER_SUCCESS',
        data: {
          transfer_id: 'payout_1122_20261103_45000',
          status: 'SUCCESS',
          utr: 'UTR9988776655',
          transfer_amount: 450
        }
      }
    };

    let statusCode = 0;
    let jsonResult = null;
    const res = {
      setHeader: () => {},
      status: (code) => {
        statusCode = code;
        return {
          json: (data) => {
            jsonResult = data;
            return data;
          }
        };
      }
    };

    await webhookHandler(req, res);
    assert.strictEqual(statusCode, 200);
    assert.strictEqual(jsonResult.success, true);
    assert.strictEqual(jsonResult.transferId, 'payout_1122_20261103_45000');
    assert.strictEqual(jsonResult.status, 'SUCCESS');
  });

  test('7. ensureAdminToken in securityUtils does not leak hardcoded 9900/8899 credentials', async () => {
    const secCode = fs.readFileSync(path.join(rootDir, 'securityUtils.js'), 'utf8');
    assert.ok(!secCode.includes("pin: isStaffSessionActive('owner') ? '9900' : '8899'"),
      'securityUtils.js must not contain hardcoded default PIN fallback in fetch body');
  });

  test('8. owner.html contains the Counter Cash Drawer Summary card in view-overview', () => {
    const ownerHtml = fs.readFileSync(path.join(rootDir, 'owner.html'), 'utf8');
    assert.ok(ownerHtml.includes('id="owner-drawer-summary-card"'), 'owner.html must contain #owner-drawer-summary-card');
    assert.ok(ownerHtml.includes('id="drawer-cod-total"'), 'owner.html must contain #drawer-cod-total');
    assert.ok(ownerHtml.includes('id="drawer-payout-total"'), 'owner.html must contain #drawer-payout-total');
    assert.ok(ownerHtml.includes('id="drawer-net-total"'), 'owner.html must contain #drawer-net-total');
    assert.ok(ownerHtml.includes('id="drawer-net-sub-total"'), 'owner.html must contain #drawer-net-sub-total');
  });

});
