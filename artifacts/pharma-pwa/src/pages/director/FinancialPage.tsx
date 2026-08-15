import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Banknote, BookOpen, Landmark, Wallet, RefreshCw, FileText, AlertTriangle } from 'lucide-react';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { getFinancialSummary, listRecentJournalEntries, type FinancialSummary, type JournalRow } from '@/lib/financialApi';

const modules = [
  ['دليل الحسابات', '/director/financial/accounts', BookOpen],
  ['القيود ودفتر الأستاذ', '/director/financial/journal', BookOpen],
  ['الصناديق والبنوك', '/director/financial/cash-bank', Landmark],
  ['الذمم والتحصيل', '/director/receivables', Wallet],
  ['المصروفات والأصول', '/director/financial/expenses-assets', Banknote],
];

function Metric({ label, value, suffix = '' }: { label: string; value: string | number; suffix?: string }) {
  return <div className="director-panel rounded-2xl p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-xl font-extrabold" dir="ltr">{value}{suffix}</p></div>;
}

export function FinancialPage() {
  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [entries, setEntries] = useState<JournalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [s, e] = await Promise.all([getFinancialSummary(), listRecentJournalEntries()]);
      setSummary(s); setEntries(e);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل البيانات المالية');
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  return <div className="mx-auto max-w-[1600px] space-y-6">
    <section className="director-panel director-reveal relative overflow-hidden rounded-2xl p-5 md:p-7">
      <div className="absolute -left-24 -top-32 h-72 w-72 rounded-full bg-accent/10 blur-3xl" />
      <div className="relative flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div><p className="text-[10px] font-bold tracking-[0.16em] text-primary">مركز الإدارة المالية</p><h1 className="mt-3 text-2xl font-extrabold tracking-tight md:text-3xl">الإدارة المالية والمحاسبة</h1><p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">لوحة مالية حية تعتمد على بيانات Supabase الفعلية والقيود المرحّلة، ومتناسقة مع تصميم مركز القيادة الجديد.</p></div>
        <button onClick={() => void load()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-background/60 px-4 py-2 text-sm font-bold hover:bg-background"><RefreshCw className="h-4 w-4" /> تحديث</button>
      </div>
    </section>

    {loading ? <LoadingSpinner /> : error ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertTriangle className="mb-2 h-5 w-5" />{error}</div> : summary && <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Metric label="الحسابات" value={summary.accounts} />
      <Metric label="القيود المرحّلة" value={summary.postedEntries} />
      <Metric label="القيود المسودة" value={summary.draftEntries} />
      <Metric label="حسابات الصندوق والبنك" value={summary.cashAccounts + summary.bankAccounts} />
      <Metric label="العملاء ذوو الذمم" value={summary.receivables} />
      <Metric label="إجمالي الذمم الحالية" value={summary.receivableBalance.toLocaleString()} suffix=" ﷼" />
    </section>}

    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {modules.map(([label,path,Icon])=>{const I=Icon as typeof BookOpen;return <Link key={String(path)} to={String(path)} className="director-panel group rounded-2xl p-5 transition-transform hover:-translate-y-0.5"><div className="flex items-center justify-between"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><I className="h-5 w-5"/></span><ArrowLeft className="h-4 w-4 text-muted-foreground"/></div><h2 className="mt-5 text-sm font-extrabold">{label}</h2><p className="mt-1 text-[11px] text-muted-foreground">فتح وحدة الإدارة المالية</p></Link>})}
    </section>

    <section className="director-panel overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between border-b border-border p-5"><div><h2 className="text-base font-extrabold">آخر القيود المحاسبية</h2><p className="mt-1 text-xs text-muted-foreground">المصدر المباشر: دفتر اليومية المالي</p></div><FileText className="h-5 w-5 text-primary" /></div>
      <div className="overflow-x-auto"><table className="w-full text-right text-sm"><thead className="bg-muted/40"><tr><th className="px-4 py-3">رقم القيد</th><th className="px-4 py-3">التاريخ</th><th className="px-4 py-3">الوصف</th><th className="px-4 py-3">الحالة</th></tr></thead><tbody className="divide-y divide-border">{entries.map((e)=><tr key={e.id} className="hover:bg-muted/20"><td className="px-4 py-3 font-bold" dir="ltr">#{e.entry_number}</td><td className="px-4 py-3" dir="ltr">{e.entry_date}</td><td className="px-4 py-3">{e.description}</td><td className="px-4 py-3">{e.status === 'posted' ? 'مرحّل' : e.status === 'voided' ? 'معكوس' : 'مسودة'}</td></tr>)}{entries.length===0&&<tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">لا توجد قيود بعد.</td></tr>}</tbody></table></div>
    </section>
  </div>;
}
