/**
 * BD-10 — DORMANT INTEGRATION SEAM: `resolveBonusCompanyCoa`.
 *
 * This is the typed node where BD-01..BD-08 hand off to BD-10: given an event the engines have
 * already accounted for (BD-01..BD-07), timed (BD-08) and aggregated (BD-09), BD-10 decides the
 * COMPANY SCOPE + account-resolution mode for that event's eventual journal entry.
 *
 * BD-10 is the company-COA policy, NOT an event RPC — so (like BD-08/BD-09) it has no event seam
 * of its own (unlike BD-05/BD-06/BD-07, whose seams wrap `modify_order_item`, `expire_bonus`,
 * `reverse_bonus_txn`). This seam is the composition point: a future posting worker consults it
 * to resolve BD-10's `would_resolve` + infra diagnostics, replacing a bare COA_SCOPE_REQUIRED
 * diagnostic.
 *
 * ── Integration points (documented, NOT wired — directive §12) ─────────────────────
 * The posting worker (a future, separately-gated step — NOT BD-10, NOT any engine) would call
 * `resolveCompanyCoaForEvent({ ledgerId, eventType, accountingEffect, accountingCode, timing,
 * aggregation, companyId })` to obtain the BD-10 decision for the event it is about to (or would,
 * were the infra present) post. BD-01..BD-09 are NOT modified (verified by grep).
 *
 * BD-10 does NOT replace or redefine any engine's accounting/timing/aggregation policy
 * (directive §12): it only ADDS the company-scope + account-resolution dimension. BD-01..BD-07's
 * `no_entry` / `would_post` / `fail_closed` accounting results, BD-08's publish timing, and
 * BD-09's aggregation decision are passed through TOUCHED — including any
 * `ACCOUNT_MAPPING_REQUIRED` / `POSTING_INFRASTRUCTURE_REQUIRED` / `AGGREGATION_IDENTITY_REQUIRED`
 * fail_closed diagnostic, which BD-10 reproduces for the consumer rather than overriding
 * (directive §3/§5/§12). BD-10 is responsible for company scope + account resolution ONLY; it does
 * not create journals, change timing, or change aggregation.
 *
 * PURE composition: `composeCompanyCoaIntegration` lives in the PURE engine
 * (`bonusCompanyCoaPolicy.ts`) — not here — so the pass-through contract (BD-10 does NOT override
 * prior fail_closed — directive §3 test 9) is unit-testable under `node --experimental-strip-types`
 * with zero DB / zero Supabase. This seam re-exports it for consumers and wires the live
 * `resolveCompanyCoaForEvent` onto `applyBonusCompanyCoaPolicyLive`.
 *
 * DORMANT: not imported by BD-01..BD-09 (not modified) and not imported by any screen. Importing
 * this seam has no production accounting side-effect because:
 *   - the underlying engine never creates a journal (journalEntryId null on every path);
 *   - the `bonus_settings` policy read is director-writable via `for all` RLS but this seam only
 *     READS company-COA scope (it snapshots via the engine, which is itself idempotent / write-once);
 *   - the prior accounting/timing/aggregation decisions are echoed, not re-decided.
 *
 * ── Production Safety ────────────────────────────────────────────────────────────
 * NEVER calls `create_financial_journal_entry` / `post_financial_journal_entry`. NEVER creates
 * a journal entry. NEVER fabricates a company or account id. Delegates to
 * `applyBonusCompanyCoaPolicyLive`, which returns `posting.status: 'not_scoped'` with
 * `journalEntryId: null` by construction (directive §10).
 */

import { applyBonusCompanyCoaPolicyLive } from './bonusCompanyCoaPolicyLive.ts';
import {
  composeCompanyCoaIntegration,
  type CompanyCoaIntegrationResult,
  type EventAccountingEnvelope,
  type TimingDecisionEnvelope,
  type AggregationDecisionEnvelope,
  type CompanyCoaDecision,
  type CompanyCoaContext,
} from './bonusCompanyCoaPolicy.ts';

/** Re-export the PURE compose helper + envelope types so consumers import a single surface. */
export {
  composeCompanyCoaIntegration,
  type CompanyCoaIntegrationResult,
  type EventAccountingEnvelope,
  type TimingDecisionEnvelope,
  type AggregationDecisionEnvelope,
  type CompanyCoaDecision,
  type CompanyCoaContext,
};

/**
 * Dormant: resolve BD-10 company-COA scope for an event BD-01..BD-09 have already accounted,
 * timed and aggregated.
 *
 * The prior engines + BD-08 + BD-09 pass in their OWN decisions (which BD-10 does not override —
 * directive §3/§5/§12); BD-10 only resolves the company scope + account resolution. `eventType`
 * selects the BD-10 option set's semantic context (E1-E12); the option LETTER itself is still read
 * LIVE from `accounting_policy.BD-10` (directive §1) and validated against the registry
 * (directive §2/§3).
 */
export async function resolveCompanyCoaForEvent(
  accounting: EventAccountingEnvelope,
  timing: TimingDecisionEnvelope,
  aggregation: AggregationDecisionEnvelope,
): Promise<CompanyCoaIntegrationResult> {
  const ctx: CompanyCoaContext = {
    identity: { ledgerId: accounting.ledgerId },
    eventType: accounting.eventType,
    companyId: accounting.companyId,
  };
  const coa = await applyBonusCompanyCoaPolicyLive(ctx);
  return composeCompanyCoaIntegration(accounting, timing, aggregation, coa);
}
