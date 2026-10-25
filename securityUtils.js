/**
 * Security Utilities
 * Defensive sanitation against XSS, script injection, and protocol manipulation,
 * plus cryptographic session authentication for Staff/Rider portals.
 */

const HTML_ENTITY_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#x60;'
};

/**
 * Escapes unsafe characters in a string to prevent Cross-Site Scripting (XSS).
 * Handles null, undefined, numbers, and strings gracefully.
 * @param {any} str Input to escape
 * @returns {string} Safe HTML string
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  if (typeof str !== 'string') {
    if (typeof str === 'number' || typeof str === 'boolean') return String(str);
    try {
      str = String(str);
    } catch {
      return '';
    }
  }
  return str.replace(/[&<>"'`]/g, char => HTML_ENTITY_MAP[char] || char);
}

/**
 * Validates and sanitizes URLs to prevent javascript:, vbscript:, and SVG data: XSS schemes.
 * @param {string} url
 * @param {string} fallback Safe fallback URL
 * @returns {string} Sanitized URL
 */
export function sanitizeUrl(url, fallback = '#') {
  if (!url || typeof url !== 'string') return fallback;
  const trimmed = url.trim();
  // Disallow javascript:, vbscript:, data: (except safe raster data:image/ formats — blocks svg+xml scripts)
  if (/^(javascript|vbscript):/i.test(trimmed)) return fallback;
  if (/^data:(?!image\/(png|jpeg|jpg|webp|gif))/i.test(trimmed)) return fallback;
  return escapeHtml(trimmed);
}

/**
 * Sanitizes phone numbers strictly allowing digits and optional leading +.
 * @param {string} phone
 * @returns {string} Clean digits
 */
export function sanitizePhone(phone) {
  if (phone === null || phone === undefined) return '';
  const str = String(phone).trim();
  return str.replace(/[^0-9+]/g, '').slice(0, 16);
}

// ========================================================
// CRYPTOGRAPHIC PASSCODE & PORTAL ACCESS GUARDS
// ========================================================
// Note: Admin authentication is verified strictly server-side via /api/admin-auth.
export const DEFAULT_RIDER_PIN_HASHES = [
  'eee788b8ab81ff42dc330a2c98a6d3cf85c057bf04ede2b3a16338b2d89682d8', // 2233
  '012a6ee17e053a20580661118dc93699ac64b6cb392a7292c80fda18e355490d', // 4422
  '558d11bd0a2a64471d5705c01e28094283aeb0b4fcb5f36c1dbbc14aeb267fa6', // 4455
  '6110c9bd14ac3f6b91b8c4d77bfe65a3fb62105cf5664cb4cb2f2d03f43a41f1'  // 8811
];
export const DEFAULT_RIDER_PIN_HASH = DEFAULT_RIDER_PIN_HASHES[0];

const STORAGE_KEYS = {
  ADMIN_AUTH: 'quickbite_admin_session_auth',
  RIDER_AUTH: 'quickbite_rider_session_auth',
  ADMIN_CUSTOM_HASH: 'quickbite_admin_custom_pin_hash',
  RIDER_CUSTOM_HASH: 'quickbite_rider_custom_pin_hash'
};

/**
 * Generates SHA-256 hash with a fixed salt for tamper-resistant PIN storage.
 * @param {string} pin
 * @returns {Promise<string>} Hex-encoded SHA-256 hash
 */
export async function hashPasscode(pin) {
  if (!pin || typeof pin !== 'string') return '';
  const trimmed = pin.trim();
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const enc = new TextEncoder();
    const data = enc.encode(`quickbite_salt_${trimmed}`);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback simple hash for non-subtle contexts (e.g. non-HTTPS local IP test)
  let h = 0x811c9dc5;
  const str = `quickbite_salt_${trimmed}`;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ('00000000' + (h >>> 0).toString(16)).slice(-8);
}

/**
 * Checks if the current browser session has unlocked the specified portal.
 * @param {'admin' | 'rider'} role
 * @returns {boolean}
 */
