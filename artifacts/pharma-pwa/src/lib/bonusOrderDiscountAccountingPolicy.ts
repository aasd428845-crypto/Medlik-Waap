/**
 * BD-04 BONUS ORDER DISCOUNT — Dynamic, director-controlled accounting-policy engine.
 *
 * ⚠️ This is the THIRD accounting-integration step and covers BD-04 (Bonus Order
 * Discount) ONLY. BD-05..BD-10 are explicitly NOT implemented here (directive item 20);
 * their option letters are NOT invented — BD-04 is registered as A/B (binary), so only
 * A and B exist.
 *
 * SCOPE (and the precise boundary — verified, NOT assumed):
 *   BD-04 is the INVOICE / REVENUE side of the bonus discount — i.e. the ACC-06 decision
 *   "is the discounted invoice presented net or gross?". It is NOT:
 *     - a product redemption (BD-03 / E6: inventory + COGS cost leg), and
 *     - a cash withdrawal (BD-02 / E4: monetary settlement), and
 *     - a bonus EARN (BD-01 / E1-E2: liability-vs-expense-of-grant).
 *   BD-03 reuses the BD-01/BD-02 POLICY-MECHANISM (resolver/snapshot/idempotency/source-trace)
 *     but swaps its account roles to inventory/cogs. That swap is what makes BD-03 distinct
 *     from BD-04, and BD-04 is distinct from BOTH: its roles are receivable/revenue/contra.
 *   BD-04 does NOT import or reuse BD-03's file (directive item 6) — it imports only the
 *     shared BD-01 base (sentinels + deps + PolicyResolutionError).
 *
 * CORE RULES (honored literally, same as BD-01/BD-02/BD-03):
 *   - The policy is NEVER chosen by code. `accounting_policy.BD-04` is read LIVE at
 *     invoice time and validated against BD-04's registered option set {A,B} (from
 *     `accountingPolicies.ts`). No `const BD04_POLICY = …`, no `policy ?? "A"`.
 *   - Missing policy -> ACCOUNTING_POLICY_NOT_CONFIGURED; invalid value ->
 *     POLICY_INVALID; both FAIL CLOSED (no journal fabricated).
 *   - A director change A->B affects ONLY subsequently-invoiced orders; a discount's
 *     recorded policy is locked at invoice time via a per-discount snapshot keyed on the
 *     discount's TRUE identity.
 *
 * Why BD-04 cannot post today (honest, verified state — never assumed):
 *   - Option A (net invoice): 1130 (receivable, 0007:46) + 4000 (revenue, 0007:52) BOTH
 *     exist in the seeded COA and the net amount is computable (order_total − discount,
 *     0021:313-337). A is therefore a REALISABLE intent: DR 1130 / CR 4000 on the net
 *     amount. The actual net posting is produced by the EXISTING
 *     `trg_financial_invoice_auto_journal` trigger (0009:108-138), NOT by this engine —
 *     the engine records `would_post` intent with `journalEntryId: null` and defers the
 *     physical entry to that authorised poster (never fabricating a duplicate one).
 *     The one transparency gap A lives with — that the bonus CONSUMPTION (the
 *     ORDER_DISCOUNT debit on bonus_ledger) has no GL contra — is BD-01/ACC-01's
 *     bonus-liability domain (Phase-49 §5.2 line 484 "no code exists"), deliberately
 *     OUT of BD-04's invoice-presentation scope (directive item 8: revenue reduction ≠
 *     bonus liability settlement).
 *   - Option B (gross invoice + separate discount adjustment): needs a separate contra
 *     account — a Sales Discount / Contra-receivable or a deferred bonus-liability (2xxx)
 *     account — NONE of which exists in the seeded COA (0007:42-54; Phase-49 §5.2
 *     line 460/484 "no customer-bonus liability account exists"). B therefore fails
 *     CLOSED with ACCOUNT_MAPPING_REQUIRED (directive item 11/17): no account is
 *     invented, no journal is fabricated.
 *
 * PURE. Imports only `accountingPolicies.ts` (pure data) and the shared fail-closed
 * sentinels/class/deps from `bonusAccountingPolicy.ts` (BD-01). Never initialises Supabase.
 * Tested offline with an in-memory fake store (see bonusOrderDiscountAccountingPolicy.test.ts).
 *
 * Sources of truth (verified in-repo, not assumed):
 *  - accountingPolicies.ts -> BD-04 options {A,B} (single source; ACC-06, H2).
 *  - 0018_bonus_financial_system.sql:53-75: `bonus_ledger` (id PK; txn_type CHECK includes
 *    'ORDER_DISCOUNT' (58); idempotency_key UNIQUE (73); NO company_id — ACC-10 fault line;
 *    POSTED rows immutable (98-112); order_id->orders(id) (65)).
 *  - 0020_order_discount.sql:247-252,289-295: `apply_order_discount` writes the
 *    ORDER_DISCOUNT row (negative amount, PENDING->POSTED flip, exactly-one guard) and
 *    the policy snapshot JSON in `bonus_ledger.notes` (D8, accounting_treatment:null at
 *    0020:239). Idempotency key `DISCOUNT:{order_id}` (0020:70-71, UNIQUE via 0018:73).
 *  - 0021_order_cancellation_with_discount.sql:308-399: `cancel_order_discount` writes a
 *    compensating REVERSAL (reverses_id) governed by the discount-time snapshot — BD-04's
 *    snapshot is on the same ledger.id, so a reversal never rewrites a discounted order's
 *    recorded policy.
 *  - 0026_order_item_modification.sql:79-108: modify_order_item picks the latest POSTED
 *    ORDER_DISCOUNT and writes a REFUND ledger row; it does not touch any BD-04 snapshot,
 *    so BD-04 cannot break D7.
 *  - 0002_catalog_inventory_orders.sql:126-173: `orders` (id, client_id, total_amount,
 *    status; NO company_id — ACC-10 fault line) and `order_items` (unit_price, quantity,
 *    is_bonus).
 *  - 0007_financial_setup_rls.sql:38-59: seeded COA. 1130 (العملاء والذمم المدينة, 0007:46)
 *    + 4000 (الإيرادات, 0007:52) exist and are postable; NO Sales Discount / Contra
 *    Revenue / Bonus Liability (2xxx) account exists.
 *  - 0009_financial_auto_posting.sql:106-138: `trg_financial_invoice_auto_journal` posts
 *    DR 1130 / CR 4000 on `invoices.amount` (the NET amount after 0021 netting).
 *  - 0021_order_cancellation_with_discount.sql:308-338: invoice total nets POSTED
 *    ORDER_DISCOUNT rows (minus their REVERSALs).
 *  - 0006_financial_core.sql:140-150 + 0010:278-302: `financial_documents.source_table/
 *    source_id` (R-1) + `create_financial_journal_entry`/`post_financial_journal_entry`
 *    exist and are granted, but are NOT invoked by this pure engine (no journal fabricated).
 *  - docs/opencode/PHASE-49 §3.8 E6/E7/E8 (255-264), §5.2 (440-486), §11.5 V-1/V-2/V-3
 *    (791-797), §6.3 (invoice->order traceability TECHNICAL GAP), ACC-06 (§10, 741),
 *    DC-3 (§12, 814), §13.1 (D4 NOT DECIDED), X2 (cost column missing), X3 (liability gap).
 *
 * TIMING (BD-08 NOT consulted): BD-04 affects at INVOICE CREATION (E8) — when
 * `branch_allocate_order` inserts the netted `invoices` row (0021:345-349) and the
 * invoice trigger fires. request_discount (apply_order_discount, E7) and approval carry
 * no BD-04 accounting effect. The E8 boundary is derived from the lifecycle, NOT from
 * BD-08; BD-08's publish-timing question (T-1/T-2/T-3, S-1/S-2/S-3) is NOT DECIDED, so
 * `TIMING_POLICY_REQUIRED` is surfaced as a diagnostic rather than assumed.
 */

