# Phase 19B — Teaching load matrix and bulk assignment

Branch: `feature/teaching-load-matrix-bulk-phase-19b`
Base: `d5b0c19cd38f5add08273e0c88efe7da0c54e9cd`

## Delivered workflow

- Normal loads view starts with active class cards sorted by order_index then ID.
- Cards distinguish active subject/section counts from expected **applicable** cells. Disabled cells do not count as missing. Loads without teachers remain configured; completion = configured cells with a teacher / expected cells.
- Separate `TeachingLoadMatrixTab`: canonical subject rows and section columns; section-specific subjects are disabled elsewhere. No-section classes use “الصف بالكامل” / NULL.
- Explicit periods/teacher apply-all, individual overrides, teacher clearing, explicit deactivation, row/whole-draft reset, search and missing/no-teacher/changed filters.
- Empty periods retain existing values or do not create missing loads. NULL teacher does not deactivate.
- No autosave. Preview shows old/new values, exact counts and warnings/blockers, including locked lesson impact. Only a valid preview offers “حفظ جميع الأنصبة”.
- Success clears draft/preview, reloads loads and readiness, refreshes cards and keeps selected class.
- Existing individual editor remains behind “تعديل متقدم”.
- Scope-keyed mounts and monotonic generations guard school/year/class ABA and async loads/copy/preview/apply. Draft changes invalidate preview immediately. School/year/tab/back navigation and beforeunload protect unsaved work. Cards exclude previous-school/year props during transitions.

## API, RBAC and canonical behavior

All four routes retain `ACADEMIC_MANAGEMENT_ROLES`: system_admin, school_owner, principal, vice_principal, registrar. Teacher/accountant are forbidden. System admin writes require an explicit active school; tenant users remain fixed to their authenticated school.

| Route | Behavior |
| --- | --- |
| GET `/api/timetable/teaching-load-matrix` | Scoped class, sections, subjects, active teachers, canonical class loads, summary and revision |
| POST `/api/timetable/teaching-load-matrix/preview` | Strict parse, fresh canonical read, deterministic plan, zero writes |
| POST `/api/timetable/teaching-load-matrix/apply` | Explicit confirmation, fresh parse/plan, atomic revision assertion and writes |
| POST `/api/timetable/teaching-load-matrix/copy-preview` | Distinct same-school source year, canonical ID matching, read-only proposed draft |

Reject unknown fields, malformed IDs, duplicates, unsupported actions, invalid periods and more than 500 changes. Teacher eligibility uses `employees.role = 'teacher'`, not a second classification.

All new reference reads/joins are scoped in SQL. Missing and foreign IDs return indistinguishable errors; foreign names are never loaded. The private planner needs the full selected school/year schedule to detect cross-class teacher conflicts; the public GET returns only selected-class loads.

Upserts preserve active IDs and updater audit. If only inactive history exists, create a NEW active row, consistent with the individual-create API; no implicit reactivation. Omissions do nothing. Deactivation is explicit and blocked when ANY scheduled entries remain.

Copy matches class/subject/section IDs, never names. Periods-only preserves target teachers/new NULL. Periods-and-teachers copies eligible teachers, otherwise substitutes NULL with an explicit warning. Unavailable subjects/sections are reported separately. Omissions do not deactivate target configuration. No entries, locks, availability, constraints, days, slots, revisions or versions are copied. Accepting copy fills a draft; normal preview/confirm remains mandatory.

## Authorized migration 0027

`migrations/0027_timetable_safe_teacher_reassignment.sql` replaces only the absolute employee-change prohibition from 0025's `trg_timetable_loads_preserve_entries`. That old trigger rejected both safe NULL → teacher and teacher A → B changes whenever entries existed.

The replacement retains school/year/class/section/subject identity protection. New `trg_timetable_loads_validate_teacher_reassignment` is an AFTER UPDATE guard evaluating the resulting destination teacher's complete school/year schedule:

- Valid, active same-school canonical teacher required.
- Collisions and unavailable-period checks include preserved historical entries, matching the canonical validator.
- Daily/working-day/consecutive limits aggregate ALL destination loads and ALL lessons on the reassigned load.
- Capacity uses active days and active lesson slots. Breaks/unoccupied active lessons reset consecutive runs; inactive slots are excluded.
- Preferred/avoid remain warnings.
- Teacher → NULL is allowed; same-teacher updates have no new reassignment-specific validation.
- SQL ABORT rolls back data, audit/timestamps and revision effects.
- Existing entry validation, weekly lower bound, unique indexes, foreign keys, locks and immutable versions are unchanged.

No old migration was edited. 0027 has zero CRLF bytes. It has NOT been applied remotely.

## Combined planning and atomic execution

Preview checks the COMBINED final state, not independent updates against old assignments. Apply independently recomputes that plan.

One D1 batch contains:

