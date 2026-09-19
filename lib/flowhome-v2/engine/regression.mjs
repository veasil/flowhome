import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { runCity, runCityWithWorld, generateWorld, DEFAULT_V2, proposeObserved, POLICY_V2 } from './index.mjs';
const checks = [];
function check(name, fn) { fn(); checks.push(name); }
const fixture = { snapshotId: 'observed-test', asOfTick: 0, policy: POLICY_V2,
  observedDemandHistory: [{ tick: 0, observedAtTick: 0, counts: { water: 3 } }],
  publicInventory: [
    { id: 'cheap-late', category: 'water', quality: 2, priceMinor: 10000, readyTick: 3, listedTick: 0 },
    { id: 'feasible', category: 'water', quality: 2, priceMinor: 20000, readyTick: 0, listedTick: 0 },
  ], providerOffers: [{ id: 'full', observedAtTick: 0, remainingByTick: {} },
    { id: 'free', observedAtTick: 0, remainingByTick: { 1: 1, 2: 1, 3: 1 } }] };
const demand = { category: 'water', minQuality: 1, budgetMinor: 100000, deadlineTick: 3 };
check('F01 filter infeasible cheap asset before ranking', () => assert.equal(proposeObserved(fixture, demand).options[0].assetId, 'feasible'));
check('F02 search alternative provider', () => assert.equal(proposeObserved(fixture, demand).options[0].providerId, 'free'));
check('F06 injected worlds share actual observed/proposal prefix despite different hidden futures', () => {
  const throughTick = 12;
  const worldA = generateWorld(DEFAULT_V2), worldB = structuredClone(worldA);
  // These are real inputs to two complete engine executions, not unused locals.
  // Tenure is hidden for already-arrived residents; no one exits before tick 12.
  worldB.demands.forEach(d => { d.actualTenureWeeks += 10; if (d.tick > throughTick) d.category = 'chair'; });
  worldB.initialAssets.forEach(a => { if (a.releaseTick > throughTick) a.releaseTick += 10; });
  const a = runCityWithWorld(DEFAULT_V2, worldA, { traceThroughTick: throughTick });
  const b = runCityWithWorld(DEFAULT_V2, worldB, { traceThroughTick: throughTick });
  assert(a.researchTrace.some(t => t.type === 'proposal'));
  assert.notEqual(a.metadata.worldFixtureFingerprint, b.metadata.worldFixtureFingerprint);
  assert.notDeepEqual(a.summary, b.summary);
  assert.deepEqual(a.researchTrace, b.researchTrace);
});
check('mattress scope excludes secondhand matching and guarantees, allows new purchase', () => {
  const mattressSnapshot = { ...fixture, publicInventory: fixture.publicInventory.map(a => ({ ...a, category: 'mattress' })) };
  assert.equal(proposeObserved(mattressSnapshot, { ...demand, category: 'mattress' }).options.length, 0);
  const city = runCity({ guaranteeUptake: 1 });
  const mattresses = city.events.filter(e => e.type === 'HandoverConfirmed' && e.category === 'mattress');
  assert(mattresses.length > 0); assert(mattresses.every(e => e.used === false));
  assert(!city.events.some(e => e.type === 'CommitmentConfirmed' && e.category === 'mattress'));
});
check('algorithm rejects future observations and hidden fields', () => {
  assert.throws(() => proposeObserved({ ...fixture, hiddenWorld: {} }, demand), /Hidden-world/);
  assert.throws(() => proposeObserved({ ...fixture, observedDemandHistory: [{ tick: 1, counts: {} }] }, demand), /Future/);
});
check('prediction preserves feasible candidates and early windows', () => {
  const keys = proposal => proposal.options.map(o => `${o.assetId}:${o.providerId}:${o.deliveryTick}`).sort();
  assert.deepEqual(keys(proposeObserved(fixture, demand, { prediction: false })), keys(proposeObserved(fixture, demand, { prediction: true })));
});
const cities = ['A', 'B', 'C', 'D'].map(strategy => runCity({ strategy }));
check('deterministic seed replay', () => assert.deepEqual(runCity({ strategy: 'D' }), cities[3]));
check('F07 continuous arrivals through observation end', () => cities.forEach(c => assert(c.snapshots[103].newDemand > 0)));
check('exit-only demand stop is explicit', () => {
  const c = runCity({ scenario: 'exit' }); assert(c.snapshots.slice(78).every(s => s.newDemand === 0));
  assert.equal(c.metadata.stopDemandTick, 78);
});
check('F08 cash, reserve, book and accrued result reconcile', () => cities.forEach(c => {
  Object.values(c.metadata.bridges).forEach(b => assert.equal(b.residualMinor, 0));
  c.snapshots.forEach(s => {
    for (const k of ['cashMinor','reservedMinor','freeCashMinor','inventoryBookMinor','unpaidMinor','resultMinor']) assert(Number.isSafeInteger(s[k]));
    assert.equal(s.freeCashMinor, s.cashMinor - s.reservedMinor); assert(s.freeCashMinor >= 0);
  });
  assert.equal(c.summary.reservedMinor, c.summary.terminalResponsibilities.guaranteedFuturePayoutMinor + c.summary.terminalResponsibilities.reservedPickupMinor);
  assert.equal(c.summary.consumerAverageNetSpendMinor, c.summary.consumerNetSpendMinor / c.summary.demandItems);
}));
check('one asset cannot be delivered to multiple residents in same tick', () => cities.forEach(c => {
  const seen = new Set(); c.events.filter(e => e.type === 'HandoverConfirmed').forEach(e => {
    const key = `${e.tick}:${e.assetId}`; assert(!seen.has(key)); seen.add(key);
  });
}));
check('zero recommendation uptake removes pair effect', () => {
  assert.deepEqual(runCity({ strategy: 'A', uptake: 0 }).summary, runCity({ strategy: 'B', uptake: 0 }).summary);
  assert.deepEqual(runCity({ strategy: 'C', uptake: 0 }).summary, runCity({ strategy: 'D', uptake: 0 }).summary);
});
check('zero guarantee uptake removes responsibility effect', () => {
  assert.deepEqual(runCity({ strategy: 'A', guaranteeUptake: 0 }).summary, runCity({ strategy: 'C', guaranteeUptake: 0 }).summary);
});
check('no capacity has explicit unserved demand and unpaid costs', () => {
  const c = runCity({ capacityMultiplier: 0, capitalMinor: 0 });
  assert.equal(c.summary.served, 0); assert(c.summary.due > 0); assert(c.summary.unpaidMinor > 0);
});
check('capacity stress retains responsibilities and reconciles', () => {
  const c = runCity({ scenario: 'capacity', guaranteeUptake: 1 });
  Object.values(c.metadata.bridges).forEach(b => assert.equal(b.residualMinor, 0));
  assert(c.snapshots[52].providerCapacity < c.snapshots[51].providerCapacity);
});
const report = { status: 'passed', checkCount: checks.length, checks,
  defaultResults: cities.map(c => ({ strategy: c.config.strategy, summary: c.summary, bridges: c.metadata.bridges })) };
await writeFile(new URL('./regression-results-v2.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ status: report.status, checkCount: checks.length, checks }, null, 2));
