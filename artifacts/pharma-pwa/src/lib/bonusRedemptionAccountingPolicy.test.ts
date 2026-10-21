/*
 * BD-03 engine — CASE 1-6 (local / test-only).
 *
 * PURE-TS assertions with an in-memory fake store. No test runner is installed in
 * the workspace, and Node cannot resolve the @/ alias — so this file imports the
 * PURE engine via RELATIVE ./ paths only (never the Supabase-backed live wiring),
 * which lets it run under `node --experimental-strip-types` with zero new deps.
 *
 * Run locally:
 *   node --experimental-strip-types src/lib/bonusRedemptionAccountingPolicy.test.ts
 *
 * CASES (directive item 19: CASE 1-2(+C)+history+idempotency+invalid+account-mapping):
 *   1  BD-03 = A -> would_post + INVENTORY_VALUATION_REQUIRED (sale price is not a
 *                   cost); intended accounts [inventory, cost_of_goods_sold]; no journal;
 *                   snapshot written; source-trace on the redemption id.
 *   2  BD-03 = B -> would_post + COBS_BASIS_REQUIRED (no cost column on products, X2);
 *                   identical accounts; no journal; snapshot written.
 *   3  BD-03 = C -> would_post + INVENTORY_VALUATION_REQUIRED (rule value is not a
 *                   cost AND C has NO inventory offset — unbalanced); account list is
 *                   [cost_of_goods_sold] ONLY; no journal; snapshot written.
 *   4  Director switches A -> B (history lock) — the first redemption stays A, the new
 *                   one resolves B; getHistorical returns the snapshotted option each.
 *   5  Idempotency — re-dispatching the SAME redemption is a no-op for the snapshot
 *                   (alreadyHadPolicySnapshot true), same effectKey, no duplicate.
 *   6  Missing/invalid BD-03 -> fail_closed (ACCOUNTING_POLICY_NOT_CONFIGURED /
 *      INVALID_ACCOUNTING_POLICY), NO journal, NO snapshot written.
 *
 * This file is excluded from tsconfig.json (the *.test.ts glob) and is not imported by
 * the app graph, so it does not affect `tsc --noEmit` or the build.
 */

import {
  BD03_POLICY_KEY,
  BD03_OPTIONS,
  INVENTORY_VALUATION_REQUIRED,
  COBS_BASIS_REQUIRED,
  resolveBonusRedemptionAccountingPolicy,
  snapshotRedemptionPolicy,
  getHistoricalRedemptionPolicy,
  applyBonusRedemptionAccounting,
} from './bonusRedemptionAccountingPolicy.ts';
import {
  POLICY_NOT_CONFIGURED,
  POLICY_INVALID,
  ACCOUNTING_NOT_POSTED,
  BONUS_GL_ATOMICITY_GAP,
  COMPANY_POLICY_ISOLATION_GAP,
} from './bonusAccountingPolicy.ts';
import type {
  RedemptionDeps,
  RedemptionAccountingContext,
} from './bonusRedemptionAccountingPolicy.ts';

// ── In-memory fake bonus_settings store (no DB, no Supabase) ─────────────────
function makeStore(): { deps: RedemptionDeps; raw: Map<string, unknown> } {
  const raw = new Map<string, unknown>();
  const deps: RedemptionDeps = {
    readSetting: async (key: string) => (raw.has(key) ? raw.get(key) : null),
    upsertSetting: async (key: string, value: unknown) => {
      raw.set(key, value);
    },
  };
  return { deps, raw };
}

