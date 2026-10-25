import crypto from 'crypto';
import https from 'https';

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
  return hmac(kService, 'aws4_request');
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { key } = req.query;
  if (!key || typeof key !== 'string') {
    return res.status(400).json({ error: 'Missing image key parameter' });
  }

  // Security: Prevent directory traversal or URI manipulation - only serve public dish & category images
  const cleanKey = key.replace(/^\/+/, '');
  if ((!cleanKey.startsWith('dishes/') && !cleanKey.startsWith('categories/')) || cleanKey.includes('..') || !/^[a-zA-Z0-9_\-./]+$/.test(cleanKey)) {
    return res.status(400).json({ error: 'Invalid image key' });
  }

  if (!R2_CONFIG.ACCESS_KEY_ID || !R2_CONFIG.SECRET_ACCESS_KEY || !R2_CONFIG.HOST || !R2_CONFIG.BUCKET_NAME) {
    return res.status(503).json({ error: 'Storage credentials not configured' });
  }

  const date = new Date();
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.substring(0, 8);
  const credentialScope = `${dateStamp}/${R2_CONFIG.REGION}/${R2_CONFIG.SERVICE}/aws4_request`;

  const canonicalUri = `/${R2_CONFIG.BUCKET_NAME}/${encodeURIComponent(cleanKey).replace(/%2F/g, '/')}`;
  const payloadHash = sha256Hex('');

  const canonicalHeaders = `host:${R2_CONFIG.HOST}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = `GET\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;

  const signingKey = getSigningKey(R2_CONFIG.SECRET_ACCESS_KEY, dateStamp, R2_CONFIG.REGION, R2_CONFIG.SERVICE);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${R2_CONFIG.ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const options = {
    hostname: R2_CONFIG.HOST,
    path: canonicalUri,
    method: 'GET',
    headers: {
      'host': R2_CONFIG.HOST,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      'Authorization': authorizationHeader
    }
  };

  const r2Req = https.request(options, (r2Res) => {
    if (r2Res.statusCode >= 200 && r2Res.statusCode < 300) {
      res.setHeader('Content-Type', r2Res.headers['content-type'] || 'image/jpeg');
      if (r2Res.headers['content-length']) {
        res.setHeader('Content-Length', r2Res.headers['content-length']);
      }
      // Cache-Control: 1-year browser & Global Edge CDN cache
      res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
      res.setHeader('CDN-Cache-Control', 'public, s-maxage=31536000, immutable');
      res.setHeader('Vercel-CDN-Cache-Control', 'public, s-maxage=31536000, immutable');
      res.status(r2Res.statusCode);
      r2Res.pipe(res);
    } else {
      r2Res.resume();
      res.status(r2Res.statusCode).json({ error: 'Image not found in storage' });
    }
  });

  r2Req.setTimeout(8000, () => {
    r2Req.destroy(new Error('Cloudflare R2 image retrieval timeout (8s)'));
  });

  r2Req.on('error', (err) => {
    console.error('[R2 Image Proxy Error]:', err);
    res.status(502).json({ error: 'Failed to retrieve image from storage' });
  });

  r2Req.end();
}
