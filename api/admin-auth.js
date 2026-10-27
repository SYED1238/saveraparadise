/**
 * Serverless Admin Authentication Endpoint
 * POST /api/admin-auth
 * Validates the manager PIN against server-side configuration and issues
 * a cryptographically signed HMAC bearer token for privileged operations.
 * Implements persistent serverless rate limiting using both in-memory caching
 * and signed cryptographic state cookies to withstand container cold starts.
 */
import { verifyAdminPin, createAdminToken, signPayload, verifySignedPayload } from './_auth.js';

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
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${signed}; HttpOnly; SameSite=Strict; Path=/api/admin-auth; Max-Age=${maxAge}`);
}

function clearRateLimitCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/api/admin-auth; Max-Age=0`);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
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

  const pin = body?.pin;
  if (!pin || typeof pin !== 'string') {
    return res.status(400).json({ error: 'Passcode is required' });
  }

  const isValid = verifyAdminPin(pin);
  if (!isValid) {
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
  const token = createAdminToken();

  return res.status(200).json({
    success: true,
    token,
    role: 'admin',
    expiresIn: 43200 // 12 hours in seconds
  });
}
