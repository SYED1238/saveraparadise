import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataService } from '../dataService.js';
import { createAdminToken } from '../api/_auth.js';
import { createAdminToken as createCloudflareAdminToken } from '../functions/api/_auth.js';
import adminStoreHandler from '../api/admin-store.js';
import { onRequest as cloudflareAdminStoreHandler } from '../functions/api/admin-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function createMockReqRes({ method = 'POST', headers = {}, body = null, url = '/api/admin-store' } = {}) {
  let statusCode = 200;
  let responseData = null;
  const responseHeaders = {};
  const req = { method, url, query: {}, headers: { ...headers }, body };
  const res = {
    status(code) { statusCode = code; return this; },
    setHeader(k, v) { responseHeaders[k] = v; return this; },
    json(d) { responseData = d; return this; },
    end() { return this; },
    get statusCode() { return statusCode; },
    get responseData() { return responseData; }
  };
  return { req, res };
}

test('RIDER PAYOUT CARRY-FORWARD, FULL RETURN COMPENSATION & ADMIN-STORE PARITY SUITE', async (t) => {
  const storage = new Map();
  const mockLocalStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
    clear: () => storage.clear()
  };

  t.beforeEach(() => {
    globalThis.localStorage = mockLocalStorage;
    mockLocalStorage.clear();
  });

  await t.test('1. Unpaid prior-day orders carry forward past 1:00 AM until Owner settles', () => {
    dataService.saveRiders([
      { pin: '4321', name: 'Hameed', phone: '9876543210', status: 'online', payoutPaidAt: null, payoutAmountPaid: 0, cashSettledAt: null }
    ]);
    dataService.savePayoutConfig({
      activeMethod: 'tiered_standard',
      tieredStandard: { basePay: 30, baseKm: 2, extraKmRate: 15 },
      undeliveredCompensation: { mode: 'full', customAmount: 20 }
    });

    const shiftStartMs = dataService.getShiftStartTimeMs();
    const yesterdayTs = shiftStartMs - (6 * 60 * 60 * 1000);
    const twoDaysAgoTs = shiftStartMs - (30 * 60 * 60 * 1000);

    dataService.saveOrders([
      {
        id: '#QB-9101',
        status: 'delivered',
        assignedRiderPin: '4321',
        paymentMethod: 'Online',
        total: '₹250',
        distanceKm: 4, // 30 + (4 - 2) * 15 = 60
        deliveredAt: twoDaysAgoTs,
        createdAt: twoDaysAgoTs - 900000
      },
      {
        id: '#QB-9102',
        status: 'delivered',
        assignedRiderPin: '4321',
        paymentMethod: 'Cash on Delivery (COD)',
        total: '₹300',
        distanceKm: 4, // 30 + (4 - 2) * 15 = 60
        deliveredAt: yesterdayTs,
        createdAt: yesterdayTs - 900000
      }
    ], { silent: true });

    const summary = dataService.getRiderPayoutSummary('4321');
    assert.equal(summary.hasUnpaidPriorShift, true, 'Must flag unpaid prior shift orders');
    assert.equal(summary.priorUnpaidCount, 2, 'Both prior-day trips must carry forward');
    assert.equal(summary.priorUnpaidBalance, 120);
    assert.equal(summary.payoutBalance, 120, 'Unpaid balance must not vanish after 1:00 AM rollover');
    assert.equal(summary.deliveredCount, 2);
    assert.equal(summary.todayDeliveredCount, 0);
    assert.equal(summary.isPaidToday, false);
  });

  await t.test('2. Tiered milestone order counts reset per operational shift while accumulating unpaid balance', () => {
    dataService.saveRiders([
      { pin: '4321', name: 'Hameed', status: 'online', payoutPaidAt: null, payoutAmountPaid: 0 }
    ]);
    dataService.savePayoutConfig({
      activeMethod: 'tiered_milestone',
      tieredMilestone: { basePay: 30, baseKm: 2, extraKmRate: 10, milestoneOrders: 2, surgeExtraKmRate: 20 },
      undeliveredCompensation: { mode: 'zero', customAmount: 20 }
    });

    const shiftStartMs = dataService.getShiftStartTimeMs();
    const yesterdayBase = shiftStartMs - (8 * 60 * 60 * 1000);
    const todayTs = shiftStartMs + (2 * 60 * 60 * 1000);

    dataService.saveOrders([
      {
        id: '#QB-9201',
        status: 'delivered',
        assignedRiderPin: '4321',
        distanceKm: 4, // Yesterday order #1 -> 30 + 2*10 = 50
        deliveredAt: yesterdayBase,
        createdAt: yesterdayBase - 600000
      },
      {
        id: '#QB-9202',
        status: 'delivered',
        assignedRiderPin: '4321',
        distanceKm: 4, // Yesterday order #2 -> 30 + 2*10 = 50
        deliveredAt: yesterdayBase + 1800000,
        createdAt: yesterdayBase + 1200000
      },
      {
        id: '#QB-9203',
        status: 'delivered',
        assignedRiderPin: '4321',
        distanceKm: 4, // Today order #1 -> resets shift index so still 30 + 2*10 = 50 (not surged)
        deliveredAt: todayTs,
        createdAt: todayTs - 600000
      }
    ], { silent: true });

    const summary = dataService.getRiderPayoutSummary('4321');
    assert.equal(summary.priorUnpaidCount, 2);
    assert.equal(summary.priorUnpaidBalance, 100);
    assert.equal(summary.todayDeliveredCount, 1);
    assert.equal(summary.payoutBalance, 150);
    assert.equal(summary.deliveredCount, 3);
  });

  await t.test('3. Customer-refused / returned (undelivered) order pays 100% in full mode with ₹0 COD cash liability', () => {
    dataService.saveRiders([
      { pin: '4321', name: 'Hameed', status: 'online', payoutPaidAt: null, cashSettledAt: null }
    ]);
    dataService.savePayoutConfig({
      activeMethod: 'tiered_standard',
      tieredStandard: { basePay: 30, baseKm: 2, extraKmRate: 15 },
      undeliveredCompensation: { mode: 'full', customAmount: 20 }
    });

    const shiftStartMs = dataService.getShiftStartTimeMs();
    const orderTs = shiftStartMs - (4 * 60 * 60 * 1000); // Carried from yesterday

    dataService.saveOrders([
      {
        id: '#QB-8027',
        status: 'undelivered',
        assignedRiderPin: '4321',
        paymentMethod: 'Cash on Delivery (COD)',
        total: '₹520',
        distanceKm: 5, // 30 + (5 - 2) * 15 = 75 full trip pay
        undeliveredAt: orderTs,
        updatedAt: orderTs,
        createdAt: orderTs - 1200000,
        cashCollected: 0,
        returnToKitchen: true
      }
    ], { silent: true });

    const payoutSummary = dataService.getRiderPayoutSummary('4321');
    assert.equal(payoutSummary.undeliveredCount, 1);
    assert.equal(payoutSummary.payoutBalance, 75, 'Full mode must award 100% of trip delivery pay');
    assert.equal(payoutSummary.hasUnpaidPriorShift, true);

    const cashSummary = dataService.getRiderCashSummary('4321');
    assert.equal(cashSummary.cashInHand, 0, 'Returned/undelivered order must hold ₹0 COD cash against rider');
  });

  await t.test('4. markRiderPayoutPaid and confirmRiderCashTaken guard clock drift and track post-settle orders', async () => {
    dataService.saveRiders([
      { pin: '4321', name: 'Hameed', status: 'online', payoutPaidAt: null, payoutAmountPaid: 0, cashSettledAt: null }
    ]);
    dataService.savePayoutConfig({
      activeMethod: 'tiered_standard',
      tieredStandard: { basePay: 30, baseKm: 2, extraKmRate: 15 },
      undeliveredCompensation: { mode: 'full', customAmount: 20 }
    });

    const skewedFutureTs = Date.now() + 90_000;
    dataService.saveOrders([
      {
        id: '#QB-9301',
        status: 'delivered',
        assignedRiderPin: '4321',
        paymentMethod: 'Cash on Delivery (COD)',
        total: '₹240',
        distanceKm: 4, // 60 payout
        deliveredAt: skewedFutureTs,
        createdAt: skewedFutureTs - 600000
      }
    ], { silent: true });

    const cashRes = dataService.confirmRiderCashTaken('4321');
    assert.equal(cashRes.success, true);
    if (cashRes.serverPromise) await cashRes.serverPromise.catch(() => {});
    const updatedCashRider = dataService.getRiders().find(r => r.pin === '4321');
    assert.ok(Number(updatedCashRider.cashSettledAt) > skewedFutureTs, 'cashSettledAt must advance past skewed order timestamp');
    assert.equal(dataService.getRiderCashSummary('4321').cashInHand, 0);

    const payRes = dataService.markRiderPayoutPaid('4321', '');
    assert.equal(payRes.success, true);
    if (payRes.serverPromise) await payRes.serverPromise.catch(() => {});
    const updatedPayRider = dataService.getRiders().find(r => r.pin === '4321');
    assert.ok(Number(updatedPayRider.payoutPaidAt) > skewedFutureTs, 'payoutPaidAt must advance past skewed order timestamp');
    assert.equal(updatedPayRider.payoutAmountPaid, 60);

    const summarySettled = dataService.getRiderPayoutSummary('4321');
    assert.equal(summarySettled.payoutBalance, 0);
    assert.equal(summarySettled.hasUnpaidPriorShift, false);
    assert.equal(summarySettled.isPaidToday, true);

    // Subsequent delivery after settlement accrues freshly without losing earlier paid status
    const postSettleTs = Number(updatedPayRider.payoutPaidAt) + 5000;
    const curOrders = dataService.getOrders();
    curOrders.push({
      id: '#QB-9302',
      status: 'delivered',
      assignedRiderPin: '4321',
      paymentMethod: 'Online',
      total: '₹190',
      deliveryDistanceKm: 2, // 30 payout
      deliveredAt: postSettleTs,
      createdAt: postSettleTs - 300000
    });
    dataService.saveOrders(curOrders, { silent: true });

    const summaryNext = dataService.getRiderPayoutSummary('4321');
    assert.equal(summaryNext.payoutBalance, 30);
    assert.equal(summaryNext.isPaidToday, true);
  });

  await t.test('5. Dual-API save_settings preserves Owner payoutConfig when Kitchen Admin saves partial/stale settings', async () => {
    const origUrl = process.env.SUPABASE_URL;
    const origKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const origFetch = globalThis.fetch;

    const existingOwnerSettings = {
      storeOpen: true,
      returnStockEveryDay: false,
      kmPayoutRate: 15,
      payoutConfig: {
        method: 'tiered_standard',
        tieredStandard: { basePay: 30, baseKm: 2, extraKmRate: 15 },
        undeliveredCompensation: { mode: 'full', customAmount: 20 }
      }
    };

    const upsertedPayloads = [];
    process.env.SUPABASE_URL = 'https://mock-sb.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key';

    globalThis.fetch = async (url, init = {}) => {
      const urlStr = String(url);
      if (urlStr.includes('/rest/v1/store_settings')) {
        const method = String(init.method || 'GET').toUpperCase();
        if (method === 'GET') {
          return new Response(JSON.stringify({ settings: existingOwnerSettings }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
          const parsed = JSON.parse(init.body || '[]');
          upsertedPayloads.push(parsed);
          return new Response(JSON.stringify(parsed), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
      if (urlStr.includes('/rest/v1/riders')) {
        const parsed = JSON.parse(init.body || '{}');
        upsertedPayloads.push({ riderPatch: parsed });
        return new Response(JSON.stringify([{ pin: '4321', ...parsed }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    try {
      const adminToken = createAdminToken('admin');
      const ownerToken = createAdminToken('owner');
      const cfAdminToken = createCloudflareAdminToken('admin', process.env);
      const cfOwnerToken = createCloudflareAdminToken('owner', process.env);

      // 5a. Node API: Admin saves returnStockEveryDay WITHOUT payoutConfig and with stale kmPayoutRate
      const { req: adminReq, res: adminRes } = createMockReqRes({
        method: 'POST',
        headers: { authorization: `Bearer ${adminToken}` },
        body: {
          action: 'save_settings',
          settings: { storeOpen: true, returnStockEveryDay: true, kmPayoutRate: 10 }
        }
      });
      await adminStoreHandler(adminReq, adminRes);
      assert.equal(adminRes.statusCode, 200);
      const nodeSaved = upsertedPayloads.pop()[0].settings;
      assert.equal(nodeSaved.returnStockEveryDay, true);
      assert.deepEqual(nodeSaved.payoutConfig, existingOwnerSettings.payoutConfig, 'Node API must preserve Owner payoutConfig on Admin save');
      assert.equal(nodeSaved.kmPayoutRate, 15, 'Node API must preserve Owner kmPayoutRate on Admin save');

      // 5b. Cloudflare Pages API: Admin save must behave identically
      const cfAdminReq = new Request('https://saveraparadise.com/api/admin-store', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${cfAdminToken}`
        },
        body: JSON.stringify({
          action: 'save_settings',
          settings: { storeOpen: false, returnStockEveryDay: true, kmPayoutRate: 10 }
        })
      });
      const cfAdminResp = await cloudflareAdminStoreHandler({ request: cfAdminReq, env: process.env });
      assert.equal(cfAdminResp.status, 200);
      const cfSaved = upsertedPayloads.pop()[0].settings;
      assert.equal(cfSaved.storeOpen, false);
      assert.deepEqual(cfSaved.payoutConfig, existingOwnerSettings.payoutConfig, 'CF Pages API must preserve Owner payoutConfig on Admin save');
      assert.equal(cfSaved.kmPayoutRate, 15, 'CF Pages API must preserve Owner kmPayoutRate on Admin save');

      // 5c. Owner role CAN update payoutConfig cleanly
      const newOwnerConfig = {
        activeMethod: 'tiered_standard',
        tieredStandard: { basePay: 35, baseKm: 2, extraKmRate: 18 },
        undeliveredCompensation: { mode: 'full', customAmount: 20 }
      };
      const cfOwnerReq = new Request('https://saveraparadise.com/api/admin-store', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${cfOwnerToken}`
        },
        body: JSON.stringify({
          action: 'save_settings',
          settings: { storeOpen: true, kmPayoutRate: 18, payoutConfig: newOwnerConfig }
        })
      });
      const cfOwnerResp = await cloudflareAdminStoreHandler({ request: cfOwnerReq, env: process.env });
      assert.equal(cfOwnerResp.status, 200);
      const cfOwnerSaved = upsertedPayloads.pop()[0].settings;
      assert.deepEqual(cfOwnerSaved.payoutConfig, newOwnerConfig, 'Owner role must update payoutConfig');
      assert.equal(cfOwnerSaved.kmPayoutRate, 18);

      // 5d. settle_rider_cash & record_rider_payout never overwrite riders.status
      const { req: settleReq, res: settleRes } = createMockReqRes({
        method: 'POST',
        headers: { authorization: `Bearer ${ownerToken}` },
        body: { action: 'settle_rider_cash', riderPin: '4321', settledAt: 1795000000000 }
      });
      await adminStoreHandler(settleReq, settleRes);
      assert.equal(settleRes.statusCode, 200);
      const cashPatch = upsertedPayloads.pop().riderPatch;
      assert.equal(cashPatch.cash_settled_at, 1795000000000);
      assert.equal(cashPatch.status, undefined, 'settle_rider_cash must not touch riders.status');

      const cfPayReq = new Request('https://saveraparadise.com/api/admin-store', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${cfOwnerToken}`
        },
        body: JSON.stringify({ action: 'record_rider_payout', riderPin: '4321', paidAt: 1795000005000, amount: 180 })
      });
      const cfPayResp = await cloudflareAdminStoreHandler({ request: cfPayReq, env: process.env });
      assert.equal(cfPayResp.status, 200);
      const payPatch = upsertedPayloads.pop().riderPatch;
      assert.equal(payPatch.payout_paid_at, 1795000005000);
      assert.equal(payPatch.payout_amount_paid, 180);
      assert.equal(payPatch.status, undefined, 'record_rider_payout must not touch riders.status');
    } finally {
      globalThis.fetch = origFetch;
      if (origUrl === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = origUrl;
      if (origKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = origKey;
    }
  });

  await t.test('6. Owner & Rider UI source contains full return option, settledLater check, and error recovery', () => {
    const ownerHtml = fs.readFileSync(path.resolve(rootDir, 'owner.html'), 'utf8');
    const ownerJs = fs.readFileSync(path.resolve(rootDir, 'owner.js'), 'utf8');
    const deliveryJs = fs.readFileSync(path.resolve(rootDir, 'delivery.js'), 'utf8');

    assert.match(ownerHtml, /<option value="full">/, 'owner.html must expose full 100% returned compensation option');
    assert.match(ownerJs, /const\s+settledLater\s*=/, 'owner.js historical view must track settlements made on a later day');
    assert.match(ownerJs, /hasUnpaidPriorShift/, 'owner.js must surface prior-shift unpaid payouts');
    assert.match(ownerJs, /res\.serverPromise\.catch/, 'owner.js must surface server errors if cash/payout persistence fails');
    assert.match(ownerJs, /prevCashSnapshot/, 'owner.js must roll back optimistic cash settlement if server rejects');
    assert.match(ownerJs, /prevPayoutSnapshot/, 'owner.js must roll back optimistic payout settlement if server rejects');
    assert.match(deliveryJs, /priorUnpaidCount/, 'delivery.js payout modal must note carried-forward unpaid trips');
    assert.match(deliveryJs, /summary\.isPaidToday\s*&&\s*summary\.payoutBalance\s*>\s*0/, 'delivery.js hero badge must show due balance when new orders accrue after settlement');
    assert.match(deliveryJs, /todayDeliveredCount/, 'delivery.js milestone badge must use current shift delivered count');
  });
});
