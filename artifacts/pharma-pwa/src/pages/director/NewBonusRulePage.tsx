import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { BonusRuleForm } from '@/components/director/BonusRuleForm';
import { BonusRulesPanel } from '@/components/director/BonusRulesPanel';
import { createBonusRule, type BonusRuleInput } from '@/lib/bonusRulesApi';

export function NewBonusRulePage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const handleSubmit = async (input: BonusRuleInput) => {
    setBusy(true);
    try {
      await createBonusRule(input);
      setSuccessMsg('تم إنشاء قاعدة البونص بنجاح، وتم إرسال إشعار تلقائي للعملاء.');
      window.setTimeout(() => navigate('/director/bonus-rules'), 1200);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'حدث خطأ أثناء إنشاء القاعدة');
    } finally {
      setBusy(false);
    }
  };

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
        <h2 className="text-2xl font-bold text-foreground">إنشاء قاعدة بونص جديدة</h2>
        <p className="text-muted-foreground text-sm">
          حدّد الصنف (أو اتركه لجميع الأصناف)، وكمية الشراء والكمية المجانية
        </p>
      </div>

      {successMsg && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">
          {successMsg}
        </div>
      )}

      <div className="bg-card border rounded-xl shadow-sm">
        <BonusRuleForm submitLabel="إنشاء القاعدة" busy={busy} onSubmit={handleSubmit} />
      </div>

      <div className="space-y-2">
        <h3 className="text-lg font-bold text-foreground">إدارة سريعة للقواعد الحالية</h3>
        <p className="text-sm text-muted-foreground">
          يمكنك إيقاف أو حذف أو تعديل أي قاعدة من هنا مباشرة دون مغادرة الصفحة.
        </p>
        <BonusRulesPanel compact />
      </div>
    </div>
  );
}
