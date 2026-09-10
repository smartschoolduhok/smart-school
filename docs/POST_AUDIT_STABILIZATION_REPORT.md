# تقرير تثبيت ما بعد التدقيق — Smart School

**التاريخ:** 2026-09-09

**الفرع:** `codex/post-audit-stabilization`

**Base:** `main@30099be65ad50de6673dbf6023ba22fa595c960c`

**الحكم الحالي:** migrations 0029–0031 ناجحة على STAGING؛ PR #39 يبقى Draft للمراجعة، دون تصريح Production أو دمج. نتائج دفعة إغلاق فجوات المراجعة موثقة في القسم 9.

## 1. الملخص التنفيذي

تم تنفيذ دفعات التدقيق بالترتيب: عزل الصلاحيات، ذرّية الدرجات، سلامة الخزنة والرواتب والإقفال، تبسيط التنقل ومسارات العمل، معالجة تعليق مولّد الجدول، تحسين حجم التحميل، تحديث التبعيات، إضافة CI وتمرين استعادة، ثم تصحيح وثائق التشغيل.

النتيجة المحلية للدفعة الأصلية قبل مراجعة PR #39:

- **1,411/1,411** تنفيذ اختبار في 22 مجموعة، صفر فشل وصفر تخطي.
- **35/35** فحصًا على D1 محلي حقيقي للأقساط والدفعات والإيصالات.
- جميع **32 migration** تطبق على قاعدة جديدة مع seed ناجح.
- تصدير واستعادة محليان متطابقان عبر **51 جدول تطبيق**. التمرين المحدّث يدعم oversized single-row restoration عبر parameter binding ويقارن كذلك sqlite_sequence.
- `npm audit`: **0 vulnerabilities** بعد أن كان 18 (13 high، 3 moderate، 2 low).
- typecheck وبناء الواجهة والـWorker ناجحان.
- الحزمة الابتدائية انخفضت من نحو 1.085MB إلى **278.29KB**، مع فصل صفحات النظام وExcel إلى chunks عند الطلب.

الدفعة البرمجية الأصلية كانت محلية. بعد تفويض تشغيلي مستقل، طُبقت 0029–0031 على STAGING بنجاح كما في القسم 9. لم تُستخدم Production ولم يُنفّذ seed/reset على STAGING. دفعة إصلاح PR #39 الحالية محلية للكود والاختبارات والوثائق، دون Remote D1 أو إعادة تطبيق migrations.

## 2. نتائج المشاكل المكتشفة

| الرمز | المشكلة المثبتة بالتدقيق | المعالجة | الحالة |
|---|---|---|---|
| ACCESS-01 | ولي الأمر يستطيع الوصول إلى طلاب غير مرتبطين به | `parent_student_links` + حراسة resource-level لكل طالب | مغلقة محليًا |
| ACCESS-02 | وصول المدرس غير مقيد بتكليفاته | ربط مستخدم المدرس بالموظف ثم تقييد الطلاب/الدرجات بالأحمال | مغلقة محليًا |
| GRADE-01 | حفظ الدرجة قد ينجح مع فشل audit log | batch ذرية تجمع الدرجة وسجل التغيير | مغلقة |
| GRADE-02 | نافذتان قد تكتبان فوق بعضهما | revision متفائل ورفض stale write | مغلقة |
| FIN-01 | إلغاء قيد راتب يترك الراتب «مدفوعًا» | مزامنة حالة الراتب مع القيد العكسي داخل D1 | مغلقة |
| FIN-02 | فشل خطوة في الراتب/الخزنة يترك أثرًا جزئيًا | triggers وbatch ذرية مع اختبارات failure injection | مغلقة |
| FIN-03 | إلغاء متزامن قد يعكس الرصيد مرتين | exactly-once cancellation على مستوى القاعدة | مغلقة |
| FIN-04 | قبول مبالغ/عملة غير متوافقة | IQD whole-number guards وcategory/tenant validation | مغلقة |
| CLOSE-01 | الإقفال الأول قد يبدأ من صفر رغم وجود رصيد | اشتقاق الرصيد الافتتاحي من القيود السابقة | مغلقة |
| CLOSE-02 | إمكان إضافة حركة بعد إقفال اليوم | منع DB/API لكل أنواع الحركات في الفترة المغلقة | مغلقة |
| CLOSE-03 | التاريخ يعتمد على UTC/إدخال غير منضبط | `business_date` بتوقيت `Asia/Baghdad` وتحقق التقويم | مغلقة |
| UI-01 | قائمة طويلة وأزرار كثيرة متساوية | Dashboard + 6 مجموعات حسب العمل والدور؛ إخفاء المستقبل | مغلقة |
| UI-02 | قائمة الهاتف والبحث العلوي غير فعالين | drawer كامل، Escape/overlay، وبحث تنقّل فعلي | مغلقة |
| UI-03 | حقل بيانات المدرسة يفقد التركيز | تثبيت component identity وحالة النموذج | مغلقة |
| UI-04 | تبويبات يومية كثيرة في الماليات/الدرجات/الجدول | إبقاء المهام اليومية أساسية ونقل النادر إلى أدوات سياقية | مغلقة |
| UI-05 | شاشة الدخول وسلوك «تذكرني» مضللان | session افتراضي وlocal عند الاختيار ومساعدة صادقة | مغلقة |
| PERF-01 | حالة جدول مستحيلة تستهلك مهلة ثانيتين | حد رياضي مبكر حسب السعة وأيام العمل | مغلقة |
| PERF-02 | كل الصفحات تدخل الحزمة الأولى | React lazy/Suspense لكل route ثقيلة | مغلقة |
| OPS-01 | لا CI موحد | workflow للـaudit/typecheck/regressions/D1/restore/build | مغلقة |
| OPS-02 | لا دليل استعادة قابل لإعادة التشغيل | تمرين export/import ومقارنة تامة محليًا | مغلقة محليًا |
| OPS-03 | أوامر DB المحلية تشير لاسم قديم وتفشل | استخدام binding `DB --local` واختبار reset متعدد الأنظمة | مغلقة |
| DOC-01 | README والنشر والتسليم ما زالت في Phase 2/10 | إعادة كتابة الوثائق حسب الوضع الحالي وحدود البيئات | مغلقة |

