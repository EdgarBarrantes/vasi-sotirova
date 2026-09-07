#!/usr/bin/env node
/**
 * Renders the static site into site/ from data/site.json (structure) and
 * data/i18n/<locale>.json (every piece of text).
 *
 * The default locale lives at the root and each additional locale under its
 * own prefix — "/gallery/" and "/bg/gallery/" — so the English URLs carried
 * over from the old site keep working.
 *
 * No framework and no dependencies: the output is plain HTML that any static
 * host can serve as-is. Images are expected in site/assets/img/
 * (see scripts/fetch-assets.mjs).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keyFor, WIDTHS, FALLBACK_WIDTH } from './images.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'site');

const site = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'site.json'), 'utf8'));
const lqip = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'lqip.json'), 'utf8'));

const S = site.site;
const DEFAULT_LOCALE = S.defaultLocale;
const LOCALES = Object.fromEntries(await Promise.all(S.locales.map(async (code) => [
  code,
  JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'i18n', `${code}.json`), 'utf8')),
])));

/* ------------------------------------------------------------- helpers */

const esc = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const attr = (value = '') => esc(value).replace(/'/g, '&#39;');

/**
 * Every internal path is written locale-independently ("/gallery/") and passed
 * through these two helpers: localised() puts it under the right language
 * prefix, url() puts it under site.basePath so the whole site can be served
 * from a subdirectory. Set site.basePath to "" once it lives at a domain root.
 */
const BASE = (S.basePath || '').replace(/\/$/, '');
const localised = (locale, href) => (locale === DEFAULT_LOCALE ? href : `/${locale}${href}`);

/**
 * Links and asset references are emitted with a marker instead of a leading
 * slash, and each page rewrites the marker into the right number of "../"
 * steps for its own depth as it is written out. Relative references mean one
 * build works wherever it is mounted — at a domain root and under a project
 * path like /vasi-sotirova/ — which matters while a domain move is in flight
 * and both addresses are serving.
 *
 * Absolute URLs (canonical, hreflang, Open Graph, sitemap) must still name one
 * true home, so those go through sitePath()/abs() and keep site.basePath.
 */
const REL = '__REL__';
const url = (href) => `${REL}${href}`;
const href = (locale, path_) => url(localised(locale, path_));

const sitePath = (locale, path_) => `${BASE}${localised(locale, path_)}`;
const abs = (locale, path_) => new URL(sitePath(locale, path_), S.baseUrl).href;

/** "" at the root, "../" one level down, and so on. */
const relPrefix = (file) => {
  const depth = file.split('/').length - 1;
  return depth === 0 ? '' : '../'.repeat(depth);
};

const resolveLinks = (html, file) => html.split(`${REL}/`).join(relPrefix(file));

/** Fills {placeholders} in a translated string. */
const fill = (template, values) =>
  String(template).replace(/\{(\w+)\}/g, (m, k) => (k in values ? values[k] : m));

const plural = (forms, n) => fill(n === 1 ? forms.one : forms.other, { n });

/**
 * Search engines should only ever index the real site. While this builds for
 * the temporary Pages URL (no custom domain configured) every page is marked
 * noindex, so the staging copy cannot compete with vasisotirova.com.
 */
const INDEXABLE = Boolean(S.customDomain);

function srcset(key, ext) {
  if (ext === 'webp') return url(`/assets/img/${key}-${FALLBACK_WIDTH}.webp`);
  return WIDTHS.map((w) => `${url(`/assets/img/${key}-${w}.avif`)} ${w}w`).join(', ');
}

/**
 * A <picture> that knows its own proportions before it loads: the intrinsic
 * width/height stop the page reflowing, and the inline blur-up preview fills
 * the frame until the real file decodes.
 */
function picture(img, alt, { sizes, loading = 'lazy', className = '', fetchpriority } = {}) {
  const key = keyFor(img.media);
  const w = img.width || 1200;
  const h = img.height || 1600;
  const placeholder = lqip[key] ? ` style="background-image:url(${lqip[key]})"` : '';
  return `<picture class="${`blur-up ${className}`.trim()}"${placeholder}>
        <source type="image/avif" srcset="${srcset(key, 'avif')}" sizes="${attr(sizes)}">
        <img src="${url(`/assets/img/${key}-${FALLBACK_WIDTH}.webp`)}" width="${w}" height="${h}"
             alt="${attr(alt || '')}" loading="${loading}" decoding="async"${
    fetchpriority ? ` fetchpriority="${fetchpriority}"` : ''
  }>
      </picture>`;
}

const jsonLd = (data) =>
  `<script type="application/ld+json">${JSON.stringify(data)}</script>`;

/**
 * The Person record is what search engines read to connect the name, the
 * profession, the country and the social accounts into one entity — the thing
 * that surfaces her for "Bulgarian artist" rather than only for her own name.
 */
function personSchema(locale) {
  const t = LOCALES[locale];
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: t.name,
    jobTitle: locale === 'bg' ? 'Художник' : 'Artist',
    description: t.home.description,
    email: `mailto:${S.email}`,
    url: abs(locale, '/'),
    image: abs(locale, `/assets/img/${keyFor(site.bio.images[0].media)}-960.webp`),
    nationality: { '@type': 'Country', name: locale === 'bg' ? 'България' : 'Bulgaria' },
    birthPlace: { '@type': 'Place', name: locale === 'bg' ? 'Варна, България' : 'Varna, Bulgaria' },
    birthDate: '1965',
    knowsLanguage: ['bg', 'en'],
    sameAs: (S.social || []).map((s) => s.href),
  };
}

