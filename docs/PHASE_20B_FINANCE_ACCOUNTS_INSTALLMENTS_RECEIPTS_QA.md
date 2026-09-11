# Phase 20B — Student finance accounts, installments, receipts and parent view

## Current decision — 2026-09-11

**Implementation, CI, Cloudflare Preview, STAGING migration rehearsal, migration, functional QA and soft cleanup: PASS.**

The branch adds a student-centered finance workflow, optional versioned installment schedules, a professional A4 tuition receipt, and a strictly read-only parent finance view. Migration `0032_fee_installments_receipt_snapshots.sql` is additive and does not move money, rewrite historical financial values, or modify migrations `0029`–`0031`.

Draft PR #40 remains open and unmerged for review. Production remains outside this delivery; no Production access or deployment was performed.

## Final STAGING acceptance — 2026-09-11

### Branch, CI and Preview

- Branch: `feature/finance-installments-parent-receipts`.
- Imported patch commit: `272c9fc1fcbed1d3f236a1ef4e4c1c70148e8536`, applied on `origin/main` with `git am`.
- Draft PR: [#40](https://github.com/smartschoolduhok/smart-school/pull/40).
- GitHub Quality Gates: **PASS** in 4m29s ([run 34618236948](https://github.com/smartschoolduhok/smart-school/actions/runs/34618236948)).
- Cloudflare Pages: **PASS** for the same commit.
- Immutable Preview: `https://f004015b.smart-school-staging.pages.dev`.
- Branch Preview: `https://feature-finance-installments.smart-school-staging.pages.dev`.

### Backup and read-only preflight

- The only remote D1 target was `smart-school-staging-db`, ID `1bdb9c3d-08d6-4023-9cbc-64369d53198a`, in EEUR.
- Full pre-migration export outside the repository: `C:\Users\ibrah\Documents\SmartSchoolBackups\phase20b-20260911T155345Z\smart-school-staging-db-full.sql`.
- Backup size: **999,690 bytes**; SHA-256: `4FB191C43636A28436A9C9F6481C1D36904BAD5649338F5EE7BC9D3CEEA0E4A2`.
- Preflight found **32/32 distinct migrations**, ending at `0031_treasury_payroll_integrity.sql`; only `0032_fee_installments_receipt_snapshots.sql` was pending.
- New-object collisions: **0**; new receipt-column collisions: **0**; FK violations: **0**.
- Unhealthy fee, treasury, payroll-row and payroll-school readiness rows: **0/0/0/0**.
- Unsupported fee currency rows and unsupported active treasury currency rows: **0/0**.
- Pre-migration financial snapshot: 2 fees, original/net **110,000 IQD**, paid **0**; 2 cancelled payments totaling **27,500 IQD**; 3 cancelled receipts; treasury balance **0**; no salary rows.

### Exact local restore and migration rehearsal

- `scripts/validate-staging-0032-local.mjs` restored the real export into an isolated LOCAL D1 only; it has no remote mode and reads no repository binding or environment file.
- The export contained **1,617 statements**. One oversized `import_jobs` row was removed from the SQL import and restored byte-for-byte through **16 bound parameters** carrying **360,514 bytes**; the other 1,616 statements used the normal local D1 import path.
- The restored D1 matched an independent SQLite baseline before migration.
- After applying only 0032 locally, **52 old tables** retained every old row and every pre-existing typed value. The expected migration-history/`sqlite_sequence` increment was verified separately.
- Expected additive schema passed: **2/2 tables, 4/4 indexes, 11/11 triggers and 7/7 receipt columns**; new plan tables were empty; all historical receipts remained version 1; FK/readiness stayed clean.
- Local rehearsal evidence: `C:\Users\ibrah\Documents\SmartSchoolBackups\phase20b-20260911T155345Z\phase20b-local-rehearsal-evidence.json`.

### STAGING migration and historical-data proof

- The pre-apply pending list contained exactly 0032. `wrangler d1 migrations apply smart-school-staging-db --remote` applied exactly that one migration and reported 25 successful commands.
- Post-apply history is **33/33 distinct migrations**, 0032 recorded once and last, with no pending migrations.
- Remote schema is **2/2 tables, 4/4 indexes, 11/11 triggers and 7/7 receipt columns**. Both plan tables initially contained zero rows, and the three historical receipts remained version 1.
- Post-migration export: `C:\Users\ibrah\Documents\SmartSchoolBackups\phase20b-20260911T155345Z\smart-school-staging-db-after-0032.sql`, **1,010,530 bytes**, SHA-256 `8BBDD06D30ED230B530AAF7F3B3066A33C5C9ED1B5F997C57B537EE4D0996FC3`.
- A typed pre/post export comparison proved all rows and pre-existing values in the **52 old tables** unchanged. The expected new schema and the new migration-history row were excluded from the equality assertion and verified explicitly.

### Functional QA and retained soft-cleanup evidence

- QA marker: `PH20B-1789160352919-4d20a657`; immutable Preview: `f004015b`.
- IDs: accountant user `8`, parent user `9`, student `32`, parent link `2`, fee `3`, payment `3`, receipts `4 → 5`, plans `1 → 2`.
- Plan creation passed. A 60,000 IQD payment allocated oldest-first as **50,000 paid + 10,000 partial + 25,000 upcoming**.
- Receipt v2 issue/cancel/reissue passed; receipt `5` replaces `4`. Public QR returned the minimal active document and then the cancelled state without private payment/class/section details.
- Parent finance and receipt endpoints returned sanitized data while link `2` was active; the private note sentinel was absent. Both endpoints returned 404 immediately after the link became inactive.
- Plan replacement passed: plan `1` is `superseded`; plan `2` is `cancelled`. The HTTP `DELETE` route was exercised only as the documented soft-disable API and executed an `UPDATE`; no database row was deleted.
- Cleanup retained all evidence: users `8,9` are `inactive`, student `32` is `archived`, link `2` is `inactive`, payment `3` and receipts `4,5` are `cancelled`, and the linked treasury transaction is `cancelled` exactly once. Fee `3` is `pending`, paid `0`, remaining `100,000 IQD`; treasury balance returned to the baseline `0`.
- Final FK and all readiness checks are clean. Final totals reflect retained QA evidence: 9 users, 32 students, 3 fees, 3 payments, 5 receipts, 3 treasury transactions and 2 parent links.
- Functional QA evidence: `C:\Users\ibrah\Documents\SmartSchoolBackups\phase20b-20260911T155345Z\phase20b-staging-qa-evidence.json`.
- Final post-cleanup export: `C:\Users\ibrah\Documents\SmartSchoolBackups\phase20b-20260911T155345Z\smart-school-staging-db-after-qa-soft-cleanup.sql`, **1,020,951 bytes**, SHA-256 `87B658C1E7195CC56D64099AFBD28CA55EA30BFEE2A8A7C33C2000ACC545E2BC`.

### Frozen migrations and safety

- Migrations 0029–0032 were not edited. Their SHA-256 values are respectively `EF3AC3C…4524`, `577B16A6…B042`, `4DCE4C0E…93C5`, and `3E35733A…AF47`.
- No Production access/deployment, remote seed/reset, SQL `DELETE`, hard deletion, force-push or merge occurred.
- PR #40 intentionally remains Draft and unmerged; completion of these gates does not imply merge authorization.

## Scope and product decisions

- The canonical money ledger remains `fee_payments` plus linked treasury transactions. An installment plan is scheduling metadata and never creates, moves, or reverses money.
- All new financial amounts are whole Iraqi dinars. There is no automatic currency conversion or relabeling of historical non-IQD rows.
- The primary staff workflow starts from one **فتح الحساب** action per fee row, then presents totals, plan, collection, edit, and deletion in context.
- A plan is optional and supports 1–24 chronologically ordered installments. Quick splits are available for 2, 3, 4, 6, 9, or 12 payments, with safe end-of-month date handling.
- Actual payments are allocated oldest-first for presentation only. Status is derived as paid, partial, overdue, or upcoming.
- Replacing or disabling a plan is soft/versioned. Historical plan and item rows cannot be edited or deleted.
- New receipts use immutable schema version 2 snapshots. Historical version 1 receipts remain readable and are not rewritten.
- Receipt cancellation cancels the document only. It never cancels a payment or reverses treasury money.
- A replacement receipt can be issued for the same active payment set and is linked to the latest cancelled document.
- The parent view is read-only and is available only through an active same-school `parent_student_links` row. Disabling that link revokes both the account and receipt endpoints immediately.

## Migration 0032

### New schema

- `fee_installment_plans`
- `fee_installment_items`
- one partial unique index allowing only one active plan per fee
- supporting school/fee/item indexes
- 11 integrity and history triggers

### Receipt extensions

Seven additive columns are added to `fee_receipts`:

- `receipt_schema_version`
- `student_number_snapshot`
- `currency_snapshot`
- `received_by_snapshot`
- `financial_summary_snapshot_json`
- `installment_plan_snapshot_json`
- `replaces_receipt_id`

Existing receipts receive only the compatible default `receipt_schema_version = 1`; their prior columns and values remain unchanged. New application receipts explicitly write version 2 and must include valid IQD account, receiver, payment and installment snapshots.

### Database authority

The database rejects:

- a plan for a different school, inactive student/school, unsupported currency, stale fee revision, or invalid replacement;
- empty plans, more than 24 items, fractional/non-positive/unsafe amounts, invalid dates, non-contiguous order, nonchronological dates, or totals/basis points that do not match the fee;
- a second active plan, direct history edits/deletes, or net-fee changes while a plan is active;
- malformed receipt v2 snapshots, snapshot mutation, invalid replacement links, or multiple replacements for the same cancelled receipt.

The populated `0031 → 0032` migration test preserves every old table row and every pre-existing column value, keeps historical receipts at version 1, creates empty plan tables, and ends with a clean foreign-key check.

## API and access matrix

| Route | Finance staff | Parent | Notes |
|---|---:|---:|---|
| `GET /api/student-finance/:studentId` | Yes | No | Whole student account within explicit school scope |
| `GET /api/student-fees/:feeId/installment-plan` | Yes | No | Active plan only |
| `PUT /api/student-fees/:feeId/installment-plan` | Yes | No | Atomic version creation/replacement |
| `DELETE /api/student-fees/:feeId/installment-plan` | Yes | No | Soft disable; no row deletion |
| `GET /api/parent/students/:studentId/finance` | No | Linked child only | Sanitized read-only account |
| `GET /api/parent/fee-receipts/:receiptId` | No | Linked child only | Sanitized immutable document |
| `GET /api/verify/receipt/:token` | Public token | Public token | Minimal verification facts only |

Parent payloads exclude fee notes, plan notes, payment notes, cancellation reasons, creator IDs, request fingerprints, and mutation controls. Public QR verification excludes class, section and payment details.

## A4 receipt

The receipt follows the supplied paper example as a functional reference while retaining Smart School branding and its own visual system. It includes:

- school identity/logo, Arabic title, academic year, QR and LTR receipt number;
- student name/number, class and section snapshots;
- original fee, discount, net due, previously paid, current payment, total paid, remaining balance and payment ratio;
- the optional installment schedule only when one exists;
- current payment type, method, amount, date and staff-only snapshot notes;
- receiver, signature, official stamp area, print timestamp and verification footer;
- a prominent cancellation watermark and invalid-document notice for cancelled receipts;
- a replacement-document notice when linked to a cancelled receipt.

Print CSS uses A4 dimensions, repeated table headers, row-safe page breaks, and multi-page support for unusually long payment/plan tables. The on-screen preview contains horizontal overflow inside its own preview area rather than expanding the whole application page.

## Parent experience

Inside the linked student's profile, **الأقساط** shows:

- original fees, discounts, net amount, paid, remaining and payment percentage;
- every fee and its due date;
- installment rows and derived status;
- active/cancelled payment history;
- active/cancelled receipts, including replacement indicators;
- links to the parent-safe receipt/PDF view and minimal QR verification.

No collect, edit, delete, cancel, plan-edit, internal-note or general finance navigation is exposed.

## Local verification evidence

| Gate | Result |
|---|---|
| Finance fee/payment/receipt suite | **193/193 PASS** |
| Complete regression matrix | **1443/1443 PASS**, 22 suites, 0 fail, 0 skip |
| UI/DOM finance scenarios | **10/10 PASS** |
| Genuine Local D1 | **33 migrations, 39 checks PASS** |
| D1 historical blockers | **5/5 expected failures with complete rollback** |
| D1 Phase 20B flow | plan 200, payment 201, receipt v2 200, parent view 200, revoked view 404 |
| Populated `0031 → 0032` | all historical values preserved; FK clean |
| Backup/restore drill | **54 tables identical** |
| Oversized bound row | **360,009 bytes restored byte-for-byte** |
| Installment restore fixture | **1 plan + 2 items restored exactly** |
| TypeScript | PASS |
| Frontend build | PASS |
| Worker build | PASS |
| `npm audit` | **0 vulnerabilities** |
| `git diff --check` | PASS |

Expected diagnostics remain limited to deliberate rollback injections. The existing frontend build warning for the separately lazy-loaded XLSX chunk remains non-blocking and is not introduced by this phase.

## STAGING gate — completed 2026-09-11

Before applying migration 0032:

1. [x] Confirm the target is exactly `smart-school-staging-db`; do not access Production.
2. [x] Export a complete SQL backup outside the repository and record byte size plus SHA-256.
3. [x] Run read-only preflight: migration history/order, schema-name collisions, FK check, finance fee/treasury/payroll readiness, unsupported currencies, row counts and financial snapshots.
4. [x] Restore the backup locally using parameter binding for oversized statements.
5. [x] Apply only migration 0032 to the restored copy and prove old-table/value equality plus the expected additive schema.
6. [x] Stop-on-failure guard was maintained; all required preconditions passed before the remote migration.

After a successful STAGING migration:

1. [x] Confirm 33 migrations, each recorded once and 0032 last, with no pending migration.
2. [x] Confirm 2/2 plan tables, 7/7 receipt columns, 4/4 new indexes and 11/11 new triggers.
3. [x] Confirm FK and all readiness views remain healthy and every historical snapshot/count is unchanged.
4. [x] Create dedicated temporary QA records only; test plan creation/replacement/disable, partial payment allocation, receipt issue/cancel/reissue, QR, parent visibility and immediate revocation.
5. [x] Soft-disable/archive QA users, links and records without SQL `DELETE`, seed, reset, or unrelated financial edits.
6. [x] Record all identifiers and final postchecks in this report.

## Safety boundary

- No Production access or deployment is authorized.
- No remote seed/reset or hard deletion is authorized.
- Migrations `0029`–`0032` must remain byte-for-byte unchanged.
- Migration 0032 must never be edited after it has been successfully applied remotely; any later correction requires a new migration.
- The database gates are complete, but PR #40 remains Draft and unmerged pending human review; no merge was requested or performed.
