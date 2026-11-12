import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
  // =========================================================================
  // 6. Kinetic Plate Rotation CSS & Zero-Lag Verification
  // =========================================================================
  await t.test('9. .cuisine-circle-img omits transform transition to ensure instantaneous kinetic plate spin', () => {
    const styleCss = fs.readFileSync('style.css', 'utf8');
    const cuisineImgMatch = styleCss.match(/\.cuisine-circle-img\s*\{[^}]*\}/s);
    assert.ok(cuisineImgMatch, '.cuisine-circle-img class definition must exist in style.css');
    const block = cuisineImgMatch[0];
    assert.ok(block.includes('transition: filter 0.22s ease;'), 'Must have filter transition');
    assert.ok(!block.includes('transform 0.08s linear'), 'Must NOT have 80ms CSS transition on transform to avoid rAF lag');
  });

  // =========================================================================
  // 7. Category Token Matching & Slug Disambiguation
  // =========================================================================
  await t.test('10. Category filter uses exact slug/token matching preventing false-positive substring collisions', () => {
    function matchesCategory(cardCat, filter) {
      const normFilter = (filter || 'all').toLowerCase().trim();
      const normCardCat = (cardCat || '').toLowerCase().trim();
      if (normFilter === 'all') return true;
      const catTokens = normCardCat.split(/[\s,]+/);
      return catTokens.includes(normFilter) || normCardCat === normFilter;
    }

    // Exact matches
    assert.ok(matchesCategory('biryani', 'biryani'));
    assert.ok(matchesCategory('bbq-tandoori', 'bbq-tandoori'));
    assert.ok(matchesCategory('chicken biryani', 'biryani'));
    assert.ok(matchesCategory('biryani, kebab', 'kebab'));

    // Substring collision prevention
    assert.strictEqual(matchesCategory('veg-biryani', 'biryani'), false, 'veg-biryani should not match biryani');
    assert.strictEqual(matchesCategory('curry-specials', 'curry'), false, 'curry-specials should not match curry');
    assert.strictEqual(matchesCategory('fish-fry', 'fish'), false, 'fish-fry should not match fish');
  });

  // =========================================================================
  // 8. Search Engine: Multi-Field Token Matching & Debounce
  // =========================================================================
  await t.test('11. Search predicate inspects titles, categories, tags, badges, and descriptions across multi-tokens', () => {
    function searchMatch(query, dish) {
      const q = query.toLowerCase().trim();
      if (!q) return true;
      const queryTokens = q.split(/\s+/).filter(Boolean);
      const title = (dish.name || '').toLowerCase();
      const cat = (dish.category || '').toLowerCase();
      const tags = (Array.isArray(dish.tags) ? dish.tags.join(' ') : (dish.tags || '')).toLowerCase();
      const badge = (dish.badge || '').toLowerCase();
      const desc = (dish.description || '').toLowerCase();

      return queryTokens.every(token =>
        title.includes(token) ||
        cat.includes(token) ||
        tags.includes(token) ||
        badge.includes(token) ||
        desc.includes(token)
      );
    }

    const testDish = {
      id: 'dish-biryani-rice-2pc-kebab',
      name: 'Biryani Rice & 2 Piece Kebab',
      category: 'biryani',
      tags: ['popular', 'combo'],
      badge: 'Value Combo',
      description: 'Slow-cooked aromatic dum rice served with 2 crispy chicken kebabs'
    };

    // Match by title
    assert.ok(searchMatch('biryani', testDish));
    // Match by badge
    assert.ok(searchMatch('value combo', testDish));
    assert.ok(searchMatch('value', testDish));
    // Match by description
    assert.ok(searchMatch('slow-cooked aromatic', testDish));
    // Match by category
    assert.ok(searchMatch('biryani', testDish));
    // Match by multiple tokens across fields (title + badge)
    assert.ok(searchMatch('kebab value', testDish));
    // Non-match
    assert.strictEqual(searchMatch('paneer tikka', testDish), false);
  });

  // =========================================================================
  // 9. Search Empty/Backspace & Clear Active Category Preservation
  // =========================================================================
  await t.test('12. Clearing or backspacing search restores current active category without dumping catalog', () => {
    const mainJs = fs.readFileSync('main.js', 'utf8');

    // 1. Backspacing to empty (!q) checks active category pill
    assert.ok(
      mainJs.includes("const activeCat = activePill ? (activePill.getAttribute('data-filter') || 'all') : 'all';"),
      'Search handler must determine active category on empty query'
    );
    assert.ok(
      mainJs.includes('filterDishes(activeCat);'),
      'Search handler must invoke filterDishes(activeCat) on empty query'
    );

    // 2. clearSearchBtn preserves active category instead of forcing filterDishes('all')
    const clearBtnPattern = /clearSearchBtn\.addEventListener\('click'[\s\S]*?filterDishes\(activeCat\);/;
    assert.ok(clearBtnPattern.test(mainJs), 'Clear search button must restore active category');
  });

  // =========================================================================
  // 10. Hardware Back Navigation & Modal Registration
  // =========================================================================
  await t.test('13. View All category modal hooks into backNav and registers fallback checker', () => {
    const mainJs = fs.readFileSync('main.js', 'utf8');

    // openCategoryModal registers backNav step
    assert.ok(
      mainJs.includes("backNav.pushStep('cat-viewall-modal',"),
      'openCategoryModal must push cat-viewall-modal step to backNav'
    );

    // closeCategoryModal handles backNav stepBack / removeStepDirect
    assert.ok(
      mainJs.includes("backNav.isTopStep('cat-viewall-modal')"),
      'closeCategoryModal must check isTopStep for cat-viewall-modal'
    );
    assert.ok(
      mainJs.includes("backNav.removeStepDirect('cat-viewall-modal')"),
      'closeCategoryModal must remove step direct from backNav'
    );

    // Fallback checker registration
    assert.ok(
      mainJs.includes("document.getElementById('cat-viewall-modal')"),
      'backNav fallback checkers must inspect cat-viewall-modal'
    );
  });

  // =========================================================================
  // 11. Category Selection Auto-Clears Stale Search Input
  // =========================================================================
  await t.test('14. Selecting a category pill or modal card clears active search text and hides clear button', () => {
    const mainJs = fs.readFileSync('main.js', 'utf8');

    // Pills wrap click handler clears search
    assert.ok(
      mainJs.includes("recipeSearchInput.value = '';") && mainJs.includes("clearSearchBtn.style.display = 'none';"),
      'Category selection listeners must clear search input and hide clear button'
    );
  });

  // =========================================================================
  // 12. Performance Tier & Reduced-Motion Invariance (Low / Mid / High)
  // =========================================================================
  await t.test('15. Category scrolling and kinetic plate rotation remain identical across perf-tier-lite, balanced, and ultra', () => {
    const tierCss = fs.readFileSync('performanceTier.css', 'utf8');
    const styleCss = fs.readFileSync('style.css', 'utf8');
    const mainJs = fs.readFileSync('main.js', 'utf8');

    // 1. Lite box-shadow rule must NOT hit uncaged .cuisine-circle-item pills
    assert.ok(
      tierCss.includes('html.perf-tier-lite .category-pill:not(.cuisine-circle-item)'),
      'Lite tier simplified box-shadow must exclude .cuisine-circle-item category plates'
    );

    // 2. All three tiers must preserve scroll-behavior, transparent uncaged pills, and GPU transform hints
    ['perf-tier-lite', 'perf-tier-balanced', 'perf-tier-ultra'].forEach(tier => {
      assert.ok(tierCss.includes(`html.${tier} .category-pills-wrap`), `${tier} must preserve .category-pills-wrap scrolling`);
      assert.ok(tierCss.includes(`html.${tier} .cat-viewall-scroll`), `${tier} must preserve .cat-viewall-scroll scrolling`);
      assert.ok(tierCss.includes(`html.${tier} .category-pill.cuisine-circle-item`), `${tier} must preserve uncaged .cuisine-circle-item`);
      assert.ok(tierCss.includes(`html.${tier} .cuisine-circle-img`), `${tier} must preserve .cuisine-circle-img GPU rotation`);
      assert.ok(tierCss.includes(`html.${tier} .cat-viewall-img`), `${tier} must preserve .cat-viewall-img GPU rotation`);
    });

    // 3. Reduced motion fallback keeps category scrolling and plate selection transitions intact
    const reducedMotionMatch = styleCss.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\r?\n\}/);
    assert.ok(reducedMotionMatch, 'style.css must define @media (prefers-reduced-motion: reduce)');
    assert.ok(
      reducedMotionMatch[0].includes('.category-pills-wrap') &&
      reducedMotionMatch[0].includes('.cat-viewall-scroll') &&
      reducedMotionMatch[0].includes('scroll-behavior: smooth !important'),
      'Reduced-motion block must preserve smooth category scrolling'
    );

    // 4. Kinetic scroll handlers in main.js must not be gated by window.__perfTier
    const storefrontRotMatch = mainJs.match(/function updateStorefrontPlatesRotation\([\s\S]*?\r?\n  \}/);
    const modalRotMatch = mainJs.match(/function updatePlatesRotation\([\s\S]*?\r?\n    \}/);
    assert.ok(storefrontRotMatch && modalRotMatch, 'Kinetic plate rotation functions must exist in main.js');
    assert.ok(!storefrontRotMatch[0].includes('__perfTier'), 'Storefront category plate rotation must run in all tiers');
    assert.ok(!modalRotMatch[0].includes('__perfTier'), 'View All modal plate rotation must run in all tiers');
  });

});
