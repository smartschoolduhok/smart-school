# Flexible timetable review record

Tested implementation: [`eb7c1fbd08402cc3ddc7a0e3ffb886c007d3dbee`](https://github.com/smartschoolduhok/smart-school/commit/eb7c1fbd08402cc3ddc7a0e3ffb886c007d3dbee).

## Implemented behavior

- Each weekday has independent lesson counts and bell periods, including a 7/7/6/6/5 week. Selected-day templates configure empty days; individual day profiles can increase or reduce active periods while retaining saved identities. Occupied or locked periods cannot be silently removed from the active week.
- Manual schedules can be pinned or explicitly unpinned by section, class, or stage. Automatic generation always preserves official locks.
- Generation can complete one stage, class, or section. Existing entries outside that scope remain unchanged, including row IDs, timestamps, positions, and lock states. Their occupancy still participates in teacher and section conflict checks; their original weekly demand remains unchanged.
- A complete selected scope can be adopted while the school's overall schedule remains incomplete. Global readiness continues to report remaining school demand.
- Printing supports A4/A3 landscape and separate groups for stages, classes, or sections, plus individual section and teacher views.

## Corrections verified during independent review

| Finding | Correction and checked behavior |
|---|---|
| `classes.stage` changes are not covered by legacy timetable revision triggers. | Generation records the selected load IDs. Targeted adoption requires the original `scope_load_ids` and server-signed `scope_token`, verifies them against the current scope, and rejects membership drift before writing. The atomic write batch checks live membership again, closing the race between validation and persistence. |
| A client can recompute the public proposal digest. | The selected membership is also protected by a server HMAC covering school, year, revision, scope, and member IDs. Missing, rewritten, or forged scope proof is rejected. Presentation metadata such as `is_preserved` grants no write authority. Ordinary proposal lock edits remain supported. |
| Multiple lessons on each occupied day could hide an exceeded teacher working-day limit. | Whole-schedule validation now checks actual occupied days in fixed-entry solving, adoption, restoration, readiness, and saved-grid diagnostics. Incremental manual placement retains its existing repair semantics. |
| Week-profile capacity checks could omit teachers without a custom constraint record. | Every teacher with active demand is assessed, including teachers using default constraints. Reducing a day cannot bypass the default teacher-capacity check. |
| Teachers may each fit the shorter week while their combined demand exceeds one section's capacity. | Week-profile preview adds class-wide and section-specific demand for each placement, including unassigned loads. It blocks a new or increased placement deficit before applying a day reduction; existing deficits remain visible. |

Independent scope checks confirmed: unchanged targeted adoption succeeds and preserves outside rows exactly; stage membership changing after generation is rejected; membership changing immediately before the atomic write is also rejected. Rejected writes leave official entries and version snapshots unchanged.

## Validation snapshot

- Integrated local regression matrix: **1713/1713 passed**, **34 suites**, **0 skipped**.
- TypeScript: **PASS**.
- UI-focused verification: **131 checks passed**.
- Browser verification: **Chrome 154**, **Edge 154**, and **Firefox 141**; A4/A3 PDF output dimensions and layout verified.
- [CI run 36334624826](https://github.com/smartschoolduhok/smart-school/actions/runs/36334624826): **PASS**, including genuine D1 scenarios, fresh seed, exact backup/restore, build and dependency audit.
- **Real STAGING API acceptance passed** on the tested implementation at [the immutable preview](https://a153b5a0.smart-school-staging.pages.dev). Twenty-one checks covered the 7/7/6/6/5 week, preserved slot IDs, sequential section/class/stage/school generation, pinned entries, exact outside rows, unchanged original demand, saved-version warnings, shared-teacher limits, stale revision and stage membership, forged scope proof, role/tenant rejection, occupied-day reduction and teacher/placement capacity deficits.
- Two new inactive synthetic years in school 2 isolated acceptance from the existing active year. Schools 1/3, all pre-existing timetable rows and existing school-2 years matched the baseline; foreign keys and transient guards were clean.

## Authenticated browser and retirement evidence

The actual STAGING interface loaded the isolated year and its real API data; no response interception was used. The global active academic year stayed unchanged. Chrome reported no uncaught errors or unexpected API failures. At 390px, controls and the document fit the viewport; the wide timetable scrolls inside its own container.

Every page of six exported PDFs was rendered with Poppler and inspected:

| Actual STAGING output | Result |
|---|---|
| One section, A4 and A3 landscape | One page each; correct paper dimensions and unequal-day cells. |
| One class, each of its two sections separately, A4 | Two pages; one section per page. |
| A class without sections, A4 | One page using the class-wide timetable. |
| Stages separately, A3 | Four pages; middle stage begins on page 1, primary on page 3. Each stage naturally spans two pages with repeated headings. |
| Primary stage alone, A3 | Two pages, including both sections. |

There was no clipped content or extra blank page. The browser's own session logged out successfully. Private evidence is retained outside Git in `staging-browser-print-qa.json`, `staging-browser-print-visual-review.json`, PDFs and rendered PNGs; it is not suitable for public attachment because it includes staging master-data labels.

Retirement completed through the normal APIs: current entries in the two new years were explicitly unlocked and removed, loads disabled, and synthetic subjects/sections/classes/employees archived. Inactive years, slots and saved schedule versions remain as history. Both temporary QA actors were disabled and their sessions invalidated. The protected-school and pre-existing timetable/year comparisons passed again after retirement; foreign keys and transient guards remained clean.

The branch also incorporates the independently verified grade-progress print correction from PR #54. Final combined review reproduced an additional cross-report effect: its retained lazy-route stylesheet had an unnamed A4 page rule which overrode an unrelated earlier A3 rule. The correction uses the named `grade-progress-report` page only on that report. Against the exact deployed CSS, the unrelated report changed from A3 to A4 before the correction; with the correction it retains A3 (1191.12×841.92 pt), and a report with no explicit size retains its browser-default Letter size. The combined timetable still prints A3 and landscape A4, and grade-progress short/70-row reports remain one/three A4 pages. Nine focused workflow UI tests passed. No timetable code or migration changed in this final correction. Final branch and merge CI/deployment identities are recorded on the PR and in the project release record.

## Supporting documents

- [Arabic usage guide](FLEXIBLE_TIMETABLE_GUIDE_AR.md).
- [Synthetic STAGING acceptance plan](FLEXIBLE_TIMETABLE_STAGING_QA.md).

No new migration or production resource is part of this feature. School staff pilot and verified official policy sources remain separate operational requirements.
