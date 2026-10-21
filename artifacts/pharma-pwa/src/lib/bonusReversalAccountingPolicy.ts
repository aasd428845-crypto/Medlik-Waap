/**
 * BD-07 BONUS REVERSAL — Dynamic, director-controlled accounting-policy engine.
 *
 * ⚠️ SCOPE: BD-07 (Bonus Reversal) ONLY. BD-08..BD-10 are explicitly NOT implemented
 * (directive item: "لا تنفذ BD-08 أو BD-09 أو BD-10"). BD-07's option letters come from
 * the registry (`accountingPolicies.ts` BD-07, BINARY A/B — A = mirror entry,
 * B = net settlement) — they are NOT invented. BD-07 is NOT A/B/C.
 *
 * CORE RULES (honored literally):
 *   - The policy is NEVER chosen by code. `accounting_policy.BD-07` is read LIVE at
 *     reversal time and validated against BD-07's registered option set {A,B} (from
 *     `accountingPolicies.ts`). No `const BD07_POLICY = …`, no `policy ?? "A"`.
 *   - Missing policy -> ACCOUNTING_POLICY_NOT_CONFIGURED; invalid value ->
 *     POLICY_INVALID; both FAIL CLOSED (no journal fabricated).
 *   - A director change A->B affects ONLY subsequently-reversed entries; a reversal's
 *     recorded policy is locked at reversal time via a per-reversal snapshot keyed on
 *     the REVERSAL row's TRUE identity.
 *
 * BD-07 vs BD-05 vs BD-06 (directive item 4 — inspected, not assumed):
 *   - BD-07 REVERSAL (`txn_type='REVERSAL'`, writer `reverse_bonus_txn`,
 *     `0018:1332-1399`) is a director (E10, `0018:1393`) or automatic (E9,
 *     `0021:134`/`0022:166`) COMPENSATING entry. It ALWAYS writes `reverses_id`
 *     back to its original (0018:1395), and `bonus_ledger_reverses_uniq`
 *     (0018:168-173) enforces one REVERSAL per original.
 *   - BD-05 REFUND (`txn_type='REFUND'`, writer `modify_order_item('remove')`,
 *     `0026:103-109`) is a DIFFERENT event — refund of excess discount from item
 *     removal. Its 0026 rows write NO `reverses_id` (0026:104-108), so a missing
 *     reverses_id is INHERENT to BD-05 and is always signalled there
 *     (REVERSAL_LINKAGE_GAP on every BD-05-A decision).
 *   - BD-06 EXPIRATION (`txn_type='EXPIRATION'`, writer `expire_bonus`,
 *     `0018:1413`) is another distinct event; it too carries `reverses_id` but is
 *     governed by BD-06's own policy.
 *   Therefore BD-07 does NOT inherit BD-05's inherent REVERSAL_LINKAGE_GAP; the gap is
 *   signalled for BD-07 ONLY when a specific reversal row genuinely lacks
 *   reverses_id (defensive; not the normal case).
 *
 * Why BD-07 cannot post today (verified, not assumed):
 *   - Option A (mirror entry / قيد مرآة): `would_post` INTENT — create a mirror GL entry
 *     (opposite sign) anchored to the original via `reverses_id` (0018:1395). The mirror
 *     reverses the original's bonus-liability recognition, which routes through the 2xxx
 *     deferred-bonus-liability account — which does NOT exist in the seeded COA
 *     (0007:42-54; Phase-49 §5.2 line 484: "No customer-bonus liability account exists").
 *     2100 (الموردون والذمم الدائنة / Suppliers-Payables, 0007:50) is NOT a substitute —
 *     its semantic purpose is supplier payables, not a bonus liability (directive item 9).
 *     A fails CLOSED on ACCOUNT_MAPPING_REQUIRED; the engine NEVER invents an account.
 *   - Option B (net settlement / تسويل صافي): `no_entry` — the reversal is folded into the
 *     period's net with NO separate GL line (Phase-49 §3.12: "Accounting integration:
 *     none" — `0018` grep for `financial_` = 0). REALISABLE TODAY; matches the current
 *     system behavior. No accounts, no journal.
 *   Reversal never introduces revenue (it unwinds prior recognition) — neither option
 *   carries a `revenue` account role.
 *
 * TIMING (BD-08 NOT consulted): the BD-07 *event boundary* is fixed by the lifecycle
 * (the REVERSAL row inserted by `reverse_bonus_txn` / E9, 0018:1393), but WHEN a mirror
 * entry would be published is the separate, undecided BD-08 question -> TIMING_POLICY_REQUIRED
 * on A's intent path.
 *
 * PURE. Imports only `accountingPolicies.ts` (pure data) + shared fail-closed
 * sentinels/types from `bonusAccountingPolicy.ts` (BD-01). Never initialises Supabase.
 * Tested offline with an in-memory fake store.
 *
 * Sources of truth (verified in-repo, not assumed):
 *  - accountingPolicies.ts        -> BD-07 options {A,B} (ACC-13, E9/E10).
 *  - 0018_bonus_financial_system.sql:53-75  -> bonus_ledger (id PK; txn_type CHECK includes
 *    'REVERSAL' 0018:59; idempotency_key UNIQUE 0018:73; reverses_id nullable 0018:68 but
 *    ALWAYS populated for REVERSAL by reverse_bonus_txn 0018:1395; NO company_id — ACC-10);
 *    0018:98-112 -> POSTED immutability; 0018:168-173 ->
 *    `bonus_ledger_reverses_uniq` partial unique index on reverses_id for
 *    ('REVERSAL','EXPIRATION') — one compensation per original;
 *  - 0018:1329-1406 -> `reverse_bonus_txn(p_ledger_id, p_reason, p_idempotency_key)` returns
 *    the new REVERSAL row id; director-only; POSTED-only; caps credit reversals at
 *    bonus_credit_remaining (0018:1380-1390); writes reverses_id=v_row.id (0018:1395);
 *    idempotency_key check (0018:1338-1343) + the reverses_uniq index dedup;
 *  - 0018:1380-1390 + 0018:437-471 -> `bonus_credit_remaining(credit_id)`, the cap.
 *  - 0007:42-54 -> seeded COA: 1110/1120/1130/1140 (assets), 2100 (Suppliers/Payables — NOT
 *    a bonus liability), 4000 (Revenue), 5000 (COGS), 6000 (Expenses), 6110 (commissions);
 *    NO 2xxx bonus-liability account (Phase-49 §5.2 line 484/485).
 *  - 0021_bonus_auto_cancel.sql:134-138 + 0022_*:166-172 -> E9 automatic REVERSAL with
 *    reverses_id pointing at the original ORDER_DISCOUNT (idempotency_key 'REVERSAL:DISCOUNT:{order}').
 *  - docs/opencode/PHASE-49-BONUS-ACCOUNTING-DECISION-MATRIX.md §3.11 E9, §3.12 E10, §7,
 *    §10 ACC-12, §5.2 line 484, §6.3 (invoices->order traceability), §13.1.
 */

