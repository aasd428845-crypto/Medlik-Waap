/**
 * BD-06 BONUS EXPIRATION — Dynamic, director-controlled accounting-policy engine.
 *
 * ⚠️ SCOPE: BD-06 (Bonus Expiration / Expiry) ONLY. BD-07..BD-10 are explicitly
 * NOT implemented (directive item: "لا تنفذ BD-07 أو BD-08 أو BD-09 أو BD-10").
 * BD-06's option letters come from the registry (`accountingPolicies.ts` BD-06,
 * a ternary A/B/C) — they are NOT invented. BD-07 (REVERSAL via
 * `reverse_bonus_txn`) is a DIFFERENT event with a different txn_type and must
 * not share BD-06 policy semantics, even though both write `reverses_id` at the
 * subledger level (directive item 5: a shared abstraction may be used
 * technically, but policy semantics stay separate).
 *
 * CORE RULES (honored literally):
 *   - The policy is NEVER chosen by code. `accounting_policy.BD-06` is read LIVE
 *     at expiration time and validated against BD-06's registered option set
 *     {A,B,C} (from `accountingPolicies.ts`). No `const BD06_POLICY = …`, no
 *     `policy ?? "A"`.
 *   - Missing policy -> ACCOUNTING_POLICY_NOT_CONFIGURED; invalid value ->
 *     POLICY_INVALID; both FAIL CLOSED (no journal fabricated).
 *   - A director change A->B affects ONLY subsequently-expired lots; an
 *     expiration's recorded policy is locked at expiry time via a per-lot
 *     snapshot keyed on the EXPIRATION row's TRUE identity.
 *
 * Why BD-06 cannot post today (verified, not assumed):
 *   - Option A (no entry / expiry write-off): REALISABLE TODAY as `no_entry`.
 *     This is the current system behavior — `expire_bonus` writes the
 *     EXPIRATION row to bonus_ledger but writes NO journal (Phase-49 §3.13:
 *     "an expired liability that disappears generates no entry"). A has no
 *     account roles and therefore does not trip ACCOUNT_MAPPING_REQUIRED.
 *   - Option B (liability contra, no revenue): intends DR bonus_liability (the
 *     2xxx contra that would offset the original EARN's liability) — NO 2xxx
 *     bonus-liability account exists in the seeded COA (0007:42-54; Phase-49
 *     §5.2 line 484 "No customer-bonus liability account exists") ->
 *     would_post intent, fails CLOSED on ACCOUNT_MAPPING_REQUIRED.
 *   - Option C (revenue write-back, explicit owner option / ACC-14): intends
 *     DR bonus_liability (2xxx, ABSENT) / CR revenue (4000, EXISTS 0007:52).
 *     4000 is the only mapped role, but a journal entry cannot post single-sided
 *     -> fails CLOSED on ACCOUNT_MAPPING_REQUIRED. REVENUE IS AN EXPLICIT OWNER
 *     OPTION, NEVER a default: it is only reachable when the director selects C,
 *     and A (no entry) never introduces or implies revenue anywhere.
 *
 * SOURCE TRACE (verified present, not a gap): unlike BD-05's refund (whose 0026
 * row writes NO reverses_id), BD-06's EXPIRATION row carries a real
 * `reverses_id` back to its EARN lot (0018:1471), and `bonus_credit_remaining`
 * reads that linkage (0018:466). So BD-06 does NOT emit SOURCE_TRACE_GAP for the
 * EARN linkage — the trace is structurally intact. The shared bonus->GL gap is
 * documented in the final report, not fabricated here.
 *
 * PURE. Imports only `accountingPolicies.ts` (pure data) and the shared
 * fail-closed sentinels/class/deps from `bonusAccountingPolicy.ts` (BD-01). Never
 * initialises Supabase. Tested offline with an in-memory fake store.
 *
 * Sources of truth (verified in-repo):
 *  - accountingPolicies.ts        -> BD-06 options {A,B,C} (ACC-07, E11).
 *  - 0018_bonus_financial_system.sql:53-75  -> bonus_ledger (id PK; txn_type CHECK
 *    includes 'EXPIRATION' 0018:59; idempotency_key UNIQUE 0018:73 but NULL for
 *    EXPIRATION rows — dedup is by reverses_id; NO company_id — ACC-10);
 *    0018:98-112 -> POSTED immutability; 0018:168-173 ->
 *    `bonus_ledger_reverses_uniq` partial unique index on reverses_id for
 *    ('REVERSAL','EXPIRATION') — one compensation per original;
 *  - 0018:437-471 -> `bonus_credit_remaining(credit_id)` = amount − allocations −
 *    EXPIRATION/REVERSAL compensations;
 *  - 0018:1413-1485 -> `expire_bonus(p_asof)` writes one EXPIRATION row per lot
 *    (negative amount = extinguished remainder, 0018:1470), reverses_id = the EARN
 *    lot (0018:1471), ON CONFLICT (reverses_id) DO NOTHING idempotency (0018:1472-1474),
 *    only when remainder > 0 (0018:1460-1461), audit row at 0018:1479-1482;
 *  - 0007:44-54 -> seeded COA: 1110/1120/1130/1140 (assets), 2100 (Suppliers/
 *    Payables — NOT bonus liability), 4000 (Revenue, exists), 5000 (COGS), 6000
 *    (Expense); NO 2xxx bonus-liability account (Phase-49 §5.2 line 484/485);
 *  - docs/opencode/PHASE-49 §3.13, §5.2, §6.3, §11 (T-1..3 / R-1..3), ACC-07,
 *    ACC-08, ACC-10, ACC-14, §8.4 (reversal-timing), §3.11 E11.
 */

