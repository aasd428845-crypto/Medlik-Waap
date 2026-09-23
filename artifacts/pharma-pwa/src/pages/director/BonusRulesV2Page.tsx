import { useCallback, useEffect, useState } from 'react';
import { Search, Plus, Pencil, CheckCircle, XCircle, Archive } from 'lucide-react';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  listBonusRulesV2,
  createBonusRuleV2,
  updateBonusRuleV2,
  setBonusRuleV2Status,
  type BonusRuleV2Row,
  type BonusRuleV2Input,
  type RuleType,
  type RuleStatus,
} from '@/lib/bonusFinancialApi';
import { listActiveProducts, type OfferProduct } from '@/lib/promotionalOffersApi';
import { listBranches, type BranchRow } from '@/lib/branchManagerApi';

const RULE_TYPE_LABEL: Record<string, string> = {
  PRODUCT: 'منتج',
  MONETARY: 'نقدي',
  GENERAL: 'عام',
};

const BASIS_LABEL: Record<string, string> = {
  PER_ORDER: 'لكل طلب',
  PER_UNIT: 'لكل وحدة',
  PER_PRODUCT: 'لكل منتج',
};

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  active: { label: 'نشطة', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  suspended: { label: 'موقوفة', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  archived: { label: 'مؤرشفة', className: 'bg-gray-100 text-gray-600 border-gray-200' },
};

interface RuleForm {
  name: string;
  description: string;
  rule_type: RuleType;
  status: RuleStatus;
  start_date: string;
  end_date: string;
  min_order_value: string;
  min_quantity: string;
  bonus_value: string;
  bonus_percent: string;
  max_earn: string;
  governorate: string;
  customer_type: string;
  products_include: string[];
  products_exclude: string[];
  is_stackable: boolean;
  priority: string;
  usage_limit: string;
  allow_product: boolean;
  allow_discount: boolean;
  allow_cash: boolean;
  cash_min: string;
  cash_max: string;
  cash_monthly_limit: string;
  approval_required: boolean;
  product_values: Record<string, string>;
}

const EMPTY_FORM: RuleForm = {
  name: '',
  description: '',
  rule_type: 'PRODUCT',
  status: 'active',
  start_date: '',
  end_date: '',
  min_order_value: '',
  min_quantity: '',
  bonus_value: '',
  bonus_percent: '',
  max_earn: '',
  governorate: '',
  customer_type: '',
  products_include: [],
  products_exclude: [],
  is_stackable: false,
  priority: '0',
  usage_limit: '',
  allow_product: true,
  allow_discount: false,
  allow_cash: false,
  cash_min: '',
  cash_max: '',
  cash_monthly_limit: '',
  approval_required: true,
  product_values: {},
};

function toForm(r: BonusRuleV2Row): RuleForm {
  const pv: Record<string, string> = {};
  const raw = (r as unknown as { product_values?: Record<string, unknown> | null }).product_values;
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) pv[k] = String(v ?? '');
  }
  return {
    name: r.name ?? '',
    description: r.description ?? '',
    rule_type: (r.rule_type as RuleType) ?? 'PRODUCT',
    status: (r.status as RuleStatus) ?? 'active',
    start_date: r.start_date ? String(r.start_date).slice(0, 10) : '',
    end_date: r.end_date ? String(r.end_date).slice(0, 10) : '',
    min_order_value: r.min_order_value != null ? String(r.min_order_value) : '',
    min_quantity: r.min_quantity != null ? String(r.min_quantity) : '',
    bonus_value: r.bonus_value != null ? String(r.bonus_value) : '',
    bonus_percent: r.bonus_percent != null ? String(r.bonus_percent) : '',
    max_earn: r.max_earn != null ? String(r.max_earn) : '',
    governorate: r.governorate ?? '',
    customer_type: r.customer_type ?? '',
    products_include: r.products_include ?? [],
    products_exclude: r.products_exclude ?? [],
    is_stackable: !!r.is_stackable,
    priority: String(r.priority ?? 0),
    usage_limit: r.usage_limit != null ? String(r.usage_limit) : '',
    allow_product: r.allow_product ?? true,
    allow_discount: !!r.allow_discount,
    allow_cash: !!r.allow_cash,
    cash_min: r.cash_min != null ? String(r.cash_min) : '',
    cash_max: r.cash_max != null ? String(r.cash_max) : '',
    cash_monthly_limit: r.cash_monthly_limit != null ? String(r.cash_monthly_limit) : '',
    approval_required: r.approval_required ?? true,
    product_values: pv,
  };
}

