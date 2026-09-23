import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, RefreshCw, Eye, X } from 'lucide-react';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { listLedger, reverseBonusTxn, type LedgerRow } from '@/lib/bonusFinancialApi';

const TXN_LABEL: Record<string, string> = {
  EARN: 'اكتساب',
  REDEEM_PRODUCT: 'استرداد منتج',
  ORDER_DISCOUNT: 'خصم طلب',
  CASH_WITHDRAWAL: 'سحب نقدي',
  REFUND: 'استرداد مبلغ',
  REVERSAL: 'عكس قيد',
  ADJUSTMENT: 'تسوية',
  EXPIRATION: 'انتهاء صلاحية',
  OPENING_BALANCE: 'رصيد افتتاحي',
  LEGACY_MIGRATION: 'ترحيل قديم',
};

const ALL_TYPES = Object.keys(TXN_LABEL);

const yer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function fmtDate(iso: string): string {
  return String(iso).slice(0, 16).replace('T', ' ');
}

export function BonusLedgerPage() {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [detail, setDetail] = useState<LedgerRow | null>(null);
  const [reverseTarget, setReverseTarget] = useState<LedgerRow | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [busy, setBusy] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      setRows(await listLedger(300));
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'تعذر جلب دفتر البونص');
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

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return rows.filter((r) => {
      if (typeFilter && r.txn_type !== typeFilter) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        (r.account_id ?? '').toLowerCase().includes(q) ||
        (r.reference ?? '').toLowerCase().includes(q) ||
        (r.order_id ?? '').toLowerCase().includes(q) ||
        (r.notes ?? '').toLowerCase().includes(q)
      );
    });
  }, [rows, typeFilter, statusFilter, searchTerm]);

  const handleReverse = async () => {
    if (!reverseTarget) return;
    if (!reverseReason.trim()) {
      alert('أدخل سبب العكس — السبب إلزامي للتدقيق.');
      return;
    }
    setBusy(true);
    try {
      await reverseBonusTxn({ ledgerId: reverseTarget.id, reason: reverseReason.trim() });
      setReverseTarget(null);
      setReverseReason('');
      showSuccess('تم إنشاء قيد عكسي مرتبط بالقيد الأصلي.');
      await fetchAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'حدث خطأ أثناء عكس القيد');
    } finally {
      setBusy(false);
    }
  };

  const canReverse = (r: LedgerRow) =>
    r.status === 'POSTED' && r.txn_type !== 'REVERSAL' && Number(r.amount) !== 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">دفتر البونص المالي</h2>
          <p className="text-muted-foreground text-sm">
            كل حركات المحفظة المالية — الإلغاء يتم عبر قيد عكسي فقط، ولا حذف أبدًا
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
        <div className="p-4 border-b flex flex-col lg:flex-row gap-3 bg-muted/20">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute right-3 top-3 text-muted-foreground" />
            <input
              type="text"
              placeholder="بحث برقم الحساب أو المرجع أو الطلب..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-3 pr-10 py-2 border rounded-lg bg-background text-sm focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="border rounded-lg bg-background px-3 py-2 text-sm focus:ring-2 focus:ring-primary"
          >
            <option value="">كل الأنواع</option>
            {ALL_TYPES.map((t) => (
              <option key={t} value={t}>
                {TXN_LABEL[t]}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border rounded-lg bg-background px-3 py-2 text-sm focus:ring-2 focus:ring-primary"
          >
            <option value="">كل الحالات</option>
            <option value="POSTED">مرحّل</option>
            <option value="PENDING">معلّق</option>
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
                  <th className="px-4 py-3 whitespace-nowrap">النوع</th>
                  <th className="px-4 py-3 whitespace-nowrap text-center">المبلغ (ر.ي)</th>
                  <th className="px-4 py-3 whitespace-nowrap text-center">الحالة</th>
                  <th className="px-4 py-3 whitespace-nowrap">التاريخ</th>
                  <th className="px-4 py-3 whitespace-nowrap">المرجع</th>
                  <th className="px-4 py-3 whitespace-nowrap text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium">{TXN_LABEL[r.txn_type] ?? r.txn_type}</td>
                    <td
                      className={`px-4 py-3 text-center font-bold ${
                        Number(r.amount) >= 0 ? 'text-emerald-700' : 'text-red-700'
                      }`}
                      dir="ltr"
                    >
                      {Number(r.amount) >= 0 ? '+' : ''}
                      {yer.format(Number(r.amount))}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium border ${
                          r.status === 'POSTED'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-amber-50 text-amber-700 border-amber-200'
                        }`}
                      >
                        {r.status === 'POSTED' ? 'مرحّل' : 'معلّق'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs" dir="ltr">
                      {fmtDate(r.created_at)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs truncate max-w-[180px]">
                      {r.reference || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => setDetail(r)}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                          title="عرض التفاصيل"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {canReverse(r) && (
                          <button
                            type="button"
                            onClick={() => {
                              setReverseTarget(r);
                              setReverseReason('');
                            }}
                            disabled={busy}
                            className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 transition-colors disabled:opacity-50"
                            title="إنشاء قيد عكسي مرتبط"
                          >
                            عكس
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                      لا توجد حركات مطابقة.
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
          <div className="bg-card rounded-xl shadow-xl w-full max-w-lg my-8">
            <div className="px-6 py-4 border-b flex justify-between items-center bg-muted/20">
              <h3 className="font-bold text-lg">تفاصيل الحركة المالية</h3>
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="إغلاق"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <dl className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              {[
                ['النوع', TXN_LABEL[detail.txn_type] ?? detail.txn_type],
                ['المبلغ (ر.ي)', yer.format(Number(detail.amount))],
                ['الحالة', detail.status === 'POSTED' ? 'مرحّل' : 'معلّق'],
                ['التاريخ', fmtDate(detail.created_at)],
                ['الحساب', detail.account_id],
                ['الطلب', detail.order_id ?? '—'],
                ['السحب', detail.withdrawal_id ?? '—'],
                ['الاسترداد', detail.redemption_id ?? '—'],
                ['يعكس القيد', detail.reverses_id ?? '—'],
                ['القاعدة', detail.rule_id ?? '—'],
                ['المرجع', detail.reference ?? '—'],
                ['ملاحظات', detail.notes ?? '—'],
              ].map(([k, v]) => (
                <div key={k} className="border-b pb-2">
                  <dt className="text-muted-foreground text-xs mb-1">{k}</dt>
                  <dd className="font-medium break-all" dir={/[\u0600-\u06FF]/.test(v) ? 'rtl' : 'ltr'}>
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="px-6 py-4 border-t text-xs text-muted-foreground">
              المعرف: <span dir="ltr">{detail.id}</span> — لا يمكن حذف أو تعديل القيود المرحّلة.
            </div>
          </div>
        </div>
      )}

      {reverseTarget && (
        <ConfirmDialog
          isOpen
          onClose={() => {
            if (!busy) {
              setReverseTarget(null);
              setReverseReason('');
            }
          }}
          onConfirm={() => void handleReverse()}
          title="إنشاء قيد عكسي"
          message={
            <div className="space-y-3">
              <p>
                {`سيتم إنشاء قيد عكسي مرتبط بالقيد (${TXN_LABEL[reverseTarget.txn_type] ?? reverseTarget.txn_type} — ${yer.format(
                  Number(reverseTarget.amount),
                )} ر.ي). القيد الأصلي يبقى كما هو.`}
              </p>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  سبب العكس (إلزامي للتدقيق)
                </label>
                <textarea
                  rows={3}
                  value={reverseReason}
                  onChange={(e) => setReverseReason(e.target.value)}
                  placeholder="مثال: خطأ في المبلغ المعتمد"
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:ring-2 focus:ring-primary resize-none"
                />
              </div>
              {busy && <p className="text-xs">جارٍ إنشاء القيد العكسي...</p>}
            </div>
          }
          confirmLabel="تأكيد العكس"
        />
      )}

      <p className="text-xs text-muted-foreground">
        للعودة إلى لوحة المحفظة: <Link to="/director/bonus-fin/dashboard" className="text-primary hover:underline">المحفظة المالية للبونص</Link>
      </p>
    </div>
  );
}
