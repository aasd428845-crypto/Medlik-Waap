import { ReactNode } from 'react';

interface KPICardProps {
  title: string;
  value: string | number;
  icon: ReactNode;
  colorClass?: string;
  trend?: string;
  detail?: string;
}

export function KPICard({ title, value, icon, colorClass = "bg-primary/10 text-primary", trend, detail }: KPICardProps) {
  return (
    <article className="director-panel director-reveal group relative overflow-hidden rounded-2xl p-5 transition-all duration-300 hover:-translate-y-0.5">
      <div className="absolute inset-x-0 top-0 h-px director-glow-line opacity-60" />
      <div className="flex items-start justify-between gap-4">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 ${colorClass} transition-transform duration-300 group-hover:scale-105`}>
          {icon}
        </div>
        {trend && (
          <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[10px] font-bold text-emerald-300">
            {trend}
          </span>
        )}
      </div>
      <div className="mt-5">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground">{title}</p>
        <h3 className="mt-1 text-2xl font-extrabold tracking-tight text-foreground md:text-[1.75rem]">{value}</h3>
        {detail && <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>}
      </div>
      <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/5">
        <div className="h-full w-2/3 rounded-full bg-gradient-to-l from-primary to-accent transition-all duration-500 group-hover:w-4/5" />
      </div>
    </article>
  );
}
