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
    assert.match(adminStoreContent, /payout_paid_at:\s*rawRider\.payoutPaidAt\s*\?\?\s*rawRider\.payout_paid_at/, 'admin-store must sanitize payout_paid_at');
    assert.match(adminStoreContent, /payout_amount_paid:\s*Number\(rawRider\.payoutAmountPaid\s*\?\?\s*rawRider\.payout_amount_paid\)/, 'admin-store must sanitize payout_amount_paid');
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

    // Verify isLiveShift is scoped to renderKmPayoutsView so both map functions and render loops have access without ReferenceError
    const validRidersIndex = payoutsFn.indexOf("validRiders.map");
    const isLiveShiftIndex = payoutsFn.indexOf("isLiveShift = (currentPeriod === 'today')");
    assert.ok(isLiveShiftIndex > 0 && isLiveShiftIndex < validRidersIndex, 'isLiveShift must be declared at renderKmPayoutsView function scope before validRiders.map');
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

  await t.test('6. Settlement Persistence & Owner Token Prioritization in dataService & admin-store', () => {
    // Check that _adminStoreAction prioritizes owner token for save_settings & clear_orders
    assert.match(dataServiceContent, /isOwnerAction\s*=\s*action\s*===\s*'save_settings'/, '_adminStoreAction must detect owner actions');
    assert.match(dataServiceContent, /ensureAdminToken\(isOwnerAction \? 'owner' : 'admin'\)/, '_adminStoreAction must call ensureAdminToken with owner role');

    // Check that admin-store accepts both camelCase and snake_case via nullish coalescing
    assert.match(adminStoreContent, /cash_settled_at:\s*rawRider\.cashSettledAt\s*\?\?\s*rawRider\.cash_settled_at/, 'admin-store must handle camelCase cashSettledAt');
    assert.match(adminStoreContent, /payout_paid_at:\s*rawRider\.payoutPaidAt\s*\?\?\s*rawRider\.payout_paid_at/, 'admin-store must handle camelCase payoutPaidAt');
  });

  await t.test('7. Rider App Settings Sync on Login / Refresh and Realtime publication in SQL', () => {
    const deliveryJsPath = path.resolve(__dirname, '../delivery.js');
    const sqlPath = path.resolve(__dirname, '../supabase_setup.sql');
    const deliveryContent = fs.readFileSync(deliveryJsPath, 'utf8');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');

    // Verify delivery.js syncs settings on login and refresh
    assert.match(deliveryContent, /syncSettingsFromSupabase\(true\)/, 'delivery.js must sync settings on login and refresh');

    // Verify heartbeat in dataService syncs settings for delivery/owner
    assert.match(dataServiceContent, /syncSettingsFromSupabase\(\)\.catch/, 'dataService heartbeat must sync settings');

    // Verify store_settings is added to supabase_realtime
    assert.match(sqlContent, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.store_settings/, 'supabase_setup.sql must include store_settings in realtime publication');
  });

  await t.test('8. Payout Rounding Unification & Milestone Order Indexing', () => {
    const deliveryJsPath = path.resolve(__dirname, '../delivery.js');
    const deliveryContent = fs.readFileSync(deliveryJsPath, 'utf8');

    // Verify owner.js uses exactPayout for calculatedPayout
    assert.match(ownerJsContent, /calculatedPayout\s*=\s*safeNumber\(payoutResult\?\.exactPayout\s*\?\?\s*payoutResult\?\.totalPayout\)/, 'owner.js must use exactPayout');

    // Verify delivery.js includes undelivered orders in completed shift counts
    assert.match(deliveryContent, /o\.status !== 'delivered' && o\.status !== 'undelivered'/, 'delivery.js must count undelivered orders in milestone progress');

    // Verify delivery.js sorts deliveredOrders by completion time
    assert.match(deliveryContent, /tsB - tsA/, 'delivery.js must sort delivered orders chronologically');
  });

  await t.test('9. Owner Portal Live Parity with Rider App & Polling Frequency', () => {
    // 1. getFilteredOrders matches deliveredAt for completed orders
    assert.match(ownerJsContent, /isDelivered\s*&&\s*orderDeliveredAt\s*>\s*0/, 'owner.js must include deliveredAt in date window for delivered orders');

    // 2. renderKmPayoutsView prioritizes payoutSummary on live shift
    assert.match(ownerJsContent, /deliveredCount:\s*\(isLiveShift\s*&&\s*payoutSummary\)\s*\?\s*safeNumber\(payoutSummary\.deliveredCount\)/, 'owner.js must use payoutSummary.deliveredCount on live shift');
    assert.match(ownerJsContent, /kms:\s*\(isLiveShift\s*&&\s*payoutSummary\)\s*\?\s*safeNumber\(payoutSummary\.totalKms\)/, 'owner.js must use payoutSummary.totalKms on live shift');

    // 3. updateNavigationBadges uses dataService.getOrders() for live active orders
    assert.match(ownerJsContent, /dataService\.getOrders\(\)/, 'owner.js updateNavigationBadges must read all live orders');

    // 4. dataService owner heartbeat interval is 15s
    assert.match(dataServiceContent, /this\.portalType === 'owner'\)\s*\?\s*15000/, 'dataService must poll at 15s for owner portal');

    // 5. dataService forces sync orders on owner heartbeat
    assert.match(dataServiceContent, /syncOrdersFromSupabase\(this\.portalType === 'admin' \|\| this\.portalType === 'delivery' \|\| this\.portalType === 'owner'\)/, 'dataService must force sync orders on owner heartbeat');
  });

  await t.test('10. BUG-01 Fix: Production Mock Payout Bypass & Fallback VPA Sanitization', () => {
    const cashfreeNodePath = path.resolve(__dirname, '../api/_cashfree.js');
    const cashfreeEdgePath = path.resolve(__dirname, '../functions/api/_cashfree.js');
    const nodeContent = fs.readFileSync(cashfreeNodePath, 'utf8');
    const edgeContent = fs.readFileSync(cashfreeEdgePath, 'utf8');

    assert.match(nodeContent, /if\s*\(cfg\.isProd\)\s*\{\s*return\s*\{\s*success:\s*false/);
    assert.match(edgeContent, /if\s*\(cfg\.isProd\)\s*\{\s*return\s*\{\s*success:\s*false/);
    assert.match(ownerJsContent, /cleanDigits\.length === 10 \? `\$\{cleanDigits\}@upi` : `\$\{pin\}@upi`/);
  });

  await t.test('11. BUG-02 Fix: Undelivered orders excluded from rider cash-in-hand and KMs', () => {
    assert.match(ownerJsContent, /const isCompletedDelivery = String\(o\.status \|\| ''\)\.toLowerCase\(\) === 'delivered';\s*if \(!isCompletedDelivery\) return;/);
    assert.match(ownerJsContent, /if \(String\(o\?\.status \|\| ''\)\.toLowerCase\(\) !== 'delivered'\) return;\s*riderKms \+= Number/);
  });

  await t.test('12. BUG-03 Fix: Mid-handover deliveries captured via Math.max in Cash Tab UI', () => {
    assert.match(ownerJsContent, /Math\.max\(Number\(r\.cashHandoverAmount\) \|\| 0, summaryCash\)/);
    assert.match(ownerJsContent, /const rawCashInHand = Math\.max\(handoverAmt, summaryAmt\);/);
  });

  await t.test('13. BUG-04 Fix: cashTakenAt persisted on sync and backed by cashSettledAt fallback', () => {
    assert.match(dataServiceContent, /cashTakenAt:\s*r\.cash_settled_at\s*\|\|\s*existing\?\.cashTakenAt/);
    assert.match(ownerJsContent, /const takenTs = r\.cashTakenAt \|\| r\.cashSettledAt;/);
  });

  await t.test('14. BUG-05 Fix: Historical periods disable live settlement buttons to protect ledger', () => {
    assert.match(ownerJsContent, /currentPayable = 0;\s*\/\/\s*Never allow live shift payout mutations/);
    assert.match(ownerJsContent, /Switch to Today to Settle/);
  });

  await t.test('15. BUG-06 Fix: ISO timestamp parsing defends against NaN in cash and notifications', () => {
    assert.match(ownerJsContent, /export function parseOrderTimestampMs\(val\)/);
    assert.match(ownerJsContent, /const createdMs = parseOrderTimestampMs\(o\.createdAt \|\| o\.created_at\);/);
  });

  await t.test('16. BUG-07 Fix: Unassigned orders skipped and PIN/name merged in ordersByRider', () => {
    assert.match(ownerJsContent, /if \(!key\) return; \/\/ Skip unassigned orders/);
  });

  await t.test('17. BUG-08 Fix: Print Statement renders fleet table, hides secret PINs, and hides .print-only', () => {
    assert.match(ownerJsContent, /renderRiderFleetTable\(orders\);/);
    assert.match(ownerJsContent, /clone\.querySelectorAll\('span'\)\.forEach\(s => \{\s*if \(s\.textContent\.includes\('PIN:'\)\) s\.remove\(\);/);
    assert.match(ownerCssContent, /\.print-only\s*\{\s*display:\s*none\s*!important;\s*\}/);
  });

  await t.test('18. BUG-09 Fix: Date filtering and shift start bounds aligned between Overview and Reports', () => {
    assert.match(ownerJsContent, /export function getOrderAuditTimestampMs\(o\)/);
    assert.match(ownerJsContent, /const orderTimestamp = getOrderAuditTimestampMs\(o\);/);
  });

  await t.test('19. BUG-10 Fix: Mobile Payout cards display amber Partial badge for unpaid balance', () => {
    assert.match(ownerJsContent, /\(st\.isPaid && st\.hasUnpaidBalance\)\s*\?\s*`<span class="badge-payout-pending"/);
    assert.match(ownerJsContent, /border-left: 4px solid #F59E0B;/);
  });

  await t.test('20. BUG-11 Fix: Mobile Fleet cards enforce 100% COD deposit without netting payouts', () => {
    assert.match(ownerJsContent, /if \(cash > 0\) \{\s*statusClass = 'deposit';\s*statusTitle = 'COD CASH TO DEPOSIT';/);
    assert.doesNotMatch(ownerJsContent, /netDeposit < 0\s*\}\s*else if\s*\(netDeposit === 0/);
  });

  await t.test('21. BUG-12 Fix: Rider submit awaits server save and syncs assigned_rider_name when PIN unchanged', () => {
    const adminStoreEdgePath = path.resolve(__dirname, '../functions/api/admin-store.js');
    const edgeAdminContent = fs.readFileSync(adminStoreEdgePath, 'utf8');

    assert.match(adminStoreContent, /else if \(userRole !== 'rider' && existingRow && existingRow\.name !== name\)/);
    assert.match(edgeAdminContent, /else if \(userRole !== 'rider' && existingRow && existingRow\.name !== name\)/);
  });

  await t.test('22. BUG-13 Fix: navigationBackService integrated in owner.js with fallback checkers', () => {
    assert.match(ownerJsContent, /import\s*\{\s*createBackNavigationManager\s*\}\s*from '\.\/navigationBackService\.js';/);
    assert.match(ownerJsContent, /ownerBackNav = \(typeof window !== 'undefined'\) \? createBackNavigationManager\('owner'\)/);
  });

  await t.test('23. BUG-14 Fix: Pagination uses light background and scrolls section-orders', () => {
    assert.match(ownerJsContent, /background:#F8FAFC;\s*border:1px solid var\(--owner-border\);/);
    assert.match(ownerJsContent, /const scrollToOrdersTop = \(\) => \{\s*const target = document\.getElementById\('section-orders'\)/);
    assert.match(ownerCssContent, /\.btn-owner-pagination\s*\{\s*padding:\s*6px\s*14px;\s*background:\s*#FFFFFF;/);
  });

  await t.test('24. BUG-15 Fix: Negative net drawer sub-total formatted with minus and sound test wired', () => {
    assert.match(ownerJsContent, /drawerNetSubEl\.textContent = periodNetTotal >= 0\s*\?\s*`₹\$\{periodNetTotal\.toLocaleString\('en-IN'\)\}`\s*:\s*`−₹\$\{Math\.abs\(periodNetTotal\)\.toLocaleString\('en-IN'\)\}`;/);
    assert.match(ownerJsContent, /setSoundEnabled\(true\);/);
  });
});
