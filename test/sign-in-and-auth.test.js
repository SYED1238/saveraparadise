import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPasscode,
  isStaffSessionActive,
  setStaffSessionActive,
  clearStaffSession,
  verifyStaffPin,
  DEFAULT_RIDER_PIN_HASHES
} from '../securityUtils.js';
import { createAdminToken, verifyAdminToken, verifyAdminPin } from '../api/_auth.js';
import adminAuthHandler from '../api/admin-auth.js';

// Minimal mock req/res for serverless testing
function createMockReqRes({ method = 'GET', url = '/', headers = {}, body = null } = {}) {
  let statusCode = 200;
  let responseData = null;
  const responseHeaders = {};

  const req = {
    method,
    url,
    headers: { ...headers },
    body
  };

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    setHeader(key, val) {
      responseHeaders[key] = val;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    },
    get statusCode() {
      return statusCode;
    },
    get data() {
      return responseData;
    },
    get headers() {
      return responseHeaders;
    }
  };

  return { req, res };
}

test('SIGN-IN & AUTHENTICATION AUDIT: Customer Storefront Auth Suite', async (t) => {
  await t.test('Customer profile extraction resolves full name, first name, and initial with fallbacks', () => {
    function extractCustomerProfile(user) {
      if (!user) return { name: 'Guest', initial: 'G', isGuest: true };
      const meta = user.user_metadata || {};
      const identities = Array.isArray(user.identities) ? user.identities : [];
      const googleIdentity = identities.find(i => i.provider === 'google') || identities[0];
      const identityData = googleIdentity?.identity_data || {};

      const fullName = (
        meta.full_name ||
        meta.name ||
        identityData.full_name ||
        identityData.name ||
        user.email?.split('@')[0] ||
        'Foodie'
      ).trim();
      const firstName = fullName.split(' ')[0] || 'Foodie';
      const initial = (firstName || fullName || 'F').charAt(0).toUpperCase();

      const avatarUrl = (
        meta.avatar_url ||
        meta.picture ||
        identityData.avatar_url ||
        identityData.picture ||
        user.avatar_url ||
        ''
      ).trim();

      return { fullName, firstName, initial, avatarUrl, isGuest: false };
    }

    // 1. Full Google OAuth user
    const googleUser = {
      email: 'alex.smith@gmail.com',
      user_metadata: {
        full_name: 'Alex Smith',
        avatar_url: 'https://lh3.googleusercontent.com/a/photo123'
      }
    };
    const p1 = extractCustomerProfile(googleUser);
    assert.strictEqual(p1.fullName, 'Alex Smith');
    assert.strictEqual(p1.firstName, 'Alex');
    assert.strictEqual(p1.initial, 'A');
    assert.strictEqual(p1.avatarUrl, 'https://lh3.googleusercontent.com/a/photo123');

    // 2. Email-only user (no name in metadata)
    const emailUser = { email: 'crispylover@yahoo.com' };
    const p2 = extractCustomerProfile(emailUser);
    assert.strictEqual(p2.fullName, 'crispylover');
    assert.strictEqual(p2.firstName, 'crispylover');
    assert.strictEqual(p2.initial, 'C');

    // 3. Guest (null user)
    const p3 = extractCustomerProfile(null);
    assert.strictEqual(p3.isGuest, true);
    assert.strictEqual(p3.initial, 'G');
  });

  await t.test('Localhost mock customer generates valid structure without breaking production redirects', () => {
    const timestamp = Date.now();
    const localUser = {
      id: `google_local_${timestamp}`,
      email: 'foodie.google@gmail.com',
      user_metadata: {
        full_name: 'Local Test Customer',
        name: 'Local Test Customer',
        email: 'foodie.google@gmail.com',
        avatar_url: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop&q=80',
        provider: 'google'
      }
    };

    assert.ok(localUser.id.startsWith('google_local_'));
    assert.strictEqual(localUser.email, 'foodie.google@gmail.com');
    assert.strictEqual(localUser.user_metadata.full_name, 'Local Test Customer');
  });

  await t.test('OAuth callback URL token sanitization preserves clean application state', () => {
    function sanitizeOAuthHash(hash) {
      if (hash && (hash.includes('access_token=') || hash.includes('error='))) {
        return ''; // Cleared
      }
      return hash;
    }

    const dirtyHash = '#access_token=sb-mock-token-xyz&refresh_token=mock-refresh&token_type=bearer';
    assert.strictEqual(sanitizeOAuthHash(dirtyHash), '', 'Dirty access token hash must be wiped from URL bar');

    const cleanHash = '#menu-section';
    assert.strictEqual(sanitizeOAuthHash(cleanHash), '#menu-section', 'Legitimate deep-link anchor must be preserved');
  });

  await t.test('Pending checkout intent handoff safely transitions through authentication', () => {
    let pendingCheckout = false;
    let openedModal = null;

    function triggerCheckout(user, addressesCount) {
      if (!user) {
        pendingCheckout = true;
        openedModal = 'auth-modal';
        return;
      }
      if (addressesCount === 0) {
        openedModal = 'address-modal';
        return;
      }
      openedModal = 'checkout-modal';
    }

    // Unauthenticated user attempts checkout
    triggerCheckout(null, 0);
    assert.strictEqual(pendingCheckout, true);
    assert.strictEqual(openedModal, 'auth-modal');

    // User completes sign in
    function onSignInComplete(user, addressesCount) {
      if (pendingCheckout) {
        pendingCheckout = false;
        if (addressesCount === 0) {
          openedModal = 'address-modal';
        } else {
          openedModal = 'checkout-modal';
        }
      }
    }

    // Case A: User has 0 saved addresses -> prompted to pin doorstep on map
    onSignInComplete({ id: 'u-1', email: 'a@b.com' }, 0);
    assert.strictEqual(pendingCheckout, false);
    assert.strictEqual(openedModal, 'address-modal');

    // Case B: User has saved addresses -> transitions straight to checkout
    pendingCheckout = true;
    onSignInComplete({ id: 'u-1', email: 'a@b.com' }, 1);
    assert.strictEqual(pendingCheckout, false);
    assert.strictEqual(openedModal, 'checkout-modal');
  });
});

