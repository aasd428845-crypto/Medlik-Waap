import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wallet, Clock, Gift, ArrowLeftRight, RefreshCw, Plus } from 'lucide-react';
import { KPICard } from '@/components/KPICard';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorMessage } from '@/components/ErrorMessage';
import {
  listLedger,
  listBonusAccounts,
  getAccountFunds,
  type LedgerRow,
} from '@/lib/bonusFinancialApi';

const yer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

interface DashboardStats {
  accounts: number;
  earned: number;
  spent: number;
  pendingCount: number;
  reserved: number;
  outstanding: number;
  recent: LedgerRow[];
}

const TXN_LABEL: Record<string, string> = {
  EARN: 'اكتساب',
  REDEEM_PRODUCT: 'استرداد منتج',
  ORDER_DISCOUNT: 'خصم طلب',
  CASH_WITHDRAWAL: 'سحب نقدي',
  REFUND: 'استرداد مبلغ',
  REVERSAL: 'عكس قيد',
  ADJUSTMENT: 'تسوية',
  EXPIRATION: 'انتهاء صلاحية',
  OPENING_BALANCE: 'رصيد افتتاحي',
  LEGACY_MIGRATION: 'ترحيل قديم',
};

export function BonusFinancialDashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      // Totals are computed from fetched rows: exact at current scale.
      // If the ledger grows large, replace with a server-side aggregate RPC.
      const [rows, accounts] = await Promise.all([listLedger(500), listBonusAccounts()]);

      let earned = 0;
      let spent = 0;
      let pendingCount = 0;
      for (const r of rows) {
        const amount = Number(r.amount ?? 0);
        if (r.status === 'PENDING') {
          pendingCount += 1;
          continue;
        }
        if (amount > 0) earned += amount;
        else spent += -amount;
      }

      let reserved = 0;
      if (accounts.length > 0 && accounts.length <= 50) {
        const funds = await Promise.all(accounts.map((a) => getAccountFunds(a.user_id)));
        reserved = funds.reduce((s, f) => s + f.reserved, 0);
      }

      setStats({
        accounts: accounts.length,
        earned,
        spent,
        pendingCount,
        reserved,
        outstanding: earned - spent,
        recent: rows.slice(0, 8),
      });
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'تعذر تحميل بيانات المحفظة المالية');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message={error} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">المحفظة المالية للبونص</h2>
          <p className="text-muted-foreground text-sm">
            إجماليات دفتر الأستاذ المالي (bonus_ledger) — منفصلة عن نظام اشترِ واحصل القديم
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            <RefreshCw className="w-4 h-4" />
            تحديث
          </button>
          <Link
            to="/director/bonus-fin/rules"
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            إدارة القواعد
          </Link>
        </div>
      </div>

      {stats && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Link to="/director/bonus-fin/ledger">
              <KPICard
                title="إجمالي المكتسب"
                value={yer.format(stats.earned)}
                detail="ر.ي — مجموع القيود الدائنة المرحّلة"
                icon={<Wallet className="w-6 h-6" />}
                colorClass="bg-primary/10 text-primary"
              />
            </Link>
            <Link to="/director/bonus-fin/ledger">
              <KPICard
                title="الالتزام القائم"
                value={yer.format(stats.outstanding)}
                detail="المكتسب − المستخدم — ر.ي"
                icon={<ArrowLeftRight className="w-6 h-6" />}
                colorClass="bg-emerald-50 text-emerald-700"
              />
            </Link>
            <KPICard
              title="قيود معلقة"
              value={stats.pendingCount}
              detail={stats.reserved > 0 ? `محجوز: ${yer.format(stats.reserved)} ر.ي` : 'بلا مبالغ محجوزة'}
              icon={<Clock className="w-6 h-6" />}
              colorClass="bg-amber-50 text-amber-700"
            />
            <KPICard
              title="الحسابات"
              value={stats.accounts}
              detail="حسابات بونص مفتوحة"
              icon={<Gift className="w-6 h-6" />}
              colorClass="bg-secondary text-secondary-foreground"
            />
          </div>

          <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="font-bold">أحدث الحركات</h3>
              <Link to="/director/bonus-fin/ledger" className="text-sm text-primary hover:underline">
                عرض الدفتر الكامل
              </Link>
            </div>
            {stats.recent.length === 0 ? (
              <div className="px-4 py-12 text-center text-muted-foreground">
                لا توجد حركات بونص مالية بعد.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right text-sm">
                  <thead className="bg-muted/50 text-muted-foreground font-semibold border-b">
                    <tr>
                      <th className="px-4 py-3 whitespace-nowrap">النوع</th>
                      <th className="px-4 py-3 whitespace-nowrap">المبلغ (ر.ي)</th>
                      <th className="px-4 py-3 whitespace-nowrap">الحالة</th>
                      <th className="px-4 py-3 whitespace-nowrap">التاريخ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {stats.recent.map((r) => (
                      <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">{TXN_LABEL[r.txn_type] ?? r.txn_type}</td>
                        <td
                          className={`px-4 py-3 font-bold text-left ${
                            Number(r.amount) >= 0 ? 'text-emerald-700' : 'text-red-700'
                          }`}
                          dir="ltr"
                        >
                          {Number(r.amount) >= 0 ? '+' : ''}
                          {yer.format(Number(r.amount))}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium border ${
                              r.status === 'POSTED'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-amber-50 text-amber-700 border-amber-200'
                            }`}
                          >
                            {r.status === 'POSTED' ? 'مرحّل' : 'معلّق'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs" dir="ltr">
                          {String(r.created_at).slice(0, 16).replace('T', ' ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
