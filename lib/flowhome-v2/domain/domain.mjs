import { normalizeConfig, makePolicySnapshot, makeQuote, canReplaceQuote } from './policy.mjs';
import { entry, balances, requiredReserveMinor, assertBalancedState } from './ledger.mjs';
import { makeInspectionTask, makeDeliveryTask, taskFor, replaceTask, taskAcceptable } from './fulfillment.mjs';

const ROLES = new Set(['resident', 'ops', 'partner', 'buyer', 'governance', 'public']);
const ROLE_FOR = Object.freeze({
  SELECT_OFFER: 'resident', REQUEST_EXIT: 'resident', SUBMIT_APPEAL: ['resident', 'partner'],
  CONFIRM_COMMITMENT: 'ops', REPLACE_QUOTE: 'ops', RESCHEDULE_TASK: 'ops',
  ACCEPT_TASK: 'partner', DECLINE_TASK: 'partner', COMPLETE_INSPECTION: 'partner', ACCEPT_DELIVERY: 'partner',
  RESERVE_ITEM: 'buyer', CANCEL_RESERVATION: 'buyer', CONFIRM_DELIVERY: 'buyer', APPROVE_POLICY: 'governance', RESOLVE_APPEAL: 'governance',
});

const clone = (value) => JSON.parse(JSON.stringify(value));
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
};
const no = (code, message = code, details) => ({ ok: false, error: { code, message, ...(details ? { details } : {}) } });
const yes = (state, result) => ({ ok: true, state, result });

function permitted(command) {
  const required = ROLE_FOR[command.type];
  const role = command.actor?.role;
  return required && (Array.isArray(required) ? required.includes(role) : required === role);
}
function event(state, command, type, payload) {
  return Object.freeze({ eventId: `event-${state.nextEventNo}`, type, schemaVersion: 1, aggregateId: state.caseId,
    aggregateVersion: state.aggregateVersion + 1, commandId: command.id, correlationId: command.correlationId ?? command.id,
    causationId: command.causationId ?? null, occurredAtTick: command.issuedAtTick ?? state.tick,
    recordedAtTick: state.tick, policyBundleRef: clone(state.activePolicy), payload: clone(payload) });
}
function withCommit(state, command, type, payload, mutate, newEntries = []) {
  const draft = clone(state); mutate(draft);
  const domainEvent = event(state, command, type, payload);
  draft.events.push(domainEvent); draft.ledgerEntries.push(...newEntries.map((e) => ({ ...e, eventId: domainEvent.eventId })));
  draft.aggregateVersion = state.aggregateVersion + 1; draft.nextEventNo += 1; draft.tick = Math.max(draft.tick, command.issuedAtTick ?? draft.tick);
  draft.balances = balances(draft.ledgerEntries, draft.config.initialCashMinor); assertBalancedState(draft);
  const result = Object.freeze({ eventId: domainEvent.eventId, aggregateVersion: draft.aggregateVersion, ids: payload.ids ?? {} });
  draft.idempotency[command.id] = { fingerprint: fingerprint(command), result };
  return yes(deepFreeze(draft), result);
}
function deepFreeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(deepFreeze); } return value; }
function fingerprint(command) { return canonical({ type: command.type, actor: command.actor, payload: command.payload ?? {}, expectedVersion: command.expectedVersion ?? null }); }
function requireTask(state, command, kind) {
  const task = taskFor(state, command.payload?.taskId); if (!task || task.kind !== kind) return no('TASK_NOT_FOUND');
  if (task.partnerId !== command.actor.id) return no('FORBIDDEN', 'Task is assigned to another partner'); return task;
}
function newId(state, prefix) { return `${prefix}-${state.nextIds[prefix]}`; }
function nextIds(draft, prefix) { draft.nextIds[prefix] += 1; }

