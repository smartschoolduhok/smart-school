# P0 Tenant Isolation Audit

## Scope

Reviewed every `/:id` route in `src/worker.ts` together with direct `SELECT`, `UPDATE`, and `DELETE` statements for tenant-owned records. The audit focused on students, academic structure, student subjects, grades, result cards, finance, treasury, employees, salaries, official books, print records, imports, and school settings.

## Confirmed issues fixed in this branch

- Result-card section generation selected only `annual_effort` but read `result_status`, which could incorrectly mark a student as passed. Student and section generation now share one evaluator and the same complete grade projection.
- Result cards could be generated without an active academic year or from partially entered grades. Generation now rejects missing grade rows, incomplete required grade fields, and missing active academic years.
- Result-card generation/cancellation/print endpoints did not enforce the requested server-side role matrices. They now use centralized RBAC constants.
- Student creation/update accepted class or section IDs owned by another school. Class/section placement is now validated before mutation, and final mutations include `school_id`.
- Section and subject creation/update could create cross-school academic relationships, especially for `system_admin` requests containing inconsistent IDs. These relationships are now validated regardless of role.
- Student-subject bulk assignment and mutation paths did not consistently scope student selection and final updates by `school_id`. Reads, joins, and writes are now tenant-scoped.
- Grade writes relied on a preflight school check but mutated by ID alone. Grade joins and final updates now include the owning school.
- Import rows could pass raw class/section, student, or subject IDs from another school. Import validation now verifies placement and student/subject ownership before inserts or updates, and imported assignment placement is taken from the validated student record.
- Official-book template update, book cancellation, and print registration trusted an ID without a complete tenant check. Each operation now loads the owner, rejects cross-school access, and scopes final mutations by `id` plus `school_id`.
- Official-book creation did not verify that optional students/employees and their academic placement belonged to the target school, and missing entities could be silently ignored. Missing entities now return `404`; cross-school entities return `403`; invalid placement returns `400`.
- Import-job detail exposed a job selected only by ID. The response is now rejected when the job belongs to another school.

## Reviewed paths with existing tenant checks

Fee, payment, receipt, treasury, employee, and salary ID routes load the target record and reject a school mismatch before performing business mutations. No direct cross-school bypass was confirmed in those request paths during this audit.

## Recommended follow-up PR

The schema still relies heavily on application checks because many child tables use single-column foreign keys. A separate migration-focused PR should add composite tenant constraints where SQLite/D1 permits them (for example `(school_id, student_id)` and `(school_id, subject_id)` relationships), add database uniqueness for one active result card per student/year, and move multi-step payment, salary, receipt, result-card, and official-book writes into explicit atomic transaction patterns. It should also convert the remaining finance/payroll final mutations from ID-only SQL to `id + school_id` as defense in depth, even where the current preflight check already prevents a confirmed cross-school request.
