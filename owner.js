// ==============================================================
// SAVERA PARADISE — OWNER EXECUTIVE PORTAL JAVASCRIPT
// Read-Only Live Analytics, Financial Audits, Fleet KMs & Payouts
// ==============================================================

import { dataService, extractPhoneFromOrder, cleanDeliveryAddress, formatDisplayOrderId, DEFAULT_PAYOUT_CONFIG } from './dataService.js';
import {
  escapeHtml,
  sanitizePhone,
  hashPasscode,
  DEFAULT_OWNER_PIN_HASH,
  isStaffSessionActive,
  setStaffSessionActive,
  clearStaffSession,
  ensureAdminToken
} from './securityUtils.js';
import {
  showSamsungToast,
  playNotificationSound,
  sendSystemNotification,
  flashTabTitle,
  triggerDeviceVibration,
  requestSystemNotificationPermission,
  getSystemNotificationPermission,
  isSoundEnabled,
  setSoundEnabled
} from './notificationService.js';

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  return showSamsungToast(message, type, {
    container,
    appName: 'Owner Portal',
    duration: 3800
  });
}

export function formatInr(val) {
  const n = Number(val);
  return isNaN(n) ? '0' : n.toLocaleString('en-IN');
}

export function getRiderInitial(name) {
  if (!name || typeof name === 'object') return 'R';
  const str = String(name).trim();
  const first = str.charAt(0).toUpperCase();
  return /^[A-Z0-9]$/i.test(first) ? first : 'R';
}

// --- STATE MANAGEMENT ---
let currentPeriod = 'today'; // 'today' | 'yesterday' | 'week' | 'month' | 'all' | 'custom'
let customStartDate = null;
let customEndDate = null;
let orderStatusFilter = 'all'; // 'all' | 'active' | 'delivered' | 'cash' | 'online' | 'cancelled'
let searchQuery = '';
let riderPayoutRate = 35; // ₹35 default per delivered order
let enteredPin = '';
let isOwnerAuthenticated = false;
let activeView = 'view-overview'; // 'view-overview' | 'view-orders' | 'view-cash' | 'view-payouts' | 'view-fleet' | 'view-reports'
let ownerOrdersPage = 1;
const OWNER_ORDERS_PER_PAGE = 25;
let isPayoutSettingsOpen = false;

// --- CALENDAR & HISTORICAL AUDIT STATE ---
let calCurrentYear = new Date().getFullYear();
let calCurrentMonth = new Date().getMonth(); // 0 - 11
let calMode = 'single'; // 'single' | 'range'
let calSelectedDate = new Date();
let calRangeStart = new Date();
let calRangeEnd = new Date();
let reportOrderSearchQuery = '';
let reportStatusFilter = 'all';

// ==============================================================
// In-flight payout lock tracking to prevent race conditions during 15s polls
const activeInFlightPayoutPins = new Set();

// Client-side brute-force lockout tracking for Owner PIN keypad
let ownerFailedAttempts = 0;
let ownerLockoutUntil = 0;

/**
 * Standardized predicate to determine whether an order is paid online
 * across all Owner views (Overview, Fleet, Orders, Invoices, CSV, Payouts).
 */
export function isOnlineOrderPayment(order) {
  if (!order) return false;
  if (order.doorstepUpi === true || order.doorstep_upi === true) return true;
  if (order.isPaidOnline === true || order.is_paid_online === true) return true;
  const pm = String(order.paymentMethod || order.payment_method || '').toLowerCase();
  return pm.includes('online') || pm.includes('upi') || pm.includes('card') || pm.includes('prepaid');
}

/**
 * Validates whether an active owner session exists with a cryptographically valid token.
 */
function isOwnerSessionValid() {
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost' && new URLSearchParams(window.location.search).has('preview')) {
    return true;
  }
  if (!isStaffSessionActive('owner')) return false;
  if (typeof sessionStorage === 'undefined') return false;
  const token = sessionStorage.getItem('quickbite_owner_token') || sessionStorage.getItem('quickbite_admin_token');
  if (!token || !token.includes('.')) return false;
  try {
    const parts = token.split('.');
    if (parts.length === 2) {
      const base64 = parts[0].replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
      const payload = JSON.parse(json);
      if (payload.role === 'owner' && payload.exp && (payload.exp - Date.now() > 0)) {
        return true;
      }
    }
  } catch {}
  return false;
}

// 1. DOM INITIALIZATION
// ==============================================================
if (typeof document !== 'undefined') {
  const initOwnerApp = async () => {
  initClock();
  initPasscodeLock();
  initPeriodFilters();
  initOrdersFilterControls();
  initNavigation();
  initActions();
  initCalendarReportsView();

  // Check existing session using cryptographic token and expiry validation
  if (isOwnerSessionValid()) {
    const isPreview = window.location.hostname === 'localhost' && new URLSearchParams(window.location.search).has('preview');
    const existingRiders = (function() {
      try {
        const raw = localStorage.getItem('quickbite_riders');
        return raw ? JSON.parse(raw) : [];
      } catch { return []; }
    })();

    if (isPreview && (dataService.getOrders().length === 0 || existingRiders.length > 4)) {
      try {
        const now = new Date().toISOString();
        const mockRiders = [
          { pin: '2233', name: 'Zaid Khan', phone: '+91 98451 22334', vehicle: '🏍️ Honda Activa 6G', avatar: '🏍️', status: 'online' },
          { pin: '4422', name: 'Tanveer Ahmed', phone: '+91 97777 66666', vehicle: '🏍️ Bajaj Pulsar 150', avatar: '🏍️', status: 'online' },
          { pin: '4455', name: 'Salman Ahmed', phone: '+91 96666 55555', vehicle: '🛵 TVS Jupiter', avatar: '🛵', status: 'online' },
          { pin: '8811', name: 'Arif Khan', phone: '+91 95555 44444', vehicle: '⚡ Ather 450X EV', avatar: '⚡', status: 'online' }
        ];
        const mockOrders = [
          {
            id: 'ord_preview_1',
            cleanId: '#QB-1042',
            createdAt: now,
            customerName: 'Rahul Sharma',
            phone: '9876543210',
            deliveryAddress: 'MG Road, Near Old Bus Stand, Ramanagara',
            addressDetails: { distanceKm: 1.8 },
            items: [{ name: 'Chicken Biryani Full', quantity: 2, price: 320 }, { name: 'Mughlai Chicken Curry', quantity: 1, price: 280 }],
            total: 920,
            paymentMethod: 'COD',
            status: 'delivered',
            assignedRiderPin: '2233',
            assignedRiderName: 'Zaid Khan'
          },
          {
            id: 'ord_preview_2',
            cleanId: '#QB-1043',
            createdAt: now,
            customerName: 'Priya Reddy',
            phone: '9876543212',
            deliveryAddress: 'Ijoor Circle, BM Road, Ramanagara',
            addressDetails: { distanceKm: 2.4 },
            items: [{ name: 'Butter Naan', quantity: 4, price: 40 }, { name: 'Paneer Butter Masala', quantity: 1, price: 240 }],
            total: 400,
            paymentMethod: 'Online UPI',
            isPaidOnline: true,
            status: 'delivered',
            assignedRiderPin: '2233',
            assignedRiderName: 'Zaid Khan'
          },
          {
            id: 'ord_preview_3',
            cleanId: '#QB-1044',
            createdAt: now,
            customerName: 'Mohammed Zeeshan',
            phone: '9876543213',
            deliveryAddress: 'Railway Colony, Near Old Station, Ramanagara',
            addressDetails: { distanceKm: 1.2 },
            items: [{ name: 'Chicken 65', quantity: 1, price: 260 }],
            total: 260,
            paymentMethod: 'COD',
            status: 'cooking',
            assignedRiderPin: '4422',
            assignedRiderName: 'Tanveer Ahmed'
          }
        ];
        localStorage.setItem('quickbite_orders', JSON.stringify(mockOrders));
        localStorage.setItem('quickbite_riders', JSON.stringify(mockRiders));
      } catch (e) {
        console.warn('Preview mock setup:', e);
      }
    }
    unlockOwnerPortal();
  } else {
    showPasscodeLock();
  }

  // Realtime listeners (DataService heartbeat provides graceful 60s fallback without slamming Supabase)
  if (typeof dataService.on === 'function') {
    dataService.on('orders', () => renderDashboard());
    dataService.on('riders', () => renderDashboard());
    dataService.on('cash_settled', () => renderDashboard());
  }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOwnerApp);
  } else {
    initOwnerApp();
  }
}

// ==============================================================
// 2. PASSCODE LOCK & AUTHENTICATION
// ==============================================================
function initPasscodeLock() {
  const lockOverlay = document.getElementById('owner-lock-overlay');
  const keypad = document.getElementById('owner-keypad');

  if (keypad) {
    keypad.addEventListener('click', (e) => {
      const btn = e.target.closest('.keypad-btn');
      if (!btn) return;

      const key = btn.getAttribute('data-key');
      handlePinInput(key);
    });
  }

  // Keyboard support
  window.addEventListener('keydown', (e) => {
    if (isOwnerAuthenticated) return;

    if (e.key >= '0' && e.key <= '9') {
      handlePinInput(e.key);
    } else if (e.key === 'Backspace') {
      handlePinInput('backspace');
    } else if (e.key === 'Escape' || e.key.toLowerCase() === 'c') {
      handlePinInput('clear');
    }
  });
}

function handlePinInput(key) {
  if (ownerLockoutUntil > Date.now()) {
    const remainingSecs = Math.ceil((ownerLockoutUntil - Date.now()) / 1000);
    const errorEl = document.getElementById('owner-lock-error');
    if (errorEl) {
      errorEl.style.display = 'block';
      errorEl.textContent = `⏳ Security Lockout: Too many failed attempts. Please wait ${remainingSecs}s.`;
    }
    return;
  }

  const errorEl = document.getElementById('owner-lock-error');
  if (errorEl) errorEl.style.display = 'none';

  if (key === 'clear') {
    enteredPin = '';
  } else if (key === 'backspace') {
    enteredPin = enteredPin.slice(0, -1);
  } else if (/^\d$/.test(key)) {
    if (enteredPin.length < 4) {
      enteredPin += key;
    }
  }

  updatePinDots();

  if (enteredPin.length === 4) {
    verifyOwnerPin(enteredPin);
  }
}

function updatePinDots() {
  const dots = document.querySelectorAll('#owner-pin-display .lock-pin-dot');
  dots.forEach((dot, idx) => {
    if (idx < enteredPin.length) {
      dot.classList.add('filled');
    } else {
      dot.classList.remove('filled');
    }
  });
}

async function verifyOwnerPin(pin) {
  const cleanPin = String(pin || '').trim();
  if (!cleanPin) return;

  const settings = dataService.getSettings();
  const inputHash = await hashPasscode(cleanPin);
  const targetHash = settings.ownerPinHash || DEFAULT_OWNER_PIN_HASH;
  const legacyPin = settings.ownerPin ? String(settings.ownerPin).trim() : null;

  let isValid = false;
  let serverHandled = false;

  // 1. Authenticate with server first to support custom OWNER_PIN secrets and get signed token
  if (typeof fetch !== 'undefined') {
    try {
      const authRes = await fetch('/api/admin-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: cleanPin })
      });
      if (authRes.ok) {
        const authData = await authRes.json();
        if (authData?.token && authData.role === 'owner') {
          sessionStorage.setItem('quickbite_admin_token', authData.token);
          sessionStorage.setItem('quickbite_owner_token', authData.token);
          isValid = true;
          serverHandled = true;
        } else if (authData?.token && authData.role !== 'owner') {
          // Reject non-owner roles (e.g. kitchen staff admin PIN 8899) on the Owner Executive Portal
          serverHandled = true;
          isValid = false;
        }
      } else if (authRes.status === 401 || authRes.status === 403) {
        // Server definitively rejected this PIN
        serverHandled = true;
        isValid = false;
      }
    } catch (e) {
      console.warn('[OwnerAuth] Server verification network error, attempting offline hash check:', e);
    }
  }

  // 2. Offline fallback if server was unreachable
  if (!serverHandled) {
    if (targetHash && inputHash === targetHash) {
      isValid = true;
    } else if (legacyPin && cleanPin === legacyPin) {
      isValid = true;
    } else {
      isValid = false;
    }
  }

  if (isValid) {
    ownerFailedAttempts = 0;
    ownerLockoutUntil = 0;
    // If legacy plaintext pin was used, migrate to salted hash and delete plaintext
    if (settings.ownerPin) {
      settings.ownerPinHash = inputHash;
      delete settings.ownerPin;
      dataService.saveSettings(settings);
    }

    setStaffSessionActive('owner');
    unlockOwnerPortal();
  } else {
    ownerFailedAttempts += 1;
    const isLocked = ownerFailedAttempts >= 5;
    if (isLocked) {
      ownerLockoutUntil = Date.now() + 30000;
    }
    const errorEl = document.getElementById('owner-lock-error');
    if (errorEl) {
      errorEl.style.display = 'block';
      errorEl.textContent = isLocked
        ? '⏳ Security Lockout: Too many failed attempts. Please wait 30s.'
        : `❌ Incorrect Owner PIN. (${Math.max(0, 5 - ownerFailedAttempts)} attempts remaining)`;
    }
    const pinDisplay = document.getElementById('owner-pin-display');
    if (pinDisplay) {
      pinDisplay.classList.add('shake');
      setTimeout(() => pinDisplay.classList.remove('shake'), 450);
    }
    setTimeout(() => {
      enteredPin = '';
      updatePinDots();
    }, 450);
  }
}

function unlockOwnerPortal() {
  isOwnerAuthenticated = true;
  const lockOverlay = document.getElementById('owner-lock-overlay');
  const dashboard = document.getElementById('owner-dashboard');

  if (lockOverlay) lockOverlay.style.display = 'none';
  if (dashboard) dashboard.style.display = 'flex';

  // Initial Sync & Render with immediate reactivity
  renderDashboard();
  Promise.allSettled([
    dataService.syncOrdersFromSupabase(true),
    dataService.syncRidersFromSupabase()
  ]).then(() => {
    renderDashboard();
  }).catch(() => {});
}

function showPasscodeLock() {
  isOwnerAuthenticated = false;
  enteredPin = '';
  updatePinDots();
  clearStaffSession('owner');

  const lockOverlay = document.getElementById('owner-lock-overlay');
  const dashboard = document.getElementById('owner-dashboard');

  if (lockOverlay) lockOverlay.style.display = 'flex';
  if (dashboard) dashboard.style.display = 'none';
}

// ==============================================================
// 3. CLOCK & HEADER
// ==============================================================
function initClock() {
  const clockEl = document.getElementById('owner-live-clock');
  function update() {
    if (!clockEl) return;
    const now = new Date();
    clockEl.textContent = now.toLocaleDateString('en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  }
  update();
  setInterval(update, 1000);
}

// ==============================================================
// 4. PERIOD & TIME HORIZON FILTERS
// ==============================================================
function initPeriodFilters() {
  const pillsContainer = document.getElementById('owner-period-pills');
  if (pillsContainer) {
    pillsContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('.period-pill');
      if (!btn) return;

      const period = btn.getAttribute('data-period');
      if (period === 'calendar' || btn.id === 'btn-period-calendar') {
        switchOwnerView('view-reports');
        return;
      }
      if (period === 'custom') {
        toggleCustomRangeCard();
        return;
      }

      pillsContainer.querySelectorAll('.period-pill').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');

      const customCard = document.getElementById('custom-range-card');
      if (customCard) customCard.style.display = 'none';

      currentPeriod = period;
      renderDashboard();
    });
  }

  // Custom date range controls
  const btnApplyCustom = document.getElementById('btn-apply-custom-range');
  const btnCloseCustom = document.getElementById('btn-close-custom-range');
  const customStart = document.getElementById('custom-start-date');
  const customEnd = document.getElementById('custom-end-date');

  // Set default dates
  const todayStr = new Date().toISOString().split('T')[0];
  if (customStart) customStart.value = todayStr;
  if (customEnd) customEnd.value = todayStr;

  if (btnApplyCustom) {
    btnApplyCustom.addEventListener('click', () => {
      if (customStart && customEnd && customStart.value && customEnd.value) {
        customStartDate = new Date(customStart.value + 'T00:00:00');
        customEndDate = new Date(customEnd.value + 'T23:59:59');

        pillsContainer.querySelectorAll('.period-pill').forEach(p => p.classList.remove('active'));
        const customPill = document.getElementById('btn-period-custom');
        if (customPill) customPill.classList.add('active');

        currentPeriod = 'custom';
        const customCard = document.getElementById('custom-range-card');
        if (customCard) customCard.style.display = 'none';

        renderDashboard();
      }
    });
  }

  if (btnCloseCustom) {
    btnCloseCustom.addEventListener('click', () => {
      const customCard = document.getElementById('custom-range-card');
      if (customCard) customCard.style.display = 'none';
    });
  }

  const btnOpenCalCard = document.getElementById('btn-open-calendar-from-card');
  if (btnOpenCalCard) {
    btnOpenCalCard.addEventListener('click', () => {
      const customCard = document.getElementById('custom-range-card');
      if (customCard) customCard.style.display = 'none';
      switchOwnerView('view-reports');
    });
  }

  const btnOwnerHeaderCal = document.getElementById('btn-owner-calendar');
  if (btnOwnerHeaderCal) {
    btnOwnerHeaderCal.addEventListener('click', () => {
      switchOwnerView('view-reports');
    });
  }

  // Rider Payout Rate input
  const inputRate = document.getElementById('input-rider-rate');
  if (inputRate) {
    inputRate.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      if (!isNaN(val) && val >= 0) {
        riderPayoutRate = val;
        renderRiderFleetTable(getFilteredOrders());
      }
    });
  }
}

function toggleCustomRangeCard() {
  const customCard = document.getElementById('custom-range-card');
  if (customCard) {
    const isShown = customCard.style.display === 'block';
    customCard.style.display = isShown ? 'none' : 'block';
  }
}

// ==============================================================
// 5. DATE RANGE FILTERING LOGIC
// ==============================================================
function getPeriodDateBounds(period) {
  const now = new Date();

  if (period === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { start, end, label: `Today, ${start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} (Live)` };
  }

  if (period === 'yesterday') {
    const yest = new Date(now);
    yest.setDate(yest.getDate() - 1);
    const start = new Date(yest.getFullYear(), yest.getMonth(), yest.getDate(), 0, 0, 0, 0);
    const end = new Date(yest.getFullYear(), yest.getMonth(), yest.getDate(), 23, 59, 59, 999);
    return { start, end, label: `Yesterday, ${start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` };
  }

  if (period === 'week') {
    // 7 days including today (today + 6 past days = 7 days)
    const start = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { start, end, label: `Last 7 Days (${start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })})` };
  }

  if (period === 'month') {
    // 30 days including today (today + 29 past days = 30 days)
    const start = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { start, end, label: `Last 30 Days (${start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })})` };
  }

  if (period === 'custom' && customStartDate && customEndDate) {
    return {
      start: customStartDate,
      end: customEndDate,
      label: `Custom Range (${customStartDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${customEndDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })})`
    };
  }

  // 'all'
  return { start: new Date(0), end: new Date(8640000000000000), label: 'All-Time Historical Performance' };
}

function getFilteredOrders() {
  const allOrders = dataService.getOrders();
  const bounds = getPeriodDateBounds(currentPeriod);

  return allOrders.filter(o => {
    if (!o) return false;
    const orderTimestamp = o.createdAt ? new Date(o.createdAt).getTime() : (o.updatedAt ? new Date(o.updatedAt).getTime() : 0);
    if (!orderTimestamp) return currentPeriod === 'all';
    return orderTimestamp >= bounds.start.getTime() && orderTimestamp <= bounds.end.getTime();
  });
}

// ==============================================================
/**
 * Unconditionally updates the Cash Drawer Summary card on the Overview Tab
 * (#owner-drawer-summary-card: #drawer-cod-total, #drawer-payout-total, #drawer-net-total, #drawer-net-sub-total)
 * based on period-matched COD food cash collected vs. period-matched rider delivery payouts.
 */
function updateCounterCashDrawerSummary(orders, codRevenue) {
  const drawerCodEl = document.getElementById('drawer-cod-total');
  const drawerPayoutEl = document.getElementById('drawer-payout-total');
  const drawerNetEl = document.getElementById('drawer-net-total');
  const drawerNetSubEl = document.getElementById('drawer-net-sub-total');

  const deliveredOrders = (orders || []).filter(o => o && String(o.status || '').toLowerCase() === 'delivered');
  const codOrders = deliveredOrders.filter(o => !isOnlineOrderPayment(o));
  const periodCodTotal = (typeof codRevenue === 'number')
    ? codRevenue
    : codOrders.reduce((sum, o) => {
        const cash = (typeof o.cashCollected === 'number' && o.cashCollected > 0)
          ? o.cashCollected
          : (Number(String(o.total || '0').replace(/[^0-9.]/g, '')) || 0);
        return Math.round((sum + cash) * 100) / 100;
      }, 0);

  // Group delivered orders by rider to calculate period payouts accurately
  const payoutConfig = dataService.getPayoutConfig();
  let periodPayoutTotal = 0;

  const ordersByRider = new Map();
  deliveredOrders.forEach(o => {
    const rPin = String(o.assignedRiderPin || '').trim();
    const rName = (o.assignedRiderName || '').trim().toLowerCase();
    const key = rPin || rName || 'unassigned';
    if (!ordersByRider.has(key)) ordersByRider.set(key, []);
    ordersByRider.get(key).push(o);
  });

  ordersByRider.forEach((rOrders) => {
    const payoutResult = dataService.calculateRiderPayout(rOrders, payoutConfig);
    periodPayoutTotal = Math.round((periodPayoutTotal + (payoutResult.exactPayout || payoutResult.totalPayout || 0)) * 100) / 100;
  });

  const periodNetTotal = Math.round((periodCodTotal - periodPayoutTotal) * 100) / 100;

  if (drawerCodEl) drawerCodEl.textContent = `₹${periodCodTotal.toLocaleString('en-IN')}`;
  if (drawerPayoutEl) drawerPayoutEl.textContent = `₹${periodPayoutTotal.toLocaleString('en-IN')}`;
  if (drawerNetEl) {
    if (periodNetTotal >= 0) {
      drawerNetEl.textContent = `₹${periodNetTotal.toLocaleString('en-IN')}`;
      drawerNetEl.className = 'drawer-headline-amount num-emerald';
    } else {
      drawerNetEl.textContent = `−₹${Math.abs(periodNetTotal).toLocaleString('en-IN')}`;
      drawerNetEl.className = 'drawer-headline-amount num-amber';
    }
  }
  if (drawerNetSubEl) drawerNetSubEl.textContent = `₹${periodNetTotal.toLocaleString('en-IN')}`;
}

// 6. DASHBOARD MASTER RENDERER
// ==============================================================
function renderDashboard() {
  const bounds = getPeriodDateBounds(currentPeriod);
  const periodLabelEl = document.getElementById('period-text-display');
  if (periodLabelEl) periodLabelEl.textContent = `Showing: ${bounds.label}`;

  const orders = getFilteredOrders();

  // 1. Render Financial & Operations KPIs (Always calculated for KPI cards and header)
  renderKPICards(orders);

  // 2. Unconditionally sync Cash Drawer Summary on Overview Tab
  updateCounterCashDrawerSummary(orders);

  // 3. Selective View Rendering: only render DOM elements for the currently active tab
  try {
    if (activeView === 'view-fleet') {
      renderRiderFleetTable(orders);
    } else if (activeView === 'view-orders') {
      renderOrdersTable(orders);
    } else if (activeView === 'view-cash') {
      renderCashSettlementsView(orders);
    } else if (activeView === 'view-payouts') {
      renderKmPayoutsView(orders);
    } else if (activeView === 'view-reports') {
      renderReportsView();
    } else if (activeView === 'view-overview' || !activeView) {
      // Overview tab is active; renderKPICards & updateCounterCashDrawerSummary populated the cards
    }
  } catch (viewErr) {
    console.error(`[Owner] Error rendering active view ${activeView}:`, viewErr);
  }

  // 4. Live Reactivity: If invoice receipt modal is open, refresh with fresh order data
  if (activeModalOrder && document.getElementById('owner-invoice-modal')?.style.display === 'flex') {
    const freshOrder = orders.find(o => o && (o.id === activeModalOrder.id || o.cleanId === activeModalOrder.cleanId));
    if (freshOrder) openInvoiceModal(freshOrder);
  }

  // 5. Update Navigation Badges
  updateNavigationBadges(orders);
}

