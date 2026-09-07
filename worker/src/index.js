/**
 * Upload service for the gallery admin page.
 *
 * Three endpoints:
 *   POST /login       { password }                -> { token, expiresAt }
 *   POST /upload      Bearer <token>              -> commits one painting
 *   POST /visibility  Bearer <token> { key, hidden } -> publishes or unpublishes one
 *
 * The GitHub credential and the admin password live here as Worker secrets and
 * never reach the browser. A successful login returns a short-lived signed
 * token, so the password is sent once rather than with every upload.
 *
 * An upload writes two files in a single commit — the original image and a
 * JSON sidecar describing it — into uploads/. The repository's own workflow
 * picks the pair up, derives the responsive image set, records the painting,
 * and rebuilds the site. Committing both files together matters: a commit
 * carrying only one of them would start a build that cannot finish the job.
 */

const SESSION_TTL_SECONDS = 2 * 60 * 60;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/* --------------------------------------------------------------- helpers */

const encoder = new TextEncoder();

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return crypto.subtle.sign('HMAC', key, encoder.encode(message));
}

/**
 * Compares two strings without leaking, through timing, how much of a guess
 * was right — digest both and compare the fixed-length results bit by bit.
 */
async function safeEqual(a, b) {
  const [da, db] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  const x = new Uint8Array(da);
  const y = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i];
  return diff === 0;
}

/**
 * Key used to sign session tokens. Deriving it from the password by default
 * means there is one less secret to set up — and changing the password then
 * also invalidates any session already issued, which is the behaviour you
 * want anyway. Set SESSION_SECRET to decouple the two.
 */
async function sessionKey(env) {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  return b64url(await hmac(env.ADMIN_PASSWORD || '', 'vasisotirova-session-v1'));
}

async function issueToken(secret) {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = b64url(encoder.encode(JSON.stringify({ exp: expiresAt })));
  const signature = b64url(await hmac(secret, payload));
  return { token: `${payload}.${signature}`, expiresAt };
}

async function verifyToken(secret, token) {
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, signature] = token.split('.');
  const expected = b64url(await hmac(secret, payload));
  if (!await safeEqual(signature, expected)) return false;
  try {
    const { exp } = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof exp === 'number' && exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

/**
 * ALLOWED_ORIGIN is a comma-separated allowlist, so the site can be reachable
 * at more than one address at once — during a domain move, for instance. The
 * matching origin is echoed back rather than the whole list, which is what the
 * CORS spec requires; Vary: Origin keeps caches honest.
 */
const corsHeaders = (env, request) => {
  const allowed = String(env.ALLOWED_ORIGIN || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const origin = request ? request.headers.get('Origin') : null;
  return {
    'Access-Control-Allow-Origin':
      origin && allowed.includes(origin) ? origin : (allowed[0] || '*'),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
};

const json = (body, status, env, request) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', ...corsHeaders(env, request) },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ----------------------------------------------------------- github calls */

async function gh(env, endpoint, init = {}) {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}${endpoint}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'vasisotirova-admin',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`GitHub ${endpoint} failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  return res.json();
}

/** Reads a text file from the repository, with the sha needed to replace it. */
async function readFile(env, filePath) {
  const branch = env.GITHUB_BRANCH || 'main';
  const meta = await gh(env, `/contents/${filePath}?ref=${branch}`);
  const bytes = Uint8Array.from(atob(meta.content.replace(/\n/g, '')), (c) => c.charCodeAt(0));
  return { text: new TextDecoder().decode(bytes), sha: meta.sha };
}

/** Writes several files as one commit on top of the current branch head. */
async function commitFiles(env, files, message) {
  const branch = env.GITHUB_BRANCH || 'main';
  const ref = await gh(env, `/git/ref/heads/${branch}`);
  const baseSha = ref.object.sha;
  const baseCommit = await gh(env, `/git/commits/${baseSha}`);

  const blobs = [];
  for (const file of files) {
    const blob = await gh(env, '/git/blobs', {
      method: 'POST',
      body: JSON.stringify({ content: file.content, encoding: file.encoding }),
    });
    blobs.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  const tree = await gh(env, '/git/trees', {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: blobs }),
  });

  const commit = await gh(env, '/git/commits', {
    method: 'POST',
    body: JSON.stringify({ message, tree: tree.sha, parents: [baseSha] }),
  });

  await gh(env, `/git/refs/heads/${branch}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha }),
  });

  return commit.sha;
}

/* -------------------------------------------------------------- handlers */

async function handleLogin(request, env) {
  // Cap attempts per caller before doing any work. The binding is configured
  // in wrangler.toml; if an older deployment lacks it, fall through rather
  // than lock everyone out.
  if (env.LOGIN_LIMITER) {
    const who = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { success } = await env.LOGIN_LIMITER.limit({ key: `login:${who}` });
    if (!success) {
      return json({ error: 'Too many attempts. Wait a minute and try again.' }, 429, env, request);
    }
  }

  const { password } = await request.json().catch(() => ({}));
  if (typeof password !== 'string' || !password) {
    return json({ error: 'Enter the password.' }, 400, env, request);
  }
  if (!await safeEqual(password, env.ADMIN_PASSWORD || '')) {
    // Adds cost to each individual guess on top of the per-minute cap.
    await sleep(1000);
    return json({ error: 'That password is not right.' }, 401, env, request);
  }
  return json(await issueToken(await sessionKey(env)), 200, env, request);
}

