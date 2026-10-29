import { createHash } from 'node:crypto';

const CLASSIC_SETTINGS = {
  fragileParcels: false,
  expressParcels: false,
  mistakeLimit: 0,
  expressBonusSeconds: 4
};

export const CONFIG_RULES = {
  title: { type: 'string', min: 1, max: 60 },
  instructions: { type: 'string', min: 1, max: 500 },
  roundSeconds: { type: 'number', min: 15, max: 120 },
  parcelCount: { type: 'number', min: 3, max: 24 },
  showExample: { type: 'boolean' },
  showDestinationLabels: { type: 'boolean' },
  hintsEnabled: { type: 'boolean' },
  fragileParcels: { type: 'boolean' },
  expressParcels: { type: 'boolean' },
  mistakeLimit: { type: 'number', min: 0, max: 10 },
  expressBonusSeconds: { type: 'number', min: 2, max: 10 }
};

export const METRICS = {
  completion: 'First-round completion',
  unassisted: 'First-round completion without hints',
  accuracy: 'Correct attempts / all attempts',
  duration: 'Average first-round duration',
  score: 'Average first-round score'
};

export function invalid(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

export function validateConfig(value, partial = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid('Game settings must be a JSON object.');
  }
  // Original configs and frozen experiments keep their classic handling rules.
  if (!partial) value = { ...CLASSIC_SETTINGS, ...value };
  if (!partial && Object.keys(CONFIG_RULES).some((key) => !(key in value))) {
    throw invalid('Some required game settings are missing.');
  }
  for (const [key, entry] of Object.entries(value)) {
    const rule = CONFIG_RULES[key];
    if (!rule) throw invalid(`Unknown game setting: ${key}.`);
    if (typeof entry !== rule.type) throw invalid(`${key} must be a ${rule.type}.`);
    if (rule.type === 'string' && (entry.trim().length < rule.min || entry.length > rule.max)) {
      throw invalid(`${key} must contain ${rule.min}-${rule.max} characters.`);
    }
    if (rule.type === 'number' && (!Number.isInteger(entry) || entry < rule.min || entry > rule.max)) {
      throw invalid(`${key} must be a whole number between ${rule.min} and ${rule.max}.`);
    }
  }
  return { ...value };
}

function requiredText(value, name, min, max) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) {
    throw invalid(`${name} must contain ${min}-${max} characters.`);
  }
  return value.trim();
}

export function validateProposal(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('An experiment proposal is required.');
  const name = requiredText(value.name, 'Experiment name', 3, 80);
  const hypothesis = requiredText(value.hypothesis, 'Hypothesis', 10, 1000);
  const guardrail = requiredText(value.guardrail, 'Guardrail', 5, 500);
  const decisionRule = requiredText(value.decisionRule, 'Evidence / stopping plan', 10, 1000);
  if (!Object.hasOwn(METRICS, value.primaryMetric)) throw invalid('Choose a supported primary metric.');
  const overrides = validateConfig(value.overrides, true);
  if (!Object.keys(overrides).length) throw invalid('Give variant B at least one changed setting.');
  return { name, hypothesis, guardrail, decisionRule, primaryMetric: value.primaryMetric, overrides };
}

export function assignVariant(playerId, experimentId) {
  const hash = createHash('sha256').update(`${experimentId}:${playerId}`).digest();
  return hash.readUInt32BE(0) < 0x80000000 ? 'A' : 'B';
}

export function configVersion(config) {
  return createHash('sha256').update(JSON.stringify(
    Object.fromEntries(Object.keys(CONFIG_RULES).map((key) => [key, config[key]]))
  )).digest('hex').slice(0, 8);
}

export function resolveExperience(config, experiments, playerId, preview) {
  const experiment = preview
    ? experiments.find((item) => item.id === preview.experimentId)
    : experiments.find((item) => item.status === 'running');
  if (preview && !experiment) throw invalid('That preview experiment no longer exists.', 404);
  const variant = experiment
    ? preview?.variant ?? assignVariant(playerId, experiment.id)
    : 'baseline';
  if (preview && !['A', 'B'].includes(variant)) throw invalid('Preview variant must be A or B.');
  const base = validateConfig(experiment?.baseConfig ?? config);
  return {
    config: { ...base, ...(variant === 'B' ? experiment.overrides : {}) },
    experimentId: experiment?.id ?? null,
    experimentName: experiment?.name ?? 'No experiment',
    variant,
    preview: Boolean(preview)
  };
}
