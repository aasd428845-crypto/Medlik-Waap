/**
 * BD-06 engine — LIVE wiring (Supabase-backed).
 *
 * Bridges the pure resolver/dispatcher (`bonusExpirationAccountingPolicy.ts`) to
 * the real `bonus_settings` table so the director's BD-06 choice
 * (`accounting_policy.BD-06`) is read at EXPIRATION time. The pure engine imports
 * no Supabase; this module owns the client initialisation, mirroring BD-01/BD-04.
 *
 * Reuses the BD-01 live helpers verbatim (`defaultBonusEarnDeps`,
 * `readCurrentCompanyId`) — the bonus sub-ledger has no company concept, so the
 * same C-3 single-company resolution + ACC-10 gap diagnostic applies unchanged.
 */

import { applyBonusExpirationAccounting } from './bonusExpirationAccountingPolicy.ts';
import {
  defaultBonusEarnDeps,
  readCurrentCompanyId,
} from './bonusAccountingPolicyLive.ts';
import type {
  ExpirationDeps,
  ExpirationAccountingContext,
  ExpirationDecision,
} from './bonusExpirationAccountingPolicy.ts';

/** BD-06 deps = the BD-01 bonus_settings read/write (no new table, no migration). */
export function defaultExpirationDeps(): ExpirationDeps {
  return defaultBonusEarnDeps();
}

/**
 * DB-backed convenience: run the BD-06 engine against real `bonus_settings`,
 * resolving the current financial company via the C-3 single-company assumption
 * (`financial_companies order by created_at limit 1`, 0009). The company id is
 * re-emitted as a `COMPANY_POLICY_ISOLATION_GAP` diagnostic because
 * `bonus_settings` (and `bonus_ledger`) carry NO `company_id` — ACC-10.
 */
export async function applyBonusExpirationAccountingLive(
  ctx: ExpirationAccountingContext,
): Promise<ExpirationDecision> {
  const deps = defaultExpirationDeps();
  const resolvedCompany = ctx.companyId ?? (await readCurrentCompanyId());
  return applyBonusExpirationAccounting(
    { ...ctx, companyId: resolvedCompany ?? ctx.companyId ?? null },
    deps,
  );
}
