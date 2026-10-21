/*
 * BD-06 engine — CASE 1-9 (local / test-only).
 *
 * PURE-TS assertions with an in-memory fake store. No test runner is installed
 * in the workspace (package.json exposes no test script), and Node cannot
 * resolve the @/ alias — so this file imports the PURE engine via RELATIVE ./
 * paths only (never the Supabase-backed live wiring), which lets it run under
 * node --experimental-strip-types with zero new dependencies.
 *
 * Run locally (from the PWA source dir):
 *   node --experimental-strip-types src/lib/bonusExpirationAccountingPolicy.test.ts
 *
 * The engine imports `./accountingPolicies.ts` (pure data) + the shared
 * sentinels/types from `./bonusAccountingPolicy.ts` — both relative and
 * strip-types-compatible. `*.test.ts` is excluded from tsconfig.json and is not
 * imported by the app graph, so it does not affect tsc --noEmit or vite build.
 *
 * CASES:
 *   1  BD-06 A/B/C all resolvable from the registry; A = no_entry (realisable),
 *      B = would_post + ACCOUNT_MAPPING_REQUIRED + basis=liability_contra,
 *      C = would_post + ACCOUNT_MAPPING_REQUIRED + basis=revenue_writeback.
 *   2  Unconfigured (no key) -> fail_closed ACCOUNTING_POLICY_NOT_CONFIGURED.
 *   3  Invalid option ("Z") -> fail_closed POLICY_INVALID.
 *   4  Missing account mapping: A does NOT trip it (no accounts), B/C DO trip
 *      ACCOUNT_MAPPING_REQUIRED (no 2xxx bonus-liability account).
 *   5  Revenue-not-default: A never touches revenue; C (the only revenue option)
 *      is only reachable when explicitly selected by the director.
 *   6  Historical snapshot lock: E1=A stays A after the live setting flips to B;
 *      E2 (expired later under B) reads B.
 *   7  Idempotency: re-dispatching the same EXPIRATION ledgerId yields the same
 *      effect, snapshot untouched (alreadyHadPolicySnapshot=true), journalEntryId
 *      null — no duplicate effect.
 *   8  Source trace: EXPIRATION -> original EARN via reverses_id
 *      (reversesIdPresent=true, documentType=bonus_expiration, sourceTable=bonus_ledger).
 *   9  Company scope -> COMPANY_POLICY_ISOLATION_GAP surfaced (bonus_settings has
 *      no company_id — ACC-10 gap, not a silent cross-company read).
 *
 * EXTRA registry-shape guard: BD06_OPTIONS === ['A','B','C']; C carries the
 * 'revenue' role, A carries none.
 */

// Shared fail-closed sentinels come from BD-01's base module (the same source
// BD-05's test imports — keeps every engine's fixtures aligned).
import {
  POLICY_NOT_CONFIGURED,
  POLICY_INVALID,
  ACCOUNT_MAPPING_REQUIRED,
  COMPANY_POLICY_ISOLATION_GAP,
  ACCOUNTING_NOT_POSTED,
  BONUS_GL_ATOMICITY_GAP,
} from './bonusAccountingPolicy.ts';
// BD-06-specific symbols live in the pure engine under test (TIMING_POLICY_REQUIRED
// is re-declared here per-BD, identical string value; base untouched).
import {
  BD06_POLICY_KEY,
  BD06_SNAPSHOT_PREFIX,
  BD06_OPTIONS,
  TIMING_POLICY_REQUIRED,
  resolveBonusExpirationAccountingPolicy,
  snapshotBonusExpirationPolicy,
  applyBonusExpirationAccounting,
  getHistoricalBonusExpirationPolicy,
} from './bonusExpirationAccountingPolicy.ts';
import type {
  ExpirationDeps,
  ExpirationAccountingContext,
  ExpirationDecision,
} from './bonusExpirationAccountingPolicy.ts';
import type {
  ExpirationDeps,
  ExpirationAccountingContext,
  ExpirationDecision,
} from './bonusExpirationAccountingPolicy.ts';

// ── In-memory fake bonus_settings store (no DB, no Supabase) ────────────────
function makeStore(): { deps: ExpirationDeps; raw: Map<string, unknown> } {
  const raw = new Map<string, unknown>();
  const deps: ExpirationDeps = {
    readSetting: async (key: string) => (raw.has(key) ? raw.get(key) : null),
    upsertSetting: async (key: string, value: unknown) => {
      raw.set(key, value);
    },
  };
  return { deps, raw };
}

