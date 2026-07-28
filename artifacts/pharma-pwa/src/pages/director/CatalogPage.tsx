import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { PharmaProduct } from '@/types/models';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Search, Plus, Edit2, Trash2, CheckCircle, XCircle } from 'lucide-react';

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
    scientific_name: p.scientificName,
    manufacturer: p.manufacturer,
    dosage_form: p.dosageForm,
    strength: p.strength,
    is_cold_chain: p.isColdChain,
    is_controlled_substance: p.isControlledSubstance,
    unit: p.unit,
    pack_size: p.packSize,
    price: p.price,
    description: p.description,
    is_active: p.isActive,
  };
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
      alert('حدث خطأ أثناء الحفظ');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">كتالوج المنتجات</h2>
          <p className="text-muted-foreground text-sm">إدارة الأدوية والأصناف في النظام</p>
        </div>
        <button
          onClick={openAdd}
          className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          إضافة منتج
        </button>
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">الباركود / SKU *</label>
                  <input required className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary"
                    value={editingProduct.sku} onChange={e => setEditingProduct({ ...editingProduct, sku: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">الاسم التجاري *</label>
                  <input required className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary"
                    value={editingProduct.commercialName} onChange={e => setEditingProduct({ ...editingProduct, commercialName: e.target.value })} />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-sm font-medium">الاسم العلمي</label>
                  <input className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary text-left" dir="ltr"
                    value={editingProduct.scientificName} onChange={e => setEditingProduct({ ...editingProduct, scientificName: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">الشكل الدوائي</label>
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
                  <input className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary"
                    value={editingProduct.manufacturer} onChange={e => setEditingProduct({ ...editingProduct, manufacturer: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">السعر (العملة المحلية)</label>
                  <input type="number" step="0.01" min="0" required className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary"
                    value={editingProduct.price} onChange={e => setEditingProduct({ ...editingProduct, price: parseFloat(e.target.value) || 0 })} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">الوحدة (مثال: علبة، شريط)</label>
                  <input className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary"
                    value={editingProduct.unit} onChange={e => setEditingProduct({ ...editingProduct, unit: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">حجم العبوة (رقم)</label>
                  <input type="number" min="1" className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary"
                    value={editingProduct.packSize} onChange={e => setEditingProduct({ ...editingProduct, packSize: parseInt(e.target.value) || 1 })} />
                </div>
                <div className="md:col-span-2 space-y-1.5">
                  <label className="text-sm font-medium">الوصف</label>
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
