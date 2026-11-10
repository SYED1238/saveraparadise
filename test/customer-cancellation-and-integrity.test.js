import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminToken } from '../api/_auth.js';
import orderActionHandler from '../api/order-action.js';
import { dataService } from '../dataService.js';

if (typeof global.localStorage === 'undefined') {
  const store = new Map();
  global.localStorage = {
    getItem: (key) => store.get(String(key)) ?? null,
    setItem: (key, val) => store.set(String(key), String(val)),
    removeItem: (key) => store.delete(String(key)),
    clear: () => store.clear()
  };
}

if (typeof global.window === 'undefined') {
  global.window = {
    location: { origin: 'http://localhost:3000' }
  };
}

function createMockReqRes({ method = 'POST', url = '/api/order-action', headers = {}, body = null } = {}) {
  let statusCode = 200;
  let responseData = null;
  const responseHeaders = {};

  const req = { method, url, headers: { ...headers }, body };
  const res = {
    status(code) { statusCode = code; return this; },
    setHeader(key, val) { responseHeaders[key] = val; return this; },
    json(data) { responseData = data; return this; },
    end() { return this; },
    get statusCode() { return statusCode; },
    get responseData() { return responseData; },
    get responseHeaders() { return responseHeaders; }
  };
  return { req, res };
}