async function handleUpload(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!await verifyToken(await sessionKey(env), token)) {
    return json({ error: 'Session expired.' }, 401, env, request);
  }

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'Malformed request.' }, 400, env, request);

  const extension = ALLOWED_TYPES[body.contentType];
  if (!extension) return json({ error: 'Use a JPEG, PNG or WebP image.' }, 400, env, request);

  if (typeof body.data !== 'string' || !body.data) {
    return json({ error: 'No image data received.' }, 400, env, request);
  }
  // base64 encodes 3 bytes as 4 characters.
  if (Math.floor(body.data.length * 0.75) > MAX_IMAGE_BYTES) {
    return json({ error: 'That image is over 12 MB.' }, 413, env, request);
  }

  const category = String(body.category || '');
  if (!/^[a-z0-9-]{1,60}$/.test(category)) {
    return json({ error: 'Choose a collection.' }, 400, env, request);
  }

  const alt = body.alt && typeof body.alt === 'object' ? body.alt : {};
  const descriptions = {};
  for (const [code, text] of Object.entries(alt)) {
    if (/^[a-z]{2}$/.test(code) && typeof text === 'string') {
      descriptions[code] = text.trim().slice(0, 300);
    }
  }
  if (!descriptions.en) {
    return json({ error: 'An English description is required.' }, 400, env, request);
  }

  // Optional per-locale text, same shape as the descriptions.
  const perLocale = (source, limit) => {
    const out = {};
    if (source && typeof source === 'object') {
      for (const [code, text] of Object.entries(source)) {
        if (/^[a-z]{2}$/.test(code) && typeof text === 'string' && text.trim()) {
          out[code] = text.trim().slice(0, limit);
        }
      }
    }
    return out;
  };

  const key = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const file = `${key}.${extension}`;
  const sidecar = {
    key,
    file,
    category,
    position: body.position === 'end' ? 'end' : 'start',
    alt: descriptions,
    title: perLocale(body.title, 120),
    note: perLocale(body.note, 600),
    technique: /^[a-z]{1,20}$/.test(String(body.technique || '')) ? String(body.technique) : '',
    size: String(body.size || '').trim().slice(0, 60),
    originalName: String(body.filename || '').slice(0, 120),
    uploadedAt: new Date().toISOString(),
  };

  const sha = await commitFiles(env, [
    { path: `uploads/${file}`, content: body.data, encoding: 'base64' },
    {
      path: `uploads/${key}.json`,
      content: `${JSON.stringify(sidecar, null, 2)}\n`,
      encoding: 'utf-8',
    },
  ], `Add a painting to ${category}\n\nUploaded through the admin page.`);

  return json({ ok: true, key, commit: sha }, 200, env, request);
}

/**
 * Publishes or unpublishes a painting by flipping its `hidden` flag in
 * data/site.json. Nothing is deleted — the image, its record and its
 * descriptions all stay put, so the change is reversible.
 */
async function handleVisibility(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!await verifyToken(await sessionKey(env), token)) {
    return json({ error: 'Session expired.' }, 401, env, request);
  }

  const body = await request.json().catch(() => null);
  if (!body || !/^[a-z0-9]{6,32}$/.test(String(body.key || ''))) {
    return json({ error: 'Which painting?' }, 400, env, request);
  }
  const hide = body.hidden === true;

  const { text } = await readFile(env, 'data/site.json');
  const site = JSON.parse(text);

  let found = null;
  for (const category of site.categories || []) {
    for (const image of category.images || []) {
      const m = /^[a-f0-9]+_([a-f0-9]{12})/.exec(image.media);
      const imageKey = m ? m[1] : image.media.replace(/[^a-z0-9]/gi, '').slice(0, 12).toLowerCase();
      if (imageKey !== body.key) continue;
      if (hide) image.hidden = true;
      else delete image.hidden;
      found = { category: category.slug, image };
      break;
    }
    if (found) break;
  }

  if (!found) return json({ error: 'No painting with that id.' }, 404, env, request);

  await commitFiles(env, [{
    path: 'data/site.json',
    content: `${JSON.stringify(site, null, 2)}\n`,
    encoding: 'utf-8',
  }], `${hide ? 'Hide' : 'Show'} a painting in ${found.category}\n\nChanged through the admin page.`);

  return json({ ok: true, key: body.key, hidden: hide }, 200, env, request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }
    if (request.method !== 'POST') {
      return json({ error: 'Not found.' }, 404, env, request);
    }

    try {
      if (url.pathname === '/login') return await handleLogin(request, env);
      if (url.pathname === '/upload') return await handleUpload(request, env);
      if (url.pathname === '/visibility') return await handleVisibility(request, env);
      return json({ error: 'Not found.' }, 404, env, request);
    } catch (err) {
      // Never surface the GitHub response verbatim — it can echo the token.
      console.error(err);
      return json({ error: 'Something went wrong publishing that. Try again.' }, 500, env, request);
    }
  },
};
