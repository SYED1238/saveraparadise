/**
 * Cloudflare R2 S3-Compatible REST Client for Cloudflare Pages Functions
 * Enables cross-account R2 access (Account B Pages Functions -> Account A R2 Storage)
 * using standard AWS Signature Version 4 over Cloudflare's global edge network.
 */
import crypto from 'node:crypto';

export function getR2Config(env = null) {
  const HOST = (env && env.R2_HOST) || (typeof process !== 'undefined' && process.env && process.env.R2_HOST) || '';
  const BUCKET_NAME = (env && env.R2_BUCKET_NAME) || (typeof process !== 'undefined' && process.env && process.env.R2_BUCKET_NAME) || '';
  const ACCESS_KEY_ID = (env && env.R2_ACCESS_KEY_ID) || (typeof process !== 'undefined' && process.env && process.env.R2_ACCESS_KEY_ID) || '';
  const SECRET_ACCESS_KEY = (env && env.R2_SECRET_ACCESS_KEY) || (typeof process !== 'undefined' && process.env && process.env.R2_SECRET_ACCESS_KEY) || '';
  const REGION = (env && env.R2_REGION) || (typeof process !== 'undefined' && process.env && process.env.R2_REGION) || 'auto';
  const PUBLIC_DOMAIN = ((env && (env.VITE_R2_PUBLIC_DOMAIN || env.R2_PUBLIC_DOMAIN)) ||
    (typeof process !== 'undefined' && process.env && (process.env.VITE_R2_PUBLIC_DOMAIN || process.env.R2_PUBLIC_DOMAIN)) || '').replace(/\/$/, '');

  return {
    HOST,
    BUCKET_NAME,
    ACCESS_KEY_ID,
    SECRET_ACCESS_KEY,
    REGION,
    PUBLIC_DOMAIN,
    SERVICE: 's3',
    isConfigured: Boolean(HOST && BUCKET_NAME && ACCESS_KEY_ID && SECRET_ACCESS_KEY)
  };
}

function hmac(key, string) {
  return crypto.createHmac('sha256', key).update(string).digest();
}

export function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function getSigningKey(secretKey, dateStamp, region, service) {
  const kDate = hmac('AWS4' + secretKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

export function awsUriEncode(str) {
  return encodeURIComponent(str)
    .replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%2F/g, '/');
}

export function generatePresignedGetUrl(key, env = null) {
  const cfg = getR2Config(env);
  if (cfg.PUBLIC_DOMAIN) {
    return `${cfg.PUBLIC_DOMAIN}/${awsUriEncode(key)}`;
  }
  return `/api/r2-image?key=${encodeURIComponent(key)}`;
}

export function buildSigV4Headers({
  method,
  canonicalUri,
  canonicalQueryString = '',
  payloadHash = sha256Hex(''),
  contentType = null,
  range = null,
  env = null
}) {
  const cfg = getR2Config(env);
  const date = new Date();
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.substring(0, 8);
  const credentialScope = `${dateStamp}/${cfg.REGION}/${cfg.SERVICE}/aws4_request`;

  let canonicalHeaders = '';
  let signedHeaders = '';

  if (contentType) {
    canonicalHeaders += `content-type:${contentType}\n`;
    signedHeaders += 'content-type;';
  }

  canonicalHeaders += `host:${cfg.HOST}\n`;
  signedHeaders += 'host;';

  if (range) {
    canonicalHeaders += `range:${range}\n`;
    signedHeaders += 'range;';
  }

  canonicalHeaders += `x-amz-content-sha256:${payloadHash}\n`;
  canonicalHeaders += `x-amz-date:${amzDate}\n`;
  signedHeaders += 'x-amz-content-sha256;x-amz-date';

  const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;

  const signingKey = getSigningKey(cfg.SECRET_ACCESS_KEY, dateStamp, cfg.REGION, cfg.SERVICE);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${cfg.ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const requestHeaders = {
    'host': cfg.HOST,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    'Authorization': authorizationHeader
  };

  if (contentType) {
    requestHeaders['content-type'] = contentType;
  }
  if (range) {
    requestHeaders['range'] = range;
  }

  return { requestHeaders, canonicalUri, fullUrl: `https://${cfg.HOST}${canonicalUri}${canonicalQueryString ? '?' + canonicalQueryString : ''}` };
}
