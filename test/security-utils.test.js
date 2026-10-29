import test from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml,
  sanitizeUrl,
  sanitizePhone,
  hashPasscode,
  isStaffSessionActive,
  getAdminAuthHeaders,
  ensureAdminToken,
  verifyStaffPin,
  DEFAULT_RIDER_PIN_HASHES,
  DEFAULT_RIDER_PIN_HASH,
  DEFAULT_OWNER_PIN_HASH
} from '../securityUtils.js';

// ============================================================
// escapeHtml
// ============================================================
test('escapeHtml: standard HTML entity escaping', async (t) => {
  await t.test('escapes ampersand', () => {
    assert.strictEqual(escapeHtml('a & b'), 'a &amp; b');
  });

  await t.test('escapes less-than', () => {
    assert.strictEqual(escapeHtml('a < b'), 'a &lt; b');
  });

  await t.test('escapes greater-than', () => {
    assert.strictEqual(escapeHtml('a > b'), 'a &gt; b');
  });

  await t.test('escapes double quotes', () => {
    assert.strictEqual(escapeHtml('say "hello"'), 'say &quot;hello&quot;');
  });

  await t.test('escapes single quotes', () => {
    assert.strictEqual(escapeHtml("it's"), 'it&#39;s');
  });

  await t.test('escapes backticks', () => {
    assert.strictEqual(escapeHtml('`code`'), '&#x60;code&#x60;');
  });

  await t.test('escapes all special characters together', () => {
    assert.strictEqual(
      escapeHtml(`<div class="x" onclick='y' data=\`z\`>&`),
      '&lt;div class=&quot;x&quot; onclick=&#39;y&#39; data=&#x60;z&#x60;&gt;&amp;'
    );
  });
});

test('escapeHtml: null, undefined, and non-string inputs', async (t) => {
  await t.test('returns empty string for null', () => {
    assert.strictEqual(escapeHtml(null), '');
  });

  await t.test('returns empty string for undefined', () => {
    assert.strictEqual(escapeHtml(undefined), '');
  });

  await t.test('converts number to string', () => {
    assert.strictEqual(escapeHtml(42), '42');
    assert.strictEqual(escapeHtml(0), '0');
    assert.strictEqual(escapeHtml(-1.5), '-1.5');
    assert.strictEqual(escapeHtml(NaN), 'NaN');
    assert.strictEqual(escapeHtml(Infinity), 'Infinity');
  });

  await t.test('converts boolean to string', () => {
    assert.strictEqual(escapeHtml(true), 'true');
    assert.strictEqual(escapeHtml(false), 'false');
  });

  await t.test('converts plain object via String()', () => {
    const result = escapeHtml({});
    assert.strictEqual(typeof result, 'string');
  });

  await t.test('converts array via String()', () => {
    const result = escapeHtml([1, 2]);
    assert.strictEqual(typeof result, 'string');
  });

  await t.test('handles empty string', () => {
    assert.strictEqual(escapeHtml(''), '');
  });
});

test('escapeHtml: XSS attack vectors', async (t) => {
  await t.test('neutralizes <script> tags', () => {
    const escaped = escapeHtml('<script>alert(1)</script>');
    assert.strictEqual(escaped, '&lt;script&gt;alert(1)&lt;/script&gt;');
    assert.ok(!escaped.includes('<script>'));
  });

  await t.test('neutralizes event handler attributes', () => {
    const escaped = escapeHtml('<img src="x" onerror="alert(1)">');
    assert.ok(!escaped.includes('"'));
    assert.ok(escaped.includes('&quot;'));
    assert.ok(!escaped.includes('<img'));
    assert.ok(escaped.includes('&lt;img'));
  });

  await t.test('neutralizes template literal injection', () => {
    const escaped = escapeHtml('${alert(1)}');
    assert.ok(!escaped.includes('`'));
  });

  await t.test('neutralizes nested script with entities', () => {
    const escaped = escapeHtml('"><script>document.cookie</script>');
    assert.ok(!escaped.includes('<'));
    assert.ok(!escaped.includes('>'));
    assert.ok(!escaped.includes('"'));
  });

  await t.test('neutralizes SVG onload XSS', () => {
    const escaped = escapeHtml('<svg onload="alert(1)">');
    assert.ok(!escaped.includes('<svg'));
    assert.strictEqual(escaped, '&lt;svg onload=&quot;alert(1)&quot;&gt;');
  });

  await t.test('neutralizes javascript: in attribute', () => {
    const escaped = escapeHtml('<a href="javascript:void(0)">click</a>');
    assert.ok(!escaped.includes('<a'));
    assert.ok(!escaped.includes('"'));
  });
});

