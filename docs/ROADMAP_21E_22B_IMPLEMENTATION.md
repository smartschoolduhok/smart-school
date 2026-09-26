# Phases 21E–22B — implementation and verification

Implementation baseline: `main@dd9646334d57b1bba5ed9e6ec34e4f85f6d11206` (merged Phase 21D / PR #52). Branch: `codex/phase21e-22b-completion`. Ibra authorized completing the remaining phases and fixes on 2026-09-24.

**Status: implemented and locally verified; authenticated STAGING gate is pending.** This report does not assert that the new migrations, browser QA or bindings have been applied remotely. The current Work Mode environment has no authenticated Wrangler session. The executable handoff is [ROADMAP_21E_22B_STAGING_GATE.md](ROADMAP_21E_22B_STAGING_GATE.md).

## Delivered scope

| Phase | User behavior | Main controls |
|---|---|---|
| 21E | Private student conversations between the linked parent and school staff/assigned teacher; replies, read acknowledgements, close/reopen, in-app notifications | Current links and teaching load checked on reads and atomic writes; teacher/parent revocation hides messages and notification feed; immutable messages and audit; request keys and revisions |
| 21F | Preview and publish an interim monthly, term or mid-year progress report after confirming delivery to the student; parent views/prints the published snapshot; withdraw and republish for correction | Current teacher assignment, source digest checked inside the write batch, explicit delivery confirmation, immutable source/snapshot, linked-parent publication boundary |
| 22A | Draft, approve, supersede or retire a sourced regulation version for a school/year/class/process | Source reference, URL, jurisdiction, effective dates, management attestation, one approved version per scope, immutable version content and audit |
| 22B | Submit admission/incoming/outgoing transfer requests; review facts, preview eligibility, approve, execute, reject/cancel or reopen before execution | Source/age/repeats/acceleration/documents evaluation, missing information means review, capacity and identity checks, approval snapshot/digest, atomic recheck and enrollment writes, immutable audit |

The existing monthly/term/bulk grade editor, revision audit, official result cards and annual promotion remain the source workflows. Phase 21F adds an interim publication channel; it never rewrites historical official results. Parent calls to raw `/api/grades`, `/api/students/:id/grades` and grade history now return 403. Parents use published progress and the existing published result cards. This deliberately closes access to unpublished raw scores and internal notes.

Regulations contain **no seeded statutory values**. Synthetic tests are marked TEST/LOCAL and are not ministry guidance. Real admissions require an authorized school operator to supply and verify the applicable official source and school jurisdiction. Age is calculated in completed months on the configured reference date; omitted rules or documents are not silently treated as eligible.

Transfers preserve student school identity. Incoming transfer references the external origin; it does not move another tenant's student ID. Outgoing transfer closes the eligible annual enrollment and deactivates its current subject assignments, preserving grades, finance and official decisions. An existing enrollment or incompatible current assignments blocks an incoming admission until reviewed. Executed applications are immutable and retry without duplicate registration. Retiring/replacing a regulation invalidates an earlier approval's source digest.

## Routes and access

| Route family | Access |
|---|---|
| `/api/communication` | Management oversight; registrar as conversation participant; teacher under current linked assignment; current linked parent for the conversation's child |
| `/api/grade-progress` | Academic staff; teacher's own publications with current assignment; parent only published snapshots of linked children |
| `/api/regulations` | Management/registrar read and draft; management approve/retire |
| `/api/admissions` | Management/registrar read, submit, amend review facts and execute approved requests; management approve/reject/cancel/reopen |

System administrators must explicitly select a school. Accountants cannot access these academic/communication workflows. All new UI routes enforce the matching role boundary. In-app notification text omits message bodies and scores; references navigate to the protected feature. No SMS/email/WhatsApp delivery or new file upload is introduced.

## Schema and deployment dependency

| Migration | Tables added |
|---|---|
| `0042_parent_communication.sql` | `parent_conversations`, `parent_messages`, `parent_conversation_reads`, `parent_conversation_audit`, `communication_write_guards` plus the current-access view |
| `0043_grade_progress_reports.sql` | `grade_progress_reports`, `grade_progress_audit`, `workflow_write_guards` |
| `0044_admission_regulations.sql` | `admission_regulations`, `admission_regulation_audit` |
| `0045_admissions_transfers.sql` | `admission_applications`, `admission_application_audit` |

Expected STAGING upgrade: 42 distinct migration records through `0041` to 46 through `0045`; 83 total / 81 application tables to **95 total / 93 application tables**, excluding `_cf_*` and statistics from totals and excluding `d1_migrations` / `sqlite_sequence` from application tables. The two historical `0014` files are both counted. The migrations are additive; they do not update old business rows.

The new notification access predicate requires `0042`; branch preview build success alone is not runtime acceptance before migration. Gate order is backup, restore/rehearsal, immediate drift check, exact migration set, postflight, then authenticated browser QA on an immutable preview.

`wrangler.jsonc` now declares the existing `HOMEWORK_FILES → smart-school-homework-staging` binding at the root as well as `env.preview`. This is a **tracked configuration change** for the existing STAGING Pages project's main deployment, not a claim of remote deployment or a new bucket. Main previously lacked the homework binding after PR #52 merged. Both DB configurations still identify only the authorized STAGING D1.

Storage controls are unchanged: homework cap `1,000,000,000` bytes, user account ceiling below `10,000,000,000` bytes, QA budget below `100,000,000` bytes. This work performed no remote upload. The previous 154-byte account observation belongs to the Phase 21D report and must be remeasured before remote work.

## Local verification evidence

- TypeScript and frontend/Worker build passed. Existing SheetJS chunk-size warning remains non-fatal.
- Focused API/security/domain tests: communication 8, grade progress 7, regulations/admissions 12. Cover tenant boundaries, current-link revocation, stale source/capacity changes, idempotency, immutable history and late-write rollback.
- Six mounted React/Happy DOM tests cover parent publication boundaries, confirmation requirements, stale audit response discard, incomplete-rule blocking, registrar execution controls and safe rendering of message text. These are behavioral component checks; **they do not establish real-browser layout or 390px overflow acceptance**.
- `npm run test:school-workflows:local` passed against real local workerd D1: populated 42→46 upgrade preserves all 81 old application tables; communication/read/status, progress publication/replay/withdrawal, sourced admission, outgoing transfer and real batch failure rollback all pass. Result: 95/93 tables and clean FK.
- `npm run test:backup-restore:local` passed with all 46 migrations / 95 total tables. Full schema, typed values and rows match after export/restore, including an oversized generated `import_jobs` row bound with parameters.
- Local regression coverage totals `1632/1632` executions across 33 suites, with zero failures/skips after targeted reruns of the corrected cases. Final CI reruns the full matrix on one commit. Existing regression suites are retained. The Phase 21D migration-specific test now limits its baseline to files before `0041`, so later migrations do not accidentally enter its 0040→0041 fixture. The 81-table assertion for that historical test remains unchanged.
- The initial local D1 rehearsal exposed Wrangler SQL-splitter sensitivity to `,CASE` / `END,` inside trigger bodies. The new migration now uses whitespace-delimited `CASE` / `END`; all four new files apply through actual Wrangler migrations.
- CI runs the complete regression matrix, all established local D1 gates, the new local workflow gate, backup/restore, audit, typecheck and build. Final remote CI links and exact tested HEAD are maintained in the Draft PR and Notion execution page.

## Remaining acceptance

### STAGING gate resumption — 2026-09-26

Authenticated identity, immutable preview, the complete R2 inventory and the 42-migration preflight passed. R2 contains three objects totaling 154 bytes. The full D1 export is 1,558,490 bytes, SHA-256 `d9d39d531401827773013d23f8ec47a8f2f8743e5d021eaa3494275c1bed6dda`. Its isolated restore matched every schema object, row, SQLite type and value; the immediate second export was byte-identical.

The first remote migration attempt failed with D1 `incomplete input` before any migration committed. A fresh read-only preflight confirmed exactly the same full snapshot hash `43c8145a273269c6b4e097eab0dec6e6bc56cd31e1b7e656005849cf81ebfcd2`, 42 migrations, 83/81 tables and four pending files. No fixture writes had started.

The still-unapplied 0042–0045 triggers now express guards as `SELECT RAISE(...) WHERE ...` and use `iif` for conditional values. This preserves their semantics while avoiding bare `CASE ... END` expressions that the remote D1 statement parser can confuse with a trigger terminator ([Cloudflare issue 4727](https://github.com/cloudflare/workers-sdk/issues/4727)). Local migration success did not detect this remote parser difference. The corrected bytes require a repeated restore/upgrade rehearsal, CI, immediate drift check and authenticated STAGING gate before acceptance.

1. Authenticated STAGING backup/rehearsal and migrations `0042`–`0045`, then school-2-only browser QA and non-destructive fixture cleanup.
2. Verify the existing homework R2 binding on the STAGING main deployment after this branch is eventually merged; remeasure/reconcile usage first.
3. Real official-source configuration, school-staff pilot, and a separately identified Production release environment remain operational work. No claim of Production readiness, legal certification or completed staff pilot is made.
