/**
 * BD-09 BONUS JOURNAL ENTRY AGGREGATION POLICY — Dynamic, director-controlled engine.
 *
 * ⚠️ SCOPE: BD-09 (HOW journal entries are AGGREGATED) ONLY. BD-09 decides HOW the
 * accounting effect of a posted bonus event is grouped into journal entries; it does NOT
 * decide WHETHER an event posts (that is BD-01..BD-07) or WHEN it is published (BD-08).
 *
 * WHAT BD-09 OWNS (and does NOT own) — directive §10:
 *   BD-09 owns Journal Entry AGGREGATION — the rule that combines posting effects into
 *   journal entries. It does NOT own:
 *     - Accounting decision (no_entry/would_post/fail_closed): owned by BD-01..BD-07;
 *       BD-09 CONSUMES it (see the dormant seam `resolveBonusJournalAggregation.ts`).
 *     - Publish timing: owned by BD-08; BD-09 CONSUMES it.
 *     - Journal CREATION / posting: a downstream, separately-gated step. BD-09 NEVER calls
 *       `create_financial_journal_entry` / `post_financial_journal_entry` and NEVER creates a
 *       journal (`journalEntryId` is null on every path — directive §10 / item 7).
 *
 * WHY EVERY OPTION IS INFRA-BLOCKED TODAY (verified, not assumed):
 *   PHASE-49 §9.1 lines 690-699: "no bonus RPC body calls `fn_financial_auto_entry`,
 *   `create_financial_journal_entry`, or `post_financial_journal_entry`"; "no bonus RPC body
 *   inserts into `financial_documents`, `financial_journal_entries`, or `financial_journal_lines`";
 *   "Bonus → accounting posting (any event): TECHNICAL GAP + BUSINESS POLICY REQUIRED"
 *   (line 694). The only financial trigger is on invoices (0009:108, the E8 one-journal-per-
 *   invoice model — which is exactly what BD-09 A mirrors, but for bonus it is ABSENT) and
 *   driver-commission (0009:184, the quantity-only `trg_financial_bonus_inventory` which writes
 *   NO journal). `create_financial_journal_entry` / `post_financial_journal_entry` exist but are
 *   MANUAL + director-only (0010:278,308). So there are ZERO bonus journal entries to aggregate:
 *   every BD-09 option resolves to a `would_aggregate` (A/B) or `would_aggregate` (C) intent
 *   carrying a `POSTING_INFRASTRUCTURE_REQUIRED` gap — BD-09 declares the INTENDED aggregation and
 *   the precise infra that is absent, but never fabricates a journal. (directive §6: implement to
 *   the extent the infrastructure allows — and the bonus-posting infrastructure does not yet exist.)
 *   This is structurally identical to BD-08, which resolved every timing option to
 *   `would_post`/`would_schedule` + `TIMING_INFRASTRUCTURE_REQUIRED` for the same reason.
 *
 * OPTION SET (single source — directive §2/§3):
 *   Read from `accountingPolicies.ts` BD-09 ({A,B,C}) via `getPolicy('BD-09')` (directive §3).
 *   No option is invented; no option is hard-coded in the dispatch (directive §7). Grounded in
 *   PHASE-49 §11.3 (posting STATE S-1/S-2/S-3) + §4.3 (Q6 published marker); recorded in the
 *   registry's `dependencies`/`when`/`warning`:
 *     A = one journal per event  → one_per_event (mirrors invoice E8, 0009:108; §11.3 S-2).
 *     B = draft per event, review batch → draft_per_event_then_batch_review (S-1 draft + D7 owner review).
 *     C = periodic netting       → periodic_netting (T-3 sweep + S-3/S-1 netting; §11.1 T-3).
 *
 * SNAPSHOT NAMESPACE (directive §11 / §6):
 *   BD-01..BD-07 + BD-08 all key their write-once snapshot on the SAME globally-unique
 *   `bonus_ledger.id` (the TRUE event identity). BD-09 governs AGGREGATION for the SAME rows
 *   (E1-E12), so reusing the bare prefix or `.timing.` would COLLIDE with an event's
 *   account-policy snapshot (BD-01..BD-07) or timing snapshot (BD-08). BD-09 therefore uses the
 *   namespaced `accounting_policy.snapshot.aggregation.<ledgerId>` — same `bonus_settings` table
 *   + director `for all` RLS, no new table, no migration, write-once.
 *
 * CORE RULES (honored literally — directive §1/§2/§5/§6/§10/§12):
 *   - The policy is NEVER chosen by code. `accounting_policy.BD-09` is read LIVE at aggregation-
 *     resolution time and validated against BD-09's registered option set. No `const BD09 = …`,
 *     no `policy ?? "A"`.
 *   - Missing policy → POLICY_NOT_CONFIGURED (reused from BD-01; value 'ACCOUNTING_POLICY_NOT_CONFIGURED',
 *     directive §3 item 4); invalid/unregistered → fail_closed POLICY_INVALID (directive §3 item 5).
 *   - Company note: `bonus_settings` / `bonus_ledger` carry NO `company_id` (0018:50-114,
 *     0018:80-86; PHASE-49 §1.4 fault line — ACC-10), so the read is global. Passing a `companyId`
 *     produces a COMPANY_POLICY_ISOLATION_GAP diagnostic (ACC-10) rather than a silent
 *     cross-company read.
 *   - Aggregation identity: the per-event TRUE identity is `bonus_ledger.id` (stable, exists) —
 *     used as the snapshot key and as the source reference. No 4th option, no invented batch key,
 *     no invented journal number (directive §6/§7). `AGGREGATION_IDENTITY_REQUIRED` is emitted
 *     only where a GROUP identity genuinely cannot be formed (option C's company-scoped netting
 *     key — company is absent on bonus rows, ACC-10), NOT invented to replace it.
 *   - Deduplication reuses the existing `bonus_ledger.idempotency_key` UNIQUE constraint (0018:73)
 *     — no secondary idempotency mechanism is invented (directive §6).
 *   - BD-09 does NOT consult / replace BD-01..BD-08 (directive §12): it is the aggregation layer
 *     ADJACENT to them. The three-layer decomposition (directive §10) is made explicit.
 *
 * Sources of truth (verified in-repo, not assumed):
 *  - accountingPolicies.ts → BD-09 options {A,B,C} (§11.3 S-1/S-2/S-3, §4.3 Q6).
 *  - PHASE-49 §9.1 lines 690-699 + §3 → bonus-posting infra absence (TECHNICAL GAP, zero journals to aggregate).
 *  - 0018:50-114 → bonus_ledger (id PK; txn_type includes REVERSAL/EXPIRATION/REVERSAL/EXPIRATION;
 *    idempotency_key UNIQUE 0018:73; NO company_id — ACC-10; POSTED rows immutable 0018:98-112).
 *  - 0006:144-145 → financial_documents.source_table='bonus_ledger' + source_id (R-1 reference shape
 *    available for a future poster; unused by BD-09 itself).
 *  - 0006:152-163 → financial_journal_entries (company_id NOT NULL → financial_companies 0006:154;
 *    entry_date accounting clock 0006:156; period_id 0006:157; source_document_id 0006:159;
 *    status draft|posted|voided 0006:160).
 *  - 0009:108-140 → invoice auto-journal E8 (one draft journal per invoice — the one-per-event model BD-09 A mirrors).
 *  - 0010:278,308 → create/post_financial_journal_entry (manual + director-only; period-closed guard 0010:333-339).
 */

