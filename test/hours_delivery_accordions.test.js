import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

if (typeof global.localStorage === 'undefined') {
  const store = new Map();
  global.localStorage = {
    getItem: (key) => store.get(String(key)) ?? null,
    setItem: (key, val) => store.set(String(key), String(val)),
    removeItem: (key) => store.delete(String(key)),
    clear: () => store.clear(),
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; }
  };
}

describe('STORE HOURS & DELIVERY ACCORDION DROPDOWNS SUITE', () => {
  const adminHtmlPath = fs.existsSync(path.resolve('admin.html')) ? path.resolve('admin.html') : path.resolve('savera-cloudflare-migration/admin.html');
  const adminJsPath = fs.existsSync(path.resolve('admin.js')) ? path.resolve('admin.js') : path.resolve('savera-cloudflare-migration/admin.js');
  const adminCssPath = fs.existsSync(path.resolve('admin.css')) ? path.resolve('admin.css') : path.resolve('savera-cloudflare-migration/admin.css');

  const adminHtml = fs.readFileSync(adminHtmlPath, 'utf8');
  const adminJs = fs.readFileSync(adminJsPath, 'utf8');
  const adminCss = fs.readFileSync(adminCssPath, 'utf8');

  it('1. admin.html contains collapsible accordion cards for Store Hours & Rush (#hours-card-rush, #hours-card-schedule)', () => {
    assert.match(adminHtml, /id="hours-card-rush"/);
    assert.match(adminHtml, /id="hours-card-schedule"/);
    assert.match(adminHtml, /id="hours-header-rush"/);
    assert.match(adminHtml, /id="hours-header-schedule"/);
    assert.match(adminHtml, /id="hours-body-rush"/);
    assert.match(adminHtml, /id="hours-body-schedule"/);
  });

  it('2. admin.html contains collapsible accordion cards for Delivery (#delivery-card-options, #delivery-card-radius, #delivery-card-fleet)', () => {
    assert.match(adminHtml, /id="delivery-card-options"/);
    assert.match(adminHtml, /id="delivery-card-radius"/);
    assert.match(adminHtml, /id="delivery-card-fleet"/);
    assert.match(adminHtml, /id="delivery-header-options"/);
    assert.match(adminHtml, /id="delivery-header-radius"/);
    assert.match(adminHtml, /id="delivery-header-fleet"/);
    assert.match(adminHtml, /id="delivery-body-options"/);
    assert.match(adminHtml, /id="delivery-body-radius"/);
    assert.match(adminHtml, /id="delivery-body-fleet"/);
  });

  it('3. admin.html contains summary chips containers and live summary tags', () => {
    // Hours chips
    assert.match(adminHtml, /id="rush-collapsed-summary"/);
    assert.match(adminHtml, /id="summary-rush-status"/);
    assert.match(adminHtml, /id="summary-rush-mins"/);
    assert.match(adminHtml, /id="summary-rush-reason"/);
    assert.match(adminHtml, /id="schedule-collapsed-summary"/);
    assert.match(adminHtml, /id="summary-schedule-status"/);
    assert.match(adminHtml, /id="summary-schedule-hours"/);
    assert.match(adminHtml, /id="summary-schedule-phone"/);

    // Delivery chips
    assert.match(adminHtml, /id="delivery-collapsed-summary"/);
    assert.match(adminHtml, /id="summary-delivery-free"/);
    assert.match(adminHtml, /id="summary-delivery-fee"/);
    assert.match(adminHtml, /id="summary-delivery-mov"/);
    assert.match(adminHtml, /id="summary-delivery-max-orders"/);
    assert.match(adminHtml, /id="radius-collapsed-summary"/);
    assert.match(adminHtml, /id="summary-delivery-radius"/);
    assert.match(adminHtml, /id="fleet-collapsed-summary"/);
    assert.match(adminHtml, /id="summary-fleet-active"/);
  });

  it('4. admin.html contains accordion toggle and close buttons', () => {
    assert.match(adminHtml, /id="btn-toggle-rush"/);
    assert.match(adminHtml, /id="btn-toggle-schedule"/);
    assert.match(adminHtml, /id="btn-toggle-delivery-options"/);
    assert.match(adminHtml, /id="btn-toggle-delivery-radius"/);
    assert.match(adminHtml, /id="btn-toggle-delivery-fleet"/);
    assert.match(adminHtml, /btn-close-hours-panel/);
    assert.match(adminHtml, /btn-close-delivery-panel/);
  });

  it('5. admin.js implements initHoursAccordion and initDeliveryAccordion controllers', () => {
    assert.match(adminJs, /function\s+initHoursAccordion\s*\(/);
    assert.match(adminJs, /function\s+initDeliveryAccordion\s*\(/);
    assert.match(adminJs, /initHoursAccordion\(\);/);
    assert.match(adminJs, /initDeliveryAccordion\(\);/);
  });

  it('6. admin.js implements syncHoursSummaryChips and syncDeliverySummaryChips helpers', () => {
    assert.match(adminJs, /function\s+syncHoursSummaryChips\s*\(/);
    assert.match(adminJs, /function\s+syncDeliverySummaryChips\s*\(/);
    assert.match(adminJs, /syncHoursSummaryChips\(\);/);
    assert.match(adminJs, /syncDeliverySummaryChips\(\);/);
  });

  it('7. admin.js hooks chip synchronizers to user interactions and form submissions', () => {
    assert.match(adminJs, /syncHoursSummaryChips\(\);[\s\S]*?Store operating timings, notice & helpline updated!/);
    assert.match(adminJs, /syncDeliverySummaryChips\(\);[\s\S]*?Maximum delivery radius saved/);
  });

  it('8. admin.css styles accordion headers, toggle buttons, chips, and animated bodies', () => {
    assert.match(adminCss, /\.offer-settings-section/);
    assert.match(adminCss, /\.offer-collapsible-header/);
    assert.match(adminCss, /\.offer-summary-chip/);
    assert.match(adminCss, /\.btn-toggle-offer-accordion/);
    assert.match(adminCss, /\.offer-collapsible-body/);
    assert.match(adminCss, /@keyframes\s+offerSlideDown/);
  });
  it('9. Live sync: hours summary chips sync even when store is closed, and inputs attach live listeners', () => {
    assert.ok(adminJs.includes('syncHoursSummaryChips') && adminJs.includes('topRushBadge.style.display'), 'updateRushUI must sync chips before early return when store is closed');
    assert.ok(adminJs.includes('inputOpenTime?.addEventListener') && adminJs.includes('syncHoursSummaryChips'), 'inputOpenTime must trigger live chip sync');
    assert.ok(adminJs.includes('inputRestaurantPhone?.addEventListener') && adminJs.includes('syncHoursSummaryChips'), 'inputRestaurantPhone must trigger live chip sync');
    assert.ok(adminJs.includes('rushRangeSlider') && adminJs.includes('syncHoursSummaryChips'), 'rushRangeSlider must trigger live chip sync');
    assert.ok(adminJs.includes('rushReasonInput?.addEventListener') && adminJs.includes('syncHoursSummaryChips'), 'rushReasonInput must trigger live chip sync');
  });

  it('10. Live sync: delivery preview and preset clicks trigger live summary chip updates, and deliveryStatusBadge aligns with freeEnabled', () => {
    assert.ok(adminJs.includes('function updateDeliveryPreview()') && adminJs.includes('syncDeliverySummaryChips'), 'updateDeliveryPreview must call syncDeliverySummaryChips');
    assert.ok(adminJs.includes('movPresetsContainer') && adminJs.includes('updateDeliveryPreview'), 'mov presets must call updateDeliveryPreview');
    assert.ok(adminJs.includes('radiusPresetBtns') && adminJs.includes('syncDeliverySummaryChips'), 'radius presets must call syncDeliverySummaryChips');
    assert.ok(adminJs.includes('deliveryStatusBadge.textContent = freeEnabled ?'), 'deliveryStatusBadge must reflect freeEnabled');
  });

  it('11. Auto-close on save: hours form, radius button, and delivery options auto-collapse on save', () => {
    assert.ok(adminJs.includes('.btn-close-hours-panel[data-target="hours-card-schedule"]'), 'Hours form must auto-close on save');
    assert.ok(adminJs.includes('.btn-close-delivery-panel[data-target="delivery-card-radius"]'), 'Radius form must auto-close on save');
    assert.ok(adminJs.includes('.btn-close-delivery-panel[data-target="delivery-card-options"]'), 'Delivery options form must auto-close on save');
  });

  it('12. Accordion accessibility: header and button aria-expanded attributes remain in sync', () => {
    assert.ok(adminJs.includes('.offer-collapsible-header') && adminJs.includes("header.setAttribute('aria-expanded'"), 'toggleHoursCard and toggleDeliveryCard must sync header aria-expanded');
  });

  it('13. parseTimeToMinutes and dataService.isStoreOpen() evaluate operating hours against IST clock', async () => {
    const { dataService, parseTimeToMinutes } = await import('../dataService.js');
    assert.strictEqual(parseTimeToMinutes('11:00 AM'), 660);
    assert.strictEqual(parseTimeToMinutes('9:00 PM'), 1260);
    assert.strictEqual(parseTimeToMinutes('11:00 PM'), 1380);
    assert.strictEqual(parseTimeToMinutes('12:00 PM'), 720);
    assert.strictEqual(parseTimeToMinutes('12:00 AM'), 0);

    // Save test settings: open 9:00 PM to 11:00 PM
    dataService.saveSettings({
      ...dataService.getSettings(),
      storeOpen: true,
      openTime: '9:00 PM',
      closeTime: '11:00 PM'
    });

    // At 5:33 PM IST (17:33 IST): store must be closed
    const dateAt533PM = new Date('2026-11-11T12:03:00Z'); // 12:03 UTC = 17:33 IST (5:33 PM)
    assert.strictEqual(dataService.isStoreOpen(dateAt533PM), false, 'Store must evaluate to closed at 5:33 PM when hours are 9:00 PM - 11:00 PM');

    // At 9:30 PM IST (21:30 IST): store must be open
    const dateAt930PM = new Date('2026-11-11T16:00:00Z'); // 16:00 UTC = 21:30 IST (9:30 PM)
    assert.strictEqual(dataService.isStoreOpen(dateAt930PM), true, 'Store must evaluate to open at 9:30 PM when hours are 9:00 PM - 11:00 PM');

    // At 11:15 PM IST (23:15 IST): store must be closed
    const dateAt1115PM = new Date('2026-11-11T17:45:00Z'); // 17:45 UTC = 23:15 IST (11:15 PM)
    assert.strictEqual(dataService.isStoreOpen(dateAt1115PM), false, 'Store must evaluate to closed at 11:15 PM when hours are 9:00 PM - 11:00 PM');

    // Master toggle OFF overrides clock:
    dataService.saveSettings({ ...dataService.getSettings(), storeOpen: false });
    assert.strictEqual(dataService.isStoreOpen(dateAt930PM), false, 'Master toggle OFF must always close store even during open hours');
  });

  it('14. dataService.isStoreOpen() supports overnight windows (e.g. 9:00 PM to 2:00 AM)', async () => {
    const { dataService } = await import('../dataService.js');
    dataService.saveSettings({
      ...dataService.getSettings(),
      storeOpen: true,
      openTime: '9:00 PM',
      closeTime: '2:00 AM'
    });

    const lateNight1AM = new Date('2026-11-11T19:30:00Z'); // 19:30 UTC = 01:00 IST (1:00 AM)
    assert.strictEqual(dataService.isStoreOpen(lateNight1AM), true, 'Overnight window should be open at 1:00 AM');

    const morning6AM = new Date('2026-11-11T00:30:00Z'); // 00:30 UTC = 06:00 IST (6:00 AM)
    assert.strictEqual(dataService.isStoreOpen(morning6AM), false, 'Overnight window should be closed at 6:00 AM');
  });

  it('15. admin.js syncHoursSummaryChips and updateRushUI show Scheduled Closed when storeOpen is true but outside clock hours', () => {
    assert.ok(adminJs.includes("Scheduled Closed (Opens"), 'admin.js must show Scheduled Closed with opening time');
    assert.ok(adminJs.includes("dataService.isStoreOpen"), 'admin.js must check dataService.isStoreOpen');
  });
});
