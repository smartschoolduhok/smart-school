# Student transport release

The transport register adds shared residential areas and driver lines, guardian contact/address fields, and independent school/private/family/other/unspecified methods for each journey. Management and registrars can select multiple areas, filter journeys or drivers, assign up to 100 students atomically, and print every filtered student in grouped A4 landscape rosters.

## Compatibility

- Based on current release `32c340a`; preserves annual study status, admissions age checks, student privacy and current cookie/CSRF authentication.
- Migration `0056_student_transport.sql` adds two lookup tables and transport columns. Existing students start with unspecified methods; no legacy values are rewritten.
- New manual student records require an area and guardian phone. Existing records and imports can be completed gradually.
- Transport is current profile data; it does not create a fee ledger or historical annual subscription record.

## Verified before migration

- TypeScript and frontend/Worker builds passed with locked dependencies; dependency audit reported zero vulnerabilities.
- Transport library/API checks: 18 passed, including tenant/role boundaries, independent private/family journeys, same-direction driver filtering, 100-student assignment and all-or-nothing rejection.
- Student profile and UI compatibility checks passed; annual study-status and age API fixtures were updated for the required contact fields and passed independently.
- Multi-page print verification checked all 60 synthetic students, seven A4 landscape pages, repeated headings, guardian phones and driver-specific journey responsibility.
- A fresh STAGING SQL export was stored outside Git in a restricted local directory. The existing backup verifier restored it into genuine local workerd D1 and confirmed exact schema, data/types and migration history with zero foreign-key violations.
- Rehearsing 0056 on that private backup preserved all original values for 81 students and all 104 existing tables, leaving transport unspecified and foreign keys valid. No private school data or credentials are included in this document.

## Deployment

Target: the existing Git-connected STAGING project `smart-school-staging` and its configured D1 database. Apply only 0056 after its local D1 gate, validate the database, then merge the approved candidate after CI succeeds. Git-driven deployment preserves the latest existing features and HOMEWORK_FILES binding. Main must not be released before the migration because student reads include the new fields.

Rollback: retain the previous Pages deployment and the private pre-migration backup/bookmark. Since the schema change is additive, the prior application remains compatible; database restoration is a separate operational decision and must not discard later school writes.

D1 compatibility: the first remote attempt returned `incomplete input` and rolled back completely; schema/history checks confirmed no transport objects or migration record and all 81 students remained. The unapplied file was adjusted to LF and `SELECT RAISE ... WHERE` guards with identical validation semantics, consistent with the existing migrations. The API checks and private rehearsal passed again. See Cloudflare's [trigger CASE parsing report](https://github.com/cloudflare/workers-sdk/issues/4727) and [CRLF migration report](https://github.com/cloudflare/workers-sdk/issues/14991).

## STAGING migration acceptance — 2026-10-04

`0056_student_transport.sql` applied successfully after the compatibility adjustment. Postflight confirmed 57 recorded migrations with none pending, both transport lookup tables, 81 preserved students all defaulting to unspecified outbound/return transport, and no foreign-key violations. The previous application continues to serve while the Git release gate completes. No student transport assignments, residential areas or driver records were added to the live database during verification.
