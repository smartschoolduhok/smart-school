# نظام المدرسة الذكي — Smart School

منصة عربية متعددة المدارس لإدارة الطلبة والتسجيلات والمواد والدرجات وكشوف النتائج والجداول والحضور والواجبات المنزلية والرسوم والإيصالات والخزنة والموظفين والرواتب.

## الحالة الحالية

- Phase 20A1 الخاصة بسلامة الأقساط والدفعات والإيصالات مكتملة ومندمجة وموثقة.
- دفعة التثبيت اللاحقة للتدقيق مندمجة؛ migrations `0029`–`0031` مطبقة على STAGING، مع عزل وصول ولي الأمر والمدرس وذرّية الدرجات والرواتب والخزنة وتبسيط الواجهة.
- Phase 20B مكتملة ومندمجة؛ أضافت حساب الطالب المالي، خطط التقسيط الاختيارية، إيصال A4 محسّنًا وعرض ولي الأمر للقراءة فقط. Migration `0032` مطبقة على STAGING؛ كان السجل عند إغلاقها 33 migration فريدة بلا migrations معلّقة.
- اجتازت Phase 20B النسخ والاستعادة والـpreflight وQA الوظيفي على STAGING، لكن هذا لا يُعد تصريحًا لـProduction؛ يلزم قرار GO وإعداد ونشر مستقلان.
- Phase 20C مكتملة ومندمجة ومنشورة على STAGING؛ تضيف سياسات درجات سنوية مرنة versioned للنجاح والإكمال والإعفاء والدخول الوزاري ودرجات القرار. Migration `0033` مطبقة على STAGING مرة واحدة. بعد تنظيف QA لا توجد سياسة حقيقية معتمدة تلقائيًا؛ يجب إدخال مرجع قرار الوزارة وسياسة كل صف وسنة قبل اعتماد النتائج الرسمية.
- اجتازت Phase 20C المحاكاة المحلية وSTAGING QA وQuality Gates ونشر Cloudflare بعد الدمج. هذا لا يُعد تصريحًا لـProduction؛ يلزم قرار GO وإعداد ونشر مستقلان.
- Phase 20D.1 مكتملة ومندمجة في `main` عبر PR `#43` وcommit `87419ea53d36344033221046cd1c76f6f1361a9b`: تضيف دورة نشر وسحب موثقة لكروت النتائج، وتعرض لولي الأمر النتائج المنشورة فقط. Migration `0034` مطبقة على STAGING مرة واحدة.
- Phase 20D.2 مكتملة ومندمجة في `main` عبر [PR #44](https://github.com/smartschoolduhok/smart-school/pull/44) وcommit `333df1b8845772a643bd35e4f5611f0cab79bfbf`: تربط الترفيع والإعادة والتخرج بنسخة محددة من نتيجة رسمية منشورة، وتشتق القرار تلقائيًا. طُبّقت `0035` وحدها بعد backup وتطابق الاستعادة؛ STAGING عند إغلاقها `36/36` migration بلا pending، مع FK/readiness سليمة. [تقرير الأدلة](docs/PHASE_20D2_OFFICIAL_PROMOTION_QA.md). Production لم تُستخدم.
- Phase 20D.3 مكتملة ومندمجة في `main` عبر [PR #45](https://github.com/smartschoolduhok/smart-school/pull/45) وcommit `ae69565`: تضيف Result Card v6 عربي/إنكليزي بقالبين للصفوف المنتهية وغير المنتهية، وتُظهر درجات القرار وأسماء مواد الإكمال/الرسوب/الإعفاء وسبب الدخول الوزاري. كما تجعل التحليل الإداري يختار النتائج الرسمية المنشورة افتراضيًا ويفصلها عن المعاينة الحية. لا توجد migration جديدة. [تقرير الأدلة](docs/PHASE_20D3_RESULT_CARD_ANALYTICS_QA.md).
- Phase 20E.1 مكتملة ومندمجة في `main` عبر [PR #46](https://github.com/smartschoolduhok/smart-school/pull/46): تضيف تصميم Result Card v7 رسميًا أنظف، وخيارات عرض سنوية أو فصلية أو شهرية أو مخصصة، ونصًا متعدد الأسطر تديره المدرسة أعلى الكارت. الطباعة والـQR يعملان عند إصدار الكارت، بينما «إرسال لولي الأمر» هو الخطوة المنفصلة التي تظهره للحساب المرتبط فقط. لا توجد migration جديدة. [تقرير الأدلة](docs/PHASE_20E1_RESULT_CARD_CUSTOMIZATION_QA.md).
- Phase 20E.2 مكتملة ومندمجة في `main` عبر [PR #47](https://github.com/smartschoolduhok/smart-school/pull/47) وcommit `36aabc0`: تضيف عشرة قوالب عراقية جاهزة للكتب الرسمية، وحقولًا متغيرة قابلة للمراجعة قبل الإصدار، وترويسة عربية/إنكليزية قابلة للتخصيص مع شعار رسمي اختياري، وقالب A4 موحدًا مع QR وتوقيع وختم. Migration `0036` مطبقة على STAGING؛ أصبح السجل `37/37` بلا pending. [تقرير التنفيذ والأدلة](docs/PHASE_20E2_OFFICIAL_BOOK_TEMPLATES_QA.md).
- Phase 20E.3 مكتملة ومندمجة في `main` عبر [PR #48](https://github.com/smartschoolduhok/smart-school/pull/48) وcommit `54f29ff`: تضيف نقل حصص الجدول الأسبوعي بالسحب والإفلات والتبديل الذري، مع إظهار تعارض المدرّس الناتج عن السحب والإبقاء على بقية القيود مانعة. Migration `0037` مطبقة على STAGING. [عقد التنفيذ والفحص](docs/PHASE_20E3_TIMETABLE_DRAG_DROP_QA.md).
- Phase 21A مكتملة ومندمجة عبر [PR #49](https://github.com/smartschoolduhok/smart-school/pull/49) وcommit `deb5125`: تضيف حضور الطالب لكل حصة من الجدول الرسمي، مسودة خاصة ثم تأكيدًا، وتصحيحًا إداريًا موثقًا، وعرضًا لولي الأمر لا يتجاوز أبناءه والحصص المؤكدة. Migration `0038` مطبقة على STAGING. [تقرير الأدلة](docs/PHASE_21A_LESSON_ATTENDANCE_QA.md).
- Phase 21B مكتملة ومندمجة عبر [PR #50](https://github.com/smartschoolduhok/smart-school/pull/50) وcommit `719b9c8`: تضيف حضور دخول/خروج الطلبة عند بوابة المدرسة ببطاقة QR موقعة، ومنع تكرار ذري، وإشعارات مرتبطة بولي الأمر، وإبطالًا غير هدّام مع تدقيق. Migration `0039` مطبقة على STAGING؛ السجل هناك `40/40` بلا pending عند إغلاق المرحلة. [تقرير الأدلة](docs/PHASE_21B_STUDENT_GATE_ATTENDANCE_QA.md).
- Phase 21C مكتملة ومندمجة في `main` عبر [PR #51](https://github.com/smartschoolduhok/smart-school/pull/51) وcommit `abc56f1899ac94987630f32b74781587025fdbf7`: تضيف حضور الموظفين والأساتذة كسجل مستقل تمامًا عن حضور الطلبة، مع بطاقة QR موقعة، دخول/خروج، تسجيل يدوي بسبب إلزامي، إبطال مدقق، تقرير للمحاسب للقراءة فقط، وسجل شخصي للمدرس المرتبط. طُبّقت Migration `0040` وحدها على STAGING بعد backup واستعادة محلية مطابقة؛ أصبح السجل `41/41` بلا pending، بعدد `78` جدولًا إجمالًا و`76` جدول تطبيق. نجحت بوابة STAGING والـPreview وQuality Gates قبل الدمج وبعده، ولم تُستخدم Production. [تقرير التنفيذ وبوابة STAGING](docs/PHASE_21C_STAFF_ATTENDANCE_QA.md).
- Phase 21D مكتملة ومندمجة عبر [PR #52](https://github.com/smartschoolduhok/smart-school/pull/52) في `dd9646334d57b1bba5ed9e6ec34e4f85f6d11206`. نجح QA المصادق وCI والمعاينة قبل الدمج وبعده. آخر دليل STAGING: `42/42` migration حتى `0041`، `83/81` جدولًا وFK نظيف؛ R2 خاص بسقف تطبيق `1,000,000,000` بايت، وآخر قياس موثق `154` بايت / `3` كائنات. [الأدلة](docs/PHASE_21D_HOMEWORK_QA.md) و[سجل البوابة التاريخي](docs/PHASE_21D_STAGING_GATE.md).
- المراحل 21E–22B منفذة في فرع المراجعة `codex/phase21e-22b-completion`: تواصل ولي الأمر، نشر المتابعة الدراسية، لوائح موثقة بإصدارات، والقبول والنقل الذري. نجح التحقق المحلي وترقية D1 `42→46` والنسخ/الاستعادة إلى `95/93` جدولًا؛ لم تُطبق `0042`–`0045` على STAGING من هذه الجلسة لعدم وجود دخول Wrangler. [تقرير التنفيذ](docs/ROADMAP_21E_22B_IMPLEMENTATION.md) و[خطوات بوابة STAGING المعتمدة](docs/ROADMAP_21E_22B_STAGING_GATE.md). ربط R2 الجذري أضيف للإعداد الخاص بنشر `main` لمشروع STAGING؛ لا bucket جديد أو رفع ملفات أو تغيير Production.

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
npm run test:homework
npm run test:regressions
npm run test:finance-seed:local
npm run test:backup-restore:local
npm run test:official-promotion:local
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
- `docs/PHASE_20C_ACADEMIC_GRADE_POLICIES_QA.md` لعقود سياسات الدرجات السنوية ودليل التحقق المحلي وبوابة STAGING.
- `docs/PHASE_20D_RESULT_PUBLICATION_QA.md` لدورة نشر النتائج ووصول ولي الأمر وأدلة النسخ والاستعادة وSTAGING QA المصادق عليه.
- `docs/PHASE_20D2_OFFICIAL_PROMOTION_QA.md` لعقد ربط النتيجة الرسمية بالترفيع والإعادة والتخرج ودليل التحقق المحلي.
- `docs/PHASE_20D3_RESULT_CARD_ANALYTICS_QA.md` لقالب Result Card v6 والتحليل الرسمي المنشور وأدلة التحقق المحلي.
- `docs/PHASE_20E1_RESULT_CARD_CUSTOMIZATION_QA.md` لتصميم Result Card v7 وخيارات الدرجات السنوية والفصلية والشهرية والنص المخصص وأدلة التحقق.
- `docs/PHASE_20E2_OFFICIAL_BOOK_TEMPLATES_QA.md` لقوالب الكتب الرسمية العراقية والترويسة وA4 وQR وأدلة STAGING.
- `docs/PHASE_20E3_TIMETABLE_DRAG_DROP_QA.md` لعقد نقل وتبديل حصص الجدول بالسحب والإفلات وبوابات قبوله.
- `docs/PHASE_21A_LESSON_ATTENDANCE_QA.md` لحضور الطالب لكل حصة، النشر لولي الأمر والتصحيح الموثق.
- `docs/PHASE_21B_STUDENT_GATE_ATTENDANCE_QA.md` لبطاقات بوابة الطلبة والحركات والإشعارات والتدقيق.
- `docs/PHASE_21C_STAFF_ATTENDANCE_QA.md` لحضور الموظفين والأساتذة وعزل الصلاحيات وبوابة STAGING.
- `docs/PHASE_21D_HOMEWORK_QA.md` لعقود الواجبات والمرفقات المحمية والجمهور والإشعارات وأدلة التنفيذ المحلي.
