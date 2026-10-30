import crypto from 'crypto';
import https from 'https';
import { verifyAdminToken } from './_auth.js';

const R2_CONFIG = {
  HOST: process.env.R2_HOST || '',
  BUCKET_NAME: process.env.R2_BUCKET_NAME || '',
  ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID || '',
  SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY || '',
  PUBLIC_DOMAIN: (process.env.VITE_R2_PUBLIC_DOMAIN || process.env.R2_PUBLIC_DOMAIN || '').replace(/\/$/, ''),
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
  return encodeURIComponent(str).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function generatePresignedGetUrl(key, expiresInSeconds = 604800) {
  if (R2_CONFIG.PUBLIC_DOMAIN) {
    return `${R2_CONFIG.PUBLIC_DOMAIN}/${awsUriEncode(key).replace(/%2F/g, '/')}`;
  }
  const date = new Date();
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.substring(0, 8);
  const credentialScope = `${dateStamp}/${R2_CONFIG.REGION}/${R2_CONFIG.SERVICE}/aws4_request`;

  const canonicalUri = `/${R2_CONFIG.BUCKET_NAME}/${awsUriEncode(key).replace(/%2F/g, '/')}`;
  const queryParams = [
    `X-Amz-Algorithm=AWS4-HMAC-SHA256`,
    `X-Amz-Credential=${encodeURIComponent(`${R2_CONFIG.ACCESS_KEY_ID}/${credentialScope}`)}`,
    `X-Amz-Date=${amzDate}`,
    `X-Amz-Expires=${expiresInSeconds}`,
    `X-Amz-SignedHeaders=host`
  ];
  queryParams.sort();
  const canonicalQueryString = queryParams.join('&');

  const canonicalHeaders = `host:${R2_CONFIG.HOST}\n`;
  const signedHeaders = 'host';
  const payloadHash = 'UNSIGNED-PAYLOAD';

  const canonicalRequest = `GET\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;

  const signingKey = getSigningKey(R2_CONFIG.SECRET_ACCESS_KEY, dateStamp, R2_CONFIG.REGION, R2_CONFIG.SERVICE);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return `https://${R2_CONFIG.HOST}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify cryptographically signed admin session token
  const auth = verifyAdminToken(req);
  if (!auth.valid) {
    return res.status(401).json({ error: auth.error || 'Unauthorized: Admin session required to list storage objects' });
  }

  if (!R2_CONFIG.ACCESS_KEY_ID || !R2_CONFIG.SECRET_ACCESS_KEY || !R2_CONFIG.HOST || !R2_CONFIG.BUCKET_NAME) {
    return res.status(503).json({ error: 'R2 storage credentials not configured on server', files: [] });
  }

  try {
    // Extract and sanitize folder prefix query parameter (defaults to 'dishes/')
    let requestedPrefix = (req.query && typeof req.query.prefix === 'string' ? req.query.prefix : '') ||
      (req.url && req.url.includes('?') ? (new URL(req.url, 'http://localhost')).searchParams.get('prefix') : '') ||
      'dishes/';

    let sanitizedPrefix = String(requestedPrefix).trim().replace(/[^a-zA-Z0-9_\-\/]/g, '').replace(/^\/+/, '');
    if (!sanitizedPrefix) {
      sanitizedPrefix = 'dishes/';
    } else if (!sanitizedPrefix.endsWith('/')) {
      sanitizedPrefix += '/';
    }

    const date = new Date();
    const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);
    const credentialScope = `${dateStamp}/${R2_CONFIG.REGION}/${R2_CONFIG.SERVICE}/aws4_request`;

    const canonicalUri = `/${R2_CONFIG.BUCKET_NAME}`;
    const canonicalQueryString = `list-type=2&prefix=${encodeURIComponent(sanitizedPrefix)}`;
    const payloadHash = sha256Hex('');

    const canonicalHeaders = `host:${R2_CONFIG.HOST}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

    const canonicalRequest = `GET\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;

    const signingKey = getSigningKey(R2_CONFIG.SECRET_ACCESS_KEY, dateStamp, R2_CONFIG.REGION, R2_CONFIG.SERVICE);
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${R2_CONFIG.ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const listOptions = {
      hostname: R2_CONFIG.HOST,
      path: `${canonicalUri}?${canonicalQueryString}`,
      method: 'GET',
      headers: {
        'host': R2_CONFIG.HOST,
        'x-amz-date': amzDate,
        'x-amz-content-sha256': payloadHash,
        'Authorization': authorizationHeader
      }
    };

    return new Promise((resolve) => {
      const r2Req = https.request(listOptions, (r2Res) => {
        let body = '';
        r2Res.on('data', c => body += c);
        r2Res.on('end', () => {
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
            url: generatePresignedGetUrl(k),
            directUrl: generatePresignedGetUrl(k)
          }));

          res.setHeader('Content-Type', 'application/json');
          res.status(200).json({ files });
          resolve();
        });
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
