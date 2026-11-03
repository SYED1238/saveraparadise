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

    const cleanTransferId = (body?.transferId && typeof body.transferId === 'string' && /^payout_[a-zA-Z0-9_-]{4,64}$/.test(body.transferId))
      ? body.transferId
      : `payout_${riderPin}_${Date.now()}`;

    const result = await initiateRiderPayout({
      transferId: cleanTransferId,
      amount: Number(amount),
      riderPin,
      upiVpa,
      phone,
      name,
      env
    });

    if (!result.success) {
      return jsonResponse({ error: 'Payout Failed', message: result.error }, 500, Object.fromEntries(corsHeaders.entries()));
    }

    return jsonResponse(result, 200, Object.fromEntries(corsHeaders.entries()));
  } catch (err) {
    return jsonResponse({ error: 'Internal Error', message: err.message }, 500, Object.fromEntries(corsHeaders.entries()));
  }
}
