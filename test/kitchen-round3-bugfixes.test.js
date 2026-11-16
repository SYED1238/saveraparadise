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
const apiR2AudioJs = fs.readFileSync(path.join(rootDir, 'api', 'r2-audio.js'), 'utf-8');
const functionsApiR2AudioJs = fs.readFileSync(path.join(rootDir, 'functions', 'api', 'r2-audio.js'), 'utf-8');
const apiR2VideoJs = fs.readFileSync(path.join(rootDir, 'api', 'r2-video.js'), 'utf-8');
const functionsApiR2VideoJs = fs.readFileSync(path.join(rootDir, 'functions', 'api', 'r2-video.js'), 'utf-8');
const apiR2UploadJs = fs.readFileSync(path.join(rootDir, 'api', 'r2-upload.js'), 'utf-8');
const functionsApiR2UploadJs = fs.readFileSync(path.join(rootDir, 'functions', 'api', 'r2-upload.js'), 'utf-8');
const apiR2DeleteJs = fs.readFileSync(path.join(rootDir, 'api', 'r2-delete.js'), 'utf-8');
const functionsApiR2DeleteJs = fs.readFileSync(path.join(rootDir, 'functions', 'api', 'r2-delete.js'), 'utf-8');
const apiR2ListJs = fs.readFileSync(path.join(rootDir, 'api', 'r2-list.js'), 'utf-8');
const functionsApiR2ListJs = fs.readFileSync(path.join(rootDir, 'functions', 'api', 'r2-list.js'), 'utf-8');
const supabaseSetupSql = fs.readFileSync(path.join(rootDir, 'supabase_setup.sql'), 'utf-8');
const supabaseHardeningSql = fs.readFileSync(path.join(rootDir, 'supabase_production_security_hardening.sql'), 'utf-8');

