/**
 * BD-10 COMPANY-SCOPED CHART OF ACCOUNTS POLICY — Dynamic, director-controlled engine.
 *
 * ⚠️ SCOPE: BD-10 (HOW bonus accounting is SCOPED to a company + COA) ONLY. BD-10 decides the
 * company scope and the account-resolution mode for a posted bonus event's eventual journal
 * entry; it does NOT decide whether an event posts (BD-01..BD-07), when it is published (BD-08),
 * how its journal entries are aggregated (BD-09), or the actual GL account mapping (that remains
 * BD-01..BD-07's ACCOUNT_MAPPING_REQUIRED domain — BD-10 does NOT override it).
 *
 * WHAT BD-10 OWNS (and does NOT own) — directive §10:
 *   BD-10 owns Company Scope + Account Resolution. It does NOT own:
 *     - Event Boundary: bonus_ledger.POSTED (owned by the event engine BD-01..BD-07; BD-10 consumes it).
 *     - Accounting decision (no_entry/would_post/fail_closed): BD-01..BD-07; BD-10 CONSUMES it
 *       (see the dormant seam `resolveBonusCompanyCoaForEvent`).
 *     - Publish timing: BD-08; Journal-entry aggregation: BD-09; BD-10 CONSUMES both.
 *     - Journal CREATION / posting: a downstream, separately-gated step. BD-10 NEVER calls
 *       `create_financial_journal_entry` / `post_financial_journal_entry` and NEVER creates a
 *       journal (`journalEntryId` is null on every path — directive §10).
 *
 * WHY EVERY OPTION IS INFRA-AFFECTED TODAY (verified, not assumed):
 *   PHASE-49 §9.1 lines 690-699: "no bonus RPC body calls create/post_financial_journal_entry" /
 *   "no bonus RPC body inserts into financial_documents, financial_journal_entries,
 *   financial_journal_lines" — "Bonus → accounting posting (any event): TECHNICAL GAP + BUSINESS
 *   POLICY REQUIRED" (line 694); "no scheduler anywhere" (line 699). The only financial triggers
 *   are on invoices (0009:108) and order_items (0009:184, quantity-only, NO journal). So there are
 *   ZERO bonus journal entries / ZERO bonus journal lines to scope or resolve against today —
 *   BD-10 declares the INTENDED company scope + account resolution for each registered option and
 *   the precise infra gap, but never fabricates a journal, a company, or an account.
 *   (directive §6: implement to the extent infra allows — and the bonus-posting infra does not yet exist.)
 *
 * THE COMPANY-SCOPING GAP (ACC-10, proven, not assumed):
 *   - `financial_accounts` (0006:92-103) is company-SCOPED: `company_id uuid NOT NULL` →
 *     financial_companies (0006:154); the seeded chart (0007:46-54, §5.2) is planted PER company.
 *   - `financial_journal_entries` (0006:152-163) is company-SCOPED too (`company_id NOT NULL`).
 *   - `bonus_ledger` (0018:50-114) and `bonus_settings` (0018:285-287) carry NO `company_id`.
 *   ⇒ A bonus event cannot be attributed to a company from the bonus row itself — only via an
 *     external assumption. This is the ACC-10 fault line (PHASE-49 §1.4). BD-10 surfaces it,
 *     never silently assumes.
 *
 * OPTION SET (single source — directive §2/§3):
 *   Read from `accountingPolicies.ts` BD-10 ({A,B,C}) via `getPolicy('BD-10')` (directive §3).
 *   No option is invented; no option is hard-coded in the dispatch (directive §7). Grounded in
 *   PHASE-49 §11.4 (C-1/C-2/C-3 company eligibility), §5.2 (seeded COA), §4.2 (the company gap):
 *     A = شركة واحدة + إطار حسابات موجود (single company + existing seeded COA) → single_company /
 *         existing_seeded_coa; scope = the single company via C-3 (0009:57-60), ACC-10-flagged.
 *     B = محفظة متعددة الشركات (multi-company wallet) → multi_company / company_coa; scope =
 *         company_id columns on the bonus tables — SCHEMA CHANGE required (prohibited, §1/§9).
 *     C = ربط الفرع بالشركة عند النشر (branch→company at publish) → branch_resolved /
 *         template_with_override; scope = branch→company map — absent (§4.2), and some events
 *         (CASH_WITHDRAWAL / EXPIRATION) are branch-less (client-level).
 *
 * SNAPSHOT NAMESPACE (directive §11 / §6):
 *   BD-01..BD-07 + BD-08 (.timing.) + BD-09 (.aggregation.) all key their write-once snapshot on
 *   the SAME globally-unique `bonus_ledger.id`. BD-10 does too (the company-COA policy in force for
 *   THIS event), under the namespaced `accounting_policy.snapshot.company_coa.<ledgerId>` — same
 *   `bonus_settings` table + director `for all` RLS, no new table, no migration, write-once.
 *   BD-10 NEVER snapshots by company (it does not use bonus_ledger.id as a company id — directive
 *   §6): the snapshot is per-EVENT (bonus_ledger.id), recording the scope rule applied to that
 *   event. Because bonus_settings has no company_id, the snapshot cannot be partitioned
 *   per-company — BD-10 records that as COMPANY_POLICY_ISOLATION_GAP (ACC-10) rather than
 *   inventing a company-scoped relation (directive §6).
 *
 * CORE RULES (honored literally — directive §1/§2/§3/§5/§6/§10/§12):
 *   - The policy is NEVER chosen by code. `accounting_policy.BD-10` is read LIVE and validated
 *     against BD-10's registered option set {A,B,C}. No `const BD10 = …`, no `policy ?? "A"`.
 *   - Missing policy → POLICY_NOT_CONFIGURED (reused from BD-01); invalid/unregistered →
 *     POLICY_INVALID (directive §3 item 4/5). Both throw — no silent default.
 *   - Company: `bonus_settings` / `bonus_ledger` carry NO `company_id` (0018 DDL; PHASE-49 §1.4),
 *     so the read is global. Passing a `companyId` surfaces COMPANY_POLICY_ISOLATION_GAP (ACC-10)
 *     — never a silent cross-company read, never a default company (directive §3 test 6).
 *   - No fabricated accounts/ids: BD-10 reports the seeded COA symbols (§5.2, provable from 0007)
 *     as `templateAccountCode`; `resolvedAccountId` is null unless provable, and BD-10 does NOT
 *     resolve a specific bonus GL account (that is BD-01..BD-07's ACCOUNT_MAPPING_REQUIRED — no
 *     2xxx account exists in the seeded chart, 0007:41-59). (directive §3 test 7)
 *   - BD-10 does NOT consult / replace BD-01..BD-09 (directive §12); it is the company-COA layer
 *     adjacent to them. Prior fail_closed diagnostics are PASSED THROUGH by the seam, never
 *     overridden.
 *
 * Sources of truth (verified in-repo, not assumed):
 *  - accountingPolicies.ts → BD-10 options {A,B,C} (§11.4 C-1/C-2/C-3, §5.2, §4.2).
 *  - PHASE-49 §9.1 lines 690-699 + §3 → bonus-posting infra absence (TECHNICAL GAP; zero journals to scope).
 *  - 0006:92-103 → financial_accounts (company_id NOT NULL — COA is company-scoped).
 *  - 0006:152-163 → financial_journal_entries (company_id NOT NULL — entries are company-scoped).
 *  - 0006:144-145 → financial_documents.source_table/source_id (R-1 shape; no bonus row populated).
 *  - 0007:12-13,46-54 → seeded single company 'MedLink' + seeded COA (1130/4000/5000/6000 + §5.2 15 symbols, no 2xxx).
 *  - 0009:57-60 → C-3 single-company helper (financial_companies order by created_at limit 1).
 *  - 0018:50-114,285-287 → bonus_ledger & bonus_settings (id PK; idempotency_key UNIQUE 0018:73;
 *    NO company_id — ACC-10; POSTED rows immutable 0018:98-112).
 */

