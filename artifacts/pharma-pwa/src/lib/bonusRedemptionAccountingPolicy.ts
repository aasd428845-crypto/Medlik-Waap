/**
 * BD-03 BONUS PRODUCT REDEMPTION — Dynamic, director-controlled accounting-policy engine.
 *
 * ⚠️ This is the SECOND AC step and covers BD-03 (Bonus Product Redemption) ONLY.
 * BD-04..BD-10 are explicitly NOT implemented here (they are out of scope; their
 * option letters are NOT invented — the directive item 6 forbids that).
 *
 * SCOPE (and the precise boundary, versus BD-02):
 *   BD-03 is the REDEMPTION cost leg (X2), NOT a cash withdrawal (E6 ≠ E4). Redemption
 *   is a PHYSICAL + COGS event: the director exchanges bonus value for a catalogue
 *   product, goods leave the shelf, and the bonus liability (if any) is extinguished.
 *   Cash Withdrawal (BD-02) is a monetary settlement event. The two share the
 *   policy-resolution/snapshot/idempotency/source-trace mechanism (reused VERBATIM from
 *   BD-01's pure module), but their account roles and valuation bases are different:
 *     - BD-02 roles: deferred_bonus_liability / cash_or_bank.
 *     - BD-03 roles: inventory (1140) / cost_of_goods_sold (5000).
 *
 * CORE RULES (honored literally, same as BD-01/BD-02):
 *   - The policy is NEVER chosen by code. `accounting_policy.BD-03` is read LIVE at
 *     fulfilment time and validated against BD-03's registered option set
 *     (A/B/C — three options, unlike BD-02's binary A/B). No `const BD03_POLICY = …`,
 *     no `policy ?? "A"` default.
 *   - Missing policy -> ACCOUNTING_POLICY_NOT_CONFIGURED; invalid value ->
 *     POLICY_INVALID; both FAIL CLOSED (no journal fabricated).
 *   - A director change A->B affects ONLY subsequently-redeemed products; a
 *     redemption's recorded policy is locked at fulfilment time via a per-redemption
 *     snapshot keyed on the redeemptions TRUE identity.
 *
 * Why BD-03 cannot post today (the honest, verified state — never assumed):
 *   All three registry options value the cost leg at a basis the system does NOT have:
 *     - A (sale price): unit_price × qty is the redemption FACE VALUE (0018:831/835),
 *       not a product cost; 0009:197-198 already misuses unit_price as unit_cost.
 *     - B (product cost): the catalogue has NO cost column — `products` carries only
 *       `unit_price` (0002:19). (PHASE-49 X2 / §11.5 V-2.)
 *     - C (rule value): bonus_value/bonus_percent (0019:353-375; §11.5 V-3) is not a
 *       product cost, and C carries NO inventory offset to balance the COGS debit.
 *   The inventory (1140) and COGS (5000) accounts DO exist in the seeded COA
 *   (0007:47,53), so this is NOT an account-mapping gap — it is a VALUATION-BASIS gap
 *   (INVENTORY_VALUATION_REQUIRED / COBS_BASIS_REQUIRED). The bonus liability
 *   extinguishment leg (2xxx) is out of BD-03's scope (it is BD-01/ACC-01's accrual
 *   domain; PHASE-49 line 484 "no code exists" — a separate gap, noted).
 *   ACC-03 (the cost-recognition decision) is NOT DECIDED today (PHASE-49 §13.1 D4),
 *   and DC-5 (§12) makes ACC-03 a hard prerequisite before the X2 cost leg is built.
 *
 * PURE. Imports only `accountingPolicies.ts` (pure data) and the shared fail-closed
 * sentinels/class from `bonusAccountingPolicy.ts` (BD-01). Never initialises Supabase.
 * Tested offline with an in-memory fake store (see bonusRedemptionAccountingPolicy.test.ts).
 *
 * Sources of truth (verified in-repo, not assumed):
 *  - accountingPolicies.ts -> BD-03 options {A,B,C} (single source; ACC-03 / V-1/V-2/V-3).
 *  - 0018_bonus_financial_system.sql:
 *      bonus_redemptions (id uuid PK, product_id->products, quantity, bonus_value,
 *        status check, ledger_id->bonus_ledger(id) on delete set null, idempotency_key
 *        UNIQUE, NO company_id — PHASE-49 §1.4 / ACC-10 fault line)
 *      -> redemption TRUE identity = bonus_redemptions.id (NOT assumed as
 *         bonus_ledger.id; ledger_id is the subledger debit anchor for source-trace).
 *      bonus_ledger (redemption_id reciprocal link, 0018:67; POSTED rows immutable,
 *        0018:98-112)
 *      request_redemption (793): reads products.unit_price under lock, stores
 *        bonus_value = unit_price × qty (835); funds gate (836-841); inserts PENDING
 *        REDEEM_PRODUCT ledger row (851-854) + idempotency (821-824).
 *      approve_redemption (873-902): PENDING -> APPROVED, no ledger change.
 *      fulfill_redemption (908-948): flips PENDING -> POSTED ledger row (931-937,
 *        exactly-one guard, aborts otherwise) — THIS is the accounting-affecting
 *        moment (E6). No inventory movement, no COGS (PHASE-49 §3.8 E6 p.259-260).
 *      reverse_bonus_txn (1332-1400): compensating REVERSAL (POSTED) row.
 *  - 0002_catalog_inventory_orders.sql: `products` has `unit_price` ONLY (0002:19) —
 *    no cost column (X2; V-2).
 *  - 0009_financial_auto_posting.sql: `trg_financial_bonus_inventory` (184-220) is the
 *    ONLY writer of a 'bonus' inventory movement, and it fires on `order_items.is_bonus`
 *    (legacy Free-Y), NOT on redemption fulfilment; it reads unit_price as unit_cost
 *    (0009:197-198). Confirms E6 has no inventory writer and that unit_price is a sale
 *    price being (mis)used as a cost.
 *  - 0007_financial_setup_rls.sql:38-59: seeded COA. 1140 (المخزون) + 5000 (تكلفة
 *    المبيعات) exist (postable); no 2xxx bonus-liability leaf.
 *  - 0006_financial_core.sql:144-145 + 0010_financial_simple_entries.sql:278-302,308-326:
 *    `financial_documents.source_table/source_id` (R-1) + `create_financial_journal_entry`
 *    / `post_financial_journal_entry` exist and are granted to `authenticated`, but are
 *    NOT invoked by this pure engine (no journal is ever fabricated here).
 *  - docs/opencode/PHASE-49: §3.8 E6 (255-264), §11.5 V-1/V-2/V-3 (791-797), ACC-03
 *    (§10), DC-5 (§12), §13.1 (D4 NOT DECIDED).
 *
 * TIMING (BD-08 NOT consulted): the policy fires at FULFILMENT (the PENDING->POSTED
 * ledger flip inside `fulfill_redemption`, 0018:908-948). request/approve create no
 * accounting entry. The E2 seam that wires this lives in `fulfillRedemptionWithAccounting.ts`.
 */

