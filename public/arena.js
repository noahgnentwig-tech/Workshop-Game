import { CREW, crewPortrait, createCourierScene } from './courier-scene.js';
import { element } from './api.js';
import { CAMPAIGN_LEVELS } from './arena-rules.js';

const $ = s => document.querySelector(s);
const destinations = [
  { id: 'garden', name: 'Garden', icon: '/assets/leaf.svg', key: 'j' },
  { id: 'studio', name: 'Studio', icon: '/assets/star.svg', key: 'k' },
  { id: 'workshop', name: 'Workshop', icon: '/assets/bolt.svg', key: 'l' }
];
const params = new URLSearchParams(location.search);
const storage = params.has('guest') ? sessionStorage : localStorage;
const tokenKey = 'parcel-pals-arena-token';
let token, player, run = null, room = null, busy = false, polling = false, wrapping = false;
let queued = null, levelDeadline = 0, matchDeadline = 0, countdownDeadline = 0, expressDeadline = 0;
let board = { solo: [], pvp: [] }, boardType = 'solo', transitionKey = '', finishedRoom = '';
let mapPage = 0;
const scene = createCourierScene($('#arena-canvas'));
scene.configure(destinations);

function message(text, error = false) {
  $('#arena-message').textContent = text; $('#arena-message').dataset.error = String(error); $('#arena-message').hidden = !text;
}
async function call(route, method = 'GET', body) {
  let response;
  try { response = await fetch(`/api/competitive${route}`, { method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { throw new Error('Connection lost. Keep this page open to reconnect. Match timers keep running.'); }
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'The arena could not complete that action.'), { status: response.status });
  return data;
}
async function operation(fn) {
  if (busy) return;
  busy = true; enableControls(); message('');
  try { await fn(); } catch (error) { message(error.message, true); }
  finally { busy = false; enableControls(); }
}
function canPlay() { return run?.status === 'playing' && (!room || room.status === 'playing'); }
function enableControls() {
  for (const id of ['solo-start', 'room-create', 'room-join']) $(`#${id}`).disabled = busy || !player;
  for (const button of document.querySelectorAll('#arena-destinations button')) button.disabled = busy || !canPlay();
  $('#arena-wrap').disabled = busy || !canPlay() || !run?.parcel?.fragile || run.parcel.wrapped;
  $('#arena-next-level').disabled = busy;
  $('#arena-bank').disabled = busy;
  $('#room-ready').disabled = busy || room?.status !== 'waiting' || room?.players.find(p => p.id === player?.id)?.ready;
  $('#room-leave').disabled = busy;
}
function updateMap(level = run?.level || 1, cleared = run?.cleared || 0, follow = false) {
  if (follow) mapPage = Math.floor((level - 1) / 20);
  const base = mapPage * 20;
  const nodes = Array.from({ length: 20 }, (_, i) => {
    const n = base + i + 1, kind = n % 20 === 0 ? 'super_boss' : n % 10 === 0 ? 'boss' : 'normal';
    const node = element('div', undefined, 'level-chip'); node.append(element('span', String(n)));
    node.dataset.kind = kind; node.dataset.current = String(n === level); node.dataset.cleared = String(n <= cleared);
    if (kind !== 'normal') node.append(element('small', kind === 'boss' ? 'BOSS' : 'SUPER'));
    node.setAttribute('aria-label', `Level ${n}${kind === 'normal' ? '' : ` ${kind.replace('_', ' ')}`}${n <= cleared ? ', cleared' : n === level ? ', current' : ''}`);
    return node;
  });
  $('#level-map').replaceChildren(...nodes);
  $('#map-range').value = String(mapPage);
  $('#map-previous').disabled = mapPage === 0;
  $('#map-next').disabled = base + 20 >= CAMPAIGN_LEVELS;
  $('#campaign-progress').textContent = `${cleared} / ${CAMPAIGN_LEVELS} levels cleared`;
}
function showBoard() {
  $('#board-solo').setAttribute('aria-pressed', String(boardType === 'solo'));
  $('#board-pvp').setAttribute('aria-pressed', String(boardType === 'pvp'));
  $('#board-note').textContent = boardType === 'solo' ? 'Ranked by levels cleared, then score. Best finished run per player.' : 'Ranked by duel wins, then fewer losses. Equal match scores are a draw.';
  const rows = board[boardType].map((p, i) => {
    const li = element('li'); li.dataset.you = String(p.id === player?.id);
    const identity = element('div'); identity.append(element('strong', p.name + (p.id === player?.id ? ' · You' : '')),
      element('small', boardType === 'solo' ? `Level ${p.level} cleared · ${p.streak} best streak` : `${p.losses} losses · ${p.draws} draws`));
    const value = element('div', undefined, 'board-value'); value.append(element('strong', boardType === 'solo' ? p.score.toLocaleString() : `${p.wins} W`));
    li.append(element('strong', String(i + 1), 'board-rank'), identity, value); return li;
  });
  if (!rows.length) rows.push(element('li', boardType === 'solo' ? 'No finished runs yet. Set the first score.' : 'No duels finished yet. Challenge a friend.', 'board-empty'));
  $('#leaderboard').replaceChildren(...rows);
}
async function refreshBoard() { board = await call('/leaderboard'); showBoard(); }
function lobby() {
  run = null; room = null; queued = null; transitionKey = '';
  $('#arena-lobby').hidden = false; $('#arena-game').hidden = true; $('#room-panel').hidden = true;
  updateMap(1, 0, true); enableControls(); void refreshBoard().catch(e => message(e.message, true));
}
function nextParcels(items) {
  const nodes = items.map(p => {
    const d = destinations.find(d => d.id === p.destination), node = element('div', undefined, 'next-parcel');
    const image = element('img'); image.src = d.icon; image.alt = `${d.name} symbol`;
    node.append(image, element('small', p.fragile ? 'FRAGILE' : p.express ? 'EXPRESS' : 'STANDARD')); return node;
  });
  if (!nodes.length) nodes.push(element('small', 'Last parcel!'));
  $('#arena-next').replaceChildren(...nodes);
}
function renderRun(next) {
  if (run?.id === next.id && next.revision < run.revision) return;
  const changed = run?.id !== next.id || run.revision !== next.revision;
  const freshLevel = run?.id !== next.id || run.level !== next.level || run.status !== 'playing' && next.status === 'playing';
  run = next;
  if (freshLevel) {
    $('#arena-feedback').textContent = next.rules.kind === 'super_boss' ? 'Super boss! Clear every parcel to break the shield.'
      : next.rules.kind === 'boss' ? 'Boss round! Precise deliveries break the shield.' : 'Find your rhythm. You have got this.';
    $('#arena-feedback').dataset.tone = '';
  }
  levelDeadline = performance.now() + next.remainingMs;
  expressDeadline = performance.now() + next.expressRemainingMs;
  $('#arena-lobby').hidden = true; $('#arena-game').hidden = false;
  $('#arena-game').dataset.kind = next.rules.kind;
  $('#arena-level').textContent = next.level;
  $('#arena-lives').textContent = `${next.lives} / 5`;
  $('#arena-lives').setAttribute('aria-label', `${next.lives} lives remaining out of five`);
  $('#arena-score').textContent = next.score.toLocaleString();
  $('#arena-streak').textContent = `${next.streak} · x${next.multiplier}`;
  $('#arena-phase').textContent = `LEVEL ${next.level} / ${next.rules.kind === 'super_boss' ? 'SUPER BOSS' : next.rules.kind === 'boss' ? 'BOSS ROUND' : next.level <= 2 ? 'FIND YOUR FLOW' : 'KEEP IT MOVING'}`;
  $('#arena-bank').textContent = room ? 'Forfeit match' : 'Bank score & finish';
  $('#arena-bank').hidden = next.status === 'finished';
  $('#opponent-strip').hidden = !room;
  $('#boss-panel').hidden = next.rules.kind === 'normal';
  $('#boss-name').textContent = next.rules.kind === 'super_boss' ? 'MEGA SORTMASTER / SUPER BOSS' : 'THE SORTMASTER / BOSS';
  $('#boss-copy').textContent = `${next.rules.parcelCount - next.sorted} shield points left. Each correct delivery breaks one.`;
  $('#boss-health').max = next.rules.parcelCount; $('#boss-health').value = next.rules.parcelCount - next.sorted;
  $('#difficulty-copy').textContent = `Level ${next.level}: ${next.rules.parcelCount} parcels · ${next.rules.seconds} seconds · ${next.rules.kind.replace('_', ' ')}. Bosses restore 1 life; super bosses restore 2, up to 5.`;
  if (changed) {
    updateMap(next.level, next.cleared, freshLevel);
    scene.sync({ status: next.status === 'level_clear' || next.reason === 'completed' ? 'completed' : next.status === 'playing' ? 'playing' : 'ended',
      config: { showDestinationLabels: true }, parcels: next.parcel ? [next.parcel, ...next.next] : [], sorted: 0,
      multiplier: next.multiplier, wrappedParcels: next.parcel?.wrapped ? [next.parcel.id] : [] });
  }
  const play = next.status === 'playing';
  $('#play-zone').hidden = !play; $('#arena-transition').hidden = play;
  if (play) {
    const p = next.parcel, d = destinations.find(d => d.id === p.destination);
    $('#arena-parcel-icon').src = d.icon; $('#arena-parcel-icon').alt = `${d.name} symbol`;
    $('#arena-parcel-name').textContent = d.name;
    $('#arena-parcel-count').textContent = `PARCEL ${next.sorted + 1} OF ${next.rules.parcelCount}`;
    $('#arena-parcel').dataset.wrapped = String(p.wrapped);
    const flags = [];
    if (p.fragile) flags.push(element('span', p.wrapped ? 'WRAPPED' : 'FRAGILE', 'handling-tag fragile-tag'));
    if (p.express) flags.push(element('span', 'EXPRESS', 'handling-tag express-tag'));
    if (!flags.length) flags.push(element('span', 'STANDARD', 'handling-tag standard-tag'));
    $('#arena-flags').replaceChildren(...flags);
    $('#arena-wrap').textContent = p.wrapped ? 'Wrapped ✓' : 'Wrap [W]';
    $('#arena-wrap').hidden = !p.fragile;
    $('#arena-progress').max = next.rules.parcelCount; $('#arena-progress').value = next.sorted;
    nextParcels(next.next);
  } else {
    const key = `${next.id}:${next.level}:${next.status}:${next.revision}`;
    const pvpResult = room?.status === 'finished';
    $('#transition-kicker').textContent = pvpResult ? 'DUEL RESULT' : next.reason === 'completed' ? 'CAMPAIGN COMPLETE' : next.status === 'finished' ? 'RUN COMPLETE' : next.status === 'retry' ? 'TAKE A BREATH' : 'LEVEL CLEARED';
    $('#transition-title').textContent = pvpResult ? !room.winner ? 'A perfectly matched duel.' : room.winner === player.id ? 'You won the duel!' : 'Your rival takes this one.'
      : next.reason === 'completed' ? `All ${CAMPAIGN_LEVELS} levels conquered!`
      : next.status === 'finished' ? next.reason === 'banked' ? 'Score banked. Nicely done.' : 'Great run. Fresh start?'
      : next.status === 'retry' ? 'One life down. You can retry.'
      : next.rules.kind === 'super_boss' ? 'Super boss defeated!' : next.rules.kind === 'boss' ? 'Boss defeated!' : `Level ${next.level} cleared!`;
    $('#transition-copy').textContent = next.status === 'retry'
      ? `${next.lives} lives remain. This level’s points reset; cleared-level points are safe.${room ? ' Retrying automatically…' : ''}`
      : next.status === 'level_clear' ? `${next.score.toLocaleString()} points banked. ${next.rules.rewardLives ? `Life reward: up to +${next.rules.rewardLives}. ` : ''}${room ? 'Next level starts automatically…' : `Level ${next.level + 1} is ready when you are.`}`
      : `${next.score.toLocaleString()} points · ${next.cleared} levels cleared · ${next.delivered} deliveries.${room?.reason === 'forfeit' ? ' Match ended by forfeit.' : room && room.status !== 'finished' ? ' Your rival can keep playing until the match clock ends.' : ''}`;
    $('#arena-next-level').hidden = Boolean(room) || next.status === 'finished';
    $('#arena-next-level').textContent = next.status === 'retry' ? `Retry level ${next.level}` : `Play level ${next.level + 1}`;
    $('#arena-home').hidden = next.status !== 'finished' || Boolean(room && room.status !== 'finished');
    if (transitionKey !== key) {
      transitionKey = key;
      if (next.status === 'level_clear' || next.reason === 'completed') scene.finish(true);
      $('#transition-title').focus({ preventScroll: true });
      if (next.status === 'finished') void refreshBoard().catch(e => message(e.message, true));
    }
  }
  enableControls(); updateClocks();
}
function renderRoom(next) {
  room = next;
  matchDeadline = performance.now() + next.remainingMs;
  countdownDeadline = performance.now() + next.countdownMs;
  const waiting = ['waiting', 'countdown'].includes(next.status);
  $('#arena-lobby').hidden = true; $('#room-panel').hidden = !waiting;
  $('#room-display').textContent = next.code;
  $('#room-players').replaceChildren(...next.players.map(p => {
    const node = element('div', undefined, 'room-player'); node.append(element('strong', `${p.name}${p.id === player.id ? ' · You' : ''}`), element('span', p.ready ? '✓ Ready' : 'Not ready yet')); return node;
  }));
  if (next.players.length === 1) {
    const node = element('div', undefined, 'room-player'); node.append(element('strong', 'Your rival goes here'), element('span', 'Share the room code')); $('#room-players').append(node);
  }
  const invite = new URL('/arena.html', location.origin); invite.searchParams.set('room', next.code);
  $('#guest-link').href = `${invite.href}&guest=1`;
  $('#room-ready').hidden = next.status !== 'waiting';
  if (waiting) $('#arena-game').hidden = true;
  if (next.status === 'cancelled') { lobby(); message('That room was closed. Create or join another one.'); return; }
  if (!waiting && next.you) renderRun(next.you);
  const opponent = next.players.find(p => p.id !== player.id);
  $('#opponent-score').textContent = opponent ? `${opponent.name}: ${opponent.score.toLocaleString()} pts · Lv ${opponent.level} · ${opponent.lives} lives` : 'Waiting for a rival';
  if (next.status === 'finished' && finishedRoom !== next.code) {
    finishedRoom = next.code; void refreshBoard().catch(e => message(e.message, true));
  }
  enableControls(); updateClocks();
}
function updateClocks() {
  const at = performance.now(), remaining = Math.max(0, levelDeadline - at);
  $('#arena-timer').textContent = canPlay() ? `${Math.ceil(remaining / 1000)}s` : '—';
  $('#arena-timer').dataset.urgent = String(canPlay() && remaining < 7000);
  if (run?.parcel?.express && canPlay()) {
    const left = Math.max(0, expressDeadline - at);
    $('#arena-express').textContent = left ? `Express: ${(left / 1000).toFixed(1)}s for +75` : 'Express bonus expired. You can still deliver.';
  } else $('#arena-express').textContent = '';
  if (room) {
    $('#duel-clock').textContent = room.status === 'finished' ? 'FINAL SCORE' : `DUEL ${Math.ceil(Math.max(0, matchDeadline - at) / 1000)}s`;
    $('#room-status').textContent = room.status === 'countdown' ? `Both ready. Starting in ${Math.max(1, Math.ceil((countdownDeadline - at) / 1000))}…`
      : room.players.length < 2 ? 'Waiting for player 2. Share this room code.' : 'Both players are here. Ready up to start together.';
  }
}
async function poll() {
  if (polling || busy || !player || !room && !run) return;
  polling = true;
  const currentRoom = room?.code, currentRun = run?.id;
  try {
    if (currentRoom) {
      const data = await call(`/rooms/${currentRoom}`);
      if (room?.code === currentRoom && !busy) renderRoom(data);
    } else if (currentRun) {
      const data = await call(`/runs/${currentRun}`);
      if (run?.id === currentRun && !busy) renderRun(data);
    }
  } catch (e) {
    if (e.status === 404) { lobby(); message('The server restarted or this game is no longer active. Your saved leaderboard records are safe.'); }
    else message(e.message, true);
  } finally { polling = false; }
}
async function playAction(action, destination) {
  if (busy) { if (wrapping && action === 'dispatch') queued = destination; return; }
  if (!canPlay()) return;
  const original = run, multiplier = run.multiplier;
  let success = false;
  wrapping = action === 'wrap';
  await operation(async () => {
    const next = await call(`/runs/${run.id}/action`, 'POST', { action, destination, parcelId: run.parcel.id, revision: run.revision });
    renderRun(next); success = true;
    const result = next.result;
    const wrapped = result.kind === 'wrapped', milestone = !wrapped && result.correct && next.multiplier > multiplier;
    $('#arena-feedback').textContent = wrapped ? 'Protected. Ready for dispatch.' : result.correct
      ? `+${result.points} points${result.kind === 'express' ? ' · Express delivery!' : ''}${milestone ? ` · Flow x${next.multiplier}!` : ''}`
      : result.kind === 'needs_wrapping' ? 'Fragile parcel! Wrap with W first. One life lost.' : 'Wrong bay. Check the symbol. One life lost.';
    $('#arena-feedback').dataset.tone = result.correct ? 'success' : 'error';
    scene.react(wrapped ? 'wrap' : result.correct ? 'delivery' : 'error', destination || original.parcel.destination, wrapped ? 'PROTECTED' : result.correct ? `+${result.points}` : 'ONE LIFE LOST', milestone);
    $('#arena-game').dataset.hit = ''; requestAnimationFrame(() => { $('#arena-game').dataset.hit = result.correct ? 'success' : 'error'; });
  });
  const pending = queued; queued = null; wrapping = false;
  if (success && pending && run?.id === original.id && run.parcel?.id === original.parcel.id && canPlay()) void playAction('dispatch', pending);
  else if (!success) void poll();
}

for (const d of destinations) {
  const button = element('button', undefined, 'destination'); button.type = 'button';
  button.setAttribute('aria-label', `${d.name}, shortcut ${d.key.toUpperCase()}`); button.setAttribute('aria-keyshortcuts', d.key.toUpperCase());
  const image = element('img'); image.src = d.icon; image.alt = '';
  button.append(image, element('span', d.name), element('kbd', d.key.toUpperCase()));
  button.addEventListener('click', () => void playAction('dispatch', d.id)); $('#arena-destinations').append(button);
}
$('#solo-start').addEventListener('click', () => operation(async () => {
  room = null; scene.start(); renderRun(await call('/solo', 'POST', {})); $('#arena-game').scrollIntoView({ block: 'start' });
}));
$('#room-create').addEventListener('click', () => operation(async () => { run = null; renderRoom(await call('/rooms', 'POST', {})); }));
$('#join-form').addEventListener('submit', e => { e.preventDefault(); void operation(async () => {
  run = null; renderRoom(await call(`/rooms/${$('#room-code').value.trim().toUpperCase()}/join`, 'POST', {}));
}); });
$('#room-ready').addEventListener('click', () => operation(async () => { renderRoom(await call(`/rooms/${room.code}/ready`, 'POST', {})); }));
$('#room-leave').addEventListener('click', () => operation(async () => { await call(`/rooms/${room.code}/leave`, 'POST', {}); lobby(); }));
$('#copy-link').addEventListener('click', async () => {
  const url = new URL('/arena.html', location.origin); url.searchParams.set('room', room.code);
  try { await navigator.clipboard.writeText(url.href); message('Invite link copied. Share it with your opponent.'); }
  catch { message(`Room code: ${room.code}. Open ${url.href} in the second player’s browser.`); }
});
$('#arena-wrap').addEventListener('click', () => void playAction('wrap'));
$('#arena-next-level').addEventListener('click', () => operation(async () => { renderRun(await call(`/runs/${run.id}/next`, 'POST', { revision: run.revision })); }));
$('#arena-bank').addEventListener('click', () => operation(async () => {
  if (room) renderRoom(await call(`/rooms/${room.code}/leave`, 'POST', {}));
  else renderRun(await call(`/runs/${run.id}/finish`, 'POST', {}));
}));
$('#arena-home').addEventListener('click', lobby);
$('#arena-sound').addEventListener('click', async () => {
  const on = await scene.toggleSound(); $('#arena-sound').textContent = `Sound: ${on ? 'on' : 'off'}`; $('#arena-sound').setAttribute('aria-pressed', String(on));
});
$('#board-refresh').addEventListener('click', () => operation(refreshBoard));
for (let page = 0; page < CAMPAIGN_LEVELS / 20; page++) {
  const option = element('option', `Levels ${page * 20 + 1}–${Math.min((page + 1) * 20, CAMPAIGN_LEVELS)}`);
  option.value = String(page); $('#map-range').append(option);
}
$('#map-range').addEventListener('change', () => { mapPage = Number($('#map-range').value); updateMap(); });
$('#map-previous').addEventListener('click', () => { mapPage = Math.max(0, mapPage - 1); updateMap(); });
$('#map-next').addEventListener('click', () => { mapPage = Math.min(CAMPAIGN_LEVELS / 20 - 1, mapPage + 1); updateMap(); });
for (const type of ['solo', 'pvp']) $(`#board-${type}`).addEventListener('click', () => { boardType = type; showBoard(); });
document.addEventListener('keydown', e => {
  if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.target.closest('input,textarea,select,[contenteditable="true"]') || !canPlay()) return;
  const key = e.key.toLowerCase(), d = destinations.find(d => d.key === key);
  if (key === 'w' || d) { e.preventDefault(); void playAction(d ? 'dispatch' : 'wrap', d?.id); }
});
setInterval(() => void poll(), 500);
setInterval(updateClocks, 100);

