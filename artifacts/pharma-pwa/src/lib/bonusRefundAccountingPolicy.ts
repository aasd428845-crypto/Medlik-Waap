/**
 * BD-05 BONUS REFUND (FROM ORDER-ITEM REMOVAL) — Dynamic, director-controlled accounting-policy engine.
 *
 * ⚠️ This is the FOURTH accounting-integration step and covers BD-05 (Bonus Refund from
 * order-item removal) ONLY. BD-06..BD-10 are explicitly NOT implemented here (directive
 * item 20); their option letters are NOT invented — BD-05 is registered as A/B (binary),
 * so only A and B exist.
 *
 * SCOPE (the precise boundary, verified NOT assumed — directive item 7):
 *   BD-05 governs the accounting treatment of the REFUND that `modify_order_item(remove)`
 *   creates in `bonus_ledger` (0026:103-109). That REFUND row is a bonus-SUBLEDGER event:
 *   it reinstates bonus to the customer's account (positive amount on the SAME account_id
 *   as the original ORDER_DISCOUNT, 0026:104-108) and writes NO `financial_*` / invoice
 *   object (0026:3-4). BD-05 decides how (and whether) that subledger refund is mirrored
 *   at the GL.
 *
 *   BD-05 is NOT a REVERSAL in the REVERSAL-row sense: 0026's refund row carries no
 *   `reverses_id` (it is a fresh `txn_type='REFUND'`), so it is a distinct event from the
 *   original ORDER_DISCOUNT. It is also NOT BD-07 (which reverses an accounting event via
 *   a `reverses_id`-linked compensating row — 0018:1395, 0021:134-138). BD-05 is the
 *   refund of a discount that arose from item removal, not the reversal of a prior
 *   accounting entry. (Directive item 15: keep BD-05 ≠ BD-07.)
 *
 * Relationship to the original ORDER_DISCOUNT (directive item 7 — inspected, not assumed):
 *   0026's refund math is taken VERBATIM:
 *     v_new_discount = least(v_discount, round(v_discount * v_new_total / v_old_total, 2))
 *     v_refund      = greatest(v_discount - v_new_discount, 0)
 *   so REFUND ≠ simply −ORDER_DISCOUNT; it is the EXCESS discount removed after
 *   proportional recalculation. The original discount amount, old/new totals, and the
 *   recalculated discount are carried as context only — the engine never recomputes them.
 *   The original ORDER_DISCOUNT's ledger.id is a REFERENCE (for source-trace / BD-04
 *   policy lookup), NOT BD-05's identity.
 *
 * CORE RULES (honored literally, same as BD-01/BD-02/BD-03/BD-04):
 *   - The policy is NEVER chosen by code. `accounting_policy.BD-05` is read LIVE at
 *     refund time and validated against BD-05's registered option set {A,B} (from
 *     `accountingPolicies.ts`). No `const BD05_POLICY = …`, no `policy ?? "A"`.
 *   - Missing policy -> ACCOUNTING_POLICY_NOT_CONFIGURED; invalid value ->
 *     POLICY_INVALID; both FAIL CLOSED (no journal fabricated).
 *   - A director change A->B affects ONLY subsequently-removed items; a refund's
 *     recorded policy is locked at refund time via a per-refund snapshot keyed on the
 *     REFUND's TRUE identity (bonus_ledger.id of the REFUND row). The original
 *     ORDER_DISCOUNT's BD-04 snapshot is NEVER modified by BD-05 (directive item 5).
 *
 * Why BD-05 cannot post today (honest, verified state — never assumed):
 *   - Option A (compensating mirror via reverses_id): intends to credit the
 *     bonus-liability reversal account (2xxx) and link the mirror to the original via
 *     reverses_id. The 2xxx bonus-liability account does NOT exist in the seeded COA
 *     (0007:42-54; Phase-49 §5.2 line 484 "No customer-bonus liability account exists"),
 *     and 0026's REFUND row sets NO reverses_id (0026:104-108). Both gaps -> A fails
 *     CLOSED on ACCOUNT_MAPPING_REQUIRED (+ REVERSAL_LINKAGE_GAP).
 *   - Option B (implicit repricing, no separate entry): intends to fold the refund into
 *     a repriced/cancelled invoice and write NO journal. But 0026 does NOT reprice the
 *     invoice (0026:3-4 "No accounting/GL objects" — it only updates orders.total_amount
 *     and writes the bonus subledger REFUND row), and no invoice-repricing journal path
 *     exists; the original BD-04=A net invoice is already posted by the trigger
 *     (0009:108-138). B therefore cannot be exercised -> fail CLOSED with
 *     INVOICE_REPRICING_REQUIRED.
 *   Either way NO journal is produced (`journalEntryId: null`), and the existing
 *   invoice trigger / invoice rows are untouched.
 *
 * PURE. Imports only `accountingPolicies.ts` (pure data) and the shared fail-closed
 * sentinels/class/deps from `bonusAccountingPolicy.ts` (BD-01). Never initialises Supabase.
 * Tested offline with an in-memory fake store (see bonusRefundAccountingPolicy.test.ts).
 *
 * Sources of truth (verified in-repo, not assumed):
 *  - accountingPolicies.ts -> BD-05 options {A,B} (Option A = mirror reversal via
 *    reverses_id; Option B = implicit repricing, no separate entry).
 *  - 0018_bonus_financial_system.sql:53-112: `bonus_ledger` (id PK; txn_type CHECK
 *    includes 'REFUND' & 'REVERSAL', 57-60; reverses_id nullable (68) — REVERSAL rows
 *    link to their original; idempotency_key UNIQUE (73); NO company_id — ACC-10 fault
 *    line; POSTED rows immutable (98-112)).
 *  - 0026_order_item_modification.sql:80-109: `modify_order_item('remove')` looks up the
 *    latest POSTED ORDER_DISCOUNT, deletes the item, and inserts a REFUND row
 *    (amount=v_refund>0, status='POSTED', order_id, account_id=discount's account,
 *    reference='MOD:{order_id}', idempotency_key='MOD:{order}:{item}', NO reverses_id).
 *  - 0009_financial_auto_posting.sql:106-138: the invoice trigger posts DR 1130/CR 4000
 *    on the net invoice (so a refund's GL mirror would adjust 1130/4000 + a 2xxx
 *    liability account) at E8.
 *  - 0006_financial_core.sql:140-150 + 0010:278-302: financial_documents.source_table/
 *    source_id (R-1) + create_financial_journal_entry/post_financial_journal_entry exist
 *    and are granted, but are NOT invoked here (no journal fabricated).
 *  - 0007_financial_setup_rls.sql:38-59: seeded COA. 1130 + 4000 exist (postable); NO
 *    bonus-liability / 2xxx / Sales-Discount / Contra-receivable account exists.
 *  - docs/opencode/PHASE-49: §3.8 E8/E9/E10 (255-264), §5.2 (440-486, incl. line 460/484
 *    "no customer-bonus liability account exists"), §6.3 (invoice->order traceability gap),
 *    ACC-06 (§10, 741), ACC-01 (§10), ACC-12 (§10/§12, 814), §13.1 (ACC-03 not decided),
 *    X2 (cost column missing), X3 (liability gap).
 *
 * TIMING (BD-08 NOT consulted): BD-05 affects at the REFUND event — when `modify_order_item`
 * inserts the REFUND row (0026:104-108, E10). The publish/posting cadence of any mirror
 * entry is the separate BD-08 question (undecided) -> TIMING_POLICY_REQUIRED.
 */