import { getPolicy } from './accountingPolicies.ts';

// ── Keys ───────────────────────────────────────────────────────────────────
/** Live director-chosen policy for Bonus Product Redemption (BD-03). */
export const BD03_POLICY_KEY = 'accounting_policy.BD-03';
/** Per-redemption historical snapshot prefix; the suffix is the redemption's TRUE id. */
export const BD03_SNAPSHOT_PREFIX = 'accounting_policy.snapshot.';

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

// ── BD-03-specific valuation-basis gaps (additive; BD-01/BD-02 files untouched) ─
/**
 * The option names an inventory/COGS value but the system has no reliable cost basis:
 * option A revalues at the catalogue SALE price (V-1), option C has no inventory leg and
 * values at the rule figure (V-3). The inventory/COGS accounts exist, but the BASIS is
 * not a cost — ACC-03 is not configured (PHASE-49 §13.1 D4, DC-5).
 */
export const INVENTORY_VALUATION_REQUIRED = 'INVENTORY_VALUATION_REQUIRED';
/**
 * The option requires the product's real cost (V-2), but no cost column exists on the
 * catalogue (`products` has only `unit_price`, a sale price; 0002:19; PHASE-49 X2).
 */
export const COBS_BASIS_REQUIRED = 'COBS_BASIS_REQUIRED';

