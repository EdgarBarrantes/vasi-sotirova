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

/**
 * Every internal path is written root-relative ("/gallery/") and passed
 * through url() so the whole site can be served from a subdirectory —
 * a GitHub Pages project URL, for instance. Set site.basePath to "" once
 * it lives at a domain root.
 */
const BASE = (S.basePath || '').replace(/\/$/, '');
const url = (href) => `${BASE}${href}`;

const abs = (href) => new URL(url(href), S.baseUrl).href;

function srcset(key, ext) {
  if (ext === 'webp') return url(`/assets/img/${key}-${FALLBACK_WIDTH}.webp`);
  return WIDTHS.map((w) => `${url(`/assets/img/${key}-${w}.avif`)} ${w}w`).join(', ');
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
        <img src="${url(`/assets/img/${key}-${FALLBACK_WIDTH}.webp`)}" width="${w}" height="${h}"
             alt="${attr(img.alt || '')}" loading="${loading}" decoding="async"${
    fetchpriority ? ` fetchpriority="${fetchpriority}"` : ''
  }>
      </picture>`;
}

function jsonLd(data) {
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

/* -------------------------------------------------------------- layout */

/**
 * Search engines should only ever index the real site. While this builds for
 * the temporary Pages URL (no custom domain configured) every page is marked
 * noindex, so the staging copy cannot compete with vasisotirova.com.
 */
const INDEXABLE = Boolean(S.customDomain);

function layout({
  title, description, path: pagePath, body, ogImage, keywords = [],
  structuredData = [], isHome = false,
}) {
  const canonical = abs(pagePath);
  const image = ogImage ? abs(`/assets/img/${keyFor(ogImage)}-${FALLBACK_WIDTH}.webp`) : null;
  const nav = site.nav.map((item) => {
    const current = item.href === pagePath ? ' aria-current="page"' : '';
    return `<li><a class="nav__link" href="${url(item.href)}"${current}>${esc(item.label)}</a></li>`;
  }).join('\n            ');
  const social = (S.social || []).map((s) =>
    `<a href="${attr(s.href)}" rel="me noopener" target="_blank">${esc(s.label)}</a>`
  ).join('\n        ');
  // On the home page the site name is the page's main heading; elsewhere the
  // page's own <h1> holds that role.
  const titleTag = isHome ? 'h1' : 'p';
  const allKeywords = [...new Set([...(S.keywords || []), ...keywords])];

  return `<!DOCTYPE html>
<html lang="${S.lang}" class="no-js">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${attr(description)}">
  ${allKeywords.length ? `<meta name="keywords" content="${attr(allKeywords.join(', '))}">` : ''}
  <meta name="author" content="${attr(S.name)}">
  ${INDEXABLE ? '<meta name="robots" content="index, follow, max-image-preview:large">'
              : '<meta name="robots" content="noindex, follow">'}
  <link rel="canonical" href="${canonical}">

  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${attr(S.title)}">
  <meta property="og:title" content="${attr(title)}">
  <meta property="og:description" content="${attr(description)}">
  <meta property="og:url" content="${canonical}">
  ${image ? `<meta property="og:image" content="${image}">` : ''}
  <meta name="twitter:card" content="summary_large_image">

  <link rel="icon" href="${url('/assets/favicon.svg')}" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600;700&family=Montserrat:wght@300;400;600&display=swap">
  <link rel="stylesheet" href="${url('/assets/styles.css')}">
  ${structuredData.map(jsonLd).join('\n  ')}
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>

  <header class="masthead">
    <div class="shell">
      <${titleTag} class="masthead__title"><a href="${url('/')}">${esc(S.title)}</a></${titleTag}>
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
      <p class="footer__line"><a href="mailto:${attr(S.email)}">${esc(S.email)}</a></p>
      <p class="footer__line footer__social">
        ${social}
      </p>
      <p class="footer__line">Paintings and images &copy; ${new Date().getFullYear()} ${esc(S.name)}. All rights reserved.</p>
    </div>
  </footer>

  <script src="${url('/assets/app.js')}" defer></script>
</body>
</html>
`;
}

/* --------------------------------------------------------------- pages */

function artworkGrid(category) {
  if (!category.images.length) {
    return `      <p class="empty-note">There are no works on show here just yet — please check back soon, or
        <a href="${url('/contact/')}">get in touch</a> to ask what is currently available.</p>`;
  }
  const items = category.images.map((img, i) => {
    const key = keyFor(img.media);
    const alt = img.alt || `${category.title.replace(/s$/, '')} painting by ${S.name}`;
    return `        <li class="artwork">
          <button class="artwork__button" type="button"
                  data-lightbox data-full="${url(`/assets/img/${key}-1600.avif`)}"
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
  const intro = [].concat(site.home.intro)
    .map((p) => `          <p>${esc(p)}</p>`)
    .join('\n');
  const body = `      <section class="hero">
        <div class="hero__frame">
          ${picture(hero, { sizes: '(min-width: 800px) 760px, 100vw', loading: 'eager', fetchpriority: 'high' })}
        </div>
        <div class="hero__intro">
${intro}
        </div>
        <a class="button" href="${url('/gallery/')}">View the gallery</a>
      </section>`;
  return {
    file: 'index.html',
    path: '/',
    html: layout({
      title: S.defaultTitle,
      description: S.defaultDescription,
      path: '/',
      ogImage: hero.media,
      isHome: true,
      body,
      structuredData: [personSchema(), {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: S.title,
        url: abs('/'),
        about: { '@type': 'Person', name: S.name },
      }],
    }),
  };
}

