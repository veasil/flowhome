import { createCase, dispatch } from './domain/domain.mjs';

export const DATASETS = Object.freeze([
  { id: 'starter12', label: '日常社区 · 12 户', count: 12, description: '覆盖选品、承诺、退出、验收与交付的日常样本。' },
  { id: 'moving24', label: '搬家旺季 · 24 户', count: 24, description: '更多退出需求与可流转库存，观察履约队列与资金占用。' },
  { id: 'stress18', label: '服务压力 · 18 户', count: 18, description: '集中退出与验收失败，观察复检、准备金和服务积压。' },
]);
const STAGES = {
  starter12: ['draft','draft','selected','committed','committed','exit','exit','inspectionfailed','assetavailable','assetavailable','reserved','delivered'],
  moving24: ['draft','draft','draft','draft','selected','selected','committed','committed','exit','exit','exit','exit','exit','inspectionfailed','assetavailable','assetavailable','assetavailable','assetavailable','assetavailable','reserved','reserved','delivered','delivered','delivered'],
  stress18: ['draft','selected','committed','committed','exit','exit','exit','exit','exit','exit','inspectionfailed','inspectionfailed','inspectionfailed','inspectionfailed','assetavailable','assetavailable','reserved','delivered'],
};
const NAMES = ['林悦','陈宇','王宁','周可','李然','赵一','许青','沈禾','吴桐','何安','陆远','苏晴','郑舟','方溪','顾言','唐薇','程墨','蒋南','宋晨','罗玥','叶川','夏禾','杜若','孟星'];
const DISTRICTS = ['徐汇','浦东','静安','长宁'];
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

function seedCase(id, stage) {
  let state = createCase({ caseId: id, category: 'purifier', durationMonths: 12 });
  function run(type, role, payload = {}, actorId) {
    const result = dispatch(state, { id: `${id}-seed-${state.aggregateVersion + 1}`, type, actor: { role, id: actorId ?? `${role}-1` }, payload });
    if (!result.ok) throw new Error(`SEED_FAILED:${id}:${type}:${result.error.code}`);
    state = result.state;
  }
  if (stage === 'draft') return state;
  run('SELECT_OFFER', 'resident', { quoteId: 'quote-1' });
  if (stage === 'selected') return state;
  run('CONFIRM_COMMITMENT', 'ops');
  if (stage === 'committed') return state;
  run('REQUEST_EXIT', 'resident');
  if (stage === 'exit') return state;
  run('ACCEPT_TASK', 'partner', { taskId: 'task-1' }, 'partner-alpha');
  run('COMPLETE_INSPECTION', 'partner', { taskId: 'task-1', outcome: stage === 'inspectionfailed' ? 'fail' : 'pass' }, 'partner-alpha');
  if (stage === 'inspectionfailed' || stage === 'assetavailable') return state;
  run('RESERVE_ITEM', 'buyer', { assetId: 'asset-1' });
  if (stage === 'reserved') return state;
  run('ACCEPT_DELIVERY', 'partner', { taskId: 'task-2' }, 'partner-alpha');
  run('CONFIRM_DELIVERY', 'buyer', { taskId: 'task-2', reservationId: 'reservation-1' });
  return state;
}

export function createMarket(datasetId = 'starter12') {
  if (!STAGES[datasetId]) throw new Error('UNKNOWN_DATASET');
  const cases = STAGES[datasetId].map((stage, index) => {
    const id = `${datasetId}-${String(index + 1).padStart(2, '0')}`;
    return { id, name: NAMES[index], district: DISTRICTS[index % DISTRICTS.length],
      intent: ['draft', 'selected'].includes(stage) ? 'move-in' : 'move-out', state: seedCase(id, stage) };
  });
  return freeze({ version: 1, datasetId, selectedCaseId: cases[0].id, cases, matches: [], openingCashMinor: 6000000 });
}

