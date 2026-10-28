/**
 * QuickBite Delivery Boy Portal Logic
 * Real-time pickup & drop locations, turn-by-turn navigation guide,
 * and high-visibility Cash on Delivery (COD) tracking.
 */

import confetti from 'canvas-confetti';
import { dataService, RESTAURANT_COORDINATES, extractPhoneFromOrder, cleanDeliveryAddress } from './dataService.js';
import {
  playNotificationSound,
  sendSystemNotification,
  flashTabTitle,
  requestSystemNotificationPermission,
  getSystemNotificationPermission,
  updateAppBadge,
  showSamsungToast
} from './notificationService.js';
import { createBackNavigationManager } from './navigationBackService.js';
import {
  escapeHtml,
  sanitizeUrl,
  sanitizePhone,
  isStaffSessionActive,
  setStaffSessionActive,
  clearStaffSession,
  verifyStaffPin
} from './securityUtils.js';
import { initIosPasscodeLock } from './passcodeLockService.js';
import { requestWakeLock, releaseWakeLock } from './wakeLockService.js';
import './pwa.css';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet marker icons in Vite bundler
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Fixed Kitchen Info
const KITCHEN_INFO = {
  name: 'Savera Paradise Central Kitchen',
  hub: 'Ramanagara Hub',
  address: 'Aga complex, Railway Station Road, opp. to UCO BANK, Mandipet, Agrahar, Ramanagara, Karnataka 562159',
  phone: '+91 98450 12345',
  pickupInstructions: 'Collect from Counter 1 • Verify hot bag seal',
  lat: RESTAURANT_COORDINATES.lat,
  lng: RESTAURANT_COORDINATES.lng
};

