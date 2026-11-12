/**
 * Cloudflare Turnstile Server-Side Verification Helper for Cloudflare Pages Functions
 * Verifies invisible bot-detection tokens against Cloudflare's /siteverify API.
 */

export const CLOUDFLARE_TEST_SITE_KEY_PASS = '1x00000000000000000000AA';
export const CLOUDFLARE_TEST_SECRET_KEY_PASS = '1x0000000000000000000000000000000AA';
export const CLOUDFLARE_TEST_SITE_KEY_BLOCK = '2x00000000000000000000AB';
export const CLOUDFLARE_TEST_SECRET_KEY_BLOCK = '2x0000000000000000000000000000000AA';

export function getTurnstileSecretKey(env = null) {
  const envSecret = (env && (env.CLOUDFLARE_TURNSTILE_SECRET_KEY || env.TURNSTILE_SECRET_KEY)) ||
    (typeof process !== 'undefined' && process.env && (process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY || process.env.TURNSTILE_SECRET_KEY));
  if (envSecret && String(envSecret).trim()) {
    return String(envSecret).trim();
  }
  const isProd = (env && (env.NODE_ENV === 'production' || env.ENVIRONMENT === 'production')) ||
    (typeof process !== 'undefined' && process.env && (process.env.NODE_ENV === 'production' || process.env.ENVIRONMENT === 'production'));
  if (!isProd) {
    return CLOUDFLARE_TEST_SECRET_KEY_PASS;
  }
  return '';
}

export function getClientIp(requestOrReq) {
  if (!requestOrReq) return '';
  if (typeof requestOrReq.headers?.get === 'function') {
    return (
      requestOrReq.headers.get('cf-connecting-ip') ||
      requestOrReq.headers.get('x-real-ip') ||
      requestOrReq.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      ''
    );
  }
  const xForwardedFor = requestOrReq.headers?.['x-forwarded-for'];
  if (xForwardedFor) {
    return String(xForwardedFor).split(',')[0].trim();
  }
  return requestOrReq.headers?.['x-real-ip'] || requestOrReq.socket?.remoteAddress || '';
}

export async function verifyTurnstileToken(token, clientIp = '', customSecret = null, env = null) {
  const secret = customSecret || getTurnstileSecretKey(env);

  if (!secret) {
    const isProd = (env && (env.NODE_ENV === 'production' || env.ENVIRONMENT === 'production')) ||
      (typeof process !== 'undefined' && process.env && (process.env.NODE_ENV === 'production' || process.env.ENVIRONMENT === 'production'));
    if (isProd) {
      console.error('[Turnstile] CRITICAL: CLOUDFLARE_TURNSTILE_SECRET_KEY not set in production. Blocking unverified request.');
      return { success: false, error: 'Security bot verification is not configured in production.', unconfigured: true };
    }
    console.warn('[Turnstile] CLOUDFLARE_TURNSTILE_SECRET_KEY not set. Bypassing check in unconfigured state.');
    return { success: true, bypassed: true };
  }

  if (secret === CLOUDFLARE_TEST_SECRET_KEY_PASS) {
    if (token === 'BLOCK_TOKEN' || token === 'invalid-token-test') {
      return { success: false, errorCodes: ['invalid-input-response'], error: 'Bot verification failed.' };
    }
    return { success: true, testMode: true };
  }

  if (secret === CLOUDFLARE_TEST_SECRET_KEY_BLOCK) {
    return { success: false, errorCodes: ['invalid-input-response'], error: 'Bot verification blocked by test key.' };
  }

  if (!token || typeof token !== 'string' || !token.trim()) {
    return { success: false, errorCodes: ['missing-input-response'], error: 'Please complete the security check.' };
  }

  try {
    const formData = new URLSearchParams();
    formData.append('secret', secret);
    formData.append('response', token.trim());
    if (clientIp) {
      formData.append('remoteip', clientIp);
    }

    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    if (!res.ok) {
      return { success: false, error: 'Security verification service unavailable. Please retry.' };
    }

    const data = await res.json();
    if (data.success === true) {
      return {
        success: true,
        hostname: data.hostname,
        challengeTs: data.challenge_ts
      };
    }

    return {
      success: false,
      errorCodes: data['error-codes'] || ['invalid-input-response'],
      error: 'Security challenge verification failed. Please try again.'
    };
  } catch (err) {
    return { success: false, error: 'Security check service communication error.' };
  }
}

// ==========================================
// ADAPTIVE ORDER VELOCITY TRACKER (SMART RATE LIMITING)
// Fast lane for normal customers (1st order in 60s).
// Triggers Turnstile verification when 2 or more orders are placed within 60s.
// ==========================================
const RECENT_ORDERS_WINDOW_MS = 60 * 1000;
const MAX_FAST_ORDERS_PER_WINDOW = 1;
const velocityHistory = new Map();

export function checkOrderVelocity(identifier) {
  if (!identifier) return { allowedWithoutToken: true, recentCount: 0 };
  const now = Date.now();
  const cutoff = now - RECENT_ORDERS_WINDOW_MS;

  let timestamps = velocityHistory.get(identifier) || [];
  timestamps = timestamps.filter(t => t > cutoff);

  const count = timestamps.length;
  if (count >= MAX_FAST_ORDERS_PER_WINDOW) {
    return {
      allowedWithoutToken: false,
      recentCount: count,
      requiresChallenge: true
    };
  }

  return {
    allowedWithoutToken: true,
    recentCount: count,
    requiresChallenge: false
  };
}

export function recordOrderVelocity(identifier) {
  if (!identifier) return;
  const now = Date.now();
  const cutoff = now - RECENT_ORDERS_WINDOW_MS;
  let timestamps = velocityHistory.get(identifier) || [];
  timestamps = timestamps.filter(t => t > cutoff);
  timestamps.push(now);
  velocityHistory.set(identifier, timestamps);

  if (velocityHistory.size > 2000) {
    for (const [k, v] of velocityHistory.entries()) {
      const active = v.filter(t => t > cutoff);
      if (active.length === 0) velocityHistory.delete(k);
      else velocityHistory.set(k, active);
    }
  }
}

export function resetOrderVelocity(identifier) {
  if (identifier) velocityHistory.delete(identifier);
  else velocityHistory.clear();
}
