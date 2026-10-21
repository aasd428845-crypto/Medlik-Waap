/*
 * BD-08 engine — CASE 1-9 (local / test-only).
 *
 * PURE-TS assertions with an in-memory fake store. No test runner is installed in the
 * workspace (package.json exposes no test script), and Node cannot resolve the @/ alias — so
 * this file imports the PURE engine / types via RELATIVE ./ paths only (never the Supabase-backed
 * live wiring or the seam), which lets it run under `node --experimental-strip-types` with zero
 * new dependencies.
 *
 * Run locally (from the PWA source dir):
 *   node --experimental-strip-types src/lib/bonusTimingPolicy.test.ts
 *
 * Shared fail-closed sentinels come from BD-01's base module (`./bonusAccountingPolicy.ts` —
 * the same source BD-05/BD-06/BD-07 import, keeping every engine's fixtures aligned). BD-08-
 * specific symbols (TIMING_INFRASTRUCTURE_REQUIRED, BD08_OPTIONS, the decision/effect types)
 * come from the pure engine under test.
 *
 * CASES:
 *   1  BD-08 registered with exactly A/B/C (three options — NOT BD-07's binary A/B); A = would_post
 *      immediate | B = would_post draft_then_approval | C = would_schedule; all journalEntryId null.
 *   2  unconfigured  → fail_closed ACCOUNTING_POLICY_NOT_CONFIGURED (no default, no snapshot).
 *   3  invalid "Z"   → fail_closed POLICY_INVALID.
 *   4  infra-absent → every option carries TIMING_INFRASTRUCTURE_REQUIRED with OPTION-SPECIFIC
 *      infraMissing (A: T-1 trigger/T-2 call; B: draft-wired-to-bonus/approval/marker; C: scheduler/marker);
 *      journalEntryId null on every path.
 *   5  timing never posts → journalEntryId null on every path; posting.status='not_posted'; the
 *      three-layer decomposition (eventBoundary/PublishTiming/posting) is present and explicit.
 *   6  history lock → event under A stays A in its .timing. snapshot after the live setting flips
 *      to B; a later event records B; historical reader returns the snapshotted value.
 *   7  idempotency → same ledgerId re-dispatch yields identical effect, snapshot untouched
 *      (alreadyHadPolicySnapshot=true), journalEntryId null, exactly one snapshot key.
 *   8  source trace → sourceTable=bonus_ledger, sourceId=ledgerId (TRUE identity),
 *      documentType=eventType, ledgerId=event row id. (BD-08 is timing-only — no reverts_id.)
 *   9  company scope → COMPANY_POLICY_ISOLATION_GAP (ACC-10) surfenced, not a silent fallback.
 *
 * EXTRA registry-shape guard: BD08_OPTIONS === ["A","B","C"] (three options — distinguishes
 * BD-08 from BD-07's binary A/B, proving the option set is read from the registry, not assumed).
 */

// Shared fail-closed sentinels come from BD-01's base module (the same source BD-05/BD-06/BD-07
// import — keeps every engine's fixtures aligned).
import {
  POLICY_NOT_CONFIGURED,
  POLICY_INVALID,
  COMPANY_POLICY_ISOLATION_GAP,
  type BonusEarnDeps,
} from './bonusAccountingPolicy.ts';
// BD-08-specific symbols live in the pure engine under test.
import {
  BD08_POLICY_KEY,
  BD08_SNAPSHOT_PREFIX,
  BD08_OPTIONS,
  TIMING_INFRASTRUCTURE_REQUIRED,
  resolveBonusTimingPolicy,
  snapshotBonusTimingPolicy,
  applyBonusTimingPolicy,
  getHistoricalBonusTimingPolicy,
} from './bonusTimingPolicy.ts';
import type {
  TimingDeps,
  TimingContext,
  PublishTimingDecision,
} from './bonusTimingPolicy.ts';

