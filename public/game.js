import { api, clearMessage, element, showMessage } from './api.js';
import { CREW, createCourierScene, crewPortrait } from './courier-scene.js';

const $ = (selector) => document.querySelector(selector);
const parameters = new URLSearchParams(location.search);
const preview = parameters.has('experiment') || parameters.has('preview')
  ? { experimentId: parameters.get('experiment'), variant: parameters.get('preview') } : null;
let playerId;
let destinations = [];
let round = null;
let deadline = 0;
let expressDeadline = 0;
let busy = false;
let timerEndRequested = false;
const courier = createCourierScene($('#courier-canvas'));
let selectedCrew = 'nova';
let bestKey = '';
let personalBest = 0;
const DISPATCH_KEYS = ['j', 'k', 'l'];
let wrapping = false;
let queuedDispatch = null;
const reactionTimers = new WeakMap();

function pressFeedback(button, tone) {
  if (!button) return;
  clearTimeout(reactionTimers.get(button));
  button.dataset.reaction = tone;
  reactionTimers.set(button, setTimeout(() => { delete button.dataset.reaction; }, 650));
  animate(button, tone === 'success'
    ? [{ transform: 'scale(.96)' }, { transform: 'scale(1.025)' }, { transform: 'scale(1)' }]
    : [{ transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }]);
}

function updateFlow(next) {
  const target = [3, 6, 9].find(value => next.streak < value);
  const remaining = target ? target - next.streak : 0;
  $('#phase-copy').textContent = target
    ? `${remaining} clean ${remaining === 1 ? 'delivery' : 'deliveries'} to x${next.multiplier + 1}`
    : 'x4 MAX FLOW · Every clean delivery keeps it going';
  $('#combo-progress').value = target ? 3 - remaining : 3;
  $('#combo-progress').setAttribute('aria-label', target ? `${3 - remaining} of 3 deliveries toward the next multiplier` : 'Maximum x4 multiplier reached');
  $('.game-board').dataset.flow = String(next.multiplier);
}

function selectCrew(id) {
  selectedCrew = id;
  courier.select(id);
  for (const button of document.querySelectorAll('[data-courier]')) {
    button.setAttribute('aria-pressed', String(button.dataset.courier === id));
  }
  $('#crew-status').textContent = `${CREW[id].name} is ready for the shift`;
  try { localStorage.setItem('parcel-pals-courier', id); } catch { /* Cosmetic preferences are optional. */ }
}

for (const button of document.querySelectorAll('[data-courier]')) {
  button.querySelector('.crew-portrait').innerHTML = crewPortrait(button.dataset.courier);
  button.addEventListener('click', () => selectCrew(button.dataset.courier));
}

$('#sound-button').addEventListener('click', async () => {
  const enabled = await courier.toggleSound();
  $('#sound-button').textContent = `Sound: ${enabled ? 'on' : 'off'}`;
  $('#sound-button').setAttribute('aria-pressed', String(enabled));
});

function loadPersonalBest(config) {
  bestKey = `parcel-pals-best:${JSON.stringify(config)}`;
  try {
    const stored = Number(localStorage.getItem(bestKey));
    personalBest = Number.isFinite(stored) && stored > 0 ? stored : 0;
  } catch { personalBest = 0; }
  $('#local-best').textContent = preview ? 'PREVIEW / PRACTICE' : `PERSONAL BEST ${personalBest.toLocaleString()}`;
}

function setBusy(value) {
  busy = value;
  for (const button of document.querySelectorAll('#active-screen button, #start-button, #again-button')) {
    button.disabled = value;
  }
  const current = round?.parcels[round.sorted];
  $('#wrap-button').disabled = value || !current?.fragile || round.wrappedParcels.includes(current.id);
}

async function action(operation) {
  if (busy) return;
  setBusy(true);
  clearMessage();
  try {
    await operation();
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    setBusy(false);
  }
}

