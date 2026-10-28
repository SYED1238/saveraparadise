import { escapeHtml } from './securityUtils.js';

/**
 * QuickBite Unified Cross-Portal Notification & Sound Service
 * Provides:
 * 1. Zero-dependency Web Audio API sound synthesizer (reliable offline, no external MP3 failures)
 * 2. Browser Desktop / Mobile Push Notifications (Notification API)
 * 3. Browser Tab Title Flashing (alerts user across inactive tabs)
 * 4. Cross-Portal Event Synchronization & Toast Triggering
 */

const STORAGE_KEYS = {
  SOUND_ENABLED: 'quickbite_sound_enabled',
  NOTIFICATIONS_REQUESTED: 'quickbite_notifications_requested'
};

// Global AudioContext singleton
let globalAudioCtx = null;
let soundEnabled = true;

try {
  const savedSound = localStorage.getItem(STORAGE_KEYS.SOUND_ENABLED);
  if (savedSound !== null) {
    soundEnabled = savedSound === 'true';
  }
} catch {}

/**
 * Initializes or returns the active Web AudioContext.
 * Automatically handles browser autoplay suspension policies.
 */
export function getAudioContext() {
  if (!globalAudioCtx) {
    const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
    if (AudioCtxClass) {
      globalAudioCtx = new AudioCtxClass();
    }
  }
  if (globalAudioCtx && globalAudioCtx.state === 'suspended') {
    globalAudioCtx.resume().catch(() => {});
  }
  return globalAudioCtx;
}

/**
 * Auto-unlock Web Audio on first user interaction anywhere on the window.
 */
function autoUnlockAudio() {
  const unlock = () => {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    window.removeEventListener('touchstart', unlock);
    window.removeEventListener('click', unlock);
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock, { passive: true });
  window.addEventListener('touchstart', unlock, { passive: true });
  window.addEventListener('click', unlock, { passive: true });
}

if (typeof window !== 'undefined') {
  autoUnlockAudio();
}

/**
 * Toggle sound effects on/off
 */
export function setSoundEnabled(enabled) {
  soundEnabled = !!enabled;
  try {
    localStorage.setItem(STORAGE_KEYS.SOUND_ENABLED, String(soundEnabled));
  } catch {}
}

export function isSoundEnabled() {
  return soundEnabled;
}

/**
 * Synthesizes crystal-clear notification tones using pure Web Audio API oscillators.
 * Zero external MP3 downloads, zero CORS issues, 100% offline-ready.
 */
