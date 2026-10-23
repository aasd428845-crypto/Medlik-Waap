/**
 * BD-01 E1 → General Ledger posting contract (pure seam).
 *
 * The authoritative implementation of the E1→GL posting flow lives in SQL:
 *   - `apply_bonus_earn_accounting` (0028) — fail-closed decision + the
 *     "queue a PENDING link" rule.
 *   - `post_bonus_earn_to_gl` (0030) — the director-scoped RPC that builds a
 *     balanced Dr/Cr journal and posts it under the director's JWT.
 *
 * This module is the PURE, offline-testable mirror of those two rules (the
 * "pure engine" half of the pure+live+test pattern established by
 * `bonusAccountingPolicy.ts`). It imports only types from
 * `bonusAccountingPolicy.ts` (type-only, erased) and holds NO Supabase client,
 * so it runs under `node --experimental-strip-types` with zero IO — exactly
 * like the existing `bonusAccountingPolicy.test.ts`.
 *
 * It is intentionally a CONTRACT, not the executor: the SQL layer is the source
 * of truth for accounts, amounts, periods and authority. This file mirrors that
 * contract so the fail-closed behaviour is unit-testable without a database.
 */
import type { BonusEarnDecision } from './bonusAccountingPolicy.ts';

/** A posting request state (mirrors `bonus_earn_gl_postings.status`, 0030). */
export type GlPostState = 'PENDING' | 'POSTED' | 'FAILED' | 'ABSENT';

/** A balanced Dr/Cr journal (mirrors what 0030 posts via fn_financial_auto_entry).
 *  Returns null on any fail-closed input — a partial/unbalanced entry is never
 *  produced (§7 #4). `total` is always Dr==Cr. */
export interface EarnGlLines {
  lines: ReadonlyArray<{
    account_code: string;
    debit: number;
    credit: number;
    description: string;
  }>;
  total: number;
}

/** The intent the trigger (0028) would queue, given the resolved decision +
 *  the director's mappings + timing. Mirrors 0028's fail-closed dispatch. */
export interface GlPostIntent {
  /** True iff a PENDING link (0030) would be queued for a future director post. */
  queue: boolean;
  /** Fail-closed rationale when `queue` is false. */
  reason: string;
}

/** Context the intent rule needs (all inputs; no global/IO state).
 *  Both debit and credit account codes come from the 0028/0030 decision snapshot
 *  (resolved from the layout + role→account map at earn-decision time). Neither is
 *  hardcoded — the director binds each role to an account, and the layout
 *  determines which role is debit vs. credit. */
export interface GlPostContext {
  decision: Pick<BonusEarnDecision, 'option' | 'journalEntryId' | 'effectKey'>;
  /** The fail-closed code SQL 0028 would emit (POSTING_AUTHORITY_REQUIRED,
   *  ACCOUNT_MAPPING_REQUIRED, TIMING_INFRASTRUCTURE_REQUIRED, ...). */
  accountingCode: string;
  /** Resolved debit account code from the snapshot (0029 role→account map). */
  debitAccountCode: string | null;
  /** Resolved credit account code from the snapshot. */
  creditAccountCode: string | null;
  /** BD-08 timing option ('A' immediate / 'B' draft-at-event / 'C' periodic). */
  timing: string;
  /** BD-09 aggregation option ('A'/'B'/'C'). */
  aggregation: string;
  /** The earn's company id (SQL: from financial_companies C-3). */
  companyId: string | null;
  /** The mapping's company id (must equal `companyId`; otherwise isolation). */
  mappingCompanyId: string | null;
}

/** Fail-closed codes mirrored from 0028 (string literals, kept in sync). */
export const GL_POSTING_CODE = {
  ACCOUNT_MAPPING_REQUIRED: 'ACCOUNT_MAPPING_REQUIRED',
  POSTING_AUTHORITY_REQUIRED: 'POSTING_AUTHORITY_REQUIRED',
  TIMING_INFRASTRUCTURE_REQUIRED: 'TIMING_INFRASTRUCTURE_REQUIRED',
  POSTING_INFRASTRUCTURE_REQUIRED: 'POSTING_INFRASTRUCTURE_REQUIRED',
  COMPANY_POLICY_ISOLATION_GAP: 'COMPANY_POLICY_ISOLATION_GAP',
  NO_DECISION: 'NO_DECISION',
  MAPPING_COMPANY_MISMATCH: 'MAPPING_COMPANY_MISMATCH',
} as const;

