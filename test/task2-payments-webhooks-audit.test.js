import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('TASK 2 AUDIT: Cashfree Payments, Webhooks, Payouts & CORS Hardening Suite', async (t) => {
  const apiQrJs = fs.readFileSync('api/cashfree-generate-qr.js', 'utf8');
  const funcQrJs = fs.readFileSync('functions/api/cashfree-generate-qr.js', 'utf8');
  const apiWebhookJs = fs.readFileSync('api/cashfree-webhook.js', 'utf8');
  const funcWebhookJs = fs.readFileSync('functions/api/cashfree-webhook.js', 'utf8');
  const apiPayoutJs = fs.readFileSync('api/cashfree-payout.js', 'utf8');
  const funcPayoutJs = fs.readFileSync('functions/api/cashfree-payout.js', 'utf8');
  const apiCashfreeJs = fs.readFileSync('api/_cashfree.js', 'utf8');
  const funcCashfreeJs = fs.readFileSync('functions/api/_cashfree.js', 'utf8');
  const adapterJs = fs.readFileSync('functions/api/_adapter.js', 'utf8');

  await t.test('1. [CRITICAL] cashfree-generate-qr.js fails closed on lookup error and missing order', () => {
    assert.match(apiQrJs, /return res\.status\(500\)\.json\(\{\s*error:\s*['"]Database Error['"]/);
    assert.match(funcQrJs, /return jsonResponse\(\{\s*error:\s*['"]Database Error['"]/);
    assert.match(apiQrJs, /return res\.status\(404\)\.json\(\{\s*error:\s*['"]Not Found['"]/);
    assert.match(funcQrJs, /return jsonResponse\(\{\s*error:\s*['"]Not Found['"]/);
  });

  await t.test('2. [HIGH] api/cashfree-webhook.js exports bodyParser: false and reads exact raw body', () => {
    assert.match(apiWebhookJs, /export\s+const\s+config\s*=\s*\{\s*api:\s*\{\s*bodyParser:\s*false\s*\}\s*\};/);
    assert.match(apiWebhookJs, /async\s+function\s+readRawBody/);
  });

  await t.test('3. [HIGH] cashfree-webhook.js returns 500 on Supabase persistence failures', () => {
    assert.match(apiWebhookJs, /return res\.status\(500\)\.json\(\{\s*success:\s*false,\s*retryable:\s*true/);
    assert.match(funcWebhookJs, /return jsonResponse\(\{\s*success:\s*false,\s*retryable:\s*true/);
  });

  await t.test('4. [HIGH] cashfree-payout.js enforces deterministic idempotency and prevents duplicate rider payouts', () => {
    assert.match(apiPayoutJs, /payout_\$\{cleanPin\}_\$\{cycleDate\}/);
    assert.match(funcPayoutJs, /payout_\$\{cleanPin\}_\$\{cycleDate\}/);
    assert.match(apiPayoutJs, /Duplicate Payout Prevented/);
    assert.match(funcPayoutJs, /Duplicate Payout Prevented/);
  });

  await t.test('5. [HIGH] .pages.dev wildcard is restricted to saveraparadise.pages.dev', () => {
    assert.doesNotMatch(adapterJs, /host\.endsWith\(['"]\.pages\.dev['"]\)\s*\|\|/);
    assert.doesNotMatch(apiCashfreeJs, /host\.endsWith\(['"]\.pages\.dev['"]\)\s*\|\|/);
    assert.doesNotMatch(funcCashfreeJs, /host\.endsWith\(['"]\.pages\.dev['"]\)\s*\|\|/);

    assert.match(adapterJs, /host\s*===\s*['"]saveraparadise\.pages\.dev['"]/);
    assert.match(apiCashfreeJs, /host\s*===\s*['"]saveraparadise\.pages\.dev['"]/);
    assert.match(funcCashfreeJs, /host\s*===\s*['"]saveraparadise\.pages\.dev['"]/);
  });
});
