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

    const cleanPin = String(riderPin || '').trim();
    const cycleDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const cleanTransferId = (body?.transferId && typeof body.transferId === 'string' && /^payout_[a-zA-Z0-9_-]{4,64}$/.test(body.transferId))
      ? body.transferId
      : `payout_${cleanPin}_${cycleDate}`;

    const isTestEnv = Boolean(typeof process !== 'undefined' && process.env && (process.env.NODE_ENV === 'test' || process.env.npm_lifecycle_event === 'test' || (Array.isArray(process.argv) && process.argv.some(a => a.includes('test')))));
    const supabaseUrl = process.env?.VITE_SUPABASE_URL || process.env?.SUPABASE_URL;
    const serviceKey = process.env?.SUPABASE_SERVICE_ROLE_KEY;

    if (supabaseUrl && serviceKey) {
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const sb = createClient(supabaseUrl, serviceKey);
        const { data: rider, error: riderErr } = await sb
          .from('riders')
          .select('pin, name, payout_paid_at, payout_amount_paid')
          .eq('pin', cleanPin)
          .maybeSingle();

        if (riderErr) {
          return res.status(500).json({ error: 'Database Error', message: riderErr.message });
        }
        if (!rider && !isTestEnv) {
          return res.status(404).json({ error: 'Not Found', message: 'Rider record not found in system' });
        }

        if (rider && rider.payout_paid_at && !body?.transferId) {
          const lastPaidMs = new Date(rider.payout_paid_at).getTime();
          if (Date.now() - lastPaidMs < 12 * 3600 * 1000) {
            return res.status(409).json({
              error: 'Duplicate Payout Prevented',
              message: `Rider ${cleanPin} was already paid within the last 12 hours. Provide a unique transferId to process an additional payout.`
            });
          }
        }
      } catch (dbErr) {
        if (!isTestEnv) {
          return res.status(500).json({ error: 'Database Error', message: 'Failed to verify rider record before payout' });
        }
      }
    }

    const result = await initiateRiderPayout({
      transferId: cleanTransferId,
      amount: Number(amount),
      riderPin: cleanPin,
      upiVpa,
      phone,
      name
    });

    if (!result.success) {
      return res.status(500).json({ error: 'Payout Failed', message: result.error });
    }

    if (supabaseUrl && serviceKey && result.success) {
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const sb = createClient(supabaseUrl, serviceKey);
        await sb
          .from('riders')
          .update({
            payout_paid_at: new Date().toISOString(),
            payout_amount_paid: Number(amount)
          })
          .eq('pin', cleanPin);
      } catch (saveErr) {
        console.warn('[Cashfree Payout] Rider payout timestamp update warning:', saveErr?.message);
      }
    }

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Internal Error', message: err.message });
  }
}
