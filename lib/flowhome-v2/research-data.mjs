// Read-only presentation adapter. Keep outside the decision engine.
import { generateWorld, CATEGORIES } from './engine/world-v2.mjs';
import { DEFAULT_V2, POLICY_V2 } from './engine/city-v2.mjs';
import { STRATEGIES_V2 } from './engine/observed-v2.mjs';

export const RESEARCH_VIEW_VERSION = 'flowhome-research-view-v1';
export const PARAMETER_DEFINITIONS = Object.freeze([
  { key: 'seed', label: '随机种子', type: 'integer', min: 0, step: 1, scope: 'world', help: '相同种子与世界参数可复现外生需求。' },
  { key: 'weeks', label: '观察周数', type: 'integer', min: 16, max: 520, step: 1, scope: 'world' },
  { key: 'scenario', label: '压力情景', type: 'select', options: ['normal', 'demand', 'capacity', 'exit'], scope: 'world', help: '需求与运力冲击从第 53 周出现；退出情景使用停止到达周。' },
  { key: 'strategy', label: '策略组合', type: 'select', options: STRATEGIES_V2.map(s => ({ value: s.id, label: s.name })), scope: 'policy' },
  { key: 'initialAssets', label: '初始物品数', type: 'integer', min: 0, step: 1, scope: 'world', help: '外部初始持有人物品，分散到观察期内上架。' },
  { key: 'tenureMonths', label: '基准使用月数', type: 'number', min: 1, max: 60, step: 1, scope: 'world', help: '改变合成使用时长，同时改变合同预计退出时间。' },
  { key: 'capitalMinor', label: '初始资金（分）', type: 'integer', min: 0, step: 10000, scope: 'policy' },
  { key: 'capacityMultiplier', label: '运力倍数', type: 'number', min: 0, max: 5, step: 0.1, scope: 'world', help: '基础运力为 4 个服务商 × 每周 7 个服务位；交付和回收共用。' },
  { key: 'uptake', label: '预测建议采用率', type: 'number', min: 0, max: 1, step: 0.05, scope: 'behavior' },
  { key: 'guaranteeUptake', label: '回购保障采用率', type: 'number', min: 0, max: 1, step: 0.05, scope: 'behavior' },
  { key: 'predictionBias', label: '预测偏置', type: 'number', min: -1, max: 3, step: 0.1, scope: 'algorithm', help: '八周观测历史外推的乘数偏置，不是训练参数。' },
  { key: 'exitStopTick', label: '停止需求到达（tick）', type: 'integer', min: 0, step: 1, scope: 'world', help: '仅退出情景生效；tick 从 0 开始。' },
].map(p => Object.freeze({ ...p, default: DEFAULT_V2[p.key] })));

export const FIELD_CATALOG = Object.freeze([
  { table: 'demands', fields: ['id', 'tick', 'category', 'group', 'minQuality', 'budgetMinor', 'deadlineTick', 'acceptsUsed'], role: 'synthetic-input', visibility: '仅当前请求的品类、预算、质量和期限传给匹配器；不是全量需求表。' },
  { table: 'demands', fields: ['recommendationDraw', 'guaranteeDraw', 'actualTenureWeeks'], role: 'hidden-outcome', visibility: '合成行为及结果执行专用；不传给预测或匹配器。' },
  { table: 'initialAssets', fields: ['id', 'category', 'quality', 'releaseTick', 'priceMinor'], role: 'synthetic-input', visibility: '物品实际上架后才进入公开库存；不向算法公开未来上架时间。' },
  { table: 'observedSnapshot', fields: ['asOfTick', 'publicInventory', 'observedDemandHistory', 'providerOffers', 'commitmentBudgetProjection'], role: 'algorithm-observation', visibility: '算法输入；禁止未来观测与隐藏世界字段。' },
  { table: 'events', fields: ['eventId', 'tick', 'type', 'caseId', 'assetId', 'category', 'providerId', 'amountMinor'], role: 'simulation-output', visibility: '仿真事件账本；字段依事件类型可选。没有真实交易。' },
  { table: 'snapshots', fields: ['tick', 'newDemand', 'served', 'transfers', 'newPurchases', 'cashMinor', 'reservedMinor', 'inventoryCount', 'pickupPending', 'providerCapacity'], role: 'simulation-output', visibility: '每周结果快照；用于回放和统计，不等于决策时公开库存。' },
]);

export const DATA_FEEDBACK_PHASES = Object.freeze([
  { id: 'export', label: '产品事件导出', status: 'planned', detail: '未来接入去标识化事件；当前真实记录数为 0。' },
  { id: 'quality', label: '质量检查', status: 'planned', detail: '检查字段、时序、关联、缺失与来源授权。' },
  { id: 'version', label: '冻结数据版本', status: 'planned', detail: '记录来源、窗口、schema、校验与数据集指纹。' },
  { id: 'evaluate', label: '离线评估', status: 'planned', detail: '固定时间切分和基线，检查泄漏与分组表现。' },
  { id: 'promote', label: '人工审核发布', status: 'planned', detail: '人工决定候选规则是否进入产品；没有自动训练或自动上线。' },
]);

function fingerprint(value) {
  const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(key => [key, canonical(v[key])])) : v;
  let h = 2166136261;
  const text = JSON.stringify(canonical(value));
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16).padStart(8, '0');
}

function reconstruct(city) {
  const world = generateWorld(city.config);
  const matches = fingerprint(world) === city.metadata.worldFixtureFingerprint;
  return { world, matches };
}

