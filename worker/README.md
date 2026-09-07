# Upload worker

Backs the `/admin/` page. It checks the password, then commits an uploaded
painting into this repository. Nothing else in the stack holds a credential —
the site is static and the admin page ships no secrets.

## Setup from a phone (no terminal)

Everything below is a browser form. The **Deploy upload worker** workflow does
the rest — it deploys the worker, sets its secrets, and writes the resulting
URL into `data/site.json` so the admin page is wired up automatically.

**1. Cloudflare — register a workers.dev subdomain.**
*Workers & Pages* → if it offers to pick a subdomain, do it (any name; it
becomes `<worker>.<yourname>.workers.dev`). A brand-new account has none, and
without one a deploy fails with *"You need to register a workers.dev
subdomain"* — there is nowhere to publish to. One-off.

**2. Cloudflare — get an API token and your account ID.**
In the Cloudflare dashboard: *Manage Account → Account API Tokens → Create
Token*, and use the **Edit Cloudflare Workers** template. Copy the token; it is
shown once. Your account ID is on the Workers overview page (also the hex
string in the dashboard URL).

**3. GitHub — a fine-grained personal access token.**
*Settings → Developer settings → Personal access tokens → Fine-grained*. Scope
it to this repository only, and give it exactly one permission:
**Repository permissions → Contents → Read and write**. This is what lets the
worker commit an upload.

**4. GitHub — add four repository secrets.**
In this repo: *Settings → Secrets and variables → Actions → New repository
secret*.

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | from step 2 |
| `CLOUDFLARE_ACCOUNT_ID` | from step 2 |
| `GH_UPLOAD_TOKEN` | from step 3 |
| `ADMIN_PASSWORD` | what she will type to sign in — choose a strong one |

`GH_UPLOAD_TOKEN` is named that way because GitHub reserves the `GITHUB_`
prefix for its own secrets; the workflow stores it in the worker as
`GITHUB_TOKEN`.

**5. Run it.** *Actions → Deploy upload worker → Run workflow*.

When it finishes the admin page is live and working. There is no
`SESSION_SECRET` to invent — it is derived from the password unless you set one,
so changing the password also signs out any open session.

## Setup from a laptop

```sh
cd worker
npm install
npx wrangler login
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put GITHUB_TOKEN     # the fine-grained token from step 3
npx wrangler deploy
```

Then set `site.adminApi` in `data/site.json` to the URL wrangler prints, and
push.

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

Update the `ADMIN_PASSWORD` repository secret and re-run **Deploy upload
worker** (or `npx wrangler secret put ADMIN_PASSWORD` from a laptop). It takes
effect immediately, and because the session key is derived from the password,
any session already open is signed out at the same time.
