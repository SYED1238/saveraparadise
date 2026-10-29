/**
 * Serverless API: Cashfree Nighttime Rider Payout
 * POST /api/cashfree-payout
 * Initiates automated end-of-day UPI transfer to delivery rider PhonePe/VPA.
 */
import { verifyAdminToken } from './_auth.js';
import { initiateRiderPayout } from './_cashfree.js';

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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-token');
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Security gate: Strictly require Owner signed JWT (kitchen admins are forbidden)
  const authCheck = verifyAdminToken(req);
  if (!authCheck.valid) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Owner authorization required for payouts' });
  }
  if (authCheck.payload?.role !== 'owner') {
    return res.status(403).json({ error: 'Forbidden', message: 'Strictly Executive Owner authorization required for payouts' });
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

    const { riderPin, amount, upiVpa, phone, name } = body || {};

    if (!riderPin || !amount || Number(amount) <= 0) {
      return res.status(400).json({ error: 'Bad Request', message: 'riderPin and valid amount are required' });
    }

    const result = await initiateRiderPayout({
      transferId: `payout_${riderPin}_${Date.now()}`,
      amount: Number(amount),
      riderPin,
      upiVpa,
      phone,
      name
    });

    if (!result.success) {
      return res.status(500).json({ error: 'Payout Failed', message: result.error });
    }

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Internal Error', message: err.message });
  }
}
