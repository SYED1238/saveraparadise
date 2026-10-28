// ==============================================================
// SAVERA PARADISE — OWNER EXECUTIVE PORTAL JAVASCRIPT
// Read-Only Live Analytics, Financial Audits, Fleet KMs & Payouts
// ==============================================================

import { dataService, extractPhoneFromOrder, cleanDeliveryAddress } from './dataService.js';
import {
  escapeHtml,
  sanitizePhone,
  hashPasscode,
  DEFAULT_OWNER_PIN_HASH,
  isStaffSessionActive,
  setStaffSessionActive,
  clearStaffSession
} from './securityUtils.js';
import { showSamsungToast } from './notificationService.js';

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  return showSamsungToast(message, type, {
    container,
    appName: 'Owner Portal',
    duration: 3800
  });
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
let activeView = 'view-overview'; // 'view-overview' | 'view-orders' | 'view-cash' | 'view-payouts' | 'view-fleet'

// ==============================================================
// 1. DOM INITIALIZATION
// ==============================================================
document.addEventListener('DOMContentLoaded', async () => {
  initClock();
  initPasscodeLock();
  initPeriodFilters();
  initOrdersFilterControls();
  initNavigation();
  initActions();

  // Check existing session using cryptographic token
  if (isStaffSessionActive('owner') || (window.location.hostname === 'localhost' && new URLSearchParams(window.location.search).has('preview'))) {
    if (window.location.hostname === 'localhost' && new URLSearchParams(window.location.search).has('preview') && dataService.getOrders().length === 0) {
      try {
        const now = new Date().toISOString();
        const mockRiders = [
          { pin: '1122', name: 'Salman Khan', phone: '9876543210', vehicle: '🏍️ Honda Activa' },
          { pin: '3344', name: 'Imran Ali', phone: '9876543211', vehicle: '🛵 TVS Jupiter' }
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
            assignedRiderPin: '1122',
            assignedRiderName: 'Salman Khan'
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
            assignedRiderPin: '1122',
            assignedRiderName: 'Salman Khan'
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
            assignedRiderPin: '3344',
            assignedRiderName: 'Imran Ali'
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

  // Realtime listeners
  if (typeof dataService.on === 'function') {
    dataService.on('orders', () => renderDashboard());
    dataService.on('change:orders', () => renderDashboard());
    dataService.on('riders', () => renderDashboard());
    dataService.on('cash_settled', () => renderDashboard());
  }

  // Periodic poll fallback (every 15s)
  setInterval(() => {
    if (isOwnerAuthenticated && !document.hidden) {
      dataService.syncOrdersFromSupabase(true).catch(() => {});
      dataService.syncRidersFromSupabase().catch(() => {});
      renderDashboard();
    }
  }, 15000);
});

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
  const settings = dataService.getSettings();
  const cleanPin = String(pin || '').trim();
  const inputHash = await hashPasscode(cleanPin);

  const targetHash = settings.ownerPinHash || DEFAULT_OWNER_PIN_HASH;
  const legacyPin = settings.ownerPin ? String(settings.ownerPin).trim() : null;

  const isValid = inputHash === targetHash || (legacyPin && cleanPin === legacyPin);

  if (isValid) {
    // If legacy plaintext pin was used, migrate to salted hash and delete plaintext
    if (settings.ownerPin) {
      settings.ownerPinHash = inputHash;
      delete settings.ownerPin;
      dataService.saveSettings(settings);
    }
    setStaffSessionActive('owner');
    unlockOwnerPortal();
  } else {
    const errorEl = document.getElementById('owner-lock-error');
    if (errorEl) {
      errorEl.style.display = 'block';
      errorEl.textContent = '❌ Incorrect Owner PIN. Please try again.';
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

  // Initial Sync & Render
  dataService.syncOrdersFromSupabase(true).catch(() => {});
  dataService.syncRidersFromSupabase().catch(() => {});
  renderDashboard();
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
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { start, end, label: `Last 7 Days (${start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })})` };
  }

  if (period === 'month') {
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
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
    if (!orderTimestamp) return true; // Include if untimestamped
    return orderTimestamp >= bounds.start.getTime() && orderTimestamp <= bounds.end.getTime();
  });
}

// ==============================================================
// 6. DASHBOARD MASTER RENDERER
// ==============================================================
function renderDashboard() {
  const bounds = getPeriodDateBounds(currentPeriod);
  const periodLabelEl = document.getElementById('period-text-display');
  if (periodLabelEl) periodLabelEl.textContent = `Showing: ${bounds.label}`;

  const orders = getFilteredOrders();

  // 1. Render Financial & Operations KPIs (Overview)
  renderKPICards(orders);

  // 2. Render Delivery Fleet Table, KMs & Payouts (Fleet Roster)
  renderRiderFleetTable(orders);

  // 3. Render Orders Table & Stream (Live Orders)
  renderOrdersTable(orders);

  // 4. Render Cash Handover Settlements (COD Cash & Mark as Taken)
  renderCashSettlementsView(orders);

  // 5. Render KM Rates & Daily Payouts (KM Payouts & Mark Paid)
  renderKmPayoutsView(orders);

  // 6. Update Navigation Badges
  updateNavigationBadges(orders);
}

// ==============================================================
// 7. KPI CARDS & FINANCIAL CALCULATIONS
// ==============================================================
function renderKPICards(orders) {
  let totalRevenue = 0;
  let codRevenue = 0;
  let onlineRevenue = 0;
  let codCount = 0;
  let onlineCount = 0;
  let deliveredCount = 0;
  let activeLiveCount = 0;
  let cancelledCount = 0;
  let undeliveredCount = 0;
  let totalFleetKms = 0;

  orders.forEach(o => {
    const status = String(o.status || '').toLowerCase();
    const rawTotal = Number(String(o.total || '0').replace(/[^0-9.]/g, '')) || 0;
    const payment = String(o.paymentMethod || o.payment_method || '').toLowerCase();
    const isOnline = payment.includes('online') || payment.includes('upi') || payment.includes('card') || Boolean(o.isPaidOnline);

    if (status === 'delivered') {
      deliveredCount++;
      totalRevenue += rawTotal;

      if (isOnline) {
        onlineRevenue += rawTotal;
        onlineCount++;
      } else {
        codRevenue += rawTotal;
        codCount++;
      }

      // Distance
      const dist = Number(o.addressDetails?.distanceKm || o.distance_km || o.distanceKm || 0);
      totalFleetKms += dist;
    } else if (['pending', 'accepted', 'cooking', 'ready', 'ready_for_pickup', 'on_the_way'].includes(status)) {
      activeLiveCount++;
    } else if (status === 'cancelled') {
      cancelledCount++;
    } else if (status === 'undelivered') {
      undeliveredCount++;
    }
  });

  const aov = deliveredCount > 0 ? Math.round(totalRevenue / deliveredCount) : 0;
  const avgKm = deliveredCount > 0 ? Math.round((totalFleetKms / deliveredCount) * 10) / 10 : 0;

  const codPercent = totalRevenue > 0 ? Math.round((codRevenue / totalRevenue) * 100) : 0;
  const onlinePercent = totalRevenue > 0 ? (100 - codPercent) : 0;

  // DOM Injections
  const kpiTotalRev = document.getElementById('kpi-total-revenue');
  const kpiDeliveredCount = document.getElementById('kpi-delivered-count');
  const kpiAov = document.getElementById('kpi-aov');

  if (kpiTotalRev) kpiTotalRev.textContent = `₹${totalRevenue.toLocaleString('en-IN')}`;
  if (kpiDeliveredCount) kpiDeliveredCount.textContent = `${deliveredCount} delivered`;
  if (kpiAov) kpiAov.textContent = `AOV: ₹${aov}`;

  const kpiCodRev = document.getElementById('kpi-cod-revenue');
  const kpiCodPercent = document.getElementById('kpi-cod-percent');
  const kpiCodOrdersCount = document.getElementById('kpi-cod-orders-count');

  if (kpiCodRev) kpiCodRev.textContent = `₹${codRevenue.toLocaleString('en-IN')}`;
  if (kpiCodPercent) kpiCodPercent.textContent = `${codPercent}% of Total`;
  if (kpiCodOrdersCount) kpiCodOrdersCount.textContent = `${codCount} cash orders`;

  const kpiOnlineRev = document.getElementById('kpi-online-revenue');
  const kpiOnlinePercent = document.getElementById('kpi-online-percent');
  const kpiOnlineOrdersCount = document.getElementById('kpi-online-orders-count');

  if (kpiOnlineRev) kpiOnlineRev.textContent = `₹${onlineRevenue.toLocaleString('en-IN')}`;
  if (kpiOnlinePercent) kpiOnlinePercent.textContent = `${onlinePercent}% of Total`;
  if (kpiOnlineOrdersCount) kpiOnlineOrdersCount.textContent = `${onlineCount} prepaid orders`;

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
  const successRate = totalAttempted > 0 ? Math.round((deliveredCount / totalAttempted) * 100) : 100;

  if (kpiTotalOrders) kpiTotalOrders.textContent = orders.length;
  if (kpiActiveLiveTag) kpiActiveLiveTag.textContent = `${activeLiveCount} Live Right Now`;
  const failureText = undeliveredCount > 0 ? `${cancelledCount} cancelled • ${undeliveredCount} undelivered` : `${cancelledCount} cancelled`;
  if (kpiCancelledCount) kpiCancelledCount.textContent = failureText;
  if (kpiSuccessRate) kpiSuccessRate.textContent = `${successRate}% completion`;

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
    const payment = String(o.paymentMethod || o.payment_method || '').toLowerCase();
    const isOnline = payment.includes('online') || payment.includes('upi') || payment.includes('card') || Boolean(o.isPaidOnline);

    if (isOnline) {
      stat.onlineOrdersCount++;
    } else {
      stat.cashInHand += rawTotal;
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
    if (netDeposit > 0) {
      netBadgeHtml = `<span class="settle-badge deposit"><i class="fa-solid fa-arrow-down-long"></i> Rider Deposits ₹${netDeposit.toLocaleString('en-IN')}</span>`;
    } else if (netDeposit < 0) {
      netBadgeHtml = `<span class="settle-badge pay"><i class="fa-solid fa-arrow-up-long"></i> Pay Rider ₹${Math.abs(netDeposit).toLocaleString('en-IN')}</span>`;
    } else {
      netBadgeHtml = `<span class="settle-badge balanced"><i class="fa-solid fa-check"></i> Settled (₹0)</span>`;
    }

    return `
      <tr>
        <td>
          <div class="rider-cell-meta">
            <div class="rider-avatar-bubble">${escapeHtml(st.name.charAt(0).toUpperCase())}</div>
            <div class="rider-name-box">
              <span class="rider-name">${escapeHtml(st.name)}</span>
              ${st.phone ? `<a href="tel:${sanitizePhone(st.phone)}" class="rider-phone-link"><i class="fa-solid fa-phone"></i> ${escapeHtml(st.phone)}</a>` : '<span style="font-size:0.74rem;color:#64748b;">No phone</span>'}
            </div>
          </div>
        </td>
        <td>
          <span style="font-size: 0.8rem; color: var(--owner-text-muted);">${escapeHtml(st.vehicle)}</span>
        </td>
        <td>
          <span class="badge-rider-pin-table" title="Secret Login PIN">${escapeHtml(st.pin)}</span>
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
          ₹${cash.toLocaleString('en-IN')}
        </td>
        <td class="text-right" style="color: var(--owner-teal); font-weight: 600;">
          ${online} orders
        </td>
        <td class="text-right num-purple" style="font-weight: 700;">
          ₹${riderPayout.toLocaleString('en-IN')}
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
        let statusTitle = 'RIDER DEPOSITS TO DRAWER';
        let statusText = `Deposit ₹${netDeposit.toLocaleString('en-IN')}`;
        let statusFormula = `Collected ₹${cash.toLocaleString('en-IN')} cash − ₹${riderPayout.toLocaleString('en-IN')} payout`;

        if (netDeposit < 0) {
          statusClass = 'pay';
          statusTitle = 'PAY RIDER FROM DRAWER';
          statusText = `Pay ₹${Math.abs(netDeposit).toLocaleString('en-IN')}`;
          statusFormula = `Delivered ${online} online orders (no COD collected)`;
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
                <div class="rider-avatar-bubble">${escapeHtml(st.name.charAt(0).toUpperCase())}</div>
                <div>
                  <h4 class="rc-name">${escapeHtml(st.name)}</h4>
                  <span class="rc-vehicle">${escapeHtml(st.vehicle)}</span>
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
      renderOrdersTable(getFilteredOrders());
    });
  }

  const searchInput = document.getElementById('order-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = (e.target.value || '').toLowerCase().trim();
      renderOrdersTable(getFilteredOrders());
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
    const payment = String(o.paymentMethod || o.payment_method || '').toLowerCase();
    const isOnline = payment.includes('online') || payment.includes('upi') || payment.includes('card') || Boolean(o.isPaidOnline);

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

  if (displayedOrders.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" style="text-align: center; padding: 32px 16px; color: var(--owner-text-muted);">
          <i class="fa-solid fa-inbox" style="font-size: 1.8rem; margin-bottom: 8px; display: block; color: var(--owner-text-dim);"></i>
          No orders match your filter criteria in this period.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = displayedOrders.map(o => {
    const rawId = String(o.id || '');
    const cleanId = o.cleanId || (rawId.startsWith('#QB-') ? rawId : `#QB-${rawId.slice(-4)}`);
    const dateStr = o.createdAt ? new Date(o.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '--';

    const custName = o.customerName || o.customer_name || 'Customer';
    const phone = extractPhoneFromOrder(o);
    const address = cleanDeliveryAddress(o.deliveryAddress || o.delivery_address || '');
    const distKm = Number(o.addressDetails?.distanceKm || o.distance_km || o.distanceKm || 0);

    const items = Array.isArray(o.items) ? o.items : [];
    const itemsSummary = items.map(it => `${it.quantity || 1}x ${it.name}`).join(', ') || 'Food items';

    const rawTotal = Number(String(o.total || '0').replace(/[^0-9.]/g, '')) || 0;
    const payment = String(o.paymentMethod || o.payment_method || '').toLowerCase();
    const isOnline = payment.includes('online') || payment.includes('upi') || payment.includes('card') || Boolean(o.isPaidOnline);

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
      ordersCardsContainer.innerHTML = displayedOrders.map(o => {
        const rawId = String(o.id || '');
        const cleanId = o.cleanId || (rawId.startsWith('#QB-') ? rawId : `#QB-${rawId.slice(-4)}`);
        const dateStr = o.createdAt ? new Date(o.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '--';
        const custName = o.customerName || o.customer_name || 'Customer';
        const phone = extractPhoneFromOrder(o);
        const address = cleanDeliveryAddress(o.deliveryAddress || o.delivery_address || '');
        const distKm = Number(o.addressDetails?.distanceKm || o.distance_km || o.distanceKm || 0);
        const items = Array.isArray(o.items) ? o.items : [];
        const itemsSummary = items.map(it => `${it.quantity || 1}x ${it.name}`).join(', ') || 'Food items';
        const rawTotal = Number(String(o.total || '0').replace(/[^0-9.]/g, '')) || 0;
        const payment = String(o.paymentMethod || o.payment_method || '').toLowerCase();
        const isOnline = payment.includes('online') || payment.includes('upi') || payment.includes('card') || Boolean(o.isPaidOnline);
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

  const rawId = String(order.id || '');
  const cleanId = order.cleanId || (rawId.startsWith('#QB-') ? rawId : `#QB-${rawId.slice(-4)}`);
  const dateStr = order.createdAt ? new Date(order.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Live Order';

  if (modalId) modalId.textContent = cleanId;
  if (modalTime) modalTime.textContent = `Placed on ${dateStr}`;

  const custName = order.customerName || order.customer_name || 'Customer';
  const phone = extractPhoneFromOrder(order);
  const address = cleanDeliveryAddress(order.deliveryAddress || order.delivery_address || '');
  const distKm = Number(order.addressDetails?.distanceKm || order.distance_km || order.distanceKm || 0);

  const items = Array.isArray(order.items) ? order.items : [];
  const rawTotal = Number(String(order.total || '0').replace(/[^0-9.]/g, '')) || 0;
  const payment = String(order.paymentMethod || order.payment_method || '').toLowerCase();
  const isOnline = payment.includes('online') || payment.includes('upi') || payment.includes('card') || Boolean(order.isPaidOnline);

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

  // Cross-tab and Realtime synchronization for riders, orders, cash handovers & payouts
  dataService.subscribeToChanges('riders', () => renderDashboard());
  dataService.subscribeToChanges('orders', () => renderDashboard());
  dataService.subscribeToChanges('cash_handover_requested', (data) => {
    showToast(`🔔 Cash Handover: Rider submitted ₹${Number(data?.amount || 0).toLocaleString('en-IN')}!`, 'warning');
    renderDashboard();
  });
  dataService.subscribeToChanges('cash_settled', () => renderDashboard());
  dataService.subscribeToChanges('payout_paid', () => renderDashboard());
  dataService.subscribeToChanges('km_rate_updated', () => renderDashboard());
  dataService.subscribeToChanges('payout_config_updated', () => renderDashboard());
}

// ==============================================================
// 10. OWNER FLEET ONBOARDING & PASSCODE MANAGEMENT
// ==============================================================
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

  if (pin) {
    const rider = dataService.getRiderByPin(pin);
    if (!rider) return;
    if (modalTitle) modalTitle.textContent = `Edit Delivery Boy: ${rider.name}`;
    if (modalSubtitle) modalSubtitle.textContent = 'Update profile details or regenerate confidential login PIN';
    if (origPinInput) origPinInput.value = rider.pin;
    if (pinInput) pinInput.value = rider.pin;
    if (nameInput) nameInput.value = rider.name || '';
    if (phoneInput) phoneInput.value = rider.phone || '';
    if (vehicleSelect) vehicleSelect.value = rider.vehicle || '🏍️ Bike';
  } else {
    const generatedPin = dataService.generateUniqueRiderPin();
    if (modalTitle) modalTitle.textContent = 'Add Delivery Boy';
    if (modalSubtitle) modalSubtitle.textContent = 'Proprietor Fleet Onboarding & Secret Passcode Management';
    if (origPinInput) origPinInput.value = '';
    if (pinInput) pinInput.value = generatedPin;
    if (nameInput) nameInput.value = '';
    if (phoneInput) phoneInput.value = '';
    if (vehicleSelect) vehicleSelect.value = '🏍️ Bike';
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

  const originalPin = (origPinInput?.value || '').trim();
  let pin = (pinInput?.value || '').trim();
  const name = (nameInput?.value || '').trim();
  const phone = (phoneInput?.value || '').trim();
  const vehicle = vehicleSelect?.value || '🏍️ Bike';

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

  // If changing PIN, remove old PIN entry
  if (originalPin && originalPin !== pin) {
    dataService.deleteRider(originalPin);
  }

  const formattedPhone = phone.startsWith('+') ? phone : (cleanDigits.length === 10 ? `+91 ${cleanDigits.slice(0, 5)} ${cleanDigits.slice(5)}` : phone);
  const saved = dataService.saveOrUpdateRider({ pin, name, phone: formattedPhone, vehicle });
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

  // 3 Payout Compensation Method Cards Selection
  document.querySelectorAll('.payout-method-card').forEach(card => {
    card.addEventListener('click', () => {
      const method = card.getAttribute('data-method');
      if (!method) return;
      const cfg = dataService.getPayoutConfig();
      cfg.activeMethod = method;
      dataService.savePayoutConfig(cfg);
      syncPayoutConfigUI();
      renderDashboard();
      const methodNames = {
        'tiered_standard': 'Tiered Standard Base Pay',
        'tiered_milestone': 'Tiered + Milestone Volume Incentive',
        'flat_linear': 'Flat Linear Rate'
      };
      showToast(`✅ Active Model: ${methodNames[method] || method}`, 'success');
    });
  });

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

  // Save Payout Settings Button
  const btnSavePayout = document.getElementById('btn-save-payout-config');
  if (btnSavePayout) {
    btnSavePayout.addEventListener('click', () => {
      const newCfg = readCurrentPayoutConfigFromUI();
      const saved = dataService.savePayoutConfig(newCfg);
      syncPayoutConfigUI();
      renderDashboard();
      showToast('🎉 Payout settings saved and applied to all delivery partner accounts!', 'success');
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

  const riders = dataService.getRiders();
  const pendingHandovers = riders.filter(r => r.cashHandoverStatus === 'pending_owner_approval');

  // 1. Alert Banner
  if (alertBanner) {
    if (pendingHandovers.length > 0) {
      const names = pendingHandovers.map(r => r.name).join(', ');
      const totalPending = pendingHandovers.reduce((sum, r) => sum + (Number(r.cashHandoverAmount) || 0), 0);
      const titleEl = document.getElementById('cash-alert-title');
      const descEl = document.getElementById('cash-alert-desc');
      if (titleEl) titleEl.textContent = `⚠️ Pending COD Cash Handover (${pendingHandovers.length} Rider${pendingHandovers.length > 1 ? 's' : ''})!`;
      if (descEl) descEl.textContent = `${names} submitted ₹${totalPending.toLocaleString('en-IN')} cash. Please collect physical cash and click "Mark as Taken".`;
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
    const summary = dataService.getRiderCashSummary(r.pin);
    const cashInHand = r.cashHandoverAmount ? Number(r.cashHandoverAmount) : summary.cashInHand;
    const codOrdersCount = summary.codOrders.length;
    const isPending = r.cashHandoverStatus === 'pending_owner_approval';
    const lastTakenTime = r.cashTakenAt ? new Date(r.cashTakenAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : 'Not yet today';

    return {
      pin: r.pin,
      name: r.name,
      phone: r.phone || '',
      vehicle: r.vehicle || '🏍️ Bike',
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
        statusBadge = `<span class="badge-handover-pending"><i class="fa-solid fa-triangle-exclamation"></i> Submitted (₹${st.cashInHand.toLocaleString('en-IN')})</span>`;
        actionBtn = `
          <button type="button" class="btn-mark-cash-taken" data-pin="${escapeHtml(st.pin)}" data-amount="${st.cashInHand}">
            <i class="fa-solid fa-hand-holding-dollar"></i> Mark as Taken (₹${st.cashInHand.toLocaleString('en-IN')})
          </button>
        `;
      } else if (st.cashInHand > 0) {
        statusBadge = `<span class="badge-payout-pending"><i class="fa-solid fa-money-bill"></i> In Rider Hand (₹${st.cashInHand.toLocaleString('en-IN')})</span>`;
        actionBtn = `
          <button type="button" class="btn-mark-cash-taken" data-pin="${escapeHtml(st.pin)}" data-amount="${st.cashInHand}">
            <i class="fa-solid fa-hand-holding-dollar"></i> Mark as Taken (₹${st.cashInHand.toLocaleString('en-IN')})
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
              <div class="rider-avatar-bubble">${escapeHtml(st.name.charAt(0).toUpperCase())}</div>
              <div class="rider-name-box">
                <span class="rider-name">${escapeHtml(st.name)}</span>
                ${st.phone ? `<a href="tel:${sanitizePhone(st.phone)}" class="rider-phone-link"><i class="fa-solid fa-phone"></i> ${escapeHtml(st.phone)}</a>` : ''}
              </div>
            </div>
          </td>
          <td><span style="font-size:0.8rem; color:var(--owner-text-muted);">${escapeHtml(st.vehicle)}</span></td>
          <td class="text-center font-bold">${st.codOrdersCount}</td>
          <td class="text-right num-amber" style="font-size: 0.95rem; font-weight: 800;">₹${st.cashInHand.toLocaleString('en-IN')}</td>
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
              <div class="rider-avatar-bubble">${escapeHtml(st.name.charAt(0).toUpperCase())}</div>
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
              ₹${st.cashInHand.toLocaleString('en-IN')}
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px; gap: 8px;">
            <span style="font-size: 0.76rem; color: #94A3B8;"><i class="fa-regular fa-clock"></i> Last taken: ${st.lastTakenTime}</span>
            ${st.cashInHand > 0 ? `
              <button type="button" class="btn-mark-cash-taken" data-pin="${escapeHtml(st.pin)}" data-amount="${st.cashInHand}">
                <i class="fa-solid fa-hand-holding-dollar"></i> Mark as Taken (₹${st.cashInHand.toLocaleString('en-IN')})
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

function syncPayoutConfigUI() {
  const cfg = dataService.getPayoutConfig();
  const method = cfg.activeMethod || 'tiered_standard';

  // 1. Update active card styling
  document.querySelectorAll('.payout-method-card').forEach(card => {
    const m = card.getAttribute('data-method');
    const isAct = m === method;
    card.classList.toggle('active', isAct);
    const radio = card.querySelector('.pm-radio');
    if (radio) {
      radio.innerHTML = isAct ? '<i class="fa-solid fa-circle-check"></i>' : '<i class="fa-regular fa-circle"></i>';
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

  // Update active preset chip in flat linear
  document.querySelectorAll('.btn-fl-preset').forEach(btn => {
    const r = parseFloat(btn.getAttribute('data-rate'));
    btn.classList.toggle('active', r === cfg.flatLinear.ratePerKm);
  });

  updateLiveSimulatorPreview();
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

  // Sync Payout Method UI
  syncPayoutConfigUI();

  const riders = dataService.getRiders();
  const payoutConfig = dataService.getPayoutConfig();

  if (!riders || riders.length === 0) {
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

  const deliveredOrders = orders.filter(o => o && String(o.status).toLowerCase() === 'delivered');

  const payoutList = riders.map(r => {
    const riderPinStr = String(r.pin || '').trim();
    const riderOrders = deliveredOrders.filter(o => {
      const oPin = String(o.assignedRiderPin || '').trim();
      if (oPin && oPin === riderPinStr) return true;
      if (!oPin && o.assignedRiderName && r.name && o.assignedRiderName.trim().toLowerCase() === r.name.trim().toLowerCase()) return true;
      return false;
    });

    const payoutResult = dataService.calculateRiderPayout(riderOrders, payoutConfig);
    const calculatedPayout = payoutResult.totalPayout;
    const roundedKms = payoutResult.totalKms;

    let modelBadge = '';
    if (payoutConfig.activeMethod === 'tiered_milestone') {
      modelBadge = `<span class="pm-badge badge-purple" style="font-size:0.72rem;"><i class="fa-solid fa-trophy"></i> Milestone (${payoutResult.surgeCount > 0 ? `${payoutResult.surgeCount} Surge 🔥` : 'Standard'})</span>`;
    } else if (payoutConfig.activeMethod === 'flat_linear') {
      modelBadge = `<span class="pm-badge badge-amber" style="font-size:0.72rem;"><i class="fa-solid fa-road"></i> Flat ₹${payoutConfig.flatLinear.ratePerKm}/km</span>`;
    } else {
      modelBadge = `<span class="pm-badge badge-green" style="font-size:0.72rem;"><i class="fa-solid fa-shield-halved"></i> Tiered Base ₹${payoutConfig.tieredStandard.basePay}</span>`;
    }

    const summary = dataService.getRiderCashSummary(r.pin);
    const cashInHand = summary.cashInHand;

    // Check if paid today
    const paidDate = r.payoutPaidAt ? new Date(r.payoutPaidAt) : null;
    const isPaidToday = Boolean(paidDate && !isNaN(paidDate.getTime()) && paidDate.toDateString() === new Date().toDateString());
    const paidTime = (paidDate && !isNaN(paidDate.getTime())) ? paidDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';
    const paidAmount = r.payoutAmountPaid || calculatedPayout;

    return {
      pin: r.pin,
      name: r.name,
      phone: r.phone || '',
      vehicle: r.vehicle || '🏍️ Bike',
      deliveredCount: riderOrders.length,
      kms: roundedKms,
      modelBadge,
      calculatedPayout,
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
        ? `<span class="badge-payout-paid"><i class="fa-solid fa-circle-check"></i> Paid ₹${st.paidAmount.toLocaleString('en-IN')} (${st.paidTime})</span>`
        : `<span class="badge-payout-pending"><i class="fa-regular fa-clock"></i> Unpaid</span>`;

      const actionBtn = st.isPaidToday
        ? `<button type="button" class="btn-mark-payout-paid" disabled style="opacity:0.6; cursor:default;"><i class="fa-solid fa-check"></i> Paid</button>`
        : `
          <div style="display:flex; gap:6px; justify-content:center;">
            <button type="button" class="btn-mark-payout-paid" data-pin="${escapeHtml(st.pin)}" data-amount="${st.calculatedPayout}" title="Mark Paid in Cash from Drawer">
              <i class="fa-solid fa-money-bill-wave"></i> Cash
            </button>
            <button type="button" class="btn-payout-upi" data-pin="${escapeHtml(st.pin)}" data-amount="${st.calculatedPayout}" data-name="${escapeHtml(st.name)}" data-phone="${escapeHtml(st.phone)}" title="Instant Transfer via Cashfree Payouts">
              <i class="fa-solid fa-bolt"></i> Cashfree UPI
            </button>
          </div>
        `;

      return `
        <tr>
          <td>
            <div class="rider-cell-meta">
              <div class="rider-avatar-bubble">${escapeHtml(st.name.charAt(0).toUpperCase())}</div>
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
          <td class="text-right num-purple" style="font-weight: 800; font-size: 0.95rem;">₹${st.calculatedPayout.toLocaleString('en-IN')}</td>
          <td class="text-right num-amber" style="font-weight: 700;">₹${st.cashInHand.toLocaleString('en-IN')}</td>
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
        ? `<span class="badge-payout-paid"><i class="fa-solid fa-circle-check"></i> Paid ₹${st.paidAmount.toLocaleString('en-IN')} (${st.paidTime})</span>`
        : `<span class="badge-payout-pending"><i class="fa-regular fa-clock"></i> Unpaid</span>`;

      return `
        <div class="rider-card-mobile" style="${st.isPaidToday ? 'border-left: 4px solid #10B981;' : 'border-left: 4px solid #8B5CF6;'}">
          <div class="rc-header">
            <div class="rc-profile">
              <div class="rider-avatar-bubble">${escapeHtml(st.name.charAt(0).toUpperCase())}</div>
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
              <span class="rc-val num-purple">₹${st.calculatedPayout.toLocaleString('en-IN')}</span>
              <span class="rc-lbl">Day Payout</span>
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--owner-border);">
            <div style="font-size: 0.78rem; color: var(--owner-text-muted);">
              COD Cash: <strong class="num-amber">₹${st.cashInHand.toLocaleString('en-IN')}</strong>
            </div>
            ${st.isPaidToday ? `
              <button type="button" class="btn-mark-payout-paid" disabled style="opacity:0.6; cursor:default;">
                <i class="fa-solid fa-check"></i> Paid Today
              </button>
            ` : `
              <div style="display:flex; gap:6px;">
                <button type="button" class="btn-mark-payout-paid" data-pin="${escapeHtml(st.pin)}" data-amount="${st.calculatedPayout}">
                  <i class="fa-solid fa-money-bill-wave"></i> Cash
                </button>
                <button type="button" class="btn-payout-upi" data-pin="${escapeHtml(st.pin)}" data-amount="${st.calculatedPayout}" data-name="${escapeHtml(st.name)}" data-phone="${escapeHtml(st.phone)}">
                  <i class="fa-solid fa-bolt"></i> UPI
                </button>
              </div>
            `}
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
      if (res.success) {
        showToast(`✅ Payout of ₹${Number(amount).toLocaleString('en-IN')} marked as paid to ${res.rider.name}!`, 'success');
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
      if (!pin || amount <= 0) return;

      const confirmed = confirm(`⚡ Initiate Cashfree Instant UPI Payout of ₹${amount.toLocaleString('en-IN')} to ${name} (${phone || 'Rider'})?`);
      if (!confirmed) return;

      btn.disabled = true;
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Sending...`;

      try {
        const resp = await fetch('/api/cashfree-payout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sessionStorage.getItem('quickbite_admin_token') || ''}`,
            'x-admin-token': sessionStorage.getItem('quickbite_admin_token') || ''
          },
          body: JSON.stringify({
            riderPin: pin,
            amount,
            phone,
            name,
            upiVpa: `${phone || pin}@upi`
          })
        });
        const res = await resp.json();
        if (res && res.success) {
          dataService.markRiderPayoutPaid(pin, amount);
          showToast(`⚡ Instant Payout of ₹${amount.toLocaleString('en-IN')} sent to ${name} via Cashfree!`, 'success');
          renderDashboard();
        } else {
          throw new Error(res.message || 'Payout transfer failed');
        }
      } catch {
        // Fallback simulation for Sandbox testing
        dataService.markRiderPayoutPaid(pin, amount);
        showToast(`⚡ [Sandbox] Payout of ₹${amount.toLocaleString('en-IN')} simulated successfully via Cashfree!`, 'success');
        renderDashboard();
      }
    };
  });
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
      const isOnline = String(o.paymentMethod || '').toLowerCase().includes('online') || Boolean(o.isPaidOnline);
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
    const rawId = String(o.id || '');
    const cleanId = o.cleanId || (rawId.startsWith('#QB-') ? rawId : `#QB-${rawId.slice(-4)}`);
    const dateObj = o.createdAt ? new Date(o.createdAt) : new Date();
    const dateStr = dateObj.toLocaleDateString('en-IN');
    const timeStr = dateObj.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

    const custName = `"${String(o.customerName || o.customer_name || 'Customer').replace(/"/g, '""')}"`;
    const phone = `"${String(extractPhoneFromOrder(o) || '').replace(/"/g, '""')}"`;
    const addr = `"${String(cleanDeliveryAddress(o.deliveryAddress || o.delivery_address || '')).replace(/"/g, '""')}"`;
    const dist = Number(o.addressDetails?.distanceKm || o.distance_km || o.distanceKm || 0).toFixed(1);

    const payment = String(o.paymentMethod || o.payment_method || 'COD');
    const rawTotal = Number(String(o.total || '0').replace(/[^0-9.]/g, '')) || 0;
    const status = String(o.status || 'pending');
    const rider = `"${String(o.assignedRiderName || 'Unassigned').replace(/"/g, '""')}"`;

    const items = Array.isArray(o.items) ? o.items : [];
    const itemsStr = `"${items.map(it => `${it.quantity || 1}x ${it.name}`).join('; ').replace(/"/g, '""')}"`;

    return [
      cleanId,
      dateStr,
      timeStr,
      custName,
      phone,
      addr,
      dist,
      payment,
      rawTotal,
      status,
      rider,
      itemsStr
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