import { getPolicy } from './accountingPolicies.ts';

// ── Keys ────────────────────────────────────────────────────────────────────────
/** Live director-chosen journal-entry aggregation policy (BD-09). */
export const BD09_POLICY_KEY = 'accounting_policy.BD-09';
/**
 * Per-event aggregation snapshot prefix. The suffix is the bonus_ledger.id (the TRUE event
 * identity — the same globally-unique key the event engines use). The `.aggregation.` segment
 * namespaces BD-09 from BD-01..BD-07's bare `accounting_policy.snapshot.<ledgerId>` AND from
 * BD-08's `.timing.<ledgerId>`, so an aggregation snapshot can never clobber an event's
 * account-policy or timing snapshot (or vice-versa). Stored via the EXISTING `bonus_settings`
 * table + director `for all` RLS — no new table, no migration. Write-once.
 */
export const BD09_SNAPSHOT_PREFIX = 'accounting_policy.snapshot.aggregation.';

// ── Shared fail-closed sentinels (reused from BD-01; never re-defined) ───────────
import {
  POLICY_NOT_CONFIGURED,
  POLICY_INVALID,
  COMPANY_POLICY_ISOLATION_GAP,
  type BonusEarnDeps,
  PolicyResolutionError,
} from './bonusAccountingPolicy.ts';

// ── BD-09-specific aggregation sentinels (additive; BD-01..BD-08 untouched) ───────
/**
 * The chosen aggregation option requires journal-entry creation / posting infrastructure that
 * does not exist in the repository today — no bonus RPC body creates or posts any journal entry,
 * and `create/post_financial_journal_entry` are manual + director-only. There are ZERO bonus
 * journal entries to aggregate. Emits on EVERY A/B/C path today (TECHNICAL GAP — PHASE-49 §9.1
 * lines 690-699). BD-09 NEVER builds the infra (directive §9) and NEVER fabricates a journal
 * (directive §10).
 */