1. Existing revision assertion, before any load writes.
2. Temporarily clear only changing, previously non-NULL teachers, grouped into at most 90 IDs per statement.
3. Final creates/updates/explicit deactivations.
4. Advance revision (including all-unchanged confirmed requests), remove assertion, return revision from the same batch.

This supports coupled swaps without transient collisions. No trigger disabling, general bypass, entry deletion or unaffected-load mutation. Any failure rolls back temporary NULLs, final writes, audit and revision. Two clients cannot apply the same revision. Old solver proposals fail the existing assertion.

500 teacher changes use 510 write-batch statements, at most 94 parameters each. Read/auth preflight is additional. This fits the paid D1 1000-query invocation budget and 100-parameter limit. **Large per-item batches need an adequate Workers query budget; D1 Free's 50-query limit is insufficient for larger batches.** The remote account plan was not queried/changed. Sources: [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [atomic batch behavior](https://developers.cloudflare.com/d1/worker-api/d1-database/).

Representative EXPLAIN QUERY PLAN uses `idx_timetable_entries_scope_load` and load primary-key lookups. No reference query is issued per cell.

## Actual local Wrangler / D1 validation

Reproduce: `pnpm run test:teaching-load-matrix:local`.

Wrangler 4.118.0; Node 24.19.0. The script makes temporary configs using `phase19b-local-only` and dummy local ID `00000000-0000-0000-0000-000000000019`. Every command has `--local --persist-to`; the project's remote ID and seed.sql are never used.

| Check | Result |
| --- | --- |
| Fresh chain through 0027 | 28/28 files, zero pending |
| Populated 0026 → 0027 | 27 → 28 applied |
| Full application data comparison | 46 tables identical |
| Loads / entries | 6 / 2, identical IDs and fields |
| Locked entries | 1, same placement/flag |
| Saved versions / version entries | 1 / 2, identical |
| Availability, constraints, revisions, audit | Identical |
| Existing indexes | Identical |
| Replacement/new triggers | Present |
| foreign_key_check | Zero rows |
| Actual local D1 NULL → teacher 1 → teacher 6 | Both passed; entries/locks/versions preserved |

Command forms:

```text
node <repo>/node_modules/wrangler/bin/wrangler.js d1 migrations apply phase19b-local-only --local --config <temporary-config> --persist-to <temporary-state>
node <repo>/node_modules/wrangler/bin/wrangler.js d1 execute phase19b-local-only --file <disposable-fixtures.sql> --local --config <temporary-config> --persist-to <temporary-state>
node <repo>/node_modules/wrangler/bin/wrangler.js d1 migrations list phase19b-local-only --local --config <temporary-config> --persist-to <temporary-state>
node <repo>/node_modules/wrangler/bin/wrangler.js d1 execute phase19b-local-only --command <local-verification-SQL> --local --config <temporary-config> --persist-to <temporary-state>
```

Fixtures populate only the authorized disposable LOCAL database; they are not seed.sql.

Run evidence: `%TEMP%/smart-school-phase19b-local-YR0waq/report.json` plus fresh/upgrade command logs. During development, the harness was corrected to locate the actual D1 file rather than workerd's cache and compare application data separately from workerd's commit counter. Internal `_cf_METADATA` changed 29 → 32 for the schema migration; application rows did not change.

## Automated tests

New suite: **100 passed** — 67 domain/SQL, 26 API/benchmark, 7 UI/SSR/source-contract tests.

Covers strict parsing, tenant/RBAC, null-section/applicability, blank/no-op behavior, inactive history, audit, deterministic plans, stale revisions/two-tab race, all-unchanged revision consumption, injected middle create and swap failures, complete rollback, all teacher hard limits, aggregate loads, historical/break semantics, soft warnings, locks, direct SQL scope/weekly defenses, combined conflicts, safe swaps, stale solver assertions, copies, source omissions and max-500 bounds.

API tests import the real Worker and apply the entire real migration chain. No synthetic employee columns. Actual workerd/D1 migration and reassignment testing is additional, as documented above.

Old absolute-ban assertions became safe-reassignment PLUS unsafe-collision assertions. Route inventory includes the new guards. Timetable/matrix test files run serially to avoid Vite HMR test-server port contention; no cases were skipped.

| Command | Pass | Fail |
| --- | ---: | ---: |
| test:teaching-load-matrix | 100 | 0 |
| test:timetable | 319 | 0 |
| test:subject-management | 59 | 0 |
| test:subject-order | 21 | 0 |
| test:religious-subjects | 39 | 0 |
| test:subject-applicability | 3 | 0 |
| test:flexible-grades | 36 | 0 |
| test:grade-presentation | 9 | 0 |
| test:result-cards | 66 | 0 |
| test:excel-import | 81 | 0 |
| test:security | 22 | 0 |
| test:rbac | 95 | 0 |
| test:student-promotion | 129 | 0 |
| test:student-enrollments | 58 | 0 |
| test:academic-years | 30 | 0 |
| test:student-profile | 24 | 0 |
| test:settings | 5 | 0 |
| Total executions | **1096** | **0** |