/**
 * Pure mirror of 0028's fail-closed → PENDING-queue rule (0028 §(5) + the
 * PENDING-link block). The authoritative implementation is SQL; this is the
 * testable seam. Inputs are ALL passed in — there is no DB, no JWT, no global.
 */
export function computeGlPostIntent(ctx: GlPostContext): GlPostIntent {
  // 0030: no decision / not a POSTED EARN → nothing.
  if (!ctx.decision) {
    return { queue: false, reason: GL_POSTING_CODE.NO_DECISION };
  }
  // 0030: BD-01 C → no_entry (no legs, no queue). Pure engine emits journalEntryId: null.
  if (ctx.decision.option === 'C') {
    return { queue: false, reason: 'BD-01 C — no recognition at grant' };
  }
  // 0030: BOTH legs must be designated (mapped) via 0029. Unmapped → fail closed.
  // No hardcoded offset — the cash role is bound by the director like any other.
  if (!ctx.debitAccountCode || !ctx.creditAccountCode) {
    return { queue: false, reason: GL_POSTING_CODE.ACCOUNT_MAPPING_REQUIRED };
  }
  // §7: the mappings are company-scoped — they must belong to the earn's company.
  if (ctx.companyId && ctx.mappingCompanyId && ctx.companyId !== ctx.mappingCompanyId) {
    return { queue: false, reason: GL_POSTING_CODE.MAPPING_COMPANY_MISMATCH };
  }
  // 0028 §(4): BD-09 C (periodic netting via the bonus engine) — no scheduler +
  // ACC-10 (bonus_ledger has no company_id) → fail closed, no queue.
  if (ctx.aggregation === 'C') {
    return { queue: false, reason: GL_POSTING_CODE.POSTING_INFRASTRUCTURE_REQUIRED };
  }
  // 0028 §(4): BD-08 C (periodic netting at event) — no scheduler → fail closed.
  if (ctx.timing === 'C') {
    return { queue: false, reason: GL_POSTING_CODE.TIMING_INFRASTRUCTURE_REQUIRED };
  }
  // 0028 §(5): only BD-08 A (immediate) reaches POSTING_AUTHORITY_REQUIRED —
  // authority is the sole remaining gate (the trigger cannot post; see 0028 header).
  if (ctx.timing !== 'A') {
    // BD-08 B (draft-at-event): the valuation basis is the out-of-scope ACC-03 layer,
    // so a balanced entry cannot be formed here.
    return { queue: false, reason: GL_POSTING_CODE.ACCOUNT_MAPPING_REQUIRED };
  }
  // Both legs mapped + BD-08 A + BD-09 not periodic → queue a PENDING link for the director.
  return { queue: true, reason: '' };
}

/** Build the balanced journal lines 0030 would post (pure). The debit/credit
 *  account codes are resolved from the 0028 decision snapshot (layout +
 *  role→account map) — never hardcoded. No `option` param is needed because the
 *  snapshot already encodes which role is debit vs. credit (the layout's job).
 *  Returns null on any fail-closed input — a partial/unbalanced entry is never
 *  produced (§7 #4). `total` is always Dr==Cr. */
export function buildEarnGlLines(
  debitAccountCode: string,
  creditAccountCode: string,
  amount: number,
): EarnGlLines | null {
  if (!debitAccountCode?.trim() || !creditAccountCode?.trim()) return null; // unmapped → fail closed
  if (amount <= 0) return null; // unstated valuation → fail closed
  return {
    lines: [
      { account_code: debitAccountCode,  debit: amount, credit: 0,        description: 'E1 earn — debit leg (configured)' },
      { account_code: creditAccountCode, debit: 0,        credit: amount, description: 'E1 earn — credit leg (configured)' },
    ],
    total: amount,
  };
}

/** Idempotency model of 0030 §(b): a POSTED link returns its existing journal id
 *  (idempotent=true); a FAILED link is not auto-repostable; only PENDING posts. */
export function canRepost(state: GlPostState): boolean {
  return state === 'PENDING';
}

/** The one role authorised to post a queued earn to the GL — mirrors 0030's
 *  in-body gate (`current_user_role() = 'company_director'`, 0010:291/0024:43).
 *  Kept as a named constant so the authority contract has a single source. */
export const EARN_POSTING_ROLE = 'company_director';

