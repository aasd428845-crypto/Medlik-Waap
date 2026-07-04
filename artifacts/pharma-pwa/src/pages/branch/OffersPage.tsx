import { useEffect, useState } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { BranchOffer } from '@/types/models';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';
import { StatusBadge } from '@/components/StatusBadge';
import { Tag } from 'lucide-react';

export function OffersPage() {
  const { userProfile } = useAuth();
  const [offers, setOffers] = useState<BranchOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function fetchOffers() {
      if (!userProfile?.branchId) return;
      try {
        setLoading(true);
        const q = query(collection(db, 'branch_offers'), where('branchId', '==', userProfile.branchId));
        const docs = await getDocs(q);
        const list: BranchOffer[] = [];
        docs.forEach(d => list.push({ offerId: d.id, ...d.data() } as BranchOffer));
        // Sort in memory desc
        list.sort((a, b) => {
          const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
          const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
          return timeB - timeA;
        });
        setOffers(list);
      } catch (err) {
        setError('تعذر جلب العروض');
      } finally {
        setLoading(false);
      }
    }
    fetchOffers();
  }, [userProfile?.branchId]);

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message={error} />;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-foreground">عروضي</h2>
        <p className="text-muted-foreground text-sm">عروض الأسعار الخاصة بالفرع وحالتها</p>
      </div>

      {offers.length === 0 ? (
        <div className="bg-card border border-dashed rounded-2xl p-12 text-center flex flex-col items-center justify-center text-muted-foreground">
          <div className="bg-muted p-4 rounded-full mb-4">
            <Tag className="w-8 h-8 opacity-50" />
          </div>
          <h3 className="font-bold text-lg mb-1">لا توجد عروض</h3>
          <p className="text-sm">لم يقم الفرع بتقديم أي عروض أسعار حتى الآن.</p>
        </div>
      ) : (
        <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-right text-sm">
            <thead className="bg-muted/50 text-muted-foreground font-semibold border-b">
              <tr>
                <th className="px-4 py-3">المنتج</th>
                <th className="px-4 py-3 text-center">السعر المعروض</th>
                <th className="px-4 py-3 text-center">الحالة</th>
                <th className="px-4 py-3 text-left">تاريخ التقديم</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {offers.map(offer => (
                <tr key={offer.offerId} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{offer.productName}</div>
                    <div className="text-xs text-muted-foreground font-mono">{offer.productSku}</div>
                  </td>
                  <td className="px-4 py-3 text-center font-bold text-foreground">
                    ${offer.offeredPrice?.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge status={offer.status} type="offer" />
                  </td>
                  <td className="px-4 py-3 text-left text-muted-foreground text-xs" dir="ltr">
                    {offer.createdAt?.toDate ? offer.createdAt.toDate().toLocaleDateString('en-GB') : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
