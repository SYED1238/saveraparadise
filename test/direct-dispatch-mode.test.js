import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS, dataService } from '../dataService.js';
import apiOrderActionHandler from '../api/order-action.js';
import { onRequest as cfOrderActionHandler } from '../functions/api/order-action.js';
import { createAdminToken } from '../api/_auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const adminJs = fs.readFileSync(path.join(rootDir, 'admin.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(rootDir, 'admin.html'), 'utf8');
const deliveryJs = fs.readFileSync(path.join(rootDir, 'delivery.js'), 'utf8');
const apiOrderActionJs = fs.readFileSync(path.join(rootDir, 'api/order-action.js'), 'utf8');
const functionsApiOrderActionJs = fs.readFileSync(path.join(rootDir, 'functions/api/order-action.js'), 'utf8');

function createMockReqRes(options = {}) {
  const req = {
    method: options.method || 'POST',
    headers: options.headers || {},
    body: options.body || {},
    query: options.query || {},
    url: options.url || '/api/order-action'
  };
  let statusCode = 200;
  let responseData = null;
  const headers = {};
  const res = {
    statusCode: 200,
    setHeader: (name, value) => { headers[name.toLowerCase()] = value; },
    getHeader: (name) => headers[name.toLowerCase()],
    status: (code) => {
      statusCode = code;
      res.statusCode = code;
      return res;
    },
    json: (data) => {
      responseData = data;
      res.responseData = data;
      return res;
    },
    end: () => res
  };
  return { req, res };
}

test('KITCHEN DIRECT DISPATCH WORKFLOW & RIDER ALARM SUITE', async (t) => {

  // =========================================================================
  // 1. DEFAULT_SETTINGS & DataService Helper Methods
  // =========================================================================
  await t.test('1. DEFAULT_SETTINGS in dataService.js defines directDispatchOnPrep as false', () => {
    assert.strictEqual(DEFAULT_SETTINGS.directDispatchOnPrep, false, 'DEFAULT_SETTINGS must have directDispatchOnPrep: false');
  });

  await t.test('2. dataService.isDirectDispatchOnPrep() returns current setting and defaults to false', () => {
    assert.strictEqual(typeof dataService.isDirectDispatchOnPrep, 'function');
    assert.strictEqual(dataService.isDirectDispatchOnPrep(), false);
  });

  await t.test('3. dataService.setDirectDispatchOnPrep() toggles setting and persists', () => {
    assert.strictEqual(typeof dataService.setDirectDispatchOnPrep, 'function');
    dataService.setDirectDispatchOnPrep(true);
    assert.strictEqual(dataService.isDirectDispatchOnPrep(), true);
    dataService.setDirectDispatchOnPrep(false);
    assert.strictEqual(dataService.isDirectDispatchOnPrep(), false);
  });

  // =========================================================================
  // 2. Admin Portal UI Controls in admin.html
  // =========================================================================
  await t.test('4. admin.html provides header quick toggle and dedicated settings accordion card', () => {
    assert.match(adminHtml, /id="btn-admin-direct-dispatch-toggle"/, 'Must have direct dispatch toggle in header menu');
    assert.match(adminHtml, /id="hours-card-dispatch"/, 'Must have hours-card-dispatch accordion card in view-hours');
    assert.match(adminHtml, /id="toggle-direct-dispatch"/, 'Must have toggle checkbox in dispatch settings card');
    assert.match(adminHtml, /id="btn-save-dispatch-mode"/, 'Must have save button for dispatch settings');
  });

  // =========================================================================
  // 3. Admin Order Card & Modal Button Direct Transition Logic in admin.js
  // =========================================================================
  await t.test('5. admin.js checks isDirectDispatch for accepted orders to route directly to ready_for_pickup', () => {
    assert.match(
      adminJs,
      /\} else if \(order\.status === 'accepted'\) \{[\s\S]*?isDirectDispatch[\s\S]*?data-next="ready_for_pickup"[\s\S]*?data-next="cooking"/,
      'admin.js renderOrders must route accepted orders directly to ready_for_pickup when isDirectDispatch is enabled'
    );
  });

  await t.test('6. admin.js modal advance button routes accepted to ready_for_pickup when isDirectDispatch is enabled', () => {
    assert.match(
      adminJs,
      /\} else if \(status === 'accepted'\) \{[\s\S]*?isDirectDispatch[\s\S]*?data-next',\s*'ready_for_pickup'[\s\S]*?data-next',\s*'cooking'/,
      'admin.js updateModalStatusUI must set data-next to ready_for_pickup when isDirectDispatch is enabled'
    );
  });

  await t.test('7. admin.js status step pills permit advancing accepted directly to ready_for_pickup when direct dispatch is active', () => {
    assert.match(
      adminJs,
      /if\s*\(targetStatus === 'ready_for_pickup' && \(order\?\.status === 'accepted' \|\| order\?\.status === 'pending'\)\) \{[\s\S]*?isDirectDispatch/,
      'admin.js orderStatusStepPills must allow direct jump from accepted to ready_for_pickup when direct dispatch is enabled'
    );
  });

  // =========================================================================
  // 4. Dual-API Backend Gate: api/ and functions/api/ parity
  // =========================================================================
  await t.test('8. api/order-action.js and functions/api/order-action.js permit admin role transition from accepted to ready_for_pickup', async () => {
    const mockEnv = {
      SESSION_SECRET: 'test_session_secret_32_characters_long_secure_key!',
      NODE_ENV: 'test',
      ENVIRONMENT: 'test'
    };
    process.env.SESSION_SECRET = mockEnv.SESSION_SECRET;
    const adminToken = createAdminToken('admin');

    const sampleOrders = [
      { id: '#QB-101', status: 'accepted', assigned_rider_pin: null, tracking_token: 'secret-101' }
    ];

    // Node API Test
    const { req: nodeReq, res: nodeRes } = createMockReqRes({
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}` },
      body: {
        action: 'update_status',
        orderId: '#QB-101',
        status: 'ready_for_pickup',
        simulateOrders: sampleOrders
      }
    });

    await apiOrderActionHandler(nodeReq, nodeRes);
    assert.strictEqual(nodeRes.statusCode, 200, 'Node API must allow admin to advance accepted order to ready_for_pickup');
    assert.strictEqual(nodeRes.responseData?.order?.status, 'ready_for_pickup');

    // Cloudflare Pages Function Test
    const cfReq = new Request('http://localhost/api/order-action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        action: 'update_status',
        orderId: '#QB-101',
        status: 'ready_for_pickup',
        simulateOrders: sampleOrders
      })
    });

    const cfRes = await cfOrderActionHandler({ request: cfReq, env: mockEnv });
    assert.strictEqual(cfRes.status, 200, 'Cloudflare API must allow admin to advance accepted order to ready_for_pickup');
    const cfData = await cfRes.json();
    assert.strictEqual(cfData.order?.status, 'ready_for_pickup');
  });

  // =========================================================================
  // 5. Delivery Rider Automatic Alarm on ready_for_pickup
  // =========================================================================
  await t.test('9. delivery.js triggers rider alarm and system push notification upon order entering ready_for_pickup', () => {
    assert.match(
      deliveryJs,
      /if\s*\(status === 'ready_for_pickup'\) \{[\s\S]*?startRiderAlarm\(order \|\| \{ id: orderId, status \}\);[\s\S]*?sendSystemNotification\(/,
      'delivery.js must trigger startRiderAlarm and system notification on status === ready_for_pickup'
    );
  });
});
