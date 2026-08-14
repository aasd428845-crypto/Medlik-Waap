import { Link } from 'react-router-dom';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  BookOpen,
  Building2,
  FileBarChart,
  Landmark,
  ReceiptText,
  Scale,
  WalletCards,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const modules = [
  { title: 'دليل الحسابات', description: 'الحسابات الرئيسية والفرعية ومراكز التكلفة', icon: BookOpen, to: '/director/financial/chart-of-accounts' },
  { title: 'القيود اليومية', description: 'إنشاء ومراجعة وترحيل القيود المحاسبية', icon: ReceiptText, to: '/director/financial/journal' },
  { title: 'الصناديق والبنوك', description: 'الأرصدة والحركات والتحويلات المالية', icon: Landmark, to: '/director/financial/cash-banks' },
  { title: 'الذمم والتحصيل', description: 'كشف حساب العملاء وأعمار الذمم والتحصيل', icon: WalletCards, to: '/director/receivables' },
  { title: 'الموردون والمدفوعات', description: 'الذمم الدائنة وفواتير الموردين والمدفوعات', icon: ArrowDownToLine, to: '/director/financial/payables' },
  { title: 'التقارير المالية', description: 'ميزان المراجعة والأستاذ والقوائم المالية', icon: FileBarChart, to: '/director/financial/reports' },
];

export function FinancialDashboardPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="outline">النظام المالي</Badge>
            <Badge variant="secondary">YER</Badge>
          </div>
          <h2 className="text-2xl font-bold tracking-tight">الإدارة المالية</h2>
          <p className="text-sm text-muted-foreground mt-1">
            مركز موحد للمحاسبة والنقد والذمم والتقارير المالية.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to="/director/financial/journal"><ReceiptText /> قيد يومية</Link>
          </Button>
          <Button asChild>
            <Link to="/director/financial/cash-banks"><Banknote /> حركة مالية</Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="rounded-full bg-primary/10 text-primary p-3"><Scale className="h-5 w-5" /></div>
            <div><p className="text-xs text-muted-foreground">حالة دفتر الأستاذ</p><p className="font-bold mt-1">متصل بالنواة المالية</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="rounded-full bg-emerald-100 text-emerald-700 p-3"><ArrowUpFromLine className="h-5 w-5" /></div>
            <div><p className="text-xs text-muted-foreground">الذمم المدينة</p><p className="font-bold mt-1">منظومة التحصيل</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="rounded-full bg-amber-100 text-amber-700 p-3"><ArrowDownToLine className="h-5 w-5" /></div>
            <div><p className="text-xs text-muted-foreground">الذمم الدائنة</p><p className="font-bold mt-1">منظومة الموردين</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="rounded-full bg-blue-100 text-blue-700 p-3"><Building2 className="h-5 w-5" /></div>
            <div><p className="text-xs text-muted-foreground">التحليل</p><p className="font-bold mt-1">حسب الفرع ومركز التكلفة</p></div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>وحدات النظام المالي</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {modules.map(({ title, description, icon: Icon, to }) => (
              <Link
                key={to}
                to={to}
                className="group rounded-xl border bg-background p-4 transition-colors hover:bg-primary/5 hover:border-primary/30"
              >
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-primary/10 text-primary p-2.5"><Icon className="h-5 w-5" /></div>
                  <div className="min-w-0">
                    <h3 className="font-semibold group-hover:text-primary transition-colors">{title}</h3>
                    <p className="text-xs text-muted-foreground mt-1 leading-5">{description}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>ضوابط مالية أساسية</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-lg bg-muted/40 p-4"><p className="font-medium">القيد المزدوج</p><p className="text-xs text-muted-foreground mt-1">لا يُرحّل القيد إلا عند تساوي المدين والدائن.</p></div>
          <div className="rounded-lg bg-muted/40 p-4"><p className="font-medium">الفترات المحاسبية</p><p className="text-xs text-muted-foreground mt-1">الفترة المغلقة تمنع الترحيل غير المصرح به.</p></div>
          <div className="rounded-lg bg-muted/40 p-4"><p className="font-medium">سجل التدقيق</p><p className="text-xs text-muted-foreground mt-1">العمليات المالية الحساسة قابلة للتتبع والمراجعة.</p></div>
        </CardContent>
      </Card>
    </div>
  );
}
