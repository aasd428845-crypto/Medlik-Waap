/**
 * BD-08 BONUS ACCOUNTING POSTING TIMING POLICY — Dynamic, director-controlled engine.
 *
 * ⚠️ SCOPE: BD-08 (publish / sweep timing) ONLY. BD-08 is NOT an event RPC and has no event
 * seam of its own — it is a consultable timing-policy engine. BD-01..BD-07 each emit a
 * `TIMING_POLICY_REQUIRED` diagnostic on their would_post path; a future wiring step consults
 * this engine (via `applyBonusTimingPolicyLive` / the dormant seam `resolveBonusPublishTiming`)
 * to resolve that timing. This file does NOT modify BD-01..BD-07 (directive §12).
 *
 * WHAT BD-08 OWNS (and does NOT own) — directive §10:
 *   BD-08 owns Publish Timing — WHEN/HOW the GL impact of a posted bonus event is
 *   scheduled/ordered. It does NOT own:
 *     - Event Boundary: when the bonus_ledger row is recorded (POSTED) — that is set by the
 *       event engine (BD-01..BD-07) at the business act. BD-08 CONSUMES it.
 *     - Posting: creating/publishing a journal entry — a downstream, separately-gated step
 *       (a future posting worker). BD-08 NEVER calls `create_financial_journal_entry` /
 *       `post_financial_journal_entry` and NEVER creates a journal (journalEntryId is null on
 *       every path).
 *
 * THE THREE LAYERS, MADE EXPLICIT (directive §10):
 *   eventBoundary = bonus_ledger.POSTED row (already recorded by the event engine).
 *   publishTiming = the BD-08 option in force (A immediate / B draft-then-approval /
 *                   C periodic-batch). BD-08 decides this.
 *   posting       = journal creation — explicitly NOT performed; `not_posted`.
 *
 * WHY A / B / C ARE ALL INFRA-BLOCKED TODAY (verified, not assumed):
 *   PHASE-49 §9.1 (lines 690-699): `create_financial_journal_entry` /
 *   `post_financial_journal_entry` exist but are MANUAL + director-only (0010:278,308);
 *   `fn_financial_auto_entry` has invoice + driver-commission callers only
 *   (0009:35,108,141); `trg_financial_bonus_inventory` (0009:184-220) is a quantity-only
 *   legacy movement that writes NO journal. "Bonus → accounting posting (any event):
 *   TECHNICAL GAP + BUSINESS POLICY REQUIRED" (line 694). "Expiry scheduling: TECHNICAL GAP —
 *   no scheduler anywhere" (line 699; §11.1 T-3; §4.3 line 724). So every BD-08 option today
 *   resolves to a `would_post` (A/B) or `would_schedule` (C) intent carrying a
 *   `TIMING_INFRASTRUCTURE_REQUIRED` gap — BD-08 declares the INTENDED timing and the precise
 *   infra that is absent, but never fabricates a journal. (directive §6: implement to the
 *   extent the infrastructure allows — and the bonus-posting infrastructure does not yet exist.)
 *
 * OPTION SET (single source — directive §2):
 *   Read from `accountingPolicies.ts` BD-08 ({A,B,C}) via `getPolicy('BD-08')` (directive §3).
 *   No option is invented; no option is hard-coded in the dispatch (directive §7). Per
 *   §11.1 (trigger WHERE) and §11.3 (posting STATE), recorded in the registry's
 *   `dependencies`/`when`/`warning`:
 *     A = immediate at event  → T-1 trigger OR T-2 explicit call, S-2 post-in-transaction.
 *     B = draft at event, publish later → S-1 draft + manual owner approval.
 *     C = periodic batch sweep → T-3 scheduled sweep + S-3/S-1 batching.
 *
 * SNAPSHOT NAMESPACE (directive §11):
 *   BD-01..BD-07 all key their write-once snapshot on the SAME globally-unique `bonus_ledger.id`
 *   under `accounting_policy.snapshot.<ledgerId>`. BD-08 governs the timing for the SAME rows
 *   (E1-E12), so reusing the bare prefix would COLLIDE with the event-account-policy snapshot
 *   (a row's timing option would clobber its earn/reversal/expiry/refund policy, or vice-versa).
 *   BD-08 therefore uses the namespaced `accounting_policy.snapshot.timing.<ledgerId>` — same
 *   `bonus_settings` table + director `for all` RLS, no new table, no migration, write-once.
 *
 * CORE RULES (honored literally):
 *   - The policy is NEVER chosen by code. `accounting_policy.BD-08` is read LIVE at timing-
 *     resolution time and validated against BD-08's registered option set. No `const BD08 = …`,
 *     no `policy ?? "A"`.
 *   - Missing policy → POLICY_NOT_CONFIGURED (reused from BD-01; value 'ACCOUNTING_POLICY_NOT_CONFIGURED',
 *     directive §3 item 4); invalid/unregistered → fail_closed POLICY_INVALID (directive §3 item 5).
 *     Both throw — the caller decides how to surface (fail closed, no silent default).
 *   - Company note: `bonus_settings` / `bonus_ledger` carry NO `company_id` (0018:50-114,
 *     0018:80-86; PHASE-49 §1.4 fault line), so the read is global. Passing a `companyId`
 *     produces a COMPANY_POLICY_ISOLATION_GAP diagnostic (ACC-10) rather than a silent
 *     cross-company read.
 *
 * PURE. Imports only `accountingPolicies.ts` (pure data) + shared sentinels/types from
 * `bonusAccountingPolicy.ts` (BD-01). Never initialises Supabase. Fully unit-testable with an
 * in-memory fake store (see `bonusTimingPolicy.test.ts`). The Supabase wiring lives in the
 * separate `bonusTimingPolicyLive.ts`.
 *
 * Sources of truth (verified in-repo, not assumed):
 *  - accountingPolicies.ts  → BD-08 options {A,B,C} (§11.1 T-1/T-2/T-3, §11.3 S-1/S-2/S-3).
 *  - PHASE-49 §9.1 lines 690-699 → posting / scheduling infra existence (TECHNICAL GAP).
 *  - PHASE-49 §11.1 (T-1/T-2/T-3) + §11.3 (S-1/S-2/S-3) → timing semantics per option.
 *  - 0018:50-114 → bonus_ledger (id PK; txn_type includes REVERSAL/EXPIRATION/etc.;
 *    idempotency_key UNIQUE 0018:73; NO company_id — ACC-10; POSTED rows immutable 0018:98-112).
 *  - 0006:144-145 → financial_documents.source_table='bonus_ledger' + source_id (R-1 reference
 *    shape available for a future poster; unused by BD-08 itself).
 *  - 0009:57-60 → C-3 single-company helper (financial_companies order by created_at limit 1).
 */

