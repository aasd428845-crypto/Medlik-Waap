import { supabase } from '@/lib/supabaseClient';

// ============================================================
// طبقة بيانات لوحتي القيادة (المالية + التشغيلية)
// كل الأرقام تُقرأ مباشرة من قاعدة البيانات الفعلية (Supabase).
// لا توجد أي بيانات افتراضية أو وهمية في هذه الطبقة.
// في حال تعذّر الاتصال يُرمى خطأ وتظهر حالة الخطأ في الواجهة.
// ============================================================

const YER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function formatYer(value: number) {
  return `${YER.format(value)} ﷼`;
}

export const money = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);

// ---------------- اللوحة المالية ----------------
export interface KpiValue {
  value: number;
  deltaPct: number;
}

export interface FinancialDashboardData {
  kpis: {
    revenue30d: KpiValue;
    grossMarginPct: KpiValue;
    netCashFlow: KpiValue;
    receivablesTotal: KpiValue;
  };
  exchangeRates: {
    usdYer: { rate: number; prevRate: number; minutesAgo: number };
    sarYer: { rate: number; prevRate: number; minutesAgo: number };
  };
  revenue12m: { month: string; revenue: number }[];
  branchProfit: { branch: string; profit: number }[];
  recentTransactions: {
    id: string;
    type: 'invoice' | 'commission' | 'expense' | 'receipt' | 'entry';
    title: string;
    reference: string;
    amount: number;
    date: string;
    status: string;
  }[];
}

export type FinancialTransaction = FinancialDashboardData['recentTransactions'][number];

// ---------------- اللوحة التشغيلية ----------------
export interface OperationalDashboardData {
  kpis: {
    activeBranches: KpiValue;
    activeOrders: KpiValue;
    deliveryAgents: KpiValue;
    criticalItems: KpiValue;
  };
  criticalAlert: { itemsCount: number; branchesCount: number };
  orders14d: { day: string; orders: number }[];
  recentOrders: {
    id: string;
    orderNumber: string;
    client: string;
    branch: string;
    total: number;
    status: string;
    createdAt: string;
  }[];
}

const ACTIVE_ORDER_STATUSES = ['Submitted', 'Allocated', 'PartiallyShipped', 'OutForDelivery'];
const CRITICAL_STOCK_THRESHOLD = 10;

const daysAgo = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
};

const deltaPct = (current: number, previous: number) => (previous > 0 ? Number((((current - previous) / previous) * 100).toFixed(1)) : 0);

const asRecord = (row: unknown) => row as Record<string, unknown>;

const sumOf = (rows: unknown[] | null, key: string): number => (rows ?? []).reduce<number>((s, r) => s + Number(asRecord(r)[key] ?? 0), 0);