export function quoteCase(config = {}) { const normalized = normalizeConfig(config); return makeQuote(normalized); }
export function createCase(config = {}) {
  const normalized = normalizeConfig(config); const quote = makeQuote(normalized);
  const state = { schemaVersion: 1, caseId: normalized.caseId, status: 'DRAFT', tick: 0, aggregateVersion: 0, nextEventNo: 1,
    nextIds: { task: 1, reservation: 1, appeal: 1 }, config: normalized, activePolicy: normalized.policy, policyHistory: [normalized.policy], quotes: [quote], commitments: [], tasks: [], assets: [], reservations: [], appeals: [], events: [], ledgerEntries: [], idempotency: {}, balances: balances([], normalized.initialCashMinor) };
  return deepFreeze(state);
}

export function dispatch(state, command) {
  try {
    if (!state || !command?.id || !command?.type || !command?.actor?.role || !command.actor.id) return no('INVALID_COMMAND');
    const prior = state.idempotency[command.id]; const fp = fingerprint(command);
    if (prior) return prior.fingerprint === fp ? yes(state, prior.result) : no('IDEMPOTENCY_CONFLICT');
    if (!permitted(command)) return no('FORBIDDEN');
    if (command.expectedVersion !== undefined && command.expectedVersion !== state.aggregateVersion) return no('STALE_VERSION', 'Expected aggregate version does not match', { actual: state.aggregateVersion });
    switch (command.type) {
      case 'SELECT_OFFER': return selectOffer(state, command);
      case 'REPLACE_QUOTE': return replaceQuote(state, command);
      case 'CONFIRM_COMMITMENT': return confirm(state, command);
      case 'REQUEST_EXIT': return requestExit(state, command);
      case 'ACCEPT_TASK': return acceptTask(state, command);
      case 'DECLINE_TASK': return declineTask(state, command);
      case 'COMPLETE_INSPECTION': return completeInspection(state, command);
      case 'RESCHEDULE_TASK': return reschedule(state, command);
      case 'RESERVE_ITEM': return reserve(state, command);
      case 'CANCEL_RESERVATION': return cancelReservation(state, command);
      case 'ACCEPT_DELIVERY': return acceptDelivery(state, command);
      case 'CONFIRM_DELIVERY': return confirmDelivery(state, command);
      case 'APPROVE_POLICY': return approvePolicy(state, command);
      case 'SUBMIT_APPEAL': return submitAppeal(state, command);
      case 'RESOLVE_APPEAL': return resolveAppeal(state, command);
      default: return no('UNKNOWN_COMMAND');
    }
  } catch (error) { return no(String(error.message ?? error)); }
}

