// ==============================================================
// SAVERA PARADISE — OWNER EXECUTIVE PORTAL JAVASCRIPT
// Read-Only Live Analytics, Financial Audits, Fleet KMs & Payouts
// ==============================================================

import { dataService, extractPhoneFromOrder, cleanDeliveryAddress } from './dataService.js';
import { escapeHtml, sanitizePhone } from './securityUtils.js';

// --- STATE MANAGEMENT ---
let currentPeriod = 'today'; // 'today' | 'yesterday' | 'week' | 'month' | 'all' | 'custom'
let customStartDate = null;
let customEndDate = null;
let orderStatusFilter = 'all'; // 'all' | 'active' | 'delivered' | 'cash' | 'online' | 'cancelled'
let searchQuery = '';
let riderPayoutRate = 35; // ₹35 default per delivered order
let enteredPin = '';
let isOwnerAuthenticated = false;

// Default Owner PINs
const VALID_OWNER_PINS = ['9900', '8899'];

// ==============================================================
// 1. DOM INITIALIZATION
// ==============================================================
document.addEventListener('DOMContentLoaded', async () => {
  initClock();
  initPasscodeLock();
  initPeriodFilters();
  initOrdersFilterControls();
  initActions();

  // Check existing session
  if (sessionStorage.getItem('savera_owner_authenticated') === 'true') {
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

function verifyOwnerPin(pin) {
  const settings = dataService.getSettings();
  const configuredOwnerPin = settings.ownerPin || settings.managerPin || '9900';

  const isValid = VALID_OWNER_PINS.includes(pin) || String(configuredOwnerPin).trim() === pin;

  if (isValid) {
    sessionStorage.setItem('savera_owner_authenticated', 'true');
    unlockOwnerPortal();
  } else {
    const errorEl = document.getElementById('owner-lock-error');
    if (errorEl) {
      errorEl.style.display = 'block';
      errorEl.textContent = '❌ Incorrect Owner PIN. Try 9900 or 8899.';
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
  sessionStorage.removeItem('savera_owner_authenticated');

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

  // 1. Render Financial & Operations KPIs
  renderKPICards(orders);

  // 2. Render Delivery Fleet Table, KMs & Payouts
  renderRiderFleetTable(orders);

  // 3. Render Orders Table & Stream
  renderOrdersTable(orders);
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
    } else if (['pending', 'accepted', 'cooking', 'ready', 'on_the_way'].includes(status)) {
      activeLiveCount++;
    } else if (status === 'cancelled') {
      cancelledCount++;
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

  const totalAttempted = deliveredCount + cancelledCount;
  const successRate = totalAttempted > 0 ? Math.round((deliveredCount / totalAttempted) * 100) : 100;

  if (kpiTotalOrders) kpiTotalOrders.textContent = orders.length;
  if (kpiActiveLiveTag) kpiActiveLiveTag.textContent = `${activeLiveCount} Live Right Now`;
  if (kpiCancelledCount) kpiCancelledCount.textContent = `${cancelledCount} cancelled`;
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
    const riderPin = String(o.assignedRiderPin || '').trim();
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
        <td colspan="9" style="text-align: center; padding: 32px 16px; color: var(--owner-text-muted);">
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

    // Payout Calculation: Rate per delivered order
    const riderPayout = deliveryCount * riderPayoutRate;

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
          <span style="font-size: 0.8rem; color: #CBD5E1;">${escapeHtml(st.vehicle)}</span>
        </td>
        <td class="text-center font-bold" style="font-size: 0.95rem;">
          ${deliveryCount}
        </td>
        <td class="text-center" style="font-weight: 700; color: #C4B5FD;">
          <i class="fa-solid fa-route" style="font-size: 0.75rem;"></i> ${kms} km
        </td>
        <td class="text-center" style="color: var(--owner-text-muted);">
          ${avgKmPerOrder} km
        </td>
        <td class="text-right num-amber" style="font-weight: 700; font-size: 0.92rem;">
          ₹${cash.toLocaleString('en-IN')}
        </td>
        <td class="text-right" style="color: #5EEAD4; font-weight: 600;">
          ${online} orders
        </td>
        <td class="text-right num-purple" style="font-weight: 700;">
          ₹${riderPayout.toLocaleString('en-IN')}
        </td>
        <td class="text-right">
          ${netBadgeHtml}
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
    else if (['pending', 'accepted', 'cooking', 'ready', 'on_the_way'].includes(s)) countActive++;
    else if (s === 'cancelled') countCancelled++;
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
      if (!['pending', 'accepted', 'cooking', 'ready', 'on_the_way'].includes(status)) return false;
    } else if (orderStatusFilter === 'delivered') {
      if (status !== 'delivered') return false;
    } else if (orderStatusFilter === 'cancelled') {
      if (status !== 'cancelled') return false;
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
    let statusBadge = `<span class="status-badge ${status}">${status.replace(/_/g, ' ')}</span>`;

    let payBadge = isOnline
      ? `<span class="pay-badge online"><i class="fa-solid fa-credit-card"></i> Online Paid</span>`
      : `<span class="pay-badge cash"><i class="fa-solid fa-money-bill-wave"></i> Cash (COD)</span>`;

    return `
      <tr>
        <td>
          <span class="order-id-badge">${escapeHtml(cleanId)}</span>
        </td>
        <td style="color: #94A3B8; font-size: 0.8rem;">
          ${dateStr}
        </td>
        <td>
          <div style="font-weight: 600; color: #FFF;">${escapeHtml(custName)}</div>
          ${phone ? `<a href="tel:${sanitizePhone(phone)}" style="font-size: 0.74rem; color: #94A3B8; text-decoration: none;"><i class="fa-solid fa-phone"></i> ${escapeHtml(phone)}</a>` : ''}
        </td>
        <td style="max-width: 220px; white-space: normal; line-height: 1.35; font-size: 0.78rem;">
          <div style="color: #E2E8F0;">${escapeHtml(address)}</div>
          ${distKm > 0 ? `<span style="color: #A78BFA; font-weight: 700; font-size: 0.72rem;"><i class="fa-solid fa-route"></i> ${distKm.toFixed(1)} km road</span>` : ''}
        </td>
        <td style="max-width: 200px; white-space: normal; line-height: 1.35; font-size: 0.78rem; color: #CBD5E1;">
          ${escapeHtml(itemsSummary)}
        </td>
        <td>
          ${payBadge}
        </td>
        <td>
          ${riderName}
        </td>
        <td class="text-right font-bold" style="font-size: 0.95rem; color: #FFF;">
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
    <div style="background: rgba(255,255,255,0.04); padding: 14px; border-radius: 10px; border: 1px solid var(--owner-border);">
      <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
        <span style="color: var(--owner-text-muted);">Customer:</span>
        <strong style="color: #FFF;">${escapeHtml(custName)}</strong>
      </div>
      ${phone ? `
      <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
        <span style="color: var(--owner-text-muted);">Contact:</span>
        <a href="tel:${sanitizePhone(phone)}" style="color: #F59E0B; text-decoration: none; font-weight: 600;"><i class="fa-solid fa-phone"></i> ${escapeHtml(phone)}</a>
      </div>` : ''}
      <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
        <span style="color: var(--owner-text-muted);">Address:</span>
        <span style="color: #CBD5E1; text-align: right; max-width: 60%;">${escapeHtml(address)}</span>
      </div>
      ${distKm > 0 ? `
      <div style="display: flex; justify-content: space-between;">
        <span style="color: var(--owner-text-muted);">Road Distance:</span>
        <span style="color: #A78BFA; font-weight: 700;">${distKm.toFixed(1)} km</span>
      </div>` : ''}
    </div>

    <div style="background: rgba(255,255,255,0.04); padding: 14px; border-radius: 10px; border: 1px solid var(--owner-border);">
      <h4 style="margin: 0 0 10px 0; color: #FFF; font-size: 0.88rem;"><i class="fa-solid fa-utensils"></i> Items Ordered</h4>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        ${items.map(it => `
          <div style="display: flex; justify-content: space-between; font-size: 0.84rem;">
            <span><strong style="color: #F59E0B;">${it.quantity || 1}x</strong> ${escapeHtml(it.name)}</span>
            <span style="font-weight: 600; color: #FFF;">₹${Number(it.price || 0) * (it.quantity || 1)}</span>
          </div>
        `).join('')}
      </div>
    </div>

    <div style="background: rgba(255,255,255,0.06); padding: 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12);">
      <div style="display: flex; justify-content: space-between; font-size: 1.05rem; font-weight: 800; color: #FFF;">
        <span>Total Bill Amount:</span>
        <span style="color: #FBBF24;">₹${rawTotal.toLocaleString('en-IN')}</span>
      </div>
      <div style="display: flex; justify-content: space-between; margin-top: 8px; font-size: 0.82rem;">
        <span style="color: var(--owner-text-muted);">Payment Mode:</span>
        <span>${isOnline ? '<strong style="color:#5EEAD4;">Online Prepaid (Bank/UPI)</strong>' : '<strong style="color:#FCD34D;">Cash on Delivery (COD)</strong>'}</span>
      </div>
      <div style="display: flex; justify-content: space-between; margin-top: 4px; font-size: 0.82rem;">
        <span style="color: var(--owner-text-muted);">Assigned Delivery Boy:</span>
        <strong style="color: #FFF;">${order.assignedRiderName ? escapeHtml(order.assignedRiderName) : 'Unassigned'}</strong>
      </div>
      <div style="display: flex; justify-content: space-between; margin-top: 4px; font-size: 0.82rem;">
        <span style="color: var(--owner-text-muted);">Order Status:</span>
        <strong style="text-transform: capitalize; color: #34D399;">${String(order.status || 'delivered').replace(/_/g, ' ')}</strong>
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

  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `Savera_Paradise_Financial_Report_${currentPeriod}_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