// ==============================================================
// 7. KPI CARDS & FINANCIAL CALCULATIONS
// ==============================================================
function renderKPICards(orders) {
  let totalRevenue = 0;
  let codRevenue = 0;
  let onlineRevenue = 0;
  let doorstepUpiRevenue = 0;
  let storefrontPrepaidRevenue = 0;
  let subtotalRevenue = 0;
  let deliveryFeeRevenue = 0;
  let discountTotal = 0;
  let codCount = 0;
  let onlineCount = 0;
  let doorstepUpiCount = 0;
  let storefrontPrepaidCount = 0;
  let deliveredCount = 0;
  let activeLiveCount = 0;
  let activeLiveRevenue = 0;
  let activeCodCount = 0;
  let activeCodRevenue = 0;
  let activeOnlineCount = 0;
  let activeOnlineRevenue = 0;
  let cancelledCount = 0;
  let undeliveredCount = 0;
  let totalFleetKms = 0;

  orders.forEach(o => {
    const status = String(o.status || '').toLowerCase();
    const rawTotal = Number(String(o.total || '0').replace(/[^0-9.]/g, '')) || 0;
    const subtotal = Number(o.subtotal || o.subTotal || 0) || (Array.isArray(o.items) ? o.items.reduce((s, it) => s + (Number(it.price || 0) * (it.quantity || 1)), 0) : rawTotal);
    const delFee = Number(o.deliveryFee || o.delivery_fee || 0);
    const disc = Number(o.discount || o.discountAmount || 0);
    const isOnline = isOnlineOrderPayment(o);
    const isDoorstep = Boolean(o.doorstepUpi || o.doorstep_upi || String(o.paymentMethod || o.payment_method || '').toLowerCase().includes('doorstep'));

    if (status === 'delivered') {
      deliveredCount++;
      totalRevenue = Math.round((totalRevenue + rawTotal) * 100) / 100;
      subtotalRevenue = Math.round((subtotalRevenue + subtotal) * 100) / 100;
      deliveryFeeRevenue = Math.round((deliveryFeeRevenue + delFee) * 100) / 100;
      discountTotal = Math.round((discountTotal + disc) * 100) / 100;

      if (isOnline) {
        onlineRevenue = Math.round((onlineRevenue + rawTotal) * 100) / 100;
        onlineCount++;
        if (isDoorstep) {
          doorstepUpiRevenue = Math.round((doorstepUpiRevenue + rawTotal) * 100) / 100;
          doorstepUpiCount++;
        } else {
          storefrontPrepaidRevenue = Math.round((storefrontPrepaidRevenue + rawTotal) * 100) / 100;
          storefrontPrepaidCount++;
        }
      } else {
        codRevenue = Math.round((codRevenue + rawTotal) * 100) / 100;
        codCount++;
      }

      // Distance
      const dist = Number(o.addressDetails?.distanceKm || o.distance_km || o.distanceKm || 0);
      totalFleetKms += dist;
    } else if (['pending', 'accepted', 'cooking', 'ready', 'ready_for_pickup', 'on_the_way'].includes(status)) {
      activeLiveCount++;
      activeLiveRevenue = Math.round((activeLiveRevenue + rawTotal) * 100) / 100;
      if (isOnline) {
        activeOnlineCount++;
        activeOnlineRevenue = Math.round((activeOnlineRevenue + rawTotal) * 100) / 100;
      } else {
        activeCodCount++;
        activeCodRevenue = Math.round((activeCodRevenue + rawTotal) * 100) / 100;
      }
    } else if (status === 'cancelled') {
      cancelledCount++;
    } else if (status === 'undelivered') {
      undeliveredCount++;
    }
  });

  const aov = deliveredCount > 0 ? Math.round(totalRevenue / deliveredCount) : (activeLiveCount > 0 ? Math.round(activeLiveRevenue / activeLiveCount) : 0);
  const avgKm = deliveredCount > 0 ? Math.round((totalFleetKms / deliveredCount) * 10) / 10 : 0;

  // Display revenue: if delivered orders exist show delivered sales; if only in-flight/active orders exist, show active revenue pipeline
  const displayTotalRevenue = deliveredCount > 0 ? totalRevenue : activeLiveRevenue;
  const displayCodRevenue = deliveredCount > 0 ? codRevenue : activeCodRevenue;
  const displayOnlineRevenue = deliveredCount > 0 ? onlineRevenue : activeOnlineRevenue;

  const effectiveTotal = displayTotalRevenue > 0 ? displayTotalRevenue : (totalRevenue + activeLiveRevenue);
  const codPercent = effectiveTotal > 0 ? Math.round((displayCodRevenue / effectiveTotal) * 100) : 0;
  const onlinePercent = effectiveTotal > 0 ? (100 - codPercent) : 0;

  // DOM Injections
  const kpiTotalRev = document.getElementById('kpi-total-revenue');
  const kpiDeliveredCount = document.getElementById('kpi-delivered-count');
  const kpiDeliveredTag = document.getElementById('kpi-delivered-revenue-tag');
  const kpiAov = document.getElementById('kpi-aov');

  if (kpiTotalRev) kpiTotalRev.textContent = `₹${displayTotalRevenue.toLocaleString('en-IN')}`;
  if (kpiDeliveredTag) {
    kpiDeliveredTag.textContent = deliveredCount > 0 ? 'Delivered Orders' : (activeLiveCount > 0 ? 'Live in Prep' : 'Delivered Orders');
  }
  if (kpiDeliveredCount) {
    if (deliveredCount > 0) {
      kpiDeliveredCount.textContent = activeLiveCount > 0 ? `${deliveredCount} delivered (${activeLiveCount} live)` : `${deliveredCount} delivered`;
    } else {
      kpiDeliveredCount.textContent = activeLiveCount > 0 ? `0 delivered (${activeLiveCount} live in prep)` : '0 orders delivered';
    }
  }
  if (kpiAov) {
    kpiAov.textContent = deliveredCount > 0 ? `AOV: ₹${aov}` : (activeLiveCount > 0 ? `Live AOV: ₹${aov}` : 'AOV: ₹0');
  }

  const kpiCodRev = document.getElementById('kpi-cod-revenue');
  const kpiCodPercent = document.getElementById('kpi-cod-percent');
  const kpiCodOrdersCount = document.getElementById('kpi-cod-orders-count');

  if (kpiCodRev) kpiCodRev.textContent = `₹${displayCodRevenue.toLocaleString('en-IN')}`;
  if (kpiCodPercent) {
    kpiCodPercent.textContent = deliveredCount > 0 ? `${codPercent}% of Total` : (activeCodCount > 0 ? `${activeCodCount} Live Cash` : '0% of Total');
  }
  if (kpiCodOrdersCount) {
    if (deliveredCount > 0) {
      kpiCodOrdersCount.textContent = activeCodCount > 0 ? `${codCount} cash (${activeCodCount} in transit)` : `${codCount} cash orders`;
    } else {
      kpiCodOrdersCount.textContent = activeCodCount > 0 ? `${activeCodCount} cash orders in prep` : '0 cash orders';
    }
  }

  const kpiOnlineRev = document.getElementById('kpi-online-revenue');
  const kpiOnlinePercent = document.getElementById('kpi-online-percent');
  const kpiOnlineOrdersCount = document.getElementById('kpi-online-orders-count');

  if (kpiOnlineRev) kpiOnlineRev.textContent = `₹${displayOnlineRevenue.toLocaleString('en-IN')}`;
  if (kpiOnlinePercent) {
    kpiOnlinePercent.textContent = deliveredCount > 0 ? `${onlinePercent}% of Total` : (activeOnlineCount > 0 ? `${activeOnlineCount} Live Online` : '0% of Total');
  }
  if (kpiOnlineOrdersCount) {
    if (deliveredCount > 0) {
      const activeText = activeOnlineCount > 0 ? ` (${activeOnlineCount} in transit)` : '';
      kpiOnlineOrdersCount.textContent = doorstepUpiCount > 0 ? `${onlineCount} prepaid (${doorstepUpiCount} Doorstep UPI)${activeText}` : `${onlineCount} prepaid orders${activeText}`;
    } else {
      kpiOnlineOrdersCount.textContent = activeOnlineCount > 0 ? `${activeOnlineCount} prepaid in prep` : '0 prepaid orders';
    }
  }

  const kpiFleetKms = document.getElementById('kpi-fleet-kms');
  const kpiAvgKmTag = document.getElementById('kpi-avg-km-tag');
  const kpiActiveRiders = document.getElementById('kpi-active-riders-count');

  const allRiders = dataService.getRiders();
  if (kpiFleetKms) kpiFleetKms.textContent = `${totalFleetKms.toFixed(1)} km`;
  if (kpiAvgKmTag) kpiAvgKmTag.textContent = `${avgKm} km / order`;
  if (kpiActiveRiders) kpiActiveRiders.textContent = `${allRiders.length} registered riders`;

  const kpiTotalOrders = document.getElementById('kpi-total-orders');
  const kpiActiveLiveTag = document.getElementById('kpi-active-live-tag');
  const kpiCancelledCount = document.getElementById('kpi-cancelled-count');
  const kpiSuccessRate = document.getElementById('kpi-success-rate');

  const totalAttempted = deliveredCount + cancelledCount + undeliveredCount;
  const successRate = totalAttempted > 0 ? Math.round((deliveredCount / totalAttempted) * 100) : (activeLiveCount > 0 ? 100 : 0);

  if (kpiTotalOrders) kpiTotalOrders.textContent = orders.length;
  if (kpiActiveLiveTag) {
    kpiActiveLiveTag.textContent = activeLiveRevenue > 0 ? `${activeLiveCount} Live (₹${activeLiveRevenue.toLocaleString('en-IN')})` : `${activeLiveCount} Live Right Now`;
  }
  const failureText = undeliveredCount > 0 ? `${cancelledCount} cancelled • ${undeliveredCount} undelivered` : `${cancelledCount} cancelled`;
  if (kpiCancelledCount) kpiCancelledCount.textContent = failureText;
  if (kpiSuccessRate) kpiSuccessRate.textContent = deliveredCount > 0 ? `${successRate}% completion` : (activeLiveCount > 0 ? 'In Preparation' : '0% completion');

  // Ratio Bar
  const barCash = document.getElementById('bar-segment-cash');
  const barOnline = document.getElementById('bar-segment-online');
  if (barCash && barOnline) {
    barCash.style.width = `${codPercent}%`;
    barOnline.style.width = `${onlinePercent}%`;
  }
}

