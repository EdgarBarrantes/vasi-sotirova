#!/usr/bin/env node
/**
 * Turns pending uploads into published paintings.
 *
 * The admin page commits two files per painting into uploads/ — the original
 * image and a small JSON sidecar describing it. This script picks each pair
 * up, derives the responsive image set, records the painting in
 * data/site.json and its descriptions in each data/i18n/<locale>.json, moves
 * the original into originals/, and clears the pair out of uploads/.
 *
 * It runs in CI before every build, and is safe to run when there is nothing
 * pending — it exits quietly.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveVariants, keyFor } from './images.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UPLOADS = path.join(ROOT, 'uploads');
const ORIGINALS = path.join(ROOT, 'originals');
const IMG_DIR = path.join(ROOT, 'site', 'assets', 'img');

const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));
const writeJson = async (p, data) => fs.writeFile(p, `${JSON.stringify(data, null, 2)}\n`);

async function listPending() {
  try {
    const names = await fs.readdir(UPLOADS);
    return names.filter((n) => n.endsWith('.json')).sort();
  } catch {
    return [];
  }
}

/**
 * Moves an upload we cannot publish out of the way. Left in place it would be
 * retried — and fail — on every subsequent build.
 */
async function reject(name, file, why) {
  const dir = path.join(UPLOADS, 'rejected');
  await fs.mkdir(dir, { recursive: true });
  for (const f of [name, file].filter(Boolean)) {
    await fs.rename(path.join(UPLOADS, f), path.join(dir, f)).catch(() => {});
  }
  console.error(`rejected ${name}: ${why}`);
}

async function main() {
  const pending = await listPending();
  if (!pending.length) {
    console.log('no pending uploads');
    return;
  }

  const site = await readJson(path.join(ROOT, 'data', 'site.json'));
  const lqip = await readJson(path.join(ROOT, 'data', 'lqip.json'));
  const locales = Object.fromEntries(await Promise.all(site.site.locales.map(async (code) => [
    code,
    await readJson(path.join(ROOT, 'data', 'i18n', `${code}.json`)),
  ])));

  let added = 0;
  for (const name of pending) {
    const sidecarPath = path.join(UPLOADS, name);
    let meta;
    try {
      meta = await readJson(sidecarPath);
    } catch (err) {
      await reject(name, null, `unreadable sidecar (${err.message})`);
      continue;
    }

    const category = site.categories.find((c) => c.slug === meta.category);
    if (!category) {
      await reject(name, meta.file, `no such collection "${meta.category}"`);
      continue;
    }

    const imagePath = path.join(UPLOADS, meta.file || '');
    let buffer;
    try {
      buffer = await fs.readFile(imagePath);
    } catch {
      await reject(name, null, `image ${meta.file} is missing`);
      continue;
    }

    const key = meta.key || keyFor(meta.file);
    let derived;
    try {
      derived = await deriveVariants(buffer, key, IMG_DIR);
    } catch (err) {
      await reject(name, meta.file, `could not process image (${err.message})`);
      continue;
    }

    lqip[key] = derived.lqip;

    const entry = { media: meta.file, width: derived.width, height: derived.height };
    // Optional details. Omitted rather than stored empty, so a painting
    // without them carries no empty fields around.
    if (meta.technique) entry.technique = String(meta.technique);
    if (meta.size) entry.size = String(meta.size);
    // Re-uploading the same key replaces the existing record rather than
    // adding a duplicate.
    const existing = category.images.findIndex((i) => keyFor(i.media) === key);
    if (existing >= 0) category.images[existing] = entry;
    else if (meta.position === 'end') category.images.push(entry);
    else category.images.unshift(entry);

    for (const code of site.site.locales) {
      const text = (meta.alt && meta.alt[code]) || '';
      if (text) locales[code].alt[key] = text;
      else console.warn(`  ${key}: no ${code} description given`);

      const title = (meta.title && meta.title[code]) || '';
      const note = (meta.note && meta.note[code]) || '';
      locales[code].titles = locales[code].titles || {};
      locales[code].notes = locales[code].notes || {};
      if (title) locales[code].titles[key] = title;
      if (note) locales[code].notes[key] = note;
    }

    await fs.mkdir(ORIGINALS, { recursive: true });
    await fs.rename(imagePath, path.join(ORIGINALS, meta.file));
    await fs.rm(sidecarPath, { force: true });

    added += 1;
    console.log(`added ${key} to ${category.slug} (${derived.width}x${derived.height})`);
  }

  if (!added) {
    console.log('nothing added');
    return;
  }

  await writeJson(path.join(ROOT, 'data', 'site.json'), site);
  await writeJson(path.join(ROOT, 'data', 'lqip.json'), lqip);
  for (const code of site.site.locales) {
    await writeJson(path.join(ROOT, 'data', 'i18n', `${code}.json`), locales[code]);
  }
  console.log(`processed ${added} upload${added === 1 ? '' : 's'}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
