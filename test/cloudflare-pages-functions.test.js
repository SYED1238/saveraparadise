import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Import Pages Functions directly
import { onRequest as adminAuthHandler } from '../functions/api/admin-auth.js';
import { onRequest as checkoutHandler } from '../functions/api/checkout.js';
import { onRequest as cashfreeCreateOrderHandler } from '../functions/api/cashfree-create-order.js';
import { onRequest as cashfreeGenerateQrHandler } from '../functions/api/cashfree-generate-qr.js';
import { onRequest as cashfreePayoutHandler } from '../functions/api/cashfree-payout.js';
import { onRequest as cashfreeWebhookHandler } from '../functions/api/cashfree-webhook.js';
import { onRequest as olaMapsHandler } from '../functions/api/ola-maps.js';
import { onRequest as r2UploadHandler } from '../functions/api/r2-upload.js';
import { onRequest as r2ImageHandler } from '../functions/api/r2-image.js';
import { onRequest as r2ListHandler } from '../functions/api/r2-list.js';
import { onRequest as r2DeleteHandler } from '../functions/api/r2-delete.js';
import { onRequest as r2VideoHandler } from '../functions/api/r2-video.js';

import { createAdminToken, signData, signPayload } from '../functions/api/_auth.js';
import { getR2Config, buildSigV4Headers, sha256Hex } from '../functions/api/_r2.js';
import { getCashfreeConfig } from '../functions/api/_cashfree.js';

const mockEnv = {
  ADMIN_PIN: '8899',
  OWNER_PIN: '9900',
  SESSION_SECRET: 'test_session_secret_32_characters_long_secure_key!',
  CASHFREE_APP_ID: '',
  CASHFREE_SECRET_KEY: '',
  CASHFREE_ENV: 'TEST',
  R2_ACCESS_KEY_ID: 'test_r2_access_key',
  R2_SECRET_ACCESS_KEY: 'test_r2_secret_key_1234567890',
  R2_BUCKET_NAME: 'savera-paradise-dishes',
  R2_HOST: 'account-a-id.r2.cloudflarestorage.com',
  R2_ENDPOINT: 'https://account-a-id.r2.cloudflarestorage.com',
  R2_REGION: 'auto',
  VITE_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  CLOUDFLARE_TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA'
};

