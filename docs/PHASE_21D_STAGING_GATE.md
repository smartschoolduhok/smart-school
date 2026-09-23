# Phase 21D — STAGING gate (prepared; remote execution pending)

Prepared: 2026-09-23. This is an execution checklist, not evidence that STAGING was changed. The local implementation and tests are recorded in [PHASE_21D_HOMEWORK_QA.md](PHASE_21D_HOMEWORK_QA.md). Draft [PR #52](https://github.com/smartschoolduhok/smart-school/pull/52) remains open; the implementation tree last checked during preparation was `2ff7fa9be4ec48ef046d9f55bbb82a693b94a518`.

## Fixed scope and stop conditions

| Item | Intended target / expectation |
|---|---|
| Pages project | `smart-school-staging`; test an immutable Preview from PR #52 |
| D1 | `DB` → `smart-school-staging-db`, UUID `1bdb9c3d-08d6-4023-9cbc-64369d53198a` |
| Migration | Only `0041_homework.sql`; no seed or reset |
| R2 | Proposed new private bucket `smart-school-homework-staging`, binding `HOMEWORK_FILES` for Pages **Preview** only; check account/bucket ownership and name availability first |
| QA | School `2` only, with a unique marker; schools `1` and `3` are protected comparators |
| Excluded | Production resources, Pages production deployment, merge, auto-merge, destructive fixture deletion, public bucket access |

Remote D1 reads/exports, bucket creation, binding changes and migration application require an explicit STAGING authorization for this gate. The Cloudflare dashboard could not be inspected during preparation because this browser repeatedly returned its human-verification page. No live R2 inventory, D1 status or Cloudflare account identity has been confirmed on 2026-09-23. A stale historical STAGING snapshot is not a substitute for fresh preflight.

Stop if the account, resource UUID, project, PR implementation tree, migration contents or number of pending migrations differs from the approved target; if the R2 name already exists and ownership is uncertain; if the backup cannot be restored exactly; or if the pre-write drift check differs. Do not broaden the migration set to make `wrangler d1 migrations apply` succeed. Record the actual SHA and evidence in the QA document once the gate runs.

## Gate sequence after authorization

1. **Pin the release.** Review PR #52, the exact migration bytes, `git diff --check`, Quality Gates, and the immutable Preview's commit. Verify Cloudflare account identity and that `wrangler.jsonc` still contains exactly the D1 binding above and no Production target. List R2 buckets read-only; select the proposed name only if unused and the account is correct. Preserve a dated evidence folder outside Git.
2. **Read-only D1 preflight.** Check `d1_migrations` names in order against the 41 migration files through `0040_staff_attendance.sql`; require 41 unique history rows and only `0041_homework.sql` pending. Capture `sqlite_schema`, all historical table/column names and SQLite storage types, complete row multisets (not merely counts), `PRAGMA foreign_key_check` (zero rows), and all existing readiness views. Expect 78 counted tables including `d1_migrations` and `sqlite_sequence`, or 76 application tables. Preserve existing readiness values as a baseline; earlier STAGING had accepted historical inconsistencies, so do not insist that every view says `healthy`.
3. **Backup and rehearsal.** Export the *whole* STAGING D1 to a timestamped SQL file outside Git; record byte length and SHA-256. Restore it into an isolated local D1 and verify exact logical schema, column definitions, SQLite storage types, values and complete row multisets against the read-only snapshot. Use `scripts/lib/local-d1-restore.mjs` for SQL splitting at statement boundaries and parameter binding of the oversized `import_jobs` row. Apply *only* `0041_homework.sql` to this populated local restoration; require 42 unique migrations, `0041` last and once, five new homework tables, 83 counted/81 application tables, clean foreign keys, unchanged historical application rows and unchanged historical readiness. Keep the restoration and evidence outside Git.
4. **Pre-write drift check.** Re-export STAGING immediately before the first write; compare bytes and SHA-256 with the approved backup and repeat the migration-pending query. If anything changed, stop and re-baseline instead of applying the rehearsed migration.
5. **Provision and migrate.** Create the private R2 bucket only on the verified Smart School account. Leave public access and custom domains disabled. Apply `0041_homework.sql` only to the identified STAGING D1 after the guard passes. Verify 42 distinct migration names, last/once `0041`, none pending, exactly the five expected new tables, 83 counted/81 application tables, zero FK violations, unchanged pre-existing rows and readiness baselines. Capture the migration start/end times, Wrangler output and evidence hashes.
6. **Attach to the Preview and test.** Once the bucket exists, add a Pages `env.preview.r2_buckets` binding named `HOMEWORK_FILES` to the reviewed config and let the Git-integrated PR Preview build. Cloudflare documents that a Preview config applies to **all** Preview deployments of the project, not one branch; check other Preview users before changing it. Do not put the bucket in the root or `env.production` config. Pages must redeploy for the binding to take effect. Verify the immutable deployment commit/tree and function binding before authenticated QA.
7. **Authenticated QA in school 2.** Reuse a suitable active teaching load/student where possible and label any necessary parent/teacher accounts and links with a unique marker. Verify draft/edit/publish/withdraw/correction, student audience and notification fan-out, idempotency and optimistic revision, protected upload/download and parent-link revocation, spoofed files and size limits, normal R2 removal, cross-school/teacher isolation, accountant denial, Arabic RTL at 390 px, and zero unexpected console/network failures. Keep the retry-on-R2-failure proof in the local test suite; do not cause a remote storage outage for QA. Check that no grade, fee, treasury, payroll or attendance rows were created. Preserve historical homework/audit rows; deactivate or archive labelled QA identities and links without business-row deletion. Reconcile active R2 keys with attachment metadata and investigate any orphan before closure.
8. **Final audit and reporting.** Compare all pre-existing school-1/3 table rows and SQLite types to the pre-write snapshot, as in Phase 21C. Save QA transcript, R2 object inventory/hash metadata, protected-data comparison and final D1 export outside Git; update the QA document, PR description and Notion with actual hashes, counts, URLs, results and any deviations. Leave PR Draft until reviewed. No Production access or deployment follows automatically.

Example read-only commands for the approved account and reviewed checkout (use the local `wrangler` version pinned by `npm ci`):

```bash
npx wrangler whoami
npx wrangler r2 bucket list
npx wrangler d1 migrations list DB --remote --config wrangler.jsonc
npx wrangler d1 execute DB --remote --command 'SELECT id,name,applied_at FROM d1_migrations ORDER BY id' --config wrangler.jsonc
npx wrangler d1 execute DB --remote --command 'PRAGMA foreign_key_check' --config wrangler.jsonc
npx wrangler d1 export DB --remote --output <absolute-external-backup-path.sql> --config wrangler.jsonc
```

The separate Preview-only binding to review after the bucket is actually verified and created is:

```jsonc
"env": {
  "preview": {
    "r2_buckets": [{ "binding": "HOMEWORK_FILES", "bucket_name": "smart-school-homework-staging" }]
  }
}
```

This is a proposed excerpt, not the current `wrangler.jsonc`. Its actual effect must be checked on the immutable Preview. Cloudflare's Pages configuration file is the source of truth when present; the dashboard cannot be assumed to override the same fields. The SQL backup does **not** back up R2 objects. If a post-write gate fails, stop new writes and retain the D1 export, R2 contents and timestamps for a deliberate recovery decision; do not run an automatic import or object purge over new history.

Sources: [Cloudflare Pages Wrangler configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/), [Pages bindings](https://developers.cloudflare.com/pages/functions/bindings/), [D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/), [R2 bucket creation](https://developers.cloudflare.com/r2/buckets/create-buckets/).
