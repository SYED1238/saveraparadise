/**
 * Cloudflare Pages Function: Cashfree Doorstep Dynamic UPI QR
 * POST /api/cashfree-generate-qr
 */
import QRCode from 'qrcode';
import { generateDoorstepUpiQr, getSupabaseServiceCreds } from './_cashfree.js';
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
    corsHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-token');
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    corsHeaders.set('Allow', 'POST, OPTIONS');
    return new Response(JSON.stringify({ error: 'Method Not Allowed', message: 'Only POST requests are supported' }), { status: 405, headers: corsHeaders });
  }

  const authHeader = request.headers.get('Authorization') || request.headers.get('authorization') || request.headers.get('x-admin-token');
  if (!authHeader) {
    return jsonResponse({ error: 'Unauthorized: Staff or Rider session required' }, 401, Object.fromEntries(corsHeaders.entries()));
  }
  const auth = verifyAdminToken(request, env, ['admin', 'owner', 'rider']);
  if (!auth || !auth.valid) {
    return jsonResponse({ error: auth?.error || 'Unauthorized: Staff or Rider session required' }, 401, Object.fromEntries(corsHeaders.entries()));
  }

  try {
    let body = {};
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON', message: 'Request body must be valid JSON' }, 400, Object.fromEntries(corsHeaders.entries()));
    }

    const { orderId, amount, customerName } = body || {};

    if (!orderId || amount === undefined || amount === null || Number(amount) <= 0) {
      return jsonResponse({ error: 'Bad Request', message: 'orderId and valid amount are required' }, 400, Object.fromEntries(corsHeaders.entries()));
    }

    const safeId = String(orderId).replace(/[^a-zA-Z0-9_-]/g, '');
    const cleanId = safeId.replace(/^#+/, '');
    if (!cleanId) {
      return jsonResponse({ error: 'Bad Request', message: 'Invalid orderId format' }, 400, Object.fromEntries(corsHeaders.entries()));
    }

    let verifiedAmount = Math.max(1, Math.round(Number(amount) * 100) / 100);
    let targetCustomerName = customerName || 'Doorstep Customer';
    let targetOrderId = cleanId;

    const { supabaseUrl, serviceKey } = getSupabaseServiceCreds(env);
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
            return jsonResponse({ error: 'Bad Request', message: 'Order is already marked as paid' }, 400, Object.fromEntries(corsHeaders.entries()));
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
      customerName: targetCustomerName,
      env
    });

    if (!qrResult.success) {
      return jsonResponse({ error: 'QR Generation Failed', message: qrResult.error }, 500, Object.fromEntries(corsHeaders.entries()));
    }

    // Persist cf_order_id on orders table so webhook & polling match (do not set doorstep_upi prematurely)
    if (supabaseUrl && serviceKey && qrResult.cfOrderId) {
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const sb = createClient(supabaseUrl, serviceKey);
        await sb
          .from('orders')
          .update({
            cf_order_id: qrResult.cfOrderId,
            payment_gateway: 'cashfree'
          })
          .or(`id.eq.${cleanId},id.eq.#${cleanId}`);
      } catch (persistErr) {
        console.warn('[Cashfree QR] Order update error:', persistErr?.message);
      }
    }

    // Generate high-resolution Data URL for the QR code (pure SVG for Worker compatibility, DataURL fallback for Node)
    let qrDataUrl = qrResult.qrDataUrl || '';
    if (!qrDataUrl) {
      const qrTarget = qrResult.qrPayload || qrResult.upiIntentUri || '';
      try {
        const svgStr = await QRCode.toString(qrTarget, {
          type: 'svg',
          width: 320,
          margin: 2,
          color: {
            dark: '#0F172A',
            light: '#FFFFFF'
          },
          errorCorrectionLevel: 'M'
        });
        if (svgStr) {
          qrDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svgStr)}`;
        }
      } catch (svgErr) {
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
      }
    }

    return jsonResponse({
      ...qrResult,
      qrDataUrl
    }, 200, Object.fromEntries(corsHeaders.entries()));
  } catch (err) {
    return jsonResponse({ error: 'Internal Error', message: err.message }, 500, Object.fromEntries(corsHeaders.entries()));
  }
}
