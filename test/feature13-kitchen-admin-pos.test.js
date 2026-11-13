import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const adminJs = fs.readFileSync(path.join(rootDir, 'admin.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(rootDir, 'admin.html'), 'utf8');
const adminCss = fs.readFileSync(path.join(rootDir, 'admin.css'), 'utf8');
const dataServiceJs = fs.readFileSync(path.join(rootDir, 'dataService.js'), 'utf8');

test('FEATURE #13: KITCHEN ADMIN POS, ORDER LIFECYCLE, SOUNDBOX ALARMS & THERMAL KOT SUITE', async (t) => {

  // =========================================================================
  // 1. Audio Context Unlocking & Soundbox Audio Bug Fix
  // =========================================================================
  await t.test('1. admin.js imports getAudioContext and eliminates undefined getKitchenAudioContext', () => {
    assert.match(adminJs, /getAudioContext,/, 'admin.js must import getAudioContext from notificationService.js');
    assert.doesNotMatch(adminJs, /getKitchenAudioContext\(\)/, 'admin.js must NOT call undefined getKitchenAudioContext()');
    assert.match(adminJs, /btnAdminSoundTest\.addEventListener\('click'[\s\S]*?const ctx = getAudioContext\(\);/, 'Sound test button must call getAudioContext()');
    assert.match(adminJs, /const unlockAudioOnGesture = \(\) => \{\s*const ctx = getAudioContext\(\);/, 'User gesture unlock must call getAudioContext()');
  });

  // =========================================================================
  // 2. Receipt Modal Payment Tag & Thermal KOT Printing
  // =========================================================================
  await t.test('2. admin.html includes order-detail-payment-tag and openOrderManageModal updates it dynamically', () => {
    assert.match(adminHtml, /id="order-detail-payment-tag"/, 'admin.html must have an id on the payment tag in the receipt modal');
    assert.match(adminJs, /const orderDetailPaymentTag = document\.getElementById\('order-detail-payment-tag'\);/, 'openOrderManageModal must query order-detail-payment-tag');
    assert.match(adminJs, /orderDetailPaymentTag\.innerHTML = '<i class="fa-solid fa-circle-check"><\/i> Paid Online';/, 'Payment tag must display Paid Online for online prepayments');
    assert.match(adminJs, /orderDetailPaymentTag\.innerHTML = '<i class="fa-solid fa-qrcode"><\/i> Paid via Doorstep UPI';/, 'Payment tag must display Paid via Doorstep UPI');
    assert.match(adminJs, /orderDetailPaymentTag\.innerHTML = '<i class="fa-solid fa-money-bill-wave"><\/i> Cash on Delivery \(COD\)';/, 'Payment tag must display Cash on Delivery');
  });

  await t.test('3. printOrderKOT includes 4-digit Bag Pickup Code, payment string, and robust notes lookup', () => {
    assert.match(adminJs, /const bagCode = String\(order\.pickupCode \|\|/, 'printOrderKOT must extract 4-digit bagCode');
    assert.match(adminJs, /<span>BAG PICKUP CODE:<\/span> <strong[^>]*>#\$\{escapeHtml\(bagCode\)\}<\/strong>/, 'printOrderKOT must print BAG PICKUP CODE on receipt');
    assert.match(adminJs, /paymentLabel = 'PAID ONLINE';/, 'printOrderKOT must set paymentLabel to PAID ONLINE for paid orders');
    assert.match(adminJs, /paymentLabel = 'DOORSTEP UPI';/, 'printOrderKOT must set paymentLabel to DOORSTEP UPI');
    assert.match(adminJs, /const noteText = \(order\.notes \|\| order\.kitchenNotes \|\| order\.customerNotes \|\|/, 'printOrderKOT must inspect notes, kitchenNotes, customerNotes and instructions');
  });

  await t.test('4. printOrderKOT falls back to itemsSummary if items array is empty', () => {
    assert.match(adminJs, /const itemsRows = items\.length > 0 \? items\.map[\s\S]*?order\.itemsSummary \|\| 'Assorted Dishes'/, 'printOrderKOT must print itemsSummary row when items array is empty');
  });

  await t.test('5. admin.css styles #kot-print-area with responsive width for 58mm and 80mm rolls', () => {
    assert.match(adminCss, /width:\s*100%\s*!important;[\s\S]*?max-width:\s*76mm\s*!important;/, 'admin.css must scale #kot-print-area to 100% width with 76mm max-width');
  });

  // =========================================================================
  // 3. Pipeline KPIs, Filtering & Search Null Guards
  // =========================================================================
  await t.test('6. calculateOrderKPIs and renderOrders guard against null orders and elements', () => {
    assert.match(adminJs, /const list = Array\.isArray\(orders\) \? orders\.filter\(Boolean\) : \[\];/, 'calculateOrderKPIs must filter out null/undefined orders safely');
    assert.match(adminJs, /let filtered = Array\.isArray\(orders\) \? orders\.filter\(Boolean\) : \[\];/, 'renderOrders must initialize filtered orders with null guards');
    assert.match(adminJs, /const oid = String\(o\.id \|\| ''\)\.toLowerCase\(\);/, 'Search predicate must safely stringify o.id');
    assert.match(adminJs, /const pcode = String\(o\.pickupCode \|\| ''\)\.toLowerCase\(\);/, 'Search predicate must search by pickupCode');
  });

  // =========================================================================
  // 4. Cancellation Modal, Back Navigation & Customer Cancellation Alerts
  // =========================================================================
  await t.test('7. openCancelOrderModal hooks into backNav and registers DOM fallback checker', () => {
    assert.match(adminJs, /backNav\.pushStep\('modal-cancel-order'/, 'openCancelOrderModal must push modal-cancel-order to backNav');
    assert.match(adminJs, /backNav\.removeStepDirect\('modal-cancel-order'\)/, 'closeCancelOrderModal must remove modal-cancel-order from backNav');
    assert.match(adminJs, /isOpen: \(\) => modalCancelOrderBackdrop && modalCancelOrderBackdrop\.classList\.contains\('open'\)/, 'backNav must register fallback checker for modalCancelOrderBackdrop');
  });

  await t.test('8. handleAdminOrderStatusSync alerts kitchen staff when order is cancelled by customer', () => {
    assert.match(adminJs, /\} else if \(status === 'cancelled'\) \{/, 'handleAdminOrderStatusSync must handle status === cancelled');
    assert.match(adminJs, /playNotificationSound\('cancelled'\);/, 'handleAdminOrderStatusSync must play notification sound on cancellation');
    assert.match(adminJs, /showToast\(`❌ Order \$\{orderId\} was CANCELLED by \$\{actorLabel\}!/, 'handleAdminOrderStatusSync must show toast on cancellation');
  });

  await t.test('9. ringingOrdersQueue updates alarm banner to next order in queue when current order is dismissed', () => {
    assert.match(adminJs, /const nextOrder = ringingOrdersQueue\[0\];\s*if \(alarmBannerOrderId\) alarmBannerOrderId\.textContent = nextOrder\.id;/, 'ringingOrdersQueue must advance banner to next order in queue');
  });

  // =========================================================================
  // 5. DataService Race Condition Prevention & Offline Status Sync
  // =========================================================================
  await t.test('10. updateOrderStatus sets _optimisticTimestamp on cancellation', () => {
    assert.match(dataServiceJs, /order\.cancelledAt = Date\.now\(\);\s*order\._optimisticTimestamp = Date\.now\(\);/, 'Cancellation must set _optimisticTimestamp to protect against sync reverts');
  });

  await t.test('11. updateOrderStatus guards Supabase update with .neq("status", "cancelled")', () => {
    assert.match(dataServiceJs, /update\(fullPayload\)\.eq\('id', targetId\)\.neq\('status', 'cancelled'\)/, 'Forward status progression must never overwrite an already cancelled order in Supabase');
    assert.match(dataServiceJs, /update\(basePayload\)\.eq\('id', targetId\)\.neq\('status', 'cancelled'\)/, 'Fallback update must also prevent overwriting cancelled status in Supabase');
  });

  await t.test('12. syncOfflinePendingOrders drains pendingStatusSync orders to Supabase', () => {
    assert.match(dataServiceJs, /const pendingStatusOrders = list\.filter\(o => o && o\.pendingStatusSync === true\);/, 'syncOfflinePendingOrders must filter orders with pendingStatusSync === true');
    assert.match(dataServiceJs, /delete orderData\.pendingStatusSync;/, 'syncOfflinePendingOrders must delete pendingStatusSync after successful remote update');
  });

  await t.test('13. syncOrdersFromSupabase preserves local status when pendingStatusSync or optimistic is active', () => {
    assert.match(dataServiceJs, /const hasPendingStatus = Boolean\(local\?\.pendingStatusSync\);/, 'syncOrdersFromSupabase must check hasPendingStatus');
    assert.match(dataServiceJs, /const preserveLocalStatus = \(\(hasPendingStatus \|\| isOptimistic\) && canOverride\) && remote\.status !== 'cancelled';/, 'syncOrdersFromSupabase must preserve local status when offline updates are pending and monotonic');
  });

  // =========================================================================
  // 6. Kitchen Portal Bugs 1, 2, 4, 5, 7, 9, 10 Regression Gates
  // =========================================================================
  await t.test('14. Bug 1: Step-by-step pipeline guard prevents skipping cooking to ready_for_pickup & stops alarm', () => {
    assert.match(adminJs, /if\s*\(targetStatus === 'ready_for_pickup' && \(order\?\.status === 'accepted' \|\| order\?\.status === 'pending'\)\)/, 'orderStatusStepPills must require cooking before ready_for_pickup');
    assert.match(adminJs, /if\s*\(targetStatus !== 'accepted' && targetStatus !== 'pending' && isKitchenAlarmRinging\)\s*\{\s*stopKitchenAlarm\(true,\s*\{\s*orderId\s*\}\);/, 'Order status pill update must silence kitchen alarm on any advance');
    assert.match(adminJs, /if\s*\(nextStatus !== 'accepted' && nextStatus !== 'pending' && isKitchenAlarmRinging\)\s*\{\s*stopKitchenAlarm\(true,\s*\{\s*orderId\s*\}\);/, 'Modal advance button must silence kitchen alarm on any advance');
  });

  await t.test('15. Bug 2: updateOrderStatus, broadcastStopAlarm, and broadcastSettings await joined broadcast channel', () => {
    assert.match(dataServiceJs, /this\._ensureBroadcastSubscribedAndSend\('order_status_updated'/, 'updateOrderStatus must use _ensureBroadcastSubscribedAndSend for status broadcasts');
    assert.match(dataServiceJs, /this\._ensureBroadcastSubscribedAndSend\('stop_alarm'/, 'broadcastStopAlarm must use _ensureBroadcastSubscribedAndSend');
    assert.match(dataServiceJs, /this\._ensureBroadcastSubscribedAndSend\('settings_updated'/, 'broadcastSettings must use _ensureBroadcastSubscribedAndSend');
  });

  await t.test('16. Bug 4: Asynchronous server rejection rollback in dataService.js and UI catch in admin.js', () => {
    assert.match(dataServiceJs, /const isAuthoritativeRejection = \[400, 401, 403, 404, 409\]\.includes\(httpStatus\);/, 'dataService must identify authoritative HTTP rejections');
    assert.match(dataServiceJs, /order\.status = prevStatus;\s*order\.stepIndex = prevStepIndex;/, 'Authoritative rejection must roll back local status');
    assert.match(adminJs, /updated\.serverPromise\.catch/, 'admin.js advance handlers must handle serverPromise rejection');
  });

  await t.test('17. Bug 5: Alarm banner and View Order button target the displayed queue order', () => {
    assert.match(adminJs, /const displayedId = alarmBannerOrderId \? alarmBannerOrderId\.textContent\.trim\(\) : null;/, 'btnViewAlarmOrder must query displayed banner order ID');
  });

  await t.test('18. Bug 7: Duplicate #btn-refresh-orders resolved and multi-button listeners attached', () => {
    assert.match(adminHtml, /id="btn-refresh-orders-pill"/, 'admin.html must use unique ID btn-refresh-orders-pill for revenue card button');
    assert.match(adminJs, /document\.querySelectorAll\('#btn-refresh-orders, #btn-refresh-orders-pill, \.btn-refresh-orders'\)/, 'admin.js must bind listener to all refresh buttons');
  });

  await t.test('19. Bug 9: Store Hours normalizeTimeStr bounds validation and deliveryRadiusKm preservation', () => {
    assert.match(adminJs, /if \(isNaN\(h\) \|\| isNaN\(mins\) \|\| mins < 0 \|\| mins > 59\) return defaultVal;/, 'normalizeTimeStr must reject invalid minutes');
    assert.match(adminJs, /const radiusKm = Number\(current\.deliveryRadiusKm \|\| 7\);/, 'formStoreHours must preserve current deliveryRadiusKm and not overwrite from slider');
  });

  await t.test('20. Bug 10: Owner session clearance on logout and idle lock timeout', () => {
    assert.match(adminJs, /clearStaffSession\('admin'\);\s*clearStaffSession\('owner'\);/, 'btnAdminLogout and idle lock must clear both admin and owner sessions');
    assert.match(adminJs, /if \(!isStaffSessionActive\('admin'\) && !isStaffSessionActive\('owner'\)\)/, 'Incoming order alarm guard must allow active owner session');
  });
});
