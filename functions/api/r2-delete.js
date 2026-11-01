/**
 * Cloudflare Pages Function: Cloudflare R2 Object Deletion Proxy
 * POST /api/r2-delete
 * Dispatches authenticated AWS SigV4 DELETE requests to Cloudflare R2 (Account A).
 */
import { verifyAdminToken } from './_auth.js';
import { getR2Config, buildSigV4Headers, awsUriEncode } from './_r2.js';
import { hydrateEnv, jsonResponse } from './_adapter.js';

export async function onRequest(context) {
  hydrateEnv(context);
  const { request, env } = context;

  const corsHeaders = new Headers();
  corsHeaders.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  corsHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    corsHeaders.set('Allow', 'POST, OPTIONS');
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  }

  const auth = verifyAdminToken(request, env);
  if (!auth.valid) {
    return jsonResponse({ error: auth.error || 'Unauthorized: Admin session required' }, 401, Object.fromEntries(corsHeaders.entries()));
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const rawKey = body?.key;
  if (!rawKey || typeof rawKey !== 'string') {
    return jsonResponse({ error: 'Image key is required' }, 400, Object.fromEntries(corsHeaders.entries()));
  }

  const cleanKey = rawKey.trim().replace(/^\/+/, '');
  if ((!cleanKey.startsWith('dishes/') && !cleanKey.startsWith('categories/')) || cleanKey.includes('..')) {
    return jsonResponse({ error: 'Invalid key: deletion restricted strictly to dishes/ and categories/' }, 400, Object.fromEntries(corsHeaders.entries()));
  }

  const r2Cfg = getR2Config(env);
  if (!r2Cfg.isConfigured) {
    return jsonResponse({ error: 'R2 storage credentials not configured on server' }, 503, Object.fromEntries(corsHeaders.entries()));
  }

  try {
    const encodedKey = awsUriEncode(cleanKey);
    const canonicalUri = `/${r2Cfg.BUCKET_NAME}/${encodedKey}`;

    const { requestHeaders, fullUrl } = buildSigV4Headers({
      method: 'DELETE',
      canonicalUri,
      env
    });

    const r2Res = await fetch(fullUrl, {
      method: 'DELETE',
      headers: requestHeaders
    });

    if (r2Res.status >= 200 && r2Res.status < 300) {
      return jsonResponse({ success: true, deletedKey: cleanKey }, 200, Object.fromEntries(corsHeaders.entries()));
    }

    return jsonResponse({ error: 'Delete failed' }, r2Res.status || 500, Object.fromEntries(corsHeaders.entries()));
  } catch (err) {
    return jsonResponse({ error: err.message }, 500, Object.fromEntries(corsHeaders.entries()));
  }
}