export function marketBalances(market) {
  const total = { cashMinor: market.openingCashMinor, reservedMinor: 0, availableCashMinor: 0, inventoryBookMinor: 0, resultMinor: 0, consumerPaidActualMinor: 0, consumerPaidExpectedMinor: 0 };
  for (const item of market.cases) {
    total.cashMinor += item.state.balances.cashMinor - item.state.config.initialCashMinor;
    for (const key of ['reservedMinor','inventoryBookMinor','resultMinor','consumerPaidActualMinor','consumerPaidExpectedMinor']) total[key] += item.state.balances[key];
  }
  total.availableCashMinor = total.cashMinor - total.reservedMinor;
  return total;
}

export function dispatchMarket(market, caseId, command) {
  const index = market.cases.findIndex(item => item.id === caseId);
  if (index < 0) return { ok: false, market, error: { code: 'CASE_NOT_FOUND' } };
  const result = dispatch(market.cases[index].state, command);
  if (!result.ok) return { ...result, market };
  if (result.state === market.cases[index].state) return { ...result, market };
  if (['SELECT_OFFER','CONFIRM_COMMITMENT'].includes(command.type) && projectedMatches(market).some(m => m.demandCaseId === caseId && ['RESERVED','COMPLETED'].includes(m.status))) return { ok: false, market, error: { code: 'DEMAND_ALREADY_MATCHED' } };
  const cases = market.cases.map((item, i) => i === index ? { ...item, state: result.state } : item);
  const next = { ...market, version: market.version + 1, cases };
  if (marketBalances(next).availableCashMinor < 0) return { ok: false, market, error: { code: 'INSUFFICIENT_SHARED_AVAILABLE_CASH', message: '平台共享可用资金不足，本次操作未入账。' } };
  return { ...result, market: freeze(next) };
}

function projectedMatches(market) {
  return (market.matches ?? []).map(link => {
    const demand = market.cases.find(c => c.id === link.demandCaseId);
    const supply = market.cases.find(c => c.id === link.supplyCaseId);
    const reservation = supply?.state.reservations.find(r => r.reservationId === link.reservationId);
    return { ...link, demandName: demand?.name, supplyName: supply?.name,
      status: reservation?.status === 'COMPLETED' ? 'COMPLETED' : reservation?.status === 'ACTIVE' ? 'RESERVED' : reservation?.status === 'CANCELLED' ? 'CANCELLED' : 'UNKNOWN' };
  });
}

export function reserveMatch(market, demandId, supplyId, commandId) {
  const fail = (code) => ({ ok: false, market, error: { code } });
  if (typeof commandId !== 'string' || !commandId) return fail('INVALID_COMMAND');
  const prior = (market.matches ?? []).find(m => m.commandId === commandId);
  if (prior) return prior.demandCaseId === demandId && prior.supplyCaseId === supplyId
    ? { ok: true, market, state: market.cases.find(c => c.id === supplyId)?.state, result: { ids: { matchId: prior.id, reservationId: prior.reservationId, assetId: prior.assetId } } }
    : fail('IDEMPOTENCY_CONFLICT');
  if (demandId === supplyId) return fail('SAME_CASE_MATCH');
  const demand = market.cases.find(c => c.id === demandId);
  const supply = market.cases.find(c => c.id === supplyId);
  if (!demand || !supply) return fail('CASE_NOT_FOUND');
  if (!['DRAFT','OFFER_SELECTED'].includes(demand.state.status)) return fail('DEMAND_NOT_ELIGIBLE');
  if (projectedMatches(market).some(m => m.demandCaseId === demandId && ['RESERVED','COMPLETED'].includes(m.status))) return fail('DEMAND_ALREADY_MATCHED');
  if (demand.state.config.category !== supply.state.config.category) return fail('CATEGORY_MISMATCH');
  const asset = supply.state.assets.find(a => a.status === 'AVAILABLE');
  if (!asset) return fail('NO_AVAILABLE_ASSET');
  const pricing = supply.state.commitments.find(c => c.commitmentId === asset.commitmentId)?.contract?.pricing;
  if (!pricing) return fail('CONTRACT_NOT_FOUND');
  const buyerTotalMinor = asset.resaleMinor + pricing.coordinationMinor + pricing.deliveryMinor;
  if (buyerTotalMinor > demand.state.config.budgetMinor) return fail('MATCH_EXCEEDS_BUDGET');
  const result = dispatchMarket(market, supplyId, { id: commandId, type: 'RESERVE_ITEM', actor: { role: 'buyer', id: 'buyer-1' }, expectedVersion: supply.state.aggregateVersion, payload: { assetId: asset.assetId } });
  if (!result.ok) return result;
  // An unrelated command with this id must never acquire a participant link.
  if (result.market === market) return fail('COMMAND_ALREADY_USED');
  const link = { id: `${demandId}->${supplyId}:${result.result.ids.reservationId}`, commandId, demandCaseId: demandId, supplyCaseId: supplyId, assetId: asset.assetId, reservationId: result.result.ids.reservationId, buyerId: 'buyer-1', buyerTotalMinor };
  return { ...result, market: freeze({ ...result.market, matches: [...(market.matches ?? []), link] }), result: { ...result.result, ids: { ...result.result.ids, matchId: link.id } } };
}

