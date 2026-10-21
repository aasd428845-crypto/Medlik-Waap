/**
 * BD-02 BONUS CASH WITHDRAWAL — Dynamic, director-controlled accounting-policy engine.
 *
 * SCOPE (and the hard boundary): BD-02 only. BD-03..BD-10 are NOT implemented.
 * BD-01 is the architectural reference; this module mirrors its pure pattern for
 * the withdrawal (payment) leg. It is PURE (imports only accountingPolicies.ts
 * and the shared fail-closed sentinels from bonusAccountingPolicy.ts) and is
 * unit-testable offline with an in-memory fake store.
 *
 * CORE RULE honored literally:
 *   - The policy is NEVER chosen by code. `accounting_policy.BD-02` is read LIVE
 *     at withdrawal time and validated against the BD-02 option set registered in
 *     accountingPolicies.ts. No `const BD02_POLICY = …`, no `policy ?? "A"` default.
 *   - Missing policy → ACCOUNTING_POLICY_NOT_CONFIGURED; invalid value →
 *     INVALID_ACCOUNTING_POLICY; both FAIL CLOSED (no journal fabricated).
 *   - A director change A→B affects ONLY subsequently-withdrawn cash; a withdrawal's
 *     recorded policy is locked at processing time via a per-withdrawal snapshot.
 *
 * Sources of truth (verified in-repo, not assumed):
 *  - accountingPolicies.ts -> BD-02 options {A,B} (ACC-04 is binary; NO C —
 *    §11 lists C only for ACC-01/§11.5/ACC-07/§11.1/§11.3/§11.4; BD-02 not
 *    among them. C is NOT invented here — directive item 6.)
 *  - 0018_bonus_financial_system.sql:
 *      bonus_withdrawals (id uuid PK, amount, status check in
 *        (PENDING|UNDER_REVIEW|APPROVED|REJECTED|PAID|COMPLETED|CANCELLED),
 *        ledger_id -> bonus_ledger(id), idempotency_key text UNIQUE,
 *        NO company_id — PHASE-49 §1.4 fault line)
 *      -> withdrawal TRUE identity = bonus_withdrawals.id (NOT assumed as
 *         bonus_ledger.id; ledger_id is the subledger debit anchor for source-trace).
 *      request_withdrawal (1044)        : client; creates PENDING withdrawal + a
 *        PENDING CASH_WITHDRAWAL bonus_ledger row; idempotency via
 *        bonus_withdrawals.idempotency_key (1112-1116).
 *      review_withdrawal (1185)         : director APPROVED/REJECTED (reject deletes
 *        the PENDING reservation). No ledger change on approve.
 *      mark_withdrawal_paid (1244)      : director; flips the PENDING ledger row
 *        -> POSTED (exactly-one guard, abort otherwise); sets PAID + payment fields.
 *        THIS is the accounting-affecting moment (cash leaves).
 *      complete_withdrawal (1296)       : PAID -> COMPLETED (terminal bookkeeping).
 *  - 0007_financial_setup_rls.sql:38-59 : seeded COA. 1110 (Cash) + 1120 (Bank)
 *      EXIST, but the only postable liability is 2100 (payables/suppliers —
 *      semantically wrong, NOT reused) and there is NO Bonus Liability account
 *      and NO Bonus Expense account.
 *  - PHASE-49 §3.6 E4 (line 228), ACC-04 (739), ACC-05 (740), ACC-10 (745),
 *    §11.2 R-1 (771: financial_documents.source_table='bonus_ledger' + source_id),
 *    §4.3 E4 consequence (239: cash codes exist 0007:44-45 but no bonus path
 *    references them).
 *
 * Timing boundary (BD-08 NOT consulted): the policy fires at the PAYMENT leg
 * (mark_withdrawal_paid, ledger PENDING->POSTED). The request (PENDING) and the
 * approve (APPROVED) create no accounting entry.
 *
 * No journal is ever created here: BD-02 A and B both require a Bonus Liability
 * account (absent) AND an unmapped Cash/Bank leg (ACC-05 / exposure X1), so both
 * resolve to would_post + ACCOUNT_MAPPING_REQUIRED and STAY fail-closed. No C
 * exists in the registry, so there is no no_entry branch (no invented option).
 *
 * Idempotency: snapshot keyed on the withdrawal's TRUE identity
 * (bonus_withdrawals.id), written once; re-processing the same withdrawal is a
 * no-op and must not emit a second journal. The withdrawal-level
 * idempotency_key (0018:246) + mark_withdrawal_paid's exactly-one-POSTED-flip
 * guard make the payment itself idempotent at the database level.
 */

