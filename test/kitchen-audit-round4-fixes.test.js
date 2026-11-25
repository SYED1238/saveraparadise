import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import apiAdminStoreHandler from '../api/admin-store.js';
import { onRequest as cfAdminStoreHandler } from '../functions/api/admin-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const adminJs = fs.readFileSync(path.join(rootDir, 'admin.js'), 'utf8');
const adminCss = fs.readFileSync(path.join(rootDir, 'admin.css'), 'utf8');
const apiAdminStoreJs = fs.readFileSync(path.join(rootDir, 'api', 'admin-store.js'), 'utf8');
const apiOrderActionJs = fs.readFileSync(path.join(rootDir, 'api', 'order-action.js'), 'utf8');
const functionsApiOrderActionJs = fs.readFileSync(path.join(rootDir, 'functions', 'api', 'order-action.js'), 'utf8');
const apiR2ImageJs = fs.readFileSync(path.join(rootDir, 'api', 'r2-image.js'), 'utf8');
const functionsApiR2ImageJs = fs.readFileSync(path.join(rootDir, 'functions', 'api', 'r2-image.js'), 'utf8');

function createMockNodeReqRes({ method = 'GET', query = {}, headers = {}, body = {}, url = '/api/admin-store' } = {}) {
  const req = { method, query, headers, body, url };
  let statusCode = 200;
  let jsonBody = null;
  const resHeaders = {};
  const res = {
    setHeader(k, v) { resHeaders[k.toLowerCase()] = v; },
    getHeader(k) { return resHeaders[k.toLowerCase()]; },
    status(code) { statusCode = code; return res; },
    json(data) { jsonBody = data; return res; },
    end() { return res; },
    _getStatusCode: () => statusCode,
    _getData: () => jsonBody
  };
  return { req, res };
}

