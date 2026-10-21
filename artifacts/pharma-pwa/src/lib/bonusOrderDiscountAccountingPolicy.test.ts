/*
 * BD-04 engine — CASE 1-7 (local / test-only).
 *
 * PURE-TS assertions with an in-memory fake store. No test runner is installed
 * in the workspace (package.json exposes no test script), and Node cannot
 * resolve the @/ alias — so this file imports the PURE engine via RELATIVE ./
 * paths only (never the Supabase-backed live wiring), which lets it run under
 * node --experimental-strip-types with zero new dependencies.
 *
 * Run locally (from the PWA source dir):
 *   node --experimental-strip-types src/lib/bonusOrderDiscountAccountingPolicy.test.ts
 *
 * CASES:
 *   1  BD-04 A -> would_post; receivable(1130)+revenue(4000); code undefined (no
 *      ACCOUNT_MAPPING_REQUIRED); net_invoice; no journal fabricated.
 *   2  BD-04 B -> would_post + ACCOUNT_MAPPING_REQUIRED (missing discount-contra
 *      account); gross_invoice; no journal fabricated.
 *   3  BD-04 is binary A/B: BD04_OPTIONS === [A,B] (frozen), NO invented C —
 *      storing "C" must resolve to fail_closed INVALID_ACCOUNTING_POLICY.
 *   4  Director flips A->B live: the ALREADY-invoiced discount KEEPS A (snapshot
 *      locked on its ledger.id); the historical reader returns A.
 *   5  Idempotency: same discount (same ledgerId) dispatched twice does not
 *      rewrite the snapshot; effectKey + journalEntryId identical; snapshotBonus
 *      helper is a no-op on collision.
 *   6  Unconfigured (no key) -> fail_closed ACCOUNTING_POLICY_NOT_CONFIGURED;
 *      invalid "Z" -> fail_closed INVALID_ACCOUNTING_POLICY; no journal either way.
 *   7  Account-mapping gap: B's discount_contra role is unmapped
 *      (ACCOUNT_MAPPING_REQUIRED, journalEntryId null); A has NO mapping gap
 *      (receivable + revenue both present, code undefined).
 *   X  (bonus) passing a companyId surfaces the ACC-10 COMPANY_POLICY_ISOLATION_GAP
 *      rather than a silent cross-company read.
 *
 * This file is excluded from tsconfig.json (the test-file glob, *.test.ts) and
 * is not imported by the app graph, so it does not affect tsc --noEmit or build.
 */

// Shared fail-closed sentinels + deps shape come from BD-01's base module
// (the same source BD-01's test imports — keeps the two engines' fixtures aligned).
import {
  POLICY_NOT_CONFIGURED,
  POLICY_INVALID,
  ACCOUNT_MAPPING_REQUIRED,
  ACCOUNTING_NOT_POSTED,
  BONUS_GL_ATOMICITY_GAP,
  COMPANY_POLICY_ISOLATION_GAP,
} from './bonusAccountingPolicy.ts';
// BD-04-specific symbols live in the pure engine under test.
import {
  BD04_POLICY_KEY,
  BD04_OPTIONS,
  TIMING_POLICY_REQUIRED,
  SOURCE_TRACE_GAP,
  resolveOrderDiscountAccountingPolicy,
  snapshotOrderDiscountPolicy,
  applyOrderDiscountAccounting,
  getHistoricalOrderDiscountPolicy,
} from './bonusOrderDiscountAccountingPolicy.ts';
import type {
  OrderDiscountDeps,
  DiscountAccountingContext,
  OrderDiscountDecision,
} from './bonusOrderDiscountAccountingPolicy.ts';

// ── In-memory fake bonus_settings store (no DB, no Supabase) ──────────────────
function makeStore(): { deps: OrderDiscountDeps; raw: Map<string, unknown> } {
  const raw = new Map<string, unknown>();
  const deps: OrderDiscountDeps = {
    readSetting: async (key: string) => (raw.has(key) ? raw.get(key) : null),
    upsertSetting: async (key: string, value: unknown) => {
      raw.set(key, value);
    },
  };
  return { deps, raw };
}

