/**
 * Savera Paradise Multi-App PWA Installation & Management Service
 * Universal PWA Install Flow:
 * 1. Early global beforeinstallprompt capture (window.__deferredPwaPrompt)
 * 2. Standalone detection (display-mode: standalone / navigator.standalone / appinstalled)
 * 3. Platform & Browser Detection:
 *    - 'ios-inapp'
 *    - 'ios-chrome'
 *    - 'ios-safari'
 *    - 'android-other'
 *    - 'android-chrome'
 *    - 'desktop'
 * 4. 3-Way Routing:
 *    - Case A: Native 1-click install (promptEvent.prompt())
 *    - Case B: Android non-Chrome / in-app (intent:// URL with ?autoInstall=true + Chrome Auto-Install Sheet)
 *    - Case C: iOS (Smart tailored bottom sheet guide with visual SVG icons)
 * 5. Auto-Install banner on Chrome when ?autoInstall=true is present with 1-tap install trigger and URL cleanup
 */

import {
  requestSystemNotificationPermission,
  sendSystemNotification,
  playNotificationSound,
  updateAppBadge,
  triggerDeviceVibration,
  getSystemNotificationPermission,
  isSystemNotificationSupported
} from './notificationService.js';

let deferredInstallPrompt = (typeof window !== 'undefined' && window.__deferredPwaPrompt) || null;

/**
 * Detects the active portal based on current pathname
 */
export function getCurrentPortalType() {
  if (typeof window === 'undefined') return 'storefront';
  const path = window.location.pathname.toLowerCase();
  if (path.includes('owner')) return 'owner';
  if (path.includes('admin')) return 'admin';
  if (path.includes('delivery')) return 'delivery';
  return 'storefront';
}

/**
 * Returns complete branding, URLs, and icons for the active portal
 */
export function getPortalConfig() {
  const type = getCurrentPortalType();
  if (type === 'admin') {
    return {
      type: 'admin',
      name: 'Savera Paradise Kitchen',
      fullName: 'Savera Paradise Kitchen Hub',
      shortName: 'Savera Admin',
      subtitle: 'Restaurant management, live kitchen orders & stock control',
      icon: '/icon-admin-192.svg',
      themeColor: '#0F172A',
      installToast: '🎉 Savera Paradise Kitchen Hub Installed Successfully!',
      welcomeTitle: '👨‍🍳 Savera Paradise Kitchen Hub Active!',
      welcomeBody: 'Kitchen beeper alarms, live orders & stock management active on your device.',
      welcomeTag: 'crispy-kitchen-welcome',
      startUrl: '/admin.html',
      notifPromptTitle: 'Turn on Kitchen Sound Alerts',
      notifPromptDesc: 'Get loud sound beeps & background alerts whenever a new order is placed.',
      featurePills: [
        { icon: '🚨', label: 'Beeper Alarms' },
        { icon: '⚡', label: 'Live Orders' },
        { icon: '📋', label: 'Menu & Stock' },
        { icon: '🔒', label: 'Passcode Safe' }
      ]
    };
  } else if (type === 'delivery') {
    return {
      type: 'delivery',
      name: 'Savera Paradise Rider',
      fullName: 'Savera Paradise Rider Partner App',
      shortName: 'Savera Rider',
      subtitle: 'Turn-by-turn navigation, live dispatch queue & COD tracking',
      icon: '/icon-rider-192.svg',
      themeColor: '#059669',
      installToast: '🎉 Savera Paradise Rider App Installed Successfully!',
      welcomeTitle: '🏍️ Savera Paradise Rider Partner App Active!',
      welcomeBody: 'Dispatch alerts, customer navigation & live COD cash tracking active on your device.',
      welcomeTag: 'crispy-rider-welcome',
      startUrl: '/delivery.html',
      notifPromptTitle: 'Turn on Rider Dispatch Alerts',
      notifPromptDesc: 'Get instant notifications for assigned deliveries, pickup calls & live navigation.',
      featurePills: [
        { icon: '🗺️', label: 'Turn Navigation' },
        { icon: '🔔', label: 'Dispatch Alerts' },
        { icon: '💵', label: 'COD Cash Pill' },
        { icon: '📞', label: 'Direct Call' }
      ]
    };
  } else if (type === 'owner') {
    return {
      type: 'owner',
      name: 'Savera Paradise Owner',
      fullName: 'Savera Paradise Owner Portal',
      shortName: 'Savera Owner',
      subtitle: 'Executive overview, live revenue, rider cash settlements & fleet payouts',
      icon: '/icon-owner-192.svg',
      themeColor: '#4338CA',
      installToast: '🎉 Savera Paradise Owner Portal Installed Successfully!',
      welcomeTitle: '👑 Savera Paradise Owner Portal Active!',
      welcomeBody: 'Live sales, cash settlements, and fleet payouts active on your device.',
      welcomeTag: 'savera-owner-welcome',
      startUrl: '/owner.html',
      notifPromptTitle: 'Turn on Owner Live Alerts',
      notifPromptDesc: 'Get instant alerts when cash handovers or orders are placed.',
      featurePills: [
        { icon: '📊', label: 'Live Sales' },
        { icon: '💵', label: 'COD Cash' },
        { icon: '🛵', label: 'Rider Fleet' },
        { icon: '🔒', label: 'PIN Safe' }
      ]
    };
  } else {
    return {
      type: 'storefront',
      name: 'Savera Paradise',
      fullName: 'Savera Paradise Food App',
      shortName: 'Savera Paradise',
      subtitle: 'Fast, standalone app with instant background alerts & hot food delivery',
      icon: '/icon-192.svg',
      themeColor: '#FF5A26',
      installToast: '🎉 Savera Paradise Web App Installed Successfully!',
      welcomeTitle: '🍗 Welcome to Savera Paradise!',
      welcomeBody: 'Live order tracking, kitchen prep alerts & rider updates are active on your device.',
      welcomeTag: 'crispy-app-welcome',
      startUrl: '/',
      notifPromptTitle: 'Turn on App Notifications',
      notifPromptDesc: 'Get instant order tracking, kitchen alerts & rider updates just like a real app.',
      featurePills: [
        { icon: '⚡', label: 'Instant Launch' },
        { icon: '🔔', label: 'Background Alerts' },
        { icon: '📦', label: '1-Tap Reorder' },
        { icon: '📶', label: 'Offline Ready' }
      ]
    };
  }
}

