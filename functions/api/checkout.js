/**
 * Cloudflare Pages Function: Checkout Price Verification & Anti-Tamper Defense
 * POST /api/checkout
 */
import { signPayload } from './_auth.js';
import { verifyTurnstileToken, getClientIp } from './_turnstile.js';
import { hydrateEnv, isOriginAllowed, jsonResponse } from './_adapter.js';

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
    (typeof process !== 'undefined' && process.env && (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL));
  const apiKey = (env && (env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY)) ||
    (typeof process !== 'undefined' && process.env && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY));

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
  if (dish.is_available === false || dish.inStock === false) return false;

  const timeRestricted = Boolean(dish.timeRestricted ?? dish.time_restricted);
  const availableDays = dish.availableDays ?? dish.available_days;
  const availableFrom = dish.availableFrom ?? dish.available_from;
  const availableTo = dish.availableTo ?? dish.available_to;

  const istString = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
  const istNow = new Date(istString);
  const currentDay = istNow.getDay();

  if (Array.isArray(availableDays) && availableDays.length > 0 && availableDays.length < 7) {
    if (!availableDays.includes(currentDay)) {
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
    (typeof process !== 'undefined' && process.env && (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL));
  const apiKey = (env && (env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY)) ||
    (typeof process !== 'undefined' && process.env && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY));

  if (!supabaseUrl || !apiKey) return authoritativeDishesCache;
  try {
    const cleanUrl = String(supabaseUrl).replace(/\/+$/, '');
    const res = await fetch(`${cleanUrl}/rest/v1/dishes?select=id,name,price,is_available`, {
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

    const { items, promoCode, userPhone, turnstileToken, clientOrderThresholdDeal } = body || {};

    const clientToken = turnstileToken || request.headers.get('cf-turnstile-response') || body?.['cf-turnstile-response'];
    const clientIp = getClientIp(request);
    const botCheck = await verifyTurnstileToken(clientToken, clientIp, null, env);
    if (!botCheck.success) {
      return jsonResponse({ error: botCheck.error || 'Bot verification failed. Please refresh and retry.' }, 403, Object.fromEntries(corsHeaders.entries()));
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

    const storeSettings = (authoritativeSettings && typeof authoritativeSettings === 'object' && Object.keys(authoritativeSettings).length > 0)
      ? { ...(body?.storeSettings || {}), ...authoritativeSettings }
      : ((body?.storeSettings && typeof body.storeSettings === 'object') ? body.storeSettings : (authoritativeSettings || {}));

    const catalogMap = new Map();
    if (Array.isArray(catalogDishes)) {
      catalogDishes.forEach(d => {
        if (d && d.id) catalogMap.set(String(d.id), d);
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
        } else {
          return jsonResponse({ error: `Item "${item.name || 'dish'}" is not recognized in the active menu` }, 400, Object.fromEntries(corsHeaders.entries()));
        }
      }

      if (matchedDish) {
        if (matchedDish.is_available === false) {
          return jsonResponse({ error: `Item "${matchedDish.name}" is currently out of stock` }, 400, Object.fromEntries(corsHeaders.entries()));

        if (!isDishAvailableNow(matchedDish)) {
          return jsonResponse({ error: `Item "${matchedDish.name}" is not currently being served (outside serving hours)` }, 400, Object.fromEntries(corsHeaders.entries()));
        }
        }
        authoritativePrice = Number(matchedDish.price);
      }

      if (authoritativePrice === null || isNaN(authoritativePrice)) {
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
        id: item.id || null,
        name: String(item.name || matchedDish?.name || 'Dish').slice(0, 100),
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
      const dealsMin = Number.isFinite(rawMin) ? Math.max(10, rawMin) : 199;
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
    const freeThreshold = (typeof storeSettings?.freeDeliveryThreshold === 'number')
      ? storeSettings.freeDeliveryThreshold
      : 250;
    const standardFee = (typeof storeSettings?.deliveryFeeStandard === 'number')
      ? storeSettings.deliveryFeeStandard
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
      appliedPromo: finalAppliedType === 'promo' ? appliedPromo : null,
      appliedDeal: finalAppliedType === 'unlocked_deal' ? appliedDeal : null,
      deliveryFee,
      platformFee,
      numericTotal: total,
      items: verifiedItems,
      userPhone: userPhone ? String(userPhone).slice(-10) : null,
      verifiedAt: Date.now()
    };

    const checkoutToken = signPayload(checkoutPayload, env);

    return jsonResponse({
      success: true,
      subtotal,
      discount: effectiveDiscount,
      discountType: finalAppliedType,
      appliedPromo: finalAppliedType === 'promo' ? appliedPromo : null,
      appliedDeal: finalAppliedType === 'unlocked_deal' ? appliedDeal : null,
      deliveryFee,
      platformFee,
      total,
      numericTotal: total,
      items: verifiedItems,
      checkoutToken
    }, 200, Object.fromEntries(corsHeaders.entries()));
  } catch (err) {
    return jsonResponse({ error: 'Server error processing checkout verification: ' + err.message }, 500, Object.fromEntries(corsHeaders.entries()));
  }
}
