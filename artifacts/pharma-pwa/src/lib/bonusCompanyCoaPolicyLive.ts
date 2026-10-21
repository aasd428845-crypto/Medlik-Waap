/**
 * BD-10 engine — LIVE wiring (Supabase-backed).
 *
 * Bridges the pure resolver/dispatcher (`bonusCompanyCoaPolicy.ts`) to the real `bonus_settings`
 * table so the director's BD-10 choice (`accounting_policy.BD-10`) is read at COMPANY-COA-
 * resolution time — i.e. when a future posting worker, having taken BD-01..BD-07 accounting +
 * BD-08 timing + BD-09 aggregation, consults BD-10 to resolve HOW the event is scoped to a
 * company + COA before (were the infra present) emitting a journal line.
 *
 * The pure engine imports no Supabase; this module owns the client initialisation, mirroring
 * BD-01/BD-08/BD-09.
 *
 * Reuses the BD-01 live helpers verbatim (`defaultBonusEarnDeps`, `readCurrentCompanyId`) —
 * the bonus sub-ledger (`bonus_ledger`, `bonus_settings`) has no `company_id` (0018:50-114,
 * 0018:285-287), so the same C-3 single-company resolution (`financial_companies order by
 * created_at limit 1`, 0009:57-60, seeded single company 'MedLink' 0007:12-13) + ACC-10 isolation
 * gap applies unchanged. The policy read is global; the resolved company is re-emitted as a
 * COMPANY_POLICY_ISOLATION_GAP diagnostic (ACC-10) rather than a silent cross-company fallback.
 *
 * DORMANT wiring surface: this is imported only by the dormant BD-10 integration seam
 * (`resolveBonusCompanyCoaForEvent`), which itself is not imported by any engine or screen, so
 * there is no behaviour change to any company-COA path until a policy is deliberately wired.
 *
 * ── Production Safety ────────────────────────────────────────────────────────────
 * NEVER calls `create_financial_journal_entry` / `post_financial_journal_entry`. The engine
 * never opens a journal path: `journalEntryId` is null on every code path (BD-10 owns company
 * scope + account resolution ONLY; journal creation is a downstream, separately-gated step —
 * directive §10). Never fabricates a company or account id (directive §3 test 6/7).
 */

import { applyBonusCompanyCoaPolicy } from './bonusCompanyCoaPolicy.ts';
import {
  defaultBonusEarnDeps,
  readCurrentCompanyId,
} from './bonusAccountingPolicyLive.ts';
import type { CoaDeps, CompanyCoaContext, CompanyCoaDecision } from './bonusCompanyCoaPolicy.ts';

/** BD-10 deps = the BD-01 bonus_settings read/write (no new table, no migration). */
export function defaultCompanyCoaDeps(): CoaDeps {
  return defaultBonusEarnDeps();
}

/**
 * DB-backed convenience: run the BD-10 engine against real `bonus_settings`, reading the current
 * financial company via the C-3 single-company assumption (`financial_companies order by
 * created_at limit 1`, 0009:57-60; seeded single company 'MedLink', 0007:12-13). The company id
 * is re-emitted as a COMPANY_POLICY_ISOLATION_GAP diagnostic (ACC-10) because `bonus_settings`
 * / `bonus_ledger` carry NO `company_id` (PHASE-49 §1.4). For option A this is the resolution
 * mechanism (passed through to the decision's `resolvedCompanyId`); for B/C it cannot resolve a
 * company (no company column / branch→company map) — BD-10 never defaults one (directive §3
 * test 6).
 */
export async function applyBonusCompanyCoaPolicyLive(
  ctx: CompanyCoaContext,
): Promise<CompanyCoaDecision> {
  const deps = defaultCompanyCoaDeps();
  const resolvedCompany = ctx.companyId ?? (await readCurrentCompanyId());
  return applyBonusCompanyCoaPolicy(
    { ...ctx, companyId: resolvedCompany ?? ctx.companyId ?? null },
    deps,
  );
}
