import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const deliveryJs = fs.readFileSync(path.join(rootDir, 'delivery.js'), 'utf-8');
const dataServiceJs = fs.readFileSync(path.join(rootDir, 'dataService.js'), 'utf-8');
const apiOrderActionJs = fs.readFileSync(path.join(rootDir, 'api', 'order-action.js'), 'utf-8');
const functionsApiOrderActionJs = fs.readFileSync(path.join(rootDir, 'functions', 'api', 'order-action.js'), 'utf-8');
const apiAdminStoreJs = fs.readFileSync(path.join(rootDir, 'api', 'admin-store.js'), 'utf-8');
const functionsApiAdminStoreJs = fs.readFileSync(path.join(rootDir, 'functions', 'api', 'admin-store.js'), 'utf-8');
const apiAdminAuthJs = fs.readFileSync(path.join(rootDir, 'api', 'admin-auth.js'), 'utf-8');
const functionsApiAdminAuthJs = fs.readFileSync(path.join(rootDir, 'functions', 'api', 'admin-auth.js'), 'utf-8');
const orderMonitorServiceJava = fs.readFileSync(path.join(rootDir, 'android', 'app', 'src', 'main', 'java', 'com', 'sascrispy', 'portal', 'OrderMonitorService.java'), 'utf-8');
const webAppInterfaceJava = fs.readFileSync(path.join(rootDir, 'android', 'app', 'src', 'main', 'java', 'com', 'sascrispy', 'portal', 'WebAppInterface.java'), 'utf-8');
const mainActivityJava = fs.readFileSync(path.join(rootDir, 'android', 'app', 'src', 'main', 'java', 'com', 'sascrispy', 'portal', 'MainActivity.java'), 'utf-8');

