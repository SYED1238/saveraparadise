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

export const DEFAULT_OWNER_PIN_HASH = 'abcb00b12750a6e83eef857f2b2f5809864ced8e2b81cbfe784cba2a36e197e8'; // SHA-256('quickbite_salt_9900')

const STORAGE_KEYS = {
  ADMIN_AUTH: 'quickbite_admin_session_auth',
  RIDER_AUTH: 'quickbite_rider_session_auth',
  OWNER_AUTH: 'quickbite_owner_session_auth',
  ADMIN_CUSTOM_HASH: 'quickbite_admin_custom_pin_hash',
  RIDER_CUSTOM_HASH: 'quickbite_rider_custom_pin_hash'
};

/**
 * Pure JavaScript standard SHA-256 fallback implementation
 * Produces full 64-character NIST SHA-256 hex digest when crypto.subtle is unavailable
 */
function sha256PureJs(ascii) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  const lengthProperty = 'length';
  let i, j;
  let result = '';
  const words = [];
  const asciiBitLength = ascii[lengthProperty] * 8;
  let hash = [];
  const k = [];
  let primeCounter = 0;
  const isComposite = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 313; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = (mathPow(candidate, .5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }
  hash = hash.slice(0, 8);
  ascii += '\x80';
  while (ascii[lengthProperty] % 64 - 56) ascii += '\x00';
  for (i = 0; i < ascii[lengthProperty]; i++) {
    j = ascii.charCodeAt(i);
    if (j >> 8) return '';
    words[i >> 2] |= j << ((3 - i) % 4) * 8;
  }
  words[words[lengthProperty]] = ((asciiBitLength / maxWord) | 0);
  words[words[lengthProperty]] = (asciiBitLength);
  for (j = 0; j < words[lengthProperty];) {
    const w = words.slice(j, j += 16);
    const oldHash = hash;
    hash = hash.slice(0, 8);
    for (i = 0; i < 64; i++) {
      const i2 = i + j;
      const w15 = w[i - 15], w2 = w[i - 2];
      const a = hash[0], e = hash[4];
      const temp1 = hash[7]
        + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
        + ((e & hash[5]) ^ ((~e) & hash[6]))
        + k[i]
        + (w[i] = (i < 16) ? w[i] : (
            w[i - 16]
            + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
            + w[i - 7]
            + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
          ) | 0
        );
      const temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
        + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
    }
    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }
  for (i = 0; i < 8; i++) {
    for (j = 3; j + 1; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += ((b < 16) ? '0' : '') + b.toString(16);
    }
  }
  return result;
}

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
  // Standard 64-character SHA-256 fallback (never weak 32-bit FNV)
  return sha256PureJs(`quickbite_salt_${trimmed}`);
}

/**
 * Checks if the current browser session has unlocked the specified portal.
 * @param {'admin' | 'rider' | 'owner'} role
 * @returns {boolean}
 */
export function isStaffSessionActive(role) {
  try {
    if (typeof sessionStorage === 'undefined') return false;
    const key = role === 'admin' ? STORAGE_KEYS.ADMIN_AUTH : (role === 'rider' ? STORAGE_KEYS.RIDER_AUTH : STORAGE_KEYS.OWNER_AUTH);
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

    // Token is missing or expired. Attempt to refresh via /api/admin-auth if staff session is active
    if ((isStaffSessionActive('admin') || isStaffSessionActive('owner')) && typeof fetch !== 'undefined') {
      try {
        const res = await fetch('/api/admin-auth', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ action: 'refresh', token: token || null })
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.token) {
            sessionStorage.setItem('quickbite_admin_token', data.token);
            if (data.role === 'owner') {
              sessionStorage.setItem('quickbite_owner_token', data.token);
            }
            return data.token;
          }
        }
      } catch (err) {
        console.warn('[Security] ensureAdminToken refresh error:', err);
      }
    }
  }

  return null;
}

/**
 * Stores an authenticated staff session token for this browser tab.
 * @param {'admin' | 'rider' | 'owner'} role
 */
export function setStaffSessionActive(role) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    const key = role === 'admin' ? STORAGE_KEYS.ADMIN_AUTH : (role === 'rider' ? STORAGE_KEYS.RIDER_AUTH : STORAGE_KEYS.OWNER_AUTH);
    const arr = new Uint8Array(24);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      crypto.getRandomValues(arr);
    } else {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = Math.floor(Math.random() * 256);
      }
    }
    const token = 'qb_sess_' + Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
    sessionStorage.setItem(key, token);
  } catch {}
}

/**
 * Clears the authenticated staff session (locks portal).
 * @param {'admin' | 'rider' | 'owner'} role
 */
export function clearStaffSession(role) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    const key = role === 'admin' ? STORAGE_KEYS.ADMIN_AUTH : (role === 'rider' ? STORAGE_KEYS.RIDER_AUTH : STORAGE_KEYS.OWNER_AUTH);
    sessionStorage.removeItem(key);
    if (role === 'admin') {
      sessionStorage.removeItem('quickbite_admin_token');
    } else if (role === 'owner') {
      sessionStorage.removeItem('quickbite_owner_token');
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

  // 2. Rider verification (strictly registered riders created by Admin or default fleet)
  if (role === 'rider') {
    if (typeof localStorage === 'undefined') {
      return false; // Safely fail in non-browser Node.js environments
    }

    // Check if cleanPin matches any default fleet rider PIN hashes
    if (DEFAULT_RIDER_PIN_HASHES.includes(inputHash)) {
      return true;
    }

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

    const defaultPins = ['2233', '4422', '4455', '8811'];
    return defaultPins.includes(cleanPin);
  }

  return false;
}