import { getPolicy } from './accountingPolicies.ts';

// ── Keys ────────────────────────────────────────────────────────────────────────
/** Live director-chosen company-COA policy (BD-10). A single global setting (NOT per-company). */
export const BD10_POLICY_KEY = 'accounting_policy.BD-10';
/**
 * Per-event company-COA snapshot prefix. The suffix is the bonus_ledger.id (the TRUE event
 * identity — the same globally-unique key the event engines use). The `.company_coa.` segment
 * namespaces BD-10 from BD-01..BD-07's bare `accounting_policy.snapshot.<ledgerId>`, from BD-08's
 * `.timing.<ledgerId>`, and from BD-09's `.aggregation.<ledgerId>`, so a company-COA snapshot can
 * never clobber an event's account-policy / timing / aggregation snapshot (or vice-versa). Stored
 * via the EXISTING `bonus_settings` table + director `for all` RLS — no new table, no migration.
 * Write-once. NOTE: this snapshot is per-EVENT (bonus_ledger.id), NOT per-company — bonus has no
 * company column, so it cannot be partitioned per company (ACC-10); the per-company gap is recorded
 * as a diagnostic, not invented (directive §6).
 */
export const BD10_SNAPSHOT_PREFIX = 'accounting_policy.snapshot.company_coa.';

// ── Shared fail-closed sentinels (reused from BD-01; never re-defined) ───────────
import {
  POLICY_NOT_CONFIGURED,
  POLICY_INVALID,
  COMPANY_POLICY_ISOLATION_GAP,
  type BonusEarnDeps,
  PolicyResolutionError,
} from './bonusAccountingPolicy.ts';

// ── BD-10-specific infrastructure sentinels (additive; BD-01..BD-09 untouched) ────
/**
 * Option B (محفظة متعددة الشركات) requires adding `company_id` columns to the bonus tables
 * (BD-10 `when`: "بعد إضافة أعمدة الشركة وتحديث جميع RPC"). That is a SCHEMA CHANGE / migration,
 * which is PROHIBITED in this phase (directive §1/§9: "لا تنشئ Migration أو DDL أو جداول أو أعمدة").
 * BD-10 declares B as the intended scope and surfaces this gap — it does NOT perform the migration.
 */
export const SCHEMA_MIGRATION_REQUIRED = 'SCHEMA_MIGRATION_REQUIRED';

