import assert from 'node:assert/strict';
import {fixture, snapshot, revision} from './teaching-load-matrix-fixture.mjs';
import {generateWeekTemplate} from '../../src/lib/weekSetup.ts';
import {calculateTeacherAvailabilitySummary} from '../../src/lib/timetable.ts';
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

// Isolated generated review cases: genuine schema, no changes to base fixtures.
export const reviewLessons = (count=4) => generateWeekTemplate({start_time:'08:00',lesson_count:count,lesson_minutes:40,breaks:[]});
const reviewSlotsSQL = (year,day,count=4) => reviewLessons(count).map((p,i)=>
  `INSERT INTO timetable_slots(id,school_id,academic_year_id,day_of_week,slot_index,slot_type,lesson_number,label,start_time,end_time,is_active)
   VALUES(${year*100+day*10+i},1,${year},${day},${p.slot_index},'lesson',${p.lesson_number},'${p.label}','${p.start_time}','${p.end_time}',1);`).join('\n');
export function capacityEvidenceSQL(capacity=0) {
  return `INSERT INTO academic_years(id,school_id,name,starts_at,ends_at,is_active) VALUES(40,1,'Review capacity','2040-09-01','2041-06-01',0);
    INSERT INTO timetable_days(school_id,academic_year_id,day_of_week,is_active,order_index) VALUES(1,40,0,1,0),(1,40,1,0,1);
    INSERT INTO timetable_teaching_loads(id,school_id,academic_year_id,class_id,section_id,subject_id,employee_id,weekly_periods,status) VALUES(40,1,40,1,1,1,1,4,'active');
    INSERT INTO timetable_teacher_constraints(school_id,academic_year_id,employee_id,max_periods_per_day) VALUES(1,40,1,4);
    ${capacity ? reviewSlotsSQL(40,0,capacity) : ''}`;
}
export function workingDaysEvidenceSQL({limit=1,activeDays=1,occupiedDays=2}={}) {
  let sql=`INSERT INTO academic_years(id,school_id,name,starts_at,ends_at,is_active) VALUES(41,1,'Review occupancy','2041-09-01','2042-06-01',0);`;
  for(let day=0;day<occupiedDays;day++) {
    sql+=`INSERT INTO timetable_days(school_id,academic_year_id,day_of_week,is_active,order_index) VALUES(1,41,${day},1,${day});`;
    sql+=reviewSlotsSQL(41,day);
    sql+=`INSERT INTO timetable_teaching_loads(id,school_id,academic_year_id,class_id,section_id,subject_id,employee_id,weekly_periods,status)
      VALUES(${41+day},1,41,${day===1?2:1},${day===1?'NULL':day===2?2:1},${day===1?4:1},1,2,'active');`;
    for(let i=0;i<2;i++) sql+=`INSERT INTO timetable_entries(id,school_id,academic_year_id,slot_id,teaching_load_id,is_locked,created_by_user_id,updated_by_user_id)
      VALUES(${4100+day*10+i},1,41,${4100+day*10+i},${41+day},${day===0&&i===0?1:0},1,1);`;
  }
  sql+=`UPDATE timetable_days SET is_active=0 WHERE school_id=1 AND academic_year_id=41 AND day_of_week>=${activeDays};
    INSERT INTO timetable_teacher_constraints(school_id,academic_year_id,employee_id,max_working_days) VALUES(1,41,1,${limit});
    INSERT INTO timetable_teacher_availability(school_id,academic_year_id,employee_id,slot_id,status) VALUES(1,41,1,4100,'preferred');
    INSERT INTO timetable_schedule_versions(id,version_key,school_id,academic_year_id,source,previous_revision,created_by_user_id,old_entry_count,new_entry_count,locked_entry_count,proposal_digest)
      VALUES(40,'review-occupancy',1,41,'automatic_adoption',0,1,1,1,1,'local-generated');
    INSERT INTO timetable_schedule_version_entries(version_id,original_entry_id,school_id,academic_year_id,slot_id,teaching_load_id,is_locked) VALUES(40,4100,1,41,4100,41,1);`;
  return sql;
}
export const evidenceRequest = (context,template,day=0) => ({school_id:context.school_id,academic_year_id:context.academic_year_id,
  expected_revision:context.revision,mode:'update_matching_keep_extra',source_day_of_week:null,targets:[{day_of_week:day,activate_day:true}],template});
export const reviewCapacity = c => calculateTeacherAvailabilitySummary({schoolId:c.school_id,academicYearId:c.academic_year_id,employeeId:1,
  employeeName:'Review teacher',assignedWeeklyPeriods:c.loads.filter(l=>l.employee_id===1&&l.status==='active').reduce((n,l)=>n+l.weekly_periods,0),
  days:c.days,slots:c.slots,overrides:c.availability,constraints:c.constraints.find(c=>c.employee_id===1)});
export const unrelatedEvidenceSQL = `
  INSERT INTO timetable_teaching_loads(id,school_id,academic_year_id,class_id,section_id,subject_id,employee_id,weekly_periods,status) VALUES(44,1,41,1,2,2,2,4,'active');
  INSERT INTO timetable_entries(school_id,academic_year_id,slot_id,teaching_load_id) VALUES(1,41,4102,44),(1,41,4103,44),(1,41,4112,44),(1,41,4113,44);
  INSERT INTO timetable_teacher_constraints(school_id,academic_year_id,employee_id,max_working_days) VALUES(1,41,2,1),(1,2,1,1),(2,3,5,1);
`;