// ==============================================================
// 8. DELIVERY BOYS PERFORMANCE, KMS & CASH PAYOUTS
// ==============================================================
function renderRiderFleetTable(orders) {
  const tbody = document.getElementById('rider-table-body');
  const tfoot = document.getElementById('rider-table-footer');
  if (!tbody) return;

  const riders = dataService.getRiders();
  const deliveredOrders = orders.filter(o => o && String(o.status).toLowerCase() === 'delivered');

  // Map delivered orders to riders
  const riderStatsMap = new Map();

  // Initialize registered riders
  riders.forEach(r => {
    riderStatsMap.set(r.pin, {
      pin: r.pin,
      name: r.name || 'Unnamed Rider',
      phone: r.phone || '',
      vehicle: r.vehicle || '🏍️ Bike',
      deliveredOrders: [],
      totalKms: 0,
      cashInHand: 0,
      onlineOrdersCount: 0
    });
  });

  // Tally delivered orders
  deliveredOrders.forEach(o => {
    let riderPin = String(o.assignedRiderPin || '').trim();
    if (!riderPin && o.assignedRiderName) {
      const matched = riders.find(r => r.name && r.name.trim().toLowerCase() === o.assignedRiderName.trim().toLowerCase());
      if (matched) riderPin = String(matched.pin).trim();
    }
    if (!riderPin) return;

    if (!riderStatsMap.has(riderPin)) {
      riderStatsMap.set(riderPin, {
        pin: riderPin,
        name: o.assignedRiderName || `Rider (${riderPin})`,
        phone: '',
        vehicle: '🏍️ Bike',
        deliveredOrders: [],
        totalKms: 0,
        cashInHand: 0,
        onlineOrdersCount: 0
      });
    }

    const stat = riderStatsMap.get(riderPin);
    stat.deliveredOrders.push(o);

    const dist = Number(o.addressDetails?.distanceKm || o.distance_km || o.distanceKm || 0);
    stat.totalKms += dist;

    const rawTotal = Number(String(o.total || '0').replace(/[^0-9.]/g, '')) || 0;
    const isOnline = isOnlineOrderPayment(o);

    if (isOnline) {
      stat.onlineOrdersCount++;
    } else {
      const riderRecord = riders.find(r => (riderPin && String(r.pin) === String(riderPin)) || (r.name || '').toLowerCase() === (o.assignedRiderName || '').toLowerCase());
      const settledAtRaw = riderRecord?.cashSettledAt;
      const settledAtMs = typeof settledAtRaw === 'number' ? settledAtRaw : (settledAtRaw ? Date.parse(settledAtRaw) || 0 : 0);
      const deliveredAtMs = Number(o.deliveredAt || o.createdAt || 0);
      if (!settledAtMs || deliveredAtMs > settledAtMs) {
        stat.cashInHand += rawTotal;
      }
    }
  });

  const statsList = Array.from(riderStatsMap.values());

  if (statsList.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="11" style="text-align: center; padding: 32px 16px; color: var(--owner-text-muted);">
          <i class="fa-solid fa-person-biking" style="font-size: 1.8rem; margin-bottom: 8px; display: block; color: var(--owner-text-dim);"></i>
          No delivery boys or deliveries recorded in this period.
        </td>
      </tr>
    `;
    if (tfoot) tfoot.style.display = 'none';
    return;
  }

  // Totals for Footer
  let grandDeliveries = 0;
  let grandKms = 0;
  let grandCash = 0;
  let grandOnline = 0;
  let grandPayouts = 0;
  let grandNetDeposit = 0;

  tbody.innerHTML = statsList.map(st => {
    const deliveryCount = st.deliveredOrders.length;
    const kms = Math.round(st.totalKms * 10) / 10;
    const avgKmPerOrder = deliveryCount > 0 ? (kms / deliveryCount).toFixed(1) : '0.0';
    const cash = st.cashInHand;
    const online = st.onlineOrdersCount;

    // Payout Calculation: Based on owner active compensation model
    const payoutObj = dataService.calculateRiderPayout(st.deliveredOrders);
    const riderPayout = payoutObj.totalPayout;

    // Net Settlement Balance:
    // If Rider collected Cash, they must deposit (Cash - Payout) into the drawer.
    // If Rider collected no cash (all online), restaurant pays rider their payout.
    const netDeposit = cash - riderPayout;

    grandDeliveries += deliveryCount;
    grandKms += kms;
    grandCash += cash;
    grandOnline += online;
    grandPayouts += riderPayout;
    grandNetDeposit += netDeposit;

    let netBadgeHtml = '';
    if (cash > 0) {
      netBadgeHtml = `<span class="settle-badge deposit"><i class="fa-solid fa-arrow-down-long"></i> COD: ₹${formatInr(cash)} | Fee: ₹${formatInr(riderPayout)}</span>`;
    } else if (riderPayout > 0) {
      netBadgeHtml = `<span class="settle-badge pay"><i class="fa-solid fa-arrow-up-long"></i> Pay Fee ₹${formatInr(riderPayout)}</span>`;
    } else {
      netBadgeHtml = `<span class="settle-badge balanced"><i class="fa-solid fa-check"></i> Settled (₹0)</span>`;
    }

    return `
      <tr>
        <td>
          <div class="rider-cell-meta">
            <div class="rider-avatar-bubble">${escapeHtml(getRiderInitial(st.name))}</div>
            <div class="rider-name-box">
              <span class="rider-name">${escapeHtml(st.name || 'Delivery Partner')}</span>
              ${st.phone ? `<a href="tel:${sanitizePhone(st.phone)}" class="rider-phone-link"><i class="fa-solid fa-phone"></i> ${escapeHtml(st.phone)}</a>` : '<span style="font-size:0.74rem;color:#64748b;">No phone</span>'}
            </div>
          </div>
        </td>
        <td>
          <span style="font-size: 0.8rem; color: var(--owner-text-muted);">${escapeHtml(st.vehicle || '🏍️ Bike')}</span>
        </td>
        <td>
          <span class="badge-rider-pin-table" title="Secret Login PIN">${escapeHtml(st.pin || '----')}</span>
        </td>
        <td class="text-center font-bold" style="font-size: 0.95rem;">
          ${deliveryCount}
        </td>
        <td class="text-center" style="font-weight: 700; color: var(--owner-purple);">
          <i class="fa-solid fa-route" style="font-size: 0.75rem;"></i> ${kms} km
        </td>
        <td class="text-center" style="color: var(--owner-text-muted);">
          ${avgKmPerOrder} km
        </td>
        <td class="text-right num-amber" style="font-weight: 700; font-size: 0.92rem;">
          ₹${formatInr(cash)}
        </td>
        <td class="text-right" style="color: var(--owner-teal); font-weight: 600;">
          ${online} orders
        </td>
        <td class="text-right num-purple" style="font-weight: 700;">
          ₹${formatInr(riderPayout)}
        </td>
        <td class="text-right">
          ${netBadgeHtml}
        </td>
        <td class="text-center">
          <div class="rc-action-btn-group" style="justify-content: center;">
            <button type="button" class="btn-owner-edit-rider" data-pin="${escapeHtml(st.pin)}" title="Edit Delivery Boy">
              <i class="fa-solid fa-pen-to-square"></i> Edit
            </button>
            <button type="button" class="btn-owner-delete-rider" data-pin="${escapeHtml(st.pin)}" title="Delete Delivery Boy">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Update Footer Totals
  if (tfoot) {
    tfoot.style.display = 'table-footer-group';
    document.getElementById('foot-total-deliveries').textContent = grandDeliveries;
    document.getElementById('foot-total-kms').textContent = `${grandKms.toFixed(1)} km`;
    document.getElementById('foot-avg-km').textContent = grandDeliveries > 0 ? `${(grandKms / grandDeliveries).toFixed(1)} km` : '0.0 km';
    document.getElementById('foot-total-cash').textContent = `₹${grandCash.toLocaleString('en-IN')}`;
    document.getElementById('foot-total-online').textContent = `${grandOnline} orders`;
    document.getElementById('foot-total-payouts').textContent = `₹${grandPayouts.toLocaleString('en-IN')}`;

    const footNetEl = document.getElementById('foot-total-net-deposit');
    if (footNetEl) {
      if (grandNetDeposit >= 0) {
        footNetEl.textContent = `₹${grandNetDeposit.toLocaleString('en-IN')} (to drawer)`;
        footNetEl.className = 'text-right num-emerald';
      } else {
        footNetEl.textContent = `₹${Math.abs(grandNetDeposit).toLocaleString('en-IN')} (payout owed)`;
        footNetEl.className = 'text-right num-amber';
      }
    }
  }

  // Update Mobile Delivery Boy Cards (Clean & easy to understand)
  const riderCardsContainer = document.getElementById('rider-cards-container');
  if (riderCardsContainer) {
    if (statsList.length === 0) {
      riderCardsContainer.innerHTML = `
        <div class="owner-empty-card">
          <i class="fa-solid fa-person-biking"></i>
          <p>No delivery boys or deliveries recorded in this period.</p>
        </div>
      `;
    } else {
      riderCardsContainer.innerHTML = statsList.map(st => {
        const deliveryCount = st.deliveredOrders.length;
        const kms = Math.round(st.totalKms * 10) / 10;
        const cash = st.cashInHand;
        const online = st.onlineOrdersCount;
        const payoutObj = dataService.calculateRiderPayout(st.deliveredOrders);
        const riderPayout = payoutObj.totalPayout;
        const netDeposit = cash - riderPayout;

        let statusClass = 'deposit';
        let statusTitle = 'COD CASH TO DEPOSIT';
        let statusText = `₹${cash.toLocaleString('en-IN')}`;
        let statusFormula = `100% COD to Drawer • Rider Fee: ₹${riderPayout.toLocaleString('en-IN')}`;

        if (netDeposit < 0) {
          statusClass = 'pay';
          statusTitle = 'PAY RIDER FROM DRAWER';
          statusText = `Pay ₹${Math.abs(netDeposit).toLocaleString('en-IN')}`;
          statusFormula = online > 0 ? `Delivered ${online} online orders • Rider Fee: ₹${riderPayout.toLocaleString('en-IN')}` : `COD Handed Over • Rider Fee: ₹${riderPayout.toLocaleString('en-IN')}`;
        } else if (netDeposit === 0 && deliveryCount > 0) {
          statusClass = 'balanced';
          statusTitle = 'ALL BALANCED & SETTLED';
          statusText = `₹0 Balance`;
          statusFormula = `Cash collected equals delivery earnings`;
        } else if (deliveryCount === 0) {
          statusClass = 'idle';
          statusTitle = 'NO DELIVERIES IN PERIOD';
          statusText = `0 Deliveries`;
          statusFormula = `No cash collected or earnings owed`;
        }

        return `
          <div class="rider-card-mobile ${statusClass}">
            <div class="rc-header">
              <div class="rc-profile">
                <div class="rider-avatar-bubble">${escapeHtml(getRiderInitial(st.name))}</div>
                <div>
                  <h4 class="rc-name">${escapeHtml(st.name || 'Delivery Partner')}</h4>
                  <span class="rc-vehicle">${escapeHtml(st.vehicle || '🏍️ Bike')}</span>
                </div>
              </div>
              ${st.phone ? `<a href="tel:${sanitizePhone(st.phone)}" class="rc-call-btn" title="Call ${escapeHtml(st.name)}"><i class="fa-solid fa-phone"></i> Call</a>` : ''}
            </div>

            <!-- Prominent Cash Settlement Box -->
            <div class="rc-settle-box">
              <div class="rc-settle-meta">
                <span class="rc-settle-title">${statusTitle}</span>
                <span class="rc-settle-formula">${statusFormula}</span>
              </div>
              <div class="rc-settle-amount">${statusText}</div>
            </div>

            <!-- 4 Quick Stats -->
            <div class="rc-metrics-grid">
              <div class="rc-metric">
                <span class="rc-val">${deliveryCount}</span>
                <span class="rc-lbl">Delivered</span>
              </div>
              <div class="rc-metric">
                <span class="rc-val">${kms} km</span>
                <span class="rc-lbl">Road Run</span>
              </div>
              <div class="rc-metric">
                <span class="rc-val num-amber">₹${cash.toLocaleString('en-IN')}</span>
                <span class="rc-lbl">Cash Collected</span>
              </div>
              <div class="rc-metric">
                <span class="rc-val num-purple">₹${riderPayout.toLocaleString('en-IN')}</span>
                <span class="rc-lbl">Rider Payout</span>
              </div>
            </div>

            <!-- Credentials & Owner Action Bar -->
            <div class="rc-actions-bar">
              <span class="badge-rider-pin" title="Secret Login PIN"><i class="fa-solid fa-key"></i> PIN: <strong>${escapeHtml(st.pin)}</strong></span>
              <div class="rc-action-btn-group">
                <button type="button" class="btn-owner-edit-rider" data-pin="${escapeHtml(st.pin)}" title="Edit Delivery Boy">
                  <i class="fa-solid fa-pen-to-square"></i> Edit
                </button>
                <button type="button" class="btn-owner-delete-rider" data-pin="${escapeHtml(st.pin)}" title="Delete Delivery Boy">
                  <i class="fa-solid fa-trash"></i> Delete
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // Attach Edit and Delete Listeners to Fleet Action Buttons
  document.querySelectorAll('.btn-owner-edit-rider').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const pin = btn.getAttribute('data-pin');
      if (pin) openOwnerRiderModal(pin);
    };
  });

  document.querySelectorAll('.btn-owner-delete-rider').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const pin = btn.getAttribute('data-pin');
      if (pin) deleteOwnerRider(pin);
    };
  });

  // Update Cash Drawer Reconciliation Summary Card (Plain English)
  const drawerCodEl = document.getElementById('drawer-cod-total');
  const drawerPayoutEl = document.getElementById('drawer-payout-total');
  const drawerNetEl = document.getElementById('drawer-net-total');
  const drawerNetSubEl = document.getElementById('drawer-net-sub-total');
  const drawerRateEl = document.getElementById('drawer-note-rate');

  if (drawerCodEl) drawerCodEl.textContent = `₹${grandCash.toLocaleString('en-IN')}`;
  if (drawerPayoutEl) drawerPayoutEl.textContent = `₹${grandPayouts.toLocaleString('en-IN')}`;
  if (drawerNetEl) {
    if (grandNetDeposit >= 0) {
      drawerNetEl.textContent = `₹${grandNetDeposit.toLocaleString('en-IN')}`;
      drawerNetEl.className = 'drawer-headline-amount num-emerald';
    } else {
      drawerNetEl.textContent = `−₹${Math.abs(grandNetDeposit).toLocaleString('en-IN')}`;
      drawerNetEl.className = 'drawer-headline-amount num-amber';
    }
  }
  if (drawerNetSubEl) drawerNetSubEl.textContent = `₹${grandNetDeposit.toLocaleString('en-IN')}`;
  if (drawerRateEl) drawerRateEl.textContent = `₹${riderPayoutRate}`;
}

// ==============================================================
// 9. ORDERS AUDIT STREAM & SEARCH
// ==============================================================
function initOrdersFilterControls() {
  const pillsContainer = document.getElementById('order-status-filter-pills');
  if (pillsContainer) {
    pillsContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('.order-filter-pill');
      if (!btn) return;

      pillsContainer.querySelectorAll('.order-filter-pill').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');

      orderStatusFilter = btn.getAttribute('data-status');
      ownerOrdersPage = 1;
      renderOrdersTable(getFilteredOrders());
    });
  }

  const searchInput = document.getElementById('order-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = (e.target.value || '').toLowerCase().trim();
      ownerOrdersPage = 1;
      renderOrdersTable(getFilteredOrders());
    });
  }

  // Orders View Toggle (Cards vs Table)
  const ordersViewToggle = document.getElementById('orders-view-toggle');
  if (ordersViewToggle) {
    if (typeof window !== 'undefined' && window.innerWidth > 768) {
      ordersViewToggle.querySelectorAll('.btn-view-toggle').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-view') === 'table');
      });
    }

    ordersViewToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-view-toggle');
      if (!btn) return;
      const view = btn.getAttribute('data-view');
      ordersViewToggle.querySelectorAll('.btn-view-toggle').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const cards = document.getElementById('orders-cards-container');
      const table = document.getElementById('orders-table-wrapper');
      if (view === 'table') {
        if (cards) cards.style.display = 'none';
        if (table) table.style.display = 'block';
      } else {
        if (cards) cards.style.display = 'grid';
        if (table) table.style.display = 'none';
      }
    });
  }
}

function renderOrdersTable(orders) {
  const tbody = document.getElementById('orders-table-body');
  if (!tbody) return;

  // Update Status Pill Counts
  let countActive = 0;
  let countDelivered = 0;
  let countCancelled = 0;

  orders.forEach(o => {
    const s = String(o.status || '').toLowerCase();
    if (s === 'delivered') countDelivered++;
    else if (['pending', 'accepted', 'cooking', 'ready', 'ready_for_pickup', 'on_the_way'].includes(s)) countActive++;
    else if (s === 'cancelled' || s === 'undelivered') countCancelled++;
  });

  const countAllEl = document.getElementById('count-all');
  const countActiveEl = document.getElementById('count-active');
  const countDeliveredEl = document.getElementById('count-delivered');
  const countCancelledEl = document.getElementById('count-cancelled');

  if (countAllEl) countAllEl.textContent = orders.length;
  if (countActiveEl) countActiveEl.textContent = countActive;
  if (countDeliveredEl) countDeliveredEl.textContent = countDelivered;
  if (countCancelledEl) countCancelledEl.textContent = countCancelled;

  // Filter by status & search
  let displayedOrders = orders.filter(o => {
    if (!o) return false;
    const status = String(o.status || '').toLowerCase();
    const isOnline = isOnlineOrderPayment(o);

    if (orderStatusFilter === 'active') {
      if (!['pending', 'accepted', 'cooking', 'ready', 'ready_for_pickup', 'on_the_way'].includes(status)) return false;
    } else if (orderStatusFilter === 'delivered') {
      if (status !== 'delivered') return false;
    } else if (orderStatusFilter === 'cancelled') {
      if (status !== 'cancelled' && status !== 'undelivered') return false;
    } else if (orderStatusFilter === 'cash') {
      if (isOnline) return false;
    } else if (orderStatusFilter === 'online') {
      if (!isOnline) return false;
    }

    if (searchQuery) {
      const idMatch = String(o.id || o.cleanId || '').toLowerCase().includes(searchQuery);
      const custMatch = String(o.customerName || o.customer_name || '').toLowerCase().includes(searchQuery);
      const phoneMatch = String(extractPhoneFromOrder(o) || '').toLowerCase().includes(searchQuery);
      const riderMatch = String(o.assignedRiderName || '').toLowerCase().includes(searchQuery);
      const addrMatch = String(cleanDeliveryAddress(o.deliveryAddress || o.delivery_address || '')).toLowerCase().includes(searchQuery);

      if (!idMatch && !custMatch && !phoneMatch && !riderMatch && !addrMatch) {
        return false;
      }
    }

    return true;
  });

  // Sort descending by timestamp (newest first)
  displayedOrders.sort((a, b) => {
    const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tB - tA;
  });

  const totalOrders = displayedOrders.length;
  const totalPages = Math.ceil(totalOrders / OWNER_ORDERS_PER_PAGE) || 1;
  if (ownerOrdersPage > totalPages) ownerOrdersPage = totalPages;
  if (ownerOrdersPage < 1) ownerOrdersPage = 1;
  const startIndex = (ownerOrdersPage - 1) * OWNER_ORDERS_PER_PAGE;
  const endIndex = Math.min(startIndex + OWNER_ORDERS_PER_PAGE, totalOrders);
  const pageOrders = displayedOrders.slice(startIndex, endIndex);

  if (totalOrders === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" style="text-align: center; padding: 32px 16px; color: var(--owner-text-muted);">
          <i class="fa-solid fa-inbox" style="font-size: 1.8rem; margin-bottom: 8px; display: block; color: var(--owner-text-dim);"></i>
          No orders match your filter criteria in this period.
        </td>
      </tr>
    `;
    const oldPagination = document.getElementById('owner-orders-pagination');
    if (oldPagination) oldPagination.style.display = 'none';
    const ordersCardsContainer = document.getElementById('orders-cards-container');
    if (ordersCardsContainer) {
      ordersCardsContainer.innerHTML = `
        <div class="owner-empty-card">
          <i class="fa-solid fa-inbox"></i>
          <p>No orders match your filter criteria in this period.</p>
        </div>
      `;
    }
    return;
  }

  tbody.innerHTML = pageOrders.map(o => {
    const rawId = String(o.id || '');
    const cleanId = formatDisplayOrderId(o.id, o.pickupCode);
    const dateStr = o.createdAt ? new Date(o.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '--';

    const custName = o.customerName || o.customer_name || 'Customer';
    const phone = extractPhoneFromOrder(o);
    const address = cleanDeliveryAddress(o.deliveryAddress || o.delivery_address || '');
    const distKm = Number(o.addressDetails?.distanceKm || o.distance_km || o.distanceKm || 0);

    const items = Array.isArray(o.items) ? o.items : [];
    const itemsSummary = items.map(it => `${it.quantity || 1}x ${it.name}`).join(', ') || 'Food items';

    const rawTotal = Number(String(o.total || '0').replace(/[^0-9.]/g, '')) || 0;
    const isOnline = isOnlineOrderPayment(o);

    const riderName = o.assignedRiderName ? escapeHtml(o.assignedRiderName) : '<span style="color:#64748b;">Unassigned</span>';

    const status = String(o.status || 'pending').toLowerCase();
    let statusBadge = status === 'undelivered'
      ? `<span class="status-badge undelivered"><i class="fa-solid fa-triangle-exclamation"></i> Undelivered</span>`
      : `<span class="status-badge ${status}">${status.replace(/_/g, ' ')}</span>`;

    let payBadge = isOnline
      ? `<span class="pay-badge online"><i class="fa-solid fa-credit-card"></i> Online Paid</span>`
      : `<span class="pay-badge cash"><i class="fa-solid fa-money-bill-wave"></i> Cash (COD)</span>`;

    return `
      <tr>
        <td>
          <span class="order-id-badge">${escapeHtml(cleanId)}</span>
        </td>
        <td style="color: var(--owner-text-muted); font-size: 0.8rem;">
          ${dateStr}
        </td>
        <td>
          <div style="font-weight: 600; color: var(--owner-text);">${escapeHtml(custName)}</div>
          ${phone ? `<a href="tel:${sanitizePhone(phone)}" style="font-size: 0.74rem; color: var(--owner-text-muted); text-decoration: none;"><i class="fa-solid fa-phone"></i> ${escapeHtml(phone)}</a>` : ''}
        </td>
        <td style="max-width: 220px; white-space: normal; line-height: 1.35; font-size: 0.78rem;">
          <div style="color: var(--owner-text);">${escapeHtml(address)}</div>
          ${distKm > 0 ? `<span style="color: var(--owner-purple); font-weight: 700; font-size: 0.72rem;"><i class="fa-solid fa-route"></i> ${distKm.toFixed(1)} km road</span>` : ''}
        </td>
        <td style="max-width: 200px; white-space: normal; line-height: 1.35; font-size: 0.78rem; color: var(--owner-text-muted);">
          ${escapeHtml(itemsSummary)}
        </td>
        <td>
          ${payBadge}
        </td>
        <td>
          ${riderName}
        </td>
        <td class="text-right font-bold" style="font-size: 0.95rem; color: var(--owner-text);">
          ₹${rawTotal.toLocaleString('en-IN')}
        </td>
        <td class="text-center">
          ${statusBadge}
        </td>
        <td class="text-center">
          <button type="button" class="btn-view-receipt" data-order-id="${escapeHtml(rawId)}" title="View read-only invoice receipt">
            <i class="fa-regular fa-eye"></i> Receipt
          </button>
        </td>
      </tr>
    `;
  }).join('');

  // Attach receipt modal click handlers
  tbody.querySelectorAll('.btn-view-receipt').forEach(btn => {
    btn.addEventListener('click', () => {
      const orderId = btn.getAttribute('data-order-id');
      const order = orders.find(o => String(o.id) === String(orderId));
      if (order) {
        openInvoiceModal(order);
      }
    });
  });

  // Render Mobile Orders Cards
  const ordersCardsContainer = document.getElementById('orders-cards-container');
  if (ordersCardsContainer) {
    if (displayedOrders.length === 0) {
      ordersCardsContainer.innerHTML = `
        <div class="owner-empty-card">
          <i class="fa-solid fa-inbox"></i>
          <p>No orders match your filter criteria in this period.</p>
        </div>
      `;
    } else {
      ordersCardsContainer.innerHTML = pageOrders.map(o => {
        const rawId = String(o.id || '');
        const cleanId = formatDisplayOrderId(o.id, o.pickupCode);
        const dateStr = o.createdAt ? new Date(o.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '--';
        const custName = o.customerName || o.customer_name || 'Customer';
        const phone = extractPhoneFromOrder(o);
        const address = cleanDeliveryAddress(o.deliveryAddress || o.delivery_address || '');
        const distKm = Number(o.addressDetails?.distanceKm || o.distance_km || o.distanceKm || 0);
        const items = Array.isArray(o.items) ? o.items : [];
        const itemsSummary = items.map(it => `${it.quantity || 1}x ${it.name}`).join(', ') || 'Food items';
        const rawTotal = Number(String(o.total || '0').replace(/[^0-9.]/g, '')) || 0;
        const isOnline = isOnlineOrderPayment(o);
        const riderName = o.assignedRiderName ? escapeHtml(o.assignedRiderName) : 'Unassigned';
        const status = String(o.status || 'pending').toLowerCase();

        return `
          <div class="order-card-mobile">
            <div class="oc-top">
              <span class="order-id-badge">${escapeHtml(cleanId)}</span>
              <span class="status-badge ${status}">${status.replace(/_/g, ' ')}</span>
              <span class="oc-time"><i class="fa-regular fa-clock"></i> ${dateStr}</span>
            </div>

            <div class="oc-customer">
              <div class="oc-cust-title">
                <strong>${escapeHtml(custName)}</strong>
                ${phone ? `<a href="tel:${sanitizePhone(phone)}" class="oc-phone-link"><i class="fa-solid fa-phone"></i> ${escapeHtml(phone)}</a>` : ''}
              </div>
              <div class="oc-address">
                <span>${escapeHtml(address)}</span>
                ${distKm > 0 ? `<span class="oc-dist-chip"><i class="fa-solid fa-route"></i> ${distKm.toFixed(1)} km</span>` : ''}
              </div>
            </div>

            <div class="oc-items">
              <i class="fa-solid fa-utensils"></i> ${escapeHtml(itemsSummary)}
            </div>

            <div class="oc-footer">
              <div class="oc-footer-left">
                <span class="oc-rider-tag"><i class="fa-solid fa-motorcycle"></i> ${riderName}</span>
                <span class="pay-badge ${isOnline ? 'online' : 'cash'}">${isOnline ? 'Online Paid' : 'Cash (COD)'}</span>
              </div>
              <div class="oc-footer-right">
                <span class="oc-total">₹${rawTotal.toLocaleString('en-IN')}</span>
                <button type="button" class="btn-view-receipt btn-receipt-mobile" data-order-id="${escapeHtml(rawId)}">
                  <i class="fa-regular fa-eye"></i> Receipt
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('');

      // Attach click handlers to mobile card receipt buttons
      ordersCardsContainer.querySelectorAll('.btn-view-receipt').forEach(btn => {
        btn.addEventListener('click', () => {
          const orderId = btn.getAttribute('data-order-id');
          const order = orders.find(o => String(o.id) === String(orderId));
          if (order) {
            openInvoiceModal(order);
          }
        });
      });
    }
  }

  // Render pagination navigation
  renderOwnerPagination(totalOrders, totalPages, ownerOrdersPage, startIndex, endIndex);
}

function renderOwnerPagination(totalOrders, totalPages, currentPage, startIndex, endIndex) {
  let paginationEl = document.getElementById('owner-orders-pagination');
  if (!paginationEl) {
    const tableWrapper = document.getElementById('orders-table-wrapper');
    if (!tableWrapper || !tableWrapper.parentNode) return;
    paginationEl = document.createElement('div');
    paginationEl.id = 'owner-orders-pagination';
    tableWrapper.parentNode.insertBefore(paginationEl, tableWrapper.nextSibling);
  }

  if (totalPages <= 1) {
    paginationEl.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; margin-top:16px; padding:10px 16px; background:rgba(30,41,59,0.5); border-radius:10px; font-size:0.82rem; color:var(--owner-text-muted);">
        <span>Showing all <strong>${totalOrders}</strong> order${totalOrders === 1 ? '' : 's'}</span>
      </div>
    `;
    paginationEl.style.display = 'block';
    return;
  }

  paginationEl.style.display = 'block';
  paginationEl.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; margin-top:16px; padding:12px 18px; background:rgba(30,41,59,0.65); border:1px solid rgba(255,255,255,0.08); border-radius:12px; font-size:0.85rem; color:var(--owner-text-muted);">
      <div>
        Showing <strong>${startIndex + 1}–${endIndex}</strong> of <strong>${totalOrders}</strong> orders
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <button type="button" id="btn-owner-prev-page" class="btn-owner-pagination" ${currentPage <= 1 ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : 'style="cursor:pointer;"'}>
          <i class="fa-solid fa-chevron-left"></i> Prev
        </button>
        <span style="font-weight:600; color:var(--owner-text); padding:0 6px;">Page ${currentPage} of ${totalPages}</span>
        <button type="button" id="btn-owner-next-page" class="btn-owner-pagination" ${currentPage >= totalPages ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : 'style="cursor:pointer;"'}>
          Next <i class="fa-solid fa-chevron-right"></i>
        </button>
      </div>
    </div>
  `;

  const btnPrev = document.getElementById('btn-owner-prev-page');
  const btnNext = document.getElementById('btn-owner-next-page');
  if (btnPrev && currentPage > 1) {
    btnPrev.addEventListener('click', () => {
      ownerOrdersPage--;
      renderOrdersTable(getFilteredOrders());
      const wrapper = document.getElementById('orders-table-wrapper');
      if (wrapper) wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  if (btnNext && currentPage < totalPages) {
    btnNext.addEventListener('click', () => {
      ownerOrdersPage++;
      renderOrdersTable(getFilteredOrders());
      const wrapper = document.getElementById('orders-table-wrapper');
      if (wrapper) wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
}

// ==============================================================
// 10. READ-ONLY ORDER INVOICE MODAL
// ==============================================================
let activeModalOrder = null;

function openInvoiceModal(order) {
  activeModalOrder = order;
  const modal = document.getElementById('owner-invoice-modal');
  const modalId = document.getElementById('modal-invoice-id');
  const modalTime = document.getElementById('modal-invoice-time');
  const modalBody = document.getElementById('modal-invoice-body');
  if (!modal || !modalBody) return;

  const cleanId = formatDisplayOrderId(order.id, order.pickupCode);
  const dateStr = order.createdAt ? new Date(order.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Live Order';

  if (modalId) modalId.textContent = cleanId;
  if (modalTime) modalTime.textContent = `Placed on ${dateStr}`;

  const custName = order.customerName || order.customer_name || 'Customer';
  const phone = extractPhoneFromOrder(order);
  const address = cleanDeliveryAddress(order.deliveryAddress || order.delivery_address || '');
  const distKm = Number(order.addressDetails?.distanceKm || order.distance_km || order.distanceKm || 0);

  const items = Array.isArray(order.items) ? order.items : [];
  const rawTotal = Number(String(order.total || '0').replace(/[^0-9.]/g, '')) || 0;
  const subtotal = Number(order.subtotal || order.subTotal || 0) || items.reduce((s, it) => s + (Number(it.price || 0) * (it.quantity || 1)), 0);
  const delFee = Number(order.deliveryFee || order.delivery_fee || 0);
  const disc = Number(order.discount || order.discountAmount || 0);
  const isOnline = isOnlineOrderPayment(order);

  modalBody.innerHTML = `
    <div style="background: #F8FAFC; padding: 14px; border-radius: 10px; border: 1px solid var(--owner-border);">
      <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
        <span style="color: var(--owner-text-muted);">Customer:</span>
        <strong style="color: var(--owner-text);">${escapeHtml(custName)}</strong>
      </div>
      ${phone ? `
      <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
        <span style="color: var(--owner-text-muted);">Contact:</span>
        <a href="tel:${sanitizePhone(phone)}" style="color: #D97706; text-decoration: none; font-weight: 600;"><i class="fa-solid fa-phone"></i> ${escapeHtml(phone)}</a>
      </div>` : ''}
      <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
        <span style="color: var(--owner-text-muted);">Address:</span>
        <span style="color: var(--owner-text); text-align: right; max-width: 60%;">${escapeHtml(address)}</span>
      </div>
      ${distKm > 0 ? `
      <div style="display: flex; justify-content: space-between;">
        <span style="color: var(--owner-text-muted);">Road Distance:</span>
        <span style="color: var(--owner-purple); font-weight: 700;">${distKm.toFixed(1)} km</span>
      </div>` : ''}
    </div>

    <div style="background: #F8FAFC; padding: 14px; border-radius: 10px; border: 1px solid var(--owner-border);">
      <h4 style="margin: 0 0 10px 0; color: var(--owner-text); font-size: 0.88rem;"><i class="fa-solid fa-utensils"></i> Items Ordered</h4>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        ${items.map(it => `
          <div style="display: flex; justify-content: space-between; font-size: 0.84rem;">
            <span><strong style="color: #D97706;">${it.quantity || 1}x</strong> ${escapeHtml(it.name)}</span>
            <span style="font-weight: 600; color: var(--owner-text);">₹${Number(it.price || 0) * (it.quantity || 1)}</span>
          </div>
        `).join('')}
      </div>
    </div>

    <div style="background: #FEF3C7; padding: 14px; border-radius: 10px; border: 1px solid #FDE68A;">
      ${subtotal > 0 && (delFee > 0 || disc > 0) ? `
      <div style="display: flex; justify-content: space-between; font-size: 0.84rem; color: #78350F; margin-bottom: 4px;">
        <span>Food Subtotal:</span>
        <span style="font-weight: 600;">₹${subtotal.toLocaleString('en-IN')}</span>
      </div>
      ${delFee > 0 ? `
      <div style="display: flex; justify-content: space-between; font-size: 0.84rem; color: #78350F; margin-bottom: 4px;">
        <span>Delivery Fee:</span>
        <span style="font-weight: 600;">+₹${delFee.toLocaleString('en-IN')}</span>
      </div>` : ''}
      ${disc > 0 ? `
      <div style="display: flex; justify-content: space-between; font-size: 0.84rem; color: #047857; margin-bottom: 6px;">
        <span>Discount Savings:</span>
        <span style="font-weight: 600;">−₹${disc.toLocaleString('en-IN')}</span>
      </div>` : ''}
      <div style="border-top: 1px dashed #FCD34D; margin: 6px 0;"></div>
      ` : ''}
      <div style="display: flex; justify-content: space-between; font-size: 1.05rem; font-weight: 800; color: var(--owner-text);">
        <span>Total Bill Amount:</span>
        <span style="color: #B45309;">₹${rawTotal.toLocaleString('en-IN')}</span>
      </div>
      <div style="display: flex; justify-content: space-between; margin-top: 8px; font-size: 0.82rem;">
        <span style="color: #78350F;">Payment Mode:</span>
        <span>${isOnline ? '<strong style="color:#0F766E;">Online Prepaid (Bank/UPI)</strong>' : '<strong style="color:#B45309;">Cash on Delivery (COD)</strong>'}</span>
      </div>
      <div style="display: flex; justify-content: space-between; margin-top: 4px; font-size: 0.82rem;">
        <span style="color: #78350F;">Assigned Delivery Boy:</span>
        <strong style="color: var(--owner-text);">${order.assignedRiderName ? escapeHtml(order.assignedRiderName) : 'Unassigned'}</strong>
      </div>
      <div style="display: flex; justify-content: space-between; margin-top: 4px; font-size: 0.82rem;">
        <span style="color: #78350F;">Order Status:</span>
        <strong style="text-transform: capitalize; color: #047857;">${String(order.status || 'delivered').replace(/_/g, ' ')}</strong>
      </div>
    </div>
  `;

  modal.style.display = 'flex';
}

function closeInvoiceModal() {
  const modal = document.getElementById('owner-invoice-modal');
  if (modal) modal.style.display = 'none';
  activeModalOrder = null;
}

// ==============================================================
// 11. PRINTING & REPORT EXPORT
// ==============================================================
function initActions() {
  // Refresh Button
  const btnRefresh = document.getElementById('btn-owner-refresh');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', async () => {
      btnRefresh.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Refreshing...';
      await dataService.syncOrdersFromSupabase(true).catch(() => {});
      await dataService.syncRidersFromSupabase().catch(() => {});
      renderDashboard();
      setTimeout(() => {
        btnRefresh.innerHTML = '<i class="fa-solid fa-rotate"></i> <span class="hide-mobile">Refresh</span>';
      }, 400);
    });
  }

  // Print Executive Statement
  const btnPrint = document.getElementById('btn-owner-print');
  if (btnPrint) {
    btnPrint.addEventListener('click', () => printExecutiveReport());
  }

  // Export CSV
  const btnExport = document.getElementById('btn-owner-export-csv');
  if (btnExport) {
    btnExport.addEventListener('click', () => exportOrdersToCSV());
  }

  // Lock Dashboard
  const btnLock = document.getElementById('btn-owner-lock');
  if (btnLock) {
    btnLock.addEventListener('click', () => showPasscodeLock());
  }

  // Close Invoice Modal
  const btnCloseModal = document.getElementById('btn-close-invoice');
  const btnCloseModalTrigger = document.getElementById('btn-modal-close-trigger');
  const invoiceModal = document.getElementById('owner-invoice-modal');

  if (btnCloseModal) btnCloseModal.addEventListener('click', closeInvoiceModal);
  if (btnCloseModalTrigger) btnCloseModalTrigger.addEventListener('click', closeInvoiceModal);
  if (invoiceModal) {
    invoiceModal.addEventListener('click', (e) => {
      if (e.target === invoiceModal) closeInvoiceModal();
    });
  }

  // Print Single Invoice
  const btnPrintSingle = document.getElementById('btn-print-single-invoice');
  if (btnPrintSingle) {
    btnPrintSingle.addEventListener('click', () => {
      window.print();
    });
  }

  // Mobile Fast-Jump Navigation Tabs
  const mobileTabs = document.getElementById('owner-mobile-tabs');
  if (mobileTabs) {
    mobileTabs.addEventListener('click', (e) => {
      const tabBtn = e.target.closest('.owner-tab-btn');
      if (!tabBtn) return;
      const targetId = tabBtn.getAttribute('data-target');
      const targetEl = document.getElementById(targetId);

      mobileTabs.querySelectorAll('.owner-tab-btn').forEach(b => b.classList.remove('active'));
      tabBtn.classList.add('active');

      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  // Delivery Boys View Toggle (Cards vs Table)
  const riderViewToggle = document.getElementById('rider-view-toggle');
  if (riderViewToggle) {
    if (typeof window !== 'undefined' && window.innerWidth > 768) {
      riderViewToggle.querySelectorAll('.btn-view-toggle').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-view') === 'table');
      });
    }
    riderViewToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-view-toggle');
      if (!btn) return;
      const view = btn.getAttribute('data-view');
      riderViewToggle.querySelectorAll('.btn-view-toggle').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const cards = document.getElementById('rider-cards-container');
      const table = document.getElementById('rider-table-wrapper');
      if (view === 'table') {
        if (cards) cards.style.display = 'none';
        if (table) table.style.display = 'block';
      } else {
        if (cards) cards.style.display = 'grid';
        if (table) table.style.display = 'none';
      }
    });
  }

  // Delivery Fleet Onboarding & PIN Modal Controls
  const btnAddRider = document.getElementById('btn-owner-add-rider');
  const btnCloseRider = document.getElementById('btn-close-rider-modal');
  const btnCancelRider = document.getElementById('btn-cancel-rider-modal');
  const riderModal = document.getElementById('owner-rider-modal');
  const btnRegenPin = document.getElementById('btn-owner-regen-pin');
  const riderForm = document.getElementById('owner-rider-form');

  if (btnAddRider) {
    btnAddRider.addEventListener('click', () => openOwnerRiderModal());
  }
  if (btnCloseRider) {
    btnCloseRider.addEventListener('click', closeOwnerRiderModal);
  }
  if (btnCancelRider) {
    btnCancelRider.addEventListener('click', closeOwnerRiderModal);
  }
  if (riderModal) {
    riderModal.addEventListener('click', (e) => {
      if (e.target === riderModal) closeOwnerRiderModal();
    });
  }
  if (btnRegenPin) {
    btnRegenPin.addEventListener('click', () => {
      const pinInput = document.getElementById('owner-rider-pin');
      if (pinInput) {
        pinInput.value = dataService.generateUniqueRiderPin();
      }
    });
  }
  if (riderForm) {
    riderForm.addEventListener('submit', handleOwnerRiderSubmit);
  }

  // Track known orders on startup so existing orders don't re-trigger alerts
  function isOwnerOrderAlerted(orderId) {
    try {
      const stored = JSON.parse(localStorage.getItem('quickbite_owner_alerted_orders') || '{}');
      return Boolean(stored[orderId]);
    } catch {
      return false;
    }
  }

  function markOwnerOrderAlerted(orderId) {
    try {
      const stored = JSON.parse(localStorage.getItem('quickbite_owner_alerted_orders') || '{}');
      stored[orderId] = Date.now();
      const now = Date.now();
      const pruned = {};
      Object.keys(stored).forEach(k => {
        if (now - stored[k] < 7 * 24 * 60 * 60 * 1000) {
          pruned[k] = stored[k];
        }
      });
      localStorage.setItem('quickbite_owner_alerted_orders', JSON.stringify(pruned));
    } catch {}
  }

  const knownOwnerOrderIds = new Set((dataService.getOrders() || []).map(o => o.id));

  // Executive Notifications & Sound Controls
  const notifBanner = document.getElementById('owner-notif-optin-banner');
  const btnEnableNotifs = document.getElementById('btn-owner-enable-notifs');
  const btnDismissNotifs = document.getElementById('btn-owner-dismiss-notifs');
  const btnSoundTest = document.getElementById('btn-owner-sound-test');

  try {
    if (getSystemNotificationPermission() === 'default' && notifBanner) {
      const dismissed = sessionStorage.getItem('quickbite_owner_notif_dismissed');
      if (!dismissed) notifBanner.style.display = 'block';
    }
  } catch {}

  if (btnEnableNotifs) {
    btnEnableNotifs.addEventListener('click', async () => {
      const res = await requestSystemNotificationPermission();
      if (notifBanner) notifBanner.style.display = 'none';
      if (res === 'granted') {
        showToast('🔔 Executive alerts activated successfully!', 'success');
        playNotificationSound('payout_received');
        sendSystemNotification({
          title: '🔔 Executive Alerts Active',
          body: 'You will receive real-time chimes for cash handovers, payouts, and orders.',
          tag: 'owner-welcome'
        });
      } else {
        showToast('⚠️ Notifications not granted. Sound chimes will still play.', 'warning');
      }
    });
  }

  if (btnDismissNotifs) {
    btnDismissNotifs.addEventListener('click', () => {
      if (notifBanner) notifBanner.style.display = 'none';
      try { sessionStorage.setItem('quickbite_owner_notif_dismissed', 'true'); } catch {}
    });
  }

  if (btnSoundTest) {
    btnSoundTest.addEventListener('click', () => {
      playNotificationSound('payout_received');
      triggerDeviceVibration([80, 40, 80]);
      showToast('🔔 Playing Executive alert sound test...', 'info');
      if (getSystemNotificationPermission() === 'default') {
        requestSystemNotificationPermission().catch(() => {});
      }
    });
  }

  // Cross-tab and Realtime synchronization for riders, orders, cash handovers & payouts
  dataService.subscribeToChanges('riders', () => renderDashboard());
  dataService.subscribeToChanges('orders', () => {
    const orders = dataService.getOrders();
    let hasNewOrder = false;
    let latestNewOrder = null;
    const now = Date.now();
    orders.forEach(o => {
      if (o && o.id && !knownOwnerOrderIds.has(o.id)) {
        knownOwnerOrderIds.add(o.id);
        const orderAge = o.createdAt ? (now - Number(o.createdAt)) : 0;
        // Suppress alarms for stale/historical orders (>15 mins old) or already alerted orders
        if ((o.status === 'accepted' || o.status === 'pending') && orderAge < 15 * 60 * 1000 && !isOwnerOrderAlerted(o.id)) {
          hasNewOrder = true;
          latestNewOrder = o;
        }
      }
    });

    if (hasNewOrder && latestNewOrder) {
      markOwnerOrderAlerted(latestNewOrder.id);
      playNotificationSound('order_placed');
      flashTabTitle(`🔔 NEW ORDER: ${latestNewOrder.id}`);
      showToast(`🔔 New order received: ${latestNewOrder.id} (${latestNewOrder.total || '₹0'})`, 'info');
      sendSystemNotification({
        title: `🔔 New Order: ${latestNewOrder.id}`,
        body: `Customer ${latestNewOrder.customerName || 'Guest'} placed an order for ${latestNewOrder.total || '₹0'}`,
        tag: `owner-new-${latestNewOrder.id}`,
        data: { url: '/owner.html' }
      });
    }

    renderDashboard();
  });

  dataService.subscribeToChanges('cash_handover_requested', (data) => {
    const amt = Number(data?.amount || 0).toLocaleString('en-IN');
    playNotificationSound('rider_new_task');
    triggerDeviceVibration([200, 100, 200]);
    flashTabTitle('💵 CASH HANDOVER!');
    showToast(`🔔 Cash Handover: Rider submitted ₹${amt}!`, 'warning');
    sendSystemNotification({
      title: '💵 Cash Handover Pending',
      body: `Rider ${data?.riderName || ''} submitted ₹${amt}. Verify and confirm in drawer.`,
      tag: 'owner-cash-handover',
      data: { url: '/owner.html' }
    });
    renderDashboard();
  });

  dataService.subscribeToChanges('cash_settled', () => {
    playNotificationSound('accepted');
    renderDashboard();
  });

  dataService.subscribeToChanges('payout_paid', () => {
    playNotificationSound('payout_received');
    renderDashboard();
  });

  dataService.subscribeToChanges('km_rate_updated', () => renderDashboard());
  dataService.subscribeToChanges('payout_config_updated', () => renderDashboard());
}

// ==============================================================
// 10. OWNER FLEET ONBOARDING & PASSCODE MANAGEMENT
// ==============================================================
export function parseRiderVehicle(rawVehicle) {
  const str = String(rawVehicle || '').trim();
  if (!str) return { type: '🏍️ Bike', name: '' };

  let type = '🏍️ Bike';
  if (str.includes('🛵') || str.toLowerCase().includes('scooter')) {
    type = '🛵 Scooter';
  } else if (str.includes('🚲') || str.toLowerCase().includes('bicycle')) {
    type = '🚲 Bicycle';
  } else if (str.includes('🚗') || str.toLowerCase().includes('car')) {
    type = '🚗 Car';
  } else if (str.includes('⚡') || str.toLowerCase().includes('electric') || str.toLowerCase().includes('ev')) {
    type = '⚡ Electric / EV';
  } else {
    type = '🏍️ Bike';
  }

  let name = str.replace(/^[\p{Extended_Pictographic}\uFE0F\s]+/u, '').trim();
  const cleanCategory = type.replace(/^[\p{Extended_Pictographic}\uFE0F\s]+/u, '').trim().toLowerCase();
  if (name.toLowerCase() === cleanCategory || ['bike', 'scooter', 'bicycle', 'car', 'electric / ev', 'ev'].includes(name.toLowerCase())) {
    name = '';
  }

  return { type, name };
}

function openOwnerRiderModal(pin = null) {
  const modal = document.getElementById('owner-rider-modal');
  if (!modal) return;

  const modalTitle = document.getElementById('owner-rider-modal-title');
  const modalSubtitle = document.getElementById('owner-rider-modal-subtitle');
  const origPinInput = document.getElementById('owner-rider-original-pin');
  const pinInput = document.getElementById('owner-rider-pin');
  const nameInput = document.getElementById('owner-rider-name');
  const phoneInput = document.getElementById('owner-rider-phone');
  const vehicleSelect = document.getElementById('owner-rider-vehicle');
  const vehicleNameInput = document.getElementById('owner-rider-vehicle-name');

  if (pin) {
    const rider = dataService.getRiderByPin(pin);
    if (!rider) return;
    if (modalTitle) modalTitle.textContent = `Edit Delivery Boy: ${rider.name}`;
    if (modalSubtitle) modalSubtitle.textContent = 'Update profile details or regenerate confidential login PIN';
    if (origPinInput) origPinInput.value = rider.pin;
    if (pinInput) pinInput.value = rider.pin;
    if (nameInput) nameInput.value = rider.name || '';
    if (phoneInput) phoneInput.value = rider.phone || '';

    const parsed = parseRiderVehicle(rider.vehicle);
    if (vehicleSelect) vehicleSelect.value = rider.vehicleType || parsed.type;
    if (vehicleNameInput) vehicleNameInput.value = rider.vehicleName || parsed.name;
  } else {
    const generatedPin = dataService.generateUniqueRiderPin();
    if (modalTitle) modalTitle.textContent = 'Add Delivery Boy';
    if (modalSubtitle) modalSubtitle.textContent = 'Proprietor Fleet Onboarding & Secret Passcode Management';
    if (origPinInput) origPinInput.value = '';
    if (pinInput) pinInput.value = generatedPin;
    if (nameInput) nameInput.value = '';
    if (phoneInput) phoneInput.value = '';
    if (vehicleSelect) vehicleSelect.value = '🏍️ Bike';
    if (vehicleNameInput) vehicleNameInput.value = '';
  }

  modal.style.display = 'flex';
  if (nameInput) setTimeout(() => nameInput.focus(), 50);
}

function closeOwnerRiderModal() {
  const modal = document.getElementById('owner-rider-modal');
  if (modal) modal.style.display = 'none';
}

function deleteOwnerRider(pin) {
  if (!pin) return;
  const rider = dataService.getRiderByPin(pin);
  const riderName = rider ? rider.name : `PIN ${pin}`;
  if (confirm(`Are you sure you want to delete delivery boy "${riderName}" (PIN: ${pin})? This will permanently revoke their access to the Rider Portal.`)) {
    dataService.deleteRider(pin);
    renderDashboard();
    showToast(`🗑️ Delivery boy "${riderName}" deleted.`, 'info');
  }
}

function handleOwnerRiderSubmit(e) {
  if (e) e.preventDefault();
  const origPinInput = document.getElementById('owner-rider-original-pin');
  const pinInput = document.getElementById('owner-rider-pin');
  const nameInput = document.getElementById('owner-rider-name');
  const phoneInput = document.getElementById('owner-rider-phone');
  const vehicleSelect = document.getElementById('owner-rider-vehicle');
  const vehicleNameInput = document.getElementById('owner-rider-vehicle-name');

  const originalPin = (origPinInput?.value || '').trim();
  let pin = (pinInput?.value || '').trim();
  const name = (nameInput?.value || '').trim();
  const phone = (phoneInput?.value || '').trim();
  const vehicleType = (vehicleSelect?.value || '🏍️ Bike').trim();
  const vehicleName = (vehicleNameInput?.value || '').trim();

  // Combine Type emoji and Vehicle Name (e.g., "🏍️ Honda Activa", "🛵 TVS Jupiter", or "🏍️ Bike" if name is blank)
  const emoji = vehicleType.split(' ')[0] || '🏍️';
  const vehicle = vehicleName ? `${emoji} ${vehicleName}` : vehicleType;

  if (!name) {
    showToast('⚠️ Please enter delivery boy full name.', 'warning');
    return;
  }
  const cleanDigits = phone.replace(/\D/g, '');
  if (!phone || cleanDigits.length < 10) {
    showToast('⚠️ Please enter a valid 10-digit mobile phone number.', 'warning');
    return;
  }
  if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
    pin = dataService.generateUniqueRiderPin();
  }

  // If changing PIN or adding new, check collision
  if ((!originalPin || originalPin !== pin) && dataService.getRiderByPin(pin)) {
    pin = dataService.generateUniqueRiderPin();
  }

  let saved;
  const formattedPhone = phone.startsWith('+') ? phone : (cleanDigits.length === 10 ? `+91 ${cleanDigits.slice(0, 5)} ${cleanDigits.slice(5)}` : phone);

  if (originalPin && originalPin !== pin) {
    const existingRider = dataService.getRiderByPin(originalPin) || {};
    const updatedRider = {
      ...existingRider,
      pin,
      name,
      phone: formattedPhone,
      vehicle,
      vehicleType,
      vehicleName
    };

    // Reassign existing orders pointing to originalPin so deliveries and cash records are preserved
    const allOrders = dataService.getOrders();
    let ordersChanged = false;
    allOrders.forEach(o => {
      if (o && String(o.assignedRiderPin) === String(originalPin)) {
        o.assignedRiderPin = pin;
        o.assignedRiderName = name;
        ordersChanged = true;
      }
    });
    if (ordersChanged) {
      dataService.saveOrders(allOrders);
    }

    // Delete old PIN entry and save updated rider
    dataService.deleteRider(originalPin);
    saved = dataService.saveOrUpdateRider(updatedRider);
  } else {
    saved = dataService.saveOrUpdateRider({ pin, name, phone: formattedPhone, vehicle, vehicleType, vehicleName });
  }

  closeOwnerRiderModal();
  renderDashboard();
  showToast(`✅ Delivery boy "${saved.name}" saved! Secret Login PIN: ${saved.pin}`, 'success');
}

// ==============================================================
// 11. NAVIGATION BAR & VIEW SWITCHING CONTROLLER
// ==============================================================
function initNavigation() {
  const navBtns = document.querySelectorAll('.owner-nav-btn');
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-target');
      if (target) switchOwnerView(target);
    });
  });

  // Toggles for Cash View
  const cashViewToggle = document.getElementById('cash-view-toggle');
  if (cashViewToggle) {
    if (typeof window !== 'undefined' && window.innerWidth > 768) {
      cashViewToggle.querySelectorAll('.btn-view-toggle').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-view') === 'table');
      });
    }
    cashViewToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-view-toggle');
      if (!btn) return;
      const view = btn.getAttribute('data-view');
      cashViewToggle.querySelectorAll('.btn-view-toggle').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const cards = document.getElementById('cash-cards-container');
      const table = document.getElementById('cash-table-wrapper');
      if (view === 'table') {
        if (cards) cards.style.display = 'none';
        if (table) table.style.display = 'block';
      } else {
        if (cards) cards.style.display = 'grid';
        if (table) table.style.display = 'none';
      }
    });
  }

  // Toggles for Payout View
  const payoutViewToggle = document.getElementById('payout-view-toggle');
  if (payoutViewToggle) {
    if (typeof window !== 'undefined' && window.innerWidth > 768) {
      payoutViewToggle.querySelectorAll('.btn-view-toggle').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-view') === 'table');
      });
    }
    payoutViewToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-view-toggle');
      if (!btn) return;
      const view = btn.getAttribute('data-view');
      payoutViewToggle.querySelectorAll('.btn-view-toggle').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const cards = document.getElementById('payout-cards-container');
      const table = document.getElementById('payout-table-wrapper');
      if (view === 'table') {
        if (cards) cards.style.display = 'none';
        if (table) table.style.display = 'block';
      } else {
        if (cards) cards.style.display = 'grid';
        if (table) table.style.display = 'none';
      }
    });
  }

  // 3 Payout Compensation Method Buttons Selection (Opens Settings Directly or Toggles)
  document.querySelectorAll('.payout-method-card').forEach(card => {
    card.addEventListener('click', () => {
      const method = card.getAttribute('data-method');
      if (!method) return;
      const cfg = dataService.getPayoutConfig();
      const prevMethod = cfg.activeMethod;
      cfg.activeMethod = method;
      dataService.savePayoutConfig(cfg);
      syncPayoutConfigUI();
      renderDashboard();
      const methodNames = {
        'tiered_standard': 'Tiered Standard Base Pay',
        'tiered_milestone': 'Tiered + Milestone Volume Incentive',
        'flat_linear': 'Flat Linear Rate'
      };

      if (prevMethod === method && isPayoutSettingsOpen) {
        closePayoutSettingsPanel();
        showToast(`Settings closed for ${methodNames[method] || method}`, 'info');
      } else {
        openPayoutSettingsPanel(true);
        showToast(`⚙️ Settings Opened: ${methodNames[method] || method}`, 'success');
      }
    });
  });

  // Old handler placeholder removed

  // Parameter Adjustment Steppers [ - ] and [ + ]
  document.querySelectorAll('.btn-step').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.getAttribute('data-action');
      const targetId = btn.getAttribute('data-target');
      const step = parseFloat(btn.getAttribute('data-step')) || 1;
      const input = document.getElementById(targetId);
      if (!input) return;

      const current = parseFloat(input.value) || 0;
      const min = input.hasAttribute('min') ? parseFloat(input.getAttribute('min')) : 0;
      const max = input.hasAttribute('max') ? parseFloat(input.getAttribute('max')) : 9999;

      let next = action === 'inc' ? (current + step) : (current - step);
      if (next < min) next = min;
      if (next > max) next = max;

      input.value = step < 1 ? next.toFixed(1) : Math.round(next);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      updateLiveSimulatorPreview();
    });
  });

  // Live recalculate simulator on numeric inputs change
  document.querySelectorAll('#payout-settings-panel input[type="number"]').forEach(input => {
    input.addEventListener('input', () => updateLiveSimulatorPreview());
    input.addEventListener('change', () => updateLiveSimulatorPreview());
  });

  // Flat Linear Presets Chips
  document.querySelectorAll('.btn-fl-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const rate = parseFloat(btn.getAttribute('data-rate'));
      const input = document.getElementById('cfg-fl-rate');
      if (rate && input) {
        input.value = rate;
        document.querySelectorAll('.btn-fl-preset').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        updateLiveSimulatorPreview();
      }
    });
  });

  // Live Trip Distance Simulator Stepper
  const btnSimDec = document.getElementById('btn-sim-dec');
  const btnSimInc = document.getElementById('btn-sim-inc');
  const simInput = document.getElementById('sim-trip-distance');
  if (btnSimDec && simInput) {
    btnSimDec.addEventListener('click', () => {
      const val = parseFloat(simInput.value) || 1.31;
      simInput.value = Math.max(0.1, val - 0.1).toFixed(2);
      updateLiveSimulatorPreview();
    });
  }
  if (btnSimInc && simInput) {
    btnSimInc.addEventListener('click', () => {
      const val = parseFloat(simInput.value) || 1.31;
      simInput.value = (val + 0.1).toFixed(2);
      updateLiveSimulatorPreview();
    });
  }

  // Save Payout Settings Button (Saves and Automatically Closes Settings)
  const btnSavePayout = document.getElementById('btn-save-payout-config');
  if (btnSavePayout) {
    btnSavePayout.addEventListener('click', () => {
      const newCfg = readCurrentPayoutConfigFromUI();
      const saved = dataService.savePayoutConfig(newCfg);
      syncPayoutConfigUI();
      renderDashboard();

      // Automatically close settings panel after saving
      closePayoutSettingsPanel();

      showToast('✓ Payout settings saved & closed!', 'success');
    });
  }

  // Close Payout Settings Button (without saving)
  const btnClosePayout = document.getElementById('btn-close-payout-config');
  if (btnClosePayout) {
    btnClosePayout.addEventListener('click', () => {
      syncPayoutConfigUI(); // Revert modified stepper inputs back to persisted config
      closePayoutSettingsPanel();
      showToast('Payout settings closed (unsaved changes discarded)', 'info');
    });
  }

  // Backwards compatibility handlers for legacy KM rate inputs
  const inputKmRate = document.getElementById('input-km-rate');
  const btnSaveKmRate = document.getElementById('btn-save-km-rate');
  if (inputKmRate) {
    inputKmRate.value = dataService.getKmPayoutRate();
  }
  if (btnSaveKmRate) {
    btnSaveKmRate.addEventListener('click', () => {
      if (!inputKmRate) return;
      const val = parseFloat(inputKmRate.value);
      if (isNaN(val) || val <= 0) return;
      dataService.setKmPayoutRate(val);
      syncPayoutConfigUI();
      renderDashboard();
    });
  }
}

function switchOwnerView(viewId) {
  activeView = viewId;
  const navBtns = document.querySelectorAll('.owner-nav-btn');
  navBtns.forEach(btn => {
    if (btn.getAttribute('data-target') === viewId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  const views = document.querySelectorAll('.owner-view-tab');
  views.forEach(v => {
    if (v.id === viewId) {
      v.style.display = 'block';
      v.classList.add('active');
    } else {
      v.style.display = 'none';
      v.classList.remove('active');
    }
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
  renderDashboard();
}

function updateNavigationBadges(orders) {
  // Live orders badge (pending, accepted, cooking, ready, on_the_way)
  const badgeOrders = document.getElementById('nav-badge-orders');
  if (badgeOrders) {
    const liveCount = orders.filter(o => ['pending', 'accepted', 'cooking', 'ready', 'ready_for_pickup', 'on_the_way'].includes(String(o?.status).toLowerCase())).length;
    badgeOrders.textContent = liveCount;
  }

  // Cash alert badge (count pending cash handovers or total with cash)
  const badgeCash = document.getElementById('nav-badge-cash');
  if (badgeCash) {
    const riders = dataService.getRiders();
    const pendingHandovers = riders.filter(r => r.cashHandoverStatus === 'pending_owner_approval');
    if (pendingHandovers.length > 0) {
      badgeCash.textContent = pendingHandovers.length;
      badgeCash.style.display = 'flex';
      badgeCash.classList.add('alert');
    } else {
      badgeCash.style.display = 'none';
      badgeCash.classList.remove('alert');
    }
  }

  // Fleet badge
  const badgeFleet = document.getElementById('nav-badge-fleet');
  if (badgeFleet) {
    const riders = dataService.getRiders();
    badgeFleet.textContent = riders.length;
  }
}

// ==============================================================
// 12. CASH COLLECTIONS & HANDOVER CONTROLLER (Mark as Taken)
// ==============================================================
function renderCashSettlementsView(orders) {
  const cardsContainer = document.getElementById('cash-cards-container');
  const tbody = document.getElementById('cash-table-body');
  const alertBanner = document.getElementById('cash-alert-banner');
  if (!cardsContainer && !tbody) return;

  try {
    const rawRiders = dataService.getRiders();
    const riders = Array.isArray(rawRiders) ? rawRiders.filter(r => r && typeof r === 'object') : [];
    const pendingHandovers = riders.filter(r => r.cashHandoverStatus === 'pending_owner_approval');

    // 1. Alert Banner
    if (alertBanner) {
      if (pendingHandovers.length > 0) {
        const names = pendingHandovers.map(r => r.name || `Rider ${r.pin || ''}`).join(', ');
        const totalPending = pendingHandovers.reduce((sum, r) => sum + (Number(r.cashHandoverAmount) || 0), 0);
        const titleEl = document.getElementById('cash-alert-title');
        const descEl = document.getElementById('cash-alert-desc');
        if (titleEl) titleEl.textContent = `⚠️ Pending COD Cash Handover (${pendingHandovers.length} Rider${pendingHandovers.length > 1 ? 's' : ''})!`;
        if (descEl) descEl.textContent = `${names} submitted ₹${formatInr(totalPending)} cash. Please collect physical cash and click "Mark as Taken".`;
        alertBanner.style.display = 'flex';
      } else {
        alertBanner.style.display = 'none';
      }
    }

    if (!riders || riders.length === 0) {
      if (cardsContainer) {
        cardsContainer.innerHTML = `
          <div class="owner-empty-card" style="grid-column: 1 / -1;">
            <i class="fa-solid fa-vault"></i>
            <p>No delivery boys registered in fleet yet.</p>
          </div>
        `;
      }
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" style="text-align: center; padding: 32px 16px; color: var(--owner-text-muted);">
              No delivery boys registered in fleet yet.
            </td>
          </tr>
        `;
      }
      return;
    }

    // Build rows & cards
    const cashList = riders.map(r => {
      let summary = null;
      try {
        summary = dataService.getRiderCashSummary(r.pin);
      } catch (sumErr) {
        console.warn('[Owner] getRiderCashSummary error for rider:', r.pin, sumErr);
      }
      const rawCashInHand = r.cashHandoverAmount ? Number(r.cashHandoverAmount) : (summary?.cashInHand ?? 0);
      const cashInHand = isNaN(rawCashInHand) ? 0 : rawCashInHand;
      const codOrdersCount = Array.isArray(summary?.codOrders) ? summary.codOrders.length : 0;
      const isPending = r.cashHandoverStatus === 'pending_owner_approval';
      const lastTakenTime = r.cashTakenAt ? new Date(r.cashTakenAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : 'Not yet today';

      return {
        pin: String(r.pin || '').trim(),
        name: String(r.name || `Rider ${r.pin || ''}`).trim() || 'Delivery Partner',
        phone: String(r.phone || '').trim(),
        vehicle: String(r.vehicle || '🏍️ Bike').trim(),
        cashInHand,
        codOrdersCount,
        isPending,
        lastTakenTime
      };
    });

    // Render Table
    if (tbody) {
      tbody.innerHTML = cashList.map(st => {
        let statusBadge = '';
        let actionBtn = '';

        if (st.isPending) {
          statusBadge = `<span class="badge-handover-pending"><i class="fa-solid fa-triangle-exclamation"></i> Submitted (₹${formatInr(st.cashInHand)})</span>`;
          actionBtn = `
            <button type="button" class="btn-mark-cash-taken" data-pin="${escapeHtml(st.pin)}" data-amount="${st.cashInHand}">
              <i class="fa-solid fa-hand-holding-dollar"></i> Mark as Taken (₹${formatInr(st.cashInHand)})
            </button>
          `;
        } else if (st.cashInHand > 0) {
          statusBadge = `<span class="badge-payout-pending"><i class="fa-solid fa-money-bill"></i> In Rider Hand (₹${formatInr(st.cashInHand)})</span>`;
          actionBtn = `
            <button type="button" class="btn-mark-cash-taken" data-pin="${escapeHtml(st.pin)}" data-amount="${st.cashInHand}">
              <i class="fa-solid fa-hand-holding-dollar"></i> Mark as Taken (₹${formatInr(st.cashInHand)})
            </button>
          `;
        } else {
          statusBadge = `<span class="badge-payout-paid"><i class="fa-solid fa-circle-check"></i> Settled (₹0)</span>`;
          actionBtn = `<button type="button" class="btn-mark-cash-taken" disabled><i class="fa-solid fa-check"></i> Taken</button>`;
        }

        return `
          <tr>
            <td>
              <div class="rider-cell-meta">
                <div class="rider-avatar-bubble">${escapeHtml(getRiderInitial(st.name))}</div>
                <div class="rider-name-box">
                  <span class="rider-name">${escapeHtml(st.name)}</span>
                  ${st.phone ? `<a href="tel:${sanitizePhone(st.phone)}" class="rider-phone-link"><i class="fa-solid fa-phone"></i> ${escapeHtml(st.phone)}</a>` : ''}
                </div>
              </div>
            </td>
            <td><span style="font-size:0.8rem; color:var(--owner-text-muted);">${escapeHtml(st.vehicle)}</span></td>
            <td class="text-center font-bold">${st.codOrdersCount}</td>
            <td class="text-right num-amber" style="font-size: 0.95rem; font-weight: 800;">₹${formatInr(st.cashInHand)}</td>
            <td><span style="font-size: 0.78rem; color: var(--owner-text-muted);">${st.lastTakenTime}</span></td>
            <td class="text-center">${actionBtn}</td>
          </tr>
        `;
      }).join('');
    }

    // Render Mobile Cards
    if (cardsContainer) {
      cardsContainer.innerHTML = cashList.map(st => {
        let cardBorder = st.isPending ? 'border-left: 4px solid #EF4444;' : (st.cashInHand > 0 ? 'border-left: 4px solid #F59E0B;' : 'border-left: 4px solid #10B981;');
        let statusText = st.isPending ? '⚠️ Rider Submitted Cash • Waiting for your Confirmation' : (st.cashInHand > 0 ? '💵 Physical cash currently with rider' : '✅ All collected cash deposited into counter drawer');

        return `
          <div class="rider-card-mobile" style="${cardBorder}">
            <div class="rc-header">
              <div class="rc-profile">
                <div class="rider-avatar-bubble">${escapeHtml(getRiderInitial(st.name))}</div>
                <div>
                  <h4 class="rc-name">${escapeHtml(st.name)}</h4>
                  <span class="rc-vehicle">${escapeHtml(st.vehicle)}</span>
                </div>
              </div>
              ${st.phone ? `<a href="tel:${sanitizePhone(st.phone)}" class="rc-call-btn"><i class="fa-solid fa-phone"></i> Call</a>` : ''}
            </div>

            <div class="rc-settle-box" style="margin-top: 10px;">
              <div class="rc-settle-meta">
                <span class="rc-settle-title">${st.isPending ? 'HANDOVER SUBMITTED' : 'COD CASH BALANCE'}</span>
                <span class="rc-settle-formula">${statusText}</span>
              </div>
              <div class="rc-settle-amount num-amber" style="font-size: 1.25rem; font-weight: 800;">
                ₹${formatInr(st.cashInHand)}
              </div>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px; gap: 8px;">
              <span style="font-size: 0.76rem; color: #94A3B8;"><i class="fa-regular fa-clock"></i> Last taken: ${st.lastTakenTime}</span>
              ${st.cashInHand > 0 ? `
                <button type="button" class="btn-mark-cash-taken" data-pin="${escapeHtml(st.pin)}" data-amount="${st.cashInHand}">
                  <i class="fa-solid fa-hand-holding-dollar"></i> Mark as Taken (₹${formatInr(st.cashInHand)})
                </button>
              ` : `
                <button type="button" class="btn-mark-cash-taken" disabled style="opacity:0.4; cursor:default;">
                  <i class="fa-solid fa-check"></i> Taken
                </button>
              `}
            </div>
          </div>
        `;
      }).join('');
    }
  } catch (err) {
    console.error('[Owner] renderCashSettlementsView failed:', err);
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 28px 16px; color: var(--owner-text-muted);">
            <i class="fa-solid fa-triangle-exclamation" style="color: #F59E0B; font-size: 1.4rem; margin-bottom: 6px; display: block;"></i>
            Unable to load cash settlement records. Tap Refresh to retry.
          </td>
        </tr>
      `;
    }
  }

  // Wire Mark as Taken button listeners
  document.querySelectorAll('.btn-mark-cash-taken').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const pin = btn.getAttribute('data-pin');
      const amount = btn.getAttribute('data-amount');
      if (!pin) return;
      const res = dataService.confirmRiderCashTaken(pin);
      if (res.success) {
        showToast(`💵 Confirmed! ₹${Number(amount || res.amount).toLocaleString('en-IN')} marked as taken from ${res.rider.name} into drawer!`, 'success');
        renderDashboard();
      }
    };
  });
}

// ==============================================================
// 13. RIDER PAYOUT MODELS & DAILY SETTLEMENT CONTROLLER
// ==============================================================

function openPayoutSettingsPanel(scroll = true) {
  const panel = document.getElementById('payout-settings-panel');
  if (!panel) return;
  isPayoutSettingsOpen = true;
  panel.style.display = 'block';
  panel.classList.remove('panel-opened-pulse');
  void panel.offsetWidth;
  panel.classList.add('panel-opened-pulse');

  if (scroll) {
    setTimeout(() => {
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 40);
  }
  updatePayoutButtonHints();
}

function closePayoutSettingsPanel() {
  const panel = document.getElementById('payout-settings-panel');
  if (!panel) return;
  isPayoutSettingsOpen = false;
  panel.style.display = 'none';
  updatePayoutButtonHints();
}

function updatePayoutButtonHints() {
  const cfg = dataService.getPayoutConfig() || DEFAULT_PAYOUT_CONFIG;
  const currentMethod = cfg?.activeMethod || 'tiered_standard';
  document.querySelectorAll('.payout-method-card').forEach(card => {
    const m = card.getAttribute('data-method');
    const isAct = m === currentMethod;
    const hint = card.querySelector('.pm-open-hint');
    if (hint) {
      if (isAct) {
        hint.innerHTML = isPayoutSettingsOpen 
          ? '<i class="fa-solid fa-sliders"></i> Settings Open ▾' 
          : '<i class="fa-solid fa-pen-to-square"></i> Tap to Edit Settings';
      } else {
        hint.innerHTML = '<i class="fa-solid fa-arrow-down"></i> Open Settings';
      }
    }
  });
}

function syncPayoutConfigUI() {
  try {
    const cfg = dataService.getPayoutConfig() || DEFAULT_PAYOUT_CONFIG;
    const method = cfg?.activeMethod || 'tiered_standard';

  // 1. Update active button styling & aria attributes
  document.querySelectorAll('.payout-method-card').forEach(card => {
    const m = card.getAttribute('data-method');
    const isAct = m === method;
    card.classList.toggle('active', isAct);
    card.setAttribute('aria-selected', isAct ? 'true' : 'false');
    const radio = card.querySelector('.pm-radio');
    if (radio) {
      radio.innerHTML = isAct ? '<i class="fa-solid fa-circle-check"></i>' : '<i class="fa-regular fa-circle"></i>';
    }
    const hint = card.querySelector('.pm-open-hint');
    if (hint) {
      hint.innerHTML = isAct 
        ? (isPayoutSettingsOpen ? '<i class="fa-solid fa-sliders"></i> Settings Open' : '<i class="fa-solid fa-pen-to-square"></i> Tap to Edit Settings')
        : '<i class="fa-solid fa-arrow-down"></i> Open Settings';
    }
  });

  // 2. Update active pill text
  const badgeText = document.getElementById('active-model-name-text');
  if (badgeText) {
    if (method === 'tiered_standard') badgeText.textContent = 'Tiered Standard Base Pay';
    else if (method === 'tiered_milestone') badgeText.textContent = 'Tiered + Milestone Volume Incentive';
    else badgeText.textContent = 'Flat Linear Rate';
  }

  // 3. Update settings panel title & controls visibility
  const panelTitle = document.getElementById('panel-active-title');
  if (panelTitle) {
    if (method === 'tiered_standard') panelTitle.textContent = 'Tiered Standard Base Pay Settings';
    else if (method === 'tiered_milestone') panelTitle.textContent = 'Tiered + Milestone Incentive Settings';
    else panelTitle.textContent = 'Flat Linear Rate Settings';
  }

  const grpTS = document.getElementById('controls-tiered-standard');
  const grpTM = document.getElementById('controls-tiered-milestone');
  const grpFL = document.getElementById('controls-flat-linear');
  if (grpTS) grpTS.style.display = method === 'tiered_standard' ? 'block' : 'none';
  if (grpTM) grpTM.style.display = method === 'tiered_milestone' ? 'block' : 'none';
  if (grpFL) grpFL.style.display = method === 'flat_linear' ? 'block' : 'none';

  // 4. Populate input values if user is not actively typing in them
  const activeEl = document.activeElement;
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el && el !== activeEl) el.value = val;
  };

  setVal('cfg-ts-base-pay', cfg.tieredStandard.basePay);
  setVal('cfg-ts-base-km', cfg.tieredStandard.baseKm);
  setVal('cfg-ts-extra-km', cfg.tieredStandard.extraKmRate);

  setVal('cfg-tm-base-pay', cfg.tieredMilestone.basePay);
  setVal('cfg-tm-base-km', cfg.tieredMilestone.baseKm);
  setVal('cfg-tm-extra-km', cfg.tieredMilestone.extraKmRate);
  setVal('cfg-tm-milestone', cfg.tieredMilestone.milestoneOrders);
  setVal('cfg-tm-surge-km', cfg.tieredMilestone.surgeExtraKmRate);

  setVal('cfg-fl-rate', cfg.flatLinear.ratePerKm);

  // Update card formula tags
  const fTS = document.getElementById('formula-tag-ts');
  if (fTS) fTS.textContent = `₹${cfg.tieredStandard.basePay} first ${cfg.tieredStandard.baseKm}km + ₹${cfg.tieredStandard.extraKmRate}/km extra`;

  const fTM = document.getElementById('formula-tag-tm');
  if (fTM) fTM.textContent = `₹${cfg.tieredMilestone.basePay} base + ₹${cfg.tieredMilestone.extraKmRate}/km (1-${cfg.tieredMilestone.milestoneOrders}) → ₹${cfg.tieredMilestone.surgeExtraKmRate}/km (${cfg.tieredMilestone.milestoneOrders + 1}+)`;

  const fFL = document.getElementById('formula-tag-fl');
  if (fFL) fFL.textContent = `₹${cfg.flatLinear.ratePerKm} per exact road km`;

  // Update card dynamic example calculations (based on 1.31 km standard trip)
  const calc1 = dataService.calculateOrderPayout({ addressDetails: { distanceKm: 1.31 } }, 1, { ...cfg, activeMethod: 'tiered_standard' });
  const exTS = document.getElementById('example-ts-calc');
  if (exTS) exTS.textContent = `₹${calc1.amount.toFixed(2)}`;

  const calc2Early = dataService.calculateOrderPayout({ addressDetails: { distanceKm: 1.31 } }, 1, { ...cfg, activeMethod: 'tiered_milestone' });
  const calc2Surge = dataService.calculateOrderPayout({ addressDetails: { distanceKm: 1.31 } }, cfg.tieredMilestone.milestoneOrders + 1, { ...cfg, activeMethod: 'tiered_milestone' });
  const exTM = document.getElementById('example-tm-calc');
  if (exTM) exTM.innerHTML = `1-${cfg.tieredMilestone.milestoneOrders}: <strong>₹${calc2Early.amount.toFixed(2)}</strong> • ${cfg.tieredMilestone.milestoneOrders + 1}+: <strong class="pm-highlight-purple">₹${calc2Surge.amount.toFixed(2)}</strong>`;

  const calc3 = dataService.calculateOrderPayout({ addressDetails: { distanceKm: 1.31 } }, 1, { ...cfg, activeMethod: 'flat_linear' });
  const exFL = document.getElementById('example-fl-calc');
  if (exFL) exFL.textContent = `₹${calc3.amount.toFixed(2)}`;

  // Update Active Model Overview Banner inside settings panel
  const pamsBadge = document.getElementById('ams-badge');
  const pamsRate = document.getElementById('ams-rate-pill');
  const pamsCalc = document.getElementById('ams-calc-text');
  const pamsDesc = document.getElementById('ams-desc');

  if (method === 'tiered_standard') {
    if (pamsBadge) {
      pamsBadge.className = 'ams-badge badge-green';
      pamsBadge.innerHTML = '<i class="fa-solid fa-shield-halved"></i> Recommended Model';
    }
    if (pamsRate) pamsRate.textContent = `₹${cfg.tieredStandard.basePay} first ${cfg.tieredStandard.baseKm}km + ₹${cfg.tieredStandard.extraKmRate}/km extra`;
    if (pamsCalc) pamsCalc.textContent = `₹${calc1.amount.toFixed(2)}`;
    if (pamsDesc) pamsDesc.textContent = 'Guaranteed base pay protects profit margins on short trips while ensuring fair pay for deliveries beyond base distance.';
  } else if (method === 'tiered_milestone') {
    if (pamsBadge) {
      pamsBadge.className = 'ams-badge badge-purple';
      pamsBadge.innerHTML = '<i class="fa-solid fa-fire"></i> High Volume Fleet';
    }
    if (pamsRate) pamsRate.textContent = `₹${cfg.tieredMilestone.basePay} base + ₹${cfg.tieredMilestone.extraKmRate}/km (1-${cfg.tieredMilestone.milestoneOrders}) → ₹${cfg.tieredMilestone.surgeExtraKmRate}/km (${cfg.tieredMilestone.milestoneOrders + 1}+)`;
    if (pamsCalc) pamsCalc.textContent = `₹${calc2Early.amount.toFixed(2)} (surge: ₹${calc2Surge.amount.toFixed(2)})`;
    if (pamsDesc) pamsDesc.textContent = `Regular rate for orders 1-${cfg.tieredMilestone.milestoneOrders}. Rate automatically surges to reward hardworking riders from order ${cfg.tieredMilestone.milestoneOrders + 1} onward.`;
  } else {
    if (pamsBadge) {
      pamsBadge.className = 'ams-badge badge-amber';
      pamsBadge.innerHTML = '<i class="fa-solid fa-road"></i> Direct Distance';
    }
    if (pamsRate) pamsRate.textContent = `₹${cfg.flatLinear.ratePerKm} per exact road km`;
    if (pamsCalc) pamsCalc.textContent = `₹${calc3.amount.toFixed(2)}`;
    if (pamsDesc) pamsDesc.textContent = 'Straight payout per kilometer driven without fixed base fare. Benchmark model for transparent distance compensation.';
  }

  // Update active preset chip in flat linear
  document.querySelectorAll('.btn-fl-preset').forEach(btn => {
    const r = parseFloat(btn.getAttribute('data-rate'));
    btn.classList.toggle('active', r === cfg.flatLinear.ratePerKm);
  });

  updateLiveSimulatorPreview();
  updatePayoutButtonHints();
  } catch (err) {
    console.warn('[Owner] syncPayoutConfigUI warning:', err);
  }
}

function readCurrentPayoutConfigFromUI() {
  const currentCfg = dataService.getPayoutConfig();
  const activeCard = document.querySelector('.payout-method-card.active');
  const activeMethod = activeCard ? activeCard.getAttribute('data-method') : currentCfg.activeMethod;

  const numVal = (id, fallback) => {
    const el = document.getElementById(id);
    if (!el) return fallback;
    const v = parseFloat(el.value);
    return !isNaN(v) ? v : fallback;
  };

  return {
    activeMethod: activeMethod || 'tiered_standard',
    tieredStandard: {
      basePay: numVal('cfg-ts-base-pay', 25),
      baseKm: numVal('cfg-ts-base-km', 1.0),
      extraKmRate: numVal('cfg-ts-extra-km', 10)
    },
    tieredMilestone: {
      basePay: numVal('cfg-tm-base-pay', 25),
      baseKm: numVal('cfg-tm-base-km', 1.0),
      extraKmRate: numVal('cfg-tm-extra-km', 10),
      milestoneOrders: Math.round(numVal('cfg-tm-milestone', 10)),
      surgeExtraKmRate: numVal('cfg-tm-surge-km', 15)
    },
    flatLinear: {
      ratePerKm: numVal('cfg-fl-rate', 30)
    }
  };
}

function updateLiveSimulatorPreview() {
  const simInput = document.getElementById('sim-trip-distance');
  const dist = simInput ? Math.max(0.1, parseFloat(simInput.value) || 1.31) : 1.31;
  const cfg = readCurrentPayoutConfigFromUI();

  const result = dataService.calculateOrderPayout({ addressDetails: { distanceKm: dist } }, 1, cfg);
  const valEl = document.getElementById('sim-payout-val');
  const textEl = document.getElementById('sim-breakdown-text');
  if (valEl) valEl.textContent = `₹${result.amount.toFixed(2)}`;

  if (textEl) {
    if (cfg.activeMethod === 'tiered_milestone') {
      const surgeRes = dataService.calculateOrderPayout({ addressDetails: { distanceKm: dist } }, cfg.tieredMilestone.milestoneOrders + 1, cfg);
      textEl.innerHTML = `Orders 1–${cfg.tieredMilestone.milestoneOrders}: <strong>₹${result.amount.toFixed(2)}</strong> (${result.formula}) • Order ${cfg.tieredMilestone.milestoneOrders + 1}+: <strong style="color:#7C3AED;">₹${surgeRes.amount.toFixed(2)}</strong> (${surgeRes.formula})`;
    } else {
      textEl.textContent = result.formula;
    }
  }
}

function renderKmPayoutsView(orders) {
  const cardsContainer = document.getElementById('payout-cards-container');
  const tbody = document.getElementById('payout-table-body');
  if (!cardsContainer && !tbody) return;

  try {
    // Sync Payout Method UI
    syncPayoutConfigUI();

    const rawRiders = dataService.getRiders();
    const payoutConfig = dataService.getPayoutConfig() || DEFAULT_PAYOUT_CONFIG;
    const validRiders = Array.isArray(rawRiders) ? rawRiders.filter(r => r && typeof r === 'object') : [];

    if (validRiders.length === 0) {
      if (cardsContainer) {
        cardsContainer.innerHTML = `
          <div class="owner-empty-card" style="grid-column: 1 / -1;">
            <i class="fa-solid fa-calculator"></i>
            <p>No delivery boys registered in fleet yet.</p>
          </div>
        `;
      }
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="9" style="text-align: center; padding: 32px 16px; color: var(--owner-text-muted);">
              No delivery boys registered in fleet yet.
            </td>
          </tr>
        `;
      }
      return;
    }

    const safeOrders = Array.isArray(orders) ? orders : [];
    const deliveredOrders = safeOrders.filter(o => o && String(o.status || '').toLowerCase() === 'delivered');

    // Pre-index delivered orders by rider PIN and name for high-performance O(1) matching with 100+ riders
    const ordersByPin = new Map();
    const ordersByName = new Map();

    deliveredOrders.forEach(o => {
      const oPin = String(o.assignedRiderPin || '').trim();
      const oName = String(o.assignedRiderName || '').trim().toLowerCase();
      if (oPin) {
        if (!ordersByPin.has(oPin)) ordersByPin.set(oPin, []);
        ordersByPin.get(oPin).push(o);
      } else if (oName) {
        if (!ordersByName.has(oName)) ordersByName.set(oName, []);
        ordersByName.get(oName).push(o);
      }
    });

    const safeNumber = (val) => {
      const n = Number(val);
      return isNaN(n) ? 0 : n;
    };

    const payoutList = validRiders.map(r => {
      const riderPinStr = String(r.pin || '').trim();
      const riderNameStr = String(r.name || `Rider ${riderPinStr || ''}`).trim() || 'Delivery Partner';
      const riderInitial = getRiderInitial(riderNameStr);
      const riderPhone = String(r.phone || '').trim();
      const riderVehicle = String(r.vehicle || '🏍️ Bike').trim();

      // Find matching delivered orders from indexed maps
      const pinOrders = riderPinStr ? (ordersByPin.get(riderPinStr) || []) : [];
      const nameOrders = (!riderPinStr && riderNameStr) ? (ordersByName.get(riderNameStr.toLowerCase()) || []) : [];
      const riderOrders = pinOrders.length > 0 ? pinOrders : nameOrders;

      let payoutResult = null;
      try {
        payoutResult = dataService.calculateRiderPayout(riderOrders, payoutConfig);
      } catch (pErr) {
        console.warn('[Owner] calculateRiderPayout error for rider:', riderPinStr, pErr);
        payoutResult = { totalPayout: 0, exactPayout: 0, totalKms: 0, orderCount: riderOrders.length, surgeCount: 0 };
      }

      const calculatedPayout = safeNumber(payoutResult?.totalPayout);
      const exactPayout = safeNumber(payoutResult?.exactPayout || calculatedPayout);
      const roundedKms = safeNumber(payoutResult?.totalKms);

      let modelBadge = '';
      const method = payoutConfig?.activeMethod || 'tiered_standard';
      if (method === 'tiered_milestone') {
        const surge = payoutResult?.surgeCount > 0 ? `${payoutResult.surgeCount} Surge 🔥` : 'Standard';
        modelBadge = `<span class="pm-badge badge-purple" style="font-size:0.72rem;"><i class="fa-solid fa-trophy"></i> Milestone (${surge})</span>`;
      } else if (method === 'flat_linear') {
        const rate = payoutConfig?.flatLinear?.ratePerKm ?? 30;
        modelBadge = `<span class="pm-badge badge-amber" style="font-size:0.72rem;"><i class="fa-solid fa-road"></i> Flat ₹${rate}/km</span>`;
      } else {
        const base = payoutConfig?.tieredStandard?.basePay ?? 25;
        modelBadge = `<span class="pm-badge badge-green" style="font-size:0.72rem;"><i class="fa-solid fa-shield-halved"></i> Tiered Base ₹${base}</span>`;
      }

      let cashInHand = 0;
      try {
        const summary = dataService.getRiderCashSummary(r.pin);
        cashInHand = safeNumber(summary?.cashInHand);
      } catch (sumErr) {
        console.warn('[Owner] Cash summary warning for rider:', riderPinStr, sumErr);
      }

      // Multi-delivery dynamic payout balance
      let payoutSummary = null;
      try {
        payoutSummary = (typeof dataService.getRiderPayoutSummary === 'function')
          ? dataService.getRiderPayoutSummary(r.pin)
          : null;
      } catch (sumErr) {
        console.warn('[Owner] Payout summary warning for rider:', riderPinStr, sumErr);
      }

      const payoutBalance = payoutSummary ? safeNumber(payoutSummary.payoutBalance) : calculatedPayout;
      const paidDate = r.payoutPaidAt ? new Date(r.payoutPaidAt) : null;
      const isPaidToday = Boolean(paidDate && !isNaN(paidDate.getTime()) && paidDate.toDateString() === new Date().toDateString());
      const paidTime = (paidDate && !isNaN(paidDate.getTime())) ? paidDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';
      const paidAmount = safeNumber(r.payoutAmountPaid) || (payoutSummary ? safeNumber(payoutSummary.paidAmount) : calculatedPayout);

      const hasUnpaidBalance = (payoutBalance !== undefined) ? payoutBalance > 0 : (!isPaidToday && calculatedPayout > 0);
      const currentPayable = (payoutBalance !== undefined && payoutBalance > 0) ? payoutBalance : calculatedPayout;

      return {
        pin: riderPinStr,
        name: riderNameStr,
        initial: riderInitial,
        phone: riderPhone,
        vehicle: riderVehicle,
        deliveredCount: riderOrders.length,
        kms: roundedKms,
        modelBadge,
        calculatedPayout,
        exactPayout,
        payoutBalance,
        hasUnpaidBalance,
        currentPayable,
        cashInHand,
        isPaidToday,
        paidTime,
        paidAmount
      };
    });

    // Render Table
    if (tbody) {
      tbody.innerHTML = payoutList.map(st => {
        const statusBadge = st.isPaidToday
          ? `<span class="badge-payout-paid"><i class="fa-solid fa-circle-check"></i> Paid ₹${formatInr(st.paidAmount)} (${st.paidTime})</span>`
          : `<span class="badge-payout-pending"><i class="fa-regular fa-clock"></i> Unpaid</span>`;

        let actionBtn = '';
        if (activeInFlightPayoutPins && activeInFlightPayoutPins.has(st.pin)) {
          actionBtn = `<button type="button" class="btn-payout-upi" disabled style="opacity:0.7; cursor:wait;"><i class="fa-solid fa-spinner fa-spin"></i> Processing...</button>`;
        } else if (st.hasUnpaidBalance) {
          actionBtn = `
            <div style="display:flex; gap:6px; justify-content:center;">
              <button type="button" class="btn-mark-payout-paid" data-pin="${escapeHtml(st.pin)}" data-amount="${st.currentPayable}" title="Mark Paid in Cash from Drawer">
                <i class="fa-solid fa-money-bill-wave"></i> Cash (₹${formatInr(st.currentPayable)})
              </button>
              <button type="button" class="btn-payout-upi" data-pin="${escapeHtml(st.pin)}" data-amount="${st.currentPayable}" data-name="${escapeHtml(st.name)}" data-phone="${escapeHtml(st.phone)}" title="Instant Transfer via Cashfree Payouts">
                <i class="fa-solid fa-bolt"></i> UPI (₹${formatInr(st.currentPayable)})
              </button>
            </div>
          `;
        } else {
          actionBtn = `<button type="button" class="btn-mark-payout-paid" disabled style="opacity:0.6; cursor:default;"><i class="fa-solid fa-check"></i> Paid</button>`;
        }

        return `
          <tr>
            <td>
              <div class="rider-cell-meta">
                <div class="rider-avatar-bubble">${escapeHtml(st.initial)}</div>
                <div class="rider-name-box">
                  <span class="rider-name">${escapeHtml(st.name)}</span>
                  ${st.phone ? `<a href="tel:${sanitizePhone(st.phone)}" class="rider-phone-link"><i class="fa-solid fa-phone"></i> ${escapeHtml(st.phone)}</a>` : ''}
                </div>
              </div>
            </td>
            <td><span style="font-size:0.8rem; color:var(--owner-text-muted);">${escapeHtml(st.vehicle)}</span></td>
            <td class="text-center font-bold">${st.deliveredCount}</td>
            <td class="text-center font-bold" style="color: var(--owner-purple);"><i class="fa-solid fa-route"></i> ${st.kms} km</td>
            <td class="text-center">${st.modelBadge}</td>
            <td class="text-right num-purple" style="font-weight: 800; font-size: 0.95rem;">₹${formatInr(st.calculatedPayout)}</td>
            <td class="text-right num-amber" style="font-weight: 700;">₹${formatInr(st.cashInHand)}</td>
            <td class="text-center">${statusBadge}</td>
            <td class="text-center">${actionBtn}</td>
          </tr>
        `;
      }).join('');
    }

    // Render Mobile Cards
    if (cardsContainer) {
      cardsContainer.innerHTML = payoutList.map(st => {
        const statusBadge = st.isPaidToday
          ? `<span class="badge-payout-paid"><i class="fa-solid fa-circle-check"></i> Paid ₹${formatInr(st.paidAmount)} (${st.paidTime})</span>`
          : `<span class="badge-payout-pending"><i class="fa-regular fa-clock"></i> Unpaid</span>`;

        return `
          <div class="rider-card-mobile" style="${st.isPaidToday ? 'border-left: 4px solid #10B981;' : 'border-left: 4px solid #8B5CF6;'}">
            <div class="rc-header">
              <div class="rc-profile">
                <div class="rider-avatar-bubble">${escapeHtml(st.initial)}</div>
                <div>
                  <h4 class="rc-name">${escapeHtml(st.name)}</h4>
                  <span class="rc-vehicle">${escapeHtml(st.vehicle)}</span>
                </div>
              </div>
              ${statusBadge}
            </div>

            <div class="rc-metrics-grid" style="margin-top: 12px;">
              <div class="rc-metric">
                <span class="rc-val">${st.deliveredCount}</span>
                <span class="rc-lbl">Delivered</span>
              </div>
              <div class="rc-metric">
                <span class="rc-val" style="color: var(--owner-purple);">${st.kms} km</span>
                <span class="rc-lbl">Road Run</span>
              </div>
              <div class="rc-metric">
                <span class="rc-val" style="display:flex; justify-content:center;">${st.modelBadge}</span>
                <span class="rc-lbl">Model</span>
              </div>
              <div class="rc-metric">
                <span class="rc-val num-purple">₹${formatInr(st.calculatedPayout)}</span>
                <span class="rc-lbl">Day Payout</span>
              </div>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--owner-border);">
              <div style="font-size: 0.78rem; color: var(--owner-text-muted);">
                COD Cash: <strong class="num-amber">₹${formatInr(st.cashInHand)}</strong>
              </div>
              ${(activeInFlightPayoutPins && activeInFlightPayoutPins.has(st.pin)) ? `
                <button type="button" class="btn-payout-upi" disabled style="opacity:0.7; cursor:wait;">
                  <i class="fa-solid fa-spinner fa-spin"></i> Processing...
                </button>
              ` : (st.hasUnpaidBalance ? `
                <div style="display:flex; gap:6px;">
                  <button type="button" class="btn-mark-payout-paid" data-pin="${escapeHtml(st.pin)}" data-amount="${st.currentPayable}">
                    <i class="fa-solid fa-money-bill-wave"></i> Cash
                  </button>
                  <button type="button" class="btn-payout-upi" data-pin="${escapeHtml(st.pin)}" data-amount="${st.currentPayable}" data-name="${escapeHtml(st.name)}" data-phone="${escapeHtml(st.phone)}">
                    <i class="fa-solid fa-bolt"></i> UPI
                  </button>
                </div>
              ` : `
                <button type="button" class="btn-mark-payout-paid" disabled style="opacity:0.6; cursor:default;">
                  <i class="fa-solid fa-check"></i> Paid
                </button>
              `)}
            </div>
          </div>
        `;
      }).join('');
    }

    // Wire Mark Paid button listeners
    document.querySelectorAll('.btn-mark-payout-paid').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const pin = btn.getAttribute('data-pin');
        const amount = btn.getAttribute('data-amount');
        if (!pin) return;
        const res = dataService.markRiderPayoutPaid(pin, amount);
        if (res && res.success) {
          const riderName = res.rider?.name || 'Rider';
          showToast(`✅ Payout of ₹${Number(amount || 0).toLocaleString('en-IN')} marked as paid to ${riderName}!`, 'success');
          renderDashboard();
        }
      };
    });

    // Wire Cashfree Instant UPI Payout button listeners
    document.querySelectorAll('.btn-payout-upi').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const pin = btn.getAttribute('data-pin');
        const amount = Number(btn.getAttribute('data-amount')) || 0;
        const name = btn.getAttribute('data-name') || 'Delivery Partner';
        const phone = btn.getAttribute('data-phone') || '';
        if (!pin || amount <= 0 || (activeInFlightPayoutPins && activeInFlightPayoutPins.has(pin))) return;

        const confirmed = confirm(`⚡ Initiate Cashfree Instant UPI Payout of ₹${amount.toLocaleString('en-IN')} to ${name} (${phone || 'Rider'})?`);
        if (!confirmed) return;

        if (activeInFlightPayoutPins) activeInFlightPayoutPins.add(pin);
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Sending...`;

        try {
          const token = (typeof ensureAdminToken === 'function')
            ? await ensureAdminToken('owner')
            : (sessionStorage.getItem('quickbite_owner_token') || sessionStorage.getItem('quickbite_admin_token') || '');
          const dateKey = new Date().toISOString().slice(0, 10).replace(/-/g, '');
          const deterministicTransferId = `payout_${pin}_${dateKey}_${Date.now()}`;

          const resp = await fetch('/api/cashfree-payout', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token || ''}`,
              'x-admin-token': token || ''
            },
            body: JSON.stringify({
              riderPin: pin,
              transferId: deterministicTransferId,
              amount,
              phone,
              name,
              upiVpa: (function() { const rd = (typeof dataService !== 'undefined' && dataService.getRiderByPin) ? dataService.getRiderByPin(pin) : null; return (rd && rd.upiVpa) ? rd.upiVpa : `${phone || pin}@upi`; })()
            })
          });
          const res = await resp.json();
          if (res && res.success && (res.status === 'SUCCESS' || res.status === 'RECEIVED' || res.status === 'PENDING' || !res.status)) {
            dataService.markRiderPayoutPaid(pin, amount);
            playNotificationSound('payout_received');
            triggerDeviceVibration([120, 60, 180]);
            flashTabTitle('⚡ PAYOUT COMPLETED');
            showToast(`⚡ Instant Payout of ₹${amount.toLocaleString('en-IN')} sent to ${name} via Cashfree!`, 'success');
            sendSystemNotification({
              title: '⚡ Instant Payout Executed',
              body: `₹${amount.toLocaleString('en-IN')} transferred to ${name} via Cashfree UPI.`,
              tag: `owner-payout-${pin}`,
              data: { url: '/owner.html' }
            });
          } else {
            throw new Error(res.message || 'Payout transfer failed');
          }
        } catch (err) {
          console.error('[OwnerPayout] Instant transfer error:', err);
          showToast(`❌ Cashfree payout failed: ${err.message || 'Transfer could not be completed'}`, 'error');
        } finally {
          if (activeInFlightPayoutPins) activeInFlightPayoutPins.delete(pin);
          renderDashboard();
        }
      };
    });
  } catch (err) {
    console.error('[Owner] renderKmPayoutsView failed:', err);
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align: center; padding: 28px 16px; color: var(--owner-text-muted);">
            <i class="fa-solid fa-triangle-exclamation" style="color: #F59E0B; font-size: 1.4rem; margin-bottom: 6px; display: block;"></i>
            Unable to load payout records. Tap Refresh to retry.
          </td>
        </tr>
      `;
    }
    if (cardsContainer) {
      cardsContainer.innerHTML = `
        <div class="owner-empty-card" style="grid-column: 1 / -1;">
          <i class="fa-solid fa-triangle-exclamation" style="color: #F59E0B;"></i>
          <p>Unable to load payout records. Tap Refresh to retry.</p>
        </div>
      `;
    }
  }
}

function printExecutiveReport() {
  const bounds = getPeriodDateBounds(currentPeriod);
  const orders = getFilteredOrders();
  const printContainer = document.getElementById('print-report-container');
  if (!printContainer) return;

  let totalRev = 0;
  let codRev = 0;
  let onlineRev = 0;
  let deliveredCount = 0;
  let totalKms = 0;

  orders.forEach(o => {
    if (String(o.status).toLowerCase() === 'delivered') {
      deliveredCount++;
      const num = Number(String(o.total || '0').replace(/[^0-9.]/g, '')) || 0;
      totalRev += num;
      const isOnline = isOnlineOrderPayment(o);
      if (isOnline) onlineRev += num;
      else codRev += num;

      const dist = Number(o.addressDetails?.distanceKm || o.distance_km || o.distanceKm || 0);
      totalKms += dist;
    }
  });

  printContainer.innerHTML = `
    <div style="padding: 24px; font-family: sans-serif; color: #000; background: #FFF;">
      <div style="border-bottom: 2px solid #000; padding-bottom: 12px; margin-bottom: 16px;">
        <h1 style="margin: 0; font-size: 1.6rem;">👑 SAVERA PARADISE</h1>
        <h3 style="margin: 4px 0 0 0; font-size: 1.1rem; color: #333;">Executive Financial & Fleet Audit Statement</h3>
        <p style="margin: 4px 0 0 0; font-size: 0.85rem; color: #666;">Generated on: ${new Date().toLocaleString('en-IN')} • Period: ${bounds.label}</p>
      </div>

      <div style="display: flex; gap: 20px; margin-bottom: 20px;">
        <div style="flex: 1; border: 1px solid #CCC; padding: 12px; border-radius: 6px;">
          <strong style="display: block; font-size: 0.8rem; color: #666;">TOTAL REVENUE</strong>
          <span style="font-size: 1.4rem; font-weight: bold;">₹${totalRev.toLocaleString('en-IN')}</span>
          <div style="font-size: 0.75rem; color: #444;">${deliveredCount} orders delivered</div>
        </div>
        <div style="flex: 1; border: 1px solid #CCC; padding: 12px; border-radius: 6px;">
          <strong style="display: block; font-size: 0.8rem; color: #666;">COD CASH IN HAND</strong>
          <span style="font-size: 1.4rem; font-weight: bold;">₹${codRev.toLocaleString('en-IN')}</span>
          <div style="font-size: 0.75rem; color: #444;">Physical Cash Collected</div>
        </div>
        <div style="flex: 1; border: 1px solid #CCC; padding: 12px; border-radius: 6px;">
          <strong style="display: block; font-size: 0.8rem; color: #666;">ONLINE PAYOUTS</strong>
          <span style="font-size: 1.4rem; font-weight: bold;">₹${onlineRev.toLocaleString('en-IN')}</span>
          <div style="font-size: 0.75rem; color: #444;">Direct to Bank Account</div>
        </div>
        <div style="flex: 1; border: 1px solid #CCC; padding: 12px; border-radius: 6px;">
          <strong style="display: block; font-size: 0.8rem; color: #666;">FLEET KILOMETERS</strong>
          <span style="font-size: 1.4rem; font-weight: bold;">${totalKms.toFixed(1)} km</span>
          <div style="font-size: 0.75rem; color: #444;">Road Distance Traveled</div>
        </div>
      </div>

      <div style="margin-top: 24px;">
        <h4 style="margin: 0 0 8px 0;">Delivery Boys Settlement Summary</h4>
        ${document.getElementById('owner-rider-table')?.outerHTML || ''}
      </div>

      <div style="margin-top: 40px; display: flex; justify-content: space-between; font-size: 0.85rem; color: #555;">
        <div>Prepared by: Executive Analytics Engine</div>
        <div style="border-top: 1px solid #000; width: 200px; text-align: center; padding-top: 4px;">Proprietor / Owner Signature</div>
      </div>
    </div>
  `;

  window.print();
}

/**
 * Neutralizes CSV Formula Injection (CWE-1236).
 * Any cell value starting with =, +, -, @, \t, or \r is prefixed with a single quote (')
 * to force spreadsheet programs (Excel, Calc, Sheets) to treat it strictly as text.
 */
export function sanitizeCsvCell(val) {
  if (val === null || val === undefined) return '""';
  let str = String(val);
  const trimmed = str.trim();
  const firstRaw = str.charAt(0);
  const firstTrimmed = trimmed.charAt(0);
  if (firstRaw === '\t' || firstRaw === '\r' || firstTrimmed === '=' || firstTrimmed === '+' || firstTrimmed === '-' || firstTrimmed === '@') {
    str = "'" + str;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

function exportOrdersToCSV() {
  const bounds = getPeriodDateBounds(currentPeriod);
  const orders = getFilteredOrders();

  const headers = [
    'Order ID',
    'Date',
    'Time',
    'Customer Name',
    'Phone',
    'Address',
    'Road Distance (KM)',
    'Payment Method',
    'Total Amount (INR)',
    'Order Status',
    'Assigned Delivery Boy',
    'Items Summary'
  ];

  const rows = orders.map(o => {
    const cleanId = formatDisplayOrderId(o.id, o.pickupCode);
    const dateObj = o.createdAt ? new Date(o.createdAt) : new Date();
    const dateStr = dateObj.toLocaleDateString('en-IN');
    const timeStr = dateObj.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

    const dist = Number(o.addressDetails?.distanceKm || o.distance_km || o.distanceKm || 0).toFixed(1);
    const payment = String(o.paymentMethod || o.payment_method || 'COD');
    const rawTotal = Number(String(o.total || '0').replace(/[^0-9.]/g, '')) || 0;
    const status = String(o.status || 'pending');
    const items = Array.isArray(o.items) ? o.items : [];
    const itemsSummary = items.map(it => `${it.quantity || 1}x ${it.name}`).join('; ');

    return [
      sanitizeCsvCell(cleanId),
      sanitizeCsvCell(dateStr),
      sanitizeCsvCell(timeStr),
      sanitizeCsvCell(o.customerName || o.customer_name || 'Customer'),
      sanitizeCsvCell(extractPhoneFromOrder(o) || ''),
      sanitizeCsvCell(cleanDeliveryAddress(o.deliveryAddress || o.delivery_address || '')),
      sanitizeCsvCell(dist),
      sanitizeCsvCell(payment),
      sanitizeCsvCell(rawTotal),
      sanitizeCsvCell(status),
      sanitizeCsvCell(o.assignedRiderName || 'Unassigned'),
      sanitizeCsvCell(itemsSummary)
    ].join(',');
  });

  const csvText = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Savera_Paradise_Financial_Report_${currentPeriod}_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ==============================================================
// 12. SALES CALENDAR & HISTORICAL FINANCIAL AUDIT (READ-ONLY)
// ==============================================================

/**
 * Returns formatted Date string YYYY-MM-DD in local time
 */
export function toLocalDateKey(date) {
  if (!date) return '';
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns whether two Date objects represent the same calendar day
 */
export function isSameCalendarDay(d1, d2) {
  if (!d1 || !d2) return false;
  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth() === d2.getMonth() &&
         d1.getDate() === d2.getDate();
}

/**
 * Initializes the Sales Calendar & Audit Reports module
 */
function initCalendarReportsView() {
  const today = new Date();
  calCurrentYear = today.getFullYear();
  calCurrentMonth = today.getMonth();
  calSelectedDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  calRangeStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  calRangeEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  // Calendar Collapsible Panel Toggle
  const toggleCalPanel = (forceState) => {
    const wrapper = document.getElementById('owner-calendar-collapsible-wrapper');
    const bar = document.getElementById('calendar-compact-bar');
    if (!wrapper) return;
    const isCurrentlyOpen = wrapper.style.display !== 'none';
    const nextState = forceState !== undefined ? forceState : !isCurrentlyOpen;
    wrapper.style.display = nextState ? 'block' : 'none';
    if (bar) {
      if (nextState) bar.classList.add('is-open');
      else bar.classList.remove('is-open');
    }
    if (nextState) {
      renderCalendarMonth(calCurrentYear, calCurrentMonth);
    }
  };

  const btnToggleBar = document.getElementById('btn-toggle-calendar-panel');
  if (btnToggleBar) {
    btnToggleBar.addEventListener('click', () => toggleCalPanel());
  }

  const btnDoneCal = document.getElementById('btn-done-calendar');
  if (btnDoneCal) {
    btnDoneCal.addEventListener('click', () => toggleCalPanel(false));
  }

  const btnDoneCalTop = document.getElementById('btn-done-calendar-top');
  if (btnDoneCalTop) {
    btnDoneCalTop.addEventListener('click', () => toggleCalPanel(false));
  }

  // Accordion Dropdown Bars Toggle
  const setupAccordion = (toggleId, bodyId, containerId) => {
    const toggle = document.getElementById(toggleId);
    const body = document.getElementById(bodyId);
    const container = document.getElementById(containerId);
    if (!toggle || !body) return;

    toggle.addEventListener('click', () => {
      const isCurrentlyOpen = body.style.display !== 'none';
      body.style.display = isCurrentlyOpen ? 'none' : 'block';
      if (container) {
        if (isCurrentlyOpen) container.classList.remove('is-open');
        else container.classList.add('is-open');
      }
      toggle.setAttribute('aria-expanded', isCurrentlyOpen ? 'false' : 'true');
    });
  };

  setupAccordion('rep-bar-riders-toggle', 'rep-body-riders', 'report-section-riders');
  setupAccordion('rep-bar-dishes-toggle', 'rep-body-dishes', 'report-section-dishes');
  setupAccordion('rep-bar-orders-toggle', 'rep-body-orders', 'report-section-orders');

  // Mode buttons
  const btnModeSingle = document.getElementById('btn-cal-mode-single');
  const btnModeRange = document.getElementById('btn-cal-mode-range');
  const endGroup = document.getElementById('report-input-end-group');

  if (btnModeSingle) {
    btnModeSingle.addEventListener('click', () => {
      calMode = 'single';
      btnModeSingle.classList.add('active');
      if (btnModeRange) btnModeRange.classList.remove('active');
      if (endGroup) endGroup.style.display = 'none';
      renderCalendarMonth(calCurrentYear, calCurrentMonth);
      renderReportsView();
    });
  }

  if (btnModeRange) {
    btnModeRange.addEventListener('click', () => {
      calMode = 'range';
      btnModeRange.classList.add('active');
      if (btnModeSingle) btnModeSingle.classList.remove('active');
      if (endGroup) endGroup.style.display = 'flex';
      renderCalendarMonth(calCurrentYear, calCurrentMonth);
      renderReportsView();
    });
  }

  // Month navigation
  const btnPrev = document.getElementById('btn-cal-prev');
  const btnNext = document.getElementById('btn-cal-next');
  const btnJumpToday = document.getElementById('btn-cal-jump-today');

  if (btnPrev) {
    btnPrev.addEventListener('click', () => {
      calCurrentMonth--;
      if (calCurrentMonth < 0) {
        calCurrentMonth = 11;
        calCurrentYear--;
      }
      renderCalendarMonth(calCurrentYear, calCurrentMonth);
    });
  }

  if (btnNext) {
    btnNext.addEventListener('click', () => {
      const now = new Date();
      if (calCurrentYear < now.getFullYear() || (calCurrentYear === now.getFullYear() && calCurrentMonth < now.getMonth())) {
        calCurrentMonth++;
        if (calCurrentMonth > 11) {
          calCurrentMonth = 0;
          calCurrentYear++;
        }
        renderCalendarMonth(calCurrentYear, calCurrentMonth);
      } else {
        showToast('Future dates cannot be selected for historical audits', 'info');
      }
    });
  }

  if (btnJumpToday) {
    btnJumpToday.addEventListener('click', () => {
      const now = new Date();
      calCurrentYear = now.getFullYear();
      calCurrentMonth = now.getMonth();
      calSelectedDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      calRangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      calRangeEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      renderCalendarMonth(calCurrentYear, calCurrentMonth);
      renderReportsView();
    });
  }

  // Quick Preset Pills
  const presetsContainer = document.getElementById('calendar-presets-pills');
  if (presetsContainer) {
    presetsContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('.cal-preset-pill');
      if (!btn) return;
      presetsContainer.querySelectorAll('.cal-preset-pill').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');

      const preset = btn.getAttribute('data-preset');
      applyCalendarPreset(preset);
    });
  }

  // Direct Date input apply
  const btnApplyDirect = document.getElementById('btn-cal-apply-direct');
  const inputStart = document.getElementById('report-input-start');
  const inputEnd = document.getElementById('report-input-end');

  if (inputStart) inputStart.value = toLocalDateKey(calSelectedDate);
  if (inputEnd) inputEnd.value = toLocalDateKey(calSelectedDate);

  if (btnApplyDirect) {
    btnApplyDirect.addEventListener('click', () => {
      if (!inputStart || !inputStart.value) return;
      const parsedStart = new Date(inputStart.value + 'T00:00:00');
      if (isNaN(parsedStart.getTime())) return;

      if (calMode === 'single') {
        calSelectedDate = parsedStart;
        calCurrentYear = parsedStart.getFullYear();
        calCurrentMonth = parsedStart.getMonth();
      } else {
        const parsedEnd = (inputEnd && inputEnd.value) ? new Date(inputEnd.value + 'T23:59:59') : new Date(inputStart.value + 'T23:59:59');
        if (parsedStart <= parsedEnd) {
          calRangeStart = parsedStart;
          calRangeEnd = parsedEnd;
        } else {
          calRangeStart = parsedEnd;
          calRangeEnd = parsedStart;
        }
        calCurrentYear = calRangeEnd.getFullYear();
        calCurrentMonth = calRangeEnd.getMonth();
      }
      renderCalendarMonth(calCurrentYear, calCurrentMonth);
      renderReportsView();
    });
  }

  // Print & CSV buttons
  const btnPrintCal = document.getElementById('btn-print-calendar-report');
  if (btnPrintCal) {
    btnPrintCal.addEventListener('click', () => printCalendarReport());
  }

  const btnExportCal = document.getElementById('btn-export-calendar-csv');
  if (btnExportCal) {
    btnExportCal.addEventListener('click', () => exportCalendarReportCSV());
  }

  // Sync to Overview Button
  const btnSyncOverview = document.getElementById('btn-sync-to-overview');
  if (btnSyncOverview) {
    btnSyncOverview.addEventListener('click', () => {
      const bounds = getCalendarReportDateBounds();
      customStartDate = bounds.start;
      customEndDate = bounds.end;
      currentPeriod = 'custom';

      const pillsContainer = document.getElementById('owner-period-pills');
      if (pillsContainer) {
        pillsContainer.querySelectorAll('.period-pill').forEach(p => p.classList.remove('active'));
        const customPill = document.getElementById('btn-period-custom');
        if (customPill) customPill.classList.add('active');
      }

      switchOwnerView('view-overview');
      showToast(`Filter applied across all tabs: ${bounds.label}`, 'success');
    });
  }

  // Search input in report
  const searchInput = document.getElementById('report-orders-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      reportOrderSearchQuery = (e.target.value || '').trim().toLowerCase();
      renderReportOrdersTable();
    });
  }

  // Status pills in report
  const statusPills = document.getElementById('report-status-pills');
  if (statusPills) {
    statusPills.addEventListener('click', (e) => {
      const btn = e.target.closest('.order-filter-pill');
      if (!btn) return;
      statusPills.querySelectorAll('.order-filter-pill').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      reportStatusFilter = btn.getAttribute('data-rep-status') || 'all';
      renderReportOrdersTable();
    });
  }

  // Initial render of month and report
  renderCalendarMonth(calCurrentYear, calCurrentMonth);
  renderReportsView();
}

/**
 * Handles preset clicks on the calendar widget
 */
function applyCalendarPreset(preset) {
  const now = new Date();
  const btnModeSingle = document.getElementById('btn-cal-mode-single');
  const btnModeRange = document.getElementById('btn-cal-mode-range');
  const endGroup = document.getElementById('report-input-end-group');

  if (preset === 'today') {
    calMode = 'single';
    if (btnModeSingle) btnModeSingle.classList.add('active');
    if (btnModeRange) btnModeRange.classList.remove('active');
    if (endGroup) endGroup.style.display = 'none';
    calSelectedDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    calCurrentYear = now.getFullYear();
    calCurrentMonth = now.getMonth();
  } else if (preset === 'yesterday') {
    calMode = 'single';
    if (btnModeSingle) btnModeSingle.classList.add('active');
    if (btnModeRange) btnModeRange.classList.remove('active');
    if (endGroup) endGroup.style.display = 'none';
    const yest = new Date(now);
    yest.setDate(yest.getDate() - 1);
    calSelectedDate = new Date(yest.getFullYear(), yest.getMonth(), yest.getDate());
    calCurrentYear = yest.getFullYear();
    calCurrentMonth = yest.getMonth();
  } else if (preset === 'last7') {
    calMode = 'range';
    if (btnModeRange) btnModeRange.classList.add('active');
    if (btnModeSingle) btnModeSingle.classList.remove('active');
    if (endGroup) endGroup.style.display = 'flex';
    calRangeEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    calRangeStart = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    calRangeStart = new Date(calRangeStart.getFullYear(), calRangeStart.getMonth(), calRangeStart.getDate());
    calCurrentYear = now.getFullYear();
    calCurrentMonth = now.getMonth();
  } else if (preset === 'thismonth') {
    calMode = 'range';
    if (btnModeRange) btnModeRange.classList.add('active');
    if (btnModeSingle) btnModeSingle.classList.remove('active');
    if (endGroup) endGroup.style.display = 'flex';
    calRangeStart = new Date(now.getFullYear(), now.getMonth(), 1);
    calRangeEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    calCurrentYear = now.getFullYear();
    calCurrentMonth = now.getMonth();
  } else if (preset === 'lastmonth') {
    calMode = 'range';
    if (btnModeRange) btnModeRange.classList.add('active');
    if (btnModeSingle) btnModeSingle.classList.remove('active');
    if (endGroup) endGroup.style.display = 'flex';
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    const lastMonthStart = new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1);
    calRangeStart = lastMonthStart;
    calRangeEnd = lastMonthEnd;
    calCurrentYear = lastMonthStart.getFullYear();
    calCurrentMonth = lastMonthStart.getMonth();
  } else if (preset === 'all') {
    calMode = 'range';
    if (btnModeRange) btnModeRange.classList.add('active');
    if (btnModeSingle) btnModeSingle.classList.remove('active');
    if (endGroup) endGroup.style.display = 'flex';
    calRangeStart = new Date(2025, 0, 1);
    calRangeEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    calCurrentYear = now.getFullYear();
    calCurrentMonth = now.getMonth();
  }

  // Sync inputs
  const inputStart = document.getElementById('report-input-start');
  const inputEnd = document.getElementById('report-input-end');
  if (inputStart) inputStart.value = toLocalDateKey(calMode === 'single' ? calSelectedDate : calRangeStart);
  if (inputEnd) inputEnd.value = toLocalDateKey(calMode === 'single' ? calSelectedDate : calRangeEnd);

  renderCalendarMonth(calCurrentYear, calCurrentMonth);
  renderReportsView();
}

/**
 * Renders the visual month calendar grid for a given year and month
 */
function renderCalendarMonth(year, month) {
  const gridEl = document.getElementById('calendar-days-grid');
  const labelEl = document.getElementById('cal-month-year-label');
  if (!gridEl) return;

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  if (labelEl) {
    labelEl.textContent = `${monthNames[month]} ${year}`;
  }

  gridEl.innerHTML = '';

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  // Aggregate orders by day for visual indicators
  const allOrders = dataService.getOrders();
  const ordersByDateKey = new Map();
  allOrders.forEach(o => {
    if (!o) return;
    const ts = o.createdAt ? new Date(o.createdAt).getTime() : (o.updatedAt ? new Date(o.updatedAt).getTime() : 0);
    if (!ts) return;
    const dateKey = toLocalDateKey(new Date(ts));
    const rawTotal = Number(String(o.total || '0').replace(/[^0-9.]/g, '')) || 0;
    if (!ordersByDateKey.has(dateKey)) {
      ordersByDateKey.set(dateKey, { count: 0, revenue: 0 });
    }
    const stat = ordersByDateKey.get(dateKey);
    stat.count++;
    if (String(o.status || '').toLowerCase() === 'delivered') {
      stat.revenue += rawTotal;
    }
  });

  // Calculate days
  const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0 = Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  // Trailing days from previous month
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const prevDayNum = daysInPrevMonth - i;
    const cell = document.createElement('div');
    cell.className = 'cal-day-cell is-other-month';
    cell.innerHTML = `<span class="cal-day-num">${prevDayNum}</span>`;
    gridEl.appendChild(cell);
  }

  // Days of current month
  for (let d = 1; d <= daysInMonth; d++) {
    const cellDate = new Date(year, month, d);
    const dateKey = toLocalDateKey(cellDate);
    const cellTime = cellDate.getTime();
    const cell = document.createElement('div');
    cell.className = 'cal-day-cell';
    cell.setAttribute('data-date', dateKey);

    const isToday = isSameCalendarDay(cellDate, now);
    const isFuture = cellTime > todayStart;

    if (isToday) cell.classList.add('is-today');
    if (isFuture) cell.classList.add('is-future');

    // Selection highlight
    if (calMode === 'single') {
      if (isSameCalendarDay(cellDate, calSelectedDate)) {
        cell.classList.add('is-selected');
      }
    } else if (calMode === 'range') {
      const s = calRangeStart ? new Date(calRangeStart.getFullYear(), calRangeStart.getMonth(), calRangeStart.getDate()).getTime() : 0;
      const e = calRangeEnd ? new Date(calRangeEnd.getFullYear(), calRangeEnd.getMonth(), calRangeEnd.getDate()).getTime() : 0;

      if (calRangeStart && isSameCalendarDay(cellDate, calRangeStart)) {
        cell.classList.add('range-start');
      }
      if (calRangeEnd && isSameCalendarDay(cellDate, calRangeEnd)) {
        cell.classList.add('range-end');
      }
      if (s && e && cellTime > s && cellTime < e) {
        cell.classList.add('in-range');
      }
    }

    // Sales dot
    const dayOrders = ordersByDateKey.get(dateKey);
    let dotHtml = '';
    if (dayOrders && dayOrders.count > 0) {
      cell.classList.add('has-sales');
      dotHtml = `<span class="cal-sales-dot" title="${dayOrders.count} orders · ₹${Math.round(dayOrders.revenue).toLocaleString('en-IN')}"></span>`;
    }

    cell.innerHTML = `<span class="cal-day-num">${d}</span>${dotHtml}`;

    if (!isFuture) {
      cell.addEventListener('click', () => {
        handleCalendarDayClick(cellDate);
      });
    }

    gridEl.appendChild(cell);
  }

  // Leading days of next month to fill grid row
  const totalRendered = firstDayOfWeek + daysInMonth;
  const remainingCells = (7 - (totalRendered % 7)) % 7;
  for (let n = 1; n <= remainingCells; n++) {
    const cell = document.createElement('div');
    cell.className = 'cal-day-cell is-other-month';
    cell.innerHTML = `<span class="cal-day-num">${n}</span>`;
    gridEl.appendChild(cell);
  }
}

/**
 * Handles day cell click
 */
function handleCalendarDayClick(date) {
  const inputStart = document.getElementById('report-input-start');
  const inputEnd = document.getElementById('report-input-end');

  if (calMode === 'single') {
    calSelectedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    if (inputStart) inputStart.value = toLocalDateKey(calSelectedDate);
    if (inputEnd) inputEnd.value = toLocalDateKey(calSelectedDate);

    renderCalendarMonth(calCurrentYear, calCurrentMonth);
    renderReportsView();

    // Auto-collapse calendar on mobile to avoid long scrolling
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
      const wrapper = document.getElementById('owner-calendar-collapsible-wrapper');
      const bar = document.getElementById('calendar-compact-bar');
      if (wrapper) wrapper.style.display = 'none';
      if (bar) bar.classList.remove('is-open');
    }
  } else if (calMode === 'range') {
    if (!calRangeStart || (calRangeStart && calRangeEnd)) {
      // Begin new range
      calRangeStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      calRangeEnd = null;
      if (inputStart) inputStart.value = toLocalDateKey(calRangeStart);
      if (inputEnd) inputEnd.value = '';
      renderCalendarMonth(calCurrentYear, calCurrentMonth);
    } else if (calRangeStart && !calRangeEnd) {
      // Complete range
      const clickedTime = date.getTime();
      const startTime = calRangeStart.getTime();

      if (clickedTime < startTime) {
        calRangeEnd = calRangeStart;
        calRangeStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      } else {
        calRangeEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      }

      if (inputStart) inputStart.value = toLocalDateKey(calRangeStart);
      if (inputEnd) inputEnd.value = toLocalDateKey(calRangeEnd);

      renderCalendarMonth(calCurrentYear, calCurrentMonth);
      renderReportsView();

      // Auto-collapse calendar on mobile once range selection is complete
      if (typeof window !== 'undefined' && window.innerWidth <= 768) {
        const wrapper = document.getElementById('owner-calendar-collapsible-wrapper');
        const bar = document.getElementById('calendar-compact-bar');
        if (wrapper) wrapper.style.display = 'none';
        if (bar) bar.classList.remove('is-open');
      }
    }
  }
}

/**
 * Returns date bounds object { start, end, label, typeTag, isSingleDay }
 */
export function getCalendarReportDateBounds() {
  if (calMode === 'single') {
    const start = new Date(calSelectedDate.getFullYear(), calSelectedDate.getMonth(), calSelectedDate.getDate(), 0, 0, 0, 0);
    const end = new Date(calSelectedDate.getFullYear(), calSelectedDate.getMonth(), calSelectedDate.getDate(), 23, 59, 59, 999);
    const isToday = isSameCalendarDay(calSelectedDate, new Date());
    const label = calSelectedDate.toLocaleDateString('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
    return {
      start,
      end,
      label,
      typeTag: isToday ? "TODAY'S LIVE AUDIT" : "SINGLE DAY AUDIT",
      isSingleDay: true
    };
  } else {
    const rStart = calRangeStart || calSelectedDate;
    const rEnd = calRangeEnd || calRangeStart || calSelectedDate;
    const s = rStart < rEnd ? rStart : rEnd;
    const e = rStart < rEnd ? rEnd : rStart;

    const start = new Date(s.getFullYear(), s.getMonth(), s.getDate(), 0, 0, 0, 0);
    const end = new Date(e.getFullYear(), e.getMonth(), e.getDate(), 23, 59, 59, 999);
    const daysCount = Math.max(1, Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)));

    const startStr = s.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const endStr = e.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const label = `${startStr} – ${endStr} (${daysCount} Days Full Report)`;

    return {
      start,
      end,
      label,
      typeTag: "DATE RANGE FULL REPORT",
      isSingleDay: false
    };
  }
}

/**
 * Returns orders falling strictly inside the calendar's active date bounds
 */
export function getOrdersForCalendarReport() {
  const bounds = getCalendarReportDateBounds();
  const allOrders = dataService.getOrders();

  return allOrders.filter(o => {
    if (!o) return false;
    const orderTimestamp = o.createdAt ? new Date(o.createdAt).getTime() : (o.updatedAt ? new Date(o.updatedAt).getTime() : 0);
    return orderTimestamp >= bounds.start.getTime() && orderTimestamp <= bounds.end.getTime();
  });
}

/**
 * Master renderer for View 6: Sales Calendar & Financial Audit Reports
 */
function renderReportsView() {
  try {
    const bounds = getCalendarReportDateBounds();
    const orders = getOrdersForCalendarReport();

    // 1. Update Horizon Meta
    const rangeLabel = document.getElementById('cal-active-range-label');
    const rangeSub = document.getElementById('cal-active-range-sub');
    const bannerTag = document.getElementById('report-banner-type-tag');
    const bannerDate = document.getElementById('report-banner-date-heading');
    const bannerOrders = document.getElementById('report-banner-orders-count');
    const bannerTime = document.getElementById('report-banner-timestamp');

    if (rangeLabel) rangeLabel.textContent = bounds.label;
    if (rangeSub) rangeSub.textContent = bounds.isSingleDay ? 'Single day sales & rider payout audit' : 'Date range full report';
    if (bannerTag) bannerTag.textContent = bounds.typeTag;
    if (bannerDate) bannerDate.textContent = bounds.label;
    if (bannerTime) bannerTime.textContent = `Generated: ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;

    // Update Top Compact Calendar Bar
    const barTypeTag = document.getElementById('cal-bar-type-tag');
    const barDateDisplay = document.getElementById('cal-bar-date-display');
    if (barTypeTag) barTypeTag.textContent = bounds.typeTag;
    if (barDateDisplay) barDateDisplay.textContent = bounds.label;

    // 2. Financial Aggregations
    let totalRevenue = 0;
    let codRevenue = 0;
    let onlineRevenue = 0;
    let codCount = 0;
    let onlineCount = 0;
    let totalFleetKms = 0;
    const deliveredOrders = [];

    orders.forEach(o => {
      const status = String(o.status || '').toLowerCase();
      const rawTotal = Number(String(o.total || '0').replace(/[^0-9.]/g, '')) || 0;
      const isOnline = isOnlineOrderPayment(o);

      if (status === 'delivered') {
        deliveredOrders.push(o);
        totalRevenue = Math.round((totalRevenue + rawTotal) * 100) / 100;

        if (isOnline) {
          onlineRevenue = Math.round((onlineRevenue + rawTotal) * 100) / 100;
          onlineCount++;
        } else {
          codRevenue = Math.round((codRevenue + rawTotal) * 100) / 100;
          codCount++;
        }

        const dist = Number(o.addressDetails?.distanceKm || o.distance_km || o.distanceKm || 0);
        totalFleetKms += dist;
      }
    });

    const aov = deliveredOrders.length > 0 ? Math.round(totalRevenue / deliveredOrders.length) : 0;
    const codPercent = totalRevenue > 0 ? Math.round((codRevenue / totalRevenue) * 100) : 0;
    const onlinePercent = totalRevenue > 0 ? (100 - codPercent) : 0;

    // 3. Rider Payouts Calculation for this period
    const payoutConfig = dataService.getPayoutConfig();
    let totalRiderPayouts = 0;
    const ordersByRider = new Map();

    deliveredOrders.forEach(o => {
      const rPin = String(o.assignedRiderPin || '').trim();
      const rName = (o.assignedRiderName || '').trim().toLowerCase();
      const key = rPin || rName || 'unassigned';
      if (!ordersByRider.has(key)) ordersByRider.set(key, []);
      ordersByRider.get(key).push(o);
    });

    ordersByRider.forEach((rOrders) => {
      const payoutResult = dataService.calculateRiderPayout(rOrders, payoutConfig);
      totalRiderPayouts = Math.round((totalRiderPayouts + (payoutResult.exactPayout || payoutResult.totalPayout || 0)) * 100) / 100;
    });

    const netDrawerCash = Math.round((codRevenue - totalRiderPayouts) * 100) / 100;
    const netRetention = Math.round((totalRevenue - totalRiderPayouts) * 100) / 100;

    // 4. Update KPI Metric Cards
    const elTotalRev = document.getElementById('rep-total-revenue');
    const elDelivCount = document.getElementById('rep-delivered-count');
    const elAov = document.getElementById('rep-aov');
    const elCodRev = document.getElementById('rep-cod-revenue');
    const elCodCount = document.getElementById('rep-cod-count');
    const elCodPct = document.getElementById('rep-cod-percent');
    const elOnlineRev = document.getElementById('rep-online-revenue');
    const elOnlineCount = document.getElementById('rep-online-count');
    const elOnlinePct = document.getElementById('rep-online-percent');
    const elRiderPayout = document.getElementById('rep-rider-payouts');
    const elRiderDeliv = document.getElementById('rep-rider-deliveries');
    const elFleetKms = document.getElementById('rep-fleet-kms');
    const elDrawerNet = document.getElementById('rep-drawer-net');
    const elDrawerMath = document.getElementById('rep-drawer-math');
    const elNetRetention = document.getElementById('rep-net-retention');

    if (elTotalRev) elTotalRev.textContent = `₹${formatInr(totalRevenue)}`;
    if (elDelivCount) elDelivCount.textContent = `${deliveredOrders.length} delivered orders`;
    if (elAov) elAov.textContent = `AOV: ₹${aov}`;

    if (elCodRev) elCodRev.textContent = `₹${formatInr(codRevenue)}`;
    if (elCodCount) elCodCount.textContent = `${codCount} cash orders`;
    if (elCodPct) elCodPct.textContent = `${codPercent}% of Sales`;

    if (elOnlineRev) elOnlineRev.textContent = `₹${formatInr(onlineRevenue)}`;
    if (elOnlineCount) elOnlineCount.textContent = `${onlineCount} UPI/online orders`;
    if (elOnlinePct) elOnlinePct.textContent = `${onlinePercent}% of Sales`;

    if (elRiderPayout) elRiderPayout.textContent = `₹${formatInr(totalRiderPayouts)}`;
    if (elRiderDeliv) elRiderDeliv.textContent = `${deliveredOrders.length} deliveries`;
    if (elFleetKms) elFleetKms.textContent = `${totalFleetKms.toFixed(1)} km driven`;

    if (elDrawerNet) {
      if (netDrawerCash >= 0) {
        elDrawerNet.textContent = `₹${formatInr(netDrawerCash)}`;
        elDrawerNet.className = 'report-kpi-val num-emerald';
      } else {
        elDrawerNet.textContent = `−₹${formatInr(Math.abs(netDrawerCash))}`;
        elDrawerNet.className = 'report-kpi-val num-amber';
      }
    }
    if (elDrawerMath) {
      elDrawerMath.textContent = `₹${formatInr(codRevenue)} Cash In − ₹${formatInr(totalRiderPayouts)} Payout`;
    }

    if (elNetRetention) elNetRetention.textContent = `₹${formatInr(netRetention)}`;
    if (bannerOrders) bannerOrders.textContent = `${deliveredOrders.length} Delivered (${orders.length} Total Orders)`;

    // 5. Payment Split Bar
    const barCash = document.getElementById('rep-bar-cash');
    const barOnline = document.getElementById('rep-bar-online');
    const legCash = document.getElementById('rep-legend-cash');
    const legOnline = document.getElementById('rep-legend-online');

    if (barCash) barCash.style.width = `${codPercent}%`;
    if (barOnline) barOnline.style.width = `${onlinePercent}%`;
    if (legCash) legCash.textContent = `₹${formatInr(codRevenue)} (${codPercent}%)`;
    if (legOnline) legOnline.textContent = `₹${formatInr(onlineRevenue)} (${onlinePercent}%)`;

    // 6. Sub-Tables
    renderReportRiderTable(deliveredOrders, payoutConfig);
    renderReportDishesTable(deliveredOrders, totalRevenue);
    renderReportOrdersTable();
  } catch (err) {
    console.error('[Owner] renderReportsView failed:', err);
  }
}

