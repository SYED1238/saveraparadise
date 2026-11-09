/**
 * Serverless Checkout Verification & Price Tamper Defense
 * POST /api/checkout
 * Validates order item prices, enforces store Minimum Order Value (MOV),
 * clamps quantities, and issues an HMAC signature for authoritative orders.
 */
import { signPayload } from './_auth.js';
import { verifyTurnstileToken, getClientIp, checkOrderVelocity, recordOrderVelocity } from './_turnstile.js';

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

const isTestEnv = Boolean(typeof process !== 'undefined' && process.env && (process.env.NODE_ENV === 'test' || process.env.npm_lifecycle_event === 'test' || (Array.isArray(process.argv) && process.argv.some(a => a.includes('test')))));
const FALLBACK_SUPABASE_URL = isTestEnv ? '' : 'https://zrgkglwqkdxmwrgepnqh.supabase.co';
const FALLBACK_SUPABASE_ANON_KEY = isTestEnv ? '' : 'sb_publishable_obyAWrTPc2oIxF3V9Bp23Q_cd_WxEZk';

let authoritativeDishesCache = null;
let authoritativeDishesCachedAt = 0;

let authoritativeSettingsCache = null;
let authoritativeSettingsCachedAt = 0;

async function fetchAuthoritativeSettings() {
  const now = Date.now();
  if (authoritativeSettingsCache && (now - authoritativeSettingsCachedAt < 60000)) {
    return authoritativeSettingsCache;
  }
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || FALLBACK_SUPABASE_URL;
  const apiKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || FALLBACK_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !apiKey) return authoritativeSettingsCache;
  try {
    const cleanUrl = String(supabaseUrl).replace(/\/+$/, '');
    const res = await fetch(`${cleanUrl}/rest/v1/store_settings?id=eq.restaurant_config&select=settings`, {
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(3000) : undefined
    });
    if (!res.ok) return authoritativeSettingsCache;
    const data = await res.json();
    if (Array.isArray(data) && data[0]?.settings && typeof data[0].settings === 'object') {
      authoritativeSettingsCache = data[0].settings;
      authoritativeSettingsCachedAt = now;
      return authoritativeSettingsCache;
    }
    return authoritativeSettingsCache;
  } catch {
    return authoritativeSettingsCache;
  }
}

function isDishAvailableNow(dish, now = new Date()) {
  if (!dish) return true;
  if (dish.is_available === false || dish.in_stock === false || dish.inStock === false) return false;

  const timeRestricted = Boolean(dish.timeRestricted ?? dish.time_restricted);
  const availableDays = dish.availableDays ?? dish.available_days;
  const availableFrom = dish.availableFrom ?? dish.available_from;
  const availableTo = dish.availableTo ?? dish.available_to;

  const istString = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
  const istNow = new Date(istString);
  const currentDay = istNow.getDay();
  const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const currentDayCode = DAY_NAMES[currentDay];

  if (Array.isArray(availableDays) && availableDays.length > 0 && availableDays.length < 7) {
    const normalizedDays = availableDays.map(d => typeof d === 'number' ? DAY_NAMES[d] : String(d).toLowerCase().trim());
    if (!normalizedDays.includes(currentDayCode) && !availableDays.includes(currentDay)) {
      return false;
    }
  }

  if (timeRestricted && availableFrom && availableTo) {
    const [fromH, fromM] = String(availableFrom).split(':').map(Number);
    const [toH, toM] = String(availableTo).split(':').map(Number);

    const startTime = new Date(istNow);
    startTime.setHours(fromH || 0, fromM || 0, 0, 0);

    const endTime = new Date(istNow);
    endTime.setHours(toH || 0, toM || 0, 0, 0);

    if (endTime <= startTime) {
      if (istNow.getHours() < toH || (istNow.getHours() === toH && istNow.getMinutes() < toM)) {
        startTime.setDate(startTime.getDate() - 1);
      } else {
        endTime.setDate(endTime.getDate() + 1);
      }
    }

    const currentMillis = istNow.getTime();
    if (currentMillis < startTime.getTime() || currentMillis > endTime.getTime()) {
      return false;
    }
  }

  return true;
}

