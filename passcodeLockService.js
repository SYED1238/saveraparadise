/**
 * iOS-Style Passcode Keypad Controller
 * Provides seamless on-screen circular keypad with glassmorphic blur,
 * 4-dot passcode indicator, haptic tap feedback, and auto-validation.
 * No on-screen keyboard required!
 */

export function initIosPasscodeLock(options) {
  const {
    overlayEl,
    dotsEl,
    keypadEl,
    subtitleEl,
    hintEl,
    defaultCode = '4422',
    onVerify,
    onSuccess
  } = options;

  if (!overlayEl || !dotsEl || !keypadEl) return null;

  let enteredPin = '';
  let isVerifying = false;
      overlayEl.classList.remove('unlocked');
      overlayEl.style.display = 'flex';
  let failedAttempts = 0;
  let lockoutUntil = 0;
  const defaultSubtitle = subtitleEl ? subtitleEl.textContent : 'Enter 4-digit passcode';

  function updateDots() {
    const dots = dotsEl.querySelectorAll('.ios-dot');
    dots.forEach((dot, idx) => {
      if (idx < enteredPin.length) {
        dot.classList.add('filled');
      } else {
        dot.classList.remove('filled');
      }
    });
  }

  function triggerHaptic(type = 'tap') {
    try {
      if (!navigator.vibrate) return;
      if (type === 'tap') navigator.vibrate(15);
      if (type === 'error') navigator.vibrate([60, 40, 60]);
      if (type === 'success') navigator.vibrate([30, 40, 30]);
    } catch {}
  }

  function flashKey(keyEl) {
    if (!keyEl) return;
    keyEl.classList.add('active-press');
    setTimeout(() => keyEl.classList.remove('active-press'), 140);
  }

  async function handleComplete() {
    if (isVerifying) return;
    isVerifying = true;
    const pinCompleted = enteredPin;

    try {
      const isValid = onVerify ? await onVerify(pinCompleted) : (pinCompleted === defaultCode);
      if (isValid) {
        failedAttempts = 0;
        lockoutUntil = 0;
        dotsEl.classList.add('success');
        triggerHaptic('success');
        if (subtitleEl) {
          subtitleEl.textContent = 'Passcode Verified';
          subtitleEl.classList.remove('error');
        }
        setTimeout(() => {
          overlayEl.classList.add('unlocked');
          overlayEl.style.display = 'none';
          if (onSuccess) onSuccess(pinCompleted);
          // Reset internal state for next session/lock
          setTimeout(() => {
            enteredPin = '';
            updateDots();
            dotsEl.classList.remove('success');
            if (subtitleEl) subtitleEl.textContent = defaultSubtitle;
            isVerifying = false;
          }, 350);
        }, 220);
      } else {
        failedAttempts += 1;
        if (failedAttempts >= 5) {
          lockoutUntil = Date.now() + 30000;
          setTimeout(() => {
            if (Date.now() >= lockoutUntil && subtitleEl) {
              lockoutUntil = 0;
              subtitleEl.textContent = defaultSubtitle;
              subtitleEl.classList.remove('error');
            }
          }, 30000);
        }
        dotsEl.classList.add('error');
        triggerHaptic('error');
        if (subtitleEl) {
          subtitleEl.textContent = failedAttempts >= 5 ? 'Too many attempts. Locked for 30s' : 'Incorrect Passcode';
          subtitleEl.classList.add('error');
        }
        setTimeout(() => {
          dotsEl.classList.remove('error');
          enteredPin = '';
          updateDots();
          if (subtitleEl) {
            subtitleEl.textContent = failedAttempts >= 5 ? 'Locked for 30 seconds' : defaultSubtitle;
            if (failedAttempts < 5) subtitleEl.classList.remove('error');
          }
          isVerifying = false;
        }, 500);
      }
    } catch (err) {
      console.error('[Passcode Auth Error]:', err);
      dotsEl.classList.add('error');
      setTimeout(() => {
        dotsEl.classList.remove('error');
        enteredPin = '';
        updateDots();
        isVerifying = false;
      }, 500);
    }
  }

  function enterDigit(digit) {
    if (isVerifying || enteredPin.length >= 4) return;
    if (lockoutUntil > Date.now()) {
      const remainingSecs = Math.ceil((lockoutUntil - Date.now()) / 1000);
      triggerHaptic('error');
      if (subtitleEl) {
        subtitleEl.textContent = `Too many attempts. Wait ${remainingSecs}s`;
        subtitleEl.classList.add('error');
      }
      return;
    }
    if (lockoutUntil > 0 && Date.now() >= lockoutUntil) {
      lockoutUntil = 0;
      if (subtitleEl) {
        subtitleEl.textContent = defaultSubtitle;
        subtitleEl.classList.remove('error');
      }
    }
    enteredPin += digit;
    updateDots();
    triggerHaptic('tap');

    if (enteredPin.length === 4) {
      handleComplete();
    }
  }

  function deleteDigit() {
    if (isVerifying || enteredPin.length === 0) return;
    enteredPin = enteredPin.slice(0, -1);
    updateDots();
    triggerHaptic('tap');
  }

  // Keypad click / touch listener
  keypadEl.addEventListener('click', (e) => {
    const keyBtn = e.target.closest('.ios-key');
    if (!keyBtn) return;
    flashKey(keyBtn);

    const digit = keyBtn.getAttribute('data-key');
    const action = keyBtn.getAttribute('data-action');

    if (digit !== null) {
      enterDigit(digit);
    } else if (action === 'delete') {
      deleteDigit();
    }
  });

  // Security hardening: disabled auto-fill passcode on hint click
  if (hintEl) {
    hintEl.removeAttribute('title');
  }

  // Physical keyboard support for desktop
  window.addEventListener('keydown', (e) => {
    if (overlayEl.classList.contains('unlocked')) return;
    if (e.key >= '0' && e.key <= '9') {
      const keyBtn = keypadEl.querySelector(`.ios-key[data-key="${e.key}"]`);
      if (keyBtn) flashKey(keyBtn);
      enterDigit(e.key);
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      const delBtn = keypadEl.querySelector('.ios-key[data-action="delete"]');
      if (delBtn) flashKey(delBtn);
      deleteDigit();
    }
  });

  return {
    reset() {
      enteredPin = '';
      updateDots();
      dotsEl.classList.remove('error', 'success');
      if (subtitleEl) {
        subtitleEl.textContent = defaultSubtitle;
        subtitleEl.classList.remove('error');
      }
      isVerifying = false;
      if (overlayEl) {
        overlayEl.style.display = 'flex';
      }
    }
  };
}