/**
 * The Person record is what search engines read to connect the name, the
 * profession, the country and the social accounts into one entity — the thing
 * that gets her surfaced for "Bulgarian artist" rather than just her own name.
 */
function personSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: S.name,
    alternateName: 'Vasi Sotirova',
    jobTitle: 'Artist',
    description: S.defaultDescription,
    email: `mailto:${S.email}`,
    url: abs('/'),
    image: abs(`/assets/img/${keyFor(site.bio.images[0].media)}-960.webp`),
    nationality: { '@type': 'Country', name: 'Bulgaria' },
    birthPlace: { '@type': 'Place', name: 'Varna, Bulgaria' },
    birthDate: '1965',
    alumniOf: [
      { '@type': 'EducationalOrganization', name: 'High School of Applied Arts, Tryavna' },
      { '@type': 'EducationalOrganization', name: 'University of Fine Arts "Todor Samodumov", Dupnitsa' },
    ],
    knowsAbout: [
      'Oil painting', 'Acrylic painting', 'Dry pastel', 'Watercolour',
      'Portrait painting', 'Pet portraits', 'Landscape painting',
      'Still life', 'Abstract painting',
    ],
    sameAs: (S.social || []).map((s) => s.href),
  };
}

function galleryPage() {
  const cards = site.categories.map((cat) => {
    // The link already reads out the collection name, so the cover is decorative.
    const cover = { media: cat.cover, alt: '', width: 900, height: 1200 };
    const count = cat.images.length;
    return `        <li>
          <a class="category" href="${url(`/${cat.slug}/`)}">
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
      title: `Gallery | Paintings by ${S.name}, Bulgarian Artist`,
      description: `Browse original paintings by Bulgarian artist ${S.name} by collection: portraits, pet portraits, still life, Bulgarian landscapes, architectural scenes and abstract work.`,
      path: '/gallery/',
      ogImage: site.categories[0]?.cover,
      keywords: ['art gallery', 'original paintings', 'Bulgarian paintings', 'paintings for sale'],
      body,
      structuredData: [breadcrumbs([['Gallery', '/gallery/']]), {
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
  const body = `      <a class="backlink" href="${url('/gallery/')}">Back to gallery</a>
      <div class="page-head">
        <h1 class="page-head__title">${esc(cat.title)}</h1>
        <p class="page-head__lead">${esc(cat.description)}</p>
      </div>
${artworkGrid(cat)}`;

  return {
    file: `${cat.slug}/index.html`,
    path: `/${cat.slug}/`,
    html: layout({
      title: `${cat.title} by ${S.name} | Bulgarian Artist`,
      description: cat.description,
      path: `/${cat.slug}/`,
      ogImage: cat.cover || cat.images[0]?.media,
      keywords: cat.keywords || [],
      body,
      structuredData: [breadcrumbs([['Gallery', '/gallery/'], [cat.title, `/${cat.slug}/`]]),
        ...(cat.images.length ? [{
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
              creator: { '@type': 'Person', name: S.name, nationality: 'Bulgarian' },
              artform: 'Painting',
              image: abs(`/assets/img/${keyFor(img.media)}-1600.avif`),
            },
          })),
        },
      }] : [])],
    }),
  };
}

/** Breadcrumb trail, so results show Gallery › Portraits rather than a bare URL. */
function breadcrumbs(trail) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [['Home', '/'], ...trail].map(([name, href], i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name,
      item: abs(href),
    })),
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
      title: `Biography | ${S.name}, Bulgarian Painter`,
      description: `Biography of ${S.name}, a Bulgarian painter born in Varna in 1965 — training in Tryavna and Dupnitsa, and paintings held in private collections across Europe and North America.`,
      path: '/bio/',
      ogImage: bio.images[0]?.media,
      keywords: ['Bulgarian painter biography', 'Varna artist', 'Bulgarian art education', 'artist biography'],
      body,
      structuredData: [breadcrumbs([['Bio', '/bio/']]), personSchema()],
    }),
  };
}

function contactPage() {
  const c = site.contact;
  const links = (S.social || []).map((s) =>
    `          <li><a class="social-link" href="${attr(s.href)}" rel="me noopener" target="_blank">${esc(s.label)}</a></li>`
  ).join('\n');

  const body = `      <div class="page-head">
        <h1 class="page-head__title">${esc(c.title)}</h1>
      </div>
      <div class="contact">
        <p>${esc(c.lead)}</p>
        <a class="contact__email" href="mailto:${attr(S.email)}">${esc(S.email)}</a>
        <p class="contact__note">${esc(c.note)}</p>

        <p class="contact__follow">${esc(c.followLead)}</p>
        <ul class="social">
${links}
        </ul>
      </div>`;

  return {
    file: 'contact/index.html',
    path: '/contact/',
    html: layout({
      title: `Contact | Commission a Painting from ${S.name}`,
      description: `Contact Bulgarian artist ${S.name} to order an original painting or commission a portrait or pet portrait. Paintings ship worldwide.`,
      path: '/contact/',
      keywords: ['commission a painting', 'buy Bulgarian art', 'portrait commission', 'contact artist'],
      body,
      structuredData: [{
        '@context': 'https://schema.org',
        '@type': 'ContactPage',
        url: abs('/contact/'),
        mainEntity: personSchema(),
      }],
    }),
  };
}

function notFoundPage() {
  const body = `      <div class="page-head">
        <h1 class="page-head__title">Page not found</h1>
        <p class="page-head__lead">That page has moved or never existed.
          Try the <a href="${url('/gallery/')}">gallery</a> instead.</p>
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
  <meta http-equiv="refresh" content="0; url=${url(to)}">
  <meta name="robots" content="noindex">
</head>
<body><p>This page has moved to <a href="${url(to)}">${to}</a>.</p></body>
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

const ROBOTS = INDEXABLE
  ? `User-agent: *
Allow: /

Sitemap: ${abs('/sitemap.xml')}
`
  : `# Staging build (no custom domain configured) — keep it out of the index
# so it cannot compete with the live site.
User-agent: *
Disallow: /
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
// Tells GitHub Pages to serve the directory as-is rather than running Jekyll.
await fs.writeFile(path.join(OUT, '.nojekyll'), '');
// A CNAME is only written when a custom domain is configured.
if (S.customDomain) await fs.writeFile(path.join(OUT, 'CNAME'), `${S.customDomain}\n`);

console.log(`built ${pages.length} pages into ${path.relative(ROOT, OUT)}/`);
for (const p of pages) console.log(`  ${p.path.padEnd(28)} ${p.file}`);
