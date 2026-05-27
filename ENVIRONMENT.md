# ENVIRONMENT.md — Smart School System

## Required Environment Variables

### `JWT_SECRET`
- **Required**: Yes
- **Type**: String (minimum 32 characters recommended)
- **Purpose**: Signing key for JWT Bearer tokens via HMAC-SHA-256
- **Default in dev**: `default-dev-secret-change-me` (insecure — change!)
- **Set locally**: Create `.dev.vars` file with `JWT_SECRET=your-secret`
- **Set in production**: `npx wrangler pages secret put JWT_SECRET`

## Optional / Configurable

### `DATABASE_NAME`
- Currently hardcoded in `wrangler.jsonc` as `smart-school-db`
- Change in both `wrangler.jsonc` and `package.json` scripts if renamed

## Local Development Files

### `.dev.vars`
Not committed to git. Create locally:
```
JWT_SECRET=local-dev-secret-2026-smart-school
```

### `.wrangler/state/v3/d1/`
Auto-generated local SQLite database. Safe to delete (will be recreated).

## Files That MUST NOT Be Committed (in .gitignore)
- `node_modules/`
- `.wrangler/`
- `.dev.vars`
- `dist/` (built output)
- `*.log`
- `*.bak`, `*.backup`

## Secrets Checklist for Production

- [ ] `JWT_SECRET` set via `wrangler pages secret put`
- [ ] `wrangler.jsonc` has real `database_id` (not placeholder)
- [ ] Migrations applied to production D1
- [ ] Seed data loaded only on demo instance (not production with real data)

## Database Bindings

| Binding | Service | Table Name |
|---------|---------|------------|
| `DB` | Cloudflare D1 | `smart-school-db` |

No KV or R2 bindings currently used.

## CORS Configuration
Worker CORS is configured in `src/worker.ts`:
```typescript
app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))
```
For production, tighten `origin` to your actual domain.
