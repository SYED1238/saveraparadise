/**
 * Cloudflare Pages Function: Cloudflare R2 Image Proxy
 * GET /api/r2-image?key=dishes/example.jpg
 * Streams dish and category assets securely from Cloudflare R2 (Account A).
 */
import { getR2Config, buildSigV4Headers, awsUriEncode } from './_r2.js';
import { hydrateEnv, jsonResponse } from './_adapter.js';

export async function onRequest(context) {
  hydrateEnv(context);
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Allow': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Allow': 'GET, HEAD, OPTIONS', 'Content-Type': 'application/json' }
    });
  }

  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!key || typeof key !== 'string') {
    return jsonResponse({ error: 'Missing image key parameter' }, 400);
  }

  const cleanKey = key.replace(/^\/+/, '');
  if (
    (!cleanKey.startsWith('dishes/') && !cleanKey.startsWith('categories/')) ||
    cleanKey.includes('..') ||
    !/^[a-zA-Z0-9_\-./() %]+$/.test(cleanKey)
  ) {
    return jsonResponse({ error: 'Invalid image key' }, 400);
  }

  const r2Cfg = getR2Config(env);
  if (!r2Cfg.isConfigured) {
    return jsonResponse({ error: 'Storage credentials not configured' }, 503);
  }

  const reqMethod = request.method === 'HEAD' ? 'HEAD' : 'GET';
  const canonicalUri = `/${r2Cfg.BUCKET_NAME}/${awsUriEncode(cleanKey)}`;

  const { requestHeaders, fullUrl } = buildSigV4Headers({
    method: reqMethod,
    canonicalUri,
    env
  });

  try {
    const r2Res = await fetch(fullUrl, {
      method: reqMethod,
      headers: requestHeaders
    });

    if (r2Res.status >= 200 && r2Res.status < 300) {
      const responseHeaders = new Headers();
      responseHeaders.set('Content-Type', r2Res.headers.get('content-type') || 'image/jpeg');
      responseHeaders.set('X-Content-Type-Options', 'nosniff');
      responseHeaders.set('Cache-Control', 'public, max-age=31536000, immutable');
      responseHeaders.set('Access-Control-Allow-Origin', '*');

      const contentLength = r2Res.headers.get('content-length');
      if (contentLength) {
        responseHeaders.set('Content-Length', contentLength);
      }
      const eTag = r2Res.headers.get('etag');
      if (eTag) {
        responseHeaders.set('ETag', eTag);
      }

      return new Response(reqMethod === 'HEAD' ? null : r2Res.body, {
        status: 200,
        headers: responseHeaders
      });
    }

    if (r2Res.status === 404) {
      return jsonResponse({ error: 'Image not found' }, 404);
    }

    return jsonResponse({ error: 'Failed to retrieve image from R2' }, r2Res.status || 502);
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}
