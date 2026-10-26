import crypto from 'crypto';
import https from 'https';

const R2_CONFIG = {
  HOST: process.env.R2_HOST || 'ac8ec178ff831995f9cc03213674c306.r2.cloudflarestorage.com',
  BUCKET_NAME: process.env.R2_BUCKET_NAME || 'smmtaj',
  ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID || '',
  SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY || '',
  REGION: process.env.R2_REGION || 'auto',
  SERVICE: 's3'
};

const DEFAULT_VIDEO_KEY = 'Untitled design (16).mp4';

function hmac(key, string) {
  return crypto.createHmac('sha256', key).update(string).digest();
}

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function getSigningKey(secretKey, dateStamp, region, service) {
  const kDate = hmac('AWS4' + secretKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

/**
 * AWS Signature Version 4 RFC 3986 URI encoding
 * Requires ( to be %28 and ) to be %29, preserving forward slashes
 */
function awsUriEncode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()).replace(/%2F/g, '/');
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Key can be query param or default preparation video
  let key = (req.query && req.query.key) ? String(req.query.key).trim() : DEFAULT_VIDEO_KEY;
  if (!key) key = DEFAULT_VIDEO_KEY;

  const cleanKey = key.replace(/^\/+/, '');
  if (cleanKey.includes('..') || (!cleanKey.endsWith('.mp4') && !cleanKey.endsWith('.webm'))) {
    return res.status(400).json({ error: 'Invalid video key' });
  }

  if (!R2_CONFIG.ACCESS_KEY_ID || !R2_CONFIG.SECRET_ACCESS_KEY || !R2_CONFIG.HOST || !R2_CONFIG.BUCKET_NAME) {
    return res.status(503).json({ error: 'Storage credentials not configured' });
  }

  const rangeHeader = req.headers['range'] || null;

  const date = new Date();
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.substring(0, 8);
  const credentialScope = `${dateStamp}/${R2_CONFIG.REGION}/${R2_CONFIG.SERVICE}/aws4_request`;

  const canonicalUri = `/${R2_CONFIG.BUCKET_NAME}/${awsUriEncode(cleanKey)}`;
  const payloadHash = sha256Hex('');

  let canonicalHeaders = `host:${R2_CONFIG.HOST}\n`;
  let signedHeaders = 'host';

  if (rangeHeader) {
    canonicalHeaders += `range:${rangeHeader}\n`;
    signedHeaders += ';range';
  }

  canonicalHeaders += `x-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  signedHeaders += ';x-amz-content-sha256;x-amz-date';

  const canonicalRequest = `GET\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;

  const signingKey = getSigningKey(R2_CONFIG.SECRET_ACCESS_KEY, dateStamp, R2_CONFIG.REGION, R2_CONFIG.SERVICE);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${R2_CONFIG.ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const upstreamHeaders = {
    'host': R2_CONFIG.HOST,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    'Authorization': authorizationHeader
  };
  if (rangeHeader) {
    upstreamHeaders['range'] = rangeHeader;
  }

  const options = {
    hostname: R2_CONFIG.HOST,
    path: canonicalUri,
    method: 'GET',
    headers: upstreamHeaders
  };

  const r2Req = https.request(options, (r2Res) => {
    const status = r2Res.statusCode;
    if (status === 200 || status === 206) {
      res.setHeader('Content-Type', r2Res.headers['content-type'] || 'video/mp4');
      res.setHeader('Accept-Ranges', 'bytes');
      if (r2Res.headers['content-range']) {
        res.setHeader('Content-Range', r2Res.headers['content-range']);
      }
      if (r2Res.headers['content-length']) {
        res.setHeader('Content-Length', r2Res.headers['content-length']);
      }
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.status(status);
      r2Res.pipe(res);
    } else {
      r2Res.resume();
      res.status(status).json({ error: 'Video not found in storage' });
    }
  });

  r2Req.setTimeout(12000, () => {
    r2Req.destroy(new Error('Cloudflare R2 video streaming timeout (12s)'));
  });

  r2Req.on('error', (err) => {
    console.error('[R2 Video Stream Error]:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Failed to stream video from Cloudflare R2' });
    }
  });

  r2Req.end();
}
