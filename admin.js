/**
 * QuickBite Admin Portal Logic
 * Implements 2-button navigation, Category & Food management, Live Orders tracking,
 * and data synchronization with dataService.
 */

import { dataService, PRESET_FOOD_IMAGES, extractPhoneFromOrder, cleanDeliveryAddress, formatTime12h, getDishScheduleStatus, formatDisplayOrderId } from './dataService.js';
import { cloudflareR2Service } from './cloudflareR2Service.js';
import {
  playNotificationSound,
  sendSystemNotification,
  flashTabTitle,
  stopFlashingTabTitle,
  getAudioContext,
  unlockAudioContext,
  requestSystemNotificationPermission,
  getSystemNotificationPermission,
  updateAppBadge,
  showSamsungToast
} from './notificationService.js';
import { createBackNavigationManager } from './navigationBackService.js';
import {
  escapeHtml,
  sanitizeUrl,
  isStaffSessionActive,
  setStaffSessionActive,
  clearStaffSession,
  verifyStaffPin,
  ensureAdminToken
} from './securityUtils.js';
import { initIosPasscodeLock } from './passcodeLockService.js';
import { requestWakeLock, releaseWakeLock, isWakeLockActive, onWakeLockChange } from './wakeLockService.js';
import './pwa.css';

const initAdminApp = () => {
  // Navigation Back Stack Controller (Single-step back navigation)
  const backNav = createBackNavigationManager('admin');

  // Screen WakeLock Controller (Keeps kitchen tablet display awake)
  const btnAdminWakeLock = document.getElementById('btn-admin-wakelock');
  const wakeLockStatusText = document.getElementById('wakelock-status-text');

  if (btnAdminWakeLock) {
    onWakeLockChange((isActive) => {
      if (isActive) {
        btnAdminWakeLock.classList.add('active');
        btnAdminWakeLock.classList.remove('disabled');
        if (wakeLockStatusText) wakeLockStatusText.textContent = 'Screen Awake';
        btnAdminWakeLock.title = 'Screen kept awake for kitchen tablet (Click to disable)';
      } else {
        btnAdminWakeLock.classList.remove('active');
        btnAdminWakeLock.classList.add('disabled');
        if (wakeLockStatusText) wakeLockStatusText.textContent = 'Screen Normal';
        btnAdminWakeLock.title = 'Screen lock disabled (Click to keep screen awake)';
      }
    });

    btnAdminWakeLock.addEventListener('click', async () => {
      if (isWakeLockActive()) {
        await releaseWakeLock();
        showToast('💤 Screen sleep allowed', 'info');
      } else {
        const ok = await requestWakeLock();
        if (ok) {
          showToast('☀️ Kitchen screen will stay awake', 'success');
        } else {
          showToast('⚠️ Wake lock not supported by browser', 'info');
        }
      }
    });
  }

  // ========================================================
  // SECURITY GATE: iOS PASSCODE KEYPAD CONTROLLER
  // ========================================================
  const adminLockOverlay = document.getElementById('admin-lock-overlay');
  const btnAdminLogout = document.getElementById('btn-admin-logout');

  const adminPasscodeLock = initIosPasscodeLock({
    overlayEl: adminLockOverlay,
    dotsEl: document.getElementById('admin-passcode-dots'),
    keypadEl: document.getElementById('admin-keypad'),
    subtitleEl: document.getElementById('admin-lock-subtitle'),
    hintEl: document.getElementById('admin-passcode-hint'),
    defaultCode: '8899',
    onVerify: async (pin) => {
      return await verifyStaffPin('admin', pin);
    },
    onSuccess: () => {
      requestWakeLock();
      showToast('🔓 Manager Access Granted', 'success');
      dataService.syncOrdersFromSupabase(true).then(() => {
        renderOrders();
        updateOrderBadges();
      }).catch(() => {});
      dataService.syncRidersFromSupabase().catch(() => {});
    }
  });

  async function checkAdminSession() {
    const hasLocalAuth = isStaffSessionActive('admin') || isStaffSessionActive('owner');
    let validToken = null;

    if (hasLocalAuth) {
      validToken = await ensureAdminToken('admin').catch(() => null);
    }

    if (hasLocalAuth && validToken) {
      if (adminLockOverlay) {
        adminLockOverlay.classList.add('unlocked');
        adminLockOverlay.style.display = 'none';
      }
      requestWakeLock();
      dataService.syncOrdersFromSupabase().then(() => {
        renderOrders();
        updateOrderBadges();
      }).catch(() => {});
      dataService.syncRidersFromSupabase().catch(() => {});
    } else {
      clearStaffSession('admin');
      clearStaffSession('owner');
      releaseWakeLock();
      if (adminLockOverlay) {
        adminLockOverlay.classList.remove('unlocked');
        adminLockOverlay.style.display = 'flex';
        if (adminPasscodeLock) adminPasscodeLock.reset();
      }
    }
  }

  if (btnAdminLogout) {
    btnAdminLogout.addEventListener('click', () => {
      clearStaffSession('admin');
      clearStaffSession('owner');
      releaseWakeLock();
      if (adminLockOverlay) {
        adminLockOverlay.classList.remove('unlocked');
        adminLockOverlay.style.display = 'flex';
      }
      if (adminPasscodeLock) adminPasscodeLock.reset();
      showToast('🔒 Admin Portal Locked', 'info');
    });
  }

  // Idle auto-lock: Locks the screen after 30 minutes of inactivity for counter security
  let idleLockTimer = null;
  function resetIdleLockTimer() {
    if (idleLockTimer) clearTimeout(idleLockTimer);
    if (isStaffSessionActive('admin') || isStaffSessionActive('owner')) {
      idleLockTimer = setTimeout(() => {
        if (isStaffSessionActive('admin') || isStaffSessionActive('owner')) {
          clearStaffSession('admin');
          clearStaffSession('owner');
          releaseWakeLock();
          if (adminLockOverlay) {
            adminLockOverlay.classList.remove('unlocked');
            adminLockOverlay.style.display = 'flex';
          }
          if (adminPasscodeLock) adminPasscodeLock.reset();
          showToast('🔒 Session timed out due to inactivity. Admin Portal Locked.', 'info');
        }
      }, 30 * 60 * 1000);
    }
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(evt => {
    window.addEventListener(evt, resetIdleLockTimer, { passive: true });
  });
  resetIdleLockTimer();

  const btnClearDemo = document.getElementById('btn-clear-demo');
  if (btnClearDemo) {
    btnClearDemo.addEventListener('click', () => {
      const orders = dataService.getOrders();
      const isDemoOrder = (o) => Boolean(o && (o.isDemo === true || o.is_demo === true || String(o.id || '').startsWith('#DEMO')));
      const demoOrders = orders.filter(isDemoOrder);
      if (demoOrders.length === 0) {
        showToast('No demo orders found', 'info');
        return;
      }
      const keptOrders = orders.filter(o => !isDemoOrder(o));
      dataService.saveOrders(keptOrders, { action: 'demo_orders_cleared' });
      renderOrders();
      calculateOrderKPIs(keptOrders);
      showToast(`Cleared ${demoOrders.length} demo order(s)`, 'success');
    });
  }

  // Safe fallback for test order clearing (if present)
  const btnClearAllOrders = document.getElementById('btn-clear-all-orders');
  if (btnClearAllOrders) {
    btnClearAllOrders.addEventListener('click', async () => {
      const ownerToken = (typeof sessionStorage !== 'undefined') ? sessionStorage.getItem('quickbite_owner_token') : null;
      if (!ownerToken) {
        showToast('⚠️ Clearing all orders requires Executive Owner authentication (PIN: 9900).', 'error');
        return;
      }
      const confirmed = confirm('⚠️ Are you sure you want to permanently clear all test orders?');
      if (!confirmed) return;
      try {
        await dataService.clearAllOrders();
        renderOrders();
        calculateOrderKPIs([]);
        showToast('✓ All test orders cleared successfully!', 'success');
      } catch (err) {
        console.error('[Admin] Failed to clear orders:', err);
        showToast(`⚠️ Failed to clear orders: ${err?.message || 'Owner permission required'}`, 'error');
      }
    });
  }

  // Live Kitchen Connectivity & Offline Monitor
  const connectionBanner = document.getElementById('admin-connection-banner');
  const connectionBannerText = document.getElementById('connection-banner-text');
  const connectionBannerIcon = document.getElementById('connection-banner-icon');
  const btnReconnectNow = document.getElementById('btn-reconnect-now');

  function updateKitchenConnectionUI(isOnline) {
    if (!connectionBanner) return;
    if (!isOnline) {
      connectionBanner.className = 'admin-connection-banner offline';
      connectionBanner.style.display = 'block';
      if (connectionBannerIcon) connectionBannerIcon.className = 'fa-solid fa-triangle-exclamation fa-beat';
      if (connectionBannerText) connectionBannerText.textContent = 'Kitchen Offline: Internet disconnected. Reconnecting to live orders...';
      if (btnReconnectNow) btnReconnectNow.style.display = 'inline-block';
    } else {
      connectionBanner.className = 'admin-connection-banner online';
      if (connectionBannerIcon) connectionBannerIcon.className = 'fa-solid fa-circle-check';
      if (connectionBannerText) connectionBannerText.textContent = '🟢 Connected: Live Kitchen Stream Active';
      if (btnReconnectNow) btnReconnectNow.style.display = 'none';
      setTimeout(() => {
        if (navigator.onLine && connectionBanner) {
          connectionBanner.style.display = 'none';
        }
      }, 3500);
    }
  }

  window.addEventListener('online', () => {
    updateKitchenConnectionUI(true);
    dataService.syncOrdersFromSupabase(true).then(() => {
      renderOrders();
      updateOrderBadges();
    }).catch(() => {});
    dataService.syncDishesFromSupabase().then(() => {
      renderDishes();
    }).catch(() => {});
  });

  window.addEventListener('offline', () => {
    updateKitchenConnectionUI(false);
  });

  if (btnReconnectNow) {
    btnReconnectNow.addEventListener('click', async () => {
      btnReconnectNow.disabled = true;
      btnReconnectNow.textContent = 'Retrying...';
      try {
        await dataService.syncOrdersFromSupabase(true);
        updateKitchenConnectionUI(navigator.onLine);
        renderOrders();
        showToast('🟢 Connection verified & orders synchronized!', 'success');
      } catch {
        showToast('⚠️ Could not connect to server. Check Wi-Fi.', 'error');
      } finally {
        btnReconnectNow.disabled = false;
        btnReconnectNow.textContent = 'Retry Connection';
      }
    });
  }

  if (!navigator.onLine) {
    updateKitchenConnectionUI(false);
  }

  // Initial gate check
  checkAdminSession();

  // ========================================================
  // STATE
  // ========================================================
  let activeView = 'view-orders'; // 'view-orders' | 'view-menu'
  let activeCategoryFilter = 'all';
  let dishSearchQuery = '';
  let activeOrderFilter = 'accepted';
  let orderSearchQuery = '';
  let adminOrdersPage = 1;
  const ADMIN_ORDERS_PER_PAGE = 25;
  let currentDishGdriveFileId = '';

  // DOM Elements - Navigation
  const viewMenu = document.getElementById('view-menu');
  const viewOrders = document.getElementById('view-orders');
  const viewHours = document.getElementById('view-hours');
  const viewOffers = document.getElementById('view-offers');
  const viewDelivery = document.getElementById('view-delivery');
  const topBtnMenu = document.getElementById('top-btn-menu');
  const topBtnOrders = document.getElementById('top-btn-orders');
  const topBtnHours = document.getElementById('top-btn-hours');
  const capsuleBtnMenu = document.getElementById('capsule-btn-menu');
  const capsuleBtnOrders = document.getElementById('capsule-btn-orders');
  const capsuleBtnHours = document.getElementById('capsule-btn-hours');
  const capsuleBtnOffers = document.getElementById('capsule-btn-offers');
  const capsuleBtnDelivery = document.getElementById('capsule-btn-delivery');
  const topOrderCounter = document.getElementById('top-order-counter');
  const capsuleOrderBadge = document.getElementById('capsule-order-badge');
  const topRushBadge = document.getElementById('top-rush-badge');
  const capsuleRushBadge = document.getElementById('capsule-rush-badge');
  const capsuleOfferBadge = document.getElementById('capsule-offer-badge');

  // DOM Elements - Category
  const categoriesGrid = document.getElementById('categories-admin-grid');
  const categoriesCountBadge = document.getElementById('categories-count-badge');
  const modalCategoryBackdrop = document.getElementById('modal-category-backdrop');
  const formCategory = document.getElementById('form-category');
  const catModalTitle = document.getElementById('cat-modal-title');
  const catEditId = document.getElementById('cat-edit-id');
  const catNameInput = document.getElementById('cat-name-input');
  const catEmojiInput = document.getElementById('cat-emoji-input');
  const catImageInput = document.getElementById('cat-image-input');
  const catImagePreview = document.getElementById('cat-image-preview');
  const catImageFallbackEmoji = document.getElementById('cat-image-fallback-emoji');
  const catFileUpload = document.getElementById('cat-file-upload');
  const catUploadStatus = document.getElementById('cat-upload-status');
  const btnOpenAddCat = document.getElementById('btn-open-add-cat');
  const btnOpenEditAllCat = document.getElementById('btn-open-edit-all-cat');
  const modalCatClose = document.getElementById('modal-cat-close');
  const btnCancelCat = document.getElementById('btn-cancel-cat');
  const btnSaveCat = document.getElementById('btn-save-cat');
  let isSubmittingCat = false;
  let isUploadingCatPhoto = false;

  // DOM Elements - Category Overview & Detail View
  const categoriesOverviewPanel = document.getElementById('categories-overview-panel');
  const categoryDetailPanel = document.getElementById('category-detail-panel');
  const btnBackToCategories = document.getElementById('btn-back-to-categories');
  const catDetailEmoji = document.getElementById('cat-detail-emoji');
  const catDetailName = document.getElementById('cat-detail-name');
  const catDetailCount = document.getElementById('cat-detail-count');
  const btnCatAddDish = document.getElementById('btn-cat-add-dish');
  const btnCatEmptyAddDish = document.getElementById('btn-cat-empty-add-dish');
  const catDishSearchInput = document.getElementById('cat-dish-search-input');
  const btnClearCatDishSearch = document.getElementById('btn-clear-cat-dish-search');
  const categoryDishesGrid = document.getElementById('category-dishes-grid');
  const catDishesEmptyState = document.getElementById('cat-dishes-empty-state');
  const catEmptyTitle = document.getElementById('cat-empty-title');

  // DOM Elements - Global Menu Dish Search Across All Categories
  const globalDishSearchInput = document.getElementById('global-dish-search-input');
  const btnClearGlobalDishSearch = document.getElementById('btn-clear-global-dish-search');
  const globalDishSearchResultsPanel = document.getElementById('global-dish-search-results-panel');
  const globalDishesResultsGrid = document.getElementById('global-dishes-results-grid');
  const globalSearchCountBadge = document.getElementById('global-search-count-badge');
  const categoriesGridTitleBar = document.getElementById('categories-grid-title-bar');
  const categoriesAdminGrid = document.getElementById('categories-admin-grid');
  let globalDishSearchQuery = '';

  let currentOpenedCategorySlug = null;
  let catDishSearchQuery = '';

  // Safe fallback bindings
  const dishesGrid = categoryDishesGrid;
  const dishesCountBadge = catDetailCount;
  const dishSearchInput = catDishSearchInput;
  const btnClearDishSearch = btnClearCatDishSearch;
  const dishCategoryFilter = document.getElementById('dish-category-filter');
  const categoryFilterPills = document.getElementById('category-filter-pills');
  const dishesEmptyState = catDishesEmptyState;
  const btnOpenAddDish = btnCatAddDish;
  const btnEmptyAddDish = btnCatEmptyAddDish;

  // Dish Modal Elements
  const modalDishBackdrop = document.getElementById('modal-dish-backdrop');
  const formDish = document.getElementById('form-dish');
  const btnSaveDish = document.getElementById('btn-save-dish');
  let isSubmittingDish = false;
  let isUploadingDishPhoto = false;
  const dishModalTitle = document.getElementById('dish-modal-title');
  const dishEditId = document.getElementById('dish-edit-id');
  const dishNameInput = document.getElementById('dish-name-input');
  const dishCategorySelect = document.getElementById('dish-category-select');
  const dishPriceInput = document.getElementById('dish-price-input');
  const dishBadgeInput = document.getElementById('dish-badge-input');
  const dishBadgeCustomInput = document.getElementById('dish-badge-custom-input');
  const dishTimeInput = document.getElementById('dish-time-input');
  const dishCaloriesInput = document.getElementById('dish-calories-input');
  const dishDietInput = document.getElementById('dish-diet-input');
  const dishDescInput = document.getElementById('dish-desc-input');
  const dishPreviewImg = document.getElementById('dish-preview-img');
  const dishImageUrl = document.getElementById('dish-image-url');
  const dishFileUpload = document.getElementById('dish-file-upload');
  const fileChosenText = document.getElementById('file-chosen-text');
  const presetImagesStrip = document.getElementById('preset-images-strip');
  const modalDishClose = document.getElementById('modal-dish-close');
  const btnCancelDish = document.getElementById('btn-cancel-dish');
  const btnModalDeleteDish = document.getElementById('btn-modal-delete-dish');
  const modalDishStockBtn = document.getElementById('modal-dish-stock-btn');
  const modalDishStockDot = document.getElementById('modal-dish-stock-dot');
  const modalDishStockLabel = document.getElementById('modal-dish-stock-label');
  const dishStockHidden = document.getElementById('dish-stock-hidden');

  // DOM Elements - Order Modal (Pop up from below - Read-only ticket receipt)
  const modalOrderBackdrop = document.getElementById('modal-order-backdrop');
  const modalOrderClose = document.getElementById('modal-order-close');
  const btnCancelOrder = document.getElementById('btn-cancel-order');
  const btnModalAdvanceStatus = document.getElementById('btn-modal-advance-status');
  const btnModalAdvanceText = document.getElementById('btn-modal-advance-text');
  const orderModalTitle = document.getElementById('order-modal-title');
  const orderModalStatusBadge = document.getElementById('order-modal-status-badge');
  const orderModalTimeSub = document.getElementById('order-modal-time-sub');
  const orderEditId = document.getElementById('order-edit-id');
  const orderDetailCustomer = document.getElementById('order-detail-customer');
  const orderDetailEta = document.getElementById('order-detail-eta');
  const orderDetailAddress = document.getElementById('order-detail-address');
  const orderDetailNotesCard = document.getElementById('order-detail-notes-card');
  const orderDetailNotes = document.getElementById('order-detail-notes');
  const orderEditItemsCount = document.getElementById('order-edit-items-count');
  const orderItemsReadonlyList = document.getElementById('order-items-readonly-list');
  const orderDetailTotal = document.getElementById('order-detail-total');
  const orderStatusStepPills = document.querySelectorAll('.order-status-step-pill');

  // DOM Elements - Orders
  const ordersContainer = document.getElementById('orders-cards-container');
  const ordersEmptyState = document.getElementById('orders-empty-state');
  const orderSearchInput = document.getElementById('order-search-input');
  const ordersStatusTabs = document.getElementById('orders-status-tabs');
  const btnRefreshOrders = document.getElementById('btn-refresh-orders');
  const btnCreateOrderDemo = document.getElementById('btn-create-order-demo');
  const btnMockOrderHeader = document.getElementById('btn-mock-order');
  const btnEmptyMakeOrder = document.getElementById('btn-empty-make-order');
  const pendingOverdueAlertBanner = document.getElementById('pending-overdue-alert-banner');
  const overdueBannerTitle = document.getElementById('overdue-banner-title');
  const overdueBannerSub = document.getElementById('overdue-banner-sub');
  const btnOverdueQuickAccept = document.getElementById('btn-overdue-quick-accept');
  const btnOverdueQuickView = document.getElementById('btn-overdue-quick-view');

  // KPI Elements
  const kpiTotalOrders = document.getElementById('kpi-total-orders');
  const kpiAcceptedOrders = document.getElementById('kpi-accepted-orders');
  const kpiCookingOrders = document.getElementById('kpi-cooking-orders');
  const kpiReadyOrders = document.getElementById('kpi-ready-orders');
  const kpiOutOrders = document.getElementById('kpi-out-orders');
  const kpiDeliveredOrders = document.getElementById('kpi-delivered-orders');
  const kpiTotalRevenue = document.getElementById('kpi-total-revenue');

  // Toast Container
  const toastContainer = document.getElementById('toast-container');

  // ========================================================
  // 1. FOUR-BUTTON SIGNATURE CAPSULE NAVIGATION SYSTEM
  // ========================================================
  function switchView(targetView, recordStep = true) {
    const previousView = activeView;
    activeView = targetView;

    // Remove active state from all views and buttons
    [viewMenu, viewOrders, viewHours, viewOffers, viewDelivery].forEach(v => v && v.classList.remove('active'));
    [topBtnMenu, topBtnOrders, topBtnHours].forEach(b => b && b.classList.remove('active'));
    [capsuleBtnMenu, capsuleBtnOrders, capsuleBtnHours, capsuleBtnOffers, capsuleBtnDelivery].forEach(b => b && b.classList.remove('active'));

    if (targetView === 'view-orders') {
      if (viewOrders) viewOrders.classList.add('active');
      if (topBtnOrders) topBtnOrders.classList.add('active');
      if (capsuleBtnOrders) capsuleBtnOrders.classList.add('active');
      renderOrders();
      dataService.syncOrdersFromSupabase().then(() => {
        renderOrders();
        updateOrderBadges();
      }).catch(() => {});
      // Remove other view steps from back stack
      ['view-menu', 'view-hours', 'view-offers', 'view-delivery'].forEach(v => backNav.removeStep('admin-view-' + v));
    } else if (targetView === 'view-menu') {
      if (viewMenu) viewMenu.classList.add('active');
      if (topBtnMenu) topBtnMenu.classList.add('active');
      if (capsuleBtnMenu) capsuleBtnMenu.classList.add('active');
      renderCategories();
      renderDishes();
    } else if (targetView === 'view-hours') {
      if (viewHours) viewHours.classList.add('active');
      if (topBtnHours) topBtnHours.classList.add('active');
      if (capsuleBtnHours) capsuleBtnHours.classList.add('active');
      renderHoursAndRush();
    } else if (targetView === 'view-offers') {
      if (viewOffers) viewOffers.classList.add('active');
      if (capsuleBtnOffers) capsuleBtnOffers.classList.add('active');
      renderOffers();
    } else if (targetView === 'view-delivery') {
      if (viewDelivery) viewDelivery.classList.add('active');
      if (capsuleBtnDelivery) capsuleBtnDelivery.classList.add('active');
      renderDeliveryOptions();
    }

    if (recordStep && targetView !== 'view-orders') {
      backNav.pushStep('admin-view-' + targetView, () => switchView('view-orders', false));
    }

    try {
      sessionStorage.setItem('quickbite_admin_tab', targetView);
    } catch {}

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (topBtnMenu) topBtnMenu.addEventListener('click', () => switchView('view-menu'));
  if (topBtnOrders) topBtnOrders.addEventListener('click', () => switchView('view-orders'));
  if (topBtnHours) topBtnHours.addEventListener('click', () => switchView('view-hours'));

  document.querySelectorAll('.capsule-nav-btn[data-target]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-target');
      if (target) switchView(target);
    });
  });

  // Update order count badges (strictly active orders in kitchen pipeline)
  function updateOrderBadges() {
    const orders = dataService.getOrders();
    const activeCount = orders.filter(o => ['pending', 'accepted', 'cooking', 'ready_for_pickup', 'on_the_way'].includes(o.status)).length;
    if (topOrderCounter) topOrderCounter.textContent = activeCount;
    if (capsuleOrderBadge) capsuleOrderBadge.textContent = activeCount;
    updateAppBadge(activeCount);
  }

  // ========================================================
  // 2. CATEGORY MANAGEMENT
  // ========================================================
  function renderCategories() {
    const categories = dataService.getCategories();
    const dishes = dataService.getDishes();

    if (categoriesCountBadge) {
      categoriesCountBadge.textContent = `${categories.length} Categories`;
    }

    // Render category cards (touch to open category)
    if (categoriesGrid) {
      const regularCardsHtml = categories.map(cat => {
        const dishCount = dishes.filter(d => d.category === cat.slug || d.category === cat.id).length;
        const safeName = escapeHtml(cat.name);
        const safeEmoji = escapeHtml(cat.emoji || '🍽️');
        const safeId = escapeHtml(cat.id);
        const safeSlug = escapeHtml(cat.slug);
        const rawImg = (cat.image || '').trim();
        const resolvedImg = (typeof dataService.sanitizeCategoryImageUrl === 'function')
          ? dataService.sanitizeCategoryImageUrl(rawImg)
          : ((rawImg.startsWith('categories/') || rawImg.startsWith('dishes/'))
            ? `/api/r2-image?key=${encodeURIComponent(rawImg)}`
            : rawImg);
        const safeImg = escapeHtml(resolvedImg);
        const thumbHtml = resolvedImg
          ? `<div class="cat-emoji-badge cat-admin-thumb" style="width: 44px; height: 44px; min-width: 44px; border-radius: 50%; overflow: hidden; border: 2.2px solid #EA580C; padding: 0; display: flex; align-items: center; justify-content: center; background: #F3F4F6;">
               <img src="${safeImg}" alt="${safeName}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
               <span style="display: none; width: 100%; height: 100%; align-items: center; justify-content: center; font-size: 1.4rem;">${safeEmoji}</span>
             </div>`
          : `<div class="cat-emoji-badge">${safeEmoji}</div>`;

        return `
          <div class="category-admin-card" data-id="${safeId}" data-slug="${safeSlug}" title="Touch or click to open ${safeName}">
            <div class="cat-card-top">
              ${thumbHtml}
              <div class="cat-action-btns">
                <button class="btn-icon-admin edit-cat-btn" data-id="${safeId}" title="Edit Category" aria-label="Edit Category">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                  </svg>
                </button>
                <button class="btn-icon-admin delete delete-cat-btn" data-id="${safeId}" title="Delete Category" aria-label="Delete Category">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                  </svg>
                </button>
              </div>
            </div>
            <div class="cat-card-info">
              <h3 class="cat-info-title">${safeName}</h3>
              <span class="cat-info-count">${dishCount} dish${dishCount === 1 ? '' : 'es'}</span>
            </div>
            <div class="cat-card-touch-indicator">
              <span>
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin-right:4px;">
                  <path d="M18 2v8"></path>
                  <path d="M14 2v4a4 4 0 0 0 8 0V2"></path>
                  <path d="M2 2v20"></path>
                  <path d="M2 2a4 4 0 0 1 4 4v4H2"></path>
                </svg>
                Open Category
              </span>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"></line>
                <polyline points="12 5 19 12 12 19"></polyline>
              </svg>
            </div>
          </div>
        `;
      }).join('');

      categoriesGrid.innerHTML = regularCardsHtml;

      // Attach Category Event Listeners
      categoriesGrid.querySelectorAll('.edit-cat-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = btn.getAttribute('data-id');
          openEditCategoryModal(id);
        });
      });

      categoriesGrid.querySelectorAll('.delete-cat-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = btn.getAttribute('data-id');
          deleteCategoryPrompt(id);
        });
      });

      // Touching/clicking category card opens it to add/remove food inside
      categoriesGrid.querySelectorAll('.category-admin-card').forEach(card => {
        card.addEventListener('click', () => {
          const slug = card.getAttribute('data-slug');
          if (slug) {
            openCategoryDetail(slug);
          }
        });
      });
    }

    // Update category dropdown in Add/Edit Dish Modal
    updateCategoryDropdowns(categories);
  }

  function updateCategoryDropdowns(categories) {
    if (dishCategorySelect) {
      dishCategorySelect.innerHTML = categories.map(c => `
        <option value="${escapeHtml(c.slug)}">${escapeHtml(c.emoji)} ${escapeHtml(c.name)}</option>
      `).join('');
    }
  }

  function updateCatModalImagePreview(url, emoji) {
    if (!catImagePreview || !catImageFallbackEmoji) return;
    const cleanUrl = (url || '').trim();
    if (cleanUrl) {
      catImagePreview.src = cleanUrl;
      catImagePreview.style.display = 'block';
      catImageFallbackEmoji.style.display = 'none';
      catImagePreview.onerror = () => {
        catImagePreview.style.display = 'none';
        catImageFallbackEmoji.style.display = 'flex';
      };
    } else {
      catImagePreview.style.display = 'none';
      catImageFallbackEmoji.style.display = 'flex';
      catImageFallbackEmoji.textContent = emoji || (catEmojiInput ? catEmojiInput.value.trim() : '🍗') || '🍗';
    }
  }

  function openAddCategoryModal() {
    catNameInput.disabled = false;
    catModalTitle.textContent = 'Add New Category';
    catEditId.value = '';
    catNameInput.value = '';
    catEmojiInput.value = '🍗';
    if (catImageInput) catImageInput.value = '';
    if (catUploadStatus) catUploadStatus.style.display = 'none';
    updateCatModalImagePreview('', '🍗');
    modalCategoryBackdrop.classList.add('open');
    backNav.pushStep('modal-category', () => modalCategoryBackdrop.classList.remove('open'));
    catNameInput.focus();
  }

  function openEditCategoryModal(id) {
    if (id === 'all' || id === 'cat-all') {
      const allImg = (typeof dataService.getAllCategoryImage === 'function')
        ? dataService.getAllCategoryImage()
        : '/api/r2-image?key=categories%2Fcategory_1792937665372_e003a872-4cf0-4cde-8519-8970b8b3f8dd-removebg-preview.png';
      catModalTitle.textContent = 'Edit "All" Category Photo';
      catEditId.value = 'all';
      catNameInput.value = 'All Categories (Storefront Circle)';
      catNameInput.disabled = true;
      catEmojiInput.value = '🍽️';
      if (catImageInput) catImageInput.value = allImg;
      if (catUploadStatus) catUploadStatus.style.display = 'none';
      updateCatModalImagePreview(allImg, '🍽️');
      modalCategoryBackdrop.classList.add('open');
      backNav.pushStep('modal-category', () => modalCategoryBackdrop.classList.remove('open'));
      return;
    }

    catNameInput.disabled = false;
    const categories = dataService.getCategories();
    const cat = categories.find(c => c.id === id || c.slug === id);
    if (!cat) return;

    catModalTitle.textContent = 'Edit Category';
    catEditId.value = cat.id;
    catNameInput.value = cat.name;
    catEmojiInput.value = cat.emoji || '🍽️';
    if (catImageInput) catImageInput.value = cat.image || '';
    if (catUploadStatus) catUploadStatus.style.display = 'none';
    updateCatModalImagePreview(cat.image || '', cat.emoji || '🍽️');
    modalCategoryBackdrop.classList.add('open');
    backNav.pushStep('modal-category', () => modalCategoryBackdrop.classList.remove('open'));
    catNameInput.focus();
  }

  function closeCategoryModal() {
    catNameInput.disabled = false;
    modalCategoryBackdrop.classList.remove('open');
    backNav.removeStep('modal-category');
  }

  async function deleteCategoryPrompt(id) {
    if (id === 'all' || id === 'cat-all') {
      showToast('The "All" category is the storefront master filter and cannot be deleted.', 'info');
      return;
    }
    const categories = dataService.getCategories();
    const cat = categories.find(c => c.id === id);
    if (!cat) return;

    const dishes = dataService.getDishes();
    const dishCount = dishes.filter(d => d && (d.category === cat.slug || d.category === cat.id)).length;
    const confirmMsg = dishCount > 0
      ? `Category "${cat.name}" contains ${dishCount} food dish(es). Deleting this category will also remove all ${dishCount} dish(es) inside it. Are you sure you want to delete it?`
      : `Are you sure you want to delete category "${cat.name}"?`;

    if (confirm(confirmMsg)) {
      try {
        await dataService.deleteCategory(id);
        renderCategories();
        renderDishes();
        showToast(`Category "${cat.name}" removed!`, 'info');
      } catch (err) {
        showToast(`Error deleting category: ${err?.message || err}`, 'error');
      }
    }
  }

  btnOpenAddCat.addEventListener('click', openAddCategoryModal);
  if (btnOpenEditAllCat) {
    btnOpenEditAllCat.addEventListener('click', () => openEditCategoryModal('all'));
  }
  modalCatClose.addEventListener('click', closeCategoryModal);
  btnCancelCat.addEventListener('click', closeCategoryModal);
  modalCategoryBackdrop.addEventListener('click', (e) => {
    if (e.target === modalCategoryBackdrop) closeCategoryModal();
  });

  // Quick emoji clickers in category modal
  document.querySelectorAll('.btn-quick-emoji').forEach(btn => {
    btn.addEventListener('click', () => {
      catEmojiInput.value = btn.textContent.trim();
      if (!catImageInput || !catImageInput.value.trim()) {
        updateCatModalImagePreview('', catEmojiInput.value.trim());
      }
    });
  });

  if (catEmojiInput) {
    catEmojiInput.addEventListener('input', () => {
      if (!catImageInput || !catImageInput.value.trim()) {
        updateCatModalImagePreview('', catEmojiInput.value.trim());
      }
    });
  }

  if (catImageInput) {
    catImageInput.addEventListener('input', () => {
      updateCatModalImagePreview(catImageInput.value.trim());
    });
  }

  // Upload category image from device / mobile
  if (catFileUpload) {
    catFileUpload.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      isUploadingCatPhoto = true;
      if (btnSaveCat) btnSaveCat.disabled = true;

      if (catUploadStatus) {
        catUploadStatus.style.display = 'inline-flex';
        catUploadStatus.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Processing category photo...`;
      }

      try {
        const reader = new FileReader();
        reader.onload = async (readEvt) => {
          const dataUrl = readEvt.target.result;
          // Set visual preview immediately
          updateCatModalImagePreview(dataUrl);
          if (catImageInput) catImageInput.value = dataUrl;

          // Upload directly to Cloudflare R2
          try {
            if (typeof cloudflareR2Service !== 'undefined' && cloudflareR2Service && cloudflareR2Service.uploadImage) {
              if (catUploadStatus) {
                catUploadStatus.innerHTML = `<i class="fa-solid fa-cloud-arrow-up fa-bounce"></i> Uploading photo...`;
              }
              const catFileName = `category_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
              const r2Res = await cloudflareR2Service.uploadImage(file, catFileName, 'categories');
              if (r2Res && r2Res.success && (r2Res.key || r2Res.url)) {
                const finalImg = r2Res.key
                  ? `/api/r2-image?key=${encodeURIComponent(r2Res.key)}`
                  : (typeof dataService.sanitizeCategoryImageUrl === 'function'
                    ? dataService.sanitizeCategoryImageUrl(r2Res.url)
                    : r2Res.url);

                if (catImageInput) catImageInput.value = finalImg;
                updateCatModalImagePreview(finalImg);

                // If editing an existing category, persist immediately so image is saved right away
                const activeEditId = catEditId ? catEditId.value : null;
                if (activeEditId === 'all' || activeEditId === 'cat-all') {
                  const saveRes = (typeof dataService.setAllCategoryImage === 'function')
                    ? await dataService.setAllCategoryImage(finalImg)
                    : await dataService.saveCategoryImage('all', finalImg);
                  if (saveRes?._localOnly) {
                    showToast('⚠️ "All" category photo saved locally (Cloud sync requires active Staff session).', 'warning');
                  } else {
                    showToast('✓ "All" category photo uploaded and saved!', 'success');
                  }
                } else if (activeEditId) {
                  const saveRes = await dataService.saveCategoryImage(activeEditId, finalImg);
                  const cats = dataService.getCategories();
                  const matchedCat = cats.find(c => c.id === activeEditId || c.slug === activeEditId);
                  if (matchedCat) {
                    if (matchedCat.id) await dataService.saveCategoryImage(matchedCat.id, finalImg);
                    if (matchedCat.slug) await dataService.saveCategoryImage(matchedCat.slug, finalImg);
                    await dataService.updateCategory(activeEditId, { image: finalImg });
                  }
                  if (saveRes?._localOnly) {
                    showToast('⚠️ Category photo saved locally (Cloud sync requires active Staff session).', 'warning');
                  } else {
                    showToast('✓ Category photo uploaded and saved!', 'success');
                  }
                } else {
                  showToast('✓ Category photo uploaded! Click Save Category to publish.', 'success');
                }
              } else {
                showToast('⚠️ Could not save photo to cloud. Please retry.', 'error');
              }
            }
          } catch (r2Err) {
            console.warn('[CategoryUpload] R2 storage note:', r2Err);
            showToast('⚠️ Photo upload error. Please retry.', 'error');
          } finally {
            if (catUploadStatus) catUploadStatus.style.display = 'none';
            isUploadingCatPhoto = false;
            if (btnSaveCat) btnSaveCat.disabled = false;
            if (catFileUpload) catFileUpload.value = '';
          }
        };
        reader.readAsDataURL(file);
      } catch (err) {
        console.error('Category photo upload failed:', err);
        if (catUploadStatus) catUploadStatus.style.display = 'none';
        isUploadingCatPhoto = false;
        if (btnSaveCat) btnSaveCat.disabled = false;
        if (catFileUpload) catFileUpload.value = '';
        showToast('Could not load image file', 'error');
      }
    });
  }

  formCategory.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmittingCat) return;
    if (isUploadingCatPhoto) {
      showToast('⚠️ Category photo is still uploading. Please wait a moment...', 'warning');
      return;
    }

    const name = catNameInput.value.trim();
    if (!name) {
      showToast('Please enter a category name.', 'warning');
      catNameInput.focus();
      return;
    }

    isSubmittingCat = true;
    if (btnSaveCat) btnSaveCat.disabled = true;

    try {
      const emoji = catEmojiInput.value.trim() || '🍽️';
      let image = catImageInput ? catImageInput.value.trim() : '';
      const editId = catEditId.value;

      // If image is a Base64 data URI, automatically upload to Cloudflare R2 first
      if (image && image.startsWith('data:image/')) {
        try {
          if (catUploadStatus) {
            catUploadStatus.style.display = 'inline-flex';
            catUploadStatus.innerHTML = `<i class="fa-solid fa-cloud-arrow-up fa-bounce"></i> Saving photo...`;
          }
          const fileName = `category_${editId || 'custom'}_${Date.now()}.png`;
          const r2Res = await cloudflareR2Service.uploadImage(image, fileName, 'categories');
          if (r2Res && r2Res.success && (r2Res.key || r2Res.url)) {
            image = r2Res.key
              ? `/api/r2-image?key=${encodeURIComponent(r2Res.key)}`
              : r2Res.url;
            if (catImageInput) catImageInput.value = image;
          }
        } catch (err) {
          console.warn('[CategoryUpload] Base64 R2 upload fallback warning:', err);
        } finally {
          if (catUploadStatus) catUploadStatus.style.display = 'none';
        }
      }

      if (editId === 'all' || editId === 'cat-all') {
        const saveRes = (typeof dataService.setAllCategoryImage === 'function')
          ? await dataService.setAllCategoryImage(image)
          : await dataService.saveCategoryImage('all', image);
        if (saveRes?._localOnly) {
          showToast('⚠️ "All" category photo saved locally (Cloud sync requires Staff session).', 'warning');
        } else {
          showToast('"All" category photo updated successfully!', 'success');
        }
      } else if (editId) {
        await dataService.updateCategory(editId, { name, emoji, image });
        if (image) {
          await dataService.saveCategoryImage(editId, image);
          const cats = dataService.getCategories();
          const matchedCat = cats.find(c => c.id === editId || c.slug === editId);
          if (matchedCat) {
            if (matchedCat.id) await dataService.saveCategoryImage(matchedCat.id, image);
            if (matchedCat.slug) await dataService.saveCategoryImage(matchedCat.slug, image);
          }
        }
        showToast(`Category updated to "${name}"!`, 'success');
      } else {
        await dataService.addCategory({ name, emoji, image });
        showToast(`Category "${name}" created!`, 'success');
      }

      closeCategoryModal();
      renderCategories();
      renderDishes();
    } catch (err) {
      console.error('[Category Save Error]:', err);
      showToast(`Error saving category: ${err?.message || err}`, 'error');
    } finally {
      isSubmittingCat = false;
      if (btnSaveCat) btnSaveCat.disabled = false;
    }
  });

  // ========================================================
  // 3. CATEGORY DETAIL VIEW & FOOD DISHES MANAGEMENT
  // ========================================================
  function openCategoryDetail(categorySlug) {
    currentOpenedCategorySlug = categorySlug;
    catDishSearchQuery = '';
    if (catDishSearchInput) catDishSearchInput.value = '';
    if (btnClearCatDishSearch) btnClearCatDishSearch.style.display = 'none';

    if (categoriesOverviewPanel) categoriesOverviewPanel.style.display = 'none';
    if (categoryDetailPanel) {
      categoryDetailPanel.style.display = 'block';
      categoryDetailPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    renderCategoryDishes();
    backNav.pushStep('category-detail', () => closeCategoryDetailInternal());
  }

  function closeCategoryDetailInternal() {
    currentOpenedCategorySlug = null;
    catDishSearchQuery = '';
    if (categoryDetailPanel) categoryDetailPanel.style.display = 'none';
    if (categoriesOverviewPanel) categoriesOverviewPanel.style.display = 'block';
    renderCategories();
  }

  function closeCategoryDetail() {
    closeCategoryDetailInternal();
    backNav.removeStep('category-detail');
  }

  function renderCategoryDishes() {
    if (!currentOpenedCategorySlug) return;
    const categories = dataService.getCategories();
    const cat = categories.find(c => c.slug === currentOpenedCategorySlug || c.id === currentOpenedCategorySlug);
    if (!cat) {
      closeCategoryDetail();
      return;
    }

    const allDishes = dataService.getDishes();
    const categoryDishes = allDishes.filter(d => d.category === cat.slug || d.category === cat.id);

    // Update Category Detail Header
    if (catDetailEmoji) catDetailEmoji.textContent = cat.emoji || '🍽️';
    if (catDetailName) catDetailName.textContent = cat.name;
    if (catDetailCount) catDetailCount.textContent = `${categoryDishes.length} Dish${categoryDishes.length === 1 ? '' : 'es'}`;

    // Filter by search query within this category
    let filteredDishes = categoryDishes;
    if (catDishSearchQuery) {
      const tokens = catDishSearchQuery.toLowerCase().split(/\s+/).filter(Boolean);
      filteredDishes = filteredDishes.filter(d => {
        const fullText = `${d.name || ''} ${d.desc || ''} ${d.badge || ''} ${d.diet || ''}`.toLowerCase();
        return tokens.every(token => fullText.includes(token));
      });
    }

    if (!categoryDishesGrid) return;

    if (filteredDishes.length === 0) {
      categoryDishesGrid.innerHTML = '';
      if (catDishesEmptyState) {
        catDishesEmptyState.style.display = 'block';
        if (catEmptyTitle) {
          catEmptyTitle.textContent = catDishSearchQuery
            ? `No dishes matching "${catDishSearchQuery}"`
            : `No dishes in "${cat.name}" yet`;
        }
      }
      return;
    }

    if (catDishesEmptyState) catDishesEmptyState.style.display = 'none';

    categoryDishesGrid.innerHTML = filteredDishes.map(dish => {
      const isStock = dish.inStock !== false;
      const ratingVal = dish.rating ? dish.rating.split(' ')[0].replace(/[^0-9.]/g, '') : '4.9';
      const safeId = escapeHtml(dish.id);
      const safeName = escapeHtml(dish.name);
      const safeImage = sanitizeUrl(dish.image, '/images/crispy-chicken.jpg');
      const safeBadge = dish.badge ? escapeHtml(dish.badge) : '';
      const safePrice = Math.round(parseFloat(dish.price) || 0);

      return `
        <article class="dish-admin-card app-style-card ${!isStock ? 'sold-out' : ''}" data-id="${safeId}">
          <div class="dish-card-inner">
            <img src="${safeImage}" alt="${safeName}" class="dish-card-img img-is-ready" loading="lazy" onload="this.classList.add('img-is-ready')" onerror="this.src='/images/crispy-chicken.jpg'; this.classList.add('img-is-ready');">
            <div class="dish-overlay"></div>

            <!-- Top Bar: Left = 1-Tap Stock Toggle, Right = Edit & Delete Buttons (Zero Overlap) -->
            <div class="dish-card-top-bar">
              <button type="button" 
                      class="btn-stock-toggle ${isStock ? 'in-stock' : 'out-of-stock'}" 
                      data-id="${safeId}" 
                      title="1-Tap: Click to mark ${isStock ? 'Out of Stock' : 'In Stock'}">
                <span class="stock-toggle-dot"></span>
                <span class="stock-toggle-label">${isStock ? 'In Stock' : 'Out of Stock'}</span>
              </button>

              <div class="dish-card-top-actions">
                <button type="button" class="btn-dish-card-action btn-dish-card-edit btn-manage-dish-trigger" data-id="${safeId}" title="Edit ${safeName}" aria-label="Edit dish">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                  </svg>
                </button>
                <button type="button" class="btn-dish-card-action btn-dish-card-delete btn-quick-remove-dish" data-id="${safeId}" title="Remove ${safeName} from category" aria-label="Delete dish">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                  </svg>
                </button>
              </div>
            </div>

            <!-- Bottom Content Info -->
            <div class="dish-bottom-info">
              ${['dish-chicken-3pcs', 'dish-pizza-chicken', 'dish-burger-crispy'].includes(dish.id) ? '<div class="dish-category-badge-chip hero-featured-chip" style="background:#FF5A26;color:#FFFFFF;font-weight:700;margin-bottom:4px;border:none;"><i class="fa-solid fa-star"></i> Home Hero Bubble</div>' : ''}
              ${safeBadge ? `<div class="dish-category-badge-chip">${safeBadge}</div>` : ''}
              ${(dish.timeRestricted && dish.availableFrom && dish.availableTo) ? `<div class="dish-schedule-badge time-badge"><i class="fa-regular fa-clock"></i> ${formatTime12h(dish.availableFrom)} - ${formatTime12h(dish.availableTo)}</div>` : ''}
              ${(Array.isArray(dish.availableDays) && dish.availableDays.length < 7) ? `<div class="dish-schedule-badge days-badge"><i class="fa-regular fa-calendar-day"></i> ${dish.availableDays.map(d => d.slice(0,3).toUpperCase()).join(', ')}</div>` : ''}
              <h3 class="dish-title" title="${safeName}">${safeName}</h3>
              <div class="dish-meta-sub">
                <span class="meta-price">₹${safePrice}</span>
                ${!isStock ? '<span class="meta-dot">•</span><span class="meta-sold-tag">Sold Out</span>' : ''}
              </div>
            </div>
          </div>
        </article>
      `;
    }).join('');

    // Attach Dish Event Listeners
    categoryDishesGrid.querySelectorAll('.dish-admin-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-id');
        openEditDishModal(id);
      });
    });

    // 1-Tap Quick In-Stock / Out-of-Stock Toggle
    categoryDishesGrid.querySelectorAll('.btn-stock-toggle').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        if (!id) return;
        btn.disabled = true;
        try {
          const updatedDish = await dataService.toggleDishStock(id);
          if (updatedDish) {
            const isNowInStock = updatedDish.inStock !== false;
            showToast(
              isNowInStock 
                ? `✅ "${updatedDish.name}" is now Back in Stock!` 
                : `⚠️ "${updatedDish.name}" marked Out of Stock!`,
              isNowInStock ? 'success' : 'info'
            );
            renderCategoryDishes();
            if (typeof renderGlobalDishes === 'function') renderGlobalDishes();
            renderCategories();
          }
        } catch (err) {
          showToast(`Error toggling stock: ${err?.message || err}`, 'error');
        } finally {
          btn.disabled = false;
        }
      });
    });

    categoryDishesGrid.querySelectorAll('.btn-manage-dish-trigger').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        if (id) openEditDishModal(id);
      });
    });

    categoryDishesGrid.querySelectorAll('.btn-quick-remove-dish').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        if (id) deleteDishPrompt(id);
      });
    });
  }

  // Safe wrapper for global render calls
  function renderDishes() {
    if (currentOpenedCategorySlug) {
      renderCategoryDishes();
    }
    if (globalDishSearchQuery && typeof renderGlobalDishes === 'function') {
      renderGlobalDishes();
    }
  }

  // Preset & Uploaded gallery images in dish modal
  async function renderPresetGalleryStrip(selectedImg) {
    const uploaded = (typeof dataService.getUploadedImages === 'function') ? dataService.getUploadedImages() : [];
    let images = [];

    // 1. All Custom Uploaded Photos (Persistently remembered)
    if (Array.isArray(uploaded) && uploaded.length > 0) {
      uploaded.forEach(u => {
        images.push({
          name: u.name || 'Uploaded Photo',
          path: u.url,
          isUploaded: true,
          uploadId: u.id
        });
      });
    }

    // 2. If the current selected image is custom/uploaded and not yet in images list, add it first!
    if (selectedImg && !images.some(img => img.path === selectedImg)) {
      if (selectedImg.startsWith('data:') || selectedImg.startsWith('blob:') || (selectedImg.startsWith('http') && !selectedImg.includes('unsplash'))) {
        images.unshift({
          name: 'Current Dish Photo',
          path: selectedImg,
          isUploaded: true,
          uploadId: 'current-dish-img'
        });
      }
    }

    // 3. Cloudflare R2 bucket images
    try {
      const r2Files = await cloudflareR2Service.listImages();
      if (r2Files && r2Files.length > 0) {
        const r2Items = r2Files.map(rf => ({
          name: `☁️ ${rf.name}`,
          path: rf.url || rf.directUrl,
          r2Key: rf.key,
          isUploaded: true
        }));
        images = [...r2Items, ...images];
      }
    } catch (e) {
      console.warn('[Admin] Cloudflare R2 list skipped:', e);
    }

    // 4. Restaurant Presets
    images = [...images, ...PRESET_FOOD_IMAGES];

    presetImagesStrip.innerHTML = images.map(p => {
      const isSel = selectedImg === p.path;
      const safePath = sanitizeUrl(p.path, '/images/crispy-chicken.jpg');
      const safeName = escapeHtml(p.name || 'Dish Photo');
      const safeR2 = escapeHtml(p.r2Key || '');
      const safeUpId = escapeHtml(p.uploadId || '');
      return `
        <button type="button" class="preset-thumb-btn ${isSel ? 'active' : ''} ${p.isUploaded ? 'uploaded-thumb' : ''}" data-path="${safePath}" data-r2="${safeR2}" data-upload-id="${safeUpId}" title="${safeName}">
          <img src="${safePath}" alt="${safeName}" onerror="this.src='/images/crispy-chicken.jpg'">
          ${p.isUploaded ? '<span class="thumb-badge-up" title="Uploaded Photo"><i class="fa-solid fa-camera"></i></span>' : ''}
        </button>
      `;
    }).join('');

    presetImagesStrip.querySelectorAll('.preset-thumb-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const path = btn.getAttribute('data-path');
        const r2Key = btn.getAttribute('data-r2');
        const uploadId = btn.getAttribute('data-upload-id');
        dishImageUrl.value = path;
        dishPreviewImg.src = path;
        currentDishGdriveFileId = r2Key || '';
        fileChosenText.textContent = uploadId ? 'Selected from uploaded photos' : (r2Key ? 'Selected from photo gallery' : 'Selected from gallery');
        fileChosenText.style.display = 'inline';
        renderPresetGalleryStrip(path);
      });
    });
  }

  function setModalDishStock(isInStock) {
    if (modalDishStockBtn) {
      modalDishStockBtn.className = 'btn-modal-stock-pill ' + (isInStock ? 'in-stock' : 'sold-out');
    }
    if (modalDishStockDot) {
      modalDishStockDot.style.background = isInStock ? '#10B981' : '#EF4444';
    }
    if (modalDishStockLabel) {
      modalDishStockLabel.textContent = isInStock ? 'In Stock (Accepting Orders)' : 'Sold Out / Unavailable';
    }
    if (dishStockHidden) {
      dishStockHidden.value = isInStock ? 'true' : 'false';
    }
  }

  if (modalDishStockBtn) {
    modalDishStockBtn.addEventListener('click', () => {
      const isCurrentlyStock = dishStockHidden ? dishStockHidden.value === 'true' : true;
      setModalDishStock(!isCurrentlyStock);
    });
  }

  
  // Dish Schedule & Availability Controls
  const dishDaysPicker = document.getElementById('dish-days-picker');
  const dishTimeRestricted = document.getElementById('input-dish-time-restricted');
  const dishTimeContainer = document.getElementById('dish-time-inputs-container');
  const dishAvailableFrom = document.getElementById('input-dish-available-from');
  const dishAvailableTo = document.getElementById('input-dish-available-to');
  const dishScheduleSummary = document.getElementById('admin-dish-schedule-summary');

  function getSelectedDishDays() {
    if (!dishDaysPicker) return ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const activePills = dishDaysPicker.querySelectorAll('.dish-day-pill.active');
    const days = Array.from(activePills).map(p => p.getAttribute('data-day')).filter(Boolean);
    return days.length > 0 ? days : ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  }

  function setSelectedDishDays(days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
    if (!dishDaysPicker) return;
    const lowerDays = (Array.isArray(days) ? days : ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']).map(d => String(d).toLowerCase().trim());
    dishDaysPicker.querySelectorAll('.dish-day-pill').forEach(pill => {
      const day = pill.getAttribute('data-day');
      if (lowerDays.includes(day)) {
        pill.classList.add('active');
      } else {
        pill.classList.remove('active');
      }
    });
    updateDishScheduleSummary();
  }

  function updateDishScheduleSummary() {
    if (!dishScheduleSummary) return;
    const selectedDays = getSelectedDishDays();
    const isRestricted = dishTimeRestricted ? dishTimeRestricted.checked : false;
    const fromVal = dishAvailableFrom ? dishAvailableFrom.value : '12:00';
    const toVal = dishAvailableTo ? dishAvailableTo.value : '23:30';

    let dayText = 'All 7 Days';
    if (selectedDays.length === 7) {
      dayText = 'All 7 Days';
    } else if (selectedDays.length === 5 && !selectedDays.includes('sat') && !selectedDays.includes('sun')) {
      dayText = 'Mon - Fri (Weekdays)';
    } else if (selectedDays.length === 2 && selectedDays.includes('sat') && selectedDays.includes('sun')) {
      dayText = 'Sat - Sun (Weekends)';
    } else {
      const labels = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
      dayText = selectedDays.map(d => labels[d] || d).join(', ');
    }

    if (isRestricted && fromVal && toVal) {
      dishScheduleSummary.textContent = `${dayText} · ${formatTime12h(fromVal)} - ${formatTime12h(toVal)}`;
      dishScheduleSummary.style.background = '#FEF3C7';
      dishScheduleSummary.style.color = '#92400E';
      dishScheduleSummary.style.borderColor = '#FDE68A';
    } else {
      dishScheduleSummary.textContent = `${dayText} · All Day`;
      dishScheduleSummary.style.background = '#D1FAE5';
      dishScheduleSummary.style.color = '#065F46';
      dishScheduleSummary.style.borderColor = '#A7F3D0';
    }
  }

  // Set up click handlers for Day Pills & Shortcuts
  if (dishDaysPicker) {
    dishDaysPicker.addEventListener('click', (e) => {
      const pill = e.target.closest('.dish-day-pill');
      if (!pill) return;
      const wasActive = pill.classList.contains('active');
      const activeCount = dishDaysPicker.querySelectorAll('.dish-day-pill.active').length;
      if (wasActive && activeCount === 1) {
        showToast('At least 1 day must remain selected for dish availability.', 'info');
        return;
      }
      pill.classList.toggle('active');
      updateDishScheduleSummary();
    });
  }

  document.querySelectorAll('.btn-day-quick').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.getAttribute('data-days');
      if (type === 'all') {
        setSelectedDishDays(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
      } else if (type === 'weekdays') {
        setSelectedDishDays(['mon', 'tue', 'wed', 'thu', 'fri']);
      } else if (type === 'weekends') {
        setSelectedDishDays(['sat', 'sun']);
      }
    });
  });

  if (dishTimeRestricted) {
    dishTimeRestricted.addEventListener('change', () => {
      if (dishTimeContainer) {
        dishTimeContainer.style.display = dishTimeRestricted.checked ? 'block' : 'none';
      }
      updateDishScheduleSummary();
    });

    const scheduleTimeToggleRow = document.querySelector('.schedule-time-toggle-row');
    if (scheduleTimeToggleRow) {
      scheduleTimeToggleRow.addEventListener('click', (e) => {
        if (e.target === dishTimeRestricted || e.target.closest('.admin-switch')) return;
        dishTimeRestricted.checked = !dishTimeRestricted.checked;
        dishTimeRestricted.dispatchEvent(new Event('change'));
      });
    }
  }

  if (dishAvailableFrom) dishAvailableFrom.addEventListener('input', updateDishScheduleSummary);
  if (dishAvailableTo) dishAvailableTo.addEventListener('input', updateDishScheduleSummary);

  document.querySelectorAll('.btn-time-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const from = btn.getAttribute('data-from');
      const to = btn.getAttribute('data-to');
      if (dishAvailableFrom) dishAvailableFrom.value = from;
      if (dishAvailableTo) dishAvailableTo.value = to;
      updateDishScheduleSummary();
    });
  });

  function openAddDishModal(defaultCategorySlug = '') {
    dishModalTitle.textContent = 'Add New Food Dish';
    dishEditId.value = '';
    dishNameInput.value = '';
    currentDishGdriveFileId = '';
    
    if (defaultCategorySlug) {
      dishCategorySelect.value = defaultCategorySlug;
    } else if (activeCategoryFilter !== 'all') {
      dishCategorySelect.value = activeCategoryFilter;
    }

    dishPriceInput.value = '199';
    dishBadgeInput.value = '';
    if (dishBadgeCustomInput) {
      dishBadgeCustomInput.style.display = 'none';
      dishBadgeCustomInput.value = '';
    }
    dishTimeInput.value = '12 - 15 mins';
    dishCaloriesInput.value = '560 kcal';
    dishDietInput.value = 'Fresh Daily';
    dishDescInput.value = '';

    setModalDishStock(true);
    if (btnModalDeleteDish) btnModalDeleteDish.style.display = 'none';
    setSelectedDishDays(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
    if (dishTimeRestricted) dishTimeRestricted.checked = false;
    if (dishTimeContainer) dishTimeContainer.style.display = 'none';
    if (dishAvailableFrom) dishAvailableFrom.value = '12:00';
    if (dishAvailableTo) dishAvailableTo.value = '23:30';
    updateDishScheduleSummary();

    const defaultImg = '/images/crispy-chicken.jpg';
    dishImageUrl.value = defaultImg;
    dishPreviewImg.src = defaultImg;
    fileChosenText.textContent = 'No custom file chosen';

    renderPresetGalleryStrip(defaultImg);
    modalDishBackdrop.classList.add('open');
    backNav.pushStep('modal-dish', () => modalDishBackdrop.classList.remove('open'));
    dishNameInput.focus();
  }

  function openEditDishModal(id) {
    const dishes = dataService.getDishes();
    const dish = dishes.find(d => d.id === id);
    if (!dish) return;

    dishModalTitle.textContent = 'Edit Food Dish';
    dishEditId.value = dish.id;
    dishNameInput.value = dish.name;

    const categories = dataService.getCategories();
    const matchedCategory = categories.find(c => c.slug === dish.category || c.id === dish.category);
    if (dishCategorySelect) {
      dishCategorySelect.value = matchedCategory ? (matchedCategory.slug || matchedCategory.id) : dish.category;
    }

    dishPriceInput.value = dish.price;

    const rawBadge = (dish.badge || '').trim();
    const hasOption = Array.from(dishBadgeInput.options).some(o => o.value === rawBadge);

    if (!rawBadge) {
      dishBadgeInput.value = '';
      if (dishBadgeCustomInput) {
        dishBadgeCustomInput.style.display = 'none';
        dishBadgeCustomInput.value = '';
      }
    } else if (hasOption) {
      dishBadgeInput.value = rawBadge;
      if (dishBadgeCustomInput) {
        dishBadgeCustomInput.style.display = 'none';
        dishBadgeCustomInput.value = '';
      }
    } else {
      dishBadgeInput.value = 'Custom';
      if (dishBadgeCustomInput) {
        dishBadgeCustomInput.style.display = 'block';
        dishBadgeCustomInput.value = rawBadge;
      }
    }

    dishTimeInput.value = dish.time || '12 - 15 mins';
    dishCaloriesInput.value = dish.calories || '560 kcal';
    dishDietInput.value = dish.diet || 'Fresh Daily';
    dishDescInput.value = dish.desc || '';
    currentDishGdriveFileId = dish.r2Key || dish.gdriveFileId || '';
    setSelectedDishDays(dish.availableDays || ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
    if (dishTimeRestricted) dishTimeRestricted.checked = Boolean(dish.timeRestricted);
    if (dishTimeContainer) dishTimeContainer.style.display = dish.timeRestricted ? 'block' : 'none';
    if (dishAvailableFrom) dishAvailableFrom.value = dish.availableFrom || '12:00';
    if (dishAvailableTo) dishAvailableTo.value = dish.availableTo || '23:30';
    updateDishScheduleSummary();

    setModalDishStock(dish.inStock !== false);
    if (btnModalDeleteDish) btnModalDeleteDish.style.display = 'inline-flex';

    const currentImg = dish.image || '/api/r2-image?key=dishes/crispy-chicken.jpg';
    dishImageUrl.value = currentImg.startsWith('data:') ? '' : currentImg;
    dishPreviewImg.src = currentImg;
    fileChosenText.textContent = currentImg.startsWith('data:') ? 'Photo upload required' : 'Current active dish photo';

    renderPresetGalleryStrip(currentImg);
    modalDishBackdrop.classList.add('open');
    backNav.pushStep('modal-dish', () => modalDishBackdrop.classList.remove('open'));
    dishNameInput.focus();
  }

  function closeDishModal() {
    modalDishBackdrop.classList.remove('open');
    backNav.removeStep('modal-dish');
  }

  async function deleteDishPrompt(id) {
    const dishes = dataService.getDishes();
    const dish = dishes.find(d => d.id === id);
    if (!dish) return;

    if (confirm(`Are you sure you want to remove dish "${dish.name}" from your restaurant menu?`)) {
      if (dish.r2Key || dish.gdriveFileId) {
        try {
          await cloudflareR2Service.deleteImage(dish.r2Key || dish.gdriveFileId);
        } catch (e) {
          console.warn('[Cloudflare R2] delete error:', e);
        }
      }
      try {
        await dataService.deleteDish(id);
        renderDishes();
        renderCategories();
        showToast(`Dish "${dish.name}" removed from menu!`, 'info');
      } catch (err) {
        showToast(`Error deleting dish: ${err?.message || err}`, 'error');
      }
    }
  }

  if (btnModalDeleteDish) {
    btnModalDeleteDish.addEventListener('click', () => {
      const id = dishEditId.value;
      if (id) {
        deleteDishPrompt(id);
        closeDishModal();
      }
    });
  }

  if (btnCatAddDish) {
    btnCatAddDish.addEventListener('click', () => {
      openAddDishModal(currentOpenedCategorySlug || '');
    });
  }
  if (btnCatEmptyAddDish) {
    btnCatEmptyAddDish.addEventListener('click', () => {
      openAddDishModal(currentOpenedCategorySlug || '');
    });
  }
  if (btnBackToCategories) {
    btnBackToCategories.addEventListener('click', closeCategoryDetail);
  }
  if (catDishSearchInput) {
    catDishSearchInput.addEventListener('input', (e) => {
      catDishSearchQuery = e.target.value.toLowerCase().trim();
      if (btnClearCatDishSearch) {
        btnClearCatDishSearch.style.display = catDishSearchQuery.length > 0 ? 'block' : 'none';
      }
      renderCategoryDishes();
    });
  }
  if (btnClearCatDishSearch) {
    btnClearCatDishSearch.addEventListener('click', () => {
      catDishSearchInput.value = '';
      catDishSearchQuery = '';
      btnClearCatDishSearch.style.display = 'none';
      renderCategoryDishes();
    });
  }

  // Global Menu Search Controller
  function renderGlobalDishes() {
    if (!globalDishesResultsGrid || !globalDishSearchResultsPanel) return;
    if (!globalDishSearchQuery) {
      globalDishSearchResultsPanel.style.display = 'none';
      if (categoriesGridTitleBar) categoriesGridTitleBar.style.display = 'flex';
      if (categoriesAdminGrid) categoriesAdminGrid.style.display = 'grid';
      return;
    }

    const allDishes = dataService.getDishes() || [];
    const tokens = globalDishSearchQuery.toLowerCase().split(/\s+/).filter(Boolean);
    const matched = allDishes.filter(d => {
      const fullText = `${d.name || ''} ${d.categoryName || ''} ${d.category || ''} ${d.desc || ''} ${d.badge || ''}`.toLowerCase();
      return tokens.every(token => fullText.includes(token));
    });

    if (categoriesGridTitleBar) categoriesGridTitleBar.style.display = 'none';
    if (categoriesAdminGrid) categoriesAdminGrid.style.display = 'none';
    globalDishSearchResultsPanel.style.display = 'block';

    if (globalSearchCountBadge) {
      globalSearchCountBadge.textContent = `${matched.length} Dish${matched.length === 1 ? '' : 'es'}`;
    }

    if (matched.length === 0) {
      globalDishesResultsGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 32px 16px; background: #FFFFFF; border-radius: 14px; border: 1.5px dashed var(--admin-border);">
          <div style="font-size: 2rem; margin-bottom: 8px;">🔍</div>
          <h3 style="margin: 0 0 6px; font-size: 1.1rem; color: var(--admin-text-main);">No dishes match "${escapeHtml(globalDishSearchQuery)}"</h3>
          <p style="margin: 0; font-size: 0.88rem; color: var(--admin-text-muted);">Check your spelling or search by another keyword.</p>
        </div>
      `;
      return;
    }

    globalDishesResultsGrid.innerHTML = matched.map(dish => {
      const isStock = dish.inStock !== false;
      const safeId = escapeHtml(dish.id);
      const safeName = escapeHtml(dish.name);
      const safeImage = sanitizeUrl(dish.image, '/images/crispy-chicken.jpg');
      const safeBadge = dish.badge ? escapeHtml(dish.badge) : '';
      const safeCategory = escapeHtml(dish.categoryName || dish.category || 'Menu');
      const safePrice = Math.round(parseFloat(dish.price) || 0);

      return `
        <article class="dish-admin-card app-style-card ${!isStock ? 'sold-out' : ''}" data-id="${safeId}">
          <div class="dish-card-inner">
            <img src="${safeImage}" alt="${safeName}" class="dish-card-img img-is-ready" loading="lazy" onerror="this.src='/images/crispy-chicken.jpg';">
            <div class="dish-overlay"></div>

            <div class="dish-card-top-bar">
              <button type="button" 
                      class="btn-stock-toggle ${isStock ? 'in-stock' : 'out-of-stock'}" 
                      data-id="${safeId}" 
                      title="1-Tap: Click to mark ${isStock ? 'Out of Stock' : 'In Stock'}">
                <span class="stock-toggle-dot"></span>
                <span class="stock-toggle-label">${isStock ? 'In Stock' : 'Out of Stock'}</span>
              </button>

              <div class="dish-card-top-actions">
                <button type="button" class="btn-dish-card-action btn-dish-card-edit btn-manage-dish-trigger" data-id="${safeId}" title="Edit ${safeName}" aria-label="Edit dish">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                  </svg>
                </button>
                <button type="button" class="btn-dish-card-action btn-dish-card-delete btn-quick-remove-dish" data-id="${safeId}" title="Remove ${safeName} from menu" aria-label="Delete dish">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                  </svg>
                </button>
              </div>
            </div>

            <div class="dish-bottom-info">
              <div class="dish-category-badge-chip" style="background: rgba(0,0,0,0.55); backdrop-filter: blur(4px); color: #FFFFFF; font-weight: 600; margin-bottom: 4px;">
                📂 ${safeCategory}
              </div>
              ${safeBadge ? `<div class="dish-category-badge-chip">${safeBadge}</div>` : ''}
              ${(dish.timeRestricted && dish.availableFrom && dish.availableTo) ? `<div class="dish-schedule-badge time-badge"><i class="fa-regular fa-clock"></i> ${formatTime12h(dish.availableFrom)} - ${formatTime12h(dish.availableTo)}</div>` : ''}
              ${(Array.isArray(dish.availableDays) && dish.availableDays.length < 7) ? `<div class="dish-schedule-badge days-badge"><i class="fa-regular fa-calendar-day"></i> ${dish.availableDays.map(d => d.slice(0,3).toUpperCase()).join(', ')}</div>` : ''}
              <h3 class="dish-title-text">${safeName}</h3>
              <div class="dish-price-rating-row">
                <span class="dish-price-highlight">₹${safePrice}</span>
              </div>
            </div>
          </div>
        </article>
      `;
    }).join('');

    // Attach 1-Tap Stock Toggle in Global Search Results
    globalDishesResultsGrid.querySelectorAll('.btn-stock-toggle').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        if (id) {
          btn.disabled = true;
          try {
            const updated = await dataService.toggleDishStock(id);
            if (updated) {
              showToast(`${updated.name} marked ${updated.inStock ? 'In Stock' : 'Out of Stock'}!`, 'info');
              renderGlobalDishes();
              if (typeof renderCategoryDishes === 'function') renderCategoryDishes();
              renderCategories();
            }
          } catch (err) {
            showToast(`Error toggling stock: ${err?.message || err}`, 'error');
          } finally {
            btn.disabled = false;
          }
        }
      });
    });

    globalDishesResultsGrid.querySelectorAll('.btn-manage-dish-trigger').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        if (id) openEditDishModal(id);
      });
    });

    globalDishesResultsGrid.querySelectorAll('.btn-quick-remove-dish').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        if (id) deleteDishPrompt(id);
      });
    });

    globalDishesResultsGrid.querySelectorAll('.dish-admin-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-id');
        if (id) openEditDishModal(id);
      });
    });
  }

  if (globalDishSearchInput) {
    globalDishSearchInput.addEventListener('input', (e) => {
      globalDishSearchQuery = e.target.value.toLowerCase().trim();
      if (btnClearGlobalDishSearch) {
        btnClearGlobalDishSearch.style.display = globalDishSearchQuery.length > 0 ? 'block' : 'none';
      }
      renderGlobalDishes();
    });
  }

  if (btnClearGlobalDishSearch) {
    btnClearGlobalDishSearch.addEventListener('click', () => {
      globalDishSearchInput.value = '';
      globalDishSearchQuery = '';
      btnClearGlobalDishSearch.style.display = 'none';
      renderGlobalDishes();
    });
  }
  modalDishClose.addEventListener('click', closeDishModal);
  btnCancelDish.addEventListener('click', closeDishModal);
  modalDishBackdrop.addEventListener('click', (e) => {
    if (e.target === modalDishBackdrop) closeDishModal();
  });

  // URL input change updates preview
  dishImageUrl.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    if (val) {
      dishPreviewImg.src = val;
      renderPresetGalleryStrip(val);
    }
  });

  // Compress image file to lightweight, high-quality JPEG data URL (640px max width, quality 0.72 for crisp ~35KB payload)
  function compressImageFile(file, maxWidth = 640, quality = 0.72) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => resolve(e.target.result);
        img.src = e.target.result;
      };
      reader.onerror = () => resolve('');
      reader.readAsDataURL(file);
    });
  }

  // Image File Upload reader & Cloud Sync (Instant preview + Persistent Gallery Store + Non-blocking Google Drive sync)
  dishFileUpload.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    isUploadingDishPhoto = true;
    if (btnSaveDish) btnSaveDish.disabled = true;

    const uploadSpinner = document.getElementById('dish-upload-spinner');
    if (uploadSpinner) {
      uploadSpinner.style.display = 'inline-flex';
      uploadSpinner.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Processing ${files.length > 1 ? files.length + ' photos' : 'photo'}...`;
    }

    try {
      let firstUploadedUrl = null;
      let successCount = 0;

      for (const file of files) {
        try {
          // 1. Immediately compress & render image preview locally (optimized 640px, 0.72 ~35KB)
          const compressedDataUrl = await compressImageFile(file, 640, 0.72);
          if (!compressedDataUrl) continue;

          let finalUrl = compressedDataUrl;
          let finalFileId = '';

          // 2. Persist to dataService uploaded photos gallery immediately
          await dataService.saveUploadedImage(finalUrl, file.name);

          // 3. Set UI preview immediately so user NEVER waits
          if (!firstUploadedUrl) {
            firstUploadedUrl = compressedDataUrl;
            dishPreviewImg.src = compressedDataUrl;
            // DO NOT write Base64 into dishImageUrl.value! Keep input reserved for permanent R2 URL.
            fileChosenText.textContent = `Uploading ${file.name}...`;
            fileChosenText.style.display = 'inline';
          }

          // 4. Cloud photo upload
          let uploadSucceeded = false;
          try {
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 15000));
            const r2Res = await Promise.race([cloudflareR2Service.uploadImage(file, file.name), timeoutPromise]);
            if (r2Res?.url) {
              finalUrl = r2Res.url;
              finalFileId = r2Res.key || '';
              await dataService.saveUploadedImage(finalUrl, file.name);
              dishPreviewImg.src = finalUrl;
              dishImageUrl.value = finalUrl;
              currentDishGdriveFileId = finalFileId;
              fileChosenText.textContent = `✓ Saved photo: ${file.name}`;
              uploadSucceeded = true;
              successCount++;
            } else {
              fileChosenText.textContent = `⚠️ Photo upload issue. Please retry.`;
            }
          } catch (r2Err) {
            console.warn('[Upload] Photo storage notice:', r2Err?.message || r2Err);
            fileChosenText.textContent = `⚠️ Photo upload issue. Please retry.`;
          }

          if (!uploadSucceeded) {
            showToast('⚠️ Cloud photo upload could not be completed. Please ensure admin session is active and retry.', 'warning');
          }
        } catch (err) {
          console.error('Error processing upload file:', file.name, err);
        }
      }

      if (firstUploadedUrl && successCount > 0) {
        await renderPresetGalleryStrip(dishImageUrl.value || firstUploadedUrl);
        showToast(
          successCount > 1 
            ? `✓ ${successCount} photos ready and saved to gallery! Click Save Food Dish to publish.` 
            : '✓ Photo ready and saved to gallery! Click Save Food Dish to publish.', 
          'success'
        );
      } else if (files.length > 0 && successCount === 0) {
        showToast('⚠️ Image upload failed. Please verify connection and retry.', 'error');
      }
    } finally {
      isUploadingDishPhoto = false;
      if (btnSaveDish) btnSaveDish.disabled = false;
      if (uploadSpinner) uploadSpinner.style.display = 'none';
      dishFileUpload.value = '';
    }
  });

  if (dishBadgeInput) {
    dishBadgeInput.addEventListener('change', () => {
      if (dishBadgeInput.value === 'Custom') {
        if (dishBadgeCustomInput) {
          dishBadgeCustomInput.style.display = 'block';
          dishBadgeCustomInput.focus();
        }
      } else {
        if (dishBadgeCustomInput) {
          dishBadgeCustomInput.style.display = 'none';
        }
      }
    });
  }

  formDish.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmittingDish) return;
    if (isUploadingDishPhoto) {
      showToast('⚠️ Photo is still uploading. Please wait a moment...', 'warning');
      return;
    }

    const name = dishNameInput.value.trim();
    if (!name) {
      showToast('Please enter a dish title / name.', 'warning');
      dishNameInput.focus();
      return;
    }

    const category = dishCategorySelect.value;
    const parsedPrice = parseFloat(dishPriceInput.value);
    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      showToast('Please enter a valid price for the dish.', 'warning');
      dishPriceInput.focus();
      return;
    }
    const price = Math.round(parsedPrice);

    let badge = dishBadgeInput.value.trim();
    if (badge === 'Custom') {
      badge = dishBadgeCustomInput ? dishBadgeCustomInput.value.trim() : '';
    }
    const time = dishTimeInput.value.trim();
    const calories = dishCaloriesInput.value.trim();
    const diet = dishDietInput.value.trim();
    const desc = dishDescInput.value.trim();
    let image = dishImageUrl.value.trim();
    const inStock = dishStockHidden ? dishStockHidden.value === 'true' : true;
    const gdriveFileId = currentDishGdriveFileId || '';
    const editId = dishEditId.value;

    const availableDays = getSelectedDishDays();
    const timeRestricted = dishTimeRestricted ? dishTimeRestricted.checked : false;
    const availableFrom = (dishAvailableFrom ? dishAvailableFrom.value : '12:00').trim();
    const availableTo = (dishAvailableTo ? dishAvailableTo.value : '23:30').trim();

    if (image.startsWith('data:')) {
      showToast('⚠️ Photo is still uploading. Please wait a moment...', 'warning');
      return;
    }

    if (!image) {
      if (editId) {
        const existing = dataService.getDishes().find(d => d.id === editId);
        image = (existing?.image && !existing.image.startsWith('data:'))
          ? existing.image
          : '/api/r2-image?key=dishes/crispy-chicken.jpg';
      } else {
        image = '/api/r2-image?key=dishes/crispy-chicken.jpg';
      }
    }

    const categories = dataService.getCategories();
    const catObj = categories.find(c => c.slug === category || c.id === category);
    const categoryName = catObj ? catObj.name : category;

    // Ensure custom uploaded image is saved in the gallery
    if (image && !image.startsWith('data:')) {
      dataService.saveUploadedImage(image, name);
    }

    isSubmittingDish = true;
    const submitBtn = formDish.querySelector('button[type="submit"]') || btnSaveDish;
    const origBtnContent = submitBtn ? submitBtn.innerHTML : '';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
    }

    try {
      if (editId) {
        await dataService.updateDish(editId, {
          name,
          category,
          categoryName,
          price,
          badge,
          time,
          calories,
          diet,
          desc,
          image,
          inStock,
          availableDays,
          timeRestricted,
          availableFrom,
          availableTo,
          r2Key: currentDishGdriveFileId,
          gdriveFileId
        });
        showToast(`Dish "${name}" updated successfully!`, 'success');
      } else {
        await dataService.addDish({
          name,
          category,
          categoryName,
          price,
          badge,
          time,
          calories,
          diet,
          desc,
          image,
          inStock,
          availableDays,
          timeRestricted,
          availableFrom,
          availableTo,
          r2Key: currentDishGdriveFileId,
          gdriveFileId
        });
        showToast(`New dish "${name}" added to menu!`, 'success');
      }

      closeDishModal();
      renderDishes();
      renderCategories();
    } catch (err) {
      console.error('[Dish Save Error]:', err);
      showToast(`Error saving dish: ${err?.message || err}`, 'error');
    } finally {
      isSubmittingDish = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = origBtnContent;
      }
    }
  });

  // ========================================================
  // GOOGLE DRIVE SETTINGS MODAL
  // ========================================================
  // CLOUDFLARE R2 OBJECT STORAGE STATUS & SYNC
  // ========================================================
  console.log('[Cloudflare R2] Active Bucket: cryspychiken | Endpoint: https://ac8ec178ff831995f9cc03213674c306.r2.cloudflarestorage.com');

  // ========================================================
  // 4. LIVE ORDERS MANAGEMENT & TRACKING
  // ========================================================
  function calculateOrderKPIs(orders) {
    const list = Array.isArray(orders) ? orders.filter(Boolean) : [];
    const visibleOrders = list.filter(o => o.status !== 'pending_payment');
    const total = visibleOrders.length;
    const accepted = visibleOrders.filter(o => o.status === 'accepted' || o.status === 'pending').length;
    const cooking = visibleOrders.filter(o => o.status === 'cooking').length;
    const ready = visibleOrders.filter(o => o.status === 'ready_for_pickup').length;
    const outForDelivery = visibleOrders.filter(o => o.status === 'on_the_way').length;
    const delivered = visibleOrders.filter(o => o.status === 'delivered').length;
    const undelivered = visibleOrders.filter(o => o.status === 'undelivered').length;
    const cancelled = visibleOrders.filter(o => o.status === 'cancelled').length;

    let totalRevenue = 0;
    let todayRevenue = 0;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    visibleOrders.forEach(o => {
      // Exclude cancelled and undelivered returned orders from revenue
      if (o.status !== 'cancelled' && o.status !== 'undelivered') {
        const num = parseFloat(String(o.total ?? '0').replace(/[^0-9.]/g, ''));
        if (!isNaN(num)) {
          totalRevenue += num;
          const createdMs = typeof o.createdAt === 'number' ? o.createdAt : new Date(o.createdAt).getTime();
          if (!isNaN(createdMs) && createdMs >= todayStart) {
            todayRevenue += num;
          }
        }
      }
    });

    const kpiCancelledOrders = document.getElementById('kpi-cancelled-orders');
    const kpiUndeliveredOrders = document.getElementById('kpi-undelivered-orders');
    const kpiAlltimeRevenue = document.getElementById('kpi-alltime-revenue');
    if (kpiTotalOrders) kpiTotalOrders.textContent = total;
    if (kpiAcceptedOrders) kpiAcceptedOrders.textContent = accepted;
    if (kpiCookingOrders) kpiCookingOrders.textContent = cooking;
    if (kpiReadyOrders) kpiReadyOrders.textContent = ready;
    if (kpiOutOrders) kpiOutOrders.textContent = outForDelivery;
    if (kpiDeliveredOrders) kpiDeliveredOrders.textContent = delivered;
    if (kpiUndeliveredOrders) kpiUndeliveredOrders.textContent = undelivered;
    if (kpiCancelledOrders) kpiCancelledOrders.textContent = cancelled;
    if (kpiTotalRevenue) kpiTotalRevenue.textContent = `₹${Math.round(todayRevenue)}`;
    if (kpiAlltimeRevenue) kpiAlltimeRevenue.textContent = `(All-time: ₹${Math.round(totalRevenue)})`;

    updateOrderBadges();
  }

  // ========================================================
  // ACCEPTED ORDERS > 5 MINUTES ALERT ENGINE (UNSTARTED ORDERS)
  // ========================================================
  const alertedOverdueOrderIds = new Set();

  function checkOverduePendingOrders() {
    const orders = dataService.getOrders();
    const now = Date.now();
    const overdueOrders = orders.filter(o => {
      if (!o || ((o.status || 'accepted') !== 'accepted' && o.status !== 'pending')) return false;
      const created = typeof o.createdAt === 'number' ? o.createdAt : new Date(o.createdAt).getTime();
      return !isNaN(created) && created > 0 && (now - created) >= 5 * 60 * 1000;
    });

    let newlyTriggered = false;
    overdueOrders.forEach(o => {
      if (!alertedOverdueOrderIds.has(o.id)) {
        alertedOverdueOrderIds.add(o.id);
        newlyTriggered = true;

        const created = typeof o.createdAt === 'number' ? o.createdAt : new Date(o.createdAt).getTime();
        const waitMins = Math.max(5, Math.floor((now - created) / 60000));

        // Audible chime alert
        playKitchenChime();

        // Push / Desktop notification
        const dispId = formatDisplayOrderId(o.id, o.pickupCode);
        sendSystemNotification({
          title: `⚠️ Alert: Order ${dispId} Accepted > ${waitMins} Mins!`,
          body: `Order ${dispId} (${o.customerName || 'Guest'}) has been accepted for ${waitMins}m without kitchen preparation!`,
          tag: `admin-overdue-${o.id}`,
          onClick: () => {
            switchView('view-orders');
            openOrderManageModal(o.id);
          }
        });

        // Flash title & toast
        flashTabTitle(`⚠️ WAITING > 5M: ${dispId}!`);
        showToast(`⚠️ URGENT: Order ${dispId} has been waiting for ${waitMins} minutes! Start preparation.`, 'warning');
      }
    });

    // Clean up any alerted orders that are no longer unstarted
    alertedOverdueOrderIds.forEach(id => {
      const stillUnstarted = orders.some(o => o && o.id === id && ((o.status || 'accepted') === 'accepted' || o.status === 'pending'));
      if (!stillUnstarted) {
        alertedOverdueOrderIds.delete(id);
      }
    });

    // Update banner UI
    updateOverdueBanner(overdueOrders);

    // If active view is orders and newly triggered, re-render
    if (newlyTriggered && activeView === 'view-orders') {
      renderOrders();
    }
  }

  function updateOverdueBanner(overdueList) {
    if (!pendingOverdueAlertBanner) return;
    if (!Array.isArray(overdueList) || overdueList.length === 0) {
      pendingOverdueAlertBanner.style.display = 'none';
      return;
    }

    pendingOverdueAlertBanner.style.display = 'flex';
    const first = overdueList[0];
    const created = typeof first.createdAt === 'number' ? first.createdAt : new Date(first.createdAt).getTime();
    const waitMins = Math.max(5, Math.floor((Date.now() - created) / 60000));

    if (overdueBannerTitle) {
      overdueBannerTitle.textContent = overdueList.length === 1
        ? `⚠️ Order ${first.id} Accepted > ${waitMins} Minutes!`
        : `⚠️ ${overdueList.length} Orders Waiting for Preparation > 5 Mins!`;
    }
    if (overdueBannerSub) {
      overdueBannerSub.textContent = `Action required: ${first.customerName || 'Customer'} is waiting. Please start kitchen preparation now.`;
    }

    if (btnOverdueQuickAccept) {
      btnOverdueQuickAccept.onclick = (e) => {
        e.stopPropagation();
        const updated = dataService.updateOrderStatus(first.id, 'cooking');
        if (isKitchenAlarmRinging) {
          stopKitchenAlarm(true, { orderId: first.id });
        }
        showToast(`🔥 Order ${first.id} moved to Preparing!`, 'success');
        checkOverduePendingOrders();
        renderOrders();
        if (updated?.serverPromise) {
          updated.serverPromise.catch(err => {
            showToast(`⚠️ Could not update order ${first.id}: ${err?.message || 'Server rejected transition'}`, 'error');
            renderOrders();
            checkOverduePendingOrders();
          });
        }
      };
    }

    if (btnOverdueQuickView) {
      btnOverdueQuickView.onclick = (e) => {
        e.stopPropagation();
        switchView('view-orders');
        openOrderManageModal(first.id);
      };
    }
  }

  function renderOrders() {
    const orders = dataService.getOrders();
    calculateOrderKPIs(orders);

    let filtered = Array.isArray(orders) ? orders.filter(Boolean) : [];
    filtered = filtered.filter(o => o.status !== 'pending_payment');

    // Status filter
    if (activeOrderFilter && activeOrderFilter !== 'all') {
      filtered = filtered.filter(o => {
        if (!o) return false;
        const st = o.status || 'accepted';
        if (activeOrderFilter === 'accepted') {
          return st === 'accepted' || st === 'pending';
        }
        return st === activeOrderFilter;
      });
    }

    // Search query
    if (orderSearchQuery) {
      const q = String(orderSearchQuery).toLowerCase().trim();
      filtered = filtered.filter(o => {
        if (!o) return false;
        const oid = String(o.id || '').toLowerCase();
        const dispId = formatDisplayOrderId(o.id, o.pickupCode).toLowerCase();
        const items = String(o.itemsSummary || '').toLowerCase();
        const cname = String(o.customerName || '').toLowerCase();
        const cphone = String(o.customerPhone || o.phone || '').toLowerCase();
        const pcode = String(o.pickupCode || '').toLowerCase();
        const payMethod = (o.paymentMethod || (o.isPaidOnline ? 'online paid' : (o.doorstepUpi ? 'doorstep upi' : 'cod cash'))).toLowerCase();
        return oid.includes(q) ||
               dispId.includes(q) ||
               items.includes(q) ||
               cname.includes(q) ||
               cphone.includes(q) ||
               pcode.includes(q) ||
               payMethod.includes(q);
      });
    }

    if (filtered.length === 0) {
      ordersContainer.innerHTML = '';
      ordersEmptyState.style.display = 'block';
      const oldPagination = document.getElementById('admin-orders-pagination');
      if (oldPagination) oldPagination.style.display = 'none';
      checkOverduePendingOrders();
      return;
    }

    ordersEmptyState.style.display = 'none';

    // Calculate pagination (25 orders per page)
    const totalOrders = filtered.length;
    const totalPages = Math.ceil(totalOrders / ADMIN_ORDERS_PER_PAGE) || 1;
    if (adminOrdersPage > totalPages) adminOrdersPage = totalPages;
    if (adminOrdersPage < 1) adminOrdersPage = 1;
    const startIndex = (adminOrdersPage - 1) * ADMIN_ORDERS_PER_PAGE;
    const endIndex = Math.min(startIndex + ADMIN_ORDERS_PER_PAGE, totalOrders);
    const pageOrders = filtered.slice(startIndex, endIndex);

    ordersContainer.innerHTML = pageOrders.map(order => {
      const timeAgo = formatTimeAgo(order.createdAt);
      const statusClass = `status-${order.status || 'accepted'}`;
      let statusLabel = '';
      if (order.status === 'cancelled') statusLabel = 'Cancelled';
      else if (order.status === 'undelivered') statusLabel = 'Undelivered (Returned)';
      else if (order.status === 'cooking') statusLabel = 'Preparing';
      else if (order.status === 'ready_for_pickup') statusLabel = 'Ready to Dispatch';
      else if (order.status === 'on_the_way') statusLabel = 'Dispatched';
      else if (order.status === 'delivered') statusLabel = 'Delivered';
      else if (order.status === 'accepted' || order.status === 'pending') statusLabel = 'Accepted';
      else statusLabel = order.statusLabel || 'Accepted';

      // Check if order has been waiting without cooking for > 5 minutes
      const isUnstarted = (order.status || 'accepted') === 'accepted' || order.status === 'pending';
      const createdMs = typeof order.createdAt === 'number' ? order.createdAt : new Date(order.createdAt).getTime();
      const ageMs = !isNaN(createdMs) && createdMs > 0 ? (Date.now() - createdMs) : 0;
      const isOverdue = isUnstarted && ageMs >= 5 * 60 * 1000;
      const ageMins = Math.max(5, Math.floor(ageMs / 60000));
      const cardOverdueClass = isOverdue ? 'order-card-overdue' : '';
      const overdueBadgeHtml = isOverdue ? `
        <div class="badge-pending-overdue">
          <i class="fa-solid fa-triangle-exclamation fa-beat"></i> ⚠️ WAITING: Accepted ${ageMins}m ago!
        </div>
      ` : '';

      // Next status action: Accepted -> Preparing -> Ready to Dispatch -> Dispatched -> Delivered
      let nextActionBtn = '';
      if (order.status === 'cancelled') {
        const reasonText = order.cancellationReason ? escapeHtml(order.cancellationReason) : 'Cancelled by Kitchen';
        nextActionBtn = `<span class="btn-advance-status" style="background:#FEE2E2; color:#DC2626; border:1px solid #FECACA; cursor:default;" title="${reasonText}">❌ Cancelled</span>`;
      } else if (order.status === 'undelivered') {
        const reasonText = order.undeliveredReason || order.cancellationReason || 'Customer unreachable at doorstep';
        nextActionBtn = `<span class="btn-advance-status" style="background:#FFF7ED; color:#C2410C; border:1.5px solid #FDBA74; cursor:default;" title="${escapeHtml(reasonText)}"><i class="fa-solid fa-box-archive"></i> Returned to Kitchen</span>`;
      } else if (order.status === 'accepted' || order.status === 'pending') {
        nextActionBtn = `<button class="btn-advance-status" data-id="${order.id}" data-next="cooking">🔥 Start Preparing</button>`;
      } else if (order.status === 'cooking') {
        nextActionBtn = `<button class="btn-advance-status" data-id="${order.id}" data-next="ready_for_pickup">📦 Pack & Ready to Dispatch</button>`;
      } else if (order.status === 'ready_for_pickup') {
        const bagCode = order.pickupCode || (order.id ? String(order.id).replace(/\D/g, '').slice(-4) : '0000');
        nextActionBtn = `<span class="btn-advance-status rider-only-pill" title="Food packed and ready on shelf. Rider enters 4-digit code to dispatch."><i class="fa-solid fa-box"></i> Ready on Shelf (Bag #${bagCode})</span>`;
      } else if (order.status === 'on_the_way') {
        nextActionBtn = `<span class="btn-advance-status rider-only-pill" title="Only the Delivery Partner can mark this order as delivered at customer doorstep"><i class="fa-solid fa-motorcycle"></i> Rider Delivering</span>`;
      } else {
        nextActionBtn = `<button class="btn-advance-status" style="background:#10B981;" disabled>✓ Delivered</button>`;
      }

      // Items list
      let itemsHtml = '';
      if (Array.isArray(order.items) && order.items.length > 0) {
        itemsHtml = order.items.map(it => `
          <div class="order-item-row">
            <span class="item-qty-name">${parseInt(it.quantity) || 1}x ${escapeHtml(it.name)}</span>
            <span class="item-subtotal">₹${Math.round((parseFloat(it.price) || 0) * (parseInt(it.quantity) || 1))}</span>
          </div>
        `).join('');
      } else {
        itemsHtml = `
          <div class="order-item-row">
            <span class="item-qty-name">${escapeHtml(order.itemsSummary || 'Standard Food Combo')}</span>
            <span class="item-subtotal">${escapeHtml(order.total || '₹330')}</span>
          </div>
        `;
      }

      const safeOrderId = escapeHtml(order.id);
      const bagCode = order.pickupCode || (order.id ? String(order.id).replace(/\D/g, '').slice(-4) : '0000');
      const displayOrderId = formatDisplayOrderId(order.id, bagCode);
      const safeCustomerName = escapeHtml(order.customerName || 'Online Order');
      const rawAddrs = dataService.getAllAddressesRaw();
      const extractedPhone = extractPhoneFromOrder(order, rawAddrs) || order.customerPhone || '';
      const safePhone = extractedPhone ? escapeHtml(extractedPhone) : '';
      const safeAddress = escapeHtml(cleanDeliveryAddress(order.deliveryAddress || 'Priority Food Delivery'));
      const safeTotal = escapeHtml(order.total || '₹0');
      const safeStatusLabel = escapeHtml(statusLabel);
      const cleanPhoneDigits = (extractedPhone || '').replace(/\D/g, '');
      const hasRealPhone = cleanPhoneDigits.length >= 10;
      const dialerPhone = hasRealPhone ? cleanPhoneDigits.slice(-10) : '';
      const displayPhone = hasRealPhone ? `+91 ${dialerPhone.slice(0, 5)} ${dialerPhone.slice(5)}` : safePhone;
      const whatsappText = `Hello ${order.customerName || 'Customer'}, regarding your Savera Paradise order ${order.id}.`;
      const whatsappUrl = hasRealPhone ? `https://wa.me/91${dialerPhone}?text=${encodeURIComponent(whatsappText)}` : '#';

      let riderTagHtml = '';
      if (order.assignedRiderName) {
        const isGoingToStore = typeof dataService.isOrderGoingToRestaurant === 'function' && dataService.isOrderGoingToRestaurant(order);
        const stageText = isGoingToStore
          ? `Going to Restaurant to Pick Up Bag #${escapeHtml(bagCode)}`
          : (order.status === 'on_the_way' ? 'On the Way to Customer' : 'Assigned Rider');
        riderTagHtml = `
          <div class="order-rider-status-bar">
            <span class="rider-assigned-chip ${isGoingToStore ? 'going-to-restaurant' : ''}" title="${stageText} — ${escapeHtml(order.assignedRiderName)}">
              <i class="fa-solid ${isGoingToStore ? 'fa-store' : 'fa-motorcycle'}"></i> <strong>${escapeHtml(order.assignedRiderName)}</strong> • ${stageText}
            </span>
          </div>
        `;
      } else if (order.status === 'ready_for_pickup') {
        riderTagHtml = `
          <div class="order-rider-status-bar">
            <span class="rider-unassigned-chip ready-shelf">
              <i class="fa-solid fa-box-open"></i> Kitchen Shelf • Awaiting Rider Pickup
            </span>
          </div>
        `;
      } else if (order.status === 'cooking') {
        riderTagHtml = `
          <div class="order-rider-status-bar">
            <span class="rider-unassigned-chip kitchen-cooking" style="background:#FEF3C7; color:#B45309; border:1px solid #FDE68A;">
              <i class="fa-solid fa-fire-burner"></i> Chef Preparing • Cooking in Kitchen
            </span>
          </div>
        `;
      } else if (order.status === 'accepted' || order.status === 'pending') {
        riderTagHtml = `
          <div class="order-rider-status-bar">
            <span class="rider-unassigned-chip order-accepted" style="background:#EFF6FF; color:#1D4ED8; border:1px solid #BFDBFE;">
              <i class="fa-solid fa-clock"></i> Order Accepted • Awaiting Kitchen Cooking
            </span>
          </div>
        `;
      } else if (order.status === 'cancelled') {
        riderTagHtml = `
          <div class="order-rider-status-bar">
            <span class="rider-unassigned-chip order-cancelled" style="background:#FEF2F2; color:#DC2626; border:1px solid #FECACA;">
              <i class="fa-solid fa-circle-xmark"></i> Order Cancelled
            </span>
          </div>
        `;
      } else if (order.status === 'undelivered') {
        riderTagHtml = `
          <div class="order-rider-status-bar">
            <span class="rider-unassigned-chip order-undelivered" style="background:#FFF7ED; color:#C2410C; border:1px solid #FFEDD5;">
              <i class="fa-solid fa-box-archive"></i> Returned to Kitchen
            </span>
          </div>
        `;
      }

      const isDoorstepWaiting = order.status === 'on_the_way' && order.riderWaitingAtDoorstep;
      const doorstepWaitingBadgeHtml = isDoorstepWaiting ? `
        <div class="badge-doorstep-waiting" style="background:#FFFBEB; border:1.5px solid #FDE68A; color:#92400E; padding:8px 12px; border-radius:8px; margin:8px 0; font-size:0.82rem; font-weight:700; display:flex; align-items:center; justify-content:space-between; gap:8px;">
          <span><i class="fa-solid fa-hourglass-half fa-spin" style="color:#D97706; margin-right:4px;"></i> ⚠️ Rider Waiting at Doorstep (Customer Unreachable)</span>
          ${hasRealPhone ? `<a href="tel:${dialerPhone}" class="btn-kitchen-call-cust" style="background:#D97706; color:#FFF; padding:4px 10px; border-radius:6px; text-decoration:none; font-size:0.75rem; font-weight:800; display:inline-flex; align-items:center; gap:4px;"><i class="fa-solid fa-phone"></i> Call Customer</a>` : ''}
        </div>
      ` : '';

      const undeliveredReasonHtml = order.status === 'undelivered' ? `
        <div class="badge-undelivered-notice" style="background:#FFF7ED; border:1.5px solid #FDBA74; color:#C2410C; padding:8px 12px; border-radius:8px; margin:8px 0; font-size:0.8rem; font-weight:700;">
          <i class="fa-solid fa-box-archive"></i> Returned to Kitchen: ${escapeHtml(order.undeliveredReason || order.cancellationReason || 'Customer unreachable at doorstep')}
        </div>
      ` : '';

      // Special cooking / packaging note callout directly on card
      const customerNotes = (order.kitchenNotes || order.notes || order.customerNotes || (order.addressDetails && order.addressDetails.instructions) || '').trim();
      const chefNoteHtml = customerNotes ? `
        <div class="order-chef-note-box">
          <div class="chef-note-title">
            <i class="fa-solid fa-bell-concierge"></i> Special Cooking / Packing Note
          </div>
          <div class="chef-note-text">
            "${escapeHtml(customerNotes)}"
          </div>
        </div>
      ` : '';

      // Distance chip
      const distanceKm = order.addressDetails?.distanceKm || '';
      const distanceBadgeHtml = distanceKm ? `<span class="cust-distance-chip" title="Distance from restaurant"><i class="fa-solid fa-route"></i> ${escapeHtml(distanceKm)} km</span>` : '';

      // Payment Method distinction (COD vs Online vs Doorstep UPI)
      let paymentStatusBadge = '';
      let totalLabel = 'Total Paid';
      if (order.isPaidOnline === true || order.paymentMethod === 'online') {
        paymentStatusBadge = `
          <span class="order-payment-pill is-online" title="Customer paid online via UPI/Card">
            <i class="fa-solid fa-circle-check"></i> Paid Online
          </span>
        `;
        totalLabel = 'Total Paid';
      } else if (order.doorstepUpi === true || order.paymentMethod === 'doorstep_upi') {
        paymentStatusBadge = `
          <span class="order-payment-pill is-doorstep-upi" title="Payment to be collected via Doorstep Dynamic UPI QR">
            <i class="fa-solid fa-qrcode"></i> Doorstep UPI QR
          </span>
        `;
        totalLabel = 'To Collect';
      } else {
        paymentStatusBadge = `
          <span class="order-payment-pill is-cod" title="Cash to be collected upon doorstep delivery">
            <i class="fa-solid fa-hand-holding-dollar"></i> Collect Cash (COD)
          </span>
        `;
        totalLabel = 'To Collect';
      }

      // Kitchen Urgency Timer
      let timeClass = 'order-time-tag';
      let timeDisplay = timeAgo;
      if (isUnstarted) {
        if (ageMins >= 5) {
          timeClass = 'order-time-tag time-urgent';
          timeDisplay = `⚠️ Waiting ${ageMins}m!`;
        } else if (ageMins >= 3) {
          timeClass = 'order-time-tag time-warning';
          timeDisplay = `🕒 ${timeAgo} (Prepare soon)`;
        }
      }

      return `
        <div class="order-card-admin ${cardOverdueClass}" data-id="${safeOrderId}">
          <div class="order-card-header">
            <div>
              <div class="order-id-label">${escapeHtml(displayOrderId)}</div>
              <div class="order-pickup-code-badge" title="Write this 4-digit token on the food delivery bag/box">
                <i class="fa-solid fa-tag"></i> <span>Write on Bag:</span> <strong>#${bagCode}</strong>
              </div>
              <div class="${timeClass}"><i class="fa-regular fa-clock"></i> ${timeDisplay}</div>
              ${overdueBadgeHtml}
            </div>
            <span class="order-status-badge ${statusClass}">
              <span class="status-pulse-dot"></span>
              ${safeStatusLabel}
            </span>
          </div>

          ${riderTagHtml}
          ${doorstepWaitingBadgeHtml}
          ${undeliveredReasonHtml}

          <div class="order-customer-box">
            <div class="order-customer-header">
              <span class="customer-name"><i class="fa-regular fa-user"></i> ${safeCustomerName}</span>
              ${hasRealPhone ? `
                <div class="admin-customer-contact-actions">
                  <a href="tel:${dialerPhone}" class="btn-admin-call" title="Call Customer (${displayPhone})" onclick="event.stopPropagation();">
                    <i class="fa-solid fa-phone"></i> Call
                  </a>
                  <a href="${whatsappUrl}" target="_blank" rel="noopener noreferrer" class="btn-admin-wa" title="WhatsApp Customer (${displayPhone})" onclick="event.stopPropagation();">
                    <i class="fa-brands fa-whatsapp"></i> Chat
                  </a>
                </div>
              ` : `<span class="no-phone-tag">No phone</span>`}
            </div>
            ${hasRealPhone ? `<div style="font-size:0.75rem; color:#4B5563; font-weight:600; margin-bottom:2px;"><i class="fa-solid fa-phone"></i> ${escapeHtml(displayPhone)}</div>` : ''}
            <span>📍 ${safeAddress}${distanceBadgeHtml}</span>
          </div>

          <div class="order-items-scroll-box">
            ${itemsHtml}
          </div>

          ${chefNoteHtml}

          ${(order.status === 'cancelled' && order.cancellationReason) ? `
            <div style="background:#FEF2F2; color:#B91C1C; padding:6px 10px; border-radius:8px; font-size:0.78rem; font-weight:600; margin-bottom:8px; border:1px solid #FECACA;">
              <i class="fa-solid fa-ban"></i> Reason: ${escapeHtml(order.cancellationReason)}
            </div>
          ` : ''}

          <div class="order-total-row">
            <div class="order-payment-col">
              ${paymentStatusBadge}
            </div>
            <div class="order-amount-col">
              <span class="order-total-title">${totalLabel}</span>
              <span class="order-total-val">${safeTotal}</span>
            </div>
          </div>

          <div class="order-card-actions-bar">
            <div class="order-actions-secondary-row">
              <button type="button" class="btn-manage-order" data-id="${safeOrderId}">
                <i class="fa-solid fa-receipt"></i> View Order
              </button>
              <button type="button" class="btn-quick-kot" data-id="${safeOrderId}" title="Quick Print Kitchen Order Ticket (KOT)">
                <i class="fa-solid fa-print"></i> Print KOT
              </button>
            </div>
            <div class="order-actions-primary-row">
              ${nextActionBtn}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Attach Order Event Listeners
    // 1. Entire card or Manage button triggers Bottom Sheet Edit Modal
    ordersContainer.querySelectorAll('.order-card-admin').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-id');
        openOrderManageModal(id);
      });
    });

    ordersContainer.querySelectorAll('.btn-manage-order').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        openOrderManageModal(id);
      });
    });

    // 1B. Quick KOT Thermal Print
    ordersContainer.querySelectorAll('.btn-quick-kot').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const order = (dataService.getOrderById ? dataService.getOrderById(id) : null) || dataService.getOrders().find(o => o.id === id);
        if (order) {
          printOrderKOT(order);
        } else {
          showToast('Order details not found.', 'warning');
        }
      });
    });

    // 2. Quick Advance Next Status Button
    ordersContainer.querySelectorAll('.btn-advance-status').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const next = btn.getAttribute('data-next');
        if (id && next) {
          if (next === 'on_the_way' || next === 'delivered') {
            showToast('🛵 Rider Privilege: Only the assigned Delivery Partner can pick up and deliver orders!', 'warning');
            return;
          }
          const updated = dataService.updateOrderStatus(id, next);
          if (next !== 'pending' && isKitchenAlarmRinging) {
            stopKitchenAlarm(true, { orderId: id });
          }
          if (updated) {
            showToast(`Order ${id} advanced to "${next.replace(/_/g, ' ')}"!`, 'success');
            checkOverduePendingOrders();
            renderOrders();
            if (updated.serverPromise) {
              updated.serverPromise.catch(err => {
                showToast(`⚠️ Could not advance order ${id}: ${err?.message || 'Server rejected transition'}`, 'error');
                renderOrders();
                checkOverduePendingOrders();
              });
            }
          }
        }
      });
    });

    checkOverduePendingOrders();
    renderAdminPagination(totalOrders, totalPages, adminOrdersPage, startIndex, endIndex);
  }

  function renderAdminPagination(totalOrders, totalPages, currentPage, startIndex, endIndex) {
    let paginationEl = document.getElementById('admin-orders-pagination');
    if (!paginationEl) {
      if (!ordersContainer || !ordersContainer.parentNode) return;
      paginationEl = document.createElement('div');
      paginationEl.id = 'admin-orders-pagination';
      ordersContainer.parentNode.insertBefore(paginationEl, ordersContainer.nextSibling);
    }

    if (totalPages <= 1) {
      paginationEl.innerHTML = '';
      paginationEl.style.display = 'none';
      return;
    }

    paginationEl.style.display = 'block';
    paginationEl.innerHTML = `
      <div class="admin-pagination-bar" style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; margin-top:18px; padding:12px 18px; background:#FFFFFF; border:1px solid #E5E7EB; border-radius:12px; font-size:0.85rem; color:#4B5563; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
        <div>
          Showing <strong>${startIndex + 1}–${endIndex}</strong> of <strong>${totalOrders}</strong> orders
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <button type="button" id="btn-admin-prev-page" class="btn-admin-pagination" ${currentPage <= 1 ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : 'style="cursor:pointer;"'}>
            <i class="fa-solid fa-chevron-left"></i> Prev
          </button>
          <span style="font-weight:700; color:#111827; padding:0 6px;">Page ${currentPage} of ${totalPages}</span>
          <button type="button" id="btn-admin-next-page" class="btn-admin-pagination" ${currentPage >= totalPages ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : 'style="cursor:pointer;"'}>
            Next <i class="fa-solid fa-chevron-right"></i>
          </button>
        </div>
      </div>
    `;

    const btnPrev = document.getElementById('btn-admin-prev-page');
    const btnNext = document.getElementById('btn-admin-next-page');
    if (btnPrev && currentPage > 1) {
      btnPrev.addEventListener('click', () => {
        adminOrdersPage--;
        renderOrders();
        ordersContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    if (btnNext && currentPage < totalPages) {
      btnNext.addEventListener('click', () => {
        adminOrdersPage++;
        renderOrders();
        ordersContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }

  // ========================================================
  // 4B. ORDER EDIT & MANAGE MODAL (POP UP FROM BELOW)
  // ========================================================
  // ========================================================
  // 4B. ORDER DETAILS & RECEIPT MODAL (READ-ONLY)
  // ========================================================
  function openOrderManageModal(orderId) {
    const orders = dataService.getOrders();
    const norm = (id) => String(id || '').trim().replace(/^#/, '');
    const cleanTarget = norm(orderId);
    const order = orders.find(o => o && norm(o.id) === cleanTarget);
    if (!order) return;

    if (orderEditId) orderEditId.value = order.id;
    const bagCode = order.pickupCode || (order.id ? String(order.id).replace(/\D/g, '').slice(-4) : '0000');
    const displayOrderId = formatDisplayOrderId(order.id, bagCode);
    if (orderModalTitle) orderModalTitle.textContent = `Order Receipt ${displayOrderId} • Bag #${bagCode}`;

    if (orderModalTimeSub) {
      const riderStr = order.assignedRiderName ? ` • 🏍️ Rider: ${order.assignedRiderName}` : ' • 📦 Waiting for Rider Pickup';
      orderModalTimeSub.textContent = `Placed ${formatTimeAgo(order.createdAt)}${riderStr}`;
    }

    const rawAddrs = dataService.getAllAddressesRaw();
    const phone = extractPhoneFromOrder(order, rawAddrs) || order.customerPhone || '';
    if (orderDetailCustomer) orderDetailCustomer.textContent = `${order.customerName || 'Online Guest'}${phone ? ` (📞 ${phone})` : ''}`;

    const modalPhoneActions = document.getElementById('order-detail-phone-actions');
    const btnModalCall = document.getElementById('btn-modal-call-customer');
    const btnModalWa = document.getElementById('btn-modal-wa-customer');
    const modalDigits = (phone || '').replace(/\D/g, '');
    if (modalDigits.length >= 10 && modalPhoneActions && btnModalCall && btnModalWa) {
      const dialer = modalDigits.slice(-10);
      btnModalCall.href = `tel:${dialer}`;
      btnModalCall.title = `Call Customer (${dialer})`;
      const waMsg = `Hello ${order.customerName || 'Customer'}, regarding your Savera Paradise order ${order.id}.`;
      btnModalWa.href = `https://wa.me/91${dialer}?text=${encodeURIComponent(waMsg)}`;
      modalPhoneActions.style.display = 'inline-flex';
    } else if (modalPhoneActions) {
      modalPhoneActions.style.display = 'none';
    }
    if (orderDetailEta) orderDetailEta.textContent = order.eta || (order.status === 'delivered' ? 'Delivered' : '30 - 40 Minutes');
    if (orderDetailAddress) orderDetailAddress.textContent = cleanDeliveryAddress(order.deliveryAddress || 'Express Street Food Delivery');

    if (orderDetailNotesCard) {
      const notes = (order.kitchenNotes || order.notes || order.customerNotes || (order.addressDetails && order.addressDetails.instructions) || '').trim();
      if (notes) {
        orderDetailNotesCard.style.display = 'block';
        if (orderDetailNotes) orderDetailNotes.textContent = notes;
      } else {
        orderDetailNotesCard.style.display = 'none';
      }
    }

    renderOrderModalReadonlyItems(order);

    if (orderDetailTotal) {
      orderDetailTotal.textContent = order.total || '₹0';
    }

    const orderDetailPaymentTag = document.getElementById('order-detail-payment-tag');
    if (orderDetailPaymentTag) {
      if (order.isPaidOnline === true || order.paymentMethod === 'online') {
        orderDetailPaymentTag.className = 'readonly-payment-tag payment-online';
        orderDetailPaymentTag.innerHTML = '<i class="fa-solid fa-circle-check"></i> Paid Online';
      } else if (order.doorstepUpi === true || order.paymentMethod === 'doorstep_upi') {
        orderDetailPaymentTag.className = 'readonly-payment-tag payment-upi';
        orderDetailPaymentTag.innerHTML = '<i class="fa-solid fa-qrcode"></i> Paid via Doorstep UPI';
      } else {
        orderDetailPaymentTag.className = 'readonly-payment-tag payment-cod';
        orderDetailPaymentTag.innerHTML = '<i class="fa-solid fa-money-bill-wave"></i> Cash on Delivery (COD)';
      }
    }

    updateModalStatusUI(order);

    if (modalOrderBackdrop) {
      modalOrderBackdrop.classList.add('open');
      backNav.pushStep('modal-order', () => modalOrderBackdrop.classList.remove('open'));
    }
  }

  function closeOrderManageModal() {
    if (modalOrderBackdrop) modalOrderBackdrop.classList.remove('open');
    backNav.removeStep('modal-order');
  }

  function renderOrderModalReadonlyItems(order) {
    if (!orderItemsReadonlyList) return;

    let items = [];
    if (Array.isArray(order.items) && order.items.length > 0) {
      items = order.items.map(it => ({
        name: it.name || 'Dish Item',
        quantity: Math.max(1, Number(it.quantity) || 1),
        price: parseFloat(it.price) || 0
      }));
    } else if (order.itemsSummary) {
      const parsedPrice = parseFloat(String(order.total || '0').replace(/[^0-9.]/g, '')) || 0;
      items = [{
        name: order.itemsSummary,
        quantity: 1,
        price: parsedPrice
      }];
    }

    const totalQty = items.reduce((acc, it) => acc + it.quantity, 0);
    if (orderEditItemsCount) {
      orderEditItemsCount.textContent = `${totalQty} item${totalQty === 1 ? '' : 's'}`;
    }

    if (items.length === 0) {
      orderItemsReadonlyList.innerHTML = `
        <div style="padding: 14px 8px; color: var(--admin-text-muted); font-size: 0.88rem; text-align: center;">
          No items listed in this order receipt.
        </div>
      `;
      return;
    }

    orderItemsReadonlyList.innerHTML = items.map(it => {
      const lineSubtotal = Math.round(it.price * it.quantity);
      const unitPriceStr = it.price > 0 && it.quantity > 1 ? `₹${Math.round(it.price)} ea` : '';
      const safeName = escapeHtml(it.name);
      return `
        <div class="order-item-readonly-row">
          <div class="item-readonly-left">
            <span class="item-readonly-qty-badge">${parseInt(it.quantity) || 1}x</span>
            <span class="item-readonly-name" title="${safeName}">${safeName}</span>
          </div>
          <div class="item-readonly-pricing">
            ${unitPriceStr ? `<span class="item-readonly-unit-price">${unitPriceStr}</span>` : ''}
            <span class="item-readonly-subtotal">₹${lineSubtotal}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  function updateModalStatusUI(order) {
    const status = order.status || 'accepted';
    let statusLabel = '';
    if (status === 'cancelled') statusLabel = 'Cancelled';
    else if (status === 'undelivered') statusLabel = 'Undelivered (Returned)';
    else if (status === 'cooking') statusLabel = 'Preparing';
    else if (status === 'ready_for_pickup') statusLabel = 'Ready to Dispatch';
    else if (status === 'on_the_way') statusLabel = 'Dispatched';
    else if (status === 'delivered') statusLabel = 'Delivered';
    else if (status === 'accepted' || status === 'pending') statusLabel = 'Accepted';
    else statusLabel = order.statusLabel || status;

    if (orderModalStatusBadge) {
      orderModalStatusBadge.className = `order-modal-status-badge status-${status}`;
      orderModalStatusBadge.innerHTML = `<span class="status-pulse-dot"></span> ${escapeHtml(statusLabel)}`;
    }

    // Pipeline ranks for status progression (Irreversible forward-only)
    // 0: Accepted -> 1: Preparing -> 2: Ready to Dispatch -> 3: Dispatched -> 4: Delivered
    const STATUS_RANKS = {
      'pending': -1,
      'accepted': 0,
      'cooking': 1,
      'ready_for_pickup': 2,
      'on_the_way': 3,
      'delivered': 4,
      'undelivered': 4
    };
    const currentRank = STATUS_RANKS[status] !== undefined ? STATUS_RANKS[status] : 0;

    // Update active and locked status pills
    orderStatusStepPills.forEach(pill => {
      const pillStatus = pill.getAttribute('data-status');
      const pillRank = STATUS_RANKS[pillStatus] !== undefined ? STATUS_RANKS[pillStatus] : 0;
      
      const isActive = pillStatus === status;
      pill.classList.toggle('active', isActive);

      // Lock passed steps so admins clearly see completed stages cannot be reversed
      if (pillRank < currentRank) {
        pill.classList.add('status-passed-locked');
        pill.setAttribute('disabled', 'true');
        pill.setAttribute('title', `Step "${pillStatus.replace(/_/g, ' ')}" already passed • Cannot be reversed`);
      } else if (pillRank === currentRank) {
        pill.classList.remove('status-passed-locked');
        pill.removeAttribute('disabled');
        pill.setAttribute('title', `Current order status: ${statusLabel}`);
      } else {
        pill.classList.remove('status-passed-locked');
        pill.removeAttribute('disabled');
        pill.setAttribute('title', `Advance order to ${pillStatus.replace(/_/g, ' ')}`);
      }
    });

    if (orderDetailEta && order.eta) {
      orderDetailEta.textContent = order.eta;
    }

    // Configure the Advance Status action button
    if (btnModalAdvanceStatus && btnModalAdvanceText) {
      if (status === 'cancelled' || status === 'undelivered') {
        btnModalAdvanceStatus.disabled = true;
        btnModalAdvanceStatus.removeAttribute('data-next');
        btnModalAdvanceStatus.style.background = '#FEE2E2';
        btnModalAdvanceStatus.style.color = '#DC2626';
        btnModalAdvanceStatus.style.border = '1px solid #FECACA';
        btnModalAdvanceText.textContent = status === 'cancelled' ? '❌ Order Cancelled' : '⚠️ Undelivered (Returned)';
        if (btnModalRejectOrder) btnModalRejectOrder.style.display = 'none';
      } else {
        btnModalAdvanceStatus.style.background = '';
        btnModalAdvanceStatus.style.color = '';
        btnModalAdvanceStatus.style.border = '';
        if (btnModalRejectOrder) {
          btnModalRejectOrder.style.display = (status === 'accepted' || status === 'pending') ? 'inline-flex' : 'none';
        }

        if (status === 'accepted' || status === 'pending') {
          btnModalAdvanceStatus.disabled = false;
          btnModalAdvanceStatus.setAttribute('data-next', 'cooking');
          btnModalAdvanceText.textContent = '🔥 Start Preparing';
        } else if (status === 'cooking') {
          btnModalAdvanceStatus.disabled = false;
          btnModalAdvanceStatus.setAttribute('data-next', 'ready_for_pickup');
          btnModalAdvanceText.textContent = '📦 Pack & Ready to Dispatch';
        } else if (status === 'ready_for_pickup') {
          btnModalAdvanceStatus.disabled = true;
          btnModalAdvanceStatus.removeAttribute('data-next');
          btnModalAdvanceText.innerHTML = '<i class="fa-solid fa-box"></i> Ready on Shelf • Enter Code on Bag to Dispatch';
        } else if (status === 'on_the_way') {
          btnModalAdvanceStatus.disabled = true;
          btnModalAdvanceStatus.removeAttribute('data-next');
          btnModalAdvanceText.innerHTML = '<i class="fa-solid fa-motorcycle"></i> Out for Delivery (Rider Task)';
        } else if (status === 'delivered') {
          btnModalAdvanceStatus.disabled = true;
          btnModalAdvanceStatus.removeAttribute('data-next');
          btnModalAdvanceText.textContent = 'Order Delivered 🎉';
        }
      }
    }
  }

  // Quick 1-Click Status Pipeline Pills Click Handlers
  orderStatusStepPills.forEach(pill => {
    pill.addEventListener('click', () => {
      const orderId = orderEditId ? orderEditId.value : null;
      if (!orderId) return;

      const targetStatus = pill.getAttribute('data-status');
      if (!targetStatus) return;

      const STATUS_RANKS = {
        'pending': -1,
        'accepted': 0,
        'cooking': 1,
        'ready_for_pickup': 2,
        'on_the_way': 3,
        'delivered': 4,
        'undelivered': 4
      };

      const order = (dataService.getOrderById ? dataService.getOrderById(orderId) : null) || dataService.getOrders().find(o => o.id === orderId);
      if (order && order.status === 'cancelled') {
        showToast('🔒 Cancelled Order: Cannot modify status of a cancelled order!', 'warning');
        return;
      }
      if (order && (order.status === 'delivered' || order.status === 'undelivered')) {
        showToast('🔒 Finalized Order: Order has reached its final delivery state!', 'warning');
        return;
      }
      const currentRank = order && STATUS_RANKS[order.status] !== undefined ? STATUS_RANKS[order.status] : 0;
      const targetRank = STATUS_RANKS[targetStatus] !== undefined ? STATUS_RANKS[targetStatus] : -1;

      // STEP-BY-STEP FORWARD PROGRESSION: Must move to Preparing before Ready to Dispatch
      if (targetStatus === 'ready_for_pickup' && (order?.status === 'accepted' || order?.status === 'pending')) {
        showToast('🔥 Start Preparing first: Move the order to "Preparing" before packing for dispatch!', 'warning');
        return;
      }

      // STRICT CHECK: Cannot reverse or set to previous/current status
      if (targetRank <= currentRank) {
        showToast('🔒 Cannot Reverse Status: Order status pipeline is permanent and forward-only!', 'warning');
        return;
      }

      // STRICT: Only Delivery Boy / Rider can pick up (on_the_way) and mark delivered (delivered)!
      if (targetStatus === 'on_the_way') {
        showToast('🛵 Rider Privilege: Only the assigned Delivery Partner can pick up and dispatch orders from the kitchen shelf!', 'warning');
        return;
      }
      if (targetStatus === 'delivered') {
        showToast('🛵 Delivery Partner Privilege: Only the assigned Delivery Partner can mark an order Delivered at the customer doorstep!', 'warning');
        return;
      }

      const updated = dataService.updateOrderStatus(orderId, targetStatus);
      if (targetStatus !== 'accepted' && targetStatus !== 'pending' && isKitchenAlarmRinging) {
        stopKitchenAlarm(true, { orderId });
      }

      if (updated) {
        updateModalStatusUI(updated);
        showToast(`Order status updated to "${updated.statusLabel || targetStatus}"!`, 'success');
        renderOrders();
        if (updated.serverPromise) {
          updated.serverPromise.catch(err => {
            showToast(`⚠️ Could not update order ${orderId}: ${err?.message || 'Server rejected transition'}`, 'error');
            const latestOrder = (dataService.getOrderById ? dataService.getOrderById(orderId) : null) || dataService.getOrders().find(o => o.id === orderId);
            if (latestOrder) updateModalStatusUI(latestOrder);
            renderOrders();
          });
        }
      }
    });
  });

  // Advance Status Modal Action Button Click Handler
  if (btnModalAdvanceStatus) {
    btnModalAdvanceStatus.addEventListener('click', () => {
      const orderId = orderEditId ? orderEditId.value : null;
      const nextStatus = btnModalAdvanceStatus.getAttribute('data-next');
      if (!orderId || !nextStatus) return;

      const order = (dataService.getOrderById ? dataService.getOrderById(orderId) : null) || dataService.getOrders().find(o => o.id === orderId);
      if (order && (order.status === 'cancelled' || order.status === 'delivered' || order.status === 'undelivered')) {
        showToast('🔒 Finalized Order: Cannot advance a finalized or cancelled order!', 'warning');
        return;
      }

      // STRICT: Only Delivery Boy / Rider can pick up (on_the_way) and mark delivered (delivered)!
      if (nextStatus === 'on_the_way') {
        showToast('🛵 Rider Privilege: Only the assigned Delivery Partner can pick up and dispatch orders from the kitchen shelf!', 'warning');
        return;
      }
      if (nextStatus === 'delivered') {
        showToast('🛵 Delivery Partner Privilege: Only the assigned Delivery Partner can mark an order Delivered at the customer doorstep!', 'warning');
        return;
      }

      const updated = dataService.updateOrderStatus(orderId, nextStatus);
      if (nextStatus !== 'accepted' && nextStatus !== 'pending' && isKitchenAlarmRinging) {
        stopKitchenAlarm(true, { orderId });
      }

      if (updated) {
        updateModalStatusUI(updated);
        showToast(`Order advanced to "${updated.statusLabel || nextStatus}"!`, 'success');
        renderOrders();
        if (updated.serverPromise) {
          updated.serverPromise.catch(err => {
            showToast(`⚠️ Could not advance order ${orderId}: ${err?.message || 'Server rejected transition'}`, 'error');
            const latestOrder = (dataService.getOrderById ? dataService.getOrderById(orderId) : null) || dataService.getOrders().find(o => o.id === orderId);
            if (latestOrder) updateModalStatusUI(latestOrder);
            renderOrders();
          });
        }
      }
    });
  }

  // Close Order Modal Handlers
  if (modalOrderClose) modalOrderClose.addEventListener('click', closeOrderManageModal);
  if (btnCancelOrder) btnCancelOrder.addEventListener('click', closeOrderManageModal);
  if (modalOrderBackdrop) {
    modalOrderBackdrop.addEventListener('click', (e) => {
      if (e.target === modalOrderBackdrop) closeOrderManageModal();
    });
  }

  // 1-Click KOT & Thermal Receipt Printing (58mm / 80mm)
  const btnModalPrintKot = document.getElementById('btn-modal-print-kot');
  if (btnModalPrintKot) {
    btnModalPrintKot.addEventListener('click', () => {
      const orderId = orderEditId ? orderEditId.value : null;
      if (!orderId) return;
      const order = (dataService.getOrderById ? dataService.getOrderById(orderId) : null) || dataService.getOrders().find(o => o.id === orderId);
      if (order) {
        printOrderKOT(order);
      }
    });
  }

  function printOrderKOT(order) {
    if (!order) return;
    const printArea = document.getElementById('kot-print-area');
    if (!printArea) return;

    const rawPhone = extractPhoneFromOrder(order, dataService.getAllAddressesRaw()) || order.customerPhone || order.phone || 'N/A';
    const cleanAddr = cleanDeliveryAddress(order.address || order.deliveryAddress || 'Doorstep Delivery');
    const bagCode = String(order.pickupCode || (order.id ? String(order.id).replace(/\D/g, '').slice(-4) : '0000')).padStart(4, '0');
    const displayOrderId = formatDisplayOrderId(order.id, bagCode);
    const noteText = (order.notes || order.kitchenNotes || order.customerNotes || (order.addressDetails && order.addressDetails.instructions) || '').trim();

    let paymentLabel = 'CASH ON DELIVERY (COD)';
    if (order.isPaidOnline === true || order.paymentMethod === 'online') {
      paymentLabel = 'PAID ONLINE';
    } else if (order.doorstepUpi === true || order.paymentMethod === 'doorstep_upi') {
      paymentLabel = 'DOORSTEP UPI';
    }

    const dateStr = new Date(order.createdAt || Date.now()).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });

    const items = Array.isArray(order.items) ? order.items : [];
    const itemsRows = items.length > 0 ? items.map(item => `
      <tr>
        <td style="text-align: left; padding: 3px 0; font-weight: 700; width: 15%;">${item.quantity || 1}x</td>
        <td style="text-align: left; padding: 3px 0; width: 60%;">${escapeHtml(item.name || 'Food Item')}</td>
        <td style="text-align: right; padding: 3px 0; font-weight: 700; width: 25%;">₹${Math.round((item.price || 0) * (item.quantity || 1))}</td>
      </tr>
    `).join('') : `
      <tr>
        <td style="text-align: left; padding: 3px 0; font-weight: 700; width: 15%;">1x</td>
        <td style="text-align: left; padding: 3px 0; width: 60%;">${escapeHtml(order.itemsSummary || 'Assorted Dishes')}</td>
        <td style="text-align: right; padding: 3px 0; font-weight: 700; width: 25%;">${escapeHtml(order.total || '₹0')}</td>
      </tr>
    `;

    printArea.innerHTML = `
      <div class="kot-receipt-ticket">
        <div class="kot-center">
          <h2 style="margin: 0; font-size: 16px; font-weight: 900; letter-spacing: 1px;">SAVERA PARADISE</h2>
          <div style="font-size: 11px; margin-top: 2px;">*** KITCHEN ORDER TICKET (KOT) ***</div>
        </div>
        <div class="kot-divider">================================</div>
        <div class="kot-row"><span>ORDER NO:</span> <strong>${escapeHtml(displayOrderId)}</strong></div>
        <div class="kot-row"><span>BAG PICKUP CODE:</span> <strong style="font-size:15px; letter-spacing: 1px;">#${escapeHtml(bagCode)}</strong></div>
        <div class="kot-row"><span>DATE/TIME:</span> <span>${dateStr}</span></div>
        <div class="kot-row"><span>PAYMENT:</span> <strong>${paymentLabel}</strong></div>
        <div class="kot-divider">--------------------------------</div>
        <div class="kot-section-title">CUSTOMER DETAILS:</div>
        <div class="kot-row"><span>Name:</span> <strong>${escapeHtml(order.customerName || 'Online Guest')}</strong></div>
        <div class="kot-row"><span>Phone:</span> <strong>${escapeHtml(rawPhone)}</strong></div>
        <div style="margin-top: 4px; font-size: 11px;">
          <strong>Address:</strong><br>${escapeHtml(cleanAddr)}
        </div>
        ${noteText ? `<div style="margin-top: 4px; font-size: 11px; background: #e5e7eb; padding: 4px; border-radius: 4px;"><strong>Note:</strong> ${escapeHtml(noteText)}</div>` : ''}
        <div class="kot-divider">--------------------------------</div>
        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
          <thead>
            <tr style="border-bottom: 1px dashed #000;">
              <th style="text-align: left;">QTY</th>
              <th style="text-align: left;">ITEM</th>
              <th style="text-align: right;">AMT</th>
            </tr>
          </thead>
          <tbody>
            ${itemsRows}
          </tbody>
        </table>
        <div class="kot-divider">--------------------------------</div>
        ${Number(order.packagingFee || order.packingCharge || 0) > 0 ? `<div class="kot-row"><span>Packaging Fee:</span> <span>₹${Number(order.packagingFee || order.packingCharge || 0)}</span></div>` : ''}
        ${Number(order.deliveryFee || 0) > 0 ? `<div class="kot-row"><span>Delivery Fee:</span> <span>₹${Number(order.deliveryFee || 0)}</span></div>` : ''}
        ${Number(order.discount || order.discountAmount || order.couponDiscount || 0) > 0 ? `<div class="kot-row"><span>Coupon Discount:</span> <span>-₹${Number(order.discount || order.discountAmount || order.couponDiscount || 0)}</span></div>` : ''}
        <div class="kot-row" style="font-size: 13px; font-weight: 900;">
          <span>TOTAL AMOUNT:</span>
          <span>${escapeHtml(order.total || `₹${order.totalAmount || 0}`)}</span>
        </div>
        <div class="kot-divider">================================</div>
        <div class="kot-center" style="font-size: 10px; margin-top: 6px;">
          PREPARE FRESH & DELIVER HOT<br>
          Thank you for ordering with Savera Paradise!
        </div>
      </div>
    `;

    setTimeout(() => {
      window.print();
    }, 80);
  }

  // Order Cancellation Controller
  const btnModalRejectOrder = document.getElementById('btn-modal-reject-order');
  const modalCancelOrderBackdrop = document.getElementById('modal-cancel-order-backdrop');
  const modalCancelOrderClose = document.getElementById('modal-cancel-order-close');
  const btnDismissCancelModal = document.getElementById('btn-dismiss-cancel-modal');
  const btnConfirmCancelOrder = document.getElementById('btn-confirm-cancel-order');
  const cancelOrderIdLabel = document.getElementById('cancel-order-id-label');
  const cancelOrderNote = document.getElementById('cancel-order-note');
  let selectedCancelReason = 'Item(s) Out of Stock';

  const cancelReasonPills = document.querySelectorAll('.cancel-reason-pill');
  cancelReasonPills.forEach(pill => {
    pill.addEventListener('click', () => {
      cancelReasonPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      selectedCancelReason = pill.getAttribute('data-reason') || 'Cancelled by Kitchen';
    });
  });

  function openCancelOrderModal(orderId) {
    if (!modalCancelOrderBackdrop) return;
    if (cancelOrderIdLabel) cancelOrderIdLabel.textContent = orderId;
    if (cancelOrderNote) cancelOrderNote.value = '';
    modalCancelOrderBackdrop.classList.add('open');
    modalCancelOrderBackdrop.style.display = 'flex';
    backNav.pushStep('modal-cancel-order', () => {
      if (modalCancelOrderBackdrop) {
        modalCancelOrderBackdrop.classList.remove('open');
        modalCancelOrderBackdrop.style.display = 'none';
      }
    });
  }

  function closeCancelOrderModal() {
    if (modalCancelOrderBackdrop) {
      modalCancelOrderBackdrop.classList.remove('open');
      modalCancelOrderBackdrop.style.display = 'none';
    }
    backNav.removeStepDirect('modal-cancel-order');
  }

  if (btnModalRejectOrder) {
    btnModalRejectOrder.addEventListener('click', () => {
      const orderId = orderEditId ? orderEditId.value : null;
      if (!orderId) {
        showToast('No order selected to cancel.', 'warning');
        return;
      }
      openCancelOrderModal(orderId);
    });
  }

  if (modalCancelOrderClose) modalCancelOrderClose.addEventListener('click', closeCancelOrderModal);
  if (btnDismissCancelModal) btnDismissCancelModal.addEventListener('click', closeCancelOrderModal);
  if (modalCancelOrderBackdrop) {
    modalCancelOrderBackdrop.addEventListener('click', (e) => {
      if (e.target === modalCancelOrderBackdrop) closeCancelOrderModal();
    });
  }

  if (btnConfirmCancelOrder) {
    btnConfirmCancelOrder.addEventListener('click', () => {
      const orderId = orderEditId ? orderEditId.value : null;
      if (!orderId) return;

      const customNote = cancelOrderNote ? cancelOrderNote.value.trim() : '';
      const fullReason = customNote ? `${selectedCancelReason}: ${customNote}` : selectedCancelReason;

      const updated = dataService.updateOrderStatus(orderId, 'cancelled', 'admin', { cancellationReason: fullReason });
      if (!updated) {
        showToast(`⚠️ Order ${orderId} cannot be cancelled because kitchen preparation has already begun or it is out for delivery.`, 'warning');
        closeCancelOrderModal();
        return;
      }
      if (isKitchenAlarmRinging) {
        stopKitchenAlarm(true, { orderId });
      }

      closeCancelOrderModal();
      closeOrderManageModal();
      showToast(`❌ Order ${orderId} has been cancelled.`, 'info');
      renderOrders();
    });
  }

  function parseTimestampMs(val) {
    if (!val) return Date.now();
    if (typeof val === 'number') return isNaN(val) ? Date.now() : val;
    const parsed = new Date(val).getTime();
    return isNaN(parsed) ? Date.now() : parsed;
  }

  function formatTimeAgo(timestamp) {
    if (!timestamp) return 'Just now';
    const timeMs = parseTimestampMs(timestamp);
    const seconds = Math.floor((Date.now() - timeMs) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  function setActiveOrderFilter(targetFilter) {
    activeOrderFilter = targetFilter || 'accepted';
    adminOrdersPage = 1;

    // Highlight matching KPI card
    document.querySelectorAll('.orders-kpi-grid .kpi-card[data-filter]').forEach(c => {
      c.classList.toggle('active', c.getAttribute('data-filter') === activeOrderFilter);
    });

    // Highlight All Orders pill button if filter is 'all'
    const btnAllOrders = document.getElementById('btn-filter-all-orders');
    if (btnAllOrders) {
      btnAllOrders.classList.toggle('active', activeOrderFilter === 'all');
    }

    // Keep tabs synced if present
    if (ordersStatusTabs) {
      ordersStatusTabs.querySelectorAll('.order-filter-tab').forEach(t => {
        t.classList.toggle('active', t.getAttribute('data-filter') === activeOrderFilter);
      });
    }

    renderOrders();
  }

  // Interactive KPI Cards: Tap any KPI card (Accepted, Preparing, Ready, Dispatched, Delivered, Cancelled)
  document.querySelectorAll('.orders-kpi-grid .kpi-card[data-filter]').forEach(card => {
    card.addEventListener('click', () => {
      const targetFilter = card.getAttribute('data-filter');
      if (targetFilter) {
        setActiveOrderFilter(targetFilter);
      }
    });
  });

  // All Orders Pill Button
  const btnAllOrders = document.getElementById('btn-filter-all-orders');
  if (btnAllOrders) {
    btnAllOrders.addEventListener('click', () => {
      setActiveOrderFilter('all');
    });
  }

  // Order Filters with Auto-Center Scroll (for backward compatibility if tabs are present)
  if (ordersStatusTabs) {
    ordersStatusTabs.querySelectorAll('.order-filter-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.getAttribute('data-filter');
        setActiveOrderFilter(target);
      });
    });

    ordersStatusTabs.addEventListener('wheel', (e) => {
      if (e.deltaY !== 0 && ordersStatusTabs.scrollWidth > ordersStatusTabs.clientWidth) {
        e.preventDefault();
        ordersStatusTabs.scrollLeft += e.deltaY;
      }
    }, { passive: false });
  }

  orderSearchInput.addEventListener('input', (e) => {
    orderSearchQuery = e.target.value.toLowerCase().trim();
    adminOrdersPage = 1;
    renderOrders();
  });

  const refreshOrderButtons = document.querySelectorAll('#btn-refresh-orders, #btn-refresh-orders-pill, .btn-refresh-orders');
  if (refreshOrderButtons.length > 0) {
    refreshOrderButtons.forEach(btn => {
      btn.addEventListener('click', async () => {
        refreshOrderButtons.forEach(b => b.classList.add('rotating'));
        try {
          await dataService.syncOrdersFromSupabase(true);
        } catch {}
        renderOrders();
        updateOrderBadges();
        refreshOrderButtons.forEach(b => b.classList.remove('rotating'));
        showToast('🔄 Orders updated!', 'info');
      });
    });
  }

  // ========================================================
  // 4C. KITCHEN ORDER PERSISTENT BEEPING ALARM & STOP ENGINE
  // ========================================================
  let kitchenAlarmInterval = null;
  let isKitchenAlarmRinging = false;
  let ringingOrdersQueue = [];
  const originalDocTitle = document.title || 'Savera Paradise Admin Portal';

  // Alarm Banner DOM Elements
  const kitchenAlarmBanner = document.getElementById('kitchen-alarm-banner');
  const alarmBannerOrderId = document.getElementById('alarm-banner-order-id');
  const alarmOrdersCountBadge = document.getElementById('alarm-orders-count-badge');
  const alarmBannerCustomer = document.getElementById('alarm-banner-customer');
  const alarmBannerTotal = document.getElementById('alarm-banner-total');
  const alarmBannerItems = document.getElementById('alarm-banner-items');
  const btnStopAlarm = document.getElementById('btn-stop-alarm');
  const btnViewAlarmOrder = document.getElementById('btn-view-alarm-order');
  const btnAdminSoundTest = document.getElementById('btn-admin-sound-test');
  const soundPillText = document.getElementById('sound-pill-text');
  const soundPillIcon = document.getElementById('sound-pill-icon');

  // Delegated to notificationService with DynamicsCompressor and volume safeguards
  function playKitchenChime() {
    try {
      playNotificationSound('kitchen_alarm');
    } catch (err) {
      console.warn('[KitchenAlarm] Chime error:', err);
    }
  }

  // ========================================================
  // PERSISTENT ALARM ACKNOWLEDGEMENT & DEDUPLICATION STORE
  // ========================================================
  const ACKNOWLEDGED_ALARMS_KEY = 'quickbite_acknowledged_alarms';

  function getAcknowledgedAlarms() {
    try {
      const stored = JSON.parse(localStorage.getItem(ACKNOWLEDGED_ALARMS_KEY) || '[]');
      const now = Date.now();
      // Keep acknowledged records for 24 hours
      const filtered = stored.filter(item => item && (now - Number(item.timestamp || 0) < 24 * 60 * 60 * 1000));
      return new Map(filtered.map(item => [item.id, Number(item.timestamp || 0)]));
    } catch {
      return new Map();
    }
  }

  function markAlarmAcknowledged(orderIds) {
    if (!orderIds) return;
    const ids = Array.isArray(orderIds) ? orderIds : [orderIds];
    const map = getAcknowledgedAlarms();
    const now = Date.now();
    ids.filter(Boolean).forEach(id => {
      const clean = String(id).trim();
      map.set(clean, now);
      map.set(clean.replace(/^#/, ''), now);
    });
    try {
      const list = Array.from(map.entries()).map(([id, timestamp]) => ({ id, timestamp }));
      localStorage.setItem(ACKNOWLEDGED_ALARMS_KEY, JSON.stringify(list));
    } catch {}
  }

  function isAlarmAcknowledged(orderId) {
    if (!orderId) return false;
    const clean = String(orderId).trim();
    const map = getAcknowledgedAlarms();
    return map.has(clean) || map.has(clean.replace(/^#/, ''));
  }

  function startKitchenAlarm(order) {
    if (!order || !order.id) return;
    const cleanId = String(order.id).trim();

    // CRITICAL: NEVER ring alarm for orders that are already cooking or delivered
    if (order.status && order.status !== 'accepted' && order.status !== 'pending') {
      return;
    }
    // CRITICAL: If alarm was already acknowledged/stopped on another device or locally, do not ring
    if (isAlarmAcknowledged(cleanId) || order.alarmAcknowledged || order.alarmStoppedAt) {
      return;
    }
    // CRITICAL: Reject stale orders (>15 mins old) from triggering loud sirens on reconnect/refresh
    const orderAge = order.createdAt ? (Date.now() - parseTimestampMs(order.createdAt)) : 0;
    if (orderAge > 15 * 60 * 1000) {
      return;
    }

    if (!ringingOrdersQueue.some(o => o.id === order.id)) {
      ringingOrdersQueue.push(order);
    }

    isKitchenAlarmRinging = true;

    // Update banner UI details
    const latestOrder = ringingOrdersQueue[ringingOrdersQueue.length - 1] || order || {};
    if (alarmBannerOrderId) alarmBannerOrderId.textContent = latestOrder.id || '#QB-NEW';
    if (alarmBannerCustomer) alarmBannerCustomer.textContent = latestOrder.customerName || 'Online Guest';
    if (alarmBannerTotal) alarmBannerTotal.textContent = latestOrder.total || '₹0';
    if (alarmBannerItems) alarmBannerItems.textContent = latestOrder.itemsSummary || 'Customer Meal Order';

    if (alarmOrdersCountBadge) {
      if (ringingOrdersQueue.length > 1) {
        alarmOrdersCountBadge.style.display = 'inline-block';
        alarmOrdersCountBadge.textContent = `${ringingOrdersQueue.length} Orders`;
      } else {
        alarmOrdersCountBadge.style.display = 'none';
      }
    }

    if (kitchenAlarmBanner) {
      kitchenAlarmBanner.style.display = 'block';
    }

    document.body.classList.add('kitchen-alarm-ringing');

    if (btnAdminSoundTest) {
      btnAdminSoundTest.classList.add('sounding');
    }
    if (soundPillText) {
      soundPillText.textContent = 'ALARM RINGING!';
    }
    if (soundPillIcon) {
      soundPillIcon.className = 'fa-solid fa-bell fa-shake';
    }

    // Flash browser tab title via centralized notificationService
    flashTabTitle(`🚨 NEW ORDER ${latestOrder.id || ''}!`);

    // Trigger native Android background alarm loop if running inside Android APK
    if (typeof window !== 'undefined' && window.AndroidNative && typeof window.AndroidNative.startAlarm === 'function') {
      try {
        window.AndroidNative.startAlarm();
      } catch (e) {
        console.warn('[Admin] Native startAlarm failed:', e);
      }
    }

    // Play first chime burst immediately
    playKitchenChime();

    // Loop chime repeatedly every 1.6s UNTIL admin clicks STOP button
    if (kitchenAlarmInterval) clearInterval(kitchenAlarmInterval);
    kitchenAlarmInterval = setInterval(() => {
      if (isKitchenAlarmRinging) {
        playKitchenChime();
      } else {
        clearInterval(kitchenAlarmInterval);
        kitchenAlarmInterval = null;
      }
    }, 1600);
  }

  function stopKitchenAlarm(shouldBroadcast = true, extra = {}) {
    // Individual order progression: Acknowledge only this order and keep ringing if others remain in queue
    if (extra && extra.orderId && !extra.all) {
      const targetId = extra.orderId;
      markAlarmAcknowledged([targetId]);
      ringingOrdersQueue = ringingOrdersQueue.filter(o => o && o.id !== targetId);

      if (ringingOrdersQueue.length > 0) {
        const nextOrder = ringingOrdersQueue[0];
        if (alarmBannerOrderId) alarmBannerOrderId.textContent = nextOrder.id || 'NEW';
        if (alarmOrdersCountBadge) {
          alarmOrdersCountBadge.textContent = `${ringingOrdersQueue.length} Order${ringingOrdersQueue.length > 1 ? 's' : ''}`;
        }
        if (alarmBannerCustomer) alarmBannerCustomer.textContent = nextOrder.customerName || 'Customer';
        if (alarmBannerTotal) alarmBannerTotal.textContent = nextOrder.total || '₹0';
        if (alarmBannerItems) alarmBannerItems.textContent = nextOrder.itemsSummary || 'Order Items';
        return; // Retain alarm loop active for remaining orders
      }
    }

    const wasRinging = isKitchenAlarmRinging || ringingOrdersQueue.length > 0;
    const orderIds = ringingOrdersQueue.map(o => o?.id).filter(Boolean);
    if (extra && extra.orderId && !orderIds.includes(extra.orderId)) {
      orderIds.push(extra.orderId);
    }
    if (extra && Array.isArray(extra.orderIds)) {
      extra.orderIds.forEach(id => {
        if (id && !orderIds.includes(id)) orderIds.push(id);
      });
    }
    if (orderIds.length === 0) {
      const allOrders = dataService.getOrders();
      allOrders.filter(o => ((o.status || 'accepted') === 'accepted' || o.status === 'pending')).forEach(o => {
        if (o && o.id && !orderIds.includes(o.id)) orderIds.push(o.id);
      });
    }

    // Persist to acknowledged alarms set so no future reload or sync can replay
    markAlarmAcknowledged(orderIds);

    isKitchenAlarmRinging = false;
    if (kitchenAlarmInterval) {
      clearInterval(kitchenAlarmInterval);
      kitchenAlarmInterval = null;
    }

    try {
      if (typeof window !== 'undefined' && window.AndroidNative && typeof window.AndroidNative.stopAlarm === 'function') {
        window.AndroidNative.stopAlarm();
      }
    } catch {}

    stopFlashingTabTitle();
    ringingOrdersQueue = [];

    if (kitchenAlarmBanner) {
      kitchenAlarmBanner.style.display = 'none';
    }

    document.body.classList.remove('kitchen-alarm-ringing');

    if (btnAdminSoundTest) {
      btnAdminSoundTest.classList.remove('sounding');
    }
    if (soundPillText) {
      soundPillText.textContent = 'Alarm: Active';
    }
    if (soundPillIcon) {
      soundPillIcon.className = 'fa-solid fa-bell';
    }

    if (shouldBroadcast) {
      // Broadcast to all other devices & tabs over Supabase Realtime WebSocket and BroadcastChannel
      try {
        if (typeof dataService !== 'undefined' && dataService.broadcastStopAlarm) {
          dataService.broadcastStopAlarm({
            orderIds,
            timestamp: Date.now(),
            sourceDevice: 'admin_portal'
          });
        }
      } catch (err) {
        console.warn('[KitchenAlarm] Broadcast stop failed:', err);
      }
      showToast('🛑 Kitchen alarm stopped. Synced to all devices!', 'info');
    } else {
      if (wasRinging) {
        showToast('🛑 Kitchen alarm silenced (acknowledged from another device).', 'info');
      }
    }
  }

  // Stop Alarm Button Event Listener
  if (btnStopAlarm) {
    btnStopAlarm.addEventListener('click', (e) => {
      e.stopPropagation();
      stopKitchenAlarm(true);
    });
  }

  // View Order Button Event Listener
  if (btnViewAlarmOrder) {
    btnViewAlarmOrder.addEventListener('click', (e) => {
      e.stopPropagation();
      const displayedId = alarmBannerOrderId ? alarmBannerOrderId.textContent.trim() : null;
      const targetOrder = (displayedId && ringingOrdersQueue.find(o => o && o.id === displayedId)) || ringingOrdersQueue[0] || ringingOrdersQueue[ringingOrdersQueue.length - 1];
      const targetId = targetOrder?.id || displayedId;
      stopKitchenAlarm(true, { orderId: targetId });
      switchView('view-orders');
      if (targetId) {
        setTimeout(() => {
          openOrderManageModal(targetId);
        }, 120);
      }
    });
  }

  // Keyboard shortcut: Pressing Escape or Spacebar anywhere in Admin stops active alarm
  window.addEventListener('keydown', (e) => {
    if (isKitchenAlarmRinging && (e.key === 'Escape' || e.code === 'Space')) {
      const activeEl = document.activeElement;
      const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT');
      if (!isInput) {
        e.preventDefault();
        stopKitchenAlarm(true);
      }
    }
  });

  // Header sound test button
  if (btnAdminSoundTest) {
    btnAdminSoundTest.addEventListener('click', async () => {
      if (isKitchenAlarmRinging) {
        stopKitchenAlarm(true);
      } else {
        const ctx = getAudioContext();
        if (ctx && ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
        if (getSystemNotificationPermission() === 'default') {
          await requestSystemNotificationPermission();
        }
        playNotificationSound('new_order');
        sendSystemNotification({
          title: '🍗 Kitchen Alert System Active',
          body: 'Savera Paradise Admin Portal is connected and ready for live orders.',
          tag: 'admin-test-alert'
        });
        showToast('🔊 Kitchen order alert chime tested! Volume & notifications active.', 'success');
      }
    });
  }

  // Unlock audio on any user gesture across the admin portal (persists across gestures for iPad/tablet longevity)
  const unlockAudioOnGesture = () => {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  };
  window.addEventListener('pointerdown', unlockAudioOnGesture, { passive: true });
  window.addEventListener('keydown', unlockAudioOnGesture, { passive: true });
  window.addEventListener('touchstart', unlockAudioOnGesture, { passive: true });
  window.addEventListener('touchend', unlockAudioOnGesture, { passive: true });
  window.addEventListener('click', unlockAudioOnGesture, { passive: true });

  // Known order IDs set initialized at startup
  const knownOrderIds = new Set();
  const existingOrders = dataService.getOrders();
  if (Array.isArray(existingOrders)) {
    existingOrders.forEach(o => {
      if (o && o.id) knownOrderIds.add(o.id);
    });
  }

  const recentAlertedOrderIds = new Map();

  function handleIncomingOrderAlert(orderData) {
    if (!orderData || !orderData.id) return;
    const cleanId = String(orderData.id).trim();
    knownOrderIds.add(orderData.id);
    knownOrderIds.add(cleanId);

    // 1. Deduplicate rapid duplicate events across storage, customEvent, and BroadcastChannel
    const now = Date.now();
    const lastAlerted = recentAlertedOrderIds.get(cleanId) || 0;
    if (now - lastAlerted < 5000) {
      return;
    }
    recentAlertedOrderIds.set(cleanId, now);

    // 2. Reject stale orders (>15 mins old) from ringing kitchen siren on reconnect/refresh
    const orderAge = orderData.createdAt ? (now - parseTimestampMs(orderData.createdAt)) : 0;
    if (orderAge > 15 * 60 * 1000) {
      renderOrders();
      updateOrderBadges();
      return;
    }

    // 3. CRITICAL: NEVER ring alarm or notify as a new order if it was already cooking or delivered elsewhere!
    if (orderData.status && orderData.status !== 'accepted' && orderData.status !== 'pending') {
      return;
    }

    // 4. CRITICAL: If alarm was already acknowledged/stopped locally or remotely, do not ring!
    if (isAlarmAcknowledged(cleanId) || orderData.alarmAcknowledged || orderData.alarmStoppedAt) {
      renderOrders();
      updateOrderBadges();
      return;
    }

    // 5. Only ring alarm and push notifications if admin or owner session is actively unlocked!
    if (!isStaffSessionActive('admin') && !isStaffSessionActive('owner')) {
      renderOrders();
      updateOrderBadges();
      return;
    }

    startKitchenAlarm(orderData);

    // Desktop Push Notification
    const dispId = formatDisplayOrderId(orderData.id, orderData.pickupCode);
    sendSystemNotification({
      title: `🚨 Savera Paradise Kitchen: New Order ${dispId}!`,
      body: `${orderData.customerName || 'Customer'} • ${orderData.itemsSummary || 'Food order'} (Total: ${orderData.total || ''})`,
      tag: `admin-order-${orderData.id}`,
      data: { orderId: orderData.id, url: '/admin.html' },
      onClick: () => {
        switchView('view-orders');
      }
    });
    flashTabTitle(`🚨 NEW ORDER ${dispId}!`);
    showToast(`🔔 New incoming order ${dispId} received! (${orderData.customerName || 'Guest'} - ${orderData.total || ''})`, 'success');

    renderOrders();
    updateOrderBadges();
  }

  const ADMIN_ALERTED_STATUSES_KEY = 'quickbite_admin_alerted_statuses';

  function getAdminAlertedMap() {
    try {
      const raw = localStorage.getItem(ADMIN_ALERTED_STATUSES_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function markAdminAlerted(orderId, status) {
    if (!orderId || !status) return;
    try {
      const map = getAdminAlertedMap();
      map[`${orderId}_${status}`] = Date.now();
      const now = Date.now();
      const entries = Object.entries(map).filter(([, ts]) => now - Number(ts || 0) < 7 * 24 * 60 * 60 * 1000);
      localStorage.setItem(ADMIN_ALERTED_STATUSES_KEY, JSON.stringify(Object.fromEntries(entries.slice(-200))));
    } catch {}
  }

  function hasAdminBeenAlerted(orderId, status) {
    if (!orderId || !status) return false;
    try {
      const map = getAdminAlertedMap();
      return Boolean(map[`${orderId}_${status}`]);
    } catch {
      return false;
    }
  }

  // Pre-seed any existing completed orders as alerted on admin startup
  try {
    const initOrders = dataService.getOrders();
    if (Array.isArray(initOrders)) {
      initOrders.forEach(o => {
        if (o && o.id && (o.status === 'delivered' || o.status === 'cancelled')) {
          markAdminAlerted(o.id, o.status);
        }
      });
    }
  } catch {}

  const recentAdminStatusSyncs = new Map();

  function handleAdminOrderStatusSync(payload) {
    if (!payload) return;

    const orderId = payload.orderId || payload.order?.id;
    const status = payload.status || payload.order?.status;
    if (!orderId || !status) return;

    // Deduplicate identical status transitions across channels within 3 seconds
    const syncKey = `${orderId}:${status}`;
    const now = Date.now();
    const lastSync = recentAdminStatusSyncs.get(syncKey) || 0;
    if (now - lastSync < 3000) {
      return;
    }
    recentAdminStatusSyncs.set(syncKey, now);

    const allOrders = dataService.getOrders();
    const order = payload.order || allOrders.find(o => o.id === orderId);
    const customer = order?.customerName || payload.customerName || 'Customer';

    // If order was in the ringing queue but has now been moved to cooking or beyond, dismiss it
    if (status !== 'accepted' && status !== 'pending') {
      const ringIdx = ringingOrdersQueue.findIndex(o => o && o.id === orderId);
      if (ringIdx !== -1) {
        ringingOrdersQueue.splice(ringIdx, 1);
        if (ringingOrdersQueue.length === 0 && isKitchenAlarmRinging) {
          stopKitchenAlarm(false);
        } else if (ringingOrdersQueue.length > 0 && isKitchenAlarmRinging) {
          const nextOrder = ringingOrdersQueue[0];
          if (alarmBannerOrderId) alarmBannerOrderId.textContent = nextOrder.id;
          if (alarmBannerCustomer) alarmBannerCustomer.textContent = nextOrder.customerName || 'Customer';
        }
      }
    }

    // If order manage modal is open for this order, update modal live
    if (modalOrderBackdrop && modalOrderBackdrop.classList.contains('open') && orderEditId && orderEditId.value === orderId && order) {
      updateModalStatusUI(order);
    }

    // Prevent alerting admin about actions admin themselves performed in this panel
    if (payload.source === 'admin') {
      renderOrders();
      updateOrderBadges();
      return;
    }

    // 1. Stale Order Age Guard: If order is older than 20 minutes and status is delivered or cancelled,
    // NEVER alert it to the admin tab on reconnect, refresh, or tab restore!
    const orderAgeMs = order?.createdAt ? (Date.now() - parseTimestampMs(order.createdAt)) : 0;
    if ((status === 'delivered' || status === 'cancelled') && orderAgeMs > 20 * 60 * 1000) {
      markAdminAlerted(orderId, status);
      renderOrders();
      updateOrderBadges();
      return;
    }

    // 2. Status Transition Guard: If previous status matches current status, no new transition occurred
    if (payload.prevStatus && payload.prevStatus === status) {
      return;
    }

    // 3. Persistent Deduplication Guard: Check if admin was ALREADY alerted for this status
    if (hasAdminBeenAlerted(orderId, status)) {
      renderOrders();
      updateOrderBadges();
      return;
    }

    // Mark as alerted in persistent localStorage BEFORE triggering UI alert
    markAdminAlerted(orderId, status);
    const dispId = formatDisplayOrderId(orderId);

    if (status === 'on_the_way') {
      playNotificationSound('on_the_way');
      showToast(`🛵 Rider Dispatched: Order ${dispId} is out for delivery! (${customer})`, 'info');
      sendSystemNotification({
        title: `🛵 Order ${dispId} Out for Delivery!`,
        body: `Rider has picked up order for ${customer}. En route now.`,
        tag: `admin-dispatched-${orderId}`
      });
      flashTabTitle(`🛵 DISPATCHED: ${dispId}`);
    } else if (status === 'delivered') {
      playNotificationSound('delivered');
      showToast(`🎉 Order ${dispId} marked DELIVERED by Rider! (${customer})`, 'success');
      sendSystemNotification({
        title: `🎉 Order ${dispId} Delivered!`,
        body: `Order for ${customer} has been delivered successfully.`,
        tag: `admin-delivered-${orderId}`
      });
      flashTabTitle(`🎉 DELIVERED: ${dispId}`);
    } else if (status === 'undelivered') {
      playNotificationSound('cancelled');
      showToast(`⚠️ Order ${dispId} marked UNDELIVERED by Rider: Customer unreachable. Returning to kitchen.`, 'error');
      sendSystemNotification({
        title: `⚠️ Order ${dispId} Returning to Kitchen!`,
        body: `Customer unreachable at doorstep. Rider returning parcel to counter.`,
        tag: `admin-undelivered-${orderId}`
      });
      flashTabTitle(`⚠️ UNDELIVERED: ${dispId}`);
    } else if (status === 'cancelled') {
      playNotificationSound('cancelled');
      const actorLabel = payload.source === 'customer' || payload.actor === 'customer' ? 'Customer' : 'Staff';
      showToast(`❌ Order ${orderId} was CANCELLED by ${actorLabel}! (${customer})`, 'error');
      sendSystemNotification({
        title: `❌ Order ${dispId} Cancelled!`,
        body: `Order for ${customer} has been cancelled. Do not prepare.`,
        tag: `admin-cancelled-${orderId}`
      });
      flashTabTitle(`❌ CANCELLED: ${dispId}`);
    }

    renderOrders();
    updateOrderBadges();
  }

  function scanAndDetectNewOrders() {
    const latestList = dataService.getOrders();
    const newArrivals = latestList.filter(o => o && o.id && !knownOrderIds.has(o.id));
    if (newArrivals.length > 0) {
      newArrivals.forEach(o => knownOrderIds.add(o.id));

      const now = Date.now();
      // Trigger kitchen alarm for newly arrived orders that are NOT yet acknowledged and < 15 mins old
      const freshAcceptedList = newArrivals.filter(o => 
        ((o.status || 'accepted') === 'accepted' || o.status === 'pending') && 
        !o.alarmAcknowledged && 
        !o.alarmStoppedAt &&
        !isAlarmAcknowledged(o.id) &&
        (!o.createdAt || (now - parseTimestampMs(o.createdAt) < 15 * 60 * 1000))
      );
      if (freshAcceptedList.length > 0) {
        freshAcceptedList.forEach(freshAccepted => {
          const normId = String(freshAccepted.id).trim();
          const lastAlert = recentAlertedOrderIds.get(normId) || 0;
          if ((isStaffSessionActive('admin') || isStaffSessionActive('owner')) && (now - lastAlert >= 5000)) {
            recentAlertedOrderIds.set(normId, now);
            startKitchenAlarm(freshAccepted);

            const freshDispId = formatDisplayOrderId(freshAccepted.id, freshAccepted.pickupCode);
            sendSystemNotification({
              title: `🚨 Savera Paradise Kitchen: New Order ${freshDispId}! `,
              body: `${freshAccepted.customerName || 'Customer'} • ${freshAccepted.itemsSummary || 'Food order'} (Total: ${freshAccepted.total || ''})`,
              tag: `admin-order-${freshAccepted.id}`
            });
            flashTabTitle(`🚨 NEW ORDER ${freshDispId}!`);
          }
        });
      }

      renderOrders();
      updateOrderBadges();
    }
  }

  // Simulated Test Order Generator (Simulates customer order placement with full alarm)
  function generateTestOrder() {
    const dishes = dataService.getDishes();
    const availableDishes = dishes.filter(d => d.inStock !== false);
    const list = availableDishes.length > 0 ? availableDishes : dishes;
    const randomDish1 = list[Math.floor(Math.random() * list.length)] || { name: 'Signature Double Burger', price: 12.99 };
    const randomDish2 = list[Math.floor(Math.random() * list.length)] || { name: 'Crispy Golden Fries', price: 5.99 };

    const total = randomDish1.price + randomDish2.price;
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const newOrderId = `#QB-${randomNum}`;

    const names = ['Liam Walker', 'Olivia Diaz', 'Noah Bennett', 'Emma Watson', 'James Anderson'];
    const addresses = ['712 Hilltop St, Unit 4', '180 Ocean Ave', '95 Cedar Blvd', '302 Pine St, Apt 2B'];

    const newOrder = {
      id: newOrderId,
      createdAt: Date.now(),
      customerName: names[Math.floor(Math.random() * names.length)],
      deliveryAddress: addresses[Math.floor(Math.random() * addresses.length)],
      stepIndex: 0,
      status: 'accepted',
      statusLabel: 'Accepted',
      eta: '25 - 35 Minutes',
      isDemo: true,
      bypassClosedCheck: true,
      itemsSummary: `1x ${randomDish1.name}, 1x ${randomDish2.name}`,
      items: [
        { name: randomDish1.name, quantity: 1, price: randomDish1.price },
        { name: randomDish2.name, quantity: 1, price: randomDish2.price }
      ],
      total: `₹${Math.round(total)}`
    };

    // addOrder automatically dispatches 'new_order' event which triggers handleIncomingOrderAlert cleanly once
    dataService.addOrder(newOrder);
    knownOrderIds.add(newOrderId);
    renderOrders();
  }

  if (btnCreateOrderDemo) btnCreateOrderDemo.addEventListener('click', generateTestOrder);
  if (btnMockOrderHeader) btnMockOrderHeader.addEventListener('click', generateTestOrder);
  if (btnEmptyMakeOrder) btnEmptyMakeOrder.addEventListener('click', generateTestOrder);

  // Listen for storage events across tabs (Sync customer order placement with admin in real time)
  window.addEventListener('storage', (e) => {
    if (e.key === 'quickbite_alarm_stopped_sync' && e.newValue) {
      try {
        const payload = JSON.parse(e.newValue);
        stopKitchenAlarm(false, payload);
      } catch {
        stopKitchenAlarm(false);
      }
    }
    if (e.key === 'quickbite_latest_incoming_order' && e.newValue) {
      try {
        const orderData = JSON.parse(e.newValue);
        handleIncomingOrderAlert(orderData);
      } catch {}
    }
    if (e.key === 'quickbite_order_status_sync' && e.newValue) {
      try {
        const payload = JSON.parse(e.newValue);
        handleAdminOrderStatusSync(payload);
      } catch {}
    }
    if (e.key === 'quickbite_orders' || e.key === 'quickbite_orders_sync_ping') {
      scanAndDetectNewOrders();
      renderOrders();
      updateOrderBadges();
    }
    if (e.key === 'quickbite_categories') {
      renderCategories();
    }
    if (e.key === 'quickbite_dishes') {
      renderDishes();
    }
    if (e.key === 'quickbite_settings' || e.key === 'quickbite_settings_sync') {
      renderHoursAndRush();
      renderOffers();
      renderDeliveryOptions();
      updateRushUI();
    }
  });

  // Custom event listener within same window
  window.addEventListener('quickbite_data_changed', (e) => {
    if (e.detail?.type === 'kitchen_alarm') {
      if (e.detail?.action === 'stop_alarm') {
        stopKitchenAlarm(false, e.detail);
      }
    }
    if (e.detail?.type === 'orders') {
      if (e.detail?.action === 'new_order' && e.detail.order) {
        handleIncomingOrderAlert(e.detail.order);
      } else if (e.detail?.action === 'status_updated') {
        handleAdminOrderStatusSync(e.detail);
      } else {
        scanAndDetectNewOrders();
      }
      renderOrders();
      updateOrderBadges();
    }
    if (e.detail?.type === 'riders' || e.detail?.type === 'cash_settled' || e.detail?.type === 'rider_session') {
      renderOrders();
    }
    if (e.detail?.type === 'categories') renderCategories();
    if (e.detail?.type === 'dishes') renderDishes();
    if (e.detail?.type === 'settings') {
      renderHoursAndRush();
      renderOffers();
      renderDeliveryOptions();
      updateRushUI();
    }
    updateOrderBadges();
  });

// Cross-tab sync handled via DataService quickbite_data_changed event listener and storage triggers

  // ========================================================
  // 5. TOAST NOTIFICATION ENGINE (Samsung One UI Top Floating Pill)
  // ========================================================
  function showToast(message, type = 'info') {
    return showSamsungToast(message, type, {
      container: toastContainer,
      appName: 'Kitchen Admin',
      duration: 3800
    });
  }
  window.showToast = showToast;

  // ========================================================
  // 6. STORE TIMINGS & KITCHEN RUSH CONTROL
  // ========================================================
  const adminStoreStatusPill = document.getElementById('admin-store-status-pill');
  const headerStatusDot = document.getElementById('header-status-dot');
  const headerStatusText = document.getElementById('header-status-text');
  const adminLiveRushChip = document.getElementById('admin-live-rush-chip');
  const rushStatusDot = document.getElementById('rush-status-dot');
  const rushStatusChipText = document.getElementById('rush-status-chip-text');
  const rushModeBadge = document.getElementById('rush-mode-badge');

  // Rush Active Box elements
  const rushActiveStateBox = document.getElementById('rush-active-state-box');
  const rushActiveReason = document.getElementById('rush-active-reason');
  const rushTimerMin = document.getElementById('rush-timer-min');
  const rushTimerSec = document.getElementById('rush-timer-sec');
  const btnExtendRush10 = document.getElementById('btn-extend-rush-10');
  const btnResumeOrders = document.getElementById('btn-resume-orders');

  // Rush Setter Box elements
  const rushSetterBox = document.getElementById('rush-setter-box');
  const rushSliderVal = document.getElementById('rush-slider-val');
  const btnPauseTargetMins = document.getElementById('btn-pause-target-mins');
  const rushRangeSlider = document.getElementById('rush-range-slider');
  const rushPresetBtns = document.querySelectorAll('.rush-preset-btn');
  const rushReasonInput = document.getElementById('rush-reason-input');
  const btnTriggerRush = document.getElementById('btn-trigger-rush');

  // Operating Hours Form
  const formStoreHours = document.getElementById('form-store-hours');
  const inputOpenTime = document.getElementById('input-open-time');
  const inputCloseTime = document.getElementById('input-close-time');
  const inputRestaurantPhone = document.getElementById('input-restaurant-phone');
  const inputStatusNotice = document.getElementById('input-status-notice');
  const inputStoreOpen = document.getElementById('input-store-open');
  const inputStoreClosedReason = document.getElementById('input-store-closed-reason');
  const groupStoreClosedReason = document.getElementById('group-store-closed-reason');
  const storeOpenStatusIcon = document.getElementById('store-open-status-icon');
  const storeOpenStatusLabel = document.getElementById('store-open-status-label');

  // Auto-sync customer status notice text with Opening & Closing times
  function syncStatusNoticeWithTimes() {
    if (!inputStatusNotice) return;
    const currentVal = inputStatusNotice.value.trim();
    if (!currentVal || /^Open Now(\s*[:–-].*)?$/i.test(currentVal)) {
      const oT = inputOpenTime?.value?.trim() || '11:00 AM';
      const cT = inputCloseTime?.value?.trim() || '11:00 PM';
      inputStatusNotice.value = `Open Now: ${oT} – ${cT} • Delivery & Pickup`;
    }
  }
  inputOpenTime?.addEventListener('input', () => {
    syncStatusNoticeWithTimes();
    if (typeof syncHoursSummaryChips === 'function') syncHoursSummaryChips();
  });
  inputCloseTime?.addEventListener('input', () => {
    syncStatusNoticeWithTimes();
    if (typeof syncHoursSummaryChips === 'function') syncHoursSummaryChips();
  });
  inputRestaurantPhone?.addEventListener('input', () => {
    if (typeof syncHoursSummaryChips === 'function') syncHoursSummaryChips();
  });
  inputStoreOpen?.addEventListener('change', () => {
    if (typeof syncHoursSummaryChips === 'function') syncHoursSummaryChips();
  });

  // Operating Hours Preset Click Handlers
  document.querySelectorAll('.btn-time-quick-open').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = btn.getAttribute('data-time');
      if (inputOpenTime && t) {
        inputOpenTime.value = t;
        inputOpenTime.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  });

  document.querySelectorAll('.btn-time-quick-close').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = btn.getAttribute('data-time');
      if (inputCloseTime && t) {
        inputCloseTime.value = t;
        inputCloseTime.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  });

  function updateStoreOpenToggleUI(isOpen) {
    if (storeOpenStatusIcon) storeOpenStatusIcon.textContent = isOpen ? '🟢' : '🌙';
    if (storeOpenStatusLabel) {
      storeOpenStatusLabel.textContent = isOpen ? 'Store Open (Accepting Orders)' : 'Store Closed (Orders Blocked)';
      storeOpenStatusLabel.style.color = isOpen ? 'var(--color-success, #16a34a)' : '#ef4444';
    }
    if (groupStoreClosedReason) {
      groupStoreClosedReason.style.display = isOpen ? 'none' : 'block';
    }
    if (typeof syncHoursSummaryChips === 'function') {
      syncHoursSummaryChips();
    }
  }

  if (inputStoreOpen) {
    inputStoreOpen.addEventListener('change', () => {
      updateStoreOpenToggleUI(inputStoreOpen.checked);
    });
  }

  // ========================================================
  // 5. PROMOTIONAL OFFERS & COUPONS MANAGEMENT
  // ========================================================
  const formStoreOffer = document.getElementById('form-store-offer');
  const inputOfferActive = document.getElementById('input-offer-active');
  const btnTypePercent = document.getElementById('btn-type-percent');
  const btnTypeFlat = document.getElementById('btn-type-flat');
  const inputOfferType = document.getElementById('input-offer-type');
  const labelDiscountVal = document.getElementById('label-discount-val');
  const inputOfferCode = document.getElementById('input-offer-code');
  const inputOfferDiscount = document.getElementById('input-offer-discount');
  const discountPresetsContainer = document.getElementById('discount-presets-container');
  const presetDiscountLabel = document.getElementById('preset-discount-label');
  const inputOfferMinOrder = document.getElementById('input-offer-min-order');
  const minOrderPresetsContainer = document.getElementById('min-order-presets-container');
  const inputOfferTitle = document.getElementById('input-offer-title');
  const inputOfferSubtext = document.getElementById('input-offer-subtext');
  const inputOfferFreeDelivery = document.getElementById('input-offer-free-delivery');
  const offerStatusBadge = document.getElementById('offer-status-badge');
  const previewOfferStatus = document.getElementById('preview-offer-status');
  const previewOfferTitle = document.getElementById('preview-offer-title');
  const previewOfferDesc = document.getElementById('preview-offer-desc');
  const previewOfferCode = document.getElementById('preview-offer-code');
  const previewBadgeCodeDisplay = document.getElementById('preview-badge-code-display');
  const previewBadgeDiscountDisplay = document.getElementById('preview-badge-discount-display');
  const previewMinOrderPill = document.getElementById('preview-min-order-pill');
  const previewCouponFreePill = document.getElementById('preview-coupon-free-pill') || document.getElementById('preview-free-deliv-pill');
  const btnSaveOffer = document.getElementById('btn-save-offer');

  // Unlocked Deals (Threshold Pricing) Elements
  const formUnlockedDeals = document.getElementById('form-unlocked-deals');
  const inputUnlockedDealsActive = document.getElementById('input-unlocked-deals-active');
  const inputUnlockedDealsMin = document.getElementById('input-unlocked-deals-min');
  const inputUnlockedDealsPct = document.getElementById('input-unlocked-deals-pct');
  const inputUnlockedDealsTitle = document.getElementById('input-unlocked-deals-title');
  const inputUnlockedDealsSubtext = document.getElementById('input-unlocked-deals-subtext');
  const unlockedDealsStatusBadge = document.getElementById('unlocked-deals-status-badge');
  const previewUnlockedStatus = document.getElementById('preview-unlocked-status');
  const previewUnlockedTitle = document.getElementById('preview-unlocked-title');
  const previewUnlockedCalc = document.getElementById('preview-unlocked-calc');
  const previewUnlockedMinPill = document.getElementById('preview-unlocked-min-pill');
  const previewUnlockedPctPill = document.getElementById('preview-unlocked-pct-pill');
  const previewUnlockedBadgeDisplay = document.getElementById('preview-unlocked-badge-display');
  const btnSaveUnlockedDeals = document.getElementById('btn-save-unlocked-deals');

  // ========================================================
  // 6. DELIVERY OPTIONS & RADIUS MANAGEMENT
  // ========================================================
  const formStoreDelivery = document.getElementById('form-store-delivery');
  const inputFreeDeliveryEnabled = document.getElementById('input-free-delivery-enabled');
  const inputFreeDeliveryThreshold = document.getElementById('input-free-delivery-threshold');
  const thresholdPresetsContainer = document.getElementById('threshold-presets-container');
  const inputMinOrderValue = document.getElementById('input-min-order-value');
  const movPresetsContainer = document.getElementById('mov-presets-container');
  const inputDeliveryFeeStandard = document.getElementById('input-delivery-fee-standard');
  const inputMaxActiveOrders = document.getElementById('input-max-active-orders');
  const maxOrdersPresetsContainer = document.getElementById('max-orders-presets-container');
  const deliveryStatusBadge = document.getElementById('delivery-status-badge');
  const adminDeliveryStatusChip = document.getElementById('admin-delivery-status-chip');
  const deliveryStatusDot = document.getElementById('delivery-status-dot');
  const deliveryStatusChipText = document.getElementById('delivery-status-chip-text');
  const previewDeliveryStatus = document.getElementById('preview-delivery-status');
  const previewDeliveryTitle = document.getElementById('preview-delivery-title');
  const previewDeliveryBar = document.getElementById('preview-delivery-bar');
  const previewDeliveryDesc = document.getElementById('preview-delivery-desc');
  const previewDeliveryThreshDisplay = document.getElementById('preview-delivery-thresh-display');
  const btnSaveDelivery = document.getElementById('btn-save-delivery');

  // Delivery Radius Slider Elements
  const deliveryRadiusSlider = document.getElementById('delivery-radius-slider');
  const radiusSliderVal = document.getElementById('radius-slider-val');
  const radiusInfoKm = document.getElementById('radius-info-km');
  const radiusPresetBtns = document.querySelectorAll('.radius-preset-btn');
  const btnSaveRadius = document.getElementById('btn-save-radius');

  const PERCENT_PRESETS = [10, 15, 20, 25, 30, 50];
  const FLAT_PRESETS = [50, 100, 150, 200, 250, 300];

  function renderDiscountPresets(type, activeVal) {
    if (!discountPresetsContainer) return;
    const presets = type === 'flat' ? FLAT_PRESETS : PERCENT_PRESETS;
    discountPresetsContainer.innerHTML = presets.map(val => {
      const label = type === 'flat' ? `₹${val} OFF` : `${val}% OFF`;
      const isActive = Number(activeVal) === val;
      return `<button type="button" class="offer-preset-btn ${isActive ? 'active' : ''}" data-val="${val}">${label}</button>`;
    }).join('');

    discountPresetsContainer.querySelectorAll('.offer-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = Number(btn.getAttribute('data-val'));
        if (inputOfferDiscount) inputOfferDiscount.value = val;
        discountPresetsContainer.querySelectorAll('.offer-preset-btn').forEach(b => b.classList.toggle('active', b === btn));
        
        if (inputOfferTitle && /Get .* OFF/i.test(inputOfferTitle.value)) {
          const typeStr = type === 'flat' ? `₹${val} OFF` : `${val}% OFF`;
          inputOfferTitle.value = `Craving Savera? Get ${typeStr} Today!`;
        }
        updateOfferPreview();
      });
    });
  }

  function setDiscountType(type) {
    if (inputOfferType) inputOfferType.value = type;
    if (btnTypePercent) btnTypePercent.classList.toggle('active', type === 'percent');
    if (btnTypeFlat) btnTypeFlat.classList.toggle('active', type === 'flat');

    if (labelDiscountVal) {
      labelDiscountVal.innerHTML = type === 'flat'
        ? `<i class="fa-solid fa-money-bill-wave"></i> Flat Discount Amount (₹)`
        : `<i class="fa-solid fa-percent"></i> Discount Percentage (%)`;
    }

    if (presetDiscountLabel) {
      presetDiscountLabel.textContent = type === 'flat'
        ? 'Quick Flat Presets:'
        : 'Quick Percentage Presets:';
    }

    const currentVal = Number(inputOfferDiscount?.value) || 20;
    let nextVal = currentVal;
    if (type === 'flat' && currentVal < 30) {
      nextVal = 100;
      if (inputOfferDiscount) inputOfferDiscount.value = 100;
    } else if (type === 'percent' && currentVal > 100) {
      nextVal = 20;
      if (inputOfferDiscount) inputOfferDiscount.value = 20;
    }

    renderDiscountPresets(type, nextVal);
    updateOfferPreview();

  }

  function updateOfferPreview() {
    const isActive = inputOfferActive ? inputOfferActive.checked : true;
    const code = (inputOfferCode?.value || 'SAVERA20').trim().toUpperCase() || 'SAVERA20';
    const type = inputOfferType?.value === 'flat' ? 'flat' : 'percent';
    const rawVal = Number(inputOfferDiscount?.value || (type === 'flat' ? 100 : 20));
    const discountVal = type === 'flat' ? Math.max(1, rawVal) : Math.max(1, Math.min(100, rawVal));
    const minOrder = Math.max(0, Number(inputOfferMinOrder?.value || 0));
    const freeDelivWithCoupon = inputOfferFreeDelivery ? inputOfferFreeDelivery.checked : true;
    const rawTitle = inputOfferTitle?.value?.trim() || 'Craving Savera? Special Discount Today!';
    const title = rawTitle.replace(/SMM Taj|SMM/gi, 'Savera');

    const discountTagText = type === 'flat' ? `₹${discountVal} OFF` : `${discountVal}% OFF`;

    if (offerStatusBadge) {
      offerStatusBadge.textContent = isActive ? 'Active' : 'No Offer (Coming Soon)';
      offerStatusBadge.classList.toggle('paused', !isActive);
    }
    if (previewOfferStatus) {
      previewOfferStatus.textContent = isActive ? 'Active on Storefront' : 'Currently No Offer • Coming Soon';
      previewOfferStatus.classList.toggle('paused', !isActive);
    }
    if (previewOfferTitle) previewOfferTitle.textContent = isActive ? title : 'Currently No Offers • Coming Soon';
    if (previewOfferDesc) {
      if (isActive) {
        let desc = `Use coupon code <strong class="preview-code-tag">${escapeHtml(code)}</strong> for <strong>${escapeHtml(discountTagText)}</strong>`;
        if (minOrder > 0) {
          desc += ` on orders above ₹${minOrder}`;
        }
        if (freeDelivWithCoupon) {
          desc += ` + Free Priority Delivery!`;
        } else {
          desc += `!`;
        }
        previewOfferDesc.innerHTML = desc;
      } else {
        previewOfferDesc.innerHTML = 'Currently no active promotional offer. Exciting discounts and deals are coming soon!';
      }
    }
    if (previewBadgeCodeDisplay) previewBadgeCodeDisplay.textContent = code;
    if (previewBadgeDiscountDisplay) previewBadgeDiscountDisplay.textContent = discountTagText;

    if (previewMinOrderPill) {
      if (minOrder > 0) {
        previewMinOrderPill.style.display = 'inline-flex';
        previewMinOrderPill.innerHTML = `<i class="fa-solid fa-cart-shopping"></i> Min Order: ₹${minOrder}`;
      } else {
        previewMinOrderPill.style.display = 'none';
      }
    }

    const couponPill = document.getElementById('preview-coupon-free-pill') || document.getElementById('preview-free-deliv-pill');
    if (couponPill) {
      couponPill.style.display = freeDelivWithCoupon ? 'inline-flex' : 'none';
    }

    // Sync collapsed summary chips on card header
    const summaryPromoCode = document.getElementById('summary-promo-code');
    const summaryPromoDiscount = document.getElementById('summary-promo-discount');
    const summaryPromoMinChip = document.getElementById('summary-promo-min-chip');
    const summaryPromoDeliveryChip = document.getElementById('summary-promo-delivery-chip');
    if (summaryPromoCode) summaryPromoCode.textContent = code;
    if (summaryPromoDiscount) summaryPromoDiscount.textContent = discountTagText;
    if (summaryPromoMinChip) {
      if (minOrder > 0) {
        summaryPromoMinChip.style.display = 'inline-flex';
        summaryPromoMinChip.innerHTML = `<i class="fa-solid fa-cart-shopping"></i> Above ₹${minOrder}`;
      } else {
        summaryPromoMinChip.style.display = 'none';
      }
    }
    if (summaryPromoDeliveryChip) {
      summaryPromoDeliveryChip.style.display = freeDelivWithCoupon ? 'inline-flex' : 'none';
    }

    const adminOfferStatusChip = document.getElementById('admin-offer-status-chip');
    const offerStatusDot = document.getElementById('offer-status-dot');
    const offerStatusChipText = document.getElementById('offer-status-chip-text');
    if (adminOfferStatusChip) adminOfferStatusChip.classList.toggle('paused', !isActive);
    if (offerStatusDot) offerStatusDot.classList.toggle('paused', !isActive);
    if (offerStatusChipText) offerStatusChipText.textContent = isActive ? 'Offer Active' : 'No Offer (Coming Soon)';
  }

  function updateDeliveryPreview() {
    const isFreeEnabled = inputFreeDeliveryEnabled ? inputFreeDeliveryEnabled.checked : true;
    const thresh = Math.max(0, Number(inputFreeDeliveryThreshold?.value !== '' ? inputFreeDeliveryThreshold.value : 250));
    const stdFee = Math.max(0, Number(inputDeliveryFeeStandard?.value !== '' ? inputDeliveryFeeStandard.value : 40));
    const movVal = Math.max(0, Number(inputMinOrderValue?.value || 0));

    if (deliveryStatusBadge) {
      deliveryStatusBadge.textContent = isFreeEnabled ? 'Active' : 'Disabled';
      deliveryStatusBadge.classList.toggle('paused', !isFreeEnabled);
    }
    if (adminDeliveryStatusChip) adminDeliveryStatusChip.classList.toggle('paused', !isFreeEnabled);
    if (deliveryStatusDot) deliveryStatusDot.classList.toggle('paused', !isFreeEnabled);
    if (deliveryStatusChipText) {
      let chipMsg = isFreeEnabled ? (thresh === 0 ? 'Free Delivery (All Orders)' : `Free Delivery (Above ₹${thresh})`) : `Flat ₹${Math.round(stdFee)}`;
      if (movVal > 0) chipMsg += ` • Min Order ₹${movVal}`;
      deliveryStatusChipText.textContent = chipMsg;
    }

    if (previewDeliveryStatus) {
      previewDeliveryStatus.textContent = isFreeEnabled ? 'Live in Customer Basket' : 'Standard Delivery Only';
      previewDeliveryStatus.classList.toggle('paused', !isFreeEnabled);
    }
    if (previewDeliveryThreshDisplay) {
      previewDeliveryThreshDisplay.textContent = thresh;
    }
    if (previewDeliveryTitle) {
      if (isFreeEnabled && thresh > 0) {
        const sampleRemaining = Math.max(0, Math.round(thresh * 0.4));
        previewDeliveryTitle.innerHTML = `Add <strong>₹${sampleRemaining}</strong> more for <strong>FREE Priority Delivery</strong>!`;
      } else if (isFreeEnabled && thresh === 0) {
        previewDeliveryTitle.innerHTML = '🎉 <strong>100% FREE Priority Delivery</strong> on ALL Orders!';
      } else {
        previewDeliveryTitle.textContent = `Standard Delivery Fee: ₹${Math.round(stdFee)}`;
      }
    }
    if (previewDeliveryBar) {
      previewDeliveryBar.style.width = isFreeEnabled ? '100%' : '0%';
      previewDeliveryBar.style.background = isFreeEnabled ? (thresh === 0 ? '#10B981' : 'var(--brand-primary)') : '#9CA3AF';
    }
    if (previewDeliveryDesc) {
      let desc = '';
      if (isFreeEnabled && thresh > 0) {
        desc = `Orders above <strong style="color: var(--admin-accent);">${thresh}</strong> qualify for 100% Free Doorstep Delivery. Below that: ₹${Math.round(stdFee)}.`;
      } else if (isFreeEnabled && thresh === 0) {
        desc = '100% Free Doorstep Delivery applied automatically to all customer orders.';
      } else {
        desc = `All orders charged standard delivery fee of <strong>₹${Math.round(stdFee)}</strong>.`;
      }
      if (movVal > 0) {
        desc += ` <span style="display:block; margin-top:4px; color:var(--admin-accent); font-weight:600;">🛒 Checkout Minimum Order: ₹${movVal}</span>`;
      }
      previewDeliveryDesc.innerHTML = desc;
    }

    if (typeof syncDeliverySummaryChips === 'function') {
      syncDeliverySummaryChips();
    }
  }

  function updateUnlockedDealsPreview() {
    const isEnabled = inputUnlockedDealsActive ? inputUnlockedDealsActive.checked : false;
    const rawMin = Number(inputUnlockedDealsMin?.value);
    const minOrder = Number.isFinite(rawMin) && rawMin >= 50 ? Math.round(rawMin) : 199;
    const rawPct = Number(inputUnlockedDealsPct?.value);
    const discountPct = Number.isFinite(rawPct) && rawPct >= 1 ? Math.min(50, Math.round(rawPct)) : 15;
    const title = inputUnlockedDealsTitle?.value?.trim() || 'Wholesale Club Deals';

    if (unlockedDealsStatusBadge) {
      unlockedDealsStatusBadge.textContent = isEnabled ? 'Active' : 'Disabled';
      unlockedDealsStatusBadge.classList.toggle('paused', !isEnabled);
    }
    if (previewUnlockedStatus) {
      previewUnlockedStatus.textContent = isEnabled ? 'Enabled on Storefront' : 'Currently Disabled (Hidden)';
      previewUnlockedStatus.classList.toggle('paused', !isEnabled);
    }
    if (previewUnlockedTitle) previewUnlockedTitle.textContent = title;
    if (previewUnlockedBadgeDisplay) previewUnlockedBadgeDisplay.textContent = `${discountPct}% OFF`;

    // Sync collapsed summary chips on card header
    const summaryUnlockedMin = document.getElementById('summary-unlocked-min');
    const summaryUnlockedDiscount = document.getElementById('summary-unlocked-discount');
    if (summaryUnlockedMin) summaryUnlockedMin.textContent = `₹${minOrder}`;
    if (summaryUnlockedDiscount) summaryUnlockedDiscount.textContent = `${discountPct}% OFF`;
    if (previewUnlockedMinPill) {
      previewUnlockedMinPill.innerHTML = `<i class="fa-solid fa-lock-open"></i> Unlocks at ₹${minOrder}+`;
    }
    if (previewUnlockedPctPill) {
      previewUnlockedPctPill.innerHTML = `<i class="fa-solid fa-tags"></i> ${discountPct}% Automatic Discount`;
    }
    if (previewUnlockedCalc) {
      const sampleOriginal = 200;
      const sampleDiscounted = Math.round(sampleOriginal * (1 - discountPct / 100));
      if (isEnabled) {
        previewUnlockedCalc.innerHTML = `Sample: Dish of <strong>₹${sampleOriginal}</strong> ➔ Drops to <strong style="color: #10b981;">₹${sampleDiscounted}</strong> (${discountPct}% OFF) when cart hits ₹${minOrder}!`;
      } else {
        previewUnlockedCalc.innerHTML = `<span style="color:#9CA3AF;">Deals are disabled. Dishes will show regular prices without threshold discounts.</span>`;
      }
    }
  }

  let rushTickerInterval = null;

  function updateRushUI() {
    const settings = dataService.getSettings();
    const isClosed = settings.storeOpen === false || (typeof dataService.isStoreOpen === 'function' && !dataService.isStoreOpen());
    const isPaused = !isClosed && settings.isRushPaused && settings.pauseUntil && Date.now() < settings.pauseUntil;

    if (isClosed) {
      if (rushActiveStateBox) rushActiveStateBox.style.display = 'none';
      if (rushSetterBox) rushSetterBox.style.display = 'block';

      // Header status pill
      const openTime = settings.openTime || '11:00 AM';
      const isManualClosed = settings.storeOpen === false;
      if (headerStatusDot) {
        headerStatusDot.style.background = isManualClosed ? '#EF4444' : '#F59E0B';
        headerStatusDot.style.boxShadow = isManualClosed ? '0 0 0 3px rgba(239, 68, 68, 0.35)' : '0 0 0 3px rgba(245, 158, 11, 0.35)';
      }
      if (headerStatusText) {
        headerStatusText.textContent = isManualClosed ? '🌙 Store Closed for Night' : `🕒 Scheduled Closed (Opens ${openTime})`;
      }
      if (adminStoreStatusPill) {
        adminStoreStatusPill.style.display = 'inline-flex';
        adminStoreStatusPill.style.background = isManualClosed ? '#FEF2F2' : '#FEF3C7';
        adminStoreStatusPill.style.borderColor = isManualClosed ? '#FECACA' : '#FDE68A';
        adminStoreStatusPill.style.color = isManualClosed ? '#991B1B' : '#92400E';
      }

      // View chips
      if (rushStatusDot) rushStatusDot.style.background = isManualClosed ? '#EF4444' : '#F59E0B';
      if (rushStatusChipText) {
        rushStatusChipText.textContent = isManualClosed ? 'Store Closed (Night)' : `Scheduled Closed (Opens ${openTime})`;
      }
      if (adminLiveRushChip) {
        adminLiveRushChip.classList.remove('paused');
      }
      if (rushModeBadge) {
        rushModeBadge.textContent = isManualClosed ? '🌙 Store Closed' : `🕒 Opens ${openTime}`;
        rushModeBadge.className = 'count-pill rush-mode-pill';
        rushModeBadge.style.background = isManualClosed ? '#EF4444' : '#F59E0B';
        rushModeBadge.style.color = '#FFFFFF';
      }

      // Badges
      if (topRushBadge) topRushBadge.style.display = 'none';
      if (capsuleRushBadge) capsuleRushBadge.style.display = 'none';
      if (typeof syncHoursSummaryChips === 'function') {
        syncHoursSummaryChips();
      }
      return;
    }

    if (isPaused) {
      const remainingMs = Math.max(0, settings.pauseUntil - Date.now());
      const totalSecs = Math.floor(remainingMs / 1000);
      const mins = Math.floor(totalSecs / 60);
      const secs = totalSecs % 60;

      if (rushActiveStateBox) rushActiveStateBox.style.display = 'block';
      if (rushSetterBox) rushSetterBox.style.display = 'none';

      if (rushTimerMin) rushTimerMin.textContent = String(mins).padStart(2, '0');
      if (rushTimerSec) rushTimerSec.textContent = String(secs).padStart(2, '0');
      if (rushActiveReason) rushActiveReason.textContent = settings.pauseReason || 'High kitchen rush — orders temporarily paused';

      // Header status pill
      if (headerStatusDot) {
        headerStatusDot.style.background = '#F59E0B';
        headerStatusDot.style.boxShadow = '0 0 0 3px rgba(245, 158, 11, 0.35)';
      }
      if (headerStatusText) headerStatusText.textContent = `⚡ Rush (${mins}m ${secs}s)`;
      if (adminStoreStatusPill) {
        adminStoreStatusPill.style.display = 'inline-flex';
        adminStoreStatusPill.style.background = '#FFFBEB';
        adminStoreStatusPill.style.borderColor = '#FDE68A';
        adminStoreStatusPill.style.color = '#B45309';
      }

      // View chips
      if (rushStatusDot) rushStatusDot.style.background = '#F59E0B';
      if (rushStatusChipText) rushStatusChipText.textContent = `Paused (${mins}m left)`;
      if (adminLiveRushChip) {
        adminLiveRushChip.classList.add('paused');
      }
      if (rushModeBadge) {
        rushModeBadge.textContent = '⏸️ Rush Paused';
        rushModeBadge.className = 'count-pill rush-mode-pill paused';
      }

      // Badges
      if (topRushBadge) topRushBadge.style.display = 'inline-block';
      if (capsuleRushBadge) capsuleRushBadge.style.display = 'inline-block';
    } else {
      if (rushActiveStateBox) rushActiveStateBox.style.display = 'none';
      if (rushSetterBox) rushSetterBox.style.display = 'block';

      // Header status pill
      if (headerStatusDot) {
        headerStatusDot.style.background = 'var(--admin-success)';
        headerStatusDot.style.boxShadow = '0 0 0 3px rgba(16, 185, 129, 0.25)';
      }
      if (headerStatusText) headerStatusText.textContent = 'Live Kitchen Online';
      if (adminStoreStatusPill) {
        adminStoreStatusPill.style.display = 'inline-flex';
        adminStoreStatusPill.style.background = '#ECFDF5';
        adminStoreStatusPill.style.borderColor = '#A7F3D0';
        adminStoreStatusPill.style.color = '#065F46';
      }

      // View chips
      if (rushStatusDot) rushStatusDot.style.background = 'var(--admin-success)';
      if (rushStatusChipText) rushStatusChipText.textContent = 'Kitchen Online';
      if (adminLiveRushChip) {
        adminLiveRushChip.classList.remove('paused');
      }
      if (rushModeBadge) {
        rushModeBadge.textContent = '🟢 Taking Orders';
        rushModeBadge.className = 'count-pill rush-mode-pill';
      }

      // Badges
      if (topRushBadge) topRushBadge.style.display = 'none';
      if (capsuleRushBadge) capsuleRushBadge.style.display = 'none';
    }

    if (typeof syncHoursSummaryChips === 'function') {
      syncHoursSummaryChips();
    }
  }

  function startRushTicker() {
    if (rushTickerInterval) clearInterval(rushTickerInterval);
    updateRushUI();
    rushTickerInterval = setInterval(() => {
      updateRushUI();
    }, 1000);
  }

  function renderHoursAndRush() {
    const settings = dataService.getSettings();

    // Populate store open status
    const isStoreCurrentlyOpen = settings.storeOpen !== false;
    if (inputStoreOpen) inputStoreOpen.checked = isStoreCurrentlyOpen;
    if (inputStoreClosedReason) {
      inputStoreClosedReason.value = settings.storeClosedReason || '';
    }
    updateStoreOpenToggleUI(isStoreCurrentlyOpen);

    // Populate operating hours form
    if (inputOpenTime && document.activeElement !== inputOpenTime) inputOpenTime.value = settings.openTime || '11:00 AM';
    if (inputCloseTime && document.activeElement !== inputCloseTime) inputCloseTime.value = settings.closeTime || '11:00 PM';
    if (inputRestaurantPhone && document.activeElement !== inputRestaurantPhone) {
      inputRestaurantPhone.value = settings.restaurantPhone || settings.helpline || '+91 98450 12345';
    }
    if (inputStatusNotice && document.activeElement !== inputStatusNotice) {
      const openT = settings.openTime || '11:00 AM';
      const closeT = settings.closeTime || '11:00 PM';
      const rawNotice = (settings.statusNotice || '').trim();
      if (!rawNotice || /^Open Now(\s*[:–-].*)?$/i.test(rawNotice)) {
        inputStatusNotice.value = `Open Now: ${openT} – ${closeT} • Delivery & Pickup`;
      } else {
        inputStatusNotice.value = rawNotice;
      }
    }

    // Populate slider
    const currentMins = settings.pauseMinutes || 20;
    if (rushRangeSlider) rushRangeSlider.value = currentMins;
    if (rushSliderVal) rushSliderVal.textContent = currentMins;
    if (btnPauseTargetMins) btnPauseTargetMins.textContent = currentMins;

    rushPresetBtns.forEach(btn => {
      const mins = Number(btn.getAttribute('data-mins'));
      btn.classList.toggle('active', mins === currentMins);
    });

    startRushTicker();
    if (typeof syncHoursSummaryChips === 'function') {
      syncHoursSummaryChips();
    }
  }

  function renderOffers() {
    const settings = dataService.getSettings();

    // Populate promotional offer
    if (inputOfferActive && document.activeElement !== inputOfferActive) inputOfferActive.checked = settings.offerActive !== false;
    if (inputOfferCode && document.activeElement !== inputOfferCode) inputOfferCode.value = (settings.offerCode || 'SAVERA20').toUpperCase();
    const offerType = settings.offerDiscountType === 'flat' ? 'flat' : 'percent';
    const currentDiscount = offerType === 'flat' ? (settings.offerDiscountAmount || 100) : (settings.offerDiscountPercent || 20);
    if (inputOfferDiscount && document.activeElement !== inputOfferDiscount) inputOfferDiscount.value = currentDiscount;
    if (inputOfferMinOrder && document.activeElement !== inputOfferMinOrder) inputOfferMinOrder.value = settings.offerMinOrder !== undefined ? settings.offerMinOrder : 300;
    if (inputOfferTitle && document.activeElement !== inputOfferTitle) inputOfferTitle.value = (settings.offerTitle || 'Craving Savera? Get 20% OFF Today!').replace(/SMM Taj|SMM/gi, 'Savera');
    if (inputOfferSubtext && document.activeElement !== inputOfferSubtext) inputOfferSubtext.value = settings.offerSubtext || 'Use coupon code at checkout for special discount.';
    if (inputOfferFreeDelivery && document.activeElement !== inputOfferFreeDelivery) inputOfferFreeDelivery.checked = settings.offerFreeDelivery !== false;

    setDiscountType(offerType);

    // Min order presets active state
    minOrderPresetsContainer?.querySelectorAll('.min-order-preset-btn').forEach(btn => {
      const min = Number(btn.getAttribute('data-min'));
      btn.classList.toggle('active', min === Number(inputOfferMinOrder?.value));
    });

    updateOfferPreview();

    // Populate unlocked deals
    if (inputUnlockedDealsActive && document.activeElement !== inputUnlockedDealsActive) inputUnlockedDealsActive.checked = Boolean(settings.unlockedDealsEnabled);
    if (inputUnlockedDealsMin && document.activeElement !== inputUnlockedDealsMin) inputUnlockedDealsMin.value = settings.unlockedDealsMinOrder || 299;
    if (inputUnlockedDealsPct && document.activeElement !== inputUnlockedDealsPct) inputUnlockedDealsPct.value = settings.unlockedDealsDiscountPct || 15;
    if (inputUnlockedDealsTitle && document.activeElement !== inputUnlockedDealsTitle) inputUnlockedDealsTitle.value = settings.unlockedDealsTitle || 'Wholesale Club Deals';
    if (inputUnlockedDealsSubtext && document.activeElement !== inputUnlockedDealsSubtext) inputUnlockedDealsSubtext.value = settings.unlockedDealsSubtext || 'Shop for ₹299 to unlock special menu prices!';

    document.querySelectorAll('#unlocked-min-presets .unlocked-min-btn').forEach(btn => {
      btn.classList.toggle('active', Number(btn.getAttribute('data-val')) === Number(inputUnlockedDealsMin?.value));
    });
    document.querySelectorAll('#unlocked-pct-presets .unlocked-pct-btn').forEach(btn => {
      btn.classList.toggle('active', Number(btn.getAttribute('data-val')) === Number(inputUnlockedDealsPct?.value));
    });

    updateUnlockedDealsPreview();
  }

  function renderDeliveryOptions() {
    const settings = dataService.getSettings();

    // Populate free delivery settings
    if (inputFreeDeliveryEnabled) inputFreeDeliveryEnabled.checked = settings.freeDeliveryEnabled !== false;
    if (inputFreeDeliveryThreshold) inputFreeDeliveryThreshold.value = settings.freeDeliveryThreshold !== undefined ? settings.freeDeliveryThreshold : 250;
    if (inputDeliveryFeeStandard) inputDeliveryFeeStandard.value = settings.deliveryFeeStandard !== undefined ? settings.deliveryFeeStandard : 40;

    const wrap = document.getElementById('free-delivery-threshold-wrap');
    if (wrap && inputFreeDeliveryEnabled) {
      wrap.style.opacity = inputFreeDeliveryEnabled.checked ? '1' : '0.4';
    }

    // Threshold presets active state
    thresholdPresetsContainer?.querySelectorAll('.threshold-preset-btn').forEach(btn => {
      const th = Number(btn.getAttribute('data-thresh'));
      btn.classList.toggle('active', th === Number(inputFreeDeliveryThreshold?.value));
    });

    // Populate Minimum Order Value (MOV) to Checkout
    if (inputMinOrderValue) {
      const movVal = Number(settings.minOrderValue !== undefined ? settings.minOrderValue : (settings.minOrder ?? 0));
      inputMinOrderValue.value = movVal;
      movPresetsContainer?.querySelectorAll('.mov-preset-btn').forEach(btn => {
        btn.classList.toggle('active', Number(btn.getAttribute('data-mov')) === movVal);
      });
    }

    // Populate delivery radius slider
    const currentRadius = settings.deliveryRadiusKm || 7;
    if (deliveryRadiusSlider) deliveryRadiusSlider.value = currentRadius;
    if (radiusSliderVal) radiusSliderVal.textContent = currentRadius;
    if (radiusInfoKm) radiusInfoKm.textContent = `${currentRadius} km`;

    radiusPresetBtns.forEach(btn => {
      const km = Number(btn.getAttribute('data-km'));
      btn.classList.toggle('active', km === currentRadius);
    });

    // Populate Max Active Orders Per Customer
    if (inputMaxActiveOrders) inputMaxActiveOrders.value = settings.maxActiveOrdersPerCustomer !== undefined ? settings.maxActiveOrdersPerCustomer : 2;

    updateDeliveryPreview();
    renderAdminRidersFleet();
    if (typeof syncDeliverySummaryChips === 'function') {
      syncDeliverySummaryChips();
    }
  }

  // Range slider change
  if (rushRangeSlider) {
    rushRangeSlider.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      if (rushSliderVal) rushSliderVal.textContent = val;
      if (btnPauseTargetMins) btnPauseTargetMins.textContent = val;

      rushPresetBtns.forEach(btn => {
        const mins = Number(btn.getAttribute('data-mins'));
        btn.classList.toggle('active', mins === val);
      });
      if (typeof syncHoursSummaryChips === 'function') syncHoursSummaryChips();
    });
  }

  // Preset button clicks
  rushPresetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const mins = Number(btn.getAttribute('data-mins'));
      if (rushRangeSlider) rushRangeSlider.value = mins;
      if (rushSliderVal) rushSliderVal.textContent = mins;
      if (btnPauseTargetMins) btnPauseTargetMins.textContent = mins;

      rushPresetBtns.forEach(b => b.classList.toggle('active', b === btn));
      if (typeof syncHoursSummaryChips === 'function') syncHoursSummaryChips();
    });
  });

  rushReasonInput?.addEventListener('input', () => {
    if (typeof syncHoursSummaryChips === 'function') syncHoursSummaryChips();
  });

  // Trigger rush pause
  if (btnTriggerRush) {
    btnTriggerRush.addEventListener('click', async () => {
      const mins = Number(rushRangeSlider?.value || 20);
      const reason = rushReasonInput?.value?.trim() || 'High kitchen rush — orders temporarily paused';

      try {
        await dataService.setRushPause(mins, reason);
        updateRushUI();
        showToast(`⚡ Orders paused for ${mins} minutes! Homepage customer notice is now live.`, 'warning');
      } catch (err) {
        console.error('[Admin] setRushPause error:', err);
        updateRushUI();
        showToast(`⚠️ Rush pause error: ${err?.message || 'Failed to sync to cloud'}`, 'error');
      }
    });
  }

  // Extend rush by 10 mins
  if (btnExtendRush10) {
    btnExtendRush10.addEventListener('click', async () => {
      try {
        await dataService.extendRushPause(10);
        updateRushUI();
        showToast('➕ Rush extended by 10 minutes!', 'info');
      } catch (err) {
        console.error('[Admin] extendRushPause error:', err);
        updateRushUI();
        showToast(`⚠️ Rush extend error: ${err?.message || 'Failed to sync to cloud'}`, 'error');
      }
    });
  }

  // Resume orders now
  if (btnResumeOrders) {
    btnResumeOrders.addEventListener('click', async () => {
      try {
        await dataService.resumeOrders();
        updateRushUI();
        showToast('🟢 Kitchen reopened! Customers can now place orders on the homepage.', 'success');
      } catch (err) {
        console.error('[Admin] resumeOrders error:', err);
        updateRushUI();
        showToast(`⚠️ Resume orders error: ${err?.message || 'Failed to sync to cloud'}`, 'error');
      }
    });
  }

  function formatStorePhoneNumber(raw) {
    if (!raw) return '';
    const digits = String(raw).replace(/\D/g, '');
    if (digits.length === 10) {
      return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
    }
    if (digits.length === 11 && digits.startsWith('0')) {
      return `+91 ${digits.slice(1, 6)} ${digits.slice(6)}`;
    }
    if (digits.length === 12 && digits.startsWith('91')) {
      return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
    }
    return String(raw).trim();
  }

  // Save store hours form
  if (formStoreHours) {
    formStoreHours.addEventListener('submit', async (e) => {
      e.preventDefault();
      const current = dataService.getSettings();

      function normalizeTimeStr(val, defaultVal) {
        if (!val) return defaultVal;
        const str = String(val).trim();
        const m = str.match(/^(\d{1,2}):?(\d{2})?\s*(am|pm)?$/i);
        if (!m) return defaultVal;
        let h = parseInt(m[1], 10);
        let mins = m[2] ? parseInt(m[2], 10) : 0;
        if (isNaN(h) || isNaN(mins) || mins < 0 || mins > 59) return defaultVal;
        let period = m[3] ? m[3].toUpperCase() : null;
        if (period) {
          if (h < 1 || h > 12) return defaultVal;
        } else {
          if (h < 0 || h > 23) return defaultVal;
          if (h >= 12) {
            period = 'PM';
            if (h > 12) h -= 12;
          } else {
            period = 'AM';
            if (h === 0) h = 12;
          }
        }
        return `${h}:${String(mins).padStart(2, '0')} ${period}`;
      }

      const openT = normalizeTimeStr(inputOpenTime?.value?.trim(), '11:00 AM');
      const closeT = normalizeTimeStr(inputCloseTime?.value?.trim(), '11:00 PM');
      if (inputOpenTime) inputOpenTime.value = openT;
      if (inputCloseTime) inputCloseTime.value = closeT;
      const rawPhone = inputRestaurantPhone?.value?.trim() || current.restaurantPhone || current.helpline || '+91 98450 12345';
      const restPhone = formatStorePhoneNumber(rawPhone);
      if (inputRestaurantPhone) inputRestaurantPhone.value = restPhone;

      const rawNotice = inputStatusNotice?.value?.trim() || '';
      const noticeT = (!rawNotice || /^Open Now(\s*[:–-].*)?$/i.test(rawNotice))
        ? `Open Now: ${openT} – ${closeT} • Delivery & Pickup`
        : rawNotice;
      const radiusKm = Number(current.deliveryRadiusKm || 7);
      const storeIsOpen = inputStoreOpen ? inputStoreOpen.checked : (current.storeOpen !== false);
      const storeReason = inputStoreClosedReason?.value?.trim() || '';

      const updated = {
        ...current,
        storeOpen: storeIsOpen,
        storeClosedReason: storeReason,
        openTime: openT,
        closeTime: closeT,
        restaurantPhone: restPhone,
        helpline: restPhone,
        statusNotice: noticeT,
        deliveryRadiusKm: radiusKm
      };

      const saveBtn = document.getElementById('btn-save-hours');
      if (saveBtn?.disabled) return;
      const originalBtnHtml = saveBtn ? saveBtn.innerHTML : '';
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
      }

      try {
        const res = await dataService.saveSettings(updated);
        if (typeof syncHoursSummaryChips === 'function') {
          syncHoursSummaryChips();
        }
        // Auto-close operating timings panel on save
        document.querySelector('.btn-close-hours-panel[data-target="hours-card-schedule"]')?.click();
        if (res?._localOnly) {
          showToast('⚠️ Operating timings updated locally (Cloud database sync requires Owner role).', 'warning');
        } else {
          showToast('💾 Store operating timings, notice & helpline updated!', 'success');
        }
        if (saveBtn) {
          saveBtn.innerHTML = '<i class="fa-solid fa-check"></i> Saved!';
          setTimeout(() => {
            saveBtn.disabled = false;
            saveBtn.innerHTML = originalBtnHtml;
          }, 1500);
        }
      } catch (err) {
        console.error('[Admin] Error saving store settings:', err);
        showToast(`⚠️ Settings error: ${err?.message || 'Failed to persist to cloud'}`, 'error');
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.innerHTML = originalBtnHtml;
        }
      }
    });
  }

  // Delivery Radius Slider Change Listener
  if (deliveryRadiusSlider) {
    deliveryRadiusSlider.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      if (radiusSliderVal) radiusSliderVal.textContent = val;
      if (radiusInfoKm) radiusInfoKm.textContent = `${val} km`;

      radiusPresetBtns.forEach(btn => {
        const km = Number(btn.getAttribute('data-km'));
        btn.classList.toggle('active', km === val);
      });
      if (typeof syncDeliverySummaryChips === 'function') {
        syncDeliverySummaryChips();
      }
    });
  }

  // Delivery Radius Preset Buttons
  radiusPresetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const km = Number(btn.getAttribute('data-km'));
      if (deliveryRadiusSlider) deliveryRadiusSlider.value = km;
      if (radiusSliderVal) radiusSliderVal.textContent = km;
      if (radiusInfoKm) radiusInfoKm.textContent = `${km} km`;

      radiusPresetBtns.forEach(b => b.classList.toggle('active', b === btn));
      if (typeof syncDeliverySummaryChips === 'function') {
        syncDeliverySummaryChips();
      }
    });
  });

  // Save Delivery Radius Button
  if (btnSaveRadius) {
    btnSaveRadius.addEventListener('click', async () => {
      const km = Number(deliveryRadiusSlider?.value || 7);
      try {
        await dataService.setDeliveryRadius(km);
        if (typeof syncDeliverySummaryChips === 'function') {
          syncDeliverySummaryChips();
        }
        // Auto-close delivery radius panel on save
        document.querySelector('.btn-close-delivery-panel[data-target="delivery-card-radius"]')?.click();
        showToast(`🛵 Maximum delivery radius saved: Delivering within ${km} km!`, 'success');
      } catch (err) {
        console.error('[Admin] setDeliveryRadius error:', err);
        showToast(`⚠️ Delivery radius error: ${err?.message || 'Failed to sync to cloud'}`, 'error');
      }
    });
  }

  // Discount Type tab clicks
  if (btnTypePercent) {
    btnTypePercent.addEventListener('click', () => setDiscountType('percent'));
  }
  if (btnTypeFlat) {
    btnTypeFlat.addEventListener('click', () => setDiscountType('flat'));
  }

  // Min Order preset button clicks
  minOrderPresetsContainer?.querySelectorAll('.min-order-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const min = Number(btn.getAttribute('data-min'));
      if (inputOfferMinOrder) inputOfferMinOrder.value = min;
      minOrderPresetsContainer.querySelectorAll('.min-order-preset-btn').forEach(b => b.classList.toggle('active', b === btn));
      updateOfferPreview();
    });
  });

  // Free delivery threshold preset button clicks
  thresholdPresetsContainer?.querySelectorAll('.threshold-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const th = Number(btn.getAttribute('data-thresh'));
      if (inputFreeDeliveryThreshold) inputFreeDeliveryThreshold.value = th;
      thresholdPresetsContainer.querySelectorAll('.threshold-preset-btn').forEach(b => b.classList.toggle('active', b === btn));
      updateDeliveryPreview();
    });
  });

  // Minimum Order Value (MOV) preset button clicks
  movPresetsContainer?.querySelectorAll('.mov-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mov = Number(btn.getAttribute('data-mov'));
      if (inputMinOrderValue) inputMinOrderValue.value = mov;
      movPresetsContainer.querySelectorAll('.mov-preset-btn').forEach(b => b.classList.toggle('active', b === btn));
      updateDeliveryPreview();
    });
  });

  // Toggle Free Delivery Threshold content opacity
  if (inputFreeDeliveryEnabled) {
    inputFreeDeliveryEnabled.addEventListener('change', () => {
      const wrap = document.getElementById('free-delivery-threshold-wrap');
      if (wrap) wrap.style.opacity = inputFreeDeliveryEnabled.checked ? '1' : '0.4';
      updateDeliveryPreview();
    });
  }

  // Real-time input updates for offer preview
  [inputOfferActive, inputOfferCode, inputOfferDiscount, inputOfferMinOrder, inputOfferTitle, inputOfferSubtext, inputOfferFreeDelivery].forEach(input => {
    if (input) {
      input.addEventListener('input', () => {
        if (input === inputOfferCode && inputOfferCode.value) {
          inputOfferCode.value = inputOfferCode.value.toUpperCase();
        }
        if (input === inputOfferDiscount) {
          const val = Number(inputOfferDiscount.value);
          discountPresetsContainer?.querySelectorAll('.offer-preset-btn').forEach(b => b.classList.toggle('active', Number(b.getAttribute('data-val')) === val));
        }
        if (input === inputOfferMinOrder) {
          const val = Number(inputOfferMinOrder.value);
          minOrderPresetsContainer?.querySelectorAll('.min-order-preset-btn').forEach(b => b.classList.toggle('active', Number(b.getAttribute('data-min')) === val));
        }
        updateOfferPreview();
      });
      input.addEventListener('change', updateOfferPreview);
    }
  });

  // Real-time input updates for delivery preview
  [inputFreeDeliveryEnabled, inputFreeDeliveryThreshold, inputMinOrderValue, inputDeliveryFeeStandard, inputMaxActiveOrders].forEach(input => {
    if (input) {
      input.addEventListener('input', () => {
        if (input === inputFreeDeliveryThreshold) {
          const val = Number(inputFreeDeliveryThreshold.value);
          thresholdPresetsContainer?.querySelectorAll('.threshold-preset-btn').forEach(b => b.classList.toggle('active', Number(b.getAttribute('data-thresh')) === val));
        }
        if (input === inputMinOrderValue) {
          const val = Number(inputMinOrderValue.value);
          movPresetsContainer?.querySelectorAll('.mov-preset-btn').forEach(b => b.classList.toggle('active', Number(b.getAttribute('data-mov')) === val));
        }
        if (input === inputMaxActiveOrders) {
          const val = Number(inputMaxActiveOrders.value);
          maxOrdersPresetsContainer?.querySelectorAll('.max-orders-preset-btn').forEach(b => b.classList.toggle('active', Number(b.getAttribute('data-limit')) === val));
        }
        updateDeliveryPreview();
      });
      input.addEventListener('change', updateDeliveryPreview);
    }
  });

  // Save promotional offer form
  if (formStoreOffer) {
    formStoreOffer.addEventListener('submit', async (e) => {
      e.preventDefault();
      const active = inputOfferActive ? inputOfferActive.checked : true;
      const code = (inputOfferCode?.value || 'SAVERA20').trim().toUpperCase() || 'SAVERA20';
      const type = inputOfferType?.value === 'flat' ? 'flat' : 'percent';
      const rawDiscount = Number(inputOfferDiscount?.value || (type === 'flat' ? 100 : 20));
      const discount = type === 'flat' ? Math.max(1, Math.min(10000, rawDiscount)) : Math.max(1, Math.min(100, rawDiscount));
      const minOrder = Math.max(0, Number(inputOfferMinOrder?.value || 0));
      const title = inputOfferTitle?.value?.trim() || 'Craving Savera Paradise? Get Special Discount Today!';
      const subtext = inputOfferSubtext?.value?.trim() || 'Use coupon code at checkout for special discount.';
      const freeDelivWithCoupon = inputOfferFreeDelivery ? inputOfferFreeDelivery.checked : true;

      const saveBtn = document.getElementById('btn-save-offer');
      const origHtml = saveBtn ? saveBtn.innerHTML : '';
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
      }

      try {
        await dataService.setOffer({
          offerActive: active,
          offerCode: code,
          offerDiscountType: type,
          offerDiscountPercent: type === 'percent' ? discount : 20,
          offerDiscountAmount: type === 'flat' ? discount : 100,
          offerMinOrder: minOrder,
          offerTitle: title,
          offerSubtext: subtext,
          offerFreeDelivery: freeDelivWithCoupon
        });

        updateOfferPreview();
        const discLabel = type === 'flat' ? `₹${discount} OFF` : `${discount}% OFF`;
        const minMsg = minOrder > 0 ? ` on orders above ₹${minOrder}` : '';
        // Auto-close promo offer panel on save
        document.querySelector('.btn-close-offer-panel[data-target="offer-card-promo"]')?.click();
        showToast(`🎉 Settings saved! Coupon ${code} (${discLabel}${minMsg}) is now active.`, 'success');
        if (saveBtn) {
          saveBtn.innerHTML = '<i class="fa-solid fa-check"></i> Saved!';
          setTimeout(() => {
            saveBtn.disabled = false;
            saveBtn.innerHTML = origHtml;
          }, 1500);
        }
      } catch (err) {
        console.error('[Admin] Error saving offer settings:', err);
        showToast('⚠️ Settings updated locally.', 'warning');
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.innerHTML = origHtml;
        }
      }
    });
  }

  if (btnSaveOffer && formStoreOffer) {
    btnSaveOffer.addEventListener('click', (e) => {
      e.preventDefault();
      if (typeof formStoreOffer.requestSubmit === 'function') {
        formStoreOffer.requestSubmit();
      } else {
        formStoreOffer.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      }
    });
  }

  // Save unlocked deals form
  if (formUnlockedDeals) {
    formUnlockedDeals.addEventListener('submit', async (e) => {
      e.preventDefault();
      const isEnabled = inputUnlockedDealsActive ? inputUnlockedDealsActive.checked : false;
      const rawMin = Number(inputUnlockedDealsMin?.value);
      const minOrder = Number.isFinite(rawMin) && rawMin >= 50 ? Math.round(rawMin) : 199;
      const rawPct = Number(inputUnlockedDealsPct?.value);
      const discountPct = Number.isFinite(rawPct) && rawPct >= 1 ? Math.min(50, Math.round(rawPct)) : 15;
      const title = inputUnlockedDealsTitle?.value?.trim() || 'Wholesale Club Deals';
      const subtext = inputUnlockedDealsSubtext?.value?.trim() || `Shop for ₹${minOrder} to unlock special menu prices!`;

      const saveBtn = document.getElementById('btn-save-unlocked-deals');
      const origHtml = saveBtn ? saveBtn.innerHTML : '';
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
      }

      try {
        await dataService.setUnlockedDeals({
          unlockedDealsEnabled: isEnabled,
          unlockedDealsMinOrder: minOrder,
          unlockedDealsDiscountPct: discountPct,
          unlockedDealsTitle: title,
          unlockedDealsSubtext: subtext
        });

        updateUnlockedDealsPreview();
        const statusMsg = isEnabled ? `Active (${discountPct}% OFF above ₹${minOrder})` : 'Disabled';
        // Auto-close unlocked deals panel on save
        document.querySelector('.btn-close-offer-panel[data-target="offer-card-unlocked"]')?.click();
        showToast(`🎉 Unlocked Deals saved! Status: ${statusMsg}`, 'success');
        if (saveBtn) {
          saveBtn.innerHTML = '<i class="fa-solid fa-check"></i> Saved!';
          setTimeout(() => {
            saveBtn.disabled = false;
            saveBtn.innerHTML = origHtml;
          }, 1500);
        }
      } catch (err) {
        console.error('[Admin] Error saving unlocked deals settings:', err);
        showToast('⚠️ Settings updated locally.', 'warning');
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.innerHTML = origHtml;
        }
      }
    });

    [inputUnlockedDealsActive, inputUnlockedDealsMin, inputUnlockedDealsPct, inputUnlockedDealsTitle, inputUnlockedDealsSubtext].forEach(input => {
      if (input) {
        input.addEventListener('input', updateUnlockedDealsPreview);
        input.addEventListener('change', updateUnlockedDealsPreview);
      }
    });

    document.querySelectorAll('#unlocked-min-presets .unlocked-min-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = Number(btn.getAttribute('data-val'));
        if (inputUnlockedDealsMin) inputUnlockedDealsMin.value = val;
        document.querySelectorAll('#unlocked-min-presets .unlocked-min-btn').forEach(b => b.classList.toggle('active', b === btn));
        if (inputUnlockedDealsSubtext) {
          const cur = inputUnlockedDealsSubtext.value || '';
          if (!cur || /^Shop for ₹\d+ to unlock special menu prices!$/i.test(cur)) {
            inputUnlockedDealsSubtext.value = `Shop for ₹${val} to unlock special menu prices!`;
          }
        }
        updateUnlockedDealsPreview();
      });
    });

    document.querySelectorAll('#unlocked-pct-presets .unlocked-pct-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = Number(btn.getAttribute('data-val'));
        if (inputUnlockedDealsPct) inputUnlockedDealsPct.value = val;
        document.querySelectorAll('#unlocked-pct-presets .unlocked-pct-btn').forEach(b => b.classList.toggle('active', b === btn));
        updateUnlockedDealsPreview();
      });
    });
  }

  if (btnSaveUnlockedDeals && formUnlockedDeals) {
    btnSaveUnlockedDeals.addEventListener('click', (e) => {
      e.preventDefault();
      formUnlockedDeals.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
  }

  // ========================================================
  // 5B. COLLAPSIBLE ACCORDION FOR OFFERS SETTINGS HUB
  // ========================================================
  function initOffersAccordion() {
    const promoCard = document.getElementById('offer-card-promo');
    const unlockedCard = document.getElementById('offer-card-unlocked');
    const btnPromo = document.getElementById('btn-toggle-promo-offer');
    const btnUnlocked = document.getElementById('btn-toggle-unlocked-deals');
    const bodyPromo = document.getElementById('offer-body-promo');
    const bodyUnlocked = document.getElementById('offer-body-unlocked');
    const headerPromo = document.getElementById('offer-header-promo');
    const headerUnlocked = document.getElementById('offer-header-unlocked');

    function toggleOfferCard(card, body, btn, forceOpen = null) {
      if (!card || !body || !btn) return;
      const isOpen = card.classList.contains('is-open');
      const shouldOpen = forceOpen !== null ? forceOpen : !isOpen;

      if (shouldOpen) {
        // When opening one card, collapse the other to save viewport space and avoid scrolling
        if (card === promoCard) {
          toggleOfferCard(unlockedCard, bodyUnlocked, btnUnlocked, false);
        } else if (card === unlockedCard) {
          toggleOfferCard(promoCard, bodyPromo, btnPromo, false);
        }
      }

      card.classList.toggle('is-open', shouldOpen);
      btn.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
      const header = card.querySelector('.offer-collapsible-header');
      if (header) {
        header.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
      }
      const textSpan = btn.querySelector('.toggle-btn-text');
      if (textSpan) {
        textSpan.textContent = shouldOpen ? 'Close Settings' : 'Edit Settings';
      }
      body.style.display = shouldOpen ? 'block' : 'none';
    }

    if (btnPromo) {
      btnPromo.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleOfferCard(promoCard, bodyPromo, btnPromo);
      });
    }
    if (headerPromo) {
      headerPromo.addEventListener('click', (e) => {
        if (e.target.closest('button, input, select, a, label')) return;
        toggleOfferCard(promoCard, bodyPromo, btnPromo);
      });
      headerPromo.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (e.target.closest('button, input, select, a, label')) return;
          e.preventDefault();
          toggleOfferCard(promoCard, bodyPromo, btnPromo);
        }
      });
    }

    if (btnUnlocked) {
      btnUnlocked.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleOfferCard(unlockedCard, bodyUnlocked, btnUnlocked);
      });
    }
    if (headerUnlocked) {
      headerUnlocked.addEventListener('click', (e) => {
        if (e.target.closest('button, input, select, a, label')) return;
        toggleOfferCard(unlockedCard, bodyUnlocked, btnUnlocked);
      });
      headerUnlocked.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (e.target.closest('button, input, select, a, label')) return;
          e.preventDefault();
          toggleOfferCard(unlockedCard, bodyUnlocked, btnUnlocked);
        }
      });
    }

    // Close buttons inside expanded forms
    document.querySelectorAll('.btn-close-offer-panel').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = btn.getAttribute('data-target');
        if (targetId === 'offer-card-promo') {
          toggleOfferCard(promoCard, bodyPromo, btnPromo, false);
        } else if (targetId === 'offer-card-unlocked') {
          toggleOfferCard(unlockedCard, bodyUnlocked, btnUnlocked, false);
        }
      });
    });

    // Initialize both cards collapsed by default so view is compact and fits without scrolling
    toggleOfferCard(promoCard, bodyPromo, btnPromo, false);
    toggleOfferCard(unlockedCard, bodyUnlocked, btnUnlocked, false);
  }

  initOffersAccordion();

  // ========================================================
  // 5C. SUMMARY CHIPS SYNCHRONIZERS FOR HOURS & DELIVERY
  // ========================================================
  function syncHoursSummaryChips() {
    const settings = dataService.getSettings();
    const isClosed = settings.storeOpen === false || (typeof dataService.isStoreOpen === 'function' && !dataService.isStoreOpen());
    const isPaused = !isClosed && settings.isRushPaused && settings.pauseUntil && Date.now() < settings.pauseUntil;

    // 1. Kitchen Rush Snooze chips
    const summaryRushStatus = document.getElementById('summary-rush-status');
    const summaryRushMins = document.getElementById('summary-rush-mins');
    const summaryRushReason = document.getElementById('summary-rush-reason');
    const rushModeBadge = document.getElementById('rush-mode-badge');

    if (summaryRushStatus) {
      if (isClosed) {
        summaryRushStatus.textContent = 'Store Closed';
      } else if (isPaused) {
        const remainingMs = Math.max(0, settings.pauseUntil - Date.now());
        const mins = Math.ceil(remainingMs / 60000);
        summaryRushStatus.textContent = `Paused (${mins}m left)`;
      } else {
        summaryRushStatus.textContent = 'Kitchen Online';
      }
    }

    if (summaryRushMins) {
      const minsVal = Number(rushRangeSlider?.value || settings.pauseMinutes || 20);
      summaryRushMins.textContent = `${minsVal} Mins`;
    }

    if (summaryRushReason) {
      const reasonText = (rushReasonInput?.value || settings.pauseReason || 'High kitchen rush').trim();
      summaryRushReason.textContent = reasonText.length > 30 ? reasonText.slice(0, 27) + '...' : reasonText;
    }

    if (rushModeBadge) {
      if (isClosed) {
        rushModeBadge.textContent = 'Store Closed';
        rushModeBadge.className = 'count-pill rush-mode-pill';
        rushModeBadge.style.background = '#EF4444';
        rushModeBadge.style.color = '#FFFFFF';
      } else if (isPaused) {
        rushModeBadge.textContent = 'Rush Paused';
        rushModeBadge.className = 'count-pill rush-mode-pill paused';
        rushModeBadge.style.background = '#F59E0B';
        rushModeBadge.style.color = '#FFFFFF';
      } else {
        rushModeBadge.textContent = 'Active';
        rushModeBadge.className = 'count-pill rush-mode-pill';
        rushModeBadge.style.background = '#D1FAE5';
        rushModeBadge.style.color = '#065F46';
      }
    }

    // 2. Daily Operating Timings & Helpline chips
    const summaryScheduleStatus = document.getElementById('summary-schedule-status');
    const summaryScheduleHours = document.getElementById('summary-schedule-hours');
    const summarySchedulePhone = document.getElementById('summary-schedule-phone');
    const scheduleStatusBadge = document.getElementById('schedule-status-badge');

    const masterToggleOn = inputStoreOpen ? inputStoreOpen.checked : (settings.storeOpen !== false);
    const clockOpen = typeof dataService.isStoreOpen === 'function' ? dataService.isStoreOpen() : masterToggleOn;
    const storeIsOpen = masterToggleOn && clockOpen;
    const openTime = inputOpenTime?.value?.trim() || settings.openTime || '11:00 AM';
    const closeTime = inputCloseTime?.value?.trim() || settings.closeTime || '11:00 PM';
    const rawPhone = inputRestaurantPhone?.value?.trim() || settings.restaurantPhone || settings.helpline || '+91 98450 12345';
    const phoneFormatted = formatStorePhoneNumber(rawPhone);

    if (summaryScheduleStatus) {
      if (!masterToggleOn) {
        summaryScheduleStatus.textContent = 'Store Closed';
        summaryScheduleStatus.style.color = '#ef4444';
      } else if (!clockOpen) {
        summaryScheduleStatus.textContent = `Scheduled Closed (Opens ${openTime})`;
        summaryScheduleStatus.style.color = '#f59e0b';
      } else {
        summaryScheduleStatus.textContent = 'Store Open';
        summaryScheduleStatus.style.color = 'var(--color-success, #16a34a)';
      }
    }

    if (summaryScheduleHours) {
      summaryScheduleHours.textContent = `${openTime} – ${closeTime}`;
    }

    if (summarySchedulePhone) {
      summarySchedulePhone.textContent = phoneFormatted;
    }

    if (scheduleStatusBadge) {
      if (!masterToggleOn) {
        scheduleStatusBadge.textContent = 'Closed';
        scheduleStatusBadge.style.background = '#FEE2E2';
        scheduleStatusBadge.style.color = '#991B1B';
      } else if (!clockOpen) {
        scheduleStatusBadge.textContent = `Opens ${openTime}`;
        scheduleStatusBadge.style.background = '#FEF3C7';
        scheduleStatusBadge.style.color = '#92400E';
      } else {
        scheduleStatusBadge.textContent = 'Open';
        scheduleStatusBadge.style.background = '#D1FAE5';
        scheduleStatusBadge.style.color = '#065F46';
      }
    }
  }

  function syncDeliverySummaryChips() {
    const settings = dataService.getSettings();

    // 1. Delivery Options & Minimum Order Requirements chips
    const summaryFree = document.getElementById('summary-delivery-free');
    const summaryFee = document.getElementById('summary-delivery-fee');
    const summaryMov = document.getElementById('summary-delivery-mov');
    const summaryMaxOrders = document.getElementById('summary-delivery-max-orders');
    const deliveryStatusBadge = document.getElementById('delivery-status-badge');

    const freeEnabled = inputFreeDeliveryEnabled ? inputFreeDeliveryEnabled.checked : (settings.freeDeliveryEnabled !== false);
    const freeThreshold = inputFreeDeliveryThreshold && inputFreeDeliveryThreshold.value !== '' ? Math.max(0, Number(inputFreeDeliveryThreshold.value)) : (settings.freeDeliveryThreshold !== undefined ? settings.freeDeliveryThreshold : 250);
    const stdFee = inputDeliveryFeeStandard && inputDeliveryFeeStandard.value !== '' ? Math.max(0, Number(inputDeliveryFeeStandard.value)) : (settings.deliveryFeeStandard !== undefined ? settings.deliveryFeeStandard : 40);
    const mov = inputMinOrderValue && inputMinOrderValue.value !== '' ? Math.max(0, Number(inputMinOrderValue.value)) : (settings.minOrderValue !== undefined ? settings.minOrderValue : (settings.minOrder ?? 0));
    const maxActive = inputMaxActiveOrders ? Number(inputMaxActiveOrders.value || 2) : (settings.maxActiveOrdersPerCustomer !== undefined ? settings.maxActiveOrdersPerCustomer : 2);

    if (summaryFree) {
      if (!freeEnabled) {
        summaryFree.textContent = 'Disabled';
      } else if (freeThreshold === 0) {
        summaryFree.textContent = 'Free for All (₹0)';
      } else {
        summaryFree.textContent = `₹${freeThreshold}`;
      }
    }
    if (summaryFee) {
      summaryFee.textContent = `₹${stdFee}`;
    }
    if (summaryMov) {
      summaryMov.textContent = mov > 0 ? `₹${mov}` : '₹0 (No Limit)';
    }
    if (summaryMaxOrders) {
      summaryMaxOrders.textContent = `${maxActive} Active`;
    }
    if (deliveryStatusBadge) {
      deliveryStatusBadge.textContent = freeEnabled ? 'Active' : 'Disabled';
      if (freeEnabled) {
        deliveryStatusBadge.style.background = '#D1FAE5';
        deliveryStatusBadge.style.color = '#065F46';
        deliveryStatusBadge.classList.remove('paused');
      } else {
        deliveryStatusBadge.style.background = '#F3F4F6';
        deliveryStatusBadge.style.color = '#6B7280';
        deliveryStatusBadge.classList.add('paused');
      }
    }

    // 2. Delivery Radius chip
    const currentRadius = Number(deliveryRadiusSlider?.value || settings.deliveryRadiusKm || 7);
    const summaryRadius = document.getElementById('summary-delivery-radius');
    const deliveryRadiusBadge = document.getElementById('delivery-radius-badge');
    if (summaryRadius) {
      summaryRadius.textContent = `${currentRadius} km`;
    }
    if (deliveryRadiusBadge) {
      deliveryRadiusBadge.textContent = `${currentRadius} KM Limit`;
    }

    // 3. Delivery Fleet chip
    const riders = (typeof dataService.getRiders === 'function' ? dataService.getRiders() : []) || [];
    const summaryFleetActive = document.getElementById('summary-fleet-active');
    const fleetBadge = document.getElementById('admin-riders-count-badge');
    if (summaryFleetActive) {
      summaryFleetActive.textContent = `${riders.length} Active Riders`;
    }
    if (fleetBadge) {
      fleetBadge.textContent = `${riders.length} Active`;
    }
  }

  // ========================================================
  // 5D. COLLAPSIBLE ACCORDION FOR STORE HOURS & RUSH
  // ========================================================
  function initHoursAccordion() {
    const rushCard = document.getElementById('hours-card-rush');
    const scheduleCard = document.getElementById('hours-card-schedule');
    const btnRush = document.getElementById('btn-toggle-rush');
    const btnSchedule = document.getElementById('btn-toggle-schedule');
    const bodyRush = document.getElementById('hours-body-rush');
    const bodySchedule = document.getElementById('hours-body-schedule');
    const headerRush = document.getElementById('hours-header-rush');
    const headerSchedule = document.getElementById('hours-header-schedule');

    function toggleHoursCard(card, body, btn, forceOpen = null) {
      if (!card || !body || !btn) return;
      const isOpen = card.classList.contains('is-open');
      const shouldOpen = forceOpen !== null ? forceOpen : !isOpen;

      if (shouldOpen) {
        // When opening one card, collapse the other to save viewport space
        if (card === rushCard) {
          toggleHoursCard(scheduleCard, bodySchedule, btnSchedule, false);
        } else if (card === scheduleCard) {
          toggleHoursCard(rushCard, bodyRush, btnRush, false);
        }
      }

      card.classList.toggle('is-open', shouldOpen);
      btn.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
      const textSpan = btn.querySelector('.toggle-btn-text');
      if (textSpan) {
        textSpan.textContent = shouldOpen ? 'Close Settings' : 'Edit Settings';
      }
      body.style.display = shouldOpen ? 'block' : 'none';
    }

    if (btnRush) {
      btnRush.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleHoursCard(rushCard, bodyRush, btnRush);
      });
    }
    if (headerRush) {
      headerRush.addEventListener('click', (e) => {
        if (e.target.closest('button, input, select, a, label')) return;
        toggleHoursCard(rushCard, bodyRush, btnRush);
      });
      headerRush.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (e.target.closest('button, input, select, a, label')) return;
          e.preventDefault();
          toggleHoursCard(rushCard, bodyRush, btnRush);
        }
      });
    }

    if (btnSchedule) {
      btnSchedule.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleHoursCard(scheduleCard, bodySchedule, btnSchedule);
      });
    }
    if (headerSchedule) {
      headerSchedule.addEventListener('click', (e) => {
        if (e.target.closest('button, input, select, a, label')) return;
        toggleHoursCard(scheduleCard, bodySchedule, btnSchedule);
      });
      headerSchedule.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (e.target.closest('button, input, select, a, label')) return;
          e.preventDefault();
          toggleHoursCard(scheduleCard, bodySchedule, btnSchedule);
        }
      });
    }

    // Close buttons inside expanded panels
    document.querySelectorAll('.btn-close-hours-panel').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = btn.getAttribute('data-target');
        if (targetId === 'hours-card-rush') {
          toggleHoursCard(rushCard, bodyRush, btnRush, false);
        } else if (targetId === 'hours-card-schedule') {
          toggleHoursCard(scheduleCard, bodySchedule, btnSchedule, false);
        }
      });
    });

    // Initialize both cards collapsed by default so view is compact and fits without scrolling
    toggleHoursCard(rushCard, bodyRush, btnRush, false);
    toggleHoursCard(scheduleCard, bodySchedule, btnSchedule, false);
  }

  // ========================================================
  // 5E. COLLAPSIBLE ACCORDION FOR DELIVERY OPTIONS HUB
  // ========================================================
  function initDeliveryAccordion() {
    const optionsCard = document.getElementById('delivery-card-options');
    const radiusCard = document.getElementById('delivery-card-radius');
    const fleetCard = document.getElementById('delivery-card-fleet');

    const btnOptions = document.getElementById('btn-toggle-delivery-options');
    const btnRadius = document.getElementById('btn-toggle-delivery-radius');
    const btnFleet = document.getElementById('btn-toggle-delivery-fleet');

    const bodyOptions = document.getElementById('delivery-body-options');
    const bodyRadius = document.getElementById('delivery-body-radius');
    const bodyFleet = document.getElementById('delivery-body-fleet');

    const headerOptions = document.getElementById('delivery-header-options');
    const headerRadius = document.getElementById('delivery-header-radius');
    const headerFleet = document.getElementById('delivery-header-fleet');

    function toggleDeliveryCard(card, body, btn, forceOpen = null) {
      if (!card || !body || !btn) return;
      const isOpen = card.classList.contains('is-open');
      const shouldOpen = forceOpen !== null ? forceOpen : !isOpen;

      if (shouldOpen) {
        // Mutual exclusion: when opening one card, collapse the others to save viewport space
        if (card === optionsCard) {
          toggleDeliveryCard(radiusCard, bodyRadius, btnRadius, false);
          toggleDeliveryCard(fleetCard, bodyFleet, btnFleet, false);
        } else if (card === radiusCard) {
          toggleDeliveryCard(optionsCard, bodyOptions, btnOptions, false);
          toggleDeliveryCard(fleetCard, bodyFleet, btnFleet, false);
        } else if (card === fleetCard) {
          toggleDeliveryCard(optionsCard, bodyOptions, btnOptions, false);
          toggleDeliveryCard(radiusCard, bodyRadius, btnRadius, false);
        }
      }

      card.classList.toggle('is-open', shouldOpen);
      btn.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
      const header = card.querySelector('.offer-collapsible-header');
      if (header) {
        header.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
      }
      const textSpan = btn.querySelector('.toggle-btn-text');
      if (textSpan) {
        if (card === fleetCard) {
          textSpan.textContent = shouldOpen ? 'Close Fleet' : 'View Fleet';
        } else {
          textSpan.textContent = shouldOpen ? 'Close Settings' : 'Edit Settings';
        }
      }
      body.style.display = shouldOpen ? 'block' : 'none';
    }

    if (btnOptions) {
      btnOptions.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDeliveryCard(optionsCard, bodyOptions, btnOptions);
      });
    }
    if (headerOptions) {
      headerOptions.addEventListener('click', (e) => {
        if (e.target.closest('button, input, select, a, label')) return;
        toggleDeliveryCard(optionsCard, bodyOptions, btnOptions);
      });
      headerOptions.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (e.target.closest('button, input, select, a, label')) return;
          e.preventDefault();
          toggleDeliveryCard(optionsCard, bodyOptions, btnOptions);
        }
      });
    }

    if (btnRadius) {
      btnRadius.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDeliveryCard(radiusCard, bodyRadius, btnRadius);
      });
    }
    if (headerRadius) {
      headerRadius.addEventListener('click', (e) => {
        if (e.target.closest('button, input, select, a, label')) return;
        toggleDeliveryCard(radiusCard, bodyRadius, btnRadius);
      });
      headerRadius.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (e.target.closest('button, input, select, a, label')) return;
          e.preventDefault();
          toggleDeliveryCard(radiusCard, bodyRadius, btnRadius);
        }
      });
    }

    if (btnFleet) {
      btnFleet.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDeliveryCard(fleetCard, bodyFleet, btnFleet);
      });
    }
    if (headerFleet) {
      headerFleet.addEventListener('click', (e) => {
        if (e.target.closest('button, input, select, a, label')) return;
        toggleDeliveryCard(fleetCard, bodyFleet, btnFleet);
      });
      headerFleet.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (e.target.closest('button, input, select, a, label')) return;
          e.preventDefault();
          toggleDeliveryCard(fleetCard, bodyFleet, btnFleet);
        }
      });
    }

    // Close buttons inside expanded panels
    document.querySelectorAll('.btn-close-delivery-panel').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = btn.getAttribute('data-target');
        if (targetId === 'delivery-card-options') {
          toggleDeliveryCard(optionsCard, bodyOptions, btnOptions, false);
        } else if (targetId === 'delivery-card-radius') {
          toggleDeliveryCard(radiusCard, bodyRadius, btnRadius, false);
        } else if (targetId === 'delivery-card-fleet') {
          toggleDeliveryCard(fleetCard, bodyFleet, btnFleet, false);
        }
      });
    });

    // Initialize all 3 cards collapsed by default
    toggleDeliveryCard(optionsCard, bodyOptions, btnOptions, false);
    toggleDeliveryCard(radiusCard, bodyRadius, btnRadius, false);
    toggleDeliveryCard(fleetCard, bodyFleet, btnFleet, false);
  }

  // Initialize Hours & Delivery Accordions and initial chip values
  initHoursAccordion();
  initDeliveryAccordion();
  syncHoursSummaryChips();
  syncDeliverySummaryChips();


  // Save delivery options form
  if (formStoreDelivery) {
    formStoreDelivery.addEventListener('submit', async (e) => {
      e.preventDefault();
      const freeDelivEnabled = inputFreeDeliveryEnabled ? inputFreeDeliveryEnabled.checked : true;
      const freeDelivThreshold = Math.max(0, Number(inputFreeDeliveryThreshold?.value !== '' ? inputFreeDeliveryThreshold.value : 250));
      const minOrderVal = Math.max(0, Number(inputMinOrderValue?.value !== '' ? inputMinOrderValue.value : 0));
      const stdFee = Math.max(0, Number(inputDeliveryFeeStandard?.value !== '' ? inputDeliveryFeeStandard.value : 40));
      const radiusKm = Number(deliveryRadiusSlider?.value || 7);
      const maxActive = Math.max(1, Number(inputMaxActiveOrders?.value || 2));

      const saveBtn = document.getElementById('btn-save-delivery');
      const origHtml = saveBtn ? saveBtn.innerHTML : '';
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
      }

      try {
        await dataService.setDeliverySettings({
          freeDeliveryEnabled: freeDelivEnabled,
          freeDeliveryThreshold: freeDelivThreshold,
          minOrderValue: minOrderVal,
          deliveryFeeStandard: stdFee,
          deliveryRadiusKm: radiusKm,
          maxActiveOrdersPerCustomer: maxActive
        });

        updateDeliveryPreview();
        if (typeof syncDeliverySummaryChips === 'function') {
          syncDeliverySummaryChips();
        }
        const freeMsg = freeDelivEnabled
          ? (freeDelivThreshold === 0 ? 'Free delivery on ALL orders is active!' : `Free delivery on orders above ₹${freeDelivThreshold} is active!`)
          : `Flat delivery fee of ₹${Math.round(stdFee)} is active!`;
        const movMsg = minOrderVal > 0 ? ` Minimum order: ₹${minOrderVal}.` : ' No minimum order limit.';
        // Auto-close delivery options panel on save
        document.querySelector('.btn-close-delivery-panel[data-target="delivery-card-options"]')?.click();
        showToast(`🚚 Delivery settings saved!${movMsg} Max active orders: ${maxActive} at a time. ${freeMsg}`, 'success');
        if (saveBtn) {
          saveBtn.innerHTML = '<i class="fa-solid fa-check"></i> Saved!';
          setTimeout(() => {
            saveBtn.disabled = false;
            saveBtn.innerHTML = origHtml;
          }, 1500);
        }
      } catch (err) {
        console.error('[Admin] Error saving delivery settings:', err);
        showToast('⚠️ Settings updated locally.', 'warning');
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.innerHTML = origHtml;
        }
      }
    });
  }

  if (btnSaveDelivery && formStoreDelivery) {
    btnSaveDelivery.addEventListener('click', (e) => {
      e.preventDefault();
      if (typeof formStoreDelivery.requestSubmit === 'function') {
        formStoreDelivery.requestSubmit();
      } else {
        formStoreDelivery.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      }
    });
  }

  // ========================================================
  // DELIVERY BOY FLEET DIRECTORY CONTROLLER (Read-Only)
  // Fleet onboarding and PIN management are securely isolated in Owner Portal
  // ========================================================
  const adminRidersGrid = document.getElementById('admin-riders-grid');
  const adminRidersCountBadge = document.getElementById('admin-riders-count-badge');

  function renderAdminRidersFleet() {
    if (!adminRidersGrid) return;
    const riders = dataService.getRiders();

    if (adminRidersCountBadge) {
      adminRidersCountBadge.textContent = `${riders.length} Active`;
    }
    if (typeof syncDeliverySummaryChips === 'function') {
      syncDeliverySummaryChips();
    }

    if (!riders || riders.length === 0) {
      adminRidersGrid.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 30px; text-align: center; background: rgba(255,255,255,0.03); border: 1px dashed var(--admin-border); border-radius: 12px; color: var(--admin-text-muted);">
          <i class="fa-solid fa-motorcycle" style="font-size: 2rem; margin-bottom: 8px; opacity: 0.5;"></i>
          <p style="margin: 0; font-weight: 700;">No delivery boys registered yet.</p>
          <p style="margin: 4px 0 0 0; font-size: 0.85rem;">Delivery boys and their secret login PINs are onboarded and managed securely in the Owner Portal.</p>
        </div>
      `;
      return;
    }

    adminRidersGrid.innerHTML = riders.map(r => {
      const pin = escapeHtml(r.pin);
      const name = escapeHtml(r.name || `Rider ${r.pin}`);
      const rawPhone = (r.phone || '').trim();
      const phoneDigits = rawPhone.replace(/\D/g, '');
      const hasRealPhone = phoneDigits.length >= 10;
      const dialerPhone = hasRealPhone ? phoneDigits.slice(-10) : '';
      const formattedPhone = hasRealPhone ? `+91 ${dialerPhone.slice(0, 5)} ${dialerPhone.slice(5)}` : escapeHtml(rawPhone);
      const callLink = hasRealPhone ? `tel:+91${dialerPhone}` : '#';
      const waLink = hasRealPhone ? `https://wa.me/91${dialerPhone}?text=${encodeURIComponent(`Hello ${r.name || 'Rider'}, regarding Savera Paradise food delivery.`)}` : '#';

      const vehicle = escapeHtml(r.vehicle || '🏍️ Bike');
      const rawAvatar = r.avatar || ((vehicle.includes('🛵') || vehicle.toLowerCase().includes('scooter')) ? '🛵' : ((vehicle.includes('🚗') || vehicle.toLowerCase().includes('car')) ? '🚗' : ((vehicle.includes('🚲') || vehicle.toLowerCase().includes('bicycle')) ? '🚲' : ((vehicle.includes('⚡') || vehicle.toLowerCase().includes('electric') || vehicle.toLowerCase().includes('ev')) ? '⚡' : '🏍️'))));
      const avatar = escapeHtml(rawAvatar);

      return `
        <div class="admin-rider-card" data-pin="${pin}">
          <div class="admin-rider-card-top">
            <div class="admin-rider-identity">
              <div class="admin-rider-avatar-wrap">
                <span>${avatar}</span>
              </div>
              <div class="admin-rider-meta">
                <h3 class="admin-rider-name" title="${name}">${name}</h3>
                <div class="admin-rider-vehicle-pill" title="${vehicle}">
                  <span>${vehicle}</span>
                </div>
              </div>
            </div>
            <div class="admin-rider-pin-badge" title="Secret login PIN is protected and managed in the Owner Portal">
              <small><i class="fa-solid fa-shield-halved"></i> PIN</small>
              <span class="pin-masked-dots">••••</span>
            </div>
          </div>

          <div class="admin-rider-phone-row">
            ${hasRealPhone ? `
              <a href="${callLink}" class="admin-rider-phone-link" title="Call ${name}">
                <i class="fa-solid fa-phone"></i> ${formattedPhone}
              </a>
            ` : `
              <span class="admin-rider-no-phone">
                <i class="fa-solid fa-phone-slash"></i> No phone added
              </span>
            `}
          </div>

          <div class="admin-rider-card-footer">
            <span class="admin-rider-status-tag">
              <span class="status-dot"></span>
              <span>Active • Fleet Ready</span>
            </span>
            <div class="admin-rider-actions">
              ${hasRealPhone ? `
                <a href="${waLink}" target="_blank" rel="noopener noreferrer" class="btn-rider-wa" title="WhatsApp ${name}">
                  <i class="fa-brands fa-whatsapp"></i>
                </a>
                <a href="${callLink}" class="btn-rider-call" title="Call ${name}">
                  <i class="fa-solid fa-phone"></i> Call
                </a>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Subscribe to rider fleet changes across tabs/portals
  dataService.subscribeToChanges('riders', () => {
    renderAdminRidersFleet();
  });

  // ========================================================
  // INITIALIZATION & TAB RESTORATION
  // ========================================================
  renderCategories();
  renderDishes();
  renderOrders();
  renderHoursAndRush();
  renderOffers();
  renderDeliveryOptions();
  updateOrderBadges();
  let overdueCheckInterval = null;
  function startOverdueChecker() {
    if (!overdueCheckInterval && !document.hidden) {
      overdueCheckInterval = setInterval(checkOverduePendingOrders, 10000);
    }
  }
  function stopOverdueChecker() {
    if (overdueCheckInterval) {
      clearInterval(overdueCheckInterval);
      overdueCheckInterval = null;
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopOverdueChecker();
    } else {
      checkOverduePendingOrders();
      startOverdueChecker();
    }
  });
  checkOverduePendingOrders();
  startOverdueChecker();

  const initialHash = window.location.hash.toLowerCase();
  if (initialHash === '#hours' || initialHash === '#rush') {
    switchView('view-hours');
  } else if (initialHash === '#delivery' || initialHash === '#deliv' || initialHash === '#delivery-options') {
    switchView('view-delivery');
  } else if (initialHash === '#offers' || initialHash === '#offer' || initialHash === '#promo') {
    switchView('view-offers');
  } else if (initialHash === '#menu') {
    switchView('view-menu');
  } else if (initialHash === '#orders') {
    switchView('view-orders');
  } else {
    try {
      const savedTab = sessionStorage.getItem('quickbite_admin_tab');
      if (savedTab && (savedTab === 'view-hours' || savedTab === 'view-menu' || savedTab === 'view-offers' || savedTab === 'view-delivery' || savedTab === 'view-orders')) {
        switchView(savedTab);
      } else {
        switchView('view-orders');
      }
    } catch {
      switchView('view-orders');
    }
  }

  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.toLowerCase();
    if (hash === '#hours' || hash === '#rush') switchView('view-hours');
    else if (hash === '#delivery' || hash === '#deliv' || hash === '#delivery-options') switchView('view-delivery');
    else if (hash === '#offers' || hash === '#offer' || hash === '#promo') switchView('view-offers');
    else if (hash === '#orders') switchView('view-orders');
    else if (hash === '#menu') switchView('view-menu');
  });

  // Register DOM fallback checkers for bulletproof single-step back navigation
  backNav.registerFallbackChecker({
    isOpen: () => modalDishBackdrop && modalDishBackdrop.classList.contains('open'),
    close: () => closeDishModal()
  });
  backNav.registerFallbackChecker({
    isOpen: () => modalCategoryBackdrop && modalCategoryBackdrop.classList.contains('open'),
    close: () => closeCategoryModal()
  });
  backNav.registerFallbackChecker({
    isOpen: () => modalCancelOrderBackdrop && modalCancelOrderBackdrop.classList.contains('open'),
    close: () => closeCancelOrderModal()
  });
  backNav.registerFallbackChecker({
    isOpen: () => modalOrderBackdrop && modalOrderBackdrop.classList.contains('open'),
    close: () => closeOrderManageModal()
  });
  backNav.registerFallbackChecker({
    isOpen: () => categoryDetailPanel && categoryDetailPanel.style.display !== 'none' && currentOpenedCategorySlug,
    close: () => closeCategoryDetailInternal()
  });
  backNav.registerFallbackChecker({
    isOpen: () => activeView && activeView !== 'view-orders',
    close: () => switchView('view-orders', false)
  });
};

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAdminApp);
  } else {
    initAdminApp();
  }
}
