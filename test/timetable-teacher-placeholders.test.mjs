import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, entry, revision } from './helpers/teaching-load-matrix-fixture.mjs';
import { buildTimetableReadiness, evaluateTimetableEntryPlacement, loadHasInvalidTeacherReference, validateTimetableLoadInput } from '../src/lib/timetable.ts';
import { validateCompleteTimetableSchedule } from '../src/lib/timetableAdoption.ts';
import { solveTimetable } from '../src/lib/timetableSolver.ts';
import { timetableTeacherName, timetableTeacherResourceKey } from '../src/lib/timetableTeacherResource.ts';
import { loadTeachingLoadMatrix, buildMatrixApplyStatements, publicTeachingLoadMatrix } from '../src/lib/teachingLoadMatrixDb.ts';
import { matrixDraftChanges, planTeachingLoadMatrix, planTeachingLoadCopy } from '../src/lib/teachingLoadMatrix.ts';

function load(id, name = 'مدرس العربي والإسلامية', extra = {}) {
  return { id, school_id:1, academic_year_id:1, class_id:id, class_name:'Class ' + id,
    class_status:'active', class_school_id:1, active_section_count:0, section_id:null,
    subject_id:id, subject_name:'Subject ' + id, subject_status:'active', subject_school_id:1, subject_class_id:id,
    subject_section_id:null, employee_id:null, employee_name:null, teacher_placeholder:name,
    weekly_periods:1, status:'active', created_at:0, updated_at:0, ...extra };
}
function context(loads) {
  const days = [{id:1, school_id:1, academic_year_id:1, day_of_week:0, is_active:1, order_index:0}];
  const slots = [1,2].map(id => ({id, school_id:1, academic_year_id:1, day_of_week:0,
    slot_index:id, lesson_number:id, slot_type:'lesson', is_active:1, label:'Lesson',
    start_time:id===1?'12:45':'13:25', end_time:id===1?'13:25':'14:05'}));
  return {schoolId:1, academicYearId:1, days, slots, loads, availability:[], constraints:[],
    placements:loads.map(l=>({class_id:l.class_id,class_name:l.class_name,section_id:null,section_name:null})),
    subjects:loads.map(l=>({id:l.subject_id,school_id:1,class_id:l.class_id,section_id:null,name:l.subject_name,status:'active'}))};
}
const placement = (id, slot_id, teaching_load_id) => ({id, school_id:1,academic_year_id:1,slot_id,teaching_load_id,is_locked:0});

test('resource identity is scoped, trimmed, independent of subject and never an employee ID', () => {
  const a=load(1), b=load(2,'  مدرس العربي والإسلامية  ');
  assert.equal(timetableTeacherResourceKey(a),timetableTeacherResourceKey(b));
  assert.notEqual(timetableTeacherResourceKey(a),timetableTeacherResourceKey({...b,academic_year_id:2}));
  assert.notEqual(timetableTeacherResourceKey(a),timetableTeacherResourceKey(load(2,'مدرس الإنكليزي')));
  assert.equal(timetableTeacherName(a),'مدرس العربي والإسلامية');
  assert.equal(loadHasInvalidTeacherReference(a),false);
  assert.equal(loadHasInvalidTeacherReference({...a,employee_id:5,employee_status:'active',employee_school_id:1,employee_role:'teacher'}),true);
  const base={academic_year_id:1,class_id:1,subject_id:1,weekly_periods:2};
  assert.equal(validateTimetableLoadInput({...base,teacher_placeholder:' مدرس الإنكليزي '}).value.teacherPlaceholder,'مدرس الإنكليزي');
  assert.equal(validateTimetableLoadInput({...base,employee_id:5,teacher_placeholder:a.teacher_placeholder}).value.teacherPlaceholder,null);
  assert.equal(validateTimetableLoadInput({...base,teacher_placeholder:'bad\nname'}).ok,false);
});

