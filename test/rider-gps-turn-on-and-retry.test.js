import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const deliveryJs = fs.readFileSync(path.join(rootDir, 'delivery.js'), 'utf8');
const buildGradle = fs.readFileSync(path.join(rootDir, 'android', 'app', 'build.gradle'), 'utf8');
const mainActivityJava = fs.readFileSync(
  path.join(rootDir, 'android', 'app', 'src', 'main', 'java', 'com', 'sascrispy', 'portal', 'MainActivity.java'),
  'utf8'
);
const webAppInterfaceJava = fs.readFileSync(
  path.join(rootDir, 'android', 'app', 'src', 'main', 'java', 'com', 'sascrispy', 'portal', 'WebAppInterface.java'),
  'utf8'
);

test('RIDER LIVE GPS TURN-ON PROMPT, ERROR CLASSIFICATION & AUTO-RETRY SUITE', async (t) => {
  await t.test('1. delivery.js classifies GPS off (code 2/3) separately from permission_denied (code 1)', () => {
    assert.match(deliveryJs, /async function classifyGeolocationFailure\(err\)/, 'Must define classifyGeolocationFailure');
    assert.match(deliveryJs, /if \(code === 2 \|\| code === 3\) \{\s*return 'gps_off';\s*\}/, 'Code 2 and 3 must map to gps_off');
    assert.match(deliveryJs, /navigator\.permissions\.query\(\{ name: 'geolocation' \}\)/, 'Must query Permissions API before blaming permission_denied');
  });

  await t.test('2. requestLiveGpsSyncForPickup uses maximumAge: 0 and prompts to turn on GPS instead of unconditional Permission Blocked', () => {
    assert.match(deliveryJs, /function requestLiveGpsSyncForPickup\(onSynced, options = \{\}\)/, 'requestLiveGpsSyncForPickup must support options');
    assert.match(deliveryJs, /maximumAge:\s*0/, 'Explicit GPS sync tap must use maximumAge: 0 to force OS location prompt');
    assert.match(deliveryJs, /Device GPS is OFF: Please turn on Location/, 'Must toast clear Device GPS is OFF message when location switch is off');
    assert.match(deliveryJs, /Turn On Device GPS/, 'Pickup GPS gate button must prompt to Turn On Device GPS when GPS is off');
  });

  await t.test('3. Auto-retry loop polls every 3s while GPS is off and stops automatically once GPS locks', () => {
    assert.match(deliveryJs, /function startGpsAutoRetryLoop\(\)/, 'Must define startGpsAutoRetryLoop');
    assert.match(deliveryJs, /function stopGpsAutoRetryLoop\(\)/, 'Must define stopGpsAutoRetryLoop');
    assert.match(deliveryJs, /window\.__onNativeGpsEnabled = \(\) =>/, 'Must register window.__onNativeGpsEnabled callback for native APK resolution');
  });

  await t.test('4. Top #rider-gps-pill click triggers requestLiveGpsSyncForPickup when GPS is not yet synced', () => {
    assert.match(
      deliveryJs,
      /riderGpsPill\.onclick = \(\) => \{\s*if \(riderLiveLocation\.hasGps && isRiderGpsSyncedAndFresh\(\)\)/,
      'riderGpsPill click must verify hasGps before showing coordinates toast'
    );
  });

  await t.test('5. Android native wrapper wires Google Play Services LocationSettingsRequest & JS bridge', () => {
    assert.match(buildGradle, /com\.google\.android\.gms:play-services-location:21\.2\.0/, 'build.gradle must include play-services-location');
    assert.match(mainActivityJava, /LocationSettingsRequest/, 'MainActivity must build LocationSettingsRequest');
    assert.match(mainActivityJava, /startResolutionForResult\(MainActivity\.this, GPS_ENABLE_REQUEST_CODE\)/, 'MainActivity must launch system resolution dialog for GPS');
    assert.match(mainActivityJava, /window\.__onNativeGpsEnabled/, 'MainActivity must notify WebView when GPS is enabled');
    assert.match(webAppInterfaceJava, /public void requestEnableGps\(\)/, 'WebAppInterface must expose requestEnableGps()');
    assert.match(webAppInterfaceJava, /public boolean isLocationEnabled\(\)/, 'WebAppInterface must expose isLocationEnabled()');
    assert.match(webAppInterfaceJava, /public boolean hasLocationPermission\(\)/, 'WebAppInterface must expose hasLocationPermission()');
  });
});