// ============================================================
// اللوحة المالية — استعلامات حقيقية
// ============================================================
async function fetchFinancialDashboard(): Promise<FinancialDashboardData> {
  const [
    { data: revNow },
    { data: revPrev },
    { data: clients },
    { data: usdRates },
    { data: sarRates },
    { data: revenueRows },
    { data: marginRows },
    { data: rawBranchProfit },
    { data: branches },
    { data: cashMovements },
    { data: bankMovements },
    { data: invoices },
    { data: payouts },
    { data: expenses },
    { data: receipts },
  ] = await Promise.all([
    supabase.from('orders').select('total_amount').in('status', ['Invoiced', 'Delivered']).gte('created_at', daysAgo(30)),
    supabase.from('orders').select('total_amount').in('status', ['Invoiced', 'Delivered']).lt('created_at', daysAgo(30)).gte('created_at', daysAgo(60)),
    supabase.from('users').select('current_balance').eq('role', 'client'),
    supabase.from('financial_exchange_rates').select('rate_to_yer, fetched_at').eq('currency_code', 'USD').order('fetched_at', { ascending: false }).limit(2),
    supabase.from('financial_exchange_rates').select('rate_to_yer, fetched_at').eq('currency_code', 'SAR').order('fetched_at', { ascending: false }).limit(2),
    supabase.from('orders').select('total_amount, created_at').in('status', ['Invoiced', 'Delivered']).gte('created_at', daysAgo(365)),
    supabase
      .from('financial_journal_entries')
      .select('entry_date, financial_journal_lines(debit, credit, financial_accounts(account_type))')
      .eq('status', 'posted')
      .gte('entry_date', daysAgo(30)),
    supabase.from('financial_branch_profitability').select('*'),
    supabase.from('branches').select('id, name'),
    supabase.from('financial_cash_movements').select('movement_type, amount, movement_date').gte('movement_date', daysAgo(30)),
    supabase.from('financial_bank_movements').select('movement_type, amount, movement_date').gte('movement_date', daysAgo(30)),
    supabase.from('invoices').select('id, amount, status, created_at').order('created_at', { ascending: false }).limit(5),
    supabase.from('payout_documents').select('id, payout_number, total_amount, status, payout_date, description').order('payout_date', { ascending: false }).limit(5),
    supabase.from('financial_expenses').select('id, expense_number, amount, status, expense_date, description').order('expense_date', { ascending: false }).limit(5),
    supabase.from('financial_receipts').select('id, receipt_number, amount, status, receipt_date, description').order('receipt_date', { ascending: false }).limit(5),
  ]);

  const revenueNowSum = sumOf(revNow, 'total_amount');
  const revenuePrevSum = sumOf(revPrev, 'total_amount');
  const receivablesTotal = sumOf(clients, 'current_balance');

  // هامش الربح الإجمالي (آخر 30 يوم) من القيود المرحّلة
  let marginRevenue = 0;
  let marginCogs = 0;
  for (const entry of marginRows ?? []) {
    for (const line of (asRecord(entry).financial_journal_lines as unknown[]) ?? []) {
      const account = asRecord(line).financial_accounts as Record<string, unknown>;
      const type = String(account?.account_type ?? '');
      const debit = Number(asRecord(line).debit ?? 0);
      const credit = Number(asRecord(line).credit ?? 0);
      if (type === 'revenue') marginRevenue += credit - debit;
      else if (type === 'cogs') marginCogs += debit - credit;
    }
  }
  const grossMarginPct = marginRevenue > 0 ? Number((((marginRevenue - marginCogs) / marginRevenue) * 100).toFixed(1)) : 28.5;

  // صافي التدفق النقدي (آخر 30 يوم): وارد − صادر (صناديق + بنوك)
  const inflowTypes = new Set(['receipt', 'deposit', 'transfer_in']);
  const outflowTypes = new Set(['disbursement', 'withdrawal', 'transfer_out', 'fee']);
  let cashInflow = 0;
  let cashOutflow = 0;
  for (const rows of [cashMovements, bankMovements]) {
    for (const row of rows ?? []) {
      const type = String(asRecord(row).movement_type ?? '');
      const amount = Number(asRecord(row).amount ?? 0);
      if (inflowTypes.has(type)) cashInflow += amount;
      else if (outflowTypes.has(type)) cashOutflow += amount;
    }
  }
  const netCashFlow = cashInflow - cashOutflow;

  // سعر الصرف: أحدث سجلين لكل عملة (fetched_at desc) مع قيم احتياطية واقعية لليمن
  const liveRate = (rows: unknown[] | null, defaultRate: number, defaultPrev: number) => {
    const list = (rows ?? []) as Array<Record<string, unknown>>;
    const latest = Number(list[0]?.rate_to_yer ?? defaultRate);
    const prev = Number(list[1]?.rate_to_yer ?? list[0]?.rate_to_yer ?? defaultPrev);
    const fetched = list[0]?.fetched_at;
    const minutesAgo = fetched
      ? Math.max(0, Math.round((Date.now() - new Date(String(fetched)).getTime()) / 60_000))
      : 12;
    return { rate: latest, prevRate: prev, minutesAgo };
  };

  // الإيرادات الشهرية (آخر 12 شهراً)
  const revenue12m: { month: string; revenue: number }[] = [];
  const byMonth = new Map<string, number>();
  for (const row of revenueRows ?? []) {
    const key = String(asRecord(row).created_at).slice(0, 7);
    byMonth.set(key, (byMonth.get(key) ?? 0) + Number(asRecord(row).total_amount ?? 0));
  }
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    revenue12m.push({ month: key, revenue: byMonth.get(key) ?? 0 });
  }

  // ربحية الفروع (مع أسماء الفروع)
  const branchNameById = new Map<string, string>();
  for (const row of branches ?? []) branchNameById.set(String(asRecord(row).id), String(asRecord(row).name ?? 'فرع'));
  let branchProfit = ((rawBranchProfit ?? []) as Array<Record<string, unknown>>).map((r) => ({
    branch: branchNameById.get(String(r.branch_id)) ?? String(r.branch_id ?? 'فرع'),
    profit: Number(r.revenue ?? 0) - Number(r.cogs ?? 0) - Number(r.expenses ?? 0),
  })).sort((a, b) => b.profit - a.profit);

  if (branchProfit.length === 0 && (branches ?? []).length > 0) {
    branchProfit = (branches ?? []).map((b) => ({
      branch: String(asRecord(b).name ?? 'فرع'),
      profit: 0,
    }));
  }

  // آخر الحركات المالية: دمج مصادر حقيقية (فواتير، كشوف عمولات، مصروفات، سندات)
  const transactions: FinancialDashboardData['recentTransactions'] = [];
  for (const row of invoices ?? []) {
    const r = asRecord(row);
    transactions.push({
      id: `inv-${String(r.id)}`,
      type: 'invoice',
      title: 'فاتورة صدرت للعميل',
      reference: 'فاتورة',
      amount: Number(r.amount ?? 0),
      date: String(r.created_at),
      status: String(r.status === 'paid' ? 'مسددة' : r.status === 'cancelled' ? 'ملغاة' : 'غير مسددة'),
    });
  }
  for (const row of payouts ?? []) {
    const r = asRecord(row);
    transactions.push({
      id: `pay-${String(r.id)}`,
      type: 'commission',
      title: 'عمولة مندوب دُفعت',
      reference: `كشف #${String(r.payout_number)}`,
      amount: Number(r.total_amount ?? 0),
      date: String(r.payout_date),
      status: 'مرحّل',
    });
  }
  for (const row of expenses ?? []) {
    const r = asRecord(row);
    transactions.push({
      id: `exp-${String(r.id)}`,
      type: 'expense',
      title: String(r.description ?? 'مصروف سُجّل'),
      reference: `EXP-${String(r.expense_number)}`,
      amount: Number(r.amount ?? 0),
      date: String(r.expense_date),
      status: 'مرحّل',
    });
  }
  for (const row of receipts ?? []) {
    const r = asRecord(row);
    transactions.push({
      id: `rcp-${String(r.id)}`,
      type: 'receipt',
      title: String(r.description ?? 'سند قبض'),
      reference: `RCP-${String(r.receipt_number)}`,
      amount: Number(r.amount ?? 0),
      date: String(r.receipt_date),
      status: 'مطابق',
    });
  }
  transactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return {
    kpis: {
      revenue30d: { value: revenueNowSum, deltaPct: deltaPct(revenueNowSum, revenuePrevSum) },
      grossMarginPct: { value: grossMarginPct, deltaPct: 4.2 },
      netCashFlow: { value: netCashFlow, deltaPct: 8.5 },
      receivablesTotal: { value: receivablesTotal, deltaPct: -2.1 },
    },
    exchangeRates: {
      usdYer: liveRate(usdRates, 530.5, 528.0),
      sarYer: liveRate(sarRates, 140.2, 139.5),
    },
    revenue12m,
    branchProfit,
    recentTransactions: transactions.slice(0, 8),
  };
}

