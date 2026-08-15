import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Banknote, BookOpen, HandCoins, Landmark, RefreshCw, Wallet, FileText, AlertTriangle, type LucideIcon } from 'lucide-react';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { supabase } from '@/lib/supabaseClient';
import { getFinancialSummary, listRecentJournalEntries, type FinancialSummary, type JournalRow } from '@/lib/financialApi';

const modules: [string, string, LucideIcon][] = [
  ['دليل الحسابات', '/director/financial/accounts', BookOpen],
  ['القيود ودفتر الأستاذ', '/director/financial/journal', BookOpen],
  ['الصناديق والبنوك', '/director/financial/cash-bank', Landmark],
  ['الذمم والتحصيل', '/director/receivables', Wallet],
  ['المصروفات والأصول', '/director/financial/expenses-assets', Banknote],
];

interface DoctorPayable {
  doctor_id: string;
  doctor_name: string;
  payables: number;
}

interface PayoutDoc {
  id: string;
  payout_number: number;
  payout_date: string;
  payment_method: string;
  total_amount: number;
  description: string | null;
  status: string;
}

function Metric({ label, value, suffix = '' }: { label: string; value: string | number; suffix?: string }) {
  return <div className="director-panel rounded-2xl p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-xl font-extrabold" dir="ltr">{value}{suffix}</p></div>;
}