export const POSTING_INFRASTRUCTURE_REQUIRED = 'POSTING_INFRASTRUCTURE_REQUIRED';

/**
 * The chosen aggregation option needs to form a STABLE GROUP identity to combine multiple
 * events into one journal entry, but that identity cannot be formed from the real schema.
 * Emitted ONLY where a group identity is genuinely required AND unformable — option C
 * (periodic netting), whose (period, company, account, event-type) key requires
 * `financial_companies.company_id` (0006:154), which `bonus_ledger` carries no `company_id` for
 * (ACC-10; PHASE-49 §1.4). BD-09 does NOT invent a replacement identity (directive §6).
 */
export const AGGREGATION_IDENTITY_REQUIRED = 'AGGREGATION_IDENTITY_REQUIRED';

// ── Deps alias (BD-09 reuses the BD-01 bonus_settings read/write store) ───────────
/** Storage abstraction (injectable → tests run with an in-memory fake). Same shape as BD-01/BD-08. */
export type AggregationDeps = BonusEarnDeps;

// ── BD-09 option letters (from the registry, not a literal) ────────────────────────
export type Bd09Option = string;
export const BD09_OPTIONS: readonly string[] = (() => {
  const policy = getPolicy('BD-09');
  return policy ? Object.freeze(policy.options.map((o) => o.value)) : [];
})();

/**
 * The aggregation MODE the BD-09 option maps to, BEFORE the infra check.
 *   A (one journal per event)     → 'one_per_event'                       (§11.3 S-2; mirrors invoice E8 0009:108).
 *   B (draft per event, review)   → 'draft_per_event_then_batch_review'   (S-1 draft + D7 owner review).
 *   C (periodic netting)          → 'periodic_netting'                    (T-3 sweep + S-3/S-1).
 */
export type AggregationMode =
  | 'one_per_event'
  | 'draft_per_event_then_batch_review'
  | 'periodic_netting';

/**
 * The full §4 aggregation plan for a registered option — evidence-grounded, not assumed.
 * Emitted on the would_aggregate effect for A/B/C. (directive §4)
 */
export interface AggregationPlan {
  /** The §11.3 / §4 mapping of option letter → aggregation mode. */
  aggregationMode: AggregationMode;
  /** Which events would be aggregated — grounded on bonus_ledger txn_type / POSTED (0018). */
  qualifyingEvents: string;
  /**
   * The proposed aggregation/group KEY — a stable bonus_ledger.id reference (the TRUE identity)
   * where formable; NULL where the group identity genuinely cannot be formed (option C — company
   * absent, ACC-10). BD-09 never invents a key to replace a null one (directive §6).
   */
  aggregationKey: string | null;
  /** Event conditions that MUST keep events in SEPARATE journal entries (never grouped). */
  separationConditions: string[];
  /** How double-counting is prevented — reuses the existing idempotency_key (0018:73). */
  deduplication: string;
  /** Whether the option is realisable today — always false (posting infra absent). */
  executable: boolean;
  /** Grounded, evidence-backed bullets of infrastructure that is absent (directive §3 item 9). */
  infra: string[];
}

/** The infra gap carried on every would_aggregate effect (echoes the engine's infra field). */
export interface AggregationInfraGap {
  code: typeof POSTING_INFRASTRUCTURE_REQUIRED;
  reason: string;
  /** Grounded bullets — identical to AggregationPlan.infra (ref'd, not duplicated on the plan). */
  infraMissing: string[];
  /** Secondary codes (e.g. AGGREGATION_IDENTITY_REQUIRED, COMPANY_POLICY_ISOLATION_GAP). */
  secondaryCodes: string[];
}

/**
 * The concrete aggregation EFFECT BD-09 can commit to given the real repository state.
 * Today every option is infra-blocked (TECHNICAL GAP — see file header), so the effect is a
 * `would_aggregate` (A/B/C intent) carrying a `POSTING_INFRASTRUCTURE_REQUIRED` gap (option C
 * additionally carries AGGREGATION_IDENTITY_REQUIRED + COMPANY_POLICY_ISOLATION_GAP). BD-09 NEVER
 * posts: `journalEntryId` is null on every path (directive §10 / item 7).
 */
