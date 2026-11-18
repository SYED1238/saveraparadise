import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('Task 5: Android APK Security, Background Alarms & CI Keystore', async (t) => {
  const mainActivity = fs.readFileSync(
    path.join(rootDir, 'android/app/src/main/java/com/sascrispy/portal/MainActivity.java'),
    'utf8'
  );
  const webAppInterface = fs.readFileSync(
    path.join(rootDir, 'android/app/src/main/java/com/sascrispy/portal/WebAppInterface.java'),
    'utf8'
  );
  const orderMonitorService = fs.readFileSync(
    path.join(rootDir, 'android/app/src/main/java/com/sascrispy/portal/OrderMonitorService.java'),
    'utf8'
  );
  const manifest = fs.readFileSync(
    path.join(rootDir, 'android/app/src/main/AndroidManifest.xml'),
    'utf8'
  );
  const buildGradle = fs.readFileSync(
    path.join(rootDir, 'android/app/build.gradle'),
    'utf8'
  );
  const buildApkWorkflow = fs.readFileSync(
    path.join(rootDir, '.github/workflows/build-apk.yml'),
    'utf8'
  );
  const deliveryJs = fs.readFileSync(path.join(rootDir, 'delivery.js'), 'utf8');
  const adminJs = fs.readFileSync(path.join(rootDir, 'admin.js'), 'utf8');
  const securityUtilsJs = fs.readFileSync(path.join(rootDir, 'securityUtils.js'), 'utf8');

  await t.test('1. MainActivity enforces strict trusted host allowlist and navigation boundary', () => {
    assert.match(mainActivity, /isTrustedPortalHost\s*\(\s*String\s+host\s*\)/);
    assert.match(mainActivity, /saveraparadise\.foodbliz\.in/);
    assert.match(mainActivity, /saveraparadise\.pages\.dev/);
    assert.match(mainActivity, /isTrustedHost\s*\(\s*String\s+host\s*\)/);
    assert.match(mainActivity, /cashfree\.com/);

    // shouldOverrideUrlLoading must disallow non-whitelisted URLs from loading in WebView
    assert.match(mainActivity, /if\s*\(\s*host\s*!=\s*null\s*&&\s*isTrustedHost\s*\(\s*host\s*\)\s*\)\s*\{\s*return\s+false;\s*\}/);
  });

  await t.test('2. MainActivity strictly gates Geolocation and Media permissions to trusted origins', () => {
    // onGeolocationPermissionsShowPrompt must check isTrustedPortalHost
    assert.match(
      mainActivity,
      /onGeolocationPermissionsShowPrompt[\s\S]*?isTrustedPortalHost[\s\S]*?callback\.invoke\(origin,\s*true,\s*false\)[\s\S]*?callback\.invoke\(origin,\s*false,\s*false\)/
    );

    // onPermissionRequest must check isTrustedPortalHost
    assert.match(
      mainActivity,
      /onPermissionRequest[\s\S]*?isTrustedPortalHost[\s\S]*?request\.grant[\s\S]*?request\.deny/
    );
  });

  await t.test('3. WebAppInterface verifies caller origin before executing sensitive native operations', () => {
    assert.match(webAppInterface, /isCurrentOriginTrusted\s*\(\)/);
    assert.match(webAppInterface, /MainActivity\.isTrustedPortalHost/);

    // Verify sensitive methods check origin
    assert.match(webAppInterface, /public\s+void\s+showNotification[\s\S]*?if\s*\(!isCurrentOriginTrusted\(\)\)\s*return;/);
    assert.match(webAppInterface, /public\s+void\s+startAlarm[\s\S]*?if\s*\(!isCurrentOriginTrusted\(\)\)\s*return;/);
    assert.match(webAppInterface, /public\s+void\s+stopAlarm[\s\S]*?if\s*\(!isCurrentOriginTrusted\(\)\)\s*return;/);
    assert.match(webAppInterface, /public\s+void\s+setDutyStatus[\s\S]*?if\s*\(!isCurrentOriginTrusted\(\)\)\s*return;/);
    assert.match(webAppInterface, /public\s+void\s+setKitchenAlarmMode[\s\S]*?if\s*\(!isCurrentOriginTrusted\(\)\)\s*return;/);
    assert.match(webAppInterface, /public\s+void\s+acknowledgeOrderAlarm[\s\S]*?if\s*\(!isCurrentOriginTrusted\(\)\)\s*return;/);
    assert.match(webAppInterface, /public\s+void\s+clearAcknowledgedAlarms[\s\S]*?if\s*\(!isCurrentOriginTrusted\(\)\)\s*return;/);
  });

  await t.test('4. AndroidManifest declares SCHEDULE_EXACT_ALARM permission', () => {
    assert.match(
      manifest,
      /<uses-permission\s+android:name="android\.permission\.SCHEDULE_EXACT_ALARM"\s*\/>/
    );
  });

  await t.test('5. OrderMonitorService safely schedules swipe-away restart on Android 12+ (SDK 34)', () => {
    assert.match(
      orderMonitorService,
      /Build\.VERSION\.SDK_INT\s*>=\s*Build\.VERSION_CODES\.S[\s\S]*?alarmService\.canScheduleExactAlarms\(\)[\s\S]*?setExactAndAllowWhileIdle[\s\S]*?setAndAllowWhileIdle/
    );
  });

  await t.test('6. OrderMonitorService sets USAGE_ALARM before prepare() and start() on MediaPlayer', () => {
    // Must instantiate new MediaPlayer, setAudioAttributes USAGE_ALARM, then prepare & start
    assert.match(
      orderMonitorService,
      /new\s+MediaPlayer\(\)[\s\S]*?setAudioAttributes[\s\S]*?USAGE_ALARM[\s\S]*?prepare\(\)[\s\S]*?start\(\)/
    );
  });

  await t.test('7. OrderMonitorService attaches X-Kitchen-Poll-Key auth header to kitchen_poll requests', () => {
    assert.match(
      orderMonitorService,
      /setRequestProperty\s*\(\s*"X-Kitchen-Poll-Key",\s*pollSecret\.trim\(\)\s*\)/
    );
  });

  await t.test('8. CI Keystore workflow decodes base64 secret and build.gradle reads from environment', () => {
    assert.match(buildApkWorkflow, /ANDROID_KEYSTORE_BASE64/);
    assert.match(buildApkWorkflow, /base64\s+--decode\s+>\s+release\.jks/);
    assert.match(buildApkWorkflow, /ANDROID_KEYSTORE_PASSWORD/);
    assert.match(buildApkWorkflow, /ANDROID_KEY_ALIAS/);
    assert.match(buildApkWorkflow, /ANDROID_KEY_PASSWORD/);

    assert.match(buildGradle, /System\.getenv\("ANDROID_KEYSTORE_PASSWORD"\)/);
    assert.match(buildGradle, /System\.getenv\("ANDROID_KEY_ALIAS"\)/);
    assert.match(buildGradle, /System\.getenv\("ANDROID_KEY_PASSWORD"\)/);
  });

  await t.test('9. MainActivity thread safety: lastKnownUrl cached on UI thread and returned by getCurrentUrl', () => {
    assert.match(mainActivity, /private\s+volatile\s+String\s+lastKnownUrl\s*=\s*["']["'];/);
    assert.match(mainActivity, /public\s+String\s+getCurrentUrl\(\)\s*\{[\s\S]*?return\s+lastKnownUrl;[\s\S]*?\}/);
    assert.doesNotMatch(mainActivity, /public\s+String\s+getCurrentUrl\(\)\s*\{[\s\S]*?webView\.getUrl\(\)/);
    assert.match(mainActivity, /onPageStarted[\s\S]*?lastKnownUrl\s*=\s*url;/);
    assert.match(mainActivity, /onPageFinished[\s\S]*?lastKnownUrl\s*=\s*url;/);
    assert.match(mainActivity, /doUpdateVisitedHistory[\s\S]*?lastKnownUrl\s*=\s*url;/);
    assert.match(webAppInterface, /private\s+boolean\s+isCurrentOriginTrusted\(\)\s*\{[\s\S]*?try\s*\{[\s\S]*?catch\s*\(Throwable/);
  });

  await t.test('10. WebAppInterface exposes setStaffAuthToken and setKitchenPollSecret to sync credentials to savera_kitchen_prefs', () => {
    assert.match(webAppInterface, /@JavascriptInterface\s+public\s+void\s+setStaffAuthToken\s*\(\s*String\s+token\s*\)/);
    assert.match(webAppInterface, /prefs\.edit\(\)\.putString\(\s*"active_staff_token",\s*token\.trim\(\)\s*\)\.apply\(\)/);
    assert.match(webAppInterface, /@JavascriptInterface\s+public\s+void\s+setKitchenPollSecret\s*\(\s*String\s+secret\s*\)/);
    assert.match(webAppInterface, /prefs\.edit\(\)\.putString\(\s*"kitchen_poll_secret",\s*secret\.trim\(\)\s*\)\.apply\(\)/);
  });

  await t.test('11. Portals (delivery.js, admin.js, securityUtils.js) sync active staff token to Android native bridge', () => {
    assert.match(securityUtilsJs, /window\.AndroidNative\.setStaffAuthToken\(data\.token\)/);
    assert.match(securityUtilsJs, /window\.AndroidNative\.setStaffAuthToken\(['"]['"]\)/);
    assert.match(deliveryJs, /window\.AndroidNative\.setStaffAuthToken\(token\)/);
    assert.match(adminJs, /window\.AndroidNative\.setStaffAuthToken\(tok\)/);
    assert.match(adminJs, /window\.AndroidNative\.setStaffAuthToken\(validToken\)/);
  });
});
