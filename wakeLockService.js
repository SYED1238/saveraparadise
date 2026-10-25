/**
 * Screen Wake Lock Service
 * Keeps kitchen display and delivery rider screens active and awake 24/7.
 * Prevents mobile OS sleep mode, JS throttling, and missed audio alarms.
 */

let wakeLockSentinel = null;
let isRequested = false;
const listeners = new Set();

export function isWakeLockSupported() {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

export function isWakeLockActive() {
  return wakeLockSentinel !== null && !wakeLockSentinel.released;
}

function notifyChange(active) {
  listeners.forEach(cb => {
    try { cb(active); } catch {}
  });
}

/**
 * Requests the screen wake lock.
 * Automatically re-acquires when returning from another tab or unlocking device.
 */
export async function requestWakeLock() {
  isRequested = true;
  if (!isWakeLockSupported()) return false;

  try {
    if (wakeLockSentinel && !wakeLockSentinel.released) {
      return true;
    }

    wakeLockSentinel = await navigator.wakeLock.request('screen');
    notifyChange(true);

    wakeLockSentinel.addEventListener('release', () => {
      wakeLockSentinel = null;
      notifyChange(false);
      // If still requested and document became visible, re-acquire
      if (isRequested && document.visibilityState === 'visible') {
        setTimeout(requestWakeLock, 1000);
      }
    });

    return true;
  } catch (err) {
    console.info('[WakeLock] Could not acquire screen lock (safe fallback):', err.message);
    wakeLockSentinel = null;
    notifyChange(false);
    return false;
  }
}

/**
 * Explicitly releases the wake lock.
 */
export async function releaseWakeLock() {
  isRequested = false;
  if (wakeLockSentinel) {
    try {
      await wakeLockSentinel.release();
    } catch {}
    wakeLockSentinel = null;
    notifyChange(false);
  }
}

/**
 * Subscribes to wake lock state changes (active: boolean).
 */
export function onWakeLockChange(callback) {
  if (typeof callback === 'function') {
    listeners.add(callback);
    callback(isWakeLockActive());
    return () => listeners.delete(callback);
  }
  return () => {};
}

// Auto re-acquire on visibility change
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (isRequested && document.visibilityState === 'visible') {
      requestWakeLock();
    }
  });

  // Re-acquire on user interaction if previously dropped
  const resumeOnGesture = () => {
    if (isRequested && (!wakeLockSentinel || wakeLockSentinel.released)) {
      requestWakeLock();
    }
  };
  window.addEventListener('pointerdown', resumeOnGesture, { passive: true });
  window.addEventListener('keydown', resumeOnGesture, { passive: true });
}
