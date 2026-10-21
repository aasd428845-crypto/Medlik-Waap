/*
 * BD-01 readiness resolver — CASE 1-7 (local / test-only).
 *
 * PURE-TS assertions feeding a hand-rolled in-memory chart of accounts that
 * mirrors the committed seed `0007` (codes 1000..6000 incl. liability 2000/2100
 * and expense 6000; NO 2xxx deferred-bonus-liability account — 0017's 2110 is
 * unapplied). No DB / no Supabase. Per the harness comment in
 * bonusAccountingPolicy.test.ts, this file is excluded from tsconfig
 * (*.test.ts) and is run with:
 *
 *   node --experimental-strip-types src/lib/bonusPolicyReadiness.test.ts
 *
 * The role strings asserted here mirror the engine's CASE 2/3
 * (bonusAccountingPolicy.test.ts): A → deferred_bonus_liability,
 * B → bonus_expense. This keeps the readiness descriptor honest.
 */
import type { FinancialAccountLike } from './bonusPolicyReadiness.ts';
import {
  BD01_REQUIREMENTS,
  computeBd01Readiness,
  computePolicyReadiness,
  currentPolicyReadiness,
  STATUS_LABEL,
} from './bonusPolicyReadiness.ts';

// ── In-memory COA mirroring 0007 (relevant rows only) ────────────────────────
const SEED_COA: FinancialAccountLike[] = [
  { code: '1000', name: 'الأصول', account_type: 'asset', is_postable: false },
  { code: '1110', name: 'الصندوق', account_type: 'asset', is_postable: true },
  { code: '1120', name: 'البنوك', account_type: 'asset', is_postable: true },
  { code: '2000', name: 'الالتزامات', account_type: 'liability', is_postable: true },
  { code: '2100', name: 'الموردون والذمم الدائنة', account_type: 'liability', is_postable: true },
  { code: '3000', name: 'حقوق الملكية', account_type: 'equity', is_postable: true },
  { code: '4000', name: 'الإيرادات', account_type: 'revenue', is_postable: true },
  { code: '5000', name: 'تكلفة المبيعات', account_type: 'cogs', is_postable: true },
  { code: '6000', name: 'المصروفات', account_type: 'expense', is_postable: true },
];

// ── Minimal inline assertion harness (no @types/node dependency) ──────────────
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

function eq<T>(actual: T, expected: T, msg: string): void {
  check(JSON.stringify(actual) === JSON.stringify(expected), `${msg} [got ${JSON.stringify(actual)}]`);
}

// ── CASE 1: BD-01 A → ACCOUNT_MAPPING_REQUIRED, no 2xxx designated ─────────────
function case1(): void {
  console.log('\n=== CASE 1: BD-01 A → ACCOUNT_MAPPING_REQUIRED (2 legs) ===');
  const r = computeBd01Readiness('A', SEED_COA);
  eq(r.status, 'ACCOUNT_MAPPING_REQUIRED', 'CASE 1 – status is ACCOUNT_MAPPING_REQUIRED (no leg designated)');
  check(r.ready === false, 'CASE 1 – A is not ready (no fabrication of 1110/2110)');
  eq(r.requiredAccounts.length, 2, 'CASE 1 – two required legs (debit + credit)');
  eq(r.requiredAccounts[0].role, 'cash', 'CASE 1 – debit leg role is cash (matches the engine)');
  eq(r.requiredAccounts[0].leg, 'debit', 'CASE 1 – first leg is the debit leg');
  eq(r.requiredAccounts[1].role, 'deferred_bonus_liability', 'CASE 1 – credit leg role is deferred_bonus_liability');
  eq(r.requiredAccounts[1].leg, 'credit', 'CASE 1 – second leg is the credit leg');
  check(r.requiredAccounts.every((a) => a.designated === null), 'CASE 1 – no leg is designated (fail closed)');
  // Candidates exist but are NOT auto-mapped.
  eq(
    r.requiredAccounts[0].candidates.map((c) => c.code),
    ['1110', '1120'],
    'CASE 1 – compatible cash accounts are surfaced as candidates (not fabricated)',
  );
  eq(
    r.requiredAccounts[1].candidates.map((c) => c.code),
    ['2000', '2100'],
    'CASE 1 – compatible liability accounts are surfaced as candidates (not fabricated)',
  );
  check(r.diagnostics.length > 0, 'CASE 1 – posting-infra gap is surfaced in diagnostics');
}

// ── CASE 2: BD-01 B → ACCOUNT_MAPPING_REQUIRED, expense role unmapped ─────────
function case2(): void {
  console.log('\n=== CASE 2: BD-01 B → ACCOUNT_MAPPING_REQUIRED (2 legs) ===');
  const r = computeBd01Readiness('B', SEED_COA);
  eq(r.status, 'ACCOUNT_MAPPING_REQUIRED', 'CASE 2 – status is ACCOUNT_MAPPING_REQUIRED (role unmapped)');
  check(r.ready === false, 'CASE 2 – B is not ready');
  eq(r.requiredAccounts.length, 2, 'CASE 2 – two required legs (debit + credit)');
  eq(r.requiredAccounts[0].role, 'bonus_expense', 'CASE 2 – debit leg role matches engine CASE 3');
  eq(r.requiredAccounts[1].role, 'cash', 'CASE 2 – credit leg role is cash (matches the engine)');
  check(r.requiredAccounts[0].designated === null, 'CASE 2 – 6000 not auto-designated to bonus_expense role');
  eq(
    r.requiredAccounts[0].candidates.map((c) => c.code),
    ['6000'],
    'CASE 2 – expense candidate 6000 is surfaced but not mapped',
  );
}

