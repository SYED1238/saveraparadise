import { createClient } from '@supabase/supabase-js';

const FALLBACK_URL = 'https://your-project.supabase.co';
const FALLBACK_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.placeholder';

let envUrl = '';
let envKey = '';

try {
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    // Strictly scope client environment variables to VITE_ prefix
    envUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim();
    envKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
  }
  if (!envUrl && typeof process !== 'undefined' && process.env) {
    envUrl = (process.env.VITE_SUPABASE_URL || '').trim();
    envKey = (process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  }
} catch (e) {
  console.warn('[SupabaseClient] Could not read environment variables:', e);
}

// Strictly validate URL format and security (HTTPS only, valid hostname)
function sanitizeSupabaseUrl(url) {
  if (!url || typeof url !== 'string') return FALLBACK_URL;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return FALLBACK_URL;
    return parsed.origin;
  } catch {
    return FALLBACK_URL;
  }
}

export const SUPABASE_URL = sanitizeSupabaseUrl(envUrl);
export const SUPABASE_ANON_KEY = (envKey && envKey.trim().length > 15) ? envKey.trim() : FALLBACK_ANON_KEY;

const isBrowser = typeof window !== 'undefined';

let client;
try {
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: isBrowser,
      autoRefreshToken: isBrowser,
      detectSessionInUrl: isBrowser
    }
  });
} catch (err) {
  console.warn('[SupabaseClient] Failed to initialize with custom credentials, falling back to defaults:', err);
  client = createClient(FALLBACK_URL, FALLBACK_ANON_KEY, {
    auth: {
      persistSession: isBrowser,
      autoRefreshToken: isBrowser,
      detectSessionInUrl: isBrowser
    }
  });
}

export const supabase = client;
