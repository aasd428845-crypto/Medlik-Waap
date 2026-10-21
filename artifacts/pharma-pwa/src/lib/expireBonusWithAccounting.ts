/**
 * BD-06 — DORMANT E2 SEAM: `expireBonusWithAccounting`.
 *
 * Mirrors the dormant seams `createOrderInvoiceWithAccounting.ts` (E8) and
 * `removeOrderItemWithAccounting.ts` (E10): it calls the REAL event RPC and then
 * runs the accounting engine at the event boundary.
 *
 * Event boundary (verified, 0018:1413-1485):
 *   `public.expire_bonus(p_asof date)` selects aged, unconsumed POSTED `EARN`
 *   lots (no existing EXPIRATION row), computes `bonus_credit_remaining`, and
 *   inserts ONE `EXPIRATION` row per expiring lot:
 *     - txn_type    = 'EXPIRATION'
 *     - amount      = -v_rem        (negative debit = extinguished remainder, 0018:1470)
 *     - status      = 'POSTED'      (0018:1470)
 *     - reverses_id = v_row.id      (the original EARN lot id — the source link, 0018:1471)
 *     - idempotency_key = NULL      (dedup is by reverses_id, 0018:1468)
 *     idempotent via ON CONFLICT (reverses_id) DO NOTHING (0018:1472-1474) +
 *     `bonus_ledger_reverses_uniq` (0018:171-173).
 *   `expire_bonus` returns the COUNT of expirations, not their ledger ids — so this
 *   seam looks the row up from bonus_ledger.
 *
 * TRUE event identity = the EXPIRATION row's `bonus_ledger.id` (the row just
 * inserted), NOT account_id / order_id / customer_id. The original EARN lot id is
 * the `reverses_id` REFERENCE (source-trace), never the snapshot key.
 *
 * BD-06 vs BD-07: BD-06 writes `txn_type='EXPIRATION'` via `expire_bonus`;
 * BD-07 REVERSAL writes `txn_type='REVERSAL'` via `reverse_bonus_txn`. Same
 * reverses_id backbone, DIFFERENT event/polonym semantics — this seam handles
 * EXPIRATION only (directive item 5).
 *
 * DORMANT: not imported by any screen. The accounting engine is fail-closed and
 * never writes a journal (`journalEntryId` stays null), so importing this seam has
 * no production accounting side-effect.
 *
 * ── Production Safety ─────────────────────────────────────────────────────────
 * The engine never calls `create_financial_journal_entry` /
 * `post_financial_journal_entry`; `journalEntryId` is null on every code path.
 * `expire_bonus` itself is idempotent at the DB level (ON CONFLICT), and the
 * BD-06 policy snapshot is written once per EXPIRATION row, so re-invocation
 * cannot double-post or double-snapshot.
 */

import { supabase } from '@/lib/supabaseClient';
import { applyBonusExpirationAccountingLive } from './bonusExpirationAccountingPolicyLive.ts';
import type { ExpirationDecision } from './bonusExpirationAccountingPolicy.ts';

export interface ExpireBonusResult {
  expirationLedgerId: string | null;
  originalEarnLedgerId: string | null;
  expiredAmount: number;
  accounting: ExpirationDecision;
}

export interface ExpireBonusInput {
  /** `p_asof` for `expire_bonus` (the expiry run's as-of date, 0018:1414). */
  p_asof: string;
  /**
   * Original EARN lot `bonus_ledger.id` to expire / look up. When supplied (and no
   * `expirationLedgerId`), the seam calls `expire_bonus(p_asof)` and resolves the
   * EXPIRATION row whose `reverses_id` = this lot.
   */
  originalEarnLedgerId?: string;
  /**
   * When the caller already holds the EXPIRATION row id, pass it directly to skip
   * the RPC + lookup (the TRUE BD-06 event identity; used as snapshot key).
   */
  expirationLedgerId?: string;
  /** Best-effort current financial company (C-3 single-company assumption). */
  companyId?: string | null;
}

/** Row shape fetched for the EXPIRATION event. */
interface ExpirationLedgerRow {
  id: string;
  account_id: string | null;
  order_id: string | null;
  amount: number | string | null;
  status: string | null;
  reverses_id: string | null;
}

/**
 * Run the expiry RPC, resolve the resulting EXPIRATION row's TRUE identity, and
 * dispatch the BD-06 accounting policy over it at status 'POSTED'.
 *
 * Dormant seam — not wired into any screen.
 */