import { getPolicy } from './accountingPolicies.ts';

// ── Keys ───────────────────────────────────────────────────────────────────
/** Live director-chosen policy for Bonus Reversal (BD-07). */
export const BD07_POLICY_KEY = 'accounting_policy.BD-07';
/**
 * Per-reversal historical snapshot prefix; the suffix is the REVERSAL row's
 * bonus_ledger.id (the TRUE BD-07 event identity). Shared namespace with
 * BD-01..BD-06 snapshots (suffix = globally-unique bonus_ledger.id), so a reversal
 * snapshot can never collide with an earn/redemption/expiry snapshot. No new table,
 * no migration. Keyed on the REVERSAL row — NEVER on the original event's row, so the
 * original event's own snapshot is structurally untouched.
 */
export const BD07_SNAPSHOT_PREFIX = 'accounting_policy.snapshot.';

// ── Shared fail-closed sentinels (reused from BD-01; never re-defined) ───────
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

// ── BD-07-specific gaps (additive; BD-01..BD-06 files untouched) ──────────────
/**
 * BD-07 Option A (mirror entry) requires the reversal to be anchored to its original via
 * `reverses_id` (registry A; 0018:68,171-173). reverse_bonus_txn ALWAYS writes reverses_id
 * (0018:1395), so this gap is NOT inherent to BD-07 (unlike BD-05, whose 0026 REFUND never
 * carries reverses_id). It is surfaced ONLY when a specific reversal row genuinely lacks the
 * link — a defensive, evidence-driven check, never an assumption.
 */
