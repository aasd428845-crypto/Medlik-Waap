import { useCallback, useEffect, useState } from 'react';
import { BookOpenText, Plus, RefreshCw, Send, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';

interface AccountOption {
  id: string;
  code: string;
  name: string | null;
}

interface EntryRow {
  id: string;
  entry_number: number;
  entry_date: string;
  description: string | null;
  status: string;
}

interface Line {
  accountId: string;
  debit: string;
  credit: string;
}

export function JournalPage() {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<Line[]>([
    { accountId: '', debit: '', credit: '' },
    { accountId: '', debit: '', credit: '' },
  ]);
  const [busy, setBusy] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [savedEntryId, setSavedEntryId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [accRes, entRes] = await Promise.all([
        supabase
          .from('financial_accounts')
          .select('id, code, name')
          .eq('is_active', true)
          .eq('is_postable', true)
          .order('code', { ascending: true }),
        supabase
          .from('financial_journal_entries')
          .select('id, entry_number, entry_date, description, status')
          .order('entry_date', { ascending: false })
          .limit(20),
      ]);
      if (accRes.error) throw new Error(accRes.error.message);
      if (entRes.error) throw new Error(entRes.error.message);
      setAccounts((accRes.data ?? []) as unknown as AccountOption[]);
      setEntries((entRes.data ?? []) as unknown as EntryRow[]);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'تعذر تحميل بيانات دفتر اليومية');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const totals = lines.reduce(
    (acc, ln) => ({
      debit: acc.debit + (Number(ln.debit) || 0),
      credit: acc.credit + (Number(ln.credit) || 0),
    }),
    { debit: 0, credit: 0 },
  );
  const diff = totals.debit - totals.credit;
  const isBalanced = totals.debit > 0 && diff === 0;

  const updateLine = (i: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((ln, idx) => (idx === i ? { ...ln, ...patch } : ln)));

  const saveDraft = async (): Promise<string | null> => {
    if (!description.trim()) {
      alert('أدخل وصف القيد.');
      return null;
    }
    const payload = lines.map((ln) => ({
      account_code: accounts.find((a) => a.id === ln.accountId)?.code ?? null,
      debit: Number(ln.debit) || 0,
      credit: Number(ln.credit) || 0,
      description: null,
    }));
    const valid = payload.filter((p) => (p.debit > 0 || p.credit > 0) && p.account_code);
    if (valid.length < 2) {
      alert('أضف سطرين على الأقل بحساب ومبلغ صحيحين.');
      return null;
    }
    if (!isBalanced) {
      alert('القيد غير متوازن — اجعل مجموع المدين = مجموع الدائن.');
      return null;
    }
    setBusy(true);
    try {
      const { data, error: rpcErr } = await supabase.rpc('create_financial_journal_entry', {
        p_entry_date: entryDate,
        p_description: description.trim(),
        p_lines: valid,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      setSavedEntryId((data as string) ?? null);
      return (data as string) ?? null;
    } catch (err) {
      alert(err instanceof Error ? err.message : 'حدث خطأ أثناء حفظ القيد');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const postEntry = async () => {
    if (!savedEntryId) {
      alert('احفظ القيد أولاً.');
      return;
    }
    setBusy(true);
    try {
      const { error: rpcErr } = await supabase.rpc('post_financial_journal_entry', { p_entry_id: savedEntryId });
      if (rpcErr) throw new Error(rpcErr.message);
      setSuccessMsg('تم ترحيل القيد بنجاح.');
      setSavedEntryId(null);
      setLines([
        { accountId: '', debit: '', credit: '' },
        { accountId: '', debit: '', credit: '' },
      ]);
      setDescription('');
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'حدث خطأ أثناء الترحيل');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-6">
      <section className="director-panel director-reveal relative overflow-hidden rounded-2xl p-5 md:p-7">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[10px] font-bold tracking-[0.16em] text-primary">للمحاسب المتخصص — قيود موسّعة</p>
            <h1 className="mt-3 text-2xl font-extrabold tracking-tight md:text-3xl">دفتر اليومية</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
              قيود يدوية بأسطر متعددة (مدين/دائن) تُحفظ مسودة ثم تُرحَّل — المرحّل محمي من التعديل والحذف (حصانة اليومية).
            </p>
          </div>
          <button onClick={() => void load()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-background/60 px-4 py-2 text-sm font-bold hover:bg-background">
            <RefreshCw className="h-4 w-4" /> تحديث
          </button>
        </div>
      </section>

      {successMsg && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {successMsg}
        </div>
      )}

      <section className="director-panel rounded-2xl p-5 md:p-6">
        <h2 className="text-base font-extrabold">قيد جديد</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-sm font-semibold">تاريخ القيد</label>
            <input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary bg-background"
            />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1.5 block text-sm font-semibold">وصف القيد</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="مثال: قيد تسوية نهاية الشهر"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary bg-background"
            />
          </div>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">الحساب</th>
                <th className="px-4 py-3">مدين</th>
                <th className="px-4 py-3">دائن</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.map((ln, i) => (
                <tr key={i}>
                  <td className="px-4 py-2 font-bold">{i + 1}</td>
                  <td className="min-w-[220px] px-4 py-2">
                    <select
                      value={ln.accountId}
                      onChange={(e) => updateLine(i, { accountId: e.target.value })}
                      className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary bg-background"
                    >
                      <option value="">— اختر الحساب —</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} — {a.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="min-w-[130px] px-4 py-2">
                    <input
                      type="number"
                      min="0"
                      value={ln.debit}
                      onChange={(e) => updateLine(i, { debit: e.target.value, credit: Number(ln.credit) ? ln.credit : '' })}
                      placeholder="0.00"
                      className="w-full border rounded-lg px-3 py-2 text-left text-sm focus:ring-2 focus:ring-primary bg-background"
                    />
                  </td>
                  <td className="min-w-[130px] px-4 py-2">
                    <input
                      type="number"
                      min="0"
                      value={ln.credit}
                      onChange={(e) => updateLine(i, { credit: e.target.value, debit: Number(ln.debit) ? ln.debit : '' })}
                      placeholder="0.00"
                      className="w-full border rounded-lg px-3 py-2 text-left text-sm focus:ring-2 focus:ring-primary bg-background"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <button
                      type="button"
                      onClick={() => lines.length > 2 && setLines((prev) => prev.filter((_, idx) => idx !== i))}
                      className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label="حذف السطر"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-muted/20">
              <tr>
                <td className="px-4 py-3 font-bold" colSpan={2}>
                  الإجمالي
                </td>
                <td className="px-4 py-3 font-bold" dir="ltr">
                  {totals.debit.toLocaleString()}
                </td>
                <td className="px-4 py-3 font-bold" dir="ltr">
                  {totals.credit.toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-bold ${isBalanced ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {isBalanced ? 'متوازن ✓' : `الفرق: ${diff.toLocaleString()}`}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setLines((prev) => [...prev, { accountId: '', debit: '', credit: '' }])}
            className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-bold hover:bg-muted"
          >
            <Plus className="h-4 w-4" /> إضافة سطر
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={saveDraft}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl border border-primary px-5 py-2.5 text-sm font-bold text-primary hover:bg-primary/10 disabled:opacity-50"
          >
            <BookOpenText className="h-4 w-4" /> حفظ مسودة
          </button>
          {savedEntryId && (
            <button
              type="button"
              onClick={postEntry}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Send className="h-4 w-4" /> ترحيل القيد
            </button>
          )}
        </div>
      </section>

      <section className="director-panel overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-border p-5">
          <div>
            <h2 className="text-base font-extrabold">آخر القيود (آخر 20)</h2>
            <p className="mt-1 text-xs text-muted-foreground">المرحّلة محمية من التعديل والحذف.</p>
          </div>
          <BookOpenText className="h-5 w-5 text-primary" />
        </div>
        {loading ? (
          <div className="p-10"><LoadingSpinner /></div>
        ) : error ? (
          <div className="p-4"><ErrorMessage message={error} /></div>
        ) : entries.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">لا توجد قيود بعد.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-4 py-3">رقم القيد</th>
                  <th className="px-4 py-3">التاريخ</th>
                  <th className="px-4 py-3">الوصف</th>
                  <th className="px-4 py-3">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {entries.map((en) => (
                  <tr key={en.id} className="hover:bg-muted/20">
                    <td className="px-4 py-3 font-bold" dir="ltr">
                      #{en.entry_number}
                    </td>
                    <td className="px-4 py-3" dir="ltr">
                      {en.entry_date}
                    </td>
                    <td className="px-4 py-3">{en.description || '—'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${
                          en.status === 'posted'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-amber-200 bg-amber-50 text-amber-700'
                        }`}
                      >
                        {en.status === 'posted' ? 'مرحّل' : en.status === 'voided' ? 'معكوس' : 'مسودة'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}