test('KITCHEN PORTAL AUDIT ROUND 4 VERIFICATION SUITE (Findings #1-#11)', async (t) => {

  // #1: api/admin-store.js TDZ ReferenceError on GET ?action=get_settings
  await t.test('1. [#1] api/admin-store.js GET ?action=get_settings avoids TDZ ReferenceError and matches functions/api/admin-store.js', async () => {
    const prevUrl = process.env.SUPABASE_URL;
    const prevViteUrl = process.env.VITE_SUPABASE_URL;
    const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const prevAltKey = process.env.SUPABASE_SERVICE_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_KEY;

    try {
      const { req, res } = createMockNodeReqRes({
        method: 'GET',
        query: { action: 'get_settings' },
        url: '/api/admin-store?action=get_settings'
      });
      await apiAdminStoreHandler(req, res);
      assert.equal(res._getStatusCode(), 200);
      assert.deepEqual(res._getData(), { success: true, settings: {} });

      const cfReq = new Request('http://localhost/api/admin-store?action=get_settings', { method: 'GET' });
      const cfRes = await cfAdminStoreHandler({ request: cfReq, env: {} });
      assert.equal(cfRes.status, 200);
      assert.deepEqual(await cfRes.json(), { success: true, settings: {} });
    } finally {
      if (prevUrl !== undefined) process.env.SUPABASE_URL = prevUrl;
      if (prevViteUrl !== undefined) process.env.VITE_SUPABASE_URL = prevViteUrl;
      if (prevKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
      if (prevAltKey !== undefined) process.env.SUPABASE_SERVICE_KEY = prevAltKey;
    }

    const urlDeclIdx = apiAdminStoreJs.indexOf('const supabaseUrl =');
    const getBranchIdx = apiAdminStoreJs.indexOf("if (req.method === 'GET')");
    assert.ok(urlDeclIdx !== -1 && getBranchIdx !== -1 && urlDeclIdx < getBranchIdx, 'supabaseUrl must be declared before GET branch');
  });

  // #2: api/order-action.js isStage1Expired parity in assign_order fallback
  await t.test('2. [#2] Dual-API order-action.js declares isStage1Expired in assign_order fallback', () => {
    for (const [name, content] of [['api/order-action.js', apiOrderActionJs], ['functions/api/order-action.js', functionsApiOrderActionJs]]) {
      const assignStart = content.indexOf("case 'assign_order':");
      const claimStart = content.indexOf("case 'claim_order':");
      assert.ok(assignStart !== -1 && claimStart > assignStart, `${name} must contain assign_order case`);
      const assignBlock = content.slice(assignStart, claimStart);
      assert.match(assignBlock, /const\s+STAGE1_TIMEOUT_MS\s*=\s*15\s*\*\s*60\s*\*\s*1000;/, `${name} assign_order must declare STAGE1_TIMEOUT_MS`);
      assert.match(assignBlock, /const\s+isStage1Expired\s*=\s*assignedAtMs\s*>\s*0\s*&&\s*\(Date\.now\(\)\s*-\s*assignedAtMs\)\s*>\s*STAGE1_TIMEOUT_MS;/, `${name} assign_order must declare isStage1Expired`);
      assert.match(assignBlock, /isStage1Expired\s*&&\s*existingPin/, `${name} assign_order query must reference isStage1Expired cleanly`);
    }
  });

  // #11: functions/api/r2-image.js Content-Security-Policy parity
  await t.test('3. [#11] Dual-API r2-image.js enforces Content-Security-Policy sandbox header', () => {
    assert.match(
      apiR2ImageJs,
      /res\.setHeader\(['"]Content-Security-Policy['"],\s*["']default-src 'none'; style-src 'unsafe-inline'; sandbox["']\);/,
      'api/r2-image.js must set Content-Security-Policy sandbox header'
    );
    assert.match(
      functionsApiR2ImageJs,
      /responseHeaders\.set\(['"]Content-Security-Policy['"],\s*["']default-src 'none'; style-src 'unsafe-inline'; sandbox["']\);/,
      'functions/api/r2-image.js must set Content-Security-Policy sandbox header'
    );
  });

  // #3: .kitchen-alarm-banner z-index sits above .admin-header and dropdown overlays, below lock/toast
  await t.test('4. [#3] admin.css renders .kitchen-alarm-banner above .admin-header and .admin-menu-dropdown', () => {
    const extractZ = (selectorRegex, label) => {
      const m = adminCss.match(selectorRegex);
      assert.ok(m, `admin.css must contain z-index for ${label}`);
      return Number(m[1]);
    };
    const headerZ = extractZ(/\.admin-header\s*\{[^}]*z-index:\s*(\d+)/, '.admin-header');
    const backdropZ = extractZ(/\.admin-menu-backdrop\s*\{[^}]*z-index:\s*(\d+)/, '.admin-menu-backdrop');
    const dropdownZ = extractZ(/\.admin-menu-dropdown\s*\{[^}]*z-index:\s*(\d+)/, '.admin-menu-dropdown');
    const bannerZ = extractZ(/\.kitchen-alarm-banner\s*\{[^}]*z-index:\s*(\d+)/, '.kitchen-alarm-banner');
    const lockZ = extractZ(/\.portal-lock-overlay\s*\{[^}]*z-index:\s*(\d+)/, '.portal-lock-overlay');

    assert.ok(bannerZ > headerZ, `bannerZ (${bannerZ}) must exceed headerZ (${headerZ})`);
    assert.ok(bannerZ > backdropZ, `bannerZ (${bannerZ}) must exceed backdropZ (${backdropZ})`);
    assert.ok(bannerZ > dropdownZ, `bannerZ (${bannerZ}) must exceed dropdownZ (${dropdownZ})`);
    assert.ok(bannerZ < lockZ, `bannerZ (${bannerZ}) must remain below lock overlay z-index (${lockZ})`);
  });

  // #4 & #10: Overdue checker lock guard, Direct Dispatch Quick-Accept, updated-gated alarm stop, and lock cleanup
  await t.test('5. [#4 & #10] Alarm banner, overdue checker, and lock lifecycle handle session guards and updated checks safely', () => {
    assert.match(
      adminJs,
      /function\s+checkOverduePendingOrders\(\)\s*\{\s*if\s*\(!isStaffSessionActive\('admin'\)\s*&&\s*!isStaffSessionActive\('owner'\)\)\s*\{[\s\S]*?pendingOverdueAlertBanner\.style\.display\s*=\s*'none';[\s\S]*?return;\s*\}/,
      'checkOverduePendingOrders must return early while portal is locked'
    );
    assert.match(
      adminJs,
      /btnOverdueQuickAccept\.onclick\s*=[\s\S]*?isDirectDispatch\s*\?\s*'ready_for_pickup'\s*:\s*'cooking'[\s\S]*?const\s+updated\s*=\s*dataService\.updateOrderStatus\(first\.id,\s*nextTarget\);\s*if\s*\(updated\)\s*\{[\s\S]*?stopKitchenAlarm\(true,\s*\{\s*orderId:\s*first\.id\s*\}\);/,
      'btnOverdueQuickAccept must support Direct Dispatch Mode and gate alarm stop on updated'
    );
    assert.match(
      adminJs,
      /const\s+updated\s*=\s*dataService\.updateOrderStatus\(id,\s*next\);\s*if\s*\(updated\)\s*\{\s*if\s*\(next\s*!==\s*'pending'\s*&&\s*isKitchenAlarmRinging\)\s*\{\s*stopKitchenAlarm\(true,\s*\{\s*orderId:\s*id\s*\}\);/,
      'Card quick-advance button must only stop alarm when updated is truthy'
    );
    assert.match(
      adminJs,
      /const\s+updated\s*=\s*dataService\.updateOrderStatus\(orderId,\s*targetStatus\);\s*if\s*\(updated\)\s*\{\s*if\s*\(targetStatus\s*!==\s*'pending'\s*&&\s*isKitchenAlarmRinging\)\s*\{\s*stopKitchenAlarm\(true,\s*\{\s*orderId\s*\}\);/,
      'Modal status pill click must only stop alarm when updated is truthy'
    );
    assert.match(
      adminJs,
      /const\s+updated\s*=\s*dataService\.updateOrderStatus\(orderId,\s*nextStatus\);\s*if\s*\(updated\)\s*\{\s*if\s*\(nextStatus\s*!==\s*'pending'\s*&&\s*isKitchenAlarmRinging\)\s*\{\s*stopKitchenAlarm\(true,\s*\{\s*orderId\s*\}\);/,
      'Modal advance button must only stop alarm when updated is truthy'
    );
    assert.match(
      adminJs,
      /btnAdminLogout\.addEventListener\('click'[\s\S]*?if\s*\(isKitchenAlarmRinging\)\s*\{\s*stopKitchenAlarm\(false\);/,
      'Manual lock button must silence active kitchen alarm locally'
    );
    assert.match(
      adminJs,
      /idleLockTimer\s*=\s*setTimeout[\s\S]*?localStorage\.removeItem\('quickbite_admin_session_auth'\);[\s\S]*?if\s*\(isKitchenAlarmRinging\)\s*\{\s*stopKitchenAlarm\(false\);/,
      'Idle lock timeout must remove quickbite_admin_session_auth and silence active kitchen alarm locally'
    );
  });

  // #5: toggleDirectDispatchMode lock, duplicate submit guard, and cloud failure rollback
  await t.test('6. [#5] toggleDirectDispatchMode prevents duplicate concurrent saves and rolls back on cloud sync failure', () => {
    const fnStart = adminJs.indexOf('async function toggleDirectDispatchMode');
    const fnEnd = adminJs.indexOf('if (btnAdminDirectDispatchToggle)', fnStart);
    assert.ok(fnStart !== -1 && fnEnd > fnStart, 'toggleDirectDispatchMode function must exist');
    const fnBlock = adminJs.slice(fnStart, fnEnd);

    assert.match(fnBlock, /if\s*\(isSavingDirectDispatch\)\s*return;/, 'Must guard against concurrent saves');
    assert.match(fnBlock, /if\s*\(forcedVal\s*!==\s*null\s*&&\s*newVal\s*===\s*current\)\s*\{[\s\S]*?return;\s*\}/, 'Must skip duplicate save when form submits unchanged state');
    assert.match(fnBlock, /catch\s*\(err\)\s*\{[\s\S]*?dataService\.settingsCache\s*=\s*prevSettings;[\s\S]*?dataService\._directDispatchOnPrep\s*=[\s\S]*?localStorage\.setItem\('quickbite_settings',\s*JSON\.stringify\(prevSettings\)\);[\s\S]*?updateDirectDispatchUI\(\);\s*renderOrders\(\);/, 'Must restore settingsCache, _directDispatchOnPrep, localStorage, and UI on cloud sync failure');
  });

  // #6: Stale previous-shift filter switches activeOrderFilter to all, resets pagination, and handles empty digits
  await t.test('7. [#6] Stale shift Review Orders button switches filter to all and guards empty ID', () => {
    const staleStart = adminJs.indexOf('if (btnStaleFilter)');
    const staleEnd = adminJs.indexOf('if (btnStaleDismiss');
    assert.ok(staleStart !== -1 && staleEnd > staleStart, 'btnStaleFilter block must exist');
    const staleBlock = adminJs.slice(staleStart, staleEnd);

    assert.match(staleBlock, /firstDigits\s*\|\|\s*firstRawId\.replace\(\/\^#\/,\s*''\)\.trim\(\)/, 'Must fall back to non-digit order ID when numeric extraction is empty');
    assert.match(staleBlock, /if\s*\(!staleId\)\s*return;/, 'Must abort safely when staleId is empty');
    assert.match(staleBlock, /setActiveOrderFilter\('all'\)/, 'Must switch active order filter to all and reset pagination');
  });

  // #7: Offers preserve saved < ₹30 flat discount while keeping interactive fallback
  await t.test('8. [#7] renderOffers preserves saved flat discounts < 30 without clobbering to 100', () => {
    assert.match(
      adminJs,
      /function\s+setDiscountType\(type,\s*\{\s*preserveValue\s*=\s*false\s*\}\s*=\s*\{\}\)\s*\{[\s\S]*?if\s*\(!preserveValue\s*&&\s*type\s*===\s*'flat'\s*&&\s*currentVal\s*<\s*30\)/,
      'setDiscountType must only reset < 30 to 100 when preserveValue is false'
    );
    assert.match(
      adminJs,
      /setDiscountType\(offerType,\s*\{\s*preserveValue:\s*true\s*\}\);/,
      'renderOffers must call setDiscountType with preserveValue: true'
    );
  });

  // #8: Category file upload error handling and modal close cleanup
  await t.test('9. [#8] catFileUpload handles FileReader errors cleanly and closeCategoryModal resets upload lock state', () => {
    assert.match(
      adminJs,
      /function\s+readFileAsDataUrl\(file\)[\s\S]*?reader\.onerror\s*=[\s\S]*?reader\.onabort\s*=/,
      'readFileAsDataUrl helper must attach reader.onerror and reader.onabort'
    );
    const catUploadStart = adminJs.indexOf('if (catFileUpload)');
    const catUploadEnd = adminJs.indexOf('formCategory.addEventListener');
    const catUploadBlock = adminJs.slice(catUploadStart, catUploadEnd);
    assert.match(catUploadBlock, /let\s+dataUrl\s*=\s*await\s+compressImageFile\(file,\s*640,\s*0\.72\);[\s\S]*?if\s*\(!dataUrl\)\s*\{\s*dataUrl\s*=\s*await\s+readFileAsDataUrl\(file\);/, 'catFileUpload must avoid double reading when compressImageFile succeeds');

    const closeCatStart = adminJs.indexOf('function closeCategoryModal()');
    const closeCatEnd = adminJs.indexOf('async function deleteCategoryPrompt');
    const closeCatBlock = adminJs.slice(closeCatStart, closeCatEnd);
    assert.match(closeCatBlock, /isUploadingCatPhoto\s*=\s*false;/, 'closeCategoryModal must reset isUploadingCatPhoto');
    assert.match(closeCatBlock, /if\s*\(btnSaveCat\)\s*btnSaveCat\.disabled\s*=\s*false;/, 'closeCategoryModal must re-enable btnSaveCat');
  });

  // #9: Dish gallery deduplication, preset protection on save, and async render sequence guard
  await t.test('10. [#9] renderPresetGalleryStrip deduplicates URLs with sequence guard and formDish skips saving presets', () => {
    assert.match(
      adminJs,
      /let\s+presetGalleryRenderSeq\s*=\s*0;[\s\S]*?function\s+normalizeGalleryDedupKey[\s\S]*?async\s+function\s+renderPresetGalleryStrip\(selectedImg\)\s*\{\s*const\s+renderSeq\s*=\s*\+\+presetGalleryRenderSeq;/,
      'renderPresetGalleryStrip must track sequence counter for concurrent calls'
    );
    assert.match(
      adminJs,
      /await\s+cloudflareR2Service\.listImages\(\);[\s\S]*?if\s*\(renderSeq\s*!==\s*presetGalleryRenderSeq\)\s*return;/,
      'renderPresetGalleryStrip must discard stale async listImages responses'
    );
    assert.match(
      adminJs,
      /const\s+isBuiltInPresetImg\s*=\s*Array\.isArray\(PRESET_FOOD_IMAGES\)\s*&&\s*PRESET_FOOD_IMAGES\.some\(p\s*=>\s*p\.path\s*===\s*image\);[\s\S]*?if\s*\(image\s*&&\s*!image\.startsWith\('data:'\)\s*&&\s*!isBuiltInPresetImg\s*&&\s*!isDefaultFallbackImg\)\s*\{\s*dataService\.saveUploadedImage\(image,\s*name\);/,
      'formDish submit must not save built-in preset or fallback image URLs into uploaded_images'
    );
  });
});
