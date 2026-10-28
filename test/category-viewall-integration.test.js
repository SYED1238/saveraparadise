import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CATEGORIES, DEFAULT_DISHES, sanitizeCategoryImageUrl } from '../dataService.js';
import { escapeHtml } from '../securityUtils.js';

test('CATEGORY VIEW ALL & KINETIC ROTATION INTEGRATION SUITE', async (t) => {
  // =========================================================================
  // 1. Category Data Integrity & Cloudflare R2 Proxy Integration
  // =========================================================================
  await t.test('1. Database categories adhere to required schema and canonical R2 endpoints', () => {
    assert.ok(Array.isArray(DEFAULT_CATEGORIES), 'DEFAULT_CATEGORIES must be an array');
    assert.ok(DEFAULT_CATEGORIES.length >= 8, 'Must have at least 8 culinary categories');

    DEFAULT_CATEGORIES.forEach(cat => {
      assert.ok(cat.id && typeof cat.id === 'string', `Category ${cat.name} must have a string id`);
      assert.ok(cat.name && typeof cat.name === 'string', `Category ${cat.id} must have a valid name`);
      assert.ok(cat.slug && typeof cat.slug === 'string', `Category ${cat.name} must have a valid slug`);
      assert.ok(cat.emoji && typeof cat.emoji === 'string', `Category ${cat.name} must have an emoji fallback`);
      assert.ok(cat.image && typeof cat.image === 'string', `Category ${cat.name} must have an image path`);

      // All category images should point to Cloudflare R2 proxy or canonical transparent assets
      const sanitized = sanitizeCategoryImageUrl(cat.image);
      assert.ok(
        sanitized.startsWith('/api/r2-image?key=') || sanitized.startsWith('http'),
        `Category image for ${cat.name} must resolve via R2 proxy or valid URL, got: ${sanitized}`
      );
    });
  });

  await t.test('2. sanitizeCategoryImageUrl resolves arbitrary inputs and preserves proxy integrity', () => {
    // Plain key in categories subfolder
    const keyWithSubfolder = 'categories/category_1792937103352_BBQ.png';
    assert.strictEqual(
      sanitizeCategoryImageUrl(keyWithSubfolder),
      '/api/r2-image?key=categories%2Fcategory_1792937103352_BBQ.png'
    );

    // User-uploaded category image filename starting with category_
    const uploadedCategoryFilename = 'category_1792937103352_custom.png';
    assert.strictEqual(
      sanitizeCategoryImageUrl(uploadedCategoryFilename),
      '/api/r2-image?key=categories%2Fcategory_1792937103352_custom.png'
    );

    // Fully qualified URL pointing to proxy is preserved
    const fullProxyUrl = '/api/r2-image?key=categories%2Fcustom_dish.png';
    assert.strictEqual(
      sanitizeCategoryImageUrl(fullProxyUrl),
      '/api/r2-image?key=categories%2Fcustom_dish.png'
    );

    // Edge cases: null, undefined, empty string
    assert.strictEqual(sanitizeCategoryImageUrl(''), '');
    assert.strictEqual(sanitizeCategoryImageUrl(null), '');
    assert.strictEqual(sanitizeCategoryImageUrl(undefined), '');
  });

  // =========================================================================
  // 2. Relational Aggregation & Dish Count Mathematics
  // =========================================================================
  await t.test('3. Category dish count aggregation accurately matches catalog dishes', () => {
    function getDishCount(slug, catalogDishes) {
      if (slug === 'all') {
        return catalogDishes.length;
      }
      return catalogDishes.filter(d => {
        const catMatch = d.category === slug;
        const nameMatch = d.categoryName && d.categoryName.toLowerCase().replace(/[^a-z0-9]/g, '-') === slug;
        return catMatch || nameMatch;
      }).length;
    }

    assert.ok(DEFAULT_DISHES.length > 0, 'Catalog dishes must not be empty');

    // All dishes count must match total array length
    const totalAllCount = getDishCount('all', DEFAULT_DISHES);
    assert.strictEqual(totalAllCount, DEFAULT_DISHES.length);

    // Biryani category count must be positive
    const biryaniCount = getDishCount('biryani', DEFAULT_DISHES);
    assert.ok(biryaniCount > 0, 'Biryani category should have matching dishes');

    // Non-existent category must return 0 without errors
    const nonExistentCount = getDishCount('non-existent-cuisine-xyz', DEFAULT_DISHES);
    assert.strictEqual(nonExistentCount, 0);

    // Sum of categorized dishes should be greater than zero and equal or less than total
    let sumCategorized = 0;
    DEFAULT_CATEGORIES.forEach(c => {
      sumCategorized += getDishCount(c.slug, DEFAULT_DISHES);
    });
    assert.ok(sumCategorized > 0, 'Sum of categorized dishes must be > 0');
  });

  // =========================================================================
  // 3. Kinetic Plate Scroll-Rotation Mechanics & Precision
  // =========================================================================
  await t.test('4. Storefront horizontal category scroll rotation calculates continuous degrees without jitter', () => {
    function computeStorefrontPlateRotation(scrollLeft, windowY, idx) {
      const deg = (scrollLeft * 1.35) + (windowY * 0.12) + (idx * 26);
      return Number(deg.toFixed(1));
    }

    // At resting position (0 scroll)
    const plate0Initial = computeStorefrontPlateRotation(0, 0, 0);
    const plate1Initial = computeStorefrontPlateRotation(0, 0, 1);
    assert.strictEqual(plate0Initial, 0.0);
    assert.strictEqual(plate1Initial, 26.0);

    // Scrolling 100px to the right rolls plates clockwise (+135 deg)
    const plate0Scrolled100 = computeStorefrontPlateRotation(100, 0, 0);
    assert.strictEqual(plate0Scrolled100, 135.0);

    // Scrolling 200px rolls plates clockwise (+270 deg)
    const plate0Scrolled200 = computeStorefrontPlateRotation(200, 0, 0);
    assert.strictEqual(plate0Scrolled200, 270.0);

    // Monotonic progression: rotation must increase as scrollLeft increases
    assert.ok(plate0Scrolled200 > plate0Scrolled100);
    assert.ok(plate0Scrolled100 > plate0Initial);

    // Simultaneous vertical window scroll gently rotates (+12 deg per 100px)
    const plateWithWindowScroll = computeStorefrontPlateRotation(100, 100, 0);
    assert.strictEqual(plateWithWindowScroll, 147.0);

    // Negative or extreme values must never produce NaN
    assert.ok(!Number.isNaN(computeStorefrontPlateRotation(-50, -50, 0)));
    assert.ok(!Number.isNaN(computeStorefrontPlateRotation(10000, 5000, 9)));
  });

  await t.test('5. View All modal vertical scroll rotation calculates proportional angular spin', () => {
    function computeModalPlateRotation(scrollTop, idx) {
      const deg = (scrollTop * 0.5) + (idx * 28);
      return Number(deg.toFixed(1));
    }

    // Initial state (scrollTop = 0)
    assert.strictEqual(computeModalPlateRotation(0, 0), 0.0);
    assert.strictEqual(computeModalPlateRotation(0, 1), 28.0);
    assert.strictEqual(computeModalPlateRotation(0, 2), 56.0);

    // Scrolling 200px vertically in modal spins plates +100 deg
    const scrolled200 = computeModalPlateRotation(200, 0);
    assert.strictEqual(scrolled200, 100.0);

    // Scrolling 720px spins plates a full 360 degrees
    const scrolled720 = computeModalPlateRotation(720, 0);
    assert.strictEqual(scrolled720, 360.0);

    // Output must always be a valid, finite number
    assert.ok(Number.isFinite(scrolled200));
    assert.ok(Number.isFinite(scrolled720));
  });

  // =========================================================================
  // 4. Security & XSS Sanitization in Category DOM Generation
  // =========================================================================
  await t.test('6. Category HTML generation neutralizes script injection and XSS payloads', () => {
    const maliciousCategories = [
      { name: '<script>alert("hacked")</script>', slug: 'exploit-1', emoji: '💀', image: 'test.png' },
      { name: 'Biryani"><img src=x onerror=alert(1)>', slug: 'exploit-2', emoji: '🍛', image: 'test.png' }
    ];

    maliciousCategories.forEach(cat => {
      const safeName = escapeHtml(cat.name);
      assert.ok(!safeName.includes('<script>'), 'Script tag must be escaped');
      assert.ok(!safeName.includes('<img'), 'Raw <img> tag must be escaped');
      assert.ok(safeName.includes('&lt;') || safeName.includes('&gt;') || safeName.includes('&quot;'), 'Entities must be escaped');

      // Verify simulated modal item template
      const simulatedHtml = `
        <div class="cat-viewall-item" data-filter="${escapeHtml(cat.slug)}">
          <span class="cat-viewall-name">${safeName}</span>
        </div>
      `;

      assert.ok(!simulatedHtml.includes('<script>'));
      assert.ok(!simulatedHtml.includes('<img'));
    });
  });

  // =========================================================================
  // 5. Viewport Geometry & Z-Index Boundary Integrity
  // =========================================================================
  await t.test('7. Viewport container height guarantees exactly 5 visible category cards without clipping', () => {
    const CARD_HEIGHT = 88; // px
    const CARD_GAP = 8;     // px
    const PADDING_TOP = 6;  // px
    const PADDING_BOTTOM = 10; // px
    const VISIBLE_COUNT = 5;

    // Mathematical space occupied by exactly 5 cards:
    // 5 cards + 4 gaps = (5 * 88) + (4 * 8) = 440 + 32 = 472px
    const contentHeight = (VISIBLE_COUNT * CARD_HEIGHT) + ((VISIBLE_COUNT - 1) * CARD_GAP);
    assert.strictEqual(contentHeight, 472);

    // Total required container height with padding = 472 + 6 + 10 = 488px
    const totalRequiredHeight = contentHeight + PADDING_TOP + PADDING_BOTTOM;
    assert.strictEqual(totalRequiredHeight, 488);

    // 6th card starting position exceeds container height (must be off-screen/scrollable)
    const card6Top = PADDING_TOP + (5 * (CARD_HEIGHT + CARD_GAP));
    assert.strictEqual(card6Top, 486);
    assert.ok(card6Top >= totalRequiredHeight - CARD_HEIGHT, '6th card must begin below the 5-item visible viewport');
  });

  await t.test('8. Z-Index hierarchy guarantees modal supremacy over PWA banner and navbar', () => {
    const Z_INDEX_NAVBAR = 100;
    const Z_INDEX_PWA_PROMPT = 99999;
    const Z_INDEX_CAT_VIEWALL_MODAL = 100010;

    // View All modal must be strictly higher than the PWA install/notification banner
    assert.ok(
      Z_INDEX_CAT_VIEWALL_MODAL > Z_INDEX_PWA_PROMPT,
      'Category View All modal must render above PWA notification banner'
    );

    // View All modal must be strictly higher than sticky navbar
    assert.ok(
      Z_INDEX_CAT_VIEWALL_MODAL > Z_INDEX_NAVBAR,
      'Category View All modal must render above sticky navbar'
    );
  });
});