/**
 * Renders the Delivery Boys Settlement table for the chosen period
 */
function renderReportRiderTable(deliveredOrders, payoutConfig) {
  const tbody = document.getElementById('report-rider-tbody');
  if (!tbody) return;

  try {
    const rawRiders = dataService.getRiders();
    const riders = Array.isArray(rawRiders) ? rawRiders.filter(r => r && typeof r === 'object') : [];
    const riderOrdersMap = new Map();

    (deliveredOrders || []).forEach(o => {
      const rPin = String(o?.assignedRiderPin || '').trim();
      const rName = String(o?.assignedRiderName || '').trim().toLowerCase();
      const key = rPin || rName || 'unassigned';
      if (!riderOrdersMap.has(key)) riderOrdersMap.set(key, []);
      riderOrdersMap.get(key).push(o);
    });

    const activeRidersList = [];

    riders.forEach(r => {
      const key = String(r.pin || '').trim();
      const rOrders = riderOrdersMap.get(key) || [];
      if (rOrders.length > 0) {
        activeRidersList.push({ rider: r, orders: rOrders });
      }
    });

    // Include any assignments not matched by pin
    riderOrdersMap.forEach((rOrders, key) => {
      const matched = activeRidersList.some(item => String(item?.rider?.pin || '').trim() === key || String(item?.rider?.name || '').trim().toLowerCase() === key);
      if (!matched && key !== 'unassigned') {
        const sample = rOrders[0];
        activeRidersList.push({
          rider: { name: sample?.assignedRiderName || 'Delivery Boy', pin: sample?.assignedRiderPin || '----', vehicle: '🏍️ Bike' },
          orders: rOrders
        });
      }
    });

    if (activeRidersList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center" style="padding: 24px; color: #94A3B8;"><i class="fa-solid fa-motorcycle" style="font-size: 1.4rem; opacity: 0.5; margin-bottom: 6px; display: block;"></i>No delivery boy orders recorded in this period horizon.</td></tr>`;
      updateReportRiderFooter(0, 0, 0, 0, 0);
      return;
    }

    let totalDeliveries = 0;
    let totalKms = 0;
    let totalPayouts = 0;
    let totalCash = 0;
    let totalNet = 0;

    tbody.innerHTML = activeRidersList.map(({ rider, orders }) => {
      const delivCount = orders.length;
      totalDeliveries += delivCount;

      let riderKms = 0;
      let riderCodCash = 0;

      orders.forEach(o => {
        riderKms += Number(o?.addressDetails?.distanceKm || o?.distance_km || o?.distanceKm || 0);
        if (!isOnlineOrderPayment(o)) {
          const cash = (typeof o?.cashCollected === 'number' && o.cashCollected > 0)
            ? o.cashCollected
            : (Number(String(o?.total || '0').replace(/[^0-9.]/g, '')) || 0);
          riderCodCash += cash;
        }
      });

      totalKms += riderKms;
      totalCash += riderCodCash;

      const payoutRes = dataService.calculateRiderPayout(orders, payoutConfig);
      const payoutAmt = payoutRes?.exactPayout || payoutRes?.totalPayout || 0;
      totalPayouts += payoutAmt;

      const netToDrawer = Math.round((riderCodCash - payoutAmt) * 100) / 100;
      totalNet += netToDrawer;

      const rName = String(rider?.name || 'Delivery Partner').trim();
      const rPin = String(rider?.pin || '----').trim();
      const rVehicle = String(rider?.vehicle || '🏍️ Bike').trim();

      return `
        <tr>
          <td><strong>${escapeHtml(rName)}</strong> <span style="font-size: 0.72rem; color: #94A3B8;">(PIN: ${escapeHtml(rPin)})</span></td>
          <td>${escapeHtml(rVehicle)}</td>
          <td class="text-center">${delivCount}</td>
          <td class="text-center">${riderKms.toFixed(1)} km</td>
          <td class="text-right num-purple font-bold">₹${formatInr(Math.round(payoutAmt))}</td>
          <td class="text-right num-amber font-bold">₹${formatInr(Math.round(riderCodCash))}</td>
          <td class="text-right font-bold ${netToDrawer >= 0 ? 'num-emerald' : 'num-amber'}">₹${formatInr(netToDrawer)}</td>
          <td class="text-center"><span class="status-chip success"><i class="fa-solid fa-lock"></i> Audited</span></td>
        </tr>
      `;
    }).join('');

    updateReportRiderFooter(totalDeliveries, totalKms, totalPayouts, totalCash, totalNet);

    const previewRiders = document.getElementById('rep-bar-preview-riders');
    if (previewRiders) {
      previewRiders.textContent = `${activeRidersList.length} Riders · ₹${formatInr(Math.round(totalPayouts))} Paid`;
    }
  } catch (err) {
    console.error('[Owner] renderReportRiderTable failed:', err);
    tbody.innerHTML = `<tr><td colspan="8" class="text-center" style="padding: 24px; color: #94A3B8;">Unable to calculate rider settlements for this period.</td></tr>`;
  }
}

