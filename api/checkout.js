/**
 * Serverless Checkout Verification & Price Tamper Defense
 * POST /api/checkout
 * Validates order item prices, enforces store Minimum Order Value (MOV),
 * clamps quantities, and issues an HMAC signature for authoritative orders.
 */
import { signPayload } from './_auth.js';

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

let authoritativeDishesCache = null;
let authoritativeDishesCachedAt = 0;

let authoritativeSettingsCache = null;
let authoritativeSettingsCachedAt = 0;

async function fetchAuthoritativeSettings() {
  const now = Date.now();
  if (authoritativeSettingsCache && (now - authoritativeSettingsCachedAt < 60000)) {
    return authoritativeSettingsCache;
  }
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const apiKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
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

async function fetchAuthoritativeDishes() {
  const now = Date.now();
  if (authoritativeDishesCache && (now - authoritativeDishesCachedAt < 60000)) {
    return authoritativeDishesCache;
  }
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const apiKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !apiKey) return authoritativeDishesCache;
  try {
    const cleanUrl = String(supabaseUrl).replace(/\/+$/, '');
    const res = await fetch(`${cleanUrl}/rest/v1/dishes?select=id,name,price,is_available`, {
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

  const { items, promoCode, appliedPromo, storeSettings, catalogDishes } = body || {};

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Order must contain at least one item' });
  }

  if (items.length > 50) {
    return res.status(400).json({ error: 'Exceeded maximum order item limit (50)' });
  }

  const catalogMap = new Map();
  if (Array.isArray(catalogDishes)) {
    catalogDishes.forEach(d => {
      if (d && d.id) catalogMap.set(String(d.id), d);
      if (d && d.name) catalogMap.set(String(d.name).toLowerCase(), d);
    });
  }

  // Authoritative server-side dish price verification via Supabase if configured
  try {
    const serverDishes = await fetchAuthoritativeDishes();
    if (serverDishes && serverDishes.length > 0) {
      serverDishes.forEach(d => {
        if (d && d.id) catalogMap.set(String(d.id), d);
        if (d && d.name) catalogMap.set(String(d.name).toLowerCase(), d);
      });
    }
  } catch {}

  let computedSubtotal = 0;
  const verifiedItems = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') {
      return res.status(400).json({ error: 'Malformed order item structure' });
    }

    const dish = catalogMap.get(String(item.id || '')) || catalogMap.get(String(item.name || '').toLowerCase());
    if (dish && (dish.is_available === false || dish.inStock === false)) {
      return res.status(400).json({ error: `Item '${dish.name || item.name || 'Dish'}' is currently sold out` });
    }
    const unitPrice = dish ? Math.max(0, Number(dish.price) || 0) : Math.max(0, Number(item.price) || 0);

    if (unitPrice < 10) {
      return res.status(400).json({ error: `Item '${item.name || 'Unknown'}' has an invalid price (must be at least ₹10)` });
    }

    const rawQty = Number(item.quantity);
    if (!Number.isInteger(rawQty) || rawQty < 1 || rawQty > 50) {
      return res.status(400).json({ error: `Invalid quantity for '${item.name || 'Item'}'. Must be an integer between 1 and 50.` });
    }

    computedSubtotal += unitPrice * rawQty;
    verifiedItems.push({
      id: item.id || dish?.id,
      name: String(item.name || dish?.name || 'Special Dish').slice(0, 100),
      quantity: rawQty,
      price: unitPrice
    });
  }

  const serverSettings = await fetchAuthoritativeSettings();
  const settings = (serverSettings && typeof serverSettings === 'object' && Object.keys(serverSettings).length > 0)
    ? { ...(storeSettings || {}), ...serverSettings }
    : ((storeSettings && typeof storeSettings === 'object') ? storeSettings : {});
  const activePromo = appliedPromo || promoCode || null;

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
  let deliveryFee = (isFreeDeliveryEnabled && threshold > 0 && computedSubtotal >= threshold) ? 0 : standardFee;

  // Unlocked Deals (Threshold Pricing) validation with tamper defense clamping
  let unlockedDealDiscount = 0;
  if (settings.unlockedDealsEnabled) {
    const rawMin = Number(settings.unlockedDealsMinOrder);
    const dealsMin = Number.isFinite(rawMin) ? Math.max(50, rawMin) : 299;
    const rawPct = Number(settings.unlockedDealsDiscountPct);
    const dealsPct = Number.isFinite(rawPct) ? Math.min(50, Math.max(1, rawPct)) : 15;
    if (computedSubtotal >= dealsMin) {
      unlockedDealDiscount = Math.round((computedSubtotal * dealsPct) / 100);
    }
  }

  // Coupon discount validation matching dataService.addOrder()
  let discount = 0;
  if (activePromo && settings.offerActive !== false) {
    const cleanCode = String(activePromo).trim().toUpperCase();
    const hasCustomSettings = Boolean(storeSettings && typeof storeSettings === 'object' && (storeSettings.offerCode || storeSettings.offerMinOrder !== undefined || storeSettings.offerDiscountPercent !== undefined));
    const configCode = String(settings.offerCode || 'SAVERA20').trim().toUpperCase();

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

  const calculatedTotal = Math.max(0, computedSubtotal - discount + deliveryFee);
  const authoritativeTotal = `₹${Math.round(calculatedTotal)}`;

  // Generate tamper-proof HMAC verification token
  const checkoutToken = signPayload({
    subtotal: computedSubtotal,
    deliveryFee,
    discount,
    total: authoritativeTotal,
    numericTotal: calculatedTotal,
    itemCount: verifiedItems.length,
    timestamp: Date.now()
  });

  return res.status(200).json({
    verified: true,
    subtotal: computedSubtotal,
    deliveryFee,
    discount,
    total: authoritativeTotal,
    numericTotal: calculatedTotal,
    signature: checkoutToken,
    checkoutToken,
    items: verifiedItems
  });
}