function ctx(ledgerId: string, companyId?: string | null): DiscountAccountingContext {
  return {
    identity: { ledgerId, orderId: 'order-' + ledgerId, idempotencyKey: null },
    status: 'POSTED', // E8 invoice creation boundary.
    companyId: companyId ?? null,
    discountAmount: null,
  };
}

// ── Minimal inline assertion harness (no node: imports -> no @types dependency) ─
let failures = 0;
const pass: string[] = [];
const fail: string[] = [];

function check(cond: boolean, msg: string): void {
  if (cond) {
    pass.push(msg);
    console.log('PASS: ' + msg);
  } else {
    failures++;
    fail.push(msg);
    console.error('FAIL: ' + msg);
  }
}

// ── CASE 1: BD-04 A -> would_post, receivable+revenue, no account gap ─────────
async function case1(
  store: { deps: OrderDiscountDeps; raw: Map<string, unknown> },
): Promise<void> {
  console.log('\n=== CASE 1: BD-04 A -> would_post / receivable + revenue ===');
  store.raw.set(BD04_POLICY_KEY, 'A');
  const decision = await applyOrderDiscountAccounting(ctx('ld-A-1'), store.deps);

  check(decision.option === 'A', 'CASE 1 – option resolved to A');
  check(decision.effect.kind === 'would_post', 'CASE 1 – effect is would_post (A intent)');
  check(
    decision.effect.kind === 'would_post' &&
      decision.effect.code === undefined,
    'CASE 1 – A has NO account-mapping gap (code undefined)',
  );
  check(
    decision.effect.kind === 'would_post' &&
      decision.effect.intendedAccounts.length === 2 &&
      decision.effect.intendedAccounts[0].role === 'receivable' &&
      decision.effect.intendedAccounts[1].role === 'revenue',
    'CASE 1 – intended roles are receivable(1130) + revenue(4000), no discount_contra',
  );
  check(
    decision.effect.kind === 'would_post' && decision.effect.basis === 'net_invoice',
    'CASE 1 – basis is net_invoice (order_total − discount, 0021:313-337)',
  );
  check(decision.journalEntryId === null, 'CASE 1 – NO journal fabricated despite would_post');
  check(decision.effectKey === 'bd04:orderdiscount:ld-A-1', 'CASE 1 – effectKey pinned to ORDER_DISCOUNT ledger id');
  check(
    decision.diagnostics.includes(ACCOUNTING_NOT_POSTED) &&
      decision.diagnostics.includes(BONUS_GL_ATOMICITY_GAP) &&
      decision.diagnostics.includes(TIMING_POLICY_REQUIRED) &&
      decision.diagnostics.includes(SOURCE_TRACE_GAP),
    'CASE 1 – fail-closed diagnostics surfaced (not-posted, GL atomic gap, timing, source-trace)',
  );
  check(
    decision.sourceTrace.sourceTable === 'bonus_ledger' &&
      decision.sourceTrace.documentType === 'order_discount' &&
      decision.sourceTrace.ledgerId === 'ld-A-1',
    'CASE 1 – source trace anchored on bonus_ledger ORDER_DISCOUNT row (R-1 ready)',
  );
  check(decision.alreadyHadPolicySnapshot === false, 'CASE 1 – first run wrote the snapshot');
  check(!decision.diagnostics.includes(ACCOUNT_MAPPING_REQUIRED), 'CASE 1 – A is a realisable intent (no ACCOUNT_MAPPING_REQUIRED)');
}