export const REVERSAL_LINKAGE_GAP = 'REVERSAL_LINKAGE_GAP';
/**
 * BD-08 (publish/sweep timing) is a SEPARATE, un-decided policy. The BD-07 *event boundary*
 * is fixed by the lifecycle (the REVERSAL row inserted by reverse_bonus_txn / E9), but WHEN
 * a mirror entry is published is not → TIMING_POLICY_REQUIRED on the would_post intent path.
 * Re-declared locally (identical string value BD-04/BD-06 surface) so BD-07 stays pure;
 * the base is left untouched.
 */
export const TIMING_POLICY_REQUIRED = 'TIMING_POLICY_REQUIRED';

// ── BD-07 option letters (from the registry, not a literal) ──────────────────
export type Bd07Option = string;
export const BD07_OPTIONS: readonly string[] = (() => {
  const policy = getPolicy('BD-07');
  return policy ? Object.freeze(policy.options.map((o) => o.value)) : [];
})();

// ── Inputs / outputs ─────────────────────────────────────────────────────────
/**
 * The TRUE identity of a BD-07 reversal event — the schema's `bonus_ledger` row whose
 * `txn_type = 'REVERSAL'` (created by `reverse_bonus_txn`, 0018:1393-1399, which RETURNS
 * the new row's id). This is the event's identity, NOT account_id / order_id / customer_id.
 *
 * - `ledgerId`        : bonus_ledger.id of the REVERSAL row (TRUE identity — drives
 *                       idempotency + snapshot key).
 * - `originalLedgerId`: the ORIGINAL event's bonus_ledger.id, carried as the
 *                       reverses_id reference (0018:1395). A REFERENCE, never the reversal's
 *                       identity — so this snapshot never collides with the original event's
 *                       own snapshot (BD-01/BD-05/BD-06 snapshots structurally untouched).
 * - `idempotencyKey`  : the REVERSAL row's idempotency_key (optional; E9 uses
 *                       'REVERSAL:DISCOUNT:{order}' at 0021:134; E10 may be null).
 */
export interface ReversalIdentity {
  /** `bonus_ledger.id` of the REVERSAL row (the TRUE BD-07 event identity). */
  ledgerId: string;
  /** `reverses_id` → the original event being reversed (a reference, not the identity). */
  originalLedgerId?: string | null;
  /** `orders.id` copied from the original (source-trace context). */
  orderId?: string | null;
  /** `bonus_ledger.idempotency_key` of the REVERSAL row (may be null). */
  idempotencyKey?: string | null;
  /** `bonus_ledger.account_id` the reversal settled against. */
  accountId?: string | null;
}

export interface ReversalAccountingContext {
  /** Real identity of the reversal (drives idempotency + snapshot key). */
  identity: ReversalIdentity;
  /** 'POSTED' — 0018:1395. */
  status: string;
  /** Best-effort current financial company (C-3 single-company assumption). */
  companyId?: string | null;
  /** abs(REVERSAL.amount) = the compensated value (0018:1395: `-v_cap`). */
  reversalAmount?: number | null;
}

/**
 * Account ROLE, not code. BD-07 Option A (mirror) intends a `bonus_liability`
 * (the 2xxx reversal account, ABSENT — Phase-49 §5.2 line 484; 2100 is Suppliers, NOT a
 * bonus liability). Option B (net settlement) intends no account. The engine NEVER
 * invents a code; an unmapped role is exactly what trips ACCOUNT_MAPPING_REQUIRED.
 */
export interface ReversalAccountRole {
  role: 'bonus_liability';
  code?: undefined;
}

/**
 * The concrete accounting effect chosen for this reversal.
 *  - no_entry      : B — the reversal is netted into the period with no separate GL line.
 *                    Realisable today (Phase-49 §3.12 "Accounting integration: none").
 *  - would_post    : A intent — post a mirror entry; blocked by ACCOUNT_MAPPING_REQUIRED
 *                    (no 2xxx bonus-liability account). journalEntryId stays null.
 *  - fail_closed   : unconfigured/invalid policy, or a reversal with no reverses_id anchor
 *                    (REVERSAL_LINKAGE_GAP) that A cannot mirror.
 */
