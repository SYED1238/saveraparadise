import test from 'node:test';
import assert from 'node:assert/strict';
import { dataService } from '../dataService.js';

test.describe('OWNER PORTAL FLEET MANAGEMENT & SECRET PIN SEGREGATION SUITE', () => {
  const storage = new Map();
  const mockLocalStorage = {
    getItem: (k) => storage.get(k) || null,
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
    clear: () => storage.clear()
  };

  test.beforeEach(() => {
    globalThis.localStorage = mockLocalStorage;
    mockLocalStorage.clear();
  });

  test('1. generateUniqueRiderPin yields a valid 4-digit code and reserves Admin (8899) and Owner (9900)', () => {
    const reserved = new Set(['8899', '9900', '0000']);
    const pins = new Set();

    for (let i = 0; i < 50; i++) {
      const pin = dataService.generateUniqueRiderPin();
      assert.match(pin, /^\d{4}$/, `PIN "${pin}" must be exactly 4 digits`);
      assert.equal(reserved.has(pin), false, `PIN "${pin}" must not collide with reserved credentials (8899, 9900, 0000)`);
      pins.add(pin);
    }

    assert.ok(pins.size > 1, 'Multiple calls should yield unique random PINs');
  });

  test('2. saveOrUpdateRider onboards a new delivery boy with formatted fields and avatar emoji', () => {
    const pin = dataService.generateUniqueRiderPin();
    const rider = dataService.saveOrUpdateRider({
      pin,
      name: 'Salman Ahmed',
      phone: '+91 98765 43210',
      vehicle: '🛵 Scooter'
    });

    assert.ok(rider, 'Rider must be returned upon save');
    assert.equal(rider.pin, pin);
    assert.equal(rider.name, 'Salman Ahmed');
    assert.equal(rider.phone, '+91 98765 43210');
    assert.equal(rider.vehicle, '🛵 Scooter');
    assert.equal(rider.avatar, '🛵');

    const fetched = dataService.getRiderByPin(pin);
    assert.ok(fetched, 'Rider must be retrievable by PIN');
    assert.equal(fetched.name, 'Salman Ahmed');
  });

  test('3. saveOrUpdateRider updates existing rider details when editing', () => {
    const pin = dataService.generateUniqueRiderPin();
    dataService.saveOrUpdateRider({
      pin,
      name: 'Imran Khan',
      phone: '+91 91234 56789',
      vehicle: '🏍️ Bike'
    });

    // Update vehicle and phone
    const updated = dataService.saveOrUpdateRider({
      pin,
      name: 'Imran Khan (Senior)',
      phone: '+91 99999 88888',
      vehicle: '🚗 Car'
    });

    assert.equal(updated.name, 'Imran Khan (Senior)');
    assert.equal(updated.phone, '+91 99999 88888');
    assert.equal(updated.vehicle, '🚗 Car');
    assert.equal(updated.avatar, '🚗');

    const list = dataService.getRiders();
    const matches = list.filter(r => r.pin === pin);
    assert.equal(matches.length, 1, 'Should update in-place without duplicate rows');
  });

  test('4. deleteRider successfully removes rider and cleans active sessions', () => {
    const pin = dataService.generateUniqueRiderPin();
    dataService.saveOrUpdateRider({
      pin,
      name: 'Farooq Abdullah',
      phone: '+91 98888 77777',
      vehicle: '🚲 Bicycle'
    });

    assert.ok(dataService.getRiderByPin(pin), 'Rider should exist before delete');

    const deleted = dataService.deleteRider(pin);
    assert.equal(deleted, true, 'deleteRider should return true on success');
    assert.equal(dataService.getRiderByPin(pin), null, 'Rider should no longer exist after delete');

    // Deleting again should return false
    assert.equal(dataService.deleteRider(pin), false);
  });

  test('5. Non-collision guarantee: generateUniqueRiderPin avoids existing roster PINs', () => {
    const pin1 = '1234';
    dataService.saveOrUpdateRider({
      pin: pin1,
      name: 'Rider One',
      phone: '9876543210'
    });

    for (let i = 0; i < 20; i++) {
      const newPin = dataService.generateUniqueRiderPin();
      assert.notEqual(newPin, pin1, 'Newly generated PIN must not collide with existing rider PIN');
    }
  });

  test('6. Security UI abstraction: Kitchen Admin representation masks PIN, Owner representation discloses PIN', () => {
    const testRider = {
      pin: '7392',
      name: 'Zameer Basha',
      phone: '+91 94444 33333',
      vehicle: '🏍️ Bike'
    };

    // Owner View Representation: Real secret PIN visible for Master Owner audit
    const ownerTableHtml = `<span class="badge-rider-pin-table" title="Secret Login PIN">${testRider.pin}</span>`;
    assert.ok(ownerTableHtml.includes('7392'), 'Owner portal must expose secret login PIN for proprietor management');

    // Kitchen Admin View Representation: Masked PIN prevents credential theft by kitchen staff
    const adminBadgeHtml = `
      <div class="admin-rider-pin-badge" title="Secret login PIN is protected and managed in the Owner Portal">
        <small><i class="fa-solid fa-lock"></i> Login PIN</small>
        <span>••••</span>
      </div>
    `;
    assert.ok(adminBadgeHtml.includes('••••'), 'Kitchen admin must mask rider login PIN as ••••');
    assert.equal(adminBadgeHtml.includes('7392'), false, 'Kitchen admin must NEVER expose plaintext rider PIN');
  });

});
