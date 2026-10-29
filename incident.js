import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createEventLog, readJson, writeJson } from './storage.js';
import { invalid } from './experiments.js';
import { eventVersion, historyTraces, storeMetrics } from './incident-history.js';
import { resolveOffers } from './public/store-offers.js';

const EVENT_IDS = ['garden-fair', 'moonlight-mail'];
const IDENTIFIER = /^[a-z][a-z0-9_-]{1,60}$/;
const REQUEST_ID = /^[a-zA-Z0-9-]{8,80}$/;

function validateEvent(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config) ||
      !EVENT_IDS.includes(config.id) || typeof config.title !== 'string' ||
      config.title.trim().length < 1 || config.title.length > 80 ||
      typeof config.enabled !== 'boolean' || !Number.isInteger(config.revision) || config.revision < 1 ||
      !Array.isArray(config.offerItemIds) || config.offerItemIds.length < 1 || config.offerItemIds.length > 6 ||
      config.offerItemIds.some((id) => typeof id !== 'string' || !IDENTIFIER.test(id)) ||
      new Set(config.offerItemIds).size !== config.offerItemIds.length ||
      Object.keys(config).some((key) => !['id', 'title', 'enabled', 'revision', 'offerItemIds'].includes(key))) {
    throw invalid('Event config needs id, title, enabled, a positive integer revision, and 1-6 unique offerItemIds.');
  }
  return config;
}

function validateCatalog(catalog) {
  if (!catalog || typeof catalog.version !== 'string' || catalog.currency?.code !== 'GB' ||
      !Array.isArray(catalog.items) || !catalog.items.length ||
      new Set(catalog.items.map((item) => item.id)).size !== catalog.items.length ||
      catalog.items.some((item) => typeof item.id !== 'string' || !IDENTIFIER.test(item.id) ||
        typeof item.name !== 'string' || typeof item.description !== 'string' ||
        !Number.isInteger(item.priceGB) || item.priceGB <= 0 ||
        typeof item.icon !== 'string' || !/^\/assets\/[a-z-]+\.svg$/.test(item.icon))) {
    throw new Error('The incident catalog is invalid. Check data/incident/catalog.json.');
  }
  return catalog;
}