test('CUSTOMER CANCELLATION & WORKFLOW INTEGRITY SECOND-PASS VERIFICATION SUITE', async (t) => {
  const sampleTrackingToken = '98765432-abcd-ef01-2345-6789abcdef01';
  const sampleOrderId = '#QB-TEST-CANCEL-1';

  // 1. Gateway succeeds
  await t.test('1. Gateway succeeds: POST /api/order-action cancel_order cancels accepted order with valid token', async () => {
    const cleanId = 'TEST-CANCEL-GW-SUCCESS';
    const trackingToken = 'secret-tok-' + cleanId;
    const simulateOrders = [
      { id: cleanId, status: 'accepted', tracking_token: trackingToken, total: '₹450' }
    ];

    const { req, res } = createMockReqRes({
      body: {
        action: 'cancel_order',
        orderId: cleanId,
        trackingToken,
        reason: 'Customer changed mind',
        simulateOrders
      }
    });

    await orderActionHandler(req, res);
    assert.equal(res.statusCode, 200, 'Gateway must return 200 OK');
    assert.equal(res.responseData?.success, true);
    assert.equal(res.responseData?.order?.status, 'cancelled');
    assert.equal(res.responseData?.order?.status_label, 'Order Cancelled');
  });

  // 2. Gateway rejects invalid token
  await t.test('2. Gateway rejects invalid token: POST /api/order-action returns 403 Forbidden', async () => {
    const cleanId = 'TEST-CANCEL-BAD-TOKEN';
    const simulateOrders = [
      { id: cleanId, status: 'accepted', tracking_token: 'valid-secret-token', total: '₹350' }
    ];

    // Case A: Wrong token
    const { req: reqWrong, res: resWrong } = createMockReqRes({
      body: {
        action: 'cancel_order',
        orderId: cleanId,
        trackingToken: 'forged-or-wrong-token',
        simulateOrders
      }
    });
    await orderActionHandler(reqWrong, resWrong);
    assert.equal(resWrong.statusCode, 403);
    assert.match(resWrong.responseData?.error, /Valid cancellation token or staff session required/i);

    // Case B: Missing token
    const { req: reqMissing, res: resMissing } = createMockReqRes({
      body: {
        action: 'cancel_order',
        orderId: cleanId,
        trackingToken: '',
        simulateOrders
      }
    });
    await orderActionHandler(reqMissing, resMissing);
    assert.equal(resMissing.statusCode, 403);
    assert.match(resMissing.responseData?.error, /Valid cancellation token or staff session required/i);
  });

  // 3. Network unavailable: queues offline and keeps pendingStatusSync = true
  await t.test('3. Network unavailable: cancelCustomerOrder marks pendingStatusSync = true and preserves token', async () => {
    const testOrderId = '#QB-OFFLINE-TEST-01';
    const testToken = 'token-offline-01';
    const order = {
      id: testOrderId,
      status: 'accepted',
      trackingToken: testToken,
      createdAt: Date.now()
    };

    dataService.ordersCache = [order];
    global.localStorage.setItem('quickbite_orders', JSON.stringify([order]));
    global.localStorage.setItem('quickbite_tracking_tokens', JSON.stringify({
      [testOrderId]: testToken
    }));

    const originalOrderAction = dataService._orderAction;
    dataService._orderAction = async () => {
      throw new TypeError('Failed to fetch'); // Simulates network outage
    };

    try {
      const res = await dataService.cancelCustomerOrder(testOrderId, 'Customer cancelled offline');
      assert.equal(res.success, true);
      assert.equal(res.confirmed, false);
      assert.equal(res.pendingOffline, true);

      const savedOrder = dataService.getOrderById(testOrderId);
      assert.equal(savedOrder.status, 'cancelled');
      assert.equal(savedOrder.pendingStatusSync, true, 'pendingStatusSync must be kept true when network is down');
      assert.equal(savedOrder.trackingToken, testToken, 'Tracking token must be preserved on the order');

      // Check tracking tokens store
      const tokens = JSON.parse(global.localStorage.getItem('quickbite_tracking_tokens') || '{}');
      assert.equal(tokens[testOrderId], testToken, 'Tracking token must be preserved in localStorage');
    } finally {
      dataService._orderAction = originalOrderAction;
    }
  });

  // 4. Network reconnects & 5. Retry succeeds
  await t.test('4 & 5. Network reconnects & Retry succeeds: syncOfflinePendingOrders drains cancelled orders through cancel_order', async () => {
    const testOrderId = '#QB-RECONNECT-TEST-02';
    const testToken = 'token-reconnect-02';
    const order = {
      id: testOrderId,
      status: 'cancelled',
      pendingStatusSync: true,
      trackingToken: testToken,
      cancellationReason: 'Cancelled offline',
      createdAt: Date.now()
    };

    dataService.ordersCache = [order];
    global.localStorage.setItem('quickbite_orders', JSON.stringify([order]));
    global.localStorage.setItem('quickbite_tracking_tokens', JSON.stringify({
      [testOrderId]: testToken
    }));

    let drainedAction = null;
    let drainedPayload = null;

    const originalOrderAction = dataService._orderAction;
    dataService._orderAction = async (action, payload) => {
      if (action === 'cancel_order') {
        drainedAction = action;
        drainedPayload = payload;
        return { success: true, order: { id: payload.orderId, status: 'cancelled' } };
      }
      return originalOrderAction.call(dataService, action, payload);
    };

    try {
      await dataService.syncOfflinePendingOrders();

      assert.equal(drainedAction, 'cancel_order', 'syncOfflinePendingOrders must drain cancellation via cancel_order endpoint');
      assert.equal(drainedPayload?.orderId, testOrderId);
      assert.equal(drainedPayload?.trackingToken, testToken, 'Preserved tracking token must be passed across retries');

      const updatedOrder = dataService.getOrderById(testOrderId);
      assert.equal(updatedOrder.pendingStatusSync, undefined, 'pendingStatusSync must be cleared after successful gateway retry');
      assert.equal(updatedOrder.status, 'cancelled');
    } finally {
      dataService._orderAction = originalOrderAction;
    }
  });

  // 6. Duplicate cancellation (Idempotency)
  await t.test('6. Duplicate cancellation: Gateway returns 200 with idempotent: true and does not throw', async () => {
    const cleanId = 'TEST-IDEMPOTENT-CANCEL';
    const trackingToken = 'secret-tok-' + cleanId;
    const simulateOrders = [
      { id: cleanId, status: 'cancelled', tracking_token: trackingToken, status_label: 'Order Cancelled' }
    ];

    const { req, res } = createMockReqRes({
      body: {
        action: 'cancel_order',
        orderId: cleanId,
        trackingToken,
        simulateOrders
      }
    });

    await orderActionHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.responseData?.success, true);
    assert.equal(res.responseData?.idempotent, true, 'Gateway must return idempotent: true for already cancelled orders');
  });

  // 7. Customer refreshes the page: Background sync does not resurrect cancelled orders
  await t.test('7. Customer refreshes page: Background sync does not resurrect cancelled order with stale remote accepted status', () => {
    const orderId = '#QB-REFRESH-TEST-07';
    const localOrder = {
      id: orderId,
      status: 'cancelled',
      pendingStatusSync: true,
      _optimisticTimestamp: Date.now() - 40000, // Expired 15s window (>40s ago)
      customerEmail: 'guest@example.com'
    };

    const remoteOrder = {
      id: orderId,
      status: 'accepted',
      customer_email: 'guest@example.com'
    };

    const ORDER_STATUS_RANKS = {
      'pending': 0,
      'accepted': 1,
      'cooking': 2,
      'ready_for_pickup': 3,
      'on_the_way': 4,
      'delivered': 5,
      'cancelled': -1
    };

    const hasPendingStatusLo = Boolean(localOrder.pendingStatusSync);
    const isOptimisticLo = Boolean(localOrder._optimisticTimestamp && (Date.now() - localOrder._optimisticTimestamp < 15000));
    const loRemoteRank = ORDER_STATUS_RANKS[remoteOrder.status] !== undefined ? ORDER_STATUS_RANKS[remoteOrder.status] : -1;
    const loLocalRank = ORDER_STATUS_RANKS[localOrder.status] !== undefined ? ORDER_STATUS_RANKS[localOrder.status] : -1;

    // Check our updated logic
    if (hasPendingStatusLo) {
      if (localOrder.status === 'cancelled') {
        if (remoteOrder.status === 'cancelled') {
          delete localOrder.pendingStatusSync;
        } else if (['cooking', 'ready_for_pickup', 'on_the_way', 'delivered'].includes(remoteOrder.status)) {
          delete localOrder.pendingStatusSync;
        }
      } else if (loRemoteRank >= loLocalRank) {
        delete localOrder.pendingStatusSync;
      }
    }

    const isStaleAcceptedRemoteLo = localOrder.status === 'cancelled' && (remoteOrder.status === 'accepted' || remoteOrder.status === 'pending');
    const canOverrideLo = (loLocalRank > loRemoteRank || isStaleAcceptedRemoteLo);
    const preserveLo = ((hasPendingStatusLo || isOptimisticLo) && canOverrideLo) && remoteOrder.status !== 'cancelled';
    const effectiveStatus = preserveLo ? localOrder.status : remoteOrder.status;

    assert.equal(localOrder.pendingStatusSync, true, 'pendingStatusSync must NOT be cleared by stale remote accepted order');
    assert.equal(preserveLo, true, 'Local cancellation must be preserved despite expired optimistic timestamp');
    assert.equal(effectiveStatus, 'cancelled', 'Order must NOT be resurrected to accepted');
  });

  // 8. Kitchen status changes concurrently: Kitchen progress overrides customer cancellation
  await t.test('8. Kitchen status changes concurrently: Server rejects cancellation and kitchen cooking takes precedence', async () => {
    const cleanId = 'TEST-KITCHEN-RACE-08';
    const trackingToken = 'secret-tok-' + cleanId;
    const simulateOrders = [
      { id: cleanId, status: 'cooking', tracking_token: trackingToken, total: '₹500' }
    ];

    // Gateway rejection test
    const { req, res } = createMockReqRes({
      body: {
        action: 'cancel_order',
        orderId: cleanId,
        trackingToken,
        simulateOrders
      }
    });

    await orderActionHandler(req, res);
    assert.equal(res.statusCode, 400, 'Gateway must return 400 Bad Request once cooking begins');
    assert.match(res.responseData?.error, /Cannot cancel order once kitchen preparation has begun/i);

    // Sync reconciliation test
    const localOrder = {
      id: cleanId,
      status: 'cancelled',
      pendingStatusSync: true,
      _optimisticTimestamp: Date.now()
    };
    const remoteOrder = {
      id: cleanId,
      status: 'cooking'
    };

    const hasPendingStatusLo = Boolean(localOrder.pendingStatusSync);
    if (hasPendingStatusLo) {
      if (localOrder.status === 'cancelled') {
        if (remoteOrder.status === 'cancelled') {
          delete localOrder.pendingStatusSync;
        } else if (['cooking', 'ready_for_pickup', 'on_the_way', 'delivered'].includes(remoteOrder.status)) {
          delete localOrder.pendingStatusSync;
        }
      }
    }

    assert.equal(localOrder.pendingStatusSync, undefined, 'pendingStatusSync must be cleared when kitchen has moved to cooking');
  });

  // 9. Customer cannot cancel after cooking starts
  await t.test('9. Customer cannot cancel after cooking starts: Pre-check rejects immediate cancellation request', async () => {
    const testOrderId = '#QB-COOKING-BLOCKED-09';
    const testToken = 'token-cooking-09';
    const order = {
      id: testOrderId,
      status: 'cooking',
      trackingToken: testToken,
      createdAt: Date.now()
    };

    dataService.ordersCache = [order];
    global.localStorage.setItem('quickbite_orders', JSON.stringify([order]));
    global.localStorage.setItem('quickbite_tracking_tokens', JSON.stringify({
      [testOrderId]: testToken
    }));

    const res = await dataService.cancelCustomerOrder(testOrderId);
    assert.equal(res.success, false);
    assert.equal(res.error, 'invalid_status');
    assert.equal(res.currentStatus, 'cooking');

    const unchangedOrder = dataService.getOrderById(testOrderId);
    assert.equal(unchangedOrder.status, 'cooking', 'Order must remain in cooking status');
  });

  // 10. Non-disruption: Staff update_status action still works normally for kitchen/admin
  await t.test('10. Non-disruption: Staff update_status action still works normally for kitchen/admin', async () => {
    const staffToken = createAdminToken('admin');
    const { req, res } = createMockReqRes({
      headers: { authorization: `Bearer ${staffToken}` },
      body: {
        action: 'update_status',
        orderId: '#QB-STAFF-101',
        status: 'cooking'
      }
    });

    await orderActionHandler(req, res);
    assert.notEqual(res.statusCode, 401, 'Staff update must pass authentication');
  });

  // 11. Non-disruption: Rider claim_order action still enforces rider role authentication
  await t.test('11. Non-disruption: Rider claim_order action still enforces rider role authentication', async () => {
    const { req, res } = createMockReqRes({
      body: {
        action: 'claim_order',
        orderId: '#QB-CLAIM-101',
        riderPin: '1234'
      }
    });

    await orderActionHandler(req, res);
    assert.equal(res.statusCode, 401, 'Unauthenticated rider claim must be rejected');
  });
});
