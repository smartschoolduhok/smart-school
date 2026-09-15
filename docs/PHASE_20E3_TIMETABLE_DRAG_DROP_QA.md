# Phase 20E.3 — Timetable drag, move and atomic swap

Date: 2026-09-15

Base: `36aabc0e42e5be2ef0d8da1d5dcb063c9caca9ef` (`main`, merged PR #47)

Branch: `codex/phase-20e3-timetable-drag-drop`

Status: Draft PR [#48](https://github.com/smartschoolduhok/smart-school/pull/48). The teacher-conflict visibility revision and its local quality gates are complete; push, CI, Cloudflare Preview, STAGING migration authorization and authenticated acceptance for this revision remain pending.

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
