/**
 * BD-08 — DORMANT INTEGRATION SEAM (the "shared timing contract", directive §12).
 *
 * BD-08 is a consultable publish-timing policy, NOT an event RPC — so it has no event seam
 * of its own (unlike BD-05/BD-06/BD-07, whose seams wrap `modify_order_item`, `expire_bonus`,
 * `reverse_bonus_txn`). Instead, BD-01..BD-07 each emit a `TIMING_POLICY_REQUIRED` diagnostic
 * on their would_post intent path; THIS seam is the typed node they would consult to resolve
 * that timing into a concrete `PublishTimingDecision`.
 *
 * ── Integration points (documented, NOT wired — directive §12) ─────────────────────
 *   - BD-01 (E1 server-side / E2 `earn_bonus`): on its would_post intent (options A/B), the
 *     earn engine would call `resolvePublishTimingForEvent({ledgerId, eventType:'bonus_earn',
 *     accountingEffect:'would_post', accountingCode: ACCOUNT_MAPPING_REQUIRED})` to resolve
 *     the publish timing, replacing the bare TIMING_POLICY_REQUIRED diagnostic.
 *   - BD-02 (redemption / E4/E5 `request_redemption`): same pattern at eventType 'bonus_redemption'.
 *   - BD-05 (REFUND / E10 `modify_order_item('remove')`): eventType 'bonus_refund'.
 *   - BD-06 (EXPIRATION / E11 `expire_bonus`): eventType 'bonus_expiration'.
 *   - BD-07 (REVERSAL / E9/E10 `reverse_bonus_txn`): eventType 'bonus_reversal'.
 *
 * The seam does NOT replace or redefine any engine's accounting policy (directive §12): it only
 * ADDS the timing dimension. BD-01..BD-07's `no_entry` / `would_post` / `fail_closed` accounting
 * results are passed through untouched; BD-08 only decides WHEN that accounting would be
 * published. (In a future phase, the resolved timing + the engine's accounting effect would be
 * handed to a dedicated posting worker — never to BD-08, never to BD-01..BD-07.)
 *
 * DORMANT: not imported by BD-01..BD-07 (which are NOT modified — verified by grep), and not
 * imported by any screen. Importing this seam has no production accounting side-effect because:
 *   - the underlying engine never creates a journal (journalEntryId null on every path);
 *   - the `bonuse_settings` policy read is director-writable via `for all` RLS but this seam
 *     only READS timing (it snapshots via the engine, which is itself idempotent / write-once).
 *
 * ── Production Safety ────────────────────────────────────────────────────────────
 * NEVER calls `create_financial_journal_entry` / `post_financial_journal_entry`. NEVER creates
 * a journal entry. Delegates to `applyBonusTimingPolicyLive`, which returns
 * `posting.status: 'not_posted'` with `journalEntryId: null` by construction.
 */

import { applyBonusTimingPolicyLive } from './bonusTimingPolicyLive.ts';
import type { PublishTimingDecision, TimingContext } from './bonusTimingPolicy.ts';

/** The accounting decision BD-01..BD-07 have already made for this event — passed through verbatim. */
export interface EventAccountingEnvelope {
  /** `bonus_ledger.id` of the POSTED row (the TRUE event identity). */
  ledgerId: string;
  /** Event type label — the documentType BD-08 records in its source-trace. */
  eventType: string;
  /** The event engine's accounting effect (NOT modified by BD-08). */
  accountingEffect: 'no_entry' | 'would_post' | 'fail_closed';
  /** The event engine's accounting fail-closed code, if any (e.g. ACCOUNT_MAPPING_REQUIRED). */
  accountingCode?: string | null;
  /** Best-effort current financial company (C-3 single-company assumption). */
  companyId?: string | null;
}

/**
 * How BD-08's timing layers onto the event engine's accounting decision. The accounting
 * effect is passed through unchanged; only the publish timing is resolved.
 */
export interface TimingIntegrationResult {
  accounting: EventAccountingEnvelope;
  timing: PublishTimingDecision;
  composed: {
    /** BD-08's resolved publish-timing intent (immediate / draft_then_approval / periodic_batch). */
    publishIntent: string;
    /** Journal creation is ALWAYS deferred — BD-08 owns timing only (directive §10). */
    postingStatus: 'not_posted';
    /** Why posting is deferred to a future, separately-gated step. */
    reason: string;
  };
}

/**
 * Dormant: resolve BD-08 publish timing for an event BD-01..BD-07 has just accounted for.
 *
 * The event engine passes its OWN accounting decision (which BD-08 does not override — directive
 * §12); BD-08 only resolves the WHEN/HOW of publishing that accounting. `eventType` selects the
 * BD-08 option set's semantic context (E1-E12); the option LETTER itself is still read LIVE
 * from `accounting_policy.BD-08` (directive §1) and validated against the registry (directive
 * §2/§3).
 */
export async function resolvePublishTimingForEvent(
  envelope: EventAccountingEnvelope,
): Promise<TimingIntegrationResult> {
  const ctx: TimingContext = {
    identity: { ledgerId: envelope.ledgerId },
    eventType: envelope.eventType,
    companyId: envelope.companyId,
  };
  const timing = await applyBonusTimingPolicyLive(ctx);
  return {
    accounting: envelope,
    timing,
    composed: {
      publishIntent: timing.publishTiming.intent ?? 'none',
      postingStatus: 'not_posted',
      reason:
        'Journal creation is a downstream, separately-gated posting step — BD-08 resolves only ' +
        'publish timing and never creates a journal (directive §10).',
    },
  };
}

/** Re-export the decision type so consumers import a single contract surface. */
export type { PublishTimingDecision, TimingContext } from './bonusTimingPolicy.ts';
