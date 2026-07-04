import React, { useEffect, useState } from 'react';
import { collection, query, orderBy, getDocs, updateDoc, doc, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Order, Branch } from '@/types/models';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';
import { StatusBadge } from '@/components/StatusBadge';
import { ChevronDown, ChevronUp, MapPin, Phone, MessageSquare, Send } from 'lucide-react';

export function OrdersMonitoringPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);

  // Redirection & Notification State
  const [selectedBranchForRedirect, setSelectedBranchForRedirect] = useState<Record<string, string>>({});
  const [alertMessage, setAlertMessage] = useState('');
  const [alertingOrder, setAlertingOrder] = useState<{orderId: string, branchId: string} | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      // Fetch Branches
      const bDocs = await getDocs(collection(db, 'branches'));
      const bList: Branch[] = [];
      bDocs.forEach(d => bList.push({ branchId: d.id, ...d.data() } as Branch));
      setBranches(bList);

      // Fetch Orders
      const oQ = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
      const oDocs = await getDocs(oQ);
      const oList: Order[] = [];
      oDocs.forEach(d => {
        const data = d.data() as Order;
        // fallback status for older records
        const status = data.status || data.orderStatus || 'Draft';
        oList.push({ ...data, orderId: d.id, status });
      });
      setOrders(oList);
    } catch (err) {
      console.error(err);
      setError('تعذر جلب بيانات الطلبات');
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedOrder(expandedOrder === id ? null : id);
  };

  const handleRedirect = async (order: Order) => {
    const newBranchId = selectedBranchForRedirect[order.orderId];
    if (!newBranchId) return alert('اختر فرعاً لإعادة التوجيه');
    
    try {
      await updateDoc(doc(db, 'orders', order.orderId), {
        targetBranches: [newBranchId] // Replacing for simplicity, or we could append
      });
      setOrders(orders.map(o => o.orderId === order.orderId ? { ...o, targetBranches: [newBranchId] } : o));
      alert('تم إعادة توجيه الطلب بنجاح');
    } catch (err) {
      alert('خطأ أثناء إعادة التوجيه');
    }
  };

  const sendAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!alertingOrder || !alertMessage.trim()) return;
    
    try {
      await addDoc(collection(db, 'director_notifications'), {
        orderId: alertingOrder.orderId,
        branchId: alertingOrder.branchId,
        message: alertMessage,
        type: 'branch_alert',
        createdAt: serverTimestamp()
      });
      setAlertingOrder(null);
      setAlertMessage('');
      alert('تم إرسال التنبيه للفرع');
    } catch (err) {
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
                    onClick={() => toggleExpand(order.orderId)}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{order.orderId.slice(-8)}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{order.clientName}</div>
                      <div className="text-xs text-muted-foreground">{order.clientType || 'صيدلية'}</div>
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
                      {expandedOrder === order.orderId ? <ChevronUp className="w-5 h-5 text-muted-foreground inline" /> : <ChevronDown className="w-5 h-5 text-muted-foreground inline" />}
                    </td>
                  </tr>

                  {/* Expanded Content */}
                  {expandedOrder === order.orderId && (
                    <tr className="bg-muted/10 border-b-2 border-primary/20">
                      <td colSpan={7} className="p-0">
                        <div className="p-4 md:p-6 grid grid-cols-1 md:grid-cols-2 gap-6 animate-in slide-in-from-top-2 duration-200">
                          
                          {/* Order Details */}
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
                              {/* Contact */}
                              <a 
                                href={`tel:0000000`} 
                                onClick={(e) => {
                                  // In real app, order would have phone or we query user
                                  alert('سيتم الاتصال برقم العميل المسجل');
                                  e.preventDefault();
                                }}
                                className="flex-1 bg-background border hover:bg-muted text-foreground px-4 py-3 rounded-xl flex items-center justify-center gap-2 text-sm font-medium transition-colors"
                              >
                                <Phone className="w-4 h-4 text-primary" />
                                اتصال بالعميل 📞
                              </a>
                              
                              {/* Alert Branch */}
                              <button 
                                onClick={() => setAlertingOrder({ orderId: order.orderId, branchId: order.targetBranches?.[0] || '' })}
                                className="flex-1 bg-amber-50 border border-amber-200 hover:bg-amber-100 text-amber-800 px-4 py-3 rounded-xl flex items-center justify-center gap-2 text-sm font-medium transition-colors"
                              >
                                <MessageSquare className="w-4 h-4" />
                                تنبيه الفرع 💬
                              </button>
                            </div>

                            {/* Redirect */}
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
                                    onChange={(e) => setSelectedBranchForRedirect({...selectedBranchForRedirect, [order.orderId]: e.target.value})}
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