document.addEventListener('DOMContentLoaded', () => {
  // Navigation Back Stack Controller (Single-step back navigation)
  const backNav = createBackNavigationManager('delivery');

  // ========================================================
  // RIDER SECURITY GATE: iOS PASSCODE KEYPAD CONTROLLER
  // ========================================================
  const riderLockOverlay = document.getElementById('rider-lock-overlay');
  const btnRiderLogout = document.getElementById('btn-rider-logout');

  const riderPasscodeLock = initIosPasscodeLock({
    overlayEl: riderLockOverlay,
    dotsEl: document.getElementById('rider-passcode-dots'),
    keypadEl: document.getElementById('rider-keypad'),
    subtitleEl: document.getElementById('rider-lock-subtitle'),
    hintEl: document.getElementById('rider-passcode-hint'),
    defaultCode: '',
    onVerify: async (pin) => {
      const cleanPin = String(pin).trim();
      let rider = dataService.getRiderByPin(cleanPin);
      if (!rider) {
        await dataService.syncRidersFromSupabase();
        rider = dataService.getRiderByPin(cleanPin);
      }
      return !!(rider && rider.name);
    },
    onSuccess: (pin) => {
      const cleanPin = String(pin).trim();
      const rider = dataService.getRiderByPin(cleanPin);

      if (rider && rider.name) {
        setStaffSessionActive('rider');
        dataService.setActiveRiderPin(cleanPin);
        updateRiderProfileHeader();
        requestWakeLock();
        showToast(`🛵 Welcome back, ${rider.name}!`, 'success');
        dataService.syncOrdersFromSupabase(true).then(() => {
          renderPortal();
        }).catch(() => {
          renderPortal();
        });
      } else {
        showToast('❌ Rider account not found. Please contact Admin.', 'error');
        if (riderPasscodeLock) riderPasscodeLock.reset();
      }
    }
  });

  function checkRiderSession() {
    if (isStaffSessionActive('rider')) {
      const activeRider = dataService.getActiveRider();
      if (!activeRider) {
        // Rider was deleted or session invalid
        clearStaffSession('rider');
        if (riderLockOverlay) riderLockOverlay.classList.remove('unlocked');
        if (riderPasscodeLock) riderPasscodeLock.reset();
        return;
      }
      if (riderLockOverlay) riderLockOverlay.classList.add('unlocked');
      updateRiderProfileHeader();
      requestWakeLock();
      dataService.syncOrdersFromSupabase().then(() => {
        renderPortal();
      }).catch(() => {});
    } else {
      if (riderLockOverlay) {
        riderLockOverlay.classList.remove('unlocked');
        if (riderPasscodeLock) riderPasscodeLock.reset();
      }
    }
  }

  if (btnRiderLogout) {
    btnRiderLogout.addEventListener('click', () => {
      clearStaffSession('rider');
      releaseWakeLock();
      if (riderLockOverlay) riderLockOverlay.classList.remove('unlocked');
      if (riderPasscodeLock) riderPasscodeLock.reset();
      showToast('🔒 Rider Portal Locked', 'info');
    });
  }

  // ========================================================
  // RIDER ACTIVE PROFILE CONTROLLER
  // ========================================================
  const riderNameDisplay = document.getElementById('rider-name-display');
  const riderPinBadge = document.getElementById('rider-pin-badge');
  const riderPhoneDisplay = document.getElementById('rider-phone-display');
  const riderVehicleTag = document.getElementById('rider-vehicle-tag');
  const riderIdDisplay = document.getElementById('rider-id-display');
  const riderAvatarImg = document.getElementById('rider-avatar-img');

  function updateRiderProfileHeader() {
    const currentRider = dataService.getActiveRider();
    if (!currentRider) {
      if (riderNameDisplay) riderNameDisplay.textContent = 'Delivery Partner';
      if (riderPinBadge) riderPinBadge.textContent = 'PIN: ----';
      if (riderPhoneDisplay) riderPhoneDisplay.textContent = '--';
      if (riderVehicleTag) riderVehicleTag.textContent = '🏍️ Bike';
      if (riderIdDisplay) riderIdDisplay.textContent = 'ID: ----';
      return;
    }

    if (riderNameDisplay) riderNameDisplay.textContent = currentRider.name;
    if (riderPinBadge) riderPinBadge.textContent = `PIN: ${currentRider.pin}`;
    if (riderPhoneDisplay) riderPhoneDisplay.textContent = currentRider.phone || 'No phone set';
    if (riderVehicleTag) riderVehicleTag.textContent = currentRider.vehicle || '🏍️ Bike';
    if (riderIdDisplay) riderIdDisplay.textContent = `ID: #RD-${currentRider.pin}`;
    if (riderAvatarImg) {
      let avatarSrc = currentRider.avatarImg || '/avatars/rider-1.svg';
      if (avatarSrc.includes('unsplash.com')) {
        avatarSrc = '/avatars/rider-1.svg';
      }
      riderAvatarImg.src = avatarSrc;
      riderAvatarImg.onerror = function() {
        this.onerror = null;
        this.src = '/avatars/rider-1.svg';
      };
    }
  }

  checkRiderSession();
  updateRiderProfileHeader();

  // ========================================================
  // STATE
  // ========================================================
  const RIDER_TAB_STORAGE_KEY = 'quickbite_rider_active_tab';
  function getPersistedRiderTab() {
    try {
      const saved = sessionStorage.getItem(RIDER_TAB_STORAGE_KEY);
      return (saved === 'ready' || saved === 'active' || saved === 'delivered') ? saved : null;
    } catch {
      return null;
    }
  }
  function persistRiderTab(tab) {
    try {
      if (tab) sessionStorage.setItem(RIDER_TAB_STORAGE_KEY, tab);
    } catch {}
  }

  let activeTab = getPersistedRiderTab() || 'ready'; // 1st: 'ready' (Kitchen Queue), 2nd: 'active', 3rd: 'delivered'
  let isDutyOn = true;
  let activeConfirmOrder = null;
  let pendingBagOrder = null;
  const miniMapInstances = new Map();

  // Rider Live GPS Coordinates (Default to Crispy Chicken Central Hub until phone GPS fix)
  const riderLiveLocation = {
    lat: RESTAURANT_COORDINATES.lat,
    lng: RESTAURANT_COORDINATES.lng,
    accuracy: null,
    hasGps: false,
    lastUpdated: null
  };

  // DOM Elements
  const riderDutyToggle = document.getElementById('rider-duty-toggle');
  const riderStatusPill = document.getElementById('rider-status-pill');
  const riderStatusText = document.getElementById('rider-status-text');
  const riderGpsPill = document.getElementById('rider-gps-pill');
  const gpsStatusText = document.getElementById('gps-status-text');
  const topCashAmount = document.getElementById('top-cash-amount');
  const btnRiderCashSummary = document.getElementById('btn-rider-cash-summary');

  const kpiActiveCount = document.getElementById('kpi-active-count');
  const kpiReadyCount = document.getElementById('kpi-ready-count');
  const kpiDeliveredCount = document.getElementById('kpi-delivered-count');
  const kpiCashTotal = document.getElementById('kpi-cash-total');

  const tabBadgeActive = document.getElementById('tab-badge-active');
  const tabBadgeReady = document.getElementById('tab-badge-ready');
  const tabBadgeDelivered = document.getElementById('tab-badge-delivered');
  const tabButtons = document.querySelectorAll('.rider-tab-btn');

  const riderOrdersList = document.getElementById('rider-orders-list');
  const btnManualRefresh = document.getElementById('btn-manual-refresh');
  const toastContainer = document.getElementById('rider-toast-container');

  // Confirmation Modal Elements
  const modalConfirmBackdrop = document.getElementById('modal-confirm-delivery-backdrop');
  const modalConfirmClose = document.getElementById('modal-confirm-close');
  const formConfirmDelivered = document.getElementById('form-confirm-delivered');
  const confirmOrderId = document.getElementById('confirm-order-id');
  const confirmOrderDetails = document.getElementById('confirm-order-details');
  const confirmCashValue = document.getElementById('confirm-cash-value');
  const checkCashReceived = document.getElementById('check-cash-received');
  const btnCancelDelivery = document.getElementById('btn-cancel-delivery');

  // Cash Summary Modal Elements
  const modalCashBackdrop = document.getElementById('modal-cash-summary-backdrop');
  const modalCashClose = document.getElementById('modal-cash-close');
  const modalCashLargeTotal = document.getElementById('modal-cash-large-total');
  const modalCashOrdersCount = document.getElementById('modal-cash-orders-count');
  const cashOrdersBreakdownList = document.getElementById('cash-orders-breakdown-list');
  const btnHandoverCash = document.getElementById('btn-handover-cash');

  // Customer Unreachable Modal Elements
  const modalUnreachableBackdrop = document.getElementById('modal-unreachable-backdrop');
  const modalUnreachableClose = document.getElementById('modal-unreachable-close');
  const btnCloseUnreachableModal = document.getElementById('btn-close-unreachable-modal');
  const unreachableOrderBadge = document.getElementById('unreachable-order-badge');
  const cnrClockDisplay = document.getElementById('cnr-clock-display');
  const cnrClockSub = document.getElementById('cnr-clock-sub');
  const cnrTimerStatusBadge = document.getElementById('cnr-timer-status-badge');
  const cnrProgressFill = document.getElementById('cnr-progress-fill');
  const cnrBtnCallCustomer = document.getElementById('cnr-btn-call-customer');
  const cnrCustomerPhoneDisplay = document.getElementById('cnr-customer-phone-display');
  const cnrBtnWhatsapp = document.getElementById('cnr-btn-whatsapp');
  const cnrBtnCallManager = document.getElementById('cnr-btn-call-manager');
  const cnrManagerPhoneDisplay = document.getElementById('cnr-manager-phone-display');
  const cnrBoxCod = document.getElementById('cnr-box-cod');
  const cnrCodAmount = document.getElementById('cnr-cod-amount');
  const cnrCodReason = document.getElementById('cnr-cod-reason');
  const btnCnrReturnCod = document.getElementById('btn-cnr-return-cod');
  const cnrBoxPrepaid = document.getElementById('cnr-box-prepaid');
  const cnrSafedropNote = document.getElementById('cnr-safedrop-note');
  const btnCnrSafedrop = document.getElementById('btn-cnr-safedrop');
  const cnrPrepaidReason = document.getElementById('cnr-prepaid-reason');
  const btnCnrReturnPrepaid = document.getElementById('btn-cnr-return-prepaid');

  // ========================================================
  // RIDER REAL-TIME GEOLOCATION WATCH
  // ========================================================
  function updateGpsStatusBadge(status, label) {
    if (!riderGpsPill || !gpsStatusText) return;
    riderGpsPill.className = `gps-status-pill ${status}`;
    gpsStatusText.textContent = label;
  }

  function handleGpsPosition(pos) {
    riderLiveLocation.lat = pos.coords.latitude;
    riderLiveLocation.lng = pos.coords.longitude;
    riderLiveLocation.accuracy = Math.round(pos.coords.accuracy || 10);
    riderLiveLocation.hasGps = true;
    riderLiveLocation.lastUpdated = Date.now();

    updateGpsStatusBadge('active', `Live GPS (±${riderLiveLocation.accuracy}m)`);
    updateLivePositionsOnMiniMaps();

    // Broadcast live rider location for customer map tracking sync
    try {
      const currentRider = dataService.getActiveRider() || { pin: '0000', name: 'Delivery Partner' };
      const activeOrders = dataService.getOrders().filter(o => 
        o.status === 'on_the_way' && (o.assignedRiderPin === currentRider.pin || !o.assignedRiderPin)
      );
      if (activeOrders.length === 0) return;
      const orderIds = activeOrders.map(o => o.id);
      const activeOrderId = activeOrders[0] ? activeOrders[0].id : null;
      dataService.broadcastRiderLocation({
        orderId: activeOrderId,
        orderIds: orderIds,
        riderPin: currentRider.pin,
        riderName: currentRider.name,
        lat: riderLiveLocation.lat,
        lng: riderLiveLocation.lng,
        heading: pos.coords.heading || null,
        speed: pos.coords.speed || null,
        accuracy: riderLiveLocation.accuracy,
        timestamp: Date.now()
      });
    } catch (e) {
      console.warn('[Rider GPS] Broadcast failed:', e);
    }
  }

  function initRiderLiveGeolocation() {
    if (!('geolocation' in navigator)) {
      updateGpsStatusBadge('fallback', 'Restaurant Base');
      return;
    }

    updateGpsStatusBadge('acquiring', 'Acquiring Live GPS...');

    // Attempt immediate current position
    navigator.geolocation.getCurrentPosition(
      (pos) => handleGpsPosition(pos),
      (err) => {
        console.warn('[Rider GPS] Initial fix standby:', err.message);
        if (!riderLiveLocation.hasGps) {
          updateGpsStatusBadge('fallback', 'Restaurant Base (GPS Standby)');
        }
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 }
    );

    // Watch position continuously as rider rides
    try {
      navigator.geolocation.watchPosition(
        (pos) => handleGpsPosition(pos),
        (err) => {
          console.warn('[Rider GPS] Watch update error:', err.message);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 4000 }
      );
    } catch {}
  }

  function updateLivePositionsOnMiniMaps() {
    const activeRows = document.querySelectorAll('.rider-order-row.row-active');
    activeRows.forEach(row => {
      try {
        const dropLat = parseFloat(row.getAttribute('data-droplat'));
        const dropLng = parseFloat(row.getAttribute('data-droplng'));
        const cleanId = row.getAttribute('data-cleanid');
        if (!isNaN(dropLat) && !isNaN(dropLng)) {
          const d = calculateDistanceKm(riderLiveLocation.lat, riderLiveLocation.lng, dropLat, dropLng);
          const distEl = document.getElementById(`dist-badge-${cleanId}`);
          if (distEl) {
            distEl.innerHTML = `<i class="fa-solid fa-route"></i> ${d} km`;
          }
          const navBtn = document.getElementById(`btn-nav-${cleanId}`);
          if (navBtn) {
            const hasCustomerCoords = row.getAttribute('data-hascustomercoords') !== 'false';
            const dropAddress = row.getAttribute('data-dropaddr') || 'Ramanagara, Karnataka';
            navBtn.href = hasCustomerCoords
              ? `https://www.google.com/maps/dir/?api=1&destination=${dropLat},${dropLng}&travelmode=driving&dir_action=navigate`
              : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dropAddress + ', Ramanagara, Karnataka')}&travelmode=driving&dir_action=navigate`;
          }
        }
      } catch (err) {
        console.warn('Error updating live GPS navigation URLs:', err);
      }
    });
  }

  // ========================================================
  // TOAST NOTIFICATION HELPER
  // ========================================================
  // TOAST NOTIFICATION ENGINE (Samsung One UI Top Floating Pill)
  // ========================================================
  function showToast(message, type = 'info') {
    return showSamsungToast(message, type, {
      container: toastContainer,
      appName: 'Delivery Fleet',
      duration: 3800
    });
  }
  window.showToast = showToast;

  // ========================================================
  // DUTY TOGGLE
  // ========================================================
  if (riderDutyToggle) {
    riderDutyToggle.addEventListener('change', (e) => {
      isDutyOn = e.target.checked;
      if (isDutyOn) {
        riderStatusPill.className = 'rider-badge-status online';
        riderStatusText.textContent = 'Online • Active';
        showToast('🟢 You are now Online and receiving delivery tasks!', 'success');
      } else {
        riderStatusPill.className = 'rider-badge-status offline';
        riderStatusText.textContent = 'Offline • On Break';
        showToast('⏸️ You are now Offline. No new tasks will be assigned.', 'info');
      }
    });
  }

  // ========================================================
  // PARSE NUMERIC CASH AMOUNT
  // ========================================================
  function extractCashAmount(totalStr) {
    if (typeof totalStr === 'number') return totalStr;
    if (!totalStr) return 0;
    const cleaned = String(totalStr).replace(/[^0-9.]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : Math.round(num);
  }

  // Determine if order is COD or Prepaid
  function isCashOnDelivery(order) {
    if (!order) return true;
    const method = (order.paymentMethod || order.payment_method || order.paymentStatus || '').toLowerCase();
    if (method.includes('online') || method.includes('card') || method.includes('upi') || method.includes('prepaid') || Boolean(order.isPaidOnline)) {
      return false;
    }
    return true; // Default to COD in QuickBite
  }

  // Calculate road network distance between two lat/lng points in KM (calibrated for street routing)
  function calculateDistanceKm(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 1.8;
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const straightKm = R * c;
    const roadKm = straightKm * 1.35;
    return parseFloat(roadKm.toFixed(1));
  }

  // Intelligent coordinate resolver: guarantees rider navigates to customer's exact pinned doorstep
  // Intelligent coordinate resolver: guarantees rider navigates to customer's exact pinned doorstep
  function getOrderDropCoordinates(order) {
    // 1. Direct addressDetails
    if (order && order.addressDetails && !isNaN(Number(order.addressDetails.lat)) && Number(order.addressDetails.lat) !== 0) {
      return {
        lat: Number(order.addressDetails.lat),
        lng: Number(order.addressDetails.lng),
        hasCustomerCoords: true,
        source: 'addressDetails'
      };
    }

    // 2. Direct top-level lat / lng
    if (order && !isNaN(Number(order.lat)) && Number(order.lat) !== 0 && !isNaN(Number(order.lng)) && Number(order.lng) !== 0) {
      return {
        lat: Number(order.lat),
        lng: Number(order.lng),
        hasCustomerCoords: true,
        source: 'order'
      };
    }

    // 3. Match from user's saved addresses in dataService
    try {
      const rawAddrs = dataService.getAllAddressesRaw();
      if (Array.isArray(rawAddrs) && rawAddrs.length > 0) {
        const matched = rawAddrs.find(a => 
          (order.deliveryAddress && a.flatNo && order.deliveryAddress.includes(a.flatNo)) ||
          (order.deliveryAddress && a.area && order.deliveryAddress.includes(a.area)) ||
          (order.customerPhone && a.phone && a.phone.replace(/\D/g, '') === (order.customerPhone || '').replace(/\D/g, '')) ||
          (order.userId && a.userId === order.userId)
        ) || rawAddrs.find(a => a.isDefault);

        if (matched && matched.lat && matched.lng && !isNaN(Number(matched.lat))) {
          if (!order.addressDetails) order.addressDetails = {};
          order.addressDetails.lat = Number(matched.lat);
          order.addressDetails.lng = Number(matched.lng);
          order.lat = Number(matched.lat);
          order.lng = Number(matched.lng);
          return {
            lat: Number(matched.lat),
            lng: Number(matched.lng),
            hasCustomerCoords: true,
            source: 'user_addresses'
          };
        }
      }
    } catch {}

    // 4. Fallback: restaurant central coordinates
    return {
      lat: RESTAURANT_COORDINATES.lat,
      lng: RESTAURANT_COORDINATES.lng,
      hasCustomerCoords: false,
      source: 'restaurant'
    };
  }

  // ========================================================
  // RENDER ORDERS & KPIS
  // ========================================================
  function renderPortal() {
    // Clean up previous Leaflet map instances to avoid leaks
    miniMapInstances.forEach(map => {
      try {
        map.remove();
      } catch {}
    });
    miniMapInstances.clear();

    const orders = dataService.getOrders();
    const currentRider = dataService.getActiveRider() || { pin: '0000', name: 'Delivery Partner', vehicle: '🏍️ Bike' };

    // 1. Calculate Metrics (Segregated per Delivery Partner)
    // ready: Cooking / preparing orders in kitchen queue (pending, accepted, cooking) available for pickup
    // active: Out for delivery tasks ONLY assigned to this specific rider
    // delivered: Delivered orders completed by this specific rider
    const readyOrders = orders.filter(o => 
      (o.status === 'ready_for_pickup' || o.status === 'cooking' || o.status === 'accepted' || o.status === 'pending') &&
      (!o.assignedRiderPin || o.assignedRiderPin === currentRider.pin)
    );
    const activeOrders = orders.filter(o => {
      if (o.status !== 'on_the_way') return false;
      return o.assignedRiderPin === currentRider.pin;
    });
    const deliveredOrders = orders.filter(o => {
      if (o.status !== 'delivered' && o.status !== 'undelivered') return false;
      return o.assignedRiderPin === currentRider.pin;
    });

    // Get rider-specific segregated COD cash in hand
    const cashSummary = dataService.getRiderCashSummary(currentRider.pin);
    const totalCashCollected = cashSummary.cashInHand;

    // Update KPI Displays (Kitchen Queue 1st, Active Deliveries 2nd, Delivered 3rd)
    if (kpiReadyCount) kpiReadyCount.textContent = readyOrders.length;
    if (kpiActiveCount) kpiActiveCount.textContent = activeOrders.length;
    if (kpiDeliveredCount) kpiDeliveredCount.textContent = deliveredOrders.length;
    if (kpiCashTotal) kpiCashTotal.textContent = `₹${totalCashCollected.toLocaleString('en-IN')}`;
    if (topCashAmount) topCashAmount.textContent = `₹${totalCashCollected.toLocaleString('en-IN')}`;

    // Update In-Page Navigation Bar Tab Badges (Kitchen Queue 1st, Active 2nd, Delivered 3rd)
    if (tabBadgeReady) tabBadgeReady.textContent = readyOrders.length;
    if (tabBadgeActive) tabBadgeActive.textContent = activeOrders.length;
    if (tabBadgeDelivered) tabBadgeDelivered.textContent = deliveredOrders.length;

    // Update Floating Capsule Navigation Bar Badges (Matching Main & Admin)
    const capsuleReadyBadge = document.getElementById('capsule-ready-badge');
    const capsuleActiveBadge = document.getElementById('capsule-active-badge');
    const capsuleDeliveredBadge = document.getElementById('capsule-delivered-badge');
    if (capsuleReadyBadge) capsuleReadyBadge.textContent = readyOrders.length;
    if (capsuleActiveBadge) capsuleActiveBadge.textContent = activeOrders.length;
    if (capsuleDeliveredBadge) capsuleDeliveredBadge.textContent = deliveredOrders.length;

    // Update native PWA icon badge counter for rider
    updateAppBadge(readyOrders.length + activeOrders.length);

    // Smart auto-tab switch:
    // When rider has active orders on the road, ensure they stay on Active tab unless explicitly on Ready tab
    const persistedTab = getPersistedRiderTab();
    if (!persistedTab && activeOrders.length > 0 && activeTab === 'ready') {
      activeTab = 'active';
      persistRiderTab('active');
      updateActiveTabUI();
    } else if (activeTab === 'ready' && readyOrders.length === 0 && activeOrders.length > 0) {
      activeTab = 'active';
      persistRiderTab('active');
      updateActiveTabUI();
    }

    // 2. Filter orders by current active tab - 100% STRICT CATEGORY SEPARATION
    if (activeTab === 'ready') {
      // Kitchen Queue: ONLY show how many orders are pending, NEVER reveal the 4-digit codes to rider!
      // The rider must physically collect the food bag from the restaurant counter and enter the code written on it.
      const existingCard = riderOrdersList.querySelector('.kitchen-pending-card');
      const existingInput = document.getElementById('input-bag-code');
      const hasActiveCard = existingCard && !existingCard.classList.contains('empty') && readyOrders.length > 0;
      const hasEmptyCard = existingCard && existingCard.classList.contains('empty') && readyOrders.length === 0;

      // In-place non-destructive update: NEVER destroy the input box while rider is typing!
      if (hasActiveCard) {
        const countNum = existingCard.querySelector('.pending-count-num');
        const headline = existingCard.querySelector('.pending-headline');
        if (countNum) countNum.textContent = readyOrders.length;
        if (headline) headline.textContent = `${readyOrders.length} Order${readyOrders.length === 1 ? '' : 's'} Pending in Kitchen`;
        if (existingInput && !existingInput.value) {
          existingInput.placeholder = '••••';
        }
        attachBagInputListeners();
        return;
      }

      if (hasEmptyCard) {
        return; // Empty card is already present and matching
      }

      // Preserve any previously typed bag code if re-rendering from another tab or state transition
      const preservedCode = existingInput ? existingInput.value : '';

      if (readyOrders.length === 0) {
        riderOrdersList.innerHTML = `
          <div class="kitchen-pending-card empty">
            <div class="pending-count-badge zero">
              <i class="fa-solid fa-circle-check"></i>
            </div>
            <div class="pending-text-wrap">
              <div class="pending-pill-tag"><i class="fa-solid fa-kitchen-set"></i> Kitchen Counter</div>
              <h3 class="pending-headline">0 Orders Pending in Kitchen</h3>
              
              <!-- 4-Digit Code Entry Inside Card -->
              <form class="bag-pickup-form inside-card" id="bag-pickup-form" autocomplete="off" onsubmit="event.preventDefault(); return false;">
                <div class="bag-input-wrap">
                  <span class="bag-input-prefix">#</span>
                  <input type="text" id="input-bag-code" class="bag-code-input" maxlength="4" pattern="[0-9]*" placeholder="••••" value="${escapeHtml(preservedCode)}" inputmode="numeric" />
                </div>
                <button type="button" class="btn-claim-bag" id="btn-claim-bag">
                  <i class="fa-solid fa-bolt"></i> <span>Start Delivery</span>
                </button>
              </form>
            </div>
          </div>
        `;
      } else {
        riderOrdersList.innerHTML = `
          <div class="kitchen-pending-card">
            <div class="pending-count-badge">
              <div class="pending-flame-icon"><i class="fa-solid fa-fire-burner"></i></div>
              <span class="pending-count-num">${readyOrders.length}</span>
            </div>
            <div class="pending-text-wrap">
              <div class="pending-pill-tag"><i class="fa-solid fa-kitchen-set"></i> Kitchen Counter Status</div>
              <h3 class="pending-headline">${readyOrders.length} Order${readyOrders.length === 1 ? '' : 's'} Pending in Kitchen</h3>

              <!-- 4-Digit Code Entry Inside Card -->
              <form class="bag-pickup-form inside-card" id="bag-pickup-form" autocomplete="off" onsubmit="event.preventDefault(); return false;">
                <div class="bag-input-wrap">
                  <span class="bag-input-prefix">#</span>
                  <input type="text" id="input-bag-code" class="bag-code-input" maxlength="4" pattern="[0-9]*" placeholder="••••" value="${escapeHtml(preservedCode)}" inputmode="numeric" autofocus />
                </div>
                <button type="button" class="btn-claim-bag" id="btn-claim-bag">
                  <i class="fa-solid fa-bolt"></i> <span>Start Delivery</span>
                </button>
              </form>
            </div>
          </div>
        `;
      }
      attachBagInputListeners();
      return;
    }

    let displayList = [];
    if (activeTab === 'active') {
      // Active Tasks: ONLY orders out on the road for delivery (zero kitchen orders)
      displayList = activeOrders;
    } else if (activeTab === 'delivered') {
      // Delivered Today: ONLY completed deliveries
      displayList = deliveredOrders;
    }

    if (!displayList || displayList.length === 0) {
      let emptyIcon = '🛵';
      let emptyMsg = 'No active delivery tasks out on the road right now.';
      let emptySub = 'Orders you claim with a 4-digit bag code will appear here with live turn-by-turn GPS navigation and customer call buttons.';
      if (activeTab === 'delivered') {
        emptyIcon = '✅';
        emptyMsg = 'No completed deliveries recorded yet for today.';
        emptySub = 'Delivered orders and collected cash receipts will be logged here for shift settlement.';
      }

      riderOrdersList.innerHTML = `
        <div class="rider-empty-state">
          <div class="rider-empty-icon">${emptyIcon}</div>
          <h3>${emptyMsg}</h3>
          <p>${emptySub}</p>
        </div>
      `;
      return;
    }

    // 3. Render Streamlined Order Rows
    riderOrdersList.innerHTML = displayList.map((order, orderIdx) => {
      const isCod = isCashOnDelivery(order);
      const cashAmount = extractCashAmount(order.total);
      const cleanId = escapeHtml(order.id.replace('#', ''));
      const safeId = escapeHtml(order.id);
      const safeCustomerName = escapeHtml(order.customerName || 'Online Guest');

      // Customer exact pinned drop location coordinates
      const dropCoords = getOrderDropCoordinates(order);
      const dropLat = dropCoords.lat;
      const dropLng = dropCoords.lng;
      // Real-time distance calculated from rider's current live device coordinates
      const distance = calculateDistanceKm(riderLiveLocation.lat, riderLiveLocation.lng, dropLat, dropLng);

      // Retrieve customer real phone with multi-tier extraction
      const rawAddrs = dataService.getAllAddressesRaw();
      const rawPhone = extractPhoneFromOrder(order, rawAddrs) || order.customerPhone || order.customer_phone || order.phone || '';
      const cleanPhoneDigits = rawPhone.replace(/\D/g, '');
      const hasRealPhone = cleanPhoneDigits.length >= 10;

      // Clean phone formatted for dialer (+91 format if 10 digits)
      const dialerPhone = hasRealPhone 
        ? (cleanPhoneDigits.length === 10 ? `+91${cleanPhoneDigits}` : `+${cleanPhoneDigits}`)
        : '';
      const displayPhone = hasRealPhone
        ? (cleanPhoneDigits.length === 10 ? `+91 ${cleanPhoneDigits.slice(0, 5)} ${cleanPhoneDigits.slice(5)}` : rawPhone)
        : 'No phone number';

      const rawDropAddress = order.deliveryAddress || `${order.addressDetails?.flatNo || 'House'}, ${order.addressDetails?.area || 'Ramanagara'}`;
      const safeDropAddress = escapeHtml(cleanDeliveryAddress(rawDropAddress));

      // Direct Turn-by-Turn GPS Driving Navigation to Customer Location
      const googleMapsNavUrl = dropCoords.hasCustomerCoords
        ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dropLat)},${encodeURIComponent(dropLng)}&travelmode=driving&dir_action=navigate`
        : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(cleanDeliveryAddress(rawDropAddress) + ', Ramanagara, Karnataka')}&travelmode=driving&dir_action=navigate`;

      const bagCode = order.pickupCode || (order.id ? String(order.id).replace(/\D/g, '').slice(-4) : '0000');
      const currentRider = dataService.getActiveRider() || { pin: '0000', name: 'Delivery Partner', vehicle: '🏍️ Bike' };

      const whatsappText = `Hello ${order.customerName || 'Customer'}, I am your Savera Paradise delivery partner ${currentRider.name} on my way with your order ${order.id}.`;
      const waDigits = hasRealPhone ? cleanPhoneDigits.slice(-10) : '';
      const whatsappUrl = waDigits
        ? `https://wa.me/91${waDigits}?text=${encodeURIComponent(whatsappText)}`
        : '#';

      const timeStr = order.createdAt ? new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recent';

      // ==========================================
      // TAB 2: ACTIVE TASKS ('active')
      // Requirement: "navigation button call button and whatsapp button and price to collect and able to mark dilivered"
      // ==========================================
      if (activeTab === 'active') {
        const parcelBadge = displayList.length > 1
          ? `<span class="parcel-step-pill"><i class="fa-solid fa-box"></i> Parcel ${orderIdx + 1} of ${displayList.length}</span>`
          : '';

        const cnrKey = `quickbite_cnr_start_${cleanId}`;
        const cnrStartTime = localStorage.getItem(cnrKey);
        let isWaiting = false;
        let formattedTimer = '10:00';
        if (cnrStartTime) {
          isWaiting = true;
          const elapsedSecs = Math.floor((Date.now() - Number(cnrStartTime)) / 1000);
          const remSecs = Math.max(0, 600 - elapsedSecs);
          const m = Math.floor(remSecs / 60);
          const s = remSecs % 60;
          formattedTimer = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }

        return `
          <article class="rider-order-row row-active" data-order-id="${safeId}" data-droplat="${dropLat}" data-droplng="${dropLng}" data-hascustomercoords="${dropCoords.hasCustomerCoords}" data-dropaddr="${safeDropAddress}" data-cleanid="${cleanId}">
            <!-- Top Bar: Order ID, Live Distance & Cash to Collect -->
            <div class="row-top-bar">
              <div class="row-id-meta-group">
                <span class="row-order-id active">${safeId}</span>
                ${parcelBadge}
                <span class="row-bag-badge"><i class="fa-solid fa-box"></i> Bag <strong>#${bagCode}</strong></span>
                <span class="row-live-dist" id="dist-badge-${cleanId}">
                  <i class="fa-solid fa-route"></i> ${distance} km
                </span>
              </div>

              <!-- Price to Collect Badge -->
              <div class="row-price-badge ${isCod ? 'cod' : 'prepaid'}">
                <span class="price-badge-label">${isCod ? 'Cash to Collect' : 'Paid Online'}</span>
                <strong class="price-badge-val">${isCod ? `₹${cashAmount}` : '₹0'}</strong>
              </div>
            </div>

            <!-- Customer & Destination (Full Width on Mobile - Never Truncated) -->
            <div class="row-customer-info">
              <div class="row-customer-name-bar">
                <h4 class="row-customer-name">${safeCustomerName}</h4>
                <a href="${hasRealPhone ? `tel:${dialerPhone}` : '#'}" class="row-customer-phone-pill ${hasRealPhone ? 'active' : 'missing'}" title="${hasRealPhone ? `Call Customer: ${displayPhone}` : 'Customer phone not provided'}">
                  <i class="fa-solid fa-phone"></i>
                  <span>${escapeHtml(displayPhone)}</span>
                </a>
              </div>
              <a href="${googleMapsNavUrl}" target="_blank" rel="noopener noreferrer" class="row-addr-text" title="Open Customer Delivery Location in Google Maps" style="text-decoration: none; color: inherit; display: flex; align-items: flex-start; gap: 8px;">
                <i class="fa-solid fa-location-dot" style="color: var(--brand-primary, #FF5A26); margin-top: 3px;"></i>
                <span>${safeDropAddress}</span>
              </a>
            </div>

            <!-- Action Buttons Group -->
            <div class="row-actions-group">
              <div class="row-actions-comms">
                <!-- 1. Navigation Button (Symbol Only) -->
                <a href="${googleMapsNavUrl}" id="btn-nav-${cleanId}" target="_blank" rel="noopener noreferrer" class="btn-action-pill btn-action-icon btn-action-nav" title="Start Turn-by-Turn GPS Driving Navigation" aria-label="Start Navigation">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="#FFFFFF" aria-hidden="true" style="display: block;">
                    <path d="M21.71 11.29l-9-9a1 1 0 0 0-1.42 0l-9 9a1 1 0 0 0 0 1.42l9 9a1 1 0 0 0 1.42 0l9-9a1 1 0 0 0 0-1.42zM14 14.5V12h-4v3H8v-4a1 1 0 0 1 1-1h5V7.5l3.5 3.5-3.5 3.5z"/>
                  </svg>
                </a>

                <!-- 2. Call Button (Symbol Only) -->
                <a href="${hasRealPhone ? `tel:${dialerPhone}` : '#'}" class="btn-action-pill btn-action-icon btn-action-call ${!hasRealPhone ? 'disabled' : ''}" title="${hasRealPhone ? `Call Customer: ${displayPhone}` : 'Customer phone not provided'}" aria-label="Call Customer">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="#FFFFFF" aria-hidden="true" style="display: block;">
                    <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-2.2 2.2a15.053 15.053 0 0 1-6.59-6.59l2.2-2.21a.96.96 0 0 0 .25-1.01A11.36 11.36 0 0 1 8.5 3.92c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1 0 9.39 7.61 17 17 17 .55 0 1-.45 1-1v-3.54c0-.55-.45-1-.99-1z"/>
                  </svg>
                </a>

                <!-- 3. WhatsApp Button (Symbol Only) -->
                <a href="${whatsappUrl}" ${hasRealPhone ? 'target="_blank" rel="noopener noreferrer"' : ''} class="btn-action-pill btn-action-icon btn-action-wa ${!hasRealPhone ? 'disabled' : ''}" title="${hasRealPhone ? `WhatsApp Customer: ${displayPhone}` : 'Customer phone not provided'}" aria-label="WhatsApp Customer">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="#FFFFFF" aria-hidden="true" style="display: block;">
                    <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2m.01 1.67c2.2 0 4.26.86 5.82 2.41a8.19 8.19 0 0 1 2.41 5.83c0 4.54-3.7 8.24-8.24 8.24-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24m4.52 11.66c-.25-.13-1.47-.72-1.7-.81-.23-.08-.39-.13-.56.13-.17.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.13-1.06-.39-2.02-1.25-.75-.67-1.26-1.5-1.41-1.75-.15-.25-.02-.39.11-.51.11-.11.25-.29.37-.44.13-.14.17-.25.25-.42.08-.17.04-.31-.02-.44-.06-.13-.56-1.34-.76-1.84-.2-.49-.4-.42-.56-.43h-.47c-.17 0-.44.06-.67.31-.23.25-.88.86-.88 2.1 0 1.24.9 2.44 1.03 2.61.13.17 1.77 2.7 4.29 3.79.6.26 1.07.41 1.43.53.6.19 1.15.16 1.58.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.15-1.18-.07-.12-.23-.19-.48-.31z"/>
                  </svg>
                </a>
              </div>

              <div class="row-actions-resolution">
                <!-- 4. Unreachable Button -->
                <button type="button" class="btn-action-pill btn-action-unreachable ${isWaiting ? 'is-waiting' : ''}" data-action="open-unreachable-modal" data-id="${safeId}" title="Customer Not Answering / Unreachable at Doorstep" aria-label="Customer Unreachable">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true" style="margin-right: 4px; flex-shrink: 0;">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                  </svg>
                  <span>${isWaiting ? `⏱️ ${formattedTimer}` : 'Unreachable'}</span>
                </button>

                <!-- 5. Mark Delivered Button -->
                <button type="button" class="btn-action-pill btn-action-deliver" data-action="open-delivered-modal" data-id="${safeId}" title="Mark Delivered & Collect Cash">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="#FFFFFF" aria-hidden="true" style="margin-right: 6px; flex-shrink: 0;">
                    <path d="m18 7-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41 6 19l1.41-1.41L1.83 12 .41 13.41z"/>
                  </svg>
                  <span>Delivered</span>
                </button>
              </div>
            </div>

            ${isWaiting ? `
              <div class="cnr-waiting-indicator" data-action="open-unreachable-modal" data-id="${safeId}" title="Tap to view waiting countdown and resolution options">
                <span class="cnr-indicator-pulse"></span>
                <span class="cnr-indicator-text"><i class="fa-solid fa-hourglass-half fa-spin"></i> Rider waiting at doorstep: <strong>${formattedTimer} remaining</strong></span>
                <span class="cnr-indicator-tap">View Modal &gt;</span>
              </div>
            ` : ''}
          </article>
        `;
      }

      // ==========================================
      // TAB 3: DELIVERED TODAY ('delivered')
      // ==========================================
      const isUndelivered = order.status === 'undelivered';

      return `
        <article class="rider-order-row row-delivered ${isUndelivered ? 'row-undelivered' : ''}" data-order-id="${safeId}">
          <div class="row-top-bar">
            <div class="row-id-meta-group">
              <span class="row-order-id ${isUndelivered ? 'undelivered' : 'delivered'}">${safeId}</span>
              ${isUndelivered ? `
                <span class="row-returned-badge"><i class="fa-solid fa-box-archive"></i> Returned to Kitchen</span>
              ` : (order.safeDrop ? `
                <span class="row-returned-badge" style="background:#ECFDF5; color:#065F46; border-color:#A7F3D0;"><i class="fa-solid fa-door-open"></i> Safe Drop</span>
              ` : '')}
              <span class="row-delivered-time"><i class="fa-regular fa-clock"></i> ${timeStr}</span>
            </div>

            <div class="row-price-badge ${isUndelivered ? 'cod' : (isCod ? 'cod' : 'prepaid')}">
              <span class="price-badge-label">${isUndelivered ? 'Cash Collected' : (isCod ? 'Cash Collected' : 'Paid Online')}</span>
              <strong class="price-badge-val">${isUndelivered ? '₹0' : (isCod ? `₹${cashAmount}` : '₹0')}</strong>
            </div>
          </div>

          <div class="row-customer-info">
            <h4 class="row-customer-name">${safeCustomerName}</h4>
            <div class="row-addr-text">
              <i class="fa-solid fa-location-dot"></i>
              <span>${safeDropAddress}</span>
            </div>
            ${isUndelivered ? `
              <div style="font-size: 0.8rem; color: #DC2626; margin-top: 6px; font-weight: 600;">
                <i class="fa-solid fa-triangle-exclamation"></i> Customer Unreachable: ${escapeHtml(order.undeliveredReason || order.cancellationReason || 'Returned to kitchen')}
              </div>
            ` : (order.safeDropNote ? `
              <div style="font-size: 0.8rem; color: #047857; margin-top: 6px; font-weight: 600;">
                <i class="fa-solid fa-circle-info"></i> Safe Drop Note: ${escapeHtml(order.safeDropNote)}
              </div>
            ` : '')}
          </div>

          <div class="row-delivered-action">
            <span class="badge-delivered-done" style="${isUndelivered ? 'background:#FEE2E2; color:#B91C1C; border-color:#FECACA;' : ''}">
              <i class="fa-solid ${isUndelivered ? 'fa-box-archive' : 'fa-circle-check'}"></i> ${isUndelivered ? 'Returned to Kitchen Counter' : 'Delivered & Settled'}
            </span>
          </div>
        </article>
      `;
    }).join('');

    // Attach Pickup Button Listeners
    riderOrdersList.querySelectorAll('[data-action="start-delivery"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        handleStartDelivery(id);
      });
    });

    // Attach Mark Delivered Button Listeners (Opens exact same confirmation modal in front)
    riderOrdersList.querySelectorAll('[data-action="open-delivered-modal"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        openDeliveryConfirmModal(id);
      });
    });

    // Attach Customer Unreachable Button & Waiting Indicator Listeners
    riderOrdersList.querySelectorAll('[data-action="open-unreachable-modal"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        openUnreachableModal(id);
      });
    });

    // Attach Bag Claim Input Listeners on current tab (Pending & Active)
    attachBagInputListeners();

    // Ensure live ticker runs for any active doorstep waiting cards even when modal is closed
    if (riderOrdersList.querySelectorAll('.btn-action-unreachable.is-waiting').length > 0) {
      if (!cardCountdownInterval) {
        cardCountdownInterval = setInterval(updateCardWaitingCountdowns, 1000);
      }
    } else if (cardCountdownInterval) {
      clearInterval(cardCountdownInterval);
      cardCountdownInterval = null;
    }
  }

  let cardCountdownInterval = null;

  function updateCardWaitingCountdowns() {
    const waitingButtons = document.querySelectorAll('.btn-action-unreachable.is-waiting');
    if (waitingButtons.length === 0) {
      if (cardCountdownInterval) {
        clearInterval(cardCountdownInterval);
        cardCountdownInterval = null;
      }
      return;
    }

    waitingButtons.forEach(btn => {
      const orderId = btn.getAttribute('data-id');
      if (!orderId) return;
      const cleanId = String(orderId).trim().replace(/^#/, '');
      const cnrKey = `quickbite_cnr_start_${cleanId}`;
      const cnrStartTime = localStorage.getItem(cnrKey);
      if (!cnrStartTime) return;

      const elapsedSecs = Math.floor((Date.now() - Number(cnrStartTime)) / 1000);
      const remSecs = Math.max(0, 600 - elapsedSecs);
      const m = Math.floor(remSecs / 60);
      const s = remSecs % 60;
      const formatted = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

      const textSpan = btn.querySelector('span');
      if (textSpan) textSpan.textContent = `⏱️ ${formatted}`;

      const parentArticle = btn.closest('article');
      if (parentArticle) {
        const strongEl = parentArticle.querySelector('.cnr-waiting-indicator strong');
        if (strongEl) strongEl.textContent = `${formatted} remaining`;
      }
    });
  }

  // ========================================================
  // STATUS TRANSITION ACTIONS
  // ========================================================

  // Rider picks up food & starts delivery
  function handleStartDelivery(orderId) {
    const currentRider = dataService.getActiveRider() || { pin: '0000', name: 'Delivery Partner' };
    const allOrders = dataService.getOrders();
    const order = allOrders.find(o => o.id === orderId);
    const code = order ? (order.pickupCode || String(order.id).replace(/\D/g, '').slice(-4)) : String(orderId).replace(/\D/g, '').slice(-4);

    const result = dataService.claimOrderByBagCode(code, currentRider.pin);
    if (result.success) {
      showToast(`🛵 Order ${orderId} (Bag #${code}) claimed! Customer and kitchen have been notified. Drive safe!`, 'success');
      activeTab = 'active';
      updateActiveTabUI();
      renderPortal();

      // Immediately broadcast initial location on dispatch
      try {
        dataService.broadcastRiderLocation({
          orderId: orderId,
          riderPin: currentRider.pin,
          riderName: currentRider.name,
          lat: riderLiveLocation.lat,
          lng: riderLiveLocation.lng,
          accuracy: riderLiveLocation.accuracy,
          timestamp: Date.now()
        });
      } catch {}
    } else {
      showToast(`❌ ${result.message || 'Cannot claim this order.'}`, 'error');
    }
  }

  // Open confirmation modal for delivery & cash collection
  function openDeliveryConfirmModal(orderId) {
    const orders = dataService.getOrders();
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    activeConfirmOrder = order;
    confirmOrderId.value = order.id;

    const isCod = isCashOnDelivery(order);
    const cash = extractCashAmount(order.total);

    const rawAddrs = dataService.getAllAddressesRaw();
    const rawPhone = extractPhoneFromOrder(order, rawAddrs) || order.customerPhone || '';
    const cleanDigits = rawPhone.replace(/\D/g, '');
    const displayPhone = cleanDigits.length >= 10
      ? (cleanDigits.length === 10 ? `+91 ${cleanDigits.slice(0, 5)} ${cleanDigits.slice(5)}` : rawPhone)
      : 'Phone not provided';

    confirmOrderDetails.innerHTML = `
      <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
        <strong>Order ID:</strong> <span>${escapeHtml(order.id)}</span>
      </div>
      <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
        <strong>Customer:</strong> <span>${escapeHtml(order.customerName || 'Customer')}</span>
      </div>
      <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
        <strong>Phone Number:</strong> <span style="color:#059669; font-weight:700;">📞 ${escapeHtml(displayPhone)}</span>
      </div>
      <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
        <strong>Address:</strong> <span style="text-align:right; max-width:60%;">${escapeHtml(cleanDeliveryAddress(order.deliveryAddress || 'Doorstep'))}</span>
      </div>
      <div style="display:flex; justify-content:space-between;">
        <strong>Payment Mode:</strong> <span>${isCod ? 'Cash on Delivery (COD)' : 'Prepaid Online'}</span>
      </div>
    `;

    if (isCod) {
      confirmCashValue.textContent = `₹${cash}`;
      checkCashReceived.checked = false;
      checkCashReceived.required = true;
      document.querySelector('.custom-checkbox-row').style.display = 'flex';
    } else {
      confirmCashValue.textContent = '₹0 (Paid Online)';
      checkCashReceived.checked = true;
      checkCashReceived.required = false;
      document.querySelector('.custom-checkbox-row').style.display = 'none';
    }

    modalConfirmBackdrop.classList.add('open');
    backNav.pushStep('modal-delivery-confirm', () => {
      modalConfirmBackdrop.classList.remove('open');
      activeConfirmOrder = null;
    });
  }

  function closeConfirmModal() {
    modalConfirmBackdrop.classList.remove('open');
    activeConfirmOrder = null;
    backNav.removeStep('modal-delivery-confirm');
  }

  if (modalConfirmClose) modalConfirmClose.addEventListener('click', closeConfirmModal);
  if (btnCancelDelivery) btnCancelDelivery.addEventListener('click', closeConfirmModal);
  if (modalConfirmBackdrop) {
    modalConfirmBackdrop.addEventListener('click', (e) => {
      if (e.target === modalConfirmBackdrop) closeConfirmModal();
    });
  }

  // Handle Delivery Form Submission
  if (formConfirmDelivered) {
    formConfirmDelivered.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!activeConfirmOrder) return;

      const orderId = activeConfirmOrder.id;
      const isCod = isCashOnDelivery(activeConfirmOrder);
      const cash = extractCashAmount(activeConfirmOrder.total);

      const currentRider = dataService.getActiveRider() || { pin: '0000', name: 'Delivery Partner' };
      activeConfirmOrder.assignedRiderPin = activeConfirmOrder.assignedRiderPin || currentRider.pin;
      activeConfirmOrder.assignedRiderName = activeConfirmOrder.assignedRiderName || currentRider.name;
      activeConfirmOrder.deliveredAt = Date.now();

      // Update in dataService with rider authorization
      dataService.updateOrderStatus(orderId, 'delivered', 'rider', {
        assignedRiderPin: activeConfirmOrder.assignedRiderPin,
        assignedRiderName: activeConfirmOrder.assignedRiderName,
        deliveredAt: activeConfirmOrder.deliveredAt,
        cashCollected: isCod ? Number(cash) : 0
      });

      // Trigger Confetti Celebration!
      try {
        confetti({
          particleCount: 90,
          spread: 70,
          origin: { y: 0.6 }
        });
      } catch {}

      // Check remaining active parcels on this delivery run
      const remainingParcels = dataService.getOrders().filter(o => 
        o.status === 'on_the_way' && 
        (o.assignedRiderPin === currentRider.pin || !o.assignedRiderPin) &&
        o.id !== orderId
      );

      closeConfirmModal();

      if (remainingParcels.length > 0) {
        activeTab = 'active';
        showToast(`🎉 Parcel ${orderId} delivered! ${remainingParcels.length} parcel${remainingParcels.length > 1 ? 's' : ''} remaining on this trip.`, 'success');
      } else {
        activeTab = 'delivered';
        showToast(`🎉 All parcels delivered! Shift earnings updated: ${isCod ? `₹${cash} added to Cash in Hand.` : ''}`, 'success');
      }

      updateActiveTabUI();
      renderPortal();

      // Broadcast update
      try {
        localStorage.setItem('quickbite_order_status_sync', JSON.stringify({
          orderId,
          status: 'delivered',
          statusLabel: 'Delivered',
          stepIndex: 4,
          eta: 'Delivered 🎉',
          timestamp: Date.now()
        }));
      } catch {}
    });
  }

  // ========================================================
  // CUSTOMER UNREACHABLE AT DOORSTEP (CNR) MODAL CONTROLLER
  // ========================================================
  let activeCnrOrder = null;
  let cnrTimerInterval = null;

  function openUnreachableModal(orderId) {
    const list = dataService.getOrders();
    const cleanId = String(orderId || '').trim().replace(/^#/, '');
    const order = list.find(o => o && String(o.id || '').trim().replace(/^#/, '') === cleanId);
    if (!order) return;

    activeCnrOrder = order;

    const currentRider = dataService.getActiveRider() || { pin: '0000', name: 'Delivery Partner' };
    const safeId = order.id.startsWith('#') ? order.id : `#${order.id}`;

    // Persistent 10-Minute Waiting Countdown Timer
    const timerStorageKey = `quickbite_cnr_start_${cleanId}`;
    let startTime = localStorage.getItem(timerStorageKey);
    if (!startTime) {
      startTime = Date.now();
      localStorage.setItem(timerStorageKey, startTime);
      // Notify kitchen admin and customer live tracking
      dataService.riderWaitingAtDoorstep(order.id, {
        riderPin: currentRider.pin,
        waitingStartedAt: startTime
      });
      showToast(`⏱️ 10-Minute doorstep waiting timer started for ${safeId}.`, 'info');
    }

    if (unreachableOrderBadge) unreachableOrderBadge.textContent = `ORDER ${safeId}`;

    // Extract customer phone
    const rawAddrs = dataService.getAllAddressesRaw();
    const rawCustomerPhone = extractPhoneFromOrder(order, rawAddrs) || order.customerPhone || '';
    const cleanPhoneDigits = String(rawCustomerPhone || '').replace(/\D/g, '');
    const hasRealPhone = Boolean(cleanPhoneDigits.length >= 8);
    const dialerPhone = cleanPhoneDigits.length === 10 ? `+91${cleanPhoneDigits}` : (cleanPhoneDigits ? `+${cleanPhoneDigits}` : '');
    const displayPhone = cleanPhoneDigits.length >= 10
      ? (cleanPhoneDigits.length === 10 ? `+91 ${cleanPhoneDigits.slice(0, 5)} ${cleanPhoneDigits.slice(5)}` : rawCustomerPhone)
      : 'Phone not provided';

    if (cnrCustomerPhoneDisplay) cnrCustomerPhoneDisplay.textContent = displayPhone;
    if (cnrBtnCallCustomer) {
      cnrBtnCallCustomer.href = hasRealPhone ? `tel:${dialerPhone}` : '#';
      cnrBtnCallCustomer.classList.toggle('disabled', !hasRealPhone);
    }

    // Urgent Doorstep WhatsApp
    if (cnrBtnWhatsapp) {
      const urgentWaMsg = `Hello ${order.customerName || 'Customer'}, this is your Savera Paradise delivery partner. I have reached your doorstep with Order ${safeId}. I tried calling you on ${displayPhone} but could not reach you. Please open the door or call me back immediately. Thank you!`;
      const waDigits = cleanPhoneDigits.length === 10 ? `91${cleanPhoneDigits}` : cleanPhoneDigits;
      cnrBtnWhatsapp.href = hasRealPhone ? `https://wa.me/${waDigits}?text=${encodeURIComponent(urgentWaMsg)}` : '#';
      cnrBtnWhatsapp.classList.toggle('disabled', !hasRealPhone);
    }

    // Kitchen Manager Direct Phone
    const settings = dataService.getSettings();
    const managerPhone = settings?.restaurantPhone || settings?.helpline || '+91 98450 12345';
    if (cnrManagerPhoneDisplay) cnrManagerPhoneDisplay.textContent = managerPhone;
    if (cnrBtnCallManager) {
      cnrBtnCallManager.href = `tel:${managerPhone.replace(/\D/g, '')}`;
    }

    // Payment-specific resolution UI
    const isCod = isCashOnDelivery(order);
    const cash = extractCashAmount(order.total);
    if (isCod) {
      if (cnrBoxCod) cnrBoxCod.style.display = 'block';
      if (cnrBoxPrepaid) cnrBoxPrepaid.style.display = 'none';
      if (cnrCodAmount) cnrCodAmount.textContent = `₹${cash}`;
    } else {
      if (cnrBoxCod) cnrBoxCod.style.display = 'none';
      if (cnrBoxPrepaid) cnrBoxPrepaid.style.display = 'block';
      if (cnrSafedropNote) cnrSafedropNote.value = '';
    }

    // Start live countdown ticker
    if (cnrTimerInterval) clearInterval(cnrTimerInterval);
    updateCnrCountdown();
    cnrTimerInterval = setInterval(updateCnrCountdown, 1000);

    if (modalUnreachableBackdrop) {
      modalUnreachableBackdrop.classList.add('open');
      backNav.pushStep('modal-unreachable', () => closeUnreachableModal());
    }
  }

  function updateCnrCountdown() {
    if (!activeCnrOrder) return;
    const cleanId = String(activeCnrOrder.id || '').trim().replace(/^#/, '');
    const startTime = localStorage.getItem(`quickbite_cnr_start_${cleanId}`);
    if (!startTime) return;

    const elapsedSeconds = Math.floor((Date.now() - Number(startTime)) / 1000);
    const totalDuration = 600; // 10 minutes (600 seconds)
    const remainingSeconds = Math.max(0, totalDuration - elapsedSeconds);

    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    const formatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

    if (cnrClockDisplay) {
      cnrClockDisplay.textContent = formatted;
      if (remainingSeconds === 0) {
        cnrClockDisplay.classList.add('expired');
      } else {
        cnrClockDisplay.classList.remove('expired');
      }
    }

    const pct = Math.max(0, Math.min(100, (remainingSeconds / totalDuration) * 100));
    if (cnrProgressFill) {
      cnrProgressFill.style.width = `${pct}%`;
      if (remainingSeconds === 0) {
        cnrProgressFill.style.background = '#EF4444';
      } else if (remainingSeconds < 180) {
        cnrProgressFill.style.background = 'linear-gradient(90deg, #EF4444, #F59E0B)';
      } else {
        cnrProgressFill.style.background = 'linear-gradient(90deg, #F59E0B, #10B981)';
      }
    }

    if (cnrTimerStatusBadge) {
      if (remainingSeconds === 0) {
        cnrTimerStatusBadge.textContent = '⚠️ 10 Mins Completed';
        cnrTimerStatusBadge.style.background = 'rgba(239, 68, 68, 0.2)';
        cnrTimerStatusBadge.style.color = '#F87171';
        cnrTimerStatusBadge.style.borderColor = 'rgba(239, 68, 68, 0.4)';
      } else {
        cnrTimerStatusBadge.textContent = `⏱️ ${Math.ceil(remainingSeconds / 60)} Mins Left`;
        cnrTimerStatusBadge.style.background = 'rgba(245, 158, 11, 0.2)';
        cnrTimerStatusBadge.style.color = '#FCD34D';
        cnrTimerStatusBadge.style.borderColor = 'rgba(245, 158, 11, 0.4)';
      }
    }

    if (cnrClockSub) {
      if (remainingSeconds === 0) {
        cnrClockSub.textContent = '10-Minute waiting protocol completed. Customer did not respond. Return parcel to kitchen counter.';
        cnrClockSub.style.color = '#FCA5A5';
      } else {
        cnrClockSub.textContent = 'Please wait 10 minutes at doorstep before returning parcel';
        cnrClockSub.style.color = '#CBD5E1';
      }
    }
  }

  function closeUnreachableModal() {
    if (cnrTimerInterval) {
      clearInterval(cnrTimerInterval);
      cnrTimerInterval = null;
    }
    if (modalUnreachableBackdrop) {
      modalUnreachableBackdrop.classList.remove('open');
    }
    backNav.removeStep('modal-unreachable');
    activeCnrOrder = null;
    renderPortal();
  }

  if (modalUnreachableClose) modalUnreachableClose.addEventListener('click', closeUnreachableModal);
  if (btnCloseUnreachableModal) btnCloseUnreachableModal.addEventListener('click', closeUnreachableModal);
  if (modalUnreachableBackdrop) {
    modalUnreachableBackdrop.addEventListener('click', (e) => {
      if (e.target === modalUnreachableBackdrop) closeUnreachableModal();
    });
  }

  // COD Return to Kitchen
  if (btnCnrReturnCod) {
    btnCnrReturnCod.addEventListener('click', () => {
      if (!activeCnrOrder) return;
      const orderId = activeCnrOrder.id;
      const cleanId = String(orderId).replace(/^#/, '');
      const reason = cnrCodReason ? cnrCodReason.value : 'Customer did not answer calls/doorbell after 10 mins wait';
      const currentRider = dataService.getActiveRider() || { pin: '0000', name: 'Delivery Partner' };

      localStorage.removeItem(`quickbite_cnr_start_${cleanId}`);

      dataService.riderUndeliveredOrder(orderId, {
        reason,
        riderPin: currentRider.pin,
        returnToKitchen: true
      });

      closeUnreachableModal();
      showToast(`📦 Order ${orderId} marked for return to kitchen counter. COD cash liability remains ₹0.`, 'info');

      activeTab = 'delivered';
      persistRiderTab('delivered');
      updateActiveTabUI();
      renderPortal();
    });
  }

  // Prepaid Safe Drop
  if (btnCnrSafedrop) {
    btnCnrSafedrop.addEventListener('click', () => {
      if (!activeCnrOrder) return;
      const orderId = activeCnrOrder.id;
      const cleanId = String(orderId).replace(/^#/, '');
      const note = (cnrSafedropNote?.value || '').trim() || 'Left at customer doorstep / with building security';
      const currentRider = dataService.getActiveRider() || { pin: '0000', name: 'Delivery Partner' };

      localStorage.removeItem(`quickbite_cnr_start_${cleanId}`);

      dataService.riderSafeDropPrepaid(orderId, {
        safeDropNote: note,
        riderPin: currentRider.pin
      });

      try {
        confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } });
      } catch {}

      closeUnreachableModal();
      showToast(`🚪 Order ${orderId} delivered via Safe Drop: ${note}`, 'success');

      activeTab = 'delivered';
      persistRiderTab('delivered');
      updateActiveTabUI();
      renderPortal();
    });
  }

  // Prepaid Return to Kitchen
  if (btnCnrReturnPrepaid) {
    btnCnrReturnPrepaid.addEventListener('click', () => {
      if (!activeCnrOrder) return;
      const orderId = activeCnrOrder.id;
      const cleanId = String(orderId).replace(/^#/, '');
      const reason = cnrPrepaidReason ? cnrPrepaidReason.value : 'Inaccessible location / customer unreachable';
      const currentRider = dataService.getActiveRider() || { pin: '0000', name: 'Delivery Partner' };

      localStorage.removeItem(`quickbite_cnr_start_${cleanId}`);

      dataService.riderUndeliveredOrder(orderId, {
        reason,
        riderPin: currentRider.pin,
        returnToKitchen: true
      });

      closeUnreachableModal();
      showToast(`📦 Prepaid order ${orderId} marked for return to kitchen counter.`, 'info');

      activeTab = 'delivered';
      persistRiderTab('delivered');
      updateActiveTabUI();
      renderPortal();
    });
  }

  // ========================================================
  // CASH IN HAND BREAKDOWN MODAL (SEGREGATED PER RIDER)
  // ========================================================
  function openCashSummaryModal() {
    const currentRider = dataService.getActiveRider() || { pin: '0000', name: 'Delivery Partner' };
    const cashSummary = dataService.getRiderCashSummary(currentRider.pin);
    const grandTotal = cashSummary.cashInHand;
    const deliveredCodOrders = cashSummary.codOrders;

    if (modalCashLargeTotal) {
      modalCashLargeTotal.textContent = `₹${grandTotal.toLocaleString('en-IN')}`;
    }
    if (modalCashOrdersCount) {
      modalCashOrdersCount.textContent = `Rider: ${currentRider.name} (PIN: ${currentRider.pin}) • ${deliveredCodOrders.length} cash order${deliveredCodOrders.length === 1 ? '' : 's'}`;
    }

    if (cashOrdersBreakdownList) {
      if (deliveredCodOrders.length === 0) {
        cashOrdersBreakdownList.innerHTML = `
          <div style="text-align: center; padding: 20px; color: #64748B;">
            No cash collected yet for this shift.
          </div>
        `;
      } else {
        cashOrdersBreakdownList.innerHTML = deliveredCodOrders.map(o => {
          const cash = extractCashAmount(o.total);
          const time = o.createdAt ? new Date(o.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
          return `
            <div class="cash-breakdown-item">
              <div>
                <strong>${escapeHtml(o.id)}</strong> — <span>${escapeHtml(o.customerName || 'Customer')}</span>
                <div style="font-size: 0.72rem; color: #64748B;">Delivered at ${time}</div>
              </div>
              <strong>+ ₹${cash}</strong>
            </div>
          `;
        }).join('');
      }
    }

    modalCashBackdrop.classList.add('open');
    backNav.pushStep('modal-cash-summary', () => modalCashBackdrop.classList.remove('open'));
  }

  function closeCashSummaryModal() {
    modalCashBackdrop.classList.remove('open');
    backNav.removeStep('modal-cash-summary');
  }

  if (btnRiderCashSummary) btnRiderCashSummary.addEventListener('click', openCashSummaryModal);
  if (modalCashClose) modalCashClose.addEventListener('click', closeCashSummaryModal);
  if (modalCashBackdrop) {
    modalCashBackdrop.addEventListener('click', (e) => {
      if (e.target === modalCashBackdrop) closeCashSummaryModal();
    });
  }

  if (btnHandoverCash) {
    btnHandoverCash.addEventListener('click', () => {
      const currentRider = dataService.getActiveRider() || { pin: '0000', name: 'Delivery Partner' };
      const cashSummary = dataService.getRiderCashSummary(currentRider.pin);
      const amount = cashSummary.cashInHand;
      if (amount <= 0) {
        showToast('ℹ️ No cash in hand to submit.', 'info');
        return;
      }
      const res = dataService.requestRiderCashHandover(currentRider.pin);
      if (res.success) {
        showToast(`💵 Handover of ₹${amount.toLocaleString('en-IN')} submitted to Kitchen/Owner! Awaiting verification.`, 'success');
        closeCashSummaryModal();
        renderPortal();
      }
    });
  }

  // Realtime notification when Owner confirms cash taken
  dataService.subscribeToChanges('cash_settled', () => {
    renderPortal();
  });

  // ========================================================
  // TABS & NAVIGATION BAR
  // ========================================================
  function updateActiveTabUI() {
    const allNavButtons = document.querySelectorAll('.rider-tab-btn, .rider-nav-btn');
    allNavButtons.forEach(btn => {
      if (btn.getAttribute('data-tab') === activeTab) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  function switchRiderTab(target) {
    if (!target) return;
    activeTab = target;
    persistRiderTab(target);
    updateActiveTabUI();
    renderPortal();
  }

  // Handle clicks on both in-page capsule navigation bar and bottom floating capsule navigation bar
  const allNavButtons = document.querySelectorAll('.rider-tab-btn, .rider-nav-btn');
  allNavButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-tab');
      if (target) switchRiderTab(target);
    });
  });

  // Manual Refresh Button
  if (btnManualRefresh) {
    btnManualRefresh.addEventListener('click', async () => {
      btnManualRefresh.classList.add('spinning');
      try {
        await dataService.syncOrdersFromSupabase(true);
      } catch {}
      renderPortal();
      showToast('🔄 Live orders updated!', 'info');
      setTimeout(() => {
        btnManualRefresh.classList.remove('spinning');
      }, 500);
    });
  }


  // ========================================================
  // REAL-TIME SYNC & NOTIFICATION LISTENERS
  // ========================================================
  const knownDeliveryIds = new Set();
  const initOrders = dataService.getOrders();
  if (Array.isArray(initOrders)) {
    initOrders.forEach(o => { 
      if (o && o.id) {
        const clean = String(o.id).trim().replace(/^#/, '');
        knownDeliveryIds.add(o.id);
        knownDeliveryIds.add(clean);
        knownDeliveryIds.add(`#${clean}`);
      }
    });
  }

  function handleRiderIncomingOrder(order) {
    if (!order || !order.id) return;
    const normalizeId = (id) => String(id || '').trim().replace(/^#/, '');
    const cleanId = normalizeId(order.id);
    knownDeliveryIds.add(order.id);
    knownDeliveryIds.add(cleanId);
    knownDeliveryIds.add(`#${cleanId}`);

    // If order is already active (on_the_way) or delivered, NEVER treat as incoming ready order!
    const allOrders = dataService.getOrders();
    const existing = allOrders.find(o => normalizeId(o.id) === cleanId);
    if (existing && (existing.status === 'on_the_way' || existing.status === 'delivered')) {
      renderPortal();
      return;
    }

    // Delivery partner / rider ONLY gets notified when the order is READY FOR DISPATCH!
    if (order.status !== 'ready_for_pickup') {
      renderPortal();
      return;
    }

    playNotificationSound('rider_new_task');
    showToast(`📦 New parcel packed & ready on restaurant kitchen counter!`, 'success');

    sendSystemNotification({
      title: `📦 Order ${order.id} Ready on Kitchen Counter!`,
      body: `Pick up the packed food bag from the kitchen dispatch counter and enter the 4-digit code written on it.`,
      tag: `rider-ready-${order.id}`,
      data: { orderId: order.id, url: '/delivery.html' },
      onClick: () => {
        const curOrders = dataService.getOrders();
        const cur = curOrders.find(o => normalizeId(o.id) === cleanId);
        if (cur && cur.status === 'ready_for_pickup') {
          activeTab = 'ready';
          persistRiderTab('ready');
          updateActiveTabUI();
          renderPortal();
        }
      }
    });

    flashTabTitle(`📦 READY FOR PICKUP: ${order.id}!`);
    renderPortal();
  }

  const recentRiderStatusSyncs = new Map();

  function handleRiderOrderStatusSync(payload) {
    if (!payload) return;
    const orderId = payload.orderId || payload.order?.id;
    const status = payload.status || payload.order?.status;
    if (!orderId || !status) return;

    const syncKey = `${orderId}:${status}`;
    const now = Date.now();
    if (now - (recentRiderStatusSyncs.get(syncKey) || 0) < 3000) return;
    recentRiderStatusSyncs.set(syncKey, now);

    const allOrders = dataService.getOrders();
    const normalizeId = (id) => String(id || '').trim().replace(/^#/, '');
    const cleanId = normalizeId(orderId);
    const order = payload.order || allOrders.find(o => normalizeId(o.id) === cleanId);

    // If order has already been claimed (on_the_way) or delivered, NEVER regress or alert as ready!
    const currentOrder = allOrders.find(o => normalizeId(o.id) === cleanId);
    if (currentOrder && (currentOrder.status === 'on_the_way' || currentOrder.status === 'delivered')) {
      renderPortal();
      return;
    }

    // Delivery partner only gets notified when order is READY FOR DISPATCH ('ready_for_pickup')!
    if (status === 'ready_for_pickup') {
      playNotificationSound('rider_new_task');
      showToast(`📦 Order ${orderId} is packed & ready on kitchen counter!`, 'success');
      sendSystemNotification({
        title: `📦 Order ${orderId} Ready on Kitchen Counter!`,
        body: `Pick up the packed food bag from the restaurant counter and enter the 4-digit code to start delivery.`,
        tag: `rider-ready-${orderId}`,
        data: { orderId, url: '/delivery.html' }
      });
      flashTabTitle(`📦 READY FOR PICKUP: ${orderId}`);
    } else {
      if (orderId) {
        knownDeliveryIds.add(orderId);
        knownDeliveryIds.add(cleanId);
      }
    }
    renderPortal();
  }

  function scanRiderNewOrders() {
    const normalizeId = (id) => String(id || '').trim().replace(/^#/, '');
    const latestList = dataService.getOrders();
    const newArrivals = latestList.filter(o => o && o.id && !knownDeliveryIds.has(o.id) && !knownDeliveryIds.has(normalizeId(o.id)));
    if (newArrivals.length > 0) {
      newArrivals.forEach(o => {
        knownDeliveryIds.add(o.id);
        knownDeliveryIds.add(normalizeId(o.id));
      });
      const readyArrivals = newArrivals.filter(o => o.status === 'ready_for_pickup');
      if (readyArrivals.length > 0) {
        handleRiderIncomingOrder(readyArrivals[0]);
      } else {
        renderPortal();
      }
    }
  }

  // 1. Storage event from Admin or Storefront tabs
  window.addEventListener('storage', (e) => {
    if (e.key === 'quickbite_latest_incoming_order' && e.newValue) {
      try {
        const orderData = JSON.parse(e.newValue);
        handleRiderIncomingOrder(orderData);
      } catch {}
    }
    if (e.key === 'quickbite_order_status_sync' && e.newValue) {
      try {
        const payload = JSON.parse(e.newValue);
        handleRiderOrderStatusSync(payload);
      } catch {}
    }
    if (e.key === 'quickbite_orders' || e.key === 'quickbite_orders_sync_ping') {
      scanRiderNewOrders();
      renderPortal();
    }
  });

  // 2. BroadcastChannel
  try {
    const syncChannel = new BroadcastChannel('quickbite_sync_channel');
    syncChannel.onmessage = (event) => {
      const data = event.data;
      if (data?.type === 'orders') {
        if (data.action === 'new_order' && data.order) {
          handleRiderIncomingOrder(data.order);
        } else if (data.action === 'status_updated') {
          handleRiderOrderStatusSync(data);
        } else {
          scanRiderNewOrders();
          renderPortal();
        }
      }
    };
  } catch {}

  // 3. DataService In-Memory Subscription
  dataService.subscribeToChanges((entity, detail) => {
    if (entity === 'orders') {
      if (detail?.action === 'new_order' && detail.order) {
        handleRiderIncomingOrder(detail.order);
      } else if (detail?.action === 'status_updated') {
        handleRiderOrderStatusSync(detail);
      } else {
        scanRiderNewOrders();
        renderPortal();
      }
    }
  });

  // ========================================================
  // 4-DIGIT KITCHEN BAG CODE CLAIM CONTROLLER
  // ========================================================
  let isClaimingBag = false;
  function startDeliveryByBagCode(rawCode) {
    if (isClaimingBag) return;

    const inputBagCode = document.getElementById('input-bag-code');
    const code = String(rawCode || (inputBagCode ? inputBagCode.value : '')).trim().replace(/\D/g, '');

    if (!code || code.length !== 4) {
      showToast('⚠️ Please enter the 4-digit code written on the food bag', 'warning');
      if (inputBagCode) inputBagCode.focus();
      return;
    }

    isClaimingBag = true;
    setTimeout(() => { isClaimingBag = false; }, 600);

    const currentRider = dataService.getActiveRider() || { pin: '0000', name: 'Delivery Partner' };
    
    // Switch to active tab right away and persist so subsequent sync/storage subscribers render Active tab
    activeTab = 'active';
    persistRiderTab('active');
    updateActiveTabUI();

    const res = dataService.claimOrderByBagCode(code, currentRider.pin);

    if (res.success) {
      if (inputBagCode) inputBagCode.value = '';

      renderPortal();

      const allActive = dataService.getOrders().filter(o => o.status === 'on_the_way');
      showToast(`🚀 Parcel #${code} claimed! (${Math.max(1, allActive.length)} active parcel${allActive.length > 1 ? 's' : ''} on your run)`, 'success');
      playNotificationSound('rider_new_task');
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    } else {
      // If there are already active parcels on this device, stay on active tab
      const allActive = dataService.getOrders().filter(o => o.status === 'on_the_way');
      if (allActive.length > 0) {
        activeTab = 'active';
        persistRiderTab('active');
      } else {
        activeTab = 'ready';
        persistRiderTab('ready');
      }
      updateActiveTabUI();
      renderPortal();
      showToast(`❌ ${res.message || 'Failed to claim bag'}`, 'error');
      if (inputBagCode) {
        inputBagCode.classList.add('shake');
        setTimeout(() => inputBagCode.classList.remove('shake'), 500);
        inputBagCode.select();
      }
    }
  }

  function attachBagInputListeners() {
    // 1. Kitchen Pending Card Form
    const bagPickupForm = document.getElementById('bag-pickup-form');
    const inputBagCode = document.getElementById('input-bag-code');
    const btnClaimBag = document.getElementById('btn-claim-bag');

    if (bagPickupForm) {
      bagPickupForm.onsubmit = (e) => {
        e.preventDefault();
        const input = document.getElementById('input-bag-code');
        startDeliveryByBagCode(input ? input.value : '');
      };
    }

    if (inputBagCode) {
      inputBagCode.oninput = () => {
        const val = inputBagCode.value.replace(/\D/g, '');
        inputBagCode.value = val;
        if (val.length === 4) {
          startDeliveryByBagCode(val);
        }
      };
    }

    if (btnClaimBag) {
      btnClaimBag.onclick = (e) => {
        e.preventDefault();
        const input = document.getElementById('input-bag-code');
        startDeliveryByBagCode(input ? input.value : '');
      };
    }
  }

  // Register DOM fallback checkers for bulletproof single-step back navigation (modals only)
  backNav.registerFallbackChecker({
    isOpen: () => modalConfirmBackdrop && modalConfirmBackdrop.classList.contains('open'),
    close: () => closeConfirmModal()
  });
  backNav.registerFallbackChecker({
    isOpen: () => modalCashBackdrop && modalCashBackdrop.classList.contains('open'),
    close: () => closeCashSummaryModal()
  });
  backNav.registerFallbackChecker({
    isOpen: () => modalUnreachableBackdrop && modalUnreachableBackdrop.classList.contains('open'),
    close: () => closeUnreachableModal()
  });

  // Listen to rider session / settlement / claim events
  dataService.subscribeToChanges((entity, detail) => {
    if (
      entity === 'rider_session' || 
      entity === 'cash_settled' || 
      entity === 'riders' || 
      detail?.action === 'rider_claimed_order' || 
      detail?.action === 'update_riders' || 
      detail?.action === 'sync_riders' ||
      detail?.action === 'delete_rider'
    ) {
      if (entity === 'riders' || detail?.action === 'delete_rider') {
        const currentRider = dataService.getActiveRider();
        if (!currentRider) {
          clearStaffSession('rider');
          if (riderLockOverlay) riderLockOverlay.classList.remove('unlocked');
          if (riderPasscodeLock) riderPasscodeLock.reset();
        }
      }
      updateRiderProfileHeader();
      renderPortal();
    }
  });

  // Initial render & Live Geolocation tracking start
  renderPortal();
  initRiderLiveGeolocation();
});
