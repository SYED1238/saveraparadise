/**
 * Cloudflare Pages Function: Cashfree Webhook Handler
 * POST /api/cashfree-webhook
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
      const cfOrderId = eventData.order?.order_id || '';
      const cfPaymentId = eventData.payment?.cf_payment_id || '';
      const paymentAmount = eventData.payment?.payment_amount || 0;
      const paymentMethod = eventData.payment?.payment_group || 'upi';

      const cleanOrderId = cfOrderId
        .replace(/^order_/, '')
        .replace(/^doorstep_/, '')
        .replace(/^qb_/, '')
        .split('_')[0];

      try {
        const supabaseUrl = (env && (env.VITE_SUPABASE_URL || env.SUPABASE_URL)) ||
          (typeof process !== 'undefined' && process.env && (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL));
        const serviceKey = (env && env.SUPABASE_SERVICE_ROLE_KEY) ||
          (typeof process !== 'undefined' && process.env && process.env.SUPABASE_SERVICE_ROLE_KEY);

        if (supabaseUrl && serviceKey) {
          const { createClient } = await import('@supabase/supabase-js');
          const sb = createClient(supabaseUrl, serviceKey);

          await sb.from('orders').update({
            cf_order_id: cfOrderId,
            cf_payment_id: String(cfPaymentId),
            cf_payment_status: 'SUCCESS',
            payment_status: 'Paid',
            payment_method: 'Online',
            is_paid_online: true,
            doorstep_upi: cfOrderId.startsWith('doorstep_'),
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
        message: 'Payment verified successfully'
      }, 200);
    }

    return jsonResponse({ success: true, eventType, message: 'Event acknowledged' }, 200);
  } catch (err) {
    return jsonResponse({ error: 'Webhook processing error', message: err.message }, 500);
  }
}
