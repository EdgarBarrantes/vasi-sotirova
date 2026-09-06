# vasisotirova.com

Static rebuild of the painter Vasilka Sotirova's portfolio site, moved off Wix.
No framework, no runtime dependencies — `site/` is plain HTML that any static
host will serve.

## Layout

```
data/site.json     all content: nav, categories, image lists, bio, contact
data/lqip.json     tiny inline blur-up previews (generated)
src/               styles.css, app.js — copied into site/assets at build time
scripts/           fetch-assets.mjs, build.mjs, serve.mjs
site/              build output; this is the deployable root
```

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

## Notes

- `data/site.json` → `contact.formEndpoint` is empty, so the contact form falls
  back to opening the visitor's mail client. Set it to a form handler
  (Formspree, Netlify Forms, or your own) to submit in the background instead.
- `/bio-1/` redirects to `/bio/`; the other page URLs match the old site.
- The Current Exhibition gallery was empty when the content was captured, so
  that page renders an empty state until images are added to `data/site.json`.
