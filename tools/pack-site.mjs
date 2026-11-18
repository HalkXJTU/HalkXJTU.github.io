// Release-time tool. The generated site needs only a static web server.
import { createCipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateReleaseDir } from './access-paths.mjs';

const [sourceArg, outputArg] = process.argv.slice(2);
if (!sourceArg || !outputArg) {
  throw new Error('Supply the private source directory and a new public output directory.');
}

const source = resolve(sourceArg);
const output = resolve(outputArg);
const statsEndpoint = process.env.SITE_STATS_ENDPOINT?.trim();
if (statsEndpoint) {
  const endpoint = new URL(statsEndpoint);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.href !== endpoint.origin + '/access/visits') {
    throw new Error('SITE_STATS_ENDPOINT must be the HTTPS /access/visits URL.');
  }
}
const publicPages = new Set(['index.html', 'legacy.html']);
const entries = [...publicPages, 'styles.css', 'legacy.css', 'script.js', 'legacy.js',
  'translations.js', 'version-switch.css', 'version-switch.js'];
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.pdf': 'application/pdf'
};

async function collectAssets(directory) {
  for (const entry of await readdir(join(source, directory), { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await collectAssets(relative);
    else if (entry.isFile()) entries.push(relative);
  }
}

function seal(key, bytes) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
  return { iv: iv.toString('base64'), data };
}

// The runtime handles the session and locks both layouts. The existing locale
// switcher translates the footer control along with the rest of each page.
function prepare(relative, bytes) {
  if (publicPages.has(relative)) {
    const html = bytes.toString('utf8');
    if (!/<head>/.test(html) || !/<\/footer>/.test(html)) throw new Error(`Unexpected page structure in ${relative}`);
    return html.replace('<head>', '<head>\n<script src="vault.js"></script>')
      .replace('</footer>', '</footer>\n<button class="access-lock" type="button" data-lock-site data-i18n="access.lock">Lock this page</button>');
  }
  if (relative === 'translations.js') {
    return bytes.toString('utf8') + '\nZH["access.lock"] = "锁定主页";\nIT["access.lock"] = "Blocca la pagina";\n';
  }
  if (relative === 'version-switch.css') {
    return bytes.toString('utf8') + `\n.access-lock { display: inline-flex; align-items: center; min-height: 44px; margin: 4px 0; padding: 0 4px; border: 0; background: transparent; font: inherit; font-size: 13px; color: var(--accent, #315777); cursor: pointer; }\n.access-lock:hover, .access-lock:focus-visible { text-decoration: underline; }\n`;
  }
  return bytes;
}

await collectAssets('assets');
await mkdir(output, { recursive: false }); // An existing release is never overwritten.
await mkdir(join(output, 'vault'));
await mkdir(privateReleaseDir, {recursive: true, mode: 0o700});
const privateDir = await realpath(privateReleaseDir);
for (const publicOrSource of [fileURLToPath(new URL('../', import.meta.url)), source, output]) {
  const path = relative(await realpath(publicOrSource), privateDir);
  if (path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep))) {
    throw new Error('Keep SITE_RELEASE_DIR outside the publication and authoring directories.');
  }
}
const id = randomBytes(12).toString('hex');
const contentKey = randomBytes(32);
const manifest = Object.create(null);

for (const relative of entries) {
  const { data, iv } = seal(contentKey, prepare(relative, await readFile(join(source, relative))));
  const file = `vault/${randomBytes(16).toString('hex')}.bin`;
  await writeFile(join(output, file), data, { flag: 'wx' });
  manifest[relative] = { file, iv, type: mime[extname(relative).toLowerCase()] || 'application/octet-stream' };
}

const index = seal(contentKey, Buffer.from(JSON.stringify(manifest)));
await writeFile(join(output, 'vault', 'manifest.bin'), index.data);
await writeFile(join(privateDir, id + '.json'), JSON.stringify({ id, key: contentKey.toString('base64') }) + '\n', { flag: 'wx', mode: 0o600 });
await writeFile(join(output, 'gate-config.json'), JSON.stringify({
  id, manifestIv: index.iv, inviteGrants: 'invitation-grants.json', ...(statsEndpoint ? { statsEndpoint } : {})
}) + '\n');
console.log(`Encrypted ${entries.length} files in ${basename(output)}. Private release settings saved outside the site for ${id}.`);
