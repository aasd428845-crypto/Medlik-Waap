import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, XCircle, CheckCircle, Trash2, Search } from 'lucide-react';
import {
  listPromotionalOffers,
  setOfferActive,
  deletePromotionalOffer,
  type PromotionalOfferRow,
} from '@/lib/promotionalOffersApi';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';

interface Props {
  compact?: boolean;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function offerStatus(o: PromotionalOfferRow): { label: string; cls: string } {
  const today = todayStr();
  if (!o.is_active) return { label: 'موقوف', cls: 'bg-red-50 text-red-700 border-red-200' };
  if (o.end_date && String(o.end_date).slice(0, 10) < today) {
    return { label: 'منتهي', cls: 'bg-gray-100 text-gray-600 border-gray-200' };
  }
  if (o.start_date && String(o.start_date).slice(0, 10) > today) {
    return { label: 'قادم', cls: 'bg-blue-50 text-blue-700 border-blue-200' };
  }
  return { label: 'نشط', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
}

function offerValue(o: PromotionalOfferRow): string {
  if (o.discount_percent != null) return `خصم ${o.discount_percent}%`;
  if (o.special_price != null) return `سعر خاص ${o.special_price}`;
  return o.discount_text || o.description || '—';
}

export function OffersPanel({ compact = false }: Props) {
  const [offers, setOffers] = useState<PromotionalOfferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const [toggleTarget, setToggleTarget] = useState<PromotionalOfferRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PromotionalOfferRow | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchAll = async () => {
    try {
      setLoading(true);
      setError('');
      setOffers(await listPromotionalOffers());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر جلب العروض الترويجية');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    window.setTimeout(() => setSuccessMsg(''), 4000);
  };

  const handleToggle = async (o: PromotionalOfferRow) => {
    setBusy(true);
    try {
      await setOfferActive(o.id, !o.is_active);
      showSuccess(o.is_active ? 'تم إيقاف العرض.' : 'تم تفعيل العرض.');
      await fetchAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'حدث خطأ أثناء تغيير حالة العرض');
    } finally {
      setBusy(false);
      setToggleTarget(null);
    }
  };

  const handleDelete = async (o: PromotionalOfferRow) => {
    setBusy(true);
    try {
      await deletePromotionalOffer(o.id);
      showSuccess('تم حذف العرض.');
      await fetchAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'حدث خطأ أثناء حذف العرض');
    } finally {
      setBusy(false);
      setDeleteTarget(null);
    }
  };

  const filtered = offers.filter((o) => {
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return (
      (o.product_name ?? '').toLowerCase().includes(q) ||
      offerValue(o).toLowerCase().includes(q)
    );
  });

  return (
    <div className="bg-card border rounded-xl shadow-sm">
      <div className="p-4 border-b bg-muted/20">
        <div className="relative max-w-sm">
          <Search className="w-4 h-4 absolute right-3 top-2.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="بحث عن عرض..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-3 pr-10 py-2 border rounded-lg bg-background text-sm focus:ring-2 focus:ring-primary focus:border-transparent"
          />
        </div>
      </div>

      {successMsg && (
        <div className="mx-4 mt-4 rounded-md bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-sm text-emerald-700">
          {successMsg}
        </div>
      )}

      {loading ? (
        <LoadingSpinner />
      ) : error ? (
        <div className="p-4"><ErrorMessage message={error} /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-muted/50 text-muted-foreground font-semibold border-b">
              <tr>
                <th className="px-4 py-3 whitespace-nowrap">الصنف</th>
                <th className="px-4 py-3 whitespace-nowrap">العرض</th>
                {!compact && <th className="px-4 py-3 whitespace-nowrap">الفترة</th>}
                {!compact && <th className="px-4 py-3 whitespace-nowrap">المحافظة</th>}
                <th className="px-4 py-3 whitespace-nowrap text-center">الحالة</th>
                <th className="px-4 py-3 whitespace-nowrap text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((o) => {
                const status = offerStatus(o);
                return (
                  <tr key={o.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium text-foreground">
                      {o.product_name || '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <div className="text-foreground font-semibold">{offerValue(o)}</div>
                      {o.title ? <div className="text-xs text-muted-foreground">{o.title}</div> : null}
                    </td>
                    {!compact && (
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {o.start_date ? String(o.start_date).slice(0, 10) : '—'}
                        {o.end_date ? ` ← ${String(o.end_date).slice(0, 10)}` : ''}
                      </td>
                    )}
                    {!compact && (
                      <td className="px-4 py-3 text-muted-foreground">
                        {o.target_governorate || 'الكل'}
                      </td>
                    )}
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${status.cls}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1.5">
                        <Link
                          to={`/director/promotional-offers/${o.id}/edit`}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors"
                          title="تعديل العرض"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          تعديل
                        </Link>
                        <button
                          onClick={() => setToggleTarget(o)}
                          disabled={busy}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50"
                          title={o.is_active ? 'إيقاف العرض' : 'تفعيل العرض'}
                        >
                          {o.is_active ? (
                            <>
                              <XCircle className="w-3.5 h-3.5 text-red-600" />
                              <span className="text-red-700">إيقاف</span>
                            </>
                          ) : (
                            <>
                              <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                              <span className="text-emerald-700">تفعيل</span>
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => setDeleteTarget(o)}
                          disabled={busy}
                          className="p-2 text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                          title="حذف العرض"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={compact ? 4 : 6} className="px-4 py-8 text-center text-muted-foreground">
                    {offers.length === 0 ? 'لا توجد عروض ترويجية حتى الآن.' : 'لا توجد نتائج مطابقة.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {toggleTarget && (
        <ConfirmDialog
          isOpen
          onClose={() => setToggleTarget(null)}
          onConfirm={() => handleToggle(toggleTarget)}
          title={toggleTarget.is_active ? 'إيقاف العرض' : 'تفعيل العرض'}
          message={
            toggleTarget.is_active
              ? `هل أنت متأكد من إيقاف العرض "${toggleTarget.product_name || toggleTarget.title || ''}"؟ لن يظهر للعملاء حتى يُفعَّل مجدداً.`
              : `هل أنت متأكد من تفعيل العرض "${toggleTarget.product_name || toggleTarget.title || ''}"؟`
          }
          confirmLabel={toggleTarget.is_active ? 'إيقاف' : 'تفعيل'}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          isOpen
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => handleDelete(deleteTarget)}
          title="حذف العرض"
          message={`هل أنت متأكد من حذف العرض "${deleteTarget.product_name || deleteTarget.title || ''}" نهائياً؟ لا يمكن التراجع عن هذه الخطوة.`}
          confirmLabel="حذف"
        />
      )}
    </div>
  );
}