// UI validation mirroring the DB validation trigger (bonus_rules_v2_validate_trigger).
// The database remains the source of truth; this only gives early feedback.
function validateForm(f: RuleForm): string | null {
  if (!f.name.trim()) return 'أدخل اسم القاعدة.';
  if (f.rule_type === 'MONETARY') {
    const hasPercent = f.bonus_percent.trim() !== '';
    const hasValue = f.bonus_value.trim() !== '';
    if (hasPercent === hasValue)
      return 'القاعدة النقدية تتطلب النسبة أو القيمة الثابتة — واحدة فقط.';
  }
  if (f.rule_type === 'GENERAL') {
    if (f.products_include.length > 0 || f.products_exclude.length > 0)
      return 'القاعدة العامة لا ترتبط بمنتجات.';
  }
  if (f.start_date && f.end_date && f.start_date > f.end_date)
    return 'تاريخ البدء بعد تاريخ الانتهاء.';
  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  if (f.bonus_value.trim() !== '' && !(Number(f.bonus_value) >= 0))
    return 'قيمة البونص يجب أن تكون صفرًا أو أكبر.';
  if (f.bonus_percent.trim() !== '') {
    const p = Number(f.bonus_percent);
    if (!(p >= 0 && p <= 100)) return 'النسبة يجب أن تكون بين 0 و 100.';
  }
  if (f.max_earn.trim() !== '' && !(Number(f.max_earn) > 0))
    return 'الحد الأقصى يجب أن يكون أكبر من صفر.';
  if (f.min_quantity.trim() !== '' && !(Number.isInteger(Number(f.min_quantity)) && Number(f.min_quantity) > 0))
    return 'الحد الأدنى للكمية يجب أن يكون عددًا صحيحًا أكبر من صفر.';
  if (f.usage_limit.trim() !== '' && !(Number.isInteger(Number(f.usage_limit)) && Number(f.usage_limit) > 0))
    return 'حد الاستخدام يجب أن يكون عددًا صحيحًا أكبر من صفر.';
  if (num(f.min_order_value) !== null && !(num(f.min_order_value)! >= 0)) return 'الحد الأدنى للطلب غير صالح.';
  if (num(f.cash_min) !== null && !(num(f.cash_min)! >= 0)) return 'الحد الأدنى للسحب غير صالح.';
  if (num(f.cash_max) !== null && !(num(f.cash_max)! >= 0)) return 'الحد الأقصى للسحب غير صالح.';
  if (num(f.cash_monthly_limit) !== null && !(num(f.cash_monthly_limit)! >= 0))
    return 'الحد الشهري للسحب غير صالح.';
  if (!Number.isInteger(Number(f.priority || '0'))) return 'الأولوية يجب أن تكون عددًا صحيحًا.';
  for (const [pid, v] of Object.entries(f.product_values)) {
    if (v.trim() === '') continue;
    if (!(Number(v) >= 0)) return 'قيم المنتجات يجب أن تكون صفرًا أو أكبر.';
    if (f.products_exclude.includes(pid))
      return 'منتج له قيمة خاصة ومستثنى في نفس الوقت — أزل التعارض.';
  }
  return null;
}

function toInput(f: RuleForm, products: OfferProduct[]): BonusRuleV2Input {
  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  const int = (v: string) => (v.trim() === '' ? null : parseInt(v, 10));
  const known = new Set(products.map((p) => p.id));
  return {
    name: f.name.trim(),
    description: f.description.trim() || null,
    rule_type: f.rule_type,
    status: f.status,
    start_date: f.start_date || null,
    end_date: f.end_date || null,
    min_order_value: num(f.min_order_value),
    min_quantity: int(f.min_quantity),
    bonus_value: num(f.bonus_value),
    bonus_percent: num(f.bonus_percent),
    max_earn: num(f.max_earn),
    eligible_customers: null,
    customer_type: f.customer_type.trim() || null,
    governorate: f.governorate.trim() || null,
    products_include: f.products_include.filter((id) => known.has(id)),
    products_exclude: f.products_exclude.filter((id) => known.has(id)),
    is_stackable: f.is_stackable,
    priority: parseInt(f.priority || '0', 10) || 0,
    usage_limit: int(f.usage_limit),
    allow_product: f.allow_product,
    allow_discount: f.allow_discount,
    allow_cash: f.allow_cash,
    cash_min: num(f.cash_min),
    cash_max: num(f.cash_max),
    cash_monthly_limit: num(f.cash_monthly_limit),
    approval_required: f.approval_required,
    product_values: null,
  };
}

