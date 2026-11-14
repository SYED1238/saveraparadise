import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const adminJs = fs.readFileSync(path.join(rootDir, 'admin.js'), 'utf-8');
const dataServiceJs = fs.readFileSync(path.join(rootDir, 'dataService.js'), 'utf-8');
const passcodeLockServiceJs = fs.readFileSync(path.join(rootDir, 'passcodeLockService.js'), 'utf-8');
const apiOrderActionJs = fs.readFileSync(path.join(rootDir, 'api', 'order-action.js'), 'utf-8');
const functionsApiOrderActionJs = fs.readFileSync(path.join(rootDir, 'functions', 'api', 'order-action.js'), 'utf-8');
const apiAdminStoreJs = fs.readFileSync(path.join(rootDir, 'api', 'admin-store.js'), 'utf-8');
const functionsApiAdminStoreJs = fs.readFileSync(path.join(rootDir, 'functions', 'api', 'admin-store.js'), 'utf-8');
const apiR2UploadJs = fs.readFileSync(path.join(rootDir, 'api', 'r2-upload.js'), 'utf-8');
const functionsApiR2UploadJs = fs.readFileSync(path.join(rootDir, 'functions', 'api', 'r2-upload.js'), 'utf-8');
const apiR2VideoJs = fs.readFileSync(path.join(rootDir, 'api', 'r2-video.js'), 'utf-8');
const supabaseSetupSql = fs.readFileSync(path.join(rootDir, 'supabase_setup.sql'), 'utf-8');

