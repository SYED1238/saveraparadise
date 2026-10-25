/**
 * Crispy Chicken Multi-App PWA Installation & Management Service
 * Supports 3 completely separate, independently installable Web Apps:
 * 1. Crispy Chicken (Customer Food App, scope: /)
 * 2. Crispy Kitchen (Restaurant Control Hub, scope: /admin.html)
 * 3. Crispy Rider (Delivery Partner App, scope: /delivery.html)
 *
 * Each portal has:
 * - Dedicated Web App Manifest & unique Manifest ID
 * - Unique Theme Color & Icon Set
 * - Dedicated start URL and scope isolation
 * - Portal-specific install guide modal, welcome notification & haptic alerts
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

let deferredInstallPrompt = null;

/**
 * Detects the active portal based on current pathname
 */
export function getCurrentPortalType() {
  if (typeof window === 'undefined') return 'storefront';
  const path = window.location.pathname.toLowerCase();
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
 * Checks if the current portal is running inside a standalone PWA window.
 * Returns false if the user is visiting via Chrome, Safari, Edge, or web browser tabs,
 * allowing them to install (or re-install if previously removed).
 */
export function isAppAlreadyInstalled() {
  if (typeof window === 'undefined') return false;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                       window.navigator.standalone === true ||
                       document.referrer.includes('android-app://');
  if (!isStandalone) return false;

  const type = getCurrentPortalType();
  const path = window.location.pathname.toLowerCase();
  if (type === 'admin') {
    return path.includes('admin');
  }
  if (type === 'delivery') {
    return path.includes('delivery');
  }
  return !path.includes('admin') && !path.includes('delivery');
}

export function hideAllInstallButtons() {
  if (typeof document === 'undefined') return;
  const type = getCurrentPortalType();

  if (type === 'admin') {
    document.documentElement.classList.add('pwa-admin-installed');
    document.body.classList.add('pwa-admin-installed');
    const adminBtns = document.querySelectorAll('#btn-admin-download-app, .admin-pwa-dock');
    adminBtns.forEach(el => el.style.setProperty('display', 'none', 'important'));
  } else if (type === 'delivery') {
    document.documentElement.classList.add('pwa-rider-installed');
    document.body.classList.add('pwa-rider-installed');
    const riderBtns = document.querySelectorAll('#btn-rider-download-app, .rider-pwa-dock');
    riderBtns.forEach(el => el.style.setProperty('display', 'none', 'important'));
  } else {
    document.documentElement.classList.add('pwa-customer-installed');
    document.body.classList.add('pwa-customer-installed');
    const customerBtns = document.querySelectorAll('#btn-download-app, #btn-mobile-download-app, .header-pwa-dock, .mobile-download-item');
    customerBtns.forEach(el => el.style.setProperty('display', 'none', 'important'));
  }
}

export function showAllInstallButtons() {
  if (typeof document === 'undefined') return;
  const type = getCurrentPortalType();

  if (type === 'admin') {
    document.documentElement.classList.remove('pwa-admin-installed');
    document.body.classList.remove('pwa-admin-installed');
    const adminBtns = document.querySelectorAll('#btn-admin-download-app, .admin-pwa-dock');
    adminBtns.forEach(el => el.style.removeProperty('display'));
  } else if (type === 'delivery') {
    document.documentElement.classList.remove('pwa-rider-installed');
    document.body.classList.remove('pwa-rider-installed');
    const riderBtns = document.querySelectorAll('#btn-rider-download-app, .rider-pwa-dock');
    riderBtns.forEach(el => el.style.removeProperty('display'));
  } else {
    document.documentElement.classList.remove('pwa-customer-installed');
    document.body.classList.remove('pwa-customer-installed');
    const customerBtns = document.querySelectorAll('#btn-download-app, #btn-mobile-download-app, .header-pwa-dock, .mobile-download-item');
    customerBtns.forEach(el => el.style.removeProperty('display'));
  }
}

export function autoBindDownloadButtons() {
  if (typeof document === 'undefined') return;
  if (isAppAlreadyInstalled()) {
    hideAllInstallButtons();
    return;
  }
  showAllInstallButtons();
  const btns = document.querySelectorAll(
    '.btn-app-download-compact, .btn-download-app, #btn-download-app, #btn-mobile-download-app, #btn-admin-download-app, #btn-rider-download-app, .mobile-download-item'
  );
  btns.forEach(btn => setupAppDownloadButton(btn));
}

/**
 * Activates real-native app notifications:
 * 1. Requests system OS notification permission
 * 2. Emits physical vibration haptic buzz
 * 3. Plays welcome audio chime
 * 4. Updates W3C home screen app badge
 * 5. Sends a Welcome system push notification with action buttons tailored to the portal
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
      // 1. Play joyful celebratory chime or urgent kitchen chime
      playNotificationSound(portalConfig.type === 'admin' ? 'order_incoming' : 'order_placed');

      // 2. Real app haptic buzz
      triggerDeviceVibration([180, 90, 180, 90, 240]);

      // 3. Clear/sync app badge
      updateAppBadge(0);

      // 4. Send the native system notification
      sendSystemNotification({
        title: portalConfig.welcomeTitle,
        body: portalConfig.welcomeBody,
        icon: portalConfig.icon,
        tag: portalConfig.welcomeTag,
        data: { url: portalConfig.startUrl }
      });

      // 5. Hide the prompt banner if present
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

  // If already granted or explicitly denied in browser, don't show prompt
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return;
  }

  const portalConfig = getPortalConfig();

  // Check if user dismissed recently on this portal (wait 3 days before reminding)
  try {
    const dismissedTime = localStorage.getItem(`quickbite_notif_prompt_dismissed_${portalConfig.type}`);
    if (dismissedTime && Date.now() - Number(dismissedTime) < 3 * 24 * 60 * 60 * 1000) {
      return;
    }
  } catch {}

  // If banner already exists
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

  // Smooth slide-up transition
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

export function initPwaInstallService() {
  if (typeof window === 'undefined') return;

  const portalConfig = getPortalConfig();

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
    });
  } else {
    autoBindDownloadButtons();
  }

  // Browser fired beforeinstallprompt -> Browser confirmed the app is not installed and ready to install!
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    try {
      localStorage.removeItem(`quickbite_pwa_installed_${portalConfig.type}`);
      localStorage.removeItem('quickbite_pwa_installed');
    } catch {}
    if (!isAppAlreadyInstalled()) {
      showAllInstallButtons();
      autoBindDownloadButtons();
    }
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    hideAllInstallButtons();
    const config = getPortalConfig();
    showPwaToast(config.installToast, 'success');
    // Prompt and welcome the user with native app notification after install
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
 * Main trigger function called when any "Download App" button is clicked
 */
export async function triggerAppDownload({ onInstalled, onCancel } = {}) {
  const portalConfig = getPortalConfig();

  // If user is already running inside the standalone installed window
  if (isAppAlreadyInstalled()) {
    hideAllInstallButtons();
    showPwaToast(`✅ ${portalConfig.name} is already running in app mode on your device!`, 'success');
    return 'already_installed';
  }

  // If native browser prompt is available (Chrome, Edge, Samsung Internet, Android)
  if (deferredInstallPrompt) {
    try {
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        hideAllInstallButtons();
        if (typeof onInstalled === 'function') onInstalled();
        setTimeout(() => {
          enableAppNotificationsWithWelcome();
        }, 1200);
      } else {
        if (typeof onCancel === 'function') onCancel();
      }
      deferredInstallPrompt = null;
      return choice.outcome;
    } catch (err) {
      console.warn('[PWA] Prompt error:', err);
    }
  }

  // Fallback: Display sleek instructions modal for iOS Safari / Chrome desktop
  openPwaInstallModal();
  return 'modal_opened';
}

