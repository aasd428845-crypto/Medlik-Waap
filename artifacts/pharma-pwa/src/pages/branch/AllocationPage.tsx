import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { Order, Branch, WarehouseInventoryItem, OrderLine } from '@/types/models';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';
import { Package, Truck, ArrowLeftRight, Sparkles, Calendar, MapPin } from 'lucide-react';

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function mapRowToOrder(row: Record<string, unknown>): Order {
  const rawLines = (row.order_lines ?? []) as unknown[];
  const orderLines: OrderLine[] = rawLines.map((l: unknown) => {
    const line = l as Record<string, unknown>;
    return {
      sku: (line.sku as string) ?? '',
      productName: ((line.product_name ?? line.productName) as string) ?? '',
      requestedQty: ((line.requested_qty ?? line.requestedQty) as number) ?? 0,
      allocatedQty: ((line.allocated_qty ?? line.allocatedQty) as number) ?? 0,
      unitPrice: ((line.unit_price ?? line.unitPrice) as number) ?? 0,
    };
  });
  return {
    orderId: row.id as string,
    clientId: (row.client_id as string) ?? '',
    clientName: (row.client_name as string) ?? '',
    clientType: (row.client_type as string) ?? 'صيدلية',
    clientGovernorate: (row.client_governorate as string) ?? '',
    orderLines,
    status: ((row.status ?? row.order_status ?? 'Draft') as Order['status']),
    targetBranches: ((row.target_branches ?? []) as string[]),
    totalAmount: (row.total_amount as number) ?? 0,
    createdAt: row.created_at as string,
    scheduledDeliveryDate: (row.scheduled_delivery_date as string) ?? undefined,
  };
}

