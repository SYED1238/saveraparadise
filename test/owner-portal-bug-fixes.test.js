import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('OWNER PORTAL AUDIT FIXES VERIFICATION SUITE', async (t) => {
  const dataServicePath = path.resolve(__dirname, '../dataService.js');
  const ownerJsPath = path.resolve(__dirname, '../owner.js');
  const ownerCssPath = path.resolve(__dirname, '../owner.css');
  const adminStorePath = path.resolve(__dirname, '../api/admin-store.js');

  const dataServiceContent = fs.readFileSync(dataServicePath, 'utf8');
  const ownerJsContent = fs.readFileSync(ownerJsPath, 'utf8');
  const ownerCssContent = fs.readFileSync(ownerCssPath, 'utf8');
  const adminStoreContent = fs.readFileSync(adminStorePath, 'utf8');

  await t.test('1. Bug 1 Fix: syncRidersFromSupabase and saveOrUpdateRider rehydrate payoutPaidAt and payoutAmountPaid', () => {
    // Verify syncRidersFromSupabase rehydrates payoutPaidAt and payoutAmountPaid from Supabase columns
    assert.match(dataServiceContent, /payoutPaidAt:\s*r\.payout_paid_at\s*\|\|\s*existing\?\.payoutPaidAt/, 'syncRidersFromSupabase must map payout_paid_at to payoutPaidAt');
    assert.match(dataServiceContent, /payoutAmountPaid:\s*Number\(r\.payout_amount_paid\s*\|\|\s*existing\?\.payoutAmountPaid/, 'syncRidersFromSupabase must map payout_amount_paid to payoutAmountPaid');

    // Verify saveOrUpdateRider preserves payoutPaidAt & payoutAmountPaid
    assert.match(dataServiceContent, /payoutPaidAt:\s*riderData\.payoutPaidAt\s*!==\s*undefined/, 'saveOrUpdateRider must preserve payoutPaidAt');
    assert.match(dataServiceContent, /payoutAmountPaid:\s*riderData\.payoutAmountPaid\s*!==\s*undefined/, 'saveOrUpdateRider must preserve payoutAmountPaid');

    // Verify admin-store sanitizes payout fields
    assert.match(adminStoreContent, /payout_paid_at:\s*rawRider\.payout_paid_at\s*\|\|\s*rawRider\.payoutPaidAt/, 'admin-store must sanitize payout_paid_at');
    assert.match(adminStoreContent, /payout_amount_paid:\s*Number\(rawRider\.payout_amount_paid\s*\|\|\s*rawRider\.payoutAmountPaid/, 'admin-store must sanitize payout_amount_paid');
  });

  await t.test('2. Bug 2 Fix: renderRiderFleetTable does NOT overwrite Overview Counter Cash Drawer elements', () => {
    // Extract renderRiderFleetTable body
    const fnStart = ownerJsContent.indexOf('function renderRiderFleetTable(orders)');
    assert.ok(fnStart > 0, 'renderRiderFleetTable must exist');
    const fnEnd = ownerJsContent.indexOf('function initOrdersFilterControls()', fnStart);
    const fleetTableFn = ownerJsContent.substring(fnStart, fnEnd > 0 ? fnEnd : fnStart + 4000);

    // Verify drawer elements are not stomped in fleet table function
    assert.doesNotMatch(fleetTableFn, /drawerCodEl\.textContent\s*=\s*`₹\${grandCash/, 'renderRiderFleetTable must not overwrite drawer-cod-total with grandCash');
    assert.doesNotMatch(fleetTableFn, /drawerPayoutEl\.textContent\s*=\s*`₹\${grandPayouts/, 'renderRiderFleetTable must not overwrite drawer-payout-total');
    assert.doesNotMatch(fleetTableFn, /drawerNetEl\.textContent\s*=\s*`₹\${grandNetDeposit/, 'renderRiderFleetTable must not overwrite drawer-net-total');

    // Verify updateCounterCashDrawerSummary remains the single authoritative updater
    assert.match(ownerJsContent, /function updateCounterCashDrawerSummary\(orders/, 'updateCounterCashDrawerSummary must exist');
  });

  await t.test('3. Bug 3 Fix: Calendar Reports sanitize dishes, orders, customers, and items against XSS', () => {
    // Extract renderReportDishesTable
    const dishesStart = ownerJsContent.indexOf('function renderReportDishesTable(');
    const dishesEnd = ownerJsContent.indexOf('function renderReportOrdersTable()', dishesStart);
    const dishesFn = ownerJsContent.substring(dishesStart, dishesEnd);

    assert.match(dishesFn, /\$\{escapeHtml\(dish\.name\)\}/, 'renderReportDishesTable must escape dish.name');
    assert.match(dishesFn, /\$\{escapeHtml\(dish\.category\)\}/, 'renderReportDishesTable must escape dish.category');

    // Extract renderReportOrdersTable
    const ordersStart = ownerJsContent.indexOf('function renderReportOrdersTable()');
    const ordersEnd = ownerJsContent.indexOf('function printCalendarReport()', ordersStart);
    const ordersFn = ownerJsContent.substring(ordersStart, ordersEnd);

    assert.match(ordersFn, /\$\{escapeHtml\(cleanId\)\}/, 'renderReportOrdersTable must escape cleanId');
    assert.match(ordersFn, /\$\{escapeHtml\(o\.customerName\s*\|\|\s*'Online Guest'\)\}/, 'renderReportOrdersTable must escape customerName');
    assert.match(ordersFn, /\$\{escapeHtml\(extractPhoneFromOrder\(o\)\s*\|\|\s*'No phone'\)\}/, 'renderReportOrdersTable must escape phone');
    assert.match(ordersFn, /\$\{escapeHtml\(itemsSummary\)\}/, 'renderReportOrdersTable must escape itemsSummary');
    assert.match(ordersFn, /\$\{escapeHtml\(o\.assignedRiderName\)\}/, 'renderReportOrdersTable must escape assignedRiderName');
    assert.match(ordersFn, /\$\{escapeHtml\(status\)\}/, 'renderReportOrdersTable must escape status');
  });

  await t.test('4. Bug 4 Fix: getPeriodDateBounds aligns shift bounds and renderKmPayoutsView synchronizes period with payout status', () => {
    // Verify getPeriodDateBounds('today') accounts for shift start
    const boundsStart = ownerJsContent.indexOf("function getPeriodDateBounds(period)");
    const boundsEnd = ownerJsContent.indexOf("function getFilteredOrders()", boundsStart);
    const boundsFn = ownerJsContent.substring(boundsStart, boundsEnd);

    assert.match(boundsFn, /shiftStartMs/, 'getPeriodDateBounds must account for shiftStartMs');
    assert.match(boundsFn, /Math\.min\(midnightMs,\s*shiftStartMs\)/, 'getPeriodDateBounds must include orders between midnight and 1:00 AM');

    // Verify renderKmPayoutsView handles historical vs live shift periods
    const payoutsStart = ownerJsContent.indexOf("function renderKmPayoutsView(orders)");
    const payoutsEnd = ownerJsContent.indexOf("function printExecutiveReport()", payoutsStart);
    const payoutsFn = ownerJsContent.substring(payoutsStart, payoutsEnd > 0 ? payoutsEnd : payoutsStart + 5000);

    assert.match(payoutsFn, /isLiveShift\s*=\s*\(currentPeriod\s*===\s*'today'\)/, 'renderKmPayoutsView must distinguish live shift from historical periods');
    assert.match(payoutsFn, /paidInPeriod/, 'renderKmPayoutsView must evaluate payment status against period bounds for historical views');
  });

  await t.test('5. Bug 5 Fix: printExecutiveReport sanitizes table and hides PIN and action columns in print styles', () => {
    // Verify printExecutiveReport strips secret PINs and action buttons before rendering
    const printStart = ownerJsContent.indexOf("function printExecutiveReport()");
    const printEnd = ownerJsContent.indexOf("function sanitizeCsvCell", printStart);
    const printFn = ownerJsContent.substring(printStart, printEnd);

    assert.match(printFn, /printRiderTableHtml/, 'printExecutiveReport must generate sanitized table HTML');
    assert.match(printFn, /tableClone\.querySelectorAll\('tr'\)/, 'printExecutiveReport must clone and prune table rows');
    assert.doesNotMatch(printFn, /\$\{document\.getElementById\('owner-rider-table'\)\?\.outerHTML/, 'printExecutiveReport must not inject raw owner-rider-table outerHTML');

    // Verify owner.css hides PIN and action columns during media print
    assert.match(ownerCssContent, /\.badge-rider-pin-table/, 'owner.css print media must target badge-rider-pin-table');
    assert.match(ownerCssContent, /#owner-rider-table th:nth-child\(3\)/, 'owner.css print media must target 3rd column (PIN)');
    assert.match(ownerCssContent, /#owner-rider-table th:nth-child\(11\)/, 'owner.css print media must target 11th column (Actions)');
  });
});
