import { useEffect, useState } from 'react';
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { Invoice } from '@/types/models';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';
import { StatusBadge } from '@/components/StatusBadge';
import { Search } from 'lucide-react';

export function InvoicesPage() {
  const { userProfile } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    async function fetchInvoices() {
      if (!userProfile?.branchId) return;
      try {
        setLoading(true);
        // Requires composite index in Firestore for where + orderBy. 
        // If it fails, we fall back to manual sorting in memory.
        let docs;
        try {
          const q = query(
            collection(db, 'invoices'),
            where('branchId', '==', userProfile.branchId),
            orderBy('createdAt', 'desc')
          );
          docs = await getDocs(q);
        } catch (idxErr) {
          console.warn("Index missing, falling back to manual sort");
          const qFallback = query(collection(db, 'invoices'), where('branchId', '==', userProfile.branchId));
          docs = await getDocs(qFallback);
        }
        
        let list: Invoice[] = [];
        docs.forEach(d => list.push({ invoiceId: d.id, ...d.data() } as Invoice));
        
        // Manual sort fallback
        list.sort((a, b) => {
          const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
          const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
          return timeB - timeA;
        });

        setInvoices(list);
      } catch (err) {
        setError('تعذر جلب الفواتير');
      } finally {
        setLoading(false);
      }
    }
    fetchInvoices();
  }, [userProfile?.branchId]);

  const filtered = invoices.filter(inv => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      inv.invoiceId.toLowerCase().includes(search) ||
      inv.orderId.toLowerCase().includes(search) ||
      inv.clientName?.toLowerCase().includes(search)
    );
  });

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message={error} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">سجل الفواتير</h2>
          <p className="text-muted-foreground text-sm">الفواتير الصادرة من هذا الفرع</p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 absolute right-3 top-3 text-muted-foreground" />
          <input 
            type="text" 
            placeholder="بحث برقم الفاتورة أو العميل..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-3 pr-10 py-2 border rounded-lg bg-card text-sm focus:ring-2 focus:ring-primary focus:border-transparent shadow-sm"
          />
        </div>
      </div>

      <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-muted/50 text-muted-foreground font-semibold border-b">
              <tr>
                <th className="px-4 py-3">رقم الفاتورة</th>
                <th className="px-4 py-3">رقم الطلب المرتبط</th>
                <th className="px-4 py-3">اسم العميل</th>
                <th className="px-4 py-3">المبلغ الإجمالي</th>
                <th className="px-4 py-3 text-center">الحالة</th>
                <th className="px-4 py-3 text-left">التاريخ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(inv => (
                <tr key={inv.invoiceId} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs font-bold text-foreground">{inv.invoiceId.slice(-8).toUpperCase()}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{inv.orderId.slice(-8)}</td>
                  <td className="px-4 py-3 font-medium">{inv.clientName}</td>
                  <td className="px-4 py-3 font-bold text-emerald-600">${inv.totalAmount?.toLocaleString()}</td>
                  <td className="px-4 py-3 text-center"><StatusBadge status={inv.status} type="invoice" /></td>
                  <td className="px-4 py-3 text-left text-muted-foreground text-xs" dir="ltr">
                    {inv.createdAt?.toDate ? inv.createdAt.toDate().toLocaleDateString('en-GB') : '-'}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    لا توجد فواتير مطابقة.
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
