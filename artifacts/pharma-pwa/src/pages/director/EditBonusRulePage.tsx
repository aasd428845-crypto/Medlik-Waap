import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { BonusRuleForm, type BonusRuleFormInitial } from '@/components/director/BonusRuleForm';
import { BonusRulesPanel } from '@/components/director/BonusRulesPanel';
import {
  getBonusRule,
  updateBonusRule,
  type BonusRuleInput,
} from '@/lib/bonusRulesApi';
import { listActiveProducts, type OfferProduct } from '@/lib/promotionalOffersApi';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';

export function EditBonusRulePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [initial, setInitial] = useState<BonusRuleFormInitial | null>(null);
  const [extraProducts, setExtraProducts] = useState<OfferProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    (async () => {
      if (!id) return;
      try {
        const [rule, products] = await Promise.all([
          getBonusRule(id),
          listActiveProducts(),
        ]);
        if (!rule) {
          setError('لم يتم العثور على قاعدة البونص المطلوبة.');
          return;
        }
        if (rule.product_id && !products.some((p) => p.id === rule.product_id)) {
          setExtraProducts([
            { id: rule.product_id, name: rule.product_name, name_en: null, unit: null, is_active: false },
          ]);
        }
        setInitial({
          product_id: rule.product_id ?? '',
          buy_quantity: rule.buy_quantity,
          free_quantity: rule.free_quantity,
          is_stackable: rule.is_stackable,
          start_date: rule.start_date,
          end_date: rule.end_date,
          target_governorate: rule.target_governorate,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'تعذر تحميل بيانات القاعدة');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const handleSubmit = async (input: BonusRuleInput) => {
    if (!id) return;
    setBusy(true);
    try {
      await updateBonusRule(id, input);
      setSuccessMsg('تم تحديث القاعدة بنجاح.');
      window.setTimeout(() => navigate('/director/bonus-rules'), 1200);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'حدث خطأ أثناء تحديث القاعدة');
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
          to="/director/bonus-rules"
          className="text-sm text-muted-foreground hover:text-primary inline-flex items-center gap-1 mb-2"
        >
          <ArrowRight className="w-4 h-4" />
          العودة إلى قائمة قواعد البونص
        </Link>
        <h2 className="text-2xl font-bold text-foreground">تعديل قاعدة بونص</h2>
        <p className="text-muted-foreground text-sm">عدّل بيانات القاعدة ثم احفظ التغييرات</p>
      </div>

      {successMsg && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">
          {successMsg}
        </div>
      )}

      {initial && (
        <div className="bg-card border rounded-xl shadow-sm">
          <BonusRuleForm
            initial={initial}
            extraProducts={extraProducts}
            submitLabel="حفظ التعديلات"
            busy={busy}
            onSubmit={handleSubmit}
          />
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-lg font-bold text-foreground">إدارة سريعة للقواعد الحالية</h3>
        <BonusRulesPanel compact />
      </div>
    </div>
  );
}