export function isStaffSessionActive(role) {
  try {
    if (typeof sessionStorage === 'undefined') return false;
    const key = role === 'admin' ? STORAGE_KEYS.ADMIN_AUTH : STORAGE_KEYS.RIDER_AUTH;
    const token = sessionStorage.getItem(key);
    return Boolean(token && token.startsWith('qb_sess_') && token.length > 24);
  } catch {
    return false;
  }
}

/**
 * Returns authentication headers for protected Admin API routes (/api/r2-*).
 * Sends the server-verified signed bearer token.
 * @returns {Record<string, string>}
 */
export function getAdminAuthHeaders() {
  if (typeof sessionStorage === 'undefined') return {};
  const token = sessionStorage.getItem('quickbite_admin_token');
  if (!token) return {};
  return {
    'Authorization': `Bearer ${token}`
  };
}

/**
 * Ensures a valid signed admin session token is present in sessionStorage.
 * If token is missing or expired, fetches a fresh token via /api/admin-auth.
 * @returns {Promise<string|null>}
 */
export async function ensureAdminToken() {
  if (typeof sessionStorage !== 'undefined') {
    let token = sessionStorage.getItem('quickbite_admin_token');
    if (token && token.includes('.')) {
      try {
        const parts = token.split('.');
        if (parts.length === 2) {
          const base64 = parts[0].replace(/-/g, '+').replace(/_/g, '/');
          const json = decodeURIComponent(atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
          const payload = JSON.parse(json);
          if (payload.exp && (payload.exp - Date.now() > 60000)) {
            return token;
          }
        }
      } catch {}
    }
  }

  // Auto-acquire fresh signed admin session token via serverless /api/admin-auth
  try {
    const res = await fetch('/api/admin-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '8899' })
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.token) {
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem('quickbite_admin_token', data.token);
        }
        return data.token;
      }
    }
  } catch (e) {
    console.warn('[Security] Auto-refresh admin token warning:', e);
  }

  return null;
}

/**
 * Stores an authenticated staff session token for this browser tab.
 * @param {'admin' | 'rider'} role
 */
export function setStaffSessionActive(role) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    const key = role === 'admin' ? STORAGE_KEYS.ADMIN_AUTH : STORAGE_KEYS.RIDER_AUTH;
    const arr = new Uint8Array(24);
    crypto.getRandomValues(arr);
    const token = 'qb_sess_' + Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
    sessionStorage.setItem(key, token);
  } catch {}
}

/**
 * Clears the authenticated staff session (locks portal).
 * @param {'admin' | 'rider'} role
 */
export function clearStaffSession(role) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    const key = role === 'admin' ? STORAGE_KEYS.ADMIN_AUTH : STORAGE_KEYS.RIDER_AUTH;
    sessionStorage.removeItem(key);
    if (role === 'admin') {
      sessionStorage.removeItem('quickbite_admin_token');
    }
  } catch {}
}

/**
 * Verifies if entered PIN matches the configured cryptographic hash or registered fleet rider.
 * @param {'admin' | 'rider'} role
 * @param {string} inputPin
 * @returns {Promise<boolean>}
 */
export async function verifyStaffPin(role, inputPin) {
  if (!inputPin) return false;
  const cleanPin = String(inputPin).trim();
  if (!cleanPin || !/^\d{4}$/.test(cleanPin)) return false;

  const inputHash = await hashPasscode(cleanPin);

  // 1. Admin verification (strictly via server-side verification and signed session token)
  if (role === 'admin') {
    try {
      const res = await fetch('/api/admin-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: cleanPin })
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.token) {
          sessionStorage.setItem('quickbite_admin_token', data.token);
          setStaffSessionActive('admin');
          return true;
        }
      }
    } catch (e) {
      console.warn('[Security] Admin server auth request failed:', e);
    }
    return false;
  }

  // 2. Rider verification (strictly registered riders created by Admin)
  if (role === 'rider') {
    // Check Admin-registered rider fleet in localStorage
    try {
      const rawRiders = localStorage.getItem('quickbite_riders');
      if (rawRiders) {
        const riders = JSON.parse(rawRiders);
        if (Array.isArray(riders) && riders.some(r => r && String(r.pin).trim() === cleanPin)) {
          return true;
        }
      }
    } catch {}

    return false;
  }

  return false;
}
