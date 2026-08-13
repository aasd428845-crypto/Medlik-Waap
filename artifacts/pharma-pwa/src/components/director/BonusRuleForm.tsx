import { useEffect, useState } from 'react';
import { ShoppingCart, Gift, Layers, CalendarDays, MapPin, Package } from 'lucide-react';
import { ProductSearch } from '@/components/director/ProductSearch';
import {
  listActiveProducts,
  type OfferProduct,
} from '@/lib/promotionalOffersApi';
import { listBranches, type BranchRow } from '@/lib/branchManagerApi';
import type { BonusRuleInput } from '@/lib/bonusRulesApi';

export interface BonusRuleFormInitial {
  product_id: string;
  buy_quantity: number;
  free_quantity: number;
  is_stackable: boolean;
  start_date: string | null;
  end_date: string | null;
  target_governorate: string | null;
}

interface Props {
  initial?: BonusRuleFormInitial;
  extraProducts?: OfferProduct[];
  submitLabel: string;
  busy: boolean;
  onSubmit: (input: BonusRuleInput) => void;
}

function dateInput(v: string | null | undefined): string {
  return v ? String(v).slice(0, 10) : '';
}

export function BonusRuleForm({ initial, extraProducts = [], submitLabel, busy, onSubmit }: Props) {
  const [products, setProducts] = useState<OfferProduct[]>([]);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [loadError, setLoadError] = useState('');

  const [productId, setProductId] = useState(initial?.product_id ?? '');
  const [buyText, setBuyText] = useState(initial?.buy_quantity ? String(initial.buy_quantity) : '');
  const [freeText, setFreeText] = useState(initial?.free_quantity ? String(initial.free_quantity) : '');
  const [stackable, setStackable] = useState(initial?.is_stackable ?? false);
  const [startDate, setStartDate] = useState(dateInput(initial?.start_date));
  const [endDate, setEndDate] = useState(dateInput(initial?.end_date));
  const [governorate, setGovernorate] = useState(initial?.target_governorate ?? '');

  useEffect(() => {
    (async () => {
      try {
        const [p, b] = await Promise.all([listActiveProducts(), listBranches()]);
        const seen = new Set(p.map((x) => x.id));
        const merged = [...p, ...extraProducts.filter((x) => !seen.has(x.id))];
        setProducts(merged);
        setBranches(b);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'تعذر تحميل بيانات النموذج');
      }
    })();
  }, [extraProducts]);

  const governorates = Array.from(
    new Set(
      branches
        .map((b) => b.governorate?.trim())
        .filter((g): g is string => Boolean(g)),
    ),
  ).sort((a, b) => a.localeCompare(b, 'ar'));

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const buy = Number(buyText);
    const free = Number(freeText);
    if (!buyText.trim() || !Number.isInteger(buy) || buy < 1) {
      alert('يرجى إدخال كمية الشراء المطلوبة (عدد صحيح أكبر من صفر).');
      return;
    }
    if (!freeText.trim() || !Number.isInteger(free) || free < 1) {
      alert('يرجى إدخال الكمية المجانية (عدد صحيح أكبر من صفر).');
      return;
    }
    if (endDate && startDate && endDate < startDate) {
      alert('تاريخ النهاية لا يمكن أن يكون قبل تاريخ البداية.');
      return;
    }

    onSubmit({
      product_id: productId,
      buy_quantity: buy,
      free_quantity: free,
      is_stackable: stackable,
      start_date: startDate || null,
      end_date: endDate || null,
      target_governorate: governorate || null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-5">
      {loadError && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
          {loadError}
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-sm font-medium flex items-center gap-1.5">
          <Package className="w-4 h-4 text-primary" />
          الصنف (اختياري — اتركه فارغاً لتطبيق القاعدة على جميع الأصناف)
        </label>
        <ProductSearch
          products={products}
          value={productId}
          onChange={setProductId}
          allowEmpty
          emptyLabel="جميع الأصناف (قاعدة عامة)"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium flex items-center gap-1.5">
            <ShoppingCart className="w-4 h-4 text-primary" />
            كمية الشراء * (اشترِ)
          </label>
          <input
            required
            type="number"
            min={1}
            step={1}
            dir="ltr"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary text-left"
            value={buyText}
            onChange={(e) => setBuyText(e.target.value)}
            placeholder="مثال: 10"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium flex items-center gap-1.5">
            <Gift className="w-4 h-4 text-primary" />
            الكمية المجانية * (احصل على)
          </label>
          <input
            required
            type="number"
            min={1}
            step={1}
            dir="ltr"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary text-left"
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            placeholder="مثال: 1"
          />
        </div>
      </div>

      <label className="flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer hover:bg-muted/40 transition-colors">
        <input
          type="checkbox"
          checked={stackable}
          onChange={(e) => setStackable(e.target.checked)}
          className="w-4 h-4 accent-primary"
        />
        <div>
          <div className="text-sm font-medium flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-primary" />
            قابلة للتراكم
          </div>
          <p className="text-xs text-muted-foreground">
            عند تفعيله يمكن تطبيق أكثر من قاعدة بونص على نفس الطلب في نفس الوقت.
          </p>
        </div>
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium flex items-center gap-1.5">
            <CalendarDays className="w-4 h-4 text-primary" />
            تاريخ البداية (اختياري)
          </label>
          <input
            type="date"
            dir="ltr"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary text-left"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium flex items-center gap-1.5">
            <CalendarDays className="w-4 h-4 text-primary" />
            تاريخ النهاية (اختياري)
          </label>
          <input
            type="date"
            dir="ltr"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary text-left"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium flex items-center gap-1.5">
          <MapPin className="w-4 h-4 text-primary" />
          المحافظة المستهدفة (اختياري)
        </label>
        <select
          className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary bg-background"
          value={governorate}
          onChange={(e) => setGovernorate(e.target.value)}
        >
          <option value="">كل المحافظات (بدون تحديد)</option>
          {governorates.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
      </div>

      <div className="mt-6 flex justify-end gap-3 pt-4 border-t">
        <button
          type="submit"
          disabled={busy}
          className="px-5 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-60 shadow-sm"
        >
          {busy ? 'جارٍ الحفظ...' : submitLabel}
        </button>
      </div>
    </form>
  );
}
