import { DEFAULT_V2, ENGINE_VERSION, runCity } from './city-v2.mjs';
import { STRATEGIES_V2, ALGORITHM_VERSION } from './observed-v2.mjs';

export const EXPERIMENT_VERSION = 'paired-factorial-v2.2';
const METRICS = ['served', 'due', 'rate', 'transfers', 'newPurchases', 'cashMinor', 'reservedMinor',
  'freeCashMinor', 'inventoryBookMinor', 'unpaidMinor', 'resultMinor', 'inventoryCount',
  'idleItemWeeks', 'comparisonResultMinor', 'comparisonIdleItemWeeks', 'consumerAverageNetSpendMinor', 'guaranteeCount', 'latePickupItemWeeks'];
const mean = values => values.reduce((s, x) => s + x, 0) / values.length;
function stats(values) {
  const average = mean(values), variance = values.length > 1 ? values.reduce((s, x) => s + (x - average) ** 2, 0) / (values.length - 1) : 0;
  const se = Math.sqrt(variance / values.length);
  // t(9) for the fixed 10-seed experiment; 1.96 otherwise explicitly approximate.
  const critical = values.length === 10 ? 2.262 : 1.96;
  return { n: values.length, mean: average, min: Math.min(...values), max: Math.max(...values),
    sd: Math.sqrt(variance), interval95: [average - critical * se, average + critical * se],
    intervalMethod: values.length === 10 ? 'paired mean t interval, df=9' : 'normal approximation' };
}

export async function runExperiment(input = {}, onProgress) {
  const { seeds = Array.from({ length: 10 }, (_, i) => 101 + i), scenarios = ['normal', 'demand', 'capacity'], ...settings } = input;
  if (seeds.length < 10 || new Set(seeds).size !== seeds.length) throw new Error('At least ten distinct common seeds required');
  if (!['normal', 'demand', 'capacity'].every(s => scenarios.includes(s))) throw new Error('Normal, demand and capacity scenarios required');
  const config = { ...DEFAULT_V2, ...settings }, total = seeds.length * scenarios.length * STRATEGIES_V2.length;
  const runs = []; let completed = 0;
  for (const scenario of scenarios) for (const seed of seeds) for (const strategy of STRATEGIES_V2) {
    const city = runCity({ ...config, seed, scenario, strategy: strategy.id });
    const { terminalResponsibilities, ...summary } = city.summary;
    const { platformInventoryAges, ...terminal } = terminalResponsibilities;
    runs.push({ seed, scenario, strategy: strategy.id, config: city.config, summary,
      provenance: Object.fromEntries(['engineVersion', 'engineCommit', 'worldVersion', 'observationSchemaVersion',
        'algorithmVersion', 'policyVersion', 'behaviorVersion', 'metricsVersion', 'clockVersion',
        'configFingerprint', 'policyFingerprint', 'worldFixtureFingerprint', 'fingerprintMethod'].map(key => [key, city.metadata[key]])),
      terminalResponsibilities: { ...terminal, inventoryAgeCount: platformInventoryAges.length,
        inventoryAgeMeanWeeks: platformInventoryAges.length ? mean(platformInventoryAges.map(a => a.ageWeeks)) : null,
        inventoryAgeMaxWeeks: platformInventoryAges.length ? Math.max(...platformInventoryAges.map(a => a.ageWeeks)) : null },
      forecastEvaluation: { count: city.forecastEvaluation.count, mae: city.forecastEvaluation.mae, bias: city.forecastEvaluation.bias },
      bridges: city.metadata.bridges, eventCount: city.events.length,
    });
    completed++;
    if (onProgress) await onProgress({ completed, total, progress: completed / total, seed, scenario, strategy: strategy.id });
    // Yield to the browser between every true simulation so progress can paint.
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  const aggregates = scenarios.flatMap(scenario => STRATEGIES_V2.map(strategy => {
    const selected = runs.filter(r => r.scenario === scenario && r.strategy === strategy.id);
    return { scenario, strategy: strategy.id, count: selected.length,
      metrics: Object.fromEntries(METRICS.map(key => [key, stats(selected.map(r => r.summary[key]))])) };
  }));
  const pairedDifferences = scenarios.flatMap(scenario => [['A', 'B'], ['C', 'D']].map(([baseline, treatment]) => {
    const pairs = seeds.map(seed => {
      const a = runs.find(r => r.scenario === scenario && r.seed === seed && r.strategy === baseline);
      const b = runs.find(r => r.scenario === scenario && r.seed === seed && r.strategy === treatment);
      return { seed, differences: Object.fromEntries(METRICS.map(key => [key, b.summary[key] - a.summary[key]])) };
    });
    return { scenario, comparison: `${treatment}-${baseline}`, baseline, treatment, pairs,
      metrics: Object.fromEntries(METRICS.map(key => [key, stats(pairs.map(p => p.differences[key]))])) };
  }));
  return { config: { ...config, seeds, scenarios }, runs, aggregates, pairedDifferences,
    metadata: { experimentVersion: EXPERIMENT_VERSION, engineVersion: ENGINE_VERSION, algorithmVersion: ALGORITHM_VERSION,
      runCount: total, seeds, scenarios, groups: STRATEGIES_V2, currency: 'CNY', moneyUnit: 'minor',
      windows: { warmup: [0, 11], comparison: [12, config.weeks - 1] },
      responsibilityPairs: [{ baseline: 'A', treatment: 'B', guarantee: false }, { baseline: 'C', treatment: 'D', guarantee: true }],
      changedWithinPairs: ['prediction flag enables observed-demand opportunity-cost ranking'],
      heldFixedWithinPairs: ['world and keyed random draws', 'service scope', 'capital', 'fees and buyback formula',
        'feasibility filter', 'early reservation mechanism', 'provider/window fallback', 'recommendation uptake', 'guarantee uptake'],
      interpretation: 'Paired synthetic model differences; no requirement of a favorable effect. Intervals describe seed variation under assumptions, not uncertainty about reality.',
      reproduce: 'node run-experiment.mjs',
    } };
}
