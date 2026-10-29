import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../data/synthetic/', import.meta.url));
let seed = 20261029;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
}

const scenarios = [
  { id: 'welcome', n: 200, completion: [0.59, 0.81], hint: [0.35, 0.18], time: [27, 25], limit: [45, 45] },
  { id: 'hints', n: 12, completion: [0.58, 0.7], hint: [0.25, 0.55], time: [29, 28], limit: [45, 45] },
  { id: 'timer', n: 160, completion: [0.64, 0.85], hint: [0.3, 0.3], time: [30, 52], limit: [45, 75] }
];

for (const scenario of scenarios) {
  const lines = ['player_id,variant,completed,round_seconds,attempts,correct_attempts,hints_used'];
  for (const [group, variant] of ['A', 'B'].entries()) {
    const outcomes = Array.from({ length: scenario.n }, (_, index) =>
      Number(index < Math.round(scenario.n * scenario.completion[group]))
    );
    for (let index = outcomes.length - 1; index > 0; index--) {
      const other = Math.floor(random() * (index + 1));
      [outcomes[index], outcomes[other]] = [outcomes[other], outcomes[index]];
    }
    for (let index = 0; index < scenario.n; index++) {
      const completed = outcomes[index];
      const correct = completed ? 8 : Math.floor(random() * 7);
      const attempts = correct + Math.floor(random() * 5);
      const hints = random() < scenario.hint[group] ? Math.min(correct + 1, 1 + Math.floor(random() * 2)) : 0;
      const duration = completed
        ? scenario.time[group] + Math.floor(random() * 13) - 6
        : scenario.limit[group];
      const id = `fictional-${scenario.id}-${group * scenario.n + index + 1}`;
      lines.push([id, variant, completed, duration, attempts, correct, hints].join(','));
    }
  }
  await writeFile(path.join(directory, `${scenario.id}.csv`), lines.join('\n') + '\n');
  console.log(`Generated ${scenario.id}.csv (${scenario.n * 2} fictional players).`);
}