import { getPolicy } from './accountingPolicies.ts';

// ── Keys ───────────────────────────────────────────────────────────────────────
/** Live director-chosen publish-timing policy (BD-08). */
export const BD08_POLICY_KEY = 'accounting_policy.BD-08';
/**
 * Per-event timing snapshot prefix. The suffix is the bonus_ledger.id (the TRUE event
 * identity — the same globally-unique key the event engines use). The `.timing.` segment
 * namespaces BD-08 from BD-01..BD-07's bare `accounting_policy.snapshot.<ledgerId>` so a
 * timing snapshot can never clobber an event's account-policy snapshot (or vice-versa).
 * Stored via the EXISTING `bonus_settings` table + director `for all` RLS — no new table,
 * no migration. Write-once.
 */
export const BD08_SNAPSHOT_PREFIX = 'accounting_policy.snapshot.timing.';

// ── Shared fail-closed sentinels (reused from BD-01; never re-defined) ────────────
import {
  POLICY_NOT_CONFIGURED,
  POLICY_INVALID,
  COMPANY_POLICY_ISOLATION_GAP,
  type BonusEarnDeps,
  PolicyResolutionError,
} from './bonusAccountingPolicy.ts';

// ── BD-08-specific timing sentinel (additive; BD-01..BD-07 untouched) ────────────
/**
 * The chosen publish-timing option requires a scheduling / trigger / marker mechanism that
 * does not exist in the repository today (a Queue/Scheduler/Worker, a bonus_ledger posting
 * trigger, a draft-wired-to-bonus journal, an owner approval flow, or a published/posted
 * marker). Emits on every A/B/C path today because bonus-posting infrastructure is a
 * TECHNICAL GAP (PHASE-49 §9.1 lines 694/699). BD-08 NEVER builds the infra (directive §9)
 * and NEVER fabricates a journal (directive §10).
 */