## 3. التغييرات حسب الدفعة

### الدفعة A — الصلاحيات والدرجات

- migration `0029_resource_access_links.sql`.
- روابط صريحة ولي الأمر/الطالب والمدرس/الموظف بقيود tenant/role/status.
- endpoints إدارة الروابط من الإعدادات للأدوار المخولة.
- عزل قوائم وقراءات الطالب والدرجات والتسجيلات ومادة الديانة والنتائج.
- migration `0030_grade_revision.sql` لمنع الكتابة القديمة وربط audit بالحفظ نفسه.

### الدفعة B — الواجهة اليومية

- القائمة أصبحت ست مجموعات قابلة للفتح إضافة إلى لوحة التحكم، وتظهر حسب الدور.
- الهاتف: قائمة جانبية وoverlay وEscape وإغلاق بعد التنقل.
- البحث العلوي يبحث فقط في وجهات الدور المتاحة.
- Dashboard لا يعرض نشاطًا وهميًا ويتكيف مع الدور.
- الأقساط: ثلاث وجهات أساسية، تحصيل سريع، وعرض المتبقي قبل الدفع.
- الدرجات: مهمتان يوميتان وأدوات متقدمة منفصلة.
- الجدول: الحالي، الإعداد والتوليد، والسجل؛ الأدوات التفصيلية سياقية.
- الخزنة أربع وجهات أساسية، والموظفون ثلاث، والإعدادات ثلاث.

### الدفعة C — الخزنة والرواتب والإقفال

- migration `0031_treasury_payroll_integrity.sql`.
- إدخال يدوي idempotent، عملة IQD صحيحة، وتطابق الفئة والنوع والمدرسة.
- دفع وإلغاء الراتب ذريان ومتزامنان مع دفتر الخزنة.
- إلغاء exactly-once وrollback كامل عند فشل تحديث الرصيد.
- business date لبغداد، إقفال غير قابل للكسر، وتقارير يوم/شهر مطابقة للدفتر.

### الدفعة D — الأداء والجودة والتشغيل

- solver يرفض النقص المستحيل من حد السعة بدل استنزاف مهلة البحث.
- lazy loading خفض الحزمة الأولى؛ chunk Excel الكبير معزول عن الدخول اليومي.
- تحديث React/Hono/Vite/Wrangler/Tailwind والتبعيات التابعة.
- SheetJS يستخدم الحزمة الحديثة من قناة التوزيع الرسمية للمشروع.
- CI موحد وتمرين استعادة محلي.
- إصلاح أوامر D1 المحلية وإزالة أمر إنشاء قاعدة بعيدة القديم من scripts.

## 4. دليل الاختبار النهائي

### المصفوفة

