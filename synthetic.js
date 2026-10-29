import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { summarizeParticipants } from './events.js';
import { readJson } from './storage.js';

const HEADER = 'player_id,variant,completed,round_seconds,attempts,correct_attempts,hints_used';

export function parseSynthetic(csv) {
  const [header, ...lines] = csv.trim().split(/\r?\n/);
  if (header !== HEADER) throw new Error('Synthetic CSV has an unexpected header.');
  const ids = new Set();
  return lines.map((line) => {
    const [playerId, variant, ...raw] = line.split(',');
    const [completed, durationSeconds, attempts, sorted, hints] = raw.map(Number);
    if (ids.has(playerId) || !/^fictional-[a-z]+-\d+$/.test(playerId) ||
        !['A', 'B'].includes(variant) || raw.length !== 5 ||
        raw.some((value) => value.trim() === '' || !Number.isFinite(Number(value))) ||
        ![0, 1].includes(completed) || durationSeconds <= 0 ||
        ![attempts, sorted, hints].every((value) => Number.isInteger(value) && value >= 0) ||
        sorted > attempts || sorted > 8 || hints > Math.min(8, sorted + 1) || (completed === 1 && sorted !== 8) ||
        (completed === 0 && sorted === 8)) {
      throw new Error(`Invalid synthetic participant row: ${line}`);
    }
    ids.add(playerId);
    return {
      playerId, variant, status: completed ? 'completed' : 'timed_out',
      durationSeconds, attempts, sorted, hints
    };
  });
}

export async function loadSynthetic(directory) {
  const catalog = await readJson(path.join(directory, 'catalog.json'));
  return Promise.all(catalog.map(async (item) => {
    const csv = await readFile(path.join(directory, `${item.id}.csv`), 'utf8');
    const participants = parseSynthetic(csv);
    for (const player of participants) {
      if (player.durationSeconds > item.roundSeconds[player.variant] ||
          (player.status === 'timed_out' && player.durationSeconds !== item.roundSeconds[player.variant])) {
        throw new Error(`Synthetic round duration does not match ${item.id}'s timer.`);
      }
    }
    return {
      ...item,
      synthetic: true,
      csv,
      variants: ['A', 'B'].map((variant) => ({
        variant,
        label: item[variant.toLowerCase()],
        ...summarizeParticipants(participants.filter((player) => player.variant === variant))
      }))
    };
  }));
}
