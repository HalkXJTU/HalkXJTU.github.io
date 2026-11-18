import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { formatNamedInvite, makeNamedGrant, normalizeInviteName } from '../named-invites.mjs';

const hash = text => createHash('sha256').update(text, 'utf8').digest();
const inviteId = code => hash('id:v1:' + code).subarray(0, 16).toString('hex');
const poolSize = 64;

export class PoolError extends Error {}
export function openPool(directory) {
  const filename = join(directory, 'offline-invitations.sqlite3');
  if (existsSync(filename) && !lstatSync(filename).isFile()) throw new PoolError('请使用私有目录中的常规数据库文件。');
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA busy_timeout=10000;
    CREATE TABLE IF NOT EXISTS codes (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, label TEXT, revoked INTEGER NOT NULL DEFAULT 0);
    CREATE UNIQUE INDEX IF NOT EXISTS active_label ON codes(label) WHERE revoked=0;
    CREATE TABLE IF NOT EXISTS releases (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS wraps (id TEXT NOT NULL, release TEXT NOT NULL, iv TEXT NOT NULL, wrapped TEXT NOT NULL, PRIMARY KEY(id,release));
    CREATE TABLE IF NOT EXISTS invite_names (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS named_wraps (id TEXT NOT NULL, release TEXT NOT NULL, lookup TEXT NOT NULL, iv TEXT NOT NULL, wrapped TEXT NOT NULL,
      PRIMARY KEY(id,release), UNIQUE(release,lookup));`);
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function ready() {
    if (!db.prepare('SELECT 1 FROM codes LIMIT 1').get()) throw new PoolError('请先用 init 创建私有邀请池，再导出并发布授权文件。');
  }
  return {
    close: () => db.close(),
    init() {
      return transaction(() => {
        const total = db.prepare('SELECT COUNT(*) AS total FROM codes').get().total;
        if (total) return { total, created: false };
        const insert = db.prepare('INSERT INTO codes(id,code) VALUES(?,?)');
        for (let i = 0; i < poolSize; i++) {
          const code = 'INV-' + randomBytes(16).toString('base64url');
          insert.run(inviteId(code), code);
        }
        return { total: poolSize, created: true };
      });
    },
    async issue(value, englishName) {
      const label = typeof value === 'string' ? value.trim() : '';
      if (!label || [...label].length > 120 || /[\u0000-\u001f\u007f]/u.test(label)) throw new PoolError('请填写有效的收件人备注（1 至 120 个字符）。');
      let name;
      if (englishName !== undefined && englishName !== '') {
        try { name = normalizeInviteName(englishName); }
        catch (error) { throw new PoolError(error.message); }
      }
      const row = transaction(() => {
        ready();
        let invite = db.prepare(`SELECT c.id,c.code,c.label,n.name FROM codes c LEFT JOIN invite_names n ON n.id=c.id
          WHERE c.label=? AND c.revoked=0`).get(label);
        if (!invite) {
          if (!name) throw new PoolError('请填写这位新收件人的英文姓名。');
          invite = db.prepare(`UPDATE codes SET label=? WHERE id=(SELECT id FROM codes
            WHERE label IS NULL AND revoked=0 ORDER BY rowid LIMIT 1) RETURNING id,code,label`).get(label);
          if (!invite) throw new PoolError('当前邀请池已全部分配。');
        }
        if (name && invite.name && name !== invite.name) throw new PoolError('此备注已绑定其他英文姓名。留空可取回已有邀请码。');
        if (name && !invite.name) {
          db.prepare('INSERT INTO invite_names(id,name) VALUES(?,?)').run(invite.id, name);
          invite.name = name;
        }
        return invite;
      });
      return { id: row.id, label: row.label, code: row.name ? await formatNamedInvite(row.code, row.name) : row.code };
    },
    assignments() {
      return db.prepare('SELECT id,label,revoked FROM codes WHERE label IS NOT NULL ORDER BY rowid DESC').all()
        .map(row => ({ ...row, revoked: Boolean(row.revoked) }));
    },
    revoke(id) {
      const row = db.prepare('UPDATE codes SET revoked=1 WHERE id=? AND label IS NOT NULL RETURNING id').get(id);
      if (!row) throw new PoolError('未找到这份已分配的邀请。');
      return { id: row.id, revoked: true, requiresPublish: true };
    },
    receipts() {
      ready();
      return db.prepare('SELECT id,code FROM codes ORDER BY rowid').all().map(({ id, code }) => ({
        id, digest: hash(hash('count:v1:' + code).toString('base64url')).toString('base64url')
      }));
    },
    async exportGrants(gateFile, releaseDir, outputFile) {
      const releaseId = JSON.parse(readFileSync(gateFile, 'utf8')).id;
      if (!/^[0-9a-f]{24}$/.test(releaseId)) throw new PoolError('发布编号无效。');
      const release = JSON.parse(readFileSync(join(releaseDir, releaseId + '.json'), 'utf8'));
      if (release.id !== releaseId || typeof release.key !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(release.key)) throw new PoolError('私有密钥与本次发布不匹配。');
      const secret = Buffer.from(release.key, 'base64');
      ready();
      // The KDF can take seconds for a fresh release. Keep it outside the SQLite write transaction.
      const missing = db.prepare(`SELECT c.id,c.code FROM codes c LEFT JOIN named_wraps w ON w.id=c.id AND w.release=?
        WHERE c.revoked=0 AND w.id IS NULL ORDER BY c.id`).all(releaseId);
      const pending = await Promise.all(missing.map(async row => ({
        legacyId: row.id, grant: await makeNamedGrant(row.code, releaseId)
      })));
      return transaction(() => {
        const fingerprint = createHash('sha256').update(secret).digest('hex');
        db.prepare('INSERT OR IGNORE INTO releases VALUES(?,?)').run(releaseId, fingerprint);
        if (db.prepare('SELECT fingerprint FROM releases WHERE id=?').get(releaseId).fingerprint !== fingerprint) throw new PoolError('同一发布编号的私有密钥发生了变化。');
        const grants = {};
        const saveNamed = db.prepare(`INSERT INTO named_wraps(id,release,lookup,iv,wrapped) VALUES(?,?,?,?,?)
          ON CONFLICT(id,release) DO NOTHING`);
        for (const { legacyId, grant } of pending) saveNamed.run(legacyId, releaseId, grant.id, grant.iv, grant.wrapped);
        const namedGrants = {};
        for (const { lookup, iv, wrapped } of db.prepare(`SELECT w.lookup,w.iv,w.wrapped FROM named_wraps w JOIN codes c ON c.id=w.id
          WHERE w.release=? AND c.revoked=0 ORDER BY w.lookup`).all(releaseId)) {
          namedGrants[lookup] = { iv, wrapped };
        }
        const find = db.prepare('SELECT iv,wrapped FROM wraps WHERE id=? AND release=?');
        const insert = db.prepare('INSERT INTO wraps VALUES(?,?,?,?)');
        for (const { id, code } of db.prepare('SELECT id,code FROM codes WHERE revoked=0 ORDER BY id').all()) {
          const prior = find.get(id, releaseId);
          if (prior) { grants[id] = prior; continue; }
          const iv = randomBytes(12);
          const cipher = createCipheriv('aes-256-gcm', hash('wrap:v1:' + code), iv);
          cipher.setAAD(Buffer.from(id + '.' + releaseId, 'utf8'));
          const wrapped = Buffer.concat([cipher.update(secret), cipher.final(), cipher.getAuthTag()]).toString('base64');
          insert.run(id, releaseId, iv.toString('base64'), wrapped);
          grants[id] = { iv: iv.toString('base64'), wrapped };
        }
        const tmp = outputFile + '.' + randomUUID() + '.tmp';
        try {
          writeFileSync(tmp, JSON.stringify({ version: 1, release: releaseId, grants, namedGrants }) + '\n', { flag: 'wx' });
          renameSync(tmp, outputFile);
        } finally { if (existsSync(tmp)) unlinkSync(tmp); }
        return { release: releaseId, grants: Object.keys(grants).length };
      });
    }
  };
}

async function counters(config, receipts) {
  const response = await fetch(new URL('admin/counters', config.api), {
    method: receipts ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(8000),
    headers: { Authorization: 'Bearer ' + config.token, 'Content-Type': 'application/json' },
    body: receipts ? JSON.stringify({ receipts }) : undefined
  });
  if (!response.ok) throw new PoolError('无法读取或登记访问次数，请检查统计服务与站主配置。');
  if (!receipts) return (await response.json()).counters;
}
export async function registerCounts(config) {
  const rows = config.pool.receipts();
  for (let i = 0; i < rows.length; i += 50) await counters(config, rows.slice(i, i + 50));
  return { registered: rows.length };
}
export async function invitationList(config) {
  const assigned = config.pool.assignments();
  let counts = new Map(), available = true;
  try {
    const remote = await counters(config);
    if (!Array.isArray(remote) || !remote.every(row => /^[a-f0-9]{32}$/.test(row.id) && Number.isSafeInteger(row.successes) && row.successes >= 0)) throw new Error();
    counts = new Map(remote.map(row => [row.id, row.successes]));
  } catch { available = false; }
  const invites = assigned.map(row => ({ ...row, successes: counts.get(row.id) ?? null }))
    .sort((a, b) => (b.successes ?? -1) - (a.successes ?? -1));
  return { invites, countsAvailable: available };
}