import { getPolicy } from './accountingPolicies.ts';

// ── Keys ───────────────────────────────────────────────────────────────────
/** Live director-chosen policy for Bonus Order Discount (BD-04). */
export const BD04_POLICY_KEY = 'accounting_policy.BD-04';
/**
 * Per-discount historical snapshot prefix, shared with BD-01/BD-02/BD-03 snapshots
 * (suffix = the discount's TRUE identity). The shared namespace is fine because each
 * event's identity is globally-unique (a bonus_ledger.id), so a redemption snapshot can
 * never collide with a discount snapshot. No new table/migration.
 */
export const BD04_SNAPSHOT_PREFIX = 'accounting_policy.snapshot.';

// ── Shared fail-closed sentinels (reused from BD-01; never re-defined) ─────
import {
  POLICY_NOT_CONFIGURED,
  POLICY_INVALID,
  ACCOUNT_MAPPING_REQUIRED,
  COMPANY_POLICY_ISOLATION_GAP,
  ACCOUNTING_NOT_POSTED,
  BONUS_GL_ATOMICITY_GAP,
  type BonusEarnDeps,
  PolicyResolutionError,
} from './bonusAccountingPolicy.ts';

// ── BD-04-specific gaps (additive; BD-01/BD-02/BD-03 files untouched) ────────
/**
 * BD-08 (publish / sweep timing) is a SEPARATE, un-decided policy. The BD-04 *event
 * boundary* is fixed by the lifecycle (invoice creation, E8), but WHEN the resulting
 * draft entry is published/reconciled is not — so the engine records the boundary but
 * surfaces this rather than assuming a publish clock.
 */
