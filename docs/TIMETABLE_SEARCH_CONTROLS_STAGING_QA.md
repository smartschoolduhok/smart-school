# Timetable search controls — STAGING release evidence

Pre-merge gate: **PASS**, 2026-09-30, for [PR #69](https://github.com/smartschoolduhok/smart-school/pull/69). Functional candidate `7885dc3f11270c83bf99f4a1130c5e18b1677dee` was tested on [its authenticated Pages preview](https://a51bb371.smart-school-staging.pages.dev). The release also repairs local backup restoration and adds three regression cases; application behavior and deployment bindings are unchanged by that repair.

## Verified target and migration

- Authenticated Cloudflare account and tracked config agree. Pages project `smart-school-staging`, preview and main deployment configurations both bind `DB` to `smart-school-staging-db` / `1bdb9c3d-08d6-4023-9cbc-64369d53198a`. Main uses these STAGING resources even though Pages calls its main environment "production". No actual PRODUCTION resources were modified.
- Fresh private SQL backup: **2,623,680 bytes**, SHA-256 `fa2408182f9d37b56b69a127ad44321b08822bab3731a84c4e21ff42fd31a3bb`. Stored outside Git in a directory with restricted Windows ACLs. Exact restore to isolated local workerd D1 matched schema and every SQLite value/type. An immediate remote snapshot matched the preflight before writing.
- Before: **51 migrations**, only `0051_timetable_school_preferences.sql` pending. Every earlier filename matched the repository's sorted migration history; `0042`–`0045` were never reapplied.
- A temporary config kept the verified STAGING identity and selected a directory containing **0051 only**. Wrangler applied it with normal migration-history recording. After: **52 migrations**, none pending, **97 total / 95 application tables**, clean foreign keys.
- All **94 pre-existing application tables** were byte/type-equivalent before and after migration, including schools 1 and 3, timetable entries, teaching loads, revision rows, saved versions and audits. Only the empty preferences table and its two revision triggers were added. Existing migration-history records and non-migration sequences were preserved.

## Authenticated acceptance

Normal cookie/CSRF login used named synthetic accounts. New inactive years and named masters were created through the authorized APIs in the existing QA school. A second named synthetic school verified independent policy storage. No real students or real-school timetable adoption/clearing was used.

| Check | Result |
|---|---|
| Owner/principal policy read and save; teacher denial; strict levels | PASS |
| Second-school independence and reciprocal cross-tenant read/write denial | PASS |
| Stale preference writes; policy-change rejection of old apply and adoption preview | PASS, HTTP 409, exact official rows unchanged |
| Quick/extended/deep selection and actual browser worker execution | PASS, observed 8/50/1000 search rounds |
| Live progress and cancellation | PASS, progress observed at 43/1000; cancel retained displayed proposal |
| Total deadline with a retained verified result | PASS on authenticated STAGING preparation using an explicit 2-second test budget; full configured deadline/no-result cases also pass CI |
| Saved and displayed valid baseline retention | PASS, retention notice visible; no better result replaced it |
| Invalid/stale baseline exclusion | PASS, explicit exclusion/fresh-preview notices |
| Section/class/stage/school generation; fixed and outside lessons | PASS, exact outside IDs/timestamps/locks preserved |
| Parallel lessons and authoritative server constraints | PASS, paired slots aligned; missing companion rejected without writes |
| Browser comparison/adoption preview | PASS, synthetic proposal accepted for preview; no additional browser adoption |
| Forged/missing scope proof, membership drift, teacher permissions, occupied-day reduction and capacity deficits | PASS, rejected without timetable writes |

Preference-save tests intentionally increment timetable revisions in the QA school's years through the new triggers. Every pre-existing QA timetable row and active year remained unchanged; only those verified revision/timestamp increments are allowed by the comparison. Schools 1 and 3 match their exact typed preflight snapshots across all school-owned and joined audit/session projections. Foreign keys are clean and transient write guards are empty.

## Restore repair and validation

The real export exposed two cases absent from the fresh-seed drill: a populated child preceding its rebuilt parent table, and a timetable archive snapshot exceeding the SQL statement-size limit. The restore helper now creates all exported tables before loading rows, validates export foreign keys, and supports exact bound insertion for oversized import/timetable snapshot rows. It still rejects unsupported oversized tables; financial records are not rewritten. Exact local D1 restore and upgrade passed with both a 16-parameter import row and an 8-parameter archive row.

- Full local regression matrix: **2106/2106**, zero failures/skips (three added restore cases).
- TypeScript, frontend/Worker builds and audit: PASS, **zero vulnerabilities**. Existing Vite chunk-size warning remains informational.
- Genuine local D1 backup/restore: PASS, **52 migrations / 97 tables**, exact schema/data and clean foreign keys.

## Release attestation

Final-head CI, final preview recheck, merge SHA, post-merge Quality Gates, verified automatic main deployment URL and post-deployment API/browser checks are recorded together in PR #69 and the approved Notion project page. They identify immutable commits without embedding a self-referential hash in this document. Fixture retirement uses the existing non-destructive cleanup procedure: remove only captured synthetic editable timetable entries through APIs, deactivate synthetic loads, archive synthetic masters, retain inactive years and historical versions, disable QA accounts and invalidate sessions. Raw backups, school snapshots, credentials and browser evidence remain private outside Git/Notion.

No R2 object upload, seed/reset against remote D1, manual parallel Pages deployment, merge-check bypass or lowered validation threshold was used.
