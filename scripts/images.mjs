/**
 * Image processing for the gallery.
 *
 * Every painting is stored once as an original under originals/ and derived
 * into the responsive set the site serves:
 *   <key>-480.avif, <key>-960.avif, <key>-1600.avif   responsive AVIF ladder
 *   <key>-960.webp                                    fallback for pre-AVIF browsers
 * plus a 24px AVIF recorded in data/lqip.json and inlined at build time as a
 * blur-up placeholder.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

export const WIDTHS = [480, 960, 1600];
export const FALLBACK_WIDTH = 960;
const LQIP_WIDTH = 24;

/**
 * The key names every derivative on disk and every alt-text entry in the
 * locale files. Images carried over from the old host are named by their
 * media id; anything added since is <key>.<ext>, so both resolve to the
 * same 12 characters.
 */
export function keyFor(media) {
  const m = /^[a-f0-9]+_([a-f0-9]{12})/.exec(media);
  if (m) return m[1];
  return media.replace(/[^a-z0-9]/gi, '').slice(0, 12).toLowerCase();
}

export const newKey = () => crypto.randomBytes(6).toString('hex');

/**
 * Writes the derivative set for one image.
 * Returns the dimensions to record in the manifest and the blur-up data URI.
 */
export async function deriveVariants(buffer, key, imgDir) {
  // .rotate() bakes in EXIF orientation — phone photos are routinely stored
  // sideways with a tag, and the tag is lost once we re-encode. Dimensions
  // must come from the rotated image, or portraits get landscape-shaped
  // placeholder boxes.
  const { data: upright, info } = await sharp(buffer)
    .rotate()
    .toBuffer({ resolveWithObject: true });

  await fs.mkdir(imgDir, { recursive: true });

  const resize = (width) => sharp(upright).resize({
    width,
    height: width,
    fit: 'inside',
    withoutEnlargement: true,
  });

  for (const width of WIDTHS) {
    await resize(width).avif({ quality: 55 }).toFile(path.join(imgDir, `${key}-${width}.avif`));
  }
  await resize(FALLBACK_WIDTH).webp({ quality: 82 })
    .toFile(path.join(imgDir, `${key}-${FALLBACK_WIDTH}.webp`));

  const tiny = await resize(LQIP_WIDTH).avif({ quality: 40 }).toBuffer();

  return {
    width: info.width,
    height: info.height,
    lqip: `data:image/avif;base64,${tiny.toString('base64')}`,
  };
}

/** Removes every derivative for a key — used when a painting is deleted. */
export async function removeVariants(key, imgDir) {
  const files = [
    ...WIDTHS.map((w) => `${key}-${w}.avif`),
    `${key}-${FALLBACK_WIDTH}.webp`,
  ];
  await Promise.all(files.map((f) => fs.rm(path.join(imgDir, f), { force: true })));
}
