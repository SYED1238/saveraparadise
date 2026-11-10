import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

import { formatTime12h, getDishScheduleStatus, dataService } from '../dataService.js';
import { supabase } from '../supabaseClient.js';

test('▶ DISH SCHEDULE & 7-DAY AVAILABILITY SUITE', async (t) => {
  await t.test('1. formatTime12h helper converts 24h formats accurately to 12h AM/PM', () => {
    assert.equal(formatTime12h('15:00'), '3:00 PM');
    assert.equal(formatTime12h('17:30'), '5:30 PM');
    assert.equal(formatTime12h('07:15'), '7:15 AM');
    assert.equal(formatTime12h('00:00'), '12:00 AM');
    assert.equal(formatTime12h('12:00'), '12:00 PM');
    assert.equal(formatTime12h('23:45'), '11:45 PM');
    assert.equal(formatTime12h(''), '');
    assert.equal(formatTime12h(null), '');
  });

  await t.test('2. getDishScheduleStatus respects out-of-stock priority', () => {
    const dish = {
      id: 'dish-test-oos',
      name: 'Test Biryani',
      inStock: false,
      availableDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
      timeRestricted: true,
      availableFrom: '10:00',
      availableTo: '22:00'
    };
    const res = getDishScheduleStatus(dish, new Date());
    assert.equal(res.isAvailable, false);
    assert.equal(res.status, 'out_of_stock');
    assert.equal(res.message, 'Sold Out');
  });

  await t.test('3. getDishScheduleStatus evaluates day-of-week restrictions', () => {
    // Simulated Wednesday: 2026-11-04 is Wednesday (getDay() = 3)
    const wednesday = new Date('2026-11-04T12:00:00+05:30');
    assert.equal(wednesday.getDay(), 3); // wed

    // Dish available only on Fri, Sat, Sun
    const weekendSpecial = {
      id: 'dish-weekend-special',
      name: 'Weekend Royal Mandi',
      inStock: true,
      availableDays: ['fri', 'sat', 'sun'],
      timeRestricted: false
    };

    const res = getDishScheduleStatus(weekendSpecial, wednesday);
    assert.equal(res.isAvailable, false);
    assert.equal(res.status, 'day_inactive');
    assert.match(res.message, /Available/i);
    assert.ok(res.badgeText);

    // Simulated Friday: 2026-11-06 (getDay() = 5)
    const friday = new Date('2026-11-06T12:00:00+05:30');
    assert.equal(friday.getDay(), 5); // fri
    const friRes = getDishScheduleStatus(weekendSpecial, friday);
    assert.equal(friRes.isAvailable, true);
    assert.equal(friRes.status, 'available');
  });

  await t.test('4. getDishScheduleStatus computes live countdown when before serving hours', () => {
    // Current time: 10:00 AM on Wednesday
    const morning = new Date('2026-11-04T10:00:00+05:30');

    // Serving hours: 12:00 PM to 4:00 PM
    const lunchDish = {
      id: 'dish-lunch-biryani',
      name: 'Dum Biryani',
      inStock: true,
      availableDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
      timeRestricted: true,
      availableFrom: '12:00',
      availableTo: '16:00'
    };

    const res = getDishScheduleStatus(lunchDish, morning);
    assert.equal(res.isAvailable, false);
    assert.equal(res.status, 'countdown');
    assert.equal(res.secondsRemaining, 7200); // 2 hours = 7200s
    assert.match(res.countdownText, /Starts in 2h 00m 00s/);
    assert.equal(res.message, 'Starts at 12:00 PM');
    assert.equal(res.badgeText, '⏰ 12:00 PM');
  });

  await t.test('5. getDishScheduleStatus flags active_window during serving hours', () => {
    // Current time: 1:30 PM (13:30) on Wednesday
    const lunchTime = new Date('2026-11-04T13:30:00+05:30');

    const lunchDish = {
      id: 'dish-lunch-biryani',
      name: 'Dum Biryani',
      inStock: true,
      availableDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
      timeRestricted: true,
      availableFrom: '12:00',
      availableTo: '16:00'
    };

    const res = getDishScheduleStatus(lunchDish, lunchTime);
    assert.equal(res.isAvailable, true);
    assert.equal(res.status, 'active_window');
    assert.match(res.message, /until 4:00 PM/);
  });

  await t.test('6. getDishScheduleStatus flags ended_today after serving hours', () => {
    // Current time: 5:00 PM (17:00) on Wednesday
    const eveningTime = new Date('2026-11-04T17:00:00+05:30');

    const lunchDish = {
      id: 'dish-lunch-biryani',
      name: 'Dum Biryani',
      inStock: true,
      availableDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
      timeRestricted: true,
      availableFrom: '12:00',
      availableTo: '16:00'
    };

    const res = getDishScheduleStatus(lunchDish, eveningTime);
    assert.equal(res.isAvailable, false);
    assert.equal(res.status, 'ended_today');
    assert.match(res.message, /ended for today/);
    assert.equal(res.badgeText, 'Closed Today');
  });

  await t.test('7. dataService.addDish and updateDish persist schedule fields', () => {
    const origFrom = supabase.from;
    supabase.from = () => ({
      insert: () => Promise.resolve({ error: null }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      select: () => Promise.resolve({ data: [], error: null })
    });

    const testDish = {
      name: 'Late Night Tandoori Feast',
      category: 'bbq-tandoori',
      price: 349,
      badge: '🔥 Hot',
      availableDays: ['fri', 'sat', 'sun'],
      timeRestricted: true,
      availableFrom: '19:00',
      availableTo: '23:30'
    };

    try {
      const created = dataService.addDish(testDish);
      assert.ok(created.id);
      assert.deepEqual(created.availableDays, ['fri', 'sat', 'sun']);
      assert.equal(created.timeRestricted, true);
      assert.equal(created.availableFrom, '19:00');
      assert.equal(created.availableTo, '23:30');

      // Update schedule
      const updated = dataService.updateDish(created.id, {
        availableDays: ['sat', 'sun'],
        availableFrom: '20:00'
      });
      assert.deepEqual(updated.availableDays, ['sat', 'sun']);
      assert.equal(updated.availableFrom, '20:00');
      assert.equal(updated.availableTo, '23:30');

      // Clean up local cache
      dataService.deleteDish(created.id);
    } finally {
      supabase.from = origFrom;
    }
  });

  await t.test('8. DOM parity: admin.html and index.html contain all schedule elements', () => {
    const adminHtml = fs.readFileSync(path.join(rootDir, 'admin.html'), 'utf8');
    assert.ok(adminHtml.includes('id="dish-days-picker"'), 'admin.html has dish-days-picker');
    assert.ok(adminHtml.includes('id="input-dish-time-restricted"'), 'admin.html has input-dish-time-restricted');
    assert.ok(adminHtml.includes('id="input-dish-available-from"'), 'admin.html has input-dish-available-from');
    assert.ok(adminHtml.includes('id="input-dish-available-to"'), 'admin.html has input-dish-available-to');
    assert.ok(adminHtml.includes('class="btn-day-quick"'), 'admin.html has btn-day-quick shortcuts');
    assert.ok(adminHtml.includes('class="btn-time-preset"'), 'admin.html has btn-time-preset shortcuts');

    const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
    assert.ok(indexHtml.includes('id="food-detail-schedule-banner"'), 'index.html has food-detail-schedule-banner');
    assert.ok(indexHtml.includes('id="food-detail-countdown-box"'), 'index.html has food-detail-countdown-box');
    assert.ok(indexHtml.includes('id="food-detail-days-strip"'), 'index.html has food-detail-days-strip');
  });

  await t.test('9. CSS parity: admin.css and style.css contain schedule styling', () => {
    const adminCss = fs.readFileSync(path.join(rootDir, 'admin.css'), 'utf8');
    assert.ok(adminCss.includes('.dish-schedule-box'), 'admin.css has .dish-schedule-box');
    assert.ok(adminCss.includes('.dish-day-pill.active'), 'admin.css has .dish-day-pill.active');
    assert.ok(adminCss.includes('.dish-schedule-badge'), 'admin.css has .dish-schedule-badge');

    const styleCss = fs.readFileSync(path.join(rootDir, 'style.css'), 'utf8');
    assert.ok(styleCss.includes('.recipe-card-schedule-pill.countdown-pill'), 'style.css has countdown-pill');
    assert.ok(styleCss.includes('.recipe-card-schedule-pill.day-pill'), 'style.css has day-pill');
    assert.ok(styleCss.includes('.food-schedule-banner'), 'style.css has food-schedule-banner');
  });

  await t.test('10. Storefront UX: Add button and stepper hidden on unstarted/inactive scheduled dishes', () => {
    const styleCss = fs.readFileSync(path.join(rootDir, 'style.css'), 'utf8');
    assert.match(
      styleCss,
      /\.recipe-card\.is-scheduled-countdown\s+\.btn-glass-add[\s\S]*display:\s*none\s*!important/i,
      'Add button must be strictly hidden when dish serving has not started'
    );
    assert.match(
      styleCss,
      /\.recipe-card\.is-scheduled-countdown\s+\.dish-card-stepper[\s\S]*display:\s*none\s*!important/i,
      'Stepper must be strictly hidden when dish serving has not started'
    );
    assert.match(
      styleCss,
      /\.recipe-card\.is-scheduled-inactive\s+\.btn-glass-add[\s\S]*display:\s*none\s*!important/i,
      'Add button must be strictly hidden when dish is inactive'
    );
  });
  await t.test('11. Timer leak defense: master ticker is module-scoped and prevents duplicate intervals', () => {
    const mainJs = fs.readFileSync(path.join(rootDir, 'main.js'), 'utf8');
    assert.ok(
      mainJs.includes('let dishScheduleTicker = null;') &&
      mainJs.includes('if (dishScheduleTicker) return;'),
      'dishScheduleTicker must be module-scoped and prevent duplicate intervals'
    );
  });

  await t.test('12. Expired/Unstarted scheduled dishes in cart block checkout in UI and API', () => {
    const mainJs = fs.readFileSync(path.join(rootDir, 'main.js'), 'utf8');
    assert.ok(mainJs.includes('unavailableScheduledItem'), 'main.js checks unavailableScheduledItem in renderCart');
    assert.ok(mainJs.includes('cart-schedule-badge'), 'main.js displays schedule badge in cart item');
    assert.ok(mainJs.includes('unavailableInCart'), 'main.js guards checkout drawer and order submit');

    const apiCheckoutJs = fs.readFileSync(path.join(rootDir, 'api', 'checkout.js'), 'utf8');
    assert.ok(apiCheckoutJs.includes('isDishAvailableNow'), 'api/checkout.js validates server-side dish schedule');

    const fnCheckoutJs = fs.readFileSync(path.join(rootDir, 'functions', 'api', 'checkout.js'), 'utf8');
    assert.ok(fnCheckoutJs.includes('isDishAvailableNow'), 'functions/api/checkout.js validates server-side dish schedule');
  });

  await t.test('13. Hero Floating Bubbles and addToCart enforce stock and schedule checks', () => {
    const mainJs = fs.readFileSync(path.join(rootDir, 'main.js'), 'utf8');
    assert.ok(
      mainJs.includes('function addToCart(item, triggerElement, qty = 1)') &&
      mainJs.includes('liveDish.inStock === false') &&
      mainJs.includes('getDishScheduleStatus(liveDish, new Date())'),
      'addToCart must verify live stock and schedule availability'
    );
  });

  await t.test('14. Food detail modal CTA and qty buttons prevent increments when dish is not serving', () => {
    const mainJs = fs.readFileSync(path.join(rootDir, 'main.js'), 'utf8');
    assert.ok(
      mainJs.includes('modalQtyPlus') &&
      mainJs.includes('is currently outside serving hours'),
      'Modal qty controls must guard against incrementing unstarted or closed dishes'
    );
  });

  await t.test('15. Mobile active-window pill collision defense and out-of-stock badge bleed fix', () => {
    const styleCss = fs.readFileSync(path.join(rootDir, 'style.css'), 'utf8');
    assert.ok(
      styleCss.includes('.recipe-card.is-out-of-stock .recipe-card-badge-pill'),
      'style.css hides promo badge when dish is out-of-stock'
    );
    assert.ok(
      styleCss.includes('.recipe-card.in-cart .recipe-card-schedule-pill.active-window-pill'),
      'style.css offsets active-window pill when stepper is active in cart on mobile'
    );
  });
});
