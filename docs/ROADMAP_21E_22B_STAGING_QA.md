# Phases 21E–22B — authenticated STAGING evidence

Gate result: **PASS**, 2026-09-26. This is the execution record for [the approved gate](ROADMAP_21E_22B_STAGING_GATE.md) and [PR #53](https://github.com/smartschoolduhok/smart-school/pull/53). Final documentation HEAD/tree and CI, followed by merge/main CI/Pages and the root-binding smoke test, are recorded in that PR's release attestation and the [Notion execution page](https://app.notion.com/p/3e5c32b8b70681d884e9facd68171250). Those external records identify the final commit without a self-referential hash in its own tree.

## Identity and revisions

- Requested resume HEAD: `4344d07d0aa2757282315bed007af32352388875`, tree `a87c9e41606f77819b26925675fcafa995889899`.
- Migration/parser correction: `40a47366d33c5ed391587c286ea9d14aa7eb3e54`, tree `472ad2bb41196f7cbe7d7a5d552fc67914eed9d8`; [CI PASS](https://github.com/smartschoolduhok/smart-school/actions/runs/36253697110), [automatic immutable preview](https://ccb29504.smart-school-staging.pages.dev).
- Final executable code: `b08a36f3f21711d12e2509bf3fc2c6043f119e22`, tree `2df3128cb1ddaefa091cc3705c7c7104e943a1fb`; [CI PASS](https://github.com/smartschoolduhok/smart-school/actions/runs/36254901141), [automatic immutable preview](https://bbaff423.smart-school-staging.pages.dev).
- Cloudflare account `8d30029482b5722704371f03169c5ca1`; D1 `smart-school-staging-db` / `1bdb9c3d-08d6-4023-9cbc-64369d53198a`; Pages `smart-school-staging`; existing private R2 `smart-school-homework-staging`. Both previews' exact commit, successful stage, DB UUID and R2 binding were verified through authenticated Cloudflare APIs.
- The isolated managed worktree preserved unrelated work. No manual deployment, force-push, auto-merge or unidentified Production access occurred.

## Backup, exact restore and migration

Private evidence is retained outside Git in `C:\Users\ibrah\Documents\SmartSchoolBackups\pr53-staging-20260926`. It includes the SQL exports, typed snapshots, exact fixture manifest, request checks and browser images/PDF. No credentials, raw backup SQL or real student rows are included in this report or Notion.

| Check | Observed result |
|---|---|
| Baseline | 42 distinct migrations through 0041; exactly 0042–0045 pending; 83 total / 81 application tables; clean FK |
| Full export UTC | 2026-09-26 15:51:14.307–15:51:18.867 |
| Backup bytes | 1,558,490 |
| Backup SHA-256 | `d9d39d531401827773013d23f8ec47a8f2f8743e5d021eaa3494275c1bed6dda` |
| Exact restore | Schema, rows, values and SQLite types equal; 2,525 statements, seven chunks; oversized row restored with 16 parameters / 360,514 bytes |
| Local upgrade rehearsal | Only 0042–0045; all 81 historical application tables preserved, readiness equal, 46 distinct / 95 total / 93 application tables |
| Immediate drift gate | Repeated snapshot equal; repeated full export byte-for-byte and SHA-256 equal, including the final check after parser correction |
| Remote application UTC | 2026-09-26 16:04:49.889–16:04:52.973 |
| Applied set | 0042 parent communication, 0043 grade progress, 0044 regulations, 0045 admissions/transfers, each exactly once |
| Immediate postflight before fixtures | All 81 prior application tables exactly preserved; readiness equal; 46 distinct migrations, 0045 last, none pending; 95/93 tables; clean FK |

Preflight snapshot digest: `43c8145a273269c6b4e097eab0dec6e6bc56cd31e1b7e656005849cf81ebfcd2`. Immediate post-migration digest: `d0bc01cbf9cd9ad3b4653a1e4cc82910f6cf3c620b65bb02288ca849fa07da7a`.

The first remote attempt failed with D1 `incomplete input` before committing a migration. A fresh typed snapshot proved the database was unchanged. Still-unapplied triggers were rewritten to equivalent `SELECT RAISE(...) WHERE ...` guards and `iif` values to avoid D1's bare-CASE parser issue. Rehearsal, CI and drift checks were repeated before the successful application. No already-applied migration was edited.

## Authenticated QA

All fixtures were synthetic and tagged `[QA PR53-20260926]`, in school 2. Seven disposable role accounts, four students (including the two executed incoming registrations), one employee, one class/section and two subjects were used. Synthetic regulation sources explicitly state that they are not official guidance. The API harness recorded **277 expected-status requests, 22 aggregate assertions and no failures**, plus browser and published-card regression checks.

| Area | Verified behavior |
|---|---|
| 21E | Parent to assigned teacher and registrar staff thread; manager oversight; participant-only registrar; unrelated teacher/parent/accountant and schools 1/3 denied; literal malicious-looking text safely escaped; 53-message pagination as 50+3; staff reply, unread/read acknowledgement; close/reopen reasons; stale and closed writes rejected; exact retries add no message/audit/notification; revoked current link hides thread and notification |
| 21F | Teacher sees assigned subject only; principal sees both fixture subjects; zero differs from missing; preview writes nothing; delivery confirmation required; grade/settings/assignment drift and disabled period reject; publish/retry is idempotent; parent sees safe snapshot only; raw grades/history denied; current teacher/parent revocation enforced even on replay; withdrawal hides report and notification; republish works |
| 22A | Sourced draft and audit; invalid URL, dates and foreign scope denied; management-only approve/retire; mandatory reason and source attestation; supersession/retirement retain history and invalidate old approval |
| 22B | Missing rules/documents/birth/facts require review; completed-month age boundary (72 months), repeats and acceleration rules; admission preview/approval/execution and exact retry create one student/enrollment; source/capacity/role drift blocks write; cancel/reject/reopen audited; incoming source/document required; outgoing transfer preserves grades and finance; no cross-tenant identity movement |
| Regression | Homework publish/feed/withdraw; existing protected attachment downloaded with exact byte count and SHA-256; current R2 guard unchanged; parent notifications; published-card endpoint returns only linked published data, unlinked child concealed with existing 404 contract; all official cards/annual decisions and finance rows remain exact |

A brief, recorded system-admin role on the tagged school-2 fixture tested the explicit school selector; it was restored to principal immediately afterward. No protected-school business write occurred.

## Real browser and correction

Chrome exercised Arabic RTL at 390×844. Communication, progress, regulations and admissions had no horizontal overflow (document widths 382 or 390px). Keyboard focus was visible; teacher publication remained disabled until delivery confirmation, and the browser publication succeeded afterward. Parent controls exposed only published viewing/printing.

Held responses were released after switching conversation selection and after clearing the selected school; old data did not repopulate the new selection. Native print was invoked and the resulting one-page A4 PDF (594.96×841.92 points) was rendered and visually inspected for RTL/clipping.

An intentionally failed progress Fetch request exposed an error banner that survived a later successful refresh. Commit `b08a36f` clears that stale error; the new mounted regression failed before the fix and passed after it. The real browser repeated failure → refresh → error disappears on the new automatic preview.

Expected negative API requests and the injected Fetch failure are kept separate from successful paths. A long browser trace exceeded event retention, so successful progress, notification, communication, admission and regulation paths were captured again in bounded batches: 25 network events, no truncation and **zero unexpected network/console/runtime errors**. Interception and viewport overrides were reset and browser accounts logged out.

## Cleanup and exact preservation

- Two conversations closed with a reason; 54 messages, read acknowledgements and immutable audits retained.
- All three QA progress reports withdrawn. Approved synthetic regulations retired; unexecuted actionable applications cancelled. Executed admissions/transfers and rejected/cancelled history preserved.
- Four tagged students and one employee archived through canonical endpoints. Enrollment history compared before/after archive and preserved. Tagged users (seven), parent/teacher links, teaching load, subject assignments, subjects, section and class disabled. Auth versions incremented; old token rejected with 401.
- No business-row or audit deletion; no payroll, deduction, fee or treasury movement.
- A schema-enumerated baseline compared **91 protected projections**, including nine joined child/audit/guard mappings, for schools **1 and 3**. Exact rows, values and SQLite types remained equal. Digest before/after: `e37173ad3d55f6ef08a47346ab3c900a29d0f0533128cbe3bb7f931b60231c72`.
- The additional historical-row audit checked 1,979 prior rows across 91 tables. No historical business row was deleted. In school 2 only, grade-settings values were restored but their trigger-updated timestamp changed; creating/deactivating the QA load advanced timetable revision/timestamp. Existing authentication cleanup removed three already-expired school-2 revoked sessions. These expected metadata changes are explicitly distinguished from exact protection of schools 1/3.
- Final readiness equals the pre-QA baseline, including the pre-existing school-1 result-card inconsistency and school-3 partial academic policy setup. These historical conditions were not introduced or repaired by this gate. All finance and official-result rows remain exact; all write guards/assertion tables are empty; FK clean; 46 distinct migrations, none pending.

Cleanup export: 1,715,149 bytes, UTC `2026-09-26T16:30:10.501Z`–`16:30:15.203Z`, SHA-256 `e17ceabd52bd41a0fddd8b874d0e6d262316282b3bd46e57db6eca4e1fd76e0b`. The private fixture credential is retained only until the post-merge read smoke test; all fixture accounts are inactive at gate closure. Post-merge root-binding verification temporarily reactivates only the tagged principal, then disables it, invalidates its session and clears the credential again; the release attestation records its final protection/inventory check.

## Storage and release

Complete paginated account inventory: **one existing private R2 bucket, three objects, 154 bytes** before migration, after regression and after cleanup. Keys, sizes, content hashes and custom metadata reconcile with active D1 attachments; no pending attachment or orphan. **Uploaded bytes: zero.** Account usage is below 10,000,000,000 bytes and the unchanged app cap remains 1,000,000,000 bytes.

Final code CI passed **1,633/1,633** regression executions across 33 suites, seven mounted workflow UI tests, the genuine local D1 scenarios, exact backup/restore, dependency audit (zero vulnerabilities), typecheck and frontend/Worker build. The existing SheetJS chunk-size warning is non-fatal. Documentation-only changes follow this tested code; their exact CI/automatic preview and subsequent main deployment are recorded in PR #53 and Notion before declaring release complete. Real official-source configuration and the school-staff pilot remain operational follow-up.