export function projectMarket(market) {
  const matches = projectedMatches(market);
  const matchedDemand = new Set(matches.filter(m => ['RESERVED','COMPLETED'].includes(m.status)).map(m => m.demandCaseId));
  const counts = {};
  const tasks = [], events = [], reservations = [], supply = [], demand = [];
  const cases = market.cases.map(item => {
    const { state, ...meta } = item;
    counts[state.status] = (counts[state.status] ?? 0) + 1;
    const scope = row => ({ ...row, caseId: item.id, name: item.name, district: item.district });
    for (const task of state.tasks) tasks.push(scope({ ...task, id: `${item.id}:${task.taskId}` }));
    for (const event of state.events) events.push(scope({ ...event, id: `${item.id}:${event.eventId}` }));
    for (const reservation of state.reservations) reservations.push(scope({ ...reservation, id: `${item.id}:${reservation.reservationId}` }));
    for (const asset of state.assets.filter(a => a.status === 'AVAILABLE')) {
      const pricing = state.commitments.find(c => c.commitmentId === asset.commitmentId).contract.pricing;
      supply.push(scope({ ...asset, id: `${item.id}:${asset.assetId}`, category: state.config.category, buyerTotalMinor: asset.resaleMinor + pricing.coordinationMinor + pricing.deliveryMinor }));
    }
    if (['DRAFT','OFFER_SELECTED'].includes(state.status) && !matchedDemand.has(item.id)) demand.push(scope({ id: `${item.id}:demand`, category: state.config.category, budgetMinor: state.config.budgetMinor, status: 'PROSPECTIVE' }));
    return { ...meta, status: state.status, aggregateVersion: state.aggregateVersion, taskCount: state.tasks.filter(t => ['PENDING','ACCEPTED'].includes(t.status)).length };
  });
  const opportunities = demand.flatMap(want => supply.filter(asset => asset.caseId !== want.caseId && asset.category === want.category && asset.buyerTotalMinor <= want.budgetMinor).map(asset => ({
    id: `${want.id}->${asset.id}`, demandCaseId: want.caseId, supplyCaseId: asset.caseId, assetId: asset.assetId,
    demandName: want.name, supplyName: asset.name, district: asset.district, sameDistrict: want.district === asset.district,
    resaleMinor: asset.resaleMinor, buyerTotalMinor: asset.buyerTotalMinor, status: 'PROSPECTIVE', label: '潜在匹配 · 尚未关联成交',
  }))).sort((a,b) => Number(b.sameDistrict) - Number(a.sameDistrict) || a.id.localeCompare(b.id));
  return {
    version: market.version, datasetId: market.datasetId, selectedCaseId: market.selectedCaseId,
    balances: marketBalances(market), counts, cases, demand, supply, opportunities, tasks, events, reservations, matches,
    totalCases: cases.length, activeTaskCount: tasks.filter(t => ['PENDING','ACCEPTED'].includes(t.status)).length,
    completedDeliveries: events.filter(e => e.type === 'DeliveryConfirmed').length,
    confirmedCommitments: events.filter(e => e.type === 'CommitmentConfirmed').length,
    exitRequests: events.filter(e => e.type === 'ExitRequested').length,
    failedInspections: events.filter(e => e.type === 'InspectionFailed').length,
    matchingNote: '线索尚未成交。确认匹配后记录需求案例与供给案例的关联，预订及交付记入供给案例；已关联需求不再重复推荐。',
  };
}
