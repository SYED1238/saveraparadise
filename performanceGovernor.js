/**
 * Savera Paradise — Adaptive Performance Governor
 * Zero-permission hardware detection & real-time frame rate (FPS) watchdog.
 * Dynamically scales UI fidelity between:
 *  - 'ultra'    : Full 24px glassmorphism, 4 ambient 3D jelly waves, ballistic cart flying animation, full confetti.
 *  - 'balanced' : Optimized 6-8px blur, static ambient color waves (saves GPU loops), smooth 60 FPS.
 *  - 'lite'     : 0% GPU blurs (clean solid acrylic), jelly waves hidden, instant cart feedback (ideal for 2GB/4GB or overloaded phones).
 */

class PerformanceGovernor {
  constructor() {
    this.STORAGE_KEY = 'savera_perf_override';
    this.currentTier = 'balanced'; // safe default
    this.fps = 60;
    this.isMonitoring = false;
    this.hudElement = null;

    // Detect hardware & initial tier
    this.initHardwareProfile();

    // Attach to DOM as early as possible
    this.applyTier(this.currentTier, false);

    // Setup live frame rate monitor
    this.startFpsWatchdog();

    // Check for debug HUD triggers (?perf_debug=1, ?perf_test=1, or triple-click logo)
    this.setupDebugTriggers();

    // Expose global controller
    if (typeof window !== 'undefined') {
      window.__perfGovernor = this;
      window.__setPerfTier = (tier) => this.setTier(tier, true);
      window.__getPerfStatus = () => this.getStatus();
      window.__perfTier = this.currentTier;
    }
  }

