import { test, expect } from '@playwright/test';
import { mkdtemp, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../../server.js';

test('the free hosted demo opens the arena, explains temporary scores, and keeps classic play available', async ({ page }) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'parcel-public-browser-'));
  const configFile = path.join(dir, 'config.json');
  await copyFile(new URL('../fixtures/config.json', import.meta.url), configFile);
  const app = await createApp({ dataDir: path.join(dir, 'local'), configFile, publicDemo: true, ephemeral: true });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await expect(page).toHaveURL(/arena\.html$/);
    await expect(page.locator('#hosting-notice')).toBeVisible();
    await expect(page.locator('#hosting-notice')).toContainText('scores and player records may reset');
    await expect(page.locator('.leaderboard-panel > p:last-child')).toContainText('Records may reset');
    await page.getByRole('button', { name: 'Create PvP room' }).click();
    await expect(page.locator('#room-panel > p.small')).toContainText('Both players use this website');
    await page.getByRole('button', { name: 'Leave room', exact: true }).click();
    await page.getByRole('link', { name: 'Classic game', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Workshop lab', exact: true })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Start shift', exact: true })).toBeEnabled();
    await expect(page.locator('#play-mode')).toContainText('Online demo');
    await page.getByRole('button', { name: 'Start shift', exact: true }).click();
    await expect(page.locator('#active-screen')).toBeVisible();
    const name = await page.locator('#parcel-name').textContent();
    await page.keyboard.press({ Garden: 'j', Studio: 'k', Workshop: 'l' }[name]);
    await expect(page.locator('#progress-label')).toHaveText('1 / 8');
    expect(errors).toEqual([]);
  } finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await rm(dir, { recursive: true, force: true }); }
});
