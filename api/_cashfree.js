/**
 * Cashfree Payments Integration Engine
 * Handles Payment Gateway (PG), Doorstep Dynamic UPI QR, and Rider Nighttime Payouts.
 * Supports both Sandbox (Test) and Production environments.
 */
import crypto from 'node:crypto';

export function getCashfreeConfig() {
  const appId = process.env.CASHFREE_APP_ID || process.env.VITE_CASHFREE_APP_ID || '';
  const secretKey = process.env.CASHFREE_SECRET_KEY || '';
  const env = (process.env.CASHFREE_ENV || 'TEST').toUpperCase();
  const webhookSecret = process.env.CASHFREE_WEBHOOK_SECRET || secretKey;

  const isProd = env === 'PROD' || env === 'PRODUCTION';
  const pgBaseUrl = isProd ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';
  const payoutBaseUrl = isProd ? 'https://payout-api.cashfree.com/payout' : 'https://payout-gamma.cashfree.com/payout';

  return {
    appId,
    secretKey,
    env,
    isProd,
    webhookSecret,
    pgBaseUrl,
    payoutBaseUrl,
    isConfigured: Boolean(appId && secretKey)
  };
}

/**
 * Creates a Cashfree PG Order Token for Storefront Prepayments
 */
export async function createPgOrder({
  orderId,
  amount,
  customerPhone = '9999999999',
  customerName = 'Guest Customer',
  customerEmail = 'customer@saveraparadise.com',
  returnUrl = ''
}) {
  const cfg = getCashfreeConfig();
  const cleanOrderId = String(orderId).replace(/^#+/, '');
  const cleanAmount = Math.max(1, Math.round(Number(amount) * 100) / 100);

  // If credentials are not yet configured in environment, provide safe mock for test/sandbox
  if (!cfg.isConfigured) {
    const mockSessionId = `session_mock_${cleanOrderId}_${Date.now()}`;
    return {
      success: true,
      isMock: true,
      cfOrderId: `cf_${cleanOrderId}`,
      paymentSessionId: mockSessionId,
      orderAmount: cleanAmount,
      orderCurrency: 'INR',
      environment: cfg.env
    };
  }

  try {
    const payload = {
      order_id: `qb_${cleanOrderId}_${Date.now().toString().slice(-4)}`,
      order_amount: cleanAmount,
      order_currency: 'INR',
      customer_details: {
        customer_id: `cust_${cleanPhone(customerPhone) || 'guest'}`,
        customer_name: customerName.trim() || 'Guest',
        customer_phone: cleanPhone(customerPhone) || '9999999999',
        customer_email: customerEmail.trim() || 'customer@saveraparadise.com'
      },
      order_meta: {
        return_url: returnUrl || `https://saveraparadise.com/order-success?order_id=${cleanOrderId}`,
        notify_url: `https://saveraparadise.com/api/cashfree-webhook`
      },
      order_note: `Savera Paradise Order #${cleanOrderId}`
    };

    const resp = await fetch(`${cfg.pgBaseUrl}/orders`, {
      method: 'POST',
      headers: {
        'x-client-id': cfg.appId,
        'x-client-secret': cfg.secretKey,
        'x-api-version': '2023-08-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await resp.json();
    if (!resp.ok) {
      return {
        success: false,
        error: data.message || 'Cashfree PG order creation failed',
        code: data.code
      };
    }

    return {
      success: true,
      cfOrderId: data.order_id,
      paymentSessionId: data.payment_session_id,
      orderAmount: data.order_amount,
      orderCurrency: data.order_currency,
      environment: cfg.env
    };
  } catch (err) {
    return {
      success: false,
      error: err.message || 'Network error reaching Cashfree PG'
    };
  }
}

/**
 * Generates a Dynamic UPI QR Code for Doorstep COD-to-PhonePe Collection
 */
export async function generateDoorstepUpiQr({
  orderId,
  amount,
  customerName = 'Doorstep Customer',
  expiryMinutes = 15
}) {
  const cfg = getCashfreeConfig();
  const cleanId = String(orderId).replace(/^#+/, '');
  const cleanAmount = Math.max(1, Math.round(Number(amount) * 100) / 100);

  // Standard UPI URI format accepted by all Indian UPI apps (PhonePe, GPay, Paytm, BHIM)
  // Format: upi://pay?pa=<MerchantVPA>&pn=<MerchantName>&am=<Amount>&tr=<OrderId>&tn=<Note>&cu=INR
  const merchantVpa = process.env.RESTAURANT_UPI_VPA || 'saveraparadise@okhdfcbank';
  const merchantName = encodeURIComponent('Savera Paradise');
  const upiIntentUri = `upi://pay?pa=${merchantVpa}&pn=${merchantName}&am=${cleanAmount.toFixed(2)}&tr=QB${cleanId}&tn=${encodeURIComponent(`Order #${cleanId}`)}&cu=INR`;

  if (!cfg.isConfigured) {
    return {
      success: true,
      isMock: true,
      orderId: cleanId,
      amount: cleanAmount,
      merchantVpa,
      upiIntentUri,
      expiresAt: Date.now() + (expiryMinutes * 60 * 1000)
    };
  }

  try {
    // Generate order via Cashfree PG to obtain verified payment session
    const pgRes = await createPgOrder({
      orderId: `doorstep_${cleanId}`,
      amount: cleanAmount,
      customerName,
      customerPhone: '9999999999'
    });

    return {
      success: true,
      orderId: cleanId,
      amount: cleanAmount,
      merchantVpa,
      upiIntentUri,
      cfOrderId: pgRes.cfOrderId,
      paymentSessionId: pgRes.paymentSessionId,
      expiresAt: Date.now() + (expiryMinutes * 60 * 1000)
    };
  } catch {
    return {
      success: true,
      isFallback: true,
      orderId: cleanId,
      amount: cleanAmount,
      merchantVpa,
      upiIntentUri,
      expiresAt: Date.now() + (expiryMinutes * 60 * 1000)
    };
  }
}

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Cryptographically verifies Cashfree Webhook Signature
 */
export function verifyCashfreeWebhookSignature(signature, rawBody, timestamp) {
  const cfg = getCashfreeConfig();
  if (!cfg.webhookSecret || !signature || !timestamp || !rawBody) {
    // In production, strictly reject unauthenticated webhooks
    if (process.env.NODE_ENV === 'production' || cfg.isProd) {
      return false;
    }
    // In dev/test with mock config, permit if unconfigured
    return !cfg.isConfigured;
  }

  try {
    const payload = `${timestamp}${rawBody}`;
    const expected = crypto
      .createHmac('sha256', cfg.webhookSecret)
      .update(payload)
      .digest('base64');
    return safeCompare(signature, expected);
  } catch {
    return false;
  }
}

/**
 * Initiates Instant Rider Nighttime Payout via Cashfree Payouts API
 */
export async function initiateRiderPayout({
  transferId,
  amount,
  riderPin,
  upiVpa,
  phone = '',
  name = 'Delivery Partner'
}) {
  const cfg = getCashfreeConfig();
  const cleanAmount = Math.max(1, Math.round(Number(amount) * 100) / 100);
  const cleanTransferId = String(transferId || `payout_rd_${riderPin}_${Date.now()}`);

  if (!cfg.isConfigured) {
    return {
      success: true,
      isMock: true,
      transferId: cleanTransferId,
      amount: cleanAmount,
      riderPin,
      status: 'SUCCESS',
      utr: `UTR_MOCK_${Date.now()}`,
      paidAt: Date.now(),
      message: `Simulated Cashfree Payout of ₹${cleanAmount} to rider ${name} (UPI: ${upiVpa || phone + '@upi'})`
    };
  }

  try {
    const payload = {
      transfer_id: cleanTransferId,
      transfer_amount: cleanAmount,
      transfer_mode: upiVpa ? 'upi' : 'banktransfer',
      beneficiary_details: {
        beneficiary_name: name,
        beneficiary_contact_details: {
          phone: cleanPhone(phone)
        },
        beneficiary_instrument_details: upiVpa ? { vpa: upiVpa } : undefined
      },
      transfer_remarks: `Savera Paradise Night Delivery Payout #${riderPin}`
    };

    const resp = await fetch(`${cfg.payoutBaseUrl}/transfers`, {
      method: 'POST',
      headers: {
        'x-client-id': cfg.appId,
        'x-client-secret': cfg.secretKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await resp.json();
    if (!resp.ok) {
      return {
        success: false,
        error: data.message || 'Cashfree Payout initiation failed',
        code: data.code
      };
    }

    return {
      success: true,
      transferId: cleanTransferId,
      amount: cleanAmount,
      status: data.status || 'PENDING',
      utr: data.utr || null,
      paidAt: Date.now()
    };
  } catch (err) {
    return {
      success: false,
      error: err.message || 'Cashfree Payout service unreachable'
    };
  }
}

function cleanPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}