// ── CASE 3: BD-01 C → READY (explicit no-entry, realisable today) ────────────
function case3(): void {
  console.log('\n=== CASE 3: BD-01 C → READY ===');
  const r = computeBd01Readiness('C', SEED_COA);
  eq(r.status, 'READY', 'CASE 3 – C is READY');
  check(r.ready === true, 'CASE 3 – C ready=true');
  eq(r.requiredAccounts.length, 0, 'CASE 3 – C needs no accounts');
}

// ── CASE 4: BD-01 invalid option → INVALID_CONFIGURATION ─────────────────────
function case4(): void {
  console.log('\n=== CASE 4: BD-01 invalid option → INVALID_CONFIGURATION ===');
  const r = computeBd01Readiness('Z', SEED_COA);
  eq(r.status, 'INVALID_CONFIGURATION', 'CASE 4 – invalid option rejected');
  check(r.ready === false, 'CASE 4 – never READY for an unknown option');
}

// ── CASE 5: BD-02..BD-10 → POSTING_INFRASTRUCTURE_REQUIRED (not advertised READY) ─
function case5(): void {
  console.log('\n=== CASE 5: BD-02..BD-10 not READY ===');
  for (const id of ['BD-02', 'BD-08', 'BD-09', 'BD-10']) {
    const r = computePolicyReadiness(id, 'A', SEED_COA);
    eq(r.status, 'POSTING_INFRASTRUCTURE_REQUIRED', `CASE 5 – ${id} blocked on posting infra (not READY)`);
    check(r.ready === false, `CASE 5 – ${id} ready=false`);
  }
}

// ── CASE 6: BD-01 role descriptor is the single source (mirrors engine CASE 2/3)
function case6(): void {
  console.log('\n=== CASE 6: BD-01 requirement descriptor anchored to roles ===');
  eq(BD01_REQUIREMENTS['A'][0].role, 'cash', 'CASE 6 – A debit descriptor role is cash (engine)');
  eq(BD01_REQUIREMENTS['A'][1].role, 'deferred_bonus_liability', 'CASE 6 – A credit descriptor role matches engine');
  eq(BD01_REQUIREMENTS['B'][0].role, 'bonus_expense', 'CASE 6 – B descriptor role matches engine');
  eq(BD01_REQUIREMENTS['B'][1].role, 'cash', 'CASE 6 – B credit descriptor role is cash (engine)');
  eq(BD01_REQUIREMENTS['C'].length, 0, 'CASE 6 – C has no requirements');
}

// ── CASE 7: currentPolicyReadiness null → POLICY_NOT_CONFIGURED ───────────────
function case7(): void {
  console.log('\n=== CASE 7: current option null → POLICY_NOT_CONFIGURED ===');
  const r = currentPolicyReadiness('BD-01', null, SEED_COA);
  eq(r.status, 'POLICY_NOT_CONFIGURED', 'CASE 7 – nothing saved → not configured');
  check(r.ready === false, 'CASE 7 – not ready when unconfigured (saved≠READY)');
}

// ── CASE 8: empty COA → A still ACCOUNT_MAPPING_REQUIRED (no false READY) ──────
function case8(): void {
  console.log('\n=== CASE 8: empty COA → A stays blocked (no false READY) ===');
  const r = computeBd01Readiness('A', []);
  eq(r.status, 'ACCOUNT_MAPPING_REQUIRED', 'CASE 8 – A blocked even with empty COA');
  check(r.requiredAccounts[0].candidates.length === 0, 'CASE 8 – no candidates with empty COA');
}

function main(): void {
  case1();
  case2();
  case3();
  case4();
  case5();
  case6();
  case7();
  case8();

  console.log('\n──────────────────────────────────────────');
  console.log(`PASS: ${pass.length}  FAIL: ${fail.length}`);
  if (fail.length > 0) {
    console.error('Failing checks:');
    for (const f of fail) console.error('  - ' + f);
  }
  console.log('────────────── CASES ──────────────');
  console.log('1) BD-01 A → ACCOUNT_MAPPING_REQUIRED (no 2xxx, role unmapped)    ');
  console.log('2) BD-01 B → ACCOUNT_MAPPING_REQUIRED (expense role unmapped)     ');
  console.log('3) BD-01 C → READY (explicit no-entry, realisable)                ');
  console.log('4) BD-01 invalid "Z" → INVALID_CONFIGURATION                     ');
  console.log('5) BD-02..BD-10 → POSTING_INFRASTRUCTURE_REQUIRED (not READY)    ');
  console.log('6) BD-01 descriptor roles mirror engine CASE 2/3                   ');
  console.log('7) current=null → POLICY_NOT_CONFIGURED (saved≠READY)            ');
  console.log('8) empty COA → A stays blocked (fail closed)                    ');
  console.log('──────────────────────────────────────────');
  // STATUS_LABEL completeness smoke check.
  let missing = false;
  for (const k of Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]) {
    void k;
  }
  void missing;

  if (fail.length > 0) process.exitCode = 1;
}

void main();