describe('CLOUDFLARE PAGES FUNCTIONS & COMPATIBILITY SUITE', () => {

  describe('1. Static Configuration Artifacts', () => {
    it('wrangler.toml includes nodejs_compat flag and dist output directory', () => {
      const wranglerPath = path.resolve(process.cwd(), 'wrangler.toml');
      assert.ok(fs.existsSync(wranglerPath), 'wrangler.toml must exist');
      const content = fs.readFileSync(wranglerPath, 'utf8');
      assert.ok(content.includes('nodejs_compat'), 'nodejs_compat flag must be enabled');
      assert.ok(content.includes('dist'), 'pages_build_output_dir must point to dist');
    });

    it('public/_routes.json defines include/exclude rules for edge optimization', () => {
      const routesPath = path.resolve(process.cwd(), 'public/_routes.json');
      assert.ok(fs.existsSync(routesPath), 'public/_routes.json must exist');
      const routes = JSON.parse(fs.readFileSync(routesPath, 'utf8'));
      assert.deepEqual(routes.include, ['/api/*']);
      assert.ok(routes.exclude.includes('/assets/*'));
    });

    it('public/_redirects defines 200 rewrites for multi-portal clean URLs', () => {
      const redirectsPath = path.resolve(process.cwd(), 'public/_redirects');
      assert.ok(fs.existsSync(redirectsPath), 'public/_redirects must exist');
      const content = fs.readFileSync(redirectsPath, 'utf8');
      assert.ok(content.includes('/admin     /admin.html     200'));
      assert.ok(content.includes('/delivery  /delivery.html  200'));
      assert.ok(content.includes('/owner     /owner.html     200'));
    });

    it('public/_headers defines strict CSP and security headers', () => {
      const headersPath = path.resolve(process.cwd(), 'public/_headers');
      assert.ok(fs.existsSync(headersPath), 'public/_headers must exist');
      const content = fs.readFileSync(headersPath, 'utf8');
      assert.ok(content.includes('X-Frame-Options: SAMEORIGIN'));
      assert.ok(content.includes('X-Content-Type-Options: nosniff'));
      assert.ok(content.includes('Content-Security-Policy'));
    });
  });

  describe('2. Admin Authentication Pages Function (/api/admin-auth)', () => {
    it('authenticates valid manager PIN and returns signed bearer token with role', async () => {
      const req = new Request('https://saveraparadise.com/api/admin-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: '8899' })
      });
      const res = await adminAuthHandler({ request: req, env: mockEnv });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.role, 'admin');
      assert.ok(data.token && data.token.includes('.'));
    });

    it('authenticates valid executive owner PIN and returns owner role token', async () => {
      const req = new Request('https://saveraparadise.com/api/admin-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: '9900' })
      });
      const res = await adminAuthHandler({ request: req, env: mockEnv });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.role, 'owner');
    });

    it('rejects invalid PIN with 401 and tracks remaining attempts', async () => {
      const req = new Request('https://saveraparadise.com/api/admin-auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-connecting-ip': '198.51.100.5'
        },
        body: JSON.stringify({ pin: '0000' })
      });
      const res = await adminAuthHandler({ request: req, env: mockEnv });
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.ok(data.error.includes('Invalid passcode'));
    });

    it('refreshes existing valid bearer session token', async () => {
      const token = createAdminToken(3600000, 'admin', mockEnv);
      const req = new Request('https://saveraparadise.com/api/admin-auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ action: 'refresh' })
      });
      const res = await adminAuthHandler({ request: req, env: mockEnv });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.ok(data.token);
    });
  });

  describe('3. Checkout Anti-Tamper & Pricing Engine (/api/checkout)', () => {
    it('validates cart items and returns authoritative HMAC signature', async () => {
      const req = new Request('https://saveraparadise.com/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-turnstile-response': '1x00000000000000000000AA'
        },
        body: JSON.stringify({
          items: [
            { id: 'dish-1', name: 'Chicken Biryani', price: 220, qty: 1 }
          ]
        })
      });
      const res = await checkoutHandler({ request: req, env: mockEnv });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.subtotal, 220);
      assert.equal(data.deliveryFee, 40); // subtotal < 250
      assert.equal(data.platformFee, 5);
      assert.equal(data.total, 265);
      assert.ok(data.checkoutToken);
    });

    it('applies free delivery when subtotal >= 250', async () => {
      const req = new Request('https://saveraparadise.com/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-turnstile-response': '1x00000000000000000000AA'
        },
        body: JSON.stringify({
          items: [
            { id: 'dish-2', name: 'Mutton Biryani', price: 300, qty: 1 }
          ]
        })
      });
      const res = await checkoutHandler({ request: req, env: mockEnv });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.deliveryFee, 0);
      assert.equal(data.total, 305);
    });

    it('rejects empty cart with 400', async () => {
      const req = new Request('https://saveraparadise.com/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [] })
      });
      const res = await checkoutHandler({ request: req, env: mockEnv });
      assert.equal(res.status, 400);
    });

    it('rejects bot requests with blocked Turnstile token with 403', async () => {
      const req = new Request('https://saveraparadise.com/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-turnstile-response': 'BLOCK_TOKEN'
        },
        body: JSON.stringify({
          items: [{ id: 'dish-1', price: 150, qty: 1 }]
        })
      });
      const res = await checkoutHandler({ request: req, env: mockEnv });
      assert.equal(res.status, 403);
    });
  });

  describe('4. Cashfree Payments Suite', () => {
    it('creates sandbox/mock Cashfree PG order when unconfigured in test environment', async () => {
      const req = new Request('https://saveraparadise.com/api/cashfree-create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-turnstile-response': '1x00000000000000000000AA'
        },
        body: JSON.stringify({
          orderId: '1001',
          amount: 250,
          customerPhone: '9876543210'
        })
      });
      const res = await cashfreeCreateOrderHandler({ request: req, env: mockEnv });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.ok(data.paymentSessionId);
    });

    it('enforces signed checkoutToken total and prevents amount tampering', async () => {
      const signedCheckout = signPayload({ numericTotal: 299 }, mockEnv);
      const req = new Request('https://saveraparadise.com/api/cashfree-create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: '1002',
          amount: 10, // tampered lower amount
          checkoutToken: signedCheckout
        })
      });
      const res = await cashfreeCreateOrderHandler({ request: req, env: mockEnv });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.orderAmount, 299); // Authoritative override
    });

    it('generates doorstep dynamic UPI QR and high-res Data URL', async () => {
      const req = new Request('https://saveraparadise.com/api/cashfree-generate-qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: '1003',
          amount: 350,
          customerName: 'Doorstep User'
        })
      });
      const res = await cashfreeGenerateQrHandler({ request: req, env: mockEnv });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.ok(data.upiIntentUri.startsWith('upi://pay?pa='));
      assert.ok(data.qrDataUrl.startsWith('data:image/png;base64,'));
    });

    it('strictly gates nighttime rider payout to Owner role and rejects Kitchen Admin', async () => {
      const adminToken = createAdminToken(3600000, 'admin', mockEnv);
      const req = new Request('https://saveraparadise.com/api/cashfree-payout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ riderPin: '1234', amount: 150 })
      });
      const res = await cashfreePayoutHandler({ request: req, env: mockEnv });
      assert.equal(res.status, 403);
    });

    it('permits nighttime rider payout when Executive Owner token is provided', async () => {
      const ownerToken = createAdminToken(3600000, 'owner', mockEnv);
      const req = new Request('https://saveraparadise.com/api/cashfree-payout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ownerToken}`
        },
        body: JSON.stringify({ riderPin: '1234', amount: 150, upiVpa: 'rider@upi' })
      });
      const res = await cashfreePayoutHandler({ request: req, env: mockEnv });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.amount, 150);
    });
  });

  describe('5. Multi-Account Cloudflare R2 S3-SigV4 Security & Endpoints', () => {
    it('verifies R2 configuration uses S3-compatible endpoints with separate account ID', () => {
      const cfg = getR2Config(mockEnv);
      assert.equal(cfg.HOST, 'account-a-id.r2.cloudflarestorage.com');
      assert.equal(cfg.BUCKET_NAME, 'savera-paradise-dishes');
      assert.equal(cfg.ACCESS_KEY_ID, 'test_r2_access_key');
      assert.equal(cfg.isConfigured, true);
    });

    it('builds canonical AWS SigV4 authorization headers correctly', () => {
      const { requestHeaders, fullUrl } = buildSigV4Headers({
        method: 'GET',
        canonicalUri: '/savera-paradise-dishes/dishes/dish_1.jpg',
        payloadHash: sha256Hex(''),
        env: mockEnv
      });
      assert.ok(requestHeaders.Authorization.startsWith('AWS4-HMAC-SHA256 Credential=test_r2_access_key/'));
      assert.ok(requestHeaders.Authorization.includes('SignedHeaders='));
      assert.ok(requestHeaders.Authorization.includes('Signature='));
      assert.equal(fullUrl, 'https://account-a-id.r2.cloudflarestorage.com/savera-paradise-dishes/dishes/dish_1.jpg');
    });

    it('rejects unauthenticated R2 upload requests with 401', async () => {
      const req = new Request('https://saveraparadise.com/api/r2-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0])
      });
      const res = await r2UploadHandler({ request: req, env: mockEnv });
      assert.equal(res.status, 401);
    });

    it('validates binary magic bytes and rejects spoofed MIME types on upload', async () => {
      const adminToken = createAdminToken(3600000, 'admin', mockEnv);
      const req = new Request('https://saveraparadise.com/api/r2-upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'image/jpeg',
          'Authorization': `Bearer ${adminToken}`
        },
        body: new Uint8Array([0x00, 0x01, 0x02, 0x03]) // Corrupted bytes
      });
      const res = await r2UploadHandler({ request: req, env: mockEnv });
      assert.equal(res.status, 415);
    });

    it('rejects path traversal attacks on R2 image proxy', async () => {
      const req = new Request('https://saveraparadise.com/api/r2-image?key=../../etc/passwd', {
        method: 'GET'
      });
      const res = await r2ImageHandler({ request: req, env: mockEnv });
      assert.equal(res.status, 400);
    });

    it('rejects keys outside dishes/ and categories/ on R2 image proxy', async () => {
      const req = new Request('https://saveraparadise.com/api/r2-image?key=secrets/credentials.json', {
        method: 'GET'
      });
      const res = await r2ImageHandler({ request: req, env: mockEnv });
      assert.equal(res.status, 400);
    });

    it('rejects path traversal attacks on R2 video stream proxy', async () => {
      const req = new Request('https://saveraparadise.com/api/r2-video?key=../secret.mp4', {
        method: 'GET'
      });
      const res = await r2VideoHandler({ request: req, env: mockEnv });
      assert.equal(res.status, 400);
    });

    it('rejects non-video file types on R2 video stream proxy', async () => {
      const req = new Request('https://saveraparadise.com/api/r2-video?key=videos/malware.exe', {
        method: 'GET'
      });
      const res = await r2VideoHandler({ request: req, env: mockEnv });
      assert.equal(res.status, 400);
    });

    it('requires admin token and blocks directory traversal on R2 delete proxy', async () => {
      const adminToken = createAdminToken(3600000, 'admin', mockEnv);
      const req = new Request('https://saveraparadise.com/api/r2-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ key: '../root/file.jpg' })
      });
      const res = await r2DeleteHandler({ request: req, env: mockEnv });
      assert.equal(res.status, 400);
    });
  });

  describe('6. Ola Maps Proxy & Edge Caching (/api/ola-maps)', () => {
    it('validates invalid tile coordinates with 400', async () => {
      const req = new Request('https://saveraparadise.com/api/ola-maps?action=tile&z=invalid&x=0&y=0', {
        method: 'GET'
      });
      const res = await olaMapsHandler({ request: req, env: mockEnv });
      assert.equal(res.status, 400);
    });

    it('validates bounding box bounds for reverse geocoding', async () => {
      const req = new Request('https://saveraparadise.com/api/ola-maps?action=reverse&lat=40.7128&lng=-74.0060', {
        method: 'GET' // New York coordinates far outside restaurant territory
      });
      const res = await olaMapsHandler({ request: req, env: { ...mockEnv, OLA_MAPS_API_KEY: 'mock_key' } });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.ok(data.error.includes('serviceable delivery region'));
    });
  });

});
