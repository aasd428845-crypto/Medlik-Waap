/**
 * BD-01 engine — LIVE wiring (Supabase-backed).
 *
 * The pure resolver/dispatcher lives in `bonusAccountingPolicy.ts` (importable
 * anywhere, including tests). This module bridges it to the real
 * `bonus_settings` table so a director-earn (E2) flow can resolve the policy
 * the director selected in the Control Center at the moment the earn happens.
 *
 * Why a separate file: the pure engine is intentionally free of any Supabase
 * import so it stays unit-testable offline. The live wiring (and its Supabase
 * client initialisation) is isolated here.
 */

import { upsertSetting } from './bonusFinancialApi';
import type { BonusRole } from './bonusFinancialApi';
import { ROLE_ACCOUNT_MAP_EMBED } from './bonusRoleAccountMapQuery';
import { supabase } from './supabaseClient';
import type { BonusEarnDeps } from './bonusAccountingPolicy';
import { applyBonusEarnAccounting } from './bonusAccountingPolicy';
import type { EarnAccountingContext, BonusEarnDecision } from './bonusAccountingPolicy';

/**
 * Reads/writes `bonus_settings` directly via the director's `for all` RLS
 * policy (the same one AccountingSection uses for `accounting_policy.*`).
 *
 * - `readSetting` reads one key's jsonb `value` (returns null when absent —
 *   `.single()` on no rows raises the not-found code PGRST116, handled here).
 * - The snapshot key `accounting_policy.snapshot.<ledgerId>` is therefore
 *   stored and read through the EXISTING settings table + RLS — no new table,
 *   no migration, company-isolation gap unchanged (bonus_settings has none).
 */
export function defaultBonusEarnDeps(): BonusEarnDeps {
  return {
    readSetting: async (key: string) => {
      const { data, error } = await supabase
        .from('bonus_settings')
        .select('value')
        .eq('key', key)
        .single();
      if (error) {
        if (error.code === 'PGRST116') return null; // no row
        throw new Error(error.message);
      }
      return (data as { value?: unknown } | null)?.value ?? null;
    },
    upsertSetting: (key: string, value: unknown) => upsertSetting(key, value),
  };
}

/**
 * Best-effort, C-3 single-company resolution (`financial_companies
 * order by created_at limit 1`, 0009:57). Re-emitted to callers as a
 * COMPANY_POLICY_ISOLATION_GAP diagnostic, because `bonus_settings` is NOT
 * company-scoped (PHASE-49 §1.4). Shared by BD-01 and BD-02 live wiring.
 */
export async function readCurrentCompanyId(): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('financial_companies')
      .select('id')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();
    if (!error) return (data as { id?: string } | null)?.id ?? null;
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve the GL account a BD-01 role is designated to (0029 mapping table).
 * This is the client-side lens on the SAME table `apply_bonus_earn_accounting`
 * consults in SQL — kept here for readiness previews and the director's
 * "Post earn to GL" action. Returns null when the role is unmapped
 * (fail-closed: the caller keeps ACCOUNT_MAPPING_REQUIRED and the trigger
 * writes no PENDING link).
 */
export async function readAccountForRole(
  companyId: string,
  role: BonusRole,
): Promise<{ account_id: string; code: string; name: string } | null> {
  const { data, error } = await supabase
    .from('bonus_role_account_map')
    .select(`account_id, ${ROLE_ACCOUNT_MAP_EMBED}`)
    .eq('company_id', companyId)
    .eq('role', role)
    .eq('is_active', true)
    .single();
  if (error) {
    if (error.code === 'PGRST116') return null; // no active mapping — fail closed
    throw new Error(error.message);
  }
  const row = data as unknown as {
    account_id: string;
    financial_accounts: { code: string; name: string };
  } | null;
  if (!row) return null;
  return {
    account_id: row.account_id,
    code: row.financial_accounts?.code ?? '',
    name: row.financial_accounts?.name ?? '',
  };
}

/**
 * Resolve the journal-leg layout (debit_role / credit_role) for a specific
 * (process, option) from the 0029 `bonus_journal_leg_mapping` table. This is the
 * client-side lens on the SAME table `apply_bonus_earn_accounting` consults in
 * SQL — used for readiness previews and the director's Control Center layout
 * editor. Returns null when no layout is configured (fail-closed).
 */
export async function readJournalLegLayout(
  companyId: string,
  process: string,
  option: string,
): Promise<{ debit_role: string | null; credit_role: string | null } | null> {
  const { data, error } = await supabase.rpc('get_journal_leg_layout', {
    p_company_id: companyId,
    p_process: process,
    p_option: option,
  });
  if (error) {
    if (error.code === 'PGRST22') return null; // no rows — fail closed
    throw new Error(error.message);
  }
  if (!data || (Array.isArray(data) && data.length === 0)) return null;
  const row = (Array.isArray(data) ? data[0] : data) as {
    debit_role?: string | null;
    credit_role?: string | null;
  };
  return { debit_role: row.debit_role ?? null, credit_role: row.credit_role ?? null };
}

/**
 * DB-backed convenience: run the engine against real `bonus_settings`, reading
 * the current financial company via the C-3 single-company assumption
 * (`financial_companies order by created_at limit 1`, 0009:57). The company id
 * is then re-emitted as a `COMPANY_POLICY_ISOLATION_GAP` diagnostic because
 * `bonus_settings` is NOT company-scoped (PHASE-49 §1.4).
 */
export async function applyBonusEarnAccountingLive(
  ctx: EarnAccountingContext,
): Promise<BonusEarnDecision> {
  const deps = defaultBonusEarnDeps();
  const resolvedCompany = ctx.companyId ?? (await readCurrentCompanyId());
  return applyBonusEarnAccounting(
    { ...ctx, companyId: resolvedCompany ?? ctx.companyId ?? null },
    deps,
  );
}
