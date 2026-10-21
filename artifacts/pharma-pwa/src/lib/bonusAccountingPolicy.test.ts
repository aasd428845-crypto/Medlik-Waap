/*
 * BD-01 engine — CASE 1-6 (local / test-only).
 *
 * PURE-TS assertions with an in-memory fake store. No test runner is installed
 * in the workspace (package.json exposes no test script), and Node cannot
 * resolve the @/ alias — so this file imports the PURE engine via RELATIVE ./
 * paths only (never the Supabase-backed live wiring), which lets it run under
 * node --experimental-strip-types with zero new dependencies.
 *
 * Run locally (from the PWA source dir):
 *   node --experimental-strip-types src/lib/bonusAccountingPolicy.test.ts
 *
 * CASES:
 *   1  BD-01 C -> no_entry; snapshot written; no journal fabricated.
 *   2  BD-01 A -> would_post ACCOUNT_MAPPING_REQUIRED; intended liability role;
 *               no journal fabricated; accounting-not-posted gap emitted.
 *   3  BD-01 B -> would_post ACCOUNT_MAPPING_REQUIRED; intended expense role.
 *   4  Unconfigured (no key) -> fail_closed ACCOUNTING_POLICY_NOT_CONFIGURED.
 *   5  Invalid option ('Z') -> fail_closed INVALID_ACCOUNTING_POLICY.
 *   6  Idempotency + history: a second dispatch must NOT rewrite the snapshot,
 *      alreadyHadPolicySnapshot must be true, and the historical read returns
 *      the originally-snapshotted option.
 *
 * This file is excluded from tsconfig.json (the test-file glob, *.test.ts) and
 * is not imported by the app graph, so it does not affect tsc --noEmit or build.
 */

import {
  BD01_POLICY_KEY,
  POLICY_NOT_CONFIGURED,
  POLICY_INVALID,
  ACCOUNT_MAPPING_REQUIRED,
  ACCOUNTING_NOT_POSTED,
  BONUS_GL_ATOMICITY_GAP,
  COMPANY_POLICY_ISOLATION_GAP,
  resolveBonusEarnAccountingPolicy,
  snapshotBonusEarnPolicy,
  applyBonusEarnAccounting,
  getHistoricalBonusEarnPolicy,
} from './bonusAccountingPolicy.ts';
import type {
  BonusEarnDeps,
  EarnAccountingContext,
  BonusEarnDecision,
} from './bonusAccountingPolicy.ts';

// ── In-memory fake bonus_settings store (no DB, no Supabase) ───────────────
function makeStore(): { deps: BonusEarnDeps; raw: Map<string, unknown> } {
  const raw = new Map<string, unknown>();
  const deps: BonusEarnDeps = {
    readSetting: async (key: string) =>
      raw.has(key) ? raw.get(key) : null,
    upsertSetting: async (key: string, value: unknown) => {
      raw.set(key, value);
    },
  };
  return { deps, raw };
}

function ctx(ledgerId: string, companyId?: string | null): EarnAccountingContext {
  return { identity: { ledgerId }, companyId: companyId ?? null };
}

// ── Minimal inline assertion harness (no node: imports → no @types dependency) ─
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