export async function createIncidentRouter({ dataDir, scenarioDir, now }) {
  const log = await createEventLog(path.join(dataDir, 'incident'));
  const catalog = validateCatalog(await readJson(path.join(scenarioDir, 'catalog.json')));
  const history = await readJson(path.join(scenarioDir, 'history.json'));
  if (history.synthetic !== true || !Array.isArray(history.windows) || history.windows.length !== 2 ||
      new Set(history.windows.map((window) => window.id)).size !== 2) {
    throw new Error('The incident needs two explicitly synthetic observation windows.');
  }
  for (const window of history.windows) {
    if (!['before', 'after'].includes(window.id) || !Number.isFinite(Date.parse(window.startsAt)) ||
        Date.parse(window.endsAt) - Date.parse(window.startsAt) !== 3600000 || !Array.isArray(window.events) ||
        window.events.length !== EVENT_IDS.length || new Set(window.events.map((event) => event.id)).size !== EVENT_IDS.length) {
      throw new Error('Incident history windows must be valid, equal one-hour periods.');
    }
    for (const { sessions, purchaseEvery, ...config } of window.events) {
      validateEvent(config);
      if (!Number.isInteger(sessions) || sessions < 1 || sessions > 60 ||
          !Number.isInteger(purchaseEvery) || purchaseEvery < 1) throw new Error('Invalid fictional incident session counts.');
    }
  }
  const synthetic = historyTraces(history, catalog);
  const router = Router();
  let sequence = log.events.reduce((highest, trace, index) => Math.max(highest, trace.sequence ?? index), -1) + 1;

  function configFile(id) {
    if (!EVENT_IDS.includes(id)) throw invalid('LiveOps event not found.', 404);
    return path.join(scenarioDir, 'events', `${id}.json`);
  }
  async function loadEvent(id) {
    // Load the released config as-is: cross-catalog validation is part of the exercise.
    const config = validateEvent(await readJson(configFile(id)));
    if (config.id !== id) throw new Error('Event config ID does not match its file.');
    return config;
  }
  await Promise.all(EVENT_IDS.map(loadEvent));

  function record(config, traceId, name, service, attributes = {}, level = 'info', message = name, stack) {
    return {
      id: randomUUID(), at: new Date(now()).toISOString(), source: 'sandbox',
      sequence: sequence++,
      eventId: config.id, configVersion: eventVersion(config), traceId,
      name, service, level, message, attributes, ...(stack ? { stack } : {})
    };
  }

  function session(id) {
    const traces = log.events.filter((trace) => trace.traceId === id);
    const config = traces.find((trace) => trace.name === 'event_config_loaded')?.attributes.config;
    const sessionCatalog = traces.find((trace) => trace.name === 'catalog_loaded')?.attributes.catalog;
    if (!config || !sessionCatalog) throw invalid('Sandbox session not found. Open a new event-store client.', 404);
    return {
      config, catalog: sessionCatalog, traces,
      balanceGB: 100 - traces.filter((trace) => trace.name === 'purchase_succeeded')
        .reduce((total, trace) => total + trace.attributes.amountGB, 0)
    };
  }

  function assertUsable(current) {
    if (!current.config.enabled) throw invalid('This event is paused.', 409);
    if (current.traces.some((trace) => trace.name === 'client_error')) {
      throw invalid('This store client has stopped. Open a new client after checking the configuration.', 409);
    }
  }

  router.get('/overview', async (req, res) => {
    const configs = await Promise.all(EVENT_IDS.map(loadEvent));
    const localGroups = new Map();
    for (const trace of log.events.filter((entry) => entry.name === 'store_opened')) {
      localGroups.set(`${trace.eventId}:${trace.configVersion}`, {
        eventId: trace.eventId, configVersion: trace.configVersion
      });
    }
    res.json({
      currency: catalog.currency,
      events: configs.map((config) => ({ config, version: eventVersion(config) })),
      catalog,
      windows: history.windows.map((window) => ({
        id: window.id, label: window.label, startsAt: window.startsAt, endsAt: window.endsAt,
        events: EVENT_IDS.map((eventId) => ({
          eventId,
          configVersion: eventVersion(window.events.find((config) => config.id === eventId)),
          ...storeMetrics(synthetic.filter((trace) => trace.window === window.id && trace.eventId === eventId))
        }))
      })),
      local: [...localGroups.values()].map((group) => ({
        ...group,
        ...storeMetrics(log.events.filter((trace) => trace.eventId === group.eventId && trace.configVersion === group.configVersion))
      }))
    });
  });

  router.get('/traces', (req, res) => {
    const { source = 'all', eventId = 'all', level = 'all', q = '' } = req.query;
    if (!['all', 'synthetic', 'sandbox'].includes(source) || !['all', ...EVENT_IDS].includes(eventId) ||
        !['all', 'info', 'warn', 'error'].includes(level) || typeof q !== 'string' || q.length > 200) {
      throw invalid('Choose a valid trace source, event, severity and search text.');
    }
    const matches = [...synthetic, ...log.events].filter((trace) =>
      (source === 'all' || trace.source === source) && (eventId === 'all' || trace.eventId === eventId) &&
      (level === 'all' || trace.level === level) && JSON.stringify(trace).toLowerCase().includes(q.toLowerCase())
    ).sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (b.sequence ?? 0) - (a.sequence ?? 0));
    res.json({ total: matches.length, traces: matches.slice(0, 150) });
  });

  router.get('/traces.jsonl', (req, res) => {
    res.attachment('incident-traces.jsonl').type('application/x-ndjson')
      .send([...synthetic, ...log.events].map((trace) => JSON.stringify(trace)).join('\n') + '\n');
  });

  router.post('/sessions', async (req, res) => {
    const result = await log.mutate(async () => {
      const config = await loadEvent(req.body?.eventId);
      const id = randomUUID();
      const events = [
        record(config, id, 'event_entered', 'client'),
        record(config, id, 'store_opened', 'client'),
        record(config, id, 'event_config_loaded', 'config', { config, loaded: true }),
        record(config, id, 'catalog_loaded', 'catalog', { catalog, catalogVersion: catalog.version, loaded: true })
      ];
      if (!config.enabled) events.push(record(config, id, 'event_paused', 'client'));
      await log.append(events);
      return { sessionId: id, traceId: id, config, configVersion: eventVersion(config), catalog, balanceGB: 100 };
    });
    res.status(201).json(result);
  });

  router.post('/sessions/:id/rendered', async (req, res) => {
    await log.mutate(async () => {
      const current = session(req.params.id);
      assertUsable(current);
      let offers;
      try {
        offers = resolveOffers(current.config, current.catalog);
      } catch (error) {
        if (error.code !== 'CATALOG_ITEM_NOT_FOUND') throw error;
        throw invalid('The configured offers could not be rendered. Inspect this session trace.', 409);
      }
      if (!current.traces.some((trace) => trace.name === 'offers_rendered')) {
        await log.append([record(current.config, req.params.id, 'offers_rendered', 'client', {
          count: offers.length, itemIds: offers.map((item) => item.id)
        })]);
      }
    });
    res.json({ recorded: true });
  });

  router.post('/sessions/:id/error', async (req, res) => {
    const { code, message, stack = '', itemId } = req.body ?? {};
    if (!['CATALOG_ITEM_NOT_FOUND', 'STORE_RENDER_FAILED'].includes(code) ||
        typeof message !== 'string' || message.length < 1 || message.length > 1000 ||
        typeof stack !== 'string' || stack.length > 6000 ||
        (itemId !== undefined && (typeof itemId !== 'string' || !IDENTIFIER.test(itemId)))) {
      throw invalid('A client error needs a supported code, message and bounded stack.');
    }
    await log.mutate(async () => {
      const current = session(req.params.id);
      if (current.traces.some((trace) => trace.name === 'client_error')) return;
      const events = [];
      if (code === 'CATALOG_ITEM_NOT_FOUND') events.push(record(current.config, req.params.id,
        'catalog_item_lookup_failed', 'client', { code, itemId }, 'error', message));
      events.push(record(current.config, req.params.id, 'client_error', 'client',
        { code: 'STORE_RENDER_FAILED', cause: code }, 'error', 'Event-store client stopped before offers were rendered.', stack));
      await log.append(events);
    });
    res.json({ recorded: true });
  });

  router.post('/sessions/:id/purchases', async (req, res) => {
    const { itemId, requestId } = req.body ?? {};
    if (typeof itemId !== 'string' || !IDENTIFIER.test(itemId) ||
        typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) throw invalid('A purchase needs an itemId and a random requestId.');
    const receipt = await log.mutate(async () => {
      const current = session(req.params.id);
      assertUsable(current);
      const existing = current.traces.find((trace) => trace.name === 'purchase_succeeded' && trace.attributes.requestId === requestId);
      if (existing) {
        if (existing.attributes.itemId !== itemId) throw invalid('That purchase request ID was already used for another item.', 409);
        return { ...existing.attributes, balanceGB: current.balanceGB };
      }
      const item = current.catalog.items.find((entry) => entry.id === itemId);
      const rendered = current.traces.some((trace) => trace.name === 'offers_rendered');
      const owned = current.traces.some((trace) => trace.name === 'purchase_succeeded' && trace.attributes.itemId === itemId);
      let rejection;
      if (!rendered || !current.config.offerItemIds.includes(itemId) || !item) rejection = 'Item is not available in this rendered store.';
      else if (owned) rejection = 'This sandbox client already owns that item.';
      else if (current.balanceGB < item.priceGB) rejection = 'Not enough Game Bits in this sandbox client.';
      if (rejection) {
        await log.append([record(current.config, req.params.id, 'purchase_rejected', 'store', { itemId, requestId }, 'warn', rejection)]);
        throw invalid(rejection, 409);
      }
      const attributes = { itemId, requestId, amountGB: item.priceGB };
      await log.append([
        record(current.config, req.params.id, 'purchase_requested', 'store', { itemId, requestId }),
        record(current.config, req.params.id, 'purchase_succeeded', 'store', attributes)
      ]);
      return { ...attributes, balanceGB: current.balanceGB - item.priceGB };
    });
    res.json(receipt);
  });

  router.put('/events/:id/config', async (req, res) => {
    const config = validateEvent(req.body?.config);
    if (config.id !== req.params.id) throw invalid('The event ID cannot be changed.');
    const saved = await log.mutate(async () => {
      const current = await loadEvent(req.params.id);
      if (req.body.expectedVersion !== eventVersion(current)) throw invalid('This config changed since you opened it. Reload it before saving.', 409);
      if (config.revision !== current.revision) throw invalid('Leave revision unchanged; publishing increments it automatically.');
      if (config.enabled) {
        try {
          resolveOffers(config, catalog);
        } catch (error) {
          if (error.code !== 'CATALOG_ITEM_NOT_FOUND') throw error;
          await log.append([record(current, `config-${randomUUID()}`, 'config_validation_failed', 'config',
            { code: error.code, itemId: error.itemId }, 'error', error.message)]);
          throw invalid(`Config was not published: ${error.message}`);
        }
      }
      const next = { ...config, revision: current.revision + 1 };
      await writeJson(configFile(next.id), next);
      await log.append([record(next, `config-${randomUUID()}`, 'config_published', 'config',
        { previousVersion: eventVersion(current), nextVersion: eventVersion(next) })]);
      return { config: next, version: eventVersion(next) };
    });
    res.json(saved);
  });

  router.post('/reset', async (req, res) => {
    if (req.body?.confirmation !== 'RESET INCIDENT TRACES') throw invalid('Confirm with RESET INCIDENT TRACES.');
    await log.mutate(() => log.reset());
    res.json({ message: 'Sandbox incident traces cleared. Historical evidence, event configs and normal game data are unchanged.' });
  });
  return router;
}
