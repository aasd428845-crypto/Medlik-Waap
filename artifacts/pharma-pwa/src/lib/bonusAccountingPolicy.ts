/**
 * BD-01 BONUS EARN — Dynamic, director-controlled accounting-policy engine.
 *
 * ⚠️ SCOPE (and the hard boundary of it)
 *   This is the FIRST accounting-integration step and covers BD-01 (Bonus Earn)
 *   ONLY. BD-02..BD-10 are explicitly NOT implemented here — see the dispatch
 *   below, which has a behaviour branch for BD-01's options only.
 *
 *   The director chooses the option from the existing Control Center UI
 *   (AccountingSection.tsx → `accounting_policy.BD-01`). This engine READS that
 *   choice at runtime — it never hard-codes an option and never falls back to a
 *   silent default. Changing the setting changes ONLY subsequently-earned
 *   bonuses; history is protected by a per-earn policy snapshot.
 *
 * This module is PURE: it imports only `accountingPolicies.ts` (pure data) and
 * is fully unit-testable with an in-memory fake store (see
 * `bonusAccountingPolicy.test.ts`). The Supabase wiring lives in the separate
 * `bonusAccountingPolicyLive.ts` so importing the engine never initialises a
 * client.
 *
 * Sources of truth consumed (verified, not assumed):
 *   - `accountingPolicies.ts`  → BD-01 option set {A,B,C} (single source).
 *   - `0018_bonus_financial_system.sql` → `bonus_settings` (key/value, director
 *     `for all` RLS; NO `company_id` — PHASE-49 §1.4 fault line), `bonus_ledger`
 *     (identity `id` + unique `idempotency_key`; POSTED rows immutable, 0018:98-112),
 *     `bonus_audit_trail` (SELECT-only, no INSERT policy).
 *   - `0019_bonus_earn_engine.sql` → E2 `earn_bonus` returns `bonus_ledger.id`;
 *     E1 `bonus_on_order_delivered`→`bonus_evaluate_order_earn` is server-side.
 *   - `0006_financial_core.sql` / `0010_financial_simple_entries.sql` →
 *     `create_financial_journal_entry` exists + granted to `authenticated`,
 *     but no bonus account codes exist in the seeded COA (`0007:38-59`).
 *   - PHASE-49 §1 (zero bonus→financial wiring), §4.3 (E1/E2 are
 *     BUSINESS POLICY REQUIRED / TECHNICAL GAP), §10 ACC-01.
 */

import { getPolicy } from './accountingPolicies.ts';

// ── Keys ───────────────────────────────────────────────────────────────
/** Live director-chosen policy for Bonus Earn (BD-01). */
export const BD01_POLICY_KEY = 'accounting_policy.BD-01';
/** Per-earn historical snapshot prefix; the suffix is the bonus_ledger.id. */
export const BD01_SNAPSHOT_PREFIX = 'accounting_policy.snapshot.';

// ── Fail-closed sentinels (asserted on by tests + callers) ─────────────
export const POLICY_NOT_CONFIGURED = 'ACCOUNTING_POLICY_NOT_CONFIGURED';
export const POLICY_INVALID = 'INVALID_ACCOUNTING_POLICY';
export const ACCOUNT_MAPPING_REQUIRED = 'ACCOUNT_MAPPING_REQUIRED';
export const COMPANY_POLICY_ISOLATION_GAP = 'COMPANY_POLICY_ISOLATION_GAP';
export const ACCOUNTING_NOT_POSTED = 'ACCOUNTING_NOT_POSTED';
export const BONUS_GL_ATOMICITY_GAP = 'BONUS_GL_ATOMICITY_GAP';

/**
 * BD-01 option letter, derived from the BD-01 policy definition in
 * `accountingPolicies.ts` (single source of truth — not a hard-coded literal).
 */
export type Bd01Option = string;
export const BD01_OPTIONS: readonly string[] = getBd01Options();

function getBd01Options(): readonly string[] {
  const policy = getPolicy('BD-01');
  return policy ? Object.freeze(policy.options.map((o) => o.value)) : [];
}

// ── Inputs / outputs ───────────────────────────────────────────────────
/**
 * The real identity of a Bonus Earn event — the engine keys all idempotency
 * and snapshot work on this, never on a synthetic surrogate.
 *
 * - `ledgerId`: `bonus_ledger.id` (returned by the `earn_bonus` RPC for E2,
 *   and the immutable identity of an E1 subledger row).
 * - `idempotencyKey`: `bonus_ledger.idempotency_key` (alternate unique key,
 *   e.g. `'SALES_EARN:<order_id>:<rule_id>'` for E1).
 */
export interface BonusEarnIdentity {
  ledgerId: string;
  idempotencyKey?: string | null;
  orderId?: string | null;
}

export interface EarnAccountingContext {
  /** Real identity of the earn (drives idempotency + snapshot key). */
  identity: BonusEarnIdentity;
  /** Best-effort current financial company (C-3 single-company assumption). */
  companyId?: string | null;
  ruleId?: string | null;
  amount?: number | null;
}