function updateReportRiderFooter(deliveries, kms, payouts, cash, net) {
  const fDeliv = document.getElementById('rep-foot-deliveries');
  const fKms = document.getElementById('rep-foot-kms');
  const fPay = document.getElementById('rep-foot-payouts');
  const fCash = document.getElementById('rep-foot-cash');
  const fNet = document.getElementById('rep-foot-net');

  if (fDeliv) fDeliv.textContent = `${deliveries}`;
  if (fKms) fKms.textContent = `${kms.toFixed(1)} km`;
  if (fPay) fPay.textContent = `₹${Math.round(payouts).toLocaleString('en-IN')}`;
  if (fCash) fCash.textContent = `₹${Math.round(cash).toLocaleString('en-IN')}`;
  if (fNet) fNet.textContent = `₹${Math.round(net).toLocaleString('en-IN')}`;
}

/**
 * Renders the Menu Dish Sales breakdown table
 */
function renderReportDishesTable(deliveredOrders, totalRevenue) {
  const tbody = document.getElementById('report-dishes-tbody');
  const tfootQty = document.getElementById('rep-dishes-total-qty');
  const tfootRev = document.getElementById('rep-dishes-total-revenue');
  if (!tbody) return;

  const dishMap = new Map();

  deliveredOrders.forEach(o => {
    const items = Array.isArray(o.items) ? o.items : [];
    items.forEach(it => {
      const name = it.name || 'Menu Dish';
      const cat = it.category || 'Specialty';
      const qty = Number(it.quantity || 1);
      const price = Number(it.price || 0);
      const itemTotal = price * qty;

      if (!dishMap.has(name)) {
        dishMap.set(name, { name, category: cat, quantity: 0, price, revenue: 0 });
      }
      const itemStat = dishMap.get(name);
      itemStat.quantity += qty;
      itemStat.revenue += itemTotal;
      if (price > 0) itemStat.price = price;
    });
  });

  const dishList = Array.from(dishMap.values()).sort((a, b) => b.revenue - a.revenue);

  if (dishList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="padding: 24px; color: #94A3B8;"><i class="fa-solid fa-utensils" style="font-size: 1.4rem; opacity: 0.5; margin-bottom: 6px; display: block;"></i>No itemized dish sales recorded for delivered orders in this period.</td></tr>`;
    if (tfootQty) tfootQty.textContent = '0 items';
    if (tfootRev) tfootRev.textContent = '₹0';
    return;
  }

  let totalQty = 0;
  let totalDishesRev = 0;

  tbody.innerHTML = dishList.map(dish => {
    totalQty += dish.quantity;
    totalDishesRev += dish.revenue;
    const share = totalRevenue > 0 ? Math.round((dish.revenue / totalRevenue) * 100) : 0;

    return `
      <tr>
        <td><strong>${dish.name}</strong></td>
        <td><span class="report-meta-chip" style="font-size: 0.7rem;">${dish.category}</span></td>
        <td class="text-center font-bold">${dish.quantity}</td>
        <td class="text-right">₹${dish.price.toLocaleString('en-IN')}</td>
        <td class="text-right font-bold num-gold">₹${Math.round(dish.revenue).toLocaleString('en-IN')}</td>
        <td class="text-right">${share}%</td>
      </tr>
    `;
  }).join('');

  if (tfootQty) tfootQty.textContent = `${totalQty} items`;
  if (tfootRev) tfootRev.textContent = `₹${Math.round(totalDishesRev).toLocaleString('en-IN')}`;

  const previewDishes = document.getElementById('rep-bar-preview-dishes');
  if (previewDishes) {
    previewDishes.textContent = `${dishList.length} Dishes (${totalQty} Items) · ₹${Math.round(totalDishesRev).toLocaleString('en-IN')}`;
  }
}

/**
 * Renders the Orders Audit table for the active date selection
 */
function renderReportOrdersTable() {
  const tbody = document.getElementById('report-orders-tbody');
  const countLabel = document.getElementById('rep-orders-count-label');
  if (!tbody) return;

  const orders = getOrdersForCalendarReport();

  // Filter by search & status
  const filtered = orders.filter(o => {
    if (!o) return false;
    const status = String(o.status || '').toLowerCase();
    const isOnline = isOnlineOrderPayment(o);

    // Status filter
    if (reportStatusFilter === 'delivered' && status !== 'delivered') return false;
    if (reportStatusFilter === 'cash' && isOnline) return false;
    if (reportStatusFilter === 'online' && !isOnline) return false;
    if (reportStatusFilter === 'cancelled' && status !== 'cancelled') return false;

    // Search query
    if (reportOrderSearchQuery) {
      const q = reportOrderSearchQuery;
      const idMatch = String(o.id || '').toLowerCase().includes(q) || String(o.cleanId || '').toLowerCase().includes(q);
      const custMatch = String(o.customerName || '').toLowerCase().includes(q);
      const phoneMatch = String(extractPhoneFromOrder(o) || '').includes(q);
      const riderMatch = String(o.assignedRiderName || '').toLowerCase().includes(q);
      if (!idMatch && !custMatch && !phoneMatch && !riderMatch) return false;
    }

    return true;
  });

  if (countLabel) countLabel.textContent = `${filtered.length}`;

  const previewOrders = document.getElementById('rep-bar-preview-orders');
  if (previewOrders) {
    previewOrders.textContent = `${filtered.length} Orders (${orders.filter(o => String(o.status || '').toLowerCase() === 'delivered').length} Delivered)`;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center" style="padding: 30px; color: #94A3B8;"><i class="fa-solid fa-receipt" style="font-size: 1.6rem; opacity: 0.5; margin-bottom: 8px; display: block;"></i>No orders found matching this period and filter selection.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(o => {
    const cleanId = formatDisplayOrderId(o.id, o.pickupCode);
    const dateObj = o.createdAt ? new Date(o.createdAt) : new Date();
    const timeStr = dateObj.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    const isOnline = isOnlineOrderPayment(o);
    const rawTotal = Number(String(o.total || '0').replace(/[^0-9.]/g, '')) || 0;
    const items = Array.isArray(o.items) ? o.items : [];
    const itemsSummary = items.map(it => `${it.quantity || 1}x ${it.name}`).join(', ') || 'Item';
    const status = String(o.status || 'accepted');

    return `
      <tr>
        <td><strong>${cleanId}</strong></td>
        <td style="font-size: 0.78rem; color: #64748B;">${timeStr}</td>
        <td>
          <div style="font-weight: 600;">${o.customerName || 'Online Guest'}</div>
          <div style="font-size: 0.72rem; color: #94A3B8;">${extractPhoneFromOrder(o) || 'No phone'}</div>
        </td>
        <td style="max-width: 220px; font-size: 0.78rem; color: #475569;" title="${itemsSummary}">${itemsSummary}</td>
        <td>
          <span class="report-meta-chip ${isOnline ? 'num-teal' : 'num-amber'}" style="font-size: 0.7rem;">
            <i class="fa-solid ${isOnline ? 'fa-credit-card' : 'fa-money-bill-wave'}"></i>
            ${isOnline ? 'Online/UPI' : 'COD Cash'}
          </span>
        </td>
        <td style="font-size: 0.8rem;">${o.assignedRiderName ? `<i class="fa-solid fa-motorcycle" style="color: #7C3AED;"></i> ${o.assignedRiderName}` : '<span style="color: #94A3B8;">Unassigned</span>'}</td>
        <td class="text-right font-bold" style="font-size: 0.92rem;">₹${rawTotal.toLocaleString('en-IN')}</td>
        <td class="text-center"><span class="status-chip ${status === 'delivered' ? 'success' : (status === 'cancelled' ? 'cancelled' : 'pending')}">${status}</span></td>
        <td class="text-center">
          <button type="button" class="btn-cal-order-receipt" data-order-id="${o.id}" style="background: #F1F5F9; border: 1px solid #CBD5E1; color: #0F172A; border-radius: 6px; padding: 4px 8px; font-size: 0.74rem; font-weight: 700; cursor: pointer;">
            <i class="fa-solid fa-receipt"></i> Invoice
          </button>
        </td>
      </tr>
    `;
  }).join('');

  // Bind invoice button clicks
  tbody.querySelectorAll('.btn-cal-order-receipt').forEach(btn => {
    btn.addEventListener('click', () => {
      const orderId = btn.getAttribute('data-order-id');
      const order = orders.find(o => o && o.id === orderId);
      if (order) openInvoiceModal(order);
    });
  });
}

/**
 * Generates an executive printable financial audit statement for the selected date or range
 */
function printCalendarReport() {
  const bounds = getCalendarReportDateBounds();
  const orders = getOrdersForCalendarReport();
  const printContainer = document.getElementById('print-report-container');
  if (!printContainer) return;

  let totalRev = 0;
  let codRev = 0;
  let onlineRev = 0;
  let deliveredCount = 0;
  let totalKms = 0;
  const deliveredOrders = [];

  orders.forEach(o => {
    if (String(o.status || '').toLowerCase() === 'delivered') {
      deliveredCount++;
      deliveredOrders.push(o);
      const amt = Number(String(o.total || '0').replace(/[^0-9.]/g, '')) || 0;
      totalRev += amt;
      if (isOnlineOrderPayment(o)) onlineRev += amt;
      else codRev += amt;
      totalKms += Number(o.addressDetails?.distanceKm || o.distance_km || o.distanceKm || 0);
    }
  });

  const payoutConfig = dataService.getPayoutConfig();
  let totalPayouts = 0;
  const ordersByRider = new Map();

  deliveredOrders.forEach(o => {
    const key = String(o.assignedRiderPin || o.assignedRiderName || 'unassigned').trim();
    if (!ordersByRider.has(key)) ordersByRider.set(key, []);
    ordersByRider.get(key).push(o);
  });

  ordersByRider.forEach(rOrders => {
    const res = dataService.calculateRiderPayout(rOrders, payoutConfig);
    totalPayouts += (res.exactPayout || res.totalPayout || 0);
  });

  const netDrawer = Math.round(codRev - totalPayouts);
  const netRetention = Math.round(totalRev - totalPayouts);

  printContainer.innerHTML = `
    <div style="padding: 28px; font-family: sans-serif; color: #000; background: #FFF;">
      <div style="border-bottom: 2px solid #000; padding-bottom: 12px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: flex-end;">
        <div>
          <h1 style="margin: 0; font-size: 1.6rem; letter-spacing: -0.01em;">👑 SAVERA PARADISE</h1>
          <h3 style="margin: 4px 0 0 0; font-size: 1.1rem; color: #111;">Executive Sales & Rider Settlement Statement</h3>
          <p style="margin: 4px 0 0 0; font-size: 0.82rem; color: #555;">Audited Horizon: <strong>${bounds.label}</strong></p>
        </div>
        <div style="text-align: right; font-size: 0.78rem; color: #666;">
          <div>Generated on: ${new Date().toLocaleString('en-IN')}</div>
          <div style="font-weight: bold; color: #111; margin-top: 2px;">🔒 100% READ-ONLY CERTIFIED RECORD</div>
        </div>
      </div>

      <!-- Financial Metrics Grid -->
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px;">
        <div style="border: 1px solid #000; padding: 12px; border-radius: 6px;">
          <span style="display: block; font-size: 0.72rem; color: #444; font-weight: bold;">TOTAL SALES EARNINGS</span>
          <span style="font-size: 1.4rem; font-weight: bold;">₹${totalRev.toLocaleString('en-IN')}</span>
          <div style="font-size: 0.72rem; color: #666;">${deliveredCount} orders delivered</div>
        </div>
        <div style="border: 1px solid #000; padding: 12px; border-radius: 6px;">
          <span style="display: block; font-size: 0.72rem; color: #444; font-weight: bold;">CASH (COD) COLLECTED</span>
          <span style="font-size: 1.4rem; font-weight: bold;">₹${codRev.toLocaleString('en-IN')}</span>
          <div style="font-size: 0.72rem; color: #666;">Physical Counter Cash</div>
        </div>
        <div style="border: 1px solid #000; padding: 12px; border-radius: 6px;">
          <span style="display: block; font-size: 0.72rem; color: #444; font-weight: bold;">ONLINE & UPI (BANK)</span>
          <span style="font-size: 1.4rem; font-weight: bold;">₹${onlineRev.toLocaleString('en-IN')}</span>
          <div style="font-size: 0.72rem; color: #666;">Direct in Bank Account</div>
        </div>
        <div style="border: 1px solid #000; padding: 12px; border-radius: 6px;">
          <span style="display: block; font-size: 0.72rem; color: #444; font-weight: bold;">PAID TO RIDERS</span>
          <span style="font-size: 1.4rem; font-weight: bold;">₹${Math.round(totalPayouts).toLocaleString('en-IN')}</span>
          <div style="font-size: 0.72rem; color: #666;">${totalKms.toFixed(1)} km fleet driven</div>
        </div>
        <div style="border: 1px solid #000; padding: 12px; border-radius: 6px;">
          <span style="display: block; font-size: 0.72rem; color: #444; font-weight: bold;">NET CASH IN DRAWER</span>
          <span style="font-size: 1.4rem; font-weight: bold;">₹${netDrawer.toLocaleString('en-IN')}</span>
          <div style="font-size: 0.72rem; color: #666;">Food Cash − Rider Pay</div>
        </div>
        <div style="border: 1px solid #000; padding: 12px; border-radius: 6px;">
          <span style="display: block; font-size: 0.72rem; color: #444; font-weight: bold;">NET SALES RETENTION</span>
          <span style="font-size: 1.4rem; font-weight: bold;">₹${netRetention.toLocaleString('en-IN')}</span>
          <div style="font-size: 0.72rem; color: #666;">Sales − Rider Expenses</div>
        </div>
      </div>

      <!-- Rider Settlement Table Snapshot -->
      <div style="margin-top: 20px;">
        <h4 style="margin: 0 0 8px 0; font-size: 0.95rem; text-transform: uppercase;">Delivery Boys Settlement Breakdown</h4>
        ${document.getElementById('report-rider-table')?.outerHTML || '<p>No delivery riders.</p>'}
      </div>

      <!-- Dish Sales Summary Snapshot -->
      <div style="margin-top: 24px;">
        <h4 style="margin: 0 0 8px 0; font-size: 0.95rem; text-transform: uppercase;">Menu Items Sales Summary</h4>
        ${document.getElementById('report-dishes-table')?.outerHTML || '<p>No menu items.</p>'}
      </div>

      <!-- Signatures -->
      <div style="margin-top: 48px; display: flex; justify-content: space-between; font-size: 0.85rem; color: #333;">
        <div>Executive Auditor: Owner Portal System</div>
        <div style="border-top: 1px solid #000; width: 220px; text-align: center; padding-top: 6px;">Proprietor / Owner Signature</div>
      </div>
    </div>
  `;

  window.print();
}

/**
 * Exports the selected date / range orders into CSV
 */
function exportCalendarReportCSV() {
  const bounds = getCalendarReportDateBounds();
  const orders = getOrdersForCalendarReport();

  const headers = [
    'Order ID',
    'Date',
    'Time',
    'Customer Name',
    'Customer Phone',
    'Delivery Address',
    'Distance (KM)',
    'Payment Mode',
    'Order Total (INR)',
    'Order Status',
    'Assigned Delivery Boy',
    'Items Summary'
  ];

  const rows = orders.map(o => {
    const cleanId = formatDisplayOrderId(o.id, o.pickupCode);
    const dateObj = o.createdAt ? new Date(o.createdAt) : new Date();
    const dateStr = dateObj.toLocaleDateString('en-IN');
    const timeStr = dateObj.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

    const dist = Number(o.addressDetails?.distanceKm || o.distance_km || o.distanceKm || 0).toFixed(1);
    const payment = isOnlineOrderPayment(o) ? 'Online / UPI' : 'Cash (COD)';
    const rawTotal = Number(String(o.total || '0').replace(/[^0-9.]/g, '')) || 0;
    const status = String(o.status || 'pending');
    const items = Array.isArray(o.items) ? o.items : [];
    const itemsSummary = items.map(it => `${it.quantity || 1}x ${it.name}`).join('; ');

    return [
      sanitizeCsvCell(cleanId),
      sanitizeCsvCell(dateStr),
      sanitizeCsvCell(timeStr),
      sanitizeCsvCell(o.customerName || o.customer_name || 'Customer'),
      sanitizeCsvCell(extractPhoneFromOrder(o) || ''),
      sanitizeCsvCell(cleanDeliveryAddress(o.deliveryAddress || o.delivery_address || '')),
      sanitizeCsvCell(dist),
      sanitizeCsvCell(payment),
      sanitizeCsvCell(rawTotal),
      sanitizeCsvCell(status),
      sanitizeCsvCell(o.assignedRiderName || 'Unassigned'),
      sanitizeCsvCell(itemsSummary)
    ].join(',');
  });

  const csvText = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  const safeLabel = bounds.label.replace(/[^a-zA-Z0-9_-]/g, '_');
  link.setAttribute('download', `Savera_Paradise_Sales_Audit_${safeLabel}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

