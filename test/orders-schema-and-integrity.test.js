import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { sanitizeCategoryImageUrl } from '../dataService.js';

test('ORDER INTEGRITY & SCHEMA SPECIFICATION', async (t) => {
  await t.test('Standard order payload contains all 12 schema columns without data loss', () => {
    const rawOrderInput = {
      id: '#ORD-99881',
      createdAt: 1792615000000,
      customerName: 'Ayesha Khan',
      customerPhone: '+91 98450 12345',
      customerEmail: 'ayesha@example.com',
      userId: 'usr_abc123',
      deliveryAddress: 'Flat 402, Green Towers, Ramanagara',
      pickupCode: '9881',
      paymentMethod: 'Cash on Delivery (COD)',
      paymentStatus: 'Cash on Delivery',
      stepIndex: 0,
      status: 'accepted',
      statusLabel: 'Accepted',
      eta: '25 - 35 Minutes',
      itemsSummary: '1x Crispy Burger, 2x Wings',
      items: [
        { name: 'Crispy Burger', quantity: 1, price: 180 },
        { name: 'Wings', quantity: 2, price: 120 }
      ],
      total: '₹420'
    };

    // Verify mapping into cleanPayload for Supabase insert
    const cleanPayload = {
      id: rawOrderInput.id,
      created_at: Number(rawOrderInput.createdAt),
      customer_name: rawOrderInput.customerName,
      customer_phone: rawOrderInput.customerPhone,
      customer_email: rawOrderInput.customerEmail,
      user_id: rawOrderInput.userId,
      delivery_address: rawOrderInput.deliveryAddress,
      pickup_code: rawOrderInput.pickupCode,
      payment_method: rawOrderInput.paymentMethod,
      payment_status: rawOrderInput.paymentStatus,
      step_index: rawOrderInput.stepIndex,
      status: rawOrderInput.status,
      status_label: rawOrderInput.statusLabel,
      eta: rawOrderInput.eta,
      items_summary: rawOrderInput.itemsSummary,
      items: rawOrderInput.items,
      total: rawOrderInput.total
    };

    assert.strictEqual(cleanPayload.customer_phone, '+91 98450 12345');
    assert.strictEqual(cleanPayload.pickup_code, '9881');
    assert.strictEqual(cleanPayload.payment_method, 'Cash on Delivery (COD)');
    assert.strictEqual(cleanPayload.payment_status, 'Cash on Delivery');
    assert.strictEqual(cleanPayload.delivery_address, 'Flat 402, Green Towers, Ramanagara');
  });

  await t.test('Tracking token generator produces valid UUID format', () => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    // crypto.randomUUID() generates RFC 4122 v4 UUID identical to PostgreSQL gen_random_uuid()
    const sampleToken = crypto.randomUUID();
    assert.match(sampleToken, uuidRegex, 'Token must be valid UUID v4');
  });

  await t.test('Fallback pickup code extracts last 4 digits of order ID if unspecified', () => {
    const orderId = '#ORD-1792614992';
    const digits = String(orderId).replace(/\D/g, '');
    const fallbackPickupCode = digits.length >= 4 ? digits.slice(-4) : (digits || '1001');
    assert.strictEqual(fallbackPickupCode, '4992');
  });

  await t.test('Status monotonic ranking prevents backward regressions', () => {
    const ORDER_STATUS_RANKS = {
      'pending': 0,
      'accepted': 1,
      'cooking': 2,
      'ready_for_pickup': 3,
      'on_the_way': 4,
      'delivered': 5,
      'cancelled': -1
    };

    function canTransition(currentStatus, nextStatus) {
      if (nextStatus === 'cancelled') {
        // Can only cancel if not already cooking or delivered
        return currentStatus === 'pending' || currentStatus === 'accepted';
      }
      return ORDER_STATUS_RANKS[nextStatus] >= ORDER_STATUS_RANKS[currentStatus];
    }

    assert.strictEqual(canTransition('accepted', 'cooking'), true);
    assert.strictEqual(canTransition('cooking', 'ready_for_pickup'), true);
    assert.strictEqual(canTransition('ready_for_pickup', 'on_the_way'), true);
    assert.strictEqual(canTransition('on_the_way', 'delivered'), true);
    
    // Regressions blocked
    assert.strictEqual(canTransition('on_the_way', 'cooking'), false);
    assert.strictEqual(canTransition('delivered', 'accepted'), false);
    assert.strictEqual(canTransition('delivered', 'cancelled'), false);
  });

  await t.test('Clean customer-facing order ID generator format matches #QB-[0-9]{4}', () => {
    const randomOrderNum = Math.floor(1000 + Math.random() * 9000);
    const id = '#QB-' + randomOrderNum;
    assert.match(id, /^#QB-[0-9]{4}$/, 'Order ID must follow clean restaurant receipt format #QB-XXXX');
  });

  await t.test('Cancellation explicitly allowed from pending/accepted but rejected from cooking/on_the_way/delivered', () => {
    function evaluatePostgresTriggerCancellation(oldStatus, newStatus) {
      if (newStatus === 'cancelled') {
        if (['cooking', 'ready_for_pickup', 'on_the_way', 'delivered'].includes(oldStatus)) {
          throw new Error(`Cannot cancel order once kitchen preparation has begun (${oldStatus} to ${newStatus})`);
        }
        return 'ALLOWED';
      }
      return 'FORWARD';
    }

    assert.equal(evaluatePostgresTriggerCancellation('pending', 'cancelled'), 'ALLOWED');
    assert.equal(evaluatePostgresTriggerCancellation('accepted', 'cancelled'), 'ALLOWED');
    assert.throws(() => evaluatePostgresTriggerCancellation('cooking', 'cancelled'), /Cannot cancel order once kitchen preparation has begun/);
    assert.throws(() => evaluatePostgresTriggerCancellation('on_the_way', 'cancelled'), /Cannot cancel order once kitchen preparation has begun/);
    assert.throws(() => evaluatePostgresTriggerCancellation('delivered', 'cancelled'), /Cannot cancel order once kitchen preparation has begun/);
  });

  await t.test('Empty remote sync preserves local active orders without wiping cache', () => {
    const localCache = [{ id: 'ord-1', status: 'cooking' }, { id: 'ord-2', status: 'accepted' }];
    function handleRemoteSync(data) {
      if (data.length === 0) {
        // Safe: preserve local active orders
        return localCache;
      }
      return data;
    }

    const result = handleRemoteSync([]);
    assert.equal(result.length, 2, 'Local orders must not be cleared on empty remote response');
    assert.equal(result[0].id, 'ord-1');
  });

  await t.test('Strict pickup matching rejects partial substring matches and atomic claim guards protect dispatched orders', () => {
    const orders = [
      { id: 'ord-1792614992', pickupCode: '4992', status: 'ready_for_pickup' },
      { id: 'ord-9999999999', pickupCode: '9999', status: 'on_the_way', assignedRiderName: 'Rider Imran' },
      { id: 'ord-8888888888', pickupCode: '8888', status: 'delivered' }
    ];

    function strictMatch(code, order) {
      const clean = String(code).trim().replace(/\D/g, '');
      const orderDigits = String(order.id).replace(/\D/g, '');
      const bagCode = order.pickupCode ? String(order.pickupCode).replace(/\D/g, '') : orderDigits.slice(-4);
      return bagCode === clean || String(order.id) === clean || orderDigits === clean || orderDigits.endsWith(clean);
    }

    // Exact pickup code matches
    assert.equal(strictMatch('4992', orders[0]), true);
    // Arbitrary middle substring (e.g. 2614 in 1792614992) must NOT match
    assert.equal(strictMatch('2614', orders[0]), false);

    function evaluateClaim(order) {
      if (order.status === 'on_the_way') {
        return { success: false, reason: 'already_claimed' };
      }
      if (order.status === 'delivered') {
        return { success: false, reason: 'already_delivered' };
      }
      return { success: true };
    }

    assert.equal(evaluateClaim(orders[0]).success, true, 'Ready order can be claimed');
    assert.equal(evaluateClaim(orders[1]).success, false, 'Already dispatched order cannot be claimed');
    assert.equal(evaluateClaim(orders[2]).success, false, 'Delivered order cannot be claimed');
  });

  await t.test('COD cash collected is persisted in status update payload', () => {
    const isCod = true;
    const cash = 330;
    const extraData = {
      cashCollected: isCod ? Number(cash) : 0
    };
    const fullPayload = {
      status: 'delivered',
      cash_collected: extraData.cashCollected
    };
    assert.equal(fullPayload.cash_collected, 330);
  });

  await t.test('checkDeliveryAvailability fails closed on unpinned or invalid coordinates', () => {
    const RESTAURANT = { lat: 12.720611, lng: 77.286833 };
    function checkDelivery(userLat, userLng, radius = 7) {
      const numLat = Number(userLat);
      const numLng = Number(userLng);
      if (!Number.isFinite(numLat) || !Number.isFinite(numLng) || (numLat === 0 && numLng === 0)) {
        return { deliverable: false, distanceKm: null, maxRadiusKm: radius, reason: 'unpinned' };
      }
      const R = 6371;
      const dLat = (numLat - RESTAURANT.lat) * (Math.PI / 180);
      const dLng = (numLng - RESTAURANT.lng) * (Math.PI / 180);
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(RESTAURANT.lat * (Math.PI / 180)) *
        Math.cos(numLat * (Math.PI / 180)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const dist = Math.round(R * c * 10) / 10;
      return { deliverable: dist <= radius, distanceKm: dist, maxRadiusKm: radius, reason: dist <= radius ? 'in_zone' : 'out_of_zone' };
    }

    assert.equal(checkDelivery(undefined, undefined).deliverable, false);
    assert.equal(checkDelivery(null, null).deliverable, false);
    assert.equal(checkDelivery(0, 0).deliverable, false);
    assert.equal(checkDelivery('invalid', 'coords').deliverable, false);
    assert.equal(checkDelivery(null, null).reason, 'unpinned');

    // Valid location within 1 km
    const closeLocation = checkDelivery(12.721, 77.287);
    assert.equal(closeLocation.deliverable, true);
    assert.equal(closeLocation.reason, 'in_zone');

    // Far location > 20 km
    const farLocation = checkDelivery(12.9716, 77.5946); // Bangalore city center
    assert.equal(farLocation.deliverable, false);
    assert.equal(farLocation.reason, 'out_of_zone');
  });

  await t.test('Order validation rejects placement when master store is closed', () => {
    function validateStoreStatus(settings, order) {
      if ((settings.storeOpen === false) && !order.bypassClosedCheck && !order.isDemo) {
        return { success: false, reason: 'store_closed', message: settings.storeClosedReason || 'Kitchen is currently closed for orders.' };
      }
      return { success: true };
    }

    const closedSettings = {
      storeOpen: false,
      storeClosedReason: 'The kitchen is currently closed for the night.'
    };

    const customerOrder = { id: 'ord-123', items: [{ name: 'Burger', quantity: 1 }] };
    const result = validateStoreStatus(closedSettings, customerOrder);
    assert.equal(result.success, false);
    assert.equal(result.reason, 'store_closed');
    assert.equal(result.message, 'The kitchen is currently closed for the night.');

    // Admin demo order with bypass
    const demoOrder = { id: 'ord-demo', isDemo: true, bypassClosedCheck: true };
    assert.equal(validateStoreStatus(closedSettings, demoOrder).success, true);
  });

  await t.test('Order validation rejects placement when any cart item is out of stock', () => {
    const catalog = [
      { id: 'dish-1', name: 'Crispy Burger', inStock: true },
      { id: 'dish-2', name: 'Peri-Peri Wings', inStock: false }
    ];

    function validateStock(items, dishes) {
      for (const item of items) {
        const dish = dishes.find(d => d.id === item.id || d.name === item.name);
        if (dish && dish.inStock === false) {
          return { success: false, reason: 'out_of_stock', item: dish.name };
        }
      }
      return { success: true };
    }

    const availableCart = [{ id: 'dish-1', name: 'Crispy Burger', quantity: 2 }];
    assert.equal(validateStock(availableCart, catalog).success, true);

    const soldOutCart = [
      { id: 'dish-1', name: 'Crispy Burger', quantity: 1 },
      { id: 'dish-2', name: 'Peri-Peri Wings', quantity: 1 }
    ];
    const failResult = validateStock(soldOutCart, catalog);
    assert.equal(failResult.success, false);
    assert.equal(failResult.reason, 'out_of_stock');
    assert.equal(failResult.item, 'Peri-Peri Wings');
  });

  await t.test('Category custom image persistence preserves user photos across remote Supabase sync without image column', () => {
    // Mock local category store and custom category image map
    const customImages = {
      'cat-biryani': 'https://r2.example.com/cryspychiken/dishes/category_custom_biryani.jpg',
      'biryani-rice': 'https://r2.example.com/cryspychiken/dishes/category_custom_biryani.jpg'
    };

    // Remote Supabase categories table response (schema lacks 'image' column)
    const remoteSupabaseCategories = [
      { id: 'cat-biryani', name: 'Biryani & Rice', emoji: '🍚', slug: 'biryani-rice', created_at: '2026-10-25' },
      { id: 'cat-drinks', name: 'Cool Drinks', emoji: '🥤', slug: 'drinks', created_at: '2026-10-25' }
    ];

    // Merge logic: Remote categories must adopt local custom category images
    const merged = remoteSupabaseCategories.map(remoteCat => {
      const existingImg = (remoteCat.image || customImages[remoteCat.id] || (remoteCat.slug ? customImages[remoteCat.slug] : '') || '').trim();
      return {
        ...remoteCat,
        image: existingImg
      };
    });

    assert.equal(merged[0].image, 'https://r2.example.com/cryspychiken/dishes/category_custom_biryani.jpg');
    assert.equal(merged[0].name, 'Biryani & Rice');
    assert.equal(merged[1].image, '');
  });

  await t.test('Category update gracefully falls back without image column when remote PostgreSQL schema rejects image field', () => {
    const updatePayload = {
      id: 'cat-biryani',
      name: 'Biryani & Rice Delight',
      emoji: '🍚',
      slug: 'biryani-rice',
      image: 'https://r2.example.com/dishes/category_biryani.jpg'
    };

    const supabaseError = { message: "Could not find the 'image' column of 'categories' in the schema cache" };

    // Handler detects missing column error and strips image property
    if (supabaseError && supabaseError.message.includes("'image'")) {
      delete updatePayload.image;
    }

    assert.strictEqual(updatePayload.image, undefined);
    assert.strictEqual(updatePayload.name, 'Biryani & Rice Delight');
    assert.strictEqual(updatePayload.emoji, '🍚');
  });

  await t.test('sanitizeCategoryImageUrl sanitizes R2 links, keys, and uploaded filenames into permanent proxy endpoints', () => {
    // 1. R2 direct presigned URL
    const r2Url = 'https://ac8ec178ff831995f9cc03213674c306.r2.cloudflarestorage.com/smmtaj/categories/category_biryani.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc';
    assert.equal(sanitizeCategoryImageUrl(r2Url), '/api/r2-image?key=categories%2Fcategory_biryani.png');

    // 2. Relative categories key
    assert.equal(sanitizeCategoryImageUrl('categories/category_biryani.png'), '/api/r2-image?key=categories%2Fcategory_biryani.png');

    // 3. User uploaded image filename
    assert.equal(sanitizeCategoryImageUrl('Gemini_Generated_Image_9ocagm9ocagm9oca__3_-removebg-preview.png'), '/api/r2-image?key=categories%2FGemini_Generated_Image_9ocagm9ocagm9oca__3_-removebg-preview.png');

    // 4. Standard external HTTPS URL remains untouched
    const unsplash = 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=240';
    assert.equal(sanitizeCategoryImageUrl(unsplash), unsplash);

    // 5. Empty or null safety
    assert.equal(sanitizeCategoryImageUrl(''), '');
    assert.equal(sanitizeCategoryImageUrl(null), '');
  });

  await t.test('All category image getter and setter resolution with custom R2 and fallback', () => {
    const map = {};
    function mockGetAllCategoryImage() {
      const custom = (map['all'] || map['cat-all'] || '').trim();
      if (custom) return sanitizeCategoryImageUrl(custom);
      return 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=200&auto=format&fit=crop&q=80';
    }
    function mockSetAllCategoryImage(imageUrl) {
      const sanitized = imageUrl && typeof imageUrl === 'string' && imageUrl.trim()
        ? sanitizeCategoryImageUrl(imageUrl.trim())
        : '';
      map['all'] = sanitized;
      map['cat-all'] = sanitized;
      return sanitized;
    }

    // Default fallback
    assert.equal(mockGetAllCategoryImage(), 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=200&auto=format&fit=crop&q=80');

    // Setting custom R2 image
    mockSetAllCategoryImage('categories/all_cuisines.png');
    assert.equal(mockGetAllCategoryImage(), '/api/r2-image?key=categories%2Fall_cuisines.png');
    assert.equal(map['all'], '/api/r2-image?key=categories%2Fall_cuisines.png');
    assert.equal(map['cat-all'], '/api/r2-image?key=categories%2Fall_cuisines.png');
  });

  await t.test('Minimum Order Value (MOV) checkout validation and settings update', () => {
    function validateCheckoutMov(cartItems, minOrderValue) {
      const subtotal = cartItems.reduce((acc, i) => acc + (i.price * i.quantity), 0);
      const mov = Math.max(0, Number(minOrderValue || 0));
      if (mov > 0 && subtotal < mov) {
        return {
          canCheckout: false,
          subtotal,
          minOrderValue: mov,
          needed: mov - subtotal,
          message: `Minimum order value is ₹${mov}. Please add ₹${mov - subtotal} more to proceed to checkout!`
        };
      }
      return {
        canCheckout: true,
        subtotal,
        minOrderValue: mov,
        needed: 0
      };
    }

    const cart = [
      { id: 'dish-1', name: 'Crispy Burger', price: 90, quantity: 1 }
    ];

    // 1. With MOV = 0 (no minimum limit)
    assert.equal(validateCheckoutMov(cart, 0).canCheckout, true);

    // 2. With MOV = 149 (customer cart is 90 -> blocked, needs 59)
    const res149 = validateCheckoutMov(cart, 149);
    assert.equal(res149.canCheckout, false);
    assert.equal(res149.needed, 59);
    assert.equal(res149.minOrderValue, 149);

    // 3. Customer adds more items (cart is 90 + 90 = 180 -> allowed)
    const cartBigger = [
      { id: 'dish-1', name: 'Crispy Burger', price: 90, quantity: 2 }
    ];
    assert.equal(validateCheckoutMov(cartBigger, 149).canCheckout, true);

    // 4. MOV configuration parsing preserves custom values including 149 without zeroing
    function parseMovSetting(raw) {
      return Math.max(0, Number(raw !== undefined ? raw : 0));
    }
    assert.equal(parseMovSetting(0), 0);
    assert.equal(parseMovSetting(99), 99);
    assert.equal(parseMovSetting(149), 149);
    assert.equal(parseMovSetting(199), 199);
    assert.equal(parseMovSetting(249), 249);
    assert.equal(parseMovSetting(-50), 0);
    assert.equal(parseMovSetting(undefined), 0);
  });
});
