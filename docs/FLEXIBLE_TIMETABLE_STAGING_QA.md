# Synthetic STAGING acceptance plan

Status: prepared locally; no remote requests are performed by this document. Execute after the PR54 gate and after the timetable build is available on STAGING. Record the tested deployment SHA, time, target school/year IDs, and redacted results in the release evidence.

## Isolated fixture

Use an explicitly selected synthetic QA school, never an existing operational school. Create through normal authorized APIs and capture returned IDs; do not assume numeric IDs or reuse real students, staff, credentials, or timetable rows. No students are needed.

| Symbol | Synthetic record |
|---|---|
| S | School named `QA-FLEX-TIMETABLE-<run-id>` |
| Y | One academic year belonging to S |
| A | Active class `QA Primary`, stage `ابتدائي` |
| A1, A2 | Two active sections of A |
| B | Active class `QA Middle`, stage `متوسط`, no sections |
| T | One synthetic active teacher shared by all three loads |
| Subject A | General subject of class A (`section_id: null`), used separately by A1 and A2 |
| Subject B | General subject of class B |
| L1, L2, L3 | Active loads A1, A2, B respectively; T teaches each; each requires 3 weekly periods |

Use the normal authenticated STAGING session with its CSRF header, or the existing authorized API client. Keep credentials and session material out of reports and shell output. Record a preflight snapshot of the operational schools and of the synthetic fixture before each mutation.

## Week configuration through API

All timetable bodies include `school_id: S` and `academic_year_id: Y`. Weekday IDs are Sunday=0 through Thursday=4.

1. Read `GET /api/timetable/week-setup?school_id=S&academic_year_id=Y` for `revision`.
2. Build non-overlapping 40-minute lesson periods starting at 08:00, with sequential `slot_index` and `lesson_number`, `slot_type: "lesson"`, and `is_active: 1`. No breaks are required for this minimal fixture.
3. POST `/api/timetable/week-setup/preview` with `mode: "fill_empty_days"`, `source_day_of_week: null`, the current `expected_revision`, the 7-lesson `template`, and `targets: [{day_of_week:0,activate_day:true},{day_of_week:1,activate_day:true}]`.
4. Require `can_apply: true`; POST `/api/timetable/week-setup/apply` with the same request plus `confirm_apply: true` and the returned `preview_digest`. Read a fresh revision.
5. Repeat with 6 lessons for days 2, 3, and 4. Capture the IDs of all six Thursday slots.
6. Preview/apply `mode: "configure_day"`, `source_day_of_week: null`, target day 4 only (`activate_day:false`), with a 5-lesson template matching the first five Thursday periods. Require the sixth slot to remain present with its original ID and `is_active: 0`.

Acceptance: active lesson counts are **[7, 7, 6, 6, 5]**, total capacity **31**; 32 lesson records remain saved because the unused sixth Thursday lesson was deactivated. Other weekdays and scopes remain unchanged.

## Manual placement, constraints, and pinning

Resolve slot IDs from `GET /api/timetable/slots`. Use `POST /api/timetable/entries` with `slot_id` and `teaching_load_id` to place:

| Load | Placement | Initial lock |
|---|---|---|
| L1 / A1 | Sunday, lesson 7 | Pin through API |
| L2 / A2 | Monday, lesson 1 | Unlocked |
| L3 / B | Monday, lesson 2 | Unlocked |

Read A1 grid through `GET /api/timetable/grid?...&class_id=A&section_id=A1`; use its current `revision` in:

```json
{
  "school_id": "S (replace with numeric ID)",
  "academic_year_id": "Y (replace with numeric ID)",
  "expected_revision": "current numeric revision",
  "scope": {"kind":"section","class_id":"A numeric ID","section_id":"A1 numeric ID"},
  "is_locked": 1
}
```

Send this to `PUT /api/timetable/entries/lock-scope`. Require `affected_count: 1`; A2 and B remain unlocked. The strings above are documentation placeholders: the API requires numeric IDs and revision.