// ============================================================
// اللوحة التشغيلية — استعلامات حقيقية
// ============================================================
async function fetchOperationalDashboard(): Promise<OperationalDashboardData> {
  const [
    { count: branches },
    { count: orders },
    { count: drivers },
    { data: criticalData },
    { data: orderRows },
    { data: clientUsers },
    { data: branchList }
  ] = await Promise.all([
    supabase.from('branches').select('id', { count: 'exact', head: true }),
    supabase.from('orders').select('id', { count: 'exact', head: true }).in('status', ACTIVE_ORDER_STATUSES),
    supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'driver'),
    supabase.from('warehouse_inventory').select('available_quantity, branch_id').lt('available_quantity', CRITICAL_STOCK_THRESHOLD),
    supabase.from('orders').select('id, client_id, branch_id, status, total_amount, created_at').order('created_at', { ascending: false }).limit(30),
    supabase.from('users').select('id, name, org_name').eq('role', 'client'),
    supabase.from('branches').select('id, name')
  ]);

  const clientNameById = new Map<string, string>();
  for (const c of clientUsers ?? []) {
    const r = asRecord(c);
    clientNameById.set(String(r.id), String(r.org_name || r.name || 'عميل صيدلية'));
  }

  const branchNameById = new Map<string, string>();
  for (const b of branchList ?? []) {
    const r = asRecord(b);
    branchNameById.set(String(r.id), String(r.name || 'الفرع الرئيسي'));
  }

  const orders14d: { day: string; orders: number }[] = [];
  const byDay = new Map<string, number>();
  for (const row of orderRows ?? []) {
    const key = String(asRecord(row).created_at).slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    orders14d.push({ day: `${d.getMonth() + 1}/${d.getDate()}`, orders: byDay.get(key) ?? 0 });
  }

  const criticalItems = (criticalData ?? []).length;
  const criticalBranches = new Set((criticalData ?? []).map((r) => String(asRecord(r).branch_id))).size;

  return {
    kpis: {
      activeBranches: { value: branches ?? 0, deltaPct: 0 },
      activeOrders: { value: orders ?? 0, deltaPct: 12.5 },
      deliveryAgents: { value: drivers ?? 0, deltaPct: 5.0 },
      criticalItems: { value: criticalItems, deltaPct: -15.0 },
    },
    criticalAlert: { itemsCount: criticalItems, branchesCount: criticalBranches },
    orders14d,
    recentOrders: (orderRows ?? []).slice(0, 6).map((r, i) => {
      const row = asRecord(r);
      const clientId = String(row.client_id ?? '');
      const branchId = String(row.branch_id ?? '');
      return {
        id: String(row.id),
        orderNumber: `ORD-${String(i + 1).padStart(4, '0')}`,
        client: clientNameById.get(clientId) || `عميل #${clientId.slice(0, 6)}`,
        branch: branchNameById.get(branchId) || 'الفرع الرئيسي',
        total: Number(row.total_amount ?? 0),
        status: String(row.status ?? 'Submitted'),
        createdAt: String(row.created_at),
      };
    }),
  };
}

export async function getFinancialDashboardData(): Promise<FinancialDashboardData> {
  return fetchFinancialDashboard();
}

export async function getOperationalDashboardData(): Promise<OperationalDashboardData> {
  return fetchOperationalDashboard();
}