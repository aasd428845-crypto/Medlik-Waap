import { supabase } from '@/lib/supabaseClient';

export interface FinancialSummary {
  accounts: number;
  postedEntries: number;
  draftEntries: number;
  cashAccounts: number;
  bankAccounts: number;
  receivables: number;
  receivableBalance: number;
}

export interface JournalRow {
  id: string;
  entry_number: number;
  entry_date: string;
  description: string;
  status: string;
}

export async function getFinancialSummary(): Promise<FinancialSummary> {
  const [accounts, posted, drafts, cash, banks, receivables] = await Promise.all([
    supabase.from('financial_accounts').select('id', { count: 'exact', head: true }),
    supabase.from('financial_journal_entries').select('id', { count: 'exact', head: true }).eq('status', 'posted'),
    supabase.from('financial_journal_entries').select('id', { count: 'exact', head: true }).eq('status', 'draft'),
    supabase.from('financial_cash_accounts').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('financial_bank_accounts').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('users').select('current_balance').eq('role', 'client'),
  ]);

  const firstError = [accounts, posted, drafts, cash, banks, receivables].find((r) => r.error)?.error;
  if (firstError) throw new Error(firstError.message);

  const receivableBalance = (receivables.data ?? []).reduce((sum, row) => sum + Number((row as { current_balance?: unknown }).current_balance ?? 0), 0);
  return {
    accounts: accounts.count ?? 0,
    postedEntries: posted.count ?? 0,
    draftEntries: drafts.count ?? 0,
    cashAccounts: cash.count ?? 0,
    bankAccounts: banks.count ?? 0,
    receivables: receivables.data?.length ?? 0,
    receivableBalance,
  };
}

export async function listRecentJournalEntries(): Promise<JournalRow[]> {
  const { data, error } = await supabase
    .from('financial_journal_entries')
    .select('id, entry_number, entry_date, description, status')
    .order('created_at', { ascending: false })
    .limit(12);
  if (error) throw new Error(error.message);
  return (data ?? []) as JournalRow[];
}
