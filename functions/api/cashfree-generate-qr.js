/**
 * Cloudflare Pages Function: Cashfree Doorstep Dynamic UPI QR
 * POST /api/cashfree-generate-qr
 */
import QRCode from 'qrcode';
import { generateDoorstepUpiQr } from './_cashfree.js';
import { verifyAdminToken } from './_auth.js';
import { hydrateEnv, isOriginAllowed, jsonResponse } from './_adapter.js';

export async function onRequest(context) {
  hydrateEnv(context);
  const { request, env } = context;
  const origin = request.headers.get('origin');

  const corsHeaders = new Headers();
  if (origin && isOriginAllowed(origin)) {
    corsHeaders.set('Access-Control-Allow-Origin', origin);
    corsHeaders.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    corsHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    corsHeaders.set('Allow', 'POST, OPTIONS');
    return new Response(JSON.stringify({ error: 'Method Not Allowed', message: 'Only POST requests are supported' }), { status: 405, headers: corsHeaders });
  }

  const authHeader = request.headers.get('Authorization') || request.headers.get('authorization') || request.headers.get('x-admin-token');
  if (authHeader) {
    const auth = verifyAdminToken(request, env, ['admin', 'owner', 'rider']);
    if (!auth || !auth.valid) {
      return jsonResponse({ error: auth?.error || 'Unauthorized: Staff or Rider session required' }, 401, Object.fromEntries(corsHeaders.entries()));
    }
  }

  try {
    let body = {};
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON', message: 'Request body must be valid JSON' }, 400, Object.fromEntries(corsHeaders.entries()));
    }

    const { orderId, amount, customerName } = body || {};

    if (!orderId || !amount || Number(amount) <= 0) {
      return jsonResponse({ error: 'Bad Request', message: 'orderId and valid amount are required' }, 400, Object.fromEntries(corsHeaders.entries()));
    }

    const qrResult = await generateDoorstepUpiQr({
      orderId,
      amount,
      customerName,
      env
    });

    if (!qrResult.success) {
      return jsonResponse({ error: 'QR Generation Failed', message: qrResult.error }, 500, Object.fromEntries(corsHeaders.entries()));
    }

    let qrDataUrl = '';
    try {
      qrDataUrl = await QRCode.toDataURL(qrResult.upiIntentUri, {
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

    return jsonResponse({
      ...qrResult,
      qrDataUrl
    }, 200, Object.fromEntries(corsHeaders.entries()));
  } catch (err) {
    return jsonResponse({ error: 'Internal Error', message: err.message }, 500, Object.fromEntries(corsHeaders.entries()));
  }
}
