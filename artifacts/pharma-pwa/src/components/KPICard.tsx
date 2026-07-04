import { ReactNode } from 'react';

interface KPICardProps {
  title: string;
  value: string | number;
  icon: ReactNode;
  colorClass?: string;
}

export function KPICard({ title, value, icon, colorClass = "bg-primary/10 text-primary" }: KPICardProps) {
  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <div className="flex items-center gap-4">
        <div className={`p-4 rounded-full ${colorClass}`}>
          {icon}
        </div>
        <div>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <h3 className="text-2xl font-bold mt-1">{value}</h3>
        </div>
      </div>
    </div>
  );
}
