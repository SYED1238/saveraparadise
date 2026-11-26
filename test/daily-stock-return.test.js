import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import apiAdminStoreHandler from '../api/admin-store.js';
import { onRequest as cfAdminStoreHandler } from '../functions/api/admin-store.js';
import apiCheckoutHandler from '../api/checkout.js';
import { onRequest as cfCheckoutHandler } from '../functions/api/checkout.js';
import { createAdminToken } from '../api/_auth.js';

const store = new Map();
if (!globalThis.localStorage) {
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; }
  };
}

let DEFAULT_SETTINGS;
let dataService;
let getOperationalDayKey;
let resolveEffectiveDishInStock;
let supabaseClient;
let originalSupabaseFrom;
let customSupabaseFrom = null;

const createMockSupabaseChain = (result = { data: [], error: null }) => {
  const chain = {
    select: () => chain,
    insert: () => chain,
    upsert: () => chain,
    update: () => chain,
    delete: () => chain,
    eq: () => chain,
    neq: () => chain,
    in: () => chain,
    or: () => chain,
    order: () => chain,
    limit: () => chain,
    single: async () => ({ data: null, error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject)
  };
  return chain;
};

const rootDir = process.cwd();
const readProjectFile = (relPath) => fs.readFileSync(path.resolve(rootDir, relPath), 'utf8');

function createMockReqRes({ method = 'POST', headers = {}, body = {}, url = '/api/admin-store' } = {}) {
  const req = { method, headers, body, query: {}, url };
  const resHeaders = {};
  const res = {
    statusCode: 200,
    responseData: null,
    setHeader: (name, value) => { resHeaders[name.toLowerCase()] = value; },
    getHeader: (name) => resHeaders[name.toLowerCase()],
    status: (code) => {
      res.statusCode = code;
      return res;
    },
    json: (data) => {
      res.responseData = data;
      return res;
    },
    end: () => res
  };
  return { req, res };
}

describe('Daily Return-to-Stock Toggle (1:00 AM IST Rollover & Dual-API Parity)', () => {
  before(async () => {
    const sbMod = await import('../supabaseClient.js');
    supabaseClient = sbMod.supabase;
    if (supabaseClient && typeof supabaseClient.from === 'function') {
      originalSupabaseFrom = supabaseClient.from.bind(supabaseClient);
      supabaseClient.from = (table) => {
        if (typeof customSupabaseFrom === 'function') {
          return customSupabaseFrom(table);
        }
        return createMockSupabaseChain();
      };
    }
    const mod = await import('../dataService.js');
    DEFAULT_SETTINGS = mod.DEFAULT_SETTINGS;
    dataService = mod.dataService;
    getOperationalDayKey = mod.getOperationalDayKey;
    resolveEffectiveDishInStock = mod.resolveEffectiveDishInStock;
  });

  after(() => {
    customSupabaseFrom = null;
    if (supabaseClient && originalSupabaseFrom) {
      supabaseClient.from = originalSupabaseFrom;
    }
  });

  afterEach(() => {
    customSupabaseFrom = null;
    if (globalThis.localStorage) globalThis.localStorage.clear();
    if (dataService) {
      dataService.dishesCache = null;
      dataService.categoriesCache = null;
      dataService._lastDishesEffectiveSig = null;
      dataService._reconciledDailyBatchKey = null;
      dataService._inFlightDailyReconcile = null;
      dataService._isSyncingDishes = null;
      dataService._lastDishesSyncTime = 0;
      dataService._isSyncingSettings = null;
      dataService._lastSettingsSyncTime = 0;
    }
  });

  it('1. DEFAULT_SETTINGS defines returnStockEveryDay: false and returnStockEnabledDate: null', () => {
    assert.strictEqual(DEFAULT_SETTINGS.returnStockEveryDay, false);
    assert.strictEqual(DEFAULT_SETTINGS.returnStockEnabledDate, null);
    assert.strictEqual(dataService.isReturnStockEveryDay(), false);
  });

  it('2. getOperationalDayKey follows Savera 1:00 AM IST daily shift boundary', () => {
    // 2026-11-26 23:30 IST -> 2026-11-26
    assert.strictEqual(getOperationalDayKey(Date.parse('2026-11-26T18:00:00Z')), '2026-11-26');
    // 2026-11-27 00:59 IST -> still 2026-11-26 dinner shift
    assert.strictEqual(getOperationalDayKey(Date.parse('2026-11-26T19:29:00Z')), '2026-11-26');
    // 2026-11-27 01:01 IST -> flips to 2026-11-27
    assert.strictEqual(getOperationalDayKey(Date.parse('2026-11-26T19:31:00Z')), '2026-11-27');
    // 2026-11-27 09:30 IST -> 2026-11-27
    assert.strictEqual(getOperationalDayKey(Date.parse('2026-11-27T04:00:00Z')), '2026-11-27');
  });

  it('3. resolveEffectiveDishInStock keeps OOS today, restocks automatically next day when ON, and never auto-restocks when OFF', () => {
    const day1Dinner = Date.parse('2026-11-26T16:00:00Z'); // 21:30 IST on 2026-11-26
    const day1LateNight = Date.parse('2026-11-26T19:15:00Z'); // 00:45 IST on 2026-11-27 (still 2026-11-26 shift)
    const day2Morning = Date.parse('2026-11-27T03:30:00Z'); // 09:00 IST on 2026-11-27

    const dishOosDay1 = { id: 'd1', inStock: false, stockOutDate: '2026-11-26' };
    const dishLegacyNoStamp = { id: 'd2', inStock: false, stockOutDate: null };

    // Toggle OFF -> permanently Out of Stock across days
    const settingsOff = { returnStockEveryDay: false, returnStockEnabledDate: null };
    assert.strictEqual(resolveEffectiveDishInStock(dishOosDay1, settingsOff, day1Dinner), false);
    assert.strictEqual(resolveEffectiveDishInStock(dishOosDay1, settingsOff, day2Morning), false);

    // Toggle ON anchored on 2026-11-26 -> Day 1 stays OOS (even at 00:45 AM), Day 2 morning returns In Stock!
    const settingsOnDay1 = { returnStockEveryDay: true, returnStockEnabledDate: '2026-11-26' };
    assert.strictEqual(resolveEffectiveDishInStock(dishOosDay1, settingsOnDay1, day1Dinner), false);
    assert.strictEqual(resolveEffectiveDishInStock(dishOosDay1, settingsOnDay1, day1LateNight), false);
    assert.strictEqual(resolveEffectiveDishInStock(dishOosDay1, settingsOnDay1, day2Morning), true);

    // Legacy OOS item with no stockOutDate stays OOS on the day toggle was enabled, then returns next day
    assert.strictEqual(resolveEffectiveDishInStock(dishLegacyNoStamp, settingsOnDay1, day1Dinner), false);
    assert.strictEqual(resolveEffectiveDishInStock(dishLegacyNoStamp, settingsOnDay1, day2Morning), true);
  });

  it('4. dataService toggleDishStock stamps stockOutDate, setReturnStockEveryDay settles & toggles cleanly', async () => {
    const dish = await dataService.addDish({ name: 'Daily Reset Biryani', price: 250, category: 'biryani', inStock: true });
    assert.ok(dish?.id);

    const toggledOut = await dataService.toggleDishStock(dish.id);
    assert.strictEqual(toggledOut.inStock, false);
    assert.strictEqual(toggledOut.rawInStock, false);
    assert.strictEqual(toggledOut.stockOutDate, getOperationalDayKey());

    // Toggle back IN stock clears stockOutDate
    const toggledBack = await dataService.toggleDishStock(dish.id);
    assert.strictEqual(toggledBack.inStock, true);
    assert.strictEqual(toggledBack.rawInStock, true);
    assert.strictEqual(toggledBack.stockOutDate, null);

    // Simulate yesterday OOS dish + toggle ON yesterday -> getDishes resolves In Stock today
    const day1 = Date.parse('2026-11-20T10:00:00Z');
    const day2 = Date.parse('2026-11-21T10:00:00Z');
    dataService.setReturnStockEveryDay(true, day1);
    assert.strictEqual(dataService.isReturnStockEveryDay(), true);

    const dishes = dataService.getDishes();
    const target = dishes.find((d) => d.id === dish.id);
    target.rawInStock = false;
    target.inStock = false;
    target.stockOutDate = getOperationalDayKey(day1);
    dataService.saveDishes(dishes);

    // Recompute on day2 -> dish returns In Stock
    dataService.refreshDishesEffectiveStock(null, day2);
    const refreshed = dataService.getDishById(dish.id);
    assert.strictEqual(refreshed.inStock, true);

    // Turning OFF settles expired OOS item rather than reverting it to sold-out
    dataService.setReturnStockEveryDay(false, day2);
    assert.strictEqual(dataService.isReturnStockEveryDay(), false);
    const afterOff = dataService.getDishById(dish.id);
    assert.strictEqual(afterOff.inStock, true);
  });

  it('5. Dual-API admin-store protects restock_daily with RBAC and handles toggle_stock stock_out_date', async () => {
    const prevSecret = process.env.SESSION_SECRET;
    const prevSbUrl = process.env.SUPABASE_URL;
    const prevViteUrl = process.env.VITE_SUPABASE_URL;
    const prevSrvKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const prevSrvKey2 = process.env.SUPABASE_SERVICE_KEY;

    const testSecret = 'test_session_secret_32_characters_long_secure_key!';
    process.env.SESSION_SECRET = testSecret;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_KEY;

    const mockEnv = { SESSION_SECRET: testSecret, NODE_ENV: 'test', ENVIRONMENT: 'test' };
    const adminToken = createAdminToken('admin');
    const riderToken = createAdminToken('rider', '2233');

    try {
      // Unauthenticated restock_daily -> 401
      const unauth = createMockReqRes({ body: { action: 'restock_daily', ids: ['d1'] } });
      await apiAdminStoreHandler(unauth.req, unauth.res);
      assert.strictEqual(unauth.res.statusCode, 401);

      // Rider restock_daily -> rejected at token role check (401 Insufficient permissions)
      const riderNode = createMockReqRes({
        headers: { authorization: `Bearer ${riderToken}` },
        body: { action: 'restock_daily', ids: ['d1'] }
      });
      await apiAdminStoreHandler(riderNode.req, riderNode.res);
      assert.strictEqual(riderNode.res.statusCode, 401);
      assert.match(String(riderNode.res.responseData?.error || ''), /Insufficient permissions/i);

      const riderCfRes = await cfAdminStoreHandler({
        request: new Request('http://localhost/api/admin-store', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${riderToken}` },
          body: JSON.stringify({ action: 'restock_daily', ids: ['d1'] })
        }),
        env: mockEnv
      });
      assert.strictEqual(riderCfRes.status, 401);

      // Admin restock_daily empty ids -> 400
      const emptyNode = createMockReqRes({
        headers: { authorization: `Bearer ${adminToken}` },
        body: { action: 'restock_daily', ids: [] }
      });
      await apiAdminStoreHandler(emptyNode.req, emptyNode.res);
      assert.strictEqual(emptyNode.res.statusCode, 400);

      // Admin restock_daily valid ids -> 200 on both Node and Cloudflare
      const okNode = createMockReqRes({
        headers: { authorization: `Bearer ${adminToken}` },
        body: { action: 'restock_daily', ids: ['dish-a', 'dish-b'] }
      });
      await apiAdminStoreHandler(okNode.req, okNode.res);
      assert.strictEqual(okNode.res.statusCode, 200);
      assert.strictEqual(okNode.res.responseData?.restockedCount, 2);

      const okCfRes = await cfAdminStoreHandler({
        request: new Request('http://localhost/api/admin-store', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ action: 'restock_daily', ids: ['dish-a', 'dish-b'] })
        }),
        env: mockEnv
      });
      assert.strictEqual(okCfRes.status, 200);
      const okCfJson = await okCfRes.json();
      assert.strictEqual(okCfJson.restockedCount, 2);

      // Admin toggle_stock echoes stock_out_date cleanly
      const stockNode = createMockReqRes({
        headers: { authorization: `Bearer ${adminToken}` },
        body: { action: 'toggle_stock', id: 'dish-a', in_stock: false, stock_out_date: '2026-11-26' }
      });
      await apiAdminStoreHandler(stockNode.req, stockNode.res);
      assert.strictEqual(stockNode.res.statusCode, 200);
      assert.strictEqual(stockNode.res.responseData?.data?.[0]?.stock_out_date, '2026-11-26');
    } finally {
      if (prevSecret !== undefined) process.env.SESSION_SECRET = prevSecret; else delete process.env.SESSION_SECRET;
      if (prevSbUrl !== undefined) process.env.SUPABASE_URL = prevSbUrl;
      if (prevViteUrl !== undefined) process.env.VITE_SUPABASE_URL = prevViteUrl;
      if (prevSrvKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = prevSrvKey;
      if (prevSrvKey2 !== undefined) process.env.SUPABASE_SERVICE_KEY = prevSrvKey2;
    }
  });

  it('6. Dual-API checkout allows prior-day OOS item only when returnStockEveryDay is ON, blocking same-day or toggle-OFF OOS', async () => {
    const todayKey = getOperationalDayKey(Date.now());
    const yesterdayKey = getOperationalDayKey(Date.now() - 24 * 60 * 60 * 1000);

    const prevSecret = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = 'test_session_secret_32_characters_long_secure_key!';
    const mockEnv = { SESSION_SECRET: process.env.SESSION_SECRET, NODE_ENV: 'test', ENVIRONMENT: 'test' };

    const makeBody = (stockOutDate, returnStockEveryDay) => ({
      items: [{ id: 'dish-daily-chk', name: 'Special Kebab', qty: 1, price: 220 }],
      catalogDishes: [{
        id: 'dish-daily-chk',
        name: 'Special Kebab',
        price: 220,
        in_stock: false,
        stock_out_date: stockOutDate
      }],
      storeSettings: {
        returnStockEveryDay,
        returnStockEnabledDate: yesterdayKey,
        minOrderValue: 0
      },
      userPhone: '9876543210',
      lat: 12.7209,
      lng: 77.2805
    });

    try {
      // Case A: returnStockEveryDay = false, yesterday's OOS -> blocked (400)
      const offNode = createMockReqRes({ url: '/api/checkout', body: makeBody(yesterdayKey, false) });
      await apiCheckoutHandler(offNode.req, offNode.res);
      assert.strictEqual(offNode.res.statusCode, 400);

      const offCf = await cfCheckoutHandler({
        request: new Request('http://127.0.0.1/api/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(makeBody(yesterdayKey, false))
        }),
        env: mockEnv
      });
      assert.strictEqual(offCf.status, 400);

      // Case B: returnStockEveryDay = true, SAME DAY OOS -> blocked (400)
      const sameDayNode = createMockReqRes({ url: '/api/checkout', body: makeBody(todayKey, true) });
      await apiCheckoutHandler(sameDayNode.req, sameDayNode.res);
      assert.strictEqual(sameDayNode.res.statusCode, 400);

      // Case C: returnStockEveryDay = true, YESTERDAY OOS -> succeeds (200) on BOTH Node & Cloudflare!
      const nextDayNode = createMockReqRes({ url: '/api/checkout', body: makeBody(yesterdayKey, true) });
      await apiCheckoutHandler(nextDayNode.req, nextDayNode.res);
      assert.strictEqual(nextDayNode.res.statusCode, 200);
      assert.ok(nextDayNode.res.responseData?.checkoutToken);

      const nextDayCf = await cfCheckoutHandler({
        request: new Request('http://127.0.0.1/api/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(makeBody(yesterdayKey, true))
        }),
        env: mockEnv
      });
      assert.strictEqual(nextDayCf.status, 200);
      const cfData = await nextDayCf.json();
      assert.ok(cfData.checkoutToken);
    } finally {
      if (prevSecret !== undefined) process.env.SESSION_SECRET = prevSecret; else delete process.env.SESSION_SECRET;
    }
  });

  it('7. Migration 18 and Admin Portal UI contain Return Stock Every Day toggle above menu and SQL schema', () => {
    const migSql = readProjectFile('supabase_migration_18_stock_out_date.sql');
    const rbSql = readProjectFile('supabase_rollback_18_stock_out_date.sql');
    const setupSql = readProjectFile('supabase_setup.sql');
    const adminHtml = readProjectFile('admin.html');
    const adminCss = readProjectFile('admin.css');
    const adminJs = readProjectFile('admin.js');

    assert.match(migSql, /ALTER TABLE public\.dishes ADD COLUMN IF NOT EXISTS stock_out_date TEXT DEFAULT NULL/i);
    assert.match(rbSql, /DROP COLUMN IF EXISTS stock_out_date/i);
    assert.match(setupSql, /public\.dishes ADD COLUMN IF NOT EXISTS stock_out_date TEXT DEFAULT NULL/i);

    assert.match(adminHtml, /id="admin-daily-restock-bar"/);
    assert.match(adminHtml, /id="btn-admin-return-stock-daily"/);
    assert.match(adminCss, /\.admin-daily-restock-bar\s*\{/);
    assert.match(adminCss, /\.btn-daily-restock-toggle\.is-enabled\s*\{/);
    assert.match(adminJs, /function updateReturnStockDailyUI\(/);
    assert.match(adminJs, /async function toggleReturnStockEveryDay\(/);
    assert.match(adminJs, /reconcileDailyStockIfNeeded/);
  });

  it('8. Regression fixes: syncDishesFromSupabase preserves null stock_out_date & waits for settings; reconcileDailyStockIfNeeded prevents local/DB divergence; update_category handles 42703 fallback', async () => {
    // 8a: syncDishesFromSupabase honors explicit stock_out_date: null instead of resurrecting stale localMatch.stockOutDate
    // and avoids reconciling with stale settings when _lastSettingsSyncTime === 0
    const prevPortalType = dataService.portalType;
    const origIsStaffAuth = dataService.isStaffAuthorized.bind(dataService);
    const origAdminStoreAction = dataService._adminStoreAction.bind(dataService);
    const origSaveSettings = dataService.saveSettings.bind(dataService);
    const origReconcile = dataService.reconcileDailyStockIfNeeded.bind(dataService);
    const hasWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
    const prevWindow = globalThis.window;

    try {
      dataService.saveDishes([
        { id: 'sync-null-1', name: 'Null Date Dish', price: 200, category: 'biryani', inStock: false, rawInStock: false, stockOutDate: '2026-11-20' }
      ]);

      let settingsWaitFinished = false;
      dataService._lastSettingsSyncTime = 0;
      dataService._isSyncingSettings = new Promise((resolve) => {
        setTimeout(() => {
          settingsWaitFinished = true;
          resolve(dataService.getSettings());
        }, 15);
      });

      customSupabaseFrom = (table) => {
        if (table === 'dishes') {
          return createMockSupabaseChain({
            data: [{
              id: 'sync-null-1',
              name: 'Null Date Dish',
              price: 200,
              category: 'biryani',
              in_stock: false,
              stock_out_date: null
            }],
            error: null
          });
        }
        return createMockSupabaseChain();
      };

      await dataService.syncDishesFromSupabase(true);
      assert.strictEqual(settingsWaitFinished, true, 'syncDishesFromSupabase waits for in-flight settings sync');
      const syncedDish = dataService.getDishById('sync-null-1');
      assert.strictEqual(syncedDish.stockOutDate, null, 'explicit null stock_out_date must not fall back to stale local stockOutDate');

      // 8b: In authorized browser mode, reconcileDailyStockIfNeeded must NOT mutate local dish cache when restock_daily fails
      globalThis.window = globalThis;
      dataService.portalType = 'admin';
      dataService.isStaffAuthorized = () => true;

      const yesterdayKey = getOperationalDayKey(Date.now() - 24 * 60 * 60 * 1000);
      dataService.saveDishes([
        { id: 'fail-reconcile-1', name: 'Fail Reconcile Dish', price: 180, category: 'kebab', inStock: false, rawInStock: false, stockOutDate: yesterdayKey }
      ]);
      const baseSettings = { ...dataService.getSettings(), returnStockEveryDay: true, returnStockEnabledDate: yesterdayKey };
      localStorage.setItem('quickbite_settings', JSON.stringify(baseSettings));
      dataService._lastSettingsSyncTime = Date.now();

      let reconcileActionCalls = 0;
      dataService._adminStoreAction = async () => {
        reconcileActionCalls += 1;
        await new Promise((r) => setTimeout(r, 20));
        throw new Error('Simulated 500 error');
      };
      const [failResA, failResB] = await Promise.all([
        dataService.reconcileDailyStockIfNeeded(Date.now()),
        dataService.reconcileDailyStockIfNeeded(Date.now())
      ]);
      assert.strictEqual(reconcileActionCalls, 1, 'concurrent reconcile calls must share one in-flight request');
      assert.deepStrictEqual(failResA.restockedIds, []);
      assert.deepStrictEqual(failResB.restockedIds, []);
      assert.strictEqual(dataService.getDishById('fail-reconcile-1').rawInStock, false, 'failed server restock must not permanently set rawInStock: true locally (even across overlapping calls)');

      // 8c: setReturnStockEveryDay(false) in authorized browser mode waits for saveSettings cloud sync before calling reconcile
      const callOrder = [];
      dataService.saveSettings = async (updated) => {
        callOrder.push('saveSettings_fail');
        return { ...updated, _syncedToCloud: false };
      };
      dataService.reconcileDailyStockIfNeeded = async () => {
        callOrder.push('reconcile');
        return { restockedIds: [] };
      };
      const failedOffRes = await dataService.setReturnStockEveryDay(false, Date.now());
      assert.strictEqual(failedOffRes._syncedToCloud, false);
      assert.deepStrictEqual(callOrder, ['saveSettings_fail'], 'must not settle daily stock when saveSettings fails');

      callOrder.length = 0;
      dataService.saveSettings = async (updated) => {
        callOrder.push('saveSettings_ok');
        return { ...updated, _syncedToCloud: true };
      };
      const okOffRes = await dataService.setReturnStockEveryDay(false, Date.now());
      assert.strictEqual(okOffRes._syncedToCloud, true);
      assert.deepStrictEqual(callOrder, ['saveSettings_ok', 'reconcile'], 'must settle daily stock only after saveSettings succeeds');

      // 8d: Dual-API update_category with only sort_order when DB returns 42703 fetches existing row instead of invalid upsert({ id })
      const prevFetch = globalThis.fetch;
      const prevSecret = process.env.SESSION_SECRET;
      const prevSbUrl = process.env.SUPABASE_URL;
      const prevSrvKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      process.env.SESSION_SECRET = 'test_session_secret_32_characters_long_secure_key!';
      process.env.SUPABASE_URL = 'https://mock-project.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key';
      const adminToken = createAdminToken('admin');
      const mockEnv = {
        SESSION_SECRET: process.env.SESSION_SECRET,
        SUPABASE_URL: 'https://mock-project.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'mock-service-role-key'
      };
      const methodsSeen = [];
      globalThis.fetch = async (url, init = {}) => {
        const u = String(url);
        const m = String(init.method || 'GET').toUpperCase();
        methodsSeen.push(`${m} ${u.split('?')[0].split('/').slice(-2).join('/')}`);
        if (m === 'PATCH' && u.includes('/categories')) {
          return new Response(JSON.stringify({ code: '42703', message: 'column categories.sort_order does not exist' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        if (m === 'GET' && u.includes('/categories')) {
          return new Response(JSON.stringify([{ id: 'biryani', name: 'Biryani', emoji: '🍛' }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        throw new Error(`Unexpected Supabase call: ${m} ${u}`);
      };
      try {
        const nodeReqRes = createMockReqRes({
          headers: { authorization: `Bearer ${adminToken}` },
          body: { action: 'update_category', id: 'biryani', updates: { sort_order: 2 } }
        });
        await apiAdminStoreHandler(nodeReqRes.req, nodeReqRes.res);
        assert.strictEqual(nodeReqRes.res.statusCode, 200);
        assert.strictEqual(nodeReqRes.res.responseData?.data?.[0]?.id, 'biryani');
        assert.deepStrictEqual(methodsSeen, ['PATCH v1/categories', 'GET v1/categories']);

        methodsSeen.length = 0;
        const cfRes = await cfAdminStoreHandler({
          request: new Request('http://localhost/api/admin-store', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
            body: JSON.stringify({ action: 'update_category', id: 'biryani', updates: { sort_order: 2 } })
          }),
          env: mockEnv
        });
        assert.strictEqual(cfRes.status, 200);
        const cfJson = await cfRes.json();
        assert.strictEqual(cfJson.data?.[0]?.id, 'biryani');
        assert.deepStrictEqual(methodsSeen, ['PATCH v1/categories', 'GET v1/categories']);
      } finally {
        globalThis.fetch = prevFetch;
        if (prevSecret !== undefined) process.env.SESSION_SECRET = prevSecret; else delete process.env.SESSION_SECRET;
        if (prevSbUrl !== undefined) process.env.SUPABASE_URL = prevSbUrl; else delete process.env.SUPABASE_URL;
        if (prevSrvKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = prevSrvKey; else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      }
    } finally {
      if (hasWindow) {
        globalThis.window = prevWindow;
      } else {
        delete globalThis.window;
      }
      dataService.portalType = prevPortalType;
      dataService.isStaffAuthorized = origIsStaffAuth;
      dataService._adminStoreAction = origAdminStoreAction;
      dataService.saveSettings = origSaveSettings;
      dataService.reconcileDailyStockIfNeeded = origReconcile;
      customSupabaseFrom = null;
    }
  });
});