export function playNotificationSound(type = 'general_alert') {
  if (!soundEnabled) return;

  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;

    // Master volume
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.7, now);
    masterGain.connect(ctx.destination);

    // Tone definitions for different notification events
    let notes = [];

    switch (type) {
      case 'new_order':
      case 'kitchen_alarm':
        // Piercing POS kitchen dual melody (880Hz, 1174Hz, 1760Hz twice)
        notes = [
          { freq: 880.00, start: 0.00, dur: 0.12, gain: 0.50, type: 'triangle' },
          { freq: 1174.66, start: 0.13, dur: 0.12, gain: 0.55, type: 'triangle' },
          { freq: 1760.00, start: 0.26, dur: 0.30, gain: 0.65, type: 'triangle' },
          { freq: 880.00, start: 0.55, dur: 0.12, gain: 0.50, type: 'triangle' },
          { freq: 1174.66, start: 0.68, dur: 0.12, gain: 0.55, type: 'triangle' },
          { freq: 1760.00, start: 0.81, dur: 0.40, gain: 0.70, type: 'triangle' }
        ];
        break;

      case 'rider_new_task':
        // Crisp high-priority delivery bell alert (two rapid energetic bursts)
        notes = [
          { freq: 698.46, start: 0.00, dur: 0.10, gain: 0.55, type: 'sine' },
          { freq: 880.00, start: 0.11, dur: 0.12, gain: 0.60, type: 'sine' },
          { freq: 1046.50, start: 0.24, dur: 0.28, gain: 0.70, type: 'sine' },
          { freq: 1318.51, start: 0.38, dur: 0.35, gain: 0.65, type: 'triangle' }
        ];
        break;

      case 'order_placed':
        // Warm ascending major triad for customer order confirmation (C5 -> E5 -> G5)
        notes = [
          { freq: 523.25, start: 0.00, dur: 0.14, gain: 0.50, type: 'sine' },
          { freq: 659.25, start: 0.12, dur: 0.14, gain: 0.55, type: 'sine' },
          { freq: 783.99, start: 0.24, dur: 0.45, gain: 0.65, type: 'sine' }
        ];
        break;

      case 'accepted':
        // Warm affirmative two-tone chime (D5 -> A5)
        notes = [
          { freq: 587.33, start: 0.00, dur: 0.14, gain: 0.50, type: 'sine' },
          { freq: 880.00, start: 0.15, dur: 0.38, gain: 0.60, type: 'sine' }
        ];
        break;

      case 'cooking':
        // Soft kitchen notification (E5 -> G5 -> C6)
        notes = [
          { freq: 659.25, start: 0.00, dur: 0.12, gain: 0.45, type: 'sine' },
          { freq: 783.99, start: 0.13, dur: 0.12, gain: 0.50, type: 'sine' },
          { freq: 1046.50, start: 0.26, dur: 0.35, gain: 0.60, type: 'sine' }
        ];
        break;

      case 'on_the_way':
      case 'dispatched':
        // Energetic motorcycle/delivery dispatch pulse (G5 -> C6 twice)
        notes = [
          { freq: 783.99, start: 0.00, dur: 0.10, gain: 0.55, type: 'triangle' },
          { freq: 1046.50, start: 0.11, dur: 0.18, gain: 0.65, type: 'triangle' },
          { freq: 783.99, start: 0.32, dur: 0.10, gain: 0.55, type: 'triangle' },
          { freq: 1046.50, start: 0.43, dur: 0.30, gain: 0.70, type: 'triangle' }
        ];
        break;

      case 'delivered':
        // Joyous celebratory arpeggio (C5 -> E5 -> G5 -> B5 -> C6)
        notes = [
          { freq: 523.25, start: 0.00, dur: 0.11, gain: 0.45, type: 'sine' },
          { freq: 659.25, start: 0.10, dur: 0.11, gain: 0.50, type: 'sine' },
          { freq: 783.99, start: 0.20, dur: 0.11, gain: 0.55, type: 'sine' },
          { freq: 987.77, start: 0.30, dur: 0.12, gain: 0.60, type: 'sine' },
          { freq: 1046.50, start: 0.42, dur: 0.50, gain: 0.70, type: 'sine' }
        ];
        break;

      case 'cancelled':
      case 'rejected':
        // Distinct descending warning tones (G4 -> Eb4 -> C4)
        notes = [
          { freq: 392.00, start: 0.00, dur: 0.16, gain: 0.55, type: 'triangle' },
          { freq: 311.13, start: 0.18, dur: 0.18, gain: 0.60, type: 'triangle' },
          { freq: 261.63, start: 0.38, dur: 0.40, gain: 0.65, type: 'triangle' }
        ];
        break;

      case 'test':
      default:
        // Clean pleasant test chime
        notes = [
          { freq: 587.33, start: 0.00, dur: 0.12, gain: 0.45, type: 'sine' },
          { freq: 880.00, start: 0.12, dur: 0.30, gain: 0.55, type: 'sine' }
        ];
        break;
    }

    notes.forEach(note => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = note.type || 'sine';
      osc.frequency.setValueAtTime(note.freq, now + note.start);

      // Smooth envelope ramp to eliminate audio clicks
      gain.gain.setValueAtTime(0.0001, now + note.start);
      gain.gain.exponentialRampToValueAtTime(note.gain, now + note.start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note.start + note.dur);

      osc.connect(gain);
      gain.connect(masterGain);

      osc.start(now + note.start);
      osc.stop(now + note.start + note.dur + 0.04);
    });

  } catch (err) {
    console.warn('[NotificationService] Web Audio error:', err);
  }
}

/**
 * Web Desktop / System Push Notifications
 */

export function isSystemNotificationSupported() {
  if (typeof window !== 'undefined' && window.AndroidNative) return true;
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getSystemNotificationPermission() {
  if (typeof window !== 'undefined' && window.AndroidNative) return 'granted';
  if (!isSystemNotificationSupported()) return 'unsupported';
  return Notification.permission;
}

export async function requestSystemNotificationPermission() {
  if (typeof window !== 'undefined' && window.AndroidNative) {
    if (typeof window.AndroidNative.requestNotificationPermission === 'function') {
      window.AndroidNative.requestNotificationPermission();
    }
    return 'granted';
  }
  if (!isSystemNotificationSupported()) return 'unsupported';
  try {
    const perm = await Notification.requestPermission();
    try {
      localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS_REQUESTED, 'true');
    } catch {}
    return perm;
  } catch (e) {
    return Notification.permission;
  }
}

