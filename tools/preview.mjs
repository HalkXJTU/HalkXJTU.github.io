import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalAccessService } from '../access-service/local.mjs';
import { localAccessDir, privateReleaseDir } from './access-paths.mjs';

const root = new URL('../', import.meta.url);
const origin = 'http://127.0.0.1:4173';
const entries = new Set(['index.html', 'legacy.html', 'gate-ui.js', 'gate-ui.css',
  'vault.js', 'gate-sw.js', 'gate-config.json', 'robots.txt']);
const mime = { '.js': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8' };

async function initializeLocalService() {
  const { id } = JSON.parse(await readFile(new URL('gate-config.json', root), 'utf8'));
  if (!/^[0-9a-f]{24}$/.test(id)) throw new Error('Invalid release ID');
  const release = JSON.parse(await readFile(join(privateReleaseDir, id + '.json'), 'utf8'));
  if (release.id !== id || Buffer.from(release.key, 'base64').length !== 32) throw new Error('Invalid private release settings');
  await mkdir(localAccessDir, {recursive:true, mode:0o700});
  const rel = relative(await realpath(fileURLToPath(root)), await realpath(localAccessDir));
  if (rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep))) throw new Error('Keep invitations outside the release directory');
  const file = join(localAccessDir, 'access-config.json');
  let settings;
  try {
    settings = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    settings = {ADMIN_TOKEN: randomBytes(32).toString('base64url'), INVITE_HMAC_KEY: randomBytes(32).toString('base64url'), SITE_RELEASE: release, ALLOWED_ORIGINS: origin};
    await writeFile(file, JSON.stringify(settings), {flag:'wx', mode:0o600});
  }
  if (settings.ALLOWED_ORIGINS !== origin) throw new Error('Use a separate loopback-only invitation database for this preview');
  if (settings.SITE_RELEASE?.id !== id) {
    const tmp = join(localAccessDir, 'release-' + randomUUID() + '.tmp');
    await writeFile(tmp, JSON.stringify({...settings, SITE_RELEASE:release}), {flag:'wx', mode:0o600});
    await rename(tmp, file);
  }
  return createLocalAccessService(localAccessDir, { ownerPreview: true });
}

async function apiRequest(access, req, res, url) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 8192) { res.writeHead(413).end(); return; }
    chunks.push(chunk);
  }
  const body = length ? Buffer.concat(chunks) : undefined;
  const result = await access(new Request(url, { method: req.method, headers: req.headers, body }));
  res.writeHead(result.status, Object.fromEntries(result.headers));
  res.end(Buffer.from(await result.arrayBuffer()));
}

const access = await initializeLocalService();
if (process.argv[2] === '--set-owner-pin') {
  try {
    await access.setOwnerPin(readFileSync(0, 'utf8').trim());
    console.log('本机站主密码已设置。');
  } finally {
    access.close();
  }
  process.exit(0);
}
createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.headers.host !== new URL(origin).host) { response.writeHead(403).end(); return; }
  let url;
  try { url = new URL(request.url, origin); } catch { response.writeHead(400).end(); return; }
  if (url.origin !== origin) { response.writeHead(400).end(); return; }
  if (url.pathname.startsWith('/access/')) {
    try { await apiRequest(access, request, response, url); }
    catch { if (!response.headersSent) response.writeHead(503); response.end(); }
    return;
  }
  const path = url.pathname.slice(1) || 'index.html';
  if (!['GET', 'HEAD'].includes(request.method) ||
      (!entries.has(path) && !/^vault\/(?:manifest|[0-9a-f]{32})\.bin$/.test(path))) {
    response.writeHead(404).end(); return;
  }
  try {
    let bytes = await readFile(new URL(path, root));
    if (path === 'gate-config.json') {
      // Even a copy configured for the live Worker uses the separate local invitation database here.
      const { id, manifestIv } = JSON.parse(bytes);
      bytes = Buffer.from(JSON.stringify({ id, manifestIv }));
    }
    response.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream',
      'Content-Length': bytes.length });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch { response.writeHead(404).end(); }
}).listen(4173, '127.0.0.1');
