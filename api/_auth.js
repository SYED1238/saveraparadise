/**
 * Server-Side Authentication & Session Verification Helper
 * Used by serverless API endpoints (/api/r2-*) and Vite local dev server.
 * Ensures privileged storage and admin operations require cryptographically signed tokens.
 */
import crypto from 'crypto';

// Server-side signing secret: never exposed to browser bundles
let devEphemeralSecret = null;

function getSigningSecret() {
  const secret = process.env.SESSION_SECRET || process.env.R2_SECRET_ACCESS_KEY;
  if (secret && secret !== 'change_me_to_a_random_32_character_string') {
    return secret;
  }
  // In development/test without configured secret, generate an ephemeral random 32-byte key
  if (!devEphemeralSecret) {
    devEphemeralSecret = crypto.randomBytes(32).toString('hex');
  }
  return devEphemeralSecret;
}

function getAdminPin() {
  return process.env.ADMIN_PIN || '8899';
}

const TOKEN_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours

/**
 * Constant-time string comparison to prevent timing attacks
 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Computes HMAC-SHA256 signature for data string
 */
function signData(data) {
  return crypto.createHmac('sha256', getSigningSecret()).update(data).digest('hex');
}

/**
 * Creates a signed admin session token.
 * Token format: <base64Payload>.<signatureHex>
 */
export function createAdminToken(customExpiresInMs = TOKEN_MAX_AGE_MS) {
  const now = Date.now();
  const payload = {
    role: 'admin',
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

    if (payload.role !== 'admin') {
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
 * Verifies a submitted admin PIN against server-side configuration.
 */
export function verifyAdminPin(inputPin) {
  if (!inputPin) return false;
  const cleanPin = String(inputPin).trim();
  if (!/^\d{4}$/.test(cleanPin)) return false;

  // Primary check: Direct match against configured ADMIN_PIN (defaults to 8899 if unconfigured)
  const expectedPin = getAdminPin();
  if (expectedPin && safeEqual(cleanPin, expectedPin)) {
    return true;
  }

  // Secondary check: Compare with ADMIN_PIN_HASH if configured on server
  if (process.env.ADMIN_PIN_HASH) {
    const hash = crypto.createHash('sha256').update(`quickbite_salt_${cleanPin}`).digest('hex');
    if (safeEqual(hash, process.env.ADMIN_PIN_HASH)) {
      return true;
    }
  }

  return false;
}
