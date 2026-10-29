import { test as base, expect } from '@playwright/test';
import { mkdtemp, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../../server.js';

const test = base.extend({ arena: async ({}, use) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'parcel-arena-browser-'));
  const configFile = path.join(dir, 'config.json');
  await copyFile(new URL('../fixtures/config.json', import.meta.url), configFile);
  let clock = 1800000000000;
  const app = await createApp({ dataDir: path.join(dir, 'local'), configFile, now: () => clock });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  try { await use({ url: `http://127.0.0.1:${server.address().port}/arena.html`, advance(ms) { clock += ms; } }); }
  finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await rm(dir, { recursive: true, force: true }); }
} });
const keys = { Garden: 'j', Studio: 'k', Workshop: 'l' };

test('orbital artwork loads, focus view stays playable, and leaving a run restores navigation on a phone', async ({ page, arena }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(arena.url);
  await expect(page.getByRole('button', { name: 'Climb the levels' })).toBeEnabled();
  await page.waitForFunction(() => document.querySelector('.future-hero-art img').naturalWidth > 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.getByRole('button', { name: 'Climb the levels' }).click();
  await expect(page.locator('#play-zone')).toBeVisible();
  await page.getByRole('button', { name: 'Focus view', exact: true }).click();
  await expect(page.locator('.arena-heading')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Exit focus view' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press(keys[await page.locator('#arena-parcel-name').textContent()]);
  await expect(page.locator('#arena-score')).toHaveText('100');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.getByRole('button', { name: 'Bank score & finish' }).click();
  await page.getByRole('button', { name: 'Back to lobby' }).click();
  await expect(page.locator('.arena-heading')).toBeVisible();
  await expect(page.locator('.site-header')).toBeVisible();
  await page.goto(arena.url.replace('arena.html', 'classic.html'));
  await page.getByRole('button', { name: 'Start shift', exact: true }).click();
  await expect(page.locator('#active-screen')).toBeVisible();
  await page.getByRole('button', { name: 'Focus view', exact: true }).click();
  await expect(page.locator('.site-header')).toBeHidden();
  await page.getByRole('button', { name: 'End this shift' }).click();
  await expect(page.locator('.site-header')).toBeVisible();
});

test('the full 220-level map repeats bosses and super bosses without unlocking unplayed levels', async ({ page, arena }) => {
  await page.goto(arena.url);
  await expect(page.getByRole('button', { name: 'Climb the levels' })).toBeEnabled();
  await expect(page.locator('#campaign-progress')).toHaveText('0 / 220 levels cleared');
  await expect(page.getByRole('button', { name: 'Previous 20 levels' })).toBeDisabled();
  await page.getByLabel('Browse campaign levels').selectOption('1');
  await expect(page.locator('.level-chip').filter({ hasText: /^30BOSS$/ })).toHaveCount(1);
  await expect(page.locator('.level-chip').filter({ hasText: /^40SUPER$/ })).toHaveCount(1);
  await page.getByLabel('Browse campaign levels').selectOption('10');
  await expect(page.locator('.level-chip').filter({ hasText: /^210BOSS$/ })).toHaveCount(1);
  await expect(page.locator('.level-chip').filter({ hasText: /^220SUPER$/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Next 20 levels' })).toBeDisabled();
  await page.getByRole('button', { name: 'Previous 20 levels' }).click();
  await expect(page.locator('#map-range')).toHaveValue('9');
  await page.getByRole('button', { name: 'Climb the levels' }).click();
  await expect(page.locator('#arena-level')).toHaveText('1');
  await expect(page.locator('#map-range')).toHaveValue('0');
  await page.getByLabel('Browse campaign levels').selectOption('1');
  await page.getByRole('button', { name: 'Garden, shortcut J', exact: true }).focus();
  await page.keyboard.press(keys[await page.locator('#arena-parcel-name').textContent()]);
  await expect(page.locator('#arena-score')).toHaveText('100');
  await expect(page.locator('#map-range')).toHaveValue('1');
});

test('a player climbs levels, sees five lives, banks a score and appears on the leaderboard', async ({ page, arena }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(arena.url);
  await expect(page.getByRole('button', { name: 'Climb the levels' })).toBeEnabled();
  const name = await page.locator('#player-name').textContent();
  await page.getByRole('button', { name: 'Climb the levels' }).click();
  await expect(page.locator('#arena-lives')).toHaveText('5 / 5');
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press(keys[await page.locator('#arena-parcel-name').textContent()]);
    if (i < 5) await expect(page.locator('#arena-parcel-count')).toHaveText(`PARCEL ${i + 2} OF 6`);
  }
  await expect(page.locator('#transition-title')).toHaveText('Level 1 cleared!');
  await page.getByRole('button', { name: 'Play level 2' }).click();
  await expect(page.locator('#arena-level')).toHaveText('2');
  await page.reload();
  await expect(page.locator('#arena-level')).toHaveText('2');
  await page.getByRole('button', { name: 'Bank score & finish' }).click();
  await expect(page.locator('#transition-title')).toContainText('Score banked');
  await expect(page.locator('#leaderboard')).toContainText(name);
  await expect(page.locator('#leaderboard')).toContainText('Level 1 cleared');
  expect(errors).toEqual([]);
});

test('two real browser players ready up, see live scores, and settle a forfeit on the PvP leaderboard', async ({ browser, page, arena }) => {
  const context2 = await browser.newContext(); const rival = await context2.newPage();
  try {
    await page.goto(arena.url);
    await page.getByRole('button', { name: 'Create PvP room' }).click();
    const code = await page.locator('#room-display').textContent();
    await rival.goto(arena.url);
    await rival.getByRole('textbox', { name: 'Room code' }).fill(code);
    await rival.getByRole('button', { name: 'Join room', exact: true }).click();
    await page.getByRole('button', { name: 'Ready to compete' }).click();
    await rival.getByRole('button', { name: 'Ready to compete' }).click();
    await expect(rival.locator('#room-status')).toContainText('Starting in');
    arena.advance(3000);
    await expect(page.locator('#play-zone')).toBeVisible();
    await expect(rival.locator('#play-zone')).toBeVisible();
    const parcel = await page.locator('#arena-parcel-name').textContent();
    await expect(rival.locator('#arena-parcel-name')).toHaveText(parcel);
    await page.keyboard.press(keys[parcel]);
    await expect(page.locator('#arena-score')).toHaveText('100');
    await expect(rival.locator('#opponent-score')).toContainText('100 pts');
    await rival.getByRole('button', { name: 'Forfeit match' }).click();
    await expect(page.locator('#transition-title')).toHaveText('You won the duel!');
    await expect(rival.locator('#transition-title')).toHaveText('Your rival takes this one.');
    await page.getByRole('button', { name: 'PvP wins', exact: true }).click();
    await expect(page.locator('#leaderboard')).toContainText('1 W');
    await expect(page.locator('#leaderboard')).toContainText('1 losses');
  } finally { await context2.close(); }
});

test('level 20 displays the super boss and its shield, while narrow layouts and reduced motion remain usable', async ({ page, arena }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(arena.url);
  await page.getByRole('button', { name: 'Climb the levels' }).click();
  await expect(page.locator('#play-zone')).toBeVisible();
  const token = await page.evaluate(() => localStorage.getItem('parcel-pals-arena-token'));
  const base = arena.url.replace('/arena.html', '/api/competitive');
  const headers = { Authorization: `Bearer ${token}` };
  const me = await (await page.request.get(`${base}/me`, { headers })).json();
  let r = await (await page.request.get(`${base}/runs/${me.active.id}`, { headers })).json();
  while (r.level < 20) {
    while (r.status === 'playing') {
      const action = r.parcel.fragile && !r.parcel.wrapped ? 'wrap' : 'dispatch';
      const response = await page.request.post(`${base}/runs/${r.id}/action`, { headers,
        data: { action, revision: r.revision, parcelId: r.parcel.id, destination: r.parcel.destination } });
      expect(response.ok()).toBeTruthy(); r = await response.json();
    }
    r = await (await page.request.post(`${base}/runs/${r.id}/next`, { headers, data: { revision: r.revision } })).json();
  }
  await expect(page.locator('#arena-level')).toHaveText('20');
  await expect(page.locator('#boss-name')).toHaveText('MEGA SORTMASTER / SUPER BOSS');
  await expect(page.locator('#boss-health')).toHaveJSProperty('value', r.rules.parcelCount);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await expect(page.getByRole('button', { name: 'Garden, shortcut J', exact: true })).toBeVisible();
});

test('the second-player test link creates a separate guest identity in the same browser', async ({ page, context, arena }) => {
  await page.goto(arena.url);
  await page.getByRole('button', { name: 'Create PvP room' }).click();
  const name = await page.locator('#player-name').textContent();
  const code = await page.locator('#room-display').textContent();
  const popupPromise = context.waitForEvent('page');
  await page.getByRole('link', { name: 'Open player 2 to test' }).click();
  const guest = await popupPromise;
  await expect(guest.getByRole('button', { name: 'Join room', exact: true })).toBeEnabled();
  expect(await guest.locator('#player-name').textContent()).not.toBe(name);
  await expect(guest.locator('#room-code')).toHaveValue(code);
  await guest.getByRole('button', { name: 'Join room', exact: true }).click();
  await expect(page.locator('#room-players .room-player')).toHaveCount(2);
  await guest.close();
});
