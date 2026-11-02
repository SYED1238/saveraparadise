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

    const [catalogDishes, storeSettings] = await Promise.all([
      fetchAuthoritativeDishes(env),
      fetchAuthoritativeSettings(env)
    ]);

    const catalogMap = new Map();
    if (Array.isArray(catalogDishes)) {
      catalogDishes.forEach(d => {
        if (d && d.id) catalogMap.set(String(d.id), d);
      });
    }

    let subtotal = 0;
    const verifiedItems = [];

    for (const item of items) {
      if (!item || typeof item !== 'object') {
        return jsonResponse({ error: 'Invalid cart item structure' }, 400, Object.fromEntries(corsHeaders.entries()));
      }

      const rawQty = item.qty ?? item.quantity ?? 1;
      const quantity = parseInt(rawQty, 10);
      if (isNaN(quantity) || quantity <= 0 || !Number.isInteger(Number(rawQty))) {
        return jsonResponse({ error: `Invalid quantity for item "${item.name || 'dish'}"` }, 400, Object.fromEntries(corsHeaders.entries()));
      }
      if (quantity > 50) {
        return jsonResponse({ error: `Maximum quantity per item is 50 (received ${quantity} for "${item.name || 'dish'}")` }, 400, Object.fromEntries(corsHeaders.entries()));
      }

      let authoritativePrice = null;
      const itemId = item.id ? String(item.id) : null;
      if (itemId && catalogMap.has(itemId)) {
        const dish = catalogMap.get(itemId);
        if (dish.is_available === false) {
          return jsonResponse({ error: `Item "${dish.name}" is currently out of stock` }, 400, Object.fromEntries(corsHeaders.entries()));
        }
        authoritativePrice = Number(dish.price);
      }

      if (authoritativePrice === null || isNaN(authoritativePrice)) {
        const clientPrice = Number(item.price);
        if (isNaN(clientPrice) || clientPrice < 10) {
          return jsonResponse({ error: `Invalid price for item "${item.name || 'dish'}"` }, 400, Object.fromEntries(corsHeaders.entries()));
        }
        authoritativePrice = clientPrice;
      }

      const itemTotal = authoritativePrice * quantity;
      subtotal += itemTotal;

      verifiedItems.push({
        id: item.id || null,
        name: String(item.name || 'Dish').slice(0, 100),
        price: authoritativePrice,
        quantity,
        total: itemTotal
      });
    }

    const minOrderValue = typeof storeSettings?.minOrderValue === 'number' ? storeSettings.minOrderValue : 100;
    if (subtotal < minOrderValue) {
      return jsonResponse({
        error: `Order subtotal (₹${subtotal}) does not meet the minimum order value of ₹${minOrderValue}`
      }, 400, Object.fromEntries(corsHeaders.entries()));
    }

    let discount = 0;
    let appliedPromo = null;

    if (promoCode && typeof promoCode === 'string') {
      const code = promoCode.trim().toUpperCase();
      if (storeSettings && storeSettings.offerPromoCode && code === String(storeSettings.offerPromoCode).trim().toUpperCase()) {
        const discountType = storeSettings.offerDiscountType || 'percent';
        const discountPct = Number(storeSettings.offerDiscountPercent || 20);
        const discountAmt = Number(storeSettings.offerDiscountAmount || 50);
        const minOrder = Number(storeSettings.offerMinOrder || 150);
        if (subtotal >= minOrder) {
          discount = (discountType === 'flat' || discountType === 'fixed' || discountType === 'amount')
            ? Math.min(subtotal, discountAmt)
            : Math.round((subtotal * discountPct) / 100);
          appliedPromo = code;
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
    const serverThresholds = Array.isArray(storeSettings?.unlockedDealsThresholds)
      ? storeSettings.unlockedDealsThresholds
      : [
          { minSpend: 1000, discountPercent: 15, label: 'Super Saver (15% Off)' },
          { minSpend: 2000, discountPercent: 20, label: 'Mega Wholesale (20% Off)' }
        ];

    if (serverDealsEnabled && serverThresholds.length > 0) {
      const sorted = [...serverThresholds].sort((a, b) => b.minSpend - a.minSpend);
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
    } else if (clientOrderThresholdDeal && typeof clientOrderThresholdDeal === 'object' && serverDealsEnabled) {
      const minSpend = Number(clientOrderThresholdDeal.minSpend) || 0;
      const rawPct = Number(clientOrderThresholdDeal.discountPercent) || 0;
      const safePct = Math.min(Math.max(rawPct, 0), 50);
      if (minSpend > 0 && subtotal >= minSpend && safePct > 0) {
        dealDiscount = Math.round(subtotal * (safePct / 100));
        appliedDeal = {
          label: String(clientOrderThresholdDeal.label || `${safePct}% Deal`).slice(0, 50),
          discountPercent: safePct,
          minSpend
        };
      }
    }

    // Stack discounts (unlocked threshold deal + coupon promo), capped at subtotal
    const effectiveDiscount = Math.min(subtotal, discount + dealDiscount);
    const finalAppliedType = (discount > 0 && dealDiscount > 0)
      ? 'combined_deals_promo'
      : (dealDiscount > 0 ? 'unlocked_deal' : (discount > 0 ? 'promo' : null));

    const deliveryFee = subtotal >= 250 ? 0 : 40;
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
