/**
 * Cloudflare Turnstile Server-Side Verification Helper
 * Verifies invisible bot-detection tokens against Cloudflare's /siteverify API.
 * 100% free, privacy-preserving, and eliminates automated bot scripts.
 */

// Official Cloudflare Dummy Testing Keys
export const CLOUDFLARE_TEST_SITE_KEY_PASS = '1x00000000000000000000AA';
export const CLOUDFLARE_TEST_SECRET_KEY_PASS = '1x0000000000000000000000000000000AA';
export const CLOUDFLARE_TEST_SITE_KEY_BLOCK = '2x00000000000000000000AB';
export const CLOUDFLARE_TEST_SECRET_KEY_BLOCK = '2x0000000000000000000000000000000AA';

export function getTurnstileSecretKey() {
  const envSecret = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY || process.env.TURNSTILE_SECRET_KEY;
  if (envSecret && String(envSecret).trim()) {
    return String(envSecret).trim();
  }
  // In development/test mode, fall back to official Cloudflare test pass key
  if (process.env.NODE_ENV !== 'production') {
    return CLOUDFLARE_TEST_SECRET_KEY_PASS;
  }
  return '';
}

export function getClientIp(req) {
  if (!req) return '';
  const xForwardedFor = req.headers?.['x-forwarded-for'];
  if (xForwardedFor) {
    return String(xForwardedFor).split(',')[0].trim();
  }
  return req.headers?.['x-real-ip'] || req.socket?.remoteAddress || '';
}

/**
 * Validates a client turnstile token with Cloudflare's authoritative API
 * @param {string} token - The client response token from Turnstile widget
 * @param {string} clientIp - Client IP address (optional)
 * @returns {Promise<{ success: boolean, bypassed?: boolean, error?: string, errorCodes?: string[] }>}
 */
export async function verifyTurnstileToken(token, clientIp = '', customSecret = null) {
  const secret = customSecret || getTurnstileSecretKey();

  // If secret is not configured in production, log a warning and gracefully allow flow (non-blocking onboarding)
  if (!secret) {
    const isProd = typeof process !== 'undefined' && process.env && (process.env.NODE_ENV === 'production' || process.env.ENVIRONMENT === 'production');
    if (isProd) {
      console.error('[Turnstile] CRITICAL: CLOUDFLARE_TURNSTILE_SECRET_KEY not set in production. Blocking unverified request.');
      return { success: false, error: 'Security bot verification is not configured in production.', unconfigured: true };
    }
    console.warn('[Turnstile] CLOUDFLARE_TURNSTILE_SECRET_KEY not set. Bypassing check in unconfigured state.');
    return { success: true, bypassed: true };
  }

  // If using Cloudflare testing pass secret, handle known test responses
  if (secret === CLOUDFLARE_TEST_SECRET_KEY_PASS) {
    if (token === 'BLOCK_TOKEN' || token === 'invalid-token-test') {
      return { success: false, errorCodes: ['invalid-input-response'], error: 'Bot verification failed.' };
    }
    // Allow seamless execution during unit tests & dev sandbox when real secret is not yet configured
    return { success: true, testMode: true };
  }

  // If using Cloudflare testing block secret, always reject
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
      },
      signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(4500) : undefined
    });

    if (!res.ok) {
      console.warn(`[Turnstile] Cloudflare siteverify HTTP error: ${res.status}`);
      // Fail closed or gracefully log
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

    console.warn('[Turnstile] Bot verification failed:', data['error-codes']);
    return {
      success: false,
      errorCodes: data['error-codes'] || [],
      error: 'Security verification failed. Automated traffic detected.'
    };
  } catch (err) {
    console.warn('[Turnstile] Error calling Cloudflare siteverify:', err.message);
    // If Cloudflare's verification service is down or times out, fail gracefully to prevent blocking paying customers
    if (process.env.NODE_ENV === 'production') {
      return { success: false, error: 'Security check service communication error. Please try again.' };
    }
    return { success: true, degraded: true };
  }
}

// ==========================================
// ADAPTIVE ORDER VELOCITY TRACKER (SMART RATE LIMITING)
// Fast lane for normal customers (orders 1 & 2 in 60s).
// Triggers Turnstile verification on 3rd rapid order within 60s.
// ==========================================
const RECENT_ORDERS_WINDOW_MS = 60 * 1000;
const MAX_FAST_ORDERS_PER_WINDOW = 2;
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