// ── BD-03 option letters (from the registry, not a literal) ─────────────────
export type Bd03Option = string;
export const BD03_OPTIONS: readonly string[] = (() => {
  const policy = getPolicy('BD-03');
  return policy ? Object.freeze(policy.options.map((o) => o.value)) : [];
})();

// ── Inputs / outputs ────────────────────────────────────────────────────────
/**
 * The TRUE identity of a Product-Redemption event, determined from the schema
 * (item 8 — not assumed as bonus_ledger.id):
 *   - redemptionId : bonus_redemptions.id  (the request — the event's true identity;
 *                                          snapshot key + idempotency anchor)
 *   - ledgerId     : bonus_ledger.id of the REDEEM_PRODUCT row (subledger debit
 *                    anchor + future GL source-trace target, via bonus_redemptions.ledger_id
 *                    -> bonus_ledger.id, 0018:199/67)
 *   - idempotencyKey : bonus_redemptions.idempotency_key (request-level, 0018:204)
 *   - bonusValue  : bonus_value stored at request = unit_price × qty (0018:835; V-1)
 */
export interface RedemptionIdentity {
  redemptionId: string;
  ledgerId?: string | null;
  idempotencyKey?: string | null;
  productId?: string | null;
  quantity?: number | null;
  bonusValue?: number | null;
}

export interface RedemptionAccountingContext {
  /** Real identity of the redemption (drives idempotency + snapshot key). */
  identity: RedemptionIdentity;
  /** Fulfilment stage (BD-08 timing NOT consulted); BD-03 affects at FULFILLED. */
  status: string;
  /** Best-effort current financial company (C-3 single-company assumption). */
  companyId?: string | null;
  /** bonus_value (the redemption face value), carried for context only. */
  amount?: number | null;
}

/**
 * Account ROLE, not code. The engine NEVER invents a code. BD-03's intended roles are
 * inventory (1140) and cost_of_goods_sold (5000); both exist in the seeded COA
 * (0007:47,53), so BD-03's gating gap is the valuation BASIS, not account mapping —
 * but a role with no resolvable COA code would still be ACCOUNT_MAPPING_REQUIRED.
 */
export interface RedemptionAccountRole {
  role: 'inventory' | 'cost_of_goods_sold';
  code?: undefined;
}

/**
 * The concrete accounting effect chosen for this redemption.
 *  - no_entry      : not used by BD-03 A/B/C today (no invented no-entry option).
 *  - would_post    : the director's option expresses intent to post DR/CR inventory+COGS,
 *                    but a basis/account gap keeps it fail-closed (no journal fabricated).
 *                    `code` is the specific gap that blocks posting.
 *  - fail_closed   : unconfigured/invalid policy (no journal).
 */
export type RedemptionEffect =
  | {
      kind: 'no_entry';
      reason: string;
    }
  | {
      kind: 'would_post';
      intendedAccounts: RedemptionAccountRole[];
      code: string;
      reason: string;
      /** Which valuation basis the option selected (A/B/C). */
      basis: 'unit_price' | 'product_cost' | 'rule_value';
      /** Why that basis cannot be posted today. */
      basisGap: string;
    }
  | {
      kind: 'fail_closed';
      code: string;
      reason: string;
    };

