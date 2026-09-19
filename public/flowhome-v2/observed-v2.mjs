// This module has no world input or module-level mutable state.
export const ALGORITHM_VERSION = 'observed-feasible-rank-v2.2';
export const STRATEGIES_V2 = Object.freeze([
  Object.freeze({ id: 'A', name: '无预测 · 无回购', prediction: false, guarantee: false }),
  Object.freeze({ id: 'B', name: '有预测 · 无回购', prediction: true, guarantee: false }),
  Object.freeze({ id: 'C', name: '无预测 · 有回购', prediction: false, guarantee: true }),
  Object.freeze({ id: 'D', name: '有预测 · 有回购', prediction: true, guarantee: true }),
]);

export function validateObserved(snapshot) {
  if (!Number.isInteger(snapshot.asOfTick)) throw new Error('Observation needs an integer asOfTick');
  const forbidden = new Set(['actualTenureWeeks', 'actualExitTick', 'hiddenWorld', 'futureDemand', 'world']);
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (forbidden.has(key)) throw new Error(`Hidden-world field rejected: ${key}`);
      if (key === 'observedAtTick' && child > snapshot.asOfTick) throw new Error('Future observation');
      visit(child);
    }
  };
  visit(snapshot);
  if (snapshot.observedDemandHistory.some(h => h.tick > snapshot.asOfTick)) throw new Error('Future demand history');
  return true;
}

export function forecastObserved(snapshot, predictionBias = 0) {
  validateObserved(snapshot);
  const categories = ['water', 'chair', 'mattress'];
  const history = snapshot.observedDemandHistory.slice(-8);
  const values = {};
  for (const category of categories) {
    let sum = 0, weight = 0;
    for (let i = 0; i < history.length; i++) {
      const w = i + 1;
      sum += (history[i].counts[category] || 0) * w;
      weight += w;
    }
    values[category] = Math.max(0, (weight ? sum / weight : 0) * 4 * (1 + predictionBias));
  }
  return { asOfTick: snapshot.asOfTick, horizonWeeks: 4, kind: 'rule-point-estimate', values,
    algorithmVersion: ALGORITHM_VERSION, source: 'observed trailing eight weeks, linearly weighted' };
}

export function feasibleCandidates(snapshot, demand) {
  const options = [];
  // Hygiene/service-scope boundary: mattresses are new-purchase only.
  if (demand.category === 'mattress') return options;
  for (const asset of snapshot.publicInventory) {
    if (asset.category !== demand.category || asset.quality < demand.minQuality || asset.reserved) continue;
    const totalPriceMinor = asset.priceMinor + snapshot.policy.coordinationMinor + snapshot.policy.deliveryMinor;
    if (totalPriceMinor > demand.budgetMinor) continue;
    // Enumerate all providers and windows BEFORE ranking. No first-provider shortcut.
    const earliest = Math.max(snapshot.asOfTick + 1, asset.readyTick + 1);
    for (let tick = earliest; tick <= demand.deadlineTick; tick++) {
      for (const provider of snapshot.providerOffers) {
        if (provider.observedAtTick > snapshot.asOfTick) throw new Error('Future observation');
        if ((provider.remainingByTick[tick] || 0) > 0) {
          options.push({ assetId: asset.id, providerId: provider.id, deliveryTick: tick,
            totalPriceMinor, priceMinor: asset.priceMinor, quality: asset.quality,
            category: asset.category, readyTick: asset.readyTick, listedTick: asset.listedTick });
        }
      }
    }
  }
  return options;
}

export function proposeObserved(snapshot, demand, { prediction = false, predictionBias = 0 } = {}) {
  const forecast = forecastObserved(snapshot, predictionBias);
  const supply = snapshot.publicInventory.filter(a => a.category === demand.category && !a.reserved).length;
  const scarcity = forecast.values[demand.category] / Math.max(1, supply);
  const options = feasibleCandidates(snapshot, demand).map(option => ({ ...option,
    // Predeclared opportunity-cost ranking; not a predicted sale price or guarantee.
    // Both strategies enumerate exactly the same feasible slots and assets.
    score: option.totalPriceMinor + (prediction ? Math.round(5000 * scarcity * (option.quality - demand.minQuality)) : 0),
  })).sort((a, b) => a.score - b.score || a.deliveryTick - b.deliveryTick || a.assetId.localeCompare(b.assetId) || a.providerId.localeCompare(b.providerId));
  return { schemaVersion: 'proposal-v2.1', snapshotId: snapshot.snapshotId,
    algorithmVersion: ALGORITHM_VERSION, expiresAtTick: snapshot.asOfTick,
    policyBundleRef: snapshot.policy.id, options, forecast };
}