export const TIMING_INFRASTRUCTURE_REQUIRED = 'TIMING_INFRASTRUCTURE_REQUIRED';

// ── Deps alias (BD-08 reuses the BD-01 bonus_settings read/write store) ───────────
/** Storage abstraction (injectable → tests run with an in-memory fake). Same shape as BD-01. */
export type TimingDeps = BonusEarnDeps;

// ── BD-08 option letters (from the registry, not a literal) ───────────────────────
export type Bd08Option = string;
export const BD08_OPTIONS: readonly string[] = (() => {
  const policy = getPolicy('BD-08');
  return policy ? Object.freeze(policy.options.map((o) => o.value)) : [];
})();

/**
 * The publish-timing intent a BD-08 option resolves to, BEFORE the infra check.
 *   A (immediate)          → 'immediate'            (publish at the event, S-2).
 *   B (draft then publish) → 'draft_then_approval'  (S-1 draft + manual publish).
 *   C (periodic batch)     → 'periodic_batch'       (T-3 sweep + S-3/S-1).
 */
export type PublishTimingIntent = 'immediate' | 'draft_then_approval' | 'periodic_batch';

/**
 * The concrete timing EFFECT BD-08 can commit to given the real repository state.
 * Today every option is infra-blocked (TECHNICAL GAP — see file header), so the effect is a
 * `would_post` (A/B intent to publish) or `would_schedule` (C intent to defer to a sweep)
 * carrying a TIMING_INFRASTRUCTURE_REQUIRED gap. BD-08 NEVER posts: `journalEntryId` is null
 * on every path (directive §10).
 */
export interface TimingInfraGap {
  code: typeof TIMING_INFRASTRUCTURE_REQUIRED;
  reason: string;
  /** Specific infrastructure that is absent — grounded in PHASE-49 / migration line refs. */
  infraMissing: string[];
}
export type TimingEffect =
  | { kind: 'would_post'; publishTiming: 'immediate'; infra: TimingInfraGap }
  | { kind: 'would_post'; publishTiming: 'draft_then_approval'; infra: TimingInfraGap }
  | { kind: 'would_schedule'; publishTiming: 'periodic_batch'; infra: TimingInfraGap }
  | { kind: 'fail_closed'; code: string; reason: string };

export interface TimingContext {
  /** Real identity of the bonus event — `bonus_ledger.id` (the TRUE event identity). */
  identity: { ledgerId: string; idempotencyKey?: string | null; orderId?: string | null };
  /** The BD-08 option governs publish timing for ALL bonus events (E1-E12). */
  eventType: string;
  /** Best-effort current financial company (C-3 single-company assumption; ACC-10 gap). */
  companyId?: string | null;
}

export interface PublishTimingDecision {
  /** BD-08 option resolved at timing time (null only when resolution failed). */
  option: string | null;
  /** The timing effect (would_post / would_schedule / fail_closed). journalEntryId always null. */
  effect: TimingEffect;
  /** Always null — BD-08 owns timing only, never creates a journal (directive §10). */
  journalEntryId: string | null;
  /** Stable idempotency key for THIS event's timing decision. */
  effectKey: string;
  /** Did a timing snapshot already exist for this event when we got here? */
  alreadyHadPolicySnapshot: boolean;
  /** Gaps / warnings accompanying the decision. */
  diagnostics: string[];
  /** Source-trace anchored on the TRUE bonus_ledger event identity. */
  sourceTrace: {
    sourceTable: 'bonus_ledger';
    sourceId: string;
    documentType: string;
    ledgerId: string;
    eventType: string;
  };

  /**
   * The three-layer decomposition (directive §10):
   * - eventBoundary: recorded at the business act by the event engine (BD-01..BD-07).
   * - publishTiming: WHEN/HOW the GL impact is scheduled (BD-08 owns this).
   * - posting: journal creation — explicitly NOT performed by BD-08.
   */
  eventBoundary: { recordedAt: 'bonus_ledger.POSTED'; note: string };
  publishTiming: { option: string | null; intent: PublishTimingIntent | null };
  posting: { journalEntryId: null; status: 'not_posted'; reason: string };
}