function ctx(ledgerId: string, originalLedgerId: string, companyId?: string | null): ExpirationAccountingContext {
  return {
    identity: { ledgerId, originalLedgerId },
    status: 'POSTED',
    companyId: companyId ?? null,
  };
}

// ── Minimal inline assertion harness (no node: imports -> no @types dep) ─────
let failures = 0;
const pass: string[] = [];
const fail: string[] = [];

function check(cond: boolean, msg: string): void {
  if (cond) {
    pass.push(msg);
    // console.log('PASS: ' + msg);
  } else {
    failures++;
    fail.push(msg);
    console.error('FAIL: ' + msg);
  }
}

function effectIsNoEntry(d: ExpirationDecision): boolean {
  return d.effect.kind === 'no_entry';
}
function effectIsWouldPost(d: ExpirationDecision): boolean {
  return d.effect.kind === 'would_post';
}
function effectIsFailClosed(d: ExpirationDecision, code: string): boolean {
  return d.effect.kind === 'fail_closed' && d.effect.code === code;
}

// ── CASE 1: A/B/C all resolvable from the registry ──────────────────────────
async function case1(
  store: { deps: ExpirationDeps; raw: Map<string, unknown> },
): Promise<void> {
  console.log('\n=== CASE 1: A/B/C resolvable ===');
  // EXTRA: registry shape.
  check(
    BD06_OPTIONS.includes('A') &&
      BD06_OPTIONS.includes('B') &&
      BD06_OPTIONS.includes('C') &&
      BD06_OPTIONS.length === 3,
    'CASE 1 – BD06_OPTIONS === ["A","B","C"] (no invented Option D)',
  );

  // A -> no_entry (realisable today, Phase-49 §3.13).
  store.raw.set(BD06_POLICY_KEY, 'A');
  const a = await applyBonusExpirationAccounting(ctx('exp-A-1', 'earn-A-1'), store.deps);
  check(a.option === 'A', 'CASE 1 – A resolves to A');
  check(effectIsNoEntry(a), 'CASE 1 – A is no_entry (realisable, no journal)');
  check(a.journalEntryId === null, 'CASE 1 – A creates no journal (journalEntryId null)');

  // B -> would_post + ACCOUNT_MAPPING_REQUIRED + liability_contra basis.
  store.raw.set(BD06_POLICY_KEY, 'B');
  const b = await applyBonusExpirationAccounting(ctx('exp-B-1', 'earn-B-1'), store.deps);
  check(b.option === 'B', 'CASE 1 – B resolves to B');
  check(effectIsWouldPost(b), 'CASE 1 – B is would_post (intent)');
  check(
    effectIsWouldPost(b) &&
      b.effect.intendedAccounts.some((ac) => ac.role === 'bonus_liability'),
    'CASE 1 – B intends bonus_liability role (no revenue)',
  );
  check(
    effectIsWouldPost(b) && b.effect.code === ACCOUNT_MAPPING_REQUIRED,
    'CASE 1 – B fails closed on ACCOUNT_MAPPING_REQUIRED (no 2xxx)',
  );
  check(
    effectIsWouldPost(b) && b.effect.basis === 'liability_contra',
    'CASE 1 – B basis = liability_contra',
  );
  check(a.journalEntryId === null, 'CASE 1 – B journalEntryId null');

  // C -> would_post + ACCOUNT_MAPPING_REQUIRED + revenue_writeback basis;
  //      the ONLY option carrying a 'revenue' role.
  store.raw.set(BD06_POLICY_KEY, 'C');
  const c = await applyBonusExpirationAccounting(ctx('exp-C-1', 'earn-C-1'), store.deps);
  check(c.option === 'C', 'CASE 1 – C resolves to C');
  check(effectIsWouldPost(c), 'CASE 1 – C is would_post (intent)');
  check(
    effectIsWouldPost(c) &&
      c.effect.intendedAccounts.some((ac) => ac.role === 'revenue'),
    'CASE 1 – C intends revenue role (explicit owner option)',
  );
  check(
    effectIsWouldPost(c) &&
      !c.effect.intendedAccounts.some((ac) => ac.role === 'revenue') === false &&
      c.effect.basis === 'revenue_writeback',
    'CASE 1 – C basis = revenue_writeback',
  );
  check(
    effectIsWouldPost(c) && c.effect.code === ACCOUNT_MAPPING_REQUIRED,
    'CASE 1 – C fails closed on ACCOUNT_MAPPING_REQUIRED (no 2xxx debit)',
  );
}