import { getPolicy } from './accountingPolicies.ts';

// ── Keys ───────────────────────────────────────────────────────────────────
/** Live director-chosen policy for Bonus Expiration (BD-06). */
export const BD06_POLICY_KEY = 'accounting_policy.BD-06';
/**
 * Per-expiration historical snapshot prefix; the suffix is the EXPIRATION
 * row's bonus_ledger.id (the TRUE BD-06 event identity). Shared namespace with
 * BD-01..BD-05 snapshots (suffix = globally-unique bonus_ledger.id), so a
 * redemption snapshot can never collide with an expiration snapshot.
 */
export const BD06_SNAPSHOT_PREFIX = 'accounting_policy.snapshot.';

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

// ── BD-06-specific gaps (additive; BD-01..BD-05 files untouched) ──────────────
/**
 * BD-08 (publish / sweep timing) is a SEPARATE, un-decided policy. The BD-06
 * *event boundary* is fixed by the lifecycle (the EXPIRATION row inserted by
 * `expire_bonus`), but WHEN the resulting accounting entry would be published is
 * not — so the engine records the boundary but surfaces this rather than
 * assuming a publish clock.
 */
export const TIMING_POLICY_REQUIRED = 'TIMING_POLICY_REQUIRED';

// ── BD-06 option letters (from the registry, not a literal) ──────────────────
export type Bd06Option = string;
export const BD06_OPTIONS: readonly string[] = (() => {
  const policy = getPolicy('BD-06');
  return policy ? Object.freeze(policy.options.map((o) => o.value)) : [];
})();

// ── Inputs / outputs ─────────────────────────────────────────────────────────
/**
 * The TRUE identity of a Bonus Expiration event — the schema's `bonus_ledger`
 * row whose `txn_type = 'EXPIRATION'` (created by `expire_bonus`, 0018:1466-1471).
 * This is the event's identity, NOT account_id / order_id / customer_id.
 *
 * - `ledgerId`: the EXPIRATION row's `bonus_ledger.id` (the row `expire_bonus`
 *   just inserted — the auditable expiration subject; its snapshot, idempotency
 *   and source-trace key).
 * - `originalLedgerId`: the original EARN lot's `bonus_ledger.id`, carried as
 *   the `reverses_id` reference (a link, NOT the expiration's identity — BD-06's
 *   snapshot is on the EXPIRATION id, never the EARN id, so BD-01's earn
 *   snapshot is structurally untouched).
 */
