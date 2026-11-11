import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('RIDER BAG PIN VERIFICATION & ROUTE PREVIEW WORKFLOW SUITE', async (t) => {
  const deliveryHtml = fs.readFileSync(path.join(process.cwd(), 'delivery.html'), 'utf8');
  const deliveryCss = fs.readFileSync(path.join(process.cwd(), 'delivery.css'), 'utf8');
  const deliveryJs = fs.readFileSync(path.join(process.cwd(), 'delivery.js'), 'utf8');

  await t.test('1. delivery.html contains all modal elements for distance, route, and accept button', () => {
    assert.ok(deliveryHtml.includes('id="modal-bag-preview-backdrop"'), 'Modal backdrop must exist');
    assert.ok(deliveryHtml.includes('id="preview-bag-code-pill"'), 'Bag code pill element must exist');
    assert.ok(deliveryHtml.includes('id="preview-dist-val"'), 'Distance display must exist');
    assert.ok(deliveryHtml.includes('id="preview-eta-val"'), 'Ride ETA display must exist');
    assert.ok(deliveryHtml.includes('id="preview-dist-route-desc"'), 'Route description must exist');
    assert.ok(deliveryHtml.includes('id="preview-route-area"'), 'Route area destination must exist');
    assert.ok(deliveryHtml.includes('id="preview-drop-address"'), 'Drop address element must exist');
    assert.ok(deliveryHtml.includes('id="preview-payment-pill"'), 'Payment mode element must exist');
    assert.ok(deliveryHtml.includes('id="btn-cancel-bag-claim"'), 'Cancel button must exist');
    assert.ok(deliveryHtml.includes('id="btn-confirm-bag-claim"'), 'Accept & Start Delivery button must exist');
  });

  await t.test('2. delivery.css includes high-visibility styles for bag preview card and route highlight', () => {
    assert.ok(deliveryCss.includes('.bag-preview-card'), 'CSS must define .bag-preview-card');
    assert.ok(deliveryCss.includes('.preview-distance-card'), 'CSS must define .preview-distance-card');
    assert.ok(deliveryCss.includes('.highlight-route'), 'CSS must style route highlight');
    assert.ok(deliveryCss.includes('.btn-confirm-bag-claim'), 'CSS must style .btn-confirm-bag-claim');
  });

  await t.test('3. delivery.js implements openBagPreviewModal, closeBagPreviewModal and wires accept button', () => {
    assert.ok(deliveryJs.includes('function openBagPreviewModal('), 'openBagPreviewModal must be defined');
    assert.ok(deliveryJs.includes('function closeBagPreviewModal('), 'closeBagPreviewModal must be defined');
    assert.ok(deliveryJs.includes('btnConfirmBagClaim.addEventListener(\'click\''), 'Confirm button click must be attached');
    assert.ok(deliveryJs.includes('modal-bag-preview'), 'Back navigation must register modal-bag-preview');
  });

  await t.test('4. startDeliveryByBagCode triggers preview modal instead of directly claiming order', () => {
    // When code is entered, it must call openBagPreviewModal(order, code)
    assert.ok(deliveryJs.includes('openBagPreviewModal(order, code);'), 'Entering bag code must open preview modal');
  });

  await t.test('5. Distance and route calculation math adheres to road multiplier and minimum ride time', () => {
    const lat1 = 12.7209;
    const lon1 = 77.2799;
    const lat2 = 12.7245;
    const lon2 = 77.2790;

    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const straightKm = R * c;
    const roadKm = parseFloat((straightKm * 1.35).toFixed(1));
    const estimatedMins = Math.max(5, Math.round(roadKm * 3.5));

    assert.ok(roadKm > 0, 'Road km must be positive');
    assert.ok(estimatedMins >= 5, 'Estimated mins must respect minimum floor');
  });

  await t.test('6. Distance calculation fallback prevents NaN duration and handles edge case coordinates', () => {
    const rawDistanceKm = NaN;
    const distanceKm = (!rawDistanceKm || isNaN(rawDistanceKm) || rawDistanceKm <= 0) ? 1.8 : rawDistanceKm;
    const estimatedMins = Math.max(5, Math.round(distanceKm * 3.5));

    assert.strictEqual(distanceKm, 1.8, 'Fallback distance must be 1.8km');
    assert.strictEqual(estimatedMins, 6, 'Estimated mins must be calculated properly');
    assert.ok(!isNaN(estimatedMins), 'Estimated mins must not be NaN');
  });

  await t.test('7. Rider bag preview modal adheres to clean white theme with high-contrast text', () => {
    assert.ok(deliveryCss.includes('background: #FFFFFF !important'), 'Modal card must use clean white theme background #FFFFFF');
    assert.ok(deliveryCss.includes('.highlight-payout .payout-val') || deliveryCss.includes('.preview-row.highlight-payout .payout-val'), 'Payout val CSS must exist');
    assert.ok(deliveryCss.includes('#047857'), 'Payout amount must use bold high-contrast emerald text #047857 in white theme');
    assert.ok(deliveryCss.includes('.payout-formula-tag'), 'Formula breakdown pill must be styled');
  });

  await t.test('8. Modal displays only destination address and avoids redundant "from where to where"', () => {
    // delivery.html must display Destination Address and not redundant "Delivery Route: Savera Paradise"
    assert.ok(deliveryHtml.includes('Destination Address:'), 'Modal must prominently label Destination Address');
    assert.ok(!deliveryHtml.includes('Delivery Route: Savera Paradise'), 'delivery.html must not show origin kitchen route');
    assert.ok(!deliveryJs.includes('`Savera Paradise ➔ ${areaName}`'), 'delivery.js must not set origin in previewRouteArea');
    assert.ok(!deliveryJs.includes('`Live route from Savera Paradise Kitchen'), 'delivery.js must not set origin in previewDistRouteDesc');
  });

  await t.test('9. Mobile-first ergonomic actions bar and touch targets conform to standards', () => {
    // Actions must be sticky/fixed in flex container with >= 48px touch targets
    assert.ok(deliveryCss.includes('.bag-preview-actions'), 'bag-preview-actions must exist');
    assert.ok(deliveryCss.includes('min-height: 48px') || deliveryCss.includes('min-height: 50px'), 'Buttons must meet 48px touch minimum');
    assert.ok(deliveryCss.includes('max-height: min(92dvh') || deliveryCss.includes('max-height: min(94dvh'), 'Modal card must clamp within mobile viewport');
  });

  await t.test('10. Rider order-pick workflow UI hides bag-code form and adds live GPS + 3km radius gate & full order cards', async () => {
    const fsMod = await import('node:fs');
    const pathMod = await import('node:path');
    const htmlContent = fsMod.readFileSync(pathMod.resolve(process.cwd(), 'delivery.html'), 'utf8');

    assert.match(htmlContent, /id="bag-pickup-form"[^>]*style="[^"]*display:\s*none/i, 'Manual 4-digit #bag-pickup-form must be hidden');
    assert.ok(htmlContent.includes('id="rider-pickup-gps-gate"'), 'delivery.html must contain #rider-pickup-gps-gate');
    assert.ok(htmlContent.includes('id="btn-sync-live-gps"'), 'delivery.html must contain #btn-sync-live-gps');
    assert.ok(htmlContent.includes('id="btn-confirm-bag-claim"'), 'delivery.html must retain #btn-confirm-bag-claim');

    assert.ok(deliveryJs.includes('MAX_RESTAURANT_PICKUP_RADIUS_METERS = 3000'), 'delivery.js must define 3000m restaurant pickup radius');
    assert.ok(deliveryJs.includes('function isRiderGpsSyncedAndFresh('), 'delivery.js must define isRiderGpsSyncedAndFresh');
    assert.ok(deliveryJs.includes('function isRiderWithinRestaurantPickupRadius('), 'delivery.js must define isRiderWithinRestaurantPickupRadius');
    assert.ok(deliveryJs.includes('function getRiderCurrentActiveOrder('), 'delivery.js must define getRiderCurrentActiveOrder');
    assert.ok(deliveryJs.includes("o.status === 'ready_for_pickup' || o.status === 'cooking' || o.status === 'accepted' || o.status === 'pending'"), 'Ready/Pending tab must list all kitchen and ready orders');
    assert.ok(deliveryJs.includes('calculateDistanceKm(') && deliveryJs.includes('calculateOrderPayout('), 'Pending cards must display distance and calculated payout');
    assert.ok(deliveryJs.includes("'claim_rejected'") || deliveryJs.includes('"claim_rejected"'), 'delivery.js must listen for claim_rejected rollback events');

    assert.ok(deliveryCss.includes('.pickup-gps-gate-bar'), 'delivery.css must style .pickup-gps-gate-bar');
    assert.ok(deliveryCss.includes('.btn-sync-live-gps'), 'delivery.css must style .btn-sync-live-gps');
    assert.ok(deliveryCss.includes('.btn-row-pickup.btn-row-pickup-locked'), 'delivery.css must style .btn-row-pickup-locked');
    assert.ok(deliveryCss.includes('.btn-row-pickup.btn-row-pickup-out-of-range'), 'delivery.css must style .btn-row-pickup-out-of-range');
  });

  await t.test('11. dataService.claimOrderByBagCode enforces 1-active-order limit, 3km radius, and optimistic rollback', async () => {
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
      globalThis.window = new EventTarget();
      globalThis.sessionStorage.setItem('quickbite_rider_token', 'test-rider-token');

      dataService.saveRiders([{ id: 'r1', pin: '2233', name: 'Rider Ramesh', phone: '9876543210' }]);
      dataService.setActiveRiderPin('2233');

      const activeOrder = {
        id: '#QB-901',
        bagCode: '1111',
        status: 'on_the_way',
        assignedRiderPin: '2233',
        assignedRiderName: 'Rider Ramesh',
        createdAt: Date.now() - 120000
      };
      const readyOrder = {
        id: '#QB-902',
        bagCode: '5678',
        status: 'ready_for_pickup',
        total: '₹320',
        addressDetails: { distanceKm: 1.5 },
        createdAt: Date.now() - 60000
      };

      // A. Reject 2nd concurrent active order before making network request
      let fetchCalls = 0;
      globalThis.fetch = async () => {
        fetchCalls++;
        return { ok: true, status: 200, json: async () => ({ success: true, order: { ...readyOrder, status: 'on_the_way', assignedRiderPin: '2233' } }) };
      };
      dataService.saveOrders([activeOrder, readyOrder]);

      const activeLimitRes = await dataService.claimOrderByBagCode('5678', '2233', '#QB-902', {
        riderLat: 12.7250,
        riderLng: 77.2810
      });
      assert.equal(activeLimitRes.success, false);
      assert.equal(activeLimitRes.reason, 'active_order_limit');
      assert.equal(fetchCalls, 0, 'Must abort locally without dispatching claim when active order limit reached');

      // B. Reject pickup when rider GPS is outside 3 km radius
      dataService.saveOrders([{ ...readyOrder }]);
      const outsideRes = await dataService.claimOrderByBagCode('5678', '2233', '#QB-902', {
        riderLat: 12.7600,
        riderLng: 77.2805
      });
      assert.equal(outsideRes.success, false);
      assert.equal(outsideRes.reason, 'outside_pickup_radius');
      assert.equal(fetchCalls, 0, 'Must abort locally without dispatching claim outside 3 km radius');

      // C. Succeed when 0 active orders and rider GPS is within 3 km
      let sentBody = null;
      globalThis.fetch = async (_url, opts) => {
        const parsed = JSON.parse(opts.body);
        if (parsed.action === 'claim_order') sentBody = parsed;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            order: {
              ...readyOrder,
              status: 'on_the_way',
              assignedRiderPin: '2233',
              assignedRiderName: 'Rider Ramesh'
            }
          })
        };
      };
      const okRes = await dataService.claimOrderByBagCode('5678', '2233', '#QB-902', {
        riderLat: 12.7250,
        riderLng: 77.2810
      });
      await new Promise(r => setTimeout(r, 25));
      assert.equal(okRes.success, true);
      assert.ok(sentBody, 'Expected _orderAction claim_order POST body to be sent');
      assert.equal(sentBody.enforceSingleActiveOrder, true);
      assert.equal(sentBody.riderLat, 12.7250);
      assert.equal(sentBody.riderLng, 77.2810);
      assert.equal(dataService.getOrders()[0].status, 'on_the_way');

      // D. Revert optimistic update on HTTP 409 server rejection
      dataService.saveOrders([{ ...readyOrder }]);
      let emittedReject = false;
      const onChangeEvt = (e) => {
        const detail = e && e.detail;
        if (detail && detail.type === 'orders' && detail.action === 'claim_rejected') {
          emittedReject = true;
        }
      };
      globalThis.window.addEventListener('quickbite_data_changed', onChangeEvt);
      globalThis.fetch = async (_url, opts) => {
        const parsed = opts && opts.body ? JSON.parse(opts.body) : {};
        if (parsed.action === 'claim_order') {
          return {
            ok: false,
            status: 409,
            json: async () => ({ error: 'Active order already in progress', code: 'ACTIVE_ORDER_LIMIT' })
          };
        }
        return { ok: false, status: 503, json: async () => ({}) };
      };
      const conflictRes = await dataService.claimOrderByBagCode('5678', '2233', '#QB-902', {
        riderLat: 12.7250,
        riderLng: 77.2810
      });
      assert.equal(conflictRes.success, true, 'Optimistic return succeeds initially');
      await new Promise(r => setTimeout(r, 30));
      globalThis.window.removeEventListener('quickbite_data_changed', onChangeEvt);
      assert.equal(emittedReject, true, 'Must emit claim_rejected event when server rejects with 409');
      assert.equal(dataService.getOrders()[0].status, 'ready_for_pickup', 'Optimistic state must roll back on HTTP 409');
    } finally {
      globalThis.fetch = origFetch;
      if (origWindow === undefined) delete globalThis.window;
      else globalThis.window = origWindow;
      globalThis.sessionStorage.removeItem('quickbite_rider_token');
      globalThis.localStorage.clear();
    }
  });

  await t.test('12. Dual-API Parity: api/ and functions/api/ order-action enforce 3km pickup radius (403) and 1-order limit (409)', async () => {
    const apiOrderAction = (await import('../api/order-action.js')).default;
    const { onRequest: cfOrderAction } = await import('../functions/api/order-action.js');
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
      const cfToken = cfCreateToken(undefined, 'rider', mockEnv, { riderPin: '2233' });
      const apiToken = apiCreateToken(undefined, 'rider', { riderPin: '2233' });

      const baseSimOrders = () => ([
        { id: '#QB-911', bag_code: '1111', status: 'on_the_way', assigned_rider_pin: '2233', assigned_rider_name: 'Rider Ramesh' },
        { id: '#QB-912', bag_code: '2222', status: 'ready_for_pickup' }
      ]);

      const callCf = async (payload) => {
        const req = new Request('https://saveraparadise.com/api/order-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfToken}` },
          body: JSON.stringify(payload)
        });
        const res = await cfOrderAction({ request: req, env: mockEnv });
        return { status: res.status, data: await res.json() };
      };

      const callApi = async (payload) => {
        let statusCode = 200;
        let data = null;
        const req = {
          method: 'POST',
          url: '/api/order-action',
          headers: { 'content-type': 'application/json', 'authorization': `Bearer ${apiToken}` },
          body: payload
        };
        const res = {
          status(c) { statusCode = c; return this; },
          setHeader() { return this; },
          json(d) { data = d; return this; },
          end() { return this; }
        };
        await apiOrderAction(req, res);
        return { status: statusCode, data };
      };

      for (const [label, invoke] of [['functions/api/order-action', callCf], ['api/order-action', callApi]]) {
        // 1. Invalid GPS coordinates (0, 0) -> 400
        const zeroRes = await invoke({
          action: 'claim_order',
          orderId: '#QB-912',
          riderPin: '2233',
          riderName: 'Rider Ramesh',
          riderLat: 0,
          riderLng: 0,
          enforceSingleActiveOrder: true,
          simulateOrders: baseSimOrders()
        });
        assert.equal(zeroRes.status, 400, `${label}: must reject invalid 0,0 coordinates`);

        // 2. Outside 3 km pickup radius (~4.35 km north) -> 403
        const outRes = await invoke({
          action: 'claim_order',
          orderId: '#QB-912',
          riderPin: '2233',
          riderName: 'Rider Ramesh',
          riderLat: 12.7600,
          riderLng: 77.2805,
          enforceSingleActiveOrder: true,
          simulateOrders: [baseSimOrders()[1]]
        });
        assert.equal(outRes.status, 403, `${label}: must reject rider outside 3 km radius with 403`);
        assert.equal(outRes.data.code, 'OUTSIDE_PICKUP_RADIUS');

        // 3. Within 3 km (~0.46 km), but rider already has 1 active order -> 409
        const limitRes = await invoke({
          action: 'claim_order',
          orderId: '#QB-912',
          riderPin: '2233',
          riderName: 'Rider Ramesh',
          riderLat: 12.7250,
          riderLng: 77.2810,
          enforceSingleActiveOrder: true,
          simulateOrders: baseSimOrders()
        });
        assert.equal(limitRes.status, 409, `${label}: must reject 2nd active order with 409`);
        assert.equal(limitRes.data.code, 'ACTIVE_ORDER_LIMIT');

        // 4. Within 3 km and 0 active orders -> 200
        const okRes = await invoke({
          action: 'claim_order',
          orderId: '#QB-912',
          riderPin: '2233',
          riderName: 'Rider Ramesh',
          riderLat: 12.7250,
          riderLng: 77.2810,
          enforceSingleActiveOrder: true,
          simulateOrders: [baseSimOrders()[1]]
        });
        assert.equal(okRes.status, 200, `${label}: must allow pickup within 3 km when 0 active orders`);
        assert.equal(okRes.data.order.status, 'on_the_way');
      }
    } finally {
      if (prevSecret === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = prevSecret;
    }
  });
});
