import test from 'node:test';
import assert from 'node:assert/strict';
import { createCase, dispatch, project, quoteCase } from './domain.mjs';
import { cashBalance, reservedBalance } from './ledger.mjs';

const cmd = (id, type, role, actorId, expectedVersion, payload = {}) => ({ id, type, actor: { role, id: actorId }, expectedVersion, payload });
const run = (state, command) => { const response = dispatch(state, command); assert.equal(response.ok, true, response.error?.code); return response.state; };

function committed() {
  let state = createCase();
  state = run(state, cmd('select-1', 'SELECT_OFFER', 'resident', 'resident-a', 0, { quoteId: 'quote-1' }));
  state = run(state, cmd('confirm-1', 'CONFIRM_COMMITMENT', 'ops', 'ops-a', 1, { commitmentId: 'commitment-1' }));
  return state;
}
function exitedAndPassed() {
  let state = committed();
  state = run(state, cmd('exit-1', 'REQUEST_EXIT', 'resident', 'resident-a', 2));
  state = run(state, cmd('accept-inspection-1', 'ACCEPT_TASK', 'partner', 'partner-alpha', 3, { taskId: 'task-1' }));
  return run(state, cmd('inspect-1', 'COMPLETE_INSPECTION', 'partner', 'partner-alpha', 4, { taskId: 'task-1', outcome: 'pass', sourceId: 'partner-alpha', sourceEventId: 'report-1' }));
}

test('quote defaults, contract snapshot and later policy update do not rewrite it', () => {
  assert.equal(quoteCase().pricing.retailMinor, 114000);
  let state = committed(); const contractPolicy = state.commitments[0].contract.policyBundleRef;
  state = run(state, cmd('policy-2', 'APPROVE_POLICY', 'governance', 'gov-b', 2, { policy: { id: 'policy-v2', version: 2, hash: 'new' } }));
  assert.equal(state.activePolicy.version, 2);
  assert.deepEqual(state.commitments[0].contract.policyBundleRef, contractPolicy);
  assert.equal(dispatch(state, cmd('replace-late', 'REPLACE_QUOTE', 'ops', 'ops-a', 3, { quote: { pricing: { retailMinor: 1 } } })).error.code, 'QUOTE_LOCKED');
});

test('mattress is a valid category but is unsupported by the default guarantee policy', () => {
  assert.throws(() => quoteCase({ category: 'mattress' }), /QUOTE_UNSUPPORTED_CATEGORY/);
  assert.equal(quoteCase({ category: 'mattress', policy: { guaranteeCategories: ['mattress'] } }).category, 'mattress');
});

test('an unsigned selected quote can be replaced, which requires a fresh selection', () => {
  let state = createCase();
  state = run(state, cmd('select-before-replace', 'SELECT_OFFER', 'resident', 'resident-a', 0, { quoteId: 'quote-1' }));
  state = run(state, cmd('replace-before-sign', 'REPLACE_QUOTE', 'ops', 'ops-a', 1, { quote: { pricing: { resaleMinor: 60000 } } }));
  assert.equal(state.status, 'DRAFT'); assert.equal(state.quotes[0].status, 'REPLACED'); assert.equal(state.quotes[1].pricing.resaleMinor, 60000);
  assert.equal(state.commitments[0].status, 'SUPERSEDED');
});

test('idempotent replay returns current state and cannot roll back later exit', () => {
  let state = committed();
  state = run(state, cmd('exit-2', 'REQUEST_EXIT', 'resident', 'resident-a', 2));
  const replay = dispatch(state, cmd('select-1', 'SELECT_OFFER', 'resident', 'resident-a', 0, { quoteId: 'quote-1' }));
  assert.equal(replay.ok, true); assert.strictEqual(replay.state, state); assert.equal(replay.state.status, 'EXIT_REQUESTED');
  assert.equal(dispatch(state, cmd('select-1', 'SELECT_OFFER', 'resident', 'resident-a', 0, { quoteId: 'other' })).error.code, 'IDEMPOTENCY_CONFLICT');
});

test('commitment replay cannot double-hold the 58,000 fen reserve', () => {
  const state = committed();
  const replay = dispatch(state, cmd('confirm-1', 'CONFIRM_COMMITMENT', 'ops', 'ops-a', 1, { commitmentId: 'commitment-1' }));
  assert.equal(replay.ok, true); assert.strictEqual(replay.state, state); assert.equal(replay.state.balances.reservedMinor, 58000);
  assert.equal(replay.state.ledgerEntries.filter((e) => e.kind === 'reserve_hold').length, 1);
});

test('stale version and denied role cannot write', () => {
  const state = createCase();
  assert.equal(dispatch(state, cmd('bad-role', 'CONFIRM_COMMITMENT', 'resident', 'resident-a', 0)).error.code, 'FORBIDDEN');
  assert.equal(dispatch(state, cmd('old', 'SELECT_OFFER', 'resident', 'resident-a', 2, { quoteId: 'quote-1' })).error.code, 'STALE_VERSION');
});