import { getPolicy } from './accountingPolicies.ts';

// ── Keys ───────────────────────────────────────────────────────────────────
/** Live director-chosen policy for Bonus Refund (BD-05). */
export const BD05_POLICY_KEY = 'accounting_policy.BD-05';
/**
 * Per-refund historical snapshot prefix, shared with BD-01/BD-02/BD-03/BD-04 snapshots
 * (suffix = the REFUND bonus_ledger.id — the TRUE BD-05 event identity). The shared
 * namespace is safe because every event's bonus_ledger.id is globally unique, so a
 * refund snapshot can never collide with a discount/earn/redemption snapshot. No new
 * table, no migration. This snapshot is keyed on the REFUND row, NEVER on the original
 * ORDER_DISCOUNT row (whose BD-04 snapshot is left untouched — directive item 5).
 */
export const BD05_SNAPSHOT_PREFIX = 'accounting_policy.snapshot.';

// ── Shared fail-closed sentinels (reused from BD-01; never re-defined) ─────
import {
  POLICY_NOT_CONFIGURED,
  POLICY_INVALID,
  ACCOUNT_MAPPING_REQUIRED,
  COMPANY_POLICY_ISOLATION_GAP,
  ACCOUNTING_NOT_POSTED,
  BONUS_GL_ATOMICITY_GAP,
  type BonusEarnDeps,
  PolicyResolutionError,
} from './bonusAccountingPolicy.ts';

