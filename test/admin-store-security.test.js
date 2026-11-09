import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdminToken, signPayload } from '../api/_auth.js';
import { signPayload as signCloudflarePayload, createAdminToken as createCloudflareAdminToken } from '../functions/api/_auth.js';
import { verifyTurnstileToken as verifyCloudflareTurnstile } from '../functions/api/_turnstile.js';
import { getTurnstileSecretKey as getNodeTurnstileSecretKey } from '../api/_turnstile.js';
import adminStoreHandler from '../api/admin-store.js';
import { onRequest as cloudflareAdminStoreHandler } from '../functions/api/admin-store.js';
import orderActionHandler from '../api/order-action.js';
import { onRequest as cloudflareOrderActionHandler } from '../functions/api/order-action.js';
import nodeAdminAuthHandler from '../api/admin-auth.js';
import { onRequest as cloudflareAdminAuthHandler } from '../functions/api/admin-auth.js';
import nodeCheckoutHandler from '../api/checkout.js';
import { onRequest as cloudflareCheckoutHandler } from '../functions/api/checkout.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function createMockReqRes({ method = 'POST', headers = {}, body = null } = {}) {
  let statusCode = 200;
  let responseData = null;
  const responseHeaders = {};

  const req = {
    method,
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
    end() {
      return this;
    },
    get statusCode() {
      return statusCode;
    },
    get responseData() {
      return responseData;
    },
    get responseHeaders() {
      return responseHeaders;
    }
  };

  return { req, res };
}

