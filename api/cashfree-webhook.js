/**
 * Serverless API: Cashfree Webhook Handler
 * POST /api/cashfree-webhook
 * Cryptographically verifies and processes Cashfree payment notifications.
 */
import { verifyCashfreeWebhookSignature } from './_cashfree.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const signature = req.headers['x-webhook-signature'] || '';
    const timestamp = req.headers['x-webhook-timestamp'] || '';
    
    let rawBody = '';
    if (typeof req.body === 'string') {
      rawBody = req.body;
    } else {
      rawBody = JSON.stringify(req.body || {});
    }

    const isValid = verifyCashfreeWebhookSignature(signature, rawBody, timestamp);
    if (!isValid) {
      console.warn('[Cashfree Webhook] Invalid signature rejected');
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid webhook signature' });
    }

    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const eventType = payload.type || '';
    const eventData = payload.data || {};

    // Process payment success
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

      // Safe update in Supabase if server-side client is available
      try {
        const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
            if (existingOrder.payment_status === 'Paid' && existingOrder.cf_payment_id === cfPaymentId) {
              return res.status(200).json({
                success: true,
                orderId: cleanOrderId,
                idempotent: true,
                message: 'Duplicate webhook acknowledged. Payment already recorded.'
              });
            }

            const orderTotal = parseFloat(String(existingOrder.total || 0).replace(/[^0-9.]/g, '')) || 0;
            if (orderTotal > 0 && paymentAmount < orderTotal) {
              console.warn(`[Cashfree Webhook] Amount discrepancy for order ${cleanOrderId}: paid ${paymentAmount}, expected ${orderTotal}`);
              return res.status(400).json({
                error: 'Amount Mismatch',
                message: `Payment amount (${paymentAmount}) does not match order total (${orderTotal})`
              });
            }
          }

          // 2. Perform authoritative update
          await sb.from('orders').update({
            cf_order_id: cfOrderId,
            cf_payment_id: String(cfPaymentId),
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

      return res.status(200).json({
        success: true,
        orderId: cleanOrderId,
        cfPaymentId,
        paymentAmount,
        paymentMethod,
        message: 'Payment verified successfully'
      });
    }

    // Default acknowledge for other Cashfree events
    return res.status(200).json({ success: true, eventType, message: 'Event acknowledged' });
  } catch (err) {
    console.error('[Cashfree Webhook Error]', err);
    return res.status(500).json({ error: 'Webhook processing error', message: err.message });
  }
}
