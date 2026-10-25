/**
 * Navigation Back Service
 * Provides native mobile-app-like single-step back navigation for all portals
 * (Storefront, Admin Hub, Rider/Delivery Portal).
 *
 * Prevents full page exit when any modal, drawer, drill-down category, or subview
 * is open. Instead, pressing the browser back button, Android gesture/back button,
 * or keyboard Escape steps back exactly ONE level at a time.
 */

export class NavigationBackManager {
  constructor(portalName = 'portal') {
    this.portalName = portalName;
    this.stack = [];
    this.pendingManualPops = 0;
    this.fallbackCheckers = [];
    this.baseBackHandler = null;
    this.lastBaseBackTime = 0;

    this._initBaseHistory();
    this._bindEvents();
  }

  _initBaseHistory() {
    try {
      if (!window.history.state || !window.history.state.portal) {
        window.history.replaceState({ portal: this.portalName, isBase: true }, '', window.location.href);
      }
    } catch (err) {
      console.warn('[NavBack] initBaseHistory warning:', err);
    }
  }

  _bindEvents() {
    window.addEventListener('popstate', (e) => {
      this.handlePopState(e);
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.hasActiveSteps()) {
          e.preventDefault();
          this.stepBack();
        }
      }
    });
  }

  /**
   * Push a step onto the virtual back stack and record a history entry
   * so the browser's hardware/software Back button will intercept it.
   * @param {string} stepId Unique ID for this step (e.g. 'cart-drawer', 'checkout-modal')
   * @param {Function} closeFn Callback to close this specific step
   * @param {Function} [restoreFn] Optional callback to restore this step if a child step is popped
   */
  pushStep(stepId, closeFn, restoreFn = null) {
    if (!stepId || typeof closeFn !== 'function') return;

    // Check if this step is already the top of the stack
    const currentTop = this.stack[this.stack.length - 1];
    if (currentTop && currentTop.stepId === stepId) {
      currentTop.closeFn = closeFn;
      if (restoreFn) currentTop.restoreFn = restoreFn;
      return;
    }

    // Ensure base state exists before first step
    if (this.stack.length === 0) {
      this._initBaseHistory();
    }

    // If step exists lower in the stack, remove earlier instance
    const existingIdx = this.stack.findIndex(s => s.stepId === stepId);
    if (existingIdx !== -1) {
      this.stack.splice(existingIdx, 1);
    }

    const entry = {
      stepId,
      closeFn,
      restoreFn: typeof restoreFn === 'function' ? restoreFn : null,
      time: Date.now()
    };
    this.stack.push(entry);

    try {
      window.history.pushState(
        { portal: this.portalName, stepId, depth: this.stack.length, timestamp: entry.time },
        '',
        window.location.href
      );
    } catch (err) {
      console.warn('[NavBack] pushState warning:', err);
    }
  }

  /**
   * Replace the top step of the stack without increasing history depth.
   * Useful when transitioning between sibling views (e.g. address -> checkout).
   */
  replaceTopStep(stepId, closeFn, restoreFn = null) {
    if (!stepId || typeof closeFn !== 'function') return;

    const entry = {
      stepId,
      closeFn,
      restoreFn: typeof restoreFn === 'function' ? restoreFn : null,
      time: Date.now()
    };

    if (this.stack.length > 0) {
      this.stack[this.stack.length - 1] = entry;
    } else {
      this.stack.push(entry);
    }

    try {
      window.history.replaceState(
        { portal: this.portalName, stepId, depth: this.stack.length, timestamp: entry.time },
        '',
        window.location.href
      );
    } catch (err) {
      console.warn('[NavBack] replaceState warning:', err);
    }
  }

  /**
   * Check if the specified step is currently the top of the stack
   */
  isTopStep(stepId) {
    return this.stack.length > 0 && this.stack[this.stack.length - 1].stepId === stepId;
  }

  /**
   * Check if the step exists anywhere in the stack
   */
  hasStep(stepId) {
    return this.stack.some(s => s.stepId === stepId);
  }

  /**
   * Clear all steps in virtual stack
   */
  clearStack() {
    this.stack = [];
  }

  /**
   * Call when an overlay/step is closed manually via on-screen UI
   * (e.g. clicking ✕ close button, Cancel, or Save).
   * If this step is at the top of the stack, triggers stepBack() to unwind history cleanly.
   * @param {string} stepId
   */
  removeStep(stepId) {
    if (this.isTopStep(stepId)) {
      this.stepBack();
      return;
    }

    const idx = this.stack.findIndex(s => s.stepId === stepId);
    if (idx !== -1) {
      this.stack.splice(idx, 1);
    }
  }

  /**
   * Silently remove a step from the stack without touching window.history.
   * Useful when transitioning immediately between modals (e.g. checkout -> order tracker).
   * @param {string} stepId
   */
  removeStepDirect(stepId) {
    const idx = this.stack.findIndex(s => s.stepId === stepId);
    if (idx !== -1) {
      this.stack.splice(idx, 1);
    }
  }

  /**
   * Has active steps or DOM overlays that should intercept Back
   */
  hasActiveSteps() {
    if (this.stack.length > 0) return true;
    for (const checker of this.fallbackCheckers) {
      try {
        if (checker.isOpen && checker.isOpen()) return true;
      } catch {}
    }
    return false;
  }

  /**
   * Trigger single step back programmatically
   */
  stepBack() {
    if (this.stack.length > 0) {
      window.history.back();
    } else {
      this.executeFallbackDOMClose();
    }
  }

  /**
   * Handle the popstate event from the browser
   */
  handlePopState(event) {
    if (this.pendingManualPops > 0) {
      this.pendingManualPops--;
      return;
    }

    if (this.stack.length > 0) {
      const topStep = this.stack.pop();
      if (topStep && typeof topStep.closeFn === 'function') {
        try {
          topStep.closeFn();
        } catch (err) {
          console.error(`[NavBack] Error closing step ${topStep.stepId}:`, err);
        }
      }

      // Check if there is a parent step remaining in the stack that should be restored
      const currentTop = this.stack[this.stack.length - 1];
      if (currentTop && typeof currentTop.restoreFn === 'function') {
        try {
          currentTop.restoreFn();
        } catch (err) {
          console.error(`[NavBack] Error restoring step ${currentTop.stepId}:`, err);
        }
      }
      return;
    }

    // Safety fallback: if stack was empty but a modal/view is physically open in DOM
    if (this.executeFallbackDOMClose()) {
      return;
    }

    // If at base root view: handle exit prevention
    this._handleBaseBack(event);
  }

  setBaseBackHandler(handler) {
    if (typeof handler === 'function') {
      this.baseBackHandler = handler;
    }
  }

  _handleBaseBack(event) {
    const now = Date.now();
    const isDoubleBack = this.lastBaseBackTime && (now - this.lastBaseBackTime) < 2500;

    if (isDoubleBack) {
      // User pressed back twice rapidly at base screen: allow browser to exit
      return;
    }

    // Single back at base screen: prevent accidental exit & re-anchor state
    try {
      window.history.pushState({ portal: this.portalName, isBase: true }, '', window.location.href);
    } catch {}
    this.lastBaseBackTime = now;

    if (typeof this.baseBackHandler === 'function') {
      try {
        this.baseBackHandler();
      } catch (err) {
        console.error('[NavBack] Base back handler error:', err);
      }
    }
  }

  /**
   * Register a custom fallback checker for DOM elements
   * @param {{ isOpen: Function, close: Function, priority?: number }} checker
   */
  registerFallbackChecker(checker) {
    if (checker && typeof checker.isOpen === 'function' && typeof checker.close === 'function') {
      this.fallbackCheckers.push(checker);
    }
  }

  executeFallbackDOMClose() {
    for (const checker of this.fallbackCheckers) {
      try {
        if (checker.isOpen()) {
          checker.close();
          // Keep history intact so user stays on the page
          try {
            window.history.pushState({ portal: this.portalName, fallbackSafe: true }, '', window.location.href);
          } catch {}
          return true;
        }
      } catch (err) {
        console.error('[NavBack] Fallback closer error:', err);
      }
    }
    return false;
  }
}

export function createBackNavigationManager(portalName) {
  return new NavigationBackManager(portalName);
}