// ── BD-05-specific gaps (additive; BD-01/BD-02/BD-03/BD-04 files untouched) ─
/**
 * BD-05 Option A (compensating mirror) requires linking the mirror entry to the original
 * discount's accounting record via `reverses_id` (registry A; 0018:68,171-173 for the
 * REVERSAL uniqueness contract). 0026's REFUND row sets NO reverses_id (0026:104-108), so
 * there is no durable linkage to the original ORDER_DISCOUNT to anchor a reversal to —
 * the engine flags it instead of fabricating one.
 */
export const REVERSAL_LINKAGE_GAP = 'REVERSAL_LINKAGE_GAP';
/**
 * BD-05 Option B (implicit repricing) needs the posted original invoice to be
 * repriced/cancelled in place. 0026 writes only a bonus subledger REFUND row + updates
 * orders.total_amount (0026:3-4, 101) — it does NOT touch `invoices` or fire any
 * invoice-repricing journal, and the original invoice is already posted by the trigger
 * (0009:108-138). No invoice-repricing GL journal path exists, so B cannot be exercised.
 */
export const INVOICE_REPRICING_REQUIRED = 'INVOICE_REPRICING_REQUIRED';
/**
 * BD-08 (publish/sweep timing) is a SEPARATE, un-decided policy. The BD-05 *event
 * boundary* is fixed by the lifecycle (the REFUND row at E10), but WHEN any mirror
 * entry is published/reconciled is not — so the engine records the boundary but
 * surfaces this rather than assuming a publish clock.
 *
 * Re-declared locally (identical string value BD-04 surfaces) so BD-05 stays a pure
 * module that imports only `accountingPolicies.ts` + the BD-01 base — the per-BD gap
 * pattern BD-03/BD-04 established (each engine owns its gap sentinels; the base is left
 * untouched so 0 tracked files are modified). The diagnostics contract is the STRING
 * value, which is shared canonically with BD-04.
 */
export const TIMING_POLICY_REQUIRED = 'TIMING_POLICY_REQUIRED';
/**
 * R-1 source-traceability gap: `invoices` has no `order_id` (Phase-49 §6.3), so a GL
 * entry cannot be traced back to the order/discount that produced it. BD-05's OWN
 * refund->order->original-discount trace is intact (0026 captures order_id + reference
 * and the original ORDER_DISCOUNT is resolvable), so this flags only the invoice-side
 * leg a BD-05 Option A mirror reversal would need and which is absent. Re-declared
 * locally for the same purity reason as TIMING_POLICY_REQUIRED.
 */
export const SOURCE_TRACE_GAP = 'SOURCE_TRACE_GAP';

// ── BD-05 option letters (from the registry, not a literal) ──────────────────
export type Bd05Option = string;
export const BD05_OPTIONS: readonly string[] = (() => {
  const policy = getPolicy('BD-05');
  return policy ? Object.freeze(policy.options.map((o) => o.value)) : [];
})();

