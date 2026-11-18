import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('SAVERA PARADISE PAYMENT & CUSTOMER PORTAL 10-BUG FIX VERIFICATION SUITE', async (t) => {
  const apiQrJs = fs.readFileSync('api/cashfree-generate-qr.js', 'utf8');
  const funcQrJs = fs.readFileSync('functions/api/cashfree-generate-qr.js', 'utf8');
  const apiCashfreeJs = fs.readFileSync('api/_cashfree.js', 'utf8');
  const funcCashfreeJs = fs.readFileSync('functions/api/_cashfree.js', 'utf8');
  const apiOrderActionJs = fs.readFileSync('api/order-action.js', 'utf8');
  const funcOrderActionJs = fs.readFileSync('functions/api/order-action.js', 'utf8');
  const apiCreateOrderJs = fs.readFileSync('api/cashfree-create-order.js', 'utf8');
  const funcCreateOrderJs = fs.readFileSync('functions/api/cashfree-create-order.js', 'utf8');
  const funcWebhookJs = fs.readFileSync('functions/api/cashfree-webhook.js', 'utf8');
  const deliveryJs = fs.readFileSync('delivery.js', 'utf8');
  const mainJs = fs.readFileSync('main.js', 'utf8');
  const apiCheckoutJs = fs.readFileSync('api/checkout.js', 'utf8');
  const funcCheckoutJs = fs.readFileSync('functions/api/checkout.js', 'utf8');
  const dataServiceJs = fs.readFileSync('dataService.js', 'utf8');

  await t.test('P1: Doorstep QR removes non-existent numeric_total column and preserves paid guard & amount', () => {
    // Both api and functions/api must NOT select numeric_total from public.orders
    assert.doesNotMatch(apiQrJs, /select\([^)]*numeric_total/, 'api/cashfree-generate-qr.js must not select numeric_total from orders table');
    assert.doesNotMatch(funcQrJs, /select\([^)]*numeric_total/, 'functions/api/cashfree-generate-qr.js must not select numeric_total from orders table');

    // Both must select address_details and safe columns
    assert.match(apiQrJs, /select\('id,\s*total,\s*customer_name,\s*payment_status,\s*cf_order_id,\s*doorstep_upi,\s*address_details'\)/);
    assert.match(funcQrJs, /select\('id,\s*total,\s*customer_name,\s*payment_status,\s*cf_order_id,\s*doorstep_upi,\s*address_details'\)/);

    // Both must safely extract rawNumericTotal from numeric_total mock, address_details.numericTotal, or total string
    assert.match(apiQrJs, /existingOrder\.address_details\?\.numericTotal/);
    assert.match(funcQrJs, /existingOrder\.address_details\?\.numericTotal/);
  });

  await t.test('P2: Edge cache kitchen_poll purged and lastActiveOrderSeenAt updated on online settlement', () => {
    // Both order-action.js files must update lastActiveOrderSeenAt in invalidateOrderActionMemoryCache
    assert.match(apiOrderActionJs, /if\s*\(options\?\.markActiveOrder\s*!==\s*false\)\s*\{\s*lastActiveOrderSeenAt\s*=\s*Date\.now\(\);/);
    assert.match(funcOrderActionJs, /if\s*\(options\?\.markActiveOrder\s*!==\s*false\)\s*\{\s*lastActiveOrderSeenAt\s*=\s*Date\.now\(\);/);

    // Both order-action.js files must export purgeKitchenPollEdgeCache
    assert.match(apiOrderActionJs, /export\s+async\s+function\s+purgeKitchenPollEdgeCache/);
    assert.match(funcOrderActionJs, /export\s+async\s+function\s+purgeKitchenPollEdgeCache/);

    // functions/api cashfree endpoints must import and call purgeKitchenPollEdgeCache
    assert.match(funcCreateOrderJs, /import\s*\{[^}]*purgeKitchenPollEdgeCache[^}]*\}\s*from\s*'\.\/order-action\.js'/);
    assert.match(funcWebhookJs, /import\s*\{[^}]*purgeKitchenPollEdgeCache[^}]*\}\s*from\s*'\.\/order-action\.js'/);
    assert.match(funcCreateOrderJs, /await\s+purgeKitchenPollEdgeCache\(request,\s*context\)/);
    assert.match(funcWebhookJs, /await\s+purgeKitchenPollEdgeCache\(request,\s*context\)/);
  });

  await t.test('P3: Online Payment Mobile UPI redirect return restores draft and tracking token', () => {
    // main.js must persist to both sessionStorage and localStorage before checkout
    assert.match(mainJs, /localStorage\.setItem\('savera_pending_online_order'/);
    assert.match(mainJs, /quickbite_tracking_tokens/);

    // payment_return=1 handler must restore draft and tracking token from localStorage
    assert.match(mainJs, /sessionStorage\.getItem\('savera_pending_online_order'\)\s*\|\|\s*localStorage\.getItem\('savera_pending_online_order'\)/);
    assert.match(mainJs, /quickbite_tracking_tokens/);

    // finalizeVerifiedOnlineOrder must accept fallbackOrderId and clean up both storage keys
    assert.match(mainJs, /async\s+function\s+finalizeVerifiedOnlineOrder\(serverOrder,\s*fallbackDraft\s*=\s*null,\s*fallbackOrderId\s*=\s*null\)/);
    assert.match(mainJs, /localStorage\.removeItem\('savera_pending_online_order'\)/);
  });

  await t.test('P4: Delayed webhook / modal close has background poller and storage persistence', () => {
    // When verifyData.paid is false, poller must be active
    assert.match(mainJs, /const\s+recoveryTimer\s*=\s*setInterval\(async\s*\(\)\s*=>/);
    assert.match(mainJs, /finalizeVerifiedOnlineOrder\(pData\.order,\s*newOrder,\s*recoveryOrderId\)/);
  });

  await t.test('P5: Order metadata enriched and Supabase insert failure guarded in cashfree-create-order', () => {
    // Check addressDetails pricing enrichment in both files
    assert.match(apiCreateOrderJs, /addressDetails\.subtotal\s*=\s*decodedPayload\.subtotal/);
    assert.match(funcCreateOrderJs, /addressDetails\.subtotal\s*=\s*decodedPayload\.subtotal/);
    assert.match(apiCreateOrderJs, /addressDetails\.appliedPromo\s*=\s*decodedPayload\.appliedPromo/);
    assert.match(funcCreateOrderJs, /addressDetails\.appliedPromo\s*=\s*decodedPayload\.appliedPromo/);
    assert.match(apiCreateOrderJs, /addressDetails\.numericTotal\s*=\s*Math\.round\(finalAmount\)/);
    assert.match(funcCreateOrderJs, /addressDetails\.numericTotal\s*=\s*Math\.round\(finalAmount\)/);

    // Supabase insert failure must fail closed with 500 error
    assert.match(apiCreateOrderJs, /Failed to initialize order record before payment/);
    assert.match(funcCreateOrderJs, /Failed to initialize order record before payment/);
  });

  await t.test('P6: Rider doorstep payment verification includes Bearer token', () => {
    // In delivery.js, verifyDoorstepPaymentStatus must attach Authorization Bearer header
    assert.match(deliveryJs, /headers\['Authorization'\]\s*=\s*`Bearer \$\{riderToken\}`/);
    // Active confirm order memory must be updated with paid status
    assert.match(deliveryJs, /activeConfirmOrder\.paymentStatus\s*=\s*'Paid'/);
    assert.match(deliveryJs, /activeConfirmOrder\.doorstep_upi\s*=\s*true/);
  });

  await t.test('C1: Checkout modal total is synced inside openCheckoutModalInternal and renderCart', () => {
    assert.match(mainJs, /function\s+openCheckoutModalInternal\(\)\s*\{\s*renderCheckoutAddresses\(\);\s*if\s*\(checkoutBillTotal\s*&&\s*summaryTotal\)\s*\{\s*checkoutBillTotal\.textContent\s*=\s*summaryTotal\.textContent\s*\|\|\s*'₹0';/);
  });

  await t.test('C2: Dual-API parity across api/checkout.js and functions/api/checkout.js', () => {
    // CORS headers must include cf-turnstile-response in both
    assert.match(apiCheckoutJs, /cf-turnstile-response/);
    assert.match(funcCheckoutJs, /cf-turnstile-response/);

    // Quantity parsing supports rawQty = item.qty ?? item.quantity ?? 1 with 1-50 range
    assert.match(apiCheckoutJs, /item\.qty\s*\?\?\s*item\.quantity\s*\?\?\s*1/);
    assert.match(funcCheckoutJs, /item\.qty\s*\?\?\s*item\.quantity\s*\?\?\s*1/);

    // verifiedItems includes total
    assert.match(apiCheckoutJs, /total:\s*itemTotal/);
    assert.match(funcCheckoutJs, /total:\s*itemTotal/);

    // checkoutPayload includes timestamp and verifiedAt
    assert.match(apiCheckoutJs, /verifiedAt:\s*Date\.now\(\)/);
    assert.match(funcCheckoutJs, /timestamp:\s*Date\.now\(\)/);

    // response JSON includes success: true in both
    assert.match(apiCheckoutJs, /success:\s*true/);
    assert.match(funcCheckoutJs, /success:\s*true/);
  });

  await t.test('C3: Multi-tier unlocked deals evaluated in main.js and dataService.js', () => {
    assert.match(mainJs, /function\s+evaluateUnlockedDeals\(subtotal,\s*settings/);
    assert.match(mainJs, /settings\.unlockedDealsThresholds\.length\s*>\s*0/);
    assert.match(dataServiceJs, /settings\.unlockedDealsThresholds\.length\s*>\s*0/);
  });

  await t.test('C4: Multi-device customer order sync and swiggyInputInstructions lifecycle', () => {
    // dataService syncCustomerOrdersFromSupabase merges trackedOrders and authenticated sbOrders
    assert.match(dataServiceJs, /const\s+mergedMap\s*=\s*new\s+Map\(\);/);
    assert.match(dataServiceJs, /trackedOrders\.forEach/);
    assert.match(dataServiceJs, /sbOrders\.forEach/);

    // openAddressModal handles swiggyInputInstructions
    assert.match(mainJs, /swiggyInputInstructions\.value\s*=\s*existing\.instructions/);
    assert.match(mainJs, /swiggyInputInstructions\.value\s*=\s*'';/);
  });
});