/** Breadcrumb trail, so results show Gallery › Portraits rather than a bare URL. */
function breadcrumbs(locale, trail) {
  const t = LOCALES[locale];
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [[t.nav.home, '/'], ...trail].map(([name, to], i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name,
      item: abs(locale, to),
    })),
  };
}

/* -------------------------------------------------------------- layout */

function layout({
  locale, title, description, path: pagePath, body, ogImage, keywords = [],
  structuredData = [], isHome = false,
}) {
  const t = LOCALES[locale];
  const canonical = abs(locale, pagePath);
  const image = ogImage ? abs(locale, `/assets/img/${keyFor(ogImage)}-${FALLBACK_WIDTH}.webp`) : null;

  const nav = site.nav.map((item) => {
    const current = item.href === pagePath ? ' aria-current="page"' : '';
    return `<li><a class="nav__link" href="${href(locale, item.href)}"${current}>${esc(t.nav[item.key])}</a></li>`;
  }).join('\n            ');

  // Same page, other language. Screen readers get the language name; sighted
  // users get the short code, so the switcher stays out of the way.
  const langs = S.locales.map((code) => {
    const other = LOCALES[code];
    const current = code === locale;
    return `<li><a class="lang__link" href="${href(code, pagePath)}" hreflang="${code}" lang="${code}"
             ${current ? 'aria-current="true"' : ''}><span class="lang__code">${esc(code.toUpperCase())}</span><span class="visually-hidden">${esc(other.label)}</span></a></li>`;
  }).join('\n          ');

  const alternates = [
    ...S.locales.map((code) =>
      `<link rel="alternate" hreflang="${code}" href="${abs(code, pagePath)}">`),
    `<link rel="alternate" hreflang="x-default" href="${abs(DEFAULT_LOCALE, pagePath)}">`,
  ].join('\n  ');

  const social = (S.social || []).map((s) =>
    `<a href="${attr(s.href)}" rel="me noopener" target="_blank">${esc(s.label)}</a>`
  ).join('\n        ');

  // On the home page the site name is the page's main heading; elsewhere the
  // page's own <h1> holds that role.
  const titleTag = isHome ? 'h1' : 'p';
  const allKeywords = [...new Set([...(t.keywords || []), ...keywords])];

  return `<!DOCTYPE html>
<html lang="${t.htmlLang}" class="no-js">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${attr(description)}">
  ${allKeywords.length ? `<meta name="keywords" content="${attr(allKeywords.join(', '))}">` : ''}
  <meta name="author" content="${attr(t.name)}">
  ${INDEXABLE ? '<meta name="robots" content="index, follow, max-image-preview:large">'
              : '<meta name="robots" content="noindex, follow">'}
  <link rel="canonical" href="${canonical}">
  ${alternates}

  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${attr(t.title)}">
  <meta property="og:title" content="${attr(title)}">
  <meta property="og:description" content="${attr(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:locale" content="${t.ogLocale}">
  ${S.locales.filter((c) => c !== locale)
      .map((c) => `<meta property="og:locale:alternate" content="${LOCALES[c].ogLocale}">`).join('\n  ')}
  ${image ? `<meta property="og:image" content="${image}">` : ''}
  <meta name="twitter:card" content="summary_large_image">

  <link rel="icon" href="${url('/assets/favicon.svg')}" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${t.displayFont.google}&family=Montserrat:wght@300;400;600&display=swap">
  <link rel="stylesheet" href="${url('/assets/styles.css')}">
  <!-- Dancing Script has no Cyrillic, so each locale names its own display
       face; Montserrat covers both alphabets and is shared. -->
  <style>:root{--display:${t.displayFont.stack};--display-scale:${t.displayFont.scale}}</style>
  ${structuredData.map(jsonLd).join('\n  ')}
</head>
<body>
  <a class="skip-link" href="#main">${esc(t.ui.skip)}</a>

  <header class="masthead">
    <div class="shell">
      <${titleTag} class="masthead__title"><a href="${href(locale, '/')}">${esc(t.title)}</a></${titleTag}>
    </div>
    <nav class="nav" aria-label="${attr(t.ui.primaryNav)}">
      <div class="shell nav__inner">
        <ul class="nav__list">
            ${nav}
        </ul>
        <ul class="lang" aria-label="${attr(t.ui.languageLabel)}">
          ${langs}
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
      <p class="footer__line">${esc(fill(t.ui.rights, { year: new Date().getFullYear(), name: t.name }))}</p>
    </div>
  </footer>

  <script src="${url('/assets/app.js')}" defer></script>
</body>
</html>
`;
}

