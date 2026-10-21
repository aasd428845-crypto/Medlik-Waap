/**
 * BD-05 LIVE WIRING.
 *
 * Thin adapter between the real `bonus_settings` store (the director's Accounting
 * Policy Control Center) and the PURE BD-05 engine in bonusRefundAccountingPolicy.ts.
 * Mirrors bonusOrderDiscountAccountingPolicyLive.ts (BD-04) — and through it
 * bonusWithdrawalAccountingPolicyLive.ts (BD-02) / bonusRedemptionAccountingPolicyLive.ts
 * (BD-03) / bonusAccountingPolicyLive.ts (BD-01) — so all five policies share one wiring
 * shape (directive item 19: do NOT re-implement the base).
 *
 * Reuses BD-01's abstractions directly:
 *   - defaultBonusEarnDeps() : the shared { readSetting, upsertSetting } settings
 *     contract over `bonus_settings` (the same table BD-01..BD-04 read/write), so the
 *     BD-05 accounting-policy snapshot writes through the EXISTING director-writable
 *     settings table + RLS — no new table, no migration.
 *   - readCurrentCompanyId() : the best-effort C-3 single-company resolver
 *     (`financial_companies order by created_at limit 1`, 0009:57), re-emitted
 *     as a COMPANY_POLICY_ISOLATION_GAP diagnostic because `bonus_settings` and
 *     `bonus_ledger` carry NO `company_id` (ACC-10 fault line — 0018:53-75).
 *
 * No PRODUCTION writes beyond the per-refund policy snapshot (a single
 * `bonus_settings` upsert) — identical surface to BD-01..BD-04. No
 * `financial_journal_*` / `create_financial_journal_entry` /
 * `post_financial_journal_entry` writes are issued here. BD-05 stays fail-closed
 * today: A is `would_post` intent blocked on ACCOUNT_MAPPING_REQUIRED (missing
 * bonus-liability account) + REVERSAL_LINKAGE_GAP, and B is fail_closed
 * INVOICE_REPRICING_REQUIRED — so no journal is ever produced by this wiring.
 */

import { defaultBonusEarnDeps, readCurrentCompanyId } from './bonusAccountingPolicyLive';
import { applyOrderRefundAccounting } from './bonusRefundAccountingPolicy';
import type {
  RefundDeps,
  RefundAccountingContext,
  RefundDecision,
} from './bonusRefundAccountingPolicy';

/** Shared DB-backed settings deps (reused from BD-01's settings contract). */
export function defaultRefundDeps(): RefundDeps {
  return defaultBonusEarnDeps();
}

/**
 * Run the PURE BD-05 engine against the real `bonus_settings` store. Resolves the
 * current financial company only when the caller did not supply one (C-3
 * single-company assumption; the ACC-10 gap is still reported by the engine rather than
 * silently papered over — bonus_ledger/orders/bonus_settings have no company_id, while
 * the GL side is company-scoped).
 */
export async function applyOrderRefundAccountingLive(
  ctx: RefundAccountingContext,
): Promise<RefundDecision> {
  const deps = defaultRefundDeps();
  const resolvedCompany = ctx.companyId ?? (await readCurrentCompanyId());
  return applyOrderRefundAccounting(
    { ...ctx, companyId: resolvedCompany ?? ctx.companyId ?? null },
    deps,
  );
}
