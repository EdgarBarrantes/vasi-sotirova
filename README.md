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
src/                styles.css, app.js, admin.html — copied into site/ at build time
scripts/            images.mjs, process-uploads.mjs, build.mjs, serve.mjs
originals/          the source photograph of every painting added since the move
uploads/            pending uploads waiting to be processed (usually empty)
worker/             Cloudflare worker backing the admin page
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
npm ci                   # sharp is the only dependency
npm run build            # render site/ from data/ — includes the admin page
npm run serve            # preview at http://localhost:4173
npm run process-uploads  # publish anything sitting in uploads/ (CI runs this)
```

To reorder or remove paintings, edit `data/site.json` and rebuild. Each image
is keyed by 12 characters derived from its filename; that key names its
derivatives in `site/assets/img/` and its descriptions in the locale files.

## Adding a painting

Through **`/admin/`** — an unlisted page. She signs in with the password, picks
a collection, drags in a photograph, writes the two descriptions, and publishes.

What happens next:

1. The worker commits the original plus a JSON sidecar into `uploads/`, as a
   single commit.
2. That push runs the workflow, which calls `process-uploads`. It derives the
   AVIF ladder, the WebP fallback and the blur-up placeholder with `sharp`,
   reads the real dimensions (after applying EXIF rotation — phone photos are
   routinely stored sideways), records the painting in `data/site.json` and its
   descriptions in each `data/i18n/<locale>.json`, and moves the original into
   `originals/`.
3. The same run commits that back, rebuilds and deploys. Live in a couple of
   minutes.

Anything it can't publish — an unknown collection, a corrupt image — is moved
to `uploads/rejected/` rather than retried on every future build.

The admin page carries no credentials: it is a form that talks to the worker,
which holds the password and the GitHub token. Setup is in
[`worker/README.md`](worker/README.md); set `site.adminApi` in `data/site.json`
to the deployed worker URL. It is `noindex`, disallowed in `robots.txt`, absent
from the sitemap, and linked from nowhere on the public site.

Adding by hand still works: drop an image and a sidecar into `uploads/` and run
`npm run process-uploads`.

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
