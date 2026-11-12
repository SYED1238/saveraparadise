/**
 * Cloudflare Pages Function: Cashfree Create PG Order & Verify Payment
 * POST /api/cashfree-create-order
 */
import crypto from 'node:crypto';
import {
  createPgOrder,
  verifyPgOrderPayment,
  getSupabaseServiceCreds,
  recordVerifiedCashfreePayment
} from './_cashfree.js';
import { verifySignedPayload } from './_auth.js';
import { verifyTurnstileToken, getClientIp } from './_turnstile.js';
import { hydrateEnv, isOriginAllowed, jsonResponse } from './_adapter.js';

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
      return jsonResponse({ error: 'Invalid JSON', message: 'Request body must be valid JSON' }, 400, Object.fromEntries(corsHeaders.entries()));
    }

    const action = String(body?.action || 'create').trim();

    if (action === 'verify_payment') {
      const cfOrderId = String(body?.cfOrderId || body?.cf_order_id || '').trim();
      if (!cfOrderId) {
        return jsonResponse({ error: 'Bad Request', message: 'cfOrderId is required' }, 400, Object.fromEntries(corsHeaders.entries()));
      }

      const verifyRes = await verifyPgOrderPayment({ cfOrderId, env });
      if (!verifyRes.success) {
        return jsonResponse({ error: 'Verification Failed', message: verifyRes.error || 'Could not verify Cashfree payment' }, 502, Object.fromEntries(corsHeaders.entries()));
      }

      if (!verifyRes.paid) {
        return jsonResponse({
          success: true,
          paid: false,
          cfOrderId,
          paymentStatus: verifyRes.paymentStatus || 'PENDING'
        }, 200, Object.fromEntries(corsHeaders.entries()));
      }

      let recorded = null;
      try {
        recorded = await recordVerifiedCashfreePayment({
          cfOrderId,
          cfPaymentId: verifyRes.cfPaymentId,
          paymentAmount: verifyRes.paymentAmount,
          cleanOrderId: String(body?.orderId || '').replace(/^#+/, ''),
          env
        });
      } catch (dbErr) {
        console.warn('[Cashfree Verify] Supabase update error:', dbErr.message);
      }

      if (recorded?.amountMismatch) {
        return jsonResponse({
          error: 'Amount Mismatch',
          message: `Payment amount (${recorded.paymentAmount}) does not match order total (${recorded.orderTotal})`
        }, 400, Object.fromEntries(corsHeaders.entries()));
      }

      const updatedOrder = recorded?.order || null;
      return jsonResponse({
        success: true,
        paid: true,
        cfOrderId,
        cfPaymentId: verifyRes.cfPaymentId,
        paymentAmount: verifyRes.paymentAmount,
        paymentMethod: verifyRes.paymentMethod,
        orderId: updatedOrder?.id || body?.orderId || null,
        trackingToken: updatedOrder?.tracking_token || body?.trackingToken || null,
        order: updatedOrder
      }, 200, Object.fromEntries(corsHeaders.entries()));
    }

    const { orderId, customerPhone, customerName, customerEmail, returnUrl, checkoutToken, turnstileToken, order: orderDraft } = body || {};

    if (turnstileToken) {
      const clientIp = getClientIp(request);
      const turnstileRes = await verifyTurnstileToken(turnstileToken, clientIp, null, env);
      if (!turnstileRes.success) {
        return jsonResponse({ error: 'Forbidden', message: 'Security check failed. Bot activity suspected.', botBlocked: true }, 403, Object.fromEntries(corsHeaders.entries()));
      }
    }

    if (!checkoutToken) {
      return jsonResponse({ error: 'Bad Request', message: 'checkoutToken is strictly required for PG order creation' }, 400, Object.fromEntries(corsHeaders.entries()));
    }

    // Anti-price tampering: cryptographically verify signed payload and 15m TTL
    const decodedPayload = verifySignedPayload(checkoutToken, env);
    if (!decodedPayload || typeof decodedPayload.numericTotal !== 'number' || decodedPayload.numericTotal <= 0) {
      return jsonResponse({ error: 'Invalid Token', message: 'Checkout token verification failed' }, 400, Object.fromEntries(corsHeaders.entries()));
    }

    const tokenTime = decodedPayload.verifiedAt || decodedPayload.timestamp || 0;
    if (tokenTime && Math.abs(Date.now() - tokenTime) > 15 * 60 * 1000) {
      return jsonResponse({ error: 'Expired Token', message: 'Checkout token has expired (15m limit)' }, 400, Object.fromEntries(corsHeaders.entries()));
    }

    if (!orderId) {
      return jsonResponse({ error: 'Bad Request', message: 'orderId is required' }, 400, Object.fromEntries(corsHeaders.entries()));
    }

    const finalAmount = Number(decodedPayload.numericTotal);
    const rawClean = String(orderId).trim().replace(/^#+/, '').replace(/[^a-zA-Z0-9_-]/g, '');
    let cleanId = rawClean ? `#${rawClean}` : `#QB-${Math.floor(1000 + Math.random() * 9000)}`;
    const { supabaseUrl, serviceKey } = getSupabaseServiceCreds(env);
    let sb = null;

    if (orderDraft && supabaseUrl && serviceKey) {
      try {
        const { createClient } = await import('@supabase/supabase-js');
        sb = createClient(supabaseUrl, serviceKey);
        const noHash = cleanId.replace(/^#/, '');
        const { data: existing } = await sb
          .from('orders')
          .select('id')
          .or(`id.eq.${noHash},id.eq.#${noHash}`)
          .maybeSingle();
        if (existing) {
          cleanId = `${cleanId}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
        }
      } catch (dbCheckErr) {
        console.warn('[Cashfree Create] ID check warning:', dbCheckErr.message);
      }
    }

    const result = await createPgOrder({
      orderId: cleanId,
      amount: finalAmount,
      customerPhone,
      customerName,
      customerEmail,
      returnUrl,
      env
    });

    if (!result.success) {
      return jsonResponse({ error: 'Order Creation Failed', message: result.error }, 500, Object.fromEntries(corsHeaders.entries()));
    }

    let trackingToken = null;
    if (orderDraft && sb) {
      try {
        trackingToken = crypto.randomUUID();
        const digits = cleanId.replace(/\D/g, '');
        const pickupCode = orderDraft.pickupCode || orderDraft.pickup_code || (digits.length >= 4 ? digits.slice(-4) : '1001');
        const enforcedItems = (Array.isArray(decodedPayload.items) && decodedPayload.items.length > 0)
          ? decodedPayload.items
          : (Array.isArray(orderDraft.items) ? orderDraft.items : []);
        const itemsSummary = enforcedItems.length > 0
          ? enforcedItems.map(i => `${i.quantity || 1}x ${i.name}`).join(', ')
          : (orderDraft.itemsSummary || orderDraft.items_summary || '');
        const addressDetails = (orderDraft.addressDetails || orderDraft.address_details)
          ? { ...(orderDraft.addressDetails || orderDraft.address_details) }
          : {};
        if (typeof decodedPayload.discount === 'number') addressDetails.discount = decodedPayload.discount;
        if (typeof decodedPayload.deliveryFee === 'number') addressDetails.deliveryFee = decodedPayload.deliveryFee;
        if (typeof decodedPayload.platformFee === 'number') addressDetails.platformFee = decodedPayload.platformFee;

        const insertPayload = {
          id: cleanId,
          created_at: Number(orderDraft.createdAt || orderDraft.created_at) || Date.now(),
          customer_name: orderDraft.customerName || orderDraft.customer_name || customerName || 'Online Guest',
          customer_phone: orderDraft.customerPhone || orderDraft.customer_phone || customerPhone || null,
          customer_email: orderDraft.customerEmail || orderDraft.customer_email || customerEmail || null,
          user_id: orderDraft.userId || orderDraft.user_id || null,
          delivery_address: orderDraft.deliveryAddress || orderDraft.delivery_address || 'Express Delivery',
          pickup_code: pickupCode,
          payment_method: 'Online',
          payment_status: 'Pending Payment',
          is_paid_online: false,
          doorstep_upi: false,
          cash_collected: 0,
          payment_gateway: 'cashfree',
          cf_order_id: result.cfOrderId,
          cf_payment_status: 'PENDING',
          step_index: 0,
          status: 'pending_payment',
          status_label: 'Awaiting Payment',
          eta: orderDraft.eta || '25 - 35 Minutes',
          items_summary: itemsSummary,
          items: enforcedItems,
          total: `₹${Math.round(finalAmount)}`,
          lat: (orderDraft.lat !== undefined && !isNaN(Number(orderDraft.lat))) ? Number(orderDraft.lat) : (addressDetails.lat ? Number(addressDetails.lat) : null),
          lng: (orderDraft.lng !== undefined && !isNaN(Number(orderDraft.lng))) ? Number(orderDraft.lng) : (addressDetails.lng ? Number(addressDetails.lng) : null),
          address_details: Object.keys(addressDetails).length > 0 ? addressDetails : null,
          tracking_token: trackingToken
        };

        const { error: insertErr } = await sb.from('orders').insert([insertPayload]);
        if (insertErr) {
          console.warn('[Cashfree Create] Pending order insert error:', insertErr.message);
        }
      } catch (persistErr) {
        console.warn('[Cashfree Create] Pending order persist error:', persistErr.message);
      }
    }

    return jsonResponse({
      ...result,
      orderId: cleanId,
      trackingToken
    }, 200, Object.fromEntries(corsHeaders.entries()));
  } catch (err) {
    return jsonResponse({ error: 'Internal Error', message: err.message }, 500, Object.fromEntries(corsHeaders.entries()));
  }
}