export const TIMING_POLICY_REQUIRED = 'TIMING_POLICY_REQUIRED';
/**
 * R-1 source-traceability gap at the invoice leg: `invoices` has no `order_id`
 * (Phase-49 §6.3), so a GL entry cannot be traced back to the order/discount that
 * produced it. The bonus_ledger->order link is intact (0018:65), so the engine still
 * anchors `sourceTrace` on the ORDER_DISCOUNT ledger row; this flag marks the missing
 * invoice-side leg for the future poster.
 */
export const SOURCE_TRACE_GAP = 'SOURCE_TRACE_GAP';

// ── BD-04 option letters (from the registry, not a literal) ──────────────────
export type Bd04Option = string;
export const BD04_OPTIONS: readonly string[] = (() => {
  const policy = getPolicy('BD-04');
  return policy ? Object.freeze(policy.options.map((o) => o.value)) : [];
})();

// ── Inputs / outputs ─────────────────────────────────────────────────────────
/**
 * The TRUE identity of a Bonus Order Discount event — the schema's `bonus_ledger` row
 * whose `txn_type = 'ORDER_DISCOUNT'` (created by `apply_order_discount`, 0020:247-252,
 * flipped PENDING->POSTED at 0020:289-295). This is the event's identity, NOT order.id:
 * an order may carry a discount, and the discount row is the auditable accounting subject
 * (its snapshot, idempotency and source-trace all key on it).
 */
export interface OrderDiscountIdentity {
  /** `bonus_ledger.id` of the ORDER_DISCOUNT row (the TRUE event identity). */
  ledgerId: string;
  /** `orders.id` the discount was applied to — carried for source-trace context. */
  orderId?: string | null;
  /** `bonus_ledger.idempotency_key` (e.g. `DISCOUNT:{order_id}`, 0020:70-71) — alternate
   *  dedup key; the engine keys on ledgerId, not on this. */
  idempotencyKey?: string | null;
}

export interface DiscountAccountingContext {
  /** Real identity of the discount (drives idempotency + snapshot key). */
  identity: OrderDiscountIdentity;
  /** Invoice-creation stage. BD-08 timing NOT consulted; BD-04 affects at E8/POSTED. */
  status: string;
  /** Best-effort current financial company (C-3 single-company assumption). */
  companyId?: string | null;
  /** Effective discount value (|bonus_ledger.amount|); context only — never invented. */
  discountAmount?: number | null;
}

