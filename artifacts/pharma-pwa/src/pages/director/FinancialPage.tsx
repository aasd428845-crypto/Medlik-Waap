import { Link } from 'react-router-dom';
import { ArrowLeft, Banknote, BookOpen, Landmark, Wallet } from 'lucide-react';

const modules = [
  ['دليل الحسابات', 'chart-of-accounts', BookOpen],
  ['القيود ودفتر الأستاذ', 'journal', BookOpen],
  ['الصناديق والبنوك', 'cash-bank', Landmark],
  ['الذمم والتحصيل', '/director/receivables', Wallet],
  ['المصروفات والأصول', 'expenses-assets', Banknote],
];

export function FinancialPage() {
  return (
    <div className="mx-auto max-w-[1600px] space-y-6">
      <section className="director-panel director-reveal relative overflow-hidden rounded-2xl p-5 md:p-7">
        <div className="absolute -left-24 -top-32 h-72 w-72 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative">
          <p className="text-[10px] font-bold tracking-[0.16em] text-primary">مركز الإدارة المالية</p>
          <h1 className="mt-3 text-2xl font-extrabold tracking-tight md:text-3xl">الإدارة المالية والمحاسبة</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">النواة المالية الموحدة للشركة: المحاسبة، السيولة، الذمم، البنوك، المخزون والتقارير التنفيذية.</p>
        </div>
      </section>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map(([label, path, Icon]) => {
          const I = Icon as typeof BookOpen;
          const to = String(path).startsWith('/') ? String(path) : `/director/financial/${path}`;
          return <Link key={to} to={to} className="director-panel group rounded-2xl p-5 transition-transform hover:-translate-y-0.5">
            <div className="flex items-center justify-between"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><I className="h-5 w-5" /></span><ArrowLeft className="h-4 w-4 text-muted-foreground transition-transform group-hover:-translate-x-1" /></div>
            <h2 className="mt-5 text-sm font-extrabold">{label}</h2><p className="mt-1 text-[11px] text-muted-foreground">فتح وحدة الإدارة المالية</p>
          </Link>;
        })}
      </section>
      <section className="director-panel rounded-2xl p-5"><h2 className="text-base font-extrabold">حالة النواة المالية</h2><p className="mt-2 text-sm leading-7 text-muted-foreground">تم تجهيز طبقة المحاسبة والرقابة وقواعد البيانات الأساسية. ستظهر الأرقام من القيود المرحّلة الفعلية فقط، دون بيانات تجريبية.</p></section>
    </div>
  );
}
