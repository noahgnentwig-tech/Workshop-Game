import express from 'express';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeJson } from './storage.js';
import { invalid } from './experiments.js';
import { DESTINATIONS, scoreMultiplier } from './events.js';
import { CAMPAIGN_LEVELS } from './public/arena-rules.js';
export { CAMPAIGN_LEVELS } from './public/arena-rules.js';

const CREW = ['nova', 'bolt', 'pip'];
const MATCH_MS = 120000;
const MAX_LIVES = 5;
const hash = value => createHash('sha256').update(value).digest('hex');

export function levelRules(level) {
  if (!Number.isSafeInteger(level) || level < 1 || level > CAMPAIGN_LEVELS) throw invalid('Invalid level.');
  const kind = level % 20 === 0 ? 'super_boss' : level % 10 === 0 ? 'boss' : 'normal';
  const count = Math.min(24, 6 + Math.floor((level - 1) / 2)) + (kind === 'super_boss' ? 8 : kind === 'boss' ? 4 : 0);
  const pace = 4.5 - Math.min(2.8, (level - 1) * .085);
  return { level, kind, parcelCount: count,
    seconds: Math.max(14, Math.round(count * pace * (kind === 'super_boss' ? .66 : kind === 'boss' ? .8 : 1))),
    fragileRate: Math.min(.5, Math.max(0, (level - 2) * .035)) + (kind === 'normal' ? 0 : .15),
    expressRate: Math.min(.55, Math.max(0, (level - 4) * .025)) + (kind === 'super_boss' ? .15 : 0),
    expressSeconds: Math.max(1.4, 4 - level * .07), rewardLives: kind === 'super_boss' ? 2 : kind === 'boss' ? 1 : 0 };
}

export function levelParcels(seed, level) {
  const rules = levelRules(level);
  let n = parseInt(hash(`${seed}:${level}`).slice(0, 8), 16);
  const random = () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; };
  return Array.from({ length: rules.parcelCount }, (_, i) => ({
    id: `${level}-${i}`, destination: DESTINATIONS[Math.floor(random() * 3)].id,
    fragile: random() < rules.fragileRate, express: random() < rules.expressRate
  }));
}

