#!/usr/bin/env node
/**
 * Renders the static site into site/ from data/site.json.
 *
 * No framework and no dependencies — the output is plain HTML that a browser
 * can open straight off disk or that any static host can serve as-is.
 * Images are expected in site/assets/img/ (see scripts/fetch-assets.mjs).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keyFor } from './fetch-assets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'site');
const WIDTHS = [480, 960, 1600];
const FALLBACK_WIDTH = 960;

const site = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'site.json'), 'utf8'));
const lqip = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'lqip.json'), 'utf8'));

const S = site.site;

/* ------------------------------------------------------------- helpers */

const esc = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const attr = (value = '') => esc(value).replace(/'/g, '&#39;');

const abs = (href) => new URL(href, S.baseUrl).href;

function srcset(key, ext) {
  if (ext === 'webp') return `/assets/img/${key}-${FALLBACK_WIDTH}.webp`;
  return WIDTHS.map((w) => `/assets/img/${key}-${w}.avif ${w}w`).join(', ');
}

/**
 * A <picture> that knows its own proportions before it loads: the intrinsic
 * width/height stop the page reflowing, and the inline blur-up preview fills
 * the frame until the real file decodes.
 */
function picture(img, { sizes, loading = 'lazy', className = '', fetchpriority } = {}) {
  const key = keyFor(img.media);
  const w = img.width || 1200;
  const h = img.height || 1600;
  const placeholder = lqip[key] ? ` style="background-image:url(${lqip[key]})"` : '';
  return `<picture class="${`blur-up ${className}`.trim()}"${placeholder}>
        <source type="image/avif" srcset="${srcset(key, 'avif')}" sizes="${attr(sizes)}">
        <img src="/assets/img/${key}-${FALLBACK_WIDTH}.webp" width="${w}" height="${h}"
             alt="${attr(img.alt || '')}" loading="${loading}" decoding="async"${
    fetchpriority ? ` fetchpriority="${fetchpriority}"` : ''
  }>
      </picture>`;
}

function jsonLd(data) {
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

/* -------------------------------------------------------------- layout */

function layout({ title, description, path: pagePath, body, ogImage, structuredData = [] }) {
  const canonical = abs(pagePath);
  const image = ogImage ? abs(`/assets/img/${keyFor(ogImage)}-${FALLBACK_WIDTH}.webp`) : null;
  const nav = site.nav.map((item) => {
    const current = item.href === pagePath ? ' aria-current="page"' : '';
    return `<li><a class="nav__link" href="${item.href}"${current}>${esc(item.label)}</a></li>`;
  }).join('\n            ');

  return `<!DOCTYPE html>
<html lang="${S.lang}" class="no-js">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${attr(description)}">
  <link rel="canonical" href="${canonical}">

  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${attr(S.title)}">
  <meta property="og:title" content="${attr(title)}">
  <meta property="og:description" content="${attr(description)}">
  <meta property="og:url" content="${canonical}">
  ${image ? `<meta property="og:image" content="${image}">` : ''}
  <meta name="twitter:card" content="summary_large_image">

  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600;700&family=Montserrat:wght@300;400;600&display=swap">
  <link rel="stylesheet" href="/assets/styles.css">
  ${structuredData.map(jsonLd).join('\n  ')}
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>

  <header class="masthead">
    <div class="shell">
      <a class="masthead__monogram" href="/" aria-hidden="true" tabindex="-1">${esc(S.monogram)}</a>
      <p class="masthead__title"><a href="/">${esc(S.title)}</a></p>
    </div>
    <nav class="nav" aria-label="Primary">
      <div class="shell">
        <ul class="nav__list">
            ${nav}
        </ul>
      </div>
    </nav>
  </header>

  <main id="main" tabindex="-1">
    <div class="shell">
${body}
    </div>
  </main>

  <footer class="footer">
    <div class="shell">
      <p class="footer__line">Paintings and images &copy; ${new Date().getFullYear()} ${esc(S.name)}. All rights reserved.</p>
      <p class="footer__line"><a href="mailto:${attr(S.email)}">${esc(S.email)}</a></p>
    </div>
  </footer>

  <script src="/assets/app.js" defer></script>
</body>
</html>
`;
}

/* --------------------------------------------------------------- pages */

function artworkGrid(category) {
  if (!category.images.length) {
    return `      <p class="empty-note">There are no works on show here just yet — please check back soon, or
        <a href="/contact/">get in touch</a> to ask what is currently available.</p>`;
  }
  const items = category.images.map((img, i) => {
    const key = keyFor(img.media);
    const alt = img.alt || `${category.title.replace(/s$/, '')} painting by ${S.name}`;
    return `        <li class="artwork">
          <button class="artwork__button" type="button"
                  data-lightbox data-full="/assets/img/${key}-1600.avif"
                  data-fullset="${srcset(key, 'avif')}"
                  data-alt="${attr(alt)}" data-width="${img.width || ''}" data-height="${img.height || ''}"
                  aria-label="View ${attr(alt)} larger">
            ${picture({ ...img, alt }, {
              sizes: '(min-width: 1100px) 360px, (min-width: 700px) 45vw, 92vw',
              loading: i < 6 ? 'eager' : 'lazy',
            })}
          </button>
        </li>`;
  }).join('\n');
  return `      <ul class="artworks">\n${items}\n      </ul>`;
}

function homePage() {
  const hero = site.home.hero;
  const body = `      <section class="hero">
        <div class="hero__frame">
          ${picture(hero, { sizes: '(min-width: 800px) 760px, 100vw', loading: 'eager', fetchpriority: 'high' })}
        </div>
        <p class="hero__intro">${esc(site.home.intro)}</p>
        <a class="button" href="/gallery/">View the gallery</a>
      </section>`;
  return {
    file: 'index.html',
    path: '/',
    html: layout({
      title: S.defaultTitle,
      description: S.defaultDescription,
      path: '/',
      ogImage: hero.media,
      body,
      structuredData: [
        {
          '@context': 'https://schema.org',
          '@type': 'Person',
          name: S.name,
          jobTitle: 'Artist',
          email: `mailto:${S.email}`,
          url: S.baseUrl,
          nationality: 'Bulgarian',
          description: S.defaultDescription,
        },
        {
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: S.title,
          url: S.baseUrl,
        },
      ],
    }),
  };
}

function galleryPage() {
  const cards = site.categories.map((cat) => {
    // The link already reads out the collection name, so the cover is decorative.
    const cover = { media: cat.cover, alt: '', width: 900, height: 1200 };
    const count = cat.images.length;
    return `        <li>
          <a class="category" href="/${cat.slug}/">
            <span class="category__frame">
              ${picture(cover, { sizes: '(min-width: 1100px) 280px, (min-width: 700px) 30vw, 92vw' })}
            </span>
            <span class="category__name">${esc(cat.title)}
              <span class="category__count">${count ? `${count} work${count === 1 ? '' : 's'}` : 'Coming soon'}</span>
            </span>
          </a>
        </li>`;
  }).join('\n');

  const body = `      <div class="page-head">
        <h1 class="page-head__title">Gallery</h1>
        <p class="page-head__lead">Portraits, landscapes, still life and abstract work in oil, acrylic,
          dry pastel and watercolour. Choose a collection to see the paintings.</p>
      </div>
      <ul class="categories">
${cards}
      </ul>`;

  return {
    file: 'gallery/index.html',
    path: '/gallery/',
    html: layout({
      title: `Gallery | ${S.name} paintings`,
      description: `Browse paintings by ${S.name} by collection: portraits, animal portraits, still life, landscapes and abstract work.`,
      path: '/gallery/',
      ogImage: site.categories[0]?.cover,
      body,
      structuredData: [{
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: 'Gallery',
        url: abs('/gallery/'),
        hasPart: site.categories.map((c) => ({
          '@type': 'CollectionPage',
          name: c.title,
          url: abs(`/${c.slug}/`),
        })),
      }],
    }),
  };
}

function categoryPage(cat) {
  const body = `      <a class="backlink" href="/gallery/">Back to gallery</a>
      <div class="page-head">
        <h1 class="page-head__title">${esc(cat.title)}</h1>
        <p class="page-head__lead">${esc(cat.description)}</p>
      </div>
${artworkGrid(cat)}`;

  return {
    file: `${cat.slug}/index.html`,
    path: `/${cat.slug}/`,
    html: layout({
      title: `${cat.title} | ${S.name} paintings`,
      description: cat.description,
      path: `/${cat.slug}/`,
      ogImage: cat.cover || cat.images[0]?.media,
      body,
      structuredData: cat.images.length ? [{
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: cat.title,
        url: abs(`/${cat.slug}/`),
        description: cat.description,
        mainEntity: {
          '@type': 'ItemList',
          numberOfItems: cat.images.length,
          itemListElement: cat.images.map((img, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            item: {
              '@type': 'VisualArtwork',
              name: img.alt || `${cat.title} painting`,
              creator: { '@type': 'Person', name: S.name },
              image: abs(`/assets/img/${keyFor(img.media)}-1600.avif`),
            },
          })),
        },
      }] : [],
    }),
  };
}

function bioPage() {
  const bio = site.bio;
  const rows = bio.timeline.map(([year, text]) => `          <div class="timeline__row">
            <dt>${esc(year)}</dt>
            <dd>${esc(text)}</dd>
          </div>`).join('\n');

  const portraits = bio.images.map((img) => `          <figure>
            ${picture(img, { sizes: '(min-width: 900px) 240px, 45vw' })}
          </figure>`).join('\n');

  const body = `      <div class="page-head">
        <h1 class="page-head__title">${esc(bio.title)}</h1>
      </div>
      <div class="bio">
        <div>
          <dl class="timeline">
${rows}
          </dl>
          <p class="bio__note">${esc(bio.note)}</p>
        </div>
        <div class="bio__portraits">
${portraits}
        </div>
      </div>`;

  return {
    file: 'bio/index.html',
    path: '/bio/',
    html: layout({
      title: `Bio | ${S.name}`,
      description: `Biography of ${S.name}, Bulgarian painter — training, exhibitions and collections.`,
      path: '/bio/',
      ogImage: bio.images[0]?.media,
      body,
    }),
  };
}

function contactPage() {
  const c = site.contact;
  const endpoint = c.formEndpoint || '';
  const body = `      <div class="page-head">
        <h1 class="page-head__title">${esc(c.title)}</h1>
      </div>
      <div class="contact">
        <p>${esc(c.lead)}</p>
        <a class="contact__email" href="mailto:${attr(S.email)}">${esc(S.email)}</a>

        <p>${esc(c.formNote)}</p>
        <form class="form" data-contact-form data-endpoint="${attr(endpoint)}"
              action="${endpoint || `mailto:${attr(S.email)}`}" method="post"
              ${endpoint ? '' : 'enctype="text/plain"'}>
          <p><label for="name">Name</label>
            <input id="name" name="name" type="text" autocomplete="name" required maxlength="100"></p>
          <p><label for="email">Email</label>
            <input id="email" name="email" type="email" autocomplete="email" required maxlength="250"></p>
          <p><label for="message">Message</label>
            <textarea id="message" name="message" required maxlength="2000"></textarea></p>
          <button class="button" type="submit">Send</button>
          <p class="form__status" role="status"></p>
        </form>
      </div>`;

  return {
    file: 'contact/index.html',
    path: '/contact/',
    html: layout({
      title: `Contact | ${S.name}`,
      description: `Contact ${S.name} to order a painting, commission a portrait, or ask about available work. Shipping worldwide.`,
      path: '/contact/',
      body,
      structuredData: [{
        '@context': 'https://schema.org',
        '@type': 'ContactPage',
        url: abs('/contact/'),
        mainEntity: { '@type': 'Person', name: S.name, email: `mailto:${S.email}` },
      }],
    }),
  };
}

function notFoundPage() {
  const body = `      <div class="page-head">
        <h1 class="page-head__title">Page not found</h1>
        <p class="page-head__lead">That page has moved or never existed.
          Try the <a href="/gallery/">gallery</a> instead.</p>
      </div>`;
  return {
    file: '404.html',
    path: '/404.html',
    html: layout({ title: `Page not found | ${S.name}`, description: 'Page not found.', path: '/404.html', body }),
  };
}

/** The old Wix site published the biography at /bio-1 — keep that URL alive. */
function redirect(from, to) {
  return {
    file: `${from.replace(/^\/|\/$/g, '')}/index.html`,
    path: from,
    html: `<!DOCTYPE html>
<html lang="${S.lang}">
<head>
  <meta charset="utf-8">
  <title>Redirecting…</title>
  <link rel="canonical" href="${abs(to)}">
  <meta http-equiv="refresh" content="0; url=${to}">
  <meta name="robots" content="noindex">
</head>
<body><p>This page has moved to <a href="${to}">${to}</a>.</p></body>
</html>
`,
  };
}

/* ---------------------------------------------------------------- write */

const pages = [
  homePage(),
  galleryPage(),
  ...site.categories.map(categoryPage),
  bioPage(),
  contactPage(),
  notFoundPage(),
  redirect('/bio-1/', '/bio/'),
];

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="#111"/>
  <text x="32" y="46" font-family="Dancing Script, cursive" font-size="46" fill="#fff" text-anchor="middle">V</text>
</svg>
`;

const ROBOTS = `User-agent: *
Allow: /

Sitemap: ${abs('/sitemap.xml')}
`;

function sitemap() {
  const today = new Date().toISOString().slice(0, 10);
  const urls = pages
    .filter((p) => !p.file.endsWith('404.html') && p.path !== '/bio-1/')
    .map((p) => `  <url>
    <loc>${abs(p.path)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>${p.path === '/' ? '1.0' : '0.7'}</priority>
  </url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

for (const page of pages) {
  const target = path.join(OUT, page.file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, page.html);
}

await fs.mkdir(path.join(OUT, 'assets'), { recursive: true });
await fs.copyFile(path.join(ROOT, 'src', 'styles.css'), path.join(OUT, 'assets', 'styles.css'));
await fs.copyFile(path.join(ROOT, 'src', 'app.js'), path.join(OUT, 'assets', 'app.js'));
await fs.writeFile(path.join(OUT, 'assets', 'favicon.svg'), FAVICON);
await fs.writeFile(path.join(OUT, 'robots.txt'), ROBOTS);
await fs.writeFile(path.join(OUT, 'sitemap.xml'), sitemap());

console.log(`built ${pages.length} pages into ${path.relative(ROOT, OUT)}/`);
for (const p of pages) console.log(`  ${p.path.padEnd(28)} ${p.file}`);
