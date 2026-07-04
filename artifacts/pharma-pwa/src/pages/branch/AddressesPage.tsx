import { useEffect, useState } from 'react';
import { collection, query, where, getDocs, addDoc, updateDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { Address } from '@/types/models';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';
import { MapPin, Plus, Edit2, XCircle } from 'lucide-react';

export function AddressesPage() {
  const { userProfile } = useAuth();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAddr, setEditingAddr] = useState<Address | null>(null);

  useEffect(() => {
    fetchAddresses();
  }, [userProfile?.branchId]);

  const fetchAddresses = async () => {
    if (!userProfile?.branchId) return;
    try {
      setLoading(true);
      const q = query(collection(db, 'addresses'), where('branchId', '==', userProfile.branchId));
      const docs = await getDocs(q);
      const list: Address[] = [];
      docs.forEach(d => list.push({ addressId: d.id, ...d.data() } as Address));
      setAddresses(list);
    } catch (err) {
      setError('تعذر جلب العناوين');
    } finally {
      setLoading(false);
    }
  };

  const openAdd = () => {
    if (!userProfile?.branchId) return;
    setEditingAddr({
      addressId: '',
      branchId: userProfile.branchId,
      addressText: '',
      latitude: undefined,
      longitude: undefined
    });
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAddr || !userProfile?.branchId) return;
    try {
      const { addressId, ...data } = editingAddr;
      if (addressId) {
        await updateDoc(doc(db, 'addresses', addressId), data as any);
        setAddresses(addresses.map(a => a.addressId === addressId ? { ...a, ...data } : a));
      } else {
        const res = await addDoc(collection(db, 'addresses'), data);
        setAddresses([...addresses, { ...editingAddr, addressId: res.id }]);
      }
      setIsModalOpen(false);
    } catch (err) {
      alert('خطأ أثناء الحفظ');
    }
  };

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message={error} />;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-foreground">إدارة العناوين</h2>
          <p className="text-muted-foreground text-sm">عناوين التوصيل والمواقع المرتبطة بالفرع</p>
        </div>
        <button 
          onClick={openAdd}
          className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-primary/90 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          عنوان جديد
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {addresses.map(addr => (
          <div key={addr.addressId} className="bg-card border rounded-xl p-5 shadow-sm flex items-start justify-between group hover:border-primary/50 transition-colors">
            <div className="flex gap-3">
              <div className="bg-primary/10 p-2.5 rounded-full text-primary shrink-0 h-min">
                <MapPin className="w-5 h-5" />
              </div>
              <div>
                <p className="font-medium text-foreground leading-relaxed">{addr.addressText}</p>
                {(addr.latitude && addr.longitude) ? (
                  <p className="text-xs text-muted-foreground mt-2 font-mono" dir="ltr">
                    {addr.latitude.toFixed(6)}, {addr.longitude.toFixed(6)}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground mt-2">لا توجد إحداثيات</p>
                )}
              </div>
            </div>
            <button 
              onClick={() => { setEditingAddr(addr); setIsModalOpen(true); }}
              className="text-muted-foreground hover:text-primary p-2 opacity-0 group-hover:opacity-100 transition-all rounded-lg hover:bg-primary/10"
            >
              <Edit2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        {addresses.length === 0 && (
          <div className="col-span-full bg-card border border-dashed rounded-xl p-12 text-center text-muted-foreground">
            <MapPin className="w-8 h-8 opacity-20 mx-auto mb-3" />
            <p>لا توجد عناوين مسجلة لهذا الفرع بعد.</p>
          </div>
        )}
      </div>

      {isModalOpen && editingAddr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-card rounded-xl shadow-xl w-full max-w-md animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b flex justify-between items-center bg-muted/20">
              <h3 className="font-bold text-lg">{editingAddr.addressId ? 'تعديل العنوان' : 'إضافة عنوان جديد'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-muted-foreground hover:text-foreground">
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">العنوان بالتفصيل *</label>
                <textarea 
                  required
                  rows={3}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary bg-background resize-none"
                  value={editingAddr.addressText}
                  onChange={e => setEditingAddr({...editingAddr, addressText: e.target.value})}
                  placeholder="المدينة، الحي، الشارع، المبنى..."
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">خط العرض (Latitude)</label>
                  <input 
                    type="number" step="any"
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary bg-background text-left" dir="ltr"
                    value={editingAddr.latitude || ''}
                    onChange={e => setEditingAddr({...editingAddr, latitude: parseFloat(e.target.value) || undefined})}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">خط الطول (Longitude)</label>
                  <input 
                    type="number" step="any"
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary bg-background text-left" dir="ltr"
                    value={editingAddr.longitude || ''}
                    onChange={e => setEditingAddr({...editingAddr, longitude: parseFloat(e.target.value) || undefined})}
                  />
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-3 pt-4 border-t">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm font-medium border rounded-lg hover:bg-muted transition-colors">
                  إلغاء
                </button>
                <button type="submit" className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">
                  حفظ العنوان
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
