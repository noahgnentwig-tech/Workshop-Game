import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server.js';
import { assignVariant } from '../experiments.js';
import { loadSynthetic, parseSynthetic } from '../synthetic.js';

const ROOT = new URL('../', import.meta.url);
const PLAYER = 'anonymous-player-001';
const proposal = {
  name: 'A student experiment',
  hypothesis: 'A small visual example could clarify the first delivery.',
  primaryMetric: 'completion',
  guardrail: 'Do not increase average round duration.',
  decisionRule: 'Agree a meaningful improvement and enough participants before inspecting results.',
  overrides: { showExample: true }
};

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'redi-workshop-test-'));
  const configFile = path.join(directory, 'config.json');
  const dataDir = path.join(directory, 'local');
  await copyFile(new URL('test/fixtures/config.json', ROOT), configFile);
  let clock = Date.parse('2026-10-29T10:00:00Z');
  let server;
  let base;
  async function restart() {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    const app = await createApp({ dataDir, configFile, now: () => clock });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
  }
  t.after(async () => {
    if (server?.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  await restart();
  return {
    directory, configFile, dataDir, restart,
    advance(milliseconds) { clock += milliseconds; },
    async request(route, method = 'GET', body, extraHeaders = {}) {
      const response = await fetch(`${base}${route}`, {
        method,
        headers: body === undefined ? extraHeaders : { 'Content-Type': 'application/json', ...extraHeaders },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const content = response.headers.get('content-type') ?? '';
      return { status: response.status, body: content.includes('application/json') ? await response.json() : await response.text() };
    }
  };
}

async function start(f, extra = {}) {
  const response = await f.request('/api/rounds', 'POST', { playerId: PLAYER, ...extra });
  assert.equal(response.status, 201);
  return response.body;
}

async function complete(f, round, id = PLAYER) {
  let result;
  for (const parcel of round.parcels) {
    if (parcel.fragile) {
      assert.equal((await f.request(`/api/rounds/${round.id}/wrap`, 'POST', {
        playerId: id, parcelId: parcel.id
      })).status, 200);
    }
    f.advance(500);
    result = await f.request(`/api/rounds/${round.id}/attempts`, 'POST', {
      playerId: id, parcelId: parcel.id, destination: parcel.destination
    });
    assert.equal(result.status, 200);
  }
  assert.equal(result.body.status, 'completed');
  return result.body;
}

test('a round records real attempts, one hint per parcel, and a completed shift', async (t) => {
  const f = await fixture(t);
  const round = await start(f);
  const first = round.parcels[0];
  const wrong = ['garden', 'studio', 'workshop'].find((destination) => destination !== first.destination);
  const attempt = await f.request(`/api/rounds/${round.id}/attempts`, 'POST', {
    playerId: PLAYER, parcelId: first.id, destination: wrong
  });
  assert.equal(attempt.body.correct, false);
  assert.equal(attempt.body.sorted, 0);
  for (let index = 0; index < 2; index++) {
    const hint = await f.request(`/api/rounds/${round.id}/hints`, 'POST', { playerId: PLAYER, parcelId: first.id });
    assert.equal(hint.body.hints, 1);
    assert.equal(hint.body.destination, first.destination);
  }
  const done = await complete(f, round);
  assert.equal(done.attempts, round.parcels.length + 1);
  assert.equal(done.hints, 1);
  const results = (await f.request('/api/results')).body;
  assert.equal(results.cohorts[0].completionRate, 1);
  assert.equal(results.cohorts[0].unassistedRate, 0);
  assert.equal(results.cohorts[0].accuracy, 8 / 9);
  const csv = (await f.request('/api/events.csv')).body;
  assert.equal(csv.split('\n').filter((line) => line.includes('"hint_used"')).length, 1);
});

test('ownership, parcel order, disabled hints and deadline are enforced by the backend', async (t) => {
  const f = await fixture(t);
  const settings = (await f.request('/api/settings')).body.config;
  await f.request('/api/config', 'PUT', { ...settings, roundSeconds: 15, hintsEnabled: false });
  const round = await start(f);
  assert.equal((await f.request(`/api/rounds/${round.id}/hints`, 'POST', {
    playerId: 'some-other-player', parcelId: round.parcels[0].id
  })).status, 403);
  assert.equal((await f.request(`/api/rounds/${round.id}/hints`, 'POST', {
    playerId: PLAYER, parcelId: round.parcels[0].id
  })).status, 409);
  assert.equal((await f.request(`/api/rounds/${round.id}/attempts`, 'POST', {
    playerId: PLAYER, parcelId: round.parcels[1].id, destination: round.parcels[1].destination
  })).status, 409);
  assert.equal((await f.request(`/api/rounds/${round.id}/end`, 'POST', {
    playerId: PLAYER, reason: 'time_up'
  })).status, 409);
  f.advance(16000);
  const late = await f.request(`/api/rounds/${round.id}/attempts`, 'POST', {
    playerId: PLAYER, parcelId: round.parcels[0].id, destination: round.parcels[0].destination
  });
  assert.equal(late.status, 409);
  const end = (await f.request(`/api/rounds/${round.id}/end`, 'POST', { playerId: PLAYER, reason: 'time_up' })).body;
  assert.equal(end.status, 'timed_out');
  assert.equal(end.durationSeconds, 15);
});

test('unfinished rounds resolve after their deadline even if the browser never sends an end event', async (t) => {
  const f = await fixture(t);
  await start(f);
  let result = (await f.request('/api/results')).body.cohorts[0];
  assert.equal(result.pending, 1);
  assert.equal(result.completionRate, null);
  f.advance(46000);
  result = (await f.request('/api/results')).body.cohorts[0];
  assert.equal(result.pending, 0);
  assert.equal(result.completionRate, 0);
  assert.equal(result.averageSeconds, 45);
});

test('preview rounds and repeated rounds cannot inflate the first-round comparison', async (t) => {
  const f = await fixture(t);
  const draft = (await f.request('/api/experiments', 'POST', proposal)).body;
  const preview = await start(f, { preview: { experimentId: draft.id, variant: 'B' } });
  assert.equal(preview.config.showExample, true);
  await complete(f, preview);
  const first = await start(f);
  await f.request(`/api/rounds/${first.id}/end`, 'POST', { playerId: PLAYER, reason: 'abandoned' });
  await complete(f, await start(f));
  const results = (await f.request('/api/results')).body;
  assert.equal(results.totalRounds, 2);
  assert.equal(results.previewRounds, 1);
  assert.equal(results.cohorts.length, 1);
  assert.equal(results.cohorts[0].players, 1);
  assert.equal(results.cohorts[0].completionRate, 0);
});

test('launch freezes variants, assignment survives restart, and stopping preserves existing rounds', async (t) => {
  const f = await fixture(t);
  const draft = (await f.request('/api/experiments', 'POST', proposal)).body;
  assert.equal((await f.request(`/api/experiments/${draft.id}/start`, 'POST', {})).status, 200);
  const original = (await f.request(`/api/config?playerId=${PLAYER}`)).body;
  assert.equal(original.variant, assignVariant(PLAYER, draft.id));
  const settings = (await f.request('/api/settings')).body.config;
  assert.equal((await f.request('/api/config', 'PUT', { ...settings, roundSeconds: 90 })).status, 409);
  await writeFile(f.configFile, JSON.stringify({ ...settings, roundSeconds: 90 }));
  await f.restart();
  const reloaded = (await f.request(`/api/config?playerId=${PLAYER}`)).body;
  assert.equal(reloaded.variant, original.variant);
  assert.equal(reloaded.config.roundSeconds, 45);
  const round = await start(f);
  await f.request(`/api/experiments/${draft.id}/stop`, 'POST', {});
  const next = await start(f);
  assert.equal(next.variant, 'baseline');
  assert.equal(next.config.roundSeconds, 90);
  const completed = await complete(f, round);
  assert.equal(completed.experimentId, draft.id);
  assert.equal(completed.config.roundSeconds, 45);
});

test('simultaneous launches cannot run two experiments', async (t) => {
  const f = await fixture(t);
  const a = (await f.request('/api/experiments', 'POST', proposal)).body;
  const b = (await f.request('/api/experiments', 'POST', { ...proposal, name: 'Another student experiment' })).body;
  const responses = await Promise.all([a, b].map((experiment) =>
    f.request(`/api/experiments/${experiment.id}/start`, 'POST', {})
  ));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
});

test('invalid proposals, settings, previews and cross-origin mutations fail explicitly', async (t) => {
  const f = await fixture(t);
  const settings = (await f.request('/api/settings')).body.config;
  for (const overrides of [
    { roundSeconds: 0 }, { parcelCount: 3.5 }, { unknownSetting: true },
    { fragileParcels: 'yes' }, { mistakeLimit: -1 }, { mistakeLimit: 11 },
    { expressBonusSeconds: 1 }, {}, null
  ]) {
    assert.equal((await f.request('/api/experiments', 'POST', { ...proposal, overrides })).status, 400);
  }
  assert.equal((await f.request('/api/experiments', 'POST', { ...proposal, primaryMetric: 'retention' })).status, 400);
  assert.equal((await f.request('/api/config', 'PUT', { ...settings, instructions: '' })).status, 400);
  assert.equal((await f.request('/api/rounds', 'POST', { playerId: 'person@example.com' })).status, 400);
  assert.equal((await f.request('/api/rounds', 'POST', {
    playerId: PLAYER, preview: { experimentId: 'missing', variant: 'B' }
  })).status, 404);
  assert.equal((await f.request('/api/config', 'PUT', settings, { Origin: 'https://unrelated.example' })).status, 403);
  assert.equal((await f.request('/api/experiments')).body.experiments.length, 0);
});

test('a no-op experiment cannot launch', async (t) => {
  const f = await fixture(t);
  const draft = (await f.request('/api/experiments', 'POST', { ...proposal, overrides: { showExample: false } })).body;
  const response = await f.request(`/api/experiments/${draft.id}/start`, 'POST', {});
  assert.equal(response.status, 400);
  assert.match(response.body.error, /identical/);
});

test('events and settings survive restart; reset requires confirmation and keeps config and synthetic data', async (t) => {
  const f = await fixture(t);
  const settings = (await f.request('/api/settings')).body.config;
  await f.request('/api/config', 'PUT', { ...settings, title: 'Our delivery game' });
  await start(f);
  await f.request('/api/experiments', 'POST', proposal);
  await f.restart();
  assert.equal((await f.request('/api/results')).body.totalRounds, 1);
  assert.equal((await f.request('/api/experiments')).body.experiments.length, 1);
  assert.equal((await f.request('/api/reset', 'POST', {})).status, 400);
  assert.equal((await f.request('/api/results')).body.totalRounds, 1);
  await f.request('/api/reset', 'POST', { confirmation: 'RESET LOCAL DATA' });
  assert.equal((await f.request('/api/results')).body.totalRounds, 0);
  assert.equal((await f.request('/api/experiments')).body.experiments.length, 0);
  assert.equal((await f.request('/api/settings')).body.config.title, 'Our delivery game');
  assert.equal((await f.request('/api/synthetic')).body.datasets.length, 3);
});

test('a base config change creates a distinct baseline cohort', async (t) => {
  const f = await fixture(t);
  await start(f);
  const settings = (await f.request('/api/settings')).body.config;
  await f.request('/api/config', 'PUT', { ...settings, parcelCount: 4 });
  await start(f);
  assert.equal((await f.request('/api/results')).body.cohorts.length, 2);
});

test('synthetic cases contain independent fictional players and the intended uncertainty and trade-offs', async () => {
  const datasets = await loadSynthetic(fileURLToPath(new URL('data/synthetic/', ROOT)));
  const [welcome, hints, timer] = datasets;
  assert.equal(welcome.synthetic, true);
  assert.ok(welcome.variants[1].completionInterval[0] > welcome.variants[0].completionInterval[1]);
  assert.ok(hints.variants[1].completionRate > hints.variants[0].completionRate);
  assert.ok(hints.variants.every((variant) => variant.completionInterval[1] - variant.completionInterval[0] > 0.3));
  assert.ok(timer.variants[1].completionRate > timer.variants[0].completionRate);
  assert.ok(timer.variants[1].averageSeconds - timer.variants[0].averageSeconds > 10);
  for (const dataset of datasets) {
    const participants = parseSynthetic(dataset.csv);
    assert.equal(participants.length, dataset.variants.reduce((total, variant) => total + variant.players, 0));
    assert.equal(new Set(participants.map((participant) => participant.playerId)).size, participants.length);
  }
});

test('corrupt local data and invalid synthetic data are not silently replaced', async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.dataDir, 'events.jsonl'), '{broken\n');
  await assert.rejects(createApp({ dataDir: f.dataDir, configFile: f.configFile }), /Cannot read workshop data/);
  assert.equal(await readFile(path.join(f.dataDir, 'events.jsonl'), 'utf8'), '{broken\n');
  assert.throws(() => parseSynthetic('wrong,header\n'), /unexpected header/);
  assert.throws(() => parseSynthetic('player_id,variant,completed,round_seconds,attempts,correct_attempts,hints_used\nfictional-test-1,A,1,20,7,8,0\n'), /Invalid synthetic/);
});

test('fragile parcels need wrapping and duplicate wrap actions record only one event', async (t) => {
  const f = await fixture(t);
  const config = (await f.request('/api/settings')).body.config;
  await f.request('/api/config', 'PUT', { ...config, fragileParcels: true, mistakeLimit: 5 });
  const round = await start(f);
  for (const parcel of round.parcels.slice(0, 2)) {
    await f.request(`/api/rounds/${round.id}/attempts`, 'POST', {
      playerId: PLAYER, parcelId: parcel.id, destination: parcel.destination
    });
  }
  const parcel = round.parcels[2];
  assert.equal(parcel.fragile, true);
  const unwrapped = (await f.request(`/api/rounds/${round.id}/attempts`, 'POST', {
    playerId: PLAYER, parcelId: parcel.id, destination: parcel.destination, score: 999999
  })).body;
  assert.equal(unwrapped.reason, 'needs_wrapping');
  assert.equal(unwrapped.sorted, 2);
  assert.equal(unwrapped.mistakes, 1);
  assert.equal(unwrapped.score, 175);
  assert.equal((await f.request(`/api/rounds/${round.id}/wrap`, 'POST', {
    playerId: PLAYER, parcelId: round.parcels[3].id
  })).status, 409);
  const wraps = await Promise.all([1, 2].map(() => f.request(`/api/rounds/${round.id}/wrap`, 'POST', {
    playerId: PLAYER, parcelId: parcel.id
  })));
  assert.ok(wraps.every((response) => response.status === 200 && response.body.wrappedParcels.length === 1));
  await f.restart();
  const delivered = (await f.request(`/api/rounds/${round.id}/attempts`, 'POST', {
    playerId: PLAYER, parcelId: parcel.id, destination: parcel.destination
  })).body;
  assert.equal(delivered.sorted, 3);
  assert.equal(delivered.score, 275);
  assert.equal(delivered.streak, 1);
  const csv = (await f.request('/api/events.csv')).body;
  assert.equal(csv.split('\n').filter((line) => line.includes('"parcel_wrapped"')).length, 1);
});

test('clean streaks and express points are server-scored and mistakes reset the multiplier', async (t) => {
  const f = await fixture(t);
  const config = (await f.request('/api/settings')).body.config;
  await f.request('/api/config', 'PUT', { ...config, expressParcels: true });
  const round = await start(f);
  async function deliver(index, destination = round.parcels[index].destination) {
    return (await f.request(`/api/rounds/${round.id}/attempts`, 'POST', {
      playerId: PLAYER, parcelId: round.parcels[index].id, destination, points: 999999
    })).body;
  }
  for (let index = 0; index < 2; index++) await deliver(index);
  const streak = await deliver(2);
  assert.equal(streak.streak, 3);
  assert.equal(streak.multiplier, 2);
  assert.equal(streak.score, 400);
  assert.equal(round.parcels[3].express, true);
  f.advance(1000);
  const express = await deliver(3);
  assert.equal(express.expressBonus, 75);
  assert.equal(express.points, 275);
  assert.equal(express.score, 675);
  const wrong = ['garden', 'studio', 'workshop'].find((destination) => destination !== round.parcels[4].destination);
  const mistake = await deliver(4, wrong);
  assert.equal(mistake.multiplier, 1);
  assert.equal(mistake.streak, 0);
  assert.equal(mistake.score, 650);
  await deliver(4);
  await deliver(5);
  f.advance(4000);
  const late = await deliver(6);
  assert.equal(round.parcels[6].express, true);
  assert.equal(late.correct, true);
  assert.equal(late.expressBonus, 0);
  assert.equal(late.points, 200);
  const complete = await deliver(7);
  const result = (await f.request('/api/results')).body.cohorts[0];
  assert.equal(result.averageScore, complete.score);
  assert.equal(result.completed, 1);
});

test('the exact mistake budget ends the shift and is counted as a finished, unsuccessful round', async (t) => {
  const f = await fixture(t);
  const config = (await f.request('/api/settings')).body.config;
  await f.request('/api/config', 'PUT', { ...config, mistakeLimit: 2 });
  const round = await start(f);
  const parcel = round.parcels[0];
  const wrong = ['garden', 'studio', 'workshop'].find((destination) => destination !== parcel.destination);
  const attempt = () => f.request(`/api/rounds/${round.id}/attempts`, 'POST', {
    playerId: PLAYER, parcelId: parcel.id, destination: wrong
  });
  assert.equal((await attempt()).body.status, 'playing');
  const stopped = (await attempt()).body;
  assert.equal(stopped.status, 'overloaded');
  assert.equal(stopped.mistakesRemaining, 0);
  assert.equal(stopped.score, 0);
  assert.equal((await attempt()).status, 409);
  const results = (await f.request('/api/results')).body.cohorts[0];
  assert.equal(results.resolved, 1);
  assert.equal(results.completionRate, 0);
});

test('original configs and frozen experiment snapshots keep classic special-handling settings', async (t) => {
  const f = await fixture(t);
  const config = JSON.parse(await readFile(f.configFile, 'utf8'));
  assert.equal(config.fragileParcels, undefined);
  const draft = (await f.request('/api/experiments', 'POST', proposal)).body;
  await writeFile(path.join(f.dataDir, 'experiments.json'), JSON.stringify([{
    ...draft, status: 'running', baseConfig: config
  }]));
  await f.restart();
  const round = await start(f);
  assert.equal(round.config.fragileParcels, false);
  assert.equal(round.config.expressParcels, false);
  assert.equal(round.config.mistakeLimit, 0);
  assert.ok(round.parcels.every((parcel) => !parcel.fragile && !parcel.express));
  await complete(f, round);
});
