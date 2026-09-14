# Phase 20D.3 — Result Card v6 and official academic analytics QA

Date: 2026-09-13
Base: `333df1b8845772a643bd35e4f5611f0cab79bfbf` (`main`, merged PR #44)
Branch: `codex/phase-20d3-result-cards-analytics`
Status: local implementation and validation complete; PR/Preview/STAGING acceptance pending.

## 1. Goal

This phase improves how already-verified annual academic decisions are presented. It does not introduce another grade formula and does not hard-code one ministry year.

The same versioned annual policy engine remains the only source for:

- pass, supplementary/completion, fail and incomplete;
- general and individual exemption for non-terminal grades;
- ministerial-entry eligibility for terminal grades;
- annual decision-point allocation without rewriting raw marks;
- official promotion, repetition or graduation after publication.

## 2. Delivered behavior

### Result Card schema v6

- New cards use `schema_version: 6`; stored older cards keep their immutable saved columns and remain printable.
- Terminal cards use a compact decision table: subject, policy source grade, decision points, adjusted grade and subject status.
- Non-terminal cards show the relevant configured effort/exam columns plus decision points, adjusted grade, subject status and optional exemption detail.
- Arabic/English headings are shown without changing the RTL document direction.
- The school English name, student photo, exam round, signatures, stamp area, QR verification, card number and issue date are supported.
- The prominent result is the academic decision (`ناجح / مكمل / راسب`) rather than the technical completeness flag.
- Completion, failure and exemption subject names are printed explicitly.
- Decision points used and the ministerial-entry basis are printed when applicable.

### Parent result view

The parent still receives only a published immutable card belonging to an actively linked child. The safe payload now also includes:

- the exemption state per subject;
- decision points used;
- ministerial-entry code and explanation;
- names of completion, failed and exempt subjects.

Internal audit identity, raw decision records, verification hashes and subject database IDs remain hidden.

### Official academic analytics

The management-only `النتائج الرسمية` view now separates two sources:

1. **Official published results** — frozen Result Card snapshots, selected by default.
2. **Current calculated preview** — live grades and the currently approved policy, clearly marked as changeable before publication.

The official view includes separate counts and filters for:

- pass, completion, fail and incomplete;
- general exemption and individual exemption;
- comprehensive ministerial entry, eligible, not eligible and pending;
- promoted, repeated, graduated and awaiting an annual transition decision.

Student rows show result, exemption, ministerial decision, completion/failure subject names, decision points, card/policy version and annual transition. Completion and incomplete results are not mislabeled as awaiting promotion because they cannot finalize enrollment yet.

## 3. Compatibility and database scope

- No migration was added or changed.
- Migrations remain `36`, ending at `0035_official_result_promotion.sql`.
- Migrations `0029`–`0035` are byte-for-byte untouched by this phase.
- Existing Result Card snapshots are not rewritten.
- The existing top-level fields of `/api/academic-outcomes/summary` remain available for compatibility; the response adds explicit `live` and `published` objects.
- Published analytics are tenant-, academic-year-, class- and section-scoped.
- Withdrawn/cancelled cards are excluded. The newest active published card per student/year is used.
- Malformed legacy snapshots fail closed as incomplete/not-applicable instead of inventing a result.

## 4. Verified academic scenarios

The policy and API suites revalidated the full decision family:

| Scenario | Expected and verified result |
|---|---|
| Terminal marks `44, 35, 29, 46`, ten decision points | Stable allocation `6, 0, 0, 4`; two subjects rescued; student remains completion and becomes ministerial-entry eligible |
| Terminal comprehensive entry | Entry is comprehensive without rewriting marks or changing the academic pass/fail decision |
| Terminal grade exemption attempt | General and individual exemption are never granted |
| Non-terminal general exemption | Applied only when all configured annual conditions are met |
| Non-terminal individual exemption | Applied by subject; remaining subjects still follow pass/completion/fail rules |
| Non-terminal ordinary result | Every required subject must pass for the student to pass |
| Incomplete inputs | Result and ministerial entry stay pending/incomplete; no guessed outcome |
| Published snapshot | Analytics use the frozen card even if later live inputs or policy drafts differ |
| Annual transition | Only published complete pass/fail results can produce promoted/repeated/graduated; completion/incomplete remains open |

## 5. Automated evidence

### Targeted checks

- Grade-policy engine/API/migration/UI: `18/18`.
- Result Card unit/contract/print tests: `70/70`.
- Result Card v6 rendered DOM tests (terminal and non-terminal): `2/2`.
- Published academic analytics tests: `3/3`.
- Result publication tests: `6/6`.
- Official promotion tests: `16/16`.
- TypeScript typecheck: PASS.
- Frontend build: PASS.
- Worker build: PASS.
- `git diff --check`: PASS.
- `npm audit --audit-level=low`: `0 vulnerabilities`.

### Full regression matrix

- Suites: `28`.
- Test executions: `1500`.
- Pass: `1500`.
- Fail: `0`.
- Skip: `0`.

The execution total contains the repository's intentional overlapping suites for Result Card, settings permissions and subject order; it is an execution count, not a distinct-test claim.

### Genuine Local D1 and restore

- Official promotion local validation: `36` migrations and `12` checks; FK clean and readiness healthy.
- Finance Local D1 validation: `36` migrations and `39` scenario checks; expected blockers rolled back atomically.
- Backup/restore validation: exact application snapshot across `62` tables.
- Oversized `import_jobs` row restored through parameter binding: `360,009` bytes with matching hash.
- Finance invariants, business dates, payroll readiness and FK verification remained healthy.

## 6. Visual-validation boundary

The generated terminal and non-terminal documents were rendered through the real React component and checked for their bilingual headings, compact columns, photo, result/exemption subject lists, ministerial explanation, QR and official footer. Existing print-layout tests also revalidated the single A4 content box and overflow-fitting contract.

The cloud browser could not open the workspace-only localhost server (`ERR_BLOCKED_BY_CLIENT`), so no claim is made here for a human visual inspection of a deployed Preview. The PR Preview must be opened after push for the final wide-screen, 390px and print-preview smoke test.

## 7. Environment and safety record

- Production was not accessed.
- No Remote D1 command ran.
- No STAGING data was read or changed.
- No remote seed/reset, deployment, force-push, destructive cleanup or automatic merge occurred.
- No migration was added, applied or edited.

## 8. Remaining acceptance gates

1. Push the branch and open a review PR.
2. Confirm GitHub Quality Gates and Cloudflare Branch Preview on the exact HEAD.
3. Perform authenticated Preview smoke testing for:
   - terminal card with ministerial entry and decision points;
   - non-terminal card with individual/general exemption;
   - official published analytics and the live-preview toggle;
   - parent published result view;
   - print preview at desktop width and responsive management analytics at 390px.
4. Because this phase contains no migration, a STAGING database migration/backup gate is not required. No production release is implied.