/**
 * Platform & Browser Detection Logic
 * Detects user's environment using navigator.userAgent:
 * - 'ios-inapp': iOS device inside in-app browser (Instagram|FBAN|FBAV|WhatsApp|Line|Snapchat)
 * - 'ios-chrome': iOS device using Chrome (CriOS)
 * - 'ios-safari': iOS device using Safari (or other iOS browsers)
 * - 'android-other': Android device inside in-app browser OR non-Chrome browsers (SamsungBrowser|OPR|Opera|Firefox|UCBrowser)
 * - 'android-chrome': Android device running standard Google Chrome
 * - 'desktop': Desktop / Laptop browsers
 */
export function detectPlatformEnvironment(customUa) {
  const ua = (customUa || (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '').trim();
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const isInApp = /Instagram|FBAN|FBAV|WhatsApp|Line\/|Snapchat/i.test(ua);

  if (isIOS) {
    if (isInApp) return 'ios-inapp';
    if (/CriOS/i.test(ua)) return 'ios-chrome';
    return 'ios-safari';
  }

  if (isAndroid) {
    const isNonChrome = /SamsungBrowser|OPR|Opera|Firefox|FxiOS|UCBrowser|DuckDuckGo|MiuiBrowser|HeyTapBrowser/i.test(ua);
    if (isInApp || isNonChrome) {
      return 'android-other';
    }
    if (/Chrome|CriOS/i.test(ua)) {
      return 'android-chrome';
    }
    return 'android-other';
  }

  return 'desktop';
}

/**
 * Standalone Detection (Hide When Installed)
 * Detects if the web app is already running in standalone mode using:
 * window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
 */
export function isAppAlreadyInstalled() {
  if (typeof window === 'undefined') return false;
  return !!(
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    window.navigator.standalone === true ||
    (typeof document !== 'undefined' && document.referrer && document.referrer.includes('android-app://'))
  );
}

export function hideAllInstallButtons() {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.add('pwa-customer-installed');
  if (document.body) document.body.classList.add('pwa-customer-installed');
  const allBtns = document.querySelectorAll(
    '#btn-download-app, #btn-mobile-download-app, #btn-admin-download-app, #btn-rider-download-app, .header-pwa-dock, .admin-pwa-dock, .rider-pwa-dock, .mobile-download-item'
  );
  allBtns.forEach(el => el.style.setProperty('display', 'none', 'important'));
}

export function showAllInstallButtons() {
  if (typeof document === 'undefined') return;
  const type = getCurrentPortalType();
  // Only the main customer storefront displays install/download buttons
  if (type !== 'storefront' && type !== 'customer') {
    hideAllInstallButtons();
    return;
  }
  if (isAppAlreadyInstalled()) {
    hideAllInstallButtons();
    return;
  }

  document.documentElement.classList.remove('pwa-customer-installed');
  if (document.body) document.body.classList.remove('pwa-customer-installed');
  const customerBtns = document.querySelectorAll('#btn-download-app, #btn-mobile-download-app, .header-pwa-dock, .mobile-download-item');
  customerBtns.forEach(el => el.style.removeProperty('display'));
}

export function autoBindDownloadButtons() {
  if (typeof document === 'undefined') return;
  const type = getCurrentPortalType();
  if (type !== 'storefront' && type !== 'customer') {
    hideAllInstallButtons();
    return;
  }
  if (isAppAlreadyInstalled()) {
    hideAllInstallButtons();
    return;
  }
  showAllInstallButtons();
  const btns = document.querySelectorAll(
    '.btn-app-download-compact, .btn-download-app, #btn-download-app, #btn-mobile-download-app, .mobile-download-item'
  );
  btns.forEach(btn => setupAppDownloadButton(btn));
}

/**
 * Activates real-native app notifications
 */
export async function enableAppNotificationsWithWelcome() {
  if (!isSystemNotificationSupported()) {
    showPwaToast('Push notifications are not supported on this browser.', 'warning');
    return false;
  }

  const portalConfig = getPortalConfig();

  try {
    const perm = await requestSystemNotificationPermission();
    if (perm === 'granted') {
      playNotificationSound(portalConfig.type === 'admin' ? 'new_order' : 'order_placed');
      triggerDeviceVibration([180, 90, 180, 90, 240]);
      updateAppBadge(0);

      sendSystemNotification({
        title: portalConfig.welcomeTitle,
        body: portalConfig.welcomeBody,
        icon: portalConfig.icon,
        tag: portalConfig.welcomeTag,
        data: { url: portalConfig.startUrl }
      });

      hideAppNotificationPromptBanner();
      showPwaToast(`🔔 ${portalConfig.name} Notifications Enabled! Live alerts active.`, 'success');
      try {
        localStorage.setItem(`quickbite_notif_prompt_answered_${portalConfig.type}`, 'true');
      } catch {}
      return true;
    } else if (perm === 'denied') {
      hideAppNotificationPromptBanner();
      showPwaToast('Notifications are blocked in your browser settings.', 'warning');
      try {
        localStorage.setItem(`quickbite_notif_prompt_answered_${portalConfig.type}`, 'true');
      } catch {}
      return false;
    }
  } catch (err) {
    console.warn('[PWA] Notification enable error:', err);
  }
  return false;
}

export function hideAppNotificationPromptBanner() {
  const banner = document.getElementById('app-notification-prompt-banner');
  if (banner) {
    banner.classList.remove('show');
    setTimeout(() => {
      banner.remove();
    }, 400);
  }
}

/**
 * Shows an elegant non-intrusive floating card inviting the user to enable native app notifications.
 */
export function checkAndPromptAppNotifications() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!isSystemNotificationSupported()) return;

  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return;
  }

  const portalConfig = getPortalConfig();

  try {
    const dismissedTime = localStorage.getItem(`quickbite_notif_prompt_dismissed_${portalConfig.type}`);
    if (dismissedTime && Date.now() - Number(dismissedTime) < 3 * 24 * 60 * 60 * 1000) {
      return;
    }
  } catch {}

  if (document.getElementById('app-notification-prompt-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'app-notification-prompt-banner';
  banner.className = 'app-notification-prompt-banner';
  banner.setAttribute('role', 'alert');

  banner.innerHTML = `
    <div class="prompt-icon-ring">
      <i class="fa-solid fa-bell"></i>
    </div>
    <div class="prompt-text-group">
      <h4>${portalConfig.notifPromptTitle}</h4>
      <p>${portalConfig.notifPromptDesc}</p>
    </div>
    <div class="prompt-actions-group">
      <button type="button" class="btn-prompt-enable" id="btn-prompt-enable-notif">
        <i class="fa-solid fa-bell"></i> Enable
      </button>
      <button type="button" class="btn-prompt-dismiss" id="btn-prompt-dismiss-notif" aria-label="Dismiss">✕</button>
    </div>
  `;

  document.body.appendChild(banner);

  requestAnimationFrame(() => {
    setTimeout(() => {
      banner.classList.add('show');
    }, 150);
  });

  const btnEnable = banner.querySelector('#btn-prompt-enable-notif');
  if (btnEnable) {
    btnEnable.addEventListener('click', async () => {
      await enableAppNotificationsWithWelcome();
    });
  }

  const btnDismiss = banner.querySelector('#btn-prompt-dismiss-notif');
  if (btnDismiss) {
    btnDismiss.addEventListener('click', () => {
      try {
        localStorage.setItem(`quickbite_notif_prompt_dismissed_${portalConfig.type}`, Date.now().toString());
      } catch {}
      hideAppNotificationPromptBanner();
    });
  }
}

/**
 * Direct Chrome Activity & Hash URL Routing:
 * Places ?autoInstall=true BEFORE any hash route (e.g. domain.com/?autoInstall=true#/dilvery.html)
 * and sets explicit IntentDispatcher component & VIEW action to prevent the Android "Choose activity" dialog.
 */
export const openDirectlyInChrome = () => {
  if (typeof window === 'undefined') return;
  const { host, pathname, hash } = window.location;
  const targetPath = `${host}${pathname}?autoInstall=true${hash || ''}`;
  const fallbackUrl = encodeURIComponent(`https://${targetPath}`);
  window.location.href = `intent://${targetPath}#Intent;scheme=https;action=android.intent.action.VIEW;package=com.android.chrome;component=com.android.chrome/com.google.android.apps.chrome.IntentDispatcher;S.browser_fallback_url=${fallbackUrl};end`;
};

/**
 * Detects if ?autoInstall=true is present in location.search OR location.hash
 */
export function hasAutoInstallParam() {
  if (typeof window === 'undefined') return false;
  try {
    const searchParams = new URLSearchParams(window.location.search || '');
    if (searchParams.get('autoInstall') === 'true') return true;
    const hash = window.location.hash || '';
    if (hash.includes('autoInstall=true')) return true;
  } catch {}
  return false;
}

/**
 * Strips autoInstall=true from location.search and location.hash without page reload
 */
export function cleanAutoInstallParam() {
  if (typeof window === 'undefined') return;
  try {
    let search = window.location.search || '';
    let hash = window.location.hash || '';
    let modified = false;

    if (search.includes('autoInstall=true')) {
      const sp = new URLSearchParams(search);
      sp.delete('autoInstall');
      const rest = sp.toString();
      search = rest ? `?${rest}` : '';
      modified = true;
    }

    if (hash.includes('autoInstall=true')) {
      hash = hash
        .replace(/([?&])autoInstall=true(&?)/g, (match, prefix, suffix) => {
          if (prefix === '?' && suffix === '&') return '?';
          return '';
        })
        .replace(/[?&]$/, '');
      modified = true;
    }

    if (modified) {
      const newPath = (window.location.pathname || '/') + search + hash;
      window.history.replaceState({}, document.title, newPath);
    }
  } catch (err) {
    console.warn('[PWA] cleanAutoInstallParam error:', err);
  }
}

/**
 * Auto-Install Banner in Chrome:
 * When page loads in Chrome with ?autoInstall=true (in search or hash), automatically show a prominent
 * bottom sheet saying "Tap below to finish installing the app" with a 1-tap button.
 * Cleans up ?autoInstall=true via window.history.replaceState.
 */
export function checkAndTriggerAutoInstall() {
  if (typeof window === 'undefined') return;
  if (isAppAlreadyInstalled()) return;

  try {
    if (hasAutoInstallParam()) {
      cleanAutoInstallParam();

      setTimeout(() => {
        showAutoInstallBanner();
      }, 500);
    }
  } catch (err) {
    console.warn('[PWA] checkAndTriggerAutoInstall error:', err);
  }
}

export function showAutoInstallBanner() {
  if (typeof document === 'undefined') return;
  if (isAppAlreadyInstalled()) return;
  if (document.getElementById('pwa-autoinstall-sheet')) return;

  const portalConfig = getPortalConfig();
  const banner = document.createElement('div');
  banner.id = 'pwa-autoinstall-sheet';
  banner.className = 'pwa-autoinstall-sheet';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-modal', 'true');
  banner.setAttribute('aria-label', 'Finish App Installation');

  banner.innerHTML = `
    <div class="pwa-autoinstall-card">
      <button type="button" class="pwa-autoinstall-close" id="btn-close-autoinstall" aria-label="Dismiss">✕</button>
      <div class="pwa-autoinstall-header">
        <div class="pwa-app-icon-wrap" style="width: 52px; height: 52px;">
          <img src="${portalConfig.icon}" alt="${portalConfig.name} Icon" class="pwa-modal-app-icon" style="width: 100%; height: 100%; border-radius: 14px;">
          <span class="pwa-verified-badge" style="width: 18px; height: 18px; font-size: 0.6rem;"><i class="fa-solid fa-check"></i></span>
        </div>
        <div class="pwa-autoinstall-info">
          <h4>Tap below to finish installing the app</h4>
          <p>Add ${portalConfig.name} to your Home Screen for instant 1-tap launch &amp; live orders.</p>
        </div>
      </div>
      <div class="pwa-autoinstall-actions">
        <button type="button" class="btn btn-pwa-primary pwa-autoinstall-btn" id="btn-pwa-autoinstall-confirm">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <span>Install ${portalConfig.shortName} Now</span>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(banner);
  requestAnimationFrame(() => {
    setTimeout(() => {
      banner.classList.add('show');
    }, 100);
  });

  const closeBtn = banner.querySelector('#btn-close-autoinstall');
  if (closeBtn) {
    closeBtn.addEventListener('click', hideAutoInstallBanner);
  }

  const confirmBtn = banner.querySelector('#btn-pwa-autoinstall-confirm');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', async () => {
      const promptEvent = deferredInstallPrompt || (typeof window !== 'undefined' ? window.__deferredPwaPrompt : null);
      if (promptEvent) {
        try {
          promptEvent.prompt();
          const choice = await promptEvent.userChoice;
          if (choice && choice.outcome === 'accepted') {
            hideAutoInstallBanner();
            hideAllInstallButtons();
            setTimeout(() => {
              enableAppNotificationsWithWelcome();
            }, 1200);
          }
        } catch (err) {
          console.warn('[PWA] Auto-install prompt failed:', err);
        }
      } else {
        hideAutoInstallBanner();
        showPwaToast(`Tap the three dots (⋮) in Chrome and select "Install app" or "Add to Home Screen"`, 'info');
      }
    });
  }
}

export function hideAutoInstallBanner() {
  const banner = document.getElementById('pwa-autoinstall-sheet');
  if (banner) {
    banner.classList.remove('show');
    setTimeout(() => {
      banner.remove();
    }, 350);
  }
}

export function initPwaInstallService() {
  if (typeof window === 'undefined') return;

  const portalConfig = getPortalConfig();

  // Pick up early captured prompt if window.__deferredPwaPrompt was populated by index.html
  if (window.__deferredPwaPrompt && !deferredInstallPrompt) {
    deferredInstallPrompt = window.__deferredPwaPrompt;
  }

  // Clean up any legacy localStorage flags so reinstallation is never blocked
  try {
    if (!isAppAlreadyInstalled()) {
      localStorage.removeItem(`quickbite_pwa_installed_${portalConfig.type}`);
      localStorage.removeItem('quickbite_pwa_installed');
    }
  } catch {}

  if (isAppAlreadyInstalled()) {
    hideAllInstallButtons();
  } else {
    showAllInstallButtons();
  }

  // Auto-bind on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      autoBindDownloadButtons();
      checkAndTriggerAutoInstall();
    });
  } else {
    autoBindDownloadButtons();
    checkAndTriggerAutoInstall();
  }

  // Capture early / subsequent beforeinstallprompt event globally
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    window.__deferredPwaPrompt = e;
    try {
      localStorage.removeItem(`quickbite_pwa_installed_${portalConfig.type}`);
      localStorage.removeItem('quickbite_pwa_installed');
    } catch {}
    if (!isAppAlreadyInstalled()) {
      showAllInstallButtons();
      autoBindDownloadButtons();
    }
  });

  // App installed event -> hide all banners & install buttons
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    window.__deferredPwaPrompt = null;
    hideAllInstallButtons();
    hideAutoInstallBanner();
    closePwaInstallModal();
    const config = getPortalConfig();
    showPwaToast(config.installToast, 'success');
    setTimeout(() => {
      enableAppNotificationsWithWelcome();
    }, 1200);
  });

  // Check if native notifications need onboarding prompt
  setTimeout(() => {
    checkAndPromptAppNotifications();
  }, 2200);
}

if (typeof window !== 'undefined') {
  initPwaInstallService();
}

/**
 * Main trigger function called when any "Install App" / "Download App" button is clicked
 * Implements 3-Way Routing:
 * - Case A: Native 1-Click Install Available (deferredPrompt exists)
 * - Case B: Android Non-Chrome or In-App Browser (Auto-redirect to Chrome via intent://)
 * - Case C: iPhone / iPad (Smart tailored iOS bottom sheet guide)
 */
export async function triggerAppDownload({ onInstalled, onCancel } = {}) {
  const portalConfig = getPortalConfig();

  // Standalone detection: hide when installed
  if (isAppAlreadyInstalled()) {
    hideAllInstallButtons();
    showPwaToast(`✅ ${portalConfig.name} is already installed and running in app mode!`, 'success');
    return 'already_installed';
  }

  // Case A — Native 1-Click Install Available (deferredPrompt exists)
  const promptEvent = deferredInstallPrompt || (typeof window !== 'undefined' ? window.__deferredPwaPrompt : null);
  if (promptEvent) {
    try {
      promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice && choice.outcome === 'accepted') {
        deferredInstallPrompt = null;
        if (typeof window !== 'undefined') window.__deferredPwaPrompt = null;
        hideAllInstallButtons();
        closePwaInstallModal();
        hideAutoInstallBanner();
        if (typeof onInstalled === 'function') onInstalled();
        setTimeout(() => {
          enableAppNotificationsWithWelcome();
        }, 1200);
      } else {
        if (typeof onCancel === 'function') onCancel();
      }
      return choice ? choice.outcome : 'prompt_shown';
    } catch (err) {
      console.warn('[PWA] Prompt error:', err);
    }
  }

  // Detect platform & browser environment
  const env = detectPlatformEnvironment();

  // Case C — iPhone / iPad (ios-safari, ios-chrome, ios-inapp)
  if (env.startsWith('ios-')) {
    openPwaInstallModal(env);
    return 'ios_modal_opened';
  }

  // Case B — Android environments without native prompt:
  // If already inside Google Chrome on Android, DO NOT loop/redirect to Chrome via intent
  if (env === 'android-chrome') {
    showPwaToast(`Tap the three dots (⋮) in Chrome and select "Install app" or "Add to Home Screen"`, 'info');
    return 'chrome_menu_toast';
  }

  // If on Android inside an in-app browser (Instagram/WhatsApp/FB) or non-Chrome browser without prompt:
  // Open directly in Google Chrome with explicit component to prevent "Choose activity" dialog
  if (env === 'android-other') {
    openDirectlyInChrome();
    return 'android_redirected';
  }

  // Desktop or generic browser without deferredPrompt
  openPwaInstallModal('desktop');
  return 'desktop_modal_opened';
}

/**
 * Creates and opens the PWA Installation Guide Modal tailored to the platform and browser
 */
export function openPwaInstallModal(forcedEnv) {
  if (typeof document === 'undefined') return;
  let modal = document.getElementById('pwa-install-modal-backdrop');
  if (modal) {
    modal.remove();
  }
  const env = forcedEnv || detectPlatformEnvironment();
  modal = createPwaInstallModalElement(env);
  document.body.appendChild(modal);

  modal.classList.add('open');
  modal.style.display = 'flex';
}

export function closePwaInstallModal() {
  if (typeof document === 'undefined') return;
  const modal = document.getElementById('pwa-install-modal-backdrop');
  if (modal) {
    modal.classList.remove('open');
    setTimeout(() => {
      modal.style.display = 'none';
    }, 250);
  }
}

function createPwaInstallModalElement(env = detectPlatformEnvironment()) {
  const isIOS = env.startsWith('ios-');
  const portalConfig = getPortalConfig();

  const container = document.createElement('div');
  container.id = 'pwa-install-modal-backdrop';
  container.className = `pwa-install-backdrop ${isIOS ? 'pwa-backdrop-ios-sheet' : ''}`;
  container.style.display = 'none';

  const featurePillsHtml = portalConfig.featurePills.map(p => `
    <div class="pwa-feature-pill">
      <span class="feat-icon">${p.icon}</span>
      <span>${p.label}</span>
    </div>
  `).join('');

  // Tailored steps based on platform environment
  let stepsHtml = '';
  let subtitleText = portalConfig.subtitle;

  if (env === 'ios-safari') {
    subtitleText = 'Follow these 3 quick steps in Safari on your iPhone';
    stepsHtml = `
      <div class="install-step-item">
        <span class="step-num">1</span>
        <div class="step-desc">
          Tap the <strong>Share</strong> icon
          <span class="ios-share-badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
              <polyline points="16 6 12 2 8 6"></polyline>
              <line x1="12" y1="2" x2="12" y2="15"></line>
            </svg>
            Share
          </span>
          at the <strong>bottom center</strong> of your screen.
        </div>
      </div>
      <div class="install-step-item">
        <span class="step-num">2</span>
        <div class="step-desc">
          Scroll down and tap <strong>"Add to Home Screen"</strong>
          <span class="ios-plus-badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="4" ry="4"></rect>
              <line x1="12" y1="8" x2="12" y2="16"></line>
              <line x1="8" y1="12" x2="16" y2="12"></line>
            </svg>
            Add
          </span>
        </div>
      </div>
      <div class="install-step-item">
        <span class="step-num">3</span>
        <div class="step-desc">
          Tap <strong>"Add"</strong> in the top right corner. ${portalConfig.name} will appear on your Home Screen!
        </div>
      </div>
    `;
  } else if (env === 'ios-chrome') {
    subtitleText = 'Follow these 3 quick steps in Chrome on iOS';
    stepsHtml = `
      <div class="install-step-item">
        <span class="step-num">1</span>
        <div class="step-desc">
          Tap the <strong>Share</strong> icon
          <span class="ios-share-badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
              <polyline points="16 6 12 2 8 6"></polyline>
              <line x1="12" y1="2" x2="12" y2="15"></line>
            </svg>
            Share
          </span>
          at the <strong>top right</strong> inside the address bar.
        </div>
      </div>
      <div class="install-step-item">
        <span class="step-num">2</span>
        <div class="step-desc">
          Scroll down and tap <strong>"Add to Home Screen"</strong>
          <span class="ios-plus-badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="4" ry="4"></rect>
              <line x1="12" y1="8" x2="12" y2="16"></line>
              <line x1="8" y1="12" x2="16" y2="12"></line>
            </svg>
            Add
          </span>
        </div>
      </div>
      <div class="install-step-item">
        <span class="step-num">3</span>
        <div class="step-desc">
          Tap <strong>"Add"</strong> in the top right corner to finish installing!
        </div>
      </div>
    `;
  } else if (env === 'ios-inapp') {
    subtitleText = 'Open in Safari to add to your iPhone Home Screen';
    stepsHtml = `
      <div class="install-step-item">
        <span class="step-num">1</span>
        <div class="step-desc">
          Tap the <strong>•••</strong> menu or <strong>Safari compass icon</strong>
          <span class="ios-compass-badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon>
            </svg>
            Safari
          </span>
          at the bottom right to <strong>Open in Safari</strong> first.
        </div>
      </div>
      <div class="install-step-item">
        <span class="step-num">2</span>
        <div class="step-desc">
          In Safari, tap the <strong>Share</strong> icon &rarr; tap <strong>"Add to Home Screen"</strong>.
        </div>
      </div>
      <div class="install-step-item">
        <span class="step-num">3</span>
        <div class="step-desc">
          Tap <strong>"Add"</strong> in the top right corner to install ${portalConfig.name}!
        </div>
      </div>
    `;
  } else {
    stepsHtml = `
      <div class="install-step-item">
        <span class="step-num">1</span>
        <div class="step-desc">
          Click the <strong>Install icon</strong> <i class="fa-solid fa-download"></i> in your browser's address bar.
        </div>
      </div>
      <div class="install-step-item">
        <span class="step-num">2</span>
        <div class="step-desc">
          Or click the <strong>3-dots browser menu</strong> ➔ <strong>"Install ${portalConfig.name}"</strong>.
        </div>
      </div>
      <div class="install-step-item">
        <span class="step-num">3</span>
        <div class="step-desc">
          Confirm <strong>"Install"</strong> to launch in standalone window mode!
        </div>
      </div>
    `;
  }

  const promptAvailable = !!(deferredInstallPrompt || (typeof window !== 'undefined' && window.__deferredPwaPrompt));
  const primaryBtnText = isIOS
    ? 'Got It / Close'
    : (promptAvailable ? `Download & Install ${portalConfig.shortName}` : 'I Understand / Add to Home Screen');

  container.innerHTML = `
    <div class="pwa-install-modal ${isIOS ? 'pwa-modal-ios-sheet' : ''}" role="dialog" aria-modal="true" aria-labelledby="pwa-modal-title">
      <div class="pwa-sheet-drag-handle" aria-hidden="true"></div>
      <button type="button" class="pwa-modal-close" id="btn-close-pwa-modal" aria-label="Close modal">✕</button>

      <div class="pwa-modal-header">
        <div class="pwa-app-icon-wrap">
          <img src="${portalConfig.icon}" alt="${portalConfig.name} App Icon" class="pwa-modal-app-icon">
          <span class="pwa-verified-badge"><i class="fa-solid fa-check"></i></span>
        </div>
        <div class="pwa-modal-title-group">
          <h3 id="pwa-modal-title">Install ${portalConfig.fullName}</h3>
          <p class="pwa-modal-subtitle">${subtitleText}</p>
        </div>
      </div>

      <div class="pwa-features-grid">
        ${featurePillsHtml}
      </div>

      <div class="pwa-install-steps">
        ${stepsHtml}
      </div>

      <div class="pwa-modal-footer">
        <button type="button" class="btn btn-pwa-primary" id="btn-pwa-modal-primary">
          <i class="fa-solid fa-cloud-arrow-down"></i>
          <span>${primaryBtnText}</span>
        </button>
      </div>
    </div>
  `;

  container.addEventListener('click', (e) => {
    if (e.target === container) closePwaInstallModal();
  });

  const closeBtn = container.querySelector('#btn-close-pwa-modal');
  if (closeBtn) closeBtn.addEventListener('click', closePwaInstallModal);

  const primaryBtn = container.querySelector('#btn-pwa-modal-primary');
  if (primaryBtn) {
    primaryBtn.addEventListener('click', async () => {
      const promptEvent = deferredInstallPrompt || (typeof window !== 'undefined' ? window.__deferredPwaPrompt : null);
      if (promptEvent && !isIOS) {
        try {
          promptEvent.prompt();
          const choice = await promptEvent.userChoice;
          if (choice && choice.outcome === 'accepted') {
            hideAllInstallButtons();
            closePwaInstallModal();
            setTimeout(() => {
              enableAppNotificationsWithWelcome();
            }, 1200);
          }
          deferredInstallPrompt = null;
          if (typeof window !== 'undefined') window.__deferredPwaPrompt = null;
        } catch {}
      } else {
        closePwaInstallModal();
      }
    });
  }

  return container;
}

function showPwaToast(message, type = 'info') {
  if (typeof document === 'undefined') return;
  const container = document.querySelector('.toast-container') || document.body;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type} show`;
  toast.style.cssText = 'position:fixed;bottom:24px;left:24px;z-index:99999;background:#181512;color:#FFF;padding:14px 20px;border-radius:999px;box-shadow:0 10px 30px rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.15);display:flex;align-items:center;gap:10px;font-weight:600;';
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4000);
}

/**
 * Hooks up any download button element by ID or selector
 */
export function setupAppDownloadButton(buttonElement) {
  if (!buttonElement) return;

  if (isAppAlreadyInstalled()) {
    buttonElement.style.setProperty('display', 'none', 'important');
    return;
  }

  buttonElement.style.removeProperty('display');

  if (buttonElement._hasPwaClickListener) return;
  buttonElement._hasPwaClickListener = true;

  buttonElement.addEventListener('click', (e) => {
    e.preventDefault();
    const portalConfig = getPortalConfig();
    triggerAppDownload({
      onInstalled: () => {
        hideAllInstallButtons();
        showPwaToast(portalConfig.installToast, 'success');
      }
    });
  });
}
