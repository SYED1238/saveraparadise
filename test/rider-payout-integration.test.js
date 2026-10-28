import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataService } from '../dataService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Helper to mock localStorage in Node.js
function setupMockStorage() {
  const store = new Map();
  global.localStorage = {
    getItem: (key) => store.get(String(key)) ?? null,
    setItem: (key, val) => store.set(String(key), String(val)),
    removeItem: (key) => store.delete(String(key)),
    clear: () => store.clear(),
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; }
  };
  global.sessionStorage = {
    getItem: (key) => store.get('sess_' + String(key)) ?? null,
    setItem: (key, val) => store.set('sess_' + String(key), String(val)),
    removeItem: (key) => store.delete('sess_' + String(key)),
    clear: () => {}
  };
}

describe('RIDER PORTAL PAYOUT & BALANCE INTEGRATION SUITE', () => {
  beforeEach(() => {
    setupMockStorage();

    // Seed mock riders
    const testRiders = [
      { id: 'r1', pin: '2233', name: 'Rider Ramesh', phone: '9876543210', vehicle: '🏍️ Honda Activa' },
      { id: 'r2', pin: '4422', name: 'Rider Suresh', phone: '9876543211', vehicle: '🏍️ TVS Jupiter' }
    ];
    dataService.saveRiders(testRiders);
    dataService.setActiveRiderPin('2233');

    // Default configuration (Tiered Standard: ₹25 base 1.0km + ₹10/km)
    dataService.savePayoutConfig({
      activeMethod: 'tiered_standard',
      tieredStandard: { basePay: 25, baseKm: 1.0, extraKmRate: 10 },
      tieredMilestone: { basePay: 25, baseKm: 1.0, extraKmRate: 10, milestoneOrders: 10, surgeExtraKmRate: 15 },
      flatLinear: { ratePerKm: 30 }
    });
  });

  test('1. Initial login: getRiderPayoutSummary returns zero balance before any deliveries', () => {
    const summary = dataService.getRiderPayoutSummary('2233');
    assert.ok(summary);
    assert.equal(summary.rider.name, 'Rider Ramesh');
    assert.equal(summary.payoutBalance, 0);
    assert.equal(summary.totalEarnings, 0);
    assert.equal(summary.deliveredCount, 0);
    assert.equal(summary.totalKms, 0);
    assert.equal(summary.isPaidToday, false);
    assert.equal(summary.method, 'tiered_standard');
  });

  test('2. Marking an order delivered immediately credits payout to rider balance (Tiered Standard)', () => {
    const order1 = {
      id: '#QB-101',
      status: 'on_the_way',
      assignedRiderPin: '2233',
      assignedRiderName: 'Rider Ramesh',
      addressDetails: { distanceKm: 1.31 },
      total: '₹280',
      createdAt: Date.now() - 300000
    };
    dataService.saveOrders([order1]);

    // Order payout before delivery
    const payoutObj = dataService.calculateOrderPayout(order1, 1);
    assert.equal(payoutObj.amount, 28.10); // ₹25 + 0.31 * 10

    // Transition order to delivered
    dataService.updateOrderStatus('#QB-101', 'delivered', 'rider', {
      assignedRiderPin: '2233',
      assignedRiderName: 'Rider Ramesh',
      deliveredAt: Date.now(),
      riderPayoutAmount: payoutObj.amount,
      riderPayoutFormula: payoutObj.formula
    });

    // Payout summary should now reflect exactly ₹28.10 credited to balance
    const summaryAfter = dataService.getRiderPayoutSummary('2233');
    assert.equal(summaryAfter.deliveredCount, 1);
    assert.equal(summaryAfter.totalKms, 1.31);
    assert.equal(summaryAfter.exactEarnings, 28.10);
    assert.equal(summaryAfter.exactBalance, 28.10);
    assert.equal(summaryAfter.payoutBalance, 28.10);
  });

  test('3. Delivering multiple orders accumulates balance and distance', () => {
    const order1 = {
      id: '#QB-101',
      status: 'delivered',
      assignedRiderPin: '2233',
      assignedRiderName: 'Rider Ramesh',
      addressDetails: { distanceKm: 1.0 }, // ₹25.00
      total: '₹200',
      deliveredAt: Date.now() - 60000
    };
    const order2 = {
      id: '#QB-102',
      status: 'delivered',
      assignedRiderPin: '2233',
      assignedRiderName: 'Rider Ramesh',
      addressDetails: { distanceKm: 2.0 }, // ₹25 + (1.0 * 10) = ₹35.00
      total: '₹350',
      deliveredAt: Date.now()
    };
    dataService.saveOrders([order1, order2]);

    const summary = dataService.getRiderPayoutSummary('2233');
    assert.equal(summary.deliveredCount, 2);
    assert.equal(summary.totalKms, 3.0);
    // ₹25 + ₹35 = ₹60.00
    assert.equal(summary.totalEarnings, 60);
    assert.equal(summary.payoutBalance, 60);
  });

  test('4. Tiered + Milestone Volume Incentive surges distance pay on order 11+', () => {
    dataService.savePayoutConfig({
      activeMethod: 'tiered_milestone',
      tieredStandard: { basePay: 25, baseKm: 1.0, extraKmRate: 10 },
      tieredMilestone: { basePay: 25, baseKm: 1.0, extraKmRate: 10, milestoneOrders: 10, surgeExtraKmRate: 15 },
      flatLinear: { ratePerKm: 30 }
    });

    // Create 11 delivered orders for rider Ramesh
    const orders = [];
    for (let i = 1; i <= 11; i++) {
      orders.push({
        id: `#QB-M${i}`,
        status: 'delivered',
        assignedRiderPin: '2233',
        assignedRiderName: 'Rider Ramesh',
        addressDetails: { distanceKm: 1.31 },
        deliveredAt: Date.now() + (i * 1000)
      });
    }
    dataService.saveOrders(orders);

    const summary = dataService.getRiderPayoutSummary('2233');
    assert.equal(summary.deliveredCount, 11);
    assert.equal(summary.surgeCount, 1); // 11th order is surge

    // Orders 1-10: 10 * ₹28.10 = ₹281.00
    // Order 11 (surge): ₹25 + (0.31 * 15) = ₹29.65
    // Total exact: 281.00 + 29.65 = 310.65
    assert.equal(summary.exactEarnings, 310.65);
    assert.equal(summary.exactBalance, 310.65);
  });

  test('5. Flat Linear Rate pays pure distance without base fare', () => {
    dataService.savePayoutConfig({
      activeMethod: 'flat_linear',
      tieredStandard: { basePay: 25, baseKm: 1.0, extraKmRate: 10 },
      tieredMilestone: { basePay: 25, baseKm: 1.0, extraKmRate: 10, milestoneOrders: 10, surgeExtraKmRate: 15 },
      flatLinear: { ratePerKm: 30 }
    });

    const order = {
      id: '#QB-FL1',
      status: 'delivered',
      assignedRiderPin: '2233',
      assignedRiderName: 'Rider Ramesh',
      addressDetails: { distanceKm: 1.31 },
      deliveredAt: Date.now()
    };
    dataService.saveOrders([order]);

    const summary = dataService.getRiderPayoutSummary('2233');
    // 1.31 * 30 = 39.30
    assert.equal(summary.exactEarnings, 39.30);
    assert.equal(summary.exactBalance, 39.30);
    assert.equal(summary.method, 'flat_linear');
  });

  test('6. When owner marks rider payout as paid, balance updates accordingly', () => {
    const order = {
      id: '#QB-SETTLE1',
      status: 'delivered',
      assignedRiderPin: '2233',
      assignedRiderName: 'Rider Ramesh',
      addressDetails: { distanceKm: 1.31 },
      deliveredAt: Date.now()
    };
    dataService.saveOrders([order]);

    // Total earnings is 28.10 (round 28)
    const initialSummary = dataService.getRiderPayoutSummary('2233');
    assert.equal(initialSummary.isPaidToday, false);
    assert.equal(initialSummary.totalEarnings, 28);

    // Owner marks payout paid
    dataService.markRiderPayoutPaid('2233', 28);

    const afterPaid = dataService.getRiderPayoutSummary('2233');
    assert.equal(afterPaid.isPaidToday, true);
    assert.equal(afterPaid.paidAmount, 28);
    assert.equal(afterPaid.payoutBalance, 0); // Unpaid balance is now 0!
  });

  test('7. HTML structure verification: delivery.html contains all payout elements', () => {
    const html = fs.readFileSync(path.join(rootDir, 'delivery.html'), 'utf-8');

    // Top Header Payout Pill
    assert.ok(html.includes('id="btn-rider-payout-summary"'), 'Must have #btn-rider-payout-summary');
    assert.ok(html.includes('id="top-payout-amount"'), 'Must have #top-payout-amount');

    // Hero Earnings & Compensation Strip
    assert.ok(html.includes('id="rider-earnings-strip"'), 'Must have #rider-earnings-strip');
    assert.ok(html.includes('id="hero-payout-amount"'), 'Must have #hero-payout-amount');
    assert.ok(html.includes('id="hero-payout-status"'), 'Must have #hero-payout-status');
    assert.ok(html.includes('id="hero-payout-kms"'), 'Must have #hero-payout-kms');
    assert.ok(html.includes('id="hero-delivery-count"'), 'Must have #hero-delivery-count');
    assert.ok(html.includes('id="hero-model-pill"'), 'Must have #hero-model-pill');
    assert.ok(html.includes('id="hero-model-title"'), 'Must have #hero-model-title');
    assert.ok(html.includes('id="hero-model-formula"'), 'Must have #hero-model-formula');

    // Confirm Delivery Modal Payout Box
    assert.ok(html.includes('id="confirm-payout-box"'), 'Must have #confirm-payout-box');
    assert.ok(html.includes('id="confirm-payout-value"'), 'Must have #confirm-payout-value');
    assert.ok(html.includes('id="confirm-payout-sub"'), 'Must have #confirm-payout-sub');

    // Bag Preview Modal Payout Row
    assert.ok(html.includes('id="preview-payout-pill"'), 'Must have #preview-payout-pill');
    assert.ok(html.includes('id="preview-payout-formula"'), 'Must have #preview-payout-formula');

    // Shift Payout & Earnings Modal
    assert.ok(html.includes('id="modal-payout-summary-backdrop"'), 'Must have #modal-payout-summary-backdrop');
    assert.ok(html.includes('id="modal-payout-close"'), 'Must have #modal-payout-close');
    assert.ok(html.includes('id="modal-payout-large-total"'), 'Must have #modal-payout-large-total');
    assert.ok(html.includes('id="modal-scheme-title"'), 'Must have #modal-scheme-title');
    assert.ok(html.includes('id="modal-scheme-desc"'), 'Must have #modal-scheme-desc');
    assert.ok(html.includes('id="payout-orders-breakdown-list"'), 'Must have #payout-orders-breakdown-list');
  });

  test('8. Dedicated Earnings Navigation Tab & Section: delivery.html contains 4-button capsule and dedicated section', () => {
    const html = fs.readFileSync(path.join(rootDir, 'delivery.html'), 'utf-8');
    const js = fs.readFileSync(path.join(rootDir, 'delivery.js'), 'utf-8');

    // 4-Button Floating Capsule Navigation Bar
    assert.ok(html.includes('id="capsule-btn-ready"'), 'Must have #capsule-btn-ready');
    assert.ok(html.includes('data-tab="ready"'), 'Must have data-tab="ready"');
    assert.ok(html.includes('id="capsule-btn-active"'), 'Must have #capsule-btn-active');
    assert.ok(html.includes('data-tab="active"'), 'Must have data-tab="active"');
    assert.ok(html.includes('id="capsule-btn-delivered"'), 'Must have #capsule-btn-delivered');
    assert.ok(html.includes('data-tab="delivered"'), 'Must have data-tab="delivered"');
    assert.ok(html.includes('id="capsule-btn-earnings"'), 'Must have #capsule-btn-earnings');
    assert.ok(html.includes('data-tab="earnings"'), 'Must have data-tab="earnings"');
    assert.ok(html.includes('id="capsule-earnings-badge"'), 'Must have #capsule-earnings-badge');

    // Dedicated Earnings Section View
    assert.ok(html.includes('id="rider-earnings-section"'), 'Must have #rider-earnings-section');
    assert.ok(html.includes('class="rider-earnings-strip standalone-earnings-strip"'), 'Must have standalone-earnings-strip');
    assert.ok(html.includes('id="earnings-cash-card"'), 'Must have #earnings-cash-card');
    assert.ok(html.includes('id="earnings-cash-amount"'), 'Must have #earnings-cash-amount');
    assert.ok(html.includes('id="btn-earnings-handover"'), 'Must have #btn-earnings-handover');
    assert.ok(html.includes('id="earnings-trips-list"'), 'Must have #earnings-trips-list');
    assert.ok(html.includes('id="earnings-trips-count"'), 'Must have #earnings-trips-count');
    assert.ok(html.includes('id="btn-refresh-earnings"'), 'Must have #btn-refresh-earnings');

    // Verification: Hero Bar is clean and does NOT contain rider-earnings-strip
    const heroBarMatch = html.match(/<section class="rider-hero-bar">([\s\S]*?)<\/section>/);
    assert.ok(heroBarMatch, 'Must find rider-hero-bar section');
    assert.ok(!heroBarMatch[1].includes('rider-earnings-strip'), 'rider-hero-bar must NOT contain rider-earnings-strip');

    // Verification: delivery.js handles earnings tab persistence
    assert.ok(js.includes("saved === 'earnings'"), 'delivery.js must persist earnings tab');
  });

  test('9. Enter Parcel Number option is strictly and ONLY available on Pending tab', () => {
    const js = fs.readFileSync(path.join(rootDir, 'delivery.js'), 'utf-8');
    assert.ok(
      js.includes("parcelPickupBannerSec.style.display = (activeTab === 'ready') ? 'block' : 'none'"),
      'Parcel pickup banner must only be displayed when activeTab is ready (Pending)'
    );
  });
});