/**
 * Creates and opens the PWA Installation Guide Modal tailored to the active portal
 */
export function openPwaInstallModal() {
  let modal = document.getElementById('pwa-install-modal-backdrop');
  if (modal) {
    modal.remove(); // Remove existing modal to guarantee fresh portal branding
  }
  modal = createPwaInstallModalElement();
  document.body.appendChild(modal);

  modal.classList.add('open');
  modal.style.display = 'flex';
}

export function closePwaInstallModal() {
  const modal = document.getElementById('pwa-install-modal-backdrop');
  if (modal) {
    modal.classList.remove('open');
    setTimeout(() => {
      modal.style.display = 'none';
    }, 250);
  }
}

function createPwaInstallModalElement() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isAndroid = /Android/.test(navigator.userAgent);
  const portalConfig = getPortalConfig();

  const container = document.createElement('div');
  container.id = 'pwa-install-modal-backdrop';
  container.className = 'pwa-install-backdrop';
  container.style.display = 'none';

  const featurePillsHtml = portalConfig.featurePills.map(p => `
    <div class="pwa-feature-pill">
      <span class="feat-icon">${p.icon}</span>
      <span>${p.label}</span>
    </div>
  `).join('');

  container.innerHTML = `
    <div class="pwa-install-modal" role="dialog" aria-modal="true" aria-labelledby="pwa-modal-title">
      <button type="button" class="pwa-modal-close" id="btn-close-pwa-modal" aria-label="Close modal">✕</button>

      <div class="pwa-modal-header">
        <div class="pwa-app-icon-wrap">
          <img src="${portalConfig.icon}" alt="${portalConfig.name} App Icon" class="pwa-modal-app-icon">
          <span class="pwa-verified-badge"><i class="fa-solid fa-check"></i></span>
        </div>
        <div class="pwa-modal-title-group">
          <h3 id="pwa-modal-title">Install ${portalConfig.fullName}</h3>
          <p class="pwa-modal-subtitle">${portalConfig.subtitle}</p>
        </div>
      </div>

      <div class="pwa-features-grid">
        ${featurePillsHtml}
      </div>

      <div class="pwa-install-steps">
        ${isIOS ? `
          <div class="install-step-item">
            <span class="step-num">1</span>
            <div class="step-desc">
              Tap the <strong>Share button</strong> <span class="ios-share-icon"><i class="fa-solid fa-arrow-up-from-bracket"></i></span> at the bottom of Safari.
            </div>
          </div>
          <div class="install-step-item">
            <span class="step-num">2</span>
            <div class="step-desc">
              Scroll down and select <strong>"Add to Home Screen"</strong> <i class="fa-regular fa-square-plus"></i>.
            </div>
          </div>
          <div class="install-step-item">
            <span class="step-num">3</span>
            <div class="step-desc">
              Tap <strong>"Add"</strong> in the top-right corner to finish installing ${portalConfig.name}!
            </div>
          </div>
        ` : isAndroid ? `
          <div class="install-step-item">
            <span class="step-num">1</span>
            <div class="step-desc">
              Tap the <strong>three dots menu</strong> <i class="fa-solid fa-ellipsis-vertical"></i> in Chrome.
            </div>
          </div>
          <div class="install-step-item">
            <span class="step-num">2</span>
            <div class="step-desc">
              Select <strong>"Install app"</strong> or <strong>"Add to Home Screen"</strong>.
            </div>
          </div>
          <div class="install-step-item">
            <span class="step-num">3</span>
            <div class="step-desc">
              Tap <strong>Install</strong> to add ${portalConfig.name} to your app drawer.
            </div>
          </div>
        ` : `
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
        `}
      </div>

      <div class="pwa-modal-footer" style="display: flex; flex-direction: column; gap: 10px;">
        <button type="button" class="btn btn-pwa-primary" id="btn-pwa-modal-primary">
          <i class="fa-solid fa-cloud-arrow-down"></i>
          <span>${deferredInstallPrompt ? `Download & Install ${portalConfig.shortName}` : 'I Understand / Add to Home Screen'}</span>
        </button>
      </div>
    </div>
  `;

  // Attach event listeners
  container.addEventListener('click', (e) => {
    if (e.target === container) closePwaInstallModal();
  });

  const closeBtn = container.querySelector('#btn-close-pwa-modal');
  if (closeBtn) closeBtn.addEventListener('click', closePwaInstallModal);

  const primaryBtn = container.querySelector('#btn-pwa-modal-primary');
  if (primaryBtn) {
    primaryBtn.addEventListener('click', async () => {
      if (deferredInstallPrompt) {
        try {
          deferredInstallPrompt.prompt();
          const choice = await deferredInstallPrompt.userChoice;
          if (choice.outcome === 'accepted') {
            hideAllInstallButtons();
            setTimeout(() => {
              enableAppNotificationsWithWelcome();
            }, 1200);
          }
          deferredInstallPrompt = null;
        } catch {}
      } else {
        showPwaToast(`Follow the steps shown above to add ${portalConfig.name} to your Home Screen!`, 'info');
      }
      closePwaInstallModal();
    });
  }

  return container;
}

function showPwaToast(message, type = 'info') {
  const container = document.querySelector('.toast-container') || document.body;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type} show`;
  toast.style.cssText = 'position:fixed;bottom:24px;left:24px;z-index:9999;background:#181512;color:#FFF;padding:14px 20px;border-radius:999px;box-shadow:0 10px 30px rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.15);display:flex;align-items:center;gap:10px;font-weight:600;';
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
