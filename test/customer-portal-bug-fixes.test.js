import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('CUSTOMER PORTAL 11 BUG FIXES REGRESSION SUITE', async (t) => {
  const dataServiceJs = fs.readFileSync('dataService.js', 'utf8');
  const mainJs = fs.readFileSync('main.js', 'utf8');
  const apiCheckoutJs = fs.readFileSync('api/checkout.js', 'utf8');
  const funcCheckoutJs = fs.readFileSync('functions/api/checkout.js', 'utf8');
  const swJs = fs.readFileSync('public/sw.js', 'utf8');

  await t.test('Bug 1: Online Payment & Cashfree Refund Fields mapped in dataService and main.js', () => {
    // dataService delta has payment and refund fields
    assert.match(dataServiceJs, /cfPaymentStatus:\s*remote\.cf_payment_status/, 'handleRealtimeOrderDelta must map cfPaymentStatus');
    assert.match(dataServiceJs, /refundStatus:\s*remote\.address_details\?\.refund_status/, 'handleRealtimeOrderDelta must map refundStatus');
    assert.match(dataServiceJs, /existing\.cfPaymentStatus\s*!==\s*updatedOrder\.cfPaymentStatus|local\.cfPaymentStatus\s*!==\s*mergedOrder\.cfPaymentStatus/, 'hasDiff must compare cfPaymentStatus');

    // main.js supports both address_details and addressDetails
    assert.match(mainJs, /order\.addressDetails\s*&&\s*typeof\s*order\.addressDetails\s*===\s*'object'/, 'isOrderPaidOnline and getOrderRefundState must support camelCase addressDetails');
  });

  await t.test('Bug 2: Address Segments Deduplicated on Cloud Sync', () => {
    assert.match(dataServiceJs, /flat_no:\s*\(addr\.flatNo\s*\|\|\s*addr\.street\s*\|\|\s*addr\.details/, 'syncSingleAddressToSupabase must prioritize flatNo/street over details');
    assert.match(dataServiceJs, /area:\s*\(addr\.area\s*\|\|\s*addr\.details/, 'syncSingleAddressToSupabase must prioritize area over details');
    assert.match(dataServiceJs, /cleanArea\s*=\s*\(rawArea\.toLowerCase\(\)\s*===\s*rawFlat\.toLowerCase\(\)\)/, 'syncUserAddressesFromSupabase must deduplicate identical flat_no and area');
  });

  await t.test('Bug 3: Checkout button clears disabled-sold-out on empty cart', () => {
    assert.match(mainJs, /btnCheckout\.classList\.remove\('disabled-min-order',\s*'disabled-sold-out'\)/, 'Empty cart must remove both disabled-min-order and disabled-sold-out');
    assert.match(mainJs, /if\s*\(!btnCheckout\.classList\.contains\('disabled-limit'\)\s*&&\s*!btnCheckout\.classList\.contains\('disabled-closed'\)\)/, 'Empty cart must re-enable button when no other blocks exist');
  });

  await t.test('Bug 4: renderCartOrderLimitUI does not overwrite sold-out, schedule, or min-order button labels', () => {
    assert.match(mainJs, /const hasOtherBlock\s*=\s*Boolean\(/, 'renderCartOrderLimitUI must detect other active blocking classes');
    assert.match(mainJs, /btnCheckout\.classList\.contains\('disabled-sold-out'\)/, 'renderCartOrderLimitUI must check disabled-sold-out');
    assert.match(mainJs, /btnCheckout\.classList\.contains\('disabled-min-order'\)/, 'renderCartOrderLimitUI must check disabled-min-order');
    assert.match(mainJs, /btnCheckout\.classList\.contains\('disabled-closed'\)/, 'renderCartOrderLimitUI must check disabled-closed');
  });

  await t.test('Bug 5: Customer order IDs and tracking tokens recovered across sessions', () => {
    assert.match(dataServiceJs, /getMyOrderIds\(\)/, 'dataService must expose getMyOrderIds helper');
    assert.match(dataServiceJs, /quickbite_tracking_tokens/, 'getMyOrderIds must merge tokens from quickbite_tracking_tokens');
    assert.doesNotMatch(mainJs, /localStorage\.removeItem\('quickbite_my_order_ids'\);/, 'handleSignOut must preserve quickbite_my_order_ids');
  });

  await t.test('Bug 6: Promo Code and Free Delivery Parity Across Client and Server', () => {
    assert.match(apiCheckoutJs, /settings\.offerFreeDelivery\s*!==\s*false/, 'api/checkout.js must treat undefined offerFreeDelivery as true');
    assert.match(funcCheckoutJs, /storeSettings\?\.offerFreeDelivery\s*!==\s*false/, 'functions/api/checkout.js must treat undefined offerFreeDelivery as true');
    assert.match(dataServiceJs, /settings\.offerFreeDelivery\s*!==\s*false/, 'dataService.js validateAndCreateOrder must treat undefined offerFreeDelivery as true');
    assert.match(mainJs, /setAppliedPromo\(null\);/, 'completeOrderPlacementUI must reset applied promo');
  });

  await t.test('Bug 7: Reorder Items checks dish schedule and reports unavailable dishes', () => {
    assert.match(mainJs, /const sched\s*=\s*getDishScheduleStatus\(matchedCatalog,\s*new Date\(\)\);/, 'Reorder must evaluate getDishScheduleStatus');
    assert.match(mainJs, /if\s*\(!sched\.isAvailable\)/, 'Reorder must skip dishes outside serving hours');
    assert.match(mainJs, /if\s*\(addedCount\s*===\s*0\)/, 'Reorder must guard when all dishes are skipped');
  });

  await t.test('Bug 8: api/checkout.js and functions/api/checkout.js use valid Supabase anon JWT', () => {
    const validJwtPrefix = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
    assert.ok(apiCheckoutJs.includes(validJwtPrefix), 'api/checkout.js must contain valid Supabase anon JWT');
    assert.ok(funcCheckoutJs.includes(validJwtPrefix), 'functions/api/checkout.js must contain valid Supabase anon JWT');
    assert.doesNotMatch(apiCheckoutJs, /sb_publishable_obyAWrTPc2oIxF3V9Bp23Q_cd_WxEZk/, 'api/checkout.js must not contain invalid placeholder key');
    assert.doesNotMatch(funcCheckoutJs, /sb_publishable_obyAWrTPc2oIxF3V9Bp23Q_cd_WxEZk/, 'functions/api/checkout.js must not contain invalid placeholder key');
  });

  await t.test('Bug 9: Dish Detail Modal persists favorites and captures spice/sauce choices', () => {
    assert.match(mainJs, /const FAVORITE_DISHES_KEY\s*=\s*'quickbite_favorite_dishes';/, 'main.js must define FAVORITE_DISHES_KEY');
    assert.match(mainJs, /function getFavoriteDishIds\(\)/, 'main.js must define getFavoriteDishIds');
    assert.match(mainJs, /function toggleFavoriteDishId\(dishId,\s*dishName\)/, 'main.js must define toggleFavoriteDishId');
    assert.match(mainJs, /spice:\s*selectedSpice/, 'btnModalAddCart must pass selected spice pill');
    assert.match(mainJs, /sauce:\s*selectedSauce/, 'btnModalAddCart must pass selected sauce pill');
  });

  await t.test('Bug 10: My Orders card displays Call Rider during Stage 1 pickup', () => {
    assert.match(mainJs, /order\.status === 'on_the_way'\s*\|\|\s*isOrderRiderGoingToStore\(order\)/, 'My Orders card must show Call Rider during going_to_restaurant stage');
  });

  await t.test('Bug 11: public/sw.js handles TRACK_ORDERS message', () => {
    assert.match(swJs, /event\.data\.type === 'TRACK_ORDERS'/, 'public/sw.js must handle TRACK_ORDERS message type');
    assert.match(swJs, /trackedOrderIds\.add\(String\(id\)\)/, 'public/sw.js must store tracked order IDs');
  });
});
