/*
 * BD-09 engine — CASE 1-9 (local / test-only).
 *
 * PURE-TS assertions with an in-memory fake store. No test runner is installed in the
 * workspace (package.json exposes no test script), and Node cannot resolve the @/ alias — so
 * this file imports the PURE engine / types via RELATIVE ./ paths only (never the Supabase-backed
 * live wiring or the seam), which lets it run under `node --experimental-strip-types` with zero
 * new dependencies.
 *
 * Run locally (from the PWA source dir):
 *   node --experimental-strip-types src/lib/bonusAggregationPolicy.test.ts
 *
 * Shared fail-closed sentinels come from BD-01's base module (`./bonusAccountingPolicy.ts` —
 * the same source BD-05/BD-06/BD-07/BD-08 import, keeping every engine's fixtures aligned). BD-09-
 * specific symbols (POSTING_INFRASTRUCTURE_REQUIRED, AGGREGATION_IDENTITY_REQUIRED, BD09_OPTIONS,
 * the decision/effect types) come from the pure engine under test.
 *
 * CASES:
 *   1  BD-09 registered with exactly A/B/C (three options — NOT BD-07's binary A/B); A = would_aggregate
 *      one_per_event | B = would_aggregate draft_per_event_then_batch_review | C = would_aggregate
 *      periodic_netting; all journalEntryId null.
 *   2  unconfigured  → fail_closed ACCOUNTING_POLICY_NOT_CONFIGURED (no default, no snapshot).
 *   3  invalid "Z"   → fail_closed POLICY_INVALID.
 *   4  infra-absent → every option carries POSTING_INFRASTRUCTURE_REQUIRED with OPTION-SPECIFIC
 *      infraMissing (A: no bonus RPC/trigger on bonus_ledger; B: draft+approval+marker+company; C:
 *      scheduler+marker+aggregation-identity+company); C additionally carries AGGREGATION_IDENTITY_REQUIRED
 *      (company-scoped netting key unformable) + COMPANY_POLICY_ISOLATION_GAP. journalEntryId null on every path.
 *   5  BD-09 never posts → journalEntryId null on every path; posting.status='not_aggregated'; the
 *      three-layer decomposition (eventBoundary/aggregation/posting) is present and explicit;
 *      fail_closed path reachable and carries no aggregation payload (aggregation-only model).
 *   6  history lock → event under A stays A in its .aggregation. snapshot after the live setting flips
 *      to B; a later event records B; historical reader returns the snapshotted value.
 *   7  idempotency → same ledgerId re-dispatch yields identical effect, snapshot untouched
 *      (alreadyHadPolicySnapshot=true), journalEntryId null, exactly one snapshot key.
 *   8  source trace → sourceTable=bonus_ledger, sourceId=ledgerId (TRUE identity, NOT account/order/customer);
 *      eventBoundary=bonus_ledger.POSTED; aggregation-only (no reverts_id — that is the compensation
 *      engines' domain, not BD-09).
 *   9  company scope → COMPANY_POLICY_ISOLATION_GAP (ACC-10) surfenced, not a silent fallback.
 *
 * EXTRA registry-shape guard: BD09_OPTIONS === ["A","B","C"] (three options — distinguishes
 * BD-09 from BD-07's binary A/B, proving the option set is read from the registry, not assumed).
 */

// Shared fail-closed sentinels come from BD-01's base module (the same source BD-05/BD-06/BD-07/
// BD-08 import — keeps every engine's fixtures aligned).
import {
  POLICY_NOT_CONFIGURED,
  POLICY_INVALID,
  COMPANY_POLICY_ISOLATION_GAP,
  type BonusEarnDeps,
} from './bonusAccountingPolicy.ts';
// BD-09-specific symbols live in the pure engine under test.
import {
  BD09_POLICY_KEY,
  BD09_SNAPSHOT_PREFIX,
  BD09_OPTIONS,
  POSTING_INFRASTRUCTURE_REQUIRED,
  AGGREGATION_IDENTITY_REQUIRED,
  resolveBonusAggregationPolicy,
  snapshotBonusAggregationPolicy,
  applyBonusAggregationPolicy,
  getHistoricalBonusAggregationPolicy,
} from './bonusAggregationPolicy.ts';
import type {
  AggregationDeps,
  AggregationContext,
  JournalAggregationDecision,
} from './bonusAggregationPolicy.ts';

