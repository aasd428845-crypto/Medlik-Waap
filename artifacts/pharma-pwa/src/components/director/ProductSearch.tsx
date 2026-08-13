import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { OfferProduct } from '@/lib/promotionalOffersApi';

interface Props {
  products: OfferProduct[];
  value: string; // product id or '' for "all products"
  onChange: (productId: string) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
}

export function ProductSearch({ products, value, onChange, allowEmpty = false, emptyLabel = '' }: Props) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);

  const selected = products.find((p) => p.id === value) ?? null;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = products.filter(
      (p) =>
        !q ||
        (p.name ?? '').toLowerCase().includes(q) ||
        (p.name_en ?? '').toLowerCase().includes(q),
    );
    return list.slice(0, 8);
  }, [products, query]);

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-2 border rounded-lg px-3 py-2 bg-primary/5 border-primary/30">
        <div className="text-sm">
          <span className="font-semibold text-foreground">{selected.name}</span>
          {selected.name_en ? <span className="text-muted-foreground"> ({selected.name_en})</span> : null}
          {selected.unit ? <span className="text-muted-foreground text-xs"> — {selected.unit}</span> : null}
        </div>
        <button
          type="button"
          onClick={() => onChange('')}
          className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          title="تغيير الصنف"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="w-4 h-4 absolute right-3 top-2.5 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 150)}
          placeholder="ابحث عن صنف بالاسم..."
          className="w-full border rounded-lg px-3 pr-10 py-2 text-sm bg-background focus:ring-2 focus:ring-primary focus:border-transparent"
        />
      </div>
      {focused && (
        <div className="absolute z-20 mt-1 w-full bg-card border rounded-lg shadow-lg max-h-64 overflow-y-auto">
          {allowEmpty && (
            <button
              type="button"
              onMouseDown={() => { onChange(''); setQuery(''); }}
              className="w-full text-right px-3 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
            >
              {emptyLabel || 'جميع الأصناف'}
            </button>
          )}
          {matches.map((p) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={() => { onChange(p.id); setQuery(''); }}
              className="w-full text-right px-3 py-2 text-sm hover:bg-muted transition-colors flex justify-between items-center gap-2"
            >
              <span>
                <span className="font-medium text-foreground">{p.name}</span>
                {p.name_en ? <span className="text-muted-foreground"> ({p.name_en})</span> : null}
              </span>
              {p.unit ? <span className="text-xs text-muted-foreground">{p.unit}</span> : null}
            </button>
          ))}
          {matches.length === 0 && (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">لا توجد أصناف مطابقة</div>
          )}
        </div>
      )}
    </div>
  );
}
