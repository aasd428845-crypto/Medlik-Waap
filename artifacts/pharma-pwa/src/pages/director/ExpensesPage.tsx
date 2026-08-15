import { useCallback, useEffect, useState } from 'react';
import { Plus, Receipt, RefreshCw, Banknote, Landmark } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { listBranches, type BranchRow } from '@/lib/branchManagerApi';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';

interface ExpenseCategory {
  id: string;
  code: string;
  name: string | null;
}

interface ExpenseRow {
  id: string;
  expense_number: number;
  expense_date: string;
  amount: number;
  status: string;
  category_name: string | null;
}

export function ExpensesPage() {
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [branchId, setBranchId] = useState('');
  const [method, setMethod] = useState<'cash' | 'bank'>('cash');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [catRes, expRes] = await Promise.all([
        supabase
          .from('financial_accounts')
          .select('id, code, name')
          .eq('account_type', 'expense')
          .eq('is_active', true)
          .eq('is_postable', true)
          .order('code', { ascending: true }),
        supabase
          .from('financial_expenses')
          .select('id, expense_number, expense_date, amount, status, financial_accounts(code, name)')
          .order('expense_date', { ascending: false })
          .limit(10),
      ]);
      if (catRes.error) throw new Error(catRes.error.message);
      if (expRes.error) throw new Error(expRes.error.message);
      setCategories((catRes.data ?? []) as unknown as ExpenseCategory[]);
      setExpenses((expRes.data ?? []).map((r) => {
        const row = r as Record<string, unknown>;
        const acc = row.financial_accounts as { code?: string; name?: string } | null;
        return {
          id: row.id as string,
          expense_number: row.expense_number as number,
          expense_date: row.expense_date as string,
          amount: Number(row.amount ?? 0),
          status: row.status as string,
          category_name: acc ? `${acc.code} — ${acc.name ?? ''}` : '—',
        };
      }));
      setBranches(await listBranches());
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'تعذر تحميل بيانات المصروفات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleSubmit = async () => {
    const value = Number(amount);
    if (!value || value <= 0) {
      alert('أدخل مبلغاً صحيحاً أكبر من صفر.');
      return;
    }
    setBusy(true);
    try {
      await supabase.rpc('create_financial_expense', {
        p_amount: value,
        p_category_account_id: categoryId || null,
        p_branch_id: branchId || null,
        p_payment_method: method,
        p_description: description.trim() || null,
      });
      setSuccessMsg('تم تسجيل المصروف وترحيل قيده تلقائياً.');
      setAmount('');
      setDescription('');
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'حدث خطأ أثناء تسجيل المصروف');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-6">
      <section className="director-panel director-reveal relative overflow-hidden rounded-2xl p-5 md:p-7">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[10px] font-bold tracking-[0.16em] text-primary">الإدخالات المبسّطة</p>
            <h1 className="mt-3 text-2xl font-extrabold tracking-tight md:text-3xl">المصروفات</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
              سجّل مصروفاً بسيطاً دون أي معرفة محاسبية — القيد (مدين/دائن) يُنشأ ويرُحَّل تلقائياً.
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
        <h2 className="text-base font-extrabold">مصروف جديد</h2>
        <p className="mt-1 text-xs text-muted-foreground">الفئة، المبلغ، الفرع (اختياري)، ثم طريقة الدفع.</p>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-semibold">فئة المصروف</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary bg-background"
            >
              <option value="">— اختر الفئة (افتراضياً: المصروفات العامة) —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-semibold">المبلغ (ر.ي)</label>
            <input
              type="number"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary bg-background"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-semibold">الفرع (اختياري)</label>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary bg-background"
            >
              <option value="">— بدون فرع —</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-semibold">طريقة الدفع</label>
            <div className="grid grid-cols-2 gap-3">
              {(['cash', 'bank'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                    method === m ? 'border-primary bg-primary/10 text-primary' : 'border-border text-foreground hover:bg-muted'
                  }`}
                >
                  {m === 'cash' ? <Banknote className="h-4 w-4" /> : <Landmark className="h-4 w-4" />}
                  {m === 'cash' ? 'نقداً' : 'بنكياً'}
                </button>
              ))}
            </div>
          </div>
          <div className="md:col-span-2">
            <label className="mb-1.5 block text-sm font-semibold">الوصف (اختياري)</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="مثال: فواتير كهرباء فرع صنعاء"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary bg-background"
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3 border-t pt-4">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? <LoadingSpinner /> : <Plus className="h-4 w-4" />}
            تسجيل المصروف
          </button>
        </div>
      </section>

      <section className="director-panel overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-border p-5">
          <div>
            <h2 className="text-base font-extrabold">آخر المصروفات المسجلة</h2>
            <p className="mt-1 text-xs text-muted-foreground">جميعها مرتحلة تلقائياً إلى القيود المحاسبية.</p>
          </div>
          <Receipt className="h-5 w-5 text-primary" />
        </div>
        {loading ? (
          <div className="p-10"><LoadingSpinner /></div>
        ) : error ? (
          <div className="p-4"><ErrorMessage message={error} /></div>
        ) : expenses.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">لا توجد مصروفات مسجلة بعد.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-4 py-3">رقم المصروف</th>
                  <th className="px-4 py-3">التاريخ</th>
                  <th className="px-4 py-3">الفئة</th>
                  <th className="px-4 py-3">المبلغ</th>
                  <th className="px-4 py-3">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {expenses.map((e) => (
                  <tr key={e.id} className="hover:bg-muted/20">
                    <td className="px-4 py-3 font-bold" dir="ltr">#{e.expense_number}</td>
                    <td className="px-4 py-3" dir="ltr">{e.expense_date}</td>
                    <td className="px-4 py-3">{e.category_name}</td>
                    <td className="px-4 py-3 font-bold" dir="ltr">{e.amount.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                        {e.status === 'posted' ? 'مرحّل' : e.status}
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