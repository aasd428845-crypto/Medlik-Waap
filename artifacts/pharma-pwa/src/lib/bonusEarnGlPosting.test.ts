/*
 * BD-01 E1 → GL posting — CASE 1-14 (local / test-only).
 *
 * PURE-TS assertions of the posting CONTRACT that the SQL pair
 * (0028 apply_bonus_earn_accounting + 0029 bonus_journal_leg_mapping /
 *  bonus_role_account_map + 0030 post_bonus_earn_to_gl) implements.
 *
 * No test runner is installed in the workspace (package.json exposes no test
 * script) and Node cannot resolve the @/ alias, so this file imports the PURE
 * seam via RELATIVE ./ paths only (never the Supabase-backed live wiring),
 * which lets it run under `node --experimental-strip-types` with zero new deps.
 *
 * Run locally (from the PWA source dir):
 *   node --experimental-strip-types src/lib/bonusEarnGlPosting.test.ts
 *
 * CONFIGURABILITY CONTRACT (the ADMIN CONTROL GAP fix):
 *   NO account code is hardcoded anywhere in the posting path. Every journal
 *   leg is driven by configuration —
 *     bonus_journal_leg_mapping (EARN, option) → (debit_role, credit_role)
 *     bonus_role_account_map    (company, role) → financial_accounts.id
 *   The resolved debit/credit CODES are frozen per-earn into the 0028 decision
 *   snapshot; 0030 reads them back from that snapshot and never re-resolves.
 *
 * CASES (mirror PHASE 4B §16):
 *   1  Option A with Debit=X / Credit=Y  → the journal uses exactly X/Y.
 *   2  Re-point Option A to Debit=M / Credit=N; a NEW earn → uses M/N.
 *   3  Re-inspect the OLD earn → still uses X/Y (snapshot history-locked).
 *   4  Remove the Debit mapping → ACCOUNT_MAPPING_REQUIRED, no journal.
 *   5  A non-postable account cannot be bound → the leg stays unmapped →
 *      fail-closed (never fabricated).
 *   6  Mapping changes while a PENDING link exists → 0030 posts from the
 *      SNAPSHOT, so the journal does NOT change silently (frozen at decision).
 *   7  Re-POST the same earn → same journal_entry_id, exactly one journal.
 *   8  Non-director (driver / branch_manager) is rejected at the authority gate.
 *   9  Closed period → the post is refused (FINANCIAL_PERIOD_NOT_OPEN).
 *  10  Company isolation: mapping company ≠ earn company → MAPPING_COMPANY_MISMATCH.
 *  11  BD-08 B (draft-at-event) → ACCOUNT_MAPPING_REQUIRED (no scheduler, valuation gap).
 *  12  BD-08 C (periodic sweep) → TIMING_INFRASTRUCTURE_REQUIRED (no T-3 scheduler).
 *  13  BD-09 C (periodic netting) → POSTING_INFRASTRUCTURE_REQUIRED (no scheduler + ACC-10).
 *  14  E1-3 batch "post all pending earns": summarizeBatchPostResults counts
 *      posted / alreadyPosted / failed and flags ok — per-earn reasons carried.
 *
 * This file is excluded from tsconfig.json (the test-file glob, *.test.ts) and
 * is not imported by the app graph, so it does not affect tsc --noEmit or build.
 */
import {
  computeGlPostIntent,
  buildEarnGlLines,
  earnPostEligible,
  canRepost,
  existingJournalId,
  glPostAuditKey,
  canPostEarnToGl,
  summarizeBatchPostResults,
  EARN_POSTING_ROLE,
  GL_POSTING_CODE,
  type GlPostContext,
  type GlPostState,
  type BatchPostOutcome,
} from './bonusEarnGlPosting.ts';
import { ACCOUNT_MAPPING_REQUIRED } from './bonusAccountingPolicy.ts';

// ── Minimal inline assertion harness (no node: imports) ──────────────────────
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

const AMOUNT = 750; // bonus_ledger.amount (gross order value, ACC-03 §3 E1)
const COMPANY = 'C1';

// ── In-memory mirror of the 0029 configuration ───────────────────────────────
//   roleAccount: bonus_role_account_map (role → financial_accounts.code | null)
//   layout:      bonus_journal_leg_mapping (option → debit_role / credit_role)
// Only a *postable* account can be bound (0029 trg_bonus_role_account_map_postable).
interface Config {
  roleAccount: Map<string, string>;
  postable: Set<string>;
}
function makeConfig(): Config {
  return { roleAccount: new Map(), postable: new Set() };
}

