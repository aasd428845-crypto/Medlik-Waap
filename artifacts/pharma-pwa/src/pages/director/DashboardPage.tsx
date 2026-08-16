import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Boxes,
  Building2,
  CheckCircle2,
  ClipboardList,
  Clock,
  PackageSearch,
  RefreshCw,
  ShoppingCart,
  Store,
  TrendingDown,
  Truck,
  Users,
} from 'lucide-react';
import { formatYer, getOperationalDashboardData, type OperationalDashboardData } from '@/lib/dashboardApi';

const deltaPct = (v: number) => (v > 0 ? `+${v}%` : `${v}%`);
const isUp = (v: number) => v >= 0;

const ORDER_STATUS_TONE: Record<string, string> = {
  Submitted: 'border-accent/30 bg-accent/10 text-accent',
  Allocated: 'border-primary/30 bg-primary/10 text-primary',
  PartiallyShipped: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  OutForDelivery: 'border-violet-400/30 bg-violet-400/10 text-violet-300',
  Delivered: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  Invoiced: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-300',
};

const ORDER_STATUS_LABEL: Record<string, string> = {
  Submitted: 'مُسلّم',
  Allocated: 'مُخصص',
  PartiallyShipped: 'شُحن جزئياً',
  OutForDelivery: 'قيد التوزيع',
  Delivered: 'تم التسليم',
  Invoiced: 'تمت الفوترة',
};

function OperationalKpiCard({ title, value, display, icon, delta, tone }: {
  title: string;
  value: string;
  display: string;
  icon: React.ReactNode;
  delta: number;
  tone: string;
}) {
  const up = isUp(delta);
  return (
    <article className="director-panel director-reveal group relative overflow-hidden rounded-2xl p-5 transition-all duration-300 hover:-translate-y-0.5">
      <div className="absolute inset-x-0 top-0 h-px director-glow-line opacity-60" />
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${tone} transition-transform duration-300 group-hover:scale-105`}>
          {icon}
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-extrabold ${up ? 'border border-emerald-400/20 bg-emerald-400/10 text-emerald-300' : 'border border-red-400/20 bg-red-400/10 text-red-400'}`} dir="ltr">
          {up ? <ArrowUpRight className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {deltaPct(delta)}
        </span>
      </div>
      <div className="mt-5">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground">{title}</p>
        <h3 className="mt-1 text-2xl font-extrabold tracking-tight md:text-[1.6rem]" dir="ltr">{display}</h3>
        <p className="mt-1 text-[11px] text-muted-foreground">{value}</p>
      </div>
      <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/5">
        <div className="h-full w-2/3 rounded-full bg-gradient-to-l from-primary to-accent transition-all duration-500 group-hover:w-4/5" />
      </div>
    </article>
  );
}

