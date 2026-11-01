/**
 * Cloudflare Pages Function: Cloudflare R2 Upload Proxy
 * POST /api/r2-upload
 * Dispatches authenticated AWS SigV4 PUT requests to Cloudflare R2 (Account A).
 */
import { verifyAdminToken } from './_auth.js';
import { getR2Config, buildSigV4Headers, sha256Hex, awsUriEncode, generatePresignedGetUrl } from './_r2.js';
import { hydrateEnv, jsonResponse } from './_adapter.js';

export async function onRequest(context) {
  hydrateEnv(context);
  const { request, env } = context;

  const corsHeaders = new Headers();
  corsHeaders.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  corsHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-key, x-filename');

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

  const r2Cfg = getR2Config(env);
  if (!r2Cfg.isConfigured) {
    return jsonResponse({ error: 'R2 storage credentials not configured on server' }, 503, Object.fromEntries(corsHeaders.entries()));
  }

  const rawMime = (request.headers.get('content-type') || 'image/jpeg').split(';')[0].trim().toLowerCase();
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowedMimes.includes(rawMime)) {
    return jsonResponse({ error: 'Unsupported image format. Use JPEG, PNG, WEBP, or GIF.' }, 415, Object.fromEntries(corsHeaders.entries()));
  }
  const mimeType = rawMime;

  const MAX_SIZE = 10 * 1024 * 1024;
  let arrayBuffer;
  try {
    arrayBuffer = await request.arrayBuffer();
  } catch (err) {
    return jsonResponse({ error: 'Upload interrupted or aborted by client.' }, 400, Object.fromEntries(corsHeaders.entries()));
  }

  if (!arrayBuffer || arrayBuffer.byteLength === 0) {
    return jsonResponse({ error: 'No file content received.' }, 400, Object.fromEntries(corsHeaders.entries()));
  }

  if (arrayBuffer.byteLength > MAX_SIZE) {
    return jsonResponse({ error: 'Payload too large. Maximum file size is 10MB.' }, 413, Object.fromEntries(corsHeaders.entries()));
  }

  const buffer = Buffer.from(arrayBuffer);

  const isJpeg = buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
  const isPng = buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 && buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A;
  const isWebp = buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  const isGif = buffer.length >= 6 && (buffer.toString('ascii', 0, 6) === 'GIF87a' || buffer.toString('ascii', 0, 6) === 'GIF89a');

  let detectedMime = null;
  if (isJpeg) detectedMime = 'image/jpeg';
  else if (isPng) detectedMime = 'image/png';
  else if (isWebp) detectedMime = 'image/webp';
  else if (isGif) detectedMime = 'image/gif';

  if (!detectedMime) {
    return jsonResponse({ error: 'File contents do not match valid image signature (JPEG, PNG, WEBP, GIF).' }, 415, Object.fromEntries(corsHeaders.entries()));
  }

  if (mimeType !== detectedMime) {
    return jsonResponse({ error: `Declared Content-Type (${mimeType}) does not match detected file format (${detectedMime}).` }, 415, Object.fromEntries(corsHeaders.entries()));
  }

  const rawKey = String(request.headers.get('x-key') || `dishes/dish_${Date.now()}.jpg`).trim();
  const folder = rawKey.startsWith('categories/') ? 'categories' : 'dishes';
  const sanitizedFilename = rawKey.split('/').pop().replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `${folder}/${sanitizedFilename || `${folder}_${Date.now()}.jpg`}`;

  const canonicalUri = `/${r2Cfg.BUCKET_NAME}/${awsUriEncode(key)}`;
  const payloadHash = sha256Hex(buffer);

  const { requestHeaders, fullUrl } = buildSigV4Headers({
    method: 'PUT',
    canonicalUri,
    payloadHash,
    contentType: mimeType,
    env
  });
  requestHeaders['Content-Length'] = String(buffer.length);

  try {
    const r2Res = await fetch(fullUrl, {
      method: 'PUT',
      headers: requestHeaders,
      body: buffer
    });

    if (r2Res.status >= 200 && r2Res.status < 300) {
      const permanentUrl = generatePresignedGetUrl(key, env);
      return jsonResponse({ success: true, key, url: permanentUrl, directUrl: permanentUrl }, 200, Object.fromEntries(corsHeaders.entries()));
    }

    const r2Body = await r2Res.text().catch(() => '');
    return jsonResponse({ error: r2Body || 'R2 upload failed' }, r2Res.status || 500, Object.fromEntries(corsHeaders.entries()));
  } catch (err) {
    return jsonResponse({ error: err.message }, 500, Object.fromEntries(corsHeaders.entries()));
  }
}
