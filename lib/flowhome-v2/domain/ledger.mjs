/** Event-sourced accounting helpers. Every amount is an integer number of fen. */
export const requiredReserveMinor = (pricing) => pricing.guaranteeMinor + pricing.inspectionMinor;

export function entry({ eventId, kind, debit, credit, amountMinor, memo, actorId }) {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) throw new Error('INVALID_LEDGER_AMOUNT');
  return Object.freeze({ eventId, kind, debit, credit, amountMinor, currency: 'CNY', memo, actorId: actorId ?? null });
}

export function cashBalance(entries, initialCashMinor) {
  return entries.reduce((cash, e) => {
    if (e.debit === 'platform_cash') return cash + e.amountMinor;
    if (e.credit === 'platform_cash') return cash - e.amountMinor;
    return cash;
  }, initialCashMinor);
}

export function reservedBalance(entries) {
  return entries.reduce((reserved, e) => {
    if (e.kind === 'reserve_hold') return reserved + e.amountMinor;
    if (e.kind === 'reserve_release') return reserved - e.amountMinor;
    return reserved;
  }, 0);
}

export function consumerPaid(entries, actual = true) {
  const account = actual ? 'consumer_paid_actual' : 'consumer_paid_expected';
  return entries.reduce((sum, e) => (e.credit === account ? sum + e.amountMinor : sum), 0);
}

export function inventoryBook(entries) {
  return entries.reduce((book, e) => {
    if (e.kind === 'inventory_acquired') return book + e.amountMinor;
    if (e.kind === 'inventory_disposed') return book - e.amountMinor;
    return book;
  }, 0);
}

export function balances(entries, initialCashMinor) {
  const cashMinor = cashBalance(entries, initialCashMinor);
  const reservedMinor = reservedBalance(entries);
  const inventoryBookMinor = inventoryBook(entries);
  return Object.freeze({
    cashMinor, reservedMinor, availableCashMinor: cashMinor - reservedMinor,
    consumerPaidActualMinor: consumerPaid(entries, true),
    consumerPaidExpectedMinor: consumerPaid(entries, false), inventoryBookMinor,
    resultMinor: entries.reduce((sum,e) => sum + (['exit_fee_received','resale_received','coordination_received','delivery_received'].includes(e.kind) ? e.amountMinor : ['inspection_paid','delivery_paid','inventory_disposed'].includes(e.kind) ? -e.amountMinor : 0),0),
  });
}

export function assertBalancedState(state) {
  const computed = balances(state.ledgerEntries, state.config.initialCashMinor);
  for (const key of Object.keys(computed)) if (computed[key] !== state.balances[key]) throw new Error(`LEDGER_MISMATCH:${key}`);
  if (state.config.initialCashMinor + computed.resultMinor - computed.inventoryBookMinor !== computed.cashMinor) throw new Error('CASH_RESULT_INVENTORY_BRIDGE');
  if (computed.availableCashMinor < 0) throw new Error('NEGATIVE_AVAILABLE_CASH');
  if (computed.inventoryBookMinor < 0) throw new Error('NEGATIVE_INVENTORY');
  if (computed.reservedMinor < 0) throw new Error('NEGATIVE_RESERVE');
  return computed;
}
