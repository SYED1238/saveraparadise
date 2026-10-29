import crypto from 'crypto';
import https from 'https';
import { verifyAdminToken } from './_auth.js';

const R2_CONFIG = {
  HOST: process.env.R2_HOST || '',
  BUCKET_NAME: process.env.R2_BUCKET_NAME || '',
  ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID || '',
  SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY || '',
  REGION: process.env.R2_REGION || 'auto',
  SERVICE: 's3'
};

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
  const kSigning = hmac(kService, 'aws4_request');
  return kSigning;
}

function awsUriEncode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()).replace(/%2F/g, '/');
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify cryptographically signed admin session token
  const auth = verifyAdminToken(req);
  if (!auth.valid) {
    return res.status(401).json({ error: auth.error || 'Unauthorized: Admin session required' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  const rawKey = body?.key;
  if (!rawKey || typeof rawKey !== 'string') {
    return res.status(400).json({ error: 'Image key is required' });
  }

  // Sanitize key: ensure only dishes/* or categories/* can be deleted
  const cleanKey = rawKey.trim().replace(/^\/+/, '');
  if ((!cleanKey.startsWith('dishes/') && !cleanKey.startsWith('categories/')) || cleanKey.includes('..')) {
    return res.status(400).json({ error: 'Invalid key: deletion restricted strictly to dishes/ and categories/' });
  }

  if (!R2_CONFIG.ACCESS_KEY_ID || !R2_CONFIG.SECRET_ACCESS_KEY || !R2_CONFIG.HOST || !R2_CONFIG.BUCKET_NAME) {
    return res.status(503).json({ error: 'R2 storage credentials not configured on server' });
  }

  try {
    const date = new Date();
    const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);
    const credentialScope = `${dateStamp}/${R2_CONFIG.REGION}/${R2_CONFIG.SERVICE}/aws4_request`;

    const encodedKey = awsUriEncode(cleanKey);
    const canonicalUri = `/${R2_CONFIG.BUCKET_NAME}/${encodedKey}`;
    const canonicalQueryString = '';
    const payloadHash = sha256Hex('');

    const canonicalHeaders = `host:${R2_CONFIG.HOST}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

    const canonicalRequest = `DELETE\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;

    const signingKey = getSigningKey(R2_CONFIG.SECRET_ACCESS_KEY, dateStamp, R2_CONFIG.REGION, R2_CONFIG.SERVICE);
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${R2_CONFIG.ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const deleteOptions = {
      hostname: R2_CONFIG.HOST,
      path: canonicalUri,
      method: 'DELETE',
      headers: {
        'host': R2_CONFIG.HOST,
        'x-amz-date': amzDate,
        'x-amz-content-sha256': payloadHash,
        'Authorization': authorizationHeader
      }
    };

    return new Promise((resolve) => {
      const r2Req = https.request(deleteOptions, (r2Res) => {
        if (r2Res.statusCode >= 200 && r2Res.statusCode < 300) {
          res.status(200).json({ success: true, deletedKey: cleanKey });
        } else {
          res.status(r2Res.statusCode || 500).json({ error: 'Delete failed' });
        }
        resolve();
      });

      r2Req.on('error', (err) => {
        res.status(500).json({ error: err.message });
        resolve();
      });

      r2Req.end();
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
