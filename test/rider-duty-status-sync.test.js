import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('RIDER ON-DUTY / OFF-DUTY SYNC ACROSS PORTALS SUITE', async (t) => {
  const ownerHtml = fs.readFileSync(path.join(process.cwd(), 'owner.html'), 'utf8');
  const ownerJs = fs.readFileSync(path.join(process.cwd(), 'owner.js'), 'utf8');
  const deliveryJs = fs.readFileSync(path.join(process.cwd(), 'delivery.js'), 'utf8');
  const adminJs = fs.readFileSync(path.join(process.cwd(), 'admin.js'), 'utf8');
  const dataServiceJs = fs.readFileSync(path.join(process.cwd(), 'dataService.js'), 'utf8');

  await t.test('1. Dual-API Parity: api/ and functions/api/ enforce RBAC and validation for set_rider_duty', async () => {
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
      const cfOwnerToken = cfCreateToken(undefined, 'owner', mockEnv);
      const apiOwnerToken = apiCreateToken(undefined, 'owner');
      const cfAdminToken = cfCreateToken(undefined, 'admin', mockEnv);
      const apiAdminToken = apiCreateToken(undefined, 'admin');
      const cfRiderToken = cfCreateToken(undefined, 'rider', mockEnv, { riderPin: '2233' });
      const apiRiderToken = apiCreateToken(undefined, 'rider', { riderPin: '2233' });

      const callNode = async (handler, token, payload) => {
        const resState = { statusCode: 200, body: null };
        const headers = { origin: 'https://saveraparadise.com' };
        if (token) headers.authorization = `Bearer ${token}`;
        const req = { method: 'POST', headers, body: payload };
        const res = {
          setHeader: () => {},
          status: (c) => { resState.statusCode = c; return res; },
          json: (b) => { resState.body = b; return res; },
          end: () => res
        };
        await handler(req, res);
        return resState;
      };

      const callCf = async (handler, token, payload) => {
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;
        const req = new Request('https://saveraparadise.com/api/order-action', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });
        const resp = await handler({ request: req, env: mockEnv });
        return { statusCode: resp.status, body: await resp.json() };
      };

      // A. Unauthenticated rejected (401)
      const [cfUnauth, apiUnauth] = await Promise.all([
        callCf(cfOrderAction, null, { action: 'set_rider_duty', riderPin: '2233', status: 'offline' }),
        callNode(apiOrderAction, null, { action: 'set_rider_duty', riderPin: '2233', status: 'offline' })
      ]);
      assert.equal(cfUnauth.statusCode, 401);
      assert.equal(apiUnauth.statusCode, 401);

      // B. Kitchen admin token rejected (403)
      const [cfAdminRes, apiAdminRes] = await Promise.all([
        callCf(cfOrderAction, cfAdminToken, { action: 'set_rider_duty', riderPin: '2233', status: 'offline' }),
        callNode(apiOrderAction, apiAdminToken, { action: 'set_rider_duty', riderPin: '2233', status: 'offline' })
      ]);
      assert.equal(cfAdminRes.statusCode, 403);
      assert.equal(apiAdminRes.statusCode, 403);

      // C. Rider token toggles own duty to offline and back online
      const [cfOff, apiOff] = await Promise.all([
        callCf(cfOrderAction, cfRiderToken, { action: 'set_rider_duty', riderPin: '2233', status: 'offline' }),
        callNode(apiOrderAction, apiRiderToken, { action: 'set_rider_duty', riderPin: '2233', status: 'offline' })
      ]);
      for (const r of [cfOff, apiOff]) {
        assert.equal(r.statusCode, 200);
        assert.equal(r.body.success, true);
        assert.equal(r.body.status, 'offline');
        assert.equal(r.body.rider.status, 'offline');
        assert.equal(r.body.rider.pin, '2233');
      }

      const [cfOn, apiOn] = await Promise.all([
        callCf(cfOrderAction, cfRiderToken, { action: 'set_rider_duty', onDuty: true }),
        callNode(apiOrderAction, apiRiderToken, { action: 'set_rider_duty', onDuty: true })
      ]);
      for (const r of [cfOn, apiOn]) {
        assert.equal(r.statusCode, 200);
        assert.equal(r.body.status, 'online');
        assert.equal(r.body.rider.status, 'online');
      }

      // D. Rider cannot modify another rider's duty status (403)
      const [cfCross, apiCross] = await Promise.all([
        callCf(cfOrderAction, cfRiderToken, { action: 'set_rider_duty', riderPin: '4422', status: 'offline' }),
        callNode(apiOrderAction, apiRiderToken, { action: 'set_rider_duty', riderPin: '4422', status: 'offline' })
      ]);
      assert.equal(cfCross.statusCode, 403);
      assert.equal(apiCross.statusCode, 403);

      // E. Deactivated rider blocked (403)
      const inactiveSim = { pin: '2233', name: 'Disabled Rider', status: 'inactive' };
      const [cfInact, apiInact] = await Promise.all([
        callCf(cfOrderAction, cfRiderToken, { action: 'set_rider_duty', status: 'online', simulateExistingRider: inactiveSim }),
        callNode(apiOrderAction, apiRiderToken, { action: 'set_rider_duty', status: 'online', simulateExistingRider: inactiveSim })
      ]);
      assert.equal(cfInact.statusCode, 403);
      assert.equal(apiInact.statusCode, 403);

      // F. Invalid status rejected (400)
      const [cfBadStatus, apiBadStatus] = await Promise.all([
        callCf(cfOrderAction, cfRiderToken, { action: 'set_rider_duty', status: 'inactive' }),
        callNode(apiOrderAction, apiRiderToken, { action: 'set_rider_duty', status: 'inactive' })
      ]);
      assert.equal(cfBadStatus.statusCode, 400);
      assert.equal(apiBadStatus.statusCode, 400);

      // G. Owner token updates a rider's duty status (200) and requires riderPin (400)
      const [cfOwnerOk, apiOwnerOk] = await Promise.all([
        callCf(cfOrderAction, cfOwnerToken, { action: 'set_rider_duty', riderPin: '4422', status: 'offline' }),
        callNode(apiOrderAction, apiOwnerToken, { action: 'set_rider_duty', riderPin: '4422', status: 'offline' })
      ]);
      assert.equal(cfOwnerOk.statusCode, 200);
      assert.equal(cfOwnerOk.body.rider.status, 'offline');
      assert.equal(apiOwnerOk.statusCode, 200);
      assert.equal(apiOwnerOk.body.rider.status, 'offline');

      const [cfOwnerMissingPin, apiOwnerMissingPin] = await Promise.all([
        callCf(cfOrderAction, cfOwnerToken, { action: 'set_rider_duty', status: 'offline' }),
        callNode(apiOrderAction, apiOwnerToken, { action: 'set_rider_duty', status: 'offline' })
      ]);
      assert.equal(cfOwnerMissingPin.statusCode, 400);
      assert.equal(apiOwnerMissingPin.statusCode, 400);
    } finally {
      if (prevSecret === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = prevSecret;
    }
  });

  await t.test('2. dataService.setRiderDutyStatus preserves ledger fields, broadcasts safely without PIN, and drains offline queue', async () => {
    const store = new Map();
    const sessStore = new Map();
    globalThis.localStorage = {
      getItem: (k) => store.get(String(k)) ?? null,
      setItem: (k, v) => store.set(String(k), String(v)),
      removeItem: (k) => store.delete(String(k)),
      clear: () => store.clear()
    };
    globalThis.sessionStorage = {
      getItem: (k) => sessStore.get(String(k)) ?? null,
      setItem: (k, v) => sessStore.set(String(k), String(v)),
      removeItem: (k) => sessStore.delete(String(k)),
      clear: () => sessStore.clear()
    };

    const { dataService } = await import('../dataService.js');
    const origFetch = globalThis.fetch;
    const origWindow = globalThis.window;
    const origEnsureBroadcast = dataService._ensureBroadcastSubscribedAndSend;
    const broadcastCalls = [];

    try {
      globalThis.window = new EventTarget();
      dataService.portalType = 'delivery';
      dataService._ensureBroadcastSubscribedAndSend = async (event, payload) => {
        broadcastCalls.push({ event, payload });
      };
      globalThis.sessionStorage.setItem('quickbite_rider_token', 'rider-tok-2233');

      dataService.saveRiders([
        {
          id: 'rider-2233',
          pin: '2233',
          name: 'Zaid Khan',
          phone: '+91 98451 22334',
          vehicle: '🏍️ Honda Activa 6G',
          status: 'online',
          upiVpa: '9845122334@upi',
          cashSettledAt: 1700000001000,
          payoutPaidAt: 1700000002000,
          payoutAmountPaid: 350,
          maxActiveOrders: 2
        }
      ]);

      const emitted = [];
      const unsub = dataService.subscribeToChanges((type, detail) => {
        emitted.push({ type, detail });
      });

      // 1. Simulate offline/network failure first -> queues pending sync
      globalThis.fetch = async () => {
        throw new Error('Network unreachable');
      };

      const offlineRes = await dataService.setRiderDutyStatus('2233', false);
      assert.equal(offlineRes.success, false);
      assert.equal(offlineRes.queued, true);
      assert.equal(globalThis.localStorage.getItem('quickbite_rider_duty_on'), 'false');

      const pendingRaw = globalThis.localStorage.getItem('quickbite_rider_duty_pending_sync');
      assert.ok(pendingRaw, 'Failed duty toggle must queue quickbite_rider_duty_pending_sync');
      assert.equal(JSON.parse(pendingRaw).status, 'offline');

      const updatedLocal = dataService.getRiderByPin('2233');
      assert.equal(updatedLocal.status, 'offline');
      assert.equal(updatedLocal.cashSettledAt, 1700000001000, 'Must preserve cashSettledAt');
      assert.equal(updatedLocal.payoutPaidAt, 1700000002000, 'Must preserve payoutPaidAt');
      assert.equal(updatedLocal.payoutAmountPaid, 350, 'Must preserve payoutAmountPaid');
      assert.equal(updatedLocal.upiVpa, '9845122334@upi', 'Must preserve upiVpa');
      assert.equal(updatedLocal.maxActiveOrders, 2, 'Must preserve maxActiveOrders');

      const dutyEvt = emitted.find(e => e.type === 'rider_duty_updated');
      assert.ok(dutyEvt, 'Must emit rider_duty_updated');
      assert.equal(dutyEvt.detail.status, 'offline');
      assert.equal(dutyEvt.detail.riderPin, undefined, 'Broadcast payload must not expose riderPin');

      // 2. Restore network and drain pending sync
      const postedPayloads = [];
      globalThis.fetch = async (_url, opts) => {
        const parsed = JSON.parse(opts.body);
        postedPayloads.push(parsed);
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, status: parsed.status, rider: { id: 'rider-2233', pin: '2233', status: parsed.status } })
        };
      };

      await dataService.syncPendingRiderDutyStatus();
      assert.equal(postedPayloads.length, 1);
      assert.equal(postedPayloads[0].action, 'set_rider_duty');
      assert.equal(postedPayloads[0].status, 'offline');
      assert.equal(globalThis.localStorage.getItem('quickbite_rider_duty_pending_sync'), null, 'Pending duty sync must clear once delivered');
      assert.equal(broadcastCalls.length, 1);
      assert.equal(broadcastCalls[0].event, 'rider_duty_updated');
      assert.equal(broadcastCalls[0].payload.riderPin, undefined, 'Realtime broadcast must not expose riderPin');

      // 3. Hard server rejection (404 / 403) must roll back optimistic local state and not queue
      globalThis.fetch = async () => ({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Rider not found' })
      });
      const rejectedRes = await dataService.setRiderDutyStatus('2233', true);
      assert.equal(rejectedRes.success, false);
      assert.equal(rejectedRes.statusCode, 404);
      assert.equal(rejectedRes.queued, false);
      assert.equal(dataService.getRiderByPin('2233').status, 'offline', 'Must roll back status on 404');
      assert.equal(globalThis.localStorage.getItem('quickbite_rider_duty_on'), 'false', 'Must roll back duty flag on 404');

      // 4. Inactive rider cannot toggle duty status
      dataService.saveRiders([{ id: 'rider-9191', pin: '9191', name: 'Banned', status: 'inactive' }]);
      const bannedRes = await dataService.setRiderDutyStatus('9191', true);
      assert.equal(bannedRes.success, false);
      assert.match(bannedRes.error, /deactivated/i);

      unsub();
    } finally {
      dataService._ensureBroadcastSubscribedAndSend = origEnsureBroadcast;
      globalThis.fetch = origFetch;
      globalThis.window = origWindow;
      dataService.portalType = 'customer';
    }
  });

  await t.test('3. Owner helpers & UI preserve 11-column fleet table and render live duty badges across portals', async () => {
    const { getRiderDutyMeta, computeFleetDutyCounts } = await import('../owner.js');

    assert.deepEqual(getRiderDutyMeta({ status: 'online' }), {
      status: 'online',
      isOnline: true,
      label: 'On Duty • Online',
      shortLabel: 'On Duty',
      cssClass: 'online'
    });
    assert.deepEqual(getRiderDutyMeta({ status: 'offline' }), {
      status: 'offline',
      isOnline: false,
      label: 'Off Duty • On Break',
      shortLabel: 'Off Duty',
      cssClass: 'offline'
    });
    assert.deepEqual(getRiderDutyMeta({ status: 'inactive' }), {
      status: 'inactive',
      isOnline: false,
      label: 'Deactivated',
      shortLabel: 'Inactive',
      cssClass: 'inactive'
    });
    assert.equal(getRiderDutyMeta({ isRegistered: false, status: 'offline' }).shortLabel, 'Archived');

    const counts = computeFleetDutyCounts([
      { pin: '1111', status: 'online' },
      { pin: '2222', status: 'offline' },
      { pin: '3333', status: 'online' },
      { pin: '4444', status: 'inactive' }
    ]);
    assert.deepEqual(counts, {
      totalCount: 4,
      activeCount: 3,
      onDutyCount: 2,
      offDutyCount: 1,
      inactiveCount: 1
    });

    // Verify 11-column structure of #owner-rider-table is intact for print CSS & tests
    const tableHeadMatch = ownerHtml.match(/<table class="owner-table" id="owner-rider-table">[\s\S]*?<thead>([\s\S]*?)<\/thead>/);
    assert.ok(tableHeadMatch, '#owner-rider-table thead must exist');
    const thMatches = tableHeadMatch[1].match(/<th\b/g) || [];
    assert.equal(thMatches.length, 11, '#owner-rider-table must retain exact 11 columns');

    assert.ok(ownerHtml.includes('id="fleet-duty-summary-bar"'), 'owner.html must include #fleet-duty-summary-bar');
    assert.ok(ownerHtml.includes('id="fleet-count-online"'), 'owner.html must include #fleet-count-online');
    assert.ok(ownerHtml.includes('id="fleet-count-offline"'), 'owner.html must include #fleet-count-offline');
    assert.ok(ownerJs.includes('rider-duty-badge'), 'owner.js must render .rider-duty-badge in fleet views');
    assert.ok(deliveryJs.includes('dataService.setRiderDutyStatus('), 'delivery.js must sync duty toggle via dataService.setRiderDutyStatus');
    assert.ok(adminJs.includes('On Duty • Online') && adminJs.includes('Off Duty • On Break'), 'admin.js must render live rider duty labels');
    assert.doesNotMatch(dataServiceJs, /pin:\s*String\(r\.pin\)\.trim\(\)/, 'syncRidersFromSupabase must not coerce masked undefined pin to "undefined"');
  });

  await t.test('4. Dev auth parity, cross-tab BroadcastChannel cache invalidation, and zero stale list_riders cache', () => {
    const viteConfig = fs.readFileSync(path.join(process.cwd(), 'vite.config.js'), 'utf8');
    const apiAdminStore = fs.readFileSync(path.join(process.cwd(), 'api/admin-store.js'), 'utf8');
    const cfAdminStore = fs.readFileSync(path.join(process.cwd(), 'functions/api/admin-store.js'), 'utf8');

    assert.match(viteConfig, /if\s*\(\s*!role\s*\|\|\s*role\s*===\s*['"]rider['"]\s*\)/, 'vite.config.js must query Supabase for default/dynamic rider PINs');
    assert.match(viteConfig, /Rider account is deactivated or no longer exists/, 'vite.config.js refresh must verify rider active status');
    assert.match(dataServiceJs, /this\._lastRemoteDutyUpdates\s*=\s*new Map\(\)/, 'dataService must protect fresh remote duty updates from stale sync races');
    assert.match(dataServiceJs, /if\s*\(!hasMaskedPins\)\s*\{\s*localStorage\.setItem\(['"]quickbite_riders['"]/, 'syncRidersFromSupabase must never persist masked rider records into localStorage');
    assert.doesNotMatch(apiAdminStore, /if\s*\(ridersListCache\s*&&\s*\(now\s*-\s*ridersListCachedAt\s*<\s*RIDERS_CACHE_TTL_MS\)\)/, 'api/admin-store.js list_riders must not serve stale isolate cache');
    assert.doesNotMatch(cfAdminStore, /if\s*\(ridersListCache\s*&&\s*\(now\s*-\s*ridersListCachedAt\s*<\s*RIDERS_CACHE_TTL_MS\)\)/, 'functions/api/admin-store.js list_riders must not serve stale isolate cache');

    const alarmInitIdx = deliveryJs.indexOf('let isRiderAlarmRinging = false;');
    const applyDutyIdx = deliveryJs.indexOf('applyRiderDutyUI(isDutyOn);');
    assert.ok(alarmInitIdx !== -1 && applyDutyIdx !== -1 && alarmInitIdx < applyDutyIdx, 'delivery.js must initialize alarm state before synchronous applyRiderDutyUI(isDutyOn) so Off-Duty reload never throws TDZ ReferenceError');

    const activeModalIdx = ownerJs.indexOf('let activeModalOrder = null;');
    const initOwnerIdx = ownerJs.indexOf('initOwnerApp();');
    assert.ok(activeModalIdx !== -1 && initOwnerIdx !== -1 && activeModalIdx < initOwnerIdx, 'owner.js must initialize activeModalOrder before synchronous initOwnerApp() to avoid TDZ ReferenceError on auto-unlock/HMR');

    assert.match(ownerJs, /status:\s*_preserveServerStatus/, 'owner.js rider edits and UPI updates must omit stale cached status when calling save_rider');
    assert.match(deliveryJs, /dutyToggleSeq/, 'delivery.js must guard duty toggle async handlers with monotonic sequence check');
    assert.match(deliveryJs, /missingLsDuty/, 'delivery.js must hydrate quickbite_rider_duty_on after lock and re-login without reload');
    assert.match(dataServiceJs, /_dutySyncInFlightByPin/, 'dataService.js must serialize per-rider setRiderDutyStatus sync requests');
  });

  await t.test('5. Rapid double-toggle serialization preserves true base state on rejection', async () => {
    const { dataService } = await import('../dataService.js');
    const origOrderAction = dataService._orderAction;
    const origEnsureBroadcast = dataService._ensureBroadcastSubscribedAndSend;
    const origWindow = globalThis.window;
    const origRiders = JSON.stringify(dataService.getRiders());
    try {
      globalThis.window = new EventTarget();
      dataService.saveOrUpdateRider({
        id: 'rider-4422',
        pin: '4422',
        name: 'Tanveer Ahmed',
        status: 'online'
      });
      dataService._ensureBroadcastSubscribedAndSend = async () => {};
      const calls = [];
      dataService._orderAction = async (act, payload) => {
        calls.push({ act, status: payload.status });
        await new Promise(r => setTimeout(r, 15));
        const err = new Error('Rider not found');
        err.status = 404;
        throw err;
      };

      // Rapid Off -> On -> Off before first request resolves
      const p1 = dataService.setRiderDutyStatus('4422', false);
      const p2 = dataService.setRiderDutyStatus('4422', true);
      const p3 = dataService.setRiderDutyStatus('4422', false);
      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

      assert.equal(r1.success, false);
      assert.equal(r2.superseded, true, 'Middle superseded toggle must not fire duplicate remote call');
      assert.equal(r3.success, false);
      assert.equal(r3.revertedStatus, 'online', 'Final 404 rollback must restore true initial server status (online), not unconfirmed middle optimistic state');
      assert.equal(calls.length, 2, 'Only non-superseded serialized mutations should hit server');
      assert.equal(dataService.getRiderByPin('4422')?.status, 'online');
    } finally {
      dataService._orderAction = origOrderAction;
      dataService._ensureBroadcastSubscribedAndSend = origEnsureBroadcast;
      globalThis.window = origWindow;
      dataService.saveRiders(JSON.parse(origRiders));
    }
  });
});
