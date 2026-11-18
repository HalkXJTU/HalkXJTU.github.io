import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createLocalAccessService } from './local.mjs';

test('invites are private, revocable, counted atomically, and deduplicated on retry', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'homepage-invite-test-'));
  const origin = 'http://127.0.0.1:4173';
  const secret = () => randomBytes(32).toString('base64');
  const config = { ADMIN_TOKEN: secret(), INVITE_HMAC_KEY: secret(),
    SITE_RELEASE: { id: 'test-release', key: secret() }, ALLOWED_ORIGINS: origin };
  writeFileSync(join(dir, 'access-config.json'), JSON.stringify(config));
  let service = createLocalAccessService(dir);
  t.after(() => {
    service.close();
    unlinkSync(join(dir, 'access-config.json'));
    unlinkSync(join(dir, 'invitations.sqlite3'));
    rmdirSync(dir);
  });
  async function request(path, method, body, headers = {}) {
    const response = await service(new Request(origin + '/access/' + path, { method,
      headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body) }));
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    return { response, status: response.status, body: response.status === 204 ? null : await response.json() };
  }
  const admin = { Authorization: 'Bearer ' + config.ADMIN_TOKEN };
  const list = async () => (await request('admin/invites', 'GET', undefined, admin)).body.invites;
  const create = async label => (await request('admin/invites', 'POST', { label }, admin)).body;
  const unlock = (code, args = {}, headers) => request('unlock', 'POST', { code, release: config.SITE_RELEASE.id, ...args }, headers);
  assert.equal((await request('admin/invites', 'GET')).status, 403);
  assert.equal((await request('admin/invites?code=x', 'GET', undefined, admin)).status, 404);
  assert.equal((await request('admin/invites', 'POST', { label: '' }, admin)).status, 400);
  const invitation = await create('Office');
  const other = await create('Office');
  assert.notEqual(invitation.id, other.id);
  assert.notEqual(invitation.code, other.code);
  assert.match(invitation.code, /^INV-[A-Za-z0-9_-]{22}$/);
  const blocked = await unlock(invitation.code, {}, { Origin: 'https://elsewhere.invalid' });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.response.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal((await unlock(invitation.code, { release: 'stale' })).status, 409);
  assert.equal((await unlock('INV-' + 'A'.repeat(22))).status, 403);
  assert.deepEqual((await list()).map(i => i.successes), [0, 0]);
  const visit = randomUUID();
  const retries = await Promise.all(Array.from({ length: 4 }, () => unlock(invitation.code, { visit })));
  for (const result of retries) {
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, config.SITE_RELEASE);
    assert.equal(result.response.headers.get('Access-Control-Allow-Origin'), origin);
  }
  await Promise.all([unlock(invitation.code, { visit: randomUUID() }), unlock(invitation.code), unlock(other.code, { visit })]);
  let rows = await list();
  assert.deepEqual(rows.map(i => [i.id, i.successes]), [[invitation.id, 3], [other.id, 1]]);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['id', 'label', 'revoked', 'successes']);
  assert.equal((await request('admin/invites/' + invitation.id + '/revoke', 'POST', {}, admin)).status, 200);
  assert.equal((await unlock(invitation.code, { visit })).status, 403);
  service.close();
  service = createLocalAccessService(dir);
  rows = await list();
  assert.deepEqual(rows.map(i => [i.revoked, i.successes]), [[true, 3], [false, 1]]);
  assert.equal((await unlock(other.code, { visit })).status, 200);
  assert.equal((await list()).find(i => i.id === other.id).successes, 1);
  const bytes = readFileSync(join(dir, 'invitations.sqlite3'));
  for (const privateValue of [visit, invitation.code, config.ADMIN_TOKEN, config.INVITE_HMAC_KEY, config.SITE_RELEASE.key]) {
    assert.equal(bytes.includes(Buffer.from(privateValue)), false);
  }
  const options = await request('unlock', 'OPTIONS');
  assert.equal(options.response.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal(options.response.headers.has('Access-Control-Allow-Credentials'), false);
  assert.equal((await request('admin/invites', 'GET', undefined, { ...admin, Origin: 'null' })).status, 403);

  // Even a local database containing an owner PIN must reject it in the standard mode.
  service.close();
  service = createLocalAccessService(dir, { ownerPreview: true });
  const pin = '4837';
  await service.setOwnerPin(pin);
  assert.equal((await unlock(pin, {}, { Origin: 'null' })).status, 403);
  assert.equal((await unlock(pin, {}, { Origin: 'https://elsewhere.invalid' })).status, 403);
  const foreignUrl = new Request('https://elsewhere.invalid/access/unlock', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: pin, release: config.SITE_RELEASE.id })
  });
  assert.equal((await service(foreignUrl)).status, 403);
  assert.equal((await unlock(pin, { visit })).status, 200);
  assert.equal((await unlock(pin, { visit })).status, 200);
  const owner = (await list()).find(row => row.label === '站主 · 本机密码');
  assert.equal(owner.successes, 1);
  assert.equal((await request('admin/invites/' + owner.id + '/revoke', 'POST', {}, admin)).status, 200);
  assert.equal((await unlock(pin)).status, 403);
  await service.setOwnerPin('5837');
  assert.equal((await unlock(pin)).status, 403);
  assert.equal((await unlock('5837')).status, 200);
  assert.equal((await list()).find(row => row.id === owner.id).successes, 2);
  service.close();
  service = createLocalAccessService(dir);
  assert.equal((await unlock('5837')).status, 403);
  assert.equal((await unlock(other.code, { visit })).status, 200);
  assert.equal((await list()).find(row => row.id === other.id).successes, 1);
});
