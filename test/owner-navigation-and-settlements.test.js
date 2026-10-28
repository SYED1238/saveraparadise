import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataService } from '../dataService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test.describe('OWNER NAVIGATION BAR & SETTLEMENTS INTEGRATION SUITE', () => {
  const storage = new Map();
  const mockLocalStorage = {
    getItem: (k) => storage.get(k) || null,
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
    clear: () => storage.clear()
  };

  test.beforeEach(() => {
    globalThis.localStorage = mockLocalStorage;
    mockLocalStorage.clear();
  });

  test('1. owner.html contains the 5-tab floating capsule navigation bar with badges', () => {
    const html = fs.readFileSync(path.join(rootDir, 'owner.html'), 'utf-8');
    assert.ok(html.includes('id="owner-floating-bar"'), 'Must contain #owner-floating-bar');
    assert.ok(html.includes('id="owner-nav-overview"'), 'Must contain Overview nav button');
    assert.ok(html.includes('id="owner-nav-orders"'), 'Must contain Live Orders nav button');
    assert.ok(html.includes('id="owner-nav-cash"'), 'Must contain Cash Settlement nav button');
    assert.ok(html.includes('id="owner-nav-payouts"'), 'Must contain KM Payouts nav button');
    assert.ok(html.includes('id="owner-nav-fleet"'), 'Must contain Delivery Fleet nav button');

    // Badges
    assert.ok(html.includes('id="nav-badge-orders"'), 'Must contain live orders badge');
    assert.ok(html.includes('id="nav-badge-cash"'), 'Must contain cash alert badge');
    assert.ok(html.includes('id="nav-badge-fleet"'), 'Must contain fleet badge');
  });

  test('2. owner.html defines the 5 distinct view containers', () => {
    const html = fs.readFileSync(path.join(rootDir, 'owner.html'), 'utf-8');
    assert.ok(html.includes('id="view-overview"'), 'Must contain #view-overview');
    assert.ok(html.includes('id="view-orders"'), 'Must contain #view-orders');
    assert.ok(html.includes('id="view-cash"'), 'Must contain #view-cash');
    assert.ok(html.includes('id="view-payouts"'), 'Must contain #view-payouts');
    assert.ok(html.includes('id="view-fleet"'), 'Must contain #view-fleet');
  });

  test('3. Cash Handover: Rider request flags pending approval, and Owner "Mark as Taken" settles into drawer', () => {
    const pin = '4411';
    dataService.saveOrUpdateRider({
      pin,
      name: 'Tanveer Ahmed',
      phone: '+91 97777 66666',
      vehicle: '🏍️ Bike'
    });

    // Add a delivered COD order
    const order = {
      id: '#QB-9911',
      status: 'delivered',
      assignedRiderPin: pin,
      paymentMethod: 'COD',
      total: '₹650',
      deliveredAt: Date.now()
    };
    dataService.saveOrders([order]);

    // 1. Rider requests cash handover
    const req = dataService.requestRiderCashHandover(pin);
    assert.equal(req.success, true);
    assert.equal(req.amount, 650);

    const riderPending = dataService.getRiderByPin(pin);
    assert.equal(riderPending.cashHandoverStatus, 'pending_owner_approval');
    assert.equal(riderPending.cashHandoverAmount, 650);

    // 2. Owner confirms cash taken
    const confirmed = dataService.confirmRiderCashTaken(pin);
    assert.equal(confirmed.success, true);
    assert.equal(confirmed.amount, 650);

    const riderSettled = dataService.getRiderByPin(pin);
    assert.equal(riderSettled.cashHandoverStatus, 'taken');
    assert.equal(riderSettled.cashHandoverAmount, 0);
    assert.ok(riderSettled.cashSettledAt > 0);

    // Check drawer audit log
    const auditRaw = mockLocalStorage.getItem('quickbite_drawer_audit');
    assert.ok(auditRaw, 'Must record audit log in quickbite_drawer_audit');
    const audit = JSON.parse(auditRaw);
    assert.equal(audit[0].type, 'COD_TAKEN');
    assert.equal(audit[0].riderPin, pin);
    assert.equal(audit[0].amount, 650);
  });

  test('4. KM Payout Rate: getKmPayoutRate and setKmPayoutRate store and validate rate', () => {
    // Default rate
    assert.equal(dataService.getKmPayoutRate(), 15);

    // Set custom rate
    const updated = dataService.setKmPayoutRate(20);
    assert.equal(updated, 20);
    assert.equal(dataService.getKmPayoutRate(), 20);

    // Boundary check: negative or zero falls back safely
    assert.equal(dataService.setKmPayoutRate(-5), 15);
  });

  test('5. KM Payout Calculation & "Mark Paid": Computes road distance payout and marks paid', () => {
    const pin = '5522';
    dataService.saveOrUpdateRider({
      pin,
      name: 'Rizwan Pasha',
      phone: '+91 93333 22222',
      vehicle: '🛵 Scooter'
    });

    dataService.setKmPayoutRate(15);

    // Order with 6.4 km distance
    const order1 = {
      id: '#QB-1011',
      status: 'delivered',
      assignedRiderPin: pin,
      addressDetails: { distanceKm: 6.4 },
      deliveredAt: Date.now()
    };
    // Order with 3.6 km distance
    const order2 = {
      id: '#QB-1012',
      status: 'delivered',
      assignedRiderPin: pin,
      addressDetails: { distanceKm: 3.6 },
      deliveredAt: Date.now()
    };
    dataService.saveOrders([order1, order2]);

    const totalKms = 6.4 + 3.6; // 10.0 km
    const expectedPayout = totalKms * 15; // ₹150

    // Owner marks payout as paid
    const paidResult = dataService.markRiderPayoutPaid(pin, expectedPayout);
    assert.equal(paidResult.success, true);
    assert.equal(paidResult.amount, 150);

    const rider = dataService.getRiderByPin(pin);
    assert.ok(rider.payoutPaidAt > 0);
    assert.equal(rider.payoutAmountPaid, 150);
  });

  test('6. ISO 8601 Date String Handling: getRiderCashSummary accurately parses string dates without NaN', () => {
    const pin = '7711';
    dataService.saveOrUpdateRider({
      pin,
      name: 'Farhan Zaidi',
      phone: '+91 91111 22222',
      vehicle: '🏍️ Bike',
      cashSettledAt: '2026-10-28T05:00:00.000Z'
    });

    // Delivered order with ISO string timestamp placed after settledAt
    const orderIso = {
      id: '#QB-7701',
      status: 'delivered',
      assignedRiderPin: pin,
      paymentMethod: 'Cash on Delivery',
      total: '₹420',
      deliveredAt: '2026-10-28T09:30:00.000Z'
    };
    dataService.saveOrders([orderIso]);

    const summary = dataService.getRiderCashSummary(pin);
    assert.equal(summary.cashInHand, 420, 'Must parse ISO string date and compute cash in hand');
    assert.equal(summary.deliveredCount, 1);
  });

  test('7. Numeric PIN & Name-Based Resilience: Handles numeric PIN and name fallback safely', () => {
    const pin = '8822';
    dataService.saveOrUpdateRider({
      pin,
      name: 'Kabir Khan',
      phone: '+91 94444 33333',
      vehicle: '🛵 Scooter'
    });

    // Order 1: numeric PIN (8822 instead of '8822')
    const orderNum = {
      id: '#QB-8801',
      status: 'delivered',
      assignedRiderPin: 8822,
      paymentMethod: 'COD',
      total: '₹300',
      deliveredAt: Date.now()
    };
    // Order 2: missing pin, assigned by name
    const orderName = {
      id: '#QB-8802',
      status: 'delivered',
      assignedRiderName: 'Kabir Khan',
      paymentMethod: 'Cash',
      total: '₹250',
      deliveredAt: Date.now()
    };
    dataService.saveOrders([orderNum, orderName]);

    const summary = dataService.getRiderCashSummary(pin);
    assert.equal(summary.cashInHand, 550, 'Must match numeric PIN and name-based assignment');
    assert.equal(summary.deliveredCount, 2);
  });

  test('8. Order Status & Online Payment Filtering: Excludes cancelled, on-the-way, and prepaid orders from cash collection', () => {
    const pin = '9933';
    dataService.saveOrUpdateRider({
      pin,
      name: 'Aman Varma',
      phone: '+91 98888 77777',
      vehicle: '🏍️ Bike'
    });

    const orders = [
      // 1. Delivered COD: counts
      { id: '#QB-9901', status: 'delivered', assignedRiderPin: pin, paymentMethod: 'Cash', total: '₹500', deliveredAt: Date.now() },
      // 2. Delivered Online: excluded from cash
      { id: '#QB-9902', status: 'delivered', assignedRiderPin: pin, paymentMethod: 'Online UPI', total: '₹400', deliveredAt: Date.now() },
      // 3. On the way COD: not yet delivered, excluded from cash in hand
      { id: '#QB-9903', status: 'on_the_way', assignedRiderPin: pin, paymentMethod: 'Cash', total: '₹300', deliveredAt: Date.now() },
      // 4. Cancelled COD: excluded
      { id: '#QB-9904', status: 'cancelled', assignedRiderPin: pin, paymentMethod: 'Cash', total: '₹200', deliveredAt: Date.now() }
    ];
    dataService.saveOrders(orders);

    const summary = dataService.getRiderCashSummary(pin);
    assert.equal(summary.cashInHand, 500, 'Only delivered COD orders should count as cash in hand');
    assert.equal(summary.deliveredCount, 2, 'Delivered orders count both COD and Online');
  });

});
