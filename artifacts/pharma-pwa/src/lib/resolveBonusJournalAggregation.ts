/**
 * BD-09 — DORMANT INTEGRATION SEAM: `resolveBonusJournalAggregation`.
 *
 * This is the typed node where BD-01..BD-08 hand off to BD-09: given an event the engines have
 * already accounted for (BD-01..BD-07) and already timed (BD-08), BD-09 decides HOW the
 * posting effects of THAT event are aggregated into journal entries.
 *
 * BD-09 is the aggregation policy, NOT an event RPC — so (like BD-08) it has no event seam of
 * its own (unlike BD-05/BD-06/BD-07, whose seams wrap `modify_order_item`, `expire_bonus`,
 * `reverse_bonus_txn`). This seam is the composition point: a future posting worker consults it
 * on `would_post` (BD-01..BD-07) × resolved-timing (BD-08) to resolve BD-09's `would_aggregate`
 * + `POSTING_INFRASTRUCTURE_REQUIRED` diagnostic, replacing a bare AGGREGATION_POLICY_REQUIRED
 * diagnostic.
 *
 * ── Integration points (documented, NOT wired — directive §12) ─────────────────────
 * The posting worker (a future, separately-gated step — NOT BD-09, NOT any engine) would call
 * `resolveJournalAggregationForEvent({ ledgerId, eventType, accountingEffect, accountingCode,
 * timing, companyId })` to obtain the BD-09 aggregation decision for the event it is about to
 * (or would, were the infra present) post as a journal entry.
 *   - BD-01 (E1 server-side / E2 `earn_bonus`): eventType 'bonus_earn'.
 *   - BD-02 (redemption / E4/E5 `request_redemption`): eventType 'bonus_redemption'.
 *   - BD-05 (REFUND / E10 `modify_order_item('remove')`): eventType 'bonus_refund'.
 *   - BD-06 (EXPIRATION / E11 `expire_bonus`): eventType 'bonus_expiration'.
 *   - BD-07 (REVERSAL / E9/E10 `reverse_bonus_txn`): eventType 'bonus_reversal'.
 *
 * BD-09 does NOT replace or redefine any engine's accounting policy (directive §12): it only
 * ADDS the aggregation dimension. BD-01..BD-07's `no_entry` / `would_post` / `fail_closed`
 * accounting results are passed through untouched; BD-08's publish timing is passed through
 * untouched; BD-09 ONLY decides HOW that accounting would be aggregated into journal entries.
 * (directive §5: BD-09 does not override `ACCOUNT_MAPPING_REQUIRED`, source-trace gaps, company
 * isolation, or the timing decision from BD-08.)
 *
 * DORMANT: not imported by BD-01..BD-08 (which are NOT modified — verified by grep) and not
 * imported by any screen. Importing this seam has no production accounting side-effect because:
 *   - the underlying engine never creates a journal (journalEntryId null on every path);
 *   - the `bonus_settings` policy read is director-writable via `for all` RLS, but this seam only
 *     READS aggregation (it snapshots via the engine, which is itself idempotent / write-once).
 *
 * ── Production Safety ────────────────────────────────────────────────────────────
 * NEVER calls `create_financial_journal_entry` / `post_financial_journal_entry`. NEVER creates
 * a journal entry. Delegates to `applyBonusAggregationPolicyLive`, which returns
 * `posting.status: 'not_aggregated'` with `journalEntryId: null` by construction (directive §10).
 */

import { applyBonusAggregationPolicyLive } from './bonusAggregationPolicyLive.ts';
import type { JournalAggregationDecision, AggregationContext } from './bonusAggregationPolicy.ts';

/** The accounting decision BD-01..BD-07 have ALREADY made for this event — passed through verbatim. */
export interface EventAccountingEnvelope {
  /** `bonus_ledger.id` of the POSTED row (the TRUE event identity). */
  ledgerId: string;
  /** Event type label — the documentType BD-09 records in its source-trace. */
  eventType: string;
  /** The event engine's accounting effect (NOT modified by BD-09). */
  accountingEffect: 'no_entry' | 'would_post' | 'fail_closed';
  /** The event engine's accounting fail-closed code, if any (e.g. ACCOUNT_MAPPING_REQUIRED). */
  accountingCode?: string | null;
  /** Best-effort current financial company (C-3 single-company assumption). */
  companyId?: string | null;
}

/** The publish-timing decision BD-08 has ALREADY made for this event — passed through verbatim. */
export interface TimingDecisionEnvelope {
  /** BD-08 publish-timing intent the event was resolved under. */
  publishIntent: string;
  /** BD-08 journal creation status — should be 'not_posted' (timing-only). */
  postingStatus: string;
}

/**
 * How BD-09's aggregation layers onto the event engine's accounting + BD-08's timing decisions.
 * Both are passed through unchanged; only the journal-entry aggregation is resolved.
 */
export interface AggregationIntegrationResult {
  accounting: EventAccountingEnvelope;
  timing: TimingDecisionEnvelope;
  aggregation: JournalAggregationDecision;
  composed: {
    /** BD-09's resolved aggregation mode (one_per_event / draft_per_event_then_batch_review / periodic_netting; null on fail_closed). */
    aggregationMode: string | null;
    /** Journal creation is ALWAYS deferred — BD-09 owns aggregation only (directive §10). */
    postingStatus: 'not_aggregated';
    /** Why journals are not created by BD-09. */
    reason: string;
    /** The accounting effect BD-01..BD-07 decided (passed through, not overridden). */
    accountingEffect: EventAccountingEnvelope['accountingEffect'];
  };
}

/**
 * Dormant: resolve BD-09 journal-entry aggregation for an event BD-01..BD-07 have already
 * accounted for and BD-08 has already timed.
 *
 * The event engine + BD-08 pass in their OWN accounting + timing decisions (which BD-09 does not
 * override — directive §5/§12); BD-09 only resolves HOW that accounting would be aggregated into
 * journal entries. `eventType` selects the BD-09 option set's semantic context (E1-E12); the
 * option LETTER itself is still read LIVE from `accounting_policy.BD-09` (directive §1) and
 * validated against the registry (directive §2/§3).
 */
export async function resolveJournalAggregationForEvent(
  envelope: EventAccountingEnvelope,
  timing?: TimingDecisionEnvelope,
): Promise<AggregationIntegrationResult> {
  const ctx: AggregationContext = {
    identity: { ledgerId: envelope.ledgerId },
    eventType: envelope.eventType,
    companyId: envelope.companyId,
  };
  const aggregation = await applyBonusAggregationPolicyLive(ctx);
  return {
    accounting: envelope,
    timing: timing ?? { publishIntent: 'none', postingStatus: 'not_posted' },
    aggregation,
    composed: {
      aggregationMode:
        aggregation.effect.kind === 'would_aggregate' ? aggregation.effect.mode : null,
      postingStatus: 'not_aggregated',
      reason:
        'Journal entry creation is a downstream, separately-gated posting step — BD-09 resolves ' +
        'only the aggregation of journal entries and never creates one (directive §10).',
      accountingEffect: envelope.accountingEffect,
    },
  };
}

/** Re-export the decision/contract types so consumers import a single surface. */
export type { JournalAggregationDecision, AggregationContext } from './bonusAggregationPolicy.ts';