export type ReversalEffect =
  | { kind: 'no_entry'; reason: string }
  | {
      kind: 'would_post';
      intendedAccounts: ReversalAccountRole[];
      code: typeof ACCOUNT_MAPPING_REQUIRED;
      reason: string;
      basis: 'mirror_compensation';
    }
  | { kind: 'fail_closed'; code: string; reason: string };

export interface ReversalDecision {
  /** BD-07 option resolved at reversal time (null only when resolution failed). */
  option: string | null;
  effect: ReversalEffect;
  /** journal_entry.id if one were actually created (null today for BD-07 — fail-closed). */
  journalEntryId: string | null;
  /** Stable idempotency key for THIS reversal's accounting effect. */
  effectKey: string;
  /** Did a snapshot already exist for this reversal when we got here? */
  alreadyHadPolicySnapshot: boolean;
  /** Gaps / warnings accompanying the decision. */
  diagnostics: string[];
  /**
   * Source-trace shape anchored on the REVERSAL row, referencing the original event via
   * reverses_id. `reversesIdPresent` is TRUE for BD-07 in normal operation (reverse_bonus_txn
   * writes reverses_id, 0018:1395) — this is what distinguishes BD-07 from BD-05 (whose 0026
   * REFUND writes none), so BD-07 does NOT carry an inherent REVERSAL_LINKAGE_GAP.
   */
  sourceTrace: {
    sourceTable: 'bonus_ledger';
    sourceId: string;
    documentType: 'bonus_reversal';
    ledgerId: string;
    originalLedgerId: string | null;
    orderId: string | null;
    accountId: string | null;
    idempotencyKey: string | null;
    reversesIdPresent: boolean;
  };
}

/** Storage abstraction reused from BD-01 (bonus_settings read/write). */
export type ReversalDeps = BonusEarnDeps;

// ── 1. Resolve the CURRENT live policy (fail-closed, no default) ──────────────
/**
 * Reads `accounting_policy.BD-07` from settings and validates it against BD-07's
 * registered option set {A,B} (from `accountingPolicies.ts`).
 *
 * Throws `ACCOUNTING_POLICY_NOT_CONFIGURED` / `INVALID_ACCOUNTING_POLICY` — the
 * caller decides how to surface it; this function NEVER substitutes a default option
 * (no "assume A" fallback).
 *
 * Company note: `bonus_settings` carries NO `company_id` (0018 DDL; Phase-49 §1.4 fault
 * line), so the read is global. Passing a `companyId` produces a
 * `COMPANY_POLICY_ISOLATION_GAP` diagnostic rather than a silent cross-company read —
 * the verified ACC-10 gap.
 */
export async function resolveBonusReversalAccountingPolicy(
  deps: ReversalDeps,
  companyId?: string | null,
): Promise<{ option: string; diagnostics: string[] }> {
  const raw = await deps.readSetting(BD07_POLICY_KEY);
  if (raw == null || raw === '') {
    throw new PolicyResolutionError(
      POLICY_NOT_CONFIGURED,
      'BD-07 is not configured; refusing to assume a policy.',
    );
  }
  const candidate = String(raw);
  if (!BD07_OPTIONS.includes(candidate)) {
    throw new PolicyResolutionError(
      POLICY_INVALID,
      `BD-07 option "${candidate}" is not one of the registered alternatives (${BD07_OPTIONS.join(', ') || 'none'}).`,
    );
  }
  const diagnostics: string[] = [];
  if (companyId) {
    diagnostics.push(COMPANY_POLICY_ISOLATION_GAP);
  }
  return { option: candidate, diagnostics };
}

// ── 2. Snapshot the policy in force for THIS reversal (history protection) ───
/**
 * Persists `accounting_policy.snapshot.<reversalLedgerId>` = option via the existing
 * director-writable `bonus_settings` (no new table, no migration). Idempotent: if a
 * snapshot already exists for this reversal's TRUE identity (the REVERSAL row's
 * bonus_ledger.id) it is left untouched, so a later setting change can never rewrite a
 * reversal's recorded policy. Keyed on the REVERSAL row — never on the original event's
 * row, so BD-01/BD-05/BD-06 snapshots are structurally untouched.
 */
