export const WORLD_VERSION = 'continuous-city-v2.2';
export const CATEGORIES = Object.freeze({
  water: { name: '净水设备', newPriceMinor: 120000 },
  chair: { name: '办公椅', newPriceMinor: 70000 },
  mattress: { name: '床垫', newPriceMinor: 95000 },
});

// Keyed random draws avoid diverging random streams after treatment decisions.
export function draw(seed, stream, id, index = 0) {
  let h = (2166136261 ^ (seed >>> 0)) >>> 0;
  const text = `${stream}:${id}:${index}`;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function generateWorld(config) {
  const demands = [], initialAssets = [], categories = Object.keys(CATEGORIES);
  for (let tick = 0; tick < config.weeks; tick++) {
    const factor = config.scenario === 'demand' && tick >= 52 ? .45 : config.scenario === 'exit' && tick >= config.exitStopTick ? 0 : 1;
    const count = Math.floor((10 + draw(config.seed, 'arrivals', tick) * 7) * factor);
    for (let n = 0; n < count; n++) {
      const id = `resident-${tick}-${n}`;
      const r = draw(config.seed, 'category', id);
      const category = r < .45 ? 'water' : r < .78 ? 'chair' : 'mattress';
      const group = draw(config.seed, 'budget', id) < .32 ? 'limited' : 'standard';
      const base = CATEGORIES[category].newPriceMinor;
      demands.push({ id, tick, category, group, minQuality: draw(config.seed, 'quality', id) < .25 ? 2 : 1,
        budgetMinor: Math.round(base * (group === 'limited' ? .75 : 1.35)),
        deadlineTick: tick + 2, acceptsUsed: draw(config.seed, 'used-preference', id) < .84,
        recommendationDraw: draw(config.seed, 'recommendation-uptake', id),
        guaranteeDraw: draw(config.seed, 'guarantee-uptake', id),
        // Only outcome code sees true tenure; proposals receive neither field.
        actualTenureWeeks: Math.max(8, Math.round(config.tenureMonths * 52 / 12) + Math.floor(draw(config.seed, 'actual-tenure', id) * 13) - 6),
      });
    }
  }
  // Initial owners are exogenous source stock, disclosed only when listing occurs.
  for (let i = 0; i < config.initialAssets; i++) {
    const id = `initial-${i}`, category = categories[Math.floor(draw(config.seed, 'initial-category', id) * 3)];
    initialAssets.push({ id, category, quality: 1 + Math.floor(draw(config.seed, 'initial-quality', id) * 3),
      releaseTick: Math.floor(draw(config.seed, 'initial-release', id) * config.weeks),
      priceMinor: Math.round(CATEGORIES[category].newPriceMinor * (.30 + draw(config.seed, 'initial-price', id) * .25)) });
  }
  return { version: WORLD_VERSION, demands, initialAssets };
}
