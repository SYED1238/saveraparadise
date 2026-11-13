/**
 * Cloudflare Pages Function: Cloudflare R2 Audio Stream Proxy
 * GET /api/r2-audio?key=ICEDMANE%2C%20DYSMANE%20-%20FUNK%20CRIMINAL%20%5B%20AUDIO%20EDIT%20%5D%20-%20128.MP3
 * Supports HTTP 206 Partial Content range requests for instant kitchen alarm audio streaming.
 */
import { getR2Config, buildSigV4Headers, awsUriEncode } from './_r2.js';
import { hydrateEnv, jsonResponse } from './_adapter.js';

const DEFAULT_AUDIO_KEY = 'ICEDMANE, DYSMANE - FUNK CRIMINAL [ AUDIO EDIT ] - 128.MP3';

const ALLOWED_EXPLICIT_KEYS = new Set([
  'ICEDMANE, DYSMANE - FUNK CRIMINAL [ AUDIO EDIT ] - 128.MP3',
  'audio/ICEDMANE, DYSMANE - FUNK CRIMINAL [ AUDIO EDIT ] - 128.MP3'
]);

function getAudioContentType(key) {
  const lower = key.toLowerCase();
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.m4a') || lower.endsWith('.aac')) return 'audio/mp4';
  return 'audio/mpeg';
}

export async function onRequest(context) {
  hydrateEnv(context);
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Allow': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Range, Content-Type'
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
  let key = url.searchParams.get('key')?.trim() || DEFAULT_AUDIO_KEY;
  if (!key) key = DEFAULT_AUDIO_KEY;

  const cleanKey = key.replace(/^\/+/, '');
  if (cleanKey.includes('..') || cleanKey.includes('\\')) {
    return jsonResponse({ error: 'Invalid audio key: path traversal detected' }, 400);
  }

  const lowerKey = cleanKey.toLowerCase();
  if (!lowerKey.endsWith('.mp3') && !lowerKey.endsWith('.ogg') && !lowerKey.endsWith('.wav') && !lowerKey.endsWith('.m4a') && !lowerKey.endsWith('.aac')) {
    return jsonResponse({ error: 'Invalid audio key: only audio files (.mp3, .ogg, .wav, .m4a, .aac) are supported' }, 400);
  }

  if (!/^[a-zA-Z0-9_\-. /(),[\]]+$/.test(cleanKey)) {
    return jsonResponse({ error: 'Invalid audio key: illegal characters in path' }, 400);
  }

  const isDefaultAudio = cleanKey === DEFAULT_AUDIO_KEY || ALLOWED_EXPLICIT_KEYS.has(cleanKey);
  const isInAudioFolder = cleanKey.startsWith('audio/') || cleanKey.startsWith('sounds/');
  if (!isDefaultAudio && !isInAudioFolder) {
    return jsonResponse({ error: 'Invalid audio key: audio must reside in audio/ or sounds/ folder or be the default track' }, 400);
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
      responseHeaders.set('Content-Type', r2Res.headers.get('content-type') || getAudioContentType(cleanKey));
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

    return jsonResponse({ error: 'Audio track not found in storage' }, status || 404);
  } catch (err) {
    return jsonResponse({ error: 'Failed to stream audio from Cloudflare R2' }, 502);
  }
}
