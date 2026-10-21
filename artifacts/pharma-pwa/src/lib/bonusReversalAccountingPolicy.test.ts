/*
 * BD-07 engine — CASE 1-9 (local / test-only).
 *
 * PURE-TS assertions with an in-memory fake store. No test runner is installed in
 * the workspace (package.json exposes no test script), and Node cannot resolve the @/
 * alias — so this file imports the PURE engine via RELATIVE ./ paths only (never the
 * Supabase-backed live wiring), which lets it run under `node --experimental-strip-types`
 * with zero new dependencies.
 *
 * Run locally (from the PWA source dir):
 *   node --experimental-strip-types src/lib/bonusReversalAccountingPolicy.test.ts
 *
 * Shared fail-closed sentinels come from BD-01's base module (`./bonusAccountingPolicy.ts`
 * — the same source BD-05's test imports, keeping every engine's fixtures aligned). BD-07-
 * specific symbols (REVERSAL_LINKAGE_GAP, TIMING_POLICY_REQUIRED, BD07_OPTIONS, the
 * decision/effect types) come from the pure engine under test.
 *
 * CASES:
 *   1  BD-07 registered with exactly options A/B (no C); A = would_post (mirror intent,
 *      blocked ACCOUNT_MAPPING_REQUIRED, basis mirror_compensation); B = no_entry.
 *   2  Unconfigured (no key) -> fail_closed ACCOUNTING_POLICY_NOT_CONFIGURED (no default).
 *   3  Invalid option ("Z") -> fail_closed POLICY_INVALID.
 *   4  Missing account mapping: A trips ACCOUNT_MAPPING_REQUIRED (no 2xxx); B does NOT
 *      (no accounts intended). 2100 is Suppliers, NOT a bonus liability.
 *   5  Revenue-not-involved: a reversal UNWINDS prior recognition — neither A nor B carries a
 *      'revenue' role.
 *   6  History lock: reversal under A stays A in its snapshot after the live setting flips to
 *      B; later reversals record B.
 *   7  Idempotency: re-dispatching the SAME reversal ledgerId yields the identical effect,
 *      snapshot untouched (alreadyHadPolicySnapshot=true), journalEntryId null.
 *   8  Source trace: REVERSAL row -> original event via reverts_id (reversesIdPresent=true,
 *      documentType=bonus_reversal) — present because reverse_bonus_txn writes reverts_id
 *      (0018:1395); NOT inherent to BD-07 (unlike BD-05 whose 0026 REFUND carries none).
 *   9  Company scope -> COMPANY_POLICY_ISOLATION_GAP surfaced (bonus_settings has no
 *      company_id — ACC-10 gap, not a silent cross-company read).
 *
 * EXTRA registry-shape guard: BD07_OPTIONS === ["A","B"] (binary; no invented Option C).
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
// BD-07-specific symbols live in the pure engine under test.
import {
  BD07_POLICY_KEY,
  BD07_SNAPSHOT_PREFIX,
  BD07_OPTIONS,
  REVERSAL_LINKAGE_GAP,
  TIMING_POLICY_REQUIRED,
  resolveBonusReversalAccountingPolicy,
  snapshotBonusReversalPolicy,
  applyBonusReversalAccounting,
  getHistoricalBonusReversalPolicy,
} from './bonusReversalAccountingPolicy.ts';
import type {
  ReversalDeps,
  ReversalAccountingContext,
  ReversalDecision,
} from './bonusReversalAccountingPolicy.ts';

// ── In-memory fake bonus_settings store (no DB, no Supabase) ───────────────────
function makeStore(): { deps: ReversalDeps; raw: Map<string, unknown> } {
  const raw = new Map<string, unknown>();
  const deps: ReversalDeps = {
    readSetting: async (key: string) => (raw.has(key) ? raw.get(key) : null),
    upsertSetting: async (key: string, value: unknown) => {
      raw.set(key, value);
    },
  };
  return { deps, raw };
}

function ctx(ledgerId: string, originalLedgerId: string, companyId?: string | null): ReversalAccountingContext {
  return {
    identity: {
      ledgerId,
      originalLedgerId,
      orderId: `order-for-${ledgerId}`,
      idempotencyKey: `REVERSAL:DISCOUNT:order-for-${ledgerId}`,
      accountId: 'acct-009',
    },
    status: 'POSTED',
    companyId: companyId ?? null,
    reversalAmount: 100,
  };
}

// ── Minimal inline assertion harness (no node: imports -> no @types dep) ────────
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

function effectIsNoEntry(d: ReversalDecision): boolean {
  return d.effect.kind === 'no_entry';
}
function effectIsWouldPost(d: ReversalDecision): boolean {
  return d.effect.kind === 'would_post';
}
function effectIsFailClosed(d: ReversalDecision, code: string): boolean {
  return d.effect.kind === 'fail_closed' && d.effect.code === code;
}

// ── CASE 1: BD-07 A/B resolvable from the registry ────────────────────────────
async function case1(store: { deps: ReversalDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 1: BD-07 A/B resolvable (exact registered set) ===');
  check(
    BD07_OPTIONS.length === 2 && BD07_OPTIONS.includes('A') && BD07_OPTIONS.includes('B'),
    'CASE 1 – BD07_OPTIONS === ["A","B"] (binary; no invented Option C)',
  );

  // A -> would_post mirror intent, blocked on the absent 2xxx bonus-liability account.
  store.raw.set(BD07_POLICY_KEY, 'A');
  const a = await applyBonusReversalAccounting(ctx('rev-A-1', 'ord-discount-A-1'), store.deps);
  check(a.option === 'A', 'CASE 1 – A resolves to A');
  check(effectIsWouldPost(a), 'CASE 1 – A is would_post (mirror intent)');
  check(
    effectIsWouldPost(a) && a.effect.code === ACCOUNT_MAPPING_REQUIRED,
    'CASE 1 – A fails closed on ACCOUNT_MAPPING_REQUIRED (no 2xxx bonus-liability account; 2100 is Suppliers)',
  );
  check(
    effectIsWouldPost(a) && a.effect.basis === 'mirror_compensation',
    'CASE 1 – A basis = mirror_compensation (قيد مرأة)',
  );
  check(a.journalEntryId === null, 'CASE 1 – A creates no journal (journalEntryId null)');
  check(
    effectIsWouldPost(a) && !a.effect.intendedAccounts.some((ac) => ac.role === 'revenue'),
    'CASE 1 – A carries no revenue role (reversal unwinds, never creates revenue)',
  );

  // B -> no_entry (realisable today).
  store.raw.set(BD07_POLICY_KEY, 'B');
  const b = await applyBonusReversalAccounting(ctx('rev-B-1', 'ord-discount-B-1'), store.deps);
  check(b.option === 'B', 'CASE 1 – B resolves to B');
  check(effectIsNoEntry(b), 'CASE 1 – B is no_entry (تسويل صافي / net settlement, realisable)');
  check(b.journalEntryId === null, 'CASE 1 – B creates no journal (journalEntryId null)');
  check(!('intendedAccounts' in b.effect), 'CASE 1 – B intends no accounts');
}

// ── CASE 2: unconfigured -> fail_closed ─────────────────────────────────────────
async function case2(store: { deps: ReversalDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 2: unconfigured → ACCOUNTING_POLICY_NOT_CONFIGURED ===');
  store.raw.delete(BD07_POLICY_KEY); // nothing set
  const decision = await applyBonusReversalAccounting(ctx('rev-U-1', 'ord-discount-U-1'), store.deps);

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

// ── CASE 3: invalid option ("Z") -> fail_closed ────────────────────────────────
async function case3(store: { deps: ReversalDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 3: invalid option "Z" → POLICY_INVALID ===');
  store.raw.set(BD07_POLICY_KEY, 'Z');
  const decision = await applyBonusReversalAccounting(ctx('rev-Z-1', 'ord-discount-Z-1'), store.deps);

  check(decision.option === null, 'CASE 3 – null option (resolution threw)');
  check(
    effectIsFailClosed(decision, POLICY_INVALID),
    'CASE 3 – fail_closed POLICY_INVALID (Z not in registered A/B)',
  );
  check(decision.journalEntryId === null, 'CASE 3 – no journal on invalid policy');
}

// ── CASE 4: missing account mapping trips only A ───────────────────────────────
async function case4(store: { deps: ReversalDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 4: missing 2xxx account — A trips ACCOUNT_MAPPING_REQUIRED; B does not ===');

  store.raw.set(BD07_POLICY_KEY, 'A');
  const a = await applyBonusReversalAccounting(ctx('rev-M-1', 'ord-discount-M-1'), store.deps);
  check(effectIsWouldPost(a), 'CASE 4 – A is would_post (intent present despite no account)');
  check(a.diagnostics.includes(ACCOUNT_MAPPING_REQUIRED), 'CASE 4 – A diagnostics carry ACCOUNT_MAPPING_REQUIRED');
  check(
    effectIsWouldPost(a) && a.effect.intendedAccounts.some((ac) => ac.role === 'bonus_liability'),
    'CASE 4 – A intends the bonus_liability role (2xxx, ABSENT in 0007:36-55)',
  );

  store.raw.set(BD07_POLICY_KEY, 'B');
  const b = await applyBonusReversalAccounting(ctx('rev-M-2', 'ord-discount-M-2'), store.deps);
  check(effectIsNoEntry(b), 'CASE 4 – B is no_entry (realisable, no accounts intended)');
  check(!b.diagnostics.includes(ACCOUNT_MAPPING_REQUIRED), 'CASE 4 – B does NOT trip ACCOUNT_MAPPING_REQUIRED (no accounts)');
}

// ── CASE 5: revenue-not-involved ───────────────────────────────────────────────
async function case5(store: { deps: ReversalDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 5: reversal never introduces revenue ─────────────────');

  store.raw.set(BD07_POLICY_KEY, 'A');
  const a = await applyBonusReversalAccounting(ctx('rev-R-1', 'ord-discount-R-1'), store.deps);
  check(effectIsWouldPost(a), 'CASE 5 – A is would_post');
  const aRoles = effectIsWouldPost(a) ? a.effect.intendedAccounts.map((ac) => ac.role) : [];
  check(aRoles.length === 1 && aRoles[0] === 'bonus_liability', 'CASE 5 – A intends only bonus_liability');
  check(!aRoles.includes('revenue'), 'CASE 5 – A carries no revenue role (reversal unwinds, never creates revenue)');

  store.raw.set(BD07_POLICY_KEY, 'B');
  const b = await applyBonusReversalAccounting(ctx('rev-R-2', 'ord-discount-R-2'), store.deps);
  check(effectIsNoEntry(b), 'CASE 5 – B is no_entry');
  check(!('intendedAccounts' in b.effect), 'CASE 5 – B intends no accounts (no revenue)');
}

// ── CASE 6: history lock — reversal under A stays A after flip to B ────────────
async function case6(store: { deps: ReversalDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 6: history lock — reversal under A stays A after live flips to B ===');

  // R1 reversal under A.
  store.raw.set(BD07_POLICY_KEY, 'A');
  const r1 = await applyBonusReversalAccounting(ctx('rev-H-1', 'ord-discount-H-1'), store.deps);
  check(r1.option === 'A', 'CASE 6 – R1 reversed under A (option A)');
  check(
    store.raw.has(`${BD07_SNAPSHOT_PREFIX}rev-H-1`) && store.raw.get(`${BD07_SNAPSHOT_PREFIX}rev-H-1`) === 'A',
    'CASE 6 – snapshot accounting_policy.snapshot.rev-H-1 == A',
  );

  // Director flips the LIVE setting A->B — must NOT rewrite R1's snapshot.
  store.raw.set(BD07_POLICY_KEY, 'B');
  const r1b = await applyBonusReversalAccounting(ctx('rev-H-1', 'ord-discount-H-1'), store.deps);
  check(r1b.option === 'B', 'CASE 6 – re-dispatch under B resolves B (live)');
  check(r1b.alreadyHadPolicySnapshot === true, 'CASE 6 – R1 second dispatch detected an existing snapshot');
  check(
    store.raw.get(`${BD07_SNAPSHOT_PREFIX}rev-H-1`) === 'A',
    'CASE 6 – R1 snapshot remains A despite live setting now B (history locked)',
  );
  // Historical reader returns what was recorded at reversal time.
  const hist1 = await getHistoricalBonusReversalPolicy('rev-H-1', store.deps);
  check(hist1.option === 'A' && hist1.source === 'snapshot', 'CASE 6 – historical reader returns snapshotted A for R1');

  // R2 reversal AFTER the flip — records B (future reversals follow the new policy).
  const r2 = await applyBonusReversalAccounting(ctx('rev-H-2', 'ord-discount-H-2'), store.deps);
  check(r2.option === 'B', 'CASE 6 – R2 (later) resolves B after the flip');
  check(
    store.raw.get(`${BD07_SNAPSHOT_PREFIX}rev-H-2`) === 'B',
    'CASE 6 – snapshot accounting_policy.snapshot.rev-H-2 == B',
  );
  const hist2 = await getHistoricalBonusReversalPolicy('rev-H-2', store.deps);
  check(hist2.option === 'B' && hist2.source === 'snapshot', 'CASE 6 – historical reader returns snapshotted B for R2');

  // Snapshot-once: explicit re-snapshot is a no-op on collision.
  const snap1 = await snapshotBonusReversalPolicy('rev-H-1', 'B', store.deps);
  check(snap1.written === false, 'CASE 6 – snapshotBonusReversalPolicy is a no-op on collision (R1 stays A)');
  check(
    store.raw.get(`${BD07_SNAPSHOT_PREFIX}rev-H-1`) === 'A',
    'CASE 6 – re-snapshot attempt did not overwrite A',
  );
}

// ── CASE 7: idempotency — same reversal ledgerId, no duplicate effect ──────────
async function case7(store: { deps: ReversalDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 7: idempotency replay ===');
  store.raw.set(BD07_POLICY_KEY, 'B');
  const first = await applyBonusReversalAccounting(ctx('rev-I-1', 'ord-discount-I-1'), store.deps);
  check(first.effectKey === 'bd07:reversal:rev-I-1', 'CASE 7 – effectKey pinned to REVERSAL ledgerId');
  check(first.journalEntryId === null, 'CASE 7 – first pass journalEntryId null');
  check(first.alreadyHadPolicySnapshot === false, 'CASE 7 – first pass wrote snapshot');
  check(
    first.effect.kind === 'no_entry' &&
      first.diagnostics.includes(ACCOUNTING_NOT_POSTED) === false &&
      first.diagnostics.includes(BONUS_GL_ATOMICITY_GAP) === false,
    'CASE 7 – B (no_entry) keeps the realisable diagnostics light (no intent gaps)',
  );

  // Replay the SAME reversal ledgerId under the same policy.
  const second = await applyBonusReversalAccounting(ctx('rev-I-1', 'ord-discount-I-1'), store.deps);
  check(
    second.effectKey === first.effectKey &&
      second.option === first.option &&
      second.effect.kind === first.effect.kind,
    'CASE 7 – replay yields identical effect for the same REVERSAL id',
  );
  check(second.alreadyHadPolicySnapshot === true, 'CASE 7 – replay detected existing snapshot');
  check(second.journalEntryId === null, 'CASE 7 – replay journalEntryId null (no duplicate journal)');
  const snapKey = `${BD07_SNAPSHOT_PREFIX}rev-I-1`;
  check(
    store.raw.get(snapKey) === 'B' &&
      Array.from(store.raw.keys()).filter((k) => k === snapKey).length === 1,
    'CASE 7 – exactly one snapshot key exists for rev-I-1 (no duplication)',
  );
}

// ── CASE 8: source trace REVERSAL -> original via reverts_id ───────────────────
async function case8(store: { deps: ReversalDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 8: source trace reverts_id present ===');
  store.raw.set(BD07_POLICY_KEY, 'A');
  const decision = await applyBonusReversalAccounting(
    ctx('rev-T-1', 'ord-discount-T-1', null),
    store.deps,
  );

  check(decision.sourceTrace.sourceTable === 'bonus_ledger', 'CASE 8 – sourceTable = bonus_ledger');
  check(decision.sourceTrace.sourceId === 'rev-T-1', 'CASE 8 – sourceId = REVERSAL row id (the TRUE identity)');
  check(decision.sourceTrace.documentType === 'bonus_reversal', 'CASE 8 – documentType = bonus_reversal');
  check(decision.sourceTrace.ledgerId === 'rev-T-1', 'CASE 8 – sourceTrace.ledgerId = REVERSAL row id');
  check(decision.sourceTrace.originalLedgerId === 'ord-discount-T-1', 'CASE 8 – originalLedgerId = reverts_id reference to the original event');
  check(
    decision.sourceTrace.reversesIdPresent === true,
    'CASE 8 – reversesIdPresent=true (reverse_bonus_txn writes reverts_id, 0018:1395 — NOT inherent to BD-07 unlike BD-05)',
  );
}

// ── CASE 9: company scope -> COMPANY_POLICY_ISOLATION_GAP (ACC-10) ─────────────
async function case9(store: { deps: ReversalDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 9: company scope → COMPANY_POLICY_ISOLATION_GAP ===');

  // Passing companyId surfaces the ACC-10 isolation gap (bonus_settings has no company_id).
  const { diagnostics } = await resolveBonusReversalAccountingPolicy(store.deps, 'co-999');
  check(
    diagnostics.includes(COMPANY_POLICY_ISOLATION_GAP),
    'CASE 9 – passing companyId surfaces the ACC-10 isolation gap (not a silent cross-company read)',
  );
  check(!diagnostics.some((d) => d === 'DEFAULT_COMPANY_USED'), 'CASE 9 – no silent global fallback emitted');

  // End-to-end via apply*: companyId propagates the gap into the B decision's diagnostics.
  store.raw.set(BD07_POLICY_KEY, 'B');
  const co = await applyBonusReversalAccounting(ctx('rev-C-1', 'ord-discount-C-1', 'co-999'), store.deps);
  check(co.diagnostics.includes(COMPANY_POLICY_ISOLATION_GAP), 'CASE 9 – B decision carries COMPANY_POLICY_ISOLATION_GAP');

  // No companyId -> no isolation gap (single-company assumption; nothing to isolate).
  store.raw.set(BD07_POLICY_KEY, 'B');
  const noco = await applyBonusReversalAccounting(ctx('rev-C-2', 'ord-discount-C-2', null), store.deps);
  check(!noco.diagnostics.includes(COMPANY_POLICY_ISOLATION_GAP), 'CASE 9 – no companyId -> no COMPANY_POLICY_ISOLATION_GAP');
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

  console.log('\n────────────────────────────────────────────');
  console.log(`PASS: ${pass.length}  FAIL: ${fail.length}`);
  if (fail.length > 0) {
    console.error('Failing checks:');
    for (const f of fail) console.error('  - ' + f);
  }
  console.log('────────────── CASES ──────────────');
  console.log('1) BD-07 A would_post mirror_compensation | B no_entry (تسويل صافي)');
  console.log('2) unconfigured → fail_closed NOT_CONFIGURED (no default)');
  console.log('3) invalid "Z"   → fail_closed POLICY_INVALID');
  console.log('4) no 2xxx account → A trips ACCOUNT_MAPPING_REQUIRED; B does not');
  console.log('5) revenue-not-involved → neither A nor B carries a revenue role');
  console.log('6) history lock → R1=A locked after live flip to B; R2=B');
  console.log('7) idempotency → same REVERSAL id, identical effect, no dup journal/snapshot');
  console.log('8) source trace → REVERSAL → original via reverts_id (reversesIdPresent=true)');
  console.log('9) company scope → COMPANY_POLICY_ISOLATION_GAP (ACC-10), no silent fallback');
  console.log('────────────── REGISTRY SHAPE ──────────────');
  console.log('BD07_OPTIONS =', JSON.stringify(BD07_OPTIONS));
  console.log('BD07_POLICY_KEY =', BD07_POLICY_KEY);
  console.log('BD07_SNAPSHOT_PREFIX =', BD07_SNAPSHOT_PREFIX);
  console.log('\n────────────────────────────────────────────');

  if (fail.length > 0) process.exitCode = 1;
}

void main();