function renderConfig(config) {
  loadPersonalBest(config);
  courier.configure(destinations);
  document.title = `${config.title} | Play`;
  $('#game-title').textContent = config.title;
  $('#instructions').textContent = config.instructions;
  $('#worked-example').hidden = !config.showExample;
  $('#hint-button').hidden = !config.hintsEnabled;
  $('#progress').max = config.parcelCount;
  $('#progress-label').textContent = `0 / ${config.parcelCount}`;
  $('#timer').textContent = `${config.roundSeconds}s`;
  $('#hint-count').textContent = '0';
  $('#score').textContent = '0';
  $('#streak').textContent = '0 / x1';
  $('#mistakes').textContent = config.mistakeLimit ? `0 / ${config.mistakeLimit}` : '0 / no cap';
  $('#fragile-rule').hidden = !config.fragileParcels;
  $('#express-rule').hidden = !config.expressParcels;
  $('#shift-challenge').textContent = `Deliver ${config.parcelCount} parcels in ${config.roundSeconds} seconds${config.mistakeLimit ? ` before making ${config.mistakeLimit} mistakes` : ''}.`;
  const buttons = destinations.map((destination, index) => {
    const shortcut = DISPATCH_KEYS[index].toUpperCase();
    const button = element('button', undefined, 'destination');
    button.type = 'button';
    button.dataset.destination = destination.id;
    button.setAttribute('aria-label', `${destination.name}, shortcut ${shortcut}`);
    button.setAttribute('aria-keyshortcuts', `${shortcut} ${destination.shortcut}`);
    const image = element('img');
    image.src = destination.icon;
    image.alt = '';
    image.width = 40;
    image.height = 40;
    const name = element('span', destination.name, config.showDestinationLabels ? undefined : 'sr-only');
    button.append(image, name, element('kbd', shortcut));
    button.addEventListener('click', () => sort(destination.id));
    return button;
  });
  $('#destinations').replaceChildren(...buttons);
}

function handlingLabel(parcel) {
  return [parcel.fragile ? 'Fragile' : '', parcel.express ? 'Express' : ''].filter(Boolean).join(' + ') || 'Standard';
}

function renderQueue(next) {
  const queued = next.parcels.slice(next.sorted + 1, next.sorted + 3).map((parcel) => {
    const destination = destinations.find((item) => item.id === parcel.destination);
    const item = element('li', undefined, 'queued-parcel');
    const icon = element('img');
    icon.src = destination.icon;
    icon.alt = `${destination.name} symbol`;
    icon.width = 32;
    icon.height = 32;
    const details = element('div');
    details.append(element('strong', destination.name, next.config.showDestinationLabels ? '' : 'sr-only'),
      element('span', handlingLabel(parcel), 'small muted'));
    item.append(icon, details);
    return item;
  });
  if (!queued.length) queued.push(element('li', 'Last parcel on the belt!', 'queue-empty'));
  $('#parcel-queue').replaceChildren(...queued);
}

function animate(node, frames) {
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    node.animate(frames, { duration: 200, easing: 'ease-out' });
  }
}