export interface ExpirationIdentity {
  /** `bonus_ledger.id` of the EXPIRATION row (the TRUE BD-06 event identity). */
  ledgerId: string;
  /** `bonus_ledger.id` of the original EARN lot (the EXPIRATION row's `reverses_id`). */
  originalLedgerId: string;
  /** `orders.id` carried by the original EARN (source-trace context only). */
  orderId?: string | null;
  /**
   * EXPIRATION rows are inserted with idempotency_key = NULL (dedup is by
   * `reverses_id`); carried only if a caller supplies one.
   */
  idempotencyKey?: string | null;
  /** `bonus_ledger.account_id` (bonus_accounts.user_id) the expiry settled against. */
  accountId?: string | null;
}

export interface ExpirationAccountingContext {
  /** Real identity of the expiration (drives idempotency + snapshot key). */
  identity: ExpirationIdentity;
  /** 'POSTED' — 0018:1470. */
  status: string;
  /** Best-effort current financial company (C-3 single-company assumption). */
  companyId?: string | null;
  /** abs(EXPIRATION.amount) = the extinguished remainder (0018:1470: `-v_rem`). */
  expiredAmount?: number | null;
  /** abs(original EARN.amount). Context only — never recomputed by the engine. */
  originalEarnAmount?: number | null;
}

/**
 * Account ROLE, not code. Resolved to a `financial_accounts.code` by a future,
 * authorised account-mapping step. The engine NEVER invents a code:
 *   - 'bonus_liability' = the 2xxx deferred bonus-liability account (ABSENT —
 *     Phase-49 §5.2 line 484; 0007:42-54). 2100 (Suppliers/Payables) is NOT a
 *     substitute — its semantic purpose is supplier payables, not a bonus
 *     liability (directive item 9).
 *   - 'revenue' = 4000 الإيرادات (EXISTS, 0007:52) — only reachable under option C,
 *     and only as an explicit owner choice, NEVER as a default.
 *   - 'clearing' = an ACC-05 clearing/wallet account (ABSENT).
 */
export interface ExpirationAccountRole {
  role: 'bonus_liability' | 'revenue' | 'clearing';
  code?: undefined;
}

/**
 * The concrete accounting effect chosen for this expiration.
 *  - no_entry      : A — expired bonus is extinguished in the subledger only; no
 *                    journal. Realisable today (Phase-49 §3.13).
 *  - would_post    : B/C intent — the director's option expresses intent to post;
 *                    `code` is the gap that BLOCKS posting today
 *                    (ACCOUNT_MAPPING_REQUIRED — no 2xxx bonus-liability account).
 *                    `journalEntryId` is always null.
 *  - fail_closed   : unconfigured / invalid policy (no journal).
 */
export type ExpirationEffect =
  | { kind: 'no_entry'; reason: string }
  | {
      kind: 'would_post';
      intendedAccounts: ExpirationAccountRole[];
      code: typeof ACCOUNT_MAPPING_REQUIRED;
      reason: string;
      basis: 'liability_contra' | 'revenue_writeback';
    }
  | { kind: 'fail_closed'; code: string; reason: string };

export interface ExpirationDecision {
  /** BD-06 option resolved at expiration time (null only when resolution failed). */
  option: string | null;
  effect: ExpirationEffect;
  /** journal_entry.id if one were actually created (null today for BD-06). */
  journalEntryId: string | null;
  /** Stable idempotency key for THIS expiration's accounting effect. */
  effectKey: string;
  /** Did a snapshot already exist for this expiration when we got here? */
  alreadyHadPolicySnapshot: boolean;
  /** Gaps / warnings accompanying the decision. */
  diagnostics: string[];
  /**
   * Source-trace shape anchored on the EXPIRATION row. `reversesIdPresent` is
   * TRUE for BD-06 (expire_bonus writes reverses_id to the EARN lot, 0018:1471),
   * which is what distinguishes BD-06 from BD-05 (whose 0026 REFUND writes none).
   */
  sourceTrace: {
    sourceTable: 'bonus_ledger';
    sourceId: string;
    documentType: 'bonus_expiration';
    ledgerId: string;
    originalLedgerId: string;
    orderId: string | null;
    accountId: string | null;
    reversesIdPresent: boolean;
  };
}

