/**
 * Cloudflare Pages Functions Request/Response & Environment Adapter
 * Provides standardized Web Request handling, CORS resolution, and environment hydration.
 */

export const ALLOWED_ORIGINS = [
  'https://foodbliz.in',
  'https://www.foodbliz.in',
  'https://saveraparadise.com',
  'https://www.saveraparadise.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://localhost:8788' // Cloudflare Pages Wrangler dev server
];

export function isOriginAllowed(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    if (
      host === 'saveraparadise.com' ||
      host.endsWith('.saveraparadise.com') ||
      host === 'foodbliz.in' ||
      host.endsWith('.foodbliz.in') ||
      host === 'saveraparadise.vercel.app' ||
      (host.startsWith('saveraparadise-') && host.endsWith('.vercel.app')) ||
      host.endsWith('.pages.dev') ||
      host === 'localhost' ||
      host === '127.0.0.1'
    ) {
      return true;
    }
  } catch {}
  return false;
}

export function hydrateEnv(context) {
  if (context && context.env && typeof process !== 'undefined' && process.env) {
    Object.assign(process.env, context.env);
  }
}

export function getClientIp(request) {
  if (!request) return '';
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-real-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    ''
  );
}

export function jsonResponse(data, status = 200, customHeaders = {}) {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    ...customHeaders
  });
  return new Response(JSON.stringify(data), { status, headers });
}

export function handleCors(request, allowedMethods = 'POST, OPTIONS', extraHeaders = '') {
  const origin = request.headers.get('origin');
  const headers = new Headers();
  if (origin && isOriginAllowed(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', allowedMethods);
    const allowHeaders = extraHeaders
      ? `Content-Type, Authorization, x-admin-token, ${extraHeaders}`
      : 'Content-Type, Authorization, x-admin-token';
    headers.set('Access-Control-Allow-Headers', allowHeaders);
    headers.set('Access-Control-Allow-Credentials', 'true');
  }
  return headers;
}
