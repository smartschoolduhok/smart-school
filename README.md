# نظام المدرسة الذكي — Smart School

منصة عربية متعددة المدارس لإدارة الطلبة والتسجيلات والمواد والدرجات وكشوف النتائج والجداول والرسوم والإيصالات والخزنة والموظفين والرواتب.

## الحالة الحالية

- Phase 20A1 الخاصة بسلامة الأقساط والدفعات والإيصالات مكتملة ومندمجة وموثقة.
- دفعة التثبيت اللاحقة للتدقيق مندمجة؛ migrations `0029`–`0031` مطبقة على STAGING، مع عزل وصول ولي الأمر والمدرس وذرّية الدرجات والرواتب والخزنة وتبسيط الواجهة.
- Phase 20B مكتملة ومندمجة؛ أضافت حساب الطالب المالي، خطط التقسيط الاختيارية، إيصال A4 محسّنًا وعرض ولي الأمر للقراءة فقط. Migration `0032` مطبقة على STAGING، وسجلها يحتوي 33 migration فريدة بلا migrations معلّقة.
- اجتازت Phase 20B النسخ والاستعادة والـpreflight وQA الوظيفي على STAGING، لكن هذا لا يُعد تصريحًا لـProduction؛ يلزم قرار GO وإعداد ونشر مستقلان.

## البنية التقنية

| الطبقة | التقنية |
|---|---|
| الواجهة | React 19، React Router، Tailwind CSS، Vite |
| الـAPI | Hono على Cloudflare Pages/Workers |
| قاعدة البيانات | Cloudflare D1 (SQLite-compatible) |
| المصادقة | JWT مع PBKDF2-HMAC-SHA256 لكلمات المرور |
| اللغة | العربية واتجاه RTL |

تدفق البيانات: `React → Hono API → D1`.

## التشغيل المحلي

المتطلبات: Node.js 24 أو أحدث وnpm.

```bash
git clone https://github.com/smartschoolduhok/smart-school.git
cd smart-school
npm ci
```

أنشئ ملف `.dev.vars` غير متعقب:

```dotenv
JWT_SECRET=<random-value-at-least-32-characters>
APP_ENV=development
ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

ثم جهّز قاعدة محلية وشغّل التطبيق:

```bash
npm run db:migrate
npm run db:seed
npm run dev
```

`db:migrate` و`db:seed` يستخدمان `--local` صراحةً. أمر `db:reset` يحذف فقط حالة D1 المحلية داخل المشروع ثم يعيد الترحيلات والـseed. لا تستخدم `seed.sql` على STAGING أو Production.

## حسابات البيانات التجريبية

هذه الحسابات للـLocal QA فقط، وموجودة داخل `seed.sql`. لا تُنشأ ولا تُستخدم في Production.

| الدور | البريد | كلمة المرور |
|---|---|---|
| مدير النظام | `admin@smart-school.iq` | `admin123` |
| مدير مدرسة | `principal@nukhba.iq` | `school123` |
| مدرس | `teacher@nukhba.iq` | `teacher123` |
| مالك مدرسة | `owner@rafidain.iq` | `owner123` |
| محاسب | `accountant@rafidain.iq` | `accountant123` |

## فحوصات الجودة

```bash
npm run typecheck
npm run test:regressions
npm run test:finance-seed:local
npm run test:backup-restore:local
npm run build
npm audit --audit-level=low
```

نفس البوابات الأساسية تعمل آليًا في `.github/workflows/quality.yml` لكل Pull Request ولكل push إلى `main`.

## مسارات التحقق العامة

- `/verify/result-card/:token`
- `/verify/receipt/:token`
- `/verify/official-book/:token`

باقي بيانات المدرسة محمية بالمصادقة والدور والمدرسة، كما أن وصول المدرس وولي الأمر مقيد بالموارد المرتبطة بهما.

## أمان البيئات

ملف `wrangler.jsonc` المتعقب يعرّف بيئة **STAGING**. الأوامر المحلية لا تصل إلى D1 البعيدة ما لم يُضف `--remote` صراحةً. إعداد Production يجب أن يكون منفصلًا ومحميًا وغير مخلوط بإعداد STAGING.

راجع:

- `ENVIRONMENT.md` للمتغيرات وحدود البيئات.
- `DEPLOYMENT.md` للإصدار والترحيل الآمن.
- `TESTING_CHECKLIST.md` لاختبار القبول اليدوي الحالي.
- `PROJECT_HANDOFF.md` لخريطة النظام وتسليم التطوير.
- `docs/POST_AUDIT_STABILIZATION_REPORT.md` لنتيجة دفعات ما بعد التدقيق.
- `docs/PHASE_20B_FINANCE_ACCOUNTS_INSTALLMENTS_RECEIPTS_QA.md` لعقود Phase 20B وبوابات قبولها.
