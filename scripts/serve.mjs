#!/usr/bin/env node
/** Minimal static file server for previewing site/ locally: `npm run serve`. */
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.join(REPO, 'site');
const PORT = Number(process.env.PORT) || 4173;

// Mirror the deployed subdirectory locally, so links resolve the same way
// here as they will on GitHub Pages.
const site = JSON.parse(await fs.readFile(path.join(REPO, 'data', 'site.json'), 'utf8'));
const BASE = (site.site.basePath || '').replace(/\/$/, '');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
};

createServer(async (req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (BASE && url.startsWith(BASE)) url = url.slice(BASE.length) || '/';
  else if (BASE && url === '/') {
    res.writeHead(302, { Location: `${BASE}/` }).end();
    return;
  }
  let file = path.join(ROOT, url);
  if (url.endsWith('/')) file = path.join(file, 'index.html');
  // Never serve outside site/.
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    try {
      const body = await fs.readFile(path.join(ROOT, '404.html'));
      res.writeHead(404, { 'Content-Type': TYPES['.html'] }).end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  }
}).listen(PORT, () => {
  console.log(`serving ${path.relative(process.cwd(), ROOT)} at http://localhost:${PORT}`);
});
