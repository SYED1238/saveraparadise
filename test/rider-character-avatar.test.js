import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const COWBOY_HAT_URL =
  '/api/r2-image?key=profile%2Fmale%2F3D_Cowboy_Male_Avatar_Icon___Minimalist_Round_Profile_Picture-removebg-preview.png';
const SUMMER_HAT_URL =
  '/api/r2-image?key=profile%2Ffemale%2F3D_Female_Avatar_Icon_with_Hat___Minimalist_Round_Profile_Picture-removebg-preview.png';

test('RIDER 3D CHARACTER AVATAR PICKER & COWBOY HAT DEFAULT SUITE', async (t) => {
  const deliveryHtml = fs.readFileSync(path.join(process.cwd(), 'delivery.html'), 'utf8');
  const deliveryCss = fs.readFileSync(path.join(process.cwd(), 'delivery.css'), 'utf8');
  const deliveryJs = fs.readFileSync(path.join(process.cwd(), 'delivery.js'), 'utf8');

  await t.test('1. delivery.html, delivery.css & delivery.js wire storefront-style character picker and Cowboy Hat default', () => {
    assert.ok(deliveryHtml.includes('id="rider-avatar-badge"'), 'Avatar wrap must exist as interactive trigger');
    assert.ok(deliveryHtml.includes('id="modal-rider-avatar-backdrop"'), 'Rider avatar picker modal must exist');
    assert.ok(deliveryHtml.includes('id="rider-avatar-tab-female"'), 'Female gender tab must exist');
    assert.ok(deliveryHtml.includes('id="rider-avatar-tab-male"'), 'Male gender tab must exist');
    assert.ok(deliveryHtml.includes('id="rider-avatar-grid-female"'), 'Female avatar grid must exist');
    assert.ok(deliveryHtml.includes('id="rider-avatar-grid-male"'), 'Male avatar grid must exist');
    assert.ok(deliveryHtml.includes('id="btn-save-rider-avatar"'), 'Apply Avatar button must exist');
    assert.ok(deliveryHtml.includes('id="btn-reset-rider-avatar"'), 'Reset to Cowboy Hat button must exist');
    assert.ok(deliveryHtml.includes(COWBOY_HAT_URL), 'Default #rider-avatar-img must point to Cowboy Hat avatar');

    assert.ok(deliveryCss.includes('.rider-avatar-pick-cue'), 'delivery.css must style .rider-avatar-pick-cue');
    assert.ok(deliveryCss.includes('.rider-avatar-modal-card'), 'delivery.css must style .rider-avatar-modal-card');
    assert.ok(deliveryCss.includes('.avatar-option-card.selected'), 'delivery.css must style selected avatar cards');

    assert.ok(deliveryJs.includes('setRiderAvatar('), 'delivery.js must persist selection via dataService.setRiderAvatar');
    assert.ok(deliveryJs.includes('Cowboy Hat'), 'delivery.js catalog must include Cowboy Hat default');
  });

  await t.test('2. Dual-API Parity: api/ and functions/api/ enforce RBAC and allowlist for set_rider_avatar', async () => {
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

      const callNode = async (token, payload) => {
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
        await apiOrderAction(req, res);
        return resState;
      };

      const callCf = async (token, payload) => {
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;
        const req = new Request('https://saveraparadise.com/api/order-action', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });
        const resp = await cfOrderAction({ request: req, env: mockEnv });
        return { statusCode: resp.status, body: await resp.json() };
      };

      // A. Unauthenticated rejected (401)
      const [cfUnauth, apiUnauth] = await Promise.all([
        callCf(null, { action: 'set_rider_avatar', riderPin: '2233', avatarImg: SUMMER_HAT_URL }),
        callNode(null, { action: 'set_rider_avatar', riderPin: '2233', avatarImg: SUMMER_HAT_URL })
      ]);
      assert.equal(cfUnauth.statusCode, 401);
      assert.equal(apiUnauth.statusCode, 401);

      // B. Admin token rejected (403)
      const [cfAdminRes, apiAdminRes] = await Promise.all([
        callCf(cfAdminToken, { action: 'set_rider_avatar', riderPin: '2233', avatarImg: SUMMER_HAT_URL }),
        callNode(apiAdminToken, { action: 'set_rider_avatar', riderPin: '2233', avatarImg: SUMMER_HAT_URL })
      ]);
      assert.equal(cfAdminRes.statusCode, 403);
      assert.equal(apiAdminRes.statusCode, 403);

      // C. Rider updates own avatar with approved R2 character URL (200)
      const [cfOk, apiOk] = await Promise.all([
        callCf(cfRiderToken, { action: 'set_rider_avatar', riderPin: '2233', avatarImg: SUMMER_HAT_URL }),
        callNode(apiRiderToken, { action: 'set_rider_avatar', riderPin: '2233', avatarImg: SUMMER_HAT_URL })
      ]);
      for (const r of [cfOk, apiOk]) {
        assert.equal(r.statusCode, 200);
        assert.equal(r.body.success, true);
        assert.equal(r.body.avatarImg, SUMMER_HAT_URL);
        assert.equal(r.body.rider.avatar_img, SUMMER_HAT_URL);
        assert.equal(r.body.rider.pin, '2233');
      }

      // D. Rider cannot change another rider's avatar (403)
      const [cfCross, apiCross] = await Promise.all([
        callCf(cfRiderToken, { action: 'set_rider_avatar', riderPin: '4422', avatarImg: SUMMER_HAT_URL }),
        callNode(apiRiderToken, { action: 'set_rider_avatar', riderPin: '4422', avatarImg: SUMMER_HAT_URL })
      ]);
      assert.equal(cfCross.statusCode, 403);
      assert.equal(apiCross.statusCode, 403);

      // E. Arbitrary external or script URL rejected (400)
      const [cfBadUrl, apiBadUrl] = await Promise.all([
        callCf(cfRiderToken, { action: 'set_rider_avatar', avatarImg: 'https://evil.example/avatar.png' }),
        callNode(apiRiderToken, { action: 'set_rider_avatar', avatarImg: 'https://evil.example/avatar.png' })
      ]);
      assert.equal(cfBadUrl.statusCode, 400);
      assert.equal(apiBadUrl.statusCode, 400);

      // F. Owner can update any rider's avatar (200), requires riderPin (400)
      const [cfOwnerOk, apiOwnerOk] = await Promise.all([
        callCf(cfOwnerToken, { action: 'set_rider_avatar', riderPin: '4422', avatarImg: COWBOY_HAT_URL }),
        callNode(apiOwnerToken, { action: 'set_rider_avatar', riderPin: '4422', avatarImg: COWBOY_HAT_URL })
      ]);
      assert.equal(cfOwnerOk.statusCode, 200);
      assert.equal(apiOwnerOk.statusCode, 200);
      assert.equal(cfOwnerOk.body.rider.avatar_img, COWBOY_HAT_URL);

      const [cfMissingPin, apiMissingPin] = await Promise.all([
        callCf(cfOwnerToken, { action: 'set_rider_avatar', avatarImg: COWBOY_HAT_URL }),
        callNode(apiOwnerToken, { action: 'set_rider_avatar', avatarImg: COWBOY_HAT_URL })
      ]);
      assert.equal(cfMissingPin.statusCode, 400);
      assert.equal(apiMissingPin.statusCode, 400);
    } finally {
      if (prevSecret === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = prevSecret;
    }
  });

  await t.test('3. dataService Cowboy Hat default resolution, setRiderAvatar persistence, rollback & offline queue', async () => {
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

    const { dataService, DEFAULT_RIDER_AVATAR_URL, resolveRiderAvatarUrl } = await import(`../dataService.js?bust=${Date.now()}`);
    assert.equal(DEFAULT_RIDER_AVATAR_URL, COWBOY_HAT_URL);
    assert.equal(resolveRiderAvatarUrl(''), COWBOY_HAT_URL);
    assert.equal(resolveRiderAvatarUrl('/avatars/rider-1.svg'), COWBOY_HAT_URL);
    assert.equal(resolveRiderAvatarUrl('/avatars/rider-2.svg'), COWBOY_HAT_URL);
    assert.equal(resolveRiderAvatarUrl('/avatars/rider-3.svg'), '/avatars/rider-3.svg');
    assert.equal(resolveRiderAvatarUrl(SUMMER_HAT_URL), SUMMER_HAT_URL);

    dataService.portalType = 'delivery';
    dataService.saveRiders([
      { id: 'rider-2233', pin: '2233', name: 'Zaid Khan', status: 'online', earnings: 450, trips: 5, upiVpa: 'zaid@upi' }
    ]);
    assert.equal(dataService.getRiderByPin('2233').avatarImg, COWBOY_HAT_URL);

    globalThis.sessionStorage.setItem('quickbite_rider_token', 'fake-rider-jwt');

    const origOrderAction = dataService._orderAction.bind(dataService);
    const posted = [];
    let nextMode = 'network_fail';

    dataService._orderAction = async (action, payload) => {
      posted.push({ action, payload });
      if (nextMode === 'network_fail') {
        const err = new Error('Network offline');
        err.status = 503;
        throw err;
      }
      if (nextMode === 'hard_reject') {
        const err = new Error('Invalid avatar');
        err.status = 400;
        throw err;
      }
      return {
        success: true,
        avatarImg: payload.avatarImg,
        rider: { pin: '2233', avatar_img: payload.avatarImg }
      };
    };

    try {
      // Offline network error queues retry & preserves selection locally + keeps ledger fields
      const offlineRes = await dataService.setRiderAvatar('2233', SUMMER_HAT_URL);
      assert.equal(offlineRes.success, false);
      assert.equal(offlineRes.queued, true);
      assert.equal(dataService.getRiderByPin('2233').avatarImg, SUMMER_HAT_URL);
      assert.equal(dataService.getRiderByPin('2233').earnings, 450);
      assert.equal(dataService.getRiderByPin('2233').upiVpa, 'zaid@upi');
      assert.ok(localStorage.getItem('quickbite_rider_avatar_pending_sync'));

      // Reconnect drains queue cleanly
      nextMode = 'success';
      await dataService.syncPendingRiderAvatar();
      assert.equal(posted.length, 2);
      assert.equal(posted[1].action, 'set_rider_avatar');
      assert.equal(posted[1].payload.avatarImg, SUMMER_HAT_URL);
      assert.equal(localStorage.getItem('quickbite_rider_avatar_pending_sync'), null);

      // Hard 4xx rejection rolls back avatar
      nextMode = 'hard_reject';
      const rejectRes = await dataService.setRiderAvatar('2233', COWBOY_HAT_URL);
      assert.equal(rejectRes.success, false);
      assert.equal(rejectRes.revertedAvatar, SUMMER_HAT_URL);
      assert.equal(dataService.getRiderByPin('2233').avatarImg, SUMMER_HAT_URL);
    } finally {
      dataService._orderAction = origOrderAction;
      localStorage.clear();
      sessionStorage.clear();
    }
  });
});
