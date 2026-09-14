# Phase 20E.1 — Result Card design and grade-detail customization

Date: 2026-09-14

Base: `ae69565` (`main`, merged PR #45)

Branch: `codex/phase-20e-result-card-customization`

Status: local implementation and validation complete; Draft PR, CI, Preview and visual acceptance pending.

## 1. Scope

This phase changes the Result Card presentation only. It deliberately does not modify grade calculations, annual policy decisions, publication, parent authorization, official books or the timetable.

Delivered requests:

- a cleaner modern official Result Card design;
- selectable annual, term, monthly or custom grade detail;
- school-managed multiline text above the card design;
- print and mobile safeguards for wider monthly tables;
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
- decision points and adjusted grades never rewrite raw marks.

The selected columns and their averages are frozen into each new snapshot. Changing the setting later does not rewrite an issued card.

## 3. Design and school text

- New snapshots use `schema_version: 7` and `design_version: modern_official_v1`.
- The modern design uses a clear official header, stronger result emphasis, bilingual labels, a denser responsive table and a balanced signature/stamp/QR footer.
- The school may enter multiline text above the card, for example `جمهورية العراق` and `وزارة التربية`.
- The text is limited to `500` characters in both UI and API and is frozen into the issued snapshot.
- Existing schema v6 and older snapshots retain the classic renderer and their original saved text/columns.
- The published parent payload remains the existing restricted safe summary; this phase does not widen parent-visible raw data.

## 4. Responsive and print contracts

- Wide term/monthly tables scroll inside the card at narrow widths instead of extending the whole page.
- Table density changes deterministically at 9 and 12 columns.
- A4 print removes screen-only shadow/radius, forces the table into the printable width and retains the existing single-page fit measurement.
- Print colors use the existing exact-color contract and rows avoid page breaks.

## 5. Database and environment scope

- No migration was added or edited.
- The repository remains at `36` migrations through `0035_official_result_promotion.sql`.
- No Production or Remote D1 access is required.
- No existing Result Card row or STAGING QA record is rewritten by the code change.

## 6. Automated evidence

### Targeted checks

- Result Card logic/contracts/print: `73/73`.
- Rendered Result Card DOM (v6 terminal, v6 non-terminal, v7 monthly, v6 compatibility): `4/4`.
- UI foundations, including actual mode selection, multiline typing, focus stability and saved payload: `11/11`.
- Grade-policy engine/API/migration/UI: `20/20`.
- Result publication: `6/6`.
- Published academic analytics: `3/3`.
- Settings authorization: `5/5`.
- TypeScript typecheck: PASS.
- Frontend and Worker production builds: PASS.
- `npm audit --audit-level=low`: `0 vulnerabilities`.
- `git diff --check`: PASS.

### Full regression matrix

- Suites: `28`.
- Test executions: `1511`.
- Pass: `1511`.
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

## 7. Visual acceptance still required on Preview

The real React renderer is covered by DOM tests, but the cloud browser cannot open the workspace-only localhost server (`ERR_BLOCKED_BY_CLIENT`). After the Draft PR produces a Cloudflare branch Preview, complete these gates on the exact head SHA:

1. Save each grade-detail mode and verify a newly calculated preview uses the expected columns.
2. Confirm the custom multiline school text is above the modern card header.
3. Inspect terminal and non-terminal cards at desktop width.
4. Inspect `390px`: horizontal movement remains inside the table and the page itself does not widen.
5. Print annual, term and monthly examples to A4; each card must remain one page with no clipped table or footer.
6. Open an old v6 card and confirm its classic layout is unchanged.
7. Confirm CI and Cloudflare Preview run on the same PR head SHA.

No merge or production release is implied by these local results.