// ── In-memory fake bonus_settings store (no DB, no Supabase) ─────────────────────
function makeStore(): { deps: AggregationDeps; raw: Map<string, unknown> } {
  const raw = new Map<string, unknown>();
  const deps: AggregationDeps = {
    readSetting: async (key: string) => (raw.has(key) ? raw.get(key) : null),
    upsertSetting: async (key: string, value: unknown) => {
      raw.set(key, value);
    },
  };
  return { deps, raw };
}

function ctx(
  ledgerId: string,
  eventType: string,
  companyId?: string | null,
): AggregationContext {
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

// ── Minimal inline assertion harness (no node: imports -> no @types dep) ───────────
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

function effectIsWouldAggregate(d: JournalAggregationDecision): boolean {
  return d.effect.kind === 'would_aggregate';
}
function effectIsWouldAggregateMode(d: JournalAggregationDecision, mode: string): boolean {
  return d.effect.kind === 'would_aggregate' && d.effect.mode === mode;
}
function effectIsFailClosed(d: JournalAggregationDecision, code: string): boolean {
  return d.effect.kind === 'fail_closed' && d.effect.code === code;
}
function effectIsFailClosedAny(d: JournalAggregationDecision): boolean {
  return d.effect.kind === 'fail_closed';
}

// ── CASE 1: BD-09 registered with exactly A/B/C ────────────────────────────────────
async function case1(store: { deps: AggregationDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 1: BD-09 A/B/C resolvable from the registry ===');
  check(
    BD09_OPTIONS.length === 3 && BD09_OPTIONS.includes('A') && BD09_OPTIONS.includes('B') && BD09_OPTIONS.includes('C'),
    'CASE 1 – BD09_OPTIONS === ["A","B","C"] (three options — registry-driven, NOT assumed binary like BD-07)',
  );

  // A → would_aggregate (one journal per event, §11.3 S-2; mirrors invoice E8 0009:108), infra-absent.
  store.raw.set(BD09_POLICY_KEY, 'A');
  const a = await applyBonusAggregationPolicy(ctx('evt-A-1', 'bonus_earn'), store.deps);
  check(a.option === 'A', 'CASE 1 – A resolves to A');
  check(effectIsWouldAggregate(a), 'CASE 1 – A is would_aggregate');
  check(
    effectIsWouldAggregateMode(a, 'one_per_event'),
    'CASE 1 – A mode = one_per_event (§11.3 S-2; mirrors invoice E8 0009:108)',
  );
  check(
    effectIsWouldAggregate(a) && a.aggregation.aggregationKey !== null,
    'CASE 1 – A aggregationKey is the stable per-event identity (bonus_ledger.id, formable)',
  );
  check(
    a.diagnostics.includes(POSTING_INFRASTRUCTURE_REQUIRED),
    'CASE 1 – A carries POSTING_INFRASTRUCTURE_REQUIRED (zero bonus journals exist to aggregate)',
  );
  check(!a.diagnostics.includes(AGGREGATION_IDENTITY_REQUIRED), 'CASE 1 – A does NOT surface AGGREGATION_IDENTITY_REQUIRED (1:1, no group identity needed)');
  check(a.journalEntryId === null, 'CASE 1 – A creates no journal (journalEntryId null)');

  // B → would_aggregate (draft per event, owner review batch, S-1 + D7).
  store.raw.set(BD09_POLICY_KEY, 'B');
  const b = await applyBonusAggregationPolicy(ctx('evt-B-1', 'bonus_earn'), store.deps);
  check(b.option === 'B', 'CASE 1 – B resolves to B');
  check(effectIsWouldAggregate(b), 'CASE 1 – B is would_aggregate');
  check(
    effectIsWouldAggregateMode(b, 'draft_per_event_then_batch_review'),
    'CASE 1 – B mode = draft_per_event_then_batch_review (§11.3 S-1 + D7 owner review)',
  );
  check(b.journalEntryId === null, 'CASE 1 – B creates no journal (journalEntryId null)');

  // C → would_aggregate (periodic netting, T-3 + S-3/S-1); C carries the extra identity + company gaps.
  store.raw.set(BD09_POLICY_KEY, 'C');
  const c = await applyBonusAggregationPolicy(ctx('evt-C-1', 'bonus_earn'), store.deps);
  check(c.option === 'C', 'CASE 1 – C resolves to C');
  check(effectIsWouldAggregate(c), 'CASE 1 – C is would_aggregate');
  check(
    effectIsWouldAggregateMode(c, 'periodic_netting'),
    'CASE 1 – C mode = periodic_netting (§11.1 T-3 + §11.3 S-3/S-1)',
  );
  check(
    c.diagnostics.includes(POSTING_INFRASTRUCTURE_REQUIRED) &&
      c.diagnostics.includes(AGGREGATION_IDENTITY_REQUIRED) &&
      c.diagnostics.includes(COMPANY_POLICY_ISOLATION_GAP),
    'CASE 1 – C carries POSTING_INFRASTRUCTURE_REQUIRED + AGGREGATION_IDENTITY_REQUIRED + COMPANY_POLICY_ISOLATION_GAP (company-scoped netting key unformable)',
  );
  check(c.aggregation.aggregationKey === null, 'CASE 1 – C aggregationKey is null (group identity unformable; ACC-10)');
  check(c.journalEntryId === null, 'CASE 1 – C creates no journal (journalEntryId null)');
}

// ── CASE 2: unconfigured -> fail_closed ──────────────────────────────────────────
async function case2(store: { deps: AggregationDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 2: unconfigured → ACCOUNTING_POLICY_NOT_CONFIGURED ===');
  store.raw.delete(BD09_POLICY_KEY); // nothing set
  const decision = await applyBonusAggregationPolicy(ctx('evt-U-1', 'bonus_earn'), store.deps);

  check(decision.option === null, 'CASE 2 – null option (resolution threw, no default assumed)');
  check(
    effectIsFailClosed(decision, POLICY_NOT_CONFIGURED),
    'CASE 2 – fail_closed ACCOUNTING_POLICY_NOT_CONFIGURED (no policy ?? no default)',
  );
  check(decision.journalEntryId === null, 'CASE 2 – no journal on unconfigured policy');
  check(
    decision.diagnostics.length === 0 && !decision.alreadyHadPolicySnapshot,
    'CASE 2 – nothing snapshotted when policy is unconfigured (fail before snapshot)',
  );
}

// ── CASE 3: invalid option ("Z") -> fail_closed ─────────────────────────────────
async function case3(store: { deps: AggregationDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 3: invalid option "Z" → POLICY_INVALID ===');
  store.raw.set(BD09_POLICY_KEY, 'Z');
  const decision = await applyBonusAggregationPolicy(ctx('evt-Z-1', 'bonus_earn'), store.deps);

  check(decision.option === null, 'CASE 3 – null option (resolution threw)');
  check(
    effectIsFailClosed(decision, POLICY_INVALID),
    'CASE 3 – fail_closed POLICY_INVALID (Z not in registered A/B/C)',
  );
  check(decision.journalEntryId === null, 'CASE 3 – no journal on invalid policy');
}

// ── CASE 4: infra-absent — option-specific missing infra ─────────────────────────
async function case4(store: { deps: AggregationDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 4: infra-absent → POSTING_INFRASTRUCTURE_REQUIRED per option ===');

  // A: infraMissing names the absent bonus posting / trigger on bonus_ledger.
  store.raw.set(BD09_POLICY_KEY, 'A');
  const a = await applyBonusAggregationPolicy(ctx('evt-M-1', 'bonus_earn'), store.deps);
  check(
    effectIsWouldAggregate(a) && a.diagnostics.includes(POSTING_INFRASTRUCTURE_REQUIRED),
    'CASE 4 – A diagnostics carry POSTING_INFRASTRUCTURE_REQUIRED',
  );
  check(
    a.effect.infra.infraMissing.length >= 2 &&
      a.effect.infra.infraMissing.some((m) => /bonus_ledger/.test(m) && /trigger|RPC|TECHNICAL GAP/i.test(m)),
    'CASE 4 – A infraMissing names the absent bonus_ledger trigger / RPC ("no bonus RPC body calls create_financial_journal_entry")',
  );
  check(
    a.effect.infra.infraMissing.some((m) => /manual.*director-only|T-1 trigger|invoice E8|E8/i.test(m)),
    'CASE 4 – A infraMissing roots the gap in create/post being manual+dorctor-only (0010:278,308) and the invoice E8 model it mirrors (0009:108)',
  );
  check(a.journalEntryId === null, 'CASE 4 – A journalEntryId null');

  // B: infraMissing names draft-not-wired / approval flow / published marker / company.
  store.raw.set(BD09_POLICY_KEY, 'B');
  const b = await applyBonusAggregationPolicy(ctx('evt-M-2', 'bonus_earn'), store.deps);
  check(
    effectIsWouldAggregate(b) && b.diagnostics.includes(POSTING_INFRASTRUCTURE_REQUIRED),
    'CASE 4 – B diagnostics carry POSTING_INFRASTRUCTURE_REQUIRED',
  );
  check(
    b.diagnostics.includes(COMPANY_POLICY_ISOLATION_GAP),
    'CASE 4 – B diagnostics carry COMPANY_POLICY_ISOLATION_GAP (review-batch key company-scoped; company absent)',
  );
  check(
    b.effect.infra.infraMissing.some((m) => /draft journal|draft.*bonus_ledger|writes NO journal/i.test(m)),
    'CASE 4 – B infraMissing names the draft journal not wired to bonus_ledger (§9.1 line 694)',
  );
  check(
    b.effect.infra.infraMissing.some((m) => /approval|owner/i.test(m)),
    'CASE 4 – B infraMissing names the absent owner approval/release flow (ACC-11)',
  );
  check(
    b.effect.infra.infraMissing.some((m) => /published\/posted-marker|marker/i.test(m)),
    'CASE 4 – B infraMissing names the absent published/posted marker (§4.3 Q6)',
  );
  check(b.journalEntryId === null, 'CASE 4 – B journalEntryId null');

  // C: infraMissing names the scheduler, the aggregation identity, the marker, and the company gap.
  store.raw.set(BD09_POLICY_KEY, 'C');
  const c = await applyBonusAggregationPolicy(ctx('evt-M-3', 'bonus_earn'), store.deps);
  check(
    effectIsWouldAggregate(c) && c.diagnostics.includes(POSTING_INFRASTRUCTURE_REQUIRED),
    'CASE 4 – C diagnostics carry POSTING_INFRASTRUCTURE_REQUIRED',
  );
  check(
    c.diagnostics.includes(AGGREGATION_IDENTITY_REQUIRED),
    'CASE 4 – C diagnostics carry AGGREGATION_IDENTITY_REQUIRED (group identity unformable)',
  );
  check(
    c.effect.infra.infraMissing.some((m) => /bonus journal entries exist to net|no bonus RPC/i.test(m)),
    'CASE 4 – C infraMissing names the absence of any bonus journal entries to net (§9.1 lines 690-694)',
  );
  check(
    c.effect.infra.infraMissing.some((m) => /scheduler/.test(m)),
    'CASE 4 – C infraMissing names the absent scheduler ("no scheduler anywhere", Phase-49 §9.1 line 699)',
  );
  check(
    c.effect.infra.infraMissing.some((m) => /published\/posted-marker|marker/i.test(m)),
    'CASE 4 – C infraMissing names the absent published/posted marker (§4.3 Q6)',
  );
  check(
    c.effect.infra.infraMissing.some((m) => /company_id|company.*absent|ACC-10/i.test(m)),
    'CASE 4 – C infraMissing names the absent company on bonus rows (ACC-10)',
  );
  check(c.journalEntryId === null, 'CASE 4 – C journalEntryId null');
}

// ── CASE 5: BD-09 never posts (three-layer decomposition explicit) ────────────────
async function case5(store: { deps: AggregationDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 5: BD-09 never posts — journalEntryId null; posting.status=not_aggregated ===');

  for (const opt of ['A', 'B', 'C'] as const) {
    store.raw.set(BD09_POLICY_KEY, opt);
    const d = await applyBonusAggregationPolicy(ctx(`evt-N-${opt}`, 'bonus_earn'), store.deps);
    check(d.journalEntryId === null, `CASE 5 – option ${opt}: journalEntryId null (no journal ever fabricated)`);
    check(d.posting.status === 'not_aggregated', `CASE 5 – option ${opt}: posting.status = 'not_aggregated'`);
    check(
      d.posting.journalEntryId === null,
      `CASE 5 – option ${opt}: posting.journalEntryId null`,
    );
    check(
      d.eventBoundary.recordedAt === 'bonus_ledger.POSTED',
      `CASE 5 – option ${opt}: eventBoundary = bonus_ledger.POSTED (boundary owned by the event engine)`,
    );
    check(
      d.aggregation.mode !== null,
      `CASE 5 – option ${opt}: aggregation.mode resolved (BD-09 owns aggregation only)`,
    );
  }

  // fail_closed path also posts nothing.
  store.raw.delete(BD09_POLICY_KEY);
  const fc = await applyBonusAggregationPolicy(ctx('evt-N-F', 'bonus_earn'), store.deps);
  check(fc.journalEntryId === null, 'CASE 5 – fail_closed: journalEntryId null');
  check(fc.posting.status === 'not_aggregated', 'CASE 5 – fail_closed: posting.status = not_aggregated');
  check(
    effectIsFailClosedAny(fc),
    'CASE 5 – fail_closed path reachable (would_aggregate is the only "real" path; no_entry is owned by BD-01..BD-07, not BD-09)',
  );
  check(
    !('mode' in fc.effect) && !('plan' in fc.effect) && !('infra' in fc.effect),
    'CASE 5 – fail_closed carries no aggregation payload (aggregation-only model — BD-09 has no account/infra payload like the accounting engines)',
  );
}

// ── CASE 6: history lock — event under A stays A after live flips to B ─────────────
async function case6(store: { deps: AggregationDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 6: history lock — event aggregation under A stays A after live flips to B ===');

  // E1 earns under A.
  store.raw.set(BD09_POLICY_KEY, 'A');
  const e1 = await applyBonusAggregationPolicy(ctx('evt-H-1', 'bonus_earn'), store.deps);
  check(e1.option === 'A', 'CASE 6 – E1 resolved under A (option A)');
  check(
    store.raw.has(`${BD09_SNAPSHOT_PREFIX}evt-H-1`) &&
      store.raw.get(`${BD09_SNAPSHOT_PREFIX}evt-H-1`) === 'A',
    'CASE 6 – snapshot accounting_policy.snapshot.aggregation.evt-H-1 == A (namespaced)',
  );

  // Director flips the LIVE setting A->B — must NOT rewrite E1's aggregation snapshot.
  store.raw.set(BD09_POLICY_KEY, 'B');
  const e1b = await applyBonusAggregationPolicy(ctx('evt-H-1', 'bonus_earn'), store.deps);
  check(e1b.option === 'B', 'CASE 6 – E1 re-dispatch under B resolves B (live)');
  check(e1b.alreadyHadPolicySnapshot === true, 'CASE 6 – E1 second dispatch detected an existing aggregation snapshot');
  check(
    store.raw.get(`${BD09_SNAPSHOT_PREFIX}evt-H-1`) === 'A',
    'CASE 6 – E1 aggregation snapshot remains A despite live setting now B (history locked)',
  );
  // Historical reader returns what was recorded at event time.
  const hist1 = await getHistoricalBonusAggregationPolicy('evt-H-1', store.deps);
  check(hist1.option === 'A' && hist1.source === 'snapshot', 'CASE 6 – historical reader returns snapshotted A for E1');

  // E2 earns AFTER the flip — records B (future events follow the new policy).
  const e2 = await applyBonusAggregationPolicy(ctx('evt-H-2', 'bonus_earn'), store.deps);
  check(e2.option === 'B', 'CASE 6 – E2 (later) resolves B after the flip');
  check(
    store.raw.get(`${BD09_SNAPSHOT_PREFIX}evt-H-2`) === 'B',
    'CASE 6 – snapshot accounting_policy.snapshot.aggregation.evt-H-2 == B',
  );
  const hist2 = await getHistoricalBonusAggregationPolicy('evt-H-2', store.deps);
  check(hist2.option === 'B' && hist2.source === 'snapshot', 'CASE 6 – historical reader returns snapshotted B for E2');

  // Snapshot-once: explicit re-snapshot is a no-op on collision.
  const snap1 = await snapshotBonusAggregationPolicy('evt-H-1', 'B', store.deps);
  check(snap1.written === false, 'CASE 6 – snapshotBonusAggregationPolicy is a no-op on collision (E1 stays A)');
  check(
    store.raw.get(`${BD09_SNAPSHOT_PREFIX}evt-H-1`) === 'A',
    'CASE 6 – re-snapshot attempt did not overwrite A',
  );
}

// ── CASE 7: idempotency — same event ledgerId, no duplicate effect ───────────────

async function case7(store: { deps: AggregationDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 7: idempotency replay ===');
  store.raw.set(BD09_POLICY_KEY, 'C');
  const first = await applyBonusAggregationPolicy(ctx('evt-I-1', 'bonus_earn'), store.deps);
  check(first.effectKey === 'bd09:aggregation:evt-I-1', 'CASE 7 – effectKey pinned to the event ledgerId (TRUE identity)');
  check(first.journalEntryId === null, 'CASE 7 – first pass journalEntryId null');
  check(first.alreadyHadPolicySnapshot === false, 'CASE 7 – first pass wrote the aggregation snapshot');
  check(
    effectIsWouldAggregateMode(first, 'periodic_netting') && first.diagnostics.includes(POSTING_INFRASTRUCTURE_REQUIRED),
    'CASE 7 – C first pass: would_aggregate periodic_netting + POSTING_INFRASTRUCTURE_REQUIRED',
  );

  // Replay the SAME event ledgerId under the same policy.
  const second = await applyBonusAggregationPolicy(ctx('evt-I-1', 'bonus_earn'), store.deps);
  check(
    second.effectKey === first.effectKey &&
      second.option === first.option &&
      second.effect.kind === first.effect.kind &&
      second.aggregation.mode === first.aggregation.mode,
    'CASE 7 – replay yields identical effect + aggregation mode for the same event id',
  );
  check(second.alreadyHadPolicySnapshot === true, 'CASE 7 – replay detected existing aggregation snapshot');
  check(second.journalEntryId === null, 'CASE 7 – replay journalEntryId null (no duplicate journal)');
  const snapKey = `${BD09_SNAPSHOT_PREFIX}evt-I-1`;
  check(
    store.raw.get(snapKey) === 'C' &&
      Array.from(store.raw.keys()).filter((k) => k === snapKey).length === 1,
    'CASE 7 – exactly one aggregation snapshot key exists for evt-I-1 (no duplication; prior CASEs wrote other keys)',
  );
}

// ── CASE 8: source trace — TRUE event identity + aggregation-only (no reverts_id) ─
async function case8(store: { deps: AggregationDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 8: source trace pinned to the TRUE bonus_ledger event identity ===');
  store.raw.set(BD09_POLICY_KEY, 'A');
  const decision = await applyBonusAggregationPolicy(
    ctx('evt-T-1', 'bonus_redemption', null),
    store.deps,
  );

  check(decision.sourceTrace.sourceTable === 'bonus_ledger', 'CASE 8 – sourceTable = bonus_ledger');
  check(decision.sourceTrace.sourceId === 'evt-T-1', 'CASE 8 – sourceId = the event row id (TRUE identity), NOT account/order/customer');
  check(decision.sourceTrace.ledgerId === 'evt-T-1', 'CASE 8 – sourceTrace.ledgerId = event row id');
  check(decision.sourceTrace.eventType === 'bonus_redemption', 'CASE 8 – documentType = the event type (bonus_redemption)');
  check(
    decision.effectKey === 'bd09:aggregation:evt-T-1',
    'CASE 8 – effectKey keyed on the TRUE event identity (bonus_ledger.id), never a surrogate',
  );
  check(decision.eventBoundary.recordedAt === 'bonus_ledger.POSTED', 'CASE 8 – eventBoundary = bonus_ledger.POSTED');
  check(
    decision.aggregation.aggregationKey !== null,
    'CASE 8 – A aggregationKey is the stable per-event identity (formable; no group identity needed for 1:1)',
  );
  // BD-09 is an aggregation policy — it has no reverses_id concept (that is the compensation
  // engines' domain, BD-05/BD-06/BD-07). The absence is structural, not a gap.
  check(
    !('reversesId' in decision.sourceTrace),
    'CASE 8 – BD-09 source-trace has no reverts_id field (aggregation-only; reverts_id belongs to BD-05/BD-06/BD-07 compensation, not BD-09)',
  );
}

// ── CASE 9: company scope -> COMPANY_POLICY_ISOLATION_GAP (ACC-10) ────────────────
async function case9(store: { deps: AggregationDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 9: company scope → COMPANY_POLICY_ISOLATION_GAP ===');

  // Passing companyId surfaces the ACC-10 isolation gap (bonus_settings/bonus_ledger have no company_id).
  const { diagnostics } = await resolveBonusAggregationPolicy(store.deps, 'co-999');
  check(
    diagnostics.includes(COMPANY_POLICY_ISOLATION_GAP),
    'CASE 9 – passing companyId surfaces the ACC-10 isolation gap (not a silent cross-company read)',
  );
  check(!diagnostics.some((d) => d === 'DEFAULT_COMPANY_USED'), 'CASE 9 – no silent global fallback emitted');

  // End-to-end via apply*: companyId propagates the gap into the A decision's diagnostics.
  store.raw.set(BD09_POLICY_KEY, 'A');
  const co = await applyBonusAggregationPolicy(ctx('evt-C-1', 'bonus_earn', 'co-999'), store.deps);
  check(co.diagnostics.includes(COMPANY_POLICY_ISOLATION_GAP), 'CASE 9 – A decision carries COMPANY_POLICY_ISOLATION_GAP');

  // No companyId -> no isolation gap (single-company assumption; nothing to isolate).
  store.raw.set(BD09_POLICY_KEY, 'A');
  const noco = await applyBonusAggregationPolicy(ctx('evt-C-2', 'bonus_earn', null), store.deps);
  check(!noco.diagnostics.includes(COMPANY_POLICY_ISOLATION_GAP), 'CASE 9 – no companyId -> no COMPANY_POLICY_ISOLATION_GAP');
  // And the live C-3 resolver is the same helper BD-07/BD-08 reuse (readCurrentCompanyId, 0009:57).
  check(
    !noco.diagnostics.some((d) => d === 'DEFAULT_COMPANY_USED'),
    'CASE 9 – single-company path emits no DEFAULT_COMPANY_USED fallback',
  );
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

  console.log('\n──────────────────────────────────────────');
  console.log(`PASS: ${pass.length}  FAIL: ${fail.length}`);
  if (fail.length > 0) {
    console.error('Failing checks:');
    for (const f of fail) console.error('  - ' + f);
  }
  console.log('────────────── CASES ──────────────');
  console.log('1) BD-09 A/B/C resolvable | A would_aggregate one_per_event | B would_aggregate draft_per_event_then_batch_review | C would_aggregate periodic_netting');
  console.log('2) unconfigured  → fail_closed NOT_CONFIGURED (no default)');
  console.log('3) invalid "Z"   → fail_closed POLICY_INVALID');
  console.log('4) infra-absent  → POSTING_INFRASTRUCTURE_REQUIRED per option (A: no bonus_ledger trigger/RPC; B: draft+approval+marker+company; C: scheduler+marker+aggregation-identity+company)');
  console.log('5) aggregation-only → journalEntryId null; posting.status=not_aggregated; eventBoundary/aggregation/posting split explicit; fail_closed carries no aggregation payload');
  console.log('6) history lock → E1=A locked after live flip to B; E2=B; snapshot namespaced .aggregation.<ledgerId>');
  console.log('7) idempotency → same event id, identical effect, no dup journal/snapshot');
  console.log('8) source trace → bonus_ledger.ledgerId (TRUE identity), not account/order/customer; no reverts_id (aggregation-only)');
  console.log('9) company scope → COMPANY_POLICY_ISOLATION_GAP (ACC-10), no silent fallback');
  console.log('────────────── REGISTRY SHAPE ──────────────');
  console.log('BD09_OPTIONS =', JSON.stringify(BD09_OPTIONS));
  console.log('BD09_POLICY_KEY =', BD09_POLICY_KEY);
  console.log('BD09_SNAPSHOT_PREFIX =', BD09_SNAPSHOT_PREFIX);
  console.log('POSTING_INFRASTRUCTURE_REQUIRED =', POSTING_INFRASTRUCTURE_REQUIRED);
  console.log('AGGREGATION_IDENTITY_REQUIRED =', AGGREGATION_IDENTITY_REQUIRED);
  console.log('\n──────────────────────────────────────────');

  if (fail.length > 0) process.exitCode = 1;
}

void main();
