import * as React from "react";

const VIEWPORT_SELECTOR = 'meta[name="viewport"]';
const MOBILE_VIEWPORT =
  "width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no, viewport-fit=cover";
const DEFAULT_VIEWPORT =
  "width=device-width, initial-scale=1.0, viewport-fit=cover";

/** Marks an element whose multi-touch gestures should not be blocked globally. */
export const ALLOW_CAMERA_PINCH_ATTR = "data-allow-camera-pinch";

function preventGesture(event: Event) {
  event.preventDefault();
}

function isInsideAllowedCameraPinchTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    target.closest(`[${ALLOW_CAMERA_PINCH_ATTR}]`) !== null
  );
}

function preventMultiTouchMove(event: TouchEvent) {
  if (event.touches.length > 1 && !isInsideAllowedCameraPinchTarget(event.target)) {
    event.preventDefault();
  }
}

/**
 * Locks pinch/double-tap zoom while the mobile layout is active so the UI
 * feels closer to a native app than a zoomable mobile web page.
 *
 * Multi-touch moves inside `[data-allow-camera-pinch]` are left alone so the
 * capture screen can drive native MediaStreamTrack zoom.
 */
export function usePreventPinchZoom(enabled: boolean) {
  React.useEffect(() => {
    if (!enabled) {
      return;
    }

    const viewport = document.querySelector<HTMLMetaElement>(VIEWPORT_SELECTOR);
    const previousContent = viewport?.content ?? DEFAULT_VIEWPORT;

    if (viewport) {
      viewport.content = MOBILE_VIEWPORT;
    }

    document.documentElement.classList.add("native-mobile");
    document.addEventListener("gesturestart", preventGesture, { passive: false });
    document.addEventListener("gesturechange", preventGesture, { passive: false });
    document.addEventListener("gestureend", preventGesture, { passive: false });
    document.addEventListener("touchmove", preventMultiTouchMove, { passive: false });

    return () => {
      if (viewport) {
        viewport.content = previousContent;
      }

      document.documentElement.classList.remove("native-mobile");
      document.removeEventListener("gesturestart", preventGesture);
      document.removeEventListener("gesturechange", preventGesture);
      document.removeEventListener("gestureend", preventGesture);
      document.removeEventListener("touchmove", preventMultiTouchMove);
    };
  }, [enabled]);
}
