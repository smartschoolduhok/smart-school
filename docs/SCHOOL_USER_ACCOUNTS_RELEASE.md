# School user accounts release gate — 2026-10-01

## Scope and deployment order

This release enables school-owner account management with temporary credentials, mandatory password change, revision-checked writes, session revocation and append-only auditing. Additional timetable optimization remains deferred; this branch contains no timetable-engine changes.

The target is the existing **STAGING** Pages project `smart-school-staging` and its `DB` binding to `smart-school-staging-db` (`1bdb9c3d-08d6-4023-9cbc-64369d53198a`). Pages' `production` environment within that project is the staging main URL, not the application's separate Production environment.

Apply only `0052_school_user_accounts.sql` before deploying the new application. The authenticated release gate must verify both Pages deployment configurations use this database, capture a fresh private export, restore it exactly into isolated D1, and rehearse the migration. Require the existing 52 migration records to match the repository prefix and only 0052 to be pending. Do not replay 0042–0045 or blindly apply older pending migrations.

After migration, require 53 unique migration records, an unchanged historical prefix, clean foreign keys, exact preservation of all prior user columns and other business tables, and schema matching the rehearsal. The three new user columns default to `0`, `NULL`, and `1`; audit and guard tables start empty.

## Local evidence

- API/security: 54 cases passed; mounted account UI: 15 cases passed.
- Genuine workerd D1: 0051→0052 preserves typed historical data and the declared schema contract; 27 API requests passed, including native batch rollback. Foreign-key violations and residual write guards: zero.
- Genuine school workflows: upgrade from the historical 0041 baseline to all 53 migrations preserves prior business values and types; existing communication, grade-progress and admissions/transfer scenarios passed.
- Fresh local export/restore: exact application snapshot across 99 tables, including oversized rows, with clean foreign keys.
- Historical finance D1 validator: 40 checks and 63 API requests passed. The 0027→0028 preservation contract is checked first, then actual auth migrations 0029/0052 are added before calling current authenticated APIs; the deliberate financial drift remains unchanged.
- Full local regression matrix: **2175/2175**, zero failures or skips. TypeScript, frontend/Worker build and dependency audit passed (zero vulnerabilities). Authenticated QA, final-head CI and post-merge deployment remain release gates until their evidence is recorded below.

## Remote QA and cleanup contract

Use synthetic, clearly marked accounts and resources in QA school 2. Check owner creation for every allowed role; rejection of protected roles, self-edits and other-school access; edit, stale revision, status and reset; teacher/parent links; restricted cookies and bearer sessions; password change and old-session rejection; audit access and absence of credentials. Verify the old deployed bundle rejects temporary credentials and sessions during the shared-database transition.

Inspect the rendered RTL interface and forced-change flow on desktop and a narrow viewport. Verify authentication and account APIs again on the canonical main deployment after merging. Retire fixtures through account disabling, access-link revocation and session invalidation; preserve audit history. Compare all pre-existing business data and full protected school 1/3 projections before and after QA. Do not adopt or clear actual timetables, upload R2 objects or mutate Production.

## Rollback

If QA fails, keep the previous main deployment and fix the candidate. Migration 0052 is additive for existing accounts. The old bundle rejects new temporary credentials and restricted sessions; users with such credentials must wait for the corrected release or an authorized reset. Do not restore an entire database over newer writes merely to roll back frontend code. Preserve evidence and stop further writes if any unexpected data change is found.

## Release attestation

- Authenticated target verification confirmed both preview and main deployment configurations bind to the specified STAGING D1 database and existing staging R2 bucket.
- Fresh private export: 2,878,129 bytes, SHA-256 `1c3276b05aa71af376a00d19305ce9f4eb9f267666c7a4c9aad9f45c2f107060`. Exact isolated workerd D1 restoration and 0052 rehearsal passed, including oversized rows and independent schema comparison.
- Remote migration: applied **0052 only**, after an immediate snapshot match. All 52 prior migration rows and all historical business values/types were preserved; schema matched the rehearsal, new columns had expected defaults, both new tables were empty, readiness was unchanged, and foreign-key violations were zero. All school 1/3 data was preserved.
- Authenticated [preview QA](https://e885737f.smart-school-staging.pages.dev): 133 recorded HTTP requests and 293 successful assertions. The first run stopped because Node fetch added browser metadata to an explicit bearer client; the server correctly rejected it. The harness resumed with a genuine non-browser transport. All authorization, stale-write, password lifecycle, old-bundle rejection, link revocation and audit checks then passed. No application fix was needed for that transport issue.
- Chrome verified owner login, the six permitted roles, protected self-account, an actual synthetic profile edit, clear RTL controls at 390px without horizontal overflow, mandatory password-change routing including a direct private URL, and logout. Password-change submission and session invalidation were verified through authenticated APIs and mounted UI tests.
- Eight generated accounts and both access links were disabled; the generated employee and unplaced student were archived through supported APIs. Audit records remained identical and foreign keys stayed clean. Two bootstrap QA actors remain only for final main-deployment checks and must then be retired.
- After fixture cleanup, all **6,027 historical business rows across 96 business tables** retained their exact SQLite types and bytes. All additions were limited to the declared QA fixtures and account audit; schools 1/3 had no changed, deleted or added business rows. Authentication housekeeping was measured separately, schema/history/readiness stayed unchanged, and foreign keys were clean.
- Application behavior was tested at `7987431`. Subsequent changes affect test fixtures, diagnostics, this report and an erased TypeScript response annotation matching the existing server contract; a rebuilt frontend/Worker was byte-identical to the tested build. The final CI and deployment evidence, merge SHA and bootstrap retirement are recorded in the [PR #70 release attestation](https://github.com/smartschoolduhok/smart-school/pull/70). Private SQL, credentials and school data remain outside Git and Notion.
