import { useCallback, useEffect, useState } from 'react';
import { HandCoins, NotebookPen, Plus, RefreshCw, Banknote, Landmark } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';

interface ClientRow {
  id: string;
  name: string | null;
  phone: string | null;
}

interface ExpenseCategory {
  id: string;
  code: string;
  name: string | null;
}

interface ReceiptRow {
  id: string;
  receipt_number: number;
  receipt_date: string;
  amount: number;
  status: string;
}

interface MovementRow {
  id: string;
  movement_date: string;
  movement_type: string;
  amount: number;
  description: string | null;
}

export function ReceiptsPage() {
  const [tab, setTab] = useState<'receipt' | 'disbursement'>('receipt');

  const [clients, setClients] = useState<ClientRow[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [clientId, setClientId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'cash' | 'bank'>('cash');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [clientRes, catRes, recRes, movRes] = await Promise.all([
        supabase.from('users').select('id, name, phone').eq('role', 'client').order('name', { ascending: true }),
        supabase
          .from('financial_accounts')
          .select('id, code, name')
          .eq('account_type', 'expense')
          .eq('is_active', true)
          .eq('is_postable', true)
          .order('code', { ascending: true }),
        supabase
          .from('financial_receipts')
          .select('id, receipt_number, receipt_date, amount, status')
          .order('receipt_date', { ascending: false })
          .limit(8),
        supabase
          .from('financial_cash_movements')
          .select('id, movement_date, movement_type, amount, description')
          .order('movement_date', { ascending: false })
          .limit(8),
      ]);
      if (clientRes.error) throw new Error(clientRes.error.message);
      if (catRes.error) throw new Error(catRes.error.message);
      if (recRes.error) throw new Error(recRes.error.message);
      if (movRes.error) throw new Error(movRes.error.message);
      setClients((clientRes.data ?? []) as unknown as ClientRow[]);
      setCategories((catRes.data ?? []) as unknown as ExpenseCategory[]);
      setReceipts((recRes.data ?? []) as unknown as ReceiptRow[]);
      setMovements((movRes.data ?? []) as unknown as MovementRow[]);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'تعذر تحميل بيانات السندات');
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
    if (tab === 'receipt' && !clientId) {
      alert('اختر العميل المُحصَّل منه.');
      return;
    }
    setBusy(true);
    try {
      if (tab === 'receipt') {
        await supabase.rpc('create_financial_receipt', {
          p_client_id: clientId,
          p_amount: value,
          p_payment_method: method,
          p_description: description.trim() || null,
        });
        setSuccessMsg('تم تسجيل سند القبض وترحيل قيده، وانخفض رصيد العميل تلقائياً.');
      } else {
        await supabase.rpc('create_financial_disbursement', {
          p_amount: value,
          p_category_account_id: categoryId || null,
          p_payment_method: method,
          p_description: description.trim() || null,
        });
        setSuccessMsg('تم تسجيل سند الصرف وترحيل قيده تلقائياً.');
      }
      setAmount('');
      setDescription('');
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'حدث خطأ أثناء تسجيل السند');
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
            <h1 className="mt-3 text-2xl font-extrabold tracking-tight md:text-3xl">السندات (قبض / صرف)</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
              سندات بسيطة بلا مداخلة محاسبية: القبض يخفض رصيد العميل، والصرف يُسجَّل على صندوق أو بنك — وكلاهما يرُحَّل تلقائياً.
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
        <div className="grid grid-cols-2 gap-3">
          {([['receipt', 'سند قبض', HandCoins], ['disbursement', 'سند صرف', NotebookPen]] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => { setTab(key); setAmount(''); setDescription(''); }}
              className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold transition-colors ${
                tab === key ? 'border-primary bg-primary/10 text-primary' : 'border-border text-foreground hover:bg-muted'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {tab === 'receipt' ? (
            <div>
              <label className="mb-1.5 block text-sm font-semibold">العميل</label>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary bg-background"
              >
                <option value="">— اختر العميل —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name || c.phone || c.id}</option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="mb-1.5 block text-sm font-semibold">فئة الصرف</label>
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
          )}
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
          <div>
            <label className="mb-1.5 block text-sm font-semibold">الوصف (اختياري)</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={tab === 'receipt' ? 'مثال: دفعة من عميل نقداً' : 'مثال: صرف مبلغ سلفة'}
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
            {tab === 'receipt' ? 'تسجيل سند القبض' : 'تسجيل سند الصرف'}
          </button>
        </div>
      </section>

      {loading ? (
        <div className="p-10"><LoadingSpinner /></div>
      ) : error ? (
        <div className="p-4"><ErrorMessage message={error} /></div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="director-panel overflow-hidden rounded-2xl">
            <div className="flex items-center justify-between border-b border-border p-5">
              <div>
                <h2 className="text-base font-extrabold">آخر سندات القبض</h2>
                <p className="mt-1 text-xs text-muted-foreground">مرتحلة تلقائياً وتخفض رصيد العميل.</p>
              </div>
              <HandCoins className="h-5 w-5 text-primary" />
            </div>
            {receipts.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">لا توجد سندات قبض بعد.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-4 py-3">رقم السند</th>
                      <th className="px-4 py-3">التاريخ</th>
                      <th className="px-4 py-3">المبلغ</th>
                      <th className="px-4 py-3">الحالة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {receipts.map((r) => (
                      <tr key={r.id} className="hover:bg-muted/20">
                        <td className="px-4 py-3 font-bold" dir="ltr">#{r.receipt_number}</td>
                        <td className="px-4 py-3" dir="ltr">{r.receipt_date}</td>
                        <td className="px-4 py-3 font-bold" dir="ltr">{r.amount.toLocaleString()}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                            {r.status === 'posted' ? 'مرحّل' : r.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="director-panel overflow-hidden rounded-2xl">
            <div className="flex items-center justify-between border-b border-border p-5">
              <div>
                <h2 className="text-base font-extrabold">آخر حركات الصرف</h2>
                <p className="mt-1 text-xs text-muted-foreground">من الصندوق أو البنك مع قيدها المرتحل.</p>
              </div>
              <NotebookPen className="h-5 w-5 text-primary" />
            </div>
            {movements.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">لا توجد حركات صرف بعد.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-4 py-3">التاريخ</th>
                      <th className="px-4 py-3">النوع</th>
                      <th className="px-4 py-3">المبلغ</th>
                      <th className="px-4 py-3">الوصف</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {movements.map((m) => (
                      <tr key={m.id} className="hover:bg-muted/20">
                        <td className="px-4 py-3" dir="ltr">{m.movement_date}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                            {m.movement_type === 'disbursement' ? 'صرف' : m.movement_type}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-bold" dir="ltr">{m.amount.toLocaleString()}</td>
                        <td className="px-4 py-3">{m.description || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}