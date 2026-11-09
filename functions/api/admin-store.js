/**
 * Cloudflare Pages Function: Admin Menu, Categories & Store Settings Mutation Endpoint
 * POST /api/admin-store
 * 
 * Secure server-side gateway for menu and store configuration changes.
 * Requires a cryptographically verified Admin or Owner session token.
 * Executes authoritative database mutations using SUPABASE_SERVICE_ROLE_KEY.
 * Strictly prevents unauthenticated (anon) clients from modifying dishes, categories, or settings.
 */
import { verifyAdminToken } from './_auth.js';
import { hydrateEnv, jsonResponse, isOriginAllowed } from './_adapter.js';

const ALLOWED_DISH_FIELDS = [
  'id', 'name', 'category', 'category_name', 'price', 'original_price',
  'badge', 'time', 'calories', 'diet', 'description', 'in_stock',
  'image', 'available_days', 'time_restricted', 'available_from', 'available_to'
];

function sanitizeDishFields(input) {
  if (!input || typeof input !== 'object') return {};
  const clean = {};
  for (const key of ALLOWED_DISH_FIELDS) {
    if (input[key] !== undefined) {
      clean[key] = input[key];
    }
  }
  return clean;
}

export async function onRequest(context) {
  hydrateEnv(context);
  const { request, env } = context;

  const origin = request.headers.get('origin');
  const corsHeaders = new Headers();
  if (origin && isOriginAllowed(origin)) {
    corsHeaders.set('Access-Control-Allow-Origin', origin);
    corsHeaders.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    corsHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-token');
    corsHeaders.set('Access-Control-Allow-Credentials', 'true');
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    corsHeaders.set('Allow', 'POST, OPTIONS');
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  }

  // 1. Verify admin/owner session token (strict role check: admin or owner)
  const auth = verifyAdminToken(request, env, ['admin', 'owner']);
  if (!auth || !auth.valid) {
    return jsonResponse(
      { error: auth?.error || 'Unauthorized: Admin or Owner session required' },
      401,
      Object.fromEntries(corsHeaders.entries())
    );
  }

  // 2. Parse payload
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const action = String(body?.action || '').trim();
  if (!action) {
    return jsonResponse({ error: 'Action parameter is required' }, 400, Object.fromEntries(corsHeaders.entries()));
  }

  // Role Gate: Modifying store settings requires Executive Owner session
  if (action === 'save_settings' && auth.payload?.role !== 'owner') {
    return jsonResponse({ error: 'Forbidden: Owner role required to modify store settings' }, 403, Object.fromEntries(corsHeaders.entries()));
  }

  // 3. Initialize authoritative Supabase service client
  const supabaseUrl = (env && (env.VITE_SUPABASE_URL || env.SUPABASE_URL)) ||
    (typeof process !== 'undefined' && process.env && (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL));
  const serviceKey = (env && env.SUPABASE_SERVICE_ROLE_KEY) ||
    (typeof process !== 'undefined' && process.env && process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!supabaseUrl || !serviceKey) {
    console.warn('[AdminStore] Supabase service credentials missing');
    return jsonResponse({ error: 'Database service credentials not configured on server' }, 503, Object.fromEntries(corsHeaders.entries()));
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(supabaseUrl, serviceKey);

    switch (action) {
      case 'add_dish': {
        const rawDish = body.dish;
        if (!rawDish || !rawDish.id || !rawDish.name) {
          return jsonResponse({ error: 'Valid dish payload (id, name) is required' }, 400, Object.fromEntries(corsHeaders.entries()));
        }
        const dish = sanitizeDishFields(rawDish);
        const { data, error } = await sb.from('dishes').insert([dish]).select();
        if (error) throw error;
        return jsonResponse({ success: true, data }, 200, Object.fromEntries(corsHeaders.entries()));
      }

      case 'update_dish': {
        const { id, updates: rawUpdates } = body;
        if (!id || !rawUpdates || typeof rawUpdates !== 'object') {
          return jsonResponse({ error: 'Dish ID and updates payload are required' }, 400, Object.fromEntries(corsHeaders.entries()));
        }
        const updates = sanitizeDishFields(rawUpdates);
        const { data, error } = await sb.from('dishes').update(updates).eq('id', id).select();
        if (error) throw error;
        return jsonResponse({ success: true, data }, 200, Object.fromEntries(corsHeaders.entries()));
      }

      case 'toggle_stock': {
        const { id, in_stock } = body;
        if (!id || typeof in_stock !== 'boolean') {
          return jsonResponse({ error: 'Dish ID and in_stock boolean are required' }, 400, Object.fromEntries(corsHeaders.entries()));
        }
        const { data, error } = await sb.from('dishes').update({ in_stock }).eq('id', id).select();
        if (error) throw error;
        return jsonResponse({ success: true, data }, 200, Object.fromEntries(corsHeaders.entries()));
      }

      case 'delete_dish': {
        const { id } = body;
        if (!id) {
          return jsonResponse({ error: 'Dish ID is required' }, 400, Object.fromEntries(corsHeaders.entries()));
        }
        const { error } = await sb.from('dishes').delete().eq('id', id);
        if (error) throw error;
        return jsonResponse({ success: true }, 200, Object.fromEntries(corsHeaders.entries()));
      }

      case 'add_category': {
        const category = body.category;
        if (!category || !category.id || !category.name) {
          return jsonResponse({ error: 'Valid category payload (id, name) is required' }, 400, Object.fromEntries(corsHeaders.entries()));
        }
        const { data, error } = await sb.from('categories').insert([category]).select();
        if (error) throw error;
        return jsonResponse({ success: true, data }, 200, Object.fromEntries(corsHeaders.entries()));
      }

      case 'update_category': {
        const { id, updates } = body;
        if (!id || !updates || typeof updates !== 'object') {
          return jsonResponse({ error: 'Category ID and updates payload are required' }, 400, Object.fromEntries(corsHeaders.entries()));
        }
        const { data, error } = await sb.from('categories').update(updates).eq('id', id).select();
        if (error) throw error;
        return jsonResponse({ success: true, data }, 200, Object.fromEntries(corsHeaders.entries()));
      }

      case 'delete_category': {
        const { id, catKey } = body;
        if (!id) {
          return jsonResponse({ error: 'Category ID is required' }, 400, Object.fromEntries(corsHeaders.entries()));
        }
        if (catKey) {
          await sb.from('dishes').delete().or(`category.eq.${catKey},category.eq.${id}`);
        }
        const { error } = await sb.from('categories').delete().eq('id', id);
        if (error) throw error;
        return jsonResponse({ success: true }, 200, Object.fromEntries(corsHeaders.entries()));
      }

      case 'save_settings': {
        const settings = body.settings;
        if (!settings || typeof settings !== 'object') {
          return jsonResponse({ error: 'Settings object is required' }, 400, Object.fromEntries(corsHeaders.entries()));
        }
        const now = new Date().toISOString();
        const { data, error } = await sb.from('store_settings').upsert([
          { id: 'restaurant_config', settings, updated_at: now },
          { id: 'main_settings', settings, updated_at: now }
        ], { onConflict: 'id' }).select();
        if (error) throw error;
        return jsonResponse({ success: true, data }, 200, Object.fromEntries(corsHeaders.entries()));
      }

      case 'save_category_images': {
        const images = body.images;
        if (!images || typeof images !== 'object') {
          return jsonResponse({ error: 'Images map is required' }, 400, Object.fromEntries(corsHeaders.entries()));
        }
        const now = new Date().toISOString();
        const { data, error } = await sb.from('store_settings').upsert([
          { id: 'category_images', settings: images, updated_at: now }
        ], { onConflict: 'id' }).select();
        if (error) throw error;
        return jsonResponse({ success: true, data }, 200, Object.fromEntries(corsHeaders.entries()));
      }

      default:
        return jsonResponse({ error: `Unknown action: ${action}` }, 400, Object.fromEntries(corsHeaders.entries()));
    }
  } catch (err) {
    console.error(`[AdminStore] Error executing ${action}:`, err.message);
    const isProd = (env && (env.NODE_ENV === 'production' || env.ENVIRONMENT === 'production')) ||
      (typeof process !== 'undefined' && process.env && (process.env.NODE_ENV === 'production' || process.env.ENVIRONMENT === 'production'));
    return jsonResponse({ error: isProd ? 'Internal server error' : (err.message || 'Failed to update store data') }, 500, Object.fromEntries(corsHeaders.entries()));
  }
}