// ── CASE 1: BD-01 C → realisable no_entry ───────────────────────────────────
async function case1(store: { deps: BonusEarnDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 1: BD-01 C → no_entry ===');
  store.raw.set(BD01_POLICY_KEY, 'C');
  const decision = await applyBonusEarnAccounting(ctx('ledger-C-1'), store.deps);

  check(decision.option === 'C', 'CASE 1 – option resolved to C');
  check(decision.effect.kind === 'no_entry', 'CASE 1 – effect is no_entry (C recognised)');
  check(decision.journalEntryId === null, 'CASE 1 – no journal entry created (C)');
  check(decision.effectKey === 'bd01:earn:ledger-C-1', 'CASE 1 – effectKey pinned to ledger id');
  check(decision.alreadyHadPolicySnapshot === false, 'CASE 1 – first run wrote the snapshot');
  check(decision.diagnostics.length === 0, 'CASE 1 – no diagnostics when no company scope');
  check(decision.sourceTrace.sourceTable === 'bonus_ledger', 'CASE 1 – source trace points at bonus_ledger');
}

// ── CASE 2: BD-01 A → would_post, ACCOUNT_MAPPING_REQUIRED, no journal ──────
async function case2(store: { deps: BonusEarnDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 2: BD-01 A → would_post / ACCOUNT_MAPPING_REQUIRED ===');
  store.raw.set(BD01_POLICY_KEY, 'A');
  const decision = await applyBonusEarnAccounting(ctx('ledger-A-1'), store.deps);

  check(decision.option === 'A', 'CASE 2 – option resolved to A');
  check(decision.effect.kind === 'would_post', 'CASE 2 – effect is would_post (A intent)');
  check(
    decision.effect.kind === 'would_post' &&
      decision.effect.code === ACCOUNT_MAPPING_REQUIRED,
    'CASE 2 – would_post carries ACCOUNT_MAPPING_REQUIRED (no GL account)',
  );
  check(
    decision.effect.kind === 'would_post' &&
      decision.effect.intendedAccounts[0].role === 'cash' &&
      decision.effect.intendedAccounts[0].leg === 'debit',
    'CASE 2 – intended debit leg role is cash (A)',
  );
  check(
    decision.effect.kind === 'would_post' &&
      decision.effect.intendedAccounts[1].role === 'deferred_bonus_liability' &&
      decision.effect.intendedAccounts[1].leg === 'credit',
    'CASE 2 – intended credit leg role is deferred_bonus_liability (A)',
  );
  check(decision.journalEntryId === null, 'CASE 2 – NO journal fabricated despite would_post');
  check(
    decision.diagnostics.includes(ACCOUNTING_NOT_POSTED) &&
      decision.diagnostics.includes(BONUS_GL_ATOMICITY_GAP),
    'CASE 2 – accounting-not-posted + GL-atomicity gap surfaced',
  );
}

// ── CASE 3: BD-01 B → would_post, expense role ──────────────────────────────
async function case3(store: { deps: BonusEarnDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 3: BD-01 B → would_post / expense role ===');
  store.raw.set(BD01_POLICY_KEY, 'B');
  const decision = await applyBonusEarnAccounting(ctx('ledger-B-1'), store.deps);

  check(decision.option === 'B', 'CASE 3 – option resolved to B');
  check(decision.effect.kind === 'would_post', 'CASE 3 – effect is would_post (B intent)');
  check(
    decision.effect.kind === 'would_post' &&
      decision.effect.intendedAccounts[0].role === 'bonus_expense',
    'CASE 3 – intended account role is bonus_expense (B)',
  );
  check(
    decision.effect.kind === 'would_post' &&
      decision.effect.code === ACCOUNT_MAPPING_REQUIRED,
    'CASE 3 – B fails closed on missing expense account',
  );
  check(decision.journalEntryId === null, 'CASE 3 – no journal fabricated for B either');
}

// ── CASE 4: unconfigured → fail_closed ──────────────────────────────────────
async function case4(store: { deps: BonusEarnDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 4: unconfigured → ACCOUNTING_POLICY_NOT_CONFIGURED ===');
  store.raw.delete(BD01_POLICY_KEY); // nothing set
  const decision = await applyBonusEarnAccounting(ctx('ledger-U-1'), store.deps);

  check(decision.option === null, 'CASE 4 – null option because resolution threw');
  check(
    decision.effect.kind === 'fail_closed' &&
      decision.effect.code === POLICY_NOT_CONFIGURED,
    'CASE 4 – fail_closed ACCOUNTING_POLICY_NOT_CONFIGURED (no default assumed)',
  );
  check(decision.journalEntryId === null, 'CASE 4 – no journal on unconfigured policy');
  check(
    decision.diagnostics.length === 0 && !decision.alreadyHadPolicySnapshot,
    'CASE 4 – nothing snapshotted when policy is unconfigured',
  );
}

// ── CASE 5: invalid option → fail_closed ────────────────────────────────────
async function case5(store: { deps: BonusEarnDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 5: invalid option "Z" → INVALID_ACCOUNTING_POLICY ===');
  store.raw.set(BD01_POLICY_KEY, 'Z');
  const decision = await applyBonusEarnAccounting(ctx('ledger-Z-1'), store.deps);

  check(decision.option === null, 'CASE 5 – null option because resolution threw');
  check(
    decision.effect.kind === 'fail_closed' && decision.effect.code === POLICY_INVALID,
    'CASE 5 – fail_closed INVALID_ACCOUNTING_POLICY (Z not in A/B/C)',
  );
}

// ── CASE 6: idempotency + history guard ─────────────────────────────────────
async function case6(store: { deps: BonusEarnDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 6: idempotency + history snapshot ===');
  store.raw.set(BD01_POLICY_KEY, 'C');

  // First dispatch writes the snapshot.
  const first = await applyBonusEarnAccounting(ctx('ledger-I-1'), store.deps);
  check(first.alreadyHadPolicySnapshot === false, 'CASE 6 – first pass writes snapshot (written)');

  // Snapshot key actually persisted.
  check(
    store.raw.has('accounting_policy.snapshot.ledger-I-1') &&
      store.raw.get('accounting_policy.snapshot.ledger-I-1') === 'C',
    'CASE 6 – snapshot key accounting_policy.snapshot.<ledgerId> == C',
  );

  // Second dispatch over the SAME ledger must NOT rewrite the snapshot.
  const before = store.raw.get('accounting_policy.snapshot.ledger-I-1');
  const second = await applyBonusEarnAccounting(ctx('ledger-I-1'), store.deps);
  const after = store.raw.get('accounting_policy.snapshot.ledger-I-1');
  check(second.alreadyHadPolicySnapshot === true, 'CASE 6 – second pass detects existing snapshot');
  check(before === after && after === 'C', 'CASE 6 – snapshot left untouched (history protected)');

  // The director later flips the LIVE policy to A — this must NOT retroactively
  // rewrite the already-snapshotted earn.
  store.raw.set(BD01_POLICY_KEY, 'A');
  const third = await applyBonusEarnAccounting(ctx('ledger-I-1'), store.deps);
  check(
    third.option === 'A' && third.alreadyHadPolicySnapshot === true,
    'CASE 6 – new policy resolves to A but snapshot stays C (no retroactive rewrite)',
  );
  check(
    store.raw.get('accounting_policy.snapshot.ledger-I-1') === 'C',
    'CASE 6 – snapshot remains C despite live setting now A',
  );

  // Historical reader returns the snapshot value, proving the earn is auditable.
  const hist = await getHistoricalBonusEarnPolicy('ledger-I-1', store.deps);
  check(hist.option === 'C' && hist.source === 'snapshot', 'CASE 6 – historical reader returns snapshotted C');

  // Resolve-then-snapshot are independently idempotent via the same key.
  const snap1 = await snapshotBonusEarnPolicy('ledger-I-1', 'C', store.deps);
  const snap2 = await snapshotBonusEarnPolicy('ledger-I-1', 'C', store.deps);
  check(snap1.written === false && snap2.written === false, 'CASE 6 – snapshotBonusEarnPolicy is a no-op on collision');
}

// ── Company-isolation gap is surfaced, never a silent cross-company read ─────
async function caseCompanyGap(
  store: { deps: BonusEarnDeps; raw: Map<string, unknown> },
): Promise<void> {
  console.log('\n=== CASE X (bonus): company scope → COMPANY_POLICY_ISOLATION_GAP ===');
  store.raw.set(BD01_POLICY_KEY, 'C');
  const { diagnostics } = await resolveBonusEarnAccountingPolicy(store.deps, 'co-999');
  check(
    diagnostics.includes(COMPANY_POLICY_ISOLATION_GAP),
    'CASE X – passing companyId surfaces the ACC-10 isolation gap (not a silent read)',
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
  await caseCompanyGap(s);

  console.log('\n──────────────────────────────────────────');
  console.log(`PASS: ${pass.length}  FAIL: ${fail.length}`);
  if (fail.length > 0) {
    console.error('Failing checks:');
    for (const f of fail) console.error('  - ' + f);
  }
  console.log('────────────── CASES ──────────────');
  console.log('1) BD-01 C            → no_entry, snapshot written, no journal   ');
  console.log('2) BD-01 A            → would_post ACCOUNT_MAPPING_REQUIRED   ');
  console.log('3) BD-01 B            → would_post expense role, fail closed    ');
  console.log('4) unconfigured       → fail_closed NOT_CONFIGURED            ');
  console.log('5) invalid "Z"        → fail_closed INVALID_ACCOUNTING_POLICY ');
  console.log('6) idempotency+history→ snapshot not rewritten, history safe  ');
  console.log('──────────────────────────────────────────');

  if (fail.length > 0) process.exitCode = 1;
}

void main();