/* --------------------------------------------------------------- pages */

function artworkGrid(locale, category) {
  const t = LOCALES[locale];
  const cat = t.categories[category.slug];

  if (!category.images.length) {
    const link = `<a href="${href(locale, '/contact/')}">${esc(t.emptyCategoryLink)}</a>`;
    return `      <p class="empty-note">${fill(esc(t.emptyCategory), { link })}</p>`;
  }

  const items = category.images.map((img, i) => {
    const key = keyFor(img.media);
    const alt = t.alt[key] || cat.title;
    return `        <li class="artwork">
          <button class="artwork__button" type="button"
                  data-lightbox data-full="${url(`/assets/img/${key}-1600.avif`)}"
                  data-fullset="${srcset(key, 'avif')}"
                  data-alt="${attr(alt)}" data-width="${img.width || ''}" data-height="${img.height || ''}"
                  aria-label="${attr(fill(t.ui.viewLarger, { alt }))}">
            ${picture(img, alt, {
              sizes: '(min-width: 1100px) 360px, (min-width: 700px) 45vw, 92vw',
              loading: i < 6 ? 'eager' : 'lazy',
            })}
          </button>
        </li>`;
  }).join('\n');

  return `      <ul class="artworks">\n${items}\n      </ul>`;
}

function homePage(locale) {
  const t = LOCALES[locale];
  const hero = site.home.hero;
  const intro = [].concat(t.home.intro).map((p) => `          <p>${esc(p)}</p>`).join('\n');
  const body = `      <section class="hero">
        <div class="hero__frame">
          ${picture(hero, t.alt[keyFor(hero.media)], {
            sizes: '(min-width: 800px) 760px, 100vw', loading: 'eager', fetchpriority: 'high',
          })}
        </div>
        <div class="hero__intro">
${intro}
        </div>
        <a class="button" href="${href(locale, '/gallery/')}">${esc(t.ui.viewGallery)}</a>
      </section>`;

  return {
    locale,
    file: 'index.html',
    path: '/',
    html: layout({
      locale,
      title: t.home.title,
      description: t.home.description,
      path: '/',
      ogImage: hero.media,
      isHome: true,
      body,
      structuredData: [personSchema(locale), {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: t.title,
        url: abs(locale, '/'),
        inLanguage: t.htmlLang,
        about: { '@type': 'Person', name: t.name },
      }],
    }),
  };
}

