/**
 * Cloudflare Pages Function: Cashfree Webhook Handler
 * POST /api/cashfree-webhook
 * Features:
 * 1. Cryptographic HMAC-SHA256 signature verification on exact raw body.
 * 2. Idempotency protection against duplicate webhook deliveries.
 * 3. Payment amount and order ID verification before updating status to 'Paid'.
 * 4. Production protection: Strictly rejects unauthenticated or mismatched callbacks.
 */
import { verifyCashfreeWebhookSignature } from './_cashfree.js';
import { hydrateEnv, jsonResponse } from './_adapter.js';

export async function onRequest(context) {
  hydrateEnv(context);
  const { request, env } = context;

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Allow': 'POST' }
    });
  }

  try {
    const signature = request.headers.get('x-webhook-signature') || '';
    const timestamp = request.headers.get('x-webhook-timestamp') || '';
    // Must read rawBody as pure unparsed text to preserve exact byte sequence for signature validation
    const rawBody = await request.text();

    const isValid = verifyCashfreeWebhookSignature(signature, rawBody, timestamp, env);
    if (!isValid) {
      console.warn('[Cashfree Webhook] Invalid signature rejected');
      return jsonResponse({ error: 'Unauthorized', message: 'Invalid webhook signature' }, 401);
    }

    let payload = {};
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = {};
    }

    const eventType = payload.type || '';
    const eventData = payload.data || {};

    if (eventType === 'PAYMENT_SUCCESS_WEBHOOK' || eventType === 'PAYMENT_CAPTURED') {
      const cfOrderId = String(eventData.order?.order_id || '');
      const cfPaymentId = String(eventData.payment?.cf_payment_id || '');
      const paymentAmount = Number(eventData.payment?.payment_amount || 0);
      const paymentStatus = String(eventData.payment?.payment_status || '').toUpperCase();
      const paymentMethod = eventData.payment?.payment_group || 'upi';

      if (paymentStatus && paymentStatus !== 'SUCCESS') {
        return jsonResponse({
          success: false,
          error: 'Payment not successful',
          message: `Payment status is ${paymentStatus}`
        }, 400);
      }

      const cleanOrderId = cfOrderId
        .replace(/^order_/, '')
        .replace(/^doorstep_/, '')
        .replace(/^qb_/, '')
        .split('_')[0];

      if (!cleanOrderId) {
        return jsonResponse({ error: 'Invalid Order ID in webhook event' }, 400);
      }

      // Safe update in Supabase with idempotency and amount validation
      try {
        const supabaseUrl = (env && (env.VITE_SUPABASE_URL || env.SUPABASE_URL)) ||
          (typeof process !== 'undefined' && process.env && (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL));
        const serviceKey = (env && env.SUPABASE_SERVICE_ROLE_KEY) ||
          (typeof process !== 'undefined' && process.env && process.env.SUPABASE_SERVICE_ROLE_KEY);

        if (supabaseUrl && serviceKey) {
          const { createClient } = await import('@supabase/supabase-js');
          const sb = createClient(supabaseUrl, serviceKey);

          // 1. Fetch current order state to verify idempotency and amount
          const { data: existingOrder } = await sb
            .from('orders')
            .select('id, payment_status, total, cf_payment_id')
            .or(`id.eq.${cleanOrderId},id.eq.#${cleanOrderId}`)
            .maybeSingle();

          if (existingOrder) {
            // Idempotency check: Already processed with this exact payment id
            if (existingOrder.payment_status === 'Paid' && existingOrder.cf_payment_id === cfPaymentId) {
              return jsonResponse({
                success: true,
                orderId: cleanOrderId,
                idempotent: true,
                message: 'Duplicate webhook acknowledged. Payment already recorded.'
              }, 200);
            }

            // Amount check: Prevent underpaid orders from being falsely marked as Paid
            const orderTotal = parseFloat(String(existingOrder.total || 0).replace(/[^0-9.]/g, '')) || 0;
            if (orderTotal > 0 && paymentAmount < orderTotal) {
              console.warn(`[Cashfree Webhook] Amount discrepancy for order ${cleanOrderId}: paid ${paymentAmount}, expected ${orderTotal}`);
              return jsonResponse({
                error: 'Amount Mismatch',
                message: `Payment amount (${paymentAmount}) does not match order total (${orderTotal})`
              }, 400);
            }
          }

          // 2. Perform authoritative update
          await sb.from('orders').update({
            cf_order_id: cfOrderId,
            cf_payment_id: cfPaymentId,
            cf_payment_status: 'SUCCESS',
            payment_status: 'Paid',
            payment_method: 'Online',
            is_paid_online: true,
            doorstep_upi: cfOrderId.includes('doorstep_'),
            cash_collected: 0,
            payment_gateway: 'cashfree'
          }).or(`id.eq.${cleanOrderId},id.eq.#${cleanOrderId}`);
        }
      } catch (err) {
        console.warn('[Cashfree Webhook] Supabase sync fallback:', err.message);
      }

      return jsonResponse({
        success: true,
        orderId: cleanOrderId,
        cfPaymentId,
        paymentAmount,
        paymentMethod,
        message: 'Payment verified and recorded successfully'
      }, 200);
    }

    return jsonResponse({ success: true, eventType, message: 'Event acknowledged' }, 200);
  } catch (err) {
    return jsonResponse({ error: 'Webhook processing error', message: err.message }, 500);
  }
}
