/**
 * Cloudflare Worker Entry Point for Savera Paradise
 * Supports Cloudflare Workers with Static Assets (npx wrangler deploy)
 * Routes /api/* requests to Pages Functions handlers, and all other traffic to env.ASSETS.
 */
import { onRequest as adminAuthHandler } from './functions/api/admin-auth.js';
import { onRequest as checkoutHandler } from './functions/api/checkout.js';
import { onRequest as cashfreeCreateOrderHandler } from './functions/api/cashfree-create-order.js';
import { onRequest as cashfreeGenerateQrHandler } from './functions/api/cashfree-generate-qr.js';
import { onRequest as cashfreePayoutHandler } from './functions/api/cashfree-payout.js';
import { onRequest as cashfreeWebhookHandler } from './functions/api/cashfree-webhook.js';
import { onRequest as olaMapsHandler } from './functions/api/ola-maps.js';
import { onRequest as r2UploadHandler } from './functions/api/r2-upload.js';
import { onRequest as r2ImageHandler } from './functions/api/r2-image.js';
import { onRequest as r2ListHandler } from './functions/api/r2-list.js';
import { onRequest as r2DeleteHandler } from './functions/api/r2-delete.js';
import { onRequest as r2VideoHandler } from './functions/api/r2-video.js';
import { onRequest as r2AudioHandler } from './functions/api/r2-audio.js';
import { onRequest as adminStoreHandler } from './functions/api/admin-store.js';
import { onRequest as orderActionHandler } from './functions/api/order-action.js';

const ROUTES = {
  '/api/admin-auth': adminAuthHandler,
  '/api/admin-store': adminStoreHandler,
  '/api/checkout': checkoutHandler,
  '/api/cashfree-create-order': cashfreeCreateOrderHandler,
  '/api/cashfree-generate-qr': cashfreeGenerateQrHandler,
  '/api/cashfree-payout': cashfreePayoutHandler,
  '/api/cashfree-webhook': cashfreeWebhookHandler,
  '/api/ola-maps': olaMapsHandler,
  '/api/order-action': orderActionHandler,
  '/api/r2-upload': r2UploadHandler,
  '/api/r2-image': r2ImageHandler,
  '/api/r2-list': r2ListHandler,
  '/api/r2-delete': r2DeleteHandler,
  '/api/r2-video': r2VideoHandler,
  '/api/r2-audio': r2AudioHandler
};

// Clean URL Aliases for Static Assets (Cloudflare Workers Static Assets does not evaluate _redirects)
const CUSTOM_REWRITES = {
  '/poster': '/qr-standee.html',
  '/rider-qr': '/rider-qr-standee.html',
  '/rider-apk': '/rider-qr-standee.html'
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    // 1. API Route Dispatching
    if (ROUTES[pathname]) {
      const handler = ROUTES[pathname];
      const context = {
        request,
        env,
        params: {},
        waitUntil: ctx?.waitUntil ? ctx.waitUntil.bind(ctx) : () => {},
        next: () => env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not Found', { status: 404 })
      };
      return handler(context);
    }

    // 2. Custom Clean URL Aliases (e.g. /poster -> /qr-standee.html)
    if (CUSTOM_REWRITES[pathname] && env.ASSETS) {
      const targetUrl = new URL(CUSTOM_REWRITES[pathname], url.origin);
      targetUrl.search = url.search;
      return env.ASSETS.fetch(new Request(targetUrl.toString(), request));
    }

    // 3. Static Assets Dispatching via Cloudflare ASSETS binding
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  }
};