| المجال | النتيجة |
|---|---:|
| Finance fees | 183/183 |
| Treasury/payroll | 14/14 |
| Security | 22/22 |
| RBAC | 95/95 |
| Resource access | 7/7 |
| UI foundations | 5/5 |
| Settings permissions | 5/5 |
| Academic years | 30/30 |
| Student enrollments | 58/58 |
| Student promotion | 129/129 |
| Student profile | 24/24 |
| Subject management/order/religion/applicability | 122/122 executions |
| Flexible grades/presentation | 45/45 |
| Result cards | 66/66 |
| Excel import | 81/81 |
| Timetable | 319/319 |
| Teaching-load matrix | 117/117 |
| Week setup | 89/89 |
| **الإجمالي الفعلي للمصفوفة** | **1,411/1,411** |

تتضمن المصفوفة ثلاثة ملفات تُنفّذ في أكثر من script بصورة مقصودة؛ لذلك الرقم هو executions وليس عدد test definitions الفريدة.

### D1 المحلي الحقيقي

- تطبيق 32 migration على fresh DB: PASS.
- repository seed وثوابت الماليات: PASS.
- سيناريو الأقساط الحقيقي: 35/35.
- blocker migrations الخمسة: rollback كامل للـschema/history/data.
- ترقية قاعدة populated من `0027` إلى `0028`: كل الأعمدة والصفوف القديمة متساوية.
- إعداد أسبوع حتى 7 أيام × 30 slot وتحديث 210 slot: PASS.
- ترقية النصاب `0026 → 0027`: 46 جدولًا قديمًا محفوظًا وFK نظيفة.
- إنشاء/تحديث 500 نصاب ضمن 5/6 statements: PASS.
- النسخ والاستعادة: 32 migration، 51 جدولًا، snapshot مطابق، وFK/readiness/ledger سليمة.

## 5. بوابات لم تُغلق بعد

هذه ليست أخطاء كود مثبتة، لكنها تمنع إعلان Production:

1. مراجعة PR مستقلة ونجاح GitHub Actions على commit النهائي.
2. **أُغلقت:** تطبيق migrations `0029`–`0031` على STAGING بعد backup وpreflight ومحاكاة ناجحة؛ لا تُعدّل الملفات المطبقة ولا يُعاد تطبيقها.
3. QA بصري authenticated على STAGING لسطح المكتب والهاتف والطباعة.
4. اختبار أدوار مدير/محاسب/مدرس/مسؤول تسجيل/ولي أمر بروابط حقيقية.
5. **أُغلقت:** استعادة النسخة الحقيقية محليًا، بما فيها import_jobs كبير عبر binding، وإثبات حفظ 47 جدولًا تاريخيًا.
6. قرار GO مكتوب ومستقل قبل أي وصول إلى Production.

## 6. تحسينات مستقبلية مقترحة

الأولوية هي إبقاء الواجهة قائمة على المهام، لا إضافة روابط رئيسية جديدة.

### قريبًا

1. مركز مهام موحد حسب الدور: أقساط مستحقة، درجات ناقصة، تعارضات جدول، ورواتب منتظرة.
2. سجل تدقيق إداري قابل للبحث مع filters وexport، بلا إظهار بيانات خارج الدور.
3. لوحات محفوظة وshortcuts شخصية بدل زيادة أزرار كل صفحة.
4. مراقبة أخطاء وأداء وتنبيه عند drift في الخزنة/readiness.

### بعد الاستقرار

5. حضور وغياب يومي مرتبط بالجدول مع إشعارات اختيارية.
6. بوابة ولي أمر موسعة للنتائج والأقساط والغياب والوثائق.
7. مركز اتصالات بموافقات وقوالب وسجل تسليم SMS/WhatsApp/email.
8. تقارير مخصصة وجدولة export يومي/شهري.
9. workflow طلبات وموافقات للخصومات والمصروفات وتعديلات الدرجات الحساسة.

### لاحقًا

10. تطبيق/PWA للمهام السريعة مع offline محدود وآمن.
11. تكامل دفع إلكتروني بعد دراسة قانونية ومالية ومطابقة reconciliation.
12. تحليلات تنبؤية بعد ضبط جودة البيانات والخصوصية، لا قبلها.

## 7. الدين التقني

- `src/worker.ts` تجاوز 12 ألف سطر؛ تفكيكه حسب المجال هو أهم refactor لاحق، على PRs صغيرة مع بقاء العقود والاختبارات.
- بعض صفحات المجال تتجاوز ألف سطر؛ تستخرج منها components/hooks فقط عند الحاجة.
- chunk الخاص بـSheetJS يقارب 500KB لكنه معزول ولا يدخل الحزمة الأولى؛ يمكن تحسينه لاحقًا إن أثبت القياس أثرًا على مستخدمي Excel.

