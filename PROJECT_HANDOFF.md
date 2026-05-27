# Smart School System — Project Handoff

## 1. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite + TailwindCSS 4 + React Router DOM |
| Backend | Hono Framework (Cloudflare Workers/Pages) |
| Database | Cloudflare D1 (SQLite-compatible) |
| Auth | JWT Bearer tokens via Web Crypto API |
| Hosting | Cloudflare Pages (Edge deployment) |
| QR Codes | qrcode.react |
| Icons | lucide-react |

---

## 2. Completed Phases (1–9)

| Phase | Module | Status |
|-------|--------|--------|
| 1 | Schools, Users, Roles, Settings | ✅ Active |
| 2 | Students, Classes, Sections | ✅ Active |
| 3 | Subjects, Student Subjects | ✅ Active |
| 4 | Grades & Calculations | ✅ Active |
| 5 | General Exemption Settings | ✅ Active |
| 6 | Result Cards + QR Verification | ✅ Active |
| 7 | Fees, Receipts + QR Verification | ✅ Active |
| 8 | Treasury (Income/Expenses) | ✅ Active |
| 9 | Employees & Salaries | ✅ Active |

---

## 3. Active Modules (15 Sidebar Routes)

1. لوحة التحكم (`/`)
2. المدارس (`/schools`)
3. المستخدمون (`/users`)
4. الأدوار والصلاحيات (`/roles`)
5. الطلاب (`/students`)
6. الصفوف والشعب (`/classes`)
7. المواد (`/subjects`)
8. مواد الطالب (`/student-subjects`)
9. الدرجات (`/grades`)
10. التحليل (`/analytics`)
11. كارتات النتائج (`/result-cards`)
12. الأقساط (`/fees`)
13. الخزنة (`/treasury`)
14. الموظفون (`/employees`)
15. إعدادات النظام (`/settings`) — placeholder

---

## 4. Future/Disabled Modules (6)

| Module | Route | Status |
|--------|-------|--------|
| الكتب الرسمية | `/official-books` | 🔒 Disabled |
| السجلات المطبوعة | `/print-records` | 🔒 Disabled |
| النقل المدرسي | `/transport` | 🔒 Disabled |
| بوابة المدرس | `/teacher-portal` | 🔒 Disabled |
| بوابة ولي الأمر | `/parent-portal` | 🔒 Disabled |
| المساعد الذكي | `/ai-assistant` | 🔒 Disabled |

---

## 5. Database Schema (10 Migrations)

### Tables
- `schools` — المدارس
- `academic_years` — السنوات الدراسية
- `users` — المستخدمون
- `roles` — الأدوار
- `role_permissions` — صلاحيات الأدوار
- `modules` — الموديلات
- `school_modules` — تفعيل الموديلات لكل مدرسة
- `classes` — الصفوف
- `sections` — الشعب
- `students` — الطلاب
- `subjects` — المواد
- `student_subjects` — مواد الطالب
- `grades` — الدرجات (الأشهر + الامتحانات)
- `general_exemption_settings` — إعدادات الإعفاء العام
- `result_cards` — كارتات النتائج (مع QR)
- `student_fees` — أقساط الطلاب
- `fee_payments` — دفعات الأقساط
- `fee_receipts` — سندات القبض (مع QR)
- `treasury_accounts` — حسابات الخزنة
- `treasury_transactions` — معاملات الخزنة
- `treasury_closings` — أقفال الخزنة اليومية
- `treasury_categories` — فئات الخزنة
- `employees` — الموظفون
- `employee_salaries` — رواتب الموظفين
- `token_blacklist` — قائمة تسجيلات الخروج

---

## 6. API Route Groups

### Auth (Public)
- `POST /api/auth/login`
- `GET /api/auth/me` (Protected)
- `POST /api/auth/logout` (Protected)

### Schools
- `GET /api/schools`
- `POST /api/schools`
- `PUT /api/schools/:id`
- `DELETE /api/schools/:id`

### Users
- `GET /api/users`
- `POST /api/users`
- `PUT /api/users/:id`
- `DELETE /api/users/:id`

### Roles
- `GET /api/roles`
- `POST /api/roles`
- `PUT /api/roles/:id`
- `DELETE /api/roles/:id`

### Students, Classes, Subjects, Student Subjects, Grades
- Standard CRUD with school scoping

### Result Cards
- `POST /api/result-cards/generate`
- `GET /api/result-cards`