/**
 * Account ROLE, not code. Resolved to a `financial_accounts.code` by a future,
 * authorised account-mapping step. The engine NEVER invents a code — for BD-01
 * A/B the role has no mapped code today, which is the fail-closed gap.
 */
export interface AccountRole {
  /** Generalised role name (any non-empty string); resolved to a financial_accounts.code
   *  by the director's 0029 designation. The engine NEVER invents a code. */
  role: string;
  /** Which side of the journal this leg sits on. */
  leg: 'debit' | 'credit';
  /** Resolved GL account code, or null when unmapped (ACCOUNT_MAPPING_REQUIRED). */
  code?: string | null;
}

/** The concrete accounting effect chosen for this earn (never a default). */
export type EarnEffect =
  | { kind: 'no_entry'; reason: string } // BD-01 C — realisable today
  | { kind: 'would_post'; intendedAccounts: AccountRole[]; code: typeof ACCOUNT_MAPPING_REQUIRED; reason: string } // A/B intent
  | { kind: 'fail_closed'; code: string; reason: string }; // unconfigured / invalid / no accounts

export interface BonusEarnDecision {
  /** BD-01 option resolved at earn time (null only when resolution failed). */
  option: string | null;
  effect: EarnEffect;
  /** journal_entry.id if one was actually created (null today for BD-01). */
  journalEntryId: string | null;
  /** Stable idempotency key for THIS earn's accounting effect. */
  effectKey: string;
  /** Did a snapshot already exist for this earn when we got here? */
  alreadyHadPolicySnapshot: boolean;
  /** Gaps / warnings accompanying the decision. */
  diagnostics: string[];
  /** Source-trace shape wired for the future poster (not live today). */
  sourceTrace: { sourceTable: 'bonus_ledger'; sourceId: string; documentType: 'bonus_earn' };
}

/** Outcome of running the engine alongside a Bonus Earn (E2). */
export interface EarnWithAccountingResult {
  /** The bonus_ledger row created by the earn, regardless of option. */
  ledgerId: string;
  ledgerStatus: 'POSTED';
  /** The BD-01 accounting decision for this earn. */
  accounting: BonusEarnDecision;
}

// ── Storage abstraction (injectable → tests run with an in-memory fake) ─
export interface BonusEarnDeps {
  /** Read the raw jsonb value of one bonus_settings key (or null). */
  readSetting: (key: string) => Promise<unknown>;
  /** Upsert one bonus_settings key (director RLS allows this). */
  upsertSetting: (key: string, value: unknown) => Promise<void>;
}

// ── Errors ─────────────────────────────────────────────────────────────
export class PolicyResolutionError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'PolicyResolutionError';
    this.code = code;
  }
}

// ── 1. Resolve the CURRENT live policy (fail-closed, no default) ─────────
/**
 * Reads `accounting_policy.BD-01` from settings and validates it against
 * BD-01's registered option set (from `accountingPolicies.ts`).
 *
 * Throws `ACCOUNTING_POLICY_NOT_CONFIGURED` / `INVALID_ACCOUNTING_POLICY` —
 * the caller decides how to surface it; this function NEVER substitutes a
 * default option (no "assume B" fallback).
 *
 * Company note: `bonus_settings` carries NO `company_id` (0018 DDL; PHASE-49
 * §1.4 fault line), so the read is global. Passing a `companyId` produces a
 * `COMPANY_POLICY_ISOLATION_GAP` diagnostic rather than a silent cross-company
 * read — the verified ACC-10 gap, surfaced rather than papered over.
 */
export async function resolveBonusEarnAccountingPolicy(
  deps: BonusEarnDeps,
  companyId?: string | null,
): Promise<{ option: string; diagnostics: string[] }> {
  const raw = await deps.readSetting(BD01_POLICY_KEY);
  if (raw == null || raw === '') {
    throw new PolicyResolutionError(
      POLICY_NOT_CONFIGURED,
      'BD-01 is not configured; refusing to assume a policy.',
    );
  }
  const candidate = String(raw);
  if (!BD01_OPTIONS.includes(candidate)) {
    throw new PolicyResolutionError(
      POLICY_INVALID,
      `BD-01 option "${candidate}" is not one of the registered alternatives (${BD01_OPTIONS.join(', ') || 'none'}).`,
    );
  }
  const diagnostics: string[] = [];
  if (companyId) {
    diagnostics.push(COMPANY_POLICY_ISOLATION_GAP);
  }
  return { option: candidate, diagnostics };
}

// ── 2. Snapshot the policy in force for THIS earn (history protection) ───
/**
 * Persists `accounting_policy.snapshot.<ledgerId>` = option via the existing
 * director-writable `bonus_settings` (no new table, no migration). Idempotent:
 * if a snapshot already exists for this earn identity it is left untouched, so
 * a later setting change can never rewrite an earn's recorded policy.
 */
export async function snapshotBonusEarnPolicy(
  ledgerId: string,
  option: string,
  deps: BonusEarnDeps,
): Promise<{ written: boolean }> {
  const key = `${BD01_SNAPSHOT_PREFIX}${ledgerId}`;
  const existing = await deps.readSetting(key);
  if (existing != null) return { written: false };
  await deps.upsertSetting(key, option);
  return { written: true };
}

