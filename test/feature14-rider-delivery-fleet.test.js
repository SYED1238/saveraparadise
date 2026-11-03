import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const deliveryHtml = fs.readFileSync(path.join(rootDir, 'delivery.html'), 'utf8');
const deliveryJs = fs.readFileSync(path.join(rootDir, 'delivery.js'), 'utf8');
const dataServiceJs = fs.readFileSync(path.join(rootDir, 'dataService.js'), 'utf8');
const passcodeLockServiceJs = fs.readFileSync(path.join(rootDir, 'passcodeLockService.js'), 'utf8');

test('FEATURE #14: RIDER DELIVERY FLEET, 4-DIGIT BAG CLAIMING, GPS & PROOF OF DELIVERY SUITE', async (t) => {

  // =========================================================================
  // 1. Rider Authentication & Passcode Lock Rate-Limiting
  // =========================================================================
  await t.test('1. delivery.html eliminates default PIN hint from lock screen', () => {
    assert.doesNotMatch(deliveryHtml, /Default:\s*2233/, 'delivery.html must NOT expose (Default: 2233) on the lock screen');
    assert.match(deliveryHtml, /Enter your assigned 4-digit Rider PIN/, 'Lock screen should have clean instructions');
  });

  await t.test('2. passcodeLockService.js enforces brute-force rate-limiting and lockout delay', () => {
    assert.match(passcodeLockServiceJs, /let failedAttempts = 0;/, 'Must track failed attempts');
    assert.match(passcodeLockServiceJs, /let lockoutUntil = 0;/, 'Must track lockout timestamp');
    assert.match(passcodeLockServiceJs, /if \(failedAttempts >= 5\) \{\s*lockoutUntil = Date\.now\(\) \+ 30000;/, 'Must lock out for 30s after 5 failed attempts');
    assert.match(passcodeLockServiceJs, /if \(lockoutUntil > Date\.now\(\)\)/, 'enterDigit must block entry during active lockout');
  });

  await t.test('3. dataService.getActiveRider returns null when unauthenticated to prevent profile leaks', () => {
    assert.doesNotMatch(dataServiceJs, /return \(riders && riders\[0\]\) \|\| DEFAULT_RIDERS\[0\] \|\| null;/, 'getActiveRider must not fall back to default rider when unauthenticated');
    assert.match(deliveryJs, /function updateRiderProfileHeader\(\) \{\s*if \(!isStaffSessionActive\('rider'\)\)/, 'updateRiderProfileHeader must guard against unauthenticated rendering');
    assert.match(deliveryJs, /function renderPortal\(\) \{\s*if \(!isStaffSessionActive\('rider'\)\)/, 'renderPortal must guard against unauthenticated rendering');
  });

  // =========================================================================
  // 2. 4-Digit Bag Code Lookup & Atomic Claiming
  // =========================================================================
  await t.test('4. findOrderByBagCode excludes undelivered orders from shadowing new parcels', () => {
    assert.match(dataServiceJs, /o\.status !== 'delivered' && o\.status !== 'cancelled' && o\.status !== 'undelivered'/, 'findOrderByBagCode must exclude undelivered orders');
  });

  await t.test('5. claimOrderByBagCode guards Supabase update with status = ready_for_pickup', () => {
    assert.match(dataServiceJs, /\.update\(fullPayload\)\s*\.eq\('id', targetId\)\s*\.eq\('status', 'ready_for_pickup'\)/, 'claimOrderByBagCode must guard Supabase update against concurrent claims');
    assert.match(dataServiceJs, /order\._optimisticTimestamp = Date\.now\(\);/, 'claimOrderByBagCode must set _optimisticTimestamp');
  });

  await t.test('6. delivery.js dynamically derives known rider PINs from roster', () => {
    assert.match(deliveryJs, /const allRosterPins = \(dataService\.getRiders\(\) \|\| \[\]\)\.map\(r => r && r\.pin\)\.filter\(Boolean\);/, 'Must query roster pins dynamically');
    assert.match(deliveryJs, /const knownRiderPins = Array\.from\(new Set\(\[\.\.\.allRosterPins/, 'Must merge dynamic roster pins into knownRiderPins');
  });

  // =========================================================================
  // 3. Live Rider GPS Tracking, Watcher Cleanup & Jitter Throttle
  // =========================================================================
  await t.test('7. initRiderLiveGeolocation cleans up activeGpsWatchId before starting new watch', () => {
    assert.match(deliveryJs, /let activeGpsWatchId = null;/, 'Must declare activeGpsWatchId');
    assert.match(deliveryJs, /if \(activeGpsWatchId !== null && 'geolocation' in navigator\) \{\s*navigator\.geolocation\.clearWatch\(activeGpsWatchId\);/, 'Must clear existing watchId');
    assert.match(deliveryJs, /activeGpsWatchId = navigator\.geolocation\.watchPosition/, 'Must assign returned watchId to activeGpsWatchId');
  });

  await t.test('8. handleGpsPosition throttles micro-jitter broadcasts when stationary', () => {
    assert.match(deliveryJs, /if \(timeDelta < 3000 && distanceMoved < 5 && lastGpsBroadcastTime > 0\)/, 'handleGpsPosition must throttle stationary GPS broadcasts');
  });

  await t.test('9. visibilitychange and focus resume handlers refresh GPS location on tab return', () => {
    assert.match(deliveryJs, /document\.addEventListener\('visibilitychange', \(\) => \{\s*if \(!document\.hidden && isStaffSessionActive\('rider'\)\) \{\s*initRiderLiveGeolocation\(true\);/, 'Must refresh GPS upon returning from external maps');
    assert.match(deliveryJs, /window\.addEventListener\('focus', \(\) => \{\s*if \(isStaffSessionActive\('rider'\)\) \{\s*initRiderLiveGeolocation\(true\);/, 'Must refresh GPS upon window focus');
  });

  await t.test('10. dataService Realtime receiver persists per-order and per-rider location keys', () => {
    assert.match(dataServiceJs, /localStorage\.setItem\(`quickbite_rider_location_\$\{payload\.orderId\}`/, 'Realtime receiver must persist per-order location key');
    assert.match(dataServiceJs, /localStorage\.setItem\(`quickbite_rider_location_pin_\$\{payload\.riderPin\}`/, 'Realtime receiver must persist per-rider location key');
  });

  // =========================================================================
  // 4. Navigation Links & Phone/WhatsApp Extraction
  // =========================================================================
  await t.test('11. updateLivePositionsOnMiniMaps properly URI-encodes coordinates in navBtn.href', () => {
    assert.match(deliveryJs, /destination=\$\{encodeURIComponent\(dropLat\)\},\$\{encodeURIComponent\(dropLng\)\}/, 'Must encode destination coordinates');
  });

  await t.test('12. openUnreachableModal standardizes 10-digit phone extraction and WhatsApp format', () => {
    assert.match(deliveryJs, /const validTenDigits = cleanPhoneDigits\.length >= 10 \? cleanPhoneDigits\.slice\(-10\) : '';/, 'Must extract last 10 digits cleanly');
    assert.match(deliveryJs, /https:\/\/wa\.me\/\$\{waDigits\}\?text=\$\{encodeURIComponent\(urgentWaMsg\)\}/, 'Must format wa.me URL with clean 10-digit number');
  });

  // =========================================================================
  // 5. Proof of Delivery, Doorstep UPI & Return-to-Kitchen Protocol
  // =========================================================================
  await t.test('13. submitDeliveredOrder flags upiManualVerified when Doorstep UPI is confirmed', () => {
    assert.match(deliveryJs, /upiManualVerified: isDoorstepUpi,/, 'Must include upiManualVerified in delivered order metadata');
  });

  await t.test('14. btnCnrReturnPrepaid enforces 10-minute wait timer and updateCnrCountdown disables it', () => {
    assert.match(deliveryJs, /if \(startTime > 0 && elapsedSeconds < 600\) \{\s*const remaining = 600 - elapsedSeconds;/, 'btnCnrReturnPrepaid must enforce 600-second wait');
    assert.match(deliveryJs, /if \(btnCnrReturnPrepaid\) \{\s*btnCnrReturnPrepaid\.disabled = !isWaitComplete;/, 'updateCnrCountdown must toggle btnCnrReturnPrepaid');
  });

  await t.test('15. btnCnrSafedrop verifies GPS freshness within 3 minutes', () => {
    assert.match(deliveryJs, /btnCnrSafedrop\.addEventListener\('click'[\s\S]*?!riderLiveLocation\.hasGps \|\| \(Date\.now\(\) - \(riderLiveLocation\.lastUpdated \|\| 0\) > 180000\)/, 'btnCnrSafedrop must verify GPS signal freshness');
  });

  await t.test('16. updateOrderStatus clears [DOORSTEP_WAIT] message when order is delivered', () => {
    assert.match(dataServiceJs, /if \(order\.cancellationReason && order\.cancellationReason\.startsWith\('\[DOORSTEP_WAIT\]'\)\) \{\s*order\.cancellationReason = null;/, 'Must clear doorstep wait note on delivery');
    assert.match(dataServiceJs, /if \(order\.status === 'delivered'\) \{\s*fullPayload\.cancellation_reason = null;/, 'Must clear cancellation_reason in Supabase payload on delivery');
  });

  await t.test('17. syncOfflinePendingOrders drains payment_method, is_paid_online, doorstep_upi, and cash_collected', () => {
    assert.match(dataServiceJs, /if \(orderData\.paymentMethod\) fullPayload\.payment_method = orderData\.paymentMethod;/, 'Must drain payment_method');
    assert.match(dataServiceJs, /if \(typeof orderData\.isPaidOnline === 'boolean'\) fullPayload\.is_paid_online = orderData\.isPaidOnline;/, 'Must drain is_paid_online');
    assert.match(dataServiceJs, /if \(typeof orderData\.doorstepUpi === 'boolean'\) fullPayload\.doorstep_upi = orderData\.doorstepUpi;/, 'Must drain doorstep_upi');
    assert.match(dataServiceJs, /fullPayload\.cash_collected = typeof orderData\.cashCollected === 'number' \? orderData\.cashCollected : orderData\.cash_collected;/, 'Must drain cash_collected');
  });
});