export function FinancialPage() {
  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [entries, setEntries] = useState<JournalRow[]>([]);
  const [doctors, setDoctors] = useState<DoctorPayable[]>([]);
  const [payouts, setPayouts] = useState<PayoutDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [payMethod, setPayMethod] = useState<'cash' | 'bank'>('cash');
  const [payBusy, setPayBusy] = useState(false);
  const [payMsg, setPayMsg] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date>(() => new Date());

  const load = async () => {
    try {
      const [s, e, d, p] = await Promise.all([
        getFinancialSummary(),
        listRecentJournalEntries(),
        supabase.rpc('get_doctors_payables'),
        supabase.from('payout_documents').select('id, payout_number, payout_date, payment_method, total_amount, description, status').order('payout_date', { ascending: false }).limit(5),
      ]);
      if (d.error) throw new Error(d.error.message);
      if (p.error) throw new Error(p.error.message);
      setSummary(s);
      setEntries(e);
      setDoctors((d.data ?? []) as unknown as DoctorPayable[]);
      setPayouts((p.data ?? []) as unknown as PayoutDoc[]);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل البيانات المالية');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 45000);
    return () => clearInterval(t);
  }, []);

  const runPayouts = async () => {
    const ids = doctors.filter((x) => x.payables > 0).map((x) => x.doctor_id);
    if (ids.length === 0) {
      setPayMsg('لا توجد أرصدة مستحقة للدفع حالياً.');
      return;
    }
    setPayBusy(true);
    setPayMsg('');
    try {
      const { data, error: rpcErr } = await supabase.rpc('create_doctors_payouts_entries', { p_doctor_ids: ids, p_payment_method: payMethod });
      if (rpcErr) throw new Error(rpcErr.message);
      setPayMsg(String(data ?? 'تمت التسوية بنجاح.'));
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'حدث خطأ أثناء دفع العمولات');
    } finally {
      setPayBusy(false);
    }
  };

  const payableTotal = doctors.reduce((sum, x) => sum + Number(x.payables), 0);

  return <div className="mx-auto max-w-[1600px] space-y-6">
    <section className="director-panel director-reveal relative overflow-hidden rounded-2xl p-5 md:p-7">
      <div className="absolute -left-24 -top-32 h-72 w-72 rounded-full bg-accent/10 blur-3xl" />
      <div className="relative flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div><p className="text-[10px] font-bold tracking-[0.16em] text-primary">مركز الإدارة المالية</p><h1 className="mt-3 text-2xl font-extrabold tracking-tight md:text-3xl">الإدارة المالية والمحاسبة</h1><p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">لوحة مالية حية تعتمد على بيانات Supabase الفعلية والقيود المرحّلة — تتحدث تلقائياً كل 45 ثانية.</p></div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-2 text-[11px] text-muted-foreground" title="تدوير تلقائي كل 45 ثانية"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> آخر تحديث: {lastUpdated.toLocaleTimeString('ar')}</span>
          <button onClick={() => void load()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-background/60 px-4 py-2 text-sm font-bold hover:bg-background"><RefreshCw className="h-4 w-4" /> تحديث</button>
        </div>
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

    <section className="director-panel rounded-2xl p-5 md:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div><h2 className="text-base font-extrabold">عمولات الأطباء المستحقة</h2><p className="mt-1 text-xs text-muted-foreground">مصدرها القيود المرحّلة على الحساب 126000 — الدفع يُنشئ كشفاً وبنداً وقيداً مرحَّلاً فوراً.</p></div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex overflow-hidden rounded-xl border border-border">
            {(['cash', 'bank'] as const).map((m) => (
              <button key={m} type="button" onClick={() => setPayMethod(m)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-bold ${payMethod === m ? 'bg-primary/10 text-primary' : 'bg-background text-muted-foreground'}`}>
                {m === 'cash' ? <Banknote className="h-4 w-4" /> : <Landmark className="h-4 w-4" />}
                {m === 'cash' ? 'نقداً' : 'بنكياً'}
              </button>
            ))}
          </div>
          <button type="button" onClick={runPayouts} disabled={payBusy || doctors.length === 0}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {payBusy ? <LoadingSpinner /> : <HandCoins className="h-4 w-4" />}
            دفع العمولات دفعة واحدة
          </button>
        </div>
      </div>
      <div className="mt-4 text-sm font-extrabold" dir="ltr">الإجمالي المستحق: {payableTotal.toLocaleString()} ﷼</div>
      {payMsg && <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{payMsg}</div>}
      <div className="mt-4 overflow-x-auto">
        {doctors.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">لا يوجد أطباء بعد.</div>
        ) : (
          <table className="w-full text-right text-sm">
            <thead className="bg-muted/40"><tr><th className="px-4 py-3">الطبيب</th><th className="px-4 py-3">المستحق</th><th className="px-4 py-3">الحالة</th></tr></thead>
            <tbody className="divide-y divide-border">
              {doctors.map((d) => (
                <tr key={d.doctor_id} className="hover:bg-muted/20">
                  <td className="px-4 py-3 font-semibold">{d.doctor_name}</td>
                  <td className="px-4 py-3 font-bold" dir="ltr">{Number(d.payables).toLocaleString()}</td>
                  <td className="px-4 py-3"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${Number(d.payables) > 0 ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{Number(d.payables) > 0 ? 'مستحق الدفع' : 'مسدّد'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>

    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {modules.map(([label, path, Icon]) => <Link key={path} to={path} className="director-panel group rounded-2xl p-5 transition-transform hover:-translate-y-0.5"><div className="flex items-center justify-between"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="h-5 w-5"/></span><ArrowLeft className="h-4 w-4 text-muted-foreground"/></div><h2 className="mt-5 text-sm font-extrabold">{label}</h2><p className="mt-1 text-[11px] text-muted-foreground">فتح وحدة الإدارة المالية</p></Link>)}
    </section>

    <section className="director-panel overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between border-b border-border p-5"><div><h2 className="text-base font-extrabold">آخر كشوف الدفع</h2><p className="mt-1 text-xs text-muted-foreground">من trigger دفع العمولات (آخر 5 كشوف).</p></div><HandCoins className="h-5 w-5 text-primary" /></div>
      {payouts.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground">لا توجد كشوف دفع بعد.</div> : <div className="overflow-x-auto"><table className="w-full text-right text-sm"><thead className="bg-muted/40"><tr><th className="px-4 py-3">رقم الكشف</th><th className="px-4 py-3">التاريخ</th><th className="px-4 py-3">الطريقة</th><th className="px-4 py-3">الإجمالي</th><th className="px-4 py-3">الوصف</th></tr></thead><tbody className="divide-y divide-border">{payouts.map((p) => <tr key={p.id} className="hover:bg-muted/20"><td className="px-4 py-3 font-bold" dir="ltr">#{p.payout_number}</td><td className="px-4 py-3" dir="ltr">{p.payout_date}</td><td className="px-4 py-3">{p.payment_method === 'bank' ? 'بنكي' : 'نقدي'}</td><td className="px-4 py-3 font-bold" dir="ltr">{Number(p.total_amount).toLocaleString()}</td><td className="px-4 py-3">{p.description || '—'}</td></tr>)}</tbody></table></div>}
    </section>

    <section className="director-panel overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between border-b border-border p-5"><div><h2 className="text-base font-extrabold">آخر القيود المحاسبية</h2><p className="mt-1 text-xs text-muted-foreground">المصدر المباشر: دفتر اليومية المالي</p></div><FileText className="h-5 w-5 text-primary" /></div>
      <div className="overflow-x-auto"><table className="w-full text-right text-sm"><thead className="bg-muted/40"><tr><th className="px-4 py-3">رقم القيد</th><th className="px-4 py-3">التاريخ</th><th className="px-4 py-3">الوصف</th><th className="px-4 py-3">الحالة</th></tr></thead><tbody className="divide-y divide-border">{entries.map((e)=><tr key={e.id} className="hover:bg-muted/20"><td className="px-4 py-3 font-bold" dir="ltr">#{e.entry_number}</td><td className="px-4 py-3" dir="ltr">{e.entry_date}</td><td className="px-4 py-3">{e.description}</td><td className="px-4 py-3">{e.status === 'posted' ? 'مرحّل' : e.status === 'voided' ? 'معكوس' : 'مسودة'}</td></tr>)}{entries.length===0&&<tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">لا توجد قيود بعد.</td></tr>}</tbody></table></div>
    </section>
  </div>;
}