# ENVIRONMENT.md — Smart School System

## Required Environment Variables

### `JWT_SECRET`
- **Required**: Yes; authentication fails closed when missing or unsafe.
- **Type**: High-entropy string, at least 32 characters.
- **Purpose**: Signing key for eight-hour HS256 JWT sessions.
- **Default**: None.
- **Set locally**: Create an untracked `.dev.vars` file.
- **Set in production**: `npx wrangler pages secret put JWT_SECRET`.
- Never put the real value in `wrangler.jsonc`, documentation, or source control.

### `ALLOWED_ORIGINS`
- **Required for cross-origin browser deployments**: Yes.
- **Type**: Comma-separated HTTP(S) origins without paths.
- **Example**: `https://school.example,https://admin.school.example`.
- Same-origin requests do not require this variable.

### `APP_ENV`
- Set to `production` in Cloudflare.
- Values `development`, `test`, and `local` additionally allow the explicit localhost origins used by local development.

## Optional / Configurable

### `DATABASE_NAME`
- Currently hardcoded in `wrangler.jsonc` as `smart-school-db`.
- Change it in both `wrangler.jsonc` and package scripts if renamed.

## Local Development Files

### `.dev.vars`
Not committed to git. Create locally with your own values:

`JWT_SECRET=<generate-a-random-value-of-at-least-32-characters>`
`APP_ENV=development`
`ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000`

Obvious placeholders are rejected, so replace the example value before starting the worker.

### `.wrangler/state/v3/d1/`
Auto-generated local SQLite database. It can be recreated by applying migrations and the local demo seed.

## Files That MUST NOT Be Committed

- `node_modules/`
- `.wrangler/`
- `.dev.vars`
- `dist/`
- logs, backups, and editor state

## Production Checklist

- [ ] `JWT_SECRET` set with `wrangler pages secret put`
- [ ] `APP_ENV=production`
- [ ] `ALLOWED_ORIGINS` contains only approved origins
- [ ] `wrangler.jsonc` has the real D1 database ID but no secret
- [ ] All migrations through `0016_auth_security.sql` applied
- [ ] `seed.sql` was **not** loaded into the production database

## Database Bindings

| Binding | Service | Database |
|---|---|---|
| `DB` | Cloudflare D1 | `smart-school-db` |

No KV or R2 bindings are currently used.

## CORS behavior

The worker uses an explicit origin policy. Approved origins receive their exact origin in `Access-Control-Allow-Origin`; unknown origins receive 403 without a permissive CORS header. Wildcard origins and credentialed CORS are not combined.
