# Phase 20A1 — Finance core stabilization QA

## Final acceptance — 2026-09-07

**Status: ACCEPTED / MERGED / DEPLOYED**

Phase 20A1 Finance Stabilization completed its final gates successfully.

### Final delivery
- PR #37 was merged into `main`.
- Final PR HEAD: `18201682aa2b1321262063f38fe907bd7662d084`.
- Merge commit: `e50b73ba9ae399477b837cb91a3b7cbe7fec6b5c`.
- Cloudflare Pages deployment for the merge commit completed successfully.

### Migration 0028 — final remote/STAGING result
- The first two STAGING attempts failed historically with D1 parser error 7500 and rolled back atomically.
- After the final trigger-parser compatibility correction, disposable REMOTE D1 validation succeeded.
- The third authorized STAGING migration attempt succeeded.
- STAGING migration history contains 29 migrations, with `0028_finance_fee_payment_integrity.sql` recorded once and last.
- Verified final 0028 objects: 11/11 columns, 1/1 receipt-payment link table, 2/2 readiness views, 7/7 indexes, 18/18 triggers.
- 71 compared pre-existing finance values had zero unintended changes.
- Finance and treasury readiness views were healthy and foreign-key verification was clean.
- No remote seed/reset was performed and Production was not accessed.

### Final automated validation
- Finance: **183/183**
- 19-suite regression matrix: **1385 pass / 0 fail / 0 skip**
- Distinct modern tests: **1293**
- Genuine Local D1 scenarios: **35/35**
- Legacy employee/salary/treasury assertions: **40/40**
- Typecheck, frontend build, Worker build and `git diff --check`: **PASS**
- The historical `test_treasury_rollback.js` CommonJS/ESM harness still exits before assertions and is not counted as passing; equivalent modern rollback coverage passed.

### Final Manual Finance QA on STAGING
The authenticated operator flow was tested successfully:

1. Test fee: **100,000 IQD**
2. Partial payment: **25,000 IQD**
   - paid: **25,000**
   - remaining: **75,000**
   - status: **partial**
3. Overpayment attempt: **80,000 IQD**
   - correctly rejected because only **75,000 IQD** remained
4. Receipt generation for the 25,000 payment: **PASS**
5. Receipt cancellation only: **PASS**
   - payment stayed active
   - money was not reversed
6. Payment cancellation: **PASS**
   - paid returned to **0**
   - remaining returned to **100,000**
   - status returned to **pending**
   - treasury effect was reversed correctly

**End-to-end result: PASS.**

### Acceptance decision
Phase **20A1 — Fees / Payments / Receipts integrity stabilization** is complete and accepted.

No additional Phase 20A1 finance feature work is required before proceeding.

Next phase:
**Phase 20A2 — manual treasury integrity, salary payment/cancellation atomicity, daily closing, business date/timezone, and daily/monthly reporting.**

---

> **Historical evidence below:** The remaining sections preserve the investigation and validation record as it existed at each earlier checkpoint. Statements below such as "remote confirmation pending", "ZERO remote D1 access", "keep Draft", or "do not merge" describe those historical checkpoints only and are superseded by the Final acceptance section above.

## CASE terminator hardening — 2026-09-06 (historical evidence)

This section supersedes the seven-space fix's remote hypothesis and test totals below.
Base HEAD: `7360d2cc6ae6071d664ecdc9e8a980321cef3471`.
Same branch `fix/finance-fees-payments-integrity-phase-20a1`, same Draft PR #37; delivery SHA is recorded in the PR description.

### Two historical remote failures — no remote access in this task

The first authorized attempt failed with `incomplete input: SQLITE_ERROR [code: 7500]`.
The seven-space correction fixed a confirmed **local** splitter defect, but the second authorized attempt at HEAD 7360d2c **still failed with the same error**, exit 1, using Wrangler 4.118.0.
Thus local success was not sufficient to explain or fix remote D1 parsing.

The previously recorded post-failure audit confirmed an atomic failure: migration history stayed at **28 through 0027**, only 0028 pending; none of 0028's columns, table, views, indexes or triggers survived.
All fifteen compared table counts and all **71 pre-existing financial field values** remained unchanged.
The fee stayed 100,000 IQD / 25,000 paid / partial; payment and receipt values, treasury entry, audit timestamps and 25,000 cached/ledger balance remained unchanged. Foreign keys were enabled and the FK check was empty.
These are **historical supplied/recorded observations, not freshly queried STAGING data**.

### Remaining parser hypothesis and minimal correction

