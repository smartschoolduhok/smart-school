# Phase 21C — Employee and teacher attendance

Date: 2026-09-21

Base: `719b9c8` (`main`, merged PR #50)

Branch: `codex/phase-21c-staff-attendance`

Status: implementation and local quality gates are complete. Remote branch, Draft PR, immutable Preview acceptance and migration `0040` on STAGING remain pending. No remote database or Production environment was contacted.

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
- counted fresh local tables: `79`;
- fresh local `PRAGMA foreign_key_check`: zero rows;
- local finance seed, backup/restore, official promotion, week setup and teaching-load matrix validations: PASS;
- backup/restore preserved the exact application snapshot, restored the oversized row and ended with clean finance invariants and foreign keys;
- `git diff --check`: PASS.

Tests cover role and tenant isolation, explicit system-admin school targeting, signed/canonical QR validation, tamper rejection, active-card uniqueness, revocation, employee lifecycle, active academic year and hire-date boundaries, atomic duplicate rejection, required manual/void reasons, accountant field suppression, linked-teacher self scope, immutable cards/events/audit, daily summary states and the absence of payroll/treasury side effects.

## 6. Manual Preview acceptance still required

After the remote branch and automatic immutable Preview exist, acceptance must verify at minimum:

- management/registrar USB scan and camera fallback for entry and exit;
- tampered and revoked QR rejection with zero writes;
- duplicate scan rejection with unchanged event counts;
- required reasons for manual entry, card revocation and event void;
- accountant read-only report without internal fields;
- linked teacher personal feed and immediate access loss after link deactivation;
- active card printing and disappearance of printable controls after revocation/refresh;
- 390 px width, RTL direction, keyboard use, console/network diagnostics and print layout.

## 7. STAGING gate and safety boundary

Migration `0040` has not been applied remotely. The next database step requires a separate explicit authorization and must start with read-only identity/history/pending/FK/readiness checks, a verified full STAGING backup and an isolated restore rehearsal. Only then may `0040_staff_attendance.sql` be applied to the exact authorized STAGING database, followed by authenticated labelled-fixture QA, soft cleanup and a final protected-data comparison.

No Production access, remote seed/reset, destructive cleanup, manual deployment, merge, auto-merge or force-push is authorized by this document.