## 8. قرار التسليم

**PR #39 مفتوح كمسودة.** اكتمل تغيير schema المصرّح به على STAGING. تبقى مراجعة الكود وQA البصري واختبارات الأدوار على Branch Preview؛ Production والدمج خارج التفويض.


## 9. نتيجة STAGING وإغلاق فجوات مراجعة PR #39 — 2026-09-09

### النتيجة التشغيلية الفعلية السابقة لهذه الدفعة

- الهدف: smart-school-staging-db، ID: 1bdb9c3d-08d6-4023-9cbc-64369d53198a.
- النسخة الأصلية محفوظة خارج Git في C:\Users\ibrah\Documents\SmartSchoolBackups\staging-20260909T104349Z\smart-school-staging-db-full.sql، بحجم **960,336 bytes**.
- SHA-256: **99FBF895EE223266327CCC3D359A73A5FBE6338413F638C736F388AD9D618B05**.
- تعذر استيراد INSERT لصف import_jobs واحد بحجم 360,732 bytes بسبب حد SQL statement. استُعيد الصف كاملًا باستخدام D1 prepared statement و16 parameter؛ حجم قيمه الفعلي 360,514 bytes، دون اختصارها أو إدراجها في SQL.
- أثبتت المحاكاة التكافؤ الكامل، ثم أثبتت postchecks حفظ الأعمدة والقيم التاريخية في **47 جدولًا** بعد التطبيق.
- **32 migrations، لا pending**؛ 0029/0030/0031 مسجلة مرة واحدة بالترتيب في 2026-09-09 11:08:07–11:08:08 UTC.
- PRAGMA foreign_key_check نظيف، وfinance_fee_readiness وfinance_treasury_readiness وfinance_payroll_school_readiness سليمة. لم توجد سجلات رواتب على STAGING قبل أو بعد.
- **66 tests و7 genuine-D1 checks** ناجحة قبل التطبيق، بما فيها rollback والإلغاء المتزامن دون double reversal والإقفال.
- لا Production ولا seed/reset في العملية التشغيلية. لم تستورد نسخة backup إلى STAGING؛ الكتابة البعيدة الوحيدة كانت migrations apply الرسمية.
- مجلد النسخة والتقرير التشغيلي لم يُعدَّلا في دفعة إصلاح PR #39 الحالية، ولم تُستخدم Remote D1 خلالها.

### Red → green لفجوات المراجعة

1. Fixture لطالب له درجتان في مادتين، والمدرس مكلف بواحدة: أثبت الاختبار الأحمر تسرب الدرجة الثانية. تستخدم قوائم مواد الطالب ودرجاته وتحليله الآن predicate موحدًا لتكليف المدرس. ولي الأمر المرتبط والإدارة يحتفظان بالعرض الكامل المخول لهما.
2. Predicate المدرس يربط employee في المدرسة نفسها وبحالة active ودور teacher، ثم link وteaching load نشطين وسنة أكاديمية نشطة. يُستخدم في الوصول للطالب/الدرجة والقوائم والتحليلات. تشمل اختبارات الإبطال الموظف المؤرشف أو المنقول أو الذي تغير دوره أو حُذف، وتعطيل link/load/year.
3. single وbulk يرفضان grade.is_active != 1 دون تغيير حقول أو audit. حراسة وقت الكتابة تمنع أيضًا الأرشفة المتزامنة من إنتاج audit كاذب أو دفعة جزئية.
4. accountant يحصل على دليل الطلاب المالي المحدود فقط، ولا يدخل درجات/تحليل الطالب. رابط التحليل وroute guard يتبعان السياسة نفسها؛ dashboard counts والرسوم والخزنة والموظفون/الرواتب باقية متاحة.
5. تمرين backup/restore أظهر SQLITE_TOOBIG في المسار القديم ثم نجح بعد fallback محلي صريح لصف import_jobs الكبير. يُنشئ صفًا اصطناعيًا بنص **360,009 bytes** يتضمن Unicode واقتباسات وفواصل وأسطرًا جديدة وفواصل SQL داخل النص؛ يشمل أيضًا NULL وINTEGER وREAL وBLOB.
6. التمرين يُصدّر D1 محليًا ثم يستعيد restore-base إلى قاعدة أخرى معزولة ويُدخل الصف الكبير عبر placeholders/binding فقط. يقارن المصدر والنسخة المستعادة وSQLite baseline: schema، أعداد الصفوف، canonical SHA-256 وكامل المحتوى والأنواع عبر **52 جدولًا بما فيها sqlite_sequence**، ثم FK/readiness والقيم المالية. سجل الدليل يعرض counts/hashes فقط دون محتوى الصف. يرفض fallback الجداول الكبيرة الأخرى والتحويلات العددية غير lossless وحدود D1، ولا يختصر أي قيمة.
7. أُصلح مسار Vite في اختبار treasury/payroll باستخدام root المستخرج من fileURLToPath، لكي تعمل المجموعة على Windows دون غلاف خارجي.

