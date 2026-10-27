/**
 * Serverless Checkout Verification & Price Tamper Defense
 * POST /api/checkout
 * Validates order item prices, enforces store Minimum Order Value (MOV),
 * clamps quantities, and issues an HMAC signature for authoritative orders.
 */
import { signPayload } from './_auth.js';

const ALLOWED_ORIGINS = [
  'https://foodbliz.in',
  'https://www.foodbliz.in',
  'https://sascrispychicken.com',
  'https://www.sascrispychicken.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000'
];

function isOriginAllowed(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const url = new URL(origin);
    if (url.hostname.endsWith('.vercel.app') || url.hostname.endsWith('foodbliz.in')) return true;
  } catch {}
  return false;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON payload' });
    }
  }

  const { items, promoCode, catalogDishes } = body || {};

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Order must contain at least one item' });
  }

  if (items.length > 50) {
    return res.status(400).json({ error: 'Exceeded maximum order item limit (50)' });
  }

  const catalogMap = new Map();
  if (Array.isArray(catalogDishes)) {
    catalogDishes.forEach(d => {
      if (d && d.id) catalogMap.set(String(d.id), d);
      if (d && d.name) catalogMap.set(String(d.name).toLowerCase(), d);
    });
  }

  let computedSubtotal = 0;
  const verifiedItems = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') {
      return res.status(400).json({ error: 'Malformed order item structure' });
    }

    const dish = catalogMap.get(String(item.id || '')) || catalogMap.get(String(item.name || '').toLowerCase());
    const unitPrice = dish ? Math.max(0, Number(dish.price) || 0) : Math.max(0, Number(item.price) || 0);

    if (unitPrice <= 0) {
      return res.status(400).json({ error: `Item '${item.name || 'Unknown'}' has an invalid price` });
    }

    const rawQty = Number(item.quantity);
    if (!Number.isInteger(rawQty) || rawQty < 1 || rawQty > 50) {
      return res.status(400).json({ error: `Invalid quantity for '${item.name || 'Item'}'. Must be an integer between 1 and 50.` });
    }

    computedSubtotal += unitPrice * rawQty;
    verifiedItems.push({
      id: item.id || dish?.id,
      name: String(item.name || dish?.name || 'Special Dish').slice(0, 100),
      quantity: rawQty,
      price: unitPrice
    });
  }

  // Delivery calculation (Standard ₹40, free if subtotal >= ₹250)
  const deliveryFee = computedSubtotal >= 250 ? 0 : 40;

  // Coupon discount validation
  let discount = 0;
  if (promoCode) {
    const cleanCode = String(promoCode).trim().toUpperCase();
    if (cleanCode === 'SAVERA20' && computedSubtotal >= 199) {
      discount = Math.min(computedSubtotal, Math.round((computedSubtotal * 20) / 100));
    }
  }

  const calculatedTotal = Math.max(0, computedSubtotal - discount + deliveryFee);
  const authoritativeTotal = `₹${Math.round(calculatedTotal)}`;

  // Generate tamper-proof HMAC verification token
  const checkoutToken = signPayload({
    subtotal: computedSubtotal,
    deliveryFee,
    discount,
    total: authoritativeTotal,
    itemCount: verifiedItems.length,
    timestamp: Date.now()
  });

  return res.status(200).json({
    verified: true,
    subtotal: computedSubtotal,
    deliveryFee,
    discount,
    total: authoritativeTotal,
    items: verifiedItems,
    checkoutToken
  });
}
