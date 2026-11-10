import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('ADMIN MENU & DISH UPLOAD INTEGRITY SUITE', () => {
  const adminJsPath = path.resolve(process.cwd(), 'admin.js');
  const adminHtmlPath = path.resolve(process.cwd(), 'admin.html');
  const adminJsContent = fs.readFileSync(adminJsPath, 'utf8');
  const adminHtmlContent = fs.readFileSync(adminHtmlPath, 'utf8');

  it('1. admin.js protects formDish submit against misplaced catch/finally syntax error', () => {
    // Verifies console.error and showToast are strictly inside catch block and not finally
    assert.doesNotMatch(
      adminJsContent,
      /\}\s*catch\s*\(\w+\)\s*\{\s*\}\s*finally\s*\{[^}]*showToast\(`Error saving dish/s,
      'catch block must not be empty with error toast in finally'
    );

    // Verifies submit handler correctly catches errors
    assert.match(
      adminJsContent,
      /catch\s*\((err|e)\)\s*\{[\s\S]*?console\.error\('\[Dish Save Error\]:'[\s\S]*?showToast\(`Error saving dish:/,
      'formDish catch block must handle dish save errors directly'
    );
  });

  it('2. admin.js guards dish and category forms against duplicate double-submissions', () => {
    assert.match(
      adminJsContent,
      /if\s*\(\s*isSubmittingDish\s*\)\s*return/,
      'formDish submit must immediately guard against isSubmittingDish'
    );
    assert.match(
      adminJsContent,
      /if\s*\(\s*isSubmittingCat\s*\)\s*return/,
      'formCategory submit must immediately guard against isSubmittingCat'
    );
  });

  it('3. admin.js prevents saving dishes or categories while image upload is still in flight', () => {
    assert.match(
      adminJsContent,
      /if\s*\(\s*isUploadingDishPhoto\s*\)/,
      'formDish must detect when photo upload is still running'
    );
    assert.match(
      adminJsContent,
      /if\s*\(\s*isUploadingCatPhoto\s*\)/,
      'formCategory must detect when photo upload is still running'
    );
  });

  it('4. admin.js preserves dish.r2Key when editing dishes', () => {
    assert.match(
      adminJsContent,
      /currentDishGdriveFileId\s*=\s*dish\.r2Key\s*\|\|\s*dish\.gdriveFileId\s*\|\|\s*''/,
      'openEditDishModal must preserve existing dish.r2Key'
    );
  });

  it('5. admin.js validates dish title and positive pricing before submitting', () => {
    assert.match(
      adminJsContent,
      /if\s*\(\s*!name\s*\)\s*\{[\s\S]*?showToast\('Please enter a dish title/,
      'formDish must warn user when dish name is empty'
    );
    assert.match(
      adminJsContent,
      /if\s*\(\s*isNaN\(parsedPrice\)\s*\|\|\s*parsedPrice\s*<=\s*0\s*\)/,
      'formDish must reject zero or negative price'
    );
  });

  it('6. admin.js always resets file upload input value to permit re-uploading identical file names', () => {
    assert.match(
      adminJsContent,
      /if\s*\(catFileUpload\)\s*catFileUpload\.value\s*=\s*''/,
      'catFileUpload input value must be reset in finally'
    );
    assert.match(
      adminJsContent,
      /dishFileUpload\.value\s*=\s*''/,
      'dishFileUpload input value must be reset in finally'
    );
  });

  it('7. admin.html contains all required category and dish modal inputs and controls', () => {
    const requiredElements = [
      'id="form-category"',
      'id="cat-name-input"',
      'id="cat-emoji-input"',
      'id="cat-image-input"',
      'id="cat-file-upload"',
      'id="cat-upload-status"',
      'id="btn-save-cat"',
      'id="form-dish"',
      'id="dish-name-input"',
      'id="dish-category-select"',
      'id="dish-price-input"',
      'id="dish-file-upload"',
      'id="dish-upload-spinner"',
      'id="btn-save-dish"',
      'id="modal-dish-stock-btn"'
    ];

    for (const elem of requiredElements) {
      assert.ok(adminHtmlContent.includes(elem), `admin.html missing required element: ${elem}`);
    }
  });

  it('8. dataService.js safely executes dish and category mutations without calling undefined .catch on Supabase builders', () => {
    const dataServicePath = path.resolve(process.cwd(), 'dataService.js');
    const dataServiceContent = fs.readFileSync(dataServicePath, 'utf8');

    // Asserts no direct .catch call on naked supabase.from(...).update/insert/delete without Promise.resolve
    assert.doesNotMatch(
      dataServiceContent,
      /^\s*supabase\.from\([^)]+\)\.(insert|update|delete)[^;\n]+\.catch\(/m,
      'supabase query builder must not directly invoke .catch (PostgrestFilterBuilder is a thenable lacking .catch)'
    );
  });

  it('9. admin.js strictly awaits authoritative dataService dish and category mutations', () => {
    // Verifies formDish awaits updateDish and addDish
    assert.match(
      adminJsContent,
      /await\s+dataService\.updateDish\(/,
      'admin.js must await dataService.updateDish before showing success'
    );
    assert.match(
      adminJsContent,
      /await\s+dataService\.addDish\(/,
      'admin.js must await dataService.addDish before showing success'
    );
    // Verifies formCategory awaits updateCategory and addCategory
    assert.match(
      adminJsContent,
      /await\s+dataService\.updateCategory\(/,
      'admin.js must await dataService.updateCategory before showing success'
    );
    assert.match(
      adminJsContent,
      /await\s+dataService\.addCategory\(/,
      'admin.js must await dataService.addCategory before showing success'
    );
  });

  it('10. api/admin-store.js and functions/api/admin-store.js guard against 0-row silent updates', () => {
    const nodeApiPath = path.resolve(process.cwd(), 'api/admin-store.js');
    const cfApiPath = path.resolve(process.cwd(), 'functions/api/admin-store.js');
    const nodeApiContent = fs.readFileSync(nodeApiPath, 'utf8');
    const cfApiContent = fs.readFileSync(cfApiPath, 'utf8');

    for (const content of [nodeApiContent, cfApiContent]) {
      assert.match(content, /upsertRes\s*=\s*await\s+sb\.from\('dishes'\)\.upsert/, 'Must upsert unseeded dish if update touched 0 rows');
      assert.match(content, /upsertRes\s*=\s*await\s+sb\.from\('categories'\)\.upsert/, 'Must upsert unseeded category if update touched 0 rows');
    }
  });

  it('11. dataService.js category image and settings persistence uses _adminStoreAction with rollback', () => {
    const dataServicePath = path.resolve(process.cwd(), 'dataService.js');
    const dataServiceContent = fs.readFileSync(dataServicePath, 'utf8');

    // Asserts saveCategoryImage and syncSettingsToSupabase call _adminStoreAction
    assert.match(dataServiceContent, /_adminStoreAction\('save_category_images'/, 'saveCategoryImage must use _adminStoreAction');
    assert.match(dataServiceContent, /_adminStoreAction\('save_settings'/, 'syncSettingsToSupabase must use _adminStoreAction');

    // Asserts setAllCategoryImage updates both keys in one map and uses _adminStoreAction
    assert.match(dataServiceContent, /map\['all'\]\s*=\s*sanitized;[\s\S]*map\['cat-all'\]\s*=\s*sanitized;/, 'setAllCategoryImage must set both keys in single map');

    // Asserts no direct store_settings.upsert(...).catch
    assert.doesNotMatch(dataServiceContent, /store_settings'\)\.upsert[^;\n]+\.catch\(/, 'store_settings upsert must not directly invoke .catch');
  });

  it('12. admin.js strictly awaits category photo upload mutations', () => {
    // Verifies category photo upload reader awaits persistence
    assert.match(
      adminJsContent,
      /await\s+dataService\.saveCategoryImage\(/,
      'admin.js must await dataService.saveCategoryImage during photo upload'
    );
    assert.match(
      adminJsContent,
      /await\s+dataService\.setAllCategoryImage\(/,
      'admin.js must await dataService.setAllCategoryImage during "all" photo upload'
    );
    assert.match(
      adminJsContent,
      /await\s+dataService\.updateCategory\(activeEditId,\s*\{\s*image:\s*finalImg\s*\}\)/,
      'admin.js must await dataService.updateCategory for active category photo upload'
    );
  });

  it('13. api/admin-store.js and functions/api/admin-store.js delete operations return 404 when 0 rows affected and only fall back for missing RPC', () => {
    const nodeApiPath = path.resolve(process.cwd(), 'api/admin-store.js');
    const cfApiPath = path.resolve(process.cwd(), 'functions/api/admin-store.js');
    const nodeApiContent = fs.readFileSync(nodeApiPath, 'utf8');
    const cfApiContent = fs.readFileSync(cfApiPath, 'utf8');

    for (const content of [nodeApiContent, cfApiContent]) {
      // delete_dish must select and return 404 if not found
      assert.match(content, /sb\.from\('dishes'\)\.delete\(\)\.eq\('id',\s*id\)\.select\(\)/, 'delete_dish must select deleted rows');
      assert.match(content, /Dish '.*' not found in database to delete/, 'delete_dish must return 404 if zero rows affected');

      // delete_category must attempt delete_category_cascade RPC
      assert.match(content, /delete_category_cascade/, 'delete_category must call delete_category_cascade RPC');
      assert.match(content, /isMissingRpc/, 'delete_category must strictly detect if RPC is missing');
      assert.match(content, /Category '.*' not found in database to delete/, 'delete_category fallback must return 404 if zero rows affected');
    }
  });

  it('14. Migration 11 provides transactional delete_category_cascade RPC with safe search_path, locks category first, and restricts execution to service_role', () => {
    const mig11Path = path.resolve(process.cwd(), 'supabase_migration_11_atomic_category_deletion.sql');
    assert.ok(fs.existsSync(mig11Path), 'supabase_migration_11_atomic_category_deletion.sql must exist');
    const mig11Content = fs.readFileSync(mig11Path, 'utf8');

    assert.match(mig11Content, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.delete_category_cascade/i);
    assert.match(mig11Content, /SECURITY\s+DEFINER/i);
    assert.match(mig11Content, /SET\s+search_path\s*=\s*public/i);

    // Security: must revoke from authenticated and grant strictly to service_role
    assert.match(mig11Content, /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.delete_category_cascade.*FROM\s+anon/i);
    assert.match(mig11Content, /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.delete_category_cascade.*FROM\s+authenticated/i);
    assert.match(mig11Content, /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.delete_category_cascade.*TO\s+service_role/i);
    assert.doesNotMatch(mig11Content, /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.delete_category_cascade.*TO\s+authenticated/i, 'Must NOT grant execution to authenticated role');

    // Pre-validation: must lock category row before deleting dishes
    const selectLockIdx = mig11Content.indexOf('FOR UPDATE');
    const deleteDishIdx = mig11Content.indexOf('DELETE FROM public.dishes');
    assert.ok(selectLockIdx !== -1 && selectLockIdx < deleteDishIdx, 'Category row must be locked with FOR UPDATE BEFORE deleting dishes');
  });
});
