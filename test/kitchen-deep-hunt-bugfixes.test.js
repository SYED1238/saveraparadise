import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const adminJs = fs.readFileSync(path.join(rootDir, 'admin.js'), 'utf-8');
const adminHtml = fs.readFileSync(path.join(rootDir, 'admin.html'), 'utf-8');
const adminCss = fs.readFileSync(path.join(rootDir, 'admin.css'), 'utf-8');
const dataServiceJs = fs.readFileSync(path.join(rootDir, 'dataService.js'), 'utf-8');
const securityUtilsJs = fs.readFileSync(path.join(rootDir, 'securityUtils.js'), 'utf-8');
const cloudflareR2ServiceJs = fs.readFileSync(path.join(rootDir, 'cloudflareR2Service.js'), 'utf-8');
const apiOrderActionJs = fs.readFileSync(path.join(rootDir, 'api', 'order-action.js'), 'utf-8');
const functionsApiOrderActionJs = fs.readFileSync(path.join(rootDir, 'functions', 'api', 'order-action.js'), 'utf-8');
const apiAdminStoreJs = fs.readFileSync(path.join(rootDir, 'api', 'admin-store.js'), 'utf-8');
const functionsApiAdminStoreJs = fs.readFileSync(path.join(rootDir, 'functions', 'api', 'admin-store.js'), 'utf-8');
const supabaseSetupSql = fs.readFileSync(path.join(rootDir, 'supabase_setup.sql'), 'utf-8');
const supabaseSecuritySql = fs.readFileSync(path.join(rootDir, 'supabase_production_security_hardening.sql'), 'utf-8');
const orderMonitorServiceJava = fs.readFileSync(path.join(rootDir, 'android', 'app', 'src', 'main', 'java', 'com', 'sascrispy', 'portal', 'OrderMonitorService.java'), 'utf-8');

