# نشر وترحيل Smart School

هذا المستند يصف مسارًا آمنًا من Local إلى STAGING ثم Production. لا يعتبر نجاح البناء إذنًا لتطبيق migrations أو نشر Production.

## المتطلبات

- Node.js 24 أو أحدث وnpm.
- حساب Cloudflare وصلاحيات محددة للبيئة المقصودة.
- Wrangler مصادق عليه للحساب الصحيح.
- نسخة احتياطية وخطة rollback قبل أي تغيير بعيد.

## 1. بوابات Local وCI

من checkout نظيف:

```bash
npm ci
npm audit --audit-level=low
npm run typecheck
npm run test:regressions
npm run test:finance-seed:local
npm run test:backup-restore:local
npm run build
```

لا تتجاوز بوابة فاشلة. GitHub Actions يعيد هذه الفحوصات لكل PR ولكل push إلى `main`.

## 2. تشغيل محلي

```bash
npm run db:migrate
npm run db:seed
npm run dev
```

كل أوامر قاعدة البيانات أعلاه Local فقط. لإعادة إنشائها من الصفر:

```bash
npm run db:reset
```

يحذف `db:reset` فقط `.wrangler/state/v3/d1` داخل checkout الحالي، ثم يطبق migrations ويشغّل بيانات العرض. لا تشغّل `seed.sql` على قاعدة بعيدة.

## 3. بناء حزمة الإصدار

```bash
npm run build
```

ينتج الأمر:

1. واجهة React داخل `dist/`.
2. Worker API داخل `dist/_worker.js`.

للمعاينة الكاملة محليًا بعد البناء:

```bash
npm run preview
```

## 4. وضع STAGING الحالي

ملف `wrangler.jsonc` المتعقب خاص بـSTAGING (`smart-school-staging` و`smart-school-staging-db`). لا تستخدمه كإعداد Production.

قبل أي migration بعيد، نفّذ الإجراءات التالية ضمن نافذة تغيير مصرح بها:

1. تحقق من الحساب والمشروع وقاعدة D1 المستهدفة.
2. راجع `git diff` وSHA المرشح للإصدار.
3. صدّر نسخة احتياطية مؤرخة وخزّنها في مكان محمي.
4. نفّذ preflight للبيانات ومقارنة schema/migration history.
5. اعرض قائمة migrations المنتظرة قبل التطبيق.
6. طبّقها على STAGING فقط.
7. تحقق من migration history وforeign keys وreadiness views وسلامة البيانات.
8. نفّذ QA يدويًا حسب `TESTING_CHECKLIST.md`.

أمثلة الأوامر البعيدة التالية **ليست أوامر تلقائية**؛ شغّلها فقط بعد اعتماد الهدف والنسخة الاحتياطية:

```bash
npx wrangler d1 migrations list DB --remote --config wrangler.jsonc
npx wrangler d1 export DB --remote --output <dated-staging-backup.sql> --config wrangler.jsonc
npx wrangler d1 migrations apply DB --remote --config wrangler.jsonc
```

لنشر الحزمة على مشروع STAGING المتعقب بعد نجاح migration وQA:

```bash
npm run deploy
```

## 5. Production

Production يحتاج قرار GO مستقلًا وإعداد Wrangler منفصلًا ومراجعًا يشير صراحةً إلى مشروع وقاعدة Production. لا تنسخ `database_id` فوق إعداد STAGING ولا تعتمد على اسم ضمني.

الحد الأدنى قبل Production:

- [ ] PR مدمج وSHA الإصدار ثابت.
- [ ] جميع checks على SHA نفسه خضراء.
- [ ] STAGING على migrations نفسها ونتيجة QA موثقة.
- [ ] نسخة Production الاحتياطية تم التحقق منها ويمكن استعادتها.
- [ ] الأسرار والمتغيرات مضبوطة في Production نفسها.
- [ ] خطة مراقبة وrollback ومسؤول قرار واضحون.
- [ ] لا seed ولا reset ولا بيانات اعتماد تجريبية.

يجب أن تحتوي أوامر Production على config المعتمد صراحةً، مثل:

```bash
npx wrangler d1 migrations list DB --remote --config <approved-production-config>
npx wrangler d1 migrations apply DB --remote --config <approved-production-config>
npx wrangler pages deploy dist --config <approved-production-config>
```

لا تنفذ هذه الأوامر اعتمادًا على هذا المستند وحده.

## 6. الترحيلات الحالية

المصدر المعتمد للترتيب هو مجلد `migrations/`. يوجد حاليًا 33 ملفًا حتى `0032`، مع وجود ملفين تاريخيين يحملان بادئة `0014` ويُطبّقان بترتيب الاسم الكامل.

أحدث الترحيلات:

| الملف | الغرض |
|---|---|
| `0028_finance_fee_payment_integrity.sql` | سلامة الأقساط والدفعات والإيصالات |
| `0029_resource_access_links.sql` | روابط ولي الأمر/الطالب والمدرس/الموظف لعزل الموارد |
| `0030_grade_revision.sql` | revision وتدقيق ذري لتحديث الدرجات |
| `0031_treasury_payroll_integrity.sql` | ذرّية الخزنة والرواتب، business date، والإقفال |
| `0032_fee_installments_receipt_snapshots.sql` | خطط التقسيط المحفوظة وsnapshots إيصالات الإصدار 2 |

لا تعدّل migration مطبقًا. أي تغيير لاحق يكون في ملف جديد مع اختبار ترقية بيانات قديمة واختبار قاعدة جديدة.

## 7. التحقق بعد النشر

- تسجيل الدخول والخروج وانتهاء الجلسة.
- رفض مستخدم غير مصادق عليه لمسارات الأعمال.
- فحص الدور والمدرسة وحدود ولي الأمر والمدرس.
- التدفقات الحرجة: تحصيل/إلغاء دفعة، إيصال، راتب، حركة خزنة، إقفال يوم، حفظ درجة، واعتماد جدول.
- تطابق رصيد الخزنة المخزن مع دفتر القيود.
- readiness views سليمة و`foreign_key_check` نظيف.
- مسارات QR العامة لا تكشف بيانات خاصة عند token غير صالح.
- سجلات Cloudflare خالية من زيادة 4xx/5xx غير المتوقعة.

## 8. الأسرار

ضع `JWT_SECRET` كـCloudflare Secret في البيئة الصحيحة، واضبط `APP_ENV` و`ALLOWED_ORIGINS` من إعدادات البيئة. لا تضع قيمة حقيقية في `.dev.vars` المتعقب أو `wrangler.jsonc` أو GitHub logs.
