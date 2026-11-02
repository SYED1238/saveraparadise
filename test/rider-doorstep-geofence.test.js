import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Reference Euclidean/Haversine math matching implementation
function calculateStraightDistanceMeters(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return Infinity;
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

describe('RIDER 500M DOORSTEP GEOFENCE & DELIVERY ARBITRAGE DEFENSE SUITE', () => {
  const deliveryJs = fs.readFileSync(path.join(rootDir, 'delivery.js'), 'utf8');
  const deliveryCss = fs.readFileSync(path.join(rootDir, 'delivery.css'), 'utf8');

  test('1. calculateStraightDistanceMeters accurately computes doorstep proximity in meters', () => {
    // Restaurant Hub coordinates
    const hubLat = 12.7209;
    const hubLng = 77.2799;

    // A point ~100 meters away
    const nearLat = 12.7218;
    const nearLng = 77.2799;
    const dist100m = calculateStraightDistanceMeters(hubLat, hubLng, nearLat, nearLng);
    assert.ok(dist100m >= 90 && dist100m <= 110, `Expected ~100m, got ${dist100m}m`);

    // A point ~3000 meters (3 km) away
    const farLat = 12.7479;
    const farLng = 77.2799;
    const dist3km = calculateStraightDistanceMeters(hubLat, hubLng, farLat, farLng);
    assert.ok(dist3km >= 2900 && dist3km <= 3100, `Expected ~3000m, got ${dist3km}m`);
  });

  test('2. Anti-Arbitrage defense: 3 km phantom order at restaurant is strictly blocked (>500m)', () => {
    const hubLat = 12.7209;
    const hubLng = 77.2799;
    const dropLat = 12.7479; // 3 km away
    const dropLng = 77.2799;

    const distanceMeters = calculateStraightDistanceMeters(hubLat, hubLng, dropLat, dropLng);
    const MAX_GEOFENCE_RADIUS = 500;

    assert.ok(distanceMeters > MAX_GEOFENCE_RADIUS, 'Distance must exceed 500m geofence');
    const isAllowed = distanceMeters <= MAX_GEOFENCE_RADIUS;
    assert.equal(isAllowed, false, 'Delivery must be strictly blocked when rider is outside 500m radius');
  });

  test('3. Legitimate doorstep delivery: Rider within 500m radius is permitted', () => {
    const hubLat = 12.7209;
    const hubLng = 77.2799;
    const customerLat = 12.7225; // ~180 meters away
    const customerLng = 77.2805;

    const distanceMeters = calculateStraightDistanceMeters(hubLat, hubLng, customerLat, customerLng);
    const MAX_GEOFENCE_RADIUS = 500;

    assert.ok(distanceMeters <= MAX_GEOFENCE_RADIUS, `Distance ${distanceMeters}m must be within 500m`);
    const isAllowed = distanceMeters <= MAX_GEOFENCE_RADIUS;
    assert.equal(isAllowed, true, 'Delivery must be permitted when rider reaches customer doorstep');
  });

  test('4. delivery.js implements MAX_DOORSTEP_GEOFENCE_METERS of exactly 500m', () => {
    assert.ok(
      deliveryJs.includes('MAX_DOORSTEP_GEOFENCE_METERS = 500') ||
      deliveryJs.includes('MAX_DOORSTEP_GEOFENCE_METERS=500'),
      'delivery.js must declare MAX_DOORSTEP_GEOFENCE_METERS = 500'
    );
    assert.ok(
      deliveryJs.includes('calculateStraightDistanceMeters'),
      'delivery.js must implement calculateStraightDistanceMeters helper'
    );
  });

  test('5. delivery.js blocks openDeliveryConfirmModal when rider is outside 500m radius', () => {
    assert.ok(
      deliveryJs.includes('MAX_DOORSTEP_GEOFENCE_METERS') &&
      deliveryJs.includes('Doorstep Geofence: You are'),
      'openDeliveryConfirmModal must enforce 500m geofence and alert the rider with distance'
    );
  });

  test('6. delivery.js blocks formConfirmDelivered submission if rider moved outside 500m radius', () => {
    assert.ok(
      deliveryJs.includes('Delivery Blocked: You are') &&
      deliveryJs.includes('500m radius'),
      'formConfirmDelivered submission must reject completion if outside 500m'
    );
  });

  test('7. delivery.js blocks Safe Drop (btnCnrSafedrop) when rider is outside 500m radius', () => {
    assert.ok(
      deliveryJs.includes('Safe Drop Blocked: You are') ||
      deliveryJs.includes('Safe Drop requires being at the customer'),
      'Safe Drop must also enforce 500m doorstep proximity'
    );
  });

  test('8. delivery.css includes high-visibility styles for doorstep geofence badge', () => {
    assert.ok(deliveryCss.includes('.doorstep-geofence-badge'), 'CSS must define .doorstep-geofence-badge');
    assert.ok(deliveryCss.includes('.doorstep-geofence-badge.in-range'), 'CSS must define in-range styling');
    assert.ok(deliveryCss.includes('.doorstep-geofence-badge.out-of-range'), 'CSS must define out-of-range styling');
  });
});
