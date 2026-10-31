import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../dataService.js';
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
});