function galleryPage(locale) {
  const t = LOCALES[locale];
  const cards = site.categories.map((cat) => {
    const c = t.categories[cat.slug];
    // The link already reads out the collection name, so the cover is decorative.
    const cover = { media: cat.cover, width: 900, height: 1200 };
    const count = cat.images.length;
    return `        <li>
          <a class="category" href="${href(locale, `/${cat.slug}/`)}">
            <span class="category__frame">
              ${picture(cover, '', { sizes: '(min-width: 1100px) 280px, (min-width: 700px) 30vw, 92vw' })}
            </span>
            <span class="category__name">${esc(c.title)}
              <span class="category__count">${esc(count ? plural(t.ui.works, count) : t.ui.comingSoon)}</span>
            </span>
          </a>
        </li>`;
  }).join('\n');

  const body = `      <div class="page-head">
        <h1 class="page-head__title">${esc(t.gallery.heading)}</h1>
        <p class="page-head__lead">${esc(t.gallery.lead)}</p>
      </div>
      <ul class="categories">
${cards}
      </ul>`;

  return {
    locale,
    file: 'gallery/index.html',
    path: '/gallery/',
    html: layout({
      locale,
      title: t.gallery.title,
      description: t.gallery.description,
      path: '/gallery/',
      ogImage: site.categories[0]?.cover,
      keywords: t.gallery.keywords,
      body,
      structuredData: [breadcrumbs(locale, [[t.gallery.heading, '/gallery/']]), {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: t.gallery.heading,
        url: abs(locale, '/gallery/'),
        inLanguage: t.htmlLang,
        hasPart: site.categories.map((c) => ({
          '@type': 'CollectionPage',
          name: t.categories[c.slug].title,
          url: abs(locale, `/${c.slug}/`),
        })),
      }],
    }),
  };
}

function categoryPage(locale, cat) {
  const t = LOCALES[locale];
  const c = t.categories[cat.slug];
  const body = `      <a class="backlink" href="${href(locale, '/gallery/')}">${esc(t.ui.backToGallery)}</a>
      <div class="page-head">
        <h1 class="page-head__title">${esc(c.title)}</h1>
        <p class="page-head__lead">${esc(c.description)}</p>
      </div>
${artworkGrid(locale, cat)}`;

  return {
    locale,
    file: `${cat.slug}/index.html`,
    path: `/${cat.slug}/`,
    html: layout({
      locale,
      title: `${c.title} — ${t.name} | ${locale === 'bg' ? 'българска художничка' : 'Bulgarian Artist'}`,
      description: c.description,
      path: `/${cat.slug}/`,
      ogImage: cat.cover || cat.images[0]?.media,
      keywords: c.keywords || [],
      body,
      structuredData: [
        breadcrumbs(locale, [[t.gallery.heading, '/gallery/'], [c.title, `/${cat.slug}/`]]),
        ...(cat.images.length ? [{
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: c.title,
          url: abs(locale, `/${cat.slug}/`),
          description: c.description,
          inLanguage: t.htmlLang,
          mainEntity: {
            '@type': 'ItemList',
            numberOfItems: cat.images.length,
            itemListElement: cat.images.map((img, i) => ({
              '@type': 'ListItem',
              position: i + 1,
              item: {
                '@type': 'VisualArtwork',
                name: t.alt[keyFor(img.media)] || c.title,
                creator: { '@type': 'Person', name: t.name },
                artform: locale === 'bg' ? 'Живопис' : 'Painting',
                image: abs(locale, `/assets/img/${keyFor(img.media)}-1600.avif`),
              },
            })),
          },
        }] : []),
      ],
    }),
  };
}

