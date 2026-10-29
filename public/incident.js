import { api, clearMessage, element, percent, showMessage } from './api.js';

const $ = (selector) => document.querySelector(selector);
let overview;
const titles = new Map();

function table(headers, rows, caption) {
  const result = element('table');
  result.append(element('caption', caption, 'sr-only'));
  const head = element('thead');
  const headings = element('tr');
  for (const label of headers) {
    const cell = element('th', label);
    cell.scope = 'col';
    headings.append(cell);
  }
  head.append(headings);
  const body = element('tbody');
  for (const row of rows) {
    const tr = element('tr');
    for (const value of row) {
      const cell = element('td');
      if (value instanceof Node) cell.append(value);
      else cell.textContent = value;
      tr.append(cell);
    }
    body.append(tr);
  }
  result.append(head, body);
  return result;
}

function funnelRow(metrics) {
  return [metrics.opened, metrics.rendered, percent(metrics.renderRate), metrics.buyers, `${metrics.spendGB} GB`, metrics.crashes];
}

function renderConfig() {
  const selected = overview.events.find((event) => event.config.id === $('#config-event').value);
  $('#config-version').textContent = `Current version: ${selected.version}`;
  $('#event-config').value = JSON.stringify(selected.config, null, 2);
}

async function refreshOverview() {
  overview = await api('/api/incident/overview');
  for (const event of overview.events) titles.set(event.config.id, event.config.title);
  const before = overview.windows.find((window) => window.id === 'before');
  const after = overview.windows.find((window) => window.id === 'after');
  const sum = (window, key) => window.events.reduce((total, event) => total + event[key], 0);
  const oldSpend = sum(before, 'spendGB');
  const newSpend = sum(after, 'spendGB');
  const kpis = [
    ['GB spend', `${oldSpend} -> ${newSpend} GB`, oldSpend ? `${((newSpend / oldSpend - 1) * 100).toFixed(1)}% between equal windows` : 'No previous spend to compare'],
    ['Store opens', `${sum(before, 'opened')} -> ${sum(after, 'opened')}`, 'Investigate demand versus store availability'],
    ['Client crashes', `${sum(before, 'crashes')} -> ${sum(after, 'crashes')}`, 'Distinct stopped store clients']
  ];
  $('#incident-kpis').replaceChildren(...kpis.map(([label, value, note]) => {
    const card = element('div', undefined, 'incident-kpi');
    card.append(element('span', label, 'stat-label'), element('strong', value), element('p', note, 'small muted'));
    return card;
  }));
  const headers = ['Event', 'Window / version', 'Store opens', 'Offers rendered', 'Render rate', 'Buyers', 'GB spend', 'Client crashes'];
  $('#history-funnel').replaceChildren(table(headers, overview.windows.flatMap((window) =>
    window.events.map((event) => [titles.get(event.eventId), `${window.label} / ${event.configVersion}`, ...funnelRow(event)])
  ), 'Synthetic historical store funnel'));
  $('#event-clients').replaceChildren(...overview.events.map(({ config, version }) => {
    const card = element('article', undefined, 'experiment-card');
    card.append(element('h3', config.title), element('p', config.enabled ? 'Event active' : 'Event paused', 'small'),
      element('p', version, 'small muted'));
    const link = element('a', `Open ${config.title} client`, 'button primary');
    link.href = `/store.html?${new URLSearchParams({ event: config.id })}`;
    link.target = '_blank';
    link.rel = 'noopener';
    card.append(link);
    return card;
  }));
  $('#catalog-version').textContent = `Catalog version: ${overview.catalog.version}. Currency: ${overview.currency.name} (${overview.currency.code}).`;
  $('#catalog-table').replaceChildren(table(['Item ID', 'Name', 'Price'], overview.catalog.items.map((item) =>
    [element('code', item.id), item.name, `${item.priceGB} GB`]
  ), 'Available catalog items'));
  $('#sandbox-results').replaceChildren(overview.local.length
    ? table(['Event', 'Version', ...headers.slice(2)], overview.local.map((event) =>
      [titles.get(event.eventId), event.configVersion, ...funnelRow(event)]
    ), 'Local sandbox verification by config version')
    : element('p', 'No local store clients yet. Open an event client to reproduce and collect your own traces.', 'empty-state'));
  renderConfig();
}

