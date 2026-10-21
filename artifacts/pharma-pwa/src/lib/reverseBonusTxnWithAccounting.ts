/**
 * BD-07 — DORMANT E2 SEAM: `reverseBonusTxnWithAccounting`.
 *
 * Mirrors the dormant seams `createOrderInvoiceWithAccounting.ts` (E8),
 * `expireBonusWithAccounting.ts` (E11/BD-06) and `removeOrderItemWithAccounting.ts`
 * (E10/BD-05): it drives the REAL event RPC and then runs the BD-07 accounting engine at
 * the event boundary.
 *
 * Event boundary (verified, 0018:1329-1406):
 *   `public.reverse_bonus_txn(p_ledger_id bigint, p_reason text,
 *   p_idempotency_key text default null) RETURNS uuid`
 *     - director-only, POSTED-only guard (0018:1351-1378);
 *     - caps the credit reversal at `bonus_credit_remaining` for the original
 *       (0018:1380-1390);
 *     - inserts ONE `REVERSAL` row with txn_type='REVERSAL', amount = -v_cap,
 *       status='POSTED', reverses_id = v_row.id (the ORIGINAL, 0018:1395), copying
 *       account_id/order_id/withdrawal_id/redemption_id/rule_id from the original
 *       (0018:1393-1399);
 *     - idempotent: early idempotency_key lookup (0018:1338-1343) returns the existing
 *       row, AND `bonus_ledger_reverses_uniq` (0018:168-173) enforces one REVERSAL per
 *       original;
 *     - RETURNS the new REVERSAL row's `bonus_ledger.id` (0018:1397-1399) — which IS the
 *       TRUE BD-07 event identity.
 *
 * TRUE identity = the REVERSAL row's bonus_ledger.id (the RPC return value), NOT
 * account_id / order_id / customer_id. The original event id is the `reverses_id`
 * REFERENCE (source-trace), never the snapshot key — so a reversal snapshot never collides
 * with the original event's own snapshot.
 *
 * BD-07 vs BD-05/BD-06 (directive item 5): this seam writes/reads txn_type='REVERSAL' only.
 * BD-06 EXPIRATION uses `expire_bonus`; BD-05 REFUND uses `modify_order_item('remove')`.
 * Same reverses_id backbone, DIFFERENT event semantics — this seam owns REVERSAL only.
 *
 * Why two events share reverses_id without confusion (directive item 4):
 *   - BD-07 REVERSAL always sets reverts_id = original (0018:1395) → SOURCE_TRACE present.
 *   - BD-05 REFUND writes NO reverts_id (0026 REFUND never has one) → REVERSAL_LINKAGE_GAP
 *     is inherent THERE (signalled by the BD-05 engine on every decision), NOT by BD-07.
 *   - BD-06 EXPIRATION writes reverts_id = original earn lot (0018:1471) → source-trace
 *     present, BD-06 ≠ BD-07.
 *
 * DORMANT: not imported by any screen. The engine is fail-closed and never writes a
 * journal (`journalEntryId` null on every path), so importing this seam has no
 * production accounting side-effect. `reverse_bonus_txn` itself is director-only +
 * idempotent, and the BD-07 snapshot is written once per REVERSAL row id — re-invocation
 * cannot double-post or double-snapshot.
 *
 * ── Production Safety ──────────────────────────────────────────────────────────
 * NEVER calls `create_financial_journal_entry` / `post_financial_journal_entry`.
 * Never touches `financial_accounts` / `gl_entry` / `journal_entry`.
 */

import { supabase } from '@/lib/supabaseClient';
import { applyBonusReversalAccountingLive } from './bonusReversalAccountingPolicyLive.ts';
import type {
  ReversalDecision,
  ReversalIdentity,
  ReversalAccountingContext,
} from './bonusReversalAccountingPolicy.ts';

/** The REVERSAL bonus_ledger row fetched from the sub-ledger (0018:50-114). */
interface ReversalLedgerRow {
  id: string;
  account_id: string | null;
  order_id: string | null;
  amount: number | string | null;
  status: string | null;
  reverses_id: string | null;
  idempotency_key: string | null;
}

export interface ReverseBonusTxnInput {
  /** The ORIGINAL bonus_ledger row id to reverse (p_ledger_id; must be POSTED, 0018:1351). */
  originalLedgerId: string;
  /** Non-blank reason required by reverse_bonus_txn (0018:1347-1348). */
  reason: string;
  /**
   * Forwarded to p_idempotency_key. E9 (automatic discount reversal, 0021:134) uses
   * 'REVERSAL:DISCOUNT:{order}'; E10 (director manual, 0018:1363-1368) may be null.
   */
  idempotencyKey?: string | null;
  /**
   * Pre-known REVERSAL row id (the TRUE BD-07 identity, returned by a prior reversal) to
   * skip the RPC + row lookup (used as the snapshot key).
   */
  reversalLedgerId?: string | null;
  /** Best-effort current financial company (C-3 single-company assumption). */
  companyId?: string | null;
}