function renderRound(next) {
  const changed = round?.id !== next.id || round?.sorted !== next.sorted;
  round = next;
  courier.sync(next);
  deadline = performance.now() + next.remainingMs;
  expressDeadline = performance.now() + next.expressRemainingMs;
  $('#progress').value = next.sorted;
  $('#progress-label').textContent = `${next.sorted} / ${next.config.parcelCount}`;
  $('#hint-count').textContent = next.hints;
  $('#score').textContent = next.score.toLocaleString();
  $('#streak').textContent = `${next.streak} / x${next.multiplier}`;
  $('#streak').dataset.hot = String(next.multiplier > 1);
  $('#mistakes').textContent = `${next.mistakes} / ${next.config.mistakeLimit || 'no cap'}`;
  $('#mistakes').dataset.urgent = String(next.mistakesRemaining != null && next.mistakesRemaining <= 1);
  updateFlow(next);
  if (next.status !== 'playing') {
    const newBest = !preview && next.score > personalBest;
    if (newBest) {
      personalBest = next.score;
      try { localStorage.setItem(bestKey, String(personalBest)); } catch { /* Play without saving a record. */ }
      $('#local-best').textContent = `PERSONAL BEST ${personalBest.toLocaleString()}`;
    }
    $('#courier-verdict').textContent = next.status === 'completed'
      ? `${CREW[selectedCrew].name} says: ${next.mistakes === 0 ? 'Flawless shift. That is how legends sort.' : 'Every parcel home. Nice teamwork!'}${newBest ? ' New personal best!' : ''}`
      : `${CREW[selectedCrew].name} says: New shift, fresh start. You have got this.${newBest ? ' New personal best!' : ''}`;
    $('#crew-status').textContent = next.status === 'completed' ? 'SHIFT COMPLETE / NICE WORK, CREW' : 'SHIFT COMPLETE / READY FOR ANOTHER?';
    $('#floor-message').textContent = next.status === 'completed' ? 'Every parcel has a place. You found them all.' : 'Find your rhythm. The crew is with you.';
    courier.finish(next.status === 'completed');
    document.body.classList.remove('is-playing');
    $('#active-screen').hidden = true;
    $('#result-screen').hidden = false;
    $('#timer').textContent = 'Shift ended';
    const heading = next.status === 'completed' ? 'All parcels delivered!'
      : next.status === 'timed_out' ? 'Time for a breather.'
      : next.status === 'overloaded' ? 'The station needs a reset.' : 'Shift ended.';
    $('#result-title').textContent = heading;
    $('#result-summary').textContent = `You delivered ${next.sorted} of ${next.config.parcelCount} parcels in ${next.durationSeconds.toFixed(1)} seconds.`;
    $('#result-detail').textContent = `${next.attempts} sorting attempts. ${next.hints} hints used. What helped, and what got in the way?`;
    $('#result-score').textContent = next.score.toLocaleString();
    $('#result-streak').textContent = `${next.bestStreak} deliveries`;
    $('#result-title').focus();
    return;
  }
  const parcel = next.parcels[next.sorted];
  const destination = destinations.find((item) => item.id === parcel.destination);
  $('#parcel-icon').src = destination.icon;
  $('#parcel-icon').alt = `${destination.name} symbol`;
  $('#parcel-name').textContent = destination.name;
  $('#parcel-name').className = next.config.showDestinationLabels ? '' : 'sr-only';
  $('#parcel-number').textContent = `Parcel ${next.sorted + 1} of ${next.config.parcelCount}`;
  $('#parcel').dataset.fragile = String(Boolean(parcel.fragile));
  $('#parcel').dataset.wrapped = String(next.wrappedParcels.includes(parcel.id));
  const flags = [];
  if (parcel.fragile) flags.push(element('span', next.wrappedParcels.includes(parcel.id) ? 'WRAPPED' : 'FRAGILE', 'handling-tag fragile-tag'));
  if (parcel.express) flags.push(element('span', 'EXPRESS', 'handling-tag express-tag'));
  if (!flags.length) flags.push(element('span', 'STANDARD', 'handling-tag standard-tag'));
  $('#parcel-flags').replaceChildren(...flags);
  $('#wrap-button').hidden = !parcel.fragile;
  $('#wrap-button').textContent = next.wrappedParcels.includes(parcel.id) ? 'Wrapped and protected' : 'Wrap parcel [W]';
  $('#express-meter').hidden = !parcel.express;
  $('#express-progress').max = next.config.expressBonusSeconds * 1000;
  $('#phase-label').textContent = next.sorted < 3 ? 'Warm-up' : next.sorted < 9 ? 'Mixed mail' : 'Rush hour';
  renderQueue(next);
  if (changed) animate($('#parcel'), [
    { transform: 'translateX(24px) rotate(3deg)', opacity: .4 },
    { transform: 'translateX(0) rotate(0)', opacity: 1 }
  ]);
}

async function start() {
  await action(async () => {
    const next = await api('/api/rounds', { method: 'POST', body: { playerId, preview } });
    timerEndRequested = false;
    queuedDispatch = null;
    for (const button of document.querySelectorAll('[data-reaction]')) delete button.dataset.reaction;
    courier.start();
    $('#crew-status').textContent = `${CREW[selectedCrew].name.toUpperCase()} / ON DUTY`;
    $('#floor-message').textContent = 'Match the symbol. Wrap the fragile ones. Build your streak.';
    renderConfig(next.config);
    document.body.classList.add('is-playing');
    $('#handling-guide').open = false;
    $('#ready-screen').hidden = true;
    $('#result-screen').hidden = true;
    $('#active-screen').hidden = false;
    $('#feedback').textContent = 'Choose a destination.';
    $('#feedback').dataset.tone = '';
    $('#points-popup').textContent = '';
    renderRound(next);
    $('#destinations button').focus({ preventScroll: true });
    $('.game-board').scrollIntoView({ block: 'start', behavior: 'instant' });
  });
}

