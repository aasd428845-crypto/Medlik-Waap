/**
 * BD-04 LIVE WIRING.
 *
 * Thin adapter between the real `bonus_settings` store (the director's Accounting
 * Policy Control Center) and the PURE BD-04 engine in
 * bonusOrderDiscountAccountingPolicy.ts. Mirrors bonusWithdrawalAccountingPolicyLive.ts
 * (BD-02) / bonusRedemptionAccountingPolicyLive.ts (BD-03) so all three policies share
 * one wiring shape — the architectural reference the directive asks for (do NOT re-
 * implement BD-01/BD-02/BD-03).
 *
 * Reuses BD-01's abstractions directly:
 *   - defaultBonusEarnDeps() : the shared { readSetting, upsertSetting } settings
 *     contract over `bonus_settings` (the same table BD-01/BD-02/BD-03 read/write).
 *   - readCurrentCompanyId() : the best-effort C-3 single-company resolver
 *     (`financial_companies order by created_at limit 1`, 0009:57), re-emitted
 *     as a COMPANY_POLICY_ISOLATION_GAP diagnostic because `orders` and
 *     `bonus_ledger` have NO `company_id` (0002:126-140; 0018:53-75; Phase-49 §1.4 /
 *     ACC-10) while the GL side IS company-scoped (0006:126/154).
 *
 * No PRODUCTION writes beyond the per-discount policy snapshot (a single
 * `bonus_settings` upsert) — identical surface to BD-01/BD-02/BD-03. No
 * `financial_journal_*` / `create_financial_journal_entry` /
 * `post_financial_journal_entry` writes are issued here. BD-04 stays fail-closed
 * today: A is a realisable intent with `journalEntryId: null` (the existing invoice
 * trigger posts the net 1130/4000 at 0009:108-138, NOT this engine), and B is blocked by
 * the missing discount-contra account (ACCOUNT_MAPPING_REQUIRED), so no journal is ever
 * produced by this wiring.
 */

import { defaultBonusEarnDeps, readCurrentCompanyId } from './bonusAccountingPolicyLive';
import { applyOrderDiscountAccounting } from './bonusOrderDiscountAccountingPolicy';
import type {
  OrderDiscountDeps,
  DiscountAccountingContext,
  OrderDiscountDecision,
} from './bonusOrderDiscountAccountingPolicy';

/** Shared DB-backed settings deps (reused from BD-01's settings contract). */
export function defaultOrderDiscountDeps(): OrderDiscountDeps {
  return defaultBonusEarnDeps();
}

/**
 * Run the PURE BD-04 engine against the real `bonus_settings` store. Resolves the
 * current financial company only when the caller did not supply one (C-3
 * single-company assumption; the ACC-10 gap is still reported by the engine rather than
 * silently papered over).
 */
export async function applyOrderDiscountAccountingLive(
  ctx: DiscountAccountingContext,
): Promise<OrderDiscountDecision> {
  const deps = defaultOrderDiscountDeps();
  const resolvedCompany = ctx.companyId ?? (await readCurrentCompanyId());
  return applyOrderDiscountAccounting(
    { ...ctx, companyId: resolvedCompany ?? ctx.companyId ?? null },
    deps,
  );
}
