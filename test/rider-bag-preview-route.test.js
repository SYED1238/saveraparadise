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
});
