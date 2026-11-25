import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import orderActionHandler from '../api/order-action.js';
import { onRequest as cfOrderActionOnRequest } from '../functions/api/order-action.js';
import { createAdminToken } from '../api/_auth.js';
import { createAdminToken as createCfAdminToken } from '../functions/api/_auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const deliveryJs = fs.readFileSync(path.join(rootDir, 'delivery.js'), 'utf8');
const apiOrderActionJs = fs.readFileSync(path.join(rootDir, 'api', 'order-action.js'), 'utf8');
const functionsApiOrderActionJs = fs.readFileSync(path.join(rootDir, 'functions', 'api', 'order-action.js'), 'utf8');

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    json(data) { this.body = data; return this; },
    end() { return this; }
  };
  return res;
}

test('RIDER PORTAL 7-BUG REGRESSION SUITE', async (t) => {
  await t.test('1. #btn-confirm-rider-drop calls renderPortal() instead of undefined renderRiderOrders()', () => {
    assert.doesNotMatch(
      deliveryJs,
      /\brenderRiderOrders\b/,
      'delivery.js must not reference undefined renderRiderOrders()'
    );
    assert.match(
      deliveryJs,
      /dataService\.dropAssignedOrder\(orderId,\s*selectedDropReason\);[\s\S]*?closeRiderDropModal\(\);\s*renderPortal\(\);/,
      '#btn-confirm-rider-drop must call closeRiderDropModal() and renderPortal() on success'
    );
  });

  await t.test('2. formConfirmDelivered detects already-verified Doorstep UPI orders and both APIs accept doorstepUpi=true with cashCollected=0', async () => {
    assert.match(
      deliveryJs,
      /const\s+isAlreadyVerifiedDoorstepUpi\s*=\s*Boolean\([\s\S]*?activeConfirmOrder\?\.doorstepUpi[\s\S]*?activeConfirmOrder\?\.doorstep_upi[\s\S]*?doorstep_upi[\s\S]*?cfPaymentStatus[\s\S]*?SUCCESS/,
      'formConfirmDelivered must detect already-verified Doorstep UPI orders even when isCashOnDelivery() returns false'
    );
    assert.match(
      deliveryJs,
      /const\s+isDoorstepUpi\s*=\s*DOORSTEP_UPI_ENABLED\s*&&\s*\(isCod\s*&&\s*currentDoorstepPaymentMode\s*===\s*['"]upi['"]\)[\s\S]*?\|\|\s*Boolean\(DOORSTEP_UPI_ENABLED\s*&&\s*isAlreadyVerifiedDoorstepUpi\)/,
      'isDoorstepUpi must remain true when isAlreadyVerifiedDoorstepUpi is true'
    );

    const riderToken = createAdminToken(undefined, 'rider', { riderPin: '2233' });
    const verifiedDoorstepOrder = {
      id: '#QB-DUPI-1',
      status: 'on_the_way',
      assigned_rider_pin: '2233',
      total: '₹350',
      numeric_total: 350,
      payment_method: 'doorstep_upi',
      payment_status: 'Paid',
      is_paid_online: true,
      doorstep_upi: true,
      cf_order_id: 'cf_doorstep_QB_DUPI_1',
      cf_payment_status: 'SUCCESS'
    };

    // Node API handler
    const req = {
      method: 'POST',
      headers: { authorization: `Bearer ${riderToken}` },
      body: {
        action: 'update_status',
        orderId: '#QB-DUPI-1',
        status: 'delivered',
        cashCollected: 0,
        isPaidOnline: true,
        doorstepUpi: true,
        simulateOrders: [{ ...verifiedDoorstepOrder }]
      }
    };
    const res = mockRes();
    await orderActionHandler(req, res);
    assert.equal(res.statusCode, 200, 'Node order-action must accept doorstepUpi=true delivery with cashCollected=0');
    assert.equal(res.body?.order?.doorstep_upi, true);
    assert.equal(res.body?.order?.cash_collected, 0);

    // Cloudflare Pages Function handler
    const cfEnv = {
      NODE_ENV: 'test',
      SESSION_SECRET: 'test_session_secret_32_characters_long_secure_key!'
    };
    const cfRiderToken = createCfAdminToken(undefined, 'rider', cfEnv, { riderPin: '2233' });
    const cfReq = new Request('https://saveraparadise.com/api/order-action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfRiderToken}`
      },
      body: JSON.stringify({
        action: 'update_status',
        orderId: '#QB-DUPI-1',
        status: 'delivered',
        cashCollected: 0,
        isPaidOnline: true,
        doorstepUpi: true,
        simulateOrders: [{ ...verifiedDoorstepOrder }]
      })
    });
    const cfRes = await cfOrderActionOnRequest({ request: cfReq, env: cfEnv });
    assert.equal(cfRes.status, 200, 'CF order-action must accept doorstepUpi=true delivery with cashCollected=0');
    const cfData = await cfRes.json();
    assert.equal(cfData?.order?.doorstep_upi, true);
    assert.equal(cfData?.order?.cash_collected, 0);
  });

  await t.test('3. btnRiderLogout resets lock overlay display, clears __verifiedRiderToken, and resets order sync cache for rider switching', () => {
    assert.match(
      deliveryJs,
      /function\s+lockRiderPortalState\b[\s\S]*?window\.__verifiedRiderToken\s*=\s*null/,
      'lockRiderPortalState must clear window.__verifiedRiderToken'
    );
    assert.match(
      deliveryJs,
      /function\s+lockRiderPortalState\b[\s\S]*?localStorage\.removeItem\(['"]quickbite_orders['"]\)[\s\S]*?dataService\._lastOrdersSyncVersion\s*=\s*0;[\s\S]*?dataService\._lastOrdersSyncTime\s*=\s*0;[\s\S]*?dataService\.ordersCache\s*=\s*null;/,
      'lockRiderPortalState must clear cached orders and reset _lastOrdersSyncVersion so switching riders fetches fresh orders'
    );
    assert.match(
      deliveryJs,
      /function\s+lockRiderPortalState\b[\s\S]*?riderLockOverlay\.classList\.remove\(['"]unlocked['"]\);\s*riderLockOverlay\.style\.display\s*=\s*['"]flex['"];/,
      'lockRiderPortalState must set riderLockOverlay.style.display = "flex"'
    );
    assert.match(
      deliveryJs,
      /btnRiderLogout\.addEventListener\(['"]click['"],\s*\(\)\s*=>\s*\{\s*lockRiderPortalState\(/,
      'btnRiderLogout must invoke lockRiderPortalState'
    );
  });

  await t.test('4. delivery.js handles quickbite:auth-expired by stopping alarms, clearing session, and locking portal', () => {
    assert.match(
      deliveryJs,
      /window\.addEventListener\(['"]quickbite:auth-expired['"],[\s\S]*?lockRiderPortalState\(/,
      'delivery.js must listen for quickbite:auth-expired and lock the rider portal cleanly'
    );
  });

  await t.test('5. Alarm & order alert handlers guard on isStaffSessionActive("rider") and delete_rider calls stopRiderAlarm()', () => {
    assert.match(
      deliveryJs,
      /function\s+startRiderAlarm\s*\(order\)\s*\{[\s\S]{0,120}?if\s*\(!isStaffSessionActive\(['"]rider['"]\)\)\s*return;/,
      'startRiderAlarm must abort if rider session is not active'
    );
    assert.match(
      deliveryJs,
      /function\s+handleRiderIncomingOrder\s*\(order\)\s*\{[\s\S]{0,120}?if\s*\(!isStaffSessionActive\(['"]rider['"]\)\)\s*return;/,
      'handleRiderIncomingOrder must abort if rider session is not active'
    );
    assert.match(
      deliveryJs,
      /function\s+handleRiderOrderStatusSync\s*\(payload\)\s*\{[\s\S]{0,120}?if\s*\(!isStaffSessionActive\(['"]rider['"]\)\)\s*return;/,
      'handleRiderOrderStatusSync must abort if rider session is not active'
    );
    assert.match(
      deliveryJs,
      /function\s+scanRiderNewOrders\s*\(\)\s*\{[\s\S]{0,120}?if\s*\(!isStaffSessionActive\(['"]rider['"]\)\)\s*return;/,
      'scanRiderNewOrders must abort if rider session is not active'
    );
    assert.match(
      deliveryJs,
      /if\s*\(detail\?\.action\s*===\s*['"]delete_rider['"]\)[\s\S]*?stopRiderAlarm\(\);\s*clearStaffSession\(['"]rider['"]\);/,
      'delete_rider handler must call stopRiderAlarm() before clearing session'
    );
  });

  await t.test('6. api/order-action.js assign_order fallback selects rider_assigned_at and dropped_rider_pins matching functions/api', () => {
    const selectRegex = /\.select\(['"]id,\s*status,\s*step_index,\s*eta,\s*assigned_rider_pin,\s*assigned_rider_name,\s*rider_assigned_at,\s*dropped_rider_pins,\s*address_details['"]\)/;
    assert.match(
      apiOrderActionJs,
      selectRegex,
      'api/order-action.js assign_order fallback must select rider_assigned_at and dropped_rider_pins'
    );
    assert.match(
      functionsApiOrderActionJs,
      selectRegex,
      'functions/api/order-action.js assign_order fallback must select rider_assigned_at and dropped_rider_pins'
    );
  });

  await t.test('7. modalRiderDropBackdrop is registered in backNav.registerFallbackChecker', () => {
    assert.match(
      deliveryJs,
      /backNav\.registerFallbackChecker\(\{\s*isOpen:\s*\(\)\s*=>\s*modalRiderDropBackdrop\s*&&\s*modalRiderDropBackdrop\.classList\.contains\(['"]open['"]\),\s*close:\s*\(\)\s*=>\s*closeRiderDropModal\(\)\s*\}\)/,
      'backNav must register fallback checker for modalRiderDropBackdrop calling closeRiderDropModal()'
    );
  });
});
