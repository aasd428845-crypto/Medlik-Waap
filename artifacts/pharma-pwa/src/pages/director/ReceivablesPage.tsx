import { useCallback, useEffect, useState } from 'react';
import { Wallet, AlertTriangle, FileText, XCircle, Building2 } from 'lucide-react';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';
import {
  listReceivables,
  listClientInvoices,
  formatRatio,
  type ClientReceivable,
  type InvoiceRecord,
} from '@/lib/receivablesApi';

function statusBadge(s: InvoiceRecord['computed_status']): { label: string; cls: string } {
  if (s === 'paid') return { label: 'مسدد', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  if (s === 'overdue') return { label: 'متأخر', cls: 'bg-red-50 text-red-700 border-red-200' };
  return { label: 'معلّق', cls: 'bg-amber-50 text-amber-700 border-amber-200' };
}

export function ReceivablesPage() {
  const [clients, setClients] = useState<ClientReceivable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showOverdueOnly, setShowOverdueOnly] = useState(false);

  const [selected, setSelected] = useState<ClientReceivable | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      setClients(await listReceivables());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر جلب بيانات الذمم المدينة');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const visible = showOverdueOnly ? clients.filter((c) => c.exceeded) : clients;

  const openClient = async (c: ClientReceivable) => {
    setSelected(c);
    setInvoicesLoading(true);
    setInvoices([]);
    try {
      setInvoices(await listClientInvoices(c.id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'تعذر جلب سجل الفواتير');
    } finally {
      setInvoicesLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">الذمم المدينة (Receivables)</h2>
          <p className="text-muted-foreground text-sm">
            الحدود الائتمانية للعملاء والرصيد المستحق ونسب الاستخدام
          </p>
        </div>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showOverdueOnly}
            onChange={(e) => setShowOverdueOnly(e.target.checked)}
            className="w-4 h-4 accent-red-600"
          />
          <span className="text-sm font-medium text-red-700 inline-flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" />
            عرض المتجاوزين للحد فقط
          </span>
        </label>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorMessage message={error} />
      ) : (
        <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-muted/50 text-muted-foreground font-semibold border-b">
                <tr>
                  <th className="px-4 py-3 whitespace-nowrap">اسم المنشأة</th>
                  <th className="px-4 py-3 whitespace-nowrap text-center">الحد الائتماني</th>
                  <th className="px-4 py-3 whitespace-nowrap text-center">الرصيد الحالي المستحق</th>
                  <th className="px-4 py-3 whitespace-nowrap text-center">النسبة المستخدمة</th>
                  <th className="px-4 py-3 whitespace-nowrap text-center">الحالة</th>
                  <th className="px-4 py-3 whitespace-nowrap text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((c) => {
                  const pct = Number.isFinite(c.used_ratio) ? Math.min(c.used_ratio, 1) * 100 : 100;
                  const barCls =
                    c.exceeded
                      ? 'bg-red-500'
                      : c.used_ratio >= 0.9 ? 'bg-red-400' : c.used_ratio >= 0.6 ? 'bg-amber-400' : 'bg-emerald-500';
                  return (
                    <tr
                      key={c.id}
                      className={`transition-colors hover:bg-muted/30 ${c.exceeded ? 'bg-red-50/70' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className={`p-2 rounded-lg ${c.exceeded ? 'bg-red-100 text-red-600' : 'bg-primary/10 text-primary'}`}>
                            <Building2 className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="font-medium text-foreground">{c.org_name || c.name || '—'}</div>
                            {c.org_name && c.name ? (
                              <div className="text-xs text-muted-foreground">{c.name}</div>
                            ) : (
                              <div className="text-xs text-muted-foreground">{c.governorate || c.phone || ''}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center" dir="ltr">
                        {c.credit_limit > 0 ? c.credit_limit.toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`font-bold ${c.current_balance > 0 ? 'text-red-600' : 'text-foreground'}`} dir="ltr">
                          {c.current_balance.toLocaleString()}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 justify-center">
                          <div className="w-24 h-2 rounded-full bg-muted overflow-hidden">
                            <div className={`h-full rounded-full ${barCls}`} style={{ width: `${pct}%` }} />
                          </div>
                          <span className={`text-xs font-bold ${c.exceeded ? 'text-red-600' : 'text-muted-foreground'}`}>
                            {formatRatio(c.used_ratio)}
                          </span>
                          {c.exceeded && (
                            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-200">
                              <AlertTriangle className="w-3 h-3" />
                              تجاوز الحد
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${
                          c.account_status === 'active'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : c.account_status === 'suspended'
                              ? 'bg-red-50 text-red-700 border-red-200'
                              : 'bg-amber-50 text-amber-700 border-amber-200'
                        }`}>
                          {c.account_status === 'active' ? 'نشط' : c.account_status === 'suspended' ? 'موقوف' : 'غير مفعّل'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => openClient(c)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          سجل الفواتير
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                      {clients.length === 0
                        ? 'لا يوجد عملاء مسجلون حالياً.'
                        : 'لا يوجد عملاء متجاوزون لحدودهم الائتمانية.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* تفاصيل العميل: سجل الفواتير بترتيب زمني */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
          <div className="bg-card rounded-xl shadow-xl w-full max-w-2xl my-8 animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b flex justify-between items-center bg-muted/20">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <Wallet className="w-5 h-5 text-primary" />
                سجل فواتير: {selected.org_name || selected.name || '—'}
              </h3>
              <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground">
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            <div className="px-6 py-4 grid grid-cols-3 gap-3 border-b bg-muted/10">
              <div>
                <p className="text-xs text-muted-foreground">الحد الائتماني</p>
                <p className="font-bold text-foreground" dir="ltr">
                  {selected.credit_limit > 0 ? selected.credit_limit.toLocaleString() : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">الرصيد المستحق</p>
                <p className={`font-bold ${selected.exceeded ? 'text-red-600' : 'text-foreground'}`} dir="ltr">
                  {selected.current_balance.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">النسبة المستخدمة</p>
                <p className={`font-bold ${selected.exceeded ? 'text-red-600' : 'text-foreground'}`}>
                  {formatRatio(selected.used_ratio)}
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="bg-muted/50 text-muted-foreground font-semibold border-b">
                  <tr>
                    <th className="px-4 py-3 whitespace-nowrap">التاريخ</th>
                    <th className="px-4 py-3 whitespace-nowrap text-center">المبلغ</th>
                    <th className="px-4 py-3 whitespace-nowrap text-center">تاريخ الاستحقاق</th>
                    <th className="px-4 py-3 whitespace-nowrap text-center">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {invoicesLoading ? (
                    <tr><td colSpan={4}><LoadingSpinner /></td></tr>
                  ) : invoices.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                        لا توجد فواتير لهذا العميل بعد.
                      </td>
                    </tr>
                  ) : (
                    invoices.map((inv) => {
                      const b = statusBadge(inv.computed_status);
                      return (
                        <tr key={inv.id} className="hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3 text-muted-foreground" dir="ltr">
                            {inv.created_at ? String(inv.created_at).slice(0, 10) : '—'}
                          </td>
                          <td className="px-4 py-3 text-center font-bold text-foreground" dir="ltr">
                            {inv.amount.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-center text-muted-foreground" dir="ltr">
                            {inv.due_date ?? '—'}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${b.cls}`}>
                              {b.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="bg-muted/50 px-6 py-4 flex justify-end border-t">
              <button
                onClick={() => setSelected(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium border hover:bg-background transition-colors"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}