/** Mirror 0029's postable-enforcement trigger: a non-postable account is not
 *  bindable, so the role never resolves to it. Returns true when bound. */
function bindRole(cfg: Config, role: string, code: string, postable: boolean): boolean {
  if (!postable) return false; // 0029 BEFORE INSERT/UPDATE trigger refuses it
  cfg.roleAccount.set(role, code);
  cfg.postable.add(code);
  return true;
}

/** The canonical BD-01 leg layout for an option (0029 bonus_journal_leg_mapping).
 *  A: DR cash / CR deferred_bonus_liability ; B: DR bonus_expense / CR cash. */
const LEGS: Record<string, { debit_role: string; credit_role: string }> = {
  A: { debit_role: 'cash', credit_role: 'deferred_bonus_liability' },
  B: { debit_role: 'bonus_expense', credit_role: 'cash' },
};

// ── In-memory mirror of the 0028 per-earn decision snapshot + 0030 link ──────
interface Snapshot {
  ledgerId: string;
  option: string;
  debit_account_code: string | null;
  credit_account_code: string | null;
}
const snapshots = new Map<string, Snapshot>();
const links = new Map<string, { status: GlPostState; journalEntryId: string | null }>();

/** Mirror 0028's decision hook: resolve both legs from config at earn time and
 *  FREEZE the codes into the per-earn snapshot (history-locked, first-wins). */
function decide(cfg: Config, option: string, ledgerId: string): Snapshot {
  const existing = snapshots.get(ledgerId);
  if (existing) return existing; // first-wins: a decided earn is never re-evaluated
  const legs = LEGS[option];
  if (!legs) {
    const snap: Snapshot = { ledgerId, option, debit_account_code: null, credit_account_code: null };
    snapshots.set(ledgerId, snap);
    return snap;
  }
  const snap: Snapshot = {
    ledgerId,
    option,
    debit_account_code: cfg.roleAccount.get(legs.debit_role) ?? null,
    credit_account_code: cfg.roleAccount.get(legs.credit_role) ?? null,
  };
  snapshots.set(ledgerId, snap);
  return snap;
}

/** Build the pure posting context from a frozen snapshot (0030 reads ONLY the
 *  snapshot — it never re-resolves from the live role map).
 *  `override` lets tests swap in a non-default BD-08 timing / BD-09 aggregation
 *  to exercise the fail-closed dispatch for unavailable options. */
function ctxOf(
  snap: Snapshot,
  mappingCompanyId = COMPANY,
  override: Partial<Pick<GlPostContext, 'timing' | 'aggregation'>> = {},
): GlPostContext {
  const both = !!snap.debit_account_code && !!snap.credit_account_code;
  return {
    decision: { option: snap.option, journalEntryId: null, effectKey: 'bd01:earn:' + snap.ledgerId },
    accountingCode: both ? GL_POSTING_CODE.POSTING_AUTHORITY_REQUIRED : GL_POSTING_CODE.ACCOUNT_MAPPING_REQUIRED,
    debitAccountCode: snap.debit_account_code,
    creditAccountCode: snap.credit_account_code,
    timing: override.timing ?? 'A',
    aggregation: override.aggregation ?? 'A',
    companyId: COMPANY,
    mappingCompanyId,
  };
}

/** Mirror 0030 §(i): create+post a balanced journal from the snapshot. Returns
 *  the journal id, or a fail-closed code. `role`/`openPeriod` gate authority.
 *  `override` threads a non-default BD-08 timing / BD-09 aggregation into the
 *  context so tests can exercise BD-08 B/C / BD-09 C fail-closed paths. */
