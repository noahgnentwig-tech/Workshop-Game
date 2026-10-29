import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server.js';

test('public hosting serves the arena and health checks, allows same-host HTTPS and blocks workshop management', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'parcel-hosting-test-'));
  const configFile = path.join(dir, 'config.json');
  await copyFile(new URL('fixtures/config.json', import.meta.url), configFile);
  const app = await createApp({ dataDir: path.join(dir, 'local'), configFile, publicDemo: true, ephemeral: true });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (route, method = 'GET', body, origin) => fetch(base + route, { method, redirect: 'manual',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(origin ? { Origin: origin } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal((await request('/')).headers.get('location'), '/arena.html');
  assert.equal((await request('/arena.html')).status, 200);
  assert.equal((await request('/classic.html')).status, 200);
  assert.deepEqual(await (await request('/healthz')).json(), { status: 'ok' });
  assert.deepEqual(await (await request('/api/runtime')).json(), { publicDemo: true, ephemeral: true });
  for (const route of ['/lab.html', '/incident.html', '/WORKSHOP.md']) assert.equal((await request(route)).headers.get('location'), '/arena.html');
  for (const route of ['/api/settings', '/api/results', '/api/events.csv', '/api/incident/history', '/api/experiments']) assert.equal((await request(route)).status, 403);
  assert.equal((await request('/api/config', 'PUT', {})).status, 403);
  assert.equal((await request('/api/reset', 'POST', { confirmation: 'RESET LOCAL DATA' })).status, 403);
  assert.equal((await request('/api/competitive/session', 'POST', {}, 'https://attacker.example')).status, 403);
  const sessionResponse = await request('/api/competitive/session', 'POST', {}, base.replace('http:', 'https:'));
  assert.equal(sessionResponse.status, 201);
  const session = await sessionResponse.json();
  const solo = await fetch(base + '/api/competitive/solo', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}`, Origin: base.replace('http:', 'https:') }, body: '{}' });
  assert.equal(solo.status, 201); assert.equal((await solo.json()).level, 1);
});
