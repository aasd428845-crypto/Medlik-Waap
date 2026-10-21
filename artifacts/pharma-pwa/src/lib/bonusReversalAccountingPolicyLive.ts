/**
 * BD-07 engine — LIVE wiring (Supabase-backed).
 *
 * Bridges the pure resolver/dispatcher (`bonusReversalAccountingPolicy.ts`) to the real
 * `bonus_settings` table so the director's BD-07 choice (`accounting_policy.BD-07`) is
 * read at REVERSAL time (the moment `reverse_bonus_txn` / E9 inserts the REVERSAL row).
 * The pure engine imports no Supabase; this module owns the client initialisation,
 * mirroring BD-01/BD-06.
 *
 * Reuses the BD-01 live helpers verbatim (`defaultBonusEarnDeps`, `readCurrentCompanyId`)
 * — the bonus sub-ledger (`bonus_ledger`, `bonus_settings`) has no `company_id`
 * (0018:50-114, 0018:80-86) — so the same C-3 single-company resolution
 * (`financial_companies order by created_at limit 1`, 0009) + ACC-10 isolation gap
 * applies unchanged. The policy read is global; the resolved company is re-emitted as a
 * `COMPANY_POLICY_ISOLATION_GAP` diagnostic rather than a silent cross-company fallback.
 *
 * DORMANT wiring surface: this is imported only by the dormant BD-07 seam
 * (`reverseBonusTxnWithAccounting.ts`), which itself is not imported by any screen, so
 * there is no behaviour change to the reversal path until a policy is deliberately wired.
 *
 * Why BD-07 ≠ BD-05 ≠ BD-06 (directive item 5): the deps are identical (same bonus
 * sub-ledger store); only the policy key + option set + dispatch differ, all isolated to
 * this file. BD-01..BD-06 are not modified.
 *
 * ── Production Safety ──────────────────────────────────────────────────────────
 * The engine never opens a journal path: `journalEntryId` is null on every code path
 * (BD-07 A is a would_post *intent* blocked on ACCOUNT_MAPPING_REQUIRED; B is no_entry).
 * No `create_financial_journal_entry` / `post_financial_journal_entry` is ever invoked.
 */

import { applyBonusReversalAccounting } from './bonusReversalAccountingPolicy.ts';
import {
  defaultBonusEarnDeps,
  readCurrentCompanyId,
} from './bonusAccountingPolicyLive.ts';
import type {
  ReversalDeps,
  ReversalAccountingContext,
  ReversalDecision,
} from './bonusReversalAccountingPolicy.ts';

/** BD-07 deps = the BD-01 bonus_settings read/write (no new table, no migration). */
export function defaultReversalDeps(): ReversalDeps {
  return defaultBonusEarnDeps();
}

/**
 * DB-backed convenience: run the BD-07 engine against real `bonus_settings`, resolving
 * the current financial company via the C-3 single-company assumption
 * (`financial_companies order by created_at limit 1`, 0009). The company id is re-emitted
 * as a `COMPANY_POLICY_ISOLATION_GAP` diagnostic because `bonus_settings` (and
 * `bonus_ledger`) carry NO `company_id` — ACC-10.
 */
export async function applyBonusReversalAccountingLive(
  ctx: ReversalAccountingContext,
): Promise<ReversalDecision> {
  const deps = defaultReversalDeps();
  const resolvedCompany = ctx.companyId ?? (await readCurrentCompanyId());
  return applyBonusReversalAccounting(
    { ...ctx, companyId: resolvedCompany ?? ctx.companyId ?? null },
    deps,
  );
}