### تحقق دفعة الكود

**اكتملت بوابات الكود والمحاكاة المحلية دون تغيير migrations 0029–0031 أو إعادة تطبيقها على STAGING.**

| الفحص | النتيجة |
|---|---|
| typecheck | PASS |
| full regression matrix | **1425/1425**، 22 مجموعة، صفر فشل وصفر تخطٍ |
| enhanced backup/restore | PASS: صف 360,009 bytes، 52 جدولًا، source/SQLite/D1 متطابقة |
| frontend build | PASS: initial main chunk 278.29 kB |
| Worker build | PASS: 615.76 kB |
| npm audit | صفر ثغرات |
| git diff --check | PASS |
| migrations 0029–0031 | لم تتغير، ولا إعادة تطبيق على STAGING |
| genuine Local D1 finance | PASS مرتين متتاليتين: 32 migrations و35 check في كل مرور |
| genuine Local D1 teaching-load matrix | PASS: fresh/upgrade وFK والتحويلات والـ500-row set-based cases |
| genuine Local D1 week setup | PASS: 32 migrations وFK و12 سيناريو production-builder |
| finance legacy harness | PASS: 40/40، ببيانات اصطناعية محلية فقط |

### تشخيص duplicate-token وتثبيت runner المحلي

الأثر القديم سجل `status=null` فقط، ولم يسجل `signal` أو `r.error` أو المدة؛ لذلك لا يثبت وحده أن السبب `ETIMEDOUT`. بلغ stdout/stderr المحفوظان معًا 87,679 bytes فقط، وهو أقل كثيرًا من `maxBuffer=10,000,000` ويستبعد `ENOBUFS` عمليًا. كما كانت نفس executable والمسارات قد نجحت في الأوامر الستة السابقة، فلا يوجد دليل على `ENOENT` أو `EACCES` في `spawnSync`. توقف خرج Wrangler القديم أثناء تطبيق السلسلة، وكانت الفجوة بين حفظ الأمر السابق وحفظ أمر `duplicate-token` نحو 492 ثانية، مما ينسجم مع تعطل عملية Wrangler/child pipe بعد حد 180 ثانية لكنه لا يكفي لإسناد رمز خطأ لم يُحفظ.

يسجل runner الآن لكل استدعاء، دون stdout/stderr أو بيانات صفوف: اسم السيناريو، status، signal، `error.name/code/message` المنقحة، المدة، timeout، maxBuffer، وحجمي stdout/stderr. كما يعزل `XDG_CONFIG_HOME` داخل مجلد التشغيل المؤقت؛ إعادة الإنتاج كشفت أن registry العام لـWrangler/Miniflare كان عرضة لـ`EPERM` وتعارض الحالة خارج persist directory.

في المرورين الكاملين بعد العزل، كان `duplicate-token` ثابتًا كما يلي:

- المرور الأول: تطبيق 0001–0027: status 0 خلال 29,251ms؛ fixture: status 0 خلال 2,794ms؛ فشل 0028 المقصود: status 1 خلال 4,785ms.
- المرور الثاني: تطبيق 0001–0027: status 0 خلال 29,349ms؛ fixture: status 0 خلال 2,459ms؛ فشل 0028 المقصود: status 1 خلال 4,608ms.
- في الأوامر الستة كانت `signal=null` و`error.name/code/message=null`. لم تحدث `ETIMEDOUT` أو `ENOBUFS` أو `ENOENT/EACCES` أو termination signal، وبقي timeout الصريح 180,000ms وmaxBuffer عند 10,000,000 دون زيادة.
- أثبت كلا المرورين أن فشل قيد duplicate-token المتوقع يعيد schema وmigration history والبيانات بالكامل، مع FK مفعلة و`foreign_key_check` نظيف.

