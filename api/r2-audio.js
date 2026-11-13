import crypto from 'crypto';
import https from 'https';

function getR2Config() {
  return {
    HOST: process.env.R2_HOST || '',
    BUCKET_NAME: process.env.R2_BUCKET_NAME || '',
    ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID || '',
    SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY || '',
    REGION: process.env.R2_REGION || 'auto',
    SERVICE: 's3'
  };
}

const DEFAULT_AUDIO_KEY = 'ICEDMANE, DYSMANE - FUNK CRIMINAL [ AUDIO EDIT ] - 128.MP3';

const ALLOWED_EXPLICIT_KEYS = new Set([
  'ICEDMANE, DYSMANE - FUNK CRIMINAL [ AUDIO EDIT ] - 128.MP3',
  'audio/ICEDMANE, DYSMANE - FUNK CRIMINAL [ AUDIO EDIT ] - 128.MP3'
]);

export const config = {
  api: {
    responseLimit: false,
  },
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

/**
 * AWS Signature Version 4 RFC 3986 URI encoding
 * Preserves forward slashes and standardizes special characters.
 */
function awsUriEncode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()).replace(/%2F/g, '/');
}

function getAudioContentType(key) {
  const lower = key.toLowerCase();
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.m4a') || lower.endsWith('.aac')) return 'audio/mp4';
  return 'audio/mpeg';
}

export default async function handler(req, res) {
  try {
    if (req.method === 'OPTIONS') {
      res.setHeader('Allow', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
      return res.status(200).end();
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD, OPTIONS');
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    let key = (req.query && req.query.key) ? String(req.query.key).trim() : DEFAULT_AUDIO_KEY;
    if (!key) key = DEFAULT_AUDIO_KEY;

    const cleanKey = key.replace(/^\/+/, '');

    // 1. Block directory traversal or dangerous path characters
    if (cleanKey.includes('..') || cleanKey.includes('\\')) {
      return res.status(400).json({ error: 'Invalid audio key: path traversal detected' });
    }

    // 2. Must end with valid audio extension
    const lowerKey = cleanKey.toLowerCase();
    if (!lowerKey.endsWith('.mp3') && !lowerKey.endsWith('.ogg') && !lowerKey.endsWith('.wav') && !lowerKey.endsWith('.m4a') && !lowerKey.endsWith('.aac')) {
      return res.status(400).json({ error: 'Invalid audio key: only audio files (.mp3, .ogg, .wav, .m4a, .aac) are supported' });
    }

    // 3. Must match safe character set
    if (!/^[a-zA-Z0-9_\-. /(),[\]]+$/.test(cleanKey)) {
      return res.status(400).json({ error: 'Invalid audio key: illegal characters in path' });
    }

    // 4. Must be default audio or reside in audio/ or sounds/ folders
    const isDefaultAudio = cleanKey === DEFAULT_AUDIO_KEY || ALLOWED_EXPLICIT_KEYS.has(cleanKey);
    const isInAudioFolder = cleanKey.startsWith('audio/') || cleanKey.startsWith('sounds/');
    if (!isDefaultAudio && !isInAudioFolder) {
      return res.status(400).json({ error: 'Invalid audio key: audio must reside in audio/ or sounds/ folder or be the default track' });
    }

    const R2_CONFIG = getR2Config();
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

    const reqMethod = req.method === 'HEAD' ? 'HEAD' : 'GET';
    const canonicalRequest = `${reqMethod}\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
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
      method: reqMethod,
      headers: upstreamHeaders
    };

    return new Promise((resolve) => {
      const r2Req = https.request(options, (r2Res) => {
        r2Req.setTimeout(0);

        const status = r2Res.statusCode;
        if (status === 200 || status === 206) {
          if (!res.headersSent) {
            res.setHeader('Content-Type', r2Res.headers['content-type'] || getAudioContentType(cleanKey));
            res.setHeader('Accept-Ranges', 'bytes');
            if (r2Res.headers['content-range']) {
              res.setHeader('Content-Range', r2Res.headers['content-range']);
            }
            if (r2Res.headers['content-length']) {
              res.setHeader('Content-Length', r2Res.headers['content-length']);
            }
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.statusCode = status;
          }
          if (req.method === 'HEAD') {
            r2Res.resume();
            res.end();
            return resolve();
          }
          r2Res.pipe(res);
          r2Res.on('end', () => resolve());
          r2Res.on('error', (err) => {
            console.error('[R2 Audio Stream Pipe Error]:', err.message);
            resolve();
          });
        } else {
          r2Res.resume();
          if (!res.headersSent) {
            res.statusCode = status || 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Audio track not found in storage' }));
          }
          resolve();
        }
      });

      r2Req.setTimeout(12000, () => {
        r2Req.destroy(new Error('Cloudflare R2 audio streaming timeout (12s)'));
      });

      r2Req.on('error', (err) => {
        console.error('[R2 Audio Stream Error]:', err.message);
        if (!res.headersSent) {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Failed to stream audio from Cloudflare R2' }));
        }
        resolve();
      });

      req.on('close', () => {
        r2Req.destroy();
        resolve();
      });

      r2Req.end();
    });
  } catch (err) {
    console.error('[R2 Audio Uncaught Error]:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Internal server error processing audio streaming request' }));
    }
  }
}
