/**
 * Local Dev / Node Serverless API: Admin Menu & Store Settings Endpoint
 * POST /api/admin-store
 */
import { verifyAdminToken } from './_auth.js';
import { createClient } from '@supabase/supabase-js';

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
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

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-token');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 1. Verify admin/owner session token (strict role check: admin or owner)
  const auth = verifyAdminToken(req, ['admin', 'owner']);
  if (!auth || !auth.valid) {
    return res.status(401).json({ error: auth?.error || 'Unauthorized: Admin or Owner session required' });
  }

  const body = req.body || {};
  const action = String(body.action || '').trim();
  if (!action) {
    return res.status(400).json({ error: 'Action parameter is required' });
  }

  // Role Gate: Modifying store settings requires Executive Owner session
  if (action === 'save_settings' && auth.payload?.role !== 'owner') {
    return res.status(403).json({ error: 'Forbidden: Owner role required to modify store settings' });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(503).json({ error: 'Database service credentials not configured on server' });
  }

  try {
    const sb = createClient(supabaseUrl, serviceKey);

    switch (action) {
      case 'add_dish': {
        const rawDish = body.dish;
        if (!rawDish || !rawDish.id || !rawDish.name) {
          return res.status(400).json({ error: 'Valid dish payload (id, name) is required' });
        }
        const dish = sanitizeDishFields(rawDish);
        const { data, error } = await sb.from('dishes').insert([dish]).select();
        if (error) throw error;
        return res.status(200).json({ success: true, data });
      }

      case 'update_dish': {
        const { id, updates: rawUpdates } = body;
        if (!id || !rawUpdates || typeof rawUpdates !== 'object') {
          return res.status(400).json({ error: 'Dish ID and updates payload are required' });
        }
        const updates = sanitizeDishFields(rawUpdates);
        const { data, error } = await sb.from('dishes').update(updates).eq('id', id).select();
        if (error) throw error;
        return res.status(200).json({ success: true, data });
      }

      case 'toggle_stock': {
        const { id, in_stock } = body;
        if (!id || typeof in_stock !== 'boolean') {
          return res.status(400).json({ error: 'Dish ID and in_stock boolean are required' });
        }
        const { data, error } = await sb.from('dishes').update({ in_stock }).eq('id', id).select();
        if (error) throw error;
        return res.status(200).json({ success: true, data });
      }

      case 'delete_dish': {
        const { id } = body;
        if (!id) return res.status(400).json({ error: 'Dish ID is required' });
        const { error } = await sb.from('dishes').delete().eq('id', id);
        if (error) throw error;
        return res.status(200).json({ success: true });
      }

      case 'add_category': {
        const category = body.category;
        if (!category || !category.id || !category.name) {
          return res.status(400).json({ error: 'Valid category payload (id, name) is required' });
        }
        const { data, error } = await sb.from('categories').insert([category]).select();
        if (error) throw error;
        return res.status(200).json({ success: true, data });
      }

      case 'update_category': {
        const { id, updates } = body;
        if (!id || !updates || typeof updates !== 'object') {
          return res.status(400).json({ error: 'Category ID and updates payload are required' });
        }
        const { data, error } = await sb.from('categories').update(updates).eq('id', id).select();
        if (error) throw error;
        return res.status(200).json({ success: true, data });
      }

      case 'delete_category': {
        const { id, catKey } = body;
        if (!id) return res.status(400).json({ error: 'Category ID is required' });
        if (catKey) {
          await sb.from('dishes').delete().or(`category.eq.${catKey},category.eq.${id}`);
        }
        const { error } = await sb.from('categories').delete().eq('id', id);
        if (error) throw error;
        return res.status(200).json({ success: true });
      }

      case 'save_settings': {
        const settings = body.settings;
        if (!settings || typeof settings !== 'object') {
          return res.status(400).json({ error: 'Settings object is required' });
        }
        const now = new Date().toISOString();
        const { data, error } = await sb.from('store_settings').upsert([
          { id: 'restaurant_config', settings, updated_at: now },
          { id: 'main_settings', settings, updated_at: now }
        ], { onConflict: 'id' }).select();
        if (error) throw error;
        return res.status(200).json({ success: true, data });
      }

      case 'save_category_images': {
        const images = body.images;
        if (!images || typeof images !== 'object') {
          return res.status(400).json({ error: 'Images map is required' });
        }
        const now = new Date().toISOString();
        const { data, error } = await sb.from('store_settings').upsert([
          { id: 'category_images', settings: images, updated_at: now }
        ], { onConflict: 'id' }).select();
        if (error) throw error;
        return res.status(200).json({ success: true, data });
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error(`[AdminStore] Error executing ${action}:`, err.message);
    const isProd = process.env.NODE_ENV === 'production';
    return res.status(500).json({ error: isProd ? 'Internal server error' : (err.message || 'Failed to update store data') });
  }
}