export interface ReverseBonusTxnResult {
  /** The TRUE BD-07 event identity — the REVERSAL row's bonus_ledger.id (null if none created). */
  reversalLedgerId: string | null;
  /** The original event's bonus_ledger.id (the reverts_id reference, null if absent). */
  originalLedgerId: string | null;
  /** abs(REVERSAL.amount) — the compensated value (0018:1395: `-v_cap`). */
  reversalAmount: number;
  /** The BD-07 accounting decision for this reversal. */
  accounting: ReversalDecision;
}

/**
 * 1. Invoke the reversal RPC `reverse_bonus_txn(p_ledger_id, p_reason, p_idempotency_key)`
 *    (or reuse a caller-supplied REVERSAL row id), which RETURNS the new REVERSAL row id.
 * 2. Look up that REVERSAL row from `bonus_ledger` to anchor source-trace (reverses_id,
 *    order_id, account_id, idempotency_key, status, amount).
 * 3. Dispatch the BD-07 engine at the POSTED event boundary (the REVERSAL row's status is
 *    always POSTED, 0018:1395).
 *
 * Dormant seam — not wired into any screen.
 */
export async function reverseBonusTxnWithAccounting(
  input: ReverseBonusTxnInput,
): Promise<ReverseBonusTxnResult> {
  const { originalLedgerId, reason, idempotencyKey, reversalLedgerId: providedReversalId, companyId } =
    input;

  // (1) Resolve the TRUE BD-07 identity: the REVERSAL row's bonus_ledger.id returned by
  //     reverse_bonus_txn (0018:1397-1399). The RPC is director-only + idempotent
  //     (idempotency_key lookup 0018:1338-1343 + bonus_ledger_reverses_uniq 0018:168-173).
  let reversalLedgerIdResolved: string | null = providedReversalId ?? null;
  if (!reversalLedgerIdResolved) {
    const { data, error } = await supabase.rpc('reverse_bonus_txn', {
      p_ledger_id: originalLedgerId,
      p_reason: reason,
      p_idempotency_key: idempotencyKey ?? null,
    });
    if (error) throw new Error(error.message);
    reversalLedgerIdResolved = (data as string | null) ?? null;
  }

  // Graceful degradation: the RPC surfaced no reversal row (e.g. nil remaining credit
  // returned as NULL rather than raising) — still record the policy decision on a synthetic
  // identity; never fabricate a journal.
  if (!reversalLedgerIdResolved) {
    const identity: ReversalIdentity = {
      ledgerId: `original:${originalLedgerId}`,
      originalLedgerId: originalLedgerId ?? null,
      idempotencyKey: idempotencyKey ?? null,
    };
    const accounting = await applyBonusReversalAccountingLive({
      identity,
      status: 'POSTED',
      companyId,
      reversalAmount: 0,
    });
    return {
      reversalLedgerId: null,
      originalLedgerId: originalLedgerId ?? null,
      reversalAmount: 0,
      accounting,
    };
  }

  // (2) Anchor source-trace + reverts_id + amount on the actual REVERSAL row
  //     (always txn_type='REVERSAL', status='POSTED' — 0018:1394-1395).
  const { data: row, error: rowError } = await supabase
    .from('bonus_ledger')
    .select('id,account_id,order_id,amount,status,reverses_id,idempotency_key')
    .eq('id', reversalLedgerIdResolved)
    .eq('txn_type', 'REVERSAL')
    .eq('status', 'POSTED')
    .single<ReversalLedgerRow>();

  if (rowError || !row) {
    // Inconsistent state: reverse_bonus_txn returned an id for a row we cannot read.
    throw new Error(
      `BD-07: reverse_bonus_txn returned REVERSAL id ${reversalLedgerIdResolved} but the ` +
        `row was not found/readable (status POSTED, txn_type REVERSAL): ${rowError?.message ?? 'not found'}`,
    );
  }

  // reverses_id = the ORIGINAL event being reversed (0018:1395); fall back to the caller's
  // originalLedgerId if the row is malformed.
  const originalFromRow: string | null = row.reverses_id ?? originalLedgerId ?? null;
  const reversalAmount = Math.abs(Number(row.amount)) || 0;

  // (3) Dispatch BD-07 at the REVERSAL event boundary. journalEntryId is NULL on every
  //     path — the engine never fabricates a journal entry.
  const accounting = await applyBonusReversalAccountingLive({
    identity: {
      ledgerId: reversalLedgerIdResolved,
      originalLedgerId: originalFromRow,
      orderId: row.order_id ?? null,
      idempotencyKey: row.idempotency_key ?? idempotencyKey ?? null,
      accountId: row.account_id ?? null,
    },
    status: row.status ?? 'POSTED',
    companyId,
    reversalAmount,
  });

  return {
    reversalLedgerId: reversalLedgerIdResolved,
    originalLedgerId: originalFromRow,
    reversalAmount,
    accounting,
  };
}
