import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server.js';
import { resolveOffers } from '../public/store-offers.js';
import { storeMetrics } from '../incident-history.js';

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'redi-incident-test-'));
  const incidentDir = path.join(directory, 'scenario');
  const configFile = path.join(directory, 'config.json');
  const dataDir = path.join(directory, 'local');
  await cp(new URL('../data/incident/', import.meta.url), incidentDir, { recursive: true });
  await copyFile(new URL('fixtures/config.json', import.meta.url), configFile);
  let server;
  let base;
  async function restart() {
    if (server?.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    const app = await createApp({ dataDir, configFile, incidentDir, now: () => Date.parse('2026-10-20T15:00:00Z') });
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
    directory, incidentDir, dataDir, restart,
    async request(route, method = 'GET', body) {
      const response = await fetch(`${base}${route}`, {
        method,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      return {
        status: response.status,
        body: response.headers.get('content-type')?.includes('application/json')
          ? await response.json() : await response.text()
      };
    }
  };
}

const endpoint = '/api/incident';

async function open(f, eventId) {
  const response = await f.request(`${endpoint}/sessions`, 'POST', { eventId });
  assert.equal(response.status, 201);
  return response.body;
}

async function clientError(f, current) {
  let error;
  try {
    resolveOffers(current.config, current.catalog);
  } catch (failure) {
    error = failure;
  }
  assert.equal(error?.code, 'CATALOG_ITEM_NOT_FOUND');
  assert.equal((await f.request(`${endpoint}/sessions/${current.sessionId}/error`, 'POST', {
    code: error.code, message: error.message, itemId: error.itemId, stack: error.stack
  })).status, 200);
}

test('historical spend and funnels derive from the inspectable traces, not independent headline numbers', async (t) => {
  const f = await fixture(t);
  const overview = (await f.request(`${endpoint}/overview`)).body;
  const raw = (await f.request(`${endpoint}/traces.jsonl`)).body;
  const traces = raw.trim().split('\n').map((line) => JSON.parse(line));
  for (const window of overview.windows) {
    for (const event of window.events) {
      const derived = storeMetrics(traces.filter((trace) => trace.window === window.id && trace.eventId === event.eventId));
      assert.equal(event.spendGB, derived.spendGB);
      assert.equal(event.opened, derived.opened);
      assert.equal(event.crashes, derived.crashes);
    }
  }
  const [before, after] = overview.windows;
  assert.equal(before.events.reduce((total, event) => total + event.spendGB, 0), 800);
  assert.equal(after.events.reduce((total, event) => total + event.spendGB, 0), 320);
  assert.equal(before.events[1].opened, after.events[1].opened);
  assert.equal(after.events[0].rendered, after.events[0].opened);
  assert.equal(after.events[1].rendered, 0);
  assert.equal(after.events[1].crashes, 24);
  assert.ok(traces.every((trace) => trace.source === 'synthetic'));
  assert.equal((await f.request('/api/results')).body.eventCount, 0);
});

test('the released event config reaches the client unchanged and produces a correlated, persistent failure', async (t) => {
  const f = await fixture(t);
  const current = await open(f, 'moonlight-mail');
  assert.throws(() => resolveOffers(current.config, current.catalog), /cannot be resolved/);
  assert.equal((await f.request(`${endpoint}/sessions/${current.sessionId}/rendered`, 'POST', {})).status, 409);
  await clientError(f, current);
  await clientError(f, current);
  await f.restart();
  const traces = (await f.request(`${endpoint}/traces?source=sandbox&q=${current.traceId}`)).body.traces;
  assert.equal(traces.filter((trace) => trace.name === 'client_error').length, 1);
  assert.ok(traces.every((trace) => trace.configVersion === current.configVersion && trace.eventId === 'moonlight-mail'));
  assert.ok(traces.find((trace) => trace.name === 'client_error').stack.includes('resolveOffers'));
  assert.deepEqual([...traces].reverse().map((trace) => trace.name), [
    'event_entered', 'store_opened', 'event_config_loaded', 'catalog_loaded',
    'catalog_item_lookup_failed', 'client_error'
  ]);
  assert.equal((await f.request(`${endpoint}/sessions/${current.sessionId}/purchases`, 'POST', {
    itemId: 'dusk_stamp', requestId: randomUUID()
  })).status, 409);
  const metrics = (await f.request(`${endpoint}/overview`)).body.local[0];
  assert.equal(metrics.crashes, 1);
  assert.equal(metrics.spendGB, 0);
  assert.equal((await f.request('/api/results')).body.eventCount, 0);
});

test('store rendering and purchases are idempotent, serialized and cannot overspend or buy an unavailable item', async (t) => {
  const f = await fixture(t);
  const initial = (await f.request(`${endpoint}/overview`)).body.events.find((event) => event.config.id === 'garden-fair');
  const published = await f.request(`${endpoint}/events/garden-fair/config`, 'PUT', {
    config: { ...initial.config, offerItemIds: ['fern_badge', 'moonlight_ribbon', 'leaf_stamp'] }, expectedVersion: initial.version
  });
  assert.equal(published.status, 200);
  const current = await open(f, 'garden-fair');
  for (let index = 0; index < 2; index++) {
    assert.equal((await f.request(`${endpoint}/sessions/${current.sessionId}/rendered`, 'POST', {})).status, 200);
  }
  const buy = (itemId, requestId = randomUUID()) =>
    f.request(`${endpoint}/sessions/${current.sessionId}/purchases`, 'POST', { itemId, requestId });
  const requestId = randomUUID();
  const purchases = await Promise.all([buy('fern_badge', requestId), buy('fern_badge', requestId)]);
  assert.ok(purchases.every((response) => response.status === 200 && response.body.balanceGB === 60));
  assert.equal((await buy('moonlight_ribbon', requestId)).status, 409);
  assert.equal((await buy('fern_badge')).status, 409);
  assert.equal((await buy('dusk_stamp')).status, 409);
  assert.equal((await buy('moonlight_ribbon')).body.balanceGB, 0);
  assert.equal((await buy('leaf_stamp')).status, 409);
  const metrics = (await f.request(`${endpoint}/overview`)).body.local[0];
  assert.equal(metrics.rendered, 1);
  assert.equal(metrics.purchases, 2);
  assert.equal(metrics.buyers, 1);
  assert.equal(metrics.spendGB, 100);
});

test('publishing a repair creates a new snapshot and observable recovery without rewriting history', async (t) => {
  const f = await fixture(t);
  const original = (await f.request(`${endpoint}/overview`)).body;
  const current = await open(f, 'moonlight-mail');
  await clientError(f, current);
  const selected = original.events.find((event) => event.config.id === 'moonlight-mail');
  const config = { ...selected.config, offerItemIds: ['moonlight_ribbon', 'dusk_stamp'] };
  assert.equal((await f.request(`${endpoint}/events/moonlight-mail/config`, 'PUT', {
    config, expectedVersion: 'a-stale-version'
  })).status, 409);
  assert.equal((await f.request(`${endpoint}/events/moonlight-mail/config`, 'PUT', {
    config: selected.config, expectedVersion: selected.version
  })).status, 400);
  const saved = await f.request(`${endpoint}/events/moonlight-mail/config`, 'PUT', { config, expectedVersion: selected.version });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.config.revision, 9);
  assert.notEqual(saved.body.version, selected.version);
  assert.equal(JSON.parse(await readFile(path.join(f.incidentDir, 'events/moonlight-mail.json'), 'utf8')).revision, 9);
  await f.restart();
  const repaired = await open(f, 'moonlight-mail');
  assert.equal(resolveOffers(repaired.config, repaired.catalog).length, 2);
  await f.request(`${endpoint}/sessions/${repaired.sessionId}/rendered`, 'POST', {});
  const receipt = await f.request(`${endpoint}/sessions/${repaired.sessionId}/purchases`, 'POST', {
    itemId: 'moonlight_ribbon', requestId: randomUUID()
  });
  assert.equal(receipt.body.balanceGB, 40);
  assert.equal((await f.request(`${endpoint}/sessions/${current.sessionId}/rendered`, 'POST', {})).status, 409);
  const after = (await f.request(`${endpoint}/overview`)).body;
  assert.deepEqual(after.windows, original.windows);
  assert.equal(after.local.find((group) => group.configVersion === selected.version).crashes, 1);
  assert.equal(after.local.find((group) => group.configVersion === saved.body.version).spendGB, 60);
  const audit = (await f.request(`${endpoint}/traces?source=sandbox&q=config_published`)).body.traces;
  assert.equal(audit[0].attributes.previousVersion, selected.version);
});

test('pausing is a mitigation and does not report rendered offers, spending or a working client', async (t) => {
  const f = await fixture(t);
  const selected = (await f.request(`${endpoint}/overview`)).body.events.find((event) => event.config.id === 'moonlight-mail');
  const saved = (await f.request(`${endpoint}/events/moonlight-mail/config`, 'PUT', {
    config: { ...selected.config, enabled: false }, expectedVersion: selected.version
  })).body;
  const paused = await open(f, 'moonlight-mail');
  assert.equal(paused.config.enabled, false);
  assert.equal((await f.request(`${endpoint}/sessions/${paused.sessionId}/rendered`, 'POST', {})).status, 409);
  const metrics = (await f.request(`${endpoint}/overview`)).body.local[0];
  assert.equal(metrics.rendered, 0);
  assert.equal(metrics.crashes, 0);
  assert.equal(metrics.spendGB, 0);
  assert.equal((await f.request(`${endpoint}/events/moonlight-mail/config`, 'PUT', {
    config: { ...saved.config, enabled: true }, expectedVersion: saved.version
  })).status, 400);
});

test('incident and normal-game resets preserve each other and do not silently restore configs', async (t) => {
  const f = await fixture(t);
  await open(f, 'garden-fair');
  await f.request('/api/reset', 'POST', { confirmation: 'RESET LOCAL DATA' });
  assert.equal((await f.request(`${endpoint}/overview`)).body.local.length, 1);
  await f.request('/api/rounds', 'POST', { playerId: 'incident-workshop-player' });
  assert.equal((await f.request(`${endpoint}/reset`, 'POST', {})).status, 400);
  await f.request(`${endpoint}/reset`, 'POST', { confirmation: 'RESET INCIDENT TRACES' });
  assert.equal((await f.request(`${endpoint}/overview`)).body.local.length, 0);
  assert.equal((await f.request('/api/results')).body.totalRounds, 1);
  assert.equal((await f.request(`${endpoint}/overview`)).body.events.find((event) => event.config.id === 'moonlight-mail').config.revision, 8);
});

test('invalid identifiers, unknown trace filters and invalid catalog/config structures fail explicitly', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request(`${endpoint}/sessions`, 'POST', { eventId: '../../server' })).status, 404);
  assert.equal((await f.request(`${endpoint}/traces?source=production`)).status, 400);
  assert.equal((await f.request(`${endpoint}/traces?level=error&eventId=moonlight-mail&source=synthetic`)).body.total, 48);
  const config = path.join(f.incidentDir, 'events/moonlight-mail.json');
  const original = JSON.parse(await readFile(config, 'utf8'));
  await writeFile(config, JSON.stringify({ ...original, offerItemIds: [42] }));
  await assert.rejects(createApp({
    dataDir: f.dataDir, incidentDir: f.incidentDir,
    configFile: path.join(f.directory, 'config.json')
  }), /Event config needs/);
});
