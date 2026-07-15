"use node";

import sharp from "sharp";

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

function sampleCornerAverage(
  pixels: Uint8Array,
  width: number,
  height: number,
  channels: number,
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
        const i = (y * width + x) * channels;
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

/**
 * Pull near-white backdrop pixels to pure white using the image corners as
 * the background reference. No-ops when corners do not look like a white BG.
 */
export async function whitenOffWhiteBackground(
  data: ArrayBuffer,
  mimeType: string,
): Promise<{ data: ArrayBuffer; mimeType: string }> {
  const { data: raw, info } = await sharp(Buffer.from(data))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const pixels = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  const bg = sampleCornerAverage(
    pixels,
    width,
    height,
    channels,
    CORNER_SAMPLE,
  );

  if (!isNearWhite(bg, NEAR_WHITE_MIN)) {
    return { data, mimeType };
  }

  for (let i = 0; i < pixels.length; i += channels) {
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

  const isPng = mimeType.includes("png");
  const encoded = isPng
    ? await sharp(pixels, { raw: { width, height, channels } })
        .png()
        .toBuffer()
    : await sharp(pixels, { raw: { width, height, channels } })
        .jpeg({ quality: 95, mozjpeg: true })
        .toBuffer();

  return {
    data: encoded.buffer.slice(
      encoded.byteOffset,
      encoded.byteOffset + encoded.byteLength,
    ),
    mimeType: isPng ? "image/png" : "image/jpeg",
  };
}
