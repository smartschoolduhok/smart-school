# Phase 19C — Quick Week Setup & Selective Day-Period Copy

## Delivery and scope

- Base: `3a7ebda1e9a2d5f31ef8bf7d30a0ccf4e9790998`, verified `origin/main`, including merged PR #35 / Phase 19B.
- Branch: `feature/quick-week-setup-day-copy-phase-19c`.
- Delivery: one new **Draft** PR to `main`. The delivered commit SHA and CI Preview link are recorded in the PR description and delivery response, rather than embedding a self-referential commit hash in this file.
- Review follow-up: same branch and existing **Draft PR #36**, starting at `5e2131566907d6bbc7501865e855e7ee92bc2058`. No second branch/PR.
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
- Before/after evidence comes from the canonical timetable validator, keyed by **entry identity + conflict code**, except working days, which must be compared as actual whole-schedule occupancy. Teacher capacity deficit and working-day excess have stable **teacher + constraint dimension** identities, independent of diagnostic wording. Optional numeric evidence from the same single-entry validator detects worsening daily counts/runs. Remaining unrelated repair items are disclosed using their AFTER-state severity; resolved items are not shown as current warnings. New/worsened conflicts block the entire application. No competing solver or capacity formula.

### Review fixes: reproductions and numerical evidence

Before changing production logic, four focused tests (two domain + two authenticated Worker API) were added and executed against the reviewed head's logic. **All four failed for the reported reasons**:

- Demand 4, capacity 0 → 2: preview incorrectly `can_apply: false`, apply **409 / blocked_week_setup**. The old code compared `teacher_no_available_slots` against the different `teacher_load_exceeds_availability` key and kept the obsolete zero-capacity warning.
- Actual working days 1 → 2, limit 1, two entries per occupied day: preview incorrectly `can_apply: true`, apply **200**. Single-entry `addsWorkingDay` evidence incorrectly described the dormant candidate before activation and omitted the actual whole-schedule violation after activation.

Changes are limited to projected evidence and shared counting primitives:

1. `scheduleEvidence()` keys capacity by `teacher:<id>:capacity_deficit`, with severity `max(0, assigned_weekly_periods - hard_weekly_capacity)` from **calculateTeacherAvailabilitySummary**. Human diagnostic codes remain separate. Returned notice evidence exposes actual demand, capacity limit and excess; Arabic text explicitly states the remaining shortage.
2. It keys actual occupied days by `teacher:<id>:working_days`, with severity `max(0, distinct_active_occupied_days - max_working_days)`, across all the teacher's loads/classes in the authorized school/year. Disabled days, breaks and inactive periods do not count as active occupancy. Historical rows remain stored.
3. `activeTimetableLessonSlots()` and `occupiedTimetableDays()` factor the existing active-slot/distinct-day definitions from the canonical validator. Its single-entry `addsWorkingDay` acceptance semantics are unchanged. Week projection does not depend on that hypothetical-placement condition.
4. Comparison iterates AFTER evidence: new/increased severity blocks; unchanged/reduced severity stays visible as a remaining warning. Resolved warnings disappear. This is permission to save safe incremental configuration, **not** permission to adopt an incomplete schedule. The actual readiness API still reports `ready: false`, demand 4 and insufficient capacity after saving only two periods.

| Focused scenario | Before → after | Result after fix |
| --- | --- | --- |
| Demand 4, incremental setup | Capacity 0 → 2; shortage 4 → 2 | Preview allowed; apply 200; 2 saved periods; AFTER shortage 2 |
| Further setup | Capacity 2 → 3; shortage 2 → 1 | Allowed; AFTER shortage 1 |
| Sufficient capacity | Capacity 0 → 4 (domain/API), 3 → 4 (workerd sequence) | Allowed; no obsolete shortage warning |
| Metadata edit | Capacity 2 → 2; shortage 2 → 2 | Allowed; shortage warning retained; demand unchanged |
| Explicit activation of an empty target | Capacity 0 → 2 | Allowed with truthful remaining shortage |
| Occupied-day activation, demand/capacity both 4 | Working days 1 → 2, limit 1; excess 0 → 1 | Preview blocked; apply 409; every row unchanged |
| Third occupied day | Days 2 → 3, limit 2; excess 0 → 1 | Blocked, including multiple entries per day |
| Worsening existing aggregate violation | Days 2 → 3, limit 1; excess 1 → 2 | Blocked despite unchanged diagnostic code |
| Harmless edit of already-invalid schedule | Days 2 → 2, limit 1; excess 1 → 1 | Allowed; remaining aggregate warning retained |
| Safe activation | Days 1 → 2, limit 2 | Allowed, no false four-lessons-as-four-days count |
| Only inactive periods on activated day | Active occupied days 1 → 1, limit 1 | Allowed; inactive-period repair remains visible |
| Other teacher already over day limit | Unchanged days 2, limit 1; primary teacher 2 → 3, limit 3 | Safe activation allowed; only unrelated teacher's warning retained |
| Break edit genuinely worsens consecutive run | Run 1 → 2, limit 1 | Still blocked; full relevant rows preserved |

