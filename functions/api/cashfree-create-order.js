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

    if (turnstileToken) {
      const clientIp = getClientIp(request);
      const turnstileRes = await verifyTurnstileToken(turnstileToken, clientIp, null, env);
      if (!turnstileRes.success) {
        return jsonResponse({ error: 'Forbidden', message: 'Security check failed. Bot activity suspected.', botBlocked: true }, 403, Object.fromEntries(corsHeaders.entries()));
      }
    }

    if (!checkoutToken) {
      return jsonResponse({ error: 'Bad Request', message: 'checkoutToken is strictly required for PG order creation' }, 400, Object.fromEntries(corsHeaders.entries()));
    }

    // Anti-price tampering: cryptographically verify signed payload and 15m TTL
    const decodedPayload = verifySignedPayload(checkoutToken, env);
    if (!decodedPayload || typeof decodedPayload.numericTotal !== 'number' || decodedPayload.numericTotal <= 0) {
      return jsonResponse({ error: 'Invalid Token', message: 'Checkout token verification failed' }, 400, Object.fromEntries(corsHeaders.entries()));
    }

    const tokenTime = decodedPayload.verifiedAt || decodedPayload.timestamp || 0;
    if (tokenTime && Math.abs(Date.now() - tokenTime) > 15 * 60 * 1000) {
      return jsonResponse({ error: 'Expired Token', message: 'Checkout token has expired (15m limit)' }, 400, Object.fromEntries(corsHeaders.entries()));
    }

    if (!orderId) {
      return jsonResponse({ error: 'Bad Request', message: 'orderId is required' }, 400, Object.fromEntries(corsHeaders.entries()));
    }

    const finalAmount = Number(decodedPayload.numericTotal);

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