// ── Per-option behaviour: intent + evidence-grounded infra gap (from §11 / §9.1) ───
// The OPTION SET comes from BD08_OPTIONS (registry); only the per-letter mapping of
// option → (timing intent + absent infra) is authored here, grounded in PHASE-49 §11
// (timing semantics, recorded in accountingPolicies.ts BD-08 `dependencies`) + §9.1
// (infra existence). No 4th option is invented (directive §2/§7).
function timingIntentFor(option: string): PublishTimingIntent | null {
  if (option === 'A') return 'immediate'; // T-1/T-2 + S-2
  if (option === 'B') return 'draft_then_approval'; // S-1 + manual publish
  if (option === 'C') return 'periodic_batch'; // T-3 + S-3/S-1
  return null;
}

function infraGapFor(option: string): TimingInfraGap {
  let infraMissing: string[];
  let title: string;
  if (option === 'A') {
    infraMissing = [
      'No T-1 trigger on bonus_ledger posts a journal entry — the only financial triggers are on invoices (0009:108) and order_items (0009:184, the quantity-only `trg_financial_bonus_inventory` which writes NO journal); nothing fires on a bonus_ledger insert (PHASE-49 §11.1 T-1).',
      'No T-2 explicit call is wired into any bonus RPC body — "no bonus RPC body calls fn_financial_auto_entry, create_financial_journal_entry, or post_financial_journal_entry" (PHASE-49 §3).',
    ];
    title = 'A (فوري عند الحدث / immediate at event)';
  } else if (option === 'B') {
    infraMissing = [
      'No draft journal entry is wired to bonus_ledger events — `create_financial_journal_entry` supports draft status (0010:278) and the invoice path drafts journals (0009:77-78), but no bonus trigger/RPC creates a draft for a bonus row (PHASE-49 §9.1 line 694 TECHNICAL GAP; §11.3 S-1).',
      'No owner approval/release flow exists for bonus journal drafts (ACC-11; PHASE-49 §11.3 S-1 warning: "unreviewed drafts could accumulate silently").',
      'No published/posted-marker column exists on bonus_ledger to track draft-vs-published state (PHASE-49 §4.3 Q6 — "منشئ منشور غير موجود اليوم"; §11.1 T-3 consequence: "needs a published marker that does not exist today").',
    ];
    title = 'B (مسودة عند الحدث، نشر لاحق / draft-then-publish)';
  } else if (option === 'C') {
    infraMissing = [
      'No scheduler/worker exists anywhere in the repository — "Expiry scheduling: TECHNICAL GAP — no scheduler anywhere" (PHASE-49 §9.1 line 699; §11.1 T-3 "Periodic sweep — a scheduled job"; §4.3 line 724 "no scheduler exists").',
      'No published/posted-marker column exists on bonus_ledger to dedupe batch sweeps (PHASE-49 §4.3 Q6; §11.1 T-3 consequence).',
    ];
    title = 'C (دفعة دورية / periodic batch sweep)';
  } else {
    infraMissing = [`BD-08 option "${option}" is registered but has no evidence-grounded infra mapping (unexpected registry shape).`];
    title = `'${option}'`;
  }
  return {
    code: TIMING_INFRASTRUCTURE_REQUIRED,
    reason:
      `${TIMING_INFRASTRUCTURE_REQUIRED}: BD-08 ${title} requires publish-timing infrastructure that does not exist for bonus events (PHASE-49 §9.1 line 694: "Bonus → accounting posting (any event): TECHNICAL GAP + BUSINESS POLICY REQUIRED"). BD-08 declares the intended timing but does NOT build the infra (directive §9) and does NOT create a journal (directive §10).`,
    infraMissing,
  };
}