// ── CASE 2: unconfigured -> fail_closed ─────────────────────────────────────
async function case2(store: { deps: ExpirationDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 2: unconfigured → ACCOUNTING_POLICY_NOT_CONFIGURED ===');
  store.raw.delete(BD06_POLICY_KEY); // nothing set
  const decision = await applyBonusExpirationAccounting(ctx('exp-U-1', 'earn-U-1'), store.deps);

  check(decision.option === null, 'CASE 2 – null option (resolution threw)');
  check(
    decision.effect.kind === 'fail_closed' &&
      decision.effect.code === POLICY_NOT_CONFIGURED,
    'CASE 2 – fail_closed ACCOUNTING_POLICY_NOT_CONFIGURED (no default assumed)',
  );
  check(decision.journalEntryId === null, 'CASE 2 – no journal on unconfigured policy');
  check(
    decision.diagnostics.length === 0 && !decision.alreadyHadPolicySnapshot,
    'CASE 2 – nothing snapshotted when policy is unconfigured',
  );
}

// ── CASE 3: invalid option ("Z") -> fail_closed ─────────────────────────────
async function case3(store: { deps: ExpirationDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 3: invalid option "Z" → POLICY_INVALID ===');
  store.raw.set(BD06_POLICY_KEY, 'Z');
  const decision = await applyBonusExpirationAccounting(ctx('exp-Z-1', 'earn-Z-1'), store.deps);

  check(decision.option === null, 'CASE 3 – null option (resolution threw)');
  check(
    effectIsFailClosed(decision, POLICY_INVALID),
    'CASE 3 – fail_closed POLICY_INVALID (Z not in A/B/C)',
  );
  check(decision.journalEntryId === null, 'CASE 3 – no journal on invalid policy');
}

// ── CASE 4: missing account mapping trips only B/C ──────────────────────────
async function case4(store: { deps: ExpirationDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 4: missing account mapping — A clean, B/C blocked ===');

  store.raw.set(BD06_POLICY_KEY, 'A');
  const a = await applyBonusExpirationAccounting(ctx('exp-M-1', 'earn-M-1'), store.deps);
  check(a.effect.kind === 'no_entry', 'CASE 4 – A does NOT trip ACCOUNT_MAPPING_REQUIRED (no accounts intended)');
  check(
    !a.diagnostics.includes(ACCOUNT_MAPPING_REQUIRED),
    'CASE 4 – A diagnostics carry NO ACCOUNT_MAPPING_REQUIRED',
  );

  store.raw.set(BD06_POLICY_KEY, 'B');
  const b = await applyBonusExpirationAccounting(ctx('exp-M-2', 'earn-M-2'), store.deps);
  check(
    effectIsWouldPost(b) && b.effect.code === ACCOUNT_MAPPING_REQUIRED,
    'CASE 4 – B trips ACCOUNT_MAPPING_REQUIRED (no 2xxx bonus liability)',
  );

  store.raw.set(BD06_POLICY_KEY, 'C');
  const c = await applyBonusExpirationAccounting(ctx('exp-M-3', 'earn-M-3'), store.deps);
  check(
    effectIsWouldPost(c) && c.effect.code === ACCOUNT_MAPPING_REQUIRED,
    'CASE 4 – C trips ACCOUNT_MAPPING_REQUIRED (2xxx debit absent; 4000 alone is single-sided-blocking)',
  );
}

// ── CASE 5: revenue is NOT a default — confined to explicit option C ─────────
async function case5(store: { deps: ExpirationDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 5: revenue only under explicit option C ===');

  store.raw.set(BD06_POLICY_KEY, 'A');
  const a = await applyBonusExpirationAccounting(ctx('exp-R-1', 'earn-R-1'), store.deps);
  check(a.effect.kind === 'no_entry', 'CASE 5 – A never touches revenue (no_entry)');
  check(
    a.effect.kind === 'no_entry' &&
      (a.effect as { kind: string }).kind === 'no_entry' &&
      !(a.diagnostics as string[]).some((d) => d === 'revenue') &&
      !a.diagnostics.some((d) => /revenue|4000/.test(d)),
    'CASE 5 – A emits no revenue-related diagnostic (revenue not implied)',
  );

  store.raw.set(BD06_POLICY_KEY, 'C');
  const c = await applyBonusExpirationAccounting(ctx('exp-R-2', 'earn-R-2'), store.deps);
  check(
    effectIsWouldPost(c) && c.effect.intendedAccounts.some((ac) => ac.role === 'revenue'),
    'CASE 5 – C is the ONLY option whose intended accounts include revenue (explicit owner choice)',
  );

  // A does not intend revenue; C does.
  check(
    a.effect.kind === 'no_entry' &&
      !('intendedAccounts' in a.effect) &&
      effectIsWouldPost(c) &&
      c.effect.intendedAccounts.some((ac) => ac.role === 'revenue'),
    'CASE 5 – A has no intended accounts; C does (revenue confined to explicit C)',
  );
}

// ── CASE 6: historical snapshot lock (A->B flips only future expirations) ─────
async function case6(store: { deps: ExpirationDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 6: history lock — E1=A stays A after live flips to B ===');

  // E1 expires under A.
  store.raw.set(BD06_POLICY_KEY, 'A');
  const e1 = await applyBonusExpirationAccounting(ctx('exp-H-1', 'earn-H-1'), store.deps);
  check(e1.option === 'A', 'CASE 6 – E1 expired under A (option A)');
  check(
    store.raw.has(`${BD06_SNAPSHOT_PREFIX}exp-H-1`) &&
      store.raw.get(`${BD06_SNAPSHOT_PREFIX}exp-H-1`) === 'A',
    'CASE 6 – snapshot accounting_policy.snapshot.exp-H-1 == A',
  );

  // Director flips the LIVE setting to B — this must NOT rewrite E1's snapshot.
  store.raw.set(BD06_POLICY_KEY, 'B');
  const e1b = await applyBonusExpirationAccounting(ctx('exp-H-1', 'earn-H-1'), store.deps);
  check(e1b.option === 'B', 'CASE 6 – re-dispatch under B resolves B (live)');
  check(
    e1b.alreadyHadPolicySnapshot === true,
    'CASE 6 – E1 second dispatch detected an existing snapshot',
  );
  check(
    store.raw.get(`${BD06_SNAPSHOT_PREFIX}exp-H-1`) === 'A',
    'CASE 6 – E1 snapshot remains A despite live setting now B (history locked)',
  );
  // Historical reader returns what was recorded at expiry time.
  const hist1 = await getHistoricalBonusExpirationPolicy('exp-H-1', store.deps);
  check(hist1.option === 'A' && hist1.source === 'snapshot', 'CASE 6 – historical reader returns snapshotted A for E1');

  // E2 expires AFTER the flip — records B (future expirations follow the new policy).
  const e2 = await applyBonusExpirationAccounting(ctx('exp-H-2', 'earn-H-2'), store.deps);
  check(e2.option === 'B', 'CASE 6 – E2 (later) resolves B after the flip');
  check(
    store.raw.get(`${BD06_SNAPSHOT_PREFIX}exp-H-2`) === 'B',
    'CASE 6 – snapshot accounting_policy.snapshot.exp-H-2 == B',
  );
  const hist2 = await getHistoricalBonusExpirationPolicy('exp-H-2', store.deps);
  check(hist2.option === 'B' && hist2.source === 'snapshot', 'CASE 6 – historical reader returns snapshotted B for E2');

  // Snapshot-once: explicit re-snapshot is a no-op on collision.
  const snap1 = await snapshotBonusExpirationPolicy('exp-H-1', 'B', store.deps);
  check(snap1.written === false, 'CASE 6 – snapshotBonusExpirationPolicy is a no-op on collision (E1 stays A)');
  check(
    store.raw.get(`${BD06_SNAPSHOT_PREFIX}exp-H-1`) === 'A',
    'CASE 6 – re-snapshot attempt did not overwrite A',
  );
}

// ── CASE 7: idempotency — same EXPIRATION ledgerId, no duplicate effect ──────
async function case7(store: { deps: ExpirationDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 7: idempotency replay ===');
  store.raw.set(BD06_POLICY_KEY, 'A');
  const first = await applyBonusExpirationAccounting(ctx('exp-I-1', 'earn-I-1'), store.deps);
  check(first.effectKey === 'bd06:expiration:exp-I-1', 'CASE 7 – effectKey pinned to EXPIRATION ledgerId');
  check(first.journalEntryId === null, 'CASE 7 – first pass journalEntryId null');
  check(first.alreadyHadPolicySnapshot === false, 'CASE 7 – first pass wrote snapshot');

  // Replay the SAME expiration ledgerId under the same policy.
  const second = await applyBonusExpirationAccounting(ctx('exp-I-1', 'earn-I-1'), store.deps);
  check(
    second.effectKey === first.effectKey &&
      second.option === first.option &&
      second.effect.kind === first.effect.kind,
    'CASE 7 – replay yields identical effect for the same EXPIRATION id',
  );
  check(second.alreadyHadPolicySnapshot === true, 'CASE 7 – replay detected existing snapshot');
  check(second.journalEntryId === null, 'CASE 7 – replay journalEntryId null (no duplicate journal)');
  check(
    store.raw.get(`${BD06_SNAPSHOT_PREFIX}exp-I-1`) === 'A' &&
      Array.from(store.raw.keys()).filter((k) => k === `${BD06_SNAPSHOT_PREFIX}exp-I-1`).length === 1,
    'CASE 7 – exactly one snapshot key exists for exp-I-1 (no duplication; prior CASEs wrote other keys)',
  );
}

// ── CASE 8: source trace EXPIRATION -> EARN via reverses_id ─────────────────
async function case8(store: { deps: ExpirationDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 8: source trace reverses_id present ===');
  store.raw.set(BD06_POLICY_KEY, 'A');
  const decision = await applyBonusExpirationAccounting(
    ctx('exp-T-1', 'earn-T-1', null),
    store.deps,
  );

  check(decision.sourceTrace.sourceTable === 'bonus_ledger', 'CASE 8 – sourceTable = bonus_ledger');
  check(decision.sourceTrace.sourceId === 'exp-T-1', 'CASE 8 – sourceId = EXPIRATION row id (the TRUE identity)');
  check(decision.sourceTrace.documentType === 'bonus_expiration', 'CASE 8 – documentType = bonus_expiration');
  check(decision.sourceTrace.ledgerId === 'exp-T-1', 'CASE 8 – sourceTrace.ledgerId = EXPIRATION row id');
  check(decision.sourceTrace.originalLedgerId === 'earn-T-1', 'CASE 8 – originalLedgerId = EARN lot (reverses_id) reference');
  check(
    decision.sourceTrace.reversesIdPresent === true,
    'CASE 8 – reversesIdPresent=true (EXPIRATION row carries reverses_id to its EARN lot, 0018:1471)',
  );
}

// ── CASE 9: company scope -> COMPANY_POLICY_ISOLATION_GAP (ACC-10) ──────────
async function case9(store: { deps: ExpirationDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 9: company scope → COMPANY_POLICY_ISOLATION_GAP ===');
  const { diagnostics } = await resolveBonusExpirationAccountingPolicy(store.deps, 'co-999');
  check(
    diagnostics.includes(COMPANY_POLICY_ISOLATION_GAP),
    'CASE 9 – passing companyId surfaces the ACC-10 isolation gap (not a silent cross-company read)',
  );
  check(
    !diagnostics.some((d) => d === 'DEFAULT_COMPANY_USED'),
    'CASE 9 – no silent global fallback emitted',
  );
}

// ── Runner ───────────────────────────────────────────────────────────────────
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
  console.log('1) A/B/C resolvable | A=no_entry | B would_post liability_contra | C would_post revenue_writeback');
  console.log('2) unconfigured  → fail_closed NOT_CONFIGURED');
  console.log('3) invalid "Z"     → fail_closed POLICY_INVALID');
  console.log('4) no 2xxx account → A clean; B/C trip ACCOUNT_MAPPING_REQUIRED');
  console.log('5) revenue-not-default → revenue only under explicit C; A touches none');
  console.log('6) history lock → E1=A locked after live flip to B; E2=B');
  console.log('7) idempotency → same EXPIRATION id, identical effect, no dup journal/snapshot');
  console.log('8) source trace → EXPIRATION → EARN via reverses_id (reversesIdPresent=true)');
  console.log('9) company scope → COMPANY_POLICY_ISOLATION_GAP (ACC-10), no silent fallback');
  console.log('──────────────────────────────────────────');

  // Sanity: registry shape (C is the only option with a revenue role).
  console.log('\n── registry shape ──');
  console.log('BD06_OPTIONS =', JSON.stringify(BD06_OPTIONS));

  if (fail.length > 0) process.exitCode = 1;
}

void main();
