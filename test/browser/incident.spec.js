import { test as base, expect } from '@playwright/test';
import { copyFile, cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../../server.js';

const seed = new URL('../../data/incident/', import.meta.url);
const test = base.extend({
  incident: [async ({}, use) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'redi-incident-browser-'));
    const incidentDir = path.join(directory, 'scenario');
    const configFile = path.join(directory, 'config.json');
    await cp(seed, incidentDir, { recursive: true });
    await copyFile(new URL('../fixtures/config.json', import.meta.url), configFile);
    const app = await createApp({ dataDir: path.join(directory, 'local'), configFile, incidentDir });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      await use({ url: `http://127.0.0.1:${server.address().port}`, incidentDir });
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  }, { scope: 'worker' }]
});

test.beforeEach(async ({ incident, request }) => {
  await cp(seed, incident.incidentDir, { recursive: true });
  expect((await request.post(`${incident.url}/api/incident/reset`, {
    data: { confirmation: 'RESET INCIDENT TRACES' }
  })).ok()).toBeTruthy();
});

test('students can follow the spending signal into an individual historical error trace', async ({ page, incident }) => {
  await page.goto(`${incident.url}/incident.html`);
  await expect(page.locator('#incident-kpis')).toContainText('800 -> 320 GB');
  await expect(page.locator('#incident-kpis')).toContainText('-60.0%');
  await page.getByLabel('LiveOps event', { exact: true }).selectOption('moonlight-mail');
  await page.getByLabel('Evidence source', { exact: true }).selectOption('synthetic');
  await page.getByLabel('Severity', { exact: true }).selectOption('error');
  await page.getByRole('button', { name: 'Search traces', exact: true }).click();
  await expect(page.locator('#trace-count')).toContainText('48 matching entries');
  const detail = page.locator('#trace-results details').first();
  await detail.locator('summary').click();
  await detail.getByRole('button', { name: 'Follow trace', exact: true }).click();
  await expect(page.locator('#trace-count')).toContainText('6 of 6');
  await expect(page.locator('#trace-count')).toContainText('oldest first');
  await expect(page.locator('#trace-results')).toContainText('event_config_loaded');
  await expect(page.locator('#trace-results')).toContainText('catalog_loaded');
  await expect(page.locator('#trace-results')).toContainText('client_error');
  const failure = page.locator('#trace-results tbody tr').filter({ hasText: 'client_error' }).first();
  await failure.locator('summary').click();
  await expect(failure.locator('.trace-stack')).toContainText('resolveOffers');
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download incident JSONL' }).click();
  expect((await download).suggestedFilename()).toBe('incident-traces.jsonl');
});

test('one store works, the other really stops on config resolution, and the normal game still runs', async ({ page, incident }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${incident.url}/store.html?event=garden-fair`);
  await expect(page.locator('#client-state')).toHaveText('STORE READY');
  await page.getByRole('button', { name: 'Buy Fern badge for 40 GB', exact: true }).click();
  await expect(page.locator('#store-balance')).toHaveText('60 GB');
  await expect(page.getByRole('button', { name: 'Owned in this sandbox client' })).toBeDisabled();
  await page.getByRole('link', { name: 'Inspect this client trace' }).click();
  await expect(page.locator('#trace-results')).toContainText('purchase_succeeded');
  await page.goto(`${incident.url}/store.html?event=moonlight-mail`);
  await expect(page.locator('#client-state')).toHaveText('CLIENT STOPPED');
  await expect(page.locator('#store-failure')).toBeVisible();
  await expect(page.locator('#store-offers')).toBeEmpty();
  await expect(page.locator('#store-balance')).toHaveText('100 GB');
  await page.getByRole('link', { name: 'Inspect this client trace' }).click();
  await expect(page.locator('#trace-results')).toContainText('catalog_item_lookup_failed');
  await expect(page.locator('#trace-results')).toContainText('client_error');
  await page.getByRole('link', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Start shift', exact: true }).click();
  await expect(page.locator('#active-screen')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a minimal config repair can be published and verified without changing the historical case', async ({ page, context, incident }) => {
  await page.goto(`${incident.url}/store.html?event=moonlight-mail`);
  await expect(page.locator('#client-state')).toHaveText('CLIENT STOPPED');
  await page.getByRole('link', { name: 'Inspect this client trace' }).click();
  await page.getByText('Open config editor', { exact: true }).click();
  await page.getByLabel('Event config', { exact: true }).selectOption('moonlight-mail');
  const config = JSON.parse(await page.getByLabel('Released config JSON').inputValue());
  config.offerItemIds[0] = 'moonlight_ribbon';
  await page.getByLabel('Released config JSON').fill(JSON.stringify(config, null, 2));
  await page.getByRole('button', { name: 'Publish local config', exact: true }).click();
  await expect(page.locator('#page-message')).toContainText('Published moonlight-mail@9');
  const opened = context.waitForEvent('page');
  await page.getByRole('link', { name: 'Open Moonlight Mail client' }).click();
  const client = await opened;
  await expect(client.locator('#client-state')).toHaveText('STORE READY');
  await client.getByRole('button', { name: 'Buy Moonlight ribbon for 60 GB', exact: true }).click();
  await expect(client.locator('#store-balance')).toHaveText('40 GB');
  await client.close();
  await page.getByRole('button', { name: 'Refresh incident evidence' }).click();
  await expect(page.locator('#sandbox-results')).toContainText('moonlight-mail@8');
  await expect(page.locator('#sandbox-results')).toContainText('moonlight-mail@9');
  await expect(page.locator('#sandbox-results')).toContainText('60 GB');
  await expect(page.locator('#incident-kpis')).toContainText('800 -> 320 GB');
});

test('pausing is shown as a mitigation, and the mobile incident room stays within the viewport', async ({ page, context, incident }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${incident.url}/incident.html`);
  await page.getByText('Open config editor', { exact: true }).click();
  await page.getByLabel('Event config', { exact: true }).selectOption('moonlight-mail');
  const config = JSON.parse(await page.getByLabel('Released config JSON').inputValue());
  config.enabled = false;
  await page.getByLabel('Released config JSON').fill(JSON.stringify(config));
  await page.getByRole('button', { name: 'Publish local config' }).click();
  await expect(page.locator('#page-message')).toContainText('Published');
  const opened = context.waitForEvent('page');
  await page.getByRole('link', { name: 'Open Moonlight Mail client' }).click();
  const client = await opened;
  await expect(client.locator('#client-state')).toHaveText('EVENT PAUSED');
  await expect(client.locator('#store-offers')).toBeEmpty();
  await client.close();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});