function bioPage(locale) {
  const t = LOCALES[locale];
  const rows = site.bio.years.map((year, i) => `          <div class="timeline__row">
            <dt>${esc(year)}</dt>
            <dd>${esc(t.bio.timeline[i])}</dd>
          </div>`).join('\n');

  const portraits = site.bio.images.map((img) => `          <figure>
            ${picture(img, t.alt[keyFor(img.media)], { sizes: '(min-width: 900px) 240px, 45vw' })}
          </figure>`).join('\n');

  const body = `      <div class="page-head">
        <h1 class="page-head__title">${esc(t.bio.heading)}</h1>
      </div>
      <div class="bio">
        <div>
          <dl class="timeline">
${rows}
          </dl>
          <p class="bio__note">${esc(t.bio.note)}</p>
        </div>
        <div class="bio__portraits">
${portraits}
        </div>
      </div>`;

  return {
    locale,
    file: 'bio/index.html',
    path: '/bio/',
    html: layout({
      locale,
      title: t.bio.title,
      description: t.bio.description,
      path: '/bio/',
      ogImage: site.bio.images[0]?.media,
      keywords: t.bio.keywords,
      body,
      structuredData: [breadcrumbs(locale, [[t.bio.heading, '/bio/']]), personSchema(locale)],
    }),
  };
}

function contactPage(locale) {
  const t = LOCALES[locale];
  const links = (S.social || []).map((s) =>
    `          <li><a class="social-link" href="${attr(s.href)}" rel="me noopener" target="_blank">${esc(s.label)}</a></li>`
  ).join('\n');

  const body = `      <div class="page-head">
        <h1 class="page-head__title">${esc(t.contact.heading)}</h1>
      </div>
      <div class="contact">
        <p>${esc(t.contact.lead)}</p>
        <a class="contact__email" href="mailto:${attr(S.email)}">${esc(S.email)}</a>
        <p class="contact__note">${esc(t.contact.note)}</p>

        <p class="contact__follow">${esc(t.contact.followLead)}</p>
        <ul class="social">
${links}
        </ul>
      </div>`;

  return {
    locale,
    file: 'contact/index.html',
    path: '/contact/',
    html: layout({
      locale,
      title: t.contact.title,
      description: t.contact.description,
      path: '/contact/',
      keywords: t.contact.keywords,
      body,
      structuredData: [{
        '@context': 'https://schema.org',
        '@type': 'ContactPage',
        url: abs(locale, '/contact/'),
        inLanguage: t.htmlLang,
        mainEntity: personSchema(locale),
      }],
    }),
  };
}

/** GitHub Pages serves one 404 for the whole site, so it stays at the root. */
function notFoundPage() {
  const locale = DEFAULT_LOCALE;
  const t = LOCALES[locale];
  const link = `<a href="${href(locale, '/gallery/')}">${esc(t.notFound.linkText)}</a>`;
  const body = `      <div class="page-head">
        <h1 class="page-head__title">${esc(t.notFound.heading)}</h1>
        <p class="page-head__lead">${fill(esc(t.notFound.lead), { link })}</p>
      </div>`;
  return {
    locale,
    file: '404.html',
    path: '/404.html',
    html: layout({
      locale, title: t.notFound.title, description: t.notFound.heading, path: '/404.html', body,
    }),
  };
}

/** The old Wix site published the biography at /bio-1 — keep that URL alive. */
function redirect(from, to) {
  const locale = DEFAULT_LOCALE;
  const t = LOCALES[locale];
  const target = href(locale, to);
  return {
    locale,
    file: `${from.replace(/^\/|\/$/g, '')}/index.html`,
    path: from,
    redirect: true,
    html: `<!DOCTYPE html>
<html lang="${t.htmlLang}">
<head>
  <meta charset="utf-8">
  <title>${esc(t.ui.redirectNotice)} ${esc(to)}</title>
  <link rel="canonical" href="${abs(locale, to)}">
  <meta http-equiv="refresh" content="0; url=${target}">
  <meta name="robots" content="noindex">
</head>
<body><p>${esc(t.ui.redirectNotice)} <a href="${target}">${esc(to)}</a>.</p></body>
</html>
`,
  };
}

/* ---------------------------------------------------------------- write */

