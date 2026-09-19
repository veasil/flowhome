import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarket, DATASETS, dispatchMarket, marketBalances, projectMarket, reserveMatch } from './market.mjs';
import { balances } from './domain/ledger.mjs';

test('datasets reproduce domain stages and shared ledger accounting', () => {
  for (const dataset of DATASETS) {
    const market = createMarket(dataset.id);
    assert.deepEqual(market, createMarket(dataset.id));
    assert.equal(market.cases.length, dataset.count);
    assert.deepEqual(marketBalances(market), balances(market.cases.flatMap(c => c.state.ledgerEntries), 6000000));
    const totals = marketBalances(market);
    assert.equal(totals.cashMinor, 6000000 + totals.resultMinor - totals.inventoryBookMinor);
    assert.ok(totals.availableCashMinor >= 0);
    for (const c of market.cases) {
      assert.equal(c.state.config.category, 'purifier');
      assert.equal(c.state.config.durationMonths, 12);
      assert.ok(c.state.commitments.every(x => x.residentId === 'resident-1'));
    }
  }
});
test('one selected case mutates; idempotent retry preserves aggregate identity', () => {
  const market = createMarket();
  const command = { id: 'user-select', type: 'SELECT_OFFER', actor: { role: 'resident', id: 'resident-1' }, payload: { quoteId: 'quote-1' } };
  const result = dispatchMarket(market, market.cases[0].id, command);
  assert.equal(result.ok, true);
  assert.equal(market.cases[0].state.status, 'DRAFT');
  assert.equal(result.market.cases[0].state.status, 'OFFER_SELECTED');
  for (let i = 1; i < market.cases.length; i++) assert.equal(result.market.cases[i], market.cases[i]);
  assert.equal(dispatchMarket(result.market, market.cases[0].id, command).market, result.market);
});
test('shared funding constraint rejects atomically despite positive individual cash', () => {
  const seeded = createMarket();
  const selected = seeded.cases.find(c => c.state.status === 'OFFER_SELECTED');
  const totals = marketBalances(seeded);
  const market = { ...seeded, openingCashMinor: seeded.openingCashMinor - totals.availableCashMinor };
  assert.equal(marketBalances(market).availableCashMinor, 0);
  const result = dispatchMarket(market, selected.id, { id: 'overbook', type: 'CONFIRM_COMMITMENT', actor: { role: 'ops', id: 'ops-1' } });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INSUFFICIENT_SHARED_AVAILABLE_CASH');
  assert.equal(result.market, market);
  assert.equal(selected.state.status, 'OFFER_SELECTED');
});
test('projection namespaces ids and never claims prospective links completed', () => {
  const market = createMarket();
  const projection = projectMarket(market);
  for (const rows of [projection.tasks,projection.events,projection.reservations,projection.supply,projection.demand,projection.opportunities]) assert.equal(new Set(rows.map(r => r.id)).size, rows.length);
  assert.ok(projection.opportunities.length > 0);
  assert.ok(projection.opportunities.every(o => o.status === 'PROSPECTIVE' && o.demandCaseId !== o.supplyCaseId));
  assert.equal(projection.completedDeliveries, 1);
  assert.equal(projection.totalCases, 12);
  assert.deepEqual(projection.balances, marketBalances(market));
});

test('cross-case match reserves one supply and removes demand until cancellation', () => {
  const original = createMarket();
  const demand = original.cases[0];
  const supply = original.cases.find(c => c.state.assets.some(a => a.status === 'AVAILABLE'));
  const result = reserveMatch(original, demand.id, supply.id, 'matching-1');
  assert.equal(result.ok, true);
  assert.equal(result.market.cases[0], demand);
  assert.equal(projectMarket(result.market).matches[0].status, 'RESERVED');
  assert.ok(!projectMarket(result.market).demand.some(d => d.caseId === demand.id));
  assert.equal(reserveMatch(result.market, demand.id, supply.id, 'matching-1').market, result.market);
  assert.equal(reserveMatch(result.market, demand.id, supply.id, 'matching-2').error.code, 'DEMAND_ALREADY_MATCHED');
  const cancelled = dispatchMarket(result.market, supply.id, { id: 'cancel-match', type: 'CANCEL_RESERVATION', actor: { role: 'buyer', id: 'buyer-1' }, payload: { reservationId: result.result.ids.reservationId } });
  assert.equal(cancelled.ok, true);
  assert.equal(projectMarket(cancelled.market).matches[0].status, 'CANCELLED');
  assert.ok(projectMarket(cancelled.market).demand.some(d => d.caseId === demand.id));
});

test('linked delivery is grounded in real supply reservation and ledger', () => {
  const original = createMarket();
  const supply = original.cases.find(c => c.state.assets.some(a => a.status === 'AVAILABLE'));
  const booked = reserveMatch(original, original.cases[0].id, supply.id, 'matching-deliver');
  const ids = booked.result.ids;
  const accepted = dispatchMarket(booked.market, supply.id, { id: 'accept-match-delivery', type: 'ACCEPT_DELIVERY', actor: { role: 'partner', id: 'partner-alpha' }, payload: { taskId: ids.taskId } });
  const delivered = dispatchMarket(accepted.market, supply.id, { id: 'finish-match-delivery', type: 'CONFIRM_DELIVERY', actor: { role: 'buyer', id: 'buyer-1' }, payload: { taskId: ids.taskId, reservationId: ids.reservationId } });
  assert.equal(delivered.ok, true);
  assert.equal(projectMarket(delivered.market).matches[0].status, 'COMPLETED');
  assert.equal(projectMarket(delivered.market).completedDeliveries, 2);
  assert.deepEqual(marketBalances(delivered.market), balances(delivered.market.cases.flatMap(c => c.state.ledgerEntries), 6000000));
});
