import { api, clearMessage, element, percent, seconds, showMessage } from './api.js';

const $ = (selector) => document.querySelector(selector);
let datasets = [];
let metricNames = {};

function metricTable(rows, captionText, live = false) {
  const table = element('table');
  table.append(element('caption', captionText, 'sr-only'));
  const head = element('thead');
  const headings = element('tr');
  for (const title of ['Group', 'Players', 'Pending', 'Completed / finished', 'Completion', '95% interval', 'Without hints', 'Avg duration', 'Accuracy', ...(live ? ['Avg score'] : [])]) {
    const cell = element('th', title);
    cell.scope = 'col';
    headings.append(cell);
  }
  head.append(headings);
  const body = element('tbody');
  for (const row of rows) {
    const tr = element('tr');
    const label = live ? `${row.name} / ${row.variant}` : `${row.variant}: ${row.label}`;
    const group = element('th', label);
    group.scope = 'row';
    tr.append(group);
    const values = [
      row.players, row.pending, `${row.completed} / ${row.resolved}`,
      percent(row.completionRate),
      row.completionInterval ? row.completionInterval.map(percent).join(' - ') : '-',
      percent(row.unassistedRate), seconds(row.averageSeconds), percent(row.accuracy),
      ...(live ? [row.averageScore == null ? '-' : row.averageScore.toFixed(0)] : [])
    ];
    for (const value of values) tr.append(element('td', value));
    body.append(tr);
  }
  table.append(head, body);
  return table;
}

function renderDataset() {
  const dataset = datasets.find((item) => item.id === $('#dataset').value);
  if (!dataset) throw new Error('The selected fictional dataset is unavailable.');
  $('#dataset-name').textContent = dataset.name;
  $('#dataset-description').textContent = dataset.description;
  $('#dataset-metrics').textContent = `Primary metric: ${dataset.primaryMetric}. Guardrail: ${dataset.guardrail}.`;
  $('#synthetic-results').replaceChildren(metricTable(dataset.variants, `${dataset.name}: fictional first-round results`));
  $('#dataset-download').href = `/api/synthetic/${dataset.id}.csv`;
}

function addDetail(parent, label, value) {
  parent.append(element('dt', label), element('dd', value));
}

function renderExperiments(experiments) {
  const running = experiments.some((item) => item.status === 'running');
  $('#config-fields').disabled = running;
  $('#settings-note').textContent = running
    ? 'Base settings are locked while an experiment runs. Both variants use a frozen snapshot. Stop the experiment before changing the baseline.'
    : 'These settings are also in config.json. Saved changes apply to new shifts, not shifts already in progress.';
  const cards = experiments.map((experiment) => {
    const card = element('article', undefined, 'experiment-card');
    const heading = element('div', undefined, 'section-heading');
    heading.append(element('h3', experiment.name), element('span', experiment.status.toUpperCase(), 'badge'));
    const details = element('dl', undefined, 'experiment-details');
    addDetail(details, 'Hypothesis', experiment.hypothesis);
    addDetail(details, 'Primary metric', metricNames[experiment.primaryMetric]);
    addDetail(details, 'Guardrail', experiment.guardrail);
    addDetail(details, 'Evidence / stopping plan', experiment.decisionRule);
    if (experiment.baseConfig) {
      addDetail(details, 'Baseline', 'Frozen at launch. Editing config.json will not change this experiment.');
    }
    const buttons = element('div', undefined, 'button-row');
    for (const variant of ['A', 'B']) {
      const link = element('a', `Preview ${variant}`, 'button secondary');
      link.href = `/?${new URLSearchParams({ experiment: experiment.id, preview: variant })}`;
      link.target = '_blank';
      link.rel = 'noopener';
      buttons.append(link);
    }
    if (experiment.status === 'draft' || experiment.status === 'running') {
      const launch = experiment.status === 'draft';
      const button = element('button', launch ? 'Launch 50/50 test' : 'Stop experiment', 'button primary');
      button.disabled = launch && running;
      button.addEventListener('click', () => runAction(button, async () => {
        await api(`/api/experiments/${experiment.id}/${launch ? 'start' : 'stop'}`, { method: 'POST', body: {} });
        await refresh();
        showMessage(launch
          ? 'Experiment launched. New live shifts now receive A or B. Previews still do not count.'
          : 'Experiment stopped. Existing shifts keep their original settings; new shifts use the base game.');
      }));
      buttons.append(button);
    }
    card.append(heading, details, element('p', 'Variant B changes:', 'small muted'),
      element('pre', JSON.stringify(experiment.overrides, null, 2)), buttons);
    return card;
  });
  $('#experiment-list').replaceChildren(...(cards.length ? cards : [
    element('p', 'No proposals yet. Start with an observation from the game, not a setting you feel obliged to change.', 'empty-state')
  ]));
}

