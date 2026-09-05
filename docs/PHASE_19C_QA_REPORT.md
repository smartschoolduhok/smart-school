# Phase 19C — Quick Week Setup & Selective Day-Period Copy

## Delivery and scope

- Base: `3a7ebda1e9a2d5f31ef8bf7d30a0ccf4e9790998`, verified `origin/main`, including merged PR #35 / Phase 19B.
- Branch: `feature/quick-week-setup-day-copy-phase-19c`.
- Delivery: one new **Draft** PR to `main`. The delivered commit SHA and CI Preview link are recorded in the PR description and delivery response, rather than embedding a self-referential commit hash in this file.
- No changes to any migration, Wrangler configuration, authentication, roles, enrollment lifecycle, grades, finance, adoption, or solver behavior.
- No remote D1 commands (including reads), staging/production access, shared seed/reset, manual deployment, account changes, or merge.
- Only generated disposable local fixtures are used. No credentials, real records, database files, backups, build outputs, or temporary logs are included in the PR.

## Implemented behavior

The week overview now shows seven compact cards in saved day order, without changing day identities. Each distinguishes inactive days, empty days, active lesson/break counts, inactive saved periods, and the first/last saved times. Existing individual activation/order/period controls remain under **تخصيص اليوم** and continue using the existing guarded endpoints.

**إعداد سريع للحصص والاستراحات** creates a local draft, not database rows. The draft supports break rules, manual labels/times/durations/gaps, period insertion/removal, explicit time recalculation, and an optional desired end comparison. Regeneration requires confirmation if a template exists. Increasing a duration does not move subsequent periods automatically; explicit recalculation can repair the resulting temporary overlap.

The clearly labelled example produces:

| Period | Start | End |
| --- | --- | --- |
| Lesson 1 | 13:00 | 13:35 |
| Lesson 2 | 13:35 | 14:10 |
| Break 1 | 14:10 | 14:25 |
| Lesson 3 | 14:25 | 15:00 |
| Lesson 4 | 15:00 | 15:35 |
| Break 2 | 15:35 | 15:45 |
| Lesson 5 | 15:45 | 16:20 |
| Lesson 6 | 16:20 | 16:55 |
| Lesson 7 | 16:55 | 17:30 |

Totals: **245 teaching minutes + 25 break minutes = 270 elapsed minutes**, ending **17:30**. Integer-minute arithmetic only; no timezone/Date calculations. This example is not assumed to be the school's calendar and never saves automatically.

**نسخ فترات هذا اليوم إلى…** copies only editable period values, preserving numbering, gaps, durations and inactive periods. Destination IDs are never copied. Source day exclusion is enforced by the server. The draft retains the source snapshot revision, including across parent refreshes, and stale sources require reload/re-preview. Destination days become independent; subsequent source edits do not propagate.

Targets start empty. The working-days shortcut selects only currently active days and excludes the source. Missing/inactive destinations require a separate activation checkbox; skipped nonempty days are never activated. Unselected days are unchanged.

### Application modes

- **fill_empty_days** (default): zero saved periods means empty, including inactive rows. Existing days are explicitly `skipped_existing`, not errors or successfully updated days. A refreshed repeat produces no duplicates and no revision churn.
- **update_matching_keep_extra**: match by slot index plus compatible type/lesson number. Preserve destination IDs; exact matches are no-ops; extras remain and participate in final validation. New compatible periods may be inserted. Incompatible identity or active-state changes are blocked and directed to individual customization. No deletion, implicit deactivation, replacement, or persistent synchronized template.

## Server authority and transaction design

Routes: `GET /api/timetable/week-setup`, `POST .../preview`, `POST .../apply`.

All use existing `ACADEMIC_MANAGEMENT_ROLES`, authentication and active-school resolution. Admin writes require explicit school; tenants remain JWT-scoped. Reference reads use school/year-scoped SQL. Missing and foreign years have the same generic response. The public snapshot contains periods, days, counts and revision—not teacher details or a second assignment model.

Strict shared parsing rejects unknown fields, non-object payloads, type-coercion tricks, unsafe IDs, duplicate/out-of-range days, source-as-target, unsupported modes, invalid booleans/types/labels/times/identities, empty inputs, and overlaps (including inactive periods). Limits: 7 targets, 30 periods per template/resulting configured day, 32,768 request bytes. Times are strict `HH:mm`; no midnight crossing or `24:00`.