// ── CASE 2: BD-04 B -> would_post + ACCOUNT_MAPPING_REQUIRED ───────────────────
async function case2(
  store: { deps: OrderDiscountDeps; raw: Map<string, unknown> },
): Promise<void> {
  console.log('\n=== CASE 2: BD-04 B -> would_post / ACCOUNT_MAPPING_REQUIRED ===');
  store.raw.set(BD04_POLICY_KEY, 'B');
  const decision = await applyOrderDiscountAccounting(ctx('ld-B-1'), store.deps);

  check(decision.option === 'B', 'CASE 2 – option resolved to B');
  check(decision.effect.kind === 'would_post', 'CASE 2 – effect is would_post (B intent, fail-closed)');
  check(
    decision.effect.kind === 'would_post' && decision.effect.code === ACCOUNT_MAPPING_REQUIRED,
    'CASE 2 – B fails closed on missing discount-contra account',
  );
  check(
    decision.effect.kind === 'would_post' &&
      decision.effect.intendedAccounts.length === 3 &&
      decision.effect.intendedAccounts[2].role === 'discount_contra',
    'CASE 2 – intended roles include the unmapped discount_contra (absent from COA)',
  );
  check(
    decision.effect.kind === 'would_post' && decision.effect.basis === 'gross_invoice',
    'CASE 2 – basis is gross_invoice + separate contra entry',
  );
  check(decision.journalEntryId === null, 'CASE 2 – NO journal fabricated (B is fail-closed)');
  check(
    decision.diagnostics.includes(ACCOUNT_MAPPING_REQUIRED),
    'CASE 2 – ACCOUNT_MAPPING_REQUIRED surfaced in diagnostics',
  );
}

// ── CASE 3: BD-04 is binary A/B — no invented C ─────────────────────────────────
async function case3(
  store: { deps: OrderDiscountDeps; raw: Map<string, unknown> },
): Promise<void> {
  console.log('\n=== CASE 3: BD-04 binary A/B — no invented C ===');
  check(Array.isArray(BD04_OPTIONS), 'CASE 3 – BD04_OPTIONS is an array');
  check(BD04_OPTIONS.length === 2, 'CASE 3 – exactly two options (binary, no C)');
  check(BD04_OPTIONS.includes('A') && BD04_OPTIONS.includes('B'), 'CASE 3 – options are A and B');
  check(!BD04_OPTIONS.includes('C'), 'CASE 3 – C is NOT a registered BD-04 option (not invented)');
  check(Object.isFrozen(BD04_OPTIONS), 'CASE 3 – options registry is frozen (no in-place mutation)');

  // Storing a non-registered letter must reject it at resolve time -> fail_closed.
  store.raw.set(BD04_POLICY_KEY, 'C');
  const decision = await applyOrderDiscountAccounting(ctx('ld-C-1'), store.deps);
  check(decision.option === null, 'CASE 3 – option null when C is rejected');
  check(
    decision.effect.kind === 'fail_closed' &&
      decision.effect.code === POLICY_INVALID,
    'CASE 3 – storing C resolves to fail_closed INVALID_ACCOUNTING_POLICY (no invented dispatch)',
  );
}

// ── CASE 4: director flips A->B live; already-invoiced discount keeps A ─────────
async function case4(
  store: { deps: OrderDiscountDeps; raw: Map<string, unknown> },
): Promise<void> {
  console.log('\n=== CASE 4: live A->B flip must not rewrite an invoiced discount ===');
  // Discount already invoiced (E8 happened) under A -> snapshot written = A.
  store.raw.set(BD04_POLICY_KEY, 'A');
  const first = await applyOrderDiscountAccounting(ctx('ld-H-1'), store.deps);
  check(first.option === 'A' && first.alreadyHadPolicySnapshot === false, 'CASE 4 – first invoice under A writes snapshot');
  check(store.raw.get('accounting_policy.snapshot.ld-H-1') === 'A', 'CASE 4 – snapshot persisted as A');

  // Director later flips the LIVE policy to B.
  store.raw.set(BD04_POLICY_KEY, 'B');

  // A NEW discount (new ledger id) must now pick up B — director change is forward-only.
  const second = await applyOrderDiscountAccounting(ctx('ld-H-2'), store.deps);
  check(second.option === 'B', 'CASE 4 – a NEW discount resolves to B after the live flip');

  // The ALREADY-invoiced discount must NOT retroactively change its recorded policy.
  const third = await applyOrderDiscountAccounting(ctx('ld-H-1'), store.deps);
  check(
    third.option === 'B' && // live is now B, so the *live resolve* yields B...
      third.alreadyHadPolicySnapshot === true && // ...but the snapshot stays A
      store.raw.get('accounting_policy.snapshot.ld-H-1') === 'A',
    'CASE 4 – live resolves to B but the snapshotted discount keeps A (no retroactive rewrite)',
  );

  // Historical reader returns the locked-in option, proving auditability.
  const hist = await getHistoricalOrderDiscountPolicy('ld-H-1', store.deps);
  check(hist.option === 'A' && hist.source === 'snapshot', 'CASE 4 – historical reader returns snapshotted A for the invoiced discount');
}

