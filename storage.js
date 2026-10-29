import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function writeJson(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
}

async function readOrCreate(file, initial) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeFile(file, initial, { encoding: 'utf8', flag: 'wx' });
    return initial;
  }
}

export async function createEventLog(directory) {
  await mkdir(directory, { recursive: true });
  const eventFile = path.join(directory, 'events.jsonl');
  const rawEvents = await readOrCreate(eventFile, '');
  let events;
  try {
    events = rawEvents.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    throw new Error(`Cannot read workshop data in ${directory}. Restore the damaged file before restarting.`, { cause: error });
  }
  let queue = Promise.resolve();

  return {
    get events() { return events; },
    // Serialize read-modify-write operations, not just the final disk writes.
    mutate(operation) {
      const result = queue.then(operation);
      queue = result.catch(() => {});
      return result;
    },
    async append(newEvents) {
      await appendFile(eventFile, newEvents.map((event) => JSON.stringify(event)).join('\n') + '\n');
      events.push(...newEvents);
    },
    async reset() {
      await writeFile(eventFile, '');
      events = [];
    }
  };
}

export async function createStorage(directory) {
  const log = await createEventLog(directory);
  const experimentFile = path.join(directory, 'experiments.json');
  const experimentsText = await readOrCreate(experimentFile, '[]\n');
  let experiments;
  try {
    experiments = JSON.parse(experimentsText);
  } catch (error) {
    throw new Error(`Cannot read workshop data in ${directory}. Restore the damaged file before restarting.`, { cause: error });
  }
  if (!Array.isArray(experiments)) throw new Error('Stored experiments must be a JSON array.');
  return {
    get events() { return log.events; },
    get experiments() { return experiments; },
    mutate: log.mutate,
    append: log.append,
    async saveExperiments(next) {
      await writeJson(experimentFile, next);
      experiments = next;
    },
    async reset() {
      await log.reset();
      await writeJson(experimentFile, []);
      experiments = [];
    }
  };
}
