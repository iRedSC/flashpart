import * as React from "react";

/**
 * Single source of truth for the desktop/mobile split.
 *
 * "Mobile" means a phone-sized viewport, or a touch-first (coarse pointer)
 * device up to tablet width. The shell chooses between DesktopShell and
 * MobileShell with this hook exactly once, in
 * `src/components/shell/app-shell.tsx`. Pages must not branch on user agent
 * or window width themselves - use this hook, or responsive classes.
 */
const MOBILE_QUERY =
  "(max-width: 767px), ((pointer: coarse) and (max-width: 1023px))";

function subscribe(onChange: () => void) {
  const mediaQueryList = window.matchMedia(MOBILE_QUERY);

  mediaQueryList.addEventListener("change", onChange);

  return () => mediaQueryList.removeEventListener("change", onChange);
}

export function isMobileViewport() {
  return window.matchMedia(MOBILE_QUERY).matches;
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, isMobileViewport);
}
