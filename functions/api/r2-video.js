/**
 * Cloudflare Pages Function: Cloudflare R2 Video Stream Proxy
 * GET /api/r2-video?key=videos/intro.mp4
 * Supports HTTP 206 Partial Content range requests for video playback and scrubbing.
 */
import { getR2Config, buildSigV4Headers, awsUriEncode } from './_r2.js';
import { hydrateEnv, jsonResponse } from './_adapter.js';

const DEFAULT_VIDEO_KEY = 'Untitled design (17).mp4';

const ALLOWED_EXPLICIT_KEYS = new Set([
  'Untitled design (16).mp4',
  'videos/Untitled design (16).mp4',
  'Untitled design (17).mp4',
  'videos/Untitled design (17).mp4'
]);

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
  let key = url.searchParams.get('key')?.trim() || DEFAULT_VIDEO_KEY;
  if (!key) key = DEFAULT_VIDEO_KEY;

  const cleanKey = key.replace(/^\/+/, '');
  if (cleanKey.includes('..') || cleanKey.includes('\\')) {
    return jsonResponse({ error: 'Invalid video key: path traversal detected' }, 400);
  }

  if (!cleanKey.endsWith('.mp4') && !cleanKey.endsWith('.webm')) {
    return jsonResponse({ error: 'Invalid video key: only .mp4 and .webm files are supported' }, 400);
  }

  if (!/^[a-zA-Z0-9_\-. /()]+$/.test(cleanKey)) {
    return jsonResponse({ error: 'Invalid video key: illegal characters in path' }, 400);
  }

  const isDefaultVideo = cleanKey === DEFAULT_VIDEO_KEY || ALLOWED_EXPLICIT_KEYS.has(cleanKey);
  const isInVideosFolder = cleanKey.startsWith('videos/');
  if (!isDefaultVideo && !isInVideosFolder) {
    return jsonResponse({ error: 'Invalid video key: videos must reside in videos/ folder or be the default video' }, 400);
  }

  const r2Cfg = getR2Config(env);
  if (!r2Cfg.isConfigured) {
    return jsonResponse({ error: 'Storage credentials not configured' }, 503);
  }

  const rangeHeader = request.headers.get('range');
  const reqMethod = request.method === 'HEAD' ? 'HEAD' : 'GET';
  const canonicalUri = `/${r2Cfg.BUCKET_NAME}/${awsUriEncode(cleanKey)}`;

  const { requestHeaders, fullUrl } = buildSigV4Headers({
    method: reqMethod,
    canonicalUri,
    range: rangeHeader,
    env
  });

  try {
    const r2Res = await fetch(fullUrl, {
      method: reqMethod,
      headers: requestHeaders
    });

    const status = r2Res.status;
    if (status === 200 || status === 206) {
      const responseHeaders = new Headers();
      responseHeaders.set('Content-Type', r2Res.headers.get('content-type') || 'video/mp4');
      responseHeaders.set('Accept-Ranges', 'bytes');
      responseHeaders.set('Cache-Control', 'public, max-age=31536000, immutable');
      responseHeaders.set('Access-Control-Allow-Origin', '*');

      const contentRange = r2Res.headers.get('content-range');
      if (contentRange) {
        responseHeaders.set('Content-Range', contentRange);
      }
      const contentLength = r2Res.headers.get('content-length');
      if (contentLength) {
        responseHeaders.set('Content-Length', contentLength);
      }

      return new Response(reqMethod === 'HEAD' ? null : r2Res.body, {
        status,
        headers: responseHeaders
      });
    }

    return jsonResponse({ error: 'Video not found in storage' }, status || 404);
  } catch (err) {
    return jsonResponse({ error: 'Failed to stream video from Cloudflare R2' }, 502);
  }
}