function postFromSnapshot(
  snap: Snapshot,
  opts: { role: string; openPeriod: boolean; journalId: string },
  override: Partial<Pick<GlPostContext, 'timing' | 'aggregation'>> = {},
): { journalEntryId: string | null; code: string | null } {
  if (!canPostEarnToGl(opts.role)) return { journalEntryId: null, code: 'POSTING_FORBIDDEN' };
  const ctx = ctxOf(snap, COMPANY, override);
  const elig = earnPostEligible(ctx, { openPeriod: opts.openPeriod });
  if (!elig.ok) return { journalEntryId: null, code: elig.code };
  const lines = buildEarnGlLines(snap.debit_account_code ?? '', snap.credit_account_code ?? '', AMOUNT);
  if (!lines) return { journalEntryId: null, code: GL_POSTING_CODE.ACCOUNT_MAPPING_REQUIRED };
  const prev = links.get(snap.ledgerId);
  if (prev && prev.status === 'POSTED') {
    return { journalEntryId: prev.journalEntryId, code: null }; // idempotent
  }
  links.set(snap.ledgerId, { status: 'POSTED', journalEntryId: opts.journalId });
  return { journalEntryId: opts.journalId, code: null };
}

// ── CASE 1: Option A Debit=X / Credit=Y → the journal uses X/Y ────────────────
function case1(): void {
  console.log('\n=== CASE 1: Option A Debit=X(1110) / Credit=Y(2110) → journal X/Y ===');
  const cfg = makeConfig();
  bindRole(cfg, 'cash', '1110', true);
  bindRole(cfg, 'deferred_bonus_liability', '2110', true);

  const snap = decide(cfg, 'A', 'ledger-1');
  const intent = computeGlPostIntent(ctxOf(snap));
  check(intent.queue === true, 'CASE 1 – both legs mapped → PENDING link queued (authority is the only gate)');

  const post = postFromSnapshot(snap, { role: EARN_POSTING_ROLE, openPeriod: true, journalId: 'je-1' });
  check(post.journalEntryId === 'je-1' && post.code === null, 'CASE 1 – director posts exactly one journal');
  const lines = buildEarnGlLines(snap.debit_account_code!, snap.credit_account_code!, AMOUNT)!;
  check(lines.lines[0].account_code === '1110' && lines.lines[0].debit === AMOUNT, 'CASE 1 – Debit leg uses the configured X=1110');
  check(lines.lines[1].account_code === '2110' && lines.lines[1].credit === AMOUNT, 'CASE 1 – Credit leg uses the configured Y=2110');
  check(lines.lines.every((l) => l.debit === 0 || l.credit === 0), 'CASE 1 – each line is strictly Dr OR Cr');
}

// ── CASE 2: re-point Option A to M/N → a NEW earn uses M/N ────────────────────
function case2(): void {
  console.log('\n=== CASE 2: re-point Option A to Debit=M(1120) / Credit=N(2110) ===');
  const cfg = makeConfig();
  bindRole(cfg, 'cash', '1110', true);
  bindRole(cfg, 'deferred_bonus_liability', '2110', true);
  decide(cfg, 'A', 'ledger-1'); // the OLD earn

  // Director re-points the cash role to a different valid account (M=1120).
  bindRole(cfg, 'cash', '1120', true);

  const snap2 = decide(cfg, 'A', 'ledger-2'); // a NEW earn, same policy option
  check(snap2.debit_account_code === '1120', 'CASE 2 – new earn Debit leg = M (1120) from the new config');
  check(snap2.credit_account_code === '2110', 'CASE 2 – new earn Credit leg = N (2110)');
  const lines = buildEarnGlLines(snap2.debit_account_code!, snap2.credit_account_code!, AMOUNT)!;
  check(lines.lines[0].account_code === '1120' && lines.lines[1].account_code === '2110',
    'CASE 2 – the new earn posts Debit M / Credit N');
}

// ── CASE 3: the OLD earn still uses X/Y (snapshot history-locked) ─────────────
function case3(): void {
  console.log('\n=== CASE 3: re-inspect the OLD earn → still X(1110)/Y(2110) ===');
  const cfg = makeConfig();
  bindRole(cfg, 'cash', '1110', true);
  bindRole(cfg, 'deferred_bonus_liability', '2110', true);
  const old = decide(cfg, 'A', 'ledger-1');
  bindRole(cfg, 'cash', '1120', true); // config changes AFTER the old earn

  const reread = decide(cfg, 'A', 'ledger-1'); // re-decide must be first-wins
  check(reread.debit_account_code === '1110' && reread.credit_account_code === '2110',
    'CASE 3 – the old earn still resolves to X/Y despite the live config now being M/N');
  const lines = buildEarnGlLines(old.debit_account_code!, old.credit_account_code!, AMOUNT)!;
  check(lines.lines[0].account_code === '1110' && lines.lines[1].account_code === '2110',
    'CASE 3 – re-reading the old earn never uses the current config (history protected)');
}