/** Storage abstraction reused from BD-01 (bonus_settings read/write). */
export type ExpirationDeps = BonusEarnDeps;

// ── 1. Resolve the CURRENT live policy (fail-closed, no default) ───────────────
/**
 * Reads `accounting_policy.BD-06` from settings and validates it against BD-06's
 * registered option set {A,B,C} (from `accountingPolicies.ts`).
 *
 * Throws `ACCOUNTING_POLICY_NOT_CONFIGURED` / `INVALID_ACCOUNTING_POLICY` — the
 * caller decides how to surface it; this function NEVER substitutes a default
 * option (no "assume A" fallback).
 *
 * Company note: `bonus_settings` carries NO `company_id` (0018 DDL; Phase-49
 * §1.4 fault line), so the read is global. Passing a `companyId` produces a
 * `COMPANY_POLICY_ISOLATION_GAP` diagnostic rather than a silent cross-company
 * read — the verified ACC-10 gap.
 */
export async function resolveBonusExpirationAccountingPolicy(
  deps: ExpirationDeps,
  companyId?: string | null,
): Promise<{ option: string; diagnostics: string[] }> {
  const raw = await deps.readSetting(BD06_POLICY_KEY);
  if (raw == null || raw === '') {
    throw new PolicyResolutionError(
      POLICY_NOT_CONFIGURED,
      'BD-06 is not configured; refusing to assume a policy.',
    );
  }
  const candidate = String(raw);
  if (!BD06_OPTIONS.includes(candidate)) {
    throw new PolicyResolutionError(
      POLICY_INVALID,
      `BD-06 option "${candidate}" is not one of the registered alternatives (${BD06_OPTIONS.join(', ') || 'none'}).`,
    );
  }
  const diagnostics: string[] = [];
  if (companyId) {
    diagnostics.push(COMPANY_POLICY_ISOLATION_GAP);
  }
  return { option: candidate, diagnostics };
}

// ── 2. Snapshot the policy in force for THIS expiration (history protection) ───
/**
 * Persists `accounting_policy.snapshot.<expirationLedgerId>` = option via the
 * existing director-writable `bonus_settings` (no new table, no migration).
 * Idempotent: if a snapshot already exists for this expiration's TRUE identity it
 * is left untouched, so a later setting change can never rewrite an expiration's
 * recorded policy.
 *
 * The key is the EXPIRATION row's `bonus_ledger.id` — NOT the original EARN id —
 * so BD-01's earn snapshot (`accounting_policy.snapshot.<earnLedgerId>`) is
 * structurally untouched (directive item 5).
 */
export async function snapshotBonusExpirationPolicy(
  expirationLedgerId: string,
  option: string,
  deps: ExpirationDeps,
): Promise<{ written: boolean }> {
  const key = `${BD06_SNAPSHOT_PREFIX}${expirationLedgerId}`;
  const existing = await deps.readSetting(key);
  if (existing != null) return { written: false };
  await deps.upsertSetting(key, option);
  return { written: true };
}

/** Which BD-06 option was in force when this expiration was processed. */
export async function getHistoricalBonusExpirationPolicy(
  expirationLedgerId: string,
  deps: ExpirationDeps,
): Promise<{ option: string | null; source: 'snapshot' | 'none' }> {
  const raw = await deps.readSetting(`${BD06_SNAPSHOT_PREFIX}${expirationLedgerId}`);
  if (raw == null) return { option: null, source: 'none' };
  const opt = String(raw);
  return { option: BD06_OPTIONS.includes(opt) ? opt : null, source: 'snapshot' };
}

