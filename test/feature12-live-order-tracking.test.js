import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

if (typeof global.localStorage === 'undefined') {
  const store = new Map();
  global.localStorage = {
    getItem: (key) => store.get(String(key)) ?? null,
    setItem: (key, val) => store.set(String(key), String(val)),
    removeItem: (key) => store.delete(String(key)),
    clear: () => store.clear(),
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; }
  };
}
if (typeof global.sessionStorage === 'undefined') {
  const store = new Map();
  global.sessionStorage = {
    getItem: (key) => store.get(String(key)) ?? null,
    setItem: (key, val) => store.set(String(key), String(val)),
    removeItem: (key) => store.delete(String(key)),
    clear: () => store.clear()
  };
}

const { dataService } = await import('../dataService.js');

test('FEATURE #12: LIVE ORDER TRACKING, 5-STEP STEPPER, SLIDE-TO-CANCEL & KITCHEN HOTLINE SUITE', async (t) => {
  const indexHtml = fs.readFileSync('index.html', 'utf8');
  const mainJs = fs.readFileSync('main.js', 'utf8');
  const styleCss = fs.readFileSync('style.css', 'utf8');
  const dataServiceJs = fs.readFileSync('dataService.js', 'utf8');
  const deliveryJs = fs.readFileSync('delivery.js', 'utf8');

  // =========================================================================
  // 1. Live Order Tracker Modal Lifecycle & Hydration
  // =========================================================================
  await t.test('1. index.html includes order-items-preview with items-preview-meta and kitchen legend', () => {
    assert.match(indexHtml, /id="items-preview-meta"/, 'index.html must include items-preview-meta element');
    assert.match(indexHtml, /<span class="legend-badge rest">🏪<\/span>\s*Kitchen/, 'index.html map legend must include Kitchen origin badge');
  });

  await t.test('2. main.js renders items preview card and metadata unconditionally for single & multi orders', () => {
    assert.match(mainJs, /if\s*\(itemsPreview\)\s*itemsPreview\.style\.display\s*=\s*'flex';/, 'itemsPreview must be shown for all active orders');
    assert.match(mainJs, /itemsMetaEl\.innerHTML\s*=/, 'main.js must populate itemsMetaEl with bag code, payment, and delivery address');
  });

  await t.test('3. backNav transitions smoothly between order-modal and my-orders-modal via replaceTopStep', () => {
    assert.match(mainJs, /backNav\.replaceTopStep\('my-orders-modal'/, 'Transition from order-modal must use replaceTopStep to prevent orphaned history');
  });

  // =========================================================================
  // 2. 5-Step Stepper & Undelivered Bug Fix
  // =========================================================================
  await t.test('4. main.js maps undelivered status cleanly without lighting up Step 4 (Delivered)', () => {
    assert.match(mainJs, /'undelivered':\s*-2/, 'undelivered must map to negative step index to avoid lighting Step 4');
    assert.match(mainJs, /Delivery Attempt Failed — Returned to Kitchen/, 'undelivered status must show explicit returned status badge');
    assert.match(mainJs, /const isFailedOrCancelled = isCancelled \|\| isUndelivered;/, 'Timeline must dim for undelivered orders');
  });

  // =========================================================================
  // 3. Customer Cancellation & Realtime Sync
  // =========================================================================
  await t.test('5. Customer cancellation subtitle attributes cancellation to user', () => {
    assert.match(mainJs, /const isCustomerCancelled = order\.cancelledBy === 'customer' \|\| order\.cancellationReason === 'Cancelled by customer';/, 'main.js must detect if customer initiated cancellation');
    assert.match(mainJs, /const cancelActor = isCustomerCancelled \? 'you' : 'the kitchen';/, 'Subtitle must display "was cancelled by you" when customer cancels');
  });

  await t.test('6. Cancel order button enforces 2-minute limit in tracker and my-orders list', () => {
    assert.match(mainJs, /const withinTwoMins = elapsedMs >= 0 && elapsedMs <= 2 \* 60 \* 1000;/, 'Tracker must enforce 2-minute cancellation limit');
    assert.match(mainJs, /const withinTwoMins = elapsedCancelMs >= 0 && elapsedCancelMs <= 2 \* 60 \* 1000;/, 'My Orders list must enforce 2-minute cancellation limit');
    assert.match(mainJs, /setTimeout\(\(\) => \{[\s\S]*?btnCustomerCancelOrder\.style\.display = 'none';[\s\S]*?\}, remainingMs\);/, 'Tracker must schedule auto-hide when 2 minutes elapse');
  });

  await t.test('7. dataService.updateOrderStatus broadcasts cancellation on sharedBroadcastChannel', () => {
    assert.match(dataServiceJs, /this\.sharedBroadcastChannel\.send\(\{\s*type:\s*'broadcast',\s*event:\s*'order_status_updated',\s*payload:\s*\{[^}]*status:\s*'cancelled'/s, 'updateOrderStatus must broadcast cancelled orders across portals');
  });

  // =========================================================================
  // 4. GPS Map Tracking, Kitchen Origin Pin & Leak Prevention
  // =========================================================================
  await t.test('8. initTrackerLiveMap adds kitchen origin marker with Savera Kitchen icon', () => {
    assert.match(mainJs, /trackerKitchenMarker\s*=\s*L\.marker\(\[restCoords\.lat,\s*restCoords\.lng\],\s*\{\s*icon:\s*kitchenIcon\s*\}\)\.addTo\(trackerLiveMap\);/, 'initTrackerLiveMap must add kitchen marker');
    assert.match(mainJs, /trackerKitchenMarker\s*=\s*null;/, 'destroyTrackerLiveMap must clean up trackerKitchenMarker');
  });

  await t.test('9. resolveOrderCustomerCoords checks street, area, details, and fullText', () => {
    assert.match(mainJs, /a\.details\s*\|\|\s*a\.fullText\s*\|\|\s*a\.street\s*\|\|\s*a\.area/, 'resolveOrderCustomerCoords must check saved address properties correctly');
  });

  await t.test('10. dataService.getRiderLiveLocation prevents cross-order rider location leaking', () => {
    localStorage.removeItem('quickbite_live_rider_location');
    localStorage.setItem('quickbite_live_rider_location', JSON.stringify({
      orderId: 'ORDER-101',
      lat: 12.722,
      lng: 77.288,
      timestamp: Date.now()
    }));

    // Checking for ORDER-202 should return null because orderId does not match
    const locForOther = dataService.getRiderLiveLocation('ORDER-202');
    assert.strictEqual(locForOther, null, 'getRiderLiveLocation must not leak rider position across different orders');

    // Checking for ORDER-101 should match
    const locForSame = dataService.getRiderLiveLocation('ORDER-101');
    assert.ok(locForSame, 'getRiderLiveLocation returns location for matching order');
    assert.strictEqual(locForSame.lat, 12.722);
  });

  await t.test('11. delivery.js filters out noisy GPS positions with accuracy > 150m', () => {
    assert.match(deliveryJs, /if\s*\(pos\.coords\s*&&\s*pos\.coords\.accuracy\s*&&\s*pos\.coords\.accuracy\s*>\s*150\)\s*\{\s*\/\/[^\n]*\s*return;\s*\}/s, 'handleGpsPosition must reject low accuracy GPS fixes (>150m)');
  });
});