One **read-only batch of nine queries** captures the year, days, periods, loads with scoped canonical references, entries, availability, constraints, historical reference counts and revision. GET and preview do not initialize missing revision/day rows. Preview returns full resulting destination days including retained extras, activation separate from period counts, impacts, warnings, blockers, and a deterministic SHA-256 digest over canonically serialized scope/request/revision/plan. The digest is not authorization.

Apply reparses, reloads, revalidates, checks revision and digest, and verifies availability acknowledgement. It then executes **one atomic D1 batch**:

1. Existing revision assertion INSERT is the **first write**.
2. Explicit day creation/activation, preserving existing IDs/order.
3. Dependency-ordered in-place period updates.
4. Set-based JSON period creation, after old conflicting intervals have moved.
5. Assertion cleanup.
6. Authoritative response revision SELECT, inside the same batch.

Returned creation/update/activation counts come from SQL `RETURNING` rows. Existing revision triggers remain authoritative. All-skipped/all-identical requests perform no write, do not touch timestamps, and explicitly return `applied: false, no_change: true`. Failed transactions roll back business values, activation, timestamps, revisions and temporary assertion rows.

Stale error: `stale_week_setup` — **تغيرت إعدادات الأسبوع بعد المعاينة. أعد تحميلها ثم حاول مرة أخرى.** A race after preflight is rejected by the in-batch assertion. Two changing requests with the same revision cannot both succeed.

### Update ordering

Updates are ordered by dependencies on other rows' **old** intervals. Only independent changes share a layer; final intervals have already been validated. Cross-day independent updates share the same layer. This avoids reliance on SQLite UPDATE row visitation order. Inserts execute after updates. Earlier/later shifts were exercised against real local workerd D1, including 30 layers across seven days. Cyclic time swaps are blocked during preview; no fabricated parking times, trigger disabling, deletion/recreation or split commits are used.

### Linked data and projected schedule

- Scheduled/locked entry time or identity changes are blocked with `slot_has_scheduled_entries`. Metadata-only changes remain possible. No entry, lock or load is changed.
- Availability-linked permitted time changes retain the same slot ID and every override; explicit acknowledgement is required. Acknowledgement never bypasses hard constraints.
- Impact counts include other periods on a day when activation or bell-layout changes can affect them, not only the edited break's direct links. Metadata-only changes count the directly changed periods.
- Immutable version rows remain unchanged. Restoring a placement version does **not** restore old bell times; the preview explains this when relevant.
- Before/after evidence comes from the canonical timetable validator, keyed by **entry identity + conflict code**, plus canonical teacher capacity evidence. Optional numeric evidence from that same validator detects worsening counts/runs. Existing unrelated repair items remain visible warnings; new/worsened conflicts block the entire application. No competing solver or constraint implementation.

## Query budget evidence

The HTTP adapter counts **every executed D1 statement**, including auth/scope and every batch member, and fails at the 50th statement. Each row below is an actual authenticated handler execution, not merely a count of `batch()` calls. Maximum bound parameters per statement: **4**.

| Authenticated apply case | Reads | Writes | Complete statements | Request bytes | Representative local HTTP time |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 day × 7 lessons + 2 breaks | 13 | 3 | 16 | 1,488 | 3.15 ms |
| 5 days × example | 13 | 4 | 17 | 1,642 | 4.95 ms |
| 7 days × 30 periods | 13 | 4 | 17 | 4,562 | 9.42 ms |
| 7 populated days × 30 periods, 30 update layers | 13 | 32 | 45 | 4,574 | 103.40 ms |
| Mixed creates/activation/updates/retained | 13 | 5 | 18 | 494 | fixture-dependent |
| 6 populated days × 30 updates + new 30-period day | 13 | 34 | **47** | 4,574 | fixture-dependent |

Read count includes the final transactional revision SELECT. Writes include assertion creation/cleanup, not just business writes. A true no-op has only the read preflight. Preview-only measurements and timings are not claims about remote performance. The hard batch construction ceiling is 35 members; the verified worst complete request is 47 statements.

## Actual local Wrangler/workerd D1

`pnpm run test:week-setup:local` passed, using Wrangler **4.118.0** and a newly generated OS-temp configuration `phase19c-local-only` with a fake local database ID. It never uses the project's configured database binding or environment files.

Normal command structure (all paths point into the generated disposable directory):

