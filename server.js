import express from 'express';
import { randomInt, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStorage, readJson, writeJson } from './storage.js';
import {
  configVersion, invalid, METRICS, resolveExperience, validateConfig, validateProposal
} from './experiments.js';
import { buildRound, DESTINATIONS, eventsCsv, publicRound, scoreMultiplier, summarizeLive } from './events.js';
import { loadSynthetic } from './synthetic.js';
import { createIncidentRouter } from './incident.js';
import { createCompetitiveRouter } from './competitive.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PLAYER_ID = /^[a-zA-Z0-9-]{8,80}$/;

function playerId(value) {
  if (typeof value !== 'string' || !PLAYER_ID.test(value)) {
    throw invalid('A random player ID of 8-80 letters, numbers or hyphens is required. Do not use a name or email.');
  }
  return value;
}

function previewFrom(value) {
  if (value.preview == null) return null;
  if (!value.preview || typeof value.preview !== 'object' || Array.isArray(value.preview) ||
      typeof value.preview.experimentId !== 'string' || !['A', 'B'].includes(value.preview.variant)) {
    throw invalid('A preview needs an experimentId and variant A or B.');
  }
  return { experimentId: value.preview.experimentId, variant: value.preview.variant };
}

export async function createApp({
  dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, '.local'),
  configFile = path.join(ROOT, 'config.json'),
  syntheticDir = path.join(ROOT, 'data/synthetic'),
  incidentDir = path.join(ROOT, 'data/incident'),
  now = () => Date.now(),
  publicDemo = process.env.PUBLIC_DEMO === '1',
  ephemeral = process.env.DEMO_EPHEMERAL === '1'
} = {}) {
  const storage = await createStorage(dataDir);
  const synthetic = await loadSynthetic(syntheticDir);
  const getConfig = async () => {
    try {
      return validateConfig(await readJson(configFile));
    } catch (error) {
      throw Object.assign(new Error(`Cannot load config.json: ${error.message}`, { cause: error }), { status: 500 });
    }
  };
  await getConfig();
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store'
    });
    if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
      const origin = req.get('origin');
      const allowedOrigins = [`http://${req.get('host')}`, `https://${req.get('host')}`];
      if (origin && !allowedOrigins.includes(origin)) {
        return next(invalid('Use the game page on this same address.', 403));
      }
      if (!req.is('application/json')) return next(invalid('Send JSON with Content-Type: application/json.', 415));
    }
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  app.get('/healthz', (req, res) => res.json({ status: 'ok' }));
  app.get('/api/runtime', (req, res) => res.json({ publicDemo, ephemeral }));
  if (publicDemo) {
    app.get('/', (req, res) => res.redirect(302, '/arena.html'));
    app.use((req, res, next) => {
      const publicApi = req.path.startsWith('/api/competitive/') ||
        req.path === '/api/config' && req.method === 'GET' ||
        req.path === '/api/rounds' && req.method === 'POST' ||
        /^\/api\/rounds\/[^/]+\/(attempts|wrap|hints|end)$/.test(req.path) && req.method === 'POST';
      if (req.path.startsWith('/api/') && !publicApi) return next(invalid('Workshop management tools are unavailable in the public demo.', 403));
      if (['/lab.html', '/lab.js', '/incident.html', '/incident.js', '/store.html', '/store.js', '/store-offers.js', '/WORKSHOP.md'].includes(req.path)) {
        return res.redirect(302, '/arena.html');
      }
      next();
    });
  }
  app.use('/api/competitive', await createCompetitiveRouter({ dataDir, now }));
  app.use('/api/incident', await createIncidentRouter({ dataDir, scenarioDir: incidentDir, now }));

  function eventFor(round, type, extra = {}, timestamp = now()) {
    return {
      at: new Date(timestamp).toISOString(),
      type, roundId: round.roundId, playerId: round.playerId,
      experimentId: round.experimentId, experimentName: round.experimentName,
      variant: round.variant, preview: round.preview, configVersion: round.configVersion,
      ...extra
    };
  }

  function ownedRound(req) {
    const round = buildRound(storage.events, req.params.id, now());
    if (round.playerId !== playerId(req.body?.playerId)) throw invalid('This round belongs to another anonymous player.', 403);
    return round;
  }

  async function experience(id, preview) {
    return resolveExperience(await getConfig(), storage.experiments, id, preview);
  }

  app.get('/api/config', async (req, res) => {
    const preview = req.query.experimentId || req.query.variant
      ? previewFrom({ preview: { experimentId: req.query.experimentId, variant: req.query.variant } })
      : null;
    const result = await experience(playerId(req.query.playerId), preview);
    res.json({ ...result, destinations: DESTINATIONS });
  });

  app.get('/api/settings', async (req, res) => {
    res.json({ config: await getConfig(), metrics: METRICS });
  });

  app.put('/api/config', async (req, res) => {
    const config = validateConfig(req.body);
    await storage.mutate(async () => {
      if (storage.experiments.some((item) => item.status === 'running')) {
        throw invalid('Stop the running experiment before changing base settings. Its config is frozen for a fair comparison.', 409);
      }
      await writeJson(configFile, config);
    });
    res.json({ config });
  });

  app.post('/api/rounds', async (req, res) => {
    const id = playerId(req.body?.playerId);
    const preview = previewFrom(req.body);
    const round = await storage.mutate(async () => {
      const selected = await experience(id, preview);
      const start = {
        ...selected,
        roundId: randomUUID(),
        playerId: id,
        configVersion: configVersion(selected.config),
        parcels: Array.from({ length: selected.config.parcelCount }, (_, index) => ({
          id: `parcel-${index + 1}`,
          destination: DESTINATIONS[randomInt(DESTINATIONS.length)].id,
          fragile: selected.config.fragileParcels && index >= 2 && (index < 9 ? index % 3 === 2 : index % 2 === 0),
          express: selected.config.expressParcels && index >= 3 && index % 3 === 0
        }))
      };
      await storage.append([eventFor(start, 'round_started', {
        config: start.config, parcels: start.parcels
      })]);
      return buildRound(storage.events, start.roundId, now());
    });
    res.status(201).json(publicRound(round));
  });

  app.post('/api/rounds/:id/attempts', async (req, res) => {
    const result = await storage.mutate(async () => {
      const round = ownedRound(req);
      if (round.status !== 'playing') throw invalid('This shift has ended. Start a new shift to play again.', 409);
      const parcel = round.parcels[round.sorted];
      if (req.body.parcelId !== parcel.id) throw invalid('Sort the parcel currently on the desk.', 409);
      if (!DESTINATIONS.some((item) => item.id === req.body.destination)) throw invalid('Choose one of the three destinations.');
      const needsWrapping = parcel.fragile && !round.wrappedParcels.includes(parcel.id);
      const correct = parcel.destination === req.body.destination && !needsWrapping;
      const reason = needsWrapping ? 'needs_wrapping' : correct ? 'delivered' : 'wrong_destination';
      const expressBonus = correct && parcel.express && round.expressRemainingMs > 0 ? 75 : 0;
      const points = correct ? 100 * scoreMultiplier(round.streak + 1) + expressBonus : -25;
      const events = [eventFor(round, 'parcel_sorted', {
        parcelId: parcel.id, destination: req.body.destination, correct, reason, points, expressBonus
      })];
      if (correct && round.sorted + 1 === round.parcels.length) {
        events.push(eventFor(round, 'round_ended', { status: 'completed' }));
      } else if (!correct && round.config.mistakeLimit && round.mistakes + 1 >= round.config.mistakeLimit) {
        events.push(eventFor(round, 'round_ended', { status: 'overloaded' }));
      }
      await storage.append(events);
      return { ...publicRound(buildRound(storage.events, round.roundId, now())), correct, reason, points, expressBonus };
    });
    res.json(result);
  });

  app.post('/api/rounds/:id/wrap', async (req, res) => {
    const result = await storage.mutate(async () => {
      const round = ownedRound(req);
      if (round.status !== 'playing') throw invalid('This shift has ended.', 409);
      const parcel = round.parcels[round.sorted];
      if (req.body.parcelId !== parcel.id) throw invalid('Wrap the parcel currently on the desk.', 409);
      if (!parcel.fragile) throw invalid('This parcel does not need wrapping.', 409);
      if (!round.wrappedParcels.includes(parcel.id)) {
        await storage.append([eventFor(round, 'parcel_wrapped', { parcelId: parcel.id })]);
      }
      return publicRound(buildRound(storage.events, round.roundId, now()));
    });
    res.json(result);
  });

  app.post('/api/rounds/:id/hints', async (req, res) => {
    const result = await storage.mutate(async () => {
      const round = ownedRound(req);
      if (round.status !== 'playing') throw invalid('This shift has ended.', 409);
      if (!round.config.hintsEnabled) throw invalid('Hints are disabled for this shift.', 409);
      const parcel = round.parcels[round.sorted];
      if (req.body.parcelId !== parcel.id) throw invalid('Request a hint for the current parcel.', 409);
      if (!round.hintedParcels.includes(parcel.id)) {
        await storage.append([eventFor(round, 'hint_used', { parcelId: parcel.id })]);
      }
      return { ...publicRound(buildRound(storage.events, round.roundId, now())), destination: parcel.destination };
    });
    res.json(result);
  });

  app.post('/api/rounds/:id/end', async (req, res) => {
    const result = await storage.mutate(async () => {
      const round = ownedRound(req);
      if (!['time_up', 'abandoned'].includes(req.body.reason)) throw invalid('End reason must be time_up or abandoned.');
      if (round.status === 'playing' && req.body.reason === 'time_up') {
        throw invalid('The timer has not expired yet.', 409);
      }
      const hasEnd = storage.events.some((event) => event.roundId === round.roundId && event.type === 'round_ended');
      if (!hasEnd) {
        const timestamp = round.status === 'timed_out'
          ? Date.parse(round.at) + round.config.roundSeconds * 1000 : now();
        await storage.append([eventFor(round, 'round_ended', {
          status: round.status === 'playing' ? 'abandoned' : round.status
        }, timestamp)]);
      }
      return publicRound(buildRound(storage.events, round.roundId, now()));
    });
    res.json(result);
  });

  app.get('/api/experiments', (req, res) => res.json({ experiments: storage.experiments }));

  app.post('/api/experiments', async (req, res) => {
    const proposal = validateProposal(req.body);
    const experiment = { ...proposal, id: randomUUID(), status: 'draft', createdAt: new Date(now()).toISOString() };
    await storage.mutate(() => storage.saveExperiments([...storage.experiments, experiment]));
    res.status(201).json(experiment);
  });

  app.post('/api/experiments/:id/start', async (req, res) => {
    const experiment = await storage.mutate(async () => {
      const draft = storage.experiments.find((item) => item.id === req.params.id);
      if (!draft) throw invalid('Experiment not found.', 404);
      if (draft.status !== 'draft') throw invalid('Only a draft can be launched. Create a new proposal to run another test.', 409);
      if (storage.experiments.some((item) => item.status === 'running')) throw invalid('Stop the current experiment before launching another.', 409);
      const baseConfig = await getConfig();
      if (Object.entries(draft.overrides).every(([key, value]) => baseConfig[key] === value)) {
        throw invalid('Variant B is identical to A. Change a setting before proposing the test.');
      }
      const running = { ...draft, status: 'running', startedAt: new Date(now()).toISOString(), baseConfig };
      await storage.saveExperiments(storage.experiments.map((item) => item.id === draft.id ? running : item));
      return running;
    });
    res.json(experiment);
  });

  app.post('/api/experiments/:id/stop', async (req, res) => {
    const experiment = await storage.mutate(async () => {
      const running = storage.experiments.find((item) => item.id === req.params.id);
      if (!running) throw invalid('Experiment not found.', 404);
      if (running.status !== 'running') throw invalid('That experiment is not running.', 409);
      const stopped = { ...running, status: 'stopped', stoppedAt: new Date(now()).toISOString() };
      await storage.saveExperiments(storage.experiments.map((item) => item.id === stopped.id ? stopped : item));
      return stopped;
    });
    res.json(experiment);
  });

  app.get('/api/results', (req, res) => res.json(summarizeLive(storage.events, now())));
  app.get('/api/events.csv', (req, res) => {
    res.attachment('local-workshop-events.csv').type('text/csv').send(eventsCsv(storage.events));
  });
  app.get('/api/synthetic', (req, res) => {
    res.json({ datasets: synthetic.map(({ csv, ...dataset }) => dataset) });
  });
  app.get('/api/synthetic/:id.csv', (req, res) => {
    const dataset = synthetic.find((item) => item.id === req.params.id);
    if (!dataset) throw invalid('Synthetic dataset not found.', 404);
    res.attachment(`synthetic-${dataset.id}.csv`).type('text/csv').send(dataset.csv);
  });
  app.post('/api/reset', async (req, res) => {
    if (req.body?.confirmation !== 'RESET LOCAL DATA') throw invalid('Reset requires the exact confirmation RESET LOCAL DATA.');
    await storage.mutate(() => storage.reset());
    res.json({ message: 'Local rounds and experiment proposals cleared. Game settings and synthetic data are unchanged.' });
  });

  app.get('/WORKSHOP.md', async (req, res) => {
    res.type('text/plain').sendFile(path.join(ROOT, 'WORKSHOP.md'));
  });
  app.get('/classic.html', (req, res) => res.sendFile(path.join(ROOT, 'public/index.html')));
  app.use(express.static(path.join(ROOT, 'public'), { etag: false, maxAge: 0 }));
  app.use('/api', (req, res, next) => next(invalid('API route not found.', 404)));
  app.use((req, res) => res.status(404).type('text/plain').send('Page not found. Open / for the game or /lab.html for the workshop lab.'));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status ?? 500;
    if (status >= 500) console.error('Workshop error:', error);
    const message = error.type === 'entity.parse.failed' ? 'The request body is not valid JSON.'
      : status >= 500 ? 'The local workshop could not read or save its data. Check the terminal for details.'
      : error.message;
    res.status(status).json({ error: message });
  });
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT must be a whole number between 1 and 65535.');
    process.exitCode = 1;
  } else {
    try {
      const app = await createApp();
      const host = process.env.HOST || '127.0.0.1';
      const server = app.listen(port, host, () => {
        console.log(`Parcel Pals listening on ${host}:${port}`);
        console.log(`Arena: http://127.0.0.1:${port}/arena.html`);
        console.log('Keep this process running to serve the game.');
      });
      server.on('error', (error) => {
        console.error(`Could not start the local workshop: ${error.message}`);
        process.exitCode = 1;
      });
    } catch (error) {
      console.error(`Could not start the local workshop: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