// ── Inputs / outputs ─────────────────────────────────────────────────────────
/**
 * The TRUE identity of a BD-05 refund event — the schema's `bonus_ledger` row whose
 * `txn_type = 'REFUND'` (created by `modify_order_item('remove', …)` when
 * `v_refund > 0`, 0026:103-109). This is the event's identity, NOT orders.id and NOT the
 * original ORDER_DISCOUNT's ledger.id.
 *
 * - `ledgerId`           : bonus_ledger.id of the REFUND row (TRUE identity — drives
 *                           idempotency + snapshot key).
 * - `originalLedgerId`   : bonus_ledger.id of the original ORDER_DISCOUNT row (REFERENCE
 *                           only — for source-trace and BD-04 policy lookup; never the
 *                           snapshot key, so BD-04's lock is untouched).
 * - `idempotencyKey`     : `bonus_ledger.idempotency_key` = `MOD:{order_id}:{order_item_id}`
 *                           (0026:22-23, UNIQUE via 0018:73).
 */
export interface RefundIdentity {
  ledgerId: string;
  originalLedgerId?: string | null;
  orderId?: string | null;
  idempotencyKey?: string | null;
}

export interface RefundAccountingContext {
  /** Real identity of the refund (drives idempotency + snapshot key). */
  identity: RefundIdentity;
  /** Refund stage. BD-08 timing NOT consulted; BD-05 affects at the E10 REFUND event. */
  status: string;
  /** Best-effort current financial company (C-3 single-company assumption). */
  companyId?: string | null;
  /** v_refund = greatest(v_discount - v_new_discount, 0) from 0026 — context only. */
  refundAmount?: number | null;
  /** v_discount (original ORDER_DISCOUNT magnitude) — context only, not recomputed. */
  originalDiscountAmount?: number | null;
  /** The BD-04 option that governed the original ORDER_DISCOUNT (read at apply time). */
  originalDiscountPolicy?: string | null;
}

/**
 * Account ROLE, not code. BD-05 Option A (mirror reversal) intends a `bonus_liability`
 * reversal account — which does NOT exist in the seeded COA (no 2xxx). Option B intends
 * no account (no separate entry by design). The engine NEVER invents a code; an unmapped
 * role is exactly what trips ACCOUNT_MAPPING_REQUIRED.
 */
export interface RefundAccountRole {
  role: 'bonus_liability';
  code?: undefined;
}

/** The concrete accounting effect chosen for this refund (never a default). */
export type RefundEffect =
  | {
      kind: 'no_entry';
      reason: string;
    }
  | {
      kind: 'would_post';
      intendedAccounts: RefundAccountRole[];
      /** Gap that blocks posting, or undefined when the effect would post cleanly. */
      code?: string;
      reason: string;
      /** Which refund model the option selected. */
      basis: 'compensating_mirror' | 'implicit_repricing';
      /** Why that basis cannot be posted today (human-readable). */
      basisGap: string;
    }
  | {
      kind: 'fail_closed';
      code: string;
      reason: string;
    };

export interface RefundDecision {
  /** BD-05 option resolved at refund time (null only when resolution failed). */
  option: string | null;
  effect: RefundEffect;
  /** journal_entry.id if one were actually created (null today for BD-05 — fail-closed). */
  journalEntryId: string | null;
  /** Stable idempotency key for THIS refund's accounting effect. */
  effectKey: string;
  /** Did a snapshot already exist for this refund when we got here? */
  alreadyHadPolicySnapshot: boolean;
  /** Gaps / warnings accompanying the decision. */
  diagnostics: string[];
  /** Source-trace shape wired for the future poster (R-1: financial_documents
   *  source_table='bonus_ledger' + source_id), anchored on the REFUND row and
   *  referencing the original ORDER_DISCOUNT ledger row. */
  sourceTrace: {
    sourceTable: 'bonus_ledger';
    sourceId: string;
    documentType: 'bonus_refund';
    orderId: string | null;
    ledgerId: string;
    originalLedgerId: string | null;
    idempotencyKey: string | null;
  };
}

/** Storage abstraction reused from BD-01 (bonus_settings read/write). */
export type RefundDeps = BonusEarnDeps;