```text
node node_modules/wrangler/bin/wrangler.js d1 migrations apply phase19c-local-only --local --config <temp>/wrangler.json --persist-to <temp>/state
node node_modules/wrangler/bin/wrangler.js d1 execute phase19c-local-only --file <temp>/generated-local-fixtures.sql --local --config <temp>/wrangler.json --persist-to <temp>/state
node node_modules/wrangler/bin/wrangler.js d1 migrations list phase19c-local-only --local --config <temp>/wrangler.json --persist-to <temp>/state
```

All **28 real inherited migrations through 0027**, including both 0014 files, applied successfully. No synthetic schema. Zero pending locally. `foreign_keys = 1`; `foreign_key_check = []`. 219 index/trigger objects enumerated; the required overlap, slot-preservation, availability, immutable-version, revision-assertion and teacher-reassignment guards were explicitly checked.

Production loader/builder execution through `getPlatformProxy` with `remoteBindings: false` and `envFiles: []` verified:

| Scenario | Actual write-batch members | Result |
| --- | ---: | --- |
| Selective empty week, 3 × 9 periods | 5 | 27 creates; unselected scopes unchanged |
| Source-day copy | 5 | 9 new IDs; source rows unchanged |
| Maximum 7 × 30 | 5 | 210 creates |
| Shift later, seven 30-period days | 33 | 210 updates, 30 cross-day layers; ~91 ms |
| Shift earlier | 33 | 210 updates, 30 layers; ~87 ms |
| Scheduled-slot time edit | no write | Blocked during planning |
| Injected failure after cleanup AND response SELECT | whole batch rejected | Every application-table row value exactly restored |
| Mixed metadata updates/create/activation/retained | 6 | 2 updates + 1 create + 1 activation; retained rows unchanged |

The last full local report is generated at `<temp>/smart-school-phase19c-local-euK4BQ/report.json`. This is a temporary local artifact, not committed. The script is repeatable and creates a new directory on each invocation. Entries, locks, loads, availability, constraints, immutable versions/version entries, source/unselected periods and unrelated application tables were compared by complete row values—not only counts. No orphan assertions; final FK check clean.

## UI and async verification

Added **12 actual React interaction tests** using the existing Node test runner plus the dev-only Happy DOM environment. No new production dependency or production package-version change. Tests exercise rendered inputs/buttons and captured typed API requests, not just source patterns:

- Visible exact example, local generation only, desired-end comparison.
- Target selection/unselection with Thursday excluded and activation separate.
- Editable copy and source revision retention.
- Raw incomplete fields and every relevant edit invalidate preview.
- Dirty confirm/cancel and `beforeunload`; regeneration cancel.
- Duration/gap editing and explicit recalculation, including temporary overlaps.
- Late preview response ignored after edit.
- A→B→A load responses ignored correctly.
- Late apply cannot close/clear a newly opened draft or show obsolete success.
- Successful confirmed save clears only its draft and refreshes its snapshot and parent readiness/dependent data.
- Existing individual day/period callbacks still reachable.
- Keyboard focus/Escape and responsive container safeguards; existing matrix/school/year/tab navigation guards remain wired.

The small monotonic request fence binds scope, request generation and draft version; raw edits advance it even when they cannot compile. This extends, rather than replaces, Phase 19B dirty-navigation protection.

Additionally inspected the **real rendered component in a local-only browser fixture** at desktop and a requested responsive **375 × 812** viewport. Generated example, target selection, activation and full preview were exercised. At the narrow breakpoint, page client/scroll width were both 367px and dialog client/scroll width both 343px: no horizontal overflow. All nine rows and final `17:30` end were present; Sunday was skipped, Wednesday planned for creation, Thursday remained unselected. The temporary browser viewport was reset and local server stopped afterward.

The optional `scripts/serve-week-setup-ui-local.mjs` fixture cannot save and contains only generated data. Browser visual checks **do not prove database persistence**. Persistence/rollback evidence comes from authenticated API integration tests and actual local D1 builder execution above. No authenticated staging-runtime claim is made. A normal PR Preview deployment/check, if successful, is still not evidence of authenticated DB-backed staging correctness.

## Regression results

Final verification matrix; every listed suite has **0 failed / 0 skipped / 0 cancelled**:

| Command | Passed |
| --- | ---: |
| `pnpm run test:week-setup` | 64 (25 domain + 27 API + 12 component) |
| `pnpm run test:teaching-load-matrix` | 117 |
| `pnpm run test:timetable` | 319 |
| `pnpm run test:subject-management` | 59 |
| `pnpm run test:subject-order` | 21 |
| `pnpm run test:religious-subjects` | 39 |
| `pnpm run test:subject-applicability` | 3 |
| `pnpm run test:flexible-grades` | 36 |
| `pnpm run test:grade-presentation` | 9 |
| `pnpm run test:result-cards` | 66 |
| `pnpm run test:excel-import` | 81 |
| `pnpm run test:security` | 22 |
| `pnpm run test:rbac` | 95 |
| `pnpm run test:student-promotion` | 129 |
| `pnpm run test:student-enrollments` | 58 |
| `pnpm run test:academic-years` | 30 |
| `pnpm run test:student-profile` | 24 |
| `pnpm run test:settings` | 5 |

**1,177 passing executions in the final matrix; 1,085 distinct tests.** Duplicates are Result Cards (66) and Settings (5) within RBAC, and Subject Ordering (21) within Subject Management. Development reruns and the independent local-D1 scenario script are not added to this final-matrix total.

Earlier development runs caught two new fixture mistakes (required academic-year dates and the wrong choice of an unrelated repair fixture) and an old source test's fixed route count (35→36). These were corrected without removing tests; the route test now also asserts the new routes use the same RBAC. The final reruns pass.

- `pnpm run typecheck`: PASS, exit 0.
- `pnpm run build:fe`: PASS, exit 0.
- `pnpm run build:api`: PASS, exit 0.
- `git diff --check`: PASS.
- Existing Vite warning remains: some frontend chunks exceed 500 kB after minification. No build warning was hidden or bundle limit raised. No Worker-build error.
- New API failure-injection tests deliberately log unexpected injected server errors; sanitized client responses and full rollback are asserted.

## Changed files and purposes

| File(s) | Purpose |
| --- | --- |
| `src/lib/weekSetup.ts` | Shared types/parsing, minute arithmetic, summaries, semantic matching, linked/projected safety, deterministic plan/digest and update layers |
| `src/lib/weekSetupDb.ts` | Consistent scoped reads, bounded body parsing, atomic set-based SQL, safe errors |
| `src/lib/timetable.ts` | Optional numeric evidence callback from existing canonical validation; no calculation/acceptance change |
| `src/worker.ts` | Three focused RBAC-protected week-setup endpoints |
| `src/lib/api.ts` | Typed API helpers using the existing client |
| `src/modules/timetable/WeekSetupTab.tsx` | Compact overview, wizard, targets, preview/confirm, dirty/async protection |
| `src/modules/timetable/WeekPeriodEditor.tsx` | Responsive editable local period rows |
| `src/modules/timetable/weekDraft.ts` | Raw-input conversion and monotonic draft request fence |
| `src/modules/timetable/TimetablePage.tsx` | Integrates focused tab and extends existing navigation guard; smaller main page |
| `test/week-setup*.test.mjs`, `test/helpers/week-setup-fixture.mjs` | Domain, adversarial HTTP, full-row preservation/budget/rollback and interactive component tests on genuine schema |
| `test/timetable-foundation.test.mjs` | Existing static route inventory updated, with explicit week-setup RBAC assertion |
| `scripts/validate-week-setup-local.mjs` | Repeatable disposable Wrangler/workerd real-migration validation |
| `scripts/serve-week-setup-ui-local.mjs` | Loopback generated visual fixture; no save operation |
| `package.json`, `package-lock.json` | New test scripts and dev-only DOM testing dependency; inherited production locks preserved |
| `docs/PHASE_19C_QA_REPORT.md` | This implementation, validation and safety report |

## Limitations / handoff

- Maximum 30 periods per configured destination, same-school/year only, no midnight crossing, no destructive replacement or implicit active-state changes.
- Cyclic intermediate time dependencies are intentionally preview blockers. Individual customization remains the recovery path.
- Individual customization retains its pre-existing behavior and guards; it is not an alternate bulk transaction.
- Browser close confirmation is subject to browser support. Local component tests prove draft/fence behavior; manual staging authenticated QA is a separate, **not performed/authorized** step.
- No migration added or changed. Normal PR Preview CI only; no remote schema operation is required by this phase.
- PR must remain Draft/unmerged. Do not apply anything remotely as part of this delivery.