export interface BonusRedemptionDecision {
  /** BD-03 option resolved at fulfilment time (null only when resolution failed). */
  option: string | null;
  effect: RedemptionEffect;
  /** journal_entry.id if one were actually created (null today for BD-03 — fail-closed). */
  journalEntryId: string | null;
  /** Stable idempotency key for THIS redemption's accounting effect. */
  effectKey: string;
  /** Did a snapshot already exist for this redemption when we got here? */
  alreadyHadPolicySnapshot: boolean;
  /** Gaps / warnings accompanying the decision. */
  diagnostics: string[];
  /** Source-trace shape wired for the future poster (R-1: financial_documents
   *  source_table='bonus_ledger' + source_id), not live today. */
  sourceTrace: {
    sourceTable: 'bonus_ledger';
    sourceId: string;
    documentType: 'bonus_redemption';
    redemptionId: string;
  };
}

/** Storage abstraction reused from BD-01 (bonus_settings read/write). */
export type RedemptionDeps = BonusEarnDeps;

// ── 1. Resolve the CURRENT live policy (fail-closed, no default) ────────────
/**
 * Reads `accounting_policy.BD-03` from settings and validates it against BD-03's
 * registered option set {A,B,C} (from `accountingPolicies.ts`).
 *
 * Throws `ACCOUNTING_POLICY_NOT_CONFIGURED` / `POLICY_INVALID` — the
 * caller decides how to surface it; this function NEVER substitutes a default option.
 *
 * Company note: `bonus_settings` carries NO `company_id` (0018 DDL; PHASE-49 §1.4),
 * so the read is global. Passing a `companyId` produces a `COMPANY_POLICY_ISOLATION_GAP`
 * diagnostic rather than a silent cross-company read — the verified ACC-10 gap.
 */
export async function resolveBonusRedemptionAccountingPolicy(
  deps: RedemptionDeps,
  companyId?: string | null,
): Promise<{ option: string; diagnostics: string[] }> {
  const raw = await deps.readSetting(BD03_POLICY_KEY);
  if (raw == null || raw === '') {
    throw new PolicyResolutionError(
      POLICY_NOT_CONFIGURED,
      'BD-03 is not configured; refusing to assume a policy.',
    );
  }
  const candidate = String(raw);
  if (!BD03_OPTIONS.includes(candidate)) {
    throw new PolicyResolutionError(
      POLICY_INVALID,
      `BD-03 option "${candidate}" is not one of the registered alternatives (${BD03_OPTIONS.join(', ') || 'none'}).`,
    );
  }
  const diagnostics: string[] = [];
  if (companyId) diagnostics.push(COMPANY_POLICY_ISOLATION_GAP); // bonus_redemptions has no company_id
  return { option: candidate, diagnostics };
}

// ── 2. Snapshot the policy in force for THIS redemption (history safety) ────
/**
 * Persists `accounting_policy.snapshot.<redemptionId>` = option via the existing
 * director-writable `bonus_settings` (no new table, no migration). Idempotent: if a
 * snapshot already exists for this redemption's TRUE identity it is left untouched,
 * so a later setting change can never rewrite a redemption's recorded policy.
 */
export async function snapshotRedemptionPolicy(
  redemptionId: string,
  option: string,
  deps: RedemptionDeps,
): Promise<{ written: boolean }> {
  const key = `${BD03_SNAPSHOT_PREFIX}${redemptionId}`;
  const existing = await deps.readSetting(key);
  if (existing != null) return { written: false };
  await deps.upsertSetting(key, option);
  return { written: true };
}

/** Which BD-03 option was in force when this redemption was fulfilled. */
export async function getHistoricalRedemptionPolicy(
  redemptionId: string,
  deps: RedemptionDeps,
): Promise<{ option: string | null; source: 'snapshot' | 'none' }> {
  const raw = await deps.readSetting(`${BD03_SNAPSHOT_PREFIX}${redemptionId}`);
  if (raw == null) return { option: null, source: 'none' };
  const opt = String(raw);
  return { option: BD03_OPTIONS.includes(opt) ? opt : null, source: 'snapshot' };
}

