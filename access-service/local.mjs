import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { invitationDigest, route } from './router.mjs';
import { unlockStatements } from './store.mjs';

function contains(parent, child) {
  const rest = relative(parent, child);
  return rest !== '..' && !rest.startsWith('..' + sep) && !isAbsolute(rest);
}

const previewOrigin = 'http://127.0.0.1:4173';
// A stable local-only row preserves the owner's count when changing the PIN.
const ownerRowId = '5c2e7d4a-5d66-4713-8d0c-f600088842bf';
const pinFormat = /^\d{4}$/;

export function createLocalAccessService(privateDir, { ownerPreview = false } = {}) {
  if (!privateDir || !isAbsolute(privateDir)) throw new Error('Specify an absolute private data directory.');
  const directory = realpathSync(privateDir);
  const site = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
  if (contains(site, directory)) throw new Error('Keep invitation data outside the website directory.');
  const config = join(directory, 'access-config.json');
  const database = join(directory, 'invitations.sqlite3');
  for (const file of [config, database]) {
    if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw new Error('Use regular private data files.');
  }
  const db = new DatabaseSync(database);
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(readFileSync(new URL('./migrations/0001_invitations.sql', import.meta.url), 'utf8'));
  const store = {
    first: (sql, params) => db.prepare(sql).get(...params),
    all: sql => db.prepare(sql).all(),
    run: (sql, params) => db.prepare(sql).run(...params),
    unlock(hash, receipt, now) {
      if (!receipt) return db.prepare('UPDATE invitations SET successes = successes + 1 WHERE code_hash = ? AND revoked = 0 RETURNING id').get(hash);
      db.exec('BEGIN IMMEDIATE');
      try {
        const [cleanup, increment, record] = unlockStatements(hash, receipt, now);
        db.prepare(cleanup[0]).run(...cleanup[1]);
        const row = db.prepare(increment[0]).get(...increment[1]);
        db.prepare(record[0]).run(...record[1]);
        db.exec('COMMIT');
        return row;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
  };
  function readSettings() {
    return JSON.parse(readFileSync(config, 'utf8').replace(/^\uFEFF/, ''));
  }
  const handler = request => {
    let settings;
    try { settings = readSettings(); } catch { settings = {}; }
    return route(request, settings, store);
  };
  if (ownerPreview) {
    store.acceptsLocalOwnerPin = (request, settings, code) =>
      settings.ALLOWED_ORIGINS === previewOrigin && request.url === previewOrigin + '/access/unlock' &&
      request.headers.get('Origin') === previewOrigin && pinFormat.test(code);
    handler.setOwnerPin = async pin => {
      const settings = readSettings();
      if (settings.ALLOWED_ORIGINS !== previewOrigin || !pinFormat.test(pin)) {
        throw new Error('Use four digits in the loopback preview only.');
      }
      const digest = await invitationDigest(settings.INVITE_HMAC_KEY, pin);
      db.prepare(`INSERT INTO invitations (id, label, code_hash) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET code_hash = excluded.code_hash, revoked = 0`)
        .run(ownerRowId, '站主 · 本机密码', digest);
    };
  }
  handler.close = () => db.close();
  return handler;
}
