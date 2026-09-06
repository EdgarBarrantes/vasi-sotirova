#!/usr/bin/env node
/**
 * Downloads every image referenced by data/site.json from the Wix media CDN and
 * writes local responsive derivatives into site/assets/img/.
 *
 * For each source image we keep:
 *   <key>-480.avif, <key>-960.avif, <key>-1600.avif   responsive AVIF ladder
 *   <key>-960.webp                                    fallback for pre-AVIF browsers
 * plus a 24px AVIF encoded into data/lqip.json, inlined at build time as a
 * blur-up placeholder so nothing pops in as it loads.
 *
 * The CDN does the resizing and encoding, so this needs no image tooling —
 * only curl. Re-running skips files that already exist (pass --force to redo).
 */
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMG_DIR = path.join(ROOT, 'site', 'assets', 'img');
const CDN = 'https://static.wixstatic.com/media';

const WIDTHS = [480, 960, 1600];
const FALLBACK_WIDTH = 960;
const LQIP_WIDTH = 24;
const CONCURRENCY = 6;
const FORCE = process.argv.includes('--force');

export function keyFor(media) {
  const m = /^[a-f0-9]+_([a-f0-9]{12})/.exec(media);
  if (m) return m[1];
  return media.replace(/[^a-z0-9]/gi, '').slice(0, 12).toLowerCase();
}

function variantUrl(media, width) {
  // `fit` bounds the long edge without cropping, so paintings keep their true
  // proportions; `enc_auto` lets the Accept header pick the encoding.
  return `${CDN}/${media}/v1/fit/w_${width},h_${width},q_85,enc_auto/${media}`;
}

async function download(url, accept) {
  const { stdout } = await execFileAsync(
    'curl',
    ['-sS', '-L', '--fail', '--retry', '3', '--retry-delay', '2',
     '-H', `Accept: ${accept}`, '--output', '-', url],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
  );
  return stdout;
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

function collectMedia(site) {
  const out = new Map();
  const add = (img) => { if (img?.media) out.set(img.media, img); };
  add(site.home?.hero);
  (site.bio?.images || []).forEach(add);
  for (const cat of site.categories || []) {
    if (cat.cover) out.set(cat.cover, { media: cat.cover });
    (cat.images || []).forEach(add);
  }
  return [...out.keys()];
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  const site = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'site.json'), 'utf8'));
  const media = collectMedia(site);
  await fs.mkdir(IMG_DIR, { recursive: true });

  const lqipPath = path.join(ROOT, 'data', 'lqip.json');
  const lqip = await exists(lqipPath)
    ? JSON.parse(await fs.readFile(lqipPath, 'utf8'))
    : {};

  console.log(`${media.length} source images -> ${IMG_DIR}`);
  let done = 0;

  await mapLimit(media, CONCURRENCY, async (m) => {
    const key = keyFor(m);
    for (const w of WIDTHS) {
      const file = path.join(IMG_DIR, `${key}-${w}.avif`);
      if (FORCE || !await exists(file)) {
        await fs.writeFile(file, await download(variantUrl(m, w), 'image/avif'));
      }
    }
    const fallback = path.join(IMG_DIR, `${key}-${FALLBACK_WIDTH}.webp`);
    if (FORCE || !await exists(fallback)) {
      await fs.writeFile(fallback, await download(variantUrl(m, FALLBACK_WIDTH), 'image/webp'));
    }
    if (FORCE || !lqip[key]) {
      const tiny = await download(variantUrl(m, LQIP_WIDTH), 'image/avif');
      lqip[key] = `data:image/avif;base64,${tiny.toString('base64')}`;
    }
    done += 1;
    if (done % 10 === 0 || done === media.length) {
      console.log(`  ${done}/${media.length}`);
    }
  });

  await fs.writeFile(lqipPath, `${JSON.stringify(lqip, null, 1)}\n`);
  console.log('assets ready');
}

// Only download when run directly — build.mjs imports keyFor() from here.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