test('escapeHtml: edge cases', async (t) => {
  await t.test('handles very long strings', () => {
    const long = '<'.repeat(10000);
    const escaped = escapeHtml(long);
    assert.strictEqual(escaped.length, 40000); // each '<' -> '&lt;' (4 chars)
    assert.ok(!escaped.includes('<'));
  });

  await t.test('passes through safe strings unchanged', () => {
    assert.strictEqual(escapeHtml('Hello World 123'), 'Hello World 123');
  });

  await t.test('handles unicode characters', () => {
    assert.strictEqual(escapeHtml('日本語 🍗'), '日本語 🍗');
  });

  await t.test('handles whitespace-only strings', () => {
    assert.strictEqual(escapeHtml('   '), '   ');
    assert.strictEqual(escapeHtml('\t\n'), '\t\n');
  });
});

// ============================================================
// sanitizeUrl
// ============================================================
test('sanitizeUrl: blocks dangerous protocols', async (t) => {
  await t.test('blocks javascript: protocol', () => {
    assert.strictEqual(sanitizeUrl('javascript:alert(1)'), '#');
  });

  await t.test('blocks JavaScript: with mixed case', () => {
    assert.strictEqual(sanitizeUrl('JaVaScRiPt:alert(1)'), '#');
  });

  await t.test('blocks JAVASCRIPT: uppercase', () => {
    assert.strictEqual(sanitizeUrl('JAVASCRIPT:void(0)'), '#');
  });

  await t.test('blocks vbscript: protocol', () => {
    assert.strictEqual(sanitizeUrl('vbscript:MsgBox("XSS")'), '#');
  });

  await t.test('blocks VBScript: mixed case', () => {
    assert.strictEqual(sanitizeUrl('VbScript:alert()'), '#');
  });

  await t.test('blocks data:text/html', () => {
    assert.strictEqual(sanitizeUrl('data:text/html,<script>alert(1)</script>'), '#');
  });

  await t.test('blocks data:image/svg+xml (SVG XSS)', () => {
    assert.strictEqual(sanitizeUrl('data:image/svg+xml;base64,PHN2Zz4='), '#');
  });

  await t.test('blocks data:application/javascript', () => {
    assert.strictEqual(sanitizeUrl('data:application/javascript,alert(1)'), '#');
  });
});

test('sanitizeUrl: allows safe data: image formats', async (t) => {
  await t.test('allows data:image/png', () => {
    const url = 'data:image/png;base64,iVBOR';
    const result = sanitizeUrl(url);
    assert.ok(result.includes('data:image/png'));
  });

  await t.test('allows data:image/jpeg', () => {
    const url = 'data:image/jpeg;base64,/9j/4AAQ';
    const result = sanitizeUrl(url);
    assert.ok(result.includes('data:image/jpeg'));
  });

  await t.test('allows data:image/jpg', () => {
    const url = 'data:image/jpg;base64,abc';
    const result = sanitizeUrl(url);
    assert.ok(result.includes('data:image/jpg'));
  });

  await t.test('allows data:image/webp', () => {
    const url = 'data:image/webp;base64,abc';
    const result = sanitizeUrl(url);
    assert.ok(result.includes('data:image/webp'));
  });

  await t.test('allows data:image/gif', () => {
    const url = 'data:image/gif;base64,R0lGODlh';
    const result = sanitizeUrl(url);
    assert.ok(result.includes('data:image/gif'));
  });
});

