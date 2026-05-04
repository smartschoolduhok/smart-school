# نظام المدرسة الذكي - المرحلة الأولى

## نظرة عامة
نظام إدارة مدارس احترافي متكامل باللغة العربية وبتخطيط RTL. هذه المرحلة الأولى تبني الأساس المعماري للنظام متعدد المدارس (SaaS).

## ما تم بناؤه في المرحلة الأولى

### الصفحات المكتملة
1. **صفحة تسجيل الدخول** - تصميم احترافي عربي مع حقول البريد الإلكتروني وكلمة المرور
2. **لوحة التحكم** - بطاقات إحصائية مع أرقام هندية عربية (٠١٢٣٤٥٦٧٨٩)
3. **الشريط الجانبي** - RTL على اليمين مع قائمة الموديلات النشطة والمستقبلية
4. **صفحة المدارس** - جدول عرض بيانات تجريبية
5. **صفحة المستخدمين** - جدول عرض بيانات تجريبية
6. **صفحة الأدوار والصلاحيات** - بطاقات عرض الأدوار مع الشارات

### المكونات المعمارية
- **التصميم**: React + TypeScript + Tailwind CSS + Vite
- **التوجيه**: React Router DOM
- **التوثيق**: نظام توثيق وهمي جاهز لدمج Supabase Auth لاحقاً
- **البيانات**: بيانات تجريبية شاملة لجميع الجداول
- **المساعد**: دالة `toArabicDigits` لتحويل الأرقام إلى الأرقام الهندية العربية

### هيكل المشروع
```
src/
├── modules/
│   ├── auth/          - صفحة تسجيل الدخول
│   ├── dashboard/     - لوحة التحكم
│   ├── schools/       - صفحة المدارس
│   ├── users/         - صفحة المستخدمين
│   ├── roles/          - صفحة الأدوار والصلاحيات
│   └── settings/       - إعدادات النظام (قيد التطوير)
├── components/
│   ├── Sidebar.tsx     - الشريط الجانبي RTL
│   ├── Header.tsx      - رأس الصفحة
│   └── Layout.tsx      - تخطيط الصفحة المحمي
├── hooks/
│   └── useAuth.tsx     - سياق التوثيق
├── lib/
│   └── arabicDigits.ts - محول الأرقام العربية
├── data/
│   └── demoData.ts     - البيانات التجريبية
├── types/
│   └── index.ts        - أنواع TypeScript
├── App.tsx              - نقطة دخول التطبيق
└── main.tsx             - تهيئة React
```

## قاعدة البيانات (مخطط جاهز)

### الجداول المطلوبة
```sql
-- المدارس
CREATE TABLE schools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  logo_url TEXT,
  school_type TEXT,
  city TEXT,
  status TEXT DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- المستخدمون
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER REFERENCES schools(id),
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role_id INTEGER REFERENCES roles(id),
  status TEXT DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- الأدوار
CREATE TABLE roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  key TEXT UNIQUE NOT NULL
);

-- الصلاحيات
CREATE TABLE permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT
);

-- صلاحيات الأدوار
CREATE TABLE role_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id INTEGER REFERENCES roles(id),
  permission_id INTEGER REFERENCES permissions(id)
);

-- السنوات الدراسية
CREATE TABLE academic_years (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER REFERENCES schools(id),
  name TEXT NOT NULL,
  starts_at DATE,
  ends_at DATE,
  is_active BOOLEAN DEFAULT 0
);

-- الموديلات
CREATE TABLE modules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'active'
);

-- موديلات المدرسة
CREATE TABLE school_modules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER REFERENCES schools(id),
  module_id INTEGER REFERENCES modules(id),
  is_enabled BOOLEAN DEFAULT 0
);
```

## تشغيل المشروع محلياً

```bash
# 1. تثبيت التبعيات
npm install

# 2. البناء
npm run build

# 3. المعاينة
npm run preview
# أو
npx wrangler pages dev dist --ip 0.0.0.0 --port 3000
```

## بيانات تجريبية للدخول
| البريد الإلكتروني | كلمة المرور | الدور |
|---|---|---|
| admin@smart-school.iq | admin123 | مدير النظام |
| principal@nukhba.iq | school123 | مدير المدرسة |

## ميزات التصميم
- واجهة عربية ١٠٠٪ بدون أي نصوص إنجليزية
- دعم كامل RTL
- أرقام هندية عربية في جميع البطاقات والجداول
- تصميم احترافي مناسب للمدارس العراقية
- لوحة جانبية على اليمين
- متجاوبة مع سطح المكتب والأجهزة اللوحية

## ما يجب اختباره قبل المرحلة الثانية
- [ ] تسجيل الدخول يعمل بسلاسة
- [ ] الحماية للصفحات الداخلية تعمل
- [ ] تسجيل الخروج يعمل
- [ ] الأرقام العربية تظهر بشكل صحيح
- [ ] التنقل بين الصفحات يعمل
- [ ] الموديلات المعطلة تظهر بوضوح كـ "غير مفعّل"

## المرحلة الثانية (المستقبلية)
- ربط قاعدة بيانات حقيقية (Supabase/PostgreSQL)
- نظام توثيق حقيقي (Supabase Auth)
- CRUD كامل للمدارس والمستخدمين والأدوار
- إدارة السنوات الدراسية
- موديل الطلاب
- موديل الصفوف والشعب