// ── CASE 4: remove the Debit mapping → ACCOUNT_MAPPING_REQUIRED, no journal ───
function case4(): void {
  console.log('\n=== CASE 4: Debit mapping removed → ACCOUNT_MAPPING_REQUIRED ===');
  const cfg = makeConfig();
  bindRole(cfg, 'deferred_bonus_liability', '2110', true); // only the credit role bound

  const snap = decide(cfg, 'A', 'ledger-4');
  check(snap.debit_account_code === null, 'CASE 4 – the debit leg is unmapped (cash role removed)');
  const intent = computeGlPostIntent(ctxOf(snap));
  check(intent.queue === false, 'CASE 4 – no PENDING link queued');
  check(intent.reason === ACCOUNT_MAPPING_REQUIRED, 'CASE 4 – fail-closed reason is ACCOUNT_MAPPING_REQUIRED');
  const post = postFromSnapshot(snap, { role: EARN_POSTING_ROLE, openPeriod: true, journalId: 'je-4' });
  check(post.journalEntryId === null, 'CASE 4 – no journal created (fail closed)');
  check(buildEarnGlLines(snap.debit_account_code ?? '', snap.credit_account_code ?? '', AMOUNT) === null,
    'CASE 4 – buildEarnGlLines yields no lines → 0 journals');
}

// ── CASE 5: a non-postable account cannot be bound → fail closed ──────────────
function case5(): void {
  console.log('\n=== CASE 5: non-postable account → cannot bind → fail closed ===');
  const cfg = makeConfig();
  const bound = bindRole(cfg, 'cash', '9999', false); // 9999 = invalid/non-postable
  check(bound === false, 'CASE 5 – 0029 refuses to bind a non-postable account (9999)');
  check(cfg.roleAccount.get('cash') === undefined, 'CASE 5 – the cash role stays unmapped (nothing fabricated)');

  const snap = decide(cfg, 'A', 'ledger-5');
  const intent = computeGlPostIntent(ctxOf(snap));
  check(intent.queue === false && intent.reason === ACCOUNT_MAPPING_REQUIRED,
    'CASE 5 – an invalid account never reaches the journal; ACCOUNT_MAPPING_REQUIRED');
  check(snap.debit_account_code === null && snap.credit_account_code === null,
    'CASE 5 – the snapshot carries no fabricated codes');
}

// ── CASE 6: mapping changes while a PENDING link exists → snapshot wins ───────
function case6(): void {
  console.log('\n=== CASE 6: mapping changed while PENDING → journal uses the SNAPSHOT ===');
  const cfg = makeConfig();
  bindRole(cfg, 'cash', '1110', true);
  bindRole(cfg, 'deferred_bonus_liability', '2110', true);
  const snap = decide(cfg, 'A', 'ledger-6'); // decided under cash=1110 → PENDING link
  links.set('ledger-6', { status: 'PENDING', journalEntryId: null });
  const intent = computeGlPostIntent(ctxOf(snap));
  check(intent.queue === true, 'CASE 6 – the earn is queued (PENDING link exists)');

  // Director re-points cash AFTER the earn is pending.
  bindRole(cfg, 'cash', '1120', true);

  // 0030 posts from the frozen snapshot — NOT the current config.
  const post = postFromSnapshot(snap, { role: EARN_POSTING_ROLE, openPeriod: true, journalId: 'je-6' });
  const lines = buildEarnGlLines(snap.debit_account_code!, snap.credit_account_code!, AMOUNT)!;
  check(post.journalEntryId === 'je-6', 'CASE 6 – the PENDING link posts exactly once');
  check(lines.lines[0].account_code === '1110',
    'CASE 6 – the posted Debit leg stays the snapshot X=1110 (does NOT change silently to 1120)');
  check(cfg.roleAccount.get('cash') === '1120',
    'CASE 6 – the live config is now 1120, proving the post ignored it (frozen at decision)');
}

