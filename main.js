/**
 * QuickBite / Crispy Chicken - Interactive Logic & Animation Engine
 */
import confetti from 'canvas-confetti';
import { dataService, RESTAURANT_COORDINATES, sanitizeDishImageUrl } from './dataService.js';
import { supabase } from './supabaseClient.js';
import {
  playNotificationSound,
  sendSystemNotification,
  flashTabTitle,
  requestSystemNotificationPermission,
  getSystemNotificationPermission,
  updateAppBadge
} from './notificationService.js';
import { setupAppDownloadButton } from './pwaInstallService.js';
import { createBackNavigationManager } from './navigationBackService.js';
import { escapeHtml, sanitizeUrl } from './securityUtils.js';
import './pwa.css';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default icon paths in bundler
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

document.addEventListener('DOMContentLoaded', () => {
  // Navigation Back Stack Controller (Single-step back navigation for storefront)
  const backNav = createBackNavigationManager('storefront');

  // ==========================================
  // IMAGE SKELETON LOADER & ALT-TEXT SYSTEM
  // ==========================================
  function setupImageSkeleton(img) {
    if (!img) return;
    const container = img.closest('.blob-frame') ||
                      img.closest('.recipe-card-inner') ||
                      img.closest('.dish-thumb-box') ||
                      img.closest('.food-modal-hero') ||
                      img.closest('.cart-item-img-wrap') ||
                      img.closest('.promo-visual') ||
                      img.closest('.offers-modal-body') ||
                      img.parentElement;

    const onReady = () => {
      img.classList.remove('img-has-error');
      img.classList.add('img-is-ready');
      if (container) {
        container.classList.add('is-img-loaded');
        container.classList.remove('is-img-loading');
        container.classList.remove('is-img-error-skeleton');
      }
    };

    const onError = () => {
      if (!img.getAttribute('data-fallback-tried')) {
        img.setAttribute('data-fallback-tried', 'true');
        img.src = '/biryani-plate-1.png';
        return;
      }
      img.classList.remove('img-is-ready');
      img.classList.add('img-has-error');
      
      // Stop shimmering gradient and show clean, friendly thumbnail placeholder
      if (container) {
        container.classList.remove('is-img-loaded');
        container.classList.remove('is-img-loading');
        container.classList.add('is-img-error-skeleton');
      }
    };

    if (img.complete && img.naturalWidth > 0) {
      onReady();
    } else {
      img.classList.remove('img-is-ready');
      if (container) {
        container.classList.remove('is-img-loaded');
        container.classList.add('is-img-loading');
      }
      img.addEventListener('load', onReady, { once: true });
      img.addEventListener('error', onError, { once: true });
    }
  }

  function initImageSkeletonSystem() {
    const selector = '.food-img, .recipe-img, .food-modal-img, .promo-food-img, .offers-modal-food-img, .dish-card-img, .cart-item-img';
    document.querySelectorAll(selector).forEach(setupImageSkeleton);

    if (window.MutationObserver) {
      const observer = new MutationObserver((mutations) => {
        for (const mut of mutations) {
          if (mut.addedNodes && mut.addedNodes.length) {
            mut.addedNodes.forEach(node => {
              if (node.nodeType === 1) {
                if (node.matches && node.matches(selector)) {
                  setupImageSkeleton(node);
                } else if (node.querySelectorAll) {
                  node.querySelectorAll(selector).forEach(setupImageSkeleton);
                }
              }
            });
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  // Developer & Tester Helper to simulate/demo skeleton loading anytime
  window.showSkeletonDemo = function(durationMs = 4000) {
    const containers = document.querySelectorAll('.blob-frame, .dish-thumb-box, .food-modal-hero');
    const imgs = document.querySelectorAll('.food-img, .recipe-img, .food-modal-img');
    
    containers.forEach(c => {
      c.classList.remove('is-img-loaded');
      c.classList.add('is-img-loading');
    });
    imgs.forEach(i => i.classList.remove('img-is-ready'));

    console.info(`[Skeleton Demo] Simulating active image loading for ${durationMs}ms...`);

    setTimeout(() => {
      containers.forEach(c => {
        c.classList.add('is-img-loaded');
        c.classList.remove('is-img-loading');
      });
      imgs.forEach(i => i.classList.add('img-is-ready'));
      console.info('[Skeleton Demo] Images finished loading & transitioned gracefully.');
    }, durationMs);
  };
  window.setupImageSkeleton = setupImageSkeleton;

  // Run skeleton initialization immediately
  initImageSkeletonSystem();

  // If ?skeleton or ?demo_skeleton in query string, trigger demo for visual inspection
  try {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('skeleton') || urlParams.has('demo_skeleton')) {
      setTimeout(() => {
        window.showSkeletonDemo(5000);
      }, 500);
    }
    if (urlParams.has('test_track')) {
      const trackState = urlParams.get('test_track') || 'ready_for_pickup';
      const statusMap = {
        'ready': 'ready_for_pickup',
        'ready_for_pickup': 'ready_for_pickup',
        'cooking': 'cooking',
        'preparing': 'cooking',
        'accepted': 'accepted',
        'dispatched': 'on_the_way',
        'on_the_way': 'on_the_way',
        'delivered': 'delivered'
      };
      const finalStatus = statusMap[trackState] || trackState;
      const stepIndexMap = {
        'accepted': 0,
        'cooking': 1,
        'ready_for_pickup': 2,
        'on_the_way': 3,
        'delivered': 4
      };
      setTimeout(() => {
        const testOrder = {
          id: '#QB-5678',
          status: finalStatus,
          statusLabel: finalStatus === 'ready_for_pickup' ? 'Ready to Dispatch' : (finalStatus === 'cooking' ? 'Preparing' : (finalStatus === 'on_the_way' ? 'Dispatched' : 'Accepted')),
          stepIndex: stepIndexMap[finalStatus] ?? 2,
          itemsSummary: '2x Chicken Biryani (Full)',
          total: '₹420',
          eta: finalStatus === 'on_the_way' ? '8 - 12 Minutes' : '18 - 24 Minutes',
          assignedRiderName: 'Rahul Kumar',
          assignedRiderPhone: '+91 98451 23456',
          assignedRiderVehicle: '🏍️ Express Bike',
          deliveryAddress: 'Railway Colony, Near Old Station, Ramanagara',
          addressDetails: { lat: 12.7275, lng: 77.2740, address: 'Railway Colony, Near Old Station, Ramanagara' },
          lat: 12.7275,
          lng: 77.2740,
          createdAt: Date.now()
        };
        const testOrder2 = {
          id: '#QB-5119',
          status: 'ready_for_pickup',
          statusLabel: 'Ready to Dispatch',
          stepIndex: 2,
          itemsSummary: '1x Crispy Chicken Wings (6 pcs)',
          total: '₹220',
          eta: '20 - 25 Minutes',
          createdAt: Date.now() - 300000
        };
        const curOrders = dataService.getOrders();
        [testOrder, testOrder2].forEach(ord => {
          const idx = curOrders.findIndex(o => o.id === ord.id);
          if (idx >= 0) curOrders[idx] = ord;
          else curOrders.unshift(ord);
        });
        try {
          const myIds = JSON.parse(localStorage.getItem('quickbite_my_order_ids') || '[]');
          ['#QB-5678', '#QB-5119'].forEach(id => {
            if (!myIds.includes(id)) myIds.unshift(id);
          });
          localStorage.setItem('quickbite_my_order_ids', JSON.stringify(myIds));
        } catch {}
        dataService.saveOrders(curOrders);
        openOrderModal(testOrder.id, false);
        if (urlParams.has('scroll')) {
          setTimeout(() => {
            const scrollEl = document.getElementById('order-modal-scroll-body');
            if (scrollEl) scrollEl.scrollTop = 250;
          }, 400);
        }
      }, 500);
    }
  } catch (e) {}

  // ==========================================
  // STATE MANAGEMENT
  // ==========================================
  let cart = [];
  let appliedPromo = null; // 'CRISPY20' gives 20% off
  const FREE_SHIPPING_THRESHOLD = 25.00;
  let currentUser = null;

  function getCurrentAddresses() {
    return dataService.getUserAddresses(currentUser?.id, currentUser?.email);
  }

  function getCurrentUserPhone() {
    const addrs = getCurrentAddresses();
    const sel = (typeof selectedAddressId !== 'undefined' && selectedAddressId)
      ? addrs.find(a => a.id === selectedAddressId)
      : null;
    const def = addrs.find(a => a.isDefault) || addrs[0];
    const raw = currentUser?.user_metadata?.phone || currentUser?.phone || sel?.phone || def?.phone || '';
    return String(raw).trim();
  }

  function syncActiveUserContextToStorage() {
    try {
      if (currentUser) {
        localStorage.setItem('quickbite_active_user_context', JSON.stringify({
          id: currentUser.id || null,
          email: currentUser.email || '',
          phone: getCurrentUserPhone()
        }));
      } else {
        localStorage.removeItem('quickbite_active_user_context');
      }
    } catch {}
  }

  // Pre-cache live tracker video in the background for zero-wait instant opening
  if (typeof window !== 'undefined') {
    setTimeout(() => {
      preloadTrackerVideo();
    }, 1000);
  }

  // Load cart from localStorage if present
  try {
    const saved = localStorage.getItem('quickbite_cart');
    if (saved) {
      cart = JSON.parse(saved);
      // Auto-heal cart items with fresh images from dataService if stale or empty
      if (Array.isArray(cart) && typeof dataService !== 'undefined') {
        const dishes = dataService.getDishes();
        let healed = false;
        cart.forEach(item => {
          const live = dishes.find(d => d.id === item.id);
          if (live && live.image && (!item.image || item.image.includes('undefined') || item.image.includes('null') || item.image === '/images/crispy-chicken.jpg' || live.image !== item.image)) {
            item.image = live.image;
            healed = true;
          }
        });
        if (healed) {
          try { localStorage.setItem('quickbite_cart', JSON.stringify(cart)); } catch {}
        }
      }
    }
  } catch (e) {
    console.warn('Could not read cart from localStorage', e);
  }

  // ==========================================
  // DOM ELEMENT REFERENCES
  // ==========================================
  const navbar = document.getElementById('navbar');
  const cartTriggerBtn = document.getElementById('cart-trigger-btn');
  const cartBadge = document.getElementById('cart-badge');
  const cartDrawer = document.getElementById('cart-drawer');
  const cartDrawerBackdrop = document.getElementById('cart-drawer-backdrop');
  const cartCloseBtn = document.getElementById('cart-close-btn');
  const cartItemsList = document.getElementById('cart-items-list');
  const cartItemsCount = document.getElementById('cart-items-count');
  const cartEmptyState = document.getElementById('cart-empty-state');
  const summarySubtotal = document.getElementById('summary-subtotal');
  const summaryDiscount = document.getElementById('summary-discount');
  const summaryDelivery = document.getElementById('summary-delivery');
  const summaryTotal = document.getElementById('summary-total');
  const discountLine = document.getElementById('discount-line');
  const meterFill = document.getElementById('meter-fill');
  const meterText = document.getElementById('meter-text');
  const cartPromoInput = document.getElementById('cart-promo-input');
  const btnApplyPromo = document.getElementById('btn-apply-promo');
  const promoStatusMsg = document.getElementById('promo-status-msg');
  const btnCheckout = document.getElementById('btn-checkout');
  const btnStartOrder = document.getElementById('btn-start-order');

  // Hero & Interactive elements
  const btnHeroOrder = document.getElementById('btn-hero-order');
  const heroSection = document.getElementById('hero-section');
  const heroCollageScene = document.getElementById('hero-collage-scene');
  const blobRamen = document.getElementById('blob-chicken') || document.getElementById('blob-ramen');
  const blobPizza = document.getElementById('blob-pizza');
  const blobBurger = document.getElementById('blob-burger');

  // Carousel
  const catTrack = document.getElementById('category-track');
  const catPrevBtn = document.getElementById('cat-prev-btn');
  const catNextBtn = document.getElementById('cat-next-btn');
  const categoryCards = document.querySelectorAll('.category-card');

  // Menu filters
  const filterTabs = document.querySelectorAll('.filter-tab');
  const foodCards = document.querySelectorAll('.food-card');

  // Mobile nav
  const mobileToggleBtn = document.getElementById('mobile-toggle-btn');
  const mobileNavDrawer = document.getElementById('mobile-nav-drawer');

  // Modals & Banners
  const orderModalBackdrop = document.getElementById('order-modal-backdrop');
  const modalCloseBtn = document.getElementById('modal-close-btn');
  const btnModalDone = document.getElementById('btn-modal-done');
  const promoCodeBtn = document.getElementById('promo-code-btn');
  const btnClaimOffer = document.getElementById('btn-claim-offer');
  const toastContainer = document.getElementById('toast-container');
  const flyContainer = document.getElementById('fly-container');

  // Special Offers Popup Modal
  const offersModalBackdrop = document.getElementById('offers-modal-backdrop');
  const offersModalClose = document.getElementById('offers-modal-close');
  const offersModalClaimBtn = document.getElementById('offers-modal-claim-btn');
  const offersModalCodeBtn = document.getElementById('offers-modal-code-btn');
  const mobileNavOffers = document.getElementById('mobile-nav-offers');

  // ==========================================
  // HIGH-PERFORMANCE THROTTLED SCROLL & NAVBAR
  // ==========================================
  let scrollRafPending = false;
  let isNavbarScrolled = false;

  function syncNavbarHeightVar() {
    if (navbar) {
      const h = navbar.offsetHeight;
      if (h > 0) {
        document.documentElement.style.setProperty('--navbar-height', `${h}px`);
      }
    }
  }
  syncNavbarHeightVar();
  window.addEventListener('resize', syncNavbarHeightVar, { passive: true });

  function onScrollFrame() {
    scrollRafPending = false;
    const currentY = window.scrollY;

    // 1. Throttled navbar shadow toggle
    const shouldBeScrolled = currentY > 40;
    if (shouldBeScrolled !== isNavbarScrolled) {
      isNavbarScrolled = shouldBeScrolled;
      if (navbar) {
        navbar.classList.toggle('scrolled', isNavbarScrolled);
      }
    }

    // 2. Throttled Capsule Nav ScrollSpy
    if (typeof syncCapsuleNavWithScroll === 'function') {
      syncCapsuleNavWithScroll();
    }
  }

  window.addEventListener('scroll', () => {
    if (!scrollRafPending) {
      scrollRafPending = true;
      requestAnimationFrame(onScrollFrame);
    }
  }, { passive: true });

  // ==========================================
  // MOBILE NAVIGATION DRAWER
  // ==========================================
  function closeMobileMenuInternal() {
    if (mobileToggleBtn && mobileNavDrawer) {
      mobileToggleBtn.classList.remove('open');
      mobileNavDrawer.classList.remove('open');
    }
  }

  function closeMobileMenu() {
    if (backNav.isTopStep('mobile-nav')) {
      backNav.stepBack();
    } else {
      closeMobileMenuInternal();
      backNav.removeStepDirect('mobile-nav');
    }
  }

  if (mobileToggleBtn && mobileNavDrawer) {
    mobileToggleBtn.addEventListener('click', () => {
      const isOpening = !mobileNavDrawer.classList.contains('open');
      mobileToggleBtn.classList.toggle('open');
      mobileNavDrawer.classList.toggle('open');
      if (isOpening) {
        backNav.pushStep('mobile-nav', () => closeMobileMenuInternal());
      } else {
        backNav.removeStep('mobile-nav');
      }
    });

    // Close mobile nav when clicking a link
    document.querySelectorAll('.mobile-nav-item').forEach(link => {
      link.addEventListener('click', () => {
        closeMobileMenu();
      });
    });
  }

  // ==========================================
  // HERO 3D PARALLAX TILT EFFECT (Ultra Low CPU & Auto-Sleeping RAF)
  // ==========================================
  const supportsHover = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(hover: hover)').matches;
  if (heroSection && heroCollageScene && supportsHover) {
    let mouseX = 0;
    let mouseY = 0;
    let currentX = 0;
    let currentY = 0;
    let isParallaxLoopRunning = false;

    function stepParallax() {
      // Smooth lerp
      currentX += (mouseX - currentX) * 0.08;
      currentY += (mouseY - currentY) * 0.08;

      if (blobRamen && blobPizza && blobBurger) {
        blobRamen.style.transform = `translate3d(${currentX * -18}px, ${currentY * -14}px, 0)`;
        blobPizza.style.transform = `translate3d(${currentX * 16}px, ${currentY * 18}px, 0)`;
        blobBurger.style.transform = `translate3d(${currentX * -14}px, ${currentY * 20}px, 0)`;
      }

      // Automatically terminate RAF loop when settled to save 100% idle CPU
      const diffX = Math.abs(mouseX - currentX);
      const diffY = Math.abs(mouseY - currentY);
      if (diffX > 0.001 || diffY > 0.001) {
        requestAnimationFrame(stepParallax);
      } else {
        isParallaxLoopRunning = false;
      }
    }

    function triggerParallax() {
      if (!isParallaxLoopRunning && !document.hidden && !heroSection.classList.contains('hero-paused')) {
        isParallaxLoopRunning = true;
        requestAnimationFrame(stepParallax);
      }
    }

    heroSection.addEventListener('mousemove', (e) => {
      const rect = heroSection.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      mouseX = (e.clientX - centerX) / (rect.width / 2);
      mouseY = (e.clientY - centerY) / (rect.height / 2);
      triggerParallax();
    }, { passive: true });

    heroSection.addEventListener('mouseleave', () => {
      mouseX = 0;
      mouseY = 0;
      triggerParallax();
    });
  }

  // Pause offscreen hero animations when scrolled down
  if (heroSection && typeof IntersectionObserver !== 'undefined') {
    const heroObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          heroSection.classList.remove('hero-paused');
        } else {
          heroSection.classList.add('hero-paused');
        }
      });
    }, { rootMargin: '100px 0px 100px 0px' });
    heroObserver.observe(heroSection);
  }

  // ==========================================
  // SINGLE RESTAURANT DIRECT ORDER ACTION
  // ==========================================
  if (btnHeroOrder) {
    btnHeroOrder.addEventListener('click', (e) => {
      e.preventDefault();
      const menuSection = document.getElementById('menu-section');
      if (menuSection) {
        menuSection.scrollIntoView({ behavior: 'smooth' });
        showToast('🔥 Welcome! Explore our freshly prepared restaurant menu below.', 'success');
      }
    });
  }

  // ==========================================
  // CATEGORY CAROUSEL & MENU FILTERING
  // ==========================================
  if (catTrack && catPrevBtn && catNextBtn) {
    catPrevBtn.addEventListener('click', () => {
      catTrack.scrollBy({ left: -260, behavior: 'smooth' });
    });

    catNextBtn.addEventListener('click', () => {
      catTrack.scrollBy({ left: 260, behavior: 'smooth' });
    });

    categoryCards.forEach(card => {
      card.addEventListener('click', () => {
        categoryCards.forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        const cat = card.getAttribute('data-category');
        filterDishes(cat);
      });
    });
  }

  // Category Filter Pills & Recipe Search Logic
  const pillsWrap = document.getElementById('category-pills-wrap');
  const recipeSearchInput = document.getElementById('recipe-search-input');
  const clearSearchBtn = document.getElementById('clear-search-btn');
  const btnCircleFilter = document.getElementById('btn-circle-filter');

  let isAllExpanded = false;
  const ALL_PREVIEW_LIMIT = 8;
  const menuViewMoreShade = document.getElementById('menu-view-more-shade');
  const btnViewMoreMenu = document.getElementById('btn-view-more-menu');
  const viewMoreCountEl = document.getElementById('view-more-count');
  const menuShowLessWrap = document.getElementById('menu-show-less-wrap');
  const btnShowLessMenu = document.getElementById('btn-show-less-menu');

  function updateViewMoreUI(currentFilter, totalVisibleCount) {
    if (!menuViewMoreShade) return;
    if (currentFilter === 'all') {
      if (!isAllExpanded && totalVisibleCount > ALL_PREVIEW_LIMIT) {
        menuViewMoreShade.style.display = 'flex';
        if (menuShowLessWrap) menuShowLessWrap.style.display = 'none';
        const remainingCount = totalVisibleCount - ALL_PREVIEW_LIMIT;
        if (viewMoreCountEl) {
          viewMoreCountEl.textContent = `+${remainingCount} More`;
        }
      } else {
        menuViewMoreShade.style.display = 'none';
        if (menuShowLessWrap) {
          menuShowLessWrap.style.display = isAllExpanded ? 'flex' : 'none';
        }
      }
    } else {
      menuViewMoreShade.style.display = 'none';
      if (menuShowLessWrap) menuShowLessWrap.style.display = 'none';
    }
  }

  function filterDishes(filter) {
    const cards = document.querySelectorAll('.recipe-card');
    let visibleIndex = 0;
    let totalMatches = 0;

    cards.forEach(card => {
      const cardCat = card.getAttribute('data-category') || '';
      const cardTags = card.getAttribute('data-tags') || '';
      let match = false;

      if (filter === 'all') {
        match = true;
      } else if (filter === 'popular') {
        match = cardTags.includes('popular');
      } else if (filter === 'favorites') {
        match = cardTags.includes('favorites');
      } else {
        match = cardCat.includes(filter);
      }

      if (match) {
        totalMatches++;
        if (filter === 'all' && !isAllExpanded && visibleIndex >= ALL_PREVIEW_LIMIT) {
          card.style.display = 'none';
          card.classList.add('menu-item-collapsed');
        } else {
          card.style.display = 'block';
          card.classList.remove('menu-item-collapsed');
          card.style.animation = 'item-appear 0.35s var(--ease-spring)';
        }
        visibleIndex++;
      } else {
        card.style.display = 'none';
      }
    });

    updateViewMoreUI(filter, totalMatches);
  }

  if (btnViewMoreMenu) {
    btnViewMoreMenu.addEventListener('click', () => {
      isAllExpanded = true;
      filterDishes('all');
    });
  }

  if (btnShowLessMenu) {
    btnShowLessMenu.addEventListener('click', () => {
      isAllExpanded = false;
      filterDishes('all');
      const grid = document.getElementById('recipe-grid');
      if (grid) {
        grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  function syncStorefrontCategories() {
    if (!pillsWrap) return;
    const categories = dataService.getCategories();
    if (!categories || categories.length === 0) return;

    const activePill = pillsWrap.querySelector('.category-pill.active');
    const activeFilter = activePill ? activePill.getAttribute('data-filter') : 'all';

    const allImg = (typeof dataService.getAllCategoryImage === 'function')
      ? dataService.getAllCategoryImage()
      : 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=200&auto=format&fit=crop&q=80';

    let html = `
      <button class="category-pill cuisine-circle-item ${activeFilter === 'all' ? 'active' : ''}" data-filter="all" title="View All Dishes">
        <div class="cuisine-circle-wrap">
          <img src="${escapeHtml(allImg)}" alt="All" class="cuisine-circle-img cuisine-circle-all-img" loading="lazy" />
          <span class="cuisine-check-badge"><i class="fa-solid fa-check"></i></span>
        </div>
        <span class="cuisine-circle-name">All</span>
      </button>
    `;

    categories.forEach(cat => {
      const slug = cat.slug || cat.id.replace(/^cat-/, '');
      const isActive = activeFilter === slug;
      const rawImg = (cat.image || '').trim();
      const imgUrl = (typeof dataService.sanitizeCategoryImageUrl === 'function')
        ? dataService.sanitizeCategoryImageUrl(rawImg)
        : ((rawImg.startsWith('categories/') || rawImg.startsWith('dishes/'))
          ? `/api/r2-image?key=${encodeURIComponent(rawImg)}`
          : rawImg);
      const emoji = cat.emoji || '🍽️';
      const safeName = escapeHtml(cat.name);

      html += `
        <button class="category-pill cuisine-circle-item ${isActive ? 'active' : ''}" data-filter="${slug}" title="${safeName}">
          <div class="cuisine-circle-wrap">
            ${imgUrl ? `
              <img src="${escapeHtml(imgUrl)}" alt="${safeName}" class="cuisine-circle-img" loading="lazy" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';" />
              <span class="cuisine-circle-fallback" style="display:none;">${emoji}</span>
            ` : `
              <span class="cuisine-circle-fallback">${emoji}</span>
            `}
            <span class="cuisine-check-badge"><i class="fa-solid fa-check"></i></span>
          </div>
          <span class="cuisine-circle-name">${safeName}</span>
        </button>
      `;
    });

    pillsWrap.innerHTML = html;
  }

  // ==========================================
  // CATEGORY EXPAND / COLLAPSE CONTROLLER
  // ==========================================
  const btnExpandCategories = document.getElementById('category-expand-btn');
  const catStickyBar = document.getElementById('category-sticky-bar');
  const catExpandBackdrop = document.getElementById('category-expand-backdrop');

  function setCategoryExpanded(expanded) {
    if (!catStickyBar) return;
    if (expanded) {
      catStickyBar.classList.add('is-expanded');
      if (btnExpandCategories) {
        btnExpandCategories.setAttribute('aria-expanded', 'true');
        btnExpandCategories.setAttribute('title', 'Collapse categories');
      }
      if (catExpandBackdrop) catExpandBackdrop.classList.add('open');
    } else {
      catStickyBar.classList.remove('is-expanded');
      if (btnExpandCategories) {
        btnExpandCategories.setAttribute('aria-expanded', 'false');
        btnExpandCategories.setAttribute('title', 'Show all categories');
      }
      if (catExpandBackdrop) catExpandBackdrop.classList.remove('open');
    }
  }

  if (btnExpandCategories && catStickyBar) {
    btnExpandCategories.addEventListener('click', (e) => {
      e.stopPropagation();
      const isExpanded = catStickyBar.classList.contains('is-expanded');
      setCategoryExpanded(!isExpanded);
    });

    if (catExpandBackdrop) {
      catExpandBackdrop.addEventListener('click', () => {
        setCategoryExpanded(false);
      });
    }

    document.addEventListener('click', (e) => {
      if (catStickyBar.classList.contains('is-expanded')) {
        if (!catStickyBar.contains(e.target) && (!catExpandBackdrop || !catExpandBackdrop.contains(e.target))) {
          setCategoryExpanded(false);
        }
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && catStickyBar.classList.contains('is-expanded')) {
        setCategoryExpanded(false);
      }
    });
  }

  // Delegated pill click listener
  if (pillsWrap) {
    pillsWrap.addEventListener('click', (e) => {
      const pill = e.target.closest('.category-pill');
      if (!pill) return;
      pillsWrap.querySelectorAll('.category-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const filter = pill.getAttribute('data-filter');
      filterDishes(filter);

      // Auto-collapse expanded view on category selection
      setCategoryExpanded(false);

      // Smoothly center the active pill in horizontal scroll track after full name width expands
      setTimeout(() => {
        try {
          pill.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        } catch (_) {}
      }, 40);

      // Keep dishes and categories comfortably visible if scrolled past
      const catWrap = document.getElementById('category-sticky-wrapper') || document.getElementById('category-sticky-bar');
      if (catWrap) {
        const rect = catWrap.getBoundingClientRect();
        if (rect.top < -10) {
          window.scrollTo({
            top: Math.max(0, window.scrollY + rect.top - 16),
            behavior: 'smooth'
          });
        }
      }

      // Sync active state on carousel if matching
      categoryCards.forEach(c => {
        if (c.getAttribute('data-category') === filter) {
          c.classList.add('active');
          c.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        } else {
          c.classList.remove('active');
        }
      });
    });
  }

  filterDishes('all');
  syncStorefrontCategories();
  if (typeof dataService.on === 'function') {
    dataService.on('change:categories', syncStorefrontCategories);
    dataService.on('categories', syncStorefrontCategories);
  }
  document.addEventListener('DOMContentLoaded', () => {
    try { syncStorefrontCategories(); } catch {}
  });
  window.addEventListener('load', () => {
    try { syncStorefrontCategories(); } catch {}
  });

  // Recipe Live Search Input
  if (recipeSearchInput) {
    recipeSearchInput.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      if (clearSearchBtn) {
        clearSearchBtn.style.display = q ? 'block' : 'none';
      }
      if (menuViewMoreShade) menuViewMoreShade.style.display = q ? 'none' : (isAllExpanded ? 'none' : 'flex');
      if (menuShowLessWrap) menuShowLessWrap.style.display = 'none';

      const cards = document.querySelectorAll('.recipe-card');
      cards.forEach(card => {
        const title = (card.querySelector('.recipe-title')?.textContent || '').toLowerCase();
        const cat = (card.getAttribute('data-category') || '').toLowerCase();
        const tags = (card.getAttribute('data-tags') || '').toLowerCase();
        if (!q || title.includes(q) || cat.includes(q) || tags.includes(q)) {
          card.style.display = 'block';
        } else {
          card.style.display = 'none';
        }
      });
    });

    if (clearSearchBtn) {
      clearSearchBtn.addEventListener('click', () => {
        recipeSearchInput.value = '';
        clearSearchBtn.style.display = 'none';
        filterDishes('all');
        categoryPills.forEach(p => p.classList.toggle('active', p.getAttribute('data-filter') === 'all'));
      });
    }
  }

  if (btnCircleFilter) {
    btnCircleFilter.addEventListener('click', () => {
      const favPill = document.querySelector('.category-pill[data-filter="favorites"]');
      if (favPill) {
        favPill.click();
        showToast('Showing favorite dishes! ❤️', 'info');
      }
    });
  }

  // ==========================================
  // BALLISTIC FLY-TO-CART ANIMATION ENGINE
  // ==========================================
  function animateFlyToCart(startElement, imageUrl) {
    const navCircleAction = document.getElementById('nav-circle-action');
    const targetElement = navCircleAction || cartTriggerBtn;
    if (!startElement || !targetElement || !flyContainer) return;

    const startRect = startElement.getBoundingClientRect();
    const targetRect = targetElement.getBoundingClientRect();

    const startX = startRect.left + startRect.width / 2 - 25;
    const startY = startRect.top + startRect.height / 2 - 25;

    const targetX = targetRect.left + targetRect.width / 2 - 25;
    const targetY = targetRect.top + targetRect.height / 2 - 25;

    const flyer = document.createElement('img');
    flyer.src = imageUrl || '/images/crispy-chicken.jpg';
    flyer.onerror = () => { flyer.style.display = 'none'; };
    flyer.className = 'flying-food-particle';
    flyer.style.left = `${startX}px`;
    flyer.style.top = `${startY}px`;
    flyContainer.appendChild(flyer);

    // Force layout reflow
    void flyer.offsetWidth;

    // Ballistic curved trajectory
    flyer.style.transform = `translate(${targetX - startX}px, ${targetY - startY}px) scale(0.2) rotate(360deg)`;
    flyer.style.opacity = '0.4';

    setTimeout(() => {
      flyer.remove();
      // Cart bounce animation
      if (cartBadge) cartBadge.classList.add('bump');
      if (cartTriggerBtn) cartTriggerBtn.style.transform = 'scale(1.25)';
      if (navCircleAction) navCircleAction.style.transform = 'scale(1.25)';
      setTimeout(() => {
        if (cartBadge) cartBadge.classList.remove('bump');
        if (cartTriggerBtn) cartTriggerBtn.style.transform = '';
        if (navCircleAction) navCircleAction.style.transform = '';
      }, 300);
    }, 750);
  }

  // ==========================================
  // CART OPERATIONS & UI SYNC
  // ==========================================
  function addToCart(item, triggerElement, qty = 1) {
    const existing = cart.find(i => i.id === item.id);
    if (existing) {
      existing.quantity += qty;
    } else {
      cart.push({ ...item, quantity: qty });
    }

    saveCart();
    renderCart();

    // Trigger visual ballistic animation
    animateFlyToCart(triggerElement, item.image);

    showToast(`Added ${qty > 1 ? qty + 'x ' : ''}${item.name} to basket! 🛒`, 'success');
  }

  function removeFromCart(id) {
    cart = cart.filter(i => i.id !== id);
    saveCart();
    renderCart();
  }

  function updateQuantity(id, delta) {
    const item = cart.find(i => i.id === id);
    if (!item) return;

    item.quantity += delta;
    if (item.quantity <= 0) {
      removeFromCart(id);
    } else {
      saveCart();
      renderCart();
    }
  }

  function saveCart() {
    try {
      localStorage.setItem('quickbite_cart', JSON.stringify(cart));
    } catch (e) {
      console.warn('LocalStorage error', e);
    }
  }

  function updateMenuCardSteppers() {
    // Menu cards keep the clean floating .btn-glass-add button matching Cryspychiken
  }

  function renderCart() {
    updateMenuCardSteppers();
    const totalCount = cart.reduce((acc, i) => acc + i.quantity, 0);
    if (cartBadge) cartBadge.textContent = totalCount;
    if (cartItemsCount) cartItemsCount.textContent = `(${totalCount} item${totalCount === 1 ? '' : 's'})`;

    const floatBagBadge = document.getElementById('float-bag-badge');
    if (floatBagBadge) floatBagBadge.textContent = totalCount;

    const circleActionBadge = document.getElementById('circle-action-badge');
    if (circleActionBadge) {
      if (totalCount > 0) {
        circleActionBadge.textContent = totalCount;
        circleActionBadge.style.display = 'flex';
      } else {
        circleActionBadge.style.display = 'none';
      }
    }

    const subtotal = cart.reduce((acc, i) => acc + (i.price * i.quantity), 0);

    // Empty state handling
    if (cart.length === 0) {
      cartItemsList.innerHTML = '';
      cartItemsList.appendChild(cartEmptyState);
      cartEmptyState.style.display = 'block';
      summarySubtotal.textContent = '₹0';
      summaryTotal.textContent = '₹0';
      const settings = dataService.getSettings();
      const minOrderVal = Number(settings.minOrderValue !== undefined ? settings.minOrderValue : (settings.minOrder !== undefined ? settings.minOrder : 0));
      const currentThreshold = Number(settings.freeDeliveryThreshold !== undefined ? settings.freeDeliveryThreshold : 250);
      summaryDelivery.textContent = '₹0';
      discountLine.style.display = 'none';
      meterFill.style.width = '0%';
      meterText.innerHTML = minOrderVal > 0
        ? `Min order <strong>₹${minOrderVal}</strong> • FREE delivery above <strong>₹${Math.round(currentThreshold)}</strong>!`
        : `FREE delivery on orders above <strong>₹${Math.round(currentThreshold)}</strong>!`;
      if (btnCheckout) btnCheckout.classList.remove('disabled-min-order');
      if (btnCheckoutLabel) btnCheckoutLabel.textContent = 'Proceed to Checkout';
      return;
    }

    cartEmptyState.style.display = 'none';
    cartItemsList.innerHTML = '';

    cart.forEach(item => {
      const el = document.createElement('div');
      el.className = 'cart-item';
      const safeId = escapeHtml(item.id);
      const safeName = escapeHtml(item.name);

      // Auto-heal and retrieve authentic unique dish image from dataService
      const liveDish = (typeof dataService !== 'undefined' && typeof dataService.getDishById === 'function')
        ? (dataService.getDishById(item.id) || (dataService.getDishes && dataService.getDishes().find(d => d.name === item.name)))
        : null;
      let rawImg = (liveDish && liveDish.image) ? liveDish.image : item.image;
      if (typeof sanitizeDishImageUrl === 'function') {
        rawImg = sanitizeDishImageUrl(rawImg);
      }
      const safeImage = sanitizeUrl(rawImg, '');
      if (safeImage && item.image !== safeImage) {
        item.image = safeImage;
      }
      const isSoldOut = liveDish && liveDish.inStock === false;
      if (isSoldOut) {
        el.classList.add('cart-item-sold-out');
      }
      const safePrice = Math.round((parseFloat(item.price) || 0) * (parseInt(item.quantity) || 1));
      const soldOutBadge = isSoldOut ? ' <span class="cart-sold-out-badge" style="color: #ef4444; font-size: 0.72rem; font-weight: 600; background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.3); padding: 1px 6px; border-radius: 4px; margin-left: 4px;">Sold Out</span>' : '';
      el.innerHTML = `
        <div class="cart-item-img-wrap is-img-loading">
          <img src="${safeImage}" alt="${safeName}" class="cart-item-img" loading="eager" decoding="async"/>
        </div>
        <div class="cart-item-info">
          <div class="cart-item-title">${safeName}${soldOutBadge}</div>
          <div class="cart-item-price">₹${safePrice}</div>
        </div>
        <div class="cart-qty-ctrl">
          <button class="qty-btn btn-minus" data-id="${safeId}">-</button>
          <span class="qty-val">${parseInt(item.quantity) || 1}</span>
          <button class="qty-btn btn-plus" data-id="${safeId}">+</button>
        </div>
        <button class="cart-item-del" data-id="${safeId}" title="Remove item">✕</button>
      `;

      // Set up skeleton loader for the cart item image
      const cartImg = el.querySelector('.cart-item-img');
      if (cartImg) setupImageSkeleton(cartImg);

      // Events for quantity buttons
      el.querySelector('.btn-minus').addEventListener('click', () => updateQuantity(item.id, -1));
      el.querySelector('.btn-plus').addEventListener('click', () => updateQuantity(item.id, 1));
      el.querySelector('.cart-item-del').addEventListener('click', () => removeFromCart(item.id));

      cartItemsList.appendChild(el);
    });

    // Calculations & Dynamic Offer Sync
    const settings = dataService.getSettings();
    const activeCode = (settings.offerCode || 'CRISPY20').trim().toUpperCase();
    const discountType = settings.offerDiscountType || 'percent'; // 'percent' | 'flat'
    const discountPct = Number(settings.offerDiscountPercent || 20);
    const discountAmt = Number(settings.offerDiscountAmount || 50);
    const minOrder = Number(settings.offerMinOrder || 0);

    const isPromoEntered = Boolean(appliedPromo && appliedPromo === activeCode);
    const isPromoActive = settings.offerActive !== false;
    const meetsMinOrder = subtotal >= minOrder;
    const isPromoValid = isPromoActive && isPromoEntered && meetsMinOrder;

    // Free delivery calculation
    const isFreeDeliveryEnabled = settings.freeDeliveryEnabled !== false;
    const freeDeliveryThreshold = Number(settings.freeDeliveryThreshold !== undefined ? settings.freeDeliveryThreshold : 250);
    const standardDeliveryFee = Number(settings.deliveryFeeStandard || 40);

    const thresholdUnlockedFreeDelivery = isFreeDeliveryEnabled && freeDeliveryThreshold > 0 && subtotal >= freeDeliveryThreshold;
    const promoUnlockedFreeDelivery = isPromoValid && settings.offerFreeDelivery !== false;
    const freeDeliveryUnlocked = thresholdUnlockedFreeDelivery || promoUnlockedFreeDelivery;
    const deliveryFee = freeDeliveryUnlocked ? 0 : standardDeliveryFee;

    // Minimum Order & Free Delivery Meter
    const minOrderValue = Number(settings.minOrderValue !== undefined ? settings.minOrderValue : (settings.minOrder !== undefined ? settings.minOrder : 0));
    const safeActiveCode = escapeHtml(activeCode);

    if (minOrderValue > 0 && subtotal < minOrderValue) {
      // Step 1: Customer needs to reach Minimum Order Value first
      const neededForMin = Math.round(minOrderValue - subtotal);
      const minPct = Math.min(100, Math.max(0, Math.round((subtotal / minOrderValue) * 100)));
      meterFill.style.width = `${minPct}%`;
      meterFill.style.background = 'linear-gradient(90deg, #F59E0B, #EF4444)';
      meterText.innerHTML = `🛒 Minimum order is <strong>₹${minOrderValue}</strong>. Add <strong>₹${neededForMin}</strong> more to checkout!`;
      if (btnCheckout) btnCheckout.classList.add('disabled-min-order');
      if (btnCheckoutLabel) btnCheckoutLabel.textContent = `Min Order ₹${minOrderValue} (Add ₹${neededForMin})`;
    } else {
      // Step 2: Minimum order satisfied! Enable checkout and show Free Delivery progress
      if (btnCheckout) btnCheckout.classList.remove('disabled-min-order');
      if (btnCheckoutLabel && !btnCheckout.classList.contains('disabled-limit')) {
        btnCheckoutLabel.textContent = 'Proceed to Checkout';
      }

      if (isFreeDeliveryEnabled && freeDeliveryThreshold > 0) {
        const remainingForFree = freeDeliveryThreshold - subtotal;
        if (freeDeliveryUnlocked) {
          meterFill.style.width = '100%';
          meterFill.style.background = '#10B981';
          if (promoUnlockedFreeDelivery && !thresholdUnlockedFreeDelivery) {
            meterText.innerHTML = `🎉 Coupon <strong>${safeActiveCode}</strong> unlocked <strong>FREE Priority Delivery</strong>!`;
          } else {
            meterText.innerHTML = `🎉 You unlocked <strong>FREE Priority Delivery</strong> (Orders over ₹${Math.round(freeDeliveryThreshold)})!`;
          }
        } else {
          const pct = Math.min(100, Math.max(0, Math.round((subtotal / freeDeliveryThreshold) * 100)));
          meterFill.style.width = `${pct}%`;
          meterFill.style.background = 'var(--brand-primary)';
          meterText.innerHTML = `Add <strong>₹${Math.round(remainingForFree)}</strong> more for <strong>FREE Priority Delivery</strong>!`;
        }
      } else if (promoUnlockedFreeDelivery) {
        meterFill.style.width = '100%';
        meterFill.style.background = '#10B981';
        meterText.innerHTML = `🎉 Coupon <strong>${safeActiveCode}</strong> unlocked <strong>FREE Priority Delivery</strong>!`;
      } else {
        meterFill.style.width = '100%';
        meterFill.style.background = '#10B981';
        meterText.textContent = '✓ Minimum Order Reached';
      }
    }

    let discount = 0;
    if (isPromoValid) {
      if (discountType === 'flat') {
        discount = Math.min(subtotal, discountAmt);
      } else {
        discount = subtotal * (discountPct / 100);
      }
      discountLine.style.display = 'flex';
      summaryDiscount.textContent = `-₹${Math.round(discount)}`;
      const discountLabel = document.getElementById('summary-discount-label');
      if (discountLabel) {
        const discBadge = discountType === 'flat' ? `₹${Math.round(discountAmt)} OFF` : `${discountPct}% OFF`;
        discountLabel.textContent = `Discount (${activeCode} - ${discBadge})`;
      }
    } else {
      discountLine.style.display = 'none';
    }

    // Dynamic warning or status in promo message area if coupon is entered
    if (promoStatusMsg) {
      if (isPromoEntered && isPromoActive && !meetsMinOrder) {
        const needed = Math.round(minOrder - subtotal);
        promoStatusMsg.style.color = '#DC2626';
        promoStatusMsg.innerHTML = `⚠️ Coupon <strong>${safeActiveCode}</strong> requires minimum order of ₹${Math.round(minOrder)}. Add <strong>₹${needed}</strong> more to apply!`;
      } else if (isPromoValid) {
        const discBadge = discountType === 'flat' ? `₹${Math.round(discountAmt)} OFF` : `${discountPct}% OFF`;
        promoStatusMsg.style.color = '#059669';
        promoStatusMsg.innerHTML = `✓ Coupon <strong>${safeActiveCode}</strong> applied: ${discBadge}${promoUnlockedFreeDelivery ? ' + Free Delivery!' : ''}`;
      } else if (!isPromoEntered) {
        promoStatusMsg.textContent = '';
      }
    }

    const total = Math.max(0, subtotal - discount + deliveryFee);

    summarySubtotal.textContent = `₹${Math.round(subtotal)}`;
    summaryDelivery.textContent = deliveryFee === 0 ? 'FREE' : `₹${Math.round(deliveryFee)}`;
    summaryTotal.textContent = `₹${Math.round(total)}`;

    // Check if any cart item is currently marked Sold Out
    const allDishes = (typeof dataService !== 'undefined' && typeof dataService.getDishes === 'function') ? dataService.getDishes() : [];
    const soldOutItem = cart.find(item => {
      const dish = allDishes.find(d => d.id === item.id || d.name === item.name);
      return dish && dish.inStock === false;
    });

    if (soldOutItem) {
      if (btnCheckout) {
        btnCheckout.classList.add('disabled-sold-out');
        btnCheckout.disabled = true;
      }
      if (btnCheckoutLabel) {
        btnCheckoutLabel.textContent = `⚠️ "${soldOutItem.name}" Sold Out`;
      }
    } else if (minOrderValue <= 0 || subtotal >= minOrderValue) {
      if (btnCheckout) {
        btnCheckout.classList.remove('disabled-sold-out');
        if (!btnCheckout.classList.contains('disabled-limit')) {
          btnCheckout.disabled = false;
        }
      }
    }

    renderCartAddresses();
    renderCartOrderLimitUI();
  }

  // Delegated click handler on #menu-section (handles all 40+ dishes with 1 listener)
  function attachAddToCartListeners() {
    // Kept for backward compatibility - delegated listener handles clicks
  }

  // ==========================================
  // DISH DETAILS DATABASE & INTERACTIVE MODAL
  // ==========================================
  function getEnrichedDishDetail(idOrDish) {
    const dish = (typeof idOrDish === 'object' && idOrDish !== null)
      ? idOrDish
      : (dataService.getDishById(idOrDish) || dataService.getDishes().find(d => d.id === idOrDish));
    
    if (!dish) return null;

    let defaultIngredients = ['Farm fresh prime chicken / ingredients', 'Secret 11-spice herb dredge', 'Chef special preparation'];
    let defaultSpices = ['Mild Classic', 'Zesty Medium 🌶️', 'Hot Fire 🔥'];
    let defaultSauces = ['Garlic Ranch', 'Smoky BBQ', 'Sriracha Mayo'];

    if (dish.category === 'chicken' || dish.category === 'strips') {
      defaultIngredients = ['Prime farm fresh chicken', '24h buttermilk herb brine', 'Double-crunch coating', 'Secret house spices'];
      defaultSpices = ['Classic Golden Crunch', 'Peri-Peri Shaken 🌶️', 'Nashville Hot 🔥'];
      defaultSauces = ['Garlic Ranch Dip', 'Smoky Honey BBQ', 'Sweet Chili Mayo'];
    } else if (dish.category === 'combos') {
      defaultIngredients = ['Crispy chicken / burger', 'Golden potato fries', 'Chilled beverage', 'Signature dipping sauces'];
      defaultSpices = ['Original Classic', 'Extra Spicy Zing 🌶️'];
      defaultSauces = ['Cheesy Jalapeno Dip', 'Smoky BBQ', 'Tangy Tomato Dip'];
    } else if (dish.category === 'burger') {
      defaultIngredients = ['Crispy chicken patty/fillet', 'Toasted butter brioche bun', 'Aged cheddar cheese', 'Fresh crisp lettuce', 'House burger spread'];
      defaultSpices = ['Savory Herb', 'Spicy Pepper Jack 🌶️', 'Ghost Fire 🔥'];
      defaultSauces = ['Secret Burger Sauce', 'Truffle Garlic Aioli', 'Smoky Honey BBQ'];
    } else if (dish.category === 'pizza') {
      defaultIngredients = ['Hand-stretched artisan dough', 'Herb tomato pizza marinara', '100% Mozzarella cheese melt', 'Seasoned toppings'];
      defaultSpices = ['Oregano & Basil Herb', 'Red Chili Flakes 🌶️', 'Garlic Crust Seasoning'];
      defaultSauces = ['Garlic Butter Crust Dip', 'Chipotle Mayo', 'Extra Cheese Sauce'];
    } else if (dish.category === 'sandwich') {
      defaultIngredients = ['Tender chicken / fillings', 'Toasted golden bread', 'Tangy mayo spread', 'Crisp cucumber & bell pepper'];
      defaultSpices = ['Black Pepper & Herb', 'Chatpata Masala 🌶️'];
      defaultSauces = ['Mint Mayo', 'Honey Mustard', 'Garlic Herb Spread'];
    } else if (dish.category === 'bites' || dish.category === 'fries') {
      defaultIngredients = ['Golden fried bite/fries', 'Smoked sea salt', 'Crispy crunchy coating'];
      defaultSpices = ['Classic Salted', 'Peri-Peri Tossed 🌶️', 'Lemon Pepper Twist 🍋'];
      defaultSauces = ['Molten Cheese Sauce', 'Garlic Aioli', 'Tangy Ketchup'];
    } else if (dish.category === 'momos') {
      defaultIngredients = ['Thin soft dumpling wrap', 'Juicy seasoned minced filling', 'Spring onions & fresh herbs'];
      defaultSpices = ['Mild Steamed', 'Chatpata Momo Rub 🌶️'];
      defaultSauces = ['Fiery Tibetan Momo Chutney 🔥', 'Creamy Mayo Dip', 'Tangy Mint Chutney'];
    } else if (dish.category === 'roll') {
      defaultIngredients = ['Toasted flaky flatbread wrap', 'Spiced filling & onions', 'Tangy green chutney', 'House mint mayo'];
      defaultSpices = ['Classic Chatpata', 'Extra Spicy Chili 🌶️'];
      defaultSauces = ['Mint Chutney', 'Tangy Mayo', 'Sweet Chili Drizzle'];
    }

    return {
      ...dish,
      rating: dish.rating || '5.0 (200+ reviews)',
      badge: dish.badge || (dish.inStock === false ? 'Sold Out' : '🔥 Popular'),
      category: dish.categoryName || dish.category,
      time: dish.time || '10 - 12 mins',
      calories: dish.calories || '420 kcal',
      diet: dish.diet || 'Fresh Daily',
      desc: dish.desc || `${dish.name} prepared fresh in our kitchen with signature spices and authentic flavours.`,
      ingredients: dish.ingredients || defaultIngredients,
      spices: dish.spices || defaultSpices,
      sauces: dish.sauces || defaultSauces
    };
  }

  const DISH_DETAILS = new Proxy({}, {
    get: (_, prop) => getEnrichedDishDetail(prop)
  });

  // Food Detail Sheet DOM Elements
  const foodDetailBackdrop = document.getElementById('food-detail-backdrop');
  const foodModalClose = document.getElementById('food-modal-close');
  const foodModalFavBtn = document.getElementById('food-modal-fav-btn');
  const foodDetailImg = document.getElementById('food-detail-img');
  const foodDetailBadge = document.getElementById('food-detail-badge');
  const foodDetailRating = document.getElementById('food-detail-rating');
  const foodDetailCat = document.getElementById('food-detail-cat');
  const foodDetailTitle = document.getElementById('food-detail-title');
  const foodDetailPrice = document.getElementById('food-detail-price');
  const foodDetailDesc = document.getElementById('food-detail-desc');
  const foodDetailTime = document.getElementById('food-detail-time');
  const foodDetailCals = document.getElementById('food-detail-cals');
  const foodDetailDiet = document.getElementById('food-detail-diet');
  const foodDetailIngredients = document.getElementById('food-detail-ingredients');
  const modalQtyMinus = document.getElementById('modal-qty-minus');
  const modalQtyPlus = document.getElementById('modal-qty-plus');
  const modalQtyText = document.getElementById('modal-qty-text');
  const modalSubmitPrice = document.getElementById('modal-submit-price');
  const btnModalAddCart = document.getElementById('btn-modal-add-cart');
  const spicePillsGroup = document.getElementById('detail-spice-group');
  const saucePillsGroup = document.getElementById('detail-sauce-group');

  let activeDetailItem = null;
  let activeDetailQty = 1;

  function updateModalSubmitPrice() {
    if (!activeDetailItem) return;
    const total = activeDetailItem.price * activeDetailQty;
    if (modalSubmitPrice) modalSubmitPrice.textContent = `₹${Math.round(total)}`;
    if (modalQtyText) modalQtyText.textContent = activeDetailQty;
  }

  function openFoodDetail(dish) {
    activeDetailItem = dish;
    activeDetailQty = 1;

    if (foodDetailImg) {
      const modalHero = foodDetailImg.closest('.food-modal-hero');
      foodDetailImg.classList.remove('img-is-ready');
      if (modalHero) {
        modalHero.classList.remove('is-img-loaded');
        modalHero.classList.add('is-img-loading');
      }
      foodDetailImg.src = dish.image;
      foodDetailImg.alt = dish.name;
      setupImageSkeleton(foodDetailImg);
    }
    if (foodDetailTitle) foodDetailTitle.textContent = dish.name;
    if (foodDetailPrice) foodDetailPrice.textContent = `₹${Math.round(dish.price)}`;
    if (foodDetailCat) foodDetailCat.textContent = dish.category;
    if (foodDetailDesc) foodDetailDesc.textContent = dish.desc;
    if (foodDetailBadge) foodDetailBadge.textContent = dish.badge;
    if (foodDetailRating) foodDetailRating.style.display = 'none';
    if (foodDetailTime) foodDetailTime.textContent = dish.time;
    if (foodDetailCals) foodDetailCals.textContent = dish.calories;
    if (foodDetailDiet) foodDetailDiet.textContent = dish.diet;

    // Ingredients tags
    if (foodDetailIngredients && Array.isArray(dish.ingredients)) {
      foodDetailIngredients.innerHTML = dish.ingredients
        .map(ing => `<span class="ing-pill">${escapeHtml(ing)}</span>`)
        .join('');
    }

    // Spice customization pills
    if (spicePillsGroup && Array.isArray(dish.spices)) {
      spicePillsGroup.innerHTML = dish.spices
        .map((s, idx) => `<button class="custom-choice-pill ${idx === 0 ? 'active' : ''}">${escapeHtml(s)}</button>`)
        .join('');

      spicePillsGroup.querySelectorAll('.custom-choice-pill').forEach(pill => {
        pill.addEventListener('click', () => {
          spicePillsGroup.querySelectorAll('.custom-choice-pill').forEach(p => p.classList.remove('active'));
          pill.classList.add('active');
        });
      });
    }

    // Sauce customization pills
    if (saucePillsGroup && Array.isArray(dish.sauces)) {
      saucePillsGroup.innerHTML = dish.sauces
        .map((s, idx) => `<button class="custom-choice-pill ${idx === 0 ? 'active' : ''}">${escapeHtml(s)}</button>`)
        .join('');

      saucePillsGroup.querySelectorAll('.custom-choice-pill').forEach(pill => {
        pill.addEventListener('click', () => {
          saucePillsGroup.querySelectorAll('.custom-choice-pill').forEach(p => p.classList.remove('active'));
          pill.classList.add('active');
        });
      });
    }

    updateModalSubmitPrice();
    if (foodDetailBackdrop) {
      foodDetailBackdrop.classList.add('open');
      document.body.classList.add('food-modal-open');
      document.body.style.overflow = 'hidden';
      backNav.pushStep('food-detail', () => closeFoodDetailInternal());
    }
  }

  function closeFoodDetailInternal() {
    if (foodDetailBackdrop) {
      foodDetailBackdrop.classList.remove('open');
      document.body.classList.remove('food-modal-open');
      document.body.style.overflow = '';
    }
  }

  function closeFoodDetail() {
    if (backNav.isTopStep('food-detail')) {
      backNav.stepBack();
    } else {
      closeFoodDetailInternal();
      backNav.removeStepDirect('food-detail');
    }
  }

  if (foodModalClose) foodModalClose.addEventListener('click', closeFoodDetail);
  if (foodDetailBackdrop) {
    foodDetailBackdrop.addEventListener('click', (e) => {
      if (e.target === foodDetailBackdrop) closeFoodDetail();
    });
  }

  if (foodModalFavBtn) {
    foodModalFavBtn.addEventListener('click', () => {
      foodModalFavBtn.classList.toggle('active');
      const isFav = foodModalFavBtn.classList.contains('active');
      showToast(isFav ? '❤️ Saved to your favorite dishes!' : 'Removed from favorites', 'info');
    });
  }

  if (modalQtyMinus) {
    modalQtyMinus.addEventListener('click', () => {
      if (activeDetailQty > 1) {
        activeDetailQty -= 1;
        updateModalSubmitPrice();
      }
    });
  }

  if (modalQtyPlus) {
    modalQtyPlus.addEventListener('click', () => {
      activeDetailQty += 1;
      updateModalSubmitPrice();
    });
  }

  if (btnModalAddCart) {
    btnModalAddCart.addEventListener('click', () => {
      if (!activeDetailItem) return;
      addToCart({
        id: activeDetailItem.id,
        name: activeDetailItem.name,
        price: activeDetailItem.price,
        image: activeDetailItem.image
      }, btnModalAddCart, activeDetailQty);

      closeFoodDetail();
    });
  }

  // Unified High-Performance Delegated Menu Handler (Add-to-cart + Food Detail Modals + Stepper)
  const menuContainerEl = document.getElementById('menu-section');
  if (menuContainerEl) {
    menuContainerEl.addEventListener('click', (e) => {
      // 1. Check if an add-to-cart button was clicked
      const addBtn = e.target.closest('.btn-add-cart');
      if (addBtn) {
        e.stopPropagation();
        if (addBtn.disabled || addBtn.hasAttribute('disabled')) {
          showToast('Sorry, this dish is currently out of stock ⚠️', 'warning');
          return;
        }
        const item = {
          id: addBtn.getAttribute('data-id'),
          name: addBtn.getAttribute('data-name'),
          price: parseFloat(addBtn.getAttribute('data-price')),
          image: addBtn.getAttribute('data-image')
        };
        addToCart(item, addBtn);
        return;
      }

      // 2. Stepper Plus button clicked
      const plusBtn = e.target.closest('.card-stepper-plus');
      if (plusBtn) {
        e.stopPropagation();
        const id = plusBtn.getAttribute('data-id');
        if (id) updateQuantity(id, 1);
        return;
      }

      // 3. Stepper Minus button clicked
      const minusBtn = e.target.closest('.card-stepper-minus');
      if (minusBtn) {
        e.stopPropagation();
        const id = minusBtn.getAttribute('data-id');
        if (id) updateQuantity(id, -1);
        return;
      }

      // 4. Check if food card was clicked (for detail modal)
      const card = e.target.closest('.recipe-card');
      if (card) {
        if (e.target.closest('.btn-glass-add') || e.target.closest('.btn-add-cart') || e.target.closest('.dish-action-slot') || e.target.closest('.dish-card-stepper')) return;
        try {
          const btn = card.querySelector('.btn-add-cart') || card.querySelector('[data-id]');
          const id = btn?.getAttribute('data-id') || card.id?.replace(/^card-/, '');
          const name = btn?.getAttribute('data-name') || card.querySelector('.recipe-title')?.textContent || 'Special Dish';
          const price = parseFloat(btn?.getAttribute('data-price') || card.querySelector('.meta-price')?.textContent?.replace(/[^\d.]/g, '') || '70');
          const image = btn?.getAttribute('data-image') || card.querySelector('.recipe-img')?.getAttribute('src') || '';

          const liveDish = (typeof dataService.getDishById === 'function' ? dataService.getDishById(id) : null) || dataService.getDishes().find(d => d.id === id);
          const dish = getEnrichedDishDetail(liveDish || { id, name, price, image });

          if (dish) openFoodDetail(dish);
        } catch (err) {
          console.warn('Could not open dish modal:', err);
        }
      }
    });
  }

  // Live sync of dish images, prices & stock status with dataService
  function syncStorefrontCardsWithDataService() {
    const dishes = dataService.getDishes();
    const recipeGrid = document.getElementById('recipe-grid');

    dishes.forEach(dish => {
      let card = document.getElementById(`card-${dish.id}`);

      // If card doesn't exist in DOM (new dish added from Admin), dynamically append it
      if (!card && recipeGrid) {
        card = document.createElement('article');
        card.className = 'recipe-card food-card';
        card.setAttribute('data-category', dish.category || 'chicken');
        card.setAttribute('data-id', dish.id);
        card.id = `card-${dish.id}`;
        card.innerHTML = `
          <div class="recipe-card-inner is-img-loading">
            <span class="recipe-card-badge-pill">${escapeHtml(dish.badge || '✨ Chef Specialty')}</span>
            <img src="${dish.image || '/api/r2-image?key=dishes/crispy-chicken.jpg'}" alt="${escapeHtml(dish.name)}" class="recipe-img food-card-img" loading="lazy" decoding="async"/>
            <div class="recipe-overlay"></div>
            <button 
              class="btn-glass-add btn-add-cart" 
              data-id="${dish.id}"
              data-name="${escapeHtml(dish.name)}" 
              data-price="${dish.price}"
              data-image="${dish.image || '/api/r2-image?key=dishes/crispy-chicken.jpg'}"
              title="Add to basket"
              aria-label="Add ${escapeHtml(dish.name)} to cart"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
            <div class="recipe-bottom-info">
              <h3 class="recipe-title">${escapeHtml(dish.name)}</h3>
              <div class="recipe-meta-sub">
                <span class="meta-price">₹${Math.round(dish.price)}</span>
              </div>
            </div>
          </div>
        `;
        recipeGrid.appendChild(card);
        const newImg = card.querySelector('.recipe-img');
        if (newImg) setupImageSkeleton(newImg);
      }

      if (!card) return;

      // 1. Live Sync Dish Image (Updates storefront whenever admin changes photo)
      const imgEl = card.querySelector('.recipe-img') || card.querySelector('img');
      if (imgEl && dish.image) {
        const curSrc = imgEl.getAttribute('src');
        if (curSrc !== dish.image) {
          imgEl.classList.remove('img-is-ready');
          const innerContainer = imgEl.closest('.recipe-card-inner');
          if (innerContainer) {
            innerContainer.classList.remove('is-img-loaded');
            innerContainer.classList.add('is-img-loading');
          }
          imgEl.src = dish.image;
          setupImageSkeleton(imgEl);
        } else if (imgEl.complete && imgEl.naturalWidth > 0) {
          imgEl.classList.add('img-is-ready');
          const innerContainer = imgEl.closest('.recipe-card-inner');
          if (innerContainer) {
            innerContainer.classList.add('is-img-loaded');
            innerContainer.classList.remove('is-img-loading');
          }
        }
        imgEl.alt = dish.name || 'Crispy Chicken Food';
      }

      // 2. Live Sync Title
      const titleEl = card.querySelector('.recipe-title');
      if (titleEl && dish.name) titleEl.textContent = dish.name;

      // 3. Live Sync Badge
      const badgeEl = card.querySelector('.recipe-card-badge-pill');
      if (badgeEl) {
        if (dish.badge && dish.badge.trim()) {
          badgeEl.textContent = dish.badge;
          badgeEl.style.display = '';
        } else {
          badgeEl.textContent = '';
          badgeEl.style.display = 'none';
        }
      }

      // 4. Live Sync Price
      const priceEl = card.querySelector('.meta-price');
      if (priceEl) priceEl.textContent = `₹${Math.round(dish.price)}`;

      // 5. Live Sync Add to Cart Button Data Attributes
      const addBtn = card.querySelector('.btn-add-cart');
      if (addBtn) {
        addBtn.setAttribute('data-price', dish.price);
        addBtn.setAttribute('data-name', dish.name);
        addBtn.setAttribute('data-image', dish.image);
        if (dish.inStock === false) {
          addBtn.setAttribute('disabled', 'true');
          addBtn.title = 'Item Sold Out';
        } else {
          addBtn.removeAttribute('disabled');
          addBtn.title = 'Add to basket';
        }
      }

      // 6. Live Sync Stock Status
      if (dish.inStock === false) {
        card.classList.add('is-out-of-stock');
        let stockPill = card.querySelector('.recipe-card-stock-pill');
        if (!stockPill) {
          stockPill = document.createElement('span');
          stockPill.className = 'recipe-card-stock-pill';
          stockPill.textContent = 'Sold Out';
          card.querySelector('.recipe-card-inner')?.prepend(stockPill);
        }
      } else {
        card.classList.remove('is-out-of-stock');
        const stockPill = card.querySelector('.recipe-card-stock-pill');
        if (stockPill) stockPill.remove();
      }
    });

    // Remove any card whose dish was deleted in admin
    const currentDishIds = new Set(dishes.map(d => `card-${d.id}`));
    document.querySelectorAll('.recipe-card').forEach(card => {
      if (card.id && card.id.startsWith('card-') && !currentDishIds.has(card.id)) {
        card.remove();
      }
    });

    // 7. Live Sync Hero Floating Bubbles with Catalog Dishes
    const heroDishMappings = [
      { blobId: 'blob-chicken', dishId: 'dish-chicken-biryani-full' },
      { blobId: 'blob-pizza', dishId: 'dish-grilled-chicken-full' },
      { blobId: 'blob-burger', dishId: 'dish-tandoori-chicken-half' }
    ];

    heroDishMappings.forEach(({ blobId, dishId }) => {
      const blob = document.getElementById(blobId);
      const dish = dishes.find(d => d.id === dishId);
      if (blob && dish) {
        blob.setAttribute('data-dish', dish.name);
        blob.setAttribute('data-price', dish.price);
        blob.setAttribute('data-id', dish.id);
        const img = blob.querySelector('.food-img') || blob.querySelector('img');
        if (img && dish.image && img.getAttribute('src') !== dish.image) {
          img.src = dish.image;
        }
        const tagText = blob.querySelector('.tag-text');
        if (tagText) {
          tagText.textContent = `${dish.name} • ₹${Math.round(dish.price)}`;
        }
      }
    });
  }
  try {
    syncStorefrontCardsWithDataService();
    if (typeof dataService.on === 'function') {
      dataService.on('change:dishes', syncStorefrontCardsWithDataService);
      dataService.on('dishes', syncStorefrontCardsWithDataService);
    }
  } catch (err) {
    console.warn('syncStorefrontCardsWithDataService error:', err);
  }

  // Quick add from Hero Blobs (Both '+' buttons AND tapping the food bubble directly)
  document.querySelectorAll('.food-blob-item').forEach(blob => {
    blob.addEventListener('click', (e) => {
      const dish = blob.getAttribute('data-dish');
      const price = parseFloat(blob.getAttribute('data-price'));
      const img = blob.querySelector('img')?.src || '';

      const dishId = blob.getAttribute('data-id') || ('hero-' + dish.toLowerCase().replace(/\s+/g, '-'));
      const item = {
        id: dishId,
        name: dish,
        price: price,
        image: img
      };

      const triggerEl = e.target.closest('.quick-add-blob-btn, .bubble-direct-add-btn') || blob;
      addToCart(item, triggerEl);
    });
  });

  // Drawer Open/Close
  function openCartDrawerInternal() {
    if (cartDrawer) cartDrawer.classList.add('open');
    if (cartDrawerBackdrop) cartDrawerBackdrop.classList.add('open');
    document.body.classList.add('cart-drawer-open');
    document.body.style.overflow = 'hidden';
    renderCartAddresses();
  }

  function openCartDrawer() {
    openCartDrawerInternal();
    backNav.pushStep('cart-drawer', () => closeCartDrawerInternal(), () => openCartDrawerInternal());
  }

  function closeCartDrawerInternal() {
    if (cartDrawer) cartDrawer.classList.remove('open');
    if (cartDrawerBackdrop) cartDrawerBackdrop.classList.remove('open');
    document.body.classList.remove('cart-drawer-open');
    document.body.style.overflow = '';
  }

  function closeCartDrawer() {
    if (backNav.isTopStep('cart-drawer')) {
      backNav.stepBack();
    } else {
      closeCartDrawerInternal();
      backNav.removeStepDirect('cart-drawer');
    }
  }

  if (cartTriggerBtn) cartTriggerBtn.addEventListener('click', openCartDrawer);
  if (cartCloseBtn) cartCloseBtn.addEventListener('click', closeCartDrawer);
  if (cartDrawerBackdrop) cartDrawerBackdrop.addEventListener('click', closeCartDrawer);

  // Floating Glass Bottom Navigation Listeners (Tailored for Web Food Ordering)
  const navBtnHome = document.getElementById('nav-btn-home');
  const navBtnMenu = document.getElementById('nav-btn-menu');
  const navBtnOffers = document.getElementById('nav-btn-offers');
  const navBtnTrack = document.getElementById('nav-btn-track');
  const navBtnProfile = document.getElementById('nav-btn-profile');
  const capsuleProfileLabel = document.getElementById('capsule-profile-label');
  const navCircleAction = document.getElementById('nav-circle-action');
  const capsuleBtns = document.querySelectorAll('.capsule-nav-btn');

  function setActiveCapsuleBtn(btn) {
    capsuleBtns.forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
  }

  let cachedMenuSectionOffset = null;
  window.addEventListener('resize', () => { cachedMenuSectionOffset = null; }, { passive: true });

  function syncCapsuleNavWithScroll() {
    // If a modal is open, keep its button active
    if (offersModalBackdrop && offersModalBackdrop.classList.contains('open')) {
      setActiveCapsuleBtn(navBtnOffers);
      return;
    }
    if (orderModalBackdrop && orderModalBackdrop.classList.contains('open')) {
      setActiveCapsuleBtn(navBtnTrack);
      return;
    }
    if (modalMyOrdersBackdrop && modalMyOrdersBackdrop.classList.contains('open')) {
      setActiveCapsuleBtn(navBtnTrack);
      return;
    }
    if (authModalBackdrop && authModalBackdrop.classList.contains('open')) {
      if (navBtnProfile) setActiveCapsuleBtn(navBtnProfile);
      return;
    }
    if (cachedMenuSectionOffset === null) {
      const menuSec = document.getElementById('menu-section');
      cachedMenuSectionOffset = menuSec ? menuSec.offsetTop : 0;
    }
    const scrollPos = window.scrollY + 200;
    if (cachedMenuSectionOffset && scrollPos >= cachedMenuSectionOffset - 100) {
      setActiveCapsuleBtn(navBtnMenu);
    } else {
      setActiveCapsuleBtn(navBtnHome);
    }
  }

  // ==========================================
  // SPECIAL OFFERS POPUP MODAL
  // ==========================================
  function openOffersModal() {
    if (offersModalBackdrop) {
      offersModalBackdrop.classList.add('open');
      document.body.style.overflow = 'hidden';
      setActiveCapsuleBtn(navBtnOffers);
      backNav.pushStep('offers-modal', () => closeOffersModalInternal());
    }
  }

  function closeOffersModalInternal() {
    if (offersModalBackdrop) {
      offersModalBackdrop.classList.remove('open');
      document.body.style.overflow = '';
      syncCapsuleNavWithScroll();
    }
  }

  function closeOffersModal() {
    if (backNav.isTopStep('offers-modal')) {
      backNav.stepBack();
    } else {
      closeOffersModalInternal();
      backNav.removeStepDirect('offers-modal');
    }
  }

  if (navBtnHome) {
    navBtnHome.addEventListener('click', () => {
      if (offersModalBackdrop && offersModalBackdrop.classList.contains('open')) closeOffersModal();
      if (orderModalBackdrop && orderModalBackdrop.classList.contains('open')) closeOrderModal();
      setActiveCapsuleBtn(navBtnHome);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  if (navBtnMenu) {
    navBtnMenu.addEventListener('click', () => {
      if (offersModalBackdrop && offersModalBackdrop.classList.contains('open')) closeOffersModal();
      if (orderModalBackdrop && orderModalBackdrop.classList.contains('open')) closeOrderModal();
      setActiveCapsuleBtn(navBtnMenu);
      const menuSec = document.getElementById('menu-section');
      if (menuSec) menuSec.scrollIntoView({ behavior: 'smooth' });
    });
  }

  // Offers Button on Navigation Bar: Pop open modal directly (NO scrolling!)
  if (navBtnOffers) {
    navBtnOffers.addEventListener('click', (e) => {
      e.preventDefault();
      if (orderModalBackdrop && orderModalBackdrop.classList.contains('open')) closeOrderModal();
      openOffersModal();
    });
  }

  if (mobileNavOffers) {
    mobileNavOffers.addEventListener('click', (e) => {
      e.preventDefault();
      closeMobileMenu();
      openOffersModal();
    });
  }

  if (offersModalClose) {
    offersModalClose.addEventListener('click', closeOffersModal);
  }

  if (offersModalBackdrop) {
    offersModalBackdrop.addEventListener('click', (e) => {
      if (e.target === offersModalBackdrop) closeOffersModal();
    });
  }

  function getActivePromoCode() {
    const settings = dataService.getSettings();
    return (settings.offerCode || 'CRISPY20').trim().toUpperCase();
  }

  function copyActivePromoCode() {
    const code = getActivePromoCode();
    navigator.clipboard.writeText(code).then(() => {
      showToast(`📋 Coupon ${code} copied to clipboard!`, 'success');
    }).catch(() => {
      showToast(`Use code ${code} at checkout!`, 'info');
    });
  }

  function claimActivePromoCode() {
    const code = getActivePromoCode();
    if (offersModalBackdrop && offersModalBackdrop.classList.contains('open')) closeOffersModal();
    openCartDrawer();
    if (cartPromoInput) {
      cartPromoInput.value = code;
      applyPromoCode(code);
    }
  }

  if (offersModalCodeBtn) {
    offersModalCodeBtn.addEventListener('click', copyActivePromoCode);
  }

  if (offersModalClaimBtn) {
    offersModalClaimBtn.addEventListener('click', claimActivePromoCode);
  }

  if (navBtnTrack) {
    navBtnTrack.addEventListener('click', () => {
      if (offersModalBackdrop && offersModalBackdrop.classList.contains('open')) closeOffersModal();
      openOrderModal(null, false);
    });
  }

  if (navBtnProfile) {
    navBtnProfile.addEventListener('click', () => {
      if (offersModalBackdrop && offersModalBackdrop.classList.contains('open')) closeOffersModal();
      if (orderModalBackdrop && orderModalBackdrop.classList.contains('open')) closeOrderModal();
      setActiveCapsuleBtn(navBtnProfile);
      openAuthModal();
    });
  }

  const navHeaderTrack = document.getElementById('nav-header-track');
  if (navHeaderTrack) {
    navHeaderTrack.addEventListener('click', (e) => {
      e.preventDefault();
      openOrderModal(null, false);
    });
  }

  const mobileNavTrack = document.getElementById('mobile-nav-track');
  if (mobileNavTrack) {
    mobileNavTrack.addEventListener('click', (e) => {
      e.preventDefault();
      closeMobileMenu();
      openOrderModal(null, false);
    });
  }

  if (navCircleAction) {
    navCircleAction.addEventListener('click', () => {
      openCartDrawer();
    });
  }


  // Escape key handler for all modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (cartDrawer && cartDrawer.classList.contains('open')) {
        closeCartDrawer();
      }
      if (offersModalBackdrop && offersModalBackdrop.classList.contains('open')) {
        closeOffersModal();
      }
      if (orderModalBackdrop && orderModalBackdrop.classList.contains('open')) {
        closeOrderModal();
      }
      if (foodDetailBackdrop && foodDetailBackdrop.classList.contains('open')) {
        closeFoodDetail();
      }
    }
  });

  if (btnStartOrder) {
    btnStartOrder.addEventListener('click', () => {
      closeCartDrawer();
      document.getElementById('menu-section').scrollIntoView({ behavior: 'smooth' });
    });
  }

  // ==========================================
  // PROMO CODE SYSTEM & CONFETTI
  // ==========================================
  function applyPromoCode(code) {
    const settings = dataService.getSettings();
    const cleanCode = code.trim().toUpperCase();
    const activeCode = (settings.offerCode || 'CRISPY20').trim().toUpperCase();

    if (settings.offerActive === false) {
      promoStatusMsg.style.color = '#DC2626';
      promoStatusMsg.textContent = 'Special promotional offers are currently paused.';
      showToast('⚠️ No active promotional offer available at this moment.', 'warning');
      return;
    }

    if (cleanCode === activeCode) {
      appliedPromo = activeCode;
      const minOrder = Number(settings.offerMinOrder || 0);
      const subtotal = cart.reduce((acc, it) => acc + (it.price * it.quantity), 0);
      const discountType = settings.offerDiscountType || 'percent';
      const discountPct = Number(settings.offerDiscountPercent || 20);
      const discountAmt = Number(settings.offerDiscountAmount || 50);
      const discTag = discountType === 'flat' ? `₹${Math.round(discountAmt)} OFF` : `${discountPct}% OFF`;
      const freeDeliv = settings.offerFreeDelivery !== false;

      if (minOrder > 0 && subtotal < minOrder) {
        const needed = Math.round(minOrder - subtotal);
        promoStatusMsg.style.color = '#DC2626';
        promoStatusMsg.innerHTML = `⚠️ Coupon <strong>${escapeHtml(activeCode)}</strong> requires a minimum order of ₹${Math.round(minOrder)}. Add <strong>₹${needed}</strong> more to your cart!`;
        showToast(`⚠️ Add ₹${needed} more to unlock ${discTag}!`, 'warning');
        renderCart();
        return;
      }

      promoStatusMsg.style.color = '#059669';
      promoStatusMsg.innerHTML = `✓ Coupon <strong>${escapeHtml(activeCode)}</strong> applied: ${discTag}${freeDeliv ? ' + Free Delivery!' : ''}`;
      renderCart();

      // Confetti burst!
      confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.8 },
        colors: ['#FF5A26', '#F59E0B', '#10B981']
      });

      showToast(`🎉 ${discTag} applied to your order!`, 'success');
    } else {
      promoStatusMsg.style.color = '#DC2626';
      promoStatusMsg.textContent = `Invalid promo code. Try ${activeCode}`;
      showToast(`Invalid promo code. Try "${activeCode}"`, 'error');
    }
  }

  if (btnApplyPromo && cartPromoInput) {
    btnApplyPromo.addEventListener('click', () => {
      applyPromoCode(cartPromoInput.value);
    });

    cartPromoInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        applyPromoCode(cartPromoInput.value);
      }
    });
  }

  // Copy promo code from banner
  if (promoCodeBtn) {
    promoCodeBtn.addEventListener('click', copyActivePromoCode);
  }

  // ==========================================
  // MULTI-ORDER MANAGEMENT & LIVE TRACKER
  // ==========================================
  const ORDERS_STORAGE_KEY = 'quickbite_orders';

  function getStoredOrders() {
    return dataService.getOrders();
  }

  let orders = getStoredOrders();
  let activeOrderId = orders && orders[0] ? orders[0].id : null;

  function saveOrders() {
    dataService.saveOrders(orders);
  }

  // ========================================================
  // SWIPE TO CALL GESTURE ENGINE (Touch & Mouse Drag Physics)
  // ========================================================
  function initSwipeToCall(trackEl) {
    if (!trackEl) return;
    const thumb = trackEl.querySelector('.swipe-to-call-thumb');
    const fill = trackEl.querySelector('.swipe-to-call-fill');
    const textEl = trackEl.querySelector('.swipe-to-call-text');
    const phone = trackEl.getAttribute('data-phone') || '';
    const label = trackEl.getAttribute('data-label') || 'Kitchen';
    if (!thumb || !fill) return;

    let isDragging = false;
    let startX = 0;
    let currentX = 0;
    let isCompleted = false;

    function getMaxSlide() {
      return Math.max(0, trackEl.offsetWidth - thumb.offsetWidth - 8);
    }

    function onPointerDown(e) {
      if (isCompleted) return;
      isDragging = true;
      startX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
      trackEl.classList.add('is-dragging');
      thumb.style.transition = 'none';
      fill.style.transition = 'none';
      if (textEl) textEl.style.transition = 'none';
    }

    function onPointerMove(e) {
      if (!isDragging || isCompleted) return;
      const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
      const deltaX = clientX - startX;
      const maxSlide = getMaxSlide();
      currentX = Math.max(0, Math.min(deltaX, maxSlide));

      thumb.style.transform = `translateX(${currentX}px)`;
      fill.style.width = `${currentX + (thumb.offsetWidth / 2)}px`;

      if (textEl) {
        const fadeRatio = currentX / (maxSlide * 0.65 || 1);
        textEl.style.opacity = String(Math.max(0, 1 - fadeRatio));
      }

      if (e.cancelable && e.type.includes('touch')) {
        e.preventDefault();
      }
    }

    function triggerCallSuccess() {
      if (isCompleted) return;
      isCompleted = true;
      isDragging = false;
      const maxSlide = getMaxSlide();

      thumb.style.transition = 'transform 0.24s cubic-bezier(0.16, 1, 0.3, 1)';
      fill.style.transition = 'width 0.24s cubic-bezier(0.16, 1, 0.3, 1)';
      if (textEl) textEl.style.transition = 'opacity 0.2s ease';

      thumb.style.transform = `translateX(${maxSlide}px)`;
      fill.style.width = '100%';
      trackEl.classList.add('is-completed');

      if (textEl) {
        textEl.innerHTML = `<i class="fa-solid fa-phone fa-shake"></i> Calling ${escapeHtml(label)}...`;
        textEl.style.opacity = '1';
      }

      const icon = thumb.querySelector('i');
      if (icon) {
        icon.className = 'fa-solid fa-phone fa-shake';
      }

      try {
        if ('vibrate' in navigator) navigator.vibrate([40, 60, 80]);
      } catch {}

      showToast(`📞 Connecting call to ${label}...`, 'success');

      // Initiate actual phone call
      setTimeout(() => {
        if (phone) {
          window.location.href = `tel:${phone}`;
        }
      }, 220);

      // Smoothly reset slider after 2.6s so user can re-call if needed
      setTimeout(() => {
        resetSlider();
      }, 2600);
    }

    function resetSlider() {
      isCompleted = false;
      isDragging = false;
      currentX = 0;
      trackEl.classList.remove('is-completed', 'is-dragging');

      thumb.style.transition = 'transform 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
      fill.style.transition = 'width 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
      if (textEl) textEl.style.transition = 'opacity 0.25s ease';

      thumb.style.transform = 'translateX(0px)';
      fill.style.width = '0px';

      if (textEl) {
        const isRider = trackEl.classList.contains('rider');
        const customText = trackEl.getAttribute('data-swipe-text');
        const textLabel = customText || (isRider ? 'Swipe to Call Delivery Boy' : 'Swipe to Call');
        textEl.innerHTML = `
          <span class="swipe-text-shimmer">${textLabel}</span>
          <span class="swipe-chevrons">
            <i class="fa-solid fa-chevron-right"></i>
            <i class="fa-solid fa-chevron-right"></i>
            <i class="fa-solid fa-chevron-right"></i>
          </span>
        `;
        textEl.style.opacity = '1';
      }

      const icon = thumb.querySelector('i');
      if (icon) {
        icon.className = 'fa-solid fa-phone';
      }
    }

    function onPointerUp() {
      if (!isDragging || isCompleted) return;
      isDragging = false;
      trackEl.classList.remove('is-dragging');

      const maxSlide = getMaxSlide();
      const threshold = maxSlide * 0.68; // 68% threshold

      if (currentX >= threshold) {
        triggerCallSuccess();
      } else {
        // Snap back
        thumb.style.transition = 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
        fill.style.transition = 'width 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
        if (textEl) textEl.style.transition = 'opacity 0.2s ease';

        thumb.style.transform = 'translateX(0px)';
        fill.style.width = '0px';
        if (textEl) textEl.style.opacity = '1';
        currentX = 0;
      }
    }

    // Touch listeners
    thumb.addEventListener('touchstart', onPointerDown, { passive: true });
    window.addEventListener('touchmove', onPointerMove, { passive: false });
    window.addEventListener('touchend', onPointerUp, { passive: true });
    window.addEventListener('touchcancel', onPointerUp, { passive: true });

    // Mouse listeners
    thumb.addEventListener('mousedown', onPointerDown);
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);

    // Click/tap on thumb fallback
    thumb.addEventListener('click', (e) => {
      if (isCompleted) return;
      if (currentX < 10) {
        triggerCallSuccess();
      }
    });

    // Keyboard support (Space / Enter)
    thumb.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.code === 'Space') && !isCompleted) {
        e.preventDefault();
        triggerCallSuccess();
      }
    });
  }

  // ==============================================================
  // CACHE STORAGE & INSTANT BACKGROUND VIDEO PRELOADER
  // Pre-downloads video in background, primes browser media cache,
  // and enables instantaneous, zero-wait opening and playback.
  // ==============================================================
  const TRACKER_VIDEO_URL = '/api/r2-video';
  let isVideoPreloading = false;

  async function preloadTrackerVideo() {
    if (isVideoPreloading) return;
    isVideoPreloading = true;

    try {
      // Prime HTTP Range cache & R2 stream socket in background
      await fetch(TRACKER_VIDEO_URL, {
        headers: { Range: 'bytes=0-1048575' },
        priority: 'low'
      });
      const videoEl = document.getElementById('tracker-bg-video-el');
      if (videoEl && videoEl.readyState < 2) {
        videoEl.load();
      }
    } catch (err) {
      // Non-blocking fallback to on-demand video element streaming
    } finally {
      isVideoPreloading = false;
    }
  }

  const PRE_DISPATCH_ORDER_STATUSES = ['pending', 'accepted', 'cooking', 'ready_for_pickup'];

  function isPreDispatchOrderStatus(status) {
    return PRE_DISPATCH_ORDER_STATUSES.includes(status);
  }

  function syncTrackerVideoBackground(order) {
    const modalCard = document.querySelector('.order-modal-card');
    const videoWrap = document.getElementById('order-tracker-video-bg');
    const videoEl = document.getElementById('tracker-bg-video-el');

    const shouldShowVideo = Boolean(order && isPreDispatchOrderStatus(order.status));

    if (shouldShowVideo) {
      if (modalCard) modalCard.classList.add('has-video-bg');
      if (videoWrap) videoWrap.style.display = 'block';
      if (videoEl) {
        videoEl.muted = true;
        // Instant non-blocking playback - modal opens on frame 0 without waiting
        const playPromise = videoEl.play();
        if (playPromise !== undefined) {
          playPromise.catch(() => {});
        }
      }
    } else {
      if (modalCard) modalCard.classList.remove('has-video-bg');
      if (videoWrap) videoWrap.style.display = 'none';
      if (videoEl && !videoEl.paused) {
        videoEl.pause();
      }
    }
  }

  function pauseTrackerVideo() {
    const videoEl = document.getElementById('tracker-bg-video-el');
    if (videoEl && !videoEl.paused) {
      videoEl.pause();
    }
  }

  // ==========================================
  // LIVE RIDER TRACKING MAP CONTROLLER
  // ==========================================
  let trackerLiveMap = null;
  let trackerRiderMarker = null;
  let trackerHomeMarker = null;
  let trackerRemainingLine = null;
  let activeTrackingOrderId = null;
  let trackerSimulationInterval = null;
  let lastRiderCoords = null;
  let riderAnimFrame = null;
  const trackerRouteCache = new Map();

  function calculateDistanceKm(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 1.5;
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c * 10) / 10;
  }

  function generateRoadAlignedPath(startLat, startLng, endLat, endLng) {
    const dLat = endLat - startLat;
    const dLng = endLng - startLng;
    const midLat = startLat + dLat * 0.45;
    const midLng = startLng + dLng * 0.55;
    return [
      [startLat, startLng],
      [midLat, startLng],
      [midLat, midLng],
      [endLat, midLng],
      [endLat, endLng]
    ];
  }

  async function fetchRoadRoute(startLat, startLng, endLat, endLng) {
    if (!startLat || !startLng || !endLat || !endLng) return null;
    const key = `${startLat.toFixed(4)},${startLng.toFixed(4)}->${endLat.toFixed(4)},${endLng.toFixed(4)}`;
    if (trackerRouteCache.has(key)) {
      return trackerRouteCache.get(key);
    }

    // Try primary OSRM, then secondary OSM mirror
    const endpoints = [
      `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson`,
      `https://routing.openstreetmap.de/routed-car/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson`
    ];

    for (const url of endpoints) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
        if (res.ok) {
          const data = await res.json();
          if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
            const route = data.routes[0];
            const coords = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
            const result = {
              coords,
              distanceMeters: route.distance,
              durationSeconds: route.duration
            };
            trackerRouteCache.set(key, result);
            return result;
          }
        }
      } catch (err) {}
    }

    // Road-aligned grid fallback: Never draw a diagonal jump through houses
    const fallbackCoords = generateRoadAlignedPath(startLat, startLng, endLat, endLng);
    return {
      coords: fallbackCoords,
      distanceMeters: calculateDistanceKm(startLat, startLng, endLat, endLng) * 1000,
      durationSeconds: Math.ceil(calculateDistanceKm(startLat, startLng, endLat, endLng) * 180)
    };
  }

  function animateRiderMarker(fromLat, fromLng, toLat, toLng, durationMs = 800) {
    if (!trackerRiderMarker) return;
    if (riderAnimFrame) cancelAnimationFrame(riderAnimFrame);

    const startTime = performance.now();

    function step(now) {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      const ease = 1 - (1 - progress) * (1 - progress);
      const curLat = fromLat + (toLat - fromLat) * ease;
      const curLng = fromLng + (toLng - fromLng) * ease;

      if (trackerRiderMarker) {
        trackerRiderMarker.setLatLng([curLat, curLng]);
      }

      if (progress < 1) {
        riderAnimFrame = requestAnimationFrame(step);
      } else {
        riderAnimFrame = null;
      }
    }

    riderAnimFrame = requestAnimationFrame(step);
  }

  function resolveOrderCustomerCoords(order) {
    if (order.addressDetails && !isNaN(Number(order.addressDetails.lat)) && !isNaN(Number(order.addressDetails.lng))) {
      return { lat: Number(order.addressDetails.lat), lng: Number(order.addressDetails.lng) };
    }
    if (order.lat && order.lng && !isNaN(Number(order.lat)) && !isNaN(Number(order.lng))) {
      return { lat: Number(order.lat), lng: Number(order.lng) };
    }
    try {
      const addrs = dataService.getSavedAddresses();
      if (Array.isArray(addrs) && addrs.length > 0) {
        const found = addrs.find(a => order.deliveryAddress && a.address && order.deliveryAddress.includes(a.address)) || addrs[0];
        if (found && !isNaN(Number(found.lat)) && !isNaN(Number(found.lng))) {
          return { lat: Number(found.lat), lng: Number(found.lng) };
        }
      }
    } catch {}
    return { lat: 12.7275, lng: 77.2740 };
  }

  function destroyTrackerLiveMap() {
    if (trackerSimulationInterval) {
      clearInterval(trackerSimulationInterval);
      trackerSimulationInterval = null;
    }
    if (riderAnimFrame) {
      cancelAnimationFrame(riderAnimFrame);
      riderAnimFrame = null;
    }
    const mapCard = document.getElementById('tracker-live-map-card');
    if (mapCard) {
      mapCard.style.display = 'none';
      mapCard.classList.remove('is-expanded');
    }

    if (trackerLiveMap) {
      try {
        trackerLiveMap.remove();
      } catch {}
      trackerLiveMap = null;
    }
    trackerRiderMarker = null;
    trackerHomeMarker = null;
    trackerRemainingLine = null;
    activeTrackingOrderId = null;
    lastRiderCoords = null;
  }

  function updateTrackerDistanceAndEta(distKm, estMins, isLiveGps = true) {
    const distBadge = document.getElementById('tracker-map-distance-badge');
    if (distBadge) {
      distBadge.innerHTML = `<i class="fa-solid fa-route"></i> ${distKm} km away (~${estMins} mins)`;
    }

    const etaTimeEl = document.getElementById('tracker-eta-time');
    if (etaTimeEl) {
      etaTimeEl.textContent = `${estMins} - ${estMins + 4} Minutes`;
    }

    const statusText = document.getElementById('tracker-map-status-text');
    if (statusText) {
      statusText.textContent = isLiveGps ? `Rider on the way • Live GPS` : `Rider on the way • In Transit`;
    }
  }

  async function updateTrackerRouteLine(riderLat, riderLng, dropLat, dropLng, isLiveGps = true) {
    const routeData = await fetchRoadRoute(riderLat, riderLng, dropLat, dropLng);
    if (!routeData || !routeData.coords || routeData.coords.length === 0) return;

    if (trackerRemainingLine && trackerLiveMap) {
      trackerRemainingLine.setLatLngs(routeData.coords);
    }

    const distKm = Math.round((routeData.distanceMeters / 1000) * 10) / 10;
    const estMins = Math.max(2, Math.ceil(routeData.durationSeconds / 60));
    updateTrackerDistanceAndEta(distKm, estMins, isLiveGps);
  }

  function updateTrackerRiderPosition(payload) {
    if (!trackerLiveMap || !trackerRiderMarker || !payload?.lat || !payload?.lng) return;
    const newLat = Number(payload.lat);
    const newLng = Number(payload.lng);

    const dropCoords = trackerHomeMarker ? trackerHomeMarker.getLatLng() : { lat: 12.7275, lng: 77.2740 };

    // Smoothly glide marker from previous coordinates to new coordinates (no jumping across blocks)
    if (lastRiderCoords && (lastRiderCoords.lat !== newLat || lastRiderCoords.lng !== newLng)) {
      animateRiderMarker(lastRiderCoords.lat, lastRiderCoords.lng, newLat, newLng, 800);
    } else {
      trackerRiderMarker.setLatLng([newLat, newLng]);
    }
    lastRiderCoords = { lat: newLat, lng: newLng };

    // Update real road route line along the street network if not already custom-sliced
    if (!payload.hasCustomRoute) {
      updateTrackerRouteLine(newLat, newLng, dropCoords.lat, dropCoords.lng, payload.isLiveGps !== false);
    }
  }

  function handleIncomingRiderGps(payload) {
    if (!payload || !payload.lat || !payload.lng) return;
    if (!activeTrackingOrderId) return;

    const isMatch = !payload.orderId || payload.orderId === activeTrackingOrderId ||
      (Array.isArray(payload.orderIds) && payload.orderIds.includes(activeTrackingOrderId));

    if (isMatch) {
      if (trackerSimulationInterval) {
        clearInterval(trackerSimulationInterval);
        trackerSimulationInterval = null;
      }
      updateTrackerRiderPosition({
        lat: Number(payload.lat),
        lng: Number(payload.lng),
        riderName: payload.riderName || 'Delivery Partner',
        isLiveGps: true
      });
    }
  }

  // Cross-context live GPS connection to Rider Delivery App
  window.addEventListener('quickbite:rider_location', (e) => {
    handleIncomingRiderGps(e.detail);
  });

  window.addEventListener('storage', (e) => {
    if (e.key === 'quickbite_live_rider_location' || (e.key && e.key.startsWith('quickbite_rider_location_'))) {
      try {
        const parsed = JSON.parse(e.newValue);
        handleIncomingRiderGps(parsed);
      } catch {}
    }
  });

  dataService.subscribeToChanges((event, payload) => {
    if (event === 'rider_location') {
      handleIncomingRiderGps(payload);
    }
  });

  function initTrackerLiveMap(order) {
    const mapCard = document.getElementById('tracker-live-map-card');
    const mapView = document.getElementById('tracker-live-map-view');
    if (!mapCard || !mapView) return;

    if (order.status !== 'on_the_way') {
      destroyTrackerLiveMap();
      return;
    }

    mapCard.style.display = 'block';
    mapCard.classList.add('is-expanded');
    activeTrackingOrderId = order.id;

    const restLat = RESTAURANT_COORDINATES.lat;
    const restLng = RESTAURANT_COORDINATES.lng;
    const dropCoords = resolveOrderCustomerCoords(order);

    const liveRider = dataService.getRiderLiveLocation(order.id, order.assignedRiderPin);
    let riderLat = liveRider?.lat ?? (restLat + (dropCoords.lat - restLat) * 0.55);
    let riderLng = liveRider?.lng ?? (restLng + (dropCoords.lng - restLng) * 0.55);
    lastRiderCoords = { lat: riderLat, lng: riderLng };

    if (trackerLiveMap) {
      updateTrackerRiderPosition({
        lat: riderLat,
        lng: riderLng,
        riderName: order.assignedRiderName || 'Delivery Partner',
        isLiveGps: Boolean(liveRider)
      });
      setTimeout(() => {
        if (trackerLiveMap && trackerRiderMarker && trackerHomeMarker) {
          trackerLiveMap.invalidateSize();
          const b = L.latLngBounds([[riderLat, riderLng], [dropCoords.lat, dropCoords.lng]]);
          trackerLiveMap.fitBounds(b, { padding: [45, 45], maxZoom: 17 });
        }
      }, 200);
      return;
    }

    try {
      trackerLiveMap = L.map('tracker-live-map-view', {
        zoomControl: false,
        attributionControl: false,
        dragging: true,
        touchZoom: true,
        scrollWheelZoom: true,
        doubleClickZoom: true,
        boxZoom: true,
        tap: true
      }).setView([riderLat, riderLng], 15);

      const streetLayer = L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&hl=en&gl=IN', {
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        maxZoom: 20,
        attribution: '&copy; Google Maps'
      });
      streetLayer.on('tileerror', () => {
        if (!streetLayer._hasFailedOver) {
          streetLayer._hasFailedOver = true;
          const fallback = L.tileLayer('https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', {
            subdomains: ['a', 'b', 'c'],
            maxZoom: 20
          });
          if (trackerLiveMap && trackerLiveMap.hasLayer(streetLayer)) {
            trackerLiveMap.removeLayer(streetLayer);
            fallback.addTo(trackerLiveMap);
          }
        }
      });
      streetLayer.addTo(trackerLiveMap);

      // 1. Delivery Location Marker (Doorstep destination)
      const homeIcon = L.divIcon({
        className: 'tracker-custom-marker-wrap',
        html: `<div class="tracker-pin-marker home"><span class="marker-emoji">📍</span><span class="marker-tooltip">Delivery Location</span></div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 20]
      });
      trackerHomeMarker = L.marker([dropCoords.lat, dropCoords.lng], { icon: homeIcon }).addTo(trackerLiveMap);

      // 2. Rider Moving Marker
      const riderName = order.assignedRiderName || 'Delivery Partner';
      const riderIcon = L.divIcon({
        className: 'tracker-custom-marker-wrap',
        html: `
          <div class="tracker-pin-marker rider" id="tracker-rider-pin">
            <div class="rider-pulse-ring"></div>
            <span class="marker-emoji">🛵</span>
            <span class="marker-tooltip">${escapeHtml(riderName)}</span>
          </div>
        `,
        iconSize: [44, 44],
        iconAnchor: [22, 22]
      });
      trackerRiderMarker = L.marker([riderLat, riderLng], { icon: riderIcon, zIndexOffset: 1000 }).addTo(trackerLiveMap);

      // 3. Real Road Route Polyline (Following actual streets & turns)
      const initialRoadCoords = generateRoadAlignedPath(riderLat, riderLng, dropCoords.lat, dropCoords.lng);
      trackerRemainingLine = L.polyline(initialRoadCoords, {
        color: '#FF5A26',
        weight: 5,
        opacity: 0.95,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(trackerLiveMap);

      // Immediately display road distance and ETA estimate so badge never displays "Calculating route..."
      const initDistKm = calculateDistanceKm(riderLat, riderLng, dropCoords.lat, dropCoords.lng);
      const initMins = Math.max(3, Math.ceil(initDistKm * 3.2 + 2));
      updateTrackerDistanceAndEta(initDistKm, initMins, Boolean(liveRider));

      // Immediately fetch and render real turn-by-turn road route
      fetchRoadRoute(riderLat, riderLng, dropCoords.lat, dropCoords.lng).then(routeData => {
        if (!trackerLiveMap) return;
        if (routeData?.coords && routeData.coords.length > 0) {
          if (trackerRemainingLine) trackerRemainingLine.setLatLngs(routeData.coords);
          const b = L.latLngBounds(routeData.coords);
          trackerLiveMap.fitBounds(b, { padding: [45, 45], maxZoom: 17 });

          const distKm = Math.round((routeData.distanceMeters / 1000) * 10) / 10;
          const estMins = Math.max(2, Math.ceil(routeData.durationSeconds / 60));
          updateTrackerDistanceAndEta(distKm, estMins, Boolean(liveRider));
        }
      });

      // Fit bounds between Rider and Delivery Location
      const initialBounds = L.latLngBounds([
        [riderLat, riderLng],
        [dropCoords.lat, dropCoords.lng]
      ]);
      trackerLiveMap.fitBounds(initialBounds, { padding: [45, 45], maxZoom: 17 });

      // Interactive Zoom & Expand Controls
      const btnZoomIn = document.getElementById('tracker-map-zoom-in-btn');
      if (btnZoomIn) {
        btnZoomIn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (trackerLiveMap) trackerLiveMap.zoomIn();
        };
      }

      const btnZoomOut = document.getElementById('tracker-map-zoom-out-btn');
      if (btnZoomOut) {
        btnZoomOut.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (trackerLiveMap) trackerLiveMap.zoomOut();
        };
      }

      const btnRecenter = document.getElementById('tracker-map-recenter-btn');
      if (btnRecenter) {
        btnRecenter.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (trackerLiveMap && trackerRiderMarker && trackerHomeMarker) {
            const rPos = trackerRiderMarker.getLatLng();
            const hPos = trackerHomeMarker.getLatLng();
            const b = L.latLngBounds([
              [rPos.lat, rPos.lng],
              [hPos.lat, hPos.lng]
            ]);
            trackerLiveMap.fitBounds(b, { padding: [45, 45], maxZoom: 17 });
          }
        };
      }

      // If no live rider GPS has arrived yet, simulate rider moving along actual street network
      if (!liveRider) {
        fetchRoadRoute(restLat, restLng, dropCoords.lat, dropCoords.lng).then(fullRoute => {
          if (!fullRoute || !fullRoute.coords || fullRoute.coords.length < 2) return;
          const roadPts = fullRoute.coords;
          let currentIdx = Math.max(1, Math.floor(roadPts.length * 0.45));

          trackerSimulationInterval = setInterval(() => {
            if (!trackerLiveMap || activeTrackingOrderId !== order.id) return;
            currentIdx++;
            if (currentIdx >= roadPts.length - 1) {
              currentIdx = Math.max(1, Math.floor(roadPts.length * 0.45));
            }
            const [sLat, sLng] = roadPts[currentIdx];
            const remainingRoad = roadPts.slice(currentIdx);
            if (trackerRemainingLine) {
              trackerRemainingLine.setLatLngs(remainingRoad);
            }
            const distKm = calculateDistanceKm(sLat, sLng, dropCoords.lat, dropCoords.lng);
            const estMins = Math.max(2, Math.ceil(distKm * 3.2));
            updateTrackerDistanceAndEta(distKm, estMins, false);

            updateTrackerRiderPosition({
              lat: sLat,
              lng: sLng,
              riderName: order.assignedRiderName || 'Delivery Partner',
              isLiveGps: false,
              hasCustomRoute: true
            });
          }, 3500);
        });
      }

      setTimeout(() => {
        if (trackerLiveMap) trackerLiveMap.invalidateSize();
      }, 300);

    } catch (err) {
      console.warn('[Live Tracker Map] Initialization error:', err);
    }
  }

  function renderOrderTracker(orderId) {
    orders = dataService.getOrders();
    const userPhone = getCurrentUserPhone();
    const userEmail = currentUser?.email || '';
    const activeOrders = dataService.getCustomerActiveOrders(currentUser?.id, userEmail, userPhone);
    const allUserOrders = dataService.getCustomerOrders(currentUser?.id, userEmail, userPhone);

    // Look for target order in all user orders or store orders
    let order = orders.find(o => o.id === orderId);
    if (!order) {
      order = activeOrders[0] || allUserOrders[0] || orders[0];
    }
    if (!order) return;
    activeOrderId = order.id;

    const selectorWrap = document.getElementById('order-selector-wrap');
    const tabsContainer = document.getElementById('order-tabs-scroll');
    const countEl = document.getElementById('order-selector-count');
    const itemsPreview = document.getElementById('order-items-preview');
    const btnOrderMore = document.getElementById('btn-order-more');

    // Rule: in the live tracker, only show active orders up to delivered!
    // Delivered orders move to My Orders.
    if (activeOrders.length <= 1) {
      if (selectorWrap) selectorWrap.style.display = 'none';
      if (itemsPreview) itemsPreview.style.display = 'none';
      if (btnOrderMore) btnOrderMore.style.display = 'none';
    } else {
      if (selectorWrap) selectorWrap.style.display = 'block';
      if (itemsPreview) itemsPreview.style.display = 'flex';
      if (btnOrderMore) btnOrderMore.style.display = 'block';
      if (countEl) countEl.textContent = `${activeOrders.length} Active Orders`;

      // Render order tabs ONLY for active orders
      if (tabsContainer) {
        tabsContainer.innerHTML = activeOrders.map(ord => {
          const isActive = ord.id === activeOrderId;
          const statusClass = `status-${escapeHtml(ord.status || 'accepted')}`;
          const safeOrdId = escapeHtml(ord.id);
          return `
            <button class="order-tab-btn ${isActive ? 'active' : ''}" data-order-id="${safeOrdId}" type="button">
              <span class="order-tab-id">${safeOrdId}</span>
              <span class="order-tab-status ${statusClass}">
                <span class="status-dot"></span>
                <span>${escapeHtml(ord.statusLabel || 'Processing')}</span>
              </span>
            </button>
          `;
        }).join('');

        // Tab click events
        tabsContainer.querySelectorAll('.order-tab-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const clickedId = btn.getAttribute('data-order-id');
            if (clickedId && clickedId !== activeOrderId) {
              renderOrderTracker(clickedId);
            }
          });
        });
      }

      // Update items preview card
      const itemsTextEl = document.getElementById('items-preview-text');
      const itemsPriceEl = document.getElementById('items-preview-price');
      if (itemsTextEl) itemsTextEl.textContent = order.itemsSummary || 'Delicious Crispy Chicken meal';
      if (itemsPriceEl) itemsPriceEl.textContent = order.total || '₹330';
    }

    // Update order ID
    const orderIdEl = document.getElementById('order-id-num');
    if (orderIdEl) orderIdEl.textContent = order.id;

    // Update title & icon based on status
    const successIcon = document.getElementById('order-success-icon');
    const modalTitle = document.getElementById('order-modal-title');
    const modalCard = document.querySelector('.order-modal-card');
    if (modalCard) {
      if (order.status === 'on_the_way') modalCard.classList.add('is-dispatched');
      else modalCard.classList.remove('is-dispatched');
    }

    if (order.status === 'cancelled') {
      if (successIcon) successIcon.textContent = '❌';
      if (modalTitle) modalTitle.textContent = 'Order Cancelled';
    } else if (order.status === 'on_the_way') {
      if (successIcon) successIcon.textContent = '🛵';
      if (modalTitle) modalTitle.textContent = 'Out for Delivery!';
    } else if (order.status === 'delivered') {
      if (successIcon) successIcon.textContent = '🎉';
      if (modalTitle) modalTitle.textContent = 'Order Delivered!';
    } else {
      if (successIcon) successIcon.textContent = '🔥';
      if (modalTitle) modalTitle.textContent = 'Order Confirmed & Sizzling!';
    }

    // Update Subtitle based on status
    const modalSub = document.getElementById('order-modal-sub');
    if (modalSub) {
      const safeOrderId = escapeHtml(order.id);
      if (order.status === 'cancelled') {
        const reasonHtml = order.cancellationReason ? `<br><span style="color:#B91C1C; font-size:0.86rem; display:inline-flex; align-items:center; gap:6px; margin-top:6px; font-weight:600;"><i class="fa-solid fa-circle-exclamation"></i> Reason: ${escapeHtml(order.cancellationReason)}</span>` : '';
        modalSub.innerHTML = `Order <strong id="order-id-num">${safeOrderId}</strong> was cancelled by the kitchen.${reasonHtml}`;
      } else if (order.status === 'accepted' || order.status === 'pending') {
        modalSub.innerHTML = `Order <strong id="order-id-num">${safeOrderId}</strong> has been accepted by our kitchen.`;
      } else if (order.status === 'cooking') {
        modalSub.innerHTML = `Order <strong id="order-id-num">${safeOrderId}</strong> is being freshly prepared in our kitchen.`;
      } else if (order.status === 'ready_for_pickup') {
        modalSub.innerHTML = `Order <strong id="order-id-num">${safeOrderId}</strong> is packed and ready to dispatch!`;
      } else if (order.status === 'on_the_way') {
        modalSub.innerHTML = `Order <strong id="order-id-num">${safeOrderId}</strong> is on the way to your doorstep!`;
      } else if (order.status === 'delivered') {
        modalSub.innerHTML = `Order <strong id="order-id-num">${safeOrderId}</strong> has arrived at your door! 🎉 Saved to <strong>My Orders</strong>.`;
      } else {
        modalSub.innerHTML = `Order <strong id="order-id-num">${safeOrderId}</strong> has been accepted by our kitchen.`;
      }
    }

    // Update ETA Time
    const etaEl = document.getElementById('tracker-eta-time');
    if (etaEl) {
      etaEl.textContent = order.status === 'cancelled' ? 'Order Cancelled' : (order.eta || '30 - 40 Minutes');
    }

    // Update Dynamic Contextual Calling Card:
    // Before or while preparing: Call Restaurant Kitchen
    // After dispatch: Call Delivery Boy
    const contactCardEl = document.getElementById('tracker-contact-card');
    if (contactCardEl) {
      const isDispatched = order.status === 'on_the_way';
      const isDelivered = order.status === 'delivered';
      const settings = dataService.getSettings();
      const restaurantPhone = settings?.restaurantPhone || settings?.helpline || '+91 98450 12345';
      const cleanRestDigits = restaurantPhone.replace(/\D/g, '');
      const dialerRestPhone = cleanRestDigits.length === 10 ? `+91${cleanRestDigits}` : `+${cleanRestDigits}`;

      if (order.status === 'cancelled') {
        contactCardEl.innerHTML = `
          <div class="order-cancelled-notice-card">
            <div class="notice-icon"><i class="fa-solid fa-circle-xmark"></i></div>
            <div>
              <div class="notice-title">This Order Was Cancelled</div>
              <div class="notice-reason">${escapeHtml(order.cancellationReason || 'Kitchen was unable to fulfill this order at this time.')}</div>
            </div>
          </div>
          <div class="tracker-contact-header">
            <div class="tracker-contact-entity">
              <div class="tracker-contact-avatar kitchen" style="background:#FEF2F2; color:#DC2626; border-color:#FECACA;">
                <i class="fa-solid fa-store"></i>
              </div>
              <div class="tracker-contact-details">
                <span class="tracker-contact-name">Restaurant Kitchen</span>
                <span class="tracker-contact-role">Contact for support</span>
              </div>
            </div>
            <span class="tracker-contact-badge" style="background:#FEF2F2; color:#DC2626; border-color:#FECACA;">Cancelled</span>
          </div>
          <div class="swipe-to-call-track kitchen" id="swipe-track-kitchen" data-phone="${dialerRestPhone}" data-label="Kitchen">
            <div class="swipe-to-call-fill"></div>
            <div class="swipe-to-call-text">
              <i class="fa-solid fa-phone"></i> Slide to Call Kitchen (${escapeHtml(restaurantPhone)})
            </div>
            <div class="swipe-to-call-thumb">
              <i class="fa-solid fa-phone"></i>
            </div>
          </div>
        `;
        initSwipeToCall(contactCardEl.querySelector('.swipe-to-call-track'));
      } else if (isDispatched) {
        // After dispatch: Delivery Partner Calling Button
        const riderPin = order.assignedRiderPin;
        const rider = riderPin ? dataService.getRiderByPin(riderPin) : null;
        const riderName = order.assignedRiderName || rider?.name || 'Savera Paradise Delivery Partner';
        const riderVehicle = order.assignedRiderVehicle || rider?.vehicle || '🏍️ Express Bike';
        const rawRiderPhone = order.assignedRiderPhone || rider?.phone || '+91 98765 43210';
        const cleanRiderDigits = rawRiderPhone.replace(/\D/g, '');
        const dialerRiderPhone = cleanRiderDigits.length === 10 ? `+91${cleanRiderDigits}` : `+${cleanRiderDigits}`;
        const displayRiderPhone = cleanRiderDigits.length >= 10 ? `+91 ${cleanRiderDigits.slice(-10, -5)} ${cleanRiderDigits.slice(-5)}` : rawRiderPhone;

        const waText = encodeURIComponent(`Hi ${riderName}, I'm the customer for Order ${order.id}. Could you give an update on your delivery location?`);
        const waUrl = cleanRiderDigits.length >= 10 ? `https://wa.me/91${cleanRiderDigits.slice(-10)}?text=${waText}` : '#';

        contactCardEl.innerHTML = `
          <div class="tracker-contact-header">
            <div class="tracker-contact-entity">
              <div class="tracker-contact-avatar rider">
                <i class="fa-solid fa-motorcycle"></i>
              </div>
              <div class="tracker-contact-details">
                <h4>${escapeHtml(riderName)}</h4>
                <p><i class="fa-solid fa-route"></i> ${escapeHtml(riderVehicle)} • Dispatched for Delivery</p>
              </div>
            </div>
            <span class="tracker-contact-badge rider">
              <i class="fa-solid fa-person-biking"></i> On Delivery
            </span>
          </div>

          <div class="swipe-to-call-container">
            <div class="swipe-to-call-track rider" id="swipe-track-rider" data-phone="${dialerRiderPhone}" data-label="Delivery Partner">
              <div class="swipe-to-call-fill"></div>
              <div class="swipe-to-call-text">
                <span class="swipe-text-shimmer">Swipe to Call Delivery Boy</span>
                <span class="swipe-chevrons">
                  <i class="fa-solid fa-chevron-right"></i>
                  <i class="fa-solid fa-chevron-right"></i>
                  <i class="fa-solid fa-chevron-right"></i>
                </span>
              </div>
              <div class="swipe-to-call-thumb" role="button" aria-label="Swipe to Call Delivery Boy" tabindex="0">
                <div class="thumb-glow"></div>
                <i class="fa-solid fa-phone"></i>
              </div>
            </div>
          </div>

          <div class="tracker-secondary-wa-row">
            <a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="tracker-contact-wa-link" title="WhatsApp Delivery Boy">
              <i class="fa-brands fa-whatsapp"></i> Need to text? Chat on WhatsApp
            </a>
          </div>

          <div class="tracker-contact-note">
            <i class="fa-solid fa-shield-halved"></i> Swipe right to call your delivery boy for live gate coordination and quick doorstep handover.
          </div>
        `;
        initSwipeToCall(contactCardEl.querySelector('.swipe-to-call-track'));
      } else if (isDelivered) {
        // Delivered: Completed status with support option
        contactCardEl.innerHTML = `
          <div class="tracker-contact-header">
            <div class="tracker-contact-entity">
              <div class="tracker-contact-avatar" style="background:#ECFDF5; border-color:#A7F3D0; color:#059669;">
                <i class="fa-solid fa-circle-check"></i>
              </div>
              <div class="tracker-contact-details">
                <h4>Order Delivered 🎉</h4>
                <p>Delivered by ${escapeHtml(order.assignedRiderName || 'Delivery Partner')}</p>
              </div>
            </div>
            <span class="tracker-contact-badge" style="background:#ECFDF5; color:#059669; border-color:#D1FAE5;">
              Completed
            </span>
          </div>

          <div class="swipe-to-call-container">
            <div class="swipe-to-call-track" id="swipe-track-restaurant" data-phone="${dialerRestPhone}" data-label="Restaurant Support">
              <div class="swipe-to-call-fill"></div>
              <div class="swipe-to-call-text">
                <span class="swipe-text-shimmer">Swipe to Call Support</span>
                <span class="swipe-chevrons">
                  <i class="fa-solid fa-chevron-right"></i>
                  <i class="fa-solid fa-chevron-right"></i>
                  <i class="fa-solid fa-chevron-right"></i>
                </span>
              </div>
              <div class="swipe-to-call-thumb" role="button" aria-label="Swipe to Call Restaurant Support" tabindex="0">
                <div class="thumb-glow"></div>
                <i class="fa-solid fa-phone"></i>
              </div>
            </div>
          </div>

          <div class="tracker-contact-note">
            <i class="fa-solid fa-heart"></i> Hope you loved your meal! Call us directly if you need any assistance with your order.
          </div>
        `;
        initSwipeToCall(contactCardEl.querySelector('.swipe-to-call-track'));
      } else {
        // Before dispatch (All 3 pre-dispatch steps: Accepted, Preparing, Ready to Dispatch): Restaurant Helpline Calling Card
        let statusBadgeLabel = '👨‍🍳 Accepted';
        let statusBadgeClass = 'accepted';
        let stepHint = 'Your order is confirmed and received by the kitchen.';

        if (order.status === 'cooking') {
          statusBadgeLabel = '🔥 Preparing';
          statusBadgeClass = 'cooking';
        } else if (order.status === 'ready_for_pickup') {
          statusBadgeLabel = '📦 Ready to Dispatch';
          statusBadgeClass = 'ready';
        }

        contactCardEl.innerHTML = `
          <div class="tracker-contact-header">
            <div class="tracker-contact-entity">
              <div class="tracker-contact-avatar kitchen">
                <i class="fa-solid fa-utensils"></i>
              </div>
              <div class="tracker-contact-details">
                <h4>Savera Paradise Support</h4>
                <p><i class="fa-solid fa-phone"></i> ${escapeHtml(restaurantPhone)} • Restaurant Helpline</p>
              </div>
            </div>
            <span class="tracker-contact-badge ${statusBadgeClass}">
              ${statusBadgeLabel}
            </span>
          </div>

          <div class="swipe-to-call-container">
            <div class="swipe-to-call-track kitchen" id="swipe-track-kitchen" data-phone="${dialerRestPhone}" data-label="Restaurant Support" data-swipe-text="Swipe to Call">
              <div class="swipe-to-call-fill"></div>
              <div class="swipe-to-call-text">
                <span class="swipe-text-shimmer">Swipe to Call</span>
                <span class="swipe-chevrons">
                  <i class="fa-solid fa-chevron-right"></i>
                  <i class="fa-solid fa-chevron-right"></i>
                  <i class="fa-solid fa-chevron-right"></i>
                </span>
              </div>
              <div class="swipe-to-call-thumb" role="button" aria-label="Swipe to Call" tabindex="0">
                <div class="thumb-glow"></div>
                <i class="fa-solid fa-phone"></i>
              </div>
            </div>
          </div>
        `;
        initSwipeToCall(contactCardEl.querySelector('.swipe-to-call-track'));
      }
    }

    // Update 5-step Timeline (Pending -> Accepted -> Cooking -> Dispatched -> Delivered)
    const stepIndex = typeof order.stepIndex === 'number' ? order.stepIndex : 0;
    const stepElements = [
      document.getElementById('track-step-0'),
      document.getElementById('track-step-1'),
      document.getElementById('track-step-2'),
      document.getElementById('track-step-3'),
      document.getElementById('track-step-4')
    ];

    const isCancelled = order.status === 'cancelled';
    const trackerTimelineEl = document.getElementById('order-tracker-timeline');
    if (trackerTimelineEl) {
      if (isCancelled) {
        trackerTimelineEl.style.opacity = '0.35';
        trackerTimelineEl.style.filter = 'grayscale(1)';
      } else {
        trackerTimelineEl.style.opacity = '1';
        trackerTimelineEl.style.filter = 'none';
      }
    }

    stepElements.forEach((el, idx) => {
      if (!el) return;
      el.classList.remove('active', 'current');
      if (!isCancelled) {
        if (idx < stepIndex) {
          el.classList.add('active');
        } else if (idx === stepIndex) {
          el.classList.add('active', 'current');
        }
      }
    });

    // Customer Cancel Order button in live tracking modal
    // Strict Requirement: Customer can ONLY cancel when order is in 'accepted' status (not in any other status)
    const btnCustomerCancelOrder = document.getElementById('btn-customer-cancel-order');
    if (btnCustomerCancelOrder) {
      if (order.status === 'accepted') {
        btnCustomerCancelOrder.style.display = 'inline-flex';
        btnCustomerCancelOrder.onclick = () => {
          handleCustomerCancelOrder(order.id);
        };
      } else {
        btnCustomerCancelOrder.style.display = 'none';
      }
    }

    // Synchronize live preparation background video with current order status
    syncTrackerVideoBackground(order);

    // Live interactive map for dispatched orders
    if (order.status === 'on_the_way') {
      initTrackerLiveMap(order);
    } else {
      destroyTrackerLiveMap();
    }
  }

  function handleCustomerCancelOrder(orderId) {
    if (!orderId) return;
    const order = dataService.getOrderById(orderId);
    if (!order) return;

    // Strict Rule: Customers can ONLY cancel an order while it is in "accepted" status
    if (order.status !== 'accepted') {
      if (order.status === 'cooking' || order.status === 'ready_for_pickup') {
        showToast('🍳 Food Preparation Alert: Chefs have already started cooking your order fresh! Orders in preparation cannot be cancelled online. Please slide-to-call the kitchen below.', 'warning');
      } else if (order.status === 'on_the_way') {
        showToast('🛵 Out for Delivery: Your order is already dispatched and on the way, so it cannot be cancelled.', 'warning');
      } else if (order.status === 'delivered') {
        showToast('This order has already been delivered.', 'info');
      } else if (order.status === 'cancelled') {
        showToast('This order is already cancelled.', 'info');
      } else {
        showToast('Order cancellation is only allowed while the order is in "Accepted" status.', 'warning');
      }
      return;
    }

    const confirmCancel = window.confirm(`Are you sure you want to cancel Order ${order.id}?\n\nNote: Cancellation is only available while in "Accepted" status before kitchen preparation begins.`);
    if (!confirmCancel) return;

    const updated = dataService.updateOrderStatus(order.id, 'cancelled', 'customer', {
      cancellationReason: 'Cancelled by customer'
    });

    if (updated) {
      showToast(`❌ Order ${order.id} has been cancelled.`, 'info');
      renderOrderTracker(order.id);
      renderMyOrdersList();
      renderCartOrderLimitUI();
    }
  }

  function openOrderModal(orderIdToOpen, isNewCheckout = false) {
    const myOrdersEl = document.getElementById('modal-my-orders-backdrop');
    if (myOrdersEl && myOrdersEl.classList.contains('open')) {
      closeMyOrdersModalInternal();
      backNav.removeStepDirect('my-orders-modal');
    }
    orders = dataService.getOrders();
    const userPhone = getCurrentUserPhone();
    const userEmail = currentUser?.email || '';
    const activeOrders = dataService.getCustomerActiveOrders(currentUser?.id, userEmail, userPhone);

    const trackerEmptyState = document.getElementById('tracker-empty-state');
    const trackerActiveContent = document.getElementById('tracker-active-content');

    // If user has NO active orders in progress and no specific orderId requested, show the empty state:
    // "You have no orders to track"
    if (!isNewCheckout && !orderIdToOpen && activeOrders.length === 0) {
      if (trackerEmptyState) trackerEmptyState.style.display = 'block';
      if (trackerActiveContent) trackerActiveContent.style.display = 'none';
      syncTrackerVideoBackground(null);
      orderModalBackdrop.classList.add('open');
      document.body.style.overflow = 'hidden';
      setActiveCapsuleBtn(navBtnTrack);
      backNav.pushStep('order-modal', () => closeOrderModalInternal(), () => openOrderModal(orderIdToOpen, false));
      return;
    }

    if (trackerEmptyState) trackerEmptyState.style.display = 'none';
    if (trackerActiveContent) trackerActiveContent.style.display = 'block';

    let targetOrder = null;
    if (orderIdToOpen) {
      targetOrder = orders.find(o => o.id === orderIdToOpen);
    }
    if (!targetOrder) {
      targetOrder = activeOrders[0] || orders.find(o => o.status !== 'delivered') || orders[0];
    }

    if (targetOrder) {
      renderOrderTracker(targetOrder.id);
    }

    // Live Notification permission prompt in tracker modal
    const notifBanner = document.getElementById('order-notif-optin-banner');
    if (notifBanner) {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        notifBanner.style.display = 'flex';
      } else {
        notifBanner.style.display = 'none';
      }
    }

    orderModalBackdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
    setActiveCapsuleBtn(navBtnTrack);
    backNav.pushStep('order-modal', () => closeOrderModalInternal());

    if (isNewCheckout) {
      confetti({
        particleCount: 120,
        spread: 90,
        origin: { y: 0.5 },
        colors: ['#FF5A26', '#F59E0B', '#10B981', '#3B82F6']
      });
    }
  }
  window.openOrderModal = openOrderModal;

  function closeOrderModalInternal() {
    pauseTrackerVideo();
    destroyTrackerLiveMap();
    const modalCard = document.querySelector('.order-modal-card');
    if (modalCard) modalCard.classList.remove('is-dispatched');
    orderModalBackdrop.classList.remove('open');
    document.body.style.overflow = '';
    syncCapsuleNavWithScroll();
  }

  function closeOrderModal() {
    if (backNav.isTopStep('order-modal')) {
      backNav.stepBack();
    } else {
      closeOrderModalInternal();
      backNav.removeStepDirect('order-modal');
    }
  }

  const btnEnableOrderNotifs = document.getElementById('btn-enable-order-notifs');
  if (btnEnableOrderNotifs) {
    btnEnableOrderNotifs.addEventListener('click', async () => {
      const perm = await requestSystemNotificationPermission();
      const notifBanner = document.getElementById('order-notif-optin-banner');
      if (perm === 'granted') {
        if (notifBanner) notifBanner.style.display = 'none';
        showToast('🔔 Live order alerts enabled! You will receive real-time updates.', 'success');
        sendSystemNotification({
          title: '🍗 Live Alerts Activated!',
          body: 'We will notify you the moment your food is cooking and out for delivery!',
          tag: 'notif-optin-success'
        });
      } else if (perm === 'denied') {
        if (notifBanner) notifBanner.style.display = 'none';
        showToast('⚠️ Notifications are blocked in your browser settings.', 'warning');
      }
    });
  }

  // ==========================================
  // MY ORDERS (ORDER HISTORY & RECEIPTS) CONTROLLER
  // ==========================================
  const modalMyOrdersBackdrop = document.getElementById('modal-my-orders-backdrop');
  const modalMyOrdersClose = document.getElementById('modal-my-orders-close');
  const myOrdersList = document.getElementById('my-orders-list');
  const myOrdersEmptyState = document.getElementById('my-orders-empty-state');
  const myOrdersCountAll = document.getElementById('my-orders-count-all');
  const myOrdersCountActive = document.getElementById('my-orders-count-active');
  const myOrdersCountDelivered = document.getElementById('my-orders-count-delivered');
  const myOrdersFilterPills = document.querySelectorAll('.my-orders-filter-pill');
  const btnMyOrdersExplore = document.getElementById('btn-my-orders-explore');

  let activeMyOrdersFilter = 'all'; // 'all' | 'active' | 'delivered'

  function renderMyOrdersList() {
    if (!myOrdersList) return;

    const userPhone = getCurrentUserPhone();
    const userEmail = currentUser?.email || '';
    const allUserOrders = dataService.getCustomerOrders(currentUser?.id, userEmail, userPhone);

    const activeList = allUserOrders.filter(o => o.status !== 'delivered' && o.status !== 'cancelled');
    const deliveredList = allUserOrders.filter(o => o.status === 'delivered' || o.status === 'cancelled');

    if (myOrdersCountAll) myOrdersCountAll.textContent = allUserOrders.length;
    if (myOrdersCountActive) myOrdersCountActive.textContent = activeList.length;
    if (myOrdersCountDelivered) myOrdersCountDelivered.textContent = deliveredList.length;

    let filtered = allUserOrders;
    if (activeMyOrdersFilter === 'active') {
      filtered = activeList;
    } else if (activeMyOrdersFilter === 'delivered') {
      filtered = deliveredList;
    }

    if (filtered.length === 0) {
      myOrdersList.style.display = 'none';
      if (myOrdersEmptyState) myOrdersEmptyState.style.display = 'block';
      return;
    }

    myOrdersList.style.display = 'flex';
    if (myOrdersEmptyState) myOrdersEmptyState.style.display = 'none';

    myOrdersList.innerHTML = filtered.map(order => {
      const isDelivered = order.status === 'delivered';
      const isCancelled = order.status === 'cancelled';
      const isPast = isDelivered || isCancelled;
      const timeStr = order.createdAt ? new Date(order.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Recent Order';

      let statusPillClass = `status-${order.status || 'pending'}`;
      let statusLabel = order.statusLabel || (isCancelled ? 'Cancelled' : (isDelivered ? 'Delivered' : 'In Progress'));

      const safeId = escapeHtml(order.id);
      const safeSummary = escapeHtml(order.itemsSummary || (order.items && order.items.map(i => `${i.quantity}x ${i.name}`).join(', ')) || 'Crispy Chicken Food Package');
      const safeAddress = escapeHtml(order.deliveryAddress || 'Doorstep Delivery');
      const safeTotal = escapeHtml(order.total || '₹0');
      const safePayment = escapeHtml(order.paymentMethod || 'Cash on Delivery');
      const safeStatusLabel = escapeHtml(statusLabel);

      let cardCallBtnHtml = '';
      if (!isPast) {
        if (order.status === 'on_the_way') {
          const rider = order.assignedRiderPin ? dataService.getRiderByPin(order.assignedRiderPin) : null;
          const riderPhone = order.assignedRiderPhone || rider?.phone || '+91 98765 43210';
          const cleanPhone = riderPhone.replace(/\D/g, '');
          const dialerPhone = cleanPhone.length === 10 ? `+91${cleanPhone}` : `+${cleanPhone}`;
          cardCallBtnHtml = `
            <a href="tel:${dialerPhone}" class="btn-card-call-contact" title="Call Delivery Boy (${riderPhone})">
              <i class="fa-solid fa-phone"></i> Call Delivery Boy
            </a>
          `;
        } else {
          const settings = dataService.getSettings();
          const restPhone = settings?.restaurantPhone || settings?.helpline || '+91 98450 12345';
          const cleanRest = restPhone.replace(/\D/g, '');
          const dialerRest = cleanRest.length === 10 ? `+91${cleanRest}` : `+${cleanRest}`;
          cardCallBtnHtml = `
            <a href="tel:${dialerRest}" class="btn-card-call-contact kitchen" title="Call Restaurant (${restPhone})">
              <i class="fa-solid fa-phone"></i> Call Restaurant (${escapeHtml(restPhone)})
            </a>
          `;
        }
      }

      // Strict Rule: Customers can ONLY cancel an order when it is in 'accepted' status
      const canCancel = !isPast && order.status === 'accepted';
      const cancelBtnHtml = canCancel ? `
        <button type="button" class="btn-card-cancel-order" data-cancel-id="${safeId}">
          <i class="fa-solid fa-ban"></i> Cancel
        </button>
      ` : '';

      const actionBtnHtml = isPast ? `
        <button type="button" class="btn-card-reorder" data-reorder-id="${safeId}">
          <i class="fa-solid fa-arrows-rotate"></i> Reorder Items
        </button>
      ` : `
        ${cardCallBtnHtml}
        ${cancelBtnHtml}
        <button type="button" class="btn-card-track" data-track-id="${safeId}">
          <i class="fa-solid fa-motorcycle"></i> Track Live
        </button>
      `;

      const reasonHtml = (isCancelled && order.cancellationReason) ? `
        <div class="cancellation-reason-badge">
          <i class="fa-solid fa-circle-exclamation"></i> Reason: ${escapeHtml(order.cancellationReason)}
        </div>
      ` : '';

      return `
        <div class="my-orders-card ${isPast ? 'is-delivered-order' : 'is-active-order'}" data-id="${safeId}">
          <div class="my-orders-card-top">
            <div class="my-orders-id-time">
              <span class="my-orders-id">${safeId}</span>
              <span class="my-orders-time"><i class="fa-regular fa-clock"></i> ${timeStr}</span>
            </div>
            <span class="my-orders-status-pill ${statusPillClass}">
              ${safeStatusLabel}
            </span>
          </div>

          <div class="my-orders-items-summary">
            ${safeSummary}
          </div>
          ${reasonHtml}

          <div style="font-size: 0.78rem; color: #6B7280; margin-bottom: 6px;">
            <i class="fa-solid fa-location-dot"></i> ${safeAddress}
          </div>

          <div class="my-orders-card-bottom">
            <div class="my-orders-pricing">
              <span class="my-orders-total">${safeTotal}</span>
              <span class="my-orders-payment-mode">${safePayment}</span>
            </div>
            <div class="my-orders-actions">
              ${actionBtnHtml}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Attach Track Live actions
    myOrdersList.querySelectorAll('[data-track-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-track-id');
        closeMyOrdersModalInternal();
        backNav.removeStepDirect('my-orders-modal');
        openOrderModal(id, false);
      });
    });

    // Attach Cancel actions
    myOrdersList.querySelectorAll('[data-cancel-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-cancel-id');
        handleCustomerCancelOrder(id);
      });
    });

    // Attach Reorder actions
    myOrdersList.querySelectorAll('[data-reorder-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-reorder-id');
        const orderToReorder = allUserOrders.find(o => o.id === id);
        if (orderToReorder && orderToReorder.items) {
          orderToReorder.items.forEach(item => {
            const foundInCart = cart.find(c => c.name === item.name);
            if (foundInCart) {
              foundInCart.quantity += (item.quantity || 1);
            } else {
              cart.push({
                id: 'reorder-' + Math.random().toString(36).substr(2, 6),
                name: item.name,
                price: parseFloat(item.price) || 150,
                image: '/images/crispy-chicken.jpg',
                quantity: item.quantity || 1
              });
            }
          });
          saveCart();
          renderCart();
          closeMyOrdersModalInternal();
          backNav.removeStepDirect('my-orders-modal');
          openCartDrawer();
          showToast(`🛍️ Added items from ${orderToReorder.id} to your basket!`, 'success');
        }
      });
    });
  }

  function openMyOrdersModal(filter = 'all') {
    // If order tracker modal is open, close it cleanly first to prevent overlay overlap and popstate collision
    if (orderModalBackdrop && orderModalBackdrop.classList.contains('open')) {
      closeOrderModalInternal();
      backNav.removeStepDirect('order-modal');
    }
    if (mobileNavDrawer && mobileNavDrawer.classList.contains('open')) {
      closeMobileMenuInternal();
      backNav.removeStepDirect('mobile-nav');
    }
    if (userDropdownCard) {
      userDropdownCard.classList.remove('show');
    }

    activeMyOrdersFilter = filter;
    myOrdersFilterPills.forEach(pill => {
      if (pill.getAttribute('data-filter') === activeMyOrdersFilter) {
        pill.classList.add('active');
      } else {
        pill.classList.remove('active');
      }
    });

    renderMyOrdersList();

    if (modalMyOrdersBackdrop) {
      modalMyOrdersBackdrop.classList.add('open');
      document.body.style.overflow = 'hidden';
      setActiveCapsuleBtn(navBtnTrack);
      backNav.pushStep('my-orders-modal', () => closeMyOrdersModalInternal());
    }
  }

  function closeMyOrdersModalInternal() {
    if (modalMyOrdersBackdrop) {
      modalMyOrdersBackdrop.classList.remove('open');
      document.body.style.overflow = '';
      syncCapsuleNavWithScroll();
    }
  }

  function closeMyOrdersModal() {
    if (backNav.isTopStep('my-orders-modal')) {
      backNav.stepBack();
    } else {
      closeMyOrdersModalInternal();
      backNav.removeStepDirect('my-orders-modal');
    }
  }

  if (modalMyOrdersClose) modalMyOrdersClose.addEventListener('click', closeMyOrdersModal);
  if (modalMyOrdersBackdrop) {
    modalMyOrdersBackdrop.addEventListener('click', (e) => {
      if (e.target === modalMyOrdersBackdrop) closeMyOrdersModal();
    });
  }

  myOrdersFilterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      myOrdersFilterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      activeMyOrdersFilter = pill.getAttribute('data-filter') || 'all';
      renderMyOrdersList();
    });
  });

  // Wiring My Orders links:
  const dropLinkTrack = document.getElementById('drop-link-track');
  if (dropLinkTrack) {
    dropLinkTrack.addEventListener('click', (e) => {
      e.preventDefault();
      if (userDropdownCard) userDropdownCard.classList.remove('show');
      openMyOrdersModal('all');
    });
  }

  const btnTrackerOpenMyOrders = document.getElementById('btn-tracker-open-my-orders');
  if (btnTrackerOpenMyOrders) {
    btnTrackerOpenMyOrders.addEventListener('click', () => {
      closeOrderModalInternal();
      backNav.removeStepDirect('order-modal');
      openMyOrdersModal('all');
    });
  }

  const btnEmptyViewHistory = document.getElementById('btn-empty-view-history');
  if (btnEmptyViewHistory) {
    btnEmptyViewHistory.addEventListener('click', () => {
      closeOrderModalInternal();
      backNav.removeStepDirect('order-modal');
      openMyOrdersModal('all');
    });
  }

  const btnEmptyOrderNow = document.getElementById('btn-empty-order-now');
  if (btnEmptyOrderNow) {
    btnEmptyOrderNow.addEventListener('click', () => {
      closeOrderModal();
      const menuSec = document.getElementById('menu-section');
      if (menuSec) menuSec.scrollIntoView({ behavior: 'smooth' });
    });
  }

  if (btnMyOrdersExplore) {
    btnMyOrdersExplore.addEventListener('click', () => {
      closeMyOrdersModal();
      const menuSec = document.getElementById('menu-section');
      if (menuSec) menuSec.scrollIntoView({ behavior: 'smooth' });
    });
  }

  // ==========================================
  // CHECKOUT MODAL & PAYMENT METHOD CONTROLLER
  // ==========================================
  const modalCheckoutBackdrop = document.getElementById('modal-checkout-backdrop');
  const modalCheckoutCard = document.getElementById('modal-checkout-card');
  const modalCheckoutClose = document.getElementById('modal-checkout-close');
  const btnCheckoutAddAddr = document.getElementById('btn-checkout-add-addr');
  const btnCheckoutAddFirstAddr = document.getElementById('btn-checkout-add-first-addr');
  const checkoutAddrEmptyPrompt = document.getElementById('checkout-addr-empty-prompt');
  const checkoutAddressesList = document.getElementById('checkout-addresses-list');
  const checkoutAddressDistancePill = document.getElementById('checkout-address-distance-pill');
  const checkoutDistDot = document.getElementById('checkout-dist-dot');
  const checkoutDistText = document.getElementById('checkout-dist-text');
  const paymentCardCod = document.getElementById('payment-card-cod');
  const radioPaymentCod = document.getElementById('radio-payment-cod');
  const paymentCardOnline = document.getElementById('payment-card-online');
  const radioPaymentOnline = document.getElementById('radio-payment-online');
  const checkoutBillAddress = document.getElementById('checkout-bill-address');
  const checkoutBillPayment = document.getElementById('checkout-bill-payment');
  const checkoutBillTotal = document.getElementById('checkout-bill-total');
  const btnPlaceOrderFinal = document.getElementById('btn-place-order-final');
  const btnPlaceOrderLabel = document.getElementById('btn-place-order-label');

  let selectedCheckoutPayment = 'cod'; // Cash on Delivery default

  function renderCheckoutAddresses() {
    updateHeroDeliveryDistanceBadge();
    if (!checkoutAddressesList) return;

    const addresses = getCurrentAddresses();
    if (addresses.length === 0) {
      if (checkoutAddrEmptyPrompt) checkoutAddrEmptyPrompt.style.display = 'block';
      checkoutAddressesList.innerHTML = '';
      if (checkoutAddressDistancePill) checkoutAddressDistancePill.style.display = 'none';
      if (checkoutBillAddress) checkoutBillAddress.textContent = 'No Address Saved';
      if (btnPlaceOrderFinal) btnPlaceOrderFinal.disabled = true;
      return;
    }

    if (checkoutAddrEmptyPrompt) checkoutAddrEmptyPrompt.style.display = 'none';

    // Ensure valid selectedAddressId
    if (!selectedAddressId || !addresses.some(a => a.id === selectedAddressId)) {
      const def = addresses.find(a => a.isDefault);
      selectedAddressId = def ? def.id : addresses[0].id;
    }

    const selectedAddr = addresses.find(a => a.id === selectedAddressId) || addresses[0];

    // Render address cards with selection
    checkoutAddressesList.innerHTML = addresses.map(addr => {
      const isSel = addr.id === selectedAddressId;
      const tagEmoji = addr.tag === 'Work' ? '💼' : (addr.tag === 'Other' ? '📍' : '🏠');
      const safeId = escapeHtml(addr.id);
      const safeTag = escapeHtml(addr.tag || 'Home');
      const safeName = escapeHtml(addr.name || 'User');
      const safePhone = escapeHtml(addr.phone || '');
      const safeFlat = escapeHtml(addr.flatNo || '');
      const safeArea = escapeHtml(addr.area || '');
      const safeCity = addr.city ? ', ' + escapeHtml(addr.city) : '';
      const safePincode = addr.pincode ? ' - ' + escapeHtml(addr.pincode) : '';
      const dist = Math.round((parseFloat(addr.distanceKm) || 0) * 10) / 10;

      return `
        <div class="checkout-addr-card ${isSel ? 'selected' : ''}" data-id="${safeId}">
          <div class="checkout-addr-radio-wrap">
            <input type="radio" name="checkout_sel_addr" class="checkout-addr-radio" ${isSel ? 'checked' : ''} />
          </div>
          <div class="checkout-addr-details">
            <div class="checkout-addr-header-row">
              <span class="checkout-addr-tag-pill">${tagEmoji} ${safeTag}</span>
              ${addr.isDefault ? '<span class="checkout-addr-default-pill">Default</span>' : ''}
              <span class="checkout-addr-distance-tag">${dist} km</span>
            </div>
            <div class="checkout-addr-person">
              <strong>${safeName}</strong> • ${safePhone ? `📞 ${safePhone}` : '<span style="color:#DC2626; font-weight:700;">⚠️ Mobile number required</span>'}
            </div>
            <div class="checkout-addr-text">
              ${escapeHtml(addr.details || addr.fullText || `${addr.flatNo || ''}, ${addr.area || ''}${safeCity}${safePincode}`)}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Attach click listeners to cards
    checkoutAddressesList.querySelectorAll('.checkout-addr-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-id');
        if (id && id !== selectedAddressId) {
          selectedAddressId = id;
          renderCheckoutAddresses();
        }
      });
    });

    // Update bill Deliver-To text
    if (checkoutBillAddress && selectedAddr) {
      const billPhone = selectedAddr.phone ? ` (${selectedAddr.phone})` : '';
      checkoutBillAddress.textContent = `${selectedAddr.name}${billPhone} • ${selectedAddr.flatNo}, ${selectedAddr.area}`;
      checkoutBillAddress.title = `${selectedAddr.name}${billPhone} • ${selectedAddr.flatNo}, ${selectedAddr.area}`;
    }

    // Distance deliverability check
    if (checkoutAddressDistancePill && selectedAddr) {
      checkoutAddressDistancePill.style.display = 'flex';
      const check = dataService.checkDeliveryAvailability(selectedAddr.lat, selectedAddr.lng);
      if (check.deliverable) {
        checkoutAddressDistancePill.className = 'checkout-address-distance-pill';
        if (checkoutDistDot) checkoutDistDot.className = 'distance-dot in-zone';
        if (checkoutDistText) checkoutDistText.innerHTML = `<strong>${check.distanceKm} km</strong> from kitchen • Ready for delivery`;
        if (btnPlaceOrderFinal) btnPlaceOrderFinal.disabled = false;
      } else {
        checkoutAddressDistancePill.className = 'checkout-address-distance-pill out-zone';
        if (checkoutDistDot) checkoutDistDot.className = 'distance-dot out-zone';
        if (check.reason === 'unpinned' || check.distanceKm === null) {
          if (checkoutDistText) checkoutDistText.innerHTML = '⚠️ <strong>Location not pinned</strong> • Click edit to pin on map';
        } else {
          if (checkoutDistText) checkoutDistText.innerHTML = `⚠️ <strong>${check.distanceKm} km</strong> • Outside our ${check.maxRadiusKm} km delivery zone`;
        }
        if (btnPlaceOrderFinal) btnPlaceOrderFinal.disabled = true;
      }
    }
  }

  function openCheckoutModalInternal() {
    renderCheckoutAddresses();
    if (modalCheckoutBackdrop) {
      modalCheckoutBackdrop.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
  }

  function openCheckoutModal() {
    // Check if cart is empty
    if (cart.length === 0) {
      showToast('Please add delicious food to your basket first!', 'warning');
      return;
    }

    // Mandatory Sign-in check
    if (!currentUser) {
      pendingCheckoutAfterAuth = true;
      openAuthModal();
      showToast('🔒 Please sign in before proceeding to checkout.', 'warning');
      return;
    }

    // Mandatory Address check
    const addresses = getCurrentAddresses();
    if (addresses.length === 0) {
      pendingCheckoutAfterAddress = true;
      openAddressModal();
      showToast('📍 Adding a delivery address is mandatory. Please pin your location on the map.', 'warning');
      return;
    }

    // Update order bill total from summaryTotal
    if (checkoutBillTotal && summaryTotal) {
      checkoutBillTotal.textContent = summaryTotal.textContent || '₹0';
    }

    // Reset payment selection to Cash on Delivery
    selectedCheckoutPayment = 'cod';
    if (radioPaymentCod) radioPaymentCod.checked = true;
    if (paymentCardCod) paymentCardCod.classList.add('selected');
    if (paymentCardOnline) paymentCardOnline.classList.remove('selected');
    if (checkoutBillPayment) checkoutBillPayment.textContent = 'Cash on Delivery (COD)';
    if (btnPlaceOrderLabel) btnPlaceOrderLabel.textContent = 'Place Order • Cash on Delivery';

    openCheckoutModalInternal();
    backNav.pushStep(
      'checkout-modal',
      () => closeCheckoutModalInternal(),
      () => openCheckoutModalInternal()
    );
  }

  function closeCheckoutModalInternal() {
    if (modalCheckoutBackdrop) {
      modalCheckoutBackdrop.classList.remove('open');
      document.body.style.overflow = '';
    }
  }

  function closeCheckoutModal() {
    if (backNav.isTopStep('checkout-modal')) {
      backNav.stepBack();
    } else {
      closeCheckoutModalInternal();
      backNav.removeStepDirect('checkout-modal');
    }
  }

  if (modalCheckoutClose) {
    modalCheckoutClose.addEventListener('click', closeCheckoutModal);
  }

  if (modalCheckoutBackdrop) {
    modalCheckoutBackdrop.addEventListener('click', (e) => {
      if (e.target === modalCheckoutBackdrop) closeCheckoutModal();
    });
  }

  // Add New Address triggers from inside checkout modal
  if (btnCheckoutAddAddr) {
    btnCheckoutAddAddr.addEventListener('click', () => {
      pendingCheckoutAfterAddress = true;
      closeCheckoutModalInternal();
      openAddressModal();
    });
  }

  if (btnCheckoutAddFirstAddr) {
    btnCheckoutAddFirstAddr.addEventListener('click', () => {
      pendingCheckoutAfterAddress = true;
      closeCheckoutModalInternal();
      openAddressModal();
    });
  }

  // Payment Selection Handlers
  if (paymentCardCod) {
    paymentCardCod.addEventListener('click', () => {
      selectedCheckoutPayment = 'cod';
      if (radioPaymentCod) radioPaymentCod.checked = true;
      paymentCardCod.classList.add('selected');
      if (paymentCardOnline) paymentCardOnline.classList.remove('selected');
      if (checkoutBillPayment) checkoutBillPayment.textContent = 'Cash on Delivery (COD)';
      if (btnPlaceOrderLabel) btnPlaceOrderLabel.textContent = 'Place Order • Cash on Delivery';
    });
  }

  if (paymentCardOnline) {
    paymentCardOnline.addEventListener('click', () => {
      showToast('💳 Online payment (UPI, Cards & NetBanking) will be available soon! Please pay via Cash on Delivery (COD).', 'info');
    });
  }

  // 1. "Proceed to Checkout" from Cart Basket Drawer -> Opens Checkout Modal
  if (btnCheckout) {
    btnCheckout.addEventListener('click', () => {
      // 0. Kitchen Master Store Open / Closed Check
      const settings = dataService.getSettings();
      if (settings.storeOpen === false || (typeof dataService.isStoreOpen === 'function' && !dataService.isStoreOpen())) {
        const closedMsg = settings.storeClosedReason || '🌙 The kitchen is currently closed for the night. We will reopen tomorrow at 11:00 AM!';
        showToast(closedMsg, 'warning');
        resetSubmitState();
        return;
      }

      // 1. Check if kitchen is in rush pause
      if (settings.isRushPaused && settings.pauseUntil && Date.now() < settings.pauseUntil) {
        const remainingMs = settings.pauseUntil - Date.now();
        const minsLeft = Math.ceil(remainingMs / 60000);
        showToast(`⚡ Kitchen Rush Alert: Orders are temporarily paused for another ${minsLeft} min${minsLeft === 1 ? '' : 's'}. You can still customize your basket!`, 'warning');
        return;
      }

      // 2. Check if cart is empty
      if (cart.length === 0) {
        showToast('Please add items to your basket before checkout!', 'warning');
        return;
      }

      // 2a. Check if any items in cart are Sold Out
      const allDishes = dataService.getDishes();
      const soldOutInCart = cart.find(item => {
        const dish = allDishes.find(d => d.id === item.id || d.name === item.name);
        return dish && dish.inStock === false;
      });
      if (soldOutInCart) {
        showToast(`⚠️ "${soldOutInCart.name}" is currently sold out. Please remove it from your basket before proceeding to checkout!`, 'warning');
        return;
      }

      // 2b. Check Minimum Order Value
      const minOrderVal = Number(settings.minOrderValue !== undefined ? settings.minOrderValue : (settings.minOrder !== undefined ? settings.minOrder : 0));
      const currentCartSubtotal = cart.reduce((acc, i) => acc + (i.price * i.quantity), 0);
      if (minOrderVal > 0 && currentCartSubtotal < minOrderVal) {
        const needed = Math.round(minOrderVal - currentCartSubtotal);
        showToast(`🛒 Minimum order value is ₹${minOrderVal}. Please add ₹${needed} more to proceed to checkout!`, 'warning');
        const meter = document.querySelector('.free-shipping-meter');
        if (meter) {
          meter.classList.remove('meter-shake');
          void meter.offsetWidth;
          meter.classList.add('meter-shake');
        }
        return;
      }

      // 3. MANDATORY SIGN-IN
      if (!currentUser) {
        pendingCheckoutAfterAuth = true;
        closeCartDrawerInternal();
        openAuthModal();
        showToast('🔒 Please sign in to continue to checkout.', 'warning');
        return;
      }

      // 4. ACTIVE ORDERS LIMIT CHECK
      const userPhone = getCurrentUserPhone();
      const userEmail = currentUser.email || '';
      const activeOrders = dataService.getCustomerActiveOrders(currentUser.id, userEmail, userPhone);
      const storeSettings = dataService.getSettings();
      const maxAllowed = storeSettings.maxActiveOrdersPerCustomer !== undefined ? storeSettings.maxActiveOrdersPerCustomer : 2;

      if (activeOrders.length >= maxAllowed) {
        const firstOrder = activeOrders[0];
        const activeIds = activeOrders.map(o => o.id).join(', ');
        showToast(`⚠️ Active Order Limit: You already have ${activeOrders.length} orders in progress (${activeIds}). You cannot place another order until your 1st order (${firstOrder.id}) is delivered!`, 'error');
        renderCartOrderLimitUI(activeOrders, maxAllowed);
        closeCartDrawerInternal();
        backNav.removeStepDirect('cart-drawer');
        openOrderModal(firstOrder.id, false);
        return;
      }

      // 5. MANDATORY DELIVERY ADDRESS CHECK
      const addresses = getCurrentAddresses();
      if (addresses.length === 0) {
        pendingCheckoutAfterAddress = true;
        closeCartDrawerInternal();
        openAddressModal();
        showToast('📍 Adding a delivery address is mandatory. Please pin your location on the map.', 'warning');
        return;
      }

      // All good -> Close cart drawer visually and open dedicated checkout modal!
      closeCartDrawerInternal();
      openCheckoutModal();
    });
  }

  // 2. Final "Place Order • Cash on Delivery" Action inside Checkout Modal
  let isSubmittingOrder = false;
  if (btnPlaceOrderFinal) {
    btnPlaceOrderFinal.addEventListener('click', async () => {
      if (isSubmittingOrder) return;
      isSubmittingOrder = true;
      btnPlaceOrderFinal.disabled = true;
      const originalBtnHtml = btnPlaceOrderFinal.innerHTML;
      btnPlaceOrderFinal.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting Order...';

      const resetSubmitState = () => {
        isSubmittingOrder = false;
        if (btnPlaceOrderFinal) {
          btnPlaceOrderFinal.disabled = false;
          btnPlaceOrderFinal.innerHTML = originalBtnHtml;
        }
      };

      try {
        // 0. Kitchen Master Store Open / Closed Check
        const settings = dataService.getSettings();
        if (settings.storeOpen === false || (typeof dataService.isStoreOpen === 'function' && !dataService.isStoreOpen())) {
          const closedMsg = settings.storeClosedReason || '🌙 The kitchen is currently closed for the night. We will reopen tomorrow at 11:00 AM!';
          showToast(closedMsg, 'warning');
          resetSubmitState();
          return;
        }

        // 1. Kitchen rush pause check
        if (settings.isRushPaused && settings.pauseUntil && Date.now() < settings.pauseUntil) {
          const remainingMs = settings.pauseUntil - Date.now();
          const minsLeft = Math.ceil(remainingMs / 60000);
          showToast(`⚡ Kitchen Rush Alert: Orders are temporarily paused for another ${minsLeft} min${minsLeft === 1 ? '' : 's'}.`, 'warning');
          resetSubmitState();
          return;
        }

        // 2. Cart empty check
        if (cart.length === 0) {
          showToast('Your basket is empty! Add items before placing order.', 'warning');
          closeCheckoutModal();
          resetSubmitState();
          return;
        }

        // 2b. Cart Sold Out Items Check
        const allDishes = dataService.getDishes();
        const soldOutInCart = cart.find(item => {
          const dish = allDishes.find(d => d.id === item.id || d.name === item.name);
          return dish && dish.inStock === false;
        });
        if (soldOutInCart) {
          showToast(`⚠️ "${soldOutInCart.name}" is currently sold out. Please remove it from your basket to place your order.`, 'warning');
          resetSubmitState();
          return;
        }

        // 3. Authenticated check
        if (!currentUser) {
          pendingCheckoutAfterAuth = true;
          closeCheckoutModalInternal();
          openAuthModal();
          resetSubmitState();
          return;
        }

        // 4. Address check
        const addresses = getCurrentAddresses();
        const selectedAddr = addresses.find(a => a.id === selectedAddressId) || addresses.find(a => a.isDefault) || addresses[0];
        if (!selectedAddr) {
          pendingCheckoutAfterAddress = true;
          closeCheckoutModalInternal();
          openAddressModal();
          showToast('📍 Please pin your delivery address to place your order.', 'warning');
          resetSubmitState();
          return;
        }

        // 4b. Mandatory Customer Contact Phone Check
        const customerContactPhone = (selectedAddr.phone || currentUser?.user_metadata?.phone || '').trim();
        const phoneDigits = customerContactPhone.replace(/\D/g, '');
        if (!customerContactPhone || phoneDigits.length < 10) {
          pendingCheckoutAfterAddress = true;
          closeCheckoutModalInternal();
          openAddressModal(selectedAddr.id);
          showToast('📞 Please provide a valid 10-digit mobile number so our delivery partner can reach you!', 'warning');
          resetSubmitState();
          return;
        }

        // 5. Store Delivery Radius Check
        const delivCheck = dataService.checkDeliveryAvailability(selectedAddr.lat, selectedAddr.lng);
        if (!delivCheck.deliverable) {
          if (delivCheck.reason === 'unpinned' || delivCheck.distanceKm === null) {
            showToast('📍 Please pin your delivery address location on the map so our kitchen can verify delivery distance!', 'warning');
            pendingCheckoutAfterAddress = true;
            closeCheckoutModalInternal();
            openAddressModal(selectedAddr.id);
            resetSubmitState();
            return;
          }
          showToast(`⚠️ Address is ${delivCheck.distanceKm} km away, which exceeds our ${delivCheck.maxRadiusKm} km delivery limit. Please select an address closer to our kitchen!`, 'error');
          resetSubmitState();
          return;
        }

        // 6. Active Orders Limit Check
        const userPhone = customerContactPhone || getCurrentUserPhone();
        const userEmail = currentUser.email || '';
        const storeSettings = dataService.getSettings();
        const maxAllowed = storeSettings.maxActiveOrdersPerCustomer !== undefined ? storeSettings.maxActiveOrdersPerCustomer : 2;

        let activeOrders = dataService.getCustomerActiveOrders(currentUser.id, userEmail, userPhone);
        if (activeOrders.length >= maxAllowed) {
          await dataService.syncCustomerOrdersFromSupabase(currentUser.id, userEmail, userPhone);
          activeOrders = dataService.getCustomerActiveOrders(currentUser.id, userEmail, userPhone);
        }

        if (activeOrders.length >= maxAllowed) {
          const firstOrder = activeOrders[0];
          const activeIds = activeOrders.map(o => o.id).join(', ');
          showToast(`⚠️ Active Order Limit: You already have ${activeOrders.length} orders in progress (${activeIds}). You cannot place another order until your 1st order (${firstOrder.id}) is delivered!`, 'error');
          closeCheckoutModal();
          renderCartOrderLimitUI(activeOrders, maxAllowed);
          openOrderModal(firstOrder.id, false);
          resetSubmitState();
          return;
        }

        // 7. PLACE ORDER WITH CASH ON DELIVERY (COD)
        const existingOrders = (typeof dataService !== 'undefined' && dataService.getOrders) ? dataService.getOrders() : [];
        const existingIds = new Set(existingOrders.map(o => o && o.id));
        let randomOrderNum = Math.floor(1000 + Math.random() * 9000);
        while (existingIds.has('#QB-' + randomOrderNum)) {
          randomOrderNum = Math.floor(1000 + Math.random() * 9000);
        }
        const newOrderId = '#QB-' + randomOrderNum;
        const pickupCode = randomOrderNum.toString();
        const itemsSummary = cart.map(i => `${i.quantity}x ${i.name}`).join(', ');
        const cartSubtotal = cart.reduce((sum, it) => sum + (Number(it.price) * Number(it.quantity)), 0);
        let calculatedTotal = cartSubtotal;
        if (appliedPromo && settings.offerActive !== false) {
          const discountType = settings.offerDiscountType || 'percent';
          const discountVal = discountType === 'flat' 
            ? Number(settings.offerDiscountAmount || 50) 
            : (cartSubtotal * Number(settings.offerDiscountPercent || 20) / 100);
          calculatedTotal = Math.max(0, cartSubtotal - discountVal);
        }

        // Safe delivery fee extraction: ensure summaryDelivery / checkoutDeliveryFee is safely resolved
        const checkoutDeliveryFee = (typeof summaryDelivery !== 'undefined' && summaryDelivery) 
          ? summaryDelivery 
          : document.getElementById('summary-delivery');
        const rawDeliveryFee = (checkoutDeliveryFee?.textContent && !checkoutDeliveryFee.textContent.includes('FREE'))
          ? (Number(checkoutDeliveryFee.textContent.replace(/\D/g, '')) || 0)
          : 0;
        calculatedTotal += rawDeliveryFee;
        const totalAmount = `₹${Math.round(calculatedTotal)}`;
        const customerAddressText = selectedAddr.details || selectedAddr.fullText || `${selectedAddr.flatNo}, ${selectedAddr.area}${selectedAddr.city ? ', ' + selectedAddr.city : ''}${selectedAddr.pincode ? ' - ' + selectedAddr.pincode : ''}`;
        const fullAddressText = `${selectedAddr.tag ? `[${selectedAddr.tag}] ` : ''}${customerAddressText} [Phone: ${customerContactPhone}]`;

        const newOrder = {
          id: newOrderId,
          pickupCode: pickupCode,
          createdAt: Date.now(),
          userId: currentUser.id || null,
          customerEmail: currentUser.email || '',
          customerName: selectedAddr.name || (currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || 'Savera Paradise Customer'),
          customerPhone: customerContactPhone,
          phone: customerContactPhone,
          customer_phone: customerContactPhone,
          deliveryAddress: fullAddressText,
          lat: Number(selectedAddr.lat),
          lng: Number(selectedAddr.lng),
          addressDetails: {
            tag: selectedAddr.tag,
            details: customerAddressText,
            flatNo: selectedAddr.flatNo,
            area: selectedAddr.area,
            city: selectedAddr.city,
            pincode: selectedAddr.pincode,
            phone: customerContactPhone,
            lat: Number(selectedAddr.lat),
            lng: Number(selectedAddr.lng),
            distanceKm: selectedAddr.distanceKm
          },
          paymentMethod: 'Cash on Delivery (COD)',
          paymentStatus: 'Cash on Delivery',
          stepIndex: 0,
          status: 'accepted',
          statusLabel: 'Accepted',
          eta: '25 - 35 Minutes',
          itemsSummary: itemsSummary,
          items: cart.map(i => ({ name: i.name, quantity: i.quantity, price: i.price })),
          total: totalAmount
        };

        // Request notification permission during the order placement user gesture if default (non-blocking)
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
          try {
            requestSystemNotificationPermission().catch(() => {});
          } catch {}
        }

        // Add new order to dataService & Supabase Cloud
        const addResult = await dataService.addOrder(newOrder);
        if (addResult && addResult.success === false) {
          const errMsg = addResult.error?.message || addResult.message || 'Database error';
          console.error('[Checkout]: addOrder failed:', errMsg);
          showToast(`❌ Could not submit order: ${errMsg}. Please try again.`, 'error');
          resetSubmitState();
          return;
        }

        // Track order ID in user session & storage
        try {
          const myIds = JSON.parse(localStorage.getItem('quickbite_my_order_ids') || '[]');
          if (!myIds.includes(newOrderId)) {
            myIds.push(newOrderId);
            localStorage.setItem('quickbite_my_order_ids', JSON.stringify(myIds));
          }
        } catch {}

        try {
          navigator.serviceWorker?.controller?.postMessage({
            type: 'TRACK_ORDERS',
            orderIds: [newOrderId]
          });
        } catch {}

        orders = dataService.getOrders();
        activeOrderId = newOrderId;

        closeCheckoutModalInternal();
        backNav.removeStepDirect('checkout-modal');
        backNav.removeStepDirect('cart-drawer');
        openOrderModal(newOrderId, true);

        // Clear cart after confirmed checkout
        cart = [];
        saveCart();
        renderCart();

        // Audio & Desktop Notification
        playNotificationSound('order_placed');
        updateAppBadge(1);
        showToast('🎉 Order placed successfully! Paying via Cash on Delivery.', 'success');
        sendSystemNotification({
          title: `🎉 Order ${newOrderId} Confirmed!`,
          body: `Total: ${totalAmount} • Kitchen has received your order and is reviewing it.`,
          tag: `order-${newOrderId}`,
          data: { orderId: newOrderId, url: '/' },
          onlyIfHidden: true
        });
        flashTabTitle(`🎉 ORDER CONFIRMED: ${newOrderId}`);
      } catch (submitErr) {
        console.error('[Checkout]: Uncaught error during order placement:', submitErr);
        showToast(`❌ Order submission issue: ${submitErr?.message || 'Please check your connection and try again'}.`, 'error');
      } finally {
        resetSubmitState();
      }
    });
  }

  // PWA Web App Download / Installation Buttons
  const btnDownloadApp = document.getElementById('btn-download-app');
  if (btnDownloadApp) setupAppDownloadButton(btnDownloadApp);

  const btnMobileDownloadApp = document.getElementById('btn-mobile-download-app');
  if (btnMobileDownloadApp) setupAppDownloadButton(btnMobileDownloadApp);

  if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeOrderModal);
  if (btnModalDone) btnModalDone.addEventListener('click', closeOrderModal);
  if (orderModalBackdrop) {
    orderModalBackdrop.addEventListener('click', (e) => {
      if (e.target === orderModalBackdrop) closeOrderModal();
    });
  }

  const btnOrderMore = document.getElementById('btn-order-more');
  if (btnOrderMore) {
    btnOrderMore.addEventListener('click', () => {
      closeOrderModal();
      const menuSec = document.getElementById('menu-section');
      if (menuSec) menuSec.scrollIntoView({ behavior: 'smooth' });
    });
  }

  // Verify if an order belongs to the currently active customer session or account
  function isOrderBelongingToCurrentCustomer(order) {
    return dataService.isOrderForCustomer(order, currentUser?.id, currentUser?.email || '', getCurrentUserPhone());
  }

  const CUSTOMER_ALERTED_STATUSES_KEY = 'quickbite_customer_alerted_statuses';

  function getCustomerAlertedMap() {
    try {
      const raw = localStorage.getItem(CUSTOMER_ALERTED_STATUSES_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function markCustomerAlerted(orderId, status) {
    if (!orderId || !status) return;
    try {
      const map = getCustomerAlertedMap();
      map[`${orderId}_${status}`] = Date.now();
      const now = Date.now();
      const entries = Object.entries(map).filter(([, ts]) => now - Number(ts || 0) < 7 * 24 * 60 * 60 * 1000);
      localStorage.setItem(CUSTOMER_ALERTED_STATUSES_KEY, JSON.stringify(Object.fromEntries(entries.slice(-100))));
    } catch {}
  }

  function hasCustomerBeenAlerted(orderId, status) {
    if (!orderId || !status) return false;
    try {
      const map = getCustomerAlertedMap();
      return Boolean(map[`${orderId}_${status}`]);
    } catch {
      return false;
    }
  }

  // Pre-seed any existing delivered or cancelled orders in local cache as acknowledged on startup
  // so opening/reloading the web app NEVER replays past delivery notifications!
  try {
    const initOrders = dataService.getOrders();
    if (Array.isArray(initOrders)) {
      initOrders.forEach(o => {
        if (o && o.id && (o.status === 'delivered' || o.status === 'cancelled')) {
          markCustomerAlerted(o.id, o.status);
        }
      });
    }
  } catch {}

  // Purge any stale order status sync payload in localStorage older than 10 minutes
  try {
    const rawSync = localStorage.getItem('quickbite_order_status_sync');
    if (rawSync) {
      const parsedSync = JSON.parse(rawSync);
      if (Date.now() - (parsedSync.timestamp || 0) > 10 * 60 * 1000) {
        localStorage.removeItem('quickbite_order_status_sync');
      }
    }
  } catch {}

  // Real-time synchronization when Admin updates orders, statuses, or settings
  function handleStorefrontOrderStatusSync(updatedData) {
    orders = dataService.getOrders();
    const orderId = updatedData?.orderId || updatedData?.order?.id;
    const order = orders.find(o => o.id === orderId);

    if (orderModalBackdrop && orderModalBackdrop.classList.contains('open')) {
      if (activeOrderId === orderId) {
        renderOrderTracker(activeOrderId);
      }
    }

    if (modalMyOrdersBackdrop && modalMyOrdersBackdrop.classList.contains('open')) {
      renderMyOrdersList();
    }

    renderCartOrderLimitUI();

    // 1. Account Ownership Guard: Only alert if order belongs to THIS customer!
    if (!order || !isOrderBelongingToCurrentCustomer(order)) {
      return;
    }

    // 2. Stale Order Age Guard: If order is older than 20 minutes and status is delivered or cancelled,
    // it is a past historical record! NEVER alert it to the customer on page reload, reconnect, or app launch!
    const orderAgeMs = order.createdAt ? (Date.now() - Number(order.createdAt)) : 0;
    if ((order.status === 'delivered' || order.status === 'cancelled') && orderAgeMs > 20 * 60 * 1000) {
      markCustomerAlerted(order.id, order.status);
      return;
    }

    // 3. Status Transition Guard: If previous status matches current status, no new transition occurred
    if (updatedData?.prevStatus && updatedData.prevStatus === order.status) {
      return;
    }

    // 4. Persistent Deduplication Guard: Check if this status was ALREADY alerted across any past or present session
    if (hasCustomerBeenAlerted(order.id, order.status)) {
      return;
    }

    // 5. In-Memory Rapid Burst Guard (catches simultaneous Storage + BroadcastChannel events)
    const statusAlertKey = `${order.id}-${order.status}`;
    if (!window.__orderAlertsSeen) window.__orderAlertsSeen = new Set();
    if (window.__orderAlertsSeen.has(statusAlertKey)) {
      return;
    }
    window.__orderAlertsSeen.add(statusAlertKey);
    setTimeout(() => {
      if (window.__orderAlertsSeen) window.__orderAlertsSeen.delete(statusAlertKey);
    }, 15000);

    // Permanently record as alerted in localStorage BEFORE triggering UI alert
    markCustomerAlerted(order.id, order.status);

    if (order.status !== 'delivered' && order.status !== 'cancelled') {
      updateAppBadge(1);
    }

    if (order.status === 'pending') {
      playNotificationSound('accepted');
      showToast(`⏳ Order ${order.id}: Awaiting kitchen confirmation...`, 'info');
    } else if (order.status === 'accepted') {
      playNotificationSound('accepted');
      showToast(`✅ Kitchen Update: Order ${order.id} has been accepted!`, 'info');
      sendSystemNotification({
        title: `✅ Order ${order.id} Accepted!`,
        body: `Kitchen is preparing your delicious meal!`,
        tag: `customer-accepted-${order.id}`,
        data: { orderId: order.id, url: '/' }
      });
      flashTabTitle(`✅ ACCEPTED: ${order.id}`);
    } else if (order.status === 'cooking') {
      playNotificationSound('cooking');
      showToast(`👨‍🍳 Kitchen Update: Order ${order.id} is being prepared!`, 'info');
      sendSystemNotification({
        title: `👨‍🍳 Order ${order.id} is Cooking!`,
        body: `Our chefs are frying your crispy chicken fresh!`,
        tag: `customer-cooking-${order.id}`,
        data: { orderId: order.id, url: '/' }
      });
      flashTabTitle(`👨‍🍳 COOKING: ${order.id}`);
    } else if (order.status === 'on_the_way') {
      playNotificationSound('on_the_way');
      showToast(`🛵 Rider Update: Order ${order.id} is out for delivery! ETA: ${order.eta}`, 'info');
      sendSystemNotification({
        title: `🛵 Order ${order.id} is on the way!`,
        body: `Your rider is on the way with your food. ETA: ${order.eta}`,
        tag: `customer-dispatched-${order.id}`,
        data: { orderId: order.id, url: '/' }
      });
      flashTabTitle(`🛵 ON THE WAY: ${order.id}`);
    } else if (order.status === 'delivered') {
      updateAppBadge(0);
      playNotificationSound('delivered');
      try {
        confetti({
          particleCount: 120,
          spread: 80,
          origin: { y: 0.6 }
        });
      } catch {}
      showToast(`🎉 Delivered: Order ${order.id} has arrived! Enjoy your meal! You can now place your next order.`, 'success');
      sendSystemNotification({
        title: `🎉 Order ${order.id} Delivered!`,
        body: `Your crispy feast has arrived! Bon Appétit!`,
        tag: `customer-delivered-${order.id}`,
        data: { orderId: order.id, url: '/' }
      });
      flashTabTitle(`🎉 DELIVERED: ${order.id}`);
    } else if (order.status === 'cancelled') {
      updateAppBadge(0);
      playNotificationSound('cancelled');
      const reasonSuffix = order.cancellationReason ? `: ${order.cancellationReason}` : '';
      showToast(`❌ Order Cancelled: Order ${order.id} was cancelled by kitchen${reasonSuffix}`, 'error');
      sendSystemNotification({
        title: `❌ Order ${order.id} Cancelled`,
        body: `Your order was cancelled by the kitchen.${reasonSuffix}`,
        tag: `customer-cancelled-${order.id}`,
        data: { orderId: order.id, url: '/' }
      });
      flashTabTitle(`❌ CANCELLED: ${order.id}`);
    }
  }

  // Cleanup previously attached listeners on HMR (prevents duplicate listeners in Vite dev server)
  if (window.__quickbite_storage_handler) {
    window.removeEventListener('storage', window.__quickbite_storage_handler);
  }
  if (window.__quickbite_data_changed_handler) {
    window.removeEventListener('quickbite_data_changed', window.__quickbite_data_changed_handler);
  }
  if (window.__quickbite_sync_channel) {
    try { window.__quickbite_sync_channel.close(); } catch {}
  }

  window.__quickbite_storage_handler = (e) => {
    if (e.key === 'quickbite_order_status_sync' && e.newValue) {
      try {
        const payload = JSON.parse(e.newValue);
        if (payload.timestamp && (Date.now() - Number(payload.timestamp) > 10 * 60 * 1000)) {
          return; // Ignore stale sync event older than 10 mins
        }
        handleStorefrontOrderStatusSync(payload);
      } catch {}
    }
    if (e.key === 'quickbite_orders' || e.key === 'quickbite_orders_sync_ping') {
      orders = dataService.getOrders();
      if (orderModalBackdrop && orderModalBackdrop.classList.contains('open')) {
        renderOrderTracker(activeOrderId);
      }
      if (modalMyOrdersBackdrop && modalMyOrdersBackdrop.classList.contains('open')) {
        renderMyOrdersList();
      }
      renderCartOrderLimitUI();
    }
    if (e.key === 'quickbite_settings' || e.key === 'quickbite_settings_sync') {
      updateStoreStatusUI();
      updateStoreOfferUI();
      renderCartOrderLimitUI();
      if (orderModalBackdrop && orderModalBackdrop.classList.contains('open') && activeOrderId) {
        renderOrderTracker(activeOrderId);
      }
      if (modalMyOrdersBackdrop && modalMyOrdersBackdrop.classList.contains('open')) {
        renderMyOrdersList();
      }
    }
    if (e.key === 'quickbite_dishes') {
      syncStorefrontCardsWithDataService();
    }
    if (e.key === 'quickbite_categories' || e.key === 'quickbite_category_images' || e.key === 'quickbite_categories_sync') {
      syncStorefrontCategories();
    }
    if (e.key === 'quickbite_user_addresses' || e.key === 'quickbite_addresses_sync') {
      renderCartAddresses();
      renderProfileAddresses();
      renderCheckoutAddresses();
    }
  };
  window.addEventListener('storage', window.__quickbite_storage_handler);

  window.__quickbite_data_changed_handler = (e) => {
    if (e.detail?.type === 'orders') {
      if (e.detail?.action === 'status_updated') {
        handleStorefrontOrderStatusSync(e.detail);
      } else {
        orders = dataService.getOrders();
        if (orderModalBackdrop && orderModalBackdrop.classList.contains('open')) {
          renderOrderTracker(activeOrderId);
        }
        if (modalMyOrdersBackdrop && modalMyOrdersBackdrop.classList.contains('open')) {
          renderMyOrdersList();
        }
      }
      renderCartOrderLimitUI();
    }
    if (e.detail?.type === 'settings') {
      updateStoreStatusUI();
      updateStoreOfferUI();
      renderCartOrderLimitUI();
      if (orderModalBackdrop && orderModalBackdrop.classList.contains('open') && activeOrderId) {
        renderOrderTracker(activeOrderId);
      }
      if (modalMyOrdersBackdrop && modalMyOrdersBackdrop.classList.contains('open')) {
        renderMyOrdersList();
      }
    }
    if (e.detail?.type === 'dishes') {
      syncStorefrontCardsWithDataService();
    }
    if (e.detail?.type === 'categories') {
      syncStorefrontCategories();
    }
    if (e.detail?.type === 'addresses') {
      renderCartAddresses();
      renderProfileAddresses();
      renderCheckoutAddresses();
    }
  };
  window.addEventListener('quickbite_data_changed', window.__quickbite_data_changed_handler);

  // Cross-tab broadcast channel for instantaneous zero-latency sync
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      window.__quickbite_sync_channel = new BroadcastChannel('quickbite_sync_channel');
      window.__quickbite_sync_channel.onmessage = (e) => {
        if (e.data?.type === 'settings') {
          updateStoreStatusUI();
          updateStoreOfferUI();
          renderCartOrderLimitUI();
          if (orderModalBackdrop && orderModalBackdrop.classList.contains('open') && activeOrderId) {
            renderOrderTracker(activeOrderId);
          }
          if (modalMyOrdersBackdrop && modalMyOrdersBackdrop.classList.contains('open')) {
            renderMyOrdersList();
          }
        } else if (e.data?.type === 'dishes') {
          syncStorefrontCardsWithDataService();
        } else if (e.data?.type === 'categories') {
          syncStorefrontCategories();
        } else if (e.data?.type === 'addresses') {
          renderCartAddresses();
          renderProfileAddresses();
          renderCheckoutAddresses();
        } else if (e.data?.type === 'orders') {
          if (e.data.action === 'status_updated') {
            handleStorefrontOrderStatusSync(e.data);
          } else {
            orders = dataService.getOrders();
            if (orderModalBackdrop && orderModalBackdrop.classList.contains('open')) {
              renderOrderTracker(activeOrderId);
            }
          }
        }
      };
    }
  } catch {}

  // Auto-refresh categories and dishes when user switches back to this tab from admin
  window.addEventListener('focus', () => {
    try {
      syncStorefrontCategories();
      syncStorefrontCardsWithDataService();
    } catch {}
  });

  // ==========================================
  // TOAST NOTIFICATION ENGINE (With Anti-Spam & Deduplication)
  // ==========================================
  const recentToasts = new Map();

  function showToast(message, type = 'info') {
    if (!toastContainer || !message) return;

    const cleanMsg = String(message).trim();
    const key = `${type}:${cleanMsg}`;
    const now = Date.now();
    const lastShown = recentToasts.get(key) || 0;

    // 1. Debounce rapid identical messages within 2 seconds
    if (now - lastShown < 2000) {
      return;
    }
    recentToasts.set(key, now);
    setTimeout(() => recentToasts.delete(key), 4000);

    // 2. Prevent stacking identical toasts if one is already currently visible
    const existingToasts = toastContainer.querySelectorAll('.toast');
    for (const t of existingToasts) {
      if (t.textContent.includes(cleanMsg)) {
        t.style.animation = 'none';
        void t.offsetHeight;
        t.style.animation = 'toast-slide 0.3s var(--ease-spring)';
        return;
      }
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = '🔔';
    if (type === 'success') icon = '✅';
    if (type === 'warning') icon = '⚠️';
    if (type === 'error') icon = '❌';

    toast.innerHTML = `<span>${icon}</span> <span>${escapeHtml(cleanMsg)}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // ==========================================
  // GOOGLE & SUPABASE AUTHENTICATION ENGINE
  // ==========================================
  // SUPABASE AUTH & USER PROFILE
  // ==========================================
  const authModalBackdrop = document.getElementById('auth-modal-backdrop');
  const authModalClose = document.getElementById('auth-modal-close');
  const authGuestView = document.getElementById('auth-guest-view');
  const authLoggedInView = document.getElementById('auth-logged-in-view');
  const authModalAvatar = document.getElementById('auth-modal-avatar');
  const authModalUserName = document.getElementById('auth-modal-user-name');
  const authModalUserEmail = document.getElementById('auth-modal-user-email');
  const authModalUserPhone = document.getElementById('auth-modal-user-phone');
  const btnModalSignOut = document.getElementById('btn-modal-sign-out');
  const btnGoogleSignin = document.getElementById('btn-google-signin');
  const btnGuestContinue = document.getElementById('btn-guest-continue');
  const authQuickNameForm = document.getElementById('auth-quick-name-form');
  const authInputName = document.getElementById('auth-input-name');
  const authInputPhone = document.getElementById('auth-input-phone');
  const btnLogin = document.getElementById('btn-login');
  const mobileLoginBtns = document.querySelectorAll('.mobile-login-btn');
  const userProfileMenu = document.getElementById('user-profile-menu');
  const btnUserProfile = document.getElementById('btn-user-profile');
  const userDropdownCard = document.getElementById('user-dropdown-card');
  const userAvatarImg = document.getElementById('user-avatar-img');
  const userAvatarLetter = document.getElementById('user-avatar-letter');
  const userDropAvatarImg = document.getElementById('user-drop-avatar-img');
  const userDropAvatarLetter = document.getElementById('user-drop-avatar-letter');
  const authModalLetter = document.getElementById('auth-modal-letter');
  const userNameText = document.getElementById('user-name-text');
  const userDropName = document.getElementById('user-drop-name');
  const userDropEmail = document.getElementById('user-drop-email');
  const btnSignOut = document.getElementById('btn-sign-out');
  const userGreetingTitle = document.getElementById('user-greeting-title');
  const userGreetingAvatarImg = document.getElementById('user-greeting-avatar-img');
  const userGreetingAvatarFallback = document.getElementById('user-greeting-avatar-fallback');
  const userGreetingWrap = document.querySelector('.user-greeting-wrap');
  const userAvatarStack = document.querySelector('.user-avatar-stack');

  // ==========================================
  // DELIVERY ADDRESS & MAP PINNING DOM ELEMENTS
  // ==========================================
  const modalAddressBackdrop = document.getElementById('modal-address-backdrop');
  const modalAddressCard = document.getElementById('modal-address-card');
  const modalAddressClose = document.getElementById('modal-address-close');
  const btnDetectGps = document.getElementById('btn-detect-gps');
  const btnDetectGpsText = document.getElementById('btn-detect-gps-text');
  const modalMapDistanceBadge = document.getElementById('modal-map-distance-badge');
  const modalDistanceDot = document.getElementById('modal-distance-dot');
  const modalDistanceText = document.getElementById('modal-distance-text');
  const formDeliveryAddress = document.getElementById('form-delivery-address');
  const addrInputLat = document.getElementById('addr-input-lat');
  const addrInputLng = document.getElementById('addr-input-lng');
  const addrInputTag = document.getElementById('addr-input-tag');
  const addrInputName = document.getElementById('addr-input-name');
  const addrInputPhone = document.getElementById('addr-input-phone');
  const addrInputFlat = document.getElementById('addr-input-flat');
  const addrInputArea = document.getElementById('addr-input-area');
  const addrInputCity = document.getElementById('addr-input-city');
  const addrInputPincode = document.getElementById('addr-input-pincode');
  const addrInputDefault = document.getElementById('addr-input-default');
  const addrTagPills = document.querySelectorAll('.addr-tag-pill');
  const addrInputDetails = document.getElementById('addr-input-details');
  const addrAutofillBadge = document.getElementById('addr-autofill-badge');
  const addrFieldHint = document.getElementById('addr-field-hint');

  if (addrInputDetails) {
    addrInputDetails.addEventListener('input', () => {
      if (addrAutofillBadge) {
        addrAutofillBadge.className = 'addr-autofill-badge edited';
        addrAutofillBadge.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Custom Address';
      }
    });
  }

  // Cart Delivery Section Elements
  const cartDeliverySection = document.getElementById('cart-delivery-section');
  const btnCartAddAddr = document.getElementById('btn-cart-add-addr');
  const cartAddrAuthPrompt = document.getElementById('cart-addr-auth-prompt');
  const btnCartPromptSignin = document.getElementById('btn-cart-prompt-signin');
  const cartAddrEmptyPrompt = document.getElementById('cart-addr-empty-prompt');
  const btnCartAddFirstAddr = document.getElementById('btn-cart-add-first-addr');
  const cartAddressesList = document.getElementById('cart-addresses-list');
  const cartAddressDistancePill = document.getElementById('cart-address-distance-pill');
  const cartDistDot = document.getElementById('cart-dist-dot');
  const cartDistText = document.getElementById('cart-dist-text');

  // Profile Addresses Elements
  const profileAddressesList = document.getElementById('profile-addresses-list');
  const btnProfileAddAddr = document.getElementById('btn-profile-add-addr');
  const dropLinkAddresses = document.getElementById('drop-link-addresses');
  const mobileNavAddresses = document.getElementById('mobile-nav-addresses');

  // Address and Map state
  let addressMap = null;
  let addressMarker = null;
  let currentAddressCoords = { lat: RESTAURANT_COORDINATES.lat, lng: RESTAURANT_COORDINATES.lng };
  let selectedAddressId = null;
  let pendingCheckoutAfterAuth = false;
  let pendingCheckoutAfterAddress = false;
  let activeEditingAddressId = null;
  let hasPinnedLocation = false; // Strictly tracks whether user has pinned on the map
  let hasDetectedLocation = false;
  let gpsWatchId = null;
  let bestGpsAccuracy = Infinity;
  let bestGpsCoords = null;
  let gpsSampleCount = 0;
  let gpsRefineTimeout = null;
  let accuracyCircle = null;
  let detectedAddressDetails = {
    flatNo: 'Pinned Doorstep',
    area: 'Ramanagara',
    city: 'Ramanagara',
    pincode: '',
    fullText: ''
  };

  function pulseDetectButton() {
    if (btnDetectGps) {
      btnDetectGps.classList.remove('btn-pulse-prompt');
      void btnDetectGps.offsetWidth;
      btnDetectGps.classList.add('btn-pulse-prompt');
      btnDetectGps.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function updateAccuracyCircle(lat, lng, accuracyMeters) {
    if (!addressMap) return;
    const rad = Math.max(accuracyMeters || 15, 6);
    if (!accuracyCircle) {
      accuracyCircle = L.circle([lat, lng], {
        radius: rad,
        color: '#FF5A26',
        weight: 1.5,
        opacity: 0.8,
        fillColor: '#FF5A26',
        fillOpacity: 0.12,
        dashArray: '4, 4'
      }).addTo(addressMap);
    } else {
      accuracyCircle.setLatLng([lat, lng]);
      accuracyCircle.setRadius(rad);
    }
  }

  function setDetectBtnRefinedUI(accuracy = null) {
    if (btnDetectGps) {
      btnDetectGps.classList.remove('detecting', 'btn-pulse-prompt');
      btnDetectGps.classList.add('refine');
      btnDetectGps.disabled = false;
    }
    const accStr = (accuracy && accuracy < 999) ? ` (±${accuracy}m)` : '';
    if (btnDetectGpsText) {
      btnDetectGpsText.innerHTML = `<i class="fa-solid fa-bullseye"></i> <strong>Tap to Refine Closer${accStr}</strong>`;
    }
    const helperTag = document.querySelector('.map-drag-helper-tag');
    if (helperTag) {
      helperTag.innerHTML = '<i class="fa-solid fa-arrows-up-down-left-right"></i> Drag pin or tap map to place directly on your doorstep / gate';
    }
  }

  function setDetectBtnSuccessUI() {
    setDetectBtnRefinedUI();
  }

  // Helper to update the live auto-detected address card in the modal
  function updateDetectedAddressUI(lat, lng, fullText = null, isReverseLoading = false) {
    const autoCard = document.getElementById('auto-detected-address-card');
    const autoTitle = document.getElementById('detected-addr-header-title');
    const autoDisplay = document.getElementById('detected-address-display');
    const autoSub = document.getElementById('detected-addr-sub');

    // Swiggy-Style Elements
    const swiggySheetAreaTitle = document.getElementById('swiggy-sheet-area-title');
    const swiggySheetFullAddr = document.getElementById('swiggy-sheet-full-addr');
    const swiggyCardLocalityText = document.getElementById('swiggy-card-locality-text');
    const swiggyDetailsTopbarTitle = document.getElementById('swiggy-details-topbar-title');

    const areaName = (detectedAddressDetails.area || '').split(',')[0].trim() || 'Current Location';
    const resolvedText = fullText || detectedAddressDetails.fullText || `Pinned Doorstep (${lat.toFixed(5)}, ${lng.toFixed(5)})`;

    if (swiggySheetAreaTitle) {
      swiggySheetAreaTitle.textContent = isReverseLoading ? 'Detecting area...' : (areaName || 'Pinned Area');
    }
    if (swiggySheetFullAddr) {
      swiggySheetFullAddr.textContent = isReverseLoading ? 'Resolving street & locality...' : resolvedText;
    }
    if (swiggyCardLocalityText) {
      swiggyCardLocalityText.textContent = resolvedText;
    }
    if (swiggyDetailsTopbarTitle) {
      swiggyDetailsTopbarTitle.textContent = areaName || 'Location Details';
    }

    if (!hasPinnedLocation && !hasDetectedLocation) {
      if (autoCard) autoCard.classList.add('unpinned');
      if (autoTitle) autoTitle.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i> Compulsory Step 1: Detect Location';
      if (autoDisplay) autoDisplay.textContent = 'Please press the "Detect My Location" button below the map first.';
      if (autoSub) autoSub.innerHTML = '<i class="fa-solid fa-circle-info"></i> Pinning and address will activate once location is detected.';
      return;
    }

    if (autoCard) autoCard.classList.remove('unpinned');
    if (isReverseLoading) {
      if (autoTitle) autoTitle.innerHTML = '<i class="fa-solid fa-location-dot"></i> Pinned Location (Fetching Address...):';
      if (autoDisplay) autoDisplay.textContent = `Resolving address for pin at ${lat.toFixed(5)}, ${lng.toFixed(5)}...`;
      if (addrAutofillBadge) {
        addrAutofillBadge.className = 'addr-autofill-badge';
        addrAutofillBadge.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Resolving Address...';
      }
    } else {
      if (autoTitle) autoTitle.innerHTML = '<i class="fa-solid fa-circle-check"></i> Exact Doorstep Location Pinned:';
      if (autoDisplay) autoDisplay.textContent = resolvedText;
      if (autoSub) autoSub.innerHTML = `<i class="fa-solid fa-route"></i> Coordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)} • Address auto-filled`;
      if (addrInputDetails) {
        addrInputDetails.value = resolvedText;
      }
      if (addrAutofillBadge) {
        addrAutofillBadge.className = 'addr-autofill-badge autofilled';
        addrAutofillBadge.innerHTML = '<i class="fa-solid fa-circle-check"></i> Auto-Filled from Pin';
      }
      if (addrFieldHint) {
        addrFieldHint.innerHTML = '<i class="fa-solid fa-circle-check" style="color:#15803D;"></i> Address auto-filled from map pin. You can edit or add flat/floor details above.';
      }
    }
  }

  function fallbackDetectedAddress(lat, lng) {
    detectedAddressDetails = {
      flatNo: 'Pinned Doorstep',
      area: 'Ramanagara',
      city: 'Ramanagara',
      pincode: '',
      fullText: `Pinned Doorstep (${(Number(lat) || 0).toFixed(5)}, ${(Number(lng) || 0).toFixed(5)})`
    };
    if (addrInputFlat) addrInputFlat.value = detectedAddressDetails.flatNo;
    if (addrInputArea) addrInputArea.value = detectedAddressDetails.area;
    if (addrInputCity) addrInputCity.value = detectedAddressDetails.city;
    if (addrInputPincode) addrInputPincode.value = detectedAddressDetails.pincode;
    updateDetectedAddressUI(lat, lng, detectedAddressDetails.fullText, false);
  }

  // Custom Animated Map Pin Icon for Leaflet fallback
  const customPinIcon = L.divIcon({
    className: 'custom-delivery-pin',
    html: '<div class="delivery-pin-marker"><div class="pin-pulse"></div><div class="pin-icon">📍</div></div>',
    iconSize: [42, 42],
    iconAnchor: [21, 38]
  });

  function isGoogleMapsAvailable() {
    return typeof window.google !== 'undefined' && typeof window.google.maps !== 'undefined';
  }

  // Parse Google Address Components into Area, City, and Pincode
  function parseGoogleAddressComponents(components) {
    if (!Array.isArray(components)) return;

    let sublocality = '';
    let route = '';
    let locality = '';
    let postalCode = '';

    components.forEach(c => {
      const types = c.types || [];
      if (types.includes('sublocality_level_1') || types.includes('sublocality') || types.includes('neighborhood')) {
        if (!sublocality) sublocality = c.long_name;
      } else if (types.includes('route') || types.includes('premise') || types.includes('street_address')) {
        if (!route) route = c.long_name;
      } else if (types.includes('locality') || types.includes('administrative_area_level_2')) {
        if (!locality) locality = c.long_name;
      } else if (types.includes('postal_code')) {
        postalCode = c.long_name;
      }
    });

    const areaText = [route, sublocality].filter(Boolean).join(', ') || sublocality || route;

    detectedAddressDetails = {
      flatNo: 'Pinned Doorstep',
      area: areaText || 'Ramanagara',
      city: locality || 'Ramanagara',
      pincode: postalCode || '',
      fullText: [areaText, locality, postalCode].filter(Boolean).join(', ')
    };

    if (addrInputFlat) addrInputFlat.value = detectedAddressDetails.flatNo;
    if (addrInputArea) addrInputArea.value = detectedAddressDetails.area;
    if (addrInputCity) addrInputCity.value = detectedAddressDetails.city;
    if (addrInputPincode) addrInputPincode.value = detectedAddressDetails.pincode;
    updateDetectedAddressUI(currentAddressCoords.lat, currentAddressCoords.lng, detectedAddressDetails.fullText, false);
  }

  async function fetchOsmNominatim(lat, lng) {
    // 0. Primary: Secure Serverless Ola Maps Proxy (Keeps API key 100% hidden on server)
    try {
      let olaData = null;
      try {
        const proxyRes = await fetch(`/api/ola-maps?action=reverse&lat=${lat}&lng=${lng}`, {
          headers: { 'Accept': 'application/json' }
        });
        if (proxyRes.ok) {
          olaData = await proxyRes.json();
        }
      } catch {}

      if (olaData && olaData.status === 'ok' && Array.isArray(olaData.results) && olaData.results.length > 0) {
        const top = olaData.results[0];
        const comps = top.address_components || [];

        let locality = '';
        let district = '';
        let sublocality = '';
        let neighborhood = '';
        let postalCode = '';
        let streetAddress = '';

        comps.forEach(c => {
          const types = c.types || [];
          if (types.includes('postal_code')) postalCode = c.long_name || c.short_name || '';
          else if (types.includes('neighborhood')) neighborhood = c.long_name || '';
          else if (types.includes('sublocality') || types.includes('sublocality_level_1')) sublocality = c.long_name || '';
          else if (types.includes('locality')) locality = c.long_name || '';
          else if (types.includes('administrative_area_level_2')) district = c.long_name || '';
          else if (types.includes('street_address') || types.includes('route')) streetAddress = c.long_name || '';
        });

        const premiseName = (top.name && top.name !== locality && top.name !== district) ? top.name : '';
        const areaParts = [streetAddress, neighborhood, sublocality].filter(Boolean);
        const areaText = areaParts.length > 0 ? [...new Set(areaParts)].join(', ') : (neighborhood || sublocality || 'Doorstep Area');
        const cityText = locality || district || 'Ramanagara';

        let fullFormatted = top.formatted_address || [premiseName, areaText, cityText, postalCode].filter(Boolean).join(', ');
        fullFormatted = fullFormatted.replace(/, India$/i, '').trim();

        detectedAddressDetails = {
          flatNo: premiseName || 'Pinned Doorstep',
          area: areaText,
          city: cityText,
          pincode: postalCode,
          fullText: fullFormatted
        };

        if (addrInputFlat) addrInputFlat.value = detectedAddressDetails.flatNo;
        if (addrInputArea) addrInputArea.value = detectedAddressDetails.area;
        if (addrInputCity) addrInputCity.value = detectedAddressDetails.city;
        if (addrInputPincode) addrInputPincode.value = detectedAddressDetails.pincode;

        updateDetectedAddressUI(lat, lng, detectedAddressDetails.fullText, false);
        return;
      }
    } catch (olaErr) {
      console.warn('Ola Maps reverse geocoding fallback:', olaErr);
    }
    try {
      // 1. Try BigDataCloud free client reverse geocoding (fast, never blocked by CORS/Referer)
      try {
        const bdcRes = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`);
        if (bdcRes.ok) {
          const bdcData = await bdcRes.json();
          if (bdcData) {
            const locality = bdcData.locality || bdcData.principalSubdivision || '';
            const city = bdcData.city || bdcData.locality || 'Ramanagara';
            const pincode = bdcData.postcode || '';
            const full = [locality, city, pincode].filter(Boolean).join(', ');
            if (full) {
              detectedAddressDetails = {
                flatNo: 'Pinned Doorstep',
                area: locality || 'Doorstep Area',
                city: city,
                pincode: pincode,
                fullText: full
              };
              if (addrInputFlat) addrInputFlat.value = detectedAddressDetails.flatNo;
              if (addrInputArea) addrInputArea.value = detectedAddressDetails.area;
              if (addrInputCity) addrInputCity.value = detectedAddressDetails.city;
              if (addrInputPincode) addrInputPincode.value = detectedAddressDetails.pincode;
              updateDetectedAddressUI(lat, lng, detectedAddressDetails.fullText, false);
              return;
            }
          }
        }
      } catch (bdcErr) {}

      // 2. Fallback to OpenStreetMap Nominatim
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`, {
        headers: { 'Accept-Language': 'en' }
      });
      if (!res.ok) {
        fallbackDetectedAddress(lat, lng);
        return;
      }
      const data = await res.json();
      if (!data || !data.address) {
        fallbackDetectedAddress(lat, lng);
        return;
      }

      const addr = data.address;
      const houseNo = addr.house_number || addr.building || '';
      const road = addr.road || addr.residential || addr.street || '';
      const suburb = addr.suburb || addr.neighbourhood || addr.quarter || addr.subdistrict || '';
      const city = addr.city || addr.town || addr.municipality || addr.village || addr.county || 'Ramanagara';
      const pincode = addr.postcode || '';

      const areaParts = [houseNo, road, suburb].filter(Boolean);
      const areaText = areaParts.length > 0 ? areaParts.join(', ') : (suburb || road || 'Doorstep Area');

      detectedAddressDetails = {
        flatNo: houseNo ? `House #${houseNo}` : 'Pinned Doorstep',
        area: areaText,
        city: city,
        pincode: pincode,
        fullText: [areaText, city, pincode].filter(Boolean).join(', ')
      };

      if (addrInputFlat) addrInputFlat.value = detectedAddressDetails.flatNo;
      if (addrInputArea) addrInputArea.value = detectedAddressDetails.area;
      if (addrInputCity) addrInputCity.value = detectedAddressDetails.city;
      if (addrInputPincode) addrInputPincode.value = detectedAddressDetails.pincode;

      updateDetectedAddressUI(lat, lng, detectedAddressDetails.fullText, false);
    } catch (e) {
      fallbackDetectedAddress(lat, lng);
    }
  }

  // Reverse Geocoding helper using OpenStreetMap Nominatim
  let reverseGeocodeTimer = null;
  function reverseGeocode(lat, lng) {
    if (reverseGeocodeTimer) clearTimeout(reverseGeocodeTimer);
    reverseGeocodeTimer = setTimeout(async () => {
      fetchOsmNominatim(lat, lng);
    }, 350);
  }

  // Update Map Position, Pin Marker & Distance Badge
  function updateMapLocation(lat, lng, doReverseGeocode = true, isUserPin = true) {
    if (isUserPin) {
      hasPinnedLocation = true;
    }
    currentAddressCoords = { lat, lng };
    if (addrInputLat) addrInputLat.value = lat.toFixed(6);
    if (addrInputLng) addrInputLng.value = lng.toFixed(6);

    if (addressMarker) {
      addressMarker.setLatLng([lat, lng]);
    }

    const check = dataService.checkDeliveryAvailability(lat, lng);
    if (modalMapDistanceBadge && modalDistanceText && modalDistanceDot) {
      if (hasPinnedLocation) {
        if (check.deliverable) {
          modalDistanceDot.className = 'distance-dot in-zone';
          modalDistanceText.innerHTML = `<strong>${check.distanceKm} km</strong> from kitchen • Within delivery zone`;
        } else {
          modalDistanceDot.className = 'distance-dot out-zone';
          modalDistanceText.innerHTML = `<strong>${check.distanceKm} km</strong> • Outside ${check.maxRadiusKm} km zone`;
        }
      } else {
        modalDistanceDot.className = 'distance-dot out-zone';
        modalDistanceText.innerHTML = `<strong>Compulsory:</strong> Please pin your location on map`;
      }
    }

    if (hasPinnedLocation) {
      updateDetectedAddressUI(lat, lng, null, true);
    } else {
      updateDetectedAddressUI(lat, lng, null, false);
    }

    if (doReverseGeocode && hasPinnedLocation) {
      reverseGeocode(lat, lng);
    }
  }

  let currentLayerType = 'street';
  let streetLayer = null;
  let satelliteLayer = null;
  let searchDebounceTimer = null;

  function initLeafletMap(mapContainer, lat, lng) {
    if (!addressMap) {
      addressMap = L.map('address-leaflet-map', {
        zoomControl: true,
        attributionControl: false
      }).setView([lat, lng], 16);

      // 1. Google Street Map: Standard roadmap with subdomains mt0-mt3 and locale parameters
      streetLayer = L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&hl=en&gl=IN', {
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        maxZoom: 20,
        attribution: '&copy; Google Maps'
      });

      // Resilient Auto-Failover: If mobile ISP or carrier blocks Google tiles, seamlessly switch to OpenStreetMap France (crisp white/grey, NO yellow!)
      let streetErrorCount = 0;
      streetLayer.on('tileerror', () => {
        streetErrorCount++;
        if (streetErrorCount >= 3 && !streetLayer._hasFailedOver) {
          streetLayer._hasFailedOver = true;
          console.warn('[Map] Mobile network issue loading Google tiles, falling back to high-speed OpenStreetMap France layer');
          const fallbackStreet = L.tileLayer('https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', {
            subdomains: ['a', 'b', 'c'],
            maxZoom: 20,
            attribution: '&copy; OpenStreetMap France'
          });
          if (addressMap && addressMap.hasLayer(streetLayer)) {
            addressMap.removeLayer(streetLayer);
            fallbackStreet.addTo(addressMap);
            streetLayer = fallbackStreet;
            addressMap.invalidateSize();
          }
        }
      });

      // 2. Google Satellite Hybrid: High-definition aerial photography with road & locality overlays
      satelliteLayer = L.tileLayer('https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}&hl=en&gl=IN', {
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        maxZoom: 20,
        attribution: '&copy; Google Maps'
      });

      // Satellite Fallback: Esri World Imagery (high-resolution photographic satellite, 100% reliable across all mobile devices)
      let satErrorCount = 0;
      satelliteLayer.on('tileerror', () => {
        satErrorCount++;
        if (satErrorCount >= 3 && !satelliteLayer._hasFailedOver) {
          satelliteLayer._hasFailedOver = true;
          console.warn('[Map] Google satellite connectivity issue, switching to Esri World Imagery');
          const fallbackSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
            attribution: 'Tiles &copy; Esri World Imagery'
          });
          if (addressMap && addressMap.hasLayer(satelliteLayer)) {
            addressMap.removeLayer(satelliteLayer);
            fallbackSat.addTo(addressMap);
            satelliteLayer = fallbackSat;
            addressMap.invalidateSize();
          }
        }
      });

      // Default active layer: Street
      streetLayer.addTo(addressMap);

      addressMarker = L.marker([lat, lng], {
        icon: customPinIcon,
        draggable: true
      }).addTo(addressMap);

      addressMarker.on('dragend', () => {
        hasDetectedLocation = true;
        hasPinnedLocation = true;
        const pos = addressMarker.getLatLng();
        setDetectBtnRefinedUI();
        if (accuracyCircle) {
          accuracyCircle.setLatLng(pos);
          accuracyCircle.setRadius(8);
        }
        updateMapLocation(pos.lat, pos.lng, true, true);
      });

      addressMap.on('click', (e) => {
        hasDetectedLocation = true;
        hasPinnedLocation = true;
        setDetectBtnRefinedUI();
        if (addressMarker) {
          addressMarker.setLatLng(e.latlng);
        }
        if (accuracyCircle) {
          accuracyCircle.setLatLng(e.latlng);
          accuracyCircle.setRadius(8);
        }
        updateMapLocation(e.latlng.lat, e.latlng.lng, true, true);
      });

      // Setup layer switch buttons [ Street | Satellite HD ]
      const btnStreet = document.getElementById('btn-layer-street');
      const btnSat = document.getElementById('btn-layer-sat');

      if (btnStreet && btnSat) {
        btnStreet.addEventListener('click', (e) => {
          e.stopPropagation();
          if (currentLayerType === 'street') return;
          currentLayerType = 'street';
          btnStreet.classList.add('active');
          btnSat.classList.remove('active');
          if (addressMap.hasLayer(satelliteLayer)) {
            addressMap.removeLayer(satelliteLayer);
          }
          streetLayer.addTo(addressMap);
        });

        btnSat.addEventListener('click', (e) => {
          e.stopPropagation();
          if (currentLayerType === 'satellite') return;
          currentLayerType = 'satellite';
          btnSat.classList.add('active');
          btnStreet.classList.remove('active');
          if (addressMap.hasLayer(streetLayer)) {
            addressMap.removeLayer(streetLayer);
          }
          satelliteLayer.addTo(addressMap);
        });
      }

      // Setup live autocomplete address search
      setupAddressSearch();
    } else {
      addressMap.setView([lat, lng], 16);
      if (addressMarker) {
        addressMarker.setLatLng([lat, lng]);
      }
    }

    setTimeout(() => {
      if (addressMap) {
        addressMap.invalidateSize();
      }
    }, 250);
  }

  function setupAddressSearch() {
    const searchInput = document.getElementById('map-address-search-input');
    const suggestionsBox = document.getElementById('map-search-suggestions');
    if (!searchInput || !suggestionsBox) return;

    searchInput.addEventListener('input', () => {
      const query = searchInput.value.trim();
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);

      if (query.length < 2) {
        suggestionsBox.classList.remove('open');
        suggestionsBox.innerHTML = '';
        return;
      }

      searchDebounceTimer = setTimeout(async () => {
        try {
          let items = [];

          // 1. Try Ola Maps Places Autocomplete first (high-precision Indian places & landmarks)
          try {
            let olaData = null;
            try {
              const proxyRes = await fetch(`/api/ola-maps?action=autocomplete&input=${encodeURIComponent(query)}`);
              if (proxyRes.ok) olaData = await proxyRes.json();
            } catch {}



            if (olaData && Array.isArray(olaData.predictions) && olaData.predictions.length > 0) {
              items = olaData.predictions.slice(0, 5).map((p, idx) => {
                const title = p.structured_formatting?.main_text || p.description || 'Location';
                const sub = p.structured_formatting?.secondary_text || '';
                return {
                  idx,
                  title,
                  sub,
                  full: p.description || title,
                  lat: p.geometry?.location?.lat,
                  lng: p.geometry?.location?.lng,
                  isOla: true
                };
              }).filter(it => it.lat && it.lng);
            }
          } catch (olaSearchErr) {
            console.warn('Ola autocomplete error, falling back:', olaSearchErr);
          }

          // 2. Fallback to Photon/Komoot if Ola Maps returns no results
          if (items.length === 0) {
            try {
              const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lat=12.720611&lon=77.286833&limit=5`;
              const res = await fetch(url);
              if (res.ok) {
                const data = await res.json();
                const features = data.features || [];
                items = features.map((item, idx) => {
                  const p = item.properties || {};
                  const [lon, lat] = item.geometry.coordinates;
                  return {
                    idx,
                    title: p.name || p.street || p.district || 'Location',
                    sub: [p.district, p.city, p.state, p.postcode].filter(Boolean).join(', '),
                    full: [p.name, p.street, p.district, p.city, p.postcode].filter(Boolean).join(', '),
                    lat,
                    lng: lon,
                    isOla: false
                  };
                });
              }
            } catch {}
          }

          if (items.length === 0) {
            suggestionsBox.innerHTML = `
              <div class="map-search-item" style="cursor: default; color: #9CA3AF;">
                <i class="fa-solid fa-location-dot"></i>
                <div class="map-search-item-info">
                  <span class="map-search-item-title">No matching locations found</span>
                  <span class="map-search-item-sub">Try searching an area or drag pin on map</span>
                </div>
              </div>
            `;
            suggestionsBox.classList.add('open');
            return;
          }

          suggestionsBox.innerHTML = items.map((item, idx) => {
            const title = escapeHtml(item.title || 'Location');
            const sub = escapeHtml(item.sub || '');
            return `
              <div class="map-search-item" data-idx="${parseInt(idx) || 0}">
                <i class="fa-solid fa-location-dot" style="color: #E11D48;"></i>
                <div class="map-search-item-info">
                  <span class="map-search-item-title">${title}</span>
                  ${sub ? `<span class="map-search-item-sub">${sub}</span>` : ''}
                </div>
              </div>
            `;
          }).join('');
          suggestionsBox.classList.add('open');

          suggestionsBox.querySelectorAll('.map-search-item').forEach(el => {
            el.addEventListener('click', () => {
              const idx = parseInt(el.getAttribute('data-idx'));
              if (!isNaN(idx) && items[idx]) {
                const sel = items[idx];
                const lat = Number(sel.lat);
                const lon = Number(sel.lng);
                if (!lat || !lon) return;

                hasPinnedLocation = true;
                if (addressMap) {
                  addressMap.flyTo([lat, lon], 17, { duration: 1.2 });
                  if (addressMarker) addressMarker.setLatLng([lat, lon]);
                }
                updateMapLocation(lat, lon, true, true);
                searchInput.value = sel.title || sel.full;
                suggestionsBox.classList.remove('open');
              }
            });
          });
        } catch (e) {
          console.warn('Address search error:', e);
        }
      }, 300);
    });

    document.addEventListener('click', (e) => {
      if (!searchInput.contains(e.target) && !suggestionsBox.contains(e.target)) {
        suggestionsBox.classList.remove('open');
      }
    });
  }

  // Initialize or Re-center Interactive Map
  function initOrUpdateAddressMap(lat, lng) {
    lat = Number(lat) || RESTAURANT_COORDINATES.lat;
    lng = Number(lng) || RESTAURANT_COORDINATES.lng;

    const mapContainer = document.getElementById('address-leaflet-map');
    if (!mapContainer) return;

    initLeafletMap(mapContainer, lat, lng);
    updateMapLocation(lat, lng, false, hasPinnedLocation);

    // Invalidate size across the modal opening animation lifecycle to guarantee tile render
    const addressCard = document.querySelector('.modal-address-card');
    if (addressCard && !addressCard._hasTransitionEndListener) {
      addressCard._hasTransitionEndListener = true;
      addressCard.addEventListener('transitionend', () => {
        if (addressMap) addressMap.invalidateSize();
      });
    }
    requestAnimationFrame(() => {
      if (addressMap) addressMap.invalidateSize();
    });
    setTimeout(() => {
      if (addressMap) {
        addressMap.invalidateSize();
        addressMap.setView([lat, lng], addressMap.getZoom() || 16);
      }
    }, 150);
    setTimeout(() => {
      if (addressMap) {
        addressMap.invalidateSize();
      }
    }, 350);
    setTimeout(() => {
      if (addressMap) {
        addressMap.invalidateSize();
      }
    }, 600);

    if (!window._addressMapResizeListenerAdded) {
      window._addressMapResizeListenerAdded = true;
      window.addEventListener('resize', () => {
        if (addressMap && modalAddressBackdrop?.classList.contains('open')) {
          addressMap.invalidateSize();
        }
      }, { passive: true });
    }
  }

  // Open Interactive Address Pinning Modal
  function openAddressModal(editId = null) {
    if (!currentUser) {
      pendingCheckoutAfterAuth = true;
      openAuthModal();
      showToast('🔒 Please sign in before adding a delivery address', 'info');
      return;
    }

    activeEditingAddressId = editId;
    if (gpsWatchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(gpsWatchId);
      gpsWatchId = null;
    }
    if (gpsRefineTimeout) {
      clearTimeout(gpsRefineTimeout);
      gpsRefineTimeout = null;
    }
    if (accuracyCircle && addressMap) {
      addressMap.removeLayer(accuracyCircle);
      accuracyCircle = null;
    }
    const addresses = getCurrentAddresses();
    const existing = editId ? addresses.find(a => a.id === editId) : null;

    const swiggyStepMap = document.getElementById('swiggy-step-map');
    const swiggyStepForm = document.getElementById('swiggy-step-form');
    if (swiggyStepMap) swiggyStepMap.style.display = 'flex';
    if (swiggyStepForm) swiggyStepForm.style.display = 'none';

    const swiggyInputFlat = document.getElementById('swiggy-input-flat');
    const swiggyInputFloor = document.getElementById('swiggy-input-floor');
    const swiggyInputStreet = document.getElementById('swiggy-input-street');
    const swiggySaveAsInput = document.getElementById('swiggy-save-as-input');
    const swiggyAccountDetailsPreview = document.getElementById('swiggy-account-details-preview');

    const userName = (currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || 'Customer').trim();
    const userPhone = (currentUser.user_metadata?.phone || '').trim();
    const userPhoneDigits = (userPhone || '').replace(/\D/g, '').slice(-10);
    const existingPhoneDigits = (existing?.phone || '').replace(/\D/g, '').slice(-10);
    const initialPhone = existingPhoneDigits || userPhoneDigits || '';

    if (swiggyAccountDetailsPreview) {
      swiggyAccountDetailsPreview.textContent = initialPhone ? `${userName}, +91 ${initialPhone}` : `${userName} (No mobile saved)`;
    }
    if (addrInputName) addrInputName.value = existing ? existing.name : userName;
    if (addrInputPhone) addrInputPhone.value = initialPhone;

    if (existing) {
      hasPinnedLocation = true;
      hasDetectedLocation = true;
      setDetectBtnSuccessUI();
      detectedAddressDetails = {
        flatNo: existing.flatNo || 'Pinned Doorstep',
        area: existing.area || 'Ramanagara',
        city: existing.city || 'Ramanagara',
        pincode: existing.pincode || '',
        fullText: [existing.flatNo, existing.area, existing.city, existing.pincode].filter(Boolean).join(', ')
      };
      if (swiggyInputFlat) swiggyInputFlat.value = existing.flatNo || '';
      if (swiggyInputFloor) swiggyInputFloor.value = existing.floor || '';
      if (swiggyInputStreet) swiggyInputStreet.value = existing.street || '';
      if (swiggySaveAsInput) swiggySaveAsInput.value = existing.tag || 'Home';
      if (addrInputFlat) addrInputFlat.value = detectedAddressDetails.flatNo;
      if (addrInputArea) addrInputArea.value = detectedAddressDetails.area;
      if (addrInputCity) addrInputCity.value = detectedAddressDetails.city;
      if (addrInputPincode) addrInputPincode.value = detectedAddressDetails.pincode;
      updateDetectedAddressUI(existing.lat, existing.lng, detectedAddressDetails.fullText, false);
    } else {
      hasPinnedLocation = false;
      hasDetectedLocation = false;
      if (btnDetectGps) {
        btnDetectGps.classList.remove('detected', 'btn-pulse-prompt');
      }
      if (btnDetectGpsText) {
        btnDetectGpsText.textContent = 'Current location';
      }
      if (swiggyInputFlat) swiggyInputFlat.value = '';
      if (swiggyInputFloor) swiggyInputFloor.value = '';
      if (swiggyInputStreet) swiggyInputStreet.value = '';
      if (swiggySaveAsInput) swiggySaveAsInput.value = 'House';
      detectedAddressDetails = {
        flatNo: 'Pinned Doorstep',
        area: 'Ramanagara',
        city: 'Ramanagara',
        pincode: '',
        fullText: ''
      };
      if (addrInputFlat) addrInputFlat.value = '';
      if (addrInputArea) addrInputArea.value = '';
      if (addrInputCity) addrInputCity.value = 'Ramanagara';
      if (addrInputPincode) addrInputPincode.value = '';
      if (addrInputDetails) addrInputDetails.value = '';
      updateDetectedAddressUI(RESTAURANT_COORDINATES.lat, RESTAURANT_COORDINATES.lng, null, false);
    }

    if (addrInputDefault) {
      addrInputDefault.checked = existing ? Boolean(existing.isDefault) : (addresses.length === 0);
    }

    const tagToSet = existing ? existing.tag : 'Home';
    if (addrInputTag) addrInputTag.value = tagToSet;
    addrTagPills.forEach(p => {
      p.classList.toggle('active', p.getAttribute('data-tag') === tagToSet);
    });

    const lat = existing ? existing.lat : RESTAURANT_COORDINATES.lat;
    const lng = existing ? existing.lng : RESTAURANT_COORDINATES.lng;

    if (modalAddressBackdrop) {
      modalAddressBackdrop.classList.add('open');
      document.body.style.overflow = 'hidden';
      backNav.pushStep(
        'address-modal',
        () => closeAddressModalInternal(),
        () => openAddressModalInternal()
      );
    }

    initOrUpdateAddressMap(lat, lng);
  }

  function openAddressModalInternal() {
    if (modalAddressBackdrop) {
      modalAddressBackdrop.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
  }

  function closeAddressModalInternal() {
    if (modalAddressBackdrop) {
      modalAddressBackdrop.classList.remove('open');
      document.body.style.overflow = '';
    }
    activeEditingAddressId = null;
  }

  function closeAddressModal() {
    if (backNav.isTopStep('address-modal')) {
      backNav.stepBack();
    } else {
      closeAddressModalInternal();
      backNav.removeStepDirect('address-modal');
    }
  }

  if (modalAddressClose) modalAddressClose.addEventListener('click', closeAddressModal);
  const btnDetailsCloseModal = document.getElementById('btn-details-close-modal');
  if (btnDetailsCloseModal) btnDetailsCloseModal.addEventListener('click', closeAddressModal);

  // SWIGGY STEP 1 -> STEP 2 (Confirm & Proceed)
  const btnProceedToDetails = document.getElementById('btn-proceed-to-details');
  if (btnProceedToDetails) {
    btnProceedToDetails.addEventListener('click', () => {
      if (!hasPinnedLocation) {
        hasPinnedLocation = true;
        hasDetectedLocation = true;
        const center = addressMap ? addressMap.getCenter() : RESTAURANT_COORDINATES;
        updateMapLocation(center.lat, center.lng, true, true);
      }

      const lat = Number(addrInputLat?.value) || currentAddressCoords.lat || RESTAURANT_COORDINATES.lat;
      const lng = Number(addrInputLng?.value) || currentAddressCoords.lng || RESTAURANT_COORDINATES.lng;
      const check = dataService.checkDeliveryAvailability(lat, lng);
      if (!check.deliverable) {
        showToast(`⚠️ Location is ${check.distanceKm} km away, exceeding our ${check.maxRadiusKm} km delivery limit. Please pin closer!`, 'error');
        return;
      }

      const swiggyStepMap = document.getElementById('swiggy-step-map');
      const swiggyStepForm = document.getElementById('swiggy-step-form');
      if (swiggyStepMap) swiggyStepMap.style.display = 'none';
      if (swiggyStepForm) swiggyStepForm.style.display = 'block';

      const areaName = (detectedAddressDetails.area || '').split(',')[0].trim() || 'Location Details';
      const swiggyDetailsTopbarTitle = document.getElementById('swiggy-details-topbar-title');
      if (swiggyDetailsTopbarTitle) swiggyDetailsTopbarTitle.textContent = areaName;

      const swiggyCardLocalityText = document.getElementById('swiggy-card-locality-text');
      if (swiggyCardLocalityText) swiggyCardLocalityText.textContent = detectedAddressDetails.fullText || 'Pinned Doorstep, Ramanagara';

      const swiggyInputFlat = document.getElementById('swiggy-input-flat');
      if (swiggyInputFlat && !swiggyInputFlat.value) {
        setTimeout(() => swiggyInputFlat.focus(), 150);
      }
    });
  }

  // SWIGGY STEP 2 -> STEP 1 (Back to Map)
  function backToMapStep() {
    const swiggyStepMap = document.getElementById('swiggy-step-map');
    const swiggyStepForm = document.getElementById('swiggy-step-form');
    if (swiggyStepForm) swiggyStepForm.style.display = 'none';
    if (swiggyStepMap) swiggyStepMap.style.display = 'flex';
    setTimeout(() => {
      if (addressMap) addressMap.invalidateSize();
    }, 100);
  }

  const btnBackToMap = document.getElementById('btn-back-to-map');
  const btnEditLocality = document.getElementById('btn-edit-locality');
  if (btnBackToMap) btnBackToMap.addEventListener('click', backToMapStep);
  if (btnEditLocality) btnEditLocality.addEventListener('click', backToMapStep);

  // SWIGGY TAG CHIPS (House, Office, Other)
  document.querySelectorAll('.swiggy-tag-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.swiggy-tag-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const tag = chip.getAttribute('data-tag');
      if (addrInputTag) addrInputTag.value = tag;
      const swiggySaveAsInput = document.getElementById('swiggy-save-as-input');
      if (swiggySaveAsInput) {
        swiggySaveAsInput.value = tag === 'Home' ? 'House' : (tag === 'Work' ? 'Office' : 'Other');
      }
    });
  });

  // SWIGGY RECEIVER "Use my account details" Toggle
  const swiggyUseAccountCheckbox = document.getElementById('swiggy-use-account-checkbox');
  const swiggyCustomContactFields = document.getElementById('swiggy-custom-contact-fields');
  if (swiggyUseAccountCheckbox && swiggyCustomContactFields) {
    swiggyUseAccountCheckbox.addEventListener('change', () => {
      if (swiggyUseAccountCheckbox.checked) {
        swiggyCustomContactFields.style.display = 'none';
        if (addrInputName) addrInputName.required = false;
      } else {
        swiggyCustomContactFields.style.display = 'block';
        if (addrInputName) {
          addrInputName.required = true;
          setTimeout(() => addrInputName.focus(), 100);
        }
      }
    });
  }

  // Live validation and sync on Mobile Number input
  if (addrInputPhone) {
    addrInputPhone.addEventListener('input', () => {
      addrInputPhone.value = addrInputPhone.value.replace(/\D/g, '').slice(0, 10);
      const digits = addrInputPhone.value;
      const userName = (currentUser?.user_metadata?.full_name || currentUser?.user_metadata?.name || 'Customer').trim();
      const swiggyAccountDetailsPreview = document.getElementById('swiggy-account-details-preview');
      if (swiggyAccountDetailsPreview) {
        swiggyAccountDetailsPreview.textContent = digits.length >= 10 
          ? `${userName}, +91 ${digits}` 
          : (digits.length > 0 ? `${userName}, +91 ${digits}...` : `${userName} (No mobile saved)`);
      }
    });
  }

  // SWIGGY PHOTO ATTACHMENT
  const swiggyPhotoDropBox = document.getElementById('swiggy-photo-drop-box');
  const swiggyDoorPhotoInput = document.getElementById('swiggy-door-photo-input');
  const swiggyPhotoPreviewWrap = document.getElementById('swiggy-photo-preview-wrap');
  const swiggyPhotoPreviewName = document.getElementById('swiggy-photo-preview-name');
  if (swiggyPhotoDropBox && swiggyDoorPhotoInput) {
    swiggyPhotoDropBox.addEventListener('click', () => swiggyDoorPhotoInput.click());
    swiggyDoorPhotoInput.addEventListener('change', () => {
      const file = swiggyDoorPhotoInput.files?.[0];
      if (file && swiggyPhotoPreviewWrap && swiggyPhotoPreviewName) {
        swiggyPhotoPreviewName.textContent = `✓ Attached: ${file.name}`;
        swiggyPhotoPreviewWrap.style.display = 'block';
      }
    });
  }
  if (modalAddressBackdrop) {
    modalAddressBackdrop.addEventListener('click', (e) => {
      if (e.target === modalAddressBackdrop) closeAddressModal();
    });
  }

  // GPS Multi-Sampling Dual-Pass Progressive Engine
  if (btnDetectGps) {
    btnDetectGps.addEventListener('click', () => {
      if (!navigator.geolocation) {
        showToast('Geolocation is not supported by your browser', 'warning');
        return;
      }

      // Clean up any in-flight watch or timer
      if (gpsWatchId !== null) {
        navigator.geolocation.clearWatch(gpsWatchId);
        gpsWatchId = null;
      }
      if (gpsRefineTimeout) {
        clearTimeout(gpsRefineTimeout);
        gpsRefineTimeout = null;
      }

      gpsSampleCount = 0;
      bestGpsAccuracy = Infinity;
      bestGpsCoords = null;

      btnDetectGps.classList.remove('detected', 'refine', 'btn-pulse-prompt');
      btnDetectGps.classList.add('detecting');
      if (btnDetectGpsText) {
        btnDetectGpsText.innerHTML = '<i class="fa-solid fa-satellite-dish fa-spin"></i> Locking GPS Satellites...';
      }
      const helperTag = document.querySelector('.map-drag-helper-tag');
      if (helperTag) {
        helperTag.innerHTML = '<i class="fa-solid fa-crosshairs fa-spin"></i> Refining doorstep accuracy from satellites...';
      }

      const applyGpsFix = (pos, isFinal = false) => {
        const userLat = pos.coords.latitude;
        const userLng = pos.coords.longitude;
        const accuracy = Math.round(pos.coords.accuracy || 100);

        hasDetectedLocation = true;
        hasPinnedLocation = true;

        if (addressMap) {
          // Zoom close in Street view (zoom level 19) for exact building/doorstep
          addressMap.flyTo([userLat, userLng], 19, { duration: 0.8 });
          if (addressMarker) addressMarker.setLatLng([userLat, userLng]);
          addressMap.invalidateSize();
        }
        updateMapLocation(userLat, userLng, true, true);
        updateAccuracyCircle(userLat, userLng, accuracy);

        if (isFinal) {
          setDetectBtnRefinedUI(accuracy);
        } else {
          if (btnDetectGpsText) {
            btnDetectGpsText.innerHTML = `<i class="fa-solid fa-crosshairs fa-spin"></i> Refining Doorstep (±${accuracy}m)...`;
          }
        }
      };

      gpsWatchId = navigator.geolocation.watchPosition(
        (pos) => {
          gpsSampleCount++;
          const acc = Math.round(pos.coords.accuracy || 100);

          if (acc <= bestGpsAccuracy || !bestGpsCoords) {
            bestGpsAccuracy = acc;
            bestGpsCoords = pos;
            applyGpsFix(pos, false);
          }

          // If we reach fine doorstep precision (<= 12m) after at least 2 samples, finalize immediately
          if (acc <= 12 && gpsSampleCount >= 2) {
            if (gpsWatchId !== null) {
              navigator.geolocation.clearWatch(gpsWatchId);
              gpsWatchId = null;
            }
            if (gpsRefineTimeout) {
              clearTimeout(gpsRefineTimeout);
              gpsRefineTimeout = null;
            }
            applyGpsFix(pos, true);
            showToast(`🎯 Doorstep locked within ±${acc}m! Tap "Refine Closer" or drag pin to gate.`, 'success');
          }
        },
        (err) => {
          if (bestGpsCoords) {
            applyGpsFix(bestGpsCoords, true);
            return;
          }
          btnDetectGps.classList.remove('detecting');
          if (btnDetectGpsText) btnDetectGpsText.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i> Detect My Location';
          console.warn('Geolocation error:', err);
          showToast('Could not access GPS. Please type your delivery address in the box below!', 'info');
          if (addrAutofillBadge) {
            addrAutofillBadge.className = 'addr-autofill-badge manual';
            addrAutofillBadge.innerHTML = '<i class="fa-solid fa-keyboard"></i> Type Address Below';
          }
          if (addrFieldHint) {
            addrFieldHint.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color:#D97706;"></i> GPS not detected. Please type your complete delivery address below.';
          }
          if (addrInputDetails) {
            addrInputDetails.focus();
          }
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );

      // Progressive sample window: after 3.8s, settle on best GPS reading obtained
      gpsRefineTimeout = setTimeout(() => {
        if (gpsWatchId !== null) {
          navigator.geolocation.clearWatch(gpsWatchId);
          gpsWatchId = null;
        }
        if (bestGpsCoords) {
          applyGpsFix(bestGpsCoords, true);
          showToast(`📍 Doorstep located (±${bestGpsAccuracy}m). Tap "Refine Closer" or drag pin to gate!`, 'success');
        } else {
          btnDetectGps.classList.remove('detecting');
          if (btnDetectGpsText) btnDetectGpsText.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i> Detect My Location';
        }
      }, 3800);
    });
  }

  // Address Tag Selection Pills (Home, Work, Other)
  addrTagPills.forEach(pill => {
    pill.addEventListener('click', () => {
      addrTagPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const tag = pill.getAttribute('data-tag');
      if (addrInputTag) addrInputTag.value = tag;
    });
  });

  // Save Permanent Delivery Address Form (Swiggy 2-Step Workflow)
  if (formDeliveryAddress) {
    formDeliveryAddress.addEventListener('submit', (e) => {
      e.preventDefault();

      const swiggyInputFlat = document.getElementById('swiggy-input-flat');
      const swiggyInputFloor = document.getElementById('swiggy-input-floor');
      const swiggyInputStreet = document.getElementById('swiggy-input-street');
      const swiggySaveAsInput = document.getElementById('swiggy-save-as-input');
      const swiggyInputInstructions = document.getElementById('swiggy-input-instructions');
      const swiggyUseAccountCheckbox = document.getElementById('swiggy-use-account-checkbox');

      const flatNoVal = swiggyInputFlat?.value?.trim() || '';
      const floorVal = swiggyInputFloor?.value?.trim() || '';
      const streetVal = swiggyInputStreet?.value?.trim() || '';
      const instructionsVal = swiggyInputInstructions?.value?.trim() || '';
      const saveAsVal = swiggySaveAsInput?.value?.trim() || 'Home';

      if (!flatNoVal) {
        showToast('Please enter your House / Flat Number', 'warning');
        if (swiggyInputFlat) swiggyInputFlat.focus();
        return;
      }

      // Determine Contact Name & Phone Number
      let name = '';
      if (swiggyUseAccountCheckbox && swiggyUseAccountCheckbox.checked) {
        name = (currentUser?.user_metadata?.full_name || currentUser?.user_metadata?.name || 'Customer').trim();
      } else {
        name = addrInputName?.value?.trim() || (currentUser?.user_metadata?.full_name || 'Customer').trim();
      }

      // Read phone directly from the visible mobile input or user metadata
      let phone = (addrInputPhone?.value || '').trim();
      if (!phone && currentUser?.user_metadata?.phone) {
        phone = String(currentUser.user_metadata.phone).trim();
      }
      const phoneDigits = phone.replace(/\D/g, '').slice(-10);

      if (!phoneDigits || phoneDigits.length < 10) {
        showToast('⚠️ Please enter a valid 10-digit mobile number for delivery calls', 'warning');
        if (addrInputPhone) {
          addrInputPhone.focus();
          addrInputPhone.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
      }
      phone = phoneDigits;

      if (!name) {
        showToast('⚠️ Please enter recipient contact name', 'warning');
        if (addrInputName) addrInputName.focus();
        return;
      }

      const lat = Number(addrInputLat?.value) || currentAddressCoords.lat || RESTAURANT_COORDINATES.lat;
      const lng = Number(addrInputLng?.value) || currentAddressCoords.lng || RESTAURANT_COORDINATES.lng;

      // Deliverability check
      const check = dataService.checkDeliveryAvailability(lat, lng);
      if (!check.deliverable) {
        showToast(`⚠️ Location is ${check.distanceKm} km away, which exceeds our ${check.maxRadiusKm} km delivery limit. Please pin closer!`, 'error');
        return;
      }

      // Construct formatted multi-part delivery address
      const fullAddressParts = [
        flatNoVal,
        floorVal ? `Floor ${floorVal}` : '',
        streetVal,
        detectedAddressDetails.fullText || 'Ramanagara'
      ].filter(Boolean);

      const finalAddressText = fullAddressParts.join(', ');
      const area = detectedAddressDetails.area || 'Ramanagara';
      const city = detectedAddressDetails.city || 'Ramanagara';
      const pincode = detectedAddressDetails.pincode || '';
      const tag = addrInputTag?.value || saveAsVal || 'Home';
      const isDefault = addrInputDefault ? addrInputDefault.checked : true;

      const addressData = {
        id: activeEditingAddressId || undefined,
        userId: currentUser?.id || null,
        userEmail: currentUser?.email || null,
        name,
        phone,
        tag,
        flatNo: flatNoVal,
        floor: floorVal,
        street: streetVal,
        instructions: instructionsVal,
        area,
        city,
        pincode,
        details: finalAddressText,
        fullText: finalAddressText,
        lat,
        lng,
        isDefault
      };

      const saved = dataService.saveUserAddress(addressData);
      selectedAddressId = saved.id;

      // Update current user's profile phone so it persists permanently across the app
      if (currentUser) {
        if (!currentUser.user_metadata) currentUser.user_metadata = {};
        currentUser.user_metadata.phone = phone;
        try {
          localStorage.setItem('quickbite_custom_user', JSON.stringify(currentUser));
        } catch {}
        if (typeof supabase !== 'undefined' && supabase.auth) {
          supabase.auth.updateUser({ data: { phone } }).catch(() => {});
        }
        updateUserStateUI(currentUser);
      }

      renderCartAddresses();
      renderProfileAddresses();
      renderCheckoutAddresses();

      showToast(`📍 Doorstep location pinned & saved successfully!`, 'success');

      if (pendingCheckoutAfterAddress) {
        pendingCheckoutAfterAddress = false;
        closeAddressModalInternal();
        if (backNav.hasStep('checkout-modal')) {
          if (backNav.isTopStep('address-modal')) {
            backNav.stepBack();
          } else {
            openCheckoutModalInternal();
          }
        } else {
          // Opened from cart drawer or standalone
          backNav.replaceTopStep(
            'checkout-modal',
            () => closeCheckoutModalInternal(),
            () => openCheckoutModalInternal()
          );
          openCheckoutModalInternal();
        }
        showToast('✅ Address saved! Please confirm your order with Cash on Delivery.', 'success');
      } else {
        closeAddressModal();
      }
    });
  }

  // Render Delivery Address Cards in Cart Drawer (Radio Selection for 2+ addresses)
  function renderCartAddresses() {
    updateHeroDeliveryDistanceBadge();
    if (!cartDeliverySection) return;

    const addresses = getCurrentAddresses();

    // 1. Unauthenticated and no saved address -> Show sign-in notice
    if (!currentUser && addresses.length === 0) {
      if (cartAddrAuthPrompt) cartAddrAuthPrompt.style.display = 'flex';
      if (cartAddrEmptyPrompt) cartAddrEmptyPrompt.style.display = 'none';
      if (cartAddressesList) cartAddressesList.innerHTML = '';
      if (cartAddressDistancePill) cartAddressDistancePill.style.display = 'none';
      return;
    }

    if (cartAddrAuthPrompt) {
      cartAddrAuthPrompt.style.display = !currentUser ? 'flex' : 'none';
    }

    // 2. Authenticated or guest with 0 addresses -> Show empty prompt
    if (addresses.length === 0) {
      if (cartAddrEmptyPrompt) cartAddrEmptyPrompt.style.display = 'block';
      if (cartAddressesList) cartAddressesList.innerHTML = '';
      if (cartAddressDistancePill) cartAddressDistancePill.style.display = 'none';
      return;
    }

    if (cartAddrEmptyPrompt) cartAddrEmptyPrompt.style.display = 'none';

    // Determine currently active selected address
    if (!selectedAddressId || !addresses.some(a => a.id === selectedAddressId)) {
      const def = addresses.find(a => a.isDefault);
      selectedAddressId = def ? def.id : addresses[0].id;
    }

    const selectedAddr = addresses.find(a => a.id === selectedAddressId) || addresses[0];

    // 3. Render address cards with radio selection
    if (cartAddressesList) {
      cartAddressesList.innerHTML = addresses.map(addr => {
        const isSel = addr.id === selectedAddressId;
        const tagEmoji = addr.tag === 'Work' ? '💼' : (addr.tag === 'Other' ? '📍' : '🏠');
        const safeId = escapeHtml(addr.id);
        const safeTag = escapeHtml(addr.tag || 'Home');
        const safeName = escapeHtml(addr.name || 'User');
        const safePhone = escapeHtml(addr.phone || '');
        const safeFlat = escapeHtml(addr.flatNo || '');
        const safeArea = escapeHtml(addr.area || '');
        const safeCity = addr.city ? ', ' + escapeHtml(addr.city) : '';
        const dist = Math.round((parseFloat(addr.distanceKm) || 0) * 10) / 10;

        return `
          <div class="cart-addr-card ${isSel ? 'selected' : ''}" data-id="${safeId}">
            <div class="cart-addr-radio-wrap">
              <input type="radio" name="cart_delivery_addr" class="cart-addr-radio" ${isSel ? 'checked' : ''} />
            </div>
            <div class="cart-addr-details">
              <div class="cart-addr-header-row">
                <span class="cart-addr-tag-pill">${tagEmoji} ${safeTag}</span>
                ${addr.isDefault ? '<span class="cart-addr-default-pill">Default</span>' : ''}
                <span class="cart-addr-distance-tag">${dist} km</span>
              </div>
              <div class="cart-addr-person">
                <strong>${safeName}</strong> • ${safePhone}
              </div>
              <div class="cart-addr-text">
                ${escapeHtml(addr.details || addr.fullText || `${addr.flatNo || ''}, ${addr.area || ''}${safeCity}`)}
              </div>
            </div>
          </div>
        `;
      }).join('');

      cartAddressesList.querySelectorAll('.cart-addr-card').forEach(card => {
        card.addEventListener('click', () => {
          const id = card.getAttribute('data-id');
          if (id && id !== selectedAddressId) {
            selectedAddressId = id;
            renderCartAddresses();
          }
        });
      });
    }

    // 4. Update distance badge & deliverability warning
    if (cartAddressDistancePill && selectedAddr) {
      cartAddressDistancePill.style.display = 'flex';
      const check = dataService.checkDeliveryAvailability(selectedAddr.lat, selectedAddr.lng);
      if (check.deliverable) {
        if (cartDistDot) cartDistDot.className = 'distance-dot in-zone';
        if (cartDistText) cartDistText.innerHTML = `<strong>${check.distanceKm} km</strong> from kitchen • Ready for delivery`;
      } else {
        if (cartDistDot) cartDistDot.className = 'distance-dot out-zone';
        if (check.reason === 'unpinned' || check.distanceKm === null) {
          if (cartDistText) cartDistText.innerHTML = '⚠️ <strong>Location not pinned</strong> • Click edit to pin on map';
        } else {
          if (cartDistText) cartDistText.innerHTML = `⚠️ <strong>${check.distanceKm} km</strong> • Outside our ${check.maxRadiusKm} km delivery zone`;
        }
      }
    }
  }

  // ==========================================
  // ACTIVE ORDERS LIMIT CONTROLLER
  // Rule: Customer cannot do more than maxActiveOrders (default 2) at a time.
  // Until 1st order is delivered, they cannot place their 3rd order.
  // ==========================================
  const cartOrderLimitBanner = document.getElementById('cart-order-limit-banner');
  const cartOrderLimitMsg = document.getElementById('cart-order-limit-msg');
  const cartOrderLimitFirstId = document.getElementById('cart-order-limit-first-id');
  const cartTrackFirstIdLabel = document.getElementById('cart-track-first-id-label');
  const btnCartTrackFirstOrder = document.getElementById('btn-cart-track-first-order');
  const btnCheckoutLabel = document.getElementById('btn-checkout-label');
  const checkoutArrowIcon = document.getElementById('checkout-arrow-icon');

  function renderCartOrderLimitUI(activeOrders = null, maxAllowed = null) {
    if (!currentUser) {
      if (cartOrderLimitBanner) cartOrderLimitBanner.style.display = 'none';
      if (btnCheckout) btnCheckout.classList.remove('disabled-limit');
      if (btnCheckoutLabel) btnCheckoutLabel.textContent = 'Proceed to Checkout';
      if (checkoutArrowIcon) checkoutArrowIcon.style.display = 'inline';
      return;
    }

    const userPhone = getCurrentUserPhone();
    const userEmail = currentUser?.email || '';
    if (!activeOrders) {
      activeOrders = dataService.getCustomerActiveOrders(currentUser.id, userEmail, userPhone);
    }
    if (maxAllowed === null) {
      const storeSettings = dataService.getSettings();
      maxAllowed = storeSettings.maxActiveOrdersPerCustomer !== undefined ? storeSettings.maxActiveOrdersPerCustomer : 2;
    }

    if (activeOrders.length >= maxAllowed) {
      const firstOrder = activeOrders[0];
      const activeIds = activeOrders.map(o => o.id).join(', ');
      if (cartOrderLimitBanner) {
        cartOrderLimitBanner.style.display = 'block';
        if (cartOrderLimitMsg) {
          cartOrderLimitMsg.innerHTML = `You have <strong>${activeOrders.length} active order${activeOrders.length > 1 ? 's' : ''} in progress</strong> (${activeIds}). You cannot place another order until your 1st order (<strong>${firstOrder.id}</strong>) is delivered!`;
        }
        if (cartOrderLimitFirstId) cartOrderLimitFirstId.textContent = firstOrder.id;
        if (cartTrackFirstIdLabel) cartTrackFirstIdLabel.textContent = firstOrder.id;
      }
      if (btnCheckout) {
        btnCheckout.classList.add('disabled-limit');
      }
      if (btnCheckoutLabel) {
        btnCheckoutLabel.textContent = `Awaiting Delivery of ${firstOrder.id}`;
      }
      if (checkoutArrowIcon) {
        checkoutArrowIcon.style.display = 'none';
      }
    } else {
      if (cartOrderLimitBanner) cartOrderLimitBanner.style.display = 'none';
      if (btnCheckout) btnCheckout.classList.remove('disabled-limit');
      if (btnCheckoutLabel) btnCheckoutLabel.textContent = 'Proceed to Checkout';
      if (checkoutArrowIcon) checkoutArrowIcon.style.display = 'inline';
    }
  }

  if (btnCartTrackFirstOrder) {
    btnCartTrackFirstOrder.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      // 1. Resolve target order ID from label or customer active orders
      const bannerIdEl = document.getElementById('cart-track-first-id-label') || document.getElementById('cart-order-limit-first-id');
      let targetId = bannerIdEl ? bannerIdEl.textContent.trim() : null;

      if (!targetId || targetId === '#QB-0000') {
        const userPhone = getCurrentUserPhone();
        const userEmail = currentUser?.email || '';
        const activeOrders = dataService.getCustomerActiveOrders(currentUser?.id, userEmail, userPhone);
        targetId = activeOrders[0] ? activeOrders[0].id : null;
      }

      // 2. Close cart drawer seamlessly without history popstate race condition
      closeCartDrawerInternal();
      backNav.removeStepDirect('cart-drawer');

      // 3. Open tracker modal directly for this active order
      openOrderModal(targetId || null, false);
    });
  }

  // Render Saved Addresses in User Profile Modal
  function renderProfileAddresses() {
    updateHeroDeliveryDistanceBadge();
    if (!profileAddressesList) return;

    const addresses = getCurrentAddresses();
    if (addresses.length === 0) {
      profileAddressesList.innerHTML = `
        <div class="profile-addr-empty" style="text-align: center; padding: 18px 12px; color: var(--text-muted);">
          <p style="margin: 0 0 6px 0; font-weight: 600;"><i class="fa-solid fa-map-location-dot"></i> No delivery addresses saved yet.</p>
          <span style="font-size: 0.85rem;">Click "+ Add Address" above to pin your permanent location.</span>
        </div>
      `;
      return;
    }

    profileAddressesList.innerHTML = addresses.map(addr => {
      const tagEmoji = addr.tag === 'Work' ? '💼' : (addr.tag === 'Other' ? '📍' : '🏠');
      const safeId = escapeHtml(addr.id);
      const safeTag = escapeHtml(addr.tag || 'Home');
      const safeName = escapeHtml(addr.name || 'User');
      const safePhone = escapeHtml(addr.phone || '');
      const safeFlat = escapeHtml(addr.flatNo || '');
      const safeArea = escapeHtml(addr.area || '');
      const safeCity = addr.city ? ', ' + escapeHtml(addr.city) : '';
      const safePincode = addr.pincode ? ' - ' + escapeHtml(addr.pincode) : '';
      const dist = Math.round((parseFloat(addr.distanceKm) || 0) * 10) / 10;

      return `
        <div class="profile-addr-item ${addr.isDefault ? 'is-default' : ''}" data-id="${safeId}">
          <div class="profile-addr-top">
            <div class="profile-addr-tag-group">
              <span class="profile-tag-badge">${tagEmoji} ${safeTag}</span>
              ${addr.isDefault ? '<span class="profile-default-badge"><i class="fa-solid fa-star"></i> Default</span>' : ''}
            </div>
            <span class="profile-dist-badge"><i class="fa-solid fa-location-dot"></i> ${dist} km from kitchen</span>
          </div>
          <div class="profile-addr-contact">
            <strong>${safeName}</strong> • <span>${safePhone}</span>
          </div>
          <div class="profile-addr-street">
            ${escapeHtml(addr.details || addr.fullText || `${addr.flatNo || ''}, ${addr.area || ''}${safeCity}${safePincode}`)}
          </div>
          <div class="profile-addr-actions">
            ${!addr.isDefault ? `<button type="button" class="btn-profile-set-default" data-id="${safeId}"><i class="fa-regular fa-star"></i> Set as Default</button>` : ''}
            <button type="button" class="btn-profile-edit-addr" data-id="${safeId}"><i class="fa-solid fa-pen"></i> Edit</button>
            <button type="button" class="btn-profile-del-addr" data-id="${safeId}"><i class="fa-solid fa-trash-can"></i> Delete</button>
          </div>
        </div>
      `;
    }).join('');

    profileAddressesList.querySelectorAll('.btn-profile-set-default').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        if (id) {
          dataService.setDefaultAddress(id, currentUser?.id, currentUser?.email);
          renderProfileAddresses();
          renderCartAddresses();
          renderCheckoutAddresses();
          showToast('⭐ Default delivery address updated!', 'success');
        }
      });
    });

    profileAddressesList.querySelectorAll('.btn-profile-edit-addr').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        if (id) {
          openAddressModal(id);
        }
      });
    });

    profileAddressesList.querySelectorAll('.btn-profile-del-addr').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        if (id && confirm('Delete this saved permanent address?')) {
          dataService.deleteUserAddress(id, currentUser?.id, currentUser?.email);
          renderProfileAddresses();
          renderCartAddresses();
          renderCheckoutAddresses();
          showToast('Delivery address removed', 'info');
        }
      });
    });
  }

  // Address Triggers
  if (btnCartAddAddr) btnCartAddAddr.addEventListener('click', () => openAddressModal());
  if (btnCartAddFirstAddr) btnCartAddFirstAddr.addEventListener('click', () => openAddressModal());
  if (btnCartPromptSignin) btnCartPromptSignin.addEventListener('click', () => openAuthModal());
  if (btnProfileAddAddr) btnProfileAddAddr.addEventListener('click', () => openAddressModal());

  // Dropdown and mobile navigation links to addresses
  if (dropLinkAddresses) {
    dropLinkAddresses.addEventListener('click', (e) => {
      e.preventDefault();
      if (userDropdownCard) userDropdownCard.classList.remove('show');
      openAuthModal();
    });
  }

  if (mobileNavAddresses) {
    mobileNavAddresses.addEventListener('click', (e) => {
      e.preventDefault();
      closeMobileMenu();
      openAuthModal();
    });
  }

  // ==========================================
  // LIVE HERO DELIVERY DISTANCE & FRESH ETA BADGE
  // Calculates actual road route distance & bike ETA (matching Google Maps street routes)
  // ==========================================
  async function updateHeroDeliveryDistanceBadge() {
    const heroDistanceBadge = document.getElementById('hero-distance-badge');
    const heroDistanceText = document.getElementById('hero-distance-text');
    const heroContent = document.querySelector('.hero-content');
    if (!heroDistanceBadge || !heroDistanceText) return;

    const addresses = getCurrentAddresses();
    if (!Array.isArray(addresses) || addresses.length === 0) {
      const defaultDistDisplay = "890 m";
      const defaultTimeStr = "10–15 mins";
      heroDistanceText.innerHTML = `<span class="hero-distance-line-1">We are just <strong class="dist-highlight">${defaultDistDisplay}</strong> away from you</span><span class="hero-distance-line-2">Get your favorite meal in <strong class="eta-highlight">${defaultTimeStr}</strong>! <span class="hero-distance-cta">Order now</span></span>`;
      heroDistanceBadge.style.display = 'inline-flex';
      if (heroContent) heroContent.classList.add('has-distance-badge');
      return;
    }

    // Determine currently active selected address
    const activeAddr = (selectedAddressId && addresses.find(a => a.id === selectedAddressId))
      || addresses.find(a => a.isDefault)
      || addresses[0];

    if (!activeAddr) {
      const defaultDistDisplay = "890 m";
      const defaultTimeStr = "10–15 mins";
      heroDistanceText.innerHTML = `<span class="hero-distance-line-1">We are just <strong class="dist-highlight">${defaultDistDisplay}</strong> away from you</span><span class="hero-distance-line-2">Get your favorite meal in <strong class="eta-highlight">${defaultTimeStr}</strong>! <span class="hero-distance-cta">Order now</span></span>`;
      heroDistanceBadge.style.display = 'inline-flex';
      if (heroContent) heroContent.classList.add('has-distance-badge');
      return;
    }

    const lat = Number(activeAddr.lat);
    const lng = Number(activeAddr.lng);

    // 1. Instant synchronous road estimate (0ms delay for zero layout shift)
    let syncRoadDist = (typeof dataService.calculateDistanceToRestaurant === 'function')
      ? dataService.calculateDistanceToRestaurant(lat, lng)
      : (Number(activeAddr.distanceKm) || 1.0);

    if (syncRoadDist === null || isNaN(syncRoadDist)) syncRoadDist = 1.0;

    let syncDistDisplay = (syncRoadDist < 1.0)
      ? `${Math.round(syncRoadDist * 1000)} m`
      : `${syncRoadDist.toFixed(1)} km`;

    let syncMinTime = syncRoadDist <= 1.2 ? 10 : Math.round(10 + syncRoadDist * 2.5);
    let syncMaxTime = syncMinTime + 5;
    let syncTimeStr = `${syncMinTime}–${syncMaxTime} mins`;

    heroDistanceText.innerHTML = `<span class="hero-distance-line-1">We are just <strong class="dist-highlight">${syncDistDisplay}</strong> away from you</span><span class="hero-distance-line-2">Get your favorite meal in <strong class="eta-highlight">${syncTimeStr}</strong>! <span class="hero-distance-cta">Order now</span></span>`;
    heroDistanceBadge.style.display = 'inline-flex';
    if (heroContent) heroContent.classList.add('has-distance-badge');

    // 2. Query actual turn-by-turn road route via street network (OSRM / OpenStreetMap)
    if (typeof dataService.calculateRoadRoute === 'function') {
      try {
        const roadRoute = await dataService.calculateRoadRoute(lat, lng);
        if (roadRoute && roadRoute.distanceMeters) {
          // Verify user hasn't switched address while routing was fetching
          const currentCheck = (selectedAddressId && addresses.find(a => a.id === selectedAddressId))
            || addresses.find(a => a.isDefault)
            || addresses[0];

          if (currentCheck && Math.abs(Number(currentCheck.lat) - lat) < 0.0001 && Math.abs(Number(currentCheck.lng) - lng) < 0.0001) {
            const meters = Math.round(roadRoute.distanceMeters);
            const liveDistDisplay = (meters < 1000)
              ? `${Math.round(meters / 10) * 10} m`
              : `${(meters / 1000).toFixed(1)} km`;

            // Calculate realistic bike delivery arrival:
            // Fast kitchen packaging (5-8 mins) + bike transit minutes from road route
            const rideMins = Math.max(3, roadRoute.durationMins || 4);
            const liveMinTime = Math.max(10, rideMins + 5);
            const liveMaxTime = liveMinTime + 5;
            const liveTimeStr = `${liveMinTime}–${liveMaxTime} mins`;

            heroDistanceText.innerHTML = `<span class="hero-distance-line-1">We are just <strong class="dist-highlight">${liveDistDisplay}</strong> away from you</span><span class="hero-distance-line-2">Get your favorite meal in <strong class="eta-highlight">${liveTimeStr}</strong>! <span class="hero-distance-cta">Order now</span></span>`;
          }
        }
      } catch (err) {
        // Keeps instant road estimate
      }
    }
  }

  // Hero delivery distance badge: cloud-like floating pill with tactile jelly wobble (pure info, does not open anything)
  const heroDistanceBadge = document.getElementById('hero-distance-badge');
  if (heroDistanceBadge) {
    heroDistanceBadge.addEventListener('click', (e) => {
      e.preventDefault();
      // Tactile jelly squish on tap
      heroDistanceBadge.classList.remove('jelly-pop');
      void heroDistanceBadge.offsetWidth; // trigger reflow
      heroDistanceBadge.classList.add('jelly-pop');
    });
  }

  if (typeof dataService.on === 'function') {
    dataService.on('change:addresses', updateHeroDeliveryDistanceBadge);
    dataService.on('addresses', updateHeroDeliveryDistanceBadge);
  }

  const mobileNavMyOrders = document.getElementById('mobile-nav-my-orders');
  if (mobileNavMyOrders) {
    mobileNavMyOrders.addEventListener('click', (e) => {
      e.preventDefault();
      closeMobileMenuInternal();
      backNav.removeStepDirect('mobile-nav');
      openMyOrdersModal('all');
    });
  }

  function openAuthModalInternal() {
    if (authModalBackdrop) {
      authModalBackdrop.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
  }

  function openAuthModal() {
    openAuthModalInternal();
    backNav.pushStep('auth-modal', () => closeAuthModalInternal(), () => openAuthModalInternal());
  }

  function closeAuthModalInternal() {
    if (authModalBackdrop) {
      authModalBackdrop.classList.remove('open');
      document.body.style.overflow = '';
    }
  }

  function closeAuthModal() {
    if (backNav.isTopStep('auth-modal')) {
      backNav.stepBack();
    } else {
      closeAuthModalInternal();
      backNav.removeStepDirect('auth-modal');
    }
  }

  if (authModalClose) authModalClose.addEventListener('click', closeAuthModal);
  if (btnGuestContinue) btnGuestContinue.addEventListener('click', closeAuthModal);
  if (authModalBackdrop) {
    authModalBackdrop.addEventListener('click', (e) => {
      if (e.target === authModalBackdrop) closeAuthModal();
    });
  }

  // Open modal on Log In or Greeting / Avatar stack click
  if (btnLogin) btnLogin.addEventListener('click', openAuthModal);
  mobileLoginBtns.forEach(btn => btn.addEventListener('click', openAuthModal));
  if (userGreetingWrap) userGreetingWrap.addEventListener('click', openAuthModal);
  if (userAvatarStack) userAvatarStack.addEventListener('click', openAuthModal);

  // Toggle user profile dropdown (desktop navbar)
  if (btnUserProfile) {
    btnUserProfile.addEventListener('click', (e) => {
      e.stopPropagation();
      userDropdownCard.classList.toggle('show');
    });
  }

  // Close dropdown on click outside
  document.addEventListener('click', (e) => {
    if (userDropdownCard && !userDropdownCard.contains(e.target) && e.target !== btnUserProfile) {
      userDropdownCard.classList.remove('show');
    }
  });

  // Handle User UI State (Display User Name or Hi Guest)
  function updateUserStateUI(user) {
    currentUser = user;
    if (user) {
      if (btnLogin) btnLogin.style.display = 'none';
      if (userProfileMenu) userProfileMenu.style.display = 'inline-flex';

      const meta = user.user_metadata || {};
      const identities = Array.isArray(user.identities) ? user.identities : [];
      const googleIdentity = identities.find(i => i.provider === 'google') || identities[0];
      const identityData = googleIdentity?.identity_data || {};

      const fullName = (meta.full_name || meta.name || identityData.full_name || identityData.name || user.email?.split('@')[0] || 'Foodie').trim();
      const firstName = fullName.split(' ')[0] || 'Foodie';
      const userInitial = (firstName || fullName || 'F').charAt(0).toUpperCase();
      const phone = (meta.phone || user.phone || identityData.phone || '').trim();

      // Retrieve Google avatar URL from all possible Supabase / Google OAuth fields
      const avatarUrl = (
        meta.avatar_url ||
        meta.picture ||
        identityData.avatar_url ||
        identityData.picture ||
        user.avatar_url ||
        ''
      ).trim();

      function updateAvatar(imgEl, letterEl, src, initial) {
        if (letterEl) {
          letterEl.textContent = initial;
        }
        if (!imgEl) return;
        imgEl.referrerPolicy = 'no-referrer';

        if (src) {
          imgEl.src = src;
          imgEl.onload = () => {
            imgEl.style.display = 'block';
            if (letterEl) letterEl.style.display = 'none';
          };
          imgEl.onerror = () => {
            console.warn('[Avatar] Failed to load image from:', src, '- using letter initial:', initial);
            imgEl.style.display = 'none';
            if (letterEl) letterEl.style.display = 'inline-flex';
          };
          imgEl.style.display = 'block';
          if (letterEl) letterEl.style.display = 'none';
        } else {
          imgEl.style.display = 'none';
          if (letterEl) letterEl.style.display = 'inline-flex';
        }
      }

      if (userNameText) userNameText.textContent = firstName;
      if (userDropName) userDropName.textContent = fullName;
      if (userDropEmail) userDropEmail.textContent = user.email || 'Savera Paradise Member';

      // 1. Header user profile button avatar
      updateAvatar(userAvatarImg, userAvatarLetter, avatarUrl, userInitial);

      // 2. Dropdown card avatar
      updateAvatar(userDropAvatarImg, userDropAvatarLetter, avatarUrl, userInitial);

      // 3. Auth modal avatar
      updateAvatar(authModalAvatar, authModalLetter, avatarUrl, userInitial);

      // 4. Update Menu Header Greeting & Avatar
      if (userGreetingTitle) {
        userGreetingTitle.textContent = `Hi ${firstName}`;
      }
      if (userGreetingAvatarImg) {
        userGreetingAvatarImg.referrerPolicy = 'no-referrer';
        if (avatarUrl) {
          userGreetingAvatarImg.src = avatarUrl;
        }
      }

      // Update Auth Modal View for Logged-In User
      if (authGuestView) authGuestView.style.display = 'none';
      if (authLoggedInView) authLoggedInView.style.display = 'block';
      if (authModalUserName) authModalUserName.textContent = `Hi, ${fullName}`;
      if (authModalUserEmail) authModalUserEmail.textContent = user.email || 'Savera Paradise Member';
      if (authModalUserPhone) {
        if (phone) {
          authModalUserPhone.style.display = 'inline-flex';
          authModalUserPhone.querySelector('span').textContent = phone;
        } else {
          authModalUserPhone.style.display = 'none';
        }
      }

      // Update mobile drawer button & bottom capsule profile label
      if (capsuleProfileLabel) capsuleProfileLabel.textContent = firstName || 'Profile';
      mobileLoginBtns.forEach(btn => {
        btn.textContent = `Hi, ${firstName} (Sign Out)`;
        btn.onclick = async (e) => {
          e.preventDefault();
          await handleSignOut();
        };
      });

      // Synchronize addresses & active order limits
      syncActiveUserContextToStorage();
      renderCartAddresses();
      renderProfileAddresses();
      renderCheckoutAddresses();
      renderCartOrderLimitUI();

      // Trigger cloud sync if Supabase is connected
      dataService.syncUserAddressesFromSupabase(user.id, user.email).then(() => {
        syncActiveUserContextToStorage();
        renderCartAddresses();
        renderProfileAddresses();
        renderCheckoutAddresses();
        dataService.syncCustomerOrdersFromSupabase(user.id, user.email, getCurrentUserPhone()).then(() => {
          renderCartOrderLimitUI();
          renderMyOrdersList();
        });
      });
      dataService.syncCustomerOrdersFromSupabase(user.id, user.email, getCurrentUserPhone()).then(() => {
        renderCartOrderLimitUI();
        renderMyOrdersList();
      });
    } else {
      syncActiveUserContextToStorage();
      if (btnLogin) btnLogin.style.display = 'inline-flex';
      if (userProfileMenu) userProfileMenu.style.display = 'none';
      if (userDropdownCard) userDropdownCard.classList.remove('show');
      if (capsuleProfileLabel) capsuleProfileLabel.textContent = 'Profile';
      selectedAddressId = null;
      updateHeroDeliveryDistanceBadge();

      // Revert avatars to Guest
      if (userAvatarImg) userAvatarImg.style.display = 'none';
      if (userAvatarLetter) {
        userAvatarLetter.style.display = 'inline-flex';
        userAvatarLetter.textContent = 'G';
      }
      if (userDropAvatarImg) userDropAvatarImg.style.display = 'none';
      if (userDropAvatarLetter) {
        userDropAvatarLetter.style.display = 'inline-flex';
        userDropAvatarLetter.textContent = 'G';
      }
      if (authModalAvatar) authModalAvatar.style.display = 'none';
      if (authModalLetter) {
        authModalLetter.style.display = 'inline-flex';
        authModalLetter.textContent = 'G';
      }

      // Revert to Guest
      if (userGreetingTitle) {
        userGreetingTitle.textContent = 'Hi Guest';
      }
      if (userGreetingAvatarImg) {
        userGreetingAvatarImg.src = 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&auto=format&fit=crop&q=80';
      }

      // Revert Auth Modal View
      if (authGuestView) authGuestView.style.display = 'block';
      if (authLoggedInView) authLoggedInView.style.display = 'none';
      if (authModalUserPhone) authModalUserPhone.style.display = 'none';

      // Reset mobile drawer button
      mobileLoginBtns.forEach(btn => {
        btn.textContent = 'Log In / Sign Up';
        btn.onclick = openAuthModal;
      });

      renderCartAddresses();
      renderProfileAddresses();
      renderCheckoutAddresses();
      renderCartOrderLimitUI();
    }
  }

  // Modal Sign Out Button Handler
  if (btnModalSignOut) {
    btnModalSignOut.addEventListener('click', async () => {
      await handleSignOut();
      closeAuthModal();
    });
  }

  const isLocalhostEnv = 
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '[::1]' ||
    window.location.hostname.includes('localhost');

  // Update button text and show cloud test link if on localhost
  const btnGoogleSigninText = document.getElementById('btn-google-signin-text');
  const authDevSwitchRow = document.getElementById('auth-dev-switch-row');
  const btnDevCloudOAuth = document.getElementById('btn-dev-cloud-oauth');

  if (isLocalhostEnv) {
    if (btnGoogleSigninText) {
      btnGoogleSigninText.textContent = 'Continue with Google (Localhost)';
    }
    if (authDevSwitchRow) {
      authDevSwitchRow.style.display = 'block';
    }
  }

  // 1-Click Google OAuth Trigger (Sign-In with Google)
  if (btnGoogleSignin) {
    btnGoogleSignin.addEventListener('click', async () => {
      // 1. LOCALHOST ENVIRONMENT: Stay on localhost, 0 external redirects to live site!
      if (isLocalhostEnv) {
        const googleUser = {
          id: `google_local_${Date.now()}`,
          email: 'foodie.google@gmail.com',
          user_metadata: {
            full_name: 'Local Test Customer',
            name: 'Local Test Customer',
            email: 'foodie.google@gmail.com',
            avatar_url: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop&q=80',
            provider: 'google'
          }
        };

        try {
          localStorage.setItem('quickbite_custom_user', JSON.stringify(googleUser));
        } catch {}

        updateUserStateUI(googleUser);
        closeAuthModal();
        showToast('👋 Welcome! Signed in on Localhost.', 'success');

        if (pendingCheckoutAfterAuth || sessionStorage.getItem('quickbite_pending_checkout') === 'true') {
          pendingCheckoutAfterAuth = false;
          sessionStorage.removeItem('quickbite_pending_checkout');
          const addresses = getCurrentAddresses();
          if (addresses.length === 0) {
            pendingCheckoutAfterAddress = true;
            openAddressModal();
            showToast('📍 Adding a delivery address is mandatory. Please pin your location on the map.', 'info');
          } else {
            openCheckoutModal();
            showToast('✅ Signed in on Localhost! Please confirm your address & payment method to checkout.', 'success');
          }
        }
        return;
      }

      // 2. LIVE PRODUCTION ENVIRONMENT: Stay on live site
      try {
        btnGoogleSignin.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Connecting to Google...';
        btnGoogleSignin.disabled = true;

        if (pendingCheckoutAfterAuth) {
          sessionStorage.setItem('quickbite_pending_checkout', 'true');
        }

        const targetRedirect = window.location.origin ? `${window.location.origin}/` : window.location.href;

        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: targetRedirect
          }
        });

        if (error) throw error;
      } catch (err) {
        console.warn('[Google Auth]: Supabase OAuth error:', err);
        showToast('Google Sign-In error. Please try again.', 'error');
        btnGoogleSignin.innerHTML = `
          <svg class="google-svg-icon" viewBox="0 0 24 24" width="22" height="22">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
          </svg>
          <span id="btn-google-signin-text">Continue with Google</span>
        `;
        btnGoogleSignin.disabled = false;
      }
    });
  }

  // Cloud OAuth Trigger for optional real-account localhost testing
  if (btnDevCloudOAuth) {
    btnDevCloudOAuth.addEventListener('click', async () => {
      try {
        btnDevCloudOAuth.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Connecting to Cloud Google OAuth...';
        btnDevCloudOAuth.disabled = true;

        if (pendingCheckoutAfterAuth) {
          sessionStorage.setItem('quickbite_pending_checkout', 'true');
        }

        // Pass return_to so index.html forwards back to localhost with tokens
        const targetRedirect = window.location.origin ? `${window.location.origin}/` : window.location.href;

        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: targetRedirect
          }
        });

        if (error) throw error;
      } catch (err) {
        console.warn('[Cloud OAuth Error]:', err);
        showToast(`Cloud OAuth error: ${err?.message || err}`, 'error');
        btnDevCloudOAuth.disabled = false;
        btnDevCloudOAuth.innerHTML = '<i class="fa-solid fa-cloud"></i> Test Real Google OAuth (Cloud)';
      }
    });
  }

  // Unified Sign Out Function
  async function handleSignOut() {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn('[Auth SignOut Error]:', err);
    }
    localStorage.removeItem('quickbite_custom_user');
    localStorage.removeItem('quickbite_active_user_context');
    localStorage.removeItem('quickbite_my_order_ids');
    updateUserStateUI(null);
    showToast('Signed out successfully. Browsing as Guest.', 'info');
  }

  // Sign out trigger
  if (btnSignOut) {
    btnSignOut.addEventListener('click', handleSignOut);
  }

  // Initialize Auth Session & Realtime State Listener
  async function initAuth() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        updateUserStateUI(session.user);
        if (sessionStorage.getItem('quickbite_pending_checkout') === 'true') {
          pendingCheckoutAfterAddress = false;
          sessionStorage.removeItem('quickbite_pending_checkout');
          const addresses = getCurrentAddresses();
          if (addresses.length === 0) {
            pendingCheckoutAfterAddress = true;
            openAddressModal();
            showToast('📍 Adding a delivery address is mandatory. Please pin your location on the map.', 'info');
          } else {
            openCartDrawer();
          }
        }
      } else {
        const storedCustom = localStorage.getItem('quickbite_custom_user');
        if (storedCustom) {
          try {
            updateUserStateUI(JSON.parse(storedCustom));
          } catch {
            updateUserStateUI(null);
          }
        } else {
          updateUserStateUI(null);
        }
      }

      supabase.auth.onAuthStateChange((event, session) => {
        if ((event === 'SIGNED_IN' || event === 'USER_UPDATED') && session?.user) {
          localStorage.removeItem('quickbite_custom_user');
          updateUserStateUI(session.user);
          closeAuthModal();

          // Clean up OAuth tokens from URL so mobile browsers maintain clean app state
          if (window.location.hash && (window.location.hash.includes('access_token=') || window.location.hash.includes('error='))) {
            try {
              window.history.replaceState(null, document.title, window.location.pathname + window.location.search);
            } catch {}
          }

          const name = session.user.user_metadata?.full_name?.split(' ')[0] || session.user.user_metadata?.name?.split(' ')[0] || 'Friend';
          showToast(`👋 Welcome back, ${name}!`, 'success');

          if (pendingCheckoutAfterAuth || sessionStorage.getItem('quickbite_pending_checkout') === 'true') {
            pendingCheckoutAfterAuth = false;
            sessionStorage.removeItem('quickbite_pending_checkout');
            const addresses = getCurrentAddresses();
            if (addresses.length === 0) {
              pendingCheckoutAfterAddress = true;
              openAddressModal();
              showToast('📍 Adding a delivery address is mandatory. Please pin your location on the map.', 'info');
            } else {
              openCheckoutModal();
              showToast('✅ Signed in with Google! Please confirm your address & payment method to checkout.', 'success');
            }
          }
        } else if (event === 'SIGNED_OUT') {
          localStorage.removeItem('quickbite_custom_user');
          updateUserStateUI(null);
        }
      });
    } catch (e) {
      console.warn('[Auth] Session check skipped:', e);
      const storedCustom = localStorage.getItem('quickbite_custom_user');
      if (storedCustom) {
        try {
          updateUserStateUI(JSON.parse(storedCustom));
        } catch {
          updateUserStateUI(null);
        }
      } else {
        updateUserStateUI(null);
      }
    }
  }

  initAuth();

  // Newsletter subscription
  const newsletterForm = document.getElementById('newsletter-form');
  if (newsletterForm) {
    newsletterForm.addEventListener('submit', (e) => {
      e.preventDefault();
      showToast('🎉 Thank you for subscribing! Your $5 off code is SENT to your inbox.', 'success');
      newsletterForm.reset();
    });
  }

  // ==========================================
  // STORE TIMINGS & KITCHEN RUSH SYNC (HOMEPAGE)
  // ==========================================
  const storeRushBanner = document.getElementById('store-rush-banner');
  const rushBannerTimer = document.getElementById('rush-banner-timer');
  const rushBannerReason = document.getElementById('rush-banner-reason');
  const homeStatusDot = document.getElementById('home-status-dot');
  const homeStatusText = document.getElementById('home-status-text');

  let storeStatusInterval = null;

  function ensureStoreStatusTicker(shouldRun) {
    if (shouldRun && !storeStatusInterval && !document.hidden) {
      storeStatusInterval = setInterval(updateStoreStatusUI, 1000);
    } else if (!shouldRun && storeStatusInterval) {
      clearInterval(storeStatusInterval);
      storeStatusInterval = null;
    }
  }

  function updateStoreStatusUI() {
    const settings = dataService.getSettings();
    const isClosed = settings.storeOpen === false || (typeof dataService.isStoreOpen === 'function' && !dataService.isStoreOpen());
    const isPaused = !isClosed && settings.isRushPaused && settings.pauseUntil && Date.now() < settings.pauseUntil;

    if (isClosed) {
      ensureStoreStatusTicker(false);
      if (storeRushBanner) {
        storeRushBanner.style.display = 'block';
        const headline = storeRushBanner.querySelector('.rush-banner-headline');
        const flame = storeRushBanner.querySelector('.rush-banner-flame');
        const countdown = storeRushBanner.querySelector('.rush-banner-countdown');
        if (headline) headline.textContent = 'Kitchen Closed for the Night';
        if (flame) flame.textContent = '🌙';
        if (countdown) countdown.style.display = 'none';
        if (rushBannerReason) {
          rushBannerReason.textContent = settings.storeClosedReason || `We are currently closed for orders. Our kitchen reopens tomorrow at ${settings.openTime || '11:00 AM'}. You can still browse our menu!`;
        }
      }
      if (homeStatusDot) {
        homeStatusDot.classList.remove('paused');
        homeStatusDot.classList.add('closed');
      }
      if (homeStatusText) {
        homeStatusText.innerHTML = `<strong>🌙 Closed Now:</strong> Reopens at ${settings.openTime || '11:00 AM'} • Browsing Only`;
      }
      if (btnCheckout) {
        btnCheckout.textContent = '🌙 Kitchen Closed';
      }
    } else if (isPaused) {
      ensureStoreStatusTicker(true);
      if (storeRushBanner) {
        const headline = storeRushBanner.querySelector('.rush-banner-headline');
        const flame = storeRushBanner.querySelector('.rush-banner-flame');
        const countdown = storeRushBanner.querySelector('.rush-banner-countdown');
        if (headline) headline.textContent = 'High Kitchen Rush in Progress!';
        if (flame) flame.textContent = '⚡';
        if (countdown) countdown.style.display = 'flex';
      }
      const remainingMs = Math.max(0, settings.pauseUntil - Date.now());
      const totalSecs = Math.floor(remainingMs / 1000);
      const mins = Math.floor(totalSecs / 60);
      const secs = totalSecs % 60;
      const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

      // Show top rush banner
      if (storeRushBanner) storeRushBanner.style.display = 'block';
      if (rushBannerTimer) rushBannerTimer.textContent = timeStr;
      if (rushBannerReason) {
        rushBannerReason.textContent = settings.pauseReason || 'Orders are temporarily paused so our chefs can maintain peak quality. Resuming shortly:';
      }

      // Update hero status tag
      if (homeStatusDot) {
        homeStatusDot.classList.remove('closed');
        homeStatusDot.classList.add('paused');
      }
      if (homeStatusText) {
        homeStatusText.innerHTML = `<strong>⚡ Kitchen Rush:</strong> Orders resume in <strong>${mins}m ${secs}s</strong>`;
      }

      // Update checkout button if present
      if (btnCheckout) {
        btnCheckout.textContent = `⏸️ Rush Paused (${mins}m left)`;
      }
    } else {
      ensureStoreStatusTicker(false);
      // Hide top rush banner
      if (storeRushBanner) {
        storeRushBanner.style.display = 'none';
        const countdown = storeRushBanner.querySelector('.rush-banner-countdown');
        if (countdown) countdown.style.display = 'flex';
      }

      // Update hero status tag
      if (homeStatusDot) {
        homeStatusDot.classList.remove('paused');
        homeStatusDot.classList.remove('closed');
      }
      if (homeStatusText) {
        const rawNotice = (settings.statusNotice && settings.statusNotice.trim())
          ? settings.statusNotice.trim()
          : `Open Now: ${settings.openTime || '11:00 AM'} – ${settings.closeTime || '11:00 PM'} • Delivery & Pickup`;
        const colonIdx = rawNotice.indexOf(':');
        if (colonIdx !== -1) {
          const prefix = escapeHtml(rawNotice.slice(0, colonIdx).trim());
          const rest = escapeHtml(rawNotice.slice(colonIdx + 1).trim());
          homeStatusText.innerHTML = `<strong>${prefix}:</strong> ${rest}`;
        } else {
          homeStatusText.textContent = rawNotice;
        }
      }

      // Restore checkout button
      if (btnCheckout) {
        btnCheckout.textContent = 'Proceed to Checkout';
      }
    }
  }

  // Auto-pause background timer when tab is hidden, resume on focus
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      ensureStoreStatusTicker(false);
    } else {
      updateStoreStatusUI();
    }
  });

  // Re-check status when settings change
  window.addEventListener('quickbite_data_changed', (e) => {
    if (e.detail?.type === 'settings' || !e.detail?.type) {
      updateStoreStatusUI();
      updateStoreOfferUI();
    }
  });

  // ==========================================
  // DYNAMIC PROMOTIONAL OFFER & BANNER SYNC
  // ==========================================
  function updateStoreOfferUI() {
    const settings = dataService.getSettings();
    const isActive = settings.offerActive !== false;
    const code = (settings.offerCode || 'CRISPY20').trim().toUpperCase();
    const discountType = settings.offerDiscountType || 'percent';
    const discountPct = Number(settings.offerDiscountPercent) || 20;
    const discountAmt = Number(settings.offerDiscountAmount) || 50;
    const minOrder = Number(settings.offerMinOrder || 0);
    const freeDeliveryThreshold = Number(settings.freeDeliveryThreshold !== undefined ? settings.freeDeliveryThreshold : 250);
    const freeDeliveryEnabled = settings.freeDeliveryEnabled !== false;

    const discountTag = discountType === 'flat' ? `₹${Math.round(discountAmt)} OFF` : `${discountPct}% OFF`;
    const minOrderStr = minOrder > 0 ? ` on orders above ₹${Math.round(minOrder)}` : '';
    const freeDelivWithCoupon = settings.offerFreeDelivery !== false;
    const freeDelivStr = freeDelivWithCoupon ? ' + Free Delivery' : (freeDeliveryEnabled && freeDeliveryThreshold > 0 ? ` + Free Delivery over ₹${Math.round(freeDeliveryThreshold)}` : '');

    const rawTitle = settings.offerTitle || `Craving Savera? Get ${discountTag} Today!`;
    const title = rawTitle.replace(/SMM Taj|SMM/gi, 'Savera');

    // 1. Top Announcement Bar
    const safeCode = escapeHtml(code);
    const announcementPromoWrap = document.getElementById('announcement-promo-wrap');
    if (announcementPromoWrap) {
      if (isActive) {
        announcementPromoWrap.style.display = '';
        announcementPromoWrap.innerHTML = `🎉 Welcome Offer: Use code <strong class="promo-pill" id="announcement-promo-code">${safeCode}</strong> for ${discountTag}${minOrderStr}!`;
        announcementPromoWrap.style.cursor = 'pointer';
        announcementPromoWrap.title = 'Click to copy coupon code';
        announcementPromoWrap.onclick = copyActivePromoCode;
      } else {
        announcementPromoWrap.style.display = 'none';
      }
    }

    // 2. Menu Promo Banner
    const promoBannerCard = document.getElementById('promo-banner-card');
    const promoBannerHeadline = document.getElementById('promo-banner-headline');
    const promoBannerText = document.getElementById('promo-banner-text');
    const btnClaimOffer = document.getElementById('btn-claim-offer');
    if (promoBannerCard) {
      if (isActive) {
        promoBannerCard.style.display = 'flex';
        if (promoBannerHeadline) promoBannerHeadline.textContent = title;
        if (promoBannerText) {
          const promoDesc = `Use coupon code <strong class="copyable-code" id="promo-code-btn" title="Click to copy">${safeCode}</strong> at checkout for ${discountTag}${minOrderStr}${freeDelivStr}.`;
          promoBannerText.innerHTML = promoDesc;
          const newBtn = document.getElementById('promo-code-btn');
          if (newBtn) newBtn.addEventListener('click', copyActivePromoCode);
        }
        if (btnClaimOffer) {
          btnClaimOffer.innerHTML = `Claim ${discountTag} Now 🍗`;
          btnClaimOffer.onclick = claimActivePromoCode;
        }
      } else {
        promoBannerCard.style.display = 'none';
      }
    }

    // 3. Offers Modal
    const offersModalTag = document.getElementById('offers-modal-tag') || document.querySelector('.offers-modal-tag');
    const offersModalHeadline = document.getElementById('offers-modal-headline');
    const offersModalText = document.getElementById('offers-modal-text') || document.querySelector('.offers-modal-text');
    const offersModalClaimBtn = document.getElementById('offers-modal-claim-btn');
    const offersModalTimer = document.getElementById('offers-modal-timer') || document.querySelector('.offers-modal-timer');

    if (isActive) {
      if (offersModalTag) offersModalTag.textContent = 'LIMITED TIME SPECIAL';
      if (offersModalHeadline) offersModalHeadline.textContent = title;
      if (offersModalText) {
        const modalDesc = `Use coupon code <strong class="copyable-code offers-code-pill" id="offers-modal-code-btn" title="Click to copy">${safeCode}</strong> at checkout for ${discountTag}${minOrderStr}${freeDelivStr}.`;
        offersModalText.innerHTML = modalDesc;
        const newModalBtn = document.getElementById('offers-modal-code-btn');
        if (newModalBtn) newModalBtn.addEventListener('click', copyActivePromoCode);
      }
      if (offersModalClaimBtn) {
        offersModalClaimBtn.style.display = 'inline-flex';
        offersModalClaimBtn.innerHTML = `Claim ${discountTag} Discount 🍗`;
        offersModalClaimBtn.onclick = claimActivePromoCode;
      }
      if (offersModalTimer) offersModalTimer.style.display = 'inline';
    } else {
      if (offersModalTag) offersModalTag.textContent = 'COMING SOON';
      if (offersModalHeadline) offersModalHeadline.textContent = 'Currently No Offers • Coming Soon';
      if (offersModalText) {
        offersModalText.textContent = 'Currently no active offers. Exciting discounts & delicious promotions are coming soon!';
      }
      if (offersModalClaimBtn) offersModalClaimBtn.style.display = 'none';
      if (offersModalTimer) offersModalTimer.style.display = 'none';
    }

    // 4. Cart promo input placeholder
    if (cartPromoInput) {
      cartPromoInput.placeholder = isActive ? `Promo code (try ${code})` : 'Promo code';
    }

    // If active promo changed or disabled, re-render cart
    if (appliedPromo && appliedPromo !== code) {
      appliedPromo = isActive ? code : null;
    }
    renderCart();
  }

  // Initialize store status and offers (ticker starts automatically only if kitchen rush is active)
  updateStoreStatusUI();
  updateStoreOfferUI();

  // Brand Header Google Maps Location Trigger
  const brandAddressSubtitle = document.getElementById('brand-address-subtitle');
  if (brandAddressSubtitle) {
    brandAddressSubtitle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.open('https://www.google.com/maps/place/Savera+Paradise/@12.7208854,77.2805119,17z', '_blank', 'noopener,noreferrer');
    });
  }

  // Register DOM fallback checkers for bulletproof single-step back navigation
  backNav.registerFallbackChecker({
    isOpen: () => modalAddressBackdrop && modalAddressBackdrop.classList.contains('open'),
    close: () => closeAddressModal()
  });
  backNav.registerFallbackChecker({
    isOpen: () => modalCheckoutBackdrop && modalCheckoutBackdrop.classList.contains('open'),
    close: () => closeCheckoutModal()
  });
  backNav.registerFallbackChecker({
    isOpen: () => authModalBackdrop && authModalBackdrop.classList.contains('open'),
    close: () => closeAuthModal()
  });
  backNav.registerFallbackChecker({
    isOpen: () => modalMyOrdersBackdrop && modalMyOrdersBackdrop.classList.contains('open'),
    close: () => closeMyOrdersModal()
  });
  backNav.registerFallbackChecker({
    isOpen: () => orderModalBackdrop && orderModalBackdrop.classList.contains('open'),
    close: () => closeOrderModal()
  });
  backNav.registerFallbackChecker({
    isOpen: () => offersModalBackdrop && offersModalBackdrop.classList.contains('open'),
    close: () => closeOffersModal()
  });
  backNav.registerFallbackChecker({
    isOpen: () => foodDetailBackdrop && foodDetailBackdrop.classList.contains('open'),
    close: () => closeFoodDetail()
  });
  backNav.registerFallbackChecker({
    isOpen: () => cartDrawer && cartDrawer.classList.contains('open'),
    close: () => closeCartDrawer()
  });
  backNav.registerFallbackChecker({
    isOpen: () => mobileNavDrawer && mobileNavDrawer.classList.contains('open'),
    close: () => closeMobileMenu()
  });
  // Prevent accidental exit when on main food menu
  backNav.setBaseBackHandler(() => {
    showToast('👋 Press back again to exit Savera Paradise', 'info');
  });

  // Initial render
  renderCart();
  updateHeroDeliveryDistanceBadge();
});