// ── 3. Dispatch A / B / C for this expiration (fail-closed, no journal) ─────────
/**
 * Resolve the current BD-06 policy, snapshot it for THIS expiration, and return
 * the concrete accounting effect. Does NOT mutate bonus_ledger (the EXPIRATION
 * row was already written server-side by `expire_bonus`, 0018:1466-1471); does
 * NOT create journal entries (`create_financial_journal_entry` /
 * `post_financial_journal_entry` are not called — the engine never fabricates a
 * journal).
 *
 * Per-option, grounded in PHASE-49 ACC-07 (expiry outcome) + §5.2 + the seeded
 * COA (0007:44-54):
 *   A (no entry / write-off): the expired lot is extinguished in the subledger
 *     via the reverses_id-linked EXPIRATION row; NO journal is recorded. This is
 *     the current system behavior (Phase-49 §3.13: "an expired liability that
 *     disappears generates no entry"). A realisable `no_entry`. No accounts → no
 *     account gap.
 *   B (liability contra, no revenue): DR bonus_liability (2xxx) to offset the
 *     original EARN's deferred liability. The 2xxx bonus-liability account does
 *     NOT exist (0007:42-54; Phase-49 §5.2 line 484) -> would_post INTENT, fails
 *     CLOSED on ACCOUNT_MAPPING_REQUIRED. No account invented; no journal.
 *   C (revenue write-back, EXPLICIT owner option / ACC-14): DR bonus_liability
 *     (2xxx, ABSENT) / CR revenue (4000, EXISTS 0007:52). 4000 is the only
 *     mapped role, but a journal cannot post single-sided, so C fails CLOSED on
 *     ACCOUNT_MAPPING_REQUIRED. REVENUE IS AN EXPLICIT OWNER OPTION, NEVER a
 *     default — it is only reachable when the director selects C; A (no entry)
 *     never introduces or implies revenue anywhere.
 *
 * BD-08 timing is NOT consulted (separate policy); this engine is async only to
 * leave a seam for a future publish-timing gate (TIMING_POLICY_REQUIRED).
 *
 * Idempotency: snapshot keyed by the EXPIRATION row's TRUE identity
 * (bonus_ledger.id) and written once; re-dispatch yields
 * `alreadyHadPolicySnapshot: true`. At the DB level, `expire_bonus` dedups via
 * `ON CONFLICT (reverses_id)` + `bonus_ledger_reverses_uniq` (0018:171-174),
 * so the EXPIRATION row itself is created at most once per EARN lot.
 */