[Cloudflare issue #4326](https://github.com/cloudflare/workers-sdk/issues/4326) reports a CASE/RAISE trigger failing with incomplete input and a parenthesized workaround.
[Issue #4727](https://github.com/cloudflare/workers-sdk/issues/4727) independently describes unparenthesized CASE termination being confused with trigger termination.
These are historical reports, not proof of the current remote service's implementation.
The more recent [#14991](https://github.com/cloudflare/workers-sdk/issues/14991) and [#15314](https://github.com/cloudflare/workers-sdk/issues/15314) report remote migration parsing failures involving CRLF and lowercase body openers; they support keeping local and remote evidence separate.

**Ambiguous SELECT CASE ... END; inside trigger bodies is the leading remaining parser hypothesis, not a confirmed root cause of both STAGING failures.**

Inspected unchanged migration `0027_timetable_safe_teacher_reassignment.sql`: its conditional `SELECT RAISE(...) WHERE condition;` structure has already been remotely applied in this project, according to the recorded history. 0028 now follows that same structural style.

- Converted **45 conditional guards**, across 12 trigger bodies, from CASE/RAISE to SELECT RAISE/WHERE.
- Conditions, guard order, ABORT types and error strings preserved exactly, apart from grouping the two status calculations.
- Four unconditional history guards remain unconditional. All trigger timing, UPDATE column lists and WHEN clauses remain unchanged.
- **Eight calculated CASE expressions remain inside triggers:** one status check in each fee insert/update trigger; one status value and two signed treasury sums in each payment post/cancel trigger.
- The four status expressions are grouped as `( CASE ... END )`; four existing sums retain `SUM( CASE ... END )`. Every calculated END closes inside parentheses before any SQL statement terminator.
- Three CASE expressions outside triggers (receipt-link backfill and readiness views) are unchanged.
- Existing tables, views, indexes, arithmetic, money movement and API error mapping are unchanged. No source modules, dependencies, migrations 0001–0027 or migration 0029 changed.

**0028 no longer contains CASE END semicolon boundaries inside trigger statements that can be mistaken for the trigger terminator. Remote confirmation is still pending.**

### Independent parser and semantic proof

Exact file SHA256: `4a46fe7bad40cc98241d6b4b53df2a5c51252b3cf818bbc99fa316abc7f34be0`.
Bytes: **314 LF, 0 CR / CRLF, no BOM, final newline present**.
Installed Wrangler remains **4.118.0**.

- Red test before SQL changes: **19 tests, 7 pass / 12 fail / 0 skip**. The twelve conditional-guard triggers had extra END-semicolon boundaries.
- Same terminator tests after correction: **19/19 pass**. Each of the **18** exact trigger chunks has precisely one standalone END-semicolon, at its final terminator.
- Lexer masks strings, escaped quotes, quoted identifiers and comments; a CASE/BEGIN/END stack checks calculated END grouping, rejects inner CASE terminators and lowercase body openers. Synthetic adversarial lexer checks remain included.
- Exact splitter result remains **45 statements**. Every statement independently compiles and executes; SQLite's consumed `sourceSQL` must equal the entire chunk. **18/18 named triggers**, both readiness views, link table and all seven indexes are verified. Temporary preflight table absent; FK enabled/clean.
- Ordered condition/error fingerprint is pinned against the 45 original guards at HEAD 7360d2c. A separate inverse-transform inspection reproduced the entire original SQL modulo formatting/comment additions.
- Fifteen stable application-visible error codes each compare old conceptual CASE guards and new WHERE guards for TRUE/FALSE/NULL with scalar, correlated-subquery and calculated-CASE predicates. TRUE aborts with the same exact code; FALSE/NULL continue, with no partial insert on ABORT.
- Exact extracted status expressions cover zero-net paid, fully paid, overpaid predicate boundary, partial, pending and NULL comparison behavior. Existing full finance integration tests continue to enforce actual write constraints.
- Focused finance module: **68 pass / 0 fail / 0 skip**. Net addition: **36 tests**. Existing swallowed-trigger false-positive reproduction remains enforced.

### Full regression and builds

Executed the exact package test commands using `node scripts/run-finance-regressions.mjs`.
All final suites below exited 0; all have **0 failed / 0 skipped**.

| Suite | Passed executions |
|---|---:|
| Finance | 183 |
| Security | 22 |
| RBAC/Tenant | 95 |
| Settings | 5 |
| Academic Years | 30 |
| Student Enrollments | 58 |
| Student Promotion | 129 |
| Student Profile | 24 |
| Subject Management | 59 |
| Subject Order | 21 |
| Religious Subjects | 39 |
| Subject Applicability | 3 |
| Flexible Grades | 36 |
| Grade Presentation | 9 |
| Result Cards | 66 |
| Excel Import | 81 |
| Timetable | 319 |
| Teaching Load Matrix | 117 |
| Week Setup | 89 |
| **Total** | **1385** |

**Final 19-suite run: 1385 pass / 0 fail / 0 skip executions; 1293 distinct tests.**
The 92 repeated executions are Result Cards 66, Settings 5 and Subject Order 21, each included in two package suites.
These totals do not double-count development red/green runs, nor fold the separate LOCAL D1 scenarios or legacy shell assertions into Node test counts.

Additional validation:

- Safe localhost-only legacy employee/salary/treasury adapter: **40 pass / 0 fail**, exit 0.
- Unchanged `node test_treasury_rollback.js`: **exit 1 before any assertions**, `ReferenceError: require is not defined in ES module scope` at line 15. This pre-existing ESM/script limitation is separate from passing finance rollback coverage, not hidden as a pass or a skipped Node test.
- `pnpm run typecheck`: exit 0.
- `pnpm run build:fe`: exit 0 (1910 modules).
- `pnpm run build:api`: exit 0 (76 modules).
- Frontend build retains the >500 kB chunk-size warning. The parallel legacy test emitted `WebSocket server error: Port 24678 is already in use`, but completed all 40 assertions successfully; no existing service was stopped or reconfigured.
- `git diff --check`: exit 0. Git warns that the test file's LF will become CRLF on checkout; migration 0028 itself remains explicitly LF.

### Genuine disposable LOCAL D1 results

`pnpm run test:finance-fees:local`: **exit 0, 35/35 scenario checks**, using Wrangler 4.118.0 / real workerd and temporary LOCAL-only database configurations with dummy UUIDs, `remoteBindings:false`, no repository env files.

- Fresh **0001 through 0028**: all **29 actual migration files** applied (including both 0014 files). The copied migration SHA256 equals the reviewed working file.
- Populated **0027 to 0028**: all pre-existing columns and rows across **46 application tables** preserved; historical USD record retained and receipt links backfilled as intended.
- Five separate populated blocker databases: duplicate fee identity, receipt number, token, active payment reservation, and missing receipt payment each reject migration with the expected error/exit 1. Each rolls back schema, data and history completely, retaining 28 migrations. These are expected successful negative tests, not runner failures.
- Legacy fee drift and treasury drift survive migration unchanged. All **eight** attempted payment, metadata edit, amount edit and cancellation operations return 409 / `finance_reconciliation_required`, with full before/after equality.
- Receipt/payment cancellation, late-read failure, print failure and first/final/fee/treasury/cache posting failure all retain atomic rollback.
- Same-key concurrency reuses one payment; different-key concurrent overpayment permits one commit only. Receipt reservation concurrency, year/null/mixed-year behavior and fee_type_key tamper rejection pass.
- `PRAGMA foreign_keys = 1`; `PRAGMA foreign_key_check` returns zero rows; final cached treasury balance equals the active ledger.

`pnpm run test:finance-seed:local`: **exit 0**, separate fresh disposable LOCAL chain through 0028 followed by the **exact repository seed.sql**. **8 fees / 8 payments**, deterministic valid payment requests and matching treasury links; cached balance and ledger both **2,550,000 IQD**; all finance invariants and FK checks pass. This authorization was LOCAL seed only; no existing or remote database was seeded/reset.

Explicit `pnpm run test:finance-fees` was also rerun: **183 pass / 0 fail / 0 skip**, exit 0. This repeats the Finance suite already counted in the 1385-execution matrix; it adds no distinct tests. Expected injected-failure logs and the non-fatal HMR port warning do not indicate assertion failures.

### Local evidence locations

- 19-suite summary and per-suite logs: `%TEMP%/smart-school-finance-regressions-MfkgDC/`.
- Genuine LOCAL D1 commands and evidence: `%TEMP%/smart-school-finance-local-QNO6n7/`.
- Local seed evidence: `%TEMP%/smart-school-finance-seed-local-O4mUEj/`.
- Legacy assertions: `%TEMP%/smart-school-finance-legacy-lsFUaz/`.

### Historical safety boundary and next gate

**ZERO remote D1 access** during this correction: no STAGING reads/writes, no production access, no remote disposable database, no remote migration/execute/seed/reset. GitHub PR inspection/update and public documentation retrieval are not D1 access.
No dependency change; no new migration or branch/PR; PR #37 must remain Draft/unmerged.
After independent review, the next step is a **separately and explicitly authorized disposable REMOTE D1 reproduction**, not another STAGING attempt. It has **not** been performed.

## Wrangler 4.118.0 splitter correction — 2026-09-06 (historical, superseded above)

This section supersedes earlier splitter acceptance and validation totals below.
Reviewed/pre-fix HEAD: `92d45480349fef43a619329d41be18d3831c6922`.
The correction is on the same `fix/finance-fees-payments-integrity-phase-20a1` branch and Draft PR #37. Final delivery SHA is recorded in the PR description.

### First STAGING attempt (historical evidence, not re-queried here)

The previously authorized first STAGING attempt used Wrangler **4.118.0** and failed with `incomplete input: SQLITE_ERROR [code: 7500]`, exit **1**.
The recorded read-only post-failure verification confirmed rollback: history remained at **28** applied migrations through 0027, 0028 remained pending, none of its new schema objects/columns survived, and the fifteen compared table counts were unchanged. The test fee remained 100,000 IQD / 25,000 paid / partial; payment, receipt, treasury entry, timestamps and 25,000 balance were unchanged; FK check returned zero violations. Staging remained healthy.
Those facts are from the prior failure/verification report, **not a new remote inspection in this task**.

### Confirmed local defect and precise boundary

The installed splitter's compound-end recognizer is `/\sEND[;\s]$/`: it fails to close calculated CASE expressions whose END is immediately followed by `)` or `,`. Seven such tokens caused **27 chunks**, with `finance_treasury_readiness` and all **18** subsequent triggers swallowed into the last chunk. SQLite accepts the original SQL as a complete script; this is a statement-boundary defect, not invalid finance arithmetic.

The exact SQL correction is **seven added spaces**, plus a two-line compatibility comment. No condition, value, validation block, trigger behavior, object definition, business rule, source module or dependency changed. Standalone `SELECT CASE ... THEN RAISE ... END;` validation blocks are unchanged. No migration 0029 was added.

[Upstream workers-sdk PR #15226](https://github.com/cloudflare/workers-sdk/pull/15226) documents the same compound-marker/punctuation defect, including `SUM(CASE ... END)`, and the migration workflow using the splitter. Installed-source inspection further distinguishes the paths: local execution splits and batches statements; the remote command path sends the migration SQL to D1's query endpoint. This local reproduction does **not** establish the remote service's exact parsing behavior or conclusively reproduce remote code 7500.

**The confirmed local splitter defect is directly relevant to Wrangler migrations apply and is the leading explanation for the failed remote migration. A successful authorized remote retry is still required for confirmation.**

### Red/green and independent statement proof

The old `for (query of unstable_splitSqlQuery(sql)) db.exec(query)` accepted multiple statements per chunk, hiding the bad boundaries. `DatabaseSync.prepare(query).run()` alone also silently executes only the first statement.

The replacement compiles each chunk, compares SQLite's actual `StatementSync.sourceSQL` to the **entire** chunk before running it, then executes that one statement. A separate adversarial test ensures a two-statement chunk is rejected before even its first statement runs.

- Focused tests **before SQL edit: 2 pass / 2 fail / 0 skip**, exit 1. The acceptance test failed at the real compiled view boundary; the punctuation guard found seven unsafe tokens.
- Same focused tests **after edit: 4 pass / 0 fail / 0 skip**, exit 0.
- Fixed exact file: **45 independent compiled/executed statements**; exactly **18** complete single-trigger chunks, no swallowed following trigger or partial body.
- All **18 explicitly named expected triggers** exist in sqlite_schema; one new link table, both readiness views and seven named indexes exist. The temporary preflight table is absent.
- Retained in-memory regression removes only those seven spaces: **27 chunks** again; strict execution rejects the trailing SQL and creates **0/18** triggers, while the deliberately reproduced OLD exec loop reports **18/18**. This documents the false positive without weakening the acceptance path.
- The calculated-END regression rejects `END)` / `END,` and actually executes ordinary CASE and safe SUM-CASE examples. Normal validation CASE statements remain allowed.
- Byte verification: UTF-8, no BOM, **303 LF / 0 CRLF / 0 CR**, final newline present. Existing `migrations/*.sql text eol=lf` unchanged.
- Independent comparison against the old Git blob, ignoring only SQL comment lines, confirms the file equals the original plus exactly those seven spaces.

| Exact line (unchanged numbering) | Context | Token change |
| --- | --- | --- |
| 92 | Treasury readiness ledger sum | `END)` → `END )` |
| 192 | Payment posting fee status | `END,` → `END ,` |
| 196 | Payment posting balance limit | `END)` → `END )` |
| 200 | Payment posting treasury cache | `END)` → `END )` |
| 230 | Payment cancellation balance limit | `END)` → `END )` |
| 235 | Payment cancellation fee status | `END,` → `END ,` |
| 237 | Payment cancellation treasury cache | `END)` → `END )` |

### Exact 0028 diff

```diff
diff --git a/migrations/0028_finance_fee_payment_integrity.sql b/migrations/0028_finance_fee_payment_integrity.sql
index 04cc9d5..9ee917b 100644
--- a/migrations/0028_finance_fee_payment_integrity.sql
+++ b/migrations/0028_finance_fee_payment_integrity.sql
@@ -5,2 +5,2 @@
--- Keep whitespace BEFORE nested CASE keywords: Wrangler 4's SQL splitter
--- requires it to recognize compound statements (including inside SUM(...)).
+-- Wrangler compatibility — do not remove: whitespace BEFORE nested CASE and
+-- AFTER calculated CASE END (before punctuation) is required by Wrangler 4.118.0.
@@ -92 +92 @@ SELECT s.id AS school_id, coalesce(
-      AND a.current_balance=(SELECT coalesce(SUM( CASE WHEN t.transaction_type='income' THEN CAST(t.amount AS INTEGER) ELSE -CAST(t.amount AS INTEGER) END),0)
+      AND a.current_balance=(SELECT coalesce(SUM( CASE WHEN t.transaction_type='income' THEN CAST(t.amount AS INTEGER) ELSE -CAST(t.amount AS INTEGER) END ),0)
@@ -192 +192 @@ CREATE TRIGGER trg_fee_payments_post AFTER INSERT ON fee_payments BEGIN
-    status= CASE WHEN (SELECT SUM(CAST(amount AS INTEGER)) FROM fee_payments WHERE student_fee_id=NEW.student_fee_id AND school_id=NEW.school_id AND status='active')>=coalesce(net_fee,amount) THEN 'paid' ELSE 'partial' END,
+    status= CASE WHEN (SELECT SUM(CAST(amount AS INTEGER)) FROM fee_payments WHERE student_fee_id=NEW.student_fee_id AND school_id=NEW.school_id AND status='active')>=coalesce(net_fee,amount) THEN 'paid' ELSE 'partial' END ,
@@ -196 +196 @@ CREATE TRIGGER trg_fee_payments_post AFTER INSERT ON fee_payments BEGIN
-  SELECT CASE WHEN abs((SELECT coalesce(SUM( CASE WHEN transaction_type='income' THEN CAST(amount AS INTEGER) ELSE -CAST(amount AS INTEGER) END),0) FROM treasury_transactions WHERE school_id=NEW.school_id AND status='active'))>9007199254740991
+  SELECT CASE WHEN abs((SELECT coalesce(SUM( CASE WHEN transaction_type='income' THEN CAST(amount AS INTEGER) ELSE -CAST(amount AS INTEGER) END ),0) FROM treasury_transactions WHERE school_id=NEW.school_id AND status='active'))>9007199254740991
@@ -200 +200 @@ CREATE TRIGGER trg_fee_payments_post AFTER INSERT ON fee_payments BEGIN
-    SELECT NEW.school_id,coalesce(SUM( CASE WHEN transaction_type='income' THEN CAST(amount AS INTEGER) ELSE -CAST(amount AS INTEGER) END),0),unixepoch()
+    SELECT NEW.school_id,coalesce(SUM( CASE WHEN transaction_type='income' THEN CAST(amount AS INTEGER) ELSE -CAST(amount AS INTEGER) END ),0),unixepoch()
@@ -230 +230 @@ CREATE TRIGGER trg_fee_payments_cancel AFTER UPDATE OF status ON fee_payments WH
-  SELECT CASE WHEN abs((SELECT coalesce(SUM( CASE WHEN transaction_type='income' THEN CAST(amount AS INTEGER) ELSE -CAST(amount AS INTEGER) END),0) FROM treasury_transactions WHERE school_id=NEW.school_id AND status='active'))>9007199254740991
+  SELECT CASE WHEN abs((SELECT coalesce(SUM( CASE WHEN transaction_type='income' THEN CAST(amount AS INTEGER) ELSE -CAST(amount AS INTEGER) END ),0) FROM treasury_transactions WHERE school_id=NEW.school_id AND status='active'))>9007199254740991
@@ -235 +235 @@ CREATE TRIGGER trg_fee_payments_cancel AFTER UPDATE OF status ON fee_payments WH
-    WHEN (SELECT coalesce(SUM(CAST(amount AS INTEGER)),0) FROM fee_payments WHERE student_fee_id=NEW.student_fee_id AND school_id=NEW.school_id AND status='active')>0 THEN 'partial' ELSE 'pending' END,
+    WHEN (SELECT coalesce(SUM(CAST(amount AS INTEGER)),0) FROM fee_payments WHERE student_fee_id=NEW.student_fee_id AND school_id=NEW.school_id AND status='active')>0 THEN 'partial' ELSE 'pending' END ,
@@ -237 +237 @@ CREATE TRIGGER trg_fee_payments_cancel AFTER UPDATE OF status ON fee_payments WH
-  UPDATE treasury_accounts SET current_balance=(SELECT coalesce(SUM( CASE WHEN transaction_type='income' THEN CAST(amount AS INTEGER) ELSE -CAST(amount AS INTEGER) END),0) FROM treasury_transactions WHERE school_id=NEW.school_id AND status='active'),
+  UPDATE treasury_accounts SET current_balance=(SELECT coalesce(SUM( CASE WHEN transaction_type='income' THEN CAST(amount AS INTEGER) ELSE -CAST(amount AS INTEGER) END ),0) FROM treasury_transactions WHERE school_id=NEW.school_id AND status='active'),
```

### Final regression results for this correction

`node scripts/run-finance-regressions.mjs` reran the exact Node commands of all nineteen configured package suites, exit **0**. `pnpm run test:finance-fees` was also run directly: **147/147**, exit **0**. The four focused tests replace one weak test and add three tests; all earlier tests remain.

| Package suite | Pass | Fail | Skip |
| --- | ---: | ---: | ---: |
| finance-fees | 147 | 0 | 0 |
| security | 22 | 0 | 0 |
| rbac | 95 | 0 | 0 |
| settings | 5 | 0 | 0 |
| academic-years | 30 | 0 | 0 |
| student-enrollments | 58 | 0 | 0 |
| student-promotion | 129 | 0 | 0 |
| student-profile | 24 | 0 | 0 |
| subject-management | 59 | 0 | 0 |
| subject-order | 21 | 0 | 0 |
| religious-subjects | 39 | 0 | 0 |
| subject-applicability | 3 | 0 | 0 |
| flexible-grades | 36 | 0 | 0 |
| grade-presentation | 9 | 0 | 0 |
| result-cards | 66 | 0 | 0 |
| excel-import | 81 | 0 | 0 |
| timetable | 319 | 0 | 0 |
| teaching-load-matrix | 117 | 0 | 0 |
| week-setup | 89 | 0 | 0 |
| **Modern suite executions** | **1349** | **0** | **0** |

This is **1,257 distinct modern tests**, not 1,349: result-card 66, settings 5 and subject-order 21 each execute twice. Focused/red-green and direct finance reruns are not added again to these totals.

Coverage includes IQD whole amounts, full-discount net zero, idempotent and concurrent payments, overpayment rejection, fee/payment/treasury/cache atomicity, cancellation, receipt reservations/duplicates/cancellation, immutable fee-year snapshots and mixed-year rejection, drift blocking, fee_type_key and RBAC/tenant isolation.

Legacy employee/salary/treasury assertions through `scripts/validate-finance-legacy-local.mjs`: **40 pass / 0 fail**, exit **0**, generated local fixtures only. Includes salary payment/cancellation, linked treasury and balance restoration.
The separate unchanged `node test_treasury_rollback.js` was rerun: **exit 1 before assertions**, `ReferenceError: require is not defined in ES module scope` at line 15. It is **not a passing or skipped suite**. No source-patching/PM2 phase was reached.

| Check | Result |
| --- | --- |
| `pnpm run typecheck` | exit 0 |
| `pnpm run build:fe` | exit 0; 1,910 modules |
| `pnpm run build:api` | exit 0; 76 modules; Worker 590.70 kB |
| `git diff --check` | clean |

Existing frontend warning: `Some chunks are larger than 500 kB after minification`. Deliberate finance failure-injection tests emit sanitized `[finance] operation failed { code: 'finance_failure' }` diagnostics. Git warns about future CRLF checkout for non-migration test/script files; migration 0028 itself remains LF.

Artifacts: `%TEMP%/smart-school-finance-regressions-jmfTOo/summary.json` and per-suite logs; `%TEMP%/smart-school-finance-legacy-PvMk8e/employees.log`.

### Genuine LOCAL D1 and seed — final evidence

`pnpm run test:finance-fees:local`: **exit 0**, **35 scenario checks passed / 0 unexpected failures** (previous 30 plus five new real-D1 migration-blocker cases).

| Local scenario | Verified result |
| --- | --- |
| Fresh 0001 → 0028 | all **29 genuine files** applied, including both distinct 0014 files |
| Populated 0027 → 0028 | every old column/row across **46 application tables** preserved |
| Legacy finance fixture | original currencies (including USD), amounts, statuses, IDs, balances, timestamps and immutable snapshots unchanged; old payment active and two historical receipt links backfilled |
| Duplicate fee identity | migration exit 1 as expected; complete schema/data/history rollback |
| Duplicate receipt number | migration exit 1 as expected; complete schema/data/history rollback |
| Duplicate receipt token | migration exit 1 as expected; complete schema/data/history rollback |
| Duplicate active payment reservation | migration exit 1 as expected; complete schema/data/history rollback |
| Missing receipt-linked payment | migration exit 1 as expected; complete schema/data/history rollback |
| Intentional fee and treasury drift | retained by migration; all **8** attempted operations return **409 / finance_reconciliation_required**, every application row unchanged |
| FK enforcement | **foreign_keys=1**, foreign_key_check **zero rows** for each blocker case, populated upgrade and final fresh-runtime database |

For all five negative migration cases, genuine Wrangler local migrations own the transaction; there is no manual history INSERT/DELETE or rollback workaround. Each starts from its own real 0001–0027 chain, and its history remains **28**, with the entire sqlite_schema identical after rejection. Expected child-command exit 1 is asserted explicitly; any unexpected exit, wrong error, partial schema/data/history mutation or failed integrity check fails the overall runner.

The nonempty populated fixture also covers student/enrollment/subject/grade data, school/academic settings, employee/salary, official document, result card and timetable/version history. Real local workerd repeats payment/receipt concurrency, late-stage batch rollback, cancellations, print rollback, receipt-year snapshots, mixed-year rejection and key-tamper rejection. Complete HTTP request budgets remain **4–9 D1 statements**, maximum **15** bound parameters.

Artifacts: `%TEMP%/smart-school-finance-local-jzKkiI/evidence.json` records all 20 Wrangler commands and scenario results; sibling `blocker-*/command-*.log`, `upgrade/command-*.log` and `fresh/command-*.log` retain full outputs.

`pnpm run test:finance-seed:local`: **exit 0**. Exact repository `seed.sql` ran **only on a separately created disposable LOCAL database after the 29 genuine migrations**. Eight IQD fees and eight payments passed per-row amount/cache/status/net/key/fingerprint and unique treasury-link assertions. Treasury stored balance **2,550,000** = calculated active IQD ledger **2,550,000**. Both readiness views healthy; FK enabled and clean.
Seed artifacts: `%TEMP%/smart-school-finance-seed-local-Rw4KbV/{migrations.log,seed.log,evidence.json}`. No seed file change.

All runners use dummy database IDs, generated `*-local-only` names, explicit `--local --config <temp> --persist-to <temp>`, `remoteBindings:false`, and `envFiles:[]`. Cloudflare/Wrangler guidance informed this isolation and real-runtime verification; no repository staging binding was used. Local scenario/legacy assertion counts are separate from node:test totals.

### Correction files and safety

Only these four files changed in this correction:

- `migrations/0028_finance_fee_payment_integrity.sql`: seven parser-safe spaces and compatibility comment.
- `test/finance-fees.test.mjs`: strict single-statement execution, expected object verification, byte/punctuation regression and old-test false-positive reproduction.
- `scripts/validate-finance-fees-local.mjs`: five disposable real-D1 blocker/atomic-rollback scenarios and explicit expected-failure handling.
- `docs/PHASE_20A1_FINANCE_QA_REPORT.md`: failed first staging attempt, scoped diagnosis, exact SQL diff and this evidence.

**Wrangler remains 4.118.0.** `package.json`, lockfiles, `.gitattributes`, source modules, seed.sql and migrations 0001–0027 are unchanged.
**ZERO remote D1 access in this correction task. NO STAGING retry. NO production access. NO remote seed/reset. NO manual deployment. NO merge.**
Commit/push and description update target the **same Draft PR #37** only. A second STAGING attempt requires **new explicit authorization after independent review**.

## Review follow-up — 2026-09-05 (historical; superseded above)

This section supersedes the initial submission's validation totals and seed statement below.

- Reviewed/reproduction HEAD: `27a2d9cc8ea6ca3d006587de88a1f6f65f992f63`.
- **Validated implementation HEAD: `9c079eef6abfee71ae7c6437f6abbcc38046db94`.** The final delivery HEAD includes a report-only follow-up; its exact SHA and latest CI link are recorded in the [same Draft PR #37 description](https://github.com/smartschoolduhok/smart-school/pull/37).
- Same branch: `fix/finance-fees-payments-integrity-phase-20a1`. No new PR or merge.
- No remote D1 command/read/write, staging/production access, remote migration/seed/reset, real school data, manual deployment, authentication change or dependency change. Only normal existing GitHub/Cloudflare Preview CI following the authorized branch push.
- Local/demo `seed.sql` is explicitly authorized for this follow-up and ran **only on newly created disposable LOCAL databases**. It is not a repair script for any existing database.
- Only unmerged/unapplied `0028` was refined. Migrations 0001–0027 are unchanged; no 0029. Migration 0028 raw CR/CRLF count: **0**.

### Confirmed pre-fix reproductions

Before production edits, the eleven initial review tests ran on the reviewed HEAD: **0 pass / 11 fail**, exit 1.

| Review finding | Observed before fix | Verified correction |
| --- | --- | --- |
| Fresh migrations then exact repository seed | SQLite and actual Wrangler LOCAL D1 both rejected seed with `invalid_finance_amount` | Exact fresh chain plus seed succeeds under intact production guards |
| Fee ledger 20,000 vs paid cache 50,000 | Payment, metadata edit, amount edit and cancellation returned success and rewrote cache | All four reject with `finance_reconciliation_required`; every application row unchanged |
| Treasury cache = ledger + 1 | All four operations were allowed; money operations silently recomputed the cache | All four reject without reconciling cache or inserting repair rows |
| Fee year A with active year B | Receipt incorrectly snapshotted B | Receipt and each payment snapshot use the fee's year A |
| Key-only SQL tampering | Changing fee_type_key without changing display fee_type succeeded | Direct SQL is rejected |

Pre-fix fresh D1 logs: `%TEMP%/smart-school-finance-seed-local-6GLevD/migrations.log` and `seed.log`. All 29 migration files applied first; the seed then exited 1 with `invalid_finance_amount: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_TRIGGER)`.

During implementation, an initial Unicode-whitespace `GLOB` guard passed Node SQLite but failed real workerd with `LIKE or GLOB pattern too complex: SQLITE_ERROR`. It was replaced with `instr` over a fixed code-point set via `json_each`. This is a corrected intermediate failure, not a claimed successful run. Final fresh workerd validation below passed.

### Local seed and financial invariants

Fees retain demo IDs 1–8 and begin with canonical keys, 500,000 whole IQD net, explicit zero discounts, paid_amount=0/status=pending. Eight deterministic `LOCAL-DEMO-PAYMENT-0001..0008` requests use the fixed local date 2025-05-01 UTC and the exact SHA-256 of the canonical payment payload (verified independently against `parsePayment` serialization in the test).

Production payment triggers create the paid/status caches, eight fee-linked treasury rows and the treasury account. Manual demo treasury identities are moved to 1001–1006 to avoid the automatic IDs and source collisions. Only local fixture construction initializes their combined opening cache from the exact ledger. No production reconciliation behavior is introduced.

`pnpm run test:finance-seed:local` / `node --experimental-strip-types scripts/validate-finance-seed-local.mjs`: **exit 0**.

| Assertion after exact fresh migrations → seed.sql | Actual |
| --- | --- |
| Genuine migrations copied/applied through 0028 | 29 files |
| PRAGMA foreign_keys | 1 |
| PRAGMA foreign_key_check | zero rows |
| IQD student fees checked individually | 8 |
| Payments checked individually | 8 |
| Every fee paid_amount equals active payment sum | yes |
| Every fee status/discount/net/key valid | yes |
| Every payment has exactly one matching active IQD fee_payment treasury link | yes |
| Deterministic request keys and exact 64-hex fingerprints | valid |
| School 1 treasury cached balance | 2,550,000 |
| School 1 active IQD ledger balance | 2,550,000 |
| Fee and treasury readiness views | all healthy |

Final real seed artifacts: `%TEMP%/smart-school-finance-seed-local-M380a9/` (`migrations.log`, `seed.log`, `evidence.json`). Test configuration uses a dummy database ID, explicit `--local`, an OS-temp persistence path, no repository env files and `remoteBindings:false`.

### Legacy consistency gate / operational preflight

`finance_fee_readiness` and `finance_treasury_readiness` are **read-only SQL views**, not caches or repair tables. They validate whole supported money, discount/net arithmetic, paid/status agreement, same-school/student payment scope, exact treasury payment links, required account existence and exact active ledger balance.

Payment INSERT and cancellation BEFORE triggers reject inconsistent pre-state within the writer transaction. Fee business edits have a column-specific BEFORE gate; canonical posting/reversal triggers modify only the paid/status/revision/timestamp fields after their own pre-state check. The API checks the same views in its existing fee SELECT (also covering no-op edits), with no extra round trip. No mutable bypass flag, claim marker, application mutex, background cleanup or reconciliation transaction is added. A brand-new school may bootstrap an account only when there is no prior treasury history.

Eight authenticated rejection tests plus eight direct-SQL rejection tests compare **all application rows before/after**. Consistent legacy state still allows ordinary metadata/posting/cancellation. Real workerd repeats all eight drift operation cases from intentionally inconsistent pre-0028 fixtures; migration preserves the inconsistencies rather than fixing them.

The local-only preflight now separates:

- `migration_safe` / `migration_blockers`: duplicate identities/documents, broken receipt selections/totals and foreign keys.
- `operational_ready` / `operational_blockers`: fee paid/status/net/discount drift, invalid whole IQD, payment scope/treasury links, missing account, treasury cache drift and unsupported active currencies.
- `warnings`: legacy statuses such as overdue requiring review, without making their presence a migration failure.

The compatibility `safe` field still means **migration-safe only**, not finance-ready. CLI exits nonzero when operational readiness fails. It uses fixed table reads/maps rather than receipt/payment N+1 queries and `DatabaseSync(...,{readOnly:true})`; it never repairs data.

Actual read-only CLI checks on the disposable workerd SQLite files:

| Local database | Migration blockers | Operational findings | Exit |
| --- | ---: | --- | ---: |
| Populated upgrade fixture | 0 | legacy USD fee; fee 3 paid 50,000 vs ledger 20,000; school 2 treasury 20,001 vs ledger 20,000 | 1, expected |
| Fresh seeded fixture | 0 | none | 0 |

Command: `node --experimental-strip-types scripts/preflight-finance.mjs <explicit generated local SQLite file>`. Eleven additional intentionally inconsistent local cases verify the individual findings and unchanged historical columns through migration.

### Receipt year / fee identity

For a **new** receipt, all selected payments must share one nullable fee academic_year_id. Multiple fee types in that same year are valid; different years or null+named year return sanitized `receipt_academic_year_conflict` with no document/link write. The year must belong to the fee's school. Null remains null, not the active year.

Set-wise SQL checks revalidate this at INSERT time and verify the top-level year snapshot matches the selected fee year. Per-payment immutable evidence now includes student_fee_id, academic_year_id and academic_year_name. Already-issued documents, including exact-set reuse, are not rewritten; public verification and private print read the original snapshots even after an academic year is renamed/activated elsewhere. Manual and opt-in automatic receipts retain their shared engine.

The fee UPDATE guard rejects key-only tampering. An unchanged display type keeps its original canonical key; a changed type must equal its bounded nonempty canonical key. Unicode/noncanonical whitespace is rejected without unsupported D1 pattern complexity. Migration preserves legacy display text.

### Final regressions / runtime / builds

All nineteen configured package suites were rerun using their exact Node commands via `scripts/run-finance-regressions.mjs`; **exit 0**. `pnpm run test:finance-fees` was also rerun directly after strengthening the exact public snapshot assertion: 144/144.

| Suite | Pass | Fail | Skip |
| --- | ---: | ---: | ---: |
| Finance fees (99 existing + 45 review regressions) | 144 | 0 | 0 |
| Security | 22 | 0 | 0 |
| RBAC / tenant | 95 | 0 | 0 |
| Settings | 5 | 0 | 0 |
| Academic years | 30 | 0 | 0 |
| Student enrollments | 58 | 0 | 0 |
| Student promotion | 129 | 0 | 0 |
| Student profile | 24 | 0 | 0 |
| Subject management | 59 | 0 | 0 |
| Subject order | 21 | 0 | 0 |
| Religious subjects | 39 | 0 | 0 |
| Subject applicability | 3 | 0 | 0 |
| Flexible grades | 36 | 0 | 0 |
| Grade presentation | 9 | 0 | 0 |
| Result cards | 66 | 0 | 0 |
| Excel import | 81 | 0 | 0 |
| Timetable | 319 | 0 | 0 |
| Teaching load matrix | 117 | 0 | 0 |
| Week setup | 89 | 0 | 0 |
| **Modern executions** | **1,346** | **0** | **0** |

There are **1,254 distinct modern tests**: result-card 66, settings 5 and subject-order 21 each run twice. Do not combine tests, assertions and runtime scenarios into a misleading distinct-test total.

- Real workerd `test:finance-fees:local`: **30 scenario checks pass**, exit 0. Fresh chain applies 29 genuine migrations. Populated 0027→0028 preserves all old columns/rows across 46 application tables, including generated grade/card/timetable/employee data, legacy currency and the two intentional financial discrepancies. FK enabled and clean.
- Final local runtime artifacts: `%TEMP%/smart-school-finance-local-6Wks88/evidence.json` plus exact command logs. All eight drift operations returned 409 with no application changes. Old-year/null/mixed receipt cases and key tamper rejection passed on real workerd.
- Complete authenticated HTTP budgets remain **4–9 D1 statements**: fee edit 5; payment 7; payment retry 4; cancel 6; receipt for one or ten payments 8; concurrent receipt loser 9; print 7. Drift payment rejection 8, metadata/amount rejection 4, cancellation rejection 6; mixed-year rejection 5. Maximum parameters 15, no N+1 round trips.
- `scripts/validate-finance-legacy-local.mjs`: existing employee/salary/treasury shell assertions **40 pass / 0 fail**, exit 0. Final log: `%TEMP%/smart-school-finance-legacy-U9bZfc/employees.log`.
- `node test_treasury_rollback.js`: rerun, **exit 1 before assertions** (`ReferenceError: require is not defined in ES module scope`, line 15). Pre-existing harness incompatibility; not called a passing or skipped suite, and not altered to patch/restart a fixed service. Modern and actual-D1 injected failure tests cover fee-linked atomic rollback safely.
- `pnpm run typecheck`: exit 0.
- `pnpm run build:fe`: exit 0, 1,910 modules.
- `pnpm run build:api`: exit 0, 76 modules, Worker 590.70 kB.
- `git diff --check` and staged diff check: clean.
- Final full-suite logs: `%TEMP%/smart-school-finance-regressions-RLA4PZ/summary.json` and per-suite logs. Expected sanitized failure logs occur only in deliberate rollback injection cases. Existing Vite >500 kB frontend chunk warning and non-migration Git LF/CRLF notices remain.

### Review follow-up files

| File | Change |
| --- | --- |
| migrations/0028_finance_fee_payment_integrity.sql | Read-only readiness views and transaction gates, fee key guard, receipt year authority |
| src/lib/financeFees.ts | Safe reconciliation and receipt-year error messages |
| src/lib/financeFeesDb.ts | Same readiness on edit/no-op, fee-year receipt snapshots/evidence |
| seed.sql | Fresh-local invariant-valid fees/payments and collision-free manual ledger fixture |
| scripts/preflight-finance.mjs | Separate migration and operational-readiness findings, read-only local CLI |
| scripts/validate-finance-fees-local.mjs | Genuine pre-0028 drift fixtures, rejection/snapshot/key tests and request counts |
| scripts/validate-finance-seed-local.mjs | Exact fresh local migrations then repository seed validation |
| test/helpers/finance-seed-assertions.mjs | Shared semantic ledger, links, fingerprint and FK assertions |
| test/finance-review.test.mjs | 45 focused review regressions |
| test/finance-fees-api.test.mjs | Keep overflow fixtures financially consistent; no weaker assertions |
| package.json | Include review regressions and explicit local seed test script |
| docs/PHASE_20A1_FINANCE_QA_REPORT.md | Reproductions, current implementation SHA, exact evidence and limitations |

### Preview and remaining boundary

GitHub's Cloudflare Pages check for validated implementation HEAD `9c079ee` reports **SUCCESS / Deployed successfully**. Reported immutable [Preview](https://278a1f39.smart-school-staging.pages.dev) and [branch Preview](https://fix-finance-fees-payments-in.smart-school-staging.pages.dev). These links/status were read from GitHub check metadata only. The report-only follow-up's final HEAD/CI status are also recorded in the PR description.

No Preview HTTP request or authenticated staging QA was performed. CI build success is not database readiness: **0028 is not remotely applied**. Legacy financial discrepancies must undergo separately authorized administrative review; this PR neither repairs them nor broadens Phase 20A1 into salary/manual-treasury reconciliation.

## Initial submission record (historical; superseded above)



## Outcome and scope

Local validation passed for the fees/payment/receipt stabilization described below. This is **not approval for real financial operations** and not authenticated staging QA. Migration 0028 has **not** been applied remotely. A Preview build alone cannot validate the new database behavior.

- Reviewed base: `d4e3453c17012b5da90d47b7c437def43587806d`, the verified merge of Phase 19C / PR #36.
- Branch: `fix/finance-fees-payments-integrity-phase-20a1`.
- Started from clean latest verified `origin/main`; no applicable AGENTS.md was present.
- One new migration: `0028_finance_fee_payment_integrity.sql`; no historical migration changes.
- No remote D1 command/read/write, staging/production access, real-school fixtures, seed.sql, remote reset, manual deployment, credential change, backup of real data, or merge.
- Only synthetic local fixtures and disposable local databases were used. Normal existing PR Preview CI is permitted; operational database verification requires separate authorization.

## Reproductions before production changes

The initial ten focused tests were run against the reviewed base **before replacing production finance logic**: 0 passed / 10 failed. These were actual failures, not inferred findings. The retained `reproduce ...` tests now pass.

| Finding | Observed base behavior | Corrected behavior |
| --- | --- | --- |
| A — private finance read | Teacher received HTTP 200 for school fees | Finance role gate returns 403 |
| B — zero net | 100% discount followed by payment of 1 IQD was accepted (201) | Zero net remains zero, status paid; payment rejected |
| C — concurrent payment | Two 60,000 requests against 100,000 both returned 201 when both old SELECT snapshots were held before writes | Database checks current active ledger inside writer transaction; one commits |
| D — late cache failure | Injected treasury-account insert failure returned 500, compensation removed payment/restored fee but left an orphan 60,000 treasury income | Whole operation and response read roll back together |
| E — edit below paid | Fee with 60,000 paid could be reduced to 50,000 (200) | Rejected; history/cache unchanged |
| F — non-IQD | USD fee creation returned 201 | Explicit unsupported-currency rejection; legacy USD preserved |
| G — incomplete receipt set | `[valid payment, 9999]` generated a partial receipt | Entire selection rejected |
| G — duplicate document | Repeated identical selection produced different receipt IDs | Same active exact payment set returns same document |
| H — private receipt read | Teacher could directly read receipt (200) | Teacher/registrar/parent denied |
| H — private print | Registrar could mark receipt printed (200) | Finance-only; document/print-record change atomic |

The initial uncoordinated concurrency probe did not reproduce C reliably. The failing reproduction deliberately synchronizes **both reviewed-base pre-read snapshots**; the new implementation does not use that unscoped pre-read. Independent actual workerd D1 concurrency was then run after the fix.

Additional hardening tests cover optimistic fee-update races, corrupt treasury links, aggregate safe-integer limits, exact integer ledger aggregation, mixed-currency treasury blocking, incomplete/cancelled/overlapping receipt sets, and every private route/role. The large-intermediate-balance check already passed on the local SQLite version before integer aggregation was tightened; this is defense in depth, **not an additional claimed base reproduction**.

## Implementation and invariants

### Roles and school authority

`registerFinanceRoutes()` uses the existing unchanged `FINANCE_ACCESS_ROLES`. Authentication still runs in the existing Worker middleware; authorization precedes private body parsing.

| Identity | Private finance access | School |
| --- | --- | --- |
| system_admin | Allowed | Explicit active target required on reads and writes |
| school_owner / principal / vice_principal / accountant | Allowed | Authenticated JWT school; foreign supplied school rejected |
| teacher / registrar / parent | 403 | No private finance access |
| unauthenticated | 401 | None |
| Public `/api/verify/receipt/:token` | Remains public | Existing token-scoped snapshot verification |

All twelve existing/new private routes are covered directly by the authenticated API matrix:

```
GET, POST       /api/student-fees
PUT, DELETE     /api/student-fees/:id
GET, POST       /api/fee-payments
PUT             /api/fee-payments/:id/cancel
GET             /api/fee-receipts
GET             /api/fee-receipts/:id
POST            /api/fee-receipts/generate
PUT             /api/fee-receipts/:id/cancel
PUT             /api/fee-receipts/:id/mark-printed
```

Foreign/missing private IDs have equivalent sanitized responses. Student/class/section/year/creator joins include school constraints; creator names from school-null system administrators are not joined across tenants. Shared print history excludes finance records for non-finance viewers and admin-wide reads, closing an alternate metadata path. Public verification no longer exposes SQL error detail. No role list, JWT, PBKDF2, throttling, or academic semantics changed.

### Fees, money, and edits

- IQD only for new/edited fee operations; positive safe whole-integer fee/payment amounts. No parsing that truncates fractions.
- Bounded strict allowlists, numeric IDs, same-school active student, same-school optional academic year, bounded notes/type, and Unix-second dates (or null where allowed).
- Fee-type identity uses only trim and whitespace collapse, including Unicode whitespace. Unique scope includes school, student, academic year with explicit NULL semantics, and canonical type.
- Percentage precision is at most two decimal places, range 0..100. Discount is rounded to nearest whole IQD, **half up**. BigInt domain arithmetic avoids binary floating-point multiplication; the database validates the equivalent integer formula, including maximum-safe boundary tests.
- Fixed discount is a whole integer between zero and original amount. `net_fee = amount - discount`; zero is retained with `??`, never `||`.
- Status vocabulary remains pending / partial / paid. A zero-net fee is paid and cannot receive payment.
- Active valid payments are authoritative. Fee updates use the active ledger and an optimistic `finance_revision`, backed by commit-time database validation. School, student, and academic year are immutable. Net below paid is rejected; exact no-op has no writes.
- A fee with any payment history cannot be deleted; payment and receipt histories cannot be hard-deleted through the new guards.
- Legacy non-IQD rows remain byte/value-equivalent in old columns. Payments/edits against them fail explicitly; no conversion or relabeling. Active non-IQD treasury data also blocks fee posting/reversal rather than being recomputed as IQD.
- Integer casts are used for validated whole-money ledger sums inside posting/reversal. Unsafe resulting balances/fractional existing active treasury entries abort, not round. Salary/manual-treasury workflows themselves are not redesigned here.

### Atomic payment and idempotency

The client generates one crypto UUID per payment draft, disables in-flight duplicate submission, retains that key and frozen payload on uncertain retry, and resets only on confirmed success or an explicitly confirmed new draft. A school switch clears the school-bound draft.

The server persists a school-unique `client_request_id` and SHA-256 fingerprint of the canonical request. Identical retry returns the existing payment with `already_applied`; an altered request with the same key returns 409. `remaining` is retained in the payment response. A concurrent winning row is accepted only if its fingerprint matches.

One D1 batch contains payment INSERT and final response SELECT. Database triggers in that same writer transaction:

1. Validate active school/student/fee, currency, current outstanding amount and request metadata.
2. Recompute fee paid cache/status and advance revision.
3. Insert the same-school IQD `income / tuition_fee / fee_payment` treasury row.
4. Recompute treasury account cache from the active ledger.

The payment contains its own committed idempotency record; there is no separately committed claim row. No process-local mutex or compensating delete/update is used. Failure of the final response SELECT is still inside the batch and rolls back the financial writes.

Cancellation requires a trimmed reason and an active payment. An active receipt blocks it with instructions to cancel the document first. Exact linked treasury identity, type, status, currency, amount, school, and account must be consistent. One atomic update plus response read records audit metadata, cancels that ledger income, and recomputes fee/cache once. Repeated cancellation does not reverse again. Corruption blocks without guessing.

### Receipts and print

- `fee_receipt_payments` adds durable relational links, retaining snapshot JSON for historical documents. A partial unique index permits only one active reservation per payment.
- Set-based validation resolves **all** requested IDs, checks school/student, active state, IQD, uniqueness, safe amounts, and exact total. No JSON-LIKE identity checks, no per-payment API query loop.
- Exact same active payment set returns the existing receipt. A subset, overlapping sets, or multiple conflicting active documents are rejected. Concurrent identical requests return one winning document.
- Receipt numbers and verification tokens use crypto UUIDs with database uniqueness. Historical identity, totals, snapshot fields and tokens are immutable.
- Receipt cancellation records reason/user/time, preserves snapshot and money, and releases active reservations. Replacement receipt or later payment cancellation is then possible. Cancelled QR verification remains correct.
- Mark-printed batches the print-record insert, receipt timestamp update, and response read. A cancelled receipt cannot be printed as active.
- Opt-in automatic receipt creation reuses the exact manual receipt engine. It remains a **separate document step after committed money posting**: document failure yields a sanitized warning; it neither repeats payment nor falsely claims money was rolled back.
- Print UI requires finance access and explicit admin target, ignores stale school/receipt requests, blocks cancelled printing, and surfaces failure. Whole-IQD presentation and Unix-second issue dates are correct (the new rendered test caught the old 1970 issue-date display). Legacy currencies/amounts are not rewritten.

Stable Arabic errors include all requested fee/payment/receipt codes in `financeFees.ts`; clients receive no internal SQL, stack, fingerprint, credential, or secret.

## Migration 0028 and upgrade safety

Additions: fee canonical identity/revision; payment active/cancelled state, cancellation audit and idempotency metadata; receipt cancellation audit; relational receipt-payment links; narrow unique/supporting indexes and integrity/posting/reversal/print triggers. Legacy payment status defaults to active.

The migration does **not** rewrite an existing amount, currency, balance, ID, snapshot or business status. It computes only the new fee key and new receipt associations. Both active and cancelled historic documents get links; only active documents reserve payments.

Duplicate fee identities, duplicate receipt number/token, duplicate active reservations, or malformed/unresolved/mismatched historic receipt selections stop the migration; no destructive cleanup is attempted. Five adversarial upgrade cases prove transaction rollback and old-row preservation.

`scripts/preflight-finance.mjs` opens an **explicit local SQLite path read-only** and reports duplicate fee identities, receipt collisions, malformed IDs/status, unresolved payments, receipt-total mismatch, active reservation overlap, FK violations and legacy non-IQD fee IDs. It exits nonzero for blockers and never contacts Cloudflare. Example, only for an independently authorized local file:

```
node scripts/preflight-finance.mjs C:/explicit/local/database.sqlite
```

Before any future remote authorization: separately inspect the real target's migration history and legacy conditions, obtain a data-review decision on any blocker, and stop on duplicates/corruption. This task did not inspect that data and cannot claim staging is ready to migrate. The preflight is not a complete legacy-ledger repair tool; inconsistent historic ledger/cache data remains subject to guarded blocking and administrative review.

Wrangler 4.118.0's real SQL splitter initially exposed an `incomplete input: SQLITE_ERROR` in the **new local migration** although direct SQLite accepted it. Inspection showed its compound-statement recognizer requires whitespace before nested `CASE`; `SUM(CASE...)` / `!=CASE...` could split a trigger early. Only SQL whitespace was adjusted in 0028, and a regression runs the real `unstable_splitSqlQuery()` fragments. No dependency upgrade. Migration 0028 has `eol=lf`, actual CRLF count 0.

## Actual local workerd / D1 evidence

Command: `pnpm run test:finance-fees:local` (exit 0). Runner creates independent OS-temp configurations named `finance-upgrade-local-only` and `finance-fresh-local-only`, dummy database ID ending `0028`, `--local`, isolated persistence, `remoteBindings:false`, `envFiles:[]`. It never invokes the repository's configured remote database.

- Fresh genuine migrations 0001 through 0028: **29 files** (including both distinct 0014 files), successful.
- Populated 0027 -> 0028: successful. Compared **all original columns and rows in 46 pre-existing application tables**, not only counts.
- Nonempty synthetic fixtures include students/enrollment/subjects/grades, academic years, employees/salary, timetable/history, result card, official template/book, school/grade settings, fees, payment, active/cancelled receipts, treasury transaction and account.
- Legacy USD fee untouched; historical payment active; two receipt links backfilled. Original balances, old status fields, IDs, and immutable snapshots unchanged.
- `PRAGMA foreign_keys = 1`; `PRAGMA foreign_key_check` returns zero rows after upgrade and after fresh integration operations.
- **18 integration scenario checks passed**, plus per-request response, identity, query-limit and parameter-limit assertions.
- Different-key 60,000 + 60,000 / 100,000: one HTTP 201, one HTTP 400 `payment_overpay`; active payment sum and fee cache both 60,000.
- Concurrent same key: one 201 / one 200, identical payment ID, one money effect.
- Concurrent same receipt selection: both 200, same receipt ID, one active document.
- Receipt of ten payments: exact 10,000 IQD; one set-based validation pipeline.
- Injected first payment write, fee-summary stage, treasury insertion, balance-cache stage, and final response-read failures: every application table equals the before snapshot. Receipt/payment cancellation and print final-read rollback also verified on real D1.
- Final treasury cache equals active ledger. No assertion/claim debris.

This uses actual production Hono handlers and SQL through `getPlatformProxy()` against **real local workerd D1**. HTTP handlers are invoked by the Node/Vite local harness; this is not a deployed Worker, browser end-to-end, or proof of authenticated Preview functionality.

Reproducible artifacts from the final run (generated local data only, not committed):

```
%TEMP%/smart-school-finance-local-RcjmFo/evidence.json
%TEMP%/smart-school-finance-local-RcjmFo/{fresh,upgrade}/command-*.log
```

The runner records every concrete Wrangler command. Pattern (actual paths generated under that directory):

```
node <repo>/node_modules/wrangler/bin/wrangler.js d1 migrations apply finance-upgrade-local-only --local --config <temp>/upgrade/wrangler.json --persist-to <temp>/upgrade/state
node <repo>/node_modules/wrangler/bin/wrangler.js d1 execute --file <temp>/upgrade/generated-local-fixtures.sql finance-upgrade-local-only --local --config <temp>/upgrade/wrangler.json --persist-to <temp>/upgrade/state
# Repeat migrations apply after copying 0028; then independent fresh 0001->0028.
```

No `--remote`, `seed.sql`, manual `d1_migrations` manipulation, or real DB identifier was used in these commands.

### Complete-request D1 budget

Measured at the actual D1 prepare/execute/batch boundary, **including authentication and school lookup**. Each batch statement is counted separately; SQL inside a database trigger is part of that statement, not a new Worker/D1 API invocation. Response/error queries are included. Maximum bound parameters observed: 15.

| Complete HTTP operation | Executed D1 statements |
| --- | ---: |
| Fee create | 4 |
| Fee update | 5 |
| One payment | 7 |
| Idempotent payment retry | 4 |
| Concurrent overpayment loser | 8 |
| Concurrent same-key loser returning winner | 8 |
| Payment cancellation | 6 |
| Receipt for one payment | 8 |
| Concurrent identical receipt loser returning winner | 9 |
| Receipt for ten payments | 8 |
| Receipt cancellation | 6 |
| Mark printed | 7 |

All measured complete requests were below 50, including injected-failure paths (maximum 9). Set cardinality does not produce N+1 D1 calls. Read-only snapshot/test setup queries outside HTTP requests are intentionally not counted as request queries.

## Tests and builds

`node scripts/run-finance-regressions.mjs` executes the exact Node commands configured by the corresponding `pnpm run test:*` package scripts, records logs/results, and exits nonzero on failure or missing counts. Final command exit: **0**.

| Package suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| finance-fees | 99 | 0 | 0 |
| security | 22 | 0 | 0 |
| rbac | 95 | 0 | 0 |
| settings | 5 | 0 | 0 |
| academic-years | 30 | 0 | 0 |
| student-enrollments | 58 | 0 | 0 |
| student-promotion | 129 | 0 | 0 |
| student-profile | 24 | 0 | 0 |
| subject-management | 59 | 0 | 0 |
| subject-order | 21 | 0 | 0 |
| religious-subjects | 39 | 0 | 0 |
| subject-applicability | 3 | 0 | 0 |
| flexible-grades | 36 | 0 | 0 |
| grade-presentation | 9 | 0 | 0 |
| result-cards | 66 | 0 | 0 |
| excel-import | 81 | 0 | 0 |
| timetable | 319 | 0 | 0 |
| teaching-load-matrix | 117 | 0 | 0 |
| week-setup | 89 | 0 | 0 |
| **Modern suite executions** | **1,301** | **0** | **0** |

These commands overlap: result-card 66, settings 5, and subject-order 21 each execute twice. Therefore **1,209 distinct modern tests**, not 1,301 distinct tests. Finance comprises 29 domain/migration tests, 63 authenticated API tests, and 7 actual React interaction tests. Role/scenario loops contain additional assertions and are not inflated into extra test counts.

React coverage: zero-net/IQD/whole-money fields; opening Receipts before Payments and eligibility; busy double submission and exact UUID/payload retry; explicit new-draft confirmation; payment cancellation reason; document cancellation reason without money API; same-school stale receipt-route rejection plus receipt date/whole-money rendering.

Legacy coverage/status:

- `test_employees_full.sh`: **40 passed / 0 failed**, exit 0 through `scripts/validate-finance-legacy-local.mjs`. Only transport/temp/Python executable paths are adapted in an OS-temp copy. Original assertions run against the actual application, generated in-memory fixtures and an ephemeral 127.0.0.1 listener. Includes employee RBAC/CRUD/archive, salary generation/payment/cancellation, linked treasury entry and balance restoration. No application source patch, PM2 restart, fixed localhost service or seed file.
- `node test_treasury_rollback.js`: **exit 1 before assertions** with `ReferenceError: require is not defined in ES module scope`. This pre-existing CommonJS script is incompatible with the repository's `type: module`. Its old strategy also patches worker source and restarts a fixed PM2 service; it was not converted/executed past that failure. It is **not** reported as a passing legacy suite. New API and real-D1 rollback tests cover the fee-to-treasury failures safely.
- Real-D1 integration: 18 scenario checks / 0 failures, reported separately from node:test counts. Modern 1,301 executions + 40 legacy assertions + 18 D1 scenarios = **1,359 successful checks/executions** of different granularities; these must not be called 1,359 distinct node tests. One additional legacy harness invocation failed before assertions.

Final modern logs: `%TEMP%/smart-school-finance-regressions-grHEx0/summary.json` and per-suite logs. Legacy final log: `%TEMP%/smart-school-finance-legacy-joOP4C/employees.log`.

| Build/check | Result |
| --- | --- |
| `pnpm run typecheck` | exit 0 |
| `pnpm run build:fe` | exit 0; Vite 6.4.3, 1,910 modules |
| `pnpm run build:api` | exit 0; 76 modules, `dist/_worker.js` 589.58 kB |
| `git diff --check` | clean |

Warnings/diagnostics: existing frontend chunk-size warning (`Some chunks are larger than 500 kB after minification`), local concurrent Vite `WebSocket server error: Port 24678 is already in use` (both runners still exit 0), expected sanitized `[finance] operation failed { code: 'finance_failure' }` from deliberate rollback injections, and Git LF/CRLF notices on non-migration files. Migration 0028 itself remains LF-only. No runtime dependency changes or lockfile updates.

## Files and rationale

| File | Purpose |
| --- | --- |
| `src/lib/financeFees.ts` | Shared integer-IQD arithmetic, strict request parsing, stable safe errors |
| `src/lib/financeFeesDb.ts` | Canonical scoped private routes, atomic payment/cancellation/receipt/print engines |
| `src/worker.ts` | Register canonical engine, remove old non-atomic duplicates, prevent print-history bypass and public SQL-error leak |
| `migrations/0028_finance_fee_payment_integrity.sql` | Additive audit/idempotency/linkage/index/trigger integrity |
| `src/lib/api.ts` | Explicit receipt school target and reasoned document/payment cancellation requests |
| `src/modules/fees/FeesPage.tsx` | IQD/zero-net UI, stable draft retry, cancellation distinction, reliable receipt eligibility |
| `src/modules/print/PrintReceiptPage.tsx` | Finance gate/target, print failure/cancel safety, stale-request protection, correct money/date display |
| `test/finance-fees.test.mjs` | Domain, real splitter, populated upgrade and blocker tests |
| `test/finance-fees-api.test.mjs` | Reproductions, RBAC/tenant/atomicity/idempotency/concurrency/cancellation tests |
| `test/finance-fees-ui.test.mjs` | Focused actual React interactions with mocked local HTTP responses |
| `test/helpers/finance-fixture.mjs` | Synthetic genuine-migration fixtures and atomic local adapter |
| `scripts/preflight-finance.mjs` | Read-only local upgrade blocker detector |
| `scripts/validate-finance-fees-local.mjs` | Fresh/upgrade genuine workerd D1 validation and request budgets |
| `scripts/run-finance-regressions.mjs` | Repeatable critical suite execution/counts/logs |
| `scripts/validate-finance-legacy-local.mjs` | Safe transport adapter for existing employee/salary/treasury assertions |
| `package.json` | Two new finance test scripts only |
| `docs/PHASE_20A1_FINANCE_QA_REPORT.md` | This audit and handoff |

## Limits and next phases

- Remote migration/data preflight and authenticated staging/manual QA are still required under separate explicit authorization. Do not use this branch's finance endpoints against an unmigrated database and interpret a successful frontend build as finance readiness.
- Legacy duplicates/corruption intentionally block instead of auto-repairing; no automated data cleanup, currency conversion or ledger rewriting is supplied.
- Payment draft keys survive uncertain retry within the mounted UI draft, not browser reload/navigation. Cross-navigation draft recovery is deferred UX; operators must review existing payments before deliberately starting a new draft.
- Existing scalar/JSON document snapshot layout is preserved, apart from correctness-driven currency/date display. A print timestamp proves accepted print initiation, not that a physical printer produced paper.
- Free-tier query-count budget is validated; large-school pagination, database size/load testing and production-scale soak tests are not claimed.
- Phase **20A2**: salary/manual treasury integrity stabilization, daily closing, reporting and reconciliation beyond the fee-linked ledger operation; modernize remaining legacy treasury harnesses.
- Phase **20B**: broader finance navigation, simpler workflows, confirmation/draft-recovery UX, document presentation and operator pilot feedback. No commercial expansion, online payment, parent portal or multi-currency work here.
- Cloudflare/Workers skill guidance influenced the atomic D1 design and actual local-runtime validation. Relevant current primary reference: [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

**Historical note:** At the time of the initial delivery this PR was intentionally kept Draft and unmerged. This requirement was later satisfied by successful REMOTE/STAGING validation, Manual QA, and the final merge of PR #37. See the Final acceptance section at the top of this report.