### Fees
- `GET /api/student-fees`
- `POST /api/student-fees`
- `POST /api/student-fees/:id/payments`
- `GET /api/fee-receipts`

### Treasury
- `GET /api/treasury`
- `POST /api/treasury/transactions`
- `PUT /api/treasury/transactions/:id/cancel`

### Employees
- `GET /api/employees`
- `POST /api/employees`
- `PUT /api/employees/:id`
- `GET /api/employee-salaries`
- `POST /api/employee-salaries/:id/pay`

### Public Verification (No Auth)
- `GET /api/verify/result-card/:token`
- `GET /api/verify/receipt/:token`

---

## 7. Auth & RBAC

### Role Keys
- `system_admin` — مدير النظام (كل المدارس، كل الصلاحيات)
- `school_owner` — مالك المدرسة (مدرسته فقط، كل الصلاحيات)
- `principal` — المدير (مدرسته، معظم الصلاحيات)
- `vice_principal` — نائب المدير
- `teacher` — معلم (لا يمكنه الوصول للمالية)
- `accountant` — محاسب (المالية فقط، لا يمكنه تعديل الدرجات)
- `registrar` — مسجل شؤون الطلاب
- `parent` — ولي الأمر (مستقبلي)

### Password Hashing
```
SHA-256(password + 'smart-school-salt-2026' + email)
```

### JWT
- Secret from `JWT_SECRET` env var
- TTL: 24 hours (86400 seconds)
- Blacklist on logout

---

## 8. Deployment Steps

### Local Development
```bash
# 1. Install dependencies
npm install

# 2. Create local D1 and run migrations
npm run db:migrate

# 3. Seed demo data
npm run db:seed

# 4. Start dev server
npm run preview
```

### Production Deployment
```bash
# 1. Build frontend + worker
npm run build

# 2. Create D1 database (first time only)
npx wrangler d1 create smart-school-db

# 3. Apply migrations to production
npx wrangler d1 migrations apply smart-school-db --remote

# 4. Seed production data
npx wrangler d1 execute smart-school-db --remote --file=./seed.sql

# 5. Deploy
npm run deploy
```

### Environment Variables
```
JWT_SECRET=your-very-long-random-secret-key-here
```

---

## 9. Known Limitations

1. **worker.ts is 5335 lines** — needs future refactor into route modules
2. **Settings page is a placeholder** — inline component in App.tsx, not a real module
3. **No real-time sync** — no WebSockets, refresh needed for updates
4. **No bulk import** — cannot import students/subjects from CSV/Excel yet
5. **No multi-language** — Arabic only, no English toggle
6. **No SMS/email notifications** — no Twilio/Email integration yet
7. **Reports are basic** — no PDF export, no advanced reporting
8. **No backup UI** — D1 backups managed via Cloudflare dashboard
9. **D1 is SQLite** — no advanced analytics queries, limited concurrency
10. **Settings is placeholder** — no actual configuration panel

---

## 10. Next Recommended Phases

### Phase 11: Settings & Configuration
- Real settings page (school info, branding, academic year)
- System configuration panel
- Email/SMS settings

### Phase 12: Teacher Portal
- Teacher login with limited view
- Grade entry per subject
- View students in their classes

### Phase 13: Parent Portal
- Parent login
- View child's grades
- View fee status
- Download result cards

### Phase 14: Transport
- Bus routes
- Student assignment to buses
- Transport fees

### Phase 15: Official Books & Print Records
- Government forms
- Print-ready reports
- PDF export

### Phase 16: AI Assistant
- Chatbot for school queries
- Automated notifications
- Grade predictions

---

## 11. Demo Data

All demo data is in `seed.sql` for **مدرسة النخبة الأهلية** (School 1):

- **Students**: 10 (Classes 1–3)
- **Subjects**: 20+ across classes
- **Grades**: Full records for all 10 students
- **Fees**: 8 fee records (paid/pending/overdue)
- **Payments**: 8 payment records
- **Treasury**: 6 transactions (income/expense)
- **Employees**: 6 staff members
- **Salaries**: 6 salary records (May 2025)

---

## 12. Security Checklist (Verified Phase 10)

- [x] All protected APIs require JWT Bearer token
- [x] Public routes: login, result-card verify, receipt verify only
- [x] School scoping enforced (users see their school only)
- [x] Inactive users cannot login
- [x] Logout blacklist works
- [x] RBAC enforced (teacher → no finance, accountant → no grades)
- [x] Non-admin users cannot access other schools
- [x] Passwords hashed with SHA-256 + salt