// ── CASE 5: idempotency — same discount twice does not rewrite the snapshot ──────
async function case5(
  store: { deps: OrderDiscountDeps; raw: Map<string, unknown> },
): Promise<void> {
  console.log('\n=== CASE 5: idempotency + no snapshot rewrite ===');
  store.raw.set(BD04_POLICY_KEY, 'A');

  const first = await applyOrderDiscountAccounting(ctx('ld-I-1'), store.deps);
  check(first.alreadyHadPolicySnapshot === false, 'CASE 5 – first pass writes snapshot (written)');

  check(
    store.raw.has('accounting_policy.snapshot.ld-I-1') &&
      store.raw.get('accounting_policy.snapshot.ld-I-1') === 'A',
    'CASE 5 – snapshot key accounting_policy.snapshot.<ledgerId> == A',
  );

  const before = store.raw.get('accounting_policy.snapshot.ld-I-1');
  const second = await applyOrderDiscountAccounting(ctx('ld-I-1'), store.deps);
  const after = store.raw.get('accounting_policy.snapshot.ld-I-1');
  check(second.alreadyHadPolicySnapshot === true, 'CASE 5 – second pass detects existing snapshot');
  check(first.effectKey === second.effectKey, 'CASE 5 – identical effectKey on re-dispatch');
  check(first.journalEntryId === second.journalEntryId && first.journalEntryId === null, 'CASE 5 – identical (null) journalEntryId — no duplicate journal path');
  check(before === after && after === 'A', 'CASE 5 – snapshot left untouched (history protected)');

  // The snapshot helper itself is idempotent on collision.
  const snap1 = await snapshotOrderDiscountPolicy('ld-I-1', 'A', store.deps);
  const snap2 = await snapshotOrderDiscountPolicy('ld-I-1', 'A', store.deps);
  check(snap1.written === false && snap2.written === false, 'CASE 5 – snapshotOrderDiscountPolicy is a no-op on collision');
}

// ── CASE 6: unconfigured / invalid -> fail_closed ──────────────────────────────
async function case6(
  store: { deps: OrderDiscountDeps; raw: Map<string, unknown> },
): Promise<void> {
  console.log('\n=== CASE 6: unconfigured / invalid -> fail_closed ===');
  store.raw.delete(BD04_POLICY_KEY); // nothing set
  const unconf = await applyOrderDiscountAccounting(ctx('ld-U-1'), store.deps);
  check(unconf.option === null, 'CASE 6 – null option because resolution threw (unconfigured)');
  check(
    unconf.effect.kind === 'fail_closed' &&
      unconf.effect.code === POLICY_NOT_CONFIGURED,
    'CASE 6 – fail_closed ACCOUNTING_POLICY_NOT_CONFIGURED (no default assumed)',
  );
  check(unconf.journalEntryId === null, 'CASE 6 – no journal on unconfigured policy');
  check(
    unconf.alreadyHadPolicySnapshot === false && unconf.diagnostics.length === 0,
    'CASE 6 – nothing snapshotted when policy is unconfigured',
  );

  store.raw.set(BD04_POLICY_KEY, 'Z');
  const invalid = await applyOrderDiscountAccounting(ctx('ld-Z-1'), store.deps);
  check(invalid.option === null, 'CASE 6 – null option because resolution threw (invalid)');
  check(
    invalid.effect.kind === 'fail_closed' && invalid.effect.code === POLICY_INVALID,
    'CASE 6 – fail_closed INVALID_ACCOUNTING_POLICY (Z not in A/B)',
  );
  check(invalid.journalEntryId === null, 'CASE 6 – no journal on invalid policy');
}

