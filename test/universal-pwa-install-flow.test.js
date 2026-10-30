import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  detectPlatformEnvironment,
  isAppAlreadyInstalled,
  getCurrentPortalType,
  getPortalConfig,
  openDirectlyInChrome,
  hasAutoInstallParam,
  cleanAutoInstallParam,
  triggerAppDownload
} from '../pwaInstallService.js';

test('UNIVERSAL PWA INSTALL FLOW INTEGRATION SUITE', async (t) => {
  const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf-8');
  const manifestJson = JSON.parse(fs.readFileSync(path.resolve('public/manifest.json'), 'utf-8'));
  const swJs = fs.readFileSync(path.resolve('public/sw.js'), 'utf-8');
  const pwaServiceJs = fs.readFileSync(path.resolve('pwaInstallService.js'), 'utf-8');
  const pwaCss = fs.readFileSync(path.resolve('pwa.css'), 'utf-8');

  // =========================================================================
  // 1. Standalone Detection (Hide When Installed)
  // =========================================================================
  await t.test('1. Standalone detection correctly detects standalone mode and suppresses install UI', () => {
    // In Node test runner without window, returns false gracefully
    assert.strictEqual(isAppAlreadyInstalled(), false);

    // Mock window with display-mode: standalone
    const originalWindow = globalThis.window;
    globalThis.window = {
      matchMedia: (query) => ({
        matches: query.includes('display-mode: standalone')
      }),
      navigator: { standalone: false }
    };
    assert.strictEqual(isAppAlreadyInstalled(), true, 'Must detect display-mode: standalone');

    // Mock iOS navigator.standalone === true
    globalThis.window = {
      matchMedia: () => ({ matches: false }),
      navigator: { standalone: true }
    };
    assert.strictEqual(isAppAlreadyInstalled(), true, 'Must detect window.navigator.standalone === true');

    // Mock regular browser tab
    globalThis.window = {
      matchMedia: () => ({ matches: false }),
      navigator: { standalone: false }
    };
    assert.strictEqual(isAppAlreadyInstalled(), false, 'Regular browser tab must not be flagged as installed');

    globalThis.window = originalWindow;
  });

  // =========================================================================
  // 2. Early beforeinstallprompt Global Capture
  // =========================================================================
  await t.test('2. index.html captures early beforeinstallprompt in window.__deferredPwaPrompt', () => {
    assert.match(
      indexHtml,
      /window\.__deferredPwaPrompt\s*=\s*e/,
      'index.html head script must save event to window.__deferredPwaPrompt early'
    );
    assert.match(
      indexHtml,
      /window\.addEventListener\(['"]beforeinstallprompt['"]/,
      'index.html head script must register early beforeinstallprompt listener'
    );
    assert.match(
      indexHtml,
      /window\.addEventListener\(['"]appinstalled['"]/,
      'index.html head script must listen to appinstalled event'
    );
  });

  // =========================================================================
  // 3. Platform & Browser Detection Logic
  // =========================================================================
  await t.test('3. detectPlatformEnvironment accurately isolates iOS in-app, Chrome, Safari & Android variants', () => {
    // 3.1 ios-inapp (Instagram / Facebook / WhatsApp)
    const iosInstagram = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 287.0.0.25.77';
    assert.strictEqual(detectPlatformEnvironment(iosInstagram), 'ios-inapp');

    const iosFacebook = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/417.0.0.33.65;]';
    assert.strictEqual(detectPlatformEnvironment(iosFacebook), 'ios-inapp');

    const iosWhatsApp = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/2.23.10.77';
    assert.strictEqual(detectPlatformEnvironment(iosWhatsApp), 'ios-inapp');

    // 3.2 ios-chrome (CriOS)
    const iosChrome = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/114.0.5735.99 Mobile/15E148 Safari/604.1';
    assert.strictEqual(detectPlatformEnvironment(iosChrome), 'ios-chrome');

    // 3.3 ios-safari (standard Safari)
    const iosSafari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';
    assert.strictEqual(detectPlatformEnvironment(iosSafari), 'ios-safari');

    // 3.4 android-other (Instagram / WhatsApp in-app or Samsung / Firefox / Opera / UC browsers)
    const androidInstagram = 'Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36 Instagram 278.0.0.19.115';
    assert.strictEqual(detectPlatformEnvironment(androidInstagram), 'android-other');

    const androidSamsung = 'Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/21.0 Chrome/110.0.5481.154 Mobile Safari/537.36';
    assert.strictEqual(detectPlatformEnvironment(androidSamsung), 'android-other');

    const androidFirefox = 'Mozilla/5.0 (Android 13; Mobile; rv:109.0) Gecko/114.0 Firefox/114.0';
    assert.strictEqual(detectPlatformEnvironment(androidFirefox), 'android-other');

    const androidOpera = 'Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36 OPR/74.0.3922.70977';
    assert.strictEqual(detectPlatformEnvironment(androidOpera), 'android-other');

    // 3.5 android-chrome (Standard Google Chrome on Android)
    const androidChrome = 'Mozilla/5.0 (Linux; Android 13; Pixel 7 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.5735.130 Mobile Safari/537.36';
    assert.strictEqual(detectPlatformEnvironment(androidChrome), 'android-chrome');

    // 3.6 desktop (macOS / Windows desktop Chrome)
    const desktopChrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36';
    assert.strictEqual(detectPlatformEnvironment(desktopChrome), 'desktop');
  });

  // =========================================================================
  // 4. Direct Chrome Activity, Hash Routing & IntentDispatcher Component
  // =========================================================================
  await t.test('4. openDirectlyInChrome preserves hash routes before ?autoInstall=true and forces IntentDispatcher component', () => {
    const originalWindow = globalThis.window;
    let redirectedUrl = '';

    globalThis.window = {
      location: {
        host: 'saveraparadise.foodbliz.in',
        pathname: '/',
        hash: '#/dilvery.html',
        set href(val) {
          redirectedUrl = val;
        },
        get href() {
          return redirectedUrl;
        }
      }
    };

    openDirectlyInChrome();

    // Verify ?autoInstall=true is placed BEFORE hash #/dilvery.html
    assert.ok(
      redirectedUrl.includes('saveraparadise.foodbliz.in/?autoInstall=true#/dilvery.html'),
      `Target path must place ?autoInstall=true before hash. Got: ${redirectedUrl}`
    );

    // Verify explicit action and IntentDispatcher component to prevent "Choose activity" dialog
    assert.ok(
      redirectedUrl.includes('action=android.intent.action.VIEW;'),
      `Intent must include VIEW action. Got: ${redirectedUrl}`
    );
    assert.ok(
      redirectedUrl.includes('package=com.android.chrome;'),
      `Intent must target com.android.chrome package. Got: ${redirectedUrl}`
    );
    assert.ok(
      redirectedUrl.includes('component=com.android.chrome/com.google.android.apps.chrome.IntentDispatcher;'),
      `Intent must target Chrome IntentDispatcher component. Got: ${redirectedUrl}`
    );
    assert.ok(
      redirectedUrl.includes('S.browser_fallback_url=https%3A%2F%2Fsaveraparadise.foodbliz.in%2F%3FautoInstall%3Dtrue%23%2Fdilvery.html;end'),
      `Intent must include properly encoded fallback URL. Got: ${redirectedUrl}`
    );

    globalThis.window = originalWindow;
  });

  // =========================================================================
  // 5. Detection & Clean-up of autoInstall in Search & Hash
  // =========================================================================
  await t.test('5. hasAutoInstallParam and cleanAutoInstallParam handle search and hash routing seamlessly', () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;

    // Test case A: ?autoInstall=true in search query
    let currentPath = '';
    globalThis.window = {
      location: {
        pathname: '/',
        search: '?autoInstall=true',
        hash: '#/dilvery.html'
      },
      history: {
        replaceState: (_state, _title, newPath) => {
          currentPath = newPath;
        }
      }
    };
    globalThis.document = { title: 'Savera Paradise' };

    assert.strictEqual(hasAutoInstallParam(), true, 'Must detect autoInstall in location.search');
    cleanAutoInstallParam();
    assert.strictEqual(currentPath, '/#/dilvery.html', 'Must clean search and retain hash');

    // Test case B: autoInstall=true in hash query
    globalThis.window.location = {
      pathname: '/',
      search: '',
      hash: '#/dilvery.html?autoInstall=true'
    };
    assert.strictEqual(hasAutoInstallParam(), true, 'Must detect autoInstall in location.hash');
    cleanAutoInstallParam();
    assert.strictEqual(currentPath, '/#/dilvery.html', 'Must clean hash param and retain route');

    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  });

  // =========================================================================
  // 6. Native Prompt Priority (Brave, Opera, Samsung Internet)
  // =========================================================================
  await t.test('6. triggerAppDownload prompts natively if beforeinstallprompt exists without redirecting', async () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;

    let promptCalled = false;
    let redirected = false;

    // Simulate Opera on Android with native beforeinstallprompt available
    const mockNavigator = {
      userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36 OPR/74.0.3922.70977',
      standalone: false
    };

    globalThis.document = {
      documentElement: { classList: { add: () => {}, remove: () => {} } },
      querySelectorAll: () => [],
      getElementById: () => null
    };

    globalThis.window = {
      matchMedia: () => ({ matches: false }),
      navigator: mockNavigator,
      __deferredPwaPrompt: {
        prompt: () => {
          promptCalled = true;
        },
        userChoice: Promise.resolve({ outcome: 'accepted' })
      },
      location: {
        host: 'saveraparadise.foodbliz.in',
        pathname: '/',
        hash: '',
        set href(_val) {
          redirected = true;
        }
      }
    };

    const outcome = await triggerAppDownload();

    assert.strictEqual(promptCalled, true, 'Must call prompt() directly when deferredPrompt exists');
    assert.strictEqual(redirected, false, 'Must NOT redirect when native install is supported in current browser');
    assert.strictEqual(outcome, 'accepted');

    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  });

  // =========================================================================
  // 7. Elimination of Old Chrome Guide Modal & Redirect Loop
  // =========================================================================
  await t.test('7. Old Chrome guide modal and redirect loop are completely eliminated', () => {
    // Verify that the old Chrome 3-dots step modal html does not exist in pwaServiceJs
    assert.doesNotMatch(
      pwaServiceJs,
      /Tap the <strong>three dots menu<\/strong>.*in Google Chrome/,
      'Old Chrome guide steps must be removed from install modal'
    );

    // Verify modal primary button does not contain the old intent:// redirect
    assert.doesNotMatch(
      pwaServiceJs,
      /primaryBtn\.addEventListener\('click'[\s\S]*intent:\/\/[\s\S]*package=com\.android\.chrome/,
      'Modal primary button must NOT trigger intent redirect loop'
    );

    // Verify Android Chrome without prompt provides menu toast feedback rather than looping
    assert.match(
      pwaServiceJs,
      /return 'chrome_menu_toast'/,
      'Android Chrome without prompt must return chrome_menu_toast rather than redirecting'
    );
  });

  // =========================================================================
  // 8. iOS Smart Guide modal includes browser-tailored visual steps with SVG badges
  // =========================================================================
  await t.test('8. iOS Smart Guide modal includes browser-tailored visual steps with SVG badges', () => {
    assert.match(pwaServiceJs, /ios-safari/, 'Must handle ios-safari tailored guide');
    assert.match(pwaServiceJs, /ios-chrome/, 'Must handle ios-chrome tailored guide');
    assert.match(pwaServiceJs, /ios-inapp/, 'Must handle ios-inapp tailored guide');

    // Safari steps
    assert.match(pwaServiceJs, /bottom center/, 'Safari guide must indicate bottom center for Share icon');
    assert.match(pwaServiceJs, /Add to Home Screen/, 'Must guide user to tap Add to Home Screen');

    // Chrome steps
    assert.match(pwaServiceJs, /top right/, 'Chrome iOS guide must indicate top right inside address bar');

    // In-app steps
    assert.match(pwaServiceJs, /Open in Safari/, 'In-app iOS guide must instruct opening in Safari first');

    // SVG Badges
    assert.match(pwaServiceJs, /ios-share-badge/, 'Must include ios-share-badge');
    assert.match(pwaServiceJs, /ios-plus-badge/, 'Must include ios-plus-badge');
    assert.match(pwaServiceJs, /ios-compass-badge/, 'Must include ios-compass-badge');
  });

  // =========================================================================
  // 9. Verification of index.html, manifest.json, sw.js & CSS
  // =========================================================================
  await t.test('9. index.html includes all required Apple PWA meta tags and icons', () => {
    assert.match(indexHtml, /<meta name="apple-mobile-web-app-capable" content="yes"/i, 'Must have apple-mobile-web-app-capable');
    assert.match(indexHtml, /<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"/i, 'Must have apple-mobile-web-app-status-bar-style');
    assert.match(indexHtml, /<meta name="apple-mobile-web-app-title" content="Savera Paradise"/i, 'Must have apple-mobile-web-app-title');
    assert.match(indexHtml, /<link rel="apple-touch-icon" href="\/icon-192\.png"/i, 'Must have apple-touch-icon 192 icon');
    assert.match(indexHtml, /<link rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png"/i, 'Must have 180x180 apple-touch-icon');
  });

  await t.test('10. manifest.json satisfies W3C PWA standards with separated icon purposes and root id', () => {
    assert.strictEqual(manifestJson.id, '/', 'Manifest id must be "/"');
    assert.strictEqual(manifestJson.start_url, '/', 'Manifest start_url must be "/"');
    assert.strictEqual(manifestJson.display, 'standalone', 'Manifest display must be "standalone"');

    // Ensure icons have separate entries for any and maskable (never combined as "any maskable")
    assert.ok(Array.isArray(manifestJson.icons), 'Manifest icons must be an array');
    const hasAny = manifestJson.icons.some(i => i.purpose === 'any');
    const hasMaskable = manifestJson.icons.some(i => i.purpose === 'maskable');
    const hasCombined = manifestJson.icons.some(i => i.purpose && i.purpose.includes('any') && i.purpose.includes('maskable'));

    assert.ok(hasAny, 'Manifest must include icons with purpose "any"');
    assert.ok(hasMaskable, 'Manifest must include icons with purpose "maskable"');
    assert.strictEqual(hasCombined, false, 'Manifest must NOT combine "any maskable" in one string (Samsung Internet compatibility)');
  });

  await t.test('11. sw.js includes valid fetch event listener for offline/caching installability criteria', () => {
    assert.match(swJs, /self\.addEventListener\(['"]fetch['"]/, 'Service Worker must have fetch event listener');
  });

  await t.test('12. pwa.css includes responsive bottom sheet, drag handle, and auto-install banner styles', () => {
    assert.match(pwaCss, /\.pwa-sheet-drag-handle/, 'Must style pwa-sheet-drag-handle');
    assert.match(pwaCss, /\.ios-share-badge/, 'Must style ios-share-badge');
    assert.match(pwaCss, /\.pwa-autoinstall-sheet/, 'Must style pwa-autoinstall-sheet');
    assert.match(pwaCss, /\.pwa-autoinstall-card/, 'Must style pwa-autoinstall-card');
    assert.match(pwaCss, /@keyframes pwa-sheet-slideup/, 'Must define slide-up animation for mobile bottom sheet');
  });
});
