/**
 * BD-03 FULFILMENT-LEG E2 SEAM.
 *
 * Additive integration point that layers the BD-03 policy engine on top of the
 * existing `fulfill_redemption` RPC. Mirrors `markWithdrawalWithAccounting.ts`
 * (BD-02) and `earnBonusWithAccounting.ts` (BD-01), so the wiring shape is shared
 * and this function is DORMANT — it is not yet imported by any screen, so wiring it
 * in is an explicit, separately-authorized step and there is NO behaviour change to
 * the existing fulfilment path.
 *
 * Why this is safe today:
 *   - `fulfill_redemption` is unchanged; we only call it and then ask the engine what
 *     accounting treatment is in force.
 *   - The engine is fail-closed for BD-03 (A/B/C all hit a valuation-basis gap — ACC-03
 *     is not decided, PHASE-49 §13.1 D4 / DC-5), so it records a `would_post` with a
 *     gap code and `journalEntryId: null` — it does NOT create a journal and does NOT
 *     touch any `financial_*` table.
 *   - Idempotency is structural: `fulfill_redemption` flips exactly one PENDING ledger
 *     row to POSTED or aborts (0018:931-937), and the engine's per-redemption snapshot
 *     (`accounting_policy.snapshot.<redemptionId>`) makes a re-run a no-op for the
 *     policy decision. Two journals can never be produced for one redemption.
 *
 * TIMING BOUNDARY (BD-08 NOT consulted): the engine fires at FULFILMENT — when the
 * REDEEM_PRODUCT ledger row goes PENDING -> POSTED inside `fulfill_redemption`
 * (0018:908-948, 931-937). This is the E6 cost-recognition point (ACC-03). The request
 * (`request_redemption`) and the approval (`approve_redemption`) carry no accounting
 * effect (PHASE-49 §3.7 E5).
 *
 * TRUE event identity = `bonus_redemptions.id` (not assumed as `bonus_ledger.id`;
 * `ledger_id` is the subledger anchor used only for the future R-1 source-trace).
 */

import { fulfillRedemption } from './bonusFinancialApi';
import { supabase } from './supabaseClient';
import { applyBonusRedemptionAccountingLive } from './bonusRedemptionAccountingPolicyLive';
import type {
  RedemptionIdentity,
  RedemptionAccountingContext,
  BonusRedemptionDecision,
} from './bonusRedemptionAccountingPolicy';

export interface FulfillRedemptionWithAccountingInput {
  redemptionId: string;
  /** Caller-supplied; otherwise best-effort C-3 resolution is used. */
  companyId?: string | null;
  /** Optional pre-known values; if absent the redemption row is read for them. */
  ledgerId?: string | null;
  idempotencyKey?: string | null;
  amount?: number | null;
}

export interface FulfillRedemptionWithAccountingResult {
  redemptionId: string;
  accounting: BonusRedemptionDecision;
}

/**
 * 1) Capture the subledger anchor (`ledger_id` of the REDEEM_PRODUCT bonus_ledger row)
 *    plus the request-level context for source-trace, if the caller did not supply them.
 * 2) Call the director fulfilment RPC (server-side idempotent: exactly one PENDING ->
 *    POSTED flip, or it aborts — 0018:931-937).
 * 3) Resolve BD-03 live + dispatch (fail-closed for A/B/C — no journal today; ACC-03 not
 *    decided).
 */
export async function fulfillRedemptionWithAccounting(
  input: FulfillRedemptionWithAccountingInput,
): Promise<FulfillRedemptionWithAccountingResult> {
  let ledgerId: string | null = input.ledgerId ?? null;
  let amount: number | null = input.amount ?? null;
  let idempotencyKey: string | null = input.idempotencyKey ?? null;
  let productId: string | null = null;
  let quantity: number | null = null;

  if (!ledgerId || amount == null || idempotencyKey == null) {
    const { data, error } = await supabase
      .from('bonus_redemptions')
      .select('ledger_id,bonus_value,idempotency_key,product_id,quantity')
      .eq('id', input.redemptionId)
      .single();
    if (error) throw new Error(error.message);
    const row = data as
      | {
          ledger_id?: string | null;
          bonus_value?: unknown;
          idempotency_key?: string | null;
          product_id?: string | null;
          quantity?: unknown;
        }
      | null;
    if (ledgerId == null) ledgerId = row?.ledger_id ?? null;
    if (amount == null) amount = Number(row?.bonus_value ?? null);
    if (idempotencyKey == null) idempotencyKey = row?.idempotency_key ?? null;
    productId = row?.product_id ?? null;
    quantity = row?.quantity != null ? Number(row.quantity) : null;
  }

  // The director fulfilment RPC; idempotent at the ledger level (0018:931-937).
  await fulfillRedemption(input.redemptionId);

  // Identity anchored to the request id (the true event identity), with the ledger row
  // as the subledger source-trace target.
  const identity: RedemptionIdentity = {
    redemptionId: input.redemptionId,
    ledgerId,
    idempotencyKey,
    productId,
    quantity,
    bonusValue: amount,
  };

  const ctx: RedemptionAccountingContext = {
    identity,
    status: 'FULFILLED',
    companyId: input.companyId ?? null,
    amount,
  };

  const accounting = await applyBonusRedemptionAccountingLive(ctx);

  return {
    redemptionId: input.redemptionId,
    accounting,
  };
}