// ── CASE 7: account-mapping gap — B blocked, A mappable ──────────────────────
async function case7(
  store: { deps: OrderDiscountDeps; raw: Map<string, unknown> },
): Promise<void> {
  console.log('\n=== CASE 7: account-mapping gap (B blocked, A mappable) ===');
  // B: the discount_contra account is absent -> ACCOUNT_MAPPING_REQUIRED, no journal.
  store.raw.set(BD04_POLICY_KEY, 'B');
  const b = await applyOrderDiscountAccounting(ctx('ld-G-1'), store.deps);
  check(
    b.effect.kind === 'would_post' && b.effect.code === ACCOUNT_MAPPING_REQUIRED,
    'CASE 7 – B trips ACCOUNT_MAPPING_REQUIRED on the missing discount_contra account',
  );
  check(b.journalEntryId === null, 'CASE 7 – B fabricates no journal');

  // A: receivable(1130)+revenue(4000) BOTH exist (0007:46,52) -> fully mappable, no gap.
  store.raw.set(BD04_POLICY_KEY, 'A');
  const a = await applyOrderDiscountAccounting(ctx('ld-G-2'), store.deps);
  check(a.effect.kind === 'would_post' && a.effect.code === undefined, 'CASE 7 – A has no account-mapping gap (code undefined)');
  check(!a.diagnostics.includes(ACCOUNT_MAPPING_REQUIRED), 'CASE 7 – A does NOT carry ACCOUNT_MAPPING_REQUIRED');
  check(
    a.effect.intendedAccounts.every((r) => r.role !== 'discount_contra'),
    'CASE 7 – A intended roles never reference the absent discount_contra',
  );
  check(a.journalEntryId === null, 'CASE 7 – A also fabricates no journal (engine never posts)');
}

// ── CASE X (bonus): company scope -> COMPANY_POLICY_ISOLATION_GAP ─────────────
async function caseCompanyGap(
  store: { deps: OrderDiscountDeps; raw: Map<string, unknown> },
): Promise<void> {
  console.log('\n=== CASE X (bonus): company scope -> COMPANY_POLICY_ISOLATION_GAP ===');
  store.raw.set(BD04_POLICY_KEY, 'A');
  const { diagnostics, option } = await resolveOrderDiscountAccountingPolicy(store.deps, 'co-999');
  check(option === 'A', 'CASE X – policy still resolves to A even when company supplied');
  check(
    diagnostics.includes(COMPANY_POLICY_ISOLATION_GAP),
    'CASE X – passing companyId surfaces ACC-10 isolation gap (not a silent cross-company read)',
  );
}

// ── Runner ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const s = makeStore();
  await case1(s);
  await case2(s);
  await case3(s);
  await case4(s);
  await case5(s);
  await case6(s);
  await case7(s);
  await caseCompanyGap(s);

  console.log('\n──────────────────────────────────────────');
  console.log(`PASS: ${pass.length}  FAIL: ${fail.length}`);
  if (fail.length > 0) {
    console.error('Failing checks:');
    for (const f of fail) console.error('  - ' + f);
  }
  console.log('────────────── CASES ──────────────');
  console.log('1) BD-04 A            → would_post / receivable + revenue (no gap)     ');
  console.log('2) BD-04 B            → would_post / ACCOUNT_MAPPING_REQUIRED          ');
  console.log('3) binary A/B         → no invented C; storing C rejected             ');
  console.log('4) live A->B          → invoiced discount keeps A (snapshot lock)     ');
  console.log('5) idempotency        → re-dispatch no-op; identical effectKey/null journal');
  console.log('6) unconfigured/invalid → fail_closed NOT_CONFIGURED / INVALID_ACCOUNTING_POLICY');
  console.log('7) mapping gap        → B blocked, A mappable (no ACCOUNT_MAPPING_REQUIRED) ');
  console.log('──────────────────────────────────────────');

  if (fail.length > 0) process.exitCode = 1;
}

void main();
