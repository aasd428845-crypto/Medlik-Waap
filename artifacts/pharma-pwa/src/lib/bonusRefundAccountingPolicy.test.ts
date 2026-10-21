/*
 * BD-05 engine — CASE 1-9 (local / test-only).
 *
 * PURE-TS assertions with an in-memory fake store. No test runner is installed
 * in the workspace (package.json exposes no test script), and Node cannot
 * resolve the @/ alias — so this file imports the PURE engine via RELATIVE ./
 * paths only (never the Supabase-backed live wiring), which lets it run under
 * node --experimental-strip-types with zero new dependencies.
 *
 * Run locally (from the PWA source dir):
 *   node --experimental-strip-types src/lib/bonusRefundAccountingPolicy.test.ts
 *
 * CASES (per the BD-05 directive, items 18):
 *   1  BD-05 A -> would_post intent; bonus_liability role; ACCOUNT_MAPPING_REQUIRED
 *      (2xxx absent); no journal fabricated; snapshot written.
 *   2  BD-05 B -> fail_closed INVOICE_REPRICING_REQUIRED (0026 does not reprice the
 *      posted invoice); no journal.
 *   3  missing policy -> fail_closed ACCOUNTING_POLICY_NOT_CONFIGURED (no default).
 *   4  invalid policy "Z" -> fail_closed INVALID_ACCOUNTING_POLICY.
 *   5  missing account mapping -> A trips ACCOUNT_MAPPING_REQUIRED on the absent
 *      bonus_liability account (1130/4000 exist; no 2xxx).
 *   6  director flips A->B live: already-refunded R1 keeps A (snapshot lock); new
 *      refund R2 uses B.
 *   7  same idempotency key (same REFUND ledger id) twice -> no duplicate: identical
 *      effectKey, null journalEntryId both, snapshot untouched.
 *   8  source trace: REFUND traces back to its original ORDER_DISCOUNT ledger id.
 *   9  passing companyId surfaces COMPANY_POLICY_ISOLATION_GAP (no silent cross-company
 *      read — ACC-10).
 *
 * This file is excluded from tsconfig.json (the test-file glob, *.test.ts) and is not
 * imported by the app graph, so it does not affect tsc --noEmit or build.
 */

// Shared fail-closed sentinels + deps shape come from BD-01's base module
// (the same source BD-04's test imports — keeps every engine's fixtures aligned).
import {
  POLICY_NOT_CONFIGURED,
  POLICY_INVALID,
  ACCOUNT_MAPPING_REQUIRED,
  ACCOUNTING_NOT_POSTED,
  BONUS_GL_ATOMICITY_GAP,
  COMPANY_POLICY_ISOLATION_GAP,
} from './bonusAccountingPolicy.ts';
// BD-05-specific symbols live in the pure engine under test.
import {
  BD05_POLICY_KEY,
  BD05_OPTIONS,
  REVERSAL_LINKAGE_GAP,
  INVOICE_REPRICING_REQUIRED,
  TIMING_POLICY_REQUIRED,
  SOURCE_TRACE_GAP,
  resolveOrderRefundAccountingPolicy,
  snapshotRefundPolicy,
  applyOrderRefundAccounting,
  getHistoricalRefundPolicy,
} from './bonusRefundAccountingPolicy.ts';
import type {
  RefundDeps,
  RefundAccountingContext,
  RefundDecision,
} from './bonusRefundAccountingPolicy.ts';

// ── In-memory fake bonus_settings store (no DB, no Supabase) ──────────────────
function makeStore(): { deps: RefundDeps; raw: Map<string, unknown> } {
  const raw = new Map<string, unknown>();
  const deps: RefundDeps = {
    readSetting: async (key: string) => (raw.has(key) ? raw.get(key) : null),
    upsertSetting: async (key: string, value: unknown) => {
      raw.set(key, value);
    },
  };
  return { deps, raw };
}