test('ADMIN STORE & MENU SECURITY SUITE', async (t) => {
  await t.test('1. POST /api/admin-store rejects unauthenticated requests with 401', async () => {
    const { req, res } = createMockReqRes({
      method: 'POST',
      body: { action: 'toggle_stock', id: 'dish-1', in_stock: false }
    });
    await adminStoreHandler(req, res);
    assert.equal(res.statusCode, 401);
    assert.match(res.responseData?.error, /unauthorized|session required|missing/i);
  });

  await t.test('2. POST /api/admin-store rejects forged or malformed tokens with 401', async () => {
    const { req, res } = createMockReqRes({
      method: 'POST',
      headers: { authorization: 'Bearer invalid.token.payload' },
      body: { action: 'delete_dish', id: 'dish-1' }
    });
    await adminStoreHandler(req, res);
    assert.equal(res.statusCode, 401);
  });

  await t.test('3. POST /api/admin-store rejects requests missing action parameter with 400', async () => {
    const validToken = createAdminToken();
    const { req, res } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${validToken}` },
      body: {}
    });
    await adminStoreHandler(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.responseData?.error, /action/i);
  });

  await t.test('4. Migration 06 strictly excludes anon from write policies on dishes, categories, and store_settings', () => {
    const mig06Content = fs.readFileSync(
      path.resolve(rootDir, 'supabase_migration_06_secure_rls_and_payouts.sql'),
      'utf8'
    );

    // Verify staff_manage_dishes does not grant write to anon
    assert.doesNotMatch(
      mig06Content,
      /CREATE\s+POLICY\s+"staff_manage_dishes"\s+ON\s+public\.dishes[\s\S]*?TO\s+[^;]*anon/i,
      'staff_manage_dishes must not include anon in TO clause'
    );

    // Verify staff_manage_categories does not grant write to anon
    assert.doesNotMatch(
      mig06Content,
      /CREATE\s+POLICY\s+"staff_manage_categories"\s+ON\s+public\.categories[\s\S]*?TO\s+[^;]*anon/i,
      'staff_manage_categories must not include anon in TO clause'
    );

    // Verify staff_manage_store_settings does not grant write to anon
    assert.doesNotMatch(
      mig06Content,
      /CREATE\s+POLICY\s+"staff_manage_store_settings"\s+ON\s+public\.store_settings[\s\S]*?TO\s+[^;]*anon/i,
      'staff_manage_store_settings must not include anon in TO clause'
    );
  });

  await t.test('5. Migration 08 provides comprehensive RLS hardening across orders, dishes, categories, and settings', () => {
    const mig08Content = fs.readFileSync(
      path.resolve(rootDir, 'supabase_migration_08_secure_orders_rls.sql'),
      'utf8'
    );

    assert.match(mig08Content, /CREATE\s+POLICY\s+"public_read_dishes"/, 'Must include public_read_dishes');
    assert.match(mig08Content, /CREATE\s+POLICY\s+"service_manage_dishes"/, 'Must include service_manage_dishes');
    assert.match(mig08Content, /CREATE\s+POLICY\s+"service_manage_store_settings"/, 'Must include service_manage_store_settings');
    assert.doesNotMatch(
      mig08Content,
      /CREATE\s+POLICY\s+"staff_manage_dishes"[\s\S]*?TO\s+[^;]*anon/i,
      'Migration 08 must not grant write to anon on dishes'
    );
  });

  await t.test('6. POST /api/admin-store rejects save_settings with 403 Forbidden for kitchen admin role', async () => {
    const adminToken = createAdminToken('admin');
    const { req, res } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}` },
      body: { action: 'save_settings', settings: { restaurant_name: 'Hacked' } }
    });
    await adminStoreHandler(req, res);
    assert.equal(res.statusCode, 403);
    assert.match(res.responseData?.error, /Owner role required/i);
  });

  await t.test('7. POST /api/admin-store permits save_settings for executive owner role (bypasses 403 role gate)', async () => {
    const ownerToken = createAdminToken('owner');
    const { req, res } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${ownerToken}` },
      body: { action: 'save_settings', settings: { restaurant_name: 'Savera Paradise' } }
    });
    await adminStoreHandler(req, res);
    // Role gate passes: it must NOT return 403 Forbidden
    assert.notEqual(res.statusCode, 403, 'Owner token must bypass the 403 role gate');
  });

  await t.test('8. Migration 08 strictly excludes anon from SELECT, UPDATE, and DELETE policies on public.orders', () => {
    const mig08Content = fs.readFileSync(
      path.resolve(rootDir, 'supabase_migration_08_secure_orders_rls.sql'),
      'utf8'
    );

    // Verify app_read_orders and app_update_orders are explicitly dropped
    assert.match(mig08Content, /DROP\s+POLICY\s+IF\s+EXISTS\s+"app_read_orders"\s+ON\s+public\.orders/i);
    assert.match(mig08Content, /DROP\s+POLICY\s+IF\s+EXISTS\s+"app_update_orders"\s+ON\s+public\.orders/i);

    // Verify zero policies on public.orders grant permissions to anon
    assert.doesNotMatch(
      mig08Content,
      /CREATE\s+POLICY\s+"[^"]+"\s+ON\s+public\.orders[^;]*?TO\s+[^;]*\banon\b/i,
      'Migration 08 must not grant any policy on public.orders to anon'
    );
  });

  await t.test('9. POST /api/order-action rejects unauthenticated staff actions with 401', async () => {
    for (const action of ['sync_orders', 'update_status', 'claim_order']) {
      const { req, res } = createMockReqRes({
        method: 'POST',
        body: { action, orderId: 'ORD-123' }
      });
      await orderActionHandler(req, res);
      assert.equal(res.statusCode, 401, `Action ${action} must require valid staff/rider token`);
      assert.match(res.responseData?.error, /unauthorized|session required|missing/i);
    }
  });

  await t.test('10. POST /api/order-action rejects customer cancellation missing a tracking token with 403 Forbidden', async () => {
    const { req, res } = createMockReqRes({
      method: 'POST',
      body: { action: 'cancel_order', orderId: 'ORD-123' }
    });
    await orderActionHandler(req, res);
    assert.equal(res.statusCode, 403);
    assert.match(res.responseData?.error, /Forbidden: Valid cancellation token or staff session required/i);
  });

  await t.test('11. POST /api/order-action rejects requests missing action parameter with 400', async () => {
    const { req, res } = createMockReqRes({
      method: 'POST',
      body: {}
    });
    await orderActionHandler(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.responseData?.error, /action/i);
  });

  await t.test('12. POST /api/order-action rejects non-POST HTTP methods with 405 Method Not Allowed', async () => {
    const { req, res } = createMockReqRes({
      method: 'GET'
    });
    await orderActionHandler(req, res);
    assert.equal(res.statusCode, 405);
    assert.equal(res.responseHeaders['Allow'], 'POST, OPTIONS');
  });

  await t.test('13. POST /api/order-action CORS allows trusted domains and rejects arbitrary origins', async () => {
    // Trusted origin
    const { req: req1, res: res1 } = createMockReqRes({
      method: 'POST',
      headers: { origin: 'https://saveraparadise.com' },
      body: {}
    });
    await orderActionHandler(req1, res1);
    assert.equal(res1.responseHeaders['Access-Control-Allow-Origin'], 'https://saveraparadise.com');

    // Untrusted origin
    const { req: req2, res: res2 } = createMockReqRes({
      method: 'POST',
      headers: { origin: 'https://evil-attacker.com' },
      body: {}
    });
    await orderActionHandler(req2, res2);
    assert.equal(res2.responseHeaders['Access-Control-Allow-Origin'], undefined);
  });

  await t.test('14. POST /api/order-action create_order rejects unverified request lacking checkoutToken with 400', async () => {
    const { req, res } = createMockReqRes({
      method: 'POST',
      body: {
        action: 'create_order',
        order: { id: '#QB-123', total: '₹10', items: [] }
      }
    });
    await orderActionHandler(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.responseData?.message || res.responseData?.error, /checkout token/i);
  });

  await t.test('15. POST /api/order-action create_order rejects forged or tampered checkoutToken with 400', async () => {
    const { req, res } = createMockReqRes({
      method: 'POST',
      body: {
        action: 'create_order',
        checkoutToken: 'forged.signature.token',
        order: { id: '#QB-123', total: '₹10', items: [] }
      }
    });
    await orderActionHandler(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.responseData?.message || res.responseData?.error, /verification failed/i);
  });

  await t.test('16. POST /api/order-action create_order enforces signed total from genuine checkout token', async () => {
    const validToken = signPayload({
      numericTotal: 450,
      total: '₹450',
      items: [{ name: 'Biryani Special', price: 450, quantity: 1 }],
      discount: 50,
      deliveryFee: 0,
      platformFee: 5,
      timestamp: Date.now()
    });

    const { req, res } = createMockReqRes({
      method: 'POST',
      body: {
        action: 'create_order',
        checkoutToken: validToken,
        order: {
          id: '#QB-TEST-450',
          total: '₹10', // Tampered client price attempted
          items: [{ name: 'Biryani', price: 10, quantity: 1 }]
        }
      }
    });
    await orderActionHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.responseData?.success, true);
    // Verified authoritative total must override manipulated total
    assert.equal(res.responseData?.order?.total, '₹450');
  });

  await t.test('16b. POST /api/order-action create_order extracts numericTotal and never saves ₹0 for verified orders', async () => {
    // Simulates token from functions/api/checkout.js which emits numericTotal
    const validToken = signPayload({
      numericTotal: 320,
      discount: 0,
      deliveryFee: 40,
      platformFee: 0,
      items: [{ name: 'Chicken Kebab', price: 140, quantity: 2 }],
      timestamp: Date.now()
    });

    const { req, res } = createMockReqRes({
      method: 'POST',
      body: {
        action: 'create_order',
        checkoutToken: validToken,
        order: {
          id: '#QB-TEST-320',
          total: '₹10',
          items: [{ name: 'Chicken Kebab', price: 140, quantity: 2 }]
        }
      }
    });
    await orderActionHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.responseData?.success, true);
    assert.equal(res.responseData?.order?.total, '₹320', 'Total must be correctly formatted from numericTotal, not ₹0');
  });

  await t.test('16c. POST /api/order-action create_order enforces signed cart items from decoded token (prevents cart item swapping)', async () => {
    // Token was generated for 1 Chai (₹15)
    const validChaiToken = signPayload({
      numericTotal: 15,
      total: '₹15',
      items: [{ name: 'Chai', price: 15, quantity: 1 }],
      timestamp: Date.now()
    });

    // Attacker sends the ₹15 token but swaps cart to expensive Biryani
    const { req, res } = createMockReqRes({
      method: 'POST',
      body: {
        action: 'create_order',
        checkoutToken: validChaiToken,
        order: {
          id: '#QB-TEST-SWAP',
          total: '₹15',
          items: [
            { name: 'Mutton Biryani Special', price: 350, quantity: 4 },
            { name: 'Tandoori Platter', price: 600, quantity: 2 }
          ]
        }
      }
    });
    await orderActionHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.responseData?.success, true);
    // Items MUST be the signed items (Chai), not the swapped Biryani items
    assert.equal(res.responseData?.order?.items?.length, 1);
    assert.equal(res.responseData?.order?.items?.[0]?.name, 'Chai');
    assert.equal(res.responseData?.order?.items_summary, '1x Chai');
  });

  await t.test('17. POST /api/order-action create_order permits authenticated staff session', async () => {
    const staffToken = createAdminToken();
    const { req, res } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${staffToken}` },
      body: {
        action: 'create_order',
        order: {
          id: '#QB-POS-100',
          total: '₹200',
          items: [{ name: 'Parotta', price: 50, quantity: 4 }]
        }
      }
    });
    await orderActionHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.responseData?.success, true);
    assert.equal(res.responseData?.orderId, '#QB-POS-100');
  });

  await t.test('18. Migration 08 & 09 strictly exclude anon and public from INSERT policies on public.orders', () => {
    const mig08Content = fs.readFileSync(
      path.resolve(rootDir, 'supabase_migration_08_secure_orders_rls.sql'),
      'utf8'
    );
    const mig09Content = fs.readFileSync(
      path.resolve(rootDir, 'supabase_migration_09_secure_order_gateways.sql'),
      'utf8'
    );

    // Verify public_create_orders policy is dropped in both migrations
    assert.match(mig08Content, /DROP\s+POLICY\s+IF\s+EXISTS\s+"public_create_orders"/i);
    assert.match(mig09Content, /DROP\s+POLICY\s+IF\s+EXISTS\s+"public_create_orders"/i);

    // Verify zero CREATE POLICY statements grant INSERT to anon or public on public.orders
    assert.doesNotMatch(
      mig08Content,
      /CREATE\s+POLICY\s+"[^"]+"\s+ON\s+public\.orders[^;]*?FOR\s+INSERT[^;]*?TO\s+[^;]*\b(?:anon|public)\b/i,
      'Migration 08 must not grant INSERT to anon or public'
    );
    assert.doesNotMatch(
      mig09Content,
      /CREATE\s+POLICY\s+"[^"]+"\s+ON\s+public\.orders[^;]*?FOR\s+INSERT[^;]*?TO\s+[^;]*\b(?:anon|public)\b/i,
      'Migration 09 must not grant INSERT to anon or public'
    );
  });

  await t.test('19. verifyTurnstileToken fails closed in production when secret is missing', async () => {
    const prodEnv = { NODE_ENV: 'production' };
    const res = await verifyCloudflareTurnstile('some-token', '127.0.0.1', null, prodEnv);
    assert.equal(res.success, false, 'Must fail closed when secret is missing in production');
    assert.equal(res.unconfigured, true);
  });

  await t.test('20. Node api/_turnstile getTurnstileSecretKey fails closed when ENVIRONMENT=production', () => {
    const origEnv = process.env.ENVIRONMENT;
    const origNodeEnv = process.env.NODE_ENV;
    const origSecret = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
    try {
      delete process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
      delete process.env.TURNSTILE_SECRET_KEY;
      process.env.ENVIRONMENT = 'production';
      delete process.env.NODE_ENV;
      const key = getNodeTurnstileSecretKey();
      assert.equal(key, '', 'Must not return test key when ENVIRONMENT=production');
    } finally {
      if (origEnv !== undefined) process.env.ENVIRONMENT = origEnv; else delete process.env.ENVIRONMENT;
      if (origNodeEnv !== undefined) process.env.NODE_ENV = origNodeEnv; else delete process.env.NODE_ENV;
      if (origSecret !== undefined) process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = origSecret; else delete process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
    }
  });

  await t.test('21. Order creation rejects checkout token with missing or empty items', async () => {
    const emptyItemsToken = signPayload({
      numericTotal: 100,
      total: '₹100',
      items: [],
      timestamp: Date.now()
    });

    // Test Node handler
    const { req, res } = createMockReqRes({
      method: 'POST',
      body: {
        action: 'create_order',
        checkoutToken: emptyItemsToken,
        order: {
          id: '#QB-TEST-EMPTY',
          total: '₹100',
          items: [{ name: 'Biryani', price: 100, quantity: 1 }]
        }
      }
    });
    await orderActionHandler(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.responseData?.error, 'Invalid Token Items');

    // Test Cloudflare Pages handler
    const mockCfEnv = { SESSION_SECRET: 'test_session_secret_32_characters_long_secure_key!' };
    const emptyItemsCfToken = signCloudflarePayload({
      numericTotal: 100,
      total: '₹100',
      items: [],
      timestamp: Date.now()
    }, mockCfEnv);

    const cfReq = new Request('https://saveraparadise.com/api/order-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_order',
        checkoutToken: emptyItemsCfToken,
        order: {
          id: '#QB-TEST-EMPTY-CF',
          total: '₹100',
          items: [{ name: 'Biryani', price: 100, quantity: 1 }]
        }
      })
    });
    const cfRes = await cloudflareOrderActionHandler({ request: cfReq, env: mockCfEnv });
    assert.equal(cfRes.status, 400);
    const cfData = await cfRes.json();
    assert.equal(cfData.error, 'Invalid Token Items');
  });

  await t.test('22. Cloudflare Pages onRequest executes create_order without ReferenceError and enforces signed items', async () => {
    const mockCfEnv = { SESSION_SECRET: 'test_session_secret_32_characters_long_secure_key!' };
    const validToken = signCloudflarePayload({
      numericTotal: 280,
      total: '₹280',
      items: [{ name: 'Chicken Biryani', price: 280, quantity: 1 }],
      timestamp: Date.now()
    }, mockCfEnv);

    const cfReq = new Request('https://saveraparadise.com/api/order-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_order',
        checkoutToken: validToken,
        order: {
          id: '#QB-TEST-CF-OK',
          total: '₹20',
          items: [{ name: 'Free Biryani Fake', price: 20, quantity: 1 }]
        }
      })
    });
    const cfRes = await cloudflareOrderActionHandler({ request: cfReq, env: mockCfEnv });
    assert.equal(cfRes.status, 200);
    const cfData = await cfRes.json();
    assert.equal(cfData.success, true);
    assert.equal(cfData.order.total, '₹280');
    assert.equal(cfData.order.items.length, 1);
    assert.equal(cfData.order.items[0].name, 'Chicken Biryani');
    assert.equal(cfData.order.items_summary, '1x Chicken Biryani');
  });

  await t.test('23. /api/checkout strictly clamps negative platformFee to 0 and blocks price reduction', async () => {
    const testItems = [
      { id: '1', name: 'Biryani', price: 200, quantity: 1 }
    ];

    // Node handler check
    const { req, res } = createMockReqRes({
      method: 'POST',
      body: {
        items: testItems,
        catalogDishes: [{ id: '1', name: 'Biryani', price: 200 }],
        storeSettings: {
          platformFee: -500,
          deliveryFeeStandard: 40,
          freeDeliveryEnabled: false
        }
      }
    });
    await nodeCheckoutHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.responseData?.platformFee, 0, 'Platform fee must be clamped >= 0');
    assert.ok(res.responseData?.numericTotal >= 200, 'Total must never be reduced by negative platformFee');

    // Cloudflare Pages handler check
    const cfReq = new Request('https://saveraparadise.com/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: testItems,
        catalogDishes: [{ id: '1', name: 'Biryani', price: 200 }],
        storeSettings: {
          platformFee: -500,
          deliveryFeeStandard: 40,
          freeDeliveryEnabled: false
        }
      })
    });
    const cfRes = await cloudflareCheckoutHandler({
      request: cfReq,
      env: { SESSION_SECRET: 'test_session_secret_32_characters_long_secure_key!' }
    });
    assert.equal(cfRes.status, 200);
    const cfData = await cfRes.json();
    assert.equal(cfData.platformFee, 0, 'Cloudflare platform fee must be clamped >= 0');
    assert.ok(cfData.numericTotal >= 200, 'Total must never be reduced by negative platformFee');
  });

  await t.test('24. In production mode, checkout completely strips client-supplied storeSettings when server settings unavailable', async () => {
    const origEnv = process.env.ENVIRONMENT;
    const origNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      process.env.ENVIRONMENT = 'production';

      const cfReq = new Request('https://saveraparadise.com/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ id: '1', name: 'Biryani', price: 200, quantity: 1 }],
          catalogDishes: [{ id: '1', name: 'Biryani', price: 200 }],
          storeSettings: {
            platformFee: -300,
            offerPromoCode: 'FREEBIE',
            offerDiscountAmount: 200,
            offerDiscountType: 'fixed'
          },
          promoCode: 'FREEBIE'
        })
      });
      const cfRes = await cloudflareCheckoutHandler({
        request: cfReq,
        env: {
          NODE_ENV: 'production',
          ENVIRONMENT: 'production',
          SESSION_SECRET: 'test_session_secret_32_characters_long_secure_key!'
        }
      });
      if (cfRes.status === 200) {
        const cfData = await cfRes.json();
        assert.equal(cfData.platformFee, 0);
        assert.notEqual(cfData.appliedPromo, 'FREEBIE', 'In production, fake client-supplied promo must not apply');
      } else {
        assert.equal(cfRes.status, 503, 'In production, unverified catalog returns 503 safely');
      }
    } finally {
      if (origEnv !== undefined) process.env.ENVIRONMENT = origEnv; else delete process.env.ENVIRONMENT;
      if (origNodeEnv !== undefined) process.env.NODE_ENV = origNodeEnv; else delete process.env.NODE_ENV;
    }
  });

  await t.test('25. POST /api/order-action create_order defends against order takeover on duplicate order ID collision', async () => {
    const validToken = signPayload({
      numericTotal: 200,
      total: '₹200',
      items: [{ name: 'Biryani', price: 200, quantity: 1 }],
      timestamp: Date.now()
    });

    // 1. Attacker attempts to take over existing order #QB-8888 by submitting duplicate ID without trackingToken
    const { req: attackReq, res: attackRes } = createMockReqRes({
      method: 'POST',
      body: {
        action: 'create_order',
        checkoutToken: validToken,
        simulateDuplicateKey: true,
        order: {
          id: '#QB-8888',
          total: '₹200',
          items: [{ name: 'Biryani', price: 200, quantity: 1 }]
        }
      }
    });
    await orderActionHandler(attackReq, attackRes);
    assert.equal(attackRes.statusCode, 200);
    assert.equal(attackRes.responseData?.success, true);
    // Attacker must NEVER receive victim's token
    assert.notEqual(attackRes.responseData?.trackingToken, 'victim-secret-token-12345');
    // Order must be assigned a collision-free safe ID
    assert.ok(attackRes.responseData?.orderId.startsWith('#QB-8888-'), 'Must assign unique suffix on collision');
    assert.equal(attackRes.responseData?.resolvedCollision, true);

    // 2. Legitimate creator retrying with matching tracking token is allowed idempotent response
    const { req: retryReq, res: retryRes } = createMockReqRes({
      method: 'POST',
      body: {
        action: 'create_order',
        checkoutToken: validToken,
        simulateDuplicateKey: true,
        trackingToken: 'victim-secret-token-12345',
        order: {
          id: '#QB-8888',
          total: '₹200',
          items: [{ name: 'Biryani', price: 200, quantity: 1 }]
        }
      }
    });
    await orderActionHandler(retryReq, retryRes);
    assert.equal(retryRes.statusCode, 200);
    assert.equal(retryRes.responseData?.idempotent, true);
    assert.equal(retryRes.responseData?.trackingToken, 'victim-secret-token-12345');

    // 3. Test Cloudflare Pages handler for identical anti-takeover collision defense
    const mockCfEnv = { SESSION_SECRET: 'test_session_secret_32_characters_long_secure_key!' };
    const validCfToken = signCloudflarePayload({
      numericTotal: 200,
      total: '₹200',
      items: [{ name: 'Biryani', price: 200, quantity: 1 }],
      timestamp: Date.now()
    }, mockCfEnv);

    const cfAttackReq = new Request('https://saveraparadise.com/api/order-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_order',
        checkoutToken: validCfToken,
        simulateDuplicateKey: true,
        order: {
          id: '#QB-9999',
          total: '₹200',
          items: [{ name: 'Biryani', price: 200, quantity: 1 }]
        }
      })
    });
    const cfAttackRes = await cloudflareOrderActionHandler({ request: cfAttackReq, env: mockCfEnv });
    assert.equal(cfAttackRes.status, 200);
    const cfAttackData = await cfAttackRes.json();
    assert.notEqual(cfAttackData.trackingToken, 'victim-secret-token-12345');
    assert.ok(cfAttackData.orderId.startsWith('#QB-9999-'));
    assert.equal(cfAttackData.resolvedCollision, true);
  });

  await t.test('26. Rider role access control isolates order data, updates, and claims per rider', async () => {
    // 1. Rider login embeds riderPin into signed token payload
    const riderAToken = createAdminToken(undefined, 'rider', { riderPin: '2233' });
    const riderBToken = createAdminToken(undefined, 'rider', { riderPin: '4422' });
    const adminToken = createAdminToken(undefined, 'admin');

    const sampleOrders = [
      { id: '#QB-101', status: 'ready_for_pickup', assigned_rider_pin: null, tracking_token: 'cust-secret-101', total: '₹500' },
      { id: '#QB-102', status: 'on_the_way', assigned_rider_pin: '2233', tracking_token: 'cust-secret-102', total: '₹350' },
      { id: '#QB-103', status: 'on_the_way', assigned_rider_pin: '4422', tracking_token: 'cust-secret-103', total: '₹400' },
      { id: '#QB-104', status: 'delivered', assigned_rider_pin: '4422', tracking_token: 'cust-secret-104', total: '₹600' }
    ];

    // 2. Rider A calls sync_orders:
    // MUST receive only Rider A's assigned order (#QB-102) and unassigned pickup order (#QB-101)
    // MUST NOT receive Rider B's orders (#QB-103, #QB-104)
    // MUST NOT receive any customer tracking_tokens
    const { req: syncReqA, res: syncResA } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${riderAToken}` },
      body: { action: 'sync_orders', simulateOrders: sampleOrders }
    });
    await orderActionHandler(syncReqA, syncResA);
    assert.equal(syncResA.statusCode, 200);
    const ordersA = syncResA.responseData?.orders || [];
    assert.equal(ordersA.length, 2, 'Rider A must only see their own order and unassigned pickup order');
    assert.deepEqual(ordersA.map(o => o.id).sort(), ['#QB-101', '#QB-102']);
    assert.equal(ordersA.some(o => o.id === '#QB-103' || o.id === '#QB-104'), false, 'Rider A must never see Rider B orders');
    assert.equal(ordersA.some(o => Boolean(o.tracking_token || o.trackingToken)), false, 'Customer tracking tokens must be stripped');

    // 3. Admin calls sync_orders:
    // Admin receives all orders without scoping
    const { req: syncReqAdmin, res: syncResAdmin } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}` },
      body: { action: 'sync_orders', simulateOrders: sampleOrders }
    });
    await orderActionHandler(syncReqAdmin, syncResAdmin);
    assert.equal(syncResAdmin.statusCode, 200);
    assert.equal(syncResAdmin.responseData?.orders?.length, 4, 'Admin must see all orders');

    // 4. Rider A attempts to modify Rider B's order status:
    // MUST be rejected with 403 Forbidden
    const { req: updateAttackReq, res: updateAttackRes } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${riderAToken}` },
      body: { action: 'update_status', orderId: '#QB-103', status: 'delivered', simulateOrders: sampleOrders }
    });
    await orderActionHandler(updateAttackReq, updateAttackRes);
    assert.equal(updateAttackRes.statusCode, 403, 'Rider A cannot modify Rider B order');
    assert.match(updateAttackRes.responseData?.error, /cannot modify an order assigned to another rider/i);

    // 5. Rider A modifies their own order status:
    // MUST succeed with 200
    const { req: updateOwnReq, res: updateOwnRes } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${riderAToken}` },
      body: { action: 'update_status', orderId: '#QB-102', status: 'delivered', cashCollected: 350, simulateOrders: sampleOrders }
    });
    await orderActionHandler(updateOwnReq, updateOwnRes);
    assert.equal(updateOwnRes.statusCode, 200);
    assert.equal(updateOwnRes.responseData?.order?.status, 'delivered');

    // 6. Rider A attempts to claim an order already claimed by Rider B:
    // MUST be rejected with 409 Conflict
    const { req: claimConflictReq, res: claimConflictRes } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${riderAToken}` },
      body: { action: 'claim_order', orderId: '#QB-103', simulateOrders: sampleOrders }
    });
    await orderActionHandler(claimConflictReq, claimConflictRes);
    assert.equal(claimConflictRes.statusCode, 409, 'Rider cannot take over order claimed by another rider');
    assert.match(claimConflictRes.responseData?.error, /already claimed by another rider/i);

    // 7. Rider A claims unassigned order:
    // MUST succeed and be bound to Rider A's PIN
    const { req: claimOkReq, res: claimOkRes } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${riderAToken}` },
      body: { action: 'claim_order', orderId: '#QB-101', simulateOrders: sampleOrders }
    });
    await orderActionHandler(claimOkReq, claimOkRes);
    assert.equal(claimOkRes.statusCode, 200);
    assert.equal(claimOkRes.responseData?.order?.assigned_rider_pin, '2233');

    // 8. Cloudflare Pages Function parity check
    const mockCfEnv = { SESSION_SECRET: 'test_session_secret_32_characters_long_secure_key!' };
    const cfRiderAToken = createCloudflareAdminToken(undefined, 'rider', mockCfEnv, { riderPin: '2233' });

    const cfSyncReq = new Request('https://saveraparadise.com/api/order-action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfRiderAToken}`
      },
      body: JSON.stringify({ action: 'sync_orders', simulateOrders: sampleOrders })
    });
    const cfSyncRes = await cloudflareOrderActionHandler({ request: cfSyncReq, env: mockCfEnv });
    assert.equal(cfSyncRes.status, 200);
    const cfSyncData = await cfSyncRes.json();
    assert.equal(cfSyncData.orders.length, 2);
    assert.equal(cfSyncData.orders.some(o => o.id === '#QB-103'), false);
    assert.equal(cfSyncData.orders.some(o => Boolean(o.tracking_token || o.trackingToken)), false);

    // CF update attack rejected with 403
    const cfUpdateReq = new Request('https://saveraparadise.com/api/order-action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfRiderAToken}`
      },
      body: JSON.stringify({ action: 'update_status', orderId: '#QB-103', status: 'delivered', simulateOrders: sampleOrders })
    });
    const cfUpdateRes = await cloudflareOrderActionHandler({ request: cfUpdateReq, env: mockCfEnv });
    assert.equal(cfUpdateRes.status, 403);
    const cfUpdateData = await cfUpdateRes.json();
    assert.match(cfUpdateData.error, /cannot modify an order assigned to another rider/i);

    // CF claim conflict rejected with 409
    const cfClaimReq = new Request('https://saveraparadise.com/api/order-action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfRiderAToken}`
      },
      body: JSON.stringify({ action: 'claim_order', orderId: '#QB-103', simulateOrders: sampleOrders })
    });
    const cfClaimRes = await cloudflareOrderActionHandler({ request: cfClaimReq, env: mockCfEnv });
    assert.equal(cfClaimRes.status, 409);
    const cfClaimData = await cfClaimRes.json();
    assert.match(cfClaimData.error, /already claimed by another rider/i);
  });

  await t.test('27. Complete Rider Lifecycle, Atomic Claim Concurrency & Dynamic Authentication Security', async () => {
    const mockCfEnv = { SESSION_SECRET: 'test_session_secret_32_characters_long_secure_key!' };
    const simulatedDbRiders = [
      { pin: '7788', name: 'Dynamic Rider A', status: 'online' },
      { pin: '1122', name: 'Inactive Rider B', status: 'inactive' }
    ];

    // 1. Dynamic Rider Database Authentication in Node & Cloudflare
    const { req: dynReq, res: dynRes } = createMockReqRes({
      method: 'POST',
      body: { pin: '7788', simulateDynamicRiders: simulatedDbRiders }
    });
    await nodeAdminAuthHandler(dynReq, dynRes);
    assert.equal(dynRes.statusCode, 200, 'Dynamic active database rider must authenticate');
    assert.equal(dynRes.responseData?.role, 'rider');
    assert.equal(dynRes.responseData?.riderPin, '7788');
    const dynamicRiderToken = dynRes.responseData?.token;
    assert.ok(dynamicRiderToken);

    // Inactive dynamic rider rejected with 401
    const { req: inactReq, res: inactRes } = createMockReqRes({
      method: 'POST',
      body: { pin: '1122', simulateDynamicRiders: simulatedDbRiders }
    });
    await nodeAdminAuthHandler(inactReq, inactRes);
    assert.equal(inactRes.statusCode, 401, 'Inactive database rider must be rejected');

    // Cloudflare Pages parity for dynamic rider auth
    const cfDynReq = new Request('https://saveraparadise.com/api/admin-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '7788', simulateDynamicRiders: simulatedDbRiders })
    });
    const cfDynRes = await cloudflareAdminAuthHandler({ request: cfDynReq, env: mockCfEnv });
    assert.equal(cfDynRes.status, 200);
    const cfDynData = await cfDynRes.json();
    assert.equal(cfDynData.role, 'rider');
    assert.equal(cfDynData.riderPin, '7788');

    // 2. Lifecycle orders setup
    const testOrders = [
      { id: '#QB-COOK-1', status: 'cooking', assigned_rider_pin: null, tracking_token: 'tok-c1' },
      { id: '#QB-PEND-1', status: 'pending', assigned_rider_pin: null, tracking_token: 'tok-p1' },
      { id: '#QB-READY-1', status: 'ready_for_pickup', assigned_rider_pin: null, tracking_token: 'tok-r1' },
      { id: '#QB-OTW-1', status: 'on_the_way', assigned_rider_pin: '7788', tracking_token: 'tok-o1', total: '₹350', numeric_total: 350 },
      { id: '#QB-DELIV-1', status: 'delivered', assigned_rider_pin: '7788', tracking_token: 'tok-d1' }
    ];

    // 3. Claiming orders in 'cooking' or 'pending' is rejected with 400
    const { req: claimCookReq, res: claimCookRes } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${dynamicRiderToken}` },
      body: { action: 'claim_order', orderId: '#QB-COOK-1', simulateOrders: testOrders }
    });
    await orderActionHandler(claimCookReq, claimCookRes);
    assert.equal(claimCookRes.statusCode, 400, 'Cannot claim food that is still cooking in kitchen');
    assert.match(claimCookRes.responseData?.error, /not ready for pickup/i);

    const { req: claimPendReq, res: claimPendRes } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${dynamicRiderToken}` },
      body: { action: 'claim_order', orderId: '#QB-PEND-1', simulateOrders: testOrders }
    });
    await orderActionHandler(claimPendReq, claimPendRes);
    assert.equal(claimPendRes.statusCode, 400, 'Cannot claim pending order');

    // 4. Rider sending status: 'delivered' on claim is ignored; server enforces on_the_way & step 3
    const { req: claimTamperReq, res: claimTamperRes } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${dynamicRiderToken}` },
      body: {
        action: 'claim_order',
        orderId: '#QB-READY-1',
        status: 'delivered', // Tampered status injection
        stepIndex: 4,
        simulateOrders: testOrders
      }
    });
    await orderActionHandler(claimTamperReq, claimTamperRes);
    assert.equal(claimTamperRes.statusCode, 200);
    assert.equal(claimTamperRes.responseData?.order?.status, 'on_the_way', 'Server must enforce on_the_way on claim');
    assert.equal(claimTamperRes.responseData?.order?.step_index, 3, 'Server must enforce step 3 on claim');
    assert.equal(claimTamperRes.responseData?.order?.assigned_rider_pin, '7788');

    // 5. Concurrent Claim Atomicity Simulation
    // When a second rider races to claim an already claimed order in the interim
    const riderBToken = createAdminToken(undefined, 'rider', { riderPin: '4422' });
    const { req: concurrentReq, res: concurrentRes } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${riderBToken}` },
      body: {
        action: 'claim_order',
        orderId: '#QB-READY-1',
        simulateOrders: testOrders,
        simulateConcurrentClaim: true // Simulates database returning 0 rows due to race condition
      }
    });
    await orderActionHandler(concurrentReq, concurrentRes);
    assert.equal(concurrentRes.statusCode, 409, 'Concurrent claim collision must return 409 Conflict');
    assert.match(concurrentRes.responseData?.error, /already claimed by another rider or is no longer available/i);

    // 6. Strict Rider Status State Machine on update_status
    // 6a. Unassigned order cannot be updated via update_status
    const { req: unassignedUpReq, res: unassignedUpRes } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${dynamicRiderToken}` },
      body: { action: 'update_status', orderId: '#QB-READY-1', status: 'on_the_way', simulateOrders: testOrders }
    });
    await orderActionHandler(unassignedUpReq, unassignedUpRes);
    assert.equal(unassignedUpRes.statusCode, 403, 'Unassigned order cannot be updated via update_status');
    assert.match(unassignedUpRes.responseData?.error, /must be claimed via claim_order/i);

    // 6b. Rider cannot skip from on_the_way back to cooking or pending
    const { req: skipBackReq, res: skipBackRes } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${dynamicRiderToken}` },
      body: { action: 'update_status', orderId: '#QB-OTW-1', status: 'cooking', simulateOrders: testOrders }
    });
    await orderActionHandler(skipBackReq, skipBackRes);
    assert.equal(skipBackRes.statusCode, 400, 'Rider cannot regress delivery to cooking');
    assert.match(skipBackRes.responseData?.error, /invalid status transition/i);

    // 6c. Rider cannot modify delivered order (terminal state)
    const { req: terminalReq, res: terminalRes } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${dynamicRiderToken}` },
      body: { action: 'update_status', orderId: '#QB-DELIV-1', status: 'on_the_way', simulateOrders: testOrders }
    });
    await orderActionHandler(terminalReq, terminalRes);
    assert.equal(terminalRes.statusCode, 400, 'Delivered order is terminal');
    assert.match(terminalRes.responseData?.error, /terminal state/i);

    // 6d. Valid transition from on_the_way to delivered with cash collected
    const { req: validDelivReq, res: validDelivRes } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${dynamicRiderToken}` },
      body: {
        action: 'update_status',
        orderId: '#QB-OTW-1',
        status: 'delivered',
        cashCollected: 350,
        simulateOrders: testOrders
      }
    });
    await orderActionHandler(validDelivReq, validDelivRes);
    assert.equal(validDelivRes.statusCode, 200);
    assert.equal(validDelivRes.responseData?.order?.status, 'delivered');
    assert.equal(validDelivRes.responseData?.order?.step_index, 4);

    // 7. Cloudflare Pages Functions parity for complete lifecycle
    const cfClaimCookReq = new Request('https://saveraparadise.com/api/order-action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${dynamicRiderToken}`
      },
      body: JSON.stringify({ action: 'claim_order', orderId: '#QB-COOK-1', simulateOrders: testOrders })
    });
    const cfClaimCookRes = await cloudflareOrderActionHandler({ request: cfClaimCookReq, env: mockCfEnv });
    assert.equal(cfClaimCookRes.status, 400);

    const cfConcurrentReq = new Request('https://saveraparadise.com/api/order-action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${riderBToken}`
      },
      body: JSON.stringify({
        action: 'claim_order',
        orderId: '#QB-READY-1',
        simulateOrders: testOrders,
        simulateConcurrentClaim: true
      })
    });
    const cfConcurrentRes = await cloudflareOrderActionHandler({ request: cfConcurrentReq, env: mockCfEnv });
    assert.equal(cfConcurrentRes.status, 409);
    const cfConcurrentData = await cfConcurrentRes.json();
    assert.match(cfConcurrentData.error, /already claimed by another rider or is no longer available/i);
  });

  await t.test('28. Atomic status update race prevention, COD cash collection validation & Migration 10 riders table security', async () => {
    const mockCfEnv = { SESSION_SECRET: 'test_session_secret_32_characters_long_secure_key!' };
    const riderToken = createAdminToken(undefined, 'rider', { riderPin: '5566' });

    // 1. Migration 10, Migration 06 & setup.sql verification
    const mig10Path = path.resolve(rootDir, 'supabase_migration_10_secure_riders_rls.sql');
    assert.ok(fs.existsSync(mig10Path), 'Migration 10 file must exist');
    const mig10Content = fs.readFileSync(mig10Path, 'utf8');
    assert.match(mig10Content, /REVOKE ALL ON TABLE public\.riders FROM anon/i, 'Migration 10 must revoke all permissions from anon');
    assert.match(mig10Content, /REVOKE ALL ON TABLE public\.riders FROM authenticated/i, 'Migration 10 must revoke all permissions from authenticated');
    assert.match(mig10Content, /REVOKE ALL ON TABLE public\.riders FROM public/i, 'Migration 10 must revoke all permissions from public');
    assert.match(mig10Content, /GRANT ALL ON TABLE public\.riders TO service_role/i, 'Migration 10 must grant permissions to service_role');
    assert.match(mig10Content, /ALTER TABLE public\.riders ENABLE ROW LEVEL SECURITY/i, 'Migration 10 must enable RLS on riders');

    const setupPath = path.resolve(rootDir, 'supabase_setup.sql');
    const setupContent = fs.readFileSync(setupPath, 'utf8');
    assert.ok(!setupContent.includes('CREATE POLICY "public_read_riders"'), 'setup.sql must not have public read policy on riders');
    assert.match(setupContent, /REVOKE ALL ON TABLE public\.riders FROM anon/i, 'setup.sql must revoke anon access on riders');

    const mig06Path = path.resolve(rootDir, 'supabase_migration_06_secure_rls_and_payouts.sql');
    const mig06Content = fs.readFileSync(mig06Path, 'utf8');
    assert.ok(!/DO\s+\$(?!\$)/.test(mig06Content), 'Migration 06 must not have malformed single-dollar DO $ block');
    assert.match(mig06Content, /DO\s+\$\$/i, 'Migration 06 must have valid DO $ block');

    const testOrders = [
      { id: '#QB-RACE-1', status: 'on_the_way', assigned_rider_pin: '5566', total: '₹400', numeric_total: 400, payment_status: 'Pending', is_paid_online: false },
      { id: '#QB-PREPAID-1', status: 'on_the_way', assigned_rider_pin: '5566', total: '₹600', numeric_total: 600, payment_status: 'Paid', is_paid_online: true }
    ];

    // 2. update_status reassignment race condition (409 Conflict)
    // Node handler
    const { req: raceReq, res: raceRes } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${riderToken}` },
      body: {
        action: 'update_status',
        orderId: '#QB-RACE-1',
        status: 'delivered',
        simulateOrders: testOrders,
        simulateReassignmentRace: true
      }
    });
    await orderActionHandler(raceReq, raceRes);
    assert.equal(raceRes.statusCode, 409, 'Node handler must return 409 Conflict on reassignment race');
    assert.match(raceRes.responseData?.error, /order ownership or status has changed/i);

    // Cloudflare Pages parity
    const cfRaceReq = new Request('https://saveraparadise.com/api/order-action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${riderToken}`
      },
      body: JSON.stringify({
        action: 'update_status',
        orderId: '#QB-RACE-1',
        status: 'delivered',
        simulateOrders: testOrders,
        simulateReassignmentRace: true
      })
    });
    const cfRaceRes = await cloudflareOrderActionHandler({ request: cfRaceReq, env: mockCfEnv });
    assert.equal(cfRaceRes.status, 409, 'Cloudflare handler must return 409 Conflict on reassignment race');
    const cfRaceData = await cfRaceRes.json();
    assert.match(cfRaceData.error, /order ownership or status has changed/i);

    // 3. Cash on Delivery (COD) Validation
    // 3a. Negative cash rejected with 400
    const { req: negCashReq, res: negCashRes } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${riderToken}` },
      body: {
        action: 'update_status',
        orderId: '#QB-RACE-1',
        status: 'delivered',
        cashCollected: -100,
        simulateOrders: testOrders
      }
    });
    await orderActionHandler(negCashReq, negCashRes);
    assert.equal(negCashRes.statusCode, 400, 'Negative cash must be rejected');
    assert.match(negCashRes.responseData?.error, /cannot be negative/i);

    // 3b. Excessive cash (> 2x total) rejected with 400
    const { req: excessCashReq, res: excessCashRes } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${riderToken}` },
      body: {
        action: 'update_status',
        orderId: '#QB-RACE-1',
        status: 'delivered',
        cashCollected: 5000,
        simulateOrders: testOrders
      }
    });
    await orderActionHandler(excessCashReq, excessCashRes);
    assert.equal(excessCashRes.statusCode, 400, 'Excessive cash must be rejected');
    assert.match(excessCashRes.responseData?.error, /exceeds payable order total/i);

    // Cloudflare Pages excess cash check
    const cfExcessReq = new Request('https://saveraparadise.com/api/order-action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${riderToken}`
      },
      body: JSON.stringify({
        action: 'update_status',
        orderId: '#QB-RACE-1',
        status: 'delivered',
        cashCollected: 5000,
        simulateOrders: testOrders
      })
    });
    const cfExcessRes = await cloudflareOrderActionHandler({ request: cfExcessReq, env: mockCfEnv });
    assert.equal(cfExcessRes.status, 400);

    // 3c. Prepaid order resets cash_collected to 0 and keeps payment_status = 'Paid'
    const { req: prepaidReq, res: prepaidRes } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${riderToken}` },
      body: {
        action: 'update_status',
        orderId: '#QB-PREPAID-1',
        status: 'delivered',
        cashCollected: 600,
        simulateOrders: testOrders
      }
    });
    await orderActionHandler(prepaidReq, prepaidRes);
    assert.equal(prepaidRes.statusCode, 200);
    assert.equal(prepaidRes.responseData?.order?.cash_collected, 0, 'Prepaid order must have 0 cash collected');
    assert.equal(prepaidRes.responseData?.order?.payment_status, 'Paid');

    // 3d. Valid COD collection sets payment_status = 'Paid' and records cash_collected
    const { req: codValidReq, res: codValidRes } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${riderToken}` },
      body: {
        action: 'update_status',
        orderId: '#QB-RACE-1',
        status: 'delivered',
        cashCollected: 400,
        simulateOrders: testOrders
      }
    });
    await orderActionHandler(codValidReq, codValidRes);
    assert.equal(codValidRes.statusCode, 200);
    assert.equal(codValidRes.responseData?.order?.cash_collected, 400);
    assert.equal(codValidRes.responseData?.order?.payment_status, 'Paid');
  });

  await t.test('29. Owner Rider Management API in admin-store (list_riders, save_rider, delete_rider, toggle_rider_status)', async () => {
    const mockCfEnv = { SESSION_SECRET: 'test_session_secret_32_characters_long_secure_key!' };
    const ownerToken = createAdminToken('owner');
    const riderToken = createAdminToken(undefined, 'rider', { riderPin: '2233' });

    // 1. Rider token cannot call rider management APIs (strictly requires admin or owner)
    const { req: unauthReq, res: unauthRes } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${riderToken}` },
      body: { action: 'list_riders' }
    });
    await adminStoreHandler(unauthReq, unauthRes);
    assert.equal(unauthRes.statusCode, 401, 'Rider role must be rejected from admin-store');

    // 2. Owner can list riders
    const { req: listReq, res: listRes } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${ownerToken}` },
      body: { action: 'list_riders' }
    });
    await adminStoreHandler(listReq, listRes);
    assert.equal(listRes.statusCode, 200);
    assert.ok(Array.isArray(listRes.responseData?.riders), 'list_riders must return an array of riders');

    // Cloudflare Pages parity for list_riders
    const cfListReq = new Request('https://saveraparadise.com/api/admin-store', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ownerToken}`
      },
      body: JSON.stringify({ action: 'list_riders' })
    });
    const cfListRes = await cloudflareAdminStoreHandler({ request: cfListReq, env: mockCfEnv });
    assert.equal(cfListRes.status, 200);
    const cfListData = await cfListRes.json();
    assert.ok(Array.isArray(cfListData.riders));

    // 3. save_rider validates PIN format (must be 4 to 6 digits)
    const { req: invalidPinReq, res: invalidPinRes } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${ownerToken}` },
      body: {
        action: 'save_rider',
        rider: { pin: 'abc', name: 'Faulty Rider' }
      }
    });
    await adminStoreHandler(invalidPinReq, invalidPinRes);
    assert.equal(invalidPinRes.statusCode, 400);
    assert.match(invalidPinRes.responseData?.error, /4 to 6 digits/i);

    // 4. save_rider saves valid rider with owner session
    const newRider = {
      pin: '9988',
      name: 'Test Delivery Boy',
      phone: '+91 99887 76655',
      vehicle: '🏍️ Pulsar',
      status: 'online'
    };
    const { req: saveReq, res: saveRes } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${ownerToken}` },
      body: { action: 'save_rider', rider: newRider }
    });
    await adminStoreHandler(saveReq, saveRes);
    assert.equal(saveRes.statusCode, 200);
    assert.equal(saveRes.responseData?.rider?.pin, '9988');
    assert.equal(saveRes.responseData?.rider?.name, 'Test Delivery Boy');

    // 5. delete_rider with owner session
    const { req: delReq, res: delRes } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${ownerToken}` },
      body: { action: 'delete_rider', pin: '9988' }
    });
    await adminStoreHandler(delReq, delRes);
    assert.equal(delRes.statusCode, 200);
    assert.equal(delRes.responseData?.pin, '9988');

    // 6. toggle_rider_status
    const { req: toggleReq, res: toggleRes } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${ownerToken}` },
      body: { action: 'toggle_rider_status', pin: '2233', status: 'inactive' }
    });
    await adminStoreHandler(toggleReq, toggleRes);
    assert.equal(toggleRes.statusCode, 200);
  });

  await t.test('30. Rider authentication rejects inactive riders and returns minimal sanitized profile', async () => {
    const mockCfEnv = { SESSION_SECRET: 'test_session_secret_32_characters_long_secure_key!' };
    const simulatedRiders = [
      { pin: '3344', name: 'Active Hero', phone: '+91 91111 22222', vehicle: '🏍️ Honda', status: 'online' },
      { pin: '6655', name: 'Banned Rider', phone: '+91 93333 44444', vehicle: '🛵 TVS', status: 'inactive' }
    ];

    // 1. Inactive rider is rejected with 401
    const { req: inactReq, res: inactRes } = createMockReqRes({
      method: 'POST',
      body: { pin: '6655', simulateDynamicRiders: simulatedRiders }
    });
    await nodeAdminAuthHandler(inactReq, inactRes);
    assert.equal(inactRes.statusCode, 401, 'Inactive rider must be rejected with 401');
    assert.match(inactRes.responseData?.error, /deactivated/i);

    // Cloudflare Pages parity for inactive rider
    const cfInactReq = new Request('https://saveraparadise.com/api/admin-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '6655', simulateDynamicRiders: simulatedRiders })
    });
    const cfInactRes = await cloudflareAdminAuthHandler({ request: cfInactReq, env: mockCfEnv });
    assert.equal(cfInactRes.status, 401);
    const cfInactData = await cfInactRes.json();
    assert.match(cfInactData.error, /deactivated/i);

    // 2. Active rider receives token and minimal safe profile
    const { req: actReq, res: actRes } = createMockReqRes({
      method: 'POST',
      body: { pin: '3344', simulateDynamicRiders: simulatedRiders }
    });
    await nodeAdminAuthHandler(actReq, actRes);
    assert.equal(actRes.statusCode, 200);
    assert.equal(actRes.responseData?.role, 'rider');
    assert.equal(actRes.responseData?.riderPin, '3344');
    assert.ok(actRes.responseData?.token);
    assert.deepEqual(actRes.responseData?.rider, {
      pin: '3344',
      name: 'Active Hero',
      phone: '+91 91111 22222',
      vehicle: '🏍️ Honda',
      status: 'online'
    });
  });

  await t.test('31. Strict Cash on Delivery (COD) payment validation in update_status', async () => {
    const mockCfEnv = { SESSION_SECRET: 'test_session_secret_32_characters_long_secure_key!' };
    const riderToken = createAdminToken(undefined, 'rider', { riderPin: '6677' });
    const codOrder = [
      { id: '#QB-COD-1', status: 'on_the_way', assigned_rider_pin: '6677', total: '₹500', numeric_total: 500, payment_status: 'Pending', is_paid_online: false }
    ];

    // 1. Missing cashCollected on COD delivered order is rejected with 400
    const { req: noCashReq, res: noCashRes } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${riderToken}` },
      body: {
        action: 'update_status',
        orderId: '#QB-COD-1',
        status: 'delivered',
        simulateOrders: codOrder
      }
    });
    await orderActionHandler(noCashReq, noCashRes);
    assert.equal(noCashRes.statusCode, 400);
    assert.match(noCashRes.responseData?.error, /cashCollected amount is required/i);

    // 2. Falsified paymentStatus: 'Paid' without cashCollected is rejected
    const { req: fakePaidReq, res: fakePaidRes } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${riderToken}` },
      body: {
        action: 'update_status',
        orderId: '#QB-COD-1',
        status: 'delivered',
        paymentStatus: 'Paid',
        simulateOrders: codOrder
      }
    });
    await orderActionHandler(fakePaidReq, fakePaidRes);
    assert.equal(fakePaidRes.statusCode, 400, 'Cannot mark COD paid without cash collected');

    // 3. Excess cash beyond total + 200 tip threshold is rejected
    const { req: overCashReq, res: overCashRes } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${riderToken}` },
      body: {
        action: 'update_status',
        orderId: '#QB-COD-1',
        status: 'delivered',
        cashCollected: 800, // 500 total + 300 tip (> 200 tip allowance)
        simulateOrders: codOrder
      }
    });
    await orderActionHandler(overCashReq, overCashRes);
    assert.equal(overCashRes.statusCode, 400);
    assert.match(overCashRes.responseData?.error, /exceeds payable order total/i);

    // 4. Cash collected less than total keeps payment_status = 'Pending'
    const { req: partialCashReq, res: partialCashRes } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${riderToken}` },
      body: {
        action: 'update_status',
        orderId: '#QB-COD-1',
        status: 'delivered',
        cashCollected: 300,
        simulateOrders: codOrder
      }
    });
    await orderActionHandler(partialCashReq, partialCashRes);
    assert.equal(partialCashRes.statusCode, 200);
    assert.equal(partialCashRes.responseData?.order?.payment_status, 'Pending');
    assert.equal(partialCashRes.responseData?.order?.cash_collected, 300);

    // 5. Valid COD collection with legitimate tip marks Paid
    const { req: exactCashReq, res: exactCashRes } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${riderToken}` },
      body: {
        action: 'update_status',
        orderId: '#QB-COD-1',
        status: 'delivered',
        cashCollected: 550, // 500 total + 50 tip
        simulateOrders: codOrder
      }
    });
    await orderActionHandler(exactCashReq, exactCashRes);
    assert.equal(exactCashRes.statusCode, 200);
    assert.equal(exactCashRes.responseData?.order?.payment_status, 'Paid');
    assert.equal(exactCashRes.responseData?.order?.cash_collected, 550);
  });

  await t.test('32. Verification of verify_rider_pin RPC deprecation and dataService security', () => {
    // 1. Migration 10 drops verify_rider_pin
    const mig10Content = fs.readFileSync(path.resolve(rootDir, 'supabase_migration_10_secure_riders_rls.sql'), 'utf8');
    assert.match(mig10Content, /DROP FUNCTION IF EXISTS public.verify_rider_pin/i, 'Migration 10 must drop verify_rider_pin RPC');
    assert.match(mig10Content, /REVOKE EXECUTE ON FUNCTION public\.verify_rider_pin/i);

    // 2. supabase_setup.sql does not grant execute on verify_rider_pin to anon
    const setupContent = fs.readFileSync(path.resolve(rootDir, 'supabase_setup.sql'), 'utf8');
    assert.ok(!setupContent.includes('GRANT EXECUTE ON FUNCTION public.verify_rider_pin(TEXT) TO anon'), 'setup.sql must not grant execute to anon');

    // 3. dataService.js does not call supabase.rpc('verify_rider_pin')
    const dsContent = fs.readFileSync(path.resolve(rootDir, 'dataService.js'), 'utf8');
    assert.ok(!dsContent.includes("supabase.rpc('verify_rider_pin'"), 'dataService must not invoke verify_rider_pin RPC');
    assert.ok(!dsContent.includes(".from('riders').upsert("), 'dataService must not directly upsert to riders table');
    assert.ok(!dsContent.includes(".from('riders').delete("), 'dataService must not directly delete from riders table');
  });

  await t.test('33. POST /api/admin-store clear_orders strictly requires Owner session and rejects kitchen staff/riders', async () => {
    const mockCfEnv = { SESSION_SECRET: 'test_session_secret_32_characters_long_secure_key!' };
    const adminToken = createAdminToken('admin');
    const ownerToken = createAdminToken('owner');
    const riderToken = createAdminToken(undefined, 'rider', { riderPin: '2233' });

    // 1. Rider role is rejected with 401
    const { req: riderReq, res: riderRes } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${riderToken}` },
      body: { action: 'clear_orders' }
    });
    await adminStoreHandler(riderReq, riderRes);
    assert.equal(riderRes.statusCode, 401);

    // 2. Kitchen admin role is rejected with 403 (owner required to clear store data)
    const { req: adminReq, res: adminRes } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}` },
      body: { action: 'clear_orders' }
    });
    await adminStoreHandler(adminReq, adminRes);
    assert.equal(adminRes.statusCode, 403);
    assert.match(adminRes.responseData?.error, /Owner role required/i);

    // 3. Owner role succeeds with 200
    const { req: ownerReq, res: ownerRes } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${ownerToken}` },
      body: { action: 'clear_orders' }
    });
    await adminStoreHandler(ownerReq, ownerRes);
    assert.equal(ownerRes.statusCode, 200);
    assert.equal(ownerRes.responseData?.success, true);

    // Cloudflare Pages parity
    const cfOwnerReq = new Request('https://saveraparadise.com/api/admin-store', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ownerToken}`
      },
      body: JSON.stringify({ action: 'clear_orders' })
    });
    const cfOwnerRes = await cloudflareAdminStoreHandler({ request: cfOwnerReq, env: mockCfEnv });
    assert.equal(cfOwnerRes.status, 200);
  });

  await t.test('34. clear_all_orders() RPC security hardening in Migration 07 and dataService', () => {
    // 1. Migration 07 does NOT grant execute to anon or authenticated
    const mig07Content = fs.readFileSync(path.resolve(rootDir, 'supabase_migration_07_fix_clear_orders_rpc.sql'), 'utf8');
    assert.ok(!mig07Content.includes('TO anon, authenticated'), 'Migration 07 must not grant execute to anon or authenticated');
    assert.match(mig07Content, /REVOKE ALL ON FUNCTION public\.clear_all_orders\(\) FROM PUBLIC/i);
    assert.match(mig07Content, /REVOKE EXECUTE ON FUNCTION public\.clear_all_orders\(\) FROM anon/i);
    assert.match(mig07Content, /GRANT EXECUTE ON FUNCTION public\.clear_all_orders\(\) TO service_role/i);

    // 2. dataService.js routes clearOrders through _adminStoreAction('clear_orders')
    const dsContent = fs.readFileSync(path.resolve(rootDir, 'dataService.js'), 'utf8');
    assert.ok(!dsContent.includes("supabase.rpc('clear_all_orders'"), 'dataService must not invoke clear_all_orders RPC directly from browser');
    assert.match(dsContent, /this\._adminStoreAction\('clear_orders'\)/);
  });

  await t.test('35. Master Consolidated Production Security Script (supabase_production_security_hardening.sql)', () => {
    const masterPath = path.resolve(rootDir, 'supabase_production_security_hardening.sql');
    assert.ok(fs.existsSync(masterPath), 'Master production security hardening script must exist');
    const masterContent = fs.readFileSync(masterPath, 'utf8');

    // 1. Dangerous RPC lockdown
    assert.match(masterContent, /REVOKE EXECUTE ON FUNCTION public\.clear_all_orders\(\) FROM anon/i);
    assert.match(masterContent, /GRANT EXECUTE ON FUNCTION public\.clear_all_orders\(\) TO service_role/i);
    assert.match(masterContent, /DROP FUNCTION IF EXISTS public\.verify_rider_pin/i);

    // 2. Riders table lockdown
    assert.match(masterContent, /REVOKE ALL ON TABLE public\.riders FROM anon/i);
    assert.match(masterContent, /GRANT ALL ON TABLE public\.riders TO service_role/i);

    // 3. Orders table lockdown
    assert.match(masterContent, /REVOKE ALL ON TABLE public\.orders FROM anon/i);
    assert.match(masterContent, /GRANT ALL ON TABLE public\.orders TO service_role/i);

    // 4. Guest order tracking RPC
    assert.match(masterContent, /CREATE OR REPLACE FUNCTION public\.track_guest_order/i);
    assert.match(masterContent, /GRANT EXECUTE ON FUNCTION public\.track_guest_order\(TEXT, UUID\) TO anon/i);

    // 5. Monotonic lifecycle trigger
    assert.match(masterContent, /CREATE TRIGGER trg_order_status_monotonicity/i);

    // 6. Transaction safety
    assert.match(masterContent, /^BEGIN;/m);
    assert.match(masterContent, /COMMIT;$/m);
  });
});
