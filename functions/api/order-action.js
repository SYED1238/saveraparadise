/**
 * Cloudflare Pages Function: Order Actions & Secure Sync Endpoint
 * POST /api/order-action
 * 
 * Secure server-side gateway for order state transitions,
 * rider claims, customer order cancellations, and authorized order sync.
 */
import { verifyAdminToken } from './_auth.js';
import { hydrateEnv, jsonResponse, isOriginAllowed } from './_adapter.js';

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

  // 1. Role Gate: Enforce authentication for staff-restricted actions
  if (['sync_orders', 'update_status', 'claim_order'].includes(action)) {
    const auth = verifyAdminToken(request, env, ['admin', 'owner', 'rider']);
    if (!auth || !auth.valid) {
      return jsonResponse({ error: auth?.error || 'Unauthorized: Staff or Rider session required' }, 401, Object.fromEntries(corsHeaders.entries()));
    }
  }

  // 2. Cancellation Pre-check: Reject unauthenticated cancellations without tracking token
  if (action === 'cancel_order') {
    const auth = verifyAdminToken(request, env, ['admin', 'owner']);
    const isStaff = auth && auth.valid;
    const hasToken = Boolean(body?.trackingToken);
    if (!isStaff && !hasToken) {
      return jsonResponse({ error: 'Forbidden: Valid cancellation token or staff session required' }, 403, Object.fromEntries(corsHeaders.entries()));
    }
  }

  const supabaseUrl = (env && (env.VITE_SUPABASE_URL || env.SUPABASE_URL)) ||
    (typeof process !== 'undefined' && process.env && (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL));
  const serviceKey = (env && env.SUPABASE_SERVICE_ROLE_KEY) ||
    (typeof process !== 'undefined' && process.env && process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!supabaseUrl || !serviceKey) {
    console.warn('[OrderAction] Supabase service credentials missing');
    return jsonResponse({ error: 'Database service credentials not configured on server' }, 503, Object.fromEntries(corsHeaders.entries()));
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(supabaseUrl, serviceKey);

    switch (action) {
      // 1. Authenticated Staff Sync (Admin, Delivery, Owner)
      case 'sync_orders': {
        const auth = verifyAdminToken(request, env, ['admin', 'owner', 'rider']);
        if (!auth || !auth.valid) {
          return jsonResponse({ error: auth?.error || 'Unauthorized: Staff session required' }, 401, Object.fromEntries(corsHeaders.entries()));
        }
        const limit = Math.min(Number(body.limit) || 250, 500);
        const { data, error } = await sb
          .from('orders')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(limit);
        if (error) throw error;
        return jsonResponse({ success: true, orders: data || [] }, 200, Object.fromEntries(corsHeaders.entries()));
      }

      // 2. Verified Guest Customer Order Tracking (Requires Order ID + Tracking Token)
      case 'track_orders': {
        const orderIds = Array.isArray(body.orderIds) ? body.orderIds : (body.orderId ? [body.orderId] : []);
        const tokensMap = (body.trackingTokens && typeof body.trackingTokens === 'object') ? body.trackingTokens : {};
        if (body.orderId && body.trackingToken) {
          tokensMap[body.orderId] = body.trackingToken;
        }

        if (orderIds.length === 0) {
          return jsonResponse({ success: true, orders: [] }, 200, Object.fromEntries(corsHeaders.entries()));
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

        return jsonResponse({ success: true, orders: verifiedOrders }, 200, Object.fromEntries(corsHeaders.entries()));
      }

      // 3. Operational Order Status Updates (Staff / Rider)
      case 'update_status': {
        const auth = verifyAdminToken(request, env, ['admin', 'owner', 'rider']);
        if (!auth || !auth.valid) {
          return jsonResponse({ error: auth?.error || 'Unauthorized: Staff or Rider session required' }, 401, Object.fromEntries(corsHeaders.entries()));
        }

        const { orderId, status, stepIndex, statusLabel, eta, cancellationReason, deliveredAt, cashCollected, paymentStatus, doorstepUpi, isPaidOnline } = body;
        if (!orderId || !status) {
          return jsonResponse({ error: 'orderId and status are required' }, 400, Object.fromEntries(corsHeaders.entries()));
        }

        const cleanId = String(orderId).replace(/^#/, '');
        const { data: existing, error: fetchErr } = await sb
          .from('orders')
          .select('*')
          .or(`id.eq.${cleanId},id.eq.#${cleanId}`)
          .maybeSingle();

        if (fetchErr) throw fetchErr;
        if (!existing) {
          return jsonResponse({ error: 'Order not found' }, 404, Object.fromEntries(corsHeaders.entries()));
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
        return jsonResponse({ success: true, order: updated }, 200, Object.fromEntries(corsHeaders.entries()));
      }

      // 4. Delivery Rider Claim Order
      case 'claim_order': {
        const auth = verifyAdminToken(request, env, ['admin', 'owner', 'rider']);
        if (!auth || !auth.valid) {
          return jsonResponse({ error: auth?.error || 'Unauthorized: Rider or Staff session required' }, 401, Object.fromEntries(corsHeaders.entries()));
        }

        const { orderId, riderPin, riderName, riderPhone, riderVehicle } = body;
        if (!orderId) {
          return jsonResponse({ error: 'orderId is required' }, 400, Object.fromEntries(corsHeaders.entries()));
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
        return jsonResponse({ success: true, order: updated }, 200, Object.fromEntries(corsHeaders.entries()));
      }

      // 5. Order Cancellation (Customer or Staff)
      case 'cancel_order': {
        const { orderId, trackingToken, reason } = body;
        if (!orderId) {
          return jsonResponse({ error: 'orderId is required' }, 400, Object.fromEntries(corsHeaders.entries()));
        }

        const cleanId = String(orderId).replace(/^#/, '');
        const { data: order, error: fetchErr } = await sb
          .from('orders')
          .select('*')
          .or(`id.eq.${cleanId},id.eq.#${cleanId}`)
          .maybeSingle();

        if (fetchErr) throw fetchErr;
        if (!order) {
          return jsonResponse({ error: 'Order not found' }, 404, Object.fromEntries(corsHeaders.entries()));
        }

        // Authorization check: either verified staff session OR verified tracking token
        const auth = verifyAdminToken(request, env, ['admin', 'owner']);
        const isStaff = auth && auth.valid;
        const isCustomerWithToken = Boolean(trackingToken && order.tracking_token && trackingToken === order.tracking_token);

        if (!isStaff && !isCustomerWithToken) {
          return jsonResponse({ error: 'Forbidden: Valid cancellation token or staff session required' }, 403, Object.fromEntries(corsHeaders.entries()));
        }

        // Customer cancellation rule: Cannot cancel once cooking starts
        if (!isStaff && !['pending', 'accepted'].includes(order.status)) {
          return jsonResponse({ error: `Cannot cancel order once kitchen preparation has begun (${order.status})` }, 400, Object.fromEntries(corsHeaders.entries()));
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
        return jsonResponse({ success: true, order: updated }, 200, Object.fromEntries(corsHeaders.entries()));
      }

      default:
        return jsonResponse({ error: `Unknown action: ${action}` }, 400, Object.fromEntries(corsHeaders.entries()));
    }
  } catch (err) {
    console.error(`[OrderAction] Error executing ${action}:`, err.message);
    const isProd = (env && (env.NODE_ENV === 'production' || env.ENVIRONMENT === 'production')) ||
      (typeof process !== 'undefined' && process.env && (process.env.NODE_ENV === 'production' || process.env.ENVIRONMENT === 'production'));
    return jsonResponse({ error: isProd ? 'Internal server error' : (err.message || 'Failed to process order action') }, 500, Object.fromEntries(corsHeaders.entries()));
  }
}