export async function snapshotBonusReversalPolicy(
  reversalLedgerId: string,
  option: string,
  deps: ReversalDeps,
): Promise<{ written: boolean }> {
  const key = `${BD07_SNAPSHOT_PREFIX}${reversalLedgerId}`;
  const existing = await deps.readSetting(key);
  if (existing != null) return { written: false };
  await deps.upsertSetting(key, option);
  return { written: true };
}

/** Which BD-07 option was in force when this reversal was processed. */
export async function getHistoricalBonusReversalPolicy(
  reversalLedgerId: string,
  deps: ReversalDeps,
): Promise<{ option: string | null; source: 'snapshot' | 'none' }> {
  const raw = await deps.readSetting(`${BD07_SNAPSHOT_PREFIX}${reversalLedgerId}`);
  if (raw == null) return { option: null, source: 'none' };
  const opt = String(raw);
  return { option: BD07_OPTIONS.includes(opt) ? opt : null, source: 'snapshot' };
}

// ── 3. Dispatch A / B for this reversal (fail-closed, no journal fabricated) ───
/**
 * Resolve the current BD-07 policy, snapshot it for THIS reversal, and return the
 * concrete accounting effect. Does NOT mutate bonus_ledger (the REVERSAL row was already
 * written server-side by `reverse_bonus_txn`, 0018:1393-1399); does NOT create journal
 * entries (`create_financial_journal_entry` / `post_financial_journal_entry` are not
 * called — the engine never fabricates a journal).
 *
 * Per-option, grounded in Phase-49 ACC-12/ACC-13 + §5.2 + §3.12 + the seeded COA
 * (0007:42-54):
 *   A (mirror entry / قيد مرآة): would_post INTENT — a mirror GL entry (opposite sign)
 *     anchored to the original via reverses_id (0018:1395). The mirror reverses the
 *     original's bonus-liability recognition, routed through the 2xxx deferred-bonus-
 *     liability account — which does NOT exist (0007:42-54; Phase-49 §5.2 line 484: "No
 *     customer-bonus liability account exists"; 2100 is Suppliers/Payables, NOT a bonus
 *     liability — directive item 9). Fails CLOSED on ACCOUNT_MAPPING_REQUIRED. Reversal
 *     never introduces revenue — it unwinds prior recognition; A has no revenue role.
 *   B (net settlement / تسويل صافي): `no_entry` — the reversal is folded into the period's
 *     net with NO separate GL line (Phase-49 §3.12: "Accounting integration: none" —
 *     `0018` grep for `financial_` = 0). REALISABLE TODAY; no accounts, no journal.
 *
 * REVERSAL_LINKAGE_GAP: reverse_bonus_txn ALWAYS writes reverses_id (0018:1395), so in
 * normal operation reversesIdPresent=true and the gap is NOT signalled. It IS signalled
 * only when a specific reversal row genuinely lacks reverses_id — if so, A cannot anchor
 * its mirror (fail_closed REVERSAL_LINKAGE_GAP); B stays no_entry but carries the
 * traceability flag. This is the evidence-driven distinction from BD-05 (whose REFUND never
 * carries reverses_id).
 *
 * BD-08 timing is NOT consulted (separate policy); this engine is async only to leave a
 * seam for a future publish-timing gate (TIMING_POLICY_REQUIRED on the intent path).
 *
 * Idempotency: the snapshot is keyed by the REVERSAL row's TRUE identity
 * (bonus_ledger.id) and written once; re-dispatch yields alreadyHadPolicySnapshot=true. At
 * the DB level, `reverse_bonus_txn` dedups via its idempotency_key lookup
 * (0018:1338-1343) plus `bonus_ledger_reverses_uniq` (0018:168-173), so the REVERSAL row
 * is created at most once per original.
 */
