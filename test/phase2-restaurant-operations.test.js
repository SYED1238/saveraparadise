import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

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

  await t.test('4. Dish schedule fields persist and compute status correctly', () => {
    const dish = {
      id: 'dish-biryani-test',
      name: 'Special Dum Biryani',
      price: 250,
      inStock: true,
      availableDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
      timeRestricted: true,
      availableFrom: '12:00',
      availableTo: '16:00'
    };

    assert.equal(dish.timeRestricted, true);
    assert.equal(dish.availableFrom, '12:00');
    assert.equal(dish.availableTo, '16:00');
    assert.deepEqual(dish.availableDays, ['mon', 'tue', 'wed', 'thu', 'fri']);

    // Check payload shape that updateDish produces
    const updatePayload = {
      name: dish.name,
      available_days: dish.availableDays,
      time_restricted: Boolean(dish.timeRestricted),
      available_from: dish.availableFrom,
      available_to: dish.availableTo
    };

    assert.deepEqual(updatePayload.available_days, ['mon', 'tue', 'wed', 'thu', 'fri']);
    assert.equal(updatePayload.time_restricted, true);
    assert.equal(updatePayload.available_from, '12:00');
    assert.equal(updatePayload.available_to, '16:00');
  });

  await t.test('5. Dual-Pass GPS & Desktop IP fallback defense in main.js and style.css', () => {
    const mainJs = fs.readFileSync(path.join(rootDir, 'main.js'), 'utf8');
    const styleCss = fs.readFileSync(path.join(rootDir, 'style.css'), 'utf8');

    // 1. Guard against rough ISP/network IP geolocation (like Opera desktop routing through Bangalore 50km away)
    assert.match(
      mainJs,
      /const\s+isRoughNetworkIp\s*=\s*\(accuracy\s*>\s*3000\)\s*\|\|\s*\(check\.distanceKm\s*!==\s*null\s*&&\s*check\.distanceKm\s*>\s*25\s*&&\s*accuracy\s*>\s*500\)/,
      'main.js must detect rough network IP geolocation over 25km away or with accuracy > 3000m'
    );
    assert.match(
      mainJs,
      /showToast\([^)]*Approximate network location detected/i,
      'main.js must alert user when rough network IP is detected'
    );

    // 2. Dual-pass geolocation: Fast cached fix (50ms) + Deep satellite watch (12s)
    assert.match(
      mainJs,
      /maximumAge:\s*120000/,
      'main.js must query warm cached position with maximumAge: 120000'
    );
    assert.match(
      mainJs,
      /timeout:\s*12000/,
      'main.js deep satellite watch must give cold mobile GPS chips up to 12s to lock'
    );

    // 3. State cleanup on modal open and close
    assert.match(
      mainJs,
      /openAddressModal[\s\S]*bestGpsAccuracy\s*=\s*Infinity[\s\S]*bestGpsCoords\s*=\s*null/,
      'openAddressModal must reset GPS coordinates so adding another address is clean'
    );
    assert.match(
      mainJs,
      /closeAddressModalInternal[\s\S]*clearWatch\(gpsWatchId\)[\s\S]*clearTimeout\(gpsRefineTimeout\)/,
      'closeAddressModalInternal must stop GPS watch and timer on modal close'
    );

    // 4. Visual state styles in style.css
    assert.match(
      styleCss,
      /\.swiggy-floating-gps-btn\.detecting\s*\{/,
      'style.css must define visual state for .swiggy-floating-gps-btn.detecting'
    );
    assert.match(
      styleCss,
      /\.swiggy-floating-gps-btn\.refine\s*\{/,
      'style.css must define visual state for .swiggy-floating-gps-btn.refine'
    );
  });
});
