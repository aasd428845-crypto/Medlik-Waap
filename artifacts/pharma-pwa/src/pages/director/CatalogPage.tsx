import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { PharmaProduct } from '@/types/models';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CatalogImportDialog } from '@/components/director/CatalogImportDialog';
import { CatalogImportValues, catalogProductPayload } from '@/lib/catalogImport';
import { Search, Plus, Edit2, Trash2, CheckCircle, XCircle, Upload } from 'lucide-react';

function mapRowToProduct(row: Record<string, unknown>): PharmaProduct {
  return {
    productId: row.id as string,
    sku: (row.sku as string) ?? '',
    commercialName: (row.commercial_name as string) ?? '',
    scientificName: (row.scientific_name as string) ?? '',
    manufacturer: (row.manufacturer as string) ?? '',
    dosageForm: (row.dosage_form as string) ?? '',
    strength: (row.strength as string) ?? '',
    isColdChain: (row.is_cold_chain as boolean) ?? false,
    isControlledSubstance: (row.is_controlled_substance as boolean) ?? false,
    unit: (row.unit as string) ?? '',
    packSize: (row.pack_size as number) ?? 1,
    price: (row.price as number) ?? 0,
    description: (row.description as string) ?? '',
    isActive: (row.is_active as boolean) ?? true,
  };
}

function productToDbPayload(p: Omit<PharmaProduct, 'productId'>) {
  return {
    sku: p.sku,
    commercial_name: p.commercialName,
    scientific_name: p.scientificName || null,
    manufacturer: p.manufacturer || null,
    dosage_form: p.dosageForm,
    strength: p.strength || null,
    is_cold_chain: p.isColdChain,
    is_controlled_substance: p.isControlledSubstance,
    unit: p.unit,
    pack_size: p.packSize,
    price: p.price,
    description: p.description || null,
    is_active: p.isActive,
    // These columns are required by the shared Flutter schema.
    name: p.commercialName,
    name_en: p.scientificName || null,
    category: p.dosageForm || 'أخرى',
    unit_price: p.price,
  };
}

function databaseErrorMessage(error: unknown): { message: string; field?: string } {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const normalized = rawMessage.toLowerCase();
  const columnMatch = rawMessage.match(/column ["']([^"']+)["']/i);
  const column = columnMatch?.[1];
  const fieldMap: Record<string, string> = {
    sku: 'sku',
    commercial_name: 'commercialName',
    name: 'commercialName',
    scientific_name: 'scientificName',
    manufacturer: 'manufacturer',
    dosage_form: 'dosageForm',
    category: 'dosageForm',
    strength: 'strength',
    unit: 'unit',
    pack_size: 'packSize',
    price: 'price',
    unit_price: 'price',
    description: 'description',
  };

  if (normalized.includes('duplicate key') && normalized.includes('sku')) {
    return { field: 'sku', message: 'هذا SKU مستخدم مسبقًا. استخدم SKU مختلفًا أو افتح المنتج الموجود للتعديل.' };
  }
  if (column && fieldMap[column]) {
    const labels: Record<string, string> = {
      sku: 'SKU',
      commercialName: 'الاسم التجاري',
      scientificName: 'الاسم العلمي',
      manufacturer: 'الشركة المصنعة',
      dosageForm: 'الشكل الدوائي',
      strength: 'التركيز',
      unit: 'الوحدة',
      packSize: 'حجم العبوة',
      price: 'السعر',
      description: 'الوصف',
    };
    return { field: fieldMap[column], message: `حقل ${labels[fieldMap[column]]} مطلوب لإكمال حفظ المنتج.` };
  }
  if (normalized.includes('row-level security') || normalized.includes('permission denied')) {
    return { message: 'ليس لديك صلاحية حفظ المنتجات. تأكد من الدخول بحساب المدير العام.' };
  }
  return { message: 'تعذر حفظ المنتج. راجع القيم المدخلة وتأكد من اتصال قاعدة البيانات ثم حاول مرة أخرى.' };
}

