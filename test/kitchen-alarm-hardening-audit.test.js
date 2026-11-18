import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const adminJs = fs.readFileSync(path.join(rootDir, 'admin.js'), 'utf-8');
const dataServiceJs = fs.readFileSync(path.join(rootDir, 'dataService.js'), 'utf-8');
const orderMonitorServiceJava = fs.readFileSync(
  path.join(rootDir, 'android/app/src/main/java/com/sascrispy/portal/OrderMonitorService.java'),
  'utf-8'
);
const apiOrderActionJs = fs.readFileSync(path.join(rootDir, 'api', 'order-action.js'), 'utf-8');
const functionsApiOrderActionJs = fs.readFileSync(path.join(rootDir, 'functions', 'api', 'order-action.js'), 'utf-8');

test('KITCHEN ALARM SYSTEM BUG FIXES & HARDENING AUDIT (ALARM-01 to ALARM-06)', async (t) => {

  // ALARM-01: Multi-Order Queue Re-Entrancy Wipe on Single-Order Dismissal
  await t.test('1. [ALARM-01] Partial order dismissal preserves remaining ringing orders and broadcasts partial: true', () => {
    // admin.js stopKitchenAlarm supports partialIds and broadcasts orderId + partial: true
    assert.match(
      adminJs,
      /const\s+partialIds\s*=\s*\(extra\s*&&\s*!extra\.all\)\s*\?\s*\(extra\.orderId/,
      'admin.js stopKitchenAlarm must parse partialIds from extra.orderId or extra.orderIds'
    );
    assert.match(
      adminJs,
      /const\s+normTargetId\s*=\s*String\(targetId\)\.replace\(\/\^#\/,\s*['"]['"]\);/,
      'admin.js stopKitchenAlarm must normalize # prefix on targetId'
    );
    assert.match(
      adminJs,
      /dataService\.broadcastStopAlarm\(\{[\s\S]*?orderId:\s*targetId,[\s\S]*?orderIds:\s*partialIds,[\s\S]*?partial:\s*true,/,
      'admin.js stopKitchenAlarm must broadcast orderId, orderIds, and partial: true'
    );

    // dataService.js forwards orderId and partial in supabase_broadcast stop_alarm
    assert.match(
      dataServiceJs,
      /this\.notifyChange\('kitchen_alarm',\s*\{[\s\S]*?orderId:\s*payload\.orderId\s*\|\|\s*null,[\s\S]*?orderIds:\s*payload\.orderIds\s*\|\|\s*\[\],[\s\S]*?partial:\s*Boolean\(payload\.partial\)/,
      'dataService.js realtime listener must forward orderId, orderIds, and partial flag'
    );
  });

  // ALARM-02: Live Sound Mode Switch While Alarm is Actively Ringing
  await t.test('2. [ALARM-02] refreshActiveKitchenAlarmAudio restarts native loop or WebAudio interval when mode toggles while ringing', () => {
    assert.match(
      adminJs,
      /function\s+refreshActiveKitchenAlarmAudio\(\)\s*\{[\s\S]*?if\s*\(!isKitchenAlarmRinging\)\s*return;/,
      'admin.js must define refreshActiveKitchenAlarmAudio guarded by isKitchenAlarmRinging'
    );
    assert.match(
      adminJs,
      /hasAndroidNative\s*&&\s*typeof\s*window\.AndroidNative\.startAlarm\s*===\s*'function'[\s\S]*?window\.AndroidNative\.startAlarm\(\)/,
      'refreshActiveKitchenAlarmAudio must refresh Android native alarm loop'
    );

    // btnAdminAlarmToggle click handler and catch rollback must invoke refreshActiveKitchenAlarmAudio
    assert.match(
      adminJs,
      /btnAdminAlarmToggle\.addEventListener\('click'[\s\S]*?updateAlarmToggleUI\(\);\s*refreshActiveKitchenAlarmAudio\(\);/,
      'btnAdminAlarmToggle click handler must call refreshActiveKitchenAlarmAudio'
    );
    assert.match(
      adminJs,
      /btnAdminAlarmToggle[\s\S]*?catch\s*\(err\)\s*\{[\s\S]*?updateAlarmToggleUI\(\);\s*refreshActiveKitchenAlarmAudio\(\);/,
      'btnAdminAlarmToggle catch rollback must call refreshActiveKitchenAlarmAudio'
    );

    // storage and quickbite_data_changed settings listeners must invoke refreshActiveKitchenAlarmAudio
    assert.match(
      adminJs,
      /if\s*\(st\s*&&\s*st\.kitchenAlarmMode\)\s*\{[\s\S]*?updateAlarmToggleUI\(\);\s*refreshActiveKitchenAlarmAudio\(\);/,
      'storage and quickbite_data_changed listeners must refresh audio when kitchenAlarmMode changes'
    );
  });

  // ALARM-03: Minimized Kitchen Android APK Auto-Silence When Ringing Orders Leave pending/accepted
  await t.test('3. [ALARM-03] OrderMonitorService tracks currentActiveKitchenAlertIds and auto-silences kitchen alarm', () => {
    assert.match(
      orderMonitorServiceJava,
      /Set<String>\s+currentActiveKitchenAlertIds\s*=\s*new\s+HashSet<>\(\);/,
      'OrderMonitorService must declare currentActiveKitchenAlertIds set'
    );
    assert.match(
      orderMonitorServiceJava,
      /boolean\s+isKitchenAlertStatus\s*=\s*"pending"\.equalsIgnoreCase\(status\)\s*\|\|\s*"accepted"\.equalsIgnoreCase\(status\);[\s\S]*?if\s*\(isKitchenAlertStatus\)\s*\{[\s\S]*?addNormalizedOrderIdVariants\(currentActiveKitchenAlertIds,\s*id\);/,
      'OrderMonitorService must populate currentActiveKitchenAlertIds with active pending and accepted orders'
    );
    assert.match(
      orderMonitorServiceJava,
      /if\s*\(!isRiderApp\s*&&\s*!isOwnerApp\s*&&\s*isAlarmRinging\(\)\s*&&\s*!activeRingingOrderIds\.isEmpty\(\)\)\s*\{[\s\S]*?activeRingingOrderIds\.retainAll\(currentActiveKitchenAlertIds\);[\s\S]*?if\s*\(activeRingingOrderIds\.isEmpty\(\)\)\s*\{[\s\S]*?stopNativeAlarm\(\);[\s\S]*?MainActivity\.triggerWebAlarmStop\(\);/,
      'OrderMonitorService must auto-stop native alarm when active kitchen orders leave pending/accepted'
    );
  });

  // ALARM-04 & ALARM-05: Deferred Alarm Trigger Across PIN Lock & Queue Pruning in scanAndDetectNewOrders()
  await t.test('4. [ALARM-04 & ALARM-05] handleIncomingOrderAlert gates before knownOrderIds and scanAndDetectNewOrders prunes ringingOrdersQueue', () => {
    // Startup pre-seeding only marks fresh unacknowledged orders as known if session is already active
    assert.match(
      adminJs,
      /if\s*\(!isFreshUnack\s*\|\|\s*isStaffSessionActive\('admin'\)\s*\|\|\s*isStaffSessionActive\('owner'\)\)\s*\{\s*knownOrderIds\.add\(o\.id\);\s*\}/,
      'Startup pre-seeding must not suppress fresh unacknowledged orders while locked'
    );

    // handleIncomingOrderAlert checks session guard before knownOrderIds.add
    const handleAlertStart = adminJs.indexOf('function handleIncomingOrderAlert');
    const handleAlertBody = adminJs.slice(handleAlertStart, handleAlertStart + 1500);
    const sessionGuardPos = handleAlertBody.indexOf("if (!isStaffSessionActive('admin') && !isStaffSessionActive('owner'))");
    const knownAddPos = handleAlertBody.indexOf('knownOrderIds.add(orderData.id)');
    assert.ok(sessionGuardPos !== -1, 'handleIncomingOrderAlert must contain session guard');
    assert.ok(knownAddPos !== -1, 'handleIncomingOrderAlert must contain knownOrderIds.add');
    assert.ok(sessionGuardPos < knownAddPos, 'Session guard must execute BEFORE adding to knownOrderIds');

    // scanAndDetectNewOrders prunes ringingOrdersQueue against latest orders
    assert.match(
      adminJs,
      /function\s+scanAndDetectNewOrders\(\)\s*\{[\s\S]*?if\s*\(ringingOrdersQueue\.length\s*>\s*0\)\s*\{[\s\S]*?ringingOrdersQueue\.splice\(i,\s*1\);[\s\S]*?if\s*\(ringingOrdersQueue\.length\s*===\s*0\s*&&\s*isKitchenAlarmRinging\)\s*\{\s*stopKitchenAlarm\(false\);/,
      'scanAndDetectNewOrders must prune ringingOrdersQueue and stop alarm if queue empties'
    );

    // PIN unlock and checkAdminSession trigger scanAndDetectNewOrders
    assert.match(
      adminJs,
      /initIosPasscodeLock\([\s\S]*?syncOrdersFromSupabase\(true\)\.then\(\(\)\s*=>\s*\{[\s\S]*?scanAndDetectNewOrders\(\);/,
      'initIosPasscodeLock onSuccess must invoke scanAndDetectNewOrders after sync'
    );
    assert.match(
      adminJs,
      /checkAdminSession[\s\S]*?syncOrdersFromSupabase\(\)\.then\(\(\)\s*=>\s*\{[\s\S]*?scanAndDetectNewOrders\(\);/,
      'checkAdminSession must invoke scanAndDetectNewOrders after sync'
    );
  });

  // ALARM-06: Dual-API kitchen_poll pickup_code Preservation & Auth-Aware Projection
  await t.test('5. [ALARM-06] Dual-API kitchen_poll projects pickup_code and isolates authenticated vs unauthenticated cache', () => {
    for (const [name, content] of [['api/order-action.js', apiOrderActionJs], ['functions/api/order-action.js', functionsApiOrderActionJs]]) {
      // Must define projectPollRows projection helper
      assert.match(
        content,
        /const\s+projectPollRows\s*=\s*\(rows\)\s*=>\s*\(rows\s*\|\|\s*\[\]\)\.map\(row\s*=>\s*\(\{[\s\S]*?customer_name:\s*hasAuth\s*\?\s*row\.customer_name\s*:\s*'Customer',[\s\S]*?pickup_code:\s*hasAuth\s*\?\s*\(row\.pickup_code\s*\|\|\s*['"]['"]\)\s*:\s*['"]['"],/,
        `${name} kitchen_poll must project customer_name and pickup_code based on hasAuth`
      );

      // Memory cache hit must project rows via projectPollRows
      assert.match(
        content,
        /if\s*\(kitchenPollCache\s*&&\s*\(now\s*-\s*kitchenPollCachedAt\s*<\s*KITCHEN_POLL_CACHE_TTL_MS\)\)\s*\{[\s\S]*?return\s+(?:res\.status\(200\)\.json|jsonResponse)\(projectPollRows\(kitchenPollCache\)/,
        `${name} kitchen_poll must project memory cache hit through projectPollRows`
      );

      // In-memory cache stores raw unmasked row pickup_code
      assert.match(
        content,
        /kitchenPollCache\s*=\s*combined\.map\(row\s*=>\s*\(\{[\s\S]*?pickup_code:\s*row\.pickup_code\s*\|\|\s*['"]['"],/,
        `${name} kitchenPollCache must store raw pickup_code`
      );
    }

    // Cloudflare functions edge cache must only cache masked public projection
    assert.match(
      functionsApiOrderActionJs,
      /if\s*\(!hasAuth\s*&&\s*typeof\s+caches\s*!==\s*'undefined'\s*&&\s*caches\.default\)/,
      'functions/api/order-action.js must only serve edge cache for unauthenticated callers'
    );
    assert.match(
      functionsApiOrderActionJs,
      /await\s+putKitchenPollEdgeCache\(request,\s*context,\s*combined\.map\(row\s*=>\s*\(\{[\s\S]*?customer_name:\s*'Customer',[\s\S]*?pickup_code:\s*['"]['"],/,
      'functions/api/order-action.js must only write masked Customer rows to edge cache'
    );
  });

  // FOLLOW-UP: Idle Auto-Lock Inactivity Bypass & Native Tablet Foreground Alerting
  await t.test('6. [FOLLOW-UP] resetIdleLockTimer reschedules during open hours and Android APK alerts even when locked', () => {
    // 1. resetIdleLockTimer checks isStoreOpen, isKitchenAlarmRinging, isNativeApk, and hasActiveOrders
    assert.match(
      adminJs,
      /resetIdleLockTimer[\s\S]*?const\s+isStoreOpen\s*=\s*typeof\s+dataService\s*!==\s*'undefined'[\s\S]*?if\s*\(isStoreOpen\s*\|\|\s*isKitchenAlarmRinging\s*\|\|\s*isNativeApk\s*\|\|\s*hasActiveOrders\)\s*\{\s*resetIdleLockTimer\(\);\s*return;\s*\}/,
      'resetIdleLockTimer must reschedule without locking when store is open, alarm ringing, in APK, or active orders exist'
    );

    // 2. Both resetIdleLockTimer and btnAdminLogout preserve clearStaffSession
    assert.match(
      adminJs,
      /clearStaffSession\('admin'\);\s*clearStaffSession\('owner'\);/,
      'Must preserve clearStaffSession for both admin and owner'
    );

    // 3. handleIncomingOrderAlert allows native APK to alert even when screen is locked
    assert.match(
      adminJs,
      /if\s*\(!isStaffSessionActive\('admin'\)\s*&&\s*!isStaffSessionActive\('owner'\)\)\s*\{[\s\S]*?const\s+isNativeApk\s*=\s*typeof\s+window\s*!==\s*'undefined'\s*&&\s*Boolean\(window\.AndroidNative\);[\s\S]*?if\s*\(!isNativeApk\)\s*\{/,
      'handleIncomingOrderAlert must allow native APK to alert when locked'
    );

    // 4. OrderMonitorService.java runs 20s backup polling in foreground for Kitchen App
    assert.match(
      orderMonitorServiceJava,
      /if\s*\(isAppInForeground\s*&&\s*isRiderApp\)\s*\{[\s\S]*?Thread\.sleep\(15000\);[\s\S]*?continue;\s*\}[\s\S]*?updateForegroundNotificationIfNeeded\(isAppInForeground\s*\?\s*"foreground"\s*:\s*"background"\);[\s\S]*?pollKitchenOrders\(\);/,
      'OrderMonitorService must continue polling in foreground for Kitchen app'
    );

    // 5. checkAdminSession recovers session from localStorage in APK
    assert.match(
      adminJs,
      /checkAdminSession[\s\S]*?const\s+isNativeApk\s*=\s*typeof\s+window\s*!==\s*'undefined'\s*&&\s*Boolean\(window\.AndroidNative\);[\s\S]*?localStorage\.getItem\('quickbite_admin_token'\)/,
      'checkAdminSession must recover session across WebView reloads in APK'
    );
  });
});
