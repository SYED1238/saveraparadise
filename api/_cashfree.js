/**
 * Cashfree Payments Integration Engine
 * Handles Payment Gateway (PG), Doorstep Dynamic UPI QR, and Rider Nighttime Payouts.
 * Supports both Sandbox (Test) and Production environments.
 */
import crypto from 'node:crypto';
import { invalidateOrderActionMemoryCache } from './order-action.js';

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

const DEFAULT_SITE_URL = 'https://saveraparadise.foodbliz.in';

export function sanitizeCashfreeReturnUrl(rawUrl, cleanOrderId, isProd = false) {
  const fallback = `${DEFAULT_SITE_URL}/?payment_return=1&order_id=${encodeURIComponent(cleanOrderId)}&cf_order_id={order_id}`;
  if (!rawUrl || typeof rawUrl !== 'string') return fallback;
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    const isAllowedHost = (
      host === 'foodbliz.in' ||
      host.endsWith('.foodbliz.in') ||
      host === 'saveraparadise.com' ||
      host.endsWith('.saveraparadise.com') ||
      host.endsWith('.pages.dev') ||
      host === 'localhost' ||
      host === '127.0.0.1'
    );
    if (!isAllowedHost) return fallback;
    // Cashfree Production API strictly requires HTTPS return_url (rejects http:// URLs)
    if (isProd && u.protocol !== 'https:') {
      return fallback;
    }
    if (u.protocol !== 'https:' && host !== 'localhost' && host !== '127.0.0.1') {
      return fallback;
    }
    return rawUrl;
  } catch {
    return fallback;
  }
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
    if (cfg.isProd) {
      return {
        success: false,
        error: 'Cashfree Payment Gateway credentials are not configured in production environment'
      };
    }
    const mockSessionId = `session_mock_${cleanOrderId}_${Date.now()}`;
    return {
      success: true,
      isMock: true,
      cfOrderId: `cf_${cleanOrderId}`,
      paymentSessionId: mockSessionId,
      orderAmount: cleanAmount,
      orderCurrency: 'INR',
      environment: cfg.env,
      cashfreeMode: 'sandbox'
    };
  }

  try {
    const safeReturnUrl = sanitizeCashfreeReturnUrl(returnUrl, cleanOrderId, cfg.isProd);
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
        return_url: safeReturnUrl,
        notify_url: `${DEFAULT_SITE_URL}/api/cashfree-webhook`
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
      environment: cfg.env,
      cashfreeMode: cfg.isProd ? 'production' : 'sandbox'
    };
  } catch (err) {
    return {
      success: false,
      error: err.message || 'Network error reaching Cashfree PG'
    };
  }
}

export async function verifyPgOrderPayment({ cfOrderId }) {
  const cfg = getCashfreeConfig();
  const cleanCfOrderId = String(cfOrderId || '').trim();
  if (!cleanCfOrderId) {
    return { success: false, paid: false, error: 'cfOrderId is required' };
  }

  if (!cfg.isConfigured) {
    if (cfg.isProd) {
      return {
        success: false,
        paid: false,
        error: 'Cashfree Payment Gateway credentials are not configured in production environment'
      };
    }
    return {
      success: true,
      isMock: true,
      paid: true,
      cfOrderId: cleanCfOrderId,
      cfPaymentId: `mock_pay_${Date.now()}`,
      paymentStatus: 'SUCCESS',
      paymentAmount: null,
      paymentMethod: 'upi'
    };
  }

  try {
    const resp = await fetch(`${cfg.pgBaseUrl}/orders/${encodeURIComponent(cleanCfOrderId)}/payments`, {
      method: 'GET',
      headers: {
        'x-client-id': cfg.appId,
        'x-client-secret': cfg.secretKey,
        'x-api-version': '2023-08-01'
      }
    });

    const payments = await resp.json().catch(() => null);
    if (!resp.ok) {
      return {
        success: false,
        paid: false,
        error: payments?.message || 'Cashfree payment verification failed'
      };
    }

    const list = Array.isArray(payments) ? payments : (Array.isArray(payments?.data) ? payments.data : []);
    const successTx = list.find(p => String(p?.payment_status || '').toUpperCase() === 'SUCCESS');
    if (successTx) {
      return {
        success: true,
        paid: true,
        cfOrderId: cleanCfOrderId,
        cfPaymentId: String(successTx.cf_payment_id || ''),
        paymentStatus: 'SUCCESS',
        paymentAmount: Number(successTx.payment_amount || 0),
        paymentMethod: successTx.payment_group || 'upi'
      };
    }

    const latestTx = list[0] || null;
    return {
      success: true,
      paid: false,
      cfOrderId: cleanCfOrderId,
      cfPaymentId: latestTx ? String(latestTx.cf_payment_id || '') : '',
      paymentStatus: String(latestTx?.payment_status || 'PENDING').toUpperCase(),
      paymentAmount: latestTx ? Number(latestTx.payment_amount || 0) : 0,
      paymentMethod: latestTx?.payment_group || ''
    };
  } catch (err) {
    return {
      success: false,
      paid: false,
      error: err.message || 'Network error verifying payment with Cashfree'
    };
  }
}

