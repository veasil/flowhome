import fs from 'node:fs';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

// Proposal-only verification: pass the actual engine directory as argv[2].
const engineRoot = process.argv[2] || '/workspace/sites/flowhome/lib/flowhome-v2/engine';
const engineURL = pathToFileURL(`${engineRoot}/`).href;
const { runCity, runCityWithWorld } = await import(`${engineURL}city-v2.mjs`);
const { generateWorld } = await import(`${engineURL}world-v2.mjs`);
const source = fs.readFileSync(new URL('./research-data.mjs', import.meta.url), 'utf8')
  .replaceAll("'./engine/", `'${engineURL}`);
const { buildResearchView } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

for (const config of [{}, { weeks: 16, initialAssets: 0 }, { scenario: 'capacity' }, { scenario: 'exit' }]) {
  const city = runCity(config), before = JSON.stringify(city), view = buildResearchView(city);
  assert.equal(JSON.stringify(city), before, 'read-only adapter must not mutate run');
  assert.equal(view.dataset.fixtureVerified, true);
  assert.equal(view.categories.reduce((s, c) => s + c.events, 0), city.events.length);
  assert.equal(view.categories.reduce((s, c) => s + c.arrivals, 0), view.dataset.counts.demandItems);
  assert.equal(view.categories.reduce((s, c) => s + c.handovers, 0), city.snapshots.reduce((s, w) => s + w.served, 0));
  const eventCases = new Set(city.events.filter(e => e.caseId).map(e => e.caseId));
  assert.equal(view.flowEdges.reduce((s, e) => s + e.count, 0), city.events.filter(e => e.caseId).length - eventCases.size);
}
const base = runCity({ weeks: 16 }), world = generateWorld(base.config);
world.initialAssets.pop();
const view = buildResearchView(runCityWithWorld(base.config, world));
assert.equal(view.dataset.fixtureVerified, false);
assert.equal(view.dataset.counts.initialAssets, null);
assert.equal(view.categories[0].arrivals, null);
console.log('Research adapter: read-only, counts, lifecycles, and custom-world handling passed.');