/**
 * Option C (ربط الفرع بالشركة عند النشر) resolves the company from the branch/domain at publish
 * time, which requires a branch→company mapping table that does NOT exist in the repository
 * (PHASE-49 §4.2; the registry warning: "خريطة فرع→شركة غير موجودة اليوم"). BD-10 declares C as the
 * intended scope and surfaces this gap — it does NOT invent a branch→company relation.
 */
export const BRANCH_COMPANY_MAP_REQUIRED = 'BRANCH_COMPANY_MAP_REQUIRED';

// ── Deps alias (BD-10 reuses the BD-01 bonus_settings read/write store) ───────────
/** Storage abstraction (injectable → tests run with an in-memory fake). Same shape as BD-01/BD-08/BD-09. */
export type CoaDeps = BonusEarnDeps;

// ── BD-10 option letters (from the registry, not a literal) ────────────────────────
export type Bd10Option = string;
export const BD10_OPTIONS: readonly string[] = (() => {
  const policy = getPolicy('BD-10');
  return policy ? Object.freeze(policy.options.map((o) => o.value)) : [];
})();

/**
 * The company scope a BD-10 option maps to, BEFORE the infra check — grounded in the registry
 * definitions (§11.4 C-1/C-2/C-3 + §4.2).
 *   A (single company + existing COA)  → 'single_company'            (C-3 single-company assumption, 0009:57-60).
 *   B (multi-company wallet)          → 'multi_company'             (company_id columns on bonus tables — needs migration).
 *   C (branch→company at publish)    → 'branch_resolved'           (branch→company map — absent).
 */
export type CompanyScope = 'single_company' | 'multi_company' | 'branch_resolved';

/**
 * The account-resolution mode a BD-10 option maps to — grounded in §5.2 (seeded COA).
 *   A → 'existing_seeded_coa'       (reuse the seeded 1130/4000/5000/6000… chart, 0007:46-54).
 *   B → 'company_coa'               (each company builds its own chart from its company_id — needs migration).
 *   C → 'template_with_override'    (shared template COA + branch→company overrides — needs map).
 */
export type AccountResolutionMode = 'existing_seeded_coa' | 'company_coa' | 'template_with_override';

/** Whether the option is realisable today given the real schema. */
export type ExecutionStatus = 'would_resolve' | 'blocked';

/**
 * The full §5 resolution plan for a registered option — evidence-grounded, not assumed.
 * Emitted on the would_resolve effect for A/B/C. (directive §5)
 */
export interface CompanyCoaPlan {
  /** The §11.3 / §4 mapping of option letter → account-resolution mode + company scope. */
  companyScope: CompanyScope;
  /** How accounts are resolved against the COA. */
  accountResolutionMode: AccountResolutionMode;
  /**
   * The provable seeded COA reference (§5.2 / 0007:46-54: 1130/4000/5000/6000 + 11 symbols; NO 2xxx
   * future-discount symbol exists today). BD-10 does NOT fabricate account codes — this references
   * what actually exists in the seeded chart. null only if the registry had none to ground.
   */
  templateAccountCode: string | null;
  /**
   * The provable company id — ONLY when a companyId was passed in AND verifiable. BD-10 NEVER
   * defaults a company (directive §3 test 6): null when no company context exists. For option A the
   * LIVE adapter resolves this via the C-3 single-company helper (0009:57-60), re-emitted as
   * COMPANY_POLICY_ISOLATION_GAP (ACC-10); options B/C cannot resolve one (no company column / map).
   */
  resolvedCompanyId: string | null;
  /**
   * The provable GL account id for the bonus entry — BD-10 NEVER resolves one. The seeded COA has
   * no bonus-liability / future-discount (2xxx) account (0007:41-59; §5.2: "لا توجد رموز خصم مستقبلي"),
   * so a concrete bonus GL account is BD-01..BD-07's ACCOUNT_MAPPING_REQUIRED domain, which BD-10
   * does NOT override. Always null here so no account id is ever fabricated (directive §3 test 7).
   */
  resolvedAccountId: string | null;
  /** Whether a company-specific override is active (B requires a migration; C a map) — false today. */
  companyOverrideApplied: boolean;
  /** Whether the option is realisable today. */
  executionStatus: ExecutionStatus;
  /** Grounded, evidence-backed bullets of infrastructure that is absent (directive §3 item 9). */
  infra: string[];
}

/** The infra gap carried on every would_resolve effect (echoes the plan's infra field). */
export interface CompanyCoaInfraGap {
  code: string; // the primary gap code (shared COMPANY_POLICY_ISOLATION_GAP or BD-10-local)
  reason: string;
  /** Grounded bullets — identical to CompanyCoaPlan.infra (ref'd, not duplicated on the plan). */
  infraMissing: string[];
  /** Secondary codes (e.g. SCHEMA_MIGRATION_REQUIRED, BRANCH_COMPANY_MAP_REQUIRED, COMPANY_POLICY_ISOLATION_GAP). */
  secondaryCodes: string[];
}

