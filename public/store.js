import { api, element, showMessage } from './api.js';
import { resolveOffers } from './store-offers.js';

const $ = (selector) => document.querySelector(selector);
const eventId = new URLSearchParams(location.search).get('event');
let current;
const requests = new Map();

async function purchase(item, button) {
  button.disabled = true;
  const requestId = requests.get(item.id) ?? crypto.randomUUID();
  requests.set(item.id, requestId);
  try {
    const receipt = await api(`/api/incident/sessions/${current.sessionId}/purchases`, {
      method: 'POST', body: { itemId: item.id, requestId }
    });
    $('#store-balance').textContent = `${receipt.balanceGB} GB`;
    button.textContent = 'Owned in this sandbox client';
    showMessage(`${item.name} purchased for ${receipt.amountGB} pretend GB. The transaction is in this client's trace.`);
  } catch (error) {
    button.disabled = false;
    showMessage(error.message, true);
  }
}

async function stopClient(error) {
  $('#client-state').textContent = 'RECORDING CLIENT FAILURE';
  $('#client-state').dataset.state = 'failed';
  $('#store-failure').hidden = false;
  $('#store-failure').dataset.error = 'true';
  $('#store-offers').replaceChildren();
  try {
    await api(`/api/incident/sessions/${current.sessionId}/error`, {
      method: 'POST',
      keepalive: true,
      body: {
        code: error.code === 'CATALOG_ITEM_NOT_FOUND' ? error.code : 'STORE_RENDER_FAILED',
        message: error.message, stack: error.stack ?? '', ...(error.itemId ? { itemId: error.itemId } : {})
      }
    });
  } catch (loggingError) {
    showMessage(`The client stopped, but its error trace could not be saved: ${loggingError.message}`, true);
  }
  $('#client-state').textContent = 'CLIENT STOPPED';
}

async function renderStore() {
  const offers = resolveOffers(current.config, current.catalog);
  await api(`/api/incident/sessions/${current.sessionId}/rendered`, { method: 'POST', body: {} });
  const cards = offers.map((item) => {
    const card = element('article', undefined, 'store-offer');
    const image = element('img');
    image.src = item.icon;
    image.alt = '';
    image.width = 64;
    image.height = 64;
    const button = element('button', `Buy ${item.name} for ${item.priceGB} GB`, 'button primary');
    button.addEventListener('click', () => purchase(item, button));
    card.append(image, element('h3', item.name), element('p', item.description),
      element('strong', `${item.priceGB} GB`, 'store-price'), button);
    return card;
  });
  $('#store-offers').replaceChildren(...cards);
  $('#client-state').textContent = 'STORE READY';
  $('#client-state').dataset.state = 'ready';
}

$('#new-store-client').addEventListener('click', () => location.reload());

async function initialize() {
  try {
    if (!eventId) throw new Error('Choose an event client from the incident room first.');
    current = await api('/api/incident/sessions', { method: 'POST', body: { eventId } });
    document.title = `${current.config.title} | Event store`;
    $('#store-title').textContent = current.config.title;
    $('#store-version').textContent = `Config snapshot: ${current.configVersion}. Catalog: ${current.catalog.version}.`;
    $('#store-trace').textContent = `Trace ID: ${current.traceId}`;
    $('#inspect-store-trace').href = `/incident.html?${new URLSearchParams({
      eventId, source: 'sandbox', q: current.traceId
    })}`;
    if (!current.config.enabled) {
      $('#client-state').textContent = 'EVENT PAUSED';
      $('#store-failure').hidden = false;
      $('#store-failure-title').textContent = 'This event is paused.';
      $('#store-failure-message').textContent = 'The store is unavailable by configuration. Pausing can mitigate an incident, but does not demonstrate that its offers work.';
      return;
    }
    try {
      await renderStore();
    } catch (error) {
      await stopClient(error);
    }
  } catch (error) {
    $('#client-state').textContent = 'CLIENT UNAVAILABLE';
    showMessage(error.message, true);
  }
}
void initialize();