أدلة التشغيل المحلية خارج Git:

- C:\Users\ibrah\AppData\Local\Temp\smart-school-finance-local-hT1Mts
- C:\Users\ibrah\AppData\Local\Temp\smart-school-finance-local-K875SY
- C:\Users\ibrah\AppData\Local\Temp\smart-school-finance-regressions-oWpETV\summary.json
- C:\Users\ibrah\AppData\Local\Temp\smart-school-backup-restore-local-66vuLK\evidence.json
- C:\Users\ibrah\AppData\Local\Temp\smart-school-finance-legacy-4xzkai
- C:\Users\ibrah\AppData\Local\Temp\smart-school-phase19b-local-pvWGSq
- C:\Users\ibrah\AppData\Local\Temp\smart-school-phase19c-local-1jYYI3

لا توجد حاجة إلى migration جديدة معروفة. بقيت كل عمليات D1 في هذه الدفعة محلية ومعزولة؛ لم يحدث وصول Remote D1 أو Production أو deploy أو merge.

## 10. مواءمة دليل الطلاب المالي — 2026-09-09

أغلقت هذه الدفعة ملاحظة UX الخاصة بحساب accountant فوق HEAD السابق `0fb9ae6d6b7f0c381e827e859a2595e4e383d192`. المرجع النهائي هو commit هذه الدفعة بعنوان `fix: align accountant student directory UI`، ويُثبت SHA الكامل في وصف PR #39 بعد الدفع.

- يعرض المحاسب حالة واضحة باسم **دليل الطلاب المالي**، وتتكون قائمة الصفوف من خمسة حقول فقط: رقم الطالب، الاسم، الصف، الشعبة، والحالة.
- الاسم نص عادي؛ لا يوجد رابط إلى `/students/:id` أو زر عرض الملف. لا يظهر الجنس أو ولي الأمر، ولذلك لا تتحول قيمة gender الغائبة إلى عرض «أنثى» كاذب.
- تأتي خيارات تصفية الصف والشعبة من القيم الفريدة في استجابة دليل الطلاب نفسها، مع ربط الشعب بالصف المختار. لا تستدعي الصفحة APIs الصفوف أو الشعب للمحاسب.
- بقي العرض الكامل، وفهرس الصفوف والشعب الأكاديمي، وروابط الملف والإجراءات كما هي للأدوار الأكاديمية وولي الأمر. لم تتغير سياسة API أو حقول استجابة المحاسب.
- يحمّل اختبار DOM fixture واقعيًا بلا gender أو guardian، ويثبت الأعمدة الخمسة وغياب روابط الملف، ثم يغيّر فلاتر الصف والشعبة ويتحقق من النتائج ومن أن الطلبات اقتصرت على auth ودليل الطلاب.

| الفحص | النتيجة |
|---|---|
| اختبار UI المستهدف | **7/7 PASS**، بما فيه regression دليل المحاسب |
| اختبارات الطالب/tenant المستهدفة | **44/44 PASS** |
| full regression matrix | **1426/1426 PASS**، 22 مجموعة، صفر فشل وصفر تخطٍ |
| typecheck | PASS |
| frontend build | PASS: 1976 module، initial main chunk 278.29 kB |
| Worker build | PASS: 615.76 kB |
| git diff --check | PASS |
| migrations 0029–0031 | لم تتغير |

لم تستخدم هذه الدفعة Remote D1 أو Production أو seed/reset أو deploy أو merge.

## 11. توحيد تخزين جلسة المصادقة — 2026-09-09

أوقف Manual QA على Branch Preview عند ظهور انحدار مصادقة قابل لإعادة الإنتاج على HEAD `2f2b42707fd460f6ebd290771c74cee1e46d944c`: تسجيل الدخول دون «تذكرني» كان يعرض المستخدم، ثم يفشل أول طلب API بـ401. كان `useAuth.tsx` يحفظ الجلسة الافتراضية في sessionStorage بينما يقرأ `api.ts` الرمز من localStorage فقط.

- أضيف مصدر مركزي لمفاتيح المصادقة يقرأ token وuser بترتيب localStorage ثم sessionStorage، ويحدد التخزين الحالي، ويحفظ جلسة «تذكرني» في localStorage والجلسة الافتراضية في sessionStorage.
- يمسح انتهاء الجلسة token وuser والمفتاح القديم `smart_school_auth` من التخزينين، ويرسل حدثًا محليًا يجعل `AuthProvider` يسقط المستخدم المصادق عليه فورًا قبل التحويل إلى `/login`.
- يدمج `fetchApi` رؤوس الطلب المخصصة مع `Accept` و`Content-Type` الافتراضيين، ثم يثبت Authorization من التخزين المركزي حتى لا يستطيع `options.headers` حذفه أو استبداله عرضيًا.
- لا تسجل الشيفرة أو الاختبارات token أو password. تستخدم اختبارات DOM قيمًا اصطناعية فقط.

