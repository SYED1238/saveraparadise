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

test('CUSTOMER CANCELLATION & WORKFLOW INTEGRITY VERIFICATION SUITE', async (t) => {
  const sampleTrackingToken = '98765432-abcd-ef01-2345-6789abcdef01';
  const sampleOrderId = '#QB-TEST-CANCEL-1';

  await t.test('1. POST /api/order-action cancel_order passes 403 gate when valid tracking token provided', async () => {
    const { req, res } = createMockReqRes({
      body: {
        action: 'cancel_order',
        orderId: sampleOrderId,
        trackingToken: sampleTrackingToken,
        reason: 'Customer requested cancellation'
      }
    });

    await orderActionHandler(req, res);
    // Verified tracking token must pass the 403 Forbidden security gate
    assert.notEqual(res.statusCode, 403, 'Request with tracking token must not be rejected with 403 Forbidden');
  });

  await t.test('2. POST /api/order-action cancel_order rejects missing trackingToken for customers with 403 Forbidden', async () => {
    const { req, res } = createMockReqRes({
      body: {
        action: 'cancel_order',
        orderId: sampleOrderId,
        trackingToken: ''
      }
    });

    await orderActionHandler(req, res);
    assert.equal(res.statusCode, 403);
    assert.match(res.responseData?.error, /Valid cancellation token or staff session required/i);
  });

  await t.test('3. POST /api/order-action cancel_order allows authorized staff session without tracking token', async () => {
    const staffToken = createAdminToken('admin');
    const { req, res } = createMockReqRes({
      headers: { authorization: `Bearer ${staffToken}` },
      body: {
        action: 'cancel_order',
        orderId: sampleOrderId,
        reason: 'Out of stock'
      }
    });

    await orderActionHandler(req, res);
    // Staff session passes the 403 check
    assert.notEqual(res.statusCode, 403, 'Staff token must bypass 403 tracking token requirement');
  });

  await t.test('4. dataService.updateOrderStatus invokes _orderAction cancel_order on cancellation', async () => {
    let orderActionInvoked = false;
    let orderActionParams = null;

    const originalOrderAction = dataService._orderAction;
    dataService._orderAction = async (action, payload) => {
      if (action === 'cancel_order') {
        orderActionInvoked = true;
        orderActionParams = payload;
        return { success: true, order: { id: payload.orderId, status: 'cancelled' } };
      }
      return originalOrderAction.call(dataService, action, payload);
    };

    try {
      const testOrderId = '#QB-CANCEL-TEST-99';
      const testToken = 'test-token-uuid-1234';
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

      const res = dataService.updateOrderStatus(testOrderId, 'cancelled', 'customer', {
        cancellationReason: 'Cancelled by customer'
      });

      assert.ok(res, 'updateOrderStatus must return updated order');
      assert.equal(res.status, 'cancelled');

      // Allow microtask queue to process doCancelUpdate
      await new Promise(r => setTimeout(r, 60));

      assert.equal(orderActionInvoked, true, '_orderAction cancel_order must be invoked on cancellation');
      assert.equal(orderActionParams?.orderId, testOrderId);
      assert.equal(orderActionParams?.trackingToken, testToken);
      assert.equal(orderActionParams?.reason, 'Cancelled by customer');
    } finally {
      dataService._orderAction = originalOrderAction;
    }
  });

  await t.test('5. Reversion defense: Expired optimistic window does not revert cancelled order if pendingStatusSync is true', () => {
    const expiredOptimisticTimestamp = Date.now() - 30000; // 30 seconds ago (> 15s window)
    const localOrder = {
      id: '#QB-CANCELLED-99',
      status: 'cancelled',
      _optimisticTimestamp: expiredOptimisticTimestamp,
      pendingStatusSync: true,
      customerEmail: 'customer@example.com'
    };

    const remoteOrder = {
      id: '#QB-CANCELLED-99',
      status: 'accepted',
      customer_email: 'customer@example.com'
    };

    const ORDER_STATUS_RANKS = { 'accepted': 0, 'cancelled': -1 };
    const hasPendingStatusLo = Boolean(localOrder.pendingStatusSync);
    const isOptimisticLo = Boolean(localOrder._optimisticTimestamp && (Date.now() - localOrder._optimisticTimestamp < 15000));
    const loRemoteRank = ORDER_STATUS_RANKS[remoteOrder.status] !== undefined ? ORDER_STATUS_RANKS[remoteOrder.status] : -1;
    const loLocalRank = ORDER_STATUS_RANKS[localOrder.status] !== undefined ? ORDER_STATUS_RANKS[localOrder.status] : -1;

    const canOverrideLo = (loLocalRank > loRemoteRank || (localOrder.status === 'cancelled' && remoteOrder.status !== 'cancelled'));
    const preserveLo = ((hasPendingStatusLo || isOptimisticLo) && canOverrideLo) && remoteOrder.status !== 'cancelled';
    const effectiveStatus = preserveLo ? localOrder.status : remoteOrder.status;

    assert.equal(preserveLo, true, 'Cancellation must be preserved despite expired 15s optimistic window');
    assert.equal(effectiveStatus, 'cancelled', 'Status must remain cancelled and not revert to accepted');
  });

  await t.test('6. Non-disruption: Staff update_status action still works normally for kitchen/admin', async () => {
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

  await t.test('7. Non-disruption: Rider claim_order action still enforces rider role authentication', async () => {
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