async function sort(destination) {
  if (!round || round.status !== 'playing') return;
  // A quick W then J/K/L should wrap and dispatch, even while wrapping is saving.
  if (busy) {
    if (wrapping) queuedDispatch = { destination, roundId: round.id, parcelId: round.parcels[round.sorted].id };
    return;
  }
  await action(async () => {
    const previousMultiplier = round.multiplier;
    const next = await api(`/api/rounds/${round.id}/attempts`, {
      method: 'POST',
      body: { playerId, parcelId: round.parcels[round.sorted].id, destination }
    });
    $('#feedback').textContent = next.correct
      ? `Delivered! +${next.points} points${next.expressBonus ? ' including the express bonus' : ''}.`
      : next.reason === 'needs_wrapping' ? 'Fragile delivery! Wrap this parcel with W before dispatching it. Streak reset.'
      : 'Not this destination. Try another one. Streak reset.';
    $('#feedback').dataset.tone = next.correct ? 'success' : 'error';
    $('#points-popup').textContent = next.correct ? `+${next.points}` : '-25';
    $('#points-popup').dataset.tone = next.correct ? 'success' : 'error';
    const milestone = next.correct && next.multiplier > previousMultiplier;
    courier.react(next.correct ? 'delivery' : 'error', destination,
      next.correct ? `${milestone ? `FLOW x${next.multiplier}! / ` : ''}+${next.points}` : 'TRY AGAIN', milestone);
    pressFeedback([...$('#destinations').children].find(button => button.dataset.destination === destination), next.correct ? 'success' : 'error');
    if (next.correct) animate($('#score'), [{ transform: 'scale(1.15)', color: '#ad3b1b' }, { transform: 'scale(1)', color: '#243b38' }]);
    if (milestone) {
      $('#feedback').textContent += ` Flow x${next.multiplier} unlocked!`;
      animate($('#streak'), [{ transform: 'scale(1.2)' }, { transform: 'scale(1)' }]);
    }
    $('#floor-message').textContent = next.correct
      ? `${CREW[selectedCrew].name}: ${next.streak >= 3 ? `${next.streak} in a row. Keep that flow!` : 'Special delivery. Coming through!'}`
      : `${CREW[selectedCrew].name}: ${next.reason === 'needs_wrapping' ? 'A little protection first. Press W.' : 'Wrong bay. Check the parcel symbol.'}`;
    animate($('#points-popup'), [{ transform: 'translateY(8px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }]);
    renderRound(next);
  });
}

async function wrap() {
  const parcel = round?.parcels[round.sorted];
  if (busy || !parcel?.fragile || round.status !== 'playing' || round.wrappedParcels.includes(parcel.id)) return;
  wrapping = true;
  let succeeded = false;
  try { await action(async () => {
    const next = await api(`/api/rounds/${round.id}/wrap`, {
      method: 'POST', body: { playerId, parcelId: parcel.id }
    });
    renderRound(next);
    courier.react('wrap', parcel.destination, 'PROTECTED');
    $('#feedback').textContent = 'Wrapped and protected. Now choose its destination.';
    $('#feedback').dataset.tone = 'success';
    succeeded = true;
    pressFeedback($('#wrap-button'), 'success');
  }); } finally {
    wrapping = false;
    const queued = queuedDispatch;
    queuedDispatch = null;
    if (succeeded && queued && round?.status === 'playing' && queued.roundId === round.id &&
      queued.parcelId === round.parcels[round.sorted]?.id) void sort(queued.destination);
  }
}

async function end(reason) {
  if (!round || round.status !== 'playing') return;
  await action(async () => {
    const next = await api(`/api/rounds/${round.id}/end`, { method: 'POST', body: { playerId, reason } });
    renderRound(next);
  });
}

$('#start-button').addEventListener('click', start);
$('#again-button').addEventListener('click', start);
$('#end-button').addEventListener('click', () => end('abandoned'));
$('#wrap-button').addEventListener('click', wrap);
$('#hint-button').addEventListener('click', () => action(async () => {
  const next = await api(`/api/rounds/${round.id}/hints`, {
    method: 'POST', body: { playerId, parcelId: round.parcels[round.sorted].id }
  });
  const destination = destinations.find((item) => item.id === next.destination);
  renderRound(next);
  const needsWrapping = round.parcels[round.sorted].fragile &&
    !round.wrappedParcels.includes(round.parcels[round.sorted].id);
  $('#feedback').textContent = `${needsWrapping ? 'Wrap it with W first, then send it' : 'Send this parcel'} to the ${destination.name}.`;
  $('#feedback').dataset.tone = '';
}));

document.addEventListener('keydown', (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.repeat ||
      event.target.closest('input, textarea, select, [contenteditable="true"]') ||
      !round || round.status !== 'playing') return;
  const key = event.key.toLowerCase();
  const index = DISPATCH_KEYS.indexOf(key);
  const destination = index >= 0 ? destinations[index] : destinations.find(item => item.shortcut === key);
  const button = key === 'w' ? $('#wrap-button') : destination
    ? [...$('#destinations').children].find(item => item.dataset.destination === destination.id) : null;
  if (button) button.classList.add('key-held');
  if (key === 'w') {
    event.preventDefault();
    void wrap();
  }
  if (destination) {
    event.preventDefault();
    void sort(destination.id);
  }
});

document.addEventListener('keyup', () => {
  for (const button of document.querySelectorAll('.key-held')) button.classList.remove('key-held');
});
window.addEventListener('blur', () => {
  for (const button of document.querySelectorAll('.key-held')) button.classList.remove('key-held');
});

setInterval(() => {
  if (!round || round.status !== 'playing') return;
  const remaining = Math.max(0, deadline - performance.now());
  $('#timer').textContent = `${Math.ceil(remaining / 1000)}s`;
  $('#timer').dataset.urgent = String(remaining < 10000);
  if (!$('#express-meter').hidden) {
    const expressRemaining = Math.max(0, expressDeadline - performance.now());
    $('#express-progress').value = expressRemaining;
    $('#express-timer').textContent = expressRemaining > 0
      ? `${(expressRemaining / 1000).toFixed(1)}s for +75 express points`
      : 'Bonus expired. You can still deliver this parcel.';
  }
  if (remaining === 0 && !busy && !timerEndRequested) {
    timerEndRequested = true;
    void end('time_up');
  }
}, 100);

async function initialize() {
  try {
    const runtime = await api('/api/runtime');
    if (runtime.publicDemo) {
      for (const link of document.querySelectorAll('[data-workshop-link], a[href="/lab.html"]')) link.hidden = true;
      $('footer').textContent = runtime.ephemeral ? 'Parcel Pals · Free online demo. Saved records may reset.' : 'Parcel Pals · Online game';
      $('.afterword h2').textContent = 'Ready for a bigger challenge?';
      $('.afterword > p').textContent = 'Try the competitive arena for 220 levels, boss challenges and live duels.';
    }
    const savedCrew = localStorage.getItem('parcel-pals-courier');
    selectCrew(CREW[savedCrew] ? savedCrew : 'nova');
    playerId = localStorage.getItem('parcel-pals-player-id');
    if (!playerId) {
      playerId = crypto.randomUUID();
      localStorage.setItem('parcel-pals-player-id', playerId);
    }
    const query = new URLSearchParams({ playerId });
    if (preview) {
      query.set('experimentId', preview.experimentId ?? '');
      query.set('variant', preview.variant ?? '');
    }
    const experience = await api(`/api/config?${query}`);
    destinations = experience.destinations;
    renderConfig(experience.config);
    if (experience.preview) {
      $('#preview-banner').hidden = false;
      $('#preview-label').textContent = `PREVIEW: ${experience.experimentName}, variant ${experience.variant}`;
    }
    $('#play-mode').textContent = runtime.publicDemo ? 'Online demo. Find your rhythm, or challenge a friend in the arena.'
      : experience.preview ? 'Practice freely. Preview rounds never count as experiment evidence.'
      : experience.experimentId ? 'A local experiment is running. Your group stays the same in this browser.'
      : 'Local workshop game. Take a shift, then explore what you would improve.';
    $('#start-button').disabled = false;
  } catch (error) {
    showMessage(`${error.message} If browser storage is blocked, enable it for this local site.`, true);
    $('#play-mode').textContent = 'The game could not load.';
  }
}

void initialize();
