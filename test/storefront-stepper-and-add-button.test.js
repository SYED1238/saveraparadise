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
});