export function getSupabaseServiceCreds() {
  const isTestEnv = Boolean(
    process.env.NODE_ENV === 'test' ||
    process.env.npm_lifecycle_event === 'test' ||
    (Array.isArray(process.argv) && process.argv.some(a => a.includes('test')))
  );
  if (isTestEnv) return { supabaseUrl: '', serviceKey: '' };
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return { supabaseUrl, serviceKey };
}

export async function recordVerifiedCashfreePayment({
  cfOrderId,
  cfPaymentId,
  paymentAmount,
  cleanOrderId = ''
}) {
  const { supabaseUrl, serviceKey } = getSupabaseServiceCreds();
  if (!supabaseUrl || !serviceKey) {
    return { updated: false, order: null };
  }

  const safeCfOrderId = String(cfOrderId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const safeOrderId = String(cleanOrderId || '').replace(/^#+/, '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeCfOrderId && !safeOrderId) {
    return { updated: false, order: null };
  }

  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(supabaseUrl, serviceKey);

  let existingOrder = null;
  if (safeCfOrderId) {
    const { data } = await sb
      .from('orders')
      .select('*')
      .eq('cf_order_id', safeCfOrderId)
      .maybeSingle();
    existingOrder = data || null;
  }

  if (!existingOrder && safeOrderId) {
    const { data } = await sb
      .from('orders')
      .select('*')
      .or(`id.eq.${safeOrderId},id.eq.#${safeOrderId}`)
      .maybeSingle();
    existingOrder = data || null;
  }

  if (!existingOrder) {
    return { updated: false, order: null };
  }

  if (existingOrder.payment_status === 'Paid' && cfPaymentId && existingOrder.cf_payment_id === String(cfPaymentId)) {
    return { updated: false, idempotent: true, order: existingOrder };
  }

  const orderTotal = parseFloat(String(existingOrder.total || 0).replace(/[^0-9.]/g, '')) || 0;
  if (orderTotal > 0 && typeof paymentAmount === 'number' && paymentAmount > 0 && paymentAmount < orderTotal) {
    return {
      updated: false,
      amountMismatch: true,
      orderTotal,
      paymentAmount,
      order: existingOrder
    };
  }

  const isDoorstepOrder = String(cfOrderId || '').includes('doorstep_') || Boolean(existingOrder.doorstep_upi);
  const updateFields = {
    cf_order_id: safeCfOrderId || existingOrder.cf_order_id || null,
    cf_payment_id: cfPaymentId ? String(cfPaymentId) : (existingOrder.cf_payment_id || null),
    cf_payment_status: 'SUCCESS',
    payment_status: 'Paid',
    payment_method: isDoorstepOrder ? 'doorstep_upi' : 'Online',
    is_paid_online: true,
    doorstep_upi: isDoorstepOrder,
    cash_collected: 0,
    payment_gateway: 'cashfree'
  };

  if (!existingOrder.status || existingOrder.status === 'pending_payment') {
    updateFields.status = 'accepted';
    updateFields.status_label = 'Accepted';
  }

  const { data: savedOrder, error } = await sb
    .from('orders')
    .update(updateFields)
    .eq('id', existingOrder.id)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  try {
    invalidateOrderActionMemoryCache();
  } catch {}

  return { updated: true, order: savedOrder || { ...existingOrder, ...updateFields } };
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
    if (cfg.isProd) {
      return {
        success: false,
        error: 'Cashfree Doorstep UPI is not configured in production environment'
      };
    }
    const mockSessionId = `session_mock_doorstep_${cleanId}_${Date.now()}`;
    return {
      success: true,
      isMock: true,
      orderId: cleanId,
      amount: cleanAmount,
      merchantVpa,
      upiIntentUri,
      qrPayload: upiIntentUri,
      qrDataUrl: '',
      cfOrderId: `doorstep_${cleanId}`,
      paymentSessionId: mockSessionId,
      cashfreeMode: 'sandbox',
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

    if (!pgRes.success) {
      if (cfg.isProd) {
        return {
          success: false,
          error: pgRes.error || 'Cashfree Doorstep QR creation failed'
        };
      }
      return {
        success: true,
        isFallback: true,
        orderId: cleanId,
        amount: cleanAmount,
        merchantVpa,
        upiIntentUri,
        qrPayload: upiIntentUri,
        qrDataUrl: '',
        expiresAt: Date.now() + (expiryMinutes * 60 * 1000)
      };
    }

    let qrPayload = upiIntentUri;
    let qrDataUrl = '';

    // Attempt to fetch authentic Cashfree dynamic UPI QR session
    try {
      const sessionResp = await fetch(`${cfg.pgBaseUrl}/orders/sessions`, {
        method: 'POST',
        headers: {
          'x-client-id': cfg.appId,
          'x-client-secret': cfg.secretKey,
          'x-api-version': '2023-08-01',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          payment_session_id: pgRes.paymentSessionId,
          payment_method: {
            upi: {
              channel: 'qrcode'
            }
          }
        })
      });

      if (sessionResp.ok) {
        const sessionData = await sessionResp.json().catch(() => null);
        const cfQr = sessionData?.data?.payload?.qrcode || sessionData?.payload?.qrcode || '';
        if (typeof cfQr === 'string' && cfQr.trim()) {
          if (cfQr.startsWith('data:image/')) {
            qrDataUrl = cfQr.trim();
          } else {
            qrPayload = cfQr.trim();
          }
        }
      }
    } catch (sessionErr) {
      console.warn('[Cashfree Doorstep] Session QR fetch failed, falling back to NPCI UPI URI:', sessionErr?.message);
    }

    const cashfreePaymentUrl = cfg.isProd
      ? `https://payments.cashfree.com/order/#${pgRes.paymentSessionId}`
      : `https://sandbox.cashfree.com/order/#${pgRes.paymentSessionId}`;

    return {
      success: true,
      orderId: cleanId,
      amount: cleanAmount,
      merchantVpa: 'Cashfree Official QR (Savera Paradise)',
      upiIntentUri: qrPayload,
      qrPayload,
      qrDataUrl,
      paymentUrl: cashfreePaymentUrl,
      cfOrderId: pgRes.cfOrderId,
      paymentSessionId: pgRes.paymentSessionId,
      cashfreeMode: cfg.isProd ? 'production' : 'sandbox',
      expiresAt: Date.now() + (expiryMinutes * 60 * 1000)
    };
  } catch {
    if (cfg.isProd) {
      return {
        success: false,
        error: 'Cashfree Doorstep QR generation failed in production environment'
      };
    }
    return {
      success: true,
      isFallback: true,
      orderId: cleanId,
      amount: cleanAmount,
      merchantVpa,
      upiIntentUri,
      qrPayload: upiIntentUri,
      qrDataUrl: '',
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

  // Replay Protection: Reject webhooks older than 5 minutes
  const tsNum = Number(timestamp);
  if (Number.isFinite(tsNum) && tsNum > 1000000000) {
    const tsMs = tsNum < 10000000000 ? tsNum * 1000 : tsNum;
    if (Math.abs(Date.now() - tsMs) > 5 * 60 * 1000) {
      return false;
    }
  }

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
        'Content-Type': 'application/json',
        'x-api-version': '2024-01-01'
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

    const status = String(data.status || 'PENDING').toUpperCase();
    if (status === 'FAILED' || status === 'REJECTED') {
      return {
        success: false,
        error: data.message || `Cashfree transfer rejected (${status})`,
        status,
        transferId: cleanTransferId,
        code: data.code
      };
    }

    return {
      success: true,
      transferId: cleanTransferId,
      amount: cleanAmount,
      status,
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
