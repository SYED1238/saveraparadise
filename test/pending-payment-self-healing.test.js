import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  reconcilePendingCashfreeOrders as nodeReconcilePending
} from '../api/_cashfree.js';
import {
  reconcilePendingCashfreeOrders as cfReconcilePending
} from '../functions/api/_cashfree.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function createMockSupabase(initialOrders = []) {
  const rows = initialOrders.map(o => ({ ...o }));

  function makeQuery() {
    const state = { filters: [], limitCount: null, updatePayload: null, mode: 'select' };
    const exec = () => {
      let matched = rows.filter(r =>
        state.filters.every(fn => fn(r))
      );
      if (state.mode === 'update' && state.updatePayload) {
        matched = matched.map(r => {
          Object.assign(r, state.updatePayload);
          return { ...r };
        });
      }
      if (typeof state.limitCount === 'number') {
        matched = matched.slice(0, state.limitCount);
      }
      return { data: matched, error: null };
    };

    const builder = {
      select() { return builder; },
      eq(col, val) {
        state.filters.push(r => r[col] === val);
        return builder;
      },
      or(expr) {
        const parts = String(expr || '').split(',');
        state.filters.push(r => parts.some(p => {
          const [c, op, ...rest] = p.split('.');
          if (op === 'eq') return String(r[c]) === rest.join('.');
          return false;
        }));
        return builder;
      },
      order(col, opts = {}) {
        const asc = opts.ascending !== false;
        rows.sort((a, b) => asc ? (a[col] - b[col]) : (b[col] - a[col]));
        return builder;
      },
      limit(n) {
        state.limitCount = n;
        return builder;
      },
      update(payload) {
        state.mode = 'update';
        state.updatePayload = payload;
        return builder;
      },
      async maybeSingle() {
        const res = exec();
        return { data: res.data[0] || null, error: null };
      },
      async single() {
        const res = exec();
        return { data: res.data[0] || null, error: res.data[0] ? null : { message: 'Not found' } };
      },
      then(resolve, reject) {
        try {
          resolve(exec());
        } catch (err) {
          if (reject) reject(err);
        }
      }
    };
    return builder;
  }

  return {
    rows,
    from(table) {
      assert.strictEqual(table, 'orders');
      return makeQuery();
    }
  };
}

