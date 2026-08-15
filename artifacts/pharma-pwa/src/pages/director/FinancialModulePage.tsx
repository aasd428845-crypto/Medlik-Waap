import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { LoadingSpinner } from '@/components/LoadingSpinner';

const config = {
  accounts: { title: 'دليل الحسابات', table: 'financial_accounts', columns: ['code','name','account_type','normal_balance','is_postable'], labels: ['الرمز','الحساب','النوع','الرصيد الطبيعي','قابل للترحيل'] },
  journal: { title: 'القيود ودفتر الأستاذ', table: 'financial_journal_entries', columns: ['entry_number','entry_date','description','status'], labels: ['رقم القيد','التاريخ','الوصف','الحالة'] },
  'cash-bank': { title: 'الصناديق والبنوك', table: 'financial_cash_accounts', columns: ['code','name','currency_code','is_active'], labels: ['الرمز','الحساب','العملة','الحالة'] },
  'expenses-assets': { title: 'المصروفات والأصول', table: 'financial_documents', columns: ['document_number','document_type','description','created_at'], labels: ['رقم المستند','النوع','الوصف','التاريخ'] },
} as const;

type ModuleKey = keyof typeof config;

export function FinancialModulePage() {
  const { module } = useParams<{ module: string }>();
  const key = module as ModuleKey;
  const meta = config[key];
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    if (!meta) return;
    setLoading(true); setError('');
    try {
      const { data, error: queryError } = await supabase.from(meta.table).select(meta.columns.join(',')).limit(100);
      if (queryError) throw new Error(queryError.message);
      setRows((data ?? []) as unknown as Record<string, unknown>[]);
    } catch (e) { setError(e instanceof Error ? e.message : 'تعذر تحميل الوحدة'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [module]);
  if (!meta) return <div className="director-panel rounded-2xl p-6">الوحدة غير موجودة.</div>;

  return <div className="mx-auto max-w-[1600px] space-y-6">
    <div className="flex items-center justify-between gap-3"><div><Link to="/director/financial" className="mb-3 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-primary"><ArrowRight className="h-4 w-4"/> العودة للإدارة المالية</Link><h1 className="text-2xl font-extrabold">{meta.title}</h1></div><button onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-bold"><RefreshCw className="h-4 w-4"/> تحديث</button></div>
    <section className="director-panel overflow-hidden rounded-2xl">
      {loading ? <div className="p-10"><LoadingSpinner /></div> : error ? <div className="p-6 text-sm text-red-600">{error}</div> : <div className="overflow-x-auto"><table className="w-full text-right text-sm"><thead className="bg-muted/40"><tr>{meta.labels.map(l=><th key={l} className="px-4 py-3">{l}</th>)}</tr></thead><tbody className="divide-y divide-border">{rows.map((row,i)=><tr key={String(row.id ?? i)} className="hover:bg-muted/20">{meta.columns.map(c=><td key={c} className="px-4 py-3">{String(row[c] ?? '—')}</td>)}</tr>)}{rows.length===0&&<tr><td colSpan={meta.columns.length} className="px-4 py-10 text-center text-muted-foreground">لا توجد بيانات حالياً.</td></tr>}</tbody></table></div>}
    </section>
  </div>;
}
