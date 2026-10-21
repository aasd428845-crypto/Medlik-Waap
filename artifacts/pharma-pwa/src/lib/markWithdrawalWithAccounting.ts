/**
 * BD-02 PAYMENT-LEG E2 SEAM.
 *
 * Additive integration point that layers the BD-02 policy engine on top of the
 * existing (and possibly UI-wired) `markWithdrawalPaid` RPC. Mirrors
 * `earnBonusWithAccounting.ts` (BD-01), so the wiring shape is shared and the
 * new function is DORMANT — it is not yet imported by any screen, so wiring it
 * in is an explicit, separately-authorized step and there is NO behaviour
 * change to the existing payment path.
 *
 * Why this is safe today:
 *   - `markWithdrawalPaid` is unchanged; we only call it and then ask the
 *     engine what accounting treatment is in force.
 *   - The engine is fail-closed for BD-02 (A/B require accounts that are
 *     absent), so it records an `ACCOUNT_MAPPING_REQUIRED` decision WITHOUT
 *     creating a journal and WITHOUT touching any `financial_*` table.
 *   - Idempotency is structural: `mark_withdrawal_paid` flips exactly one
 *     PENDING ledger row to POSTED or aborts (`0018:1244-1291`), and the
 *     engine's per-withdrawal snapshot (`accounting_policy.snapshot.<id>`)
 *     makes a re-run a no-op for the policy decision. Two journals can never
 *     be produced for one withdrawal.
 *
 * Timing (BD-08 NOT consulted): the engine fires at the payment leg, i.e. when
 * the withdrawal ledger row goes PENDING -> POSTED inside `mark_withdrawal_paid`
 * (`0018:1244-1291`). The request (`request_withdrawal`) and the review
 * (`review_withdrawal`) carry no accounting effect.
 */

import { markWithdrawalPaid } from './bonusFinancialApi';
import { supabase } from './supabaseClient';
import { applyBonusWithdrawalAccountingLive } from './bonusWithdrawalAccountingPolicyLive';
import type {
  BonusWithdrawalDecision,
  WithdrawalAccountingContext,
} from './bonusWithdrawalAccountingPolicy';

export interface MarkWithdrawalWithAccountingInput {
  withdrawalId: string;
  reference: string;
  receiptUrl?: string | null;
  /** Caller-supplied; otherwise best-effort C-3 resolution is used. */
  companyId?: string | null;
  /** Optional pre-known values; if absent the withdrawal row is read for them. */
  amount?: number | null;
  ledgerId?: string | null;
}

export interface MarkWithdrawalWithAccountingResult {
  withdrawalId: string;
  paymentReference: string;
  accounting: BonusWithdrawalDecision;
}

/**
 * 1) Capture the subledger anchor (ledger_id of the CASH_WITHDRAWAL
 *    bonus_ledger row) for source-trace if the caller did not supply it.
 * 2) Call the director payment RPC (server-side idempotent: exactly one
 *    PENDING -> POSTED flip, or it aborts).
 * 3) Resolve BD-02 live + dispatch (fail-closed for A/B — no journal today).
 */
export async function markWithdrawalWithAccounting(
  input: MarkWithdrawalWithAccountingInput,
): Promise<MarkWithdrawalWithAccountingResult> {
  let ledgerId: string | null = input.ledgerId ?? null;
  let amount: number | null = input.amount ?? null;

  if (!ledgerId) {
    const { data, error } = await supabase
      .from('bonus_withdrawals')
      .select('ledger_id,amount')
      .eq('id', input.withdrawalId)
      .single();
    if (error) throw new Error(error.message);
    const row = data as { ledger_id?: string | null; amount?: unknown } | null;
    ledgerId = row?.ledger_id ?? null;
    if (amount == null) amount = Number(row?.amount ?? null);
  }

  // The director payment RPC; idempotent at the ledger level (`0018:1244-1291`).
  await markWithdrawalPaid(input.withdrawalId, input.reference, input.receiptUrl ?? null);

  const ctx: WithdrawalAccountingContext = {
    identity: { withdrawalId: input.withdrawalId, ledgerId, idempotencyKey: input.withdrawalId },
    status: 'PAID',
    companyId: input.companyId ?? null,
    amount,
  };
  const accounting = await applyBonusWithdrawalAccountingLive(ctx);

  return {
    withdrawalId: input.withdrawalId,
    paymentReference: input.reference,
    accounting,
  };
}
