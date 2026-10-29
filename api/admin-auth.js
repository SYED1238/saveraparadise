/**
 * Serverless Admin Authentication Endpoint
 * POST /api/admin-auth
 * Validates the manager PIN against server-side configuration and issues
 * a cryptographically signed HMAC bearer token for privileged operations.
 * Implements persistent serverless rate limiting using both in-memory caching
 * and signed cryptographic state cookies to withstand container cold starts.
 */
import { verifyAdminPin, createAdminToken, signPayload, verifySignedPayload, signData, safeEqual, getPinRole } from './_auth.js';

// Fast in-memory rate limiting layer for active container lifetime
const FAILED_ATTEMPTS = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const COOKIE_NAME = 'qb_auth_rl';

function parseCookies(cookieHeader) {
  if (!cookieHeader || typeof cookieHeader !== 'string') return {};
  const cookies = {};
  cookieHeader.split(';').forEach(c => {
    const idx = c.indexOf('=');
    if (idx > -1) {
      const name = c.slice(0, idx).trim();
      const val = c.slice(idx + 1).trim();
      cookies[name] = val;
    }
  });
  return cookies;
}

function getRateLimitRecord(req, clientIp) {
  const now = Date.now();
  // 1. In-memory check
  let memRecord = FAILED_ATTEMPTS.get(clientIp);
  if (memRecord && now - memRecord.firstAttempt > LOCKOUT_WINDOW_MS) {
    FAILED_ATTEMPTS.delete(clientIp);
    memRecord = null;
  }

  // 2. Signed cryptographic cookie check (persists across serverless container restarts)
  const cookies = parseCookies(req.headers?.cookie);
  const cookiePayload = verifySignedPayload(cookies[COOKIE_NAME]);
  let cookieRecord = null;
  if (cookiePayload && cookiePayload.ip === clientIp && (now - cookiePayload.firstAttempt < LOCKOUT_WINDOW_MS)) {
    cookieRecord = cookiePayload;
  }

  // Merge the most restrictive count
  const count = Math.max(memRecord?.count || 0, cookieRecord?.count || 0);
  const firstAttempt = memRecord?.firstAttempt || cookieRecord?.firstAttempt || now;
  const lockedUntil = Math.max(memRecord?.lockedUntil || 0, cookieRecord?.lockedUntil || 0);

  return { count, firstAttempt, lockedUntil };
}

function isRateLimited(record) {
  const now = Date.now();
  if (record.lockedUntil && now < record.lockedUntil) return true;
  return record.count >= MAX_ATTEMPTS;
}

function setRateLimitCookie(res, clientIp, newCount, firstAttempt, lockedUntil) {
  const maxAge = Math.ceil(LOCKOUT_WINDOW_MS / 1000);
  const signed = signPayload({ ip: clientIp, count: newCount, firstAttempt, lockedUntil });
  const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${signed}; HttpOnly; SameSite=Strict${secureFlag}; Path=/api/admin-auth; Max-Age=${maxAge}`);
}

function clearRateLimitCookie(res) {
  const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict${secureFlag}; Path=/api/admin-auth; Max-Age=0`);
}

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
  'http://localhost:3000'
];

function isOriginAllowed(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    if (host === 'saveraparadise.com' || host.endsWith('.saveraparadise.com')) return true;
    if (host === 'foodbliz.in' || host.endsWith('.foodbliz.in')) return true;
    if (host === 'saveraparadise.vercel.app' || (host.startsWith('saveraparadise-') && host.endsWith('.vercel.app'))) return true;
  } catch {}
  return false;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawIp = req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
  const clientIp = typeof rawIp === 'string' ? rawIp.split(',')[0].trim() : 'unknown';

  const rateRecord = getRateLimitRecord(req, clientIp);
  if (isRateLimited(rateRecord)) {
    return res.status(429).json({
      error: 'Too many failed passcode attempts. Please try again in 15 minutes.'
    });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  const isRefresh = body?.action === 'refresh' || Boolean(body?.refreshToken);
  if (isRefresh) {
    const rawToken = body?.token || body?.refreshToken || (req.headers['authorization']?.startsWith('Bearer ') ? req.headers['authorization'].slice(7) : null);
    if (rawToken && typeof rawToken === 'string' && rawToken.includes('.')) {
      const parts = rawToken.split('.');
      if (parts.length === 2) {
        const [payloadB64, signature] = parts;
        const expectedSignature = signData(payloadB64);
        if (safeEqual(signature, expectedSignature)) {
          try {
            const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
            if (payload && (payload.role === 'admin' || payload.role === 'owner')) {
              const maxRefreshAge = 24 * 60 * 60 * 1000;
              if (Date.now() - (payload.iat || 0) < maxRefreshAge) {
                const refreshedToken = createAdminToken(undefined, payload.role);
                return res.status(200).json({
                  success: true,
                  token: refreshedToken,
                  role: payload.role,
                  expiresIn: 43200
                });
              }
            }
          } catch {}
        }
      }
    }
    return res.status(401).json({ error: 'Invalid or expired session. Please re-authenticate.' });
  }

  const pin = body?.pin;
  if (!pin || typeof pin !== 'string') {
    return res.status(400).json({ error: 'Passcode is required' });
  }

  const role = getPinRole(pin);
  if (!role) {
    const newCount = rateRecord.count + 1;
    const now = Date.now();
    const firstAttempt = rateRecord.count > 0 ? rateRecord.firstAttempt : now;
    const lockedUntil = newCount >= MAX_ATTEMPTS ? now + LOCKOUT_WINDOW_MS : 0;

    FAILED_ATTEMPTS.set(clientIp, { count: newCount, firstAttempt, lockedUntil });
    setRateLimitCookie(res, clientIp, newCount, firstAttempt, lockedUntil);

    return res.status(401).json({ error: 'Invalid manager passcode' });
  }

  FAILED_ATTEMPTS.delete(clientIp);
  clearRateLimitCookie(res);
  const token = createAdminToken(undefined, role);

  return res.status(200).json({
    success: true,
    token,
    role,
    expiresIn: 43200 // 12 hours in seconds
  });
}