export type AggregationEffect =
  | {
      kind: 'would_aggregate';
      mode: AggregationMode;
      plan: AggregationPlan;
      infra: AggregationInfraGap;
    }
  | { kind: 'fail_closed'; code: string; reason: string };

export interface AggregationContext {
  /** Real identity of the bonus event — `bonus_ledger.id` (the TRUE event identity). */
  identity: { ledgerId: string; idempotencyKey?: string | null; orderId?: string | null };
  /** The BD-09 option governs aggregation for ALL bonus events (E1-E12). */
  eventType: string;
  /** Best-effort current financial company (C-3 single-company assumption; ACC-10 gap). */
  companyId?: string | null;
}

export interface JournalAggregationDecision {
  /** BD-09 option resolved at aggregation time (null only when resolution failed). */
  option: string | null;
  /** The aggregation effect (would_aggregate | fail_closed). journalEntryId always null. */
  effect: AggregationEffect;
  /** Always null — BD-09 owns aggregation only, never creates a journal (directive §10). */
  journalEntryId: string | null;
  /** Stable idempotency key for THIS event's aggregation decision. */
  effectKey: string;
  /** Did an aggregation snapshot already exist for this event when we got here? */
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
   * - aggregation:   HOW the posting effects are grouped (BD-09 owns this; the §4 plan).
   * - posting:       journal creation — explicitly NOT performed by BD-09.
   */
  eventBoundary: { recordedAt: 'bonus_ledger.POSTED'; note: string };
  aggregation: { option: string | null; mode: AggregationMode | null; aggregationKey: string | null };
  posting: { journalEntryId: null; status: 'not_aggregated'; reason: string };
}

// ── Per-option behaviour: mode + evidence-grounded plan + absent infra ──────────
// The OPTION SET comes from BD09_OPTIONS (registry); only the per-letter mapping of
// option → (aggregation mode + aggregation plan + absent infra) is authored here, grounded in
// PHASE-49 §11 (posting STATE S-1/S-2/S-3) + §4.3 (Q6) + §9.1 (infra existence) + 0018/0006/0009/0010 DDL.
// No 4th option is invented (directive §2/§7).

/** Maps a registered BD-09 option letter to its aggregation MODE (null if unmapped). */
function modeFor(option: string): AggregationMode | null {
  if (option === 'A') return 'one_per_event'; // S-2
  if (option === 'B') return 'draft_per_event_then_batch_review'; // S-1 + D7
  if (option === 'C') return 'periodic_netting'; // T-3 + S-3/S-1
  return null;
}

