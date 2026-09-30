# Timetable search controls

Base: `d1edc74fede863952a3f3736e51df2190db1b16a` (PR #68).

Generation now offers 90-second / 8-start, 5-minute / 50-start and 15-minute / 1000-start maximum budgets. Wall time, per-start search work and validation limits remain bounded; a perfect complete result ends early. Search continues in a dedicated browser worker, with timeout aligned to the selected duration and cancellation available.

Saved-timetable reoptimization and displayed-proposal reoptimization validate and rescore their baseline against the fresh server input. The baseline participates in comparison and seeds alternate search starts. Higher coverage wins, then fewer daily doubles, then light opening penalties, then total weighted penalties. An inferior or tied new result cannot replace a valid better baseline. Stale or invalid baselines are rejected visibly. Cancelling a displayed-proposal reoptimization retains that proposal.

Preferences are stored per school, with immutable coverage and hard constraints. `early_light_subjects` is an on/off priority; the eight other groups accept off/normal/high multipliers. Defaults preserve the previous scoring weights. Both candidate ranking and final scoring use the same school preferences; reported observations remain actual counts even when their preference is disabled.

`GET/PUT /api/timetable/preferences` use existing tenant resolution and academic management roles, strict input validation, optimistic revision checks and recorded updating user. Preference changes invalidate proposals for that school's years through timetable revision triggers. Preparation loads preferences from D1; clients cannot override them in preparation requests. Adoption continues to validate authoritative scope, quotas, locks, availability, teacher conflicts and daily-subject rules.

## Release gate

Apply `0051_timetable_school_preferences.sql` to the explicitly configured STAGING D1 database after a verified backup, before deploying/merging this change. It creates an empty school-preferences table and revision triggers; it does not rewrite timetable entries or loads. Production and remote school data have not been modified by this work.

Required STAGING acceptance: owner/principal preferences reads and save, a second school's isolation, changed-policy stale adoption rejection, saved and preview baseline retention, all three durations in the browser, cancellation, scoped/fixed/parallel lesson preservation, and authenticated adoption preview. Use a synthetic fixture or read-only private snapshot for search; do not publish real school data in repository evidence.

## Local validation

The first PR CI attempt stopped at the dependency audit before application checks: the existing `brace-expansion` 2.1.4 lock entry acquired security advisories. The lockfile now uses the compatible 2.1.7 patch; no dependency ranges or audit thresholds were relaxed.

- TypeScript and frontend/Worker production builds passed. The existing Vite large-chunk warning remains non-blocking.
- Full regression matrix completed; after fixing the route-count assertion for the two new authorized endpoints, affected suites were rerun: timetable **636/636**, parallel and UI **37/37**. All other matrix suites passed.
- Genuine Wrangler local D1: fresh migration/seed passed; **52 SQL migrations** include 0051. Backup/restore reproduced **97 tables** with an exact application snapshot and clean foreign keys.
- Tests cover more than eight starts, total search deadline, a 15-minute worker timeout, baseline retention/improvement/rejection, cancellation, weighted scoring, independent school preferences, stale policy writes, and stale proposal adoption.
- Remote migration, deployment and authenticated STAGING acceptance remain pending because this session has no authenticated Cloudflare access.