export function CatalogPage() {
  const [products, setProducts] = useState<PharmaProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [searchTerm, setSearchTerm] = useState('');
  const [filterForm, setFilterForm] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<PharmaProduct | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');

  useEffect(() => { fetchProducts(); }, []);

  const fetchProducts = async () => {
    try {
      setLoading(true);
      const { data, error: err } = await supabase.from('products').select('*');
      if (err) throw err;
      setProducts((data ?? []).map(r => mapRowToProduct(r as Record<string, unknown>)));
    } catch (err) {
      console.error(err);
      setError('تعذر جلب بيانات المنتجات');
    } finally {
      setLoading(false);
    }
  };

  const filteredProducts = products.filter(p => {
    if (activeOnly && !p.isActive) return false;
    if (filterForm && p.dosageForm !== filterForm) return false;
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      if (!p.commercialName?.toLowerCase().includes(search) && !p.scientificName?.toLowerCase().includes(search)) return false;
    }
    return true;
  });

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      const { error: err } = await supabase.from('products').delete().eq('id', deleteConfirm);
      if (err) throw err;
      setProducts(products.filter(p => p.productId !== deleteConfirm));
    } catch {
      alert('خطأ أثناء الحذف');
    }
    setDeleteConfirm(null);
  };

  const toggleActive = async (product: PharmaProduct) => {
    try {
      const { error: err } = await supabase
        .from('products')
        .update({ is_active: !product.isActive })
        .eq('id', product.productId);
      if (err) throw err;
      setProducts(products.map(p => p.productId === product.productId ? { ...p, isActive: !p.isActive } : p));
    } catch {
      alert('حدث خطأ');
    }
  };

  const openAdd = () => {
    setFieldErrors({});
    setFormError('');
    setEditingProduct({
      productId: '',
      sku: '',
      commercialName: '',
      scientificName: '',
      manufacturer: '',
      dosageForm: 'أقراص',
      strength: '',
      isColdChain: false,
      isControlledSubstance: false,
      unit: '',
      packSize: 1,
      price: 0,
      description: '',
      isActive: true,
    });
    setIsModalOpen(true);
  };

  const saveProduct = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingProduct) return;
    setFieldErrors({});
    setFormError('');

    const validationErrors: Record<string, string> = {};
    if (!editingProduct.sku.trim()) validationErrors.sku = 'أدخل SKU أو الباركود الخاص بالمنتج.';
    if (!editingProduct.commercialName.trim()) validationErrors.commercialName = 'أدخل الاسم التجاري للمنتج.';
    if (!editingProduct.dosageForm.trim()) validationErrors.dosageForm = 'اختر الشكل الدوائي للمنتج.';
    if (!editingProduct.unit.trim()) validationErrors.unit = 'أدخل وحدة البيع مثل علبة أو شريط.';
    if (!Number.isInteger(editingProduct.packSize) || editingProduct.packSize < 1) validationErrors.packSize = 'حجم العبوة يجب أن يكون رقمًا صحيحًا أكبر من صفر.';
    if (!Number.isFinite(editingProduct.price) || editingProduct.price < 0) validationErrors.price = 'السعر يجب أن يكون رقمًا يساوي صفرًا أو أكبر.';
    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors);
      setFormError('راجع الحقول المحددة أدناه ثم حاول حفظ المنتج مرة أخرى.');
      return;
    }

    try {
      const { productId, ...rest } = editingProduct;
      const payload = productToDbPayload(rest);

      if (productId) {
        const { error: err } = await supabase.from('products').update(payload).eq('id', productId);
        if (err) throw err;
        setProducts(products.map(p => p.productId === productId ? { ...p, ...rest } : p));
      } else {
        const { data: newRow, error: err } = await supabase.from('products').insert(payload).select().single();
        if (err) throw err;
        setProducts([...products, mapRowToProduct(newRow as Record<string, unknown>)]);
      }
      setIsModalOpen(false);
    } catch (err) {
      console.error(err);
      const friendlyError = databaseErrorMessage(err);
      if (friendlyError.field) {
        setFieldErrors({ [friendlyError.field]: friendlyError.message });
      } else {
        setFormError(friendlyError.message);
      }
    }
  };

  const importProducts = async (rows: CatalogImportValues[]) => {
    const { error: err } = await supabase
      .from('products')
      .upsert(rows.map(catalogProductPayload), { onConflict: 'sku' });
    if (err) {
      const friendlyError = databaseErrorMessage(err);
      throw new Error(friendlyError.message);
    }
    await fetchProducts();
    setIsImportOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-2xl font-bold text-foreground">كتالوج المنتجات</h2>
          <p className="text-muted-foreground text-sm">إدارة الأدوية والأصناف في النظام</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <button
            type="button"
            onClick={() => setIsImportOpen(true)}
            className="flex items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-4 py-2 font-medium text-primary transition-colors hover:bg-primary/10"
          >
            <Upload className="h-4 w-4" />
            استيراد منتجات (Excel/CSV)
          </button>
          <button
            type="button"
            onClick={openAdd}
            className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            إضافة منتج
          </button>
        </div>
      </div>

      <div className="bg-card border rounded-xl shadow-sm">
        <div className="p-4 border-b flex flex-col sm:flex-row gap-4 items-center bg-muted/20">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 absolute right-3 top-3 text-muted-foreground" />
            <input
              type="text"
              placeholder="بحث بالاسم التجاري أو العلمي..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-3 pr-10 py-2 border rounded-lg bg-background text-sm focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>

          <div className="flex gap-4 w-full sm:w-auto">
            <select
              value={filterForm}
              onChange={e => setFilterForm(e.target.value)}
              className="border rounded-lg bg-background px-3 py-2 text-sm flex-1 sm:flex-none focus:ring-2 focus:ring-primary"
            >
              <option value="">كل الأشكال الدوائية</option>
              <option value="أقراص">أقراص</option>
              <option value="كبسول">كبسول</option>
              <option value="شراب">شراب</option>
              <option value="حقن">حقن</option>
              <option value="بخاخ">بخاخ</option>
              <option value="كريم">كريم</option>
              <option value="مرهم">مرهم</option>
              <option value="قطرة">قطرة</option>
              <option value="أخرى">أخرى</option>
            </select>

            <label className="flex items-center gap-2 text-sm cursor-pointer whitespace-nowrap">
              <input
                type="checkbox"
                checked={activeOnly}
                onChange={e => setActiveOnly(e.target.checked)}
                className="rounded border-input text-primary focus:ring-primary w-4 h-4"
              />
              إظهار النشطة فقط
            </label>
          </div>
        </div>

        {loading ? (
          <LoadingSpinner />
        ) : error ? (
          <div className="p-4"><ErrorMessage message={error} /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-muted/50 text-muted-foreground font-semibold border-b">
                <tr>
                  <th className="px-4 py-3 whitespace-nowrap">الاسم التجاري</th>
                  <th className="px-4 py-3 whitespace-nowrap">الاسم العلمي</th>
                  <th className="px-4 py-3 whitespace-nowrap">الشكل والتركيز</th>
                  <th className="px-4 py-3 whitespace-nowrap">الشركة المصنعة</th>
                  <th className="px-4 py-3 whitespace-nowrap">السعر</th>
                  <th className="px-4 py-3 whitespace-nowrap text-center">الحالة</th>
                  <th className="px-4 py-3 whitespace-nowrap text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredProducts.map(product => (
                  <tr key={product.productId} className={`hover:bg-muted/30 transition-colors ${!product.isActive ? 'opacity-60 bg-muted/10' : ''}`}>
                    <td className="px-4 py-3 font-medium text-foreground">
                      <div className="flex flex-col">
                        <span>{product.commercialName}</span>
                        <span className="text-xs text-muted-foreground">{product.sku}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{product.scientificName}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-secondary text-secondary-foreground">
                        {product.dosageForm}
                      </span>
                      <span className="text-muted-foreground text-xs block mt-1">{product.strength}</span>
                    </td>
                    <td className="px-4 py-3">{product.manufacturer}</td>
                    <td className="px-4 py-3 font-bold">${product.price?.toFixed(2) || '0.00'}</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => toggleActive(product)}
                        className="inline-flex items-center justify-center p-1 rounded hover:bg-muted transition-colors"
                        title={product.isActive ? 'تعطيل' : 'تفعيل'}
                      >
                        {product.isActive ? (
                          <CheckCircle className="w-5 h-5 text-emerald-500" />
                        ) : (
                          <XCircle className="w-5 h-5 text-muted-foreground" />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => { setEditingProduct(product); setIsModalOpen(true); }}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(product.productId)}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredProducts.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      لا توجد منتجات تطابق البحث.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={handleDelete}
        title="حذف منتج"
        message="هل أنت متأكد من حذف هذا المنتج نهائياً؟ هذا الإجراء لا يمكن التراجع عنه."
        confirmLabel="حذف"
      />

      <CatalogImportDialog
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onConfirm={importProducts}
      />

      {/* Add/Edit Modal */}
      {isModalOpen && editingProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
          <div className="bg-card rounded-xl shadow-xl w-full max-w-2xl my-8 animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b flex justify-between items-center bg-muted/20">
              <h3 className="font-bold text-lg">{editingProduct.productId ? 'تعديل منتج' : 'إضافة منتج جديد'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={saveProduct} className="p-6">
              {formError && (
                <div className="mb-5 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm font-semibold text-destructive" role="alert">
                  {formError}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">الباركود / SKU *</label>
                  {fieldErrors.sku && <p className="text-xs font-semibold text-destructive">{fieldErrors.sku}</p>}
                  <input aria-invalid={!!fieldErrors.sku} className={`w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-primary ${fieldErrors.sku ? 'border-destructive' : ''}`}
                    value={editingProduct.sku} onChange={e => setEditingProduct({ ...editingProduct, sku: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">الاسم التجاري *</label>
                  {fieldErrors.commercialName && <p className="text-xs font-semibold text-destructive">{fieldErrors.commercialName}</p>}
                  <input aria-invalid={!!fieldErrors.commercialName} className={`w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-primary ${fieldErrors.commercialName ? 'border-destructive' : ''}`}
                    value={editingProduct.commercialName} onChange={e => setEditingProduct({ ...editingProduct, commercialName: e.target.value })} />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-sm font-medium">الاسم العلمي</label>
                  {fieldErrors.scientificName && <p className="text-xs font-semibold text-destructive">{fieldErrors.scientificName}</p>}
                  <input className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary text-left" dir="ltr"
                    value={editingProduct.scientificName} onChange={e => setEditingProduct({ ...editingProduct, scientificName: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">الشكل الدوائي</label>
                  {fieldErrors.dosageForm && <p className="text-xs font-semibold text-destructive">{fieldErrors.dosageForm}</p>}
                  <select className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary"
                    value={editingProduct.dosageForm} onChange={e => setEditingProduct({ ...editingProduct, dosageForm: e.target.value })}>
                    {['أقراص','كبسول','شراب','حقن','بخاخ','كريم','مرهم','قطرة','أخرى'].map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">التركيز (مثال: 500mg)</label>
                  <input className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary text-left" dir="ltr"
                    value={editingProduct.strength} onChange={e => setEditingProduct({ ...editingProduct, strength: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">الشركة المصنعة</label>
                  {fieldErrors.manufacturer && <p className="text-xs font-semibold text-destructive">{fieldErrors.manufacturer}</p>}
                  <input className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary"
                    value={editingProduct.manufacturer} onChange={e => setEditingProduct({ ...editingProduct, manufacturer: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">السعر (العملة المحلية)</label>
                  {fieldErrors.price && <p className="text-xs font-semibold text-destructive">{fieldErrors.price}</p>}
                  <input aria-invalid={!!fieldErrors.price} type="number" step="0.01" min="0" className={`w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-primary ${fieldErrors.price ? 'border-destructive' : ''}`}
                    value={editingProduct.price} onChange={e => setEditingProduct({ ...editingProduct, price: parseFloat(e.target.value) || 0 })} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">الوحدة (مثال: علبة، شريط)</label>
                  {fieldErrors.unit && <p className="text-xs font-semibold text-destructive">{fieldErrors.unit}</p>}
                  <input className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary"
                    value={editingProduct.unit} onChange={e => setEditingProduct({ ...editingProduct, unit: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">حجم العبوة (رقم)</label>
                  {fieldErrors.packSize && <p className="text-xs font-semibold text-destructive">{fieldErrors.packSize}</p>}
                  <input aria-invalid={!!fieldErrors.packSize} type="number" min="1" className={`w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-primary ${fieldErrors.packSize ? 'border-destructive' : ''}`}
                    value={editingProduct.packSize} onChange={e => setEditingProduct({ ...editingProduct, packSize: parseInt(e.target.value) || 1 })} />
                </div>
                <div className="md:col-span-2 space-y-1.5">
                  <label className="text-sm font-medium">الوصف</label>
                  {fieldErrors.description && <p className="text-xs font-semibold text-destructive">{fieldErrors.description}</p>}
                  <textarea rows={3} className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary resize-none"
                    value={editingProduct.description || ''} onChange={e => setEditingProduct({ ...editingProduct, description: e.target.value })} />
                </div>
                <div className="md:col-span-2 flex flex-wrap gap-6 p-4 bg-muted/30 rounded-lg border">
                  <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                    <input type="checkbox" className="rounded w-4 h-4 text-primary focus:ring-primary"
                      checked={editingProduct.isColdChain} onChange={e => setEditingProduct({ ...editingProduct, isColdChain: e.target.checked })} />
                    تحتاج تبريد (Cold Chain) ❄️
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-amber-700">
                    <input type="checkbox" className="rounded w-4 h-4 text-amber-600 focus:ring-amber-500"
                      checked={editingProduct.isControlledSubstance} onChange={e => setEditingProduct({ ...editingProduct, isControlledSubstance: e.target.checked })} />
                    مادة خاضعة للرقابة ⚠️
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-emerald-700">
                    <input type="checkbox" className="rounded w-4 h-4 text-emerald-600 focus:ring-emerald-500"
                      checked={editingProduct.isActive} onChange={e => setEditingProduct({ ...editingProduct, isActive: e.target.checked })} />
                    منتج نشط ✔️
                  </label>
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3 pt-4 border-t">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm font-medium border rounded-lg hover:bg-muted">
                  إلغاء
                </button>
                <button type="submit" className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
                  حفظ البيانات
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
