import { test as base, expect } from '@playwright/test';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../../server.js';

const test = base.extend({
  workshop: [async ({}, use) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'redi-workshop-browser-'));
    const configFile = path.join(directory, 'config.json');
    await copyFile(new URL('../fixtures/config.json', import.meta.url), configFile);
    const app = await createApp({ dataDir: path.join(directory, 'local'), configFile });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      await use(`http://127.0.0.1:${server.address().port}`);
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  }, { scope: 'worker' }]
});

test.beforeEach(async ({ request, workshop }) => {
  const config = JSON.parse(await readFile(new URL('../fixtures/config.json', import.meta.url), 'utf8'));
  expect((await request.post(`${workshop}/api/reset`, { data: { confirmation: 'RESET LOCAL DATA' } })).ok()).toBeTruthy();
  expect((await request.put(`${workshop}/api/config`, { data: config })).ok()).toBeTruthy();
});

test('the game can be completed with visible destinations and reports actual attempts and hints', async ({ page, workshop }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(workshop);
  await page.getByRole('button', { name: 'Start shift', exact: true }).click();
  await expect(page.locator('#active-screen')).toBeVisible();
  const first = await page.locator('#parcel-name').textContent();
  const wrong = ['Garden', 'Studio', 'Workshop'].find((name) => name !== first);
  await page.getByRole('button', { name: new RegExp(`^${wrong}, shortcut`) }).click();
  await expect(page.locator('#feedback')).toContainText('Try another');
  await expect(page.locator('#progress-label')).toHaveText('0 / 8');
  await page.getByRole('button', { name: 'Ask for a hint' }).click();
  await expect(page.locator('#hint-count')).toHaveText('1');
  for (let index = 0; index < 8; index++) {
    const name = await page.locator('#parcel-name').textContent();
    await page.getByRole('button', { name: new RegExp(`^${name}, shortcut`) }).click();
    await expect(page.locator('#progress-label')).toHaveText(`${index + 1} / 8`);
  }
  await expect(page.getByRole('heading', { name: 'All parcels delivered!' })).toBeFocused();
  await expect(page.locator('#result-detail')).toContainText('9 sorting attempts. 1 hints used.');
  await page.getByRole('link', { name: 'Explore the workshop lab' }).click();
  await expect(page.locator('#live-summary')).toContainText('1 live shifts started');
  await expect(page.locator('#live-results')).toContainText('100.0%');
  expect(errors).toEqual([]);
});

test('a participant can save a proposal, preview without polluting results, and launch or stop it', async ({ page, context, workshop }) => {
  await page.goto(`${workshop}/lab.html`);
  await expect(page.locator('#dataset-name')).toHaveText('A first delivery');
  await page.getByLabel('Choose a case').selectOption('hints');
  await expect(page.locator('#dataset-name')).toHaveText('A helping hand');
  await page.getByLabel('Choose a case').selectOption('timer');
  await expect(page.locator('#synthetic-results')).toContainText('75-second shift');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download fictional player CSV' }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('synthetic-timer.csv');

  await page.getByLabel('Experiment name', { exact: true }).fill('Our onboarding question');
  await page.getByLabel('What do you expect').fill('A worked example might make the delivery rule easier to understand.');
  await page.getByLabel('Guardrail:').fill('Do not increase time spent in the first round.');
  await page.getByLabel('What evidence would you need').fill('Agree a useful effect and enough first-time players before analysing results.');
  await page.getByLabel('Variant B:').fill('{"showExample":true}');
  await page.getByRole('button', { name: 'Save proposal' }).click();
  await expect(page.getByRole('heading', { name: 'Our onboarding question' })).toBeVisible();
  const previewPromise = context.waitForEvent('page');
  await page.getByRole('link', { name: 'Preview B', exact: true }).click();
  const preview = await previewPromise;
  await expect(preview.locator('#preview-banner')).toBeVisible();
  await expect(preview.locator('#worked-example')).toBeVisible();
  await preview.getByRole('button', { name: 'Start shift', exact: true }).click();
  await preview.getByRole('button', { name: 'End this shift' }).click();
  await page.getByRole('button', { name: 'Refresh lab' }).click();
  await expect(page.locator('#live-summary')).toContainText('0 live shifts started. 1 preview shifts excluded.');
  await preview.close();
  await page.getByRole('button', { name: 'Launch 50/50 test' }).click();
  await expect(page.getByLabel('Game title', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Stop experiment', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop experiment', exact: true }).click();
  await expect(page.getByLabel('Game title', { exact: true })).toBeEnabled();
  await expect(page.locator('#experiment-list')).toContainText('STOPPED');
});

