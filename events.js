import { invalid } from './experiments.js';

export const DESTINATIONS = [
  { id: 'garden', name: 'Garden', icon: '/assets/leaf.svg', shortcut: '1' },
  { id: 'studio', name: 'Studio', icon: '/assets/star.svg', shortcut: '2' },
  { id: 'workshop', name: 'Workshop', icon: '/assets/bolt.svg', shortcut: '3' }
];

export function scoreMultiplier(streak) {
  return 1 + Math.min(3, Math.floor(streak / 3));
}

export function buildRound(events, id, now = Date.now()) {
  const history = events.filter((event) => event.roundId === id);
  const start = history.find((event) => event.type === 'round_started');
  if (!start) throw invalid('Round not found. Workshop data may have been reset.', 404);
  const attempts = history.filter((event) => event.type === 'parcel_sorted');
  const hints = history.filter((event) => event.type === 'hint_used');
  const wraps = history.filter((event) => event.type === 'parcel_wrapped');
  const end = history.find((event) => event.type === 'round_ended');
  const deadline = Date.parse(start.at) + start.config.roundSeconds * 1000;
  const expired = now >= deadline;
  const status = end?.status ?? (expired ? 'timed_out' : 'playing');
  const endedAt = end ? Date.parse(end.at) : expired ? deadline : now;
  let score = 0;
  let streak = 0;
  let bestStreak = 0;
  let parcelStartedAt = Date.parse(start.at);
  for (const attempt of attempts) {
    streak = attempt.correct ? streak + 1 : 0;
    bestStreak = Math.max(bestStreak, streak);
    score = Math.max(0, score + (attempt.points ?? (attempt.correct ? 100 : 0)));
    if (attempt.correct) parcelStartedAt = Date.parse(attempt.at);
  }
  const sorted = attempts.filter((event) => event.correct).length;
  const current = start.parcels[sorted];
  const mistakes = attempts.length - sorted;
  const expressWindow = (start.config.expressBonusSeconds ?? 4) * 1000;
  return {
    ...start,
    status,
    sorted,
    attempts: attempts.length,
    mistakes,
    mistakesRemaining: start.config.mistakeLimit ? Math.max(0, start.config.mistakeLimit - mistakes) : null,
    score,
    streak,
    bestStreak,
    multiplier: scoreMultiplier(streak),
    wrappedParcels: wraps.map((event) => event.parcelId),
    expressRemainingMs: status === 'playing' && current?.express
      ? Math.max(0, parcelStartedAt + expressWindow - now) : 0,
    hints: hints.length,
    hintedParcels: hints.map((event) => event.parcelId),
    remainingMs: status === 'playing' ? Math.max(0, deadline - now) : 0,
    durationSeconds: Math.max(0, (endedAt - Date.parse(start.at)) / 1000)
  };
}

export function publicRound(round) {
  return {
    id: round.roundId,
    config: round.config,
    experimentId: round.experimentId,
    experimentName: round.experimentName,
    variant: round.variant,
    preview: round.preview,
    parcels: round.parcels,
    status: round.status,
    sorted: round.sorted,
    attempts: round.attempts,
    hints: round.hints,
    mistakes: round.mistakes,
    mistakesRemaining: round.mistakesRemaining,
    score: round.score,
    streak: round.streak,
    bestStreak: round.bestStreak,
    multiplier: round.multiplier,
    wrappedParcels: round.wrappedParcels,
    expressRemainingMs: round.expressRemainingMs,
    remainingMs: round.remainingMs,
    durationSeconds: round.durationSeconds
  };
}

export function wilson(successes, n) {
  if (!n) return null;
  const z = 1.96;
  const p = successes / n;
  const divisor = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / divisor;
  const margin = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / divisor;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

export function summarizeParticipants(participants) {
  const resolved = participants.filter((item) => item.status !== 'playing');
  const completed = resolved.filter((item) => item.status === 'completed');
  const unassisted = completed.filter((item) => item.hints === 0);
  const attempts = resolved.reduce((total, item) => total + item.attempts, 0);
  const correct = resolved.reduce((total, item) => total + item.sorted, 0);
  const average = (items, key) => items.length
    ? items.reduce((total, item) => total + item[key], 0) / items.length : null;
  return {
    players: participants.length,
    resolved: resolved.length,
    pending: participants.length - resolved.length,
    completed: completed.length,
    unassisted: unassisted.length,
    completionRate: resolved.length ? completed.length / resolved.length : null,
    completionInterval: wilson(completed.length, resolved.length),
    unassistedRate: resolved.length ? unassisted.length / resolved.length : null,
    accuracy: attempts ? correct / attempts : null,
    averageSeconds: average(resolved, 'durationSeconds'),
    averageCompletedSeconds: average(completed, 'durationSeconds'),
    averageHints: average(resolved, 'hints'),
    averageScore: average(resolved.filter((item) => typeof item.score === 'number'), 'score')
  };
}

export function summarizeLive(events, now = Date.now()) {
  const starts = events.filter((event) => event.type === 'round_started');
  const groups = new Map();
  const seen = new Set();
  for (const start of starts.filter((event) => !event.preview)) {
    const cohort = start.experimentId ?? `baseline-${start.configVersion}`;
    const participant = `${cohort}:${start.playerId}`;
    if (seen.has(participant)) continue;
    seen.add(participant);
    const key = `${cohort}:${start.variant}`;
    if (!groups.has(key)) {
      groups.set(key, {
        experimentId: start.experimentId,
        name: start.experimentId ? start.experimentName : `No experiment (config ${start.configVersion})`,
        variant: start.variant,
        participants: []
      });
    }
    groups.get(key).participants.push(buildRound(events, start.roundId, now));
  }
  return {
    totalRounds: starts.filter((event) => !event.preview).length,
    previewRounds: starts.filter((event) => event.preview).length,
    eventCount: events.length,
    cohorts: [...groups.values()].map(({ participants, ...group }) => ({
      ...group, ...summarizeParticipants(participants)
    }))
  };
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function eventsCsv(events) {
  const fields = [
    'at', 'type', 'roundId', 'playerId', 'experimentId', 'variant', 'preview',
    'configVersion', 'parcelId', 'destination', 'correct', 'status', 'reason', 'points', 'expressBonus'
  ];
  return [fields.join(','), ...events.map((event) =>
    fields.map((field) => csvCell(event[field])).join(',')
  )].join('\n') + '\n';
}