// ── 3. Dispatch A / B / C for this redemption (fail-closed, no journal) ──────
/**
 * Resolve the current BD-03 policy, snapshot it for THIS redemption, and return the
 * concrete accounting effect. Does NOT mutate bonus_ledger (the REDEEM_PRODUCT row is
 * flipped server-side by `fulfill_redemption`); does NOT create journal entries
 * (`create_financial_journal_entry` / `post_financial_journal_entry` are not called).
 *
 * Per-option, grounded in PHASE-49 §11.5 (V-1/V-2/V-3) + ACC-03 + the registry:
 *   A (sale price):       DR 5000 / CR 1140 at unit_price (= bonus_value, 0018:835).
 *                         unit_price is a SALE price, not a cost (0009:197-198 already
 *                         misuses it as unit_cost) -> INVENTORY_VALUATION_REQUIRED.
 *   B (product cost):     DR 5000 / CR 1140 at real product cost. NO cost column exists
 *                         (0002:19) -> COBS_BASIS_REQUIRED.
 *   C (rule value):       DR 5000 only at rule value (bonus_value/bonus_percent,
 *                         0019:353-375); no inventory offset + rule value is not a cost
 *                         -> INVENTORY_VALUATION_REQUIRED.
 *
 * The 1140/5000 accounts exist in the seeded COA (0007:47,53), so this is NOT an
 * account-mapping gap — the blocker is the valuation basis (ACC-03 / D4 NOT DECIDED,
 * PHASE-49 §13.1; DC-5 is a hard prerequisite before X2 is built). Each option
 * therefore `would_post` in INTENT but stays fail-closed (no journal fabricated).
 *
 * BD-08 timing is NOT consulted (separate policy); this engine is async only to leave
 * the seam for a future timing gate.
 *
 * Idempotency: the snapshot is keyed by the redemption's TRUE identity
 * (bonus_redemptions.id) and written once; re-dispatching the same redemption yields
 * alreadyHadPolicySnapshot=true and NO_DUPLICATE_EFFECT. The redemption-level
 * idempotency_key (0018:204) + fulfill_redemption's exactly-one-POSTED-flip guard
 * (931-937) make the fulfilment itself idempotent at the database level.
 */
