/**
 * BD-04 INVOICE-LEG E2 SEAM.
 *
 * Additive integration point that layers the BD-04 policy engine on top of the
 * existing `branch_allocate_order` RPC (0021:181-186), which is the E8 invoice-creation
 * boundary — the only place BD-04's "how is the invoice presented?" question is
 * consequential. Mirrors `fulfillRedemptionWithAccounting.ts` (BD-03) and
 * `markWithdrawalWithAccounting.ts` (BD-02), so the wiring shape is shared and this
 * function is DORMANT — it is not yet imported by any screen, so wiring it in is an
 * explicit, separately-authorized step and there is NO behaviour change to the existing
 * invoice path.
 *
 * Why this is safe today:
 *   - `branch_allocate_order` is unchanged; we only call it and then ask the BD-04
 *     engine what accounting treatment is in force for the order's discount.
 *   - The engine is fail-closed for BD-04:
 *       - Option A (net invoice) → `would_post` intent, 1130/4000 mapped,
 *         `journalEntryId: null` (the EXISTING invoice trigger already posts the net
 *         1130/4000 at 0009:108-138; this engine does NOT fabricate a journal).
 *       - Option B (gross + separate contra) → `would_post` intent with
 *         ACCOUNT_MAPPING_REQUIRED (the discount-contra account is absent — no 2xxx /
 *         Sales Discount / Contra-receivable in the seeded COA), `journalEntryId: null`.
 *     Either way NO journal is fabricated by this seam and NO `financial_*` table is
 *     touched.
 *   - Idempotency is structural: `apply_order_discount` enforces exactly one
 *     POSTED ORDER_DISCOUNT per order (0020:129-133) with a UNIQUE idempotency key
 *     `DISCOUNT:{order_id}` (0020:70-71; 0018:73), and the engine's per-discount
 *     snapshot (`accounting_policy.snapshot.<ledgerId>`) makes a re-run a no-op for
 *     the policy decision. Two journals can never be produced for one discount.
 *
 * TIMING BOUNDARY (BD-08 NOT consulted): the engine fires at INVOICE CREATION (E8) —
 * when `branch_allocate_order` inserts the netted `invoices` row (0021:345-349) and the
 * invoice trigger posts the net 1130/4000 entry (0009:108-138). The discount application
 * (`apply_order_discount`, E7) carries no BD-04 accounting effect. BD-04's TRUE event
 * identity is the ORDER_DISCOUNT `bonus_ledger.id` (the discount whose value is reflected
 * in the invoice), NOT `orders.id`.
 *
 * NOTE: `bonusFinancialApi.ts` exposes no wrapper for `branch_allocate_order`, so the
 * invoice RPC is invoked directly via `supabase.rpc` (the discount's ledger row is read
 * via `bonus_ledger` directly too, mirroring how `markWithdrawalWithAccounting` reads
 * `bonus_withdrawals` directly).
 */

import { supabase } from './supabaseClient';
import { applyOrderDiscountAccountingLive } from './bonusOrderDiscountAccountingPolicyLive';
import type {
  OrderDiscountIdentity,
  DiscountAccountingContext,
  OrderDiscountDecision,
} from './bonusOrderDiscountAccountingPolicy';

export interface CreateOrderInvoiceWithAccountingInput {
  /** `orders.id` whose allocation/invoice is being created (the E8 event owner). */
  orderId: string;
  /** Forwarded to `branch_allocate_order` (defaults to true). */
  p_issue_invoice?: boolean | null;
  /** Forwarded to `branch_allocate_order`. */
  p_expected_delivery_date?: string | null;
  /** Forwarded to `branch_allocate_order`. */
  p_allocations?: unknown;
  /** Caller-supplied; otherwise best-effort C-3 resolution is used. */
  companyId?: string | null;
  /**
   * Optional pre-known ORDER_DISCOUNT `bonus_ledger.id` + discount amount. If absent the
   * discount row is read from `bonus_ledger` (txn_type='ORDER_DISCOUNT', status='POSTED').
   */
  ledgerId?: string | null;
  discountAmount?: number | null;
}

export interface CreateOrderInvoiceWithAccountingResult {
  orderId: string;
  /** `invoices.id` returned by `branch_allocate_order` (null if no invoice issued). */
  invoiceId: string | null;
  accounting: OrderDiscountDecision;
}

/**
 * 1. Capture the ORDER_DISCOUNT `bonus_ledger.id` (the TRUE BD-04 event identity) + the
 *    effective discount amount for source-trace, if the caller did not supply them.
 * 2. Create the invoice at the E8 boundary via the existing `branch_allocate_order` RPC
 *    (server-side: nets the discount into the invoice total — 0021:313-337 — and the
 *    invoice trigger posts DR 1130 / CR 4000 on the net amount, 0009:108-138).
 * 3. Resolve BD-04 live + dispatch (fail-closed: A realisable-would_post intent, B
 *    ACCOUNT_MAPPING_REQUIRED — no journal fabricated by this engine).
 */
export async function createOrderInvoiceWithAccounting(
  input: CreateOrderInvoiceWithAccountingInput,
): Promise<CreateOrderInvoiceWithAccountingResult> {
  let ledgerId: string | null = input.ledgerId ?? null;
  let discountAmount: number | null = input.discountAmount ?? null;

  if (!ledgerId) {
    const { data, error } = await supabase
      .from('bonus_ledger')
      .select('id,amount')
      .eq('order_id', input.orderId)
      .eq('txn_type', 'ORDER_DISCOUNT')
      .eq('status', 'POSTED')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    if (error) throw new Error(error.message);
    const row = data as { id?: string; amount?: unknown } | null;
    if (!row) {
      throw new Error(
        `Order ${input.orderId} has no POSTED ORDER_DISCOUNT ledger row; nothing to invoice-discount.`,
      );
    }
    ledgerId = row.id ?? null;
    if (discountAmount == null && row.amount != null) {
      discountAmount = Math.abs(Number(row.amount));
    }
  }

  // The E8 invoice-creation RPC (branch_manager-gated, 0021:206-207).
  let invoiceId: string | null = null;
  if (input.p_issue_invoice ?? true) {
    const { data, error } = await supabase.rpc('branch_allocate_order', {
      p_order_id: input.orderId,
      p_issue_invoice: input.p_issue_invoice ?? true,
      p_expected_delivery_date: input.p_expected_delivery_date ?? null,
      p_allocations: input.p_allocations ?? null,
    });
    if (error) throw new Error(error.message);
    invoiceId = (data as string | null) ?? null;
  }

  // TRUE event identity = the ORDER_DISCOUNT ledger row (not orders.id).
  const identity: OrderDiscountIdentity = {
    ledgerId: ledgerId as string,
    orderId: input.orderId,
    // The discount-level idempotency key is `DISCOUNT:{order_id}` (0020:70-71); the
    // engine keys on ledgerId, so this is carried only for traceability.
    idempotencyKey: null,
  };

  const ctx: DiscountAccountingContext = {
    identity,
    status: 'POSTED', // E8: the invoice (and its net entry) is now created.
    companyId: input.companyId ?? null,
    discountAmount,
  };

  const accounting = await applyOrderDiscountAccountingLive(ctx);

  return {
    orderId: input.orderId,
    invoiceId,
    accounting,
  };
}