export function AllocationPage() {
  const { userProfile } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [deliveryDate, setDeliveryDate] = useState('');
  const [allocatedLines, setAllocatedLines] = useState<Record<string, number>>({});

  const [branches, setBranches] = useState<Branch[]>([]);
  const [redirectBranch, setRedirectBranch] = useState('');
  const [selectedSkus, setSelectedSkus] = useState<string[]>([]);
  const [isSmartLoading, setIsSmartLoading] = useState(false);

  useEffect(() => {
    fetchOrders();
    fetchBranches();
  }, [userProfile?.branchId]);

  const fetchOrders = async () => {
    if (!userProfile?.branchId) return;
    try {
      setLoading(true);
      const { data, error: err } = await supabase
        .from('orders')
        .select('*')
        .contains('target_branches', [userProfile.branchId])
        .eq('status', 'Submitted');
      if (err) throw err;
      setOrders((data ?? []).map(r => mapRowToOrder(r as Record<string, unknown>)));
    } catch {
      setError('تعذر جلب الطلبات الواردة');
    } finally {
      setLoading(false);
    }
  };

  const fetchBranches = async () => {
    try {
      const { data } = await supabase
        .from('branches')
        .select('id, branch_name, governorate, latitude, longitude');
      setBranches((data ?? []).map(row => ({
        branchId: row.id,
        branchName: row.branch_name ?? '',
        governorate: row.governorate ?? '',
        latitude: row.latitude ?? 0,
        longitude: row.longitude ?? 0,
      })));
    } catch { /* silently ignore */ }
  };

  const openOrder = (order: Order) => {
    setSelectedOrder(order);
    const initialAlloc: Record<string, number> = {};
    order.orderLines.forEach(l => { initialAlloc[l.sku] = l.requestedQty; });
    setAllocatedLines(initialAlloc);
    setDeliveryDate('');
    setSelectedSkus([]);
    setRedirectBranch('');
  };

  const handleManualRedirect = async (type: 'all' | 'selected') => {
    if (!selectedOrder || !redirectBranch || !userProfile?.branchId) return;
    try {
      if (type === 'all') {
        const { error: err } = await supabase
          .from('orders')
          .update({ target_branches: [redirectBranch] })
          .eq('id', selectedOrder.orderId);
        if (err) throw err;
        alert('تم تحويل الطلب بالكامل');
      } else {
        if (selectedSkus.length === 0) return alert('اختر أصنافاً أولاً');
        const currentTargets = selectedOrder.targetBranches || [];
        const newTargets = currentTargets.includes(redirectBranch)
          ? currentTargets
          : [...currentTargets, redirectBranch];
        const { error: err } = await supabase
          .from('orders')
          .update({ target_branches: newTargets })
          .eq('id', selectedOrder.orderId);
        if (err) throw err;
        alert(`تم إضافة الفرع المختار للطلب — سيظهر الطلب لدى مدير الفرع الآخر للتخصيص (الأصناف المحددة: ${selectedSkus.join(', ')})`);
      }
      setSelectedOrder(null);
      fetchOrders();
    } catch {
      alert('حدث خطأ');
    }
  };

  const handleSmartRedirect = async (type: 'all' | 'missing') => {
    if (!selectedOrder || !userProfile?.branchId) return;
    setIsSmartLoading(true);
    try {
      const currentBranchDoc = branches.find(b => b.branchId === userProfile.branchId);
      if (!currentBranchDoc) throw new Error('بيانات الفرع غير متوفرة');

      const itemsToFind = type === 'missing'
        ? selectedOrder.orderLines.filter(l => (allocatedLines[l.sku] || 0) < l.requestedQty)
        : selectedOrder.orderLines;

      if (itemsToFind.length === 0) {
        alert('لا توجد نواقص للبحث عنها');
        return;
      }

      const { data: invData } = await supabase
        .from('warehouse_inventory')
        .select('sku, branch_id, available_quantity');

      const inventory: WarehouseInventoryItem[] = (invData ?? []).map(row => ({
        sku: row.sku ?? '',
        name: '',
        dosageForm: '',
        availableQuantity: row.available_quantity ?? 0,
        branchId: row.branch_id ?? '',
      }));

      const branchDistances = branches
        .filter(b => b.branchId !== userProfile.branchId)
        .map(b => ({
          ...b,
          distance: haversineDistance(currentBranchDoc.latitude, currentBranchDoc.longitude, b.latitude, b.longitude),
        }))
        .sort((a, b) => a.distance - b.distance);

      let bestBranchId: string | null = null;
      for (const branch of branchDistances) {
        const hasAll = itemsToFind.every(item => {
          const invItem = inventory.find(i => i.branchId === branch.branchId && i.sku === item.sku);
          if (!invItem) return false;
          if (type === 'missing') {
            const missingQty = item.requestedQty - (allocatedLines[item.sku] ?? 0);
            return invItem.availableQuantity >= missingQty;
          }
          return invItem.availableQuantity >= item.requestedQty;
        });
        if (hasAll) { bestBranchId = branch.branchId; break; }
      }

      if (bestBranchId) {
        if (type === 'all') {
          await supabase.from('orders').update({ target_branches: [bestBranchId] }).eq('id', selectedOrder.orderId);
          alert(`تم تحويل الطلب تلقائياً إلى أقرب فرع يتوفر فيه المخزون: ${branches.find(b => b.branchId === bestBranchId)?.branchName}`);
          setSelectedOrder(null);
          fetchOrders();
        } else {
          const currentTargets = selectedOrder.targetBranches || [];
          if (!currentTargets.includes(bestBranchId)) {
            await supabase.from('orders').update({ target_branches: [...currentTargets, bestBranchId] }).eq('id', selectedOrder.orderId);
          }
          alert(`تم توجيه الأصناف الناقصة لفرع: ${branches.find(b => b.branchId === bestBranchId)?.branchName}`);
        }
      } else {
        alert('عذراً، لم نتمكن من إيجاد فرع واحد يغطي جميع الأصناف المطلوبة.');
      }
    } catch {
      alert('خطأ في التحويل الذكي');
    } finally {
      setIsSmartLoading(false);
    }
  };

  const confirmAllocation = async () => {
    if (!selectedOrder || !deliveryDate || !userProfile?.branchId) return;
    try {
      const updatedLines = selectedOrder.orderLines.map(l => ({
        sku: l.sku,
        product_name: l.productName,
        requested_qty: l.requestedQty,
        allocated_qty: allocatedLines[l.sku] || 0,
        unit_price: l.unitPrice,
      }));

      const { error: oErr } = await supabase
        .from('orders')
        .update({
          status: 'Invoiced',
          scheduled_delivery_date: deliveryDate,
          order_lines: updatedLines,
        })
        .eq('id', selectedOrder.orderId);
      if (oErr) throw oErr;

      const { error: iErr } = await supabase.from('invoices').insert({
        order_id: selectedOrder.orderId,
        branch_id: userProfile.branchId,
        total_amount: selectedOrder.totalAmount,
        status: 'pending',
        created_at: new Date().toISOString(),
        client_name: selectedOrder.clientName,
        client_type: selectedOrder.clientType || 'صيدلية',
      });
      if (iErr) throw iErr;

      alert('تم تأكيد التخصيص وإصدار الفاتورة بنجاح');
      setSelectedOrder(null);
      fetchOrders();
    } catch {
      alert('حدث خطأ أثناء الحفظ');
    }
  };

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message={error} />;

  if (selectedOrder) {
    return (
      <div className="space-y-6 max-w-4xl mx-auto animate-in fade-in duration-300">
        <button onClick={() => setSelectedOrder(null)} className="text-muted-foreground hover:text-foreground text-sm font-medium flex items-center gap-1">
          &rarr; عودة للقائمة
        </button>

        <div className="bg-card border rounded-2xl shadow-sm overflow-hidden">
          <div className="bg-primary/5 border-b p-6">
            <h2 className="text-xl font-bold text-foreground">تخصيص الطلب #{selectedOrder.orderId.slice(-8)}</h2>
            <p className="text-muted-foreground mt-1 text-sm">{selectedOrder.clientName} - {selectedOrder.clientGovernorate}</p>
          </div>

          <div className="p-6 space-y-8">
            {/* Order Lines Table */}
            <div>
              <h3 className="font-bold text-foreground mb-4 flex items-center gap-2">
                <Package className="w-5 h-5 text-primary" />
                أسطر الطلب
              </h3>
              <div className="border rounded-xl overflow-hidden">
                <table className="w-full text-sm text-right">
                  <thead className="bg-muted text-muted-foreground font-medium">
                    <tr>
                      <th className="px-4 py-3 w-10"></th>
                      <th className="px-4 py-3">المنتج</th>
                      <th className="px-4 py-3 text-center">الكمية المطلوبة</th>
                      <th className="px-4 py-3 text-center">الكمية المخصصة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {selectedOrder.orderLines.map(line => (
                      <tr key={line.sku} className="hover:bg-muted/10 transition-colors">
                        <td className="px-4 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={selectedSkus.includes(line.sku)}
                            onChange={e => {
                              if (e.target.checked) setSelectedSkus([...selectedSkus, line.sku]);
                              else setSelectedSkus(selectedSkus.filter(s => s !== line.sku));
                            }}
                            className="rounded border-input text-primary focus:ring-primary w-4 h-4"
                          />
                        </td>
                        <td className="px-4 py-3 font-medium text-foreground">{line.productName}</td>
                        <td className="px-4 py-3 text-center font-bold text-muted-foreground">{line.requestedQty}</td>
                        <td className="px-4 py-3 text-center">
                          <input
                            type="number"
                            min="0"
                            max={line.requestedQty}
                            value={allocatedLines[line.sku] !== undefined ? allocatedLines[line.sku] : line.requestedQty}
                            onChange={e => setAllocatedLines({ ...allocatedLines, [line.sku]: parseInt(e.target.value) || 0 })}
                            className="w-20 border rounded text-center py-1 text-sm focus:ring-2 focus:ring-primary mx-auto block"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Redirection Panel */}
            <div className="bg-amber-50/50 border border-amber-200/50 rounded-xl p-6">
              <h3 className="font-bold text-amber-900 mb-2 flex items-center gap-2">
                <ArrowLeftRight className="w-5 h-5 text-amber-600" />
                إدارة تحويل وإعادة توجيه الشحنات
              </h3>
              <p className="text-amber-700/80 text-sm mb-6 leading-relaxed">
                إذا لم يتوفر لديك مخزون كافٍ، يمكنك تحويل الطلب لفرع آخر يمتلك مخزوناً كافياً، إما يدوياً أو تلقائياً بالاعتماد على النظام الذكي.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h4 className="font-semibold text-sm text-foreground">التحويل اليدوي</h4>
                  <select
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-background"
                    value={redirectBranch}
                    onChange={e => setRedirectBranch(e.target.value)}
                  >
                    <option value="">اختر الفرع...</option>
                    {branches.filter(b => b.branchId !== userProfile?.branchId).map(b => (
                      <option key={b.branchId} value={b.branchId}>{b.branchName}</option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <button onClick={() => handleManualRedirect('all')} className="flex-1 bg-white border shadow-sm text-sm py-2 rounded-lg hover:bg-muted font-medium transition-colors">
                      تحويل كامل الطلب
                    </button>
                    <button onClick={() => handleManualRedirect('selected')} className="flex-1 bg-white border shadow-sm text-sm py-2 rounded-lg hover:bg-muted font-medium transition-colors">
                      تحويل الأصناف المحددة
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="font-semibold text-sm text-foreground">التحويل الذكي التلقائي</h4>
                  <button
                    onClick={() => handleSmartRedirect('missing')}
                    disabled={isSmartLoading}
                    className="w-full bg-gradient-to-r from-blue-50 to-indigo-50 border border-indigo-100 text-indigo-700 text-sm py-2 rounded-lg hover:from-blue-100 hover:to-indigo-100 font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    {isSmartLoading ? <LoadingSpinner className="p-0 h-4 w-4" /> : <Sparkles className="w-4 h-4" />}
                    🤖 تحويل ذكي تلقائي (الأصناف الناقصة فقط)
                  </button>
                  <button
                    onClick={() => handleSmartRedirect('all')}
                    disabled={isSmartLoading}
                    className="w-full bg-gradient-to-r from-blue-50 to-indigo-50 border border-indigo-100 text-indigo-700 text-sm py-2 rounded-lg hover:from-blue-100 hover:to-indigo-100 font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    {isSmartLoading ? <LoadingSpinner className="p-0 h-4 w-4" /> : <Sparkles className="w-4 h-4" />}
                    🤖 تحويل ذكي تلقائي (الطلب بالكامل)
                  </button>
                </div>
              </div>
            </div>

            {/* Finalize */}
            <div className="pt-4 border-t flex flex-col sm:flex-row gap-4 items-end sm:items-center justify-between">
              <div className="w-full sm:w-auto">
                <label className="block text-sm font-medium text-foreground mb-1.5 flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                  تاريخ التسليم (إلزامي)
                </label>
                <input
                  type="date"
                  value={deliveryDate}
                  onChange={e => setDeliveryDate(e.target.value)}
                  className="w-full sm:w-48 border rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary text-sm"
                />
              </div>
              <button
                onClick={confirmAllocation}
                disabled={!deliveryDate}
                className="w-full sm:w-auto bg-primary text-primary-foreground px-6 py-2.5 rounded-lg font-bold shadow-md hover:bg-primary/90 hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Truck className="w-5 h-5" />
                تأكيد التخصيص وإصدار الفاتورة
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">عمليات التخصيص</h2>
        <p className="text-muted-foreground text-sm">الطلبات الواردة التي تحتاج لمراجعة وتخصيص كمياتها</p>
      </div>

      {orders.length === 0 ? (
        <div className="bg-card border border-dashed rounded-2xl p-12 text-center flex flex-col items-center justify-center text-muted-foreground">
          <div className="bg-muted p-4 rounded-full mb-4">
            <Package className="w-8 h-8 opacity-50" />
          </div>
          <h3 className="font-bold text-lg mb-1">لا توجد طلبات جديدة</h3>
          <p className="text-sm">لم يتم توجيه أي طلبات جديدة لفرعك حالياً.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {orders.map(order => (
            <div key={order.orderId} className="bg-card border rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow group">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-bold text-lg text-foreground">{order.clientName}</h3>
                  <span className="inline-flex items-center gap-1 text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded mt-1">
                    <MapPin className="w-3 h-3" />
                    {order.clientGovernorate}
                  </span>
                </div>
                <div className="bg-primary/10 text-primary px-2 py-1 rounded text-xs font-bold font-mono">
                  #{order.orderId.slice(-6)}
                </div>
              </div>

              <div className="space-y-2 mb-6">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">نوع العميل:</span>
                  <span className="font-medium text-foreground">{order.clientType}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">إجمالي المبلغ:</span>
                  <span className="font-bold text-emerald-600">${order.totalAmount?.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">الأصناف:</span>
                  <span className="font-medium text-foreground">{order.orderLines?.length || 0} صنف</span>
                </div>
              </div>

              <button
                onClick={() => openOrder(order)}
                className="w-full bg-primary/10 hover:bg-primary/20 text-primary font-bold py-2.5 rounded-lg text-sm transition-colors group-hover:bg-primary group-hover:text-primary-foreground"
              >
                فتح ومراجعة
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
