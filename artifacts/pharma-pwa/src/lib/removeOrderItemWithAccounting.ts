/**
 * BD-05 ORDER-ITEM-REMOVAL E2 SEAM.
 *
 * Additive integration point that layers the BD-05 policy engine on top of the existing
 * `modify_order_item(..., 'remove', ...)` RPC (0026). Mirrors
 * `createOrderInvoiceWithAccounting.ts` (BD-04), `fulfillRedemptionWithAccounting.ts`
 * (BD-03) and `markWithdrawalWithAccounting.ts` (BD-02) — same wiring shape, so this
 * function is DORMANT and is not imported by any screen, meaning there is NO behaviour
 * change to the existing item-removal path.
 *
 * Event boundary (BD-08 NOT consulted): BD-05 fires at the REFUND event — the moment
 * `modify_order_item` inserts the `txn_type='REFUND'` row into `bonus_ledger`
 * (0026:103-109, E10). E7 (apply_order_discount) and the invoice (E8) carry no BD-05
 * effect; cancellation (BD-07) is a separate, explicit REVERSAL and is not BD-05.
 *
 * Why this is safe today:
 *   - `modify_order_item` is unchanged; we only call it and then ask the BD-05 engine
 *     what accounting treatment is in force for the resulting REFUND.
 *   - The engine is fail-closed for BD-05: Option A is `would_post` intent blocked on
 *     ACCOUNT_MAPPING_REQUIRED (missing 2xxx bonus-liability account) +
 *     REVERSAL_LINKAGE_GAP (0026 sets no reverses_id); Option B is fail_closed
 *     INVOICE_REPRICING_REQUIRED (0026 does not reprice the posted invoice, and no
 *     invoice-repricing journal path exists). Either way NO journal is produced by this
 *     seam and NO `financial_*` table is touched (`journalEntryId: null` always).
 *   - Idempotency is structural on two levels:
 *       * `modify_order_item` is itself idempotent (0026:22-23 idempotency key
 *         `MOD:{order}:{item}`; the audit_trail already-processed guard at 0026:67-72
 *         short-circuits replays to a deterministic 'already_processed' result).
 *       * BD-05's per-refund snapshot (`accounting_policy.snapshot.<refundLedgerId>`)
 *         makes a re-run a no-op for the policy decision (no second snapshot, no second
 *         journal path).
 *     Two journals can never be produced for one refund.
 *
 * TRUE event identity = the `bonus_ledger.id` of the REFUND row (txn_type='REFUND',
 * created by modify_order_item when v_refund>0, 0026:103-109) — NOT orders.id, and NOT
 * the original ORDER_DISCOUNT's ledger.id. The original ORDER_DISCOUNT ledger.id is
 * carried only as a REFERENCE (for source-trace and BD-04 policy lookup); BD-05's
 * snapshot is keyed on the REFUND row, so the original discount's BD-04 snapshot is
 * never modified (directive item 5).
 *
 * NOTE: `bonusFinancialApi.ts` exposes no wrapper for `modify_order_item`, so the
 * removal RPC is invoked directly via `supabase.rpc` (the refund row is then read via
 * bonus_ledger directly, mirroring how BD-04's seam reads bonus_ledger for the
 * ORDER_DISCOUNT row).
 */

import { supabase } from './supabaseClient';
import { applyOrderRefundAccountingLive } from './bonusRefundAccountingPolicyLive';
import type {
  RefundIdentity,
  RefundAccountingContext,
  RefundDecision,
} from './bonusRefundAccountingPolicy';

export interface RemoveOrderItemWithAccountingInput {
  /** `orders.id` whose item is being removed. */
  orderId: string;
  /** `order_items.id` to remove. */
  orderItemId: string;
  /** Forwarded to modify_order_item (defaults to a deterministic key if omitted). */
  p_idempotency_key?: string | null;
  /** Caller-supplied; otherwise best-effort C-3 resolution is used. */
  companyId?: string | null;
  /** Optional pre-known REFUND bonus_ledger.id + amount (if the caller already has them). */
  ledgerId?: string | null;
  refundAmount?: number | null;
  /** Optional pre-known original ORDER_DISCOUNT bonus_ledger.id (reference for source-trace). */
  originalLedgerId?: string | null;
  idempotencyKey?: string | null;
}

export interface RemoveOrderItemWithAccountingResult {
  orderId: string;
  orderItemId: string;
  /** Amount actually refunded (v_refund from 0026); 0 when 0026 created no REFUND row. */
  refundAmount: number;
  /** The BD-05 accounting decision for the REFUND (or a no_entry when there was none). */
  accounting: RefundDecision;
}

/** No-arg placeholder so the module carries an explicit type surface even if the
 *  refund is zero and the engine is never dispatched. */
function noRefundDecision(reason: string): RefundDecision {
  return {
    option: null,
    effect: { kind: 'no_entry', reason },
    journalEntryId: null,
    effectKey: 'bd05:refund:none',
    alreadyHadPolicySnapshot: false,
    diagnostics: [],
    sourceTrace: {
      sourceTable: 'bonus_ledger',
      sourceId: 'none',
      documentType: 'bonus_refund',
      orderId: null,
      ledgerId: 'none',
      originalLedgerId: null,
      idempotencyKey: null,
    },
  };
}