// ── CASE 7: re-POST the same earn → same journal id, one journal ──────────────
function case7(): void {
  console.log('\n=== CASE 7: re-POST → same journal_entry_id, exactly 1 journal ===');
  const cfg = makeConfig();
  bindRole(cfg, 'cash', '1110', true);
  bindRole(cfg, 'deferred_bonus_liability', '2110', true);
  const snap = decide(cfg, 'A', 'ledger-7');
  const first = postFromSnapshot(snap, { role: EARN_POSTING_ROLE, openPeriod: true, journalId: 'je-7' });
  const second = postFromSnapshot(snap, { role: EARN_POSTING_ROLE, openPeriod: true, journalId: 'je-7-second' });
  check(first.journalEntryId === 'je-7', 'CASE 7 – the first post creates je-7');
  check(second.journalEntryId === 'je-7', 'CASE 7 – the re-post returns the SAME je-7 (idempotent)');
  check(canRepost('POSTED' as GlPostState) === false, 'CASE 7 – a POSTED link is never re-posted (no 2nd journal)');
  check(canRepost('PENDING' as GlPostState) === true, 'CASE 7 – only a PENDING link is postable');
  check(existingJournalId('POSTED' as GlPostState, 'je-7') === 'je-7', 'CASE 7 – idempotent read returns the existing journal id');
}

// ── CASE 8: non-director rejected at the authority gate ───────────────────────
function case8(): void {
  console.log('\n=== CASE 8: non-director → rejected ===');
  check(canPostEarnToGl('driver') === false, 'CASE 8 – driver (the E1 trigger session) is rejected');
  check(canPostEarnToGl('branch_manager') === false, 'CASE 8 – branch_manager is rejected');
  check(canPostEarnToGl(null) === false, 'CASE 8 – an unauthenticated session is rejected');
  check(canPostEarnToGl(EARN_POSTING_ROLE) === true, 'CASE 8 – company_director passes the gate');
  check(postFromSnapshot({ ledgerId: 'x', option: 'A', debit_account_code: '1110', credit_account_code: '2110' },
    { role: 'driver', openPeriod: true, journalId: 'je-x' }).code === 'POSTING_FORBIDDEN',
    'CASE 8 – a driver post attempt is refused before any journal is formed');
}

// ── CASE 9: closed period → refused ───────────────────────────────────────────
function case9(): void {
  console.log('\n=== CASE 9: closed period → FINANCIAL_PERIOD_NOT_OPEN ===');
  const cfg = makeConfig();
  bindRole(cfg, 'cash', '1110', true);
  bindRole(cfg, 'deferred_bonus_liability', '2110', true);
  const snap = decide(cfg, 'A', 'ledger-9');
  const elig = earnPostEligible(ctxOf(snap), { openPeriod: false });
  check(elig.ok === false, 'CASE 9 – post refused when no period is open');
  check(elig.code === 'FINANCIAL_PERIOD_NOT_OPEN', 'CASE 9 – fail-closed code FINANCIAL_PERIOD_NOT_OPEN');
  const post = postFromSnapshot(snap, { role: EARN_POSTING_ROLE, openPeriod: false, journalId: 'je-9' });
  check(post.journalEntryId === null && post.code === 'FINANCIAL_PERIOD_NOT_OPEN',
    'CASE 9 – no journal created against a closed period');
  check(glPostAuditKey('ledger-9') === 'GL_POST:bonus_earn_gl_postings:ledger-9',
    'CASE 9 – the audit key is deterministic and namespaced on the earn ledger id');
}

// ── CASE 10 (extra): company isolation → MAPPING_COMPANY_MISMATCH ─────────────
function case10(): void {
  console.log('\n=== CASE 10 (extra): mapping company ≠ earn company → mismatch ===');
  const cfg = makeConfig();
  bindRole(cfg, 'cash', '1110', true);
  bindRole(cfg, 'deferred_bonus_liability', '2110', true);
  const snap = decide(cfg, 'A', 'ledger-10');
  const intent = computeGlPostIntent(ctxOf(snap, 'OTHER-COMPANY'));
  check(intent.queue === false && intent.reason === GL_POSTING_CODE.MAPPING_COMPANY_MISMATCH,
    'CASE 10 – a mapping from another company is never used (ACC-10 isolation)');
}

