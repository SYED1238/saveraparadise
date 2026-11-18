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
const apiOrderActionJs = fs.readFileSync(path.join(rootDir, 'api', 'order-action.js'), 'utf8');
const cfOrderActionJs = fs.readFileSync(path.join(rootDir, 'functions', 'api', 'order-action.js'), 'utf8');
const orderMonitorServiceJava = fs.readFileSync(
  path.join(rootDir, 'android', 'app', 'src', 'main', 'java', 'com', 'sascrispy', 'portal', 'OrderMonitorService.java'),
  'utf8'
);

test('RIDER ALARM & 8-RIDER CONCURRENCY REGRESSION SUITE', async (t) => {
  await t.test('1. [BUG-01] syncOrdersFromSupabase prunes orders claimed by other riders in Delivery portal and bypasses cache on forceRefresh', () => {
    assert.match(
      dataServiceJs,
      /this\.portalType\s*===\s*['"]delivery['"]\s*&&\s*fromAuthoritativeApi\s*&&\s*!o\.pendingRemoteSync\s*&&\s*!o\.pendingStatusSync/,
      'dataService.js must prune non-optimistic orders omitted by filterOrdersForRider in delivery portal'
    );
    assert.match(
      dataServiceJs,
      /forceRefresh:\s*Boolean\(force\)/,
      'syncOrdersFromSupabase must pass forceRefresh: Boolean(force)'
    );
    assert.match(
      apiOrderActionJs,
      /if\s*\(!forceRefresh\s*&&\s*syncOrdersCache/,
      'api/order-action.js must bypass syncOrdersCache when forceRefresh is true'
    );
    assert.match(
      cfOrderActionJs,
      /if\s*\(!forceRefresh\s*&&\s*syncOrdersCache/,
      'functions/api/order-action.js must bypass syncOrdersCache when forceRefresh is true'
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
});
