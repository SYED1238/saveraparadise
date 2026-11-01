/**
 * Cloudflare Pages Function: Cashfree Create PG Order
 * POST /api/cashfree-create-order
 */
import { createPgOrder } from './_cashfree.js';
import { verifySignedPayload } from './_auth.js';
import { verifyTurnstileToken, getClientIp } from './_turnstile.js';
import { hydrateEnv, isOriginAllowed, jsonResponse } from './_adapter.js';

export async function onRequest(context) {
  hydrateEnv(context);
  const { request, env } = context;
  const origin = request.headers.get('origin');

  const corsHeaders = new Headers();
  if (origin && isOriginAllowed(origin)) {
    corsHeaders.set('Access-Control-Allow-Origin', origin);
    corsHeaders.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    corsHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, cf-turnstile-response');
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    corsHeaders.set('Allow', 'POST, OPTIONS');
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers: corsHeaders });
  }

  try {
    let body = {};
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON', message: 'Request body must be valid JSON' }, 400, Object.fromEntries(corsHeaders.entries()));
    }

    const { orderId, amount, customerPhone, customerName, customerEmail, returnUrl, checkoutToken, turnstileToken } = body || {};

    if (!checkoutToken) {
      const clientToken = turnstileToken || request.headers.get('cf-turnstile-response') || body?.['cf-turnstile-response'];
      const clientIp = getClientIp(request);
      const botCheck = await verifyTurnstileToken(clientToken, clientIp, null, env);
      if (!botCheck.success) {
        return jsonResponse({ error: 'Forbidden', message: botCheck.error || 'Bot verification failed.' }, 403, Object.fromEntries(corsHeaders.entries()));
      }
    }

    if (!orderId || !amount || Number(amount) <= 0) {
      return jsonResponse({ error: 'Bad Request', message: 'orderId and valid amount are required' }, 400, Object.fromEntries(corsHeaders.entries()));
    }

    let finalAmount = Number(amount);
    if (checkoutToken) {
      const decodedPayload = verifySignedPayload(checkoutToken, env);
      if (decodedPayload && typeof decodedPayload.numericTotal === 'number' && decodedPayload.numericTotal > 0) {
        finalAmount = Number(decodedPayload.numericTotal);
      } else {
        return jsonResponse({ error: 'Invalid Token', message: 'Checkout token verification failed' }, 400, Object.fromEntries(corsHeaders.entries()));
      }
    }

    const result = await createPgOrder({
      orderId,
      amount: finalAmount,
      customerPhone,
      customerName,
      customerEmail,
      returnUrl,
      env
    });

    if (!result.success) {
      return jsonResponse({ error: 'Order Creation Failed', message: result.error }, 500, Object.fromEntries(corsHeaders.entries()));
    }

    return jsonResponse(result, 200, Object.fromEntries(corsHeaders.entries()));
  } catch (err) {
    return jsonResponse({ error: 'Internal Error', message: err.message }, 500, Object.fromEntries(corsHeaders.entries()));
  }
}
