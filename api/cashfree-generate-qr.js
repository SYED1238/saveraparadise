/**
 * Serverless API: Cashfree Doorstep Dynamic UPI QR
 * POST /api/cashfree-generate-qr
 * Generates an instant UPI QR Code and intent URI for doorstep COD collection.
 */
import QRCode from 'qrcode';
import { generateDoorstepUpiQr, getSupabaseServiceCreds } from './_cashfree.js';
import { verifyAdminToken } from './_auth.js';

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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-token');
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed', message: 'Only POST requests are supported' });
  }

  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || req.headers['x-admin-token'];
  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Staff or Rider authorization token required' });
  }
  const auth = verifyAdminToken(req, ['admin', 'owner', 'rider']);
  if (!auth || !auth.valid) {
    return res.status(401).json({ error: auth?.error || 'Unauthorized: Staff or Rider session required' });
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

    const { orderId, amount, customerName } = body || {};

    if (!orderId || amount === undefined || amount === null || Number(amount) <= 0) {
      return res.status(400).json({ error: 'Bad Request', message: 'orderId and valid amount are required' });
    }

    const safeId = String(orderId).replace(/[^a-zA-Z0-9_-]/g, '');
    const cleanId = safeId.replace(/^#+/, '');
    if (!cleanId) {
      return res.status(400).json({ error: 'Bad Request', message: 'Invalid orderId format' });
    }

    let verifiedAmount = Math.max(1, Math.round(Number(amount) * 100) / 100);
    let targetCustomerName = customerName || 'Doorstep Customer';
    let targetOrderId = cleanId;

    const { supabaseUrl, serviceKey } = getSupabaseServiceCreds();
    if (supabaseUrl && serviceKey) {
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const sb = createClient(supabaseUrl, serviceKey);

        const { data: existingOrder } = await sb
          .from('orders')
          .select('id, total, numeric_total, customer_name, payment_status, cf_order_id, doorstep_upi')
          .or(`id.eq.${cleanId},id.eq.#${cleanId}`)
          .maybeSingle();

        if (existingOrder) {
          targetOrderId = existingOrder.id;
          if (existingOrder.payment_status === 'Paid') {
            return res.status(400).json({ error: 'Bad Request', message: 'Order is already marked as paid' });
          }
          const orderTotal = Math.round(
            typeof existingOrder.numeric_total === 'number'
              ? existingOrder.numeric_total
              : (parseFloat(String(existingOrder.total || 0).replace(/[^0-9.]/g, '')) || 0)
          );
          if (orderTotal > 0) {
            verifiedAmount = orderTotal;
          }
          if (existingOrder.customer_name) {
            targetCustomerName = existingOrder.customer_name;
          }
        }
      } catch (dbErr) {
        console.warn('[Cashfree QR] Order lookup error:', dbErr?.message);
      }
    }

    const qrResult = await generateDoorstepUpiQr({
      orderId: targetOrderId,
      amount: verifiedAmount,
      customerName: targetCustomerName
    });

    if (!qrResult.success) {
      return res.status(500).json({ error: 'QR Generation Failed', message: qrResult.error });
    }

    // Persist cf_order_id and doorstep_upi on orders table so webhook & polling match
    if (supabaseUrl && serviceKey && qrResult.cfOrderId) {
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const sb = createClient(supabaseUrl, serviceKey);
        await sb
          .from('orders')
          .update({
            cf_order_id: qrResult.cfOrderId,
            payment_gateway: 'cashfree',
            doorstep_upi: true
          })
          .or(`id.eq.${cleanId},id.eq.#${cleanId}`);
      } catch (persistErr) {
        console.warn('[Cashfree QR] Order update error:', persistErr?.message);
      }
    }

    // Generate high-resolution Data URL for the QR code
    const qrTarget = qrResult.paymentUrl || qrResult.cashfreePaymentUrl || qrResult.upiIntentUri;
    let qrDataUrl = '';
    try {
      qrDataUrl = await QRCode.toDataURL(qrTarget, {
        width: 320,
        margin: 2,
        color: {
          dark: '#0F172A',
          light: '#FFFFFF'
        },
        errorCorrectionLevel: 'M'
      });
    } catch {
      qrDataUrl = '';
    }

    return res.status(200).json({
      ...qrResult,
      qrDataUrl
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal Error', message: err.message });
  }
}
