/**
 * Cloudflare Pages Function: Cloudflare R2 List Objects Proxy
 * GET /api/r2-list?prefix=dishes/
 * Returns catalog files stored in Cloudflare R2 (Account A).
 */
import { verifyAdminToken } from './_auth.js';
import { getR2Config, buildSigV4Headers, generatePresignedGetUrl } from './_r2.js';
import { hydrateEnv, jsonResponse } from './_adapter.js';

export async function onRequest(context) {
  hydrateEnv(context);
  const { request, env } = context;

  const corsHeaders = new Headers();
  corsHeaders.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  corsHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (request.method !== 'GET') {
    corsHeaders.set('Allow', 'GET, OPTIONS');
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  }

  const auth = verifyAdminToken(request, env);
  if (!auth.valid) {
    return jsonResponse({ error: auth.error || 'Unauthorized: Admin session required to list storage objects' }, 401, Object.fromEntries(corsHeaders.entries()));
  }

  const r2Cfg = getR2Config(env);
  if (!r2Cfg.isConfigured) {
    return jsonResponse({ error: 'R2 storage credentials not configured on server', files: [] }, 503, Object.fromEntries(corsHeaders.entries()));
  }

  try {
    const url = new URL(request.url);
    const requestedPrefix = url.searchParams.get('prefix') || 'dishes/';
    let sanitizedPrefix = String(requestedPrefix).trim().replace(/[^a-zA-Z0-9_\-\/]/g, '').replace(/^\/+/, '');
    if (!sanitizedPrefix) {
      sanitizedPrefix = 'dishes/';
    } else if (!sanitizedPrefix.endsWith('/')) {
      sanitizedPrefix += '/';
    }

    const canonicalUri = `/${r2Cfg.BUCKET_NAME}`;
    const canonicalQueryString = `list-type=2&prefix=${encodeURIComponent(sanitizedPrefix)}`;

    const { requestHeaders, fullUrl } = buildSigV4Headers({
      method: 'GET',
      canonicalUri,
      canonicalQueryString,
      env
    });

    const r2Res = await fetch(fullUrl, {
      method: 'GET',
      headers: requestHeaders
    });

    const body = await r2Res.text();
    const keys = [];
    const regex = /<Key>([^<]+)<\/Key>/g;
    let match;
    while ((match = regex.exec(body)) !== null) {
      const k = match[1];
      if (k.startsWith(sanitizedPrefix)) {
        keys.push(k);
      }
    }

    const files = keys.map(k => ({
      name: k.split('/').pop(),
      key: k,
      url: generatePresignedGetUrl(k, env),
      directUrl: generatePresignedGetUrl(k, env)
    }));

    return jsonResponse({ files }, 200, Object.fromEntries(corsHeaders.entries()));
  } catch (err) {
    return jsonResponse({ error: err.message }, 500, Object.fromEntries(corsHeaders.entries()));
  }
}
