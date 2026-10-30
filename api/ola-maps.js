/**
 * Serverless Ola Maps Proxy & Edge Caching Endpoint
 * GET /api/ola-maps?action=reverse&lat=12.7208891&lng=77.2805103
 * GET /api/ola-maps?action=autocomplete&input=Tippu
 *
 * Security & Performance Hardening:
 * 1. 100% Server-Side: API Key is never sent or exposed to client browsers.
 * 2. Vercel Edge Cache: Caches geocode lookups for 24 hours to preserve quota.
 * 3. Rate-limiting: Blocks abuse or automated crawlers (max 40 req/min per IP).
 */

const OLA_API_KEY = process.env.OLA_MAPS_API_KEY || '';
const STORE_LAT = process.env.STORE_LAT || '12.7208891';
const STORE_LNG = process.env.STORE_LNG || '77.2805103';

// In-memory rate limiting against automated scrapers / spam
const RATE_LIMIT_MAP = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
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

const ALLOWED_ORIGINS = [
  'https://foodbliz.in',
  'https://www.foodbliz.in',
  'https://saveraparadise.com',
  'https://www.saveraparadise.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000'
];

function isOriginAllowed(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === 'saveraparadise.vercel.app' ||
      (host.startsWith('saveraparadise-') && host.endsWith('.vercel.app')) ||
      host === 'foodbliz.in' ||
      host.endsWith('.foodbliz.in') ||
      host === 'saveraparadise.com' ||
      host.endsWith('.saveraparadise.com')
    ) {
      return true;
    }
  } catch {}
  return false;
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allowed = isOriginAllowed(origin);

  if (allowed && origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { action, lat, lng, input, z, x, y } = req.query;

  const rawIp = req.headers['x-real-ip'] || req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  const clientIp = typeof rawIp === 'string' ? rawIp.split(',')[0].trim() : 'unknown';
  if (action !== 'tile' && isRateLimited(clientIp)) {
    return res.status(429).json({ error: 'Too many requests. Please slow down.' });
  }

  // 1. Action: Raster Map Tile Proxy (Secures API key on server & edge-caches tiles)
  if (action === 'tile') {
    const parsedZ = parseInt(z, 10);
    const parsedX = parseInt(x, 10);
    const parsedY = parseInt(y, 10);
    if (isNaN(parsedZ) || isNaN(parsedX) || isNaN(parsedY) || parsedZ < 0 || parsedZ > 22 || parsedX < 0 || parsedY < 0) {
      return res.status(400).json({ error: 'Invalid tile coordinates' });
    }

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (OLA_API_KEY) {
      try {
        const tileUrl = `https://api.olamaps.io/tiles/vector/v1/styles/default-light-standard/${parsedZ}/${parsedX}/${parsedY}.png?api_key=${encodeURIComponent(OLA_API_KEY)}`;
        const response = await fetch(tileUrl, {
          headers: { 'Accept': 'image/png' },
          signal: AbortSignal.timeout(5000)
        });
        if (response.ok) {
          const buf = Buffer.from(await response.arrayBuffer());
          res.statusCode = 200;
          return res.end(buf);
        }
      } catch (tileErr) {
        console.warn('[Ola Maps Tile Proxy] Primary tile fetch failed, using fallback:', tileErr.message);
      }
    }

    // High-res fallback to OpenStreetMap if Ola Maps is unreachable or quota exhausted
    try {
      const fallbackRes = await fetch(`https://tile.openstreetmap.org/${parsedZ}/${parsedX}/${parsedY}.png`, {
        headers: { 'User-Agent': 'SaveraParadise/1.0' },
        signal: AbortSignal.timeout(4000)
      });
      if (fallbackRes.ok) {
        const fallbackBuf = Buffer.from(await fallbackRes.arrayBuffer());
        res.statusCode = 200;
        return res.end(fallbackBuf);
      }
    } catch (fbErr) {}

    res.statusCode = 502;
    return res.end();
  }

  if (!OLA_API_KEY) {
    return res.status(503).json({ error: 'Ola Maps API key not configured' });
  }

  try {
    if (action === 'reverse') {
      const parsedLat = parseFloat(lat);
      const parsedLng = parseFloat(lng);
      if (isNaN(parsedLat) || isNaN(parsedLng)) {
        return res.status(400).json({ error: 'Invalid coordinates' });
      }

      // Security & Quota Guard: Enforce bounding box around restaurant delivery territory (Ramanagara & South Karnataka)
      if (parsedLat < 11.0 || parsedLat > 14.5 || parsedLng < 75.0 || parsedLng > 79.0) {
        return res.status(400).json({ error: 'Coordinates are outside the restaurant serviceable delivery region' });
      }

      // Vercel Edge Cache: Cache reverse geocoded coordinates for 24 hours to preserve quota
      res.setHeader('Cache-Control', 'public, s-maxage=86400, max-age=3600, stale-while-revalidate=43200');

      const url = `https://api.olamaps.io/places/v1/reverse-geocode?latlng=${parsedLat},${parsedLng}&api_key=${encodeURIComponent(OLA_API_KEY)}`;
      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(6000)
      });

      if (!response.ok) {
        return res.status(response.status).json({ error: 'Ola Maps API reverse geocoding failed' });
      }

      const data = await response.json();
      return res.status(200).json(data);
    }

    if (action === 'autocomplete') {
      const cleanInput = (input || '').toString().trim().slice(0, 80);
      if (!cleanInput || cleanInput.length < 2) {
        return res.status(400).json({ error: 'Search input must be between 2 and 80 characters' });
      }

      // Cache search queries for 1 hour
      res.setHeader('Cache-Control', 'public, s-maxage=3600, max-age=600, stale-while-revalidate=1800');

      const url = `https://api.olamaps.io/places/v1/autocomplete?input=${encodeURIComponent(cleanInput)}&location=${STORE_LAT},${STORE_LNG}&api_key=${encodeURIComponent(OLA_API_KEY)}`;
      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) {
        return res.status(response.status).json({ error: 'Ola Maps API autocomplete failed' });
      }

      const data = await response.json();
      return res.status(200).json(data);
    }

    return res.status(400).json({ error: 'Invalid action. Supported: reverse, autocomplete' });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Internal server error in Ola Maps proxy' });
  }
}