export async function applyBonusExpirationAccounting(
  ctx: ExpirationAccountingContext,
  deps: ExpirationDeps,
): Promise<ExpirationDecision> {
  const { ledgerId, originalLedgerId, orderId, idempotencyKey: _idempotencyKey, accountId } =
    ctx.identity;
  const effectKey = `bd06:expiration:${ledgerId}`;
  const sourceTrace = {
    sourceTable: 'bonus_ledger' as const,
    sourceId: ledgerId,
    documentType: 'bonus_expiration' as const,
    ledgerId,
    originalLedgerId,
    orderId: orderId ?? null,
    accountId: accountId ?? null,
    // BD-06: the EXPIRATION row carries reverses_id -> its EARN lot is traceable.
    reversesIdPresent: true,
  };

  // (1) Resolve current live policy — fail closed (no default).
  let option: string;
  let resolveDiagnostics: string[] = [];
  try {
    const resolved = await resolveBonusExpirationAccountingPolicy(deps, ctx.companyId);
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

  // (2) Snapshot the policy in force for THIS expiration (idempotent, history-safe).
  const snap = await snapshotBonusExpirationPolicy(ledgerId, option, deps);

  // (3) Dispatch A / B / C. BD-08 timing NOT consulted; BD-06 event boundary is
  //     the EXPIRATION row insertion (0018:1466-1471).
  const baseDiagnostics = [
    ...resolveDiagnostics,
    ACCOUNTING_NOT_POSTED,
    BONUS_GL_ATOMICITY_GAP,
    TIMING_POLICY_REQUIRED,
  ];

  if (option === 'A') {
    // No entry: the expired lot is extinguished in the subledger only (current
    // behavior, Phase-49 §3.13). Realisable today; no accounts, no journal.
    return {
      option,
      effect: {
        kind: 'no_entry',
        reason:
          `BD-06 Option A (بدون إدخال / no entry): the aged EARN lot is extinguished ` +
          `in bonus_ledger via the reverses_id-linked EXPIRATION row (` +
          `reverses_id=${originalLedgerId}, 0018:1471) with NO accounting journal — ` +
          `the current system behavior (Phase-49 §3.13: "an expired liability that ` +
          `disappears generates no entry"). A does NOT introduce revenue; the lot is ` +
          `simply removed from the customer's derived balance via bonus_credit_remaining ` +
          `(0018:464-470).`,
      },
      journalEntryId: null,
      effectKey,
      alreadyHadPolicySnapshot: !snap.written,
      diagnostics: [...resolveDiagnostics],
      sourceTrace,
    };
  }

  if (option === 'B') {
    // Liability contra (no revenue): DR bonus_liability (2xxx) to offset the
    // expired liability. No 2xxx account exists -> fail closed.
    const intendedAccounts: ExpirationAccountRole[] = [{ role: 'bonus_liability' }];
    return {
      option,
      effect: {
        kind: 'would_post',
        intendedAccounts,
        code: ACCOUNT_MAPPING_REQUIRED,
        reason:
          `${ACCOUNT_MAPPING_REQUIRED}: BD-06 Option B (تخفيض التزام / مقابض مضادة، ` +
          `بدون إيراد / reduce liability via contra, NO revenue) would post DR ` +
          `bonus_liability to offset the expired EARN's deferred liability ` +
          `(${originalLedgerId}). The 2xxx bonus-liability account does NOT exist ` +
          `in the seeded chart of accounts (0007:42-54; Phase-49 §5.2 line 484: "No ` +
          `customer-bonus liability account exists"; 2100 is Suppliers/Payables — ` +
          `NOT a bonus liability, directive item 9). The engine NEVER invents an ` +
          `account; no journal is fabricated.`,
        basis: 'liability_contra',
      },
      journalEntryId: null,
      effectKey,
      alreadyHadPolicySnapshot: !snap.written,
      diagnostics: [...baseDiagnostics, ACCOUNT_MAPPING_REQUIRED],
      sourceTrace,
    };
  }

  if (option === 'C') {
    // Revenue write-back (EXPLICIT owner option / ACC-14): DR bonus_liability
    // (2xxx, ABSENT) / CR revenue (4000, EXISTS). Single-sided -> fail closed.
    // REVENUE IS NOT A DEFAULT: only reached when the director selects C.
    const intendedAccounts: ExpirationAccountRole[] = [
      { role: 'bonus_liability' }, // 2xxx — ABSENT
      { role: 'revenue' }, // 4000 الإيرادات (EXISTS, 0007:52)
    ];
    return {
      option,
      effect: {
        kind: 'would_post',
        intendedAccounts,
        code: ACCOUNT_MAPPING_REQUIRED,
        reason:
          `${ACCOUNT_MAPPING_REQUIRED}: BD-06 Option C (إيراد بالتحويل / revenue ` +
          `write-back, ACC-14/D7 — EXPLICIT OWNER OPTION, never automatic) would ` +
          `post DR bonus_liability (the expired 2xxx liability — ABSENT, Phase-49 §5.2 ` +
          `line 484) / CR revenue (4000 — EXISTS, 0007:52). 4000 is the only mapped ` +
          `role, but a journal cannot post single-sided; the debit-side bonus-liability ` +
          `account is missing. REVENUE IS NOT A DEFAULT: C is only reachable when the ` +
          `director explicitly selects it, and A (no entry) never introduces or implies ` +
          `revenue anywhere. No account invented; no journal fabricated.`,
        basis: 'revenue_writeback',
      },
      journalEntryId: null,
      effectKey,
      alreadyHadPolicySnapshot: !snap.written,
      diagnostics: [...baseDiagnostics, ACCOUNT_MAPPING_REQUIRED],
      sourceTrace,
    };
  }

  // Exhaustive over the registered option set. The resolver already guaranteed
  // option ∈ BD06_OPTIONS ({A,B,C}); this branch is unreachable defensive code.
  return {
    option,
    effect: {
      kind: 'fail_closed',
      code: POLICY_INVALID,
      reason: `${POLICY_INVALID}: BD-06 option "${option}" is registered but has no dispatch branch.`,
    },
    journalEntryId: null,
    effectKey,
    alreadyHadPolicySnapshot: !snap.written,
    diagnostics: [...baseDiagnostics, ACCOUNT_MAPPING_REQUIRED],
    sourceTrace,
  };
}
