# Upload worker

Backs the `/admin/` page. It checks the password, then commits an uploaded
painting into this repository. Nothing else in the stack holds a credential —
the site is static and the admin page ships no secrets.

## One-time setup

```sh
cd worker
npm install -g wrangler     # if you don't have it
wrangler login
```

Set the three secrets. They are stored by Cloudflare and never written to git:

```sh
wrangler secret put ADMIN_PASSWORD   # what she types to sign in
wrangler secret put SESSION_SECRET   # any long random string, e.g. openssl rand -hex 32
wrangler secret put GITHUB_TOKEN     # see below
```

The GitHub token should be a **fine-grained personal access token**, scoped to
this repository only, with a single permission: **Contents → Read and write**.
Give it an expiry you're willing to renew; nothing else needs it.

Deploy:

```sh
wrangler deploy
```

Wrangler prints the worker URL. Put it in `data/site.json` as `site.adminApi`,
then rebuild and push — that's what tells the admin page where to send uploads.

## How it fits together

```
/admin/  ──POST /login───►  worker ──checks ADMIN_PASSWORD──► signed token (2h)
         ──POST /upload──►  worker ──GitHub API──► one commit into uploads/
                                                        │
                        .github/workflows/pages.yml ◄───┘
                        processes the upload, rebuilds, deploys
```

The upload is written as a **single commit** containing both the image and its
JSON sidecar. That matters: a commit carrying only one of the two would start a
build that couldn't finish the job.

## Worth doing

Add a Cloudflare **Rate limiting rule** on `/login` (something like 10 requests
per minute per IP). The worker delays a second on a wrong password, which slows
guessing down but is not a substitute for rate limiting at the edge.

When the custom domain goes live, update `ALLOWED_ORIGIN` in `wrangler.toml`
to `https://www.vasisotirova.com` and redeploy, or the browser will refuse the
requests.

## Rotating the password

```sh
wrangler secret put ADMIN_PASSWORD
```

Takes effect immediately. Sessions already issued stay valid for up to two
hours; rotate `SESSION_SECRET` too if you need to cut them off at once.
