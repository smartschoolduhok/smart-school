# نظام المدرسة الذكي — Smart School SaaS

## Project Overview
- **Name**: Smart School SaaS (نظام المدرسة الذكي)
- **Goal**: Multi-tenant school management system for Iraq (Arabic RTL)
- **Phase**: 1.5 — Backend Integration with Cloudflare D1
- **Features**: Schools, Users, Roles & Permissions, Dashboard, Academic Years, Modules

## Tech Stack
- **Frontend**: React 19 + Vite + TailwindCSS + React Router + Lucide Icons
- **Backend**: Hono (Cloudflare Pages Worker)
- **Database**: Cloudflare D1 (SQLite-compatible)
- **Styling**: Arabic RTL, Arabic-Indic digits, Cairo font

## URLs
- **Production**: (deploy via `npm run deploy` after Cloudflare setup)
- **Local Preview**: `http://localhost:3000`

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

Core tables:
- `schools` — registered schools
- `roles` — system & school roles
- `permissions` — fine-grained permissions
- `role_permissions` — junction table
- `users` — system & school users (nullable `school_id` for system admins)
- `academic_years` — per-school academic years
- `modules` — system modules/features
- `school_modules` — per-school module enablement

See `migrations/0001_initial_schema.sql` for full schema.

## API Routes (GET)

| Route | Description |
|-------|-------------|
| `GET /api/schools` | List all schools |
| `GET /api/schools/:id` | Get single school |
| `GET /api/users` | List users (supports `?school_id=`) |
| `GET /api/users/:id` | Get single user |
| `GET /api/roles` | List roles |
| `GET /api/roles/:id` | Get single role |
| `GET /api/permissions` | List permissions |
| `GET /api/role-permissions` | Role-permission mappings |
| `GET /api/academic-years` | List academic years (supports `?school_id=`) |
| `GET /api/modules` | List modules |
| `GET /api/school-modules` | Per-school module config (supports `?school_id=`) |
| `GET /api/dashboard/stats` | Aggregated dashboard stats |

## Demo Login Credentials

| Role | Email | Password |
|------|-------|----------|
| System Admin | `admin@smart-school.iq` | `admin123` |
| School Principal | `principal@nukhba.iq` | `school123` |

## Multi-Tenancy Design

- `school_id` on `users` determines school scope (`null` = system-level)
- `school_id` on `academic_years`, `school_modules` isolates school data
- API routes accept `?school_id=` for future auth-based filtering
- Dashboard and Users pages already pass `school_id` from logged-in user context

## UI Features
- **Arabic RTL**: Full right-to-left layout
- **Arabic-Indic Digits**: `toArabicDigits()` converts Western digits
- **Loading States**: Spinners on Schools, Users, Roles, Dashboard
- **Error States**: Retry buttons with Arabic error messages
- **Empty States**: Arabic "لا توجد نتائج" messages
- **Disabled Modules**: Phase 1 modules (students, fees, transport, etc.) show 🔒 lock screen

## Project Structure

```
webapp/
├── src/
│   ├── worker.ts            # Hono API routes (backend)
│   ├── lib/api.ts           # Frontend API client (fetch wrappers)
│   ├── lib/arabicDigits.ts  # Arabic-Indic digit converter
│   ├── types/index.ts       # TypeScript types
│   ├── data/demoData.ts     # Phase 1 mock data (kept as fallback)
│   ├── modules/
│   │   ├── schools/SchoolsPage.tsx
│   │   ├── users/UsersPage.tsx
│   │   ├── roles/RolesPage.tsx
│   │   ├── dashboard/DashboardPage.tsx
│   │   └── auth/LoginPage.tsx
│   ├── hooks/useAuth.tsx    # Mock auth (Phase 2: Supabase)
│   └── App.tsx              # React Router routes
├── migrations/0001_initial_schema.sql  # D1 schema migration
├── seed.sql                 # Demo seed data
├── wrangler.jsonc           # Cloudflare config (D1 binding)
├── vite.config.ts           # Frontend Vite config
└── vite.worker.config.ts    # Worker build config
```

## Deployment Status
- **Platform**: Cloudflare Pages
- **Status**: ✅ Local preview active
- **Database**: ✅ D1 local with seeded data
- **API**: ✅ All GET routes functional
- **Frontend**: ✅ Arabic RTL, real data fetching

## Next Steps (Phase 2)
- [ ] Supabase Auth integration (replace mock auth)
- [ ] POST/PUT/DELETE API routes (CRUD operations)
- [ ] Students, Classes, Subjects, Grades modules
- [ ] Fees & Treasury modules
- [ ] Teacher & Parent portals
- [ ] AI Assistant module
