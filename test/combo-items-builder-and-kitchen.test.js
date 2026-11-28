import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const store = new Map();
if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; }
  };
}
if (typeof globalThis.sessionStorage === 'undefined') {
  const sStore = new Map();
  globalThis.sessionStorage = {
    getItem: (k) => (sStore.has(k) ? sStore.get(k) : null),
    setItem: (k, v) => { sStore.set(k, String(v)); },
    removeItem: (k) => { sStore.delete(k); },
    clear: () => { sStore.clear(); }
  };
}

let dataService;
let normalizeComboItems;
let parseComboItemsFromText;
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

describe('COMBO TAG-BOX EDITOR, KITCHEN BREAKDOWN & DUAL-API SUITE', () => {
  before(async () => {
    const sbMod = await import('../supabaseClient.js');
    supabaseClient = sbMod.supabase;
    if (supabaseClient && typeof supabaseClient.from === 'function') {
      originalSupabaseFrom = supabaseClient.from.bind(supabaseClient);
      supabaseClient.from = () => createMockSupabaseChain();
    }
    const mod = await import('../dataService.js');
    dataService = mod.dataService;
    normalizeComboItems = mod.normalizeComboItems;
    parseComboItemsFromText = mod.parseComboItemsFromText;
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
    }
  });

  it('1. normalizeComboItems and parseComboItemsFromText clean arrays, JSON strings, + separators, and newlines', () => {
    assert.deepEqual(
      normalizeComboItems(['  Half Alfaham  ', '', '2   Biryani Rice (Full)', null]),
      ['Half Alfaham', '2 Biryani Rice (Full)']
    );
    assert.deepEqual(
      normalizeComboItems('["8 Biryani Rice", "5L Water"]'),
      ['8 Biryani Rice', '5L Water']
    );
    assert.deepEqual(normalizeComboItems('plain text without json array'), []);

    assert.deepEqual(
      parseComboItemsFromText('Half Alfaham + 2 Biryani Rice (Full) +2 Kerala Parota+ Chicken Masala'),
      ['Half Alfaham', '2 Biryani Rice (Full)', '2 Kerala Parota', 'Chicken Masala']
    );
    assert.deepEqual(
      parseComboItemsFromText('8 Biryani Rice\n5L Water\n2L Thums Up'),
      ['8 Biryani Rice', '5L Water', '2L Thums Up']
    );
  });

  it('2. dataService.addDish, updateDish, and getDishes persist comboItems and auto-sync desc', async () => {
    const added = await dataService.addDish({
      name: 'Test Family Combo',
      category: 'combos',
      categoryName: 'Combos',
      price: 599,
      isCombo: true,
      comboItems: ['Full Alfaham', '3 Biryani Rice', '5L Water']
    });

    assert.deepEqual(added.comboItems, ['Full Alfaham', '3 Biryani Rice', '5L Water']);
    assert.equal(added.desc, 'Full Alfaham + 3 Biryani Rice + 5L Water');

    const storedAfterAdd = dataService.getDishes().find(d => d.id === added.id);
    assert.ok(storedAfterAdd, 'Newly added combo must be returned by getDishes()');
    assert.deepEqual(storedAfterAdd.comboItems, ['Full Alfaham', '3 Biryani Rice', '5L Water']);

    const updated = await dataService.updateDish(added.id, {
      comboItems: ['Full Alfaham', '4 Biryani Rice', '2L Thums Up']
    });
    assert.deepEqual(updated.comboItems, ['Full Alfaham', '4 Biryani Rice', '2L Thums Up']);

    const cleared = await dataService.updateDish(added.id, {
      isCombo: false,
      comboItems: []
    });
    assert.deepEqual(cleared.comboItems, []);

    // Verify syncDishesFromSupabase clears stale local comboItems when remote combo_items is explicitly null
    await dataService.updateDish(added.id, { comboItems: ['Half Alfaham'] });
    const prevFrom = supabaseClient.from;
    supabaseClient.from = (table) => {
      if (table === 'dishes') {
        const chain = {
          select: () => chain,
          order: () => Promise.resolve({
            data: [{
              id: added.id,
              name: 'Test Family Combo',
              category: 'biryani',
              category_name: 'Rice & Biryani',
              price: 599,
              image: '/images/crispy-chicken.jpg',
              in_stock: true,
              is_combo: false,
              combo_items: null,
              description: 'Single dish now'
            }],
            error: null
          })
        };
        return chain;
      }
      return createMockSupabaseChain();
    };
    try {
      dataService._lastDishesSyncTime = 0;
      await dataService.syncDishesFromSupabase(true);
      const syncedDish = dataService.getDishes().find(d => d.id === added.id);
      assert.deepEqual(syncedDish?.comboItems, []);
    } finally {
      supabaseClient.from = prevFrom;
    }
  });

  it('3. dataService.addOrder snapshots comboItems onto sanitized order.items from catalog', async () => {
    const combo = await dataService.addDish({
      name: 'Alfaham Combo',
      category: 'combos',
      categoryName: 'Combos',
      price: 499,
      isCombo: true,
      comboItems: ['Half Alfaham', '2 Biryani Rice (Full)', 'Campa (400ml)']
    });

    dataService.saveSettings({ storeOpen: true });
    const orderRes = await dataService.addOrder({
      id: '#QB-9911',
      customerName: 'Test Customer',
      customerPhone: '9876543210',
      deliveryAddress: 'MG Road, Ramanagara',
      bypassClosedCheck: true,
      bypassGeofenceCheck: true,
      items: [{ id: combo.id, name: combo.name, quantity: 2, price: 499 }]
    });

    assert.equal(orderRes.items[0].name, 'Alfaham Combo');
    assert.deepEqual(orderRes.items[0].comboItems, ['Half Alfaham', '2 Biryani Rice (Full)', 'Campa (400ml)']);
  });

  it('4. Dual-API parity: api/admin-store.js & functions/api/admin-store.js allow and sanitize combo_items with 42703 fallback', () => {
    for (const rel of ['api/admin-store.js', 'functions/api/admin-store.js']) {
      const src = readProjectFile(rel);
      assert.match(src, /ALLOWED_DISH_FIELDS\s*=\s*\[[\s\S]*?'combo_items'[\s\S]*?\];/, `${rel} must whitelist combo_items`);
      assert.match(src, /delete\s+dish\.combo_items;/, `${rel} must strip combo_items on 42703 fallback for dish insert/upsert`);
      assert.match(src, /delete\s+updates\.combo_items;/, `${rel} must strip combo_items on 42703 fallback for dish update`);
      assert.match(src, /delete\s+upsertPayload\.combo_items;/, `${rel} must strip combo_items on 42703 fallback for upsert`);
    }
  });

  it('5. Dual-API checkout: api/checkout.js & functions/api/checkout.js snapshot comboItems onto verifiedItems', async () => {
    for (const rel of ['api/checkout.js', 'functions/api/checkout.js']) {
      const src = readProjectFile(rel);
      assert.match(src, /combo_items\s*\?\?\s*\w+\?\.comboItems/, `${rel} must read authoritative combo_items/comboItems from catalog`);
      assert.match(src, /safeComboItems\.length\s*>\s*0\s*\?\s*\{\s*comboItems:\s*safeComboItems\s*\}\s*:\s*\{\s*\}/, `${rel} must attach comboItems to verifiedItems`);
    }

    const { default: nodeCheckoutHandler } = await import('../api/checkout.js');
    const { onRequest: cfCheckoutHandler } = await import('../functions/api/checkout.js');

    const payload = {
      items: [{ id: 'combo-test-1', name: 'Alfaham Combo', quantity: 1, price: 499 }],
      catalogDishes: [
        {
          id: 'combo-test-1',
          name: 'Alfaham Combo',
          price: 499,
          comboItems: ['Half Alfaham', '2 Biryani Rice (Full)', 'Campa (400ml)']
        }
      ],
      storeSettings: { storeOpen: true }
    };

    // Invoke Node handler
    let nodeStatus = 0;
    let nodeJson = null;
    await nodeCheckoutHandler(
      { method: 'POST', headers: {}, body: payload },
      {
        setHeader: () => {},
        status: (code) => {
          nodeStatus = code;
          return {
            json: (data) => { nodeJson = data; return data; },
            end: () => {}
          };
        }
      }
    );
    assert.equal(nodeStatus, 200);
    assert.equal(nodeJson?.success, true);
    assert.deepEqual(nodeJson?.items?.[0]?.comboItems, ['Half Alfaham', '2 Biryani Rice (Full)', 'Campa (400ml)']);

    // Invoke Cloudflare Pages Function handler
    const cfRes = await cfCheckoutHandler({
      request: new Request('https://localhost/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      }),
      env: { NODE_ENV: 'test' }
    });
    const cfJson = await cfRes.json();
    assert.equal(cfRes.status, 200);
    assert.equal(cfJson?.success, true);
    assert.deepEqual(cfJson?.items?.[0]?.comboItems, ['Half Alfaham', '2 Biryani Rice (Full)', 'Campa (400ml)']);
  });

  it('6. Migration 19, Rollback 19, and supabase_setup.sql define combo_items cleanly', () => {
    const mig19 = readProjectFile('supabase_migration_19_dishes_combo_items.sql');
    const roll19 = readProjectFile('supabase_rollback_19_dishes_combo_items.sql');
    const setupSql = readProjectFile('supabase_setup.sql');

    assert.match(mig19, /ALTER\s+TABLE\s+public\.dishes\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+combo_items\s+JSONB\s+DEFAULT\s+NULL/i);
    assert.match(roll19, /ALTER\s+TABLE\s+public\.dishes\s+DROP\s+COLUMN\s+IF\s+EXISTS\s+combo_items/i);
    assert.match(setupSql, /ALTER\s+TABLE\s+public\.dishes\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+combo_items\s+JSONB\s+DEFAULT\s+NULL/i);
  });

  it('7. Admin Combo Tag-Box UI, Kitchen Cards, View Order, KOT Print, Storefront, Rider & Owner portals wire comboItems safely', () => {
    const adminHtml = readProjectFile('admin.html');
    const adminJs = readProjectFile('admin.js');
    const indexHtml = readProjectFile('index.html');
    const mainJs = readProjectFile('main.js');
    const deliveryJs = readProjectFile('delivery.js');
    const ownerJs = readProjectFile('owner.js');

    // Admin Editor Tag-Box DOM & JS
    assert.ok(adminHtml.includes('id="dish-desc-group"'));
    assert.ok(adminHtml.includes('id="dish-desc-input"'));
    assert.ok(adminHtml.includes('id="dish-combo-items-group"'));
    assert.ok(adminHtml.includes('id="dish-combo-item-input"'));
    assert.ok(adminHtml.includes('id="dish-combo-chips-list"'));
    assert.match(adminJs, /function\s+renderComboChipsBuilder\s*\(/);
    assert.match(adminJs, /function\s+commitComboItemInput\s*\(/);
    assert.match(adminJs, /function\s+resolveOrderItemComboItems\s*\(/);

    // Kitchen Order Card, View Order Modal, and Thermal KOT Print
    assert.match(adminJs, /class="order-item-combo-breakdown"/);
    assert.match(adminJs, /class="order-item-readonly-combo-box"/);
    assert.match(adminJs, /printOrderKOT[\s\S]*?const\s+comboParts\s*=\s*resolveOrderItemComboItems\(item\)/);

    // Customer Storefront, Rider & Owner
    assert.ok(indexHtml.includes('id="food-detail-combo-box"'));
    assert.ok(indexHtml.includes('id="food-detail-combo-chips"'));
    assert.match(mainJs, /foodDetailComboBox/);
    assert.match(mainJs, /cart-item-combo-note/);
    assert.match(deliveryJs, /normalizeComboItems\(it\.comboItems\s*\?\?\s*it\.combo_items\)/);
    assert.match(ownerJs, /normalizeComboItems\(it\.comboItems\s*\?\?\s*it\.combo_items\)/);
  });
});
