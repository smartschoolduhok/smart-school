# Phase 21A — Per-lesson student attendance

Date: 2026-09-16

Base: `54f29ff` (`main`, merged PR #48)

Branch: `codex/phase-21a-lesson-attendance`

Status: implementation and local verification complete. No remote database or deployment action has been performed.

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

- focused attendance API and UI contract suite: `15/15` PASS;
- full regression matrix: `1550/1550` PASS, zero failure and zero skip;
- RBAC suite: `104/104` PASS;
- resource-access suite: `20/20` PASS;
- teaching-load matrix: `117/117` PASS;
- TypeScript: PASS;
- frontend and Worker production builds: PASS;
- `npm audit --audit-level=moderate`: zero vulnerabilities;
- fresh local D1 chain: `39` migrations;
- local backup/restore: exact snapshot across `66` tables, foreign keys clean, and the `360,009`-byte oversized row restored;
- local official promotion: `12` checks PASS;
- local finance D1: `39` checks PASS;
- local week setup and teaching-load matrix D1 validations: PASS;
- `git diff --check`: PASS.

The focused API tests cover tenant isolation, teacher-load scoping, active roster derivation, draft privacy, confirmation, linked-child visibility, staff-note suppression, audited corrections, stale revision rollback, placement-change rollback, teacher-link revocation rollback, malformed status rejection and excessive parent date ranges.

## 5. Visual acceptance status

The production build and source-level rendering/DOM contract checks passed. A live browser inspection could not be completed in this workspace because Vite failed before listening with `uv_interface_addresses`, and the cloud browser independently blocked the fallback static `127.0.0.1` preview with `ERR_BLOCKED_BY_CLIENT`. This is an environment limitation, not a reported application error.

Authenticated visual acceptance on an immutable Preview remains required before merge, covering teacher desktop, parent view, RTL at 390 px, draft/confirm messaging and management correction. It must use labelled QA records only and requires separate authorization before applying migration 0038 to STAGING.

## 6. Safety boundary

No Production or STAGING resource was contacted. Migration 0038 was not applied remotely. No remote D1 command, seed/reset, manual deployment, force-push, merge or auto-merge was performed.
