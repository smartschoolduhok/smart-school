# بيئات Smart School ومتغيراتها

## قاعدة الأمان

`wrangler.jsonc` الموجود في المستودع مرتبط بـ **STAGING**:

| الحقل | القيمة المتعقبة |
|---|---|
| Pages project | `smart-school-staging` |
| D1 binding | `DB` |
| D1 database | `smart-school-staging-db` |

وجود هذا الربط لا يعني أن أوامر التطوير تصل إلى STAGING. أوامر `db:migrate` و`db:seed` تستخدم `--local` صراحةً. لا يصل Wrangler إلى القاعدة البعيدة إلا بأمر صريح يحتوي `--remote`.

Production يحتاج إعدادًا منفصلًا ومحميًا؛ لا تستبدل بيانات STAGING داخل الملف المتعقب ولا تضع أسرارًا فيه.

## المتغيرات المطلوبة

### `JWT_SECRET`

- مفتاح عالي العشوائية بطول 32 حرفًا على الأقل.
- لا توجد قيمة افتراضية؛ المصادقة تفشل بشكل مغلق إن كان مفقودًا أو ضعيفًا.
- جلسة JWT صالحة لثماني ساعات وتحتوي `jti` قابلًا للإلغاء.
- محليًا: يوضع في `.dev.vars` غير المتعقب.
- في Cloudflare: يوضع كـSecret في البيئة المقصودة، وليس في الكود أو Git.

### `APP_ENV`

- محليًا: `development` أو `local`.
- STAGING: `staging`.
- Production: `production`.

### `ALLOWED_ORIGINS`

- قائمة origins كاملة مفصولة بفواصل، بلا مسارات.
- مطلوبة عندما تكون الواجهة والـAPI على origins مختلفة.
- الطلبات same-origin لا تحتاجها.
- لا تستخدم `*` مع بيانات اعتماد أو في بيئة حقيقية.

مثال محلي في `.dev.vars`:

```dotenv
JWT_SECRET=<generate-a-random-value-of-at-least-32-characters>
APP_ENV=development
ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000
```

## ملفات محلية لا تُرفع إلى Git

- `.dev.vars`
- `.wrangler/`
- `node_modules/`
- `dist/`
- نسخ D1 وملفات SQL المصدّرة والسجلات التي قد تحتوي بيانات تشغيلية

## حدود الأوامر

| الأمر | البيئة | مسموح تلقائيًا؟ |
|---|---|---|
| `npm run db:migrate` | Local D1 | نعم |
| `npm run db:seed` | Local D1 | نعم، بيانات تجريبية |
| `npm run db:reset` | Local D1 داخل المشروع | نعم، مع الانتباه أنه يحذف الحالة المحلية |
| `npm run test:backup-restore:local` | قاعدتان محليتان مؤقتتان | نعم |
| Wrangler مع `--remote` | STAGING/Production حسب config | لا؛ يحتاج خطة وترخيصًا صريحًا |
| تشغيل `seed.sql` مع `--remote` | أي قاعدة بعيدة | ممنوع |

## قائمة ما قبل أي إصدار بعيد

- [ ] تحديد البيئة بالاسم وعدم الاعتماد على الافتراض.
- [ ] نسخة احتياطية قابلة للاستعادة ومؤرخة قبل الترحيل.
- [ ] مراجعة قائمة الترحيلات غير المطبقة ونتيجة preflight للبيانات.
- [ ] ضبط `JWT_SECRET` و`APP_ENV` و`ALLOWED_ORIGINS` في البيئة الصحيحة.
- [ ] تطبيق الترحيلات على STAGING أولًا ومراجعة readiness وforeign keys.
- [ ] تنفيذ QA يدوي بحسابات الأدوار الحقيقية.
- [ ] قرار مستقل ومكتوب قبل Production.
- [ ] عدم تشغيل seed/reset على STAGING أو Production.

## قاعدة البيانات والترحيلات

يحتوي المستودع 46 ملف migration حتى `0045_admissions_transfers.sql`، بما فيها ملفا `0014` التاريخيان. اجتازت STAGING بوابة PR #53 في 2026-09-26: `46/46` و`95/93` جدولًا، بلا pending وFK نظيف. التفاصيل في [تقرير البوابة](docs/ROADMAP_21E_22B_STAGING_QA.md). هذه حالة مؤرخة؛ افحص سجل D1 والقائمة المعلقة قبل أي تنفيذ جديد، ولا تعِد تطبيق migrations السابقة.
