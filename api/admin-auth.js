/**
 * Serverless Admin Authentication Endpoint
 * POST /api/admin-auth
 * Validates the manager PIN against server-side configuration and issues
 * a cryptographically signed HMAC bearer token for privileged operations.
 */
import { verifyAdminPin, createAdminToken } from './_auth.js';

// Simple in-memory rate limiting against brute-force guessing
const FAILED_ATTEMPTS = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(ip) {
  const now = Date.now();
  const record = FAILED_ATTEMPTS.get(ip);
  if (!record) return true;

  if (now - record.firstAttempt > LOCKOUT_WINDOW_MS) {
    FAILED_ATTEMPTS.delete(ip);
    return true;
  }

  return record.count < MAX_ATTEMPTS;
}

function recordFailedAttempt(ip) {
  const now = Date.now();
  const record = FAILED_ATTEMPTS.get(ip) || { count: 0, firstAttempt: now };
  record.count += 1;
  FAILED_ATTEMPTS.set(ip, record);
}

function clearRateLimit(ip) {
  FAILED_ATTEMPTS.delete(ip);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  const clientIp = typeof rawIp === 'string' ? rawIp.split(',')[0].trim() : 'unknown';

  if (!checkRateLimit(clientIp)) {
    return res.status(429).json({
      error: 'Too many failed passcode attempts. Please try again in 15 minutes.'
    });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  const pin = body?.pin;
  if (!pin || typeof pin !== 'string') {
    return res.status(400).json({ error: 'Passcode is required' });
  }

  const isValid = verifyAdminPin(pin);
  if (!isValid) {
    recordFailedAttempt(clientIp);
    return res.status(401).json({ error: 'Invalid manager passcode' });
  }

  clearRateLimit(clientIp);
  const token = createAdminToken();

  return res.status(200).json({
    success: true,
    token,
    role: 'admin',
    expiresIn: 43200 // 12 hours in seconds
  });
}
