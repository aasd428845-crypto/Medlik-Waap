import './_group.css';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowUpLeft,
  BarChart3,
  Boxes,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  Database,
  FileText,
  LayoutDashboard,
  Menu,
  PackageSearch,
  ShoppingCart,
  Store,
  Truck,
  Wallet,
} from 'lucide-react';

const kpis = [
  { title: 'إجمالي المبيعات', value: '$2,485,900', detail: 'الفواتير المسجلة والمسلّمة', status: 'إيرادات محققة', icon: CircleDollarSign, tone: 'text-cyan-300 bg-cyan-400/10' },
  { title: 'الذمم المدينة', value: '$348,620', detail: 'فواتير غير مسددة', status: 'يتطلب متابعة', icon: Wallet, tone: 'text-amber-300 bg-amber-400/10' },
  { title: 'الطلبات النشطة', value: '1,286', detail: 'من التسليم إلى التوزيع', status: 'قيد التنفيذ', icon: ShoppingCart, tone: 'text-sky-300 bg-sky-400/10' },
  { title: 'الفروع النشطة', value: '48', detail: 'فروع مسجلة في النظام', status: 'شبكة التشغيل', icon: Building2, tone: 'text-emerald-300 bg-emerald-400/10' },
];

const stock = [
  ['أموكسيسيلين 500mg', 'كبسولات', 'صنعاء - 04', '7'],
  ['إنسولين سريع المفعول', 'حقن', 'عدن - 02', '4'],
  ['باراسيتامول أطفال', 'شراب', 'تعز - 03', '9'],
];

const nav = [
  ['لوحة القيادة', LayoutDashboard, true],
  ['مدراء الفروع', Building2, false],
  ['المندوبون', Truck, false],
  ['تحليلات الأصناف', BarChart3, false],
  ['نظرة المخزون', Boxes, false],
  ['الذمم المدينة', Wallet, false],
];