test('failed confirmation is atomic when free cash cannot cover reserve', () => {
  const state = createCase({ initialCashMinor: 45999 });
  const selected = run(state, cmd('select-low-cash', 'SELECT_OFFER', 'resident', 'resident-a', 0, { quoteId: 'quote-1' }));
  const failed = dispatch(selected, cmd('confirm-low-cash', 'CONFIRM_COMMITMENT', 'ops', 'ops-a', 1, { commitmentId: 'commitment-1' }));
  assert.equal(failed.error.code, 'INSUFFICIENT_AVAILABLE_CASH'); assert.strictEqual(failed.state, undefined); assert.equal(selected.balances.cashMinor, 45999); assert.equal(selected.balances.reservedMinor, 0);
});

test('confirmation may use the exit fee received in the same atomic transaction', () => {
  let state = createCase({ initialCashMinor: 46000 });
  state = run(state, cmd('select-fee-funds', 'SELECT_OFFER', 'resident', 'resident-a', 0, { quoteId: 'quote-1' }));
  state = run(state, cmd('confirm-fee-funds', 'CONFIRM_COMMITMENT', 'ops', 'ops-a', 1, { commitmentId: 'commitment-1' }));
  assert.equal(state.balances.cashMinor, 58000); assert.equal(state.balances.reservedMinor, 58000); assert.equal(state.balances.availableCashMinor, 0);
});

test('confirmation rechecks quote expiry', () => {
  let state = createCase(); state = run(state, cmd('select-expiring', 'SELECT_OFFER', 'resident', 'resident-a', 0, { quoteId: 'quote-1' }));
  assert.equal(dispatch(state, { ...cmd('confirm-expired', 'CONFIRM_COMMITMENT', 'ops', 'ops-a', 1, { commitmentId: 'commitment-1' }), issuedAtTick: 100 }).error.code, 'QUOTE_EXPIRED');
});

test('provider decline preserves contract and creates a replacement task', () => {
  let state = committed(); state = run(state, cmd('exit-3', 'REQUEST_EXIT', 'resident', 'resident-a', 2));
  state = run(state, cmd('decline-1', 'DECLINE_TASK', 'partner', 'partner-alpha', 3, { taskId: 'task-1', reason: 'no capacity' }));
  assert.equal(state.commitments[0].status, 'CONFIRMED'); assert.equal(state.tasks[0].status, 'DECLINED'); assert.equal(state.tasks[1].status, 'PENDING'); assert.equal(state.tasks[1].partnerId, 'partner-beta'); assert.deepEqual(project(state, 'ops', 'ops-a').partnerOptions, ['partner-alpha', 'partner-beta']);
});

test('reservation cancellation releases asset and allows buyer to reserve again', () => {
  let state = exitedAndPassed();
  state = run(state, cmd('reserve-1', 'RESERVE_ITEM', 'buyer', 'buyer-a', 5, { assetId: 'asset-1' }));
  state = run(state, cmd('cancel-1', 'CANCEL_RESERVATION', 'buyer', 'buyer-a', 6, { reservationId: 'reservation-1' }));
  state = run(state, cmd('reserve-2', 'RESERVE_ITEM', 'buyer', 'buyer-a', 7, { assetId: 'asset-1' }));
  assert.equal(state.assets[0].status, 'RESERVED'); assert.equal(state.reservations[1].status, 'ACTIVE');
});

test('inspection failure blocks resale and does not erase confirmed contract', () => {
  let state = committed(); state = run(state, cmd('exit-4', 'REQUEST_EXIT', 'resident', 'resident-a', 2)); state = run(state, cmd('accept-inspection-4', 'ACCEPT_TASK', 'partner', 'partner-alpha', 3, { taskId: 'task-1' }));
  state = run(state, cmd('inspect-fail', 'COMPLETE_INSPECTION', 'partner', 'partner-alpha', 4, { taskId: 'task-1', outcome: 'fail' }));
  assert.equal(state.status, 'INSPECTION_FAILED'); assert.equal(state.commitments[0].status, 'CONFIRMED'); assert.equal(dispatch(state, cmd('reserve-failed', 'RESERVE_ITEM', 'buyer', 'buyer-a', 5, { assetId: 'asset-1' })).error.code, 'ASSET_NOT_FOUND');
});

