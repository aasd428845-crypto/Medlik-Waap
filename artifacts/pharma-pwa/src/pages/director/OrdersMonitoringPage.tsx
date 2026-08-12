import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Order, Branch, OrderLine } from '@/types/models';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';
import { StatusBadge } from '@/components/StatusBadge';
import { ChevronDown, ChevronUp, MapPin, Phone, MessageSquare, Send } from 'lucide-react';

function mapRowToOrder(row: Record<string, unknown>): Order {
  const rawLines = (row.order_lines ?? []) as unknown[];
  const orderLines: OrderLine[] = rawLines.map((l: unknown) => {
    const line = l as Record<string, unknown>;
    return {
      sku: (line.sku as string) ?? '',
      productName: (line.product_name ?? line.productName ?? '') as string,
      requestedQty: (line.requested_qty ?? line.requestedQty ?? 0) as number,
      allocatedQty: (line.allocated_qty ?? line.allocatedQty ?? 0) as number,
      unitPrice: (line.unit_price ?? line.unitPrice ?? 0) as number,
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
    parentOrderId: (row.parent_order_id as string) ?? undefined,
  };
}

export function OrdersMonitoringPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [selectedBranchForRedirect, setSelectedBranchForRedirect] = useState<Record<string, string>>({});
  const [alertMessage, setAlertMessage] = useState('');
  const [alertingOrder, setAlertingOrder] = useState<{ orderId: string; branchId: string } | null>(null);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      setLoading(true);

      const { data: bData, error: bErr } = await supabase
        .from('branches')
          .select('id, name, governorate, latitude, longitude');
      if (bErr) throw bErr;
      setBranches((bData ?? []).map(row => ({
        branchId: row.id,
        branchName: row.name ?? '',
        governorate: row.governorate ?? '',
        latitude: row.latitude ?? 0,
        longitude: row.longitude ?? 0,
      })));

      const { data: oData, error: oErr } = await supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false });
      if (oErr) throw oErr;
      setOrders((oData ?? []).map(r => mapRowToOrder(r as Record<string, unknown>)));

    } catch (err) {
      console.error(err);
      setError('تعذر جلب بيانات الطلبات');
    } finally {
      setLoading(false);
    }
  };

  const handleRedirect = async (order: Order) => {
    const newBranchId = selectedBranchForRedirect[order.orderId];
    if (!newBranchId) return alert('اختر فرعاً لإعادة التوجيه');
    try {
      const { error: err } = await supabase
        .from('orders')
        .update({ target_branches: [newBranchId] })
        .eq('id', order.orderId);
      if (err) throw err;
      setOrders(orders.map(o => o.orderId === order.orderId ? { ...o, targetBranches: [newBranchId] } : o));
      alert('تم إعادة توجيه الطلب بنجاح');
    } catch {
      alert('خطأ أثناء إعادة التوجيه');
    }
  };

  const sendAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!alertingOrder || !alertMessage.trim()) return;
    try {
      const { error: err } = await supabase.from('director_notifications').insert({
        order_id: alertingOrder.orderId,
        branch_id: alertingOrder.branchId,
        message: alertMessage,
        type: 'branch_alert',
        created_at: new Date().toISOString(),
      });
      if (err) throw err;
      setAlertingOrder(null);
      setAlertMessage('');
      alert('تم إرسال التنبيه للفرع');
    } catch {
      alert('تعذر إرسال التنبيه');
    }
  };

  const getBranchName = (id: string) => branches.find(b => b.branchId === id)?.branchName || id;

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message={error} />;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">مراقبة الطلبات</h2>
        <p className="text-muted-foreground text-sm">متابعة حالة جميع الطلبات وإدارة توجيهها</p>
      </div>

      <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-muted/50 text-muted-foreground font-semibold border-b">
              <tr>
                <th className="px-4 py-3">رقم الطلب</th>
                <th className="px-4 py-3">العميل</th>
                <th className="px-4 py-3">المحافظة</th>
                <th className="px-4 py-3">الفروع الموجهة</th>
                <th className="px-4 py-3">المبلغ</th>
                <th className="px-4 py-3">الحالة</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {orders.map(order => (
                <React.Fragment key={order.orderId}>
                  <tr
                    className={`hover:bg-muted/30 cursor-pointer transition-colors ${expandedOrder === order.orderId ? 'bg-primary/5' : ''}`}
                    onClick={() => setExpandedOrder(expandedOrder === order.orderId ? null : order.orderId)}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{order.orderId.slice(-8)}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{order.clientName}</div>
                      <div className="text-xs text-muted-foreground">{order.clientType}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{order.clientGovernorate}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {order.targetBranches?.map(tb => (
                          <span key={tb} className="bg-secondary text-secondary-foreground text-[10px] px-1.5 py-0.5 rounded">
                            {getBranchName(tb)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-bold text-foreground">${order.totalAmount?.toLocaleString()}</td>
                    <td className="px-4 py-3"><StatusBadge status={order.status} type="order" /></td>
                    <td className="px-4 py-3 text-center">
                      {expandedOrder === order.orderId
                        ? <ChevronUp className="w-5 h-5 text-muted-foreground inline" />
                        : <ChevronDown className="w-5 h-5 text-muted-foreground inline" />}
                    </td>
                  </tr>

                  {expandedOrder === order.orderId && (
                    <tr className="bg-muted/10 border-b-2 border-primary/20">
                      <td colSpan={7} className="p-0">
                        <div className="p-4 md:p-6 grid grid-cols-1 md:grid-cols-2 gap-6 animate-in slide-in-from-top-2 duration-200">

                          {/* Order Lines */}
                          <div className="space-y-4">
                            <h4 className="font-bold text-foreground text-sm border-b pb-2">محتوى الطلب</h4>
                            <div className="bg-background border rounded-lg overflow-hidden">
                              <table className="w-full text-xs">
                                <thead className="bg-muted">
                                  <tr>
                                    <th className="px-3 py-2 text-right">المنتج</th>
                                    <th className="px-3 py-2 text-center">مطلوب</th>
                                    <th className="px-3 py-2 text-center">مخصص</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y">
                                  {order.orderLines?.map((line, idx) => (
                                    <tr key={idx}>
                                      <td className="px-3 py-2">{line.productName} <span className="text-muted-foreground block">{line.sku}</span></td>
                                      <td className="px-3 py-2 text-center font-medium">{line.requestedQty}</td>
                                      <td className="px-3 py-2 text-center text-primary font-bold">{line.allocatedQty || '-'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="space-y-4">
                            <h4 className="font-bold text-foreground text-sm border-b pb-2">إجراءات إدارية</h4>

                            <div className="flex gap-3">
                              <a
                                href="tel:0000000"
                                onClick={e => { alert('سيتم الاتصال برقم العميل المسجل'); e.preventDefault(); }}
                                className="flex-1 bg-background border hover:bg-muted text-foreground px-4 py-3 rounded-xl flex items-center justify-center gap-2 text-sm font-medium transition-colors"
                              >
                                <Phone className="w-4 h-4 text-primary" />
                                اتصال بالعميل 📞
                              </a>

                              <button
                                onClick={() => setAlertingOrder({ orderId: order.orderId, branchId: order.targetBranches?.[0] || '' })}
                                className="flex-1 bg-amber-50 border border-amber-200 hover:bg-amber-100 text-amber-800 px-4 py-3 rounded-xl flex items-center justify-center gap-2 text-sm font-medium transition-colors"
                              >
                                <MessageSquare className="w-4 h-4" />
                                تنبيه الفرع 💬
                              </button>
                            </div>

                            {['Submitted', 'Draft', 'Allocated'].includes(order.status) && (
                              <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 space-y-3">
                                <h5 className="text-xs font-bold text-primary flex items-center gap-1.5">
                                  <MapPin className="w-4 h-4" />
                                  إعادة التوجيه اليدوي
                                </h5>
                                <div className="flex gap-2">
                                  <select
                                    className="flex-1 border-primary/30 rounded-lg text-sm bg-background px-3 py-2 focus:ring-1 focus:ring-primary"
                                    value={selectedBranchForRedirect[order.orderId] || ''}
                                    onChange={e => setSelectedBranchForRedirect({ ...selectedBranchForRedirect, [order.orderId]: e.target.value })}
                                  >
                                    <option value="">اختر فرعاً بديلاً...</option>
                                    {branches.map(b => (
                                      <option key={b.branchId} value={b.branchId}>{b.branchName} ({b.governorate})</option>
                                    ))}
                                  </select>
                                  <button
                                    onClick={() => handleRedirect(order)}
                                    className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors shrink-0"
                                  >
                                    توجيه
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    لا توجد طلبات في النظام.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Alert Dialog */}
      {alertingOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-card rounded-xl shadow-xl w-full max-w-md animate-in fade-in zoom-in-95 duration-200">
            <form onSubmit={sendAlert}>
              <div className="p-6 space-y-4">
                <h3 className="text-lg font-bold flex items-center gap-2 text-foreground">
                  <MessageSquare className="w-5 h-5 text-amber-500" />
                  إرسال تنبيه لمدير الفرع
                </h3>
                <p className="text-sm text-muted-foreground">
                  الطلب: <span className="font-mono text-xs">{alertingOrder.orderId.slice(-8)}</span>
                </p>
                <textarea
                  required
                  rows={4}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary resize-none bg-background"
                  placeholder="اكتب رسالتك هنا..."
                  value={alertMessage}
                  onChange={e => setAlertMessage(e.target.value)}
                />
              </div>
              <div className="bg-muted/50 px-6 py-4 flex justify-end gap-3 border-t">
                <button type="button" onClick={() => setAlertingOrder(null)} className="px-4 py-2 rounded-lg text-sm font-medium border hover:bg-background">
                  إلغاء
                </button>
                <button type="submit" className="px-4 py-2 rounded-lg text-sm font-medium bg-amber-500 text-white hover:bg-amber-600 flex items-center gap-2">
                  <Send className="w-4 h-4" />
                  إرسال
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
