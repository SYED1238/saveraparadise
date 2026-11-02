import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

import { formatTime12h, getDishScheduleStatus, dataService } from '../dataService.js';

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
    const wednesday = new Date('2026-11-04T12:00:00');
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
    const friday = new Date('2026-11-06T12:00:00');
    assert.equal(friday.getDay(), 5); // fri
    const friRes = getDishScheduleStatus(weekendSpecial, friday);
    assert.equal(friRes.isAvailable, true);
    assert.equal(friRes.status, 'available');
  });

  await t.test('4. getDishScheduleStatus computes live countdown when before serving hours', () => {
    // Current time: 10:00 AM on Wednesday
    const morning = new Date('2026-11-04T10:00:00');

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
    const lunchTime = new Date('2026-11-04T13:30:00');

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
    const eveningTime = new Date('2026-11-04T17:00:00');

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

    // Clean up
    dataService.deleteDish(created.id);
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
});
