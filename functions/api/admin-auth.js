/**
 * Cloudflare Pages Function: Admin Authentication Endpoint
 * POST /api/admin-auth
 * Validates the manager PIN against server-side configuration and issues
 * a cryptographically signed HMAC bearer token for privileged operations.
 */
import { verifyAdminPin, createAdminToken, signPayload, verifySignedPayload, getPinRole, safeEqual, signData } from './_auth.js';
import { hydrateEnv, isOriginAllowed, jsonResponse } from './_adapter.js';

const FAILED_ATTEMPTS = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const COOKIE_NAME = 'qb_auth_rl';

function parseCookies(cookieHeader) {
  if (!cookieHeader || typeof cookieHeader !== 'string') return {};
  const cookies = {};
  cookieHeader.split(';').forEach(c => {
    const idx = c.indexOf('=');
    if (idx > -1) {
      cookies[c.slice(0, idx).trim()] = c.slice(idx + 1).trim();
    }
  });
  return cookies;
}

function getClientIp(request) {
  return request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-real-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';
}

export async function onRequest(context) {
  hydrateEnv(context);
  const { request, env } = context;
  const origin = request.headers.get('origin');

  const corsHeaders = new Headers();
  if (origin && isOriginAllowed(origin)) {
    corsHeaders.set('Access-Control-Allow-Origin', origin);
    corsHeaders.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    corsHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-token');
    corsHeaders.set('Access-Control-Allow-Credentials', 'true');
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    corsHeaders.set('Allow', 'POST, OPTIONS');
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  }

  const clientIp = getClientIp(request);
  const cookies = parseCookies(request.headers.get('cookie'));
  const cookiePayload = verifySignedPayload(cookies[COOKIE_NAME], env);

  const now = Date.now();
  let memRecord = FAILED_ATTEMPTS.get(clientIp);
  if (memRecord && now - memRecord.firstAttempt > LOCKOUT_WINDOW_MS) {
    FAILED_ATTEMPTS.delete(clientIp);
    memRecord = null;
  }

  const cookieRecord = (cookiePayload && cookiePayload.ip === clientIp && (now - cookiePayload.firstAttempt < LOCKOUT_WINDOW_MS)) ? cookiePayload : null;
  const currentCount = Math.max(memRecord?.count || 0, cookieRecord?.count || 0);
  const lockedUntil = Math.max(memRecord?.lockedUntil || 0, cookieRecord?.lockedUntil || 0);

  if ((lockedUntil && now < lockedUntil) || currentCount >= MAX_ATTEMPTS) {
    const remainingSecs = Math.max(1, Math.ceil(((lockedUntil || (memRecord?.firstAttempt || now) + LOCKOUT_WINDOW_MS) - now) / 1000));
    corsHeaders.set('Retry-After', String(remainingSecs));
    return new Response(JSON.stringify({
      error: `Too many failed login attempts. Temporarily locked out. Please try again in ${Math.ceil(remainingSecs / 60)} minutes.`,
      lockedOut: true,
      retryAfterSeconds: remainingSecs
    }), { status: 429, headers: corsHeaders });
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const isRefresh = body?.action === 'refresh' || Boolean(body?.refreshToken);
  if (isRefresh) {
    const authHeader = request.headers.get('authorization');
    const rawToken = body?.token || body?.refreshToken || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null);
    if (rawToken && typeof rawToken === 'string' && rawToken.includes('.')) {
      const parts = rawToken.split('.');
      if (parts.length === 2) {
        const [payloadB64, signature] = parts;
        const expectedSignature = signData(payloadB64, env);
        if (safeEqual(signature, expectedSignature)) {
          try {
            const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
            if (payload && (payload.role === 'admin' || payload.role === 'owner' || payload.role === 'rider')) {
              const refreshedToken = createAdminToken(undefined, payload.role, env);
              return jsonResponse({
                success: true,
                token: refreshedToken,
                role: payload.role,
                expiresIn: 43200
              }, 200, Object.fromEntries(corsHeaders.entries()));
            }
          } catch {}
        }
      }
    }
    return jsonResponse({ error: 'Invalid or expired session. Please re-authenticate.' }, 401, Object.fromEntries(corsHeaders.entries()));
  }

  const inputPin = body?.pin;
  if (!inputPin) {
    return jsonResponse({ error: 'Manager passcode required' }, 400, Object.fromEntries(corsHeaders.entries()));
  }

  const role = getPinRole(inputPin, env);
  if (!role) {
    const newCount = currentCount + 1;
    const firstAttempt = memRecord?.firstAttempt || cookieRecord?.firstAttempt || now;
    const newLockedUntil = newCount >= MAX_ATTEMPTS ? now + LOCKOUT_WINDOW_MS : 0;
    FAILED_ATTEMPTS.set(clientIp, { count: newCount, firstAttempt, lockedUntil: newLockedUntil });

    const maxAge = Math.ceil(LOCKOUT_WINDOW_MS / 1000);
    const signedCookie = signPayload({ ip: clientIp, count: newCount, firstAttempt, lockedUntil: newLockedUntil }, env);
    corsHeaders.set('Set-Cookie', `${COOKIE_NAME}=${signedCookie}; HttpOnly; SameSite=Strict; Secure; Path=/api/admin-auth; Max-Age=${maxAge}`);

    const remainingAttempts = Math.max(0, MAX_ATTEMPTS - newCount);
    const errorMsg = remainingAttempts > 0
      ? `Invalid passcode. ${remainingAttempts} attempt${remainingAttempts === 1 ? '' : 's'} remaining.`
      : 'Passcode limit reached. Access temporarily locked for 15 minutes.';

    return jsonResponse({
      error: errorMsg,
      remainingAttempts,
      lockedOut: newCount >= MAX_ATTEMPTS
    }, 401, Object.fromEntries(corsHeaders.entries()));
  }

  // Clear rate limits upon successful login
  FAILED_ATTEMPTS.delete(clientIp);
  corsHeaders.set('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Secure; Path=/api/admin-auth; Max-Age=0`);

  const token = createAdminToken(undefined, role, env);
  return jsonResponse({
    success: true,
    token,
    role,
    expiresIn: 43200
  }, 200, Object.fromEntries(corsHeaders.entries()));
}