/** Which BD-01 option was in force when this earn was processed. */
export async function getHistoricalBonusEarnPolicy(
  ledgerId: string,
  deps: BonusEarnDeps,
): Promise<{ option: string | null; source: 'snapshot' | 'none' }> {
  const raw = await deps.readSetting(`${BD01_SNAPSHOT_PREFIX}${ledgerId}`);
  if (raw == null) return { option: null, source: 'none' };
  const opt = String(raw);
  return { option: BD01_OPTIONS.includes(opt) ? opt : null, source: 'snapshot' };
}

// ── 3. Dispatch A / B / C for this earn (no posting engine; fail-closed) ─
/**
 * Resolve the current BD-01 policy, snapshot it for this earn, and return the
 * concrete accounting effect. Does NOT mutate the bonus ledger (the earn row is
 * created server-side by `earn_bonus`); does NOT create journal entries.
 *
 * Semantics per option, grounded in PHASE-49 ACC-01 ("liability / expense /
 * nothing until redemption") as encoded in `accountingPolicies.ts` BD-01:
 *   - A (liability at grant) → intent: DR ??? / CR bonus liability. No bonus
 *     liability account exists in the seeded COA (0007:41-59) → fail-closed
 *     ACCOUNT_MAPPING_REQUIRED. No journal is fabricated.
 *   - B (expense at grant)  → intent: DR bonus expense / CR ???. No bonus
 *     expense account exists → fail-closed ACCOUNT_MAPPING_REQUIRED.
 *   - C (nothing until redemption) → no entry. Realisable today; executed.
 *
 * BD-08 timing is deliberately NOT consulted (separate policy — see Rule 13);
 * the function is `async` only to leave a seam for a future timing gate.
 *
 * Idempotency: the snapshot is keyed by the real `ledgerId` and written once;
 * re-dispatching the same earn yields `alreadyHadPolicySnapshot: true` and
 * `NO_DUPLICATE_EFFECT` (no second journal, because none is ever created for
 * BD-01 today). The underlying `bonus_ledger.idempotency_key` (0018:73) makes
 * the earn itself idempotent at the database level.
 */
export async function applyBonusEarnAccounting(
  ctx: EarnAccountingContext,
  deps: BonusEarnDeps,
): Promise<BonusEarnDecision> {
  const { ledgerId } = ctx.identity;
  const effectKey = `bd01:earn:${ledgerId}`;
  const sourceTrace = {
    sourceTable: 'bonus_ledger' as const,
    sourceId: ledgerId,
    documentType: 'bonus_earn' as const,
  };

  // (1) Resolve current live policy — fail closed (no default).
  let option: string;
  let resolveDiagnostics: string[] = [];
  try {
    const resolved = await resolveBonusEarnAccountingPolicy(deps, ctx.companyId);
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

  // (2) Snapshot the policy in force for THIS earn (idempotent, history-safe).
  const snap = await snapshotBonusEarnPolicy(ledgerId, option, deps);

  // (3) Dispatch per option. BD-08 timing is intentionally NOT applied here.
  if (option === 'C') {
    return {
      option,
      effect: {
        kind: 'no_entry',
        reason:
          'BD-01 Option C — no accounting recognition at grant (owner-decided policy, ACC-01). No journal created by design.',
      },
      journalEntryId: null,
      effectKey,
      alreadyHadPolicySnapshot: !snap.written,
      diagnostics: [...resolveDiagnostics],
      sourceTrace,
    };
  }

  // A / B: would post a journal with a configurable debit leg + credit leg (the
  // layout is director-configured via 0029 bonus_journal_leg_mapping; this pure
  // engine mirrors the canonical BD-01 intent). Both legs are unmapped until the
  // director binds each role to a GL account — ACCOUNT_MAPPING_REQUIRED, never fabricated.
  const intendedAccounts: AccountRole[] =
    option === 'A'
      ? [
          { role: 'cash', leg: 'debit', code: undefined },
          { role: 'deferred_bonus_liability', leg: 'credit', code: undefined },
        ]
      : [
          { role: 'bonus_expense', leg: 'debit', code: undefined },
          { role: 'cash', leg: 'credit', code: undefined },
        ];

  return {
    option,
    effect: {
      kind: 'would_post',
      intendedAccounts,
      code: ACCOUNT_MAPPING_REQUIRED,
      reason:
        `${ACCOUNT_MAPPING_REQUIRED}: option ${option} would post via ` +
        `${intendedAccounts.map((a) => `${a.role}(${a.leg})`).join(', ')}, ` +
        `but the roles are not mapped to GL accounts (director-configurable via ` +
        `bonus_role_account_map + bonus_journal_leg_mapping) — refusing to fabricate a code.`,
    },
    journalEntryId: null,
    effectKey,
    alreadyHadPolicySnapshot: !snap.written,
    diagnostics: [...resolveDiagnostics, ACCOUNTING_NOT_POSTED, BONUS_GL_ATOMICITY_GAP],
    sourceTrace,
  };
}
