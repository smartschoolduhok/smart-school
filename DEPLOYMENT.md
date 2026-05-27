# DEPLOYMENT.md — Smart School System

## Prerequisites
- Node.js 20+ and npm
- Cloudflare account with Pages & D1 enabled
- Wrangler CLI authenticated (`npx wrangler login`)

## 1. Cloudflare D1 Setup (Production)

```bash
# Create production D1 database (one time)
npx wrangler d1 create smart-school-db

# Copy the returned database_id into wrangler.jsonc:
# "database_id": "YOUR-REAL-DATABASE-ID"
```

**Important**: The `wrangler.jsonc` currently has a placeholder ID:
```jsonc
"database_id": "00000000-0000-0000-0000-000000000000"
```
Replace with your real production ID before deploying.

## 2. Environment Variables

Create `.dev.vars` for local development:
```
JWT_SECRET=your-local-dev-secret-min-32-chars-long
```

Set production secrets via Wrangler:
```bash
npx wrangler pages secret put JWT_SECRET
```

## 3. Run Migrations (Local)

```bash
# Clean reset: delete local DB, re-apply migrations, seed data
npm run db:reset

# Or step by step:
npm run db:migrate   # Apply all migrations in migrations/
npm run db:seed      # Run seed.sql demo data
```

## 4. Run Migrations (Production)

```bash
# Apply migrations to production D1
npx wrangler d1 migrations apply smart-school-db

# Seed production (optional — use only for demo instance)
npx wrangler d1 execute smart-school-db --file=./seed.sql
```

## 5. Local Development

```bash
# Option A: Vite dev server (frontend only, no D1)
npm run dev

# Option B: Full local Cloudflare Pages (frontend + D1 worker)
npx wrangler pages dev dist --d1=smart-school-db --local --ip 0.0.0.0 --port 3000

# Option C: Build first, then serve with wrangler
npm run build
npx wrangler pages dev dist --d1=smart-school-db --local --ip 0.0.0.0 --port 3000
```

## 6. Build for Production

```bash
npm run build
```

This runs:
1. `vite build` — builds the React SPA frontend into `dist/`
2. `vite build --config vite.worker.config.ts` — builds the Hono worker into `dist/_worker.js`

## 7. Deploy to Cloudflare Pages

```bash
# Deploy the dist/ directory
npx wrangler pages deploy dist
```

Or using the npm script:
```bash
npm run deploy
```

## 8. Verify Deployment

1. Visit `https://<your-project>.pages.dev/login`
2. Login with `admin@smart-school.iq` / `admin123`
3. Check `/api/auth/me` returns user data
4. Verify `/api/schools` returns school list
5. Test a public verification route: `/verify/result-card/test` (should show not found, not 404 page)

## 9. Migration Files (in order)

| File | Description |
|------|-------------|
| `migrations/0001_initial_schema.sql` | Core tables: schools, users, roles, permissions, modules, academic_years |
| `migrations/0002_phase2_academic_tables.sql` | Classes, sections, students, subjects |
| `migrations/0003_student_subjects.sql` | Student subject assignments |
| `migrations/0004_phase4_grades.sql` | Grades, grade settings, calculations |
| `migrations/0005_general_exemption_settings.sql` | General exemption configuration |
| `migrations/0006_result_cards_qr.sql` | Result cards with QR verification |
| `migrations/0007_fees_receipts.sql` | Student fees, payments, receipts |
| `migrations/0008_fees_discount.sql` | Fee discount support |
| `migrations/0009_treasury.sql` | Treasury transactions, daily closings |
| `migrations/0010_employees.sql` | Employees, salaries, salary payments |

## 10. Database Reset (Danger — Local Only)

```bash
npm run db:reset
```

This:
1. Deletes `.wrangler/state/v3/d1/`
2. Re-applies all 10 migrations
3. Runs seed.sql with demo data

## Known Deployment Limitations
- `database_id` in wrangler.jsonc must be updated for production
- JWT_SECRET must be set as a Pages secret before first deploy
- D1 is SQLite — no `AUTO_INCREMENT` (use `INTEGER PRIMARY KEY`)
- First migration may need `--skip-execution` if database already has tables