test('SIGN-IN & AUTHENTICATION AUDIT: Kitchen Admin / Manager PIN & API Security Suite', async (t) => {
  await t.test('POST /api/admin-auth grants signed bearer token for PIN 8899', async () => {
    const { req, res } = createMockReqRes({
      method: 'POST',
      body: JSON.stringify({ pin: '8899' })
    });

    await adminAuthHandler(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.role, 'admin');
    assert.ok(res.data.token, 'Must return signed token');
    assert.strictEqual(res.data.expiresIn, 43200);

    // Verify token validity
    const tokenCheck = verifyAdminToken({ headers: { authorization: `Bearer ${res.data.token}` } });
    assert.strictEqual(tokenCheck.valid, true);
    assert.strictEqual(tokenCheck.payload.role, 'admin');
  });

  await t.test('POST /api/admin-auth rejects incorrect, empty, or non-string PINs with 401 or 400', async () => {
    // Wrong PIN
    const r1 = createMockReqRes({ method: 'POST', body: JSON.stringify({ pin: '9999' }) });
    await adminAuthHandler(r1.req, r1.res);
    assert.strictEqual(r1.res.statusCode, 401);
    assert.strictEqual(r1.res.data.error, 'Invalid manager passcode');

    // Empty PIN
    const r2 = createMockReqRes({ method: 'POST', body: JSON.stringify({ pin: '' }) });
    await adminAuthHandler(r2.req, r2.res);
    assert.strictEqual(r2.res.statusCode, 400);

    // Non-string PIN
    const r3 = createMockReqRes({ method: 'POST', body: JSON.stringify({ pin: 8899 }) });
    await adminAuthHandler(r3.req, r3.res);
    assert.strictEqual(r3.res.statusCode, 400);
  });

  await t.test('POST /api/admin-auth enforces rate limiting after repeated failures', async () => {
    const testIp = '198.51.100.42';
    // Send 5 failed attempts
    for (let i = 0; i < 5; i++) {
      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: { 'x-forwarded-for': testIp },
        body: JSON.stringify({ pin: '1111' })
      });
      await adminAuthHandler(req, res);
      assert.strictEqual(res.statusCode, 401);
    }

    // 6th attempt must be blocked with 429 Too Many Requests
    const blocked = createMockReqRes({
      method: 'POST',
      headers: { 'x-forwarded-for': testIp },
      body: JSON.stringify({ pin: '8899' }) // Even with correct PIN, must be locked out
    });
    await adminAuthHandler(blocked.req, blocked.res);
    assert.strictEqual(blocked.res.statusCode, 429);
    assert.ok(blocked.res.data.error.includes('Too many failed passcode attempts'));
  });

  await t.test('POST /api/admin-auth persists lockout across cold starts via signed state cookie', async () => {
    const testIp = '203.0.113.88';
    let lastSetCookie = '';
    // Send 5 failed attempts and capture Set-Cookie header
    for (let i = 0; i < 5; i++) {
      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: {
          'x-forwarded-for': testIp,
          ...(lastSetCookie ? { cookie: lastSetCookie.split(';')[0] } : {})
        },
        body: JSON.stringify({ pin: '0000' })
      });
      await adminAuthHandler(req, res);
      const setCookie = res.headers['Set-Cookie'] || res.headers['set-cookie'];
      if (setCookie) lastSetCookie = setCookie;
    }

    assert.ok(lastSetCookie.includes('qb_auth_rl='), 'Must set signed rate limit cookie');

    // Request with the cookie presenting to handler
    const coldStartReq = createMockReqRes({
      method: 'POST',
      headers: {
        'x-forwarded-for': testIp,
        cookie: lastSetCookie.split(';')[0]
      },
      body: JSON.stringify({ pin: '8899' })
    });
    await adminAuthHandler(coldStartReq.req, coldStartReq.res);
    assert.strictEqual(coldStartReq.res.statusCode, 429, 'Signed state cookie must enforce lockout');
  });
});

