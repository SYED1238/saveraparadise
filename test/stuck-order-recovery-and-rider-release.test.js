import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'crypto';
import orderActionHandler from '../api/order-action.js';
import { onRequest as cloudflareOrderAction } from '../functions/api/order-action.js';
import { createAdminToken } from '../api/_auth.js';

function createMockReqRes({ method = 'POST', body = {}, headers = {}, query = {} }) {
  const req = {
    method,
    body,
    query,
    headers: {
      'content-type': 'application/json',
      ...headers
    }
  };

  let statusCode = 200;
  let responseData = null;
  const resHeaders = {};

  const res = {
    status(code) {
      statusCode = code;
      return res;
    },
    setHeader(key, val) {
      resHeaders[key.toLowerCase()] = val;
      return res;
    },
    json(data) {
      responseData = data;
      return res;
    },
    send(data) {
      responseData = data;
      return res;
    },
    end() {
      return res;
    },
    _getStatusCode: () => statusCode,
    _getData: () => responseData,
    _getHeaders: () => resHeaders
  };

  return { req, res };
}

test('STUCK ORDER RECOVERY, RIDER RELEASE FLOW & TRAP PREVENTION SUITE', async (t) => {
  const riderToken = createAdminToken(3600000, 'rider', { riderPin: '2233', name: 'Zaid Khan' });
  const otherRiderToken = createAdminToken(3600000, 'rider', { riderPin: '4422', name: 'Tanveer Ahmed' });
  const adminToken = createAdminToken(3600000, 'admin', { username: 'kitchen_manager' });
  const ownerToken = createAdminToken(3600000, 'owner', { username: 'restaurant_owner' });

  await t.test('1. release_rider Endpoint Security & Functionality', async () => {
    // 1a. Rejects unauthenticated request
    const { req: req1, res: res1 } = createMockReqRes({
      body: { action: 'release_rider', orderId: '#QB-101' }
    });
    await orderActionHandler(req1, res1);
    assert.equal(res1._getStatusCode(), 401, 'Unauthenticated release_rider must return 401');

    // 1b. Rejects rider role (only kitchen staff/owner can unassign)
    const { req: req2, res: res2 } = createMockReqRes({
      headers: { authorization: `Bearer ${riderToken}` },
      body: { action: 'release_rider', orderId: '#QB-101' }
    });
    await orderActionHandler(req2, res2);
    assert.equal(res2._getStatusCode(), 401, 'Rider token cannot call release_rider');

    // 1c. Successfully releases rider from ready_for_pickup order
    const simulateOrders = [
      {
        id: '#QB-101',
        status: 'ready_for_pickup',
        assigned_rider_pin: '2233',
        assigned_rider_name: 'Zaid Khan',
        assigned_rider_phone: '+91 98451 22334',
        assigned_rider_vehicle: 'Bike',
        rider_assigned_at: Date.now() - 600000,
        address_details: {
          address: 'Test Address Ramanagara',
          riderPickupStage: 'going_to_restaurant',
          riderAssignedAt: Date.now() - 600000
        }
      }
    ];

    const { req: req3, res: res3 } = createMockReqRes({
      headers: { authorization: `Bearer ${adminToken}` },
      body: { action: 'release_rider', orderId: '#QB-101', simulateOrders }
    });
    await orderActionHandler(req3, res3);
    assert.equal(res3._getStatusCode(), 200, 'Staff can successfully release rider');
    const orderData = res3._getData()?.order;
    assert.equal(orderData.assigned_rider_pin, null, 'assigned_rider_pin must be cleared to null');
    assert.equal(orderData.assigned_rider_name, null, 'assigned_rider_name must be cleared to null');
    assert.equal(orderData.rider_assigned_at, null, 'rider_assigned_at must be cleared to null');
    assert.equal(orderData.address_details?.riderPickupStage, undefined, 'riderPickupStage must be deleted');
    assert.equal(orderData.address_details?.riderAssignedAt, undefined, 'riderAssignedAt must be deleted');
    assert.equal(orderData.address_details?.address, 'Test Address Ramanagara', 'Customer address must be preserved');

    // 1d. Rejects releasing rider if order is already out for delivery (on_the_way)
    const onTheWayOrders = [
      { id: '#QB-102', status: 'on_the_way', assigned_rider_pin: '2233' }
    ];
    const { req: req4, res: res4 } = createMockReqRes({
      headers: { authorization: `Bearer ${adminToken}` },
      body: { action: 'release_rider', orderId: '#QB-102', simulateOrders: onTheWayOrders }
    });
    await orderActionHandler(req4, res4);
    assert.equal(res4._getStatusCode(), 409, 'Cannot release rider if order is already out for delivery');
  });

  await t.test('2. rider_drop_order Endpoint Security & Functionality', async () => {
    // 2a. Rejects unauthenticated
    const { req: req1, res: res1 } = createMockReqRes({
      body: { action: 'rider_drop_order', orderId: '#QB-101' }
    });
    await orderActionHandler(req1, res1);
    assert.equal(res1._getStatusCode(), 401, 'Unauthenticated rider_drop_order must return 401');

    // 2b. Rejects admin role (must be rider)
    const { req: req2, res: res2 } = createMockReqRes({
      headers: { authorization: `Bearer ${adminToken}` },
      body: { action: 'rider_drop_order', orderId: '#QB-101' }
    });
    await orderActionHandler(req2, res2);
    assert.equal(res2._getStatusCode(), 401, 'Staff session cannot call rider_drop_order');

    // 2c. Rejects if not assigned to this rider
    const simulateOrders = [
      {
        id: '#QB-101',
        status: 'ready_for_pickup',
        assigned_rider_pin: '4422',
        address_details: { riderPickupStage: 'going_to_restaurant', riderAssignedAt: Date.now() }
      }
    ];
    const { req: req3, res: res3 } = createMockReqRes({
      headers: { authorization: `Bearer ${riderToken}` }, // PIN is 2233, but order assigned to 4422
      body: { action: 'rider_drop_order', orderId: '#QB-101', simulateOrders }
    });
    await orderActionHandler(req3, res3);
    assert.equal(res3._getStatusCode(), 403, 'Rider cannot drop order assigned to a different rider');

    // 2d. Successfully drops order and records in dropped_rider_pins
    const assignedToZaid = [
      {
        id: '#QB-101',
        status: 'ready_for_pickup',
        assigned_rider_pin: '2233',
        assigned_rider_name: 'Zaid Khan',
        rider_assigned_at: Date.now(),
        address_details: { address: 'Main Street', riderPickupStage: 'going_to_restaurant', riderAssignedAt: Date.now() }
      }
    ];
    const { req: req4, res: res4 } = createMockReqRes({
      headers: { authorization: `Bearer ${riderToken}` },
      body: { action: 'rider_drop_order', orderId: '#QB-101', reason: 'Flat tyre', simulateOrders: assignedToZaid }
    });
    await orderActionHandler(req4, res4);
    assert.equal(res4._getStatusCode(), 200, 'Assigned rider can voluntarily drop order');
    const droppedOrder = res4._getData()?.order;
    assert.equal(droppedOrder.assigned_rider_pin, null, 'Rider PIN must be unassigned');
    assert.equal(droppedOrder.rider_assigned_at, null, 'rider_assigned_at must be cleared');
    assert.equal(droppedOrder.address_details?.riderPickupStage, undefined, 'riderPickupStage must be deleted');
    assert.ok(Array.isArray(droppedOrder.dropped_rider_pins), 'dropped_rider_pins must be an array');
    assert.equal(droppedOrder.dropped_rider_pins.length, 1, 'dropped entry must be recorded');
    assert.equal(droppedOrder.dropped_rider_pins[0].pin, '2233');
    assert.equal(droppedOrder.dropped_rider_pins[0].reason, 'Flat tyre');
  });

  await t.test('3. Staff Cancellation of ready_for_pickup Orders (Trap 1 & Trap 2 Checks)', async () => {
    // 3a. Customer cannot cancel ready_for_pickup
    const readyOrders = [
      {
        id: '#QB-101',
        status: 'ready_for_pickup',
        tracking_token: 'secret-tok-101',
        created_at: new Date(Date.now() - 30000).toISOString(),
        total: '₹350'
      }
    ];
    const { req: req1, res: res1 } = createMockReqRes({
      body: { action: 'cancel_order', orderId: '#QB-101', trackingToken: 'secret-tok-101', simulateOrders: readyOrders }
    });
    await orderActionHandler(req1, res1);
    assert.equal(res1._getStatusCode(), 400, 'Customer cannot cancel order once preparation has begun (ready_for_pickup)');

    // 3b. Staff CAN cancel ready_for_pickup when cancellation reason is supplied
    const { req: req2, res: res2 } = createMockReqRes({
      headers: { authorization: `Bearer ${adminToken}` },
      body: {
        action: 'cancel_order',
        orderId: '#QB-101',
        reason: 'Rider No-Show: food cold on shelf',
        simulateOrders: [
          {
            id: '#QB-101',
            status: 'ready_for_pickup',
            assigned_rider_pin: '2233',
            assigned_rider_name: 'Zaid Khan',
            address_details: {
              riderPickupStage: 'going_to_restaurant',
              riderAssignedAt: Date.now() - 900000
            }
          }
        ]
      }
    });
    await orderActionHandler(req2, res2);
    assert.equal(res2._getStatusCode(), 200, 'Staff can cancel ready_for_pickup with reason');
    const cancelledOrder = res2._getData()?.order;
    assert.equal(cancelledOrder.status, 'cancelled');
    assert.equal(cancelledOrder.assigned_rider_pin, null, 'Assigned rider must be cleared on cancellation');
    assert.equal(cancelledOrder.address_details?.riderPickupStage, undefined, 'riderPickupStage must be cleared');
    assert.equal(cancelledOrder.cancellation_reason, 'Rider No-Show: food cold on shelf');
  });

  await t.test('4. Address Details Multi-Row Overwrite Guard (Trap 3 Invariant)', () => {
    // Inspect api/order-action.js and functions/api/order-action.js to ensure kitchen_poll does NOT pass single address_details to .in()
    const apiCode = fs.readFileSync(path.join(process.cwd(), 'api', 'order-action.js'), 'utf8');
    const fnCode = fs.readFileSync(path.join(process.cwd(), 'functions', 'api', 'order-action.js'), 'utf8');

    for (const code of [apiCode, fnCode]) {
      // Must not do .in('id', expiredOrderIds) with an address_details update object
      assert.doesNotMatch(code, /\.in\('id',\s*expiredOrderIds\)/, 'Must never batch update address_details across multiple rows using .in(expiredOrderIds)');
      // Must loop or update per expired order
      assert.match(code, /expiredOrders\.map\(async\s*\(expOrd\)/, 'Must update each expired order individually using its own address_details');
    }
  });

  await t.test('5. dataService Explicit-Null Merge Bug (Trap 4 & Ghost Rider Resurrection)', async () => {
    const dataServiceCode = fs.readFileSync(path.join(process.cwd(), 'dataService.js'), 'utf8');
    // Ensure all 3 sync merge points check hasOwnProperty so explicit null is not overwritten by local value
    const nullMergeOccurrences = (dataServiceCode.match(/Object\.prototype\.hasOwnProperty\.call\(remote,\s*'assigned_rider_pin'\)/g) || []).length;
    assert.ok(nullMergeOccurrences >= 2, 'dataService.js must check hasOwnProperty for assigned_rider_pin across sync merge sites');
    assert.ok(dataServiceCode.includes('releaseRiderFromOrder'), 'dataService must expose releaseRiderFromOrder');
    assert.ok(dataServiceCode.includes('dropAssignedOrder'), 'dataService must expose dropAssignedOrder');
  });

  await t.test('6. UI & Modal Parity Across Portals', () => {
    const adminHtml = fs.readFileSync(path.join(process.cwd(), 'admin.html'), 'utf8');
    const adminJs = fs.readFileSync(path.join(process.cwd(), 'admin.js'), 'utf8');
    const deliveryHtml = fs.readFileSync(path.join(process.cwd(), 'delivery.html'), 'utf8');
    const deliveryJs = fs.readFileSync(path.join(process.cwd(), 'delivery.js'), 'utf8');
    const ownerHtml = fs.readFileSync(path.join(process.cwd(), 'owner.html'), 'utf8');
    const ownerJs = fs.readFileSync(path.join(process.cwd(), 'owner.js'), 'utf8');

    // Admin Portal
    assert.ok(adminHtml.includes('id="stale-shift-orders-banner"'), 'admin.html must have #stale-shift-orders-banner');
    assert.ok(adminHtml.includes('data-reason="Rider No-Show"'), 'admin.html cancel modal must have Rider No-Show pill');
    assert.ok(adminHtml.includes('data-reason="Kitchen Closing"'), 'admin.html cancel modal must have Kitchen Closing pill');
    assert.ok(adminHtml.includes('id="cancel-prepaid-warning"'), 'admin.html cancel modal must have #cancel-prepaid-warning');
    assert.ok(adminHtml.includes('id="cancel-prepaid-confirm-check"'), 'admin.html cancel modal must have #cancel-prepaid-confirm-check');
    assert.ok(adminJs.includes('btn-release-rider'), 'admin.js must wire btn-release-rider');
    assert.ok(adminJs.includes('releaseRiderFromOrder'), 'admin.js must call releaseRiderFromOrder');

    // Delivery Portal
    assert.ok(deliveryHtml.includes('id="modal-rider-drop-backdrop"'), 'delivery.html must have #modal-rider-drop-backdrop');
    assert.ok(deliveryHtml.includes('id="btn-confirm-rider-drop"'), 'delivery.html must have #btn-confirm-rider-drop');
    assert.ok(deliveryJs.includes('btn-rider-drop-order'), 'delivery.js must render .btn-rider-drop-order in Stage 1');
    assert.ok(deliveryJs.includes('openRiderDropModal'), 'delivery.js must wire openRiderDropModal');
    assert.ok(deliveryJs.includes('dropAssignedOrder'), 'delivery.js must call dropAssignedOrder');

    // Owner Portal
    assert.ok(ownerHtml.includes('id="owner-stale-alert-banner"'), 'owner.html must have #owner-stale-alert-banner');
    assert.ok(ownerJs.includes('owner-stale-alert-banner'), 'owner.js must wire #owner-stale-alert-banner');
  });

  await t.test('7. Edge-Case Guards: SQL Timestamp Null Safety & Portal Stale Banner Dynamic Re-binding', () => {
    const migrationSql = fs.readFileSync(path.join(process.cwd(), 'supabase_migration_15_stuck_order_recovery_and_rider_release.sql'), 'utf8');
    const ownerJs = fs.readFileSync(path.join(process.cwd(), 'owner.js'), 'utf8');
    const adminJs = fs.readFileSync(path.join(process.cwd(), 'admin.js'), 'utf8');

    // 7a. SQL RPC must check v_assigned_at > 0 before timeout comparison to prevent instant takeover on null timestamps
    assert.match(
      migrationSql,
      /v_assigned_at\s*>\s*0\s*AND\s*\(v_now_ms\s*-\s*v_assigned_at\)\s*>\s*900000/,
      'rider_assign_or_claim_order in SQL migration must guard v_assigned_at > 0 before checking 900000 ms timeout'
    );

    // 7b. Owner portal must include on_the_way in stale shift order audit
    assert.match(
      ownerJs,
      /isUnresolved\s*=\s*\[[^\]]*'on_the_way'[^\]]*\]\.includes\(s\)/,
      'owner.js must include on_the_way in isUnresolved filter'
    );

    // 7c. Owner portal must dynamically update dataset.firstStaleId on btnOwnerFilterStale
    assert.ok(
      ownerJs.includes('btnOwnerFilterStale.dataset.firstStaleId ='),
      'owner.js must update btnOwnerFilterStale.dataset.firstStaleId to avoid stale click closure'
    );

    // 7d. Admin portal must dynamically update dataset.firstStaleId on btnStaleFilter
    assert.ok(
      adminJs.includes('btnStaleFilter.dataset.firstStaleId ='),
      'admin.js must update btnStaleFilter.dataset.firstStaleId to avoid stale click closure'
    );
  });
});
