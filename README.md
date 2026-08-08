# نظام المدرسة الذكي — Smart School System

## Project Overview
- **Name**: نظام المدرسة الذكي
- **Goal**: Multi-school SaaS platform for school management with Arabic RTL UI
- **Features**: Schools, Users, Roles & Permissions, Students, Classes, Sections, Subjects, Student Subjects, Grades & Academic Calculations, Analytics, Result Cards with QR Verification, Fees & Receipts with QR Verification, Treasury, Employees & Salaries
- **Language**: Arabic (RTL)
- **Phase**: 10 — Production Readiness

## URLs
- **Production**: https://your-project.pages.dev
- **GitHub**: https://github.com/username/webapp

## Data Architecture
- **Data Models**: Schools, Users, Roles, Permissions, Academic Years, Classes, Sections, Students, Subjects, Student Subjects, Grades, Grade Settings, Result Cards, Student Fees, Fee Payments, Fee Receipts, Treasury Transactions, Daily Closings, Employees, Salaries
- **Storage Services**: Cloudflare D1 (SQLite)
- **Data Flow**: React frontend → Hono API → D1 Database

## Tech Stack
- **Frontend**: React 19 + Vite + TailwindCSS + Lucide React + QRCode.react
- **Backend**: Hono (Cloudflare Pages Worker)
- **Database**: Cloudflare D1 (SQLite-compatible)
- **Auth**: JWT Bearer Token via Web Crypto API (HMAC-SHA-256)
- **Password Hash**: Versioned PBKDF2-HMAC-SHA256 (210,000 iterations, random salt per password); legacy SHA-256 hashes migrate on successful login
- **Deploy**: Cloudflare Pages via Wrangler

## Completed Phases
- **Phase 1**: Auth, Schools, Users, Roles & Permissions
- **Phase 2**: Students, Classes, Sections, Subjects, Student Subjects
- **Phase 3**: Student Subjects assignment workflow
- **Phase 4**: Grades & Academic Calculations
- **Phase 5**: Analytics Dashboard
- **Phase 6**: Result Cards with QR Verification
- **Phase 7**: Student Fees & Financial Receipts with QR Verification
- **Phase 8**: Treasury Module (daily closings, compensating rollback)
- **Phase 9**: Employees & Salaries Module
- **Phase 10**: Production Readiness, Deployment, Demo Data, Documentation

## Quick Start (Local Development)

```bash
# 1. Reset local D1 and seed
cd /home/user/webapp
npm run db:reset

# 2. Start dev server
npm run dev

# 3. Open http://localhost:5173
```

## Demo Login Credentials

> Local development and QA only. Never seed these demo accounts or reuse these passwords in production.

| Role | Email | Password |
|------|-------|----------|
| System Admin | admin@smart-school.iq | admin123 |
| Principal (مدرسة النخبة) | principal@nukhba.iq | school123 |
| Teacher (مدرسة النخبة) | teacher@nukhba.iq | teacher123 |
| Owner (مدرسة الرافدين) | owner@rafidain.iq | owner123 |
| Accountant (مدرسة الرافدين) | accountant@rafidain.iq | accountant123 |
| Registrar (inactive) | registrar@eman.iq | registrar123 |

## Public Verification Routes (No Login Required)
- Result Card: `/verify/result-card/:token`
- Receipt: `/verify/receipt/:token`
- Official Book: `/verify/official-book/:token`

## Deployment
- **Platform**: Cloudflare Pages
- **Status**: Production Ready
- **Last Updated**: 2026-05-27

## Documentation
- See `DEPLOYMENT.md` for full deployment steps
- See `ENVIRONMENT.md` for environment variables and secrets
- See `DEMO_CHECKLIST.md` for demo walkthrough
- See `PROJECT_HANDOFF.md` for technical handoff
