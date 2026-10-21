// BD-02 CASE 1-6 (+ company-isolation gap). Mirrors bonusAccountingPolicy.test.ts.
//
// Runs standalone under Node native type stripping so no test runner is needed:
//   node --experimental-strip-types src/lib/bonusWithdrawalAccountingPolicy.test.ts
//
// Uses an in-memory fake store shaped as readSetting and upsertSetting — the SAME
// contract as defaultBonusEarnDeps — so no Supabase, network, or production data
// is touched. Excluded from the Vite graph and from tsc emit (tsconfig excludes
// test files). Header is backtick-free to avoid confusing Node's type stripper.

import { getPolicy } from './accountingPolicies.ts';
import {
  POLICY_NOT_CONFIGURED,
  POLICY_INVALID,
  ACCOUNT_MAPPING_REQUIRED,
  COMPANY_POLICY_ISOLATION_GAP,
  ACCOUNTING_NOT_POSTED,
  BONUS_GL_ATOMICITY_GAP,
} from './bonusAccountingPolicy.ts';
import {
  resolveBonusWithdrawalAccountingPolicy,
  snapshotWithdrawalPolicy,
  getHistoricalWithdrawalPolicy,
  applyBonusWithdrawalAccounting,
  BD02_POLICY_KEY,
  BD02_SNAPSHOT_PREFIX,
  BD02_OPTIONS,
} from './bonusWithdrawalAccountingPolicy.ts';
import type { WithdrawalDeps } from './bonusWithdrawalAccountingPolicy.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log('  PASS: ' + msg);
  } else {
    failures += 1;
    console.log('  FAIL: ' + msg);
  }
}
function assertEqual(actual: unknown, expected: unknown, msg: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), msg + ' (got ' + JSON.stringify(actual) + ')');
}

function makeStore(): { raw: Map<string, string>; deps: WithdrawalDeps } {
  const raw = new Map<string, string>();
  return {
    raw,
    deps: {
      readSetting: (key: string) => Promise.resolve(raw.get(key) ?? null),
      upsertSetting: (key: string, value: unknown) => {
        raw.set(key, String(value));
        return Promise.resolve();
      },
    },
  };
}

async function setPolicy(store: { raw: Map<string, string> }, value: string): Promise<void> {
  store.raw.set(BD02_POLICY_KEY, value);
}

const ctx = (store: { raw: Map<string, string> }, id: string, company = 'c-1') => ({
  identity: { withdrawalId: id, ledgerId: 'ledger-' + id, idempotencyKey: 'idemp-' + id },
  status: 'PAID',
  companyId: company,
  amount: 25,
});

