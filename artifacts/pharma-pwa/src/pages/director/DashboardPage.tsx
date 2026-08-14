import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { KPICard } from '@/components/KPICard';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowUpLeft,
  Boxes,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  Database,
  FileText,
  PackageSearch,
  RefreshCw,
  ShoppingCart,
  Store,
  Truck,
  Wallet,
} from 'lucide-react';
import { WarehouseInventoryItem } from '@/types/models';

const money = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);

const number = (value: number) => new Intl.NumberFormat('en-US').format(value);

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-label="جاري تحميل لوحة القيادة">
      <div className="h-44 animate-pulse rounded-2xl bg-card/70" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-40 animate-pulse rounded-2xl bg-card/70" />)}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
        <div className="h-80 animate-pulse rounded-2xl bg-card/70" />
        <div className="h-80 animate-pulse rounded-2xl bg-card/70" />
      </div>
    </div>
  );
}

export function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [kpis, setKpis] = useState({ totalSales: 0, receivables: 0, activeOrders: 0, activeBranches: 0 });
  const [criticalInventory, setCriticalInventory] = useState<WarehouseInventoryItem[]>([]);

  useEffect(() => {
    async function fetchDashboardData() {
      try {
        setLoading(true);
        setError('');

        const { data: salesData } = await supabase.from('orders').select('total_amount').in('status', ['Invoiced', 'Delivered']);
        const totalSales = (salesData ?? []).reduce((sum, row) => sum + (row.total_amount ?? 0), 0);

        const { count: activeOrders } = await supabase
          .from('orders')
          .select('*', { count: 'exact', head: true })
          .in('status', ['Submitted', 'Allocated', 'PartiallyShipped', 'OutForDelivery']);

        const { data: invoicesData } = await supabase.from('invoices').select('total_amount').neq('status', 'paid');
        const receivables = (invoicesData ?? []).reduce((sum, row) => sum + (row.total_amount ?? 0), 0);

        const { count: activeBranches } = await supabase.from('branches').select('*', { count: 'exact', head: true });

        const { data: criticalData } = await supabase.from('warehouse_inventory').select('*').lt('available_quantity', 10);
        const critItems: WarehouseInventoryItem[] = (criticalData ?? []).map((row) => ({
          id: row.id,
          sku: row.sku ?? '',
          name: row.name ?? '',
          dosageForm: row.dosage_form ?? '',
          availableQuantity: row.available_quantity ?? 0,
          expiryDate: row.expiry_date ?? undefined,
          branchId: row.branch_id ?? '',
        }));

        setKpis({ totalSales, receivables, activeOrders: activeOrders ?? 0, activeBranches: activeBranches ?? 0 });
        setCriticalInventory(critItems);
      } catch (err: unknown) {
        console.error('Dashboard Fetch Error', err);
        setError('تعذر جلب بيانات لوحة التحكم. تأكد من إعدادات قاعدة البيانات.');
      } finally {
        setLoading(false);
      }
    }

    fetchDashboardData();
  }, []);

  if (loading) return <DashboardSkeleton />;

  if (error) {
    return (
      <div className="director-panel flex min-h-[360px] flex-col items-center justify-center rounded-2xl p-8 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive"><AlertTriangle /></div>
        <h2 className="text-lg font-bold">تعذر تحميل مؤشرات الأداء</h2>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">{error}</p>
        <button onClick={() => window.location.reload()} className="mt-6 inline-flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm font-bold text-primary transition-colors hover:bg-primary/20">
          <RefreshCw className="h-4 w-4" /> إعادة المحاولة
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-6">
      <section className="director-panel director-reveal relative overflow-hidden rounded-2xl p-5 md:p-7">
        <div className="absolute -left-24 -top-32 h-72 w-72 rounded-full bg-accent/10 blur-3xl" />
        <div className="absolute bottom-0 right-1/3 h-24 w-72 rounded-full bg-primary/5 blur-3xl" />
        <div className="relative flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div>
            <div className="mb-3 flex items-center gap-2 text-[10px] font-bold tracking-[0.16em] text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_9px_rgba(52,211,153,.7)]" />
              النظام التشغيلي متصل
            </div>
            <h1 className="max-w-2xl text-2xl font-extrabold leading-tight tracking-tight md:text-3xl">
              صورة تنفيذية واضحة لأداء شبكة التوزيع
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground">
              راقب التدفق المالي، سرعة تنفيذ الطلبات، ومخاطر المخزون من مركز واحد مصمم للقرارات السريعة.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3 rounded-xl border border-white/10 bg-background/30 px-4 py-3">
            <Activity className="h-5 w-5 text-primary" />
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground">حالة البيانات</p>
              <p className="text-sm font-bold text-emerald-300">متزامنة مع النظام</p>
            </div>
            <span className="mr-2 text-[10px] text-muted-foreground">الآن</span>
          </div>
        </div>
        <div className="relative mt-6 h-px bg-gradient-to-l from-transparent via-primary/40 to-transparent" />
        <div className="relative mt-4 flex flex-wrap items-center justify-between gap-3 text-[11px] text-muted-foreground">
          <span>مؤشرات الأعمال الموحدة لجميع الفروع والقنوات</span>
          <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> نافذة المراقبة التنفيذية</span>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <KPICard title="إجمالي المبيعات" value={money(kpis.totalSales)} icon={<CircleDollarSign className="h-5 w-5" />} colorClass="bg-primary/10 text-primary" trend="إيرادات محققة" detail="الفواتير المسجلة والمسلّمة" />
        <KPICard title="الذمم المدينة" value={money(kpis.receivables)} icon={<Wallet className="h-5 w-5" />} colorClass="bg-amber-400/10 text-amber-300" trend="يتطلب متابعة" detail="فواتير غير مسددة" />
        <KPICard title="الطلبات النشطة" value={number(kpis.activeOrders)} icon={<ShoppingCart className="h-5 w-5" />} colorClass="bg-accent/10 text-accent" trend="قيد التنفيذ" detail="من التسليم إلى التوزيع" />
        <KPICard title="الفروع النشطة" value={number(kpis.activeBranches)} icon={<Building2 className="h-5 w-5" />} colorClass="bg-emerald-400/10 text-emerald-300" trend="شبكة التشغيل" detail="فروع مسجلة في النظام" />
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.25fr_.75fr]">
        <div className="director-panel director-reveal director-reveal-1 rounded-2xl p-5 md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-destructive/10 text-destructive"><AlertTriangle className="h-4 w-4" /></div>
                <div>
                  <h2 className="text-base font-extrabold">المخزون الحرج</h2>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">أصناف تحتاج قرار توريد قبل التأثير على الخدمة</p>
                </div>
              </div>
            </div>
            <Link to="/director/inventory-overview" className="flex items-center gap-1 text-xs font-bold text-primary transition-colors hover:text-primary/70">
              فتح النظرة الشاملة <ArrowLeft className="h-3.5 w-3.5" />
            </Link>
          </div>

          {criticalInventory.length > 0 ? (
            <div className="director-scrollbar mt-5 overflow-x-auto rounded-xl border border-destructive/15">
              <table className="w-full min-w-[520px] text-right text-xs">
                <thead className="border-b border-destructive/15 bg-destructive/[0.05] text-[10px] font-bold text-muted-foreground">
                  <tr><th className="px-4 py-3">الصنف الدوائي</th><th className="px-4 py-3">الشكل والتركيز</th><th className="px-4 py-3">الفرع</th><th className="px-4 py-3">المتاح</th></tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {criticalInventory.slice(0, 5).map((item, index) => (
                    <tr key={item.id} className="group transition-colors hover:bg-white/[0.035]">
                      <td className="px-4 py-3.5"><div className="flex items-center gap-2.5"><span className="text-[10px] text-muted-foreground/60">0{index + 1}</span><span className="font-bold">{item.name || 'صنف غير مسمى'}</span></div></td>
                      <td className="px-4 py-3.5 text-muted-foreground">{item.dosageForm || '—'}</td>
                      <td className="px-4 py-3.5 font-mono text-[10px] text-muted-foreground">{item.branchId || '—'}</td>
                      <td className="px-4 py-3.5"><span className="inline-flex min-w-10 items-center justify-center rounded-md bg-destructive/10 px-2 py-1 font-extrabold text-destructive">{item.availableQuantity}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {criticalInventory.length > 5 && <div className="border-t border-destructive/15 bg-destructive/[0.04] px-4 py-2 text-center text-[10px] font-semibold text-destructive">+ {criticalInventory.length - 5} أصناف أخرى تحت العتبة</div>}
            </div>
          ) : (
            <div className="mt-5 flex items-center gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4 text-sm text-emerald-200">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              <span>المخزون مستقر حالياً، لا توجد أصناف تحت العتبة الحرجة.</span>
            </div>
          )}
        </div>

        <div className="director-panel director-reveal director-reveal-2 rounded-2xl p-5 md:p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><ArrowUpLeft className="h-4 w-4" /></div>
              <div><h2 className="text-base font-extrabold">مؤشر التنفيذ</h2><p className="mt-0.5 text-[11px] text-muted-foreground">نقاط المتابعة ذات الأولوية</p></div>
            </div>
            <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-1 text-[10px] font-bold text-primary">مباشر</span>
          </div>
          <div className="mt-6 space-y-5">
            <div>
              <div className="mb-2 flex justify-between text-xs"><span className="text-muted-foreground">تغطية شبكة الفروع</span><span className="font-bold text-primary">{kpis.activeBranches > 0 ? 'نشط' : 'لا بيانات'}</span></div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/5"><div className="h-full w-[82%] rounded-full bg-primary" /></div>
            </div>
            <div>
              <div className="mb-2 flex justify-between text-xs"><span className="text-muted-foreground">انسيابية الطلبات</span><span className="font-bold text-accent">{kpis.activeOrders > 0 ? 'قيد المعالجة' : 'هادئ'}</span></div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/5"><div className="h-full w-[68%] rounded-full bg-accent" /></div>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><Database className="h-4 w-4 text-primary" /> آخر مزامنة تشغيلية</div>
              <span className="text-xs font-bold text-foreground">متصلة</span>
            </div>
          </div>
        </div>
      </section>

      <section className="director-reveal director-reveal-3">
        <div className="mb-3 flex items-end justify-between">
          <div><p className="text-[10px] font-bold tracking-[0.16em] text-primary">SHORTCUTS</p><h2 className="mt-1 text-lg font-extrabold">إجراءات الإدارة السريعة</h2></div>
          <span className="text-[11px] text-muted-foreground">وصول مباشر إلى مسارات العمل اليومية</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { to: '/director/catalog', title: 'كتالوج المنتجات', desc: 'إدارة الأصناف والتسعير', icon: PackageSearch, tone: 'text-primary bg-primary/10' },
            { to: '/director/inventory-overview', title: 'مركز المخزون', desc: 'التغطية والاحتياج حسب الفرع', icon: Boxes, tone: 'text-accent bg-accent/10' },
            { to: '/director/orders-monitoring', title: 'مراقبة الطلبات', desc: 'تقدم التوزيع والتسليم', icon: ClipboardList, tone: 'text-emerald-300 bg-emerald-400/10' },
            { to: '/director/receivables', title: 'الذمم المدينة', desc: 'متابعة التحصيل والفواتير', icon: FileText, tone: 'text-amber-300 bg-amber-400/10' },
          ].map((action) => (
            <Link key={action.to} to={action.to} className="director-panel group flex items-center gap-3 rounded-xl p-4 transition-all duration-300 hover:-translate-y-0.5 hover:bg-card">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${action.tone} transition-transform duration-300 group-hover:scale-105`}><action.icon className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1"><h3 className="truncate text-xs font-extrabold">{action.title}</h3><p className="mt-1 truncate text-[10px] text-muted-foreground">{action.desc}</p></div>
              <ArrowLeft className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 group-hover:-translate-x-1 group-hover:text-primary" />
            </Link>
          ))}
        </div>
      </section>

      <section className="director-reveal director-reveal-4 grid gap-3 sm:grid-cols-3">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card/40 p-4"><Store className="h-4 w-4 text-primary" /><div><p className="text-[10px] text-muted-foreground">نطاق التغطية</p><p className="mt-1 text-xs font-bold">{number(kpis.activeBranches)} فروع نشطة</p></div></div>
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card/40 p-4"><Truck className="h-4 w-4 text-accent" /><div><p className="text-[10px] text-muted-foreground">حركة التوزيع</p><p className="mt-1 text-xs font-bold">{number(kpis.activeOrders)} طلبات قيد التنفيذ</p></div></div>
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card/40 p-4"><CircleDollarSign className="h-4 w-4 text-emerald-300" /><div><p className="text-[10px] text-muted-foreground">صحة التدفق النقدي</p><p className="mt-1 text-xs font-bold">{money(kpis.receivables)} قيد التحصيل</p></div></div>
      </section>
    </div>
  );
}