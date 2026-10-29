/**
 * Cloudflare R2 Integration Service
 * S3-compatible Object Storage for Savera Dish Photos & Menu Assets.
 * All privileged operations (upload, list, delete) route through serverless API endpoints (/api/r2-*)
 * so secret keys are never exposed in client-side JavaScript bundles.
 */

import { getAdminAuthHeaders, ensureAdminToken } from './securityUtils.js';

export const R2_CONFIG = {
  ENDPOINT: (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_R2_ENDPOINT) || '',
  HOST: (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_R2_HOST) || '',
  BUCKET_NAME: (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_R2_BUCKET) || '',
  REGION: (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_R2_REGION) || 'auto',
  SERVICE: 's3',
  PUBLIC_DOMAIN: (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_R2_PUBLIC_DOMAIN) || (typeof localStorage !== 'undefined' && localStorage.getItem('quickbite_r2_public_domain')) || ''
};

class CloudflareR2Service {
  constructor() {
    this.endpoint = R2_CONFIG.ENDPOINT;
    this.host = R2_CONFIG.HOST;
    this.bucket = R2_CONFIG.BUCKET_NAME;
    this.region = R2_CONFIG.REGION;
    this.service = R2_CONFIG.SERVICE;
    this.publicDomain = R2_CONFIG.PUBLIC_DOMAIN;
  }

  setPublicDomain(domain) {
    this.publicDomain = domain ? domain.trim().replace(/\/$/, '') : '';
    if (typeof localStorage !== 'undefined') {
      if (this.publicDomain) {
        localStorage.setItem('quickbite_r2_public_domain', this.publicDomain);
      } else {
        localStorage.removeItem('quickbite_r2_public_domain');
      }
    }
  }

  /**
   * Generates a public URL if PUBLIC_DOMAIN is configured.
   */
  async generatePresignedGetUrl(key) {
    if (this.publicDomain) {
      return `${this.publicDomain}/${encodeURIComponent(key).replace(/%2F/g, '/')}`;
    }
    return `https://${this.host}/${this.bucket}/${encodeURIComponent(key).replace(/%2F/g, '/')}`;
  }

  /**
   * Upload an image (File, Blob, or base64 Data URL) to Cloudflare R2 via authenticated server proxy
   * @param {File|Blob|string} fileOrDataUrl Image file or Base64 string
   * @param {string} originalFileName Original filename
   * @param {'dishes'|'categories'} folder Subfolder/prefix
   */
  async uploadImage(fileOrDataUrl, originalFileName = 'dish_image.jpg', folder = 'dishes') {
    let arrayBuffer;
    let mimeType = 'image/jpeg';
    let fileName = originalFileName;
    const isCategory = folder === 'categories' || originalFileName.toLowerCase().startsWith('category_');
    const folderName = isCategory ? 'categories' : 'dishes';
    const filePrefix = isCategory ? 'category_' : 'dish_';

    if (typeof fileOrDataUrl === 'string') {
      const arr = fileOrDataUrl.split(',');
      const mimeMatch = arr[0].match(/:(.*?);/);
      if (mimeMatch) mimeType = mimeMatch[1];
      const binaryString = atob(arr[1]);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      arrayBuffer = bytes.buffer;
      const ext = mimeType.split('/')[1] || 'jpg';
      fileName = `${filePrefix}${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${ext}`;
    } else {
      arrayBuffer = await fileOrDataUrl.arrayBuffer();
      mimeType = fileOrDataUrl.type || 'image/jpeg';
      const cleanName = (fileOrDataUrl.name || 'photo.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
      fileName = `${filePrefix}${Date.now()}_${cleanName}`;
    }

    const key = `${folderName}/${fileName}`;

    try {
      // Ensure we have a valid bearer token before dispatching
      let authHeaders = getAdminAuthHeaders();
      if (!authHeaders['Authorization']) {
        await ensureAdminToken();
        authHeaders = getAdminAuthHeaders();
      }

      let res = await fetch('/api/r2-upload', {
        method: 'POST',
        headers: {
          'Content-Type': mimeType,
          'x-filename': fileName,
          'x-key': key,
          ...authHeaders
        },
        body: arrayBuffer
      });

      // If unauthorized, attempt one token refresh and retry
      if (res.status === 401) {
        console.info('[R2] Session token expired or missing, auto-refreshing admin token...');
        const refreshedToken = await ensureAdminToken();
        if (refreshedToken) {
          res = await fetch('/api/r2-upload', {
            method: 'POST',
            headers: {
              'Content-Type': mimeType,
              'x-filename': fileName,
              'x-key': key,
              ...getAdminAuthHeaders()
            },
            body: arrayBuffer
          });
        }
      }

      if (res.ok) {
        const data = await res.json();
        if (data && data.url) {
          return {
            success: true,
            key: data.key || key,
            url: data.url
          };
        }
      } else {
        const errText = await res.text().catch(() => '');
        console.warn(`[R2] Upload responded with HTTP ${res.status}:`, errText);
      }
    } catch (proxyErr) {
      console.warn('[R2] Server proxy upload unavailable, using local IndexedDB image persistence:', proxyErr?.message || proxyErr);
    }

    return {
      success: false,
      key,
      url: null
    };
  }

  /**
   * List uploaded dish images stored in the R2 bucket via server proxy
   */
  async listImages(prefix = 'dishes/') {
    try {
      await ensureAdminToken();
      let response = await fetch(`/api/r2-list?prefix=${encodeURIComponent(prefix)}`, {
        headers: {
          ...getAdminAuthHeaders()
        }
      });
      if (response.status === 401) {
        try { sessionStorage.removeItem('quickbite_admin_token'); } catch {}
        const refreshed = await ensureAdminToken();
        if (refreshed) {
          response = await fetch(`/api/r2-list?prefix=${encodeURIComponent(prefix)}`, {
            headers: { ...getAdminAuthHeaders() }
          });
        }
      }
      if (!response.ok) return [];
      const data = await response.json();
      return data.files || data.items || [];
    } catch (e) {
      console.warn('[Cloudflare R2] List error:', e.message);
      return [];
    }
  }

  /**
   * Delete an image from Cloudflare R2 bucket by key or proxy URL
   * @param {string} keyOrUrl - Object key or proxy URL
   * @returns {Promise<boolean>}
   */
  async deleteImage(keyOrUrl) {
    if (!keyOrUrl) return false;
    try {
      let key = keyOrUrl;
      if (keyOrUrl.includes('?key=')) {
        const urlObj = new URL(keyOrUrl, window.location.origin);
        key = urlObj.searchParams.get('key') || keyOrUrl;
      }

      await ensureAdminToken();
      let response = await fetch('/api/r2-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAdminAuthHeaders()
        },
        body: JSON.stringify({ key })
      });
      if (response.status === 401) {
        try { sessionStorage.removeItem('quickbite_admin_token'); } catch {}
        const refreshed = await ensureAdminToken();
        if (refreshed) {
          response = await fetch('/api/r2-delete', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...getAdminAuthHeaders()
            },
            body: JSON.stringify({ key })
          });
        }
      }
      return response.ok;
    } catch (e) {
      console.warn('[Cloudflare R2] Delete error:', e.message);
      return false;
    }
  }
}

export const cloudflareR2Service = new CloudflareR2Service();