// ── 1. Resolve the CURRENT live policy (fail-closed, no default) ──────────────
/**
 * Reads `accounting_policy.BD-05` from settings and validates it against BD-05's
 * registered option set {A,B} (from `accountingPolicies.ts`).
 *
 * Throws `ACCOUNTING_POLICY_NOT_CONFIGURED` / `INVALID_ACCOUNTING_POLICY` — the
 * caller decides how to surface it; this function NEVER substitutes a default option.
 *
 * Company note: `bonus_settings` and `bonus_ledger` carry NO `company_id` (0018:53-75;
 * 0002:126-173; Phase-49 §1.4), so the read is global. Passing a `companyId` produces a
 * `COMPANY_POLICY_ISOLATION_GAP` diagnostic rather than a silent cross-company read —
 * the verified ACC-10 gap. (The financial side IS company-scoped:
 * financial_accounts/financial_journal_entries have company_id NOT NULL, 0006:144/154.)
 */
export async function resolveOrderRefundAccountingPolicy(
  deps: RefundDeps,
  companyId?: string | null,
): Promise<{ option: string; diagnostics: string[] }> {
  const raw = await deps.readSetting(BD05_POLICY_KEY);
  if (raw == null || raw === '') {
    throw new PolicyResolutionError(
      POLICY_NOT_CONFIGURED,
      'BD-05 is not configured; refusing to assume a policy.',
    );
  }
  const candidate = String(raw);
  if (!BD05_OPTIONS.includes(candidate)) {
    throw new PolicyResolutionError(
      POLICY_INVALID,
      `BD-05 option "${candidate}" is not one of the registered alternatives (${BD05_OPTIONS.join(', ') || 'none'}).`,
    );
  }
  const diagnostics: string[] = [];
  if (companyId) {
    diagnostics.push(COMPANY_POLICY_ISOLATION_GAP);
  }
  return { option: candidate, diagnostics };
}

// ── 2. Snapshot the policy in force for THIS refund (history protection) ──────
/**
 * Persists `accounting_policy.snapshot.<refundLedgerId>` = option via the existing
 * director-writable `bonus_settings` (no new table, no migration). Idempotent: if a
 * snapshot already exists for this refund's TRUE identity (the REFUND row's
 * bonus_ledger.id) it is left untouched, so a later setting change can never rewrite a
 * refunded item's recorded policy. This is keyed on the REFUND row — never on the
 * original ORDER_DISCOUNT row (whose BD-04 snapshot is preserved — directive item 5).
 */
export async function snapshotRefundPolicy(
  refundLedgerId: string,
  option: string,
  deps: RefundDeps,
): Promise<{ written: boolean }> {
  const key = `${BD05_SNAPSHOT_PREFIX}${refundLedgerId}`;
  const existing = await deps.readSetting(key);
  if (existing != null) return { written: false };
  await deps.upsertSetting(key, option);
  return { written: true };
}

/** Which BD-05 option was in force when this refund was created. */
export async function getHistoricalRefundPolicy(
  refundLedgerId: string,
  deps: RefundDeps,
): Promise<{ option: string | null; source: 'snapshot' | 'none' }> {
  const raw = await deps.readSetting(`${BD05_SNAPSHOT_PREFIX}${refundLedgerId}`);
  if (raw == null) return { option: null, source: 'none' };
  const opt = String(raw);
  return { option: BD05_OPTIONS.includes(opt) ? opt : null, source: 'snapshot' };
}

