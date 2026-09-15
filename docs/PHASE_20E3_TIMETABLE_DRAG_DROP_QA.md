# Phase 20E.3 — Timetable drag, move and atomic swap

Date: 2026-09-15

Base: `36aabc0e42e5be2ef0d8da1d5dcb063c9caca9ef` (`main`, merged PR #47)

Branch: `codex/phase-20e3-timetable-drag-drop`

Status: Draft PR [#48](https://github.com/smartschoolduhok/smart-school/pull/48). The implementation is pushed and its CI and Cloudflare Preview checks pass. The authorized STAGING continuation stopped at its mandatory preflight gate on 2026-09-15; migration 0037 and authenticated acceptance remain pending.

## STAGING continuation checkpoint — stopped at preflight

The authorized continuation was run from a clean, isolated worktree at implementation commit `0f152990db172d3d09b6ac4de034f52004619577` and tree `7d0d8961c11aa439159f4181a006741113b80919`. PR #48 was still open and Draft, Quality Gates run `34958910730` was successful and the immutable Preview was `https://6571ea9b.smart-school-staging.pages.dev/`. The tracked configuration contained exactly one D1 binding: `smart-school-staging-db`, ID `1bdb9c3d-08d6-4023-9cbc-64369d53198a`.

A fresh full export was created outside the repository before any attempted mutation:

- path: `C:\Users\ibrah\Documents\SmartSchoolBackups\phase20e3-staging-20260915T133234Z\smart-school-staging-db-full-before-0037.sql`;
- size: `1,433,838` bytes;
- SHA-256: `B09BCDC0DEEE64225D9AEC8CF515D9783C71A9ED92343EA3B3B4B8DDB8E1060F`.

Read-only preflight proved 37 distinct migration rows in repository order through `0036_official_book_layout.sql`, exactly one pending file (`0037_timetable_teacher_collision_visibility.sql`), an empty `PRAGMA foreign_key_check`, and both canonical timetable validation triggers with the pre-0037 teacher-collision block and all other guards present. The complete typed snapshot covered 62 tables (60 application tables) and has hash `cd4981fdc425a9216294c4bfc2371a691b0f5ec062fb199622eab71c2dfd6405`.

An isolated Local D1 rehearsal restored 2,295 export statements: 2,294 normal statements plus one oversized `import_jobs` row using 16 bound parameters and 360,514 bound bytes. The restored schema and typed values matched the read-only STAGING snapshot exactly across all 62 tables. Applying only 0037 locally produced 38/38 migrations with no pending file and a clean foreign-key check. Every historical column and value remained identical, all application counters remained unchanged, and the only schema changes were the two intended timetable validation triggers. Their teacher-collision abort was removed while the group-collision, teacher-unavailable, weekly, daily, working-days and consecutive-period guards remained present.

The mandatory readiness gate did not pass:

- school 3 has `academic_grade_policy_readiness = partial`: 2 of 6 active classes are configured and approved;
- school 1 has `result_card_publication_readiness = inconsistent`: 22 cards, comprising 6 draft, 4 published and 12 withdrawn. The same inconsistency was documented before this task, but the draft count has increased by one since the Phase 20E.2 checkpoint.

These conditions were not repaired or waived because neither action was authorized. Consequently, no remote migration apply was run and 0037 remains pending.

The exported snapshot also proved that the only clearly labelled QA tenant, school 2 (`مدرسة Staging الثانية`), has the active QA classes and sections but zero subjects, teachers/employees, timetable days, lesson slots, teaching loads or timetable entries. It has no active school-scoped administrator with documented safe credentials. The runbook explicitly requires stopping instead of creating prerequisites or using real records, so no QA lessons were created and no authenticated Preview mutation was attempted.

Machine-readable evidence remains outside Git at `C:\Users\ibrah\Documents\SmartSchoolBackups\phase20e3-staging-20260915T133234Z\phase20e3-readonly-preflight.json` and `C:\Users\ibrah\Documents\SmartSchoolBackups\phase20e3-staging-20260915T133234Z\phase20e3-local-rehearsal-evidence.json`. No Production resource or other D1 database was accessed; no remote seed/reset, deletion, manual deploy, force-push, merge or auto-merge occurred.

## 1. Scope

This phase adds direct mouse drag-and-drop editing to the existing class/section weekly timetable without replacing its explicit controls or scheduling rules.

Delivered behavior:

- dragging an unlocked lesson to an empty active lesson cell moves it;
- dragging it over another lesson in the same timetable group atomically swaps the two lessons;
- dragging a lesson into a period where its teacher already teaches another group saves the placement and marks both lessons in rose with `تعارض المدرّس`;
- locked source or target lessons must be unlocked before drag-and-drop;
- clicking `سحب أو نقل` opens the existing explicit period picker as a keyboard-accessible alternative;
- the picker labels every destination as an empty move, an available swap or an unavailable locked destination;
- successful and failed operations are announced through an Arabic `aria-live` status;
- breaks, missing cells and inactive/historical slots never become drop targets.

The teacher-collision exception applies only to the drag-and-drop endpoint. Ordinary create/move operations, automatic scheduling and adoption/restore continue to reject teacher collisions. Canonical subject/load data was not changed; the conflict styling is also retained in timetable print output.

## 2. Authoritative server contract

The new endpoint is:

`PUT /api/timetable/entries/:id/drop`

The request contains the school, academic year, source slot, destination slot, expected destination entry (or explicit `null`) and the timetable revision shown to the user. Unknown fields and malformed IDs fail before a write.

Before persisting anything, the server independently reloads the complete school/year scheduling context and validates:

- authenticated academic-management role and exact tenant scope;
- source entry ownership and academic year;
- current timetable revision and current source slot;
- destination slot activity and lesson type;
- actual destination occupancy for the source class/section scope;
- source and destination lock state;
- both final placements against class/section collision, teacher collision, teacher availability, weekly demand, maximum daily lessons, maximum working days and maximum consecutive lessons;
- a teacher collision is returned as visible conflict metadata and saved only for this drop endpoint;
- class/section collision, teacher unavailability, weekly demand and daily/working-day/consecutive limits remain blocking and cause a zero-write rejection.

Client-provided occupancy is never trusted. If either the revision, source slot or destination entry changed since the grid was loaded, the endpoint returns `409 stale_timetable_drop` without applying the requested operation.

## 3. Atomic move and swap

An empty move updates one canonical `timetable_entries` row.

An occupied swap uses one D1 batch protected by `timetable_revision_assertions`:

1. assert the expected school/year timetable revision;
2. remove the unlocked destination row temporarily;
3. move the source row to the destination;
4. restore the destination row at the original source slot with the same ID, teaching load, creator and creation timestamp;
5. remove the short-lived assertion.

D1 commits the batch as one transaction. Any stale revision, database constraint or injected middle failure rolls back the destination deletion, source move, reinsert, revision increments and assertion row together.

The authoritative revision is intentionally opaque to the client. A simple move increments it for one entry mutation; a swap increments it for its three canonical row mutations.

## 4. Compatibility and schema

Migration `0037_timetable_teacher_collision_visibility.sql` recreates the two canonical entry-validation triggers without the database-level teacher-collision abort. Every other trigger guard remains unchanged. This is required so the drag endpoint can persist a deliberately visible teacher collision; application paths other than drag/drop continue to reject it before writing.

The full local migration chain is `38/38`, with a clean foreign-key check. Migration `0037` has not been applied to STAGING and must not be applied there without a fresh backup and explicit authorization.

The previous `PUT /api/timetable/entries/:id` endpoint remains available for existing callers and for the explicit confirmed unlock-and-move flow of one locked lesson into an empty slot. Drag-and-drop itself never silently unlocks a lesson.

## 5. Automated evidence

- TypeScript: PASS.
- Focused teacher-collision, timetable grid, API and rendered UI checks: `101/101` PASS.
- Complete timetable suite: `339/339` PASS.
- Full regression matrix: `1535/1535` PASS, zero failure and zero skip.
- React DOM behavior: empty move, occupied swap, visibly accepted teacher collision, rejected blocking conflict and locked keyboard fallback PASS.
- Atomic API behavior: identity preservation, stale revision, stale occupancy, lock enforcement, tenant/year isolation, accepted teacher collision metadata, blocked teacher unavailability, concurrent revision change and injected middle-batch rollback PASS.
- Frontend production build: PASS.
- Worker production build: PASS.
- `npm audit --audit-level=low`: zero vulnerabilities.
- Fresh local D1 seed: PASS.
- Local week setup and teaching-load matrix D1 scenarios: PASS.
- Local finance D1: `39` checks PASS, including intended blocker rollback cases.
- Local official promotion D1: `12` checks PASS.
- Local backup/restore: exact application snapshot across `62` tables; oversized `360,009`-byte row restored; foreign keys clean.
- `git diff --check`: PASS.

## 6. Preview acceptance checklist

The following checks must be completed on the final Cloudflare Preview before the PR can be considered ready to merge:

- desktop mouse drag to an empty lesson cell;
- desktop mouse drag onto an occupied lesson and confirmation that both identities swap;
- desktop mouse drag into a teacher collision, confirmation that the move is saved and both affected lessons are rose with `تعارض المدرّس` in the weekly, master and teacher views;
- locked source and locked destination behavior;
- other hard scheduling-conflict rejection with unchanged visible data;
- explicit picker behavior using keyboard controls;
- RTL readability, destination highlight and horizontal table containment at `390px`;
- absence of application console errors;
- CI and Preview deployment on the exact final SHA.

The cloud browser cannot open the workspace `localhost`, so visual acceptance is deferred to the public PR Preview rather than claimed from source inspection. The React DOM interaction tests are real rendered-component tests, but they do not replace final browser acceptance.

No Production target, Remote D1, seed/reset outside disposable local state, manual deployment, force-push, merge or auto-merge is authorized by this phase.
