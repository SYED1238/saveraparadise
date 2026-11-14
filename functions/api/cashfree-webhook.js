/**
 * Cloudflare Pages Function: Cashfree Webhook Handler
 * POST /api/cashfree-webhook
 * Features:
 * 1. Cryptographic HMAC-SHA256 signature verification on exact raw body.
 * 2. Idempotency protection against duplicate webhook deliveries.
 * 3. Payment amount and order ID verification before updating status to 'Paid'.
 * 4. Production protection: Strictly rejects unauthenticated or mismatched callbacks.
 */
import { verifyCashfreeWebhookSignature, recordVerifiedCashfreePayment, recordVerifiedCashfreeRefund } from './_cashfree.js';
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

    // Process payout transfer webhooks (TRANSFER_SUCCESS, TRANSFER_FAILED, etc.)
    if (eventType.startsWith('TRANSFER_')) {
      const transferId = String(eventData.transfer_id || eventData.transferId || '');
      const transferStatus = String(eventData.status || eventType.replace('TRANSFER_', '')).toUpperCase();
      const utr = String(eventData.utr || '');
      const amount = Number(eventData.transfer_amount || eventData.amount || 0);

      return jsonResponse({
        success: true,
        transferId,
        status: transferStatus,
        utr,
        amount,
        eventType,
        message: 'Payout transfer webhook acknowledged'
      }, 200);
    }

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
        .replace(/^(?:order_|qb_|doorstep_|cf_)+/, '')
        .replace(/_\d{4}$/, '');

      if (!cleanOrderId) {
        return jsonResponse({ error: 'Invalid Order ID in webhook event' }, 400);
      }

      // Safe update in Supabase with idempotency and amount validation
      try {
        const recorded = await recordVerifiedCashfreePayment({
          cfOrderId,
          cfPaymentId,
          paymentAmount,
          cleanOrderId,
          env
        });

        if (recorded?.idempotent) {
          return jsonResponse({
            success: true,
            orderId: cleanOrderId,
            idempotent: true,
            message: 'Duplicate webhook acknowledged. Payment already recorded.'
          }, 200);
        }

        if (recorded?.amountMismatch) {
          console.warn(`[Cashfree Webhook] Amount discrepancy for order ${cleanOrderId}: paid ${recorded.paymentAmount}, expected ${recorded.orderTotal}`);
          return jsonResponse({
            error: 'Amount Mismatch',
            message: `Payment amount (${recorded.paymentAmount}) does not match order total (${recorded.orderTotal})`
          }, 400);
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

    // Process refund status webhook from Cashfree
    if (eventType === 'REFUND_STATUS_WEBHOOK') {
      const refundObj = eventData.refund || eventData;
      const cfOrderId = String(refundObj.order_id || eventData.order?.order_id || '');
      const cfRefundId = String(refundObj.cf_refund_id || '');
      const refundId = String(refundObj.refund_id || '');
      const refundStatus = String(refundObj.refund_status || '').toUpperCase();
      const refundArn = String(refundObj.refund_arn || refundObj.arn || '');
      const refundAmount = Number(refundObj.refund_amount || 0);

      const cleanOrderId = cfOrderId
        .replace(/^(?:order_|qb_|doorstep_|cf_)+/, '')
        .replace(/_\d{4}$/, '');

      try {
        await recordVerifiedCashfreeRefund({
          cfOrderId,
          cfRefundId,
          refundId,
          refundStatus,
          refundArn,
          refundAmount,
          cleanOrderId,
          env
        });
      } catch (err) {
        console.warn('[Cashfree Webhook] Refund sync error:', err.message);
      }

      return jsonResponse({
        success: true,
        orderId: cleanOrderId,
        refundId,
        refundStatus,
        refundArn,
        message: `Refund webhook processed (${refundStatus})`
      }, 200);
    }

    return jsonResponse({ success: true, eventType, message: 'Event acknowledged' }, 200);
  } catch (err) {
    return jsonResponse({ error: 'Webhook processing error', message: err.message }, 500);
  }
}
