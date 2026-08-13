import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { OfferForm } from '@/components/director/OfferForm';
import { OffersPanel } from '@/components/director/OffersPanel';
import { createPromotionalOffer, type OfferInput } from '@/lib/promotionalOffersApi';

export function NewPromotionalOfferPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const handleSubmit = async (input: OfferInput) => {
    setBusy(true);
    try {
      await createPromotionalOffer(input);
      setSuccessMsg('تم إنشاء العرض بنجاح، وتم إرسال إشعار تلقائي للعملاء.');
      window.setTimeout(() => navigate('/director/promotional-offers'), 1200);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'حدث خطأ أثناء إنشاء العرض');
    } finally {
      setBusy(false);
    }
  };

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
        <h2 className="text-2xl font-bold text-foreground">إنشاء عرض ترويجي جديد</h2>
        <p className="text-muted-foreground text-sm">
          حدّد الصنف، وطريقة الخصم (نسبة أو سعر خاص)، وفترة العرض، والمحافظة المستهدفة
        </p>
      </div>

      {successMsg && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">
          {successMsg}
        </div>
      )}

      <div className="bg-card border rounded-xl shadow-sm">
        <OfferForm submitLabel="إنشاء العرض" busy={busy} onSubmit={handleSubmit} />
      </div>

      <div className="space-y-2">
        <h3 className="text-lg font-bold text-foreground">إدارة سريعة للعروض الحالية</h3>
        <p className="text-sm text-muted-foreground">
          يمكنك إيقاف أو حذف أو تعديل أي عرض من هنا مباشرة دون مغادرة الصفحة.
        </p>
        <OffersPanel compact />
      </div>
    </div>
  );
}
