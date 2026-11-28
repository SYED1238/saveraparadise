import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

function setupStorageMocks() {
  const store = new Map();
  const sessStore = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(String(k)) ?? null,
    setItem: (k, v) => store.set(String(k), String(v)),
    removeItem: (k) => store.delete(String(k)),
    clear: () => store.clear()
  };
  globalThis.sessionStorage = {
    getItem: (k) => sessStore.get(String(k)) ?? null,
    setItem: (k, v) => sessStore.set(String(k), String(v)),
    removeItem: (k) => sessStore.delete(String(k)),
    clear: () => sessStore.clear()
  };
}

test('Rider Off-Duty / On-Break Complete Silence & Battery/Log Preservation', async (t) => {
  await t.test('1. DataService.isRiderOnBreakIdle respects portal isolation and active assigned orders', async () => {
    setupStorageMocks();
    const { dataService } = await import('../dataService.js');
    const origPortal = dataService.portalType;
    const origGetOrders = dataService.getOrders.bind(dataService);

    try {
      dataService.saveRiders([
        { id: 'rider-2233', pin: '2233', name: 'Zaid Khan', status: 'offline' }
      ]);
      dataService.setActiveRiderPin('2233');
      globalThis.localStorage.setItem('quickbite_rider_duty_on', 'false');

      // Other portals must NEVER enter rider break-silence mode
      for (const portal of ['admin', 'owner', 'customer']) {
        dataService.portalType = portal;
        dataService.getOrders = () => [];
        assert.equal(
          dataService.isRiderOnBreakIdle(),
          false,
          `Portal ${portal} must never return true for isRiderOnBreakIdle`
        );
      }

      dataService.portalType = 'delivery';

      // Delivered / cancelled / other rider orders -> still idle on break
      dataService.getOrders = () => [
        { id: '#ORD-1', status: 'delivered', assigned_rider_pin: '2233' },
        { id: '#ORD-2', status: 'on_the_way', assigned_rider_pin: '9999' },
        { id: '#ORD-3', status: 'ready_for_pickup', assigned_rider_pin: '' }
      ];
      assert.equal(
        dataService.isRiderOnBreakIdle(),
        true,
        'Delivery rider On Break with 0 own active assigned orders must be break-idle'
      );

      // Own active assigned order in flight -> must NOT drop sync/GPS mid-delivery
      for (const activeStatus of ['accepted', 'cooking', 'ready_for_pickup', 'on_the_way']) {
        dataService.getOrders = () => [
          { id: '#ORD-ACTIVE', status: activeStatus, assigned_rider_pin: '2233' }
        ];
        assert.equal(
          dataService.isRiderOnBreakIdle(),
          false,
          `Delivery rider holding an active order (${activeStatus}) must keep sync alive`
        );
      }

      // Online rider with 0 orders -> NOT break-idle
      dataService.getOrders = () => [];
      globalThis.localStorage.setItem('quickbite_rider_duty_on', 'true');
      assert.equal(dataService.isRiderOnBreakIdle(), false);
    } finally {
      dataService.portalType = origPortal;
      dataService.getOrders = origGetOrders;
    }
  });

  await t.test('2. setupRealtime, startLiveHeartbeat, initSupabase, and setRiderDutyStatus silence and restore cleanly', async () => {
    setupStorageMocks();
    const { dataService } = await import('../dataService.js');

    const origPortal = dataService.portalType;
    const origSetInterval = globalThis.setInterval;
    const origClearInterval = globalThis.clearInterval;
    const origIsStaffAuthorized = dataService.isStaffAuthorized;
    const origSyncAll = dataService.syncAllFromSupabase;
    const origSyncOrders = dataService.syncOrdersFromSupabase;
    const origSyncSettings = dataService.syncSettingsFromSupabase;
    const origSyncRiders = dataService.syncRidersFromSupabase;
    const origSetupRealtime = dataService.setupRealtime;
    const origEnsureBroadcast = dataService._ensureBroadcastSubscribedAndSend;
    const origFetch = globalThis.fetch;
    const origWindow = globalThis.window;

    let heartbeatFn = null;
    let syncAllCalls = 0;
    let syncOrdersCalls = 0;
    let syncSettingsCalls = 0;
    let syncRidersCalls = 0;
    let setupRealtimeCalls = 0;
    const broadcastCalls = [];

    try {
      globalThis.window = new EventTarget();
      globalThis.setInterval = (fn) => {
        heartbeatFn = fn;
        return { unref() {} };
      };
      globalThis.clearInterval = () => {};

      dataService.portalType = 'delivery';
      dataService.isStaffAuthorized = () => true;
      dataService.saveRiders([
        { id: 'rider-2233', pin: '2233', name: 'Zaid Khan', status: 'online' }
      ]);
      dataService.setActiveRiderPin('2233');
      globalThis.sessionStorage.setItem('quickbite_rider_token', 'rider-tok-2233');

      dataService.syncAllFromSupabase = async () => { syncAllCalls++; };
      dataService.syncOrdersFromSupabase = async () => { syncOrdersCalls++; return []; };
      dataService.syncSettingsFromSupabase = async () => { syncSettingsCalls++; return {}; };
      dataService.syncRidersFromSupabase = async () => { syncRidersCalls++; return []; };
      dataService._ensureBroadcastSubscribedAndSend = async (event, payload) => {
        broadcastCalls.push({ event, payload });
      };

      // Put rider On Break with 0 active orders
      globalThis.localStorage.setItem('quickbite_rider_duty_on', 'false');
      dataService.saveOrders([]);

      // Attach dummy channels to prove teardown removes them
      let unsubscribeCount = 0;
      dataService.realtimeChannel = { state: 'joined', unsubscribe: () => { unsubscribeCount++; } };
      dataService.sharedBroadcastChannel = { state: 'joined', unsubscribe: () => { unsubscribeCount++; } };

      // A. setupRealtime() must refuse and teardown while On Break
      origSetupRealtime.call(dataService);
      assert.equal(dataService.realtimeChannel, null, 'setupRealtime must teardown realtimeChannel on break');
      assert.equal(dataService.sharedBroadcastChannel, null, 'setupRealtime must teardown sharedBroadcastChannel on break');
      assert.ok(unsubscribeCount >= 2, 'teardownRealtime must clean up open channels');

      // B. initSupabase() must skip boot DB & Realtime sync while On Break
      await dataService.initSupabase();
      assert.equal(syncAllCalls, 0, 'initSupabase must skip syncAllFromSupabase while On Break');

      // C. startLiveHeartbeat() must make ZERO DB calls while On Break
      dataService.realtimeChannel = { state: 'joined', unsubscribe: () => {} };
      dataService.startLiveHeartbeat();
      assert.ok(typeof heartbeatFn === 'function');
      await heartbeatFn();
      assert.equal(syncOrdersCalls, 0, 'Heartbeat must skip syncOrdersFromSupabase while On Break');
      assert.equal(syncSettingsCalls, 0, 'Heartbeat must skip syncSettingsFromSupabase while On Break');
      assert.equal(syncRidersCalls, 0, 'Heartbeat must skip syncRidersFromSupabase while On Break');
      assert.equal(dataService.realtimeChannel, null, 'Heartbeat must clear any dangling channel while On Break');

      // D. setRiderDutyStatus(pin, false) sends broadcast to Admin then tears down all channels
      globalThis.localStorage.setItem('quickbite_rider_duty_on', 'true');
      dataService.realtimeChannel = { state: 'joined', unsubscribe: async () => 'ok' };
      dataService.sharedBroadcastChannel = { state: 'joined', unsubscribe: async () => 'ok' };
      globalThis.fetch = async (_url, opts) => {
        const body = JSON.parse(opts.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, status: body.status, rider: { id: 'rider-2233', pin: '2233', status: body.status } })
        };
      };

      const offRes = await dataService.setRiderDutyStatus('2233', false);
      assert.equal(offRes.success, true);
      assert.equal(broadcastCalls.length, 1);
      assert.equal(broadcastCalls[0].event, 'rider_duty_updated');
      assert.equal(dataService.realtimeChannel, null, 'Switching On Break must close realtimeChannel');
      assert.equal(dataService.sharedBroadcastChannel, null, 'Switching On Break must close sharedBroadcastChannel');

      // E. Switching back On Duty calls resumeRiderDutySync -> re-opens Realtime + immediately syncs missed orders
      dataService.setupRealtime = () => {
        setupRealtimeCalls++;
        dataService.realtimeChannel = { state: 'joined', unsubscribe: async () => 'ok' };
        dataService.sharedBroadcastChannel = { state: 'joined', unsubscribe: async () => 'ok' };
      };
      const onRes = await dataService.setRiderDutyStatus('2233', true);
      assert.equal(onRes.success, true);
      assert.equal(globalThis.localStorage.getItem('quickbite_rider_duty_on'), 'true');
      assert.equal(setupRealtimeCalls, 1, 'Resuming On Duty must restore Supabase Realtime');
      assert.equal(syncOrdersCalls, 1, 'Resuming On Duty must immediately sync orders');
      assert.equal(syncSettingsCalls, 1, 'Resuming On Duty must immediately sync settings');
      assert.equal(syncRidersCalls, 1, 'Resuming On Duty must immediately sync riders');
    } finally {
      dataService.portalType = origPortal;
      globalThis.setInterval = origSetInterval;
      globalThis.clearInterval = origClearInterval;
      dataService.isStaffAuthorized = origIsStaffAuthorized;
      dataService.syncAllFromSupabase = origSyncAll;
      dataService.syncOrdersFromSupabase = origSyncOrders;
      dataService.syncSettingsFromSupabase = origSyncSettings;
      dataService.syncRidersFromSupabase = origSyncRiders;
      dataService.setupRealtime = origSetupRealtime;
      dataService._ensureBroadcastSubscribedAndSend = origEnsureBroadcast;
      globalThis.fetch = origFetch;
      globalThis.window = origWindow;
      dataService.teardownRealtime();
    }
  });

  await t.test('3. delivery.js pauses GPS watch, retry loop, WakeLock, visibility/focus polling and guards TDZ on break', () => {
    const deliveryJs = fs.readFileSync(path.join(ROOT, 'delivery.js'), 'utf8');

    // TDZ safety: all referenced identifiers inside pauseRiderBreakActivity must be declared BEFORE applyRiderDutyUI(isDutyOn)
    const alarmDeclIdx = deliveryJs.indexOf('let isRiderAlarmRinging = false;');
    const fullGpsDeclIdx = deliveryJs.indexOf('const fullProfileGps =');
    const firstApplyIdx = deliveryJs.indexOf('applyRiderDutyUI(isDutyOn);');
    assert.ok(alarmDeclIdx !== -1 && alarmDeclIdx < firstApplyIdx);
    assert.ok(fullGpsDeclIdx !== -1 && fullGpsDeclIdx < firstApplyIdx);

    // Pause / resume lifecycle helpers exist and clean up hardware resources
    assert.match(deliveryJs, /function isRiderBreakSilenceActive\(\)/);
    assert.match(deliveryJs, /function pauseRiderBreakActivity\(\)[\s\S]*stopGpsAutoRetryLoop\(\);[\s\S]*clearWatch\(activeGpsWatchId\);[\s\S]*releaseWakeLock\(\);[\s\S]*teardownRealtime\(\)/);
    assert.match(deliveryJs, /function resumeRiderDutyActivity\(\)[\s\S]*requestWakeLock\(\);[\s\S]*initRiderLiveGeolocation\(true\);[\s\S]*resumeRiderDutySync\(\)/);

    // Visibility / focus / native GPS / retry loop / gate UI / renderPortal all guard break silence
    assert.match(deliveryJs, /document\.addEventListener\('visibilitychange',[\s\S]*if\s*\(isRiderBreakSilenceActive\(\)\)\s*return;/);
    assert.match(deliveryJs, /window\.addEventListener\('focus',[\s\S]*if\s*\(isRiderBreakSilenceActive\(\)\)\s*return;/);
    assert.match(deliveryJs, /window\.__onNativeGpsEnabled\s*=\s*\(\)\s*=>\s*\{\s*if\s*\(isRiderBreakSilenceActive\(\)\)/);
    assert.match(deliveryJs, /function startGpsAutoRetryLoop\(\)\s*\{\s*if\s*\(isRiderBreakSilenceActive\(\)\)/);
    assert.match(deliveryJs, /function initRiderLiveGeolocation\(forceRetry = false\)\s*\{\s*if\s*\(isRiderBreakSilenceActive\(\)\)/);
    assert.match(deliveryJs, /function updatePickupGpsGateUI\(\)[\s\S]*if\s*\(isRiderBreakSilenceActive\(\)\)/);
    assert.match(deliveryJs, /function renderPortal\(\)[\s\S]*if\s*\(isRiderBreakSilenceActive\(\)\)\s*\{\s*pauseRiderBreakActivity\(\)/);
  });

  await t.test('4. Android native Java components strictly stop Rider polling & foreground notification on break without disturbing Kitchen/Owner', () => {
    const javaDir = path.join(ROOT, 'android/app/src/main/java/com/sascrispy/portal');
    const serviceJava = fs.readFileSync(path.join(javaDir, 'OrderMonitorService.java'), 'utf8');
    const receiverJava = fs.readFileSync(path.join(javaDir, 'OrderMonitorReceiver.java'), 'utf8');
    const bridgeJava = fs.readFileSync(path.join(javaDir, 'WebAppInterface.java'), 'utf8');
    const mainJava = fs.readFileSync(path.join(javaDir, 'MainActivity.java'), 'utf8');

    // Service lifecycle controls + watchdog cancellation
    assert.match(serviceJava, /public static void cancelKeepAliveWatchdogs\(Context ctx\)/);
    assert.match(serviceJava, /int\[\]\s*requestCodes\s*=\s*new int\[\]\s*\{\s*1002,\s*1003\s*\}/);
    assert.match(serviceJava, /public static void syncDutyServiceLifecycle\(Context ctx,\s*boolean onDuty\)/);
    assert.match(serviceJava, /if\s*\(!pkg\.contains\("rider"\)\)\s*\{\s*return;\s*\}/, 'Kitchen and Owner APKs must never be stopped by Rider duty helper');

    // Android O+ ForegroundServiceDidNotStartInTimeException safety in onCreate()
    assert.match(
      serviceJava,
      /startForegroundNotification\(\);\s*if\s*\(isRiderApp && !isRiderOnDuty\(this\)\)[\s\S]*stopServiceAndDismissForeground\(\);\s*return;/
    );

    // Every polling & restart entry point checks isRiderApp && !isRiderOnDuty(this)
    assert.match(serviceJava, /private void startPolling\(\)\s*\{\s*if\s*\(isRiderApp && !isRiderOnDuty\(this\)\)/);
    assert.match(serviceJava, /while\s*\(isRunning\)\s*\{\s*if\s*\(isRiderApp && !isRiderOnDuty\(this\)\)/);
    assert.match(serviceJava, /private void pollKitchenOrders\(\)\s*\{\s*if\s*\(isRiderApp && !isRiderOnDuty\(this\)\)/);
    assert.match(serviceJava, /private void scheduleKeepAliveWatchdog\(\)\s*\{\s*if\s*\(isRiderApp && !isRiderOnDuty\(this\)\)/);
    assert.match(serviceJava, /public void onTaskRemoved\(Intent rootIntent\)\s*\{\s*if\s*\(isRiderApp && !isRiderOnDuty\(this\)\)/);

    // Bridge, Receiver, Activity gates
    assert.match(bridgeJava, /OrderMonitorService\.syncDutyServiceLifecycle\(context,\s*onDuty\);/);
    assert.match(bridgeJava, /setRestaurantBaseUrl[\s\S]*pkg\.contains\("rider"\)\s*&&\s*!OrderMonitorService\.isRiderOnDuty\(context\)/);
    assert.match(receiverJava, /pkg\.contains\("rider"\)\s*&&\s*!OrderMonitorService\.isRiderOnDuty\(context\)[\s\S]*cancelKeepAliveWatchdogs\(context\)/);
    assert.match(mainJava, /shouldRunOrderMonitorService[\s\S]*pkg\.contains\("rider"\)\s*&&\s*!OrderMonitorService\.isRiderOnDuty\(this\)/);
    assert.match(mainJava, /onResume[\s\S]*getPackageName\(\)\.toLowerCase\(\)\.contains\("rider"\)\s*&&\s*OrderMonitorService\.isRiderOnDuty\(this\)\s*&&\s*isDeviceLocationEnabled\(\)/);
    assert.match(mainJava, /public static void updateRiderScreenWakeFlag\(boolean onDuty\)/);
    assert.match(serviceJava, /MainActivity\.updateRiderScreenWakeFlag\(onDuty\);/);

    const buildGradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle'), 'utf8');
    const riderColorsXml = fs.readFileSync(path.join(ROOT, 'android/app/src/rider/res/values/colors.xml'), 'utf8');
    assert.match(buildGradle, /applicationId "com\.foodbliz\.rider"[\s\S]*versionCode 14[\s\S]*theme_color", "#E66B50"/);
    assert.match(riderColorsXml, /#191817/);
    assert.match(riderColorsXml, /#E66B50/);
  });

  await t.test('5. Order cards omit Payoff formula lines above action buttons and support 1-tap Take Order', () => {
    const deliveryJs = fs.readFileSync(path.join(ROOT, 'delivery.js'), 'utf8');

    assert.doesNotMatch(deliveryJs, /<strong>Payoff:/, 'Redundant Payoff formula strip must be removed above order card action button');
    assert.match(deliveryJs, /\$\{gpsReady \? 'Take Order' : 'Sync GPS & Take Order'\}/, 'Ready cards must display crisp 1-tap Take Order CTA');
    assert.match(deliveryJs, /async function executeOneTapOrderAccept\(order, code, triggerBtn = null\)/);

    // handleStartDelivery must execute 1-tap acceptance directly without opening the preview modal
    const handleStartMatch = deliveryJs.match(/function handleStartDelivery\([\s\S]*?\n  \}/);
    assert.ok(handleStartMatch, 'handleStartDelivery must exist');
    assert.match(handleStartMatch[0], /executeOneTapOrderAccept\(order, code, triggerBtn\)/);
    assert.doesNotMatch(handleStartMatch[0], /openBagPreviewModal/);
  });
});
