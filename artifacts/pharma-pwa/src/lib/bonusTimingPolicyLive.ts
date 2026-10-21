/**
 * BD-08 engine — LIVE wiring (Supabase-backed).
 *
 * Bridges the pure resolver/dispatcher (`bonusTimingPolicy.ts`) to the real `bonus_settings`
 * table so the director's BD-08 choice (`accounting_policy.BD-08`) is read at TIMING-resolution
 * time — i.e. at the moment BD-01..BD-07 consult BD-08 on their would_post path to resolve the
 * `TIMING_POLICY_REQUIRED` diagnostic.
 *
 * The pure engine imports no Supabase; this module owns the client initialisation, mirroring
 * BD-01/BD-07.
 *
 * Reuses the BD-01 live helpers verbatim (`defaultBonusEarnDeps`, `readCurrentCompanyId`) —
 * the bonus sub-ledger (`bonus_ledger`, `bonus_settings`) has no `company_id` (0018:50-114,
 * 0018:80-86), so the same C-3 single-company resolution (`financial_companies order by
 * created_at limit 1`, 0009:57-60) + ACC-10 isolation gap applies unchanged. The policy read is
 * global; the resolved company is re-emitted as a COMPANY_POLICY_ISOLATION_GAP diagnostic
 * (ACC-10) rather than a silent cross-company fallback.
 *
 * DORMANT wiring surface: this is imported only by the dormant BD-08 integration seam
 * (`resolveBonusPublishTiming.ts`), which itself is not imported by any engine or screen, so
 * there is no behaviour change to any publish path until a policy is deliberately wired.
 *
 * ── Production Safety ────────────────────────────────────────────────────────────
 * NEVER calls `create_financial_journal_entry` / `post_financial_journal_entry`. The engine
 * never opens a journal path: `journalEntryId` is null on every code path (BD-08 owns publish
 * *timing* only; journal creation is a downstream, separately-gated step — directive §10).
 */

import { applyBonusTimingPolicy } from './bonusTimingPolicy.ts';
import {
  defaultBonusEarnDeps,
  readCurrentCompanyId,
} from './bonusAccountingPolicyLive.ts';
import type { TimingDeps, TimingContext, PublishTimingDecision } from './bonusTimingPolicy.ts';

/** BD-08 deps = the BD-01 bonus_settings read/write (no new table, no migration). */
export function defaultTimingDeps(): TimingDeps {
  return defaultBonusEarnDeps();
}

/**
 * DB-backed convenience: run the BD-08 engine against real `bonus_settings`, reading the
 * current financial company via the C-3 single-company assumption (`financial_companies order
 * by created_at limit 1`, 0009:57-60). The company id is re-emitted as a
 * COMPANY_POLICY_ISOLATION_GAP diagnostic (ACC-10) because `bonus_settings` / `bonus_ledger`
 * carry NO `company_id` (PHASE-49 §1.4).
 */
export async function applyBonusTimingPolicyLive(
  ctx: TimingContext,
): Promise<PublishTimingDecision> {
  const deps = defaultTimingDeps();
  const resolvedCompany = ctx.companyId ?? (await readCurrentCompanyId());
  return applyBonusTimingPolicy(
    { ...ctx, companyId: resolvedCompany ?? ctx.companyId ?? null },
    deps,
  );
}
