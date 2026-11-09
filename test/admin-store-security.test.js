import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdminToken, signPayload } from '../api/_auth.js';
import adminStoreHandler from '../api/admin-store.js';
import orderActionHandler from '../api/order-action.js';

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
});
