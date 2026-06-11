// Generates the PWA / iOS icon set from public/favicon.svg (the Flashpart
// logo). Re-run after changing the logo: `node scripts/generate-icons.mjs`
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const publicDir = path.resolve(import.meta.dirname, "../public");
const outDir = path.join(publicDir, "icons");

// Rounded corners baked in; used where the platform shows the icon as-is.
const roundedSvg = await readFile(path.join(publicDir, "favicon.svg"), "utf8");

// Full-bleed square for iOS and maskable contexts, which apply their own
// corner mask: strip the rounded-rect radius from the clip path.
const fullBleedSvg = roundedSvg.replace('rx="50"', 'rx="0"');

async function render(svg, size, filename) {
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(path.join(outDir, filename));
  console.log(`wrote public/icons/${filename}`);
}

await mkdir(outDir, { recursive: true });
await render(roundedSvg, 192, "icon-192.png");
await render(roundedSvg, 512, "icon-512.png");
await render(fullBleedSvg, 180, "apple-touch-icon.png");
await render(fullBleedSvg, 512, "icon-maskable-512.png");