// ── 1. Resolve the CURRENT live policy (fail-closed, no default) ──────────────────
/**
 * Reads `accounting_policy.BD-08` from settings and validates it against BD-08's
 * registered option set {A,B,C} (from `accountingPolicies.ts` via `getPolicy('BD-08')`).
 *
 * Throws POLICY_NOT_CONFIGURED ('ACCOUNTING_POLICY_NOT_CONFIGURED') / POLICY_INVALID — the
 * caller decides how to surface it; this function NEVER substitutes a default option.
 *
 * Company note: `bonus_settings` carries NO `company_id` (0018 DDL; PHASE-49 §1.4 fault line),
 * so the read is global. Passing a `companyId` produces a COMPANY_POLICY_ISOLATION_GAP
 * diagnostic (ACC-10) rather than a silent cross-company read.
 */
export async function resolveBonusTimingPolicy(
  deps: TimingDeps,
  companyId?: string | null,
): Promise<{ option: string; diagnostics: string[] }> {
  const raw = await deps.readSetting(BD08_POLICY_KEY);
  if (raw == null || raw === '') {
    throw new PolicyResolutionError(
      POLICY_NOT_CONFIGURED,
      'BD-08 is not configured; refusing to assume a publish-timing policy (no silent default).',
    );
  }
  const candidate = String(raw);
  if (!BD08_OPTIONS.includes(candidate)) {
    throw new PolicyResolutionError(
      POLICY_INVALID,
      `BD-08 option "${candidate}" is not one of the registered alternatives (${BD08_OPTIONS.join(', ') || 'none'}).`,
    );
  }
  const diagnostics: string[] = [];
  if (companyId) {
    diagnostics.push(COMPANY_POLICY_ISOLATION_GAP);
  }
  return { option: candidate, diagnostics };
}

// ── 2. Snapshot the policy in force for THIS event (history protection) ───────────
/**
 * Persists `accounting_policy.snapshot.timing.<ledgerId>` = option via the existing
 * director-writable `bonus_settings` (no new table, no migration). Idempotent: if a timing
 * snapshot already exists for this event's TRUE identity (bonus_ledger.id) it is left
 * untouched, so a later director flip (A→B) never rewrites an event's recorded timing. The
 * `.timing.` namespace avoids colliding with the event-account-policy snapshots (BD-01..BD-07)
 * which key the same ledgerId under the bare prefix.
 */
export async function snapshotBonusTimingPolicy(
  ledgerId: string,
  option: string,
  deps: TimingDeps,
): Promise<{ written: boolean }> {
  const key = `${BD08_SNAPSHOT_PREFIX}${ledgerId}`;
  const existing = await deps.readSetting(key);
  if (existing != null) return { written: false };
  await deps.upsertSetting(key, option);
  return { written: true };
}

/** Which BD-08 publish-timing option was in force when this event was processed. */
export async function getHistoricalBonusTimingPolicy(
  ledgerId: string,
  deps: TimingDeps,
): Promise<{ option: string | null; source: 'snapshot' | 'none' }> {
  const raw = await deps.readSetting(`${BD08_SNAPSHOT_PREFIX}${ledgerId}`);
  if (raw == null) return { option: null, source: 'none' };
  const opt = String(raw);
  return { option: BD08_OPTIONS.includes(opt) ? opt : null, source: 'snapshot' };
}

// ── 3. Dispatch A / B / C for this event (timing intent + infra gap; NO journal) ──
/**
 * Resolve the current BD-08 policy, snapshot it for THIS event (on the event's TRUE identity —
 * bonus_ledger.id), and return the concrete publish-timing decision.
 *
 * Does NOT create journal entries (`create_financial_journal_entry` / `post_financial_journal_entry`
 * are never called — directive §10). Does NOT mutate bonus_ledger (the event row was already
 * recorded POSTED by the event engine).
 *
 * Per-option behaviour, grounded in PHASE-49 §11 (timing semantics) + §9.1 (infra existence)
 * — directive §6 (implement to the extent infra allows):
 *   A (immediate)        → would_post (publish at event, S-2); the trigger/call is absent →
 *                          TIMING_INFRASTRUCTURE_REQUIRED.
 *   B (draft→publish)    → would_post (draft at event S-1, publish on approval); infra absent →
 *                          TIMING_INFRASTRUCTURE_REQUIRED.
 *   C (periodic batch)   → would_schedule (deferred to a T-3 sweep); infra (scheduler) absent →
 *                          TIMING_INFRASTRUCTURE_REQUIRED.
 *
 * BD-08 does NOT consult / replace BD-01..BD-07's accounting policy (directive §12); it is the
 * timing layer ABOVE them. The three-layer decomposition (directive §10) is made explicit on
 * the returned decision.
 *
 * Idempotency: the snapshot is keyed by the event's TRUE identity (bonus_ledger.id) and written
 * once; re-dispatch yields `alreadyHadPolicySnapshot: true` and an identical effect.
 */
