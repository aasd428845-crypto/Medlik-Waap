-- =============================================================
-- Migration 0017 — Bonus-liability GL account (حساب التزام البونص)
-- PHASE 1 — Bonus Earn (E1) → General Ledger accounting integration.
--
-- WHY (evidence: Accounting Integration Gap Audit; the BD-01 accounting-policy
-- registry in artifacts/pharma-pwa/src/lib/accountingPolicies.ts; seeded COA
-- in 0007_financial_setup_rls.sql:38-59):
--
--   BD-01 Option A recognises a bonus earn at grant by accruing a DEFERRED BONUS
--   LIABILITY (DR expense / CR liability). The seeded chart of accounts (0007)
--   carries NO 2xxx bonus-liability account, so Option A previously failed
--   closed with ACCOUNT_MAPPING_REQUIRED. The Phase-1 integrity rules (§5)
--   authorise exactly ONE schema prerequisite: a bonus-liability GL account under
--   the 2000/2100 liability branch. This migration introduces that single account.
--
-- SCOPE (minimal, additive, backward-compatible):
--   * one new row in public.financial_accounts (code 2110, level 3 under the
--     liability branch, credit-normal, postable).
--   * mirrors the 0007 seed mechanism VERBATIM: idempotent `not exists` guard,
--     company-scoped via a financial_companies cross join, no parent_id (same
--     shape as the 1110/1120/1130/2100 seeds).
--   * NO new table / column / trigger / policy / RLS change. The bonus tables keep
--     no company_id (ACC-10 is surfaced as a COMPANY_POLICY_ISOLATION_GAP
--     diagnostic, not papered over).
--   * idempotent and safe to re-run (no-op if 2110 already exists).
--
-- NO database, schema, or data change to any other object.
-- =============================================================
insert into public.financial_accounts
  (company_id, code, name, account_type, level, is_postable, normal_balance)
select c.id, x.code, x.name, x.t, x.level, x.postable, x.balance
from public.financial_companies c
cross join (values
  ('2110', 'التزام البونص المستقبلي', 'liability', 3, true, 'credit')
) x (code, name, t, level, postable, balance)
where not exists (
  select 1 from public.financial_accounts a
  where a.company_id = c.id and a.code = x.code
);
