import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

if (typeof global.localStorage === 'undefined') {
  const store = new Map();
  global.localStorage = {
    getItem: (key) => store.get(String(key)) ?? null,
    setItem: (key, val) => store.set(String(key), String(val)),
    removeItem: (key) => store.delete(String(key)),
    clear: () => store.clear(),
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; }
  };
}
if (typeof global.sessionStorage === 'undefined') {
  const store = new Map();
  global.sessionStorage = {
    getItem: (key) => store.get(String(key)) ?? null,
    setItem: (key, val) => store.set(String(key), String(val)),
    removeItem: (key) => store.delete(String(key)),
    clear: () => store.clear()
  };
}

import {
  DEFAULT_CATEGORIES,
  DEFAULT_DISHES,
  dataService,
  isComboCategory,
  isComboDish
} from '../dataService.js';

describe('COMBOS CREATION & FIRST-IN-MENU VISIBILITY SUITE', () => {
  beforeEach(() => {
    global.localStorage.clear();
    dataService.dishesCache = null;
  });

  it('1. DEFAULT_CATEGORIES places Combos category first with valid canonical image', () => {
    assert.ok(Array.isArray(DEFAULT_CATEGORIES) && DEFAULT_CATEGORIES.length > 0);
    const first = DEFAULT_CATEGORIES[0];
    assert.strictEqual(first.id, 'cat-combos');
    assert.strictEqual(first.slug, 'combos');
    assert.strictEqual(first.name, 'Combos');
    assert.ok(first.image.startsWith('/api/r2-image?key='));
  });

  it('2. isComboCategory and isComboDish accurately detect combos without false positives', () => {
    assert.strictEqual(isComboCategory({ id: 'cat-combos', slug: 'combos', name: 'Combos' }), true);
    assert.strictEqual(isComboCategory({ id: 'cat-custom', slug: 'value-combos', name: 'Family Combos' }), true);
    assert.strictEqual(isComboCategory('combos'), true);
    assert.strictEqual(isComboCategory({ id: 'cat-biryani', slug: 'biryani', name: 'Rice & Biryani' }), false);

    assert.strictEqual(isComboDish({ id: 'd1', name: 'Meal Deal', category: 'combos' }), true);
    assert.strictEqual(isComboDish({ id: 'd2', name: 'Chef Platter', category: 'biryani', isCombo: true }), true);
    assert.strictEqual(isComboDish({ id: 'd3', name: 'Rice & Kebab', category: 'biryani', badge: '🔥 Value Combo' }), true);
    assert.strictEqual(isComboDish({ id: 'd4', name: 'Chicken Biryani', category: 'biryani', badge: '⭐ Bestseller' }), false);
  });

  it('3. dataService.saveCategories and getCategories always sort Combos category first', () => {
    const unordered = [
      { id: 'cat-biryani', name: 'Rice & Biryani', emoji: '🍚', slug: 'biryani' },
      { id: 'cat-bbq', name: 'BBQ & Tandoori', emoji: '🔥', slug: 'bbq-tandoori' },
      { id: 'cat-combos', name: 'Combos', emoji: '🍱', slug: 'combos' }
    ];
    dataService.saveCategories(unordered);
    const cats = dataService.getCategories();
    assert.strictEqual(cats[0].slug, 'combos', 'Combos category must always sort to index 0');
    assert.strictEqual(cats[1].slug, 'biryani');
    assert.strictEqual(cats[2].slug, 'bbq-tandoori');
  });

  it('4. dataService._sortDishesList places Combos category dishes first ahead of regular and default dishes', () => {
    const now = Date.now();
    const regularCustom = {
      id: `item-${now + 5000}`,
      name: 'New Regular Dish',
      category: 'biryani',
      price: 180,
      badge: '⭐ Bestseller',
      createdAt: new Date(now + 5000).toISOString()
    };
    const comboOlder = {
      id: `item-${now + 1000}`,
      name: 'Biryani Kebab Combo',
      category: 'combos',
      categoryName: 'Combos',
      price: 249,
      badge: '🔥 Value Combo',
      createdAt: new Date(now + 1000).toISOString()
    };
    const comboNewer = {
      id: `item-${now + 3000}`,
      name: 'Family Feast Combo',
      category: 'combos',
      categoryName: 'Combos',
      price: 499,
      badge: '🔥 Value Combo',
      createdAt: new Date(now + 3000).toISOString()
    };

    const sorted = dataService._sortDishesList([
      DEFAULT_DISHES[1],
      regularCustom,
      DEFAULT_DISHES[0], // has Value Combo badge in biryani
      comboOlder,
      comboNewer
    ]);

    assert.strictEqual(sorted[0].id, comboNewer.id, 'Newest Combos-category item must be first');
    assert.strictEqual(sorted[1].id, comboOlder.id, 'Older Combos-category item must be second');
    assert.strictEqual(sorted[2].id, DEFAULT_DISHES[0].id, 'Combo-badged item must precede regular items');
    assert.strictEqual(sorted[3].id, regularCustom.id, 'Regular custom dish comes after combos');
    assert.strictEqual(sorted[4].id, DEFAULT_DISHES[1].id, 'Regular default dish comes last');
  });

  it('5. ensureCombosCategory idempotently adds Combos category first without duplicates', async () => {
    dataService.saveCategories([
      { id: 'cat-biryani', name: 'Rice & Biryani', emoji: '🍚', slug: 'biryani' }
    ]);
    assert.strictEqual(dataService.getCategories().some(c => c.slug === 'combos'), false);

    const created = await dataService.ensureCombosCategory();
    assert.strictEqual(created.slug, 'combos');

    const catsAfterFirst = dataService.getCategories();
    assert.strictEqual(catsAfterFirst[0].slug, 'combos');
    assert.strictEqual(catsAfterFirst.length, 2);

    // Calling again does not create duplicate
    await dataService.ensureCombosCategory();
    const catsAfterSecond = dataService.getCategories();
    assert.strictEqual(catsAfterSecond.filter(c => c.slug === 'combos').length, 1);
  });

  it('6. admin.html and admin.js expose + Add Combo trigger, combo modal switch, and original price input', () => {
    const adminHtml = fs.readFileSync(path.resolve(process.cwd(), 'admin.html'), 'utf8');
    const adminJs = fs.readFileSync(path.resolve(process.cwd(), 'admin.js'), 'utf8');

    assert.ok(adminHtml.includes('id="btn-open-add-combo"'), 'admin.html must expose #btn-open-add-combo button');
    assert.ok(adminHtml.includes('id="input-dish-is-combo"'), 'admin.html must expose #input-dish-is-combo switch');
    assert.ok(adminHtml.includes('id="dish-original-price-input"'), 'admin.html must expose #dish-original-price-input');
    assert.ok(adminHtml.includes('value="🔥 Value Combo"'), 'admin.html must include Value Combo badge option');

    assert.match(adminJs, /function\s+openAddComboModal\s*\(/, 'admin.js must define openAddComboModal');
    assert.match(adminJs, /btnOpenAddCombo\.addEventListener\(['"]click['"],\s*openAddComboModal\)/, 'admin.js must wire btnOpenAddCombo');
    assert.match(adminJs, /ensureCombosCategory\(/, 'admin.js must ensure Combos category exists on combo save');
  });

  it('7. main.js reorders #recipe-grid cards to match sorted dishes order so combos appear first', () => {
    const mainJs = fs.readFileSync(path.resolve(process.cwd(), 'main.js'), 'utf8');

    assert.match(mainJs, /isComboCategory\s*\(/, 'main.js must check isComboCategory when syncing storefront categories');
    assert.match(mainJs, /isComboDish\s*\(/, 'main.js must check isComboDish when syncing storefront cards');
    assert.match(mainJs, /needsReorder[\s\S]*?recipeGrid\.appendChild\(frag\)/, 'main.js must reorder #recipe-grid DOM children so combos render first');
  });
});
