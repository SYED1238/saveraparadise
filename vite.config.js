import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import https from 'https';
import { verifyAdminToken, verifyAdminPin, createAdminToken } from './api/_auth.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const env = loadEnv(process.env.NODE_ENV || 'development', process.cwd(), '');
Object.assign(process.env, env);

const R2_CONFIG = {
  ENDPOINT: env.R2_ENDPOINT || process.env.R2_ENDPOINT || '',
  HOST: env.R2_HOST || process.env.R2_HOST || '',
  BUCKET_NAME: env.R2_BUCKET_NAME || process.env.R2_BUCKET_NAME || '',
  ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID || '',
  SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY || '',
  REGION: env.R2_REGION || process.env.R2_REGION || 'auto',
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

function generatePresignedGetUrl(key, expiresInSeconds = 604800) {
  const date = new Date();
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.substring(0, 8);
  const credentialScope = `${dateStamp}/${R2_CONFIG.REGION}/${R2_CONFIG.SERVICE}/aws4_request`;

  const canonicalUri = `/${R2_CONFIG.BUCKET_NAME}/${encodeURIComponent(key).replace(/%2F/g, '/')}`;
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

function r2DevMiddlewarePlugin() {
  return {
    name: 'r2-dev-middleware',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ? req.url.split('?')[0] : '';

        // POST /api/admin-auth
        if (req.method === 'POST' && url === '/api/admin-auth') {
          const chunks = [];
          req.on('data', c => chunks.push(c));
          req.on('end', () => {
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
              const pin = body.pin;
              if (verifyAdminPin(pin)) {
                const token = createAdminToken();
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ success: true, token, role: 'admin', expiresIn: 43200 }));
              }
              res.statusCode = 401;
              res.setHeader('Content-Type', 'application/json');
              return res.end(JSON.stringify({ error: 'Invalid manager passcode' }));
            } catch (err) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              return res.end(JSON.stringify({ error: 'Malformed JSON payload' }));
            }
          });
          return;
        }

        // 0. GET /api/r2-image?key=dishes/...
        if (req.method === 'GET' && url === '/api/r2-image') {
          const searchParams = new URL(req.url, 'http://localhost').searchParams;
          const key = searchParams.get('key');
          if (!key || (!key.startsWith('dishes/') && !key.startsWith('categories/')) || key.includes('..') || !/^[a-zA-Z0-9_\-./]+$/.test(key)) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ error: 'Invalid or missing image key' }));
          }

          if (!R2_CONFIG.ACCESS_KEY_ID || !R2_CONFIG.SECRET_ACCESS_KEY) {
            res.statusCode = 503;
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ error: 'Storage credentials not configured in .env.local' }));
          }

          const date = new Date();
          const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
          const dateStamp = amzDate.substring(0, 8);
          const credentialScope = `${dateStamp}/${R2_CONFIG.REGION}/${R2_CONFIG.SERVICE}/aws4_request`;

          const canonicalUri = `/${R2_CONFIG.BUCKET_NAME}/${key.replace(/^\/+/, '')}`;
          const payloadHash = sha256Hex('');

          const canonicalHeaders = `host:${R2_CONFIG.HOST}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
          const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

          const canonicalRequest = `GET\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
          const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;

          const signingKey = getSigningKey(R2_CONFIG.SECRET_ACCESS_KEY, dateStamp, R2_CONFIG.REGION, R2_CONFIG.SERVICE);
          const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

          const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${R2_CONFIG.ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

          const getOptions = {
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

          const r2Req = https.request(getOptions, (r2Res) => {
            if (r2Res.statusCode >= 200 && r2Res.statusCode < 300) {
              res.setHeader('Content-Type', r2Res.headers['content-type'] || 'image/jpeg');
              res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
              res.statusCode = r2Res.statusCode;
              r2Res.pipe(res);
            } else {
              res.statusCode = r2Res.statusCode || 404;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Image not found' }));
            }
          });

          r2Req.on('error', (err) => {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          });

          r2Req.end();
          return;
        }

        // 1. POST /api/r2-upload
        if (req.method === 'POST' && url === '/api/r2-upload') {
          const auth = verifyAdminToken(req);
          if (!auth.valid) {
            res.statusCode = 401;
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ error: auth.error || 'Unauthorized: Admin session required' }));
          }

          const chunks = [];
          req.on('data', chunk => chunks.push(chunk));
          req.on('end', async () => {
            try {
              if (!R2_CONFIG.ACCESS_KEY_ID || !R2_CONFIG.SECRET_ACCESS_KEY) {
                res.statusCode = 503;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ error: 'R2 credentials not configured in .env.local' }));
              }
              const buffer = Buffer.concat(chunks);
              const rawMime = (req.headers['content-type'] || 'image/jpeg').split(';')[0].trim().toLowerCase();
              const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
              const mimeType = allowedMimes.includes(rawMime) ? rawMime : 'image/jpeg';
              const rawKey = String(req.headers['x-key'] || `dishes/dish_${Date.now()}.jpg`).trim();
              const folder = rawKey.startsWith('categories/') ? 'categories' : 'dishes';
              const sanitizedFilename = rawKey.split('/').pop().replace(/[^a-zA-Z0-9._-]/g, '_');
              const key = `${folder}/${sanitizedFilename || `${folder}_${Date.now()}.jpg`}`;

              const date = new Date();
              const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
              const dateStamp = amzDate.substring(0, 8);
              const credentialScope = `${dateStamp}/${R2_CONFIG.REGION}/${R2_CONFIG.SERVICE}/aws4_request`;

              const canonicalUri = `/${R2_CONFIG.BUCKET_NAME}/${encodeURIComponent(key).replace(/%2F/g, '/')}`;
              const payloadHash = sha256Hex(buffer);

              const canonicalHeaders = `content-type:${mimeType}\nhost:${R2_CONFIG.HOST}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
              const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';

              const canonicalRequest = `PUT\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
              const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;

              const signingKey = getSigningKey(R2_CONFIG.SECRET_ACCESS_KEY, dateStamp, R2_CONFIG.REGION, R2_CONFIG.SERVICE);
              const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

              const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${R2_CONFIG.ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

              const putOptions = {
                hostname: R2_CONFIG.HOST,
                path: canonicalUri,
                method: 'PUT',
                headers: {
                  'host': R2_CONFIG.HOST,
                  'content-type': mimeType,
                  'x-amz-date': amzDate,
                  'x-amz-content-sha256': payloadHash,
                  'Authorization': authorizationHeader,
                  'Content-Length': buffer.length
                }
              };

              const r2Req = https.request(putOptions, (r2Res) => {
                let r2Body = '';
                r2Res.on('data', c => r2Body += c);
                r2Res.on('end', () => {
                  if (r2Res.statusCode >= 200 && r2Res.statusCode < 300) {
                    const presignedUrl = generatePresignedGetUrl(key);
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ success: true, key, url: presignedUrl }));
                  } else {
                    res.statusCode = r2Res.statusCode || 500;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: r2Body || 'R2 upload failed' }));
                  }
                });
              });

              r2Req.on('error', (err) => {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: err.message }));
              });

              r2Req.write(buffer);
              r2Req.end();
            } catch (err) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: err.message }));
            }
          });
          return;
        }

        // 2. GET /api/r2-list
        if (req.method === 'GET' && url === '/api/r2-list') {
          const auth = verifyAdminToken(req);
          if (!auth.valid) {
            res.statusCode = 401;
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ error: auth.error || 'Unauthorized: Admin session required to list storage objects' }));
          }
          try {
            const date = new Date();
            const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
            const dateStamp = amzDate.substring(0, 8);
            const credentialScope = `${dateStamp}/${R2_CONFIG.REGION}/${R2_CONFIG.SERVICE}/aws4_request`;

            const canonicalUri = `/${R2_CONFIG.BUCKET_NAME}`;
            const canonicalQueryString = 'list-type=2&prefix=dishes%2F';
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

            const r2Req = https.request(listOptions, (r2Res) => {
              let body = '';
              r2Res.on('data', c => body += c);
              r2Res.on('end', () => {
                const keys = [];
                const regex = /<Key>(dishes\/[^<]+)<\/Key>/g;
                let match;
                while ((match = regex.exec(body)) !== null) {
                  keys.push(match[1]);
                }

                const files = keys.map(k => ({
                  name: k.split('/').pop(),
                  key: k,
                  url: generatePresignedGetUrl(k),
                  directUrl: generatePresignedGetUrl(k)
                }));

                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ files }));
              });
            });

            r2Req.on('error', (err) => {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: err.message }));
            });

            r2Req.end();
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // 3. POST /api/r2-delete
        if (req.method === 'POST' && url === '/api/r2-delete') {
          const auth = verifyAdminToken(req);
          if (!auth.valid) {
            res.statusCode = 401;
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ error: auth.error || 'Unauthorized: Admin session required' }));
          }

          const chunks = [];
          req.on('data', chunk => chunks.push(chunk));
          req.on('end', async () => {
            try {
              const bodyStr = Buffer.concat(chunks).toString();
              let bodyJson = {};
              try { bodyJson = JSON.parse(bodyStr); } catch {}
              const rawKey = bodyJson.key;
              if (!rawKey || typeof rawKey !== 'string') {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ error: 'Image key is required' }));
              }
              const cleanKey = rawKey.trim();
              if ((!cleanKey.startsWith('dishes/') && !cleanKey.startsWith('categories/')) || cleanKey.includes('..')) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ error: 'Invalid key: restricted to dishes/ and categories/' }));
              }

              const date = new Date();
              const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
              const dateStamp = amzDate.substring(0, 8);
              const credentialScope = `${dateStamp}/${R2_CONFIG.REGION}/${R2_CONFIG.SERVICE}/aws4_request`;

              const encodedKey = encodeURIComponent(cleanKey).replace(/%2F/g, '/');
              const canonicalUri = `/${R2_CONFIG.BUCKET_NAME}/${encodedKey}`;
              const payloadHash = sha256Hex('');

              const canonicalHeaders = `host:${R2_CONFIG.HOST}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
              const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

              const canonicalRequest = `DELETE\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
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

              const r2Req = https.request(deleteOptions, (r2Res) => {
                res.setHeader('Content-Type', 'application/json');
                if (r2Res.statusCode >= 200 && r2Res.statusCode < 300) {
                  res.end(JSON.stringify({ success: true, deletedKey: cleanKey }));
                } else {
                  res.statusCode = r2Res.statusCode || 500;
                  res.end(JSON.stringify({ error: 'Delete failed' }));
                }
              });

              r2Req.on('error', (err) => {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: err.message }));
              });

              r2Req.end();
            } catch (err) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: err.message }));
            }
          });
          return;
        }

        next();
      });
    }
  };
}

export default defineConfig({
  plugins: [r2DevMiddlewarePlugin()],
  envPrefix: ['VITE_'],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
        delivery: resolve(__dirname, 'delivery.html'),
        owner: resolve(__dirname, 'owner.html')
      }
    }
  }
});
