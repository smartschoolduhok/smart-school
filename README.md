# نظام المدرسة الذكي — Smart School SaaS

## Project Overview
- **Name**: Smart School SaaS (نظام المدرسة الذكي)
- **Goal**: Multi-tenant school management system for Iraq (Arabic RTL)
- **Phase**: 5 — Analytics & Exemption Logic
- **Features**: Schools, Users, Roles & Permissions, Dashboard, Academic Years, Modules, Classes, Sections, Students, Subjects, Student-Subjects Assignment, Grades Management with Calculation Rules, Audit Logging, Grade Settings, Analytics Dashboard (8 endpoints)

## Tech Stack
- **Frontend**: React 19 + Vite + TailwindCSS + React Router + Lucide Icons
- **Backend**: Hono (Cloudflare Pages Worker)
- **Database**: Cloudflare D1 (SQLite-compatible)
- **Styling**: Arabic RTL, Arabic-Indic digits, Cairo font

## URLs
- **Production**: (deploy via `npm run deploy` after Cloudflare setup)
- **Local Preview**: `http://localhost:3000`
- **Public Preview**: https://3000-ijbktc3mi9qbkju5y7kbh-ad490db5.sandbox.novita.ai

## Prerequisites
- Node.js 20+
- npm
- Wrangler CLI (`npm install -g wrangler`)

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Create D1 Database (local development)
```bash
npm run db:migrate
npm run db:seed
```

### 3. Build & Run
```bash
npm run build
npm run preview
```

### 4. Open in Browser
- Frontend: `http://localhost:3000`
- API Health: `http://localhost:3000/api/schools`

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Vite dev server (frontend only) |
| `npm run build` | Build frontend + worker |
| `npm run preview` | Start fullstack preview (Wrangler Pages + D1 local) |
| `npm run deploy` | Build & deploy to Cloudflare Pages |
| `npm run db:migrate` | Apply D1 migrations locally |
| `npm run db:seed` | Seed demo data into local D1 |
| `npm run db:reset` | Reset local D1 (re-migrate + re-seed) |
| `npm run test:api` | Quick curl test on `/api/schools` |

## Database Schema (D1/SQLite)

### Core Tables (Phases 1–3)
- `schools` — registered schools
- `roles` — system & school roles
- `permissions` — fine-grained permissions
- `role_permissions` — junction table
- `users` — system & school users (nullable `school_id` for system admins)
- `academic_years` — per-school academic years
- `modules` — system modules/features
- `school_modules` — per-school module enablement
- `classes` — grade levels per school
- `sections` — class divisions per school
- `students` — student records per school
- `subjects` — subjects per school/class/section
- `student_subjects` — student-subject assignments with active/inactive lifecycle

### Phase 4 Tables
- `grades` — student grade records per subject
- `grade_change_logs` — audit trail for every grade modification
- `grade_settings` — per-school grade configuration (max grade, passing, individual exemption, general exemption average/min, formulas)

### Student Subjects Index Strategy
- **Partial Unique Index**: `idx_student_subjects_unique_active` on `(school_id, student_id, subject_id) WHERE is_active = 1`
  - Ensures only ONE active assignment per student+subject per school
  - Allows multiple inactive records (soft-delete history preserved)
- **Performance Indexes**: `school_id`, `student_id`, `subject_id`, `class_id`, `section_id`, `is_active`, `assigned_at`

### Phase 4 Index Strategy
- `grades`: indexes on `school_id`, `student_subject_id`, `result_status`, `is_active`
- `grade_change_logs`: indexes on `grade_id`, `school_id`, `created_at`
- `grade_settings`: unique index on `school_id`

See `migrations/0004_phase4_grades.sql` for full schema.

## API Routes

### Student Subjects (Phase 3)

| Method | Route | Description |
|--------|-------|-------------|
| `GET /api/student-subjects` | List assignments with filters (school_id, student_id, class_id, section_id, subject_id, is_active) |
| `GET /api/students/:id/subjects` | Active subjects for one student |
| `POST /api/student-subjects/assign-class` | Assign subjects to all active students in a class |
| `POST /api/student-subjects/assign-section` | Assign subjects to all active students in a section |
| `POST /api/student-subjects/assign-students` | Assign subjects to chosen list of students |
| `POST /api/student-subjects/assign-one` | Assign one subject to one student |
| `PUT /api/student-subjects/:id/deactivate` | Deactivate (soft-delete) an assignment |
| `PUT /api/student-subjects/:id/reactivate` | Reactivate a deactivated assignment |
| `POST /api/student-subjects/bulk-deactivate` | Deactivate multiple assignments |

### Grades (Phase 4)

