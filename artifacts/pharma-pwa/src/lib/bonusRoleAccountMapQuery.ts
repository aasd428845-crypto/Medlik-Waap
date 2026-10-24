/*
 * PostgREST embed shape for bonus_role_account_map → financial_accounts.
 *
 * REGRESSION GUARD (PGRST201 — duplicate FK): 0029 defines the FK on
 * `account_id` twice — inline `references public.financial_accounts(id)`
 * in CREATE TABLE (auto-named `bonus_role_account_map_account_id_fkey`)
 * AND the explicit `bonus_role_account_map_account_fk` added by
 * ALTER TABLE. With two relationships between the same pair of tables,
 * an un-hinted embed fails with:
 *
 *   "Could not embed because more than one relationship was found for
 *    'bonus_role_account_map' and 'financial_accounts'"
 *
 * Every embed MUST therefore pin the explicitly-named constraint below.
 * The constraint name is fixed by 0029 (migration files are never
 * modified), so a constant here is stable. Disambiguating in the query
 * keeps the fix UI-only — no new migration.
 */

/** The named FK constraint from 0029 ALTER TABLE (stable, never renamed). */
export const ROLE_ACCOUNT_MAP_FK_CONSTRAINT = 'bonus_role_account_map_account_fk';

/**
 * Hinted inner embed returning only the display columns (code, name).
 * The response payload key stays `financial_accounts` — the `!constraint`
 * hint disambiguates the relationship without aliasing the output.
 */
export const ROLE_ACCOUNT_MAP_EMBED = `financial_accounts!${ROLE_ACCOUNT_MAP_FK_CONSTRAINT}!inner(code, name)`;
