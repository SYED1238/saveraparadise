import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const deliveryJs = fs.readFileSync(path.join(rootDir, 'delivery.js'), 'utf8');
const dataServiceJs = fs.readFileSync(path.join(rootDir, 'dataService.js'), 'utf8');
const passcodeLockServiceJs = fs.readFileSync(path.join(rootDir, 'passcodeLockService.js'), 'utf8');
const apiOrderActionJs = fs.readFileSync(path.join(rootDir, 'api', 'order-action.js'), 'utf8');
const cfOrderActionJs = fs.readFileSync(path.join(rootDir, 'functions', 'api', 'order-action.js'), 'utf8');
const orderMonitorServiceJava = fs.readFileSync(
  path.join(rootDir, 'android', 'app', 'src', 'main', 'java', 'com', 'sascrispy', 'portal', 'OrderMonitorService.java'),
  'utf8'
);

test('RIDER ALARM & 8-RIDER CONCURRENCY REGRESSION SUITE', async (t) => {
  await t.test('1. [BUG-01] syncOrdersFromSupabase prunes orders claimed by other riders in Delivery portal and resets version on 409 rollback', () => {
    assert.match(
      dataServiceJs,
      /this\.portalType\s*===\s*['"]delivery['"]\s*&&\s*fromAuthoritativeApi\s*&&\s*!o\.pendingRemoteSync\s*&&\s*!o\.pendingStatusSync/,
      'dataService.js must prune non-optimistic orders omitted by filterOrdersForRider in delivery portal'
    );
    assert.match(
      dataServiceJs,
      /this\._lastOrdersSyncVersion\s*=\s*0;\s*await\s+this\.syncOrdersFromSupabase\(true\);/,
      'Rollback handler must reset _lastOrdersSyncVersion = 0 before syncing on 409 Conflict'
    );
  });

  await t.test('2. [BUG-02] OrderMonitorService.java auto-stops native alarm when all ringing orders are claimed by another rider', () => {
    assert.match(
      orderMonitorServiceJava,
      /Set<String>\s+currentUnclaimedReadyIds\s*=\s*new\s+HashSet<>\(\)/,
      'OrderMonitorService must track currentUnclaimedReadyIds during each poll'
    );
    assert.match(
      orderMonitorServiceJava,
      /activeRingingOrderIds\.retainAll\(currentUnclaimedReadyIds\)/,
      'OrderMonitorService must remove claimed or non-ready orders from activeRingingOrderIds'
    );
    assert.match(
      orderMonitorServiceJava,
      /if\s*\(activeRingingOrderIds\.isEmpty\(\)\)\s*\{[\s\S]*?stopNativeAlarm\(\);[\s\S]*?MainActivity\.triggerWebAlarmStop\(\);/,
      'OrderMonitorService must stop native alarm and notify WebView when activeRingingOrderIds becomes empty'
    );
  });

  await t.test('3. [BUG-03] handleRiderOrderStatusSync includes assignedPin & pickupStage in debounce key and scanRiderNewOrders prunes ringingParcelsQueue', () => {
    assert.match(
      deliveryJs,
      /const\s+syncKey\s*=\s*`\$\{cleanId\}:\$\{status\}:\$\{assignedPin\}:\$\{pickupStage\}`/,
      'handleRiderOrderStatusSync syncKey must include assignedPin and pickupStage'
    );
    assert.match(
      deliveryJs,
      /if\s*\(!liveOrd\s*\|\|\s*liveOrd\.status\s*!==\s*['"]ready_for_pickup['"]\s*\|\|\s*\(livePin\s*&&\s*\(!myPin\s*\|\|\s*livePin\s*!==\s*myPin\)\)\)/,
      'scanRiderNewOrders must prune claimed or non-ready orders from ringingParcelsQueue'
    );
  });

  await t.test('4. [BUG-04 & BUG-05] Rider alarm suppresses when at active order limit and supports up to 2-hour kitchen prep window', () => {
    assert.match(
      deliveryJs,
      /function\s+startRiderAlarm\s*\(order\)\s*\{[\s\S]*?if\s*\(getRiderCurrentActiveOrder\(order\.id\)\)\s*return;/,
      'startRiderAlarm must abort if rider is already at their active order limit'
    );
    assert.match(
      deliveryJs,
      /if\s*\(orderAge\s*>\s*2\s*\*\s*60\s*\*\s*60\s*\*\s*1000\)\s*return;/,
      'startRiderAlarm must allow up to 2 hours for kitchen preparation before suppressing alarm'
    );
  });

  await t.test('5. [BUG-06 & BUG-07] Bag code lookup prioritizes post-sync order, checks Stage 1 assignment, and awaits post-RPC GPS update', () => {
    assert.match(
      deliveryJs,
      /let\s+order\s*=\s*dataService\.findOrderByBagCode\(code\)\s*\|\|\s*existingOrderWithCode;/,
      'startDeliveryByBagCode must prioritize freshly synced order over pre-sync snapshot'
    );
    assert.match(
      deliveryJs,
      /if\s*\(checkedOrderRiderPin\s*&&\s*checkedOrderRiderPin\s*!==\s*myRiderPin\)/,
      'startDeliveryByBagCode must reject orders already accepted by another rider in Stage 1 or Stage 2'
    );
    assert.match(
      dataServiceJs,
      /const\s+existingReadyPin\s*=\s*String\(order\.assignedRiderPin\s*\|\|\s*order\.assigned_rider_pin\s*\|\|\s*['"]['"]\)\.trim\(\);/,
      'claimOrderByBagCode must check existingReadyPin for ready_for_pickup orders'
    );
    assert.doesNotMatch(
      apiOrderActionJs,
      /\.or\(`id\.eq\.\$\{cleanId\},id\.eq\.#\$\{cleanId\}`\)\s*\.catch\(/,
      'api/order-action.js must not call .catch() directly on PostgrestFilterBuilder'
    );
    assert.doesNotMatch(
      cfOrderActionJs,
      /\.or\(`id\.eq\.\$\{cleanId\},id\.eq\.#\$\{cleanId\}`\)\s*\.catch\(/,
      'functions/api/order-action.js must not call .catch() directly on PostgrestFilterBuilder'
    );
  });

  await t.test('6. [BUG-08] Single-attempt Rider Passcode Unlock: onVerify sets staff session & active rider immediately, dataService stores activeId before saveOrUpdateRider, and subscriber guards against routine sync re-locks', () => {
    // 1. delivery.js onVerify must immediately establish staff session and active rider
    assert.match(
      deliveryJs,
      /onVerify:\s*async\s*\(pin\)\s*=>\s*\{[\s\S]*?setStaffSessionActive\('rider'\);[\s\S]*?dataService\.setActiveRiderPin\(cleanPin,\s*rider\);/,
      'delivery.js onVerify must setStaffSessionActive and setActiveRiderPin upon valid token to prevent post-verify null session'
    );

    // 2. delivery.js change subscriber must NOT kick out the rider on routine entity === "riders" or sync_riders
    assert.doesNotMatch(
      deliveryJs,
      /if\s*\(\s*entity\s*===\s*['"]riders['"]\s*\|\|\s*detail\?\.action\s*===\s*['"]delete_rider['"]\s*\)\s*\{\s*const\s+currentRider\s*=\s*dataService\.getActiveRider\(\);\s*if\s*\(!currentRider\)/,
      'delivery.js change subscriber must not clear session on routine riders entity change or sync_riders'
    );
    assert.match(
      deliveryJs,
      /if\s*\(detail\?\.action\s*===\s*['"]delete_rider['"]\)\s*\{[\s\S]*?const\s+deletedPin\s*=\s*String\(detail\?\.pin[\s\S]*?if\s*\(currentRider\s*&&\s*deletedPin\s*&&\s*String\(currentRider\.pin\)\.trim\(\)\s*===\s*deletedPin\)/,
      'delivery.js must only clear session when the active rider PIN specifically matches detail.pin in delete_rider'
    );

    // 3. dataService.js setActiveRiderPin must persist quickbite_active_rider_id before calling saveOrUpdateRider
    assert.match(
      dataServiceJs,
      /localStorage\.setItem\(['"]quickbite_active_rider_id['"],\s*riderId\);[\s\S]*?this\.saveOrUpdateRider\(rider\);/,
      'dataService.js setActiveRiderPin must persist quickbite_active_rider_id to localStorage before calling saveOrUpdateRider to prevent race conditions'
    );

    // 4. passcodeLockService.js reset() must not force overlayEl.style.display = "flex" if overlay is already unlocked
    assert.match(
      passcodeLockServiceJs,
      /if\s*\(overlayEl\s*&&\s*!overlayEl\.classList\.contains\(['"]unlocked['"]\)\)\s*\{\s*overlayEl\.style\.display\s*=\s*['"]flex['"];\s*\}/,
      'passcodeLockService.js reset() must guard against showing lock overlay if it is already in unlocked state'
    );
  });
});