| Method | Route | Description |
|--------|-------|-------------|
| `GET /api/grades` | List grades with filters (school_id, student_id, class_id, section_id, subject_id, is_active) |
| `GET /api/students/:id/grades` | Active grades for one student with settings |
| `POST /api/grades/initialize-student/:student_id` | Create empty grade rows for all active student_subjects |
| `POST /api/grades/initialize-section` | Initialize grades for all students in a section for given subjects |
| `PUT /api/grades/:id` | Update grade fields with automatic calculations & audit logging |
| `POST /api/grades/bulk-entry` | Bulk update multiple grade records at once |
| `GET /api/grades/:id/history` | Audit log for a grade record |
| `GET /api/grade-settings` | Get school grade settings (auto-creates defaults) |
| `PUT /api/grade-settings` | Update grade settings (passing, exemption, max, general exemption average/min, formulas) |

### Analytics (Phase 5)

| Method | Route | Description |
|--------|-------|-------------|
| `GET /api/analytics/overview` | School-wide summary: totals, pass/fail/incomplete counts, close-to-passing, close-to-exemption |
| `GET /api/analytics/by-class` | Per-class breakdown with student counts, pass rate, incomplete count, close-to-passing, close-to-exemption |
| `GET /api/analytics/by-section` | Per-section breakdown with same metrics as by-class |
| `GET /api/analytics/by-subject` | Per-subject breakdown with pass rate, incomplete count, close-to-passing, close-to-exemption |
| `GET /api/analytics/students-close-to-passing` | Students within 1–5 marks of passing (based on effective_grade) |
| `GET /api/analytics/students-close-to-exemption` | Students within 1–5 marks of general exemption (based on annual_effort) |
| `GET /api/analytics/exemption-blockers` | Subjects with students missing annual_effort or below general exemption thresholds |
| `GET /api/analytics/student-summary/:student_id` | Single student full report: all subjects with grades, general exemption eligibility |

### Validation Rules
- Subject cannot be assigned to a student from a different school
- Class-linked subjects cannot be assigned across classes
- Section-specific subjects cannot be assigned across sections
- Duplicate active assignments are blocked (409)
- Reactivation blocked if another active assignment exists for same student+subject
- Grade values must be numeric and within 0–max_grade range
- Missing/blank grades are stored as NULL (never treated as zero)

### Calculation Rules (Phase 4)
- **First Term Average** = round(avg(الشهر الأول, الشهر الثاني))
- **Second Term Average** = round(avg(الشهر الثالث, الشهر الرابع))
- **Annual Effort** = round(avg(First Term Average, نصف السنة, Second Term Average))
- **Final Grade** = round(avg(Annual Effort, الامتحان النهائي))
- **Grade After Completion** = max(Final Grade, درجة الإكمال) — only if final_grade < passing_grade AND completion_exam exists
- **Effective Grade** = Grade After Completion if exists, otherwise Final Grade
- **Result Status** (derived from effective_grade vs passing_grade):
  - ناجح (Pass) — if effective_grade >= passing_grade
  - مكمل (Incomplete) — if final_grade < passing_grade and completion_exam IS NULL
  - راسب (Fail) — if final_grade < passing_grade, completion_exam IS NOT NULL, and effective_grade < passing_grade
- **Individual Exemption Status** (based on annual_effort only):
  - معفى (Exempt) — if annual_effort >= exemption_grade (e.g. ≥ 90 when max=100)
  - NOT based on effective_grade, final_grade, or completion_exam
- **General Exemption** (based on annual_effort across ALL subjects):
  - Eligible if: all subjects have grade records, all have calculated annual_effort,
    AVG(annual_effort) ≥ general_exemption_average_grade (default 85),
    and MIN(annual_effort) ≥ general_exemption_min_subject_grade (default 75)

