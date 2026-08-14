-- =============================================================
-- Migration 0013 — ربط الذمم الدائنة
-- =============================================================

do $$
declare
  v_company_id uuid;
  v_payable_account uuid;
begin
  select id into v_company_id from public.financial_companies order by created_at limit 1;
  select id into v_payable_account from public.financial_accounts where company_id=v_company_id and code='2110' limit 1;

  if v_company_id is not null and v_payable_account is not null then
    update public.financial_account_mappings
       set payable_account_id=v_payable_account,
           updated_at=now()
     where company_id=v_company_id
       and payable_account_id is null;
  end if;
end $$;
