/** Immutable policy snapshots. Amounts are CNY minor units (fen). */
export const DEFAULT_PRICING = Object.freeze({
  retailMinor: 114000,
  maintenanceMinor: 4000,
  guaranteeMinor: 41000,
  exitFeeMinor: 12000,
  inspectionMinor: 17000,
  coordinationMinor: 6500,
  deliveryMinor: 17000,
  resaleMinor: 62300,
});

export const CATEGORIES = new Set(['purifier', 'chair', 'mattress']);

export function assertIntegerMoney(value, field) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`INVALID_MONEY:${field}`);
}

export function normalizeConfig(config = {}) {
  const pricing = { ...DEFAULT_PRICING, ...(config.pricing ?? {}) };
  for (const [field, value] of Object.entries(pricing)) assertIntegerMoney(value, field);
  const durationMonths = config.durationMonths ?? 12;
  const budgetMinor = config.budgetMinor ?? 220000;
  const category = config.category ?? 'purifier';
  if (!Number.isInteger(durationMonths) || durationMonths < 3 || durationMonths > 18) throw new Error('INVALID_DURATION');
  if (!Number.isInteger(budgetMinor) || budgetMinor < 80000 || budgetMinor > 320000) throw new Error('INVALID_BUDGET');
  if (!CATEGORIES.has(category)) throw new Error('INVALID_CATEGORY');
  return Object.freeze({
    caseId: config.caseId ?? 'case-1', durationMonths, budgetMinor, category,
    initialCashMinor: config.initialCashMinor ?? 6000000,
    partnerId: config.partnerId ?? 'partner-alpha',
    partnerIds: Object.freeze(config.partnerIds ?? [config.partnerId ?? 'partner-alpha', 'partner-beta']), pricing,
    policy: Object.freeze({
      id: config.policy?.id ?? 'policy-v1',
      version: config.policy?.version ?? 1,
      hash: config.policy?.hash ?? 'flowhome-v2-demo-policy-v1',
      effectiveAtTick: config.policy?.effectiveAtTick ?? 0,
      guaranteeCategories: Object.freeze(config.policy?.guaranteeCategories ?? ['purifier', 'chair']),
    }),
  });
}

export function makePolicySnapshot(policy, tick = 0) {
  if (!policy || typeof policy !== 'object') throw new Error('INVALID_POLICY');
  const version = policy.version;
  if (!Number.isInteger(version) || version < 1) throw new Error('INVALID_POLICY_VERSION');
  const id = String(policy.id ?? `policy-v${version}`);
  const hash = String(policy.hash ?? `${id}-${version}`);
  return Object.freeze({ id, version, hash, effectiveAtTick: policy.effectiveAtTick ?? tick,
    guaranteeCategories: Object.freeze(policy.guaranteeCategories ?? ['purifier', 'chair']) });
}

export function makeQuote(config, quoteId = 'quote-1', candidateCommitmentId = 'commitment-1') {
  const { pricing, budgetMinor, category, durationMonths, policy } = config;
  if (!policy.guaranteeCategories.includes(category)) throw new Error('QUOTE_UNSUPPORTED_CATEGORY');
  if (pricing.retailMinor > budgetMinor) throw new Error('QUOTE_EXCEEDS_BUDGET');
  return Object.freeze({
    quoteId, candidateCommitmentId, schemaVersion: 1, status: 'OPEN',
    category, durationMonths, currency: 'CNY', expiresAtTick: 99,
    pricing: { ...pricing }, policyBundleRef: { ...policy },
    source: 'assumption',
  });
}

export function canReplaceQuote(state) {
  return !state.commitments.some((c) => c.status === 'CONFIRMED');
}
