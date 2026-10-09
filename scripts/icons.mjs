// Generates the PWA icons in public/icons/ from the transparent logo.
// Run after changing the logo: `npm run icons`. The outputs are committed.
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = `${root}src/assets/mafia-logo.png`;
const out = `${root}public/icons`;
const black = { r: 0, g: 0, b: 0, alpha: 1 };

/**
 * The logo centred on an opaque black square.
 * @param {number} size  output edge in px
 * @param {number} scale longest edge of the trimmed artwork as a fraction of `size`
 */
async function onBlack(size, scale) {
  const inner = Math.round(size * scale);
  // The source has generous transparent padding; trim it so `scale` means the visible artwork.
  const trimmed = await sharp(src).trim().toBuffer();
  const logo = await sharp(trimmed)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: black } })
    .composite([{ input: logo, gravity: 'center' }])
    .png({ compressionLevel: 9 });
}

await mkdir(out, { recursive: true });
// "any" icons: the full logo on black.
await (await onBlack(192, 0.86)).toFile(`${out}/icon-192.png`);
await (await onBlack(512, 0.86)).toFile(`${out}/icon-512.png`);
// Maskable: the artwork's bounding-box corners must stay inside the safe zone
// (a centred circle of radius 40%): 0.58 / 2 * sqrt(2) ≈ 0.41.
await (await onBlack(512, 0.58)).toFile(`${out}/icon-maskable-512.png`);
// iOS home-screen icon (iOS ignores the manifest icons).
await (await onBlack(180, 0.8)).toFile(`${out}/apple-touch-icon-180.png`);
console.log('icons written to public/icons/');
