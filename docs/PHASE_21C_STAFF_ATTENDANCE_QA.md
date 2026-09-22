# Phase 21C — Employee and teacher attendance

Date: 2026-09-22

Base: `719b9c8` (`main`, merged PR #50)

Branch: `codex/phase-21c-staff-attendance`

Status: implementation, local quality gates, the authorized STAGING migration and authenticated immutable-Preview acceptance are complete. [Draft PR #51](https://github.com/smartschoolduhok/smart-school/pull/51) remains open and unmerged. Production was not contacted.

## 1. Scope

This phase adds a dedicated employee/teacher attendance domain. It deliberately does not reuse or rewrite per-lesson student attendance or student school-gate movements.

Delivered behavior:

- management and registrars can issue one active signed QR card per active employee, revoke it with a reason and issue a replacement without changing history;
- the scanner accepts a USB/keyboard reader and progressively uses the browser camera when `BarcodeDetector` is available;
- every scan records entry or exit using the Baghdad business date and clock, the active academic year, employee identity snapshots and the applicable work-time/grace snapshots;
- staff start/end times, late grace, early-exit grace and duplicate-scan window are configured independently from student gate settings;
- a database-enforced duplicate window rejects repeated movements atomically;
- exceptional manual entries are limited to the previous 30 days and require an immutable operational reason; an optional internal note remains management-only;
- wrong movements are voided non-destructively with a mandatory reason and an immutable audit row;
- the daily report derives first entry, last exit, incomplete movements and late/early-exit exceptions without creating payroll or treasury writes;
- accountants receive read-only reporting with internal notes, manual reasons and void reasons suppressed;
- a linked teacher sees only their own active movements and no management-only fields;
- the Arabic RTL page provides scanner, report, cards and settings views, plus a personal teacher view, and its layouts are safe at 390 px.

## 2. Authorization boundary

| Role | Operation | Daily report | Personal feed |
|---|---:|---:|---:|
| `system_admin` | Yes, with explicit school | Yes | No |
| `school_owner`, `principal`, `vice_principal`, `registrar` | Own school | Own school | No |
| `accountant` | No | Own school, read-only | No |
| linked `teacher` | No | No | Own linked employee only |
| `parent` and other roles | No | No | No |

Tenant and role checks are enforced in the API and repeated by database triggers for employee, actor, card and academic-year scope. Switching the selected school clears employee/card/manual selections and ignores stale responses.

## 3. Data integrity and auditability

Migration `0040_staff_attendance.sql` introduces:

- `staff_attendance_settings`;
- `employee_attendance_cards`;
- `employee_attendance_events`;
- `employee_attendance_event_audit`;
- `employee_attendance_write_guards`.

The card payload is `SSE1.<random UUID>.<HMAC-SHA-256>`. It contains no employee identifier, uses a domain-separated signing message and stores no reusable signature in D1. A scan revalidates the signature, active card, exact school, active employee, active academic year and hire-date boundary.

Events preserve employee name/number/role/title, academic year, work start/end times and both grace values used for classification. Event identity, snapshots and source metadata are immutable. Deletion and reactivation are rejected. Voiding updates only the lifecycle fields and creates one immutable audit row in the same atomic D1 operation. A checked write guard makes concurrent/repeated void attempts fail closed.

The attendance domain has no trigger or route that creates salary, deduction or treasury records. Any future payroll consequence requires a separate reviewed workflow and explicit policy.

## 4. Routes and interface

- `GET|PUT /api/staff-attendance/settings`
- `GET /api/staff-attendance/employees`
- `GET|POST /api/staff-attendance/cards`
- `POST /api/staff-attendance/cards/:id/revoke`
- `POST /api/staff-attendance/scan`
- `POST /api/staff-attendance/manual`
- `GET /api/staff-attendance/events`
- `GET /api/staff-attendance/summary`
- `POST /api/staff-attendance/events/:id/void`
- `GET /api/staff-attendance/self`
- UI: `/staff-attendance`

## 5. Local automated evidence

- focused attendance API/UI matrix: `43/43` PASS, zero failure and zero skip;
- new Phase 21C contract coverage: 14 tests across API/database/security and UI/role/responsive contracts;
- full regression matrix: `1578/1578` PASS, zero failure and zero skip;
- TypeScript: PASS;
- frontend and Worker production builds: PASS;
- `npm audit`: zero vulnerabilities;
- fresh isolated local D1: `41/41` migrations, ending at `0040_staff_attendance.sql`;
- Phase 21C release-gate count after `0040`: `78` total tables, accounting for `d1_migrations` and `sqlite_sequence`, and `76` application tables when those two are excluded; `0040` creates exactly five tables;
- fresh local `PRAGMA foreign_key_check`: zero rows;
- local finance seed, backup/restore, official promotion, week setup and teaching-load matrix validations: PASS;
- backup/restore preserved the exact application snapshot, restored the oversized row and ended with clean finance invariants and foreign keys;
- `git diff --check`: PASS.

Tests cover role and tenant isolation, explicit system-admin school targeting, signed/canonical QR validation, tamper rejection, active-card uniqueness, revocation, employee lifecycle, active academic year and hire-date boundaries, atomic duplicate rejection, required manual/void reasons, accountant field suppression, linked-teacher self scope, immutable cards/events/audit, daily summary states and the absence of payroll/treasury side effects.

## 6. Immutable Preview acceptance — completed

The automatic immutable Preview for implementation HEAD `608a622726aff18d84f6ec82612f4c62177819cc` was [https://6d808da1.smart-school-staging.pages.dev](https://6d808da1.smart-school-staging.pages.dev). GitHub Quality Gates run [35625848899](https://github.com/smartschoolduhok/smart-school/actions/runs/35625848899) and Cloudflare Pages deployment `6d808da1-7fec-4f45-86bb-a741dc6f1d4c` passed.

Authenticated QA used marker `PH21C-69BC450F98` and school `2` only. It verified:

- management and registrar issuance plus entry/exit scans through the authenticated Preview;
- tampered and revoked QR rejection with zero writes, and atomic duplicate rejection with unchanged event/audit counts;
- mandatory manual-entry, card-revocation and event-void reasons;
- non-destructive voiding, a single immutable audit row and rejection of audit mutation;
- accountant read-only reporting with internal note/manual/void fields suppressed and write routes forbidden;
- the linked teacher seeing only their own active movements, followed by immediate API and UI access loss after link deactivation;
- a real QR SVG, active-card print control and invocation of the print command; the embedded browser does not expose its native print dialog;
- RTL at `390px` with `innerWidth=390`, content width `382`, no horizontal page overflow, zero console errors, zero network failures and zero unexpected HTTP errors during the positive UI pass;
- zero school-2 salary rows, deductions or treasury transactions before and after QA.

## 7. Authorized STAGING gate

The only authorized database was `smart-school-staging-db` (`1bdb9c3d-08d6-4023-9cbc-64369d53198a`). The tracked `wrangler.jsonc` contained exactly that one D1 binding, and Wrangler was authenticated to the Smart School account.

Preflight found `40/40` migrations ending at `0039_student_gate_attendance.sql`, with only `0040_staff_attendance.sql` pending, `73` total tables (`71` application tables under the approved gate convention), and no foreign-key violations. All seven readiness views were captured as historical baselines, including the accepted pre-existing school-1 result-card status `inconsistent` (`22 = 6 draft + 4 published + 12 withdrawn`) and school-3 grade-policy status `partial` (`2/6`).

The full pre-write backup is:

`C:\Users\ibrah\Documents\SmartSchoolBackups\phase21c-staging-20260922T180106Z\smart-school-staging-db-full.sql`

- size: `1,488,533` bytes;
- SHA-256: `F4B1444AF87C1DFFFFCAF2743D47E19BAFC852CF5DC9C662489FAE6123660E8A`.

The backup was restored into an isolated local D1. Schema, columns, SQLite storage types, complete row multisets and values matched exactly. The oversized `import_jobs` row was removed from the bulk SQL path and restored through parameter binding. Applying only `0040` locally produced `41/41`, five new tables, `78` counted tables, clean foreign keys, unchanged readiness and unchanged historical application data. A second remote export immediately before writing was byte-for-byte identical to the backup and had the same SHA-256, proving no drift.

`0040_staff_attendance.sql` was applied once to STAGING from `2026-09-22T18:22:07.3211863Z` to `2026-09-22T18:22:10.3454533Z` (`3.024s`). Postflight proved `41` distinct migration names, `0040` last and present exactly once, no pending migration, exactly five Phase 21C tables, `78` total tables and `76` application tables under the approved gate convention, clean foreign keys and unchanged historical readiness/content.

## 8. Soft cleanup and final protected-data audit

Cleanup used status updates only. The four labelled QA users are inactive, their authentication versions were advanced, the teacher link is inactive, and the labelled employee is archived. The QR card remains revoked; two active attendance events, one voided event and its immutable audit row remain as labelled historical evidence. No business-row `DELETE`, remote seed/reset or destructive cleanup was used.

The final school-1/3 audit compared `58` protected tables and `1,755` rows against the pre-migration backup, including exact SQLite value types and complete row multisets. No difference was found. Evidence is stored outside Git under the backup directory:

- `phase21c-authenticated-qa.json` — SHA-256 `7290EF79E3D2E909E55C2AEB41C2DFB39A47F78B003785958E149784A3A5149C`;
- `schools-1-3-final-comparison.json` — SHA-256 `40DEB4EE506D270395257907CE0D9069BD389432DF36E0857B445C26A3A44FDC`;
- `final-after-qa-cleanup.sql` — SHA-256 `2B0584503FE159A77B4C0F736E92E6AF972A2EEEB840CFE5EBE04C4F4B9299BE`.

## 9. Safety boundary

No Production database or other remote D1 was contacted. No remote seed/reset, destructive cleanup, manual deployment, force-push, merge or auto-merge occurred. PR #51 remains Draft.
