import test from 'node:test';
import assert from 'node:assert/strict';

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
});