/**
 * The concrete company-scope / account-resolution EFFECT BD-10 can commit to given the real
 * repository state. Today the bonus-posting infra is a TECHNICAL GAP (PHASE-49 §9.1), so BD-10 does
 * NOT create journals: `journalEntryId` is null on every path (directive §10). It also never
 * fabrics a company or account — `would_resolve` describes the intended scope + the gap.
 */
export type CompanyCoaEffect =
  | {
      kind: 'would_resolve';
      plan: CompanyCoaPlan;
      infra: CompanyCoaInfraGap;
    }
  | { kind: 'fail_closed'; code: string; reason: string };

export interface CompanyCoaContext {
  /** Real identity of the bonus event — `bonus_ledger.id` (the TRUE event identity). */
  identity: { ledgerId: string; idempotencyKey?: string | null; orderId?: string | null };
  /** The BD-10 option governs company scope + COA for ALL bonus events (E1-E12). */
  eventType: string;
  /** Best-effort current financial company (C-3 single-company assumption; ACC-10 gap). */
  companyId?: string | null;
}

export interface CompanyCoaDecision {
  /** BD-10 option resolved at resolution time (null only when resolution failed). */
  option: string | null;
  /** The company-scope effect (would_resolve | fail_closed). journalEntryId always null. */
  effect: CompanyCoaEffect;
  /** Always null — BD-10 owns company scope + account resolution only, never creates a journal. */
  journalEntryId: string | null;
  /** Stable idempotency key for THIS event's company-COA decision. */
  effectKey: string;
  /** Did a company-COA snapshot already exist for this event when we got here? */
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
   * - companyCoa:    HOW the event is scoped to a company + COA (BD-10 owns this; the §5 plan).
   * - posting:       journal creation — explicitly NOT performed by BD-10.
   */
  eventBoundary: { recordedAt: 'bonus_ledger.POSTED'; note: string };
  companyCoa: { option: string | null; companyScope: CompanyScope | null; accountResolutionMode: AccountResolutionMode | null };
  posting: { journalEntryId: null; status: 'not_scoped'; reason: string };
}

// ── Seeded COA reference (provable from 0007:46-54 / §5.2, NOT fabricated) ────────
/**
 * The seeded chart of accounts actually present in the repository (0007:46-54; PHASE-49 §5.2:
 * "15 symbols: … 1130/4000/5000/6000…"). BD-10 references these — it does NOT invent account
 * codes. §5.2 also states "لا توجد رموز خصم مستقبلي أو تكلفة بونص في الإطار الحالي" (no future-discount
 * / bonus-cost symbol) — the 2xxx account is explicitly NOT present (so the bonus GL account
 * resolution remains BD-01..BD-07's ACCOUNT_MAPPING_REQUIRED domain; BD-10 does not override it).
 */
const SEEDED_COA_REFERENCE =
  'seeded COA §5.2 (0007:46-54): 1130 العملاء_والذمم_المدينة (asset/debit), ' +
  '4000 الإيرادات (revenue/credit), 5000 تكلفة_المبيعات (cogs/debit), 6000 المصروفات (expense/debit), ' +
  '+ 11 other symbols (15 total); NO future-discount/2xxx symbol exists today "لا توجد رموز خصم ' +
  'مستقبلي أو تكلفة بونص في الإطار الحالي".';

// ── Per-option behaviour: scope/mode + evidence-grounded plan + absent infra ──────
// The OPTION SET comes from BD10_OPTIONS (registry); only the per-letter mapping of
// option → (company scope + account mode + absent infra) is authored here, grounded in
// PHASE-49 §11.3/§11.4 (scope), §5.2 (seeded COA) + §4.2 (the company gap) + §9.1 (infra existence)
// + 0006/0007/0009/0018 DDL. No 4th option is invented (directive §2/§7).

function scopeFor(option: string): CompanyScope | null {
  if (option === 'A') return 'single_company'; // §11.4 C-3
  if (option === 'B') return 'multi_company'; // §11.4 C-1
  if (option === 'C') return 'branch_resolved'; // §11.4 C-2
  return null;
}
function modeFor(option: string): AccountResolutionMode | null {
  if (option === 'A') return 'existing_seeded_coa'; // §5.2
  if (option === 'B') return 'company_coa'; // per-company build
  if (option === 'C') return 'template_with_override'; // shared template + branch overrides
  return null;
}