/**
 * Account ROLE, not code. The engine NEVER invents a code. BD-04's intended roles are
 * `receivable` (1130) and `revenue` (4000) for the invoice leg — both exist in the seeded
 * COA (0007:46,52) — plus, for option B only, `discount_contra` (a Sales Discount /
 * contra-receivable / bonus-liability account) which does NOT exist. A role with no
 * resolvable COA code is exactly what trips ACCOUNT_MAPPING_REQUIRED.
 */
export interface OrderDiscountAccountRole {
  role: 'receivable' | 'revenue' | 'discount_contra';
  code?: undefined;
}

/**
 * The concrete accounting effect chosen for this discount.
 *  - would_post : the director's option expresses intent to post a journal (DR/CR on the
 *                 invoice leg). `code` is the specific gap that BLOCKS posting today
 *                 (undefined for A, where the invoice accounts are mapped and the net
 *                 amount is computable; ACCOUNT_MAPPING_REQUIRED for B, where the
 *                 separate discount contra account is absent). `journalEntryId` is always
 *                 null — the engine never fabricates a journal; the existing invoice
 *                 trigger posts the net entry for A, and a future poster would handle B.
 *  - fail_closed: unconfigured/invalid policy (no journal).
 */
export type OrderDiscountEffect =
  | {
      kind: 'would_post';
      intendedAccounts: OrderDiscountAccountRole[];
      /** Gap that blocks posting, or undefined when the invoice leg is fully mappable. */
      code?: string;
      reason: string;
      /** Which invoice model the option selected. */
      basis: 'net_invoice' | 'gross_invoice';
      /** Why the basis cannot be fully posted today (human-readable). */
      basisGap: string;
    }
  | {
      kind: 'fail_closed';
      code: string;
      reason: string;
    };

export interface OrderDiscountDecision {
  /** BD-04 option resolved at invoice time (null only when resolution failed). */
  option: string | null;
  effect: OrderDiscountEffect;
  /** journal_entry.id if one were actually created (null today for BD-04 — fail-closed/no
   *  fabricating). */
  journalEntryId: string | null;
  /** Stable idempotency key for THIS discount's accounting effect. */
  effectKey: string;
  /** Did a snapshot already exist for this discount when we got here? */
  alreadyHadPolicySnapshot: boolean;
  /** Gaps / warnings accompanying the decision. */
  diagnostics: string[];
  /** Source-trace shape wired for the future poster (R-1: financial_documents
   *  source_table='bonus_ledger' + source_id), anchored on the ORDER_DISCOUNT ledger
   *  row. */
  sourceTrace: {
    sourceTable: 'bonus_ledger';
    sourceId: string;
    documentType: 'order_discount';
    orderId: string | null;
    ledgerId: string;
  };
}

/** Storage abstraction reused from BD-01 (bonus_settings read/write). */
export type OrderDiscountDeps = BonusEarnDeps;

// ── 1. Resolve the CURRENT live policy (fail-closed, no default) ─────────────
/**
 * Reads `accounting_policy.BD-04` from settings and validates it against BD-04's
 * registered option set {A,B} (from `accountingPolicies.ts`).
 *
 * Throws `ACCOUNTING_POLICY_NOT_CONFIGURED` / `INVALID_ACCOUNTING_POLICY` — the
 * caller decides how to surface it; this function NEVER substitutes a default option.
 *
 * Company note: `bonus_settings` carries NO `company_id` (0018 DDL; Phase-49 §1.4),
 * so the read is global. Passing a `companyId` produces a `COMPANY_POLICY_ISOLATION_GAP`
 * diagnostic rather than a silent cross-company read — the verified ACC-10 gap. (The
 * bonus ORDER_DISCOUNT source is not company-scoped: `bonus_ledger` and `orders` have no
 * `company_id` — 0018:53-75, 0002:126-140 — while `financial_accounts`/`financial_journal_entries`
 * ARE company-scoped, 0006:126/154; so a posted entry would be attributed to a company that
 * the source event cannot name. Surfaced, never assumed.)
 */