export function registerServiceWorker() {
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then((reg) => {
        // Force check for newest service worker build on server
        try { reg.update(); } catch {}
      })
      .catch((err) => {
        console.warn('[SW] Registration failed:', err);
      });

    // When new service worker activates and purges stale caches, refresh page seamlessly once
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  }
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'complete') {
    registerServiceWorker();
  } else {
    window.addEventListener('load', registerServiceWorker);
  }
}

export function isNotificationGranted() {
  if (typeof window !== 'undefined' && window.AndroidNative) return true;
  return isSystemNotificationSupported() && Notification.permission === 'granted';
}

/**
 * Updates the native OS App Icon Badge Counter (home screen / taskbar badge).
 * Supported in Chrome, Edge, Android PWA standalone windows.
 */
export function updateAppBadge(count = 0) {
  try {
    if (typeof navigator !== 'undefined' && 'setAppBadge' in navigator) {
      if (count > 0) {
        navigator.setAppBadge(count).catch(() => {});
      } else {
        navigator.clearAppBadge().catch(() => {});
      }
    }
  } catch {}
}

/**
 * Native Device Vibration (haptic buzz like a real mobile app)
 */
export function triggerDeviceVibration(pattern = [180, 90, 180, 90, 240]) {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  } catch {}
}

/**
 * Returns portal-specific meta (icon, default url, title)
 */
export function getDefaultPortalMeta() {
  if (typeof window !== 'undefined') {
    const path = window.location.pathname.toLowerCase();
    if (path.includes('owner')) {
      return { icon: '/icon-admin-192.svg', url: '/owner.html', title: 'Savera Paradise Owner' };
    }
    if (path.includes('admin')) {
      return { icon: '/icon-admin-192.svg', url: '/admin.html', title: 'Savera Paradise Kitchen' };
    }
    if (path.includes('delivery')) {
      return { icon: '/icon-rider-192.svg', url: '/delivery.html', title: 'Savera Paradise Rider' };
    }
  }
  return { icon: '/icon-192.svg', url: '/', title: 'Savera Paradise' };
}

const recentNotifications = new Map();

/**
 * Fires a native OS / browser desktop notification (managed by Service Worker or window fallback).
 * Matches real native app behaviors: haptic vibration, audible chime, renotify, and actionable buttons.
 */
export function sendSystemNotification({ 
  title, 
  body, 
  icon = null, 
  tag = 'quickbite-order', 
  onClick = null, 
  data = {},
  soundType = null,
  onlyIfHidden = false
}) {
  // 1. Direct Native Android Heads-Up Notification Bridge (Heads-up popup banner like WhatsApp)
  if (typeof window !== 'undefined' && window.AndroidNative && typeof window.AndroidNative.showNotification === 'function') {
    try {
      window.AndroidNative.showNotification(String(title), String(body || ''), String(tag || 'order'), String(soundType || ''));
      if (typeof window.AndroidNative.triggerVibration === 'function') {
        window.AndroidNative.triggerVibration();
      }
      return true;
    } catch (e) {
      console.warn('[NotificationService] AndroidNative notification error:', e);
    }
  }

  if (!isSystemNotificationSupported()) return null;
  if (Notification.permission !== 'granted') return null;

  // If onlyIfHidden is requested, suppress OS notification if tab is actively focused
  if (onlyIfHidden && typeof document !== 'undefined' && !document.hidden && document.hasFocus && document.hasFocus()) {
    return null;
  }

  // Deduplicate rapid identical notifications within 2 seconds
  const notifKey = `${tag || 'default'}:${title}`;
  const now = Date.now();
  const lastSent = recentNotifications.get(notifKey) || 0;
  if (now - lastSent < 2000) {
    return null;
  }
  recentNotifications.set(notifKey, now);
  setTimeout(() => recentNotifications.delete(notifKey), 5000);

  const portalMeta = getDefaultPortalMeta();
  const effectiveIcon = icon || portalMeta.icon;
  const effectiveUrl = data?.url || portalMeta.url;
  const effectiveData = { ...data, url: effectiveUrl };

  // Real app haptic feedback
  triggerDeviceVibration([180, 90, 180, 90, 240]);

  // Optional matching audio chime
  if (soundType) {
    playNotificationSound(soundType);
  }

  function fallbackWindowNotification() {
    try {
      const notif = new Notification(title, {
        body: body || '',
        icon: effectiveIcon,
        badge: effectiveIcon,
        tag: tag,
        renotify: true,
        data: effectiveData,
        requireInteraction: false
      });

      notif.onclick = function (e) {
        try {
          window.focus();
          if (typeof onClick === 'function') onClick(e);
          this.close();
        } catch {}
      };

      return notif;
    } catch (err) {
      console.warn('[NotificationService] Window notification error:', err);
      return null;
    }
  }

  // Primary: Show through Service Worker registration with rich actions and vibration
  if ('serviceWorker' in navigator) {
    let swCompleted = false;
    let fallbackFired = false;
    let fallbackTimer = null;

    fallbackTimer = setTimeout(() => {
      fallbackTimer = null;
      if (!swCompleted && !fallbackFired && typeof window !== 'undefined' && 'Notification' in window) {
        fallbackFired = true;
        fallbackWindowNotification();
      }
    }, 250);

    navigator.serviceWorker.ready.then((reg) => {
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      if (fallbackFired) {
        // Fallback window notification already fired; prevent duplicate
        return;
      }
      swCompleted = true;
      reg.showNotification(title, {
        body: body || '',
        icon: effectiveIcon,
        badge: effectiveIcon,
        tag: tag,
        renotify: true,
        vibrate: [180, 90, 180, 90, 240],
        data: effectiveData,
        requireInteraction: false,
        actions: [
          { action: 'open_app', title: '📍 View Details' },
          { action: 'dismiss', title: '✕ Dismiss' }
        ]
      }).catch(() => {
        if (!fallbackFired) {
          fallbackFired = true;
          fallbackWindowNotification();
        }
      });
    }).catch(() => {
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      if (!fallbackFired) {
        fallbackFired = true;
        fallbackWindowNotification();
      }
    });

    return true;
  }

  return fallbackWindowNotification();
}

