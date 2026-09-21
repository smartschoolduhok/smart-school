# Phase 21B — Student school-gate attendance

Date: 2026-09-21

Base: `deb5125` (`main`, merged PR #49)

Branch: `codex/phase-21b-gate-attendance`

Status: STAGING backup, isolated restore, migration, authenticated Preview QA, defect repair, soft cleanup and automatic Quality Gates/Cloudflare Preview verification complete. PR #50 remains Draft.

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

## 5. STAGING identity and read-only preflight

The only configured and contacted database was:

- name: `smart-school-staging-db`;
- UUID: `1bdb9c3d-08d6-4023-9cbc-64369d53198a`;
- Pages project/config: `smart-school-staging` with exactly one D1 binding.

The expected branch head `43842f18ca33a9f9b9621f931378e48bac81c167`, remote branch and Draft PR #50 all matched before any remote write.

The strict read-only preflight passed:

- applied migration history: `39`, ending at `0038_lesson_attendance.sql`;
- pending list: only `0039_student_gate_attendance.sql`;
- counted tables before migration: `66` (including `d1_migrations` and `sqlite_sequence`);
- `PRAGMA foreign_key_check`: zero rows;
- full typed STAGING snapshot hash: `057aa7f2db7925f7289cc081cfe21d59ea2ee52fc382e27e0d0fa4595cb2a79c`.

All seven readiness views were recorded. Their baselines were:

- `academic_grade_policy_readiness`: schools 1 and 2 `not_configured`; the accepted historical school-3 exception remained exactly `partial`, `2` configured and approved classes out of `6`, with zero pending drafts;
- `finance_fee_readiness`: all three returned rows healthy;
- `finance_payroll_readiness`: zero rows, unchanged;
- `finance_payroll_school_readiness`: schools 1, 2 and 3 healthy;
- `finance_treasury_readiness`: schools 1, 2 and 3 healthy;
- `result_card_publication_readiness`: school 1 retained the accepted historical `inconsistent` exception with exactly `22` cards (`6` draft, `4` published, `12` withdrawn); school 2 was healthy with zero cards and school 3 healthy with two published cards;
- `student_promotion_result_readiness`: school 1 healthy with three decisions and zero inconsistent decisions; schools 2 and 3 healthy with zero decisions.

## 6. Backup and isolated restore rehearsal

The full export is outside Git at:

`C:\Users\ibrah\Documents\SmartSchoolBackups\phase21b-staging-20260921T053243Z\smart-school-staging-db-full.sql`

- size: `1,461,706` bytes;
- SHA-256: `F546C349E52041330621F85501034B2883FCEB4CCA162FBE1323B20EA3BCFD0A`.

It was restored into an isolated local D1 under the same backup directory. Typed schema, values, SQLite storage types, row counts and complete row multisets matched the read-only STAGING snapshot exactly. The oversized `import_jobs` row was removed from the bulk SQL path and restored with parameter binding: `16` parameters and `360,514` bound bytes.

Applying only `0039_student_gate_attendance.sql` to that isolated restore produced:

- `40/40` migration rows and no pending migration;
- `73` counted tables;
- zero foreign-key violations;
- no change to any historical column, type, value or row;
- readiness identical to the preflight baseline.

## 7. Authorized STAGING migration

The database identity, 39-row history, sole pending migration, foreign keys and every readiness view were rechecked in the same operation immediately before migration application. Only `0039_student_gate_attendance.sql` was then applied to the authorized STAGING database.

Postflight passed with `40` migration rows, no pending migration, `73` tables, clean foreign keys, unchanged historical content/readiness, and snapshot hash `871e820a55d4e5868c396e2f0616788ca11c1d0ccd2f6397b900d7a6e53f833c`.

## 8. Labelled school-2 fixtures and authenticated QA

Marker: `PH21B-9A83808FCE`. All fixtures belong to school 2 only:

- registrar user `45` and parent user `46`;
- student `71`, active enrollment `76`, active parent link `11`;
- signed QR card `1`;
- entry event `1` and exit event `2`;
- immutable void-audit row `1`.

Runtime checks passed:

- the QR value had the canonical `SSG1.<random UUID>.<HMAC-SHA-256>` form, disclosed neither the student number nor identity, successfully created the entry event, and a one-character signature change failed with `409 invalid_gate_card` and zero writes;
- the entry was recorded at Baghdad `08:46` as `late` by 46 minutes; the exit was recorded as `early_exit`; both used the correct Baghdad calendar date;
- a repeated entry scan failed with `409 gate_scan_duplicate`; event, notification, recipient and audit counts were byte-for-byte unchanged after rejection;
- exactly two active movements, two notifications and two recipient rows existed before voiding; both recipient rows targeted only linked parent user `46`;
- the parent API and real UI showed both movements and both notifications while excluding the manual reason, internal note, actor IDs, void fields and audit metadata;
- revoking card `1` with a documented reason made its QR fail with `409 invalid_gate_card` without partial writes;
- exit event `2` was voided with a documented reason; its notification was withdrawn; a second void attempt failed with `409`; audit row `1` rejected both update and delete attempts and remained unchanged.

## 9. 390 px, RTL, printing and runtime diagnostics

The immutable Preview for head `43842f1` was `https://b066066e.smart-school-staging.pages.dev`.

- registrar and parent pages reported `innerWidth = clientWidth = scrollWidth = body.scrollWidth = 390`, so there was no horizontal page expansion;
- the document and computed body direction were both `rtl`;
- the active card rendered a real QR SVG and its print control invoked `window.print()`;
- the parent attendance screen visibly showed the late entry and early exit, and the notification inbox showed exactly two matching notifications;
- both sessions had zero application console errors, zero `Network.loadingFailed` events and zero HTTP responses at or above 400 during the UI pass.

The pass found one real defect: if another session revoked the currently previewed card, Refresh updated the card list but left the old active-card preview and print button visible. The UI now reconciles the selected preview against every refreshed card response; a missing card clears the preview and a returned revoked card replaces it. A dedicated regression test covers both cases.

The repair was committed as `9604ad2c8e89de4cf65a86be4483910e8de63cf2`. Its immutable automatic Preview, `https://7d49c01a.smart-school-staging.pages.dev`, passed the repeated 390 px/RTL check. The revoked card showed its explicit invalid-for-scan-or-print message and QR, but the print-button count was exactly zero both before and after Refresh. Console errors, network loading failures and HTTP responses at or above 400 all remained zero.

Focused gate tests passed `13/13`; the complete regression matrix passed `1564/1564`, with zero failure and zero skip. TypeScript, local finance/week-setup/teaching-load/seed/backup-restore validations and both production builds passed. Automatic GitHub Quality Gates run `35567281680` passed, including locked install and `npm audit --audit-level=low`; the automatic Cloudflare Pages deployment also passed. No dependency file changed.

## 10. Soft cleanup and final invariants

Cleanup used status updates only; no `DELETE` statement was issued:

- registrar user `45` and parent user `46` are `inactive`; both `auth_version` values advanced from `1` to `2`;
- both previously issued bearer sessions returned `401`, and new password login attempts for both inactive accounts returned `401`;
- parent link `11` is `inactive`;
- enrollment `76` is `cancelled`;
- student `71` is `archived`;
- the revoked QR card, two gate movements and immutable audit row remain as historical evidence.

A typed protected-school comparison covered every pre-existing table with `school_id` plus the `schools` rows themselves. Every school-1 and school-3 value, type and row remained identical to the preflight snapshot. All seven readiness views remained identical, including only the two accepted historical exceptions: school 3 grade policy `partial` at `2/6`, and school 1 result-card publication `inconsistent` at `22 = 6 draft + 4 published + 12 withdrawn`. Final migration history was `40`, Wrangler reported no pending migration, and `PRAGMA foreign_key_check` returned zero rows.

## 11. Safety boundary

No Production database or other remote D1 was contacted. No remote seed/reset, manual deployment, force-push, merge or auto-merge was used. The only remote schema write was the explicitly authorized `0039` migration on the exact STAGING UUID; fixture writes were limited to labelled school-2 QA records. PR #50 remains Draft.
