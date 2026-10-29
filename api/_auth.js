/**
 * Server-Side Authentication & Session Verification Helper
 * Used by serverless API endpoints (/api/r2-*) and Vite local dev server.
 * Ensures privileged storage and admin operations require cryptographically signed tokens.
 */
import crypto from 'crypto';

// Server-side signing secret: never exposed to browser bundles
let devEphemeralSecret = null;

function getSigningSecret() {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32 && secret !== 'change_me_to_a_random_32_character_string') {
    return secret;
  }
  // Secondary fallback to R2_SECRET_ACCESS_KEY if configured
  if (process.env.R2_SECRET_ACCESS_KEY && process.env.R2_SECRET_ACCESS_KEY.length >= 16) {
    return process.env.R2_SECRET_ACCESS_KEY;
  }
  // In development/test without configured secret, generate an ephemeral random 32-byte key
  if (process.env.NODE_ENV === 'production') {
    console.warn('[Security] CRITICAL: Dedicated SESSION_SECRET (min 32 chars) should be set in production');
  }
  if (!devEphemeralSecret) {
    devEphemeralSecret = crypto.randomBytes(32).toString('hex');
  }
  return devEphemeralSecret;
}

function getAdminPin() {
  const envPin = process.env.ADMIN_PIN;
  if (envPin && String(envPin).trim()) {
    return String(envPin).trim();
  }
  // In non-production test/development environments, permit default PIN
  if (process.env.NODE_ENV !== 'production') {
    return '8899';
  }
  return '';
}

function getOwnerPin() {
  const envPin = process.env.OWNER_PIN;
  if (envPin && String(envPin).trim()) {
    return String(envPin).trim();
  }
  if (process.env.NODE_ENV !== 'production') {
    return '9900';
  }
  return '';
}

const TOKEN_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours

/**
 * Constant-time string comparison to prevent timing attacks
 */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Computes HMAC-SHA256 signature for data string
 */
export function signData(data) {
  return crypto.createHmac('sha256', getSigningSecret()).update(data).digest('hex');
}

export function signPayload(data) {
  const serialized = Buffer.from(JSON.stringify(data)).toString('base64url');
  const signature = crypto.createHmac('sha256', getSigningSecret()).update(serialized).digest('base64url');
  return `${serialized}.${signature}`;
}

export function verifySignedPayload(signedString) {
  if (!signedString || typeof signedString !== 'string' || !signedString.includes('.')) return null;
  const [serialized, signature] = signedString.split('.');
  const expectedSig = crypto.createHmac('sha256', getSigningSecret()).update(serialized).digest('base64url');
  if (!safeEqual(signature, expectedSig)) return null;
  try {
    return JSON.parse(Buffer.from(serialized, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Creates a signed admin or owner session token.
 * Token format: <base64Payload>.<signatureHex>
 */
export function createAdminToken(customExpiresInMs = TOKEN_MAX_AGE_MS, role = 'admin') {
  const now = Date.now();
  const payload = {
    role: (role === 'owner' ? 'owner' : 'admin'),
    iat: now,
    exp: now + customExpiresInMs,
    nonce: crypto.randomBytes(16).toString('hex')
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = signData(payloadB64);
  return `${payloadB64}.${signature}`;
}

/**
 * Validates a request's admin session token from Authorization or x-admin-token header.
 * Accepts privileged tokens from both Kitchen Admin and Restaurant Owner roles.
 * @param {object} req Incoming HTTP request
 * @returns {{ valid: boolean, error?: string, payload?: object }}
 */
export function verifyAdminToken(req) {
  const authHeader = req.headers['authorization'] || req.headers['x-admin-token'];
  if (!authHeader || typeof authHeader !== 'string') {
    return { valid: false, error: 'Missing authorization header' };
  }

  let token = authHeader.trim();
  if (token.startsWith('Bearer ') || token.startsWith('bearer ')) {
    token = token.slice(7).trim();
  }

  if (!token) {
    return { valid: false, error: 'Empty token' };
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'Malformed token structure' };
  }

  const [payloadB64, signature] = parts;

  // 1. Verify cryptographic signature in constant time
  const expectedSignature = signData(payloadB64);
  if (!safeEqual(signature, expectedSignature)) {
    return { valid: false, error: 'Invalid token signature' };
  }

  // 2. Decode and verify payload
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));

    if (payload.role !== 'admin' && payload.role !== 'owner') {
      return { valid: false, error: 'Insufficient permissions' };
    }

    if (typeof payload.exp !== 'number' || Date.now() > payload.exp) {
      return { valid: false, error: 'Session token has expired' };
    }

    return { valid: true, payload };
  } catch {
    return { valid: false, error: 'Invalid token payload' };
  }
}

/**
 * Identifies the role ('owner', 'admin') for a submitted PIN.
 * @param {string} inputPin 4-digit passcode
 * @returns {'owner' | 'admin' | null}
 */
export function getPinRole(inputPin) {
  if (!inputPin) return null;
  const cleanPin = String(inputPin).trim();
  if (!/^\d{4,8}$/.test(cleanPin)) return null;

  // 1. Check Owner PIN
  const expectedOwnerPin = getOwnerPin();
  if (expectedOwnerPin && safeEqual(cleanPin, expectedOwnerPin)) {
    return 'owner';
  }
  if (process.env.OWNER_PIN_HASH) {
    const hash = crypto.createHash('sha256').update(`quickbite_salt_${cleanPin}`).digest('hex');
    if (safeEqual(hash, process.env.OWNER_PIN_HASH)) {
      return 'owner';
    }
  }

  // 2. Check Admin / Kitchen PIN
  const expectedAdminPin = getAdminPin();
  if (expectedAdminPin && safeEqual(cleanPin, expectedAdminPin)) {
    return 'admin';
  }
  if (process.env.ADMIN_PIN_HASH) {
    const hash = crypto.createHash('sha256').update(`quickbite_salt_${cleanPin}`).digest('hex');
    if (safeEqual(hash, process.env.ADMIN_PIN_HASH)) {
      return 'admin';
    }
  }

  return null;
}

/**
 * Verifies a submitted admin or owner PIN against server-side configuration.
 */
export function verifyAdminPin(inputPin) {
  return getPinRole(inputPin) !== null;
}