// ── CASE 11: BD-08 B (draft-at-event) → ACCOUNT_MAPPING_REQUIRED (valuation gap) ──
function case11(): void {
  console.log('\n=== CASE 11: BD-08 B → fail closed (valuation basis unavailable) ===');
  const cfg = makeConfig();
  bindRole(cfg, 'cash', '1110', true);
  bindRole(cfg, 'deferred_bonus_liability', '2110', true);
  const snap = decide(cfg, 'A', 'ledger-11');

  const ctxB = ctxOf(snap, COMPANY, { timing: 'B' });
  const intent = computeGlPostIntent(ctxB);
  check(intent.queue === false, 'CASE 11 – BD-08 B does not queue a PENDING link');
  check(intent.reason === GL_POSTING_CODE.ACCOUNT_MAPPING_REQUIRED,
    'CASE 11 – fail-closed: ACCOUNT_MAPPING_REQUIRED (no scheduler for draft review; valuation basis unavailable)');
  // The pre-flight (earnPostEligible) also refuses, never forming a journal.
  const elig = earnPostEligible(ctxB, { openPeriod: true });
  check(elig.ok === false && elig.code === GL_POSTING_CODE.ACCOUNT_MAPPING_REQUIRED,
    'CASE 11 – earnPostEligible refuses BD-08 B (fail closed before journal)');
  // buildEarnGlLines still builds the lines (it only checks codes/amount), but
  // the *dispatch* never reaches posting because intent.queue=false.
  check(buildEarnGlLines(snap.debit_account_code!, snap.credit_account_code!, AMOUNT) !== null,
    'CASE 11 – lines are buildable in isolation, but the dispatch gate blocks posting');
}

// ── CASE 12: BD-08 C (periodic sweep) → TIMING_INFRASTRUCTURE_REQUIRED ────────────
function case12(): void {
  console.log('\n=== CASE 12: BD-08 C → fail closed (no periodic scheduler) ===');
  const cfg = makeConfig();
  bindRole(cfg, 'cash', '1110', true);
  bindRole(cfg, 'deferred_bonus_liability', '2110', true);
  const snap = decide(cfg, 'A', 'ledger-12');

  const ctxC = ctxOf(snap, COMPANY, { timing: 'C' });
  const intent = computeGlPostIntent(ctxC);
  check(intent.queue === false, 'CASE 12 – BD-08 C does not queue a PENDING link');
  check(intent.reason === GL_POSTING_CODE.TIMING_INFRASTRUCTURE_REQUIRED,
    'CASE 12 – fail-closed: TIMING_INFRASTRUCTURE_REQUIRED (no T-3 sweep scheduler)');
  // postFromSnapshot reads from the SAME snapshot context (timing=C) → fail closed.
  const post = postFromSnapshot(snap, { role: EARN_POSTING_ROLE, openPeriod: true, journalId: 'je-12' }, { timing: 'C' });
  check(post.journalEntryId === null && post.code === GL_POSTING_CODE.TIMING_INFRASTRUCTURE_REQUIRED,
    'CASE 12 – no journal created under BD-08 C (fail closed at pre-flight)');
}

// ── CASE 13: BD-09 C (periodic netting) → POSTING_INFRASTRUCTURE_REQUIRED ──────────
function case13(): void {
  console.log('\n=== CASE 13: BD-09 C → fail closed (no scheduler + ACC-10) ===');
  const cfg = makeConfig();
  bindRole(cfg, 'cash', '1110', true);
  bindRole(cfg, 'deferred_bonus_liability', '2110', true);
  const snap = decide(cfg, 'A', 'ledger-13');

  const ctxAggC = ctxOf(snap, COMPANY, { aggregation: 'C' });
  const intent = computeGlPostIntent(ctxAggC);
  check(intent.queue === false, 'CASE 13 – BD-09 C does not queue a PENDING link');
  check(intent.reason === GL_POSTING_CODE.POSTING_INFRASTRUCTURE_REQUIRED,
    'CASE 13 – fail-closed: POSTING_INFRASTRUCTURE_REQUIRED (no scheduler + ACC-10 company gap)');
  // earnPostEligible also refuses — the pre-flight re-checks the intent.
  const elig = earnPostEligible(ctxAggC, { openPeriod: true });
  check(elig.ok === false && elig.code === GL_POSTING_CODE.POSTING_INFRASTRUCTURE_REQUIRED,
    'CASE 13 – earnPostEligible refuses BD-09 C (fail closed before journal)');
}