| الفحص | النتيجة |
|---|---|
| اختبارات المصادقة/UI المستهدفة | **9/9 PASS**: session، remember-me، header merge، ومسح 401 للحالة والتخزينين |
| full regression matrix | **1428/1428 PASS**، 22 مجموعة، صفر فشل وصفر تخطٍ |
| typecheck | PASS |
| frontend build | PASS: 1977 module، initial main chunk 278.56 kB |
| Worker build | PASS: 615.76 kB |
| git diff --check | PASS |
| migrations 0029–0031 | لم تتغير |

سيُعاد Manual QA من البداية على Branch Preview الناتج عن commit `fix: unify session authentication storage`، ويبدأ بتسجيل الدخول دون «تذكرني»، ثم معها وإعادة تحميل الصفحة. لم تستخدم هذه الدفعة Remote D1 أو Production أو seed/reset أو deploy يدوي أو merge.

## 12. إغلاق ملاحظتي Manual QA الأخيرتين — 2026-09-10

أكمل Manual QA الموثق على Branch Preview المبني من `b0873b510c7822041e33d16145b6bef4864679c4` فحص الجلسة والطباعة والهاتف والبحث ومسارات الأدوار. نجح فتح كارت النتيجة والإيصال مع جلسة `sessionStorage`، وعادت طلبات API بحالة 200، ولم يظهر overflow في RTL أو الطباعة. نجحت قائمة الهاتف بعرض 390px مع overlay وEscape، كما نجحت صفحات المالك والبحث والفلاتر وثبات تركيز حقول بيانات المدرسة.

اختُبرت حسابات QA مؤقتة للمحاسب والمدرس ومسؤول التسجيل وولي الأمر على STAGING فقط:

- اقتصر دليل المحاسب على حقول الماليات المصرح بها، دون روابط الملفات أو بيانات ولي الأمر أو حقول أكاديمية.
- رأى ولي الأمر الطالب المرتبط فقط، ورُفض مسار الطالب غير المرتبط، ولم تظهر له الماليات.
- هيّأ مسؤول التسجيل سجل درجة QA، ثم أدخل المدرس 77 وعدّلها إلى 78؛ ثبتت القيمة بعد إعادة التحميل وظهر التغييران بالترتيب في سجل التدقيق.
- أُلغي إيصال QA ثم دفعته؛ عاد القسط إلى 0 مدفوع و10,000 متبقٍ وحالة pending، وأُلغي أثر الخزنة مرة واحدة.
- عُطّل تعيينا مادة الحاسوب لطالبي QA دون حذفهما، وثبت ظهورهما تحت حالة «غير نشط».

كشف الفحص اليدوي ملاحظتين قابلتين لإعادة الإنتاج وأُغلقتا في هذه الدفعة البرمجية:

1. كان `assigned_at` القادم من D1 بالثواني يُمرر إلى `Date` كأنه milliseconds، فيظهر تاريخ يناير 1970. يستخدم العرض الآن محول Unix-seconds صريحًا مع توقيت بغداد ويتعامل بأمان مع القيم الفارغة أو غير الصالحة.
2. كانت صفحة إدخال درجات الشعبة تجلب قوائم الصفوف والشعب والمواد العامة حتى للمدرس. تبني الصفحة الآن خيارات المدرس حصريًا من استجابة تعيينات الطلاب الفعالة المقيدة أصلًا بتكليفاته، ولا تستدعي APIs القوائم الأكاديمية العامة. تعتمد المادة على تركيب الصف والشعبة المختارين، وتُمسح الاختيارات والنتائج التابعة عند تغيير النطاق.

### تحقق دفعة الإغلاق محليًا

| الفحص | النتيجة |
|---|---|
| اختبارات التاريخ ونطاق الدرجات المستهدفة | **11/11 PASS** |
| UI foundations | **10/10 PASS**، ويتضمن DOM واقعيًا لحساب مدرس |
| full regression matrix | **1433/1433 PASS**، 22 مجموعة، صفر فشل وصفر تخطٍ |
| Typecheck | PASS |
| Frontend build | PASS: 1978 module، initial main chunk 278.56 kB |
| Worker build | PASS: 615.76 kB |
| npm audit | صفر ثغرات |
| Genuine Local D1 finance | PASS: 32 migrations و35 check، مع rollback كامل لكل blocker مقصود |
| git diff --check | PASS |
| migrations 0029–0031 | لم تتغير ولم يُعد تطبيقها |