### Authentication & Authorization
- JWT Bearer token required for all endpoints
- Same-school enforcement (non-admin users can only access their school's data)
- Arabic error messages throughout

## Integration Test Results

### Phase 3 — Student Subjects Lifecycle
```
✓ PASS Login succeeded, token acquired
✓ PASS Got school_id=1
✓ PASS Got class_id=1
✓ PASS Got section_id=1
✓ PASS Got student_id=2
✓ PASS Got subject_id=1
✓ PASS Assigned successfully, record id=3
✓ PASS Duplicate blocked (Arabic message)
✓ PASS Deactivated successfully
✓ PASS Re-assigned successfully, new record id=4
✓ PASS List shows 2 records (active+inactive)
✓ PASS Active-only filter returns 1 record
✓ PASS Reactivation blocked (Arabic message)
✓ PASS New assignment deactivated
✓ PASS Old assignment reactivated successfully
✓ PASS Student active subjects returned
✓ PASS Reactivating already-active blocked (Arabic)
✓ PASS No token returns 401
✓ PASS Bulk deactivated 2 assignments

Total: 19 | Passed: 19 | Failed: 0
```

### Phase 4 — Grades API Tests
```
✓ PASS Admin login succeeded
✓ PASS Initialize student grades: 1 created, 0 skipped
✓ PASS Load student grades with settings (max=100, passing=50, exemption=90)
✓ PASS Update first_month=70, second_month=80 → first_term_average=75
✓ PASS Full grade entry with all fields → result_status="ناجح"
✓ PASS Audit log created for changed fields (3 entries)
✓ PASS Bulk entry updated 1 record
✓ PASS Bulk entry audit log recorded
✓ PASS Grade history returns field changes with user name
✓ PASS Grade settings update: passing=55, exemption=35 (admin)
✓ PASS Principal login and school-scoped access
✓ PASS Principal reads grade settings for school 1
✓ PASS Principal reads auto-filtered grades for school 1
✓ PASS Principal reads student grades

Total: 14 | Passed: 14 | Failed: 0
```

## UI Features
- **Arabic RTL**: Full right-to-left layout
- **Arabic-Indic Digits**: `toArabicDigits()` converts Western digits
- **Active/Inactive Filters**: Filter assignments by status
- **Action Buttons**: "إعادة التفعيل" (reactivate) and "إلغاء التعيين" (deactivate)
- **Bulk Actions**: Select multiple assignments and bulk-deactivate
- **Assignment Modes**: Class, Section, Student Group, or Single Student
- **Loading States**: Spinners on all data fetching
- **Error States**: Retry buttons with Arabic error messages
- **Empty States**: Arabic "لا توجد نتائج" messages

## Grades Page (Phase 4) — "الدرجات والحسابات"
Four tabs with full Arabic RTL UI:

1. **إدخال درجات طالب** — Student selector, init button, editable monthly/exam fields, read-only calculated fields (averages, final grade, status), notes
2. **إدخال درجات شعبة** — Class/section/subject selectors, bulk entry for a single grade field with confirmation dialog
3. **إعدادات الدرجات** — Edit max grade, passing grade, exemption grade, view calculation formulas
4. **سجل تعديل الدرجات** — Select student then grade record, view audit history (field, old value, new value, user, date, reason)

## Demo Login Credentials

| Role | Email | Password |
|------|-------|----------|
| System Admin | `admin@smart-school.iq` | `admin123` |
| School Principal | `principal@nukhba.iq` | `school123` |

## Project Structure

```
webapp/
├── src/
│   ├── worker.ts            # Hono API routes (backend)
│   ├── grade-routes.ts      # Phase 4 grade routes (concatenated into worker.ts)
│   ├── lib/api.ts           # Frontend API client (fetch wrappers)
│   ├── lib/arabicDigits.ts  # Arabic-Indic digit converter
│   ├── modules/
│   │   ├── dashboard/DashboardPage.tsx
│   │   ├── schools/SchoolsPage.tsx
│   │   ├── users/UsersPage.tsx
│   │   ├── roles/RolesPage.tsx
│   │   ├── classes/ClassesPage.tsx
│   │   ├── sections/SectionsPage.tsx
│   │   ├── students/StudentsPage.tsx
│   │   ├── subjects/SubjectsPage.tsx
│   │   ├── studentSubjects/StudentSubjectsPage.tsx
│   │   ├── grades/GradesPage.tsx       # Phase 4: 4-tab grades UI
│   │   └── analytics/AnalyticsPage.tsx # Phase 5: 8-tab analytics dashboard
│   ├── components/
│   │   ├── Sidebar.tsx       # Navigation with "الدرجات" enabled
│   │   └── Layout.tsx
│   ├── hooks/useAuth.tsx    # JWT auth context
│   └── App.tsx              # React Router routes (/grades enabled)
├── migrations/
│   ├── 0001_initial_schema.sql
│   ├── 0002_phase2_academic_tables.sql
│   ├── 0003_student_subjects.sql
│   ├── 0004_phase4_grades.sql          # grades, grade_change_logs, grade_settings
│   └── 0005_general_exemption_settings.sql  # Adds general_exemption_average_grade & general_exemption_min_subject_grade
├── seed.sql                 # Demo seed data
├── test_student_subjects_lifecycle.sh  # Phase 3 integration tests
├── test_grades.sh           # Phase 4 integration tests
├── wrangler.jsonc           # Cloudflare config (D1 binding: smart-school-db)
├── vite.config.ts           # Frontend Vite config
└── vite.worker.config.ts    # Worker build config
```

## Deployment Status
- **Platform**: Cloudflare Pages
- **Status**: ✅ Build successful (zero TypeScript errors)
- **Database**: ✅ D1 local with seeded data, 0004 migration applied
- **API**: ✅ All routes functional with JWT auth, calculations, audit logging
- **Frontend**: ✅ Arabic RTL, real data fetching, 4-tab grades UI, 8-tab analytics UI
- **Tests**: ✅ 19/19 Phase 3 + 14/14 Phase 4 + Phase 5 API tests passing
- **Phase 5**: ✅ Exemption logic corrected (annual_effort based), 8 analytics endpoints, zero TypeScript errors

## Known Limitations
- Grade formulas are stored as text and displayed for reference; the actual calculations are hardcoded in `calculateGrades()` to ensure correctness
- `grade_after_completion` displays the completion_exam value when it's the effective grade (UI shows completion_exam column)
- Audit log `created_at` is Unix epoch integer (displayed as raw number in history tab)
- Bulk entry only supports editing one field at a time per batch
- No real-time notifications when grades are updated by another user

## Next Steps
- [ ] Deploy to Cloudflare Pages production
- [ ] Configure custom domain