test('adoption and individual placement reject a shared named resource in two classes at once', () => {
  const c=context([load(1),load(2)]), entries=[placement(1,1,1),placement(2,1,2)];
  assert.ok(evaluateTimetableEntryPlacement({...c,entries,candidate:entries[1]}).hard_conflicts.some(n=>n.code==='teacher_collision'));
  assert.equal(validateCompleteTimetableSchedule(c,entries).complete,false);
  assert.equal(validateCompleteTimetableSchedule(c,[entries[0],placement(2,2,2)]).complete,true);
  assert.equal(validateCompleteTimetableSchedule({...c,loads:[load(1),load(2,'مدرس الإنكليزي')]},entries).complete,true);
});

test('solver reserves shared placeholder capacity but returns actual null employee metadata', () => {
  const c=context([load(1),load(2)]);
  const result=solveTimetable({...c,currentEntries:[],teacherAvailability:[],teacherConstraints:[],
    limits:{time_budget_ms:4000,max_attempts:1000,max_backtracks:100,max_local_improvement_attempts:20}});
  assert.equal(result.status,'complete');
  assert.equal(new Set(result.entries.map(e=>e.slot_id)).size,2);
  assert.ok(result.entries.every(e=>e.employee_id===null && e.teacher_placeholder==='مدرس العربي والإسلامية' && e.employee_name===e.teacher_placeholder));
  assert.equal(result.readiness.missing_teacher_count,0);
  assert.equal(c.loads[0].employee_id,null,'source records remain untouched');
  const over=solveTimetable({...context([load(1),load(2),load(3)]), limits:{time_budget_ms:4000,max_attempts:100,max_backtracks:10,max_local_improvement_attempts:0}});
  assert.equal(over.status,'impossible');
  assert.equal(over.readiness.overloaded_teachers[0].employee_id,null);
  assert.ok(over.readiness.hard_feasibility_blockers.every(item=>item.employee_id==null || item.employee_id>0));
});

test('real teacher availability stays independent of provisional names and readiness counts named capacity', () => {
  const real=load(1,null,{employee_id:5,employee_name:'Real',employee_status:'active',employee_school_id:1,employee_role:'teacher'});
  const c=context([real,load(2)]);
  const unavailable={school_id:1,academic_year_id:1,employee_id:5,slot_id:1,status:'unavailable'};
  assert.ok(evaluateTimetableEntryPlacement({...c,teacherAvailability:[unavailable],entries:[],candidate:placement(1,1,1)}).hard_conflicts.some(n=>n.code==='teacher_unavailable'));
  assert.equal(evaluateTimetableEntryPlacement({...c,teacherAvailability:[unavailable],entries:[],candidate:placement(2,1,2)}).hard_conflicts.length,0);
  const ready=buildTimetableReadiness(context([load(1),load(2),load(3)]));
  assert.equal(ready.missing_teacher_count,0);
  assert.equal(ready.ready,false);
  assert.equal(ready.teacher_feasibility_issues[0].employee_id,null);
});

