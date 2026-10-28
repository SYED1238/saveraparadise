import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataService, DEFAULT_PAYOUT_CONFIG } from '../dataService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test.describe('OWNER 3 PAYOUT COMPENSATION MODELS SUITE', () => {
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

  test('1. Default Payout Config Structure contains all 3 models', () => {
    const cfg = dataService.getPayoutConfig();
    assert.equal(cfg.activeMethod, 'tiered_standard');
    assert.equal(cfg.tieredStandard.basePay, 25);
    assert.equal(cfg.tieredStandard.baseKm, 1.0);
    assert.equal(cfg.tieredStandard.extraKmRate, 10);

    assert.equal(cfg.tieredMilestone.basePay, 25);
    assert.equal(cfg.tieredMilestone.baseKm, 1.0);
    assert.equal(cfg.tieredMilestone.extraKmRate, 10);
    assert.equal(cfg.tieredMilestone.milestoneOrders, 10);
    assert.equal(cfg.tieredMilestone.surgeExtraKmRate, 15);

    assert.equal(cfg.flatLinear.ratePerKm, 30);
  });

  test('2. Method 1: Tiered Standard Base Pay accurately calculates short & extra distance trips', () => {
    const cfg = {
      activeMethod: 'tiered_standard',
      tieredStandard: { basePay: 25, baseKm: 1.0, extraKmRate: 10 }
    };

    // Case A: Trip <= 1.0 km gets guaranteed base fare
    const shortTrip = dataService.calculateOrderPayout({ addressDetails: { distanceKm: 0.8 } }, 1, cfg);
    assert.equal(shortTrip.amount, 25.00);
    assert.equal(shortTrip.extraKm, 0);

    // Case B: Typical 1.31 km delivery: ₹25 base + ₹3.10 extra = ₹28.10
    const sampleTrip = dataService.calculateOrderPayout({ addressDetails: { distanceKm: 1.31 } }, 1, cfg);
    assert.equal(sampleTrip.amount, 28.10);
    assert.equal(sampleTrip.extraKm, 0.31);
    assert.equal(sampleTrip.basePay, 25);

    // Case C: Longer 4.5 km trip: ₹25 + 3.5 * ₹10 = ₹60.00
    const longTrip = dataService.calculateOrderPayout({ addressDetails: { distanceKm: 4.5 } }, 1, cfg);
    assert.equal(longTrip.amount, 60.00);
    assert.equal(longTrip.extraKm, 3.5);
  });

  test('3. Method 2: Tiered + Milestone Volume Incentive surges distance pay from order 11 onward', () => {
    const cfg = {
      activeMethod: 'tiered_milestone',
      tieredMilestone: {
        basePay: 25,
        baseKm: 1.0,
        extraKmRate: 10,
        milestoneOrders: 10,
        surgeExtraKmRate: 15
      }
    };

    // Orders 1 through 10 on 1.31 km trip: ₹25 + 0.31 * 10 = ₹28.10
    const order1 = dataService.calculateOrderPayout({ addressDetails: { distanceKm: 1.31 } }, 1, cfg);
    assert.equal(order1.amount, 28.10);
    assert.equal(order1.isSurge, false);

    const order10 = dataService.calculateOrderPayout({ addressDetails: { distanceKm: 1.31 } }, 10, cfg);
    assert.equal(order10.amount, 28.10);
    assert.equal(order10.isSurge, false);

    // Order 11 on 1.31 km trip: surges from ₹10 to ₹15/km -> ₹25 + (0.31 * 15) = ₹29.65
    const order11 = dataService.calculateOrderPayout({ addressDetails: { distanceKm: 1.31 } }, 11, cfg);
    assert.equal(order11.amount, 29.65);
    assert.equal(order11.isSurge, true);
    assert.equal(order11.extraKmRate, 15);

    // Rider completing 12 trips (each 1.31 km): 10 * 28.10 + 2 * 29.65 = 281.00 + 59.30 = 340.30
    const riderTrips = Array.from({ length: 12 }, (_, i) => ({
      id: `#ORD-${i + 1}`,
      addressDetails: { distanceKm: 1.31 },
      deliveredAt: 1000 + i * 100
    }));
    const totalCalc = dataService.calculateRiderPayout(riderTrips, cfg);
    assert.equal(totalCalc.orderCount, 12);
    assert.equal(totalCalc.surgeCount, 2);
    assert.equal(totalCalc.exactPayout, 340.30);
    assert.equal(totalCalc.totalPayout, 340);
  });

  test('4. Method 3: Flat Linear Rate pays pure distance without base fare', () => {
    const cfg = {
      activeMethod: 'flat_linear',
      flatLinear: { ratePerKm: 30 }
    };

    // 1.31 km trip: 1.31 * 30 = ₹39.30
    const trip = dataService.calculateOrderPayout({ addressDetails: { distanceKm: 1.31 } }, 1, cfg);
    assert.equal(trip.amount, 39.30);
    assert.equal(trip.ratePerKm, 30);

    // 5.0 km trip: 5.0 * 30 = ₹150.00
    const trip5 = dataService.calculateOrderPayout({ addressDetails: { distanceKm: 5.0 } }, 1, cfg);
    assert.equal(trip5.amount, 150.00);
  });

  test('5. Custom Settings Saving & Boundary Clamping', () => {
    const custom = {
      activeMethod: 'tiered_milestone',
      tieredStandard: { basePay: 30, baseKm: 1.5, extraKmRate: 12 },
      tieredMilestone: { basePay: -10, baseKm: -0.5, extraKmRate: -2, milestoneOrders: 0, surgeExtraKmRate: -5 },
      flatLinear: { ratePerKm: -10 }
    };

    const saved = dataService.savePayoutConfig(custom);
    assert.equal(saved.activeMethod, 'tiered_milestone');
    assert.equal(saved.tieredStandard.basePay, 30);
    assert.equal(saved.tieredStandard.baseKm, 1.5);
    assert.equal(saved.tieredStandard.extraKmRate, 12);

    // Safe boundaries on negative/zero inputs
    assert.equal(saved.tieredMilestone.basePay, 0);
    assert.equal(saved.tieredMilestone.baseKm, 0.1);
    assert.equal(saved.tieredMilestone.extraKmRate, 0);
    assert.equal(saved.tieredMilestone.milestoneOrders, 1);
    assert.equal(saved.tieredMilestone.surgeExtraKmRate, 0);
    assert.equal(saved.flatLinear.ratePerKm, 1);
  });

  test('6. HTML structure verification: owner.html contains all 3 models, steppers, and simulator', () => {
    const html = fs.readFileSync(path.join(rootDir, 'owner.html'), 'utf-8');

    // 3 Cards
    assert.ok(html.includes('id="pm-card-tiered-standard"'), 'Must have Tiered Standard card');
    assert.ok(html.includes('id="pm-card-tiered-milestone"'), 'Must have Tiered Milestone card');
    assert.ok(html.includes('id="pm-card-flat-linear"'), 'Must have Flat Linear card');

    // Steppers and inputs
    assert.ok(html.includes('id="cfg-ts-base-pay"'), 'Must have base pay input');
    assert.ok(html.includes('id="cfg-tm-milestone"'), 'Must have milestone target orders input');
    assert.ok(html.includes('id="cfg-fl-rate"'), 'Must have flat linear rate input');
    assert.ok(html.includes('class="btn-step"'), 'Must have stepper buttons');

    // Live Simulator & Save button
    assert.ok(html.includes('id="sim-trip-distance"'), 'Must have simulator distance input');
    assert.ok(html.includes('id="sim-payout-val"'), 'Must have simulator result payout value');
    assert.ok(html.includes('id="btn-save-payout-config"'), 'Must have save payout config button');
  });
});
