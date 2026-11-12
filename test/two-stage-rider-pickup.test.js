import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('TWO-STAGE RIDER PICKUP, LIVE GPS TRACKING & PER-RIDER ORDER LIMIT SUITE', async (t) => {
  const ownerHtml = fs.readFileSync(path.join(process.cwd(), 'owner.html'), 'utf8');
  const ownerJs = fs.readFileSync(path.join(process.cwd(), 'owner.js'), 'utf8');
  const deliveryJs = fs.readFileSync(path.join(process.cwd(), 'delivery.js'), 'utf8');
  const mainJs = fs.readFileSync(path.join(process.cwd(), 'main.js'), 'utf8');
  const adminJs = fs.readFileSync(path.join(process.cwd(), 'admin.js'), 'utf8');

  await t.test('1. Owner Portal UI and handler expose configurable Max Orders at a Time (1-4)', () => {
    assert.ok(ownerHtml.includes('id="owner-rider-max-orders"'), 'owner.html must have #owner-rider-max-orders select');
    for (const n of ['1', '2', '3', '4']) {
      assert.ok(ownerHtml.includes(`value="${n}"`), `owner.html dropdown must include option ${n}`);
    }
    assert.ok(ownerJs.includes("document.getElementById('owner-rider-max-orders')"), 'owner.js must wire #owner-rider-max-orders');
    assert.ok(ownerJs.includes('maxActiveOrders'), 'owner.js must persist maxActiveOrders');
    assert.ok(ownerJs.includes('max_active_orders'), 'owner.js must include snake_case max_active_orders');
  });

  await t.test('2. Multi-portal stage indicators in delivery.js, main.js, and admin.js', () => {
    assert.ok(deliveryJs.includes('data-action="pickup-parcel"'), 'delivery.js Stage 1 Active card must expose Pick Up Parcel button');
    assert.ok(deliveryJs.includes('handleConfirmParcelPickup'), 'delivery.js must implement handleConfirmParcelPickup');
    assert.ok(deliveryJs.includes('dataService.assignOrderToRider('), 'delivery.js Stage 1 must call dataService.assignOrderToRider');
    assert.ok(deliveryJs.includes('dataService.confirmOrderParcelPickup('), 'delivery.js Stage 2 must call dataService.confirmOrderParcelPickup');
    assert.ok(deliveryJs.includes('dataService.isOrderGoingToRestaurant('), 'delivery.js must use isOrderGoingToRestaurant');

    assert.ok(mainJs.includes('function isOrderRiderGoingToStore('), 'main.js must define isOrderRiderGoingToStore');
    assert.ok(mainJs.includes("order.status === 'on_the_way' || goingToStore"), 'main.js tracker must render live map for Stage 1 & Stage 2');
    assert.ok(mainJs.includes('Rider Going to Restaurant!'), 'main.js tracker title must show Stage 1 going-to-restaurant state');

    assert.ok(adminJs.includes('Going to Restaurant to Pick Up Bag #'), 'admin.js must show Stage 1 going-to-restaurant label');
    assert.ok(adminJs.includes('On the Way to Customer'), 'admin.js must distinguish Stage 2 on-the-way label');
  });

  await t.test('3. dataService two-stage assignOrderToRider, confirmOrderParcelPickup, and per-rider order limit', async () => {
    const store = new Map();
    if (typeof globalThis.localStorage === 'undefined') {
      globalThis.localStorage = {
        getItem: (k) => store.get(String(k)) ?? null,
        setItem: (k, v) => store.set(String(k), String(v)),
        removeItem: (k) => store.delete(String(k)),
        clear: () => store.clear(),
        key: (i) => Array.from(store.keys())[i] ?? null,
        get length() { return store.size; }
      };
    }
    if (typeof globalThis.sessionStorage === 'undefined') {
      globalThis.sessionStorage = {
        getItem: (k) => store.get('sess_' + String(k)) ?? null,
        setItem: (k, v) => store.set('sess_' + String(k), String(v)),
        removeItem: (k) => store.delete('sess_' + String(k)),
        clear: () => {}
      };
    }

    const { dataService } = await import('../dataService.js');
    const origFetch = globalThis.fetch;
    const origWindow = globalThis.window;

    try {
      globalThis.localStorage.clear();
      globalThis.sessionStorage.setItem('quickbite_rider_token', 'test-rider-token');
      globalThis.window = new EventTarget();

      // Configure rider 2233 with limit 2
      dataService.saveRiders([
        { id: 'rider-2233', name: 'Rider One', pin: '2233', status: 'online', vehicle: 'Bike', maxActiveOrders: 2 },
        { id: 'rider-4422', name: 'Rider Two', pin: '4422', status: 'online', vehicle: 'Bike', maxActiveOrders: 1 }
      ]);

      assert.equal(dataService.getRiderMaxActiveOrders('2233'), 2);
      assert.equal(dataService.getRiderMaxActiveOrders('4422'), 1);
      assert.equal(dataService.getRiderMaxActiveOrders('9999'), 1);

      const readyA = { id: '#QB-701', pickupCode: '7001', status: 'ready_for_pickup', items: [{ name: 'Biryani', price: 220, quantity: 1 }], total: '₹220', createdAt: Date.now() };
      const readyB = { id: '#QB-702', pickupCode: '7002', status: 'ready_for_pickup', items: [{ name: 'Naan', price: 120, quantity: 2 }], total: '₹240', createdAt: Date.now() };
      const readyC = { id: '#QB-703', pickupCode: '7003', status: 'ready_for_pickup', items: [{ name: 'Roll', price: 150, quantity: 1 }], total: '₹150', createdAt: Date.now() };
      dataService.saveOrders([readyA, readyB, readyC]);

      const sentActions = [];
      globalThis.fetch = async (_url, opts) => {
        const parsed = opts && opts.body ? JSON.parse(opts.body) : {};
        sentActions.push(parsed.action);
        if (parsed.action === 'assign_order') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              order: {
                id: parsed.orderId,
                status: 'ready_for_pickup',
                status_label: 'Rider Going to Restaurant',
                assigned_rider_pin: '2233',
                assigned_rider_name: 'Rider One',
                address_details: { riderPickupStage: 'going_to_restaurant' }
              }
            })
          };
        }
        if (parsed.action === 'claim_order') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              order: {
                id: parsed.orderId,
                status: 'on_the_way',
                status_label: 'Rider is on the Way Towards You',
                assigned_rider_pin: '2233',
                assigned_rider_name: 'Rider One',
                address_details: { riderPickupStage: 'picked_up' }
              }
            })
          };
        }
        return { ok: true, status: 200, json: async () => ({ success: true }) };
      };

      // Stage 1 accept from 8.5 km away (outside 3 km restaurant radius) MUST succeed!
      const farLat = 12.80;
      const farLng = 77.33;
      const assignRes1 = dataService.assignOrderToRider('#QB-701', '2233', { code: '7001', riderLat: farLat, riderLng: farLng });
      assert.equal(assignRes1.success, true, 'Stage 1 assignOrderToRider must succeed outside 3km');
      const o1AfterStage1 = dataService.getOrderById('#QB-701');
      assert.equal(o1AfterStage1.status, 'ready_for_pickup', 'Stage 1 must keep DB status ready_for_pickup');
      assert.equal(dataService.isOrderGoingToRestaurant(o1AfterStage1), true, 'Stage 1 order must report isOrderGoingToRestaurant === true');

      // Rider 2233 has limit 2 -> accepting second order Stage 1 MUST succeed
      const assignRes2 = dataService.assignOrderToRider('#QB-702', '2233', { code: '7002', riderLat: farLat, riderLng: farLng });
      assert.equal(assignRes2.success, true, 'Rider with maxActiveOrders=2 must be able to accept 2nd Stage 1 order');

      // Rider 2233 accepting 3rd order MUST be blocked cleanly
      const assignRes3 = dataService.assignOrderToRider('#QB-703', '2233', { code: '7003', riderLat: farLat, riderLng: farLng });
      assert.equal(assignRes3.success, false);
      assert.equal(assignRes3.reason, 'active_order_limit');

      // Stage 2 pickup from >3km away MUST fail
      const farPickupRes = dataService.confirmOrderParcelPickup('#QB-701', '2233', { riderLat: farLat, riderLng: farLng });
      assert.equal(farPickupRes.success, false);
      assert.equal(farPickupRes.reason, 'outside_pickup_radius');

      // Stage 2 pickup within 3km of restaurant MUST transition to on_the_way
      const nearPickupRes1 = dataService.confirmOrderParcelPickup('#QB-701', '2233', { riderLat: 12.7250, riderLng: 77.2810 });
      assert.equal(nearPickupRes1.success, true);
      const o1AfterStage2 = dataService.getOrderById('#QB-701');
      assert.equal(o1AfterStage2.status, 'on_the_way');
      assert.equal(o1AfterStage2.riderPickupStage, 'picked_up');
      assert.equal(dataService.isOrderGoingToRestaurant(o1AfterStage2), false);

      // Rider 2233 (maxActiveOrders=2) can also pick up already-accepted 2nd parcel at counter
      const nearPickupRes2 = dataService.confirmOrderParcelPickup('#QB-702', '2233', { riderLat: 12.7250, riderLng: 77.2810 });
      assert.equal(nearPickupRes2.success, true);
      assert.equal(dataService.getOrderById('#QB-702').status, 'on_the_way');

      await new Promise(r => setTimeout(r, 25));
      assert.ok(sentActions.includes('assign_order'), 'Must invoke assign_order API action');
      assert.ok(sentActions.includes('claim_order'), 'Must invoke claim_order API action');
    } finally {
      globalThis.fetch = origFetch;
      if (origWindow === undefined) delete globalThis.window;
      else globalThis.window = origWindow;
      globalThis.sessionStorage.removeItem('quickbite_rider_token');
      globalThis.localStorage.clear();
    }
  });

  await t.test('4. Dual-API Parity: api/ and functions/api/ handle save_rider maxActiveOrders, Stage 1 assign_order, and Stage 2 claim_order', async () => {
    const apiOrderAction = (await import('../api/order-action.js')).default;
    const { onRequest: cfOrderAction } = await import('../functions/api/order-action.js');
    const apiAdminStore = (await import('../api/admin-store.js')).default;
    const { onRequest: cfAdminStore } = await import('../functions/api/admin-store.js');
    const { createAdminToken: cfCreateToken } = await import('../functions/api/_auth.js');
    const { createAdminToken: apiCreateToken } = await import('../api/_auth.js');

    const mockEnv = {
      SESSION_SECRET: 'test_session_secret_32_characters_long_secure_key!',
      ADMIN_PIN: '8899',
      OWNER_PIN: '9900'
    };
    const prevSecret = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = mockEnv.SESSION_SECRET;

    try {
      const cfOwnerToken = cfCreateToken(undefined, 'owner', mockEnv);
      const apiOwnerToken = apiCreateToken(undefined, 'owner');
      const cfRiderToken = cfCreateToken(undefined, 'rider', mockEnv, { riderPin: '2233' });
      const apiRiderToken = apiCreateToken(undefined, 'rider', { riderPin: '2233' });

      const callNode = async (handler, token, payload) => {
        const resState = { statusCode: 200, body: null };
        const req = {
          method: 'POST',
          headers: { origin: 'https://saveraparadise.com', authorization: `Bearer ${token}` },
          body: payload
        };
        const res = {
          setHeader: () => {},
          status: (c) => { resState.statusCode = c; return res; },
          json: (b) => { resState.body = b; return res; },
          end: () => res
        };
        await handler(req, res);
        return resState;
      };

      const callCf = async (handler, url, token, payload) => {
        const req = new Request(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify(payload)
        });
        const resp = await handler({ request: req, env: mockEnv });
        return { statusCode: resp.status, body: await resp.json() };
      };

      // A. admin-store save_rider saves and returns maxActiveOrders / max_active_orders
      const savePayload = { action: 'save_rider', rider: { pin: '2233', name: 'Test Rider', maxActiveOrders: 3 } };
      const [cfSave, apiSave] = await Promise.all([
        callCf(cfAdminStore, 'https://saveraparadise.com/api/admin-store', cfOwnerToken, savePayload),
        callNode(apiAdminStore, apiOwnerToken, savePayload)
      ]);
      for (const r of [cfSave, apiSave]) {
        assert.equal(r.statusCode, 200);
        assert.equal(r.body.rider.maxActiveOrders, 3);
        assert.equal(r.body.rider.max_active_orders, 3);
      }

      // B. Stage 1 assign_order succeeds outside 3km, preserves ready_for_pickup, sets riderPickupStage
      const assignPayload = {
        action: 'assign_order',
        orderId: '#QB-801',
        riderName: 'Rider One',
        maxActiveOrders: 2,
        simulateOrders: [
          { id: '#QB-801', status: 'ready_for_pickup', assigned_rider_pin: null }
        ]
      };
      const [cfAssign, apiAssign] = await Promise.all([
        callCf(cfOrderAction, 'https://saveraparadise.com/api/order-action', cfRiderToken, assignPayload),
        callNode(apiOrderAction, apiRiderToken, assignPayload)
      ]);
      for (const r of [cfAssign, apiAssign]) {
        assert.equal(r.statusCode, 200);
        assert.equal(r.body.order.status, 'ready_for_pickup');
        assert.equal(r.body.order.status_label, 'Rider Going to Restaurant');
        assert.equal(r.body.order.assigned_rider_pin, '2233');
        assert.equal(r.body.order.address_details?.riderPickupStage, 'going_to_restaurant');
      }

      // C. assign_order blocks if maxActiveOrders=1 and rider already has 1 accepted order
      const assignLimitPayload = {
        action: 'assign_order',
        orderId: '#QB-802',
        maxActiveOrders: 1,
        simulateOrders: [
          { id: '#QB-801', status: 'ready_for_pickup', assigned_rider_pin: '2233' },
          { id: '#QB-802', status: 'ready_for_pickup', assigned_rider_pin: null }
        ]
      };
      const [cfLimit, apiLimit] = await Promise.all([
        callCf(cfOrderAction, 'https://saveraparadise.com/api/order-action', cfRiderToken, assignLimitPayload),
        callNode(apiOrderAction, apiRiderToken, assignLimitPayload)
      ]);
      for (const r of [cfLimit, apiLimit]) {
        assert.equal(r.statusCode, 409);
        assert.equal(r.body.code, 'ACTIVE_ORDER_LIMIT');
      }

      // D. assign_order allows 2nd accept when maxActiveOrders=2
      const assignLimit2Payload = { ...assignLimitPayload, maxActiveOrders: 2 };
      const [cfLimit2, apiLimit2] = await Promise.all([
        callCf(cfOrderAction, 'https://saveraparadise.com/api/order-action', cfRiderToken, assignLimit2Payload),
        callNode(apiOrderAction, apiRiderToken, assignLimit2Payload)
      ]);
      for (const r of [cfLimit2, apiLimit2]) {
        assert.equal(r.statusCode, 200);
      }

      // E. Stage 2 claim_order transitions Stage 1 order -> on_the_way within 3km and enforces maxActiveOrders=2
      const pickupStage2Payload = {
        action: 'claim_order',
        orderId: '#QB-802',
        riderLat: 12.7250,
        riderLng: 77.2810,
        maxActiveOrders: 2,
        simulateOrders: [
          { id: '#QB-801', status: 'on_the_way', assigned_rider_pin: '2233' },
          { id: '#QB-802', status: 'ready_for_pickup', assigned_rider_pin: '2233', address_details: { riderPickupStage: 'going_to_restaurant', distanceKm: 2.1 } }
        ]
      };
      const [cfPickup, apiPickup] = await Promise.all([
        callCf(cfOrderAction, 'https://saveraparadise.com/api/order-action', cfRiderToken, pickupStage2Payload),
        callNode(apiOrderAction, apiRiderToken, pickupStage2Payload)
      ]);
      for (const r of [cfPickup, apiPickup]) {
        assert.equal(r.statusCode, 200);
        assert.equal(r.body.order.status, 'on_the_way');
        assert.equal(r.body.order.status_label, 'Rider is on the Way Towards You');
        assert.equal(r.body.order.address_details?.riderPickupStage, 'picked_up');
        assert.equal(r.body.order.address_details?.distanceKm, 2.1);
      }

      // F. Stage 2 claim_order outside 3km STILL returns 403 even if Stage 1 assigned to same rider
      const farStage2Payload = { ...pickupStage2Payload, riderLat: 12.80, riderLng: 77.33 };
      const [cfFarPickup, apiFarPickup] = await Promise.all([
        callCf(cfOrderAction, 'https://saveraparadise.com/api/order-action', cfRiderToken, farStage2Payload),
        callNode(apiOrderAction, apiRiderToken, farStage2Payload)
      ]);
      for (const r of [cfFarPickup, apiFarPickup]) {
        assert.equal(r.statusCode, 403);
        assert.equal(r.body.code, 'OUTSIDE_PICKUP_RADIUS');
      }
    } finally {
      if (prevSecret === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = prevSecret;
    }
  });
});
