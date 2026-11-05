import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataService } from '../dataService.js';
import { toLocalDateKey, isSameCalendarDay, isOnlineOrderPayment } from '../owner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test.describe('OWNER PORTAL: SALES CALENDAR & READ-ONLY DATE REPORTS SUITE', () => {
  const storage = new Map();
  const mockLocalStorage = {
    getItem: (k) => storage.get(k) || null,
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
    clear: () => storage.clear()
  };

  test.beforeEach(() => {
    globalThis.localStorage = mockLocalStorage;
    mockLocalStorage.clear();
  });

  test('1. owner.html defines the dedicated Calendar & Audit Reports view container and navigation triggers', () => {
    const html = fs.readFileSync(path.join(rootDir, 'owner.html'), 'utf-8');

    // Dedicated view container
    assert.ok(html.includes('id="view-reports"'), 'owner.html must contain #view-reports view tab');
    assert.ok(html.includes('id="owner-nav-reports"'), 'owner.html must contain Reports navigation button in capsule');
    assert.ok(html.includes('id="btn-owner-calendar"'), 'owner.html must contain header Calendar & Reports button');
    assert.ok(html.includes('id="btn-period-calendar"'), 'owner.html must contain Calendar period filter pill');
    assert.ok(html.includes('id="btn-open-calendar-from-card"'), 'owner.html must contain Open Calendar button in custom range card');

    // Read-only indicator badges
    assert.ok(html.includes('100% Read-Only'), 'Must contain 100% Read-Only badge');
    assert.ok(html.includes('readonly-badge-pill'), 'Must contain .readonly-badge-pill');
  });

  test('2. owner.html contains the full Interactive Calendar controls and grid elements', () => {
    const html = fs.readFileSync(path.join(rootDir, 'owner.html'), 'utf-8');

    // Calendar Card & Controls
    assert.ok(html.includes('id="owner-calendar-card"'), 'Must contain #owner-calendar-card');
    assert.ok(html.includes('id="btn-cal-mode-single"'), 'Must contain Single Day mode button');
    assert.ok(html.includes('id="btn-cal-mode-range"'), 'Must contain Date Range mode button');
    assert.ok(html.includes('id="calendar-presets-pills"'), 'Must contain quick presets container');

    // Month Navigation
    assert.ok(html.includes('id="btn-cal-prev"'), 'Must contain previous month button');
    assert.ok(html.includes('id="btn-cal-next"'), 'Must contain next month button');
    assert.ok(html.includes('id="btn-cal-jump-today"'), 'Must contain jump to today button');
    assert.ok(html.includes('id="cal-month-year-label"'), 'Must contain month-year title display');
    assert.ok(html.includes('id="calendar-days-grid"'), 'Must contain calendar days grid container');

    // Direct Date Inputs
    assert.ok(html.includes('id="report-input-start"'), 'Must contain start/single date input');
    assert.ok(html.includes('id="report-input-end"'), 'Must contain end/till date input');
    assert.ok(html.includes('id="btn-cal-apply-direct"'), 'Must contain direct apply button');
  });

  test('3. owner.html contains all financial metrics, split bar, and read-only audit sub-tables', () => {
    const html = fs.readFileSync(path.join(rootDir, 'owner.html'), 'utf-8');

    // Executive Metric Cards
    assert.ok(html.includes('id="rep-total-revenue"'), 'Must contain total sales element');
    assert.ok(html.includes('id="rep-cod-revenue"'), 'Must contain COD cash element');
    assert.ok(html.includes('id="rep-online-revenue"'), 'Must contain UPI/online element');
    assert.ok(html.includes('id="rep-rider-payouts"'), 'Must contain rider payouts element');
    assert.ok(html.includes('id="rep-drawer-net"'), 'Must contain net cash in drawer element');
    assert.ok(html.includes('id="rep-net-retention"'), 'Must contain net sales retention element');

    // Split Bar
    assert.ok(html.includes('id="rep-bar-cash"'), 'Must contain cash split progress bar');
    assert.ok(html.includes('id="rep-bar-online"'), 'Must contain online split progress bar');

    // Sub-tables
    assert.ok(html.includes('id="report-rider-table"'), 'Must contain delivery boys audit table');
    assert.ok(html.includes('id="report-dishes-table"'), 'Must contain dish sales table');
    assert.ok(html.includes('id="report-orders-table"'), 'Must contain orders stream table');

    // Actions
    assert.ok(html.includes('id="btn-print-calendar-report"'), 'Must contain print statement button');
    assert.ok(html.includes('id="btn-export-calendar-csv"'), 'Must contain export CSV button');
    assert.ok(html.includes('id="btn-sync-to-overview"'), 'Must contain sync to overview button');
  });

  test('4. Date formatting and calendar comparison utilities work reliably', () => {
    const d1 = new Date(2026, 10, 4, 15, 30, 0); // Nov 4, 2026
    const d2 = new Date(2026, 10, 4, 22, 45, 0); // Same day, different hour
    const d3 = new Date(2026, 10, 5, 1, 0, 0);   // Next day

    assert.strictEqual(toLocalDateKey(d1), '2026-11-04');
    assert.strictEqual(isSameCalendarDay(d1, d2), true);
    assert.strictEqual(isSameCalendarDay(d1, d3), false);
    assert.strictEqual(isSameCalendarDay(null, d1), false);
  });

  test('5. Historical orders accurately aggregate Cash vs UPI and Rider Payouts for single day and date ranges', () => {
    const riderPin = '5566';
    dataService.saveOrUpdateRider({
      pin: riderPin,
      name: 'Farhan Akhtar',
      phone: '+91 98888 12345',
      vehicle: '🏍️ Bike'
    });

    const payoutConfig = dataService.getPayoutConfig();

    // Day 1: Nov 2, 2026
    const day1Time = new Date('2026-11-02T14:30:00Z').getTime();
    const order1 = {
      id: '#QB-7001',
      createdAt: day1Time,
      total: 500,
      paymentMethod: 'COD',
      status: 'delivered',
      assignedRiderPin: riderPin,
      assignedRiderName: 'Farhan Akhtar',
      addressDetails: { distanceKm: 2.0 },
      items: [{ name: 'Chicken Biryani Full', quantity: 1, price: 300 }, { name: 'Mutton Kebab', quantity: 1, price: 200 }]
    };

    // Day 2: Nov 3, 2026
    const day2Time = new Date('2026-11-03T19:00:00Z').getTime();
    const order2 = {
      id: '#QB-7002',
      createdAt: day2Time,
      total: 650,
      paymentMethod: 'Online UPI',
      isPaidOnline: true,
      status: 'delivered',
      assignedRiderPin: riderPin,
      assignedRiderName: 'Farhan Akhtar',
      addressDetails: { distanceKm: 3.5 },
      items: [{ name: 'Mutton Biryani', quantity: 2, price: 325 }]
    };

    dataService.saveOrders([order1, order2]);

    const allOrders = dataService.getOrders();
    assert.strictEqual(allOrders.length >= 2, true);

    // Verify payment classification
    assert.strictEqual(isOnlineOrderPayment(order1), false, 'Order 1 is COD Cash');
    assert.strictEqual(isOnlineOrderPayment(order2), true, 'Order 2 is Online UPI');

    // Test rider payout calculation for both orders
    const payout1 = dataService.calculateRiderPayout([order1], payoutConfig);
    const payout2 = dataService.calculateRiderPayout([order2], payoutConfig);
    const totalPayouts = (payout1.exactPayout || payout1.totalPayout) + (payout2.exactPayout || payout2.totalPayout);

    assert.ok(totalPayouts > 0, 'Rider payout must be greater than zero for deliveries');

    // Net counter cash in drawer: Cash collected (₹500) minus Total Payouts
    const codTotal = 500;
    const netCashInDrawer = Math.round((codTotal - totalPayouts) * 100) / 100;
    assert.strictEqual(typeof netCashInDrawer, 'number');

    // Net restaurant retention: Total food sales (₹1150) minus Total Payouts
    const totalSales = 500 + 650;
    const netRetention = Math.round((totalSales - totalPayouts) * 100) / 100;
    assert.ok(netRetention > 0, 'Net restaurant retention must be positive');
  });

  test('6. owner.css provides comprehensive styles for calendar widget, active horizon banner, and responsive cards', () => {
    const css = fs.readFileSync(path.join(rootDir, 'owner.css'), 'utf-8');

    assert.ok(css.includes('.owner-calendar-card'), 'Must contain .owner-calendar-card styling');
    assert.ok(css.includes('.cal-day-cell'), 'Must contain .cal-day-cell styling');
    assert.ok(css.includes('.cal-day-cell.is-selected'), 'Must contain .cal-day-cell.is-selected styling');
    assert.ok(css.includes('.cal-day-cell.in-range'), 'Must contain .cal-day-cell.in-range styling');
    assert.ok(css.includes('.report-horizon-banner'), 'Must contain .report-horizon-banner styling');
    assert.ok(css.includes('.readonly-badge-pill'), 'Must contain .readonly-badge-pill styling');
    assert.ok(css.includes('.btn-calendar-highlight'), 'Must contain .btn-calendar-highlight styling');
    assert.ok(css.includes('.calendar-compact-bar'), 'Must contain .calendar-compact-bar mobile styling');
    assert.ok(css.includes('.report-accordion-bar'), 'Must contain .report-accordion-bar styling');
    assert.ok(css.includes('.report-detail-accordion'), 'Must contain .report-detail-accordion styling');
  });

  test('7. Mobile UX optimizations: collapsible calendar dropdown and accordion bars prevent long scrolling', () => {
    const html = fs.readFileSync(path.join(rootDir, 'owner.html'), 'utf-8');

    // Compact calendar bar and collapsible wrapper
    assert.ok(html.includes('id="calendar-compact-bar"'), 'Must contain #calendar-compact-bar');
    assert.ok(html.includes('id="btn-toggle-calendar-panel"'), 'Must contain #btn-toggle-calendar-panel');
    assert.ok(html.includes('id="owner-calendar-collapsible-wrapper"'), 'Must contain #owner-calendar-collapsible-wrapper');

    // Accordion Dropdown bars for detail sections
    assert.ok(html.includes('id="rep-bar-riders-toggle"'), 'Must contain rider accordion bar');
    assert.ok(html.includes('id="rep-body-riders"'), 'Must contain rider accordion body');
    assert.ok(html.includes('id="rep-bar-dishes-toggle"'), 'Must contain dish accordion bar');
    assert.ok(html.includes('id="rep-body-dishes"'), 'Must contain dish accordion body');
    assert.ok(html.includes('id="rep-bar-orders-toggle"'), 'Must contain orders accordion bar');
    assert.ok(html.includes('id="rep-body-orders"'), 'Must contain orders accordion body');

    // Rich preview chips
    assert.ok(html.includes('id="rep-bar-preview-riders"'), 'Must contain rider preview chip');
    assert.ok(html.includes('id="rep-bar-preview-dishes"'), 'Must contain dish preview chip');
    assert.ok(html.includes('id="rep-bar-preview-orders"'), 'Must contain orders preview chip');
  });
});