function selectOffer(state, c) {
  if (state.status !== 'DRAFT') return no('INVALID_TRANSITION');
  const quote = state.quotes.find((q) => q.quoteId === c.payload?.quoteId && q.status === 'OPEN'); if (!quote) return no('QUOTE_NOT_OPEN');
  if ((c.issuedAtTick ?? state.tick) > quote.expiresAtTick) return no('QUOTE_EXPIRED');
  const commitment = { commitmentId: quote.candidateCommitmentId, quoteId: quote.quoteId, residentId: c.actor.id, status: 'SELECTED', contract: null };
  return withCommit(state, c, 'OfferSelected', { ids: { commitmentId: commitment.commitmentId, quoteId: quote.quoteId } }, (d) => { d.status = 'OFFER_SELECTED'; d.commitments.push(commitment); });
}
function replaceQuote(state, c) {
  if (!canReplaceQuote(state)) return no('QUOTE_LOCKED');
  const next = makeQuote(normalizeConfig({ ...state.config, pricing: { ...state.config.pricing, ...(c.payload?.quote?.pricing ?? {}) } }), `quote-${state.quotes.length + 1}`, `commitment-${state.quotes.length + 1}`);
  return withCommit(state, c, 'QuoteReplaced', { ids: { quoteId: next.quoteId } }, (d) => { d.status = 'DRAFT'; d.quotes = d.quotes.map((q) => ({ ...q, status: 'REPLACED' })); d.commitments = d.commitments.map((x) => x.status === 'SELECTED' ? { ...x, status: 'SUPERSEDED' } : x); d.quotes.push(next); });
}
function confirm(state, c) {
  const commitment = state.commitments.find((x) => x.commitmentId === (c.payload?.commitmentId ?? state.commitments.find((x) => x.status === 'SELECTED')?.commitmentId));
  if (!commitment || commitment.status !== 'SELECTED') return no('COMMITMENT_NOT_SELECTED');
  const quote = state.quotes.find((q) => q.quoteId === commitment.quoteId); if ((c.issuedAtTick ?? state.tick) > quote.expiresAtTick) return no('QUOTE_EXPIRED'); const reserve = requiredReserveMinor(quote.pricing);
  if (state.balances.cashMinor + quote.pricing.exitFeeMinor - state.balances.reservedMinor < reserve) return no('INSUFFICIENT_AVAILABLE_CASH');
  const e = [entry({ kind: 'reserve_hold', debit: 'reserve_liability', credit: 'reserve_control', amountMinor: reserve, memo: 'guarantee and inspection reserve' }),
    entry({ kind: 'consumer_payment_expected', debit: 'consumer_receivable', credit: 'consumer_paid_expected', amountMinor: quote.pricing.retailMinor + quote.pricing.exitFeeMinor, memo: 'resident expected retail and exit fee' }),
    entry({ kind: 'consumer_payment_actual', debit: 'external_retailer_and_platform', credit: 'consumer_paid_actual', amountMinor: quote.pricing.retailMinor + quote.pricing.exitFeeMinor, memo: 'simulated resident retail and exit fee' }),
    entry({ kind: 'exit_fee_received', debit: 'platform_cash', credit: 'consumer_receivable', amountMinor: quote.pricing.exitFeeMinor, memo: 'exit service fee' })];
  return withCommit(state, c, 'CommitmentConfirmed', { ids: { commitmentId: commitment.commitmentId }, reserveMinor: reserve }, (d) => { d.status = 'COMMITTED'; const x = d.commitments.find((v) => v.commitmentId === commitment.commitmentId); x.status = 'CONFIRMED'; x.contract = { quoteId: quote.quoteId, pricing: clone(quote.pricing), policyBundleRef: clone(quote.policyBundleRef), committedAtVersion: state.aggregateVersion + 1 }; }, e);
}
function requestExit(state, c) {
  if (!['COMMITTED', 'INSPECTION_FAILED'].includes(state.status)) return no('INVALID_TRANSITION');
  const commitment = state.commitments.find((x) => x.residentId === c.actor.id && x.status === 'CONFIRMED'); if (!commitment) return no('NO_CONFIRMED_COMMITMENT');
  if (state.tasks.some((t) => t.commitmentId === commitment.commitmentId && ['PENDING', 'ACCEPTED'].includes(t.status))) return no('EXIT_ALREADY_REQUESTED');
  const taskId = newId(state, 'task'); const task = makeInspectionTask({ taskId, commitmentId: commitment.commitmentId, partnerId: state.config.partnerIds[0], tick: state.tick });
  const needsReinspectionReserve = state.tasks.some((t) => t.commitmentId === commitment.commitmentId && t.status === 'FAILED'); const inspectionMinor = commitment.contract.pricing.inspectionMinor;
  if (needsReinspectionReserve && state.balances.availableCashMinor < inspectionMinor) return no('INSUFFICIENT_AVAILABLE_CASH');
  const entries = needsReinspectionReserve ? [entry({ kind: 'reserve_hold', debit: 'reserve_liability', credit: 'reserve_control', amountMinor: inspectionMinor, memo: 'reinspection reserve' })] : [];
  return withCommit(state, c, 'ExitRequested', { ids: { taskId, commitmentId: commitment.commitmentId }, ...(needsReinspectionReserve ? { reinspectionReserveMinor: inspectionMinor } : {}) }, (d) => { d.status = 'EXIT_REQUESTED'; d.tasks.push(task); nextIds(d, 'task'); }, entries);
}
function acceptTask(state, c) { const task = requireTask(state, c, 'INSPECTION'); if (task.ok === false) return task; if (!taskAcceptable(task)) return no('INVALID_TRANSITION'); return withCommit(state, c, 'ServiceTaskAccepted', { ids: { taskId: task.taskId } }, (d) => { d.tasks = replaceTask(d.tasks, { ...task, status: 'ACCEPTED' }); }); }
function declineTask(state, c) { const task = requireTask(state, c, 'INSPECTION'); if (task.ok === false) return task; if (!taskAcceptable(task)) return no('INVALID_TRANSITION'); const candidates = state.config.partnerIds.filter((id) => id !== task.partnerId); const nextPartnerId = c.payload?.partnerId ?? candidates[0]; if (!nextPartnerId || !candidates.includes(nextPartnerId)) return no('NO_ALTERNATE_PARTNER'); const replacementId = newId(state, 'task'); const replacement = makeInspectionTask({ taskId: replacementId, commitmentId: task.commitmentId, partnerId: nextPartnerId, tick: state.tick }); return withCommit(state, c, 'ServiceTaskDeclined', { ids: { taskId: task.taskId, replacementTaskId: replacementId }, replacementPartnerId: nextPartnerId }, (d) => { d.tasks = replaceTask(d.tasks, { ...task, status: 'DECLINED', declineReason: c.payload?.reason ?? null }); d.tasks.push(replacement); nextIds(d, 'task'); }); }
function completeInspection(state, c) {
  const task = requireTask(state, c, 'INSPECTION'); if (task.ok === false) return task;
  const reportSource = c.payload?.sourceId && c.payload?.sourceEventId ? `${c.payload.sourceId}/${c.payload.sourceEventId}` : null;
  const priorReport = reportSource && state.events.find((e) => e.payload?.reportSource === reportSource);
  if (priorReport) {
    if (priorReport.payload.ids?.taskId !== task.taskId || priorReport.payload.outcome !== c.payload?.outcome) return no('DUPLICATE_SERVICE_REPORT_CONFLICT');
    return yes(state, Object.freeze({ eventId: priorReport.eventId, aggregateVersion: priorReport.aggregateVersion, ids: priorReport.payload.ids ?? {} }));
  }
  if (task.status !== 'ACCEPTED') return no('INVALID_TRANSITION'); const outcome = c.payload?.outcome; if (!['pass', 'fail'].includes(outcome)) return no('INVALID_REPORT');
  if (reportSource && state.tasks.some((x) => x.reportSource === reportSource)) return no('DUPLICATE_SERVICE_REPORT');
  const commitment = state.commitments.find((x) => x.commitmentId === task.commitmentId); const p = commitment.contract.pricing; const inspectionPay = entry({ kind: 'inspection_paid', debit: 'partner_service_expense', credit: 'platform_cash', amountMinor: p.inspectionMinor, memo: 'completed inspection', actorId: c.actor.id }); const reserveInspection = entry({ kind: 'reserve_release', debit: 'reserve_control', credit: 'reserve_liability', amountMinor: p.inspectionMinor, memo: 'inspection obligation settled' });
  const extra = outcome === 'pass' ? [entry({ kind: 'buyback_paid', debit: 'guarantee_expense', credit: 'platform_cash', amountMinor: p.guaranteeMinor, memo: 'simulated guaranteed buyback', actorId: commitment.residentId }), entry({ kind: 'reserve_release', debit: 'reserve_control', credit: 'reserve_liability', amountMinor: p.guaranteeMinor, memo: 'guarantee obligation settled' })] : [];
  const assetId = outcome === 'pass' ? 'asset-1' : null;
  const inventory = outcome === 'pass' ? [entry({ kind: 'inventory_acquired', debit: 'inventory_book', credit: 'guarantee_expense', amountMinor: p.guaranteeMinor, memo: 'buyback inventory capitalized' })] : [];
  return withCommit(state, c, outcome === 'pass' ? 'InspectionPassed' : 'InspectionFailed', { ids: { taskId: task.taskId, ...(assetId ? { assetId } : {}) }, outcome, reportSource }, (d) => { d.tasks = replaceTask(d.tasks, { ...task, status: outcome === 'pass' ? 'COMPLETED' : 'FAILED', reportSource }); if (outcome === 'pass') { d.status = 'ASSET_AVAILABLE'; d.assets.push({ assetId, commitmentId: task.commitmentId, status: 'AVAILABLE', resaleMinor: p.resaleMinor, bookMinor: p.guaranteeMinor }); } else d.status = 'INSPECTION_FAILED'; }, [inspectionPay, reserveInspection, ...extra, ...inventory]);
}
function reschedule(state, c) { const task = taskFor(state, c.payload?.taskId); if (!task || !['PENDING', 'ACCEPTED'].includes(task.status)) return no('TASK_NOT_RESCHEDULABLE'); const partnerId = c.payload?.partnerId ?? state.config.partnerIds.find((id) => id !== task.partnerId) ?? task.partnerId; if (!state.config.partnerIds.includes(partnerId)) return no('UNKNOWN_PARTNER'); return withCommit(state, c, 'ServiceTaskRescheduled', { ids: { taskId: task.taskId }, partnerId }, (d) => { d.tasks = replaceTask(d.tasks, { ...task, status: 'PENDING', partnerId, rescheduledAtVersion: state.aggregateVersion + 1 }); }); }
function reserve(state, c) { const asset = state.assets.find((a) => a.assetId === c.payload?.assetId); if (!asset) return no('ASSET_NOT_FOUND'); if (asset.status !== 'AVAILABLE') return no('RESERVATION_TAKEN'); const reservationId = newId(state, 'reservation'); const taskId = newId(state, 'task'); const task = makeDeliveryTask({ taskId, assetId: asset.assetId, reservationId, partnerId: state.config.partnerId, tick: state.tick }); return withCommit(state, c, 'ItemReserved', { ids: { assetId: asset.assetId, reservationId, taskId } }, (d) => { d.assets = d.assets.map((a) => a.assetId === asset.assetId ? { ...a, status: 'RESERVED' } : a); d.reservations.push({ reservationId, assetId: asset.assetId, buyerId: c.actor.id, status: 'ACTIVE' }); d.tasks.push(task); nextIds(d, 'reservation'); nextIds(d, 'task'); }); }
function cancelReservation(state, c) { const reservation = state.reservations.find((r) => r.reservationId === c.payload?.reservationId); if (!reservation || reservation.buyerId !== c.actor.id) return no('RESERVATION_NOT_FOUND'); if (reservation.status !== 'ACTIVE') return no('INVALID_TRANSITION'); const task = state.tasks.find((t) => t.reservationId === reservation.reservationId); if (task?.status === 'ACCEPTED') return no('DELIVERY_ALREADY_EXECUTING'); return withCommit(state, c, 'ReservationCancelled', { ids: { reservationId: reservation.reservationId, assetId: reservation.assetId } }, (d) => { d.reservations = d.reservations.map((r) => r.reservationId === reservation.reservationId ? { ...r, status: 'CANCELLED' } : r); d.assets = d.assets.map((a) => a.assetId === reservation.assetId ? { ...a, status: 'AVAILABLE' } : a); if (task) d.tasks = replaceTask(d.tasks, { ...task, status: 'CANCELLED' }); }); }
function acceptDelivery(state, c) { const task = requireTask(state, c, 'DELIVERY'); if (task.ok === false) return task; if (!taskAcceptable(task)) return no('INVALID_TRANSITION'); return withCommit(state, c, 'DeliveryAccepted', { ids: { taskId: task.taskId } }, (d) => { d.tasks = replaceTask(d.tasks, { ...task, status: 'ACCEPTED' }); }); }
function confirmDelivery(state, c) { const reservation = state.reservations.find((r) => r.reservationId === c.payload?.reservationId && r.buyerId === c.actor.id); const task = taskFor(state, c.payload?.taskId); if (!reservation || !task || task.reservationId !== reservation.reservationId || task.status !== 'ACCEPTED') return no('DELIVERY_NOT_READY'); const asset = state.assets.find((a) => a.assetId === reservation.assetId); const p = state.commitments.find((x) => x.commitmentId === asset.commitmentId).contract.pricing; const buyerTotal = p.resaleMinor + p.coordinationMinor + p.deliveryMinor; const e = [entry({ kind: 'buyer_payment_expected', debit: 'buyer_receivable', credit: 'consumer_paid_expected', amountMinor: buyerTotal, memo: 'resale, coordination and delivery expected' }), entry({ kind: 'buyer_payment_actual', debit: 'buyer', credit: 'consumer_paid_actual', amountMinor: buyerTotal, memo: 'simulated buyer payment' }), entry({ kind: 'resale_received', debit: 'platform_cash', credit: 'buyer_receivable', amountMinor: p.resaleMinor, memo: 'resale price' }), entry({ kind: 'coordination_received', debit: 'platform_cash', credit: 'buyer_receivable', amountMinor: p.coordinationMinor, memo: 'coordination fee' }), entry({ kind: 'delivery_received', debit: 'platform_cash', credit: 'buyer_receivable', amountMinor: p.deliveryMinor, memo: 'delivery fee collected for provider' }), entry({ kind: 'delivery_paid', debit: 'delivery_expense', credit: 'platform_cash', amountMinor: p.deliveryMinor, memo: 'delivery provider paid', actorId: task.partnerId }), entry({ kind: 'inventory_disposed', debit: 'cost_of_sales', credit: 'inventory_book', amountMinor: asset.bookMinor, memo: 'sold inventory derecognized' })]; return withCommit(state, c, 'DeliveryConfirmed', { ids: { taskId: task.taskId, assetId: asset.assetId, reservationId: reservation.reservationId }, saleMinor: p.resaleMinor }, (d) => { d.status = 'DELIVERED'; d.tasks = replaceTask(d.tasks, { ...task, status: 'COMPLETED' }); d.reservations = d.reservations.map((r) => r.reservationId === reservation.reservationId ? { ...r, status: 'COMPLETED' } : r); d.assets = d.assets.map((a) => a.assetId === asset.assetId ? { ...a, status: 'SOLD', buyerId: c.actor.id } : a); }, e); }
function approvePolicy(state, c) { const next = makePolicySnapshot(c.payload?.policy, state.tick); if (next.version <= state.activePolicy.version) return no('INVALID_POLICY_VERSION'); return withCommit(state, c, 'PolicyApproved', { ids: { policyId: next.id }, policyVersion: next.version }, (d) => { d.activePolicy = next; d.policyHistory.push(next); }); }
function submitAppeal(state, c) { const againstActorId = c.payload?.againstActorId; if (!againstActorId || !c.payload?.reason) return no('INVALID_APPEAL'); const appealId = newId(state, 'appeal'); return withCommit(state, c, 'AppealSubmitted', { ids: { appealId } }, (d) => { d.appeals.push({ appealId, submittedBy: c.actor.id, submittedRole: c.actor.role, againstActorId, reason: c.payload.reason, status: 'OPEN' }); nextIds(d, 'appeal'); }); }
function resolveAppeal(state, c) { const appeal = state.appeals.find((a) => a.appealId === c.payload?.appealId); if (!appeal || appeal.status !== 'OPEN') return no('APPEAL_NOT_OPEN'); if (appeal.againstActorId === c.actor.id || appeal.submittedBy === c.actor.id) return no('CONFLICT_OF_INTEREST'); return withCommit(state, c, 'AppealResolved', { ids: { appealId: appeal.appealId }, resolution: c.payload?.resolution ?? 'resolved' }, (d) => { d.appeals = d.appeals.map((a) => a.appealId === appeal.appealId ? { ...a, status: 'RESOLVED', resolution: c.payload?.resolution ?? 'resolved', resolvedBy: c.actor.id } : a); }); }

