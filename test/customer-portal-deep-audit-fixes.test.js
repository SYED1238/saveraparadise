import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sanitizeUrl } from '../securityUtils.js';

test('CUSTOMER PORTAL DEEP AUDIT & PLAYBOOK REGRESSION SUITE', async (t) => {
  const dataServiceJs = fs.readFileSync('dataService.js', 'utf8');
  const mainJs = fs.readFileSync('main.js', 'utf8');
  const securityUtilsJs = fs.readFileSync('securityUtils.js', 'utf8');
  const apiCashfreeJs = fs.readFileSync('api/_cashfree.js', 'utf8');
  const funcCashfreeJs = fs.readFileSync('functions/api/_cashfree.js', 'utf8');
  const apiCreateOrderJs = fs.readFileSync('api/cashfree-create-order.js', 'utf8');
  const funcCreateOrderJs = fs.readFileSync('functions/api/cashfree-create-order.js', 'utf8');
  const apiWebhookJs = fs.readFileSync('api/cashfree-webhook.js', 'utf8');
  const funcWebhookJs = fs.readFileSync('functions/api/cashfree-webhook.js', 'utf8');
  const funcOrderActionJs = fs.readFileSync('functions/api/order-action.js', 'utf8');

  await t.test('1. cashfree-create-order verifies turnstile only on create, and returns 409 conflict on 23505', () => {
    for (const [name, content] of [['api/cashfree-create-order.js', apiCreateOrderJs], ['functions/api/cashfree-create-order.js', funcCreateOrderJs]]) {
      assert.match(content, /if\s*\(action\s*===\s*['"]verify_payment['"]\)\s*\{/, `${name} must handle verify_payment early`);
      assert.match(content, /insertErr\.code\s*===\s*['"]23505['"]\s*\|\|\s*String\(insertErr\.message\s*\|\|\s*['"]['"]\)\.includes\(['"]duplicate key['"]\)/, `${name} must detect duplicate key 23505`);
      assert.match(content, /409/, `${name} must return 409 on order ID conflict`);
      assert.doesNotMatch(content, /insertErr\.code\s*===\s*['"]23505['"][\s\S]*?\.from\(['"]orders['"]\)\.update/, `${name} must never fallback to blind UPDATE on 23505`);
    }
  });

  await t.test('2. cashfree-webhook and verify_payment return 500/503 retryable when order not yet ready or sync fails', () => {
    for (const [name, content] of [['api/cashfree-webhook.js', apiWebhookJs], ['functions/api/cashfree-webhook.js', funcWebhookJs]]) {
      assert.match(content, /if\s*\(!recorded\?\.updated\s*&&\s*!recorded\?\.idempotent\)\s*\{/, `${name} must check updated and idempotent flags`);
      assert.match(content, /retryable:\s*true/, `${name} must return retryable: true for Cashfree webhook retry`);
    }
    for (const [name, content] of [['api/cashfree-create-order.js', apiCreateOrderJs], ['functions/api/cashfree-create-order.js', funcCreateOrderJs]]) {
      assert.match(content, /if\s*\(!recorded\?\.updated\s*&&\s*!recorded\?\.idempotent\)\s*\{[\s\S]*?503/, `${name} must return 503 retryable on order sync pending`);
    }
  });

  await t.test('3. recordVerifiedCashfreePayment rejects zero or underpayment when orderTotal > 0', () => {
    for (const [name, content] of [['api/_cashfree.js', apiCashfreeJs], ['functions/api/_cashfree.js', funcCashfreeJs]]) {
      assert.match(content, /paymentAmount\s*<=\s*0\s*\|\|\s*paymentAmount\s*<\s*orderTotal/, `${name} must reject zero or underpaid amounts`);
    }
  });

  await t.test('4. quickbite-kitchen-broadcast isolates customer portal from staff events and other orders', () => {
    assert.match(dataServiceJs, /if\s*\(this\.portalType\s*===\s*['"]customer['"]\s*\|\|\s*!this\.isStaffAuthorized\(\)\)\s*return;/, 'new_order broadcast must be ignored by customer portal');
    assert.match(dataServiceJs, /if\s*\(this\.portalType\s*===\s*['"]customer['"]\)\s*\{[\s\S]*?const myIds\s*=\s*new Set\(this\.getMyOrderIds\(\)/, 'rider_location broadcast must be filtered to current customer orders');
  });

  await t.test('5. securityUtils.js sanitizes control char URLs and data URIs', () => {
    // Test XSS control character stripping
    assert.equal(sanitizeUrl('java\tscript:alert(1)'), '#', 'Must reject javascript: with embedded tab');
    assert.equal(sanitizeUrl('\u0001javascript:alert(1)'), '#', 'Must reject javascript: with control char');
    assert.equal(sanitizeUrl('javascript:alert(1)'), '#', 'Must reject plain javascript:');
    assert.equal(sanitizeUrl('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='), '#', 'Must reject text/html data URI');
    assert.equal(sanitizeUrl('https://foodbliz.in'), 'https://foodbliz.in', 'Must allow legitimate https URL');
  });

  await t.test('6. functions/api/order-action.js getKitchenPollCacheRequest forces pathname = /api/order-action', () => {
    assert.match(funcOrderActionJs, /cacheUrl\.pathname\s*=\s*['"]\/api\/order-action['"]/, 'Purge cache request must set pathname to /api/order-action');
  });

  await t.test('7. dataService.syncUserAddressesFromSupabase preserves null for unpinned coordinates', () => {
    assert.match(dataServiceJs, /lat:\s*\(row\.lat !== null && row\.lat !== undefined && !isNaN\(Number\(row\.lat\)\) && Number\(row\.lat\) !== 0\)\s*\?\s*Number\(row\.lat\)\s*:\s*null/, 'Unpinned lat must be preserved as null');
    assert.match(dataServiceJs, /lng:\s*\(row\.lng !== null && row\.lng !== undefined && !isNaN\(Number\(row\.lng\)\) && Number\(row\.lng\) !== 0\)\s*\?\s*Number\(row\.lng\)\s*:\s*null/, 'Unpinned lng must be preserved as null');
  });

  await t.test('8. Navigation Back & Address Sync Integrity', () => {
    assert.match(mainJs, /await dataService\.syncUserAddressesFromSupabase/, 'Google OAuth return must await address sync');
    assert.match(mainJs, /else if\s*\(event\s*===\s*['"]SIGNED_IN['"]\)\s*\{[\s\S]*?checkAndShowGenderPrompt\(\);/, 'checkAndShowGenderPrompt must only trigger on SIGNED_IN, not USER_UPDATED');
    assert.match(dataServiceJs, /oldDefaultPrefixes\s*=\s*\[[\s\S]*?'dish-chicken-hyd-biryani'[\s\S]*?'dish-mutton-'[\s\S]*?'dish-grill-mandi'[\s\S]*?'dish-tandoori-chick-half'/, 'dataService must clean all 4 legacy dish prefixes to stop reset loop');
  });
});