export async function applyBonusTimingPolicy(
  ctx: TimingContext,
  deps: TimingDeps,
): Promise<PublishTimingDecision> {
  const { ledgerId } = ctx.identity;
  const effectKey = `bd08:timing:${ledgerId}`;
  const sourceTrace = {
    sourceTable: 'bonus_ledger' as const,
    sourceId: ledgerId,
    documentType: ctx.eventType,
    ledgerId,
    eventType: ctx.eventType,
  };
  const layers = buildLayers();

  // (1) Resolve current live policy — fail closed (no default).
  let option: string;
  let resolveDiagnostics: string[] = [];
  try {
    const resolved = await resolveBonusTimingPolicy(deps, ctx.companyId);
    option = resolved.option;
    resolveDiagnostics = resolved.diagnostics;
  } catch (e) {
    const err = e as PolicyResolutionError;
    const code = err.code ?? 'UNKNOWN';
    return failClosed(code, `${code}: ${err.message}`, effectKey, sourceTrace, layers, resolveDiagnostics);
  }

  // (2) Snapshot the policy in force for THIS event (idempotent, history-safe).
  const snap = await snapshotBonusTimingPolicy(ledgerId, option, deps);

  // (3) Dispatch per option: intent + evidence-grounded infra gap. BD-08 NEVER posts.
  const intent = timingIntentFor(option);
  if (intent === null) {
    // Registered but unmapped — defensive (should not happen with a valid registry).
    return failClosed(
      POLICY_INVALID,
      `BD-08 option "${option}" is registered but has no behaviour mapping (unexpected registry shape).`,
      effectKey,
      sourceTrace,
      layers,
      resolveDiagnostics,
    );
  }

  const infra = infraGapFor(option);
  const diagnostics = [...resolveDiagnostics, TIMING_INFRASTRUCTURE_REQUIRED];

  const effect: TimingEffect =
    intent === 'periodic_batch'
      ? { kind: 'would_schedule', publishTiming: 'periodic_batch', infra }
      : { kind: 'would_post', publishTiming: intent, infra };

  return {
    option,
    effect,
    journalEntryId: null,
    effectKey,
    alreadyHadPolicySnapshot: !snap.written,
    diagnostics,
    sourceTrace,
    eventBoundary: layers.eventBoundary,
    publishTiming: { option, intent },
    posting: layers.posting,
  };
}

// ── Three-layer helpers (directive §10), shared by success + fail_closed paths ────
function buildLayers(): {
  eventBoundary: PublishTimingDecision['eventBoundary'];
  posting: PublishTimingDecision['posting'];
} {
  return {
    eventBoundary: {
      recordedAt: 'bonus_ledger.POSTED',
      note:
        'Event Boundary is owned by the event engine (BD-01..BD-07): the bonus_ledger row is ' +
        'already recorded as POSTED at the business act. BD-08 consumes it and decides only the ' +
        'publish timing.',
    },
    posting: {
      journalEntryId: null,
      status: 'not_posted' as const,
      reason:
        'BD-08 owns publish timing only — journal entry creation is a downstream, separately-gated ' +
        'step. BD-08 never calls create_financial_journal_entry / post_financial_journal_entry and ' +
        'never creates a journal (directive §10).',
    },
  };
}

function failClosed(
  code: string,
  reason: string,
  effectKey: string,
  sourceTrace: PublishTimingDecision['sourceTrace'],
  layers: ReturnType<typeof buildLayers>,
  diagnostics: string[] = [],
): PublishTimingDecision {
  return {
    option: null,
    effect: { kind: 'fail_closed', code, reason },
    journalEntryId: null,
    effectKey,
    alreadyHadPolicySnapshot: false,
    diagnostics,
    sourceTrace,
    eventBoundary: layers.eventBoundary,
    publishTiming: { option: null, intent: null },
    posting: layers.posting,
  };
}