test('KITCHEN PORTAL ROUND 2 BUG HUNT & REMEDIATION SUITE (16 Verified Findings)', async (t) => {

  // R2-CRIT-01: Owner Session Lockout in Kitchen Portal (dataService.isStaffAuthorized)
  await t.test('1. [R2-CRIT-01] dataService.isStaffAuthorized() permits owner session when portalType === "admin"', () => {
    assert.match(
      dataServiceJs,
      /isStaffAuthorized\(\)\s*\{[\s\S]*?if\s*\(this\.portalType\s*===\s*['"]admin['"]\)\s*return\s+isStaffSessionActive\(['"]admin['"]\)\s*\|\|\s*isStaffSessionActive\(['"]owner['"]\);/,
      'dataService.isStaffAuthorized() must authorize owner session in admin portal'
    );
  });

  // R2-CRIT-02: Custom Dish Sorting Determinism & Rollback Order Preservation
  await t.test('2. [R2-CRIT-02] dataService implements _sortDishesList preserving custom dish order and deleteDish restores prevList on error', () => {
    assert.match(
      dataServiceJs,
      /_sortDishesList\s*\(list\)\s*\{[\s\S]*?defaultDishOrderMap[\s\S]*?_getCustomDishTimestamp/,
      'dataService must implement _sortDishesList with timestamp sorting for custom dishes'
    );
    assert.match(
      dataServiceJs,
      /deleteDish\s*\(id\)\s*\{[\s\S]*?const\s+prevList\s*=\s*list\.map\(d\s*=>\s*\(\{\s*\.\.\.d\s*\}\)\);[\s\S]*?this\.saveDishes\(prevList\);/,
      'deleteDish must snapshot prevList and restore it on error instead of list.push(dish)'
    );
  });

  // R2-CRIT-03: Category Modal Photo Upload Staging & R2 Replacement Cleanup
  await t.test('3. [R2-CRIT-03] Category photo upload defers saving until Save Category is clicked and cleans up replaced R2 images', () => {
    const catUploadStart = adminJs.indexOf('if (catFileUpload)');
    const catUploadEnd = adminJs.indexOf('formCategory.addEventListener');
    const catUploadBlock = catUploadStart !== -1 && catUploadEnd !== -1 ? adminJs.slice(catUploadStart, catUploadEnd) : '';

    assert.doesNotMatch(
      catUploadBlock,
      /await\s+dataService\.saveCategoryImage\(/,
      'catFileUpload must NOT immediately persist category image to cloud before form submit'
    );
    assert.doesNotMatch(
      catUploadBlock,
      /await\s+dataService\.updateCategory\(/,
      'catFileUpload must NOT immediately update category in cloud before form submit'
    );
    assert.match(
      adminJs,
      /const\s+previousImageUrl\s*=\s*initialCategoryModalImage;[\s\S]*?if\s*\(previousImageUrl\s*&&\s*previousImageUrl\s*!==\s*image\s*&&\s*previousImageUrl\.includes\(['"]key=['"]\)\)/,
      'formCategory submit must clean up old R2 category image when replaced'
    );
  });

  // R2-CRIT-04: Doorstep Waiting State Sync via Cancellation Reason & Address Details
  await t.test('4. [R2-CRIT-04] Realtime order delta and backend update_status reliably sync riderWaitingAtDoorstep and waitingStartedAt', () => {
    assert.match(
      dataServiceJs,
      /hasDoorstepWaitTag[\s\S]*?\[DOORSTEP_WAIT\][\s\S]*?isWaitingAtDoorstep/,
      'dataService.handleRealtimeOrderDelta must inspect [DOORSTEP_WAIT] tag'
    );
    for (const [name, content] of [['api/order-action.js', apiOrderActionJs], ['functions/api/order-action.js', functionsApiOrderActionJs]]) {
      assert.match(
        content,
        /riderWaitingAtDoorstep\s*[:=]\s*true/,
        `${name} update_status must explicitly set riderWaitingAtDoorstep: true on wait start`
      );
      assert.match(
        content,
        /riderWaitingAtDoorstep\s*[:=]\s*false/,
        `${name} update_status must set riderWaitingAtDoorstep: false on cancellation/delivery`
      );
    }
  });

  // R2-HIGH-01: Test/Fallback Mode Doorstep UPI RBAC Protection
  await t.test('5. [R2-HIGH-01] Dual-API order-action test/fallback mode restricts unverified Doorstep UPI strictly to owner role', () => {
    for (const [name, content] of [['api/order-action.js', apiOrderActionJs], ['functions/api/order-action.js', functionsApiOrderActionJs]]) {
      assert.match(
        content,
        /const\s+isDoorstep\s*=\s*isCfSuccess\s*\|\|\s*\(auth\.payload\?\.role\s*===\s*['"]owner['"]\s*&&\s*\(typeof\s+inputDoorstepUpi\s*===\s*['"]boolean['"]\s*\?\s*inputDoorstepUpi\s*:\s*Boolean\(existing\.doorstep_upi\)\)\);/,
        `${name} test mode must restrict manual Doorstep UPI strictly to owner role`
      );
      assert.doesNotMatch(
        content,
        /auth\.payload\?\.role\s*!==\s*['"]admin['"]\s*&&\s*\(typeof\s+inputDoorstepUpi/,
        `${name} must not allow non-admin (rider) to forge doorstep UPI in test mode`
      );
    }
  });

  // R2-HIGH-02: supabase_setup.sql Atomic Category Cascade Deletion RPC
  await t.test('6. [R2-HIGH-02] supabase_setup.sql includes public.delete_category_cascade function and grants to service_role', () => {
    assert.match(
      supabaseSetupSql,
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.delete_category_cascade\(/,
      'supabase_setup.sql must include public.delete_category_cascade'
    );
    assert.match(
      supabaseSetupSql,
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.delete_category_cascade\([^)]*\)\s+TO\s+service_role;/,
      'supabase_setup.sql must grant delete_category_cascade to service_role'
    );
  });

  // R2-HIGH-03: Dual-API admin-store.js Handlers for Authorized Actions
  await t.test('7. [R2-HIGH-03] Dual-API admin-store.js switch blocks handle save_dish, save_category, settle_rider_cash, record_rider_payout, reset_defaults', () => {
    for (const [name, content] of [['api/admin-store.js', apiAdminStoreJs], ['functions/api/admin-store.js', functionsApiAdminStoreJs]]) {
      assert.match(content, /case\s*['"]save_dish['"]:/, `${name} must implement case 'save_dish'`);
      assert.match(content, /case\s*['"]save_category['"]:/, `${name} must implement case 'save_category'`);
      assert.match(content, /case\s*['"]settle_rider_cash['"]:/, `${name} must implement case 'settle_rider_cash'`);
      assert.match(content, /case\s*['"]record_rider_payout['"]:/, `${name} must implement case 'record_rider_payout'`);
      assert.match(content, /case\s*['"]reset_defaults['"]:/, `${name} must implement case 'reset_defaults'`);
      assert.match(content, /case\s*['"]reset_business_data['"]:/, `${name} must implement case 'reset_business_data'`);
    }
  });

  // R2-HIGH-04: Category Rename Cascades Atomically & updateCategory Rolls Back Dishes
  await t.test('8. [R2-HIGH-04] dataService.updateCategory snapshots dishes for rollback and admin-store cascades category name to dishes', () => {
    assert.match(
      dataServiceJs,
      /updateCategory\s*\([^)]*\)\s*\{[\s\S]*?const\s+prevDishes\s*=\s*this\.getDishes\(\)\.map[\s\S]*?if\s*\(dishesChanged\)\s*this\.saveDishes\(prevDishes\);/,
      'dataService.updateCategory must restore prevDishes if server update rejects'
    );
    for (const [name, content] of [['api/admin-store.js', apiAdminStoreJs], ['functions/api/admin-store.js', functionsApiAdminStoreJs]]) {
      assert.match(
        content,
        /case\s*['"]update_category['"]:[\s\S]*?if\s*\(cleanUpdates\.name\)\s*\{[\s\S]*?sb\.from\(['"]dishes['"]\)\s*\.update\(\{\s*category_name:\s*cleanUpdates\.name\s*\}\)/,
        `${name} update_category must cascade category_name update to dishes`
      );
    }
  });

  // R2-HIGH-05: R2 Upload Magic-Byte Validation Parity
  await t.test('9. [R2-HIGH-05] Dual-API r2-upload verifies binary magic bytes for JPEG, PNG, WebP, and GIF', () => {
    for (const [name, content] of [['api/r2-upload.js', apiR2UploadJs], ['functions/api/r2-upload.js', functionsApiR2UploadJs]]) {
      assert.match(content, /const\s+isJpeg\s*=\s*buffer\.length\s*>=\s*3\s*&&\s*buffer\[0\]\s*===\s*0xFF/, `${name} must verify JPEG magic bytes`);
      assert.match(content, /const\s+isPng\s*=\s*buffer\.length\s*>=\s*8\s*&&\s*buffer\[0\]\s*===\s*0x89/, `${name} must verify PNG magic bytes`);
      assert.match(content, /const\s+isWebp\s*=\s*buffer\.length\s*>=\s*12[\s\S]*?RIFF[\s\S]*?WEBP/, `${name} must verify WebP magic bytes`);
      assert.match(content, /const\s+isGif\s*=\s*buffer\.length\s*>=\s*6[\s\S]*?GIF87a[\s\S]*?GIF89a/, `${name} must verify GIF magic bytes`);
    }
  });

  // R2-HIGH-06: R2 Video Response Headers
  await t.test('10. [R2-HIGH-06] api/r2-video.js sets X-Content-Type-Options: nosniff on video streaming responses', () => {
    assert.match(
      apiR2VideoJs,
      /res\.setHeader\(['"]X-Content-Type-Options['"],\s*['"]nosniff['"]\);/,
      'api/r2-video.js must set X-Content-Type-Options: nosniff'
    );
  });

  // R2-MED-01: Settings Forms Rollback on Cloud Sync Failure
  await t.test('11. [R2-MED-01] formStoreOffer, formUnlockedDeals, and formStoreDelivery roll back settings cache on failure', () => {
    assert.match(
      adminJs,
      /formStoreOffer[\s\S]*?const\s+prevSettings\s*=\s*\{\s*\.\.\.\(dataService\.getSettings\(\)\s*\|\|\s*\{\}\)\s*\};[\s\S]*?catch\s*\(err\)\s*\{[\s\S]*?dataService\.settingsCache\s*=\s*prevSettings;/,
      'formStoreOffer must roll back settingsCache on failure'
    );
    assert.match(
      adminJs,
      /formUnlockedDeals[\s\S]*?const\s+prevSettings\s*=\s*\{\s*\.\.\.\(dataService\.getSettings\(\)\s*\|\|\s*\{\}\)\s*\};[\s\S]*?catch\s*\(err\)\s*\{[\s\S]*?dataService\.settingsCache\s*=\s*prevSettings;/,
      'formUnlockedDeals must roll back settingsCache on failure'
    );
    assert.match(
      adminJs,
      /formStoreDelivery[\s\S]*?const\s+prevSettings\s*=\s*\{\s*\.\.\.\(dataService\.getSettings\(\)\s*\|\|\s*\{\}\)\s*\};[\s\S]*?catch\s*\(err\)\s*\{[\s\S]*?dataService\.settingsCache\s*=\s*prevSettings;/,
      'formStoreDelivery must roll back settingsCache on failure'
    );
  });

  // R2-MED-02: btnAdminAlarmToggle Cloud Persistence Assertion & Error Handling
  await t.test('12. [R2-MED-02] btnAdminAlarmToggle checks assertCloudSettingsSynced and rolls back alarm UI on error', () => {
    assert.match(
      adminJs,
      /btnAdminAlarmToggle\.addEventListener\(['"]click['"],\s*async\s*\(\)\s*=>\s*\{[\s\S]*?assertCloudSettingsSynced\(res\);[\s\S]*?catch\s*\(err\)\s*\{[\s\S]*?setKitchenAlarmSoundMode\(curSettings\.kitchenAlarmMode\s*\|\|\s*prevMode\);/,
      'btnAdminAlarmToggle must call assertCloudSettingsSynced and roll back sound mode on failure'
    );
  });

  // R2-MED-03: Modal Dish Deletion Awaits Confirmation Before Closing
  await t.test('13. [R2-MED-03] btnModalDeleteDish awaits deleteDishPrompt and does not close modal on Cancel', () => {
    assert.match(
      adminJs,
      /btnModalDeleteDish\.addEventListener\(['"]click['"],\s*async\s*\(\)\s*=>\s*\{[\s\S]*?const\s+deleted\s*=\s*await\s+deleteDishPrompt\(id\);[\s\S]*?if\s*\(deleted\)\s*\{[\s\S]*?closeDishModal\(\);/,
      'btnModalDeleteDish must await deleteDishPrompt and only close when deletion returns true'
    );
  });

  // R2-MED-04: deleteCategoryPrompt Guards Canonical & Shared R2 Images
  await t.test('14. [R2-MED-04] deleteCategoryPrompt verifies category photo is not canonical or shared before R2 deletion', () => {
    assert.match(
      adminJs,
      /deleteCategoryPrompt[\s\S]*?const\s+canonicalImages\s*=\s*Object\.values\(dataService\.CANONICAL_CATEGORY_IMAGES[\s\S]*?const\s+isCanonical\s*=[\s\S]*?const\s+isShared\s*=[\s\S]*?if\s*\(catR2Key\s*&&\s*!isCanonical\s*&&\s*!isShared/,
      'deleteCategoryPrompt must protect canonical and shared R2 category images from deletion'
    );
  });

  // R2-MED-05: passcodeLockService Resets failedAttempts on Expiry and Reset
  await t.test('15. [R2-MED-05] passcodeLockService resets failedAttempts to 0 upon lockout expiration and reset()', () => {
    assert.match(
      passcodeLockServiceJs,
      /setTimeout\(\(\)\s*=>\s*\{[\s\S]*?if\s*\(Date\.now\(\)\s*>=\s*lockoutUntil\s*&&\s*subtitleEl\)\s*\{[\s\S]*?lockoutUntil\s*=\s*0;[\s\S]*?failedAttempts\s*=\s*0;/,
      'passcodeLockService must reset failedAttempts = 0 when 30s timer expires'
    );
    assert.match(
      passcodeLockServiceJs,
      /if\s*\(lockoutUntil\s*>\s*0\s*&&\s*Date\.now\(\)\s*>=\s*lockoutUntil\)\s*\{[\s\S]*?lockoutUntil\s*=\s*0;[\s\S]*?failedAttempts\s*=\s*0;/,
      'passcodeLockService must reset failedAttempts = 0 on enterDigit after lockout expiration'
    );
    assert.match(
      passcodeLockServiceJs,
      /reset\(\)\s*\{[\s\S]*?failedAttempts\s*=\s*0;[\s\S]*?lockoutUntil\s*=\s*0;/,
      'passcodeLockService.reset() must reset failedAttempts = 0 and lockoutUntil = 0'
    );
  });

  // R2-LOW-01: Dead Code & Always-Truthy State Cleanup in admin.js
  await t.test('16. [R2-LOW-01] admin.js removes dead code, cleans delivery badge logic, and references currentOpenedCategorySlug', () => {
    assert.match(
      adminJs,
      /capsuleDeliveryBadge\.style\.display\s*=\s*\(settings\.freeDeliveryEnabled\)\s*\?\s*['"]inline-block['"]\s*:\s*['"]none['"];/,
      '#capsule-delivery-badge must only depend on settings.freeDeliveryEnabled'
    );
    assert.match(
      adminJs,
      /openAddDishModal[\s\S]*?else\s+if\s*\(currentOpenedCategorySlug\s*&&\s*currentOpenedCategorySlug\s*!==\s*['"]all['"]\)/,
      'openAddDishModal must check currentOpenedCategorySlug instead of stale activeCategoryFilter'
    );
    const syncHoursStart = adminJs.indexOf('function syncHoursSummaryChips()');
    const syncHoursEnd = adminJs.indexOf('function syncDeliverySummaryChips()');
    const syncHoursBlock = syncHoursStart !== -1 && syncHoursEnd !== -1 ? adminJs.slice(syncHoursStart, syncHoursEnd) : '';
    assert.doesNotMatch(
      syncHoursBlock,
      /const\s+rushModeBadge\s*=\s*document\.getElementById\(['"]rush-mode-badge['"]\);/,
      'syncHoursSummaryChips must not declare unused local rushModeBadge variable'
    );
  });
});