/**
 * 1. Capture the REFUND bonus_ledger row (its true bonus_ledger.id + amount +
 *    idempotency_key) and the original ORDER_DISCOUNT ledger.id (reference), if the
 *    caller did not supply them.
 * 2. Call the director removal RPC `modify_order_item(remove, ...)` (idempotent at the
 *    audit_trail level, 0026:22-23 + 67-72). It returns { status, refund_amount,
 *    idempotency_key, … } (0026:117-127).
 *    - If the server says 'already_processed' OR refund_amount == 0, no NEW REFUND row
 *      is being created → we look up the existing REFUND row (by idempotency_key) so the
 *      policy decision is still recorded deterministically; if none exists, the refund
 *      is a no_entry.
 * 3. Resolve BD-05 live + dispatch (fail-closed: A → would_post / ACCOUNT_MAPPING_REQUIRED
 *    + REVERSAL_LINKAGE_GAP; B → fail_closed / INVOICE_REPRICING_REQUIRED — no journal
 *    fabricated by this engine).
 */
export async function removeOrderItemWithAccounting(
  input: RemoveOrderItemWithAccountingInput,
): Promise<RemoveOrderItemWithAccountingResult> {
  const idempotencyKey =
    input.p_idempotency_key ??
    input.idempotencyKey ??
    `MOD:${input.orderId}:${input.orderItemId}`;

  // The E10 removal RPC (branch_manager-gated, 0026). Idempotent replay returns
  // { status:'already_processed', … } and the SAME refund_amount/idempotency_key.
  const { data: rpcData, error: rpcError } = await supabase.rpc('modify_order_item', {
    p_order_id: input.orderId,
    p_order_item_id: input.orderItemId,
    p_operation: 'remove',
    p_idempotency_key: idempotencyKey,
  });
  if (rpcError) throw new Error(rpcError.message);

  const res = rpcData as
    | {
        status?: string;
        refund_amount?: unknown;
        idempotency_key?: string | null;
        order_id?: string | null;
      }
    | null;

  const refundAmount = Number(res?.refund_amount ?? input.refundAmount ?? 0) || 0;

  // 0026 only creates a REFUND row when v_refund > 0 (0026:103-109). Zero refund ⇒
  // no REFUND event ⇒ no BD-05 accounting event to dispatch.
  if (refundAmount <= 0) {
    // Deterministic: even on the already_processed replay of a zero-refund removal,
    // the outcome is a no_entry, never a fabricated journal.
    return {
      orderId: input.orderId,
      orderItemId: input.orderItemId,
      refundAmount: 0,
      accounting: noRefundDecision(
        'modify_order_item produced no excess discount (v_refund = v_discount - v_new_discount <= 0); no REFUND bonus_ledger row was created, so there is no BD-05 event.',
      ),
    };
  }

  // Resolve the TRUE event identity (the REFUND bonus_ledger.id) + original ORDER_DISCOUNT
  // ledger.id (reference), if the caller did not supply them.
  let ledgerId: string | null = input.ledgerId ?? null;
  let originalLedgerId: string | null = input.originalLedgerId ?? null;
  if (!ledgerId || !originalLedgerId) {
    // REFUND row: latest REFUND for this order carrying the same idempotency key.
    const refundQ = supabase
      .from('bonus_ledger')
      .select('id,amount,order_id')
      .eq('idempotency_key', idempotencyKey)
      .eq('txn_type', 'REFUND')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    if (!ledgerId) {
      const { data, error } = await refundQ;
      if (error) throw new Error(error.message);
      const row = data as { id?: string; amount?: unknown } | null;
      if (!row) {
        throw new Error(
          `Order ${input.orderId} removal reported a refund (${refundAmount}) but no REFUND bonus_ledger row exists — inconsistent state.`,
        );
      }
      ledgerId = row.id ?? null;
    }
    // Original ORDER_DISCOUNT ledger.id: latest POSTED ORDER_DISCOUNT on the order
    // (same selection 0026 uses at 0026:80-82), as the reference for source-trace.
    if (!originalLedgerId) {
      const { data, error } = await supabase
        .from('bonus_ledger')
        .select('id')
        .eq('order_id', input.orderId)
        .eq('txn_type', 'ORDER_DISCOUNT')
        .eq('status', 'POSTED')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      if (error) throw new Error(error.message);
      originalLedgerId = (data as { id?: string } | null)?.id ?? null;
    }
  }

  // TRUE event identity = the REFUND row (not orders.id); original ORDER_DISCOUNT is a
  // reference, not the identity key.
  const identity: RefundIdentity = {
    ledgerId: ledgerId as string,
    originalLedgerId,
    orderId: input.orderId,
    idempotencyKey,
  };

  const ctx: RefundAccountingContext = {
    identity,
    status: 'POSTED', // E10: the REFUND row (bonus_ledger) was just created.
    companyId: input.companyId ?? null,
    refundAmount,
  };

  const accounting = await applyOrderRefundAccountingLive(ctx);

  return {
    orderId: input.orderId,
    orderItemId: input.orderItemId,
    refundAmount,
    accounting,
  };
}