function descriptor(city, fixture) {
  return {
    kind: 'synthetic-simulation', realRecordCount: 0,
    datasetVersion: city.metadata.worldVersion,
    datasetId: `${city.metadata.worldVersion}:${city.metadata.worldFixtureFingerprint}`,
    runId: city.metadata.runId,
    engineVersion: city.metadata.engineVersion,
    algorithmVersion: city.metadata.algorithmVersion,
    observationSchemaVersion: city.metadata.observationSchemaVersion,
    policyVersion: city.metadata.policyVersion,
    fixtureVerified: fixture.matches,
    counts: {
      demandItems: city.snapshots.reduce((n, s) => n + s.newDemand, 0),
      initialAssets: fixture.matches ? fixture.world.initialAssets.length : null,
      mockInputRows: fixture.matches ? fixture.world.demands.length + fixture.world.initialAssets.length : null,
      events: city.events.length, weeklySnapshots: city.snapshots.length,
      forecastEvaluationRows: city.forecastEvaluation.records.length,
      comparisonDemandItems: city.summary.demandItems, comparisonDueItems: city.summary.due,
    },
    countDefinition: 'mockInputRows = 外生需求条目 + 初始物品条目；输出事件和周快照另计，不混算样本数。需求条目不是已验证的独立真实居民。',
    fixtureNote: fixture.matches ? '按运行配置重建的合成世界与运行指纹一致。' : '运行使用自定义世界或版本不匹配；无法从配置确认初始物品数，相关计数显示为空。',
    fieldCatalog: FIELD_CATALOG,
    windows: city.metadata.windows,
    currency: city.metadata.currency, moneyUnit: city.metadata.moneyUnit,
  };
}

export function describeCity(city) {
  return descriptor(city, reconstruct(city));
}

// Lifecycle edges join successive emitted events for the same case, preserving
// ledger order (including same-tick events). They are not causal/geographic flows.
export function buildResearchView(city) {
  const fixture = reconstruct(city);
  const categoryByCase = new Map(fixture.matches ? fixture.world.demands.map(d => [d.id, d.category]) : []);
  const categoryByAsset = new Map(fixture.matches ? fixture.world.initialAssets.map(a => [a.id, a.category]) : []);
  for (const e of city.events) if (e.category) {
    if (e.caseId) categoryByCase.set(e.caseId, e.category);
    if (e.assetId) categoryByAsset.set(e.assetId, e.category);
  }
  const categoryIds = [...Object.keys(CATEGORIES), 'unknown'];
  const emptyCategory = category => ({ category, arrivals: 0, handovers: 0, usedHandovers: 0, newHandovers: 0, commitments: 0, payouts: 0, pickups: 0, selfListings: 0, outsideScopeExits: 0, events: 0 });
  const weekly = city.snapshots.map(s => ({ ...s, categories: categoryIds.map(emptyCategory), eventCounts: {} }));
  if (fixture.matches) for (const d of fixture.world.demands) {
    const row = weekly[d.tick]?.categories.find(c => c.category === d.category);
    if (row) row.arrivals++;
  }
  const edges = new Map(), previousByCase = new Map();
  const increments = { CommitmentConfirmed: 'commitments', GuaranteedPayoutCompleted: 'payouts', PickupCompleted: 'pickups', SelfSaleListed: 'selfListings', ExitOutsideServiceScope: 'outsideScopeExits' };
  for (const event of city.events) {
    const week = weekly[event.tick];
    if (!week) continue;
    const category = event.category || categoryByCase.get(event.caseId) || categoryByAsset.get(event.assetId) || 'unknown';
    const row = week.categories.find(c => c.category === category) || week.categories.at(-1);
    row.events++;
    week.eventCounts[event.type] = (week.eventCounts[event.type] || 0) + 1;
    if (increments[event.type]) row[increments[event.type]]++;
    if (event.type === 'HandoverConfirmed') { row.handovers++; row[event.used ? 'usedHandovers' : 'newHandovers']++; }
    if (!event.caseId) continue;
    const previous = previousByCase.get(event.caseId);
    if (previous) {
      const key = JSON.stringify([previous.type, event.type, category]);
      if (!edges.has(key)) edges.set(key, { source: previous.type, target: event.type, category, count: 0, byWeek: {}, exampleEventIds: [previous.eventId, event.eventId] });
      const edge = edges.get(key); edge.count++;
      edge.byWeek[event.tick] = (edge.byWeek[event.tick] || 0) + 1;
    }
    previousByCase.set(event.caseId, event);
  }
  const categories = categoryIds.map(category => {
    const result = { ...emptyCategory(category), label: CATEGORIES[category]?.name || '未关联品类' };
    for (const w of weekly) for (const [key, value] of Object.entries(w.categories.find(c => c.category === category))) if (key !== 'category') result[key] += value;
    if (!fixture.matches) result.arrivals = null;
    return result;
  });
  if (!fixture.matches) for (const w of weekly) for (const c of w.categories) c.arrivals = null;
  return {
    version: RESEARCH_VIEW_VERSION,
    dataset: descriptor(city, fixture), parameters: PARAMETER_DEFINITIONS,
    config: { ...city.config }, fixedPolicy: { ...POLICY_V2 },
    categories, weekly, flowEdges: [...edges.values()],
    flowDefinition: '同一 caseId 的相邻账本事件，按实际发出顺序连接；边的周数取后一个事件发生周。不是跨居民资产转移数，不是物理位置或因果关系。签约在交付事件之前发出。',
    timeDefinition: 'tick 为 0 起始；界面显示第 tick+1 周。每周数据为整个运行的观测结果；默认指标的比较窗口排除前 12 周。',
    geography: { modeled: false, note: '当前模型没有行政区、距离或运输路线；城市视图展示时间、品类与事件生命周期。' },
    feedbackPhases: DATA_FEEDBACK_PHASES,
  };
}