test('database migration guards insert, move, reassignment, normalization and revision', () => {
  const f=fixture();
  f.db.exec("UPDATE timetable_teaching_loads SET employee_id=NULL, teacher_placeholder='مدرس الإنكليزي' WHERE id IN (1,2)");
  entry(f.db,1,1);
  assert.throws(()=>entry(f.db,2,1),/placeholder teacher collision/);
  const second=entry(f.db,2,2);
  assert.throws(()=>f.db.prepare('UPDATE timetable_entries SET slot_id=1 WHERE id=?').run(second),/placeholder teacher collision/);
  f.db.exec("UPDATE timetable_teaching_loads SET teacher_placeholder='مدرس آخر' WHERE id=2");
  f.db.prepare('UPDATE timetable_entries SET slot_id=1 WHERE id=?').run(second);
  assert.throws(()=>f.db.exec("UPDATE timetable_teaching_loads SET teacher_placeholder='مدرس الإنكليزي' WHERE id=2"),/placeholder teacher collision/);
  assert.throws(()=>f.db.exec("UPDATE timetable_teaching_loads SET employee_id=2 WHERE id=2"),/placeholder invalid/);
  assert.throws(()=>f.db.exec("UPDATE timetable_teaching_loads SET teacher_placeholder=' spaced ' WHERE id=2"),/placeholder invalid/);
  const before=revision(f.db);
  f.db.exec("UPDATE timetable_teaching_loads SET employee_id=2, teacher_placeholder=NULL WHERE id=2");
  assert.ok(revision(f.db)>before);
  assert.equal(f.db.prepare('SELECT teacher_placeholder FROM timetable_teaching_loads WHERE id=2').get().teacher_placeholder,null);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('matrix periods-only edits preserve names, explicit clear and real assignment remove them', async () => {
  const f=fixture();f.db.exec("UPDATE timetable_teaching_loads SET teacher_placeholder='مدرس العربي والإسلامية' WHERE id=1");
  const c=await loadTeachingLoadMatrix(f.d1,1,1,1), data=publicTeachingLoadMatrix(c);
  const changes=matrixDraftChanges(data,{'1:1':{periods:'5'}});
  assert.equal(changes[0].teacher_placeholder,'مدرس العربي والإسلامية');
  const plan=planTeachingLoadMatrix(c,changes);
  assert.equal(plan.can_apply,true);
  await f.d1.batch(buildMatrixApplyStatements(f.d1,{school_id:1,academic_year_id:1,class_id:1},plan,1));
  assert.equal(f.db.prepare('SELECT teacher_placeholder FROM timetable_teaching_loads WHERE id=1').get().teacher_placeholder,'مدرس العربي والإسلامية');
  const clear=matrixDraftChanges(data,{'1:1':{employeeId:null}});
  assert.equal(clear[0].teacher_placeholder,null);
  assert.equal(planTeachingLoadMatrix(c,[{subject_id:1,section_id:1,action:'upsert',employee_id:1,weekly_periods:4}]).items[0].new_teacher_placeholder,null);
  const copied=planTeachingLoadCopy(c,[{...c.loads.find(l=>l.id===1),academic_year_id:2}],'periods_and_teachers');
  assert.equal(copied.changes[0].teacher_placeholder,'مدرس العربي والإسلامية');
  const copiedEmpty=planTeachingLoadCopy(c,[{...c.loads.find(l=>l.id===1),academic_year_id:2,teacher_placeholder:null}],'periods_and_teachers');
  assert.equal(copiedEmpty.changes[0].teacher_placeholder,null);
  assert.equal(copiedEmpty.plan.items[0].new_teacher_placeholder,null);
});

test('matrix preview catches resource reassignment collisions before the database writes', async () => {
  const f=fixture();f.db.exec("UPDATE timetable_teaching_loads SET employee_id=NULL,teacher_placeholder=CASE id WHEN 1 THEN 'A' ELSE 'B' END WHERE id IN (1,2)");
  entry(f.db,1,1);entry(f.db,2,1);
  const c=await loadTeachingLoadMatrix(f.d1,1,1,1);
  const plan=planTeachingLoadMatrix(c,[{subject_id:1,section_id:2,action:'upsert',employee_id:null,teacher_placeholder:'A',weekly_periods:4}]);
  assert.equal(plan.can_apply,false);
  assert.ok(plan.items[0].blockers.some(i=>i.code==='teacher_collision'));
});

test('database and model prohibit simultaneous paired subjects assigned to one named resource', async () => {
  const f=fixture();f.db.exec("UPDATE timetable_teaching_loads SET teacher_placeholder='مدرس العربي والإسلامية' WHERE id=1");
  assert.throws(()=>f.db.exec("INSERT INTO timetable_teaching_loads(school_id,academic_year_id,class_id,section_id,subject_id,employee_id,teacher_placeholder,weekly_periods,status,parallel_with_load_id) VALUES(1,1,1,1,2,NULL,'مدرس العربي والإسلامية',4,'active',1)"),/placeholder parallel teacher/);
});