export async function resolveOrderDiscountAccountingPolicy(
  deps: OrderDiscountDeps,
  companyId?: string | null,
): Promise<{ option: string; diagnostics: string[] }> {
  const raw = await deps.readSetting(BD04_POLICY_KEY);
  if (raw == null || raw === '') {
    throw new PolicyResolutionError(
      POLICY_NOT_CONFIGURED,
      'BD-04 is not configured; refusing to assume a policy.',
    );
  }
  const candidate = String(raw);
  if (!BD04_OPTIONS.includes(candidate)) {
    throw new PolicyResolutionError(
      POLICY_INVALID,
      `BD-04 option "${candidate}" is not one of the registered alternatives (${BD04_OPTIONS.join(', ') || 'none'}).`,
    );
  }
  const diagnostics: string[] = [];
  if (companyId) {
    diagnostics.push(COMPANY_POLICY_ISOLATION_GAP);
  }
  return { option: candidate, diagnostics };
}

// ── 2. Snapshot the policy in force for THIS discount (history protection) ─────
/**
 * Persists `accounting_policy.snapshot.<ledgerId>` = option via the existing
 * director-writable `bonus_settings` (no new table, no migration). Idempotent: if a
 * snapshot already exists for this discount's TRUE identity it is left untouched, so a
 * later setting change can never rewrite a discounted order's recorded policy.
 *
 * NOTE: this is the ACCOUNTING-POLICY snapshot (what BD-04 option applied at invoice
 * time), which is deliberately distinct from the eligibility/policy snapshot stored in
 * `bonus_ledger.notes` at discount-apply time (0020:229-244, D8). Confusing the two would
 * break the A->B lock: the eligibility snapshot governs *cancellation* (0020:375-387),
 * while this accounting snapshot governs *historical GL treatment*. Both must read the
 * same event's locked option.
 */
export async function snapshotOrderDiscountPolicy(
  ledgerId: string,
  option: string,
  deps: OrderDiscountDeps,
): Promise<{ written: boolean }> {
  const key = `${BD04_SNAPSHOT_PREFIX}${ledgerId}`;
  const existing = await deps.readSetting(key);
  if (existing != null) return { written: false };
  await deps.upsertSetting(key, option);
  return { written: true };
}

/** Which BD-04 option was in force when this discount was invoiced. */
export async function getHistoricalOrderDiscountPolicy(
  ledgerId: string,
  deps: OrderDiscountDeps,
): Promise<{ option: string | null; source: 'snapshot' | 'none' }> {
  const raw = await deps.readSetting(`${BD04_SNAPSHOT_PREFIX}${ledgerId}`);
  if (raw == null) return { option: null, source: 'none' };
  const opt = String(raw);
  return { option: BD04_OPTIONS.includes(opt) ? opt : null, source: 'snapshot' };
}

