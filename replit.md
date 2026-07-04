# نظام إدارة الأدوية — Pharma Manager PWA

تطبيق ويب تقدمي (PWA) لإدارة عمليات شركة الأدوية، يخدم **المدير العام** و**مدير الفرع**.

## تشغيل المشروع

- `pnpm --filter @workspace/pharma-pwa run dev` — تشغيل واجهة الويب (يُدار تلقائياً بالـworkflow)
- `pnpm --filter @workspace/pharma-pwa run typecheck` — فحص TypeScript

## التقنيات المستخدمة

- **Frontend**: React 19 + TypeScript + Vite
- **Styling**: Tailwind CSS + مكتبة shadcn/ui، خط Cairo (Google Fonts)، RTL عربي كامل
- **Backend**: Firebase (Firestore + Auth) — متصل بنفس مشروع Firebase الخاص بتطبيق Android
- **PWA**: vite-plugin-pwa — Service Worker + Web Manifest
- **Routing**: react-router-dom v7

## متغيرات البيئة المطلوبة (Secrets)

يجب ضبط هذه الأسرار في إعدادات Replit Secrets:
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

## بنية الملفات

```
artifacts/pharma-pwa/src/
├── lib/firebase.ts          — إعداد Firebase (يقرأ من VITE_FIREBASE_* env vars)
├── types/models.ts          — نماذج البيانات TypeScript
├── contexts/AuthContext.tsx — سياق المصادقة + حماية الأدوار
├── pages/
│   ├── LoginPage.tsx
│   ├── director/
│   │   ├── DashboardPage.tsx        — KPIs + تنبيهات المخزون الحرج
│   │   ├── CatalogPage.tsx          — إدارة كتالوج المنتجات
│   │   ├── InventoryOverviewPage.tsx — جدول محوري products × branches
│   │   └── OrdersMonitoringPage.tsx  — مراقبة الطلبات + إعادة التوجيه
│   └── branch/
│       ├── AllocationPage.tsx       — عمليات التخصيص + التحويل الذكي
│       ├── InvoicesPage.tsx         — سجل الفواتير
│       ├── OffersPage.tsx           — عروض الأسعار
│       ├── WarehouseInventoryPage.tsx — مخزون المستودع
│       └── AddressesPage.tsx        — إدارة العناوين
└── layouts/
    ├── DirectorLayout.tsx   — sidebar ثابت + header
    └── BranchManagerLayout.tsx — تبويبات علوية
```

## مجموعات Firestore المستخدمة

```
users, orders, invoices, products, warehouse_inventory,
branches, branch_offers, addresses, director_notifications
```

## أدوار المستخدمين

- `company_director` → واجهة المدير العام (`/director/*`)
- `branch_manager` → واجهة مدير الفرع (`/branch/*`)
- أي دور آخر → رفض الدخول مع رسالة واضحة

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- لا تستخدم `@workspace/api-client-react` في pharma-pwa — Firebase مباشرة فقط
- بعد تغيير الـsecrets أعد تشغيل workflow pharma-pwa لإعادة قراءتها
- VITE_ vars يجب أن تكون في Secrets (ليس env vars عادية) لأنها تُضمَّن وقت البناء
