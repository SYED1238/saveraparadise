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

  await t.test('Bug 12: Favorite dishes deduplicates id/name pairs and counts 1 dish as 1 favorite', () => {
    assert.match(mainJs, /class FavoriteDishesSet extends Set/, 'main.js must define FavoriteDishesSet to preserve accurate .size');
    assert.match(mainJs, /updateProfileStats\(\)/, 'toggleFavoriteDishId must trigger updateProfileStats to keep profile stat in sync');
  });

  const orderActionJs = fs.readFileSync('api/order-action.js', 'utf8');
  const funcOrderActionJs = fs.readFileSync('functions/api/order-action.js', 'utf8');

  await t.test('Argon Bug 1: startDishScheduleTicker uses raw new Date() and openFoodDetail uses getNowInIST for todayCode', () => {
    assert.match(mainJs, /function startDishScheduleTicker\(\)\s*\{[\s\S]*?const now = new Date\(\);/, 'startDishScheduleTicker must use raw new Date() to avoid double IST shift');
    assert.match(mainJs, /const istToday = \(typeof getNowInIST === 'function'\) \? getNowInIST\(new Date\(\)\) : new Date\(\);[\s\S]*?istToday\.getDay\(\)/, 'openFoodDetail must use getNowInIST().getDay() for 7-day strip');
  });

  await t.test('Argon Bug 2: spice and sauce preserved in cart, rendered in UI, passed in checkout & order-action', () => {
    assert.match(mainJs, /if \(item\.spice\) existing\.spice = item\.spice;[\s\S]*?if \(item\.sauce\) existing\.sauce = item\.sauce;/, 'addToCart must preserve spice and sauce on existing item');
    assert.match(mainJs, /cart-item-custom/, 'renderCart must render cart-item-custom class for spice/sauce');
    assert.match(apiCheckoutJs, /safeSpice\s*\?\s*\{\s*spice:\s*safeSpice\s*\}/, 'api/checkout.js must preserve spice in verifiedItems');
    assert.match(funcCheckoutJs, /safeSpice\s*\?\s*\{\s*spice:\s*safeSpice\s*\}/, 'functions/api/checkout.js must preserve spice in verifiedItems');
    assert.match(orderActionJs, /if \(i\.spice && i\.spice !== 'Medium'\) custom\.push\(i\.spice\);/, 'api/order-action.js must include spice in itemsSummary');
    assert.match(funcOrderActionJs, /if \(i\.spice && i\.spice !== 'Medium'\) custom\.push\(i\.spice\);/, 'functions/api/order-action.js must include spice in itemsSummary');
  });

  await t.test('Argon Bug 3: cancelCustomerOrder rollback on rejection, refund metadata sync, self-cancel alarm & server 2-min window', () => {
    assert.match(dataServiceJs, /targetOrder\.status = prevStatus;[\s\S]*?targetOrder\.statusLabel = prevStatusLabel;[\s\S]*?targetOrder\.stepIndex = prevStepIndex;/, 'cancelCustomerOrder must restore state on non-cooking server rejection');
    assert.match(dataServiceJs, /targetOrder\.cfPaymentStatus = res\.order\.cf_payment_status;/, 'cancelCustomerOrder must copy cfPaymentStatus from server response');
    assert.match(mainJs, /const isFailed = refundStatus === 'FAILED';[\s\S]*?const isInitiated = isOnline && !isRefunded && !isFailed && \(/, 'getOrderRefundState must not have trailing || isOnline tautology');
    assert.match(mainJs, /const isCustomerCancelled = order\.cancelledBy === 'customer' \|\| order\.cancellationReason === 'Cancelled by customer';[\s\S]*?if \(isCustomerCancelled\)\s*\{\s*return;\s*\}/, 'handleStorefrontOrderStatusSync must not trigger alarm when cancelled by customer');
    assert.match(orderActionJs, /\(Date\.now\(\) - createdMs\) > 135000/, 'api/order-action.js must enforce 2-minute cancellation window with grace buffer');
    assert.match(funcOrderActionJs, /\(Date\.now\(\) - createdMs\) > 135000/, 'functions/api/order-action.js must enforce 2-minute cancellation window with grace buffer');
  });

  await t.test('Argon Bug 4: Free delivery and discount clamping parity across api/checkout.js and functions/api/checkout.js', () => {
    assert.doesNotMatch(apiCheckoutJs, /hasCustomSettings && cleanCode === configCode/, 'api/checkout.js must not gate configCode check behind hasCustomSettings');
    assert.match(apiCheckoutJs, /Math\.min\(50,\s*Math\.max\(1,\s*rawPct\)\)/, 'api/checkout.js must clamp discount percentage to 50%');
    assert.match(funcCheckoutJs, /Math\.min\(50,\s*Math\.max\(1,\s*rawPct\)\)/, 'functions/api/checkout.js must clamp discount percentage to 50%');
    assert.match(dataServiceJs, /Math\.min\(50,\s*Math\.max\(1, Number\(settings\.offerDiscountPercent/, 'dataService.js must clamp discount to 50%');
  });

  await t.test('Argon Bug 5: Address edit flatNo/street deduplication and reverse-geocoding race condition', () => {
    assert.match(mainJs, /detectedAddressDetails = \{\s*flatNo:\s*'Pinned Doorstep'[\s\S]*?fullText:\s*`Pinned Doorstep \(\$\{lat\.toFixed\(5\)\}, \$\{lng\.toFixed\(5\)\}\)`/, 'updateMapLocation must reset detectedAddressDetails before reverse geocoding');
    assert.match(mainJs, /fullText:\s*\[existing\.area,\s*existing\.city,\s*existing\.pincode\]\.filter\(Boolean\)\.join\(', '\)/, 'openAddressModal must exclude flatNo from fullText when editing');
    assert.match(mainJs, /const startsWithStreet = localityText\.toLowerCase\(\)\.startsWith\(streetVal\.toLowerCase\(\)\);/, 'formDeliveryAddress must deduplicate streetVal if localityText starts with it');
  });

  await t.test('Argon Bug 6: Stepper cleanup on scheduled cards, image escaping, and live dish sync renderCart', () => {
    assert.match(mainJs, /card\.classList\.contains\('is-scheduled-countdown'\) \|\|\s*card\.classList\.contains\('is-scheduled-inactive'\)/, 'updateMenuCardSteppers must check scheduled-countdown and scheduled-inactive');
    assert.match(mainJs, /const safeCardImg = escapeHtml\(rawCardImg\);[\s\S]*?data-image="\$\{safeCardImg\}"/, 'syncStorefrontCardsWithDataService must sanitize and escape dish image');
    assert.match(mainJs, /if \(e\.key === 'quickbite_dishes'\)\s*\{\s*syncStorefrontCardsWithDataService\(\);\s*renderCart\(\);/, 'quickbite_dishes storage handler must call renderCart()');
    assert.match(mainJs, /if \(e\.detail\?\.type === 'dishes'\)\s*\{\s*syncStorefrontCardsWithDataService\(\);\s*renderCart\(\);/, 'quickbite_data_changed dishes handler must call renderCart()');
  });

  await t.test('Argon Bug 7: Redundant change: event subscriptions removed from main.js and dataService.on deduplicates base events', () => {
    assert.doesNotMatch(mainJs, /dataService\.on\('change:categories'/, 'main.js must not register redundant change:categories');
    assert.doesNotMatch(mainJs, /dataService\.on\('change:dishes'/, 'main.js must not register redundant change:dishes');
    assert.doesNotMatch(mainJs, /dataService\.on\('change:addresses'/, 'main.js must not register redundant change:addresses');
    assert.match(dataServiceJs, /const baseType = String\(eventName \|\| ''\)\.replace\(\/\^change:\/, ''\);/, 'dataService.on must deduplicate base event types');
  });

  await t.test('Follow-up Fix 1: syncStorefrontCardsWithDataService resolves activeCat from pillsWrap and avoids undeclared activeFilter', () => {
    assert.doesNotMatch(mainJs, /filterDishes\(activeFilter/, 'main.js must not reference undeclared activeFilter');
    assert.match(mainJs, /const activePill = \(typeof pillsWrap !== 'undefined' && pillsWrap\) \? pillsWrap\.querySelector\('\.category-pill\.active'\) : null;/, 'syncStorefrontCardsWithDataService must resolve activePill from pillsWrap');
    assert.match(mainJs, /filterDishes\(activeCat\);/, 'syncStorefrontCardsWithDataService must filter by activeCat');
  });

  await t.test('Follow-up Fix 2: dataService.addOrder and Reorder flow preserve spice and sauce', () => {
    assert.match(dataServiceJs, /safeSpice \? \{ spice: safeSpice \} : \{\}/, 'dataService.addOrder must preserve safeSpice on sanitizedItems');
    assert.match(dataServiceJs, /safeSauce \? \{ sauce: safeSauce \} : \{\}/, 'dataService.addOrder must preserve safeSauce on sanitizedItems');
    assert.match(mainJs, /if \(item\.spice\) foundInCart\.spice = item\.spice;[\s\S]*?if \(item\.sauce\) foundInCart\.sauce = item\.sauce;/, 'Reorder handler must preserve spice and sauce on foundInCart');
    assert.match(mainJs, /\.\.\.\(item\.spice \? \{ spice: item\.spice \} : \{\}\)[\s\S]*?\.\.\.\(item\.sauce \? \{ sauce: item\.sauce \} : \{\}\)/, 'Reorder handler must push spice and sauce to cart items');
  });

  await t.test('Follow-up Fix 3: dataService.on cleans up regTypes on unsubscribe and duplicate settings listener is removed', () => {
    assert.match(dataServiceJs, /regTypes\.delete\(baseType\);[\s\S]*?unsub\(\);/, 'dataService.on unsubscribe must delete baseType from regTypes');
    assert.doesNotMatch(mainJs, /dataService\.subscribeToChanges\('settings',\s*\(\)\s*=>\s*\{[\s\S]*?syncStorefrontCardsWithDataService\(\);[\s\S]*?renderCart\(\);[\s\S]*?\}\);/, 'main.js must not have duplicate inline subscribeToChanges(settings)');
  });

  await t.test('Help & Support Dropdown: +91 90366 24237 WhatsApp and Call accordion in authenticated and guest profile views', () => {
    const indexHtml = fs.readFileSync('index.html', 'utf8');
    const styleCss = fs.readFileSync('style.css', 'utf8');

    // In authenticated profile view
    assert.match(indexHtml, /id="profile-item-support-btn"[^>]*aria-controls="profile-support-card"/, 'profile-item-support-btn must control profile-support-card');
    assert.match(indexHtml, /id="profile-support-chevron"/, 'profile-support-chevron must be present');
    assert.match(indexHtml, /href="https:\/\/wa\.me\/919036624237\?text=Hello%20Savera%20Paradise%2C%20I%20need%20help\."[^>]*id="profile-help-wa-btn"/, 'profile-help-wa-btn must link to wa.me/919036624237');
    assert.match(indexHtml, /href="tel:\+919036624237"[^>]*id="profile-help-call-btn"/, 'profile-help-call-btn must link to tel:+919036624237');
    assert.match(indexHtml, /id="profile-support-card"[\s\S]*?Tap to WhatsApp[\s\S]*?\+91 90366 24237/, 'profile-support-card must display Tap to WhatsApp and +91 90366 24237');
    assert.match(indexHtml, /id="profile-support-card"[\s\S]*?Tap to Call[\s\S]*?\+91 90366 24237/, 'profile-support-card must display Tap to Call and +91 90366 24237');

    // In guest profile view
    assert.match(indexHtml, /id="guest-item-support-btn"[^>]*aria-controls="guest-support-card"/, 'guest-item-support-btn must control guest-support-card');
    assert.match(indexHtml, /id="guest-support-chevron"/, 'guest-support-chevron must be present');
    assert.match(indexHtml, /href="https:\/\/wa\.me\/919036624237\?text=Hello%20Savera%20Paradise%2C%20I%20need%20help\."[^>]*id="guest-help-wa-btn"/, 'guest-help-wa-btn must link to wa.me/919036624237');
    assert.match(indexHtml, /href="tel:\+919036624237"[^>]*id="guest-help-call-btn"/, 'guest-help-call-btn must link to tel:+919036624237');

    // In main.js
    assert.match(mainJs, /profileItemSupportBtn\.addEventListener\('click'[\s\S]*?profileSupportCard\.style\.display\s*=\s*isHidden\s*\?\s*'block'\s*:\s*'none'/, 'main.js must toggle profileSupportCard display');
    assert.match(mainJs, /guestItemSupportBtn\.addEventListener\('click'[\s\S]*?guestSupportCard\.style\.display\s*=\s*isHidden\s*\?\s*'block'\s*:\s*'none'/, 'main.js must toggle guestSupportCard display');
    assert.match(mainJs, /profileSupportChevron\.style\.transform\s*=\s*isHidden\s*\?\s*'rotate\(90deg\)'/, 'main.js must rotate profileSupportChevron on open');
    assert.match(mainJs, /guestSupportChevron\.style\.transform\s*=\s*isHidden\s*\?\s*'rotate\(90deg\)'/, 'main.js must rotate guestSupportChevron on open');

    // In style.css
    assert.match(styleCss, /\.profile-help-card\s*\{[\s\S]*?animation:\s*slideDownFade/, 'style.css must animate profile-help-card with slideDownFade');
    assert.match(styleCss, /\.profile-help-action-card\.profile-help-wa:hover\s*\{[\s\S]*?border-color:\s*#22C55E;/, 'style.css must have WhatsApp hover border');
    assert.match(styleCss, /\.profile-help-action-card\.profile-help-call:hover\s*\{[\s\S]*?border-color:\s*#FF5A26;/, 'style.css must have Call hover border');
  });

  await t.test('Saved Addresses UI: Card never shrinks, Edit and Delete buttons are visible, and address line is clean and short', () => {
    const freshMainJs = fs.readFileSync('main.js', 'utf8');
    const freshStyleCss = fs.readFileSync('style.css', 'utf8');

    // CSS guarantees card never shrinks and buttons never clip
    assert.match(freshStyleCss, /\.profile-addr-item\s*\{[\s\S]*?flex-shrink:\s*0;/, 'profile-addr-item must have flex-shrink: 0');
    assert.match(freshStyleCss, /\.profile-addr-item\s*\{[\s\S]*?overflow:\s*visible;/, 'profile-addr-item must have overflow: visible to prevent clipping buttons');
    assert.match(freshStyleCss, /\.profile-addr-street\s*\{[\s\S]*?-webkit-line-clamp:\s*2;/, 'profile-addr-street must clamp to 2 lines');

    // Buttons remain properly styled and wired
    assert.match(freshStyleCss, /\.btn-profile-edit-addr\s*\{/, 'style.css must style edit button');
    assert.match(freshStyleCss, /\.btn-profile-del-addr\s*\{/, 'style.css must style delete button');

    // main.js formats displayAddress and keeps Edit & Delete buttons
    assert.match(freshMainJs, /formatDisplayAddress/, 'renderProfileAddresses must use formatDisplayAddress');
    assert.match(freshMainJs, /btn-profile-edit-addr/, 'renderProfileAddresses must render edit button');
    assert.match(freshMainJs, /btn-profile-del-addr/, 'renderProfileAddresses must render delete button');
  });
});