async function initialize() {
  try {
    const runtime = await fetch('/api/runtime').then(response => response.json());
    $('#hosting-notice').hidden = !runtime.ephemeral;
    if (runtime.publicDemo) {
      $('#guest-link').textContent = 'Open player 2 to test';
      $('#room-panel > p.small').textContent = 'Share the invite link or room code with your opponent. Both players use this website. The second-player button opens a guest identity to test the duel.';
      if (runtime.ephemeral) $('.leaderboard-panel > p:last-child').textContent = 'Shared by players on this free demo. Records may reset when the host sleeps, restarts or updates.';
    }
    token = storage.getItem(tokenKey);
    let me;
    if (token) { try { me = await call('/me'); } catch (e) { if (e.status !== 401) throw e; token = null; } }
    if (!token) {
      const crew = localStorage.getItem('parcel-pals-courier');
      const session = await call('/session', 'POST', { crew: CREW[crew] ? crew : 'nova' });
      token = session.token; storage.setItem(tokenKey, token); me = { player: session.player };
    }
    player = me.player; scene.select(player.crew);
    $('#player-name').textContent = player.name; $('#player-portrait').innerHTML = crewPortrait(player.crew);
    $('#room-code').value = params.get('room') || '';
    updateMap(); await refreshBoard();
    if (me.active?.type === 'room') renderRoom(await call(`/rooms/${me.active.id}`));
    else if (me.active) renderRun(await call(`/runs/${me.active.id}`));
    enableControls();
  } catch (e) { message(`${e.message} If this persists, check that PowerShell is still running and browser storage is enabled.`, true); }
}
void initialize();
