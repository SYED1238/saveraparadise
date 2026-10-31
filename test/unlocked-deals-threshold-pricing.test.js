import test from 'node:test';
import assert from 'node:assert/strict';

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

import { DEFAULT_SETTINGS, dataService } from '../dataService.js';
import checkoutHandler from '../api/checkout.js';

test('DYNAMIC UNLOCKED DEALS & THRESHOLD PRICING SUITE', async (t) => {
  await t.test('1. Default settings structure & optional toggle', () => {
    assert.strictEqual(DEFAULT_SETTINGS.unlockedDealsEnabled, false, 'Unlocked deals should be disabled by default (optional)');
    assert.strictEqual(DEFAULT_SETTINGS.unlockedDealsMinOrder, 299, 'Default unlock threshold should be ₹299');
    assert.strictEqual(DEFAULT_SETTINGS.unlockedDealsDiscountPct, 15, 'Default discount percentage should be 15%');
    assert.ok(DEFAULT_SETTINGS.unlockedDealsTitle, 'Should have default title');
  });

  await t.test('2. Threshold discount math when subtotal meets requirement', () => {
    const minOrder = 299;
    const discountPct = 15;
    const subtotal = 340; // Above 299

    const isUnlocked = subtotal >= minOrder;
    assert.strictEqual(isUnlocked, true);

    const discount = Math.round((subtotal * discountPct) / 100);
    assert.strictEqual(discount, 51); // 15% of 340 = 51

    const finalTotal = subtotal - discount;
    assert.strictEqual(finalTotal, 289);
  });

  await t.test('3. Threshold discount does not apply when subtotal is below requirement', () => {
    const minOrder = 299;
    const discountPct = 15;
    const subtotal = 250; // Below 299

    const isUnlocked = subtotal >= minOrder;
    assert.strictEqual(isUnlocked, false);

    const discount = isUnlocked ? Math.round((subtotal * discountPct) / 100) : 0;
    assert.strictEqual(discount, 0);

    const needed = minOrder - subtotal;
    assert.strictEqual(needed, 49);
  });

  await t.test('4. Serverless /api/checkout validates unlocked deals and calculates authoritative signature', async () => {
    const mockReq = {
      method: 'POST',
      headers: { origin: 'http://localhost:5173' },
      body: {
        items: [
          { id: 'dish-1', name: 'Chicken Biryani Full', price: 210, quantity: 1 },
          { id: 'dish-2', name: 'Crispy Wings', price: 150, quantity: 1 }
        ],
        storeSettings: {
          unlockedDealsEnabled: true,
          unlockedDealsMinOrder: 299,
          unlockedDealsDiscountPct: 15,
          freeDeliveryEnabled: true,
          freeDeliveryThreshold: 250
        }
      }
    };

    let responseData = null;
    let statusCode = 200;
    const mockRes = {
      setHeader: () => {},
      status: (code) => {
        statusCode = code;
        return {
          json: (data) => { responseData = data; return data; },
          end: () => {}
        };
      }
    };

    await checkoutHandler(mockReq, mockRes);

    assert.strictEqual(statusCode, 200);
    assert.ok(responseData, 'Should return checkout verification data');
    // subtotal = 210 + 150 = 360 (meets 299 requirement)
    assert.strictEqual(responseData.subtotal, 360);
    // 15% of 360 = 54
    assert.strictEqual(responseData.discount, 54);
    // free delivery unlocked because 360 >= 250
    assert.strictEqual(responseData.deliveryFee, 0);
    // total = 360 - 54 = 306
    assert.strictEqual(responseData.total, '₹306');
    assert.ok(responseData.checkoutToken, 'Should contain authoritative HMAC signature');
  });

  await t.test('5. Co-existence: When disabled, /api/checkout charges regular prices', async () => {
    const mockReq = {
      method: 'POST',
      headers: { origin: 'http://localhost:5173' },
      body: {
        items: [
          { id: 'dish-1', name: 'Chicken Biryani Full', price: 210, quantity: 1 },
          { id: 'dish-2', name: 'Crispy Wings', price: 150, quantity: 1 }
        ],
        storeSettings: {
          unlockedDealsEnabled: false, // Disabled
          unlockedDealsMinOrder: 299,
          unlockedDealsDiscountPct: 15,
          freeDeliveryEnabled: true,
          freeDeliveryThreshold: 250
        }
      }
    };

    let responseData = null;
    let statusCode = 200;
    const mockRes = {
      setHeader: () => {},
      status: (code) => {
        statusCode = code;
        return {
          json: (data) => { responseData = data; return data; },
          end: () => {}
        };
      }
    };

    await checkoutHandler(mockReq, mockRes);

    assert.strictEqual(statusCode, 200);
    assert.strictEqual(responseData.subtotal, 360);
    assert.strictEqual(responseData.discount, 0, 'Discount should be 0 when unlocked deals are disabled');
    assert.strictEqual(responseData.total, '₹360');
  });

  await t.test('6. Tamper defense: /api/checkout clamps client-injected excessive discount percentages to 50%', async () => {
    const mockReq = {
      method: 'POST',
      headers: { origin: 'http://localhost:5173' },
      body: {
        items: [
          { id: 'dish-1', name: 'Chicken Biryani Full', price: 210, quantity: 1 },
          { id: 'dish-2', name: 'Crispy Wings', price: 150, quantity: 1 }
        ],
        storeSettings: {
          unlockedDealsEnabled: true,
          unlockedDealsMinOrder: 299,
          unlockedDealsDiscountPct: 99, // Maliciously forged 99%
          freeDeliveryEnabled: true,
          freeDeliveryThreshold: 250
        }
      }
    };

    let responseData = null;
    let statusCode = 200;
    const mockRes = {
      setHeader: () => {},
      status: (code) => {
        statusCode = code;
        return {
          json: (data) => { responseData = data; return data; },
          end: () => {}
        };
      }
    };

    await checkoutHandler(mockReq, mockRes);

    assert.strictEqual(statusCode, 200);
    assert.strictEqual(responseData.subtotal, 360);
    // 50% max clamp of 360 = 180, NOT 99% (356)
    assert.strictEqual(responseData.discount, 180, 'Excessive discount should be clamped to 50% max');
    assert.strictEqual(responseData.total, '₹180');
  });

  await t.test('7. dataService.setUnlockedDeals() defends against NaN and invalid inputs', () => {
    const updated = dataService.setUnlockedDeals({
      unlockedDealsEnabled: true,
      unlockedDealsMinOrder: 'invalid_nan',
      unlockedDealsDiscountPct: 'invalid_pct'
    });

    assert.strictEqual(updated.unlockedDealsEnabled, true);
    assert.strictEqual(updated.unlockedDealsMinOrder, 299, 'Should fallback safely to 299 when NaN provided');
    assert.strictEqual(updated.unlockedDealsDiscountPct, 15, 'Should fallback safely to 15 when NaN provided');

    // Restore to default disabled
    dataService.setUnlockedDeals({ unlockedDealsEnabled: false, unlockedDealsMinOrder: 299, unlockedDealsDiscountPct: 15 });
  });

  await t.test('8. Order threshold calculation computes and applies unlocked wholesale deals', () => {
    const settings = {
      unlockedDealsEnabled: true,
      unlockedDealsMinOrder: 299,
      unlockedDealsDiscountPct: 20
    };
    const computedSubtotal = 390;
    let unlockedDealDiscount = 0;
    if (settings.unlockedDealsEnabled) {
      const dealsMin = Number(settings.unlockedDealsMinOrder) || 299;
      const dealsPct = Number(settings.unlockedDealsDiscountPct) || 15;
      if (computedSubtotal >= dealsMin) {
        unlockedDealDiscount = Math.round((computedSubtotal * dealsPct) / 100);
      }
    }
    assert.strictEqual(unlockedDealDiscount, 78);
    const calculatedTotal = computedSubtotal - unlockedDealDiscount;
    assert.strictEqual(calculatedTotal, 312);
  });
});