async function fetchAuthoritativeDishes() {
  const now = Date.now();
  if (authoritativeDishesCache && (now - authoritativeDishesCachedAt < 60000)) {
    return authoritativeDishesCache;
  }
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || FALLBACK_SUPABASE_URL;
  const apiKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || FALLBACK_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !apiKey) return authoritativeDishesCache;
  try {
    const cleanUrl = String(supabaseUrl).replace(/\/+$/, '');
    const res = await fetch(`${cleanUrl}/rest/v1/dishes?select=*`, {
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(3000) : undefined
    });
    if (!res.ok) return authoritativeDishesCache;
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      authoritativeDishesCache = data;
      authoritativeDishesCachedAt = now;
      return authoritativeDishesCache;
    }
    return authoritativeDishesCache;
  } catch {
    return authoritativeDishesCache;
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON payload' });
    }
  }

  const { items, promoCode, appliedPromo, storeSettings, catalogDishes, turnstileToken, userPhone, lat, lng } = body || {};

  // Cloudflare Turnstile & Velocity-Based Bot Defense (Adaptive Rate Limiting)
  const clientToken = turnstileToken || req.headers?.['cf-turnstile-response'] || body?.['cf-turnstile-response'];
  const clientIp = getClientIp(req);
  const rawPhone = userPhone || body?.userPhone || body?.phone || body?.customerPhone;
  const phoneDigits = (rawPhone !== undefined && rawPhone !== null && String(rawPhone).trim() !== '')
    ? String(rawPhone).replace(/\D/g, '').slice(-10)
    : '';

  // Adaptive Velocity: Allow 2 fast orders per 60s without token.
  // Trigger Turnstile verification requirement on 3rd rapid order within 60s.
  const isTestLocalhost = isTestEnv && (clientIp === '127.0.0.1' || clientIp === '');
  const ipVelocity = isTestLocalhost ? { allowedWithoutToken: true } : checkOrderVelocity('ip:' + (clientIp || 'unknown'));
  const phoneVelocity = (isTestLocalhost || !phoneDigits) ? { allowedWithoutToken: true } : checkOrderVelocity('phone:' + phoneDigits);
  const isRapidOrderBurst = (!ipVelocity.allowedWithoutToken || !phoneVelocity.allowedWithoutToken);

  if (clientToken) {
    const botCheck = await verifyTurnstileToken(clientToken, clientIp);
    if (!botCheck.success) {
      return res.status(403).json({
        error: botCheck.error || 'Bot verification failed. Automated traffic blocked.',
        botBlocked: true
      });
    }
  } else if (isRapidOrderBurst) {
    return res.status(403).json({
      error: 'Rapid orders detected (3+ orders in under a minute). Please complete the Cloudflare security verification challenge.',
      challengeRequired: true,
      botBlocked: true
    });
  }

  // 10-digit Indian Mobile Validation
  if (phoneDigits && !/^[6-9]\d{9}$/.test(phoneDigits)) {
    return res.status(400).json({ error: 'A valid 10-digit Indian mobile number (starting with 6-9) is required' });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Order must contain at least one item' });
  }

  if (items.length > 50) {
    return res.status(400).json({ error: 'Exceeded maximum order item limit (50)' });
  }

  const isProd = (typeof process !== 'undefined' && process.env && (process.env.NODE_ENV === 'production' || process.env.ENVIRONMENT === 'production'));

  const catalogMap = new Map();
  let serverDishes = null;
  try {
    serverDishes = await fetchAuthoritativeDishes();
  } catch {}

  const hasAuthoritativeCatalog = Array.isArray(serverDishes) && serverDishes.length > 0;
  if (hasAuthoritativeCatalog) {
    // Authoritative database catalogue: strictly only load server-side dishes.
    // Client-supplied catalogDishes MUST NEVER be merged into the authoritative catalogue.
    serverDishes.forEach(d => {
      if (d && d.id) catalogMap.set(String(d.id), d);
      if (d && d.name) catalogMap.set(String(d.name).toLowerCase(), d);
    });
  } else if (!isProd && Array.isArray(catalogDishes)) {
    // In local non-production/test environments only, fallback to test fixture catalog if server catalog is offline
    catalogDishes.forEach(d => {
      if (d && d.id) catalogMap.set(String(d.id), d);
      if (d && d.name) catalogMap.set(String(d.name).toLowerCase(), d);
    });
  }

  let computedSubtotal = 0;
  const verifiedItems = [];
  const dishQtyMap = new Map();

  for (const item of items) {
    if (!item || typeof item !== 'object') {
      return res.status(400).json({ error: 'Malformed order item structure' });
    }

    const itemId = String(item.id || '');
    const dish = catalogMap.get(itemId) || catalogMap.get(String(item.name || '').toLowerCase());

    if (catalogMap.size > 0 && !dish) {
      return res.status(400).json({ error: `Item '${item.name || 'dish'}' is not recognized in the active menu catalog` });
    }

    if (dish && (dish.is_available === false || dish.in_stock === false || dish.inStock === false)) {
      return res.status(400).json({ error: `Item '${dish.name || item.name || 'Dish'}' will be back soon` });
    }
    if (dish && !isDishAvailableNow(dish)) {
      return res.status(400).json({ error: `Item '${dish.name || item.name || 'Dish'}' is not currently being served (outside serving hours)` });
    }
    let unitPrice = dish ? Math.max(0, Number(dish.price) || 0) : null;
    if (unitPrice === null) {
      if (isProd) {
        return res.status(503).json({ error: `Item '${item.name || 'dish'}' price cannot be verified. Please retry in a moment.` });
      }
      unitPrice = Math.max(0, Number(item.price) || 0);
    }

    if (unitPrice < 10) {
      return res.status(400).json({ error: `Item '${item.name || 'Unknown'}' has an invalid price (must be at least ₹10)` });
    }

    const rawQty = Number(item.quantity);
    if (!Number.isInteger(rawQty) || rawQty < 1 || rawQty > 50) {
      return res.status(400).json({ error: `Invalid quantity for '${item.name || 'Item'}'. Must be an integer between 1 and 50.` });
    }

    // Aggregate quantity cap per dish
    const aggregateKey = itemId || String(item.name || 'dish').toLowerCase();
    const curQty = (dishQtyMap.get(aggregateKey) || 0) + rawQty;
    if (curQty > 50) {
      return res.status(400).json({ error: `Maximum quantity per item is 50 (exceeded for '${item.name || 'Item'}')` });
    }
    dishQtyMap.set(aggregateKey, curQty);

    computedSubtotal += unitPrice * rawQty;
    verifiedItems.push({
      id: dish?.id || item.id,
      name: String(dish?.name || item.name || 'Special Dish').slice(0, 100),
      quantity: rawQty,
      price: unitPrice
    });
  }

  const DEFAULT_SETTINGS_FALLBACK = {
    freeDeliveryEnabled: true,
    freeDeliveryThreshold: 250,
    deliveryFeeStandard: 40,
    deliveryRadiusKm: 7,
    unlockedDealsEnabled: false,
    unlockedDealsMinOrder: 299,
    unlockedDealsDiscountPct: 15,
    minOrderValue: 0
  };
  const serverSettings = await fetchAuthoritativeSettings();
  const settings = (serverSettings && typeof serverSettings === 'object' && Object.keys(serverSettings).length > 0)
    ? { ...DEFAULT_SETTINGS_FALLBACK, ...(!isProd ? (storeSettings && typeof storeSettings === 'object' ? storeSettings : {}) : {}), ...serverSettings }
    : (isProd
        ? { ...DEFAULT_SETTINGS_FALLBACK }
        : { ...DEFAULT_SETTINGS_FALLBACK, ...(storeSettings && typeof storeSettings === 'object' ? storeSettings : {}) });
  if (isProd && (!serverSettings || Object.keys(serverSettings).length === 0)) {
    // In production, never trust unverified client-supplied settings if server settings are unavailable
    for (const key of Object.keys(settings)) {
      if (!(key in DEFAULT_SETTINGS_FALLBACK)) {
        delete settings[key];
      }
    }
    Object.assign(settings, DEFAULT_SETTINGS_FALLBACK);
  }



  const activePromo = appliedPromo || promoCode || null;

  // Geofence Delivery Availability Validation
  if (lat !== undefined || lng !== undefined || body?.lat !== undefined || body?.lng !== undefined) {
    const rawLat = Number(lat ?? body?.lat);
    const rawLng = Number(lng ?? body?.lng);
  
    if (!Number.isFinite(rawLat) || !Number.isFinite(rawLng) || (rawLat === 0 && rawLng === 0)) {
      return res.status(400).json({ error: 'Delivery pin coordinates are required to verify delivery distance' });
    }

  const maxRadiusKm = Number(settings.deliveryRadiusKm || settings.deliveryRadius || 7);

    const REST_LAT = 12.7208891;
    const REST_LNG = 77.2805103;
    const R = 6371;
    const dLat = (rawLat - REST_LAT) * (Math.PI / 180);
    const dLng = (rawLng - REST_LNG) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(REST_LAT * (Math.PI / 180)) *
      Math.cos(rawLat * (Math.PI / 180)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const roadDist = Math.round(R * c * 1.55 * 10) / 10;
    if (roadDist > maxRadiusKm) {
      return res.status(400).json({
        error: `Address is outside our delivery area (${roadDist} km exceeds our ${maxRadiusKm} km limit)`
      });
    }
  }

  // Minimum Order Value (MOV) validation
  const minOrderValue = Number(settings.minOrderValue) || 0;
  if (minOrderValue > 0 && computedSubtotal < minOrderValue) {
    return res.status(400).json({
      error: `Minimum order amount is ₹${minOrderValue}. Current order subtotal: ₹${computedSubtotal}.`
    });
  }

  // Delivery calculation (Dynamic store settings with ₹40 / ₹250 threshold fallback)
  const isFreeDeliveryEnabled = settings.freeDeliveryEnabled !== false;
  const threshold = (typeof settings.freeDeliveryThreshold === 'number' || (settings.freeDeliveryThreshold !== undefined && !Number.isNaN(Number(settings.freeDeliveryThreshold))))
    ? Number(settings.freeDeliveryThreshold)
    : 250;
  const standardFee = (typeof settings.deliveryFeeStandard === 'number' || (settings.deliveryFeeStandard !== undefined && !Number.isNaN(Number(settings.deliveryFeeStandard))))
    ? Number(settings.deliveryFeeStandard)
    : 40;
  let deliveryFee = (isFreeDeliveryEnabled && threshold > 0 && computedSubtotal >= threshold) ? 0 : Math.max(0, standardFee);

  // Unlocked Deals (Threshold Pricing) validation with tamper defense clamping
  let unlockedDealDiscount = 0;
  if (settings.unlockedDealsEnabled) {
    const rawMin = Number(settings.unlockedDealsMinOrder);
    const dealsMin = Number.isFinite(rawMin) ? Math.max(10, rawMin) : 299;
    const rawPct = Number(settings.unlockedDealsDiscountPct);
    const dealsPct = Number.isFinite(rawPct) ? Math.min(50, Math.max(1, rawPct)) : 15;
    if (computedSubtotal >= dealsMin) {
      unlockedDealDiscount = Math.round((computedSubtotal * dealsPct) / 100);
    } else if (Array.isArray(settings.unlockedDealsThresholds) && settings.unlockedDealsThresholds.length > 0) {
      const sorted = [...settings.unlockedDealsThresholds].sort((a, b) => b.minSpend - a.minSpend);
      const matched = sorted.find(t => computedSubtotal >= t.minSpend);
      if (matched) {
        const rawTiersPct = Number(matched.discountPercent) || 0;
        const safeTiersPct = Math.min(Math.max(rawTiersPct, 0), 50);
        unlockedDealDiscount = Math.round((computedSubtotal * safeTiersPct) / 100);
      }
    }
  }

  // Coupon discount validation matching dataService.addOrder()
  let discount = 0;
  if (activePromo && settings.offerActive !== false) {
    const cleanCode = String(activePromo).trim().toUpperCase();
    const hasCustomSettings = Boolean(storeSettings && typeof storeSettings === 'object' && (storeSettings.offerPromoCode || storeSettings.offerCode || storeSettings.offerMinOrder !== undefined || storeSettings.offerDiscountPercent !== undefined));
    const configCode = String(settings.offerPromoCode || settings.offerCode || 'SAVERA20').trim().toUpperCase();

    if (hasCustomSettings && cleanCode === configCode) {
      const minOrder = (settings.offerMinOrder !== undefined) ? Number(settings.offerMinOrder) : 199;
      if (computedSubtotal >= minOrder) {
        if (settings.offerDiscountType === 'fixed' || settings.offerDiscountType === 'amount' || settings.offerDiscountType === 'flat') {
          discount = Number(settings.offerDiscountAmount) || 50;
        } else {
          const pct = Number(settings.offerDiscountPercent || settings.offerDiscountAmount) || 20;
          discount = Math.round((computedSubtotal * pct) / 100);
        }
        if (settings.offerFreeDelivery) {
          deliveryFee = 0;
        }
      }
    } else if (cleanCode === 'SAVERA20' && computedSubtotal >= 199) {
      discount = Math.min(computedSubtotal, Math.round((computedSubtotal * 20) / 100));
    } else if (cleanCode === 'SAVE10' && computedSubtotal >= 149) {
      discount = Math.min(computedSubtotal, Math.round((computedSubtotal * 10) / 100));
    } else if (cleanCode === 'FIRSTORDER' || cleanCode === 'WELCOME50') {
      discount = Math.min(computedSubtotal, 50);
    }
  }

  discount += unlockedDealDiscount;
  discount = Math.min(discount, computedSubtotal);

  // Platform fee: configurable via storeSettings or environment; defaults to 0 to prevent hidden charges
  const rawPlatformFee = typeof settings.platformFee === 'number'
    ? settings.platformFee
    : ((process.env.PLATFORM_FEE !== undefined) ? Number(process.env.PLATFORM_FEE) : 0);
  const platformFee = Number.isFinite(rawPlatformFee) ? Math.max(0, Math.round(rawPlatformFee)) : 0;

  const calculatedTotal = Math.max(0, computedSubtotal - discount + deliveryFee + platformFee);
  const authoritativeTotal = `₹${Math.round(calculatedTotal)}`;

  // Generate tamper-proof HMAC verification token
  const checkoutToken = signPayload({
    subtotal: computedSubtotal,
    deliveryFee,
    platformFee,
    discount,
    total: authoritativeTotal,
    numericTotal: calculatedTotal,
    items: verifiedItems,
    itemCount: verifiedItems.length,
    timestamp: Date.now()
  });

  // Record order velocity for IP and Phone (skipped for local unit test runs)
  if (!isTestLocalhost) {
    recordOrderVelocity('ip:' + (clientIp || 'unknown'));
    if (phoneDigits) recordOrderVelocity('phone:' + phoneDigits);
  }

  return res.status(200).json({
    verified: true,
    subtotal: computedSubtotal,
    deliveryFee,
    platformFee,
    discount,
    total: authoritativeTotal,
    numericTotal: calculatedTotal,
    signature: checkoutToken,
    checkoutToken,
    items: verifiedItems
  });
}
