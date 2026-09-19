import { ALGORITHM_VERSION, STRATEGIES_V2, proposeObserved, forecastObserved } from './observed-v2.mjs';
import { WORLD_VERSION, CATEGORIES, generateWorld } from './world-v2.mjs';

export const ENGINE_VERSION = 'flowhome-city-v2.2';
export const DEFAULT_V2 = Object.freeze({ seed: 42, strategy: 'D', scenario: 'normal', weeks: 104,
  predictionBias: 0, uptake: .7, guaranteeUptake: .45, capitalMinor: 6000000,
  capacityMultiplier: 1, tenureMonths: 12, initialAssets: 260, exitStopTick: 78,
});
export const POLICY_V2 = Object.freeze({ id: 'policy-v2.2-fixed', coordinationMinor: 6500,
  deliveryMinor: 14000, pickupMinor: 12000, guaranteeFeeMinor: 8000,
  guaranteeRatio: .32, storagePerItemWeekMinor: 90, fixedPerWeekMinor: 10000,
  selfListingCostMinor: 3000, providerCount: 4, slotsPerProviderWeek: 7,
});

function fingerprint(value) {
  const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(key => [key, canonical(v[key])])) : v;
  const text = JSON.stringify(canonical(value));
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16).padStart(8, '0');
}

function normalize(input) {
  const c = { ...DEFAULT_V2, ...input };
  c.strategy = typeof c.strategy === 'object' ? c.strategy.id : c.strategy;
  if (!STRATEGIES_V2.some(s => s.id === c.strategy)) throw new Error('Unknown strategy');
  if (!['normal', 'demand', 'capacity', 'exit'].includes(c.scenario)) throw new Error('Unknown scenario');
  for (const key of ['seed', 'weeks', 'capitalMinor', 'initialAssets', 'exitStopTick']) {
    if (!Number.isSafeInteger(c[key]) || c[key] < 0) throw new Error(`${key} must be a nonnegative integer`);
  }
  if (c.weeks < 16 || c.weeks > 520) throw new Error('weeks must be 16..520');
  for (const key of ['uptake', 'guaranteeUptake']) if (!(c[key] >= 0 && c[key] <= 1)) throw new Error(`${key} must be 0..1`);
  if (!Number.isFinite(c.predictionBias) || c.predictionBias < -1 || c.predictionBias > 3) throw new Error('predictionBias must be -1..3');
  if (!(c.capacityMultiplier >= 0 && c.capacityMultiplier <= 5)) throw new Error('capacityMultiplier must be 0..5');
  if (!(c.tenureMonths > 0 && c.tenureMonths <= 60)) throw new Error('tenureMonths must be 0..60');
  return c;
}

export function runCity(input = {}) {
  return runCityWithWorld(input);
}

