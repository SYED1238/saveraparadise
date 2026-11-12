import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataService, getShiftStartTimeMs, DEFAULT_PAYOUT_CONFIG } from '../dataService.js';

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

describe('RIDER PORTAL HARDENING, 1:00 AM SHIFT RESET & CNR COMPENSATION SUITE', () => {
  beforeEach(() => {
    setupMockStorage();

    const testRiders = [
      { id: 'r1', pin: '2233', name: 'Rider Ramesh', phone: '9876543210', vehicle: '🏍️ Honda Activa' },
      { id: 'r2', pin: '4422', name: 'Rider Suresh', phone: '9876543211', vehicle: '🏍️ TVS Jupiter' }
    ];
    dataService.saveRiders(testRiders);
    dataService.setActiveRiderPin('2233');

    dataService.savePayoutConfig({
      activeMethod: 'tiered_standard',
      tieredStandard: { basePay: 25, baseKm: 1.0, extraKmRate: 10 },
      tieredMilestone: { basePay: 25, baseKm: 1.0, extraKmRate: 10, milestoneOrders: 10, surgeExtraKmRate: 15 },
      flatLinear: { ratePerKm: 30 },
      undeliveredCompensation: { mode: 'zero', customAmount: 20 }
    });
  });

  test('1. Shift Start Time reset at 1:00 AM handles late-night shifts and next-day boundary', () => {
    // 11:30 PM (23:30) on Nov 5: Shift start should be Nov 5, 01:00 AM
    const lateNightRef = new Date(2026, 10, 5, 23, 30, 0, 0).getTime();
    const lateNightShiftStart = getShiftStartTimeMs(lateNightRef);
    const dLate = new Date(lateNightShiftStart);
    assert.equal(dLate.getDate(), 5, 'Late evening 23:30 belongs to Nov 5 shift');
    assert.equal(dLate.getHours(), 1, 'Shift starts at 1:00 AM');

    // 00:30 AM (half past midnight) on Nov 6: Shift start should still be Nov 5, 01:00 AM
    const pastMidnightRef = new Date(2026, 10, 6, 0, 30, 0, 0).getTime();
    const pastMidnightShiftStart = getShiftStartTimeMs(pastMidnightRef);
    const dPastMidnight = new Date(pastMidnightShiftStart);
    assert.equal(dPastMidnight.getDate(), 5, '00:30 AM belongs to the ongoing evening shift starting Nov 5 at 1:00 AM');
    assert.equal(dPastMidnight.getHours(), 1, 'Shift starts at 1:00 AM');

    // 01:05 AM on Nov 6: Shift has officially reset to the new day (Nov 6, 01:00 AM)
    const newDayRef = new Date(2026, 10, 6, 1, 5, 0, 0).getTime();
    const newDayShiftStart = getShiftStartTimeMs(newDayRef);
    const dNewDay = new Date(newDayShiftStart);
    assert.equal(dNewDay.getDate(), 6, '01:05 AM belongs to the new shift starting Nov 6 at 1:00 AM');
    assert.equal(dNewDay.getHours(), 1, 'Shift starts at 1:00 AM');
  });

  test('2. Customer Unreachable compensation modes (zero, half, base, custom)', () => {
    const order = {
      id: '#QB-CNR-1',
      status: 'undelivered',
      assignedRiderPin: '2233',
      addressDetails: { distanceKm: 2.5 } // Normal Tiered Pay: ₹25 + (1.5 * 10) = ₹40.00
    };

    // Mode A: Zero (Default)
    dataService.savePayoutConfig({
      activeMethod: 'tiered_standard',
      tieredStandard: { basePay: 25, baseKm: 1.0, extraKmRate: 10 },
      undeliveredCompensation: { mode: 'zero', customAmount: 20 }
    });
    const payZero = dataService.calculateOrderPayout(order, 1);
    assert.equal(payZero.amount, 0, 'Zero mode pays ₹0');
    assert.equal(payZero.isUndelivered, true);

    // Mode B: Half Pay (50% of trip pay = ₹20.00)
    dataService.savePayoutConfig({
      activeMethod: 'tiered_standard',
      tieredStandard: { basePay: 25, baseKm: 1.0, extraKmRate: 10 },
      undeliveredCompensation: { mode: 'half', customAmount: 20 }
    });
    const payHalf = dataService.calculateOrderPayout(order, 1);
    assert.equal(payHalf.amount, 20.00, 'Half mode pays 50% of ₹40 = ₹20.00');

    // Mode C: Fixed Base Fare (₹25 guaranteed)
    dataService.savePayoutConfig({
      activeMethod: 'tiered_standard',
      tieredStandard: { basePay: 25, baseKm: 1.0, extraKmRate: 10 },
      undeliveredCompensation: { mode: 'base', customAmount: 20 }
    });
    const payBase = dataService.calculateOrderPayout(order, 1);
    assert.equal(payBase.amount, 25.00, 'Base mode pays base fare ₹25.00');

    // Mode D: Custom Amount (₹35 custom fuel allowance)
    dataService.savePayoutConfig({
      activeMethod: 'tiered_standard',
      tieredStandard: { basePay: 25, baseKm: 1.0, extraKmRate: 10 },
      undeliveredCompensation: { mode: 'custom', customAmount: 35 }
    });
    const payCustom = dataService.calculateOrderPayout(order, 1);
    assert.equal(payCustom.amount, 35.00, 'Custom mode pays configured ₹35.00');
  });

  test('3. Accidental Unreachable Revert: cancelDoorstepWait resets state and clears timers', () => {
    const orderId = '#QB-TEST-CNR-99';
    const cleanId = 'QB-TEST-CNR-99';
    const testOrder = {
      id: orderId,
      status: 'on_the_way',
      assignedRiderPin: '2233',
      riderWaitingAtDoorstep: true,
      waitingStartedAt: Date.now() - 60000,
      cancellationReason: '[DOORSTEP_WAIT] Rider waiting since 10:30 PM'
    };
    dataService.saveOrders([testOrder]);
    localStorage.setItem(`quickbite_cnr_start_${cleanId}`, String(Date.now() - 60000));
    localStorage.setItem('quickbite_order_doorstep_wait', JSON.stringify({ orderId }));

    // Revert accidental wait
    const reverted = dataService.cancelDoorstepWait(orderId, { riderPin: '2233' });
    assert.ok(reverted);
    assert.equal(reverted.riderWaitingAtDoorstep, false, 'riderWaitingAtDoorstep must be reset to false');
    assert.equal(reverted.waitingStartedAt, undefined, 'waitingStartedAt must be deleted');
    assert.equal(reverted.cancellationReason, null, 'Doorstep wait cancellation reason must be cleared');
    assert.equal(localStorage.getItem(`quickbite_cnr_start_${cleanId}`), null, 'Timer in localStorage must be cleared');
    assert.equal(localStorage.getItem('quickbite_order_doorstep_wait'), null, 'Wait broadcast token in storage must be cleared');
  });

  test('4. Instant Sync: markRiderPayoutPaid updates rider balance and marks paid timestamp', () => {
    const riderOrders = [
      {
        id: '#QB-PAID-1',
        status: 'delivered',
        assignedRiderPin: '2233',
        addressDetails: { distanceKm: 1.0 },
        deliveredAt: Date.now()
      }
    ];
    dataService.saveOrders(riderOrders);

    const initialSummary = dataService.getRiderPayoutSummary('2233');
    assert.equal(initialSummary.payoutBalance, 25.00);

    // Owner marks payout as paid
    const paidResult = dataService.markRiderPayoutPaid('2233', 25.00);
    assert.equal(paidResult.success, true);
    assert.equal(paidResult.amount, 25.00);

    const afterPaidSummary = dataService.getRiderPayoutSummary('2233');
    assert.equal(afterPaidSummary.isPaidToday, true, 'Rider must be marked as paid in current shift');
    assert.equal(afterPaidSummary.paidAmount, 25.00);
    assert.equal(afterPaidSummary.payoutBalance, 0, 'Balance must be 0 after owner marks paid');
  });

  test('5. Multi-bag pickup tab stability: delivery.js preserves rider on kitchen ready tab', () => {
    const deliveryJsPath = path.join(rootDir, 'delivery.js');
    const deliveryJs = fs.readFileSync(deliveryJsPath, 'utf8');

    // Verify auto-kick lines 940-944 are eliminated
    assert.doesNotMatch(
      deliveryJs,
      /activeTab === 'ready' && readyOrders\.length === 0 && activeOrders\.length > 0/,
      'delivery.js must NOT kick rider from ready tab when picking multiple parcels'
    );
  });

  test('6. HTML and CSS UI element verification', () => {
    const deliveryHtml = fs.readFileSync(path.join(rootDir, 'delivery.html'), 'utf8');
    const ownerHtml = fs.readFileSync(path.join(rootDir, 'owner.html'), 'utf8');
    const deliveryCss = fs.readFileSync(path.join(rootDir, 'delivery.css'), 'utf8');

    // Accidental Revert button in delivery.html
    assert.match(deliveryHtml, /id="btn-revert-unreachable"/, 'delivery.html must contain #btn-revert-unreachable');
    assert.match(deliveryHtml, /Customer Answered \/ Cancel Wait/, 'delivery.html must have clear revert button text');

    // Customer unreachable compensation options in owner.html
    assert.match(ownerHtml, /id="payout-undelivered-mode"/, 'owner.html must contain #payout-undelivered-mode select');
    assert.match(ownerHtml, /id="payout-undelivered-amount"/, 'owner.html must contain #payout-undelivered-amount input');

    // Mobile thumb clearance in delivery.css
    assert.match(deliveryCss, /\.rider-main-container\s*\{\s*padding:\s*12px\s*10px\s*110px\s*10px;/, 'delivery.css must have 110px bottom clearance on mobile');
  });

  test('7. Mobile order card finance badges (.row-payout-badge & .row-price-badge) stay contained inside .row-top-bar without horizontal overflow', () => {
    const deliveryCss = fs.readFileSync(path.join(rootDir, 'delivery.css'), 'utf8');

    assert.match(deliveryCss, /\.row-top-bar\s*\{[^}]*flex-wrap:\s*wrap;/, '.row-top-bar must allow flex wrapping so finance badges never push out of card bounds');
    assert.match(deliveryCss, /\.row-finance-badges\s*\{[^}]*max-width:\s*100%;[^}]*min-width:\s*0;/, '.row-finance-badges must enforce max-width: 100% and min-width: 0');
    assert.match(deliveryCss, /@media\s*\(max-width:\s*640px\)\s*\{[\s\S]*?\.row-top-bar\s*\{[^}]*flex-direction:\s*column;/, 'Mobile layout (<= 640px) must stack .row-top-bar vertically so meta pills and finance badges each get full width');
    assert.match(deliveryCss, /@media\s*\(max-width:\s*640px\)\s*\{[\s\S]*?\.row-price-badge,\s*\.row-payout-badge\s*\{[^}]*flex:\s*1\s+1\s+0;[^}]*min-width:\s*0;/, 'Mobile finance badges must share card width evenly with min-width: 0 so Your Payout box never overflows off-screen');
  });
});
