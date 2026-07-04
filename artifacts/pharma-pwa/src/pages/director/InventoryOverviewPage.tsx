import { useEffect, useState } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { PharmaProduct, Branch, WarehouseInventoryItem } from '@/types/models';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';
import { Store, Filter } from 'lucide-react';

export function InventoryOverviewPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [products, setProducts] = useState<PharmaProduct[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [inventory, setInventory] = useState<Record<string, Record<string, number>>>({}); // sku -> branchId -> quantity
  
  const [lowStockOnly, setLowStockOnly] = useState(false);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        // 1. Fetch active products
        const productsQ = query(collection(db, 'products'), where('isActive', '==', true));
        const pDocs = await getDocs(productsQ);
        const pList: PharmaProduct[] = [];
        pDocs.forEach(d => pList.push({ productId: d.id, ...d.data() } as PharmaProduct));
        setProducts(pList);

        // 2. Fetch branches
        const bDocs = await getDocs(collection(db, 'branches'));
        const bList: Branch[] = [];
        bDocs.forEach(d => bList.push({ branchId: d.id, ...d.data() } as Branch));
        setBranches(bList);

        // 3. Fetch inventory
        const invDocs = await getDocs(collection(db, 'warehouse_inventory'));
        const invMap: Record<string, Record<string, number>> = {};
        invDocs.forEach(d => {
          const data = d.data() as WarehouseInventoryItem;
          if (!invMap[data.sku]) invMap[data.sku] = {};
          invMap[data.sku][data.branchId] = data.availableQuantity;
        });
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

  // Filter logic: if lowStockOnly is true, hide rows where ALL branches have >= 10
  const displayProducts = products.filter(p => {
    if (!lowStockOnly) return true;
    // Check if any branch has < 10
    return branches.some(b => {
      const qty = inventory[p.sku]?.[b.branchId] || 0;
      return qty < 10;
    });
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
                    const qty = inventory[p.sku]?.[b.branchId] || 0;
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
