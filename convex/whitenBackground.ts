import jpeg from "jpeg-js";
// Pure-JS PNG codec; no published TypeScript types.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error -- upng-js ships without types
import UPNG from "upng-js";

/** Pixels sampled from each corner when estimating the backdrop color. */
const CORNER_SAMPLE = 16;
/**
 * Corner average must be at least this bright (per channel) before we treat
 * the image as having a near-white background worth correcting.
 */
const NEAR_WHITE_MIN = 220;
/**
 * Max Chebyshev distance from the sampled corner color for a pixel to be
 * pulled toward pure white.
 */
const MATCH_THRESHOLD = 28;

type Rgb = { r: number; g: number; b: number };

type DecodedImage = {
  width: number;
  height: number;
  /** RGBA row-major pixels. */
  pixels: Uint8Array;
};

type UpngModule = {
  decode: (buffer: ArrayBuffer) => {
    width: number;
    height: number;
  };
  toRGBA8: (img: { width: number; height: number }) => ArrayBuffer[];
  encode: (
    frames: ArrayBuffer[],
    width: number,
    height: number,
    cnum: number,
  ) => ArrayBuffer;
};

const upng = UPNG as UpngModule;

function sampleCornerAverage(
  pixels: Uint8Array,
  width: number,
  height: number,
  sampleSize: number,
): Rgb {
  const size = Math.max(
    1,
    Math.min(sampleSize, Math.floor(width / 4), Math.floor(height / 4)),
  );
  const origins: Array<[number, number]> = [
    [0, 0],
    [width - size, 0],
    [0, height - size],
    [width - size, height - size],
  ];

  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  for (const [ox, oy] of origins) {
    for (let y = oy; y < oy + size; y += 1) {
      for (let x = ox; x < ox + size; x += 1) {
        const i = (y * width + x) * 4;
        r += pixels[i]!;
        g += pixels[i + 1]!;
        b += pixels[i + 2]!;
        count += 1;
      }
    }
  }

  return {
    r: Math.round(r / count),
    g: Math.round(g / count),
    b: Math.round(b / count),
  };
}

function isNearWhite(color: Rgb, minChannel: number) {
  return (
    color.r >= minChannel && color.g >= minChannel && color.b >= minChannel
  );
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function decodeImage(data: ArrayBuffer, mimeType: string): DecodedImage {
  const bytes = new Uint8Array(data);

  if (mimeType.includes("png")) {
    const png = upng.decode(toArrayBuffer(bytes));
    const rgbaFrames = upng.toRGBA8(png);
    const frame = rgbaFrames[0];
    if (!frame) {
      throw new Error("PNG decode returned no frames.");
    }
    return {
      width: png.width,
      height: png.height,
      pixels: new Uint8Array(frame),
    };
  }

  const decoded = jpeg.decode(bytes, { useTArray: true });
  return {
    width: decoded.width,
    height: decoded.height,
    pixels: decoded.data,
  };
}

function encodeImage(
  pixels: Uint8Array,
  width: number,
  height: number,
  mimeType: string,
): { data: ArrayBuffer; mimeType: string } {
  if (mimeType.includes("png")) {
    const encoded = upng.encode([toArrayBuffer(pixels)], width, height, 0);
    return {
      data: encoded,
      mimeType: "image/png",
    };
  }

  const encoded = jpeg.encode({ data: pixels, width, height }, 95).data;
  return {
    data: toArrayBuffer(encoded),
    mimeType: "image/jpeg",
  };
}

/**
 * Pull near-white backdrop pixels to pure white using the image corners as
 * the background reference. No-ops when corners do not look like a white BG.
 *
 * Pure JS (jpeg-js / upng-js) so Convex Node deploy does not need sharp's
 * platform-native binaries.
 */
export async function whitenOffWhiteBackground(
  data: ArrayBuffer,
  mimeType: string,
): Promise<{ data: ArrayBuffer; mimeType: string }> {
  const { width, height, pixels } = decodeImage(data, mimeType);
  const bg = sampleCornerAverage(pixels, width, height, CORNER_SAMPLE);

  if (!isNearWhite(bg, NEAR_WHITE_MIN)) {
    return { data, mimeType };
  }

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]!;
    const g = pixels[i + 1]!;
    const b = pixels[i + 2]!;
    const dist = Math.max(
      Math.abs(r - bg.r),
      Math.abs(g - bg.g),
      Math.abs(b - bg.b),
    );

    if (dist > MATCH_THRESHOLD) {
      continue;
    }

    // Stronger pull when closer to the sampled backdrop color.
    const pull = 1 - dist / MATCH_THRESHOLD;
    const t = pull * pull;
    pixels[i] = Math.round(r + (255 - r) * t);
    pixels[i + 1] = Math.round(g + (255 - g) * t);
    pixels[i + 2] = Math.round(b + (255 - b) * t);
  }

  return encodeImage(pixels, width, height, mimeType);
}
