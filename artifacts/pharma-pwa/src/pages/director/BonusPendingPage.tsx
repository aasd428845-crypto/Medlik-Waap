import { useCallback, useEffect, useState } from 'react';
import { Search, RefreshCw, Eye, X, PlayCircle } from 'lucide-react';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { listPending, processPending, type PendingRow } from '@/lib/bonusFinancialApi';

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'معلّق', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  PROCESSED: { label: 'معالَج', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  FAILED: { label: 'فاشل', className: 'bg-red-50 text-red-700 border-red-200' },
};

const yer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function prettyJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v ?? '—');
  }
}

export function BonusPendingPage() {
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [statusFilter, setStatusFilter] = useState('PENDING');
  const [detail, setDetail] = useState<PendingRow | null>(null);
  const [processTarget, setProcessTarget] = useState<PendingRow | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      setRows(await listPending());
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'تعذر جلب الاستحقاقات المعلقة');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    window.setTimeout(() => setSuccessMsg(''), 4000);
  };

  const handleProcess = async () => {
    if (!processTarget) return;
    setBusy(true);
    try {
      const ledgerId = await processPending(processTarget.id);
      showSuccess(
        ledgerId
          ? 'تمت المعالجة وربط القيد بنجاح.'
          : 'انتهت المعالجة دون قيد جديد (قد يكون موجودًا مسبقًا) — تحقق من السجل.',
      );
      setProcessTarget(null);
      await fetchAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'حدث خطأ أثناء المعالجة');
    } finally {
      setBusy(false);
    }
  };

  const filtered = rows.filter((r) => !statusFilter || r.status === statusFilter);
  const pendingCount = rows.filter((r) => r.status === 'PENDING').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">الاستحقاقات المعلقة</h2>
          <p className="text-muted-foreground text-sm">
            {pendingCount > 0
              ? `${pendingCount} معلّقة بانتظار المعالجة — لا تُحذف أبدًا، وتتحول إلى معالَجة فقط`
              : 'طلبات الكسب المؤجلة من ترحيل الطلبات — تُعالج واحدًا واحدًا'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void fetchAll()}
          disabled={loading}
          className="inline-flex items-center gap-2 border rounded-lg bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          تحديث
        </button>
      </div>

      {successMsg && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">
          {successMsg}
        </div>
      )}

      <div className="bg-card border rounded-xl shadow-sm">
        <div className="p-4 border-b bg-muted/20 flex sm:justify-end">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border rounded-lg bg-background px-3 py-2 text-sm w-full sm:w-auto focus:ring-2 focus:ring-primary"
          >
            <option value="">كل الحالات</option>
            {Object.entries(STATUS_BADGE).map(([v, b]) => (
              <option key={v} value={v}>
                {b.label}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <LoadingSpinner />
        ) : error ? (
          <div className="p-4">
            <ErrorMessage message={error} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-muted/50 text-muted-foreground font-semibold border-b">
                <tr>
                  <th className="px-4 py-3 whitespace-nowrap text-center">القيمة المحسوبة</th>
                  <th className="px-4 py-3 whitespace-nowrap">الأساس</th>
                  <th className="px-4 py-3 whitespace-nowrap text-center">المحاولات</th>
                  <th className="px-4 py-3 whitespace-nowrap text-center">الحالة</th>
                  <th className="px-4 py-3 whitespace-nowrap">التاريخ</th>
                  <th className="px-4 py-3 whitespace-nowrap text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((r) => {
                  const badge = STATUS_BADGE[r.status] ?? STATUS_BADGE.PENDING;
                  return (
                    <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 text-center font-bold" dir="ltr">
                        {r.computed_value != null ? yer.format(r.computed_value) : '—'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground" dir="ltr">
                        {r.value_basis ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-center" dir="ltr">
                        {r.attempts}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium border ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs" dir="ltr">
                        {String(r.created_at).slice(0, 16).replace('T', ' ')}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => setDetail(r)}
                            className="p-2 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            title="عرض اللقطات والتفاصيل"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {r.status === 'PENDING' && (
                            <button
                              type="button"
                              onClick={() => setProcessTarget(r)}
                              disabled={busy}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors disabled:opacity-50"
                            >
                              <PlayCircle className="w-3.5 h-3.5" />
                              معالجة
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                      لا توجد استحقاقات مطابقة.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
          <div className="bg-card rounded-xl shadow-xl w-full max-w-2xl my-8">
            <div className="px-6 py-4 border-b flex justify-between items-center bg-muted/20">
              <h3 className="font-bold text-lg">لقطة الاستحقاق المعلق</h3>
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="إغلاق"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6 space-y-4 text-sm">
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                {[
                  ['الطلب', detail.order_id],
                  ['الحساب', detail.account_id],
                  ['القاعدة', detail.rule_id ?? '— (تعليق إيقاف: يُعاد التقييم عند المعالجة)'],
                  ['القيمة المحسوبة', detail.computed_value != null ? yer.format(detail.computed_value) : '—'],
                  ['المحاولات', String(detail.attempts)],
                  ['القيد المرتبط', detail.ledger_id ?? '—'],
                  ['سبب الخطأ', detail.error_reason ?? '—'],
                  ['مفتاح عدم التكرار', detail.idempotency_key ?? '—'],
                ].map(([k, v]) => (
                  <div key={k} className="border-b pb-2">
                    <dt className="text-muted-foreground text-xs mb-1">{k}</dt>
                    <dd className="font-medium break-all" dir="ltr">
                      {v}
                    </dd>
                  </div>
                ))}
              </dl>
              <div>
                <p className="text-xs font-bold text-muted-foreground mb-1">لقطة المنتجات</p>
                <pre className="bg-muted/50 rounded-lg p-3 text-xs overflow-x-auto" dir="ltr">
                  {prettyJson(detail.product_snapshot)}
                </pre>
              </div>
              <div>
                <p className="text-xs font-bold text-muted-foreground mb-1">لقطة القاعدة</p>
                <pre className="bg-muted/50 rounded-lg p-3 text-xs overflow-x-auto" dir="ltr">
                  {prettyJson(detail.rule_snapshot)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {processTarget && (
        <ConfirmDialog
          isOpen
          onClose={() => {
            if (!busy) setProcessTarget(null);
          }}
          onConfirm={() => void handleProcess()}
          title="معالجة الاستحقاق المعلق"
          message="ستتم معالجة هذا الاستحقاق (طلب واحد فقط) وربطه بالقيد الناتج. الصف يبقى محفوظًا كمعالَج ولا يُحذف."
          confirmLabel="معالجة"
        />
      )}

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Search className="w-3.5 h-3.5" />
        تتم المعالجة عبر RPC واحد لكل صف — لا معالجة جماعية حسب التصميم.
      </div>
    </div>
  );
}
