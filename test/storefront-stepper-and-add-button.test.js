import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('STOREFRONT ADD BUTTON & CARD STEPPER SUITE', async (t) => {
  const styleCss = fs.readFileSync(path.resolve('style.css'), 'utf-8');
  const mainJs = fs.readFileSync(path.resolve('main.js'), 'utf-8');

  await t.test('1. style.css defines high-visibility resting Add button', () => {
    assert.match(styleCss, /\.btn-glass-add\s*\{[^}]*background:\s*#FFFFFF/i, '.btn-glass-add must have solid white background');
    assert.match(styleCss, /\.btn-glass-add\s*\{[^}]*color:\s*#EA580C/i, '.btn-glass-add must have brand appetite orange color');
    assert.match(styleCss, /\.btn-glass-add\s*\{[^}]*box-shadow:/i, '.btn-glass-add must have prominent drop shadow');
    assert.match(styleCss, /\.btn-glass-add svg\s*\{[^}]*stroke:\s*#EA580C/i, '.btn-glass-add svg must have brand orange stroke');
    assert.match(styleCss, /\.btn-glass-add svg\s*\{[^}]*stroke-width:\s*3/i, '.btn-glass-add svg must have bold stroke width');
  });

  await t.test('2. style.css defines card stepper with full pill styling, buttons, and pop animation', () => {
    assert.match(styleCss, /\.dish-card-stepper\s*\{[^}]*background:\s*#FFFFFF/i, '.dish-card-stepper must have solid white background');
    assert.match(styleCss, /\.dish-card-stepper\s*\{[^}]*border:\s*1\.5px solid #EA580C/i, '.dish-card-stepper must have brand orange border');
    assert.match(styleCss, /\.dish-card-stepper\s*\{[^}]*border-radius:\s*9999px/i, '.dish-card-stepper must have pill border radius');
    assert.match(styleCss, /\.card-stepper-btn\s*\{[^}]*cursor:\s*pointer/i, '.card-stepper-btn must be clickable');
    assert.match(styleCss, /\.card-stepper-qty\s*\{[^}]*font-weight:\s*800/i, '.card-stepper-qty must have bold font weight');
    assert.match(styleCss, /@keyframes qtyBounce/i, 'style.css must include qtyBounce animation for quantity changes');
  });

  await t.test('3. style.css hides stepper on out-of-stock dish cards', () => {
    assert.match(
      styleCss,
      /\.recipe-card\.is-out-of-stock\s+\.dish-card-stepper\s*\{[^}]*display:\s*none\s*!important/i,
      'Out of stock dishes must strictly suppress card steppers'
    );
  });

  await t.test('4. style.css provides mobile-first responsive sizing for add button and stepper', () => {
    assert.match(styleCss, /@media\s*\([^)]*max-width:\s*640px\)/i, 'style.css must have mobile media query');
    assert.match(styleCss, /\.btn-glass-add\s*\{[^}]*width:\s*36px\s*!important/i, 'Mobile add button must be at least 36px');
    assert.match(styleCss, /\.dish-card-stepper\s*\{[^}]*height:\s*34px\s*!important/i, 'Mobile stepper must be 34px height');
  });

  await t.test('5. main.js updates and animates fly to cart before hiding trigger button', () => {
    const addToCartIdx = mainJs.indexOf('function addToCart');
    const animateFlyIdx = mainJs.indexOf('animateFlyToCart(triggerElement', addToCartIdx);
    const renderCartIdx = mainJs.indexOf('renderCart();', addToCartIdx);

    assert.ok(addToCartIdx > -1, 'addToCart must exist');
    assert.ok(animateFlyIdx > -1, 'animateFlyToCart must be called in addToCart');
    assert.ok(renderCartIdx > -1, 'renderCart must be called in addToCart');
    assert.ok(animateFlyIdx < renderCartIdx, 'animateFlyToCart must run before renderCart to capture element rect');
  });

  await t.test('6. main.js implements updateMenuCardSteppers with DOM sync', () => {
    assert.match(mainJs, /function updateMenuCardSteppers\(\)\s*\{/i, 'updateMenuCardSteppers must be defined');
    assert.match(mainJs, /cartQtyMap\.set\(item\.id/i, 'updateMenuCardSteppers must build cart quantity map');
    assert.match(mainJs, /card-stepper-minus/i, 'updateMenuCardSteppers must render minus button');
    assert.match(mainJs, /card-stepper-plus/i, 'updateMenuCardSteppers must render plus button');
    assert.match(mainJs, /card-stepper-qty/i, 'updateMenuCardSteppers must render quantity display');
    assert.match(mainJs, /stepper\.remove\(\)/i, 'updateMenuCardSteppers must remove stepper when quantity drops to 0');
  });

  await t.test('7. main.js delegated listener handles stepper plus and minus without opening dish modal', () => {
    assert.match(mainJs, /closest\('\.card-stepper-plus'\)/i, 'Delegated click must handle card-stepper-plus');
    assert.match(mainJs, /closest\('\.card-stepper-minus'\)/i, 'Delegated click must handle card-stepper-minus');
    assert.match(mainJs, /closest\('\.dish-card-stepper'\)/i, 'Delegated click must guard dish-card-stepper from opening food modal');
  });
  await t.test('8. main.js synchronizes quickbite_cart and quickbite_applied_promo across open browser tabs', () => {
    assert.match(mainJs, /if \(e\.key === 'quickbite_cart'\)/, 'Storage handler must listen for quickbite_cart');
    assert.match(mainJs, /if \(e\.key === 'quickbite_applied_promo'\)/, 'Storage handler must listen for quickbite_applied_promo');
  });

  await t.test('9. main.js persists applied promo code to localStorage via setAppliedPromo', () => {
    assert.match(mainJs, /function setAppliedPromo\(code\)/, 'setAppliedPromo helper must exist');
    assert.match(mainJs, /localStorage\.setItem\('quickbite_applied_promo'/, 'Must store active promo in localStorage');
    assert.match(mainJs, /localStorage\.removeItem\('quickbite_applied_promo'/, 'Must remove promo when cleared');
  });

  await t.test('10. renderCart cleans up lingering promo badges, messages, and input when cart is emptied', () => {
    const emptyCartBlock = mainJs.substring(mainJs.indexOf('if (cart.length === 0)'), mainJs.indexOf('if (cart.length === 0)') + 1800);
    assert.ok(emptyCartBlock.includes('setAppliedPromo(null);'), 'Empty cart block must reset applied promo');
    assert.ok(emptyCartBlock.includes("btnApplyPromo.textContent = 'Apply';"), 'Empty cart block must reset apply button text');
    assert.ok(emptyCartBlock.includes("btnApplyPromo.classList.remove('applied');"), 'Empty cart block must remove applied class');
    assert.ok(emptyCartBlock.includes("promoStatusMsg.textContent = '';"), 'Empty cart block must clear promo message');
  });

  await t.test('11. index.html and main.js support Packaging & Platform Fee line in Cart Drawer', () => {
    const indexHtml = fs.readFileSync('index.html', 'utf8');
    assert.ok(indexHtml.includes('id="summary-platform-fee-row"'), 'index.html must include summary-platform-fee-row');
    assert.ok(indexHtml.includes('id="summary-platform-fee"'), 'index.html must include summary-platform-fee');
    assert.match(mainJs, /const platformFee = Number\(settings\.platformFee || 0\);/, 'renderCart must read platformFee');
    assert.match(mainJs, /subtotal - discount \+ deliveryFee \+ platformFee/, 'Total must include platformFee');
  });

  await t.test('12. evaluatePromoCode branches dynamically read settings.offerMinOrder to avoid threshold divergence', () => {
    assert.match(mainJs, /const minOrder = \(settings\.offerMinOrder !== undefined\) \? Number\(settings\.offerMinOrder\) : 199;/, 'Branch 1 must use settings.offerMinOrder with 199 fallback');
    assert.match(mainJs, /const minOrder = \(settings && settings\.offerMinOrder !== undefined\) \? Number\(settings\.offerMinOrder\) : 199;/, 'Branch 2 must use settings.offerMinOrder with 199 fallback');
  });

  await t.test('13. Bill calculation applies free delivery dynamically when subtotal crosses threshold', () => {
    function computeDelivery(subtotal, threshold = 250, standardFee = 40) {
      return subtotal >= threshold ? 0 : standardFee;
    }
    assert.strictEqual(computeDelivery(100), 40);
    assert.strictEqual(computeDelivery(249), 40);
    assert.strictEqual(computeDelivery(250), 0);
    assert.strictEqual(computeDelivery(500), 0);
  });

  await t.test('14. Integer rounding protects all currency totals against IEEE-754 decimal artifacts', () => {
    const subtotal = 129.99999999999;
    const discount = 26.00000000001;
    const delivery = 40;
    const total = Math.max(0, Math.round(subtotal) - Math.round(discount) + delivery);
    assert.strictEqual(total, 144);
    assert.ok(!String(total).includes('.'), 'Total must not contain fractional digits');
  });

});