import { getPolicy } from './accountingPolicies.ts';
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

// ── Shared settings-storage contract (reused from BD-01: read/write bonus_settings) ─
export type WithdrawalDeps = BonusEarnDeps;

// ── Keys ───────────────────────────────────────────────────────────────
export const BD02_POLICY_KEY = 'accounting_policy.BD-02';
/** Same namespace as BD-01 (one snapshot mechanism); suffix is the withdrawal's TRUE id. */
export const BD02_SNAPSHOT_PREFIX = 'accounting_policy.snapshot.';

// ── BD-02 option letters (from the registry, not a literal) ────────────
export const BD02_OPTIONS: readonly string[] = (() => {
  const policy = getPolicy('BD-02');
  return policy ? Object.freeze(policy.options.map((o) => o.value)) : [];
})();

// ── Inputs / outputs ───────────────────────────────────────────────────
/**
 * The TRUE identity of a Cash Withdrawal event, determined from the schema
 * (item 8 — not assumed as bonus_ledger.id):
 *   - withdrawalId : bonus_withdrawals.id  (the request — the event's true identity;
 *                                          snapshot key + idempotency anchor)
 *   - ledgerId     : bonus_ledger.id of the CASH_WITHDRAWAL row (subledger debit
 *                    anchor + future GL source-trace target, via
 *                    bonus_withdrawals.ledger_id -> bonus_ledger(id))
 *   - idempotencyKey : bonus_withdrawals.idempotency_key (withdrawal-level)
 */
export interface WithdrawalAccountingIdentity {
  withdrawalId: string;
  ledgerId?: string | null;
  idempotencyKey?: string | null;
  orderId?: string | null;
}

export interface WithdrawalAccountingContext {
  identity: WithdrawalAccountingIdentity;
  /** Payment-leg stage (BD-08 timing NOT consulted). */
  status: string;
  companyId?: string | null;
  amount?: number | null;
}

/**
 * Account ROLE, not code. The engine NEVER invents a code. For BD-02 the only
 * accounts in the seeded COA are 1110/1120 (cash/bank) and 2100 (payables) — none
 * of which is a deferred bonus liability — so both A and B stay unmapped.
 */
export interface WithdrawalAccountRole {
  role: 'deferred_bonus_liability' | 'cash_or_bank';
  code?: undefined;
}

/** The concrete accounting effect for this withdrawal. BD-02 has no C, so no
 *  `no_entry` branch exists (no invented option). */
export type WithdrawalEffect =
  | { kind: 'would_post'; intendedAccounts: WithdrawalAccountRole[]; code: typeof ACCOUNT_MAPPING_REQUIRED; reason: string }
  | { kind: 'fail_closed'; code: string; reason: string };

export interface BonusWithdrawalDecision {
  option: string | null;
  effect: WithdrawalEffect;
  /** journal_entry.id if one were actually created (null today for BD-02 A/B). */
  journalEntryId: string | null;
  effectKey: string;
  /** Did a snapshot already exist for this withdrawal when we got here? */
  alreadyHadPolicySnapshot: boolean;
  diagnostics: string[];
  /** Source-trace shape wired for the future poster (R-1: financial_documents
   *  source_table='bonus_ledger' + source_id), not live today. */
  sourceTrace: {
    sourceTable: 'bonus_ledger';
    sourceId: string;
    documentType: 'bonus_withdrawal';
    withdrawalId: string;
  };
}

// ── 1. Resolve the CURRENT live policy (fail-closed, no default) ────────
export async function resolveBonusWithdrawalAccountingPolicy(
  deps: WithdrawalDeps,
  companyId?: string | null,
): Promise<{ option: string; diagnostics: string[] }> {
  const raw = await deps.readSetting(BD02_POLICY_KEY);
  if (raw == null || raw === '') {
    throw new PolicyResolutionError(
      POLICY_NOT_CONFIGURED,
      'BD-02 is not configured; refusing to assume a policy.',
    );
  }
  const candidate = String(raw);
  if (!BD02_OPTIONS.includes(candidate)) {
    throw new PolicyResolutionError(
      POLICY_INVALID,
      `BD-02 option "${candidate}" is not one of the registered alternatives (${BD02_OPTIONS.join(', ') || 'none'}).`,
    );
  }
  const diagnostics: string[] = [];
  if (companyId) diagnostics.push(COMPANY_POLICY_ISOLATION_GAP); // bonus_withdrawals has no company_id
  return { option: candidate, diagnostics };
}

