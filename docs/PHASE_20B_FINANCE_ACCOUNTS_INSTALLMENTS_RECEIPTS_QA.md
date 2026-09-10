# Phase 20B — Student finance accounts, installments, receipts and parent view

## Current decision — 2026-09-10

**Local implementation and quality gates: PASS.**

The branch adds a student-centered finance workflow, optional versioned installment schedules, a professional A4 tuition receipt, and a strictly read-only parent finance view. Migration `0032_fee_installments_receipt_snapshots.sql` is additive and does not move money, rewrite historical financial values, or modify migrations `0029`–`0031`.

STAGING migration and authenticated visual QA are separate gates. They must only run after a new backup, read-only preflight, and local restore/migration rehearsal. Production remains outside this delivery.

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

## STAGING gate

Before applying migration 0032:

1. Confirm the target is exactly `smart-school-staging-db`; do not access Production.
2. Export a complete SQL backup outside the repository and record byte size plus SHA-256.
3. Run read-only preflight: migration history/order, schema-name collisions, FK check, finance fee/treasury/payroll readiness, unsupported currencies, row counts and financial snapshots.
4. Restore the backup locally using parameter binding for oversized statements.
5. Apply only migration 0032 to the restored copy and prove old-table/value equality plus the expected additive schema.
6. If any preflight or rehearsal check fails, stop before the remote migration.

After a successful STAGING migration:

1. Confirm 33 migrations, each recorded once and 0032 last, with no pending migration.
2. Confirm 2/2 plan tables, 7/7 receipt columns, 4/4 new indexes and 11/11 new triggers.
3. Confirm FK and all readiness views remain healthy and every historical snapshot/count is unchanged.
4. Create dedicated temporary QA records only; test plan creation/replacement/disable, partial payment allocation, receipt issue/cancel/reissue, QR, parent visibility and immediate revocation.
5. Soft-disable/archive QA users, links and records without `DELETE`, seed, reset, or unrelated financial edits.
6. Record all identifiers and final postchecks in this report.

## Safety boundary

- No Production access or deployment is authorized.
- No remote seed/reset or hard deletion is authorized.
- Migrations `0029`–`0031` must remain byte-for-byte unchanged.
- Migration 0032 must never be edited after it has been successfully applied remotely; any later correction requires a new migration.
- A successful branch preview is not proof of database readiness. Merge remains blocked until STAGING migration and authenticated QA evidence are complete.
