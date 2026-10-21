/**
 * BD-03 LIVE WIRING.
 *
 * Thin adapter between the real `bonus_settings` store (the director's Accounting
 * Policy Control Center) and the PURE BD-03 engine in
 * bonusRedemptionAccountingPolicy.ts. Mirrors bonusWithdrawalAccountingPolicyLive.ts
 * (BD-02) so the three policies share one wiring shape — the architectural reference
 * the directive asks for (do NOT re-implement BD-01/BD-02).
 *
 * Reuses BD-01's abstractions directly:
 *   - defaultBonusEarnDeps() : the shared { readSetting, upsertSetting } settings
 *     contract over `bonus_settings` (same table both policies read/write).
 *   - readCurrentCompanyId() : the best-effort C-3 single-company resolver
 *     (`financial_companies order by created_at limit 1`, 0009:57), re-emitted
 *     as a COMPANY_POLICY_ISOLATION_GAP diagnostic because `bonus_redemptions`
 *     has NO company_id (PHASE-49 §1.4 / ACC-10).
 *
 * No PRODUCTION writes beyond the per-redemption policy snapshot (a single
 * `bonus_settings` upsert) — identical surface to BD-01/BD-02. No
 * `financial_journal_*` / `create_financial_journal_entry` /
 * `post_financial_journal_entry` writes are issued here (BD-03 stays fail-closed
 * today: all of A/B/C hit a valuation-basis gap, so no journal is ever produced).
 */

import { defaultBonusEarnDeps, readCurrentCompanyId } from './bonusAccountingPolicyLive';
import { applyBonusRedemptionAccounting } from './bonusRedemptionAccountingPolicy';
import type {
  RedemptionDeps,
  RedemptionAccountingContext,
  BonusRedemptionDecision,
} from './bonusRedemptionAccountingPolicy';

/** Shared DB-backed settings deps (reused from BD-01's settings contract). */
export function defaultRedemptionDeps(): RedemptionDeps {
  return defaultBonusEarnDeps();
}

/**
 * Run the PURE BD-03 engine against the real `bonus_settings` store. Resolves the
 * current financial company only when the caller did not supply one (C-3
 * single-company assumption; ACC-10 gap still reported by the engine).
 */
export async function applyBonusRedemptionAccountingLive(
  ctx: RedemptionAccountingContext,
): Promise<BonusRedemptionDecision> {
  const deps = defaultRedemptionDeps();
  const resolvedCompany = ctx.companyId ?? (await readCurrentCompanyId());
  return applyBonusRedemptionAccounting(
    { ...ctx, companyId: resolvedCompany ?? ctx.companyId ?? null },
    deps,
  );
}
