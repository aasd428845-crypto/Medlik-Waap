import { supabase } from '@/lib/supabaseClient';

// Client financial row as stored in public.users (snake_case).
export interface ClientReceivable {
  id: string;
  name: string | null;
  org_name: string | null;
  phone: string | null;
  governorate: string | null;
  account_status: string | null;
  credit_limit: number;
  current_balance: number;
  used_ratio: number; // current_balance / credit_limit (∞ = بلا حد ورصيد دائن)
  exceeded: boolean; // تجاوز 90% من الحد أو تجاوزه فعلياً
}

export function computeReceivable(row: {
  credit_limit?: unknown;
  current_balance?: unknown;
}): { credit_limit: number; current_balance: number; used_ratio: number; exceeded: boolean } {
  const limit = Number(row.credit_limit || 0);
  const balance = Number(row.current_balance || 0);
  let used = 0;
  if (limit > 0) {
    used = balance / limit;
  } else if (balance > 0) {
    used = Number.POSITIVE_INFINITY;
  }
  const exceeded =
    balance > limit || (limit > 0 && used >= 0.9);
  return { credit_limit: limit, current_balance: balance, used_ratio: used, exceeded };
}

export function formatRatio(ratio: number): string {
  if (Number.isFinite(ratio)) return `${Math.round(ratio * 100)}%`;
  return '∞';
}

export async function listReceivables(): Promise<ClientReceivable[]> {
  const { data, error } = await supabase
    .from('users')
    .select(
      'id, name, org_name, phone, governorate, account_status, credit_limit, current_balance',
    )
    .eq('role', 'client')
    .order('current_balance', { ascending: false });
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const fin = computeReceivable(row);
    return {
      id: row.id as string,
      name: (row.name as string) ?? null,
      org_name: (row.org_name as string) ?? null,
      phone: (row.phone as string) ?? null,
      governorate: (row.governorate as string) ?? null,
      account_status: (row.account_status as string) ?? null,
      ...fin,
    };
  });
}

// ── سجل فواتير عميل ─────────────────────────────────────────────
export interface InvoiceRecord {
  id: string;
  amount: number;
  status: string; // pending | paid | cancelled
  due_date: string | null;
  paid_at: string | null;
  created_at: string;
  computed_status: 'paid' | 'overdue' | 'pending';
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function listClientInvoices(clientId: string): Promise<InvoiceRecord[]> {
  const { data, error } = await supabase
    .from('invoices')
    .select('id, amount, status, due_date, paid_at, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);

  const today = todayStr();
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const status = (row.status as string) ?? 'pending';
    const due = (row.due_date as string) ?? null;
    let computed: InvoiceRecord['computed_status'];
    if (status === 'paid') computed = 'paid';
    else if (due && String(due).slice(0, 10) < today) computed = 'overdue';
    else computed = 'pending';
    return {
      id: row.id as string,
      amount: (row.amount as number) ?? 0,
      status,
      due_date: due,
      paid_at: (row.paid_at as string) ?? null,
      created_at: (row.created_at as string) ?? '',
      computed_status: computed,
    };
  });
}

export async function setInvoicePaid(invoiceId: string): Promise<void> {
  const { error } = await supabase
    .from('invoices')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq('id', invoiceId);
  if (error) throw new Error(error.message);
}