/** Evidence-grounded per-option plan: scope + mode + account ref + resolved company + infra. */
function planFor(option: string, companyId: string | null): CompanyCoaPlan | null {
  const companyScope = scopeFor(option);
  const accountResolutionMode = modeFor(option);
  if (companyScope === null || accountResolutionMode === null) return null;

  let executionStatus: ExecutionStatus;
  let resolvedCompanyId: string | null;
  let secondary: string[];
  let infra: string[];

  if (option === 'A') {
    // شركة واحدة + إطار حسابات موجود — single company via C-3 + existing seeded COA.
    // The mechanism exists for the single company, but the scope is the single-company ASSUMPTION
    // (ACC-10), not verified company scoping. resolvedCompanyId is only the C-3 helper's output
    // (passed through from ctx.companyId by the live adapter); BD-10 never defaults one.
    executionStatus = 'would_resolve';
    resolvedCompanyId = companyId ?? null;
    secondary = [];
    infra = [
      `bonus_ledger (0018:50-114) and bonus_settings (0018:285-287) carry NO company_id — the ` +
      `bonus event cannot be attributed to a company from the row itself (ACC-10; PHASE-49 §1.4).`,
      `Scope relies on the C-3 single-company assumption (financial_companies order by created_at ` +
      `limit 1, 0009:57-60 — seeded single company 'MedLink', 0007:12-13). This works ONLY while ` +
      `one company exists; a second company breaks attribution (BD-10 A warning).`,
      `No bonus RPC body creates/post journals to scope — "no bonus RPC body calls ` +
      `create_financial_journal_entry or post_financial_journal_entry"; "no bonus RPC body inserts ` +
      `into financial_documents, financial_journal_entries, or financial_journal_lines" ` +
      `(PHASE-49 §3 / §9.1 lines 690-694).`,
    ];
  } else if (option === 'B') {
    // محفظة متعددة الشركات — requires company_id columns on bonus tables (schema change).
    executionStatus = 'blocked';
    resolvedCompanyId = null; // no company_id column → cannot resolve
    secondary = [COMPANY_POLICY_ISOLATION_GAP];
    infra = [
      `Option B requires adding company_id columns to the bonus tables (BD-10 registry ` +
      `when: "بعد إضافة أعمدة الشركة وتحديث جميع RPC") — this is a SCHEMA CHANGE / migration, ` +
      `PROHIBITED in this phase (directive §1/§9: no DDL, no Migration, no new columns).`,
      `bonus_ledger/bonus_settings currently carry no company_id (0018:50-114, 0018:285-287; ACC-10) — ` +
      `without the column, no per-event company can be resolved or scoped today.`,
      `Even the seeded COA is company-scoped (financial_accounts.company_id NOT NULL, 0006:94); ` +
      `a multi-company wallet cannot reuse one chart without per-company account ids (0006:92-103).`,
    ];
  } else {
    // ربط الفراعا بالشركة عند النشر — branch→company map (absent) + branch-less events.
    executionStatus = 'blocked';
    resolvedCompanyId = null; // no branch→company map → cannot resolve
    secondary = [COMPANY_POLICY_ISOLATION_GAP];
    infra = [
      `Option C resolves the company from the branch/domain at publish (BD-10 registry C-2), which ` +
      `requires a branch→company mapping table that does NOT exist (PHASE-49 §4.2; BD-10 C warning: ` +
      `"خريطة فرع→شركة غير موجودة اليوم"). BD-10 does NOT invent the relation (directive §6).`,
      `Some bonus events are NOT branch-linked (CASH_WITHDRAWAL / EXPIRATION are client-level, ` +
      `branch-less — 0018:57-62 txn_type check has no branch link; BD-10 C warning: "بعض أحداث ` +
      `البونص غير مرتبطة بفرع ... ربما لا ينجح الربط"). Binding would be partial and unverifiable.`,
      `bonus_ledger/bonus_settings carry no company_id (0018:50-114, 0018:285-287; ACC-10) — even with ` +
      `a map, the event row itself carries no company to confirm against, so scope is unverifiable.`,
      `No bonus RPC body creates/post journals to resolve against — "no bonus RPC body inserts into ` +
      `financial_documents, financial_journal_entries, or financial_journal_lines" (PHASE-49 §3 / §9.1).`,
    ];
  }

  return {
    companyScope,
    accountResolutionMode,
    templateAccountCode: SEEDED_COA_REFERENCE,
    resolvedCompanyId,
    // BD-10 NEVER resolves a bonus GL account — that is BD-01..BD-07's ACCOUNT_MAPPING_REQUIRED
    // domain (no 2xxx symbol exists in the seeded COA, 0007:41-59). Always null: no fabricated
    // account id (directive §3 test 7).
    resolvedAccountId: null,
    companyOverrideApplied: false, // no per-company overrides exist today (B needs migration; C needs map)
    executionStatus,
    infra,
  };
}

/** Evidence-grounded infra gap per option (echoes plan.infra; adds the primary code + secondary codes). */
function infraGapFor(option: string, plan: CompanyCoaPlan | null): CompanyCoaInfraGap | null {
  if (plan === null) return null;
  let code: string;
  let title: string;
  if (option === 'A') {
    code = COMPANY_POLICY_ISOLATION_GAP; // A's gap IS the single-company assumption (ACC-10)
    title = 'A (شركة واحدة + إطار حسابات موجود / single company + existing seeded COA)';
  } else if (option === 'B') {
    code = SCHEMA_MIGRATION_REQUIRED; // B's blocker is the prohibited schema change
    title = 'B (محفظة متعددة الشركات / multi-company wallet)';
  } else if (option === 'C') {
    code = BRANCH_COMPANY_MAP_REQUIRED; // C's blocker is the absent branch→company map
    title = 'C (ربط الفرع بالشركة عند النشر / branch→company at publish)';
  } else {
    code = POLICY_INVALID;
    title = `'${option}'`;
  }
  return {
    code,
    reason:
      `${code}: BD-10 ${title} requires company-COA infrastructure that does not exist or is ` +
      `prohibited for bonus events. BD-10 declares the intended scope + account resolution but does ` +
      `NOT build the infra (directive §9), does NOT fabricate a company or account (directive §3 §6), ` +
      `and does NOT create a journal (directive §10). Grounded in PHASE-49 §9.1 / §4.2 / §11.4 / §5.2 ` +
      `and 0006/0007/0009/0018 DDL.`,
    infraMissing: plan.infra,
    secondaryCodes: option === 'A' ? [] : option === 'B' ? [COMPANY_POLICY_ISOLATION_GAP] : [COMPANY_POLICY_ISOLATION_GAP],
  };
}

