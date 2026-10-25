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