/** Pure mirror of 0030's director-only authority gate. Only a `company_director`
 *  session may post a queued earn to the GL; the E1 trigger's own session
 *  (driver / branch_manager) is always rejected — the trigger can never post
 *  (0028 header; the gate is JWT-scoped, not bypassable by SECURITY DEFINER). */
export function canPostEarnToGl(role: string | null | undefined): boolean {
  return role === EARN_POSTING_ROLE;
}

/** The journal id 0030 would return for an idempotent re-post of an already-POSTED
 *  earn, or null if not yet posted. */
export function existingJournalId(state: GlPostState, postedJournalId: string | null): string | null {
  return state === 'POSTED' ? postedJournalId : null;
}

/** Result of the pure pre-check 0030 performs before calling create/post: */
export interface PostEligibility {
  ok: boolean;
  code: string | null;
}

/** Pure mirror of 0030's pre-flight (0024:43-57): a queued earn is postable
 *  only while an OPEN `financial_periods` row exists. The debit/credit account
 *  codes and valuation `amount` are all resolved server-side from the decision
 *  snapshot (bonus_ledger.amount + bonus_journal_leg_mapping → role→account),
 *  so this seam does not need them — balance is guaranteed by buildEarnGlLines. */
export function earnPostEligible(ctx: GlPostContext, opts: { openPeriod: boolean }): PostEligibility {
  const intent = computeGlPostIntent(ctx);
  if (!intent.queue) {
    return { ok: false, code: intent.reason || GL_POSTING_CODE.NO_DECISION };
  }
  if (!opts.openPeriod) {
    return { ok: false, code: 'FINANCIAL_PERIOD_NOT_OPEN' };
  }
  return { ok: true, code: null };
}

/** Deterministic audit key 0030's `bonus_audit_trail` INSERT would record
 *  (entity='bonus_earn_gl_postings', entity_id=ledger_id). Stable across
 *  idempotent re-posts (CASE 7). */
export function glPostAuditKey(ledgerId: string): string {
  return 'GL_POST:bonus_earn_gl_postings:' + ledgerId;
}

// ── Batch "post all pending earns" (E1-3) ────────────────────────────────────
/** Minimal per-earn batch outcome — structurally compatible with the live
 *  `GlPostResult` (bonusFinancialApi) so the summary rule is unit-testable
 *  without importing the Supabase-backed module. */
export interface BatchPostOutcome {
  ledgerId: string;
  /** 'POSTED' | 'FAILED' | 'PENDING' (mirrors bonus_earn_gl_postings.status). */
  status: string;
  journalEntryId: string | null;
  /** True when the earn was already posted (0030 idempotent re-post). */
  idempotent?: boolean;
  /** Fail-closed rationale when status is FAILED. */
  reason?: string | null;
}

/** Aggregate summary of a batch "post all pending earns" run. */
export interface BatchPostSummary {
  total: number;
  /** Newly created journals (idempotent === false). */
  posted: number;
  /** Earns that were already posted (idempotent === true) — no new journal. */
  alreadyPosted: number;
  failed: number;
  failures: { ledgerId: string; reason: string }[];
  /** True when nothing failed AND at least one earn reached POSTED. */
  ok: boolean;
  /** True when the batch had nothing to attempt. */
  empty: boolean;
}

/** Pure mirror of the batch-post aggregation. The live orchestrator
 *  (`postAllPendingEarnsToGl`) loops the idempotent 0030 RPC sequentially and
 *  yields one outcome per requested earn; this summarises them for the director
 *  UI. A batch is `ok` only when every attempted earn is POSTED (new or
 *  idempotent) — a single FAILED outcome makes the batch not-ok, and each
 *  failure carries its per-earn reason. Nothing is posted from here. */
export function summarizeBatchPostResults(results: BatchPostOutcome[]): BatchPostSummary {
  const total = results.length;
  let posted = 0;
  let alreadyPosted = 0;
  const failures: { ledgerId: string; reason: string }[] = [];
  for (const r of results) {
    if (r.status === 'POSTED') {
      if (r.idempotent) alreadyPosted++;
      else posted++;
    } else {
      failures.push({ ledgerId: r.ledgerId, reason: r.reason ?? 'UNKNOWN_FAILURE' });
    }
  }
  return {
    total,
    posted,
    alreadyPosted,
    failed: failures.length,
    failures,
    ok: total > 0 && failures.length === 0,
    empty: total === 0,
  };
}
