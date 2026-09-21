# Phase 21A — Per-lesson student attendance

Date: 2026-09-20

Base: `54f29ff` (`main`, merged PR #48)

Branch: `codex/phase-21a-lesson-attendance`

Status: implementation, STAGING migration, authenticated Preview QA, responsive correction, soft cleanup and final postflight completed; PR #49 was subsequently merged into `main` as commit `deb5125`.

## 1. Scope

This phase adds attendance for each official timetable lesson. It deliberately does not add school-gate NFC/QR scans; those remain a separate phase so gate attendance and lesson attendance cannot be confused.

Delivered behavior:

- teachers see only lessons in their active timetable load and only after their user is linked to an active teacher employee;
- management and registrars can supervise the school's lessons, while system administrators must choose an explicit school;
- each lesson roster comes from active annual enrollment and the student's active subject assignments;
- statuses are present, absent, excused absence, late, left early and school activity;
- late minutes and a free-text note can be recorded for each student;
- every note is explicitly either staff-only or visible to the parent;
- a draft remains private, and confirmation is the publication boundary for the linked parent;
- teachers cannot change a confirmed lesson; management correction requires a reason and is audited;
- the parent feed contains only active linked children, confirmed sessions and parent-visible notes;
- the Arabic RTL interface uses responsive cards rather than a wide attendance table.

## 2. Data integrity and authorization

Migration `0038_lesson_attendance.sql` adds sessions, student records, immutable audit history and an optimistic-write guard. A session stores timetable, class, section, subject, teacher and time snapshots so later timetable edits do not rewrite history.

The API rechecks tenant, role, active academic year, official timetable day, teacher link, roster and expected revision. The final D1 batch repeats the timetable, teacher authority and roster checks. If placement, teacher linkage or revision changes between reading and writing, the checked guard aborts and rolls back the complete batch.

Confirmed sessions cannot return to draft. Parent responses do not expose staff-only notes, creator/updater IDs, correction reasons or audit metadata.

## 3. Routes

- `GET /api/attendance/lessons`
- `GET /api/attendance/lessons/:entryId`
- `PUT /api/attendance/lessons/:entryId`
- `GET /api/attendance/parent`
- UI: `/attendance`

## 4. Automated evidence

- focused attendance API and UI contract suite: `16/16` PASS, including the 390 px shrink regression;
- full regression matrix: `1551/1551` PASS, zero failure and zero skip;
- RBAC suite: `104/104` PASS;
- resource-access suite: `20/20` PASS;
- teaching-load matrix: `117/117` PASS;
- TypeScript: PASS;
- frontend and Worker production builds: PASS;
- `npm audit --audit-level=low`: zero vulnerabilities;
- fresh local D1 chain: `39` migrations;
- local backup/restore: exact snapshot across `66` tables, foreign keys clean, and the `360,009`-byte oversized row restored;
- local official promotion: `12` checks PASS;
- local finance D1: `39` checks PASS;
- local week setup and teaching-load matrix D1 validations: PASS;
- `git diff --check`: PASS.

The focused API tests cover tenant isolation, teacher-load scoping, active roster derivation, draft privacy, confirmation, linked-child visibility, staff-note suppression, audited corrections, stale revision rollback, placement-change rollback, teacher-link revocation rollback, malformed status rejection and excessive parent date ranges.

## 5. STAGING preflight, backup and restore rehearsal

The operation started from remote branch `codex/phase-21a-lesson-attendance` at exact SHA `e6cc25e40542ba37b1ca1dd4a056010821e758a5`. The only configured D1 binding was verified as:

- name: `smart-school-staging-db`;
- UUID: `1bdb9c3d-08d6-4023-9cbc-64369d53198a`;
- preflight migration history: `38`, ending at `0037_timetable_teacher_collision_visibility.sql`;
- pending before migration: exactly `0038_lesson_attendance.sql`;
- foreign-key violations: `0`;
- complete typed preflight snapshot hash: `b1a9f882d1d464758b9e5f4bb44c12c2e6c084f18776cf87afaa441b87b64c3c`.

The only pre-existing readiness exceptions were unchanged from the authorized baseline: school 3 academic-grade policy readiness was `partial` with `2/6` classes configured, and school 1 result-card publication was `inconsistent` with `22` cards (`6` draft, `4` published, `12` withdrawn). Finance, payroll and promotion readiness checks remained healthy.

The full pre-migration export is `C:\Users\ibrah\Documents\SmartSchoolBackups\phase21a-staging-20260920T083621Z\smart-school-staging-db-full-before-0038.sql`, size `1,436,375` bytes, SHA-256 `979D7BC063B4B237AF20E0DED93C4A6A247F95FC72009249375E8059A172A13B`.

The export was restored locally before any STAGING migration write: `2,307` statements were restored, including one `360,514`-byte oversized row through parameter binding. Schema, values, SQLite types and counts matched the remote preflight across all `62` tables, and the restored snapshot hash was identical. Applying `0038` once to that local restore produced `39` migrations, no pending migration, `66` tables and a clean foreign-key check.

## 6. STAGING migration result

After a fresh identity, pending-list and readiness gate, only `0038_lesson_attendance.sql` was applied to the named STAGING database. It was recorded once as migration `39` at `2026-09-20 08:42:56` UTC.

Postflight confirmed:

- migration history `39/39`, with `0038` last and pending `0`;
- foreign-key violations `0` and write-guard rows `0`;
- four new tables, seven new indexes and six new triggers;
- all four attendance tables initially empty;
- all `60` pre-existing application tables unchanged, with only the expected D1 migration bookkeeping change;
- readiness identical to preflight.

## 7. Labelled QA fixture

Marker: `PH21A-QA-20260920T084649Z-2D3056`. All data was created only in school `2`, academic year `3`, for Sunday `2026-09-20`.

Reused verified records:

- teacher employee `25`, subject `135`, class `3`, section `3`;
- timetable entry `6`, slot `50`, teaching load `149`.

Created records:

- temporary users: teacher `42`, registrar `43`, parent `44`;
- teacher-employee link `2`;
- students `69` and `70`;
- enrollments `74` and `75`;
- student-subject assignments `435` and `436`;
- parent-student link `10`, linking the parent only to student `69`;
- isolation teacher employee `26`, subject `137`, load `151`, entry `8`;
- isolated attendance class `28`, section `36`, subject `138`, load `152`, entry `9`, slot `51`.

The initial reused group contained one pre-existing student, so it was not written to. The two labelled students were moved to the isolated group before attendance began. Entry `6` remained with zero attendance sessions.

## 8. Authenticated Preview and API QA

Initial authenticated QA used immutable Preview `https://6fab37df.smart-school-staging.pages.dev/`.

Teacher evidence:

- entry `9` was visible and entry `8`, assigned to another teacher, was absent from the list;
- the roster contained exactly students `69` and `70`;
- all six statuses were available;
- late minutes were enabled only for `late`, and clearing `late` reset/disabled the field;
- draft save and confirmation messages were visible;
- `GET` and `PUT` against entry `8` both returned `403 attendance_lesson_forbidden` with no write;
- a teacher write after confirmation returned `409 attendance_already_confirmed` with no write;
- after confirmation every attendance control was read-only.

Management evidence:

- the registrar could see all school lessons, including entry `8`;
- an empty correction reason was rejected in the interface;
- the documented correction changed student `69` from `7` to `9` late minutes;
- audit row `3` recorded the before/after values, registrar user `43` and reason `تصحيح QA موثق PH21A-QA-20260920T084649Z-2D3056`;
- stale revision returned `409 attendance_write_stale` and a missing roster member returned `409 attendance_roster_changed`; complete session, records, audit and guard state was identical before and after both negative tests.

Parent evidence:

- the draft was absent before confirmation;
- after confirmation the feed returned exactly student `69` and one `late` record with `9` minutes;
- the parent-visible note appeared; student `70` and its staff-only note did not;
- `GET /api/students/69` returned `200`, while `GET /api/students/70` returned `403`;
- the response exposed only the documented parent fields and no creator/updater IDs, correction reason, last-change reason or audit metadata.

## 9. 390 px defect and verified correction

The original Preview exposed one real responsive defect under the long labelled values: the 390 px viewport had a `382` px client width but a `507` px document width, and each student card's intrinsic minimum width reached about `482` px.

Commit `36cb2bb28240cf2d18e6640f8902b035b2be8a29` adds `min-w-0` to the student attendance card and a regression assertion. The automatic fixed Preview was `https://1da266ba.smart-school-staging.pages.dev/`.

At `390×844` on the fixed Preview:

- document client width and scroll width both measured `382` px;
- the two management cards measured `332.8` px each;
- no visible teacher, management or parent control was outside the viewport;
- the management save button remained fully visible;
- teacher confirmed controls were disabled and the read-only message was visible;
- the parent record and permitted note remained visible;
- RTL remained active;
- console warnings/errors: `0`; observed network failures during authenticated refresh: `0`.

## 10. Soft cleanup and final postflight

Cleanup used scoped `UPDATE` statements only; no fixture or attendance row was deleted.

- all three QA users are `inactive` with `auth_version=2`;
- old teacher, registrar and parent tokens returned `401`, disabled credential login returned `401`, and the open browser session redirected to login;
- teacher link `2` and parent link `10` are inactive;
- both enrollments are cancelled, both subject assignments inactive and both teaching loads inactive;
- students `69/70`, employee `26`, subjects `137/138`, class `28` and section `36` are archived;
- entries `8/9` remain as historical timetable evidence;
- confirmed attendance session `1`, records `1/2` and audit rows `1/2/3` remain intact;
- temporary credentials were removed after session invalidation was proved.

The final read-only postflight found migration history `39`, pending `0`, foreign-key violations `0`, write guards `0`, and readiness exactly equal to the original baseline. A typed protected-data comparison found no changes or additions across `1,753` rows in `51` school-scoped tables for schools `1` and `3`. It also preserved `1,909` baseline rows across `61` tables; the only documented exclusions were expiring authentication state, SQLite sequences, and the exact `+6` school-2 timetable revision caused by two QA loads, two QA entries and two load deactivations. The final complete snapshot was stable across two captures with hash `057aa7f2db7925f7289cc081cfe21d59ea2ee52fc382e27e0d0fa4595cb2a79c`.

## 11. Safety boundary

Only `smart-school-staging-db` (`1bdb9c3d-08d6-4023-9cbc-64369d53198a`) was contacted remotely during the documented QA. No Production database or other Remote D1 was contacted. No remote seed/reset, manual deploy, force-push or auto-merge was performed. Deployment was produced only by the existing automatic Cloudflare Pages integration; PR #49 was merged later through the normal reviewed GitHub flow.