Configure T using `PUT /api/timetable/teacher-constraints`: `max_periods_per_day:4`, `max_working_days:3`, `max_consecutive_periods:3`, with soft preferences zero. Set Sunday lesson 1 to `unavailable` using `PUT /api/timetable/teacher-availability/<slot-id>` with S, Y, T and `status: "unavailable"`. Capture exact outside rows, including IDs, slot IDs, load IDs, locks, creators, and timestamps, and all three original weekly loads.

## Scoped generation and adoption

1. POST `/api/timetable/solver/preview` with S, Y and `generation_scope: {kind:"section",class_id:A,section_id:A1}`. Do not supply the legacy locked-entry option: the persisted L1 lock must be preserved by default.
2. Require `status:"complete"`, 3 L1 entries, exactly the existing single L2 and L3 entries, and no Sunday lesson 1 entry. L1 stays fixed at Sunday lesson 7. No teacher slot is duplicated; teacher daily, consecutive, and working-day limits hold.
3. Send canonical entries (only `slot_id`, `teaching_load_id`, `is_locked`), `generation_scope`, `scope_load_ids`, `scope_token`, `proposal_revision`, and `proposal_digest` to `/api/timetable/solver/adoption-preview`. Copy the membership IDs and server scope proof unchanged from generation. Require `can_apply:true` even though `weekly_demand.current_demand_complete:false` for the whole school.
4. POST `/api/timetable/solver/apply` with S, Y, the same scope/membership/proof/entries/digest, `expected_revision` equal to the proposal revision, and `confirm_apply:true`.
5. Read back: A1 has 3 lessons; A2 and B rows are byte-identical to the captured outside rows, including original IDs/timestamps and unlocked flags. Original loads remain 3/3/3. A previous-version snapshot exists.
6. Generate/adopt the stage `{kind:"stage",stage:"ابتدائي"}`. A1 and A2 each reach 3 lessons; B's single saved row remains unchanged. Pin the stage through `lock-scope` using the latest revision.
7. Generate/adopt `{kind:"school"}`. All nine required lessons are scheduled; all six primary-stage lessons keep their exact slots and locks. There are nine distinct occupied teacher slots, none unavailable, and all limits still hold.

## Negative cases and final evidence

- Stale preview: generate a proposal, explicitly change one lock via the API, then attempt the old apply. Expect HTTP **409**, identical official rows, and no new adoption snapshot.
- Scope tampering: change `generation_scope` while retaining the original digest. Expect adoption refusal; no writes.
- Stage membership drift: generate a stage proposal, then change another class's stage before adoption. Require a fresh proposal if the selected load membership changed; missing or altered `scope_load_ids`/`scope_token` must also be refused. The preview's preserved outside rows must remain untouched.
- Occupied-day reduction: attempt to reduce Sunday below the pinned lesson 7. Expect a blocked week preview and no writes to slots or entries.
- Explicit unlock: use section `lock-scope` with `is_locked:0` and the latest revision; only the intended section unlocks. Refresh the revision before subsequent work.
- Confirm the operational schools' preflight snapshots are unchanged. Preserve the named synthetic fixture or retire it via the project's normal QA cleanup procedure; do not delete unrelated rows.
- In the browser, print the synthetic school using A4 and A3 landscape, then `كل شعبة تبدأ بورقة مستقلة` and `كل مرحلة تبدأ بورقة مستقلة`. Record PDF page dimensions, group starts, and absence of clipped timetable content; a group may legitimately span multiple sheets.

Local reference tests: `test/timetable-adoption-api.test.mjs`, `test/timetable-solver.test.mjs`, `test/timetable-scope.test.mjs`, `test/week-setup-api.test.mjs`, and `test/timetable-print-ui.test.mjs`. Remote acceptance is complete only after the recorded real requests and readbacks pass.
