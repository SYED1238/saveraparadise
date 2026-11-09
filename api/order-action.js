/**
 * Local Dev / Node Serverless API: Order Actions & Secure Sync Endpoint
 * POST /api/order-action
 * 
 * Provides an authoritative server gateway for order state transitions,
 * rider claims, customer order cancellations, and authorized order sync.
 * Completely eliminates the need for anonymous direct database mutations on public.orders.
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

  const body = req.body || {};
  const action = String(body.action || '').trim();
  if (!action) {
    return res.status(400).json({ error: 'Action parameter is required' });
  }

  // 1. Role Gate: Enforce authentication for staff-restricted actions
  if (['sync_orders', 'update_status', 'claim_order'].includes(action)) {
    const auth = verifyAdminToken(req, ['admin', 'owner', 'rider']);
    if (!auth || !auth.valid) {
      return res.status(401).json({ error: auth?.error || 'Unauthorized: Staff or Rider session required' });
    }
  }

  // 2. Cancellation Pre-check: Reject unauthenticated cancellations without tracking token
  if (action === 'cancel_order') {
    const auth = verifyAdminToken(req, ['admin', 'owner']);
    const isStaff = auth && auth.valid;
    const hasToken = Boolean(body.trackingToken);
    if (!isStaff && !hasToken) {
      return res.status(403).json({ error: 'Forbidden: Valid cancellation token or staff session required' });
    }
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(503).json({ error: 'Database service credentials not configured on server' });
  }

  const sb = createClient(supabaseUrl, serviceKey);

  try {
    switch (action) {
      // 1. Authenticated Staff Sync (Admin, Delivery, Owner)
      case 'sync_orders': {
        const auth = verifyAdminToken(req, ['admin', 'owner', 'rider']);
        if (!auth || !auth.valid) {
          return res.status(401).json({ error: auth?.error || 'Unauthorized: Staff session required' });
        }
        const limit = Math.min(Number(body.limit) || 250, 500);
        const { data, error } = await sb
          .from('orders')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(limit);
        if (error) throw error;
        return res.status(200).json({ success: true, orders: data || [] });
      }

      // 2. Verified Guest Customer Order Tracking (Requires Order ID + Tracking Token)
      case 'track_orders': {
        const orderIds = Array.isArray(body.orderIds) ? body.orderIds : (body.orderId ? [body.orderId] : []);
        const tokensMap = (body.trackingTokens && typeof body.trackingTokens === 'object') ? body.trackingTokens : {};
        if (body.orderId && body.trackingToken) {
          tokensMap[body.orderId] = body.trackingToken;
        }

        if (orderIds.length === 0) {
          return res.status(200).json({ success: true, orders: [] });
        }

        const cleanIds = orderIds.map(id => String(id || '').replace(/^#/, '')).filter(Boolean);
        const idVariants = [];
        cleanIds.forEach(id => {
          idVariants.push(id);
          idVariants.push(`#${id}`);
        });

        const { data, error } = await sb
          .from('orders')
          .select('*')
          .in('id', idVariants);
        if (error) throw error;

        // Strictly filter to orders that match the caller's tracking token
        const verifiedOrders = (data || []).filter(o => {
          if (!o) return false;
          const cleanId = String(o.id).replace(/^#/, '');
          const expectedToken = tokensMap[o.id] || tokensMap[cleanId] || tokensMap[`#${cleanId}`];
          return Boolean(expectedToken && o.tracking_token && expectedToken === o.tracking_token);
        });

        return res.status(200).json({ success: true, orders: verifiedOrders });
      }

      // 3. Operational Order Status Updates (Staff / Rider)
      case 'update_status': {
        const auth = verifyAdminToken(req, ['admin', 'owner', 'rider']);
        if (!auth || !auth.valid) {
          return res.status(401).json({ error: auth?.error || 'Unauthorized: Staff or Rider session required' });
        }

        const { orderId, status, stepIndex, statusLabel, eta, cancellationReason, deliveredAt, cashCollected, paymentStatus, doorstepUpi, isPaidOnline } = body;
        if (!orderId || !status) {
          return res.status(400).json({ error: 'orderId and status are required' });
        }

        const cleanId = String(orderId).replace(/^#/, '');
        const { data: existing, error: fetchErr } = await sb
          .from('orders')
          .select('*')
          .or(`id.eq.${cleanId},id.eq.#${cleanId}`)
          .maybeSingle();

        if (fetchErr) throw fetchErr;
        if (!existing) {
          return res.status(404).json({ error: 'Order not found' });
        }

        const updatePayload = {
          status,
          step_index: typeof stepIndex === 'number' ? stepIndex : existing.step_index,
          status_label: statusLabel || existing.status_label,
          eta: eta !== undefined ? eta : existing.eta
        };

        if (deliveredAt) updatePayload.delivered_at = Number(deliveredAt);
        if (cancellationReason) updatePayload.cancellation_reason = cancellationReason;
        if (typeof doorstepUpi === 'boolean') updatePayload.doorstep_upi = doorstepUpi;
        if (typeof isPaidOnline === 'boolean') updatePayload.is_paid_online = isPaidOnline;

        // Payment status & Cash collection handling
        if (status === 'delivered') {
          if (paymentStatus === 'Paid') {
            updatePayload.payment_status = 'Paid';
          }
          if (typeof cashCollected === 'number') {
            updatePayload.cash_collected = cashCollected;
            if (cashCollected > 0) {
              updatePayload.payment_status = 'Paid';
            }
          }
        }

        const { data: updated, error: updateErr } = await sb
          .from('orders')
          .update(updatePayload)
          .or(`id.eq.${cleanId},id.eq.#${cleanId}`)
          .select()
          .maybeSingle();

        if (updateErr) throw updateErr;
        return res.status(200).json({ success: true, order: updated });
      }

      // 4. Delivery Rider Claim Order
      case 'claim_order': {
        const auth = verifyAdminToken(req, ['admin', 'owner', 'rider']);
        if (!auth || !auth.valid) {
          return res.status(401).json({ error: auth?.error || 'Unauthorized: Rider or Staff session required' });
        }

        const { orderId, riderPin, riderName, riderPhone, riderVehicle } = body;
        if (!orderId) {
          return res.status(400).json({ error: 'orderId is required' });
        }

        const cleanId = String(orderId).replace(/^#/, '');
        const updatePayload = {
          assigned_rider_pin: riderPin ? String(riderPin).trim() : null,
          assigned_rider_name: riderName ? String(riderName).trim() : null,
          assigned_rider_phone: riderPhone ? String(riderPhone).trim() : null,
          assigned_rider_vehicle: riderVehicle ? String(riderVehicle).trim() : 'Bike'
        };

        const { data: updated, error } = await sb
          .from('orders')
          .update(updatePayload)
          .or(`id.eq.${cleanId},id.eq.#${cleanId}`)
          .select()
          .maybeSingle();

        if (error) throw error;
        return res.status(200).json({ success: true, order: updated });
      }

      // 5. Order Cancellation (Customer or Staff)
      case 'cancel_order': {
        const { orderId, trackingToken, reason } = body;
        if (!orderId) {
          return res.status(400).json({ error: 'orderId is required' });
        }

        const cleanId = String(orderId).replace(/^#/, '');
        const { data: order, error: fetchErr } = await sb
          .from('orders')
          .select('*')
          .or(`id.eq.${cleanId},id.eq.#${cleanId}`)
          .maybeSingle();

        if (fetchErr) throw fetchErr;
        if (!order) {
          return res.status(404).json({ error: 'Order not found' });
        }

        // Authorization check: either verified staff session OR verified tracking token
        const auth = verifyAdminToken(req, ['admin', 'owner']);
        const isStaff = auth && auth.valid;
        const isCustomerWithToken = Boolean(trackingToken && order.tracking_token && trackingToken === order.tracking_token);

        if (!isStaff && !isCustomerWithToken) {
          return res.status(403).json({ error: 'Forbidden: Valid cancellation token or staff session required' });
        }

        // Customer cancellation rule: Cannot cancel once cooking starts
        if (!isStaff && !['pending', 'accepted'].includes(order.status)) {
          return res.status(400).json({ error: `Cannot cancel order once kitchen preparation has begun (${order.status})` });
        }

        const cancellationReason = reason || (isStaff ? 'Cancelled by restaurant management' : 'Cancelled by customer');
        const { data: updated, error: updateErr } = await sb
          .from('orders')
          .update({
            status: 'cancelled',
            status_label: 'Order Cancelled',
            cancellation_reason: cancellationReason
          })
          .or(`id.eq.${cleanId},id.eq.#${cleanId}`)
          .select()
          .maybeSingle();

        if (updateErr) throw updateErr;
        return res.status(200).json({ success: true, order: updated });
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error(`[OrderAction] Error executing ${action}:`, err.message);
    const isProd = process.env.NODE_ENV === 'production';
    return res.status(500).json({ error: isProd ? 'Internal server error' : (err.message || 'Failed to process order action') });
  }
}
