/**
 * BD-02 LIVE WIRING.
 *
 * Thin adapter between the real `bonus_settings` store (the director's
 * Accounting Policy Control Center) and the PURE BD-02 engine in
 * bonusWithdrawalAccountingPolicy.ts. Mirrors bonusAccountingPolicyLive.ts
 * (BD-01) so the two policies share one wiring shape.
 *
 * Reuses BD-01's abstractions directly — this is the architectural reference
 * the directive asks for (do NOT re-implement BD-01 except where depended on):
 *   - defaultBonusEarnDeps() : the shared { readSetting, upsertSetting } settings
 *     contract over `bonus_settings` (same table both policies read/write).
 *   - readCurrentCompanyId() : the best-effort C-3 single-company resolver
 *     (`financial_companies order by created_at limit 1`, 0009:57), re-emitted
 *     as a COMPANY_POLICY_ISOLATION_GAP diagnostic because `bonus_withdrawals`
 *     has NO company_id (PHASE-49 §1.4 / ACC-10).
 *
 * No PRODUCTION writes beyond the per-withdrawal policy snapshot (a single
 * `bonus_settings` upsert) — identical surface to BD-01. No
 * `financial_journal_*` / `create_financial_journal_entry` /
 * `post_financial_journal_entry` writes are issued here.
 */

import { defaultBonusEarnDeps, readCurrentCompanyId } from './bonusAccountingPolicyLive';
import { applyBonusWithdrawalAccounting } from './bonusWithdrawalAccountingPolicy';
import type {
  WithdrawalDeps,
  WithdrawalAccountingContext,
  BonusWithdrawalDecision,
} from './bonusWithdrawalAccountingPolicy';

/** Shared DB-backed settings deps (reused from BD-01's settings contract). */
export function defaultWithdrawalDeps(): WithdrawalDeps {
  return defaultBonusEarnDeps();
}

/**
 * Run the PURE BD-02 engine against the real `bonus_settings` store. Resolves
 * the current company only when the caller did not supply one (C-3
 * single-company assumption; ACC-10 gap still reported by the engine).
 */
export async function applyBonusWithdrawalAccountingLive(
  ctx: WithdrawalAccountingContext,
): Promise<BonusWithdrawalDecision> {
  const deps = defaultWithdrawalDeps();
  const resolvedCompany = ctx.companyId ?? (await readCurrentCompanyId());
  return applyBonusWithdrawalAccounting(
    { ...ctx, companyId: resolvedCompany ?? ctx.companyId ?? null },
    deps,
  );
}