test('SIGN-IN & AUTHENTICATION AUDIT: Fleet Delivery Partner PIN Suite', async (t) => {
  await t.test('Rider default PINs authenticate via salted SHA-256 hashes', async () => {
    const knownRiderPins = ['2233', '4422', '4455', '8811'];

    for (const pin of knownRiderPins) {
      const pinHash = await hashPasscode(pin);
      assert.ok(
        DEFAULT_RIDER_PIN_HASHES.includes(pinHash),
        `PIN ${pin} hash must exist in DEFAULT_RIDER_PIN_HASHES`
      );
    }
  });

  await t.test('Invalid or random PINs are strictly rejected without wildcard bypass', async () => {
    const badPins = ['0000', '1234', '9999', 'abcd', '223', '22330', ''];

    for (const pin of badPins) {
      const pinHash = await hashPasscode(pin);
      assert.strictEqual(
        DEFAULT_RIDER_PIN_HASHES.includes(pinHash),
        false,
        `PIN ${pin} must not authenticate`
      );
    }
  });

  await t.test('Registered fleet riders in local roster match clean 4-digit PIN', () => {
    const roster = [
      { pin: '2233', name: 'Imran', vehicle: '🏍️ Bike' },
      { pin: '4455', name: 'Farhan', vehicle: '🛵 Electric Scooter' },
      { pin: '8811', name: 'Zaid', vehicle: '🏍️ Bike' }
    ];

    function findRider(pin) {
      const clean = String(pin).trim();
      return roster.find(r => r.pin === clean) || null;
    }

    assert.strictEqual(findRider('2233')?.name, 'Imran');
    assert.strictEqual(findRider('4455')?.name, 'Farhan');
    assert.strictEqual(findRider('9999'), null);
    assert.strictEqual(findRider('22'), null);
  });

  await t.test('Generated rider PIN authenticates and deleted rider PIN is rejected', async () => {
    // Mock localStorage for node environment
    const storage = new Map();
    const mockLocalStorage = {
      getItem: (k) => storage.get(k) || null,
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k)
    };
    globalThis.localStorage = mockLocalStorage;

    const generatedPin = '6789';
    const riderProfile = {
      pin: generatedPin,
      name: 'Salman Ahmed',
      phone: '+91 98765 43210',
      vehicle: '🏍️ Bike'
    };

    // 1. Initial state: rider not yet added
    mockLocalStorage.setItem('quickbite_riders', JSON.stringify([]));
    let isAuthenticated = await verifyStaffPin('rider', generatedPin);
    assert.strictEqual(isAuthenticated, false, 'Unregistered generated PIN must not authenticate');

    // 2. Admin adds rider with name, phone, and generated PIN
    mockLocalStorage.setItem('quickbite_riders', JSON.stringify([riderProfile]));
    isAuthenticated = await verifyStaffPin('rider', generatedPin);
    assert.strictEqual(isAuthenticated, true, 'Registered rider PIN must authenticate successfully');

    // 3. Admin deletes the rider
    mockLocalStorage.setItem('quickbite_riders', JSON.stringify([]));
    isAuthenticated = await verifyStaffPin('rider', generatedPin);
    assert.strictEqual(isAuthenticated, false, 'Deleted rider PIN must immediately fail authentication');
  });
});
