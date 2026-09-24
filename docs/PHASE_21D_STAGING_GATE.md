# Phase 21D — STAGING gate (steps 1–4 passed; blocked before remote writes)

Prepared: 2026-09-23; partially executed: 2026-09-23/24. The local implementation and tests are recorded in [PHASE_21D_HOMEWORK_QA.md](PHASE_21D_HOMEWORK_QA.md). Draft [PR #52](https://github.com/smartschoolduhok/smart-school/pull/52) remains open. Execution pinned the authorized commit `d169df3ac97c9a91c7b84753698f7b8fb7796a78` and tree `a9861b34e4599987bcfab04179516774e1149014`.

## Execution record — stopped before step 5

The explicit STAGING-only authorization was used for read-only D1 inspection and export, local restore/rehearsal, and the final pre-write drift guard. The verified Cloudflare account was `8d30029482b5722704371f03169c5ca1` (`smartschool.duhok@gmail.com`); the Pages project, D1 name/UUID, Draft PR HEAD/tree and immutable Preview source all matched the approved scope.

| Gate | Actual evidence |
|---|---|
| Remote D1 preflight | `41` distinct migrations ending at `0040_staff_attendance.sql`; only `0041_homework.sql` pending; `78` counted / `76` application tables; zero FK violations; all seven readiness views captured without redefining their accepted historical values |
| Typed snapshot | Full schema, columns, SQLite storage types, values and row multisets captured; snapshot SHA-256 `5a8c437a4a7f07abda120cd822e06297d779dc19ad7732f7399d423477833204` |
| Backup | `SmartSchoolBackups/phase-21d-staging-20260923T213116Z/smart-school-staging-db-20260923T213116Z.sql`; `1,509,194` bytes; SHA-256 `2B0584503FE159A77B4C0F736E92E6AF972A2EEEB840CFE5EBE04C4F4B9299BE` |
| Local restore | Exact equality to the remote typed snapshot across all `78` historical tables. The export contained `2,442` statements; the single oversized `import_jobs` row was restored with `16` bound parameters totaling `360,514` bytes |
| Local `0041` rehearsal | Migration SHA-256 `36D432D2C1AE18ABC6E4A3B08BC3BD625C972D5695BD9C199ECE6D20F1462C16`; exactly once and last; `42` migrations, the five expected tables, `83` counted / `81` application tables, clean FK, unchanged historical rows/types/values and unchanged readiness |
| Immediate pre-write guard | Re-exported at `2026-09-24T14:29:43Z`; byte-for-byte identical to the backup with the same size and SHA-256; `0041_homework.sql` still the only pending migration |
| R2 blocker | `wrangler r2 bucket list` failed on the verified account with Cloudflare API code `10042`: `Please enable R2 through the Cloudflare Dashboard`. Bucket inventory and proposed-name availability therefore could not be proven |

The stop condition was honored. No R2 bucket was created, no D1 migration was applied remotely, no `HOMEWORK_FILES` binding was added, no Preview configuration was changed, and no authenticated school-2 QA was started. Production, merge, auto-merge, seed/reset and manual deployment were not touched. Evidence, including the blocker log and both SQL exports, remains outside Git in the dated `SmartSchoolBackups` folder.

## Fixed scope and stop conditions

| Item | Intended target / expectation |
|---|---|
| Pages project | `smart-school-staging`; test an immutable Preview from PR #52 |
| D1 | `DB` → `smart-school-staging-db`, UUID `1bdb9c3d-08d6-4023-9cbc-64369d53198a` |
| Migration | Only `0041_homework.sql`; no seed or reset |
| R2 | Proposed new private bucket `smart-school-homework-staging`, binding `HOMEWORK_FILES` for Pages **Preview** only; check account/bucket ownership and name availability first |
| QA | School `2` only, with a unique marker; schools `1` and `3` are protected comparators |
| Excluded | Production resources, Pages production deployment, merge, auto-merge, destructive fixture deletion, public bucket access |

Remote D1 reads/exports, bucket creation, binding changes and migration application required explicit STAGING authorization for this gate; that authorization was granted. Read-only D1 work and the local rehearsal completed, but R2 is not enabled on the verified account, so the gate stopped before its first remote write. A future continuation must repeat the pre-write export/hash comparison and pending-migration check after R2 is enabled.

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