test('settings persist, keyboard controls work and the layout fits a narrow viewport', async ({ page, workshop }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${workshop}/lab.html`);
  await page.getByText('Edit game settings', { exact: true }).click();
  await page.getByLabel('Game title', { exact: true }).fill('Our Parcel Game');
  await page.getByLabel('Parcels per shift').fill('3');
  await page.getByLabel('Show a worked example').check();
  await page.getByRole('button', { name: 'Save base settings' }).click();
  await expect(page.locator('#page-message')).toContainText('saved to config.json');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.getByRole('link', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Our Parcel Game' })).toBeVisible();
  await expect(page.locator('#worked-example')).toBeVisible();
  await page.getByRole('button', { name: 'Start shift', exact: true }).click();
  await expect(page.locator('#active-screen')).toBeVisible();
  for (let index = 0; index < 3; index++) {
    const name = await page.locator('#parcel-name').textContent();
    await page.keyboard.press({ Garden: '1', Studio: '2', Workshop: '3' }[name]);
    await expect(page.locator('#progress-label')).toHaveText(`${index + 1} / 3`);
  }
  await expect(page.getByRole('heading', { name: 'All parcels delivered!' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('the lab reports invalid JSON without saving a success-shaped proposal', async ({ page, workshop }) => {
  await page.goto(`${workshop}/lab.html`);
  await page.getByLabel('Experiment name', { exact: true }).fill('A malformed proposal');
  await page.getByLabel('What do you expect').fill('We expect a meaningful improvement for first-time players.');
  await page.getByLabel('Guardrail:').fill('Watch for a worse experience.');
  await page.getByLabel('What evidence would you need').fill('Collect enough evidence before deciding.');
  await page.getByLabel('Variant B:').fill('{broken');
  await page.getByRole('button', { name: 'Save proposal' }).click();
  await expect(page.locator('#page-message')).toContainText('must be valid JSON');
  await expect(page.locator('#experiment-list')).toContainText('No proposals yet');
});

test('a failed backend connection is visible and does not enable a broken game', async ({ page, workshop }) => {
  await page.route('**/api/config?*', (route) => route.abort('connectionrefused'));
  await page.goto(workshop);
  await expect(page.locator('#page-message')).toContainText('Cannot reach the local workshop');
  await expect(page.getByRole('button', { name: 'Start shift', exact: true })).toBeDisabled();
});

test('the timer ends an idle shift and reset respects the confirmation dialog', async ({ page, request, workshop }) => {
  const settings = await (await request.get(`${workshop}/api/settings`)).json();
  expect((await request.put(`${workshop}/api/config`, {
    data: { ...settings.config, roundSeconds: 15 }
  })).ok()).toBeTruthy();
  await page.goto(workshop);
  await page.getByRole('button', { name: 'Start shift', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Time for a breather.' })).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#result-summary')).toContainText('0 of 8 parcels in 15.0 seconds');
  await page.getByRole('link', { name: 'Explore the workshop lab' }).click();
  await expect(page.locator('#live-summary')).toContainText('1 live shifts started');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Reset local playtest data' }).click();
  await expect(page.locator('#live-summary')).toContainText('1 live shifts started');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Reset local playtest data' }).click();
  await expect(page.locator('#live-summary')).toContainText('0 live shifts started');
});

test('the arcade conveyor supports fragile wrapping, express bonuses and combined handling with the keyboard', async ({ page, request, workshop }) => {
  const settings = await (await request.get(`${workshop}/api/settings`)).json();
  expect((await request.put(`${workshop}/api/config`, {
    data: { ...settings.config, parcelCount: 13, fragileParcels: true, expressParcels: true, mistakeLimit: 5 }
  })).ok()).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(workshop);
  await page.getByRole('button', { name: 'Start shift', exact: true }).click();
  await expect(page.locator('#active-screen')).toBeVisible();
  await expect(page.locator('#parcel-queue li')).toHaveCount(2);
  for (let index = 0; index < 13; index++) {
    const name = await page.locator('#parcel-name').textContent();
    const key = { Garden: '1', Studio: '2', Workshop: '3' }[name];
    const wrap = page.getByRole('button', { name: 'Wrap parcel, shortcut W' });
    if (index === 2) {
      await page.keyboard.press(key);
      await expect(page.locator('#feedback')).toContainText('Wrap this parcel');
      await expect(page.locator('#progress-label')).toHaveText('2 / 13');
      await expect(page.locator('#mistakes')).toHaveText('1 / 5');
      await expect(page.locator('#parcel')).toBeInViewport({ ratio: 1 });
      await expect(page.locator('#destinations')).toBeInViewport({ ratio: 1 });
    }
    if (index === 12) {
      await expect(page.locator('#parcel-flags')).toContainText('FRAGILE');
      await expect(page.locator('#parcel-flags')).toContainText('EXPRESS');
      await expect(page.locator('#phase-label')).toHaveText('Rush hour');
    }
    if (await wrap.isVisible()) {
      if (index === 2) await wrap.click();
      else await page.keyboard.press('w');
      await expect(wrap).toBeDisabled();
      await expect(page.locator('#feedback')).toContainText('Wrapped and protected');
    }
    await page.keyboard.press(key);
    await expect(page.locator('#progress-label')).toHaveText(`${index + 1} / 13`);
    if (index === 3) await expect(page.locator('#feedback')).toContainText('including the express bonus');
  }
  await expect(page.getByRole('heading', { name: 'All parcels delivered!' })).toBeVisible();
  expect(Number((await page.locator('#result-score').textContent()).replaceAll(',', ''))).toBeGreaterThan(1000);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.getByRole('link', { name: 'Explore the workshop lab' }).click();
  await expect(page.locator('#live-results')).toContainText('Avg score');
});

test('the mistake limit ends gameplay with a replayable shift report', async ({ page, request, workshop }) => {
  const settings = await (await request.get(`${workshop}/api/settings`)).json();
  await request.put(`${workshop}/api/config`, { data: { ...settings.config, mistakeLimit: 1 } });
  await page.goto(workshop);
  await page.getByRole('button', { name: 'Start shift', exact: true }).click();
  await expect(page.locator('#active-screen')).toBeVisible();
  const name = await page.locator('#parcel-name').textContent();
  const wrong = ['Garden', 'Studio', 'Workshop'].find((destination) => destination !== name);
  await page.getByRole('button', { name: new RegExp(`^${wrong}, shortcut`) }).click();
  await expect(page.getByRole('heading', { name: 'The station needs a reset.' })).toBeFocused();
  await expect(page.locator('#active-screen')).toBeHidden();
  await page.getByRole('button', { name: 'Play another shift' }).click();
  await expect(page.locator('#active-screen')).toBeVisible();
  await expect(page.locator('#mistakes')).toHaveText('0 / 1');
});

test('courier selection persists, animated deliveries preserve scoring, and replays reset the scene', async ({ page, workshop }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(workshop);
  const pip = page.getByRole('button', { name: /Pip The tiny perfectionist/ });
  await pip.click();
  await expect(pip).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(pip).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#crew-status')).toContainText('Pip');
  await page.getByRole('button', { name: 'Start shift', exact: true }).click();
  await expect(page.locator('#crew-status')).toContainText('PIP / ON DUTY');
  await expect(page.getByRole('button', { name: 'Sound: off' })).toBeVisible();
  for (let i = 0; i < 8; i++) {
    const name = await page.locator('#parcel-name').textContent();
    await page.keyboard.press({ Garden: '1', Studio: '2', Workshop: '3' }[name]);
    await expect(page.locator('#progress-label')).toHaveText(`${i + 1} / 8`);
  }
  await expect(page.locator('#courier-verdict')).toContainText('Pip says: Flawless shift');
  await expect(page.locator('#courier-verdict')).toContainText('New personal best!');
  expect(await page.locator('#local-best').textContent()).not.toBe('PERSONAL BEST 0');
  await page.getByRole('button', { name: 'Play another shift' }).click();
  await expect(page.locator('#crew-status')).toContainText('PIP / ON DUTY');
  await expect(page.locator('#score')).toHaveText('0');
  await expect(page.locator('#courier-canvas')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the animated depot supports reduced motion and does not break a narrow screen', async ({ page, workshop }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(workshop);
  await page.getByRole('button', { name: /Bolt The sunshine speedster/ }).click();
  await expect(page.locator('#crew-status')).toContainText('Bolt');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.getByRole('button', { name: 'Start shift', exact: true }).click();
  const name = await page.locator('#parcel-name').textContent();
  const wrong = ['Garden', 'Studio', 'Workshop'].find(item => item !== name);
  await page.getByRole('button', { name: new RegExp(`^${wrong}, shortcut`) }).click();
  await expect(page.locator('#floor-message')).toContainText('Wrong bay');
  await expect(page.locator('#mistakes')).toHaveText('1 / no cap');
  await expect(page.locator('#destinations')).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('right-hand keys dispatch, W then dispatch is safe during a slow wrap, and held keys do not repeat', async ({ page, request, workshop }) => {
  const settings = await (await request.get(`${workshop}/api/settings`)).json();
  await request.put(`${workshop}/api/config`, { data: { ...settings.config, fragileParcels: true, mistakeLimit: 5 } });
  await page.goto(workshop);
  await page.getByRole('button', { name: 'Start shift', exact: true }).click();
  await expect(page.locator('#active-screen')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Garden, shortcut J', exact: true })).toBeVisible();
  const keys = { Garden: 'j', Studio: 'k', Workshop: 'l' };
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press(keys[await page.locator('#parcel-name').textContent()]);
    await expect(page.locator('#progress-label')).toHaveText(`${i + 1} / 8`);
  }
  await expect(page.locator('#phase-copy')).toContainText('1 clean delivery to x2');
  await expect(page.locator('#combo-progress')).toHaveJSProperty('value', 2);
  await expect(page.locator('#parcel-flags')).toContainText('FRAGILE');
  await page.route('**/api/rounds/*/wrap', async route => {
    await new Promise(resolve => setTimeout(resolve, 300));
    await route.continue();
  });
  const key = keys[await page.locator('#parcel-name').textContent()];
  await page.keyboard.press('w');
  await page.keyboard.press(key);
  await expect(page.locator('#progress-label')).toHaveText('3 / 8');
  await expect(page.locator('#mistakes')).toHaveText('0 / 5');
  await expect(page.locator('#feedback')).toContainText('Flow x2 unlocked!');
  await expect(page.locator('#streak')).toHaveText('3 / x2');
  await expect(page.locator('#phase-copy')).toContainText('3 clean deliveries to x3');
  await expect(page.locator('#combo-progress')).toHaveJSProperty('value', 0);
  const fourthKey = keys[await page.locator('#parcel-name').textContent()];
  await page.keyboard.down(fourthKey);
  await expect(page.locator('#progress-label')).toHaveText('4 / 8');
  const score = await page.locator('#score').textContent();
  await page.keyboard.down(fourthKey);
  await page.waitForTimeout(150);
  await expect(page.locator('#progress-label')).toHaveText('4 / 8');
  await expect(page.locator('#score')).toHaveText(score);
  await expect(page.locator('#mistakes')).toHaveText('0 / 5');
  await page.keyboard.up(fourthKey);
});

test('a failed wrap discards the queued dispatch and allows a clean retry', async ({ page, request, workshop }) => {
  const settings = await (await request.get(`${workshop}/api/settings`)).json();
  await request.put(`${workshop}/api/config`, { data: { ...settings.config, fragileParcels: true } });
  await page.goto(workshop);
  await page.getByRole('button', { name: 'Start shift', exact: true }).click();
  await expect(page.locator('#active-screen')).toBeVisible();
  const keys = { Garden: 'j', Studio: 'k', Workshop: 'l' };
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press(keys[await page.locator('#parcel-name').textContent()]);
    await expect(page.locator('#progress-label')).toHaveText(`${i + 1} / 8`);
  }
  await page.route('**/api/rounds/*/wrap', async route => {
    await new Promise(resolve => setTimeout(resolve, 300));
    await route.abort('failed');
  });
  await page.keyboard.press('w');
  await page.keyboard.press(keys[await page.locator('#parcel-name').textContent()]);
  await expect(page.locator('#page-message')).toContainText('Cannot reach the local workshop');
  await expect(page.locator('#progress-label')).toHaveText('2 / 8');
  await expect(page.locator('#wrap-button')).toBeEnabled();
  await page.unroute('**/api/rounds/*/wrap');
  await page.keyboard.press('w');
  await expect(page.locator('#wrap-button')).toBeDisabled();
  await expect(page.locator('#feedback')).toContainText('Wrapped and protected');
  await expect(page.locator('#progress-label')).toHaveText('2 / 8');
  await page.keyboard.press(keys[await page.locator('#parcel-name').textContent()]);
  await expect(page.locator('#progress-label')).toHaveText('3 / 8');
});
