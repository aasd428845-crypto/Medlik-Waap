/*
 * BD-10 COMPANY-SCOPED CHART OF ACCOUNTS POLICY — CASE 1-10 (local / test-only).
 *
 * PURE-TS assertions with an in-memory fake store. No test runner is installed in the
 * workspace (package.json exposes no test script), and Node cannot resolve the @/ alias — so
 * this file imports the PURE engine + types via RELATIVE ./ paths only (never the Supabase-backed
 * live wiring or any screen), which lets it run under `node --experimental-strip-types` with zero
 * new dependencies. `composeCompanyCoaIntegration` now lives in the pure engine
 * (`bonusCompanyCoaPolicy.ts`) for exactly this reason (the live seam re-exports it).
 *
 * Run locally (from the PWA source dir):
 *   node --experimental-strip-types src/lib/bonusCompanyCoaPolicy.test.ts
 *
 * Shared fail-closed sentinels come from BD-01's base module (`./bonusAccountingPolicy.ts` — the
 * same source BD-05/BD-06/BD-07/BD-08/BD-09 import, keeping every engine's fixtures aligned). BD-10-
 * specific symbols (SCHEMA_MIGRATION_REQUIRED, BRANCH_COMPANY_MAP_REQUIRED, BD10_OPTIONS, the
 * decision/effect types, and the pure compose helper) come from the pure engine under test.
 *
 * CASES (directive §8, 10 gates):
 *   1  BD-10 registered with exactly A/B/C; A would_resolve single_company/existing_seeded_coa;
 *      B would_resolve multi_company/company_coa (executionStatus blocked); C would_resolve
 *      branch_resolved/template_with_override (executionStatus blocked); journalEntryId null.
 *   2  multi-company unified codes — B diagnostics carry SCHEMA_MIGRATION_REQUIRED + ACC-10;
 *      companyScope=multi_company, accountResolutionMode=company_coa.
 *   3  C template vs overrides — templateAccountCode is the provable seeded COA ref (not an
 *      account id), companyOverrideApplied=false, BRANCH_COMPANY_MAP_REQUIRED surfaced, branch-less
 *      events named in infra.
 *   4  unconfigured  → fail_closed POLICY_NOT_CONFIGURED (no default, no snapshot).
 *   5  invalid "Z"   → fail_closed POLICY_INVALID.
 *   6  no default company — A (no ctx.companyId) resolvedCompanyId=null, no DEFAULT_COMPANY_USED;
 *      passing companyId surfaces COMPANY_POLICY_ISOLATION_GAP (ACC-10), not a silent cross-co read.
 *   7  no fabricated account id — resolvedAccountId=null for A/B/C; templateAccountCode is the
 *      seeded reference string (not a fabricated GL account id; no 2xxx exists).
 *   8  history lock — event under A stays A in .company_coa snapshot after live flips to B; E2=B;
 *      + idempotency replay + source trace (bonus_ledger.ledgerId, TRUE identity, no reverts_id).
 *   9  BD-10 does NOT override BD-01..BD-09 fail_closed — composeCompanyCoaIntegration passes the
 *      prior accounting/timing/aggregation through UNTOUCHED; priorFailClosedCodes echoes them; BD-10
 *      still resolves its OWN company scope on top (would_resolve), journalEntryId null.
 *  10  no journal-creation call — journalEntryId null on A/B/C + fail_closed; posting.status=
 *      'not_scoped'; three-layer decomposition (eventBoundary/companyCoa/posting) present + explicit.
 */

// Shared fail-closed sentinels come from BD-01's base module (the same source BD-05/BD-06/BD-07/
// BD-08/BD-09 import — keeps every engine's fixtures aligned).
import {
  POLICY_NOT_CONFIGURED,
  POLICY_INVALID,
  COMPANY_POLICY_ISOLATION_GAP,
  ACCOUNT_MAPPING_REQUIRED,
  type BonusEarnDeps,
} from './bonusAccountingPolicy.ts';
// BD-10-specific symbols live in the PURE engine under test (DB-free, no Supabase).
import {
  BD10_POLICY_KEY,
  BD10_SNAPSHOT_PREFIX,
  BD10_OPTIONS,
  SCHEMA_MIGRATION_REQUIRED,
  BRANCH_COMPANY_MAP_REQUIRED,
  resolveBonusCompanyCoaPolicy,
  snapshotBonusCompanyCoaPolicy,
  getHistoricalBonusCompanyCoaPolicy,
  applyBonusCompanyCoaPolicy,
  composeCompanyCoaIntegration,
} from './bonusCompanyCoaPolicy.ts';
import type {
  CoaDeps,
  CompanyCoaContext,
  CompanyCoaDecision,
  CompanyCoaEffect,
  CompanyCoaPlan,
  CompanyCoaIntegrationResult,
  EventAccountingEnvelope,
  TimingDecisionEnvelope,
  AggregationDecisionEnvelope,
} from './bonusCompanyCoaPolicy.ts';