// Research-only injection/trace seam. Hidden world stays inside outcome execution;
// the actual algorithm still receives exactly the observed projection below.
export function runCityWithWorld(input = {}, injectedWorld = null, { traceThroughTick = -1 } = {}) {
  const config = normalize(input), strategy = STRATEGIES_V2.find(s => s.id === config.strategy);
  const world = injectedWorld || generateWorld(config), policy = POLICY_V2, assets = new Map(), residents = new Map();
  const researchTrace = [];
  const events = [], snapshots = [], history = [], forecasts = [], deliveries = [], commitments = new Map();
  const usedSlots = new Map(), arrivalsByTick = new Map(), initialByTick = new Map();
  const runId = `sim-v2-${config.seed}-${config.scenario}-${config.strategy}-${fingerprint(config)}`;
  for (const d of world.demands) {
    if (!arrivalsByTick.has(d.tick)) arrivalsByTick.set(d.tick, []);
    arrivalsByTick.get(d.tick).push(d);
  }
  for (const a of world.initialAssets) {
    if (!initialByTick.has(a.releaseTick)) initialByTick.set(a.releaseTick, []);
    initialByTick.get(a.releaseTick).push(a);
  }
  let cash = config.capitalMinor, reserved = 0, inventoryBook = 0, unpaid = 0;
  let revenue = 0, expense = 0, inflows = 0, outflows = 0, bookAdded = 0, bookReleased = 0;
  let reservesAdded = 0, reservesReleased = 0, idleItemWeeks = 0, latePickups = 0;
  const flows = { coordinationRevenueMinor: 0, guaranteeFeeRevenueMinor: 0, resaleRevenueMinor: 0,
    buybackPaidMinor: 0, pickupPaidMinor: 0, operatingPaidMinor: 0, operatingAccruedMinor: 0, costOfSalesMinor: 0 };
  const emit = (tick, type, data = {}) => events.push({ eventId: `${runId}:e${events.length + 1}`, tick, type, ...data });
  function cashIn(amount) { cash += amount; inflows += amount; }
  function cashOut(amount) { cash -= amount; outflows += amount; }
  function reserveIn(amount) { reserved += amount; reservesAdded += amount; }
  function reserveOut(amount) { reserved -= amount; reservesReleased += amount; }
  // Capacity changes are disclosed at their actual occurrence, not in advance.
  const capacityAtObservation = tick => Math.floor(policy.slotsPerProviderWeek * config.capacityMultiplier * (config.scenario === 'capacity' && tick >= 52 ? .40 : 1));
  const slotKey = (providerId, tick) => `${providerId}:${tick}`;
  const remaining = (providerId, targetTick, asOfTick) => Math.max(0, capacityAtObservation(asOfTick) - (usedSlots.get(slotKey(providerId, targetTick)) || 0));
  function bookSlot(providerId, tick, asOfTick) {
    if (remaining(providerId, tick, asOfTick) <= 0) return false;
    const key = slotKey(providerId, tick); usedSlots.set(key, (usedSlots.get(key) || 0) + 1); return true;
  }
  const providers = Array.from({ length: policy.providerCount }, (_, i) => `provider-${i + 1}`);
  function observe(tick) {
    return { schemaVersion: 'observed-v2.1', snapshotId: `${runId}:w${tick}`, asOfTick: tick,
      eventCursor: events.length, policyBundleRef: policy.id, policy,
      publicInventory: [...assets.values()].filter(a => a.status === 'listed' && a.category !== 'mattress').map(a => ({ id: a.id, category: a.category,
        quality: a.quality, priceMinor: a.priceMinor, readyTick: a.readyTick, listedTick: a.listedTick,
        observedAtTick: a.listedTick, reserved: !!a.reservedBy })),
      disclosedIntentions: [], openDemand: [], observedDemandHistory: history.map(h => ({ ...h, counts: { ...h.counts } })),
      providerOffers: providers.map(id => ({ id, observedAtTick: tick,
        remainingByTick: Object.fromEntries([tick, tick + 1, tick + 2].map(t => [t, remaining(id, t, tick)])) })),
      commitmentBudgetProjection: { cashMinor: cash, reservedMinor: reserved, freeCashMinor: cash - reserved },
    };
  }
  function commitGuarantee(resident, tick, paidAssetPrice) {
    if (resident.world.category === 'mattress') return;
    if (!strategy.guarantee || resident.world.guaranteeDraw >= config.guaranteeUptake) return;
    const payout = Math.round(Math.min(CATEGORIES[resident.world.category].newPriceMinor * policy.guaranteeRatio, paidAssetPrice * .60));
    const reserve = payout + policy.pickupMinor;
    if (cash + policy.guaranteeFeeMinor - reserved < reserve) {
      emit(tick, 'GuaranteeDeclined', { caseId: resident.id, reason: 'free-capital' }); return;
    }
    cashIn(policy.guaranteeFeeMinor); revenue += policy.guaranteeFeeMinor;
    flows.guaranteeFeeRevenueMinor += policy.guaranteeFeeMinor; resident.netSpendMinor += policy.guaranteeFeeMinor;
    reserveIn(reserve);
    const commitment = { id: `commitment:${resident.id}`, caseId: resident.id, assetId: resident.assetId,
      guaranteedAmountMinor: payout, reservedMinor: reserve, policyId: policy.id, status: 'active', signedTick: tick,
      intendedExitTick: tick + Math.round(config.tenureMonths * 52 / 12) };
    commitments.set(resident.id, commitment); resident.guaranteed = true;
    emit(tick, 'CommitmentConfirmed', { caseId: resident.id, assetId: resident.assetId, category: resident.world.category, amountMinor: payout, reservedMinor: reserve });
  }
  function completeDelivery(order, tick) {
    const r = residents.get(order.caseId), a = assets.get(order.assetId);
    if (!r || r.status !== 'scheduled' || !a || a.reservedBy !== r.id) throw new Error('Invalid delivery ownership');
    r.status = 'served'; r.deliveryTick = tick; r.assetId = a.id; r.isUsed = order.isUsed;
    r.netSpendMinor += order.totalPriceMinor; r.paidAssetPriceMinor = order.priceMinor;
    if (order.isUsed && a.owner === 'platform') {
      cashIn(order.priceMinor); revenue += order.priceMinor; flows.resaleRevenueMinor += order.priceMinor;
      inventoryBook -= a.bookMinor; expense += a.bookMinor; bookReleased += a.bookMinor; flows.costOfSalesMinor += a.bookMinor;
      a.bookMinor = 0;
    } else if (order.isUsed && residents.has(a.ownerCaseId)) {
      const seller = residents.get(a.ownerCaseId); seller.netSpendMinor -= order.priceMinor; seller.resaleReceivedMinor += order.priceMinor;
      seller.resaleTick = tick;
    }
    cashIn(policy.coordinationMinor); revenue += policy.coordinationMinor; flows.coordinationRevenueMinor += policy.coordinationMinor;
    a.status = 'occupied'; a.owner = 'resident'; a.ownerCaseId = r.id; a.reservedBy = null;
    a.exitTick = tick + r.world.actualTenureWeeks; a.lastPriceMinor = order.priceMinor;
    commitGuarantee(r, tick, order.priceMinor);
    emit(tick, 'HandoverConfirmed', { caseId: r.id, assetId: a.id, category: a.category, used: order.isUsed,
      amountMinor: order.totalPriceMinor, providerId: order.providerId });
  }
  for (let tick = 0; tick < config.weeks; tick++) {
    const capacity = capacityAtObservation(tick);
    // Shock can invalidate prebooked slots. Requeue excess orders; do not delete sunk payments.
    for (const provider of providers) {
      const scheduled = deliveries.filter(o => o.deliveryTick === tick && o.providerId === provider);
      for (let i = capacity; i < scheduled.length; i++) {
        const o = scheduled[i], r = residents.get(o.caseId), a = assets.get(o.assetId);
        o.cancelled = true; r.status = 'open'; a.reservedBy = null;
        if (!o.isUsed) assets.delete(a.id);
        emit(tick, 'ServiceReplanRequired', { caseId: r.id, assetId: a.id, reason: 'observed-capacity-shock' });
      }
    }
    for (const order of deliveries.filter(o => o.deliveryTick === tick && !o.cancelled)) completeDelivery(order, tick);
    for (const raw of initialByTick.get(tick) || []) assets.set(raw.id, { ...raw, owner: 'external',
      ownerCaseId: null, status: 'listed', listedTick: tick, readyTick: tick + 1, bookMinor: 0, reservedBy: null });
    for (const a of assets.values()) {
      if (a.status !== 'occupied' || a.exitTick !== tick) continue;
      const r = residents.get(a.ownerCaseId); r.exitTick = tick;
      if (a.category === 'mattress') {
        a.status = 'out-of-scope';
        emit(tick, 'ExitOutsideServiceScope', { caseId: r.id, assetId: a.id, category: a.category });
        continue;
      }
      a.quality = Math.max(1, a.quality - 1); a.reservedBy = null; a.listedTick = tick;
      a.priceMinor = Math.round(Math.min(CATEGORIES[a.category].newPriceMinor * .55, a.lastPriceMinor * .72));
      const c = commitments.get(r.id);
      if (c) {
        cashOut(c.guaranteedAmountMinor); flows.buybackPaidMinor += c.guaranteedAmountMinor;
        reserveOut(c.guaranteedAmountMinor); c.reservedMinor -= c.guaranteedAmountMinor;
        r.netSpendMinor -= c.guaranteedAmountMinor; r.resaleReceivedMinor += c.guaranteedAmountMinor; r.resaleTick = tick;
        a.owner = 'platform'; a.status = 'pickup-pending'; a.bookMinor = c.guaranteedAmountMinor;
        inventoryBook += a.bookMinor; bookAdded += a.bookMinor; c.status = 'pickup-pending';
        emit(tick, 'GuaranteedPayoutCompleted', { caseId: r.id, assetId: a.id, amountMinor: c.guaranteedAmountMinor });
      } else {
        a.status = 'listed'; a.readyTick = tick + 1; r.netSpendMinor += policy.selfListingCostMinor;
        emit(tick, 'SelfSaleListed', { caseId: r.id, assetId: a.id });
      }
    }
    // Honor existing pickup responsibilities before booking new deliveries.
    for (const a of assets.values()) {
      if (a.status !== 'pickup-pending') continue;
      const provider = providers.find(id => remaining(id, tick, tick) > 0);
      if (!provider) { latePickups++; continue; }
      bookSlot(provider, tick, tick);
      const c = commitments.get(a.ownerCaseId);
      cashOut(policy.pickupMinor); expense += policy.pickupMinor; flows.pickupPaidMinor += policy.pickupMinor;
      reserveOut(policy.pickupMinor); c.reservedMinor -= policy.pickupMinor; c.status = 'completed';
      a.status = 'listed'; a.readyTick = tick + 1;
      emit(tick, 'PickupCompleted', { assetId: a.id, caseId: a.ownerCaseId, providerId: provider, amountMinor: policy.pickupMinor });
    }
    const incoming = arrivalsByTick.get(tick) || [], counts = { water: 0, chair: 0, mattress: 0 };
    for (const d of incoming) { counts[d.category]++; residents.set(d.id, { id: d.id, world: d,
      status: 'open', netSpendMinor: 0, resaleReceivedMinor: 0, guaranteed: false }); }
    history.push({ tick, counts, observedAtTick: tick });
    const weekObservation = observe(tick);
    forecasts.push(forecastObserved(weekObservation, config.predictionBias));
    if (tick <= traceThroughTick) researchTrace.push({ type: 'weekly-observation', tick, snapshot: weekObservation });
    for (const r of residents.values()) {
      if (r.status !== 'open') continue;
      const d = r.world;
      if (tick >= d.deadlineTick) { r.status = 'unserved'; continue; }
      const snapshot = observe(tick);
      const proposal = proposeObserved(snapshot, { category: d.category, budgetMinor: d.budgetMinor,
        minQuality: d.minQuality, deadlineTick: d.deadlineTick }, {
        prediction: strategy.prediction && d.recommendationDraw < config.uptake, predictionBias: config.predictionBias,
      });
      if (tick <= traceThroughTick) researchTrace.push({ type: 'proposal', tick, caseId: r.id, snapshot, proposal });
      const option = d.acceptsUsed ? proposal.options.find(o => {
        const a = assets.get(o.assetId);
        return !a.reservedBy && bookSlot(o.providerId, o.deliveryTick, tick);
      }) : null;
      if (option) {
        assets.get(option.assetId).reservedBy = r.id; r.status = 'scheduled';
        deliveries.push({ caseId: r.id, ...option, isUsed: true });
        continue;
      }
      // Identical new-item fallback and deadline handling in all four arms.
      const price = CATEGORIES[d.category].newPriceMinor;
      const total = price + policy.deliveryMinor + policy.coordinationMinor;
      if (total > d.budgetMinor) continue;
      let newSlot = null;
      for (let t = tick + 1; t <= d.deadlineTick && !newSlot; t++) {
        for (const id of providers) if (bookSlot(id, t, tick)) { newSlot = { providerId: id, deliveryTick: t }; break; }
      }
      if (!newSlot) continue;
      const id = `asset:${r.id}`;
      assets.set(id, { id, category: d.category, quality: 3, status: 'new-pending', owner: 'manufacturer',
        ownerCaseId: null, bookMinor: 0, reservedBy: r.id }); r.status = 'scheduled';
      deliveries.push({ caseId: r.id, assetId: id, ...newSlot, isUsed: false, priceMinor: price, totalPriceMinor: total });
    }
    const owned = [...assets.values()].filter(a => a.owner === 'platform' && a.status !== 'occupied');
    const operating = policy.fixedPerWeekMinor + owned.length * policy.storagePerItemWeekMinor;
    expense += operating; unpaid += operating; flows.operatingAccruedMinor += operating;
    const paid = Math.min(unpaid, Math.max(0, cash - reserved)); cashOut(paid); unpaid -= paid; flows.operatingPaidMinor += paid;
    const idle = owned.filter(a => !a.reservedBy).length; idleItemWeeks += idle;
    if (cash < reserved || reserved < 0 || inventoryBook < 0) throw new Error('Financial invariant failed');
    const weekDeliveries = [...residents.values()].filter(r => r.deliveryTick === tick);
    snapshots.push({ tick, newDemand: incoming.length, due: world.demands.filter(d => d.deadlineTick === tick).length,
      served: weekDeliveries.length, transfers: weekDeliveries.filter(r => r.isUsed).length,
      newPurchases: weekDeliveries.filter(r => !r.isUsed).length, cashMinor: cash, reservedMinor: reserved,
      freeCashMinor: cash - reserved, inventoryBookMinor: inventoryBook, unpaidMinor: unpaid,
      resultMinor: revenue - expense, inventoryCount: owned.length, idleItemWeeks: idle,
      activeCommitments: [...commitments.values()].filter(c => c.status !== 'completed').length,
      pickupPending: owned.filter(a => a.status === 'pickup-pending').length,
      providerCapacity: capacity * providers.length,
    });
  }
  const comparison = [...residents.values()].filter(r => r.world.tick >= 12);
  const dueResidents = comparison.filter(r => r.world.deadlineTick < config.weeks);
  const servedResidents = dueResidents.filter(r => r.status === 'served');
  const netSpend = comparison.reduce((sum, r) => sum + r.netSpendMinor, 0);
  const platformStock = [...assets.values()].filter(a => a.owner === 'platform');
  const terminalContracts = [...commitments.values()].filter(c => c.status !== 'completed');
  const summarizeGroup = (id, entries) => {
    const due = entries.filter(r => r.world.deadlineTick < config.weeks), served = due.filter(r => r.status === 'served');
    return { id, name: id === 'limited' ? '预算较紧' : '常规预算', demandItems: entries.length, due: due.length, served: served.length,
      rate: due.length ? served.length / due.length : 0,
      consumerAverageNetSpendMinor: entries.length ? entries.reduce((s, r) => s + r.netSpendMinor, 0) / entries.length : 0,
      guaranteeCount: entries.filter(r => r.guaranteed).length };
  };
  const terminal = { activeCommitmentCount: terminalContracts.filter(c => c.status === 'active').length,
    guaranteedFuturePayoutMinor: terminalContracts.filter(c => c.status === 'active').reduce((s, c) => s + c.guaranteedAmountMinor, 0),
    reservedPickupMinor: terminalContracts.length * policy.pickupMinor,
    pickupPendingCount: terminalContracts.filter(c => c.status === 'pickup-pending').length,
    scheduledUndeliveredCount: [...residents.values()].filter(r => r.status === 'scheduled').length,
    openDemandCount: [...residents.values()].filter(r => r.status === 'open').length,
    selfSaleUnsoldCount: [...assets.values()].filter(a => a.status === 'listed' && a.owner === 'resident').length,
    platformInventoryAges: platformStock.map(a => ({ assetId: a.id, ageWeeks: config.weeks - 1 - a.listedTick,
      bookMinor: a.bookMinor, pickupPending: a.status === 'pickup-pending' })),
  };
  const records = [];
  for (const f of forecasts) {
    if (f.asOfTick < 12 || f.asOfTick + f.horizonWeeks >= config.weeks) continue;
    for (const category of Object.keys(CATEGORIES)) {
      const actual = history.slice(f.asOfTick + 1, f.asOfTick + 5).reduce((s, h) => s + h.counts[category], 0);
      records.push({ tick: f.asOfTick, category, predicted: f.values[category], actual, error: f.values[category] - actual });
    }
  }
  const summary = { cashMinor: cash, reservedMinor: reserved, freeCashMinor: cash - reserved,
    inventoryBookMinor: inventoryBook, unpaidMinor: unpaid, resultMinor: revenue - expense,
    served: servedResidents.length, due: dueResidents.length, rate: dueResidents.length ? servedResidents.length / dueResidents.length : 0,
    transfers: servedResidents.filter(r => r.isUsed).length, newPurchases: servedResidents.filter(r => !r.isUsed).length,
    inventoryCount: platformStock.length, idleItemWeeks,
    comparisonResultMinor: revenue - expense - snapshots[11].resultMinor,
    comparisonIdleItemWeeks: snapshots.slice(12).reduce((s, w) => s + w.idleItemWeeks, 0),
    demandItems: comparison.length, consumerNetSpendMinor: netSpend,
    consumerAverageNetSpendMinor: comparison.length ? netSpend / comparison.length : 0,
    guaranteeCount: comparison.filter(r => r.guaranteed).length,
    guaranteedExitCount: comparison.filter(r => r.guaranteed && r.exitTick !== undefined).length,
    completedSelfSaleCount: comparison.filter(r => !r.guaranteed && r.resaleTick !== undefined).length,
    averageSelfSaleWaitWeeks: (() => { const r = comparison.filter(r => !r.guaranteed && r.resaleTick !== undefined); return r.length ? r.reduce((s, x) => s + x.resaleTick - x.exitTick, 0) / r.length : null; })(),
    latePickupItemWeeks: latePickups, terminalResponsibilities: terminal,
  };
  const bridges = {
    cash: { openingMinor: config.capitalMinor, inflowsMinor: inflows, outflowsMinor: outflows, closingMinor: cash,
      residualMinor: config.capitalMinor + inflows - outflows - cash },
    reserve: { openingMinor: 0, additionsMinor: reservesAdded, releasesMinor: reservesReleased, closingMinor: reserved,
      residualMinor: reservesAdded - reservesReleased - reserved },
    inventory: { openingMinor: 0, additionsMinor: bookAdded, costReleasedMinor: bookReleased, closingMinor: inventoryBook,
      residualMinor: bookAdded - bookReleased - inventoryBook },
    result: { revenueMinor: revenue, expenseMinor: expense, resultMinor: revenue - expense,
      residualMinor: config.capitalMinor + revenue - expense - inventoryBook + unpaid - cash },
  };
  for (const b of Object.values(bridges)) if (b.residualMinor !== 0) throw new Error('Ledger bridge mismatch');
  return { config, summary, snapshots, ...(traceThroughTick >= 0 ? { researchTrace } : {}), groups: ['limited', 'standard'].map(id => summarizeGroup(id, comparison.filter(r => r.world.group === id))),
    forecastEvaluation: { kind: 'rule-point-estimate', horizonWeeks: 4, count: records.length,
      mae: records.length ? records.reduce((s, r) => s + Math.abs(r.error), 0) / records.length : null,
      bias: records.length ? records.reduce((s, r) => s + r.error, 0) / records.length : null, records },
    events, metadata: { runId, engineVersion: ENGINE_VERSION, worldVersion: WORLD_VERSION,
      observationSchemaVersion: 'observed-v2.1', algorithmVersion: ALGORITHM_VERSION,
      engineCommit: null, configFingerprint: fingerprint(config),
      worldFixtureFingerprint: fingerprint(world),
      policyFingerprint: fingerprint(policy), fingerprintMethod: 'FNV-1a-32 deterministic identity, not cryptographic integrity',
      policyVersion: policy.id, behaviorVersion: 'independent-uptakes-v2.1', metricsVersion: 'demand-item-denominator-v2.1',
      clockVersion: 'weekly-tick-v1', currency: 'CNY', moneyUnit: 'minor', evidenceLevel: 'synthetic-simulation',
      windows: { warmup: [0, 11], comparison: [12, config.weeks - 1], tail: 'not liquidated; terminal obligations and inventory reported' },
      namedRandomStreams: ['arrivals', 'category', 'budget', 'quality', 'used-preference', 'recommendation-uptake', 'guarantee-uptake', 'actual-tenure', 'initial-category', 'initial-quality', 'initial-release', 'initial-price'],
      groupPolicy: strategy, flows, bridges, terminalResponsibilities: terminal,
      continuousArrivals: config.scenario !== 'exit', stopDemandTick: config.scenario === 'exit' ? config.exitStopTick : null,
      metricDefinitions: {
        served: 'Comparison-arrival demand items whose deadlines occurred by observation end and were delivered; due uses identical cohort.',
        consumerAverageNetSpendMinor: 'Actual observed net expenditure of all comparison-arrival demand items / all comparison-arrival demand items, including unserved zeros and incomplete lifecycles. Not lifetime cost.',
        cashAndResult: 'Cumulative through observation end including warmup; integer minor units; guarantee fees recognized at signing, no fair-value inventory uplift.',
        idleItemWeeks: 'All-horizon platform-owned items unreserved at each weekly close, including awaiting pickup.',
        resultMinor: 'Simplified accrued operating result, excluding taxes, full staffing, inventory impairment and terminal fulfillment expense beyond stated reserves.',
      },
      assumptions: ['Synthetic city; no calibration or empirical causal claims.', 'Recommendation uptake and guarantee purchase are independent keyed Bernoulli assumptions.',
        'Mattresses permit new purchase only; no secondhand matching, buyback guarantee or modeled resale service.',
        'All groups use identical feasible early reservation, provider search and new-item fallback.',
        'Prediction is eight-week observed demand extrapolation affecting only quality opportunity-cost ranking; no hidden future input.',
        'Fee is outside item budget; guarantee adoption is hypothetical and no willingness-to-pay value is inferred.',
        'External initial owners and manufacturers are counterparties outside the modeled resident cohort.',
        'Guaranteed payout occurs at requested exit; delayed pickup remains a reserved responsibility.',
        'No cancellations, damage disputes, taxes or market equilibrium; no production transaction or authentication implementation.'],
    } };
}