/** Evidence-grounded per-option plan: qualifying events, key, separation, dedup, exec. */
function planFor(option: string): AggregationPlan | null {
  const mode = modeFor(option);
  if (mode === null) return null;

  let qualifyingEvents: string;
  let aggregationKey: string | null;
  let separationConditions: string[];
  let deduplication: string;
  let infra: string[];

  if (option === 'A') {
    // قيد واحد لكل حدث — one journal per event (1:1), mirrors invoice E8 (0009:108).
    qualifyingEvents =
      'Every POSTED bonus_ledger row whose BD-01..BD-07 accounting effect is would_post (an ' +
      'accounting-relevant event). The row is already POSTED + immutable (0018:98-112); BD-09 ' +
      'does not mutate it. Events with accountingEffect=no_entry are not aggregated (no journal ' +
      'row is produced for them). txn_types in scope: EARN, REDEEM_PRODUCT, ORDER_DISCOUNT, ' +
      'CASH_WITHDRAWAL, REFUND, REVERSAL, ADJUSTMENT, EXPIRATION (0018:57-62).';
    aggregationKey =
      'bonus_ledger.id (the TRUE event identity, 0018:50 PK) → financial_documents.source_id ' +
      '(R-1 reference shape, 0006:144-145) → financial_journal_entries.source_document_id ' +
      '(0006:159); 1:1 so no cross-event grouping. The journal line carries a source reference ' +
      'back to this single bonus_ledger row (ACC-12, BD-09 A `accountingImpact`).';
    separationConditions = [
      '1:1 — events are NEVER grouped; each event is isolated by its own bonus_ledger.id.',
      'Different txn_types are inherently separated (each in its own journal entry).',
      'Different fiscal periods are separated (entry_date 0006:156 + period_id 0006:157; ' +
      'post_financial_journal_entry refuses closed periods 0010:333-339).',
    ];
    deduplication =
      'bonus_ledger.idempotency_key is UNIQUE (0018:73) — the event itself cannot be ' +
      'double-created; the journal entry is keyed on source_document_id = bonus_ledger.id, so a ' +
      'reprocessed event matches the existing entry (idempotent at the source-trace layer). ' +
      'No new idempotency mechanism is invented (directive §6).';
    infra = [
      `No bonus RPC body or trigger creates journals — "no bonus RPC body calls ` +
      `create_financial_journal_entry or post_financial_journal_entry" and "no bonus RPC body ` +
      `inserts into financial_documents, financial_journal_entries, or financial_journal_lines" ` +
      `(PHASE-49 §3 / §9.1 lines 690-694). create/post_financial_journal_entry are manual + ` +
      `director-only (0010:278,308).`,
      `No trigger fires on bonus_ledger inserts — the only financial auto-entry trigger is on ` +
      `invoices (0009:108, the E8 one-journal-per-invoice model BD-09 A mirrors) and order_items ` +
      `(0009:184, the quantity-only trg_financial_bonus_inventory which writes NO journal); ` +
      `nothing posts a bonus event — "Bonus → accounting posting (any event): TECHNICAL GAP + ` +
      `BUSINESS POLICY REQUIRED" (PHASE-49 §9.1 line 694).`,
    ];
    return { aggregationMode: mode, qualifyingEvents, aggregationKey, separationConditions, deduplication, executable: false, infra };
  }

  if (option === 'B') {
    // مسودة لكل حدث، إصدار مراجعة — draft per event, owner review batch.
    qualifyingEvents =
      'Same as A — every POSTED would_post bonus_ledger row. Each eligible event creates a ' +
      'DRAFT journal entry (financial_journal_entries.status=\'draft\', 0006:160); the drafts are ' +
      'held for a financial owner review (ACC-11; PHASE-49 §11.3 S-1).';
    aggregationKey =
      'The DRAFT is keyed 1:1 on bonus_ledger.id (source_document_id → financial_documents ' +
      'R-1, 0006:144-145); the OWNER REVIEW BATCH groups drafts by (financial_periods.period, ' +
      '0007:22-35; account role, 0007:38-60; event type). BUT bonus events carry NO company_id ' +
      '(0018:50-114; PHASE-49 §1.4), so the review-batch key cannot be company-scoped.';
    separationConditions = [
      'Drafts from different fiscal periods cannot be in the same review batch (period boundary ' +
      '0007:22-35; post refuses closed periods 0010:333-339).',
      'Drafts for different GL accounts cannot be netted (each account role is distinct, 0007:38-60).',
      'Drafts for different txn_types are reviewed separately (E1-E12 semantics differ).',
      'Drafts for different companies cannot be merged — but company is absent on bonus (ACC-10 gap).',
    ];
    deduplication =
      'bonus_ledger.idempotency_key UNIQUE (0018:73) + draft keyed on bonus_ledger.id; releasing a ' +
      'review batch must mark drafts posted/voided via financial_journal_entries.status (0006:160) ' +
      'to avoid re-issuing — no published-marker column exists on bonus_ledger today ' +
      '(PHASE-49 §4.3 Q6; §11.1 T-3 "needs a published marker that does not exist today").';
    infra = [
      `No draft journal is wired to bonus_ledger events — create_financial_journal_entry supports ` +
      `draft status (0010:278) and the invoice path drafts journals (0009:77-78), but no bonus ` +
      `trigger/RPC creates a draft for a bonus row (PHASE-49 §9.1 line 694 TECHNICAL GAP; §11.3 S-1).`,
      'No owner approval/release flow exists for bonus journal drafts (ACC-11; PHASE-49 §11.3 S-1 ' +
      'warning: "unreviewed drafts could accumulate silently").',
      'No published/posted-marker column on bonus_ledger to track draft-vs-published state ' +
      '(PHASE-49 §4.3 Q6; §11.1 T-3).',
      'Company isolation unverifiable: the review-batch key requires ' +
      'financial_companies.company_id (0006:154) but bonus_ledger/bonus_settings carry no ' +
      'company_id (ACC-10; PHASE-49 §1.4).',
    ];
    return { aggregationMode: mode, qualifyingEvents, aggregationKey, separationConditions, deduplication, executable: false, infra };
  }

  if (option === 'C') {
    // توحيد دوري — periodic netting into ONE entry per (period, company, account, event type).
    qualifyingEvents =
      'All POSTED would_post bonus_ledger rows within a fiscal period, to be NETTED into ONE ' +
      'journal entry per (period, company, account, event type) at period close (PHASE-49 §11.3 S-3).';
    // aggregationKey is NULL: the company-scoped group identity genuinely cannot be formed —
    // bonus events carry no company_id (ACC-10), so the (period, company, account, event-type)
    // net key is unformable. BD-09 emits AGGREGATION_IDENTITY_REQUIRED rather than inventing a
    // replacement key (directive §6); the reason is grounded in the infra bullets below.
    aggregationKey = null;
    separationConditions = [
      'Events in different fiscal periods cannot be netted (period boundary 0007:22-35; ' +
      'post refuses closed periods 0010:333-339).',
      'Events for different companies cannot be netted — company absent on bonus (ACC-10).',
      'Events for different GL accounts cannot be netted (net only within one account role 0007).',
      'Events of different txn_types net separately (E1-E12 semantics differ).',
    ];
    deduplication =
      'Would require a posted/published marker on each bonus_ledger row (or on the journal) to ' +
      'know which rows are already netted into a batch — no such marker exists (PHASE-49 §4.3 Q6; ' +
      '§11.1 T-3). No secondary idempotency is invented (directive §6).';
    infra = [
      `No bonus journal entries exist to net — no bonus RPC creates/inserts any journal entry or ` +
      `line (PHASE-49 §9.1 lines 690-694 TECHNICAL GAP; §9.1 line 694). The aggregation operates on ` +
      `journal entries that are never produced.`,
      'No scheduler/worker exists anywhere to run the periodic net/sweep — "Expiry scheduling: ' +
      'TECHNICAL GAP — no scheduler anywhere" (PHASE-49 §9.1 line 699; §11.1 T-3).',
      'No published/posted-marker column on bonus_ledger to dedupe netted rows (PHASE-49 §4.3 Q6; ' +
      '§11.1 T-3).',
      `Aggregation identity unformable: the (period, company, account, event-type) net key ` +
      `requires financial_companies.company_id (0006:154), absent on bonus rows (ACC-10; ` +
      `PHASE-49 §1.4).`,
    ];
    return { aggregationMode: mode, qualifyingEvents, aggregationKey, separationConditions, deduplication, executable: false, infra };
  }

  return null;
}

