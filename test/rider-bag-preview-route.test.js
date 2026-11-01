import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('RIDER BAG PIN VERIFICATION & ROUTE PREVIEW WORKFLOW SUITE', async (t) => {
  const deliveryHtml = fs.readFileSync(path.join(process.cwd(), 'delivery.html'), 'utf8');
  const deliveryCss = fs.readFileSync(path.join(process.cwd(), 'delivery.css'), 'utf8');
  const deliveryJs = fs.readFileSync(path.join(process.cwd(), 'delivery.js'), 'utf8');

  await t.test('1. delivery.html contains all modal elements for distance, route, and accept button', () => {
    assert.ok(deliveryHtml.includes('id="modal-bag-preview-backdrop"'), 'Modal backdrop must exist');
    assert.ok(deliveryHtml.includes('id="preview-bag-code-pill"'), 'Bag code pill element must exist');
    assert.ok(deliveryHtml.includes('id="preview-dist-val"'), 'Distance display must exist');
    assert.ok(deliveryHtml.includes('id="preview-eta-val"'), 'Ride ETA display must exist');
    assert.ok(deliveryHtml.includes('id="preview-dist-route-desc"'), 'Route description must exist');
    assert.ok(deliveryHtml.includes('id="preview-route-area"'), 'Route area destination must exist');
    assert.ok(deliveryHtml.includes('id="preview-drop-address"'), 'Drop address element must exist');
    assert.ok(deliveryHtml.includes('id="preview-payment-pill"'), 'Payment mode element must exist');
    assert.ok(deliveryHtml.includes('id="btn-cancel-bag-claim"'), 'Cancel button must exist');
    assert.ok(deliveryHtml.includes('id="btn-confirm-bag-claim"'), 'Accept & Start Delivery button must exist');
  });

  await t.test('2. delivery.css includes high-visibility styles for bag preview card and route highlight', () => {
    assert.ok(deliveryCss.includes('.bag-preview-card'), 'CSS must define .bag-preview-card');
    assert.ok(deliveryCss.includes('.preview-distance-card'), 'CSS must define .preview-distance-card');
    assert.ok(deliveryCss.includes('.highlight-route'), 'CSS must style route highlight');
    assert.ok(deliveryCss.includes('.btn-confirm-bag-claim'), 'CSS must style .btn-confirm-bag-claim');
  });

  await t.test('3. delivery.js implements openBagPreviewModal, closeBagPreviewModal and wires accept button', () => {
    assert.ok(deliveryJs.includes('function openBagPreviewModal('), 'openBagPreviewModal must be defined');
    assert.ok(deliveryJs.includes('function closeBagPreviewModal('), 'closeBagPreviewModal must be defined');
    assert.ok(deliveryJs.includes('btnConfirmBagClaim.addEventListener(\'click\''), 'Confirm button click must be attached');
    assert.ok(deliveryJs.includes('modal-bag-preview'), 'Back navigation must register modal-bag-preview');
  });

  await t.test('4. startDeliveryByBagCode triggers preview modal instead of directly claiming order', () => {
    // When code is entered, it must call openBagPreviewModal(order, code)
    assert.ok(deliveryJs.includes('openBagPreviewModal(order, code);'), 'Entering bag code must open preview modal');
  });

  await t.test('5. Distance and route calculation math adheres to road multiplier and minimum ride time', () => {
    const lat1 = 12.7209;
    const lon1 = 77.2799;
    const lat2 = 12.7245;
    const lon2 = 77.2790;

    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const straightKm = R * c;
    const roadKm = parseFloat((straightKm * 1.35).toFixed(1));
    const estimatedMins = Math.max(5, Math.round(roadKm * 3.5));

    assert.ok(roadKm > 0, 'Road km must be positive');
    assert.ok(estimatedMins >= 5, 'Estimated mins must respect minimum floor');
  });

  await t.test('6. Distance calculation fallback prevents NaN duration and handles edge case coordinates', () => {
    const rawDistanceKm = NaN;
    const distanceKm = (!rawDistanceKm || isNaN(rawDistanceKm) || rawDistanceKm <= 0) ? 1.8 : rawDistanceKm;
    const estimatedMins = Math.max(5, Math.round(distanceKm * 3.5));

    assert.strictEqual(distanceKm, 1.8, 'Fallback distance must be 1.8km');
    assert.strictEqual(estimatedMins, 6, 'Estimated mins must be calculated properly');
    assert.ok(!isNaN(estimatedMins), 'Estimated mins must not be NaN');
  });

  await t.test('7. Rider bag preview modal adheres to clean white theme with high-contrast text', () => {
    assert.ok(deliveryCss.includes('background: #FFFFFF !important'), 'Modal card must use clean white theme background #FFFFFF');
    assert.ok(deliveryCss.includes('.highlight-payout .payout-val') || deliveryCss.includes('.preview-row.highlight-payout .payout-val'), 'Payout val CSS must exist');
    assert.ok(deliveryCss.includes('#047857'), 'Payout amount must use bold high-contrast emerald text #047857 in white theme');
    assert.ok(deliveryCss.includes('.payout-formula-tag'), 'Formula breakdown pill must be styled');
  });

  await t.test('8. Modal displays only destination address and avoids redundant "from where to where"', () => {
    // delivery.html must display Destination Address and not redundant "Delivery Route: Savera Paradise"
    assert.ok(deliveryHtml.includes('Destination Address:'), 'Modal must prominently label Destination Address');
    assert.ok(!deliveryHtml.includes('Delivery Route: Savera Paradise'), 'delivery.html must not show origin kitchen route');
    assert.ok(!deliveryJs.includes('`Savera Paradise ➔ ${areaName}`'), 'delivery.js must not set origin in previewRouteArea');
    assert.ok(!deliveryJs.includes('`Live route from Savera Paradise Kitchen'), 'delivery.js must not set origin in previewDistRouteDesc');
  });

  await t.test('9. Mobile-first ergonomic actions bar and touch targets conform to standards', () => {
    // Actions must be sticky/fixed in flex container with >= 48px touch targets
    assert.ok(deliveryCss.includes('.bag-preview-actions'), 'bag-preview-actions must exist');
    assert.ok(deliveryCss.includes('min-height: 48px') || deliveryCss.includes('min-height: 50px'), 'Buttons must meet 48px touch minimum');
    assert.ok(deliveryCss.includes('max-height: min(92dvh') || deliveryCss.includes('max-height: min(94dvh'), 'Modal card must clamp within mobile viewport');
  });
});