The 25 added tests are **12 domain and 13 actual Worker API tests**. They also prove cross-class teacher aggregation, foreign school/year isolation, explicit empty-day activation, full-row preservation (including locks, availability, loads, immutable versions and revisions), and no reduction of demand. Rejected API applies execute only the read preflight and never call the write batch.

The review additionally runs the affected cases through actual authenticated Worker handlers backed by a fresh disposable **Wrangler/workerd D1**, using the production statement builder. Incremental 0 → 2 → 3 → 4 saves each use **16 complete D1 statements / max 4 binds**. Working-day rejection uses **12 read statements / zero writes**, with every application row exactly equal. The original maximum/mixed budgets remain 17/45/**47**, not additional queries for the new in-memory comparisons.

No UI redesign, endpoint/SQL-builder change, demand mutation, teacher reassignment, history rewrite, migration or trigger change. Existing rollback/races, digest/revision checks, locks, availability acknowledgement, safe earlier/later updates, payload/budget limits, retained/source/exception-day behavior and 12 behavioral UI tests are retained and rerun.

## Query budget evidence

The HTTP adapter counts **every executed D1 statement**, including auth/scope and every batch member, and fails at the 50th statement. Each row below is an actual authenticated handler execution, not merely a count of `batch()` calls. Maximum bound parameters per statement: **4**.

| Authenticated apply case | Reads | Writes | Complete statements | Request bytes | Representative local HTTP time |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 day × 7 lessons + 2 breaks | 13 | 3 | 16 | 1,488 | 2.69 ms |
| 5 days × example | 13 | 4 | 17 | 1,642 | 3.22 ms |
| 7 days × 30 periods | 13 | 4 | 17 | 4,562 | 9.70 ms |
| 7 populated days × 30 periods, 30 update layers | 13 | 32 | 45 | 4,574 | 90.84 ms |
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

The latest review run's full local report is generated at `<temp>/smart-school-phase19c-local-Cl5f1w/report.json` (preceding review run: `smart-school-phase19c-local-JnkqRG`). These are temporary local artifacts, not committed. The script is repeatable and creates a new directory on each invocation. Entries, locks, loads, availability, constraints, immutable versions/version entries, source/unselected periods and unrelated application tables were compared by complete row values—not only counts. No orphan assertions; final FK check clean. The table above retains representative original local timings; the generated reports contain each rerun's actual timings and the new review-specific API cases.

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
| `pnpm run test:week-setup` | 89 (37 domain + 40 API + 12 component) |
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

**1,202 passing executions in the final review matrix; 1,110 distinct tests.** Duplicates are Result Cards (66) and Settings (5) within RBAC, and Subject Ordering (21) within Subject Management. Development reruns and the independent local-D1 scenario script are not added to this final-matrix total. All 18 commands above were rerun for this review patch. Local final logs: `<temp>/smart-school-pr36-review-f576da5470b0499ea209ce767fe7a404/*-final.log`.

Earlier development runs caught two new fixture mistakes (required academic-year dates and the wrong choice of an unrelated repair fixture) and an old source test's fixed route count (35→36). These were corrected without removing tests; the route test now also asserts the new routes use the same RBAC. The final reruns pass.

During this review, the initial four deliberately reproducing tests failed on the old logic as documented above. A subsequent two-test failure was a new fixture-only mismatch: generated period labels differed from the requested unchanged template, causing legitimate label updates in an activation-only preservation assertion. The fixture now uses the exact template labels; no assertion was removed. All 89 Week Setup tests pass in the final run.

- `pnpm run typecheck`: PASS, exit 0.
- `pnpm run build:fe`: PASS, exit 0.
- `pnpm run build:api`: PASS, exit 0.
- `git diff --check`: PASS.
- Existing Vite warning remains: some frontend chunks exceed 500 kB after minification. No build warning was hidden or bundle limit raised. No Worker-build error.
- New API failure-injection tests deliberately log unexpected injected server errors; sanitized client responses and full rollback are asserted.

## Changed files and purposes

This review follow-up changes only **seven** files relative to `5e213156`: `src/lib/weekSetup.ts` (stable numerical/AFTER evidence), `src/lib/timetable.ts` (equivalent shared occupancy primitives), `test/helpers/week-setup-fixture.mjs` (isolated generated review cases), `test/week-setup.test.mjs` (12 domain regressions), `test/week-setup-api.test.mjs` (13 Worker API regressions), `scripts/validate-week-setup-local.mjs` (actual workerd-backed handler validation), and this report. The full Phase 19C inventory relative to main follows.

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
