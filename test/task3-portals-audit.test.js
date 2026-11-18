import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('TASK 3 AUDIT: Frontend Portals Return Flow, Delivery UI, Owner Report & PIN Security Suite', async (t) => {
  const deliveryJs = fs.readFileSync('delivery.js', 'utf8');
  const ownerJs = fs.readFileSync('owner.js', 'utf8');
  const securityUtilsJs = fs.readFileSync('securityUtils.js', 'utf8');

  await t.test('1. [CRITICAL] delivery.js normalizes # prefix for currentDoorstepCashfreeSession check', () => {
    assert.doesNotMatch(deliveryJs, /currentDoorstepCashfreeSession\.orderId\s*!==\s*order\.id/);
    assert.match(deliveryJs, /String\(currentDoorstepCashfreeSession\.orderId\s*\|\|\s*''\)\.replace\(\/\^#\/,\s*''\)\s*!==\s*String\(order\.id\s*\|\|\s*''\)\.replace\(\/\^#\/,\s*''\)/);
  });

  await t.test('2. [HIGH] delivery.js re-enables btnCnrSafedrop in finally and in openUnreachableModal', () => {
    assert.match(deliveryJs, /finally\s*\{\s*if\s*\(btnCnrSafedrop\)\s*btnCnrSafedrop\.disabled\s*=\s*false;/);
    assert.match(deliveryJs, /function openUnreachableModal[\s\S]*?btnCnrSafedrop\.disabled\s*=\s*false;/);
  });

  await t.test('3. [HIGH] delivery.js prevents double-submit race on CNR return-to-kitchen with isSubmittingCnr guard', () => {
    assert.match(deliveryJs, /let isSubmittingCnr = false;/);
    assert.match(deliveryJs, /btnCnrReturnCod\.disabled = isSubmittingCnr \|\| !isWaitComplete;/);
    assert.match(deliveryJs, /btnCnrReturnPrepaid\.disabled = isSubmittingCnr \|\| !isWaitComplete;/);
  });

  await t.test('4. [HIGH] owner.js printCalendarReport includes undelivered orders in rider payouts', () => {
    assert.match(ownerJs, /const payoutOrders = \[\];/);
    assert.match(ownerJs, /else if \(st === 'undelivered'\)\s*\{\s*payoutOrders\.push\(o\);/);
    assert.match(ownerJs, /payoutOrders\.forEach\(o => \{/);
  });

  await t.test('5. [HIGH] securityUtils.js rider auth fails closed without hardcoded fallback bypass', () => {
    assert.doesNotMatch(securityUtilsJs, /DEFAULT_RIDER_PIN_HASHES\.includes\(/);
    assert.match(securityUtilsJs, /if \(res\.status === 401 \|\| res\.status === 403\) \{\s*\/\/\s*Server explicitly rejected or deactivated this rider\s*return false;\s*\}/);
  });
});