**1004 unique tests**: subject-order repeats 21 already in subject-management; RBAC repeats 66 result-card and 5 settings cases. On the same grouping as the 975 baseline: **1075 = 975 + 100**, plus the separately requested 21 subject-order executions.

`pnpm run typecheck`, `pnpm run build:fe`, `pnpm run build:api` passed. Only the existing Vite >500kB chunk warning remains in builds. Validation scripts return nonzero on failure.

## Browser UX verification

Real browser used actual React component at local `/test/fixtures/teaching-load-matrix.html`. The in-memory fixture refuses non-matrix network requests, cannot contact D1/staging and is not a production Rollup input.

Verified class cards, exact applicability, preserved mixed saved values, apply-all periods/teacher, individual override, dirty count, preview old/new values, immediate invalidation on edits, leave warning, whole-class NULL column, explicit save/success/reload retaining class, copy into unsaved draft and responsive scrolling at 390px. Actual client/body width was 382px; table content scrolled inside a 333px container without page overflow.

Automated coverage uses real component SSR, shared draft reducer behavior and focused source event-wiring contracts. No large end-to-end testing framework added. Authenticated remote staging runtime has NOT been tested.

## Performance

Local SQLite / real Worker adapter, diagnostic milliseconds, not remote latency guarantees. Empty-target / populated-source workloads.

| Size | Core read / preview / copy queries | HTTP queries including auth/school | Apply statements | Core read / preview / copy ms | Apply ms | GET / preview / copy bytes |
| --- | --- | --- | ---: | --- | ---: | --- |
| 3 × 2 | 12 / 12 / 14 | 14 / 15 / 17 | 10 | 1.17 / 1.51 / 1.25 | 1.19 | 1039 / 2282 / 2862 |
| 12 × 4 | 12 / 12 / 14 | 14 / 15 / 17 | 52 | 1.03 / 0.90 / 1.21 | 5.53 | 2188 / 16824 / 21101 |
| 20 × 8 | 12 / 12 / 14 | 14 / 15 / 17 | 164 | 0.87 / 0.97 / 1.60 | 16.43 | 3390 / 55649 / 69783 |

Measured HTTP read/preview/copy: 2.34/1.94/1.88ms; 1.81/1.55/1.71ms; 2.00/2.10/28.82ms. Teacher changes additionally check existing schedules and add at most ceil(changing assigned teachers / 90) clearing statements. No N+1.

## Files and reasons

| File | Purpose |
| --- | --- |
| migrations/0027_timetable_safe_teacher_reassignment.sql | Authorized DB guard |
| src/lib/teachingLoadMatrix.ts | Parsing, applicability, summaries, final-state/copy/draft logic and request guard |
| src/lib/teachingLoadMatrixDb.ts | Scoped loading, public projection, atomic statements and safe errors |
| src/worker.ts | Four guarded matrix routes and individual reassignment errors |
| src/lib/api.ts | Typed API helpers |
| src/modules/timetable/TeachingLoadMatrixTab.tsx | Class cards, matrix, draft/copy/preview/confirm UI |
| src/modules/timetable/TimetablePage.tsx | Small integration, dirty navigation, retained advanced editor |
| package.json | Validation commands; serialized timetable test files |
| test/helpers/teaching-load-matrix-fixture.mjs | Genuine schema, transactional D1 adapter/failure injection |
| test/teaching-load-matrix.test.mjs | Domain/SQL/upgrade/rollback/max-size tests |
| test/teaching-load-matrix-api.test.mjs | Worker API/RBAC/tenant/atomicity/performance tests |
| test/teaching-load-matrix-ui.test.mjs | SSR/draft behavior/event contracts |
| test/timetable-foundation.test.mjs | Guarded route inventory |
| test/timetable-grid.test.mjs | Conditional instead of absolute reassignment test |
| test/timetable-ui.test.mjs | Shared school selector with dirty guard |
| test/fixtures/teaching-load-matrix.html and .tsx | Reproducible isolated browser fixture |
| scripts/validate-teaching-load-matrix-local.mjs | Actual fresh/upgrade Wrangler local validation |
| docs/PHASE_19B_QA_REPORT.md | Evidence and deployment limitations |

## Deployment boundary

0027 needs separate authorization before remote migration and authenticated staging matrix/reassignment QA. Pages Preview deployment success alone does not prove the remote DB has this trigger.

No remote D1 command, staging data access/mutation, production access/mutation, remote seed/reset or merge was performed. The Cloudflare/Workers workflow informed the local workerd checks and bounded D1 parameter/query handling.