  /**
   * Hardware detection without requesting any user permissions.
   */
  initHardwareProfile() {
    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const urlOverride = params ? params.get('perf') : null;
    const storedOverride = typeof localStorage !== 'undefined' ? localStorage.getItem(this.STORAGE_KEY) : null;

    // Read silent hardware capabilities
    const ram = (typeof navigator !== 'undefined' && navigator.deviceMemory) ? navigator.deviceMemory : null;
    const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 4;
    const isSaveData = (typeof navigator !== 'undefined' && navigator.connection && navigator.connection.saveData);
    const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Sniff GPU if available (non-blocking, zero permission)
    let gpuRenderer = 'unknown';
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) {
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          gpuRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || 'generic';
        }
      }
    } catch (e) {}

    this.profile = {
      ram: ram ? `${ram} GB` : 'unspecified',
      ramNumeric: ram || 4,
      cores: cores,
      isSaveData: Boolean(isSaveData),
      prefersReducedMotion: Boolean(prefersReducedMotion),
      gpu: gpuRenderer
    };

    // 1. URL or LocalStorage override takes precedence (allows easy testing on flagship devices!)
    const targetOverride = (urlOverride || storedOverride || '').toLowerCase();
    if (['ultra', 'high'].includes(targetOverride)) {
      this.currentTier = 'ultra';
      this.isManual = true;
      return;
    }
    if (['balanced', 'mid', 'medium'].includes(targetOverride)) {
      this.currentTier = 'balanced';
      this.isManual = true;
      return;
    }
    if (['lite', 'low', 'potato'].includes(targetOverride)) {
      this.currentTier = 'lite';
      this.isManual = true;
      return;
    }

    // 2. Battery / Save-Data / Reduced Motion heuristic
    if (isSaveData || prefersReducedMotion) {
      this.currentTier = 'lite';
      return;
    }

    // 3. Automated Hardware Tiering
    // Flagships (e.g. Xiaomi 14/15/17 Ultra, Poco F6, iPhone 12+, 8GB+ RAM, 8-cores):
    if ((ram && ram >= 6) || (cores >= 8 && /adreno\s*(7|8)|mali-g7|apple/i.test(gpuRenderer))) {
      this.currentTier = 'ultra';
    } 
    // Standard Mid-Range (4GB - 6GB RAM, 6-8 cores):
    else if ((ram && ram >= 4) || cores >= 6) {
      this.currentTier = 'balanced';
    } 
    // Budget or Memory Constrained (<4GB RAM or <=4 cores):
    else {
      this.currentTier = 'lite';
    }
  }

  /**
   * Apply CSS classes to <html> root for seamless stylesheet styling
   */
  applyTier(tier, notify = true) {
    this.currentTier = tier;
    if (typeof window !== 'undefined') {
      window.__perfTier = tier;
    }

    if (typeof document !== 'undefined' && document.documentElement) {
      const root = document.documentElement;
      root.classList.remove('perf-tier-ultra', 'perf-tier-balanced', 'perf-tier-lite');
      root.classList.add(`perf-tier-${tier}`);
      root.setAttribute('data-perf-tier', tier);
    }

    if (this.hudElement) {
      this.updateHud();
    }

    if (notify && typeof window !== 'undefined' && window.showToast) {
      const labels = {
        ultra: '🚀 Ultra Mode (Full Glass & 3D Jellies)',
        balanced: '⚖️ Balanced Mode (Optimized 60 FPS)',
        lite: '🥔 Lite Mode (0% GPU Blurs / Super Fast)'
      };
      window.showToast(`Performance: ${labels[tier] || tier}`, 'info', { duration: 2500 });
    }
  }

  setTier(tier, persist = true) {
    if (!['ultra', 'balanced', 'lite'].includes(tier)) return;
    this.isManual = true;
    if (persist && typeof localStorage !== 'undefined') {
      localStorage.setItem(this.STORAGE_KEY, tier);
    }
    this.applyTier(tier, true);
  }

  resetAuto() {
    this.isManual = false;
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(this.STORAGE_KEY);
    }
    this.initHardwareProfile();
    this.applyTier(this.currentTier, true);
  }

  /**
   * Real-time frame rate (FPS) watchdog.
   * If background tasks on a 4GB/6GB phone cause heavy frame drops,
   * it steps down fidelity so the customer never suffers frozen touch input.
   */
  startFpsWatchdog() {
    if (typeof window === 'undefined' || typeof requestAnimationFrame === 'undefined') return;

    let lastTime = performance.now();
    let frameCount = 0;
    let fpsTimer = performance.now();
    let consecutiveJanks = 0;

    const loop = (now) => {
      const delta = now - lastTime;
      lastTime = now;
      frameCount++;

      // Frame time > 38ms corresponds to < 26 FPS (visible stutter)
      if (delta > 38) {
        consecutiveJanks++;
      } else if (consecutiveJanks > 0 && frameCount % 60 === 0) {
        consecutiveJanks = Math.max(0, consecutiveJanks - 1);
      }

      // Calculate rolling FPS once every 500ms
      if (now - fpsTimer >= 500) {
        this.fps = Math.round((frameCount * 1000) / (now - fpsTimer));
        frameCount = 0;
        fpsTimer = now;

        if (this.hudElement) {
          this.updateFpsDisplay();
        }

        // Automatic throttling under real load (only if not manually locked by user)
        if (!this.isManual) {
          if (consecutiveJanks >= 6 && this.currentTier === 'ultra') {
            console.warn('[PerfGovernor] Frame drops detected. Stepping down to Balanced.');
            this.applyTier('balanced', false);
            consecutiveJanks = 0;
          } else if (consecutiveJanks >= 10 && this.currentTier === 'balanced') {
            console.warn('[PerfGovernor] Heavy background load detected. Stepping down to Lite.');
            this.applyTier('lite', false);
            consecutiveJanks = 0;
          }
        }
      }

      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
    this.isMonitoring = true;
  }

  /**
   * Setup testing triggers for the user's flagship phones
   */
  setupDebugTriggers() {
    if (typeof window === 'undefined') return;

    const checkTriggers = () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get('perf_debug') === '1' || params.get('perf_test') === '1') {
        this.renderTestingHud();
      }

      // Secret trigger: Triple-tap brand logo toggles the test switcher!
      const brandLogo = document.getElementById('brand-logo');
      if (brandLogo) {
        let tapCount = 0;
        let tapTimer = null;
        brandLogo.addEventListener('click', (e) => {
          tapCount++;
          clearTimeout(tapTimer);
          tapTimer = setTimeout(() => { tapCount = 0; }, 600);
          if (tapCount >= 3) {
            e.preventDefault();
            tapCount = 0;
            this.toggleTestingHud();
          }
        });
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', checkTriggers);
    } else {
      checkTriggers();
    }
  }

  toggleTestingHud() {
    if (this.hudElement) {
      this.hudElement.remove();
      this.hudElement = null;
    } else {
      this.renderTestingHud();
    }
  }

  /**
   * Floating On-Screen Performance HUD for easy testing on high-end phones
   */
  renderTestingHud() {
    if (this.hudElement || typeof document === 'undefined') return;

    const hud = document.createElement('div');
    hud.id = 'perf-testing-hud';
    hud.className = 'perf-testing-hud';
    hud.innerHTML = `
      <div class="perf-hud-header">
        <span class="perf-hud-title">⚡ Perf Engine</span>
        <span class="perf-hud-fps" id="perf-hud-fps">${this.fps} FPS</span>
        <button class="perf-hud-close" id="perf-hud-close" title="Close">✕</button>
      </div>
      <div class="perf-hud-specs">
        <span>RAM: <strong>${this.profile.ram}</strong></span> • 
        <span>CPU: <strong>${this.profile.cores} Cores</strong></span>
      </div>
      <div class="perf-hud-buttons">
        <button class="perf-hud-btn ${this.currentTier === 'ultra' ? 'active' : ''}" data-tier="ultra">🚀 Ultra</button>
        <button class="perf-hud-btn ${this.currentTier === 'balanced' ? 'active' : ''}" data-tier="balanced">⚖️ Mid</button>
        <button class="perf-hud-btn ${this.currentTier === 'lite' ? 'active' : ''}" data-tier="lite">🥔 Lite</button>
        <button class="perf-hud-btn perf-hud-btn-auto" data-action="auto">Auto</button>
      </div>
    `;

    document.body.appendChild(hud);
    this.hudElement = hud;

    hud.querySelectorAll('.perf-hud-btn[data-tier]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tier = e.target.getAttribute('data-tier');
        this.setTier(tier, true);
      });
    });

    const autoBtn = hud.querySelector('.perf-hud-btn-auto');
    if (autoBtn) {
      autoBtn.addEventListener('click', () => {
        this.resetAuto();
      });
    }

    const closeBtn = hud.querySelector('#perf-hud-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.toggleTestingHud());
    }
  }

  updateHud() {
    if (!this.hudElement) return;
    this.hudElement.querySelectorAll('.perf-hud-btn[data-tier]').forEach(btn => {
      const tier = btn.getAttribute('data-tier');
      btn.classList.toggle('active', tier === this.currentTier);
    });
  }

  updateFpsDisplay() {
    if (!this.hudElement) return;
    const fpsEl = this.hudElement.querySelector('#perf-hud-fps');
    if (fpsEl) {
      fpsEl.textContent = `${this.fps} FPS`;
      fpsEl.style.color = this.fps >= 50 ? '#10B981' : (this.fps >= 30 ? '#F59E0B' : '#EF4444');
    }
  }

  getStatus() {
    return {
      currentTier: this.currentTier,
      isManualOverride: Boolean(this.isManual),
      fps: this.fps,
      profile: this.profile
    };
  }
}

// Instantiate singleton immediately
export const perfGovernor = new PerformanceGovernor();
export default perfGovernor;