/**
 * Flashes browser tab title back and forth so user notices even when multitasking in another tab or application.
 */
let activeTitleFlashTimer = null;
let originalDocumentTitle = typeof document !== 'undefined' ? document.title : '';

export function flashTabTitle(alertText, durationMs = 12000) {
  if (typeof document === 'undefined') return;

  if (activeTitleFlashTimer) {
    clearInterval(activeTitleFlashTimer);
    activeTitleFlashTimer = null;
  }

  if (!originalDocumentTitle) {
    originalDocumentTitle = document.title;
  }

  let toggle = false;
  activeTitleFlashTimer = setInterval(() => {
    toggle = !toggle;
    document.title = toggle ? alertText : originalDocumentTitle;
  }, 650);

  // Stop flashing when window gets focused
  const onFocus = () => {
    stopFlashingTabTitle();
    window.removeEventListener('focus', onFocus);
  };
  window.addEventListener('focus', onFocus);

  // Auto-stop after duration
  setTimeout(() => {
    stopFlashingTabTitle();
    window.removeEventListener('focus', onFocus);
  }, durationMs);
}

export function stopFlashingTabTitle() {
  if (activeTitleFlashTimer) {
    clearInterval(activeTitleFlashTimer);
    activeTitleFlashTimer = null;
  }
  if (originalDocumentTitle && typeof document !== 'undefined') {
    document.title = originalDocumentTitle;
  }
}

/**
 * High-level unified dispatcher that triggers Sound + Desktop Push Notification + Tab Title Flash
 */
export function dispatchPortalNotification({
  portal = 'storefront', // 'storefront' | 'admin' | 'delivery'
  title,
  message,
  soundType = 'general_alert',
  orderId = '',
  onClick = null
}) {
  // 1. Play Synthesized Sound
  playNotificationSound(soundType);

  // 2. Flash Browser Tab Title if document is hidden or inactive
  const alertHeadline = orderId ? `${title} (${orderId})` : title;
  flashTabTitle(`🔔 ${alertHeadline}`);

  // 3. Send OS / Desktop Notification
  sendSystemNotification({
    title: title,
    body: message,
    tag: orderId || `qb-${Date.now()}`,
    onClick: onClick
  });
}

// ============================================================================
// SAMSUNG ONE UI TOP FLOATING PILL NOTIFICATION ENGINE
// ============================================================================
const recentSamsungToasts = new Map();

/**
 * High-performance, tactile Samsung One UI pop-up pill notification:
 * - Drops down smoothly from above (top-center, safe-area aware)
 * - Round pill corners (28px) with frosted acrylic glass & Edge Lighting glow
 * - Real fluid gesture physics: swipe UP into top bar to dismiss, or swipe LEFT/RIGHT
 * - Auto-dismiss timer that pauses on hover/touch
 * - Tactile vibration tick on mobile
 */
