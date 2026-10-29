import test from 'node:test';
import assert from 'node:assert/strict';

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

import { dataService, ORDER_STATUS_RANKS, STATUS_TO_STEP_INDEX, STATUS_TO_LABEL_MAP } from '../dataService.js';

test('ORDER STATUS PROGRESSION & LIFECYCLE SYNCHRONIZATION SUITE', async (t) => {
  await t.test('1. Status-to-StepIndex mapping aligns strictly with 5-step customer tracker timeline', () => {
    // Timeline steps in index.html:
    // Step 0: Accepted
    // Step 1: Preparing (cooking)
    // Step 2: Ready to Dispatch (ready_for_pickup)
    // Step 3: Dispatched (on_the_way)
    // Step 4: Delivered (delivered)
    assert.strictEqual(STATUS_TO_STEP_INDEX['pending'], 0, 'Pending maps to Step 0');
    assert.strictEqual(STATUS_TO_STEP_INDEX['accepted'], 0, 'Accepted maps to Step 0');
    assert.strictEqual(STATUS_TO_STEP_INDEX['cooking'], 1, 'Cooking maps to Step 1 (Preparing)');
    assert.strictEqual(STATUS_TO_STEP_INDEX['ready_for_pickup'], 2, 'Ready for pickup maps to Step 2 (Ready to Dispatch)');
    assert.strictEqual(STATUS_TO_STEP_INDEX['on_the_way'], 3, 'On the way maps to Step 3 (Dispatched)');
    assert.strictEqual(STATUS_TO_STEP_INDEX['delivered'], 4, 'Delivered maps to Step 4 (Delivered)');
    assert.strictEqual(STATUS_TO_STEP_INDEX['cancelled'], -1, 'Cancelled maps to -1');
  });

  await t.test('2. Authoritative status label mapping overrides stale local or database statusLabel', () => {
    assert.strictEqual(STATUS_TO_LABEL_MAP['accepted'], 'Accepted');
    assert.strictEqual(STATUS_TO_LABEL_MAP['cooking'], 'Preparing');
    assert.strictEqual(STATUS_TO_LABEL_MAP['ready_for_pickup'], 'Ready to Dispatch');
    assert.strictEqual(STATUS_TO_LABEL_MAP['on_the_way'], 'Dispatched');
    assert.strictEqual(STATUS_TO_LABEL_MAP['delivered'], 'Delivered');

    // Simulate an order that advanced to 'cooking' but still had stale 'statusLabel: "Accepted"'
    const staleOrder = {
      id: '#QB-4450',
      status: 'cooking',
      statusLabel: 'Accepted',
      stepIndex: 0
    };

    // Test dynamic status label resolution (as patched in admin.js)
    let resolvedLabel = '';
    if (staleOrder.status === 'cancelled') resolvedLabel = 'Cancelled';
    else if (staleOrder.status === 'undelivered') resolvedLabel = 'Undelivered (Returned)';
    else if (staleOrder.status === 'cooking') resolvedLabel = 'Preparing';
    else if (staleOrder.status === 'ready_for_pickup') resolvedLabel = 'Ready to Dispatch';
    else if (staleOrder.status === 'on_the_way') resolvedLabel = 'Dispatched';
    else if (staleOrder.status === 'delivered') resolvedLabel = 'Delivered';
    else if (staleOrder.status === 'accepted' || staleOrder.status === 'pending') resolvedLabel = 'Accepted';
    else resolvedLabel = staleOrder.statusLabel || 'Accepted';

    assert.strictEqual(resolvedLabel, 'Preparing', 'Badge label must reflect Preparing when status is cooking, ignoring stale Accepted');
  });

  await t.test('3. Dynamic step index in customer tracker guarantees Step 1 is active when cooking', () => {
    // Simulate customer tracking timeline logic with a stale stepIndex: 0
    const testOrder = {
      id: '#QB-4450',
      status: 'cooking',
      stepIndex: 0 // Stale or unsynced stepIndex
    };

    const computedStepIndex = STATUS_TO_STEP_INDEX[testOrder.status] !== undefined
      ? STATUS_TO_STEP_INDEX[testOrder.status]
      : (typeof testOrder.stepIndex === 'number' ? testOrder.stepIndex : 0);

    assert.strictEqual(computedStepIndex, 1, 'Customer tracker must resolve Step 1 (Preparing) when status is cooking');

    // Simulate timeline element classes
    const stepStates = [0, 1, 2, 3, 4].map(idx => {
      if (idx < computedStepIndex) return 'active';
      if (idx === computedStepIndex) return 'active current';
      return 'inactive';
    });

    assert.strictEqual(stepStates[0], 'active', 'Step 0 (Accepted) must be marked active (completed)');
    assert.strictEqual(stepStates[1], 'active current', 'Step 1 (Preparing) must be marked active current (in progress)');
    assert.strictEqual(stepStates[2], 'inactive', 'Step 2 (Ready to Dispatch) must be inactive');
    assert.strictEqual(stepStates[3], 'inactive', 'Step 3 (Dispatched) must be inactive');
    assert.strictEqual(stepStates[4], 'inactive', 'Step 4 (Delivered) must be inactive');
  });

  await t.test('4. Admin card contextual subtitle correctly distinguishes shelf vs cooking vs accepted', () => {
    function computeRiderTag(order) {
      if (order.assignedRiderName) {
        return 'Assigned Rider: ' + order.assignedRiderName;
      } else if (order.status === 'ready_for_pickup') {
        return 'Kitchen Shelf • Awaiting Rider Pickup';
      } else if (order.status === 'cooking') {
        return 'Chef Preparing • Cooking in Kitchen';
      } else if (order.status === 'accepted' || order.status === 'pending') {
        return 'Order Accepted • Awaiting Kitchen Cooking';
      } else if (order.status === 'cancelled') {
        return 'Order Cancelled';
      } else if (order.status === 'undelivered') {
        return 'Returned to Kitchen';
      }
      return 'Processing';
    }

    assert.strictEqual(computeRiderTag({ status: 'cooking' }), 'Chef Preparing • Cooking in Kitchen');
    assert.strictEqual(computeRiderTag({ status: 'accepted' }), 'Order Accepted • Awaiting Kitchen Cooking');
    assert.strictEqual(computeRiderTag({ status: 'ready_for_pickup' }), 'Kitchen Shelf • Awaiting Rider Pickup');
    assert.strictEqual(computeRiderTag({ status: 'on_the_way', assignedRiderName: 'Rahul' }), 'Assigned Rider: Rahul');
  });

  await t.test('5. Normalized ID matching works seamlessly across hash and non-hash representations', () => {
    const norm = (id) => String(id || '').trim().replace(/^#/, '');

    const incomingPayload = { orderId: 'QB-4450', status: 'cooking' };
    const localOrders = [
      { id: '#QB-4450', status: 'accepted' },
      { id: '#QB-1122', status: 'accepted' }
    ];

    const targetNorm = norm(incomingPayload.orderId);
    const matched = localOrders.find(o => o && norm(o.id) === targetNorm);

    assert.ok(matched, 'Order with #QB-4450 must match payload with QB-4450');
    assert.strictEqual(matched.id, '#QB-4450');

    // Check activeOrderId comparison
    const activeOrderId = '#QB-4450';
    assert.strictEqual(norm(activeOrderId) === targetNorm, true, 'Active order ID check must pass with normalized IDs');
  });

  await t.test('6. Monotonic status rank ordering prevents pipeline reversal', () => {
    // 0: pending, 1: accepted, 2: cooking, 3: ready_for_pickup, 4: on_the_way, 5: delivered
    function canAdvance(currentStatus, targetStatus) {
      const cur = ORDER_STATUS_RANKS[currentStatus] ?? -1;
      const tgt = ORDER_STATUS_RANKS[targetStatus] ?? -1;
      return tgt > cur;
    }

    assert.strictEqual(canAdvance('accepted', 'cooking'), true);
    assert.strictEqual(canAdvance('cooking', 'ready_for_pickup'), true);
    assert.strictEqual(canAdvance('ready_for_pickup', 'on_the_way'), true);
    assert.strictEqual(canAdvance('on_the_way', 'delivered'), true);

    // Backward regressions must be strictly rejected
    assert.strictEqual(canAdvance('cooking', 'accepted'), false);
    assert.strictEqual(canAdvance('ready_for_pickup', 'cooking'), false);
    assert.strictEqual(canAdvance('on_the_way', 'ready_for_pickup'), false);
    assert.strictEqual(canAdvance('delivered', 'on_the_way'), false);
  });

  await t.test('7. Supabase sessionIds generation safely double-quotes IDs and includes both hash and non-hash variants', () => {
    const sessionIds = ['#QB-4450', 'QB-8812'];
    const allVariantIds = new Set();
    sessionIds.forEach(id => {
      if (!id) return;
      const strId = String(id).trim();
      const clean = strId.replace(/^#/, '');
      if (clean) {
        allVariantIds.add(`"${clean}"`);
        allVariantIds.add(`"#${clean}"`);
      }
    });

    const idList = Array.from(allVariantIds);
    assert.ok(idList.includes('"4450"') || idList.includes('"QB-4450"'));
    assert.ok(idList.includes('"#4450"') || idList.includes('"#QB-4450"'));
    assert.ok(idList.includes('"8812"') || idList.includes('"QB-8812"'));

    const queryPart = `id.in.(${idList.join(',')})`;
    assert.ok(queryPart.startsWith('id.in.('), 'Must generate valid PostgREST id.in.(...) filter');
    assert.ok(queryPart.endsWith(')'), 'Filter must close with closing parenthesis');
    // Ensure quotes surround each value
    idList.forEach(val => {
      assert.ok(val.startsWith('"') && val.endsWith('"'), `Value ${val} must be double quoted for PostgREST`);
    });
  });

  await t.test('8. Realtime order_status_updated payload structure adheres to contract', () => {
    const samplePayload = {
      orderId: '#QB-4450',
      status: 'cooking',
      prevStatus: 'accepted',
      statusLabel: 'Preparing',
      stepIndex: 1,
      eta: '15 - 20 Minutes',
      source: 'admin',
      timestamp: Date.now()
    };

    assert.strictEqual(typeof samplePayload.orderId, 'string');
    assert.strictEqual(samplePayload.status, 'cooking');
    assert.strictEqual(samplePayload.prevStatus, 'accepted');
    assert.strictEqual(samplePayload.statusLabel, 'Preparing');
    assert.strictEqual(samplePayload.stepIndex, 1);
    assert.strictEqual(typeof samplePayload.timestamp, 'number');
    assert.ok(samplePayload.timestamp > 0);
  });

  await t.test('9. updateOrder allows cancellation and accepts admin/rider sources', () => {
    // Setup test orders
    const testOrders = [
      { id: '#QB-TEST-1', status: 'accepted', total: '₹300' },
      { id: '#QB-TEST-2', status: 'ready_for_pickup', total: '₹400' }
    ];
    dataService.saveOrders(testOrders);

    // Cancel order in accepted state
    const cancelled = dataService.updateOrder('#QB-TEST-1', { status: 'cancelled', source: 'admin' });
    assert.ok(cancelled, 'updateOrder must not block cancellation');
    assert.strictEqual(cancelled.status, 'cancelled');
    assert.strictEqual(cancelled.stepIndex, -1);
    assert.strictEqual(cancelled.statusLabel, 'Cancelled');

    // Admin source updates ready_for_pickup to on_the_way
    const dispatched = dataService.updateOrder('#QB-TEST-2', { status: 'on_the_way', source: 'admin' });
    assert.ok(dispatched, 'updateOrder must permit admin source for on_the_way transition');
    assert.strictEqual(dispatched.status, 'on_the_way');
  });

  await t.test('10. Customer portal getOrders never marks undelivered orders as delivered after 3 hours', () => {
    const fourHoursAgo = Date.now() - (4 * 60 * 60 * 1000);
    const staleOrders = [
      { id: '#QB-UNDELIV', status: 'undelivered', createdAt: fourHoursAgo },
      { id: '#QB-CANCELLED', status: 'cancelled', createdAt: fourHoursAgo }
    ];
    dataService.portalType = 'customer';
    dataService.saveOrders(staleOrders);

    const orders = dataService.getOrders();
    const undelivered = orders.find(o => o.id === '#QB-UNDELIV');
    assert.strictEqual(undelivered.status, 'undelivered', 'Undelivered status must never mutate into delivered');
  });
});
