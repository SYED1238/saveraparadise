import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import {
  RIDER_APK_DOWNLOAD_URL,
  RIDER_QR_OPTIONS
} from '../scripts/generate_rider_qr.js';

const ROOT_DIR = path.resolve(process.cwd());
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

describe('PERMANENT RIDER APK QR & ROUTING SUITE', () => {
  it('1. Permanent Rider APK binary exists at public/apk/Savera-Paradise-Rider.apk and CI workflow keeps it updated', () => {
    const apkPath = path.join(PUBLIC_DIR, 'apk', 'Savera-Paradise-Rider.apk');
    assert.ok(fs.existsSync(apkPath), 'public/apk/Savera-Paradise-Rider.apk must exist');
    const stat = fs.statSync(apkPath);
    assert.ok(stat.size > 100000, 'Rider APK binary must be non-empty');

    const workflowPath = path.join(ROOT_DIR, '.github', 'workflows', 'build-apk.yml');
    const workflow = fs.readFileSync(workflowPath, 'utf8');
    assert.ok(
      workflow.includes('public/apk/Savera-Paradise-Rider.apk'),
      'CI workflow must update public/apk/Savera-Paradise-Rider.apk in place so QR link stays permanent'
    );
  });

  it('2. Permanent QR SVG encodes the exact permanent Rider APK download URL with High (H) error correction', async () => {
    assert.equal(RIDER_APK_DOWNLOAD_URL, 'https://saveraparadise.foodbliz.in/apk/Savera-Paradise-Rider.apk');
    const svgPath = path.join(PUBLIC_DIR, 'savera-rider-apk-qr.svg');
    assert.ok(fs.existsSync(svgPath), 'public/savera-rider-apk-qr.svg must exist');

    const actualSvg = fs.readFileSync(svgPath, 'utf8');
    const expectedSvg = await QRCode.toString(RIDER_APK_DOWNLOAD_URL, {
      ...RIDER_QR_OPTIONS,
      type: 'svg'
    });
    assert.equal(actualSvg, expectedSvg, 'SVG QR file must match QRCode encoding of the permanent Rider APK URL');
  });

  it('3. High-Res (~2048px) PNG QR asset exists and has valid square PNG dimensions', () => {
    const pngPath = path.join(PUBLIC_DIR, 'savera-rider-apk-qr.png');
    assert.ok(fs.existsSync(pngPath), 'public/savera-rider-apk-qr.png must exist');
    const buf = fs.readFileSync(pngPath);
    // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
    assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // IHDR width & height at bytes 16..24
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    assert.equal(width, height, 'QR PNG must be square');
    assert.ok(width >= 2000 && width <= 2048, `Expected high-res QR PNG >= 2000px, got ${width}px`);
  });

  it('4. Printable Rider QR Poster page links QR SVG, PNG download, direct APK download, and permanent URL', () => {
    const htmlPath = path.join(PUBLIC_DIR, 'rider-qr-standee.html');
    assert.ok(fs.existsSync(htmlPath), 'public/rider-qr-standee.html must exist');
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.ok(html.includes('/savera-rider-apk-qr.svg'));
    assert.ok(html.includes('/savera-rider-apk-qr.png'));
    assert.ok(html.includes('/apk/Savera-Paradise-Rider.apk'));
    assert.ok(html.includes(RIDER_APK_DOWNLOAD_URL));
  });

  it('5. Edge worker.js, wrangler.toml, _redirects, vite.config.js, and vercel.json route /rider-qr and /rider-apk cleanly', async () => {
    const workerModule = (await import('../worker.js')).default;
    for (const route of ['/rider-qr', '/rider-apk']) {
      let fetchedUrl = null;
      const res = await workerModule.fetch(
        new Request(`https://saveraparadise.foodbliz.in${route}`, { method: 'GET' }),
        {
          ASSETS: {
            fetch: async (req) => {
              fetchedUrl = req.url;
              return new Response('Rider QR Poster', { status: 200 });
            }
          }
        }
      );
      assert.equal(res.status, 200);
      assert.equal(new URL(fetchedUrl).pathname, '/rider-qr-standee.html');
    }

    const wranglerToml = fs.readFileSync(path.join(ROOT_DIR, 'wrangler.toml'), 'utf8');
    assert.ok(wranglerToml.includes('"/rider-qr"'));
    assert.ok(wranglerToml.includes('"/rider-apk"'));

    const redirects = fs.readFileSync(path.join(PUBLIC_DIR, '_redirects'), 'utf8');
    assert.match(redirects, /\/rider-qr\s+\/rider-qr-standee\.html\s+200/);
    assert.match(redirects, /\/rider-apk\s+\/rider-qr-standee\.html\s+200/);

    const viteConfig = fs.readFileSync(path.join(ROOT_DIR, 'vite.config.js'), 'utf8');
    assert.ok(viteConfig.includes("'/rider-qr': '/rider-qr-standee.html'"));

    const vercelJson = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'vercel.json'), 'utf8'));
    assert.ok(vercelJson.rewrites.some(r => r.source === '/rider-qr' && r.destination === '/rider-qr-standee.html'));
  });

  it('6. _headers, _routes.json, and sw.js serve /apk/*.apk with attachment headers and zero SW cache interference', () => {
    const headers = fs.readFileSync(path.join(PUBLIC_DIR, '_headers'), 'utf8');
    assert.ok(headers.includes('/apk/*.apk'));
    assert.ok(headers.includes('Content-Type: application/vnd.android.package-archive'));
    assert.ok(headers.includes('Content-Disposition: attachment'));
    assert.ok(headers.includes('Cache-Control: no-cache, must-revalidate'));

    const routes = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, '_routes.json'), 'utf8'));
    assert.ok(routes.exclude.includes('/apk/*'));

    const swJs = fs.readFileSync(path.join(PUBLIC_DIR, 'sw.js'), 'utf8');
    assert.ok(swJs.includes("url.pathname.startsWith('/apk/')"));
  });

  it('7. Owner Portal Fleet Management links to /rider-qr for instant rider onboarding', () => {
    const ownerHtml = fs.readFileSync(path.join(ROOT_DIR, 'owner.html'), 'utf8');
    assert.ok(ownerHtml.includes('id="btn-owner-rider-qr"'));
    assert.ok(ownerHtml.includes('href="/rider-qr"'));
  });
});
