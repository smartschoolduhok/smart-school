# Phases 21E–22B — STAGING execution gate

Execution result (2026-09-26): **PASS**, with [backup, exact preservation, authenticated QA and cleanup evidence](ROADMAP_21E_22B_STAGING_QA.md). The steps below retain the original 42→46 execution contract; they are not an instruction to reapply the now-completed migrations. Final documentation HEAD/CI and post-merge STAGING release attestation are recorded on [PR #53](https://github.com/smartschoolduhok/smart-school/pull/53).

Ibra has already approved the remaining work and fixes. **Do not ask for the same approval again.** Use the current authenticated Codex environment to execute this gate. The Work Mode implementation session could not perform it because Wrangler was not authenticated. Do not mark this gate passed from local tests or a successful Pages build.

## Exact scope and initial state

- Repository: `smartschoolduhok/smart-school`, branch `codex/phase21e-22b-completion`, base `dd9646334d57b1bba5ed9e6ec34e4f85f6d11206`.
- Read the Draft PR for the final HEAD/tree and successful CI/Pages check. Fetch that exact revision into an isolated worktree; record `git rev-parse HEAD` and `git rev-parse HEAD^{tree}`. Stop remote mutations on a mismatch; inspect and resolve the revision evidence first.
- Cloudflare account: `8d30029482b5722704371f03169c5ca1`.
- D1 only: `smart-school-staging-db` / `1bdb9c3d-08d6-4023-9cbc-64369d53198a`.
- Pages only: `smart-school-staging`. Preview and its main deployment both belong to STAGING. Do not access an unidentified application Production environment.
- Existing private R2 only: `smart-school-homework-staging`. Reuse it. No new bucket, public access or new file features.
- Expected before state: 42 distinct migrations through `0041_homework.sql`, 83 total / 81 application tables, clean FK; exactly the following four pending files, in order:
  1. `0042_parent_communication.sql`
  2. `0043_grade_progress_reports.sql`
  3. `0044_admission_regulations.sql`
  4. `0045_admissions_transfers.sql`
- Expected after state: 46 distinct migrations; each of these four exactly once; `0045` last, no pending; 95 total / 93 application tables; FK clean. Never reinterpret table counts ad hoc to make a failed assertion pass.

## Preparation, backup and local rehearsal

1. Read applicable `AGENTS.md`, this document, the implementation report and environment/deployment docs. Install locked dependencies. Verify the Git revision, successful CI and immutable preview identity. Preserve unrelated work.
2. Verify Wrangler identity, the exact account, database UUID/name and Pages project. Check R2's complete account inventory and actual object sizes without logging credentials/signed URLs. Keep the account below `10,000,000,000` bytes; homework's app guard remains `1,000,000,000`. This gate needs no file uploads; if a homework regression requires one, keep all QA below `100,000,000` and reconcile it.
3. Create an evidence directory **outside Git**. In the examples below `<evidence>` means its absolute path; replace it appropriately for the shell. Never paste secrets into commands, PRs or Notion.
4. Run the read-only snapshot:
   `node scripts/run-roadmap-staging-preflight.mjs <evidence>/preflight.json --confirm-staging`
5. Export the full target with Wrangler D1 export using `--remote`, the explicit database name, tracked config and an output path under `<evidence>`. Record UTC start/end, byte count and SHA-256. Redact signed export URLs from logs.
6. Run:
   `node scripts/run-roadmap-local-rehearsal.mjs <evidence>/backup.sql <evidence>/preflight.json <evidence>/local-rehearsal.json`
   Require complete restored schema/values/types/rows equality, including oversized-row parameter binding, followed by successful local application of only the four pending migrations. Historical business rows, types and readiness must remain identical.
7. Immediately before remote writing, rerun read-only preflight to a new file and re-export to `<evidence>/before-write.sql`. Compare the two export files **byte-for-byte and by SHA-256** and compare snapshots. Any drift means stop, capture a fresh baseline/backup and rehearse that baseline before writing.

## Migration and postflight

1. Reverify HEAD/tree and the exact pending set. Apply only the pending set above using `wrangler d1 migrations apply smart-school-staging-db --remote --config wrangler.jsonc`. This command is permitted only while pending contains exactly those four files. Record each migration and UTC timings. Do not reapply earlier migrations, seed, reset or issue business-row DELETE.
2. Run immediately, **before QA fixtures**:
   `node scripts/run-roadmap-staging-postflight.mjs migration <evidence>/preflight.json <evidence>/post-migration.json --confirm-staging`
   This verifies all old business rows and readiness exactly. It intentionally has no QA mode: after fixtures, compare protected schools separately.
3. Capture a new pre-QA typed baseline for protected schools 1 and 3, including joined child/audit tables with no direct `school_id`. Enumerate tables from the schema; do not reuse an obsolete fixed count. No remote operation may mutate either protected school's business data.
4. Use the automatically created **immutable preview URL for the tested HEAD**. Do not manually deploy merely to create a new URL. Confirm the preview's DB and existing private R2 binding through authenticated functional checks. Root R2 binding is configuration for the eventual STAGING main deployment; it must not be mistaken for application Production authorization.

## Authenticated QA — tagged fixtures in school 2 only

Create uniquely tagged users, teacher/parent links, students, enrollment, class/section and load only as necessary. Use synthetic source references visibly marked QA, not an invented official regulation. Record exact expected responses and before/after counts. Never edit an existing school's active regulations for convenience.

- **21E:** parent→assigned teacher and school staff conversations, staff reply, unread count/read acknowledgement, message escaping, pagination, close/reopen reason; duplicate request produces no duplicate message/audit/notification; stale revision and closed reply rejected; other parent/teacher/tenant denied; disabled link immediately hides thread and notification. Confirm manager oversight and registrar participant boundary.
- **21F:** teacher sees only assigned subject scores, missing ≠ zero, disabled periods rejected; preview does not write; delivery confirmation mandatory; stale grades/settings/assignment reject publication; exact retry is idempotent; linked parent sees safe published snapshot and A4 output only; raw grades/history return 403; withdrawal hides report/notification; current-link revocation also blocks publication replay. Published official cards/annual decisions remain unchanged.
- **22A:** create sourced draft and inspect audit; only management can approve/retire; mandatory reason/attestation; effective date, invalid URL and scope checks; superseding/retiring source preserves history and blocks execution from old approval. No production ministry rules are entered by this test.
- **22B:** missing rules/docs/facts lead to review; age/month boundary, repeats and acceleration rules; admission preview+approval+execution; incoming document and source; outgoing transfer preserves historic grades/finance; capacity/role/source drift blocks write; retry produces one student/enrollment; cancellation/rejection/reopen audited; no cross-tenant identity movement.
- **UI:** real browser Arabic RTL at 390px, keyboard/focus, no horizontal overflow, errors recover cleanly, school/selection switching cannot display late data from the old selection, print invoked and output inspected where native print is available. Record expected negative request errors separately; no unexpected console/network errors on successful paths.
- **Regression:** existing homework feed/publish/withdraw/download with its current R2 guard, published result cards and parent notification feed. Do not create payroll, deductions or treasury movements.

## Cleanup, evidence and completion

- Close QA conversations with a reason; keep messages/read/audit history.
- Withdraw QA progress; retire QA approved regulations; cancel unexecuted requests. Preserve executed admissions/transfers and their immutable audit. Archive only tagged fixture students/staff and deactivate tagged users/links/loads after checking historical triggers. No business-row DELETE or audit deletion.
- Reconcile R2/D1 and actual account bytes; document whether this gate uploaded zero bytes. Existing object inventory is evidence, not an assumed quota ceiling.
- Compare schools 1 and 3 against the pre-QA typed baseline across all relevant tables and joined child tables. Require exact rows/values/types. Record the comparison digest outside Git.
- Recheck migration history/no pending/FK and leftover write guards; zero orphan guards; retain the exact fixture manifest and safe cleanup evidence outside Git.
- Update README, implementation/gate report, PR and Notion with actual results, backup bytes/hash, timings, immutable preview URL and final HEAD/tree. Keep real student data, secrets and raw backup SQL out of Git and Notion.
- Wait for CI and automatic preview on the final documentation HEAD. With the existing user authorization, proceed to normal review/merge only after this gate passes; then verify main CI/Pages and the root STAGING homework binding. A failed gate stays Draft with concrete blocker evidence. No force-push, auto-merge or speculative rollback.