function refCtx(
  refundLedgerId: string,
  originalLedgerId?: string,
  companyId?: string | null,
): RefundAccountingContext {
  return {
    identity: {
      ledgerId: refundLedgerId,
      originalLedgerId: originalLedgerId ?? `orig-${refundLedgerId}`,
      orderId: `order-${refundLedgerId}`,
      idempotencyKey: `MOD:order-${refundLedgerId}:item-${refundLedgerId}`,
    },
    status: 'POSTED', // E10: the REFUND bonus_ledger row was just created by 0026.
    companyId: companyId ?? null,
    refundAmount: 120, // v_refund = v_discount - v_new_discount (0026:99) — context only.
    originalDiscountAmount: 500,
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

// ── CASE 1: BD-05 A -> would_post / bonus_liability / ACCOUNT_MAPPING_REQUIRED ─
async function case1(
  store: { deps: RefundDeps; raw: Map<string, unknown> },
): Promise<void> {
  console.log('\n=== CASE 1: BD-05 A -> would_post / bonus_liability (account gap) ===');
  store.raw.set(BD05_POLICY_KEY, 'A');
  const decision = await applyOrderRefundAccounting(refCtx('rd-A-1'), store.deps);

  check(decision.option === 'A', 'CASE 1 – option resolved to A');
  check(decision.effect.kind === 'would_post', 'CASE 1 – effect is would_post (A intent)');
  check(
    decision.effect.kind === 'would_post' &&
      decision.effect.code === ACCOUNT_MAPPING_REQUIRED,
    'CASE 1 – A fails closed on missing bonus-liability account',
  );
  check(
    decision.effect.kind === 'would_post' &&
      decision.effect.intendedAccounts.length === 1 &&
      decision.effect.intendedAccounts[0].role === 'bonus_liability',
    'CASE 1 – intended role is bonus_liability (the absent 2xxx account)',
  );
  check(
    decision.effect.kind === 'would_post' && decision.effect.basis === 'compensating_mirror',
    'CASE 1 – basis is compensating_mirror (reverses_id-linked mirror of the original discount)',
  );
  check(decision.journalEntryId === null, 'CASE 1 – NO journal fabricated despite would_post');
  check(decision.effectKey === 'bd05:refund:rd-A-1', 'CASE 1 – effectKey pinned to REFUND ledger id');
  check(
    decision.diagnostics.includes(ACCOUNTING_NOT_POSTED) &&
      decision.diagnostics.includes(BONUS_GL_ATOMICITY_GAP) &&
      decision.diagnostics.includes(TIMING_POLICY_REQUIRED) &&
      decision.diagnostics.includes(SOURCE_TRACE_GAP) &&
      decision.diagnostics.includes(ACCOUNT_MAPPING_REQUIRED) &&
      decision.diagnostics.includes(REVERSAL_LINKAGE_GAP),
    'CASE 1 – fail-closed diagnostics surfaced (not-posted, GL atomic, timing, source-trace, mapping, linkage)',
  );
  check(decision.alreadyHadPolicySnapshot === false, 'CASE 1 – first run wrote the snapshot');
}

// ── CASE 2: BD-05 B -> fail_closed / INVOICE_REPRICING_REQUIRED ───────────────
async function case2(
  store: { deps: RefundDeps; raw: Map<string, unknown> },
): Promise<void> {
  console.log('\n=== CASE 2: BD-05 B -> fail_closed / INVOICE_REPRICING_REQUIRED ===');
  store.raw.set(BD05_POLICY_KEY, 'B');
  const decision = await applyOrderRefundAccounting(refCtx('rd-B-1'), store.deps);

  check(decision.option === 'B', 'CASE 2 – option resolved to B');
  check(
    decision.effect.kind === 'fail_closed' && decision.effect.code === INVOICE_REPRICING_REQUIRED,
    'CASE 2 – B fails closed on the missing invoice-repricing mechanism',
  );
  check(
    decision.effect.kind === 'fail_closed' &&
      decision.effect.reason.includes('modify_order_item'),
    'CASE 2 – B reason grounds the gap in 0026 (does not reprice the invoice)',
  );
  check(decision.journalEntryId === null, 'CASE 2 – NO journal fabricated (B is fail-closed)');
  check(
    decision.diagnostics.length === 0,
    'CASE 2 – fail_closed emits no diagnostics (gap is the fail_closed code itself)',
  );
}

// ── CASE 3: missing policy -> fail_closed NOT_CONFIGURED ──────────────────────
async function case3(
  store: { deps: RefundDeps; raw: Map<string, unknown> },
): Promise<void> {
  console.log('\n=== CASE 3: missing policy -> ACCOUNTING_POLICY_NOT_CONFIGURED ===');
  store.raw.delete(BD05_POLICY_KEY);
  const decision = await applyOrderRefundAccounting(refCtx('rd-U-1'), store.deps);

  check(decision.option === null, 'CASE 3 – null option because resolution threw (missing)');
  check(
    decision.effect.kind === 'fail_closed' &&
      decision.effect.code === POLICY_NOT_CONFIGURED,
    'CASE 3 – fail_closed ACCOUNTING_POLICY_NOT_CONFIGURED (no default assumed)',
  );
  check(decision.journalEntryId === null, 'CASE 3 – no journal on unconfigured policy');
  check(
    decision.diagnostics.length === 0 && !decision.alreadyHadPolicySnapshot,
    'CASE 3 – nothing snapshotted when policy is unconfigured',
  );
}

// ── CASE 4: invalid policy -> fail_closed INVALID_ACCOUNTING_POLICY ───────────
async function case4(
  store: { deps: RefundDeps; raw: Map<string, unknown> },
): Promise<void> {
  console.log('\n=== CASE 4: invalid policy "Z" -> INVALID_ACCOUNTING_POLICY ===');
  store.raw.set(BD05_POLICY_KEY, 'Z');
  const decision = await applyOrderRefundAccounting(refCtx('rd-Z-1'), store.deps);

  check(decision.option === null, 'CASE 4 – null option because resolution threw (invalid)');
  check(
    decision.effect.kind === 'fail_closed' && decision.effect.code === POLICY_INVALID,
    'CASE 4 – fail_closed INVALID_ACCOUNTING_POLICY (Z not in A/B)',
  );
  check(decision.journalEntryId === null, 'CASE 4 – no journal on invalid policy');
}

// ── CASE 5: missing account mapping -> ACCOUNT_MAPPING_REQUIRED (Option A) ─────
async function case5(
  store: { deps: RefundDeps; raw: Map<string, unknown> },
): Promise<void> {
  console.log('\n=== CASE 5: account-mapping gap (A blocked, no 2xxx) ===');
  store.raw.set(BD05_POLICY_KEY, 'A');
  const decision = await applyOrderRefundAccounting(refCtx('rd-G-1'), store.deps);

  check(
    decision.effect.kind === 'would_post' && decision.effect.code === ACCOUNT_MAPPING_REQUIRED,
    'CASE 5 – A trips ACCOUNT_MAPPING_REQUIRED on the absent bonus_liability account',
  );
  check(
    decision.effect.kind === 'would_post' &&
      decision.effect.intendedAccounts.every((r) => r.role === 'bonus_liability'),
    'CASE 5 – A intended role is bonus_liability (the missing 2xxx), not receivable/revenue',
  );
  check(decision.journalEntryId === null, 'CASE 5 – no journal fabricated');
}

// ── CASE 6: live A->B flip; invoiced refund R1 keeps A; new refund R2 uses B ────
async function case6(
  store: { deps: RefundDeps; raw: Map<string, unknown> },
): Promise<void> {
  console.log('\n=== CASE 6: live A->B flip must not rewrite an already-refunded event ===');
  // Refund R1 happened under A -> snapshot written = A.
  store.raw.set(BD05_POLICY_KEY, 'A');
  const first = await applyOrderRefundAccounting(refCtx('rd-H-1'), store.deps);
  check(first.option === 'A' && first.alreadyHadPolicySnapshot === false, 'CASE 6 – R1 under A writes snapshot');
  check(store.raw.get('accounting_policy.snapshot.rd-H-1') === 'A', 'CASE 6 – R1 snapshot persisted as A');

  // Director later flips the LIVE policy to B.
  store.raw.set(BD05_POLICY_KEY, 'B');

  // A NEW refund (new ledger id) must pick up B — forward-only director change.
  const second = await applyOrderRefundAccounting(refCtx('rd-H-2'), store.deps);
  check(second.option === 'B', 'CASE 6 – a NEW refund resolves to B after the live flip');

  // The ALREADY-refunded R1 must NOT retroactively change its recorded policy.
  const third = await applyOrderRefundAccounting(refCtx('rd-H-1'), store.deps);
  check(
    third.option === 'B' && // live is now B, so the live resolve yields B...
      third.alreadyHadPolicySnapshot === true && // ...snapshot stays A
      store.raw.get('accounting_policy.snapshot.rd-H-1') === 'A',
    'CASE 6 – live resolves to B but the snapshotted refund keeps A (no retroactive rewrite)',
  );

  // Historical reader returns the locked-in option — auditability of R1.
  const hist = await getHistoricalRefundPolicy('rd-H-1', store.deps);
  check(hist.option === 'A' && hist.source === 'snapshot', 'CASE 6 – historical reader returns snapshotted A for R1');
}

// ── CASE 7: same idempotency key (same refund) twice -> no duplicate ──────────
async function case7(
  store: { deps: RefundDeps; raw: Map<string, unknown> },
): Promise<void> {
  console.log('\n=== CASE 7: idempotency + no snapshot rewrite ===');
  store.raw.set(BD05_POLICY_KEY, 'A');

  const first = await applyOrderRefundAccounting(refCtx('rd-I-1'), store.deps);
  check(first.alreadyHadPolicySnapshot === false, 'CASE 7 – first pass writes snapshot');
  check(
    store.raw.has('accounting_policy.snapshot.rd-I-1') &&
      store.raw.get('accounting_policy.snapshot.rd-I-1') === 'A',
    'CASE 7 – snapshot key accounting_policy.snapshot.<refundLedgerId> == A',
  );

  // Re-dispatch over the SAME refund ledger id (same idempotency key) -> deterministic.
  const before = store.raw.get('accounting_policy.snapshot.rd-I-1');
  const second = await applyOrderRefundAccounting(refCtx('rd-I-1'), store.deps);
  const after = store.raw.get('accounting_policy.snapshot.rd-I-1');
  check(second.alreadyHadPolicySnapshot === true, 'CASE 7 – second pass detects existing snapshot');
  check(first.effectKey === second.effectKey, 'CASE 7 – identical effectKey on re-dispatch');
  check(
    first.journalEntryId === second.journalEntryId && first.journalEntryId === null,
    'CASE 7 – identical (null) journalEntryId — no duplicate journal path',
  );
  check(before === after && after === 'A', 'CASE 7 – snapshot left untouched (history protected)');

  // The snapshot helper itself is idempotent on collision.
  const snap1 = await snapshotRefundPolicy('rd-I-1', 'A', store.deps);
  const snap2 = await snapshotRefundPolicy('rd-I-1', 'A', store.deps);
  check(snap1.written === false && snap2.written === false, 'CASE 7 – snapshotRefundPolicy is a no-op on collision');
}

// ── CASE 8: source trace -> REFUND traces back to original ORDER_DISCOUNT ──────
async function case8(
  store: { deps: RefundDeps; raw: Map<string, unknown> },
): Promise<void> {
  console.log('\n=== CASE 8: source trace -> refund -> original ORDER_DISCOUNT ===');
  store.raw.set(BD05_POLICY_KEY, 'A');
  const decision = await applyOrderRefundAccounting(refCtx('rd-T-1', 'orig-disc-9'), store.deps);

  check(
    decision.sourceTrace.sourceTable === 'bonus_ledger' &&
      decision.sourceTrace.documentType === 'bonus_refund',
    'CASE 8 – source trace anchored on bonus_ledger as a bonus_refund document',
  );
  check(
    decision.sourceTrace.sourceId === 'rd-T-1' &&
      decision.sourceTrace.ledgerId === 'rd-T-1',
    'CASE 8 – source id is the REFUND ledger id (the TRUE BD-05 event identity)',
  );
  check(
    decision.sourceTrace.originalLedgerId === 'orig-disc-9',
    'CASE 8 – source trace references the original ORDER_DISCOUNT ledger id (not orders.id)',
  );
  check(
    decision.sourceTrace.orderId === 'order-rd-T-1' &&
      decision.sourceTrace.idempotencyKey === 'MOD:order-rd-T-1:item-rd-T-1',
    'CASE 8 – order id + refund idempotency key (MOD:{order}:{item}) carried for traceability',
  );
}

// ── CASE 9: company scope -> COMPANY_POLICY_ISOLATION_GAP (no silent fallback) ──
async function case9(
  store: { deps: RefundDeps; raw: Map<string, unknown> },
): Promise<void> {
  console.log('\n=== CASE 9: company scope -> COMPANY_POLICY_ISOLATION_GAP ===');
  store.raw.set(BD05_POLICY_KEY, 'A');
  const { option, diagnostics } = await resolveOrderRefundAccountingPolicy(store.deps, 'co-999');
  check(option === 'A', 'CASE 9 – policy still resolves to A even when company supplied');
  check(
    diagnostics.includes(COMPANY_POLICY_ISOLATION_GAP),
    'CASE 9 – passing companyId surfaces ACC-10 isolation gap (not a silent cross-company read)',
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
  await case8(s);
  await case9(s);

  // The registry is binary A/B (no invented C) — asserted here too.
  console.log('\n=== EXTRA: registry shape — BD-05 is strictly A/B ===');
  check(BD05_OPTIONS.length === 2, 'EXTRA – exactly two registered options (binary, no C)');
  check(BD05_OPTIONS.includes('A') && BD05_OPTIONS.includes('B'), 'EXTRA – options are A and B');
  check(!BD05_OPTIONS.includes('C'), 'EXTRA – C is NOT a registered BD-05 option (not invented)');

  console.log('\n──────────────────────────────────────────');
  console.log(`PASS: ${pass.length}  FAIL: ${fail.length}`);
  if (fail.length > 0) {
    console.error('Failing checks:');
    for (const f of fail) console.error('  - ' + f);
  }
  console.log('────────────── CASES ──────────────');
  console.log('1) BD-05 A          -> would_post / bonus_liability (ACCOUNT_MAPPING_REQUIRED) ');
  console.log('2) BD-05 B          -> fail_closed / INVOICE_REPRICING_REQUIRED              ');
  console.log('3) missing policy   -> fail_closed ACCOUNTING_POLICY_NOT_CONFIGURED          ');
  console.log('4) invalid "Z"      -> fail_closed INVALID_ACCOUNTING_POLICY                ');
  console.log('5) account gap      -> A trips ACCOUNT_MAPPING_REQUIRED (no 2xxx)           ');
  console.log('6) live A->B        -> refunded R1 keeps A; new R2 uses B                   ');
  console.log('7) idempotency      -> re-dispatch no-op; identical effectKey/null journal ');
  console.log('8) source trace     -> REFUND -> original ORDER_DISCOUNT ledger id         ');
  console.log('9) company scope    -> COMPANY_POLICY_ISOLATION_GAP (no silent fallback)    ');
  console.log('──────────────────────────────────────────');

  if (fail.length > 0) process.exitCode = 1;
}

void main();