/** Evidence-grounded infra gap per option (echoes plan.infra; adds secondary codes). */
function infraGapFor(option: string): AggregationInfraGap | null {
  const plan = planFor(option);
  if (plan === null) return null;
  if (option === 'A') {
    return {
      code: POSTING_INFRASTRUCTURE_REQUIRED,
      reason:
        `${POSTING_INFRASTRUCTURE_REQUIRED}: BD-09 ${option} (one journal per event) requires ` +
        `journal-entry creation/posting infrastructure that does not exist for bonus events ` +
        `(PHASE-49 §9.1 lines 690-694: "Bonus → accounting posting (any event): TECHNICAL GAP + ` +
        `BUSINESS POLICY REQUIRED"). BD-09 declares the intended aggregation but does NOT build ` +
        `the infra (directive §9) and does NOT create a journal (directive §10).`,
      infraMissing: plan.infra,
      secondaryCodes: [],
    };
  }
  if (option === 'B') {
    return {
      code: POSTING_INFRASTRUCTURE_REQUIRED,
      reason:
        `${POSTING_INFRASTRUCTURE_REQUIRED}: BD-09 ${option} (draft per event + owner review ` +
        `batch) requires a bonus-wired draft journal + approval flow that does not exist ` +
        `(PHASE-49 §9.1 line 694 TECHNICAL GAP; §11.3 S-1). BD-09 declares the intended ` +
        `aggregation but does NOT build the infra (directive §9) and does NOT create a journal ` +
        `(directive §10).`,
      infraMissing: plan.infra,
      secondaryCodes: [COMPANY_POLICY_ISOLATION_GAP],
    };
  }
  if (option === 'C') {
    return {
      code: POSTING_INFRASTRUCTURE_REQUIRED,
      reason:
        `${POSTING_INFRASTRUCTURE_REQUIRED}: BD-09 ${option} (periodic netting into ONE entry per ` +
        `(period, company, account, event-type)) requires bonus journal entries to net + a ` +
        `scheduler, neither of which exists (PHASE-49 §9.1 lines 690-699; line 694 TECHNICAL GAP; ` +
        `line 699 "no scheduler anywhere"). BD-09 declares the intended aggregation but does NOT ` +
        `build the infra (directive §9) and does NOT create a journal (directive §10).`,
      infraMissing: plan.infra,
      secondaryCodes: [AGGREGATION_IDENTITY_REQUIRED, COMPANY_POLICY_ISOLATION_GAP],
    };
  }
  return null;
}

