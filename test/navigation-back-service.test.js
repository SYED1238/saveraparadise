/**
 * Tests for navigationBackService.js
 * Covers NavigationBackManager class and createBackNavigationManager factory.
 *
 * Run:  node --test test/navigation-back-service.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Mock browser globals for Node.js test environment ──────────────────────
globalThis.window = globalThis;
globalThis.history = {
  state: null,
  replaceState(state) { this.state = state; },
  pushState(state) { this.state = state; },
  back() {}
};
globalThis.location = { href: 'http://localhost/', pathname: '/' };
globalThis.addEventListener = function() {};
globalThis.removeEventListener = function() {};
globalThis.document = { title: 'Test', hidden: false, hasFocus: () => true };

// ── Import module under test (after globals are set) ───────────────────────
const { NavigationBackManager, createBackNavigationManager } = await import('../navigationBackService.js');

// ── Helpers ────────────────────────────────────────────────────────────────
/** Return a fresh manager with history spies reset */
function freshManager(name = 'test-portal') {
  // Reset history state between tests
  globalThis.history.state = null;
  return new NavigationBackManager(name);
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Factory function
// ═══════════════════════════════════════════════════════════════════════════

test('createBackNavigationManager returns a NavigationBackManager instance', () => {
  const mgr = createBackNavigationManager('storefront');
  assert.ok(mgr instanceof NavigationBackManager);
});

test('createBackNavigationManager passes portalName to the instance', () => {
  const mgr = createBackNavigationManager('admin');
  assert.equal(mgr.portalName, 'admin');
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Constructor
// ═══════════════════════════════════════════════════════════════════════════

test('constructor sets portalName and initialises empty stack', () => {
  const mgr = freshManager('my-portal');
  assert.equal(mgr.portalName, 'my-portal');
  assert.ok(Array.isArray(mgr.stack));
  assert.equal(mgr.stack.length, 0);
  assert.equal(mgr.pendingManualPops, 0);
  assert.ok(Array.isArray(mgr.fallbackCheckers));
  assert.equal(mgr.fallbackCheckers.length, 0);
  assert.equal(mgr.baseBackHandler, null);
});

test('constructor uses default portalName "portal" when none provided', () => {
  const mgr = new NavigationBackManager();
  assert.equal(mgr.portalName, 'portal');
});

// ═══════════════════════════════════════════════════════════════════════════
// 3–7. pushStep
// ═══════════════════════════════════════════════════════════════════════════

test('pushStep adds a step to the stack', () => {
  const mgr = freshManager();
  const close = () => {};
  mgr.pushStep('cart-drawer', close);
  assert.equal(mgr.stack.length, 1);
  assert.equal(mgr.stack[0].stepId, 'cart-drawer');
  assert.equal(mgr.stack[0].closeFn, close);
});

test('pushStep stores restoreFn when provided', () => {
  const mgr = freshManager();
  const restore = () => {};
  mgr.pushStep('detail-view', () => {}, restore);
  assert.equal(mgr.stack[0].restoreFn, restore);
});

test('pushStep sets restoreFn to null when not provided', () => {
  const mgr = freshManager();
  mgr.pushStep('detail-view', () => {});
  assert.equal(mgr.stack[0].restoreFn, null);
});

test('pushStep sets restoreFn to null when non-function is provided', () => {
  const mgr = freshManager();
  mgr.pushStep('detail-view', () => {}, 'not-a-function');
  assert.equal(mgr.stack[0].restoreFn, null);
});

test('pushStep ignores falsy stepId (empty string)', () => {
  const mgr = freshManager();
  mgr.pushStep('', () => {});
  assert.equal(mgr.stack.length, 0);
});

test('pushStep ignores falsy stepId (null)', () => {
  const mgr = freshManager();
  mgr.pushStep(null, () => {});
  assert.equal(mgr.stack.length, 0);
});

test('pushStep ignores falsy stepId (undefined)', () => {
  const mgr = freshManager();
  mgr.pushStep(undefined, () => {});
  assert.equal(mgr.stack.length, 0);
});

test('pushStep ignores falsy stepId (0)', () => {
  const mgr = freshManager();
  mgr.pushStep(0, () => {});
  assert.equal(mgr.stack.length, 0);
});

test('pushStep ignores non-function closeFn', () => {
  const mgr = freshManager();
  mgr.pushStep('drawer', 'not-a-function');
  assert.equal(mgr.stack.length, 0);
});

test('pushStep ignores when closeFn is null', () => {
  const mgr = freshManager();
  mgr.pushStep('drawer', null);
  assert.equal(mgr.stack.length, 0);
});

test('pushStep ignores when closeFn is undefined', () => {
  const mgr = freshManager();
  mgr.pushStep('drawer', undefined);
  assert.equal(mgr.stack.length, 0);
});

test('pushStep with same stepId at top updates closeFn', () => {
  const mgr = freshManager();
  const originalClose = () => 'original';
  const updatedClose = () => 'updated';
  mgr.pushStep('modal', originalClose);
  assert.equal(mgr.stack.length, 1);

  mgr.pushStep('modal', updatedClose);
  // Stack size must NOT grow
  assert.equal(mgr.stack.length, 1);
  assert.equal(mgr.stack[0].closeFn, updatedClose);
});

test('pushStep with same stepId at top updates restoreFn when provided', () => {
  const mgr = freshManager();
  const restore1 = () => {};
  const restore2 = () => {};
  mgr.pushStep('modal', () => {}, restore1);
  mgr.pushStep('modal', () => {}, restore2);
  assert.equal(mgr.stack[0].restoreFn, restore2);
});

test('pushStep with same stepId at top keeps old restoreFn when new one is falsy', () => {
  const mgr = freshManager();
  const restore = () => {};
  mgr.pushStep('modal', () => {}, restore);
  mgr.pushStep('modal', () => {}); // no restoreFn => default null, but code only updates if truthy
  assert.equal(mgr.stack[0].restoreFn, restore);
});

test('pushStep with stepId lower in stack moves it to top', () => {
  const mgr = freshManager();
  mgr.pushStep('step-a', () => {});
  mgr.pushStep('step-b', () => {});
  mgr.pushStep('step-c', () => {});
  assert.equal(mgr.stack.length, 3);

  const newClose = () => 'moved';
  mgr.pushStep('step-a', newClose);
  // Old 'step-a' removed from index 0, new one pushed on top
  assert.equal(mgr.stack.length, 3);
  assert.equal(mgr.stack[mgr.stack.length - 1].stepId, 'step-a');
  assert.equal(mgr.stack[mgr.stack.length - 1].closeFn, newClose);
  // Original position should now be step-b
  assert.equal(mgr.stack[0].stepId, 'step-b');
});

test('pushStep calls window.history.pushState', () => {
  const mgr = freshManager();
  let pushCalled = false;
  const origPush = globalThis.history.pushState.bind(globalThis.history);
  globalThis.history.pushState = (state) => { pushCalled = true; origPush(state); };
  mgr.pushStep('drawer', () => {});
  assert.ok(pushCalled);
  // Restore
  globalThis.history.pushState = origPush;
});

// ═══════════════════════════════════════════════════════════════════════════
// 8–9. replaceTopStep
// ═══════════════════════════════════════════════════════════════════════════

test('replaceTopStep replaces the top entry', () => {
  const mgr = freshManager();
  mgr.pushStep('old-step', () => {});
  const newClose = () => 'replaced';
  mgr.replaceTopStep('new-step', newClose);
  assert.equal(mgr.stack.length, 1);
  assert.equal(mgr.stack[0].stepId, 'new-step');
  assert.equal(mgr.stack[0].closeFn, newClose);
});

test('replaceTopStep on empty stack pushes a new entry', () => {
  const mgr = freshManager();
  assert.equal(mgr.stack.length, 0);
  const close = () => {};
  mgr.replaceTopStep('first', close);
  assert.equal(mgr.stack.length, 1);
  assert.equal(mgr.stack[0].stepId, 'first');
});

test('replaceTopStep ignores falsy stepId', () => {
  const mgr = freshManager();
  mgr.pushStep('existing', () => {});
  mgr.replaceTopStep('', () => {});
  assert.equal(mgr.stack[0].stepId, 'existing');
});

test('replaceTopStep ignores non-function closeFn', () => {
  const mgr = freshManager();
  mgr.pushStep('existing', () => {});
  mgr.replaceTopStep('new', 'not-fn');
  assert.equal(mgr.stack[0].stepId, 'existing');
});

test('replaceTopStep stores restoreFn when provided', () => {
  const mgr = freshManager();
  const restore = () => {};
  mgr.pushStep('old', () => {});
  mgr.replaceTopStep('new', () => {}, restore);
  assert.equal(mgr.stack[0].restoreFn, restore);
});

test('replaceTopStep sets restoreFn to null when non-function provided', () => {
  const mgr = freshManager();
  mgr.pushStep('old', () => {});
  mgr.replaceTopStep('new', () => {}, 42);
  assert.equal(mgr.stack[0].restoreFn, null);
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. isTopStep
// ═══════════════════════════════════════════════════════════════════════════

test('isTopStep returns true for the top step', () => {
  const mgr = freshManager();
  mgr.pushStep('bottom', () => {});
  mgr.pushStep('top', () => {});
  assert.equal(mgr.isTopStep('top'), true);
});

test('isTopStep returns false for a non-top step', () => {
  const mgr = freshManager();
  mgr.pushStep('bottom', () => {});
  mgr.pushStep('top', () => {});
  assert.equal(mgr.isTopStep('bottom'), false);
});

test('isTopStep returns false for non-existent step', () => {
  const mgr = freshManager();
  mgr.pushStep('only', () => {});
  assert.equal(mgr.isTopStep('ghost'), false);
});

test('isTopStep returns false on empty stack', () => {
  const mgr = freshManager();
  assert.equal(mgr.isTopStep('anything'), false);
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. hasStep
// ═══════════════════════════════════════════════════════════════════════════

test('hasStep finds step at top of stack', () => {
  const mgr = freshManager();
  mgr.pushStep('a', () => {});
  mgr.pushStep('b', () => {});
  assert.equal(mgr.hasStep('b'), true);
});

test('hasStep finds step in middle of stack', () => {
  const mgr = freshManager();
  mgr.pushStep('a', () => {});
  mgr.pushStep('b', () => {});
  mgr.pushStep('c', () => {});
  assert.equal(mgr.hasStep('b'), true);
});

test('hasStep finds step at bottom of stack', () => {
  const mgr = freshManager();
  mgr.pushStep('a', () => {});
  mgr.pushStep('b', () => {});
  assert.equal(mgr.hasStep('a'), true);
});

test('hasStep returns false for non-existent step', () => {
  const mgr = freshManager();
  mgr.pushStep('a', () => {});
  assert.equal(mgr.hasStep('z'), false);
});

test('hasStep returns false on empty stack', () => {
  const mgr = freshManager();
  assert.equal(mgr.hasStep('any'), false);
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. clearStack
// ═══════════════════════════════════════════════════════════════════════════

test('clearStack empties the stack', () => {
  const mgr = freshManager();
  mgr.pushStep('a', () => {});
  mgr.pushStep('b', () => {});
  mgr.pushStep('c', () => {});
  assert.equal(mgr.stack.length, 3);
  mgr.clearStack();
  assert.equal(mgr.stack.length, 0);
});

test('clearStack on already-empty stack is a no-op', () => {
  const mgr = freshManager();
  mgr.clearStack();
  assert.equal(mgr.stack.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// 13–14. removeStepDirect
// ═══════════════════════════════════════════════════════════════════════════

test('removeStepDirect removes from middle of stack', () => {
  const mgr = freshManager();
  mgr.pushStep('a', () => {});
  mgr.pushStep('b', () => {});
  mgr.pushStep('c', () => {});
  mgr.removeStepDirect('b');
  assert.equal(mgr.stack.length, 2);
  assert.equal(mgr.hasStep('b'), false);
  assert.equal(mgr.stack[0].stepId, 'a');
  assert.equal(mgr.stack[1].stepId, 'c');
});

test('removeStepDirect removes from top of stack', () => {
  const mgr = freshManager();
  mgr.pushStep('a', () => {});
  mgr.pushStep('b', () => {});
  mgr.removeStepDirect('b');
  assert.equal(mgr.stack.length, 1);
  assert.equal(mgr.isTopStep('a'), true);
});

test('removeStepDirect removes from bottom of stack', () => {
  const mgr = freshManager();
  mgr.pushStep('a', () => {});
  mgr.pushStep('b', () => {});
  mgr.removeStepDirect('a');
  assert.equal(mgr.stack.length, 1);
  assert.equal(mgr.stack[0].stepId, 'b');
});

test('removeStepDirect with non-existent stepId does nothing', () => {
  const mgr = freshManager();
  mgr.pushStep('a', () => {});
  mgr.removeStepDirect('ghost');
  assert.equal(mgr.stack.length, 1);
});

test('removeStepDirect on empty stack does nothing', () => {
  const mgr = freshManager();
  mgr.removeStepDirect('ghost');
  assert.equal(mgr.stack.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// removeStep
// ═══════════════════════════════════════════════════════════════════════════

test('removeStep on top step calls stepBack', () => {
  const mgr = freshManager();
  let backCalled = false;
  const origBack = globalThis.history.back;
  globalThis.history.back = () => { backCalled = true; };
  mgr.pushStep('top', () => {});
  mgr.removeStep('top');
  assert.ok(backCalled);
  globalThis.history.back = origBack;
});

test('removeStep on non-top step removes it directly from stack', () => {
  const mgr = freshManager();
  mgr.pushStep('a', () => {});
  mgr.pushStep('b', () => {});
  mgr.removeStep('a');
  assert.equal(mgr.stack.length, 1);
  assert.equal(mgr.hasStep('a'), false);
});

test('removeStep with non-existent stepId does nothing', () => {
  const mgr = freshManager();
  mgr.pushStep('a', () => {});
  mgr.removeStep('ghost');
  assert.equal(mgr.stack.length, 1);
});

// ═══════════════════════════════════════════════════════════════════════════
// 15–17. hasActiveSteps
// ═══════════════════════════════════════════════════════════════════════════

test('hasActiveSteps returns true when stack has items', () => {
  const mgr = freshManager();
  mgr.pushStep('a', () => {});
  assert.equal(mgr.hasActiveSteps(), true);
});

test('hasActiveSteps returns false when stack is empty and no checkers', () => {
  const mgr = freshManager();
  assert.equal(mgr.hasActiveSteps(), false);
});

test('hasActiveSteps returns true when a fallback checker reports open', () => {
  const mgr = freshManager();
  mgr.registerFallbackChecker({ isOpen: () => true, close: () => {} });
  assert.equal(mgr.hasActiveSteps(), true);
});

test('hasActiveSteps returns false when all fallback checkers report closed', () => {
  const mgr = freshManager();
  mgr.registerFallbackChecker({ isOpen: () => false, close: () => {} });
  assert.equal(mgr.hasActiveSteps(), false);
});

test('hasActiveSteps survives a throwing fallback checker', () => {
  const mgr = freshManager();
  mgr.registerFallbackChecker({
    isOpen: () => { throw new Error('boom'); },
    close: () => {}
  });
  // Should not throw, should return false since the checker errored
  assert.equal(mgr.hasActiveSteps(), false);
});

// ═══════════════════════════════════════════════════════════════════════════
// 18–19. registerFallbackChecker
// ═══════════════════════════════════════════════════════════════════════════

test('registerFallbackChecker adds valid checker', () => {
  const mgr = freshManager();
  const checker = { isOpen: () => false, close: () => {} };
  mgr.registerFallbackChecker(checker);
  assert.equal(mgr.fallbackCheckers.length, 1);
  assert.equal(mgr.fallbackCheckers[0], checker);
});

test('registerFallbackChecker ignores checker missing isOpen', () => {
  const mgr = freshManager();
  mgr.registerFallbackChecker({ close: () => {} });
  assert.equal(mgr.fallbackCheckers.length, 0);
});

test('registerFallbackChecker ignores checker missing close', () => {
  const mgr = freshManager();
  mgr.registerFallbackChecker({ isOpen: () => true });
  assert.equal(mgr.fallbackCheckers.length, 0);
});

test('registerFallbackChecker ignores null', () => {
  const mgr = freshManager();
  mgr.registerFallbackChecker(null);
  assert.equal(mgr.fallbackCheckers.length, 0);
});

test('registerFallbackChecker ignores undefined', () => {
  const mgr = freshManager();
  mgr.registerFallbackChecker(undefined);
  assert.equal(mgr.fallbackCheckers.length, 0);
});

test('registerFallbackChecker ignores non-object', () => {
  const mgr = freshManager();
  mgr.registerFallbackChecker('bad');
  assert.equal(mgr.fallbackCheckers.length, 0);
});

test('registerFallbackChecker ignores checker with non-function isOpen', () => {
  const mgr = freshManager();
  mgr.registerFallbackChecker({ isOpen: true, close: () => {} });
  assert.equal(mgr.fallbackCheckers.length, 0);
});

test('registerFallbackChecker ignores checker with non-function close', () => {
  const mgr = freshManager();
  mgr.registerFallbackChecker({ isOpen: () => true, close: 'nope' });
  assert.equal(mgr.fallbackCheckers.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// 20–21. executeFallbackDOMClose
// ═══════════════════════════════════════════════════════════════════════════

test('executeFallbackDOMClose calls close on first open checker and returns true', () => {
  const mgr = freshManager();
  let closedId = null;
  mgr.registerFallbackChecker({ isOpen: () => true, close: () => { closedId = 'first'; } });
  mgr.registerFallbackChecker({ isOpen: () => true, close: () => { closedId = 'second'; } });
  const result = mgr.executeFallbackDOMClose();
  assert.equal(result, true);
  assert.equal(closedId, 'first'); // Only the first open checker should be closed
});

test('executeFallbackDOMClose returns false when no checkers are open', () => {
  const mgr = freshManager();
  mgr.registerFallbackChecker({ isOpen: () => false, close: () => {} });
  const result = mgr.executeFallbackDOMClose();
  assert.equal(result, false);
});

test('executeFallbackDOMClose returns false when no checkers registered', () => {
  const mgr = freshManager();
  assert.equal(mgr.executeFallbackDOMClose(), false);
});

test('executeFallbackDOMClose skips erroring checker and tries next', () => {
  const mgr = freshManager();
  let secondClosed = false;
  mgr.registerFallbackChecker({
    isOpen: () => { throw new Error('broken'); },
    close: () => {}
  });
  mgr.registerFallbackChecker({
    isOpen: () => true,
    close: () => { secondClosed = true; }
  });
  const result = mgr.executeFallbackDOMClose();
  assert.equal(result, true);
  assert.equal(secondClosed, true);
});

// ═══════════════════════════════════════════════════════════════════════════
// 22–24. handlePopState
// ═══════════════════════════════════════════════════════════════════════════

test('handlePopState pops top step and calls closeFn', () => {
  const mgr = freshManager();
  let closed = false;
  mgr.pushStep('modal', () => { closed = true; });
  mgr.handlePopState({});
  assert.equal(closed, true);
  assert.equal(mgr.stack.length, 0);
});

test('handlePopState skips when pendingManualPops > 0', () => {
  const mgr = freshManager();
  let closed = false;
  mgr.pushStep('modal', () => { closed = true; });
  mgr.pendingManualPops = 1;
  mgr.handlePopState({});
  assert.equal(closed, false);
  assert.equal(mgr.stack.length, 1);
  assert.equal(mgr.pendingManualPops, 0);
});

test('handlePopState decrements pendingManualPops correctly', () => {
  const mgr = freshManager();
  mgr.pushStep('modal', () => {});
  mgr.pendingManualPops = 3;
  mgr.handlePopState({});
  assert.equal(mgr.pendingManualPops, 2);
  mgr.handlePopState({});
  assert.equal(mgr.pendingManualPops, 1);
  mgr.handlePopState({});
  assert.equal(mgr.pendingManualPops, 0);
});

test('handlePopState calls restoreFn on new top step', () => {
  const mgr = freshManager();
  let restored = false;
  mgr.pushStep('parent', () => {}, () => { restored = true; });
  mgr.pushStep('child', () => {});
  mgr.handlePopState({});
  assert.equal(restored, true);
  assert.equal(mgr.stack.length, 1);
  assert.equal(mgr.stack[0].stepId, 'parent');
});

test('handlePopState does not call restoreFn if new top has none', () => {
  const mgr = freshManager();
  mgr.pushStep('parent', () => {}); // no restoreFn
  mgr.pushStep('child', () => {});
  // Should not throw
  mgr.handlePopState({});
  assert.equal(mgr.stack.length, 1);
});

test('handlePopState on empty stack calls executeFallbackDOMClose', () => {
  const mgr = freshManager();
  let fallbackClosed = false;
  mgr.registerFallbackChecker({ isOpen: () => true, close: () => { fallbackClosed = true; } });
  mgr.handlePopState({});
  assert.equal(fallbackClosed, true);
});

test('handlePopState on empty stack with no fallbacks calls _handleBaseBack', () => {
  const mgr = freshManager();
  let baseHandlerCalled = false;
  mgr.setBaseBackHandler(() => { baseHandlerCalled = true; });
  // Reset lastBaseBackTime to ensure single-back path is taken
  mgr.lastBaseBackTime = 0;
  mgr.handlePopState({});
  assert.equal(baseHandlerCalled, true);
});

test('handlePopState survives closeFn that throws', () => {
  const mgr = freshManager();
  mgr.pushStep('errorer', () => { throw new Error('close failed'); });
  // Should not throw out of handlePopState
  mgr.handlePopState({});
  assert.equal(mgr.stack.length, 0);
});

test('handlePopState survives restoreFn that throws', () => {
  const mgr = freshManager();
  mgr.pushStep('parent', () => {}, () => { throw new Error('restore failed'); });
  mgr.pushStep('child', () => {});
  // Should not throw
  mgr.handlePopState({});
  assert.equal(mgr.stack.length, 1);
});

// ═══════════════════════════════════════════════════════════════════════════
// stepBack
// ═══════════════════════════════════════════════════════════════════════════

test('stepBack calls history.back when stack has items', () => {
  const mgr = freshManager();
  let backCalled = false;
  const origBack = globalThis.history.back;
  globalThis.history.back = () => { backCalled = true; };
  mgr.pushStep('step', () => {});
  mgr.stepBack();
  assert.ok(backCalled);
  globalThis.history.back = origBack;
});

test('stepBack calls executeFallbackDOMClose when stack is empty', () => {
  const mgr = freshManager();
  let fallbackClosed = false;
  mgr.registerFallbackChecker({ isOpen: () => true, close: () => { fallbackClosed = true; } });
  mgr.stepBack();
  assert.ok(fallbackClosed);
});

// ═══════════════════════════════════════════════════════════════════════════
// 25–26. setBaseBackHandler
// ═══════════════════════════════════════════════════════════════════════════

test('setBaseBackHandler sets the handler function', () => {
  const mgr = freshManager();
  const handler = () => {};
  mgr.setBaseBackHandler(handler);
  assert.equal(mgr.baseBackHandler, handler);
});

test('setBaseBackHandler ignores non-function argument (string)', () => {
  const mgr = freshManager();
  mgr.setBaseBackHandler('not-a-function');
  assert.equal(mgr.baseBackHandler, null);
});

test('setBaseBackHandler ignores non-function argument (null)', () => {
  const mgr = freshManager();
  mgr.setBaseBackHandler(null);
  assert.equal(mgr.baseBackHandler, null);
});

test('setBaseBackHandler ignores non-function argument (number)', () => {
  const mgr = freshManager();
  mgr.setBaseBackHandler(42);
  assert.equal(mgr.baseBackHandler, null);
});

test('setBaseBackHandler replaces previous handler', () => {
  const mgr = freshManager();
  const first = () => 'first';
  const second = () => 'second';
  mgr.setBaseBackHandler(first);
  assert.equal(mgr.baseBackHandler, first);
  mgr.setBaseBackHandler(second);
  assert.equal(mgr.baseBackHandler, second);
});
