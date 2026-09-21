# Phase 20E.1 — Result Card design and grade-detail customization

Date: 2026-09-14

Base: `ae69565` (`main`, merged PR #45)

Branch: `codex/phase-20e-result-card-customization`

Status: completed and merged into `main` through PR #46 as commit `9723a18` after its review gates.

## 1. Scope

This phase changes Result Card presentation, staff printing, QR verification and parent-delivery wording. It deliberately does not modify grade calculations, annual policy decisions, parent authorization, official books or the timetable.

Delivered requests:

- a cleaner modern official Result Card design;
- selectable annual, term, monthly or custom grade detail;
- school-managed multiline text above the card design;
- print and mobile safeguards for wider monthly tables;
- clearly separate student printing from delivery to the linked parent account;
- checkbox selection and one-action printing for multiple cards;
- automatic removal of unused decision columns and low-value header labels;
- immutable compatibility for already-issued cards.

Official-book header customization and timetable drag-and-drop remain separate follow-up phases and are not mixed into this branch.

## 2. Grade-detail modes

The school selects the mode in **Settings → Document and print settings → Result Card content**.

| Mode | Card columns |
|---|---|
| Annual summary | Compact annual/policy result and decision columns |
| Term details | First-term effort, mid-year exam, second-term effort and annual decision |
| Monthly details | Available month fields, mid-year exam and annual decision |
| Custom columns | Existing individual display switches chosen by the school |

Term and monthly modes follow the active grade scheme:

- a monthly term shows its month fields;
- a direct-entry term shows the direct term grade instead;
- a disabled term is omitted;
- terminal and non-terminal policy outcomes remain authoritative;
- decision points and adjusted grades never rewrite raw marks;
- the decision-points and adjusted-grade columns appear only when at least one subject actually used decision points, including when an older saved card is displayed or reprinted.

The selected columns and their averages are frozen into each new snapshot. Changing the setting later does not rewrite an issued card.

## 3. Design and school text

- New snapshots use `schema_version: 7` and `design_version: modern_official_v1`.
- The revised modern design uses a print-reliable white official header with navy/gold rules, stronger result emphasis, bilingual labels, a lighter responsive table and a compact signature/stamp/QR footer.
- The school may enter multiline text above the card, for example `جمهورية العراق` and `وزارة التربية`.
- The text is limited to `500` characters in both UI and API and is frozen into the issued snapshot.
- Existing schema v6 and older snapshots retain the classic renderer and their original saved text/columns.
- The generic `سجل دراسي / Academic record` badge is no longer shown on Result Cards, including the classic renderer; saved academic data and columns remain unchanged.
- `الدور الأول` is omitted from the header; a non-default round such as `الدور الثاني` remains visible when enabled.
- The published parent payload remains the existing restricted safe summary; this phase does not widen parent-visible raw data.

## 4. Issue, print, QR and parent-delivery workflow

- Issuing a card creates an active, student-ready card; the internal `draft` value now means only “not sent to the parent account”.
- Staff with print permission can print an active card before or after parent delivery.
- Every issued active card prints with its QR and verification token; public verification is safe-summary-only and works before parent delivery.
- The yellow unpublished warning and QR placeholder are removed from the student copy.
- The separate `إرسال لولي الأمر` action is the only step that exposes the snapshot in the linked parent account. Before it, that account receives an empty result list.
- The card list exposes labelled `طباعة` and `إرسال لولي الأمر` actions instead of ambiguous publication wording.
- Staff can select any mix of active unsent/sent cards and open one batch print view; every card occupies its own A4 page.
- Cancelled and withdrawn cards cannot enter single or batch printing.

## 5. Responsive and print contracts

- Wide term/monthly tables scroll inside the card at narrow widths instead of extending the whole page.
- Table density changes deterministically at 9 and 12 columns.
- A4 print removes screen-only shadow/radius, forces the table into the printable width and retains the existing single-page fit measurement.
- The card itself fills the complete `180 x 267mm` printable A4 area when its content is short, with the footer anchored at the bottom; longer or wider cards are scaled down inside the same fixed area.
- Print colors use the existing exact-color contract and rows avoid page breaks.
- Batch printing enforces a page break after every card except the last.

## 6. Database and environment scope

- No migration was added or edited.
- The repository remains at `36` migrations through `0035_official_result_promotion.sql`.
- No Production or Remote D1 access is required.
- No existing Result Card row or STAGING QA record is rewritten by the code change.

## 7. Automated evidence

### Targeted checks

- Result Card logic/contracts/print: `75/75`.
- Rendered Result Card DOM (v6 terminal, v6 non-terminal, v7 monthly, decision/round visibility, v6 compatibility): `5/5`.
- UI foundations, including actual mode selection, multiline typing, focus stability and saved payload: `11/11`.
- Grade-policy engine/API/migration/UI: `20/20`.
- Result delivery/QR/parent isolation: `6/6`.
- Published academic analytics: `3/3`.
- Settings authorization: `5/5`.
- TypeScript typecheck: PASS.
- Frontend and Worker production builds: PASS.
- `npm audit --audit-level=low`: `0 vulnerabilities`.
- `git diff --check`: PASS.

### Full regression matrix

- Suites: `28`.
- Test executions: `1516`.
- Pass: `1516`.
- Fail: `0`.
- Skip: `0`.

The total includes the repository's intentional overlapping Result Card, settings and subject-order suites.

### Genuine Local D1 and restore

- Finance: `36` migrations and `39` scenario checks; expected blockers rolled back atomically.
- Week setup: fresh `36`-migration chain, foreign keys clean and production batch builders verified.
- Teaching-load matrix: fresh `36`-migration chain, populated upgrade preservation and set-based D1 cases passed.
- Finance seed: invariants, business dates, payroll readiness and foreign keys healthy.
- Backup/restore: exact application snapshot across `62` tables; oversized `360,009`-byte row restored with matching hash.
- Official promotion: `36` migrations and `12` checks; promoted/repeated/graduated actions and pinned publication revisions healthy.

## 8. Visual acceptance still required on Preview

The real React renderer is covered by DOM tests, but the cloud browser cannot open the workspace-only localhost server (`ERR_BLOCKED_BY_CLIENT`). After the Draft PR produces a Cloudflare branch Preview, complete these gates on the exact head SHA:

1. Save each grade-detail mode and verify a newly calculated preview uses the expected columns.
2. Confirm the custom multiline school text is above the modern card header.
3. Inspect terminal and non-terminal cards at desktop width.
4. Inspect `390px`: horizontal movement remains inside the table and the page itself does not widen.
5. Print annual, term and monthly examples to A4; each card must remain one page with no clipped table or footer.
6. Open an old v6 card and confirm its classic layout is unchanged.
7. Print one active card not yet sent to the parent: confirm there is no draft warning and the QR/token are present and valid.
8. Select at least two cards and confirm each occupies exactly one A4 page in batch print.
9. Confirm `سجل دراسي` and the first-round badge are absent from a modern card, while a second-round card keeps its round.
10. Before parent delivery, confirm the linked parent sees no card while the printed QR verifies; after delivery, confirm only that linked account sees it.
11. Confirm CI and Cloudflare Preview run on the same PR head SHA.

No merge or production release is implied by these local results.
