# Phase 21B — Student school-gate attendance

Date: 2026-09-20

Base: `deb5125` (`main`, merged PR #49)

Branch: `codex/phase-21b-gate-attendance`

Status: local implementation and automated validation complete. STAGING backup/migration and authenticated Preview QA remain pending.

## 1. Scope

This phase adds a separate school-gate attendance boundary alongside the per-lesson attendance delivered in Phase 21A.

Delivered behavior:

- management and registrars can issue a signed QR card for an actively enrolled student;
- the scanner accepts a USB/keyboard reader and progressively uses the browser camera when `BarcodeDetector` is supported;
- each scan records entry or exit, the Baghdad date/time, gate label, current annual placement snapshots and on-time/late/normal/early-exit classification;
- a configurable atomic deduplication window rejects repeated scans without partial event or notification writes;
- a revoked card fails closed, and a replacement can be issued without rewriting historical movements;
- exceptional manual recording is limited to the previous 30 days and requires an operational reason; its optional note remains staff-only;
- recorded movements are immutable. A wrong movement is voided non-destructively with a mandatory reason and immutable audit row;
- only the currently linked parent can see the child's active gate movements and receive/read the corresponding notification;
- parent responses never expose manual reasons, internal notes, void reasons, actor IDs or audit metadata;
- the parent attendance screen combines confirmed lesson attendance with gate entry/exit in distinct sections;
- the application header now presents a real per-user notification inbox and unread count;
- the Arabic RTL management interface supports 390 px layouts and printable QR cards.

## 2. Security and data integrity

Migration `0039_student_gate_attendance.sql` introduces gate settings, signed card identities, immutable movement snapshots, void audit history and generic resource-scoped notifications.

The QR payload contains only a random public UUID and an HMAC-SHA-256 signature. It does not expose a student identifier and no reusable signature is stored in D1. The API verifies the signature, active card, school, active student and active-year enrollment on every scan.

Role and tenant checks are repeated in the API and database triggers. Teachers, accountants and parents cannot operate the gate endpoints. System administrators must explicitly select a school. Manual timestamps are interpreted in `Asia/Baghdad`, independent of the operator device timezone.

Event writes and parent notifications share one D1 batch. Database triggers enforce student/enrollment snapshots, actor school, active card use and the configured duplicate window. Card/event deletion, card reactivation, event reactivation and audit mutation are rejected. Notification reads recheck the current active parent-student link, so revoking that link immediately hides old linked-child notifications as well as the movement feed.

## 3. Routes

- `GET|PUT /api/gate-attendance/settings`
- `GET|POST /api/gate-attendance/cards`
- `POST /api/gate-attendance/cards/:id/revoke`
- `POST /api/gate-attendance/scan`
- `POST /api/gate-attendance/manual`
- `GET /api/gate-attendance/events`
- `POST /api/gate-attendance/events/:id/void`
- `GET /api/gate-attendance/parent`
- `GET /api/notifications`
- `POST /api/notifications/:key/read`
- management UI: `/gate-attendance`
- parent gate feed: `/attendance`

## 4. Local automated evidence

- focused lesson/gate attendance API and UI suite: `28/28` PASS;
- full regression matrix: `1563/1563` PASS, zero failure and zero skip;
- TypeScript: PASS;
- frontend and Worker production builds: PASS;
- `npm audit --audit-level=low`: zero vulnerabilities;
- fresh local D1 chain: `40` migrations;
- local finance D1 validation: `39` checks PASS;
- local week-setup and teaching-load D1 validations: PASS;
- local backup/restore: exact snapshot across `73` tables, foreign keys clean, and the `360,009`-byte oversized row restored;
- `git diff --check`: PASS.

The gate tests cover management-only operation, system-admin target selection, cross-tenant rejection, signed/canonical QR validation, revocation, active-card uniqueness, atomic duplicate rollback, linked-parent-only delivery, link-revocation hiding, notification read ownership, private internal notes, mandatory manual/void reasons, manual time limits, audited non-destructive voiding and immutable audit/event/card history.

## 5. Required STAGING gate

No remote database has been contacted for this phase. Before applying migration `0039` to STAGING:

1. verify the exact STAGING binding and migration history;
2. export a complete backup and record its byte size and SHA-256;
3. restore that export locally and prove a typed table-by-table match;
4. apply only `0039_student_gate_attendance.sql` to the isolated restore and verify migration count, pending list and foreign keys;
5. repeat the remote identity/readiness check, then apply only `0039` to the named STAGING database after explicit approval;
6. create labelled school-2 QA fixtures only: one active student/enrollment, one linked parent, one card and entry/exit movements;
7. verify USB input, camera fallback, duplicate rejection, revocation/reissue, manual reason, void audit, parent notification/feed isolation, 390 px layout and card printing;
8. disable temporary accounts, invalidate sessions and archive fixtures without deleting the movement/audit evidence;
9. prove protected schools and readiness baselines remain unchanged.

## 6. Safety boundary

Local D1 only so far. No STAGING or Production database was contacted, no remote migration, seed/reset or manual deployment was run, and no force-push, merge or auto-merge was performed.
