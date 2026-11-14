/**
 * Serverless API: Cashfree Webhook Handler
 * POST /api/cashfree-webhook
 * Cryptographically verifies and processes Cashfree payment notifications.
 */
import { verifyCashfreeWebhookSignature, recordVerifiedCashfreePayment, recordVerifiedCashfreeRefund } from './_cashfree.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const signature = req.headers['x-webhook-signature'] || '';
    const timestamp = req.headers['x-webhook-timestamp'] || '';
    
    let rawBody = '';
    if (typeof req.rawBody === 'string') {
      rawBody = req.rawBody;
    } else if (typeof req.body === 'string') {
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

    // Process payout transfer webhooks (TRANSFER_SUCCESS, TRANSFER_FAILED, etc.)
    if (eventType.startsWith('TRANSFER_')) {
      const transferId = String(eventData.transfer_id || eventData.transferId || '');
      const transferStatus = String(eventData.status || eventType.replace('TRANSFER_', '')).toUpperCase();
      const utr = String(eventData.utr || '');
      const amount = Number(eventData.transfer_amount || eventData.amount || 0);

      return res.status(200).json({
        success: true,
        transferId,
        status: transferStatus,
        utr,
        amount,
        eventType,
        message: 'Payout transfer webhook acknowledged'
      });
    }

    // Process payment success
    if (eventType === 'PAYMENT_SUCCESS_WEBHOOK' || eventType === 'PAYMENT_CAPTURED') {
      const cfOrderId = String(eventData.order?.order_id || '');
      const cfPaymentId = String(eventData.payment?.cf_payment_id || '');
      const paymentAmount = Number(eventData.payment?.payment_amount || 0);
      const paymentStatus = String(eventData.payment?.payment_status || '').toUpperCase();
      const paymentMethod = eventData.payment?.payment_group || 'upi';

      if (paymentStatus && paymentStatus !== 'SUCCESS') {
        return res.status(400).json({
          success: false,
          error: 'Payment not successful',
          message: `Payment status is ${paymentStatus}`
        });
      }

      const cleanOrderId = cfOrderId
        .replace(/^(?:order_|qb_|doorstep_|cf_)+/, '')
        .replace(/_\d{4}$/, '');

      if (!cleanOrderId) {
        return res.status(400).json({ error: 'Invalid Order ID in webhook event' });
      }

      // Safe update in Supabase if server-side client is available
      try {
        const recorded = await recordVerifiedCashfreePayment({
          cfOrderId,
          cfPaymentId,
          paymentAmount,
          cleanOrderId
        });

        if (recorded?.idempotent) {
          return res.status(200).json({
            success: true,
            orderId: cleanOrderId,
            idempotent: true,
            message: 'Duplicate webhook acknowledged. Payment already recorded.'
          });
        }

        if (recorded?.amountMismatch) {
          console.warn(`[Cashfree Webhook] Amount discrepancy for order ${cleanOrderId}: paid ${recorded.paymentAmount}, expected ${recorded.orderTotal}`);
          return res.status(400).json({
            error: 'Amount Mismatch',
            message: `Payment amount (${recorded.paymentAmount}) does not match order total (${recorded.orderTotal})`
          });
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
          cleanOrderId
        });
      } catch (err) {
        console.warn('[Cashfree Webhook] Refund sync error:', err.message);
      }

      return res.status(200).json({
        success: true,
        orderId: cleanOrderId,
        refundId,
        refundStatus,
        refundArn,
        message: `Refund webhook processed (${refundStatus})`
      });
    }

    // Default acknowledge for other Cashfree events
    return res.status(200).json({ success: true, eventType, message: 'Event acknowledged' });
  } catch (err) {
    console.error('[Cashfree Webhook Error]', err);
    return res.status(500).json({ error: 'Webhook processing error', message: err.message });
  }
}
