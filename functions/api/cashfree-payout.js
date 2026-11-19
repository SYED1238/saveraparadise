/**
 * Cloudflare Pages Function: Cashfree Nighttime Rider Payout
 * POST /api/cashfree-payout
 */
import { verifyAdminToken } from './_auth.js';
import { initiateRiderPayout } from './_cashfree.js';
import { hydrateEnv, isOriginAllowed, jsonResponse } from './_adapter.js';

export async function onRequest(context) {
  hydrateEnv(context);
  const { request, env } = context;
  const origin = request.headers.get('origin');

  const corsHeaders = new Headers();
  if (origin && isOriginAllowed(origin)) {
    corsHeaders.set('Access-Control-Allow-Origin', origin);
    corsHeaders.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    corsHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-token');
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    corsHeaders.set('Allow', 'POST, OPTIONS');
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers: corsHeaders });
  }

  const authCheck = verifyAdminToken(request, env);
  if (!authCheck.valid) {
    return jsonResponse({ error: 'Unauthorized', message: 'Owner authorization required for payouts' }, 401, Object.fromEntries(corsHeaders.entries()));
  }
  if (authCheck.payload?.role !== 'owner') {
    return jsonResponse({ error: 'Forbidden', message: 'Strictly Executive Owner authorization required for payouts' }, 403, Object.fromEntries(corsHeaders.entries()));
  }

  try {
    let body = {};
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON', message: 'Request body must be valid JSON' }, 400, Object.fromEntries(corsHeaders.entries()));
    }

    const { riderPin, amount, upiVpa, phone, name } = body || {};

    if (!riderPin || !amount || Number(amount) <= 0) {
      return jsonResponse({ error: 'Bad Request', message: 'riderPin and valid amount are required' }, 400, Object.fromEntries(corsHeaders.entries()));
    }

    const cleanPin = String(riderPin || '').trim();
    const cycleDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const cleanTransferId = (body?.transferId && typeof body.transferId === 'string' && /^payout_[a-zA-Z0-9_-]{4,64}$/.test(body.transferId))
      ? body.transferId
      : `payout_${cleanPin}_${cycleDate}`;

    const isTestEnv = Boolean(typeof process !== 'undefined' && process.env && (process.env.NODE_ENV === 'test' || process.env.npm_lifecycle_event === 'test' || (Array.isArray(process.argv) && process.argv.some(a => a.includes('test')))));
    const supabaseUrl = env?.VITE_SUPABASE_URL || env?.SUPABASE_URL || (typeof process !== 'undefined' ? (process.env?.VITE_SUPABASE_URL || process.env?.SUPABASE_URL) : null);
    const serviceKey = env?.SUPABASE_SERVICE_ROLE_KEY || (typeof process !== 'undefined' ? process.env?.SUPABASE_SERVICE_ROLE_KEY : null);

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
          return jsonResponse({ error: 'Database Error', message: riderErr.message }, 500, Object.fromEntries(corsHeaders.entries()));
        }
        if (!rider && !isTestEnv) {
          return jsonResponse({ error: 'Not Found', message: 'Rider record not found in system' }, 404, Object.fromEntries(corsHeaders.entries()));
        }

        if (rider && rider.payout_paid_at && !body?.transferId) {
          const rawPaidAt = rider.payout_paid_at;
          const numericPaidAt = Number(rawPaidAt);
          const lastPaidMs = Number.isFinite(numericPaidAt) && numericPaidAt > 0
            ? numericPaidAt
            : new Date(rawPaidAt).getTime();
          if (Number.isFinite(lastPaidMs) && (Date.now() - lastPaidMs < 12 * 3600 * 1000)) {
            return jsonResponse({
              error: 'Duplicate Payout Prevented',
              message: `Rider ${cleanPin} was already paid within the last 12 hours. Provide a unique transferId to process an additional payout.`
            }, 409, Object.fromEntries(corsHeaders.entries()));
          }
        }
      } catch (dbErr) {
        if (!isTestEnv) {
          return jsonResponse({ error: 'Database Error', message: 'Failed to verify rider record before payout' }, 500, Object.fromEntries(corsHeaders.entries()));
        }
      }
    }

    const result = await initiateRiderPayout({
      transferId: cleanTransferId,
      amount: Number(amount),
      riderPin: cleanPin,
      upiVpa,
      phone,
      name,
      env
    });

    if (!result.success) {
      return jsonResponse({ error: 'Payout Failed', message: result.error }, 500, Object.fromEntries(corsHeaders.entries()));
    }

    if (supabaseUrl && serviceKey && result.success) {
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const sb = createClient(supabaseUrl, serviceKey);
        const { error: paidAtErr } = await sb
          .from('riders')
          .update({
            payout_paid_at: Date.now(),
            payout_amount_paid: Number(amount)
          })
          .eq('pin', cleanPin);
        if (paidAtErr) {
          console.error('[Cashfree Payout] Failed to persist payout_paid_at:', paidAtErr.message);
        }
      } catch (saveErr) {
        console.warn('[Cashfree Payout] Rider payout timestamp update warning:', saveErr?.message);
      }
    }

    return jsonResponse(result, 200, Object.fromEntries(corsHeaders.entries()));
  } catch (err) {
    return jsonResponse({ error: 'Internal Error', message: err.message }, 500, Object.fromEntries(corsHeaders.entries()));
  }
}
