import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('TASK 1 AUDIT: Backend Order Integrity, RBAC & Checkout Security Suite', async (t) => {
  const apiCheckoutJs = fs.readFileSync('api/checkout.js', 'utf8');
  const funcCheckoutJs = fs.readFileSync('functions/api/checkout.js', 'utf8');
  const apiOrderActionJs = fs.readFileSync('api/order-action.js', 'utf8');
  const funcOrderActionJs = fs.readFileSync('functions/api/order-action.js', 'utf8');
  const apiCashfreeJs = fs.readFileSync('api/_cashfree.js', 'utf8');
  const funcCashfreeJs = fs.readFileSync('functions/api/_cashfree.js', 'utf8');

  await t.test('1. [CRITICAL] checkout.js removes clientOrderThresholdDeal bypass', () => {
    // Both must strictly rely on serverDealsEnabled and eliminate clientOrderThresholdDeal
    assert.doesNotMatch(apiCheckoutJs, /if\s*\(serverDealsEnabled\s*\|\|\s*clientOrderThresholdDeal\)/);
    assert.doesNotMatch(funcCheckoutJs, /if\s*\(serverDealsEnabled\s*\|\|\s*clientOrderThresholdDeal\)/);
    assert.match(apiCheckoutJs, /if\s*\(serverDealsEnabled\)/);
    assert.match(funcCheckoutJs, /if\s*\(serverDealsEnabled\)/);
  });

  await t.test('2. [HIGH] create_order excludes rider role from staff privileges', () => {
    // Neither should include 'rider' in create_order verifyAdminToken calls
    assert.doesNotMatch(apiOrderActionJs, /if\s*\(action\s*===\s*'create_order'\)\s*\{\s*const auth = verifyAdminToken\(req,\s*\[['"]admin['"],\s*['"]owner['"],\s*['"]rider['"]\]\);/);
    assert.doesNotMatch(funcOrderActionJs, /if\s*\(action\s*===\s*'create_order'\)\s*\{\s*const auth = verifyAdminToken\(request,\s*env,\s*\[['"]admin['"],\s*['"]owner['"],\s*['"]rider['"]\]\);/);
    assert.match(apiOrderActionJs, /if\s*\(action\s*===\s*'create_order'\)\s*\{\s*const auth = verifyAdminToken\(req,\s*\[['"]admin['"],\s*['"]owner['"]\]\);/);
    assert.match(funcOrderActionJs, /if\s*\(action\s*===\s*'create_order'\)\s*\{\s*const auth = verifyAdminToken\(request,\s*env,\s*\[['"]admin['"],\s*['"]owner['"]\]\);/);
  });

  await t.test('3. [CRITICAL] update_status blocks rider doorstep_upi / is_paid_online bypass and enforces Cashfree verification', () => {
    // Non-delivered doorstep_upi / is_paid_online mutations must be restricted to owner
    assert.match(apiOrderActionJs, /status !== 'delivered' && typeof doorstepUpi === 'boolean' && auth\.payload\?\.role === 'owner'/);
    assert.match(funcOrderActionJs, /status !== 'delivered' && typeof doorstepUpi === 'boolean' && auth\.payload\?\.role === 'owner'/);
    assert.match(apiOrderActionJs, /typeof isPaidOnline === 'boolean' && auth\.payload\?\.role === 'owner'/);
    assert.match(funcOrderActionJs, /typeof isPaidOnline === 'boolean' && auth\.payload\?\.role === 'owner'/);

    // Delivered verification must check wantsDoorstepUpi without allowing !existing.doorstep_upi bypass
    assert.match(apiOrderActionJs, /const wantsDoorstepUpi = Boolean\(doorstepUpi === true \|\| existing\.doorstep_upi === true\);/);
    assert.match(funcOrderActionJs, /const wantsDoorstepUpi = Boolean\(doorstepUpi === true \|\| existing\.doorstep_upi === true\);/);
  });

  await t.test('4. [HIGH] cancel_order atomically claims cancellation first and uses deterministic refund_id', () => {
    // Deterministic refund_id in _cashfree.js
    assert.doesNotMatch(apiCashfreeJs, /cleanRefundId\s*=\s*`rf_\$\{[^}]+\}_\$\{Date\.now\(\)[^}]*\}`;/);
    assert.doesNotMatch(funcCashfreeJs, /cleanRefundId\s*=\s*`rf_\$\{[^}]+\}_\$\{Date\.now\(\)[^}]*\}`;/);
    assert.match(apiCashfreeJs, /cleanRefundId\s*=\s*`rf_\$\{cleanCfOrderId\.replace\(\/\[\^a-zA-Z0-9_-\]\/g,\s*''\)\.slice\(-24\)\}`;/);
    assert.match(funcCashfreeJs, /cleanRefundId\s*=\s*`rf_\$\{cleanCfOrderId\.replace\(\/\[\^a-zA-Z0-9_-\]\/g,\s*''\)\.slice\(-24\)\}`;/);

    // Atomic update in cancel_order
    assert.match(apiOrderActionJs, /\.neq\('status',\s*'cancelled'\)\s*\.neq\('status',\s*'delivered'\)\s*\.neq\('status',\s*'undelivered'\)/);
    assert.match(funcOrderActionJs, /\.neq\('status',\s*'cancelled'\)\s*\.neq\('status',\s*'delivered'\)\s*\.neq\('status',\s*'undelivered'\)/);
  });

  await t.test('5. [HIGH] kitchen_poll exposes gate for KITCHEN_POLL_SECRET and sanitizes customer_name when unauthenticated', () => {
    assert.match(apiOrderActionJs, /KITCHEN_POLL_SECRET/);
    assert.match(funcOrderActionJs, /KITCHEN_POLL_SECRET/);
    assert.match(apiOrderActionJs, /customer_name:\s*hasAuth\s*\?\s*row\.customer_name\s*:\s*'Customer'/);
    assert.match(funcOrderActionJs, /customer_name:\s*hasAuth\s*\?\s*row\.customer_name\s*:\s*'Customer'/);
  });
});