// ── 3. Dispatch A / B for this refund (fail-closed, no journal fabricated) ──────
/**
 * Resolve the current BD-05 policy, snapshot it for THIS refund, and return the
 * concrete accounting effect. Does NOT mutate bonus_ledger (the REFUND row was already
 * flipped to POSTED server-side by `modify_order_item`, 0026:104-108); does NOT create
 * journal entries (`create_financial_journal_entry`/`post_financial_journal_entry` are
 * not called — the engine never fabricates a journal).
 *
 * Per-option, grounded in Phase-49 ACC-06/ACC-12 + §5.2 + the seeded COA (0007:42-54):
 *   A (compensating mirror via reverses_id): intends to credit the bonus-liability
 *     reversal account (2xxx) and link the mirror to the original ORDER_DISCOUNT via
 *     reverses_id (registry A). The 2xxx bonus-liability account does NOT exist
 *     (0007:42-54; Phase-49 §5.2 line 484 "No customer-bonus liability account exists"),
 *     and 0026's REFUND row sets NO reverses_id (0026:104-108) — so there is no durable
 *     link to the original to anchor a reversal to. A is a would_post INTENT that fails
 *     closed on ACCOUNT_MAPPING_REQUIRED (+ REVERSAL_LINKAGE_GAP). No journal.
 *   B (implicit repricing, no separate entry): intends to fold the refund into a
 *     repriced/cancelled invoice and write NO journal. But 0026 does not reprice the
 *     invoice (0026:3-4, 101) and no invoice-repricing journal path exists; the original
 *     BD-04=A net invoice is already posted (0009:108-138). B cannot be exercised ->
 *     fail_closed INVOICE_REPRICING_REQUIRED. No journal.
 *
 * BD-08 timing is NOT consulted (separate policy); this engine is async only to leave a
 * seam for a future publish-timing gate (TIMING_POLICY_REQUIRED diagnostic).
 *
 * Idempotency: the snapshot is keyed by the refund's TRUE identity
 * (the REFUND bonus_ledger.id) and written once; re-dispatching the same refund yields
 * alreadyHadPolicySnapshot=true and NO_DUPLICATE_EFFECT. The refund-level
 * idempotency_key (`MOD:{order}:{item}`, 0020... wait 0026:22-23; UNIQUE via 0018:73)
 * plus 0026's audit_trail already-processed guard (0026:67-72) make the refund creation
 * itself idempotent at the database level.
 */
