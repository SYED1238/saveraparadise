/**
 * Cloudflare Pages Function: Checkout Price Verification & Anti-Tamper Defense
 * POST /api/checkout
 */
import { signPayload } from './_auth.js';
import { verifyTurnstileToken, getClientIp, checkOrderVelocity, recordOrderVelocity } from './_turnstile.js';
import { hydrateEnv, isOriginAllowed, jsonResponse } from './_adapter.js';

const isTestEnv = Boolean(typeof process !== 'undefined' && process.env && (process.env.NODE_ENV === 'test' || process.env.npm_lifecycle_event === 'test' || (Array.isArray(process.argv) && process.argv.some(a => a.includes('test')))));
const FALLBACK_SUPABASE_URL = isTestEnv ? '' : 'https://zrgkglwqkdxmwrgepnqh.supabase.co';
const FALLBACK_SUPABASE_ANON_KEY = isTestEnv ? '' : 'sb_publishable_obyAWrTPc2oIxF3V9Bp23Q_cd_WxEZk';

let authoritativeDishesCache = null;
let authoritativeDishesCachedAt = 0;

let authoritativeSettingsCache = null;
let authoritativeSettingsCachedAt = 0;

async function fetchAuthoritativeSettings(env = null) {
  const now = Date.now();
  if (authoritativeSettingsCache && (now - authoritativeSettingsCachedAt < 60000)) {
    return authoritativeSettingsCache;
  }
  const supabaseUrl = (env && (env.VITE_SUPABASE_URL || env.SUPABASE_URL)) ||
    (typeof process !== 'undefined' && process.env && (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)) || FALLBACK_SUPABASE_URL;
  const apiKey = (env && (env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY)) ||
    (typeof process !== 'undefined' && process.env && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY)) || FALLBACK_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !apiKey) return authoritativeSettingsCache;
  try {
    const cleanUrl = String(supabaseUrl).replace(/\/+$/, '');
    const res = await fetch(`${cleanUrl}/rest/v1/store_settings?id=eq.restaurant_config&select=settings`, {
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
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

async function fetchAuthoritativeDishes(env = null) {
  const now = Date.now();
  if (authoritativeDishesCache && (now - authoritativeDishesCachedAt < 60000)) {
    return authoritativeDishesCache;
  }
  const supabaseUrl = (env && (env.VITE_SUPABASE_URL || env.SUPABASE_URL)) ||
    (typeof process !== 'undefined' && process.env && (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)) || FALLBACK_SUPABASE_URL;
  const apiKey = (env && (env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY)) ||
    (typeof process !== 'undefined' && process.env && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY)) || FALLBACK_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !apiKey) return authoritativeDishesCache;
  try {
    const cleanUrl = String(supabaseUrl).replace(/\/+$/, '');
    const res = await fetch(`${cleanUrl}/rest/v1/dishes?select=*`, {
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
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

export async function onRequest(context) {
  hydrateEnv(context);
  const { request, env } = context;
  const origin = request.headers.get('origin');

  const corsHeaders = new Headers();
  if (origin && isOriginAllowed(origin)) {
    corsHeaders.set('Access-Control-Allow-Origin', origin);
    corsHeaders.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    corsHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, cf-turnstile-response');
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    corsHeaders.set('Allow', 'POST, OPTIONS');
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers: corsHeaders });
  }

  try {
    let body = {};
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON request body' }, 400, Object.fromEntries(corsHeaders.entries()));
    }

    const { items, promoCode, userPhone, turnstileToken, clientOrderThresholdDeal, lat, lng } = body || {};

    const clientToken = turnstileToken || request.headers.get('cf-turnstile-response') || body?.['cf-turnstile-response'];
    const clientIp = getClientIp(request);
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
      const botCheck = await verifyTurnstileToken(clientToken, clientIp, null, env);
      if (!botCheck.success) {
        return jsonResponse({
          error: botCheck.error || 'Bot verification failed. Automated traffic blocked.',
          botBlocked: true
        }, 403, Object.fromEntries(corsHeaders.entries()));
      }
    } else if (isRapidOrderBurst) {
      return jsonResponse({
        error: 'Rapid orders detected (3+ orders in under a minute). Please complete the Cloudflare security verification challenge.',
        challengeRequired: true,
        botBlocked: true
      }, 403, Object.fromEntries(corsHeaders.entries()));
    }

    // 10-digit Indian Mobile Validation
    if (phoneDigits && !/^[6-9]\d{9}$/.test(phoneDigits)) {
      return jsonResponse({ error: 'A valid 10-digit Indian mobile number (starting with 6-9) is required' }, 400, Object.fromEntries(corsHeaders.entries()));
    }

    if (!Array.isArray(items) || items.length === 0) {
      return jsonResponse({ error: 'Cart cannot be empty' }, 400, Object.fromEntries(corsHeaders.entries()));
    }
    if (items.length > 50) {
      return jsonResponse({ error: 'Order exceeds maximum item limit (50 items)' }, 400, Object.fromEntries(corsHeaders.entries()));
    }

    const [catalogDishes, authoritativeSettings] = await Promise.all([
      fetchAuthoritativeDishes(env),
      fetchAuthoritativeSettings(env)
    ]);

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

    const storeSettings = (authoritativeSettings && typeof authoritativeSettings === 'object' && Object.keys(authoritativeSettings).length > 0)
      ? { ...DEFAULT_SETTINGS_FALLBACK, ...(body?.storeSettings || {}), ...authoritativeSettings }
      : { ...DEFAULT_SETTINGS_FALLBACK, ...((body?.storeSettings && typeof body.storeSettings === 'object') ? body.storeSettings : (authoritativeSettings || {})) };

    const isProd = (env && (env.NODE_ENV === 'production' || env.ENVIRONMENT === 'production')) || (typeof process !== 'undefined' && process.env && (process.env.NODE_ENV === 'production' || process.env.ENVIRONMENT === 'production'));

    if (isProd && (!authoritativeSettings || Object.keys(authoritativeSettings).length === 0)) {
      // In production, never trust unverified client-supplied settings if server settings are unavailable
      Object.assign(storeSettings, DEFAULT_SETTINGS_FALLBACK);
    }




    // Geofence Delivery Availability Validation
    if (lat !== undefined || lng !== undefined || body?.lat !== undefined || body?.lng !== undefined) {
      const rawLat = Number(lat ?? body?.lat);
      const rawLng = Number(lng ?? body?.lng);
  
      if (!Number.isFinite(rawLat) || !Number.isFinite(rawLng) || (rawLat === 0 && rawLng === 0)) {
        return jsonResponse({ error: 'Delivery pin coordinates are required to verify delivery distance' }, 400, Object.fromEntries(corsHeaders.entries()));
      }

    const maxRadiusKm = Number(storeSettings?.deliveryRadiusKm || storeSettings?.deliveryRadius || 7);

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
        return jsonResponse({
          error: `Address is outside our delivery area (${roadDist} km exceeds our ${maxRadiusKm} km limit)`
        }, 400, Object.fromEntries(corsHeaders.entries()));
      }
    }

    const catalogMap = new Map();
    const hasAuthoritativeCatalog = Array.isArray(catalogDishes) && catalogDishes.length > 0;

    if (hasAuthoritativeCatalog) {
      // Authoritative database catalogue: strictly only load server-side dishes.
      // Client-supplied body.catalogDishes MUST NEVER be merged into the authoritative catalogue.
      catalogDishes.forEach(d => {
        if (d && d.id) catalogMap.set(String(d.id), d);
        if (d && d.name) catalogMap.set(String(d.name).toLowerCase(), d);
      });
    } else if (!isProd && Array.isArray(body?.catalogDishes)) {
      // In local non-production/test environments only, fallback to test fixture catalog if server catalog is offline
      body.catalogDishes.forEach(d => {
        if (d && d.id) catalogMap.set(String(d.id), d);
        if (d && d.name) catalogMap.set(String(d.name).toLowerCase(), d);
      });
    }

    let subtotal = 0;
    const verifiedItems = [];
    const dishQtyMap = new Map();

    for (const item of items) {
      if (!item || typeof item !== 'object') {
        return jsonResponse({ error: 'Invalid cart item structure' }, 400, Object.fromEntries(corsHeaders.entries()));
      }

      const rawQty = item.qty ?? item.quantity ?? 1;
      const quantity = parseInt(rawQty, 10);
      if (isNaN(quantity) || quantity <= 0 || !Number.isInteger(Number(rawQty))) {
        return jsonResponse({ error: `Invalid quantity for item "${item.name || 'dish'}"` }, 400, Object.fromEntries(corsHeaders.entries()));
      }

      let authoritativePrice = null;
      const itemId = item.id ? String(item.id) : null;
      let matchedDish = null;

      if (catalogMap.size > 0) {
        if (itemId && catalogMap.has(itemId)) {
          matchedDish = catalogMap.get(itemId);
        } else if (item.name && catalogMap.has(String(item.name).toLowerCase())) {
          matchedDish = catalogMap.get(String(item.name).toLowerCase());
        } else {
          return jsonResponse({ error: `Item "${item.name || 'dish'}" is not recognized in the active menu` }, 400, Object.fromEntries(corsHeaders.entries()));
        }
      }

      if (matchedDish) {
        if (matchedDish.is_available === false || matchedDish.in_stock === false || matchedDish.inStock === false) {
          return jsonResponse({ error: `Item "${matchedDish.name}" is currently out of stock` }, 400, Object.fromEntries(corsHeaders.entries()));
        }
        if (!isDishAvailableNow(matchedDish)) {
          return jsonResponse({ error: `Item "${matchedDish.name}" is not currently being served (outside serving hours)` }, 400, Object.fromEntries(corsHeaders.entries()));
        }
        authoritativePrice = Number(matchedDish.price);
      }

      if (authoritativePrice === null || isNaN(authoritativePrice)) {
        if (isProd) {
          return jsonResponse({ error: `Item "${item.name || 'dish'}" price cannot be verified. Please retry in a moment.` }, 503, Object.fromEntries(corsHeaders.entries()));
        }
        const clientPrice = Number(item.price);
        if (isNaN(clientPrice) || clientPrice < 10) {
          return jsonResponse({ error: `Invalid price for item "${item.name || 'dish'}"` }, 400, Object.fromEntries(corsHeaders.entries()));
        }
        authoritativePrice = clientPrice;
      }

      // Aggregate quantity check per dish
      const aggregateKey = itemId || String(item.name || 'dish');
      const curQty = (dishQtyMap.get(aggregateKey) || 0) + quantity;
      if (curQty > 50) {
        return jsonResponse({ error: `Maximum quantity per item is 50 (exceeded for "${item.name || 'dish'}")` }, 400, Object.fromEntries(corsHeaders.entries()));
      }
      dishQtyMap.set(aggregateKey, curQty);

      const itemTotal = authoritativePrice * quantity;
      subtotal += itemTotal;

      verifiedItems.push({
        id: matchedDish?.id || item.id || null,
        name: String(matchedDish?.name || item.name || 'Dish').slice(0, 100),
        price: authoritativePrice,
        quantity,
        total: itemTotal
      });
    }

    const minOrderValue = typeof storeSettings?.minOrderValue === 'number'
      ? storeSettings.minOrderValue
      : ((typeof storeSettings?.minOrder === 'number') ? storeSettings.minOrder : 0);
    if (minOrderValue > 0 && subtotal < minOrderValue) {
      return jsonResponse({
        error: `Order subtotal (₹${subtotal}) does not meet the minimum order value of ₹${minOrderValue}`
      }, 400, Object.fromEntries(corsHeaders.entries()));
    }

    let discount = 0;
    let appliedPromo = null;
    let promoFreeDelivery = false;

    const isOfferActive = storeSettings?.offerActive !== false;
    const configuredCode = String(storeSettings?.offerCode || storeSettings?.offerPromoCode || 'SAVERA20').trim().toUpperCase();

    if (promoCode && typeof promoCode === 'string' && isOfferActive) {
      const code = promoCode.trim().toUpperCase();
      if (code === configuredCode) {
        const discountType = storeSettings?.offerDiscountType || 'percent';
        const rawPct = Number(storeSettings?.offerDiscountPercent);
        const discountPct = Number.isFinite(rawPct) ? Math.min(50, Math.max(1, rawPct)) : 20;
        const discountAmt = Math.max(0, Number(storeSettings?.offerDiscountAmount || 50));
        const minOrder = (storeSettings?.offerMinOrder !== undefined && storeSettings?.offerMinOrder !== null)
          ? Number(storeSettings.offerMinOrder)
          : 0;
        if (subtotal >= minOrder) {
          discount = (discountType === 'flat' || discountType === 'fixed' || discountType === 'amount')
            ? Math.min(subtotal, discountAmt)
            : Math.round((subtotal * discountPct) / 100);
          appliedPromo = code;
          if (storeSettings?.offerFreeDelivery !== false) {
            promoFreeDelivery = Boolean(storeSettings?.offerFreeDelivery);
          }
        }
      } else if (code === 'SAVERA20' && subtotal >= 199) {
        discount = Math.min(subtotal, Math.round((subtotal * 20) / 100));
        appliedPromo = 'SAVERA20';
      } else if (code === 'SAVE10' && subtotal >= 149) {
        discount = Math.min(subtotal, Math.round((subtotal * 10) / 100));
        appliedPromo = 'SAVE10';
      } else if (code === 'FIRSTORDER' || code === 'WELCOME50') {
        discount = Math.min(subtotal, 50);
        appliedPromo = code;
      }
    }

    let dealDiscount = 0;
    let appliedDeal = null;

    const serverDealsEnabled = storeSettings?.unlockedDealsEnabled ?? false;
    if (serverDealsEnabled) {
      const rawMin = Number(storeSettings?.unlockedDealsMinOrder);
      const dealsMin = Number.isFinite(rawMin) ? Math.max(10, rawMin) : 299;
      const rawPct = Number(storeSettings?.unlockedDealsDiscountPct);
      const dealsPct = Number.isFinite(rawPct) ? Math.min(50, Math.max(1, rawPct)) : 15;

      if (subtotal >= dealsMin) {
        dealDiscount = Math.round(subtotal * (dealsPct / 100));
        appliedDeal = {
          label: storeSettings?.unlockedDealsTitle || `${dealsPct}% Wholesale Deal`,
          discountPercent: dealsPct,
          minSpend: dealsMin
        };
      } else if (Array.isArray(storeSettings?.unlockedDealsThresholds) && storeSettings.unlockedDealsThresholds.length > 0) {
        const sorted = [...storeSettings.unlockedDealsThresholds].sort((a, b) => b.minSpend - a.minSpend);
        const matched = sorted.find(t => subtotal >= t.minSpend);
        if (matched) {
          const rawPct = Number(matched.discountPercent) || 0;
          const safePct = Math.min(Math.max(rawPct, 0), 50);
          dealDiscount = Math.round(subtotal * (safePct / 100));
          appliedDeal = {
            label: matched.label || `${safePct}% Deal`,
            discountPercent: safePct,
            minSpend: matched.minSpend
          };
        }
      }
    }
    const combinedDiscount = discount + dealDiscount;
    const effectiveDiscount = Math.min(combinedDiscount, subtotal);
    const finalAppliedType = (discount > 0 && dealDiscount > 0)
      ? 'combined_deals_promo'
      : (dealDiscount > 0 ? 'unlocked_deal' : (discount > 0 ? 'promo' : null));

    const isFreeDeliveryEnabled = storeSettings?.freeDeliveryEnabled !== false;
    const freeThreshold = (typeof storeSettings?.freeDeliveryThreshold === 'number' || (storeSettings?.freeDeliveryThreshold !== undefined && !Number.isNaN(Number(storeSettings?.freeDeliveryThreshold))))
      ? Number(storeSettings.freeDeliveryThreshold)
      : 250;
    const standardFee = (typeof storeSettings?.deliveryFeeStandard === 'number' || (storeSettings?.deliveryFeeStandard !== undefined && !Number.isNaN(Number(storeSettings?.deliveryFeeStandard))))
      ? Number(storeSettings.deliveryFeeStandard)
      : (typeof storeSettings?.deliveryFee === 'number' || (storeSettings?.deliveryFee !== undefined && !Number.isNaN(Number(storeSettings?.deliveryFee))))
        ? Number(storeSettings.deliveryFee)
        : 40;
    const deliveryFee = (promoFreeDelivery || (isFreeDeliveryEnabled && freeThreshold > 0 && subtotal >= freeThreshold))
      ? 0
      : standardFee;
    // Platform fee: configurable via storeSettings or environment; defaults to 0 to prevent hidden charges
    const platformFee = typeof storeSettings?.platformFee === 'number'
      ? storeSettings.platformFee
      : ((env && env.PLATFORM_FEE !== undefined) ? Number(env.PLATFORM_FEE) : 0);
    const total = Math.max(0, subtotal - effectiveDiscount + deliveryFee + platformFee);

    const checkoutPayload = {
      subtotal,
      discount: effectiveDiscount,
      discountType: finalAppliedType,
      appliedPromo: (finalAppliedType === 'promo' || finalAppliedType === 'combined_deals_promo') ? appliedPromo : null,
      appliedDeal: (finalAppliedType === 'unlocked_deal' || finalAppliedType === 'combined_deals_promo') ? appliedDeal : null,
      deliveryFee,
      platformFee,
      numericTotal: total,
      items: verifiedItems,
      userPhone: userPhone ? String(userPhone).slice(-10) : null,
      verifiedAt: Date.now()
    };

    const checkoutToken = signPayload(checkoutPayload, env);

    // Record order velocity for IP and Phone (skipped for local unit test runs)
    if (!isTestLocalhost) {
      recordOrderVelocity('ip:' + (clientIp || 'unknown'));
      if (phoneDigits) recordOrderVelocity('phone:' + phoneDigits);
    }

    return jsonResponse({
      success: true,
      verified: true,
      subtotal,
      discount: effectiveDiscount,
      discountType: finalAppliedType,
      appliedPromo: (finalAppliedType === 'promo' || finalAppliedType === 'combined_deals_promo') ? appliedPromo : null,
      appliedDeal: (finalAppliedType === 'unlocked_deal' || finalAppliedType === 'combined_deals_promo') ? appliedDeal : null,
      deliveryFee,
      platformFee,
      total,
      numericTotal: total,
      items: verifiedItems,
      signature: checkoutToken,
      checkoutToken
    }, 200, Object.fromEntries(corsHeaders.entries()));
  } catch (err) {
    return jsonResponse({ error: 'Server error processing checkout verification: ' + err.message }, 500, Object.fromEntries(corsHeaders.entries()));
  }
}
