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
import orderActionHandler from '../api/order-action.js';
import { onRequest as cloudflareOrderActionHandler } from '../functions/api/order-action.js';
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
      body: { action: 'update_status', orderId: '#QB-102', status: 'delivered', simulateOrders: sampleOrders }
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
});