// ── 1. Resolve the CURRENT live policy (fail-closed, no default) ───────────────────
/**
 * Reads `accounting_policy.BD-09` from settings and validates it against BD-09's
 * registered option set {A,B,C} (from `accountingPolicies.ts` via `getPolicy('BD-09')`).
 *
 * Throws POLICY_NOT_CONFIGURED ('ACCOUNTING_POLICY_NOT_CONFIGURED') / POLICY_INVALID — the
 * caller decides how to surface it; this function NEVER substitutes a default option.
 *
 * Company note: `bonus_settings` carries NO `company_id` (0018 DDL; PHASE-49 §1.4 fault line),
 * so the read is global. Passing a `companyId` produces a COMPANY_POLICY_ISOLATION_GAP
 * diagnostic (ACC-10) rather than a silent cross-company read.
 */
export async function resolveBonusAggregationPolicy(
  deps: AggregationDeps,
  companyId?: string | null,
): Promise<{ option: string; diagnostics: string[] }> {
  const raw = await deps.readSetting(BD09_POLICY_KEY);
  if (raw == null || raw === '') {
    throw new PolicyResolutionError(
      POLICY_NOT_CONFIGURED,
      'BD-09 is not configured; refusing to assume a journal-entry aggregation policy (no silent default).',
    );
  }
  const candidate = String(raw);
  if (!BD09_OPTIONS.includes(candidate)) {
    throw new PolicyResolutionError(
      POLICY_INVALID,
      `BD-09 option "${candidate}" is not one of the registered alternatives (${BD09_OPTIONS.join(', ') || 'none'}).`,
    );
  }
  const diagnostics: string[] = [];
  if (companyId) {
    diagnostics.push(COMPANY_POLICY_ISOLATION_GAP);
  }
  return { option: candidate, diagnostics };
}

// ── 2. Snapshot the policy in force for THIS event (history protection) ────────────
/**
 * Persists `accounting_policy.snapshot.aggregation.<ledgerId>` = option via the existing
 * director-writable `bonus_settings` (no new table, no migration). Idempotent: if an aggregation
 * snapshot already exists for this event's TRUE identity (bonus_ledger.id) it is left untouched,
 * so a later director flip (A→B) never rewrites an event's recorded aggregation. The `.aggregation.`
 * namespace avoids colliding with the event-account-policy snapshots (BD-01..BD-07) or the timing
 * snapshots (BD-08), which key the same ledgerId under different prefixes.
 */
export async function snapshotBonusAggregationPolicy(
  ledgerId: string,
  option: string,
  deps: AggregationDeps,
): Promise<{ written: boolean }> {
  const key = `${BD09_SNAPSHOT_PREFIX}${ledgerId}`;
  const existing = await deps.readSetting(key);
  if (existing != null) return { written: false };
  await deps.upsertSetting(key, option);
  return { written: true };
}

/** Which BD-09 aggregation option was in force when this event was processed. */
export async function getHistoricalBonusAggregationPolicy(
  ledgerId: string,
  deps: AggregationDeps,
): Promise<{ option: string | null; source: 'snapshot' | 'none' }> {
  const raw = await deps.readSetting(`${BD09_SNAPSHOT_PREFIX}${ledgerId}`);
  if (raw == null) return { option: null, source: 'none' };
  const opt = String(raw);
  return { option: BD09_OPTIONS.includes(opt) ? opt : null, source: 'snapshot' };
}

// ── 3. Dispatch A / B / C for this event (aggregation plan + infra gap; NO journal) ──
/**
 * Resolve the current BD-09 policy, snapshot it for THIS event (on the event's TRUE identity —
 * bonus_ledger.id), and return the concrete journal-entry-aggregation decision.
 *
 * Does NOT create journal entries (`create_financial_journal_entry` / `post_financial_journal_entry`
 * are never called — directive §10). Does NOT mutate bonus_ledger (the event row was already
 * recorded POSTED by the event engine).
 *
 * Per-option behaviour, grounded in PHASE-49 §11 (posting STATE S-1/S-2/S-3) + §4.3 (Q6) +
 * §9.1 (infra existence) + 0018/0006/0009/0010 DDL — directive §6 (implement to the extent infra
 * allows):
 *   A (one per event)           → would_aggregate (one_per_event); zero journals exist →
 *                                  POSTING_INFRASTRUCTURE_REQUIRED.
 *   B (draft + batch review)    → would_aggregate (draft_per_event_then_batch_review); infra absent
 *                                  → POSTING_INFRASTRUCTURE_REQUIRED + COMPANY_POLICY_ISOLATION_GAP
 *                                  (review-batch key company-scoped; company absent — ACC-10).
 *   C (periodic netting)        → would_aggregate (periodic_netting); grouping identity unformable
 *                                  (company absent — ACC-10) → POSTING_INFRASTRUCTURE_REQUIRED +
 *                                  AGGREGATION_IDENTITY_REQUIRED + COMPANY_POLICY_ISOLATION_GAP.
 *
 * BD-09 does NOT consult / replace BD-01..BD-07's accounting policy (directive §12); it is the
 * aggregation layer ADJACENT to them. The accounting/timing decisions are consumed by the dormant
 * seam (`resolveBonusJournalAggregation.ts`), not by this pure engine.
 *
 * Idempotency: the snapshot is keyed by the event's TRUE identity (bonus_ledger.id) and written
 * once; re-dispatch yields `alreadyHadPolicySnapshot: true` and an identical effect.
 */
