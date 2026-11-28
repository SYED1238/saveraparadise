import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Lightweight in-memory localStorage mock before importing dataService.js
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => { store.clear(); },
  key: (i) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; }
};

let dataService;
let normalizeSortOrder;
let supabaseClient;
let originalSupabaseFrom;

const createMockSupabaseChain = () => {
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
    then: (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject)
  };
  return chain;
};

const projectRoot = process.cwd();
const readProjectFile = (relPath) => fs.readFileSync(path.resolve(projectRoot, relPath), 'utf8');

describe('Menu Display Ordering & Customer Recently Ordered (Zero DB Log Ingestion)', () => {
  before(async () => {
    const sbMod = await import('../supabaseClient.js');
    supabaseClient = sbMod.supabase;
    if (supabaseClient && typeof supabaseClient.from === 'function') {
      originalSupabaseFrom = supabaseClient.from.bind(supabaseClient);
      supabaseClient.from = () => createMockSupabaseChain();
    }
    const mod = await import('../dataService.js');
    dataService = mod.dataService;
    normalizeSortOrder = mod.normalizeSortOrder;
  });

  after(() => {
    if (supabaseClient && originalSupabaseFrom) {
      supabaseClient.from = originalSupabaseFrom;
    }
  });

  afterEach(() => {
    store.clear();
    if (dataService) {
      dataService.dishesCache = null;
      dataService.categoriesCache = null;
      dataService._lastDishesEffectiveSig = null;
      dataService._reconciledDailyBatchKey = null;
    }
  });

  it('1. normalizeSortOrder validates positive integers 1+ and rejects 0, negative, empty, or NaN', () => {
    assert.equal(normalizeSortOrder(1), 1);
    assert.equal(normalizeSortOrder('2'), 2);
    assert.equal(normalizeSortOrder(5.9), 5);
    assert.equal(normalizeSortOrder(' 12 '), 12);
    assert.equal(normalizeSortOrder(null), null);
    assert.equal(normalizeSortOrder(undefined), null);
    assert.equal(normalizeSortOrder(''), null);
    assert.equal(normalizeSortOrder(0), null);
    assert.equal(normalizeSortOrder(-3), null);
    assert.equal(normalizeSortOrder('abc'), null);
  });

  it('2. _sortCategoriesList honors explicit sortOrder (#1, #2, #3...) and falls back to Combos first among unnumbered', () => {
    const categories = [
      { id: 'cat-biryani', name: 'Biryani', sortOrder: null },
      { id: 'cat-combos', name: 'Combos', isCombo: true, sortOrder: null },
      { id: 'cat-kebab', name: 'Kebab', sortOrder: 2 },
      { id: 'cat-starters', name: 'Starters', sortOrder: 1 },
      { id: 'cat-drinks', name: 'Drinks', sortOrder: null }
    ];

    const sorted = dataService._sortCategoriesList(categories);
    assert.deepEqual(
      sorted.map((c) => c.id),
      ['cat-starters', 'cat-kebab', 'cat-combos', 'cat-biryani', 'cat-drinks']
    );

    // Explicitly numbering Combos at #3 places it right after #1 and #2
    const comboAtThree = categories.map((c) => (c.id === 'cat-combos' ? { ...c, sortOrder: 3 } : c));
    const sortedWithCombo3 = dataService._sortCategoriesList(comboAtThree);
    assert.deepEqual(
      sortedWithCombo3.map((c) => c.id),
      ['cat-starters', 'cat-kebab', 'cat-combos', 'cat-biryani', 'cat-drinks']
    );
  });

  it('3. _sortDishesList places numbered sortOrder dishes at top of All Menu, keeping unnumbered combos ahead of regular dishes', () => {
    const dishes = [
      { id: 'dish-reg-a', name: 'Regular A', category: 'biryani', isCombo: false, sortOrder: null },
      { id: 'dish-combo-1', name: 'Combo Unnumbered', category: 'combos', isCombo: true, sortOrder: null },
      { id: 'dish-top-2', name: 'Featured Biryani #2', category: 'biryani', isCombo: false, sortOrder: 2 },
      { id: 'dish-top-1', name: 'Hero Kebab #1', category: 'kebab', isCombo: false, sortOrder: 1 }
    ];

    const sorted = dataService._sortDishesList(dishes);
    assert.deepEqual(
      sorted.map((d) => d.id),
      ['dish-top-1', 'dish-top-2', 'dish-combo-1', 'dish-reg-a']
    );
  });

  it('4. Category and dish sortOrder persistence helpers update local catalog cleanly', async () => {
    const cat = await dataService.addCategory({
      name: 'Chef Specials',
      emoji: '👑',
      sortOrder: 1
    });
    assert.equal(cat.sortOrder, 1);

    const updatedCat = await dataService.updateCategorySortOrder(cat.id, 3);
    assert.equal(updatedCat.sortOrder, 3);
    assert.equal(dataService.getCategories().find((c) => c.id === cat.id)?.sortOrder, 3);

    await dataService.updateCategorySortOrder(cat.id, null);
    assert.equal(dataService.getCategories().find((c) => c.id === cat.id)?.sortOrder, null);

    const dish = await dataService.addDish({
      name: 'Nawab Platter',
      price: 499,
      category: 'Chef Specials',
      sortOrder: 2
    });
    assert.equal(dish.sortOrder, 2);

    const updatedDish = await dataService.updateDish(dish.id, { sortOrder: 1 });
    assert.equal(updatedDish.sortOrder, 1);
    assert.equal(dataService.getDishById(dish.id)?.sortOrder, 1);
  });

  it('5. getRecentlyOrderedDishes strictly isolates customer orders, skips cancelled/pending_payment, deduplicates newest-first, and maps live catalog', async () => {
    const d1 = await dataService.addDish({ name: 'Hyderabadi Dum Biryani Test', price: 220, category: 'biryani', inStock: true });
    const d2 = await dataService.addDish({ name: 'Chicken Seekh Kebab Test', price: 180, category: 'kebab', inStock: false });
    const d3 = await dataService.addDish({ name: 'Deleted Special (Skip)', price: 150, category: 'biryani' });
    assert.ok(d1?.id && d2?.id && d3?.id);

    // Simulate updated price on live dish 1 after past order + remove d3 from catalog
    await dataService.updateDish(d1.id, { price: 240 });
    await dataService.deleteDish(d3.id);

    const orders = [
      {
        id: 'ORD-C1-OLD',
        userId: 'cust-1',
        customerEmail: 'a@example.com',
        customerPhone: '9876543210',
        status: 'delivered',
        createdAt: '2026-11-20T10:00:00Z',
        items: [
          { id: d1.id, name: d1.name, price: 199, qty: 1 },
          { id: d3.id, name: d3.name, price: 150, qty: 1 }
        ]
      },
      {
        id: 'ORD-C1-CANCELLED',
        userId: 'cust-1',
        status: 'cancelled',
        createdAt: '2026-11-25T12:00:00Z',
        items: [{ id: d2.id, name: d2.name, price: 180, qty: 2 }]
      },
      {
        id: 'ORD-C1-PENDING-PAY',
        userId: 'cust-1',
        status: 'pending_payment',
        createdAt: '2026-11-25T13:00:00Z',
        items: [{ id: d2.id, name: d2.name, price: 180, qty: 3 }]
      },
      {
        id: 'ORD-C1-NEWEST',
        userId: 'cust-1',
        customerEmail: 'a@example.com',
        customerPhone: '9876543210',
        status: 'cooking',
        createdAt: '2026-11-26T09:00:00Z',
        items: [
          { id: d2.id, name: d2.name, price: 180, qty: 2 },
          { id: d1.id, name: d1.name, price: 220, qty: 3 }
        ]
      },
      {
        id: 'ORD-OTHER-CUSTOMER',
        userId: 'cust-2',
        customerEmail: 'other@example.com',
        customerPhone: '9999999999',
        status: 'delivered',
        createdAt: '2026-11-26T11:00:00Z',
        items: [{ id: d1.id, name: d1.name, price: 99, qty: 5 }]
      }
    ];
    localStorage.setItem('quickbite_orders', JSON.stringify(orders));

    // Brand-new visitor gets 0 items (no cross-customer leak)
    const guestResult = dataService.getRecentlyOrderedDishes(null, '', '', 8);
    assert.equal(guestResult.length, 0);

    // cust-1 gets newest unique live dishes (ORD-C1-NEWEST order: Kebab then Biryani), live price 240, stock status preserved, deleted skipped
    const cust1Result = dataService.getRecentlyOrderedDishes('cust-1', 'a@example.com', '9876543210', 8);
    assert.deepEqual(cust1Result.map((d) => d.id), [d2.id, d1.id]);
    assert.equal(cust1Result[0].lastOrderedQty, 2);
    assert.equal(cust1Result[0].inStock, false);
    assert.equal(cust1Result[1].price, 240);
    assert.equal(cust1Result[1].lastOrderedQty, 3);
  });

  it('6. Dual-API parity and Migration 17 include sort_order and 42703 safe fallbacks', () => {
    const migSql = readProjectFile('supabase_migration_17_sort_order.sql');
    const rbSql = readProjectFile('supabase_rollback_17_sort_order.sql');
    const setupSql = readProjectFile('supabase_setup.sql');

    assert.match(migSql, /ALTER TABLE public\.categories ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT NULL/i);
    assert.match(migSql, /ALTER TABLE public\.dishes ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT NULL/i);
    assert.match(rbSql, /DROP COLUMN IF EXISTS sort_order/i);
    assert.match(setupSql, /public\.categories ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT NULL/i);
    assert.match(setupSql, /public\.dishes ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT NULL/i);

    for (const apiRel of ['api/admin-store.js', 'functions/api/admin-store.js']) {
      const apiSrc = readProjectFile(apiRel);
      assert.match(apiSrc, /ALLOWED_DISH_FIELDS\s*=\s*\[[\s\S]*?'sort_order'[\s\S]*?\];/, `${apiRel} whitelists dish sort_order`);
      assert.match(apiSrc, /ALLOWED_CATEGORY_FIELDS\s*=\s*\[[\s\S]*?'sort_order'[\s\S]*?\];/, `${apiRel} whitelists category sort_order`);
      assert.match(apiSrc, /delete (?:dish|updates|upsertPayload|catPayload|cleanUpdates)\.sort_order/, `${apiRel} handles 42703 missing sort_order fallback`);
      assert.match(apiSrc, /sb\.from\('categories'\)\.select\('\*'\)\.eq\('id', id\)/, `${apiRel} fetches existing category on 42703 empty cleanUpdates fallback`);
    }
  });

  it('7. Admin portal exposes category/dish sortOrder controls and All Items Order view without breaking menu area invariants', () => {
    const adminHtml = readProjectFile('admin.html');
    const adminJs = readProjectFile('admin.js');
    const adminCss = readProjectFile('admin.css');

    assert.match(adminHtml, /id="btn-admin-all-items-order"/);
    assert.match(adminHtml, /id="cat-sort-order-input"/);
    assert.match(adminHtml, /id="dish-sort-order-input"/);
    assert.match(adminCss, /\.cat-order-pill\b/);
    assert.match(adminCss, /\.dish-top-order-chip\b/);

    assert.match(adminJs, /normalizeSortOrder/);
    assert.match(adminJs, /updateCategory\(editId,\s*\{\s*name,\s*emoji,\s*image,\s*sortOrder\s*\}\)/);
    assert.match(adminJs, /showingAllItemsOrder/);
    assert.match(adminJs, /allPosMap\.get\(dish\.id\)/);
  });

  it('8. Storefront Recently Ordered renders in All view with zero extra Supabase queries and avoids recipe-card ID collisions', () => {
    const indexHtml = readProjectFile('index.html');
    const styleCss = readProjectFile('style.css');
    const mainJs = readProjectFile('main.js');
    const dataServiceJs = readProjectFile('dataService.js');

    assert.match(indexHtml, /id="recently-ordered-section"/);
    assert.match(indexHtml, /id="recently-ordered-track"/);
    assert.match(styleCss, /\.recently-ordered-track\s*\{/);
    assert.match(styleCss, /\[data-theme="dark"\]\s+\.recently-ordered-heading/);
    assert.match(styleCss, /\.recent-order-img:not\(\.img-is-ready\)/);
    assert.match(styleCss, /\.recent-order-img\.img-is-ready/);
    assert.match(styleCss, /\.recent-order-card-inner\.is-img-loading::after/);
    assert.match(styleCss, /\.recent-order-card\s+\.btn-glass-add\s*\{[\s\S]*?position:\s*static;/);
    assert.match(styleCss, /\.recent-order-card\s+\.dish-card-stepper\s*\{[\s\S]*?position:\s*static;/);
    assert.match(styleCss, /\.recent-order-card\.is-out-of-stock\s+\.dish-card-stepper/);

    assert.match(mainJs, /function renderRecentlyOrderedSection\(/);
    assert.match(mainJs, /function syncRecentlyOrderedDealUI\(/);
    assert.match(mainJs, /img\._skeletonHandlers/);
    assert.match(mainJs, /img\.closest\('\.recent-order-card-inner'\)/);
    assert.match(mainJs, /\.recent-order-img/);
    assert.match(mainJs, /querySelectorAll\('\.recipe-card,\s*\.recent-order-card'\)/);
    assert.match(mainJs, /closest\('\.recipe-card,\s*\.recent-order-card'\)/);

    // Ensure renderRecentlyOrderedSection NEVER triggers a Supabase sync / extra DB log ingestion
    const fnMatch = mainJs.match(/function renderRecentlyOrderedSection\([^)]*\)\s*\{[\s\S]*?\n  \}/);
    assert.ok(fnMatch, 'renderRecentlyOrderedSection function body found');
    assert.doesNotMatch(fnMatch[0], /syncCustomerOrdersFromSupabase|from\(['"]orders['"]\)|fetch\(/);

    // Ensure getRecentlyOrderedDishes in dataService also stays purely synchronous/local
    const dsFnMatch = dataServiceJs.match(/getRecentlyOrderedDishes\([^)]*\)\s*\{[\s\S]*?\n  \}/);
    assert.ok(dsFnMatch, 'getRecentlyOrderedDishes method body found');
    assert.doesNotMatch(dsFnMatch[0], /supabase|fetch\(/);
  });

  it('9. main.js declares selectedAddressId before getCurrentUserPhone() and filterDishes("all") to prevent startup TDZ freeze', () => {
    const mainJs = readProjectFile('main.js');
    const declMatches = [...mainJs.matchAll(/\b(?:let|const)\s+selectedAddressId\b/g)];
    assert.equal(declMatches.length, 1, 'main.js must declare selectedAddressId exactly once inside initStorefrontApp');

    const declIdx = declMatches[0].index;
    const phoneFnIdx = mainJs.indexOf('function getCurrentUserPhone(');
    const filterAllIdx = mainJs.indexOf("filterDishes('all');");
    const recentFnIdx = mainJs.indexOf('function renderRecentlyOrderedSection(');

    assert.ok(declIdx !== -1 && phoneFnIdx !== -1 && filterAllIdx !== -1 && recentFnIdx !== -1);
    assert.ok(declIdx < phoneFnIdx, 'selectedAddressId must be initialized before getCurrentUserPhone()');
    assert.ok(declIdx < filterAllIdx, 'selectedAddressId must be initialized before synchronous filterDishes("all") startup call');
  });

  it('10. Recently Ordered stays strictly hidden for guests/logged-out devices even with cached my_order_ids, tracking tokens, or staff orders', async () => {
    const d1 = await dataService.addDish({ name: 'Guest Leak Guard Biryani', price: 220, category: 'biryani', inStock: true });
    const d2 = await dataService.addDish({ name: 'Account Isolated Kebab', price: 180, category: 'kebab', inStock: true });
    assert.ok(d1?.id && d2?.id);

    const orders = [
      {
        id: 'ORD-CUST1',
        userId: 'cust-1',
        customerEmail: 'a@example.com',
        customerPhone: '9876543210',
        status: 'delivered',
        createdAt: '2026-11-26T10:00:00Z',
        items: [{ id: d1.id, name: d1.name, price: 220, qty: 2 }]
      },
      {
        id: 'ORD-DEVICE-LEFTOVER',
        userId: null,
        customerEmail: '',
        customerPhone: '8888888888',
        status: 'delivered',
        createdAt: '2026-11-26T11:00:00Z',
        items: [{ id: d2.id, name: d2.name, price: 180, qty: 1 }]
      }
    ];
    localStorage.setItem('quickbite_orders', JSON.stringify(orders));
    localStorage.setItem('quickbite_my_order_ids', JSON.stringify(['ORD-CUST1', 'ORD-DEVICE-LEFTOVER']));
    localStorage.setItem('quickbite_tracking_tokens', JSON.stringify({ 'ORD-CUST1': 'tok-1', 'ORD-DEVICE-LEFTOVER': 'tok-2' }));
    dataService.ordersCache = null;

    // 1. Logged-out / Guest visitor gets 0 items even when my_order_ids, tracking tokens, and a phone number exist
    assert.deepEqual(dataService.getRecentlyOrderedDishes(null, '', '', 8), []);
    assert.deepEqual(dataService.getRecentlyOrderedDishes(null, '', '9876543210', 8), []);
    assert.deepEqual(dataService.getRecentlyOrderedDishes(null, '', '8888888888', 8), []);

    // 2. Different logged-in account (cust-2) never inherits cust-1 or unowned device-leftover orders from my_order_ids
    assert.deepEqual(dataService.getRecentlyOrderedDishes('cust-2', 'other@example.com', '9876543210', 8), []);

    // 3. Logged-in cust-1 sees ONLY cust-1 orders (never unowned device-leftover order with a different phone)
    const cust1Dishes = dataService.getRecentlyOrderedDishes('cust-1', 'a@example.com', '9876543210', 8);
    assert.deepEqual(cust1Dishes.map(d => d.id), [d1.id]);

    // 4. main.js renderRecentlyOrderedSection explicitly gates on logged-in currentUser before calling getRecentlyOrderedDishes
    const mainJs = readProjectFile('main.js');
    const fnMatch = mainJs.match(/function renderRecentlyOrderedSection\([^)]*\)\s*\{[\s\S]*?\n  \}/);
    assert.ok(fnMatch, 'renderRecentlyOrderedSection function body found');
    const loginGuardIdx = fnMatch[0].indexOf('if (!isLoggedInUser)');
    const fetchDishesIdx = fnMatch[0].indexOf('getRecentlyOrderedDishes(');
    assert.ok(loginGuardIdx !== -1 && fetchDishesIdx !== -1 && loginGuardIdx < fetchDishesIdx, 'renderRecentlyOrderedSection must hide & exit when user is not logged in');
  });
});
