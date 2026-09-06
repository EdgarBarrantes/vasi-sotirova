# vasisotirova.com

Static rebuild of the painter Vasilka Sotirova's portfolio site, moved off Wix.
No framework, no runtime dependencies — `site/` is plain HTML that any static
host will serve.

## Layout

```
data/site.json      structure: nav, categories, image lists (media, size)
data/i18n/en.json   every English string, including per-image alt text
data/i18n/bg.json   the same keys in Bulgarian
data/lqip.json      tiny inline blur-up previews (generated)
src/                styles.css, app.js — copied into site/assets at build time
scripts/            fetch-assets.mjs, build.mjs, serve.mjs
site/               build output; this is the deployable root
```

Nothing translatable lives in `site.json` — it holds only structure, so adding
a painting is a one-line change there plus an `alt` entry in each locale file.

## Languages

English is the default and sits at the root; Bulgarian lives under `/bg/`:
`/gallery/` and `/bg/gallery/`. That keeps the English URLs inherited from the
old site intact.

Each page declares `hreflang` alternates for both languages plus `x-default`,
and the sitemap pairs every URL with its translation, so the two are understood
as one page in two languages rather than duplicates. The header switcher links
to the *same* page in the other language, not to its home page.

Adding a language means adding `data/i18n/<code>.json`, listing the code in
`site.locales`, and rebuilding — the build derives its routes from that list.

Note the per-locale display font: Dancing Script (which the old site used) has
no Cyrillic, so the Bulgarian pages set Caveat instead via `displayFont` in the
locale file. Montserrat covers both alphabets and is shared.

## Working on it

```sh
npm run assets   # download images from the CDN into site/assets/img (skips existing)
npm run build    # render site/ from data/site.json
npm run serve    # preview at http://localhost:4173
```

To add or reorder paintings, edit `data/site.json` and rebuild. Images are keyed
by their Wix media id; `npm run assets` fetches an AVIF ladder (480/960/1600), a
960px WebP fallback and a 24px placeholder for each one.

## Deployment

Pushing to `main` runs `.github/workflows/pages.yml`, which builds `site/` and
publishes it to GitHub Pages. Enable it once, under **Settings → Pages →
Build and deployment → Source: GitHub Actions**.

The site currently builds for the project URL,
`https://edgarbarrantes.github.io/vasi-sotirova/`. That subdirectory comes from
`site.basePath` in `data/site.json`; every internal link and asset URL is
written through it, so nothing is hard-coded to one host.

### Switching to www.vasisotirova.com

1. In `data/site.json`, set:
   ```json
   "baseUrl": "https://www.vasisotirova.com",
   "basePath": "",
   "customDomain": "www.vasisotirova.com"
   ```
   `customDomain` makes the build emit a `CNAME` file, which is what tells
   Pages to answer on that hostname.
2. Point DNS at GitHub: a `CNAME` record for `www` → `edgarbarrantes.github.io`
   (and, for the apex, `A` records to GitHub's Pages IPs).
3. Push. Once DNS resolves, tick **Enforce HTTPS** in Settings → Pages.

Do step 2 before step 3 if you want to avoid a window where the old URL has
stopped working and the new one has not started.

## Search visibility

Copy, page titles and descriptions are written around the terms the work
should be found under — Bulgarian artist, Bulgarian painter, portrait and pet
portrait commissions, and the specific subjects of each collection. Alongside
that, each page carries JSON-LD: a `Person` record tying the name to her
nationality, birthplace, training and social profiles, `BreadcrumbList` on the
inner pages, and a `VisualArtwork` entry per painting.

**Indexing is deliberately off while there is no custom domain.** With
`site.customDomain` empty, every page renders `noindex` and `robots.txt`
disallows crawling, so this build cannot compete with the live site for the
same content. Setting `customDomain` (see above) flips both to `index, follow`
automatically — nothing else to remember.

Once it is live on the real domain, the things that move the needle are outside
this repo: verify the domain in Google Search Console and submit
`sitemap.xml`, and get the site linked from her Facebook and Instagram
profiles, gallery and exhibition listings, and any press.

## Notes

- `/bio-1/` redirects to `/bio/`; the other page URLs match the old site.
- The Current Exhibition gallery was empty when the content was captured, so
  that page renders an empty state until images are added to `data/site.json`.
