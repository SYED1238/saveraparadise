import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('LIVE OFFER SYNC & REALTIME DOM CLEANUP SUITE', async (t) => {
  const dataServiceJs = fs.readFileSync('dataService.js', 'utf8');
  const mainJs = fs.readFileSync('main.js', 'utf8');

  await t.test('1. dataService.js triggers broadcastSettings after cloud persistence', () => {
    // broadcastSettings must be triggered inside syncSettingsToSupabase upon successful _adminStoreAction
    assert.match(
      dataServiceJs,
      /await this\._adminStoreAction\('save_settings',\s*\{ settings:\s*payloadSettings \}\);\s*\n\s*\/\/ Authoritative cloud sync succeeded; broadcast to other devices now that DB row is committed\s*\n\s*this\.broadcastSettings\(payloadSettings\);/,
      'syncSettingsToSupabase must call broadcastSettings after cloud save finishes'
    );
    // saveSettings must not prematurely broadcast before cloud sync
    assert.doesNotMatch(
      dataServiceJs,
      /localStorage\.setItem\(STORAGE_KEYS\.SETTINGS,\s*JSON\.stringify\(toSave\)\);\s*\n\s*this\.notifyChange\('settings',\s*\{ settings:\s*toSave \}\);\s*\n\s*this\.broadcastSettings\(toSave\);\s*\n\s*return this\.syncSettingsToSupabase\(toSave\);/,
      'saveSettings must not broadcast before syncSettingsToSupabase runs'
    );
  });

  await t.test('2. dataService.js implements _pendingSettingsResync queue for in-flight syncs', () => {
    assert.match(dataServiceJs, /this\._pendingSettingsResync\s*=\s*false;/, 'Constructor must initialize _pendingSettingsResync');
    assert.match(
      dataServiceJs,
      /if\s*\(this\._isSyncingSettings\)\s*\{\s*\n\s*if\s*\(force\)\s*\{\s*\n\s*this\._pendingSettingsResync\s*=\s*true;\s*\n\s*\}\s*\n\s*return\s*this\._isSyncingSettings;\s*\n\s*\}/,
      'syncSettingsFromSupabase must set _pendingSettingsResync when force is true during an in-flight sync'
    );
    assert.match(
      dataServiceJs,
      /if\s*\(this\._pendingSettingsResync\)\s*\{\s*\n\s*this\._pendingSettingsResync\s*=\s*false;\s*\n\s*this\.syncSettingsFromSupabase\(true\)/,
      'syncSettingsFromSupabase .finally() must drain _pendingSettingsResync with force=true'
    );
  });

  await t.test('3. dataService.js settings_updated listener has resilient follow-up timer and tab resume forces sync', () => {
    assert.match(
      dataServiceJs,
      /'settings_updated'[\s\S]*?setTimeout\(\(\)\s*=>\s*\{[\s\S]*?this\.syncSettingsFromSupabase\(true\)/,
      'settings_updated listener must execute follow-up syncSettingsFromSupabase(true)'
    );
    assert.match(
      dataServiceJs,
      /if\s*\(now\s*-\s*\(this\._lastSettingsSyncTime\s*\|\|\s*0\)\s*>\s*15000\)\s*\{\s*[\r\n\s]*this\.syncSettingsFromSupabase\(true\);/,
      'handleTabResume must force sync settings when last sync was > 15s ago'
    );
  });

  await t.test('4. main.js toggles #special-offers section and nav button with zero whitespace gap', () => {
    assert.match(
      mainJs,
      /const\s+specialOffersSection\s*=\s*document\.getElementById\('special-offers'\);/,
      'updateStoreOfferUI must reference special-offers section'
    );
    assert.match(
      mainJs,
      /specialOffersSection\.style\.display\s*=\s*isActive\s*\?\s*''\s*:\s*'none';/,
      'specialOffersSection must be hidden when isActive is false'
    );
    assert.match(
      mainJs,
      /mobileNavOffers\.style\.display\s*=\s*isActive\s*\?\s*''\s*:\s*'none';/,
      'mobileNavOffers must be hidden when isActive is false'
    );
    assert.match(
      mainJs,
      /promoBannerCard\.style\.display\s*=\s*'';/,
      'promoBannerCard must restore native stylesheet grid with display = empty string'
    );
  });

  await t.test('5. main.js tracks auto-prefilled code and re-evaluates appliedPromo on settings change', () => {
    assert.match(mainJs, /let\s+lastAutoPrefilledPromoCode\s*=\s*null;/, 'main.js must track lastAutoPrefilledPromoCode');
    assert.match(
      mainJs,
      /if\s*\(!isActive\)\s*\{\s*\n\s*if\s*\(curInputVal\s*===\s*\(lastAutoPrefilledPromoCode\s*\|\|\s*code\)\)\s*\{\s*\n\s*cartPromoInput\.value\s*=\s*'';\s*\n\s*lastAutoPrefilledPromoCode\s*=\s*null;/,
      'updateStoreOfferUI must clear cartPromoInput when offer is deactivated'
    );
    assert.match(
      mainJs,
      /const\s+evalRes\s*=\s*evaluatePromoCode\(appliedPromo,\s*subtotal,\s*settings\);/,
      'updateStoreOfferUI must re-validate appliedPromo against live settings'
    );
  });

  await t.test('6. main.js refreshes open food detail modal price when unlockedDeals change', () => {
    assert.match(
      mainJs,
      /if\s*\(foodDetailBackdrop\s*&&\s*foodDetailBackdrop\.classList\.contains\('open'\)\s*&&\s*activeDetailItem\)/,
      'settings change must update open food detail modal price'
    );
  });
});
