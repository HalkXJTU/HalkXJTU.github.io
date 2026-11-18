import assert from 'node:assert/strict';
import { createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { invitationList, openPool, registerCounts } from './offline-invites.mjs';
import { resolveNamedInvite } from '../named-invites.mjs';

test('private allocation, release exports and anonymous count registration', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'homepage-offline-pool-'));
  const pool = openPool(dir);
  t.after(() => { pool.close(); rmSync(dir, { recursive: true, force: true }); });
  const gate = join(dir, 'gate-config.json'), grantsFile = join(dir, 'invitation-grants.json');
  const hash = value => createHash('sha256').update(value).digest();
  function release() {
    const id = randomBytes(12).toString('hex'), key = randomBytes(32);
    writeFileSync(gate, JSON.stringify({ id }));
    writeFileSync(join(dir, id + '.json'), JSON.stringify({ id, key: key.toString('base64') }));
    return { id, key };
  }
  async function exportFile() {
    await pool.exportGrants(gate, dir, grantsFile);
    return readFileSync(grantsFile, 'utf8');
  }
  function decrypt(json, invite, release) {
    const { iv, wrapped } = JSON.parse(json).grants[invite.id];
    const data = Buffer.from(wrapped, 'base64');
    const dec = createDecipheriv('aes-256-gcm', hash('wrap:v1:' + invite.code), Buffer.from(iv, 'base64'));
    dec.setAAD(Buffer.from(invite.id + '.' + release.id)); dec.setAuthTag(data.subarray(-16));
    assert.deepEqual(Buffer.concat([dec.update(data.subarray(0,-16)), dec.final()]), release.key);
  }
  assert.equal(pool.init().created, true);
  assert.equal(pool.init().created, false);
  // Two rows already given out by the previous release have no name metadata.
  const old = new DatabaseSync(join(dir, 'offline-invitations.sqlite3'));
  const assign = old.prepare('UPDATE codes SET label=? WHERE id=(SELECT id FROM codes WHERE label IS NULL LIMIT 1)');
  assign.run('Alpha'); assign.run('Beta'); old.close();
  const a = await pool.issue('Alpha'), b = await pool.issue('Beta');
  assert.notEqual(a.id, b.id);
  const other = openPool(dir);
  try { assert.deepEqual(await other.issue('Alpha'), a); } finally { other.close(); }
  assert.match(a.code, /^INV-[a-zA-Z0-9_-]{22}$/);
  assert.equal(a.id, hash('id:v1:' + a.code).subarray(0,16).toString('hex'));
  const first = release(), json = await exportFile();
  assert.equal(Object.keys(JSON.parse(json).grants).length, 64);
  assert(!json.includes(a.code) && !json.includes(a.label));
  assert.equal(await exportFile(), json);
  const { namedGrants } = JSON.parse(json);
  assert.equal(Object.keys(namedGrants).length, 64);
  await assert.rejects(pool.issue('Alpha', '荆昊'), /英文/);
  const named = await pool.issue('Alpha', 'Hao Jing');
  assert.match(named.code, /^inv-hao-jing-[a-z]+$/);
  assert.equal((await pool.issue('Alpha')).code, named.code);
  assert.equal((await pool.issue('Alpha','HAO JING')).code, named.code);
  assert.equal(named.id, a.id);
  await assert.rejects(pool.issue('Alpha','Other Name'), /已绑定/);
  assert.equal(await resolveNamedInvite(named.code, first.id, namedGrants), a.code);
  assert(!json.includes(named.code) && !json.includes('hao-jing'));
  assert.equal(await exportFile(), json);
  decrypt(json, a, first);
  const second = release(), next = await exportFile();
  decrypt(next, a, second); decrypt(next, b, second);
  assert.deepEqual(Object.keys(JSON.parse(next).grants), Object.keys(JSON.parse(json).grants));
  assert.equal(pool.revoke(a.id).requiresPublish, true);
  assert.equal(await resolveNamedInvite(named.code,second.id,JSON.parse(next).namedGrants),a.code);
  const revoked = JSON.parse(await exportFile());
  assert(!Object.hasOwn(revoked.grants, a.id));
  await assert.rejects(resolveNamedInvite(named.code,second.id,revoked.namedGrants));
  const replacement = await pool.issue('Alpha','Hao Jing');
  assert.notEqual(replacement.id, a.id);
  assert(pool.assignments().every(row => !('code' in row)));

  const config = { api: new URL('https://example.invalid/access/'), token: 'service-token', pool };
  const calls = [];
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (url, opts) => {
    assert.equal(url.href, 'https://example.invalid/access/admin/counters');
    assert.equal(opts.redirect, 'error');
    if (opts.method === 'GET') return Response.json({ counters: [{id:b.id,successes:4}] });
    const rows = JSON.parse(opts.body).receipts;
    assert(rows.every(row => Object.keys(row).sort().join() === 'digest,id'));
    calls.push(rows);
    return new Response(null, { status: 204 });
  };
  assert.equal((await registerCounts(config)).registered, 64);
  assert.deepEqual(calls.map(rows => rows.length), [50,14]);
  const receipt = hash('count:v1:' + a.code).toString('base64url');
  assert.equal(calls.flat().find(row => row.id === a.id).digest, hash(receipt).toString('base64url'));
  const live = await invitationList(config);
  assert.equal(live.countsAvailable, true);
  assert.equal(live.invites[0].successes, 4);
  assert(live.invites.filter(row => row.id !== b.id).every(row => row.successes === null));
  globalThis.fetch = async () => { throw new Error('offline'); };
  await assert.rejects(pool.issue('Gamma'), /英文/);
  assert((await pool.issue('Gamma', 'A B')).code);
  const offline = await invitationList(config);
  assert.equal(offline.countsAvailable, false);
  assert(offline.invites.every(row => row.successes === null));
});