export async function createCompetitiveRouter({ dataDir, now = Date.now }) {
  const directory = path.join(dataDir, 'competitive');
  const file = path.join(directory, 'players.json');
  await mkdir(directory, { recursive: true });
  let profiles = [];
  try {
    profiles = JSON.parse(await readFile(file, 'utf8'));
    if (!Array.isArray(profiles) || profiles.some(p => typeof p.key !== 'string' || typeof p.id !== 'string')) throw new Error('Invalid competitive player data.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const runs = new Map(), rooms = new Map(), active = new Map();
  let queue = Promise.resolve();
  const save = () => writeJson(file, profiles);
  const router = express.Router();
  // All reads that advance a deadline and all writes share one mutation queue.
  const route = handler => (req, res, next) => {
    const result = queue.then(() => handler(req, res));
    queue = result.catch(() => {}); result.catch(next);
  };
  function profile(req) {
    const token = req.get('authorization')?.replace(/^Bearer /, '');
    if (!token || !/^[a-f0-9]{64}$/.test(token)) throw invalid('Reconnect to the arena to create your player.', 401);
    const p = profiles.find(item => item.key === hash(token));
    if (!p) throw invalid('Player session not found. Reconnect to the arena.', 401);
    return p;
  }
  const publicProfile = p => ({ id: p.id, name: p.name, crew: p.crew });
  function makeRun(p, seed, mode, at) {
    const r = { id: randomUUID(), playerId: p.id, seed, mode, level: 1, cleared: 0,
      lives: MAX_LIVES, banked: 0, levelScore: 0, streak: 0, bestStreak: 0, delivered: 0,
      mistakes: 0, revision: 0, recorded: false, startedAt: at };
    loadLevel(r, at); runs.set(r.id, r); return r;
  }
  function loadLevel(r, at) {
    r.rules = levelRules(r.level); r.parcels = levelParcels(r.seed, r.level);
    r.sorted = 0; r.wrapped = false; r.levelScore = 0; r.streak = 0;
    r.deadline = at + r.rules.seconds * 1000; r.parcelAt = at;
    r.status = 'playing'; r.revision++;
  }
  function score(r) { return r.banked + r.levelScore; }
  function tickRun(r, at) {
    if (r.status === 'playing' && at >= r.deadline) {
      r.lives--; r.levelScore = 0; r.streak = 0; r.revision++;
      r.status = r.lives ? 'retry' : 'finished'; r.reason = 'timeout';
      r.transitionAt = at + 1800;
    }
    if (r.mode === 'pvp' && ['level_clear', 'retry'].includes(r.status) && at >= r.transitionAt) {
      if (r.status === 'level_clear') r.level++;
      loadLevel(r, at);
    }
  }
  function publicRun(r, at) {
    return { id: r.id, mode: r.mode, status: r.status, level: r.level, cleared: r.cleared,
      lives: r.lives, score: score(r), streak: r.streak, multiplier: scoreMultiplier(r.streak),
      bestStreak: r.bestStreak, delivered: r.delivered, mistakes: r.mistakes,
      sorted: r.sorted, rules: r.rules, parcel: r.status === 'playing' ? { ...r.parcels[r.sorted], wrapped: r.wrapped } : null,
      next: r.status === 'playing' ? r.parcels.slice(r.sorted + 1, r.sorted + 3).map(p => ({ destination: p.destination, fragile: p.fragile, express: p.express })) : [],
      remainingMs: r.status === 'playing' ? Math.max(0, r.deadline - at) : 0,
      expressRemainingMs: Math.max(0, r.parcelAt + r.rules.expressSeconds * 1000 - at),
      transitionMs: Math.max(0, (r.transitionAt || 0) - at), revision: r.revision, reason: r.reason };
  }
  async function recordSolo(r) {
    if (r.recorded || r.status !== 'finished') return;
    const p = profiles.find(p => p.id === r.playerId), previous = structuredClone(p);
    p.soloRuns = (p.soloRuns || 0) + 1;
    if (!p.best || r.cleared > p.best.level || r.cleared === p.best.level && score(r) > p.best.score) {
      p.best = { level: r.cleared, score: score(r), streak: r.bestStreak, at: new Date(now()).toISOString() };
    }
    try { await save(); } catch (e) {
      for (const key of Object.keys(p)) delete p[key];
      Object.assign(p, previous); throw e;
    }
    r.recorded = true;
    if (active.get(p.id)?.id === r.id) active.delete(p.id);
  }
  function findRoom(code) {
    const room = rooms.get(String(code).toUpperCase());
    if (!room) throw invalid('Room not found. Check the code or create a new room.', 404);
    return room;
  }
  async function recordRoom(room) {
    if (room.recorded || room.status !== 'finished') return;
    const old = structuredClone(profiles);
    for (const member of room.players) {
      const p = profiles.find(p => p.id === member.id);
      p.matches = (p.matches || 0) + 1;
      if (!room.winner) p.draws = (p.draws || 0) + 1;
      else if (room.winner === p.id) p.wins = (p.wins || 0) + 1;
      else p.losses = (p.losses || 0) + 1;
    }
    try { await save(); } catch (e) { profiles = old; throw e; }
    room.recorded = true;
    for (const p of room.players) if (active.get(p.id)?.id === room.code) active.delete(p.id);
  }
  async function tickRoom(room) {
    const at = now();
    if (room.status === 'waiting' && at - room.createdAt >= 15 * 60000) {
      room.status = 'cancelled';
      for (const p of room.players) if (active.get(p.id)?.id === room.code) active.delete(p.id);
    }
    if (room.status === 'countdown' && at >= room.startAt) room.status = 'playing';
    if (room.status === 'playing') {
      for (const p of room.players) tickRun(runs.get(p.runId), Math.min(at, room.endAt));
      if (at >= room.endAt || room.players.every(p => runs.get(p.runId).status === 'finished')) {
        room.status = 'finished'; room.reason = 'time';
        const [a, b] = room.players;
        const difference = score(runs.get(a.runId)) - score(runs.get(b.runId));
        room.winner = difference === 0 ? null : difference > 0 ? a.id : b.id;
        for (const p of room.players) { const r = runs.get(p.runId); r.status = 'finished'; r.revision++; }
      }
    }
    await recordRoom(room);
  }
  function roomView(room, p) {
    return { code: room.code, status: room.status, winner: room.winner, reason: room.reason,
      countdownMs: Math.max(0, (room.startAt || 0) - now()),
      remainingMs: Math.max(0, (room.endAt || 0) - now()),
      players: room.players.map(member => {
        const r = runs.get(member.runId);
        return { ...publicProfile(profiles.find(p => p.id === member.id)), ready: member.ready,
          score: r ? score(r) : 0, level: r?.level || 1, lives: r?.lives ?? MAX_LIVES,
          delivered: r?.delivered || 0, status: r?.status || 'waiting' };
      }), you: room.players.find(member => member.id === p.id)?.runId
        ? publicRun(runs.get(room.players.find(member => member.id === p.id).runId), now()) : null };
  }
  async function cleanActive(p) {
    const ref = active.get(p.id);
    if (ref?.type === 'room') await tickRoom(findRoom(ref.id));
    else if (ref) { const r = runs.get(ref.id); tickRun(r, now()); await recordSolo(r); }
    if (active.has(p.id)) throw invalid('Finish or leave your current game before starting another.', 409);
  }
  async function runFor(req, p) {
    const r = runs.get(req.params.id);
    if (!r || r.playerId !== p.id) throw invalid('Your run was not found. Return to the arena lobby.', 404);
    if (r.mode === 'pvp') {
      const room = findRoom(r.roomCode); await tickRoom(room);
      if (!['playing', 'finished'].includes(room.status)) throw invalid('Wait for the shared countdown to finish.', 409);
    } else { tickRun(r, now()); await recordSolo(r); }
    return r;
  }
  function applyAction(r, body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('Send an action as JSON.');
    if (r.status !== 'playing') throw invalid('This level has ended. Refresh the game state.', 409);
    if (body.revision !== r.revision || body.parcelId !== r.parcels[r.sorted].id) throw invalid('That parcel has already changed. Try your next action.', 409);
    const parcel = r.parcels[r.sorted];
    if (body.action === 'wrap') {
      if (!parcel.fragile || r.wrapped) throw invalid('This parcel does not need wrapping.', 409);
      r.wrapped = true; r.revision++; return { correct: true, kind: 'wrapped', points: 0 };
    }
    if (body.action !== 'dispatch' || !DESTINATIONS.some(d => d.id === body.destination)) throw invalid('Choose a valid dispatch destination.');
    r.revision++;
    const correct = parcel.destination === body.destination && (!parcel.fragile || r.wrapped);
    if (!correct) {
      r.lives--; r.mistakes++; r.streak = 0;
      r.levelScore = Math.max(0, r.levelScore - 25);
      if (!r.lives) { r.status = 'finished'; r.reason = 'lives'; }
      return { correct: false, kind: parcel.fragile && !r.wrapped ? 'needs_wrapping' : 'wrong_bay', points: -25 };
    }
    r.streak++; r.bestStreak = Math.max(r.streak, r.bestStreak); r.delivered++; r.sorted++;
    const express = parcel.express && now() < r.parcelAt + r.rules.expressSeconds * 1000;
    const points = 100 * scoreMultiplier(r.streak) + (express ? 75 : 0);
    r.levelScore += points; r.wrapped = false; r.parcelAt = now();
    if (r.sorted === r.rules.parcelCount) {
      r.cleared = r.level; r.banked += r.levelScore; r.levelScore = 0;
      r.lives = Math.min(MAX_LIVES, r.lives + r.rules.rewardLives);
      r.status = 'level_clear'; r.transitionAt = now() + 1800; r.reason = 'cleared';
      if (r.level === CAMPAIGN_LEVELS) { r.status = 'finished'; r.reason = 'completed'; }
    }
    return { correct: true, kind: express ? 'express' : 'delivered', points };
  }

  router.post('/session', route(async (req, res) => {
    const p = { id: randomUUID(), key: '', name: '', crew: CREW.includes(req.body?.crew) ? req.body.crew : 'nova' };
    if (profiles.length >= 2000) throw invalid('This arena has reached its player limit.', 503);
    const token = randomBytes(32).toString('hex'); p.key = hash(token);
    p.name = `${p.crew[0].toUpperCase() + p.crew.slice(1)}-${p.id.slice(0, 4).toUpperCase()}`;
    profiles.push(p);
    try { await save(); } catch (e) { profiles.pop(); throw e; }
    res.status(201).json({ token, player: publicProfile(p) });
  }));
  router.get('/me', route(async (req, res) => {
    const p = profile(req), ref = active.get(p.id);
    if (ref?.type === 'room') await tickRoom(findRoom(ref.id));
    else if (ref) { const r = runs.get(ref.id); tickRun(r, now()); await recordSolo(r); }
    res.json({ player: publicProfile(p), active: active.get(p.id) || null });
  }));
  router.get('/leaderboard', route(async (req, res) => {
    for (const room of rooms.values()) await tickRoom(room);
    for (const r of runs.values()) if (r.mode === 'solo') { tickRun(r, now()); await recordSolo(r); }
    res.json({ solo: profiles.filter(p => p.best).sort((a, b) => b.best.level - a.best.level || b.best.score - a.best.score).slice(0, 20)
      .map(p => ({ ...publicProfile(p), ...p.best, runs: p.soloRuns })),
    pvp: profiles.filter(p => p.matches).sort((a, b) => (b.wins || 0) - (a.wins || 0) || (a.losses || 0) - (b.losses || 0)).slice(0, 20)
      .map(p => ({ ...publicProfile(p), wins: p.wins || 0, losses: p.losses || 0, draws: p.draws || 0, matches: p.matches })) });
  }));
  router.post('/solo', route(async (req, res) => {
    const p = profile(req); await cleanActive(p);
    const r = makeRun(p, randomBytes(12).toString('hex'), 'solo', now());
    active.set(p.id, { type: 'solo', id: r.id }); res.status(201).json(publicRun(r, now()));
  }));
  router.get('/runs/:id', route(async (req, res) => {
    const r = await runFor(req, profile(req)); res.json(publicRun(r, now()));
  }));
  router.post('/runs/:id/action', route(async (req, res) => {
    const r = await runFor(req, profile(req));
    const result = applyAction(r, req.body);
    if (r.mode === 'solo') await recordSolo(r); else await tickRoom(findRoom(r.roomCode));
    res.json({ ...publicRun(r, now()), result });
  }));
  router.post('/runs/:id/next', route(async (req, res) => {
    const r = await runFor(req, profile(req));
    if (r.mode !== 'solo' || !['retry', 'level_clear'].includes(r.status)) throw invalid('The next level is not ready.', 409);
    if (req.body?.revision !== r.revision) throw invalid('This level has already changed.', 409);
    if (r.status === 'level_clear') r.level++;
    loadLevel(r, now()); res.json(publicRun(r, now()));
  }));
  router.post('/runs/:id/finish', route(async (req, res) => {
    const r = await runFor(req, profile(req));
    if (r.mode !== 'solo') throw invalid('Use Leave match to forfeit a duel.');
    if (r.status !== 'finished') { r.status = 'finished'; r.reason = 'banked'; r.revision++; }
    await recordSolo(r); res.json(publicRun(r, now()));
  }));
  router.post('/rooms', route(async (req, res) => {
    const p = profile(req); await cleanActive(p);
    let code;
    do { code = randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(code));
    const room = { code, seed: randomBytes(12).toString('hex'), status: 'waiting', createdAt: now(), players: [{ id: p.id, ready: false }] };
    rooms.set(code, room); active.set(p.id, { type: 'room', id: code });
    res.status(201).json(roomView(room, p));
  }));
  router.post('/rooms/:code/join', route(async (req, res) => {
    const p = profile(req), room = findRoom(req.params.code); await tickRoom(room);
    if (room.players.some(member => member.id === p.id)) return res.json(roomView(room, p));
    await cleanActive(p);
    if (room.status !== 'waiting' || room.players.length >= 2) throw invalid('This room is full or has already started.', 409);
    room.players.push({ id: p.id, ready: false }); active.set(p.id, { type: 'room', id: room.code });
    res.json(roomView(room, p));
  }));
  router.get('/rooms/:code', route(async (req, res) => {
    const p = profile(req), room = findRoom(req.params.code);
    if (!room.players.some(member => member.id === p.id)) throw invalid('Join this room first.', 403);
    await tickRoom(room); res.json(roomView(room, p));
  }));
  router.post('/rooms/:code/ready', route(async (req, res) => {
    const p = profile(req), room = findRoom(req.params.code); await tickRoom(room);
    const member = room.players.find(member => member.id === p.id);
    if (!member) throw invalid('Join this room first.', 403);
    if (room.status !== 'waiting') throw invalid('The match has already changed.', 409);
    member.ready = true;
    if (room.players.length === 2 && room.players.every(p => p.ready)) {
      room.status = 'countdown'; room.startAt = now() + 3000; room.endAt = room.startAt + MATCH_MS;
      for (const member of room.players) {
        const r = makeRun(profiles.find(p => p.id === member.id), room.seed, 'pvp', room.startAt);
        r.roomCode = room.code; member.runId = r.id;
      }
    }
    res.json(roomView(room, p));
  }));
  router.post('/rooms/:code/leave', route(async (req, res) => {
    const p = profile(req), room = findRoom(req.params.code);
    if (!room.players.some(member => member.id === p.id)) throw invalid('You are not in this room.', 403);
    await tickRoom(room);
    if (room.status === 'waiting') {
      room.status = 'cancelled';
      for (const member of room.players) if (active.get(member.id)?.id === room.code) active.delete(member.id);
    } else if (['countdown', 'playing'].includes(room.status)) {
      room.status = 'finished'; room.reason = 'forfeit'; room.winner = room.players.find(member => member.id !== p.id).id;
      for (const member of room.players) { const r = runs.get(member.runId); r.status = 'finished'; r.revision++; }
      await recordRoom(room);
    }
    res.json(roomView(room, p));
  }));
  return router;
}