test('KITCHEN PORTAL DEEP BUG HUNT VERIFICATION SUITE (20 Verified Findings)', async (t) => {
  // CRIT-01: Order Urgency Timer Clamping Bug
  await t.test('1. [CRIT-01] Order urgency timer does not clamp ageMins to 5 on new orders and allows 3m warning tier', () => {
    assert.match(adminJs, /const\s+actualAgeMins\s*=\s*Math\.floor\(ageMs\s*\/\s*60000\)/, 'Must compute actualAgeMins without Math.max(5, ...) clamp');
    assert.match(adminJs, /if\s*\(actualAgeMins\s*>=\s*5\)\s*\{[\s\S]*?else\s+if\s*\(actualAgeMins\s*>=\s*3\)/, 'Must check actualAgeMins >= 5 followed by actualAgeMins >= 3');
    assert.doesNotMatch(adminJs, /const\s+ageMins\s*=\s*Math\.max\(5,\s*Math\.floor\(ageMs\s*\/\s*60000\)\)/, 'Must not clamp ageMins to Math.max(5, ...)');
  });

  // CRIT-02: Missing window.__stopKitchenAlarmFromNative Bridge Hook
  await t.test('2. [CRIT-02] window.__stopKitchenAlarmFromNative bridge hook is defined and triggers stopKitchenAlarm', () => {
    assert.match(adminJs, /window\.__stopKitchenAlarmFromNative\s*=\s*function\s*\(\)\s*\{[\s\S]*?stopKitchenAlarm\(true\);/, 'window.__stopKitchenAlarmFromNative must be defined');
  });

  // CRIT-03: Server-Side State Machine & Unverified Doorstep UPI Forgery by Admin Role
  await t.test('3. [CRIT-03] Dual-API Parity: order-action restricts admin role transitions and isolates manual Doorstep UPI to owner', () => {
    for (const [name, content] of [['api/order-action.js', apiOrderActionJs], ['functions/api/order-action.js', functionsApiOrderActionJs]]) {
      assert.match(content, /if\s*\(auth\.payload\?\.role\s*===\s*['"]admin['"]\)\s*\{[\s\S]*?allowedKitchenTargets\s*=\s*\['accepted',\s*'cooking',\s*'ready_for_pickup'\]/, `${name} must restrict admin role to accepted, cooking, ready_for_pickup`);
      assert.match(content, /isDoorstep\s*=\s*isCfSuccess\s*\|\|\s*\(auth\.payload\?\.role\s*===\s*['"]owner['"]\s*&&\s*Boolean\(doorstepUpi\s*\?\?\s*existing\.doorstep_upi\)\)/, `${name} must restrict unverified Doorstep UPI manual override strictly to owner role`);
      assert.match(content, /if\s*\(\['delivered',\s*'cancelled'\]\.includes\(order\.status\)\)\s*\{[\s\S]*?Cannot cancel an order that is already/, `${name} must reject cancelling already delivered or cancelled orders`);
      assert.match(content, /if\s*\(!isOwner\s*&&\s*!\['pending',\s*'accepted'\]\.includes\(order\.status\)\)\s*\{[\s\S]*?Cannot cancel order once kitchen preparation has begun/, `${name} must block non-owner cancelling cooking/ready orders`);
    }
  });

  // CRIT-04: Kitchen Admin Role Rider Mutation Privilege Escalation & Secret Rider PIN Leakage
  await t.test('4. [CRIT-04] Dual-API Parity: Rider mutation is owner-only, rider PINs and bank details are redacted for admin role and public poll', () => {
    for (const [name, content] of [['api/admin-store.js', apiAdminStoreJs], ['functions/api/admin-store.js', functionsApiAdminStoreJs]]) {
      assert.match(content, /const\s+ownerOnlyActions\s*=\s*\[[\s\S]*?'save_rider'[\s\S]*?'delete_rider'[\s\S]*?'toggle_rider_status'/, `${name} ownerOnlyActions must include save_rider, delete_rider, toggle_rider_status`);
      assert.match(content, /if\s*\(userRole\s*===\s*['"]owner['"]\)\s*return\s+r;[\s\S]*?const\s*\{\s*pin,\s*upi_vpa,\s*bank_account_no,\s*bank_ifsc,\s*\.\.\.rest\s*\}\s*=\s*r;[\s\S]*?return\s*\{\s*\.\.\.rest,\s*pin_masked:\s*true\s*\}/, `${name} list_riders must redact secret PIN and bank details when userRole is not owner`);
    }
    for (const [name, content] of [['api/order-action.js', apiOrderActionJs], ['functions/api/order-action.js', functionsApiOrderActionJs]]) {
      assert.match(content, /assigned_rider_pin:\s*row\.assigned_rider_pin\s*\?\s*['"]ASSIGNED['"]\s*:\s*['"]['"]/, `${name} kitchen_poll must mask assigned_rider_pin as ASSIGNED`);
      assert.doesNotMatch(content, /assigned_rider_pin:\s*row\.assigned_rider_pin\s*,[\s\S]*?pickup_code:\s*row\.pickup_code/, `${name} kitchen_poll must not leak raw assigned_rider_pin or pickup_code`);
    }
    assert.doesNotMatch(adminJs, /<div\s+class="admin-rider-card"\s+data-pin=/, 'admin.js must not render data-pin in DOM');
    assert.match(adminJs, /<div\s+class="admin-rider-card"\s+data-rider-id=/, 'admin.js must render data-rider-id in DOM');
  });

  // CRIT-05: Silent Cloud Sync Failure Swallow Across All 7 Store Settings Forms
  await t.test('5. [CRIT-05] dataService._adminStoreAction uses admin token for save_settings and assertCloudSettingsSynced guards all 7 settings forms', () => {
    assert.match(dataServiceJs, /const\s+isOwnerAction\s*=\s*action\s*===\s*'save_settings'\s*\?\s*\(this\.portalType\s*===\s*'owner'[\s\S]*?save_rider[\s\S]*?delete_rider/, 'isOwnerAction must isolate owner actions and allow staff save_settings');
    assert.match(dataServiceJs, /const\s+requiredRole\s*=\s*isOwnerAction\s*\?\s*['"]owner['"]\s*:\s*['"]admin['"]/, 'requiredRole must default to admin for save_settings in kitchen portal');
    assert.match(dataServiceJs, /_syncedToCloud:\s*true,\s*_localOnly:\s*false/, 'syncSettingsToSupabase must return _syncedToCloud: true, _localOnly: false on success');
    assert.match(adminJs, /function\s+assertCloudSettingsSynced\(res\)\s*\{[\s\S]*?throw\s+new\s+Error\(/, 'assertCloudSettingsSynced must throw on _localOnly or _syncedToCloud === false');
    assert.match(adminJs, /setRushPause[\s\S]*?assertCloudSettingsSynced\(res\)/, 'btnTriggerRush must call assertCloudSettingsSynced');
    assert.match(adminJs, /extendRushPause[\s\S]*?assertCloudSettingsSynced\(res\)/, 'btnExtendRush10 must call assertCloudSettingsSynced');
    assert.match(adminJs, /resumeOrders[\s\S]*?assertCloudSettingsSynced\(res\)/, 'btnResumeOrders must call assertCloudSettingsSynced');
    assert.match(adminJs, /setDeliveryRadius[\s\S]*?assertCloudSettingsSynced\(res\)/, 'btnSaveRadius must call assertCloudSettingsSynced');
    assert.match(adminJs, /setOffer[\s\S]*?assertCloudSettingsSynced\(res\)/, 'formStoreOffer must call assertCloudSettingsSynced');
    assert.match(adminJs, /setUnlockedDeals[\s\S]*?assertCloudSettingsSynced\(res\)/, 'formUnlockedDeals must call assertCloudSettingsSynced');
    assert.match(adminJs, /setDeliverySettings[\s\S]*?assertCloudSettingsSynced\(res\)/, 'formStoreDelivery must call assertCloudSettingsSynced');
  });

  // CRIT-06: ensureAdminToken('admin') Ignores quickbite_owner_token
  await t.test('6. [CRIT-06] ensureAdminToken("admin") recognizes quickbite_owner_token as valid staff session', () => {
    assert.match(securityUtilsJs, /requiredRole\s*===\s*['"]admin['"]\s*&&\s*typeof\s+sessionStorage\s*!==\s*['"]undefined['"]\s*\?\s*sessionStorage\.getItem\(['"]quickbite_owner_token['"]\)/, 'ensureAdminToken must check quickbite_owner_token when requiredRole is admin');
  });

  // HIGH-01: Order Cancellation Missing serverPromise & Rollback
  await t.test('7. [HIGH-01] updateOrderStatus("cancelled") attaches serverPromise, rolls back state on server rejection, and resets modal reason pills', () => {
    assert.match(dataServiceJs, /order\.serverPromise\s*=\s*cancelPromise/, 'dataService updateOrderStatus must attach serverPromise for cancelled status');
    assert.match(dataServiceJs, /order\.status\s*=\s*prevStatus;[\s\S]*?order\.stepIndex\s*=\s*prevStepIndex;[\s\S]*?order\.statusLabel\s*=\s*prevStatusLabel;[\s\S]*?order\.eta\s*=\s*prevEta;[\s\S]*?delete\s+order\.cancellationReason;/, 'updateOrderStatus must rollback state and delete cancel fields on server rejection');
    const doUpdateMatch = dataServiceJs.match(/const\s+doUpdate\s*=\s*async\s*\([^)]*\)\s*=>\s*\{([\s\S]*?)\n\s{6}\};/);
    assert.ok(doUpdateMatch, 'doUpdate must be defined');
    assert.doesNotMatch(doUpdateMatch[1], /order\.status\s*===\s*['"]cancelled['"]/, 'Dead code inside doUpdate must be removed');
    assert.match(adminJs, /openCancelOrderModal[\s\S]*?cancelReasonPills\.forEach\(\(p,\s*idx\)\s*=>\s*\{[\s\S]*?idx\s*===\s*0[\s\S]*?p\.classList\.add\(['"]active['"]\)/, 'openCancelOrderModal must reset active class to first pill');
    assert.match(adminJs, /btnConfirmCancelOrder[\s\S]*?await\s+updated\.serverPromise/, 'btnConfirmCancelOrder must await updated.serverPromise');
  });

  // HIGH-02: deleteCategory() Rollback Wipes Category Dishes & Image
  await t.test('8. [HIGH-02] deleteCategory snapshots prevDishes and prevCatImages and restores them if server delete fails', () => {
    assert.match(dataServiceJs, /const\s+prevCategories\s*=\s*\[\.\.\.list\];[\s\S]*?const\s+prevDishes\s*=\s*this\.getDishes\(\);[\s\S]*?const\s+prevCatImages\s*=\s*this\.getCategoryImages\(\);/, 'deleteCategory must snapshot prevCategories, prevDishes, and prevCatImages');
    assert.match(dataServiceJs, /catch\s*\(e\)\s*\{[\s\S]*?this\.saveCategories\(prevCategories\);[\s\S]*?this\.saveDishes\(prevDishes\);[\s\S]*?localStorage\.setItem\(STORAGE_KEYS\.CATEGORY_IMAGES,\s*JSON\.stringify\(prevCatImages\)\);/, 'deleteCategory catch block must restore categories, dishes, and category images');
  });

  // HIGH-03: syncCategoryImagesFromSupabase Overwriting Remote State
  await t.test('9. [HIGH-03] syncCategoryImagesFromSupabase does not spread localMap after sanitizedRemote', () => {
    assert.match(dataServiceJs, /const\s+merged\s*=\s*\{\s*\.\.\.CANONICAL_CATEGORY_IMAGES,\s*\.\.\.sanitizedRemote\s*\};/, 'Must merge canonical with remote only so cloud is authoritative');
    assert.doesNotMatch(dataServiceJs, /const\s+merged\s*=\s*\{\s*\.\.\.CANONICAL_CATEGORY_IMAGES,\s*\.\.\.sanitizedRemote,\s*\.\.\.localMap\s*\};/, 'Must not append ...localMap after ...sanitizedRemote');
  });

  // HIGH-04: public.categories Missing image Column in SQL & Missing 42703 Fallback
  await t.test('10. [HIGH-04] Categories table includes image TEXT column and admin-store handles 42703 column fallback', () => {
    assert.match(supabaseSetupSql, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.categories\s*\([\s\S]*?image\s+TEXT/i, 'supabase_setup.sql categories table must have image TEXT column');
    assert.match(supabaseSecuritySql, /ALTER\s+TABLE\s+public\.categories\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+image\s+TEXT/i, 'supabase_production_security_hardening.sql must add image TEXT to categories');
    for (const [name, content] of [['api/admin-store.js', apiAdminStoreJs], ['functions/api/admin-store.js', functionsApiAdminStoreJs]]) {
      assert.match(content, /function\s+sanitizeCategoryFields\(input\)/, `${name} must define sanitizeCategoryFields`);
      assert.match(content, /error\.code\s*===\s*['"]42703['"]\s*\|\|\s*String\(error\.message\s*\|\|\s*['"]['"]\)\.includes\(['"]image['"]\)/, `${name} must retry add_category/update_category on missing image column error`);
    }
  });

  // HIGH-05: Android OrderMonitorService Fires Siren on Already-Started Orders
  await t.test('11. [HIGH-05] Android OrderMonitorService strictly alerts only on pending and accepted orders', () => {
    assert.match(orderMonitorServiceJava, /if\s*\(\s*"pending"\.equalsIgnoreCase\(status\)\s*\|\|\s*"accepted"\.equalsIgnoreCase\(status\)\s*\)/, 'OrderMonitorService.java must filter new orders to pending and accepted only');
    assert.doesNotMatch(orderMonitorServiceJava, /!"cancelled"\.equalsIgnoreCase\(status\)\s*&&\s*!"delivered"\.equalsIgnoreCase\(status\)/, 'OrderMonitorService.java must not alert on cooking, ready_for_pickup, on_the_way, or undelivered');
  });

  // HIGH-06: Cloudflare R2 401 Refresh, Premature Delete on Dish Delete & Dropped r2Key
  await t.test('12. [HIGH-06] ensureAdminToken supports forceRefresh, R2 retries without pre-deleting token, and r2Key is preserved in dishes', () => {
    assert.match(securityUtilsJs, /export\s+async\s+function\s+ensureAdminToken\(requiredRole\s*=\s*['"]admin['"],\s*forceRefresh\s*=\s*false\)/, 'ensureAdminToken must accept forceRefresh parameter');
    assert.match(securityUtilsJs, /if\s*\(!forceRefresh\s*&&[\s\S]*?payload\.exp\s*-\s*Date\.now\(\)\s*>\s*60000\)/, 'ensureAdminToken must bypass early return when forceRefresh is true');
    assert.doesNotMatch(cloudflareR2ServiceJs, /sessionStorage\.removeItem\(['"]quickbite_admin_token['"]\);\s*token\s*=\s*await\s+ensureAdminToken/, 'R2 service must not remove quickbite_admin_token before calling ensureAdminToken');
    assert.match(cloudflareR2ServiceJs, /(?:token|refreshed|refreshedToken)\s*=\s*await\s+ensureAdminToken\(['"]admin['"],\s*true\)/, 'R2 service must pass forceRefresh = true on 401');
    assert.match(dataServiceJs, /r2Key:\s*dishData\.r2Key\s*\|\|\s*['"]['"]/, 'dataService addDish must preserve r2Key');
    assert.match(dataServiceJs, /r2Key:\s*(?:d|row)\.r2_key\s*\|\|\s*(?:d\.)?r2Key\s*\|\|\s*['"]['"]/, 'dataService syncDishesFromSupabase must preserve r2Key');
    assert.match(adminJs, /await\s+dataService\.deleteDish\(id\);[\s\S]*?cloudflareR2Service\.deleteImage/, 'admin.js deleteDishPrompt must await dataService.deleteDish before deleting R2 image');
  });

  // MED-01: Thermal KOT Multi-Page Blank Feed & Synced Order Fees
  await t.test('13. [MED-01] @media print hides dashboard containers with display: none and syncOrdersFromSupabase hoists fees for KOT print', () => {
    assert.match(adminCss, /@media\s+print\s*\{[\s\S]*?\.admin-header,[\s\S]*?\.admin-main,[\s\S]*?display:\s*none\s*!important;/, 'admin.css @media print must use display: none !important on dashboard containers');
    assert.match(dataServiceJs, /deliveryFee:\s*Number\((?:remote|row)\.delivery_fee\s*\?\?\s*(?:remote\.address_details\?\.|addrObj\.)deliveryFee/, 'syncOrdersFromSupabase must hoist deliveryFee from address_details');
    assert.match(dataServiceJs, /packagingFee:\s*Number\((?:remote|row)\.packaging_fee/, 'syncOrdersFromSupabase must hoist packagingFee from address_details');
    assert.match(dataServiceJs, /discount:\s*Number\((?:remote|row)\.discount\s*\?\?\s*(?:remote\.address_details\?\.|addrObj\.)discount/, 'syncOrdersFromSupabase must hoist discount from address_details');
    assert.match(adminJs, /printOrderKOT[\s\S]*?order\.addressDetails\s*&&\s*order\.addressDetails\.deliveryFee/, 'printOrderKOT must fall back to order.addressDetails fees');
  });

  // MED-02: Order Receipt Modal Mislabels Unpaid Doorstep UPI & COD as Paid
  await t.test('14. [MED-02] Order receipt modal updates label to Amount to Collect and shows unpaid badge for undelivered Doorstep UPI', () => {
    assert.match(adminHtml, /id="order-detail-total-label"/, 'admin.html must have id="order-detail-total-label"');
    assert.match(adminJs, /totalLabelEl\.textContent\s*=\s*isPaid\s*\?\s*['"]Total Amount Paid['"]\s*:\s*['"]Amount to Collect['"]/, 'openOrderManageModal must toggle Total Amount Paid vs Amount to Collect');
    assert.match(adminJs, /Collect via UPI QR \(Unpaid\)/, 'openOrderManageModal must display Collect via UPI QR (Unpaid) when order is not yet paid');
  });

  // MED-03: Shift Revenue KPI Resets at 12:00 AM Midnight Instead of 1:00 AM Shift Boundary
  await t.test('15. [MED-03] calculateOrderKPIs imports and uses getShiftStartTimeMs for shift revenue calculation', () => {
    assert.match(adminJs, /import\s*\{[\s\S]*?getShiftStartTimeMs[\s\S]*?\}\s*from\s*['"]\.\/dataService\.js['"]/, 'admin.js must import getShiftStartTimeMs from dataService.js');
    assert.match(adminJs, /const\s+todayStart\s*=\s*getShiftStartTimeMs\(now\);/, 'calculateOrderKPIs must use getShiftStartTimeMs(now)');
    assert.doesNotMatch(adminJs, /const\s+todayStart\s*=\s*new\s+Date\(now\.getFullYear\(\),\s*now\.getMonth\(\),\s*now\.getDate\(\)\)\.getTime\(\);/, 'Must not reset shift revenue at midnight new Date()');
  });

  // MED-04: updateRushUI and syncHoursSummaryChips Overwriting #rush-mode-badge
  await t.test('16. [MED-04] updateRushUI clears inline styles and syncHoursSummaryChips does not mutate #rush-mode-badge', () => {
    assert.match(adminJs, /rushModeBadge\.style\.background\s*=\s*['"]['"];\s*rushModeBadge\.style\.color\s*=\s*['"]['"];\s*rushModeBadge\.style\.borderColor\s*=\s*['"]['"];/, 'updateRushUI must clear inline styles on rushModeBadge');
    assert.doesNotMatch(adminJs, /syncHoursSummaryChips[\s\S]*?rushModeBadge\.style\.background\s*=\s*['"]#EF4444['"]/, 'syncHoursSummaryChips must not mutate rushModeBadge');
  });

  // MED-05: Unlocked Deals Minimum Cart Input Clamping
  await t.test('17. [MED-05] Unlocked deals threshold clamps with >= 10 across dataService and admin.js', () => {
    assert.match(adminJs, /const\s+minOrder\s*=\s*Number\.isFinite\(rawMin\)\s*&&\s*rawMin\s*>=\s*10\s*\?\s*Math\.round\(rawMin\)\s*:\s*199;/, 'updateUnlockedDealsPreview must clamp with rawMin >= 10');
    assert.match(dataServiceJs, /const\s+minOrder\s*=\s*Number\.isFinite\(rawMin\)\s*&&\s*rawMin\s*>=\s*10\s*\?\s*Math\.round\(rawMin\)\s*:\s*299;/, 'dataService setUnlockedDeals must clamp with >= 10');
  });

  // MED-06: Dish Badge None Ignored, Custom Dishes Jump to Bottom, Stale Category Rename & Category Image Save
  await t.test('18. [MED-06] Dish badge None is preserved, custom dishes sort to top (-1), category rename cascades, and file upload defers save for new categories', () => {
    assert.match(dataServiceJs, /badge:\s*dishData\.badge\s*!==\s*undefined\s*\?\s*dishData\.badge\s*:\s*['"]['"]/, 'dataService addDish must preserve empty string badge');
    assert.match(dataServiceJs, /const\s+posA\s*=\s*defaultDishOrderMap\.has\(a\.id\)\s*\?\s*defaultDishOrderMap\.get\(a\.id\)\s*:\s*-1;/, 'dataService getDishes must assign custom dishes -1 sort position');
    assert.match(dataServiceJs, /d\.categoryName\s*=\s*(?:updatedData|updates)\.name;/, 'dataService updateCategory must cascade category name update to matching dishes');
    const catUploadStart = adminJs.indexOf('if (catFileUpload)');
    const catUploadEnd = adminJs.indexOf('formCategory.addEventListener');
    const catUploadBlock = catUploadStart !== -1 && catUploadEnd !== -1 ? adminJs.slice(catUploadStart, catUploadEnd) : '';
    assert.match(catUploadBlock, /showToast\('✓ Category photo uploaded! Click Save Category to publish\.',\s*'success'\);/, 'New category photo upload must defer persistence until Save Category');
  });

  // MED-07: Navigation Back Service Orphan History, Stuck category-detail & Escape Key
  await t.test('19. [MED-07] closeCancelOrderModal calls removeStep, switchView removes category-detail, and Escape stops alarm in capture phase', () => {
    assert.match(adminJs, /function\s+closeCancelOrderModal\(\)\s*\{[\s\S]*?backNav\.removeStep\(['"]modal-cancel-order['"]\);/, 'closeCancelOrderModal must call backNav.removeStep');
    assert.match(adminJs, /backNav\.removeStepDirect\(['"]category-detail['"]\);/, 'switchView must clear category-detail step when leaving view-menu');
    assert.match(adminJs, /window\.addEventListener\(['"]keydown['"],\s*\(e\)\s*=>\s*\{[\s\S]*?e\.stopImmediatePropagation\(\);[\s\S]*?stopKitchenAlarm\(true\);[\s\S]*?\},\s*true\);/, 'Escape key listener must use capture phase true and stopImmediatePropagation');
  });

  // LOW-01: Idle Auto-Lock Timer, Order Card Escaping, # Prefix Normalization & Live Relative Timestamps
  await t.test('20. [LOW-01] Idle lock timer starts on login, card fields escaped, # normalized in alarm/sync, and overdue orders re-render every 60s', () => {
    assert.match(adminJs, /initIosPasscodeLock\([\s\S]*?resetIdleLockTimer\(\);/, 'initIosPasscodeLock onSuccess must call resetIdleLockTimer');
    assert.match(adminJs, /checkAdminSession[\s\S]*?resetIdleLockTimer\(\);/, 'checkAdminSession must call resetIdleLockTimer on valid token');
    assert.match(adminJs, /const\s+safeOrderId\s*=\s*escapeHtml\(String\(order\.id\s*\|\|\s*['"]['"]\)\);/, 'renderOrders must escape order.id');
    assert.match(adminJs, /stopKitchenAlarm[\s\S]*?const\s+normTargetId\s*=\s*String\(targetId\)\.replace\(\/\^#\/,\s*['"]['"]\);/, 'stopKitchenAlarm must normalize # prefix on targetId');
    assert.match(adminJs, /handleAdminOrderStatusSync[\s\S]*?const\s+normOrderId\s*=\s*String\(orderId\)\.replace\(\/\^#\/,\s*['"]['"]\);/, 'handleAdminOrderStatusSync must normalize # prefix on orderId');
    assert.match(adminJs, /checkOverduePendingOrders[\s\S]*?renderOrders\(\);/, 'checkOverduePendingOrders must refresh renderOrders periodically');
  });

  // HARDENED KITCHEN PORTAL & DUAL-API SURGICAL AUDIT VERIFICATION (17 Fixes)
  await t.test('21. Hardened Kitchen Portal: Overdue banner, Token recovery, Dual-API purge, Pending status gate & Print isolation', () => {
    // 1. checkOverduePendingOrders must pass overdueOrders to updateOverdueBanner
    assert.match(adminJs, /updateOverdueBanner\(overdueOrders\);/, 'checkOverduePendingOrders must pass overdueOrders');
    assert.doesNotMatch(adminJs, /updateOverdueBanner\(overdueList\);/, 'checkOverduePendingOrders must not reference undeclared overdueList');

    // 2. dataService._adminStoreAction must use isOwnerAction
    assert.match(dataServiceJs, /token\s*=\s*isOwnerAction\s*\?/, 'dataService _adminStoreAction must use isOwnerAction');
    assert.doesNotMatch(dataServiceJs, /token\s*=\s*isOwnerOnlyAction/, 'dataService _adminStoreAction must not use undeclared isOwnerOnlyAction');

    // 3. Dual-API save_settings cache purge
    assert.match(apiAdminStoreJs, /case\s*['"]save_settings['"]:[\s\S]*?invalidateOrderActionMemoryCache\(\);/, 'api/admin-store save_settings must invalidateOrderActionMemoryCache');
    assert.match(functionsApiAdminStoreJs, /case\s*['"]save_settings['"]:[\s\S]*?await\s+purgeKitchenPollEdgeCache\(request,\s*context\);/, 'functions/api/admin-store save_settings must purgeKitchenPollEdgeCache');
    assert.match(functionsApiOrderActionJs, /export\s+async\s+function\s+purgeKitchenPollEdgeCache/, 'functions/api/order-action must export purgeKitchenPollEdgeCache');

    // 4. ALLOWED_DISH_FIELDS includes r2_key in both api and functions
    assert.match(apiAdminStoreJs, /ALLOWED_DISH_FIELDS\s*=\s*\[[\s\S]*?['"]r2_key['"]/, 'api/admin-store must include r2_key');
    assert.match(functionsApiAdminStoreJs, /ALLOWED_DISH_FIELDS\s*=\s*\[[\s\S]*?['"]r2_key['"]/, 'functions/api/admin-store must include r2_key');

    // 5. Pending orders must provide Accept Order button
    assert.match(adminJs, /order\.status\s*===\s*['"]pending['"][\s\S]*?data-next=["']accepted["']/, 'Pending orders must offer data-next="accepted" button');

    // 6. Online payment identification for card and thermal print
    assert.match(adminJs, /const\s+isPaidOnline\s*=\s*Boolean\([\s\S]*?order\.is_paid_online/, 'renderOrders must inspect order.is_paid_online');
    assert.match(adminJs, /const\s+isPaidOnlineKOT\s*=\s*Boolean\([\s\S]*?order\.is_paid_online/, 'printOrderKOT must inspect order.is_paid_online');

    // 7. Cancellation modal target ID binding
    assert.match(adminJs, /openCancelOrderModal\(orderId\)[\s\S]*?activeCancellingOrderId\s*=\s*orderId/, 'openCancelOrderModal must bind activeCancellingOrderId');

    // 8. @media print isolation
    assert.match(adminCss, /@media\s+print\s*\{[\s\S]*?#admin-connection-banner[\s\S]*?display:\s*none\s*!important;/, 'admin.css @media print must hide #admin-connection-banner');

    // 9. modalOrderBackdrop fallback in openOrderManageModal
    assert.match(adminJs, /const\s+totalLabelEl\s*=[\s\S]*?modalOrderBackdrop/, 'openOrderManageModal must fallback to modalOrderBackdrop');
    assert.doesNotMatch(adminJs, /modalManageOrder/, 'admin.js must not reference undeclared modalManageOrder');

    // 10. dataService handleRealtimeOrderDelta preserves fees, safe drop, and doorstep wait
    assert.match(dataServiceJs, /riderWaitingAtDoorstep:\s*remote\.address_details\?\.riderWaitingAtDoorstep/, 'handleRealtimeOrderDelta must preserve riderWaitingAtDoorstep');
    assert.match(dataServiceJs, /deliveryFee:\s*remote\.delivery_fee/, 'handleRealtimeOrderDelta must preserve deliveryFee');
  });

  await t.test('22. Kitchen Portal Audit Wave 2: COD/Online classification, Alarm soundType guard, Dish r2_key sync & Global search styling', () => {
    // BUG-01: Delivered COD orders must not be classified as Paid Online
    assert.match(adminJs, /!isDoorstepUpiCard\s*&&\s*!isExplicitCodCard/, 'renderOrders must exclude COD and Doorstep UPI before marking isPaidOnline');
    assert.match(adminJs, /!isDoorstepUpiKOT\s*&&\s*!isExplicitCodKOT/, 'printOrderKOT must exclude COD and Doorstep UPI before marking isPaidOnlineKOT');

    // BUG-02: playNotificationSound must treat custom_r2 and silent as no-ops
    const notifJs = fs.readFileSync(path.join(rootDir, 'notificationService.js'), 'utf-8');
    assert.match(notifJs, /case\s*['"]custom_r2['"]:[\s\S]*?return;/, 'playNotificationSound must treat custom_r2 as no-op');

    // BUG-05 & BUG-06: Dish photo upload and r2_key sync
    assert.match(dataServiceJs, /r2_key:\s*newDish\.r2Key\s*\|\|\s*['"]['"]/, 'addDish payload must include r2_key');
    assert.match(dataServiceJs, /r2_key:\s*d\.r2Key\s*\|\|\s*['"]['"]/, 'updateDish payload must include r2_key');

    // BUG-07: sendSystemNotification must pass notifData with url
    assert.match(notifJs, /const\s+notifData\s*=\s*\{\s*url:\s*defaultUrl/, 'sendSystemNotification must attach defaultUrl in notification data');

    // BUG-08: renderGlobalDishes must use .dish-title and .meta-price
    assert.doesNotMatch(adminJs, /class="dish-title-text"/, 'renderGlobalDishes must not use unstyled .dish-title-text class');

    // BUG-09: Passcode lock recovers when lockout expires
    const passcodeJs = fs.readFileSync(path.join(rootDir, 'passcodeLockService.js'), 'utf-8');
    assert.match(passcodeJs, /Date\.now\(\)\s*>=\s*lockoutUntil[\s\S]*?defaultSubtitle/, 'passcodeLockService must restore defaultSubtitle when lockout expires');

    // BUG-10: Overdue banner formats order ID
    assert.match(adminJs, /const\s+firstDisplayId\s*=\s*formatDisplayOrderId\(first\.id,\s*first\.pickupCode\)/, 'updateOverdueBanner must format display order ID');

    // BUG-11: api/r2-image.js has CORS headers
    const r2ImageJs = fs.readFileSync(path.join(rootDir, 'api/r2-image.js'), 'utf-8');
    assert.match(r2ImageJs, /res\.setHeader\(['"]Access-Control-Allow-Origin['"],\s*['"]\*['"]\)/, 'api/r2-image.js must set Access-Control-Allow-Origin');
  });
});