// ── 2. Snapshot the policy in force for THIS withdrawal (history safety) ─
export async function snapshotWithdrawalPolicy(
  withdrawalId: string,
  option: string,
  deps: WithdrawalDeps,
): Promise<{ written: boolean }> {
  const key = `${BD02_SNAPSHOT_PREFIX}${withdrawalId}`;
  const existing = await deps.readSetting(key);
  if (existing != null) return { written: false };
  await deps.upsertSetting(key, option);
  return { written: true };
}

export async function getHistoricalWithdrawalPolicy(
  withdrawalId: string,
  deps: WithdrawalDeps,
): Promise<{ option: string | null; source: 'snapshot' | 'none' }> {
  const raw = await deps.readSetting(`${BD02_SNAPSHOT_PREFIX}${withdrawalId}`);
  if (raw == null) return { option: null, source: 'none' };
  const opt = String(raw);
  return { option: BD02_OPTIONS.includes(opt) ? opt : null, source: 'snapshot' };
}

// ── 3. Dispatch A / B (no posting engine; fail-closed on missing accounts) ─
/**
 * BD-02 options (Phase-49 ACC-04 "liability settlement vs cash purchase of the
 * obligation"; ledger only removes value — PHASE-49:239):
 *   A (settle liability)               : DR deferred_bonus_liability / CR cash_or_bank.
 *   B (cash purchase of obligation)    : same movements, purchase framing
 *                                        (ACC-04: both internally consistent/
 *                                        numerically equivalent).
 *
 * BOTH require:
 *   - a Bonus Liability account: ABSENT from the seeded COA (0007:38-59; the only
 *     postable liability is 2100 payables/suppliers, semantically wrong — NOT
 *     reused).
 *   - an unmapped Cash/Bank leg: 1110/1120 exist, but 1110-vs-1120 and
 *     locked-vs-cleared is ACC-05 / exposure X1 — undecided.
 * Hence both resolve to would_post + ACCOUNT_MAPPING_REQUIRED and STAY fail-closed:
 * no journal is fabricating, no code is assumed.
 *
 * BD-08 timing is NOT applied (separate policy); async for a future timing seam.
 */
export async function applyBonusWithdrawalAccounting(
  ctx: WithdrawalAccountingContext,
  deps: WithdrawalDeps,
): Promise<BonusWithdrawalDecision> {
  const { withdrawalId, ledgerId } = ctx.identity;
  const effectKey = `bd02:withdrawal:${withdrawalId}`;
  const sourceTrace = {
    sourceTable: 'bonus_ledger' as const,
    sourceId: ledgerId ?? withdrawalId,
    documentType: 'bonus_withdrawal' as const,
    withdrawalId,
  };

  // (1) Resolve current live policy — fail closed (no default).
  let option: string;
  let resolveDiagnostics: string[] = [];
  try {
    const resolved = await resolveBonusWithdrawalAccountingPolicy(deps, ctx.companyId);
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

  // (2) Snapshot the policy in force for THIS withdrawal (idempotent, history-safe).
  const snap = await snapshotWithdrawalPolicy(withdrawalId, option, deps);

  // (3) Dispatch A / B. No C exists in the registry, so there is no no_entry branch.
  const intendedAccounts: WithdrawalAccountRole[] = [
    { role: 'deferred_bonus_liability' },
    { role: 'cash_or_bank' },
  ];
  const reason = `${ACCOUNT_MAPPING_REQUIRED}: option ${option} would DR ${intendedAccounts.map((a) => a.role).join(', ')} / CR cash_or_bank (ACC-04/ACC-05), but (a) no Bonus Liability account exists in the seeded COA (0007:41-59; 2100 is payables/suppliers, not deferred bonus — not reused), and (b) the Cash/Bank leg is unmapped (1110/1120 exist but 1110-vs-1120 + locked-vs-cleared is ACC-05/exposure X1 — undecided). Refusing to fabricate or assume a code.`;

  return {
    option,
    effect: { kind: 'would_post', intendedAccounts, code: ACCOUNT_MAPPING_REQUIRED, reason },
    journalEntryId: null,
    effectKey,
    alreadyHadPolicySnapshot: !snap.written,
    diagnostics: [...resolveDiagnostics, ACCOUNTING_NOT_POSTED, BONUS_GL_ATOMICITY_GAP],
    sourceTrace,
  };
}
