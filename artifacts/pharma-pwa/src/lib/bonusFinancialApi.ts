import { supabase } from '@/lib/supabaseClient';

// Financial Bonus (bonus_ledger / bonus_accounts / bonus_rules_v2) as stored
// in Supabase (snake_case). This module is intentionally separate from
// bonusRulesApi.ts, which serves the legacy Buy-X-Free-Y model
// (public.bonus_rules + order_items.bonus_rule_id). The two models must
// never share components that mix their semantics.

export type LedgerTxnType =
  | 'EARN'
  | 'REDEEM_PRODUCT'
  | 'ORDER_DISCOUNT'
  | 'CASH_WITHDRAWAL'
  | 'REFUND'
  | 'REVERSAL'
  | 'ADJUSTMENT'
  | 'EXPIRATION'
  | 'OPENING_BALANCE'
  | 'LEGACY_MIGRATION';

export type LedgerStatus = 'POSTED' | 'PENDING';

export interface LedgerRow {
  id: string;
  account_id: string;
  txn_type: LedgerTxnType | string;
  amount: number;
  status: LedgerStatus | string;
  order_id: string | null;
  withdrawal_id: string | null;
  redemption_id: string | null;
  reverses_id: string | null;
  rule_id: string | null;
  actor: string | null;
  reference: string | null;
  notes: string | null;
  created_at: string;
}

export type RuleType = 'PRODUCT' | 'MONETARY' | 'GENERAL';
export type ValueBasis = 'PER_ORDER' | 'PER_UNIT' | 'PER_PRODUCT';
export type RuleStatus = 'active' | 'suspended' | 'archived';

export interface BonusRuleV2Row {
  id: string;
  name: string;
  description: string | null;
  rule_type: RuleType | string;
  status: RuleStatus | string;
  start_date: string | null;
  end_date: string | null;
  min_order_value: number | null;
  min_quantity: number | null;
  bonus_value: number | null;
  bonus_percent: number | null;
  max_earn: number | null;
  eligible_customers: string[] | null;
  customer_type: string | null;
  governorate: string | null;
  products_include: string[] | null;
  products_exclude: string[] | null;
  is_stackable: boolean;
  priority: number;
  usage_limit: number | null;
  allow_product: boolean;
  allow_discount: boolean;
  allow_cash: boolean;
  cash_min: number | null;
  cash_max: number | null;
  cash_monthly_limit: number | null;
  approval_required: boolean;
  created_at: string;
}

export interface BonusRuleV2Input {
  name: string;
  description?: string | null;
  rule_type: RuleType;
  status?: RuleStatus;
  start_date?: string | null;
  end_date?: string | null;
  min_order_value?: number | null;
  min_quantity?: number | null;
  bonus_value?: number | null;
  bonus_percent?: number | null;
  max_earn?: number | null;
  eligible_customers?: string[] | null;
  customer_type?: string | null;
  governorate?: string | null;
  products_include?: string[] | null;
  products_exclude?: string[] | null;
  is_stackable?: boolean;
  priority?: number;
  usage_limit?: number | null;
  allow_product?: boolean;
  allow_discount?: boolean;
  allow_cash?: boolean;
  cash_min?: number | null;
  cash_max?: number | null;
  cash_monthly_limit?: number | null;
  approval_required?: boolean;
  product_values?: Record<string, number> | null;
  /** Derived in the form (PER_PRODUCT when a per-product map exists, PER_UNIT when driven by quantity, else PER_ORDER). Mirrors the DB default. */
  value_basis?: 'PER_ORDER' | 'PER_UNIT' | 'PER_PRODUCT';
}

// ── Reads ──────────────────────────────────────────────────────────────────
export async function listLedger(limit = 100): Promise<LedgerRow[]> {
  const { data, error } = await supabase
    .from('bonus_ledger')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as LedgerRow[];
}

export async function listBonusAccounts(): Promise<{ user_id: string; mode: string; status: string }[]> {
  const { data, error } = await supabase
    .from('bonus_accounts')
    .select('user_id, mode, status')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as { user_id: string; mode: string; status: string }[];
}

