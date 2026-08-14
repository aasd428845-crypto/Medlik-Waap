-- 0013 — حماية السجل المالي وإغلاق الفترات

create or replace function public.prevent_posted_journal_mutation()
returns trigger language plpgsql as $$
begin
  if old.status='posted' then raise exception 'Posted journal entries are immutable; create a reversal/correction entry instead'; end if;
  return old;
end $$;

drop trigger if exists trg_block_posted_journal_update on public.financial_journal_entries;
create trigger trg_block_posted_journal_update before update or delete on public.financial_journal_entries for each row execute function public.prevent_posted_journal_mutation();

drop trigger if exists trg_block_posted_journal_line_update on public.financial_journal_lines;
create trigger trg_block_posted_journal_line_update before update or delete on public.financial_journal_lines for each row execute function public.prevent_posted_journal_line_mutation();

create or replace function public.prevent_posted_journal_line_mutation()
returns trigger language plpgsql as $$
declare v_status text;
begin
 select status into v_status from public.financial_journal_entries where id=old.journal_entry_id;
 if v_status='posted' then raise exception 'Posted journal lines are immutable'; end if;
 return old;
end $$;

-- إعادة إنشاء trigger بعد تعريف الدالة.
drop trigger if exists trg_block_posted_journal_line_update on public.financial_journal_lines;
create trigger trg_block_posted_journal_line_update before update or delete on public.financial_journal_lines for each row execute function public.prevent_posted_journal_line_mutation();

create or replace function public.close_financial_period(p_period_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_status text; v_open_entries integer;
begin
 if public.current_user_role()<>'company_director' then raise exception 'Only company director can close a financial period'; end if;
 select status into v_status from public.financial_periods where id=p_period_id for update;
 if not found then raise exception 'Period not found'; end if;
 if v_status='closed' then return; end if;
 select count(*) into v_open_entries from public.financial_journal_entries where fiscal_period_id=p_period_id and status='draft';
 if v_open_entries>0 then raise exception 'Cannot close period while draft journal entries exist'; end if;
 update public.financial_periods set status='closed' where id=p_period_id;
end $$;
revoke all on function public.close_financial_period(uuid) from public;
