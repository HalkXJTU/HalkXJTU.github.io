import assert from 'node:assert/strict';
import test from 'node:test';
import { formatNamedInvite, makeNamedGrant, normalizeInviteName, resolveNamedInvite } from '../named-invites.mjs';

const code = 'INV-AAAAAAAAAAAAAAAAAAAAAA'; // Fixed synthetic compatibility vector.
const release = '1234567890abcdef12345678';
const next = '1234567890abcdef12345679';
const example = 'inv-hao-jing-tmtgfreqba';

test('stable letter-only aliases and name validation', async () => {
  assert.equal(await formatNamedInvite(code, '  Hao  Jing '), example);
  assert.equal(await formatNamedInvite(code, 'HAO-JING'), example);
  assert.match(await formatNamedInvite(code, ' Jean-Luc   MARTIN '), /^inv-jean-luc-martin-[a-z]{10}$/);
  const second = await formatNamedInvite('INV-AQAAAAAAAAAAAAAAAAAAAA', 'Hao Jing');
  assert.notEqual(second, example);
  for (const name of ['荆昊', 'Hao2', 'Hao/Jing', '_', '', 'J'.repeat(121)]) {
    assert.throws(() => normalizeInviteName(name), /英文字母/);
  }
});

test('an opaque public grant returns the original code and rejects mixups', async () => {
  const grant = await makeNamedGrant(code, release);
  const { id, iv, wrapped } = grant;
  assert.match(id, /^[a-f0-9]{32}$/);
  assert.equal(iv.length, 16);
  assert.equal(wrapped.length, 56);
  const table = { [id]: { iv, wrapped } };
  assert.equal(await resolveNamedInvite(example, release, table), code);
  const otherName = await formatNamedInvite(code, 'Linda Rossi');
  assert.equal(await resolveNamedInvite(otherName, release, table), code);
  for (const invalid of [example.replace('hao', 'han'), example.slice(0, -1) + 'z', example.replace('inv-', 'INV-'), example.replace('hao', '荆昊')]) {
    await assert.rejects(resolveNamedInvite(invalid, release, table), { message: 'wrong' });
  }
  await assert.rejects(resolveNamedInvite(example, next, table), { message: 'wrong' });
  const changed = Buffer.from(wrapped, 'base64');
  changed[0] ^= 1;
  await assert.rejects(resolveNamedInvite(example, release, { [id]: { iv, wrapped: changed.toString('base64') } }), { message: 'wrong' });
  const newer = await makeNamedGrant(code, next);
  assert.notEqual(newer.id, id);
  assert.equal(await resolveNamedInvite(example, next, { [newer.id]: newer }), code);
});
