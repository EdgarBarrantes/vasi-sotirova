/**
 * Upload service for the gallery admin page.
 *
 * Two endpoints:
 *   POST /login   { password }        -> { token, expiresAt }
 *   POST /upload  Bearer <token>      -> commits one painting to the repo
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

const corsHeaders = (env) => ({
  'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
});

const json = (body, status, env) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
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
  const { password } = await request.json().catch(() => ({}));
  if (typeof password !== 'string' || !password) {
    return json({ error: 'Enter the password.' }, 400, env);
  }
  if (!await safeEqual(password, env.ADMIN_PASSWORD || '')) {
    // Slow down guessing a little. Real rate limiting belongs in front of the
    // worker — see worker/README.md.
    await sleep(1000);
    return json({ error: 'That password is not right.' }, 401, env);
  }
  return json(await issueToken(env.SESSION_SECRET), 200, env);
}

async function handleUpload(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!await verifyToken(env.SESSION_SECRET, token)) {
    return json({ error: 'Session expired.' }, 401, env);
  }

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'Malformed request.' }, 400, env);

  const extension = ALLOWED_TYPES[body.contentType];
  if (!extension) return json({ error: 'Use a JPEG, PNG or WebP image.' }, 400, env);

  if (typeof body.data !== 'string' || !body.data) {
    return json({ error: 'No image data received.' }, 400, env);
  }
  // base64 encodes 3 bytes as 4 characters.
  if (Math.floor(body.data.length * 0.75) > MAX_IMAGE_BYTES) {
    return json({ error: 'That image is over 12 MB.' }, 413, env);
  }

  const category = String(body.category || '');
  if (!/^[a-z0-9-]{1,60}$/.test(category)) {
    return json({ error: 'Choose a collection.' }, 400, env);
  }

  const alt = body.alt && typeof body.alt === 'object' ? body.alt : {};
  const descriptions = {};
  for (const [code, text] of Object.entries(alt)) {
    if (/^[a-z]{2}$/.test(code) && typeof text === 'string') {
      descriptions[code] = text.trim().slice(0, 300);
    }
  }
  if (!descriptions.en) {
    return json({ error: 'An English description is required.' }, 400, env);
  }

  const key = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const file = `${key}.${extension}`;
  const sidecar = {
    key,
    file,
    category,
    position: body.position === 'end' ? 'end' : 'start',
    alt: descriptions,
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

  return json({ ok: true, key, commit: sha }, 200, env);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }
    if (request.method !== 'POST') {
      return json({ error: 'Not found.' }, 404, env);
    }

    try {
      if (url.pathname === '/login') return await handleLogin(request, env);
      if (url.pathname === '/upload') return await handleUpload(request, env);
      return json({ error: 'Not found.' }, 404, env);
    } catch (err) {
      // Never surface the GitHub response verbatim — it can echo the token.
      console.error(err);
      return json({ error: 'Something went wrong publishing that. Try again.' }, 500, env);
    }
  },
};
