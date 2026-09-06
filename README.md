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

## Notes

- `data/site.json` → `contact.formEndpoint` is empty, so the contact form falls
  back to opening the visitor's mail client. Set it to a form handler
  (Formspree, Netlify Forms, or your own) to submit in the background instead.
- `/bio-1/` redirects to `/bio/`; the other page URLs match the old site.
- The Current Exhibition gallery was empty when the content was captured, so
  that page renders an empty state until images are added to `data/site.json`.
