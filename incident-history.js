import { createHash } from 'node:crypto';
import { resolveOffers } from './public/store-offers.js';

export function eventVersion(config) {
  const contents = JSON.stringify({
    id: config.id, title: config.title, enabled: config.enabled,
    revision: config.revision, offerItemIds: config.offerItemIds
  });
  const hash = createHash('sha256').update(contents).digest('hex').slice(0, 6);
  return `${config.id}@${config.revision}:${hash}`;
}

export function historyTraces(history, catalog) {
  return history.windows.flatMap((window) => window.events.flatMap((definition) => {
    const { sessions, purchaseEvery, ...config } = definition;
    return Array.from({ length: sessions }, (_, index) => {
      const traceId = `fictional-${window.id}-${config.id}-${String(index + 1).padStart(2, '0')}`;
      const started = Date.parse(window.startsAt) + index * 60000;
      let step = 0;
      const traces = [];
      function record(name, service, attributes = {}, level = 'info', message = name, stack) {
        traces.push({
          id: `${traceId}-${step}`, at: new Date(started + step++ * 100).toISOString(),
          sequence: step,
          source: 'synthetic', window: window.id, eventId: config.id,
          configVersion: eventVersion(config), traceId, name, service, level, message, attributes,
          ...(stack ? { stack } : {})
        });
      }
      record('event_entered', 'client');
      record('store_opened', 'client');
      record('event_config_loaded', 'config', { config, loaded: true });
      record('catalog_loaded', 'catalog', { catalogVersion: catalog.version, loaded: true });
      let offers;
      try {
        offers = resolveOffers(config, catalog);
      } catch (error) {
        if (error.code !== 'CATALOG_ITEM_NOT_FOUND') throw error;
        record('catalog_item_lookup_failed', 'client', { code: error.code, itemId: error.itemId }, 'error', error.message);
        record('client_error', 'client', { code: 'STORE_RENDER_FAILED' }, 'error',
          'Event-store client stopped before offers were rendered.',
          `Error: ${error.message}\n    at resolveOffers (store-offers.js)\n    at renderStore (store.js)`);
        return traces;
      }
      record('offers_rendered', 'client', { itemIds: offers.map((item) => item.id), count: offers.length });
      if (index % purchaseEvery === 0) {
        record('purchase_requested', 'store', { itemId: offers[0].id });
        record('purchase_succeeded', 'store', { itemId: offers[0].id, amountGB: offers[0].priceGB });
      }
      return traces;
    }).flat();
  }));
}

export function storeMetrics(traces) {
  const sessions = (name) => new Set(traces.filter((trace) => trace.name === name).map((trace) => trace.traceId)).size;
  const purchases = traces.filter((trace) => trace.name === 'purchase_succeeded');
  const opened = sessions('store_opened');
  const rendered = sessions('offers_rendered');
  return {
    opened, rendered, buyers: sessions('purchase_succeeded'),
    purchases: purchases.length, crashes: sessions('client_error'),
    spendGB: purchases.reduce((total, trace) => total + trace.attributes.amountGB, 0),
    renderRate: opened ? rendered / opened : null
  };
}
