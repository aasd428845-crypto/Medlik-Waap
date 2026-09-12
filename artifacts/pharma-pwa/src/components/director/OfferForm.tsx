import { useEffect, useState } from 'react';
import { Percent, Wallet, CalendarDays, MapPin, Tag } from 'lucide-react';
import { ProductSearch } from '@/components/director/ProductSearch';
import {
  listActiveProducts,
  type OfferInput,
  type OfferProduct,
} from '@/lib/promotionalOffersApi';
import { listBranches, type BranchRow } from '@/lib/branchManagerApi';

export interface OfferFormInitial {
  product_id: string;
  discount_percent: number | null;
  special_price: number | null;
  start_date: string | null;
  end_date: string | null;
  target_governorate: string | null;
  original_text?: string | null;
}

interface Props {
  initial?: OfferFormInitial;
  extraProducts?: OfferProduct[];
  submitLabel: string;
  busy: boolean;
  submitError?: string;
  onSubmit: (input: OfferInput) => void;
}

function dateInput(v: string | null | undefined): string {
  return v ? String(v).slice(0, 10) : '';
}

type OfferMode = 'discount' | 'special_price' | '';

export function OfferForm({ initial, extraProducts = [], submitLabel, busy, submitError, onSubmit }: Props) {
  const [products, setProducts] = useState<OfferProduct[]>([]);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [loadError, setLoadError] = useState('');

  const [productId, setProductId] = useState(initial?.product_id ?? '');
  const [discountText, setDiscountText] = useState(
    initial?.discount_percent != null ? String(initial.discount_percent) : '',
  );
  const [priceText, setPriceText] = useState(
    initial?.special_price != null ? String(initial.special_price) : '',
  );
  const [startDate, setStartDate] = useState(dateInput(initial?.start_date));
  const [endDate, setEndDate] = useState(dateInput(initial?.end_date));
  const [governorate, setGovernorate] = useState(initial?.target_governorate ?? '');
  const [mode, setMode] = useState<OfferMode>(
    initial?.discount_percent != null ? 'discount' : initial?.special_price != null ? 'special_price' : '',
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

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
  }, []);

  const governorates = Array.from(
    new Set(
      branches
        .map((b) => b.governorate?.trim())
        .filter((g): g is string => Boolean(g)),
    ),
  ).sort((a, b) => a.localeCompare(b, 'ar'));

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const errors: Record<string, string> = {};
    if (!productId) {
      errors.product = 'يرجى اختيار الصنف الذي سيُطبَّق عليه العرض.';
    }
    if (!mode) {
      errors.mode = 'اختر طريقة واحدة للعرض: نسبة خصم أو سعر خاص.';
    }
    const hasDiscount = mode === 'discount';
    const hasPrice = mode === 'special_price';
    const discountValue = hasDiscount ? Number(discountText) : null;
    const priceValue = hasPrice ? Number(priceText) : null;
    if (hasDiscount && (discountText.trim() === '' || Number.isNaN(discountValue) || discountValue! <= 0 || discountValue! > 100)) {
      errors.discount = 'أدخل نسبة خصم بين 1 و100.';
    }
    if (hasPrice && (priceText.trim() === '' || Number.isNaN(priceValue) || priceValue! <= 0)) {
      errors.price = 'أدخل سعرًا خاصًا صحيحًا أكبر من صفر.';
    }
    if (!startDate) {
      errors.startDate = 'يرجى تحديد تاريخ بداية العرض.';
    }
    if (endDate && endDate < startDate) {
      errors.endDate = 'تاريخ النهاية لا يمكن أن يكون بعد تاريخ البداية.';
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    onSubmit({
      product_id: productId,
      discount_percent: discountValue,
      special_price: priceValue,
      start_date: startDate || null,
      end_date: endDate || null,
      target_governorate: governorate || null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-5">
      {submitError && (
        <div className="rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive" role="alert">
          {submitError}
        </div>
      )}
      {loadError && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
          {loadError}
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-sm font-medium flex items-center gap-1.5">
          <Tag className="w-4 h-4 text-primary" />
          الصنف (بحث وتحديد) *
        </label>
        {fieldErrors.product && <p className="text-xs font-semibold text-destructive">{fieldErrors.product}</p>}
        <ProductSearch
          products={products}
          value={productId}
          onChange={(value) => {
            setProductId(value);
            setFieldErrors((current) => ({ ...current, product: '' }));
          }}
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">طريقة العرض *</label>
        {fieldErrors.mode && <p className="text-xs font-semibold text-destructive">{fieldErrors.mode}</p>}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => {
              setMode('discount');
              setPriceText('');
              setFieldErrors((current) => ({ ...current, mode: '', price: '' }));
            }}
            className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${mode === 'discount' ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted'}`}
            aria-pressed={mode === 'discount'}
          >
            نسبة خصم
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('special_price');
              setDiscountText('');
              setFieldErrors((current) => ({ ...current, mode: '', discount: '' }));
            }}
            className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${mode === 'special_price' ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted'}`}
            aria-pressed={mode === 'special_price'}
          >
            سعر خاص
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium flex items-center gap-1.5">
            <Percent className="w-4 h-4 text-primary" />
            نسبة الخصم %
          </label>
          {fieldErrors.discount && <p className="text-xs font-semibold text-destructive">{fieldErrors.discount}</p>}
          <input
            type="number"
            min={1}
            max={100}
            dir="ltr"
            disabled={mode !== 'discount'}
            aria-invalid={!!fieldErrors.discount}
            className={`w-full rounded-lg border px-3 py-2 text-sm text-left focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:bg-muted/50 ${fieldErrors.discount ? 'border-destructive' : ''}`}
            value={discountText}
            onChange={(e) => {
              setDiscountText(e.target.value);
              setFieldErrors((current) => ({ ...current, discount: '' }));
            }}
            placeholder="مثال: 15"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium flex items-center gap-1.5">
            <Wallet className="w-4 h-4 text-primary" />
            سعر خاص
          </label>
          {fieldErrors.price && <p className="text-xs font-semibold text-destructive">{fieldErrors.price}</p>}
          <input
            type="number"
            min={0}
            step="0.01"
            dir="ltr"
            disabled={mode !== 'special_price'}
            aria-invalid={!!fieldErrors.price}
            className={`w-full rounded-lg border px-3 py-2 text-sm text-left focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:bg-muted/50 ${fieldErrors.price ? 'border-destructive' : ''}`}
            value={priceText}
            onChange={(e) => {
              setPriceText(e.target.value);
              setFieldErrors((current) => ({ ...current, price: '' }));
            }}
            placeholder="مثال: 1000"
          />
          <p className="text-xs text-muted-foreground">اختر نسبة الخصم أو السعر الخاص (واحد فقط).</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium flex items-center gap-1.5">
            <CalendarDays className="w-4 h-4 text-primary" />
            تاريخ البداية *
          </label>
          {fieldErrors.startDate && <p className="text-xs font-semibold text-destructive">{fieldErrors.startDate}</p>}
          <input
            type="date"
            dir="ltr"
            aria-invalid={!!fieldErrors.startDate}
            className={`w-full rounded-lg border px-3 py-2 text-sm text-left focus:ring-2 focus:ring-primary ${fieldErrors.startDate ? 'border-destructive' : ''}`}
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              setFieldErrors((current) => ({ ...current, startDate: '' }));
            }}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium flex items-center gap-1.5">
            <CalendarDays className="w-4 h-4 text-primary" />
            تاريخ النهاية
          </label>
          {fieldErrors.endDate && <p className="text-xs font-semibold text-destructive">{fieldErrors.endDate}</p>}
          <input
            type="date"
            dir="ltr"
            aria-invalid={!!fieldErrors.endDate}
            className={`w-full rounded-lg border px-3 py-2 text-sm text-left focus:ring-2 focus:ring-primary ${fieldErrors.endDate ? 'border-destructive' : ''}`}
            value={endDate}
            onChange={(e) => {
              setEndDate(e.target.value);
              setFieldErrors((current) => ({ ...current, endDate: '' }));
            }}
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
        <p className="text-xs text-muted-foreground">
          عند اختيار محافظة سيُوجَّه الإشعار تلقائياً لعملائها.
        </p>
      </div>

      {initial?.original_text && (
        <div className="rounded-md bg-muted/40 border px-4 py-3 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">النص الأصلي للعرض: </span>
          {initial.original_text}
        </div>
      )}

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