// ── In-memory fake bonus_settings store (no DB, no Supabase) ─────────────────────
function makeStore(): { deps: TimingDeps; raw: Map<string, unknown> } {
  const raw = new Map<string, unknown>();
  const deps: TimingDeps = {
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
): TimingContext {
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

function effectIsWouldPost(d: PublishTimingDecision): boolean {
  return d.effect.kind === 'would_post';
}
function effectIsWouldSchedule(d: PublishTimingDecision): boolean {
  return d.effect.kind === 'would_schedule';
}
function effectIsFailClosed(d: PublishTimingDecision, code: string): boolean {
  return d.effect.kind === 'fail_closed' && d.effect.code === code;
}
function effectIsFailClosedAny(d: PublishTimingDecision): boolean {
  return d.effect.kind === 'fail_closed';
}

// ── CASE 1: BD-08 registered with exactly A/B/C ───────────────────────────────────
async function case1(store: { deps: TimingDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 1: BD-08 A/B/C resolvable from the registry ===');
  check(
    BD08_OPTIONS.length === 3 && BD08_OPTIONS.includes('A') && BD08_OPTIONS.includes('B') && BD08_OPTIONS.includes('C'),
    'CASE 1 – BD08_OPTIONS === ["A","B","C"] (three options — registry-driven, NOT assumed binary like BD-07)',
  );

  // A → would_post (immediate at event, T-1/T-2 + S-2), infra-absent.
  store.raw.set(BD08_POLICY_KEY, 'A');
  const a = await applyBonusTimingPolicy(ctx('evt-A-1', 'bonus_earn'), store.deps);
  check(a.option === 'A', 'CASE 1 – A resolves to A');
  check(effectIsWouldPost(a), 'CASE 1 – A is would_post (immediate publish intent)');
  check(
    effectIsWouldPost(a) && a.effect.publishTiming === 'immediate',
    'CASE 1 – A publishTiming = immediate (T-1/T-2 + S-2)',
  );
  check(
    effectIsWouldPost(a) && a.effect.infra.code === TIMING_INFRASTRUCTURE_REQUIRED,
    'CASE 1 – A carries TIMING_INFRASTRUCTURE_REQUIRED (no trigger/call on bonus_ledger)',
  );
  check(a.journalEntryId === null, 'CASE 1 – A creates no journal (journalEntryId null)');

  // B → would_post (draft at event, publish later, S-1).
  store.raw.set(BD08_POLICY_KEY, 'B');
  const b = await applyBonusTimingPolicy(ctx('evt-B-1', 'bonus_earn'), store.deps);
  check(b.option === 'B', 'CASE 1 – B resolves to B');
  check(effectIsWouldPost(b), 'CASE 1 – B is would_post (draft-then-publish intent)');
  check(
    effectIsWouldPost(b) && b.effect.publishTiming === 'draft_then_approval',
    'CASE 1 – B publishTiming = draft_then_approval (S-1 + manual publish)',
  );
  check(b.journalEntryId === null, 'CASE 1 – B creates no journal (journalEntryId null)');

  // C → would_schedule (periodic batch sweep, T-3).
  store.raw.set(BD08_POLICY_KEY, 'C');
  const c = await applyBonusTimingPolicy(ctx('evt-C-1', 'bonus_earn'), store.deps);
  check(c.option === 'C', 'CASE 1 – C resolves to C');
  check(effectIsWouldSchedule(c), 'CASE 1 – C is would_schedule (deferred to a T-3 sweep)');
  check(
    effectIsWouldSchedule(c) && c.effect.infra.code === TIMING_INFRASTRUCTURE_REQUIRED,
    'CASE 1 – C carries TIMING_INFRASTRUCTURE_REQUIRED (no scheduler exists)',
  );
  check(c.journalEntryId === null, 'CASE 1 – C creates no journal (journalEntryId null)');
}

// ── CASE 2: unconfigured -> fail_closed ──────────────────────────────────────────
async function case2(store: { deps: TimingDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 2: unconfigured → ACCOUNTING_POLICY_NOT_CONFIGURED ===');
  store.raw.delete(BD08_POLICY_KEY); // nothing set
  const decision = await applyBonusTimingPolicy(ctx('evt-U-1', 'bonus_earn'), store.deps);

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
async function case3(store: { deps: TimingDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 3: invalid option "Z" → POLICY_INVALID ===');
  store.raw.set(BD08_POLICY_KEY, 'Z');
  const decision = await applyBonusTimingPolicy(ctx('evt-Z-1', 'bonus_earn'), store.deps);

  check(decision.option === null, 'CASE 3 – null option (resolution threw)');
  check(
    effectIsFailClosed(decision, POLICY_INVALID),
    'CASE 3 – fail_closed POLICY_INVALID (Z not in registered A/B/C)',
  );
  check(decision.journalEntryId === null, 'CASE 3 – no journal on invalid policy');
}

// ── CASE 4: infra-absent — option-specific missing infra ─────────────────────────
async function case4(store: { deps: TimingDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 4: infra-absent → TIMING_INFRASTRUCTURE_REQUIRED per option ===');

  // A: infraMissing mentions the T-1 trigger on bonus_ledger / the unwired T-2 RPC call.
  store.raw.set(BD08_POLICY_KEY, 'A');
  const a = await applyBonusTimingPolicy(ctx('evt-M-1', 'bonus_earn'), store.deps);
  check(
    effectIsWouldPost(a) && a.diagnostics.includes(TIMING_INFRASTRUCTURE_REQUIRED),
    'CASE 4 – A diagnostics carry TIMING_INFRASTRUCTURE_REQUIRED',
  );
  check(
    effectIsWouldPost(a) &&
      a.effect.infra.infraMissing.length >= 2 &&
      a.effect.infra.infraMissing.some((m) => m.includes('bonus_ledger') && m.includes('trigger')),
    'CASE 4 – A infraMissing names the absent T-1 trigger on bonus_ledger',
  );
  check(
    effectIsWouldPost(a) &&
      a.effect.infra.infraMissing.some((m) => m.includes('T-2') || m.includes('RPC body')),
    'CASE 4 – A infraMissing names the unwired T-2 RPC call',
  );
  check(a.journalEntryId === null, 'CASE 4 – A journalEntryId null');

  // B: infraMissing mentions draft-not-wired / approval flow / published marker.
  store.raw.set(BD08_POLICY_KEY, 'B');
  const b = await applyBonusTimingPolicy(ctx('evt-M-2', 'bonus_earn'), store.deps);
  check(
    effectIsWouldPost(b) && b.diagnostics.includes(TIMING_INFRASTRUCTURE_REQUIRED),
    'CASE 4 – B diagnostics carry TIMING_INFRASTRUCTURE_REQUIRED',
  );
  check(
    effectIsWouldPost(b) &&
      b.effect.infra.infraMissing.some((m) => /draft journal/i.test(m) && /bonus_ledger/.test(m)),
    'CASE 4 – B infraMissing names the draft journal not wired to bonus_ledger',
  );
  check(
    effectIsWouldPost(b) &&
      b.effect.infra.infraMissing.some((m) => /approval|owner/i.test(m)),
    'CASE 4 – B infraMissing names the absent owner approval flow (ACC-11)',
  );
  check(
    effectIsWouldPost(b) &&
      b.effect.infra.infraMissing.some((m) => /published\/posted-marker|marker/.test(m)),
    'CASE 4 – B infraMissing names the absent published/posted marker (§4.3 Q6)',
  );
  check(b.journalEntryId === null, 'CASE 4 – B journalEntryId null');

  // C: infraMissing mentions the scheduler and the published marker.
  store.raw.set(BD08_POLICY_KEY, 'C');
  const c = await applyBonusTimingPolicy(ctx('evt-M-3', 'bonus_earn'), store.deps);
  check(
    effectIsWouldSchedule(c) && c.diagnostics.includes(TIMING_INFRASTRUCTURE_REQUIRED),
    'CASE 4 – C diagnostics carry TIMING_INFRASTRUCTURE_REQUIRED',
  );
  check(
    effectIsWouldSchedule(c) &&
      c.effect.infra.infraMissing.some((m) => /scheduler/.test(m)),
    'CASE 4 – C infraMissing names the absent scheduler ("no scheduler anywhere", Phase-49 §9.1 line 699)',
  );
  check(
    effectIsWouldSchedule(c) &&
      c.effect.infra.infraMissing.some((m) => /marker/.test(m)),
    'CASE 4 – C infraMissing names the absent published/posted marker (§4.3 Q6)',
  );
  check(c.journalEntryId === null, 'CASE 4 – C journalEntryId null');
}

// ── CASE 5: timing never posts (three-layer decomposition explicit) ───────────────
async function case5(store: { deps: TimingDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 5: BD-08 never posts — journalEntryId null; three-layer split ===');

  for (const opt of ['A', 'B', 'C'] as const) {
    store.raw.set(BD08_POLICY_KEY, opt);
    const d = await applyBonusTimingPolicy(ctx(`evt-N-${opt}`, 'bonus_earn'), store.deps);
    check(d.journalEntryId === null, `CASE 5 – option ${opt}: journalEntryId null (no journal ever fabricated)`);
    check(d.posting.status === 'not_posted', `CASE 5 – option ${opt}: posting.status = 'not_posted'`);
    check(
      d.posting.journalEntryId === null,
      `CASE 5 – option ${opt}: posting.journalEntryId null`,
    );
    check(
      d.eventBoundary.recordedAt === 'bonus_ledger.POSTED',
      `CASE 5 – option ${opt}: eventBoundary = bonus_ledger.POSTED (boundary owned by the event engine)`,
    );
    check(
      d.publishTiming.intent !== null,
      `CASE 5 – option ${opt}: publishTiming.intent resolved (BD-08 owns timing only)`,
    );
  }

  // fail_closed path also posts nothing.
  store.raw.delete(BD08_POLICY_KEY);
  const fc = await applyBonusTimingPolicy(ctx('evt-N-F', 'bonus_earn'), store.deps);
  check(fc.journalEntryId === null, 'CASE 5 – fail_closed: journalEntryId null');
  check(fc.posting.status === 'not_posted', 'CASE 5 – fail_closed: posting.status = not_posted');
  check(
    effectIsFailClosedAny(fc),
    'CASE 5 – fail_closed path reachable (no_entry intentionally absent: every BD-08 option carries a timing intent)',
  );
  check(
    !('intendedAccounts' in fc.effect) && !('infra' in fc.effect),
    'CASE 5 – fail_closed carries no account/infra payload (timing-only model)',
  );
}

// ── CASE 6: history lock — event under A stays A after live flips to B ─────────────
async function case6(store: { deps: TimingDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 6: history lock — event timing under A stays A after live flips to B ===');

  // E1 earns under A.
  store.raw.set(BD08_POLICY_KEY, 'A');
  const e1 = await applyBonusTimingPolicy(ctx('evt-H-1', 'bonus_earn'), store.deps);
  check(e1.option === 'A', 'CASE 6 – E1 resolved under A (option A)');
  check(
    store.raw.has(`${BD08_SNAPSHOT_PREFIX}evt-H-1`) &&
      store.raw.get(`${BD08_SNAPSHOT_PREFIX}evt-H-1`) === 'A',
    'CASE 6 – snapshot accounting_policy.snapshot.timing.evt-H-1 == A (namespaced)',
  );

  // Director flips the LIVE setting A->B — must NOT rewrite E1's timing snapshot.
  store.raw.set(BD08_POLICY_KEY, 'B');
  const e1b = await applyBonusTimingPolicy(ctx('evt-H-1', 'bonus_earn'), store.deps);
  check(e1b.option === 'B', 'CASE 6 – re-dispatch under B resolves B (live)');
  check(e1b.alreadyHadPolicySnapshot === true, 'CASE 6 – E1 second dispatch detected an existing timing snapshot');
  check(
    store.raw.get(`${BD08_SNAPSHOT_PREFIX}evt-H-1`) === 'A',
    'CASE 6 – E1 timing snapshot remains A despite live setting now B (history locked)',
  );
  // Historical reader returns what was recorded at event time.
  const hist1 = await getHistoricalBonusTimingPolicy('evt-H-1', store.deps);
  check(hist1.option === 'A' && hist1.source === 'snapshot', 'CASE 6 – historical reader returns snapshotted A for E1');

  // E2 earns AFTER the flip — records B (future events follow the new policy).
  const e2 = await applyBonusTimingPolicy(ctx('evt-H-2', 'bonus_earn'), store.deps);
  check(e2.option === 'B', 'CASE 6 – E2 (later) resolves B after the flip');
  check(
    store.raw.get(`${BD08_SNAPSHOT_PREFIX}evt-H-2`) === 'B',
    'CASE 6 – snapshot accounting_policy.snapshot.timing.evt-H-2 == B',
  );
  const hist2 = await getHistoricalBonusTimingPolicy('evt-H-2', store.deps);
  check(hist2.option === 'B' && hist2.source === 'snapshot', 'CASE 6 – historical reader returns snapshotted B for E2');

  // Snapshot-once: explicit re-snapshot is a no-op on collision.
  const snap1 = await snapshotBonusTimingPolicy('evt-H-1', 'B', store.deps);
  check(snap1.written === false, 'CASE 6 – snapshotBonusTimingPolicy is a no-op on collision (E1 stays A)');
  check(
    store.raw.get(`${BD08_SNAPSHOT_PREFIX}evt-H-1`) === 'A',
    'CASE 6 – re-snapshot attempt did not overwrite A',
  );
}

// ── CASE 7: idempotency — same event ledgerId, no duplicate effect ───────────────
async function case7(store: { deps: TimingDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 7: idempotency replay ===');
  store.raw.set(BD08_POLICY_KEY, 'C');
  const first = await applyBonusTimingPolicy(ctx('evt-I-1', 'bonus_earn'), store.deps);
  check(first.effectKey === 'bd08:timing:evt-I-1', 'CASE 7 – effectKey pinned to the event ledgerId (TRUE identity)');
  check(first.journalEntryId === null, 'CASE 7 – first pass journalEntryId null');
  check(first.alreadyHadPolicySnapshot === false, 'CASE 7 – first pass wrote the timing snapshot');
  check(
    effectIsWouldSchedule(first) && first.effect.infra.code === TIMING_INFRASTRUCTURE_REQUIRED,
    'CASE 7 – C first pass: would_schedule + TIMING_INFRASTRUCTURE_REQUIRED (no scheduler)',
  );

  // Replay the SAME event ledgerId under the same policy.
  const second = await applyBonusTimingPolicy(ctx('evt-I-1', 'bonus_earn'), store.deps);
  check(
    second.effectKey === first.effectKey &&
      second.option === first.option &&
      second.effect.kind === first.effect.kind &&
      second.publishTiming.intent === first.publishTiming.intent,
    'CASE 7 – replay yields identical effect + timing intent for the same event id',
  );
  check(second.alreadyHadPolicySnapshot === true, 'CASE 7 – replay detected existing timing snapshot');
  check(second.journalEntryId === null, 'CASE 7 – replay journalEntryId null (no duplicate journal)');
  const snapKey = `${BD08_SNAPSHOT_PREFIX}evt-I-1`;
  check(
    store.raw.get(snapKey) === 'C' &&
      Array.from(store.raw.keys()).filter((k) => k === snapKey).length === 1,
    'CASE 7 – exactly one timing snapshot key exists for evt-I-1 (no duplication; prior CASEs wrote other keys)',
  );
}

// ── CASE 8: source trace — TRUE event identity (no reverts_id for timing) ───────────
async function case8(store: { deps: TimingDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 8: source trace pinned to the TRUE bonus_ledger event identity ===');
  store.raw.set(BD08_POLICY_KEY, 'A');
  const decision = await applyBonusTimingPolicy(
    ctx('evt-T-1', 'bonus_redemption', null),
    store.deps,
  );

  check(decision.sourceTrace.sourceTable === 'bonus_ledger', 'CASE 8 – sourceTable = bonus_ledger');
  check(decision.sourceTrace.sourceId === 'evt-T-1', 'CASE 8 – sourceId = the event row id (TRUE identity), NOT account/order/customer');
  check(decision.sourceTrace.ledgerId === 'evt-T-1', 'CASE 8 – sourceTrace.ledgerId = event row id');
  check(decision.sourceTrace.eventType === 'bonus_redemption', 'CASE 8 – documentType = the event type (bonus_redemption)');
  check(
    decision.effectKey === 'bd08:timing:evt-T-1',
    'CASE 8 – effectKey keyed on the TRUE event identity (bonus_ledger.id), never a surrogate',
  );
  // BD-08 is a timing policy — it has no reverses_id concept (that is the compensation
  // engines' domain). The absence is structural, not a gap.
  check(
    !('reversesIdPresent' in decision.sourceTrace),
    'CASE 8 – BD-08 source-trace has no reverses_id field (timing-only; reverts_id belongs to BD-07 compensation, not BD-08)',
  );
}

// ── CASE 9: company scope -> COMPANY_POLICY_ISOLATION_GAP (ACC-10) ────────────────
async function case9(store: { deps: TimingDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 9: company scope → COMPANY_POLICY_ISOLATION_GAP ===');

  // Passing companyId surfaces the ACC-10 isolation gap (bonus_settings has no company_id).
  const { diagnostics } = await resolveBonusTimingPolicy(store.deps, 'co-999');
  check(
    diagnostics.includes(COMPANY_POLICY_ISOLATION_GAP),
    'CASE 9 – passing companyId surfaces the ACC-10 isolation gap (not a silent cross-company read)',
  );
  check(!diagnostics.some((d) => d === 'DEFAULT_COMPANY_USED'), 'CASE 9 – no silent global fallback emitted');

  // End-to-end via apply*: companyId propagates the gap into the A decision's diagnostics.
  store.raw.set(BD08_POLICY_KEY, 'A');
  const co = await applyBonusTimingPolicy(ctx('evt-C-1', 'bonus_earn', 'co-999'), store.deps);
  check(co.diagnostics.includes(COMPANY_POLICY_ISOLATION_GAP), 'CASE 9 – A decision carries COMPANY_POLICY_ISOLATION_GAP');

  // No companyId -> no isolation gap (single-company assumption; nothing to isolate).
  store.raw.set(BD08_POLICY_KEY, 'A');
  const noco = await applyBonusTimingPolicy(ctx('evt-C-2', 'bonus_earn', null), store.deps);
  check(!noco.diagnostics.includes(COMPANY_POLICY_ISOLATION_GAP), 'CASE 9 – no companyId -> no COMPANY_POLICY_ISOLATION_GAP');
  // And the live C-3 resolver is the same helper BD-07 reuses (readCurrentCompanyId, 0009:57).
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
  console.log('1) BD-08 A/B/C resolvable | A would_post immediate | B would_post draft_then_approval | C would_schedule');
  console.log('2) unconfigured  → fail_closed NOT_CONFIGURED (no default)');
  console.log('3) invalid "Z"   → fail_closed POLICY_INVALID');
  console.log('4) infra-absent  → TIMING_INFRASTRUCTURE_REQUIRED per option (A: trigger/call; B: draft+approval+marker; C: scheduler+marker)');
  console.log('5) timing never posts → journalEntryId null; posting.status=not_posted; EventBoundary/PublishTiming/Posting split explicit');
  console.log('6) history lock → E1=A locked after live flip to B; E2=B; snapshot namespaced .timing.<ledgerId>');
  console.log('7) idempotency → same event id, identical effect, no dup journal/snapshot');
  console.log('8) source trace → bonus_ledger.eventId (TRUE identity), not account/order/customer; no reverts_id (timing-only)');
  console.log('9) company scope → COMPANY_POLICY_ISOLATION_GAP (ACC-10), no silent fallback');
  console.log('────────────── REGISTRY SHAPE ──────────────');
  console.log('BD08_OPTIONS =', JSON.stringify(BD08_OPTIONS));
  console.log('BD08_POLICY_KEY =', BD08_POLICY_KEY);
  console.log('BD08_SNAPSHOT_PREFIX =', BD08_SNAPSHOT_PREFIX);
  console.log('\n──────────────────────────────────────────');

  if (fail.length > 0) process.exitCode = 1;
}

void main();