async function refresh() {
  const [settings, experiments, results] = await Promise.all([
    api('/api/settings'), api('/api/experiments'), api('/api/results')
  ]);
  metricNames = settings.metrics;
  const selectedMetric = $('#primary-metric').value;
  $('#primary-metric').replaceChildren(...Object.entries(metricNames).map(([value, label]) => {
    const option = element('option', label);
    option.value = value;
    return option;
  }));
  if (selectedMetric) $('#primary-metric').value = selectedMetric;
  for (const [key, value] of Object.entries(settings.config)) {
    const input = $('#config-form').elements.namedItem(key);
    if (typeof value === 'boolean') input.checked = value;
    else input.value = value;
  }
  renderExperiments(experiments.experiments);
  $('#live-summary').textContent = `${results.totalRounds} live shifts started. ${results.previewRounds} preview shifts excluded. ${results.eventCount} local events recorded.`;
  $('#live-results').replaceChildren(results.cohorts.length
    ? metricTable(results.cohorts, 'Local first-round playtest results', true)
    : element('p', 'No live rounds yet. Play a shift on the Play page to record one.', 'empty-state'));
}

async function runAction(button, operation) {
  button.disabled = true;
  clearMessage();
  try {
    await operation();
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
}

$('#dataset').addEventListener('change', renderDataset);
$('#refresh-button').addEventListener('click', (event) => runAction(event.currentTarget, async () => {
  await refresh();
  showMessage('Local results refreshed.');
}));

$('#experiment-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  void runAction(form.querySelector('[type="submit"]'), async () => {
    const values = Object.fromEntries(new FormData(form));
    try {
      values.overrides = JSON.parse(values.overrides);
    } catch (error) {
      throw new Error('Variant B settings must be valid JSON. Check quotes, commas and braces.', { cause: error });
    }
    await api('/api/experiments', { method: 'POST', body: values });
    form.reset();
    await refresh();
    showMessage('Proposal saved. Preview A and B before deciding whether to launch.');
  });
});

$('#config-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  void runAction(form.querySelector('[type="submit"]'), async () => {
    const data = new FormData(form);
    const config = {
      title: data.get('title'),
      instructions: data.get('instructions'),
      roundSeconds: Number(data.get('roundSeconds')),
      parcelCount: Number(data.get('parcelCount')),
      showExample: data.has('showExample'),
      showDestinationLabels: data.has('showDestinationLabels'),
      hintsEnabled: data.has('hintsEnabled'),
      fragileParcels: data.has('fragileParcels'),
      expressParcels: data.has('expressParcels'),
      mistakeLimit: Number(data.get('mistakeLimit')),
      expressBonusSeconds: Number(data.get('expressBonusSeconds'))
    };
    await api('/api/config', { method: 'PUT', body: config });
    await refresh();
    showMessage('Base settings saved to config.json. Open or reload Play to try them.');
  });
});

$('#reset-button').addEventListener('click', (event) => {
  if (!confirm('Delete all local rounds and experiment proposals? Game settings and synthetic datasets will stay unchanged.')) return;
  void runAction(event.currentTarget, async () => {
    const result = await api('/api/reset', { method: 'POST', body: { confirmation: 'RESET LOCAL DATA' } });
    await refresh();
    showMessage(result.message);
  });
});

async function initialize() {
  try {
    const synthetic = await api('/api/synthetic');
    datasets = synthetic.datasets;
    $('#dataset').replaceChildren(...datasets.map((dataset) => {
      const option = element('option', dataset.name);
      option.value = dataset.id;
      return option;
    }));
    renderDataset();
    await refresh();
  } catch (error) {
    showMessage(error.message, true);
  }
}

void initialize();
