/**
 * Native MediaStreamTrack zoom helpers.
 *
 * Uses the camera's zoom constraint (optical/digital at the capture source)
 * via applyConstraints — never CSS transform/zoom on the preview.
 *
 * TypeScript's lib.dom types do not yet include `zoom` on media track
 * capability/constraint interfaces, so we narrow through local types.
 */

export type CameraZoomRange = {
  min: number;
  max: number;
  step: number;
};

type ZoomCapability = {
  min: number;
  max: number;
  step?: number;
};

type TrackCapabilitiesWithZoom = MediaTrackCapabilities & {
  zoom?: ZoomCapability;
};

type TrackSettingsWithZoom = MediaTrackSettings & {
  zoom?: number;
};

type TrackConstraintsWithZoom = MediaTrackConstraints & {
  zoom?: number | boolean;
  advanced?: Array<MediaTrackConstraintSet & { zoom?: number }>;
};

type SupportedConstraintsWithZoom = MediaTrackSupportedConstraints & {
  zoom?: boolean;
};

export function browserSupportsCameraZoom() {
  return Boolean(
    navigator.mediaDevices?.getSupportedConstraints?.() &&
      (navigator.mediaDevices.getSupportedConstraints() as SupportedConstraintsWithZoom)
        .zoom,
  );
}

export function readTrackZoomRange(
  track: MediaStreamTrack,
): CameraZoomRange | null {
  if (typeof track.getCapabilities !== "function") {
    return null;
  }

  const capabilities = track.getCapabilities() as TrackCapabilitiesWithZoom;
  const zoom = capabilities.zoom;

  if (
    !zoom ||
    typeof zoom.min !== "number" ||
    typeof zoom.max !== "number" ||
    !(zoom.max > zoom.min)
  ) {
    return null;
  }

  return {
    min: zoom.min,
    max: zoom.max,
    step: typeof zoom.step === "number" && zoom.step > 0 ? zoom.step : 0.1,
  };
}

export function readTrackZoom(track: MediaStreamTrack, fallback: number) {
  if (typeof track.getSettings !== "function") {
    return fallback;
  }

  const settings = track.getSettings() as TrackSettingsWithZoom;

  return typeof settings.zoom === "number" ? settings.zoom : fallback;
}

export function clampZoom(value: number, range: CameraZoomRange) {
  const clamped = Math.min(range.max, Math.max(range.min, value));

  if (range.step <= 0) {
    return clamped;
  }

  const steps = Math.round((clamped - range.min) / range.step);

  return Math.min(range.max, Math.max(range.min, range.min + steps * range.step));
}

export async function applyTrackZoom(track: MediaStreamTrack, zoom: number) {
  const constraints: TrackConstraintsWithZoom = {
    advanced: [{ zoom }],
  };

  await track.applyConstraints(constraints);
}

/** Constraints fragment that requests zoom permission when the UA supports it. */
export function zoomPermissionConstraint(): TrackConstraintsWithZoom | null {
  if (!browserSupportsCameraZoom()) {
    return null;
  }

  return { zoom: true };
}

export function touchDistance(a: Touch, b: Touch) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}
