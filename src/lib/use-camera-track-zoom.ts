import * as React from "react";
import {
  applyTrackZoom,
  clampZoom,
  readTrackZoom,
  readTrackZoomRange,
  touchDistance,
  type CameraZoomRange,
} from "./camera-zoom";

type PinchSession = {
  startDistance: number;
  startZoom: number;
};

/**
 * Native MediaStreamTrack zoom driven by pinch gestures on a camera plane.
 * No CSS scaling — zoom is applied with applyConstraints so the captured
 * frame itself has reduced perspective.
 */
export function useCameraTrackZoom(stream: MediaStream | null) {
  const trackRef = React.useRef<MediaStreamTrack | null>(null);
  const rangeRef = React.useRef<CameraZoomRange | null>(null);
  const zoomRef = React.useRef(1);
  const pinchRef = React.useRef<PinchSession | null>(null);
  const applyInFlightRef = React.useRef(false);
  const pendingZoomRef = React.useRef<number | null>(null);

  const [zoomRange, setZoomRange] = React.useState<CameraZoomRange | null>(
    null,
  );
  const [zoom, setZoom] = React.useState(1);
  const [planeElement, setPlaneElement] = React.useState<HTMLElement | null>(
    null,
  );

  const flushZoom = React.useCallback(async () => {
    const track = trackRef.current;
    const range = rangeRef.current;
    const nextZoom = pendingZoomRef.current;

    if (!track || !range || nextZoom === null || applyInFlightRef.current) {
      return;
    }

    pendingZoomRef.current = null;
    applyInFlightRef.current = true;

    try {
      await applyTrackZoom(track, nextZoom);
      zoomRef.current = nextZoom;
      setZoom(nextZoom);
    } catch {
      // Some devices advertise zoom but reject mid-session changes.
    } finally {
      applyInFlightRef.current = false;

      if (pendingZoomRef.current !== null) {
        void flushZoom();
      }
    }
  }, []);

  const requestZoom = React.useCallback(
    (nextZoom: number) => {
      const range = rangeRef.current;

      if (!range || !trackRef.current) {
        return;
      }

      const clamped = clampZoom(nextZoom, range);

      if (Math.abs(clamped - zoomRef.current) < range.step / 2) {
        return;
      }

      pendingZoomRef.current = clamped;
      void flushZoom();
    },
    [flushZoom],
  );

  React.useEffect(() => {
    const track = stream?.getVideoTracks()[0] ?? null;

    trackRef.current = track;
    pinchRef.current = null;
    pendingZoomRef.current = null;

    if (!track) {
      rangeRef.current = null;
      zoomRef.current = 1;
      setZoomRange(null);
      setZoom(1);
      return;
    }

    const range = readTrackZoomRange(track);
    const currentZoom = range ? readTrackZoom(track, range.min) : 1;

    rangeRef.current = range;
    zoomRef.current = currentZoom;
    setZoomRange(range);
    setZoom(currentZoom);
  }, [stream]);

  React.useEffect(() => {
    if (!planeElement || !zoomRange) {
      return;
    }

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) {
        return;
      }

      const distance = touchDistance(event.touches[0], event.touches[1]);

      if (distance <= 0) {
        return;
      }

      pinchRef.current = {
        startDistance: distance,
        startZoom: zoomRef.current,
      };
    };

    const onTouchMove = (event: TouchEvent) => {
      const pinch = pinchRef.current;

      if (!pinch || event.touches.length !== 2) {
        return;
      }

      event.preventDefault();

      const distance = touchDistance(event.touches[0], event.touches[1]);

      if (distance <= 0) {
        return;
      }

      requestZoom(pinch.startZoom * (distance / pinch.startDistance));
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) {
        pinchRef.current = null;
      }
    };

    planeElement.addEventListener("touchstart", onTouchStart, { passive: true });
    planeElement.addEventListener("touchmove", onTouchMove, { passive: false });
    planeElement.addEventListener("touchend", onTouchEnd);
    planeElement.addEventListener("touchcancel", onTouchEnd);

    return () => {
      planeElement.removeEventListener("touchstart", onTouchStart);
      planeElement.removeEventListener("touchmove", onTouchMove);
      planeElement.removeEventListener("touchend", onTouchEnd);
      planeElement.removeEventListener("touchcancel", onTouchEnd);
      pinchRef.current = null;
    };
  }, [planeElement, requestZoom, zoomRange]);

  return {
    zoom,
    zoomRange,
    canZoom: zoomRange !== null,
    cameraPlaneRef: setPlaneElement,
  };
}
