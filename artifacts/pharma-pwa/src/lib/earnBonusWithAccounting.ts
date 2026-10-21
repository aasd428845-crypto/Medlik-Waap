/**
 * BD-01 engine — E2 (director manual earn) composition seam.
 *
 * This is the documented integration point for the Accounting-Integration Step 1:
 * "every Bonus Earn must pass through: Bonus Earn Event → Resolve current BD-01
 * policy → A/B/C → Execute corresponding accounting behaviour". It composes the
 * EXISTING, dormant `earnBonus` RPC with the pure BD-01 engine.
 *
 * Behavioural neutrality (additive, no behaviour change):
 *   - `earnBonus` has NO UI caller today (verified: the only consumer is this
 *     seam), so wiring this seam into the E2 path alters no live behaviour.
 *   - The engine NEVER fabricates a journal entry: BD-01 A/B resolve to
 *     `would_post` with `ACCOUNT_MAPPING_REQUIRED` (no bonus GL account in the
 *     seeded COA, 0007:41-59) and BD-01 C resolves to `no_entry`. An
 *     unconfigured/invalid policy fails closed. Nothing here posts to a GL.
 *
 * Scope boundary (mirrors the Phase-1/Phase-2 constraints):
 *   - BD-02..BD-10 are NOT implemented; dispatch is BD-01 options only.
 *   - BD-08 timing is NOT consulted here (separate policy).
 *   - No migration, no new table, no production/migration/commit/push/deploy.
 *
 * The Supabase-bearing live wiring is isolated in `bonusAccountingPolicyLive.ts`
 * (company resolved C-3 best-effort, re-emitted as COMPANY_POLICY_ISOLATION_GAP).
 */

import { earnBonus } from './bonusFinancialApi';
import { applyBonusEarnAccountingLive } from './bonusAccountingPolicyLive';
import type {
  BonusEarnIdentity,
  EarnAccountingContext,
  EarnWithAccountingResult,
} from './bonusAccountingPolicy';

export interface EarnBonusWithAccountingInput {
  userId: string;
  amount: number;
  ruleId?: string | null;
  reference?: string | null;
  reason?: string | null;
  idempotencyKey?: string | null;
  /** Best-effort company scope (passed through; re-emitted as the ACC-10 gap). */
  companyId?: string | null;
}

export interface EarnBonusWithAccountingResult extends EarnWithAccountingResult {
  /** The idempotency key echoed back, for caller-side dedup (E1/E2 share it). */
  idempotencyKey: string | null;
}

/**
 * Run a director Bonus Earn (E2) through the BD-01 accounting-policy engine.
 *
 * 1. `earn_bonus` (0018:777) writes the immutable POSTED `bonus_ledger` row and
 *    returns its `id` (the earn itself is idempotent at the DB level via
 *    `idempotency_key` UNIQUE + `on conflict do nothing`, 0018:73-74).
 * 2. The engine resolves the CURRENT `accounting_policy.BD-01` choice, snapshots
 *    it to `accounting_policy.snapshot.<ledgerId>` (idempotent, history-safe),
 *    and dispatches A/B/C. No journal is created for BD-01 today.
 *
 * Returns the ledger identity PLUS the accounting decision. The decision is
 * `fail_closed` for unconfigured/invalid policy, `would_post` for A/B
 * (ACCOUNT_MAPPING_REQUIRED — never fabricated), and `no_entry` for C.
 */
export async function earnBonusWithAccounting(
  input: EarnBonusWithAccountingInput,
): Promise<EarnBonusWithAccountingResult> {
  const ledgerId = await earnBonus({
    userId: input.userId,
    amount: input.amount,
    ruleId: input.ruleId ?? null,
    reference: input.reference ?? null,
    reason: input.reason ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
  });

  // E2 is a director manual earn — there is no order event to tie orderId to.
  const identity: BonusEarnIdentity = {
    ledgerId,
    idempotencyKey: input.idempotencyKey ?? null,
  };

  const ctx: EarnAccountingContext = {
    identity,
    companyId: input.companyId ?? null,
    ruleId: input.ruleId ?? null,
    amount: input.amount,
  };

  const accounting = await applyBonusEarnAccountingLive(ctx);

  return {
    ledgerId,
    ledgerStatus: 'POSTED',
    accounting,
    idempotencyKey: input.idempotencyKey ?? null,
  };
}
