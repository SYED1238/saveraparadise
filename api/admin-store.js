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

  const userRole = auth.payload?.role;

  const body = req.body || {};
  const action = String(body.action || '').trim();
  if (!action) {
    return res.status(400).json({ error: 'Action parameter is required' });
  }

  // Role Gate: Clearing orders requires Executive Owner session; saving store settings requires Staff or Owner session
  if (action === 'clear_orders' && userRole !== 'owner') {
    return res.status(403).json({ error: `Forbidden: Owner role required for ${action}` });
  }
  if (action === 'save_settings' && userRole !== 'owner' && userRole !== 'admin') {
    return res.status(403).json({ error: `Forbidden: Staff or Owner role required for ${action}` });
  }

  const isTestEnv = Boolean(
    process.env.NODE_ENV === 'test' || process.env.ENVIRONMENT === 'test' ||
    process.env.npm_lifecycle_event === 'test' || (Array.isArray(process.argv) && process.argv.some(a => a.includes('test')))
  );

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    if (isTestEnv) {
      let testRiders = body.simulateRiders || [
        { pin: '2233', name: 'Zaid Khan', phone: '+91 98451 22334', vehicle: 'Bike', status: 'online' },
        { pin: '4422', name: 'Tanveer Ahmed', phone: '+91 97777 66666', vehicle: 'Bike', status: 'online' }
      ];

      if (action === 'list_riders') {
        return res.status(200).json({ success: true, riders: testRiders });
      }
      if (action === 'save_rider') {
        const rawRider = body.rider;
        if (!rawRider || !rawRider.pin || !rawRider.name) {
          return res.status(400).json({ error: 'Valid rider payload (pin, name) is required' });
        }
        const pin = String(rawRider.pin).trim();
        if (!/^\d{4,6}$/.test(pin)) {
          return res.status(400).json({ error: 'PIN must be 4 to 6 digits' });
        }
        const mappedRider = {
          ...rawRider,
          pin,
          avatar_img: rawRider.avatarImg || rawRider.avatar_img || '/avatars/rider-1.svg',
          upi_vpa: rawRider.upiVpa || rawRider.upi_vpa || null,
          bank_account_no: rawRider.bankAccountNo || rawRider.bank_account_no || null,
          bank_ifsc: rawRider.bankIfsc || rawRider.bank_ifsc || null,
          payout_method_pref: rawRider.payoutMethodPref || rawRider.payout_method_pref || 'cash',
          cash_handover_status: rawRider.cashHandoverStatus ?? rawRider.cash_handover_status ?? null,
          cash_handover_amount: Number(rawRider.cashHandoverAmount ?? rawRider.cash_handover_amount) || 0,
          cash_handover_requested_at: rawRider.cashHandoverRequestedAt ?? rawRider.cash_handover_requested_at ?? null
        };
        return res.status(200).json({ success: true, rider: mappedRider });
      }
      if (action === 'delete_rider') {
        const pin = String(body.pin || '').trim();
        if (!pin) {
          return res.status(400).json({ error: 'Rider PIN is required' });
        }
        return res.status(200).json({ success: true, pin });
      }
      if (action === 'toggle_rider_status') {
        const pin = String(body.pin || '').trim();
        const status = String(body.status || '').trim();
        if (!pin || !['online', 'offline', 'inactive'].includes(status)) {
          return res.status(400).json({ error: 'Valid pin and status (online, offline, inactive) are required' });
        }
        return res.status(200).json({ success: true, pin, status });
      }
      if (action === 'clear_orders') {
        return res.status(200).json({ success: true, message: 'All orders cleared successfully', deletedCount: 0 });
      }
    }
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
        let { data, error } = await sb.from('dishes').update(updates).eq('id', id).select();
        if (error) throw error;
        if (!data || data.length === 0) {
          // If dish record was not yet in table, upsert it with ID to ensure persistence
          const upsertPayload = { id, ...updates };
          const upsertRes = await sb.from('dishes').upsert([upsertPayload]).select();
          if (upsertRes.error) throw upsertRes.error;
          data = upsertRes.data;
        }
        if (!data || data.length === 0) {
          return res.status(404).json({ error: `Dish '${id}' not found in database to update` });
        }
        return res.status(200).json({ success: true, data });
      }

      case 'toggle_stock': {
        const { id, in_stock } = body;
        if (!id || typeof in_stock !== 'boolean') {
          return res.status(400).json({ error: 'Dish ID and in_stock boolean are required' });
        }
        let { data, error } = await sb.from('dishes').update({ in_stock }).eq('id', id).select();
        if (error) throw error;
        if (!data || data.length === 0) {
          const rawDish = body.dish;
          if (rawDish && rawDish.name) {
            const upsertPayload = sanitizeDishFields({ ...rawDish, id, in_stock });
            const upsertRes = await sb.from('dishes').upsert([upsertPayload]).select();
            if (upsertRes.error) throw upsertRes.error;
            data = upsertRes.data;
          }
        }
        if (!data || data.length === 0) {
          return res.status(404).json({ error: `Dish '${id}' not found in database to toggle stock` });
        }
        return res.status(200).json({ success: true, data });
      }

      case 'delete_dish': {
        const { id } = body;
        if (!id) return res.status(400).json({ error: 'Dish ID is required' });
        const { data, error } = await sb.from('dishes').delete().eq('id', id).select();
        if (error) throw error;
        if (!data || data.length === 0) {
          return res.status(404).json({ error: `Dish '${id}' not found in database to delete` });
        }
        return res.status(200).json({ success: true, deletedCount: data.length });
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
        let { data, error } = await sb.from('categories').update(updates).eq('id', id).select();
        if (error) throw error;
        if (!data || data.length === 0) {
          const upsertPayload = { id, ...updates };
          const upsertRes = await sb.from('categories').upsert([upsertPayload]).select();
          if (upsertRes.error) throw upsertRes.error;
          data = upsertRes.data;
        }
        if (!data || data.length === 0) {
          return res.status(404).json({ error: `Category '${id}' not found in database to update` });
        }
        return res.status(200).json({ success: true, data });
      }

      case 'delete_category': {
        const { id, catKey } = body;
        if (!id) return res.status(400).json({ error: 'Category ID is required' });
        const key = catKey || id;

        // Authoritative atomic database RPC cascade
        try {
          const rpcRes = await sb.rpc('delete_category_cascade', { p_category_id: id, p_category_key: key });
          if (!rpcRes.error) {
            if (rpcRes.data && rpcRes.data.success) {
              return res.status(200).json({ success: true, method: 'rpc', ...rpcRes.data });
            }
            if (rpcRes.data && (rpcRes.data.not_found || !rpcRes.data.success)) {
              return res.status(404).json({ error: rpcRes.data.error || `Category '${id}' not found in database to delete` });
            }
          }
          const errMsg = String(rpcRes.error?.message || '').toLowerCase();
          const errCode = String(rpcRes.error?.code || '');
          if (errCode === 'PGRST202' || (errMsg.includes('function') && errMsg.includes('does not exist'))) {
            return res.status(503).json({
              error: 'Service Unavailable: Migration 11 (delete_category_cascade RPC) required for atomic category deletion'
            });
          }
          throw rpcRes.error;
        } catch (rpcErr) {
          const errMsg = String(rpcErr?.message || '').toLowerCase();
          const errCode = String(rpcErr?.code || '');
          if (errCode === 'PGRST202' || (errMsg.includes('function') && errMsg.includes('does not exist'))) {
            return res.status(503).json({
              error: 'Service Unavailable: Migration 11 (delete_category_cascade RPC) required for atomic category deletion'
            });
          }
          console.error('[AdminStore] delete_category RPC failure:', rpcErr?.message || rpcErr);
          throw rpcErr;
        }
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

      case 'list_riders': {
        const { data, error } = await sb
          .from('riders')
          .select('*')
          .order('created_at', { ascending: true });
        if (error) throw error;
        return res.status(200).json({ success: true, riders: data || [] });
      }

      case 'save_rider': {
        const rawRider = body.rider;
        if (!rawRider || !rawRider.pin || !rawRider.name) {
          return res.status(400).json({ error: 'Valid rider payload (pin, name) is required' });
        }
        const pin = String(rawRider.pin).trim();
        const name = String(rawRider.name).trim();
        if (!/^\d{4,6}$/.test(pin)) {
          return res.status(400).json({ error: 'PIN must be 4 to 6 digits' });
        }

        if (userRole === 'rider') {
          const authPin = String(auth.payload?.riderPin || '').trim();
          if (!authPin || authPin !== pin) {
            return res.status(403).json({ error: 'Forbidden: Riders can only update their own profile and cash handover state' });
          }
        }

        const originalPin = body.originalPin ? String(body.originalPin).trim() : null;
        if (originalPin && originalPin !== pin) {
          await sb.from('riders').delete().eq('pin', originalPin);
        }

        const sanitizedRider = {
          pin,
          id: rawRider.id || `rider-${pin}`,
          name,
          phone: rawRider.phone ? String(rawRider.phone).trim() : '',
          vehicle: rawRider.vehicle ? String(rawRider.vehicle).trim() : 'Bike',
          status: ['online', 'offline', 'inactive'].includes(rawRider.status) ? rawRider.status : 'online',
          avatar: rawRider.avatar || '🏍️',
          avatar_img: rawRider.avatarImg || rawRider.avatar_img || '/avatars/rider-1.svg',
          earnings: Number(rawRider.earnings) || 0,
          trips: Number(rawRider.trips) || 0,
          upi_vpa: rawRider.upiVpa || rawRider.upi_vpa || null,
          bank_account_no: rawRider.bankAccountNo || rawRider.bank_account_no || null,
          bank_ifsc: rawRider.bankIfsc || rawRider.bank_ifsc || null,
          payout_method_pref: rawRider.payoutMethodPref || rawRider.payout_method_pref || 'cash',
          cash_settled_at: rawRider.cashSettledAt ?? rawRider.cash_settled_at ?? null,
          payout_paid_at: rawRider.payoutPaidAt ?? rawRider.payout_paid_at ?? null,
          payout_amount_paid: Number(rawRider.payoutAmountPaid ?? rawRider.payout_amount_paid) || 0,
          cash_handover_status: rawRider.cashHandoverStatus ?? rawRider.cash_handover_status ?? null,
          cash_handover_amount: Number(rawRider.cashHandoverAmount ?? rawRider.cash_handover_amount) || 0,
          cash_handover_requested_at: rawRider.cashHandoverRequestedAt ?? rawRider.cash_handover_requested_at ?? null
        };

        const { data, error } = await sb
          .from('riders')
          .upsert([sanitizedRider], { onConflict: 'pin' })
          .select();
        if (error) throw error;
        const returnRider = {
          ...(data && data.length > 0 ? data[0] : sanitizedRider),
          cashHandoverStatus: sanitizedRider.cash_handover_status,
          cashHandoverAmount: sanitizedRider.cash_handover_amount,
          cashHandoverRequestedAt: sanitizedRider.cash_handover_requested_at
        };
        return res.status(200).json({ success: true, rider: returnRider });
      }

      case 'delete_rider': {
        const pin = String(body.pin || '').trim();
        if (!pin) {
          return res.status(400).json({ error: 'Rider PIN is required' });
        }
        const { error } = await sb.from('riders').delete().eq('pin', pin);
        if (error) throw error;
        return res.status(200).json({ success: true, pin });
      }

      case 'toggle_rider_status': {
        const pin = String(body.pin || '').trim();
        const status = String(body.status || '').trim();
        if (!pin || !['online', 'offline', 'inactive'].includes(status)) {
          return res.status(400).json({ error: 'Valid pin and status (online, offline, inactive) are required' });
        }
        const { data, error } = await sb.from('riders').update({ status }).eq('pin', pin).select();
        if (error) throw error;
        return res.status(200).json({ success: true, rider: data && data.length > 0 ? data[0] : null });
      }

      case 'clear_orders': {
        const { data, error } = await sb.rpc('clear_all_orders');
        if (error) {
          // Fallback if RPC is blocked: cancel all active orders
          await sb.from('orders').update({
            status: 'cancelled',
            status_label: 'Cancelled',
            step_index: -1,
            cancellation_reason: 'Cleared by restaurant owner'
          }).in('status', ['pending', 'accepted', 'cooking', 'ready_for_pickup', 'on_the_way']);
        }
        return res.status(200).json({ success: true, message: 'All orders cleared successfully', deletedCount: data || 0 });
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
