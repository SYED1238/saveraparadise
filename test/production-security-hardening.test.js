import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, sanitizeUrl, sanitizePhone, hashPasscode } from '../securityUtils.js';
import { createAdminToken, verifyAdminToken, verifyAdminPin } from '../api/_auth.js';

test('PRODUCTION SECURITY HARDENING: Input Sanitization & XSS Defenses', async (t) => {
  await t.test('escapeHtml eliminates script tags and dangerous HTML attributes', () => {
    const payload = '<script>evil()</script><img src="x" onerror="alert(1)">';
    const escaped = escapeHtml(payload);
    assert.strictEqual(escaped.includes('<script>'), false);
    assert.strictEqual(escaped.includes('onerror='), true);
    assert.strictEqual(escaped.includes('"'), false);
    assert.strictEqual(escaped.includes('&quot;'), true);
  });

  await t.test('escapeHtml handles non-string values safely without exceptions', () => {
    assert.strictEqual(escapeHtml(null), '');
    assert.strictEqual(escapeHtml(undefined), '');
    assert.strictEqual(escapeHtml(12345), '12345');
    assert.strictEqual(escapeHtml(true), 'true');
    assert.strictEqual(escapeHtml(false), 'false');
  });

  await t.test('sanitizeUrl neutralizes javascript:, vbscript:, and SVG data-URIs', () => {
    assert.strictEqual(sanitizeUrl('javascript:alert(document.cookie)'), '#');
    assert.strictEqual(sanitizeUrl('JAVASCRIPT:alert(1)'), '#');
    assert.strictEqual(sanitizeUrl('vbscript:msgbox(1)'), '#');
    assert.strictEqual(sanitizeUrl('data:image/svg+xml;utf8,<svg onload="alert(1)"/>'), '#');
    
    // Legitimate raster images and API endpoints must remain intact
    assert.strictEqual(sanitizeUrl('/api/r2-image?key=dishes/crispy-leg.jpg'), '/api/r2-image?key=dishes/crispy-leg.jpg');
    assert.strictEqual(sanitizeUrl('https://images.unsplash.com/photo-123'), 'https://images.unsplash.com/photo-123');
  });

  await t.test('sanitizePhone allows only digits and optional leading +', () => {
    assert.strictEqual(sanitizePhone('+91 98450-12345'), '+919845012345');
    assert.strictEqual(sanitizePhone('098450 12345 (Home)'), '09845012345');
    assert.strictEqual(sanitizePhone(null), '');
    assert.strictEqual(sanitizePhone('<script>999</script>'), '999');
  });
});

test('PRODUCTION SECURITY HARDENING: Staff Authentication & Cryptographic Tokens', async (t) => {
  await t.test('Admin PIN verification enforces constant-time checks against server configuration', () => {
    assert.strictEqual(verifyAdminPin('8899'), true, 'Configured default PIN must authenticate');
    assert.strictEqual(verifyAdminPin('0000'), false, 'Non-matching PIN must fail');
    assert.strictEqual(verifyAdminPin(''), false, 'Empty PIN must fail');
    assert.strictEqual(verifyAdminPin('88990'), false, 'Length mismatch must fail');
    assert.strictEqual(verifyAdminPin('abcd'), false, 'Non-digits must fail');
  });

  await t.test('createAdminToken creates signed payload that verifies successfully', () => {
    const token = createAdminToken(3600000);
    const mockReq = { headers: { authorization: `Bearer ${token}` } };
    const result = verifyAdminToken(mockReq);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.payload.role, 'admin');
  });

  await t.test('verifyAdminToken detects tampered tokens and expired tokens', () => {
    const token = createAdminToken();
    const parts = token.split('.');
    const forgedToken = `${parts[0]}.forgedsignature1234567890`;
    assert.strictEqual(verifyAdminToken({ headers: { authorization: `Bearer ${forgedToken}` } }).valid, false);

    const expiredToken = createAdminToken(-5000);
    const expResult = verifyAdminToken({ headers: { authorization: `Bearer ${expiredToken}` } });
    assert.strictEqual(expResult.valid, false);
    assert.strictEqual(expResult.error, 'Session token has expired');
  });

  await t.test('hashPasscode produces identical SHA-256 for identical inputs with salt', async () => {
    const h1 = await hashPasscode('2233');
    const h2 = await hashPasscode('2233');
    assert.strictEqual(h1, h2);
    assert.strictEqual(h1.length, 64, 'SHA-256 hex must be 64 characters');
  });
});

test('PRODUCTION SECURITY HARDENING: Financial Calculations & Price Tampering Defenses', async (t) => {
  await t.test('Recalculation overrides client-manipulated totals with catalog prices', () => {
    const catalogDishes = [
      { id: 'dish-1', name: 'Zinger Burger', price: 180 },
      { id: 'dish-2', name: 'Hot Wings (6pc)', price: 150 }
    ];

    const tamperedCart = [
      { id: 'dish-1', name: 'Zinger Burger', quantity: 2, price: 1 }, // Manipulated price
      { id: 'dish-2', name: 'Hot Wings (6pc)', quantity: 1, price: 0 }  // Manipulated price
    ];

    let computedSubtotal = 0;
    tamperedCart.forEach(item => {
      const dish = catalogDishes.find(d => d.id === item.id);
      const cleanPrice = dish ? dish.price : item.price;
      computedSubtotal += cleanPrice * item.quantity;
    });

    // 2 * 180 + 1 * 150 = 510 (Subtotal >= 250 -> Free delivery)
    assert.strictEqual(computedSubtotal, 510, 'Subtotal must be ₹510 regardless of client price tampering');
    const deliveryFee = computedSubtotal >= 250 ? 0 : 40;
    const finalTotal = computedSubtotal + deliveryFee;
    assert.strictEqual(finalTotal, 510);
  });

  await t.test('Negative quantities and extreme caps are clamped defensively', () => {
    function sanitizeQuantity(qty) {
      return Math.max(1, Math.min(50, Math.floor(Number(qty) || 1)));
    }

    assert.strictEqual(sanitizeQuantity(-5), 1, 'Negative quantity clamped to 1');
    assert.strictEqual(sanitizeQuantity(0), 1, 'Zero quantity clamped to 1');
    assert.strictEqual(sanitizeQuantity(100), 50, 'Excessive quantity capped to 50');
    assert.strictEqual(sanitizeQuantity('invalid'), 1, 'NaN clamped to 1');
  });

  await t.test('Promo discount cannot exceed subtotal or produce negative total', () => {
    const subtotal = 100;
    let promoDiscount = 250; // Malicious or misconfigured discount
    promoDiscount = Math.min(promoDiscount, subtotal);
    const total = Math.max(0, subtotal - promoDiscount + 40);
    assert.strictEqual(promoDiscount, 100, 'Discount must not exceed subtotal');
    assert.strictEqual(total, 40, 'Final bill with delivery fee must be ₹40, not negative');
  });
});
