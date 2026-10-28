/**
 * Comprehensive unit tests for pure utility functions and constants
 * exported from dataService.js.
 *
 * Since dataService.js imports browser-only modules (supabaseClient.js,
 * securityUtils.js), we cannot import it directly in Node.js. Instead we
 * copy-reference the pure constants and standalone functions here so that
 * the LOGIC is tested exhaustively without needing a browser runtime.
 *
 * Source: c:\Users\DELL\Projects\resturent2\dataService.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS — copied verbatim from dataService.js lines 21-30
// ═══════════════════════════════════════════════════════════════

const ORDER_STATUS_RANKS = {
  'pending': 0,
  'accepted': 1,
  'cooking': 2,
  'ready_for_pickup': 3,
  'on_the_way': 4,
  'delivered': 5,
  'undelivered': 5,
  'cancelled': -1
};

const RESTAURANT_COORDINATES = Object.freeze({
  lat: 12.72088913328626,
  lng: 77.28051033981335,
  dms: '12°43\'15.2"N 77°16\'49.8"E',
  name: 'Savera Paradise',
  address: 'Railway Station Road, Ramanagara',
  mapsUrl: 'https://www.google.com/maps/place/Savera+Paradise/@12.7208891,77.2805103,17z'
});

const DEFAULT_SETTINGS = {
  storeOpen: true,
  storeClosedReason: 'The kitchen is currently closed for orders.',
  openTime: '11:00 AM',
  closeTime: '11:00 PM',
  statusNotice: 'Open Now: 11:00 AM – 11:00 PM • Delivery & Pickup',
  isRushPaused: false,
  pauseUntil: null,
  pauseMinutes: 20,
  pauseReason: 'High kitchen rush — orders temporarily paused',
  restaurantName: 'Savera Paradise',
  restaurantAddress: 'Railway Station Road, Ramanagara',
  restaurantMapsUrl: 'https://www.google.com/maps/place/Savera+Paradise/@12.7208891,77.2805103,17z',
  restaurantLat: RESTAURANT_COORDINATES.lat,
  restaurantLng: RESTAURANT_COORDINATES.lng,
  deliveryRadiusKm: 7,
  restaurantPhone: '+91 98450 12345',
  helpline: '+91 98450 12345',
  deliveryFeeStandard: 40,
  minOrderValue: 0,
  freeDeliveryEnabled: true,
  freeDeliveryThreshold: 250,
  maxActiveOrdersPerCustomer: 2,
  offerActive: true,
  offerCode: 'SAVERA20',
  offerDiscountType: 'percent',
  offerDiscountPercent: 20,
  offerDiscountAmount: 50,
  offerMinOrder: 250,
  offerTitle: 'Craving Savera? Get 20% OFF Today!',
  offerSubtext: 'Use coupon code at checkout for 20% off plus 100% Free Shipping.',
  offerFreeDelivery: true
};

// ═══════════════════════════════════════════════════════════════
// PURE FUNCTIONS — copied verbatim from dataService.js
// ═══════════════════════════════════════════════════════════════

// Source: dataService.js lines 2093-2102
function sanitizeDishImageUrl(url) {
  if (!url || typeof url !== 'string') return '';
  if (url.includes('r2.cloudflarestorage.com') && url.includes('dishes/')) {
    const match = url.match(/dishes\/([^?&#]+)/);
    if (match && match[1]) {
      return `/api/r2-image?key=dishes/${decodeURIComponent(match[1])}`;
    }
  }
  return url;
}

// Source: dataService.js lines 2108-2132
function sanitizeCategoryImageUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';

  // 1. Direct R2 presigned URLs
  if (trimmed.includes('r2.cloudflarestorage.com')) {
    const match = trimmed.match(/(categories|dishes)\/([^?&#]+)/);
    if (match && match[1] && match[2]) {
      return `/api/r2-image?key=${encodeURIComponent(`${match[1]}/${decodeURIComponent(match[2])}`)}`;
    }
  }

  // 2. Relative keys
  if (trimmed.startsWith('categories/') || trimmed.startsWith('dishes/')) {
    return `/api/r2-image?key=${encodeURIComponent(trimmed)}`;
  }

  // 3. User uploaded category image root filename
  if (trimmed.startsWith('category_') || trimmed.startsWith('Gemini_Generated_Image_')) {
    return `/api/r2-image?key=${encodeURIComponent(`categories/${trimmed}`)}`;
  }

  return trimmed;
}

// Source: dataService.js lines 2138-2193
function extractPhoneFromOrder(o, rawAddrs = []) {
  if (!o) return '';
  const candidates = [
    o.customerPhone,
    o.customer_phone,
    o.phone,
    o.userPhone,
    o.addressDetails?.phone,
    o.addressDetails?.customerPhone
  ];
  for (const c of candidates) {
    if (c && typeof c === 'string' && c.replace(/\D/g, '').length >= 10) {
      return c.trim();
    }
    if (typeof c === 'number' && String(c).length >= 10) {
      return String(c);
    }
  }

  const addrStr = o.deliveryAddress || '';
  const phoneMatch = addrStr.match(/\[Phone:\s*([+0-9\s-]+)\]/i) ||
                     addrStr.match(/📞\s*([+0-9\s-]+)/) ||
                     addrStr.match(/(?:Phone|Mobile|Contact):\s*([+0-9\s-]+)/i) ||
                     addrStr.match(/(?:\+?91[\s-]?)?[6-9]\d{9}/);
  if (phoneMatch) {
    const rawMatch = phoneMatch[1] || phoneMatch[0];
    const cleanDigits = rawMatch.replace(/\D/g, '');
    if (cleanDigits.length >= 10) {
      return rawMatch.trim();
    }
  }

  const nameStr = o.customerName || o.customer_name || '';
  const namePhoneMatch = nameStr.match(/(?:\+?91[\s-]?)?[6-9]\d{9}/);
  if (namePhoneMatch) {
    return namePhoneMatch[0].trim();
  }

  if (Array.isArray(rawAddrs) && rawAddrs.length > 0) {
    const matched = rawAddrs.find(a =>
      (a.phone && o.userId && a.userId === o.userId) ||
      (a.phone && a.userEmail && o.customerEmail && a.userEmail.toLowerCase() === o.customerEmail.toLowerCase()) ||
      (a.phone && a.name && (o.customerName || o.customer_name) && a.name.trim().toLowerCase() === (o.customerName || o.customer_name).trim().toLowerCase()) ||
      (a.phone && a.flatNo && addrStr && addrStr.includes(a.flatNo)) ||
      (a.phone && a.area && addrStr && addrStr.includes(a.area))
    );
    if (matched && matched.phone && String(matched.phone).replace(/\D/g, '').length >= 10) {
      return String(matched.phone).trim();
    }
  }

  return '';
}

// Source: dataService.js lines 2199-2206
function cleanDeliveryAddress(addr) {
  if (!addr || typeof addr !== 'string') return 'Doorstep Delivery';
  return addr
    .replace(/\[Phone:\s*[^\]]+\]/gi, '')
    .replace(/📞\s*[+0-9\s-]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Cart pricing math derived from DEFAULT_SETTINGS values
// ═══════════════════════════════════════════════════════════════

function computeSubtotal(cartItems) {
  return cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
}

function computeDeliveryFee(subtotal, settings = DEFAULT_SETTINGS) {
  if (settings.freeDeliveryEnabled && subtotal >= settings.freeDeliveryThreshold) {
    return 0;
  }
  return settings.deliveryFeeStandard;
}

function computePromoDiscount(subtotal, promoCode, settings = DEFAULT_SETTINGS) {
  if (!settings.offerActive) return 0;
  if (promoCode !== settings.offerCode) return 0;
  if (subtotal < settings.offerMinOrder) return 0;

  let discount = 0;
  if (settings.offerDiscountType === 'percent') {
    discount = Math.round(subtotal * settings.offerDiscountPercent / 100);
  } else {
    discount = settings.offerDiscountAmount;
  }
  // Discount cannot exceed subtotal
  return Math.min(discount, subtotal);
}

function computeTotal(subtotal, discount, deliveryFee) {
  return subtotal - discount + deliveryFee;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Order status state machine validator
// ═══════════════════════════════════════════════════════════════

function isValidTransition(fromStatus, toStatus) {
  const fromRank = ORDER_STATUS_RANKS[fromStatus];
  const toRank = ORDER_STATUS_RANKS[toStatus];
  if (fromRank === undefined || toRank === undefined) return false;
  // cancelled is a terminal sink (-1) — you can cancel from any state
  if (toStatus === 'cancelled') return true;
  // Cannot transition from cancelled
  if (fromStatus === 'cancelled') return false;
  // Forward only (must increase)
  return toRank > fromRank;
}


// ═══════════════════════════════════════════════════════════════
// TEST SUITES
// ═══════════════════════════════════════════════════════════════

// ────────────────────────────────────────────────────────────
// 1. ORDER_STATUS_RANKS
// ────────────────────────────────────────────────────────────
test('ORDER_STATUS_RANKS', async (t) => {
  await t.test('maps pending to 0', () => {
    assert.equal(ORDER_STATUS_RANKS['pending'], 0);
  });

  await t.test('maps accepted to 1', () => {
    assert.equal(ORDER_STATUS_RANKS['accepted'], 1);
  });

  await t.test('maps cooking to 2', () => {
    assert.equal(ORDER_STATUS_RANKS['cooking'], 2);
  });

  await t.test('maps ready_for_pickup to 3', () => {
    assert.equal(ORDER_STATUS_RANKS['ready_for_pickup'], 3);
  });

  await t.test('maps on_the_way to 4', () => {
    assert.equal(ORDER_STATUS_RANKS['on_the_way'], 4);
  });

  await t.test('maps delivered to 5', () => {
    assert.equal(ORDER_STATUS_RANKS['delivered'], 5);
  });

  await t.test('maps undelivered to 5 (same rank as delivered)', () => {
    assert.equal(ORDER_STATUS_RANKS['undelivered'], 5);
  });

  await t.test('maps cancelled to -1', () => {
    assert.equal(ORDER_STATUS_RANKS['cancelled'], -1);
  });

  await t.test('unknown statuses return undefined', () => {
    assert.equal(ORDER_STATUS_RANKS['shipped'], undefined);
    assert.equal(ORDER_STATUS_RANKS[''], undefined);
    assert.equal(ORDER_STATUS_RANKS['PENDING'], undefined);
  });

  await t.test('forward transitions have strictly increasing rank', () => {
    const pipeline = ['pending', 'accepted', 'cooking', 'ready_for_pickup', 'on_the_way', 'delivered'];
    for (let i = 1; i < pipeline.length; i++) {
      assert.ok(
        ORDER_STATUS_RANKS[pipeline[i]] > ORDER_STATUS_RANKS[pipeline[i - 1]],
        `${pipeline[i]} (${ORDER_STATUS_RANKS[pipeline[i]]}) should be > ${pipeline[i - 1]} (${ORDER_STATUS_RANKS[pipeline[i - 1]]})`
      );
    }
  });

  await t.test('backward transitions have decreasing rank', () => {
    assert.ok(ORDER_STATUS_RANKS['cooking'] < ORDER_STATUS_RANKS['delivered']);
    assert.ok(ORDER_STATUS_RANKS['pending'] < ORDER_STATUS_RANKS['on_the_way']);
  });

  await t.test('has exactly 8 status entries', () => {
    assert.equal(Object.keys(ORDER_STATUS_RANKS).length, 8);
  });
});

// ────────────────────────────────────────────────────────────
// 2. DEFAULT_SETTINGS
// ────────────────────────────────────────────────────────────
test('DEFAULT_SETTINGS', async (t) => {
  await t.test('delivery fee standard is ₹40', () => {
    assert.equal(DEFAULT_SETTINGS.deliveryFeeStandard, 40);
  });

  await t.test('free delivery is enabled', () => {
    assert.equal(DEFAULT_SETTINGS.freeDeliveryEnabled, true);
  });

  await t.test('free delivery threshold is ₹250', () => {
    assert.equal(DEFAULT_SETTINGS.freeDeliveryThreshold, 250);
  });

  await t.test('max active orders per customer is 2', () => {
    assert.equal(DEFAULT_SETTINGS.maxActiveOrdersPerCustomer, 2);
  });

  await t.test('offer is active', () => {
    assert.equal(DEFAULT_SETTINGS.offerActive, true);
  });

  await t.test('promo code is SAVERA20', () => {
    assert.equal(DEFAULT_SETTINGS.offerCode, 'SAVERA20');
  });

  await t.test('discount type is percent', () => {
    assert.equal(DEFAULT_SETTINGS.offerDiscountType, 'percent');
  });

  await t.test('discount percent is 20', () => {
    assert.equal(DEFAULT_SETTINGS.offerDiscountPercent, 20);
  });

  await t.test('offer minimum order is ₹250', () => {
    assert.equal(DEFAULT_SETTINGS.offerMinOrder, 250);
  });

  await t.test('offer includes free delivery', () => {
    assert.equal(DEFAULT_SETTINGS.offerFreeDelivery, true);
  });

  await t.test('minimum order value is 0 (no minimum)', () => {
    assert.equal(DEFAULT_SETTINGS.minOrderValue, 0);
  });

  await t.test('store defaults to open', () => {
    assert.equal(DEFAULT_SETTINGS.storeOpen, true);
  });

  await t.test('restaurant coordinates match RESTAURANT_COORDINATES', () => {
    assert.equal(DEFAULT_SETTINGS.restaurantLat, RESTAURANT_COORDINATES.lat);
    assert.equal(DEFAULT_SETTINGS.restaurantLng, RESTAURANT_COORDINATES.lng);
  });

  await t.test('delivery radius is 7km', () => {
    assert.equal(DEFAULT_SETTINGS.deliveryRadiusKm, 7);
  });

  await t.test('flat discount amount is ₹50', () => {
    assert.equal(DEFAULT_SETTINGS.offerDiscountAmount, 50);
  });
});

// ────────────────────────────────────────────────────────────
// 3. RESTAURANT_COORDINATES immutability
// ────────────────────────────────────────────────────────────
test('RESTAURANT_COORDINATES', async (t) => {
  await t.test('lat is correct', () => {
    assert.equal(RESTAURANT_COORDINATES.lat, 12.72088913328626);
  });

  await t.test('lng is correct', () => {
    assert.equal(RESTAURANT_COORDINATES.lng, 77.28051033981335);
  });

  await t.test('is frozen — cannot add new properties', () => {
    assert.ok(Object.isFrozen(RESTAURANT_COORDINATES));
    assert.throws(() => {
      'use strict';
      RESTAURANT_COORDINATES.altitude = 100;
    }, TypeError);
  });

  await t.test('is frozen — cannot modify existing properties', () => {
    assert.throws(() => {
      'use strict';
      RESTAURANT_COORDINATES.lat = 0;
    }, TypeError);
  });

  await t.test('contains DMS, name, address, and mapsUrl', () => {
    assert.ok(RESTAURANT_COORDINATES.dms.includes('12°43'));
    assert.equal(RESTAURANT_COORDINATES.name, 'Savera Paradise');
    assert.ok(RESTAURANT_COORDINATES.address.includes('Ramanagara'));
    assert.ok(RESTAURANT_COORDINATES.mapsUrl.startsWith('https://'));
  });
});

// ────────────────────────────────────────────────────────────
// 4. sanitizeDishImageUrl
// ────────────────────────────────────────────────────────────
test('sanitizeDishImageUrl', async (t) => {
  await t.test('converts R2 presigned URL with dishes/ to proxy URL', () => {
    const r2Url = 'https://abc.r2.cloudflarestorage.com/bucket/dishes/photo123.png?X-Amz-Signature=abc';
    const result = sanitizeDishImageUrl(r2Url);
    assert.equal(result, '/api/r2-image?key=dishes/photo123.png');
  });

  await t.test('handles encoded filenames in R2 URLs', () => {
    const r2Url = 'https://abc.r2.cloudflarestorage.com/bucket/dishes/my%20photo.png?X-Amz-Signature=abc';
    const result = sanitizeDishImageUrl(r2Url);
    assert.equal(result, '/api/r2-image?key=dishes/my photo.png');
  });

  await t.test('passes through non-R2 URLs unchanged', () => {
    const url = 'https://images.unsplash.com/photo-123?w=500';
    assert.equal(sanitizeDishImageUrl(url), url);
  });

  await t.test('passes through relative URLs unchanged', () => {
    const url = '/biryani-plate-1.png';
    assert.equal(sanitizeDishImageUrl(url), url);
  });

  await t.test('passes through already-proxied URLs unchanged', () => {
    const url = '/api/r2-image?key=dishes/photo.png';
    assert.equal(sanitizeDishImageUrl(url), url);
  });

  await t.test('returns empty string for null', () => {
    assert.equal(sanitizeDishImageUrl(null), '');
  });

  await t.test('returns empty string for undefined', () => {
    assert.equal(sanitizeDishImageUrl(undefined), '');
  });

  await t.test('returns empty string for empty string', () => {
    assert.equal(sanitizeDishImageUrl(''), '');
  });

  await t.test('returns empty string for non-string input', () => {
    assert.equal(sanitizeDishImageUrl(42), '');
    assert.equal(sanitizeDishImageUrl({}), '');
    assert.equal(sanitizeDishImageUrl(true), '');
  });

  await t.test('R2 URL without dishes/ path is passed through', () => {
    const url = 'https://abc.r2.cloudflarestorage.com/bucket/categories/cat.png?sig=xyz';
    assert.equal(sanitizeDishImageUrl(url), url);
  });

  await t.test('URL with "dishes/" in query but not R2 domain is passed through', () => {
    const url = 'https://example.com/image?path=dishes/test.png';
    assert.equal(sanitizeDishImageUrl(url), url);
  });
});

// ────────────────────────────────────────────────────────────
// 5. sanitizeCategoryImageUrl
// ────────────────────────────────────────────────────────────
test('sanitizeCategoryImageUrl', async (t) => {
  await t.test('Pattern 1: R2 presigned URL with categories/ path', () => {
    const r2Url = 'https://abc.r2.cloudflarestorage.com/bucket/categories/cat_img.png?X-Amz-Signature=abc';
    const result = sanitizeCategoryImageUrl(r2Url);
    assert.equal(result, `/api/r2-image?key=${encodeURIComponent('categories/cat_img.png')}`);
  });

  await t.test('Pattern 1: R2 presigned URL with dishes/ path', () => {
    const r2Url = 'https://abc.r2.cloudflarestorage.com/bucket/dishes/dish.png?sig=xyz';
    const result = sanitizeCategoryImageUrl(r2Url);
    assert.equal(result, `/api/r2-image?key=${encodeURIComponent('dishes/dish.png')}`);
  });

  await t.test('Pattern 2: relative key starting with categories/', () => {
    const key = 'categories/my_image.png';
    const result = sanitizeCategoryImageUrl(key);
    assert.equal(result, `/api/r2-image?key=${encodeURIComponent(key)}`);
  });

  await t.test('Pattern 2: relative key starting with dishes/', () => {
    const key = 'dishes/biryani.jpg';
    const result = sanitizeCategoryImageUrl(key);
    assert.equal(result, `/api/r2-image?key=${encodeURIComponent(key)}`);
  });

  await t.test('Pattern 3: filename starting with category_', () => {
    const filename = 'category_1792937665372_photo.png';
    const result = sanitizeCategoryImageUrl(filename);
    assert.equal(result, `/api/r2-image?key=${encodeURIComponent('categories/' + filename)}`);
  });

  await t.test('Pattern 3: filename starting with Gemini_Generated_Image_', () => {
    const filename = 'Gemini_Generated_Image_bm077mbm077mbm07-removebg-preview.png';
    const result = sanitizeCategoryImageUrl(filename);
    assert.equal(result, `/api/r2-image?key=${encodeURIComponent('categories/' + filename)}`);
  });

  await t.test('Pattern 4: other URLs passed through as-is', () => {
    const url = 'https://images.unsplash.com/photo-123';
    assert.equal(sanitizeCategoryImageUrl(url), url);
  });

  await t.test('Pattern 4: already-proxied URLs passed through', () => {
    const url = '/api/r2-image?key=categories%2Fphoto.png';
    assert.equal(sanitizeCategoryImageUrl(url), url);
  });

  await t.test('returns empty string for null', () => {
    assert.equal(sanitizeCategoryImageUrl(null), '');
  });

  await t.test('returns empty string for undefined', () => {
    assert.equal(sanitizeCategoryImageUrl(undefined), '');
  });

  await t.test('returns empty string for empty string', () => {
    assert.equal(sanitizeCategoryImageUrl(''), '');
  });

  await t.test('returns empty string for whitespace-only string', () => {
    assert.equal(sanitizeCategoryImageUrl('   '), '');
    assert.equal(sanitizeCategoryImageUrl('\t\n'), '');
  });

  await t.test('returns empty string for non-string input', () => {
    assert.equal(sanitizeCategoryImageUrl(123), '');
    assert.equal(sanitizeCategoryImageUrl(false), '');
  });

  await t.test('trims leading/trailing whitespace before matching', () => {
    const key = '  categories/test.png  ';
    const result = sanitizeCategoryImageUrl(key);
    assert.equal(result, `/api/r2-image?key=${encodeURIComponent('categories/test.png')}`);
  });
});

// ────────────────────────────────────────────────────────────
// 6. extractPhoneFromOrder
// ────────────────────────────────────────────────────────────
test('extractPhoneFromOrder', async (t) => {
  // Direct field tests
  await t.test('extracts from o.customerPhone', () => {
    const order = { customerPhone: '9845123456' };
    assert.equal(extractPhoneFromOrder(order), '9845123456');
  });

  await t.test('extracts from o.customer_phone', () => {
    const order = { customer_phone: '+91 9845123456' };
    assert.equal(extractPhoneFromOrder(order), '+91 9845123456');
  });

  await t.test('extracts from o.phone', () => {
    const order = { phone: '9876543210' };
    assert.equal(extractPhoneFromOrder(order), '9876543210');
  });

  await t.test('extracts from o.userPhone', () => {
    const order = { userPhone: '+919845123456' };
    assert.equal(extractPhoneFromOrder(order), '+919845123456');
  });

  await t.test('extracts from o.addressDetails.phone', () => {
    const order = { addressDetails: { phone: '6789012345' } };
    assert.equal(extractPhoneFromOrder(order), '6789012345');
  });

  await t.test('extracts from o.addressDetails.customerPhone', () => {
    const order = { addressDetails: { customerPhone: '7890123456' } };
    assert.equal(extractPhoneFromOrder(order), '7890123456');
  });

  await t.test('handles numeric phone as number type', () => {
    const order = { customerPhone: 9845123456 };
    assert.equal(extractPhoneFromOrder(order), '9845123456');
  });

  await t.test('prioritizes customerPhone over later fields', () => {
    const order = {
      customerPhone: '1111111111',
      customer_phone: '2222222222',
      phone: '3333333333'
    };
    assert.equal(extractPhoneFromOrder(order), '1111111111');
  });

  await t.test('skips fields with fewer than 10 digits', () => {
    const order = { customerPhone: '12345', phone: '9845123456' };
    assert.equal(extractPhoneFromOrder(order), '9845123456');
  });

  // Embedded in deliveryAddress
  await t.test('extracts from [Phone: ...] tag in address', () => {
    const order = { deliveryAddress: 'Flat 101, Some Building [Phone: 9845123456]' };
    assert.equal(extractPhoneFromOrder(order), '9845123456');
  });

  await t.test('extracts from [Phone: ...] tag with +91 prefix', () => {
    const order = { deliveryAddress: '1st Floor [Phone: +91 98451-23456]' };
    assert.equal(extractPhoneFromOrder(order), '+91 98451-23456');
  });

  await t.test('extracts from 📞 emoji pattern in address', () => {
    const order = { deliveryAddress: 'Doorstep 📞 9845123456' };
    assert.equal(extractPhoneFromOrder(order), '9845123456');
  });

  await t.test('extracts from "Phone:" prefix in address (no brackets)', () => {
    const order = { deliveryAddress: 'Main Road, Phone: 9988776655' };
    assert.equal(extractPhoneFromOrder(order), '9988776655');
  });

  await t.test('extracts from "Mobile:" prefix in address', () => {
    const order = { deliveryAddress: 'Apt 5, Mobile: 8877665544' };
    assert.equal(extractPhoneFromOrder(order), '8877665544');
  });

  await t.test('extracts bare Indian mobile number from address', () => {
    const order = { deliveryAddress: 'Street 9, near park 9845123456 city' };
    assert.equal(extractPhoneFromOrder(order), '9845123456');
  });

  // Embedded in customerName
  await t.test('extracts phone from customerName with pipe separator', () => {
    const order = { customerName: 'Syed Hamza | 9845123456' };
    assert.equal(extractPhoneFromOrder(order), '9845123456');
  });

  await t.test('extracts phone from customer_name', () => {
    const order = { customer_name: 'Ali 8845123456' };
    assert.equal(extractPhoneFromOrder(order), '8845123456');
  });

  // Matched via rawAddrs
  await t.test('matches by userId in rawAddrs', () => {
    const order = { userId: 'user-001' };
    const addrs = [
      { userId: 'user-001', phone: '9845123456' }
    ];
    assert.equal(extractPhoneFromOrder(order, addrs), '9845123456');
  });

  await t.test('matches by email in rawAddrs', () => {
    const order = { customerEmail: 'Test@Example.com' };
    const addrs = [
      { userEmail: 'test@example.com', phone: '9845123456' }
    ];
    assert.equal(extractPhoneFromOrder(order, addrs), '9845123456');
  });

  await t.test('matches by name in rawAddrs (case-insensitive)', () => {
    const order = { customerName: '  Syed Hamza  ' };
    const addrs = [
      { name: 'syed hamza', phone: '7654321098' }
    ];
    assert.equal(extractPhoneFromOrder(order, addrs), '7654321098');
  });

  await t.test('matches by flatNo in rawAddrs', () => {
    const order = { deliveryAddress: 'Flat 101, Building A' };
    const addrs = [
      { flatNo: 'Flat 101', phone: '6543210987' }
    ];
    assert.equal(extractPhoneFromOrder(order, addrs), '6543210987');
  });

  await t.test('matches by area in rawAddrs', () => {
    const order = { deliveryAddress: 'Near Market, Jayanagar 4th Block' };
    const addrs = [
      { area: 'Jayanagar 4th Block', phone: '8765432109' }
    ];
    assert.equal(extractPhoneFromOrder(order, addrs), '8765432109');
  });

  // No phone found
  await t.test('returns empty string when no phone found', () => {
    const order = { customerName: 'Ali', deliveryAddress: 'Main Road' };
    assert.equal(extractPhoneFromOrder(order), '');
  });

  await t.test('returns empty string for null order', () => {
    assert.equal(extractPhoneFromOrder(null), '');
  });

  await t.test('returns empty string for undefined order', () => {
    assert.equal(extractPhoneFromOrder(undefined), '');
  });

  await t.test('returns empty string for empty order object', () => {
    assert.equal(extractPhoneFromOrder({}), '');
  });

  await t.test('returns empty string when rawAddrs has no matching phone', () => {
    const order = { userId: 'user-999' };
    const addrs = [
      { userId: 'user-001', phone: '9845123456' }
    ];
    assert.equal(extractPhoneFromOrder(order, addrs), '');
  });

  await t.test('skips rawAddrs entry without phone even if userId matches', () => {
    const order = { userId: 'user-001' };
    const addrs = [
      { userId: 'user-001' } // no phone
    ];
    assert.equal(extractPhoneFromOrder(order, addrs), '');
  });

  await t.test('trims whitespace from extracted phone', () => {
    const order = { customerPhone: '  9845123456  ' };
    assert.equal(extractPhoneFromOrder(order), '9845123456');
  });
});

// ────────────────────────────────────────────────────────────
// 7. cleanDeliveryAddress
// ────────────────────────────────────────────────────────────
test('cleanDeliveryAddress', async (t) => {
  await t.test('strips [Phone: ...] tag', () => {
    const addr = 'Flat 101, Building A [Phone: 9845123456]';
    assert.equal(cleanDeliveryAddress(addr), 'Flat 101, Building A');
  });

  await t.test('strips [Phone: ...] tag case-insensitively', () => {
    const addr = 'Apt 5 [phone: +91 12345 67890] Main Road';
    assert.equal(cleanDeliveryAddress(addr), 'Apt 5 Main Road');
  });

  await t.test('strips 📞 emoji pattern', () => {
    const addr = 'Doorstep 📞 9845-123-456 near mall';
    assert.equal(cleanDeliveryAddress(addr), 'Doorstep near mall');
  });

  await t.test('strips both [Phone:] and 📞 in same address', () => {
    const addr = 'House 10 [Phone: 111] 📞 222-333-4444 Area';
    const result = cleanDeliveryAddress(addr);
    assert.ok(!result.includes('[Phone:'));
    assert.ok(!result.includes('📞'));
  });

  await t.test('collapses multiple spaces into single space', () => {
    const addr = 'Flat 1   Building A     Main Road';
    assert.equal(cleanDeliveryAddress(addr), 'Flat 1 Building A Main Road');
  });

  await t.test('trims leading/trailing whitespace', () => {
    const addr = '  Flat 1, Building A  ';
    assert.equal(cleanDeliveryAddress(addr), 'Flat 1, Building A');
  });

  await t.test('returns original address when no tags present', () => {
    const addr = 'Flat 101, Building A, Main Road';
    assert.equal(cleanDeliveryAddress(addr), addr);
  });

  await t.test('returns Doorstep Delivery for null', () => {
    assert.equal(cleanDeliveryAddress(null), 'Doorstep Delivery');
  });

  await t.test('returns Doorstep Delivery for undefined', () => {
    assert.equal(cleanDeliveryAddress(undefined), 'Doorstep Delivery');
  });

  await t.test('returns Doorstep Delivery for non-string input', () => {
    assert.equal(cleanDeliveryAddress(42), 'Doorstep Delivery');
    assert.equal(cleanDeliveryAddress({}), 'Doorstep Delivery');
    assert.equal(cleanDeliveryAddress(true), 'Doorstep Delivery');
  });

  await t.test('returns Doorstep Delivery for empty string (falsy)', () => {
    assert.equal(cleanDeliveryAddress(''), 'Doorstep Delivery');
  });

  await t.test('handles address with multiple [Phone:] tags', () => {
    const addr = '[Phone: 111] Room 5 [Phone: 222]';
    assert.equal(cleanDeliveryAddress(addr), 'Room 5');
  });
});

// ────────────────────────────────────────────────────────────
// 8. Cart pricing math (using DEFAULT_SETTINGS values)
// ────────────────────────────────────────────────────────────
test('Cart pricing math', async (t) => {
  await t.test('empty cart subtotal is 0', () => {
    assert.equal(computeSubtotal([]), 0);
  });

  await t.test('single item: price × quantity', () => {
    const cart = [{ price: 140, quantity: 2 }];
    assert.equal(computeSubtotal(cart), 280);
  });

  await t.test('multiple items accumulate correctly', () => {
    const cart = [
      { price: 210, quantity: 1 },
      { price: 130, quantity: 2 },
      { price: 40,  quantity: 3 }
    ];
    // 210 + 260 + 120 = 590
    assert.equal(computeSubtotal(cart), 590);
  });

  await t.test('quantity of 0 contributes nothing', () => {
    const cart = [{ price: 500, quantity: 0 }];
    assert.equal(computeSubtotal(cart), 0);
  });

  // Delivery fee rules
  await t.test('delivery fee is ₹40 when subtotal below threshold (₹250)', () => {
    assert.equal(computeDeliveryFee(200), 40);
  });

  await t.test('delivery fee is ₹40 at ₹249 (one below threshold)', () => {
    assert.equal(computeDeliveryFee(249), 40);
  });

  await t.test('delivery fee is free at ₹250 (exactly at threshold)', () => {
    assert.equal(computeDeliveryFee(250), 0);
  });

  await t.test('delivery fee is free above threshold', () => {
    assert.equal(computeDeliveryFee(500), 0);
  });

  await t.test('delivery fee is ₹40 when subtotal is 0', () => {
    assert.equal(computeDeliveryFee(0), 40);
  });

  await t.test('delivery fee uses standard when free delivery disabled', () => {
    const settings = { ...DEFAULT_SETTINGS, freeDeliveryEnabled: false };
    assert.equal(computeDeliveryFee(500, settings), 40);
  });

  // Promo discount
  await t.test('20% discount on ₹300 order = ₹60', () => {
    assert.equal(computePromoDiscount(300, 'SAVERA20'), 60);
  });

  await t.test('20% discount on ₹1000 order = ₹200', () => {
    assert.equal(computePromoDiscount(1000, 'SAVERA20'), 200);
  });

  await t.test('promo rejected when code is wrong', () => {
    assert.equal(computePromoDiscount(300, 'WRONG_CODE'), 0);
  });

  await t.test('promo rejected when subtotal below minimum (₹250)', () => {
    assert.equal(computePromoDiscount(200, 'SAVERA20'), 0);
  });

  await t.test('promo works at exactly ₹250 minimum', () => {
    assert.equal(computePromoDiscount(250, 'SAVERA20'), 50); // 20% of 250
  });

  await t.test('promo rejected when offer is inactive', () => {
    const settings = { ...DEFAULT_SETTINGS, offerActive: false };
    assert.equal(computePromoDiscount(500, 'SAVERA20', settings), 0);
  });

  await t.test('discount cannot exceed subtotal', () => {
    // Make a settings where flat discount exceeds subtotal
    const settings = {
      ...DEFAULT_SETTINGS,
      offerDiscountType: 'flat',
      offerDiscountAmount: 500,
      offerMinOrder: 0
    };
    assert.equal(computePromoDiscount(100, 'SAVERA20', settings), 100);
  });

  await t.test('flat discount type uses offerDiscountAmount', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      offerDiscountType: 'flat',
      offerDiscountAmount: 50,
      offerMinOrder: 0
    };
    assert.equal(computePromoDiscount(300, 'SAVERA20', settings), 50);
  });

  // Final total formula
  await t.test('final = subtotal - discount + deliveryFee (standard case)', () => {
    const subtotal = 300;
    const discount = computePromoDiscount(subtotal, 'SAVERA20');  // 60
    const fee = computeDeliveryFee(subtotal);                      // 0 (>=250)
    const total = computeTotal(subtotal, discount, fee);
    assert.equal(discount, 60);
    assert.equal(fee, 0);
    assert.equal(total, 240); // 300 - 60 + 0
  });

  await t.test('final = subtotal + deliveryFee when no promo', () => {
    const subtotal = 200;
    const discount = computePromoDiscount(subtotal, '');  // 0
    const fee = computeDeliveryFee(subtotal);             // 40
    const total = computeTotal(subtotal, discount, fee);
    assert.equal(total, 240); // 200 - 0 + 40
  });

  await t.test('edge: exact threshold order with promo', () => {
    const subtotal = 250;
    const discount = computePromoDiscount(subtotal, 'SAVERA20'); // 50
    const fee = computeDeliveryFee(subtotal);                     // 0
    const total = computeTotal(subtotal, discount, fee);
    assert.equal(total, 200); // 250 - 50 + 0
  });

  await t.test('edge: below-threshold order without promo', () => {
    const subtotal = 130;
    const discount = 0;
    const fee = computeDeliveryFee(subtotal);  // 40
    const total = computeTotal(subtotal, discount, fee);
    assert.equal(total, 170); // 130 + 40
  });

  await t.test('total is never negative even with large discount', () => {
    // Since discount is capped at subtotal, minimum total = deliveryFee
    const subtotal = 100;
    const discount = Math.min(subtotal, subtotal); // 100
    const fee = computeDeliveryFee(subtotal);       // 40
    const total = computeTotal(subtotal, discount, fee);
    assert.ok(total >= 0);
    assert.equal(total, 40); // 100 - 100 + 40
  });
});

// ────────────────────────────────────────────────────────────
// 9. Order status state machine
// ────────────────────────────────────────────────────────────
test('Order status state machine', async (t) => {
  // Valid forward transitions
  await t.test('pending → accepted is valid', () => {
    assert.ok(isValidTransition('pending', 'accepted'));
  });

  await t.test('accepted → cooking is valid', () => {
    assert.ok(isValidTransition('accepted', 'cooking'));
  });

  await t.test('cooking → ready_for_pickup is valid', () => {
    assert.ok(isValidTransition('cooking', 'ready_for_pickup'));
  });

  await t.test('ready_for_pickup → on_the_way is valid', () => {
    assert.ok(isValidTransition('ready_for_pickup', 'on_the_way'));
  });

  await t.test('on_the_way → delivered is valid', () => {
    assert.ok(isValidTransition('on_the_way', 'delivered'));
  });

  await t.test('on_the_way → undelivered is valid', () => {
    assert.ok(isValidTransition('on_the_way', 'undelivered'));
  });

  await t.test('pending → cooking (skip) is valid forward', () => {
    assert.ok(isValidTransition('pending', 'cooking'));
  });

  await t.test('pending → delivered (skip many) is valid forward', () => {
    assert.ok(isValidTransition('pending', 'delivered'));
  });

  // Invalid backward transitions
  await t.test('delivered → cooking is REJECTED (backward)', () => {
    assert.equal(isValidTransition('delivered', 'cooking'), false);
  });

  await t.test('on_the_way → pending is REJECTED (backward)', () => {
    assert.equal(isValidTransition('on_the_way', 'pending'), false);
  });

  await t.test('cooking → accepted is REJECTED (backward)', () => {
    assert.equal(isValidTransition('cooking', 'accepted'), false);
  });

  await t.test('delivered → pending is REJECTED (backward)', () => {
    assert.equal(isValidTransition('delivered', 'pending'), false);
  });

  await t.test('same status transition is REJECTED (no progress)', () => {
    assert.equal(isValidTransition('cooking', 'cooking'), false);
  });

  await t.test('delivered → delivered is REJECTED (already final)', () => {
    assert.equal(isValidTransition('delivered', 'delivered'), false);
  });

  // Cancellation
  await t.test('any status → cancelled is valid', () => {
    for (const status of ['pending', 'accepted', 'cooking', 'ready_for_pickup', 'on_the_way']) {
      assert.ok(isValidTransition(status, 'cancelled'), `${status} → cancelled should be valid`);
    }
  });

  await t.test('cancelled → any active status is REJECTED', () => {
    for (const status of ['pending', 'accepted', 'cooking', 'ready_for_pickup', 'on_the_way', 'delivered']) {
      assert.equal(isValidTransition('cancelled', status), false, `cancelled → ${status} should be rejected`);
    }
  });

  // Unknown statuses
  await t.test('unknown fromStatus is REJECTED', () => {
    assert.equal(isValidTransition('shipped', 'delivered'), false);
  });

  await t.test('unknown toStatus is REJECTED', () => {
    assert.equal(isValidTransition('pending', 'shipped'), false);
  });

  await t.test('both unknown is REJECTED', () => {
    assert.equal(isValidTransition('foo', 'bar'), false);
  });

  // Full happy-path pipeline
  await t.test('full pipeline: pending → accepted → cooking → ready_for_pickup → on_the_way → delivered', () => {
    const pipeline = ['pending', 'accepted', 'cooking', 'ready_for_pickup', 'on_the_way', 'delivered'];
    for (let i = 0; i < pipeline.length - 1; i++) {
      assert.ok(
        isValidTransition(pipeline[i], pipeline[i + 1]),
        `${pipeline[i]} → ${pipeline[i + 1]} should be valid`
      );
    }
  });
});
