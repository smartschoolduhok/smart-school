import assert from 'node:assert/strict';
import {fixture, snapshot, revision} from './teaching-load-matrix-fixture.mjs';
import {generateWeekTemplate} from '../../src/lib/weekSetup.ts';
export {root, fixtureSQL, migrationSQL, migrationFiles, entry, addConstraints, addAvailability, snapshot, revision} from './teaching-load-matrix-fixture.mjs';
export const example = () => generateWeekTemplate({start_time:'13:00',lesson_count:7,lesson_minutes:35,breaks:[{after_lesson:2,minutes:15},{after_lesson:4,minutes:10}]});
export const maximum = () => generateWeekTemplate({start_time:'06:00',lesson_count:30,lesson_minutes:20,breaks:[]});
export function weekFixture(t, empty=false) {
  const f=fixture(); t?.after(()=>f.db.close());
  if(empty) f.db.exec('DELETE FROM timetable_slots WHERE school_id=1 AND academic_year_id=1');
  return f;
}
export const request = (f, template=example(), days=[3], mode='fill_empty_days') => ({school_id:1,academic_year_id:1,
  expected_revision:revision(f.db),mode,source_day_of_week:null,targets:days.map(day_of_week=>({day_of_week,activate_day:day_of_week>2})),template});
export function assertPreserved(before, after, exceptions=['timetable_days','timetable_slots','timetable_revisions']) {
  for(const name of Object.keys(before)) if(!exceptions.includes(name)) assert.deepEqual(after[name],before[name],name+' unchanged');
}
export const historySQL = `
INSERT INTO timetable_schedule_versions(id,version_key,school_id,academic_year_id,source,previous_revision,created_by_user_id,old_entry_count,new_entry_count,locked_entry_count,proposal_digest)
VALUES(1,'week-fixture',1,1,'automatic_adoption',0,1,1,1,1,'local-fixture');
INSERT INTO timetable_schedule_version_entries(version_id,original_entry_id,school_id,academic_year_id,slot_id,teaching_load_id,is_locked) VALUES(1,1,1,1,1,2,1);
`;