// ── In-memory fake bonus_settings store (no DB, no Supabase) ─────────────────────
function makeStore(): { deps: CoaDeps; raw: Map<string, unknown> } {
  const raw = new Map<string, unknown>();
  const deps: CoaDeps = {
    readSetting: (key: string) => Promise.resolve(raw.has(key) ? raw.get(key) : null),
    upsertSetting: (key: string, value: unknown) => {
      raw.set(key, value);
      return Promise.resolve();
    },
  };
  return { deps, raw };
}

function ctx(
  ledgerId: string,
  eventType: string,
  companyId?: string | null,
): CompanyCoaContext {
  return {
    identity: {
      ledgerId,
      idempotencyKey: `evt:${ledgerId}`,
      orderId: `order-for-${ledgerId}`,
    },
    eventType,
    companyId: companyId ?? null,
  };
}

function wouldResolve(d: CompanyCoaDecision): boolean {
  return d.effect.kind === 'would_resolve';
}
function isWouldResolve(d: CompanyCoaDecision): d is CompanyCoaDecision & { effect: { kind: 'would_resolve'; plan: CompanyCoaPlan; infra: unknown } } {
  return d.effect.kind === 'would_resolve';
}
function failCode(d: CompanyCoaDecision): string | null {
  return d.effect.kind === 'fail_closed' ? d.effect.code : null;
}

// ── Minimal inline assertion harness (no node: imports -> no @types dep) ────────────
let failures = 0;
const pass: string[] = [];
const fail: string[] = [];

function check(cond: boolean, msg: string): void {
  if (cond) {
    pass.push(msg);
  } else {
    failures++;
    fail.push(msg);
    console.error('FAIL: ' + msg);
  }
}

function plan(d: CompanyCoaDecision): CompanyCoaPlan | null {
  return d.effect.kind === 'would_resolve' ? d.effect.plan : null;
}