// ── 3. Dispatch A / B for this discount (fail-closed, no journal fabricated) ────
/**
 * Resolve the current BD-04 policy, snapshot it for THIS discount, and return the
 * concrete accounting effect. Does NOT mutate bonus_ledger (the ORDER_DISCOUNT row was
 * already flipped to POSTED server-side by `apply_order_discount`, 0020:289-295); does
 * NOT create journal entries (`create_financial_journal_entry` /
 * `post_financial_journal_entry` are not called — the engine never fabricates a journal).
 *
 * Per-option, grounded in Phase-49 ACC-06 + §5.2 + the seeded COA (0007:42-54):
 *   A (net invoice, current behavior): DR 1130 / CR 4000 on the NET amount
 *     (order_total − discount, 0021:313-337). 1130 (0007:46) + 4000 (0007:52) BOTH exist
 *     and are postable, and the net amount is computable — so A is a REALISABLE intent
 *     (would_post, no account gap). The discount's bonus-consumption has no GL contra, but
 *     that is BD-01/ACC-01's bonus-liability domain (Phase-49 §5.2 line 484), out of
 *     BD-04's invoice-presentation scope (directive item 8).
 *   B (gross invoice + separate discount adjustment): DR 1130 / CR 4000 on the TOTAL,
 *     PLUS a separate contra entry to reduce receivables / open a liability. That separate
 *     account (Sales Discount / Contra-receivable / bonus-liability 2xxx) does NOT exist
 *     in the seeded COA (0007:42-54; Phase-49 §5.2 line 460/484) -> fail CLOSED with
 *     ACCOUNT_MAPPING_REQUIRED. No account is invented; no journal is fabricated.
 *
 * BD-08 timing is NOT consulted (separate policy); this engine is async only to leave a
 * seam for a future publish-timing gate (TIMING_POLICY_REQUIRED diagnostic).
 *
 * Idempotency: the snapshot is keyed by the discount's TRUE identity
 * (bonus_ledger.id) and written once; re-dispatching the same discount yields
 * alreadyHadPolicySnapshot=true and NO_DUPLICATE_EFFECT. The discount-level
 * idempotency_key (DISCOUNT:{order_id}, 0020:70-71; UNIQUE via 0018:73) +
 * apply_order_discount's exactly-one-POSTED-flip guard (0020:289-295) make the discount
 * application itself idempotent at the database level.
 */