export async function applyOrderRefundAccounting(
  ctx: RefundAccountingContext,
  deps: RefundDeps,
): Promise<RefundDecision> {
  const { ledgerId, originalLedgerId, orderId, idempotencyKey } = ctx.identity;
  const effectKey = `bd05:refund:${ledgerId}`;
  const sourceTrace = {
    sourceTable: 'bonus_ledger' as const,
    sourceId: ledgerId,
    documentType: 'bonus_refund' as const,
    orderId: orderId ?? null,
    ledgerId,
    originalLedgerId: originalLedgerId ?? null,
    idempotencyKey: idempotencyKey ?? null,
  };

  // (1) Resolve current live policy — fail closed (no default).
  let option: string;
  let resolveDiagnostics: string[] = [];
  try {
    const resolved = await resolveOrderRefundAccountingPolicy(deps, ctx.companyId);
    option = resolved.option;
    resolveDiagnostics = resolved.diagnostics;
  } catch (e) {
    const err = e as PolicyResolutionError;
    const code = err.code ?? 'UNKNOWN';
    return {
      option: null,
      effect: { kind: 'fail_closed', code, reason: `${code}: ${err.message}` },
      journalEntryId: null,
      effectKey,
      alreadyHadPolicySnapshot: false,
      diagnostics: [],
      sourceTrace,
    };
  }

  // (2) Snapshot the policy in force for THIS refund (idempotent, history-safe).
  const snap = await snapshotRefundPolicy(ledgerId, option, deps);

  // (3) Dispatch A / B. The bonus-liability reversal account (2xxx) does NOT exist
  //     (0007:42-54; Phase-49 §5.2 line 484); 0026's REFUND row sets no reverses_id
  //     (0026:104-108). The engine never fabricates a journal.
  const baseDiagnostics = [
    ...resolveDiagnostics,
    ACCOUNTING_NOT_POSTED,
    BONUS_GL_ATOMICITY_GAP,
    TIMING_POLICY_REQUIRED,
    SOURCE_TRACE_GAP,
  ];

  if (option === 'A') {
    // Compensating mirror via reverses_id. The mirror would credit the bonus-liability
    // reversal account (2xxx) to reverse the original discount's bonus-liability
    // recognition — but that account is absent, and 0026 sets no reverses_id to anchor it.
    const intendedAccounts: RefundAccountRole[] = [
      { role: 'bonus_liability' }, // MISSING — no 2xxx bonus-liability account (0007:42-54; §5.2 line 484)
    ];
    return {
      option,
      effect: {
        kind: 'would_post',
        intendedAccounts,
        code: ACCOUNT_MAPPING_REQUIRED,
        reason:
          `${ACCOUNT_MAPPING_REQUIRED}: BD-05 Option A (عكس تعويضي / compensating mirror ` +
          `reversal via reverses_id) would credit the bonus-liability reversal account (2xxx) ` +
          `to reverse the original ORDER_DISCOUNT's bonus-liability recognition, and link the ` +
          `mirror to the original via reverses_id (registry A; 0018:68,171-173). The 2xxx ` +
          `bonus-liability account does NOT exist in the seeded COA (no bonus-liability / ` +
          `Sales Discount / contra-receivable account — 0007:42-54; Phase-49 §5.2 line 484: ` +
          `"No customer-bonus liability account exists"), and 0026's REFUND row sets NO ` +
          `reverses_id (0026:104-108) — so there is no durable link to the original ORDER_DISCOUNT ` +
          `to anchor a reversal to (REVERSAL_LINKAGE_GAP). The engine NEVER invents an account; ` +
          `no journal is fabricated.`,
        basis: 'compensating_mirror',
        basisGap:
          'The bonus-liability reversal account (2xxx) is absent from the seeded COA ' +
          '(0007:42-54; Phase-49 §5.2 line 484), and the REFUND row carries no reverses_id ' +
          '(0026:104-108) to link the mirror to the original discount — the account-mapping gap ' +
          'and the linkage gap are the blockers, not a valuation basis.',
      },
      journalEntryId: null,
      effectKey,
      alreadyHadPolicySnapshot: !snap.written,
      diagnostics: [...baseDiagnostics, ACCOUNT_MAPPING_REQUIRED, REVERSAL_LINKAGE_GAP],
      sourceTrace,
    };
  }

  if (option === 'B') {
    // Implicit repricing: no separate entry — fold the refund into a repriced/cancelled
    // invoice. 0026 does NOT reprice the invoice (0026:3-4, 101) and no invoice-repricing
    // journal path exists; the original BD-04=A net invoice is already posted (0009).
    return {
      option,
      effect: {
        kind: 'fail_closed',
        code: INVOICE_REPRICING_REQUIRED,
        reason:
          `${INVOICE_REPRICING_REQUIRED}: BD-05 Option B (تعديل ضمني في إعادة التسعير / implicit ` +
          `repricing, no separate entry) intends to fold the refund into a repriced or ` +
          `cancelled invoice and write NO journal. But \`modify_order_item\` does not reprice ` +
          `the invoice — it only updates orders.total_amount and writes the bonus subledger ` +
          `REFUND row (0026:3-4, 101); no invoice-repricing GL journal path exists, and the ` +
          `original BD-04=A net invoice is already posted by trg_financial_invoice_auto_journal ` +
          `(0009:108-138). Reversing/altering a posted invoice is out of BD-05's scope ` +
          `(ACC-06/BD-08/D7). No journal fabricated.`,
      },
      journalEntryId: null,
      effectKey,
      alreadyHadPolicySnapshot: !snap.written,
      diagnostics: [],
      sourceTrace,
    };
  }

  // Exhaustive over the registered option set. The resolver already guaranteed
  // option ∈ BD05_OPTIONS ({A,B}); this branch is unreachable defensive code.
  return {
    option,
    effect: {
      kind: 'fail_closed',
      code: POLICY_INVALID,
      reason: `${POLICY_INVALID}: BD-05 option "${option}" is registered but has no dispatch branch.`,
    },
    journalEntryId: null,
    effectKey,
    alreadyHadPolicySnapshot: !snap.written,
    diagnostics: [...baseDiagnostics, ACCOUNT_MAPPING_REQUIRED],
    sourceTrace,
  };
}
