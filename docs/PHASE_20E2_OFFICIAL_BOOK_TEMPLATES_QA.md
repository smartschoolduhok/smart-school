# Phase 20E.2 — Iraqi official-book templates and header

Date: 2026-09-14

Base: `9723a18e1e9e5d9fa7fbd193265713439c86210d` (`main`, merged PR #46)

Branch: `codex/phase-20e2-official-book-templates`

Status: implementation, STAGING migration, CI, Cloudflare Preview and visual acceptance completed; PR #47 was subsequently merged into `main` as commit `36aabc0`.

## 1. Scope

This phase turns the existing free-form official-book feature into a guided, editable school workflow. It does not replace the school's responsibility to review the text against the current instructions of its directorate.

Delivered:

- ten built-in Iraqi school templates without creating duplicate database rows for every school;
- per-book fields for the recipient, purpose, student, employee, committee members, duties, references and copies;
- editable title and body before issuance while preserving the original built-in template;
- structured Arabic and English official header settings;
- optional authorized Republic emblem URL, while retaining the school-logo fallback;
- immutable layout and content snapshots for later reprints;
- one shared A4 document for preview and print, with number, date, signature, stamp, QR and verification token;
- stricter role, tenant, linked-student and linked-employee validation.

## 2. Research basis and limits

Public Iraqi government material confirms that a `كتاب تأييد استمرار في الدوام` is a recurring required school document, and that school-document issuance includes a stated purpose, school record checks, signatures/stamps and education-directorate processing:

- https://ur.gov.iq/index/show-eservice/51528/10034/cat
- https://ur.gov.iq/index/show-eservice/50531/10037/org

The government registration service also refers to school approval, the school card and formal registration/transfer requirements:

- https://ur.gov.iq/index/show-eservice/50533/10034/cat

The built-ins therefore provide editable administrative starting points. They deliberately do not hard-code circular numbers, legal article numbers, fees or deadlines that can differ by stage, directorate or school year. Committee templates expose an editable `reference_basis` field for the current applicable authority.

The system does not bundle or enable the Republic emblem automatically. A school manager must provide an approved HTTPS or internal asset and explicitly enable it.

## 3. Built-in templates

| Category | Templates |
|---|---|
| Student confirmations | Attendance/continuation confirmation; current-status confirmation |
| Acceptance and transfer | No-objection to accept a student; transfer and school-document request |
| Verification | Reply confirming authenticity of a school document |
| Committees | General school committee; examination committee; audit committee; inventory committee |
| Staff | Employee assignment school order |

Every template is A4 and is labelled in the interface as guidance requiring review before issuance.

## 4. Data and security contracts

- A request must identify exactly one built-in preset or one school-owned custom template.
- Student and employee references must be active and belong to the selected school.
- Required fields and remaining `{{placeholders}}` fail closed before any insert.
- Parent accounts cannot list templates or books; read-only teacher access remains unchanged and cannot issue, print-register or cancel.
- Existing custom school templates remain supported, including their extra placeholders.
- Built-in books store `template_id = NULL` plus the preset key and rendered fields inside an immutable version-2 settings snapshot.
- Public QR verification continues to use the existing random token/hash contract and exposes the existing safe verification payload.
- Printed documents omit the internal creator identity and other audit-only fields.

## 5. Header and A4 layout

The configurable hierarchy is:

1. Republic / country;
2. Ministry of Education;
3. General Directorate of Education;
4. Department or division;
5. school name.

Arabic appears on the right, optional English on the left, and the configured emblem or school logo appears in the center. The issue number/date, body, manager signature, optional stamp, QR and verification token share one renderer in both the list preview and dedicated print route.

The A4 contract uses the existing 15 mm print margins and an exact `180 × 267 mm` content area. Header, signature and footer avoid internal page breaks. Long bodies may continue to a later page instead of being clipped.

## 6. Migration

Migration `0036_official_book_layout.sql` adds one nullable JSON column to `school_settings`:

`official_book_layout_settings_json`

It is additive and does not update or delete existing settings, templates or issued books. Older books continue to render from their stored snapshot columns and safe defaults.

The authorized STAGING run targeted only:

- database: `smart-school-staging-db`;
- database ID: `1bdb9c3d-08d6-4023-9cbc-64369d53198a`.

Execution started from the requested branch at the verified initial HEAD `188340090be9df3d9a456988983c12298fb6d09a`.

Before any preflight or migration command, a full schema-and-data export was written outside the repository:

- path: `C:\Users\ibrah\Documents\SmartSchoolBackups\phase20e2-staging-20260914T203319Z\smart-school-staging-db-full-before-0036.sql`;
- size: `1,412,723` bytes;
- SHA-256: `C274A2027308A92A5AED4FC30D1A56690B5E54733ADDFC3FED83C6139D225038`.

Preflight found 36 applied migrations, an empty `foreign_key_check`, and exactly one pending file: `0036_official_book_layout.sql`. The export was then restored into an isolated local D1 directory, including the oversized import row. The rehearsal applied only 0036 and compared all historical columns and values across 62 tables exactly. Local history became 37/37, pending became empty and the foreign-key check stayed empty.

The remote operation then applied only 0036 to STAGING. No seed or reset command was used. Postflight confirmed:

- 37/37 migrations, with 0036 present once and last;
- no pending migrations;
- zero foreign-key violations;
- the only schema change was the nullable `TEXT` column on `school_settings`;
- all pre-existing historical values and readiness results were unchanged.

Two unrelated conditions already present before migration remained unchanged and were not edited: school 3 grade-policy readiness is `partial` (2/6 active classes configured and approved), and school 1 result-card publication readiness is `inconsistent` (21 cards: 5 draft, 4 published, 12 withdrawn).

## 7. Automated evidence

- TypeScript: PASS.
- Focused official-book contract/API/SSR tests: `11/11` PASS.
- Frontend production build: PASS.
- Worker production build: PASS.
- Full test matrix: `1426/1426` PASS, zero failure and zero skip.
- Local D1 migration chain: `37/37` PASS.
- Backup/restore: exact snapshot across `62` application tables; oversized `360,514`-byte bound row restored with matching hash.
- `git diff --check`: PASS.
- GitHub Quality Gates on `71bdeee9351ee7f69794e36df3bc7091e95e7a3d`: PASS (`34896665777`, validate job `104152370888`).
- Cloudflare Pages on the same SHA: PASS (`f84ec108-5b5f-4812-8198-4cdcb26f5d9e`, check `104152595036`, HTTP 200).

No Production target, remote seed/reset, manual deployment, force-push, merge or auto-merge was used.

## 8. STAGING and Preview acceptance

The user-specified Preview `https://901e96d8.smart-school-staging.pages.dev` was used first with school 2 (`مدرسة Staging الثانية`) and active QA student 27 (`QA-PROMO-001`). D1 and API duplicate checks both returned zero before issuance. Exactly two records were created and no custom template row was added:

- ID 1: `تأييد طالب QA — PH20E2-QA-20260914`;
- ID 2: `تشكيل لجنة امتحانية QA — PH20E2-QA-20260914`.

The visual pass confirmed the Arabic/English header hierarchy, edited title and body, A4 number/date block, manager signature, synthetic `QA STAMP`, QR, verification note and footer. The Republic emblem remained disabled with an empty URL; no unofficial emblem asset was used.

The original Preview exposed a real regression: the public page interpreted Unix seconds as milliseconds and displayed `21/1/1970`. Commit `037b4f42d933180946c9bb37cc5fd56fca084c27` introduced the shared seconds-safe date formatter and regression coverage. A second real defect appeared during browser PDF measurement: the committee footer overflowed by 12.12 px into a second page. Commit `71bdeee9351ee7f69794e36df3bc7091e95e7a3d` added a print-only 1 mm footer margin and a regression assertion without shrinking the body font or clipping content.

Final browser acceptance ran on `https://f84ec108.smart-school-staging.pages.dev` at `71bdeee9351ee7f69794e36df3bc7091e95e7a3d`:

- both generated PDFs were one page each;
- each MediaBox was `594.95996 × 841.91998 pt`, the A4 page size;
- the footer bottom was `1009.125 px` inside the `1009.134 px` printable height;
- each captured QR matrix exactly matched its final public verification URL;
- both public pages returned valid active records and the correct 2026 date;
- the public API exposed only the allowlisted verification fields and no creator, user, hash or password field;
- six private parent requests (list templates, list books, read, create, cancel and register print) each returned 403.

After visual acceptance, the temporary owner and parent credentials/status, school profile and document settings were restored byte-for-byte to the backup baseline. The temporary browser session was rejected and redirected to login. The two authorized QA books remained active, the total book count moved from 0 to 2, migrations remained 37/37 with no pending entry, and `foreign_key_check` remained empty.

Evidence files are outside the repository in `C:\Users\ibrah\Documents\SmartSchoolBackups\phase20e2-staging-20260914T203319Z`, including preflight, local rehearsal, post-migration, Preview QA, final-state and remote-apply logs.

This local result is not authorization for a production release or merge.
