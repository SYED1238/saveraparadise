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
  if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production') {
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
