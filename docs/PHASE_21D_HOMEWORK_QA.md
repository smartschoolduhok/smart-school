# Phase 21D — Homework — Contract and QA Plan

## Status and authorization

Phase 21D is implemented locally on `codex/phase-21d-homework`, based on `main@abc56f1899ac94987630f32b74781587025fdbf7`. Authorization remains limited to local implementation, the feature branch, and a Draft PR.

The authorization does not include:

- creating or binding a remote R2 bucket;
- applying `0041_homework.sql` to STAGING;
- accessing or deploying Production;
- merging or enabling auto-merge.

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
- Local tests use an in-memory R2-compatible binding. A remote STAGING bucket needs separate approval.

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
- Publish creates one student notification and all active linked parent recipients without duplication.
- A repeated or stale publish request performs no second write.
- Withdrawal is audited, preserves history, and withdraws related notifications.
- Disabling a parent link immediately removes feed, notification, and attachment access.

### Attachments

- Valid files round-trip through the protected endpoint.
- Invalid signature, MIME, size, count, or total size leaves no object or metadata row.
- A D1 failure after object storage triggers compensating object deletion.
- Published attachments cannot be added, removed, renamed, or replaced.
- Unrelated parents, teachers, accountants, and other schools cannot download the file.

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

## Local implementation evidence — 2026-09-22

### Delivered

- `migrations/0041_homework.sql` adds the five planned tables and database triggers for active-load integrity, actor authority, immutable publication, guarded lifecycle transitions, attachment limits, immutable audience and immutable audit.
- `src/lib/homework.ts` owns validation, limits, signatures, types and safe error mapping.
- `src/lib/homeworkDb.ts` owns all homework routes; `src/worker.ts` only registers the route module and the optional `HOMEWORK_FILES` interface.
- The Arabic RTL page is lazy-loaded at `/homework`; navigation visibility follows `HOMEWORK_VIEW_ROLES`, staff can filter by state/load/date, parents can filter by linked child/timing, and the accountant has no route or menu access.
- Uploads use an optional protected object-store binding. No binding was added to `wrangler.jsonc`, so environments without an explicitly approved store fail closed with `503` instead of exposing a public fallback.

### Focused proof

- Homework tests: `15/15`, zero failures and zero skips.
- Covered: role/school isolation, explicit system-admin targeting, active teacher-link/load scope, optimistic revision, spoofed-file rejection, compensating cleanup after metadata or ambiguous object-store failure, guarded/idempotent publish, in-boundary roster/load race rollback, current parent-link revocation, protected download, audited withdrawal and unique audited replacement.
- UI/static contract verifies Arabic RTL, `390px`-safe classes, route/sidebar role wiring, all protected API paths, accepted MIME signatures and migration immutability markers.

### Full local gates

- Full regression matrix after adding Phase 21D: `1593/1593`, zero failures and zero skips.
- TypeScript: PASS.
- Frontend and Worker production builds: PASS.
- `npm audit --audit-level=low`: PASS, zero vulnerabilities.
- Genuine local D1 validators for finance, week setup, teaching-load matrix, finance seed and official promotion: PASS.
- Fresh local D1: `42` migrations; `PRAGMA foreign_key_check` empty.
- Backup/restore: exact schema, columns, SQLite types, values and complete row multisets across `83` counted tables; final logical schema SHA-256 is `027B36F4735DA566614B3C52F0F0CA131DB30D511468DE4ABC483C52787A61F1`. The `360,009`-byte `import_jobs` text round-tripped through parameter binding with matching hash.
- As the exported schema now exceeds Wrangler's single SQL-file boundary, the restore utility splits base SQL only at parsed statement boundaries into three local chunks; each chunk remains local and the final complete snapshot is identical.

### Explicitly not performed

- No remote R2 resource or binding.
- No application of `0041` to STAGING.
- No remote D1 read or write.
- No manual deployment, Production access, merge, auto-merge or force-push.

## Remote gate (not authorized yet)

After local acceptance and Draft PR review, a separate explicit authorization is required for immutable Preview attachment infrastructure, STAGING R2, D1 backup/restore, and application of `0041` only. Production remains a separate GO decision.
