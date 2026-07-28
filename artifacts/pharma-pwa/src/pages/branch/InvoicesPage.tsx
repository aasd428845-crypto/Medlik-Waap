import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
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
        const { data, error: err } = await supabase
          .from('invoices')
          .select('*')
          .eq('branch_id', userProfile.branchId)
          .order('created_at', { ascending: false });

        if (err) throw err;

        const list: Invoice[] = (data ?? []).map(row => ({
          invoiceId: row.id,
          orderId: row.order_id ?? '',
          branchId: row.branch_id ?? '',
          totalAmount: row.total_amount ?? 0,
          status: row.status ?? 'pending',
          createdAt: row.created_at ?? '',
          clientName: row.client_name ?? '',
          clientType: row.client_type ?? undefined,
        }));

        setInvoices(list);
      } catch {
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
                    {inv.createdAt ? new Date(inv.createdAt).toLocaleDateString('en-GB') : '-'}
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