// ── CASE 14 (E1-3): batch "post all pending earns" summary aggregation ────────
function case14(): void {
  console.log('\n=== CASE 14 (E1-3): batch summary aggregation ===');

  // Empty queue → empty, not ok, nothing posted.
  const empty = summarizeBatchPostResults([]);
  check(empty.empty === true && empty.ok === false && empty.total === 0,
    'CASE 14 – empty batch: empty=true, ok=false, total=0');

  // All newly posted → posted=N, ok=true.
  const s1 = summarizeBatchPostResults([
    { ledgerId: 'l1', status: 'POSTED', journalEntryId: 'je-1', idempotent: false },
    { ledgerId: 'l2', status: 'POSTED', journalEntryId: 'je-2', idempotent: false },
  ] as BatchPostOutcome[]);
  check(s1.posted === 2 && s1.alreadyPosted === 0 && s1.failed === 0 && s1.ok === true,
    'CASE 14 – all new: posted=2, ok=true');

  // Mixed: one new + one idempotent → still ok (no failure), counted separately.
  const s2 = summarizeBatchPostResults([
    { ledgerId: 'l1', status: 'POSTED', journalEntryId: 'je-1', idempotent: false },
    { ledgerId: 'l2', status: 'POSTED', journalEntryId: 'je-2', idempotent: true },
  ] as BatchPostOutcome[]);
  check(s2.posted === 1 && s2.alreadyPosted === 1 && s2.failed === 0 && s2.ok === true,
    'CASE 14 – mixed new+idempotent: posted=1, alreadyPosted=1, ok=true');

  // A single failure → not ok, reason carried per earn.
  const s3 = summarizeBatchPostResults([
    { ledgerId: 'l1', status: 'POSTED', journalEntryId: 'je-1', idempotent: false },
    { ledgerId: 'l2', status: 'FAILED', journalEntryId: null, reason: 'FINANCIAL_PERIOD_NOT_OPEN' },
  ] as BatchPostOutcome[]);
  check(s3.failed === 1 && s3.ok === false, 'CASE 14 – one failure → ok=false');
  check(s3.failures.length === 1 && s3.failures[0].ledgerId === 'l2'
    && s3.failures[0].reason === 'FINANCIAL_PERIOD_NOT_OPEN',
    'CASE 14 – failure carries its per-earn reason');

  // A missing reason falls back to UNKNOWN_FAILURE (never an empty string).
  const s4 = summarizeBatchPostResults([
    { ledgerId: 'l3', status: 'FAILED', journalEntryId: null },
  ] as BatchPostOutcome[]);
  check(s4.failures[0].reason === 'UNKNOWN_FAILURE',
    'CASE 14 – absent reason → UNKNOWN_FAILURE');
}

// ── Runner ─────────────────────────────────────────────────────────────────────
function main(): void {
  case1();
  case2();
  case3();
  case4();
  case5();
  case6();
  case7();
  case8();
  case9();
  case10();
  case11();
  case12();
  case13();
  case14();

  console.log('\n──────────────────────────────────────────');
  console.log(`PASS: ${pass.length}  FAIL: ${fail.length}`);
  if (fail.length > 0) {
    console.error('Failing checks:');
    for (const f of fail) console.error('  - ' + f);
  }
  console.log('────────────── CASES ──────────────');
  console.log('1) A Dr=X/Cr=Y        → journal uses X/Y                    ');
  console.log('2) re-point A=M/N     → new earn uses M/N                   ');
  console.log('3) re-read old earn   → still X/Y (snapshot history)        ');
  console.log('4) remove Debit map   → ACCOUNT_MAPPING_REQUIRED, 0 journals');
  console.log('5) non-postable acct  → cannot bind → fail closed           ');
  console.log('6) change while PENDING→ journal uses the SNAPSHOT (frozen) ');
  console.log('7) re-POST            → same journal_entry_id, 1 journal    ');
  console.log('8) non-director       → rejected at the authority gate      ');
  console.log('9) closed period      → FINANCIAL_PERIOD_NOT_OPEN           ');
  console.log('10) company mismatch  → MAPPING_COMPANY_MISMATCH            ');
  console.log('11) BD-08 B           → ACCOUNT_MAPPING_REQUIRED (fail closed)');
  console.log('12) BD-08 C           → TIMING_INFRASTRUCTURE_REQUIRED      ');
  console.log('13) BD-09 C           → POSTING_INFRASTRUCTURE_REQUIRED      ');
  console.log('14) E1-3 batch summary → posted/alreadyPosted/failed + ok     ');
  console.log('──────────────────────────────────────────');

  if (fail.length > 0) process.exitCode = 1;
}

void main();