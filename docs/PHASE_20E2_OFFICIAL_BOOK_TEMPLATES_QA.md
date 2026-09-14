# Phase 20E.2 — Iraqi official-book templates and header

Date: 2026-09-14

Base: `9723a18e1e9e5d9fa7fbd193265713439c86210d` (`main`, merged PR #46)

Branch: `codex/phase-20e2-official-book-templates`

Status: implementation and local validation are complete; Draft PR CI, Preview and visual acceptance are pending.

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

## 7. Automated evidence

- TypeScript: PASS.
- Focused official-book contract/API/SSR tests: `11/11` PASS.
- Frontend production build: PASS.
- Worker production build: PASS.
- Full test matrix: `1426/1426` PASS, zero failure and zero skip.
- Local D1 migration chain: `37/37` PASS.
- Backup/restore: exact snapshot across `62` application tables; oversized `360,009`-byte row restored with matching hash.
- `git diff --check`: PASS.

No Production, Remote D1, manual deployment, force-push, merge or auto-merge was used.

## 8. Preview acceptance still required

After the Draft PR creates a public Cloudflare Preview on the exact head SHA:

1. configure the bilingual Nineveh header on a QA school;
2. keep the Republic emblem disabled unless an approved school asset is available;
3. issue one student confirmation and one committee order from QA-only data;
4. confirm field substitution, edited title/body and frozen snapshot values;
5. print each at A4 and confirm header, body, signature, stamp, QR and footer are not clipped;
6. open the QR verification page and confirm it contains no internal creator metadata;
7. confirm a parent receives 403 for the private template/book routes;
8. confirm CI and Cloudflare Preview use the same PR head SHA.

This local result is not authorization for a production release or merge.
