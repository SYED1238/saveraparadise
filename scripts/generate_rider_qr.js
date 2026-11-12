import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const RIDER_APK_DOWNLOAD_URL = 'https://saveraparadise.foodbliz.in/apk/Savera-Paradise-Rider.apk';
export const RIDER_QR_OPTIONS = {
  errorCorrectionLevel: 'H',
  margin: 2,
  color: {
    dark: '#111827',
    light: '#FFFFFF'
  }
};

export function buildRiderStandeeHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Savera Paradise Rider — Permanent APK Download QR</title>
  <link rel="icon" type="image/x-icon" href="/favicon-rider.ico">
  <link rel="icon" type="image/svg+xml" href="/icon-rider-192.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: #071310;
      color: #FFF;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
    }
    .print-actions {
      margin-bottom: 24px;
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 10px;
      max-width: 680px;
    }
    .btn {
      background: #059669;
      color: #FFF;
      border: none;
      padding: 11px 20px;
      border-radius: 999px;
      font-family: inherit;
      font-size: 0.92rem;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 4px 14px rgba(5, 150, 105, 0.4);
      transition: transform 0.2s, background 0.2s;
      text-decoration: none;
    }
    .btn:hover {
      transform: translateY(-2px);
      background: #047857;
    }
    .btn-secondary {
      background: #162420;
      box-shadow: none;
      color: #E2E8F0;
      border: 1px solid #263E36;
    }
    .btn-secondary:hover {
      background: #1F332D;
    }
    .standee-card {
      width: 100%;
      max-width: 440px;
      background: #0D1B17;
      border: 2px solid #1C382F;
      border-radius: 28px;
      padding: 32px 26px;
      text-align: center;
      box-shadow: 0 24px 48px rgba(0, 0, 0, 0.65);
      position: relative;
      overflow: hidden;
    }
    .standee-card::before {
      content: '';
      position: absolute;
      top: -120px;
      left: 50%;
      transform: translateX(-50%);
      width: 280px;
      height: 280px;
      background: radial-gradient(circle, rgba(16, 185, 129, 0.22) 0%, transparent 70%);
      pointer-events: none;
    }
    .brand-logo-wrap {
      width: 64px;
      height: 64px;
      margin: 0 auto 10px;
      background: #FFFFFF;
      border-radius: 50%;
      padding: 4px;
      box-shadow: 0 6px 20px rgba(16, 185, 129, 0.35);
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      z-index: 1;
    }
    .brand-logo-wrap img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      border-radius: 50%;
    }
    .brand-title {
      font-size: 1.5rem;
      font-weight: 900;
      letter-spacing: -0.5px;
      background: linear-gradient(135deg, #FFF 0%, #A7F3D0 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 4px;
      text-transform: uppercase;
      position: relative;
      z-index: 1;
    }
    .brand-subtitle {
      font-size: 0.78rem;
      color: #6EE7B7;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.8px;
      margin-bottom: 20px;
      position: relative;
      z-index: 1;
    }
    .qr-frame {
      background: #FFFFFF;
      padding: 16px;
      border-radius: 20px;
      display: inline-block;
      margin-bottom: 18px;
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);
      position: relative;
      z-index: 1;
    }
    .qr-frame img {
      width: 240px;
      height: 240px;
      display: block;
    }
    .scan-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(16, 185, 129, 0.16);
      color: #34D399;
      border: 1px solid rgba(16, 185, 129, 0.35);
      padding: 6px 14px;
      border-radius: 999px;
      font-size: 0.78rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.9px;
      margin-bottom: 12px;
    }
    .standee-headline {
      font-size: 1.22rem;
      font-weight: 800;
      margin-bottom: 6px;
    }
    .standee-desc {
      font-size: 0.85rem;
      color: #9CA3AF;
      line-height: 1.45;
      margin-bottom: 16px;
    }
    .install-steps {
      text-align: left;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid #1C382F;
      border-radius: 14px;
      padding: 12px 14px;
      margin-bottom: 16px;
      font-size: 0.78rem;
      color: #D1D5DB;
      line-height: 1.5;
    }
    .install-steps strong {
      color: #FFFFFF;
    }
    .install-steps ol {
      padding-left: 18px;
    }
    .install-steps li + li {
      margin-top: 4px;
    }
    .features-row {
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
      gap: 10px;
      padding-top: 14px;
      border-top: 1px dashed #1C382F;
      font-size: 0.74rem;
      color: #D1FAE5;
      font-weight: 600;
    }
    .domain-pill {
      margin-top: 14px;
      background: #071310;
      border: 1px solid #1C382F;
      padding: 8px 14px;
      border-radius: 12px;
      font-size: 0.72rem;
      color: #34D399;
      font-weight: 700;
      display: inline-block;
      word-break: break-all;
    }
    .permanent-note {
      margin-top: 10px;
      font-size: 0.72rem;
      color: #9CA3AF;
    }

    @media print {
      body {
        background: #FFF;
        color: #000;
        padding: 0;
      }
      .print-actions {
        display: none !important;
      }
      .standee-card {
        box-shadow: none;
        border: 2px solid #000;
        background: #FFF;
        color: #000;
        max-width: 100%;
        page-break-inside: avoid;
      }
      .brand-title {
        color: #000 !important;
        -webkit-text-fill-color: #000 !important;
      }
      .brand-subtitle, .standee-desc, .features-row, .permanent-note {
        color: #333 !important;
      }
      .scan-badge {
        background: #EEE !important;
        color: #000 !important;
        border: 1px solid #000 !important;
      }
      .install-steps {
        background: #F9FAFB !important;
        border: 1px solid #CCC !important;
        color: #111 !important;
      }
      .install-steps strong {
        color: #000 !important;
      }
      .domain-pill {
        background: #F4F4F4 !important;
        border: 1px solid #CCC !important;
        color: #000 !important;
      }
    }
  </style>