describe('PENDING PAYMENT SELF-HEALING & TRACKER INTEGRITY', () => {
  for (const [label, reconcileFn] of [
    ['api/_cashfree.js', nodeReconcilePending],
    ['functions/api/_cashfree.js', cfReconcilePending]
  ]) {
    test(`${label}: promotes recent paid pending_payment order and returns updated row`, async () => {
      const now = Date.now();
      const sb = createMockSupabase([
        {
          id: '#QB-5333',
          status: 'pending_payment',
          status_label: 'Awaiting Payment',
          payment_method: 'Online',
          payment_status: 'Pending Payment',
          is_paid_online: false,
          total: '₹342',
          cash_collected: 0,
          cf_order_id: 'qb_QB-5333_test1',
          cf_payment_id: null,
          cf_payment_status: 'PENDING',
          created_at: now - 5 * 60 * 1000
        },
        {
          id: '#QB-DOOR',
          status: 'pending_payment',
          total: '₹200',
          cf_order_id: 'qb_doorstep_QB-DOOR_1234',
          created_at: now - 2 * 60 * 1000
        },
        {
          id: '#QB-OLD',
          status: 'pending_payment',
          total: '₹250',
          cf_order_id: 'qb_QB-OLD_1111',
          created_at: now - 5 * 60 * 60 * 1000
        }
      ]);

      let calls = 0;
      const res = await reconcileFn({
        sb,
        orders: null,
        maxChecks: 3,
        cooldownMs: 30000,
        maxAgeMs: 2 * 60 * 60 * 1000,
        verifyPaymentFn: async ({ cfOrderId }) => {
          calls += 1;
          assert.strictEqual(cfOrderId, 'qb_QB-5333_test1');
          return {
            success: true,
            paid: true,
            cfOrderId,
            cfPaymentId: '7101439487',
            paymentStatus: 'SUCCESS',
            paymentAmount: 342
          };
        }
      });

      assert.strictEqual(calls, 1, 'Must check only eligible non-doorstep recent pending_payment order');
      assert.deepStrictEqual(res.promotedIds, ['#QB-5333']);
      const saved = sb.rows.find(r => r.id === '#QB-5333');
      assert.strictEqual(saved.status, 'accepted');
      assert.strictEqual(saved.status_label, 'Accepted');
      assert.strictEqual(saved.payment_status, 'Paid');
      assert.strictEqual(saved.payment_method, 'Online');
      assert.strictEqual(saved.is_paid_online, true);
      assert.strictEqual(saved.cf_payment_id, '7101439487');
      assert.strictEqual(saved.cf_payment_status, 'SUCCESS');
    });

    test(`${label}: enforces per-cf_order_id cooldown and rejects underpaid amounts`, async () => {
      const now = Date.now();
      const sb = createMockSupabase([
        {
          id: '#QB-LOW',
          status: 'pending_payment',
          payment_status: 'Pending Payment',
          is_paid_online: false,
          total: '₹342',
          cf_order_id: 'qb_QB-LOW_9001',
          created_at: now - 60 * 1000
        }
      ]);

      let calls = 0;
      const verifyPaymentFn = async ({ cfOrderId }) => {
        calls += 1;
        return {
          success: true,
          paid: true,
          cfOrderId,
          cfPaymentId: 'pay_underpaid',
          paymentStatus: 'SUCCESS',
          paymentAmount: 100
        };
      };

      const first = await reconcileFn({
        sb,
        orders: sb.rows,
        cooldownMs: 30000,
        verifyPaymentFn
      });
      assert.strictEqual(first.checked, 1);
      assert.deepStrictEqual(first.promotedIds, [], 'Underpaid payment must NOT promote order');
      assert.strictEqual(sb.rows[0].status, 'pending_payment');

      const second = await reconcileFn({
        sb,
        orders: sb.rows,
        cooldownMs: 30000,
        verifyPaymentFn
      });
      assert.strictEqual(second.checked, 0, 'Cooldown must skip repeat Cashfree call within cooldownMs');
      assert.strictEqual(calls, 1);
    });

    test(`${label}: no-ops cleanly without Cashfree credentials when allowMock is false`, async () => {
      const sb = createMockSupabase([
        {
          id: '#QB-NO-CREDS',
          status: 'pending_payment',
          total: '₹342',
          cf_order_id: 'qb_QB-NO-CREDS_1',
          created_at: Date.now()
        }
      ]);
      const res = await reconcileFn({ sb, orders: sb.rows, env: {} });
      assert.strictEqual(res.checked, 0);
      assert.deepStrictEqual(res.promotedIds, []);
      assert.strictEqual(sb.rows[0].status, 'pending_payment');
    });
  }

  test('main.js never renders pending_payment as "Order Confirmed & Sizzling!" or active confirmed order', () => {
    const mainJs = fs.readFileSync(path.join(rootDir, 'main.js'), 'utf8');
    assert.match(mainJs, /const\s+isPendingPayment\s*=\s*order\.status\s*===\s*'pending_payment'/);
    assert.match(mainJs, /else\s+if\s*\(isPendingPayment\)\s*\{[\s\S]*?Awaiting Payment Confirmation/);
    assert.match(mainJs, /'pending_payment'\s*:\s*-3/);
    assert.match(mainJs, /getCustomerOrders\([^)]*\)[\s\S]*?filter\(\s*o\s*=>\s*o\s*&&\s*o\.status\s*!==\s*'pending_payment'\s*\)/);
  });

  test('main.js verifies Cashfree payment on cfResult.error and auto-recovers pending orders on resume/startup', () => {
    const mainJs = fs.readFileSync(path.join(rootDir, 'main.js'), 'utf8');
    assert.match(mainJs, /if\s*\(cfResult\s*&&\s*cfResult\.error\)\s*\{[\s\S]*?action:\s*'verify_payment'[\s\S]*?finalizeVerifiedOnlineOrder\(vData\.order,\s*newOrder,\s*newOrder\.id\)/);
    assert.match(mainJs, /async\s+function\s+recoverPendingOnlinePaymentIfAny\(\)/);
    assert.match(mainJs, /visibilitychange[\s\S]*?recoverPendingOnlinePaymentIfAny\(\)/);
  });

  test('dataService.js filters pending_payment out of synced customer order list', () => {
    const dataServiceJs = fs.readFileSync(path.join(rootDir, 'dataService.js'), 'utf8');
    assert.match(dataServiceJs, /data\s*=\s*data\.filter\(\s*o\s*=>\s*o\s*&&\s*o\.status\s*!==\s*'pending_payment'\s*\)/);
  });

  test('api/order-action.js and functions/api/order-action.js both reconcile pending Cashfree payments', () => {
    const nodeOrderAction = fs.readFileSync(path.join(rootDir, 'api', 'order-action.js'), 'utf8');
    const cfOrderAction = fs.readFileSync(path.join(rootDir, 'functions', 'api', 'order-action.js'), 'utf8');
    for (const [name, src] of [['api/order-action.js', nodeOrderAction], ['functions/api/order-action.js', cfOrderAction]]) {
      const matches = src.match(/reconcilePendingCashfreeOrders/g) || [];
      assert.ok(matches.length >= 4, `${name} must import and invoke reconcilePendingCashfreeOrders in kitchen_poll, sync_orders, and track_orders`);
    }
  });
});