export async function applyBonusAggregationPolicy(
  ctx: AggregationContext,
  deps: AggregationDeps,
): Promise<JournalAggregationDecision> {
  const { ledgerId } = ctx.identity;
  const effectKey = `bd09:aggregation:${ledgerId}`;
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
    const resolved = await resolveBonusAggregationPolicy(deps, ctx.companyId);
    option = resolved.option;
    resolveDiagnostics = resolved.diagnostics;
  } catch (e) {
    const err = e as PolicyResolutionError;
    const code = err.code ?? 'UNKNOWN';
    return failClosed(code, `${code}: ${err.message}`, effectKey, sourceTrace, layers, resolveDiagnostics);
  }

  // (2) Snapshot the policy in force for THIS event (idempotent, history-safe).
  const snap = await snapshotBonusAggregationPolicy(ledgerId, option, deps);

  // (3) Dispatch per option: aggregation plan + evidence-grounded infra gap. BD-09 NEVER posts.
  const mode = modeFor(option);
  const plan = planFor(option);
  const gap = infraGapFor(option);
  if (mode === null || plan === null || gap === null) {
    // Registered but unmapped — defensive (should not happen with a valid registry).
    return failClosed(
      POLICY_INVALID,
      `BD-09 option "${option}" is registered but has no aggregation mapping (unexpected registry shape).`,
      effectKey,
      sourceTrace,
      layers,
      resolveDiagnostics,
    );
  }

  const diagnostics = [...resolveDiagnostics, POSTING_INFRASTRUCTURE_REQUIRED, ...gap.secondaryCodes];

  const effect: AggregationEffect = {
    kind: 'would_aggregate',
    mode,
    plan,
    infra: gap,
  };

  return {
    option,
    effect,
    journalEntryId: null,
    effectKey,
    alreadyHadPolicySnapshot: !snap.written,
    diagnostics,
    sourceTrace,
    eventBoundary: layers.eventBoundary,
    aggregation: {
      option,
      mode,
      aggregationKey: plan.aggregationKey,
    },
    posting: layers.posting,
  };
}

// ── Three-layer helpers (directive §10), shared by success + fail_closed paths ────
function buildLayers(): {
  eventBoundary: JournalAggregationDecision['eventBoundary'];
  aggregation: JournalAggregationDecision['aggregation'];
  posting: JournalAggregationDecision['posting'];
} {
  return {
    eventBoundary: {
      recordedAt: 'bonus_ledger.POSTED',
      note:
        'Event Boundary is owned by the event engine (BD-01..BD-07): the bonus_ledger row is ' +
        'already recorded as POSTED at the business act. BD-09 consumes it and decides only the ' +
        'journal-entry aggregation.',
    },
    // fail_closed default — succeed() overwrites `option`/`mode`/`aggregationKey` with the
    // resolved option's values; fail_closed keeps the nulls.
    aggregation: { option: null, mode: null, aggregationKey: null },
    posting: {
      journalEntryId: null,
      status: 'not_aggregated' as const,
      reason:
        'BD-09 owns journal-entry aggregation only — journal entry creation is a downstream, ' +
        'separately-gated posting step. BD-09 never calls create_financial_journal_entry / ' +
        'post_financial_journal_entry and never creates a journal (directive §10).',
    },
  };
}

function failClosed(
  code: string,
  reason: string,
  effectKey: string,
  sourceTrace: JournalAggregationDecision['sourceTrace'],
  layers: ReturnType<typeof buildLayers>,
  diagnostics: string[] = [],
): JournalAggregationDecision {
  return {
    option: null,
    effect: { kind: 'fail_closed', code, reason },
    journalEntryId: null,
    effectKey,
    alreadyHadPolicySnapshot: false,
    diagnostics,
    sourceTrace,
    eventBoundary: layers.eventBoundary,
    aggregation: layers.aggregation,
    posting: layers.posting,
  };
}
