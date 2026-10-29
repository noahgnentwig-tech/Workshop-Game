import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server.js';
import { CAMPAIGN_LEVELS, levelRules, levelParcels } from '../competitive.js';

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'parcel-arena-test-'));
  const configFile = path.join(dir, 'config.json');
  await copyFile(new URL('fixtures/config.json', import.meta.url), configFile);
  let clock = 1800000000000, server, base;
  async function restart() {
    if (server) await new Promise(resolve => server.close(resolve));
    const app = await createApp({ dataDir: path.join(dir, 'local'), configFile, now: () => clock });
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}/api/competitive`;
  }
  await restart();
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  const request = async (route, token, body) => {
    const res = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  };
  const player = async () => (await request('/session', null, {})).data;
  const action = (token, r, action = 'dispatch', extra = {}) => request(`/runs/${r.id}/action`, token, { action,
    parcelId: r.parcel?.id, revision: r.revision, destination: r.parcel?.destination, ...extra });
  return { request, player, action, restart, advance(ms) { clock += ms; } };
}

test('difficulty scales gently, every tenth level is a boss, every twentieth is a super boss, and parcels are deterministic', () => {
  for (const n of [10, 30, 50]) assert.equal(levelRules(n).kind, 'boss');
  for (const n of [20, 40, 60]) assert.equal(levelRules(n).kind, 'super_boss');
  assert.equal(levelRules(1).fragileRate, 0);
  assert.ok(levelRules(9).seconds / levelRules(9).parcelCount < levelRules(1).seconds / levelRules(1).parcelCount);
  assert.ok(levelRules(20).seconds / levelRules(20).parcelCount < levelRules(19).seconds / levelRules(19).parcelCount);
  assert.equal(levelRules(10).rewardLives, 1); assert.equal(levelRules(20).rewardLives, 2);
  assert.deepEqual(levelParcels('shared-seed', 20), levelParcels('shared-seed', 20));
  assert.notDeepEqual(levelParcels('other-seed', 20), levelParcels('shared-seed', 20));
  assert.throws(() => levelRules(0)); assert.throws(() => levelRules(Infinity));
  assert.equal(CAMPAIGN_LEVELS, 220);
  const levels = Array.from({ length: CAMPAIGN_LEVELS }, (_, i) => levelRules(i + 1));
  assert.equal(levels.filter(r => r.kind === 'boss').length, 11);
  assert.equal(levels.filter(r => r.kind === 'super_boss').length, 11);
  assert.equal(levels[29].kind, 'boss'); assert.equal(levels[39].kind, 'super_boss');
  assert.equal(levels[209].kind, 'boss'); assert.equal(levels[219].kind, 'super_boss');
  assert.throws(() => levelRules(221));
});

test('scores, ownership, lives and revisions are server controlled; retry discards partial level points', async t => {
  const f = await fixture(t), a = await f.player(), b = await f.player();
  let r = (await f.request('/solo', a.token, {})).data;
  assert.equal(r.lives, 5); assert.equal(r.level, 1);
  assert.equal((await f.action(b.token, r)).status, 404);
  const initial = r;
  r = (await f.action(a.token, r, 'dispatch', { score: 999999, level: 20, lives: 50 })).data;
  assert.equal(r.score, 100); assert.equal(r.level, 1); assert.equal(r.lives, 5);
  assert.equal((await f.action(a.token, initial)).status, 409);
  const wrong = ['garden', 'studio', 'workshop'].find(d => d !== r.parcel.destination);
  r = (await f.action(a.token, r, 'dispatch', { destination: wrong })).data;
  assert.equal(r.lives, 4); assert.equal(r.streak, 0); assert.equal(r.score, 75);
  f.advance(r.remainingMs + 1);
  r = (await f.request(`/runs/${r.id}`, a.token)).data;
  assert.equal(r.status, 'retry'); assert.equal(r.lives, 3); assert.equal(r.score, 0);
  r = (await f.request(`/runs/${r.id}/next`, a.token, { revision: r.revision })).data;
  assert.equal(r.level, 1); assert.equal(r.sorted, 0); assert.equal(r.status, 'playing');
  assert.equal((await f.request(`/runs/${r.id}/next`, a.token, { revision: r.revision })).status, 409);
});

test('all 220 levels, repeated bosses, the final super boss and persistent completed campaigns work end to end', async t => {
  const f = await fixture(t), a = await f.player();
  let r = (await f.request('/solo', a.token, {})).data, wrapped = 0;
  for (let level = 1; level <= CAMPAIGN_LEVELS; level++) {
    assert.equal(r.level, level);
    if (level % 10 === 0) {
      const wrong = ['garden', 'studio', 'workshop'].find(d => d !== r.parcel.destination);
      r = (await f.action(a.token, r, 'dispatch', { destination: wrong })).data;
      assert.equal(r.lives, 4);
    }
    while (r.status === 'playing') {
      if (r.parcel.fragile && !r.parcel.wrapped) {
        const before = r;
        r = (await f.action(a.token, r, 'wrap')).data; wrapped++;
        assert.equal(r.parcel.wrapped, true);
        assert.equal((await f.action(a.token, before, 'wrap')).status, 409);
      }
      const result = await f.action(a.token, r); assert.equal(result.status, 200); r = result.data;
    }
    assert.equal(r.status, level === CAMPAIGN_LEVELS ? 'finished' : 'level_clear'); assert.equal(r.cleared, level);
    if (level % 10 === 0) assert.equal(r.lives, 5);
    if (level < CAMPAIGN_LEVELS) r = (await f.request(`/runs/${r.id}/next`, a.token, { revision: r.revision })).data;
  }
  assert.ok(wrapped > 0);
  assert.equal(r.reason, 'completed');
  assert.equal((await f.request(`/runs/${r.id}/next`, a.token, { revision: r.revision })).status, 409);
  r = (await f.request(`/runs/${r.id}/finish`, a.token, {})).data;
  const board = (await f.request('/leaderboard')).data;
  assert.equal(board.solo[0].level, CAMPAIGN_LEVELS); assert.equal(board.solo[0].score, r.score);
  await f.request(`/runs/${r.id}/finish`, a.token, {});
  assert.equal((await f.request('/leaderboard')).data.solo[0].runs, 1);
  assert.ok(!('key' in board.solo[0]));
  await f.restart();
  assert.equal((await f.request('/leaderboard')).data.solo[0].score, r.score);
  assert.equal((await f.request('/me', a.token)).data.player.id, a.player.id);
  assert.equal((await f.request('/me', a.token)).data.active, null);
});

test('live PvP has a shared countdown, identical parcels, two seats, a fixed clock and an authoritative winner', async t => {
  const f = await fixture(t), a = await f.player(), b = await f.player(), c = await f.player();
  let room = (await f.request('/rooms', a.token, {})).data;
  assert.equal((await f.request(`/rooms/${room.code}`, c.token)).status, 403);
  room = (await f.request(`/rooms/${room.code}/join`, b.token, {})).data;
  assert.equal((await f.request(`/rooms/${room.code}/join`, c.token, {})).status, 409);
  await f.request(`/rooms/${room.code}/ready`, a.token, {});
  room = (await f.request(`/rooms/${room.code}/ready`, b.token, {})).data;
  assert.equal(room.status, 'countdown'); assert.equal(room.countdownMs, 3000);
  const ar = (await f.request(`/rooms/${room.code}`, a.token)).data.you;
  assert.equal((await f.action(a.token, ar)).status, 409);
  f.advance(3000);
  const av = (await f.request(`/rooms/${room.code}`, a.token)).data;
  const bv = (await f.request(`/rooms/${room.code}`, b.token)).data;
  assert.deepEqual(av.you.parcel, bv.you.parcel); assert.deepEqual(av.you.next, bv.you.next);
  assert.equal(av.remainingMs, 120000);
  let r = av.you;
  while (r.status === 'playing') r = (await f.action(a.token, r)).data;
  assert.equal(r.status, 'level_clear');
  f.advance(1800);
  r = (await f.request(`/rooms/${room.code}`, a.token)).data.you;
  assert.equal(r.level, 2); assert.equal(r.status, 'playing');
  f.advance(120000);
  room = (await f.request(`/rooms/${room.code}`, a.token)).data;
  assert.equal(room.status, 'finished'); assert.equal(room.winner, a.player.id);
  assert.equal((await f.action(a.token, room.you)).status, 409);
  await f.request(`/rooms/${room.code}`, a.token);
  const board = (await f.request('/leaderboard')).data;
  assert.equal(board.pvp.find(p => p.id === a.player.id).wins, 1);
  assert.equal(board.pvp.find(p => p.id === b.player.id).losses, 1);
  assert.equal(board.pvp[0].matches, 1);
});

test('ties, forfeits and closed lobbies have correct results without duplicate leaderboard entries', async t => {
  const f = await fixture(t), a = await f.player(), b = await f.player();
  let room = (await f.request('/rooms', a.token, {})).data;
  await f.request(`/rooms/${room.code}/join`, b.token, {});
  await f.request(`/rooms/${room.code}/ready`, a.token, {});
  await f.request(`/rooms/${room.code}/ready`, b.token, {});
  f.advance(123001);
  room = (await f.request(`/rooms/${room.code}`, a.token)).data;
  assert.equal(room.status, 'finished'); assert.equal(room.winner, null);
  assert.equal((await f.request('/leaderboard')).data.pvp[0].draws, 1);
  room = (await f.request('/rooms', a.token, {})).data;
  await f.request(`/rooms/${room.code}/join`, b.token, {});
  await f.request(`/rooms/${room.code}/ready`, a.token, {});
  await f.request(`/rooms/${room.code}/ready`, b.token, {});
  room = (await f.request(`/rooms/${room.code}/leave`, a.token, {})).data;
  assert.equal(room.winner, b.player.id); assert.equal(room.reason, 'forfeit');
  await f.request(`/rooms/${room.code}/leave`, a.token, {});
  assert.equal((await f.request('/leaderboard')).data.pvp.find(p => p.id === b.player.id).matches, 2);
  room = (await f.request('/rooms', a.token, {})).data;
  await f.request(`/rooms/${room.code}/leave`, a.token, {});
  assert.equal((await f.request(`/rooms/${room.code}/join`, b.token, {})).status, 409);
  assert.equal((await f.request('/leaderboard')).data.pvp.find(p => p.id === a.player.id).matches, 2);
});
