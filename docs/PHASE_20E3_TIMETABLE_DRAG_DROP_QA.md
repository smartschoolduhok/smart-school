# Phase 20E.3 — Timetable drag, move and atomic swap

Date: 2026-09-15

Base: `36aabc0e42e5be2ef0d8da1d5dcb063c9caca9ef` (`main`, merged PR #47)

Branch: `codex/phase-20e3-timetable-drag-drop`

Status: Draft PR [#48](https://github.com/smartschoolduhok/smart-school/pull/48). The explicitly authorized STAGING continuation completed on 2026-09-15 against only `smart-school-staging-db` (`1bdb9c3d-08d6-4023-9cbc-64369d53198a`). A verified full backup preceded migration 0037; database postflight and authenticated Preview acceptance passed, and the temporary QA account was disabled afterward. The PR remains open and Draft; no merge, auto-merge, manual deployment or Production use occurred.

## STAGING continuation checkpoint — completed under the authorized readiness exception

The continuation ran from the clean isolated worktree for `codex/phase-20e3-timetable-drag-drop`. Browser acceptance used the immutable Preview `https://6571ea9b.smart-school-staging.pages.dev/` for implementation commit `0f152990db172d3d09b6ac4de034f52004619577`; every subsequent commit before this evidence update changed only this QA document. The tracked Wrangler configuration contained exactly one D1 binding: `smart-school-staging-db`, ID `1bdb9c3d-08d6-4023-9cbc-64369d53198a`.

Before any remote mutation, a fresh full export was verified outside the repository:

- path: `C:\Users\ibrah\Documents\SmartSchoolBackups\phase20e3-staging-20260915T133234Z\smart-school-staging-db-full-before-0037.sql`;
- size: `1,433,838` bytes;
- SHA-256: `B09BCDC0DEEE64225D9AEC8CF515D9783C71A9ED92343EA3B3B4B8DDB8E1060F`;
- isolated restore rehearsal: `2,295` statements restored, with the typed schema and values matching all `62` STAGING tables and a clean foreign-key check.

The user authorized only these two old, non-timetable readiness exceptions for this phase:

- school 3: `academic_grade_policy_readiness = partial`, with 2 of 6 active classes configured and approved;
- school 1: `result_card_publication_readiness = inconsistent`, with 22 cards comprising 6 draft, 4 published and 12 withdrawn.

Neither condition was repaired, neither school's data was changed, and this phase-specific exception is not a general waiver. The authorized preapply snapshot hash was `cd4981fdc425a9216294c4bfc2371a691b0f5ec062fb199622eab71c2dfd6405`.

Only `0037_timetable_teacher_collision_visibility.sql` was then applied remotely, at `2026-09-15 13:56:32`, to the named STAGING database and UUID. Postflight proved `38/38` distinct migrations in repository order, 0037 exactly once as migration ID 38, no pending migration, and an empty `PRAGMA foreign_key_check`. All columns and table definitions across 62 tables remained unchanged; every historical value, row and count in the 60 application tables matched the preapply snapshot. Only D1 migration bookkeeping and the two intended timetable validation trigger definitions changed. The teacher-collision database abort was absent, while the group-collision, teacher-unavailable, weekly, daily, working-days and consecutive-period guards remained present. The postflight-before-QA snapshot hash was `91f82a31ff26c74a4a66309816bf53ee84a5d8aac89e633e107231d7115696d0`.

The minimum labelled fixture was created only in school 2 with marker `PH20E3-QA-20260915T142740224Z-15DE93`: temporary least-privilege `vice_principal` account 41, teacher 25, subjects 135/136, one day 15, lesson slots 50/51, loads 149/150 tied to existing sections 3/4, and exactly two entries 6/7. The entries began unlocked and non-conflicting in separate periods; no real student, teacher or timetable record was used.

Authenticated Preview acceptance then established all of the following:

- locking entry 6 disabled dragging and exposed the explicit picker without issuing a drop request; unlocking restored dragging;
- an occupied desktop drag returned `operation = swap`, revision 14 and the same entry IDs 6/7 with the total fixed at two; its QA-only temporary load projection was restored in full immediately afterward;
- an empty-cell drag returned `operation = move`, revision 17 and conflict metadata `teacher_collision`; both entries were saved in slot 50 and rendered with rose background/border plus `تعارض المدرّس`;
- the same two rose conflict cards and label were verified in both section grids, the complete timetable, each class/section view, the teacher view and a visually inspected one-page A4 landscape PDF;
- ordinary teacher-collision PUT and weekly-overage POST probes each returned 409 with zero write; all remaining hard guards stayed present and are covered by the `339/339` timetable suite;
- at a 390 px viewport, the document had no horizontal overflow, the complete table stayed inside the viewport in its own horizontal scroller, and both conflict cards remained rendered;
- there were zero application-console errors; seven Chrome automation-extension channel teardown messages were classified and excluded because they were not application exceptions or failed timetable actions.

After acceptance, account 41 was changed from active to inactive, its `auth_version` was incremented, the stored password value was removed from the private QA context, and reloading the old browser session cleared both authentication stores and redirected to `/login`. The remaining school-2 fixture records stay explicitly QA-labelled as authorized; no deletion was performed.

Machine-readable evidence is outside Git under `C:\Users\ibrah\Documents\SmartSchoolBackups\phase20e3-staging-20260915T133234Z`: `phase20e3-authorized-preapply.json`, `phase20e3-postflight-before-qa.json`, the public fixture/negative-probe/swap/account-disable JSON files, and the marker-specific `browser-qa-*` directory. The final read-only audit is `phase20e3-final-audit-PH20E3-QA-20260915T142740224Z-15DE93.json` (SHA-256 `FA24A17DA8CF4070D4EF624C0731BB11C550ADD1565A03CA8441E14125A64A4E`). It compared 49 protected school-1/3 tables and 1,755 protected rows without a difference, produced current snapshot hash `b1a9f882d1d464758b9e5f4bb44c12c2e6c084f18776cf87afaa441b87b64c3c`, and matched across two complete captures during the audit window. It is kept separate from postflight-before-QA so that migration history preservation and the later, allowlisted school-2 fixture changes remain independently reviewable.

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

The repository and target STAGING migration chains are both `38/38`, with no pending migration and a clean foreign-key check. On 2026-09-15, only migration 0037 was applied to `smart-school-staging-db` (`1bdb9c3d-08d6-4023-9cbc-64369d53198a`) after the verified full backup. Postflight comparison found no historical application-data change and no table/column change; only the intended trigger definitions and D1 migration bookkeeping changed.

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

### STAGING evidence

- Migration postflight and final audit: `38/38`, 0037 once and last, Wrangler reports `No migrations to apply`, empty foreign-key check, unchanged historical application data and unchanged readiness exception rows.
- Live zero-write blockers: ordinary teacher collision returned 409 `teacher_collision`; excess weekly demand returned 409 `weekly_periods_exceeded`.
- Live interactions: lock and explicit picker, unlock, occupied atomic swap with preserved identities, destination highlight, and saved teacher-conflict move all PASS.
- Live rendering: both section grids, complete timetable, class/section views, teacher view, print output and the 390 px layout all display the two rose conflict entries and `تعارض المدرّس` as applicable.
- Browser console: zero application errors; extension transport teardown noise is separately identified in the browser evidence.
- Account shutdown: temporary account 41 is inactive, its authentication version increased, and its old session redirects to login with no stored token.

## 6. Preview acceptance — completed

- PASS — desktop mouse drag to an empty lesson cell saved the teacher-collision move.
- PASS — occupied desktop drag atomically swapped entries 6/7 while preserving both identities and the total of exactly two entries.
- PASS — both affected entries became rose and showed `تعارض المدرّس` in the editor, complete timetable, both class/section views, teacher view and print output.
- PASS — locking blocked dragging; the explicit picker remained available and issued no drop until a destination action; unlocking restored dragging.
- PASS — blocking conflict probes rejected without a write, and every non-teacher trigger guard remained installed.
- PASS — RTL content, destination highlight, document containment and horizontal table scrolling were verified at 390 px.
- PASS — one-page A4 landscape print evidence had no clipping or overlap and retained both conflict cards and labels.
- PASS — there were no application-console errors.
- PASS — authenticated acceptance ran on the immutable implementation Preview. Subsequent branch changes are QA documentation only and require the normal automatic CI/Preview checks before reporting the final SHA.

No Production resource or D1 database other than the explicitly named STAGING target was used. No remote seed/reset, direct administrative deletion, manual deployment, force-push, merge or auto-merge occurred. The swap endpoint's documented atomic replacement preserved both canonical entry identities and the total of exactly two QA entries.