async function refreshTraces() {
  const query = new URLSearchParams({
    source: $('#trace-source').value, eventId: $('#trace-event').value,
    level: $('#trace-level').value, q: $('#trace-query').value.trim()
  });
  const result = await api(`/api/incident/traces?${query}`);
  const followed = result.traces.length > 0 && result.traces.every((trace) => trace.traceId === query.get('q'));
  const traces = followed ? [...result.traces].reverse() : result.traces;
  $('#trace-count').textContent = `Showing ${traces.length} of ${result.total} matching entries. ${followed ? 'Followed trace: oldest first.' : 'Newest first; narrow the filters or follow a trace for its full sequence.'}`;
  const rows = traces.map((trace) => {
    const source = element('span', trace.source === 'synthetic' ? 'SYNTHETIC' : 'SANDBOX', `badge ${trace.source === 'synthetic' ? 'synthetic' : 'live'}`);
    const severity = element('span', trace.level.toUpperCase(), 'badge trace-level');
    severity.dataset.level = trace.level;
    const detail = element('details', undefined, 'trace-detail');
    detail.append(element('summary', 'Inspect'), element('pre', JSON.stringify(trace.attributes, null, 2)));
    if (trace.stack) detail.append(element('pre', trace.stack, 'trace-stack'));
    const follow = element('button', 'Follow trace', 'button secondary small');
    follow.addEventListener('click', () => run(follow, async () => {
      $('#trace-query').value = trace.traceId;
      $('#trace-source').value = trace.source;
      $('#trace-event').value = trace.eventId;
      $('#trace-level').value = 'all';
      await refreshTraces();
    }));
    detail.append(follow);
    const time = element('div', undefined, 'trace-metadata');
    time.append(element('span', trace.at.replace('T', ' ').replace('Z', ' UTC')), source);
    const event = element('div', undefined, 'trace-metadata');
    event.append(element('strong', titles.get(trace.eventId)), element('code', trace.configVersion, 'trace-reference'));
    const origin = element('div', undefined, 'trace-metadata');
    origin.append(severity, element('span', trace.service));
    const entry = element('div', undefined, 'trace-metadata');
    entry.append(element('code', trace.name), element('span', trace.message, 'trace-message'));
    return [
      detail, time, event, origin, entry, element('code', trace.traceId, 'trace-reference')
    ];
  });
  $('#trace-results').replaceChildren(rows.length
    ? table(['Details', 'Time / source', 'Event / version', 'Level / service', 'Entry', 'Trace ID'], rows, 'Incident traces')
    : element('p', 'No matching traces. Try a different source, level, event or search text.', 'empty-state'));
}

async function run(button, operation) {
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

$('#config-event').addEventListener('change', renderConfig);
$('#trace-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void run(event.currentTarget.querySelector('button'), refreshTraces);
});
$('#refresh-incident').addEventListener('click', (event) => run(event.currentTarget, async () => {
  await refreshOverview();
  await refreshTraces();
  showMessage('Incident evidence refreshed. Historical case data is unchanged.');
}));
$('#event-config-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void run(event.currentTarget.querySelector('button'), async () => {
    const selected = overview.events.find((entry) => entry.config.id === $('#config-event').value);
    let config;
    try {
      config = JSON.parse($('#event-config').value);
    } catch (error) {
      throw new Error('Config must be valid JSON. Nothing was published.', { cause: error });
    }
    const saved = await api(`/api/incident/events/${selected.config.id}/config`, {
      method: 'PUT', body: { config, expectedVersion: selected.version }
    });
    await refreshOverview();
    await refreshTraces();
    showMessage(`Published ${saved.version}. Open a new event client to verify it; historical numbers have not changed.`);
  });
});
$('#reset-incident').addEventListener('click', (event) => {
  if (!confirm('Clear only sandbox incident traces? Event configs, synthetic history, normal game rounds and experiments will stay unchanged.')) return;
  void run(event.currentTarget, async () => {
    const result = await api('/api/incident/reset', { method: 'POST', body: { confirmation: 'RESET INCIDENT TRACES' } });
    await refreshOverview();
    await refreshTraces();
    showMessage(result.message);
  });
});

async function initialize() {
  try {
    const query = new URLSearchParams(location.search);
    if (query.has('eventId')) $('#trace-event').value = query.get('eventId');
    if (query.has('source')) $('#trace-source').value = query.get('source');
    if (query.has('q')) $('#trace-query').value = query.get('q');
    await refreshOverview();
    await refreshTraces();
  } catch (error) {
    showMessage(error.message, true);
  }
}
void initialize();
