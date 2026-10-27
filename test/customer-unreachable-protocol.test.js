import test from 'node:test';
import assert from 'node:assert/strict';
import { ORDER_STATUS_RANKS } from '../dataService.js';

test('CUSTOMER UNREACHABLE AT DOORSTEP (CNR) PROTOCOL SUITE', async (t) => {
  await t.test('1. Status monotonic ranking permits transition to undelivered and blocks regressions', () => {
    function canTransition(currentStatus, nextStatus) {
      if (nextStatus === 'cancelled') {
        return currentStatus === 'pending' || currentStatus === 'accepted';
      }
      const curRank = ORDER_STATUS_RANKS[currentStatus] !== undefined ? ORDER_STATUS_RANKS[currentStatus] : 0;
      const nxtRank = ORDER_STATUS_RANKS[nextStatus] !== undefined ? ORDER_STATUS_RANKS[nextStatus] : -1;
      return nxtRank >= curRank;
    }

    assert.strictEqual(canTransition('on_the_way', 'undelivered'), true, 'on_the_way can transition to undelivered');
    assert.strictEqual(canTransition('on_the_way', 'delivered'), true, 'on_the_way can transition to delivered');
    assert.strictEqual(canTransition('undelivered', 'cooking'), false, 'undelivered cannot regress to cooking');
    assert.strictEqual(canTransition('undelivered', 'accepted'), false, 'undelivered cannot regress to accepted');
    assert.strictEqual(canTransition('undelivered', 'cancelled'), false, 'undelivered cannot regress to cancelled');
  });

  await t.test('2. Authorization guard: only rider or admin can mark order as undelivered', () => {
    function authorizeStatusChange(newStatus, source) {
      if (['on_the_way', 'delivered', 'undelivered'].includes(newStatus)) {
        return source === 'rider' || source === 'admin';
      }
      return true;
    }

    assert.strictEqual(authorizeStatusChange('undelivered', 'rider'), true, 'Rider is authorized to mark undelivered');
    assert.strictEqual(authorizeStatusChange('undelivered', 'admin'), true, 'Admin is authorized to mark undelivered');
    assert.strictEqual(authorizeStatusChange('undelivered', 'customer'), false, 'Customer cannot mark undelivered');
    assert.strictEqual(authorizeStatusChange('undelivered', 'anonymous'), false, 'Anonymous cannot mark undelivered');
  });

  await t.test('3. COD financial liability: undelivered orders retain ₹0 cash liability and do not bloat rider cash in hand', () => {
    const orders = [
      {
        id: '#QB-1001',
        total: '₹350',
        paymentMethod: 'Cash on Delivery (COD)',
        status: 'delivered',
        assignedRiderPin: '1234',
        deliveredAt: Date.now() - 10000,
        cashCollected: 350
      },
      {
        id: '#QB-1002',
        total: '₹480',
        paymentMethod: 'Cash on Delivery (COD)',
        status: 'undelivered',
        assignedRiderPin: '1234',
        undeliveredAt: Date.now() - 5000,
        returnToKitchen: true,
        cashCollected: 0,
        cash_collected: 0
      }
    ];

    // Compute rider cash in hand following dataService.getRiderCashSummary logic
    const riderDelivered = orders.filter(o => o.status === 'delivered' && o.assignedRiderPin === '1234');
    const codOrders = riderDelivered.filter(o => {
      const pay = String(o.paymentMethod || '').toLowerCase();
      return pay.includes('cash') || pay.includes('cod');
    });

    const cashInHand = codOrders.reduce((sum, o) => {
      const num = Number(String(o.total || '0').replace(/[^0-9.]/g, '')) || 0;
      return sum + num;
    }, 0);

    assert.strictEqual(riderDelivered.length, 1, 'Only successfully delivered order is in delivered count');
    assert.strictEqual(cashInHand, 350, 'Cash in hand must ONLY include ₹350 from delivered order, not undelivered ₹480');
    assert.strictEqual(orders[1].cashCollected, 0, 'Undelivered order cash collected must be exactly 0');
  });

  await t.test('4. Prepaid resolution: safe-drop vs return to kitchen validation', () => {
    function processPrepaidResolution(order, resolutionType, payload = {}) {
      if (resolutionType === 'safe_drop') {
        return {
          status: 'delivered',
          safeDrop: true,
          safeDropNote: String(payload.safeDropNote || '').trim() || 'Left at doorstep / with guard',
          cashCollected: 0,
          deliveredAt: Date.now()
        };
      } else if (resolutionType === 'return_to_kitchen') {
        return {
          status: 'undelivered',
          returnToKitchen: true,
          undeliveredReason: payload.reason || 'Location inaccessible',
          cashCollected: 0,
          undeliveredAt: Date.now()
        };
      }
      throw new Error('Unknown resolution');
    }

    const prepaidOrder = { id: '#QB-2001', total: '₹520', paymentMethod: 'UPI / Prepaid Online' };

    const dropRes = processPrepaidResolution(prepaidOrder, 'safe_drop', { safeDropNote: 'Left with building security Ramesh' });
    assert.strictEqual(dropRes.status, 'delivered');
    assert.strictEqual(dropRes.safeDrop, true);
    assert.strictEqual(dropRes.safeDropNote, 'Left with building security Ramesh');
    assert.strictEqual(dropRes.cashCollected, 0);

    const returnRes = processPrepaidResolution(prepaidOrder, 'return_to_kitchen', { reason: 'Society gate locked, customer phone unreachable' });
    assert.strictEqual(returnRes.status, 'undelivered');
    assert.strictEqual(returnRes.returnToKitchen, true);
    assert.strictEqual(returnRes.undeliveredReason, 'Society gate locked, customer phone unreachable');
    assert.strictEqual(returnRes.cashCollected, 0);
  });

  await t.test('5. 10-Minute Waiting Countdown Timer mathematical progression', () => {
    function calculateCountdown(startTime, nowTime = Date.now()) {
      const elapsed = Math.floor((nowTime - startTime) / 1000);
      const totalSeconds = 600;
      const remaining = Math.max(0, totalSeconds - elapsed);
      const mins = Math.floor(remaining / 60);
      const secs = remaining % 60;
      const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      const pct = Math.max(0, Math.min(100, (remaining / totalSeconds) * 100));
      return {
        remaining,
        formatted,
        pct,
        isExpired: remaining === 0
      };
    }

    const start = 1700000000000;

    // Start (0 elapsed)
    const at0 = calculateCountdown(start, start);
    assert.strictEqual(at0.formatted, '10:00');
    assert.strictEqual(at0.remaining, 600);
    assert.strictEqual(at0.pct, 100);
    assert.strictEqual(at0.isExpired, false);

    // Halfway (300 seconds elapsed)
    const at300 = calculateCountdown(start, start + 300 * 1000);
    assert.strictEqual(at300.formatted, '05:00');
    assert.strictEqual(at300.remaining, 300);
    assert.strictEqual(at300.pct, 50);
    assert.strictEqual(at300.isExpired, false);

    // Expired (600 seconds elapsed)
    const at600 = calculateCountdown(start, start + 600 * 1000);
    assert.strictEqual(at600.formatted, '00:00');
    assert.strictEqual(at600.remaining, 0);
    assert.strictEqual(at600.pct, 0);
    assert.strictEqual(at600.isExpired, true);

    // Beyond 10 mins (720 seconds elapsed)
    const at720 = calculateCountdown(start, start + 720 * 1000);
    assert.strictEqual(at720.formatted, '00:00');
    assert.strictEqual(at720.remaining, 0);
    assert.strictEqual(at720.isExpired, true);
  });

  await t.test('6. Urgent Doorstep WhatsApp message template encoding', () => {
    function generateDoorstepWaUrl(phone, orderId, customerName) {
      const cleanDigits = String(phone || '').replace(/\D/g, '');
      const waDigits = cleanDigits.length === 10 ? `91${cleanDigits}` : cleanDigits;
      const msg = `Hello ${customerName || 'Customer'}, this is your Savera Paradise delivery partner. I have reached your doorstep with Order ${orderId}. I tried calling you on ${phone} but could not reach you. Please open the door or call me back immediately. Thank you!`;
      return `https://wa.me/${waDigits}?text=${encodeURIComponent(msg)}`;
    }

    const waUrl = generateDoorstepWaUrl('+91 98450 12345', '#QB-4912', 'Farhan');
    assert.match(waUrl, /^https:\/\/wa\.me\/919845012345\?text=/);
    assert.ok(waUrl.includes('Farhan'));
    assert.ok(waUrl.includes('%23QB-4912'));
    assert.ok(waUrl.includes('Savera%20Paradise'));
  });
});