export function BonusRulesV2Page() {
  const [rules, setRules] = useState<BonusRuleV2Row[]>([]);
  const [products, setProducts] = useState<OfferProduct[]>([]);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<BonusRuleV2Row | null>(null);
  const [form, setForm] = useState<RuleForm>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);

  const [statusTarget, setStatusTarget] = useState<{ row: BonusRuleV2Row; next: RuleStatus } | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [r, p, b] = await Promise.all([
        listBonusRulesV2(),
        listActiveProducts(),
        listBranches(),
      ]);
      setRules(r);
      setProducts(p);
      setBranches(b);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'تعذر جلب قواعد البونص المالية');
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

  const set = <K extends keyof RuleForm>(key: K, value: RuleForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const toggleId = (key: 'products_include' | 'products_exclude', id: string) =>
    setForm((prev) => ({
      ...prev,
      [key]: prev[key].includes(id) ? prev[key].filter((x) => x !== id) : [...prev[key], id],
    }));

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setIsModalOpen(true);
  };

  const openEdit = (r: BonusRuleV2Row) => {
    setEditing(r);
    setForm(toForm(r));
    setFormError('');
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const err = validateForm(form);
    if (err) {
      setFormError(err);
      return;
    }
    // value_basis is derived: PER_PRODUCT when per-product values exist for
    // the selected products, PER_UNIT when a quantity threshold drives the
    // value, otherwise PER_ORDER. Stored values are shown verbatim elsewhere.
    const hasProductValues = Object.entries(form.product_values).some(
      ([pid, v]) => v.trim() !== '' && form.products_include.includes(pid),
    );
    const basis = hasProductValues ? 'PER_PRODUCT' : form.min_quantity.trim() !== '' ? 'PER_UNIT' : 'PER_ORDER';
    const raw = toInput(form, products);
    const pv: Record<string, number> = {};
    for (const [pid, v] of Object.entries(form.product_values)) {
      if (v.trim() === '' || !form.products_include.includes(pid)) continue;
      pv[pid] = Number(v);
    }
    const payload: BonusRuleV2Input = {
      ...raw,
      value_basis: basis as BonusRuleV2Input['value_basis'],
      product_values: Object.keys(pv).length > 0 ? pv : null,
    };

    setSaveBusy(true);
    try {
      if (editing) {
        await updateBonusRuleV2(editing.id, payload);
        showSuccess('تم تحديث القاعدة بنجاح.');
      } else {
        await createBonusRuleV2(payload);
        showSuccess('تم إنشاء القاعدة بنجاح.');
      }
      setIsModalOpen(false);
      await fetchAll();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'حدث خطأ أثناء الحفظ');
    } finally {
      setSaveBusy(false);
    }
  };

  const handleStatus = async () => {
    if (!statusTarget) return;
    setStatusBusy(true);
    try {
      await setBonusRuleV2Status(statusTarget.row.id, statusTarget.next);
      showSuccess('تم تحديث حالة القاعدة.');
      setStatusTarget(null);
      await fetchAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'حدث خطأ أثناء تحديث الحالة');
    } finally {
      setStatusBusy(false);
    }
  };

  const filtered = rules.filter((r) => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      if (!(r.name ?? '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const productNameOf = (id: string) => products.find((p) => p.id === id)?.name ?? id.slice(0, 8);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">قواعد البونص المالية</h2>
          <p className="text-muted-foreground text-sm">
            قواعد المحفظة المالية (bonus_rules_v2) — منفصلة عن قواعد اشترِ واحصل القديمة
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          إضافة قاعدة مالية
        </button>
      </div>

      {successMsg && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">
          {successMsg}
        </div>
      )}

      <div className="bg-card border rounded-xl shadow-sm">
        <div className="p-4 border-b flex flex-col sm:flex-row gap-4 items-center bg-muted/20">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 absolute right-3 top-3 text-muted-foreground" />
            <input
              type="text"
              placeholder="بحث باسم القاعدة..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-3 pr-10 py-2 border rounded-lg bg-background text-sm focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border rounded-lg bg-background px-3 py-2 text-sm w-full sm:w-auto focus:ring-2 focus:ring-primary"
          >
            <option value="">كل الحالات</option>
            <option value="active">نشطة</option>
            <option value="suspended">موقوفة</option>
            <option value="archived">مؤرشفة</option>
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
                  <th className="px-4 py-3 whitespace-nowrap">الاسم</th>
                  <th className="px-4 py-3 whitespace-nowrap">النوع</th>
                  <th className="px-4 py-3 whitespace-nowrap">القيمة</th>
                  <th className="px-4 py-3 whitespace-nowrap text-center">الحالة</th>
                  <th className="px-4 py-3 whitespace-nowrap text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((r) => {
                  const badge = STATUS_BADGE[r.status] ?? STATUS_BADGE.active;
                  const valueText =
                    r.bonus_percent != null
                      ? `${r.bonus_percent}%`
                      : r.bonus_value != null
                        ? `${Number(r.bonus_value).toLocaleString()} ر.ي`
                        : '—';
                  return (
                    <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground">
                        {r.name}
                        <div className="text-xs text-muted-foreground font-normal">
                          أولوية {r.priority ?? 0}
                          {r.is_stackable ? ' • تراكمية' : ''}
                        </div>
                      </td>
                      <td className="px-4 py-3">{RULE_TYPE_LABEL[r.rule_type] ?? r.rule_type}</td>
                      <td className="px-4 py-3 font-bold" dir="ltr">
                        {valueText}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium border ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(r)}
                            disabled={statusBusy}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors disabled:opacity-50"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            تعديل
                          </button>
                          {r.status === 'active' ? (
                            <button
                              type="button"
                              onClick={() => setStatusTarget({ row: r, next: 'suspended' })}
                              disabled={statusBusy}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors disabled:opacity-50"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              إيقاف
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setStatusTarget({ row: r, next: 'active' })}
                              disabled={statusBusy}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors disabled:opacity-50"
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                              تفعيل
                            </button>
                          )}
                          {r.status !== 'archived' && (
                            <button
                              type="button"
                              onClick={() => setStatusTarget({ row: r, next: 'archived' })}
                              disabled={statusBusy}
                              className="p-2 text-muted-foreground hover:bg-muted rounded transition-colors disabled:opacity-50"
                              title="أرشفة"
                            >
                              <Archive className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                      لا توجد قواعد مالية مطابقة. أنشئ أول قاعدة بزر أعلاه.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {statusTarget && (
        <ConfirmDialog
          isOpen
          onClose={() => setStatusTarget(null)}
          onConfirm={() => void handleStatus()}
          title="تغيير حالة القاعدة"
          message={`تأكيد تغيير حالة "${statusTarget.row.name}" إلى "${
            STATUS_BADGE[statusTarget.next]?.label ?? statusTarget.next
          }"؟`}
          confirmLabel="تأكيد"
        />
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
          <div className="bg-card rounded-xl shadow-xl w-full max-w-2xl my-8">
            <div className="px-6 py-4 border-b flex justify-between items-center bg-muted/20">
              <h3 className="font-bold text-lg">
                {editing ? 'تعديل القاعدة المالية' : 'إضافة قاعدة مالية'}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="إغلاق"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>
            <form onSubmit={(e) => void handleSave(e)} className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              {formError && <ErrorMessage message={formError} />}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-sm font-medium">اسم القاعدة *</label>
                  <input
                    required
                    value={form.name}
                    onChange={(e) => set('name', e.target.value)}
                    placeholder="مثال: بونص الولاء الشهري"
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-sm font-medium">الوصف</label>
                  <input
                    value={form.description}
                    onChange={(e) => set('description', e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">النوع *</label>
                  <select
                    value={form.rule_type}
                    onChange={(e) => set('rule_type', e.target.value as RuleType)}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary"
                  >
                    <option value="PRODUCT">منتج</option>
                    <option value="MONETARY">نقدي</option>
                    <option value="GENERAL">عام</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">الحالة</label>
                  <select
                    value={form.status}
                    onChange={(e) => set('status', e.target.value as RuleStatus)}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary"
                  >
                    <option value="active">نشطة</option>
                    <option value="suspended">موقوفة</option>
                    <option value="archived">مؤرشفة</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">القيمة الثابتة (ر.ي)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    dir="ltr"
                    value={form.bonus_value}
                    onChange={(e) => set('bonus_value', e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary text-left"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">النسبة % (للنقدي فقط — واحدة منهما)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    dir="ltr"
                    value={form.bonus_percent}
                    onChange={(e) => set('bonus_percent', e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary text-left"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">الحد الأقصى للكسب (ر.ي)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    dir="ltr"
                    value={form.max_earn}
                    onChange={(e) => set('max_earn', e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary text-left"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">الأولوية (الأصغر أولاً)</label>
                  <input
                    type="number"
                    step="1"
                    dir="ltr"
                    value={form.priority}
                    onChange={(e) => set('priority', e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary text-left"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">من تاريخ</label>
                  <input
                    type="date"
                    value={form.start_date}
                    onChange={(e) => set('start_date', e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">إلى تاريخ</label>
                  <input
                    type="date"
                    value={form.end_date}
                    onChange={(e) => set('end_date', e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">الحد الأدنى للطلب (ر.ي)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    dir="ltr"
                    value={form.min_order_value}
                    onChange={(e) => set('min_order_value', e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary text-left"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">الحد الأدنى للكمية</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    dir="ltr"
                    value={form.min_quantity}
                    onChange={(e) => set('min_quantity', e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary text-left"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">حد الاستخدام (لكل حساب)</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    dir="ltr"
                    value={form.usage_limit}
                    onChange={(e) => set('usage_limit', e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary text-left"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">المحافظة (اختياري)</label>
                  <select
                    value={form.governorate}
                    onChange={(e) => set('governorate', e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary"
                  >
                    <option value="">— كل المحافظات —</option>
                    {Array.from(new Set(branches.map((b) => b.governorate).filter(Boolean))).map(
                      (g) => (
                        <option key={g as string} value={g as string}>
                          {g}
                        </option>
                      ),
                    )}
                  </select>
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-sm font-medium">نوع العميل (نص حر — يُحفظ كما هو)</label>
                  <input
                    value={form.customer_type}
                    onChange={(e) => set('customer_type', e.target.value)}
                    placeholder="مثال: صيدلية"
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-sm font-medium">المنتجات المشمولة (اترك فارغًا للكل)</label>
                  <div className="border rounded-lg p-3 max-h-40 overflow-y-auto space-y-1.5 bg-background">
                    {products.length === 0 && (
                      <p className="text-xs text-muted-foreground">لا توجد منتجات نشطة.</p>
                    )}
                    {products.map((p) => (
                      <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.products_include.includes(p.id)}
                          onChange={() => toggleId('products_include', p.id)}
                          className="rounded border-input text-primary focus:ring-primary w-4 h-4"
                        />
                        {p.name}
                        {p.unit ? <span className="text-xs text-muted-foreground">({p.unit})</span> : null}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-sm font-medium">المنتجات المستثناة (تتغلب على المشمولة)</label>
                  <div className="border rounded-lg p-3 max-h-40 overflow-y-auto space-y-1.5 bg-background">
                    {products.map((p) => (
                      <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.products_exclude.includes(p.id)}
                          onChange={() => toggleId('products_exclude', p.id)}
                          className="rounded border-input text-primary focus:ring-primary w-4 h-4"
                        />
                        {p.name}
                      </label>
                    ))}
                  </div>
                </div>
                {form.products_include.length > 0 && (
                  <div className="sm:col-span-2 space-y-1.5">
                    <label className="text-sm font-medium">
                      قيم خاصة لكل منتج (اختياري — لوضع PER_PRODUCT)
                    </label>
                    {form.products_include.map((pid) => (
                      <div key={pid} className="flex items-center gap-2">
                        <span className="flex-1 text-sm truncate">{productNameOf(pid)}</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          dir="ltr"
                          value={form.product_values[pid] ?? ''}
                          onChange={(e) =>
                            set('product_values', { ...form.product_values, [pid]: e.target.value })
                          }
                          placeholder="0"
                          className="w-32 border rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary text-left"
                        />
                      </div>
                    ))}
                  </div>
                )}
                <div className="sm:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {(
                    [
                      ['is_stackable', 'تراكمية'],
                      ['allow_product', 'منتجات'],
                      ['allow_discount', 'خصم'],
                      ['allow_cash', 'نقدي'],
                      ['approval_required', 'موافقة'],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form[key]}
                        onChange={(e) => set(key, e.target.checked)}
                        className="rounded border-input text-primary focus:ring-primary w-4 h-4"
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">أدنى سحب نقدي</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    dir="ltr"
                    value={form.cash_min}
                    onChange={(e) => set('cash_min', e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary text-left"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">أقصى سحب نقدي</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    dir="ltr"
                    value={form.cash_max}
                    onChange={(e) => set('cash_max', e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary text-left"
                  />
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-sm font-medium">الحد الشهري للسحب</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    dir="ltr"
                    value={form.cash_monthly_limit}
                    onChange={(e) => set('cash_monthly_limit', e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary text-left"
                  />
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium border rounded-lg hover:bg-muted"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saveBusy}
                  className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-60"
                >
                  {saveBusy ? 'جارٍ الحفظ...' : editing ? 'حفظ التعديلات' : 'إنشاء القاعدة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
