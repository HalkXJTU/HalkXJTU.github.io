const encoder = new TextEncoder();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const inviteFormat = /^INV-[A-Za-z0-9_-]{22}$/;

function respond(status, content, headers) {
  return new Response(content === null ? null : JSON.stringify(content), { status, headers });
}

function base64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

export function invitationDigest(secret, code) {
  return hmac(secret, 'invite:' + code);
}

async function adminAuthorized(candidate, token) {
  if (!candidate?.startsWith('Bearer ') || candidate.length > 1024) return false;
  // Verify the supplied value using fixed-length digests, including length mismatches.
  const key = await crypto.subtle.importKey('raw', encoder.encode(token),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const expected = await crypto.subtle.sign('HMAC', key, encoder.encode(token));
  return crypto.subtle.verify('HMAC', key, expected, encoder.encode(candidate.slice(7)));
}

function matchesOrigin(origin, allowed) {
  if (origin === null) return true; // CLI and owner dashboard proxy requests.
  if (!String(allowed || '').split(',').some(item => item.trim() === origin)) return false;
  try {
    const url = new URL(origin);
    return url.origin === origin && (url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)));
  } catch { return false; }
}

async function readJSON(request) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '', total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 4096) { await reader.cancel(); return null; }
      text += decoder.decode(value, { stream: true });
    }
    const body = JSON.parse(text + decoder.decode());
    return body && !Array.isArray(body) && typeof body === 'object' ? body : null;
  } catch { return null; }
  finally { reader.releaseLock(); }
}

function releaseSecret(value) {
  const release = typeof value === 'string' ? JSON.parse(value) : value;
  if (!release || !/^[a-zA-Z0-9_-]{1,128}$/.test(release.id) ||
      typeof release.key !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(release.key)) throw new Error('Configuration');
  return release;
}

export async function route(request, settings, store) {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin' });
  const send = (status, body) => respond(status, body, headers);
  try {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    if (!matchesOrigin(origin, settings.ALLOWED_ORIGINS)) return send(403, { error: 'forbidden' });
    if (origin) headers.set('Access-Control-Allow-Origin', origin);
    const listPath = url.pathname === '/access/admin/invites';
    const revoke = /^\/access\/admin\/invites\/([^/]+)\/revoke$/.exec(url.pathname);
    const unlock = url.pathname === '/access/unlock';
    if (url.search || (!listPath && !unlock && !(revoke && uuid.test(revoke[1])))) return send(404, { error: 'not_found' });
    const allowedMethods = listPath ? 'GET, POST, OPTIONS' : 'POST, OPTIONS';
    if (request.method === 'OPTIONS') {
      headers.set('Access-Control-Allow-Methods', allowedMethods);
      headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      return send(204, null);
    }
    if (request.method !== 'POST' && !(listPath && request.method === 'GET')) {
      headers.set('Allow', allowedMethods);
      return send(405, { error: 'method' });
    }
    if (typeof settings.INVITE_HMAC_KEY !== 'string' || settings.INVITE_HMAC_KEY.length < 32 ||
        typeof settings.ADMIN_TOKEN !== 'string' || settings.ADMIN_TOKEN.length < 32 ||
        settings.INVITE_HMAC_KEY === settings.ADMIN_TOKEN) return send(503, { error: 'unavailable' });
    if (unlock) {
      const release = releaseSecret(settings.SITE_RELEASE);
      const body = await readJSON(request);
      if (!body || typeof body.release !== 'string' || typeof body.code !== 'string' ||
          (body.visit !== undefined && (typeof body.visit !== 'string' || !uuid.test(body.visit)))) return send(400, { error: 'invalid_request' });
      if (body.release !== release.id) return send(409, { error: 'release_changed' });
      const code = body.code.trim();
      if (!inviteFormat.test(code) && !store.acceptsLocalOwnerPin?.(request, settings, code)) {
        return send(403, { error: 'invalid_invitation' });
      }
      const hash = await invitationDigest(settings.INVITE_HMAC_KEY, code);
      const receipt = body.visit && await hmac(settings.INVITE_HMAC_KEY, [release.id, code, body.visit].join(':'));
      if (!await store.unlock(hash, receipt, Math.floor(Date.now() / 1000))) {
        return send(403, { error: 'invalid_invitation' });
      }
      return send(200, { id: release.id, key: release.key });
    }
    if (!await adminAuthorized(request.headers.get('Authorization'), settings.ADMIN_TOKEN)) return send(403, { error: 'forbidden' });
    if (revoke) {
      const row = await store.first('UPDATE invitations SET revoked = 1 WHERE id = ? RETURNING id', [revoke[1]]);
      return row ? send(200, { id: row.id, revoked: true }) : send(404, { error: 'not_found' });
    }
    if (request.method === 'GET') {
      const rows = await store.all('SELECT id, label, successes, revoked FROM invitations ORDER BY successes DESC, rowid DESC');
      return send(200, { invites: rows.map(row => ({ ...row, revoked: Boolean(row.revoked) })) });
    }
    const body = await readJSON(request);
    const label = typeof body?.label === 'string' ? body.label.trim() : '';
    if (!label || [...label].length > 120 || /[\u0000-\u001f\u007f]/u.test(label)) return send(400, { error: 'invalid_label' });
    const code = 'INV-' + base64(crypto.getRandomValues(new Uint8Array(16)))
      .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    const id = crypto.randomUUID();
    await store.run('INSERT INTO invitations (id, label, code_hash) VALUES (?, ?, ?)',
      [id, label, await invitationDigest(settings.INVITE_HMAC_KEY, code)]);
    return send(201, { id, label, code });
  } catch { return send(503, { error: 'unavailable' }); }
}
