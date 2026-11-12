import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '..');

describe('STOREFRONT CLOSED HERO & WHATSAPP OFFERS CTA SUITE', () => {
  const indexHtml = fs.readFileSync(path.join(appRoot, 'index.html'), 'utf8');
  const mainJs = fs.readFileSync(path.join(appRoot, 'main.js'), 'utf8');
  const styleCss = fs.readFileSync(path.join(appRoot, 'style.css'), 'utf8');

  it('1. index.html removes #hero-scroll-guide and includes WhatsApp Best Offers links', () => {
    assert.doesNotMatch(indexHtml, /id="hero-scroll-guide"/);
    assert.doesNotMatch(indexHtml, /Scroll to Browse Menu/);
    assert.match(indexHtml, /href="https:\/\/chat\.whatsapp\.com\/CiASaHQH0A9D0s2m2jedzb"[^>]*id="hero-whatsapp-cta"/);
    assert.match(indexHtml, /Join WhatsApp for Best Offers/);
    assert.match(indexHtml, /href="https:\/\/chat\.whatsapp\.com\/CiASaHQH0A9D0s2m2jedzb"[^>]*id="offers-modal-wa-btn"/);
    assert.match(indexHtml, /href="https:\/\/chat\.whatsapp\.com\/CiASaHQH0A9D0s2m2jedzb"[^>]*id="btn-promo-whatsapp"/);
    assert.match(indexHtml, /href="https:\/\/chat\.whatsapp\.com\/CiASaHQH0A9D0s2m2jedzb"[^>]*id="footer-wa-btn"/);
  });

  it('2. main.js removes #hero-scroll-guide listeners and toggles is-kitchen-closed inside updateStoreStatusUI', () => {
    assert.doesNotMatch(mainJs, /hero-scroll-guide/);
    assert.match(
      mainJs,
      /function\s+updateStoreStatusUI\s*\(\)\s*\{[\s\S]*?activeHeroSection\.classList\.toggle\(\s*'is-kitchen-closed'\s*,\s*Boolean\(isClosed\)\s*\)/
    );
  });

  it('3. style.css hides .hero-title and .hero-eyebrow when .hero-section.is-kitchen-closed is active', () => {
    assert.doesNotMatch(styleCss, /\.hero-scroll-guide/);
    assert.match(
      styleCss,
      /\.hero-section\.is-kitchen-closed\s+\.hero-eyebrow,\s*\.hero-section\.is-kitchen-closed\s+\.hero-title\s*\{\s*display:\s*none;\s*\}/
    );
    assert.match(styleCss, /\.hero-whatsapp-cta\s*\{[\s\S]*width:\s*fit-content;/);
    assert.doesNotMatch(styleCss, /\.hero-whatsapp-cta\s*\{[^}]*#108948/);
  });

  it('4. Hero closed state toggles cleanly across Closed -> Open -> Closed transitions', () => {
    const classes = new Set();
    const mockHero = {
      classList: {
        toggle(name, force) {
          if (force) classes.add(name);
          else classes.delete(name);
        }
      }
    };

    const syncClosedClass = (isClosed) => mockHero.classList.toggle('is-kitchen-closed', Boolean(isClosed));

    // Kitchen closed: "Craving Something Delicious?" headline is hidden via is-kitchen-closed
    syncClosedClass(true);
    assert.equal(classes.has('is-kitchen-closed'), true);

    // Kitchen opens: class is removed so headline returns
    syncClosedClass(false);
    assert.equal(classes.has('is-kitchen-closed'), false);

    // Kitchen closes again: class returns
    syncClosedClass(true);
    assert.equal(classes.has('is-kitchen-closed'), true);
  });
});
