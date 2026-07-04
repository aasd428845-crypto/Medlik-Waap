import { useEffect, useState } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Link } from 'react-router-dom';
import { KPICard } from '@/components/KPICard';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';
import { DollarSign, FileText, ShoppingCart, Store, AlertTriangle } from 'lucide-react';
import { Order, Invoice, WarehouseInventoryItem, Branch } from '@/types/models';

export function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [kpis, setKpis] = useState({
    totalSales: 0,
    receivables: 0,
    activeOrders: 0,
    activeBranches: 0,
  });

  const [criticalInventory, setCriticalInventory] = useState<WarehouseInventoryItem[]>([]);

  useEffect(() => {
    async function fetchDashboardData() {
      try {
        setLoading(true);
        
        // 1. Total Sales (Orders where status in Invoiced, Delivered)
        // Wait, instructions say: "totalSales: sum of totalAmount from orders where status=Invoiced or Delivered"
        // FireStore doesn't do "OR" easily without 'in' operator. We can use 'in' for status.
        const ordersRef = collection(db, 'orders');
        const salesQuery = query(ordersRef, where('status', 'in', ['Invoiced', 'Delivered']));
        const salesDocs = await getDocs(salesQuery);
        let totalSales = 0;
        salesDocs.forEach(d => totalSales += (d.data() as Order).totalAmount || 0);

        // Active Orders
        const activeOrdersQuery = query(ordersRef, where('status', 'in', ['Submitted', 'Allocated', 'PartiallyShipped', 'OutForDelivery']));
        const activeOrdersDocs = await getDocs(activeOrdersQuery);
        const activeOrders = activeOrdersDocs.size;

        // 2. Receivables (Invoices where status != 'paid')
        const invoicesRef = collection(db, 'invoices');
        const invoicesQuery = query(invoicesRef, where('status', '!=', 'paid'));
        const invoicesDocs = await getDocs(invoicesQuery);
        let receivables = 0;
        invoicesDocs.forEach(d => receivables += (d.data() as Invoice).totalAmount || 0);

        // 3. Active Branches
        const branchesRef = collection(db, 'branches');
        const branchesDocs = await getDocs(branchesRef);
        const activeBranches = branchesDocs.size;

        setKpis({ totalSales, receivables, activeOrders, activeBranches });

        // Critical Inventory
        const inventoryRef = collection(db, 'warehouse_inventory');
        const criticalQuery = query(inventoryRef, where('availableQuantity', '<', 10));
        const criticalDocs = await getDocs(criticalQuery);
        const critItems: WarehouseInventoryItem[] = [];
        criticalDocs.forEach(d => critItems.push({ id: d.id, ...d.data() } as WarehouseInventoryItem));
        setCriticalInventory(critItems);

      } catch (err: any) {
        console.error("Dashboard Fetch Error", err);
        setError("تعذر جلب بيانات لوحة التحكم. تأكد من إعدادات قاعدة البيانات.");
      } finally {
        setLoading(false);
      }
    }

    fetchDashboardData();
  }, []);

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message={error} />;

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard 
          title="إجمالي المبيعات" 
          value={`$${kpis.totalSales.toLocaleString()}`} 
          icon={<DollarSign className="w-6 h-6" />}
          colorClass="bg-emerald-100 text-emerald-600"
        />
        <KPICard 
          title="الذمم المدينة" 
          value={`$${kpis.receivables.toLocaleString()}`} 
          icon={<FileText className="w-6 h-6" />}
          colorClass="bg-amber-100 text-amber-600"
        />
        <KPICard 
          title="الطلبات النشطة" 
          value={kpis.activeOrders} 
          icon={<ShoppingCart className="w-6 h-6" />}
          colorClass="bg-blue-100 text-blue-600"
        />
        <KPICard 
          title="الفروع النشطة" 
          value={kpis.activeBranches} 
          icon={<Store className="w-6 h-6" />}
          colorClass="bg-purple-100 text-purple-600"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Quick Access */}
        <div className="space-y-4">
          <h3 className="font-bold text-lg text-foreground flex items-center gap-2">
            وصول سريع
          </h3>
          <div className="grid grid-cols-1 gap-3">
            <Link 
              to="/director/catalog" 
              className="bg-card hover:bg-primary/5 border rounded-xl p-6 flex flex-col items-center justify-center gap-3 transition-colors shadow-sm group"
            >
              <div className="text-3xl group-hover:scale-110 transition-transform">💊</div>
              <span className="font-bold text-foreground">إدارة الكتالوج</span>
            </Link>
            <Link 
              to="/director/inventory-overview" 
              className="bg-card hover:bg-primary/5 border rounded-xl p-6 flex flex-col items-center justify-center gap-3 transition-colors shadow-sm group"
            >
              <div className="bg-primary/10 p-3 rounded-full text-primary group-hover:scale-110 transition-transform">
                <Store className="w-6 h-6" />
              </div>
              <span className="font-bold text-foreground">نظرة شاملة على المخزون</span>
            </Link>
          </div>
        </div>

        {/* Alerts Column */}
        <div className="lg:col-span-2 space-y-4">
          <h3 className="font-bold text-lg text-foreground flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            التنبيهات العاجلة
          </h3>
          
          <div className="space-y-3">
            {/* Critical Inventory Alert */}
            {criticalInventory.length > 0 ? (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 shadow-sm">
                <h4 className="font-bold text-red-800 mb-2 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse" />
                  مخزون حرج (أقل من 10)
                </h4>
                <div className="bg-white rounded-lg border border-red-100 overflow-hidden">
                  <table className="w-full text-sm text-right">
                    <thead className="bg-red-50 text-red-800 border-b border-red-100">
                      <tr>
                        <th className="px-4 py-2 font-semibold">المنتج</th>
                        <th className="px-4 py-2 font-semibold">معرف الفرع</th>
                        <th className="px-4 py-2 font-semibold">الكمية</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-red-50 text-red-900">
                      {criticalInventory.slice(0, 5).map(item => (
                        <tr key={item.id} className="hover:bg-red-50/50">
                          <td className="px-4 py-2">{item.name}</td>
                          <td className="px-4 py-2 text-xs opacity-75">{item.branchId}</td>
                          <td className="px-4 py-2 font-bold text-red-600">{item.availableQuantity}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {criticalInventory.length > 5 && (
                    <div className="p-2 text-center text-xs text-red-600 bg-red-50/50">
                      + {criticalInventory.length - 5} منتجات أخرى
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-card border rounded-xl p-4 shadow-sm flex items-center gap-3 text-muted-foreground">
                <div className="bg-green-100 p-2 rounded-full text-green-600">
                  <Store className="w-4 h-4" />
                </div>
                <span>المخزون بوضع جيد، لا توجد منتجات حرجة.</span>
              </div>
            )}

            {/* Bad Debt Customers Alert */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 shadow-sm">
              <h4 className="font-bold text-amber-800 mb-2 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                عملاء متعثرون
              </h4>
              <p className="text-amber-700 text-sm">
                لا توجد بيانات كافية حالياً لعرض العملاء المتعثرين.
              </p>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