export function project(state, role, actorId = null) {
  if (!ROLES.has(role)) return { error: { code: 'UNKNOWN_ROLE' } };
  const base = { schemaVersion: 1, caseId: state.caseId, aggregateVersion: state.aggregateVersion, status: state.status, actions: [] };
  if (role === 'resident') { const own = state.commitments.filter((c) => !actorId || c.residentId === actorId); const contract = own.find((c) => c.contract)?.contract; const grossPaymentActual = contract ? contract.pricing.retailMinor + contract.pricing.exitFeeMinor : 0; const buybackReceived = state.ledgerEntries.filter((e) => e.kind === 'buyback_paid' && e.actorId === actorId).reduce((sum, e) => sum + e.amountMinor, 0); return { ...base, ids: { commitmentIds: own.map((c) => c.commitmentId) }, quote: state.quotes.find((q) => q.status === 'OPEN') ?? null, commitments: own, billed: { grossPaymentActual, buybackReceived, netActual: grossPaymentActual - buybackReceived, maintenanceEstimatedMinor: contract?.pricing.maintenanceMinor ?? 0 }, appeals: state.appeals.filter((a) => !actorId || a.submittedBy === actorId), actions: ['SELECT_OFFER', 'REQUEST_EXIT', 'SUBMIT_APPEAL'] }; }
  if (role === 'partner') { const tasks = state.tasks.filter((t) => !actorId || t.partnerId === actorId); return { ...base, ids: { taskIds: tasks.map((t) => t.taskId) }, tasks, actions: ['ACCEPT_TASK', 'DECLINE_TASK', 'COMPLETE_INSPECTION', 'ACCEPT_DELIVERY', 'SUBMIT_APPEAL'] }; }
  if (role === 'buyer') { const reservations = state.reservations.filter((r) => !actorId || r.buyerId === actorId); const ownAssetIds = new Set(reservations.map((r) => r.assetId)); return { ...base, ids: { reservationIds: reservations.map((r) => r.reservationId) }, assets: state.assets.filter((a) => a.status === 'AVAILABLE' || ownAssetIds.has(a.assetId)).map((a) => ({ assetId: a.assetId, status: a.status, resaleMinor: a.resaleMinor })), reservations, actions: ['RESERVE_ITEM', 'CANCEL_RESERVATION', 'CONFIRM_DELIVERY'] }; }
  if (role === 'ops') return { ...base, ids: { commitmentIds: state.commitments.map((c) => c.commitmentId), taskIds: state.tasks.map((t) => t.taskId) }, commitments: state.commitments, tasks: state.tasks, partnerOptions: state.config.partnerIds, balances: state.balances, actions: ['CONFIRM_COMMITMENT', 'REPLACE_QUOTE', 'RESCHEDULE_TASK'] };
  if (role === 'governance') return { ...base, ids: { appealIds: state.appeals.map((a) => a.appealId) }, activePolicy: state.activePolicy, appeals: state.appeals, actions: ['APPROVE_POLICY', 'RESOLVE_APPEAL'] };
  return { ...base, activePolicy: { id: state.activePolicy.id, version: state.activePolicy.version }, inventory: state.assets.filter((a) => a.status === 'AVAILABLE').length, actions: [] };
}