const pages = [];
for (const locale of S.locales) {
  pages.push(
    homePage(locale),
    galleryPage(locale),
    ...site.categories.map((cat) => categoryPage(locale, cat)),
    bioPage(locale),
    contactPage(locale),
  );
}
pages.push(notFoundPage(), redirect('/bio-1/', '/bio/'));

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="#111"/>
  <text x="32" y="46" font-family="Dancing Script, cursive" font-size="46" fill="#fff" text-anchor="middle">V</text>
</svg>
`;

const ROBOTS = INDEXABLE
  ? `User-agent: *
Disallow: /admin/
Allow: /

Sitemap: ${abs(DEFAULT_LOCALE, '/sitemap.xml')}
`
  : `# Staging build (no custom domain configured) — keep it out of the index
# so it cannot compete with the live site.
User-agent: *
Disallow: /
`;

/** Each URL lists its translations, so the pair is understood as one page. */
function sitemap() {
  const today = new Date().toISOString().slice(0, 10);
  const seen = new Set();
  const entries = [];
  for (const page of pages) {
    if (page.redirect || page.file.endsWith('404.html')) continue;
    const id = `${page.locale}${page.path}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const alternates = S.locales.map((code) =>
      `    <xhtml:link rel="alternate" hreflang="${code}" href="${abs(code, page.path)}"/>`).join('\n');
    entries.push(`  <url>
    <loc>${abs(page.locale, page.path)}</loc>
${alternates}
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>${page.path === '/' ? '1.0' : '0.7'}</priority>
  </url>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join('\n')}
</urlset>
`;
}

for (const page of pages) {
  const prefix = page.redirect || page.file.endsWith('404.html') || page.locale === DEFAULT_LOCALE
    ? ''
    : page.locale;
  // Depth is measured from the file's real location, locale folder included,
  // so /bg/portraits/index.html climbs two levels and not one.
  const relFile = prefix ? `${prefix}/${page.file}` : page.file;
  const target = path.join(OUT, relFile);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, resolveLinks(page.html, relFile));
}

await fs.mkdir(path.join(OUT, 'assets'), { recursive: true });
await fs.copyFile(path.join(ROOT, 'src', 'styles.css'), path.join(OUT, 'assets', 'styles.css'));
await fs.copyFile(path.join(ROOT, 'src', 'app.js'), path.join(OUT, 'assets', 'app.js'));
await fs.writeFile(path.join(OUT, 'assets', 'favicon.svg'), FAVICON);
// The admin page: unlisted, unlinked, and excluded from robots.txt and the
// sitemap. It holds no secrets — the password is checked by the worker.
const adminTemplate = await fs.readFile(path.join(ROOT, 'src', 'admin.html'), 'utf8');
const adminConfig = {
  api: (S.adminApi || '').replace(/\/$/, ''),
  categories: site.categories.map((c) => ({
    slug: c.slug,
    title: LOCALES[DEFAULT_LOCALE].categories[c.slug].title,
  })),
};
await fs.mkdir(path.join(OUT, 'admin'), { recursive: true });
await fs.writeFile(
  path.join(OUT, 'admin', 'index.html'),
  resolveLinks(
    adminTemplate
      .replaceAll('__BASE__', REL)
      .replace('__CONFIG__', JSON.stringify(adminConfig)),
    'admin/index.html',
  ),
);

await fs.writeFile(path.join(OUT, 'robots.txt'), ROBOTS);
await fs.writeFile(path.join(OUT, 'sitemap.xml'), sitemap());
// Tells GitHub Pages to serve the directory as-is rather than running Jekyll.
await fs.writeFile(path.join(OUT, '.nojekyll'), '');
// A CNAME is only written when a custom domain is configured.
if (S.customDomain) await fs.writeFile(path.join(OUT, 'CNAME'), `${S.customDomain}\n`);

console.log(`built ${pages.length} pages into ${path.relative(ROOT, OUT)}/`);
for (const locale of S.locales) {
  const n = pages.filter((p) => p.locale === locale && !p.redirect).length;
  console.log(`  ${locale}: ${n} pages`);
}