test('a failed inspection reserves a fresh inspection amount before a later reinspection', () => {
  let state = committed(); state = run(state, cmd('exit-recheck-1', 'REQUEST_EXIT', 'resident', 'resident-a', 2)); state = run(state, cmd('accept-recheck-1', 'ACCEPT_TASK', 'partner', 'partner-alpha', 3, { taskId: 'task-1' }));
  state = run(state, cmd('fail-recheck-1', 'COMPLETE_INSPECTION', 'partner', 'partner-alpha', 4, { taskId: 'task-1', outcome: 'fail' }));
  assert.equal(state.balances.reservedMinor, 41000);
  state = run(state, cmd('exit-recheck-2', 'REQUEST_EXIT', 'resident', 'resident-a', 5));
  assert.equal(state.balances.reservedMinor, 58000); assert.equal(state.tasks[1].partnerId, 'partner-alpha');
  state = run(state, cmd('accept-recheck-2', 'ACCEPT_TASK', 'partner', 'partner-alpha', 6, { taskId: 'task-2' }));
  state = run(state, cmd('pass-recheck-2', 'COMPLETE_INSPECTION', 'partner', 'partner-alpha', 7, { taskId: 'task-2', outcome: 'pass' }));
  assert.equal(state.balances.reservedMinor, 0);
});

test('a duplicate provider report source returns current state without a second payment', () => {
  let state = committed(); state = run(state, cmd('exit-report', 'REQUEST_EXIT', 'resident', 'resident-a', 2)); state = run(state, cmd('accept-report', 'ACCEPT_TASK', 'partner', 'partner-alpha', 3, { taskId: 'task-1' }));
  state = run(state, cmd('report-one', 'COMPLETE_INSPECTION', 'partner', 'partner-alpha', 4, { taskId: 'task-1', outcome: 'pass', sourceId: 'provider-1', sourceEventId: 'source-1' }));
  const replay = dispatch(state, cmd('report-retry', 'COMPLETE_INSPECTION', 'partner', 'partner-alpha', 5, { taskId: 'task-1', outcome: 'pass', sourceId: 'provider-1', sourceEventId: 'source-1' }));
  assert.equal(replay.ok, true); assert.strictEqual(replay.state, state); assert.equal(state.ledgerEntries.filter((e) => e.kind === 'inspection_paid').length, 1);
  assert.equal(dispatch(state, cmd('report-spy', 'COMPLETE_INSPECTION', 'partner', 'partner-spy', 5, { taskId: 'task-1', outcome: 'pass', sourceId: 'provider-1', sourceEventId: 'source-1' })).error.code, 'FORBIDDEN');
});

test('a party appealed against cannot resolve its own appeal', () => {
  let state = committed();
  state = run(state, cmd('appeal-1', 'SUBMIT_APPEAL', 'resident', 'resident-a', 2, { againstActorId: 'gov-a', reason: 'fee dispute' }));
  assert.equal(dispatch(state, cmd('self-resolve', 'RESOLVE_APPEAL', 'governance', 'gov-a', 3, { appealId: 'appeal-1', resolution: 'dismissed' })).error.code, 'CONFLICT_OF_INTEREST');
});

test('cash bridge, reserve release, expected versus actual and delivery flow reconcile', () => {
  let state = exitedAndPassed();
  state = run(state, cmd('reserve-cash', 'RESERVE_ITEM', 'buyer', 'buyer-a', 5, { assetId: 'asset-1' }));
  state = run(state, cmd('accept-delivery', 'ACCEPT_DELIVERY', 'partner', 'partner-alpha', 6, { taskId: 'task-2' }));
  state = run(state, cmd('deliver', 'CONFIRM_DELIVERY', 'buyer', 'buyer-a', 7, { taskId: 'task-2', reservationId: 'reservation-1' }));
  assert.equal(cashBalance(state.ledgerEntries, 6000000), 6022800);
  assert.equal(reservedBalance(state.ledgerEntries), 0);
  assert.equal(state.balances.consumerPaidActualMinor, state.balances.consumerPaidExpectedMinor);
  assert.equal(state.balances.inventoryBookMinor, 0); assert.equal(state.balances.resultMinor, 22800); assert.equal(6000000 + state.balances.resultMinor - state.balances.inventoryBookMinor, state.balances.cashMinor);
  const resident = project(state, 'resident', 'resident-a'); assert.equal('cashMinor' in resident, false); assert.equal('taskIds' in resident.ids, false);
  assert.deepEqual(resident.billed, { grossPaymentActual: 126000, buybackReceived: 41000, netActual: 85000, maintenanceEstimatedMinor: 4000 });
  assert.equal(project(state, 'partner', 'partner-alpha').tasks.length, 2);
});

test('the appellant cannot resolve the same case by changing roles', () => {
 let state = committed();
 state = run(state, cmd('a-multirole','SUBMIT_APPEAL','partner','same-person',2,{againstActorId:'ops-a',reason:'service dispute'}));
 const r = dispatch(state,cmd('r-multirole','RESOLVE_APPEAL','governance','same-person',3,{appealId:'appeal-1'}));
 assert.equal(r.ok,false);assert.equal(r.error.code,'CONFLICT_OF_INTEREST');assert.equal(state.appeals[0].status,'OPEN');
});
test('a completed buyback cannot be exited again', () => {
 const state=exitedAndPassed();const r=dispatch(state,cmd('repeat-exit','REQUEST_EXIT','resident','resident-a',5));
 assert.equal(r.ok,false);assert.equal(r.error.code,'INVALID_TRANSITION');assert.equal(state.assets.length,1);
});