test('sanitizeUrl: allows safe URLs', async (t) => {
  await t.test('passes through normal https URL', () => {
    const result = sanitizeUrl('https://example.com/path');
    assert.strictEqual(result, 'https://example.com/path');
  });

  await t.test('passes through relative URL', () => {
    const result = sanitizeUrl('/api/r2-image?key=dishes/photo.webp');
    assert.strictEqual(result, '/api/r2-image?key=dishes/photo.webp');
  });

  await t.test('passes through hash fragment', () => {
    assert.strictEqual(sanitizeUrl('#section'), '#section');
  });

  await t.test('escapes HTML entities in URLs', () => {
    const result = sanitizeUrl('https://example.com?a=1&b=2');
    assert.ok(result.includes('&amp;'));
    assert.ok(!result.includes('&b'));
  });
});

test('sanitizeUrl: fallback behavior', async (t) => {
  await t.test('returns default fallback "#" for null', () => {
    assert.strictEqual(sanitizeUrl(null), '#');
  });

  await t.test('returns default fallback "#" for undefined', () => {
    assert.strictEqual(sanitizeUrl(undefined), '#');
  });

  await t.test('returns default fallback "#" for empty string', () => {
    assert.strictEqual(sanitizeUrl(''), '#');
  });

  await t.test('returns default fallback "#" for non-string', () => {
    assert.strictEqual(sanitizeUrl(123), '#');
    assert.strictEqual(sanitizeUrl(true), '#');
    assert.strictEqual(sanitizeUrl({}), '#');
  });

  await t.test('returns custom fallback for bad URL', () => {
    assert.strictEqual(sanitizeUrl('javascript:void(0)', '/safe'), '/safe');
  });

  await t.test('returns custom fallback for null input', () => {
    assert.strictEqual(sanitizeUrl(null, '/home'), '/home');
  });
});

test('sanitizeUrl: trims whitespace', async (t) => {
  await t.test('trims leading/trailing whitespace from valid URL', () => {
    assert.strictEqual(sanitizeUrl('  https://example.com  '), 'https://example.com');
  });

  await t.test('trims whitespace before checking protocol', () => {
    assert.strictEqual(sanitizeUrl('  javascript:alert(1)  '), '#');
  });
});

// ============================================================
// sanitizePhone
// ============================================================
test('sanitizePhone: standard phone number cleaning', async (t) => {
  await t.test('strips dashes from phone number', () => {
    assert.strictEqual(sanitizePhone('123-456-7890'), '1234567890');
  });

  await t.test('strips spaces from phone number', () => {
    assert.strictEqual(sanitizePhone('123 456 7890'), '1234567890');
  });

  await t.test('strips parentheses from phone number', () => {
    assert.strictEqual(sanitizePhone('(123) 456-7890'), '1234567890');
  });

  await t.test('preserves leading + for international format', () => {
    assert.strictEqual(sanitizePhone('+91 98765-43210'), '+919876543210');
  });

  await t.test('strips letters from phone number', () => {
    assert.strictEqual(sanitizePhone('1800-CALL-NOW'), '1800');
  });

  await t.test('handles plain digits', () => {
    assert.strictEqual(sanitizePhone('9876543210'), '9876543210');
  });
});

test('sanitizePhone: null, undefined, and non-string inputs', async (t) => {
  await t.test('returns empty string for null', () => {
    assert.strictEqual(sanitizePhone(null), '');
  });

  await t.test('returns empty string for undefined', () => {
    assert.strictEqual(sanitizePhone(undefined), '');
  });

  await t.test('converts number input to string and strips', () => {
    assert.strictEqual(sanitizePhone(9876543210), '9876543210');
  });

  await t.test('handles boolean input', () => {
    assert.strictEqual(sanitizePhone(true), '');  // "true" -> strip letters -> ""
  });

  await t.test('handles empty string', () => {
    assert.strictEqual(sanitizePhone(''), '');
  });
});

test('sanitizePhone: max length enforcement (16 chars)', async (t) => {
  await t.test('truncates to 16 characters', () => {
    const long = '+1234567890123456789';
    const result = sanitizePhone(long);
    assert.ok(result.length <= 16);
  });

  await t.test('allows exactly 16 characters', () => {
    const exact = '+123456789012345';
    const result = sanitizePhone(exact);
    assert.strictEqual(result, '+123456789012345');
    assert.strictEqual(result.length, 16);
  });
});

