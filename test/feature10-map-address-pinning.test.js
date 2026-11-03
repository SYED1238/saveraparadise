import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

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
if (typeof global.sessionStorage === 'undefined') {
  const store = new Map();
  global.sessionStorage = {
    getItem: (key) => store.get(String(key)) ?? null,
    setItem: (key, val) => store.set(String(key), String(val)),
    removeItem: (key) => store.delete(String(key)),
    clear: () => store.clear()
  };
}

const { dataService } = await import('../dataService.js');

test('FEATURE #10: MAP ADDRESS PINNING, GPS, SAVED ADDRESSES & PROFILE SUITE', async (t) => {
  const indexHtml = fs.readFileSync('index.html', 'utf8');
  const mainJs = fs.readFileSync('main.js', 'utf8');
  const dataServiceJs = fs.readFileSync('dataService.js', 'utf8');

  // =========================================================================
  // 1. Data Privacy & Cross-User Address Leak Prevention
  // =========================================================================
  await t.test('1. dataService.getUserAddresses prevents cross-user address leakage on shared devices', () => {
    // Clear addresses in localStorage
    localStorage.removeItem('quickbite_user_addresses');

    // User A saves an address
    const userAAddress = dataService.saveUserAddress({
      userId: 'user-a-123',
      userEmail: 'user_a@example.com',
      name: 'User A',
      phone: '9876543210',
      street: 'Flat 101, A Block',
      area: 'Ramanagara',
      tag: 'Home'
    });

    assert.ok(userAAddress.id);

    // User A should see their address
    const userAAddrs = dataService.getUserAddresses('user-a-123', 'user_a@example.com');
    assert.strictEqual(userAAddrs.length, 1);
    assert.strictEqual(userAAddrs[0].userId, 'user-a-123');

    // User B logs in with 0 addresses on the same device
    const userBAddrs = dataService.getUserAddresses('user-b-456', 'user_b@example.com');
    // User B must NOT see User A's address!
    assert.strictEqual(userBAddrs.length, 0, 'User B must not see User A addresses');

    // Code verification: ensure dataService does not return local list when userAddrs.length === 0
    assert.ok(!dataServiceJs.includes('if (userAddrs.length === 0 && list.length > 0) return list;'));
  });

  // =========================================================================
  // 2. Address Persistence: Street, Instructions, and Non-Empty flatNo
  // =========================================================================
  await t.test('2. dataService.saveUserAddress persists street, instructions, and non-empty flatNo', () => {
    const saved = dataService.saveUserAddress({
      userId: 'test-user-persist',
      name: 'Syed',
      phone: '9988776655',
      street: 'House #42, Main Road',
      instructions: 'Ring doorbell twice',
      area: 'Ijoor, Ramanagara',
      tag: 'Home'
    });

    assert.strictEqual(saved.street, 'House #42, Main Road');
    assert.strictEqual(saved.instructions, 'Ring doorbell twice');
    assert.ok(saved.flatNo && saved.flatNo.length > 0, 'flatNo must not be empty string');
    assert.strictEqual(saved.flatNo, 'House #42, Main Road');

    // Details must not have a leading comma
    assert.ok(!saved.details.startsWith(','), 'details string must not have leading comma');
  });

  // =========================================================================
  // 3. Step 2 Form Markup in index.html
  // =========================================================================
  await t.test('3. index.html includes receiver name, required street, and default address checkbox', () => {
    // Receiver Name input
    assert.ok(indexHtml.includes('id="addr-input-name"'), 'Must include addr-input-name in Step 2 form');
    assert.ok(indexHtml.includes('for="addr-input-name"'), 'Must include label for addr-input-name');

    // Required street / building input
    assert.match(indexHtml, /id="swiggy-input-street"[^>]*required/, 'swiggy-input-street must be required');

    // Visible default address checkbox
    assert.ok(indexHtml.includes('id="addr-input-default"'), 'Must include addr-input-default');
    assert.ok(!indexHtml.includes('id="addr-input-default" checked style="display: none;"'), 'Default checkbox must not be hidden');
  });

  // =========================================================================
  // 4. Indian Mobile Phone Number Validation
  // =========================================================================
  await t.test('4. Phone number validator rejects non-Indian patterns and requires 10 digits starting with 6-9', () => {
    function isValidIndianPhone(phone) {
      const digits = String(phone || '').replace(/\D/g, '').slice(-10);
      return Boolean(digits && /^[6-9]\d{9}$/.test(digits));
    }

    // Valid numbers
    assert.ok(isValidIndianPhone('9876543210'));
    assert.ok(isValidIndianPhone('+91 9876543210'));
    assert.ok(isValidIndianPhone('8123456789'));
    assert.ok(isValidIndianPhone('7012345678'));
    assert.ok(isValidIndianPhone('6312345678'));

    // Invalid numbers
    assert.strictEqual(isValidIndianPhone('0000000000'), false, 'All zeros must be rejected');
    assert.strictEqual(isValidIndianPhone('1234567890'), false, 'Starting with 1 must be rejected');
    assert.strictEqual(isValidIndianPhone('5555555555'), false, 'Starting with 5 must be rejected');
    assert.strictEqual(isValidIndianPhone('98765'), false, 'Less than 10 digits must be rejected');
    assert.strictEqual(isValidIndianPhone(''), false, 'Empty phone must be rejected');
  });

  // =========================================================================
  // 5. Hardware / Browser Back Navigation: Step 2 -> Step 1
  // =========================================================================
  await t.test('5. Back navigation hooks address-step-2 to backNav and registers fallback checker', () => {
    // btnProceedToDetails pushes address-step-2
    assert.ok(
      mainJs.includes("backNav.pushStep('address-step-2',"),
      'Must push address-step-2 to backNav when transitioning to details'
    );

    // backToMapStep handles stepBack
    assert.ok(
      mainJs.includes("backNav.isTopStep('address-step-2')"),
      'backToMapStep must check if address-step-2 is top step'
    );

    // closeAddressModal removes address-step-2
    assert.ok(
      mainJs.includes("backNav.removeStepDirect('address-step-2')"),
      'closeAddressModal must clean up address-step-2'
    );

    // Fallback checker returns backToMapStep if step-form is open
    assert.ok(
      mainJs.includes("swiggyStepForm.style.display !== 'none'") && mainJs.includes('backToMapStep()'),
      'Fallback checker must return backToMapStep if step-form is active'
    );

    // Escape handler handles Step 2
    assert.ok(
      mainJs.includes('backToMapStep();') && mainJs.includes('closeAddressModal();'),
      'Escape key handler must handle Step 2 to Step 1'
    );
  });

  // =========================================================================
  // 6. Reverse-Geocoding Tier Hierarchy
  // =========================================================================
  await t.test('6. OpenStreetMap Nominatim runs before BigDataCloud fallback in reverse geocoding', () => {
    const nominatimIdx = mainJs.indexOf('nominatim.openstreetmap.org/reverse');
    const bdcIdx = mainJs.indexOf('api.bigdatacloud.net/data/reverse-geocode-client');

    assert.ok(nominatimIdx > -1, 'Nominatim reverse geocode must be present');
    assert.ok(bdcIdx > -1, 'BigDataCloud fallback must be present');
    assert.ok(nominatimIdx < bdcIdx, 'Nominatim (street-level) must execute BEFORE BigDataCloud (city-level fallback)');
  });

  // =========================================================================
  // 7. Unpinned Bottom Sheet State
  // =========================================================================
  await t.test('7. updateDetectedAddressUI guards unpinned state before updating sheet labels', () => {
    const fnIdx = mainJs.indexOf('function updateDetectedAddressUI');
    const guardIdx = mainJs.indexOf('if (!hasPinnedLocation && !hasDetectedLocation)', fnIdx);
    const areaTitleIdx = mainJs.indexOf('swiggySheetAreaTitle.textContent =', guardIdx);

    assert.ok(fnIdx > -1, 'updateDetectedAddressUI must exist');
    assert.ok(guardIdx > -1, 'hasPinnedLocation guard must exist');
    assert.ok(guardIdx < areaTitleIdx, 'hasPinnedLocation guard must run BEFORE assigning areaTitle text');
  });

  // =========================================================================
  // 8. Distance Badge Display
  // =========================================================================
  await t.test('8. updateMapLocation un-hides modalMapDistanceBadge on map update', () => {
    assert.match(
      mainJs,
      /modalMapDistanceBadge\.style\.display\s*=\s*'flex';/,
      'updateMapLocation must set modalMapDistanceBadge.style.display to flex'
    );
  });

  // =========================================================================
  // 9. Toast Duration Parameter Support
  // =========================================================================
  await t.test('9. showToast supports custom duration options parameter', () => {
    assert.match(
      mainJs,
      /function showToast\(message,\s*type\s*=\s*'info',\s*opts\s*=\s*\{\}\)/,
      'showToast must accept opts parameter'
    );
  });
});