test('KITCHEN PORTAL ROUND 3 BUG HUNT & REMEDIATION SUITE (6 Verified Findings)', async (t) => {

  // KITCHEN-BUG-01: Undefined KITCHEN_ALARM_MODES.CLASSIC constant and missing rollback
  await t.test('1. [KITCHEN-BUG-01] admin.js uses KITCHEN_ALARM_MODES.CLASSIC_CHIME and rolls back settingsCache/localStorage on sync failure', () => {
    assert.doesNotMatch(
      adminJs,
      /KITCHEN_ALARM_MODES\.CLASSIC(?![_\w])/,
      'admin.js must not reference undefined KITCHEN_ALARM_MODES.CLASSIC'
    );
    assert.match(
      adminJs,
      /KITCHEN_ALARM_MODES\.CLASSIC_CHIME/,
      'admin.js must use KITCHEN_ALARM_MODES.CLASSIC_CHIME'
    );
    assert.match(
      adminJs,
      /btnAdminAlarmToggle[\s\S]*?catch\s*\(err\)\s*\{[\s\S]*?dataService\.settingsCache\s*=\s*rollbackSettings;[\s\S]*?localStorage\.setItem\('quickbite_settings', JSON\.stringify\(rollbackSettings\)\);/,
      'admin.js must restore dataService.settingsCache and localStorage when alarm mode cloud sync fails'
    );
  });

  // KITCHEN-BUG-02: Missing rollback in setRushPause, extendRushPause, resumeOrders, setDeliveryRadius
  await t.test('2. [KITCHEN-BUG-02] admin.js rolls back settingsCache/localStorage on rush pause, extend, resume, and delivery radius sync failure', () => {
    assert.match(
      adminJs,
      /btnTriggerRush[\s\S]*?catch\s*\(err\)\s*\{[\s\S]*?dataService\.settingsCache\s*=\s*prevSettings;[\s\S]*?localStorage\.setItem\('quickbite_settings', JSON\.stringify\(prevSettings\)\);[\s\S]*?updateRushUI\(\);/,
      'btnTriggerRush must rollback settingsCache and localStorage before calling updateRushUI()'
    );
    assert.match(
      adminJs,
      /btnExtendRush10[\s\S]*?catch\s*\(err\)\s*\{[\s\S]*?dataService\.settingsCache\s*=\s*prevSettings;[\s\S]*?localStorage\.setItem\('quickbite_settings', JSON\.stringify\(prevSettings\)\);[\s\S]*?updateRushUI\(\);/,
      'btnExtendRush10 must rollback settingsCache and localStorage before calling updateRushUI()'
    );
    assert.match(
      adminJs,
      /btnResumeOrders[\s\S]*?catch\s*\(err\)\s*\{[\s\S]*?dataService\.settingsCache\s*=\s*prevSettings;[\s\S]*?localStorage\.setItem\('quickbite_settings', JSON\.stringify\(prevSettings\)\);[\s\S]*?updateRushUI\(\);/,
      'btnResumeOrders must rollback settingsCache and localStorage before calling updateRushUI()'
    );
    assert.match(
      adminJs,
      /btnSaveRadius[\s\S]*?catch\s*\(err\)\s*\{[\s\S]*?dataService\.settingsCache\s*=\s*prevSettings;[\s\S]*?localStorage\.setItem\('quickbite_settings', JSON\.stringify\(prevSettings\)\);/,
      'btnSaveRadius must rollback settingsCache and localStorage on error'
    );
  });

  // KITCHEN-BUG-03: Failed R2 dish photo upload Base64 gallery poisoning & pending R2 key cleanup
  await t.test('3. [KITCHEN-BUG-03] admin.js deletes pendingDishUploadedR2Key on preset click and does not save Base64 into uploaded_images', () => {
    assert.match(
      adminJs,
      /preset-thumb-btn[\s\S]*?if\s*\(pendingDishUploadedR2Key\s*&&\s*pendingDishUploadedR2Key\s*!==\s*r2Key[\s\S]*?cloudflareR2Service\.deleteImage\(pendingDishUploadedR2Key\)/,
      'admin.js preset click listener must clean up pendingDishUploadedR2Key from R2'
    );
    const uploadBlock = adminJs.slice(adminJs.indexOf('if (!firstUploadedUrl)'), adminJs.indexOf('if (firstUploadedUrl && successCount > 0)'));
    assert.doesNotMatch(
      uploadBlock,
      /if\s*\(!uploadSucceeded\)\s*\{\s*await\s+dataService\.saveUploadedImage/,
      'admin.js must not persist failed Base64 image to uploaded_images gallery'
    );
    assert.match(
      uploadBlock,
      /if\s*\(!uploadSucceeded\)\s*\{\s*dishPreviewImg\.src\s*=\s*dishImageUrl\.value\s*\|\|\s*['"]\/images\/crispy-chicken\.jpg['"];/,
      'admin.js must revert dishPreviewImg.src on failed upload'
    );
  });

  // KITCHEN-BUG-04: Unhandled promise rejections & prevCatImages rollback in dataService.js
  await t.test('4. [KITCHEN-BUG-04] dataService.js catches category image operations and rolls back CATEGORY_IMAGES storage', () => {
    assert.match(
      dataServiceJs,
      /addCategory\s*\([\s\S]*?saveCategoryImage\(newCat\.id,\s*newCat\.image\)\?\.catch\?\.[\s\S]*?localStorage\.setItem\(STORAGE_KEYS\.CATEGORY_IMAGES,\s*JSON\.stringify\(prevCatImages\)\)/,
      'addCategory must safely catch saveCategoryImage and rollback CATEGORY_IMAGES storage on error'
    );
    assert.match(
      dataServiceJs,
      /updateCategory\s*\([\s\S]*?saveCategoryImage\(list\[idx\]\.id,\s*sanitized\)\?\.catch\?\.[\s\S]*?localStorage\.setItem\(STORAGE_KEYS\.CATEGORY_IMAGES,\s*JSON\.stringify\(prevCatImages\)\)/,
      'updateCategory must safely catch saveCategoryImage and rollback CATEGORY_IMAGES storage on error'
    );
    assert.match(
      dataServiceJs,
      /deleteCategory\s*\([\s\S]*?this\.removeCategoryImage\(cat\.id\)\?\.catch\?\.[\s\S]*?localStorage\.setItem\(STORAGE_KEYS\.CATEGORY_IMAGES,\s*JSON\.stringify\(prevCatImages\)\)/,
      'deleteCategory must safely catch removeCategoryImage and restore CATEGORY_IMAGES storage on error'
    );
  });

  // KITCHEN-BUG-05: nosniff headers and Dual-API CORS parity for R2 endpoints
  await t.test('5. [KITCHEN-BUG-05] R2 audio/video endpoints enforce nosniff and R2 endpoints support origin CORS with x-admin-token', () => {
    assert.match(apiR2AudioJs, /X-Content-Type-Options['"],\s*['"]nosniff['"]/, 'api/r2-audio.js must set nosniff header');
    assert.match(functionsApiR2AudioJs, /X-Content-Type-Options['"],\s*['"]nosniff['"]/, 'functions/api/r2-audio.js must set nosniff header');
    assert.match(apiR2VideoJs, /X-Content-Type-Options['"],\s*['"]nosniff['"]/, 'api/r2-video.js must set nosniff header');
    assert.match(functionsApiR2VideoJs, /X-Content-Type-Options['"],\s*['"]nosniff['"]/, 'functions/api/r2-video.js must set nosniff header');

    assert.match(apiR2UploadJs, /x-admin-token/, 'api/r2-upload.js must allow x-admin-token header');
    assert.match(functionsApiR2UploadJs, /x-admin-token/, 'functions/api/r2-upload.js must allow x-admin-token header');
    assert.match(apiR2DeleteJs, /x-admin-token/, 'api/r2-delete.js must allow x-admin-token header');
    assert.match(functionsApiR2DeleteJs, /x-admin-token/, 'functions/api/r2-delete.js must allow x-admin-token header');
    assert.match(apiR2ListJs, /x-admin-token/, 'api/r2-list.js must allow x-admin-token header');
    assert.match(functionsApiR2ListJs, /x-admin-token/, 'functions/api/r2-list.js must allow x-admin-token header');

    assert.match(apiR2UploadJs, /isOriginAllowed\(origin\)/, 'api/r2-upload.js must check isOriginAllowed');
    assert.match(functionsApiR2UploadJs, /isOriginAllowed\(origin\)/, 'functions/api/r2-upload.js must check isOriginAllowed');
  });

  // KITCHEN-BUG-06: Consolidated SQL scripts include unassigned on_the_way claim check
  await t.test('6. [KITCHEN-BUG-06] supabase_setup.sql and supabase_production_security_hardening.sql include Migration 13 rider claim condition', () => {
    const expectedSqlCondition = "IF v_order.status <> 'ready_for_pickup' AND NOT (v_order.status = 'on_the_way' AND v_existing_pin = '') THEN";
    assert.ok(
      supabaseSetupSql.includes(expectedSqlCondition),
      'supabase_setup.sql must include Migration 13 condition for claiming unassigned on_the_way order'
    );
    assert.ok(
      supabaseHardeningSql.includes(expectedSqlCondition),
      'supabase_production_security_hardening.sql must include Migration 13 condition for claiming unassigned on_the_way order'
    );
  });
});
