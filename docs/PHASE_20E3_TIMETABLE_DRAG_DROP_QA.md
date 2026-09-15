# Phase 20E.3 — Timetable drag, move and atomic swap

Date: 2026-09-15

Base: `36aabc0e42e5be2ef0d8da1d5dcb063c9caca9ef` (`main`, merged PR #47)

Branch: `codex/phase-20e3-timetable-drag-drop`

Status: implementation and local quality gates are complete. Draft PR, CI, Cloudflare Preview and authenticated Preview acceptance remain pending.

## 1. Scope

This phase adds direct mouse drag-and-drop editing to the existing class/section weekly timetable without replacing its explicit controls or scheduling rules.

Delivered behavior:

- dragging an unlocked lesson to an empty active lesson cell moves it;
- dragging it over another lesson in the same timetable group atomically swaps the two lessons;
- locked source or target lessons must be unlocked before drag-and-drop;
- clicking `سحب أو نقل` opens the existing explicit period picker as a keyboard-accessible alternative;
- the picker labels every destination as an empty move, an available swap or an unavailable locked destination;
- successful and failed operations are announced through an Arabic `aria-live` status;
- breaks, missing cells and inactive/historical slots never become drop targets.

No automatic solver behavior, timetable adoption behavior, canonical subject/load data or print view was changed.

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
- both final placements against class/section collision, teacher collision, teacher availability, weekly demand, maximum daily lessons, maximum working days and maximum consecutive lessons.

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

No migration is added. Phase 20E.3 reuses the revision and assertion schema from `0026_timetable_adoption_locking.sql`; the full local migration chain remains `37/37`.

The previous `PUT /api/timetable/entries/:id` endpoint remains available for existing callers and for the explicit confirmed unlock-and-move flow of one locked lesson into an empty slot. Drag-and-drop itself never silently unlocks a lesson.

## 5. Automated evidence

- TypeScript: PASS.
- Focused timetable grid, API, UI and drag interaction checks: `110/110` PASS.
- Complete timetable suite: `335/335` PASS.
- Full regression matrix: `1531/1531` PASS, zero failure and zero skip.
- React DOM behavior: empty move, occupied swap, rejected drop and locked keyboard fallback PASS.
- Atomic API behavior: identity preservation, stale revision, stale occupancy, lock enforcement, tenant/year isolation, hard teacher conflict, concurrent revision change and injected middle-batch rollback PASS.
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
- locked source and locked destination behavior;
- hard scheduling-conflict rejection with unchanged visible data;
- explicit picker behavior using keyboard controls;
- RTL readability, destination highlight and horizontal table containment at `390px`;
- absence of application console errors;
- CI and Preview deployment on the exact final SHA.

The cloud browser cannot open the workspace `localhost`, so visual acceptance is deferred to the public PR Preview rather than claimed from source inspection. The React DOM interaction tests are real rendered-component tests, but they do not replace final browser acceptance.

No Production target, Remote D1, seed/reset outside disposable local state, manual deployment, force-push, merge or auto-merge is authorized by this phase.
