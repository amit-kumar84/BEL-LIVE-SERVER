const FOCUS_RETURN_DELAY_MS = 2 * 60 * 1000;

function shouldRestoreWindow({ isQuitting, isWindowFocused, isMinimized }) {
  return !isQuitting && !isWindowFocused && (isMinimized === true || isMinimized === false);
}

function shouldForceWindowFocus({ alertActive, isWindowFocused }) {
  return Boolean(alertActive) && !isWindowFocused;
}

module.exports = {
  FOCUS_RETURN_DELAY_MS,
  shouldRestoreWindow,
  shouldForceWindowFocus,
};
