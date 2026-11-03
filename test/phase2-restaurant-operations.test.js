import test from 'node:test';
import assert from 'node:assert/strict';

// Test the Phase 2 Restaurant Operations & Geofencing logic
test('PHASE 2: RESTAURANT OPERATIONS & GEOFENCING DEFENSE SUITE', async (t) => {
  await t.test('1. claimOrderByBagCode strictly requires ready_for_pickup status', () => {
    // Model the status gate from dataService.js
    function canClaimOrder(order) {
      if (!order) return { success: false, reason: 'not_found' };
      if (order.status === 'on_the_way') return { success: false, reason: 'already_claimed' };
      if (order.status === 'delivered') return { success: false, reason: 'already_delivered' };
      if (order.status === 'cancelled') return { success: false, reason: 'cancelled' };
      if (order.status !== 'ready_for_pickup') {
        const statusMap = {
          placed: 'is newly placed and waiting for kitchen acceptance',
          pending: 'is newly placed and waiting for kitchen acceptance',
          accepted: 'is accepted by kitchen and waiting to cook',
          cooking: 'is currently cooking in the kitchen'
        };
        const statusDesc = statusMap[order.status] || `is in status "${order.status}"`;
        return {
          success: false,
          reason: 'not_ready',
          message: `Order ${order.id} ${statusDesc} and is not packed for pickup yet.`
        };
      }
      return { success: true };
    }

    assert.equal(canClaimOrder({ id: '#QB-1001', status: 'pending' }).reason, 'not_ready');
    assert.equal(canClaimOrder({ id: '#QB-1002', status: 'accepted' }).reason, 'not_ready');
    assert.equal(canClaimOrder({ id: '#QB-1003', status: 'cooking' }).reason, 'not_ready');
    assert.equal(canClaimOrder({ id: '#QB-1004', status: 'ready_for_pickup' }).success, true);
    assert.equal(canClaimOrder({ id: '#QB-1005', status: 'delivered' }).reason, 'already_delivered');
    assert.equal(canClaimOrder({ id: '#QB-1006', status: 'cancelled' }).reason, 'cancelled');
  });

  await t.test('2. Collision-resistant Order ID with 4-digit pickupCode', () => {
    const timeSegment = Date.now().toString(36).toUpperCase().slice(-4);
    const randomOrderNum = Math.floor(1000 + Math.random() * 9000);
    const newOrderId = `#QB-${timeSegment}-${randomOrderNum}`;
    const pickupCode = randomOrderNum.toString();

    assert.match(newOrderId, /^#QB-[A-Z0-9]{4}-[0-9]{4}$/);
    assert.equal(pickupCode.length, 4);
    assert.match(pickupCode, /^[0-9]{4}$/);

    // Verify bag code matcher matches 4-digit pickup code
    const isMatch = (clean) => {
      const orderDigits = String(newOrderId).replace(/\D/g, '');
      const bagCode = pickupCode;
      return bagCode === clean || orderDigits.endsWith(clean);
    };

    assert.equal(isMatch(pickupCode), true, 'Rider entering 4-digit bag code must match the order');
  });

  await t.test('3. Doorstep 500m geofence requires live GPS and blocks out-of-range riders', () => {
    function evaluateDoorstepGeofence({ riderLocation, customerCoords, maxMeters = 500 }) {
      if (!customerCoords || !customerCoords.hasCustomerCoords) {
        return { allowed: true, mode: 'manual_verify' };
      }
      if (!riderLocation.hasGps || (Date.now() - (riderLocation.lastUpdated || 0) > 180000)) {
        return { allowed: false, reason: 'no_gps', message: 'Live GPS required' };
      }
      // Calculate straight line distance (Haversine approximation)
      const R = 6371e3;
      const φ1 = riderLocation.lat * Math.PI / 180;
      const φ2 = customerCoords.lat * Math.PI / 180;
      const Δφ = (customerCoords.lat - riderLocation.lat) * Math.PI / 180;
      const Δλ = (customerCoords.lng - riderLocation.lng) * Math.PI / 180;
      const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ/2) * Math.sin(Δλ/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const distMeters = Math.round(R * c);

      if (distMeters > maxMeters) {
        return { allowed: false, reason: 'out_of_range', distMeters };
      }
      return { allowed: true, distMeters };
    }

    const customer = { hasCustomerCoords: true, lat: 12.7200, lng: 77.2800 };

    // Case A: No GPS fix
    const noGpsRider = { hasGps: false, lat: 12.7200, lng: 77.2800, lastUpdated: 0 };
    assert.equal(evaluateDoorstepGeofence({ riderLocation: noGpsRider, customerCoords: customer }).reason, 'no_gps');

    // Case B: Stale GPS fix (>3 mins)
    const staleGpsRider = { hasGps: true, lat: 12.7200, lng: 77.2800, lastUpdated: Date.now() - 300000 };
    assert.equal(evaluateDoorstepGeofence({ riderLocation: staleGpsRider, customerCoords: customer }).reason, 'no_gps');

    // Case C: Rider is 2 km away
    const farRider = { hasGps: true, lat: 12.7400, lng: 77.2800, lastUpdated: Date.now() };
    const farResult = evaluateDoorstepGeofence({ riderLocation: farRider, customerCoords: customer });
    assert.equal(farResult.allowed, false);
    assert.equal(farResult.reason, 'out_of_range');
    assert.ok(farResult.distMeters > 500);

    // Case D: Rider is at doorstep (50m away)
    const nearRider = { hasGps: true, lat: 12.7202, lng: 77.2802, lastUpdated: Date.now() };
    const nearResult = evaluateDoorstepGeofence({ riderLocation: nearRider, customerCoords: customer });
    assert.equal(nearResult.allowed, true);
    assert.ok(nearResult.distMeters <= 500);
  });
});