test('RIDER DEEP BUG HUNT VERIFICATION SUITE', async (t) => {
  await t.test('1. checkRiderSession is async, verifies ensureAdminToken("rider"), and resets lock overlay display to flex on lock', () => {
    assert.match(deliveryJs, /async\s+function\s+checkRiderSession\s*\(\)/, 'checkRiderSession must be async');
    assert.match(deliveryJs, /await\s+ensureAdminToken\(['"]rider['"]\)/, 'checkRiderSession must await ensureAdminToken("rider")');
    assert.match(deliveryJs, /if\s*\(typeof\s+navigator\s*!==\s*['"]undefined['"]\s*&&\s*navigator\.onLine\s*&&\s*!validToken\)/, 'Must revoke expired session when online and validToken is null');
    assert.match(deliveryJs, /riderLockOverlay\.style\.display\s*=\s*['"]flex['"]/, 'Must restore display: flex when locking overlay');
  });

  await t.test('2. getOrderDropCoordinates validates BOTH lat and lng in addressDetails against NaN and 0', () => {
    assert.match(deliveryJs, /order\.addressDetails\s*&&\s*!isNaN\(Number\(order\.addressDetails\.lat\)\)\s*&&\s*Number\(order\.addressDetails\.lat\)\s*!==\s*0\s*&&\s*!isNaN\(Number\(order\.addressDetails\.lng\)\)\s*&&\s*Number\(order\.addressDetails\.lng\)\s*!==\s*0/, 'getOrderDropCoordinates must validate both lat and lng in addressDetails');
  });

  await t.test('3. Order filtering normalizes snake_case assigned_rider_pin and camelCase assignedRiderPin with string trimming', () => {
    assert.match(deliveryJs, /String\(o\.assignedRiderPin\s*\|\|\s*o\.assigned_rider_pin\s*\|\|\s*['"]['"]\)\.trim\(\)/, 'getRiderActiveOrdersList and deliveredOrders must check assigned_rider_pin');
    // Ensure no un-normalized strict inequality comparisons remain
    assert.doesNotMatch(deliveryJs, /o\.assignedRiderPin\s*!==\s*currentRider\.pin/, 'Must not compare o.assignedRiderPin directly without snake_case fallback');
  });

  await t.test('4. formConfirmDelivered is async, awaits serverPromise, catches server rejection, and resets isSubmittingDelivery', () => {
    assert.match(deliveryJs, /formConfirmDelivered\.addEventListener\(['"]submit['"],\s*async\s*\(e\)\s*=>/, 'formConfirmDelivered submit handler must be async');
    assert.match(deliveryJs, /await\s+updateResult\.serverPromise/, 'formConfirmDelivered must await updateResult.serverPromise');
    assert.match(deliveryJs, /isSubmittingDelivery\s*=\s*false/, 'isSubmittingDelivery must be reset to false');
  });

  await t.test('5. broadcastRiderLocation stores keys for all batched orders with and without # prefix', () => {
    assert.match(dataServiceJs, /const\s+targetIds\s*=\s*Array\.isArray\(cleanPayload\.orderIds\)/, 'broadcastRiderLocation must process cleanPayload.orderIds array');
    assert.match(dataServiceJs, /localStorage\.setItem\(`quickbite_rider_location_\${cleanId}`,/, 'broadcastRiderLocation must persist clean order ID');
    assert.match(dataServiceJs, /localStorage\.setItem\(`quickbite_rider_location_#\${cleanId}`,/, 'broadcastRiderLocation must persist #-prefixed order ID');
  });

  await t.test('6. Customer phone sanitization extracts last 10 digits to correctly format 11-digit numbers with leading 0', () => {
    assert.match(deliveryJs, /cleanPhoneDigits\.length\s*>=\s*10\s*\?\s*cleanPhoneDigits\.slice\(-10\)\s*:\s*['"]['"]/, 'Customer phone sanitization must extract slice(-10)');
    assert.match(deliveryJs, /dialerPhone\s*=\s*hasRealPhone\s*\?\s*`\+91\${validTenDigits}`\s*:\s*['"]['"]/, 'Dialer phone must format with +91 prefix and 10 digits');
  });

  await t.test('7. Dual-API Parity: update_status clears cash_collected to 0 when status is undelivered in both api and functions/api', () => {
    assert.match(apiOrderActionJs, /if\s*\(status\s*===\s*['"]undelivered['"]\)\s*\{\s*updatePayload\.cash_collected\s*=\s*0;\s*\}/, 'api/order-action.js must set cash_collected = 0 for undelivered status');
    assert.match(functionsApiOrderActionJs, /if\s*\(status\s*===\s*['"]undelivered['"]\)\s*\{\s*updatePayload\.cash_collected\s*=\s*0;\s*\}/, 'functions/api/order-action.js must set cash_collected = 0 for undelivered status');
  });

  await t.test('8. dataService _orderAction assigns targetRole = rider for claim_order and assign_order, and cash handover checks localStorage token', () => {
    assert.match(dataServiceJs, /action\s*===\s*['"]claim_order['"]\s*\|\|\s*action\s*===\s*['"]assign_order['"]/, '_orderAction must assign targetRole = "rider" for claim_order and assign_order');
    assert.match(dataServiceJs, /localStorage\.getItem\(['"]quickbite_rider_token['"]\)/, 'requestRiderCashHandover must check localStorage for quickbite_rider_token');
  });

  await t.test('9. [CRITICAL-01] Doorstep UPI verification gate: update_status strictly verifies Cashfree payment before marking paid', () => {
    assert.match(apiOrderActionJs, /verifyPgOrderPayment/, 'api/order-action.js must import and call verifyPgOrderPayment');
    assert.match(functionsApiOrderActionJs, /verifyPgOrderPayment/, 'functions/api/order-action.js must import and call verifyPgOrderPayment');
    assert.match(deliveryJs, /isDoorstepUpi\s*=\s*DOORSTEP_UPI_ENABLED\s*&&\s*\(isCod\s*&&\s*currentDoorstepPaymentMode\s*===\s*['"]upi['"]\)/, 'delivery.js must enforce Cashfree verified doorstep session');
  });

  await t.test('10. [CRITICAL-02] Unassigned on_the_way claim and delivery: claim_order allows claiming unassigned on_the_way orders', () => {
    assert.match(apiOrderActionJs, /isUnassignedOnTheWay\s*=\s*existing\.status\s*===\s*['"]on_the_way['"]\s*&&\s*!existingPin/, 'api/order-action.js must allow claiming unassigned on_the_way order');
    assert.match(functionsApiOrderActionJs, /isUnassignedOnTheWay\s*=\s*existing\.status\s*===\s*['"]on_the_way['"]\s*&&\s*!existingPin/, 'functions/api/order-action.js must allow claiming unassigned on_the_way order');
    assert.match(dataServiceJs, /order\.status\s*===\s*['"]on_the_way['"]/, 'dataService claimOrderByBagCode must handle on_the_way orders');
    assert.match(dataServiceJs, /this\._orderAction\(['"]claim_order['"]/, 'dataService claimOrderByBagCode must invoke _orderAction("claim_order") for on_the_way orders');
  });

  await t.test('11. [CRITICAL-03] Payout preview distance measures strictly from restaurant to customer drop coordinates', () => {
    assert.match(deliveryJs, /openBagPreviewModal\s*\(order,\s*code\)\s*\{[\s\S]*?calculateRoadDistanceSync\(dropCoords\.lat,\s*dropCoords\.lng\)/, 'openBagPreviewModal must calculate distance to customer drop coordinates');
    assert.doesNotMatch(deliveryJs, /openBagPreviewModal\s*\(order,\s*code\)\s*\{[\s\S]*?riderOriginLat/, 'openBagPreviewModal must not use riderOriginLat');
  });

  await t.test('12. [CRITICAL-04] 48-Hour unsettled COD cache retention in syncOrdersFromSupabase', () => {
    assert.match(dataServiceJs, /\/cash\|cod\/i\.test\(String\(o\.paymentMethod\s*\|\|\s*o\.payment_method\s*\|\|\s*['"]cod['"]\)\)/, 'syncOrdersFromSupabase must match COD orders via regex and exclude online/doorstep payments');
    assert.match(dataServiceJs, /!o\.cashSettled\s*&&\s*!o\.cash_settled/, 'syncOrdersFromSupabase must retain orders where cash is unsettled');
  });

  await t.test('13. [CRITICAL-05] Rider PIN rename re-keys orders, deletes old rider row, and invalidates cache', () => {
    assert.match(apiAdminStoreJs, /userRole\s*!==\s*['"]rider['"]\s*&&\s*originalPin\s*&&\s*originalPin\s*!==\s*pin/, 'api/admin-store.js must detect rider PIN change');
    assert.match(functionsApiAdminStoreJs, /userRole\s*!==\s*['"]rider['"]\s*&&\s*originalPin\s*&&\s*originalPin\s*!==\s*pin/, 'functions/api/admin-store.js must detect rider PIN change');
    assert.match(apiAdminStoreJs, /\.from\(['"]orders['"]\)\s*\.update\(\{\s*assigned_rider_pin:\s*pin,\s*assigned_rider_name:\s*name\s*\}\)\s*\.eq\(['"]assigned_rider_pin['"],\s*originalPin\)/, 'api/admin-store.js must update orders to new PIN');
    assert.match(functionsApiAdminStoreJs, /\.from\(['"]orders['"]\)\s*\.update\(\{\s*assigned_rider_pin:\s*pin,\s*assigned_rider_name:\s*name\s*\}\)\s*\.eq\(['"]assigned_rider_pin['"],\s*originalPin\)/, 'functions/api/admin-store.js must update orders to new PIN');
  });

  await t.test('14. [HIGH-01] kitchen_poll query selects assigned_rider_pin in both api and functions/api', () => {
    assert.match(apiOrderActionJs, /\.select\([^)]*assigned_rider_pin[^)]*\)/, 'api/order-action.js kitchen_poll must select assigned_rider_pin');
    assert.match(functionsApiOrderActionJs, /\.select\([^)]*assigned_rider_pin[^)]*\)/, 'functions/api/order-action.js kitchen_poll must select assigned_rider_pin');
  });

  await t.test('15. [HIGH-02] & [HIGH-03] Native Android notification ID sync and stop alarm bridge', () => {
    assert.match(webAppInterfaceJava, /OrderMonitorService\.setLastAlertNotifId\(notifId\)/, 'WebAppInterface must call OrderMonitorService.setLastAlertNotifId');
    assert.match(orderMonitorServiceJava, /public\s+static\s+void\s+setLastAlertNotifId\s*\(int\s+notifId\)/, 'OrderMonitorService must provide setLastAlertNotifId');
    assert.match(mainActivityJava, /triggerWebAlarmStop\(\)/, 'MainActivity must provide triggerWebAlarmStop()');
    assert.match(orderMonitorServiceJava, /MainActivity\.triggerWebAlarmStop\(\)/, 'OrderMonitorService onStartCommand ACTION_STOP_ALARM must call MainActivity.triggerWebAlarmStop');
  });

  await t.test('16. [HIGH-04] Native Android duty status and LinkedHashSet bounded collections', () => {
    assert.match(orderMonitorServiceJava, /new\s+LinkedHashSet<>\(\)/, 'OrderMonitorService must use LinkedHashSet for insertion-order pruning');
    assert.match(orderMonitorServiceJava, /public\s+static\s+void\s+setRiderDutyStatus\s*\(Context\s+ctx,\s*boolean\s+onDuty\)/, 'OrderMonitorService must provide setRiderDutyStatus');
    assert.match(webAppInterfaceJava, /@JavascriptInterface[\s\S]*?public\s+void\s+setDutyStatus\s*\(boolean\s+onDuty\)/, 'WebAppInterface must expose setDutyStatus');
  });

  await t.test('17. [HIGH-06] Two-stage pickup: isOrderGoingToRestaurant checks stage and status', () => {
    assert.match(dataServiceJs, /isOrderGoingToRestaurant\s*\(order\)\s*\{[\s\S]*?\['ready_for_pickup',\s*'cooking',\s*'accepted'\]\.includes\(order\.status\)/, 'isOrderGoingToRestaurant must check accepted, cooking, ready_for_pickup');
  });

  await t.test('18. [HIGH-08] Safe drop and doorstep wait synchronization', () => {
    assert.match(dataServiceJs, /isWaitingAtDoorstep[\s\S]*?Boolean\(isOptimistic\s*&&\s*local\?\.riderWaitingAtDoorstep\)/, 'syncOrdersFromSupabase must preserve optimistic doorstep wait');
    assert.match(apiOrderActionJs, /safeDrop:\s*Boolean\(safeDrop\)/, 'api/order-action.js must parse safeDrop');
    assert.match(functionsApiOrderActionJs, /safeDrop:\s*Boolean\(safeDrop\)/, 'functions/api/order-action.js must parse safeDrop');
  });

  await t.test('19. [HIGH-10] Token refresh validates rider active status', () => {
    assert.match(apiAdminAuthJs, /Rider account is deactivated or no longer exists/, 'api/admin-auth.js must reject inactive rider on refresh');
    assert.match(functionsApiAdminAuthJs, /Rider account is deactivated or no longer exists/, 'functions/api/admin-auth.js must reject inactive rider on refresh');
  });

  await t.test('20. [MED-01] & [MED-02] Cash handover cache invalidation & quiet closed-hours poll check', () => {
    assert.match(apiOrderActionJs, /invalidateOrderActionMemoryCache\(\);\s*invalidateRidersListCache\(\);/, 'api/order-action.js request_cash_handover must invalidate memory cache and riders cache');
    assert.match(functionsApiOrderActionJs, /invalidateOrderActionMemoryCache\(\);\s*invalidateRidersListCache\(\);/, 'functions/api/order-action.js request_cash_handover must invalidate memory cache and riders cache');
    assert.match(apiOrderActionJs, /hasWarmCache\s*&&\s*!hasActiveCachedOrders/, 'api/order-action.js kitchen_poll must check hasWarmCache && !hasActiveCachedOrders');
    assert.match(functionsApiOrderActionJs, /hasWarmCache\s*&&\s*!hasActiveCachedOrders/, 'functions/api/order-action.js kitchen_poll must check hasWarmCache && !hasActiveCachedOrders');
  });
});
