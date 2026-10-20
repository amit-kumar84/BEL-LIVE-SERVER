const test = require('node:test');
const assert = require('node:assert/strict');
const { FOCUS_RETURN_DELAY_MS, shouldRestoreWindow, shouldForceWindowFocus } = require('./window-policy.cjs');

test('focus return should happen after exactly two minutes', () => {
  assert.equal(FOCUS_RETURN_DELAY_MS, 2 * 60 * 1000);
});

test('alerts should force window restoration while app is running', () => {
  assert.equal(shouldRestoreWindow({ isQuitting: false, isWindowFocused: false, isMinimized: true }), true);
  assert.equal(shouldRestoreWindow({ isQuitting: false, isWindowFocused: true, isMinimized: false }), false);
  assert.equal(shouldForceWindowFocus({ alertActive: true, isWindowFocused: false }), true);
  assert.equal(shouldForceWindowFocus({ alertActive: false, isWindowFocused: true }), false);
});
