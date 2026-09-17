import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { PharmaProduct, Branch } from '@/types/models';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';
import {
  AlertTriangle,
  Boxes,
  Building2,
  CheckCircle2,
  Filter,
  PackageOpen,
  RefreshCw,
  Search,
  Store,
  Tag,
  XCircle,
} from 'lucide-react';

const LOW_STOCK_LIMIT = 10;

function quantityState(quantity: number) {
  if (quantity === 0) {
    return {
      label: 'نافد',
      className: 'border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-300',
      icon: XCircle,
    };
  }
  if (quantity < LOW_STOCK_LIMIT) {
    return {
      label: 'منخفض',
      className: 'border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-300',
      icon: AlertTriangle,
    };
  }
  return {
    label: 'متوفر',
    className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
    icon: CheckCircle2,
  };
}

function ProductIdentity({ product, compact = false }: { product: PharmaProduct; compact?: boolean }) {
  return (
    <div className={`min-w-0 ${compact ? '' : 'max-w-[360px]'}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
          <PackageOpen className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold text-foreground" title={product.commercialName}>
            {product.commercialName || 'منتج بدون اسم'}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={product.scientificName}>
            {product.scientificName || 'الاسم العلمي غير مسجل'}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 font-mono text-[10px] font-bold text-muted-foreground">
              <Tag className="h-3 w-3" />
              {product.sku || 'بدون SKU'}
            </span>
            {product.dosageForm && <span className="rounded-md border border-border px-2 py-1 text-[10px] font-semibold text-muted-foreground">{product.dosageForm}</span>}
            {product.strength && <span className="rounded-md border border-border px-2 py-1 text-[10px] font-semibold text-muted-foreground">{product.strength}</span>}
          </div>
        </div>
      </div>
      {!compact && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border/70 pt-2 text-[11px] text-muted-foreground">
          <span>الوحدة: <b className="text-foreground">{product.unit || '—'}</b></span>
          <span>العبوة: <b className="text-foreground">{product.packSize || 1}</b></span>
          <span>السعر: <b className="text-foreground">{Number(product.price).toLocaleString('ar-YE')}</b></span>
        </div>
      )}
    </div>
  );
}

function QuantityBadge({ quantity }: { quantity: number }) {
  const state = quantityState(quantity);
  const StateIcon = state.icon;
  return (
    <div className={`inline-flex min-w-[82px] flex-col items-center rounded-xl border px-2.5 py-2 ${state.className}`}>
      <span className="flex items-center gap-1 text-[10px] font-bold">
        <StateIcon className="h-3.5 w-3.5" />
        {state.label}
      </span>
      <strong className="mt-0.5 text-lg leading-none">{quantity.toLocaleString('ar-YE')}</strong>
      <span className="mt-1 text-[9px] opacity-75">وحدة</span>
    </div>
  );
}

export function InventoryOverviewPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [products, setProducts] = useState<PharmaProduct[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [inventory, setInventory] = useState<Record<string, Record<string, number>>>({});
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError('');

      const { data: pData, error: pErr } = await supabase
        .from('products')
        .select('id, sku, commercial_name, scientific_name, dosage_form, is_active, strength, manufacturer, is_cold_chain, is_controlled_substance, unit, pack_size, price, image_url')
        .eq('is_active', true);
      if (pErr) throw pErr;

      const pList: PharmaProduct[] = (pData ?? []).map(row => ({
        productId: row.id,
        sku: row.sku ?? '',
        commercialName: row.commercial_name ?? '',
        scientificName: row.scientific_name ?? '',
        dosageForm: row.dosage_form ?? '',
        manufacturer: row.manufacturer ?? '',
        strength: row.strength ?? '',
        isColdChain: row.is_cold_chain ?? false,
        isControlledSubstance: row.is_controlled_substance ?? false,
        unit: row.unit ?? '',
        packSize: Number(row.pack_size ?? 1),
        price: Number(row.price ?? 0),
        imageUrl: row.image_url ?? '',
        isActive: row.is_active ?? true,
      }));

      const { data: bData, error: bErr } = await supabase
        .from('branches')
        .select('id, name, governorate, latitude, longitude, is_active')
        .eq('is_active', true);
      if (bErr) throw bErr;

      const bList: Branch[] = (bData ?? []).map(row => ({
        branchId: row.id,
        branchName: row.name ?? '',
        governorate: row.governorate ?? '',
        latitude: Number(row.latitude ?? 0),
        longitude: Number(row.longitude ?? 0),
      }));

      const { data: invData, error: invErr } = await supabase
        .from('warehouse_inventory')
        .select('product_id, branch_id, quantity');
      if (invErr) throw invErr;

      const invMap: Record<string, Record<string, number>> = {};
      for (const row of (invData ?? [])) {
        const productId: string = row.product_id ?? '';
        const branchId: string = row.branch_id ?? '';
        if (!productId || !branchId) continue;
        if (!invMap[productId]) invMap[productId] = {};
        invMap[productId][branchId] = (invMap[productId][branchId] ?? 0) + Number(row.quantity ?? 0);
      }

      setProducts(pList);
      setBranches(bList);
      setInventory(invMap);
    } catch (err) {
      console.error(err);
      setError('تعذر جلب بيانات المخزون. تحقق من اتصال قاعدة البيانات ثم حاول مرة أخرى.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const getQuantity = (productId: string, branchId: string) => inventory[productId]?.[branchId] ?? 0;
  const getTotal = (productId: string) => branches.reduce((sum, branch) => sum + getQuantity(productId, branch.branchId), 0);
  const getLowBranchCount = (productId: string) => branches.filter((branch) => getQuantity(productId, branch.branchId) < LOW_STOCK_LIMIT).length;

  const totals = useMemo(() => {
    let totalUnits = 0;
    let lowCells = 0;
    let emptyCells = 0;
    for (const product of products) {
      for (const branch of branches) {
        const quantity = getQuantity(product.productId, branch.branchId);
        totalUnits += quantity;
        if (quantity === 0) emptyCells += 1;
        else if (quantity < LOW_STOCK_LIMIT) lowCells += 1;
      }
    }
    return { totalUnits, lowCells, emptyCells };
  }, [products, branches, inventory]);

  const displayProducts = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return products.filter((product) => {
      const matchesSearch = !query
        || product.commercialName.toLowerCase().includes(query)
        || product.scientificName.toLowerCase().includes(query)
        || product.sku.toLowerCase().includes(query);
      const matchesLowStock = !lowStockOnly || getLowBranchCount(product.productId) > 0;
      return matchesSearch && matchesLowStock;
    });
  }, [products, branches, inventory, searchTerm, lowStockOnly]);

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message={error} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-primary">
            <Boxes className="h-4 w-4" />
            <span>التشغيل / المخزون</span>
          </div>
          <h2 className="text-2xl font-extrabold tracking-tight text-foreground md:text-3xl">نظرة شاملة على المخزون</h2>
          <p className="mt-1 text-sm text-muted-foreground">تابع توفر كل منتج في الفروع واتخذ قرار التوريد بسرعة.</p>
        </div>
        <button
          type="button"
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className="inline-flex items-center justify-center gap-2 self-start rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-bold text-foreground shadow-sm transition-colors hover:bg-muted disabled:opacity-60 lg:self-auto"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'جارٍ التحديث...' : 'تحديث البيانات'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-muted-foreground">المنتجات النشطة</span>
            <span className="rounded-xl bg-primary/10 p-2 text-primary"><PackageOpen className="h-4 w-4" /></span>
          </div>
          <p className="mt-3 text-2xl font-extrabold">{products.length.toLocaleString('ar-YE')}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">منتج في الكتالوج</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-muted-foreground">الفروع النشطة</span>
            <span className="rounded-xl bg-accent/10 p-2 text-accent"><Building2 className="h-4 w-4" /></span>
          </div>
          <p className="mt-3 text-2xl font-extrabold">{branches.length.toLocaleString('ar-YE')}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">نقاط التخزين والمتابعة</p>
        </div>
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-muted-foreground">خانات منخفضة</span>
            <span className="rounded-xl bg-amber-500/10 p-2 text-amber-600"><AlertTriangle className="h-4 w-4" /></span>
          </div>
          <p className="mt-3 text-2xl font-extrabold text-amber-600">{totals.lowCells.toLocaleString('ar-YE')}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">أقل من {LOW_STOCK_LIMIT} وحدات</p>
        </div>
        <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.04] p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-muted-foreground">خانات نافدة</span>
            <span className="rounded-xl bg-red-500/10 p-2 text-red-600"><XCircle className="h-4 w-4" /></span>
          </div>
          <p className="mt-3 text-2xl font-extrabold text-red-600">{totals.emptyCells.toLocaleString('ar-YE')}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">تحتاج إلى إعادة توريد</p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-3 shadow-sm md:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-md">
            <Search className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="ابحث باسم الدواء أو الاسم العلمي أو SKU..."
              className="h-10 w-full rounded-xl border border-border bg-background px-10 text-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/20"
              aria-label="البحث في المخزون"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-semibold transition-colors hover:bg-muted/50">
            <Filter className="h-4 w-4 text-primary" />
            <input
              type="checkbox"
              checked={lowStockOnly}
              onChange={(event) => setLowStockOnly(event.target.checked)}
              className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
            />
            <span>إظهار المنخفض والنافد فقط</span>
          </label>
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-border/70 pt-3 text-xs text-muted-foreground">
          <span>عرض <b className="text-foreground">{displayProducts.length.toLocaleString('ar-YE')}</b> من {products.length.toLocaleString('ar-YE')} منتج</span>
          <span className="hidden items-center gap-1 sm:flex"><Store className="h-3.5 w-3.5" /> {branches.length.toLocaleString('ar-YE')} فرع نشط</span>
        </div>
      </div>

      <div className="hidden overflow-hidden rounded-2xl border border-border bg-card shadow-sm md:block">
        <div className="border-b border-border bg-muted/20 px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-extrabold">توزيع المخزون حسب الفرع</h3>
              <p className="mt-1 text-xs text-muted-foreground">مرر أفقيًا لرؤية جميع الفروع، بينما يبقى تعريف المنتج ظاهرًا.</p>
            </div>
            <div className="hidden items-center gap-2 text-[10px] font-semibold text-muted-foreground lg:flex">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> متوفر
              <span className="h-2 w-2 rounded-full bg-amber-500" /> منخفض
              <span className="h-2 w-2 rounded-full bg-red-500" /> نافد
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[980px] w-full text-right text-sm">
            <thead className="border-b border-border bg-muted/40 text-muted-foreground">
              <tr>
                <th className="sticky right-0 z-20 w-[350px] min-w-[350px] border-l border-border bg-muted/80 px-5 py-4 text-right text-xs font-extrabold backdrop-blur">المنتج</th>
                {branches.map((branch) => (
                  <th key={branch.branchId} className="min-w-[132px] border-l border-border px-3 py-4 text-center last:border-l-0">
                    <div className="flex flex-col items-center gap-1.5">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><Store className="h-4 w-4" /></span>
                      <span className="max-w-[110px] truncate text-xs font-extrabold text-foreground" title={branch.branchName}>{branch.branchName || 'فرع بدون اسم'}</span>
                      <span className="max-w-[110px] truncate text-[10px] font-normal">{branch.governorate || '—'}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {displayProducts.map((product) => (
                <tr key={product.productId} className="group transition-colors hover:bg-primary/[0.025]">
                  <td className="sticky right-0 z-10 border-l border-border bg-card px-5 py-4 align-top group-hover:bg-card">
                    <ProductIdentity product={product} />
                  </td>
                  {branches.map((branch) => (
                    <td key={branch.branchId} className="border-l border-border px-3 py-4 text-center align-middle last:border-l-0">
                      <QuantityBadge quantity={getQuantity(product.productId, branch.branchId)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {displayProducts.length === 0 && (
            <div className="px-4 py-16 text-center text-muted-foreground">
              <PackageOpen className="mx-auto h-10 w-10 opacity-40" />
              <p className="mt-3 text-sm font-bold">لا توجد منتجات مطابقة</p>
              <p className="mt-1 text-xs">غيّر كلمات البحث أو أوقف فلتر المخزون المنخفض.</p>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3 md:hidden">
        <div className="flex items-center gap-2 px-1 text-sm font-extrabold">
          <Store className="h-4 w-4 text-primary" />
          توزيع المخزون حسب الفرع
        </div>
        {displayProducts.map((product) => (
          <article key={product.productId} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="border-b border-border bg-muted/20 p-4">
              <ProductIdentity product={product} />
              <div className="mt-3 flex items-center justify-between rounded-xl bg-background px-3 py-2 text-xs">
                <span className="text-muted-foreground">إجمالي الكمية في الفروع</span>
                <b className="text-base text-foreground">{getTotal(product.productId).toLocaleString('ar-YE')} وحدة</b>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 p-3">
              {branches.map((branch) => (
                <div key={branch.branchId} className="rounded-xl border border-border bg-background p-2.5">
                  <div className="mb-2 flex min-w-0 items-center gap-1.5">
                    <Store className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="truncate text-[11px] font-bold" title={branch.branchName}>{branch.branchName || 'فرع بدون اسم'}</span>
                  </div>
                  <QuantityBadge quantity={getQuantity(product.productId, branch.branchId)} />
                </div>
              ))}
            </div>
          </article>
        ))}
        {displayProducts.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border px-4 py-16 text-center text-muted-foreground">
            <PackageOpen className="mx-auto h-10 w-10 opacity-40" />
            <p className="mt-3 text-sm font-bold">لا توجد منتجات مطابقة</p>
          </div>
        )}
      </div>
    </div>
  );
}