export async function applyBonusReversalAccounting(
  ctx: ReversalAccountingContext,
  deps: ReversalDeps,
): Promise<ReversalDecision> {
  const { ledgerId, originalLedgerId, orderId, idempotencyKey, accountId } = ctx.identity;
  const effectKey = `bd07:reversal:${ledgerId}`;
  const reversesIdPresent = Boolean(originalLedgerId);
  const sourceTrace = {
    sourceTable: 'bonus_ledger' as const,
    sourceId: ledgerId,
    documentType: 'bonus_reversal' as const,
    ledgerId,
    originalLedgerId: originalLedgerId ?? null,
    orderId: orderId ?? null,
    accountId: accountId ?? null,
    idempotencyKey: idempotencyKey ?? null,
    // BD-07: reverse_bonus_txn always writes reverses_id (0018:1395) -> linked to original.
    reversesIdPresent,
  };

  // (1) Resolve current live policy — fail closed (no default).
  let option: string;
  let resolveDiagnostics: string[] = [];
  try {
    const resolved = await resolveBonusReversalAccountingPolicy(deps, ctx.companyId);
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

  // (2) Snapshot the policy in force for THIS reversal (idempotent, history-safe).
  const snap = await snapshotBonusReversalPolicy(ledgerId, option, deps);

  // Conditional traceability gap: signalled ONLY when reverses_id is genuinely absent.
  const linkageGap = reversesIdPresent ? [] : [REVERSAL_LINKAGE_GAP];

  // (3) Dispatch A / B. BD-08 timing NOT consulted; event boundary = REVERSAL row.
  const intentDiagnostics = [
    ...resolveDiagnostics,
    ACCOUNTING_NOT_POSTED,
    BONUS_GL_ATOMICITY_GAP,
    TIMING_POLICY_REQUIRED,
  ];

  if (option === 'A') {
    // A cannot anchor a mirror without the original link.
    if (!reversesIdPresent) {
      return {
        option,
        effect: {
          kind: 'fail_closed',
          code: REVERSAL_LINKAGE_GAP,
          reason:
            `${REVERSAL_LINKAGE_GAP}: BD-07 Option A (قيد مرآة / mirror entry) requires the reversal ` +
            `to be anchored to its original via reverses_id (0018:1395), but the REVERSAL row ` +
            `${ledgerId} has no reverses_id — a mirror cannot be constructed. No journal fabricated.`,
        },
        journalEntryId: null,
        effectKey,
        alreadyHadPolicySnapshot: !snap.written,
        diagnostics: [...resolveDiagnostics, ...linkageGap],
        sourceTrace,
      };
    }
    // Mirror intent: reverse the original's bonus-liability recognition via 2xxx.
    const intendedAccounts: ReversalAccountRole[] = [{ role: 'bonus_liability' }];
    return {
      option,
      effect: {
        kind: 'would_post',
        intendedAccounts,
        code: ACCOUNT_MAPPING_REQUIRED,
        reason:
          `${ACCOUNT_MAPPING_REQUIRED}: BD-07 Option A (قيد مرآة / mirror entry, compensating) would post a mirror GL entry (opposite sign) that reverses the original event's bonus-liability recognition, anchored via reverses_id (0018:1395) to ${originalLedgerId}. The 2xxx bonus-liability reversal account does NOT exist in the seeded chart of accounts (0007:42-54; Phase-49 §5.2 line 484: "No customer-bonus liability account exists"; 2100 is Suppliers/Payables — NOT a bonus liability, directive item 9). The engine NEVER invents an account; no journal is fabricated. A reversal never introduces revenue — it unwinds prior recognition, so A carries no revenue role.`,
        basis: 'mirror_compensation',
      },
      journalEntryId: null,
      effectKey,
      alreadyHadPolicySnapshot: !snap.written,
      diagnostics: [...intentDiagnostics, ACCOUNT_MAPPING_REQUIRED],
      sourceTrace,
    };
  }

  // option === 'B' — net settlement (no separate GL entry; netted in the period).
  return {
    option,
    effect: {
      kind: 'no_entry',
      reason:
        `BD-07 Option B (تسويل صافي / net settlement): the reversal is folded into the period's ` +
        `net financials with NO separate GL mirror line — no journal entry is created for the ` +
        `reversal itself. This is realisable today and matches the current system behaviour ` +
        `(Phase-49 §3.12: "Accounting integration: none" — reverse_bonus_txn writes only the ` +
        `bonus_ledger REVERSAL row, 0018 grep for financial_ = 0). B carries no revenue role ` +
        `(a reversal unwinds, it never creates revenue).`,
    },
    journalEntryId: null,
    effectKey,
    alreadyHadPolicySnapshot: !snap.written,
    diagnostics: reversesIdPresent ? [...resolveDiagnostics] : [...resolveDiagnostics, ...linkageGap],
    sourceTrace,
  };
}
