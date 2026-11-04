import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

describe('PHONEPE AUDITOR / DIRECT CREDENTIAL LOGIN SUITE', () => {
  const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf-8');
  const mainJs = fs.readFileSync(path.resolve('main.js'), 'utf-8');
  const styleCss = fs.readFileSync(path.resolve('style.css'), 'utf-8');

  test('1. index.html contains all required ID and password fields and buttons', () => {
    assert.ok(indexHtml.includes('id="auth-credential-form"'), 'Missing #auth-credential-form');
    assert.ok(indexHtml.includes('id="auth-input-email"'), 'Missing #auth-input-email');
    assert.ok(indexHtml.includes('id="auth-input-password"'), 'Missing #auth-input-password');
    assert.ok(indexHtml.includes('id="btn-toggle-auth-password"'), 'Missing #btn-toggle-auth-password');
    assert.ok(indexHtml.includes('id="btn-credential-signin"'), 'Missing #btn-credential-signin');
    assert.ok(indexHtml.includes('id="btn-quick-fill-auth"'), 'Missing #btn-quick-fill-auth');
    assert.ok(indexHtml.includes('id="auth-credential-error"'), 'Missing #auth-credential-error');
    assert.ok(indexHtml.includes('niyamat1222@gmail.com'), 'Missing placeholder niyamat1222@gmail.com');
  });

  test('2. Google Sign-In button remains intact', () => {
    assert.ok(indexHtml.includes('id="btn-google-signin"'), 'Missing #btn-google-signin');
  });

  test('3. main.js validates niyamat1222@gmail.com and Nyamath112233 and strips whitespace', () => {
    assert.ok(mainJs.includes('niyamat1222@gmail.com'), 'main.js missing niyamat1222@gmail.com');
    assert.ok(mainJs.includes('Nyamath112233'), 'main.js missing Nyamath112233');
    assert.ok(mainJs.includes('completeNiyamatSignIn'), 'main.js missing completeNiyamatSignIn handler');
    assert.ok(mainJs.includes('btn-toggle-auth-password'), 'main.js missing password toggle logic');
    assert.ok(mainJs.includes('btn-quick-fill-auth'), 'main.js missing quick-fill logic');
  });

  test('4. style.css includes styling for credential inputs and quick-fill button', () => {
    assert.ok(styleCss.includes('.auth-cred-input-wrap'), 'style.css missing .auth-cred-input-wrap');
    assert.ok(styleCss.includes('#btn-quick-fill-auth:hover'), 'style.css missing #btn-quick-fill-auth:hover');
  });
});