export function DashboardPreview() {
  return (
    <div className="preview-grid min-h-screen p-3 text-right sm:p-5" dir="rtl">
      <div className="mx-auto flex min-h-[860px] max-w-[1240px] overflow-hidden rounded-[26px] border border-slate-700/70 bg-[#091321]/80 shadow-2xl shadow-black/30">
        <aside className="hidden w-64 shrink-0 border-l border-slate-700/60 bg-[#07101c]/85 p-4 lg:block">
          <div className="mb-7 flex items-center gap-3 border-b border-slate-700/60 pb-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/40 bg-cyan-400/10 text-cyan-300"><PackageSearch className="h-5 w-5" /></div>
            <div><p className="text-[9px] font-bold tracking-[.16em] text-cyan-300">NOVA DISTRIBUTION</p><p className="mt-1 font-extrabold">مركز القيادة</p></div>
          </div>
          <p className="mb-2 px-2 text-[9px] font-bold tracking-[.15em] text-slate-500">المركز</p>
          <div className="space-y-1">
            {nav.map(([label, Icon, active]) => {
              const NavIcon = Icon as typeof LayoutDashboard;
              return <div className={`flex items-center gap-3 rounded-xl px-3 py-3 text-xs font-bold ${active ? 'bg-cyan-400/10 text-cyan-300' : 'text-slate-400'}`} key={label as string}><NavIcon className="h-4 w-4" />{label as string}</div>;
            })}
          </div>
          <div className="mt-10 rounded-2xl border border-cyan-400/15 bg-cyan-400/[.04] p-4"><p className="text-[10px] text-slate-400">حالة المنظومة</p><div className="mt-3 flex items-center gap-2 text-xs font-bold text-emerald-300"><span className="h-2 w-2 rounded-full bg-emerald-400" /> جميع الأنظمة متصلة</div></div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="flex items-center justify-between border-b border-slate-700/60 bg-[#0a1524]/75 px-4 py-4 backdrop-blur sm:px-7">
            <div className="flex items-center gap-3"><button className="rounded-xl border border-slate-700 p-2 text-slate-300 lg:hidden"><Menu className="h-4 w-4" /></button><div><p className="text-[10px] text-slate-500">مركز القيادة /</p><h1 className="mt-1 text-lg font-extrabold">لوحة القيادة</h1></div></div>
            <div className="flex items-center gap-3"><div className="hidden items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/40 px-3 py-2 text-[10px] text-slate-400 sm:flex"><Database className="h-3.5 w-3.5" /> آخر مزامنة: الآن</div><div className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700 text-slate-400"><Activity className="h-4 w-4" /><span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-amber-400" /></div></div>
          </header>

          <div className="space-y-5 p-4 sm:p-7">
            <section className="preview-panel relative overflow-hidden rounded-2xl p-5 sm:p-7">
              <div className="absolute -left-20 -top-24 h-64 w-64 rounded-full bg-cyan-400/10 blur-3xl" />
              <div className="relative flex flex-col justify-between gap-6 md:flex-row md:items-end"><div><div className="mb-3 flex items-center gap-2 text-[10px] font-bold tracking-[.14em] text-cyan-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> النظام التشغيلي متصل</div><h2 className="max-w-xl text-2xl font-extrabold leading-tight sm:text-3xl">صورة تنفيذية واضحة لأداء شبكة التوزيع</h2><p className="mt-3 max-w-xl text-xs leading-6 text-slate-400 sm:text-sm">راقب التدفق المالي، سرعة تنفيذ الطلبات، ومخاطر المخزون من مركز واحد مصمم للقرارات السريعة.</p></div><div className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-950/20 px-4 py-3"><CheckCircle2 className="h-5 w-5 text-emerald-300" /><div><p className="text-[10px] text-slate-500">حالة البيانات</p><p className="text-xs font-bold text-emerald-300">متزامنة مع النظام</p></div></div></div>
            </section>

            <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {kpis.map(({ title, value, detail, status, icon: Icon, tone }) => <article className="preview-panel preview-card rounded-2xl p-4 sm:p-5" key={title}><div className="flex items-start justify-between gap-2"><div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}><Icon className="h-5 w-5" /></div><span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[9px] font-bold text-emerald-300">{status}</span></div><p className="mt-4 text-[10px] font-bold text-slate-400">{title}</p><p className="mt-1 text-xl font-extrabold tracking-tight sm:text-2xl">{value}</p><p className="mt-1 text-[9px] text-slate-500">{detail}</p><div className="mt-4 h-1 rounded-full bg-white/5"><div className="h-full w-2/3 rounded-full bg-gradient-to-l from-cyan-300 to-sky-500" /></div></article>)}
            </section>

            <section className="grid gap-5 xl:grid-cols-[1.25fr_.75fr]">
              <div className="preview-panel rounded-2xl p-4 sm:p-6"><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-400/10 text-rose-300"><AlertTriangle className="h-4 w-4" /></div><div><h2 className="text-sm font-extrabold sm:text-base">المخزون الحرج</h2><p className="mt-1 text-[9px] text-slate-500 sm:text-[10px]">أصناف تحتاج قرار توريد قبل التأثير على الخدمة</p></div></div><span className="text-[10px] font-bold text-cyan-300">فتح النظرة الشاملة <ArrowLeft className="inline h-3 w-3" /></span></div><div className="mt-5 overflow-x-auto rounded-xl border border-rose-300/15"><table className="w-full min-w-[430px] text-[10px]"><thead className="bg-rose-300/[.04] text-slate-400"><tr><th className="px-3 py-3">الصنف الدوائي</th><th className="px-3 py-3">الشكل</th><th className="px-3 py-3">الفرع</th><th className="px-3 py-3">المتاح</th></tr></thead><tbody>{stock.map(([name, form, branch, qty], i) => <tr className="border-t border-slate-700/60" key={name}><td className="px-3 py-3 font-bold"><span className="ml-2 text-slate-600">0{i + 1}</span>{name}</td><td className="px-3 py-3 text-slate-400">{form}</td><td className="px-3 py-3 text-slate-400">{branch}</td><td className="px-3 py-3 font-extrabold text-rose-300">{qty}</td></tr>)}</tbody></table></div></div>
              <div className="preview-panel rounded-2xl p-4 sm:p-6"><div className="flex items-center justify-between"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-400/10 text-sky-300"><ArrowUpLeft className="h-4 w-4" /></div><div><h2 className="text-sm font-extrabold sm:text-base">مؤشر التنفيذ</h2><p className="mt-1 text-[9px] text-slate-500 sm:text-[10px]">نقاط المتابعة ذات الأولوية</p></div></div><span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-1 text-[9px] font-bold text-cyan-300">مباشر</span></div><div className="mt-7 space-y-6"><div><div className="mb-2 flex justify-between text-[10px]"><span className="text-slate-400">تغطية شبكة الفروع</span><b className="text-cyan-300">نشط</b></div><div className="h-1.5 rounded-full bg-white/5"><div className="h-full w-[82%] rounded-full bg-cyan-300" /></div></div><div><div className="mb-2 flex justify-between text-[10px]"><span className="text-slate-400">انسيابية الطلبات</span><b className="text-sky-300">قيد المعالجة</b></div><div className="h-1.5 rounded-full bg-white/5"><div className="h-full w-[68%] rounded-full bg-sky-400" /></div></div><div className="flex items-center justify-between border-t border-slate-700/60 pt-4 text-[10px]"><span className="flex items-center gap-2 text-slate-400"><Database className="h-4 w-4 text-cyan-300" /> آخر مزامنة تشغيلية</span><b>متصلة</b></div></div></div>
            </section>

            <section><div className="mb-3 flex items-end justify-between"><div><p className="text-[9px] font-bold tracking-[.14em] text-cyan-300">SHORTCUTS</p><h2 className="mt-1 text-base font-extrabold">إجراءات الإدارة السريعة</h2></div><span className="text-[9px] text-slate-500">مسارات العمل اليومية</span></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[['كتالوج المنتجات', PackageSearch, 'إدارة الأصناف والتسعير'], ['مركز المخزون', Boxes, 'التغطية والاحتياج حسب الفرع'], ['مراقبة الطلبات', ClipboardList, 'تقدم التوزيع والتسليم'], ['الذمم المدينة', FileText, 'متابعة التحصيل والفواتير']].map(([label, Icon, desc]) => { const ActionIcon = Icon as typeof PackageSearch; return <div className="preview-panel flex items-center gap-3 rounded-xl p-3.5" key={label as string}><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-300"><ActionIcon className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-[10px] font-extrabold">{label as string}</p><p className="mt-1 truncate text-[9px] text-slate-500">{desc as string}</p></div><ArrowLeft className="h-3.5 w-3.5 text-slate-500" /></div>; })}</div></section>
          </div>
          <div className="sticky bottom-0 flex h-16 items-center justify-around border-t border-slate-700/60 bg-[#07101c]/95 px-2 backdrop-blur lg:hidden">{[['لوحة القيادة', LayoutDashboard], ['المخزون', Boxes], ['الطلبات', ClipboardList], ['المالية', Wallet]].map(([label, Icon], i) => { const BottomIcon = Icon as typeof LayoutDashboard; return <div className={`flex flex-col items-center gap-1 text-[9px] font-bold ${i === 0 ? 'text-cyan-300' : 'text-slate-500'}`} key={label as string}><BottomIcon className="h-4 w-4" />{label as string}</div>; })}</div>
        </main>
      </div>
    </div>
  );
}