</head>
<body>

  <div class="print-actions">
    <button type="button" class="btn" id="btn-print-rider-qr">
      🖨️ Print Rider QR Poster
    </button>
    <a class="btn btn-secondary" href="/savera-rider-apk-qr.png" download="savera-paradise-rider-apk-qr-2048px.png">
      ⬇️ Download QR PNG (2048px)
    </a>
    <button type="button" class="btn btn-secondary" id="btn-copy-apk-link">
      📋 Copy Permanent APK Link
    </button>
    <a class="btn btn-secondary" href="/apk/Savera-Paradise-Rider.apk" download="Savera-Paradise-Rider.apk">
      📱 Download Rider APK
    </a>
  </div>

  <div class="standee-card">
    <div class="brand-logo-wrap">
      <img src="/rider-logo.png" alt="Savera Paradise Rider">
    </div>
    <div class="brand-title">SAVERA PARADISE RIDER</div>
    <div class="brand-subtitle">Official Delivery Partner Android App</div>

    <div class="qr-frame">
      <img src="/savera-rider-apk-qr.svg" alt="Permanent QR Code to Download Savera Paradise Rider APK">
    </div>

    <div>
      <div class="scan-badge">📲 SCAN CAMERA TO DOWNLOAD APK</div>
      <div class="standee-headline">Install Rider App on Android</div>
      <div class="standee-desc">
        Scan with your Android phone camera to download the latest Savera Paradise Rider APK directly.
      </div>
    </div>

    <div class="install-steps">
      <ol>
        <li>Open your phone <strong>Camera</strong> or <strong>Google Lens</strong> and point at this QR code.</li>
        <li>Tap the link, then tap <strong>Download anyway</strong> if Chrome asks to confirm.</li>
        <li>Tap <strong>Open</strong> &rarr; allow <strong>Install unknown apps</strong> &rarr; tap <strong>Install</strong>, then log in with your 4-digit Rider PIN.</li>
      </ol>
    </div>

    <div class="features-row">
      <span>📦 Bag PIN Pickup</span>
      <span>•</span>
      <span>🗺️ Live Doorstep GPS</span>
      <span>•</span>
      <span>💳 Doorstep UPI QR</span>
    </div>

    <div class="domain-pill">
      🔗 ${RIDER_APK_DOWNLOAD_URL}
    </div>
    <div class="permanent-note">
      Permanent QR • Always downloads the latest Rider APK build
    </div>
  </div>

  <script>
    document.getElementById('btn-print-rider-qr')?.addEventListener('click', function() {
      window.print();
    });
    document.getElementById('btn-copy-apk-link')?.addEventListener('click', async function() {
      const btn = this;
      const url = '${RIDER_APK_DOWNLOAD_URL}';
      try {
        await navigator.clipboard.writeText(url);
        btn.textContent = '✅ Link Copied!';
      } catch {
        window.prompt('Copy permanent Rider APK link:', url);
      }
      setTimeout(function() {
        btn.textContent = '📋 Copy Permanent APK Link';
      }, 2200);
    });
  </script>

</body>
</html>`;
}

export async function generateRiderQrAssets({
  publicDir = path.resolve(__dirname, '../public'),
  artifactDir = process.env.QR_ARTIFACT_DIR || ''
} = {}) {
  console.log(`Generating permanent Rider APK QR codes for: ${RIDER_APK_DOWNLOAD_URL}`);

  const svgString = await QRCode.toString(RIDER_APK_DOWNLOAD_URL, {
    ...RIDER_QR_OPTIONS,
    type: 'svg'
  });

  const svgPath = path.join(publicDir, 'savera-rider-apk-qr.svg');
  fs.writeFileSync(svgPath, svgString, 'utf8');
  console.log(`✓ Vector SVG QR generated: ${svgPath}`);

  const pngPath = path.join(publicDir, 'savera-rider-apk-qr.png');
  await QRCode.toFile(pngPath, RIDER_APK_DOWNLOAD_URL, {
    ...RIDER_QR_OPTIONS,
    type: 'png',
    width: 2048
  });
  console.log(`✓ Ultra High-Res PNG (2048x2048) generated: ${pngPath}`);

  if (artifactDir && fs.existsSync(artifactDir)) {
    fs.copyFileSync(svgPath, path.join(artifactDir, 'savera_rider_apk_qr.svg'));
    fs.copyFileSync(pngPath, path.join(artifactDir, 'savera_rider_apk_qr.png'));
    console.log(`✓ Copied Rider APK QR assets to artifact directory: ${artifactDir}`);
  }

  const standeePath = path.join(publicDir, 'rider-qr-standee.html');
  fs.writeFileSync(standeePath, buildRiderStandeeHtml(), 'utf8');
  console.log(`✓ Print-Ready Rider QR Poster generated: ${standeePath}`);

  return { svgPath, pngPath, standeePath, targetUrl: RIDER_APK_DOWNLOAD_URL };
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectExecution) {
  generateRiderQrAssets().catch((err) => {
    console.error('Failed to generate Rider APK QR codes:', err);
    process.exit(1);
  });
}
