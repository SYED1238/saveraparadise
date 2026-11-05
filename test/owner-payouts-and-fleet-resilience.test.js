import test from 'node:test';
import assert from 'node:assert/strict';

// Node environment localStorage mock
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(key) || null,
    setItem: (key, val) => store.set(key, String(val)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear()
  };
}

import { dataService, DEFAULT_PAYOUT_CONFIG } from '../dataService.js';
import { formatInr, getRiderInitial } from '../owner.js';

test('OWNER PAYOUTS & FLEET RESILIENCE SUITE', async (t) => {
  await t.test('1. getRiderInitial handles null, undefined, empty, and numeric names without throwing', () => {
    assert.equal(getRiderInitial('Salman Khan'), 'S');
    assert.equal(getRiderInitial(' imran'), 'I');
    assert.equal(getRiderInitial(null), 'R');
    assert.equal(getRiderInitial(undefined), 'R');
    assert.equal(getRiderInitial(''), 'R');
    assert.equal(getRiderInitial('   '), 'R');
    assert.equal(getRiderInitial(123), '1');
    assert.equal(getRiderInitial({}), 'R');
  });

  await t.test('2. formatInr formats numbers safely and handles null, undefined, and NaN gracefully', () => {
    assert.equal(formatInr(1250), '1,250');
    assert.equal(formatInr(0), '0');
    assert.equal(formatInr('3500'), '3,500');
    assert.equal(formatInr(null), '0');
    assert.equal(formatInr(undefined), '0');
    assert.equal(formatInr(NaN), '0');
    assert.equal(formatInr('abc'), '0');
  });

  await t.test('3. calculateOrderPayout and calculateRiderPayout handle null/empty config without crashing', () => {
    const mockOrder = {
      id: 'ord_test_1',
      addressDetails: { distanceKm: 2.5 }
    };

    // Even if config is null or has missing fields, it uses safe defaults
    const singleRes = dataService.calculateOrderPayout(mockOrder, 1, null);
    assert.ok(singleRes.amount > 0);
    assert.equal(singleRes.distanceKm, 2.5);

    const emptyCfg = { activeMethod: 'tiered_milestone' }; // missing tieredMilestone object
    const brokenRes = dataService.calculateOrderPayout(mockOrder, 1, emptyCfg);
    assert.ok(brokenRes.amount > 0);

    const flatEmptyCfg = { activeMethod: 'flat_linear' }; // missing flatLinear object
    const flatRes = dataService.calculateOrderPayout(mockOrder, 1, flatEmptyCfg);
    assert.ok(flatRes.amount > 0);

    const riderPayoutRes = dataService.calculateRiderPayout([mockOrder, null, undefined], emptyCfg);
    assert.ok(riderPayoutRes.totalPayout > 0);
    assert.equal(riderPayoutRes.orderCount, 1);
  });

  await t.test('4. getRiderCashSummary and getRiderPayoutSummary survive malformed riders and orders', () => {
    const prevOrders = dataService.getOrders();
    dataService.saveOrders([
      {
        id: 'ord_malformed_1',
        status: 'delivered',
        total: 500,
        paymentMethod: 'COD',
        assignedRiderPin: '9988',
        assignedRiderName: 12345 // non-string name
      },
      {
        id: 'ord_malformed_2',
        status: 'delivered',
        total: 300,
        paymentMethod: 'COD',
        assignedRiderPin: null,
        assignedRiderName: null // null name
      }
    ]);

    const summary = dataService.getRiderCashSummary('9988');
    assert.ok(summary);
    assert.equal(typeof summary.cashInHand, 'number');

    const payoutSummary = dataService.getRiderPayoutSummary('9988');
    assert.ok(payoutSummary);
    assert.equal(typeof payoutSummary.totalEarnings, 'number');

    dataService.saveOrders(prevOrders);
  });

  await t.test('5. Simulation of 141 riders with edge-case profiles processes in milliseconds without crashing', () => {
    const largeFleet = [];
    for (let i = 1; i <= 141; i++) {
      largeFleet.push({
        pin: String(1000 + i),
        name: i % 10 === 0 ? null : (i % 7 === 0 ? '' : `Rider ${i}`),
        phone: i % 5 === 0 ? null : `9876543${String(i).padStart(3, '0')}`,
        vehicle: i % 3 === 0 ? '🛵 Scooter' : '🏍️ Bike',
        cashSettledAt: i % 4 === 0 ? new Date().toISOString() : null,
        payoutAmountPaid: i % 2 === 0 ? 150 : null
      });
    }

    const startTime = performance.now();
    const ordersByPin = new Map();
    const mockDelivered = [
      { id: 'o1', assignedRiderPin: '1005', status: 'delivered', addressDetails: { distanceKm: 2.1 } },
      { id: 'o2', assignedRiderPin: '1010', status: 'delivered', addressDetails: { distanceKm: 3.4 } }
    ];

    mockDelivered.forEach(o => {
      const pin = String(o.assignedRiderPin || '').trim();
      if (!ordersByPin.has(pin)) ordersByPin.set(pin, []);
      ordersByPin.get(pin).push(o);
    });

    const results = largeFleet.map(r => {
      const riderPin = String(r.pin || '').trim();
      const riderName = String(r.name || `Rider ${riderPin}`).trim();
      const initial = getRiderInitial(riderName);
      const orders = ordersByPin.get(riderPin) || [];
      const payoutRes = dataService.calculateRiderPayout(orders);
      const formattedPayout = formatInr(payoutRes.totalPayout);
      const formattedInitial = initial;
      return { riderPin, formattedInitial, formattedPayout };
    });

    const elapsed = performance.now() - startTime;
    assert.equal(results.length, 141);
    assert.ok(elapsed < 200, `Expected 141 riders calculation to complete under 200ms, took ${elapsed}ms`);
  });
});