export function showSamsungToast(message, type = 'info', options = {}) {
  if (typeof document === 'undefined' || !message) return null;

  const rawMsg = String(message).trim();
  if (!rawMsg) return null;

  const appName = options.appName || 'SAVERA PARADISE';
  const duration = typeof options.duration === 'number' ? options.duration : 3800;
  const key = `${type}:${rawMsg}`;
  const now = Date.now();

  // 1. Anti-spam debounce: avoid repeating identical notifications within 1.5s
  const lastShown = recentSamsungToasts.get(key) || 0;
  if (now - lastShown < 1500) {
    return null;
  }
  recentSamsungToasts.set(key, now);
  setTimeout(() => recentSamsungToasts.delete(key), 3000);

  // 2. Resolve or create top-level toast container
  let container = options.container;
  if (typeof container === 'string') {
    container = document.querySelector(container);
  }
  if (!container || !container.appendChild) {
    container = document.getElementById('toast-container') ||
                document.getElementById('rider-toast-container') ||
                document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      container.id = 'toast-container';
      document.body.appendChild(container);
    }
  }

  // 3. Highlight existing visible toast if identical message is already onscreen
  const existingToasts = container.querySelectorAll('.toast');
  for (const existing of existingToasts) {
    const textEl = existing.querySelector('.toast-message-text') || existing;
    if (textEl && textEl.textContent && textEl.textContent.trim() === rawMsg) {
      existing.style.animation = 'none';
      void existing.offsetHeight;
      existing.style.animation = 'samsungToastPulse 0.35s cubic-bezier(0.16, 1, 0.3, 1)';
      return existing;
    }
  }

  // Cap visible toasts to maximum 3 to prevent screen clutter
  if (existingToasts.length >= 3) {
    const oldest = existingToasts[0];
    if (oldest && typeof oldest._dismissToast === 'function') {
      oldest._dismissToast('up');
    } else if (oldest) {
      oldest.remove();
    }
  }

  // 4. Construct Samsung One UI Toast element
  const toast = document.createElement('div');
  toast.className = `toast toast-${type} toast-samsung`;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'assertive');

  let iconSvg = '';
  if (type === 'success') {
    iconSvg = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  } else if (type === 'error') {
    iconSvg = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
  } else if (type === 'warning') {
    iconSvg = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
  } else {
    iconSvg = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
  }

  toast.innerHTML = `
    <div class="toast-card-inner">
      <div class="toast-badge-wrap">
        <div class="toast-badge-circle toast-badge-${type}">
          ${iconSvg}
        </div>
      </div>
      <div class="toast-body-wrap">
        <div class="toast-header-row">
          <span class="toast-app-pill">${escapeHtml(appName)}</span>
          <span class="toast-time-meta">now</span>
        </div>
        <div class="toast-message-text">${escapeHtml(rawMsg)}</div>
      </div>
      <button class="toast-close-btn" type="button" aria-label="Dismiss">
        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.2" fill="none"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="toast-swipe-notch" aria-hidden="true"></div>
  `;

  // Pre-set entrance transform
  toast.style.transform = 'translateY(-140%) scale(0.92)';
  toast.style.opacity = '0';
  container.appendChild(toast);

  // Tactile haptic feedback on mobile
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(10);
    }
  } catch {}

  // 5. Entrance transition: Drop down from top
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.style.transition = 'transform 0.42s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.28s ease';
      toast.style.transform = 'translateY(0) scale(1)';
      toast.style.opacity = '1';
    });
  });

  // 6. Dismissal engine
  let dismissTimer = null;
  let remainingMs = duration;
  let timerStart = Date.now();
  let isDismissed = false;

  const dismiss = (direction = 'up') => {
    if (isDismissed) return;
    isDismissed = true;
    clearTimeout(dismissTimer);

    toast.classList.add('toast-dismissing');
    if (direction === 'left') {
      toast.style.transition = 'transform 0.26s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.22s ease';
      toast.style.transform = 'translateX(-130%) rotate(-10deg)';
      toast.style.opacity = '0';
    } else if (direction === 'right') {
      toast.style.transition = 'transform 0.26s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.22s ease';
      toast.style.transform = 'translateX(130%) rotate(10deg)';
      toast.style.opacity = '0';
    } else {
      toast.style.transition = 'transform 0.24s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease';
      toast.style.transform = 'translateY(-140%) scale(0.9)';
      toast.style.opacity = '0';
    }

    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 280);
  };

  toast._dismissToast = dismiss;

  const startTimer = (ms) => {
    clearTimeout(dismissTimer);
    timerStart = Date.now();
    remainingMs = ms;
    dismissTimer = setTimeout(() => dismiss('up'), ms);
  };

  const pauseTimer = () => {
    clearTimeout(dismissTimer);
    const elapsed = Date.now() - timerStart;
    remainingMs = Math.max(800, remainingMs - elapsed);
  };

  const resumeTimer = () => {
    startTimer(remainingMs);
  };

  startTimer(duration);

  // Close button trigger
  const closeBtn = toast.querySelector('.toast-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dismiss('up');
    });
  }

  // 7. Interactive Physics Swipe Gesture (Touch & Pointer)
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let currentY = 0;
  let isDragging = false;
  let isHorizontal = false;

  const onDragStart = (e) => {
    if (e.target && e.target.closest && e.target.closest('.toast-close-btn')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    isDragging = true;
    isHorizontal = false;
    const pt = e.touches ? e.touches[0] : e;
    startX = pt.clientX;
    startY = pt.clientY;
    currentX = startX;
    currentY = startY;

    pauseTimer();
    toast.style.transition = 'none';
  };

  const onDragMove = (e) => {
    if (!isDragging) return;
    const pt = e.touches ? e.touches[0] : e;
    currentX = pt.clientX;
    currentY = pt.clientY;

    const deltaX = currentX - startX;
    const deltaY = currentY - startY;

    if (!isHorizontal && Math.abs(deltaX) > Math.abs(deltaY) + 5) {
      isHorizontal = true;
    }

    if (deltaY < 0) {
      // Swiping UP: direct slide up with slight fade
      const progress = Math.min(1, Math.abs(deltaY) / 100);
      toast.style.transform = `translateY(${deltaY}px) scale(${1 - progress * 0.08})`;
      toast.style.opacity = `${1 - progress * 0.75}`;
    } else if (deltaY > 0 && Math.abs(deltaX) < 14) {
      // Swiping DOWN: rubber-band elastic tension
      const dampedY = deltaY * 0.22;
      toast.style.transform = `translateY(${dampedY}px)`;
      toast.style.opacity = '1';
    }

    if (Math.abs(deltaX) > 8) {
      // Swiping HORIZONTALLY: fling with tilt angle
      const rot = deltaX * 0.05;
      const dampedY = deltaY < 0 ? deltaY : deltaY * 0.2;
      const progress = Math.min(1, Math.abs(deltaX) / 180);
      toast.style.transform = `translate(${deltaX}px, ${dampedY}px) rotate(${rot}deg)`;
      toast.style.opacity = `${1 - progress * 0.75}`;
    }
  };

  const onDragEnd = (e) => {
    if (!isDragging) return;
    isDragging = false;

    const pt = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0] : (e.touches && e.touches[0]) ? e.touches[0] : e;
    const endX = pt ? pt.clientX : currentX;
    const endY = pt ? pt.clientY : currentY;
    const deltaX = endX - startX;
    const deltaY = endY - startY;

    // A. Swiped UP past threshold: dismiss up!
    if (deltaY < -28) {
      dismiss('up');
      return;
    }

    // B. Swiped RIGHT past threshold: dismiss right!
    if (deltaX > 55) {
      dismiss('right');
      return;
    }

    // C. Swiped LEFT past threshold: dismiss left!
    if (deltaX < -55) {
      dismiss('left');
      return;
    }

    // D. Not swiped far enough: snap back into resting position with spring bounce!
    toast.style.transition = 'transform 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.25s ease';
    toast.style.transform = 'translate(0, 0) rotate(0deg) scale(1)';
    toast.style.opacity = '1';
    resumeTimer();
  };

  // Pointer events (Mobile Touch + Desktop Mouse)
  toast.addEventListener('pointerdown', onDragStart, { passive: true });
  window.addEventListener('pointermove', onDragMove, { passive: true });
  window.addEventListener('pointerup', onDragEnd, { passive: true });
  window.addEventListener('pointercancel', onDragEnd, { passive: true });

  // Hover pause on desktop
  toast.addEventListener('mouseenter', pauseTimer);
  toast.addEventListener('mouseleave', resumeTimer);

  return toast;
}

if (typeof window !== 'undefined') {
  window.showSamsungToast = showSamsungToast;
  window.showToast = (msg, type = 'info', opts = {}) => showSamsungToast(msg, type, opts);
}