// ── 1. Resolve the CURRENT live policy (fail-closed, no default) ───────────────────
/**
 * Reads `accounting_policy.BD-10` from settings and validates it against BD-10's
 * registered option set {A,B,C} (from `accountingPolicies.ts` via `getPolicy('BD-10')`).
 *
 * Throws POLICY_NOT_CONFIGURED ('ACCOUNTING_POLICY_NOT_CONFIGURED') / POLICY_INVALID — the
 * caller decides how to surface it; this function NEVER substitutes a default option.
 *
 * Company note: `bonus_settings` carries NO `company_id` (0018 DDL; PHASE-49 §1.4 fault line —
 * ACC-10), so the read is global. Passing a `companyId` produces a COMPANY_POLICY_ISOLATION_GAP
 * diagnostic (ACC-10) rather than a silent cross-company read. BD-10 does NOT default a company
 * (directive §3 test 6).
 */
export async function resolveBonusCompanyCoaPolicy(
  deps: CoaDeps,
  companyId?: string | null,
): Promise<{ option: string; diagnostics: string[] }> {
  const raw = await deps.readSetting(BD10_POLICY_KEY);
  if (raw == null || raw === '') {
    throw new PolicyResolutionError(
      POLICY_NOT_CONFIGURED,
      'BD-10 is not configured; refusing to assume a company-COA policy (no silent default).',
    );
  }
  const candidate = String(raw);
  if (!BD10_OPTIONS.includes(candidate)) {
    throw new PolicyResolutionError(
      POLICY_INVALID,
      `BD-10 option "${candidate}" is not one of the registered alternatives (${BD10_OPTIONS.join(', ') || 'none'}).`,
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
 * Persists `accounting_policy.snapshot.company_coa.<ledgerId>` = option via the existing
 * director-writable `bonus_settings` (no new table, no migration). Idempotent: if a company-COA
 * snapshot already exists for this event's TRUE identity (bonus_ledger.id) it is left untouched,
 * so a later director flip (A→B) never rewrites an event's recorded scope. The `.company_coa.`
 * namespace avoids colliding with the event-account-policy snapshots (BD-01..BD-07), the timing
 * snapshots (BD-08 `.timing.`), and the aggregation snapshots (BD-09 `.aggregation.`).
 *
 * Per-EVENT identity (bonus_ledger.id), NOT per-company: bonus has no company column, so the
 * snapshot cannot be partitioned per company (ACC-10); the per-company gap is recorded as a
 * diagnostic, not invented (directive §6). BD-10 does NOT use bonus_ledger.id as a company id.
 */
export async function snapshotBonusCompanyCoaPolicy(
  ledgerId: string,
  option: string,
  deps: CoaDeps,
): Promise<{ written: boolean }> {
  const key = `${BD10_SNAPSHOT_PREFIX}${ledgerId}`;
  const existing = await deps.readSetting(key);
  if (existing != null) return { written: false };
  await deps.upsertSetting(key, option);
  return { written: true };
}

/** Which BD-10 company-COA option was in force when this event was processed. */
export async function getHistoricalBonusCompanyCoaPolicy(
  ledgerId: string,
  deps: CoaDeps,
): Promise<{ option: string | null; source: 'snapshot' | 'none' }> {
  const raw = await deps.readSetting(`${BD10_SNAPSHOT_PREFIX}${ledgerId}`);
  if (raw == null) return { option: null, source: 'none' };
  const opt = String(raw);
  return { option: BD10_OPTIONS.includes(opt) ? opt : null, source: 'snapshot' };
}

// ── 3. Dispatch A / B / C for this event (company scope + account mode; NO journal) ──
/**
 * Resolve the current BD-10 policy, snapshot it for THIS event (on the event's TRUE identity —
 * bonus_ledger.id), and return the concrete company-COA / scope decision.
 *
 * Does NOT create journal entries (`create_financial_journal_entry` / `post_financial_journal_entry`
 * are never called — directive §10). Does NOT mutate bonus_ledger (the event row was already
 * recorded POSTED by the event engine). Does NOT fabricate a company or account id (directive §3
 * test 6/7): `resolvedCompanyId` is only the passed-in company context; `templateAccountCode`
 * references the provable seeded COA (§5.2 / 0007), not an invented code.
 *
 * Per-option behaviour, grounded in PHASE-49 §11.3/§11.4 (scope), §5.2 (seeded COA) + §4.2
 * (company gap) + §9.1 (infra existence) + 0006/0007/0009/0018 DDL — directive §6:
 *   A (single company + existing COA) → would_resolve single_company / existing_seeded_coa; scope
 *      = C-3 single-company assumption (0009:57-60) → COMPANY_POLICY_ISOLATION_GAP (ACC-10).
 *      resolvedCompanyId = the C-3 company (live), null (pure, no context); never a default.
 *   B (multi-company wallet)         → would_resolve multi_company / company_coa; company_id columns
 *      on bonus tables required → SCHEMA_MIGRATION_REQUIRED (prohibited, §1/§9). resolvedCompanyId=null
 *      (no column). executionStatus='blocked'.
 *   C (branch→company at publish)    → would_resolve branch_resolved / template_with_override;
 *      branch→company map absent (§4.2) + branch-less events → BRANCH_COMPANY_MAP_REQUIRED +
 *      COMPANY_POLICY_ISOLATION_GAP. resolvedCompanyId=null. executionStatus='blocked'.
 *
 * BD-10 does NOT consult / replace BD-01..BD-08's accounting / timing / aggregation (directive §12);
 * pass-through of prior fail_closed diagnostics is handled by the dormant seam
 * (`resolveBonusCompanyCoaForEvent`), not by this pure engine.
 *
 * Idempotency: the snapshot is keyed by the event's TRUE identity (bonus_ledger.id) and written
 * once; re-dispatch yields `alreadyHadPolicySnapshot: true` and an identical effect.
 */
export async function applyBonusCompanyCoaPolicy(
  ctx: CompanyCoaContext,
  deps: CoaDeps,
): Promise<CompanyCoaDecision> {
  const { ledgerId } = ctx.identity;
  const effectKey = `bd10:company_coa:${ledgerId}`;
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
    const resolved = await resolveBonusCompanyCoaPolicy(deps, ctx.companyId);
    option = resolved.option;
    resolveDiagnostics = resolved.diagnostics;
  } catch (e) {
    const err = e as PolicyResolutionError;
    const code = err.code ?? 'UNKNOWN';
    return failClosed(code, `${code}: ${err.message}`, effectKey, sourceTrace, layers, resolveDiagnostics);
  }

  // (2) Snapshot the policy in force for THIS event (idempotent, history-safe).
  const snap = await snapshotBonusCompanyCoaPolicy(ledgerId, option, deps);

  // (3) Dispatch per option: company scope + account mode + evidence-grounded infra gap.
  //     BD-10 NEVER posts / never fabricates a company or account.
  const companyScope = scopeFor(option);
  const accountResolutionMode = modeFor(option);
  if (companyScope === null || accountResolutionMode === null) {
    return failClosed(
      POLICY_INVALID,
      `BD-10 option "${option}" is registered but has no scope mapping (unexpected registry shape).`,
      effectKey,
      sourceTrace,
      layers,
      resolveDiagnostics,
    );
  }
  const plan = planFor(option, ctx.companyId ?? null);
  const gap = infraGapFor(option, plan);
  if (plan === null || gap === null) {
    return failClosed(
      POLICY_INVALID,
      `BD-10 option "${option}" is registered but has no plan (unexpected registry shape).`,
      effectKey,
      sourceTrace,
      layers,
      resolveDiagnostics,
    );
  }

  const diagnostics = [...resolveDiagnostics, gap.code, ...gap.secondaryCodes];

  const effect: CompanyCoaEffect = { kind: 'would_resolve', plan, infra: gap };

  return {
    option,
    effect,
    journalEntryId: null,
    effectKey,
    alreadyHadPolicySnapshot: !snap.written,
    diagnostics,
    sourceTrace,
    eventBoundary: layers.eventBoundary,
    companyCoa: { option, companyScope, accountResolutionMode },
    posting: layers.posting,
  };
}

// ── Three-layer helpers (directive §10), shared by success + fail_closed paths ────
function buildLayers(): {
  eventBoundary: CompanyCoaDecision['eventBoundary'];
  companyCoa: CompanyCoaDecision['companyCoa'];
  posting: CompanyCoaDecision['posting'];
} {
  return {
    eventBoundary: {
      recordedAt: 'bonus_ledger.POSTED',
      note:
        'Event Boundary is owned by the event engine (BD-01..BD-07): the bonus_ledger row is ' +
        'already recorded as POSTED at the business act. BD-10 consumes it and decides only the ' +
        'company scope + account resolution.',
    },
    // fail_closed default — succeed() overwrites option/companyScope/accountResolutionMode.
    companyCoa: { option: null, companyScope: null, accountResolutionMode: null },
    posting: {
      journalEntryId: null,
      status: 'not_scoped' as const,
      reason:
        'BD-10 owns company scope + account resolution only — journal entry creation is a ' +
        'downstream, separately-gated posting step. BD-10 never calls ' +
        'create_financial_journal_entry / post_financial_journal_entry and never creates a journal ' +
        '(directive §10).',
    },
  };
}

function failClosed(
  code: string,
  reason: string,
  effectKey: string,
  sourceTrace: CompanyCoaDecision['sourceTrace'],
  layers: ReturnType<typeof buildLayers>,
  diagnostics: string[] = [],
): CompanyCoaDecision {
  return {
    option: null,
    effect: { kind: 'fail_closed', code, reason },
    journalEntryId: null,
    effectKey,
    alreadyHadPolicySnapshot: false,
    diagnostics,
    sourceTrace,
    eventBoundary: layers.eventBoundary,
    companyCoa: layers.companyCoa,
    posting: layers.posting,
  };
}

// ── Integration contracts + pure, synchronous, DB-free composition ─────────
// These live in the PURE engine (not the live seam) so the BD-10 pass-through
// contract — BD-10 does NOT override BD-01..BD-09's accounting/timing/aggregation
// decisions (directive §12) — is unit-testable under `node --experimental-strip-types`
// with zero DB / zero Supabase. The live seam (`resolveBonusCompanyCoa.ts`)
// re-exports them and wires `resolveCompanyCoaForEvent` onto `applyBonusCompanyCoaPolicyLive`.

/** The accounting decision BD-01..BD-07 have ALREADY made for this event — passed through verbatim. */
export interface EventAccountingEnvelope {
  /** `bonus_ledger.id` of the POSTED row (the TRUE event identity). */
  ledgerId: string;
  /** Event type label — the documentType BD-10 records in its source-trace. */
  eventType: string;
  /** The event engine's accounting effect (NOT modified by BD-10). */
  accountingEffect: 'no_entry' | 'would_post' | 'fail_closed';
  /** The event engine's accounting fail-closed code, if any (e.g. ACCOUNT_MAPPING_REQUIRED). */
  accountingCode?: string | null;
  /** Best-effort current financial company (C-3 single-company assumption). */
  companyId?: string | null;
}

/** The publish-timing decision BD-08 has ALREADY made for this event — passed through verbatim. */
export interface TimingDecisionEnvelope {
  /** BD-08 publish-timing intent the event was resolved under. */
  publishIntent: string;
  /** BD-08 journal-creation status — expected 'not_posted' (timing-only engine). */
  postingStatus: string;
}

/** The journal-aggregation decision BD-09 has ALREADY made for this event — passed through verbatim. */
export interface AggregationDecisionEnvelope {
  /** BD-09 aggregation mode (one_per_event / draft_per_event_then_batch_review / periodic_netting). */
  aggregationMode: string;
  /** BD-09 journal-creation status — expected 'not_aggregated'. */
  postingStatus: string;
  /** BD-09's key infra-gap code, if any (e.g. POSTING_INFRASTRUCTURE_REQUIRED). */
  aggregationCode?: string | null;
}

/** How BD-10's company-COA scope layers onto the prior accounting/timing/aggregation decisions. */
export interface CompanyCoaIntegrationResult {
  accounting: EventAccountingEnvelope;
  timing: TimingDecisionEnvelope;
  aggregation: AggregationDecisionEnvelope;
  coa: CompanyCoaDecision;
  composed: {
    /** BD-10's resolved company scope + account mode (the §5 plan). */
    companyCoa: CompanyCoaDecision['companyCoa'];
    /** Journal creation is ALWAYS deferred — BD-10 owns company scope only (directive §10). */
    postingStatus: 'not_scoped';
    /** Why journals are not created by BD-10. */
    reason: string;
    /** The accounting effect BD-01..BD-07 decided (passed through, NOT overridden by BD-10). */
    accountingEffect: EventAccountingEnvelope['accountingEffect'];
    /**
     * Prior fail_closed codes echoed verbatim (BD-10 does NOT override them — directive §3 test 9).
     * Collected from the accounting envelope (its accountingCode), BD-08 (TIMING_POLICY_REQUIRED when
     * not posted) and BD-09 (its aggregationCode, else AGGREGATION_POLICY_REQUIRED when not posted).
     */
    priorFailClosedCodes: string[];
  };
}

/**
 * PURE, synchronous, DB-free composition: combine an already-resolved BD-10 company-COA decision
 * with the prior accounting/timing/aggregation envelopes, passing the prior decisions through
 * UNTOUCHED (directive §3/§5/§12). BD-10 only ADDS the company-scope + account-resolution
 * dimension — it never re-decides, re-codes, or silences a prior fail_closed.
 */
export function composeCompanyCoaIntegration(
  accounting: EventAccountingEnvelope,
  timing: TimingDecisionEnvelope,
  aggregation: AggregationDecisionEnvelope,
  coa: CompanyCoaDecision,
): CompanyCoaIntegrationResult {
  const priorFailClosedCodes: string[] = [];
  if (accounting.accountingEffect === 'fail_closed' && accounting.accountingCode) {
    priorFailClosedCodes.push(accounting.accountingCode);
  }
  if (timing.postingStatus !== 'posted') {
    priorFailClosedCodes.push('TIMING_POLICY_REQUIRED');
  }
  if (aggregation.postingStatus !== 'posted') {
    priorFailClosedCodes.push(aggregation.aggregationCode ?? 'AGGREGATION_POLICY_REQUIRED');
  }
  // BD-10's own codes already live on `coa.diagnostics`; here we only echo the prior ones.

  return {
    accounting,
    timing,
    aggregation,
    coa,
    composed: {
      companyCoa: coa.companyCoa,
      postingStatus: 'not_scoped',
      reason:
        'Journal entry creation is a downstream, separately-gated posting step — BD-10 resolves ' +
        'only the company scope + account resolution and never creates a journal (directive §10).',
      accountingEffect: accounting.accountingEffect,
      priorFailClosedCodes,
    },
  };
}