export async function getAccountFunds(
  userId: string,
): Promise<{ available: number; reserved: number }> {
  const { data, error } = await supabase.rpc('bonus_account_funds', {
    p_user_id: userId,
  });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as {
    available?: number;
    reserved?: number;
  } | null;
  return {
    available: Number(row?.available ?? 0),
    reserved: Number(row?.reserved ?? 0),
  };
}

export async function listBonusRulesV2(): Promise<BonusRuleV2Row[]> {
  const { data, error } = await supabase
    .from('bonus_rules_v2')
    .select('*')
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as BonusRuleV2Row[];
}

export async function getBonusRuleV2(id: string): Promise<BonusRuleV2Row | null> {
  const { data, error } = await supabase
    .from('bonus_rules_v2')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as unknown as BonusRuleV2Row | null;
}

// ── Writes (director-only; enforced by RLS + DB validation trigger) ───────
function toDbPayload(input: BonusRuleV2Input): Record<string, unknown> {
  return {
    name: input.name.trim(),
    description: input.description?.trim() || null,
    rule_type: input.rule_type,
    status: input.status ?? 'active',
    start_date: input.start_date || null,
    end_date: input.end_date || null,
    min_order_value: input.min_order_value ?? null,
    min_quantity: input.min_quantity ?? null,
    bonus_value: input.bonus_value ?? null,
    bonus_percent: input.bonus_percent ?? null,
    max_earn: input.max_earn ?? null,
    eligible_customers:
      input.eligible_customers && input.eligible_customers.length > 0
        ? input.eligible_customers
        : null,
    customer_type: input.customer_type?.trim() || null,
    governorate: input.governorate?.trim() || null,
    products_include:
      input.products_include && input.products_include.length > 0
        ? input.products_include
        : null,
    products_exclude:
      input.products_exclude && input.products_exclude.length > 0
        ? input.products_exclude
        : null,
    is_stackable: input.is_stackable ?? false,
    priority: input.priority ?? 0,
    usage_limit: input.usage_limit ?? null,
    allow_product: input.allow_product ?? true,
    allow_discount: input.allow_discount ?? false,
    allow_cash: input.allow_cash ?? false,
    cash_min: input.cash_min ?? null,
    cash_max: input.cash_max ?? null,
    cash_monthly_limit: input.cash_monthly_limit ?? null,
    approval_required: input.approval_required ?? true,
    product_values: input.product_values ?? null,
    ...(input.value_basis ? { value_basis: input.value_basis } : {}),
  };
}

export async function createBonusRuleV2(input: BonusRuleV2Input): Promise<BonusRuleV2Row> {
  const { data, error } = await supabase
    .from('bonus_rules_v2')
    .insert(toDbPayload(input))
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as unknown as BonusRuleV2Row;
}

