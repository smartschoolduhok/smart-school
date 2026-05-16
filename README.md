# نظام المدرسة الذكي — Smart School System

## Project Overview
- **Name**: نظام المدرسة الذكي
- **Goal**: Multi-school SaaS platform for school management with Arabic RTL UI
- **Features**: Schools, Users, Roles, Students, Classes, Subjects, Grades, Analytics, Result Cards, Fees & Receipts, QR Verification

## URLs
- **Production**: https://your-project.pages.dev
- **GitHub**: https://github.com/username/webapp

## Data Architecture
- **Data Models**: Schools, Users, Roles, Permissions, Academic Years, Classes, Sections, Students, Subjects, Student Subjects, Grades, Grade Settings, Result Cards, Student Fees, Fee Payments, Fee Receipts
- **Storage Services**: Cloudflare D1 (SQLite)
- **Data Flow**: React frontend → Hono API → D1 Database

## User Guide
1. Login with your credentials
2. Navigate modules via the sidebar
3. Use the Fees module to manage student fees, payments, and receipts
4. Generate receipts with QR codes for verification
5. Public verification pages work without login

## Deployment
- **Platform**: Cloudflare Pages
- **Status**: Active
- **Tech Stack**: Hono + TypeScript + TailwindCSS + React + Vite
- **Last Updated**: 2026-05-16

## Phase History
- **Phase 1**: Auth, Schools, Users, Roles
- **Phase 2**: Students, Classes, Sections, Subjects, Student Subjects
- **Phase 3**: Student Subjects assignment
- **Phase 4**: Grades & Academic Calculations
- **Phase 5**: Analytics Dashboard
- **Phase 6**: Result Cards with QR Verification
- **Phase 7**: Student Fees & Financial Receipts with QR Verification

## Phase 7 Details
- Database tables: `student_fees`, `fee_payments`, `fee_receipts`
- API routes: `/api/student-fees`, `/api/fee-payments`, `/api/fee-receipts`, `/api/verify/receipt/:token`
- Frontend: `FeesPage.tsx` with 5 tabs (list, add, payments, receipts, verify)
- Public verification: `ReceiptVerificationPage.tsx` with Arabic-Indic digits
- QR codes via `qrcode.react`
- RBAC: Only system_admin, school_owner, principal, vice_principal, accountant, registrar can manage fees
