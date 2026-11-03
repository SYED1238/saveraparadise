import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

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

import { dataService } from '../dataService.js';
import checkoutHandler from '../api/checkout.js';

function createMockReqRes({ method = 'POST', url = '/api/checkout', headers = {}, body = null } = {}) {
  let statusCode = 200;
  let responseData = null;
  const responseHeaders = {};
  const req = { method, url, headers: { ...headers }, body };
  const res = {
    status(code) { statusCode = code; return this; },
    setHeader(key, val) { responseHeaders[key] = val; return this; },
    json(data) { responseData = data; return this; },
    end() { return this; },
    get statusCode() { return statusCode; },
    get data() { return responseData; },
    get headers() { return responseHeaders; }
  };
  return { req, res };
}

test('FEATURE #4: GEOFENCE DELIVERY DEFENSE & DYNAMIC FEE SUITE', async (t) => {
  await t.test('1. Dynamic delivery fee applies custom threshold and fee from storeSettings', async () => {
    const { req, res } = createMockReqRes({
      body: {
        items: [{ id: '1', name: 'Mutton Biryani', price: 200, quantity: 1 }],
        catalogDishes: [{ id: '1', name: 'Mutton Biryani', price: 200 }],
        storeSettings: {
          freeDeliveryEnabled: true,
          freeDeliveryThreshold: 350,
          deliveryFeeStandard: 60
        }
      }
    });

    await checkoutHandler(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.data.subtotal, 200);
    // Subtotal 200 is below 350, so custom deliveryFee of 60 applies
    assert.strictEqual(res.data.deliveryFee, 60);
    assert.strictEqual(res.data.total, '₹260');
  });

  await t.test('2. Dynamic delivery fee applies ₹0 when subtotal meets custom threshold', async () => {
    const { req, res } = createMockReqRes({
      body: {
        items: [{ id: '1', name: 'Mutton Biryani', price: 200, quantity: 2 }],
        catalogDishes: [{ id: '1', name: 'Mutton Biryani', price: 200 }],
        storeSettings: {
          freeDeliveryEnabled: true,
          freeDeliveryThreshold: 350,
          deliveryFeeStandard: 60
        }
      }
    });

    await checkoutHandler(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.data.subtotal, 400);
    // Subtotal 400 >= 350, so free delivery applies
    assert.strictEqual(res.data.deliveryFee, 0);
    assert.strictEqual(res.data.total, '₹400');
  });

  await t.test('3. /api/checkout blocks out-of-zone coordinates with 400 and clear error message', async () => {
    const { req, res } = createMockReqRes({
      body: {
        items: [{ id: '1', name: 'Mutton Biryani', price: 200, quantity: 1 }],
        catalogDishes: [{ id: '1', name: 'Mutton Biryani', price: 200 }],
        lat: 12.9716, // Bangalore (~45 km away from Ramanagara)
        lng: 77.5946
      }
    });

    await checkoutHandler(req, res);
    assert.strictEqual(res.statusCode, 400);
    assert.ok(res.data.error.includes('outside our delivery area'), 'Must return out-of-delivery-area error');
  });

  await t.test('4. /api/checkout accepts in-zone coordinates within 7 km', async () => {
    const { req, res } = createMockReqRes({
      body: {
        items: [{ id: '1', name: 'Mutton Biryani', price: 200, quantity: 1 }],
        catalogDishes: [{ id: '1', name: 'Mutton Biryani', price: 200 }],
        lat: 12.721, // ~0.5 km from restaurant
        lng: 77.287
      }
    });

    await checkoutHandler(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.data.subtotal, 200);
  });

  await t.test('5. dataService.addOrder() rejects out-of-zone coordinates with reason out_of_zone', async () => {
    // Ensure store is open and has dishes
    const current = dataService.getSettings();
    dataService.saveSettings({ ...current, storeOpen: true, deliveryRadiusKm: 7 });
    dataService.saveDishes([{ id: 'dish-1', name: 'Chicken Biryani', price: 180, inStock: true }]);

    const result = await dataService.addOrder({
      id: 'QB-TEST-GEO-OUT',
      items: [{ id: 'dish-1', name: 'Chicken Biryani', quantity: 1, price: 180 }],
      customerPhone: '9876543210',
      lat: 12.9716, // Bangalore (> 40km away)
      lng: 77.5946
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.reason, 'out_of_zone');
    assert.ok(result.distance > 7);
  });

  await t.test('6. dataService.addOrder() permits order with in-zone coordinates', async () => {
    const current = dataService.getSettings();
    dataService.saveSettings({ ...current, storeOpen: true, deliveryRadiusKm: 7 });
    dataService.saveDishes([{ id: 'dish-1', name: 'Chicken Biryani', price: 180, inStock: true }]);

    const testId = 'QB-GEO-IN-' + Date.now();
    const result = await dataService.addOrder({
      id: testId,
      items: [{ id: 'dish-1', name: 'Chicken Biryani', quantity: 1, price: 180 }],
      customerPhone: '9876543210',
      lat: 12.721, // Near Ramanagara kitchen
      lng: 77.287
    });

    assert.ok(result);
    assert.strictEqual(result.status, 'accepted');
    assert.ok(result.id);
  });

  await t.test('7. Cloudflare functions/api/checkout.js includes dynamic delivery fee and geofence check', () => {
    const fnCode = fs.readFileSync(new URL('../functions/api/checkout.js', import.meta.url), 'utf8');
    assert.ok(fnCode.includes('// Geofence Delivery Availability Validation'), 'Must contain geofence validation');
    assert.ok(fnCode.includes('freeDeliveryThreshold'), 'Must read dynamic freeDeliveryThreshold');
    assert.ok(fnCode.includes('deliveryFeeStandard'), 'Must read dynamic deliveryFeeStandard');
    assert.ok(fnCode.includes('roadDist > maxRadiusKm'), 'Must reject when roadDist exceeds maxRadiusKm');
  });
});