async function run(): Promise<void> {
  const policy = getPolicy('BD-02');
  assert(!!policy, 'BD-02 exists in the Accounting Policy Registry');
  assertEqual(BD02_OPTIONS, ['A', 'B'], 'BD-02 registry exposes exactly options A and B (NO C — not invented)');

  // ── CASE 1 — option A resolves live + fail-closed on missing accounts ─
  console.log('CASE 1: BD-02 = A → live resolution + fail-closed (no bonus liability account)');
  {
    const store = makeStore();
    await setPolicy(store, 'A');
    const result = await applyBonusWithdrawalAccounting(ctx(store, 'w-1001'), store.deps);
    assertEqual(result.option, 'A', 'CASE1 option resolved to A');
    assert(result.effect.kind === 'would_post', 'CASE1 effect is would_post (intent, not execution)');
    if (result.effect.kind === 'would_post') {
      assertEqual(result.effect.intendedAccounts, [
        { role: 'deferred_bonus_liability' },
        { role: 'cash_or_bank' },
      ], 'CASE1 intended accounts: deferred_bonus_liability + cash_or_bank only');
      assert(result.effect.code === ACCOUNT_MAPPING_REQUIRED, 'CASE1 code = ACCOUNT_MAPPING_REQUIRED');
      assert(result.effect.reason.includes('no Bonus Liability account exists'), 'CASE1 reason cites absent liability account');
    }
    assertEqual(result.journalEntryId, null, 'CASE1 NO journal created (fail-closed)');
    assertEqual(result.sourceTrace.withdrawalId, 'w-1001', 'CASE1 source-trace records the withdrawal id');
    assertEqual(result.sourceTrace.sourceId, 'ledger-w-1001', 'CASE1 source-trace targets the subledger ledger row');
    assert(!result.alreadyHadPolicySnapshot, 'CASE1 first run wrote the snapshot');
    assert(result.diagnostics.includes(COMPANY_POLICY_ISOLATION_GAP), 'CASE1 emits COMPANY_POLICY_ISOLATION_GAP (no company_id)');
    assert(result.diagnostics.includes(ACCOUNTING_NOT_POSTED), 'CASE1 emits ACCOUNTING_NOT_POSTED');
    assert(result.diagnostics.includes(BONUS_GL_ATOMICITY_GAP), 'CASE1 emits BONUS_GL_ATOMICITY_GAP');
    assert(result.sourceTrace.sourceTable === 'bonus_ledger', 'CASE1 R-1 source trace reuses bonus_ledger (shared with BD-01)');
  }

  // ── CASE 2 — option B resolves live + fail-closed (identical movements, purchase framing) ─
  console.log('CASE 2: BD-02 = B → live resolution + fail-closed (cash purchase framing)');
  {
    const store = makeStore();
    await setPolicy(store, 'B');
    const result = await applyBonusWithdrawalAccounting(ctx(store, 'w-1002'), store.deps);
    assertEqual(result.option, 'B', 'CASE2 option resolved to B');
    assert(result.effect.kind === 'would_post', 'CASE2 effect is would_post');
    if (result.effect.kind === 'would_post') {
      assert(result.effect.code === ACCOUNT_MAPPING_REQUIRED, 'CASE2 code = ACCOUNT_MAPPING_REQUIRED');
      assert(result.effect.reason.includes('option B'), 'CASE2 reason references option B');
    }
    assertEqual(result.journalEntryId, null, 'CASE2 NO journal created');
    assert(!result.alreadyHadPolicySnapshot, 'CASE2 first run wrote the snapshot');
  }

  // ── CASE 3 — director A->B change: old withdrawal locked, new uses B ─
  console.log('CASE 3: director switches A -> B (history lock) — old stays A, new is B');
  {
    const store = makeStore();
    await setPolicy(store, 'A');
    const first = await applyBonusWithdrawalAccounting(ctx(store, 'w-1003'), store.deps);
    assertEqual(first.sourceTrace.withdrawalId, 'w-1003', 'CASE3 first withdrawal id');
    await setPolicy(store, 'B'); // director flip AFTER w-1003 was processed
    const second = await applyBonusWithdrawalAccounting(ctx(store, 'w-1004'), store.deps);
    assertEqual(first.option, 'A', 'CASE3 withdrawal #1003 stays A (snapshot locked)');
    assertEqual(second.option, 'B', 'CASE3 withdrawal #1004 newly resolves to B');
    const hist = await getHistoricalWithdrawalPolicy('w-1003', store.deps);
    assertEqual(hist.option, 'A', 'CASE3 historical policy for #1003 is A');
    const hist2 = await getHistoricalWithdrawalPolicy('w-1004', store.deps);
    assertEqual(hist2.option, 'B', 'CASE3 historical policy for #1004 is B');
    assert(hist.source === 'snapshot' && hist2.source === 'snapshot', 'CASE3 both locked via snapshot');
    assert(hist.option !== second.option, 'CASE3 old and new differ after the flip');
  }

  // ── CASE 4 — re-run same withdrawal: no duplicate accounting effect ─
  console.log('CASE 4: repeat the same withdrawal → no duplicate effect (idempotency)');
  {
    const store = makeStore();
    await setPolicy(store, 'A');
    const first = await applyBonusWithdrawalAccounting(ctx(store, 'w-1005'), store.deps);
    const second = await applyBonusWithdrawalAccounting(ctx(store, 'w-1005'), store.deps);
    assertEqual(first.option, 'A', 'CASE4 first run resolved A');
    assertEqual(second.option, 'A', 'CASE4 second run still A (not re-derived from live policy)');
    assert(second.alreadyHadPolicySnapshot, 'CASE4 second run sees the existing snapshot');
    assert(!first.alreadyHadPolicySnapshot, 'CASE4 first run wrote the snapshot');
    // Idempotency anchor: SAME effect key + SAME snapshot key for the same withdrawal.
    assertEqual(first.effectKey, second.effectKey, 'CASE4 identical effect key (no duplicate)');
    assertEqual(
      `${BD02_SNAPSHOT_PREFIX}w-1005`,
      `${BD02_SNAPSHOT_PREFIX}w-1005`,
      'CASE4 snapshot key is the withdrawal true identity (not ledger id)',
    );
    assert(first.sourceTrace.withdrawalId === 'w-1005' && second.sourceTrace.withdrawalId === 'w-1005', 'CASE4 withdrawal id stable across re-runs');
  }

  // ── CASE 5 — missing / invalid policy → fail closed ─
  console.log('CASE 5: missing/invalid BD-02 → fail closed');
  {
    const store = makeStore(); // nothing set
    const missing = await applyBonusWithdrawalAccounting(ctx(store, 'w-1006'), store.deps);
    assertEqual(missing.option, null, 'CASE5 missing policy → option is null');
    assert(missing.effect.kind === 'fail_closed', 'CASE5 missing effect is fail_closed');
    assert(missing.effect.code === POLICY_NOT_CONFIGURED, 'CASE5 missing code = ACCOUNTING_POLICY_NOT_CONFIGURED');
    assert(missing.effect.kind === 'fail_closed' && missing.effect.code === POLICY_NOT_CONFIGURED, 'CASE5 fail-closed (not a silent default)');
    assertEqual(missing.journalEntryId, null, 'CASE5 no journal on missing policy');

    await setPolicy(store, 'C'); // C is NOT a registered BD-02 option → invalid
    const invalid = await applyBonusWithdrawalAccounting(ctx(store, 'w-1007'), store.deps);
    assertEqual(invalid.option, null, 'CASE5 invalid C → option is null');
    assert(invalid.effect.kind === 'fail_closed', 'CASE5 invalid effect is fail_closed');
    assert(invalid.effect.code === POLICY_INVALID, 'CASE5 invalid code = INVALID_ACCOUNTING_POLICY');
    assert(!store.raw.has(`${BD02_SNAPSHOT_PREFIX}w-1007`), 'CASE5 invalid option must NOT write a snapshot');
  }

  // ── CASE 6 — account mapping missing → ACCOUNT_MAPPING_REQUIRED, no journal ─
  console.log('CASE 6: BD-02 A but no bonus liability account in COA → ACCOUNT_MAPPING_REQUIRED, no journal');
  {
    const store = makeStore();
    await setPolicy(store, 'A');
    const result = await applyBonusWithdrawalAccounting(ctx(store, 'w-1008'), store.deps);
    assert(result.effect.kind === 'would_post', 'CASE6 intent to post (would_post)');
    if (result.effect.kind === 'would_post') {
      assert(result.effect.code === ACCOUNT_MAPPING_REQUIRED, 'CASE6 code = ACCOUNT_MAPPING_REQUIRED');
      assert(result.effect.reason.includes('no Bonus Liability account exists'), 'CASE6 reasons about absent liability account');
      assert(result.effect.reason.includes('1110/1120'), 'CASE6 reasons about unmapped cash/bank leg (ACC-05/X1)');
      assert(result.effect.reason.includes('not reused'), 'CASE6 2100 payables is explicitly rejected');
    }
    assertEqual(result.journalEntryId, null, 'CASE6 NO journal created even though would_post');
    assert(result.diagnostics.includes(ACCOUNTING_NOT_POSTED), 'CASE6 ledger flip has no posting');
    assert(result.diagnostics.includes(BONUS_GL_ATOMICITY_GAP), 'CASE6 bonus->GL gap recorded');
  }

  // ── Company-isolation gap (ACC-10) ─
  console.log('Company-isolation gap (ACC-10): withdrawal carries no company_id');
  {
    const store = makeStore();
    await setPolicy(store, 'B');
    const result = await applyBonusWithdrawalAccounting(ctx(store, 'w-1009', 'c-2'), store.deps);
    assert(result.diagnostics.includes(COMPANY_POLICY_ISOLATION_GAP), 'company gap flagged on every withdrawal resolution');
  }

  console.log('\nBD-02 CASE 1-6 complete. ' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
  if (failures > 0) {
    process.exitCode = 1;
  }
}

void (async () => {
  await run();
})();