function ctx(redemptionId: string, companyId?: string | null): RedemptionAccountingContext {
  return {
    identity: {
      redemptionId,
      ledgerId: `ledger-${redemptionId}`,
      idempotencyKey: redemptionId,
    },
    status: 'FULFILLED',
    companyId: companyId ?? null,
    amount: 99.0,
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

function rolesOf(decision: { effect: { intendedAccounts?: Array<{ role: string }> } }): string[] {
  return decision.effect.intendedAccounts
    ? decision.effect.intendedAccounts.map((a) => a.role)
    : [];
}

// ── CASE 1: BD-03 = A -> would_post + INVENTORY_VALUATION_REQUIRED (sale price) ─
async function case1(store: { deps: RedemptionDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 1: BD-03 = A -> would_post / INVENTORY_VALUATION_REQUIRED ===');
  store.raw.set(BD03_POLICY_KEY, 'A');
  const decision = await applyBonusRedemptionAccounting(ctx('r-1001', 'co-1'), store.deps);

  check(decision.option === 'A', 'CASE 1 – option resolved to A');
  check(decision.effect.kind === 'would_post', 'CASE 1 – effect is would_post (A intent)');
  check(
    decision.effect.kind === 'would_post' &&
      decision.effect.code === INVENTORY_VALUATION_REQUIRED,
    'CASE 1 – would_post carries INVENTORY_VALUATION_REQUIRED (sale price is not a cost)',
  );
  check(
    decision.effect.kind === 'would_post' && decision.effect.basis === 'unit_price',
    'CASE 1 – basis is unit_price (sale price)',
  );
  check(
    JSON.stringify(rolesOf(decision)) === JSON.stringify(['inventory', 'cost_of_goods_sold']),
    'CASE 1 – intended account roles are inventory + cost_of_goods_sold',
  );
  check(decision.journalEntryId === null, 'CASE 1 – NO journal fabricated (fail-closed valuation)');
  check(
    decision.effect.kind === 'would_post' &&
      decision.effect.intendedAccounts.length === 2,
    'CASE 1 – two intended accounts (1140/5000 exist — account mapping is NOT the gap here)',
  );
  check(decision.alreadyHadPolicySnapshot === false, 'CASE 1 – first run wrote the snapshot');
  check(
    store.raw.get(`${'accounting_policy.snapshot.'}r-1001`) === 'A',
    'CASE 1 – snapshot persisted on the redemption true identity',
  );
  check(
    decision.diagnostics.includes(INVENTORY_VALUATION_REQUIRED) &&
      decision.diagnostics.includes(ACCOUNTING_NOT_POSTED) &&
      decision.diagnostics.includes(BONUS_GL_ATOMICITY_GAP) &&
      decision.diagnostics.includes(COMPANY_POLICY_ISOLATION_GAP),
    'CASE 1 – valuation + not-posted + atomicity + company-isolation gaps surfaced',
  );
  check(
    decision.sourceTrace.sourceTable === 'bonus_ledger' &&
      decision.sourceTrace.sourceId === 'ledger-r-1001' &&
      decision.sourceTrace.documentType === 'bonus_redemption' &&
      decision.sourceTrace.redemptionId === 'r-1001',
    'CASE 1 – R-1 source trace on the redemption id (bonus_ledger)',
  );
  check(decision.effectKey === 'bd03:redemption:r-1001', 'CASE 1 – effectKey pinned to redemption id');
}

// ── CASE 2: BD-03 = B -> would_post + COBS_BASIS_REQUIRED (no cost column) ─────
async function case2(store: { deps: RedemptionDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 2: BD-03 = B -> would_post / COBS_BASIS_REQUIRED ===');
  store.raw.set(BD03_POLICY_KEY, 'B');
  const decision = await applyBonusRedemptionAccounting(ctx('r-1002', null), store.deps);

  check(decision.option === 'B', 'CASE 2 – option resolved to B');
  check(decision.effect.kind === 'would_post', 'CASE 2 – effect is would_post (B intent)');
  check(
    decision.effect.kind === 'would_post' && decision.effect.code === COBS_BASIS_REQUIRED,
    'CASE 2 – would_post carries COBS_BASIS_REQUIRED (no product cost column, X2)',
  );
  check(
    decision.effect.kind === 'would_post' && decision.effect.basis === 'product_cost',
    'CASE 2 – basis is product_cost',
  );
  check(
    JSON.stringify(rolesOf(decision)) === JSON.stringify(['inventory', 'cost_of_goods_sold']),
    'CASE 2 – intended account roles are inventory + cost_of_goods_sold (cost basis, not mapping)',
  );
  check(decision.journalEntryId === null, 'CASE 2 – NO journal fabricated (no cost basis)');
  check(decision.alreadyHadPolicySnapshot === false, 'CASE 2 – first run wrote the snapshot');
  check(
    !decision.diagnostics.includes(COMPANY_POLICY_ISOLATION_GAP),
    'CASE 2 – no company-isolation gap when no company scope supplied',
  );
}

// ── CASE 3: BD-03 = C -> would_post + no inventory offset + rule-value basis ──
async function case3(store: { deps: RedemptionDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 3: BD-03 = C -> would_post / rule value, no inventory offset ===');
  store.raw.set(BD03_POLICY_KEY, 'C');
  const decision = await applyBonusRedemptionAccounting(ctx('r-1003', null), store.deps);

  check(decision.option === 'C', 'CASE 3 – option resolved to C');
  check(decision.effect.kind === 'would_post', 'CASE 3 – effect is would_post (C intent)');
  check(
    decision.effect.kind === 'would_post' && decision.effect.code === INVENTORY_VALUATION_REQUIRED,
    'CASE 3 – would_post carries INVENTORY_VALUATION_REQUIRED (no offset + non-cost basis)',
  );
  check(
    decision.effect.kind === 'would_post' && decision.effect.basis === 'rule_value',
    'CASE 3 – basis is rule_value (V-3, not a product cost)',
  );
  check(
    JSON.stringify(rolesOf(decision)) === JSON.stringify(['cost_of_goods_sold']),
    'CASE 3 – C has NO inventory offset (unbalanced leg is diagnosed, not invented)',
  );
  check(decision.journalEntryId === null, 'CASE 3 – NO journal fabricated');
  check(decision.alreadyHadPolicySnapshot === false, 'CASE 3 – first run wrote the snapshot');
}

// ── CASE 4: director switches A -> B (history lock) ───────────────────────────
async function case4(store: { deps: RedemptionDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 4: history lock A -> B ===');
  store.raw.set(BD03_POLICY_KEY, 'A');
  const d1 = await applyBonusRedemptionAccounting(ctx('r-1004', null), store.deps);
  store.raw.set(BD03_POLICY_KEY, 'B');
  const d2 = await applyBonusRedemptionAccounting(ctx('r-1005', null), store.deps);

  check(d1.option === 'A', 'CASE 4 – first redemption resolves A');
  check(d2.option === 'B', 'CASE 4 – second redemption resolves B (live flipped)');
  check(d1.effectKey === 'bd03:redemption:r-1004', 'CASE 4 – first effectKey on r-1004');
  check(d2.effectKey === 'bd03:redemption:r-1005', 'CASE 4 – second effectKey on r-1005');

  const h1 = await getHistoricalRedemptionPolicy('r-1004', store.deps);
  const h2 = await getHistoricalRedemptionPolicy('r-1005', store.deps);
  check(h1.option === 'A' && h1.source === 'snapshot', 'CASE 4 – r-1004 history locked to A');
  check(h2.option === 'B' && h2.source === 'snapshot', 'CASE 4 – r-1005 history locked to B');
  check(h1.option !== h2.option, 'CASE 4 – old and new differ after the flip');
}

// ── CASE 5: idempotency — repeat the SAME redemption ─────────────────────────
async function case5(store: { deps: RedemptionDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 5: idempotency (same redemption) ===');
  store.raw.set(BD03_POLICY_KEY, 'A');
  const d1 = await applyBonusRedemptionAccounting(ctx('r-1006', null), store.deps);
  const d2 = await applyBonusRedemptionAccounting(ctx('r-1006', null), store.deps);

  check(d1.alreadyHadPolicySnapshot === false, 'CASE 5 – first run wrote the snapshot');
  check(d2.alreadyHadPolicySnapshot === true, 'CASE 5 – second run sees the existing snapshot');
  check(d1.effectKey === d2.effectKey, 'CASE 5 – identical effect key (no duplicate)');
  check(
    d1.effectKey === 'bd03:redemption:r-1006',
    'CASE 5 – snapshot key is the redemption true identity (not ledger id)',
  );
  check(d1.journalEntryId === null && d2.journalEntryId === null, 'CASE 5 – no journal on either run');
  check(
    store.raw.get('accounting_policy.snapshot.r-1006') === 'A',
    'CASE 5 – snapshot not rewritten by the re-run',
  );
}

// ── CASE 6: missing/invalid -> fail_closed, no journal, no snapshot ────────────
async function case6(store: { deps: RedemptionDeps; raw: Map<string, unknown> }): Promise<void> {
  console.log('\n=== CASE 6: missing/invalid -> fail_closed ===');
  store.raw.delete(BD03_POLICY_KEY);
  const missing = await applyBonusRedemptionAccounting(ctx('r-1007', null), store.deps);
  check(missing.option === null, 'CASE 6 – missing policy -> option is null');
  check(missing.effect.kind === 'fail_closed', 'CASE 6 – missing effect is fail_closed');
  check(
    missing.effect.kind === 'fail_closed' && missing.effect.code === POLICY_NOT_CONFIGURED,
    'CASE 6 – missing code = ACCOUNTING_POLICY_NOT_CONFIGURED',
  );
  check(missing.journalEntryId === null, 'CASE 6 – no journal on missing policy');
  check(
    store.raw.get('accounting_policy.snapshot.r-1007') === undefined,
    'CASE 6 – missing policy writes NO snapshot',
  );

  store.raw.set(BD03_POLICY_KEY, 'Z');
  const invalid = await applyBonusRedemptionAccounting(ctx('r-1008', null), store.deps);
  check(invalid.option === null, 'CASE 6 – invalid Z -> option is null');
  check(invalid.effect.kind === 'fail_closed', 'CASE 6 – invalid effect is fail_closed');
  check(
    invalid.effect.kind === 'fail_closed' && invalid.effect.code === POLICY_INVALID,
    'CASE 6 – invalid code = INVALID_ACCOUNTING_POLICY',
  );
  check(invalid.journalEntryId === null, 'CASE 6 – no journal on invalid policy');
  check(
    store.raw.get('accounting_policy.snapshot.r-1008') === undefined,
    'CASE 6 – invalid option writes NO snapshot',
  );
}

// ── CASE 0: registry sanity (three options A/B/C, none invented) ─────────────
async function case0(): Promise<void> {
  console.log('\n=== CASE 0: registry sanity ===');
  check(BD03_OPTIONS.length === 3, 'CASE 0 – BD-03 exposes exactly three options');
  check(
    JSON.stringify(BD03_OPTIONS) === JSON.stringify(['A', 'B', 'C']),
    'CASE 0 – BD-03 options are A, B, C (none invented, matches registry)',
  );
}

// ── Runner ────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('BD-03 registry options:', JSON.stringify(BD03_OPTIONS));
  await case0();
  const stores = [makeStore(), makeStore(), makeStore(), makeStore(), makeStore(), makeStore()];
  await case1(stores[0]);
  await case2(stores[1]);
  await case3(stores[2]);
  await case4(stores[3]);
  await case5(stores[4]);
  await case6(stores[5]);

  console.log(`\nBD-03 CASE complete. ${pass.length} passed, ${fail.length} failed.`);
  if (fail.length) {
    console.error('FAILURES:\n' + fail.join('\n'));
    process.exitCode = 1;
  }
}

void main();
