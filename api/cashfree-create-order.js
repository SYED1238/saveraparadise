/**
 * Serverless API: Cashfree Create PG Order & Verify Payment
 * POST /api/cashfree-create-order
 * Generates Cashfree order session token and verifies online payments for storefront checkout.
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

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, cf-turnstile-response');
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed', message: 'Only POST requests are supported' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        return res.status(400).json({ error: 'Invalid JSON', message: 'Request body must be valid JSON' });
      }
    }

    const action = String(body?.action || 'create').trim();

    if (action === 'verify_payment') {
      const cfOrderId = String(body?.cfOrderId || body?.cf_order_id || '').trim();
      if (!cfOrderId) {
        return res.status(400).json({ error: 'Bad Request', message: 'cfOrderId is required' });
      }

      const verifyRes = await verifyPgOrderPayment({ cfOrderId });
      if (!verifyRes.success) {
        return res.status(502).json({ error: 'Verification Failed', message: verifyRes.error || 'Could not verify Cashfree payment' });
      }

      if (!verifyRes.paid) {
        return res.status(200).json({
          success: true,
          paid: false,
          cfOrderId,
          paymentStatus: verifyRes.paymentStatus || 'PENDING'
        });
      }

      let recorded = null;
      try {
        recorded = await recordVerifiedCashfreePayment({
          cfOrderId,
          cfPaymentId: verifyRes.cfPaymentId,
          paymentAmount: verifyRes.paymentAmount,
          cleanOrderId: String(body?.orderId || '').replace(/^#+/, '')
        });
      } catch (dbErr) {
        console.warn('[Cashfree Verify] Supabase update error:', dbErr.message);
      }

      if (recorded?.amountMismatch) {
        return res.status(400).json({
          error: 'Amount Mismatch',
          message: `Payment amount (${recorded.paymentAmount}) does not match order total (${recorded.orderTotal})`
        });
      }

      const updatedOrder = recorded?.order || null;
      return res.status(200).json({
        success: true,
        paid: true,
        cfOrderId,
        cfPaymentId: verifyRes.cfPaymentId,
        paymentAmount: verifyRes.paymentAmount,
        paymentMethod: verifyRes.paymentMethod,
        orderId: updatedOrder?.id || body?.orderId || null,
        trackingToken: updatedOrder?.tracking_token || body?.trackingToken || null,
        order: updatedOrder
      });
    }

    const { orderId, customerPhone, customerName, customerEmail, returnUrl, checkoutToken, turnstileToken, order: orderDraft } = body || {};

    if (turnstileToken) {
      const clientIp = getClientIp(req);
      const turnstileRes = await verifyTurnstileToken(turnstileToken, clientIp);
      if (!turnstileRes.success) {
        return res.status(403).json({ error: 'Forbidden', message: 'Security check failed. Bot activity suspected.', botBlocked: true });
      }
    }

    if (!checkoutToken) {
      return res.status(400).json({ error: 'Bad Request', message: 'checkoutToken is strictly required for PG order creation' });
    }

    // Anti-price tampering: cryptographically verify signed payload and 15m TTL
    const decodedPayload = verifySignedPayload(checkoutToken);
    if (!decodedPayload || typeof decodedPayload.numericTotal !== 'number' || decodedPayload.numericTotal <= 0) {
      return res.status(400).json({ error: 'Invalid Token', message: 'Checkout token verification failed' });
    }

    const tokenTime = decodedPayload.verifiedAt || decodedPayload.timestamp || 0;
    if (tokenTime && Math.abs(Date.now() - tokenTime) > 15 * 60 * 1000) {
      return res.status(400).json({ error: 'Expired Token', message: 'Checkout token has expired (15m limit)' });
    }

    if (!orderId) {
      return res.status(400).json({ error: 'Bad Request', message: 'orderId is required' });
    }

    const finalAmount = Number(decodedPayload.numericTotal);
    const rawClean = String(orderId).trim().replace(/^#+/, '').replace(/[^a-zA-Z0-9_-]/g, '');
    let cleanId = rawClean ? `#${rawClean}` : `#QB-${Math.floor(1000 + Math.random() * 9000)}`;
    const { supabaseUrl, serviceKey } = getSupabaseServiceCreds();
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
      returnUrl
    });

    if (!result.success) {
      return res.status(500).json({ error: 'Order Creation Failed', message: result.error });
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

    return res.status(200).json({
      ...result,
      orderId: cleanId,
      trackingToken
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal Error', message: err.message });
  }
}
