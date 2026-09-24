# Phase 21D — Homework — Contract and QA Plan

## Status and authorization

Phase 21D is implemented on `codex/phase-21d-homework`, based on `main@abc56f1899ac94987630f32b74781587025fdbf7`, and is open for review in [Draft PR #52](https://github.com/smartschoolduhok/smart-school/pull/52). STAGING-only execution was explicitly authorized on 2026-09-23 for the fixed Pages/D1/R2 targets and extended on 2026-09-24 with a mandatory account budget check and fail-closed 1 GB attachment-store ceiling; Production and merge remained excluded.

The gate pinned the authorized starting HEAD `d169df3ac97c9a91c7b84753698f7b8fb7796a78` and tree `a9861b34e4599987bcfab04179516774e1149014`. Read-only D1 preflight, the external backup, exact local restore, local `0041` rehearsal, the quota-guard implementation at `39cf7c0e5627a41b7f747f67e3cbef80f94c2b8c`, and the immediate pre-write drift check passed. The private bucket was created, only `0041` was applied remotely, and the Preview-only binding deployed automatically. Authenticated QA then stopped on a false `409 homework_stale` response after D1 had committed publication.

The authorization does not include:

- accessing or deploying Production;
- merging or enabling auto-merge.

## STAGING gate evidence — 2026-09-23/24

- Account: `smartschool.duhok@gmail.com`, Cloudflare account ID `8d30029482b5722704371f03169c5ca1`.
- Target: Pages `smart-school-staging`; D1 `smart-school-staging-db` / `1bdb9c3d-08d6-4023-9cbc-64369d53198a`; private R2 `smart-school-homework-staging`; immutable Preview source `39cf7c0` at `36514216.smart-school-staging.pages.dev`.
- Preflight: `41` distinct migrations through `0040`, only `0041_homework.sql` pending, `78/76` counted/application tables, clean FK, and full typed snapshot hash `5a8c437a4a7f07abda120cd822e06297d779dc19ad7732f7399d423477833204`.
- Backup: `1,509,194` bytes, SHA-256 `2B0584503FE159A77B4C0F736E92E6AF972A2EEEB840CFE5EBE04C4F4B9299BE`, stored outside Git under `SmartSchoolBackups/phase-21d-staging-20260923T213116Z`.
- Local restoration matched the remote schema, columns, SQLite storage types, values and complete row multisets exactly. The oversized `import_jobs` row used `16` bound parameters totaling `360,514` bytes.
- Applying the final `0041` bytes (SHA-256 `0280D23DDBCF1EBC96F03A8653B3C30E0F3512473BBD3F8D2CA7C8022C3C5791`) to the isolated restored D1 produced `42` migrations and `83/81` tables, with the five expected homework tables, clean FK, unchanged historical rows/types/values and unchanged readiness.
- Before the first remote write, Wrangler showed R2 enabled, an empty account bucket inventory and therefore zero stored account bytes; the proposed name was unused. The final pre-write export at `2026-09-24T15:57:00Z` was byte-for-byte identical to the approved backup, and `0041` was still the only pending migration.
- Created `smart-school-homework-staging` as a private bucket with no `r2.dev` or custom-domain publication. Applied only `0041`; remote postflight has `42` migrations, none pending, `83/81` tables, clean FK, all 76 historical application tables unchanged, and snapshot SHA-256 `4ec45c2f3511274daded1aca8f3536a41c37a580911c01dde267da64642c0136`.
- `HOMEWORK_FILES` exists only under `env.preview.r2_buckets`; the same Preview block repeats the D1 binding because bindings are non-inheritable. No manual deployment was used.
- Local homework tests are `20/20`; the full regression matrix is `1598/1598`. TypeScript, builds, audit, local D1 validators, seed and backup/restore all pass. GitHub Quality Gates run `36024156884` and the automatic Pages deployment passed on `39cf7c0`.
- Authenticated school-2 QA used marker `PH21D-39CF7C0-20260924T1604Z`. The total request payload across oversized, spoofed and two valid attachment files was `5,243,002` bytes, below the `100,000,000`-byte QA cap. The one retained object is 56 bytes and matches SHA-256 `902514066257ffbc6438aad93f9e81c792eaaaf89d78449a0386899841b4d174`; the removed key does not exist.
- QA stopped when publish committed the homework, audience and notification but returned `409 homework_stale`. Cleanup withdrawal also committed while returning the same false conflict. All six QA users, both links, the temporary teaching load, subject and employee were soft-disabled; the homework is withdrawn, audit/business rows remain, and credentials were cleared from the external state file.
- Final protected comparison found exact pre-write equality for schools 1 and 3 across 62 school-scoped tables. The only changed historical row is school 2's active timetable revision (`23` to `25`) from creating and soft-disabling the QA load. Final D1 is `42`, none pending, `83/81`, FK clean.
- Not completed after the stop: correction/replacement, full parent notification/link-revocation matrix, all remaining cross-role cases, and browser RTL/390 px QA. Production, merge, auto-merge, force-push, seed/reset and manual deployment were not touched.

## Product boundary

Homework is anchored to the canonical active teaching load: school, academic year, class, section, subject, and teacher employee. Teachers may operate only their linked active loads. School management can supervise the school's homework. Parents receive only published homework for students linked to them through an active `parent_student_links` row.

Phase 21D includes protected JPEG, PNG, WebP, and PDF attachments. Student submission, marking, official grades, conversations, external messaging, mobile apps, and offline mode are out of scope.

## Lifecycle

`draft -> published -> withdrawn`

- Drafts are private and editable with optimistic revision checks.
- Publishing freezes content, scope, audience, and active attachment metadata.
- A published row is never silently edited.
- Withdrawal is non-destructive and requires an audited reason.
- A correction is a replacement draft linked to the withdrawn homework.
- Published homework, audience snapshots, and audit records cannot be deleted.

## Implemented local migration

`0041_homework.sql` introduces five application tables:

1. `homework_assignments`
2. `homework_attachments`
3. `homework_audience`
4. `homework_audit`
5. `homework_write_guards`

Existing `timetable_teaching_loads`, `teacher_employee_links`, `student_enrollments`, `student_subjects`, `parent_student_links`, `school_notifications`, and `notification_recipients` remain the authoritative scope and delivery sources.

The fresh local chain is `42/42`. It contains `83` counted tables including `d1_migrations` and `sqlite_sequence`, or `81` application tables. The five-table delta is enumerated from the migration; no count was inferred from `sqlite_sequence`.

## Roles

| Role | Scope |
|---|---|
| `system_admin` | Explicit school target; school-wide management |
| `school_owner`, `principal`, `vice_principal` | School-wide management |
| `teacher` | Own active linked teaching loads and own homework |
| `registrar` | Read-only school feed in the first release |
| `parent` | Published homework for currently linked children only |
| `accountant` | No access |

## Attachment contract

- Maximum five active attachments per homework.
- Maximum 5 MiB per file and 20 MiB total.
- Accepted content: JPEG, PNG, WebP, and PDF.
- The server verifies size, declared MIME, and file signature.
- Object keys are random and never exposed as public URLs.
- Every download revalidates session, tenant, role, audience, and current parent link.
- Attachments can be added or soft-removed only while homework is a draft.
- Removal first records `removal_pending`, then deletes the object, then records `removed`; an object-store failure returns `503` and the same endpoint safely retries cleanup.
- A draft with pending object cleanup cannot be published, and the staff UI keeps the pending item visible without offering a stale download.
- The dedicated store has a fail-closed aggregate ceiling of `1,000,000,000` bytes. Before every upload, the app paginates the complete R2 listing and reconciles every key, size and custom-metadata record against each non-removed D1 row. List errors, orphan objects, missing active objects, mismatches and pending cleanup all reject the upload.
- A D1 `upload_pending` reservation is created before `put`, so concurrent requests are serialized by the database trigger and pending/orphan cleanup still consumes budget. A failed write or activation uses compensating cleanup and remains fail-closed if compensation cannot be proven.
- Local tests use an in-memory R2-compatible binding; the real binding exists only in Pages Preview.

## Required API behavior

- `GET /api/homework/scopes`
- `GET /api/homework`
- `POST /api/homework`
- `GET /api/homework/:key`
- `PATCH /api/homework/:key`
- `POST /api/homework/:key/publish`
- `POST /api/homework/:key/withdraw`
- `POST /api/homework/:key/replacement`
- `POST /api/homework/:key/attachments`
- `POST /api/homework/:key/attachments/:attachmentKey/remove`
- `GET /api/homework/attachments/:attachmentKey`
- `GET /api/homework/parent`

## Acceptance matrix

### Tenant and actor isolation

- A teacher cannot list, read, create, edit, publish, withdraw, or download outside the linked active teaching load.
- Raw foreign school/class/section/subject/teacher identifiers fail closed without writes.
- A system administrator must explicitly target a school.
- Accountants receive `403` and have no navigation entry.

### Publication and notifications

- A draft creates no audience and no notification.
- Publish snapshots only eligible active students in the load's year/class/section/subject.
- Scope, draft creation, and publication revalidate the subject's current class/section placement and reject a whole-class load once the class has active sections.
- Publish creates one student notification and all active linked parent recipients without duplication.
- A repeated or stale publish request performs no second write.
- Withdrawal is audited, preserves history, and withdraws related notifications.
- Disabling a parent link immediately removes feed, notification, and attachment access.

### Attachments

- Valid files round-trip through the protected endpoint.
- Invalid signature, MIME, size, count, or total size leaves no object or metadata row.
- A D1 failure after object storage triggers compensating object deletion.
- An object-delete failure leaves retryable metadata in `removal_pending`, blocks publication, and performs no destructive metadata deletion.
- Published attachments cannot be added, removed, renamed, or replaced.
- Unrelated parents, teachers, accountants, and other schools cannot download the file.
- Parent feed and detail responses use an explicit minimal DTO and do not expose school, year, load, class, section, subject, employee, revision, actor, audit, hash, status, or timestamp internals.

### UI

- Teacher, management, registrar, and parent states match their backend rights.
- Draft/publish/withdraw/replacement actions have explicit confirmations and reasons where required.
- Arabic RTL layouts remain usable at 390 px with no horizontal overflow.
- Loading, empty, validation, network error, and stale revision states are visible.
- Positive flows produce zero unexpected console errors or network failures.

### Safety and regression

- The migration applies once on a fresh local D1 and on an isolated populated restore.
- `PRAGMA foreign_key_check` is clean.
- Historical schemas, values, types, and rows remain unchanged across upgrade rehearsal.
- Full regressions, TypeScript, frontend/Worker build, dependency audit, finance seed, backup/restore, official promotion, week setup, and teaching-load validations pass with no skips.
- No grade, fee, treasury, payroll, attendance, or result-card row is created by homework workflows.

## Local implementation evidence — 2026-09-23

### Delivered

- `migrations/0041_homework.sql` adds the five planned tables and database triggers for active-load integrity, actor authority, immutable publication, guarded lifecycle transitions, attachment limits, immutable audience and immutable audit.
- `src/lib/homework.ts` owns validation, limits, signatures, types and safe error mapping.
- `src/lib/homeworkDb.ts` owns all homework routes; `src/worker.ts` only registers the route module and the optional `HOMEWORK_FILES` interface.
- The Arabic RTL page is lazy-loaded at `/homework`; navigation visibility follows `HOMEWORK_VIEW_ROLES`, staff can filter by state/load/date, parents can filter by linked child/timing, and the accountant has no route or menu access.
- Uploads use an optional protected object-store binding. `HOMEWORK_FILES` is configured only for Pages Preview; root and Production remain unbound and fail closed with `503` instead of exposing a public fallback.
- Upload admission reconciles the full bucket against D1 and reserves bytes atomically before `put`. The database enforces the same `1,000,000,000`-byte aggregate ceiling across active, upload-pending and removal-pending rows.
- Draft creation and publication now revalidate the complete canonical teaching load, including subject placement and the whole-class-versus-active-sections rule, in API queries, guarded publish SQL, and database triggers.
- Parent endpoints serialize only the documented presentation DTO. Attachment deletion is a retryable `active → removal_pending → removed` flow and publication fails closed while cleanup is pending.

### Focused proof

- Homework tests: `20/20`, zero failures and zero skips.
- Covered: role/school isolation, explicit system-admin targeting, complete canonical-load drift, whole-class load invalidation, optimistic revision, spoofed-file rejection, fail-closed full-bucket reconciliation, orphan detection, concurrent reservations at the exact 1 GB boundary, pending-cleanup accounting, compensating upload cleanup, retryable object-delete cleanup, publication blocking while cleanup is pending, minimal parent DTOs, guarded/idempotent publish, in-boundary roster/load race rollback, current parent-link revocation, protected download, audited withdrawal and unique audited replacement.
- UI/static contract verifies Arabic RTL, `390px`-safe classes, route/sidebar role wiring, all protected API paths, accepted MIME signatures and migration immutability markers.

### Full local gates

- Full regression matrix after quota hardening: `1598/1598`, zero failures and zero skips.
- TypeScript: PASS.
- Frontend and Worker production builds: PASS.
- `npm audit --audit-level=low`: PASS, zero vulnerabilities.
- Genuine local D1 validators for finance, week setup, teaching-load matrix, finance seed and official promotion: PASS.
- Fresh local D1: `42` migrations; `PRAGMA foreign_key_check` empty.
- Backup/restore: exact schema, columns, SQLite types, values and complete row multisets across `83` counted tables; final logical schema SHA-256 is `2D6879E0650CC4665490E7F6AE8A2B41AA46FE1551E10EE7771B9D8571DEA7AB`, and the local export is `768,475` bytes. The `360,009`-byte `import_jobs` text round-tripped through parameter binding with matching hash.
- As the exported schema now exceeds Wrangler's single SQL-file boundary, the restore utility splits base SQL only at parsed statement boundaries into three local chunks; each chunk remains local and the final complete snapshot is identical.

### Explicitly not performed

- No Production access or deployment.
- No manual Pages deployment.
- No merge, auto-merge or force-push.
- No seed/reset or destructive deletion of homework, attachment metadata or audit rows.
- No continuation of functional or browser QA after the false remote conflict response.

## Remote gate disposition

The authorized STAGING infrastructure and migration steps completed. The gate is stopped, not passed, because remote publish and withdraw returned `409 homework_stale` after their D1 batches committed. This must be corrected and re-rehearsed locally before a new immutable Preview can finish the unexecuted QA matrix. Do not create another bucket or reapply `0041`.

### Response fix after the QA stop — 2026-09-24

The false conflict came from comparing `DB.batch()` `meta.changes` only after D1 had committed the publish/withdraw transaction. Both routes now enforce stale revision and completed transition with SQL guards **inside** their batches, where a failed `valid = 1` check rolls back the full transaction. A test simulates `meta.changes: 0` on committed batches and confirms HTTP `200` for publish and withdraw, exactly one notification, audited transitions, and a true `409` with no extra audit on a repeated withdrawal. The original roster/load race rollback tests also pass. Focused suite: `21/21`; TypeScript and both builds: PASS. Migration `0041` and the 1 GB R2 guard are unchanged.

The earlier STAGING QA stop remains unresolved until a fresh Preview runs the unfinished school-2 authenticated checks and proves correct HTTP responses. Retain the existing bucket and already-applied migration; compare schools 1 and 3 and R2 again before closing the gate. No Production or merge is authorized.

The scoped execution checklist, evidence hashes, exact stop point, cleanup record and Preview-only R2 binding are in [PHASE_21D_STAGING_GATE.md](PHASE_21D_STAGING_GATE.md). Production remains a separate, ungranted GO decision.
