/**
 * BD-09 engine — LIVE wiring (Supabase-backed).
 *
 * Bridges the pure resolver/dispatcher (`bonusAggregationPolicy.ts`) to the real
 * `bonus_settings` table so the director's BD-09 choice (`accounting_policy.BD-09`) is read at
 * AGGREGATION-resolution time — i.e. at the moment the BD-08 publish-timing decision is handed to
 * a future posting worker, which consults BD-09 on its would_aggregate path to resolve HOW the
 * journal entries should be grouped.
 *
 * The pure engine imports no Supabase; this module owns the client initialisation, mirroring
 * BD-01/BD-08.
 *
 * Reuses the BD-01 live helpers verbatim (`defaultBonusEarnDeps`, `readCurrentCompanyId`) —
 * the bonus sub-ledger (`bonus_ledger`, `bonus_settings`) has no `company_id` (0018:50-114,
 * 0018:80-86), so the same C-3 single-company resolution (`financial_companies order by
 * created_at limit 1`, 0009:57-60) + ACC-10 isolation gap applies unchanged. The policy read is
 * global; the resolved company is re-emitted as a COMPANY_POLICY_ISOLATION_GAP diagnostic
 * (ACC-10) rather than a silent cross-company fallback.
 *
 * DORMANT wiring surface: this is imported only by the dormant BD-09 integration seam
 * (`resolveBonusJournalAggregation.ts`), which itself is not imported by any engine or screen, so
 * there is no behaviour change to any aggregation path until a policy is deliberately wired.
 *
 * ── Production Safety ────────────────────────────────────────────────────────────
 * NEVER calls `create_financial_journal_entry` / `post_financial_journal_entry`. The engine
 * never opens a journal path: `journalEntryId` is null on every code path (BD-09 owns journal
 * ENTRY aggregation only; journal creation is a downstream, separately-gated step — directive §10).
 * Reuses the BD-01 shared sentinels; BD-09-local sentinels (POSTING_INFRASTRUCTURE_REQUIRED,
 * AGGREGATION_IDENTITY_REQUIRED) are additive and defined in the pure engine.
 */

import { applyBonusAggregationPolicy } from './bonusAggregationPolicy.ts';
import {
  defaultBonusEarnDeps,
  readCurrentCompanyId,
} from './bonusAccountingPolicyLive.ts';
import type { AggregationDeps, AggregationContext, JournalAggregationDecision } from './bonusAggregationPolicy.ts';

/** BD-09 deps = the BD-01 bonus_settings read/write (no new table, no migration). */
export function defaultAggregationDeps(): AggregationDeps {
  return defaultBonusEarnDeps();
}

/**
 * DB-backed convenience: run the BD-09 engine against real `bonus_settings`, reading the
 * current financial company via the C-3 single-company assumption (`financial_companies order by
 * created_at limit 1`, 0009:57-60). The company id is re-emitted as a
 * COMPANY_POLICY_ISOLATION_GAP diagnostic (ACC-10) because `bonus_settings` / `bonus_ledger`
 * carry NO `company_id` (PHASE-49 §1.4).
 */
export async function applyBonusAggregationPolicyLive(
  ctx: AggregationContext,
): Promise<JournalAggregationDecision> {
  const deps = defaultAggregationDeps();
  const resolvedCompany = ctx.companyId ?? (await readCurrentCompanyId());
  return applyBonusAggregationPolicy(
    { ...ctx, companyId: resolvedCompany ?? ctx.companyId ?? null },
    deps,
  );
}