// ── CASE 1: BD-10 registered with exactly A/B/C ────────────────────────────────────
async function case1(store: { deps: CoaDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 1: BD-10 A/B/C resolvable from the registry ===');
  check(
    BD10_OPTIONS.length === 3 && BD10_OPTIONS.includes('A') && BD10_OPTIONS.includes('B') && BD10_OPTIONS.includes('C'),
    'CASE 1 – BD10_OPTIONS === ["A","B","C"] (registry-driven, distinct from every other policy)',
  );
  check(BD10_POLICY_KEY === 'accounting_policy.BD-10', 'CASE 1 – BD10_POLICY_KEY = accounting_policy.BD-10');
  check(
    BD10_SNAPSHOT_PREFIX === 'accounting_policy.snapshot.company_coa.',
    'CASE 1 – BD10_SNAPSHOT_PREFIX namespaced .company_coa. (no clobber of .timing. / .aggregation. / bare snapshot)',
  );

  // A → would_resolve single_company / existing_seeded_coa.
  store.raw.set(BD10_POLICY_KEY, 'A');
  const a = await applyBonusCompanyCoaPolicy(ctx('evt-A-1', 'bonus_earn', null), store.deps);
  const aPlan = plan(a);
  check(a.option === 'A', 'CASE 1 – A resolves to A');
  check(wouldResolve(a), 'CASE 1 – A is would_resolve');
  check(aPlan !== null && aPlan.companyScope === 'single_company', 'CASE 1 – A companyScope = single_company (§11.4 C-3)');
  check(aPlan !== null && aPlan.accountResolutionMode === 'existing_seeded_coa', 'CASE 1 – A accountResolutionMode = existing_seeded_coa (reuse seeded COA §5.2)');
  check(aPlan !== null && aPlan.executionStatus === 'would_resolve', 'CASE 1 – A executionStatus = would_resolve (realisable now for the single company)');
  check(aPlan !== null && aPlan.resolvedCompanyId === null, 'CASE 1 – A resolvedCompanyId null (pure engine, no ctx.companyId — no default)');
  check(aPlan !== null && aPlan.templateAccountCode !== null, 'CASE 1 – A templateAccountCode is the provable seeded COA ref (not null)');
  check(a.journalEntryId === null, 'CASE 1 – A creates no journal (journalEntryId null)');
  check(a.posting.status === 'not_scoped', 'CASE 1 – A posting.status = not_scoped');
  check(a.effectKey === 'bd10:company_coa:evt-A-1', 'CASE 1 – A effectKey keyed on TRUE event identity (bonus_ledger.id)');
  check(a.eventBoundary.recordedAt === 'bonus_ledger.POSTED', 'CASE 1 – A eventBoundary = bonus_ledger.POSTED');
  check(a.sourceTrace.sourceTable === 'bonus_ledger' && a.sourceTrace.sourceId === 'evt-A-1', 'CASE 1 – A source trace pinned to bonus_ledger.ledgerId');

  // B → would_resolve multi_company / company_coa, but executionStatus blocked (schema change required).
  store.raw.set(BD10_POLICY_KEY, 'B');
  const b = await applyBonusCompanyCoaPolicy(ctx('evt-B-1', 'bonus_earn', null), store.deps);
  const bPlan = plan(b);
  check(b.option === 'B', 'CASE 1 – B resolves to B');
  check(wouldResolve(b), 'CASE 1 – B effect = would_resolve (option is registered/resolvable)');
  check(bPlan !== null && bPlan.companyScope === 'multi_company', 'CASE 1 – B companyScope = multi_company');
  check(bPlan !== null && bPlan.accountResolutionMode === 'company_coa', 'CASE 1 – B accountResolutionMode = company_coa');
  check(bPlan !== null && bPlan.executionStatus === 'blocked', 'CASE 1 – B executionStatus = blocked (requires company_id columns)');
  check(bPlan !== null && bPlan.resolvedCompanyId === null, 'CASE 1 – B resolvedCompanyId null (no company_id column → cannot resolve)');
  check(b.journalEntryId === null, 'CASE 1 – B creates no journal (journalEntryId null)');

  // C → would_resolve branch_resolved / template_with_override, executionStatus blocked (map absent).
  store.raw.set(BD10_POLICY_KEY, 'C');
  const c = await applyBonusCompanyCoaPolicy(ctx('evt-C-1', 'bonus_earn', null), store.deps);
  const cPlan = plan(c);
  check(c.option === 'C', 'CASE 1 – C resolves to C');
  check(wouldResolve(c), 'CASE 1 – C effect = would_resolve (option is registered/resolvable)');
  check(cPlan !== null && cPlan.companyScope === 'branch_resolved', 'CASE 1 – C companyScope = branch_resolved');
  check(cPlan !== null && cPlan.accountResolutionMode === 'template_with_override', 'CASE 1 – C accountResolutionMode = template_with_override');
  check(cPlan !== null && cPlan.executionStatus === 'blocked', 'CASE 1 – C executionStatus = blocked (branch→company map absent)');
  check(cPlan !== null && cPlan.resolvedCompanyId === null, 'CASE 1 – C resolvedCompanyId null (no map → cannot resolve)');
  check(c.journalEntryId === null, 'CASE 1 – C creates no journal (journalEntryId null)');
}

// ── CASE 2: multi-company unified codes (B) ────────────────────────────────────────
async function case2(store: { deps: CoaDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 2: multi-company unified codes (B) ===');
  store.raw.set(BD10_POLICY_KEY, 'B');
  const b = await applyBonusCompanyCoaPolicy(ctx('evt-BC-1', 'bonus_earn', null), store.deps);
  check(b.diagnostics.includes(SCHEMA_MIGRATION_REQUIRED), 'CASE 2 – B surfaces SCHEMA_MIGRATION_REQUIRED (company_id columns on bonus tables)');
  check(
    b.diagnostics.includes(COMPANY_POLICY_ISOLATION_GAP),
    'CASE 2 – B ALSO surfaces COMPANY_POLICY_ISOLATION_GAP (ACC-10: bonus rows carry no company_id even if columns were added later)',
  );
  const bp = plan(b);
  check(bp !== null && bp.companyScope === 'multi_company' && bp.accountResolutionMode === 'company_coa', 'CASE 2 – B scope/mode = multi_company/company_coa (unified code set)');
  check(bp !== null && bp.executionStatus === 'blocked', 'CASE 2 – B executionStatus = blocked (schema change prohibited §1/§9)');
  // The SCHEMA_MIGRATION_REQUIRED infra bullet references the registry's "when" clause verbatim.
  check(
    bp !== null && bp.infra.some((m) => /company_id columns|إضافة أعمدة الشركة|بيانات RPC/.test(m) && /مهاجرة|migration|SCHEMA/.test(m)),
    'CASE 2 – B infra quotes the registry when clause (إضافة أعمدة الشركة) + names the prohibited migration',
  );
  check(b.journalEntryId === null, 'CASE 2 – B journalEntryId null');
}

// ── CASE 3: C template vs overrides ────────────────────────────────────────────────
async function case3(store: { deps: CoaDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 3: C template vs overrides ===');
  store.raw.set(BD10_POLICY_KEY, 'C');
  const c = await applyBonusCompanyCoaPolicy(ctx('evt-C3-1', 'bonus_earn', null), store.deps);
  check(c.option === 'C', 'CASE 3 – C resolves to C');
  const cp = plan(c);
  check(cp !== null, 'CASE 3 – C produced a would_resolve plan');
  check(cp !== null && cp.templateAccountCode !== null && typeof cp.templateAccountCode === 'string', 'CASE 3 – C templateAccountCode is the provable seeded COA ref string (§5.2), not an account id');
  check(
    cp !== null && !/^\d+(\.\d+)*$/.test(cp.templateAccountCode ?? ''),
    'CASE 3 – C templateAccountCode is NOT a fabricated numeric account id (it is the seeded ref description)',
  );
  check(cp !== null && cp.companyOverrideApplied === false, 'CASE 3 – C companyOverrideApplied = false (no override map exists today)');
  check(cp !== null && cp.resolvedAccountId === null, 'CASE 3 – C resolvedAccountId null (template has no concrete account → ACCOUNT_MAPPING_REQUIRED, BD-01..BD-07 domain)');
  check(c.diagnostics.includes(BRANCH_COMPANY_MAP_REQUIRED), 'CASE 3 – C surfaces BRANCH_COMPANY_MAP_REQUIRED (خريطة فرع→شركة غير موجودة اليوم)');
  check(
    cp !== null &&
      cp.infra.some((m) => /branch→company|فرع→شركة|خريطة فرع→شركة/.test(m)) &&
      cp.infra.some((m) => /CASH_WITHDRAWAL|EXPIRATION|branch-less|غير مرتبط/.test(m)),
    'CASE 3 – C infra names the absent branch→company map AND the branch-less events (CASH_WITHDRAWAL/EXPIRATION)',
  );
  check(cp !== null && cp.accountResolutionMode === 'template_with_override', 'CASE 3 – C mode = template_with_override (shared template + branch overrides, per registry)');
}

// ── CASE 4: unconfigured → fail_closed ─────────────────────────────────────────────
async function case4(store: { deps: CoaDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 4: unconfigured → ACCOUNTING_POLICY_NOT_CONFIGURED ===');
  store.raw.delete(BD10_POLICY_KEY); // nothing set
  const before = store.raw.size;
  const decision = await applyBonusCompanyCoaPolicy(ctx('evt-U-1', 'bonus_earn', null), store.deps);

  check(decision.option === null, 'CASE 4 – null option (resolution threw, no default assumed)');
  check(failCode(decision) === POLICY_NOT_CONFIGURED, 'CASE 4 – fail_closed ACCOUNTING_POLICY_NOT_CONFIGURED (no policy ?? no default)');
  check(decision.journalEntryId === null, 'CASE 4 – no journal on unconfigured policy');
  check(
    store.raw.size === before,
    'CASE 4 – nothing snapshotted when policy is unconfigured (fail before any snapshot write)',
  );
  check(decision.posting.status === 'not_scoped', 'CASE 4 – fail_closed posting.status = not_scoped');
  check(decision.companyCoa.companyScope === null, 'CASE 4 – fail_closed companyCoa.scope = null (no scope decided)');
  check(decision.effect.kind === 'fail_closed', 'CASE 4 – fail_closed path reachable (no_entry / would_post owned by BD-01..BD-07, not BD-10)');
  check(!('plan' in decision.effect) && !('infra' in decision.effect), 'CASE 4 – fail_closed carries no company-COA payload (would_resolve is the only real path)');
}

// ── CASE 5: invalid option ("Z") -> fail_closed ───────────────────────────────────
async function case5(store: { deps: CoaDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 5: invalid option "Z" → POLICY_INVALID ===');
  store.raw.set(BD10_POLICY_KEY, 'Z');
  const decision = await applyBonusCompanyCoaPolicy(ctx('evt-Z-1', 'bonus_earn', null), store.deps);

  check(decision.option === null, 'CASE 5 – null option (resolution threw)');
  check(failCode(decision) === POLICY_INVALID, 'CASE 5 – fail_closed POLICY_INVALID (Z not in registered A/B/C)');
  check(decision.journalEntryId === null, 'CASE 5 – no journal on invalid policy');
  check(decision.posting.status === 'not_scoped', 'CASE 5 – fail_closed posting.status = not_scoped');
}

// ── CASE 6: no default company (ACC-10) ────────────────────────────────────────────
async function case6(store: { deps: CoaDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 6: no default company (ACC-10) ===');

  // A with NO company context → resolvedCompanyId null, no DEFAULT_COMPANY_USED fallback.
  store.raw.set(BD10_POLICY_KEY, 'A');
  const noco = await applyBonusCompanyCoaPolicy(ctx('evt-NC-1', 'bonus_earn', null), store.deps);
  const np = plan(noco);
  check(np !== null && np.resolvedCompanyId === null, 'CASE 6 – A (no company) resolvedCompanyId = null (BD-10 never defaults a company)');
  check(!noco.diagnostics.some((d) => d === 'DEFAULT_COMPANY_USED'), 'CASE 6 – no DEFAULT_COMPANY_USED fallback emitted (fail-closed on missing company context)');
  check(np !== null && np.resolvedCompanyId === null && np.templateAccountCode !== null, 'CASE 6 – A still references the seeded COA ref though no company resolved');

  // Passing a companyId surfaces the ACC-10 isolation gap (bonus_settings/bonus_ledger have no company_id).
  const co = await applyBonusCompanyCoaPolicy(ctx('evt-NC-2', 'bonus_earn', 'co-999'), store.deps);
  check(co.diagnostics.includes(COMPANY_POLICY_ISOLATION_GAP), 'CASE 6 – A passing companyId surfaces COMPANY_POLICY_ISOLATION_GAP (ACC-10)');
  const cp = plan(co);
  check(cp !== null && cp.resolvedCompanyId === 'co-999', 'CASE 6 – A resolvedCompanyId = the passed-in company context only (never a default)');
  check(!co.diagnostics.some((d) => d === 'DEFAULT_COMPANY_USED'), 'CASE 6 – still no DEFAULT_COMPANY_USED even with a company id');

  // resolveBonusCompanyCoaPolicy (resolution-only) also surfaces the gap when a company is passed.
  const { diagnostics } = await resolveBonusCompanyCoaPolicy(store.deps, 'co-999');
  check(diagnostics.includes(COMPANY_POLICY_ISOLATION_GAP), 'CASE 6 – resolveBonusCompanyCoaPolicy surfaces ACC-10 when companyId passed');
}

// ── CASE 7: no fabricated account id ───────────────────────────────────────────────
async function case7(store: { deps: CoaDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 7: no fabricated account id ===');
  for (const opt of ['A', 'B', 'C'] as const) {
    store.raw.set(BD10_POLICY_KEY, opt);
    const d = await applyBonusCompanyCoaPolicy(ctx(`evt-NI-${opt}`, 'bonus_earn', null), store.deps);
    const p = plan(d);
    check(p !== null && p.resolvedAccountId === null, `CASE 7 – option ${opt}: resolvedAccountId === null (BD-10 never resolves a bonus GL account — no 2xxx in seeded COA)`);
    check(p !== null && p.templateAccountCode !== null, `CASE 7 – option ${opt}: templateAccountCode present (provable seeded ref, not null)`);
    check(p !== null && typeof p.templateAccountCode === 'string', `CASE 7 – option ${opt}: templateAccountCode is a provable reference string (§5.2), never a fabricated numeric account id`);
    check(p !== null && !/^\d+(\.\d+)*$/.test(p.templateAccountCode ?? ''), `CASE 7 – option ${opt}: templateAccountCode is NOT a fabricated numeric GL account id`);
    // The seeded reference explicitly notes the absence of 2xxx future-discount symbols.
    check(
      p !== null && /2xxx|لا توجد رموز خصم مستقبلي|future-discount/.test(p.templateAccountCode ?? ''),
      `CASE 7 – option ${opt}: seeded reference states no future-discount/2xxx symbol exists (so bonus GL account stays ACCOUNT_MAPPING_REQUIRED)`,
    );
    check(d.journalEntryId === null, `CASE 7 – option ${opt}: journalEntryId null`);
  }
  // Sanity: ACCOUNT_MAPPING_REQUIRED is the sentinel BD-10 defers to BD-01..BD-07 for (never fabricated here).
  check(ACCOUNT_MAPPING_REQUIRED === 'ACCOUNT_MAPPING_REQUIRED', 'CASE 7 – ACCOUNT_MAPPING_REQUIRED shared sentinel available for the engines that own it');
}

// ── CASE 8: history lock + idempotency + source trace ─────────────────────────────
async function case8(store: { deps: CoaDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 8: history lock + idempotency + source trace ===');

  // E1 earns under A.
  store.raw.set(BD10_POLICY_KEY, 'A');
  const e1 = await applyBonusCompanyCoaPolicy(ctx('evt-H-1', 'bonus_earn'), store.deps);
  check(e1.option === 'A', 'CASE 8 – E1 resolved under A');
  check(store.raw.has(`${BD10_SNAPSHOT_PREFIX}evt-H-1`) && store.raw.get(`${BD10_SNAPSHOT_PREFIX}evt-H-1`) === 'A', 'CASE 8 – snapshot accounting_policy.snapshot.company_coa.evt-H-1 == A (namespaced, does not clobber .timing./.aggregation.)');

  // Director flips the LIVE setting A->B — must NOT rewrite E1's company-COA snapshot.
  store.raw.set(BD10_POLICY_KEY, 'B');
  const e1b = await applyBonusCompanyCoaPolicy(ctx('evt-H-1', 'bonus_earn'), store.deps);
  check(e1b.option === 'B', 'CASE 8 – E1 re-dispatch under B resolves B (live)');
  check(e1b.alreadyHadPolicySnapshot === true, 'CASE 8 – E1 second dispatch detected an existing company_coa snapshot');
  check(store.raw.get(`${BD10_SNAPSHOT_PREFIX}evt-H-1`) === 'A', 'CASE 8 – E1 company_coa snapshot remains A despite live setting now B (history locked)');

  // Historical reader returns what was recorded at event time.
  const hist1 = await getHistoricalBonusCompanyCoaPolicy('evt-H-1', store.deps);
  check(hist1.option === 'A' && hist1.source === 'snapshot', 'CASE 8 – historical reader returns snapshotted A for E1');

  // E2 earns AFTER the flip — records B.
  const e2 = await applyBonusCompanyCoaPolicy(ctx('evt-H-2', 'bonus_earn'), store.deps);
  check(e2.option === 'B', 'CASE 8 – E2 (later) resolves B after the flip');
  check(store.raw.get(`${BD10_SNAPSHOT_PREFIX}evt-H-2`) === 'B', 'CASE 8 – snapshot accounting_policy.snapshot.company_coa.evt-H-2 == B');
  const hist2 = await getHistoricalBonusCompanyCoaPolicy('evt-H-2', store.deps);
  check(hist2.option === 'B' && hist2.source === 'snapshot', 'CASE 8 – historical reader returns snapshotted B for E2');

  // Snapshot-once: explicit re-snapshot is a no-op on collision (E1 stays A).
  const snap1 = await snapshotBonusCompanyCoaPolicy('evt-H-1', 'B', store.deps);
  check(snap1.written === false, 'CASE 8 – snapshotBonusCompanyCoaPolicy is a no-op on collision (E1 stays A)');
  check(store.raw.get(`${BD10_SNAPSHOT_PREFIX}evt-H-1`) === 'A', 'CASE 8 – re-snapshot attempt did not overwrite A');

  // Idempotency: re-dispatch SAME ledgerId under the SAME policy → identical effect, no dup snapshot, no dup journal.
  store.raw.set(BD10_POLICY_KEY, 'C');
  const first = await applyBonusCompanyCoaPolicy(ctx('evt-I-1', 'bonus_earn'), store.deps);
  check(first.effectKey === 'bd10:company_coa:evt-I-1', 'CASE 8 – idempotency: effectKey pinned to the TRUE event identity (bonus_ledger.id)');
  check(first.journalEntryId === null, 'CASE 8 – idempotency: first pass journalEntryId null');
  check(first.alreadyHadPolicySnapshot === false, 'CASE 8 – idempotency: first pass wrote the company_coa snapshot');
  const second = await applyBonusCompanyCoaPolicy(ctx('evt-I-1', 'bonus_earn'), store.deps);
  const fp = plan(first), sp = plan(second);
  check(
    second.effectKey === first.effectKey &&
      second.option === first.option &&
      second.effect.kind === first.effect.kind &&
      (fp !== null && sp !== null && sp.companyScope === fp.companyScope && sp.accountResolutionMode === fp.accountResolutionMode),
    'CASE 8 – idempotency: replay yields identical effect + scope/mode for the same event id',
  );
  check(second.alreadyHadPolicySnapshot === true, 'CASE 8 – idempotency: replay detected existing company_coa snapshot');
  check(second.journalEntryId === null, 'CASE 8 – idempotency: replay journalEntryId null (no duplicate journal)');
  const snapKey = `${BD10_SNAPSHOT_PREFIX}evt-I-1`;
  check(
    store.raw.get(snapKey) === 'C' && Array.from(store.raw.keys()).filter((k) => k === snapKey).length === 1,
    'CASE 8 – idempotency: exactly one company_coa snapshot key exists for evt-I-1 (no duplication)',
  );

  // Source trace pinned to the TRUE bonus_ledger event identity (not account/order/customer), branchless.
  const tr = first.sourceTrace;
  check(tr.sourceTable === 'bonus_ledger', 'CASE 8 – sourceTable = bonus_ledger');
  check(tr.sourceId === 'evt-I-1', 'CASE 8 – sourceId = the event row id (TRUE identity), NOT account/order/customer');
  check(tr.ledgerId === 'evt-I-1', 'CASE 8 – sourceTrace.ledgerId = event row id');
  check(tr.eventType === 'bonus_earn', 'CASE 8 – documentType = the event type');
  check(first.eventBoundary.recordedAt === 'bonus_ledger.POSTED', 'CASE 8 – eventBoundary = bonus_ledger.POSTED');
  // BD-10 is a company-COA policy (not a compensation engine): no reverts_id field on the source trace.
  check(!('revertsId' in tr), 'CASE 8 – BD-10 source-trace has no reverts_id (reverts_id belongs to BD-05/BD-06/BD-07 compensation, not the COA policy)');
}

// ── CASE 9: BD-10 does NOT override BD-01..BD-09 fail_closed (pure compose) ──────────
async function case9(store: { deps: CoaDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 9: BD-10 does NOT override prior fail_closed (pure compose) ===');

  // A live BD-10 decision (would_resolve its own company scope).
  store.raw.set(BD10_POLICY_KEY, 'A');
  const coa = await applyBonusCompanyCoaPolicy(ctx('evt-C9-1', 'bonus_earn', null), store.deps);
  check(coa.journalEntryId === null, 'CASE 9 – BD-10 own journalEntryId null (company scope only, directive §10)');

  // Prior engines decided fail_closed / not-yet-posted — BD-10 must echo, never override.
  const accounting: EventAccountingEnvelope = {
    ledgerId: 'evt-C9-1',
    eventType: 'bonus_earn',
    accountingEffect: 'fail_closed',
    accountingCode: ACCOUNT_MAPPING_REQUIRED, // BD-01..BD-07's bonus-GL-account gap — BD-10 owns none of it
    companyId: null,
  };
  const timing: TimingDecisionEnvelope = {
    publishIntent: 'none',
    postingStatus: 'not_posted', // BD-08 not posted
  };
  const aggregation: AggregationDecisionEnvelope = {
    aggregationMode: 'one_per_event',
    postingStatus: 'not_aggregated', // BD-09 not posted
    aggregationCode: 'POSTING_INFRASTRUCTURE_REQUIRED',
  };

  const composed = composeCompanyCoaIntegration(accounting, timing, aggregation, coa);
  check(composed.composed.postingStatus === 'not_scoped', 'CASE 9 – composed postingStatus = not_scoped (BD-10 never posts)');
  check(composed.coa.journalEntryId === null, 'CASE 9 – coa.journalEntryId null after compose');

  // Prior fail_closed codes echoed verbatim — BD-10 does NOT override them.
  check(
    composed.composed.priorFailClosedCodes.includes(ACCOUNT_MAPPING_REQUIRED),
    'CASE 9 – ACCOUNT_MAPPING_REQUIRED echoed in priorFailClosedCodes (not overridden)',
  );
  check(
    composed.composed.priorFailClosedCodes.includes('TIMING_POLICY_REQUIRED'),
    'CASE 9 – TIMING_POLICY_REQUIRED echoed (BD-08 not posted → BD-10 does not re-decide timing)',
  );
  check(
    composed.composed.priorFailClosedCodes.includes('POSTING_INFRASTRUCTURE_REQUIRED'),
    'CASE 9 – POSTING_INFRASTRUCTURE_REQUIRED echoed (BD-09 not posted → BD-10 does not re-decide aggregation)',
  );

  // BD-10 resolves its OWN company-COA scope on top of the prior fail_closed — it is layered, not overriding.
  check(composed.coa.effect.kind === 'would_resolve', 'CASE 9 – BD-10 still resolves its own company scope (would_resolve) alongside the prior fail_closed (layered, not overriding)');
  const cp = plan(composed.coa);
  check(cp !== null && cp.companyScope === 'single_company', 'CASE 9 – BD-10 own scope = single_company (A independent of accounting fail_closed)');

  // The prior accounting effect is passed through UNTOUCHED (not re-coded by BD-10).
  check(composed.composed.accountingEffect === 'fail_closed', 'CASE 9 – accountingEffect passed through = fail_closed (NOT re-coded to would_post by BD-10)');
  check(composed.accounting.accountingCode === ACCOUNT_MAPPING_REQUIRED, 'CASE 9 – accountingCode passed through verbatim');
  check(composed.timing.postingStatus === 'not_posted', 'CASE 9 – timing postingStatus passed through verbatim');
  check(composed.aggregation.aggregationMode === 'one_per_event', 'CASE 9 – aggregation mode passed through verbatim');

  // When a prior engine is healthy (would_post / posted), BD-10 still does not fabricate a journal.
  const healthyAccounting: EventAccountingEnvelope = { ...accounting, accountingEffect: 'would_post', accountingCode: null };
  const healthyComposed = composeCompanyCoaIntegration(healthyAccounting, timing, aggregation, coa);
  check(
    healthyComposed.composed.priorFailClosedCodes.includes('TIMING_POLICY_REQUIRED') &&
      healthyComposed.composed.priorFailClosedCodes.includes('POSTING_INFRASTRUCTURE_REQUIRED') &&
      !healthyComposed.composed.priorFailClosedCodes.includes(ACCOUNT_MAPPING_REQUIRED),
    'CASE 9 – healthy accounting (would_post) → ACCOUNT_MAPPING_REQUIRED no longer echoed, but BD-08/BD-09 infra still echoed (BD-10 owns neither)',
  );
  check(healthyComposed.composed.accountingEffect === 'would_post', 'CASE 9 – would_post accounting effect passed through untouched');
}

// ── CASE 10: no journal-creation call (three-layer decomposition, journalEntryId null everywhere) ──
async function case10(store: { deps: CoaDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 10: no journal-creation call ===');
  const snapshotBefore = store.raw.size;
  for (const opt of ['A', 'B', 'C'] as const) {
    store.raw.set(BD10_POLICY_KEY, opt);
    const d = await applyBonusCompanyCoaPolicy(ctx(`evt-NJ-${opt}`, 'bonus_earn', null), store.deps);
    check(d.journalEntryId === null, `CASE 10 – option ${opt}: decision.journalEntryId null (never fabricates a journal)`);
    check(d.posting.journalEntryId === null, `CASE 10 – option ${opt}: posting.journalEntryId null`);
    check(d.posting.status === 'not_scoped', `CASE 10 – option ${opt}: posting.status = 'not_scoped' (journal creation is downstream, separately-gated)`);
  }

  // fail_closed path also creates nothing.
  store.raw.delete(BD10_POLICY_KEY);
  const fc = await applyBonusCompanyCoaPolicy(ctx('evt-NJ-F', 'bonus_earn', null), store.deps);
  check(fc.journalEntryId === null, 'CASE 10 – fail_closed: journalEntryId null');
  check(fc.posting.journalEntryId === null, 'CASE 10 – fail_closed: posting.journalEntryId null');
  check(fc.posting.status === 'not_scoped', 'CASE 10 – fail_closed: posting.status = not_scoped');
  check(fc.effect.kind === 'fail_closed', 'CASE 10 – fail_closed effect kind');

  // The three-layer decomposition is present + explicit on a real (would_resolve) decision.
  const a = await applyBonusCompanyCoaPolicy(ctx('evt-NJ-A2', 'bonus_earn', null), store.deps);
  // (re-set policy A; evt-NJ-A2 is fresh)
  store.raw.set(BD10_POLICY_KEY, 'A');
  const a2 = await applyBonusCompanyCoaPolicy(ctx('evt-NJ-A2', 'bonus_earn', null), store.deps);
  check(a2.effect.kind === 'would_resolve', 'CASE 10 – three-layer target decision is would_resolve');
  check(a2.eventBoundary.recordedAt === 'bonus_ledger.POSTED', 'CASE 10 – eventBoundary layer present (owned by BD-01..BD-07, consumed by BD-10)');
  check(a2.companyCoa.companyScope === 'single_company' && a2.companyCoa.option === 'A', 'CASE 10 – companyCoa layer present (BD-10 owns this)');
  check(a2.posting.status === 'not_scoped' && a2.posting.journalEntryId === null, 'CASE 10 – posting layer present but NOT scoped (journal creation deferred)');
  check(
    /create_financial_journal_entry|post_financial_journal_entry/i.test(a2.posting.reason),
    'CASE 10 – posting.reason explicitly names that create/post_financial_journal_entry are NOT called by BD-10',
  );

  // No journal-related rows were written by BD-10 (bonus_settings only ever holds policy + snapshot keys).
  check(store.raw.size >= 2, 'CASE 10 – store holds ≥ policy + snapshot (bonus_settings keys only, no journal table)');
  for (const key of store.raw.keys()) {
    check(!/financial_journal_entries|financial_journal_lines|financial_documents/.test(key), `CASE 10 – no journal-table key written: ${key}`);
  }
  check(store.raw.size >= snapshotBefore + 1, 'CASE 10 – BD-10 only added a company_coa snapshot key (no journal rows anywhere)');
}

// ── Runner ────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const s = makeStore();
  await case1(s);
  await case2(s);
  await case3(s);
  await case4(s);
  await case5(s);
  await case6(s);
  await case7(s);
  await case8(s);
  await case9(s);
  await case10(s);

  console.log('\n──────────────────────────────────────────');
  console.log(`PASS: ${pass.length}  FAIL: ${fail.length}`);
  if (fail.length > 0) {
    console.error('Failing checks:');
    for (const f of fail) console.error('  - ' + f);
  }
  console.log('────────────── CASES ──────────────');
  console.log('1) BD-10 A/B/C resolvable | A would_resolve single_company/existing_seeded_coa | B would_resolve multi_company/company_coa(blocked) | C would_resolve branch_resolved/template_with_override(blocked)');
  console.log('2) B multi-company unified codes → SCHEMA_MIGRATION_REQUIRED + COMPANY_POLICY_ISOLATION_GAP');
  console.log('3) C template vs overrides → templateAccountCode=seeded ref (not an account id), companyOverrideApplied=false, BRANCH_COMPANY_MAP_REQUIRED');
  console.log('4) unconfigured  → fail_closed POLICY_NOT_CONFIGURED (no default, no snapshot)');
  console.log('5) invalid "Z"   → fail_closed POLICY_INVALID');
  console.log('6) no default company → resolvedCompanyId=null, no DEFAULT_COMPANY_USED; companyId → COMPANY_POLICY_ISOLATION_GAP (ACC-10)');
  console.log('7) no fabricated account id → resolvedAccountId=null A/B/C; templateAccountCode=seeded ref (no 2xxx)');
  console.log('8) history lock + idempotency + source trace (bonus_ledger.ledgerId, no reverts_id)');
  console.log('9) BD-10 does NOT override prior fail_closed → composeCompanyCoaIntegration echoes ACCOUNT_MAPPING_REQUIRED/TIMING/POSTING-INFRA into priorFailClosedCodes');
  console.log('10) no journal-creation call → journalEntryId null A/B/C + fail_closed; posting.status=not_scoped; three-layer decomposition explicit');
  console.log('────────────── REGISTRY SHAPE ──────────────');
  console.log('BD10_OPTIONS =', JSON.stringify(BD10_OPTIONS));
  console.log('BD10_POLICY_KEY =', BD10_POLICY_KEY);
  console.log('BD10_SNAPSHOT_PREFIX =', BD10_SNAPSHOT_PREFIX);
  console.log('SCHEMA_MIGRATION_REQUIRED =', SCHEMA_MIGRATION_REQUIRED);
  console.log('BRANCH_COMPANY_MAP_REQUIRED =', BRANCH_COMPANY_MAP_REQUIRED);
  console.log('\n──────────────────────────────────────────');

  if (fail.length > 0) process.exitCode = 1;
}

void main();
