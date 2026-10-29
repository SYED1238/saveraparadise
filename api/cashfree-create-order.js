/**
 * Serverless API: Cashfree Create PG Order
 * POST /api/cashfree-create-order
 * Generates Cashfree order session token for storefront checkout.
 */
import { createPgOrder } from './_cashfree.js';
import { verifySignedPayload } from './_auth.js';

const ALLOWED_ORIGINS = [
  'https://foodbliz.in',
  'https://www.foodbliz.in',
  'https://saveraparadise.com',
  'https://www.saveraparadise.com',
  'https://sascrispychicken.com',
  'https://www.sascrispychicken.com',
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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

    const { orderId, amount, customerPhone, customerName, customerEmail, returnUrl, checkoutToken } = body || {};

    if (!orderId || !amount || Number(amount) <= 0) {
      return res.status(400).json({ error: 'Bad Request', message: 'orderId and valid amount are required' });
    }

    let finalAmount = Number(amount);
    // Anti-price tampering: if checkoutToken is provided, verify against cryptographic signature
    if (checkoutToken) {
      const decodedPayload = verifySignedPayload(checkoutToken);
      if (decodedPayload && typeof decodedPayload.numericTotal === 'number' && decodedPayload.numericTotal > 0) {
        finalAmount = Number(decodedPayload.numericTotal);
      } else {
        return res.status(400).json({ error: 'Invalid Token', message: 'Checkout token verification failed' });
      }
    }

    const result = await createPgOrder({
      orderId,
      amount: finalAmount,
      customerPhone,
      customerName,
      customerEmail,
      returnUrl
    });

    if (!result.success) {
      return res.status(500).json({ error: 'Order Creation Failed', message: result.error });
    }

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Internal Error', message: err.message });
  }
}