export async function updateBonusRuleV2(id: string, input: BonusRuleV2Input): Promise<void> {
  const { error } = await supabase
    .from('bonus_rules_v2')
    .update(toDbPayload(input))
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function setBonusRuleV2Status(id: string, status: RuleStatus): Promise<void> {
  const { error } = await supabase.from('bonus_rules_v2').update({ status }).eq('id', id);
  if (error) throw new Error(error.message);
}

// ── Director financial operations (RPC-backed, security definer) ───────────
export async function earnBonus(input: {
  userId: string;
  amount: number;
  ruleId?: string | null;
  reference?: string | null;
  reason?: string | null;
  idempotencyKey?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc('earn_bonus', {
    p_user_id: input.userId,
    p_amount: input.amount,
    p_rule_id: input.ruleId ?? null,
    p_reference: input.reference ?? null,
    p_reason: input.reason ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function reverseBonusTxn(input: {
  ledgerId: string;
  reason: string;
  idempotencyKey?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc('reverse_bonus_txn', {
    p_ledger_id: input.ledgerId,
    p_reason: input.reason,
    p_idempotency_key: input.idempotencyKey ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function expireBonus(asOf?: string): Promise<number> {
  // Omit the key entirely when no date is given so the DB default
  // (current_date) applies — passing explicit null would override it.
  const params =
    asOf && asOf.trim() !== '' ? { p_asof: asOf } : ({} as Record<string, never>);
  const { data, error } = await supabase.rpc('expire_bonus', params);
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

// ── Redemptions (director lifecycle; statuses enforced server-side) ───────
export type RedemptionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'FULFILLED' | 'CANCELLED';

export interface RedemptionRow {
  id: string;
  account_id: string;
  product_id: string;
  product_name?: string | null;
  quantity: number;
  bonus_value: number;
  status: RedemptionStatus | string;
  ledger_id: string | null;
  requested_by: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  created_at: string;
}

export async function listRedemptions(): Promise<RedemptionRow[]> {
  const { data, error } = await supabase
    .from('bonus_redemptions')
    .select('*, products(name)')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    account_id: r.account_id as string,
    product_id: r.product_id as string,
    product_name: (r.products as { name?: string } | null)?.name ?? null,
    quantity: Number(r.quantity ?? 0),
    bonus_value: Number(r.bonus_value ?? 0),
    status: r.status as string,
    ledger_id: (r.ledger_id as string) ?? null,
    requested_by: (r.requested_by as string) ?? null,
    decided_by: (r.decided_by as string) ?? null,
    decided_at: (r.decided_at as string) ?? null,
    decision_reason: (r.decision_reason as string) ?? null,
    created_at: r.created_at as string,
  }));
}

async function callRedemptionRpc(fn: string, id: string): Promise<void> {
  const { error } = await supabase.rpc(fn, { p_redemption_id: id });
  if (error) throw new Error(error.message);
}

export const approveRedemption = (id: string) => callRedemptionRpc('approve_redemption', id);
export const fulfillRedemption = (id: string) => callRedemptionRpc('fulfill_redemption', id);
export const cancelRedemption = (id: string) => callRedemptionRpc('cancel_redemption', id);

// ── Withdrawals (director lifecycle; statuses enforced server-side) ───────
export type WithdrawalStatus =
  | 'PENDING'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'PAID'
  | 'COMPLETED'
  | 'CANCELLED';

export interface WithdrawalRow {
  id: string;
  account_id: string;
  amount: number;
  status: WithdrawalStatus | string;
  requested_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  paid_by: string | null;
  paid_at: string | null;
  payment_method: string | null;
  payment_reference: string | null;
  receipt_url: string | null;
  notes: string | null;
  rejection_reason: string | null;
  ledger_id: string | null;
  created_at: string;
}

export async function listWithdrawals(): Promise<WithdrawalRow[]> {
  const { data, error } = await supabase
    .from('bonus_withdrawals')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    account_id: r.account_id as string,
    amount: Number(r.amount ?? 0),
    status: r.status as string,
    requested_at: r.requested_at as string,
    reviewed_by: (r.reviewed_by as string) ?? null,
    reviewed_at: (r.reviewed_at as string) ?? null,
    approved_by: (r.approved_by as string) ?? null,
    approved_at: (r.approved_at as string) ?? null,
    paid_by: (r.paid_by as string) ?? null,
    paid_at: (r.paid_at as string) ?? null,
    payment_method: (r.payment_method as string) ?? null,
    payment_reference: (r.payment_reference as string) ?? null,
    receipt_url: (r.receipt_url as string) ?? null,
    notes: (r.notes as string) ?? null,
    rejection_reason: (r.rejection_reason as string) ?? null,
    ledger_id: (r.ledger_id as string) ?? null,
    created_at: r.created_at as string,
  }));
}

async function callWithdrawalRpc(fn: string, id: string, extra: Record<string, unknown> = {}): Promise<void> {
  const { error } = await supabase.rpc(fn, { p_withdrawal_id: id, ...extra });
  if (error) throw new Error(error.message);
}

export const startWithdrawalReview = (id: string) =>
  callWithdrawalRpc('start_withdrawal_review', id);
export const approveWithdrawal = (id: string) =>
  callWithdrawalRpc('review_withdrawal', id, { p_approve: true });
export const rejectWithdrawal = (id: string, reason: string) =>
  callWithdrawalRpc('review_withdrawal', id, { p_approve: false, p_reason: reason });
export const markWithdrawalPaid = (id: string, reference: string, receiptUrl?: string | null) =>
  callWithdrawalRpc('mark_withdrawal_paid', id, {
    p_reference: reference,
    p_receipt_url: receiptUrl ?? null,
  });
export const completeWithdrawal = (id: string) => callWithdrawalRpc('complete_withdrawal', id);
export const cancelWithdrawal = (id: string) => callWithdrawalRpc('cancel_withdrawal', id);

// ── Pending entitlements (read + director processing) ─────────────────────
export type PendingStatus = 'PENDING' | 'PROCESSED' | 'FAILED';

export interface PendingRow {
  id: string;
  order_id: string;
  account_id: string;
  rule_id: string | null;
  value_basis: string | null;
  computed_value: number | null;
  product_snapshot: unknown;
  rule_snapshot: unknown;
  idempotency_key: string | null;
  status: PendingStatus | string;
  error_reason: string | null;
  attempts: number;
  processed_at: string | null;
  ledger_id: string | null;
  created_at: string;
}

export async function listPending(): Promise<PendingRow[]> {
  const { data, error } = await supabase
    .from('bonus_pending_entitlements')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    order_id: r.order_id as string,
    account_id: r.account_id as string,
    rule_id: (r.rule_id as string) ?? null,
    value_basis: (r.value_basis as string) ?? null,
    computed_value: r.computed_value != null ? Number(r.computed_value) : null,
    product_snapshot: r.product_snapshot ?? null,
    rule_snapshot: r.rule_snapshot ?? null,
    idempotency_key: (r.idempotency_key as string) ?? null,
    status: r.status as string,
    error_reason: (r.error_reason as string) ?? null,
    attempts: Number(r.attempts ?? 0),
    processed_at: (r.processed_at as string) ?? null,
    ledger_id: (r.ledger_id as string) ?? null,
    created_at: r.created_at as string,
  }));
}

export async function processPending(id: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('bonus_process_pending', {
    p_pending_id: id,
  });
  if (error) throw new Error(error.message);
  return (data as string) ?? null;
}

// ── Audit trail (read-only; append-only by design) ─────────────────────────
export interface AuditRow {
  id: string;
  entity: string;
  entity_id: string | null;
  action: string;
  actor: string | null;
  at_time: string;
  old_value: unknown;
  new_value: unknown;
  reason: string | null;
  reference: string | null;
}

export async function listAudit(limit = 200): Promise<AuditRow[]> {
  const { data, error } = await supabase
    .from('bonus_audit_trail')
    .select('*')
    .order('at_time', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    entity: r.entity as string,
    entity_id: (r.entity_id as string) ?? null,
    action: r.action as string,
    actor: (r.actor as string) ?? null,
    at_time: r.at_time as string,
    old_value: r.old_value ?? null,
    new_value: r.new_value ?? null,
    reason: (r.reason as string) ?? null,
    reference: (r.reference as string) ?? null,
  }));
}

// ── Settings (director-managed key/value; only existing keys) ─────────────
export interface SettingRow {
  key: string;
  value: unknown;
  updated_at: string;
}

export async function listSettings(): Promise<SettingRow[]> {
  const { data, error } = await supabase
    .from('bonus_settings')
    .select('key, value, updated_at')
    .order('key', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    key: r.key as string,
    value: r.value ?? null,
    updated_at: r.updated_at as string,
  }));
}

export async function updateSetting(key: string, value: unknown): Promise<void> {
  const { error } = await supabase.from('bonus_settings').update({ value }).eq('key', key);
  if (error) throw new Error(error.message);
}
