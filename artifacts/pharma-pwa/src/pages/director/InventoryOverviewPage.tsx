import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { PharmaProduct, Branch, WarehouseInventoryItem } from '@/types/models';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';
import { Store, Filter } from 'lucide-react';

export function InventoryOverviewPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [products, setProducts] = useState<PharmaProduct[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [inventory, setInventory] = useState<Record<string, Record<string, number>>>({}); // sku -> branchId -> qty

  const [lowStockOnly, setLowStockOnly] = useState(false);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);

        // 1. Active products
        const { data: pData, error: pErr } = await supabase
          .from('products')
          .select('id, sku, commercial_name, scientific_name, dosage_form, is_active, strength, manufacturer, is_cold_chain, is_controlled_substance, unit, pack_size, price')
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
          packSize: row.pack_size ?? 1,
          price: row.price ?? 0,
          isActive: row.is_active ?? true,
        }));
        setProducts(pList);

        // 2. Branches
        const { data: bData, error: bErr } = await supabase
          .from('branches')
          .select('id, name, governorate, latitude, longitude');
        if (bErr) throw bErr;

        const bList: Branch[] = (bData ?? []).map(row => ({
          branchId: row.id,
          branchName: row.name ?? '',
          governorate: row.governorate ?? '',
          latitude: row.latitude ?? 0,
          longitude: row.longitude ?? 0,
        }));
        setBranches(bList);

        // 3. Inventory pivot
        const { data: invData, error: invErr } = await supabase
          .from('warehouse_inventory')
          .select('sku, branch_id, available_quantity');
        if (invErr) throw invErr;

        const invMap: Record<string, Record<string, number>> = {};
        for (const row of (invData ?? [])) {
          const sku: string = row.sku ?? '';
          const branchId: string = row.branch_id ?? '';
          if (!invMap[sku]) invMap[sku] = {};
          invMap[sku][branchId] = row.available_quantity ?? 0;
        }
        setInventory(invMap);

      } catch (err) {
        console.error(err);
        setError('تعذر جلب بيانات المخزون');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const displayProducts = products.filter(p => {
    if (!lowStockOnly) return true;
    return branches.some(b => (inventory[p.sku]?.[b.branchId] ?? 0) < 10);
  });

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message={error} />;

  return (
    <div className="space-y-6 flex flex-col h-[calc(100vh-8rem)]">
      <div className="flex justify-between items-center shrink-0">
        <div>
          <h2 className="text-2xl font-bold text-foreground">نظرة شاملة على المخزون</h2>
          <p className="text-muted-foreground text-sm">مراقبة كميات المنتجات في جميع الفروع</p>
        </div>

        <label className="flex items-center gap-2 bg-card border px-4 py-2 rounded-lg cursor-pointer shadow-sm hover:bg-muted/50 transition-colors">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <input
            type="checkbox"
            checked={lowStockOnly}
            onChange={e => setLowStockOnly(e.target.checked)}
            className="rounded border-input text-red-600 focus:ring-red-500 w-4 h-4"
          />
          <span className="text-sm font-medium">إظهار المخزون المنخفض فقط (&lt; 10)</span>
        </label>
      </div>

      <div className="bg-card border rounded-xl shadow-sm flex-1 overflow-hidden flex flex-col">
        <div className="overflow-auto flex-1">
          <table className="w-full text-right text-sm border-collapse">
            <thead className="bg-muted/50 text-muted-foreground font-semibold sticky top-0 z-10 shadow-sm border-b">
              <tr>
                <th className="px-4 py-3 whitespace-nowrap bg-muted/50 sticky right-0 z-20 w-1/4 border-l">المنتج</th>
                {branches.map(b => (
                  <th key={b.branchId} className="px-4 py-3 whitespace-nowrap text-center border-l last:border-l-0">
                    <div className="flex flex-col items-center gap-1">
                      <Store className="w-4 h-4" />
                      <span>{b.branchName}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {displayProducts.map(p => (
                <tr key={p.productId} className="hover:bg-muted/30 transition-colors group">
                  <td className="px-4 py-3 font-medium bg-card group-hover:bg-muted/30 sticky right-0 z-10 border-l">
                    <div className="flex flex-col">
                      <span className="text-foreground">{p.commercialName}</span>
                      <span className="text-xs text-muted-foreground">{p.sku} | {p.dosageForm}</span>
                    </div>
                  </td>
                  {branches.map(b => {
                    const qty = inventory[p.sku]?.[b.branchId] ?? 0;
                    const isLow = qty < 10;
                    return (
                      <td key={b.branchId} className={`px-4 py-3 text-center border-l last:border-l-0 ${isLow ? 'bg-red-50/50 text-red-700 font-bold' : ''}`}>
                        {qty}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {displayProducts.length === 0 && (
                <tr>
                  <td colSpan={branches.length + 1} className="px-4 py-12 text-center text-muted-foreground">
                    لا توجد منتجات تطابق معايير العرض الحالية.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
