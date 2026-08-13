import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { OfferForm, type OfferFormInitial } from '@/components/director/OfferForm';
import { OffersPanel } from '@/components/director/OffersPanel';
import {
  getPromotionalOffer,
  updatePromotionalOffer,
  type OfferInput,
  type OfferProduct,
} from '@/lib/promotionalOffersApi';
import { listActiveProducts } from '@/lib/promotionalOffersApi';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';

export function EditPromotionalOfferPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [initial, setInitial] = useState<OfferFormInitial | null>(null);
  const [extraProducts, setExtraProducts] = useState<OfferProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    (async () => {
      if (!id) return;
      try {
        const [offer, products] = await Promise.all([
          getPromotionalOffer(id),
          listActiveProducts(),
        ]);
        if (!offer) {
          setError('لم يتم العثور على العرض المطلوب.');
          return;
        }
        if (offer.product_id && !products.some((p) => p.id === offer.product_id)) {
          setExtraProducts([
            { id: offer.product_id, name: offer.product_name, name_en: null, unit: null, is_active: false },
          ]);
        }
        setInitial({
          product_id: offer.product_id ?? '',
          discount_percent: offer.discount_percent,
          special_price: offer.special_price,
          start_date: offer.start_date,
          end_date: offer.end_date,
          target_governorate: offer.target_governorate,
          original_text: offer.discount_text || offer.description,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'تعذر تحميل بيانات العرض');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const handleSubmit = async (input: OfferInput) => {
    if (!id) return;
    setBusy(true);
    try {
      await updatePromotionalOffer(id, input);
      setSuccessMsg('تم تحديث العرض بنجاح.');
      window.setTimeout(() => navigate('/director/promotional-offers'), 1200);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'حدث خطأ أثناء تحديث العرض');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message={error} />;

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/director/promotional-offers"
          className="text-sm text-muted-foreground hover:text-primary inline-flex items-center gap-1 mb-2"
        >
          <ArrowRight className="w-4 h-4" />
          العودة إلى قائمة العروض
        </Link>
        <h2 className="text-2xl font-bold text-foreground">تعديل عرض ترويجي</h2>
        <p className="text-muted-foreground text-sm">عدّل بيانات العرض ثم احفظ التغييرات</p>
      </div>

      {successMsg && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">
          {successMsg}
        </div>
      )}

      {initial && (
        <div className="bg-card border rounded-xl shadow-sm">
          <OfferForm
            initial={initial}
            extraProducts={extraProducts}
            submitLabel="حفظ التعديلات"
            busy={busy}
            onSubmit={handleSubmit}
          />
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-lg font-bold text-foreground">إدارة سريعة للعروض الحالية</h3>
        <OffersPanel compact />
      </div>
    </div>
  );
}
