/**
 * Cloudflare Pages Function: Ola Maps Proxy & Edge Caching Endpoint
 * GET /api/ola-maps?action=reverse&lat=12.7208891&lng=77.2805103
 * GET /api/ola-maps?action=autocomplete&input=Tippu
 * GET /api/ola-maps?action=tile&z=15&x=23114&y=15228
 */
import { hydrateEnv, isOriginAllowed, jsonResponse } from './_adapter.js';

const RATE_LIMIT_MAP = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 40;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = RATE_LIMIT_MAP.get(ip) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW_MS };
  if (now > entry.resetTime) {
    entry.count = 1;
    entry.resetTime = now + RATE_LIMIT_WINDOW_MS;
    RATE_LIMIT_MAP.set(ip, entry);
    return false;
  }
  entry.count += 1;
  RATE_LIMIT_MAP.set(ip, entry);
  return entry.count > MAX_REQUESTS_PER_WINDOW;
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
  const origin = request.headers.get('origin') || '';

  const corsHeaders = new Headers();
  if (origin && isOriginAllowed(origin)) {
    corsHeaders.set('Access-Control-Allow-Origin', origin);
  }
  corsHeaders.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  corsHeaders.set('Access-Control-Allow-Headers', 'Content-Type');

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (request.method !== 'GET') {
    corsHeaders.set('Allow', 'GET, OPTIONS');
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers: corsHeaders });
  }

  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const lat = url.searchParams.get('lat');
  const lng = url.searchParams.get('lng');
  const input = url.searchParams.get('input');
  const z = url.searchParams.get('z');
  const x = url.searchParams.get('x');
  const y = url.searchParams.get('y');

  const clientIp = getClientIp(request);
  if (action !== 'tile' && isRateLimited(clientIp)) {
    return jsonResponse({ error: 'Too many requests. Please slow down.' }, 429, Object.fromEntries(corsHeaders.entries()));
  }

  const OLA_API_KEY = (env && env.OLA_MAPS_API_KEY) ||
    (typeof process !== 'undefined' && process.env && process.env.OLA_MAPS_API_KEY) || '';
  const STORE_LAT = (env && env.STORE_LAT) ||
    (typeof process !== 'undefined' && process.env && process.env.STORE_LAT) || '12.7208891';
  const STORE_LNG = (env && env.STORE_LNG) ||
    (typeof process !== 'undefined' && process.env && process.env.STORE_LNG) || '77.2805103';

  if (action === 'tile') {
    const parsedZ = parseInt(z, 10);
    const parsedX = parseInt(x, 10);
    const parsedY = parseInt(y, 10);
    if (isNaN(parsedZ) || isNaN(parsedX) || isNaN(parsedY) || parsedZ < 0 || parsedZ > 22 || parsedX < 0 || parsedY < 0) {
      return jsonResponse({ error: 'Invalid tile coordinates' }, 400, Object.fromEntries(corsHeaders.entries()));
    }

    const tileHeaders = new Headers(corsHeaders);
    tileHeaders.set('Content-Type', 'image/png');
    tileHeaders.set('Cache-Control', 'public, max-age=86400, s-maxage=604800, immutable');
    tileHeaders.set('X-Content-Type-Options', 'nosniff');

    if (OLA_API_KEY) {
      try {
        const tileUrl = `https://api.olamaps.io/tiles/vector/v1/styles/default-light-standard/${parsedZ}/${parsedX}/${parsedY}.png?api_key=${encodeURIComponent(OLA_API_KEY)}`;
        const response = await fetch(tileUrl, { headers: { 'Accept': 'image/png' } });
        if (response.ok) {
          return new Response(response.body, { status: 200, headers: tileHeaders });
        }
      } catch (tileErr) {
        console.warn('[Ola Maps Tile Proxy] Primary tile fetch failed, using fallback:', tileErr.message);
      }
    }

    try {
      const fallbackRes = await fetch(`https://tile.openstreetmap.org/${parsedZ}/${parsedX}/${parsedY}.png`, {
        headers: { 'User-Agent': 'SaveraParadise/1.0' }
      });
      if (fallbackRes.ok) {
        return new Response(fallbackRes.body, { status: 200, headers: tileHeaders });
      }
    } catch {}

    return new Response(null, { status: 502, headers: corsHeaders });
  }

  if (!OLA_API_KEY) {
    return jsonResponse({ error: 'Ola Maps API key not configured' }, 503, Object.fromEntries(corsHeaders.entries()));
  }

  try {
    if (action === 'reverse') {
      const parsedLat = parseFloat(lat);
      const parsedLng = parseFloat(lng);
      if (isNaN(parsedLat) || isNaN(parsedLng)) {
        return jsonResponse({ error: 'Invalid coordinates' }, 400, Object.fromEntries(corsHeaders.entries()));
      }

      if (parsedLat < 11.0 || parsedLat > 14.5 || parsedLng < 75.0 || parsedLng > 79.0) {
        return jsonResponse({ error: 'Coordinates are outside the restaurant serviceable delivery region' }, 400, Object.fromEntries(corsHeaders.entries()));
      }

      corsHeaders.set('Cache-Control', 'public, s-maxage=86400, max-age=3600, stale-while-revalidate=43200');

      const fetchUrl = `https://api.olamaps.io/places/v1/reverse-geocode?latlng=${parsedLat},${parsedLng}&api_key=${encodeURIComponent(OLA_API_KEY)}`;
      const response = await fetch(fetchUrl, { headers: { 'Accept': 'application/json' } });

      if (!response.ok) {
        return jsonResponse({ error: 'Ola Maps API reverse geocoding failed' }, response.status, Object.fromEntries(corsHeaders.entries()));
      }

      const data = await response.json();
      return jsonResponse(data, 200, Object.fromEntries(corsHeaders.entries()));
    }

    if (action === 'autocomplete') {
      const cleanInput = (input || '').toString().trim().slice(0, 80);
      if (!cleanInput || cleanInput.length < 2) {
        return jsonResponse({ error: 'Search input must be between 2 and 80 characters' }, 400, Object.fromEntries(corsHeaders.entries()));
      }

      corsHeaders.set('Cache-Control', 'public, s-maxage=3600, max-age=600, stale-while-revalidate=1800');

      const fetchUrl = `https://api.olamaps.io/places/v1/autocomplete?input=${encodeURIComponent(cleanInput)}&location=${STORE_LAT},${STORE_LNG}&api_key=${encodeURIComponent(OLA_API_KEY)}`;
      const response = await fetch(fetchUrl, { headers: { 'Accept': 'application/json' } });

      if (!response.ok) {
        return jsonResponse({ error: 'Ola Maps API autocomplete failed' }, response.status, Object.fromEntries(corsHeaders.entries()));
      }

      const data = await response.json();
      return jsonResponse(data, 200, Object.fromEntries(corsHeaders.entries()));
    }

    return jsonResponse({ error: 'Invalid action. Supported: reverse, autocomplete' }, 400, Object.fromEntries(corsHeaders.entries()));
  } catch (error) {
    return jsonResponse({ error: error.message || 'Internal server error in Ola Maps proxy' }, 500, Object.fromEntries(corsHeaders.entries()));
  }
}