export async function applyBonusRedemptionAccounting(
  ctx: RedemptionAccountingContext,
  deps: RedemptionDeps,
): Promise<BonusRedemptionDecision> {
  const { redemptionId, ledgerId, idempotencyKey } = ctx.identity;
  const effectKey = `bd03:redemption:${redemptionId}`;
  const sourceTrace = {
    sourceTable: 'bonus_ledger' as const,
    sourceId: ledgerId ?? redemptionId,
    documentType: 'bonus_redemption' as const,
    redemptionId,
  };

  // (1) Resolve current live policy — fail closed (no default).
  let option: string;
  let resolveDiagnostics: string[] = [];
  try {
    const resolved = await resolveBonusRedemptionAccountingPolicy(deps, ctx.companyId);
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

  // (2) Snapshot the policy in force for THIS redemption (idempotent, history-safe).
  const snap = await snapshotRedemptionPolicy(redemptionId, option, deps);

  // (3) Dispatch A / B / C. Inventory (1140) + COGS (5000) exist (0007:47,53); the
  //     gate is the valuation BASIS (ACC-03), never an assumed account code.
  const baseDiagnostics = [...resolveDiagnostics, ACCOUNTING_NOT_POSTED, BONUS_GL_ATOMICITY_GAP];

  if (option === 'A') {
    const intendedAccounts: RedemptionAccountRole[] = [
      { role: 'inventory' }, // 1140 (exists, 0007:47)
      { role: 'cost_of_goods_sold' }, // 5000 (exists, 0007:53)
    ];
    return {
      option,
      effect: {
        kind: 'would_post',
        intendedAccounts,
        code: INVENTORY_VALUATION_REQUIRED,
        reason:
          `${INVENTORY_VALUATION_REQUIRED}: BD-03 option A would stamp DR 5000 / CR 1140 ` +
          `at unit_price × qty — but unit_price is the catalogue SALE price (the ` +
          `redemption FACE VALUE, 0018:831/835), not a product cost. 0009:197-198 already ` +
          `misuses unit_price as unit_cost. The 1140/5000 accounts exist (0007:47,53) but ` +
          `the sale price is not a cost basis (PHASE-49 §11.5 V-1; ACC-03 / DC-5 not ` +
          `decided — §13.1 D4). No journal fabricated.`,
        basis: 'unit_price',
        basisGap:
          'Sale price is not a product cost; no reliable cost basis for the inventory/COGS leg (V-1/0009:197).',
      },
      journalEntryId: null,
      effectKey,
      alreadyHadPolicySnapshot: !snap.written,
      diagnostics: [...baseDiagnostics, INVENTORY_VALUATION_REQUIRED],
      sourceTrace,
    };
  }

  if (option === 'B') {
    const intendedAccounts: RedemptionAccountRole[] = [
      { role: 'inventory' }, // 1140 (exists)
      { role: 'cost_of_goods_sold' }, // 5000 (exists)
    ];
    return {
      option,
      effect: {
        kind: 'would_post',
        intendedAccounts,
        code: COBS_BASIS_REQUIRED,
        reason:
          `${COBS_BASIS_REQUIRED}: BD-03 option B requires the product's REAL cost to stamp ` +
          `DR 5000 / CR 1140, but the catalogue has NO cost column — products carries only ` +
          `unit_price (0002:19), a sale price, not a cost (PHASE-49 §11.5 V-2; X2). 1140/5000 ` +
          `exist (0007:47,53) but there is no cost figure to stamp them with. No journal ` +
          `fabricated.`,
        basis: 'product_cost',
        basisGap: 'No cost column on products (0002:19); X2 — cost basis cannot be determined (V-2).',
      },
      journalEntryId: null,
      effectKey,
      alreadyHadPolicySnapshot: !snap.written,
      diagnostics: [...baseDiagnostics, COBS_BASIS_REQUIRED],
      sourceTrace,
    };
  }

  if (option === 'C') {
    const intendedAccounts: RedemptionAccountRole[] = [
      { role: 'cost_of_goods_sold' }, // 5000 (exists); NO inventory offset
    ];
    return {
      option,
      effect: {
        kind: 'would_post',
        intendedAccounts,
        code: INVENTORY_VALUATION_REQUIRED,
        reason:
          `${INVENTORY_VALUATION_REQUIRED}: BD-03 option C would recognise 5000 at the ` +
          `rule-declared value (bonus_value/bonus_percent, 0019:353-375; PHASE-49 §11.5 V-3) ` +
          `— which is not a product cost — and C carries NO inventory offset (1140) to ` +
          `balance the COGS debit: an unbalanced, non-cost basis. 5000 exists (0007:53). ` +
          `No journal fabricated.`,
        basis: 'rule_value',
        basisGap:
          'Rule value is not a product cost and C has no inventory offset (V-3); unbalanced leg.',
      },
      journalEntryId: null,
      effectKey,
      alreadyHadPolicySnapshot: !snap.written,
      diagnostics: [...baseDiagnostics, INVENTORY_VALUATION_REQUIRED],
      sourceTrace,
    };
  }

  // Exhaustive over the registered option set. The resolver already guaranteed
  // option ∈ BD03_OPTIONS ({A,B,C}); this branch is unreachable defensive code.
  return {
    option,
    effect: {
      kind: 'fail_closed',
      code: POLICY_INVALID,
      reason: `${POLICY_INVALID}: BD-03 option "${option}" is registered but has no dispatch branch.`,
    },
    journalEntryId: null,
    effectKey,
    alreadyHadPolicySnapshot: !snap.written,
    diagnostics: [...baseDiagnostics, ACCOUNT_MAPPING_REQUIRED],
    sourceTrace,
  };
}