export async function expireBonusWithAccounting(
  input: ExpireBonusInput,
): Promise<ExpireBonusResult> {
  const { p_asof, originalEarnLedgerId, expirationLedgerId, companyId } = input;

  // (1) Ensure the expiry run executed for this as-of window. `expire_bonus` is
  //     director-only + idempotent (ON CONFLICT / bonus_ledger_reverses_uniq), so
  //     re-running for a lot already expired is a safe no-op at the DB level.
  await supabase.rpc('expire_bonus', { p_asof });

  // (2) Resolve the EXPIRATION row — the TRUE BD-06 event identity.
  let expirationLedgerIdResolved: string | null = expirationLedgerId ?? null;
  let originalEarn: string | null = expirationLedgerId
    ? null
    : (originalEarnLedgerId ?? null);
  let expiredAmount = 0;
  let accountId: string | null = null;
  let orderId: string | null = null;
  let resolvedStatus: string = 'POSTED';

  if (!expirationLedgerIdResolved) {
    if (!originalEarn) {
      // No lot supplied and none resolvable: no expiration event for this call.
      return {
        expirationLedgerId: null,
        originalEarnLedgerId: null,
        expiredAmount: 0,
        accounting: await applyBonusExpirationAccountingLive({
          // no_entry path: the engine still records the BD-06 option/policy gap
          // but has no event identity to snapshot against.
          identity: {
            ledgerId: `earnedlot:${originalEarnLedgerId ?? 'unknown'}`,
            originalLedgerId: originalEarnLedgerId ?? 'unknown',
          },
          status: 'POSTED',
          companyId,
        }),
      };
    }
    // Look up the EXPIRATION row written for this EARN lot (reverses_id link, 0018:1471).
    const { data, error } = await supabase
      .from('bonus_ledger')
      .select('id,account_id,order_id,amount,status,reverses_id')
      .eq('reverses_id', originalEarn)
      .eq('txn_type', 'EXPIRATION')
      .eq('status', 'POSTED')
      .order('created_at', { ascending: false })
      .limit(1)
      .single<ExpirationLedgerRow>();

    if (error || !data) {
      // Lot fully consumed/expired-already (remainder was 0 → no EXPIRATION row,
      // 0018:1460-1461) or nothing aged: BD-06 has no event to account for.
      return {
        expirationLedgerId: null,
        originalEarnLedgerId: originalEarn,
        expiredAmount: 0,
        accounting: await applyBonusExpirationAccountingLive({
          identity: {
            ledgerId: `earnedlot:${originalEarn}`,
            originalLedgerId: originalEarn,
          },
          status: 'POSTED',
          companyId,
        }),
      };
    }

    expirationLedgerIdResolved = data.id;
    expiredAmount = Math.abs(Number(data.amount)) || 0;
    accountId = data.account_id ?? null;
    orderId = data.order_id ?? null;
    originalEarn = data.reverses_id ?? originalEarn;
    resolvedStatus = data.status ?? 'POSTED';
  } else {
    // Caller supplied the EXPIRATION row id: fetch the original lot via reverses_id
    // for the source-trace (0018:1471).
    const { data, error } = await supabase
      .from('bonus_ledger')
      .select('id,account_id,order_id,amount,status,reverses_id')
      .eq('id', expirationLedgerId)
      .eq('txn_type', 'EXPIRATION')
      .eq('status', 'POSTED')
      .single<ExpirationLedgerRow>();

    if (error || !data) {
      return {
        expirationLedgerId: expirationLedgerIdResolved,
        originalEarnLedgerId: null,
        expiredAmount: 0,
        accounting: await applyBonusExpirationAccountingLive({
          identity: {
            ledgerId: expirationLedgerIdResolved,
            originalLedgerId: `unknown:${expirationLedgerIdResolved}`,
          },
          status: 'POSTED',
          companyId,
        }),
      };
    }

    originalEarn = data.reverses_id ?? null;
    expiredAmount = Math.abs(Number(data.amount)) || 0;
    accountId = data.account_id ?? null;
    orderId = data.order_id ?? null;
    resolvedStatus = data.status ?? 'POSTED';
  }

  // (3) Dispatch BD-06 at the EXPIRATION event boundary. The EXPIRATION row's
  //     status is always POSTED (the lookups filter on it, 0018:1470).
  //     journalEntryId is NULL on every path — no journal is ever fabricated.
  const accounting = await applyBonusExpirationAccountingLive({
    identity: {
      ledgerId: expirationLedgerIdResolved ?? `earnedlot:${originalEarn ?? 'unknown'}`,
      originalLedgerId: originalEarn ?? `unknown:${expirationLedgerIdResolved ?? 'unknown'}`,
      orderId,
      accountId,
      // EXPIRATION rows insert idempotency_key = NULL (0018:1468); not carried.
      idempotencyKey: null,
    },
    status: resolvedStatus,
    companyId,
    expiredAmount,
  });

  return {
    expirationLedgerId: expirationLedgerIdResolved,
    originalEarnLedgerId: originalEarn,
    expiredAmount,
    accounting,
  };
}