function ChartTooltipBox({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border bg-card/95 px-4 py-3 text-xs shadow-2xl backdrop-blur">
      <p className="mb-1 font-bold text-muted-foreground">{label}</p>
      <p className="font-extrabold text-primary">{payload[0].value} طلب</p>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-label="جاري تحميل لوحة التحكم التشغيلية">
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
  const [data, setData] = useState<OperationalDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date>(() => new Date());

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const result = await getOperationalDashboardData();
      setData(result);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Dashboard Fetch Error', err);
      setError('تعذر جلب بيانات لوحة التحكم التشغيلية. تأكد من إعدادات قاعدة البيانات.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 45_000);
    return () => clearInterval(t);
  }, []);

  const maxOrders = useMemo(() => Math.max(...(data?.orders14d ?? []).map((d) => d.orders), 1), [data]);

  if (loading && !data) return <DashboardSkeleton />;

  if (error || !data) {
    return (
      <div className="director-panel flex min-h-[360px] flex-col items-center justify-center rounded-2xl p-8 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive"><AlertTriangle /></div>
        <h2 className="text-lg font-bold">تعذر تحميل مؤشرات الأداء</h2>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">{error}</p>
        <button onClick={() => void load()} className="mt-6 inline-flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm font-bold text-primary transition-colors hover:bg-primary/20">
          <RefreshCw className="h-4 w-4" /> إعادة المحاولة
        </button>
      </div>
    );
  }

  const { kpis, criticalAlert, orders14d, recentOrders } = data;
  const criticalBranches = criticalAlert.branchesCount;

  return (
    <div className="mx-auto max-w-[1600px] space-y-6">
      <section className="director-panel director-reveal relative overflow-hidden rounded-2xl p-5 md:p-7">
        <div className="absolute -left-24 -top-32 h-72 w-72 rounded-full bg-accent/10 blur-3xl" />
        <div className="absolute bottom-0 right-1/3 h-24 w-72 rounded-full bg-primary/5 blur-3xl" />
        <div className="relative flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div>
            <div className="mb-3 flex items-center gap-2 text-[10px] font-bold tracking-[0.16em] text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_9px_rgba(52,211,153,.7)]" />
              لوحة التحكم التشغيلية — بيانات مباشرة
            </div>
            <h1 className="max-w-2xl text-2xl font-extrabold leading-tight tracking-tight md:text-3xl">
              صورة تنفيذية واضحة لأداء شبكة التوزيع
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground">
              راقب سرعة تنفيذ الطلبات، المندوبين، ومخاطر المخزون من مركز واحد مصمم للقرارات السريعة.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3 rounded-xl border border-white/10 bg-background/30 px-4 py-3">
            <Activity className="h-5 w-5 text-primary" />
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground">آخر تحديث</p>
              <p className="text-sm font-bold text-emerald-300" dir="ltr">{lastUpdated.toLocaleTimeString('ar')}</p>
            </div>
            <button onClick={() => void load()} aria-label="تحديث" className="rounded-lg border border-primary/25 bg-primary/10 p-1.5 text-primary transition-colors hover:bg-primary/20">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
        <div className="relative mt-6 h-px bg-gradient-to-l from-transparent via-primary/40 to-transparent" />
        <div className="relative mt-4 flex flex-wrap items-center justify-between gap-3 text-[11px] text-muted-foreground">
          <span>مؤشرات الأعمال الموحدة لجميع الفروع والقنوات</span>
          <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> نافذة المراقبة التنفيذية</span>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <OperationalKpiCard title="الفروع النشطة" value="شبكة التشغيل" display={String(kpis.activeBranches.value)} delta={kpis.activeBranches.deltaPct} tone="bg-emerald-400/10 text-emerald-300" icon={<Building2 className="h-5 w-5" />} />
        <OperationalKpiCard title="الطلبات النشطة" value="قيد التنفيذ" display={String(kpis.activeOrders.value)} delta={kpis.activeOrders.deltaPct} tone="bg-primary/10 text-primary" icon={<ShoppingCart className="h-5 w-5" />} />
        <OperationalKpiCard title="المندوبون" value="فرق التوزيع" display={String(kpis.deliveryAgents.value)} delta={kpis.deliveryAgents.deltaPct} tone="bg-accent/10 text-accent" icon={<Truck className="h-5 w-5" />} />
        <OperationalKpiCard title="أصناف المخزون الحرج" value="منخفض / نافد" display={String(kpis.criticalItems.value)} delta={kpis.criticalItems.deltaPct} tone="bg-red-400/10 text-red-400" icon={<AlertTriangle className="h-5 w-5" />} />
      </section>

      <section className={`director-panel director-reveal director-reveal-1 relative overflow-hidden rounded-2xl p-5 md:p-6 ${criticalAlert.itemsCount > 0 ? 'border-red-400/25' : ''}`}>
        <div className="absolute inset-0 bg-gradient-to-l from-red-500/10 via-amber-500/5 to-transparent" />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-red-400/15 text-red-400">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-base font-extrabold">
                {criticalAlert.itemsCount > 0
                  ? `${criticalAlert.itemsCount} صنف بمخزون حرج ${criticalBranches > 0 ? `في ${criticalBranches} فروع` : 'تحتاج توريد'}`
                  : 'المخزون مستقر'}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {criticalAlert.itemsCount > 0
                  ? 'أصناف منخفضة أو نافدة تحتاج قرار توريد قبل التأثير على الخدمة.'
                  : 'لا توجد أصناف تحت العتبة الحرجة حالياً.'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link to="/director/expiry-alerts" className="inline-flex items-center gap-2 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-2.5 text-sm font-bold text-red-300 transition-colors hover:bg-red-400/20">
              <PackageSearch className="h-4 w-4" /> تنبيهات الصلاحية والمخزون <ArrowLeft className="h-4 w-4" />
            </Link>
            <Link to="/director/inventory-overview" className="inline-flex items-center gap-2 rounded-xl border border-border bg-background/40 px-4 py-2.5 text-sm font-bold text-foreground transition-colors hover:bg-background/60">
              <Boxes className="h-4 w-4" /> النظرة الشاملة
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.35fr_.65fr]">
        <div className="director-panel director-reveal director-reveal-2 rounded-2xl p-5 md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><ClipboardList className="h-4 w-4" /></div>
              <div>
                <h2 className="text-base font-extrabold">حجم الطلبات اليومي — آخر 14 يوماً</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">الطلبات الواردة لكل يوم</p>
              </div>
            </div>
            <Link to="/director/orders-monitoring" className="flex items-center gap-1 text-xs font-bold text-primary transition-colors hover:text-primary/70">
              مراقبة الطلبات <ArrowLeft className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="mt-6 h-[300px] w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={orders14d} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="day" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} axisLine={false} tickLine={false} width={32} />
                <Tooltip content={<ChartTooltipBox />} cursor={{ fill: 'hsl(var(--muted))' }} />
                <Bar dataKey="orders" radius={[8, 8, 0, 0]} barSize={18}>
                  {orders14d.map((d, i) => (
                    <Cell key={d.day} fill={d.orders === maxOrders ? 'hsl(var(--primary))' : 'hsl(var(--chart-2))'} fillOpacity={0.55 + (d.orders / maxOrders) * 0.45} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>الذروة: <span className="font-extrabold text-primary">{maxOrders} طلبات</span> في يوم واحد</span>
            <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> الطلبات اليومية</span>
          </div>
        </div>

        <div className="director-panel director-reveal director-reveal-3 rounded-2xl p-5 md:p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10 text-accent"><Activity className="h-4 w-4" /></div>
              <div>
                <h2 className="text-base font-extrabold">مؤشر التنفيذ</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">نقاط المتابعة ذات الأولوية</p>
              </div>
            </div>
            <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-1 text-[10px] font-bold text-primary">مباشر</span>
          </div>
          <div className="mt-6 space-y-5">
            <div>
              <div className="mb-2 flex justify-between text-xs"><span className="text-muted-foreground">تغطية شبكة الفروع</span><span className="font-bold text-primary">{kpis.activeBranches.value > 0 ? 'نشط' : 'لا بيانات'}</span></div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/5"><div className="h-full w-[82%] rounded-full bg-primary" /></div>
            </div>
            <div>
              <div className="mb-2 flex justify-between text-xs"><span className="text-muted-foreground">انسيابية الطلبات</span><span className="font-bold text-accent">{kpis.activeOrders.value > 0 ? 'قيد المعالجة' : 'هادئ'}</span></div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/5"><div className="h-full w-[68%] rounded-full bg-accent" /></div>
            </div>
            <div>
              <div className="mb-2 flex justify-between text-xs"><span className="text-muted-foreground">جاهزية فرق التوزيع</span><span className="font-bold text-emerald-300">{kpis.deliveryAgents.value > 0 ? `${kpis.deliveryAgents.value} مندوب` : 'لا بيانات'}</span></div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/5"><div className="h-full w-[75%] rounded-full bg-emerald-400" /></div>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><Clock className="h-4 w-4 text-primary" /> آخر مزامنة تشغيلية</div>
              <span className="text-xs font-bold text-foreground" dir="ltr">{lastUpdated.toLocaleTimeString('ar')}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="director-panel director-reveal director-reveal-4 overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-border p-5">
          <div>
            <h2 className="text-base font-extrabold">آخر الطلبات الواردة</h2>
            <p className="mt-1 text-[11px] text-muted-foreground">أحدث طلبات العملاء عبر الشبكة</p>
          </div>
          <Link to="/director/orders-monitoring" className="flex items-center gap-1 text-xs font-bold text-primary transition-colors hover:text-primary/70">
            مراقبة الطلبات <ArrowLeft className="h-3.5 w-3.5" />
          </Link>
        </div>
        <ul className="divide-y divide-border/60">
          {recentOrders.map((order) => (
            <li key={order.id} className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-white/[0.03]">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <ShoppingCart className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">
                  {order.client}
                  <span className="mr-2 font-mono text-[10px] font-semibold text-muted-foreground" dir="ltr">{order.orderNumber}</span>
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Store className="h-3 w-3" /> {order.branch}
                  <span className="text-muted-foreground/50">·</span>
                  {new Date(order.createdAt).toLocaleDateString('ar', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              <div className="text-left">
                <p className="text-sm font-extrabold" dir="ltr">{formatYer(order.total)}</p>
                <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${ORDER_STATUS_TONE[order.status] ?? 'border-border bg-muted text-muted-foreground'}`}>
                  {ORDER_STATUS_LABEL[order.status] ?? order.status}
                </span>
              </div>
            </li>
          ))}
          {recentOrders.length === 0 && (
            <li className="flex items-center gap-3 px-5 py-8 text-sm text-muted-foreground">
              <CheckCircle2 className="h-5 w-5 text-emerald-300" /> لا توجد طلبات واردة بعد.
            </li>
          )}
        </ul>
        <div className="border-t border-border bg-white/[0.02] px-5 py-3">
          <Link to="/director/orders-monitoring" className="flex items-center justify-center gap-1.5 text-xs font-bold text-primary transition-colors hover:text-primary/70">
            عرض جميع الطلبات <ArrowDownLeft className="h-3.5 w-3.5" />
          </Link>
        </div>
      </section>

      <section className="director-reveal">
        <div className="mb-3 flex items-end justify-between">
          <div><p className="text-[10px] font-bold tracking-[0.16em] text-primary">SHORTCUTS</p><h2 className="mt-1 text-lg font-extrabold">إجراءات الإدارة السريعة</h2></div>
          <span className="text-[11px] text-muted-foreground">وصول مباشر إلى مسارات العمل اليومية</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { to: '/director/financial/dashboard', title: 'اللوحة المالية', desc: 'الإيرادات وسعر الصرف والتدفقات', icon: Activity, tone: 'text-primary bg-primary/10' },
            { to: '/director/inventory-overview', title: 'مركز المخزون', desc: 'التغطية والاحتياج حسب الفرع', icon: Boxes, tone: 'text-accent bg-accent/10' },
            { to: '/director/orders-monitoring', title: 'مراقبة الطلبات', desc: 'تقدم التوزيع والتسليم', icon: ClipboardList, tone: 'text-emerald-300 bg-emerald-400/10' },
            { to: '/director/drivers', title: 'المندوبون', desc: 'فرق التوزيع والعمولات', icon: Users, tone: 'text-amber-300 bg-amber-400/10' },
          ].map((action) => (
            <Link key={action.to} to={action.to} className="director-panel group flex items-center gap-3 rounded-xl p-4 transition-all duration-300 hover:-translate-y-0.5 hover:bg-card">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${action.tone} transition-transform duration-300 group-hover:scale-105`}><action.icon className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1"><h3 className="truncate text-xs font-extrabold">{action.title}</h3><p className="mt-1 truncate text-[10px] text-muted-foreground">{action.desc}</p></div>
              <ArrowLeft className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 group-hover:-translate-x-1 group-hover:text-primary" />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}