test('sanitizePhone: edge cases', async (t) => {
  await t.test('handles + in middle of number', () => {
    const result = sanitizePhone('123+456');
    assert.strictEqual(result, '123+456');
  });

  await t.test('handles only non-digit characters', () => {
    assert.strictEqual(sanitizePhone('abcdef'), '');
  });

  await t.test('handles special characters', () => {
    assert.strictEqual(sanitizePhone('!@#$%^&*()'), '');
  });

  await t.test('trims whitespace before processing', () => {
    assert.strictEqual(sanitizePhone('  +91 123  '), '+91123');
  });
});

// ============================================================
// hashPasscode
// ============================================================
test('hashPasscode: determinism and format', async (t) => {
  await t.test('returns 64-character hex string', async () => {
    const hash = await hashPasscode('1234');
    assert.strictEqual(hash.length, 64);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  await t.test('same input produces same hash (deterministic)', async () => {
    const hash1 = await hashPasscode('5678');
    const hash2 = await hashPasscode('5678');
    assert.strictEqual(hash1, hash2);
  });

  await t.test('different inputs produce different hashes', async () => {
    const hash1 = await hashPasscode('1111');
    const hash2 = await hashPasscode('2222');
    assert.notStrictEqual(hash1, hash2);
  });
});

test('hashPasscode: known hash constants', async (t) => {
  await t.test('PIN 2233 produces DEFAULT_RIDER_PIN_HASHES[0]', async () => {
    const hash = await hashPasscode('2233');
    assert.strictEqual(hash, DEFAULT_RIDER_PIN_HASHES[0]);
    assert.strictEqual(hash, 'eee788b8ab81ff42dc330a2c98a6d3cf85c057bf04ede2b3a16338b2d89682d8');
  });

  await t.test('PIN 9900 produces DEFAULT_OWNER_PIN_HASH', async () => {
    const hash = await hashPasscode('9900');
    assert.strictEqual(hash, DEFAULT_OWNER_PIN_HASH);
    assert.strictEqual(hash, 'abcb00b12750a6e83eef857f2b2f5809864ced8e2b81cbfe784cba2a36e197e8');
  });

  await t.test('DEFAULT_RIDER_PIN_HASH equals DEFAULT_RIDER_PIN_HASHES[0]', () => {
    assert.strictEqual(DEFAULT_RIDER_PIN_HASH, DEFAULT_RIDER_PIN_HASHES[0]);
  });
});

test('hashPasscode: null, undefined, and non-string inputs', async (t) => {
  await t.test('returns empty string for null', async () => {
    assert.strictEqual(await hashPasscode(null), '');
  });

  await t.test('returns empty string for undefined', async () => {
    assert.strictEqual(await hashPasscode(undefined), '');
  });

  await t.test('returns empty string for empty string', async () => {
    assert.strictEqual(await hashPasscode(''), '');
  });

  await t.test('returns empty string for number input', async () => {
    assert.strictEqual(await hashPasscode(1234), '');
  });

  await t.test('returns empty string for boolean input', async () => {
    assert.strictEqual(await hashPasscode(true), '');
  });

  await t.test('returns empty string for object input', async () => {
    assert.strictEqual(await hashPasscode({}), '');
  });

  await t.test('returns empty string for array input', async () => {
    assert.strictEqual(await hashPasscode([]), '');
  });
});

test('hashPasscode: edge cases', async (t) => {
  await t.test('hashes a single character', async () => {
    const hash = await hashPasscode('0');
    assert.strictEqual(hash.length, 64);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  await t.test('hashes a long string', async () => {
    const hash = await hashPasscode('a'.repeat(1000));
    assert.strictEqual(hash.length, 64);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  await t.test('hashes whitespace-only string (after trim it becomes salted empty)', async () => {
    const hash = await hashPasscode('   ');
    // pin.trim() is '', so it hashes 'quickbite_salt_'
    assert.strictEqual(hash.length, 64);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  await t.test('trims leading/trailing whitespace before hashing', async () => {
    const hash1 = await hashPasscode(' 1234 ');
    const hash2 = await hashPasscode('1234');
    assert.strictEqual(hash1, hash2);
  });

  await t.test('hashes special characters', async () => {
    const hash = await hashPasscode('!@#$');
    assert.strictEqual(hash.length, 64);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });
});

// ============================================================
// isStaffSessionActive — Node.js has no sessionStorage
// ============================================================
test('isStaffSessionActive: returns false when sessionStorage is undefined (Node.js)', async (t) => {
  await t.test('returns false for admin role', () => {
    assert.strictEqual(isStaffSessionActive('admin'), false);
  });

  await t.test('returns false for rider role', () => {
    assert.strictEqual(isStaffSessionActive('rider'), false);
  });

  await t.test('returns false for owner role', () => {
    assert.strictEqual(isStaffSessionActive('owner'), false);
  });

  await t.test('returns false for unknown role', () => {
    assert.strictEqual(isStaffSessionActive('unknown'), false);
  });

  await t.test('returns false for null role', () => {
    assert.strictEqual(isStaffSessionActive(null), false);
  });

  await t.test('returns false for undefined role', () => {
    assert.strictEqual(isStaffSessionActive(undefined), false);
  });

  await t.test('does not throw on any input', () => {
    assert.doesNotThrow(() => isStaffSessionActive('admin'));
    assert.doesNotThrow(() => isStaffSessionActive());
    assert.doesNotThrow(() => isStaffSessionActive(42));
    assert.doesNotThrow(() => isStaffSessionActive({}));
  });
});

// ============================================================
// getAdminAuthHeaders — Node.js has no sessionStorage
// ============================================================
test('getAdminAuthHeaders: returns empty object when sessionStorage is undefined (Node.js)', async (t) => {
  await t.test('returns empty object', () => {
    const headers = getAdminAuthHeaders();
    assert.deepStrictEqual(headers, {});
  });

  await t.test('returned object has no Authorization key', () => {
    const headers = getAdminAuthHeaders();
    assert.strictEqual(headers.Authorization, undefined);
  });

  await t.test('does not throw', () => {
    assert.doesNotThrow(() => getAdminAuthHeaders());
  });
});

// ============================================================
// ensureAdminToken — Node.js has no sessionStorage
// ============================================================
test('ensureAdminToken: returns null when sessionStorage is undefined (Node.js)', async (t) => {
  await t.test('returns null', async () => {
    const result = await ensureAdminToken();
    assert.strictEqual(result, null);
  });

  await t.test('does not throw', async () => {
    await assert.doesNotReject(() => ensureAdminToken());
  });
});

// ============================================================
// verifyStaffPin — Node.js has no fetch/localStorage/sessionStorage
// ============================================================
test('verifyStaffPin: rejects invalid PIN formats', async (t) => {
  await t.test('rejects null pin', async () => {
    assert.strictEqual(await verifyStaffPin('admin', null), false);
  });

  await t.test('rejects undefined pin', async () => {
    assert.strictEqual(await verifyStaffPin('admin', undefined), false);
  });

  await t.test('rejects empty string pin', async () => {
    assert.strictEqual(await verifyStaffPin('admin', ''), false);
  });

  await t.test('rejects 3-digit pin (too short)', async () => {
    assert.strictEqual(await verifyStaffPin('admin', '123'), false);
  });

  await t.test('rejects 5-digit pin (too long)', async () => {
    assert.strictEqual(await verifyStaffPin('admin', '12345'), false);
  });

  await t.test('rejects alphabetic pin', async () => {
    assert.strictEqual(await verifyStaffPin('admin', 'abcd'), false);
  });

  await t.test('rejects pin with special characters', async () => {
    assert.strictEqual(await verifyStaffPin('admin', '12!@'), false);
  });

  await t.test('rejects pin with spaces', async () => {
    assert.strictEqual(await verifyStaffPin('admin', '12 4'), false);
  });
});

test('verifyStaffPin: admin role fails gracefully without fetch (Node.js)', async (t) => {
  await t.test('returns false for admin with valid 4-digit pin (no server)', async () => {
    // In Node.js, fetch to /api/admin-auth without base URL fails gracefully
    const origWarn = console.warn;
    console.warn = () => {};
    try {
      const result = await verifyStaffPin('admin', '1234');
      assert.strictEqual(result, false);
    } finally {
      console.warn = origWarn;
    }
  });
});

test('verifyStaffPin: rider role fails gracefully without localStorage (Node.js)', async (t) => {
  await t.test('returns false for rider with valid 4-digit pin (no localStorage)', async () => {
    // In Node.js, localStorage is not defined => the try/catch returns false
    const result = await verifyStaffPin('rider', '2233');
    assert.strictEqual(result, false);
  });
});

test('verifyStaffPin: unknown role returns false', async (t) => {
  await t.test('returns false for unknown role', async () => {
    assert.strictEqual(await verifyStaffPin('chef', '1234'), false);
  });

  await t.test('returns false for null role with valid pin', async () => {
    assert.strictEqual(await verifyStaffPin(null, '1234'), false);
  });
});

// ============================================================
// Exported constants validation
// ============================================================
test('Exported constants: DEFAULT_RIDER_PIN_HASHES', async (t) => {
  await t.test('is an array of 4 hashes', () => {
    assert.ok(Array.isArray(DEFAULT_RIDER_PIN_HASHES));
    assert.strictEqual(DEFAULT_RIDER_PIN_HASHES.length, 4);
  });

  await t.test('all hashes are 64-character hex strings', () => {
    for (const hash of DEFAULT_RIDER_PIN_HASHES) {
      assert.strictEqual(hash.length, 64);
      assert.match(hash, /^[0-9a-f]{64}$/);
    }
  });

  await t.test('all hashes are unique', () => {
    const unique = new Set(DEFAULT_RIDER_PIN_HASHES);
    assert.strictEqual(unique.size, DEFAULT_RIDER_PIN_HASHES.length);
  });
});

test('Exported constants: DEFAULT_OWNER_PIN_HASH', async (t) => {
  await t.test('is a 64-character hex string', () => {
    assert.strictEqual(DEFAULT_OWNER_PIN_HASH.length, 64);
    assert.match(DEFAULT_OWNER_PIN_HASH, /^[0-9a-f]{64}$/);
  });

  await t.test('matches known value', () => {
    assert.strictEqual(
      DEFAULT_OWNER_PIN_HASH,
      'abcb00b12750a6e83eef857f2b2f5809864ced8e2b81cbfe784cba2a36e197e8'
    );
  });
});

// ============================================================
// Cross-function integration: escapeHtml + sanitizeUrl
// ============================================================
test('Cross-function: sanitizeUrl applies escapeHtml to output', async (t) => {
  await t.test('URL with ampersand is entity-escaped', () => {
    const result = sanitizeUrl('https://example.com?x=1&y=2');
    assert.ok(result.includes('&amp;'));
    assert.ok(!result.includes('&y='));
  });

  await t.test('URL with angle brackets is entity-escaped', () => {
    const result = sanitizeUrl('https://example.com/<path>');
    assert.ok(result.includes('&lt;'));
    assert.ok(result.includes('&gt;'));
  });
});

// ============================================================
// Cross-function integration: hashPasscode known PINs match constants
// ============================================================
test('Cross-function: all default rider PINs hash to their constants', async (t) => {
  const pinToHash = [
    ['2233', DEFAULT_RIDER_PIN_HASHES[0]],
    ['4422', DEFAULT_RIDER_PIN_HASHES[1]],
    ['4455', DEFAULT_RIDER_PIN_HASHES[2]],
    ['8811', DEFAULT_RIDER_PIN_HASHES[3]]
  ];

  for (const [pin, expectedHash] of pinToHash) {
    await t.test(`PIN ${pin} matches its registered hash`, async () => {
      const hash = await hashPasscode(pin);
      assert.strictEqual(hash, expectedHash);
    });
  }
});
