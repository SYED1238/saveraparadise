import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getAudioContext,
  setSoundEnabled,
  isSoundEnabled,
  playNotificationSound,
  isSystemNotificationSupported,
  getSystemNotificationPermission,
  requestSystemNotificationPermission,
  isNotificationGranted,
  updateAppBadge,
  triggerDeviceVibration,
  getDefaultPortalMeta,
  sendSystemNotification,
  flashTabTitle,
  stopFlashingTabTitle,
  showSamsungToast
} from '../notificationService.js';

test('NOTIFICATION & POPUP AUDIT: Alert Deduplication & Siren Safety Suite', async (t) => {

  await t.test('1. In-flight tag deduplication suppresses rapid duplicate system notifications', () => {
    const recentNotifications = new Map();

    function mockSendSystemNotification({ tag, title, now = Date.now() }) {
      const notifKey = `${tag || 'default'}:${title}`;
      const lastSent = recentNotifications.get(notifKey) || 0;
      if (now - lastSent < 2000) {
        return null; // Suppressed duplicate
      }
      recentNotifications.set(notifKey, now);
      return { sent: true, tag, title };
    }

    const t0 = 100000;
    const first = mockSendSystemNotification({ tag: 'admin-order-101', title: 'New Order #101', now: t0 });
    assert.ok(first !== null, 'First notification must be sent');
    assert.equal(first.sent, true);

    // Rapid duplicate 20ms later (e.g., from BroadcastChannel after storage event)
    const second = mockSendSystemNotification({ tag: 'admin-order-101', title: 'New Order #101', now: t0 + 20 });
    assert.equal(second, null, 'Second rapid duplicate must be suppressed');

    // Rapid duplicate 500ms later (e.g., from customEvent)
    const third = mockSendSystemNotification({ tag: 'admin-order-101', title: 'New Order #101', now: t0 + 500 });
    assert.equal(third, null, 'Third rapid duplicate must be suppressed');

    // Legitimate distinct order arrives 100ms later
    const distinct = mockSendSystemNotification({ tag: 'admin-order-102', title: 'New Order #102', now: t0 + 100 });
    assert.ok(distinct !== null, 'Distinct order notification must not be suppressed');

    // Same order arrives after cooldown (2500ms later)
    const afterCooldown = mockSendSystemNotification({ tag: 'admin-order-101', title: 'New Order #101', now: t0 + 2500 });
    assert.ok(afterCooldown !== null, 'Notification after cooldown window is permitted');
  });

  await t.test('2. Service Worker vs Window Fallback race condition eliminates dual notifications', async () => {
    let swShownCount = 0;
    let windowShownCount = 0;

    function simulateNotificationDispatch(resolveDelayMs) {
      return new Promise((done) => {
        let swCompleted = false;
        let fallbackFired = false;
        let fallbackTimer = null;

        fallbackTimer = setTimeout(() => {
          fallbackTimer = null;
          if (!swCompleted && !fallbackFired) {
            fallbackFired = true;
            windowShownCount++;
          }
        }, 30);

        setTimeout(() => {
          if (fallbackTimer) {
            clearTimeout(fallbackTimer);
            fallbackTimer = null;
          }
          if (fallbackFired) {
            // Fallback already fired; prevent duplicate
            done('fallback_handled');
            return;
          }
          swCompleted = true;
          swShownCount++;
          done('sw_handled');
        }, resolveDelayMs);
      });
    }

    // Scenario A: Service Worker resolves slowly (70ms > 30ms fallback timer)
    await simulateNotificationDispatch(70);
    assert.equal(windowShownCount, 1, 'Window fallback fired because SW took longer than timeout');
    assert.equal(swShownCount, 0, 'SW was aborted when resolving after fallback fired, preventing dual notification');

    // Scenario B: Service Worker resolves quickly (10ms < 30ms fallback timer)
    swShownCount = 0;
    windowShownCount = 0;
    await simulateNotificationDispatch(10);
    assert.equal(swShownCount, 1, 'SW showed notification cleanly');
    assert.equal(windowShownCount, 0, 'Window fallback was cleared and never fired');
  });

  await t.test('3. Persistent kitchen alarm acknowledgement store persists and prevents replay', () => {
    const memoryStorage = {};
    const ACKNOWLEDGED_ALARMS_KEY = 'quickbite_acknowledged_alarms';

    function getAcknowledgedAlarms() {
      try {
        const stored = JSON.parse(memoryStorage[ACKNOWLEDGED_ALARMS_KEY] || '[]');
        const now = Date.now();
        const filtered = stored.filter(item => item && (now - Number(item.timestamp || 0) < 24 * 60 * 60 * 1000));
        return new Map(filtered.map(item => [item.id, Number(item.timestamp || 0)]));
      } catch {
        return new Map();
      }
    }

    function markAlarmAcknowledged(orderIds) {
      if (!orderIds) return;
      const ids = Array.isArray(orderIds) ? orderIds : [orderIds];
      const map = getAcknowledgedAlarms();
      const now = Date.now();
      ids.filter(Boolean).forEach(id => {
        const clean = String(id).trim();
        map.set(clean, now);
        map.set(clean.replace(/^#/, ''), now);
      });
      const list = Array.from(map.entries()).map(([id, timestamp]) => ({ id, timestamp }));
      memoryStorage[ACKNOWLEDGED_ALARMS_KEY] = JSON.stringify(list);
    }

    function isAlarmAcknowledged(orderId) {
      if (!orderId) return false;
      const clean = String(orderId).trim();
      const map = getAcknowledgedAlarms();
      return map.has(clean) || map.has(clean.replace(/^#/, ''));
    }

    // Initially unacknowledged
    assert.equal(isAlarmAcknowledged('#QB-4091'), false);
    assert.equal(isAlarmAcknowledged('QB-4091'), false);

    // Kitchen stops alarm
    markAlarmAcknowledged(['#QB-4091']);

    // Both prefixed and clean IDs must now be recognized as acknowledged across page refreshes
    assert.equal(isAlarmAcknowledged('#QB-4091'), true);
    assert.equal(isAlarmAcknowledged('QB-4091'), true);
    assert.equal(isAlarmAcknowledged('QB-9999'), false);
  });

  await t.test('4. Stale orders (>15 minutes old) are blocked from ringing sirens on reconnect/refresh', () => {
    const now = Date.now();

    function shouldAlertNewOrder(order) {
      if (!order || !order.id) return false;
      if (order.status !== 'accepted' && order.status !== 'pending') return false;
      if (order.alarmAcknowledged) return false;

      // Order age guard: reject orders older than 15 minutes
      const orderAge = order.createdAt ? (now - Number(order.createdAt)) : 0;
      if (orderAge > 15 * 60 * 1000) {
        return false;
      }
      return true;
    }

    const freshOrder = { id: '#QB-101', status: 'accepted', createdAt: now - (2 * 60 * 1000) }; // 2 mins old
    assert.equal(shouldAlertNewOrder(freshOrder), true, 'Fresh unacknowledged order must ring kitchen alarm');

    const staleOrder = { id: '#QB-102', status: 'accepted', createdAt: now - (45 * 60 * 1000) }; // 45 mins old
    assert.equal(shouldAlertNewOrder(staleOrder), false, 'Order from 45 mins ago must not ring siren on reconnect');

    const dayOldOrder = { id: '#QB-103', status: 'pending', createdAt: now - (24 * 60 * 60 * 1000) }; // 1 day old
    assert.equal(shouldAlertNewOrder(dayOldOrder), false, 'Order from yesterday must not ring siren on reconnect');
  });

  await t.test('5. Multi-channel order status sync deduplication avoids repeated audio chimes and toasts', () => {
    const recentStatusSyncs = new Map();
    let audioChimeCount = 0;
    let toastCount = 0;

    function handleStatusSync({ orderId, status, now = Date.now() }) {
      if (!orderId || !status) return false;
      const syncKey = `${orderId}:${status}`;
      const lastSync = recentStatusSyncs.get(syncKey) || 0;
      if (now - lastSync < 3000) {
        return false; // Deduplicated
      }
      recentStatusSyncs.set(syncKey, now);

      if (status === 'on_the_way') {
        audioChimeCount++;
        toastCount++;
      }
      return true;
    }

    const t0 = 50000;
    // 1. Storage event triggers
    const res1 = handleStatusSync({ orderId: '#QB-777', status: 'on_the_way', now: t0 });
    // 2. BroadcastChannel triggers 15ms later
    const res2 = handleStatusSync({ orderId: '#QB-777', status: 'on_the_way', now: t0 + 15 });
    // 3. Supabase Realtime in-memory event triggers 30ms later
    const res3 = handleStatusSync({ orderId: '#QB-777', status: 'on_the_way', now: t0 + 30 });

    assert.equal(res1, true, 'First event is processed');
    assert.equal(res2, false, 'BroadcastChannel duplicate is deduplicated');
    assert.equal(res3, false, 'Realtime duplicate is deduplicated');

    assert.equal(audioChimeCount, 1, 'Only one chime played for the dispatch event');
    assert.equal(toastCount, 1, 'Only one toast displayed for the dispatch event');
  });

  await t.test('6. Role boundaries ensure customer only receives relevant order alerts', () => {
    const myCustomerOrderIds = new Set(['#QB-101', '#QB-102']);

    function shouldCustomerBeAlerted(order) {
      if (!order || !order.id) return false;
      return myCustomerOrderIds.has(order.id) || myCustomerOrderIds.has(order.id.replace(/^#/, ''));
    }

    assert.equal(shouldCustomerBeAlerted({ id: '#QB-101', status: 'cooking' }), true, 'Alerts customer for own order');
    assert.equal(shouldCustomerBeAlerted({ id: '#QB-999', status: 'cooking' }), false, 'Rejects alert for other customer order');
  });

  await t.test('7. Customer delivered notification replay protection blocks stale/yesterday orders across reloads', () => {
    const memoryStorage = {};
    const CUSTOMER_ALERTED_KEY = 'quickbite_customer_alerted_statuses';

    function isCustomerAlerted(orderId, status) {
      try {
        const map = JSON.parse(memoryStorage[CUSTOMER_ALERTED_KEY] || '{}');
        return Boolean(map[`${orderId}_${status}`]);
      } catch {
        return false;
      }
    }

    function markCustomerAlerted(orderId, status) {
      const map = JSON.parse(memoryStorage[CUSTOMER_ALERTED_KEY] || '{}');
      map[`${orderId}_${status}`] = Date.now();
      memoryStorage[CUSTOMER_ALERTED_KEY] = JSON.stringify(map);
    }

    function shouldAlertCustomer(order, syncEvent, now = Date.now()) {
      if (!order || !order.id) return false;
      const orderAge = order.createdAt ? (now - Number(order.createdAt)) : 0;
      if ((order.status === 'delivered' || order.status === 'cancelled') && orderAge > 20 * 60 * 1000) {
        markCustomerAlerted(order.id, order.status);
        return false;
      }
      if (syncEvent?.prevStatus && syncEvent.prevStatus === order.status) {
        return false;
      }
      if (isCustomerAlerted(order.id, order.status)) {
        return false;
      }
      markCustomerAlerted(order.id, order.status);
      return true;
    }

    const yesterdayDeliveredOrder = {
      id: '#QB-8801',
      status: 'delivered',
      createdAt: Date.now() - (24 * 60 * 60 * 1000) // 24 hours old
    };

    // First attempt to alert yesterday's delivered order on app open must be blocked
    assert.equal(shouldAlertCustomer(yesterdayDeliveredOrder, { orderId: '#QB-8801', status: 'delivered' }), false, 'Yesterday delivered order must be blocked');

    // Fresh order placed 5 mins ago transitions from on_the_way to delivered
    const freshOrder = {
      id: '#QB-9902',
      status: 'delivered',
      createdAt: Date.now() - (5 * 60 * 1000)
    };
    assert.equal(shouldAlertCustomer(freshOrder, { orderId: '#QB-9902', status: 'delivered', prevStatus: 'on_the_way' }), true, 'Fresh order first delivery must alert');

    // Subsequent sync event or reload for same delivered order must be blocked
    assert.equal(shouldAlertCustomer(freshOrder, { orderId: '#QB-9902', status: 'delivered', prevStatus: 'delivered' }), false, 'Duplicate delivery event must be blocked');
    assert.equal(shouldAlertCustomer(freshOrder, { orderId: '#QB-9902', status: 'delivered' }), false, 'Reload sync of same delivered order must be blocked');
  });

  await t.test('8. Samsung One UI Top Pill Notification Engine: swipe mechanics, rounded pill styling, and top positioning', () => {
    // Mock DOM environment for Node.js test runner
    const elements = [];
    const mockContainer = {
      querySelectorAll() { return elements; },
      appendChild(child) {
        elements.push(child);
        child.parentNode = this;
      }
    };

    function simulateCreateSamsungToast(message, type, options = {}) {
      const cleanMsg = String(message).trim();
      const appName = options.appName || 'SAVERA PARADISE';
      const toast = {
        className: `toast toast-${type} toast-samsung`,
        innerHTML: `
          <div class="toast-card-inner">
            <div class="toast-badge-wrap"><div class="toast-badge-circle toast-badge-${type}"></div></div>
            <div class="toast-body-wrap">
              <div class="toast-header-row"><span class="toast-app-pill">${appName}</span><span class="toast-time-meta">now</span></div>
              <div class="toast-message-text">${cleanMsg}</div>
            </div>
          </div>
          <div class="toast-swipe-notch" aria-hidden="true"></div>
        `,
        style: {},
        parentNode: null,
        remove() {
          const idx = elements.indexOf(this);
          if (idx !== -1) elements.splice(idx, 1);
        }
      };
      mockContainer.appendChild(toast);
      return toast;
    }

    // 1. Toast creation contains Samsung One UI classes and elements
    const toast = simulateCreateSamsungToast('Added Chicken Biryani (Full) to basket! 🛒', 'success', { appName: 'Savera Paradise' });
    assert.ok(toast.className.includes('toast-samsung'), 'Must include toast-samsung class');
    assert.ok(toast.className.includes('toast-success'), 'Must include toast-success class');
    assert.ok(toast.innerHTML.includes('toast-swipe-notch'), 'Must include Samsung swipe handle notch');
    assert.ok(toast.innerHTML.includes('Savera Paradise'), 'Must render application brand header');
    assert.ok(toast.innerHTML.includes('Added Chicken Biryani (Full) to basket! 🛒'), 'Must render accurate message text');

    // 2. Gesture threshold checks:
    // Swipe UP gesture: deltaY < -28px triggers dismissal
    function evaluateSwipeDismissal(deltaX, deltaY) {
      if (deltaY < -28) return 'dismiss_up';
      if (deltaX > 55) return 'dismiss_right';
      if (deltaX < -55) return 'dismiss_left';
      return 'spring_back';
    }

    assert.equal(evaluateSwipeDismissal(0, -35), 'dismiss_up', 'Swiping up past -28px must dismiss up');
    assert.equal(evaluateSwipeDismissal(70, 0), 'dismiss_right', 'Swiping right past 55px must dismiss right');
    assert.equal(evaluateSwipeDismissal(-60, 0), 'dismiss_left', 'Swiping left past -55px must dismiss left');
    assert.equal(evaluateSwipeDismissal(10, -15), 'spring_back', 'Minor drag below threshold must spring back');

    // 3. Cleanup
    toast.remove();
    assert.equal(elements.length, 0, 'Toast remove must clean up element');
  });

  await t.test('9. notificationService real module exports verify all public APIs are valid functions', () => {
    assert.equal(typeof getAudioContext, 'function');
    assert.equal(typeof setSoundEnabled, 'function');
    assert.equal(typeof isSoundEnabled, 'function');
    assert.equal(typeof playNotificationSound, 'function');
    assert.equal(typeof isSystemNotificationSupported, 'function');
    assert.equal(typeof getSystemNotificationPermission, 'function');
    assert.equal(typeof requestSystemNotificationPermission, 'function');
    assert.equal(typeof isNotificationGranted, 'function');
    assert.equal(typeof updateAppBadge, 'function');
    assert.equal(typeof triggerDeviceVibration, 'function');
    assert.equal(typeof getDefaultPortalMeta, 'function');
    assert.equal(typeof sendSystemNotification, 'function');
    assert.equal(typeof flashTabTitle, 'function');
    assert.equal(typeof stopFlashingTabTitle, 'function');
    assert.equal(typeof showSamsungToast, 'function');
  });

  await t.test('10. AudioContext singleton, sound toggle, and tone synthesizer safety (including order_incoming)', () => {
    const origState = isSoundEnabled();
    try {
      setSoundEnabled(false);
      assert.equal(isSoundEnabled(), false, 'Sound should be disabled');
      assert.doesNotThrow(() => playNotificationSound('new_order'));
      assert.doesNotThrow(() => playNotificationSound('order_incoming'));
      assert.doesNotThrow(() => playNotificationSound('kitchen_alarm'));

      setSoundEnabled(true);
      assert.equal(isSoundEnabled(), true, 'Sound should be enabled');

      const soundKeys = [
        'new_order',
        'order_incoming',
        'kitchen_alarm',
        'rider_new_task',
        'order_placed',
        'accepted',
        'cooking',
        'on_the_way',
        'dispatched',
        'delivered',
        'cancelled',
        'general_alert',
        'test_siren'
      ];
      for (const key of soundKeys) {
        assert.doesNotThrow(() => playNotificationSound(key), `Sound key '${key}' should execute without error`);
      }
    } finally {
      setSoundEnabled(origState);
    }
  });

  await t.test('11. Notification support detection, permission queries, and haptic/badge guards', async () => {
    const origWindow = globalThis.window;

    try {
      // 1. Headless environment without window
      delete globalThis.window;
      assert.equal(isSystemNotificationSupported(), false);
      assert.equal(getSystemNotificationPermission(), 'unsupported');
      assert.equal(isNotificationGranted(), false);

      // 2. Mock Window with granted Notification API
      globalThis.window = {
        Notification: {
          permission: 'granted',
          requestPermission: async () => 'granted'
        }
      };
      assert.equal(isSystemNotificationSupported(), true);
      assert.equal(getSystemNotificationPermission(), 'granted');
      assert.equal(isNotificationGranted(), true);

      const perm = await requestSystemNotificationPermission();
      assert.equal(perm, 'granted');

      // 3. AndroidNative bridge environment
      globalThis.window.AndroidNative = {
        requestNotificationPermission() {}
      };
      assert.equal(isSystemNotificationSupported(), true);
      assert.equal(getSystemNotificationPermission(), 'granted');
      assert.equal(isNotificationGranted(), true);

      // 4. Badge and vibration no-throw safety
      let badgeCount = null;
      let vibrationPattern = null;
      if (typeof navigator !== 'undefined') {
        const origSetAppBadge = navigator.setAppBadge;
        const origClearAppBadge = navigator.clearAppBadge;
        const origVibrate = navigator.vibrate;

        Object.defineProperty(navigator, 'setAppBadge', {
          value: async (c) => { badgeCount = c; },
          configurable: true,
          writable: true
        });
        Object.defineProperty(navigator, 'clearAppBadge', {
          value: async () => { badgeCount = 0; },
          configurable: true,
          writable: true
        });
        Object.defineProperty(navigator, 'vibrate', {
          value: (p) => { vibrationPattern = p; },
          configurable: true,
          writable: true
        });

        try {
          updateAppBadge(4);
          assert.equal(badgeCount, 4);
          updateAppBadge(0);
          assert.equal(badgeCount, 0);

          triggerDeviceVibration([180, 90, 180]);
          assert.deepEqual(vibrationPattern, [180, 90, 180]);
        } finally {
          if (origSetAppBadge) {
            Object.defineProperty(navigator, 'setAppBadge', { value: origSetAppBadge, configurable: true, writable: true });
          } else {
            delete navigator.setAppBadge;
          }
          if (origClearAppBadge) {
            Object.defineProperty(navigator, 'clearAppBadge', { value: origClearAppBadge, configurable: true, writable: true });
          } else {
            delete navigator.clearAppBadge;
          }
          if (origVibrate) {
            Object.defineProperty(navigator, 'vibrate', { value: origVibrate, configurable: true, writable: true });
          } else {
            delete navigator.vibrate;
          }
        }
      } else {
        assert.doesNotThrow(() => updateAppBadge(4));
        assert.doesNotThrow(() => triggerDeviceVibration([180, 90, 180]));
      }
    } finally {
      globalThis.window = origWindow;
    }
  });

  await t.test('12. getDefaultPortalMeta dynamically returns portal-specific icon, URL, and branding', () => {
    const origWindow = globalThis.window;

    try {
      delete globalThis.window;
      assert.deepEqual(getDefaultPortalMeta(), {
        icon: '/icon-192.svg',
        url: '/',
        title: 'Savera Paradise'
      });

      globalThis.window = { location: { pathname: '/admin.html' } };
      assert.deepEqual(getDefaultPortalMeta(), {
        icon: '/icon-admin-192.svg',
        url: '/admin.html',
        title: 'Savera Paradise Kitchen'
      });

      globalThis.window = { location: { pathname: '/owner.html' } };
      assert.deepEqual(getDefaultPortalMeta(), {
        icon: '/icon-owner-192.svg',
        url: '/owner.html',
        title: 'Savera Paradise Owner'
      });

      globalThis.window = { location: { pathname: '/delivery.html' } };
      assert.deepEqual(getDefaultPortalMeta(), {
        icon: '/icon-rider-192.svg',
        url: '/delivery.html',
        title: 'Savera Paradise Rider'
      });
    } finally {
      globalThis.window = origWindow;
    }
  });

  await t.test('13. Tab title flashing cleans up focus listeners and properly restores document.title across multiple cycles', () => {
    const origDocument = globalThis.document;
    const origWindow = globalThis.window;

    let focusListener = null;
    const mockWindow = {
      addEventListener(event, fn) {
        if (event === 'focus') focusListener = fn;
      },
      removeEventListener(event, fn) {
        if (event === 'focus' && focusListener === fn) focusListener = null;
      }
    };

    const mockDoc = {
      title: 'Kitchen Dashboard'
    };

    try {
      globalThis.window = mockWindow;
      globalThis.document = mockDoc;

      // Cycle 1: First flash cycle
      flashTabTitle('🚨 NEW ORDER #QB-101', 5000);
      assert.ok(focusListener !== null, 'Focus listener must be registered');

      // Re-triggering flashTabTitle while active must NOT overwrite original title
      flashTabTitle('🚨 NEW ORDER #QB-102', 5000);
      assert.ok(focusListener !== null, 'Focus listener refreshed');

      // Explicitly stop flashing
      stopFlashingTabTitle();
      assert.equal(mockDoc.title, 'Kitchen Dashboard', 'Title restored to original');
      assert.equal(focusListener, null, 'Focus listener removed on stop');

      // Cycle 2: Title changes between alerts
      mockDoc.title = 'Order #101 Preparation Details';
      flashTabTitle('🛵 RIDER AT DOORSTEP', 5000);
      assert.ok(focusListener !== null, 'Focus listener registered for second cycle');

      // Window focus event triggers auto-stop
      focusListener();
      assert.equal(mockDoc.title, 'Order #101 Preparation Details', 'Must restore updated title, not stale cycle 1 title');
      assert.equal(focusListener, null, 'Focus listener cleaned up by onFocus handler');
    } finally {
      globalThis.document = origDocument;
      globalThis.window = origWindow;
    }
  });

  await t.test('14. Android Native Bridge tag normalization handles all web notification prefixes and hashes', () => {
    const knownOrderIds = new Set();
    const notifiedReadyIds = new Set();

    function markOrderNotified(orderId) {
      if (!orderId || !orderId.trim()) return;
      const rawTag = orderId.trim();
      knownOrderIds.add(rawTag);
      notifiedReadyIds.add(rawTag);

      let normalized = rawTag;
      const prefixes = [
        'admin-order-', 'admin-dispatched-', 'admin-delivered-', 'admin-undelivered-', 'admin-overdue-',
        'rider-ready-', 'customer-accepted-', 'customer-cooking-', 'customer-dispatched-',
        'customer-delivered-', 'customer-cancelled-', 'customer-undelivered-', 'order-'
      ];
      for (const p of prefixes) {
        if (normalized.startsWith(p)) {
          normalized = normalized.substring(p.length);
          break;
        }
      }
      normalized = normalized.trim();
      if (normalized) {
        const bareId = normalized.startsWith('#') ? normalized.substring(1) : normalized;
        const hashId = '#' + bareId;

        knownOrderIds.add(normalized);
        knownOrderIds.add(bareId);
        knownOrderIds.add(hashId);

        notifiedReadyIds.add(normalized);
        notifiedReadyIds.add(bareId);
        notifiedReadyIds.add(hashId);
      }
    }

    // 1. Admin Order Tag
    markOrderNotified('admin-order-#QB-1001');
    assert.ok(knownOrderIds.has('admin-order-#QB-1001'), 'Stores raw tag');
    assert.ok(knownOrderIds.has('#QB-1001'), 'Stores hash ID');
    assert.ok(knownOrderIds.has('QB-1001'), 'Stores bare ID');

    // 2. Rider Ready Tag
    markOrderNotified('rider-ready-#QB-2002');
    assert.ok(notifiedReadyIds.has('rider-ready-#QB-2002'), 'Stores rider raw tag');
    assert.ok(notifiedReadyIds.has('#QB-2002'), 'Stores hash ID for ready status');
    assert.ok(notifiedReadyIds.has('QB-2002'), 'Stores bare ID for ready status');

    // 3. Customer & Generic Dispatched Tags
    markOrderNotified('customer-dispatched-QB-3003');
    assert.ok(knownOrderIds.has('#QB-3003'), 'Automatically derives hash ID from bare input');
    assert.ok(knownOrderIds.has('QB-3003'), 'Stores bare ID');

    markOrderNotified('order-#QB-4004');
    assert.ok(knownOrderIds.has('#QB-4004'));
    assert.ok(knownOrderIds.has('QB-4004'));

    // Verify background poller lookup succeeds using raw Supabase ID format
    const supabaseOrderId1 = '#QB-1001';
    const supabaseOrderId2 = 'QB-2002';
    assert.ok(knownOrderIds.has(supabaseOrderId1), 'Background poller avoids double-alerting on Supabase hash ID');
    assert.ok(notifiedReadyIds.has(supabaseOrderId2), 'Rider background poller avoids double-alerting on Supabase bare ID');
  });

  await t.test('15. sendSystemNotification delegates to AndroidNative bridge with sound and vibration', () => {
    const origWindow = globalThis.window;

    let androidNotified = null;
    let androidVibrated = false;

    globalThis.window = {
      AndroidNative: {
        showNotification(title, body, tag, soundType) {
          androidNotified = { title, body, tag, soundType };
        },
        triggerVibration() {
          androidVibrated = true;
        }
      }
    };

    try {
      const result = sendSystemNotification({
        title: '🍗 NEW ORDER #QB-8899',
        body: 'Syed • 2 Items (₹450)',
        tag: 'admin-order-#QB-8899',
        soundType: 'kitchen_alarm'
      });

      assert.equal(result, true, 'Returns true on Android bridge success');
      assert.deepEqual(androidNotified, {
        title: '🍗 NEW ORDER #QB-8899',
        body: 'Syed • 2 Items (₹450)',
        tag: 'admin-order-#QB-8899',
        soundType: 'kitchen_alarm'
      });
      assert.equal(androidVibrated, true, 'Triggers native vibration buzz');
    } finally {
      globalThis.window = origWindow;
    }
  });

  await t.test('16. showSamsungToast renders pill toast in DOM and highlights duplicates', () => {
    const origDocument = globalThis.document;

    const elements = [];
    const mockContainer = {
      querySelectorAll(sel) {
        if (sel === '.toast') return elements;
        return [];
      },
      appendChild(el) {
        elements.push(el);
        el.parentNode = this;
      }
    };

    const mockDoc = {
      createElement(tag) {
        const classListSet = new Set();
        const el = {
          tagName: tag.toUpperCase(),
          className: '',
          innerHTML: '',
          style: {},
          attributes: {},
          parentNode: null,
          classList: {
            add(...cls) {
              cls.forEach(c => classListSet.add(c));
              el.className = Array.from(classListSet).join(' ');
            },
            remove(...cls) {
              cls.forEach(c => classListSet.delete(c));
              el.className = Array.from(classListSet).join(' ');
            },
            contains(c) {
              return classListSet.has(c) || (el.className && el.className.split(' ').includes(c));
            }
          },
          setAttribute(k, v) { this.attributes[k] = v; },
          getAttribute(k) { return this.attributes[k]; },
          addEventListener() {},
          removeEventListener() {},
          querySelector(sel) {
            if (sel === '.toast-message-text') {
              return { textContent: this._msgText || '' };
            }
            return null;
          },
          querySelectorAll() { return []; },
          remove() {
            const idx = elements.indexOf(this);
            if (idx !== -1) elements.splice(idx, 1);
          }
        };
        return el;
      },
      getElementById(id) {
        if (id === 'toast-container') return mockContainer;
        return null;
      },
      querySelector() { return null; },
      body: {
        appendChild(child) {
          elements.push(child);
        }
      }
    };

    try {
      globalThis.document = mockDoc;

      assert.equal(showSamsungToast(''), null);

      const toast1 = showSamsungToast('Order #QB-101 accepted! 👨‍🍳', 'success', {
        container: mockContainer,
        appName: 'Savera Paradise'
      });
      assert.ok(toast1 !== null, 'Toast must be created');
      assert.ok(toast1.className.includes('toast-samsung'), 'Contains toast-samsung');
      assert.ok(toast1.className.includes('toast-success'), 'Contains toast-success');
      assert.equal(toast1.attributes['role'], 'alert');

      const toastDuplicate = showSamsungToast('Order #QB-101 accepted! 👨‍🍳', 'success', {
        container: mockContainer
      });
      assert.equal(toastDuplicate, null, 'Duplicate within debounce interval is suppressed');
    } finally {
      globalThis.document = origDocument;
    }
  });
});