export async function applyOrderDiscountAccounting(
  ctx: DiscountAccountingContext,
  deps: OrderDiscountDeps,
): Promise<OrderDiscountDecision> {
  const { ledgerId, orderId, idempotencyKey: _idempotencyKey } = ctx.identity;
  const effectKey = `bd04:orderdiscount:${ledgerId}`;
  const sourceTrace = {
    sourceTable: 'bonus_ledger' as const,
    sourceId: ledgerId,
    documentType: 'order_discount' as const,
    orderId: orderId ?? null,
    ledgerId,
  };

  // (1) Resolve current live policy — fail closed (no default).
  let option: string;
  let resolveDiagnostics: string[] = [];
  try {
    const resolved = await resolveOrderDiscountAccountingPolicy(deps, ctx.companyId);
    option = resolved.option;
    resolveDiagnostics = resolved.diagnostics;
  } catch (e) {
    const err = e as PolicyResolutionError;
    const code = err.code ?? 'UNKNOWN';
    return {
      option: null,
      effect: { kind: 'fail_closed', code, reason: `${code}: ${err.message}` },
      journalEntryId: null,
      effectKey,
      alreadyHadPolicySnapshot: false,
      diagnostics: [],
      sourceTrace,
    };
  }

  // (2) Snapshot the policy in force for THIS discount (idempotent, history-safe).
  const snap = await snapshotOrderDiscountPolicy(ledgerId, option, deps);

  // (3) Dispatch A / B. The invoice leg accounts 1130+4000 exist (0007:46,52); the gap for
  //     B is the MISSING separate discount contra account (Phase-49 §5.2 line 460/484).
  const baseDiagnostics = [
    ...resolveDiagnostics,
    ACCOUNTING_NOT_POSTED,
    BONUS_GL_ATOMICITY_GAP,
    TIMING_POLICY_REQUIRED,
    SOURCE_TRACE_GAP,
  ];

  if (option === 'A') {
    // Net invoice: DR 1130 (receivable) / CR 4000 (revenue) on order_total − discount.
    // Both invoice-leg accounts are mapped; the net amount is computable (0021:313-337).
    const intendedAccounts: OrderDiscountAccountRole[] = [
      { role: 'receivable' }, // 1130 العملاء والذمم المدينة (0007:46)
      { role: 'revenue' }, // 4000 الإيرادات (0007:52)
    ];
    return {
      option,
      effect: {
        kind: 'would_post',
        intendedAccounts,
        code: undefined, // invoice leg fully mappable; no account gap blocks A
        reason:
          `BD-04 Option A (فاتورة صافية / net invoice, current behaviour): DR 1130 / CR 4000 ` +
          `on the net amount (order_total − discount, 0021:313-337). 1130 (0007:46) + ` +
          `4000 (0007:52) are both mapped and postable; the net basis is computable, so A ` +
          `is a realisable intent. The discount's bonus-consumption has NO GL contra (the ` +
          `bonus-liability/2xxx account does not exist — Phase-49 §5.2 line 484), but that ` +
          `is BD-01/ACC-01's liability domain, out of BD-04's invoice-presentation scope. ` +
          `No journal fabricated by this engine (the existing invoice trigger posts the net ` +
          `entry at 0009:108-138).`,
        basis: 'net_invoice',
        basisGap:
          'The discount is invisible to the GL under A (netted into revenue/receivable); ' +
          'the bonus-consumption contra is absent (no 2xxx liability account — Phase-49 ' +
          '§5.2 line 484). This is the H2/ACC-06 net trade-off, not an invoice-side ' +
          'ACCOUNT_MAPPING_REQUIRED.',
      },
      journalEntryId: null,
      effectKey,
      alreadyHadPolicySnapshot: !snap.written,
      diagnostics: [...baseDiagnostics],
      sourceTrace,
    };
  }

  if (option === 'B') {
    // Gross invoice: DR 1130 / CR 4000 on the TOTAL + a separate discount contra entry.
    // The separate account (Sales Discount / Contra-receivable / bonus-liability 2xxx)
    // does NOT exist in the seeded COA -> fail CLOSED, no journal, no invented account.
    const intendedAccounts: OrderDiscountAccountRole[] = [
      { role: 'receivable' }, // 1130 (exists, 0007:46)
      { role: 'revenue' }, // 4000 (exists, 0007:52)
      { role: 'discount_contra' }, // MISSING — no Sales Discount / Contra-receivable / 2xxx
    ];
    return {
      option,
      effect: {
        kind: 'would_post',
        intendedAccounts,
        code: ACCOUNT_MAPPING_REQUIRED,
        reason:
          `${ACCOUNT_MAPPING_REQUIRED}: BD-04 Option B (فاتورة إجمالية مع تسويل منفصل / gross ` +
          `invoice + separate discount adjustment) would stamp DR 1130 / CR 4000 on the ` +
          `TOTAL plus a separate contra entry to reduce receivables or open a liability. ` +
          `1130 (0007:46) and 4000 (0007:52) exist, but the separate discount-contra account ` +
          `does NOT exist in the seeded chart of accounts (no Sales Discount, no ` +
          `Contra-receivable, and no 2xxx bonus-liability — Phase-49 §5.2 line 460/484: ` +
          `"No customer-bonus liability account exists"). The engine NEVER invents an ` +
          `account; no journal is fabricated.`,
        basis: 'gross_invoice',
        basisGap: `Gross-invoice model requires a contra/discount account that is absent from the seeded COA (0007:42-54); mapping gap is the blocker, not a valuation basis (Phase-49 §5.2, ACC-06).`,
      },
      journalEntryId: null,
      effectKey,
      alreadyHadPolicySnapshot: !snap.written,
      diagnostics: [...baseDiagnostics, ACCOUNT_MAPPING_REQUIRED],
      sourceTrace,
    };
  }

  // Exhaustive over the registered option set. The resolver already guaranteed
  // option ∈ BD04_OPTIONS ({A,B}); this branch is unreachable defensive code.
  return {
    option,
    effect: {
      kind: 'fail_closed',
      code: POLICY_INVALID,
      reason: `${POLICY_INVALID}: BD-04 option "${option}" is registered but has no dispatch branch.`,
    },
    journalEntryId: null,
    effectKey,
    alreadyHadPolicySnapshot: !snap.written,
    diagnostics: [...baseDiagnostics, ACCOUNT_MAPPING_REQUIRED],
    sourceTrace,
  };
}
