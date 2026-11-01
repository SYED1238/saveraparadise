/**
 * Server-Side Authentication & Session Verification Helper for Cloudflare Pages Functions
 * Ensures privileged storage and admin operations require cryptographically signed tokens.
 * Enforces production security gates: strictly disallows default PINs or ephemeral secrets in production.
 */
import crypto from 'node:crypto';

let devEphemeralSecret = null;

export function getSigningSecret(env = null) {
  const secret = (env && env.SESSION_SECRET) || (typeof process !== 'undefined' && process.env && process.env.SESSION_SECRET);
  if (secret && secret.length >= 32 && secret !== 'change_me_to_a_random_32_character_string') {
    return secret;
  }
  const r2Secret = (env && env.R2_SECRET_ACCESS_KEY) || (typeof process !== 'undefined' && process.env && process.env.R2_SECRET_ACCESS_KEY);
  if (r2Secret && r2Secret.length >= 16) {
    return r2Secret;
  }
  const isProd = (env && (env.NODE_ENV === 'production' || env.ENVIRONMENT === 'production')) ||
    (typeof process !== 'undefined' && process.env && (process.env.NODE_ENV === 'production' || process.env.ENVIRONMENT === 'production'));
  if (isProd) {
    throw new Error('[Security] CRITICAL: Dedicated SESSION_SECRET (min 32 characters) must be configured in production environment.');
  }
  if (!devEphemeralSecret) {
    devEphemeralSecret = crypto.randomBytes(32).toString('hex');
  }
  return devEphemeralSecret;
}

export function getAdminPin(env = null) {
  const envPin = (env && env.ADMIN_PIN) || (typeof process !== 'undefined' && process.env && process.env.ADMIN_PIN);
  if (envPin && String(envPin).trim()) {
    return String(envPin).trim();
  }
  const isProd = (env && (env.NODE_ENV === 'production' || env.ENVIRONMENT === 'production')) ||
    (typeof process !== 'undefined' && process.env && (process.env.NODE_ENV === 'production' || process.env.ENVIRONMENT === 'production'));
  if (!isProd) {
    return '8899';
  }
  return '';
}

export function getOwnerPin(env = null) {
  const envPin = (env && env.OWNER_PIN) || (typeof process !== 'undefined' && process.env && process.env.OWNER_PIN);
  if (envPin && String(envPin).trim()) {
    return String(envPin).trim();
  }
  const isProd = (env && (env.NODE_ENV === 'production' || env.ENVIRONMENT === 'production')) ||
    (typeof process !== 'undefined' && process.env && (process.env.NODE_ENV === 'production' || process.env.ENVIRONMENT === 'production'));
  if (!isProd) {
    return '9900';
  }
  return '';
}

const TOKEN_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function signData(data, env = null) {
  return crypto.createHmac('sha256', getSigningSecret(env)).update(data).digest('hex');
}

export function signPayload(data, env = null) {
  const serialized = Buffer.from(JSON.stringify(data)).toString('base64url');
  const signature = crypto.createHmac('sha256', getSigningSecret(env)).update(serialized).digest('base64url');
  return `${serialized}.${signature}`;
}

export function verifySignedPayload(signedString, env = null) {
  if (!signedString || typeof signedString !== 'string' || !signedString.includes('.')) return null;
  const [serialized, signature] = signedString.split('.');
  const expectedSig = crypto.createHmac('sha256', getSigningSecret(env)).update(serialized).digest('base64url');
  if (!safeEqual(signature, expectedSig)) return null;
  try {
    return JSON.parse(Buffer.from(serialized, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function createAdminToken(customExpiresInMs = TOKEN_MAX_AGE_MS, role = 'admin', env = null) {
  const now = Date.now();
  const payload = {
    role: (role === 'owner' ? 'owner' : 'admin'),
    iat: now,
    exp: now + customExpiresInMs,
    nonce: crypto.randomBytes(16).toString('hex')
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = signData(payloadB64, env);
  return `${payloadB64}.${signature}`;
}

export function verifyAdminToken(reqOrHeaders, env = null) {
  let authHeader = null;
  if (reqOrHeaders) {
    if (typeof reqOrHeaders.headers?.get === 'function') {
      authHeader = reqOrHeaders.headers.get('authorization') || reqOrHeaders.headers.get('x-admin-token');
    } else if (reqOrHeaders.headers) {
      authHeader = reqOrHeaders.headers['authorization'] || reqOrHeaders.headers['x-admin-token'];
    } else if (typeof reqOrHeaders === 'string') {
      authHeader = reqOrHeaders;
    }
  }

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
  const expectedSignature = signData(payloadB64, env);
  if (!safeEqual(signature, expectedSignature)) {
    return { valid: false, error: 'Invalid token signature' };
  }

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

export function getPinRole(inputPin, env = null) {
  if (!inputPin) return null;
  const cleanPin = String(inputPin).trim();
  if (!/^\d{4,8}$/.test(cleanPin)) return null;

  const expectedOwnerPin = getOwnerPin(env);
  if (expectedOwnerPin && safeEqual(cleanPin, expectedOwnerPin)) {
    return 'owner';
  }

  const expectedAdminPin = getAdminPin(env);
  if (expectedAdminPin && safeEqual(cleanPin, expectedAdminPin)) {
    return 'admin';
  }

  return null;
}

export function verifyAdminPin(inputPin, env = null) {
  return getPinRole(inputPin, env) !== null;
}