اكتمل Branch Preview النهائي للكود المراجع عند `59df8701ea3df126abb29a8cea347fec05d446ce`: نجحت GitHub Quality Gates وCloudflare Pages، ونجح التحقق البصري من التاريخ ونطاق المدرس. لا تمنح هذه النتائج تصريح Production أو merge.

## 13. الإغلاق النهائي وتنظيف حسابات QA على STAGING — 2026-09-10

### نتيجة الكود والـManual QA

- commit الكود النهائي المراجع: `59df8701ea3df126abb29a8cea347fec05d446ce`.
- GitHub Quality Gates: **PASS**.
- Cloudflare Pages: **PASS** للكود نفسه.
- Branch Preview: https://90465c29.smart-school-staging.pages.dev
- Teacher scope Manual QA: **PASS**؛ ظهر للمدرس `الصف الاول → أ → الحاسوب` فقط.
- Date rendering: **PASS**؛ ظهر `22/08/2026` ولم يظهر تاريخ من يناير 1970.

### النسخة الاحتياطية والمحاكاة المحلية

- الهدف الوحيد: `smart-school-staging-db`، ID: `1bdb9c3d-08d6-4023-9cbc-64369d53198a`.
- النسخة الكاملة الجديدة: `C:\Users\ibrah\Documents\SmartSchoolBackups\staging-20260910T142038Z\smart-school-staging-db-full.sql`.
- الحجم: **999,670 bytes**.
- SHA-256: `6F0C0ACBCB4CC1A339582CD168AF04DFD5D0AD41962929A262A8E67D7E47BC3C`.
- استُعيدت النسخة محليًا عبر مسار parameter binding الموجود لصف `import_jobs` الكبير: صف واحد، وقيم مرتبطة بحجم 360,514 bytes. نجح اختبار rollback المتعمد، وبقي `foreign_key_check` نظيفًا وكل readiness views سليمة.
- أثبتت مقارنة export قبل التنظيف وبعده أن جدول `import_jobs` والصف الكبير ID `3` لم يتغيرا، وأن الأدلة الأكاديمية والمالية التاريخية لم تتغير.

### نتيجة soft-disable/archive

- المستخدمون IDs `4، 5، 6، 7`: أربعة سجلات بالضبط، أصبحت `inactive` للأدوار accountant وteacher وregistrar وparent.
- الطلاب IDs `30، 31`: سجلان بالضبط، أصبحا `archived`.
- موظف المدرس ID `24`: أصبح `archived`.
- `parent_student_links` ID `1`: أصبح `inactive`.
- `teacher_employee_links` ID `1`: أصبح `inactive`.
- `timetable_teaching_loads` ID `148`: أصبح `inactive` بعد إثبات عدم وجود أي timetable entry مرتبطة به. رفع trigger النظام `timetable_revisions` للسنة ID `2` من `3` إلى `4` كما هو متوقع.
- `student_subjects` IDs `339، 340`: بقيا محفوظين مع `is_active = 0` وبقيت timestamps دون تغيير.
- لم يتغير أي سجل مستخدم أو طالب أو موظف غير مستهدف، ولم تُحذف أي صفوف.

### Postchecks وحفظ الأدلة

- `foreign_key_check`: **PASS**، بلا مخالفات.
- readiness: `finance_fee_readiness` و`finance_treasury_readiness` و`finance_payroll_school_readiness` سليمة، ولا صفوف غير سليمة في `finance_payroll_readiness`.
- migration count: **32**؛ migrations `0029` و`0030` و`0031` ما زالت مسجلة مرة واحدة وبالقيم نفسها.
- grade ID `336` بقيت قيمته `78` ومراجعته `2`، وبقي سجلا التدقيق IDs `36، 37` محفوظين.
- student fee ID `2`: **10,000 IQD**، المدفوع `0`، المتبقي `10,000`، والحالة `pending`.
- fee payment ID `2` وreceipt ID `3` بقيا `cancelled`، وبقي treasury reversal المرتبط مرة واحدة بالضبط.
- لم يحدث وصول إلى Production، ولم يُستخدم seed/reset أو `DELETE` أو نشر يدوي أو force-push أو merge.
